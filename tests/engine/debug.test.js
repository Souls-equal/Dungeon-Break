/*
 * The debug report: the numbers a bug report needs.
 *
 * These tests exist because the report is the thing a human reads instead of the
 * code: if it names the wrong room, or finds no corridor while the player is
 * standing in one, the bug report is worse than no report at all. Every assertion
 * here is about a number that was measured on real geometry, never on a stub —
 * the manager is the real one, grown the way the game grows it.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createDungeonManager } from "../../src/dungeon/engine/dungeonManager.js";
import { OPENING_STATUS, openingSpan } from "../../src/dungeon/engine/openings.js";
import {
  describeDungeon,
  describeNearby,
  describePosition,
  dungeonLines,
  findCorridor,
  findDoorway,
  nearbyLines,
  nearbyRooms,
  reportLines,
  shortLine,
} from "../../src/dungeon/debug.js";

/** Grows a dungeon from the manager's own frontier, the way the game does. */
function grow(seed, targetRooms) {
  const manager = createDungeonManager({ seed, radius: 512 });
  manager.createEntrance();
  let guard = 0;
  while (manager.roomCount < targetRooms && guard < 4000) {
    guard += 1;
    const frontier = manager.pendingOpenings();
    if (frontier.length === 0) break;
    manager.expand(frontier[0].room.id, frontier[0].opening.id);
  }
  return manager;
}

/** A cell in the middle of a room's floor. */
function centreOf(room) {
  for (let z = Math.floor(room.mask.h / 2); z < room.mask.h; z += 1) {
    for (let x = Math.floor(room.mask.w / 2); x < room.mask.w; x += 1) {
      if (room.mask.cells[z][x]) return { x: room.origin.x + x + 0.5, z: room.origin.y + z + 0.5 };
    }
  }
  throw new Error(`room ${room.id} has no floor cell`);
}

test("the report names the seed, the cell and the room a player stands in", () => {
  const manager = grow(12345, 12);
  const room = manager.allRooms()[3];
  const centre = centreOf(room);

  const report = describePosition({
    manager,
    point: { x: centre.x, y: -1000, z: centre.z },
    seed: 12345,
    difficulty: "Normal",
    lobby: "lobby-1",
  });

  assert.equal(report.seed, 12345);
  assert.equal(report.difficulty, "Normal");
  assert.equal(report.lobby, "lobby-1");
  assert.equal(report.where, "room");
  assert.equal(report.room.id, room.id);
  // The nearest room is the one the player is standing in — measured on the
  // room's floor cells, not on its bounding box: a cross-shaped room leaves its
  // own corners empty, and a box distance would name it at 0 cells from a cell
  // it does not own.
  assert.equal(report.nearbyRooms[0].id, room.id);
  assert.equal(report.nearbyRooms[0].distance, 0);
  assert.deepEqual(report.cell, { x: Math.floor(centre.x), z: Math.floor(centre.z) });
  // The area is counted on the mask, not read off the bounding box: a cross of
  // 55×55 is a quarter of its box, and the box is what a wrong report prints.
  let floorCells = 0;
  for (let z = 0; z < room.mask.h; z += 1) {
    for (let x = 0; x < room.mask.w; x += 1) if (room.mask.cells[z][x]) floorCells += 1;
  }
  assert.equal(report.room.area, floorCells);
  assert.equal(report.room.size.width, room.mask.w);
  assert.equal(report.rooms, manager.roomCount);
});

test("a player standing in a corridor is reported in the corridor, with its width", () => {
  const manager = grow(12345, 12);
  const connection = manager.allConnections().find((entry) => entry.joint.length > 0);
  assert.ok(connection, "the dungeon has no joint to test");
  const cell = connection.joint[Math.floor(connection.joint.length / 2)];

  const report = describePosition({ manager, point: { x: cell.x + 0.5, y: -1000, z: cell.y + 0.5 } });

  assert.equal(report.where, "corridor", "a player in a corridor is not reported in one");
  assert.equal(report.corridor.connectionId, connection.id);
  assert.equal(report.corridor.width, connection.width);
  assert.equal(report.corridor.onCorridor, true);
  assert.equal(report.corridor.distance, 0);
  // The report must not claim the player is inside a room while they are in the
  // joint: `locatePlayerRoom` returns the *nearest* room, and that is not the
  // same thing.
  assert.ok(report.room === null || report.room.id !== undefined);
  if (report.room) assert.ok(report.distanceToRoom > 0, "the nearest room is reported as distance 0 from a joint");
});

