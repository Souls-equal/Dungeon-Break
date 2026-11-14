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

import { DUNGEON_CONFIG, floorOfLayer, mobTuningFor } from "./config.js";
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
  /**
   * One state per **entry**, not per level.
   *
   * A dungeon is built at a place drawn for the player who enters it, so two players
   * in the same difficulty are in two different dungeons: their plans, their queues
   * and their copies are separate. The key is the entry id — a player id, or
   * `"-" + difficulty.id` for a level driven without players — and `claimOrigin`
   * prefers the player's own previous state when it draws.
   *
   * What is shared by all entries of a difficulty: the templates (one list) and the
   * templates found unreadable (disabled for the session, which is a fact about the
   * template, not about a dungeon).
   */
  const states = new Map();
  /** difficulty.id → where the last entry of that difficulty was built. */
  const lastOrigins = new Map();
  /** Entry ids made of a player: the ones `release` can give back. */
  const entryOf = (id) => String(id === undefined || id === null ? "-" : id);

  function newState(difficulty, entryId) {
    return {
      entryId,
      difficulty,
      /** Ticks this dungeon has been running, for the load and verify delays. */
      tick: 0,
      templates: templatesFor(difficulty, say),
      /** Templates whose source chunk cannot be read: never retried, session-wide. */
      disabled: disabledTemplates(difficulty),
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
      /** Rooms the world itself showed as built, this dungeon. */
      placed: 0,
      failures: 0,
      ticksSinceScan: DUNGEON_CONFIG.scanTicks,
      /** Where this dungeon is built. Every entry draws a new place. */
      origin: null,
      /** The template the entrance chunk got, copied once. */
      entrance: null,
      /** Landing positions already handed out, "x,z", for this dungeon's life. */
      landings: new Set(),
      /** chunkX|chunkZ → the mobs spawned in that room, `null` while the game catches up. */
      mobs: new Map(),
      /** Rooms that have been asked for mobs, so one room is never populated twice. */
      populated: new Set(),
      /** Mob types the game refused, with the reason: never tried again this session. */
      refusedMobs: new Map(),
      /** Mob type → how many times a spawn answered nothing, to tell a full world from a bad name. */
      mobRefusals: new Map(),
      /** Mob type → refusals counted before the current room, to judge a room at a time. */
      mobRefusalsAtRoomStart: new Map(),
      /** Mobs whose stats are still to be applied: a spawn is async, the id is not ready. */
      pendingTuning: [],
      /** Was this difficulty's template set already requested? */
      warmed: false,
    };
  }

  /**
   * The state a call is about.
   *
   * With an entry id it is **that entry's** dungeon, created on demand. Without one
   * the callers that predate per-entry dungeons get the most recent entry of the
   * difficulty — which is what a report, a rescue or a manual entry mean.
   */
  function levelState(difficulty, entryId) {
    const id = entryOf(entryId === undefined ? null : entryId);
    if (entryId !== undefined && entryId !== null) {
      let state = states.get(id);
      if (!state || state.difficulty.id !== difficulty.id) {
        state = newState(difficulty, id);
        states.set(id, state);
      }
      return state;
    }
    if (lastOrigins.has(difficulty.id)) return lastOrigins.get(difficulty.id);
    const state = newState(difficulty, "-" + difficulty.id);
    states.set(state.entryId, state);
    lastOrigins.set(difficulty.id, state);
    return state;
  }

  /** Remembers which entry a difficulty is currently being played in. */
  function remember(difficulty, state) {
    lastOrigins.set(difficulty.id, state);
  }

  /**
   * Templates a difficulty may no longer use, session-wide.
   *
   * A template that cannot be read is not a property of one dungeon: it is a
   * coordinate, and every entry of the level would spend its copies on the same
   * silence. Disabling it once is the whole point.
   */
  const disabledByDifficulty = new Map();
  function disabledTemplates(difficulty) {
    let set = disabledByDifficulty.get(difficulty.id);
    if (!set) {
      set = new Set();
      disabledByDifficulty.set(difficulty.id, set);
    }
    return set;
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

  /** A chunk coordinate drawn inside the cube every entry builds in. */
  function drawOrigin() {
    const spanX = DUNGEON_CONFIG.spawnChunkMax - DUNGEON_CONFIG.spawnChunkMin + 1;
    const spanY = DUNGEON_CONFIG.spawnChunkYMax - DUNGEON_CONFIG.spawnChunkYMin + 1;
    return {
      x: DUNGEON_CONFIG.spawnChunkMin + Math.floor(Math.random() * spanX),
      y: DUNGEON_CONFIG.spawnChunkYMin + Math.floor(Math.random() * spanY),
      z: DUNGEON_CONFIG.spawnChunkMin + Math.floor(Math.random() * spanX),
    };
  }

  /**
   * Gives a dungeon a place, and keeps it away from the other dungeons.
   *
   * **Every entry draws a new place.** That is what makes two players certain not to
   * meet: the square is 200 000 blocks across and a view is 96 blocks wide, so the
   * only way to meet is to draw the same spot twice — which is checked, not hoped.
   *
   * The check is against the origins of every dungeon that exists right now, and the
   * distance is measured between chunk coordinates, in **all three directions** —
   * x, y and z. Height counts like the rest: a room fills its chunk, so two dungeons
   * 20 000 blocks apart vertically are as far as two 20 000 blocks apart on the map. A dungeon that already has a place keeps it — calling this twice
   * must not move a player's rooms. A fresh place is asked for by `newOrigin`.
   *
   * `spawnSeparation` is a floor, not a theorem: past a few hundred simultaneous
   * players the draws run out and the farthest candidate wins, because a player
   * waiting in the air is worse than two dungeons that are merely far apart. The
   * clean-up is the game's own, as the owner of the project put it: the map clears
   * itself.
   */
  function claimOrigin(difficulty, entryId) {
    const state = levelState(difficulty, entryId);
    if (state.origin) return state.origin;

    const separationChunks = Math.ceil(DUNGEON_CONFIG.spawnSeparation / SIZE);
    // Every dungeon that exists right now. A dungeon whose player left was released
    // and is not in this list, so its place may be drawn again — which is what keeps
    // the square usable after a few hundred entries.
    const others = [];
    for (const other of states.values()) {
      if (other === state || !other.origin) continue;
      others.push(other.origin);
    }

    let best = null;
    let bestDistance = -1;
    for (let draw = 0; draw < DUNGEON_CONFIG.spawnDraws; draw += 1) {
      const candidate = drawOrigin();
      let nearest = Infinity;
      for (const other of others) {
        nearest = Math.min(nearest, Math.max(
          Math.abs(other.x - candidate.x),
          Math.abs(other.y - candidate.y),
          Math.abs(other.z - candidate.z),
        ));
      }
      if (nearest >= separationChunks) {
        best = candidate;
        break;
      }
      if (nearest > bestDistance) {
        best = candidate;
        bestDistance = nearest;
      }
    }
    state.origin = best;
    remember(difficulty, state);
    return best;
  }

  /** Has this dungeon already got a place? Calling it twice must not draw again. */
  function hasOrigin(difficulty, entryId) {
    return Boolean(levelState(difficulty, entryId).origin);
  }

  /**
   * Gives a dungeon a new place on request.
   *
   * Used by an entry that wants a fresh dungeon for the same player — the pad to the
   * same difficulty, or a re-entry after leaving. Nothing is deleted: the old rooms
   * stay where they are and are never visited again.
   */
  function newOrigin(difficulty, entryId) {
    const state = levelState(difficulty, entryId);
    state.origin = null;
    state.landings.clear();
    state.entrance = null;
    return claimOrigin(difficulty, entryId);
  }

  /** Forgets a dungeon entirely: what a player leaving gives up. */
  function release(difficulty, entryId) {
    const id = entryOf(entryId);
    const state = states.get(id);
    if (!state) return;
    states.delete(id);
    if (lastOrigins.get(difficulty.id) === state) lastOrigins.delete(difficulty.id);
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
    return probeChunk(chunkX, level.origin.y, chunkZ).occupied;
  }

  /**
   * Is this room already cleared?
   *
   * The record is **in the room**, in the corner block of its bottom layer, written with
   * `setBlockData` — so it survives a restart, a relog and a walk away, and it is the
   * world that answers instead of our memory. `setBlockData` stores data about a block;
   * it does not write a block, which is why it is allowed at all.
   *
   * A room whose cell answers nothing is not cleared: an old room, a fresh copy, or a
   * block that has been replaced all read `null`.
   */
  function isRoomClear(level, chunkX, chunkZ) {
    const [localX, localY, localZ] = DUNGEON_CONFIG.mobClearCell;
    const data = api.getBlockData(chunkX * SIZE + localX, floorOfLayer(level.origin.y) + localY, chunkZ * SIZE + localZ);
    return Boolean(data && data.clear);
  }

  /** Writes the record of a cleared room. Idempotent, and cheap enough to repeat. */
  function markRoomClear(level, chunkX, chunkZ) {
    const [localX, localY, localZ] = DUNGEON_CONFIG.mobClearCell;
    api.setBlockData(
      chunkX * SIZE + localX,
      floorOfLayer(level.origin.y) + localY,
      chunkZ * SIZE + localZ,
      { clear: true },
    );
  }

  /** Kills every mob of a dungeon: called when its player leaves, so nothing is orphaned. */
  function forgetMobs(level) {
    for (const roomKey of Array.from(level.mobs.keys())) {
      const [x, z] = roomKey.split("|").map(Number);
      despawnRoomMobs(level, x, z);
    }
    level.mobs.clear();
  }

  /** Kills the mobs of a room without waiting for them to die. */
  function despawnRoomMobs(level, chunkX, chunkZ) {
    const key = chunkKey(chunkX, chunkZ);
    const mobs = level.mobs.get(key);
    if (!mobs) return 0;
    // Forgotten first: the game may call back into `mobGone` for each despawn, and a list
    // that is already gone cannot be walked twice.
    level.mobs.delete(key);
    for (const mobId of mobs) {
      try {
        api.despawnMob(mobId);
      } catch (_) {
        // A mob the game already removed is not an error worth stopping a tick for.
      }
    }
    return mobs.length;
  }

  /**
   * Records the mobs a room got, so a copy of this room can kill them later.
   *
   * `null` entries are kept on purpose: `attemptSpawnMob` returns before the mob exists,
   * so a spawn that answers nothing yet is not a failed spawn — it is a mob we cannot
   * name, and it is dropped when the room is cleared.
   */
  function trackRoomMobs(level, chunkX, chunkZ, mobIds) {
    level.mobs.set(chunkKey(chunkX, chunkZ), mobIds);
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
   * The **world Y** of the first block a player can stand on, in one column.
   *
   * Walked from the bottom of the chunk upward, taking the first cell that is
   * neither Air nor Bedrock — the room's own floor, and not the shell under it.
   * `null` means the column is not readable, or has nothing to stand on.
   *
   * It returns an absolute coordinate rather than a cell count, and that difference
   * is the bug this function used to carry: the landing was built as
   * `layerBottom + cellCount`, which is the copy's Y only while the template sits on
   * the grid the table claims. Measuring from the block that was actually read cannot
   * drift — the copy moves that block by `toY - sourceY`, and nothing else.
   */
  function floorBlockYAt(baseX, baseY, baseZ, localX, localZ) {
    for (let cell = 0; cell < DUNGEON_CONFIG.floorProbeMaxCells; cell += 1) {
      const y = baseY + cell;
      const name = readCell(baseX + localX, y, baseZ + localZ);
      // `null` is "the chunk is not sent", not "there is no floor": a room whose
      // columns are still loading must not be read as a room without a floor.
      if (name === null) return null;
      if (name === "Air" || name === DUNGEON_CONFIG.solidBlock) continue;
      return y;
    }
    return null;
  }

  /** Is this cell Air? A cell that cannot be read is not free, and not a yes. */
  function isAirCell(x, y, z) {
    return readCell(x, y, z) === "Air";
  }

  /**
   * Where a player lands in the entrance room, **tested where the player will be**.
   *
   * The height is no longer inferred from the floor. The previous versions computed a
   * number from the template and then trusted it — measured, corrected, recomputed from
   * the copy, and the player still came out inside the block. What this does instead is
   * the one thing that needs no theory: it asks the world whether the cell the player
   * would occupy is free, and moves the landing until it is.
   *
   * The sequence, and it is the owner's:
   *
   *   1. the landing is drawn inside `landingMargin`, on the floor of the room that was
   *      copied, `spawnAboveFloor` cells above it;
   *   2. the middle cell is tested, then the ring of cells around it — the two cells a
   *      standing player occupies (this one and the one above) must both be Air;
   *   3. if nothing in that ring works, the whole landing is lifted one block and the
   *      test runs again, `landingSearchLift` times;
   *   4. if every level is blocked, another column is drawn in the same chunk and the
   *      search starts over, `landingSearchTries` times.
   *
   * `null` means the entrance chunk cannot be read at all: the level cannot be built, and
   * the caller says so instead of dropping the player into the void.
   */
  function landingPosition(difficulty, entryId) {
    const level = levelState(difficulty, entryId);
    const origin = level.origin;
    if (!origin) return null;
    // The room is **known**, not drawn again: `placeEntrance` records the template it
    // copied, and drawing here could name a room that is not the one at that chunk.
    const template = level.entrance;
    if (!template) return null;

    const baseX = origin.x * SIZE;
    const baseY = floorOfLayer(origin.y);
    const baseZ = origin.z * SIZE;
    const [centreX, centreZ] = DUNGEON_CONFIG.probeLocalXZ;
    const margin = DUNGEON_CONFIG.landingMargin;
    const span = SIZE - margin * 2;
    // A level that has handed out every column it draws from — hundreds of entries, or a
    // player who keeps falling out of the world — starts over rather than repeating one
    // cell for ever.
    if (level.landings.size >= span * span) level.landings.clear();

    /** Is this cell free to stand in? The cell and the one above it, both Air. */
    const isFree = (x, y, z) => {
      for (let up = 0; up < DUNGEON_CONFIG.landingFreeCells; up += 1) {
        if (!isAirCell(x, y + up, z)) return false;
      }
      return true;
    };

    /**
     * The first free cell of a ring around `(localX, localZ)`, at `y`.
     *
     * The middle first, then the eight cells around it — the owner's order, and it means
     * a working landing is never moved for the fun of it. A cell outside the margin is
     * skipped: those are the room's own walls, and a cell there is a cell inside a wall.
     */
    const freeAround = (localX, localZ, y) => {
      for (let dx = 0; dx <= 1; dx += 1) {
        for (let dz = 0; dz <= 1; dz += 1) {
          for (const [sx, sz] of [[dx, dz], [-dx, dz], [dx, -dz], [-dx, -dz]]) {
            const x = localX + sx;
            const z = localZ + sz;
            if (x < margin || x >= SIZE - margin || z < margin || z >= SIZE - margin) continue;
            if (isFree(baseX + x, y, baseZ + z)) return [x, z];
          }
        }
      }
      return null;
    };

    // `landingSearchTries` columns, drawn the same way every time: random inside the
    // margin, never the pads' own cell, never a column already handed out this session.
    for (let attempt = 0; attempt < DUNGEON_CONFIG.landingSearchTries; attempt += 1) {
      let localX = margin + Math.floor(Math.random() * span);
      const localZ = margin + Math.floor(Math.random() * span);
      // The pads live at the centre: never land on one, or the player is sent to the next
      // difficulty before they have seen the room. One step aside is enough, and it costs
      // no attempt — a draw spent to be thrown away is a chance the player does not get.
      if (localX === centreX && localZ === centreZ) {
        localX = localX === margin ? margin + 1 : localX - 1;
      }
      const key = `${localX},${localZ}`;
      if (level.landings.has(key)) continue;

      const floorY = floorBlockYAt(baseX, baseY, baseZ, localX, localZ);
      if (floorY === null) return null;
      const landingY = floorY + DUNGEON_CONFIG.spawnAboveFloor;

      // The landing as drawn, then the same landing lifted a block at a time: a room whose
      // floor is one cell too high is a room whose player stands one cell higher.
      for (let lift = 0; lift <= DUNGEON_CONFIG.landingSearchLift; lift += 1) {
        const spot = freeAround(localX, localZ, landingY + lift);
        if (!spot) continue;
        level.landings.add(key);
        return [baseX + spot[0] + 0.5, landingY + lift, baseZ + spot[1] + 0.5];
      }
    }

    // Nothing worked anywhere: say so rather than place a player in stone. The caller
    // turns this into a message, and the block it names is the one to look at.
    return null;
  }

  /**
   * Puts `count` mobs in a room, on the floor the player is standing on.
   *
   * The cells are found exactly like the player's landing, and for the same reason: a
   * cell is only usable when **its own block and the one above are not solid**.
   *
   * Solid, not air — and that is the owner's correction: the dungeon has plants, and a
   * player (or a mob) walks through them. `getBlockSolidity` is the question to ask, and
   * it answers `true` for a chunk that has not been sent, which errs on the side of
   * "not a place to stand" rather than spawning a mob in the void.
   *
   * The height is **the player's own height**, passed in: their landing was verified,
   * every room of a level is the same template on the same layer, so that height is valid
   * here too and no floor is searched a second time. A cell that is blocked is skipped and
   * another one is drawn (`mobSpawnTries`), which keeps the count honest.
   */
  function spawnRoomMobs(level, chunkX, chunkZ, spawnY) {
    const difficulty = level.difficulty;
    const tuning = mobTuningFor(difficulty);
    if (tuning.count <= 0) return [];

    const baseX = chunkX * SIZE;
    const baseZ = chunkZ * SIZE;
    const margin = DUNGEON_CONFIG.mobSpawnMargin;
    const span = SIZE - margin * 2;
    const mobIds = [];

    /**
     * Can a body stand here? Its own cell and the one above, neither solid.
     *
     * Block coordinates, not the player's: `getBlockSolidity` takes x and z with a
     * fractional part as a hint (the API says so), and a hint is not a coordinate.
     */
    const bodyFits = (x, y, z) => !api.getBlockSolidity(Math.floor(x), y, Math.floor(z))
      && !api.getBlockSolidity(Math.floor(x), y + 1, Math.floor(z));

    for (let spawned = 0, tries = 0; spawned < tuning.count && tries < DUNGEON_CONFIG.mobSpawnTries; tries += 1) {
      const localX = margin + Math.floor(Math.random() * span);
      const localZ = margin + Math.floor(Math.random() * span);
      const x = baseX + localX;
      const z = baseZ + localZ;
      // The pads live at the centre of a room: a mob standing there would send the player
      // to the next level the moment they touch it. Never spawn on the pads, and not on
      // the cell beside them either — a mob paces.
      const [centreX, centreZ] = DUNGEON_CONFIG.probeLocalXZ;
      if (Math.abs(localX - centreX) <= 1 && Math.abs(localZ - centreZ) <= 1) continue;
      if (!bodyFits(x, spawnY, z)) continue;

      const mob = spawnOneMob(level, x, spawnY, z);
      if (!mob) continue;
      mobIds.push(mob.mobId);
      spawned += 1;
    }

    // A type that was asked for and never answered, in a room where another type worked,
    // is dropped for the session: `null` still means "a full world", so a type is only
    // condemned when the room proves the world accepts *some* mob at this moment.
    for (const mobType of DUNGEON_CONFIG.mobTypes) {
      if (level.refusedMobs.has(mobType)) continue;
      if (spawnableMobTypes(level).length <= 1) break;
      const refusals = level.mobRefusals.get(mobType) || 0;
      const before = level.mobRefusalsAtRoomStart.get(mobType) || 0;
      level.mobRefusalsAtRoomStart.set(mobType, refusals);
      if (refusals > before && mobIds.length > 0) {
        level.refusedMobs.set(mobType, "attemptSpawnMob answered null in a room that worked");
      }
    }

    trackRoomMobs(level, chunkX, chunkZ, mobIds);
    return mobIds;
  }

  /**
   * The mob types this level can still spawn.
   *
   * A type that made the game **throw** is dropped for the session on the spot: that is a
   * name the game does not know, and every room of every dungeon would pay for it again.
   * A type that merely answered `null` is not: `null` also means "too many mobs for the
   * number of players online", so a type is only dropped when it refused every attempt of
   * a room while another type worked (see the end of `spawnRoomMobs`).
   */
  function spawnableMobTypes(level) {
    return DUNGEON_CONFIG.mobTypes.filter((mobType) => !level.refusedMobs.has(mobType));
  }

  /**
   * Spawns one mob, **at random** among the types this level can still use.
   *
   * The rotation starts at a drawn type and walks the rest, so an unlucky type never
   * blocks a slot: the owner asked for a random type per mob, and a fixed order would make
   * the first type of the list the only one ever spawned.
   *
   * Stats are queued, not applied: `attemptSpawnMob` is asynchronous, and a `setMobSetting`
   * written in the same frame can be lost (see `flushMobTuning`).
   */
  function spawnOneMob(level, x, y, z) {
    const tuning = mobTuningFor(level.difficulty);
    const types = spawnableMobTypes(level);
    if (types.length === 0) return null;
    const first = Math.floor(Math.random() * types.length);

    for (let step = 0; step < types.length; step += 1) {
      const mobType = types[(first + step) % types.length];
      let mobId;
      try {
        mobId = api.attemptSpawnMob(mobType, x, y, z, {});
      } catch (error) {
        // A throw is a name the game does not know: never tried again this session.
        level.refusedMobs.set(mobType, error && error.message ? error.message : "threw");
        continue;
      }
      if (!mobId) {
        level.mobRefusals.set(mobType, (level.mobRefusals.get(mobType) || 0) + 1);
        continue;
      }
      level.pendingTuning.push({ mobId, tuning });
      return { mobId, mobType };
    }
    return null;
  }

  /**
   * Applies the queued stats of mobs that have just been spawned.
   *
   * One tick after the spawn, the mob exists and `setMobSetting` sticks. A mob whose
   * settings cannot be read — one the game refused after all, or one that died in the
   * meantime — is dropped silently: there is nothing to fix and nothing to report.
   */
  function flushMobTuning(level) {
    if (level.pendingTuning.length === 0) return 0;
    const queue = level.pendingTuning;
    level.pendingTuning = [];
    for (const { mobId, tuning } of queue) applyMobTuning(mobId, tuning);
    return queue.length;
  }

  /** Multiplies the stats of one mob by the difficulty's row. Never subtracts. */
  function applyMobTuning(mobId, tuning) {
    const scale = (setting, factor) => {
      if (factor === 1) return;
      const base = api.getMobSetting(mobId, setting, true);
      if (typeof base !== "number" || !Number.isFinite(base)) return;
      // Health is a pool with a current value: scaling only `maxHealth` would leave the
      // mob on its old health, and scaling only `initialHealth` would leave it capped.
      api.setMobSetting(mobId, setting, Math.round(base * factor * 10) / 10);
    };
    scale("maxHealth", tuning.health);
    scale("initialHealth", tuning.health);
    scale("attackDamage", tuning.damage);
    scale("baseRunningSpeed", tuning.speed);
    scale("baseWalkingSpeed", tuning.speed);
  }

  /**
   * A player entered a room: its four neighbours get mobs, the others lose theirs.
   *
   * This is the owner's rule, and it is also the only memory-safe version of it: mobs
   * exist only for the rooms next to the player, so a dungeon can never accumulate them.
   *
   * The room the player is in keeps its mobs — that is the room they are fighting in —
   * and every other room of the dungeon loses them. **Nothing is marked clear here**: a
   * room is clear when its last mob dies, and the entrance is marked clear by the caller,
   * which is the one room the owner wants clear from the start.
   *
   * `playerY` is the height the player is standing at, and it is used **as it is**: every
   * room of a level is a copy of the same template at the same layer, so the height that
   * was verified for the player is a valid height for their neighbours. No floor is
   * searched again, and that is the owner's instruction.
   */
  function enterRoom(level, chunkX, chunkZ, playerY) {
    flushMobTuning(level);
    const spawnY = Math.floor(Number(playerY));
    if (!Number.isFinite(spawnY)) return;

    const key = chunkKey(chunkX, chunkZ);
    // The room the player is in is wanted **with its mobs**: walking into a room full of
    // zombies is the fight, and killing the mobs of the other rooms is what the owner
    // asked for — not killing the ones in front of the player.
    const wanted = new Set([key]);

    for (const [dx, dz] of DUNGEON_CONFIG.mobRoomsAround) {
      const x = chunkX + dx;
      const z = chunkZ + dz;
      const roomKey = chunkKey(x, z);
      wanted.add(roomKey);
      // A room already holding mobs, or already cleared, is left alone: the record is in
      // the room, so this is the world's answer and not a session's memory.
      if (level.mobs.has(roomKey) || isRoomClear(level, x, z)) continue;
      // The room is not copied yet: `enterRoom` runs again while the player stays put
      // (`mobRetryTicks`), and this is how a room copied two ticks after the entrance
      // still gets its mobs.
      if (level.populated.has(roomKey)) continue;
      // **A room, not just a chunk.** `placed` is the loader's own probe answering "a room
      // is there", so a neighbouring chunk that is merely loaded — an empty chunk of the
      // undeveloped dungeon — never gets mobs floating in the void. A read cannot say
      // this: an empty chunk answers "Air", exactly like a room's air.
      if (level.planned.get(roomKey) !== "placed") continue;
      level.populated.add(roomKey);
      spawnRoomMobs(level, x, z, spawnY);
    }

    // Every other room of this dungeon loses its mobs: the ones the player walked away
    // from, and the ones behind the door they came in by.
    for (const roomKey of Array.from(level.mobs.keys())) {
      if (wanted.has(roomKey)) continue;
      const [x, z] = roomKey.split("|").map(Number);
      despawnRoomMobs(level, x, z);
    }
  }

  /**
   * A mob vanished without being killed. It is forgotten, and the room is **not** cleared.
   *
   * The game despawns mobs for its own reasons — too far from a player, too many mobs for
   * the number of players online — and reading any of those as "the player won this room"
   * would hand out a cleared room for free.
   */
  function mobGone(level, mobId) {
    for (const [roomKey, mobs] of level.mobs.entries()) {
      const index = mobs.indexOf(mobId);
      if (index === -1) continue;
      mobs.splice(index, 1);
      if (mobs.length === 0) level.mobs.delete(roomKey);
      return true;
    }
    return false;
  }

  /**
   * The last mob of a room died. Returns the room, or `null` when it was not the last.
   *
   * The mob is forgotten either way: a dead mob must not be despawned again.
   */
  function mobKilled(level, mobId) {
    for (const [roomKey, mobs] of level.mobs.entries()) {
      const index = mobs.indexOf(mobId);
      if (index === -1) continue;
      mobs.splice(index, 1);
      if (mobs.length > 0) return null;
      const [x, z] = roomKey.split("|").map(Number);
      level.mobs.delete(roomKey);
      markRoomClear(level, x, z);
      return { chunkX: x, chunkZ: z };
    }
    return null;
  }

  /**
   * What a dungeon's rooms hold, for `/dbg`.
   *
   * Three numbers: rooms with mobs, mobs alive, rooms already cleared. A player who
   * reports a room that never fills needs exactly these, and they cost nothing.
   */
  function mobReport(difficulty, entryId) {
    const level = levelState(difficulty, entryId);
    let mobs = 0;
    for (const ids of level.mobs.values()) mobs += ids.length;
    return {
      rooms: level.mobs.size,
      mobs,
      cleared: level.populated.size,
      types: Array.from(level.refusedMobs.entries()).map(([type, reason]) => `${type}: ${reason}`),
    };
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
      const probe = probeChunk(x, level.origin.y, z);
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
  function warmTemplates(difficulty, entryId) {
    const level = levelState(difficulty, entryId);
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
  function placeEntrance(difficulty, entryId) {
    const level = levelState(difficulty, entryId);
    const origin = level.origin;
    if (!origin) return null;
    // The fallback only exists for the case where `templateAt` cannot answer — an
    // empty usable list is handled by the caller — and it is recorded like any other,
    // so `landingPosition` reads the room that is really in the chunk.
    const template = templateAt(level, origin.x, origin.z)
      || level.entrance
      || usableTemplates(level)[0];
    if (!template) return null;
    // Which room ended up in the entrance chunk: the landing reads its floor height,
    // and it is the draw's choice, not the catalogue's first entry.
    level.entrance = template;
    const originX = origin.x;
    const originZ = origin.z;
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
      floorOfLayer(level.origin.y),
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
  function entranceFailureMessage(difficulty, entryId) {
    const info = explainEntrance(difficulty, entryId);
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
    if (info.floorBlockY === null) {
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
    for (const { difficulty, entryId, chunks } of chunksByLevel) {
      const level = levelState(difficulty, entryId);
      if (level.templates.length === 0 || usableTemplates(level).length === 0) continue;
      if (chunks.length === 0) continue;

      level.tick += 1;
      // The mobs spawned on the previous tick are real now: their stats are applied here,
      // which is the first moment `setMobSetting` can stick.
      flushMobTuning(level);

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
  function explainEntrance(difficulty, entryId) {
    const level = levelState(difficulty, entryId);
    const chunkX = level.origin ? level.origin.x : null;
    const chunkZ = level.origin ? level.origin.z : null;
    const chunkY = level.origin ? level.origin.y : null;
    const [localX, localZ] = DUNGEON_CONFIG.probeLocalXZ;
    const probe = chunkX === null ? { loaded: false, occupied: false } : probeChunk(chunkX, chunkY, chunkZ);
    const bottom = chunkX === null ? null : readCell(chunkX * SIZE + localX, chunkY * SIZE, chunkZ * SIZE + localZ);
    const top = chunkX === null ? null : readCell(chunkX * SIZE + localX, chunkY * SIZE + SIZE - 1, chunkZ * SIZE + localZ);
    const template = level.entrance || usableTemplates(level)[0];
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
      // The **world Y** of the floor block of the entrance chunk, in its own middle
      // column: the number the landing is drawn from, read where the landing is read.
      // A world coordinate, in the destination, like the copy it describes.
      floorBlockY: chunkX === null
        ? null
        : floorBlockYAt(
          chunkX * SIZE,
          chunkY * SIZE,
          chunkZ * SIZE,
          DUNGEON_CONFIG.probeLocalXZ[0],
          DUNGEON_CONFIG.probeLocalXZ[1],
        ),
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
  function statsOf(difficulty, entryId) {
    const level = levelState(difficulty, entryId);
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
    floorBlockYAt,
    isRoomClear,
    markRoomClear,
    enterRoom,
    spawnRoomMobs,
    mobKilled,
    mobGone,
    forgetMobs,
    flushMobTuning,
    mobReport,
    isPlaced,
    probeChunk,
    claimOrigin,
    hasOrigin,
    newOrigin,
    release,
    explainEntrance,
    entranceFailureMessage,
    planAround,
    placeEntrance,
    placeOne,
    warmTemplates,
    tick,
    statsOf,
    get states() { return states; },
  };
}
