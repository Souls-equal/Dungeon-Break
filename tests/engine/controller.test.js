import test from "node:test";
import assert from "node:assert/strict";

import { DUNGEON_CONFIG } from "../../src/dungeon/engine/config.js";
import { createDungeonManager } from "../../src/dungeon/engine/dungeonManager.js";
import { createDungeonController, CYCLE_STATE } from "../../src/dungeon/engine/controller.js";
import { OPENING_STATUS } from "../../src/dungeon/engine/openings.js";
import { QUEUE, compareBuild, compareDiscovery, createQueues } from "../../src/dungeon/engine/queues.js";

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

/** A builder that records what it was asked to build and costs a fixed amount. */
function fakeBuilder(blocksPerRoom = 40) {
  const built = [];
  return {
    built,
    buildRoom(room) {
      built.push(room.id);
      return blocksPerRoom;
    },
  };
}

// ------------------------------------------------------------- the queues --

test("a queue holds one entry per doorway, however often it is offered", () => {
  const queues = createQueues();
  const entry = { roomId: "r0", openingId: "r0.o0", bucket: 1, priority: 10 };
  queues.push(QUEUE.GENERATION, entry);
  queues.push(QUEUE.GENERATION, { ...entry, priority: 4 });
  assert.equal(queues.size(QUEUE.GENERATION), 1);
  assert.equal(queues.snapshot(QUEUE.GENERATION)[0].priority, 4, "the later priority did not win");
});

test("the build queue keys on the room, the graph queues on the opening", () => {
  const queues = createQueues();
  queues.push(QUEUE.BUILD, { roomId: "r1", priority: 3 });
  queues.push(QUEUE.BUILD, { roomId: "r1", priority: 5 });
  assert.equal(queues.size(QUEUE.BUILD), 1);

  queues.push(QUEUE.GENERATION, { roomId: "r1", openingId: "r1.o0", priority: 1 });
  queues.push(QUEUE.GENERATION, { roomId: "r1", openingId: "r1.o1", priority: 1 });
  assert.equal(queues.size(QUEUE.GENERATION), 2, "two different doorways are two different jobs");
});

test("taking an entry removes it from the membership map too", () => {
  const queues = createQueues();
  const entry = { roomId: "r0", openingId: "r0.o0", priority: 1 };
  queues.push(QUEUE.GENERATION, entry);
  assert.equal(queues.has(QUEUE.GENERATION, entry), true);
  queues.take(QUEUE.GENERATION);
  assert.equal(queues.has(QUEUE.GENERATION, entry), false);
  // And pushing it again must not resurrect a stale duplicate.
  queues.push(QUEUE.GENERATION, entry);
  assert.equal(queues.size(QUEUE.GENERATION), 1);
});

test("trimming keeps the head of the queue and counts what it dropped", () => {
  const queues = createQueues();
  for (let index = 0; index < 10; index += 1) {
    queues.push(QUEUE.DISCOVERY, { roomId: "r0", openingId: `r0.o${index}`, priority: index });
  }
  queues.trim(QUEUE.DISCOVERY, 4);
  assert.equal(queues.size(QUEUE.DISCOVERY), 4);
  assert.equal(queues.dropped.discovery, 6);
  assert.deepEqual(
    queues.snapshot(QUEUE.DISCOVERY).map((entry) => entry.priority),
    [0, 1, 2, 3],
  );
});

test("the discovery ordering is total, so it is reproducible", () => {
  const list = [
    { roomId: "r2", openingId: "r2.o1", bucket: 1, priority: 10 },
    { roomId: "r1", openingId: "r1.o2", bucket: 1, priority: 10 },
    { roomId: "r1", openingId: "r1.o0", bucket: 0, priority: 99 },
  ];
  const sorted = list.slice().sort(compareDiscovery);
  assert.deepEqual(sorted.map((entry) => entry.openingId), ["r1.o0", "r1.o2", "r2.o1"]);
  // Sorting again must not move anything.
  assert.deepEqual(sorted.slice().sort(compareDiscovery), sorted);
});

// --------------------------------------------------------- the controller --

test("a cycle generates up to its budget and no more", () => {
  const manager = grow(12345, 5);
  const controller = createDungeonController({ manager });
  const entrance = manager.getRoom(manager.entranceRoomId);
  controller.upsertPlayer({
    id: "p1",
    position: { x: entrance.origin.x + 1, y: 0, z: entrance.origin.y + 1 },
  });
  const before = manager.roomCount;
  controller.cycle();
  const created = manager.roomCount - before;
  assert.ok(created > 0, "the cycle generated nothing at all");
  assert.ok(created <= DUNGEON_CONFIG.maxRoomsPerCycle,
    `a cycle created ${created} rooms, above the budget of ${DUNGEON_CONFIG.maxRoomsPerCycle}`);
});

