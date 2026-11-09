import test from "node:test";
import assert from "node:assert/strict";

import { createDungeonManager } from "../../src/dungeon/engine/dungeonManager.js";
import { OPENING_STATUS, passageCells, jointCells } from "../../src/dungeon/engine/openings.js";
import { passageIsWalkable, REFUSAL, validateRoom } from "../../src/dungeon/engine/validator.js";
import { clearanceMap, createMask, fromRows, toRows, walkablePath } from "../../src/dungeon/engine/geometry.js";
import { DUNGEON_CONFIG } from "../../src/dungeon/engine/config.js";


/**
 * Grows a dungeon one room at a time, from the manager's own frontier.
 *
 * The frontier is re-read on every step on purpose: the manager is the only place
 * that knows which doorways are still pending. A mirrored queue holds the graph as
 * it was when the room was created — before the room closed its loops and before
 * an attempt blocked a doorway — so it keeps asking for doorways that no longer
 * exist and starves the ones that do. That is how a dungeon ends up with a single
 * trunk and no doors left to develop.
 */
function grow(seed, targetRooms) {
  const manager = createDungeonManager({ seed, radius: 512 });
  manager.createEntrance();
  while (manager.roomCount < targetRooms) {
    const pending = manager.pendingOpenings();
    if (pending.length === 0) break;
    manager.expand(pending[0].room.id, pending[0].opening.id);
  }
  return manager;
}

/**
 * Floor cells of the whole dungeon: every room cell, plus every joint and every
 * bridge an explicit connection declares. Nothing else is walkable.
 */
function floorOf(manager) {
  const floor = new Set();
  for (const room of manager.allRooms()) {
    for (let y = 0; y < room.mask.h; y += 1) {
      for (let x = 0; x < room.mask.w; x += 1) {
        if (room.mask.cells[y][x]) floor.add(`${room.origin.x + x},${room.origin.y + y}`);
      }
    }
  }
  for (const connection of manager.allConnections()) {
    if (connection.kind === "direct") {
      const room = manager.getRoom(connection.a.roomId);
      const opening = room.openings.find((entry) => entry.id === connection.a.openingId);
      for (const cell of jointCells(room, opening)) floor.add(`${cell.x},${cell.y}`);
    } else {
      for (const cell of connection.bridge) floor.add(`${cell.x},${cell.y}`);
    }
  }
  return floor;
}

/** The doorway cell just inside a room, the natural place to start walking. */
function insideCell(room, opening) {
  return {
    x: room.origin.x + opening.centerX - opening.vectorX,
    y: room.origin.y + opening.centerY - opening.vectorY,
  };
}

