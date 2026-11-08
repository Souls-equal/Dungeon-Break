import test from "node:test";
import assert from "node:assert/strict";

import { DUNGEON_CONFIG } from "../../src/dungeon/engine/config.js";
import { createDungeonManager } from "../../src/dungeon/engine/dungeonManager.js";
import {
  canConnectDirectly,
  OPENING_STATUS,
} from "../../src/dungeon/engine/openings.js";
import { createSpatialIndex } from "../../src/dungeon/engine/spatialIndex.js";
import { masksOverlap } from "../../src/dungeon/engine/geometry.js";

/**
 * Reference implementation of "which openings can connect", written the slow,
 * obvious way: every opening against every other. The index must return a
 * superset of this, and the validator must agree with it.
 */
function referencePairs(rooms) {
  const pairs = [];
  for (const roomA of rooms) {
    for (const openingA of roomA.openings) {
      if (openingA.status !== OPENING_STATUS.PENDING) continue;
      for (const roomB of rooms) {
        if (roomB.id === roomA.id) continue;
        for (const openingB of roomB.openings) {
          if (openingB.status !== OPENING_STATUS.PENDING) continue;
          if (!canConnectDirectly(openingA, roomA.origin, roomA.mask, openingB, roomB.origin, roomB.mask)) continue;
          pairs.push(`${openingA.id}|${openingB.id}`);
        }
      }
    }
  }
  return pairs;
}

function referenceOverlaps(rooms) {
  const clashes = [];
  for (let a = 0; a < rooms.length; a += 1) {
    for (let b = a + 1; b < rooms.length; b += 1) {
      const hit = masksOverlap(rooms[a].mask, rooms[a].origin, rooms[b].mask, rooms[b].origin, 0);
      if (hit) clashes.push(`${rooms[a].id}|${rooms[b].id}`);
    }
  }
  return clashes;
}

function growDungeon(seed, targetRooms) {
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

test("the opening index finds every connectable pair the slow search finds", () => {
  for (const seed of [12345, 999, 2024]) {
    const manager = growDungeon(seed, 120);
    const rooms = manager.allRooms();
    const expected = new Set(referencePairs(rooms));

    const found = new Set();
    for (const room of rooms) {
      for (const opening of room.openings) {
        if (opening.status !== OPENING_STATUS.PENDING) continue;
        const record = manager.index.openingFacing(room, opening, room.id);
        if (!record) continue;
        found.add(`${opening.id}|${record.opening.id}`);
      }
    }

    for (const pair of expected) {
      assert.ok(found.has(pair), `seed ${seed}: the index missed the pair ${pair}`);
    }
  }
});

test("the spatial index returns every room that really overlaps", () => {
  const manager = growDungeon(4242, 150);
  const rooms = manager.allRooms();
  assert.deepEqual(referenceOverlaps(rooms), [], "no two committed rooms may share a cell");

  // Growing a room's query must never miss a neighbour the slow test would see.
  for (const room of rooms) {
    const rect = {
      x1: room.origin.x,
      y1: room.origin.y,
      x2: room.origin.x + room.mask.w - 1,
      y2: room.origin.y + room.mask.h - 1,
    };
    const nearby = new Set(manager.index.queryRect(rect).map((entry) => entry.id));
    for (const other of rooms) {
      if (other.id === room.id) continue;
      const hit = masksOverlap(room.mask, room.origin, other.mask, other.origin, 0);
      if (hit) assert.ok(nearby.has(other.id), `${other.id} overlaps ${room.id} but was not returned`);
    }
  }
});

test("the index forgets a room once it is removed", () => {
  const index = createSpatialIndex();
  const manager = growDungeon(777, 20);
  for (const room of manager.allRooms()) index.insert(room);
  assert.equal(index.size, manager.roomCount);

  const victim = manager.allRooms()[0];
  index.remove(victim.id);
  assert.equal(index.size, manager.roomCount - 1);
  assert.equal(index.has(victim.id), false);
  // Its openings must be gone too: a stale opening index is how a ghost
  // connection appears.
  for (const opening of victim.openings) {
    assert.equal(index.openingFacing(victim, opening, victim.id), null);
  }
});

test("index cost does not grow with the number of rooms", () => {
  const small = growDungeon(31337, 60);
  const large = growDungeon(31337, 200);

  const measure = (manager) => {
    const rooms = manager.allRooms();
    const started = process.hrtime.bigint();
    let hits = 0;
    for (let pass = 0; pass < 40; pass += 1) {
      for (const room of rooms) {
        for (const opening of room.openings) {
          if (opening.status !== OPENING_STATUS.PENDING) continue;
          if (manager.index.openingFacing(room, opening, room.id)) hits += 1;
        }
      }
    }
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    return { elapsed, hits, rooms: rooms.length };
  };

  const a = measure(small);
  const b = measure(large);
  // Three times the rooms must not mean three times the cost per lookup.
  const perRoomSmall = a.elapsed / (a.rooms * 40);
  const perRoomLarge = b.elapsed / (b.rooms * 40);
  assert.ok(
    perRoomLarge < perRoomSmall * 4,
    `per-room lookup cost grew from ${perRoomSmall.toFixed(4)} ms to ${perRoomLarge.toFixed(4)} ms`,
  );
});

test("a blocked opening is never returned as a reusable partner", () => {
  const manager = growDungeon(5150, 40);
  const rooms = manager.allRooms();
  for (const room of rooms) {
    for (const opening of room.openings) {
      if (opening.status === OPENING_STATUS.PENDING) continue;
      const record = manager.index.openingFacing(room, opening, room.id);
      if (!record) continue;
      assert.notEqual(record.opening.status, OPENING_STATUS.BLOCKED);
      assert.notEqual(record.opening.status, OPENING_STATUS.CONNECTED);
    }
  }
});

test("wallGap is honoured by every committed connection", () => {
  const manager = growDungeon(8888, 120);
  for (const connection of manager.allConnections()) {
    const roomA = manager.getRoom(connection.a.roomId);
    const roomB = manager.getRoom(connection.b.roomId);
    const openingA = roomA.openings.find((entry) => entry.id === connection.a.openingId);
    const openingB = roomB.openings.find((entry) => entry.id === connection.b.openingId);
    assert.ok(openingA && openingB, "a connection must name two existing openings");

    if (connection.kind === "direct") {
      const vertical = openingA.side === "north" || openingA.side === "south";
      const edgeA = vertical
        ? roomA.origin.y + (openingA.side === "north" ? 0 : roomA.mask.h - 1)
        : roomA.origin.x + (openingA.side === "west" ? 0 : roomA.mask.w - 1);
      const edgeB = vertical
        ? roomB.origin.y + (openingB.side === "north" ? 0 : roomB.mask.h - 1)
        : roomB.origin.x + (openingB.side === "west" ? 0 : roomB.mask.w - 1);
      assert.equal(Math.abs(edgeB - edgeA) - 1, DUNGEON_CONFIG.wallGap,
        `connection ${connection.id} does not respect the joint width`);
      assert.equal(connection.joint.length, DUNGEON_CONFIG.wallGap * openingA.width);
    } else {
      assert.ok(connection.bridge.length > 0, "a bridge must record its cells");
    }
  }
});
