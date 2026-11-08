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
  const world = {};
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
        if (world.shouldDropBlock && world.shouldDropBlock(x, y, z)) return;
        blocks.push({ x, y, z, blockName });
        events.push("block");
      },
      setPosition: (playerId, position) => {
        positions.push({ playerId, position });
        playerLocations[playerId] = position;
        events.push("position");
      },
      getPosition: (playerId) => playerLocations[playerId],
      getBlock: (x, y, z) => blocks.find((b) => b.x === x && b.y === y && b.z === z)?.blockName ?? "Air",
      getPlayerIds: () => onlinePlayerIds,
      now: () => 1710000000000,
      log: (message) => messages.push({ playerId: null, message }),
    },
  };
  vm.runInNewContext(worldCode, context);
  world.shouldDropBlock = null;
  return {
    context,
    world,
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

  const expectedPad = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) expectedPad.push(`${spawnX - 0.5 + dx},${floorY},${spawnZ - 0.5 + dz}`);
  }
  const padKeySet = new Set(expectedPad);
  const padBlocks = blocks.slice(0, 9).map(({ x, y, z }) => `${x},${y},${z}`).sort();
  assert.deepEqual(padBlocks, expectedPad.sort(), "the teleport tile and its neighbours are supported first");
  assert.ok(padBlocks.includes(`${spawnX - 0.5},${floorY},${spawnZ - 0.5}`));
  assert.ok(blocks.slice(0, 9).every(({ blockName }) => blockName === "Stone Bricks"));
  assert.ok(
    events.lastIndexOf("block") > events.lastIndexOf("position") - 2 - 9 * 2,
    "the pad is re-asserted just before the teleport",
  );
  const padWrites = blocks.filter(({ x, y, z }) => padKeySet.has(`${x},${y},${z}`));
  assert.ok(padWrites.length >= 18, "the pad is written again before teleporting, for safety");

  const levelBlocks = blocks.filter(({ x, y, z }) => !padKeySet.has(`${x},${y},${z}`));
  const levelKeys = new Set(levelBlocks.map(({ x, y, z }) => `${x},${y},${z}`));
  assert.equal(levelKeys.size, levelBlocks.length, "the level itself is never written twice");

  const floors = blocks.filter(({ y }) => y === floorY);
  const walls = blocks.filter(({ y }) => y !== floorY);
  const walkableFloors = floors.filter(({ blockName }) => blockName === "Stone Bricks");
  assert.ok(walkableFloors.length >= 8 * 7 * 7, "every room interior is floored with walkable bricks");
  assert.ok(
    floors.every(({ blockName }) => blockName === "Stone Bricks" || WALL_BLOCKS.has(blockName)),
    "the floor layer is either room floor or solid rock",
  );
  assert.ok(
    blocks.slice(0, walls.length ? blocks.indexOf(walls[0]) : blocks.length).every(({ y }) => y === floorY),
    "every room floor is streamed before the first wall",
  );
  assert.ok(walls.every(({ y }) => y > floorY && y <= floorY + 3), "the dungeon has a single storey");
  const wallMaterials = new Set(walls.map(({ blockName }) => blockName));
  assert.ok(wallMaterials.size > 1, "wall blocks are textured individually with randomized materials");
  assert.ok(walls.every(({ blockName }) => WALL_BLOCKS.has(blockName)));

  assert.ok(messages.some(({ message }) => /Very Easy dungeon ready: \d+ rooms \(/.test(message)));
  assert.ok(messages.some(({ message }) => message.includes("four-way") && message.includes("dead ends")));
  assert.ok(messages.some(({ message }) => message.includes("stairs")));
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

test("advancing toward the exit streams new rooms that stay walkable", () => {
  const { context, messages, blocks, positions, movePlayer } = createWorld(["player-8"]);

  context.onBlockStandStart("player-8", 3, 10, 4, "Lime Concrete");
  for (let tick = 0; tick < 4000 && positions.length === 0; tick += 1) context.tick();
  assert.equal(positions.length, 1);

  const spawnPosition = positions[0].position;
  const floorY = spawnPosition[1] - 1;
  const walkable = (levelY) => {
    const floor = new Set();
    const walls = new Set();
    for (const { x, y, z, blockName } of blocks) {
      const key = `${x},${z}`;
      const isFloor = y === levelY;
      if (isFloor && blockName === "Stone Bricks") floor.add(key);
      else if (!isFloor) walls.add(key);
    }
    const reachable = new Set();
    const start = `${Math.floor(spawnPosition[0])},${Math.floor(spawnPosition[2])}`;
    if (!floor.has(start)) return { reachable, deepest: null };
    const stack = [start];
    reachable.add(start);
    let deepest = Number(start.split(",")[1]);
    while (stack.length > 0) {
      const key = stack.pop();
      const [x, z] = key.split(",").map(Number);
      deepest = Math.max(deepest, z);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = `${x + dx},${z + dz}`;
        if (reachable.has(next) || !floor.has(next) || walls.has(next)) continue;
        reachable.add(next);
        stack.push(next);
      }
    }
    return { reachable, deepest };
  };

  const before = walkable(floorY);
  const spawnTile = `${Math.floor(spawnPosition[0])},${Math.floor(spawnPosition[2])}`;
  const floorBricks = blocks.filter(({ y, blockName }) => y === floorY && blockName === "Stone Bricks");
  assert.ok(
    before.reachable.size > 100,
    `the level is walkable from the spawn (reached ${before.reachable.size}, spawn ${spawnTile}, `
      + `floor bricks ${floorBricks.length}, teleport y ${spawnPosition[1]})`,
  );

  const initialBlockCount = blocks.length;
  movePlayer("player-8", [spawnPosition[0], spawnPosition[1], before.deepest + 20]);
  for (let tick = 0; tick < 40 && blocks.length === initialBlockCount; tick += 1) context.tick();
  assert.ok(blocks.length > initialBlockCount, "a new room is added ahead of the player's position");
  assert.equal(positions.length, 1, "streaming rooms does not reset the player's position");

  // Let the buffer fill, then walk the whole route again: the streamed rooms
  // must be reachable from the spawn, without a wall in a doorway.
  for (let tick = 0; tick < 200; tick += 1) context.tick();
  const after = walkable(floorY);
  assert.ok(
    after.deepest > before.deepest,
    `the streamed rooms extend the route further than the static level `
      + `(before ${before.deepest}, after ${after.deepest}, streamed ${blocks.length - initialBlockCount})`,
  );
  assert.ok(after.reachable.size > before.reachable.size, "the new rooms are reachable on foot");
  const streamedFloors = blocks
    .slice(initialBlockCount)
    .filter(({ y, blockName }) => y === floorY && blockName === "Stone Bricks");
  assert.ok(streamedFloors.length > 0, "the streamed rooms bring their own floor");

  assert.ok(messages.some(({ message }) => message.includes("Keep advancing to generate more rooms")));
  assert.ok(blocks.every(({ blockName }) => blockName === "Stone Bricks" || WALL_BLOCKS.has(blockName)));
  assert.ok(blocks.some(({ blockName }) => blockName !== "Stone Bricks"), "streamed walls use stone textures");

  context.onPlayerLeave("player-8");
  const finalBlockCount = blocks.length;
  movePlayer("player-8", [spawnPosition[0], spawnPosition[1], after.deepest + 1000]);
  for (let tick = 0; tick < 40; tick += 1) context.tick();
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

  assert.ok(messages.some(({ message }) => /Hell dungeon ready: \d+ rooms \(/.test(message)));
  assert.equal(positions.length, 1);
  assert.equal(messages.some(({ message }) => message.includes("Very Easy dungeon ready")), false);
});

test("a spawn floor swallowed by an unready chunk is repaired after the teleport", () => {
  const { context, world, blocks, positions, messages } = createWorld(["player-lost-floor"]);

  // Reproduce the reported bug: the engine silently drops writes aimed at a
  // chunk that is not ready, until the player is actually teleported into it.
  let teleported = false;
  world.shouldDropBlock = (x, y, z) => !teleported && y < 0;

  context.onBlockStandStart("player-lost-floor", 1, 10, 1, "Lime Concrete");
  for (let tick = 0; tick < 1500 && positions.length === 0; tick += 1) context.tick();
  assert.equal(positions.length, 1);
  assert.equal(blocks.length, 0, "the simulated chunk swallowed every write of the build");

  teleported = true;
  const [spawnX, spawnY, spawnZ] = positions[0].position;

  // The guard must notice the hole and fill it, without a second teleport.
  for (let tick = 0; tick < 60; tick += 1) context.tick();

  const padBlocks = new Set(
    blocks
      .filter(({ x, y, z }) => y === spawnY - 1 && Math.abs(x - (spawnX - 0.5)) <= 1 && Math.abs(z - (spawnZ - 0.5)) <= 1)
      .map(({ x, z }) => `${x},${z}`),
  );
  assert.equal(padBlocks.size, 9, "the whole 3x3 pad is restored under the player");
  assert.equal(positions.length, 1, "the repair never teleports the player again");
  assert.ok(!messages.some(({ message }) => message.includes("generation failed")));
});
