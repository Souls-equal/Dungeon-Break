import test from "node:test";
import assert from "node:assert/strict";
import { createDungeonPlan, createEndlessRoomPlan } from "../src/dungeon/generator.js";

function normalizeWalls(plan, floor) {
  return floor.walls.map((wall) => [
    wall.from[0] - plan.originX,
    wall.from[1] - floor.floorY,
    wall.from[2] - plan.originZ,
    wall.to[0] - plan.originX,
    wall.to[1] - floor.floorY,
    wall.to[2] - plan.originZ,
  ]);
}

function rectangleContains(rect, x, y, z) {
  return x >= rect.from[0] && x <= rect.to[0]
    && y >= rect.from[1] && y <= rect.to[1]
    && z >= rect.from[2] && z <= rect.to[2];
}

test("multi-floor plans stay in range and carve each stairwell out of the floor", () => {
  const plan = createDungeonPlan(123456789, "Normal");
  const [spawnX, spawnY, spawnZ] = plan.spawnPosition;

  assert.equal(plan.cellCount, 7);
  assert.equal(plan.width, 43);
  assert.equal(plan.levelCount, 3);
  assert.equal(plan.floors.length, 3);
  assert.equal(plan.passageCount, plan.cellCount * plan.cellCount - 1);
  assert.ok(plan.originX >= -50000);
  assert.ok(plan.originZ >= -50000);
  assert.ok(plan.originX + plan.width - 1 <= 50000);
  assert.ok(plan.originZ + plan.width - 1 <= 50000);
  assert.ok(plan.floors[0].floorRects.some((rect) => rect.from[2] < plan.originZ), "the entrance has a landing");
  assert.ok(
    plan.floors.at(-1).floorRects.some((rect) => rect.to[2] > plan.originZ + plan.width - 1),
    "the exit has a landing",
  );
  for (const floor of plan.floors) {
    for (const rect of floor.floorRects) {
      assert.ok(rect.from[0] >= -50000 && rect.from[2] >= -50000);
      assert.ok(rect.to[0] <= 50000 && rect.to[2] <= 50000);
    }
  }
  assert.ok(plan.endlessFrontier.z > plan.originZ + plan.width - 1);

  assert.equal(spawnY, plan.floorY + 1);
  assert.ok(spawnX > plan.originX && spawnX < plan.originX + plan.width - 1);
  assert.ok(spawnZ > plan.originZ && spawnZ < plan.originZ + plan.width - 1);

  for (let levelIndex = 0; levelIndex < plan.floors.length; levelIndex += 1) {
    const floor = plan.floors[levelIndex];
    assert.equal(floor.floorY, plan.floorY + levelIndex * plan.levelGap);
    assert.ok(floor.floorRects.length > 0);
    assert.ok(floor.walls.length > 0);
    assert.ok(floor.floorRects.every((rect) => !rectangleContains(
      rect,
      plan.stairwell.minX + 1,
      floor.floorY,
      plan.stairwell.minZ + 1,
    )), "the 3x3 stairwell must remain open through every floor");
  }

  const spawnFloor = plan.floors[0].floorRects.some((rect) => rectangleContains(
    rect,
    spawnX - 0.5,
    plan.floorY,
    spawnZ - 0.5,
  ));
  assert.equal(spawnFloor, true, "the player spawns above a floor tile, not the stairwell");
});

test("difficulty controls dungeon size and staircase steps connect every floor", () => {
  const easy = createDungeonPlan(87654321, "Very Easy");
  const hell = createDungeonPlan(87654322, "Hell");

  assert.equal(easy.cellCount, 4);
  assert.equal(easy.width, 25);
  assert.equal(easy.levelCount, 2);
  assert.equal(hell.cellCount, 11);
  assert.equal(hell.width, 67);
  assert.equal(hell.levelCount, 5);
  assert.equal(hell.passageCount, 11 * 11 - 1);
  assert.equal(
    hell.stairBlocks.length,
    (hell.levelCount - 1) * 8 + 1,
    "each level gap has a full eight-step spiral and the top gets a landing block",
  );

  for (let index = 1; index < hell.stairBlocks.length; index += 1) {
    const previous = hell.stairBlocks[index - 1].from;
    const current = hell.stairBlocks[index].from;
    const horizontalStep = Math.abs(current[0] - previous[0]) + Math.abs(current[2] - previous[2]);
    assert.equal(horizontalStep, 1, "consecutive stair blocks are horizontally adjacent");
    assert.equal(current[1] - previous[1], 1, "each stair block rises by one block");
  }
});

test("levels include varied rooms and passages, and seeds change the generated layout", () => {
  const planA = createDungeonPlan(123456789, "Hell");
  const planB = createDungeonPlan(123456790, "Hell");
  const allStyles = planA.floors.reduce((counts, floor) => {
    for (const [style, count] of Object.entries(floor.roomStyleCounts)) {
      counts[style] = (counts[style] || 0) + count;
    }
    return counts;
  }, {});

  assert.ok(planA.pillarCount > 0);
  assert.ok(planA.alcoveCount > 0);
  assert.ok(planA.narrowCorridorCount > 0);
  assert.ok(planA.widePassageCount > 0);
  assert.equal(
    planA.narrowCorridorCount + planA.widePassageCount,
    planA.passageCount * planA.levelCount,
    "every maze connection is generated as a narrow corridor or a wide passage",
  );
  assert.equal(
    Object.values(allStyles).reduce((sum, count) => sum + count, 0),
    planA.cellCount * planA.cellCount * planA.levelCount,
    "every cell has a room style on every floor",
  );
  assert.notDeepEqual(normalizeWalls(planA, planA.floors[0]), normalizeWalls(planB, planB.floors[0]));
  assert.notDeepEqual(normalizeWalls(planA, planA.floors[0]), normalizeWalls(planA, planA.floors[1]));
});

test("endless room modules join door-to-door and close cleanly at the boundary", () => {
  const first = createEndlessRoomPlan(2468, 12, -984, 100, true);
  const second = createEndlessRoomPlan(3579, 12, -984, first.endZ + 1, true);
  const last = createEndlessRoomPlan(4680, 12, -984, second.endZ + 1, false);
  const boundary = createEndlessRoomPlan(5791, 12, -984, 49994, false, 50000);

  assert.ok([7, 9].includes(first.roomWidth));
  assert.ok([7, 9].includes(first.roomDepth));
  assert.equal(second.startZ, first.endZ + 1);
  assert.equal(last.startZ, second.endZ + 1);
  assert.equal(boundary.endZ, 50000);
  assert.equal(boundary.roomDepth, 7, "room depth shrinks when needed to stay within world bounds");
  assert.ok(first.operations.length >= 5);
  assert.ok(last.operations.some((rect) => (
    rect.from[1] === -983 && rect.to[1] === -981
      && rect.from[2] === last.endZ && rect.to[2] === last.endZ
      && rect.from[0] <= 12 && rect.to[0] >= 12
  )), "the terminal room closes its south doorway instead of opening into the void");
});
