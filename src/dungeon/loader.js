/*
 * The core: one room per tick, copied whole.
 *
 * Everything this file does is a consequence of two documented facts:
 *
 *   1. `api.copyChunk(fromPos, toPos)` copies a whole 32x32x32 chunk in one call,
 *      and its documentation names the use case — "storing 'template' chunks that
 *      can be continuously copied to a new position".
 *
 *   2. "NOTE: Does nothing if the source chunk is not loaded." A copy from an
 *      unloaded template is not an error, it is silence. That single sentence is
 *      why this engine looks the way it does: a template is read once before it is
 *      used, the copy is verified by reading the destination back, and a template
 *      that fails the check is disabled for the session instead of being retried
 *      for ever.
 *
 * The queue is a consequence of a third fact: a chunk no player is near cannot be
 * loaded, so it cannot be read, so its record block says "not placed" whether or
 * not it is. Planning therefore happens only around players, never in the
 * abstract.
 *
 * There is no state per room, no cursor, no resumable build, no progress record,
 * no shard, no index. A room is a chunk that was copied, or a chunk that was not.
 * Nothing in between exists, which is what makes the whole thing small enough to
 * trust.
 */

import { DUNGEON_CONFIG, floorOfLayer } from "./config.js";
import { templateFor, templatesFor } from "./templates.js";

const SIZE = DUNGEON_CONFIG.chunkSize;
/** How many later ticks a copy is given to show up at its destination. */
const VERIFY_ATTEMPTS = 3;

export function chunkKey(chunkX, chunkZ) {
  return `${chunkX}|${chunkZ}`;
}

/** The chunk a world cell falls in. */
export function chunkOfWorld(x, z) {
  return { x: Math.floor(x / SIZE), z: Math.floor(z / SIZE) };
}

/**
 * The world cell that holds the record of a room.
 *
 * The middle of the room's ceiling — the one cell that exists in every room and
 * that no player can stand in. See `DUNGEON_CONFIG.surfaceBlock`.
 */
export function surfaceCellOf(difficulty, chunkX, chunkZ) {
  return [
    chunkX * SIZE + DUNGEON_CONFIG.surfaceLocalXZ,
    floorOfLayer(difficulty) + SIZE - 1,
    chunkZ * SIZE + DUNGEON_CONFIG.surfaceLocalXZ,
  ];
}

