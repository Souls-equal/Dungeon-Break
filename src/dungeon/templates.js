/*
 * Where the room templates are, and how a room is chosen.
 *
 * A template is a **whole Bloxd chunk** — 32x32x32 blocks — that you build in the
 * world and then reference by its coordinates, `[x, 1, z]`. The generator never
 * reads its blocks: it copies the chunk with `api.copyChunk`, one call for 32 768
 * blocks. That is the entire reason this engine exists, and it is why the
 * templates must be *authored*: a shape built at load time would have to be
 * written block by block, which is the cost we are removing.
 *
 * ---------------------------------------------------------------------------
 * THE ROOMS ARE SHARED
 * ---------------------------------------------------------------------------
 *
 * There is **one list of rooms**, and every difficulty draws from it. A level can
 * add rooms of its own (`veryEasy: [...]`), but nothing here needs it yet: at the
 * moment all eight levels use the same set, and a room added once is available
 * everywhere.
 *
 * A room has no name and no id. It is known by its **position in the list**, so
 * `#12` is the thirteenth room of `ROOMS`, and `/dbg templates` says `#12
 * [x, 1, z]` — the index plus the coordinate, which is all a bug report needs.
 *
 * ---------------------------------------------------------------------------
 * WHAT A TEMPLATE MUST LOOK LIKE
 * ---------------------------------------------------------------------------
 *
 * 1. The chunk must be **loaded** whenever it is copied. `copyChunk` does nothing
 *    if the source chunk is unloaded — no error, no log, just an empty room. See
 *    `loader.js`: the loader reads the template before copying it, and disables a
 *    template that stays unreadable instead of retrying for ever.
 *
 * 2. It must be a **room**: floor, four walls with door openings, a ceiling. Every
 *    face of the chunk is a boundary with another room, so every face needs a
 *    door — except where `faces` says otherwise (see below).
 *
 * 3. **A door must span the same cells on both facing chunks.** Two room chunks
 *    butt straight on: a door at local x 13..18 on the north face of chunk (0,0)
 *    faces local x 13..18 of the south face of chunk (0,-1). Nothing realigns it —
 *    no corridor between two templates, no offset, no rotation. The simplest way
 *    to satisfy this is to put every door in the same place on every template; if
 *    the first 15 rooms were built by the same hand, they already agree.
 *
 * 4. **Nothing else is required of it.** The engine writes its own record block
 *    into the middle of the room's ceiling after the copy (`surfaceBlock` in
 *    `config.js`), so no corner, no cell and no block of a template has to be
 *    reserved for this generator. And the floor is *read* from the template, not
 *    configured: the loader walks up the middle column of the room to find it.
 *
 * ---------------------------------------------------------------------------
 * FACES
 * ---------------------------------------------------------------------------
 *
 * `faces` is a shorthand for "which of my four sides have a door", in the order
 * north, east, south, west (N, E, S, W). Two neighbouring chunks connect when
 * both sides have a door, so `faces: "NESW"` connects on all four sides and
 * `faces: "NS"` makes a north-south corridor.
 *
 * This is the only constraint the generator enforces, and it is a *soft* one: if
 * two neighbours do not agree, they are still placed, and the player finds a wall
 * where a door was expected.
 *
 * ---------------------------------------------------------------------------
 * PICKING A ROOM
 * ---------------------------------------------------------------------------
 *
 * A chunk's room is derived from a hash of `(level, chunkX, chunkZ)`, never from a
 * random draw, so the same level always builds the same dungeon: a player who
 * walks back, or a level that is re-entered after a disconnect, sees exactly the
 * same rooms. No state has to be remembered for that to hold.
 *
 * **Changing this list changes every dungeon.** `hash % count` moves as soon as
 * `count` does, so adding the 16th room re-rolls all eight levels. That is
 * accepted while the rooms are being built; once the world is worth keeping, the
 * draw moves to `hash % TEMPLATE_COUNT` so that filling in a slot later does not
 * disturb what is already there.
 */

