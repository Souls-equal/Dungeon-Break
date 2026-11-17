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

  // ------------------------------------------------------------ where it is ---
  // **Every entry draws a new place, in all three directions.** A dungeon is built
  // around a chunk coordinate drawn at random inside this cube, so two players who
  // start at the same moment are a hundred thousand blocks apart, and a player who
  // comes back does not find the ruins of their previous run.
  //
  // In chunks: -3125..3124 is blocks -100 000..99 999 horizontally. Vertically the
  // draw runs from block 1 000 to block 100 000 — the range the owner of the project
  // gave — which is chunks 32..3124: a level is never built at y = 0, where the
  // world of a game normally lives.
  spawnChunkMin: -3125,
  spawnChunkMax: 3124,
  spawnChunkYMin: 32,
  spawnChunkYMax: 3124,

  // How far two entries are kept apart, in blocks, in all three directions. Each
  // entry costs one line in a map while its player is in the dungeon, so this is a
  // floor and not a guarantee for thousands of players — but it is what makes "they
  // will not meet" true in practice, and it is checked before anything is copied.
  spawnSeparation: 20_000,

  // Draws tried to find a free spot. After that, the level is built anyway: a
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
  // Cells that must be free to stand in. A body is two cells tall, so the cell of the
  // position and the one above it: one free cell is not enough to stand up in.
  landingFreeCells: 2,
  // How far above the floor block the player is placed, added to every landing.
  //
  // The engine first used 2, which was measured for the previous engine and is 5 cells
  // short in this world: the player came out inside the floor every time. 7 is the
  // measured value plus the correction the owner reported, and the search below
  // (`landingSearchTries` / `landingSearchLift`) finishes the job from there — the
  // number is where the search starts, not where it stops.
  spawnAboveFloor: 7,

  // ---------------------------------------------------------- the landing search --
  // A landing is not taken on trust any more: it is **tested where the player will be**.
  //
  // The search starts on the middle cell of the drawn landing, then visits the ring of
  // cells around it, and asks the world one question: is this cell, and the one above
  // it, free? Those are the two cells a standing player occupies. Nothing is inferred
  // from the floor: the block the player will be in is read, and that is the answer.
  //
  // If no cell of the +0 level works, the search lifts the whole landing by one block
  // and tries again, `landingSearchLift` times. If every level is blocked, the landing
  // is drawn again — same chunk, another column — `landingSearchTries` times.
  landingSearchLift: 2,
  landingSearchTries: 3,

  // ---------------------------------------------------------------- refresh --
  // How many `getBlock` reads the floor probe is allowed when a level starts.
  // It walks one column upward from the bottom of the chunk to find the first
  // solid block, which is the floor the template was built with. 32 reads, once
  // per level, is the whole cost — and it removes a hand-written "floor height"
  // setting that would silently be wrong for one template out of ten.
  floorProbeMaxCells: 32,

  // ------------------------------------------------------------------- mobs ---
  // A level is a **series of rooms to clear**. The player lands in one, the four
  // rooms around it hold mobs, and a room with no mob left is *clear* — a fact
  // written into the room's own corner block with `setBlockData`, so a cleared room
  // stays cleared after a restart and is never spawned twice.
  //
  // **No block is written**: `setBlockData` stores data about an existing block, it
  // does not change it. That is the one exception to "nothing is written", and it is
  // the owner's own design: the record lives in the room, not in our memory.
  mobRoomsAround: [[1, 0], [-1, 0], [0, 1], [0, -1]],

  // The corner of the chunk that holds the record, in chunk-local coordinates, on the
  // room's own floor layer: `[0, 0, 0]` is the block just **above** the corner floor cell
  // — a cell of the room's air, which exists the moment the room does. Data is cleared
  // when the block changes, so a room copied over starts un-cleared; a room written for
  // the first time reads nothing at all.
  //
  // Above the floor rather than on the Bedrock: the Bedrock under a room is *replaced* by
  // every copy, which is the case where data is reliably lost. The air beside the player
  // is the one cell of a room nothing ever writes.
  mobClearCell: [0, 0, 0],

  // The bestiary is `MOB_ROSTER` below: a level draws among every type unlocked at or
  // before it. A type the game refuses — an unknown name, or a name it will not place —
  // is dropped for the session (see `refusedMobs` in the loader) rather than retried in
  // every room of every dungeon.

  // Cells of a room that are never used for a mob: the walls, as for the player.
  mobSpawnMargin: 2,
  // Cells tried per room before giving up on the rest of the count.
  mobSpawnTries: 40,
  // A room copied two ticks after the entrance still has to be populated, and a player
  // who stands still never "enters" a new room. So the room is re-read now and then:
  // once a room is done it is remembered, which makes the repeat nearly free.
  mobRetryTicks: 40,

  // ------------------------------------------------------------------ chests ---
  // A chest in a dungeon room drops a **Key**. The rarity is drawn per difficulty, so a
  // deep room is worth opening and a Very Easy one is not a shortcut to a Diamond Key.
  //
  // **Nothing is searched and nothing is predicted**: a room's chests are in its build, and
  // `onPlayerClick` names the block that was clicked. The only test is `block.includes("Chest")`.
  // Opening a chest replaces it with `Air` and drops the key at the middle of the block —
  // the emptied block is the whole memory of "already opened", and a room copied again
  // (a new entry, a new place) gets its chest back.
  //
  // There is therefore no setting here for where chests are, or how to find them.

  // -------------------------------------------------------------- discovery ---
  // A room is worth **aura** the first time a player stands in it: the game's XP is aura
  // (`applyAuraChange`), and a dungeon rewards exploring it, not just surviving it.
  //
  // Paid once per room **per run**, and the memory is the dungeon's, not the world's: a
  // room is discovered in the run that discovered it, and the next entry — a new place, a
  // new run — is a dungeon nobody has seen yet. That is a `Set` per level, dropped with
  // `release`, so nothing can grow past one dungeon.
  //
  // The aura is multiplied by the level's position in the ladder, so the same room is
  // worth more in Hell than in Very Easy — the same idea as the mobs.
  roomAura: 10,
  // A room whose chunk is not readable yet is not discovered: the player is standing in a
  // room the world has not sent, and paying for it would pay for a teleport.

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
 * lobby and inside a dungeon. A difficulty is **not** a height any more: every entry
 * draws its own layer along with its own x and z, so this table carries no layer and
 * adding a difficulty needs no second table.
 */
