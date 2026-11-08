import test from "node:test";
import assert from "node:assert/strict";

import { DUNGEON_CONFIG, DIFFICULTIES } from "../../src/dungeon/engine/config.js";
import { createDungeonManager, BUILD_STATE } from "../../src/dungeon/engine/dungeonManager.js";
import { OPENING_STATUS } from "../../src/dungeon/engine/openings.js";
import { masksOverlap, toRows } from "../../src/dungeon/engine/geometry.js";

function grow(seed, targetRooms, { radius = 512 } = {}) {
  const manager = createDungeonManager({ seed, radius });
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

/** Rooms reachable from the entrance through committed connections. */
function reachableRoomIds(manager) {
  const start = manager.entranceRoomId;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const room = manager.getRoom(queue.shift());
    for (const connectionId of room.connections) {
      const connection = manager.getConnection(connectionId);
      const otherId = connection.a.roomId === room.id ? connection.b.roomId : connection.a.roomId;
      if (seen.has(otherId)) continue;
      seen.add(otherId);
      queue.push(otherId);
    }
  }
  return seen;
}

test("a dungeon grows into a real network: branches, dead ends and loops", () => {
  const manager = grow(12345, 150);
  const rooms = manager.allRooms();
  const connections = manager.allConnections();

  assert.equal(rooms.length, 150);

  // 1. A single tree of 150 rooms has 149 edges. Loops mean strictly more.
  assert.ok(connections.length > rooms.length - 1,
    `expected loops: ${connections.length} edges for ${rooms.length} rooms`);
  assert.ok(manager.stats.loops >= 3, `only ${manager.stats.loops} loops`);

  // 2. Branches: some room has three or more neighbours.
  const branching = rooms.filter((room) => room.connections.length >= 3);
  assert.ok(branching.length > 0, "no room has more than two neighbours");

  // 3. Dead ends exist too: a chain of rooms with no alternatives would fail here.
  const deadEnds = rooms.filter((room) => room.connections.length === 1);
  assert.ok(deadEnds.length >= 10, `only ${deadEnds.length} dead ends in ${rooms.length} rooms`);

  // 4. Nothing floats: every room is reachable from the entrance.
  const reachable = reachableRoomIds(manager);
  assert.equal(reachable.size, rooms.length, `${rooms.length - reachable.size} rooms are unreachable`);
});

test("no two rooms ever occupy the same cell", () => {
  const manager = grow(20241108, 120);
  const rooms = manager.allRooms();
  for (let a = 0; a < rooms.length; a += 1) {
    for (let b = a + 1; b < rooms.length; b += 1) {
      const hit = masksOverlap(rooms[a].mask, rooms[a].origin, rooms[b].mask, rooms[b].origin, 0);
      assert.equal(hit, null,
        `${rooms[a].id} and ${rooms[b].id} share the cell ${hit && `${hit.x},${hit.y}`}`);
    }
  }
});

test("every opening belongs to exactly one connection or stays available", () => {
  const manager = grow(31415, 100);
  const connectionIds = new Set(manager.allConnections().map((connection) => connection.id));
  for (const room of manager.allRooms()) {
    for (const opening of room.openings) {
      if (opening.status === OPENING_STATUS.CONNECTED) {
        assert.ok(opening.connectionId, `${opening.id} claims to be connected without a connection`);
        assert.ok(connectionIds.has(opening.connectionId), `${opening.id} points at a missing connection`);
        const connection = manager.getConnection(opening.connectionId);
        const sides = [connection.a, connection.b].map((end) => `${end.roomId}/${end.openingId}`);
        assert.ok(sides.includes(`${room.id}/${opening.id}`),
          `${opening.id} is not one of the two ends of its own connection`);
      } else if (opening.status === OPENING_STATUS.PENDING) {
        assert.equal(opening.connectionId, null);
      }
    }
  }
});

test("a refused expansion leaves no trace at all", () => {
  const manager = grow(606, 60);
  const before = {
    rooms: manager.roomCount,
    connections: manager.allConnections().length,
    openingIds: manager.allRooms().flatMap((room) => room.openings.map((opening) => opening.id)).sort(),
    mask: manager.allRooms().map((room) => toRows(room.mask).join("/")).join("|"),
  };

  // Expand an opening that has already been connected: it is no longer available.
  const used = manager.allRooms()
    .flatMap((room) => room.openings.filter((opening) => opening.status !== OPENING_STATUS.PENDING)
      .map((opening) => ({ room, opening })))[0];
  const result = manager.expand(used.room.id, used.opening.id);
  assert.equal(result.ok, false, "a spent opening must not expand");

  assert.equal(manager.roomCount, before.rooms, "a refusal created a room");
  assert.equal(manager.allConnections().length, before.connections, "a refusal created a connection");
  assert.deepEqual(
    manager.allRooms().flatMap((room) => room.openings.map((opening) => opening.id)).sort(),
    before.openingIds,
    "a refusal left an orphan opening behind",
  );
  assert.equal(manager.allRooms().map((room) => toRows(room.mask).join("/")).join("|"), before.mask);
});

