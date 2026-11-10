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
  /** Rooms finished but not yet read back. One is audited per tick, at most. */
  const auditQueue = [];

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

  /** Anchors already written by this builder: `x,y,z`. Declared before the
   * function that consults them, because a guard is easier to trust when the set
   * it reads is right above it. */
  const sealedAnchors = new Set();
  const anchorKey = (x, y, z) => `${x},${y},${z}`;

  /**
   * Writes one block, except where the write would destroy a chunk's record.
   *
   * A chunk's data lives on one block — its anchor — and the API clears that data
   * when the block changes. So the anchor cell is written **once**, before its
   * data exists, and every later write to it is skipped: the dungeon's structure
   * is written cell by cell and at most once per cell anyway, so nothing is
   * actually dropped; this is the guard that makes the promise true even for a
   * repair pass.
   */
  function writeBlock(x, y, z, name) {
    if (isSealedAnchor(x, y, z)) return;
    world.setBlock(x, y, z, name);
  }

  /**
   * Writes the anchor of a chunk, once.
   *
   * Called by the chunk store when it wants to put a record somewhere: the block
   * is written here, through the same guard as everything else, and from then on
   * it is sealed — `writeBlock` will not touch it again, so the data set on it
   * afterwards is never cleared. A second call for the same cell does nothing and
   * says so.
   */
  function writeAnchor(x, y, z, name) {
    const key = anchorKey(x, y, z);
    if (sealedAnchors.has(key)) return false;
    // The block may already be there because a *room* wrote it (the anchor cell is
    // a structural cell when a room covers it). Writing it again would clear the
    // data, so it is left exactly as it is: only the seal is added.
    const current = readBlock(x, y, z);
    if (current !== name) world.setBlock(x, y, z, name);
    sealedAnchors.add(key);
    return true;
  }

  function isSealedAnchor(x, y, z) {
    return sealedAnchors.has(anchorKey(x, y, z));
  }

  /**
   * Is the room's area loaded?
   *
   * `getBlock` is the only reliable probe: the API has no "is this chunk loaded"
   * call, and `getBlockSolidity` deliberately reports an unloaded chunk as
   * solid, so it cannot be used here.
   */
  function areaLoaded(room) {
    // The probes are the room's **corners**, not four samples spread over its
    // cells. A sample every N cells walks along the mask in reading order and can
    // land four times inside the same corner of a large room; at ×5 a room is up
    // to 55 cells across, and four middle probes said "loaded" while the far
    // opposite corner was still in a chunk the server had not sent — the writes
    // there are dropped without an error, which is the one bug this whole file
    // exists to prevent.
    const corners = [];
    for (let localZ = 0; localZ < room.mask.h; localZ += 1) {
      for (let localX = 0; localX < room.mask.w; localX += 1) {
        if (!room.mask.cells[localZ][localX]) continue;
        const onEdgeX = localX === 0 || localX === room.mask.w - 1
          || !room.mask.cells[localZ][localX - 1] || !room.mask.cells[localZ][localX + 1];
        const onEdgeZ = localZ === 0 || localZ === room.mask.h - 1
          || !room.mask.cells[localZ - 1]?.[localX] || !room.mask.cells[localZ + 1]?.[localX];
        if (onEdgeX || onEdgeZ) corners.push({ x: room.origin.x + localX, z: room.origin.y + localZ });
      }
    }
    // Four extreme contour cells: the four corners of the room's bounding box are
    // what a chunk boundary cuts first, and they are cheap enough to read on
    // every tick. When a shape has fewer than four contour cells (impossible for
    // a real room, possible for a test), the few it has are used.
    const box = {
      x0: Math.min(...corners.map((cell) => cell.x)),
      x1: Math.max(...corners.map((cell) => cell.x)),
      z0: Math.min(...corners.map((cell) => cell.z)),
      z1: Math.max(...corners.map((cell) => cell.z)),
    };
    const probes = [
      { x: box.x0, z: box.z0 },
      { x: box.x1, z: box.z0 },
      { x: box.x0, z: box.z1 },
      { x: box.x1, z: box.z1 },
    ];
    for (let index = 0; index < probes.length; index += 1) {
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
        audits: 0,
        pendingAudit: false,
        clearedAbove: false,
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
      // Ask the world whether there is anything to clear above this room, once,
      // instead of writing a clearance pass over its whole footprint. The read is
      // a handful of cells; the pass was four blocks per cell of the room.
      const clearAbove = needsClearAbove(room);
      state.clearedAbove = clearAbove;
      buildOptions = { ...buildOptions, clearAbove };
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

    // The room is complete. It is *not* verified here any more: reading back
    // costs a `getBlock` per checked cell, and doing it inside the build step
    // spent build budget on reading. It is queued for the audit instead, which
    // runs one room per tick with its own cost.
    state.state = ROOM_BUILD_STATE.BUILT;
    state.pendingAudit = true;
    auditQueue.push(room.id);
    return { roomId: room.id, state: state.state, done: true, written: step.written };
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
    if (!state.writer) {
      state.writer = createRoomWriter({ setBlock: writeBlock }, {
        batchSize,
        plan: (passage, world_) => passageBlocks(connection, world_, cells.index),
      });
      state.total = passageBlocks(connection, { x: 0, y: floorY, z: 0 }, cells.index).length;
    }
    // A passage is written in **batches**, like a room. At ×5 a joint is 15 cells
    // long and 5 wide with a roof and two flanks: about four thousand blocks,
    // which used to be written in a single tick with no budget and no resume. The
    // cursor makes it interruptible like everything else.
    const step = state.writer.writeRoom({ id: key }, { x: 0, y: floorY, z: 0 }, state.cursor);
    state.cursor = step.cursor;
    state.written += step.written;
    if (!step.done) {
      state.state = ROOM_BUILD_STATE.BUILDING;
      return { passageId: connection.id, state: state.state, done: false, written: step.written, progress: state.written / state.total };
    }
    // The two doorways themselves. A room built while its opening was still
    // pending had that cell walled — a cul-de-sac has to be a wall — so the
    // moment the opening becomes a real connection, the wall has to come down.
    // Without this the tunnel is built and both ends of it stay sealed: the
    // dungeon looks connected and cannot be walked. Done once, at the end, so a
    // half-built passage does not open onto a hole.
    let doors = openDoorway(connection.a, manager);
    doors += openDoorway(connection.b, manager);
    state.state = ROOM_BUILD_STATE.BUILT;
    state.written += doors;
    return { passageId: connection.id, state: state.state, done: true, written: step.written + doors };
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
   * Is there anything at all above this room's ceiling?
   *
   * Four probes per room are enough to answer a boolean: a dungeon built on empty
   * air has air everywhere up there, and a room rebuilt over an older one has
   * rock everywhere. Reading four cells is cheaper than writing four blocks per
   * cell of the footprint, which is what the unconditional clearance pass did.
   */
  function needsClearAbove(room) {
    const level = floorY + DUNGEON_CONFIG.wallHeight + 3;
    const probes = [
      { x: room.origin.x, z: room.origin.y },
      { x: room.origin.x + room.mask.w - 1, z: room.origin.y },
      { x: room.origin.x, z: room.origin.y + room.mask.h - 1 },
      { x: room.origin.x + room.mask.w - 1, z: room.origin.y + room.mask.h - 1 },
    ];
    for (let index = 0; index < probes.length; index += 1) {
      const name = readBlock(probes[index].x, level, probes[index].z);
      if (name !== null && name !== BLOCKS.EMPTY) return true;
    }
    return false;
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
  /**
   * Lays the small pad the player lands on.
   *
   * The default radius follows the dungeon's scale: 5×5 cells was what a
   * one-cell-wide dungeon needed to give the player a solid spot underfoot; at
   * ×5 the same pad is 21×21, because a 5×5 island in the middle of a 55-cell
   * hall reads as a tile the player was placed on by mistake. Callers must not
   * pass a radius of their own — that is how the pad stayed at 5×5 when the
   * rooms grew.
   *
   * `room` clips the pad to the room's own footprint. Without it the square
   * spills through the entrance's walls: on a thin shape — the entrance can be a
   * cross with a seven-cell bar — most of the pad lands outside the hall, and the
   * player sees a slab of floor lying in the rock, in the corridor, and against
   * the next room's wall. The landing cell is chosen near the middle of the room
   * for the same reason, but a room can be thinner than the pad is wide, so the
   * clip is what actually guarantees it.
   */
  function layLandingPad(cell, options = {}) {
    const radius = options.radius === undefined ? DUNGEON_CONFIG.scale * 2 : options.radius;
    const room = options.room || null;
    let written = 0;
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (room) {
          const localX = cell.x + dx - room.origin.x;
          const localZ = cell.z + dz - room.origin.y;
          if (!room.mask.cells[localZ] || !room.mask.cells[localZ][localX]) continue;
        }
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

  /**
   * Audits one finished room, and repairs it once if needed.
   *
   * The verification is deliberately out of the build path: reading back a room
   * is the price of trusting it, not the price of building it, and mixing the
   * two made a tick that wrote 800 blocks also read 40 cells. One room per tick
   * is enough to catch a write the server dropped, and it never delays the build.
   *
   * Returns `null` when there is nothing to audit.
   */
  function auditNext(roomsById) {
    while (auditQueue.length > 0) {
      const roomId = auditQueue.shift();
      const state = rooms.get(roomId);
      if (!state || state.state !== ROOM_BUILD_STATE.BUILT || !state.pendingAudit) continue;
      const room = roomsById ? roomsById(roomId) : null;
      if (!room) continue;
      state.pendingAudit = false;
      const world_ = { x: room.origin.x, y: floorY, z: room.origin.y };
      const options_ = { clearAbove: state.clearedAbove === true };
      const wrong = verifyRoom(room, world_, options_);
      if (wrong.length === 0) {
        state.audits += 1;
        return { roomId, repaired: 0, verified: true };
      }
      if (state.repairs >= 1) {
        state.state = ROOM_BUILD_STATE.FAILED;
        log(`room ${roomId} failed its audit, ${wrong.length} cells wrong`);
        return { roomId, repaired: 0, verified: false };
      }
      state.repairs += 1;
      for (const cell of wrong) writeBlock(cell.x, cell.y, cell.z, cell.expected);
      // Repairing is not the same as having repaired: the cells are read back,
      // and a world that drops the writes anyway is reported as failed instead
      // of passing for good.
      const stillWrong = verifyRoom(room, world_, options_);
      state.audits += 1;
      if (stillWrong.length > 0) {
        state.state = ROOM_BUILD_STATE.FAILED;
        log(`room ${roomId} still has ${stillWrong.length} wrong cell(s) after repair`);
        return { roomId, repaired: wrong.length, verified: false };
      }
      return { roomId, repaired: wrong.length, verified: true };
    }
    return null;
  }

  function forget(roomId) {
    rooms.delete(roomId);
  }

  return {
    buildBatch,
    buildPassage,
    reopenDoorways,
    auditNext,
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
    writeAnchor,
    isSealedAnchor,
    /** How many anchors this builder has sealed, so a caller can report it. */
    get sealedAnchorCount() { return sealedAnchors.size; },
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
        auditRoom(manager) {
          return auditNext((roomId) => (manager ? manager.getRoom(roomId) : null));
        },
        stateOf(roomId) {
          const state = stateOf(roomId);
          return state ? state.state : ROOM_BUILD_STATE.NOT_STARTED;
        },
      };
    },
  };
}
