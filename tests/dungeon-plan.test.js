import test from "node:test";
import assert from "node:assert/strict";
import {
  MODULE_TYPE_IDS,
  blockKey,
  createDungeonPlan,
  createEndlessRoomPlan,
  dungeonBlockIterator,
  endlessRoomBlockIterator,
  moduleTypeForSides,
} from "../src/dungeon/generator.js";

const DIFFICULTIES = ["Very Easy", "Easy", "Medium", "Normal", "Hard", "Insane", "Ultra Insane", "Hell"];

function collect(iterator) {
  return Array.from(iterator);
}

/**
 * Everything the level looks like once built, without the iterative walker.
 * Solid rock also sits on the floor layer, so it is tracked separately: only
 * the tiles the rooms and corridors own count as walkable floor.
 */
function buildWorld(blocks, level) {
  const floorY = level.floorY;
  const floor = new Set();
  const walls = new Set();
  const above = new Set();
  const keys = new Set();
  const duplicates = [];

  for (const { x, y, z, blockName } of blocks) {
    const key = blockKey(x, y, z);
    if (keys.has(key)) duplicates.push(key);
    keys.add(key);
    if (y === floorY && !level.rockCells.has(`${x},${z}`)) floor.add(`${x},${z}`);
    else if (y !== floorY) {
      walls.add(`${x},${y},${z}`);
      above.add(`${x},${z}`);
    }
    void blockName;
  }
  return { floor, walls, above, duplicates, keys };
}

function floorTilesOfRoom(room) {
  const tiles = [];
  for (let x = room.x; x < room.x + room.width; x += 1) {
    for (let z = room.z; z < room.z + room.depth; z += 1) tiles.push(`${x},${z}`);
  }
  return tiles;
}

test("a module's shape is its doors: one, two, three or four ways", () => {
  assert.equal(moduleTypeForSides([]).id, "end");
  assert.equal(moduleTypeForSides(["north"]).id, "end");
  assert.equal(moduleTypeForSides(["north", "south"]).id, "corridor");
  assert.equal(moduleTypeForSides(["east", "west"]).id, "corridor");
  assert.equal(moduleTypeForSides(["north", "east"]).id, "turn");
  assert.equal(moduleTypeForSides(["south", "west"]).id, "turn");
  assert.equal(moduleTypeForSides(["north", "east", "south"]).id, "tJunction");
  assert.equal(moduleTypeForSides(["north", "east", "south", "west"]).id, "crossroads");
  assert.deepEqual(
    MODULE_TYPE_IDS.slice().sort(),
    ["corridor", "crossroads", "end", "stairs", "tJunction", "turn"],
  );
});

test("every level is one floor, evenly floored, without duplicated blocks", () => {
  for (const difficulty of DIFFICULTIES) {
    const plan = createDungeonPlan(91234, difficulty);
    const blocks = collect(dungeonBlockIterator(plan));
    const world = buildWorld(blocks, plan.level);

    assert.equal(world.duplicates.length, 0, `${difficulty}: no block is written twice`);
    assert.ok(blocks.every(({ y }) => y >= plan.level.floorY && y <= plan.level.floorY + 3));
    for (const room of plan.level.rooms) {
      for (const tile of floorTilesOfRoom(room)) {
        assert.ok(world.floor.has(tile), `${difficulty}: room ${room.index} floor is complete at ${tile}`);
      }
    }
    for (const rect of [plan.level.entrance]) {
      assert.ok(world.floor.has(`${rect.centerX},${rect.z}`));
    }
  }
});

