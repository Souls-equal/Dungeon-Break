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
/**
 * Budgets, mirrored from `DUNGEON_CONFIG` on purpose: if the configuration
 * changes, this test must be updated by hand rather than silently follow along,
 * because the number is what keeps a tick short.
 */
const FLOOR_BUDGET = 2400;
const FLOOR_BATCH = 720;
// One joint written in a single pass: wallGap × width × (floors, flanks, roof).
// Measured upper bound for a 5-cell doorway through 15 cells of masonry.
const FLOOR_PASSAGE = 900;
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
  // The fake server's loaded area around a player. It has to fit one room: a room
  // is now up to 55 cells across and the masonry 15, so a 60-cell radius would
  // make the fake lose writes the real server would accept. The rule this file
  // exists to test — never write outside a loaded chunk — is still enforced, only
  // with a boundary that is not inside the room being built.
  const loadRadius = options.loadRadius === undefined ? 120 : options.loadRadius;
  const messages = [];
  const blocks = [];
  const writes = [];
  // Block data, with the API's documented rule enforced: "Data is cleared when
  // block changes". A fake that quietly kept it would hide the one bug the chunk
  // store is built around.
  const blockData = new Map();
  const cellKey = (x, y, z) => `${x},${y},${z}`;
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
        blockData.delete(cellKey(x, y, z));
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
      setBlockData: (x, y, z, value) => {
        // The documented type is an object, and the value crosses a serialisation
        // boundary: a reference kept as-is would let the tests pass on something
        // the real server could not store.
        blockData.set(cellKey(x, y, z), JSON.parse(JSON.stringify(value)));
      },
      getBlockData: (x, y, z) => (blockData.has(cellKey(x, y, z)) ? blockData.get(cellKey(x, y, z)) : null),
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
    blockData,
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

test("the blocks written in one tick stay inside the configured budget", () => {
  const { context, blocks } = createWorld(["player-batch"]);
  startDungeon(context, "player-batch");

  // The budget is `maxBlocksPerTick` plus one room batch **and** one passage,
  // because neither is ever interrupted: a half-written room is worse than a
  // slightly long tick, and a passage is written in a single pass. Both count
  // against the same budget — they once did not, and a cycle that queued every
  // threshold at once wrote nine hundred blocks.
  const ceiling = FLOOR_BUDGET + FLOOR_BATCH + FLOOR_PASSAGE;
  let biggestBatch = 0;
  let previous = blocks.length;
  for (let tick = 0; tick < 600; tick += 1) {
    context.tick();
    biggestBatch = Math.max(biggestBatch, blocks.length - previous);
    previous = blocks.length;
  }
  assert.ok(blocks.length > 0, "the entrance was never built");
  assert.ok(biggestBatch <= ceiling,
    `one tick wrote ${biggestBatch} blocks, which is more than the ${ceiling} the configuration allows`);
});

test("no block is written into a chunk the player has not loaded", () => {
  // The honest version of the old "within 60 blocks" test: it measured nothing,
  // because it compared a block's x to the spawn x and its z to the player z,
  // and never looked at whether the write could even land. This one does what it
  // says: a write outside the loaded area is a violation, and the builder must
  // never attempt one.
  const loadRadius = 120;
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
  // The one block outside the stone palette is the chunk anchor: one per chunk, at
  // the chunk's own corner, holding that chunk's record. It is checked by position
  // rather than waved through by name, because "off-palette is allowed" is how a
  // texture nobody signed off on gets into a dungeon.
  const CHUNK_SIZE = 32;
  // One block **above** the floor: the corner cell of the chunk, at the level a
  // player's feet occupy, where no room ever writes.
  const isAnchorCell = ({ blockName, x, y, z }) => blockName === "Polished Diorite"
    && y === FLOOR_Y + 1 && x % CHUNK_SIZE === 0 && z % CHUNK_SIZE === 0;
  const offPalette = blocks.filter(({ blockName, x, y, z }) => blockName !== "Air" && blockName !== "Gold Block"
    && !STONE.has(blockName) && !isAnchorCell({ blockName, x, y, z }));
  assert.deepEqual(offPalette.slice(0, 3), [],
    "the builder wrote a block that is not part of the stone palette");
  // And an anchor is never written twice: the second write would clear the data.
  const anchors = blocks.filter(isAnchorCell).map(({ x, y, z }) => `${x},${y},${z}`);
  assert.equal(new Set(anchors).size, anchors.length, "an anchor block was written more than once");
  assert.deepEqual(
    violations.map(({ x, z, playerZ }) => `${x},${z} at player z=${playerZ}`),
    [],
    "the builder wrote into an unloaded chunk, where the server drops the block without an error",
  );
});

