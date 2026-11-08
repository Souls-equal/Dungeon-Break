import test from "node:test";
import assert from "node:assert/strict";
import { createDungeonPlan, createEndlessRoomPlan } from "../src/dungeon/generator.js";

const ROOM_TYPES = ["open", "pillar", "twinPillars", "alcove", "fourPillars", "zigzag"];

function rectangleContains(rect, x, y, z) {
  return x >= rect.from[0] && x <= rect.to[0]
    && y >= rect.from[1] && y <= rect.to[1]
    && z >= rect.from[2] && z <= rect.to[2];
}

function roomsReachable(plan) {
  const visited = new Set([0]);
  const queue = [plan.rooms[0]];
  while (queue.length > 0) {
    const room = queue.shift();
    const neighbors = [
      room.ports.north && plan.rooms[room.index - plan.cellCount],
      room.ports.east && plan.rooms[room.index + 1],
      room.ports.south && plan.rooms[room.index + plan.cellCount],
      room.ports.west && plan.rooms[room.index - 1],
    ];
    for (const neighbor of neighbors) {
      if (neighbor && !visited.has(neighbor.index)) {
        visited.add(neighbor.index);
        queue.push(neighbor);
      }
    }
  }
  return visited.size;
}

test("the dungeon is a single-level connected grid with a continuous floor", () => {
  const plan = createDungeonPlan(123456789, "Normal");
  const [spawnX, spawnY, spawnZ] = plan.spawnPosition;
  const maxX = plan.originX + plan.width - 1;
  const maxZ = plan.originZ + plan.width - 1;

  assert.equal(plan.cellCount, 7);
  assert.equal(plan.width, 43);
  assert.equal(plan.roomCount, 49);
  assert.equal(plan.rooms.length, plan.roomCount);
  assert.equal(plan.passageCount, plan.roomCount - 1);
  assert.equal(spawnY, plan.floorY + 1);
  assert.ok(spawnX > plan.originX && spawnX < maxX);
  assert.ok(spawnZ > plan.originZ && spawnZ < maxZ);
  assert.ok(plan.originX >= -50000);
  assert.ok(maxX <= 50000);
  assert.ok(plan.originZ - 2 >= -50000);
  assert.ok(maxZ + 2 <= 50000);
  assert.equal(roomsReachable(plan), plan.roomCount, "every room connects back to the entrance");

  for (let x = plan.originX; x <= maxX; x += 1) {
    for (let z = plan.originZ - 2; z <= maxZ + 2; z += 1) {
      assert.ok(plan.floorRects.some((rect) => rectangleContains(rect, x, plan.floorY, z)), "the floor has no gaps");
    }
  }
  assert.ok(plan.floorRects.every((rect) => rect.from[1] === plan.floorY && rect.to[1] === plan.floorY));
  assert.ok(plan.walls.every((wall) => (
    wall.from[1] >= plan.floorY + 1 && wall.to[1] <= plan.floorY + 3
      && wall.randomWallTexture === true
  )), "the only raised blocks are room walls and decorations, not another floor");

  const start = plan.rooms[0];
  const exit = plan.rooms.at(-1);
  assert.equal(start.ports.north, true, "the first module has an entrance socket");
  assert.equal(exit.ports.south, true, "the last module has an exit socket for streamed rooms");
  for (const room of plan.rooms) {
    if (room.column + 1 < plan.cellCount && room.ports.east) {
      assert.equal(plan.rooms[room.index + 1].ports.west, true);
    }
    if (room.row + 1 < plan.cellCount && room.ports.south) {
      assert.equal(plan.rooms[room.index + plan.cellCount].ports.north, true);
    }
    assert.ok(ROOM_TYPES.includes(room.type));
  }
});

test("difficulty changes room-grid size; room modules vary while sharing matching sockets", () => {
  const easy = createDungeonPlan(87654321, "Very Easy");
  const hell = createDungeonPlan(87654322, "Hell");
  const styles = new Set(hell.rooms.map((room) => room.type));
  const differentSeed = createDungeonPlan(87654323, "Hell");

  assert.equal(easy.cellCount, 4);
  assert.equal(easy.roomCount, 16);
  assert.equal(easy.width, 25);
  assert.equal(hell.cellCount, 11);
  assert.equal(hell.roomCount, 121);
  assert.equal(hell.width, 67);
  assert.equal(roomsReachable(hell), hell.roomCount);
  assert.ok(styles.size >= 4, "many distinct jigsaw room templates appear in one dungeon");
  assert.notDeepEqual(
    hell.rooms.map(({ type, ports }) => [type, ports]),
    differentSeed.rooms.map(({ type, ports }) => [type, ports]),
    "different seeds produce different room pieces and connector layouts",
  );
  assert.ok(Object.values(hell.roomStyleCounts).every((count) => count > 0));
});

test("endless room modules keep their door sockets aligned and close at the boundary", () => {
  const first = createEndlessRoomPlan(2468, 12, -1000, 100, true);
  const second = createEndlessRoomPlan(3579, 12, -1000, first.endZ + 1, true);
  const last = createEndlessRoomPlan(4680, 12, -1000, second.endZ + 1, false);
  const boundary = createEndlessRoomPlan(5791, 12, -1000, 49994, false, 50000);

  assert.ok([7, 9].includes(first.roomWidth));
  assert.ok([7, 9].includes(first.roomDepth));
  assert.equal(second.startZ, first.endZ + 1);
  assert.equal(last.startZ, second.endZ + 1);
  assert.equal(boundary.endZ, 50000);
  assert.equal(boundary.roomDepth, 7, "room depth shrinks when needed to stay within world bounds");
  assert.ok(ROOM_TYPES.includes(first.type));
  assert.equal(first.floorRects.length, 1);
  assert.ok(first.walls.every((wall) => wall.randomWallTexture === true));
  assert.ok(last.walls.some((wall) => (
    wall.from[2] === last.endZ && wall.to[2] === last.endZ
      && wall.from[0] <= 12 - (last.roomWidth - 1) / 2
      && wall.to[0] >= 12 + (last.roomWidth - 1) / 2
  )), "the terminal module closes its exit instead of opening into the void");
});
