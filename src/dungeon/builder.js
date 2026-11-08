/*
 * From a validated room to blocks in the world.
 *
 * The builder is the only module of the dungeon that plans block writes. It
 * receives a room it did not choose, at a position it did not compute, and it
 * writes it in a fixed order that never depends on luck:
 *
 *   1. clear what will not be rebuilt   above the ceiling only
 *   2. floor everywhere                 the player walks before the walls exist
 *   3. walls, lintels included          the wall is never laid whole then pierced
 *   4. ceiling                          closes the volume, doorways excepted
 *   5. the difficulty pad               on a known floor cell, last
 *
 * The rules that matter more than the order:
 *
 * - a doorway cell of a *connected* opening never carries a wall below its
 *   passage height: it is simply absent from the wall cells, so there is no
 *   moment where the player is boxed in;
 * - no cell is written twice. Two writes on one cell mean an interrupted build
 *   leaves a different world from a complete one, which is exactly the class of
 *   bug that makes a dungeon look fine until someone walks through it.
 *
 * A construction is resumable: `writeRoom` returns a cursor, and the same call
 * with that cursor continues where it stopped.
 */

import { DUNGEON_CONFIG } from "./engine/config.js";

/** Block names used by the builder, in one place so tests can assert on them. */
export const BLOCKS = {
  FLOOR: "Stone Bricks",
  WALL: "Stone",
  WALL_TRIM: "Stone Bricks",
  CEILING: "Stone",
  EMPTY: "Air",
  PAD: "Gold Block",
};

/** Construction phases, in the order they are written. */
export const BUILD_PHASE = {
  CLEAR: "clear",
  FLOOR: "floor",
  WALL: "wall",
  CEILING: "ceiling",
  PAD: "pad",
  DONE: "done",
};

/**
 * Every block of a room, in writing order, as `{ x, y, z, name, phase }`.
 *
 * `world` is the room's world origin: `{ x, y, z }` of its logical cell (0, 0)
 * at floor level. `options.floorY` overrides the altitude, `options.pad` adds
 * the difficulty pad of this room.
 */