test("rooms are carved rooms: walls on every side, except on their own doors", () => {
  const plan = createDungeonPlan(24680, "Normal");
  const blocks = collect(dungeonBlockIterator(plan));
  const { walls } = buildWorld(blocks, plan.level);
  const half = 1;

  for (const room of plan.level.rooms) {
    const minX = room.x;
    const maxX = room.x + room.width - 1;
    const minZ = room.z;
    const maxZ = room.z + room.depth - 1;

    for (let x = minX; x <= maxX; x += 1) {
      const northDoor = room.ports.north && Math.abs(x - (minX + 3)) <= half;
      const southDoor = room.ports.south && Math.abs(x - (minX + 3)) <= half;
      if (!northDoor) assert.ok(walls.has(`${x},${plan.level.floorY + 1},${minZ}`), "north wall");
      if (!southDoor) assert.ok(walls.has(`${x},${plan.level.floorY + 1},${maxZ}`), "south wall");
    }
    for (let z = minZ + 1; z <= maxZ - 1; z += 1) {
      const westDoor = room.ports.west && Math.abs(z - (minZ + 3)) <= half;
      const eastDoor = room.ports.east && Math.abs(z - (minZ + 3)) <= half;
      if (!westDoor) assert.ok(walls.has(`${minX},${plan.level.floorY + 1},${z}`), "west wall");
      if (!eastDoor) assert.ok(walls.has(`${maxX},${plan.level.floorY + 1},${z}`), "east wall");
    }
  }
});

test("doors are 3 wide, aligned and floored between neighbours", () => {
  const plan = createDungeonPlan(24680, "Normal");
  const world = buildWorld(collect(dungeonBlockIterator(plan)), plan.level);
  const at = (row, column) => plan.level.rooms.find(
    (room) => room.row === row && room.column === column,
  );
  const stride = 8;

  for (const room of plan.level.rooms) {
    const centerX = room.x + 3;
    const centerZ = room.z + 3;

    if (room.ports.east) {
      const neighbour = at(room.row, room.column + 1);
      assert.ok(neighbour, "an east door always faces a room");
      assert.equal(neighbour.ports.west, true, "both rooms own the shared door");
      assert.equal(neighbour.x - room.x, stride);
      for (let offset = -1; offset <= 1; offset += 1) {
        assert.ok(world.floor.has(`${room.x + room.width},${centerZ + offset}`), "corridor is floored");
      }
    }
    if (room.ports.south && room !== plan.level.exit.room) {
      const neighbour = at(room.row + 1, room.column);
      assert.ok(neighbour, "a south door always faces a room");
      assert.equal(neighbour.ports.north, true);
      for (let offset = -1; offset <= 1; offset += 1) {
        assert.ok(world.floor.has(`${centerX + offset},${room.z + room.depth}`), "corridor is floored");
      }
    }
    if (!room.ports.east && at(room.row, room.column + 1)) {
      const corridor = [];
      for (let offset = -1; offset <= 1; offset += 1) {
        corridor.push(world.floor.has(`${room.x + room.width},${centerZ + offset}`));
      }
      assert.ok(corridor.includes(false), "a solid side is never a full corridor");
    }
  }
});

test("every room is reachable on foot from the spawn, stairs included", () => {
  for (const difficulty of ["Very Easy", "Normal", "Hell"]) {
    for (let seed = 1; seed <= 4; seed += 1) {
      const plan = createDungeonPlan(seed * 104729 + 11, difficulty);
      const level = plan.level;
      const y = level.floorY;
      const blocks = collect(dungeonBlockIterator(plan));
      const floor = new Set();
      const solid = new Set();
      /** Height of the standable top of a cell, null when it cannot be walked. */
      const walkHeight = new Map();

      for (const { x, y: by, z } of blocks) {
        if (by === y) floor.add(`${x},${z}`);
        else solid.add(`${x},${by},${z}`);
      }
      for (const key of floor) {
        const [x, z] = key.split(",").map(Number);
        let top = 0;
        while (solid.has(`${x},${y + top + 1},${z}`)) top += 1;
        if (!solid.has(`${x},${y + top + 1},${z}`)) walkHeight.set(key, top);
      }

      const startKey = `${Math.floor(level.spawnPosition[0])},${Math.floor(level.spawnPosition[2])}`;
      assert.ok(walkHeight.has(startKey), "the spawn stands on the floor");
      const seen = new Set([startKey]);
      const stack = [startKey];

      while (stack.length > 0) {
        const current = stack.pop();
        const [x, z] = current.split(",").map(Number);
        const height = walkHeight.get(current);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const key = `${x + dx},${z + dz}`;
          if (seen.has(key) || !walkHeight.has(key)) continue;
          // One block of step at a time: exactly how a staircase is built.
          if (Math.abs(walkHeight.get(key) - height) > 1) continue;
          seen.add(key);
          stack.push(key);
        }
      }

      for (const room of level.rooms) {
        assert.ok(
          floorTilesOfRoom(room).some((tile) => seen.has(tile)),
          `${difficulty}/${seed}: room ${room.index} (${room.type.id}) is reachable`,
        );
      }
    }
  }
});

