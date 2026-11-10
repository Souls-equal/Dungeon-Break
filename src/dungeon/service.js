/*
 * The dungeon service: the entry point the game's world code calls.
 *
 * It owns one dungeon per difficulty, shared by every player inside it, which is
 * what makes the multiplayer rules hold: nobody generates a second copy of a
 * room, and two players walking into the same branch see the same walls.
 *
 * The sequence at spawn is the one imposed by the project, and it is respected
 * step by step — never compressed:
 *
 *   1. read the cell the player will land on          (`getBlock`)
 *   2. teleport to the middle of that cell            (`x.5` / `z.5`)
 *   3. wait a few ticks, so the client loads the chunks
 *   4. lay the landing pad
 *   5. start the dungeon: entrance first, then the controller's cycles
 *
 * Every step is scheduled through `src/utils/scheduler.js`. There is no native
 * timer here, and no `await`: a dungeon built while the world is not looking is a
 * dungeon with holes in it.
 */

import { setTimeout as scheduleTimeout, setInterval as scheduleInterval } from "../utils/scheduler.js";
import { DUNGEON_CONFIG, findDifficulty, nextDifficulty } from "./engine/config.js";
import { createDungeonManager } from "./engine/dungeonManager.js";
import { createDungeonController } from "./engine/controller.js";
import { createWorldBuilder, ROOM_BUILD_STATE } from "./worldBuilder.js";
import {
  CHUNK_RECORD_VERSION,
  anchorOf,
  chunkOfCell,
  chunkKey,
  readChunkRecord,
  verifyChunkRecord,
  writeChunkRecord,
} from "./chunkStore.js";
import {
  describeDungeon,
  describeNearby,
  describePosition,
  dungeonLines,
  hudLine,
  nearbyLines,
  reportLines,
} from "./debug.js";

/** Lobby position, used on every join and every exit. */
export const LOBBY_POSITION = [10, 21, 10];

/**
 * Seed of a dungeon.
 *
 * Derived from the difficulty and the lobby, never from the clock: the same
 * difficulty in the same lobby always builds the same dungeon, so a restart
 * rebuilds exactly what the players saw.
 */
