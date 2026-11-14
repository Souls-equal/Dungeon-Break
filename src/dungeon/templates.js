/*
 * Where the room templates are, and how a room is chosen.
 *
 * A template is a **whole Bloxd chunk** — 32x32x32 blocks — that you build in the
 * world and reference **by chunk coordinate**. The generator never reads its
 * blocks: it copies the chunk with `api.copyChunk`, one call for 32 768 blocks.
 * That is the entire reason this engine exists, and it is why the templates must
 * be *authored*: a shape built at load time would have to be written block by
 * block, which is the cost we are removing.
 *
 * ---------------------------------------------------------------------------
 * COORDINATES ARE IN CHUNKS, NOT IN BLOCKS
 * ---------------------------------------------------------------------------
 *
 * The series the rooms were built on is `-2, -4, -6, …`: one step per **chunk**,
 * so two neighbouring rooms are 64 blocks apart. A chunk coordinate of `-2` is
 * the chunk that starts at world x `-64`. `chunkToBlock` below is the only place
 * that conversion happens, and it happens **once**, when the table is read — the
 * rest of the engine works in blocks, which is what `copyChunk` and `getBlock`
 * take.
 *
 * ---------------------------------------------------------------------------
 * THE ROOMS ARE SHARED AND HAVE NO PROPERTIES
 * ---------------------------------------------------------------------------
 *
 * There is **one list of rooms**, and every difficulty draws from it. A level can
 * add rooms of its own (`template(niveau, [...])`), but nothing here needs it yet:
 * all eight levels use the same set, so a room added once is available everywhere.
 *
 * A room is **just a chunk coordinate**. No name, no id, no doors to declare, no
 * height, no shape. It is known by its **position in the list**, so `#12` is the
 * thirteenth room, and `/dbg templates` says `#12 chunk -26,0 → block -832,0`.
 *
 * There is nothing to connect either: rooms are butted against each other, and
 * the generator picks one at random for each chunk it fills. If a shape needs a
 * door on one side, that is a property of the room's own build, not of this
 * table.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE GENERATOR REQUIRES OF A ROOM
 * ---------------------------------------------------------------------------
 *
 * Only two things, and neither is written in this file:
 *
 * 1. The chunk must be **loaded** when it is copied. `copyChunk` does nothing if
 *    the source chunk is unloaded — no error, no log, just an empty room. See
 *    `loader.js`: a room is read before being copied, and one that stays
 *    unreadable is disabled instead of retried for ever.
 * 2. The room's floor is **read** from the template, not configured: the loader
 *    walks up the middle column to find the first solid block.
 *
 * No cell of a room is reserved for this generator: it writes nothing, ever.
 *
 * ---------------------------------------------------------------------------
 * PICKING A ROOM
 * ---------------------------------------------------------------------------
 *
 * A chunk's room is derived from a hash of `(level, chunkX, chunkZ)`, never from
 * a random draw, so the same level always builds the same dungeon: a player who
 * walks back, or a level that is re-entered after a disconnect, sees exactly the
 * same rooms. No state has to be remembered for that to hold.
 *
 * **Changing this list changes every dungeon.** `hash % count` moves as soon as
 * `count` does, so adding the 16th room re-rolls all eight levels. That is
 * accepted while the rooms are being built; once the world is worth keeping, the
 * draw moves to `hash % TEMPLATE_COUNT` so that filling in a slot later does not
 * disturb what is already there.
 */

/** A chunk coordinate, as written in this file, turned into a world block. */
export function chunkToBlock(chunkX, chunkY, chunkZ) {
  const size = 32;
  return [chunkX * size, chunkY * size, chunkZ * size];
}

/**
 * The rooms. Every difficulty draws from this list.
 *
 * >>> CHUNK COORDINATES <<<
 *
 * `[x, y, z]` in **chunks**: `[0, 0, 0]` is the chunk covering blocks 0..31,
 * `[-2, 1, 0]` is the chunk at blocks −64..−33, y 32..63. One step on x is 32
 * blocks, two steps 64 — so the series below, two chunks at a time, leaves one
 * chunk of gap between two rooms.
 *
 * The fifteen rooms below are built. The sixty that follow are commented out, one
 * entry per room, so filling one in is deleting two slashes and moving the
 * coordinate to its chunk.
 */
const READY_ROOMS = [
  // The fifteen rooms that already exist, in the order of the series.
  [-2, 1, 0],
  [-4, 1, 0],
  [-6, 1, 0],
  [-8, 1, 0],
  [-10, 1, 0],
  [-12, 1, 0],
  [-14, 1, 0],
  [-16, 1, 0],
  [-18, 1, 0],
  [-20, 1, 0],
  [-22, 1, 0],
  [-24, 1, 0],
  [-26, 1, 0],
  [-28, 1, 0],
  [-30, 1, 0],
];

