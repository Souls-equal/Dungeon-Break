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
   * What a chunk says about itself, from one cell on each of its two Bedrock layers.
   *
   * The cell is the middle of the chunk — the same cell a player lands next to and
   * the same one a room's Concrete pad occupies. Three answers, and they are the
   * whole state machine of this engine:
   *
   *   - `loaded: false` — the read returned `null`, so the chunk has not been sent.
   *     The read itself is the request: the server creates it, and it is ready
   *     `chunkLoadTicks` later;
   *   - `occupied: true` — the cell reads **Bedrock**, the shell every room has on
   *     its floor and its ceiling. A room is there. This is the owner's rule, and it
   *     is deliberately *only* Bedrock: any other block at that depth is terrain the
   *     world already had, not a room, and counting it as one would make the engine
   *     skip a copy and leave a player with nothing to land on;
   *   - `occupied: false` — the chunk is here and the cell is not Bedrock. If it is
   *     Air, the slot is free; if it is anything else, it is ground, and a room is
   *     copied over it.
   *
   * Both layers are read, bottom first, so a room built without its ceiling still
   * proves itself with its floor.
   */
  function probeChunk(chunkX, chunkY, chunkZ) {
    const [localX, localZ] = DUNGEON_CONFIG.probeLocalXZ;
    const x = chunkX * SIZE + localX;
    const z = chunkZ * SIZE + localZ;
    let loaded = false;
    for (const localY of DUNGEON_CONFIG.probeLocalYs) {
      const name = readCell(x, chunkY * SIZE + localY, z);
      if (name === null) continue;
      loaded = true;
      if (name === DUNGEON_CONFIG.solidBlock) return { loaded, occupied: true };
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
   * Chunk-local Y of a room's floor, found by walking up the middle column of a
   * template.
   *
   * Any template may answer: a room whose chunk is not sent yet costs a `null` read
   * and the next one is tried, instead of the whole level being refused because the
   * first coordinate in the list is the one that happens to be unreadable. The floor
   * sits at the same height in every room a builder makes — it is the room's own
   * build — so the first readable one is the answer, and it is cached.
   *
   * `null` means no template answered: the level cannot be built, and the caller
   * says so with a coordinate to check rather than dropping the player into the void.
   */
  function findFloorLocalY(level) {
    if (level.floorLocalY !== null) return level.floorLocalY;
    const templates = usableTemplates(level);
    for (const probe of templates) {
      const baseY = Math.floor(probe.src[1] / SIZE) * SIZE;
      const baseX = Math.floor(probe.src[0] / SIZE) * SIZE;
      const baseZ = Math.floor(probe.src[2] / SIZE) * SIZE;
      // The middle column: that is where every room has its floor, and it is the
      // column the player lands on.
      const [localX, localZ] = DUNGEON_CONFIG.probeLocalXZ;
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
   * The one sentence a player needs when the entrance never arrived.
   *
   * Built from `explainEntrance`, and ordered by what a builder can do about it:
   * a template that is not loaded is a coordinate to check, a destination that is
   * already a room is a level to reset, and a floor that cannot be found is a room
   * with no floor to land on.
   */
  function entranceFailureMessage(difficulty) {
    const info = explainEntrance(difficulty);
    if (info.templateIndex === null) return "This level has no readable room template.";
    if (info.templateSource === null) {
      return `Room #${info.templateIndex} is not loaded: check its chunk ${info.templateChunk.join(",")}.`;
    }
    if (!info.occupied && info.bottomName === null) {
      return "The entrance chunk could not be loaded.";
    }
    if (info.occupied) {
      return "The entrance chunk already holds a room, so nothing was copied into it.";
    }
    if (info.floorLocalY === null) {
      return "No floor could be read in the room template: /dbg templates.";
    }
    return `The copy did not land: Bedrock ${info.bottomName} / ${info.topName} at the destination.`;
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
   * What the engine thinks of the entrance's chunk, in words a builder can act on.
   *
   * A copy that never lands has a small number of causes, and a screenshot of the
   * error message says none of them. This reads the entrance chunk exactly as the
   * engine does and names the case — it is a diagnostic, so it reads and writes
   * nothing beyond the probe.
   */
  function explainEntrance(difficulty) {
    const level = levelState(difficulty);
    const chunkX = DUNGEON_CONFIG.originChunkX;
    const chunkZ = DUNGEON_CONFIG.originChunkZ;
    const chunkY = difficulty.chunkY;
    const [localX, localZ] = DUNGEON_CONFIG.probeLocalXZ;
    const probe = probeChunk(chunkX, chunkY, chunkZ);
    const bottom = readCell(chunkX * SIZE + localX, chunkY * SIZE, chunkZ * SIZE + localZ);
    const top = readCell(chunkX * SIZE + localX, chunkY * SIZE + SIZE - 1, chunkZ * SIZE + localZ);
    const template = usableTemplates(level)[0];
    return {
      chunkX,
      chunkY,
      chunkZ,
      loaded: probe.loaded,
      occupied: probe.occupied,
      bottomName: bottom,
      topName: top,
      templateIndex: template ? template.index : null,
      templateChunk: template ? template.chunk : null,
      templateSource: template ? readCell(template.src[0], template.src[1], template.src[2]) : null,
      floorLocalY: level.floorLocalY,
      disabled: level.disabled.size,
      failures: level.failures,
    };
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
    explainEntrance,
    entranceFailureMessage,
    planAround,
    placeEntrance,
    placeOne,
    warmTemplates,
    tick,
    statsOf,
    get levels() { return levels; },
  };
}