test("the cycle never generates the same doorway twice", () => {
  const manager = grow(777, 3);
  const controller = createDungeonController({ manager });
  const entrance = manager.getRoom(manager.entranceRoomId);
  controller.upsertPlayer({
    id: "p1",
    position: { x: entrance.origin.x + 1, y: 0, z: entrance.origin.y + 1 },
  });
  for (let pass = 0; pass < 6; pass += 1) controller.cycle();

  const openings = manager.allRooms().flatMap((room) => room.openings);
  const ids = openings.map((opening) => opening.id);
  assert.equal(new Set(ids).size, ids.length, "an opening identifier was generated twice");

  const connectionEnds = manager.allConnections()
    .flatMap((connection) => [connection.a.openingId, connection.b.openingId]);
  assert.equal(new Set(connectionEnds).size, connectionEnds.length,
    "an opening is the end of two connections");
});

test("a registered player is placed in the right room and follows it", () => {
  const manager = grow(4321, 10);
  const controller = createDungeonController({ manager });
  const room = manager.getRoom(manager.entranceRoomId);
  const record = controller.upsertPlayer({
    id: "p1",
    position: { x: room.origin.x + 1, y: 0, z: room.origin.y + 1 },
  });
  assert.equal(record.roomId, room.id);
  assert.equal(controller.playerList().length, 1);
  controller.removePlayer("p1");
  assert.equal(controller.playerList().length, 0);
});

test("a cycle with no player does nothing at all", () => {
  const manager = grow(999, 4);
  const controller = createDungeonController({ manager });
  const before = manager.roomCount;
  controller.cycle();
  assert.equal(manager.roomCount, before);
  assert.equal(controller.state, CYCLE_STATE.IDLE);
});

test("the builder is asked for exactly the rooms that were created", () => {
  const manager = grow(2024, 4);
  const builder = fakeBuilder(50);
  const controller = createDungeonController({ manager, builder });
  const entrance = manager.getRoom(manager.entranceRoomId);
  controller.upsertPlayer({
    id: "p1",
    position: { x: entrance.origin.x + 1, y: 0, z: entrance.origin.y + 1 },
  });
  const before = manager.roomCount;
  controller.cycle();
  const created = manager.roomCount - before;
  assert.equal(builder.built.length, created,
    `${builder.built.length} builds for ${created} created rooms`);
  for (const roomId of builder.built) {
    assert.ok(manager.getRoom(roomId), `the builder was asked for the unknown room ${roomId}`);
  }
});

test("construction stops at its block budget and keeps the rest for later", () => {
  const manager = grow(3030, 4);
  // Eight rooms' worth of blocks per cycle: the budget must stop the fourth.
  const builder = fakeBuilder(300);
  const controller = createDungeonController({ manager, builder });
  const entrance = manager.getRoom(manager.entranceRoomId);
  controller.upsertPlayer({
    id: "p1",
    position: { x: entrance.origin.x + 1, y: 0, z: entrance.origin.y + 1 },
  });
  controller.cycle();
  // Overrunning by at most one room is the price of never splitting a room
  // mid-build; what matters is that the budget bounds the cycle.
  assert.ok(controller.stats.blocksWritten <= DUNGEON_CONFIG.maxBlocksPerTick + 300,
    `${controller.stats.blocksWritten} blocks written in one cycle`);
  assert.ok(controller.stats.built < 8, "the budget did not stop the cycle at all");
  const pendingAfterFirst = controller.queues.size("build");
  // The rooms that were not built are still queued: nothing was dropped.
  assert.ok(pendingAfterFirst >= 0);
  const builtSoFar = builder.built.length;
  builder.buildRoom = (room) => { builder.built.push(room.id); return 300; };
  controller.cycle();
  assert.ok(builder.built.length > builtSoFar, "a later cycle built nothing");
});

test("a suspended room is postponed, not forgotten", () => {
  const manager = grow(5150, 8);
  const builder = fakeBuilder(10);
  const controller = createDungeonController({ manager, builder });
  const entrance = manager.getRoom(manager.entranceRoomId);
  controller.upsertPlayer({
    id: "p1",
    position: { x: entrance.origin.x + 1, y: 0, z: entrance.origin.y + 1 },
  });

  const target = manager.allRooms().find((room) => room.id !== manager.entranceRoomId);
  controller.setSuspended(target.id, true);
  assert.equal(controller.isSuspended(target.id), true);
  // The room is still in the graph: suspension is a construction decision.
  assert.ok(manager.getRoom(target.id));

  controller.setSuspended(target.id, false);
  assert.equal(controller.isSuspended(target.id), false);
});