export const DIFFICULTIES = [
  { id: "veryEasy", label: "Very Easy", padBlock: "Lime Concrete", fromLobby: true },
  { id: "easy", label: "Easy", padBlock: "Light Blue Concrete", fromLobby: true },
  { id: "medium", label: "Medium", padBlock: "Yellow Concrete", fromLobby: true },
  { id: "normal", label: "Normal", padBlock: "Orange Concrete", fromLobby: false },
  { id: "hard", label: "Hard", padBlock: "Red Concrete", fromLobby: false },
  { id: "insane", label: "Insane", padBlock: "Purple Concrete", fromLobby: false },
  { id: "nightmare", label: "Nightmare", padBlock: "Gray Concrete", fromLobby: false },
  { id: "hell", label: "Hell", padBlock: "Black Concrete", fromLobby: false },
];

/*
 * The bestiary, in the order the levels unlock it.
 *
 * `from` is the level that **adds** the type: a level holds every type whose `from` is at
 * or below it, which is what makes Hell a mix of nine mobs and Very Easy a room of
 * ordinary zombies. `health`, `damage` and `speed` are the mob's **own** multipliers,
 * applied before the level's — the owner's table, where a Cave Golem is tougher than a
 * Zombie at the same difficulty, and a Skeleton is frailer than both.
 *
 * The names are the game's own type names, in the game's spelling. `Zombie` and `Skeleton`
 * are the plain mobs; the rest are cave and Nether breeds. A name the game does not accept
 * costs nothing permanent: it is retried, and dropped for the session as soon as it fails
 * where another type worked.
 */
export const MOB_ROSTER = [
  { type: "Zombie", from: "veryEasy" },
  { type: "Draugr Zombie", from: "easy", health: 1.15, damage: 1.2 },
  { type: "Skeleton", from: "easy", health: 0.7 },
  { type: "Draugr Skeleton", from: "medium", health: 0.8, damage: 1.2 },
  { type: "Cave Golem", from: "normal", health: 1.4, speed: 0.95 },
  { type: "Armour Collector", from: "hard", health: 2, damage: 1.75, speed: 0.95 },
  { type: "Furnace Knight", from: "insane", health: 2, damage: 2, speed: 0.95 },
  { type: "Lil Knight", from: "insane", health: 1.75, damage: 1.8, speed: 1.25 },
  { type: "Draugr Knight", from: "nightmare", damage: 2, speed: 1.6 },
  { type: "Scorpion", from: "hell", health: 1.75, damage: 1.6, speed: 1.15 },
];

/**
 * The mob types a level can draw, each with its own multipliers.
 *
 * A level gets every type whose `from` is at or below it in the ladder, so adding a breed
 * to the roster is the whole change — no table to keep in sync with the difficulty list.
 */
export function mobRosterFor(difficulty) {
  const rank = DIFFICULTIES.findIndex((entry) => entry.id === difficulty.id);
  const level = rank < 0 ? 0 : rank;
  return MOB_ROSTER
    .filter((mob) => DIFFICULTIES.findIndex((entry) => entry.id === mob.from) <= level)
    .map((mob) => ({
      type: mob.type,
      health: mob.health === undefined ? 1 : mob.health,
      damage: mob.damage === undefined ? 1 : mob.damage,
      speed: mob.speed === undefined ? 1 : mob.speed,
    }));
}

/*
 * What a dungeon chest can give, rarest last.
 *
 * `weight` is *not* a per-level number: it is the shape of the curve, and the level
 * decides how far along it the draw lands. A level's rarity is `chestRarity` (0 = a Very
 * Easy chest, 1 = a Hell chest), and each key's chance is
 *
 *     weight[level] × (1 - rarity) + weight[0] × rarity
 *
 * i.e. a blend of the Very Easy row and the Hell row. That keeps every key possible
 * everywhere — a Wooden Key at the bottom of Hell is a bad roll, not an impossibility —
 * while making the rare end commoner the deeper the level.
 */