/**
 * The rooms. Every difficulty draws from this list.
 *
 * >>> FILL IN THE COORDINATES <<<
 *
 * `src`: `[x, y, z]` of a block **inside** the template chunk. `y` must be inside
 * the chunk too — `[0, 1, 0]` and `[7, 30, 9]` both select the chunk whose corner
 * is `(0, 0, 0)`.
 *
 * The fifteen rooms below are built and ready. They are one chunk apart on x, so
 * a room every **32** blocks is a different chunk: **this list cannot be used as
 * written.** Replace the coordinates with the real spacing of your zone.
 *
 * The 75 planned rooms are commented out, one entry per room, so filling one in
 * is deleting two slashes.
 */
const READY_ROOMS = [
  // The fifteen rooms that already exist, in the order of the series.
  { src: [-2, 1, 0], faces: "NESW" },
  { src: [-4, 1, 0], faces: "NESW" },
  { src: [-6, 1, 0], faces: "NESW" },
  { src: [-8, 1, 0], faces: "NESW" },
  { src: [-10, 1, 0], faces: "NESW" },
  { src: [-12, 1, 0], faces: "NESW" },
  { src: [-14, 1, 0], faces: "NESW" },
  { src: [-16, 1, 0], faces: "NESW" },
  { src: [-18, 1, 0], faces: "NESW" },
  { src: [-20, 1, 0], faces: "NESW" },
  { src: [-22, 1, 0], faces: "NESW" },
  { src: [-24, 1, 0], faces: "NESW" },
  { src: [-26, 1, 0], faces: "NESW" },
  { src: [-28, 1, 0], faces: "NESW" },
  { src: [-30, 1, 0], faces: "NESW" },
];

/** The 60 rooms still to build, kept as coordinates so the list is ready to fill. */
const PLANNED_ROOMS = [
  // 16 to 75 — uncomment one at a time as the rooms are built, with their real
  // coordinates in the same series as the fifteen above.
  // { src: [-32, 1, 0], faces: "NESW" },
  // { src: [-34, 1, 0], faces: "NESW" },
  // { src: [-36, 1, 0], faces: "NESW" },
  // { src: [-38, 1, 0], faces: "NESW" },
  // { src: [-40, 1, 0], faces: "NESW" },
  // { src: [-42, 1, 0], faces: "NESW" },
  // { src: [-44, 1, 0], faces: "NESW" },
  // { src: [-46, 1, 0], faces: "NESW" },
  // { src: [-48, 1, 0], faces: "NESW" },
  // { src: [-50, 1, 0], faces: "NESW" },
  // { src: [-52, 1, 0], faces: "NESW" },
  // { src: [-54, 1, 0], faces: "NESW" },
  // { src: [-56, 1, 0], faces: "NESW" },
  // { src: [-58, 1, 0], faces: "NESW" },
  // { src: [-60, 1, 0], faces: "NESW" },
  // { src: [-62, 1, 0], faces: "NESW" },
  // { src: [-64, 1, 0], faces: "NESW" },
  // { src: [-66, 1, 0], faces: "NESW" },
  // { src: [-68, 1, 0], faces: "NESW" },
  // { src: [-70, 1, 0], faces: "NESW" },
  // { src: [-72, 1, 0], faces: "NESW" },
  // { src: [-74, 1, 0], faces: "NESW" },
  // { src: [-76, 1, 0], faces: "NESW" },
  // { src: [-78, 1, 0], faces: "NESW" },
  // { src: [-80, 1, 0], faces: "NESW" },
  // { src: [-82, 1, 0], faces: "NESW" },
  // { src: [-84, 1, 0], faces: "NESW" },
  // { src: [-86, 1, 0], faces: "NESW" },
  // { src: [-88, 1, 0], faces: "NESW" },
  // { src: [-90, 1, 0], faces: "NESW" },
  // { src: [-92, 1, 0], faces: "NESW" },
  // { src: [-94, 1, 0], faces: "NESW" },
  // { src: [-96, 1, 0], faces: "NESW" },
  // { src: [-98, 1, 0], faces: "NESW" },
  // { src: [-100, 1, 0], faces: "NESW" },
  // { src: [-102, 1, 0], faces: "NESW" },
  // { src: [-104, 1, 0], faces: "NESW" },
  // { src: [-106, 1, 0], faces: "NESW" },
  // { src: [-108, 1, 0], faces: "NESW" },
  // { src: [-110, 1, 0], faces: "NESW" },
  // { src: [-112, 1, 0], faces: "NESW" },
  // { src: [-114, 1, 0], faces: "NESW" },
  // { src: [-116, 1, 0], faces: "NESW" },
  // { src: [-118, 1, 0], faces: "NESW" },
  // { src: [-120, 1, 0], faces: "NESW" },
  // { src: [-122, 1, 0], faces: "NESW" },
  // { src: [-124, 1, 0], faces: "NESW" },
  // { src: [-126, 1, 0], faces: "NESW" },
  // { src: [-128, 1, 0], faces: "NESW" },
  // { src: [-130, 1, 0], faces: "NESW" },
  // { src: [-132, 1, 0], faces: "NESW" },
  // { src: [-134, 1, 0], faces: "NESW" },
  // { src: [-136, 1, 0], faces: "NESW" },
  // { src: [-138, 1, 0], faces: "NESW" },
  // { src: [-140, 1, 0], faces: "NESW" },
  // { src: [-142, 1, 0], faces: "NESW" },
  // { src: [-144, 1, 0], faces: "NESW" },
  // { src: [-146, 1, 0], faces: "NESW" },
  // { src: [-148, 1, 0], faces: "NESW" },
  // { src: [-150, 1, 0], faces: "NESW" },
];

