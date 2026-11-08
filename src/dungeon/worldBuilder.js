/*
 * The bridge between the logical engine and the Bloxd world.
 *
 * This is the only file that turns a validated room into real blocks, and the
 * only one that talks to `api` for that. It exists so the engine stays testable
 * in Node: everything above it takes plain data, everything below it is this
 * file.
 *
 * Three rules, learned the hard way in this project:
 *
 *   1. never write into a chunk the server has not loaded — the write is lost
 *      silently and the player falls through the floor;
 *   2. never trust a write — read the cell back, and repair it if it is wrong;
 *   3. never write a whole room in one tick — build in batches, keep a cursor,
 *      and resume.
 *
 * The API is injected rather than read from the global scope, so this file can
 * be exercised with a fake: a builder that cannot be tested is a builder whose
 * chunk bugs are only found by players.
 */

import { DUNGEON_CONFIG } from "./engine/config.js";
import {
  BLOCKS,
  BUILD_PHASE,
  createRoomWriter,
  dungeonCellIndex,
  passageBlocks,
  roomBlocks,
} from "./builder.js";

/** States a room's construction goes through, in order. */
export const ROOM_BUILD_STATE = {
  NOT_STARTED: "not_started",
  WAITING_FOR_CHUNK: "waiting_for_chunk",
  BUILDING: "building",
  VERIFYING: "verifying",
  REPAIRING: "repairing",
  BUILT: "built",
  FAILED: "failed",
};

