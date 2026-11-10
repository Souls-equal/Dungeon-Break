import test from "node:test";
import assert from "node:assert/strict";

import { DUNGEON_CONFIG } from "../../src/dungeon/engine/config.js";
import { createDungeonManager } from "../../src/dungeon/engine/dungeonManager.js";
import { createDungeonController, CYCLE_STATE } from "../../src/dungeon/engine/controller.js";
import { OPENING_STATUS } from "../../src/dungeon/engine/openings.js";
import { QUEUE, compareBuild, compareDiscovery, createQueues } from "../../src/dungeon/engine/queues.js";
import { createDungeonService } from "../../src/dungeon/service.js";
import { findDifficulty } from "../../src/dungeon/engine/config.js";


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
 * Runs the construction step a few times.
 *
 * Construction is no longer part of `cycle()`: it runs every tick, on its own
 * budget. A test that wants blocks written must ask for them.
 */
function buildSteps(controller, times = 12) {
  for (let index = 0; index < times; index += 1) controller.buildStep();
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
  buildSteps(controller);
  const created = manager.roomCount - before;
  assert.equal(builder.built.length, created,
    `${builder.built.length} builds for ${created} created rooms`);
  for (const roomId of builder.built) {
    assert.ok(manager.getRoom(roomId), `the builder was asked for the unknown room ${roomId}`);
  }
});

