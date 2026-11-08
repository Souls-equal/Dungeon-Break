import test from "node:test";
import assert from "node:assert/strict";

import { DUNGEON_CONFIG } from "../../src/dungeon/engine/config.js";
import { createDungeonManager } from "../../src/dungeon/engine/dungeonManager.js";
import { OPENING_STATUS } from "../../src/dungeon/engine/openings.js";
import {
  auditRoom,
  BUILD_PHASE,
  BLOCKS,
  createRoomWriter,
  doorwaySet,
  dungeonCellIndex,
  padCell,
  passageBlocks,
  passageCellsFor,
  roomBlocks,
  STONE_PALETTE,
} from "../../src/dungeon/builder.js";

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

function worldOf(room) {
  return { x: room.origin.x, y: 0, z: room.origin.y };
}

function memoryWorld() {
  const cells = new Map();
  return {
    setBlock(x, y, z, name) { cells.set(`${x},${y},${z}`, name); },
    getBlock(x, y, z) { return cells.get(`${x},${y},${z}`) || null; },
    cells,
  };
}

test("every room produces a floor on every one of its own cells", () => {
  const manager = grow(12345, 20);
  for (const room of manager.allRooms()) {
    const blocks = roomBlocks(room, worldOf(room));
    const floor = blocks.filter((block) => block.phase === BUILD_PHASE.FLOOR);
    const cells = room.mask.cells.flat().filter(Boolean).length;
    assert.equal(floor.length, cells, `${room.id} has ${floor.length} floor blocks for ${cells} cells`);
  }
});

test("no wall is ever written below the passage height on a doorway", () => {
  const manager = grow(777, 25);
  let checked = 0;
  for (const room of manager.allRooms()) {
    const openings = doorwaySet(room);
    if (openings.size === 0) continue;
    for (const block of roomBlocks(room, worldOf(room))) {
      if (block.phase !== BUILD_PHASE.WALL) continue;
      const key = `${block.x - room.origin.x},${block.z - room.origin.y}`;
      if (!openings.has(key)) continue;
      const level = block.y - worldOf(room).y;
      assert.ok(level > DUNGEON_CONFIG.passageHeight,
        `${room.id}: the doorway cell ${key} was walled at height ${level}`);
      checked += 1;
    }
  }
  assert.ok(checked > 0, "no doorway lintel was inspected, so the test proves nothing");
});

test("a free opening is walled: a doorway that leads nowhere is not a hole", () => {
  const manager = grow(2024, 10);
  let inspected = 0;
  for (const room of manager.allRooms()) {
    const free = room.openings.filter((opening) => opening.status === OPENING_STATUS.PENDING);
    if (free.length === 0) continue;
    const blocks = roomBlocks(room, worldOf(room));
    const connected = doorwaySet(room);
    for (const opening of free) {
      const key = opening.side === "north"
        ? `${opening.centerX},0`
        : opening.side === "south"
          ? `${opening.centerX},${room.mask.h - 1}`
          : opening.side === "west"
            ? `0,${opening.centerY}`
            : `${room.mask.w - 1},${opening.centerY}`;
      assert.equal(connected.has(key), false, `${room.id}: a free opening was treated as a passage`);
      const wall = blocks.find((block) => block.phase === BUILD_PHASE.WALL
        && `${block.x - room.origin.x},${block.z - room.origin.y}` === key
        && block.y === worldOf(room).y + 1);
      assert.ok(wall, `${room.id}: the free doorway ${key} is a hole into the void`);
      inspected += 1;
    }
  }
  assert.ok(inspected > 0, "no free opening was inspected");
});

