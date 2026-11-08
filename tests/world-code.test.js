import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const worldCode = fs.readFileSync(new URL("../world-code/worldCode.js", import.meta.url), "utf8");
const WALL_BLOCKS = new Set([
  "Stone",
  "Messy Stone",
  "Smooth Stone",
  "Stone Bricks",
  "Cracked Stone Bricks",
  "Mossy Stone Bricks",
]);

function createWorld(onlinePlayerIds) {
  const messages = [];
  const blocks = [];
  const positions = [];
  const clientOptions = [];
  const topRightHelpers = [];
  const events = [];
  const playerLocations = {};
  const context = {
    api: {
      sendMessage: (playerId, message) => messages.push({ playerId, message }),
      sendTopRightHelper: (playerId, icon, message) => {
        topRightHelpers.push({ playerId, icon, message });
        messages.push({ playerId, icon, message });
      },
      setClientOption: (playerId, option, value) => clientOptions.push({ playerId, option, value }),
      setBlock: (x, y, z, blockName) => {
        blocks.push({ x, y, z, blockName });
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
    blocks,
    positions,
    clientOptions,
    topRightHelpers,
    events,
    movePlayer: (playerId, position) => { playerLocations[playerId] = position; },
  };
}

test("the World Code floors the spawn pad first, then streams floors before walls", () => {
  const { context, messages, blocks, positions, clientOptions, topRightHelpers, events } = createWorld(["player-1"]);

  context.onBlockStandStart("player-1", 2, 10, 3, "Lime Concrete");
  assert.ok(messages.some(({ message }) => message.includes("Very Easy")));
  assert.deepEqual(clientOptions.at(-1), {
    playerId: "player-1",
    option: "middleTextUpper",
    value: "Very Easy — starting in 10...",
  });
  assert.equal(topRightHelpers.length, 0, "the countdown no longer uses top-right helper popups");

  for (let tick = 0; tick < 199; tick += 1) context.tick();
  assert.equal(blocks.length, 0);
  assert.equal(positions.length, 0);
  assert.equal(clientOptions.at(-1).value, "Very Easy — starting in 1...");

  context.tick();
  assert.equal(clientOptions.at(-1).value, "", "the middle-screen countdown is cleared on completion");
  assert.equal(blocks.length, 9, "the 3x3 safety pad is placed immediately in the countdown callback");
  assert.equal(positions.length, 0, "the player is never teleported onto an unfinished dungeon");

  let maxBlocksPlacedPerTick = 0;
  for (let tick = 0; tick < 1500 && positions.length === 0; tick += 1) {
    const countBeforeTick = blocks.length;
    context.tick();
    maxBlocksPlacedPerTick = Math.max(maxBlocksPlacedPerTick, blocks.length - countBeforeTick);
  }
  assert.ok(blocks.length > 800, "the dungeon is placed one block at a time in batches");
  assert.ok(maxBlocksPlacedPerTick <= 120, "no more than 120 setBlock calls run per tick");
  assert.equal(positions.length, 1);
  assert.equal(positions[0].playerId, "player-1");

  const [spawnX, spawnY, spawnZ] = positions[0].position;
  const floorY = spawnY - 1;
  const keys = new Set(blocks.map(({ x, y, z }) => `${x},${y},${z}`));
  assert.equal(keys.size, blocks.length, "no block is placed twice");

  const padBlocks = blocks.slice(0, 9).map(({ x, y, z }) => `${x},${y},${z}`).sort();
  const expectedPad = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) expectedPad.push(`${spawnX - 0.5 + dx},${floorY},${spawnZ - 0.5 + dz}`);
  }
  assert.deepEqual(padBlocks, expectedPad.sort(), "the teleport tile and its neighbours are supported first");
  assert.ok(padBlocks.includes(`${spawnX - 0.5},${floorY},${spawnZ - 0.5}`));
  assert.ok(blocks.slice(0, 9).every(({ blockName }) => blockName === "Stone Bricks"));

  const floors = blocks.filter(({ y }) => y === floorY);
  const walls = blocks.filter(({ y }) => y !== floorY);
  assert.ok(floors.every(({ blockName }) => blockName === "Stone Bricks"));
  assert.ok(floors.length >= 16 * 25, "every 5x5 room interior is floored");
  assert.ok(
    blocks.slice(0, floors.length).every(({ y }) => y === floorY),
    "every room floor is streamed before the first wall",
  );
  assert.ok(walls.every(({ y }) => y > floorY && y <= floorY + 3), "the dungeon has a single storey");
  const wallMaterials = new Set(walls.map(({ blockName }) => blockName));
  assert.ok(wallMaterials.size > 1, "wall blocks are textured individually with randomized materials");
  assert.ok(walls.every(({ blockName }) => WALL_BLOCKS.has(blockName)));

  assert.ok(messages.some(({ message }) => message.includes("Very Easy dungeon ready: 16 connected rooms")));
  assert.ok(messages.some(({ message }) => message.includes("Keep advancing to generate more rooms")));
  context.onBlockStandStop("player-1", 2, 10, 3, "Lime Concrete");
  assert.equal(messages.some(({ message }) => message.includes("Countdown cancelled")), false);
  assert.equal(events.at(-1), "position", "teleport happens after all blocks are placed");
});