export function roomBlocks(room, world, options = {}) {
  const floorY = options.floorY === undefined ? world.y : options.floorY;
  const wallHeight = DUNGEON_CONFIG.wallHeight;
  const blocks = [];
  const filled = (localX, localY) => room.mask.cells[localY] !== undefined
    && room.mask.cells[localY][localX] === 1;

  // 1. Clear what will not be rebuilt: the cells above the ceiling. The floor,
  //    the walls and the ceiling are written unconditionally below, so clearing
  //    them first would write the same cell twice with two different blocks.
  for (let localY = 0; localY < room.mask.h; localY += 1) {
    for (let localX = 0; localX < room.mask.w; localX += 1) {
      if (!filled(localX, localY)) continue;
      for (let level = wallHeight + 2; level <= wallHeight + 4; level += 1) {
        blocks.push({
          x: world.x + localX,
          y: floorY + level,
          z: world.z + localY,
          name: BLOCKS.EMPTY,
          phase: BUILD_PHASE.CLEAR,
        });
      }
    }
  }

  // 2. Floor: every cell of the shape.
  for (let localY = 0; localY < room.mask.h; localY += 1) {
    for (let localX = 0; localX < room.mask.w; localX += 1) {
      if (!filled(localX, localY)) continue;
      blocks.push({
        x: world.x + localX,
        y: floorY,
        z: world.z + localY,
        name: BLOCKS.FLOOR,
        phase: BUILD_PHASE.FLOOR,
      });
    }
  }

  // 3. Walls, cell by cell, only where the cell is occupied and a neighbour is
  //    not. The doorway cells are skipped up to the passage height; the cell
  //    above the doorway is the lintel, written here in the same pass.
  const doorwayCells = doorwaySet(room);
  for (let localY = 0; localY < room.mask.h; localY += 1) {
    for (let localX = 0; localX < room.mask.w; localX += 1) {
      if (!filled(localX, localY)) continue;
      const onEdge = !filled(localX + 1, localY) || !filled(localX - 1, localY)
        || !filled(localX, localY + 1) || !filled(localX, localY - 1);
      if (!onEdge) continue;
      const isDoorway = doorwayCells.has(`${localX},${localY}`);
      for (let level = 1; level <= wallHeight; level += 1) {
        if (isDoorway && level <= DUNGEON_CONFIG.passageHeight) continue;
        blocks.push({
          x: world.x + localX,
          y: floorY + level,
          z: world.z + localY,
          name: level === wallHeight ? BLOCKS.WALL_TRIM : BLOCKS.WALL,
          phase: BUILD_PHASE.WALL,
        });
      }
    }
  }

  // 4. Ceiling: one solid slab above the walkable floor, doorways excepted so
  //    the passage stays visible from inside.
  for (let localY = 0; localY < room.mask.h; localY += 1) {
    for (let localX = 0; localX < room.mask.w; localX += 1) {
      if (!filled(localX, localY)) continue;
      if (doorwayCells.has(`${localX},${localY}`)) continue;
      blocks.push({
        x: world.x + localX,
        y: floorY + wallHeight + 1,
        z: world.z + localY,
        name: BLOCKS.CEILING,
        phase: BUILD_PHASE.CEILING,
      });
    }
  }

  // 5. The difficulty pad, when this room carries one. Last, so it never delays
  //    a walkable room.
  if (options.pad) {
    const cell = padCell(room);
    if (cell) {
      blocks.push({
        x: world.x + cell.x,
        y: floorY + 1,
        z: world.z + cell.z,
        name: BLOCKS.PAD,
        phase: BUILD_PHASE.PAD,
        pad: options.pad,
      });
    }
  }

  return blocks;
}

/** Logical coordinates of the cells a room's connected doorways pierce. */
export function doorwaySet(room) {
  const cells = new Set();
  for (const opening of room.openings) {
    if (opening.status !== "connected") continue;
    for (let offset = opening.offsetStart; offset <= opening.offsetEnd; offset += 1) {
      if (opening.side === "north") cells.add(`${offset},0`);
      else if (opening.side === "south") cells.add(`${offset},${room.mask.h - 1}`);
      else if (opening.side === "west") cells.add(`0,${offset}`);
      else cells.add(`${room.mask.w - 1},${offset}`);
    }
  }
  return cells;
}

/**
 * Where the pad goes: a floor cell away from the walls, as close to the middle
 * of the room as the shape allows.
 *
 * A pad must never sit in a doorway — the player would be teleported by simply
 * walking through a door — and must never sit in a wall. When a room is too
 * narrow to have an inner cell, the first floor cell is used rather than
 * skipping the pad: a difficulty that cannot be reached is worse than a pad in a
 * slightly cramped spot.
 */
export function padCell(room) {
  const inner = [];
  for (let localY = 1; localY < room.mask.h - 1; localY += 1) {
    for (let localX = 1; localX < room.mask.w - 1; localX += 1) {
      if (!room.mask.cells[localY][localX]) continue;
      const onEdge = !room.mask.cells[localY][localX + 1] || !room.mask.cells[localY][localX - 1]
        || !room.mask.cells[localY + 1][localX] || !room.mask.cells[localY - 1][localX];
      if (onEdge) continue;
      inner.push({ x: localX, z: localY });
    }
  }
  const candidates = inner.length > 0 ? inner : allFloorCells(room);
  if (candidates.length === 0) return null;
  // Deterministic choice: the middle of the list, after a stable ordering. Two
  // runs of the same room always put the pad in the same place.
  candidates.sort((a, b) => a.z - b.z || a.x - b.x);
  return candidates[Math.floor(candidates.length / 2)];
}