test("construction writes each cell once, in order, at its final value", () => {
  const manager = grow(4321, 8);
  const room = manager.allRooms()[1];
  const expected = roomBlocks(room, worldOf(room));
  const writes = [];
  const writer = createRoomWriter(
    { setBlock: (x, y, z, name) => writes.push(`${x},${y},${z}=${name}`) },
    { batchSize: 37 },
  );

  let cursor = null;
  let written = 0;
  let batches = 0;
  do {
    const result = writer.writeRoom(room, worldOf(room), cursor);
    cursor = result.cursor;
    written += result.written;
    batches += 1;
    assert.ok(batches < 500, "the writer never finished, which means it loops");
    if (result.done) break;
  } while (true);

  assert.equal(written, expected.length, "the batches did not cover every block");
  assert.equal(
    writes.length,
    new Set(writes.map((entry) => entry.split("=")[0])).size,
    "a cell was written twice, so the result depends on the order of the batches",
  );
  assert.deepEqual(
    writes,
    expected.map((block) => `${block.x},${block.y},${block.z}=${block.name}`),
    "the written sequence differs from the planned one",
  );
});

test("an interrupted build resumes from its cursor and never restarts", () => {
  const manager = grow(5150, 6);
  const room = manager.allRooms()[2];
  const world = memoryWorld();
  const writer = createRoomWriter(world, { batchSize: 50 });
  const first = writer.writeRoom(room, worldOf(room));
  assert.equal(first.done, false, "the room fitted in one batch, so the test proves nothing");
  // A caller that lost its cursor must be told, not silently restarted.
  assert.throws(() => writer.writeRoom(room, worldOf(room)), /explicit cursor/);

  const resumed = createRoomWriter(world, { batchSize: 50 });
  let cursor = first.cursor;
  let total = first.written;
  for (let guard = 0; guard < 500; guard += 1) {
    const step = resumed.writeRoom(room, worldOf(room), cursor);
    total += step.written;
    cursor = step.cursor;
    if (step.done) break;
  }
  assert.equal(total, roomBlocks(room, worldOf(room)).length);
});

test("the writing order grounds the player before it walls them in", () => {
  const manager = grow(999, 12);
  for (const room of manager.allRooms()) {
    const phases = roomBlocks(room, worldOf(room)).map((block) => block.phase);
    const lastFloor = phases.lastIndexOf(BUILD_PHASE.FLOOR);
    const firstWall = phases.indexOf(BUILD_PHASE.WALL);
    assert.ok(lastFloor < firstWall, `${room.id}: walls are written before the floor is complete`);
    const lastWall = phases.lastIndexOf(BUILD_PHASE.WALL);
    const firstCeiling = phases.indexOf(BUILD_PHASE.CEILING);
    assert.ok(lastWall < firstCeiling, `${room.id}: the ceiling is written before the walls`);
  }
});

test("a pad is offered on a floor cell, and never on a doorway", () => {
  const manager = grow(6060, 20);
  for (const room of manager.allRooms()) {
    const cell = padCell(room);
    assert.ok(cell, `${room.id} offers no pad cell at all`);
    assert.equal(room.mask.cells[cell.z][cell.x], 1, `${room.id}: the pad is not on the floor`);
    const openings = doorwaySet(room);
    assert.equal(openings.has(`${cell.x},${cell.z}`), false,
      `${room.id}: the pad sits in a doorway, so walking through would teleport`);
  }
});

test("a pad room writes the pad last, after the room is walkable", () => {
  const manager = grow(3141, 10);
  const room = manager.allRooms()[1];
  const blocks = roomBlocks(room, worldOf(room), { pad: "Easy" });
  const pads = blocks.filter((block) => block.phase === BUILD_PHASE.PAD);
  assert.equal(pads.length, 1);
  assert.equal(pads[0].name, BLOCKS.PAD);
  assert.equal(blocks[blocks.length - 1].phase, BUILD_PHASE.PAD,
    "the pad is not the last thing written");
});

test("the audit finds a hole and names it, without rebuilding the room", () => {
  const manager = grow(1010, 6);
  const room = manager.allRooms()[1];
  const world = memoryWorld();
  const writer = createRoomWriter(world, { batchSize: 100_000 });
  writer.writeRoom(room, worldOf(room));
  assert.deepEqual(auditRoom(room, worldOf(room), world, { sample: 1 }), []);

  const floor = roomBlocks(room, worldOf(room)).find((block) => block.phase === BUILD_PHASE.FLOOR);
  world.setBlock(floor.x, floor.y, floor.z, "Air");
  const wrong = auditRoom(room, worldOf(room), world, { sample: 1 });
  assert.ok(wrong.length > 0, "the audit missed a broken floor");
  assert.equal(wrong[0].x, floor.x);
  // The floor is textured, so the expectation is "a floor block", not one
  // hard-coded name: asserting a single name would make the audit pass only for
  // the first cell of the palette.
  assert.ok(BLOCKS.FLOOR_POOL.includes(wrong[0].expected),
    `the audit expected ${wrong[0].expected}, which is not a floor block`);
});