export const CHEST_KEYS = [
  { key: "Wooden Key", label: "Wooden", rarity: "common", veryEasy: 60, hell: 8 },
  { key: "Stone Key", label: "Stone", rarity: "uncommon", veryEasy: 24, hell: 16 },
  { key: "Iron Key", label: "Iron", rarity: "rare", veryEasy: 10, hell: 22 },
  { key: "Gold Key", label: "Gold", rarity: "epic", veryEasy: 5, hell: 26 },
  { key: "Diamond Key", label: "Diamond", rarity: "legendary", veryEasy: 1, hell: 28 },
];

/**
 * The aura a level pays for discovering a room.
 *
 * From `roomAura` at Very Easy up to double it at Hell: a deeper dungeon is harder and its
 * rooms are worth more, which is the same shape as the mobs and the keys.
 */
export function roomAuraFor(difficulty) {
  const rank = DIFFICULTIES.findIndex((entry) => entry.id === difficulty.id);
  const level = rank < 0 ? 0 : rank;
  const steps = Math.max(1, DIFFICULTIES.length - 1);
  return Math.round(DUNGEON_CONFIG.roomAura * (1 + level / steps));
}

/**
 * The keys a level can give, with the weight each one has there.
 *
 * Weights are relative: the draw normalises them, so a level's row always sums below 100
 * and no rounding can ever make the last key impossible.
 */
export function chestKeysFor(difficulty) {
  const rank = DIFFICULTIES.findIndex((entry) => entry.id === difficulty.id);
  const steps = Math.max(1, DIFFICULTIES.length - 1);
  const rarity = (rank < 0 ? 0 : rank) / steps;
  return CHEST_KEYS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    rarity: entry.rarity,
    weight: entry.veryEasy * (1 - rarity) + entry.hell * rarity,
  }));
}

/**
 * How hard the mobs of each level are.
 *
 * One row per difficulty, applied to the **base** stats the game reports for the mob
 * type — never to a number written here, so a mob stays a mob: the multiplier is what
 * makes Hell's Draugr a different problem from Very Easy's. `count` is the number of
 * mobs a room holds.
 */
export const MOB_TUNING = {
  veryEasy: { count: 2, health: 1, damage: 1, speed: 1 },
  easy: { count: 2, health: 1.2, damage: 1.1, speed: 1.05 },
  medium: { count: 3, health: 1.5, damage: 1.25, speed: 1.1 },
  normal: { count: 3, health: 2, damage: 1.5, speed: 1.15 },
  hard: { count: 4, health: 2.5, damage: 1.75, speed: 1.2 },
  insane: { count: 4, health: 3, damage: 2, speed: 1.3 },
  nightmare: { count: 5, health: 4, damage: 2.5, speed: 1.4 },
  hell: { count: 5, health: 5, damage: 3, speed: 1.5 },
};

/** The mob settings of a difficulty: always defined, so nothing reads `undefined`. */
export function mobTuningFor(difficulty) {
  return MOB_TUNING[difficulty.id] || MOB_TUNING.veryEasy;
}

/** Gold cost to unlock each difficulty (Very Easy is free). Uses SMP gold currency cstm_smp_gold. */
export const UNLOCK_CURRENCY = "cstm_smp_gold";
export const UNLOCK_DB_KEY = "dungeonBreak.unlocks.v1";
export const DUNGEON_PRICES = {
  veryEasy: 0,
  easy: 100,
  medium: 500,
  normal: 5000,
  hard: 25000,
  insane: 100000,
  nightmare: 500000,
  hell: 1000000,
};
export function priceForDifficulty(difficulty) {
  const d = findDifficulty(difficulty);
  if (!d) return 0;
  return DUNGEON_PRICES[d.id] ?? 0;
}
export function formatGold(amount) {
  return `${amount.toLocaleString("en-US")} gold`;
}

/** Concrete blocks that are pads, spelled the way Bloxd reports them. */
const BLOCK_ALIASES = {
  "Grey Concrete": "Gray Concrete",
};

const BY_ID = {};
const BY_LABEL = {};
const BY_PAD_BLOCK = {};

DIFFICULTIES.forEach((difficulty, index) => {
  // Only the order, which the "next level" pad needs. Where the level is built is
  // drawn per entry and owned by the loader: nothing here can go stale.
  difficulty.index = index;
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

/** World Y of the bottom of a chunk layer. */
export function floorOfLayer(chunkY) {
  return chunkY * DUNGEON_CONFIG.chunkSize;
}

/**
 * Variation du donjon (custom games uniquement).
 * `default` = lobby/spawn, `dungeon` = dans le donjon.
 * Worlds n'ont pas de variations — l'appel échoue silencieusement.
 */
export const DUNGEON_VARIATION = "dungeon";
