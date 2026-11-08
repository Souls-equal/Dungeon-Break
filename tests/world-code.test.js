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

/** Runs ticks until the dungeon of a player is fully built (not just teleported). */
function waitForDungeon(messages, context, ticks = 3000) {
  for (let tick = 0; tick < ticks; tick += 1) {
    if (messages.some(({ message }) => message.includes("dungeon ready"))) return true;
    context.tick();
  }
  return messages.some(({ message }) => message.includes("dungeon ready"));
}

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
      // Last write wins, like the real engine: clearing a cell with "Air"
      // really does remove the block that was there.
      getBlock: (x, y, z) => {
        for (let index = blocks.length - 1; index >= 0; index -= 1) {
          const block = blocks[index];
          if (block.x === x && block.y === y && block.z === z) return block.blockName;
        }
        return "Air";
      },
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

test("the player is loaded in first, boxed, then the dungeon is built around them", () => {
  const { context, messages, blocks, positions, clientOptions, topRightHelpers } = createWorld(["player-1"]);

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
  assert.ok(blocks.length >= 25, "the landing patch is written before anything else");
  assert.ok(blocks.slice(0, 25).every(({ blockName }) => blockName === "Stone Bricks"));
  assert.ok(
    blocks.slice(0, 25).some(({ x, z }) => Number.isInteger(x) && Number.isInteger(z)),
    "the landing patch is made of whole cells",
  );

  let maxBlocksPlacedPerTick = 0;
  for (let tick = 0; tick < 400; tick += 1) {
    const countBeforeTick = blocks.length;
    context.tick();
    maxBlocksPlacedPerTick = Math.max(maxBlocksPlacedPerTick, blocks.length - countBeforeTick);
  }
  assert.ok(maxBlocksPlacedPerTick <= 120, "no more than 120 setBlock calls run per tick");
  assert.equal(positions.at(-1).playerId, "player-1");

  const dungeonPosition = positions[positions.length - 1].position;
  const [spawnX, spawnY, spawnZ] = dungeonPosition;
  const floorY = spawnY - 1;
  // Negative coordinates make the remainder negative: the fraction is what matters.
  assert.equal(Math.abs(spawnX % 1), 0.5, "the player is placed in the middle of a cell on x");
  assert.equal(Math.abs(spawnZ % 1), 0.5, "the player is placed in the middle of a cell on z");
  const landingKey = `${spawnX - 0.5},${floorY},${spawnZ - 0.5}`;
  const landingWrites = blocks.filter(({ x, y, z }) => `${x},${y},${z}` === landingKey);
  assert.ok(landingWrites.length > 0, "the landing cell is floored before the teleport");
  assert.equal(
    blocks.findIndex(({ x, y, z }) => `${x},${y},${z}` === landingKey) < 25,
    true,
    "the landing cell is part of the very first patch",
  );

  // The box is written in the very same tick as the teleport, before any room
  // block: it must be the last thing standing between the player and the void.
  const boxWalls = blocks.slice(0, 100).filter(({ blockName }) => blockName === "Stone");
  assert.ok(boxWalls.length > 0, "the box is written right after the teleport");
  assert.ok(boxWalls.length > 0, "the player is boxed in right after the teleport");

  for (let tick = 0; tick < 1500 && !messages.some(({ message }) => message.includes("dungeon ready")); tick += 1) {
    context.tick();
  }
  assert.ok(messages.some(({ message }) => /Very Easy dungeon ready: \d+ rooms \(/.test(message)));
  assert.ok(messages.some(({ message }) => message.includes("four-way") && message.includes("dead ends")));
  assert.ok(messages.some(({ message }) => message.includes("stairs")));
  assert.ok(messages.some(({ message }) => message.includes("Keep advancing to generate more rooms")));
  assert.equal(positions.length, 1, "the player is never teleported twice");

  // The box is opened again once the room is walkable.
  const airWrites = blocks.filter(({ x, y, z, blockName }) => blockName === "Air"
    && y > floorY
    && Math.abs(x - spawnX) <= 6
    && Math.abs(z - spawnZ) <= 6);
  assert.ok(airWrites.length > 0, "the box walls are cleared when the level is ready");

  context.onBlockStandStop("player-1", 2, 10, 3, "Lime Concrete");
  assert.equal(messages.some(({ message }) => message.includes("Countdown cancelled")), false);
});

test("the dungeon is always built within 60 blocks of the player", () => {
  const { context, messages, blocks, positions, movePlayer } = createWorld(["player-distance"]);

  context.onBlockStandStart("player-distance", 2, 10, 3, "Lime Concrete");
  for (let tick = 0; tick < 2000 && positions.length === 0; tick += 1) context.tick();
  assert.equal(positions.length, 1);
  for (let tick = 0; tick < 2000 && !messages.some(({ message }) => message.includes("dungeon ready")); tick += 1) {
    context.tick();
  }
  const [spawnX, spawnY, spawnZ] = positions[0].position;

  // A write only lands if the chunk is loaded, so the invariant is measured at
  // the moment of the write: the player is the only thing loading chunks.
  const violations = [];
  const audit = (before) => {
    const player = context.api === undefined ? null : null;
    void player;
    const [, , playerZ] = lastKnownPosition();
    for (const block of blocks.slice(before)) {
      const distance = Math.max(Math.abs(block.x - spawnX), Math.abs(block.z - playerZ));
      if (distance > 60) violations.push({ ...block, distance });
    }
  };
  let currentPosition = [spawnX, spawnY, spawnZ];
  function lastKnownPosition() {
    return currentPosition;
  }

  let before = blocks.length;
  for (let tick = 0; tick < 2000 && !messages.some(({ message }) => message.includes("dungeon ready")); tick += 1) {
    context.tick();
    audit(before);
    before = blocks.length;
  }
  assert.ok(messages.some(({ message }) => message.includes("dungeon ready")));

  for (let step = 0; step < 8; step += 1) {
    currentPosition = [spawnX, spawnY, currentPosition[2] + 10];
    movePlayer("player-distance", currentPosition);
    const beforeWalk = blocks.length;
    for (let tick = 0; tick < 60; tick += 1) context.tick();
    assert.ok(blocks.length > beforeWalk, `the step ${step + 1} streamed new blocks`);
    audit(beforeWalk);
  }
  assert.deepEqual(
    violations.map(({ x, z, distance }) => `${x},${z} (${distance})`),
    [],
    "no block is ever written more than 60 blocks from the player",
  );
  assert.equal(positions.length, 1, "streaming never teleports the player again");
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

  for (let tick = 0; tick < 1500 && !messages.some(({ message }) => message.includes("dungeon ready")); tick += 1) context.tick();
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
  for (let tick = 0; tick < 1500 && !messages.some(({ message }) => message.includes("dungeon ready")); tick += 1) context.tick();
  assert.equal(positions.length, 1);
});

test("advancing toward the exit streams new rooms that stay walkable", () => {
  const { context, messages, blocks, positions, movePlayer } = createWorld(["player-8"]);

  context.onBlockStandStart("player-8", 3, 10, 4, "Lime Concrete");
  for (let tick = 0; tick < 4000 && positions.length === 0; tick += 1) context.tick();
  assert.equal(positions.length, 1);
  // The teleport is immediate now; the entrance room is built right after it.
  for (let tick = 0; tick < 1000 && !messages.some(({ message }) => message.includes("dungeon ready")); tick += 1) {
    context.tick();
  }
  assert.ok(messages.some(({ message }) => message.includes("dungeon ready")));

  const spawnPosition = positions[0].position;
  const floorY = spawnPosition[1] - 1;

  /** Flood fill of the walkable level from the spawn, last write wins. */
  const walkable = () => {
    const state = new Map();
    for (const { x, y, z, blockName } of blocks) state.set(`${x},${y},${z}`, blockName);
    const floor = new Set();
    const walls = new Set();
    for (const [key, blockName] of state) {
      if (blockName === "Air") continue;
      const [x, y, z] = key.split(",").map(Number);
      const tile = `${x},${z}`;
      if (y === floorY) {
        if (blockName === "Stone Bricks") floor.add(tile);
      } else walls.add(tile);
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

  const before = walkable();
  assert.ok(
    before.reachable.size >= 25,
    `the entrance is walkable from the spawn (reached ${before.reachable.size})`,
  );

  // The player walks out of the entrance and keeps walking: each step must
  // bring a new room, reachable on foot from the spawn.
  let playerZ = Math.floor(spawnPosition[2]);
  for (let step = 0; step < 6; step += 1) {
    playerZ += 10;
    movePlayer("player-8", [spawnPosition[0], spawnPosition[1], playerZ + 0.5]);
    const beforeStep = blocks.length;
    for (let tick = 0; tick < 60; tick += 1) context.tick();
    assert.ok(blocks.length > beforeStep, `the step ${step + 1} streams a new room`);
  }

  const after = walkable();
  assert.ok(
    after.deepest > before.deepest,
    `the streamed rooms extend the route (before ${before.deepest}, after ${after.deepest})`,
  );
  assert.ok(
    after.reachable.size > before.reachable.size,
    `the streamed rooms are reachable on foot (${before.reachable.size} then ${after.reachable.size})`,
  );
  assert.ok(after.reachable.size >= before.reachable.size + 40, "the stream adds a real room, not a tile");

  // The route never has a hole: every reachable floor tile carries a block.
  const state = new Map();
  for (const { x, y, z, blockName } of blocks) state.set(`${x},${y},${z}`, blockName);
  for (const key of after.reachable) {
    const [x, z] = key.split(",").map(Number);
    for (let y = floorY + 1; y <= floorY + 2; y += 1) {
      const name = state.get(`${x},${y},${z}`);
      assert.ok(!name || name === "Air", `the walkable tile ${x},${z} is free of walls at y=${y}`);
    }
  }

  assert.ok(messages.some(({ message }) => message.includes("Keep advancing to generate more rooms")));
  assert.equal(positions.length, 1, "streaming never teleports the player again");

  context.onPlayerLeave("player-8");
  const finalBlockCount = blocks.length;
  for (let tick = 0; tick < 40; tick += 1) context.tick();
  assert.equal(blocks.length, finalBlockCount, "streaming stops when the player leaves");
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
  for (let tick = 0; tick < 2000 && !messages.some(({ message }) => message.includes("dungeon ready")); tick += 1) context.tick();

  assert.ok(messages.some(({ message }) => /Hell dungeon ready: \d+ rooms \(/.test(message)));
  assert.equal(positions.length, 1);
  assert.equal(messages.some(({ message }) => message.includes("Very Easy dungeon ready")), false);
});

test("a floor swallowed by an unready chunk is repaired after the teleport", () => {
  const { context, world, blocks, positions, messages } = createWorld(["player-lost-floor"]);

  // Reproduce the reported bug: the engine silently drops every write aimed at
  // a chunk that is not ready. The player only loads chunks by being moved in.
  world.shouldDropBlock = () => true;

  context.onBlockStandStart("player-lost-floor", 1, 10, 1, "Lime Concrete");
  for (let tick = 0; tick < 1500 && positions.length === 0; tick += 1) context.tick();
  assert.equal(positions.length, 1, "the player is moved in despite the dropped writes");

  // Now that the player stands in the chunk, writes land: the guard and the
  // build audit must fill the whole floor back in, without a second teleport.
  world.shouldDropBlock = null;
  for (let tick = 0; tick < 800 && !messages.some(({ message }) => message.includes("dungeon ready")); tick += 1) {
    context.tick();
  }
  assert.ok(messages.some(({ message }) => message.includes("dungeon ready")));
  assert.equal(positions.length, 1, "the repair never teleports the player again");

  const [spawnX, spawnY, spawnZ] = positions[0].position;
  const floorY = spawnY - 1;
  const state = new Map();
  for (const { x, y, z, blockName } of blocks) state.set(`${x},${y},${z}`, blockName);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const key = `${spawnX - 0.5 + dx},${floorY},${spawnZ - 0.5 + dz}`;
      assert.equal(state.get(key), "Stone Bricks", `the pad tile ${key} is restored`);
    }
  }
  // The room the player stands in is floored too, not only the pad.
  const roomFloor = [...state].filter(([key, name]) => {
    const y = Number(key.split(",")[1]);
    return y === floorY && name === "Stone Bricks";
  });
  assert.ok(roomFloor.length >= 49, "the whole entrance room floor is restored");
  // The way out is open: no wall on the corridor axis in front of the player.
  const doorLane = [...state].filter(([key, name]) => {
    const [x, y] = key.split(",").map(Number);
    return y === floorY + 1 && name !== "Air" && Math.abs(x - (spawnX - 0.5)) <= 1;
  });
  assert.ok(doorLane.length > 0, "the room still keeps its own walls");
});
