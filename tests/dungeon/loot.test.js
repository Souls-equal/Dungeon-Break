import test from "node:test";
import assert from "node:assert/strict";

import { CHEST_KEYS, DIFFICULTIES, DUNGEON_CONFIG, chestKeysFor, findDifficulty, floorOfLayer } from "../../src/dungeon/config.js";
import { chunkOfWorld } from "../../src/dungeon/loader.js";
import {
  chestOfClick,
  drawChestKey,
  findRoomChests,
  isChestBlock,
  isChestOpened,
  markChestOpened,
} from "../../src/dungeon/loot.js";

const VERY_EASY = findDifficulty("veryEasy");
const HELL = findDifficulty("hell");

/** A world that answers reads from a map, and `null` outside the chunks it knows. */
function createWorld(chests = []) {
  const blocks = new Map();
  const data = new Map();
  const loaded = new Set();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (const chest of chests) blocks.set(key(chest.x, chest.y, chest.z), chest.block || "Chest");
  return {
    blocks,
    data,
    loaded,
    api: {
      getBlock(x, y, z) {
        if (loaded.size === 0) return null;
        if (!loaded.has(`${Math.floor(x / DUNGEON_CONFIG.chunkSize)}|${Math.floor(y / DUNGEON_CONFIG.chunkSize)}|${Math.floor(z / DUNGEON_CONFIG.chunkSize)}`)) return null;
        return blocks.get(key(x, y, z)) || "Air";
      },
      getBlockData(x, y, z) {
        return data.get(key(x, y, z)) || null;
      },
      setBlockData(x, y, z, value) {
        data.set(key(x, y, z), value);
      },
    },
    load(chunkX, chunkZ, level) {
      const baseY = Math.floor(floorOfLayer(level.origin.y) / DUNGEON_CONFIG.chunkSize);
      this.loaded.add(`${chunkX}|${baseY}|${chunkZ}`);
    },
    put(x, y, z) {
      this.loaded.add(`${Math.floor(x / DUNGEON_CONFIG.chunkSize)}|${Math.floor(y / DUNGEON_CONFIG.chunkSize)}|${Math.floor(z / DUNGEON_CONFIG.chunkSize)}`);
      // The block was already placed by `createWorld`; this only makes its chunk readable.
      if (!blocks.has(key(x, y, z))) blocks.set(key(x, y, z), "Air");
    },
  };
}

function levelFor(difficulty, origin = { x: 0, y: 0, z: 0 }) {
  return { origin, difficulty, chests: new Map() };
}

// ------------------------------------------------------------------ draws --

test("a level's key weights lean rarer as the level gets harder", () => {
  const diamond = (difficulty) => {
    const row = chestKeysFor(difficulty);
    const total = row.reduce((sum, entry) => sum + entry.weight, 0);
    return row.find((entry) => entry.key === "Diamond Key").weight / total;
  };
  let previous = 0;
  for (const difficulty of DIFFICULTIES) {
    const chance = diamond(difficulty);
    assert.ok(chance > previous, `${difficulty.label} does not give a Diamond Key more often than the level before it`);
    previous = chance;
  }
  assert.ok(Math.abs(diamond(VERY_EASY) - 0.01) < 1e-9, "a Very Easy chest does not give a Diamond Key 1% of the time");
  assert.ok(Math.abs(diamond(HELL) - 0.28) < 1e-9, "a Hell chest does not give a Diamond Key 28% of the time");
});

test("every key stays possible at every level", () => {
  for (const difficulty of DIFFICULTIES) {
    for (const entry of chestKeysFor(difficulty)) {
      assert.ok(entry.weight > 0, `${entry.key} can never be given in ${difficulty.label}`);
    }
  }
});

test("the draw follows the weights", () => {
  // A feed of draws, not a random test: the distribution is the thing to pin, and 20 000
  // rolls on a fixed sequence is deterministic and cheap.
  const row = chestKeysFor(HELL);
  const total = row.reduce((sum, entry) => sum + entry.weight, 0);
  const counts = new Map();
  let seed = 1;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let roll = 0; roll < 20000; roll += 1) {
    const drawn = drawChestKey(HELL, random);
    counts.set(drawn.key, (counts.get(drawn.key) || 0) + 1);
  }
  for (const entry of row) {
    const share = (counts.get(entry.key) || 0) / 20000;
    const expected = entry.weight / total;
    assert.ok(Math.abs(share - expected) < 0.02,
      `${entry.key} falls ${Math.round(share * 100)}% of the time instead of ${Math.round(expected * 100)}%`);
  }
});

test("a draw at the very edge of the range still gives a key", () => {
  assert.equal(drawChestKey(VERY_EASY, () => 0).key, CHEST_KEYS[0].key, "a roll of 0 does not give the commonest key");
  assert.equal(drawChestKey(VERY_EASY, () => 1).key, CHEST_KEYS[CHEST_KEYS.length - 1].key, "a roll of 1 gives nothing");
});

// ------------------------------------------------------------------ scans --