test("the report finds the doorway a player is walking through", () => {
  const manager = grow(12345, 12);
  const room = manager.allRooms().find((entry) => entry.openings.some((opening) => opening.status === OPENING_STATUS.CONNECTED));
  assert.ok(room);
  const opening = room.openings.find((entry) => entry.status === OPENING_STATUS.CONNECTED);
  const span = openingSpan(opening);
  // The cell of the doorway on the room's own face.
  const localX = span.alongX ? span.from : span.across;
  const localZ = span.alongX ? span.across : span.from;
  const point = { x: room.origin.x + localX + 0.5, y: -1000, z: room.origin.y + localZ + 0.5 };

  const report = describePosition({ manager, point });

  assert.ok(report.doorway, "the doorway under the player was not found");
  assert.equal(report.doorway.openingId, opening.id);
  assert.equal(report.doorway.side, opening.side);
  assert.equal(report.doorway.width, opening.width);
  assert.equal(report.doorway.connectionId, opening.connectionId);
});

test("a doorway is only found on the room's face, never through the wall", () => {
  const manager = grow(12345, 12);
  const room = manager.allRooms().find((entry) => entry.openings.length > 0);
  const opening = room.openings[0];
  const span = openingSpan(opening);

  // Two cells deep into the room, on the same line as the doorway: not a doorway.
  const localX = span.alongX ? span.from : span.across + 2 * (opening.vectorX || 1);
  const localZ = span.alongX ? span.across + 2 * (opening.vectorY || 1) : span.from;
  const found = findDoorway(room, room.origin.x + localX, room.origin.y + localZ);
  assert.equal(found, null, "a cell inside the room was reported as a doorway");
});

test("the nearest rooms are sorted by distance, and the one you stand in is distance 0", () => {
  const manager = grow(12345, 20);
  const room = manager.allRooms()[5];
  const centre = centreOf(room);
  const nearest = nearbyRooms(manager, { x: centre.x, z: centre.z });

  assert.ok(nearest.length > 0);
  assert.equal(nearest[0].id, room.id);
  assert.equal(nearest[0].distance, 0);
  for (let index = 1; index < nearest.length; index += 1) {
    assert.ok(nearest[index].distance >= nearest[index - 1].distance, "the neighbours are not sorted");
  }
});

test("a corridor is found by its stored cells, never guessed from the gap", () => {
  const manager = grow(777, 15);
  const before = manager.allConnections().length;
  assert.ok(before > 0);
  const connection = manager.allConnections()[0];
  const cell = connection.joint[0] || connection.bridge[0];
  const found = findCorridor(manager, { x: cell.x + 0.5, z: cell.y + 0.5 });
  assert.equal(found.connectionId, connection.id);
  assert.ok(found.cells > 0);

  // A point far from every corridor still reports the nearest one, with the
  // distance, rather than nothing: a screenshot from a room must point somewhere.
  const far = findCorridor(manager, { x: 10_000, z: 10_000 });
  assert.equal(far.onCorridor, false);
  assert.ok(far.distance > 1_000);
});

test("the dungeon summary counts rooms, links and loops the way the graph does", () => {
  const manager = grow(2024, 25);
  const summary = describeDungeon(manager);

  assert.equal(summary.rooms, manager.roomCount);
  assert.equal(summary.connections, manager.connectionCount);
  assert.equal(summary.seed, 2024);
  // A spanning tree over n rooms has n - 1 links; anything above is a loop, and
  // this is the number a report must not get wrong.
  assert.equal(summary.loops, Math.max(0, summary.connections - Math.max(0, summary.rooms - 1)));
  assert.ok(summary.largestArea >= summary.smallestArea);
  assert.ok(summary.smallestArea > 0);
  // Every room is in exactly one build state.
  const counted = Object.values(summary.buildStates).reduce((total, value) => total + value, 0);
  assert.equal(counted, summary.rooms);
  // The refusals are the manager's own counters, most frequent first.
  if (summary.refusals.length > 1) {
    assert.ok(summary.refusals[0].count >= summary.refusals[1].count);
  }
});

test("the lines carry every number the report holds, and no undefined", () => {
  const manager = grow(31337, 10);
  const room = manager.allRooms()[2];
  const centre = centreOf(room);
  const report = describePosition({
    manager,
    point: { x: centre.x, y: -1000, z: centre.z },
    seed: 31337,
    difficulty: "Medium",
    lobby: "lobby-7",
    blockAt: () => "Stone Bricks",
  });

  const lines = reportLines(report);
  const joined = lines.join("\n");
  assert.ok(joined.includes("seed 31337"));
  assert.ok(joined.includes("lobby-7"));
  assert.ok(joined.includes(`room ${room.id}`));
  assert.ok(joined.includes(`${room.mask.w}x${room.mask.h}`));
  assert.ok(joined.includes("Stone Bricks"), "the block under the player is missing");
  assert.ok(!joined.includes("undefined"), "a line printed undefined");
  assert.ok(!joined.includes("NaN"), "a line printed NaN");
  for (const line of lines) assert.ok(line.startsWith("[dbg]"), `a line has no tag: ${line}`);

  const short = shortLine(report);
  assert.ok(short.includes(`room ${room.id}`));
  assert.ok(!short.includes("undefined"));
});

