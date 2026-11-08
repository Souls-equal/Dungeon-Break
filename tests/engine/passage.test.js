import test from "node:test";
import assert from "node:assert/strict";

import { createDungeonManager } from "../../src/dungeon/engine/dungeonManager.js";
import { OPENING_STATUS, passageCells, jointCells } from "../../src/dungeon/engine/openings.js";
import { passageIsWalkable, REFUSAL, validateRoom } from "../../src/dungeon/engine/validator.js";
import { clearanceMap, createMask, fromRows, toRows, walkablePath } from "../../src/dungeon/engine/geometry.js";
import { DUNGEON_CONFIG } from "../../src/dungeon/engine/config.js";

function grow(seed, targetRooms) {
  const manager = createDungeonManager({ seed, radius: 512 });
  manager.createEntrance();
  const queue = manager.pendingOpenings().map((entry) => ({ room: entry.room, opening: entry.opening }));
  while (queue.length > 0 && manager.roomCount < targetRooms) {
    const next = queue.shift();
    const result = manager.expand(next.room.id, next.opening.id);
    if (result.ok && result.kind === "created") {
      for (const opening of result.room.openings) {
        if (opening.status === OPENING_STATUS.PENDING) queue.push({ room: result.room, opening });
      }
    }
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
  const mask = fromRows(["111", "111", "111"]);
  const otherMask = fromRows(["111", "111", "111"]);
  const openings = [
    openingAt("candidate.o0", "south", 1, 1, {
      faceLength: mask.w, width: DUNGEON_CONFIG.minPassageWidth,
    }),
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
  // Two blobs in one bounding box, joined by nothing.
  const mask = fromRows(["111000", "110000", "000111", "000111"]);
  const openings = [
    openingAt("candidate.o0", "north", 1, 1, { centerY: 0, faceLength: mask.w }),
    openingAt("candidate.o1", "south", 4, 4, { centerX: 4, centerY: 3, faceLength: mask.w }),
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
    // from one to the other with no gap in between.
    assert.equal(cells.length, DUNGEON_CONFIG.wallGap + 2,
      `a joint of ${DUNGEON_CONFIG.wallGap} must span ${DUNGEON_CONFIG.wallGap + 2} cells including both doorways`);
    // Consecutive cells are neighbours: no teleport.
    for (let index = 1; index < cells.length; index += 1) {
      const distance = Math.abs(cells[index].x - cells[index - 1].x)
        + Math.abs(cells[index].y - cells[index - 1].y);
      assert.equal(distance, 1, "the passage has a hole in it");
    }
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
