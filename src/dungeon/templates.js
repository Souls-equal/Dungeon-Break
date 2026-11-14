/*
 * Where the room templates are.
 *
 * A template is a **whole Bloxd chunk** — 32x32x32 blocks — that you build in the
 * world and then reference by its coordinates. The generator never reads its
 * blocks: it copies the chunk with `api.copyChunk`, which is one call for 32 768
 * blocks. That is the entire reason this engine exists, and it is why the
 * templates must be *authored*, not generated: a shape built at load time would
 * have to be written block by block, which is the cost we are removing.
 *
 * ---------------------------------------------------------------------------
 * WHAT A TEMPLATE MUST LOOK LIKE
 * ---------------------------------------------------------------------------
 *
 * 1. The chunk must be **loaded** whenever it is copied. `copyChunk` does
 *    nothing if the source chunk is unloaded — no error, no log, just an empty
 *    room. See `loader.js`: the loader forces the load with a `getBlock` read and
 *    then verifies the copy landed before marking the chunk as placed.
 *
 * 2. It must be a **room**: floor, four walls with door openings, a ceiling.
 *    Every face of the chunk is a potential boundary with another room, so every
 *    face needs a door — except where `faces` says otherwise (see below).
 *
 * 3. **A door must span the same cells on both facing chunks.** A room chunk is
 *    32 blocks wide, so its neighbours butt straight on: a door at local x 13..18
 *    on the north face of chunk (0,0) faces local x 13..18 of the south face of
 *    chunk (0,-1). Nothing realigns it — there is no corridor between two
 *    templates, no offset, no rotation. The simplest way to satisfy this is to
 *    put every door in the same place on every template.
 *
 * 4. The chunk's **low corners must be solid**, because the chunk record is a
 *    `Bedrock` block at local (0, y, 0) (see `DUNGEON_CONFIG.markerBlock`). If a
 *    corner is open floor, put the marker somewhere else with `markerLocal`.
 *
 * 5. The chunk's **lowest layer that is not empty** should be the floor. The
 *    landing code walks up from the bottom of the chunk to find the first solid
 *    block and places the player two blocks above it; a template whose floor is
 *    at local y 4 therefore works without any configuration.
 *
 * ---------------------------------------------------------------------------
 * FACES
 * ---------------------------------------------------------------------------
 *
 * `faces` is a shorthand for "which of my four sides have a door", in the order
 * north, east, south, west (N, E, S, W). Two neighbouring chunks connect when
 * both sides have a door, so `faces: "NESW"` connects on all four sides and
 * `faces: "NS"` makes a north-south corridor. A door opening on a side that is
 * not listed is simply never reached: the neighbour has no door there either.
 *
 * This is the only constraint the generator enforces, and it is a *soft* one: if
 * two neighbours do not agree, they are still placed, and the player finds a wall
 * where a door was expected. `faces` exists so that does not happen.
 *
 * ---------------------------------------------------------------------------
 * PICKING A TEMPLATE
 * ---------------------------------------------------------------------------
 *
 * A chunk's template is derived from a hash of `(level, chunkX, chunkZ)`, never
 * from a random draw, so the same level always builds the same dungeon: a player
 * who walks back, or a level that is re-entered after a disconnect, sees exactly
 * the same rooms. No state has to be remembered for that to hold.
 */

/**
 * Templates, grouped by difficulty id.
 *
 * >>> COORDINATES GO HERE <<<
 *
 * `src`: [x, y, z] of any block inside the template chunk. The generator copies
 * that whole chunk, so a corner is the clearest thing to write down. The Y value
 * must be inside the chunk too: `[0, -32, 0]` and `[5, -20, 7]` both select the
 * chunk whose corner is `(0, -32, 0)`.
 *
 * `faces`: which sides have a door, in the order N, E, S, W.
 *
 * `spawn`: optional, for a template you want to use as the level's entrance.
 * Without it, the entrance is whichever template the hash picks for the origin
 * chunk, which is fine: every template is a room.
 *
 * `markerLocal`: optional `[x, y, z]`, chunk-local, for the block that records
 * the chunk. Defaults to the low corner (0, 0, 0). Use it when that corner is not
 * solid.
 */
// Kept on `globalThis` on purpose, and with its name intact through the build:
// this is the one table a player edits by hand, and `/dbg templates` — or a
// console — has to be able to read the coordinates actually in use. A constant
// that the bundler renames into `he` is a constant nobody can debug.
// Created only if a host has not already defined it: the tests inject their own
// table so the code under test is the code that ships, and a plain assignment
// would wipe it. Reading it back through `globalThis` at call time keeps this
// file honest about where the coordinates live.
globalThis.ROOM_TEMPLATES = globalThis.ROOM_TEMPLATES || {
  // Example entry — replace the coordinates with your own zone, and delete the
  // comment once at least one level has a real template.
  //
  // veryEasy: [
  //   { id: "hall-a", src: [0, -32, 0], faces: "NESW" },
  //   { id: "hall-b", src: [32, -32, 0], faces: "NESW" },
  //   { id: "corner-a", src: [64, -32, 0], faces: "NE" },
  // ],
};

/**
 * Templates of one level, as a clean list.
 *
 * Malformed entries are dropped with a log line rather than throwing: a typo in
 * one template of a level must not take the whole level down, and a generator
 * that throws inside `tick` is a generator that stops the game.
 */
export function templatesFor(difficulty, log) {
  const table = globalThis.ROOM_TEMPLATES;
  // Resolved at call time, not at load time: the table is a plain object on the
  // global scope, and a host that replaces it — the tests do — must be obeyed.
  const raw = table ? table[difficulty.id] : null;
  if (!Array.isArray(raw)) return [];
  const list = [];
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    if (!entry || !Array.isArray(entry.src) || entry.src.length !== 3) {
      if (log) log(`template ${index} of ${difficulty.id} has no usable src [x, y, z]`);
      continue;
    }
    if (entry.src.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      if (log) log(`template ${index} of ${difficulty.id} has a non-numeric src`);
      continue;
    }
    list.push({
      id: entry.id || `${difficulty.id}-${index}`,
      src: [Math.floor(entry.src[0]), Math.floor(entry.src[1]), Math.floor(entry.src[2])],
      faces: typeof entry.faces === "string" ? entry.faces.toUpperCase() : "",
      markerLocal: Array.isArray(entry.markerLocal) ? entry.markerLocal : null,
      spawn: entry.spawn === true,
    });
  }
  return list;
}

/**
 * Which template a chunk of a level gets.
 *
 * Deliberately ignores the neighbours' faces: the choice is a pure function of
 * the chunk, so it can be recomputed at any time without remembering anything,
 * and a level that is rebuilt is rebuilt identically. Connectivity is then a
 * property of the template set — which is why mixing "NESW" halls with "NS"
 * corridors is a design choice, not a bug in the generator.
 */
export function templateFor(list, difficulty, chunkX, chunkZ) {
  if (list.length === 0) return null;
  // The entrance is the one chunk whose template is chosen rather than drawn: the
  // first room a player sees is the one that says what the level looks like.
  if (chunkX === 0 && chunkZ === 0) {
    const entrance = list.find((template) => template.spawn);
    if (entrance) return entrance;
  }
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