test("a staircase keeps both doors at floor level and steps one block at a time", () => {
  let checked = 0;
  for (let seed = 1; seed <= 40 && checked < 4; seed += 1) {
    const plan = createDungeonPlan(seed * 7919 + 3, "Normal");
    const level = plan.level;
    const y = level.floorY;

    for (const room of level.rooms) {
      if (!room.stairKind) continue;
      checked += 1;
      const blocks = collect(dungeonBlockIterator(plan)).filter(({ x, z }) => (
        x >= room.x && x < room.x + room.width && z >= room.z && z < room.z + room.depth
      ));
      const topAt = new Map();
      for (const block of blocks) {
        if (block.y <= y) continue;
        const key = `${block.x},${block.z}`;
        topAt.set(key, Math.max(topAt.get(key) ?? y, block.y));
      }
      const heights = new Set([...topAt.values()].map((top) => top - y));
      assert.ok(heights.size >= 2, "the staircase really has steps");

      const alongZ = room.stairDirection === "north" || room.stairDirection === "south";
      const centerX = room.x + 3;
      const centerZ = room.z + 3;
      const doorTiles = alongZ
        ? [[centerX, room.z], [centerX, room.z + room.depth - 1]]
        : [[room.x, centerZ], [room.x + room.width - 1, centerZ]];
      for (const [x, z] of doorTiles) {
        assert.equal(topAt.has(`${x},${z}`), false, "the door lane stays at floor level");
      }
      // Every band of the stair lane must be walkable: no step higher than one.
      const lane = [];
      for (let band = 0; band < room.width; band += 1) {
        const key = alongZ ? `${centerX},${room.z + band}` : `${room.x + band},${centerZ}`;
        lane.push((topAt.get(key) ?? y) - y);
      }
      for (let index = 1; index < lane.length; index += 1) {
        assert.ok(Math.abs(lane[index] - lane[index - 1]) <= 1, "steps are one block high");
      }
    }
  }
  assert.ok(checked > 0, "at least one staircase was generated");
});

test("stairs appear but never stack on a shared corridor", () => {
  for (const difficulty of ["Normal", "Hell"]) {
    for (let seed = 1; seed <= 6; seed += 1) {
      const plan = createDungeonPlan(seed * 31337 + 5, difficulty);
      const stairRooms = plan.level.rooms.filter((room) => room.stairKind);
      for (const room of stairRooms) {
        const candidates = plan.level.rooms.filter((other) => other !== room
          && Math.abs(other.row - room.row) + Math.abs(other.column - room.column) === 1);
        assert.ok(candidates.every((other) => !other.stairKind), "neighbouring staircases are avoided");
      }
    }
  }
});