test("the chests of a room are found where they stand", () => {
  const level = levelFor(VERY_EASY);
  const baseY = floorOfLayer(level.origin.y);
  const chests = [
    { x: 8, y: baseY + 4, z: 8 },
    { x: 20, y: baseY + 3, z: 24, block: "Iron Chest" },
  ];
  const world = createWorld(chests);
  for (const chest of chests) world.put(chest.x, chest.y, chest.z);

  const scan = findRoomChests(world.api, level, 0, 0);
  assert.equal(scan.complete, true);
  assert.equal(scan.chests.length, 2, "the scan did not find both chests");
  assert.deepEqual(scan.chests.map((chest) => [chest.x, chest.y, chest.z]).sort(),
    chests.map((chest) => [chest.x, chest.y, chest.z]).sort());
});

test("a room whose chunks are not sent reports an incomplete scan, not an empty room", () => {
  const level = levelFor(VERY_EASY);
  const world = createWorld();
  const scan = findRoomChests(world.api, level, 0, 0);
  assert.equal(scan.complete, false, "an unreadable room was reported as a room without chests");
  assert.equal(scan.chests.length, 0);
  // And it is not remembered: the next call has a right to a real answer.
  assert.equal(level.chests.size, 0, "an incomplete scan was cached");
});

test("a chest outside the room's box is not loot", () => {
  const level = levelFor(VERY_EASY);
  const baseY = floorOfLayer(level.origin.y);
  // In the wall's corner, outside `chestBox`: a builder's decoration.
  const outside = { x: 1, y: baseY + 4, z: 1 };
  const world = createWorld([outside]);
  world.put(outside.x, outside.y, outside.z);
  // The box is what makes a chest loot: a corner chest is a builder's decoration, and the
  // scan — which only walks the box — is how `/dbg chests` says so.
  assert.deepEqual(findRoomChests(world.api, level, 0, 0).chests, [], "a chest in a corner was counted as loot");
  assert.equal(chestOfClick(world.api, level, [outside.x, outside.y, outside.z]), null,
    "a click on a corner chest paid out");
});

// ----------------------------------------------------------------- clicks --

test("a click on a chest of the room is the chest, and a click elsewhere is not", () => {
  const level = levelFor(VERY_EASY);
  const baseY = floorOfLayer(level.origin.y);
  const chest = { x: 10, y: baseY + 4, z: 10 };
  const world = createWorld([chest]);
  world.put(chest.x, chest.y, chest.z);
  world.blocks.set("11,4,10", "Stone");

  const found = chestOfClick(world.api, level, [chest.x, chest.y, chest.z]);
  assert.equal(found.x, chest.x);
  assert.equal(found.block, "Chest");

  assert.equal(chestOfClick(world.api, level, [chest.x, chest.y + 1, chest.z]), null,
    "a click on the block above a chest paid out");
  assert.equal(chestOfClick(world.api, level, [chest.x, chest.y, chest.z + 20]), null,
    "a click outside the room paid out");
  assert.equal(chestOfClick(world.api, level, [chest.x, baseY + 40, chest.z]), null,
    "a click high above the room paid out");
});

test("the chest mark lives on the block, and it is what makes a chest opened once", () => {
  const level = levelFor(VERY_EASY);
  const baseY = floorOfLayer(level.origin.y);
  const chest = { x: 10, y: baseY + 4, z: 10 };
  const world = createWorld([chest]);
  world.put(chest.x, chest.y, chest.z);

  assert.equal(isChestOpened(world.api, chest.x, chest.y, chest.z), false);
  markChestOpened(world.api, chest.x, chest.y, chest.z);
  assert.equal(isChestOpened(world.api, chest.x, chest.y, chest.z), true);
  // A chest copied again is a new block, and `setBlockData` documents exactly that: the
  // data is cleared when the block changes.
  world.blocks.set(`${chest.x},${chest.y},${chest.z}`, "Air");
  world.data.delete(`${chest.x},${chest.y},${chest.z}`);
  assert.equal(isChestOpened(world.api, chest.x, chest.y, chest.z), false,
    "a chest that was replaced stayed marked as opened");
});

test("chest block names are recognised, and nothing else is", () => {
  assert.equal(isChestBlock("Chest"), true);
  assert.equal(isChestBlock("Iron Chest"), true);
  assert.equal(isChestBlock("Air"), false);
  assert.equal(isChestBlock(null), false);
  assert.equal(isChestBlock(undefined), false);
});

test("the chest of a click keeps its room, which is the room the level is drawn for", () => {
  const level = levelFor(VERY_EASY);
  const baseY = floorOfLayer(level.origin.y);
  const chest = { x: 32 + 10, y: baseY + 4, z: 10 };
  const world = createWorld([chest]);
  world.put(chest.x, chest.y, chest.z);
  const found = chestOfClick(world.api, level, [chest.x, chest.y, chest.z]);
  assert.deepEqual({ x: found.chunkX, z: found.chunkZ }, chunkOfWorld(chest.x, chest.z),
    "the chest was filed under another room");
});
