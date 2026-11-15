/*
 * Chests: click one, get a key, and the chest is gone.
 *
 * A chest is a **block of the room's build**, so the code never looks for one and never
 * predicts where one is: the game says which block was clicked, and the answer is either
 * `Chest` or it is not. That is the owner's rule, and it is also the only rule that works —
 * a hand-built room can put a chest anywhere, and a list of guesses would miss it.
 *
 * Opening a chest is **one write**: the chest becomes `Air`, and the key drops at the middle
 * of the block it was in. Nothing has to remember that the chest was opened, because there
 * is no chest left to open — a room copied again gets its chest back, which is the only
 * reset wanted.
 */

import { DUNGEON_CONFIG, chestKeysFor } from "./config.js";

const SIZE = DUNGEON_CONFIG.chunkSize;

/**
 * The block a dungeon chest is: **any block whose name contains `Chest`**.
 *
 * The builds hold ordinary chests, but the game reports rotations as
 * `Chest`, `Chest North`, `Trapped Chest`, etc. One substring test covers
 * them all, and no other chest exists on the map.
 */
export function isChestBlock(name) {
  return typeof name === "string" && name.includes("Chest");
}

/**
 * Draws a key for a level, with the weights `chestKeysFor` gives it.
 *
 * `random` is a parameter rather than `Math.random` read inside: a distribution is only
 * testable if the draw can be fed, and a level's curve is the one thing here worth pinning.
 */
export function drawChestKey(difficulty, random = Math.random) {
  const row = chestKeysFor(difficulty);
  const total = row.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  for (const entry of row) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  // A `random()` that returns exactly 1, or a row of zero weights, still gives a key
  // rather than nothing: the last entry is the floor of the draw.
  return row[row.length - 1];
}

/**
 * Opens a chest: the block becomes `Air`, and the key lands at the middle of it.
 *
 * `x + 0.5, y, z + 0.5` is the centre of the block's **column**, with `y` left as the
 * chest's own height: a key dropped at `y` sits in the cell the chest occupied, which is
 * where a player's hand is — half a block up would be inside the chest's own lid.
 *
 * The block is removed **before** the key is dropped: if the drop fails there is no chest
 * to try again with, so the order is the one that cannot duplicate a key. The caller
 * checks the return of `createItemDrop` and says so when nothing could be dropped.
 */
export function openChest(api, chest) {
  api.setBlock(chest.x, chest.y, chest.z, "Air");
  return api.createItemDrop(chest.x + 0.5, chest.y, chest.z + 0.5, chest.itemName, 1, false);
}

/**
 * The chest a player just clicked, if they are in a dungeon.
 *
 * **Nothing is looked for and nothing is predicted**: a room's chests live in the build, and
 * the game hands over the block the player clicked. So the test is one thing — the block is
 * `Chest`, and the player's dungeon can say where the chest is (`level.origin`, which a
 * level always has once it is being played).
 *
 * `null` means "not a chest of this dungeon": a click on anything else, or a click from
 * somebody who is not in a dungeon.
 *
 * The chest keeps its height in its own coordinates: opening it is what decides what it
 * gives, and the height is in this position so a report and a test can name the block.
 */
export function chestOfClick(api, level, position) {
  if (!level || !level.origin) return null;
  const x = Math.floor(position[0]);
  const y = Math.floor(position[1]);
  const z = Math.floor(position[2]);
  if (!isChestBlock(api.getBlock(x, y, z))) return null;
  return {
    x,
    y,
    z,
    chunkX: Math.floor(x / SIZE),
    chunkZ: Math.floor(z / SIZE),
  };
}