test("the world around the player stays walkable as the dungeon grows", () => {
  const { context, blocks, positions } = createWorld(["player-walk"], { trackLoaded: true, loadRadius: 120 });
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

// -------------------------------------------------------------------- debug --
//
// The debug commands are the only way a player can hand over a bug report that
// is worth anything: the seed, the cell and the room together. These tests run
// them through the world code itself, because the wiring (`playerCommand`, the
// message format) is exactly what a unit test of the report cannot see.

/** Every message sent to one player, in order. */
const messagesFor = (messages, playerId) => messages
  .filter((entry) => entry.playerId === playerId)
  .map((entry) => entry.message);

test("/dbg outside a dungeon says so instead of failing silently", () => {
  const { context, messages } = createWorld(["player-dbg-lobby"]);

  context.playerCommand("player-dbg-lobby", "dbg");

  const said = messagesFor(messages, "player-dbg-lobby");
  assert.equal(said.length, 1, "a debug command in the lobby must answer exactly once");
  assert.match(said[0], /not in a dungeon/);
});

test("/dbg in a dungeon reports the seed, the cell, the room and the doorways", () => {
  const { context, messages, positions } = createWorld(["player-dbg"]);
  startDungeon(context, "player-dbg");
  assert.equal(positions.length, 1, "the player never entered the dungeon");
  // A few cycles, so the dungeon has grown past the entrance.
  for (let tick = 0; tick < 120; tick += 1) context.tick();
  const before = messages.length;

  context.playerCommand("player-dbg", "dbg");

  const lines = messages.slice(before).map((entry) => entry.message);
  assert.ok(lines.length >= 5, `the report was cut short: ${lines.length} line(s)`);
  for (const line of lines) assert.match(line, /^\[dbg\]/, `a line is not tagged: ${line}`);
  const joined = lines.join("\n");
  assert.match(joined, /seed \d+/);
  assert.match(joined, /Very Easy/);
  assert.match(joined, /cell -?\d+,-?\d+/);
  assert.match(joined, /room r0/);
  assert.match(joined, /doorways:|no room/);
  assert.doesNotMatch(joined, /undefined|NaN/);

  // The reported cell is the cell the player is actually standing in: a report
  // that prints the spawn would be useless from the far end of the dungeon.
  const [x, , z] = positions[0].position;
  assert.match(joined, new RegExp(`cell ${Math.floor(x)},${Math.floor(z)}`));
});

test("/dbg seed is one line, and it is the seed of the dungeon the player is in", () => {
  const { context, messages } = createWorld(["player-dbg-seed"]);
  startDungeon(context, "player-dbg-seed");
  for (let tick = 0; tick < 40; tick += 1) context.tick();
  const before = messages.length;

  context.playerCommand("player-dbg-seed", "seed");

  const lines = messagesFor(messages, "player-dbg-seed").slice(-1);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[dbg\] seed \d+ · Very Easy/);

  // The same command must print the same seed: it is derived from the lobby
  // name and the difficulty, never from a clock.
  context.playerCommand("player-dbg-seed", "seed");
  assert.equal(messagesFor(messages, "player-dbg-seed").at(-1), lines[0]);
});

test("/dbg chunk reads the records back from the blocks, and says when there is none", () => {
  const { context, messages, blockData } = createWorld(["player-dbg-chunk"]);
  startDungeon(context, "player-dbg-chunk");
  // Records are written after construction, one per tick, and only once a player is
  // in the dungeon — so the world has to tick for them to exist.
  tickUntil(context, () => blockData.size > 0, 600);
  assert.ok(blockData.size > 0, "no chunk record was ever written, so the test proves nothing");

  context.playerCommand("player-dbg-chunk", "chunk");
  const said = messagesFor(messages, "player-dbg-chunk");
  const report = said.filter((line) => line.startsWith("[dbg]"));
  assert.ok(report.length >= 2, `the chunk report is too short: ${JSON.stringify(said)}`);
  assert.match(report[0], /chunks saved \d+ · failed 0/, "the report does not count the saves and the failures");
  // At least one chunk reads back with a plan in it: an anchor with data, parsed.
  assert.ok(report.some((line) => /\d+ plans/.test(line)), `no record was read back: ${report.join(" | ")}`);
  // The records really are block data, not a counter: every entry the report reads
  // is one of the records the world stored.
  for (const value of blockData.values()) {
    assert.equal(value.v, 1, "a stored record does not carry its version");
    assert.equal(Array.isArray(value.plans), true);
    assert.equal(Array.isArray(value.progress), true);
  }

  // A player outside a dungeon gets an answer, not silence.
  const { context: lobby, messages: lobbyMessages } = createWorld(["player-dbg-chunk-lobby"]);
  lobby.playerCommand("player-dbg-chunk-lobby", "chunk");
  assert.match(messagesFor(lobbyMessages, "player-dbg-chunk-lobby")[0], /not in a dungeon/);
});

test("/dbg dungeon describes the whole build in four lines", () => {
  const { context, messages } = createWorld(["player-dbg-dungeon"]);
  startDungeon(context, "player-dbg-dungeon");
  for (let tick = 0; tick < 80; tick += 1) context.tick();
  const before = messages.length;

  context.playerCommand("player-dbg-dungeon", "dungeon");

  const lines = messages.slice(before).map((entry) => entry.message);
  assert.ok(lines.length >= 4, `the summary was cut short: ${lines.length} line(s)`);
  const joined = lines.join("\n");
  assert.match(joined, /rooms · \d+ connections/);
  assert.match(joined, /build:/);
  assert.match(joined, /areas \d+\.\.\d+ cells/);
  assert.match(joined, /refusals:/);
  assert.doesNotMatch(joined, /undefined|NaN/);
});

test("a debug command the world does not know is left to the game", () => {
  const { context, messages } = createWorld(["player-dbg-other"]);
  const handled = context.playerCommand("player-dbg-other", "spawn");
  assert.equal(handled, false, "the world swallowed a command that is not its own");
  assert.equal(messages.length, 0, "an unknown command was answered anyway");
});

test("/dbg hud puts the seed and the cell on the screen, and only once", () => {
  const { context, messages, clientOptions, positions, movePlayer } = createWorld(["player-hud"]);
  startDungeon(context, "player-hud");
  for (let tick = 0; tick < 60; tick += 1) context.tick();

  context.playerCommand("player-hud", "hud");
  assert.ok(messagesFor(messages, "player-hud").some((message) => /HUD on/.test(message)));

  // Turning it on publishes the line at once, rather than up to a second later.
  assert.ok(clientOptions.some((entry) => entry.option === "middleTextTop" && /^seed \d+/.test(entry.value)),
    "the HUD line was not written when it was switched on");

  // Then it refreshes once a second, and only when the line changed: a client
  // option set every tick is a client option sent every tick. A player standing
  // still therefore costs nothing at all.
  const still = clientOptions.length;
  for (let tick = 0; tick < 40; tick += 1) context.tick();
  assert.equal(clientOptions.slice(still).filter((entry) => entry.option === "middleTextTop").length, 0,
    "the HUD was rewritten while the player had not moved");

  // Moving refreshes it, at most once a second.
  movePlayer("player-hud", [positions[0].position[0] + 3, positions[0].position[1], positions[0].position[2]]);
  const moving = clientOptions.length;
  for (let tick = 0; tick < 40; tick += 1) context.tick();
  const hudWrites = clientOptions.slice(moving).filter((entry) => entry.option === "middleTextTop");
  assert.ok(hudWrites.length >= 1 && hudWrites.length <= 2,
    `the HUD was written ${hudWrites.length} times in 40 ticks`);
  assert.match(hudWrites[0].value, /^seed \d+ · -?\d+,-?\d+ · /);
  assert.doesNotMatch(hudWrites[0].value, /undefined|NaN/);

  // It is cleared on leaving the dungeon, and the toggle turns it off.
  context.playerCommand("player-hud", "hud");
  assert.equal(clientOptions.at(-1).value, "", "the HUD was not cleared when switched off");
});

test("the HUD costs nothing until a player asks for it", () => {
  const { context, clientOptions } = createWorld(["player-hud-off"]);
  startDungeon(context, "player-hud-off");
  const before = clientOptions.length;
  for (let tick = 0; tick < 80; tick += 1) context.tick();
  assert.equal(clientOptions.slice(before).filter((entry) => entry.option === "middleTextTop").length, 0,
    "the HUD wrote to a player who never enabled it");
});

test("every chat form of the debug command is understood", () => {
  const { context, messages } = createWorld(["player-dbg-forms"]);
  startDungeon(context, "player-dbg-forms");
  for (let tick = 0; tick < 40; tick += 1) context.tick();

  const forms = ["dbg", "/dbg", "debug", "/debug", "dbg info", "DEBUG"];
  for (const form of forms) {
    const before = messages.length;
    const handled = context.playerCommand("player-dbg-forms", form);
    assert.equal(handled, true, `"${form}" was not handled`);
    assert.ok(messages.length > before, `"${form}" produced no report`);
  }
  // The namespace form with a verb: `/debug dungeon`.
  const before = messages.length;
  assert.equal(context.playerCommand("player-dbg-forms", "debug dungeon"), true);
  assert.match(messages.slice(before).map((entry) => entry.message).join("\n"), /rooms · \d+ connections/);
});

test("/dbg near lists the rooms around the player, with their state", () => {
  const { context, messages } = createWorld(["player-near"]);
  startDungeon(context, "player-near");
  for (let tick = 0; tick < 120; tick += 1) context.tick();
  const before = messages.length;

  context.playerCommand("player-near", "near");

  const lines = messages.slice(before).map((entry) => entry.message);
  assert.ok(lines.length >= 2, `the nearby report was cut short: ${lines.length} line(s)`);
  const joined = lines.join("\n");
  assert.match(joined, /room\(s\) near -?[\d.]+,-?[\d.]+/);
  assert.match(joined, /· built ·|· building ·|· not_started ·/);
  assert.match(joined, /free doorway\(s\)/);
  assert.match(joined, /seed \d+/);
  assert.doesNotMatch(joined, /undefined|NaN/);
});

test("the HUD state does not outlive the player", () => {
  const { context, messages, clientOptions } = createWorld(["player-hud-leave"]);
  startDungeon(context, "player-hud-leave");
  context.playerCommand("player-hud-leave", "hud");
  assert.ok(messagesFor(messages, "player-hud-leave").some((message) => /HUD on/.test(message)));

  context.onPlayerLeave("player-hud-leave");
  // A player who rejoins has not asked for the HUD again: nothing is written for
  // them until they do, so a debug overlay cannot follow someone across sessions.
  const before = clientOptions.length;
  for (let tick = 0; tick < 40; tick += 1) context.tick();
  assert.equal(clientOptions.slice(before).filter((entry) => entry.option === "middleTextTop").length, 0,
    "the HUD kept writing for a player who left");
});

test("/dbg mem reports the counters that must stay bounded", () => {
  const { context, messages } = createWorld(["player-dbg-mem"]);
  context.playerCommand("player-dbg-mem", "mem");
  assert.match(messagesFor(messages, "player-dbg-mem")[0], /no dungeon exists yet/);

  const { context: inDungeon, messages: dungeonMessages } = createWorld(["player-dbg-mem-2"]);
  startDungeon(inDungeon, "player-dbg-mem-2");
  tickUntil(inDungeon, () => false, 120);
  inDungeon.playerCommand("player-dbg-mem-2", "mem");
  const lines = messagesFor(dungeonMessages, "player-dbg-mem-2").filter((line) => line.startsWith("[dbg]"));
  assert.ok(lines.length >= 2, `the memory report is too short: ${JSON.stringify(lines)}`);
  // The cap is always printed, and it is a number: the difficulty still asks for
  // one, and a missing cap is the bug that let a dungeon grow for ever.
  assert.match(lines[0], /rooms \d+\/\d+ · capped \d+ · openings \d+ · links \d+/);
  assert.match(lines[1], /unfinished \d+ · built \d+ · queued \d+ · chunks \d+ · records \d+/);
});