test("joining teleports the player to the configured lobby spawn", () => {
  const { context, positions, messages } = createWorld(["new-player"]);

  context.onPlayerJoin("new-player");

  assert.equal(positions.length, 1);
  assert.deepEqual(Array.from(positions[0].position), [10, 21, 10]);
  assert.ok(messages.some(({ message }) => message.includes("Welcome to Dungeon Break")));
});

test("moving between same-difficulty Concrete pads preserves the active countdown", () => {
  const { context, messages, clientOptions, positions } = createWorld(["player-same-color"]);

  context.onBlockStandStart("player-same-color", 0, 0, 0, "Lime Concrete");
  for (let tick = 0; tick < 40; tick += 1) context.tick();
  assert.equal(clientOptions.at(-1).value, "Very Easy — starting in 8...");

  context.onBlockStandStop("player-same-color", 0, 0, 0, "Lime Concrete");
  context.tick();
  context.onBlockStandStart("player-same-color", 1, 0, 0, "Lime Concrete");
  assert.equal(messages.some(({ message }) => message.includes("Countdown cancelled")), false);
  assert.equal(clientOptions.at(-1).value, "Very Easy — starting in 8...", "switching pads does not reset the timer");

  for (let tick = 0; tick < 160; tick += 1) context.tick();
  assert.ok(messages.some(({ message }) => message.includes("Building a Very Easy single-level dungeon")));
  assert.equal(messages.some(({ message }) => message.includes("Countdown cancelled")), false);

  for (let tick = 0; tick < 1500 && positions.length === 0; tick += 1) context.tick();
  assert.equal(positions.length, 1, "the original countdown completes successfully");
});

test("a stale pad-stop in the final countdown tick does not cancel dungeon generation", () => {
  const { context, messages, positions } = createWorld(["player-final-second"]);

  context.onBlockStandStart("player-final-second", 5, 10, 5, "Lime Concrete");
  for (let tick = 0; tick < 198; tick += 1) context.tick();
  context.onBlockStandStop("player-final-second", 5, 10, 5, "Lime Concrete");
  context.tick();
  context.tick();

  assert.ok(messages.some(({ message }) => message.includes("Building a Very Easy single-level dungeon")));
  assert.equal(messages.some(({ message }) => message.includes("Countdown cancelled")), false);
  for (let tick = 0; tick < 1500 && positions.length === 0; tick += 1) context.tick();
  assert.equal(positions.length, 1);
});

