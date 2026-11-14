/*
 * One file, one object: every number the generator uses lives here.
 *
 * The generation model is deliberately small enough to be read in one sitting:
 *
 *   a room   = one 32x32x32 Bloxd chunk, copied with a single `api.copyChunk`;
 *   a dungeon = a grid of rooms, generated chunk by chunk around the players;
 *   a door   = baked into the room templates, and matched face against face.
 *
 * Nothing here is a distance in "screens" or a guess: `chunkSize` is what Bloxd
 * copies, and the rest are counts of chunks or of ticks.
 */

export const DUNGEON_CONFIG = {
  // ------------------------------------------------------------------ grid ---
  // Bloxd chunks are 32 blocks a side, and `copyChunk` works on whole chunks.
  // Everything below counts in chunks; `chunkSize` is only used to convert a
  // player's position into a chunk coordinate.
  chunkSize: 32,

  // Chunks generated around each player, in every horizontal direction.
  // 2 means 5x5 = 25 rooms, 160 blocks across: big enough that a player never
  // sees the edge, small enough that a level costs 25 chunk copies in total.
  viewChunks: 2,

  // Ticks to wait after the player is teleported into an empty chunk, before the
  // entrance room is copied and the player is put on its floor.
  //
  // Measured on the previous engine, and kept as is: a chunk created by the read
  // that teleported the player does not accept writes for another tick or two, and
  // a copy inside that window is dropped. It is the only wait in the whole engine.
  chunkWarmupTicks: 3,

  // One chunk copied per tick, per level — a copy is one API call but writes
  // 32 768 blocks server-side, so it is never doubled. At 20 ticks per second, that
  // settles 20 rooms a second, far more than a player can outwalk.
  //
  // Ticks between two scans of the players' surroundings. A scan reads one block
  // per candidate chunk, so it is cheap, but scanning every tick would still be
  // 20 scans a second for nothing: a player moves one block per tick at most.
  scanTicks: 4,

  // Candidate chunks planned per scan. Bounded so one scan can never become a
  // long tick when a player arrives in an empty level.
  maxPlannedPerScan: 8,

  // Queue ceiling per level. A player who teleports far away re-queues their new
  // surroundings; the old entries are dropped rather than kept for a return trip
  // that may never happen, which is what kept the old queue growing.
  maxQueued: 96,

  // How many times a template whose source block reads `null` is tried again
  // before it is disabled for the session.
  //
  // Not one: a read of a far-away chunk is how the server is told to send it, and
  // that takes a tick or two. Not infinite either: a chunk that is truly not
  // loaded would otherwise cost one read per copy, for ever, and look like a
  // generator that does nothing.
  templateReadAttempts: 4,

  // **Nothing is ever written into a room.** A room is a hand-built chunk, and the
  // engine only ever copies it: no record block, no pad, no marker, no repair. The
  // single exception is the lobby, which belongs to the world rather than to a
  // dungeon, and where nothing is written either.
  //
  // The consequence is stated plainly rather than hidden: after a restart, or when
  // a player walks back to a room built in a previous session, the world cannot be
  // asked whether that room is there. The level therefore keeps its own memory of
  // what it copied, for the session, and `/dbg mem` reports it as unconfirmed.

  // ------------------------------------------------- destination placement ---
  // Each difficulty gets its own horizontal band of chunk layers, two chunks
  // apart vertically: layer -32, -34, -36... A room fills a whole chunk, so two
  // chunks of vertical gap can never overlap, and two difficulties can share
  // the same X/Z for ever without ever meeting — even after a player walks
  // 10 000 blocks. This is what removes the "two dungeons collide" class of bug
  // that a shared flat region cannot avoid.
  firstLayerChunkY: -32,
  layerStrideChunks: 2,

  // The dungeon starts at this chunk coordinate. Nothing else is built there.
  originChunkX: 0,
  originChunkZ: 0,

  // ---------------------------------------------------------------- landing --
  // Where the player lands in a room, in chunk-local cells: the middle of the
  // room, four cells south of its centre.
  //
  // The pad sits on the exact centre, so the landing cell cannot be the pad
  // itself — a player who materialises on a pad is sent to the next difficulty
  // before they have seen the room.
  landingLocalXZ: [16, 16],
  landingShiftZ: 4,
  // How far above the floor block the player is placed. Same value as the
  // previous engine, which was verified in game: a body is two blocks tall and
  // its position is its centre, so `floor + 2` puts the feet on the floor.
  spawnAboveFloor: 2,

  // ---------------------------------------------------------------- refresh --
  // How many `getBlock` reads the floor probe is allowed when a level starts.
  // It walks one column upward from the bottom of the chunk to find the first
  // solid block, which is the floor the template was built with. 32 reads, once
  // per level, is the whole cost — and it removes a hand-written "floor height"
  // setting that would silently be wrong for one template out of ten.
  floorProbeMaxCells: 32,

  // Chat message shown once when the catalogue has no template for a level.
  missingTemplatesMessage:
    "This level has no room templates yet. Fill ROOM_TEMPLATES in src/dungeon/templates.js.",
};

