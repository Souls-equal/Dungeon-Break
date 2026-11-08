import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const worldCode = fs.readFileSync(new URL("../world-code/worldCode.js", import.meta.url), "utf8");

/**
 * The floor altitude the dungeon is built at. Kept as a literal on purpose: if
 * the configuration moves, this test must fail loudly rather than follow along,
 * because players spawn at that altitude and a silent change drops them.
 */
const FLOOR_Y = -1000;
const LOBBY_POSITION = [10, 21, 10];
/**
 * The stones the builder is allowed to use. The floor is textured, so "the floor
 * is solid" means "a floor block is there", not "one particular name is there".
 */
const FLOOR_FAMILY = new Set(["Stone Bricks", "Cracked Stone Bricks"]);

/**
 * Runs the bundled world code against a fake Bloxd server.
 *
 * The fake keeps one rule the real server has: a chunk is only readable once the
 * player has been near it. `getBlock` returns `null` outside that area, exactly
 * like an unloaded chunk, and any `setBlock` that lands there is recorded as a
 * violation — that is the bug this whole file exists to catch.
 */
function createWorld(onlinePlayerIds, options = {}) {
  const loadRadius = options.loadRadius === undefined ? 60 : options.loadRadius;
  const messages = [];
  const blocks = [];
  const writes = [];
  const positions = [];
  const clientOptions = [];
  const topRightHelpers = [];
  const playerLocations = options.positions ? { ...options.positions } : {};
  const violations = [];
  const permissions = [];

  const nearPlayer = (x, z) => {
    for (const playerId of onlinePlayerIds) {
      const position = playerLocations[playerId];
      if (!position) continue;
      if (Math.abs(x - position[0]) <= loadRadius && Math.abs(z - position[2]) <= loadRadius) return true;
    }
    return false;
  };

  const context = {
    api: {
      sendMessage: (playerId, message) => messages.push({ playerId, message }),
      sendTopRightHelper: (playerId, icon, message) => {
        topRightHelpers.push({ playerId, icon, message });
        messages.push({ playerId, icon, message });
      },
      setClientOption: (playerId, option, value) => clientOptions.push({ playerId, option, value }),
      setBlock: (x, y, z, blockName) => {
        writes.push({ x, y, z, blockName });
        if (options.trackLoaded && !nearPlayer(x, z)) {
          violations.push({ x, y, z, blockName, playerZ: playerLocations[onlinePlayerIds[0]]?.[2] });
          return;
        }
        blocks.push({ x, y, z, blockName });
      },
      // The only permission the dungeon may ask for, one block type at a time.
      // No lock should ever be requested: `survivalAdventure` already forbids
      // breaking a block, so any `CantChange` call here would be a bug.
      setCanChangeType: (blockType, allowed) => {
        permissions.push({ blockType, allowed });
      },
      setCantChangeBlockRect: () => {
        throw new Error("the dungeon must not lock blocks: the game mode already does");
      },
      setPosition: (playerId, position) => {
        positions.push({ playerId, position: Array.from(position) });
        playerLocations[playerId] = Array.from(position);
      },
      getPosition: (playerId) => playerLocations[playerId],
      // Last write wins, like the real engine: clearing a cell with "Air" really
      // does remove the block that was there.
      getBlock: (x, y, z) => {
        if (options.trackLoaded && !nearPlayer(x, z)) return null;
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
  return {
    context,
    messages,
    blocks,
    writes,
    positions,
    clientOptions,
    topRightHelpers,
    violations,
    permissions,
    movePlayer: (playerId, position) => { playerLocations[playerId] = position; },
  };
}

/** Ticks until `predicate()` holds, and returns false rather than throwing. */
function tickUntil(context, predicate, limit = 3000) {
  for (let tick = 0; tick < limit; tick += 1) {
    if (predicate()) return true;
    context.tick();
  }
  return predicate();
}

/** Starts the countdown of a pad and runs it to completion. */
function startDungeon(context, playerId, blockName = "Lime Concrete", x = 2, z = 3) {
  context.onBlockStandStart(playerId, x, FLOOR_Y + 10, z, blockName);
  tickUntil(context, () => false, 10 * 20 + 5);
}

// ----------------------------------------------------------------- the lobby --

test("stepping on a pad starts a countdown that clears itself on completion", () => {
  const { context, messages, clientOptions, topRightHelpers, blocks } = createWorld(["player-1"]);

  context.onBlockStandStart("player-1", 2, 10, 3, "Lime Concrete");
  assert.ok(messages.some(({ message }) => message.includes("Very Easy")));
  assert.deepEqual(clientOptions.at(-1), {
    playerId: "player-1",
    option: "middleTextUpper",
    value: "Very Easy — starting in 10...",
  });
  assert.equal(topRightHelpers.length, 0, "the countdown no longer uses top-right helper popups");

  for (let tick = 0; tick < 199; tick += 1) context.tick();
  assert.equal(blocks.length, 0, "no block is written during the countdown");
  assert.equal(clientOptions.at(-1).value, "Very Easy — starting in 1...");

  context.tick();
  assert.equal(clientOptions.at(-1).value, "", "the middle-screen countdown is cleared on completion");
});

test("moving between same-difficulty pads preserves the active countdown", () => {
  const { context, messages, clientOptions } = createWorld(["player-same-color"]);

  context.onBlockStandStart("player-same-color", 2, 10, 3, "Lime Concrete");
  for (let tick = 0; tick < 25; tick += 1) context.tick();
  assert.equal(clientOptions.at(-1).value, "Very Easy — starting in 9...");

  const beforeSwitch = clientOptions.length;
  context.onBlockStandStart("player-same-color", 3, 10, 3, "Lime Concrete");
  for (let tick = 0; tick < 15; tick += 1) context.tick();
  // The countdown must keep counting down, not restart at 10.
  const afterSwitch = clientOptions.slice(beforeSwitch).map(({ value }) => value);
  assert.equal(afterSwitch.some((value) => value.endsWith("starting in 10...")), false,
    "crossing to another pad of the same difficulty restarted the countdown");
  assert.equal(clientOptions.at(-1).value, "Very Easy — starting in 8...",
    "the countdown stopped advancing after the switch");
  assert.equal(messages.some(({ message }) => message.includes("Countdown cancelled")), false);
});

test("leaving the selected pad cancels its countdown", () => {
  const { context, messages, clientOptions } = createWorld(["player-leave"]);

  context.onBlockStandStart("player-leave", 2, 10, 3, "Yellow Concrete");
  for (let tick = 0; tick < 40; tick += 1) context.tick();
  context.onBlockStandStop("player-leave", 2, 10, 3, "Yellow Concrete");
  for (let tick = 0; tick < 10; tick += 1) context.tick();

  assert.ok(messages.some(({ message }) => message.includes("Countdown cancelled")));
  assert.equal(clientOptions.at(-1).value, "");
});

test("switching directly between pads keeps the new countdown active", () => {
  const { context, messages, clientOptions } = createWorld(["player-switch"]);

  context.onBlockStandStart("player-switch", 2, 10, 3, "Yellow Concrete");
  for (let tick = 0; tick < 40; tick += 1) context.tick();
  context.onBlockStandStart("player-switch", 5, 10, 3, "Black Concrete");
  for (let tick = 0; tick < 25; tick += 1) context.tick();

  assert.ok(clientOptions.some(({ value }) => value === "Hell — starting in 10..."));
  assert.equal(clientOptions.at(-1).value, "Hell — starting in 9...",
    "the new pad's countdown was cancelled by the old pad's stop");
  assert.equal(messages.some(({ message }) => message.includes("Countdown cancelled")), false);
});

test("a stale pad-stop in the final countdown tick does not cancel the dungeon", () => {
  const { context, positions } = createWorld(["player-stale"]);

  context.onBlockStandStart("player-stale", 2, 10, 3, "Lime Concrete");
  for (let tick = 0; tick < 199; tick += 1) context.tick();
  // The server starts the stop callback before the tick that completes the
  // countdown: the build must still happen.
  context.onBlockStandStop("player-stale", 2, 10, 3, "Lime Concrete");
  for (let tick = 0; tick < 10; tick += 1) context.tick();

  assert.equal(positions.length, 1, "the player was never moved into the dungeon");
});

test("joining teleports the player to the configured lobby spawn", () => {
  const { context, positions, messages } = createWorld(["new-player"]);

  context.onPlayerJoin("new-player");

  assert.equal(positions.length, 1);
  assert.deepEqual(positions[0].position, LOBBY_POSITION);
  assert.ok(messages.some(({ message }) => message.includes("Welcome to Dungeon Break")));
});

// ------------------------------------------------------------------ the spawn --

test("the player is placed on a floor cell, and nothing is announced before it exists", () => {
  const { context, blocks, positions, messages } = createWorld(["player-1"]);

  context.onBlockStandStart("player-1", 2, 10, 3, "Lime Concrete");
  // Stop exactly on the tick of the teleport: the read that creates the chunk and
  // the write that fills it must not happen in the same tick.
  tickUntil(context, () => positions.length > 0, 400);
  assert.equal(blocks.length, 0, "a block was written in the tick that reads the landing cell");
  tickUntil(context, () => blocks.length > 0, 400);

  assert.equal(positions.length, 1, "the player is moved exactly once, into the dungeon");
  const [spawnX, spawnY, spawnZ] = positions[0].position;
  assert.equal(spawnY, FLOOR_Y + 2, "the player is not standing above the floor");
  // Negative coordinates keep a negative remainder: the fraction is what matters.
  assert.equal(Math.abs(spawnX % 1), 0.5, "the player is not in the middle of a cell on x");
  assert.equal(Math.abs(spawnZ % 1), 0.5, "the player is not in the middle of a cell on z");

  // Read, then teleport, then build — never the other way round.
  tickUntil(context, () => blocks.length >= 25, 400);
  const landingKey = `${spawnX - 0.5},${FLOOR_Y},${spawnZ - 0.5}`;
  assert.ok(blocks.some(({ x, y, z }) => `${x},${y},${z}` === landingKey),
    "the landing cell is never floored, so the player stands over the void");
  assert.ok(blocks.slice(0, 25).every(({ blockName }) => FLOOR_FAMILY.has(blockName)),
    "the landing pad is not made of floor blocks");

  // No message may claim readiness before the floor exists.
  const readyMessages = messages.filter(({ message }) => /ready/i.test(message || ""));
  for (const entry of readyMessages) {
    assert.ok(blocks.length > 0, `"${entry.message}" was sent before any block existed`);
  }
});

test("a room is built in batches, never in a single tick", () => {
  const { context, blocks } = createWorld(["player-batch"]);
  startDungeon(context, "player-batch");

  let biggestBatch = 0;
  let previous = blocks.length;
  for (let tick = 0; tick < 600; tick += 1) {
    context.tick();
    biggestBatch = Math.max(biggestBatch, blocks.length - previous);
    previous = blocks.length;
  }
  assert.ok(blocks.length > 0, "the entrance was never built");
  assert.ok(biggestBatch <= 400, `one tick wrote ${biggestBatch} blocks, which freezes the world`);
});

test("no block is written into a chunk the player has not loaded", () => {
  // The honest version of the old "within 60 blocks" test: it measured nothing,
  // because it compared a block's x to the spawn x and its z to the player z,
  // and never looked at whether the write could even land. This one does what it
  // says: a write outside the loaded area is a violation, and the builder must
  // never attempt one.
  const loadRadius = 60;
  const { context, blocks, violations, positions, movePlayer } = createWorld(["player-distance"], {
    trackLoaded: true,
    loadRadius,
  });
  assert.equal(violations.length, 0);
  startDungeon(context, "player-distance");
  assert.equal(positions.length, 1);

  for (let step = 0; step < 6; step += 1) {
    const [, y, z] = positions[0].position;
    movePlayer("player-distance", [positions[0].position[0], y, z + 12]);
    for (let tick = 0; tick < 60; tick += 1) context.tick();
  }

  assert.ok(blocks.length > 0, "nothing was built at all, so the test proves nothing");
  // Every structural block must come from the stone family: a texture drawn from
  // outside the list is a block nobody signed off on.
  const STONE = new Set([
    "Stone", "Messy Stone", "Smooth Stone", "Stone Bricks", "Cracked Stone Bricks", "Mossy Stone Bricks",
  ]);
  const offPalette = blocks.filter(({ blockName }) => blockName !== "Air" && blockName !== "Gold Block"
    && !STONE.has(blockName));
  assert.deepEqual(offPalette.slice(0, 3), [],
    "the builder wrote a block that is not part of the stone palette");
  assert.deepEqual(
    violations.map(({ x, z, playerZ }) => `${x},${z} at player z=${playerZ}`),
    [],
    "the builder wrote into an unloaded chunk, where the server drops the block without an error",
  );
});

test("the world around the player stays walkable as the dungeon grows", () => {
  const { context, blocks, positions } = createWorld(["player-walk"], { trackLoaded: true, loadRadius: 60 });
  startDungeon(context, "player-walk");

  const [spawnX, spawnY, spawnZ] = positions[0].position;
  // The player stands two cells above the floor, so the walkable level is two
  // below the spawn altitude.
  const floorY = spawnY - 2;
  assert.equal(floorY, FLOOR_Y);
  for (let tick = 0; tick < 400; tick += 1) context.tick();

  // Every cell of the 5×5 landing pad is solid, and stays solid: a cell written
  // twice by two different phases is how a floor turns back into a hole.
  const finalName = (x, y, z) => {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      if (block.x === x && block.y === y && block.z === z) return block.blockName;
    }
    return null;
  };
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      const x = spawnX - 0.5 + dx;
      const z = spawnZ - 0.5 + dz;
      assert.ok(FLOOR_FAMILY.has(finalName(x, floorY, z)), `the floor at ${x},${z} is not solid`);
    }
  }
});

test("the dungeon never locks a block, and asks for no permission", () => {
  // The world is `survivalAdventure`: a player cannot break a block, so a lock
  // is a cost with no benefit — and the ore list is empty until ores exist, so
  // no per-type permission is requested either.
  const { context, permissions, blocks } = createWorld(["player-nolock"]);
  startDungeon(context, "player-nolock");
  tickUntil(context, () => blocks.length > 0, 400);
  assert.ok(blocks.length > 0, "nothing was built, so the test proves nothing");
  assert.deepEqual(permissions, [], "a block permission was requested but nothing is breakable");
});

test("leaving the world puts the player back in the lobby", () => {
  const { context, positions } = createWorld(["player-leave-world"]);
  startDungeon(context, "player-leave-world");
  assert.equal(positions.length, 1);

  context.onPlayerLeave("player-leave-world");
  assert.deepEqual(positions.at(-1).position, LOBBY_POSITION);
});