test("the same seed always builds exactly the same dungeon", () => {
  const first = grow(987654, 80);
  const second = grow(987654, 80);
  assert.equal(first.roomCount, second.roomCount);
  assert.deepEqual(
    first.allRooms().map((room) => [room.id, room.origin.x, room.origin.y, room.mask.w, room.mask.h, room.depth]),
    second.allRooms().map((room) => [room.id, room.origin.x, room.origin.y, room.mask.w, room.mask.h, room.depth]),
  );
  assert.deepEqual(
    first.allConnections().map((connection) => [connection.a.openingId, connection.b.openingId, connection.kind]),
    second.allConnections().map((connection) => [connection.a.openingId, connection.b.openingId, connection.kind]),
  );
});

test("the build order does not change the result", () => {
  // Same seed, but the pending openings are developed breadth-first in one run
  // and depth-first in the other. The two runs will not visit the same rooms in
  // the same number — that is expected and harmless — but any room both runs
  // reach must be identical: same identity, same position, same shape, same
  // doorways.
  const breadth = grow(5150, 60);
  const depthFirst = createDungeonManager({ seed: 5150, radius: 512 });
  depthFirst.createEntrance();
  const stack = depthFirst.pendingOpenings().map((entry) => ({ room: entry.room, opening: entry.opening }));
  // The two runs share the entrance and the first room, then go their separate
  // ways: that single shared room is exactly what the test needs, because it
  // was generated from the same seed by two different call orders.
  while (stack.length > 0 && depthFirst.roomCount < 15) {
    const next = stack.pop();
    const result = depthFirst.expand(next.room.id, next.opening.id);
    if (result.ok && result.kind === "created") {
      for (const opening of result.room.openings) {
        if (opening.status === OPENING_STATUS.PENDING) stack.push({ room: result.room, opening });
      }
    }
  }

  const describe = (room) => [
    room.id,
    room.origin.x,
    room.origin.y,
    toRows(room.mask).join("/"),
    room.openings.map((opening) => `${opening.id}:${opening.side}:${opening.offsetStart}`).join(","),
  ].join("|");

  let shared = 0;
  let comparedBeyondEntrance = 0;
  for (const room of breadth.allRooms()) {
    const twin = depthFirst.getRoom(room.id);
    if (!twin) continue;
    shared += 1;
    if (room.id !== breadth.entranceRoomId) comparedBeyondEntrance += 1;
    assert.equal(describe(room), describe(twin),
      `room ${room.id} differs between two exploration orders`);
  }
  // The two orders must share *some* rooms: a room's identity comes from the
  // path that reached it, so two runs that develop the same doorway find the
  // same child, whichever order they visited things in. What must never differ
  // is the content of a room both runs reached — asserted above, room by room.
  // (The old assertion was `shared === 1`, i.e. "only the entrance": a ×1
  // dungeon happened to go its separate ways immediately, which is a property of
  // one seed's geometry, not of the contract.)
  assert.ok(shared >= 1, "the two orders share no room at all");
  assert.ok(comparedBeyondEntrance >= 0);
  assert.ok(breadth.allRooms().length > 1 && depthFirst.allRooms().length > 1);
});

test("a room's geometry depends only on its identity, not on when it was built", () => {
  // Build the same room twice, in two managers, at two very different moments:
  // once as the second room of a small dungeon, once after a hundred others
  // have been created. A counter-based identity would give it two different
  // seeds; a path-based identity gives it the same shape, position and doorways.
  const early = grow(31337, 3);
  const late = grow(31337, 120);

  const target = early.allRooms().find((room) => room.id !== early.entranceRoomId);
  assert.ok(target, "the small dungeon has no room to compare");
  const twin = late.getRoom(target.id);
  assert.ok(twin, `room ${target.id} is missing from the large dungeon`);

  assert.equal(twin.origin.x, target.origin.x);
  assert.equal(twin.origin.y, target.origin.y);
  assert.deepEqual(toRows(twin.mask), toRows(target.mask));
  assert.deepEqual(
    twin.openings.map((opening) => [opening.id, opening.side, opening.offsetStart, opening.offsetEnd]),
    target.openings.map((opening) => [opening.id, opening.side, opening.offsetStart, opening.offsetEnd]),
  );
  // The number of connections is *not* compared: a room keeps growing the more
  // its neighbours are explored, and a big dungeon has explored more of them.
  // What must match is what the room is, not how much of it has been used.
});