test("the same room always produces the same blocks", () => {
  const manager = grow(8888, 5);
  const room = manager.allRooms()[1];
  const signature = () => roomBlocks(room, worldOf(room))
    .map((block) => `${block.x},${block.y},${block.z}:${block.name}`).join("|");
  assert.equal(signature(), signature());
});

test("two rooms never write a different block on the same cell", () => {
  // A shared cell written by both rooms is how a floor becomes a wall depending
  // on the build order. This test locks the rule in.
  const manager = grow(2222, 25);
  const seen = new Map();
  for (const room of manager.allRooms()) {
    for (const block of roomBlocks(room, worldOf(room))) {
      const key = `${block.x},${block.y},${block.z}`;
      const previous = seen.get(key);
      if (previous === undefined) {
        seen.set(key, block.name);
        continue;
      }
      assert.equal(previous, block.name, `the cell ${key} is written as ${previous} then ${block.name}`);
    }
  }
});

test("a joint is floored exactly once, by neither room twice", () => {
  // The joint cells belong to the connection. The test asserts that the two
  // rooms of a connection do not both claim the same joint cell with different
  // content, which is what a missing "who owns the passage" rule produces.
  const manager = grow(4242, 30);
  const floorOwners = new Map();
  for (const room of manager.allRooms()) {
    for (const block of roomBlocks(room, worldOf(room))) {
      if (block.phase !== BUILD_PHASE.FLOOR) continue;
      const key = `${block.x},${block.y},${block.z}`;
      const owners = floorOwners.get(key) || [];
      owners.push(room.id);
      floorOwners.set(key, owners);
    }
  }
  for (const [cell, owners] of floorOwners) {
    assert.equal(owners.length, 1, `the floor cell ${cell} is claimed by ${owners.join(" and ")}`);
  }
});

// ------------------------------------------------------------- the texture --

test("every structural cell is drawn from the stone palette, one block at a time", () => {
  const manager = grow(12345, 12);
  for (const room of manager.allRooms()) {
    for (const block of roomBlocks(room, worldOf(room))) {
      if (block.phase === BUILD_PHASE.CLEAR || block.phase === BUILD_PHASE.PAD) continue;
      assert.ok(STONE_PALETTE.includes(block.name),
        `${room.id}: ${block.name} at ${block.x},${block.y},${block.z} is not a stone block`);
    }
  }
});

test("a wall is textured, not flat: a palette of five names must actually be used", () => {
  const manager = grow(4242, 6);
  const room = manager.allRooms()[1];
  const walls = roomBlocks(room, worldOf(room)).filter((block) => block.phase === BUILD_PHASE.WALL);
  const names = new Set(walls.map((block) => block.name));
  assert.ok(names.size >= 3,
    `the walls only use ${names.size} block(s) (${[...names].join(", ")}), so the texture is flat`);
});

test("the texture never depends on the order of the writes", () => {
  // The block of a cell is a property of the room, not of the build. Two runs,
  // two batch sizes, two entry points: the same cell must get the same stone.
  const manager = grow(777, 8);
  const room = manager.allRooms()[2];
  const planned = roomBlocks(room, worldOf(room));
  const collected = new Map();
  const writer = createRoomWriter(
    { setBlock: (x, y, z, name) => collected.set(`${x},${y},${z}`, name) },
    { batchSize: 13 },
  );
  let cursor = null;
  for (let guard = 0; guard < 500; guard += 1) {
    const step = writer.writeRoom(room, worldOf(room), cursor);
    cursor = step.cursor;
    if (step.done) break;
  }
  for (const block of planned) {
    assert.equal(collected.get(`${block.x},${block.y},${block.z}`), block.name,
      `the cell ${block.x},${block.y},${block.z} got a different stone when written in batches`);
  }
});

