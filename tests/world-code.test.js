import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const worldCode = fs.readFileSync(new URL("../world-code/worldCode.js", import.meta.url), "utf8");

function createWorld(onlinePlayerIds) {
  const messages = [];
  const blockRects = [];
  const positions = [];
  const context = {
    api: {
      sendMessage: (playerId, message) => messages.push({ playerId, message }),
      sendTopRightHelper: (playerId, icon, message) => messages.push({ playerId, icon, message }),
      setBlockRect: (from, to, blockName) => blockRects.push({ from, to, blockName }),
      setPosition: (playerId, position) => positions.push({ playerId, position }),
      getPlayerIds: () => onlinePlayerIds,
      now: () => 1710000000000,
      log: (message) => messages.push({ playerId: null, message }),
    },
  };
  vm.runInNewContext(worldCode, context);
  return { context, messages, blockRects, positions };
}

test("the generated World Code builds the dungeon before teleporting the player", () => {
  const { context, messages, blockRects, positions } = createWorld(["player-1"]);

  context.onBlockStandStart("player-1", 2, 10, 3, "Lime Concrete");
  assert.ok(messages.some(({ message }) => message.includes("Very Easy")));

  for (let tick = 0; tick < 199; tick += 1) context.tick();
  assert.equal(blockRects.length, 0);
  assert.equal(positions.length, 0);

  context.tick();
  assert.equal(blockRects[0].blockName, "Stone Bricks", "the floor is laid when the countdown finishes");
  assert.equal(positions.length, 0, "the player waits until all walls are built");

  for (let tick = 0; tick < 20; tick += 1) context.tick();
  assert.ok(blockRects.length > 10, "the maze walls are generated in batches");
  assert.equal(positions.length, 1);
  assert.equal(positions[0].playerId, "player-1");
  assert.ok(messages.some(({ message }) => message.includes("Very Easy maze ready")));
  assert.ok(blockRects.every(({ blockName }) => blockName === "Stone Bricks"));
});

test("leaving the selected pad cancels its countdown", () => {
  const { context, messages, blockRects, positions } = createWorld(["player-2"]);

  context.onBlockStandStart("player-2", 4, 8, 5, "Red Concrete");
  context.onBlockStandStop("player-2", 4, 8, 5, "Red Concrete");
  for (let tick = 0; tick < 220; tick += 1) context.tick();

  assert.ok(messages.some(({ message }) => message.includes("Countdown cancelled")));
  assert.equal(blockRects.length, 0);
  assert.equal(positions.length, 0);
});

test("switching directly between pads keeps the new countdown active", () => {
  const { context, messages, positions } = createWorld(["player-3"]);

  context.onBlockStandStart("player-3", 0, 0, 0, "Lime Concrete");
  context.onBlockStandStart("player-3", 1, 0, 0, "Black Concrete");
  // Bloxd fires the new start before the old pad's stop callback.
  context.onBlockStandStop("player-3", 0, 0, 0, "Lime Concrete");
  for (let tick = 0; tick < 250; tick += 1) context.tick();

  assert.ok(messages.some(({ message }) => message.includes("Hell maze ready")));
  assert.equal(positions.length, 1);
  assert.equal(messages.some(({ message }) => message.includes("Very Easy maze ready")), false);
});