/** The sixty rooms still to build, in the same series. Uncomment as they land. */
const PLANNED_ROOMS = [
  // [-32, 1, 0],
  // [-34, 1, 0],
  // [-36, 1, 0],
  // [-38, 1, 0],
  // [-40, 1, 0],
  // [-42, 1, 0],
  // [-44, 1, 0],
  // [-46, 1, 0],
  // [-48, 1, 0],
  // [-50, 1, 0],
  // [-52, 1, 0],
  // [-54, 1, 0],
  // [-56, 1, 0],
  // [-58, 1, 0],
  // [-60, 1, 0],
  // [-62, 1, 0],
  // [-64, 1, 0],
  // [-66, 1, 0],
  // [-68, 1, 0],
  // [-70, 1, 0],
  // [-72, 1, 0],
  // [-74, 1, 0],
  // [-76, 1, 0],
  // [-78, 1, 0],
  // [-80, 1, 0],
  // [-82, 1, 0],
  // [-84, 1, 0],
  // [-86, 1, 0],
  // [-88, 1, 0],
  // [-90, 1, 0],
  // [-92, 1, 0],
  // [-94, 1, 0],
  // [-96, 1, 0],
  // [-98, 1, 0],
  // [-100, 1, 0],
  // [-102, 1, 0],
  // [-104, 1, 0],
  // [-106, 1, 0],
  // [-108, 1, 0],
  // [-110, 1, 0],
  // [-112, 1, 0],
  // [-114, 1, 0],
  // [-116, 1, 0],
  // [-118, 1, 0],
  // [-120, 1, 0],
  // [-122, 1, 0],
  // [-124, 1, 0],
  // [-126, 1, 0],
  // [-128, 1, 0],
  // [-130, 1, 0],
  // [-132, 1, 0],
  // [-134, 1, 0],
  // [-136, 1, 0],
  // [-138, 1, 0],
  // [-140, 1, 0],
  // [-142, 1, 0],
  // [-144, 1, 0],
  // [-146, 1, 0],
  // [-148, 1, 0],
  // [-150, 1, 0],
];

// Kept on `globalThis` on purpose, and with its name intact through the build:
// this is the one table a player edits by hand, and `/dbg templates` — or a
// console — has to be able to read the coordinates actually in use. A constant
// that the bundler renames into `he` is a constant nobody can debug.
//
// Created only if a host has not already defined it: the tests inject their own
// table so the code under test is the code that ships.
globalThis.ROOM_TEMPLATES = globalThis.ROOM_TEMPLATES || {
  rooms: READY_ROOMS,
};

/** A room, as the engine uses it: a world block coordinate and its chunk. */
function roomFrom(entry, index, log) {
  if (Array.isArray(entry) && entry.length === 3) {
    if (entry.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      if (log) log(`room #${index} has a non-numeric chunk coordinate`);
      return null;
    }
    const chunk = [Math.floor(entry[0]), Math.floor(entry[1]), Math.floor(entry[2])];
    return { index, chunk, src: chunkToBlock(chunk[0], chunk[1], chunk[2]) };
  }
  // A full `[x, y, z]` in blocks, for a room that is not on the chunk grid. The
  // engine copies the whole chunk anyway, so this is only a convenience.
  if (entry && Array.isArray(entry.src) && entry.src.length === 3) {
    const src = entry.src.map((value) => Math.floor(Number(value)));
    if (src.some((value) => !Number.isFinite(value))) {
      if (log) log(`room #${index} has a non-numeric src`);
      return null;
    }
    const chunk = src.map((value) => Math.floor(value / 32));
    return { index, chunk, src };
  }
  if (log) log(`room #${index} is not a chunk coordinate [x, y, z]`);
  return null;
}

/**
 * Rooms of one level: the level's own, then the shared ones.
 *
 * A malformed entry is dropped with a log line rather than throwing: a typo in one
 * room must not take the whole level down, and a generator that throws inside
 * `tick` is a generator that stops the game.
 */
export function templatesFor(difficulty, log) {
  // Resolved at call time, not at load time: the table is a plain object on the
  // global scope, and a host that replaces it — the tests do — must be obeyed.
  const table = globalThis.ROOM_TEMPLATES;
  if (!table) return [];
  const own = Array.isArray(table[difficulty.id]) ? table[difficulty.id] : [];
  const shared = Array.isArray(table.rooms) ? table.rooms : [];
  const list = [];
  for (const entry of own.concat(shared)) {
    const room = roomFrom(entry, list.length, log);
    if (room) list.push(room);
  }
  return list;
}

/**
 * Which room a chunk of a level gets.
 *
 * A pure function of the chunk: nothing about the neighbours is consulted, because
 * the rooms declare nothing to connect. The draw is therefore stable — the same
 * chunk is rebuilt with the same room after a restart — and adding a room to the
 * table is the only way to change what a level looks like.
 */
export function templateFor(list, difficulty, chunkX, chunkZ) {
  if (list.length === 0) return null;
  const hash = hashOf(difficulty.id, chunkX, chunkZ);
  return list[hash % list.length];
}

/** Small, stable, well-mixed hash: same inputs, same number, always. */
export function hashOf(text, chunkX, chunkZ) {
  let hash = 2166136261;
  const source = `${text}|${chunkX}|${chunkZ}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  // A final avalanche, so neighbouring chunks do not pick neighbouring indices.
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  return hash >>> 0;
}