/**
 * Rooms that belong to **one** level only.
 *
 * Empty for now, on purpose: every difficulty uses `READY_ROOMS`. Adding rooms to
 * a single level — the only difference between two levels this engine supports —
 * is done here, and the extra rooms are drawn with the shared ones:
 *
 *     veryEasy: [{ src: [-152, 1, 0], faces: "NESW" }],
 *
 * A level that later needs the shared rooms *and* its own gets both, because a
 * level's list is its own rooms followed by the shared ones.
 */
globalThis.ROOM_TEMPLATES = globalThis.ROOM_TEMPLATES || {
  rooms: READY_ROOMS,
};

/**
 * Rooms of one level: the level's own, then the shared ones.
 *
 * Malformed entries are dropped with a log line rather than throwing: a typo in
 * one room must not take the whole level down, and a generator that throws inside
 * `tick` is a generator that stops the game.
 */
export function templatesFor(difficulty, log) {
  // Resolved at call time, not at load time: the table is a plain object on the
  // global scope, and a host that replaces it — the tests do — must be obeyed.
  const table = globalThis.ROOM_TEMPLATES;
  if (!table) return [];
  const own = Array.isArray(table[difficulty.id]) ? table[difficulty.id] : [];
  const shared = Array.isArray(table.rooms) ? table.rooms : [];
  return normalise(own.concat(shared), difficulty, log);
}

function normalise(raw, difficulty, log) {
  const list = [];
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    if (!entry || !Array.isArray(entry.src) || entry.src.length !== 3) {
      if (log) log(`room ${index} of ${difficulty.id} has no usable src [x, y, z]`);
      continue;
    }
    if (entry.src.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      if (log) log(`room ${index} of ${difficulty.id} has a non-numeric src`);
      continue;
    }
    list.push({
      // The index is the room's identity: no id, no name, nothing to keep in sync
      // with a hand-built zone.
      index: list.length,
      src: [Math.floor(entry.src[0]), Math.floor(entry.src[1]), Math.floor(entry.src[2])],
      faces: typeof entry.faces === "string" ? entry.faces.toUpperCase() : "",
      spawn: entry.spawn === true,
    });
  }
  return list;
}

/**
 * Which room a chunk of a level gets.
 *
 * Deliberately ignores the neighbours' faces: the choice is a pure function of the
 * chunk, so it can be recomputed at any time without remembering anything, and a
 * level that is rebuilt is rebuilt identically. Connectivity is then a property of
 * the room set — which is why mixing "NESW" halls with "NS" corridors is a design
 * choice, not a bug in the generator.
 */
export function templateFor(list, difficulty, chunkX, chunkZ) {
  if (list.length === 0) return null;
  // The entrance is the one chunk whose room is chosen rather than drawn: the
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
