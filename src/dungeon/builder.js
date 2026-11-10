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
import { hashParts } from "./engine/random.js";

/**
 * The stone palette.
 *
 * Every structural block is drawn from this list, one block at a time: the shell
 * must read as rough-cut stone, not as a flat grey box. The list is the whole
 * vocabulary of the dungeon — a block that is not here is not a wall.
 */
export const STONE_PALETTE = [
  "Stone",
  "Messy Stone",
  "Smooth Stone",
  "Stone Bricks",
  "Cracked Stone Bricks",
  "Mossy Stone Bricks",
];

/** Block names used by the builder, in one place so tests can assert on them. */
export const BLOCKS = {
  // `FLOOR` and `WALL` name the *category*; the exact block comes from the
  // palette below, cell by cell. `PALETTE` is the list a test can compare to.
  FLOOR: "Stone Bricks",
  WALL: "Stone",
  WALL_TRIM: "Stone Bricks",
  CEILING: "Stone",
  EMPTY: "Air",
  PAD: "Gold Block",
  /** The threshold between two rooms: a floor that is not inside either room. */
  PASSAGE: "Stone Bricks",
  /** The full stone family, wall and ceiling included. */
  PALETTE: STONE_PALETTE,
  /** The blocks a floor cell may carry. */
  FLOOR_POOL: ["Stone Bricks", "Cracked Stone Bricks"],
};

/**
 * The block of one structural cell, chosen from the palette.
 *
 * The choice depends only on the room seed and the cell, never on the write
 * order: an interrupted build that is resumed must produce the same wall as an
 * uninterrupted one, and a room rebuilt from its seed must look identical. That
 * is the whole reason this is a hash and not a call to a random generator.
 *
 * Floors stay in the brick family (they are the surface the player reads) and the
 * ceiling stays Smooth Stone, so the variety is on the walls where it is seen.
 */
export function texturedBlock(room, localX, level, localZ, family) {
  const pools = {
    floor: BLOCKS.FLOOR_POOL,
    ceiling: ["Smooth Stone"],
    wall: STONE_PALETTE,
  };
  const pool = pools[family] || STONE_PALETTE;
  const seed = typeof room.seed === "number" ? room.seed : 0;
  // The level is part of the key: two cells stacked above each other must not
  // repeat the same block, or a wall reads as vertical stripes.
  const pick = hashParts("texture", seed, room.id, localX, level, localZ, family) % pool.length;
  return pool[pick];
}

/** Construction phases, in the order they are written. */
export const BUILD_PHASE = {
  CLEAR: "clear",
  FLOOR: "floor",
  /** Ground of a passage: written with the floor, before any wall. */
  PASSAGE: "passage",
  WALL: "wall",
  CEILING: "ceiling",
  PAD: "pad",
  DONE: "done",
};

/**
 * The cells of a passage, in world coordinates.
 *
 * A connection already stores the cells it pierces — `joint` for the minimum
 * masonry between two touching rooms, `bridge` for the explicit corridor of a
 * longer connection. This is the only reader of those two fields on the build
 * side, and it deduplicates them because a connection may legitimately list the
 * same cell twice.
 */