test("walking the whole dungeon from the entrance reaches every doorway", () => {
  for (const seed of [12345, 777, 2024]) {
    const manager = grow(seed, 80);
    const floor = floorOf(manager);
    const entrance = manager.getRoom(manager.entranceRoomId);
    const start = insideCell(entrance, entrance.openings[0]);

    const seen = new Set([`${start.x},${start.y}`]);
    const queue = [start];
    while (queue.length > 0) {
      const cell = queue.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${cell.x + dx},${cell.y + dy}`;
        if (seen.has(key) || !floor.has(key)) continue;
        seen.add(key);
        queue.push({ x: cell.x + dx, y: cell.y + dy });
      }
    }

    for (const room of manager.allRooms()) {
      for (const opening of room.openings) {
        if (opening.status !== OPENING_STATUS.CONNECTED) continue;
        const cell = insideCell(room, opening);
        assert.ok(seen.has(`${cell.x},${cell.y}`),
          `seed ${seed}: the doorway ${opening.id} of ${room.id} cannot be reached on foot`);
      }
    }
  }
});

test("a doorway is walkable from one room to the next through the joint", () => {
  const manager = grow(4321, 40);
  let checked = 0;
  for (const connection of manager.allConnections()) {
    if (connection.kind !== "direct") continue;
    const roomA = manager.getRoom(connection.a.roomId);
    const roomB = manager.getRoom(connection.b.roomId);
    const openingA = roomA.openings.find((entry) => entry.id === connection.a.openingId);
    const openingB = roomB.openings.find((entry) => entry.id === connection.b.openingId);
    assert.equal(passageIsWalkable(roomA, openingA, roomB, openingB), true,
      `the passage ${openingA.id} -> ${openingB.id} is not walkable`);
    checked += 1;
  }
  assert.ok(checked > 10, "not enough direct connections to be meaningful");
});

test("the validator refuses a room that would sit on top of another", () => {
  // A room large enough to host a legal doorway. The size is not decorative: a
  // doorway is `minPassageWidth` cells wide with `minCornerClearance` on each
  // side, so a face shorter than `width + 2 × clearance` cannot host one at all,
  // and the validator would answer OPENING_IN_CORNER before ever looking at the
  // collision this test is about.
  const width = DUNGEON_CONFIG.minPassageWidth;
  const corner = DUNGEON_CONFIG.minCornerClearance;
  const side = corner * 2 + width + 2;
  const mask = solidMask(side, side);
  const otherMask = solidMask(side, side);
  const openings = [
    openingAt("candidate.o0", "south", corner, corner + width - 1, { centerX: corner, centerY: side - 1, width, faceLength: mask.w }),
    openingAt("candidate.o1", "north", corner, corner + width - 1, { centerX: corner, centerY: 0, width, faceLength: mask.w }),
  ];
  const verdict = validateRoom({
    candidate: { mask, origin: { x: 0, y: 0 }, openings },
    nearby: [{ id: "other", origin: { x: 1, y: 1 }, mask: otherMask, openings: [] }],
    parent: null,
    childOpening: null,
    radius: 512,
    clearances: clearanceMap(mask),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, REFUSAL.COLLISION_CELL);
});

test("the validator refuses a doorway that opens into a hole", () => {
  // The north face has a hole at x=1: a doorway there would lead into the void.
  const mask = fromRows(["101", "111", "111"]);
  const openings = [openingAt("candidate.o0", "north", 1, 1, { faceLength: mask.w })];
  const verdict = validateRoom({
    candidate: { mask, origin: { x: 0, y: 0 }, openings },
    nearby: [],
    parent: null,
    childOpening: null,
    radius: 512,
    clearances: clearanceMap(mask),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, REFUSAL.OPENING_NOT_ON_CONTOUR);
});

test("the validator refuses a room beyond the allocated radius", () => {
  const mask = fromRows(["11", "11"]);
  const verdict = validateRoom({
    candidate: {
      mask,
      origin: { x: 500, y: 0 },
      openings: [openingAt("candidate.o0", "south", 0, 1)],
    },
    nearby: [],
    parent: null,
    childOpening: null,
    radius: 100,
    clearances: clearanceMap(mask),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, REFUSAL.OUT_OF_BOUNDS);
});

test("a room whose openings cannot reach each other is refused", () => {
  // Two blobs in one bounding box, joined by nothing. Each blob is large enough
  // to host a legal doorway on two facing walls, so the only thing wrong with
  // the candidate is what this test is about: no walk between the two doors.
  const width = DUNGEON_CONFIG.minPassageWidth;
  const corner = DUNGEON_CONFIG.minCornerClearance;
  const blob = corner * 2 + width + 2;
  const side = blob * 2 + 2;
  const rows = [];
  for (let y = 0; y < side; y += 1) {
    let row = "";
    for (let x = 0; x < side; x += 1) {
      const inTop = y < blob && x < blob;
      const inBottom = y > blob && x > blob;
      row += inTop || inBottom ? "1" : "0";
    }
    rows.push(row);
  }
  const mask = fromRows(rows);
  const openings = [
    openingAt("candidate.o0", "north", corner, corner + width - 1, { centerX: corner, centerY: 0, width, faceLength: mask.w }),
    openingAt("candidate.o1", "south", side - blob + corner, side - blob + corner + width - 1,
      { centerX: side - blob + corner, centerY: side - 1, width, faceLength: mask.w }),
  ];
  const verdict = validateRoom({
    candidate: { mask, origin: { x: 0, y: 0 }, openings },
    nearby: [],
    parent: null,
    childOpening: null,
    radius: 512,
    clearances: clearanceMap(mask),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, REFUSAL.ROOM_DISCONNECTED);
});

test("a passage is carved, not assumed: the cells between two doorways exist", () => {
  const manager = grow(999, 30);
  for (const connection of manager.allConnections()) {
    if (connection.kind !== "direct") continue;
    const roomA = manager.getRoom(connection.a.roomId);
    const roomB = manager.getRoom(connection.b.roomId);
    const openingA = roomA.openings.find((entry) => entry.id === connection.a.openingId);
    const openingB = roomB.openings.find((entry) => entry.id === connection.b.openingId);
    const cells = passageCells(openingA, roomA.origin, openingB, roomB.origin);
    // The doorway cells themselves are on the room walls: the passage spans
    // from one to the other with no gap in between, and it is as wide as the
    // doorway. Hence (joint + both doorways) × width cells, and not one cell per
    // row: a three-cell-wide corridor is three cells per row.
    assert.equal(cells.length, (DUNGEON_CONFIG.wallGap + 2) * openingA.width,
      `a joint of ${DUNGEON_CONFIG.wallGap} must span ${DUNGEON_CONFIG.wallGap + 2} rows of ${openingA.width} cells`);
    // The passage is one connected corridor: no cell of it is cut off. Walked
    // with four-way steps, because a corridor two cells wide listed row by row
    // does not have consecutive-adjacent entries — its second row starts three
    // columns away from where the first one ended.
    const set = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
    const seen = new Set([`${cells[0].x},${cells[0].y}`]);
    const queue = [cells[0]];
    while (queue.length > 0) {
      const cell = queue.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${cell.x + dx},${cell.y + dy}`;
        if (!set.has(key) || seen.has(key)) continue;
        seen.add(key);
        queue.push({ x: cell.x + dx, y: cell.y + dy });
      }
    }
    assert.equal(seen.size, cells.length, "the passage has a hole in it");
  }
});