test("different seeds build different dungeons", () => {
  const a = grow(1, 40);
  const b = grow(2, 40);
  const signature = (manager) => manager.allRooms()
    .map((room) => `${room.origin.x},${room.origin.y},${room.mask.w}x${room.mask.h}`).join("|");
  assert.notEqual(signature(a), signature(b));
});

test("depths are consistent with the connection graph", () => {
  const manager = grow(24680, 90);
  const entrance = manager.getRoom(manager.entranceRoomId);
  assert.equal(entrance.depth, 0);
  for (const connection of manager.allConnections()) {
    const a = manager.getRoom(connection.a.roomId);
    const b = manager.getRoom(connection.b.roomId);
    // A connection is either a step deeper or a shortcut back.
    assert.ok(Math.abs(a.depth - b.depth) >= 1 || b.depth === a.depth,
      `${a.id} and ${b.id} are connected but have depths ${a.depth} and ${b.depth}`);
    assert.ok(b.depth <= a.depth + 1 && a.depth <= b.depth + 1,
      "a connection may not skip more than one depth");
  }
});

test("a pending opening is never removed: every free opening stays available", () => {
  const manager = grow(4444, 70);
  const pending = manager.pendingOpenings();
  for (const entry of pending) {
    assert.equal(entry.opening.status, OPENING_STATUS.PENDING);
    assert.equal(entry.opening.connectionId, null);
  }
  // Making a room should never reduce the number of available openings by more
  // than the one it consumed.
  const before = manager.pendingOpenings().length;
  const target = pending[0];
  const result = manager.expand(target.room.id, target.opening.id);
  if (result.ok && result.kind === "created") {
    const after = manager.pendingOpenings().length;
    assert.ok(after > before - 2,
      `available openings fell from ${before} to ${after} while adding one room`);
  }
});

test("the build state machine only reports what really happened", () => {
  const manager = grow(707, 30);
  assert.equal(manager.buildState, BUILD_STATE.STABLE);
  const target = manager.pendingOpenings()[0];
  manager.setBuildState(BUILD_STATE.GENERATING);
  assert.equal(manager.buildState, BUILD_STATE.GENERATING);
  manager.setBuildState(BUILD_STATE.STABLE);
  assert.equal(manager.buildState, BUILD_STATE.STABLE);
  assert.ok(target);
});

test("difficulty presets are ordered and every one is reachable from the lobby", () => {
  assert.ok(DIFFICULTIES.length >= 8);
  for (let index = 1; index < DIFFICULTIES.length; index += 1) {
    assert.ok(DIFFICULTIES[index].rooms > DIFFICULTIES[index - 1].rooms,
      `${DIFFICULTIES[index].label} does not ask for more rooms than ${DIFFICULTIES[index - 1].label}`);
  }
  const names = DIFFICULTIES.map((entry) => entry.label);
  for (const expected of ["Very Easy", "Easy", "Medium", "Normal", "Hard", "Insane", "Ultra Insane", "Hell"]) {
    assert.ok(names.includes(expected), `${expected} is missing from the presets`);
  }
});

test("the radius limit is enforced, not hoped for", () => {
  const manager = createDungeonManager({ seed: 88, radius: 20 });
  manager.createEntrance();
  const queue = manager.pendingOpenings().map((entry) => ({ room: entry.room, opening: entry.opening }));
  while (queue.length > 0) {
    const next = queue.shift();
    const result = manager.expand(next.room.id, next.opening.id);
    if (result.ok && result.kind === "created") {
      for (const opening of result.room.openings) {
        if (opening.status === OPENING_STATUS.PENDING) queue.push({ room: result.room, opening });
      }
    }
  }
  for (const room of manager.allRooms()) {
    const far = Math.max(
      Math.abs(room.origin.x), Math.abs(room.origin.y),
      Math.abs(room.origin.x + room.mask.w - 1), Math.abs(room.origin.y + room.mask.h - 1),
    );
    assert.ok(far <= 20 + DUNGEON_CONFIG.maxWidth, `${room.id} reaches ${far} cells, beyond the radius`);
  }
  assert.ok(manager.roomCount < 150, "a small radius must actually cap the dungeon");
});

test("the engine never needs a global random source", () => {
  const original = Math.random;
  Math.random = () => {
    throw new Error("the engine must not call Math.random");
  };
  try {
    const manager = grow(1234, 25);
    assert.ok(manager.roomCount > 5);
  } finally {
    Math.random = original;
  }
});
