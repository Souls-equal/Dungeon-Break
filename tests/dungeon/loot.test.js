import test from "node:test";
import assert from "node:assert/strict";

import { CHEST_KEYS, DIFFICULTIES, chestKeysFor, findDifficulty } from "../../src/dungeon/config.js";
import { chunkOfWorld } from "../../src/dungeon/loader.js";
import { chestOfClick, drawChestKey, isChestBlock, openChest } from "../../src/dungeon/loot.js";

const VERY_EASY = findDifficulty("veryEasy");
const HELL = findDifficulty("hell");

/** A world: the blocks it holds, the drops it was asked for, and the writes it saw. */
function createWorld(blocks = new Map()) {
  const drops = [];
  const writes = [];
  const key = (x, y, z) => `${x},${y},${z}`;
  return {
    blocks,
    drops,
    writes,
    api: {
      getBlock(x, y, z) {
        return blocks.get(key(x, y, z)) || "Air";
      },
      setBlock(x, y, z, name) {
        writes.push({ x, y, z, name });
        blocks.set(key(x, y, z), name);
      },
      createItemDrop(x, y, z, itemName, amount) {
        drops.push({ x, y, z, itemName, amount });
        return `drop-${drops.length}`;
      },
    },
  };
}

function levelFor(difficulty, origin = { x: 0, y: 0, z: 0 }) {
  return { origin, difficulty };
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

// ----------------------------------------------------------------- clicks --

test("a click on a chest is a chest, anything else is not", () => {
  const level = levelFor(VERY_EASY);
  const blocks = new Map([
    ["10,4,10", "Chest"],
    ["11,4,10", "Stone"],
    ["12,4,10", "Chest"], // a second chest, right beside the first
  ]);
  const world = createWorld(blocks);

  const found = chestOfClick(world.api, level, [10, 4, 10]);
  assert.deepEqual({ x: found.x, y: found.y, z: found.z }, { x: 10, y: 4, z: 10 });
  assert.equal(chestOfClick(world.api, level, [11, 4, 10]), null, "a click on stone became a chest");
  assert.equal(chestOfClick(world.api, level, [10, 5, 10]), null, "a click above a chest became a chest");
  // Fractions are floored, not rounded: the game can report a position inside the block.
  assert.equal(chestOfClick(world.api, level, [12.7, 4.2, 10.1]).x, 12);
});

test("a click outside a dungeon is not a chest of a dungeon", () => {
  const world = createWorld(new Map([["0,0,0", "Chest"]]));
  assert.equal(chestOfClick(world.api, null, [0, 0, 0]), null, "a click with no dungeon paid out");
  assert.equal(chestOfClick(world.api, { origin: null }, [0, 0, 0]), null,
    "a click in a level with no place paid out");
});

test("the chest of a click keeps its room, which is what the level is drawn for", () => {
  const level = levelFor(VERY_EASY);
  const world = createWorld(new Map([["42,4,10", "Chest"]]));
  const found = chestOfClick(world.api, level, [42, 4, 10]);
  assert.deepEqual({ x: found.chunkX, z: found.chunkZ }, chunkOfWorld(42, 10),
    "the chest was filed under another room");
});

// ------------------------------------------------------------------ opens --

test("opening a chest leaves air and drops the key at the middle of the block", () => {
  const world = createWorld(new Map([["10,4,10", "Chest"]]));
  const drop = openChest(world.api, { x: 10, y: 4, z: 10, itemName: "Gold Key" });

  // The block is gone, and that is the whole memory of "this chest was opened".
  assert.deepEqual(world.writes, [{ x: 10, y: 4, z: 10, name: "Air" }],
    "the chest was not replaced by Air");
  assert.equal(world.api.getBlock(10, 4, 10), "Air");
  // The key lands at the middle of the click: +0.5 in x and z, and the chest's own y.
  assert.equal(drop, "drop-1");
  assert.deepEqual(world.drops, [{ x: 10.5, y: 4, z: 10.5, itemName: "Gold Key", amount: 1 }],
    "the key was not dropped at the middle of the chest");
});

test("the chest is emptied before the key is created, so a failure cannot duplicate one", () => {
  const order = [];
  const api = {
    setBlock: () => order.push("air"),
    createItemDrop: () => { order.push("drop"); return null; },
  };
  assert.equal(openChest(api, { x: 0, y: 0, z: 0, itemName: "Wooden Key" }), null);
  assert.deepEqual(order, ["air", "drop"], "the key was created before the chest was removed");
});

test("chest block names: any block containing Chest", () => {
  assert.equal(isChestBlock("Chest"), true);
  // Rotations and trapped variants all contain "Chest"
  assert.equal(isChestBlock("Chest North"), true);
  assert.equal(isChestBlock("Trapped Chest"), true);
  assert.equal(isChestBlock("Iron Chest"), true, "every chest variant is accepted — none except plain chests are on the map");
  assert.equal(isChestBlock("Air"), false);
  assert.equal(isChestBlock(null), false);
  assert.equal(isChestBlock(undefined), false);
});