test("a mask with a one-cell hole is never walkable through it", () => {
  const mask = fromRows(["111", "101", "111"]);
  const clearances = clearanceMap(mask);
  const reachable = walkablePath(mask, { x: 0, y: 0 }, { x: 2, y: 2 }, 1);
  assert.ok(reachable);
  for (const cell of reachable) {
    assert.notDeepEqual(cell, { x: 1, y: 1 }, "the walk went through the hole");
  }
});

function solidMask(width, height) {
  const rows = [];
  for (let y = 0; y < height; y += 1) rows.push("1".repeat(width));
  return fromRows(rows);
}

function openingAt(id, side, offsetStart, offsetEnd, extra = {}) {
  const vectors = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  const [vectorX, vectorY] = vectors[side];
  const width = extra.width === undefined ? 1 : extra.width;
  return {
    id,
    roomId: "candidate",
    side,
    centerX: extra.centerX === undefined ? offsetStart : extra.centerX,
    centerY: extra.centerY === undefined ? offsetEnd : extra.centerY,
    vectorX,
    vectorY,
    width,
    height: DUNGEON_CONFIG.passageHeight,
    offsetStart,
    offsetEnd,
    status: OPENING_STATUS.PENDING,
    connectionId: null,
    failures: 0,
  };
}

// ------------------------------------------------- corridors are straight ---

/**
 * Every connection, checked on the cells it actually carves: one straight run
 * across the gap, exactly as wide as the two doorways it joins, and nothing else.
 *
 * This is the regression test for "the corridors sometimes stick out and block
 * part of the entrance". Three separate bugs produced that picture, and all three
 * showed up as a corridor whose width differed from the doorway it left: the
 * bridge was carved from a doorway span *before* the doorway was narrowed to the
 * shared cells, so a four-cell door could have a five-cell corridor through it.
 */
