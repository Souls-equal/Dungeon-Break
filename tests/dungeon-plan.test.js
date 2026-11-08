import test from "node:test";
import assert from "node:assert/strict";
import {
  blockKey,
  createDungeonPlan,
  createEndlessRoomPlan,
  dungeonBlockIterator,
  endlessRoomBlockIterator,
  ROOM_TYPES,
} from "../src/dungeon/generator.js";

function collectBlocks(iterator) {
  return Array.from(iterator);
}

function buildSets(blocks, floorY) {
  const floor = new Set();
  const solid = new Set();

  for (const { x, y, z } of blocks) {
    if (y === floorY) floor.add(`${x},${z}`);
    else solid.add(`${x},${y},${z}`);
  }
  return { floor, solid };
}

function isWalkable(sets, floorY, x, z) {
  return sets.floor.has(`${x},${z}`)
    && !sets.solid.has(`${x},${floorY + 1},${z}`)
    && !sets.solid.has(`${x},${floorY + 2},${z}`);
}

/** Flood fill the level from the spawn to prove every room is reachable on foot. */
function walkableCells(plan, sets) {
  const startX = Math.floor(plan.spawnPosition[0]);
  const startZ = Math.floor(plan.spawnPosition[2]);
  const visited = new Set([`${startX},${startZ}`]);
  const stack = [[startX, startZ]];

  while (stack.length > 0) {
    const [x, z] = stack.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nextX = x + dx;
      const nextZ = z + dz;
      const key = `${nextX},${nextZ}`;
      if (visited.has(key) || !isWalkable(sets, plan.floorY, nextX, nextZ)) continue;
      visited.add(key);
      stack.push([nextX, nextZ]);
    }
  }
  return visited;
}

function expectedWallCells(room) {
  const half = 1;
  const centerX = room.x + (room.width - 1) / 2;
  const centerZ = room.z + (room.depth - 1) / 2;
  const minX = room.x;
  const maxX = room.x + room.width - 1;
  const minZ = room.z;
  const maxZ = room.z + room.depth - 1;
  const cells = new Set();
  const add = (x, z) => cells.add(`${x},${z}`);

  for (let x = minX; x <= maxX; x += 1) {
    if (!(room.ports.north && Math.abs(x - centerX) <= half)) add(x, minZ);
    if (!(room.ports.south && Math.abs(x - centerX) <= half)) add(x, maxZ);
  }
  for (let z = minZ + 1; z <= maxZ - 1; z += 1) {
    if (!(room.ports.west && Math.abs(z - centerZ) <= half)) add(minX, z);
    if (!(room.ports.east && Math.abs(z - centerZ) <= half)) add(maxX, z);
  }
  return cells;
}

test("each room is a self-contained jigsaw piece with its own walls and doors", () => {
  const plan = createDungeonPlan(123456789, "Normal");
  const blocks = collectBlocks(dungeonBlockIterator(plan));
  const sets = buildSets(blocks, plan.floorY);
  const solidColumns = new Set(
    [...sets.solid].map((key) => {
      const [x, , z] = key.split(",");
      return `${x},${z}`;
    }),
  );

  for (const room of plan.rooms) {
    for (const cell of expectedWallCells(room)) {
      assert.ok(solidColumns.has(cell), `room ${room.index} owns a solid wall at ${cell}`);
    }
    // Interior stays free of walls, except its own decoration template.
    for (let x = room.x; x < room.x + room.width; x += 1) {
      for (let z = room.z; z < room.z + room.depth; z += 1) {
        assert.ok(sets.floor.has(`${x},${z}`), `interior floor exists at ${x},${z}`);
      }
    }
  }

  const walkable = walkableCells(plan, sets);
  for (const room of plan.rooms) {
    assert.ok(
      walkable.has(`${room.x + 2},${room.z + 2}`),
      `room ${room.index} can be reached on foot from the spawn`,
    );
  }
  assert.ok(walkable.has(`${plan.endlessFrontier.centerX},${plan.endlessFrontier.z}`));
});

test("doors are 3 wide, aligned between neighbours and floored in the gap", () => {
  const plan = createDungeonPlan(123456789, "Normal");
  const blocks = collectBlocks(dungeonBlockIterator(plan));
  const sets = buildSets(blocks, plan.floorY);

  for (const room of plan.rooms) {
    const centerX = room.x + (room.width - 1) / 2;
    const centerZ = room.z + (room.depth - 1) / 2;

    if (room.ports.east) {
      const neighbour = plan.rooms[room.index + 1];
      assert.equal(neighbour.ports.west, true, "both rooms own the same door");
      for (let offset = -1; offset <= 1; offset += 1) {
        assert.ok(
          sets.floor.has(`${room.x + room.width},${centerZ + offset}`),
          "the corridor between rooms is floored",
        );
      }
      assert.equal(room.width + 1, neighbour.x - room.x, "one free cell separates the rooms");
    }
    if (room.ports.south && room.row + 1 < plan.cellCount) {
      const neighbour = plan.rooms[room.index + plan.cellCount];
      assert.equal(neighbour.ports.north, true);
      for (let offset = -1; offset <= 1; offset += 1) {
        assert.ok(sets.floor.has(`${centerX + offset},${room.z + room.depth}`));
      }
    }
    if (!room.ports.east && room.column + 1 < plan.cellCount) {
      assert.ok(
        !sets.floor.has(`${room.x + room.width},${centerZ}`),
        "a closed side is never a corridor",
      );
    }
  }
});