test("difficulty scales the dungeon and the module mix stays varied", () => {
  const easy = createDungeonPlan(5150, "Very Easy");
  const hell = createDungeonPlan(5150, "Hell");
  assert.ok(hell.level.roomCount > easy.level.roomCount, "harder dungeons have more rooms");
  assert.ok(hell.level.cellCount > easy.level.cellCount, "and a bigger rocky footprint");

  const shapes = new Set();
  let stairLevels = 0;
  for (let seed = 1; seed <= 8; seed += 1) {
    const plan = createDungeonPlan(seed * 104729 + 7, "Hard");
    for (const room of plan.level.rooms) shapes.add(room.type.id);
    if (plan.level.stairCount > 0) stairLevels += 1;
  }
  for (const shape of ["end", "corridor", "turn", "tJunction"]) {
    assert.ok(shapes.has(shape), `module type ${shape} appears across dungeons`);
  }
  assert.ok(shapes.has("stairs"), "staircases appear");
  assert.ok(stairLevels >= 6, "most dungeons contain a staircase");
});

test("the seed drives the layout and reproduces it exactly", () => {
  const a = createDungeonPlan(4242, "Normal");
  const b = createDungeonPlan(4242, "Normal");
  const c = createDungeonPlan(4243, "Normal");
  const layout = (plan) => plan.level.rooms.map(({ index, type, ports }) => [index, type.id, ports]);

  assert.deepEqual(layout(a), layout(b));
  assert.notDeepEqual(layout(a), layout(c));
  assert.deepEqual(collect(dungeonBlockIterator(a)), collect(dungeonBlockIterator(b)));
});

test("the spawn pad is a supported 3x3 area inside the entrance room", () => {
  for (const difficulty of DIFFICULTIES) {
    const plan = createDungeonPlan(13579, difficulty);
    const world = buildWorld(collect(dungeonBlockIterator(plan)), plan.level);
    const [spawnX, spawnY, spawnZ] = plan.level.spawnPosition;
    const startRoom = plan.level.rooms[0];

    assert.equal(spawnY, plan.level.floorY + 1);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const x = spawnX - 0.5 + dx;
        const z = spawnZ - 0.5 + dz;
        assert.ok(world.floor.has(`${x},${z}`), "the teleport pad never stands on a hole");
        assert.ok(x >= startRoom.x && x < startRoom.x + startRoom.width);
        assert.ok(z >= startRoom.z && z < startRoom.z + startRoom.depth);
      }
    }
  }
});

test("streamed rooms continue the route, vary in shape and close at the boundary", () => {
  const plan = createDungeonPlan(2468, "Normal");
  const first = createEndlessRoomPlan(11, plan.frontier.centerX, plan.frontier.floorY, plan.frontier.nextRoomZ);
  const second = createEndlessRoomPlan(22, plan.frontier.centerX, plan.frontier.floorY, first.endZ + 2);
  const last = createEndlessRoomPlan(33, plan.frontier.centerX, plan.frontier.floorY, second.endZ + 2, false);
  const boundary = createEndlessRoomPlan(44, 0, plan.frontier.floorY, 49994, false, 50000);

  assert.equal(first.startZ, plan.frontier.nextRoomZ, "no gap after the exit corridor");
  assert.equal(first.room.ports.north, true, "the new room opens onto the previous corridor");
  assert.equal(second.startZ, first.endZ + 2);
  assert.equal(last.startZ, second.endZ + 2);
  assert.ok(boundary.endZ <= 50000, "streamed rooms stay inside the world");
  assert.equal(last.room.ports.north, true);
  assert.equal(countOpen(last.room.ports), 1, "the terminal room closes its exit");

  const shapes = new Set();
  for (let seed = 1; seed <= 60; seed += 1) {
    shapes.add(createEndlessRoomPlan(seed * 7919, 0, -1000, 100).room.type.id);
  }
  assert.ok(shapes.size >= 3, "streamed rooms are not all the same shape");

  const blocks = collect(endlessRoomBlockIterator(last));
  const walls = new Set(blocks.filter(({ y }) => y !== plan.frontier.floorY).map(({ x, z }) => `${x},${z}`));
  const centerX = last.room.x + 3;
  assert.ok(walls.has(`${centerX},${last.endZ}`), "the last room is walled where the route stops");
});

function countOpen(ports) {
  return ["north", "east", "south", "west"].filter((side) => ports[side]).length;
}
