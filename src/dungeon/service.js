/*
 * The dungeon service: everything the world code is allowed to call.
 *
 * One loader, one entry per level, and the spawn sequence the project has always
 * imposed — read, teleport, wait, then build. The sequence is not a formality: a
 * chunk that a player has not loaded cannot be read, a copy into it is dropped
 * without an error, and the room is simply missing.
 *
 * The wait has a second purpose now. A player teleported into an empty chunk
 * would fall, so gravity is switched off for the few ticks the room takes to
 * appear, then switched back on. That is one documented client option
 * (`gravityMultiplier`), and it removes the box of walls the old engine had to
 * build around a landing player to stop them walking off the edge.
 */

import { setTimeout as scheduleTimeout } from "../utils/scheduler.js";
import {
  DUNGEON_CONFIG,
  findDifficulty,
  floorOfLayer,
  nextDifficulty,
} from "./config.js";
import { chunkOfWorld, createLoader } from "./loader.js";

/** Lobby position, used on every join and every exit. */
export const LOBBY_POSITION = [10, 21, 10];

const SIZE = DUNGEON_CONFIG.chunkSize;

export function createDungeonService(options) {
  const api = options.api;
  const log = options.log || (() => {});
  const loader = createLoader({ api, log });

  /** playerId → { difficulty, landed, position } */
  const playerDungeons = new Map();
  /** Ticks of this service, for the reports. */
  let ticks = 0;
  /** Levels a player has entered at least once, so reports can list them. */
  const usedLevels = new Set();

  function dungeonOf(playerId) {
    return playerDungeons.get(playerId) || null;
  }

  /** Is this player inside a level right now? */
  function inDungeon(playerId) {
    return playerDungeons.has(playerId);
  }

  /**
   * The pads are **built into the rooms**, not written by this engine.
   *
   * A level's rooms carry the Concrete of the level they lead to, and a player
   * walks on it: `onBlockStandStart` reports the block, the block names the
   * difficulty, and `usePad` teleports. Nothing is ever written into a chunk — not
   * a pad, not a marker, not a repair — because a room is hand-built and the code
   * only ever copies it.
   *
   * What this removes, and what it costs: the engine can no longer *guarantee*
   * that a room has a pad, and it cannot paint one where there is none. A room
   * without Concrete simply leads nowhere, and that is a building decision, visible
   * in `/dbg templates` only as "this room has no pad" if someone asks.
   */
  /**
   * Puts a player into a level.
   *
   * Steps, in order, each one asserted before the next:
   *
   *   1. a template exists, or the player stays in the lobby with a reason;
   *   2. the template chunks are requested, gravity is switched off, and the player
   *      is dropped into the chunk the entrance room will occupy;
   *   3. `chunkLoadTicks` later, the entrance room is copied if it is not already
   *      there — the room's own Bedrock says which;
   *   4. a tick later, the floor under the landing cell is read back, and the player
   *      is placed on it. A floor that is not there is retried for
   *      `entryMaxTicks`, then it is a message — never a player falling through the
   *      world.
   *
   * None of these waits is a guess: a chunk answers `chunkLoadTicks` after the read
   * that requested it, and a copied room is readable the tick after the copy.
   */
  function enterDifficulty(playerId, difficultyReference, onReady) {
    const difficulty = findDifficulty(difficultyReference);
    if (!difficulty) {
      api.sendMessage(playerId, "That difficulty does not exist.");
      return null;
    }
    const level = loader.levelState(difficulty);
    if (level.templates.length === 0) {
      api.sendMessage(playerId, `${difficulty.label} has no rooms yet. ${DUNGEON_CONFIG.missingTemplatesMessage}`);
      return null;
    }

    // Ask the server for the template chunks now, so the copies a moment later have
    // something to read. One call per template, once per level.
    loader.warmTemplates(difficulty);

    const provisionalY = floorOfLayer(difficulty) + SIZE - 2;
    const centreX = DUNGEON_CONFIG.originChunkX * SIZE + DUNGEON_CONFIG.landingLocalXZ[0] + 0.5;
    const centreZ = DUNGEON_CONFIG.originChunkZ * SIZE + DUNGEON_CONFIG.landingLocalXZ[1] + 0.5;

    // Nothing is announced before the floor exists: a player told "ready" while
    // falling is worse than a player told nothing.
    api.setClientOptions(playerId, { gravityMultiplier: 0 });
    api.setPosition(playerId, [centreX, provisionalY, centreZ]);
    playerDungeons.set(playerId, { difficulty, landed: false, position: [centreX, provisionalY, centreZ] });
    usedLevels.add(difficulty);

    scheduleTimeout(() => {
      // A player who left the game during the wait has no business being placed.
      if (!playerDungeons.has(playerId)) return;

      // The floor height is read from the template before the copy replaces what
      // the destination holds: the value is what the copy will produce, not what
      // happens to be there now.
      const floorLocalY = loader.findFloorLocalY(level);
      const landing = loader.landingPosition(difficulty);
      if (!landing || floorLocalY === null) {
        // No template could be read: its chunk is not loaded, so a copy from it
        // would do nothing and there is no floor to stand on. Saying so is the only
        // honest answer — and `/dbg templates` says which chunk to fix.
        api.setClientOptions(playerId, { gravityMultiplier: 1 });
        leave(playerId);
        api.sendMessage(
          playerId,
          "The room templates are not loaded, so this level cannot be built. Type /dbg templates.",
        );
        return;
      }

      // The entrance room, first and alone: everything else is planned around it.
      // The probe inside only copies where no room is, so re-entering a level does
      // not rebuild what is already standing.
      loader.placeEntrance(difficulty);

      // The floor is read back rather than assumed: a copy that did not land is a
      // message, not a player falling through the world. `placeEntrance` is called
      // again on each attempt, which copies again only if the room is still missing.
      const waitForFloor = (attemptsLeft) => {
        scheduleTimeout(() => {
          if (!playerDungeons.has(playerId)) return;
          const record = playerDungeons.get(playerId);
          if (record && record.difficulty.id !== difficulty.id) return;

          const under = api.getBlock(
            Math.floor(landing[0]),
            floorOfLayer(difficulty) + floorLocalY,
            Math.floor(landing[2]),
          );
          if (under === null || under === "Air") {
            if (attemptsLeft > 0) {
              loader.placeEntrance(difficulty);
              waitForFloor(attemptsLeft - 1);
              return;
            }
            api.sendMessage(playerId, "The room could not be built. You have been returned to the lobby.");
            api.setClientOptions(playerId, { gravityMultiplier: 1 });
            leave(playerId);
            log(`entrance copy failed for ${playerId} on ${difficulty.label}`);
            return;
          }

          api.setPosition(playerId, landing);
          api.setClientOptions(playerId, { gravityMultiplier: 1 });
          const state = playerDungeons.get(playerId);
          if (state) {
            state.landed = true;
            state.position = landing;
          }
          api.sendMessage(playerId, `Level: ${difficulty.label}`);
          // The rooms around the player are planned from here, once: the next scan
          // (a few ticks later) would do the same, but the player would spend those
          // ticks staring at the edge of a single room.
          loader.planAround(level, DUNGEON_CONFIG.originChunkX, DUNGEON_CONFIG.originChunkZ);
          if (onReady) onReady(difficulty, landing);
        }, 1);
      };
      waitForFloor(DUNGEON_CONFIG.entryMaxTicks);
    }, DUNGEON_CONFIG.chunkLoadTicks);

    return difficulty;
  }

  /** Sends a player back to the lobby. Every exit goes through here. */
  function leave(playerId) {
    playerDungeons.delete(playerId);
    api.setPosition(playerId, LOBBY_POSITION);
  }

  /**
   * A pad built into a room was stepped on.
   *
   * The block names a difficulty, exactly as in the lobby: stepping on the Easy
   * Concrete of a Very Easy room leads to Easy. In the lobby the same callback goes
   * through the countdown instead, so one table drives both.
   */
  function usePad(playerId) {
    const dungeon = dungeonOf(playerId);
    if (!dungeon) return null;
    const target = nextDifficulty(dungeon.difficulty);
    if (!target) {
      api.sendMessage(playerId, "This is as far as the dungeon goes.");
      return null;
    }
    enterDifficulty(playerId, target);
    return target;
  }

  /**
   * Rescues a player who fell out of their level.
   *
   * It happens for one reason only — a chunk written before the player's client
   * had it — and the honest fix is to put them back on a floor that is now
   * verified, not to pretend it cannot happen.
   */
  function rescueIfFallen(playerId, dungeon, position) {
    const bottom = floorOfLayer(dungeon.difficulty) - 4;
    if (position[1] >= bottom) return false;
    const landing = loader.landingPosition(dungeon.difficulty);
    if (!landing) return false;
    api.setPosition(playerId, landing);
    dungeon.position = landing;
    log(`player ${playerId} fell out of ${dungeon.difficulty.label}: placed back`);
    return true;
  }

  /** One tick: where every player is, then one room copied per level. */
  function tick() {
    ticks += 1;
    const groups = new Map();
    for (const [playerId, dungeon] of playerDungeons) {
      const position = api.getPosition(playerId);
      if (!position) continue;
      dungeon.position = position;
      if (rescueIfFallen(playerId, dungeon, position)) continue;
      const chunk = chunkOfWorld(position[0], position[2]);
      let group = groups.get(dungeon.difficulty.id);
      if (!group) {
        group = { difficulty: dungeon.difficulty, chunks: [] };
        groups.set(dungeon.difficulty.id, group);
      }
      group.chunks.push(chunk);
    }
    loader.tick(Array.from(groups.values()));
  }

  // ------------------------------------------------------------------ reports --
  //
  // What a bug report needs: where the player is, which chunk should hold which
  // room, and whether the template behind it can be read at all. Read-only, and
  // only built when a player asks — never on the tick path.

  function reportOf(playerId) {
    const dungeon = dungeonOf(playerId);
    if (!dungeon) return null;
    const position = api.getPosition(playerId) || dungeon.position;
    const chunk = chunkOfWorld(position[0], position[2]);
    const level = loader.levelState(dungeon.difficulty);
    const template = level.templates.length > 0 ? level.templates[0] : null;
    const stats = loader.statsOf(dungeon.difficulty);
    return {
      difficulty: dungeon.difficulty,
      chunkY: dungeon.difficulty.chunkY,
      position,
      chunk,
      planned: stats.planned,
      queued: stats.queued,
      placed: stats.placed,
      templates: stats.templates,
      disabled: stats.disabled,
      exampleChunk: template ? template.chunk : null,
      ticks,
    };
  }

  /** Every template of every level, with the answer "is it readable". */
  function templatesReport() {
    const rows = [];
    for (const difficulty of usedLevels) {
      const level = loader.levelState(difficulty);
      for (const template of level.templates) {
        const block = api.getBlock(template.src[0], template.src[1], template.src[2]);
        rows.push({
          difficulty: difficulty.label,
          index: template.index,
          chunk: template.chunk,
          src: template.src,
          loaded: block !== null && block !== undefined,
          block,
          disabled: level.disabled.has(template.index),
        });
      }
    }
    return rows;
  }

  function memoryReport() {
    const rows = [];
    for (const difficulty of usedLevels) {
      const stats = loader.statsOf(difficulty);
      rows.push({ ...stats, chunkY: difficulty.chunkY });
    }
    return rows;
  }

  return {
    enterDifficulty,
    usePad,
    leave,
    leaveToLobby: leave,
    tick,
    dungeonOf,
    inDungeon,
    reportOf,
    templatesReport,
    memoryReport,
    get ticks() { return ticks; },
  };
}