test("advancing toward the exit streams new rooms without teleporting again", () => {
  const { context, messages, blocks, positions, movePlayer } = createWorld(["player-4"]);

  context.onBlockStandStart("player-4", 3, 10, 4, "Lime Concrete");
  for (let tick = 0; tick < 1500 && positions.length === 0; tick += 1) context.tick();
  assert.equal(positions.length, 1);

  const initialBlockCount = blocks.length;
  const currentPosition = positions[0].position;
  const floorY = currentPosition[1] - 1;
  const initialFloors = blocks.filter(({ y }) => y === floorY);
  const corridorZ = Math.max(...initialFloors.map(({ z }) => z));
  const corridorX = initialFloors.filter(({ z }) => z === corridorZ).map(({ x }) => x).sort((a, b) => a - b);
  assert.deepEqual(corridorX, [corridorX[0], corridorX[0] + 1, corridorX[0] + 2], "the corridor is 3 wide");
  const centerX = corridorX[1];
  const gridWallsAtCorridor = blocks.filter(({ y, z }) => y === floorY + 1 && z === corridorZ - 1);
  assert.equal(gridWallsAtCorridor.length > 0, true, "the grid exit room is walled");
  assert.ok(
    !gridWallsAtCorridor.some(({ x }) => Math.abs(x - centerX) <= 1),
    "the exit room opens a door onto the corridor",
  );
  assert.ok(
    [centerX - 1, centerX, centerX + 1].every((x) => initialFloors.some(
      (floor) => floor.x === x && floor.z === corridorZ,
    )),
    "the grid exit already owns its 3-wide corridor",
  );

  movePlayer("player-4", [currentPosition[0], currentPosition[1], corridorZ + 40]);
  for (let tick = 0; tick < 30 && blocks.length === initialBlockCount; tick += 1) context.tick();
  assert.ok(blocks.length > initialBlockCount, "a new room is added ahead of the player's position");
  assert.equal(positions.length, 1, "streaming rooms does not reset the player's position");

  const streamed = blocks.slice(initialBlockCount);
  const streamedFloors = streamed.filter(({ y }) => y === floorY);
  const streamedMinZ = Math.min(...streamedFloors.map(({ z }) => z));
  assert.equal(streamedMinZ, corridorZ + 1, "the streamed room starts right behind the shared door");
  for (let offset = -1; offset <= 1; offset += 1) {
    assert.ok(
      streamedFloors.some(({ x, z }) => x === centerX + offset && z === streamedMinZ),
      "the new room opens a 3-wide door facing the previous room",
    );
    assert.ok(
      !streamed.some(({ x, y, z }) => x === centerX + offset && y === floorY + 1 && z === streamedMinZ),
      "the door lane is left free of walls",
    );
  }
  assert.ok(messages.some(({ message }) => message.includes("Keep advancing to generate more rooms")));
  assert.ok(blocks.every(({ blockName }) => blockName === "Stone Bricks" || WALL_BLOCKS.has(blockName)));
  assert.ok(blocks.some(({ blockName }) => blockName !== "Stone Bricks"), "streamed room walls use per-block stone textures");

  context.onPlayerLeave("player-4");
  const finalBlockCount = blocks.length;
  movePlayer("player-4", [currentPosition[0], currentPosition[1], currentPosition[2] + 1000]);
  for (let tick = 0; tick < 30; tick += 1) context.tick();
  assert.equal(blocks.length, finalBlockCount, "the player's streaming timer stops when they leave");
});

test("leaving the selected pad cancels its countdown", () => {
  const { context, messages, blocks, positions, clientOptions } = createWorld(["player-2"]);

  context.onBlockStandStart("player-2", 4, 8, 5, "Red Concrete");
  context.onBlockStandStop("player-2", 4, 8, 5, "Red Concrete");
  for (let tick = 0; tick < 220; tick += 1) context.tick();

  assert.ok(messages.some(({ message }) => message.includes("Countdown cancelled")));
  assert.equal(clientOptions.at(-1).value, "", "cancellation clears the middle-screen text");
  assert.equal(blocks.length, 0);
  assert.equal(positions.length, 0);
});

test("switching directly between pads keeps the new countdown active", () => {
  const { context, messages, positions, clientOptions } = createWorld(["player-3"]);

  context.onBlockStandStart("player-3", 0, 0, 0, "Lime Concrete");
  context.onBlockStandStart("player-3", 1, 0, 0, "Black Concrete");
  // Bloxd fires the new start before the old pad's stop callback.
  context.onBlockStandStop("player-3", 0, 0, 0, "Lime Concrete");
  assert.equal(clientOptions.at(-1).value, "Hell — starting in 10...");
  for (let tick = 0; tick < 2000 && positions.length === 0; tick += 1) context.tick();

  assert.ok(messages.some(({ message }) => message.includes("Hell dungeon ready: 121 connected rooms")));
  assert.equal(positions.length, 1);
  assert.equal(messages.some(({ message }) => message.includes("Very Easy dungeon ready")), false);
});
