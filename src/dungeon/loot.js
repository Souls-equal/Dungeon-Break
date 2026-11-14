/*
 * Chests: one key per chest, drawn for the level the chest is in.
 *
 * The dungeon cannot put an item **in** a chest, and does not want to: a room is a copy,
 * and writing into a copy is the one thing this project does not do. So a chest is a
 * **trigger** — the player opens it, the game says so, and the key is handed over. What a
 * chest gives is decided here, where it can be tested without a game.
 *
 * A chest opens **once**, and the proof is the same one cleared rooms use: `setBlockData`
 * on the chest's own block. That data is cleared when the block changes, which is exactly
 * the lifetime wanted — a room copied again gets its chest back, and a new entry (a new
 * place) starts with every chest full.
 */

import { DUNGEON_CONFIG, chestKeysFor, floorOfLayer } from "./config.js";

const SIZE = DUNGEON_CONFIG.chunkSize;

/** The block names a room can hold that are chests, in the game's own spelling. */
const CHEST_BLOCKS = new Set(["Chest", "Iron Chest", "Gold Chest"]);

export function isChestBlock(name) {
  return typeof name === "string" && CHEST_BLOCKS.has(name);
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
 * Finds the chests of a room, reading the world and never writing it.
 *
 * Nothing in the API says where a hand-built room keeps its chests, so the search is
 * bounded and explicit: `chestBox` in chunk-local coordinates, every column of it, and
 * `chestScanHeights` cells up from the bottom of the box. A column is read upwards and
 * stops at the first chest — a room's chest stands on its floor, not halfway up a wall.
 *
 * This is a **reporting** tool, not the click path: it is thousands of reads, it is cached
 * per room, and `/dbg chests` is what calls it. A click is answered from the block the
 * player clicked (see `chestOfClick`), which costs one read.
 *
 * `complete` is false when a column was unreadable (the chunk is not sent yet). That
 * matters to the caller: an incomplete scan cannot be used to say "there is no chest
 * here", only "not this time".
 */
export function findRoomChests(api, level, chunkX, chunkZ) {
  if (!level.chests) level.chests = new Map();
  const cacheKey = `${chunkX}|${chunkZ}`;
  const cached = level.chests.get(cacheKey);
  if (cached !== undefined) return cached;

  const box = DUNGEON_CONFIG.chestBox;
  const baseX = chunkX * SIZE;
  const baseY = floorOfLayer(level.origin.y);
  const baseZ = chunkZ * SIZE;
  const chests = [];
  let complete = true;

  // Every column of the box, bottom up, stopping at the first chest in it.
  for (let localX = box.minX; localX <= box.maxX; localX += 1) {
    for (let localZ = box.minZ; localZ <= box.maxZ; localZ += 1) {
      for (let up = 0; up < DUNGEON_CONFIG.chestScanHeights; up += 1) {
        const y = baseY + box.minY + up;
        const name = api.getBlock(baseX + localX, y, baseZ + localZ);
        if (name === null || name === undefined) {
          // The chunk is not sent: the rest of this column would be a guess.
          complete = false;
          break;
        }
        if (!isChestBlock(name)) continue;
        chests.push({ x: baseX + localX, y, z: baseZ + localZ, block: name });
        break;
      }
    }
  }

  const result = { chests, complete };
  // An incomplete scan is not cached: the next call has a right to a real answer.
  if (complete) level.chests.set(cacheKey, result);
  return result;
}

/** Was this chest already opened? The answer comes from the world, not from memory. */
export function isChestOpened(api, x, y, z) {
  const data = api.getBlockData(x, y, z);
  return Boolean(data && data.opened);
}

/** Marks a chest as opened. Idempotent, and the block itself is never touched. */
export function markChestOpened(api, x, y, z) {
  api.setBlockData(x, y, z, { opened: true });
}

/**
 * The chest a player just clicked, if it is one of a dungeon's chests.
 *
 * The test is three cheap things and no scan: the click is **inside the room's box**, at a
 * height the level uses, and **the block is a chest**. Scanning the room on a click would
 * mean thousands of reads to answer a question the click already answers — the game names
 * the block — and it would fail whenever a room's chunk happened to be loading.
 *
 * So a chest a builder put in the room's middle is loot, and one built into a wall or a
 * corner outside `chestBox` is decoration: the box is the line, and it is a number in
 * `config.js` rather than a guess made per room.
 *
 * `null` means "not a chest of this dungeon".
 */
export function chestOfClick(api, level, position) {
  if (!level.origin) return null;
  const box = DUNGEON_CONFIG.chestBox;
  const x = Math.floor(position[0]);
  const y = Math.floor(position[1]);
  const z = Math.floor(position[2]);
  const chunkX = Math.floor(x / SIZE);
  const chunkZ = Math.floor(z / SIZE);
  const baseY = floorOfLayer(level.origin.y);
  const localX = x - chunkX * SIZE;
  const localZ = z - chunkZ * SIZE;

  if (localX < box.minX || localX > box.maxX) return null;
  if (localZ < box.minZ || localZ > box.maxZ) return null;
  if (y < baseY + box.minY || y > baseY + box.maxY) return null;
  const block = api.getBlock(x, y, z);
  if (!isChestBlock(block)) return null;

  return { x, y, z, block, chunkX, chunkZ };
}
