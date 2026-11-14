/*
 * The core: one room per tick, copied whole.
 *
 * Everything this file does is a consequence of three facts:
 *
 *   1. `api.copyChunk(fromPos, toPos)` copies a whole 32x32x32 chunk in one call,
 *      and its documentation names the use case — "storing 'template' chunks that
 *      can be continuously copied to a new position". Measured in game: the copy
 *      itself is done within a tick.
 *
 *   2. "NOTE: Does nothing if the source chunk is not loaded." A copy from an
 *      unloaded chunk is not an error, it is silence — so both ends are checked
 *      rather than assumed.
 *
 *   3. A `getBlock` in a chunk the server has not sent *is* the request for it, and
 *      the chunk is ready two ticks later. That single behaviour replaces every
 *      wait, every timer and every retry loop this file used to need.
 *
 * **Nothing is ever written into a chunk.** Not a marker, not a pad, not a repair.
 * The record a room carries is its own **Bedrock** floor and ceiling, which the
 * builder placed and the copy carries; the engine only reads it. That is what makes
 * a room recognisable after a restart, and it is the only state a room has.
 *
 * There is no state per room, no cursor, no resumable build, no progress record,
 * no shard, no index. A room is a chunk whose Bedrock floor is there, or a chunk
 * whose Bedrock floor is not there. Nothing in between exists, which is what makes
 * the whole thing small enough to trust.
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
        /** Ticks this level has been running, for the load and verify delays. */
        tick: 0,
        templates: templatesFor(difficulty, say),
        /** Templates whose source chunk cannot be read: never retried. */
        disabled: new Set(),
        /** Template id → how many times its source block read as `null`. */
        templateAttempts: new Map(),
        /** chunkX|chunkZ → "queued" | "placing" | "placed". Bounded to the view. */
        planned: new Map(),
        /** chunkX|chunkZ → first tick a copy into it may land. Bounded to the view. */
        ready: new Map(),
        /** chunkX|chunkZ → tick of the copy, until a probe sees the room. */
        placingSince: new Map(),
        /** Ordered work: the next chunk to copy. */
        queue: [],
        /** Rooms the world itself showed as built, this session. */
        placed: 0,
        failures: 0,
        ticksSinceScan: DUNGEON_CONFIG.scanTicks,
        /** Chunk-local Y of the templates' floor, found once per level. */
        floorLocalY: null,
        /** Levels the shipped templates were already requested for. */
        warmed: false,
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
   * What one cell of a chunk says: a block name, or `null` when it says nothing.
   *
   * `null` is the server telling us the chunk is not here **yet** — and the read
   * itself is what asks for it. That is the whole loading mechanism: one read, then
   * `chunkLoadTicks` later the chunk exists.
   */
  function readCell(x, y, z) {
    const name = api.getBlock(x, y, z);
    return name === undefined ? null : name;
  }

  /**
   * What a chunk says about itself, from its two Bedrock layers.
   *
   * Every room has Bedrock on its first and its last layer — floor and ceiling,
   * like the Nether — so a handful of readings answers everything this engine needs
   * to know about a chunk:
   *
   *   - `loaded: false` — every probed cell read `null`, the chunk has not been
   *     sent. The read itself is the request, so the caller asks and comes back;
   *   - `occupied: false` — the chunk is here and one of its layers reads `Air`:
   *     nothing was built in it, it is a free slot;
   *   - `occupied: true` — a block other than Air is there. In a room built the way
   *     the project builds them, that block is the Bedrock of a floor or a ceiling.
   *
   * Both layers are probed, and both the first and the last, for one reason: the
   * rule the owner gave is "if a layer has no Bedrock, just check the block is not
   * Air". A room whose floor has no Bedrock is still a real room, and its ceiling
   * still proves it is there.
   *
   * Four columns are tried per layer because a room is free to keep its centre
   * open. The loop stops at the first cell that answers, so a normal room costs one
   * read and a free slot costs one per column, once.
   */
  function probeChunk(chunkX, chunkY, chunkZ) {
    const baseX = chunkX * SIZE;
    const baseY = chunkY * SIZE;
    const baseZ = chunkZ * SIZE;
    let loaded = false;
    for (const localY of DUNGEON_CONFIG.probeLocalYs) {
      for (const [localX, localZ] of DUNGEON_CONFIG.probeLocalXZ) {
        const name = readCell(baseX + localX, baseY + localY, baseZ + localZ);
        if (name === null) continue;
        loaded = true;
        if (name !== "Air") return { loaded, occupied: true };
      }
    }
    return { loaded, occupied: false };
  }

  /**
   * Has this chunk a room in it?
   *
   * The question the engine used to answer with a marker block it wrote itself.
   * It is answered here by the room's own Bedrock, which the builder placed and the
   * copy carries: nothing is written, and a room copied in a previous session is
   * still recognised.
   *
   * Two consequences worth stating:
   *
   *   - a chunk that does not answer is **empty as far as we know**; the caller
   *     asks for it and comes back two ticks later rather than guessing;
   *   - the answer is about the world, not about this session's memory, so a level
   *     that has forgotten its rooms asks the world and finds them.
   */
  function roomInChunk(level, chunkX, chunkZ) {
    return probeChunk(chunkX, level.difficulty.chunkY, chunkZ).occupied;
  }

  /**
   * Records when a copy into this chunk may land.
   *
   * The probe that just ran is the request: if the chunk answered, `level.tick` is
   * enough; if it did not, the server was asked and needs `chunkLoadTicks` more.
   * `placeOne` refuses to copy before that tick, which is the only guard this engine
   * needs against `copyChunk`'s silent no-op.
   */
  function markReadyAt(level, chunkX, chunkZ, loaded) {
    const readyAt = loaded ? level.tick : level.tick + DUNGEON_CONFIG.chunkLoadTicks;
    level.ready.set(chunkKey(chunkX, chunkZ), readyAt);
  }

  /**
   * Has this chunk of this level been dealt with?
   *
   * `planned` is the session's short memory — queued, being copied, placed — and it
   * is what keeps a scan every four ticks from queueing the same chunk twice. It is
   * **not** what decides whether a room is built: the world decides that, with the
   * Bedrock probe, so this can forget without cost.
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
    for (const [localX, localZ] of DUNGEON_CONFIG.probeLocalXZ) {
      for (let cell = 0; cell < DUNGEON_CONFIG.floorProbeMaxCells; cell += 1) {
        const name = readCell(baseX + localX, baseY + cell, baseZ + localZ);
        if (name === null) break;
        // Bedrock is the room's own shell, not the floor a player stands on: every
        // room has one under the floor and one over the ceiling, so skipping it is
        // what makes this a floor probe instead of a "first solid block" probe.
        if (name === "Air" || name === DUNGEON_CONFIG.solidBlock) continue;
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

    const keep = (key, reach) => {
      const separator = key.indexOf("|");
      const x = Number(key.slice(0, separator));
      const z = Number(key.slice(separator + 1));
      return Math.abs(x - playerChunkX) <= reach && Math.abs(z - playerChunkZ) <= reach;
    };

    for (const key of level.planned.keys()) {
      const reach = level.planned.get(key) === "placed" ? doneReach : pendingReach;
      if (!keep(key, reach)) level.planned.delete(key);
    }
    // The two clocks are bounded by the same ring: a probe writes one entry per
    // candidate chunk, and a player who walks for an hour must not leave a trail of
    // them behind.
    for (const key of level.ready.keys()) {
      if (!keep(key, pendingReach)) level.ready.delete(key);
    }
    for (const key of level.placingSince.keys()) {
      if (!keep(key, doneReach)) level.placingSince.delete(key);
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

      // Two questions, one probe. "Is the chunk sent?" and "is there already a
      // room in it?" are answered by the same Bedrock reading, so a scan costs one
      // `getBlock` per candidate and nothing else.
      const probe = probeChunk(x, level.difficulty.chunkY, z);
      // The probe is also the request: `ready` now holds the first tick a copy may
      // land, whether the chunk answered or has to be sent first.
      markReadyAt(level, x, z, probe.loaded);
      if (!probe.loaded) {
        // Not sent: the world catches up in `chunkLoadTicks`, and the chunk is
        // picked up by the next scan. No timer, no poll, no retry loop.
        continue;
      }
      if (probe.occupied) {
        // A room is already there — from this session or from a previous one. This
        // is the whole benefit of the Bedrock record: a level no longer rebuilds
        // what it finds, and no marker has to be written to know it.
        level.planned.set(key, "placed");
        continue;
      }

      level.planned.set(key, "queued");
      level.queue.push({ chunkX: x, chunkZ: z, template });
      planned += 1;
    }
  }

  /**
   * Asks the server to send the template chunks, before they are needed.
   *
   * One read per template chunk, once. The read is the request: a cell in an unsent
   * chunk returns `null` and makes the server send it, ready `chunkLoadTicks` later.
   * Doing it when a level starts gives the first copies something to read, which is
   * the only reason this exists — the loading itself is not special-cased anywhere.
   */
  function warmTemplates(difficulty) {
    const level = levelState(difficulty);
    if (level.warmed) return 0;
    level.warmed = true;
    const seen = new Set();
    for (const template of level.templates) {
      const key = `${Math.floor(template.src[0] / SIZE)}`
        + `|${Math.floor(template.src[1] / SIZE)}|${Math.floor(template.src[2] / SIZE)}`;
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
    // A player who dies, leaves and comes back must not trigger a second copy of the
    // same room, and neither must a restart: the room's own Bedrock answers for it.
    // Only a chunk whose room is really absent is queued — and if it has not been
    // sent yet, the probe that asks is the same one, so the copy simply waits a
    // couple of ticks.
    if (isPlaced(level, originX, originZ) || roomInChunk(level, originX, originZ)) {
      level.planned.set(key, "placed");
      return template;
    }
    level.planned.delete(key);
    // The entrance is placed by hand, ahead of the queue, so its load starts here.
    // The probe just answered `Air`, which means the chunk is there and a copy can
    // land in the same tick.
    markReadyAt(level, originX, originZ, true);
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
   * Copies one queued room, or drops it because there is nothing to do.
   *
   * Three things can be true of a queued chunk, and none of them is retried in a
   * loop:
   *
   *   - **its destination is not ready** — the server was asked for the chunk by a
   *     probe, and it answers `chunkLoadTicks` later. The entry goes back to the end
   *     of the queue, and the level keeps building elsewhere meanwhile;
   *   - **its template cannot be read** — `copyChunk` would do nothing, silently.
   *     Read, count, and after `templateReadAttempts`, disable it and say so;
   *   - **both ends answer** — one `copyChunk`, done within the tick.
   *
   * What a copy cannot do is confirm itself. Nothing is written that could be read
   * back, so a copied room is counted as **in flight** until a probe sees its
   * Bedrock; the count is reported separately from `placed`, which is what the
   * world actually shows.
   */
  function placeOne(level) {
    const item = level.queue.shift();
    if (!item) return false;

    const difficulty = level.difficulty;
    const key = chunkKey(item.chunkX, item.chunkZ);
    // One chunk may be queued twice — by two scans, or by the entrance ahead of the
    // queue — and `copyChunk` is the one call in this file whose cost lives on the
    // server.
    if (level.planned.get(key) === "placing" || level.planned.get(key) === "placed") return true;
    // A template that has been disabled is dropped, not retried: the whole point
    // of disabling it is that the queue stops spending ticks on it.
    if (level.disabled.has(item.template.index)) {
      level.planned.delete(key);
      return true;
    }

    // The destination first: a copy into a chunk that has not been sent is dropped
    // without an error, and the room is simply missing. The probe that queued it is
    // the request that loads it, so the only question is whether it has had the time.
    const readyAt = level.ready.get(key);
    if (readyAt === undefined || level.tick < readyAt) {
      level.planned.delete(key);
      level.queue.push(item);
      return true;
    }
    level.ready.delete(key);

    // The copy reads the template at its own corner, in its own chunk: `copyChunk`
    // takes any cell inside a chunk, so the source coordinate only has to be
    // inside the template — and the corner keeps the arithmetic obvious.
    const from = item.template.src;
    const to = [
      item.chunkX * SIZE,
      floorOfLayer(difficulty),
      item.chunkZ * SIZE,
    ];

    if (readCell(from[0], from[1], from[2]) === null) {
      level.planned.delete(key);
      const attempts = (level.templateAttempts.get(item.template.index) || 0) + 1;
      level.templateAttempts.set(item.template.index, attempts);
      if (attempts < DUNGEON_CONFIG.templateReadAttempts) {
        // The read itself is how the server is asked to send that chunk, so a
        // second chance is not optimism: it is the only way a template that is a
        // couple of ticks late ever gets used. Back of the queue, so the level keeps
        // working while it waits.
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
    level.placingSince.set(key, level.tick);
    return true;
  }

  /**
   * Reads the rooms this level copied and has not seen yet.
   *
   * A copy is done within a tick, but what the world shows is only what the server
   * has applied — so the check happens on the **next** tick, never in the tick of
   * the copy. That is the whole difference between counting a request and counting
   * a room.
   *
   * A room still unseen after `chunkLoadTicks` is truly missing: the entry is
   * dropped and the next scan queues it again, one copy away. This is not a retry
   * loop — the scan is the retry, and it is the same scan that builds everything
   * else.
   */
  function verifyCopied(level) {
    for (const [key, state] of level.planned) {
      if (state !== "placing") continue;
      const since = level.placingSince.get(key);
      // A copy made this very tick has not been applied yet: asking now would count
      // a room as missing because the answer arrived too early.
      if (since === undefined || level.tick <= since) continue;

      const separator = key.indexOf("|");
      const chunkX = Number(key.slice(0, separator));
      const chunkZ = Number(key.slice(separator + 1));
      if (roomInChunk(level, chunkX, chunkZ)) {
        level.planned.set(key, "placed");
        level.placed += 1;
        level.placingSince.delete(key);
        continue;
      }
      if (level.tick - since < DUNGEON_CONFIG.chunkLoadTicks) continue;
      level.planned.delete(key);
      level.placingSince.delete(key);
      level.failures += 1;
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

      level.tick += 1;

      // What the world already shows, then one copy: the check costs one read for
      // the rooms in flight, and a copy is the expensive step, so it is budgeted.
      verifyCopied(level);
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

  /**
   * Everything a report needs, without touching the world.
   *
   * `inView` is what this level currently knows about, counted as the world shows
   * it: rooms found by their Bedrock, plus those still in flight. `placed` is the
   * total the world confirmed, `inFlight` those copied but not seen yet.
   */
  function statsOf(difficulty) {
    const level = levelState(difficulty);
    let placedInView = 0;
    let inFlight = 0;
    for (const state of level.planned.values()) {
      if (state === "placed") placedInView += 1;
      if (state === "placing") inFlight += 1;
    }
    return {
      difficulty: level.difficulty.label,
      templates: level.templates.length,
      disabled: level.disabled.size,
      queued: level.queue.length,
      planned: level.planned.size,
      placedInView,
      placed: level.placed,
      inFlight,
      loading: level.ready.size,
      failures: level.failures,
    };
  }

  return {
    levelState,
    landingPosition,
    findFloorLocalY,
    isPlaced,
    probeChunk,
    planAround,
    placeEntrance,
    placeOne,
    warmTemplates,
    tick,
    statsOf,
    get levels() { return levels; },
  };
}