/*
 * The difficulty ladder. One table for the lobby pads, the in-dungeon pads and
 * the templates, so a level can never be reachable from one place and unknown
 * from another.
 *
 * `padBlock` is the Concrete block that leads *to* this difficulty, both in the
 * lobby and inside a dungeon. The layer is derived from the position in this
 * list, so adding a difficulty needs no second table.
 */
export const DIFFICULTIES = [
  { id: "veryEasy", label: "Very Easy", padBlock: "Lime Concrete", fromLobby: true },
  { id: "easy", label: "Easy", padBlock: "Light Blue Concrete", fromLobby: true },
  { id: "medium", label: "Medium", padBlock: "Yellow Concrete", fromLobby: true },
  { id: "normal", label: "Normal", padBlock: "Orange Concrete", fromLobby: false },
  { id: "hard", label: "Hard", padBlock: "Red Concrete", fromLobby: false },
  { id: "insane", label: "Insane", padBlock: "Purple Concrete", fromLobby: false },
  { id: "ultraInsane", label: "Ultra Insane", padBlock: "Gray Concrete", fromLobby: false },
  { id: "hell", label: "Hell", padBlock: "Black Concrete", fromLobby: false },
];

/** Concrete blocks that are pads, spelled the way Bloxd reports them. */
const BLOCK_ALIASES = {
  "Grey Concrete": "Gray Concrete",
};

const BY_ID = {};
const BY_LABEL = {};
const BY_PAD_BLOCK = {};

DIFFICULTIES.forEach((difficulty, index) => {
  // The layer is part of the difficulty, not a second lookup: two tables that
  // must agree are one table that will not.
  difficulty.index = index;
  difficulty.chunkY = DUNGEON_CONFIG.firstLayerChunkY - index * DUNGEON_CONFIG.layerStrideChunks;
  BY_ID[difficulty.id] = difficulty;
  BY_LABEL[difficulty.label.toLowerCase()] = difficulty;
  BY_PAD_BLOCK[difficulty.padBlock] = difficulty;
});

for (const [alias, canonical] of Object.entries(BLOCK_ALIASES)) {
  BY_PAD_BLOCK[alias] = BY_PAD_BLOCK[canonical];
}

/** A difficulty from its id, its label, or an object that already is one. */
export function findDifficulty(reference) {
  if (!reference) return null;
  if (typeof reference === "object") return reference.id ? BY_ID[reference.id] || null : null;
  const text = String(reference).trim();
  if (BY_ID[text]) return BY_ID[text];
  return BY_LABEL[text.toLowerCase()] || null;
}

/** The difficulty a pad block leads to, or null when the block is not a pad. */
export function difficultyForPadBlock(blockName) {
  return BY_PAD_BLOCK[blockName] || null;
}

/** The difficulty after this one, or null on the last one. */
export function nextDifficulty(reference) {
  const difficulty = findDifficulty(reference);
  if (!difficulty) return null;
  return DIFFICULTIES[difficulty.index + 1] || null;
}

/** Difficulties a lobby pad may offer. */
export function lobbyDifficulties() {
  return DIFFICULTIES.filter((entry) => entry.fromLobby);
}

/** World Y of the block layer that holds the first row of a level's rooms. */
export function floorOfLayer(difficulty) {
  return difficulty.chunkY * DUNGEON_CONFIG.chunkSize;
}