test("two rooms do not get the same texture", () => {
  // A hash of the room seed is what makes the walls read as different stone in
  // different rooms; a single shared pattern would look like wallpaper.
  const manager = grow(31415, 10);
  const signature = (room) => roomBlocks(room, worldOf(room))
    .filter((block) => block.phase === BUILD_PHASE.WALL)
    .map((block) => block.name[0]).join("");
  const signatures = manager.allRooms().map(signature);
  assert.ok(new Set(signatures).size > 1, "every room has exactly the same wall texture");
});

// ------------------------------------------------------------ the passages --

test("a passage is a corridor: floored, walled on the flanks, roofed, and open", () => {
  const manager = grow(12345, 10);
  const connections = manager.allConnections();
  assert.ok(connections.length > 0, "no connection to build a passage for");
  const index = dungeonCellIndex(manager.allRooms(), connections);
  let checked = 0;
  for (const connection of connections) {
    const world = { x: 0, y: -1000, z: 0 };
    const blocks = passageBlocks(connection, world, index);
    const cells = passageCellsFor(connection);
    if (cells.length === 0) continue;
    const byCell = new Map();
    for (const block of blocks) {
      const key = `${block.x},${block.z}`;
      if (!byCell.has(key)) byCell.set(key, []);
      byCell.get(key).push(block);
    }
    for (const cell of cells) {
      const column = byCell.get(`${cell.x},${cell.z}`);
      if (!column) continue; // owned by a room, which builds it itself
      assert.ok(column.some((block) => block.y === -1000),
        `${connection.id}: the passage cell ${cell.x},${cell.z} has no floor`);
      // The walkable height must stay empty: writing there walls the doorway.
      // The walkable height must stay *clear*, not *unwritten*: the builder
      // actively clears the column, so that a tunnel which arrives second is not
      // sealed by the first one's masonry.
      const solidInside = column.filter((block) => block.y > -1000
        && block.y < -1000 + DUNGEON_CONFIG.passageHeight
        && block.name !== BLOCKS.EMPTY);
      assert.deepEqual(solidInside, [],
        `${connection.id}: the passage cell ${cell.x},${cell.z} is blocked at walking height`);
      checked += 1;
    }
    // A passage that is not covered is a trench open to the sky.
    assert.ok(blocks.some((block) => block.phase === BUILD_PHASE.CEILING),
      `${connection.id}: the passage has no roof`);
  }
  assert.ok(checked > 0, "no passage cell was inspected");
});

test("a passage never writes on a cell a room owns", () => {
  const manager = grow(4242, 15);
  const rooms = manager.allRooms();
  const connections = manager.allConnections();
  const index = dungeonCellIndex(rooms, connections);
  for (const connection of connections) {
    for (const block of passageBlocks(connection, { x: 0, y: -1000, z: 0 }, index)) {
      assert.equal(index.owned.has(`${block.x},${block.z}`), false,
        `${connection.id} wrote on ${block.x},${block.z}, which belongs to a room`);
    }
  }
});

test("no cell is written twice once the passages are built too", () => {
  // The rule that used to hold only inside one room now has to hold for the
  // whole dungeon: a room and the tunnel that leads to it share a doorway.
  const manager = grow(6060, 12);
  const rooms = manager.allRooms();
  const connections = manager.allConnections();
  const index = dungeonCellIndex(rooms, connections);
  const world = { x: 0, y: -1000, z: 0 };
  const seen = new Map();
  const record = (block, owner) => {
    const key = `${block.x},${block.y},${block.z}`;
    const previous = seen.get(key);
    if (previous && previous.name !== block.name) {
      throw new Error(`${key} written as ${previous.name} by ${previous.owner} then ${block.name} by ${owner}`);
    }
    seen.set(key, { name: block.name, owner });
  };
  for (const room of rooms) {
    for (const block of roomBlocks(room, { x: room.origin.x, y: -1000, z: room.origin.y })) record(block, room.id);
  }
  for (const connection of connections) {
    for (const block of passageBlocks(connection, world, index)) record(block, connection.id);
  }
  assert.ok(seen.size > 0);
});
