import test from "node:test";
import assert from "node:assert/strict";
import { createDungeonPlan } from "../src/dungeon/generator.js";

test("maze plans stay within the configured horizontal world range", () => {
  const plan = createDungeonPlan(123456789, "Normal");
  const [spawnX, spawnY, spawnZ] = plan.spawnPosition;

  assert.equal(plan.cellCount, 7);
  assert.equal(plan.width, 43);
  assert.equal(plan.passageCount, plan.cellCount * plan.cellCount - 1);
  assert.ok(plan.originX >= -50000);
  assert.ok(plan.originZ >= -50000);
  assert.ok(plan.originX + plan.width - 1 <= 50000);
  assert.ok(plan.originZ + plan.width - 1 <= 50000);
  assert.equal(spawnY, -999);
  assert.ok(spawnX > plan.originX && spawnX < plan.originX + plan.width - 1);
  assert.ok(spawnZ > plan.originZ && spawnZ < plan.originZ + plan.width - 1);
  assert.ok(plan.walls.length > 0);
});

test("difficulty changes maze size and the seed changes the layout", () => {
  const easy = createDungeonPlan(87654321, "Very Easy");
  const hellA = createDungeonPlan(87654321, "Hell");
  const hellB = createDungeonPlan(87654322, "Hell");

  assert.equal(easy.cellCount, 4);
  assert.equal(easy.width, 25);
  assert.equal(hellA.cellCount, 11);
  assert.equal(hellA.width, 67);
  assert.equal(hellA.passageCount, 11 * 11 - 1);
  assert.ok(hellA.pillarCount > 0 && hellA.pillarCount < 11 * 11 - 2);

  const localWalls = (plan) => plan.walls.map((wall) => [
    wall.from[0] - plan.originX,
    wall.from[1],
    wall.from[2] - plan.originZ,
    wall.to[0] - plan.originX,
    wall.to[1],
    wall.to[2] - plan.originZ,
  ]);
  assert.notDeepEqual(localWalls(hellA), localWalls(hellB));
});
