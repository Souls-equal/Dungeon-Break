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

  function stats() {
    const list = [];
    for (const dungeon of dungeons.values()) {
      list.push({
        difficulty: dungeon.difficulty.label,
        seed: dungeon.seed,
        rooms: dungeon.manager.roomCount,
        connections: dungeon.manager.allConnections().length,
        stats: dungeon.controller.stats,
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
    leaveToLobby: leave,
    tick,
    dungeonOf,
    stats,
    forgetAll,
    get dungeons() { return dungeons; },
    get playerDungeons() { return playerDungeons; },
  };
}
