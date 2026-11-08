import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseStreamedModule,
  createDungeonPlan,
  createStreamedModulePlan,
  dungeonBlockIterator,
  endlessRoomBlockIterator,
} from "../src/dungeon/generator.js";

function roomKeySet(blocks) {
  return new Set(blocks.map(({ x, y, z }) => `${x},${y},${z}`));
}

test("grid and streamed modules never place the same block twice", () => {
  for (const difficulty of ["Very Easy", "Normal", "Hell"]) {
    const plan = createDungeonPlan(97531, difficulty);
    const floorY = plan.level.floorY;
    const gridKeys = roomKeySet(Array.from(dungeonBlockIterator(plan)));
    const occupied = plan.level.rooms.map((room) => ({
      x: room.x, z: room.z, width: room.width, depth: room.depth,
    }));

    let entry = "north";
    let anchorX = plan.frontier.centerX;
    let anchorZ = plan.frontier.z;
    let streamed = [];

    for (let index = 0; index < 6; index += 1) {
      const module = chooseStreamedModule(2000 + index * 31, entry, anchorX, anchorZ, floorY, occupied);
      streamed = streamed.concat(Array.from(endlessRoomBlockIterator(module, 2000 + index * 31)));
      occupied.push({
        x: module.room.x, z: module.room.z, width: module.room.width, depth: module.room.depth,
      });
      if (!module.exit) break;
      entry = { north: "south", south: "north", east: "west", west: "east" }[module.exit];
      anchorX = module.nextAnchorX;
      anchorZ = module.nextAnchorZ;
    }

    const streamedKeys = roomKeySet(streamed);
    assert.equal(streamedKeys.size, streamed.length, "streamed modules stay free of duplicates");
    const overwritten = [...streamedKeys].filter((key) => gridKeys.has(key));
    assert.deepEqual(overwritten, [], "no streamed block overwrites the grid level");
  }
});

test("a streamed module always meets the corridor that leads to it", () => {
  for (const entry of ["north", "south", "east", "west"]) {
    const plan = createStreamedModulePlan(4242, entry, null, 0, 0, -1000, false);
    const blocks = Array.from(endlessRoomBlockIterator(plan));
    const keys = roomKeySet(blocks);
    const centerX = plan.room.x + 3;
    const centerZ = plan.room.z + 3;

    // The door lane of the entry side must be free of walls, and the corridor
    // cell just outside it must be owned by this module (or the previous one).
    const doorCells = [];
    for (let offset = -1; offset <= 1; offset += 1) {
      if (entry === "north") doorCells.push([centerX + offset, plan.room.z]);
      if (entry === "south") doorCells.push([centerX + offset, plan.room.z + 6]);
      if (entry === "east") doorCells.push([plan.room.x + 6, centerZ + offset]);
      if (entry === "west") doorCells.push([plan.room.x, centerZ + offset]);
    }
    for (const [x, z] of doorCells) {
      for (let y = -999; y <= -997; y += 1) {
        assert.equal(keys.has(`${x},${y},${z}`), false, `the door lane ${x},${z} is free at y=${y}`);
      }
    }
  }
});
