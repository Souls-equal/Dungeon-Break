/*
 * Central configuration for the procedural dungeon engine.
 *
 * One file, one exported object: no numeric constant is allowed to live inside
 * the algorithms. Every value here is a design decision, so it is written down
 * next to the reason it has that value.
 *
 * Units: world cells (one cell is one block while cellSize is 1) and Bloxd
 * ticks (20 per second). Nothing in this engine uses milliseconds: Bloxd
 * exposes no timer API that we may rely on.
 */

export const DUNGEON_CONFIG = {
  // ---------------------------------------------------------------- schema --
  // Version of the persisted data layout. Bumped only when the stored shape
  // changes, and always paired with a migration in Persistence.
  schemaVersion: 1,

  // ------------------------------------------------------------ dimensions --
  cellSize: 1,
  // Room dimensions in cells, exterior walls included.
  minWidth: 4,
  maxWidth: 11,
  minDepth: 4,
  maxDepth: 11,
  // Interior height: floor is at floorLevel, walls occupy 1..wallHeight, and a
  // ceiling sits on wallHeight + 1.
  wallHeight: 4,
  // Mean cells per room, used to derive dimensions from the room's own seed so
  // that shapes vary in size as well as in outline.
  areaSpread: 0.28,

  // ---------------------------------------------------------------- walls ---
  // Masonry between two neighbouring rooms, in cells. Two rooms facing each
  // other have their outer wall faces exactly `wallGap` cells apart, and the
  // shared joint is filled, never overwritten: a wall is never a single cell
  // that two rooms could claim.
  wallGap: 3,

  // ------------------------------------------------------------- openings ---
  // Passage width in cells. One cell is enough for a player, and a uniform
  // width is what lets any two openings meet: a room with a 2-cell doorway
  // could never connect to a room with a 1-cell one.
  minPassageWidth: 1,
  maxPassageWidth: 1,
  // Passage height in cells, capped by wallHeight so a doorway never opens
  // through the ceiling.
  passageHeight: 3,
  // Distance from a room corner to the nearest opening cell, at least.
  minCornerClearance: 1,
  // Cells between two openings on the same face, at least.
  minOpeningSpacing: 2,
  // Cells of walkable depth behind an opening, inside the room, at least. A
  // doorway that opens onto a wall would be useless.
  minApproachDepth: 1,
  // Openings per room, by perimeter: one opening per this many contour cells.
  cellsPerOpening: 6,
  minOpenings: 2,
  maxOpenings: 5,

  // -------------------------------------------------------------- margins ---
  // Extra cells required between two rooms on top of their touching walls.
  // 0 means "the masonry is exactly the wall gap": rooms may be adjacent, which
  // is what a direct connection needs. Raising it pushes rooms apart and, by
  // construction, makes loops rarer; it can never close a passage, because
  // passages are carved explicitly.
  structureMargin: 0,
  // Margin around the whole dungeon, so rooms never touch the allocated
  // region border.
  worldMargin: 8,

  // ----------------------------------------------------------- generation ---
  // Attempts per opening before it is considered blocked.
  maxGenerationAttempts: 6,
  // Hard radius, in cells, from the dungeon origin. Keeps the dungeon inside
  // the allocated region and inside the chunks a player can load.
  maxDungeonRadius: 512,
  // How many existing openings the connector considers before creating a new
  // room. Bounded so the cost never depends on the dungeon size.
  reuseCandidateLimit: 12,
  // Longest explicit bridge, in cells beyond the minimum joint. A bridge is a
  // short carved corridor recorded as a connection with its own cells: it is
  // how loops and shortcuts appear without inventing a room.
  maxBridgeLength: 4,
  // Share of new rooms allowed to braid back to an existing room, so a dungeon
  // keeps dead ends as well as shortcuts.
  braidChance: 0.5,

  // --------------------------------------------------------- anticipation ---
  // Blocks between a player and an opening that start the discovery.
  discoveryDistance: 30,
  // Blocks at which an opening is about to be crossed: highest priority.
  crossingDistance: 6,
  // Depth, in edges, of the graph prepared ahead of the player.
  anticipationDepth: 3,
  // Priority is distance + depth * weight; a lower value is served first.
  priorityDepthWeight: 40,
  // Rooms whose opening is closer than this to a player are never suspended.
  activeRoomDistance: 48,
  // Rooms further than this are suspended when the queues are backlogged.
  suspendDistance: 96,
  // Hard ceiling on how far ahead the graph may run, whatever the backlog.
  maxAnticipationDistance: 96,
  backlogThreshold: 60,

  // -------------------------------------------------------------- budgets ---
  maxRoomsPerCycle: 10,
  maxDiscoveryPerCycle: 40,
  maxGenerationPerCycle: 24,
  // Graph work is far cheaper than block writes, so it has its own, larger cap.
  maxOpsPerTick: 4000,
  // The budget bounds the cycle, not the individual room: construction is never
  // interrupted mid-room, so a cycle may overrun by at most one room.
  maxBlocksPerTick: 800,
  // One cycle every `cycleTicks`; positions are read every
  // `playerScanIntervalTicks` (twice a second is enough: reading every player at
  // every tick costs more than it brings).
  cycleTicks: 20,
  playerScanIntervalTicks: 10,

  // ----------------------------------------------------------- construction --
  // Altitude of the walkable floor. Same value as the current generator, so the
  // new engine builds where the old one built.
  floorY: -1000,
  // Blocks written per batch, so a room is spread over several ticks instead of
  // freezing one.
  blocksPerBatch: 80,

  // ------------------------------------------------------------- permissions --
  // The world runs in `survivalAdventure`, so a player cannot break a block at
  // all: no lock is needed for the shell. The only permission ever granted is
  // the list of block types a player *may* mine, one type at a time
  // (`setCanChangeType`). Empty until ores exist — an empty list means "seal the
  // dungeon", which is exactly the intent today.
  breakableBlocks: [],

  // ----------------------------------------------------------- chunk safety --
  chunkWarmupTicks: 3,
  chunkSize: 32,

  // --------------------------------------------------------- persistence ---
  roomsPerShard: 32,
  openingsPerShard: 32,
  connectionsPerShard: 32,
  // Character budget per dungeon, measured before every write. The real limit
  // of a Bloxd DB value is not documented, so this stays configurable and
  // pessimistic.
  dbCharBudget: 200000,
  dirtyShardThreshold: 64,

  // ------------------------------------------------------------- rendering --
  // Blocks. Geometric names are documented Bloxd block names.
  floorBlock: "Stone Bricks",
  ceilingBlock: "Smooth Stone",
  wallBlocks: ["Stone", "Messy Stone", "Smooth Stone"],
  // Used to carve passages through the shared joint, so a doorway reads as a
  // doorway instead of a gap.
  lintelBlock: "Stone Bricks",

  // --------------------------------------------------------------- growth ---
  // Weight of each opening when the generator sorts what to develop next.
  // Implemented in Discovery; listed here so tuning has a single home.
  branchBias: 0.65,
};