test("build progress comes from the builder, and is named as such", () => {
  const manager = grow(606, 8);
  const room = manager.allRooms()[1];
  const centre = centreOf(room);
  // A builder that says the room is half written: the report must print what the
  // builder says, not the manager's unchanging `not_started` field.
  const report = describePosition({
    manager,
    point: { x: centre.x, y: -1000, z: centre.z },
    buildStateOf: () => ({ state: "building", cursor: { index: 42, phase: "walls" }, written: 400, total: 900, attempts: 1 }),
  });
  assert.equal(report.room.buildState, "building");
  assert.deepEqual(report.room.buildCursor, { index: 42, phase: "walls" });
  assert.equal(report.room.buildWritten, 400);
  assert.equal(report.room.buildTotal, 900);

  const lines = reportLines(report).join("\n");
  assert.match(lines, /build building 400\/900 @walls:42/);
  assert.match(lines, /1 attempt/);
});

test("without a builder the report falls back to the room record, and still prints", () => {
  const manager = grow(606, 8);
  const room = manager.allRooms()[1];
  const centre = centreOf(room);
  const report = describePosition({ manager, point: { x: centre.x, y: -1000, z: centre.z } });
  assert.equal(report.room.buildState, room.buildState);
  assert.ok(!reportLines(report).join("\n").includes("undefined"));
});

test("the summary lines are readable even on a dungeon with nothing built", () => {
  const manager = createDungeonManager({ seed: 5, radius: 512 });
  manager.createEntrance();
  const summary = describeDungeon(manager);
  const lines = dungeonLines(5, "Very Easy", summary);
  const joined = lines.join("\n");
  assert.ok(!joined.includes("undefined"));
  assert.ok(!joined.includes("NaN"));
  assert.ok(joined.includes("1 rooms"));
  assert.ok(joined.includes("0 connections"));
});

test("the report never mutates the dungeon it describes", () => {
  const manager = grow(4242, 12);
  const roomsBefore = manager.roomCount;
  const connectionsBefore = manager.connectionCount;
  const openingsBefore = manager.allRooms()
    .map((room) => room.openings.map((opening) => `${opening.id}:${opening.status}:${opening.width}`).join(","))
    .join("|");

  for (const room of manager.allRooms()) {
    const centre = centreOf(room);
    describePosition({ manager, point: { x: centre.x, y: -1000, z: centre.z }, blockAt: () => "Air" });
    describeDungeon(manager);
  }

  assert.equal(manager.roomCount, roomsBefore);
  assert.equal(manager.connectionCount, connectionsBefore);
  const openingsAfter = manager.allRooms()
    .map((room) => room.openings.map((opening) => `${opening.id}:${opening.status}:${opening.width}`).join(","))
    .join("|");
  assert.equal(openingsAfter, openingsBefore, "reporting changed an opening");
});

test("the nearby report lists rooms by distance, with their build state and free doorways", () => {
  const manager = grow(99, 14);
  const room = manager.allRooms()[2];
  const centre = centreOf(room);

  const nearby = describeNearby(manager, { x: centre.x, y: -1000, z: centre.z }, {
    limit: 400,
    buildStateOf: (roomId) => ({ state: roomId === room.id ? "built" : "building", cursor: null, written: 0, total: 0, attempts: 0 }),
  });

  assert.ok(nearby.rooms.length > 1, "the report found no neighbour");
  assert.equal(nearby.rooms[0].id, room.id);
  assert.equal(nearby.rooms[0].distance, 0);
  assert.equal(nearby.rooms[0].buildState, "built");
  for (let index = 1; index < nearby.rooms.length; index += 1) {
    assert.ok(nearby.rooms[index].distance >= nearby.rooms[index - 1].distance);
  }
  // Every count is the room's own, not a global one.
  const total = nearby.rooms.reduce((sum, entry) => sum + entry.doorways, 0);
  const expected = nearby.rooms
    .map((entry) => manager.getRoom(entry.id).openings.length)
    .reduce((sum, value) => sum + value, 0);
  assert.equal(total, expected);

  const lines = nearbyLines(nearby).join("\n");
  assert.ok(lines.includes(room.id));
  assert.ok(!lines.includes("undefined"));
  assert.ok(!lines.includes("NaN"));
});

test("the nearby report honours its radius, and says so when nothing is near", () => {
  const manager = grow(99, 10);
  const room = manager.allRooms()[0];
  const centre = centreOf(room);

  const tight = describeNearby(manager, { x: centre.x, z: centre.z }, { limit: 0 });
  assert.equal(tight.rooms.length, 1, "a radius of 0 still returned a room the player is not in");

  const far = describeNearby(manager, { x: 50_000, z: 50_000 }, { limit: 100 });
  assert.equal(far.rooms.length, 0);
  assert.match(nearbyLines(far)[0], /no room within the radius/);
});