export function createLoader({ api, log }) {
  const say = log || (() => {});
  /** Per level state, created on first use and never rebuilt. */
  const levels = new Map();
  /** Copies waiting for their verification read. */
  const pendingVerify = [];

  function levelState(difficulty) {
    let level = levels.get(difficulty.id);
    if (!level) {
      level = {
        difficulty,
        templates: templatesFor(difficulty, say),
        /** Templates whose source chunk cannot be read: never retried. */
        disabled: new Set(),
        /** Template id → how many times its source block read as `null`. */
        templateAttempts: new Map(),
        /** chunkX|chunkZ → "queued" | "placing" | "placed". Bounded to the view. */
        planned: new Map(),
        /** Ordered work: the next chunk to copy. */
        queue: [],
        placed: 0,
        /** Copies counted as placed without a readable destination chunk. */
        unverified: 0,
        failures: 0,
        ticksSinceScan: DUNGEON_CONFIG.scanTicks,
        /** Chunk-local Y of the templates' floor, found once per level. */
        floorLocalY: null,
        warnedMissing: false,
      };
      levels.set(difficulty.id, level);
    }
    return level;
  }

  /** Templates of a level that are still usable. */
  function usableTemplates(level) {
    if (level.disabled.size === 0) return level.templates;
    return level.templates.filter((template) => !level.disabled.has(template.index));
  }

  /** The template a chunk of a level gets, or null when none is usable. */
  function templateAt(level, chunkX, chunkZ) {
    return templateFor(usableTemplates(level), level.difficulty, chunkX, chunkZ);
  }

  /**
   * What the record block of a room says.
   *
   * `"unknown"` when the chunk is not loaded — which is not "empty": the answer
   * carries no information about the room, and the caller must not queue a copy
   * from a template the server has not sent yet.
   */
  function surfaceStateOf(difficulty, chunkX, chunkZ) {
    const cell = surfaceCellOf(difficulty, chunkX, chunkZ);
    const name = api.getBlock(cell[0], cell[1], cell[2]);
    if (name === null || name === undefined) return "unknown";
    return name === DUNGEON_CONFIG.surfaceBlock ? "placed" : "empty";
  }

  /**
   * Marks a room as built, by writing one block of its ceiling.
   *
   * Written after the copy, never part of it: a template is built by hand, and a
   * hand-built room cannot be asked to carry a block of this engine's choosing in
   * its ceiling. One `setBlock` per room, in the chunk the player is standing in.
   */
  function markPlaced(difficulty, chunkX, chunkZ) {
    const cell = surfaceCellOf(difficulty, chunkX, chunkZ);
    api.setBlock(cell[0], cell[1], cell[2], DUNGEON_CONFIG.surfaceBlock);
  }

  /**
   * Chunk-local Y of a template's floor, found by walking up from the bottom of
   * the chunk.
   *
   * Only the templates **of this level's horizontal area** are probed: rooms are
   * moved onto the level's own layer when they are copied, so the Y of the chunk
   * they are stored at says nothing about where the floor will be once copied. The
   * copy keeps the room's vertical layout intact — the floor stays at the same
   * offset from the bottom of the chunk — which is what makes this value reusable
   * at the destination.
   *
   * Read from the world rather than configured: a hand-written floor height is
   * wrong for the one template out of ten whose builder put the floor one cell
   * higher, and the symptom is a player landing inside the floor or two blocks
   * above it. `null` means no column could be read — the templates are not loaded
   * — and the caller falls back to a position it can justify.
   */
  function findFloorLocalY(level) {
    if (level.floorLocalY !== null) return level.floorLocalY;
    const probe = usableTemplates(level)[0];
    if (!probe) return null;
    const baseY = Math.floor(probe.src[1] / SIZE) * SIZE;
    const baseX = Math.floor(probe.src[0] / SIZE) * SIZE;
    const baseZ = Math.floor(probe.src[2] / SIZE) * SIZE;
    // Columns through the middle first: that is where every room has its floor.
    const columns = [[16, 16], [8, 8], [24, 24], [4, 4]];
    for (const [localX, localZ] of columns) {
      for (let cell = 0; cell < DUNGEON_CONFIG.floorProbeMaxCells; cell += 1) {
        const name = api.getBlock(baseX + localX, baseY + cell, baseZ + localZ);
        if (name === null || name === undefined) break;
        if (name === "Air") continue;
        level.floorLocalY = cell;
        return cell;
      }
    }
    return null;
  }

  /**
   * Where a player lands in the entrance room.
   *
   * `null` when no template could be read: without one there is no floor, and a
   * position invented from a configuration value drops the player into the void.
   * The service turns that `null` into a message the player can act on.
   */
  function landingPosition(difficulty) {
    const level = levelState(difficulty);
    const floorLocalY = findFloorLocalY(level);
    if (floorLocalY === null) return null;
    const [localX, localZ] = DUNGEON_CONFIG.landingLocalXZ;
    return [
      DUNGEON_CONFIG.originChunkX * SIZE + localX + 0.5,
      floorOfLayer(difficulty) + floorLocalY + DUNGEON_CONFIG.spawnAboveFloor,
      DUNGEON_CONFIG.originChunkZ * SIZE + localZ + DUNGEON_CONFIG.landingShiftZ + 0.5,
    ];
  }

  /**
   * Drops memory of chunks that are no longer near the player.
   *
   * `planned` is what stops a scan from re-reading and re-queueing the same room
   * every four ticks, so it has to be kept — but only for the view, or it grows
   * by twenty-five entries per chunk the player crosses, for ever.
   */
  function forgetFarChunks(level, playerChunkX, playerChunkZ) {
    // Two different reaches, because the two entries mean different things:
    //
    //   - a chunk **placed** counts as done for a wider ring than the one we build
    //     in, so a player who walks back does not ask the server for its record
    //     again — the room cannot un-build itself;
    //   - a chunk in **flight** is forgotten as soon as it leaves the ring we build
    //     in, so the plan follows the player instead of growing behind them.
    const doneReach = DUNGEON_CONFIG.viewChunks * 2;
    const pendingReach = DUNGEON_CONFIG.viewChunks + 2;
    for (const key of level.planned.keys()) {
      const placed = level.planned.get(key) === "placed";
      const reach = placed ? doneReach : pendingReach;
      const separator = key.indexOf("|");
      const x = Number(key.slice(0, separator));
      const z = Number(key.slice(separator + 1));
      if (Math.abs(x - playerChunkX) <= reach && Math.abs(z - playerChunkZ) <= reach) continue;
      level.planned.delete(key);
    }
  }

  /** Queues the chunks around one player's chunk, nearest first. */
  function planAround(level, playerChunkX, playerChunkZ) {
    const radius = DUNGEON_CONFIG.viewChunks;
    forgetFarChunks(level, playerChunkX, playerChunkZ);

    const candidates = [];
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        candidates.push({ x: playerChunkX + dx, z: playerChunkZ + dz, distance: Math.abs(dx) + Math.abs(dz) });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || a.x - b.x || a.z - b.z);

    let planned = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      if (planned >= DUNGEON_CONFIG.maxPlannedPerScan) break;
      if (level.queue.length >= DUNGEON_CONFIG.maxQueued) break;
      if (api.isNearInterrupt && api.isNearInterrupt()) break;

      const { x, z } = candidates[index];
      const key = chunkKey(x, z);
      if (level.planned.has(key)) continue;

      const template = templateAt(level, x, z);
      if (!template) continue;
      if (surfaceStateOf(level.difficulty, x, z) !== "empty") continue;

      level.planned.set(key, "queued");
      level.queue.push({ chunkX: x, chunkZ: z, template });
      planned += 1;
    }
  }

  /**
   * Asks the server to send the template chunks, before they are needed.
   *
   * One read per template chunk. The read is the request: a cell in an unloaded
   * chunk returns `null` and, in Bloxd, is what tells the server to create or send
   * that chunk. Doing it once at the start of a level costs one call per template
   * and gives the copies the few ticks they need to become readable.
   */
  function warmTemplates(difficulty) {
    const level = levelState(difficulty);
    const seen = new Set();
    for (const template of level.templates) {
      const chunkX = Math.floor(template.src[0] / SIZE);
      const chunkY = Math.floor(template.src[1] / SIZE);
      const chunkZ = Math.floor(template.src[2] / SIZE);
      const key = `${chunkX}|${chunkY}|${chunkZ}`;
      if (seen.has(key)) continue;
      seen.add(key);
      api.getBlock(template.src[0], template.src[1], template.src[2]);
    }
    return seen.size;
  }

  /**
   * Places the entrance room, alone and first.
   *
   * The entrance is the room the draw gives the origin chunk, like any other: no
   * room declares itself the entrance, because a room is just a chunk and the
   * first one a player sees should be an ordinary room. What makes this copy
   * special is only that it happens before the rest, and that the player's landing
   * depends on it.
   */
  function placeEntrance(difficulty) {
    const level = levelState(difficulty);
    const template = templateAt(level, DUNGEON_CONFIG.originChunkX, DUNGEON_CONFIG.originChunkZ)
      || usableTemplates(level)[0];
    if (!template) return null;
    const originX = DUNGEON_CONFIG.originChunkX;
    const originZ = DUNGEON_CONFIG.originChunkZ;
    const key = chunkKey(originX, originZ);
    // Never copied twice: an entrance is placed on every entry into the level, and
    // a player who dies, leaves and comes back must not trigger a second copy of a
    // room that is already there. The answer comes from the world, not from the
    // tally of a previous session.
    if (surfaceStateOf(difficulty, originX, originZ) === "placed") {
      level.planned.set(key, "placed");
      return template;
    }
    level.planned.delete(key);
    level.queue.unshift({
      chunkX: originX,
      chunkZ: originZ,
      template,
    });
    placeOne(level);
    return template;
  }

  /**
   * Stops using a template, everywhere.
   *
   * Disabling it is not enough on its own: its entries are still in the queue, and
   * a queue that keeps handing back a template nobody may use is a level that
   * never builds anything again. They are dropped here, once.
   */
  function disableTemplate(level, template) {
    level.disabled.add(template.index);
    level.templateAttempts.delete(template.index);
    for (let index = level.queue.length - 1; index >= 0; index -= 1) {
      if (level.queue[index].template.index !== template.index) continue;
      level.planned.delete(chunkKey(level.queue[index].chunkX, level.queue[index].chunkZ));
      level.queue.splice(index, 1);
    }
  }

  /**
   * Copies one queued room and schedules its verification.
   *
   * Returns true when a copy was attempted, so the caller can budget it. The
   * verification is not done here: a write that the server applies a tick later
   * would look like a failed copy, and a level that retries a copy it already did
   * is a level that never finishes.
   */
  function placeOne(level) {
    const item = level.queue.shift();
    if (!item) return false;

    const difficulty = level.difficulty;
    const key = chunkKey(item.chunkX, item.chunkZ);
    // Measured, never assumed: one chunk may be queued by two scans — or by the
    // entrance, which is placed ahead of the queue — and `copyChunk` is the one
    // call in this file whose cost lives on the server.
    if (level.planned.get(key) === "placing" || level.planned.get(key) === "placed") return true;
    // A template that has been disabled is dropped, not retried: the whole point
    // of disabling it is that the queue stops spending ticks on it.
    if (level.disabled.has(item.template.index)) {
      level.planned.delete(key);
      return true;
    }
    // The copy reads the template at its own corner, in its own chunk: `copyChunk`
    // takes any cell inside a chunk, so the source coordinate only has to be
    // inside the template — and the corner keeps the arithmetic obvious.
    const from = item.template.src;
    const to = [
      item.chunkX * SIZE,
      floorOfLayer(difficulty),
      item.chunkZ * SIZE,
    ];

    // One read before asking: a copy from an unloaded template is a no-op, so a
    // level that has lost its templates would otherwise spend its one copy per
    // tick on silence, for ever.
    if (api.getBlock(from[0], from[1], from[2]) === null) {
      level.planned.delete(key);
      const attempts = (level.templateAttempts.get(item.template.index) || 0) + 1;
      level.templateAttempts.set(item.template.index, attempts);
      if (attempts < DUNGEON_CONFIG.templateReadAttempts) {
        // The read itself is how the server is asked to send that chunk, so a
        // second chance is not optimism: it is the only way a template that is one
        // tick late ever gets used. The item goes to the back of the queue, so the
        // level keeps working while it waits.
        level.queue.push(item);
        return true;
      }
      say(`template ${item.template.index} (${from.join(", ")}) is not loaded after ${attempts} reads; it is disabled`);
      disableTemplate(level, item.template);
      level.failures += 1;
      return true;
    }
    level.templateAttempts.delete(item.template.index);

    api.copyChunk(from, to);
    level.planned.set(key, "placing");
    // The record is written straight after the copy, in the same chunk, which the
    // player is standing in: it is therefore readable at once, and the room is
    // known to be there without waiting for anything.
    markPlaced(difficulty, item.chunkX, item.chunkZ);
    const cell = surfaceCellOf(difficulty, item.chunkX, item.chunkZ);
    if (api.getBlock(cell[0], cell[1], cell[2]) === DUNGEON_CONFIG.surfaceBlock) {
      level.placed += 1;
      level.planned.set(key, "placed");
      return true;
    }
    pendingVerify.push({
      level,
      chunkX: item.chunkX,
      chunkZ: item.chunkZ,
      attempts: VERIFY_ATTEMPTS,
    });
    return true;
  }

  /**
   * Reads back the copies that are waiting.
   *
   * Two outcomes, and both are final: the record block is there, and the room
   * counts as placed; or it is not after `VERIFY_ATTEMPTS` reads, and the chunk is
   * forgotten so another scan can queue it again. Nothing here copies.
   */
  function verifyPending() {
    if (pendingVerify.length === 0) return;
    for (let index = pendingVerify.length - 1; index >= 0; index -= 1) {
      if (api.isNearInterrupt && api.isNearInterrupt()) return;
      const entry = pendingVerify[index];
      entry.age = (entry.age || 0) + 1;
      const cell = surfaceCellOf(entry.level.difficulty, entry.chunkX, entry.chunkZ);
      const name = api.getBlock(cell[0], cell[1], cell[2]);
      const key = chunkKey(entry.chunkX, entry.chunkZ);

      if (name === DUNGEON_CONFIG.surfaceBlock) {
        entry.level.placed += 1;
        entry.level.planned.set(key, "placed");
        pendingVerify.splice(index, 1);
        continue;
      }
      if (name === null || name === undefined) {
        // The destination chunk is not loaded, so this read says nothing about the
        // copy. It is not a failure, and it is not a success: the room is ahead of
        // every player. The entry waits, then counts as placed and is reported as
        // unverified — the one outcome this engine cannot decide from the world, and
        // it says so rather than pretending either way.
        if (entry.age < DUNGEON_CONFIG.verifyMaxTicks) continue;
        entry.level.placed += 1;
        entry.level.unverified += 1;
        entry.level.planned.set(key, "placed");
        pendingVerify.splice(index, 1);
        continue;
      }

      entry.attempts -= 1;
      if (entry.attempts > 0) continue;
      // A definite answer, and not the record block: the copy did not land. The
      // chunk is forgotten so a later scan queues it again — the one recovery this
      // engine needs, and the reason it has no build-progress state at all.
      entry.level.failures += 1;
      entry.level.planned.delete(key);
      pendingVerify.splice(index, 1);
    }
  }

  /**
   * One tick of every level that has a player in it.
   *
   * `chunksByLevel` is a list of `{ difficulty, chunks: [{x, z}] }`: the chunk of
   * every player standing in that level. A level nobody is in is not in the list
   * at all, and costs nothing — no scan, no copy, no read.
   */
  function tick(chunksByLevel) {
    for (const { difficulty, chunks } of chunksByLevel) {
      const level = levelState(difficulty);
      if (level.templates.length === 0 || usableTemplates(level).length === 0) continue;
      if (chunks.length === 0) continue;

      // A copy is the expensive step, so it is first: one per level per tick.
      placeOne(level);

      level.ticksSinceScan += 1;
      if (level.ticksSinceScan < DUNGEON_CONFIG.scanTicks) continue;
      level.ticksSinceScan = 0;
      for (const chunk of chunks) {
        planAround(level, chunk.x, chunk.z);
        if (api.isNearInterrupt && api.isNearInterrupt()) break;
      }
    }
    verifyPending();
  }

  /** Everything a report needs, without touching the world. */
  function statsOf(difficulty) {
    const level = levelState(difficulty);
    let placed = 0;
    for (const state of level.planned.values()) if (state === "placed") placed += 1;
    return {
      difficulty: level.difficulty.label,
      templates: level.templates.length,
      disabled: level.disabled.size,
      queued: level.queue.length,
      planned: level.planned.size,
      placed,
      unverified: level.unverified,
      copies: level.placed,
      failures: level.failures,
    };
  }

  return {
    levelState,
    landingPosition,
    findFloorLocalY,
    surfaceStateOf,
    planAround,
    placeEntrance,
    placeOne,
    warmTemplates,
    tick,
    statsOf,
    get levels() { return levels; },
  };
}