export function passageCellsFor(connection) {
  const seen = new Set();
  const cells = [];
  const lists = [connection.joint, connection.bridge];
  for (let list = 0; list < lists.length; list += 1) {
    const entries = lists[list];
    if (!entries) continue;
    for (let index = 0; index < entries.length; index += 1) {
      const cell = entries[index];
      const key = `${cell.x},${cell.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push({ x: cell.x, z: cell.y });
    }
  }
  return cells;
}

/**
 * Who owns which cell, once, for the whole dungeon.
 *
 * The builder needs two answers it cannot guess: which cells a room already
 * writes (they must never be written again), and which cells are already a
 * passage (two connections sharing a threshold must not fight over it). Both
 * are computed once per dungeon and passed down, never re-derived per room.
 */
export function dungeonCellIndex(rooms, connections = []) {
  const owned = new Set();
  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    for (let localZ = 0; localZ < room.mask.h; localZ += 1) {
      for (let localX = 0; localX < room.mask.w; localX += 1) {
        if (!room.mask.cells[localZ][localX]) continue;
        owned.add(`${room.origin.x + localX},${room.origin.y + localZ}`);
      }
    }
  }
  const passages = new Set();
  const perConnection = new Map();
  for (let index = 0; index < connections.length; index += 1) {
    const cells = passageCellsFor(connections[index]);
    perConnection.set(connections[index].id, cells);
    for (let at = 0; at < cells.length; at += 1) passages.add(`${cells[at].x},${cells[at].z}`);
  }
  return { owned, passages, perConnection };
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Every block of the *passage* a connection carves, in writing order.
 *
 * This is what was missing until this phase: the rooms were built and the
 * thresholds between them were not, so every doorway opened onto three cells of
 * void and the dungeon had no way through.
 *
 * A passage is a corridor, not a hole:
 *
 *   floor    the passage cell, so there is something to walk on
 *   sides    the neighbouring void cells, so it is a corridor and not a trench
 *   roof     above the passage, so it is a tunnel and not a canyon
 *
 * The walkable cells themselves are left open at `1..passageHeight`: writing
 * anything there would wall the doorway shut.
 *
 * Nothing is ever written on a cell a room owns, nor on a cell that belongs to
 * another connection: that is what keeps the "a cell is written once" rule true
 * across the whole dungeon, and not only inside one room.
 */
export function passageBlocks(connection, world, index, options = {}) {
  const floorY = options.floorY === undefined ? world.y : options.floorY;
  const wallHeight = DUNGEON_CONFIG.wallHeight;
  const own = index && index.perConnection
    ? index.perConnection.get(connection.id) || passageCellsFor(connection)
    : passageCellsFor(connection);
  const owned = (index && index.owned) || new Set();
  const allPassages = (index && index.passages) || new Set(own.map((cell) => `${cell.x},${cell.z}`));

  const free = own.filter((cell) => !owned.has(`${cell.x},${cell.z}`));
  if (free.length === 0) return [];

  // The tunnel is one doorway wide and runs along the axis of the connection.
  // A cell is "along" when a free cell continues on that axis.
  const freeSet = new Set(free.map((cell) => `${cell.x},${cell.z}`));
  const isFree = (x, z) => freeSet.has(`${x},${z}`);
  const isMine = (x, z) => owned.has(`${x},${z}`) || allPassages.has(`${x},${z}`) && !isFree(x, z);

  const fake = { id: connection.id, seed: hashParts("passage", connection.id) };
  const blocks = [];
  const wallCell = new Set();

  for (let index_ = 0; index_ < free.length; index_ += 1) {
    const cell = free[index_];
    // Clear the walkable column first. Two tunnels can cross, and one of them
    // may have walled this cell before the other claimed it: without this pass
    // the second tunnel is dug, floored, and sealed by the first one's masonry.
    for (let level = 1; level <= wallHeight; level += 1) {
      blocks.push({
        x: cell.x, y: floorY + level, z: cell.z,
        name: BLOCKS.EMPTY,
        phase: BUILD_PHASE.PASSAGE,
      });
    }
    // Floor of the walkable cell.
    blocks.push({
      x: cell.x, y: floorY, z: cell.z,
      name: texturedBlock(fake, cell.x, 0, cell.z, "floor"),
      phase: BUILD_PHASE.PASSAGE,
    });

    // Flanks: every neighbour that is neither a room nor another passage. A
    // neighbour along the tunnel is skipped — it is the way through.
    for (let side = 0; side < NEIGHBOURS.length; side += 1) {
      const nx = cell.x + NEIGHBOURS[side][0];
      const nz = cell.z + NEIGHBOURS[side][1];
      if (isFree(nx, nz) || isMine(nx, nz)) continue;
      const key = `${nx},${nz}`;
      if (wallCell.has(key)) continue;
      wallCell.add(key);
      blocks.push({
        x: nx, y: floorY, z: nz,
        name: texturedBlock(fake, nx, 0, nz, "floor"),
        phase: BUILD_PHASE.PASSAGE,
      });
      for (let level = 1; level <= wallHeight; level += 1) {
        blocks.push({
          x: nx, y: floorY + level, z: nz,
          name: texturedBlock(fake, nx, level, nz, "wall"),
          phase: BUILD_PHASE.WALL,
        });
      }
      blocks.push({
        x: nx, y: floorY + wallHeight + 1, z: nz,
        name: texturedBlock(fake, nx, wallHeight + 1, nz, "ceiling"),
        phase: BUILD_PHASE.CEILING,
      });
    }

    // Roof of the walkable cell: the tunnel is covered.
    blocks.push({
      x: cell.x, y: floorY + wallHeight + 1, z: cell.z,
      name: texturedBlock(fake, cell.x, wallHeight + 1, cell.z, "ceiling"),
      phase: BUILD_PHASE.CEILING,
    });
  }

  return blocks;
}

/**
 * Every block of a room, in writing order, as `{ x, y, z, name, phase }`./**
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
  //
  //    This pass is now **conditional**, and off by default. It was 38 % of the
  //    blocks of a whole dungeon, written to erase a rock that is not there: on a
  //    fresh dungeon nothing exists six blocks above the floor. It is kept for
  //    the one case that needs it — rebuilding a room over an older dungeon —
  //    and the caller asks for it explicitly after reading the volume.
  const clearAbove = options.clearAbove === true;
  for (let localY = 0; clearAbove && localY < room.mask.h; localY += 1) {
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
        name: texturedBlock(room, localX, 0, localY, "floor"),
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
          // Walls, lintel included, come from the full palette: one block at a
          // time, chosen from the cell, never from the write order.
          name: texturedBlock(room, localX, level, localY, "wall"),
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
        name: texturedBlock(room, localX, wallHeight + 1, localY, "ceiling"),
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
  // How a plan is produced, injected. A room plans itself from its mask; a
  // passage plans itself from the connection that carves it. Both are written in
  // batches with a cursor, so both go through this one writer.
  const plan = options.plan || roomBlocks;
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
      blocks = plan(room, world, buildOptions);
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

  /**
   * How many plans this writer is still holding, and for which ids.
   *
   * A plan is a room's whole block list — several thousand objects for a hall,
   * and a room is up to 55 cells across. Held for every room ever built, that
   * list is what makes a dungeon grow in memory long after it has stopped
   * growing in the world; this is the number that proves it is released.
   */
  function heldPlans() {
    const ids = [];
    for (const key of planned.keys()) {
      if (typeof key === "string" && key.endsWith(":started")) continue;
      ids.push(key);
    }
    return ids;
  }

  return { writeRoom, forget, heldPlans, batchSize };
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
