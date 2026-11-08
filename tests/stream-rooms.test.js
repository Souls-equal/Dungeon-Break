import test from "node:test";
import assert from "node:assert/strict";
import {
  createDungeonPlan,
  createEndlessRoomPlan,
  dungeonBlockIterator,
  endlessRoomBlockIterator,
} from "../src/dungeon/generator.js";

function roomKeySet(blocks) {
  return new Set(blocks.map(({ x, y, z }) => `${x},${y},${z}`));
}

test("grid and streamed rooms never place the same block twice", () => {
  for (const difficulty of ["Very Easy", "Normal", "Hell"]) {
    const plan = createDungeonPlan(97531, difficulty);
    const gridBlocks = Array.from(dungeonBlockIterator(plan));
    const gridKeys = roomKeySet(gridBlocks);

    let startZ = plan.frontier.nextRoomZ;
    let streamed = [];
    for (let index = 0; index < 4; index += 1) {
      const room = createEndlessRoomPlan(index + 1, plan.frontier.centerX, plan.level.floorY, startZ);
      streamed = streamed.concat(Array.from(endlessRoomBlockIterator(room)));
      startZ = room.endZ + 2;
    }

    const streamedKeys = roomKeySet(streamed);
    assert.equal(streamedKeys.size, streamed.length, "streamed rooms stay free of duplicates");
    for (const key of streamedKeys) {
      assert.ok(!gridKeys.has(key), `streamed room block ${key} never overwrites the grid level`);
    }
  }
});
