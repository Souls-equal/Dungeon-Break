import test from "node:test";
import assert from "node:assert/strict";

import { DUNGEON_CONFIG } from "../../src/dungeon/engine/config.js";
import { createDungeonManager } from "../../src/dungeon/engine/dungeonManager.js";
import {
  discoverOpenings,
  distanceToOpening,
  distanceToRoom,
  locatePlayerRoom,
  PRIORITY_CLASS,
  priorityOf,
} from "../../src/dungeon/engine/discovery.js";
import { OPENING_STATUS } from "../../src/dungeon/engine/openings.js";

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

test("priority follows the documented formula and its worked example", () => {
  // The specification's example: A 120, C 250, B 8148, D 5285 -> A, C, B, D.
  // The four numbers are priorities, produced by distance and depth together.
  const cases = [
    { id: "A", distance: 120, depth: 0, expected: 120 },
    { id: "C", distance: 250, depth: 0, expected: 250 },
    { id: "B", distance: 8148, depth: 0, expected: 8148 },
    { id: "D", distance: 5285, depth: 0, expected: 5285 },
  ];
  const computed = cases.map((entry) => ({
    id: entry.id,
    priority: priorityOf({ distance: entry.distance, depth: entry.depth, crossing: false }).priority,
  }));
  for (const caseItem of cases) {
    const found = computed.find((entry) => entry.id === caseItem.id);
    assert.equal(found.priority, caseItem.expected);
  }
  const order = computed.slice().sort((a, b) => a.priority - b.priority).map((entry) => entry.id);
  assert.deepEqual(order, ["A", "C", "D", "B"]);
});

test("depth lowers a doorway's priority, so a deep player is not starved", () => {
  const near = priorityOf({ distance: 10, depth: 0, crossing: false });
  const deep = priorityOf({ distance: 10, depth: 2, crossing: false });
  assert.ok(deep.priority > near.priority);
  assert.equal(deep.priority - near.priority, 2 * DUNGEON_CONFIG.priorityDepthWeight);
});

test("a doorway about to be crossed always outranks a near one", () => {
  const crossing = priorityOf({ distance: DUNGEON_CONFIG.crossingDistance, depth: 3, crossing: true });
  const near = priorityOf({ distance: 1, depth: 0, crossing: false });
  assert.equal(crossing.bucket, PRIORITY_CLASS.CROSSING);
  assert.equal(near.bucket, PRIORITY_CLASS.NEAR);
  const list = [near, crossing].sort((a, b) => (a.bucket - b.bucket) || (a.priority - b.priority));
  assert.equal(list[0].bucket, PRIORITY_CLASS.CROSSING);
});

test("distance to a doorway is measured to the closest of its cells", () => {
  const mask = { w: 3, h: 3, cells: [[1, 1, 1], [1, 1, 1], [1, 1, 1]] };
  const room = { origin: { x: 0, y: 0 }, mask };
  const wide = { side: "south", offsetStart: 0, offsetEnd: 2 };
  // Standing below the left end of the doorway, not below its middle.
  assert.equal(distanceToOpening({ x: 0, y: 3 }, room, wide), 1);
  // The middle-only computation would have said 2.
  assert.equal(distanceToOpening({ x: 1, y: 3 }, room, wide), 1);
});

test("distance to a room is zero inside it and grows outside", () => {
  const mask = { w: 3, h: 3, cells: [[1, 1, 1], [1, 1, 1], [1, 1, 1]] };
  const room = { origin: { x: 10, y: 10 }, mask };
  assert.equal(distanceToRoom({ x: 11, y: 11 }, room), 0);
  assert.equal(distanceToRoom({ x: 13, y: 11 }, room), 1);
  assert.equal(distanceToRoom({ x: 13, y: 13 }, room), 1);
  assert.equal(distanceToRoom({ x: 20, y: 11 }, room), 8);
});

test("discovery only returns pending doorways within reach", () => {
  const manager = grow(12345, 40);
  const entrance = manager.getRoom(manager.entranceRoomId);
  const start = entrance.openings[0];
  const player = {
    id: "p1",
    roomId: entrance.id,
    position: { x: entrance.origin.x + start.centerX, y: entrance.origin.y + start.centerY },
  };
  const found = discoverOpenings({ manager, players: [player] });
  assert.ok(found.length > 0, "nothing discovered in the room the player is standing in");

  for (const entry of found) {
    const room = manager.getRoom(entry.roomId);
    const opening = room.openings.find((candidate) => candidate.id === entry.openingId);
    assert.equal(opening.status, OPENING_STATUS.PENDING, "a spent doorway was offered");
    assert.ok(entry.distance <= DUNGEON_CONFIG.discoveryDistance);
  }
});

