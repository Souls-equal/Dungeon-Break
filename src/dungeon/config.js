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
  // 1 means 3x3 = 9 rooms, 96 blocks across: the player stands in the middle of a
  // full ring, so the edge of the built area is never in view. Every chunk of the
  // ring is probed on the tick the level starts, all at once.
  viewChunks: 1,

  // Ticks between a `getBlock` made in a far chunk and that chunk being ready.
  //
  // Measured in game: two ticks after the read, the chunk is there and accepts a
  // `copyChunk` into it. It replaces a fixed warm-up that guessed the same delay
  // for every chunk, and it is counted from the read the probe itself performs.
  chunkLoadTicks: 2,

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
  // that takes `chunkLoadTicks`. Not infinite either: a chunk that is truly not
  // loaded would otherwise cost one read per copy, for ever, and look like a
  // generator that does nothing.
  templateReadAttempts: 4,

  // **Nothing is ever written into a room.** A room is a hand-built chunk, and the
  // engine only ever copies it: no record block, no pad, no marker, no repair.
  //
  // This does not blind the engine, because a room carries its own record in its
  // **Bedrock**: the block every room has on its first and its last layer, floor
  // and ceiling, like the Nether. A chunk that reads `null` there is not sent yet,
  // and a chunk that reads Bedrock already holds a room — which is how the engine
  // recognises a room it copied in a previous session.
  solidBlock: "Bedrock",

  // Layers hosting that Bedrock, in chunk-local Y: the first and the last. The
  // probe tries the bottom one first and falls back to the top one for a room
  // built without its floor.
  probeLocalYs: [0, 31],

  // Block (x, z) inside the chunk, 0..31. One cell, not four.
  //
  // This is also the cell a room's Concrete pad occupies, and the cell the player is
  // put in while a level loads: the pad, the probe and that provisional spot are the
  // middle of the room, and a room whose centre reads Bedrock says "a room is here".
  probeLocalXZ: [16, 16],

  // ------------------------------------------------- destination placement ---
  // Each difficulty gets its own horizontal band of chunk layers, two chunks
  // apart vertically: layer -32, -34, -36... A room fills a whole chunk, so two
  // chunks of vertical gap can never overlap, and two difficulties can share
  // the same X/Z for ever without ever meeting — even after a player walks
  // 10 000 blocks. This is what removes the "two dungeons collide" class of bug
  // that a shared flat region cannot avoid.
  firstLayerChunkY: -32,
  layerStrideChunks: 2,

  // ------------------------------------------------------------ where it is ---
  // **Every entry draws a new place.** A level is built around a chunk coordinate
  // drawn at random in this square, so two players who start at the same moment are
  // a hundred thousand blocks apart, and a player who comes back does not find the
  // ruins of their previous run.
  //
  // In chunks: -3125..3124 is blocks -100 000..99 999. Half a chunk of margin is
  // enough — every chunk of the view is at least one chunk inside the square.
  spawnChunkMin: -3125,
  spawnChunkMax: 3124,

  // How far two entries of the same level are kept apart, in blocks. Each entry costs
  // one line in a map while its player is in the level, so this is a floor and not a
  // guarantee for a thousand players — but it is what makes "they will not meet"
  // true in practice, and it is checked before anything is copied.
  spawnSeparation: 20_000,

  // Draws tried to find a free square. After that, the level is built anyway: a
  // player waiting in the air is worse than two dungeons that are merely far apart.
  spawnDraws: 24,

  // How many ticks the entrance may wait for its floor before the player is sent
  // back to the lobby with a message.
  //
  // One is normally enough — the copy lands within the tick it is made — but the
  // destination has to have been sent first, and a player teleported into a chunk
  // that the server is still creating is a real case. Waiting is bounded and said
  // out loud, rather than retried for ever.
  entryMaxTicks: 4,

  // ---------------------------------------------------------------- landing --
  // Where a player lands in the entrance room, in chunk-local cells.
  //
  // **Random, and never twice in the same place.** A level hands out a different
  // column to every player who enters it, so two players who step on the same pad
  // do not appear on top of each other, and a player who re-enters does not come
  // back to where they were seen last.
  //
  // The area is bounded by `landingMargin`, which keeps the draw away from the
  // walls: the room's own walls fill the first and the last cell of the chunk, and a
  // position there is a position inside a wall. The engine then reads the column and
  // looks for a pair of empty cells anyway, so a wall or a pillar inside the margin
  // costs one more draw rather than a player stuck in stone.
  landingMargin: 4,
  landingDraws: 12,
  // Cells above the floor block that must be free. A body is two cells tall, and a
  // room may have a low ceiling: one free cell is not enough to stand up in.
  landingFreeCells: 2,
  // How far above the floor block the player is placed. Same value as the previous
  // engine, which was verified in game: the position is the body's centre, so the
  // feet sit on the block below.
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