export function dungeonSeedFor(difficultyId, lobbyName) {
  const text = `${lobbyName || "lobby"}|${difficultyId}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 2147483647;
}

/** The difficulty a pad leads to, or null on Hell. */
export function padTargetOf(difficultyId) {
  return nextDifficulty(difficultyId);
}

export function createDungeonService(options) {
  const api = options.api;
  const log = options.log || (() => {});
  const lobbyName = options.lobbyName || "lobby";
  const floorY = options.floorY === undefined ? DUNGEON_CONFIG.floorY : options.floorY;

  // Both maps belong to this service, never to the module: two services — two
  // worlds, or two tests — must not see each other's dungeons.
  /** One dungeon per difficulty, shared by the players inside it. */
  const dungeons = new Map();
  /** Which dungeon a player is in, so a disconnect is one lookup. */
  const playerDungeons = new Map();

  const keyOf = (difficulty) => `${lobbyName}|${difficulty.id}`;

  function createDungeon(difficulty) {
    const seed = dungeonSeedFor(difficulty.id, lobbyName);
    const manager = createDungeonManager({ seed, radius: difficulty.maxRadius });
    const worldBuilder = createWorldBuilder({
      api,
      floorY,
      log,
      batchSize: DUNGEON_CONFIG.blocksPerBatch,
    });
    const controller = createDungeonController({
      manager,
      builder: worldBuilder.asControllerBuilder(),
    });
    const dungeon = {
      difficulty,
      seed,
      manager,
      controller,
      worldBuilder,
      entranceRoomId: null,
      spawn: null,
      // The world is `survivalAdventure`: players cannot break anything, so the
      // only permission ever granted is the ore list, and it is empty for now.
      miningAllowed: false,
      emptyTicks: 0,
      // Chunks whose record has been written at least once, in write order, so the
      // save pass can take the least recently written one. A plain `Set` keeps
      // insertion order; the pass re-inserts to rotate it.
      savedChunks: new Set(),
      chunksSaved: 0,
      chunkSaveFailures: 0,
    };
    dungeons.set(keyOf(difficulty), dungeon);
    return dungeon;
  }

  /**
   * Creates the entrance room and chooses the cell the player lands on.
   *
   * The landing cell must be a floor cell of the entrance, not a doorway: landing
   * in a doorway would leave the player standing over the joint.
   */
  function carveEntrance(dungeon) {
    const entrance = dungeon.manager.createEntrance();
    if (!entrance) return null;
    dungeon.entranceRoomId = entrance.id;
    const room = dungeon.manager.getRoom(entrance.id);

    const doorwayCells = new Set();
    for (const opening of room.openings) {
      for (let offset = opening.offsetStart; offset <= opening.offsetEnd; offset += 1) {
        if (opening.side === "north") doorwayCells.add(`${offset},0`);
        else if (opening.side === "south") doorwayCells.add(`${offset},${room.mask.h - 1}`);
        else if (opening.side === "west") doorwayCells.add(`0,${offset}`);
        else doorwayCells.add(`${room.mask.w - 1},${offset}`);
      }
    }

    // The landing cell is the one the player materialises on, so it must be in the
    // middle of the hall, not a random inner cell: the entrance is the first thing
    // anyone sees, and a player who lands against a wall reads it as a bug.
    //
    // Two constraints, relaxed one at a time if the shape cannot satisfy them:
    //   - away from the pad's own radius, so the landing pad stays inside the room
    //     instead of spilling through its walls into the joint;
    //   - closest to the centre of the room's cells.
    const padRadius = DUNGEON_CONFIG.scale * 2;
    const centre = { x: (room.mask.w - 1) / 2, z: (room.mask.h - 1) / 2 };
    const score = (localX, localZ) => Math.abs(localX - centre.x) + Math.abs(localZ - centre.z);
    let cell = pickLanding(room, doorwayCells, padRadius + 1, score);
    if (!cell) cell = pickLanding(room, doorwayCells, 1, score);
    if (!cell) return null;

    dungeon.spawn = {
      cell,
      position: [cell.x + 0.5, floorY + 2, cell.z + 0.5],
      roomId: room.id,
      // The room the landing happens in, so the pad can be clipped to it: a
      // 21-cell square centred on a room narrower than that writes floor through
      // the walls, into the joint and in front of the door.
      room,
    };
    return dungeon.spawn;
  }

  /**
   * The floor cell to land on: closest to the middle of the room, at least
   * `margin` cells from the room's outer face, and never a doorway.
   */
  function pickLanding(room, doorwayCells, margin, score) {
    let best = null;
    let bestScore = Infinity;
    for (let localZ = margin; localZ < room.mask.h - margin; localZ += 1) {
      for (let localX = margin; localX < room.mask.w - margin; localX += 1) {
        if (!room.mask.cells[localZ] || !room.mask.cells[localZ][localX]) continue;
        if (doorwayCells.has(`${localX},${localZ}`)) continue;
        // The cell below the doorway of a neighbour is a corridor mouth: the
        // player would land in a tunnel rather than in the hall.
        const nearDoorway = doorwayCells.has(`${localX - 1},${localZ}`) || doorwayCells.has(`${localX + 1},${localZ}`)
          || doorwayCells.has(`${localX},${localZ - 1}`) || doorwayCells.has(`${localX},${localZ + 1}`);
        if (nearDoorway) continue;
        const value = score(localX, localZ);
        if (value < bestScore) { bestScore = value; best = { x: room.origin.x + localX, z: room.origin.y + localZ }; }
      }
    }
    return best;
  }

  /**
   * Builds the entrance in batches, one per tick, and calls `onDone` once — even
   * when the build failed, so a caller is never left waiting forever.
   */
  function buildEntrance(dungeon, onDone) {
    const room = dungeon.manager.getRoom(dungeon.entranceRoomId);
    let ticks = 0;
    const timer = scheduleInterval(() => {
      ticks += 1;
      const result = dungeon.worldBuilder.buildBatch(room);
      if (result.done) {
        timer.stop();
        onDone(result);
        return;
      }
      if (result.state === ROOM_BUILD_STATE.FAILED) {
        timer.stop();
        onDone(result);
        return;
      }
      // A room waiting for its chunk is not a stalled build — the player is
      // standing in it, so the chunks arrive — but it must not loop forever.
      if (result.state === ROOM_BUILD_STATE.WAITING_FOR_CHUNK && ticks > 200) {
        timer.stop();
        onDone(result);
      }
    }, 1);
  }

  /**
   * Puts a player into a difficulty.
   *
   * `onReady` is called once the floor under the player exists. Nothing is
   * announced before that: a player told "ready" while falling is worse than a
   * player told nothing.
   */
  function enterDifficulty(playerId, difficultyRef, onReady) {
    const difficulty = typeof difficultyRef === "string" ? findDifficulty(difficultyRef) : difficultyRef;
    if (!difficulty) {
      api.sendMessage(playerId, "That difficulty does not exist.");
      return null;
    }
    let dungeon = dungeons.get(keyOf(difficulty));
    if (!dungeon) dungeon = createDungeon(difficulty);

    const spawn = dungeon.spawn || carveEntrance(dungeon);
    if (!spawn) {
      api.sendMessage(playerId, "Could not build this dungeon. Try again.");
      return null;
    }

    // 1. Read the cell. Never write before this read: the chunk does not exist
    //    yet, and a write would be lost without any error.
    const before = dungeon.worldBuilder.readBlock(spawn.cell.x, floorY, spawn.cell.z);

    // 2. Teleport to the middle of the cell, which is on the floor.
    api.setPosition(playerId, spawn.position);

    // 3. Wait for the client to load the chunks, then 4. lay the pad.
    scheduleTimeout(() => {
      // No radius here: the pad's size is a length, so it follows the scale
      // (`scale * 2`, i.e. 21×21 at ×5). Pinning it to 2 left a 5×5 tile in the
      // middle of a 55-cell hall, which reads as a placement bug.
      dungeon.worldBuilder.layLandingPad(spawn.cell, { room: spawn.room });
      // 5. Build the entrance, and only then let the player in.
      buildEntrance(dungeon, (result) => {
        if (!result.done) {
          api.sendMessage(playerId, "The dungeon could not be built. You have been returned to the lobby.");
          api.setPosition(playerId, LOBBY_POSITION);
          return;
        }
        if (!dungeon.miningAllowed) {
          // `DUNGEON_CONFIG.breakableBlocks` is empty until ores exist; the call
          // is then a no-op, and the dungeon stays sealed by the game mode
          // itself rather than by a per-block lock.
          dungeon.worldBuilder.allowMining(DUNGEON_CONFIG.breakableBlocks || []);
          dungeon.miningAllowed = true;
        }
        playerDungeons.set(playerId, dungeon);
        // The controller reads a position as `{ x, z }` and derives the room
        // itself; handing it the world-space `[x, y, z]` array used to give it
        // `undefined` and silently leave the player without a room.
        dungeon.controller.upsertPlayer({
          id: playerId,
          position: { x: spawn.position[0], z: spawn.position[2] },
        });
        if (onReady) onReady(dungeon, spawn);
        log(`player ${playerId} entered ${difficulty.label} (landing cell was ${before})`);
      });
    }, DUNGEON_CONFIG.chunkWarmupTicks);
    return dungeon;
  }

  /** Advances every dungeon by one tick. Called from the world's tick callback. */
  function tick() {
    for (const dungeon of dungeons.values()) {
      let playerCount = 0;
      for (const [playerId, playerDungeon] of playerDungeons.entries()) {
        if (playerDungeon !== dungeon) continue;
        const position = api.getPosition(playerId);
        if (!position) continue;
        playerCount += 1;
        dungeon.controller.upsertPlayer({ id: playerId, position: { x: position[0], z: position[2] } });
      }
      dungeon.emptyTicks = playerCount === 0 ? dungeon.emptyTicks + 1 : 0;
      dungeon.controller.tick();
      // The safety net, after construction: the chunk record of a room that was
      // built a moment ago is worth writing, and one chunk per tick is a cost the
      // tick budget above has already been built to absorb.
      //
      // Only once a player is actually in the dungeon, though. A dungeon exists
      // before anyone lands in it — the entrance is carved, then the player is
      // teleported, then the chunks load — and a record written in that window
      // would be a record written into a chunk the server has not sent yet, which
      // is dropped without an error. The player's presence is what loads the
      // chunks, so the player's presence is what gates the store.
      if (playerCount > 0) saveOneChunk(dungeon);
    }
  }

  /**
   * A pad was stepped on.
   *
   * The pad is not a doorway: it is a block written with the room, and it takes
   * the player to the next difficulty. The player is teleported, never walked
   * into the next dungeon.
   */
  function usePad(playerId, difficultyId, onReady) {
    const target = padTargetOf(difficultyId);
    if (!target) {
      api.sendMessage(playerId, "This is as far as the dungeon goes.");
      return null;
    }
    leave(playerId);
    return enterDifficulty(playerId, target, onReady);
  }

  /** Sends a player back to the lobby. Every exit goes through here. */
  function leave(playerId) {
    const dungeon = playerDungeons.get(playerId);
    // Leaving the dungeon must also unhook the player from its controller: a
    // controller that keeps a departed player keeps discovering openings around
    // a ghost, and the dungeon grows for nobody.
    if (dungeon) dungeon.controller.removePlayer(playerId);
    playerDungeons.delete(playerId);
    api.setPosition(playerId, LOBBY_POSITION);
  }

  const dungeonOf = (playerId) => playerDungeons.get(playerId) || null;

  /**
   * Can the anchor of this chunk land in the world?
   *
   * The anchor cell is `(chunkX * size, floorY, chunkZ * size)` — a corner, not the
   * middle of the chunk, and the corner is exactly what a player standing in the
   * room may not have loaded. `getBlock` returns `null` for a cell in a chunk the
   * server has not sent, and that is the condition to test: it is a read of the
   * anchor itself, not an estimate from a player's distance.
   */
  function chunkReachable(chunkX, chunkZ) {
    const anchor = anchorOf(chunkX, chunkZ, floorY);
    return api.getBlock(anchor.x, anchor.y, anchor.z) !== null;
  }

  /**
   * Every chunk a dungeon touches, with the plans and the progress it holds.
   *
   * This is the index the chunk records are written from: `manager.allRooms()` is
   * the truth, the map is only what has been said to the world so far, and a chunk
   * that is not in it is stored by the next pass.
   */
  function chunkSummary(dungeon) {
    const records = new Map();
    for (const room of dungeon.manager.allRooms()) {
      const chunk = chunkOfCell(room.origin.x, room.origin.y);
      const key = chunkKey(chunk.x, chunk.z);
      let entry = records.get(key);
      if (!entry) {
        entry = { chunkX: chunk.x, chunkZ: chunk.z, rooms: [], passages: 0 };
        records.set(key, entry);
      }
      entry.rooms.push(room);
    }
    for (const connection of dungeon.manager.allConnections()) {
      const cells = connection.joint.length > 0 ? connection.joint : connection.bridge;
      if (cells.length === 0) continue;
      const cell = cells[0];
      const chunk = chunkOfCell(cell.x, cell.y);
      const key = chunkKey(chunk.x, chunk.z);
      let entry = records.get(key);
      if (!entry) {
        entry = { chunkX: chunk.x, chunkZ: chunk.z, rooms: [], passages: 0 };
        records.set(key, entry);
      }
      // A passage crosses a chunk that holds no room of its own, so the anchor of
      // that chunk lands **outside anything the player has loaded** — the player is
      // in the room, the joint is in the masonry beyond it. A write into an unloaded
      // chunk is dropped by the server without an error, so that chunk is not
      // stored at all: an anchor is written only where a block can actually land.
      if (!chunkReachable(chunk.x, chunk.z)) continue;
      entry.passages += 1;
    }
    return records;
  }

  /**
   * Writes the record of one chunk of a dungeon: what it should contain, and how
   * far each of its parts got.
   *
   * The plans come from the builder, which is the only thing that knows how many
   * blocks a room writes; the progress comes from the same place, because a build
   * state lives there. Nothing is invented here: a chunk whose rooms are unknown
   * writes an empty record rather than a guess.
   */
  function saveChunk(dungeon, chunkX, chunkZ) {
    const plans = [];
    const progress = [];
    for (const room of dungeon.manager.allRooms()) {
      const chunk = chunkOfCell(room.origin.x, room.origin.y);
      if (chunk.x !== chunkX || chunk.z !== chunkZ) continue;
      const state = dungeon.worldBuilder.stateOf(room.id);
      plans.push({ kind: "room", id: room.id, blocks: state ? state.total : 0 });
      progress.push({
        kind: "room",
        id: room.id,
        state: state ? state.state : "not_started",
        cursor: state && state.cursor ? state.cursor.index : null,
      });
    }
    return writeChunkRecord(api, {
      dungeonId: keyOf(dungeon.difficulty),
      seed: dungeon.seed,
      chunkX,
      chunkZ,
      floorY,
      tick: dungeon.controller.stats.ticks,
      plans,
      progress,
      writeAnchor: dungeon.worldBuilder.writeAnchor,
    });
  }

  /**
   * The persistence pass of one dungeon tick: **one** chunk.
   *
   * One chunk per tick, not the whole dungeon, because the point of the store is a
   * safety net: a room whose record is stale is a room that a resumed build can
   * redo, and the dungeon is rebuilt from its seed anyway. Writing every chunk on
   * every tick would put thousands of `setBlockData` calls on the tick path, and
   * the tick is exactly what Bloxd kills when it runs long.
   */
  function saveOneChunk(dungeon) {
    if (!api.setBlockData) return null;
    const summary = chunkSummary(dungeon);
    let chosen = null;
    for (const [key, entry] of summary) {
      if (!dungeon.savedChunks.has(key)) { chosen = entry; break; }
    }
    if (!chosen) {
      // Everything has been said once: refresh the stalest, so progress keeps
      // moving without ever costing more than one write per tick. A `Set` keeps
      // insertion order, so the first entry is the least recently written.
      const first = summary.values().next();
      if (first.done) return null;
      chosen = first.value;
      const key = chunkKey(chosen.chunkX, chosen.chunkZ);
      dungeon.savedChunks.delete(key);
    }
    dungeon.savedChunks.add(chunkKey(chosen.chunkX, chosen.chunkZ));
    const result = saveChunk(dungeon, chosen.chunkX, chosen.chunkZ);
    if (result.ok) dungeon.chunksSaved += 1;
    else dungeon.chunkSaveFailures += 1;
    return result;
  }

  /**
   * What the chunk store holds for one player, read back from the world.
   *
   * This is the debug command's job and the honest answer to "did the data
   * survive": it reads the anchor, reads its data, and reports the parsed record
   * or the reason there is none — never a substitute.
   */
  function readChunkAt(playerId, chunkX, chunkZ) {
    const dungeon = playerDungeons.get(playerId);
    if (!dungeon) return null;
    const read = readChunkRecord(api, { chunkX, chunkZ, floorY });
    return { dungeonId: keyOf(dungeon.difficulty), seed: dungeon.seed, chunkX, chunkZ, read };
  }

  /** Writes and reads one chunk back, to prove the format in the real world. */
  function verifyChunkAt(playerId, chunkX, chunkZ) {
    const dungeon = playerDungeons.get(playerId);
    if (!dungeon) return null;
    const read = readChunkRecord(api, { chunkX, chunkZ, floorY });
    const record = read.ok ? read.record : null;
    const result = verifyChunkRecord(api, {
      dungeonId: keyOf(dungeon.difficulty),
      seed: dungeon.seed,
      chunkX,
      chunkZ,
      floorY,
      tick: dungeon.controller.stats.ticks,
      plans: record ? record.plans.map((plan) => ({ kind: plan.kind, id: plan.id, blocks: plan.blocks })) : [],
      progress: record ? record.progress.map((entry) => ({ kind: entry.kind, id: entry.id, state: entry.state, cursor: entry.cursor })) : [],
      writeAnchor: dungeon.worldBuilder.writeAnchor,
    });
    return { dungeonId: keyOf(dungeon.difficulty), version: CHUNK_RECORD_VERSION, chunkX, chunkZ, ...result };
  }

  /**
   * What a player is standing in, as numbers.
   *
   * This is the report a bug report needs and a screenshot cannot carry: the two
   * dungeons share a world, the seed is derived from the lobby name, and a room
   * identifier means nothing without the dungeon it belongs to. It reads state
   * and writes nothing.
   *
   * `cell` is read from the live position rather than from the controller's
   * record, so the report is true even in the tick before the controller caught
   * up — and it is *never* taken from the spawn, which would say "you are in the
   * entrance" for a player standing in the last room.
   */
  function debugReport(playerId, options = {}) {
    const dungeon = playerDungeons.get(playerId);
    if (!dungeon) return null;
    const position = options.position || api.getPosition(playerId);
    if (!position) return null;
    const point = { x: position[0], y: position[1], z: position[2] };
    const report = describePosition({
      manager: dungeon.manager,
      point,
      seed: dungeon.seed,
      difficulty: dungeon.difficulty.label,
      lobby: lobbyName,
      // One read per reported cell, and only when a report is asked for: the
      // world is never polled on the tick path.
      blockAt: options.light ? null : (x, y, z) => api.getBlock(x, y, z),
      // The build progress lives in the builder, which is the only object that
      // knows how far a room got and why it stopped.
      buildStateOf: (roomId) => dungeon.worldBuilder.stateOf(roomId),
      light: options.light === true,
    });
    report.playerId = playerId;
    report.dungeonId = keyOf(dungeon.difficulty);
    report.entranceRoomId = dungeon.entranceRoomId;
    report.spawnCell = dungeon.spawn ? dungeon.spawn.cell : null;
    return report;
  }

  /**
   * The HUD line of a player, or an empty string outside a dungeon.
   *
   * This is the report a screenshot carries for free: it is short enough for
   * `middleTextTop`, cheap enough to refresh twice a second (no room scan, no
   * block read), and it holds the seed — the one number without which a picture
   * of a dungeon cannot be reproduced.
   */
  function hudLineOf(playerId) {
    const report = debugReport(playerId, { light: true });
    if (!report) return "";
    return hudLine(report);
  }

  /** The chat lines of that report, for the host to send. */
  function debugLines(playerId, options = {}) {
    const report = debugReport(playerId, options);
    if (!report) return [];
    return reportLines(report);
  }

  /**
   * The rooms around a player, with their build state and their free doorways.
   *
   * Same rule as every other report: it reads, it writes nothing, and it is only
   * built when asked for — this one walks every room, so it must never be called
   * from the tick.
   */
  function debugNearby(playerId, options = {}) {
    const dungeon = playerDungeons.get(playerId);
    if (!dungeon) return null;
    const position = options.position || api.getPosition(playerId);
    if (!position) return null;
    const report = describeNearby(
      dungeon.manager,
      { x: position[0], y: position[1], z: position[2] },
      {
        limit: options.limit,
        buildStateOf: (roomId) => dungeon.worldBuilder.stateOf(roomId),
      },
    );
    report.dungeonId = keyOf(dungeon.difficulty);
    report.difficulty = dungeon.difficulty.label;
    report.seed = dungeon.seed;
    return report;
  }

  /** The chat lines of that report. */
  function debugNearbyLines(playerId, options = {}) {
    const report = debugNearby(playerId, options);
    if (!report) return [];
    const lines = nearbyLines(report, options);
    lines.push(`[dbg] dungeon ${report.difficulty} · seed ${report.seed}`);
    return lines;
  }

  /**
   * The whole dungeon — the one the player is in, or a named difficulty.
   *
   * The named form is what makes a screenshot useful after the fact: a player can
   * send `!dbg dungeon medium` from the lobby without walking into it, and the
   * report describes the dungeon the lobby would build.
   */
  function debugDungeon(playerId, difficultyRef = null) {
    let dungeon = playerDungeons.get(playerId) || null;
    if (difficultyRef) {
      const difficulty = typeof difficultyRef === "string" ? findDifficulty(difficultyRef) : difficultyRef;
      if (!difficulty) return null;
      dungeon = dungeons.get(keyOf(difficulty)) || null;
      if (!dungeon) return null;
    }
    if (!dungeon) return null;
    return {
      dungeonId: keyOf(dungeon.difficulty),
      difficulty: dungeon.difficulty.label,
      seed: dungeon.seed,
      summary: describeDungeon(dungeon.manager, {
        buildStateOf: (roomId) => dungeon.worldBuilder.stateOf(roomId),
      }),
    };
  }

  /** The chat lines of that summary. */
  function debugDungeonLines(playerId, difficultyRef = null) {
    const report = debugDungeon(playerId, difficultyRef);
    if (!report) return [];
    return dungeonLines(report.seed, report.difficulty, report.summary);
  }

  /**
   * The chunk records around a player, read back from the blocks that hold them.
   *
   * The anchor is a corner cell, so the chunk a player stands in is reported first
   * and then its neighbours up to `radius` — the anchor of the chunk they are in
   * may be a whole chunk away, and "the record is not where I am" would be a
   * misleading answer on its own. Reads only: a report never writes a block.
   */
  function debugChunkReport(playerId, radius = 1) {
    const dungeon = playerDungeons.get(playerId);
    if (!dungeon) return null;
    const position = api.getPosition(playerId);
    if (!position) return null;
    const cell = { x: Math.floor(position[0]), z: Math.floor(position[2]) };
    const here = chunkOfCell(cell.x, cell.z);
    const span = Math.max(0, Math.min(3, Math.floor(radius)));
    const records = [];
    for (let dz = -span; dz <= span; dz += 1) {
      for (let dx = -span; dx <= span; dx += 1) {
        const chunkX = here.x + dx;
        const chunkZ = here.z + dz;
        records.push({ chunkX, chunkZ, read: readChunkRecord(api, { chunkX, chunkZ, floorY }) });
      }
    }
    return {
      cell,
      chunk: here,
      radius: span,
      chunksSaved: dungeon.chunksSaved,
      chunkSaveFailures: dungeon.chunkSaveFailures,
      records,
    };
  }

  function stats() {
    const list = [];
    for (const dungeon of dungeons.values()) {
      list.push({
        difficulty: dungeon.difficulty.label,
        seed: dungeon.seed,
        rooms: dungeon.manager.roomCount,
        connections: dungeon.manager.allConnections().length,
        stats: dungeon.controller.stats,
        chunksSaved: dungeon.chunksSaved,
        chunkSaveFailures: dungeon.chunkSaveFailures,
      });
    }
    return list;
  }

  function forgetAll() {
    dungeons.clear();
    playerDungeons.clear();
  }

  return {
    enterDifficulty,
    usePad,
    leave,
    debugReport,
    debugLines,
    hudLineOf,
    debugDungeon,
    debugDungeonLines,
    debugNearby,
    debugNearbyLines,
    readChunkAt,
    verifyChunkAt,
    debugChunkReport,
    saveChunk,
    leaveToLobby: leave,
    tick,
    dungeonOf,
    stats,
    forgetAll,
    get dungeons() { return dungeons; },
    get playerDungeons() { return playerDungeons; },
  };
}