test("every corridor is one straight run, exactly as wide as both its doorways", () => {
  let checked = 0;
  for (const seed of [12345, 777, 2024, 31337, 4242]) {
    const manager = grow(seed, 30);
    for (const connection of manager.allConnections()) {
      const roomA = manager.getRoom(connection.a.roomId);
      const roomB = manager.getRoom(connection.b.roomId);
      const openingA = roomA.openings.find((entry) => entry.id === connection.a.openingId);
      const openingB = roomB.openings.find((entry) => entry.id === connection.b.openingId);
      const cells = [...connection.joint, ...connection.bridge];
      if (cells.length === 0) continue;
      checked += 1;

      const vertical = openingA.side === "north" || openingA.side === "south";
      const along = [...new Set(cells.map((cell) => (vertical ? cell.x : cell.y)))].sort((a, b) => a - b);
      const across = [...new Set(cells.map((cell) => (vertical ? cell.y : cell.x)))].sort((a, b) => a - b);

      // 1. Straight: one row of cells along the corridor's own axis.
      assert.equal(cells.length % along.length, 0, `${connection.id}: the corridor is not a rectangle`);
      assert.equal(cells.length / along.length, across.length, `${connection.id}: the corridor is ragged`);

      // 2. As wide as the doorways, which are the holes the player walks through.
      const doorA = openingA.offsetEnd - openingA.offsetStart + 1;
      const doorB = openingB.offsetEnd - openingB.offsetStart + 1;
      assert.equal(along.length, doorA, `${connection.id}: ${along.length}-cell corridor through a ${doorA}-cell door`);
      assert.equal(along.length, doorB, `${connection.id}: ${along.length}-cell corridor out of a ${doorB}-cell door`);
      assert.equal(connection.width, doorA, `${connection.id}: the connection claims ${connection.width}, the door is ${doorA}`);

      // 3. Contiguous: no gap in the run. A missing cell is a wall in a corridor.
      for (let index = 1; index < along.length; index += 1) {
        assert.equal(along[index], along[index - 1] + 1, `${connection.id}: the corridor has a gap`);
      }
      // 4. And it reaches exactly from one room's wall to the other's.
      const edgeA = vertical
        ? roomA.origin.y + (openingA.side === "north" ? 0 : roomA.mask.h - 1)
        : roomA.origin.x + (openingA.side === "west" ? 0 : roomA.mask.w - 1);
      const edgeB = vertical
        ? roomB.origin.y + (openingB.side === "north" ? 0 : roomB.mask.h - 1)
        : roomB.origin.x + (openingB.side === "west" ? 0 : roomB.mask.w - 1);
      assert.equal(across[0], Math.min(edgeA, edgeB) + 1, `${connection.id}: the corridor starts away from the wall`);
      assert.equal(across[across.length - 1], Math.max(edgeA, edgeB) - 1,
        `${connection.id}: the corridor stops short of the wall, or runs past it`);
    }
  }
  assert.ok(checked >= 100, `only ${checked} corridors were inspected, so the test proves nothing`);
});

test("no corridor is ever built through a third room", () => {
  let checked = 0;
  for (const seed of [12345, 777, 2024, 31337, 4242]) {
    const manager = grow(seed, 30);
    const rooms = manager.allRooms();
    for (const connection of manager.allConnections()) {
      for (const cell of [...connection.joint, ...connection.bridge]) {
        for (const room of rooms) {
          if (room.id === connection.a.roomId || room.id === connection.b.roomId) continue;
          const localX = cell.x - room.origin.x;
          const localY = cell.y - room.origin.y;
          const inside = room.mask.cells[localY] && room.mask.cells[localY][localX];
          assert.ok(!inside, `${connection.id} runs through ${room.id} at ${cell.x},${cell.y}`);
        }
        checked += 1;
      }
    }
  }
  assert.ok(checked > 0, "no corridor cell was inspected");
});

// ------------------------------------------- rooms can still be connected ---

test("every generated room could still host a doorway", () => {
  // Sizes are drawn from a ladder of bands, so this is a property of the ladder
  // and not of one lucky draw: the narrowest side any band allows has to be able
  // to carry `minOpenings` doorways with their corner clearance.
  for (let index = 0; index < DUNGEON_CONFIG.sizeBands.length; index += 1) {
    const band = DUNGEON_CONFIG.sizeBands[index];
    const smallestFace = Math.min(band[1], band[2]);
    const needed = DUNGEON_CONFIG.minPassageWidth + 2 * DUNGEON_CONFIG.minCornerClearance;
    assert.ok(smallestFace >= needed,
      `band ${index} draws a ${band[1]}-cell side, which cannot host a ${DUNGEON_CONFIG.minPassageWidth}-cell doorway`);
  }
});