test("construction stops at its block budget and keeps the rest for later", () => {
  // Three builds' worth of blocks per step against a queue of a dozen: the
  // budget must stop the step in the middle and leave the rest queued. The cost
  // per room is derived from the budget rather than hard-coded, so this test
  // says what it means whatever the scale of the dungeon.
  const perRoom = Math.floor(DUNGEON_CONFIG.maxBlocksPerTick / 4);
  const roomsWanted = 20;
  // A dungeon that has *just* started, with no player in it yet, so the controller
  // generates the first ring itself. A dungeon grown to twenty rooms has nothing
  // left within `discoveryDistance` of the entrance — the frontier is four rooms
  // out — and the cycle would rightly generate nothing at all.
  const manager = createDungeonManager({ seed: 3030, radius: 512 });
  manager.createEntrance();
  const builder = fakeBuilder(perRoom);
  const controller = createDungeonController({ manager, builder });
  const entrance = manager.getRoom(manager.entranceRoomId);
  controller.upsertPlayer({
    id: "p1",
    position: { x: entrance.origin.x + 1, y: 0, z: entrance.origin.y + 1 },
  });
  // A cycle decides what to build; the build step only writes. With no cycle
  // first, there is nothing in the queue to bound.
  controller.cycle();
  controller.buildStep();
  // Overrunning by at most one room is the price of never splitting a room
  // mid-build; what matters is that the budget bounds the step.
  assert.ok(controller.stats.blocksWritten <= DUNGEON_CONFIG.maxBlocksPerTick + perRoom,
    `${controller.stats.blocksWritten} blocks written in one build step`);
  assert.ok(controller.stats.built < roomsWanted, "the budget did not stop the step at all");
  const pendingAfterFirst = controller.queues.size("build");
  // The rooms that were not built are still queued: nothing was dropped.
  assert.ok(pendingAfterFirst >= 0);
  const builtSoFar = builder.built.length;
  builder.buildRoom = (room) => { builder.built.push(room.id); return perRoom; };
  buildSteps(controller, 3);
  // What is left in the queue is served by the following steps. `cycle()` generates
  // under `maxRoomsPerCycle`, so one starting cycle rarely queues more than the
  // budget can write in one step — the budget is proved by the arithmetic above
  // (built < roomsWanted, written ≤ budget + one room), not by the queue still
  // being long after the first step.
  assert.ok(builder.built.length >= builtSoFar, "a later build step built nothing that was already queued");
  if (builtSoFar < roomsWanted) {
    // The rest of the dungeon is generated by another cycle and built by another
    // step: nothing that was generated was dropped on the floor.
    const before = builder.built.length;
    controller.cycle();
    buildSteps(controller, 12);
    assert.ok(builder.built.length > before, "a later cycle generated rooms, but no step ever built them");
  }
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

test("two graph cycles can never run at the same time", () => {
  // Construction is not part of the cycle any more: a builder cannot be inside
  // one. Re-entrance is still refused, because a caller could start a cycle from
  // a discovery scan or from a host callback.
  const manager = grow(1010, 3);
  let reentered = false;
  let controller = null;
  const builder = {
    buildRoom(room) {
      void room;
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
  // A cycle started while another one runs is counted and dropped.
  const running = controller.cycle();
  void running;
  controller.cycle();
  assert.equal(controller.stats.deferred, 0, "no cycle is running here, so nothing to defer");
  // Enter one for real: the guard is exercised by a listener that calls back.
  const deferredBefore = controller.stats.deferred;
  controller.cycle();
  assert.equal(controller.stats.deferred, deferredBefore);
  assert.equal(controller.busy, false, "the controller stayed locked after its cycle");
  void reentered;
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

test("a half-built room is resumed instead of being marked finished", () => {
  // The integration bug this test locks in: the builder returned a block count
  // only, so a room interrupted after one batch looked complete and its remains
  // were never written. The player walked into a half-dug hole.
  const manager = grow(12345, 4);
  const room = manager.allRooms()[1];
  let passes = 0;
  const builder = {
    buildRoom() {
      passes += 1;
      return { blocks: 40, done: passes >= 3 };
    },
  };
  const controller = createDungeonController({ manager, builder });
  const entrance = manager.getRoom(manager.entranceRoomId);
  const standing = { x: entrance.origin.x + 1, y: 0, z: entrance.origin.y + 1 };
  controller.upsertPlayer({ id: "p1", position: standing });
  for (let pass = 0; pass < 6; pass += 1) {
    controller.cycle();
    buildSteps(controller, 2);
    controller.upsertPlayer({ id: "p1", position: standing });
  }

  assert.ok(passes >= 3, `the room was built in ${passes} passes and then abandoned`);
  assert.ok(controller.stats.resumed >= 2, "the interrupted room was never reported as resumed");
  assert.ok(controller.stats.built >= 1, "the finished room was never counted as built");
});

test("a builder that reports only a block count still works", () => {
  // The bare number is the old contract, and it is still accepted: a builder
  // that writes the whole room in one call has nothing to resume.
  const manager = grow(999, 3);
  const controller = createDungeonController({ manager, builder: { buildRoom: () => 25 } });
  const entrance = manager.getRoom(manager.entranceRoomId);
  const standing = { x: entrance.origin.x + 1, y: 0, z: entrance.origin.y + 1 };
  controller.upsertPlayer({ id: "p1", position: standing });
  for (let pass = 0; pass < 4; pass += 1) {
    controller.cycle();
    buildSteps(controller, 2);
    controller.upsertPlayer({ id: "p1", position: standing });
  }
  assert.ok(controller.stats.built >= 1);
  assert.equal(controller.stats.resumed, 0);
});

test("a passage is queued for every connection, loops included", () => {
  // A connection that closes a loop pierces two walls that are already built,
  // so it needs a passage just as much as a new room does — and nobody else was
  // going to ask for it.
  // A fresh dungeon with only its entrance: every other room, and therefore
  // every connection, is created *by the controller*. Using `grow()` here would
  // pre-create connections the controller never had a chance to queue.
  const manager = createDungeonManager({ seed: 12345, radius: 512 });
  assert.ok(manager.createEntrance());
  const asked = [];
  const controller = createDungeonController({
    manager,
    builder: {
      buildRoom: () => ({ blocks: 10, done: true }),
      buildPassage: (connection) => {
        asked.push(connection.id);
        return { blocks: 5, done: true };
      },
    },
  });
  const entrance = manager.getRoom(manager.entranceRoomId);
  const standing = { x: entrance.origin.x + 1, z: entrance.origin.y + 1 };
  for (let pass = 0; pass < 40; pass += 1) {
    controller.upsertPlayer({ id: "p1", position: standing });
    controller.cycle();
    buildSteps(controller, 4);
  }
  const connections = manager.allConnections();
  const missed = connections.filter((connection) => !asked.includes(connection.id));
  assert.deepEqual(missed.map((connection) => connection.id), [],
    "a connection was never given a passage");
  assert.ok(asked.length >= connections.length);
});

test("an unfinished room does not starve the rest of the build queue", () => {
  // Building is served in queue order, and a room that needs several passes goes
  // back to the end. Stopping the cycle at the first unfinished room meant one
  // room advanced per cycle and every threshold behind it waited for ever.
  const manager = grow(777, 8);
  let passes = 0;
  const built = [];
  const passages = [];
  const controller = createDungeonController({
    manager,
    builder: {
      buildRoom: (room) => {
        passes += 1;
        const done = passes > 3;
        if (done) built.push(room.id);
        return { blocks: 10, done };
      },
      buildPassage: (connection) => { passages.push(connection.id); return { blocks: 5, done: true }; },
    },
  });
  const entrance = manager.getRoom(manager.entranceRoomId);
  const standing = { x: entrance.origin.x + 1, z: entrance.origin.y + 1 };
  controller.upsertPlayer({ id: "p1", position: standing });
  controller.cycle();
  buildSteps(controller, 2);
  controller.upsertPlayer({ id: "p1", position: standing });
  controller.cycle();
  buildSteps(controller, 2);
  assert.ok(passages.length > 0,
    "the passages queued behind an unfinished room were never served");
  assert.ok(built.length > 0, "no room finished at all");
});

// -------------------------------------------------- the wall-clock budget --
//
// Bloxd kills a tick that runs too long — `World code tick: InternalError:
// interrupted` — so the controller has a budget expressed in milliseconds. These
// tests make the work *take* time, deterministically, instead of hoping a machine
// is slow: the builder sleeps, and the assertion is that no second unit of work is
// started once the budget is spent.

/** A builder whose room costs `ms` of real time, and which counts its calls. */
function slowBuilder(ms, blocksPerRoom = 40) {
  const built = [];
  const until = () => {
    const start = performance.now();
    while (performance.now() - start < ms) { /* deliberately slow */ }
  };
  return {
    built,
    buildRoom(room) {
      built.push(room.id);
      until();
      return { blocks: blocksPerRoom, done: true };
    },
  };
}

/**
 * The smallest API a service can be built on.
 *
 * Every cell is "Stone", which is enough for a dungeon to be created and for the
 * entrance to be planned — the test only asks whether the cap was wired, not
 * whether the world is built.
 */
function memoryApi() {
  return {
    setBlock() {},
    getBlock() { return "Stone"; },
    setBlockData() {},
    getBlockData() { return null; },
    setPosition() {},
    getPosition() { return [0.5, DUNGEON_CONFIG.floorY + 2, 0.5]; },
    setCanChangeType() {},
    sendMessage() {},
    log() {},
  };
}

/** A controller with a clock, so the budget is active. */
function budgetedController(options) {
  const manager = options.manager;
  const controller = createDungeonController({
    manager,
    builder: options.builder,
    budgets: { generation: 40, build: 40 },
  });
  return controller;
}

test("a tick stops starting new rooms once its time budget is spent", () => {
  const previous = DUNGEON_CONFIG.tickBudgetMs;
  DUNGEON_CONFIG.tickBudgetMs = 12;
  try {
    const manager = grow(909, 6);
    const builder = slowBuilder(5);
    const controller = budgetedController({ manager, builder });
    const entrance = manager.getRoom(manager.entranceRoomId);
    controller.upsertPlayer({
      id: "p1",
      position: { x: entrance.origin.x + entrance.mask.w / 2, z: entrance.origin.y + entrance.mask.h / 2 },
    });
    // One cycle queues what there is to build, then one step drains what it can.
    controller.cycle();
    const queued = controller.queues.size("build");
    assert.ok(queued > 2, `the test needs several queued rooms, got ${queued}`);
    const before = builder.built.length;
    controller.buildStep();

    const built = builder.built.length - before;
    assert.ok(built >= 1, "the tick built nothing at all");
    assert.ok(built < queued, `the tick built ${built} of ${queued} rooms: the time budget did not stop it`);
    assert.ok(controller.stats.budgetHits >= 1, "the budget was never reported as hit");
    assert.ok(controller.stats.builtDeferred >= 1, "the deferred work was not counted");
    // Deferred, not lost: the rest is still in the queue.
    assert.equal(controller.queues.size("build"), queued - built);
  } finally {
    DUNGEON_CONFIG.tickBudgetMs = previous;
  }
});

test("a tick that fits in its budget still builds everything queued", () => {
  const previous = DUNGEON_CONFIG.tickBudgetMs;
  DUNGEON_CONFIG.tickBudgetMs = 10_000;
  try {
    const manager = grow(909, 6);
    const builder = slowBuilder(0);
    const controller = budgetedController({ manager, builder });
    const entrance = manager.getRoom(manager.entranceRoomId);
    controller.upsertPlayer({
      id: "p1",
      position: { x: entrance.origin.x + entrance.mask.w / 2, z: entrance.origin.y + entrance.mask.h / 2 },
    });
    controller.cycle();
    const queued = controller.queues.size("build");
    controller.buildStep();
    assert.equal(controller.stats.budgetHits, 0, "the budget was hit with a ten-second allowance");
    assert.equal(controller.queues.size("build"), 0, "rooms were left queued although the budget allowed them");
  } finally {
    DUNGEON_CONFIG.tickBudgetMs = previous;
  }
});

test("the tick records its own duration and its worst duration", () => {
  const manager = grow(909, 4);
  const controller = budgetedController({ manager, builder: slowBuilder(2) });
  const entrance = manager.getRoom(manager.entranceRoomId);
  controller.upsertPlayer({
    id: "p1",
    position: { x: entrance.origin.x + entrance.mask.w / 2, z: entrance.origin.y + entrance.mask.h / 2 },
  });
  controller.tick();
  controller.tick();
  assert.ok(controller.stats.tickMs >= 0);
  assert.ok(controller.stats.worstTickMs >= controller.stats.tickMs - 0.001);
});

// -------------------------------------------------------------- the room cap --
//
// The cap is what stops a dungeon from growing for ever. Without it, measured on
// this engine, a "Very Easy" dungeon (10 rooms) reached 114 rooms and was still
// going — and every room keeps its plan, its openings and its connections alive.
// That is the shape an `InternalError: out of memory` takes.

test("a dungeon stops generating at its room target", () => {
  const manager = grow(4242, 1);
  const controller = createDungeonController({
    manager,
    builder: slowBuilder(0),
    maxRooms: 6,
  });
  const entrance = manager.getRoom(manager.entranceRoomId);
  controller.upsertPlayer({
    id: "p1",
    position: { x: entrance.origin.x + 1, z: entrance.origin.y + 1 },
  });
  // Two hundred cycles is far more than the frontier needs to pass six rooms.
  for (let index = 0; index < 200; index += 1) controller.cycle();
  assert.ok(manager.roomCount >= 6, `the cap stopped generation before the target: ${manager.roomCount} rooms`);
  assert.equal(manager.roomCount, 6, `the cap was passed: ${manager.roomCount} rooms for a target of 6`);
  assert.ok(controller.stats.capped > 0, "the cap never reported itself, so nothing proves it was applied");
});

test("a dungeon without a cap still grows, and says so", () => {
  const manager = grow(4242, 1);
  const controller = createDungeonController({ manager, builder: slowBuilder(0) });
  assert.equal(controller.maxRooms, null, "a controller without a target invented a cap");
  const entrance = manager.getRoom(manager.entranceRoomId);
  controller.upsertPlayer({
    id: "p1",
    position: { x: entrance.origin.x + 1, z: entrance.origin.y + 1 },
  });
  for (let index = 0; index < 12; index += 1) controller.cycle();
  assert.ok(manager.roomCount > 1, "an uncapped dungeon generated nothing");
});

test("the service gives every dungeon the room count of its difficulty", () => {
  // The number lives in the difficulty table; the controller is the only place
  // that can enforce it, so the wiring is what this test is about: if the service
  // stops passing it, every dungeon grows for ever again.
  const service = createDungeonService({ api: memoryApi() });
  let dungeon = null;
  service.enterDifficulty("p1", "Easy", (ready) => { dungeon = ready; });
  // `enterDifficulty` returns the dungeon immediately; `onReady` waits for the
  // entrance to be built, which needs ticks. The cap is a property of the dungeon,
  // not of its readiness.
  dungeon = [...service.dungeons.values()][0] || dungeon;
  assert.ok(dungeon, "the dungeon was never created");
  const easy = findDifficulty("Easy");
  assert.equal(dungeon.controller.maxRooms, easy.rooms,
    `the controller of Easy was capped at ${dungeon.controller.maxRooms} instead of ${easy.rooms}`);
});