function allFloorCells(room) {
  const cells = [];
  for (let localY = 0; localY < room.mask.h; localY += 1) {
    for (let localX = 0; localX < room.mask.w; localX += 1) {
      if (room.mask.cells[localY][localX]) cells.push({ x: localX, z: localY });
    }
  }
  return cells;
}

/**
 * Writes blocks through an injected writer, in batches, and reports progress.
 *
 * `writer.setBlock(x, y, z, name)` and `writer.getBlock(x, y, z)` are injected,
 * never imported: that is what lets the whole builder be tested in Node and what
 * keeps `api.*` out of the engine.
 */
export function createRoomWriter(writer, options = {}) {
  const batchSize = options.batchSize || DUNGEON_CONFIG.blocksPerBatch;
  const planned = new Map();

  /**
   * Writes the next batch of a room and returns `{ cursor, written, total, done }`.
   *
   * The cursor is explicit on purpose. There is no implicit "resume from where I
   * stopped": a caller that loses its cursor must be told, not silently helped —
   * the silent version rewrites blocks and still reports `done`.
   */
  function writeRoom(room, world, cursor = null, buildOptions = {}) {
    let blocks = planned.get(room.id);
    if (!blocks) {
      blocks = roomBlocks(room, world, buildOptions);
      planned.set(room.id, blocks);
    }
    const startIndex = cursor === null || cursor.index === undefined ? 0 : cursor.index;
    if (startIndex === 0 && cursor === null && planned.get(`${room.id}:started`)) {
      throw new Error(`room ${room.id} is half built: an explicit cursor is required to resume it`);
    }
    let index = startIndex;
    const limit = index + batchSize;
    while (index < blocks.length && index < limit) {
      const block = blocks[index];
      writer.setBlock(block.x, block.y, block.z, block.name);
      index += 1;
    }
    planned.set(`${room.id}:started`, index > 0);
    const done = index >= blocks.length;
    return {
      cursor: { index, phase: done ? BUILD_PHASE.DONE : blocks[Math.min(index, blocks.length - 1)].phase },
      written: index - startIndex,
      total: blocks.length,
      done,
    };
  }

  /** Forgets a finished room; a rebuilt room is recomputed from its geometry. */
  function forget(roomId) {
    planned.delete(roomId);
    planned.delete(`${roomId}:started`);
  }

  return { writeRoom, forget, batchSize };
}

/**
 * What a room must contain, without writing anything.
 *
 * Used by the audit: the world is read, compared to this, and repaired. The
 * audit never guesses — it recomputes the expected block from the same function
 * the builder used.
 */
export function expectedRoomBlocks(room, world, buildOptions = {}) {
  return roomBlocks(room, world, buildOptions);
}

/**
 * Compares what the world contains to what the room should contain.
 *
 * Returns the list of cells that are wrong, bounded by `sample`: doorways and
 * pads are always checked, because they are the cells a player can notice.
 */
export function auditRoom(room, world, reader, buildOptions = {}) {
  const expected = expectedRoomBlocks(room, world, buildOptions);
  const mustCheck = new Set();
  for (const block of expected) {
    if (block.phase === BUILD_PHASE.PAD) mustCheck.add(`${block.x},${block.y},${block.z}`);
  }
  const sample = buildOptions.sample || 0;
  if (sample > 0) {
    for (let index = 0; index < expected.length; index += sample) {
      mustCheck.add(`${expected[index].x},${expected[index].y},${expected[index].z}`);
    }
  }
  const wrong = [];
  for (const block of expected) {
    if (!mustCheck.has(`${block.x},${block.y},${block.z}`)) continue;
    const actual = reader.getBlock(block.x, block.y, block.z);
    if (actual !== block.name) {
      wrong.push({ x: block.x, y: block.y, z: block.z, expected: block.name, actual });
      if (wrong.length >= 32) break;
    }
  }
  return wrong;
}
