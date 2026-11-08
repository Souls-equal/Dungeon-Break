import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const worldCode = fs.readFileSync(new URL("../world-code/worldCode.js", import.meta.url), "utf8");

function createWorld(onlinePlayerIds) {
  const messages = [];
  const blockRects = [];
  const positions = [];
  const events = [];
  const playerLocations = {};
  const context = {
    api: {
      sendMessage: (playerId, message) => messages.push({ playerId, message }),
      sendTopRightHelper: (playerId, icon, message) => messages.push({ playerId, icon, message }),
      setBlockRect: (from, to, blockName) => {
        blockRects.push({ from, to, blockName });
        events.push("block");
      },
      setPosition: (playerId, position) => {
        positions.push({ playerId, position });
        playerLocations[playerId] = position;
        events.push("position");
      },
      getPosition: (playerId) => playerLocations[playerId],
      getPlayerIds: () => onlinePlayerIds,
      now: () => 1710000000000,
      log: (message) => messages.push({ playerId: null, message }),
    },
  };
  vm.runInNewContext(worldCode, context);
  return {
    context,
    messages,
    blockRects,
    positions,
    events,
    movePlayer: (playerId, position) => { playerLocations[playerId] = position; },
  };
}

test("the generated World Code builds every floor in batches before teleporting the player", () => {
  const { context, messages, blockRects, positions, events } = createWorld(["player-1"]);

  context.onBlockStandStart("player-1", 2, 10, 3, "Lime Concrete");
  assert.ok(messages.some(({ message }) => message.includes("Very Easy")));

  for (let tick = 0; tick < 199; tick += 1) context.tick();
  assert.equal(blockRects.length, 0);
  assert.equal(positions.length, 0);

  context.tick();
  assert.equal(blockRects.length, 0, "generation is scheduled after the countdown callback");
  assert.equal(positions.length, 0);

  for (let tick = 0; tick < 1000 && positions.length === 0; tick += 1) context.tick();
  assert.ok(blockRects.length > 10, "the dungeon is generated in bounded batches");
  assert.ok(blockRects.some(({ from, to }) => from[1] === -1000 && to[1] === -1000));
  assert.ok(blockRects.some(({ from, to }) => from[1] === -992 && to[1] === -992), "an upper floor is built");
  assert.equal(positions.length, 1);
  assert.equal(positions[0].playerId, "player-1");
  assert.ok(messages.some(({ message }) => message.includes("Very Easy dungeon ready: 2 floors")));
  assert.ok(messages.some(({ message }) => message.includes("Keep advancing to generate more rooms")));
  assert.ok(blockRects.every(({ blockName }) => blockName === "Stone Bricks"));
  assert.equal(events.at(-1), "position", "teleport happens after the initial dungeon build");
});

test("advancing toward the exit streams new rooms without teleporting again", () => {
  const { context, messages, blockRects, positions, movePlayer } = createWorld(["player-4"]);

  context.onBlockStandStart("player-4", 3, 10, 4, "Lime Concrete");
  for (let tick = 0; tick < 1200 && positions.length === 0; tick += 1) context.tick();
  assert.equal(positions.length, 1);

  const initialBlockCount = blockRects.length;
  const currentPosition = positions[0].position;
  movePlayer("player-4", [currentPosition[0], currentPosition[1], currentPosition[2] + 100]);
  for (let tick = 0; tick < 30; tick += 1) context.tick();

  assert.ok(blockRects.length > initialBlockCount, "a new room is added ahead of the player's position");
  assert.equal(positions.length, 1, "streaming rooms does not reset the player's position");
  assert.ok(messages.some(({ message }) => message.includes("Keep advancing to generate more rooms")));
  assert.ok(blockRects.every(({ blockName }) => blockName === "Stone Bricks"));

  context.onPlayerLeave("player-4");
  const finalBlockCount = blockRects.length;
  movePlayer("player-4", [currentPosition[0], currentPosition[1], currentPosition[2] + 1000]);
  for (let tick = 0; tick < 30; tick += 1) context.tick();
  assert.equal(blockRects.length, finalBlockCount, "the player's streaming timer stops when they leave");
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
  for (let tick = 0; tick < 1500 && positions.length === 0; tick += 1) context.tick();

  assert.ok(messages.some(({ message }) => message.includes("Hell dungeon ready: 5 floors")));
  assert.equal(positions.length, 1);
  assert.equal(messages.some(({ message }) => message.includes("Very Easy dungeon ready")), false);
});