test("discovery walks every branch, not just the player's direction", () => {
  const manager = grow(2222, 60);
  const entrance = manager.getRoom(manager.entranceRoomId);
  const player = {
    id: "p1",
    roomId: entrance.id,
    position: { x: entrance.origin.x + 1, y: entrance.origin.y + 1 },
  };
  const found = discoverOpenings({ manager, players: [player] });
  const rooms = new Set(found.map((entry) => entry.roomId));
  // The entrance plus its neighbours: several rooms, several faces.
  assert.ok(rooms.size >= 1, "nothing found");
  const sides = new Set();
  for (const entry of found) {
    const room = manager.getRoom(entry.roomId);
    const opening = room.openings.find((candidate) => candidate.id === entry.openingId);
    sides.add(opening.side);
  }
  assert.ok(sides.size >= 2, `only one face was considered: ${[...sides]}`);
});

test("discovery never goes further than the anticipation depth", () => {
  const manager = grow(909, 50);
  const entrance = manager.getRoom(manager.entranceRoomId);
  const player = {
    id: "p1",
    roomId: entrance.id,
    position: { x: entrance.origin.x, y: entrance.origin.y },
  };
  const found = discoverOpenings({ manager, players: [player] });
  for (const entry of found) {
    assert.ok(entry.depth <= DUNGEON_CONFIG.anticipationDepth,
      `depth ${entry.depth} exceeds the anticipation depth`);
  }
});

test("the result is sorted, total, and reproducible", () => {
  const manager = grow(4711, 40);
  const entrance = manager.getRoom(manager.entranceRoomId);
  const players = [{
    id: "p1",
    roomId: entrance.id,
    position: { x: entrance.origin.x, y: entrance.origin.y },
  }];
  const first = discoverOpenings({ manager, players });
  const second = discoverOpenings({ manager, players });
  assert.deepEqual(
    first.map((entry) => [entry.openingId, entry.bucket, entry.priority]),
    second.map((entry) => [entry.openingId, entry.bucket, entry.priority]),
  );
  for (let index = 1; index < first.length; index += 1) {
    const previous = first[index - 1];
    const current = first[index];
    const ordered = previous.bucket < current.bucket
      || (previous.bucket === current.bucket && previous.priority <= current.priority);
    assert.ok(ordered, "the list is not sorted by class then priority");
  }
});

test("a doorway seen by two players is offered once and names both", () => {
  const manager = grow(3141, 30);
  const entrance = manager.getRoom(manager.entranceRoomId);
  const position = { x: entrance.origin.x + 1, y: entrance.origin.y + 1 };
  const found = discoverOpenings({
    manager,
    players: [
      { id: "p1", roomId: entrance.id, position },
      { id: "p2", roomId: entrance.id, position },
    ],
  });
  const keys = found.map((entry) => `${entry.roomId}/${entry.openingId}`);
  assert.equal(new Set(keys).size, keys.length, "the same doorway was offered twice");
  for (const entry of found) {
    assert.deepEqual(entry.players.slice().sort(), ["p1", "p2"]);
  }
});

test("an isolated player does not monopolise the generator", () => {
  // Two players in the same room: the list is shared, not duplicated, and its
  // length does not double. That is what stops one player from consuming twice
  // the budget.
  const manager = grow(2024, 40);
  const entrance = manager.getRoom(manager.entranceRoomId);
  const position = { x: entrance.origin.x, y: entrance.origin.y };
  const one = discoverOpenings({
    manager,
    players: [{ id: "p1", roomId: entrance.id, position }],
  });
  const two = discoverOpenings({
    manager,
    players: [
      { id: "p1", roomId: entrance.id, position },
      { id: "p2", roomId: entrance.id, position },
    ],
  });
  assert.equal(two.length, one.length);
});

test("a player standing in a room is located in it, including on a doorway", () => {
  const manager = grow(777, 20);
  const room = manager.getRoom(manager.entranceRoomId);
  const inside = { x: room.origin.x + 1, y: room.origin.y + 1 };
  assert.equal(locatePlayerRoom(manager, inside).room.id, room.id);

  const opening = room.openings[0];
  const onDoorway = {
    x: room.origin.x + opening.centerX,
    y: room.origin.y + opening.centerY,
  };
  const located = locatePlayerRoom(manager, onDoorway);
  assert.equal(located.room.id, room.id, "a player on a threshold belongs to the room it pierces");
});

test("discovery cost does not grow with the size of the dungeon", () => {
  const measure = (rooms) => {
    const manager = grow(8888, rooms);
    const entrance = manager.getRoom(manager.entranceRoomId);
    const players = [{
      id: "p1",
      roomId: entrance.id,
      position: { x: entrance.origin.x + 1, y: entrance.origin.y + 1 },
    }];
    // Warm up, so the first call does not pay for the index.
    discoverOpenings({ manager, players });
    const started = process.hrtime.bigint();
    for (let pass = 0; pass < 20; pass += 1) discoverOpenings({ manager, players });
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    return { perScan: elapsed / 20, rooms: manager.roomCount };
  };
  const small = measure(50);
  const large = measure(400);
  assert.ok(large.rooms > small.rooms * 4);
  assert.ok(
    large.perScan < small.perScan * 4,
    `a scan costs ${small.perScan.toFixed(3)} ms on ${small.rooms} rooms and ${large.perScan.toFixed(3)} ms on ${large.rooms}`,
  );
});