export function createWorldBuilder(options) {
  const world = options.api;
  const log = options.log || (() => {});
  const floorY = options.floorY === undefined ? DUNGEON_CONFIG.floorY : options.floorY;
  if (!Number.isFinite(floorY)) {
    // A missing altitude silently produced writes at `NaN`, which the engine
    // accepted without complaint. Fail loudly instead.
    throw new TypeError(`the floor altitude must be a finite number, got ${floorY}`);
  }
  const batchSize = options.batchSize || DUNGEON_CONFIG.blocksPerBatch;
  const verifyEvery = options.verifyEvery || 8;
  const rooms = new Map();

  /** Chunk identifiers a room's cells touch, so a build can wait for them. */
  function chunksOf(room) {
    const size = DUNGEON_CONFIG.chunkSize;
    const keys = new Set();
    for (let localZ = 0; localZ < room.mask.h; localZ += 1) {
      for (let localX = 0; localX < room.mask.w; localX += 1) {
        if (!room.mask.cells[localZ][localX]) continue;
        keys.add(`${Math.floor((room.origin.x + localX) / size)},${Math.floor((room.origin.y + localZ) / size)}`);
      }
    }
    return keys;
  }

  /**
   * Reads a block, and treats a thrown call as "unknown" rather than as a
   * failure: the engine can refuse reads before a chunk exists, which is
   * information about readiness, not an error.
   */
  function readBlock(x, y, z) {
    try {
      const name = world.getBlock(x, y, z);
      return typeof name === "string" ? name : null;
    } catch (error) {
      log(`getBlock failed at ${x},${y},${z}: ${error && error.message}`);
      return null;
    }
  }

  function writeBlock(x, y, z, name) {
    world.setBlock(x, y, z, name);
  }

  /**
   * Is the room's area loaded?
   *
   * `getBlock` is the only reliable probe: the API has no "is this chunk loaded"
   * call, and `getBlockSolidity` deliberately reports an unloaded chunk as
   * solid, so it cannot be used here.
   */
  function areaLoaded(room) {
    const probes = [];
    for (let localZ = 0; localZ < room.mask.h; localZ += 1) {
      for (let localX = 0; localX < room.mask.w; localX += 1) {
        if (!room.mask.cells[localZ][localX]) continue;
        probes.push({ x: room.origin.x + localX, z: room.origin.y + localZ });
      }
    }
    // Four probes are enough to know the chunks are there, and cheap enough to
    // run every tick.
    const step = Math.max(1, Math.floor(probes.length / 4));
    for (let index = 0; index < probes.length; index += step) {
      if (readBlock(probes[index].x, floorY, probes[index].z) === null) return false;
    }
    return true;
  }

  function stateOf(roomId) {
    return rooms.get(roomId) || null;
  }

  function ensureState(roomId) {
    let state = rooms.get(roomId);
    if (!state) {
      state = {
        state: ROOM_BUILD_STATE.NOT_STARTED,
        cursor: null,
        written: 0,
        total: 0,
        attempts: 0,
        repairs: 0,
      };
      rooms.set(roomId, state);
    }
    return state;
  }

  /**
   * Builds one batch of a room, and returns what happened.
   *
   * The return value always says whether the room is finished, so a caller
   * cannot mistake "waiting for a chunk" for "done".
   */
  function buildBatch(room, buildOptions = {}) {
    const state = ensureState(room.id);
    if (state.state === ROOM_BUILD_STATE.BUILT) {
      return { roomId: room.id, state: state.state, done: true, written: 0 };
    }
    if (state.state === ROOM_BUILD_STATE.FAILED) {
      return { roomId: room.id, state: state.state, done: false, written: 0 };
    }

    if (!areaLoaded(room)) {
      // Nothing is written until the chunks are there: writing earlier loses the
      // blocks without any error.
      state.state = ROOM_BUILD_STATE.WAITING_FOR_CHUNK;
      state.attempts += 1;
      return { roomId: room.id, state: state.state, done: false, written: 0 };
    }

    const world_ = { x: room.origin.x, y: floorY, z: room.origin.y };
    if (!state.writer) {
      state.writer = createRoomWriter({ setBlock: writeBlock }, { batchSize });
      state.total = roomBlocks(room, world_, buildOptions).length;
    }

    state.state = ROOM_BUILD_STATE.BUILDING;
    const step = state.writer.writeRoom(room, world_, state.cursor, buildOptions);
    state.cursor = step.cursor;
    state.written += step.written;

    if (!step.done) {
      return {
        roomId: room.id,
        state: state.state,
        done: false,
        written: step.written,
        progress: state.written / step.total,
      };
    }

    state.state = ROOM_BUILD_STATE.VERIFYING;
    const wrong = verifyRoom(room, world_, buildOptions);
    if (wrong.length === 0) {
      state.state = ROOM_BUILD_STATE.BUILT;
      return { roomId: room.id, state: state.state, done: true, written: step.written };
    }

    // Repair, once. A second failure is a real failure: the room is reported as
    // such instead of being quietly marked ready.
    if (state.repairs >= 1) {
      state.state = ROOM_BUILD_STATE.FAILED;
      log(`room ${room.id} failed verification twice, ${wrong.length} cells wrong`);
      return { roomId: room.id, state: state.state, done: false, written: step.written, wrong };
    }
    state.repairs += 1;
    state.state = ROOM_BUILD_STATE.REPAIRING;
    for (const cell of wrong) writeBlock(cell.x, cell.y, cell.z, cell.expected);
    const recheck = verifyRoom(room, world_, buildOptions);
    if (recheck.length === 0) {
      state.state = ROOM_BUILD_STATE.BUILT;
      return { roomId: room.id, state: state.state, done: true, written: step.written + wrong.length };
    }
    state.state = ROOM_BUILD_STATE.FAILED;
    return { roomId: room.id, state: state.state, done: false, wrong: recheck };
  }

  /**
   * Builds the passage of one connection, in one go.
   *
   * A passage is a handful of cells, so it does not need batching — but it does
   * need the chunk guard, for the same reason a room does: a threshold written
   * into an unloaded chunk is a hole, and the player walks into it from a room
   * they can see.
   *
   * The cell index (who owns what) is recomputed from the manager each time
   * because a connection can be committed while a build is in progress: caching
   * it would let a passage overwrite a room that did not exist when the cache
   * was filled.
   */
  function buildPassage(connection, manager) {
    const key = `passage:${connection.id}`;
    const state = ensureState(key);
    if (state.state === ROOM_BUILD_STATE.BUILT) {
      return { passageId: connection.id, state: state.state, done: true, written: 0 };
    }
    const cells = passageBlocksCells(connection, manager);
    if (!cells.loaded) {
      state.state = ROOM_BUILD_STATE.WAITING_FOR_CHUNK;
      return { passageId: connection.id, state: state.state, done: false, written: 0 };
    }
    const blocks = passageBlocks(connection, { x: 0, y: floorY, z: 0 }, cells.index);
    let written = 0;
    for (let index = 0; index < blocks.length; index += 1) {
      writeBlock(blocks[index].x, blocks[index].y, blocks[index].z, blocks[index].name);
      written += 1;
    }
    // The two doorways themselves. A room built while its opening was still
    // pending had that cell walled — a cul-de-sac has to be a wall — so the
    // moment the opening becomes a real connection, the wall has to come down.
    // Without this the tunnel is built and both ends of it stay sealed: the
    // dungeon looks connected and cannot be walked.
    written += openDoorway(connection.a, manager);
    written += openDoorway(connection.b, manager);
    state.state = ROOM_BUILD_STATE.BUILT;
    state.written = written;
    state.total = written;
    return { passageId: connection.id, state: state.state, done: true, written };
  }

  /**
   * Clears the wall out of one doorway, from the floor to the passage height.
   *
   * The ceiling above the doorway is deliberately left alone: it is the roof of
   * the threshold, and removing it would open the room to the sky.
   */
  function openDoorway(side, manager) {
    const room = manager.getRoom(side.roomId);
    if (!room) return 0;
    const opening = room.openings.find((entry) => entry.id === side.openingId);
    if (!opening) return 0;
    return clearDoorway(room, opening);
  }

  /** Clears one doorway of one room, from the floor to the passage height. */
  function clearDoorway(room, opening) {
    let cleared = 0;
    for (let offset = opening.offsetStart; offset <= opening.offsetEnd; offset += 1) {
      let localX;
      let localZ;
      if (opening.side === "north") { localX = offset; localZ = 0; } else if (opening.side === "south") {
        localX = offset; localZ = room.mask.h - 1;
      } else if (opening.side === "west") { localX = 0; localZ = offset; } else {
        localX = room.mask.w - 1; localZ = offset;
      }
      const x = room.origin.x + localX;
      const z = room.origin.y + localZ;
      for (let level = 1; level <= DUNGEON_CONFIG.passageHeight; level += 1) {
        writeBlock(x, floorY + level, z, BLOCKS.EMPTY);
        cleared += 1;
      }
    }
    return cleared;
  }

  /**
   * Clears every connected doorway of a room that is now fully built.
   *
   * This is not belt and braces, it is the fix for a plan frozen too early: a
   * room's blocks are computed once, when its first batch starts, and a doorway
   * that was still `pending` at that moment is walled in that plan. If the
   * connection is committed afterwards, nothing else would ever remove that
   * wall, and the branch stays sealed even though the tunnel behind it exists.
   */
  function reopenDoorways(room) {
    const state = rooms.get(room.id);
    if (!state || state.state !== ROOM_BUILD_STATE.BUILT) return 0;
    let cleared = 0;
    for (let index = 0; index < room.openings.length; index += 1) {
      const opening = room.openings[index];
      if (opening.status !== "connected") continue;
      cleared += clearDoorway(room, opening);
    }
    return cleared;
  }

  /** The cell index for a connection, and whether its area is loaded. */
  function passageBlocksCells(connection, manager) {
    const rooms = manager.allRooms();
    const index = dungeonCellIndex(rooms, manager.allConnections());
    const walk = index.perConnection.get(connection.id) || [];
    let loaded = true;
    for (let spot = 0; spot < walk.length; spot += 1) {
      if (readBlock(walk[spot].x, floorY, walk[spot].z) === null) {
        loaded = false;
        break;
      }
    }
    return { index, loaded };
  }

  /**
   * Reads back a sample of the room: every pad and every doorway, plus one cell
   * in `verifyEvery`.
   *
   * Never a full rebuild: the point is to catch the write that did not land, not
   * to re-lay the room.
   */
  function verifyRoom(room, world_, buildOptions = {}) {
    const expected = roomBlocks(room, world_, buildOptions);
    const wrong = [];
    for (let index = 0; index < expected.length; index += 1) {
      const block = expected[index];
      const mustCheck = block.phase === BUILD_PHASE.PAD || isDoorwayCell(room, block);
      if (!mustCheck && index % verifyEvery !== 0) continue;
      const actual = readBlock(block.x, block.y, block.z);
      if (actual !== block.name) {
        wrong.push({ x: block.x, y: block.y, z: block.z, expected: block.name, actual });
        if (wrong.length >= 24) break;
      }
    }
    return wrong;
  }

  function isDoorwayCell(room, block) {
    const level = block.y - floorY;
    if (level < 0 || level > DUNGEON_CONFIG.passageHeight) return false;
    const localX = block.x - room.origin.x;
    const localZ = block.z - room.origin.y;
    for (const opening of room.openings) {
      if (opening.status !== "connected") continue;
      const along = opening.side === "north" || opening.side === "south" ? localX : localZ;
      if (along < opening.offsetStart || along > opening.offsetEnd) continue;
      if (opening.side === "north" && localZ === 0) return true;
      if (opening.side === "south" && localZ === room.mask.h - 1) return true;
      if (opening.side === "west" && localX === 0) return true;
      if (opening.side === "east" && localX === room.mask.w - 1) return true;
    }
    return false;
  }

  /**
   * Lays a small landing pad and puts the player on it, in the imposed order:
   * read the cell, teleport to the middle of it, wait, then build.
   *
   * The waiting is done by the caller — this returns the ticks to wait — because
   * the builder has no timer of its own and must not invent one.
   */
  function prepareLanding(playerId, cell) {
    const before = readBlock(cell.x, floorY, cell.z);
    world.setPosition(playerId, [cell.x + 0.5, floorY + 2, cell.z + 0.5]);
    return { before, waitTicks: DUNGEON_CONFIG.chunkWarmupTicks };
  }

  /** Writes the landing pad once the player is standing in the right chunk. */
  function layLandingPad(cell, radius = 2) {
    let written = 0;
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        writeBlock(cell.x + dx, floorY, cell.z + dz, BLOCKS.FLOOR);
        written += 1;
      }
    }
    return written;
  }

  /**
   * Opens a room to the players' pickaxes, block type by block type.
   *
   * Nothing is locked: the world runs in `survivalAdventure`, where a player
   * cannot break a block at all, so the shell is already safe and there is
   * nothing to protect. Locking blocks would only be needed the other way round
   * — to *allow* mining — and the API expresses that as one type at a time
   * (`setCanChangeType`), never as a rectangle.
   *
   * This is therefore the only permission this file will ever ask for, and it
   * asks for none by default: the ore list is empty until ores exist, so the
   * dungeon stays fully sealed and no call is made. When ores land (Phase 5+),
   * listing their block types here is the whole change.
   */
  function allowMining(blockTypes) {
    const allowed = Array.isArray(blockTypes) ? blockTypes : [];
    if (allowed.length === 0) return { allowed: 0, callable: typeof world.setCanChangeType === "function" };
    if (typeof world.setCanChangeType !== "function") {
      log("setCanChangeType is not available: mining stays disabled");
      return { allowed: 0, callable: false };
    }
    let applied = 0;
    for (const blockType of allowed) {
      try {
        // Per type, never by rectangle: an ore is breakable, the stone around it
        // is not, and the two sit in the same cell column.
        world.setCanChangeType(blockType, true);
        applied += 1;
      } catch (error) {
        log(`could not allow mining of ${blockType}: ${error && error.message}`);
      }
    }
    return { allowed: applied, callable: true };
  }

  function forget(roomId) {
    rooms.delete(roomId);
  }

  return {
    buildBatch,
    buildPassage,
    reopenDoorways,
    verifyRoom,
    areaLoaded,
    chunksOf,
    prepareLanding,
    layLandingPad,
    allowMining,
    forget,
    stateOf,
    readBlock,
    writeBlock,
    get floorY() { return floorY; },
    /** The builder object the controller accepts. */
    asControllerBuilder(buildOptions = {}) {
      return {
        buildRoom(room) {
          const result = buildBatch(room, buildOptions);
          // The controller's budget is expressed in blocks, so the cost is
          // reported in blocks — but `done` travels with it. Without it, a room
          // interrupted after its first batch looked finished, and the rest of
          // it was never written.
          return { blocks: result.written || 0, done: result.done === true };
        },
        buildPassage(connection, manager) {
          const result = buildPassage(connection, manager);
          return { blocks: result.written || 0, done: result.done === true };
        },
        reopenDoorways(room) {
          return reopenDoorways(room);
        },
        stateOf(roomId) {
          const state = stateOf(roomId);
          return state ? state.state : ROOM_BUILD_STATE.NOT_STARTED;
        },
      };
    },
  };
}