test("the dungeon is a single level without duplicated blocks", () => {
  const plan = createDungeonPlan(24680, "Hard");
  const blocks = collectBlocks(dungeonBlockIterator(plan));
  const keys = new Set();

  for (const block of blocks) {
    const key = blockKey(block.x, block.y, block.z);
    assert.ok(!keys.has(key), `block ${key} is placed only once`);
    keys.add(key);
    assert.ok(block.y === plan.floorY || (block.y > plan.floorY && block.y <= plan.floorY + 3));
  }

  const floors = blocks.filter((block) => block.y === plan.floorY);
  const walls = blocks.filter((block) => block.y !== plan.floorY);
  assert.ok(floors.every(({ blockName }) => blockName === "Stone Bricks"));
  assert.ok(walls.length > 0);
  assert.equal(new Set(walls.map(({ blockName }) => blockName)).size > 1, true);
  assert.ok(
    blocks.slice(0, floors.length).every(({ y }) => y === plan.floorY),
    "all floors are streamed before any wall",
  );
});

test("difficulty scales the room grid; seeds vary room pieces and layout", () => {
  const easy = createDungeonPlan(87654321, "Very Easy");
  const hell = createDungeonPlan(87654322, "Hell");
  const differentSeed = createDungeonPlan(87654323, "Hell");

  assert.equal(easy.cellCount, 4);
  assert.equal(easy.roomCount, 16);
  assert.equal(easy.width, 25);
  assert.ok(easy.passageCount >= easy.roomCount - 1, "every room is reachable");
  assert.equal(hell.cellCount, 11);
  assert.equal(hell.roomCount, 121);
  assert.equal(hell.width, 67);
  assert.ok(hell.passageCount >= hell.roomCount - 1, "maze edges stay a spanning tree, plus extra loops");
  assert.ok(Object.values(hell.roomStyleCounts).every((count) => count > 0));
  assert.ok(new Set(hell.rooms.map((room) => room.type)).size >= 4);
  assert.ok(hell.rooms.every((room) => ROOM_TYPES.includes(room.type)));

  const layout = (plan) => plan.rooms.map(({ type, ports }) => [type, ports]);
  assert.notDeepEqual(layout(hell), layout(differentSeed), "different seeds produce different dungeons");
  assert.deepEqual(layout(createDungeonPlan(87654322, "Hell")), layout(hell), "a seed is reproducible");
});

test("the spawn pad is a supported 3x3 area inside the first room", () => {
  for (const difficulty of ["Very Easy", "Normal", "Hell"]) {
    const plan = createDungeonPlan(13579, difficulty);
    const blocks = collectBlocks(dungeonBlockIterator(plan));
    const sets = buildSets(blocks, plan.floorY);
    const padX = plan.spawnPosition[0] - 0.5;
    const padZ = plan.spawnPosition[2] - 0.5;
    const startRoom = plan.rooms[0];

    assert.equal(plan.spawnPosition[1], plan.floorY + 1);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const x = padX + dx;
        const z = padZ + dz;
        assert.ok(sets.floor.has(`${x},${z}`), "the teleport pad never stands on a hole");
        assert.ok(x >= startRoom.x && x < startRoom.x + startRoom.width);
        assert.ok(z >= startRoom.z && z < startRoom.z + startRoom.depth);
      }
    }
  }
});

test("streamed rooms clip into the previous one and close at the boundary", () => {
  const plan = createDungeonPlan(2468, "Normal");
  const first = createEndlessRoomPlan(1, plan.endlessFrontier.centerX, plan.floorY, plan.endlessFrontier.nextRoomZ);
  const second = createEndlessRoomPlan(2, plan.endlessFrontier.centerX, plan.floorY, first.endZ + 2);
  const last = createEndlessRoomPlan(3, plan.endlessFrontier.centerX, plan.floorY, second.endZ + 2, false);
  const boundary = createEndlessRoomPlan(4, 0, plan.floorY, 49994, false, 50000);

  assert.equal(first.startZ, plan.endlessFrontier.nextRoomZ, "no gap between the grid and streamed rooms");
  assert.equal(second.startZ, first.endZ + 2);
  assert.equal(last.startZ, second.endZ + 2);
  assert.ok([7, 9].includes(first.roomWidth));
  assert.ok([7, 9].includes(first.roomDepth));
  assert.equal(
    first.room.x + (first.roomWidth - 1) / 2,
    plan.endlessFrontier.centerX,
    "the grid exit door opens onto the next room's door",
  );

  const boundaryBlocks = collectBlocks(endlessRoomBlockIterator(boundary));
  assert.equal(boundary.endZ, 50000);
  assert.ok(boundary.roomDepth >= 7);
  assert.ok(boundaryBlocks.every(({ z }) => z <= 50000), "streamed rooms never leave the world bounds");

  const lastBlocks = collectBlocks(endlessRoomBlockIterator(last));
  const solidColumns = new Set(
    lastBlocks.filter(({ y }) => y > plan.floorY).map(({ x, z }) => `${x},${z}`),
  );
  const centerX = last.room.x + (last.roomWidth - 1) / 2;
  assert.ok(
    solidColumns.has(`${centerX},${last.endZ}`),
    "the terminal room closes its exit instead of opening into the void",
  );
  assert.ok(
    !solidColumns.has(`${centerX},${last.startZ}`),
    "the entrance door of the terminal room stays open to the previous room",
  );

  assert.deepEqual(
    collectBlocks(endlessRoomBlockIterator(createEndlessRoomPlan(5, 12, plan.floorY, 100))),
    collectBlocks(endlessRoomBlockIterator(createEndlessRoomPlan(5, 12, plan.floorY, 100))),
    "a streamed room is reproducible from its seed",
  );
});