/** Ordered difficulties. One table for the lobby, the pads and the generator. */
export const DIFFICULTIES = [
  { id: "veryEasy", label: "Very Easy", fromLobby: true, rooms: 10, maxRadius: 96 },
  { id: "easy", label: "Easy", fromLobby: true, rooms: 14, maxRadius: 128 },
  { id: "medium", label: "Medium", fromLobby: true, rooms: 18, maxRadius: 160 },
  { id: "normal", label: "Normal", fromLobby: false, rooms: 24, maxRadius: 200 },
  { id: "hard", label: "Hard", fromLobby: false, rooms: 30, maxRadius: 240 },
  { id: "insane", label: "Insane", fromLobby: false, rooms: 36, maxRadius: 280 },
  { id: "ultraInsane", label: "Ultra Insane", fromLobby: false, rooms: 42, maxRadius: 320 },
  { id: "hell", label: "Hell", fromLobby: false, rooms: 48, maxRadius: 384 },
];

const DIFFICULTY_BY_LABEL = {};
const DIFFICULTY_BY_ID = {};
for (let index = 0; index < DIFFICULTIES.length; index += 1) {
  DIFFICULTY_BY_LABEL[DIFFICULTIES[index].label] = DIFFICULTIES[index];
  DIFFICULTY_BY_ID[DIFFICULTIES[index].id] = DIFFICULTIES[index];
}

export function findDifficulty(label) {
  return DIFFICULTY_BY_LABEL[label] || null;
}

export function findDifficultyById(id) {
  return DIFFICULTY_BY_ID[id] || null;
}

/** The difficulty a pad found in this dungeon leads to, or null for the last. */
export function nextDifficulty(label) {
  const found = findDifficulty(label);
  if (!found) return null;
  for (let index = 0; index < DIFFICULTIES.length - 1; index += 1) {
    if (DIFFICULTIES[index].id === found.id) return DIFFICULTIES[index + 1];
  }
  return null;
}

/** Difficulties a lobby pad may offer. */
export function lobbyDifficulties() {
  return DIFFICULTIES.filter((entry) => entry.fromLobby);
}
