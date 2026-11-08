import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const worldCode = fs.readFileSync(new URL("../world-code/worldCode.js", import.meta.url), "utf8");

function createWorld() {
  const messages = [];
  const context = {
    api: {
      sendMessage: (playerId, message) => messages.push({ playerId, message }),
      sendTopRightHelper: (playerId, icon, message) => messages.push({ playerId, icon, message }),
      log: (message) => messages.push({ playerId: null, message }),
    },
  };
  vm.runInNewContext(worldCode, context);
  return { context, messages };
}

test("the generated World Code completes a 10-second difficulty countdown", () => {
  const { context, messages } = createWorld();

  context.onBlockStandStart("player-1", 2, 10, 3, "Lime Concrete");
  assert.ok(messages.some(({ message }) => message.includes("Very Easy")));

  for (let tick = 0; tick < 199; tick += 1) context.tick();
  assert.equal(messages.some(({ message }) => message.includes("Dungeon generation")), false);

  context.tick();
  assert.ok(messages.some(({ message }) => message.includes("Very Easy selected! Dungeon generation")));
});

test("leaving the selected pad cancels its countdown", () => {
  const { context, messages } = createWorld();

  context.onBlockStandStart("player-2", 4, 8, 5, "Red Concrete");
  context.onBlockStandStop("player-2", 4, 8, 5, "Red Concrete");
  for (let tick = 0; tick < 220; tick += 1) context.tick();

  assert.ok(messages.some(({ message }) => message.includes("Countdown cancelled")));
  assert.equal(messages.some(({ message }) => message.includes("Dungeon generation")), false);
});

test("switching directly between pads keeps the new countdown active", () => {
  const { context, messages } = createWorld();

  context.onBlockStandStart("player-3", 0, 0, 0, "Lime Concrete");
  context.onBlockStandStart("player-3", 1, 0, 0, "Black Concrete");
  // Bloxd fires the new start before the old pad's stop callback.
  context.onBlockStandStop("player-3", 0, 0, 0, "Lime Concrete");
  for (let tick = 0; tick < 200; tick += 1) context.tick();

  assert.ok(messages.some(({ message }) => message.includes("Hell selected! Dungeon generation")));
  assert.equal(messages.some(({ message }) => message.includes("Very Easy selected! Dungeon generation")), false);
});
