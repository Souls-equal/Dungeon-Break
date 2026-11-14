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
 *      unloaded template is not an error, it is silence. A template is therefore
 *      read once before it is used, and one that fails the check is disabled for
 *      the session instead of being retried for ever.
 *
 * The queue is a consequence of a third fact: the engine writes nothing into a
 * room, so it cannot ask the world whether a room is already there. Planning
 * therefore happens only around players — never in the abstract — and the level
 * remembers for the session what it copied.
 *
 * There is no state per room, no cursor, no resumable build, no progress record,
 * no shard, no index. A room is a chunk that was copied, or a chunk that was not.
 * Nothing in between exists, which is what makes the whole thing small enough to
 * trust.
 */

import { DUNGEON_CONFIG, floorOfLayer } from "./config.js";
import { templateFor, templatesFor } from "./templates.js";

const SIZE = DUNGEON_CONFIG.chunkSize;

export function chunkKey(chunkX, chunkZ) {
  return `${chunkX}|${chunkZ}`;
}

/** The chunk a world cell falls in. */
export function chunkOfWorld(x, z) {
  return { x: Math.floor(x / SIZE), z: Math.floor(z / SIZE) };
}

export function createLoader({ api, log }) {
  const say = log || (() => {});
  /** Per level state, created on first use and never rebuilt. */
  const levels = new Map();
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
        /** Copies made without any way to read them back — see `isPlaced`. */
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
   * Is the destination of a copy loaded?
   *
   * The one question this engine still has to ask, because a copy into a chunk the
   * server has not sent is dropped without an error. It is answered with
   * `isBlockInLoadedChunk`, which **reads and writes nothing** — the alternative,
   * reading a block of the room, would work too but returns `null` for a chunk that
   * is merely not sent yet, and would make the scan take a decision on an absence.
   *
   * No API is assumed: a host that does not provide the function is treated as
   * "loaded", so the engine degrades to "copy and hope" instead of not building.
   */
  function isDestinationLoaded(difficulty, chunkX, chunkZ) {
    if (typeof api.isBlockInLoadedChunk !== "function") return true;
    return api.isBlockInLoadedChunk(chunkX * SIZE, floorOfLayer(difficulty), chunkZ * SIZE) === true;
  }

  /**
   * Has this chunk of this level been copied in this session?
   *
   * The only available answer, because the engine writes nothing into a room: no
   * record block to read back, and a copied room looks exactly like an uncopied
   * one from the world's point of view. So the level remembers what it copied, and
   * says so honestly — `/dbg mem` counts these as "unconfirmed".
   *
   * What that costs, and why it is acceptable: after a restart, or when a player
   * walks back into a room copied during another session, the level has forgotten
   * the room and will copy it again. A copy is idempotent — it writes the same
   * blocks over the same cells — so the cost is one `copyChunk`, not a bug.
   */
  function isPlaced(level, chunkX, chunkZ) {
    return level.planned.get(chunkKey(chunkX, chunkZ)) === "placed";
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
      // Only a chunk the server has sent. Nothing is written into a room to
      // recognise it later, and a copy into an unloaded chunk is dropped in silence,
      // so this is the one check that keeps a scan from queueing work that cannot
      // happen.
      if (!isDestinationLoaded(level.difficulty, x, z)) continue;

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
    // Not copied twice in the same session: an entrance is placed on every entry
    // into the level, and a player who dies, leaves and comes back must not trigger
    // a second copy of the same room. Across sessions the room is copied again, and
    // that is harmless: the same blocks land on the same cells.
    if (isPlaced(level, originX, originZ)) {
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
    // Counted as placed at once, because there is nothing to read back: the engine
    // writes no record into a room, and a copied room is indistinguishable from an
    // uncopied one. The `unverified` counter says exactly this, and `/dbg mem`
    // reports it rather than letting the number look like a proof.
    level.placed += 1;
    level.unverified += 1;
    level.planned.set(key, "placed");
    return true;
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
    isPlaced,
    planAround,
    placeEntrance,
    placeOne,
    warmTemplates,
    tick,
    statsOf,
    get levels() { return levels; },
  };
}