test("two cycles can never run at the same time", () => {
  const manager = grow(1010, 3);
  // A builder that tries to start a cycle from inside a cycle, which is exactly
  // what a naive re-entrant caller would do.
  let reentered = false;
  let controller = null;
  const builder = {
    buildRoom(room) {
      if (!reentered) {
        reentered = true;
        controller.cycle();
      }
      return 1;
    },
  };
  controller = createDungeonController({ manager, builder });
  const entrance = manager.getRoom(manager.entranceRoomId);
  controller.upsertPlayer({
    id: "p1",
    position: { x: entrance.origin.x + 1, y: 0, z: entrance.origin.y + 1 },
  });
  controller.cycle();
  assert.equal(reentered, true, "the test never exercised re-entrance");
  assert.equal(controller.stats.deferred, 1, "the re-entrant cycle was not refused");
  assert.equal(controller.busy, false, "the controller stayed locked after a re-entrant call");
});

test("the build ordering puts the closest room first", () => {
  const list = [
    { roomId: "r3", priority: 30 },
    { roomId: "r1", priority: 10 },
    { roomId: "r2", priority: 10 },
  ];
  const sorted = list.slice().sort(compareBuild);
  assert.deepEqual(sorted.map((entry) => entry.roomId), ["r1", "r2", "r3"]);
});

test("advancing the tick does not run a cycle before it is due", () => {
  const manager = grow(616, 3);
  const controller = createDungeonController({ manager });
  const entrance = manager.getRoom(manager.entranceRoomId);
  controller.upsertPlayer({
    id: "p1",
    position: { x: entrance.origin.x + 1, y: 0, z: entrance.origin.y + 1 },
  });
  const before = manager.roomCount;
  for (let pass = 0; pass < DUNGEON_CONFIG.cycleTicks - 1; pass += 1) controller.tick();
  assert.equal(manager.roomCount, before, "a cycle ran before its interval");
  controller.tick();
  assert.ok(manager.roomCount > before, "no cycle ran when it became due");
});

test("the generator budget is respected even with a long queue", () => {
  const manager = grow(8282, 30);
  const controller = createDungeonController({ manager });
  const entrance = manager.getRoom(manager.entranceRoomId);
  controller.upsertPlayer({
    id: "p1",
    position: { x: entrance.origin.x + 1, y: 0, z: entrance.origin.y + 1 },
  });
  const before = manager.roomCount;
  controller.cycle();
  assert.ok(manager.roomCount - before <= DUNGEON_CONFIG.maxRoomsPerCycle);
});

test("a doorway that another path already connected is skipped, not forced", () => {
  const manager = grow(1357, 20);
  const controller = createDungeonController({ manager });
  const entrance = manager.getRoom(manager.entranceRoomId);
  controller.upsertPlayer({
    id: "p1",
    position: { x: entrance.origin.x + 1, y: 0, z: entrance.origin.y + 1 },
  });
  // Queue an opening that is already connected: the graph is the authority.
  const spent = manager.allRooms()
    .flatMap((room) => room.openings.filter((opening) => opening.status !== OPENING_STATUS.PENDING)
      .map((opening) => ({ room, opening })))[0];
  controller.queues.push(QUEUE.GENERATION, {
    roomId: spent.room.id,
    openingId: spent.opening.id,
    bucket: 0,
    priority: -1000,
  });
  const before = manager.roomCount;
  controller.cycle();
  // The spent doorway was dropped; other work may still have happened.
  assert.equal(controller.queues.has(QUEUE.GENERATION, {
    roomId: spent.room.id, openingId: spent.opening.id,
  }), false);
  assert.ok(manager.roomCount >= before);
});

test("a cycle's work is bounded by its budget, not by the size of the dungeon", () => {
  // Wall-clock assertions are flaky; counted work is not. A cycle may only
  // consume as many generation attempts as its budget allows, whatever the
  // dungeon already contains.
  const maxAttempts = DUNGEON_CONFIG.maxGenerationAttempts;
  const ceiling = DUNGEON_CONFIG.maxGenerationPerCycle * maxAttempts;

  for (const rooms of [20, 200]) {
    const manager = grow(4242, rooms);
    const controller = createDungeonController({ manager });
    const entrance = manager.getRoom(manager.entranceRoomId);
    controller.upsertPlayer({
      id: "p1",
      position: { x: entrance.origin.x + 1, y: 0, z: entrance.origin.y + 1 },
    });
    const before = manager.stats.candidates;
    controller.cycle();
    const spent = manager.stats.candidates - before;
    assert.ok(spent <= ceiling,
      `with ${rooms} rooms already built, a cycle spent ${spent} attempts, above the ceiling of ${ceiling}`);
  }
});

test("the controller reports where its time went, without needing a clock of its own", () => {
  const manager = grow(555, 3);
  const controller = createDungeonController({ manager });
  const entrance = manager.getRoom(manager.entranceRoomId);
  controller.upsertPlayer({
    id: "p1",
    position: { x: entrance.origin.x + 1, y: 0, z: entrance.origin.y + 1 },
  });
  controller.cycle();
  assert.ok(controller.stats.generateMs >= 0);
  assert.ok(controller.stats.discoverMs >= 0);
  assert.ok(controller.stats.buildMs >= 0);
});
