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
  //
  // Scale: the dungeon was built at 1× and is now built at **3×** in every
  // direction, so a room is a hall rather than a closet and a passage is a
  // corridor two players can cross in. The multiplied values are exact
  // triples of the 1× ones (4→12, 11→33, 4→12, 3→9, 4→12), so the shape
  // families, the aspect ratios and the proportions between rooms are unchanged:
  // a ×3 dungeon is the ×1 dungeon built three times bigger, not a different
  // dungeon.
  //
  // Three values inside the openings block are **not** tripled, and each says
  // why next to it. Everything else in the file that is a distance scales.
  cellSize: 1,
  // How many cells one cell of the original 1× design is worth. The shapes and
  // the openings are written in proportions where they can be, and in `scale`
  // units where they cannot (§ `shapes.js`): bump this and the dungeon is built
  // bigger, not different.
  scale: 3,
  // Room dimensions in cells, exterior walls included.
  minWidth: 12,
  maxWidth: 33,
  minDepth: 12,
  maxDepth: 33,
  // Interior height: floor is at floorLevel, walls occupy 1..wallHeight, and a
  // ceiling sits on wallHeight + 1. 12 blocks of headroom: a 3-cell passage is a
  // tunnel, not a letterbox.
  wallHeight: 12,
  // Mean cells per room, used to derive dimensions from the room's own seed so
  // that shapes vary in size as well as in outline.
  areaSpread: 0.28,

  // ---------------------------------------------------------------- walls ---
  // Masonry between two neighbouring rooms, in cells. Two rooms facing each
  // other have their outer wall faces exactly `wallGap` cells apart, and the
  // shared joint is filled, never overwritten: a wall is never a single cell
  // that two rooms could claim.
  wallGap: 9,

  // ------------------------------------------------------------- openings ---
  // Passage width in cells. A uniform width is what lets any two openings meet:
  // a room with a 2-cell doorway could never connect to a room with a 1-cell
  // one. Three cells: the ×1 dungeon's single-file corridor, at the new scale.
  minPassageWidth: 3,
  maxPassageWidth: 3,
  // Passage height in cells, capped by wallHeight so a doorway never opens
  // through the ceiling. Not tripled: it is 3 of the 12 blocks of wall height,
  // which is the same doorway-to-wall proportion as 1 of 4 at ×1, and the
  // builder's own lintel rule is written against this number.
  passageHeight: 3,
  // Distance from a room corner to the nearest opening cell, at least.
  minCornerClearance: 3,
  // Cells between two openings on the same face, at least.
  minOpeningSpacing: 6,
  // Cells of walkable depth behind an opening, inside the room, at least. A
  // doorway that opens onto a wall would be useless.
  //
  // Deliberately still 1, not 3. The rule that matters is the one in
  // `validator.js` (\(clearance > minApproachDepth\)), i.e. clearance ≥ 2; at 3
  // it demands clearance ≥ 4, so the cell behind a doorway has to be four cells
  // from every hole in the shape, and **no shape family can host a doorway any
  // more**: the entrance itself fails (`ROOM_DISCONNECTED` six times out of six,
  // measured). Clearance 2 is a cell with at most two empty neighbours, and
  // `faceRuns` already refuses the two-empty case for the cell behind a
  // doorway, so the door is not narrower than the wall it pierces at any scale.
  minApproachDepth: 1,
  // Openings per room, by perimeter: one opening per this many contour cells.
  cellsPerOpening: 18,
  // Counts, not distances: a room still has two to five doors whatever its
  // size. Tripling them would turn every room into a hub.
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
  worldMargin: 24,

  // ----------------------------------------------------------- generation ---
  // Attempts per opening before it is considered blocked.
  maxGenerationAttempts: 6,
  // Hard radius, in cells, from the dungeon origin. Keeps the dungeon inside
  // the allocated region and inside the chunks a player can load.
  //
  // 1536 = 512 × 3. This one is a hard constraint of the world, not a taste:
  // rooms are nine times bigger, so the same number of rooms needs three times
  // the radius in every direction. If Bloxd's build area is smaller than that,
  // this is the number that has to win, and the room count that has to give.
  maxDungeonRadius: 1536,
  // How many existing openings the connector considers before creating a new
  // room. Bounded so the cost never depends on the dungeon size.
  reuseCandidateLimit: 12,
  // Longest explicit bridge, in cells beyond the minimum joint. A bridge is a
  // short carved corridor recorded as a connection with its own cells: it is
  // how loops and shortcuts appear without inventing a room.
  maxBridgeLength: 12,
  // Share of new rooms allowed to braid back to an existing room, so a dungeon
  // keeps dead ends as well as shortcuts.
  braidChance: 0.5,

  // --------------------------------------------------------- anticipation ---
  //
  // Distances scale with the rooms, and they have to: a room is now up to 33
  // cells across, so a threshold measured for an 11-cell room would fire at the
  // far wall instead of at the doorway. `priorityDepthWeight` stays 40 and so do
  // the three depth/backlog counts: the depth weight is a *tie-break* between
  // rooms at equal distance, not a length.
  // Blocks between a player and an opening that start the discovery.
  discoveryDistance: 90,
  // Blocks at which an opening is about to be crossed: highest priority.
  crossingDistance: 18,
  // Depth, in edges, of the graph prepared ahead of the player.
  anticipationDepth: 3,
  // Priority is distance + depth * weight; a lower value is served first.
  priorityDepthWeight: 40,
  // Rooms whose opening is closer than this to a player are never suspended.
  activeRoomDistance: 144,
  // Rooms further than this are suspended when the queues are backlogged.
  suspendDistance: 288,
  // Hard ceiling on how far ahead the graph may run, whatever the backlog.
  maxAnticipationDistance: 288,
  backlogThreshold: 60,

  // -------------------------------------------------------------- budgets ---
  maxRoomsPerCycle: 10,
  maxDiscoveryPerCycle: 40,
  maxGenerationPerCycle: 24,
  // Graph work is far cheaper than block writes, so it has its own, larger cap.
  maxOpsPerTick: 4000,
  // The budget bounds the cycle, not the individual room: construction is never
  // interrupted mid-room, so a cycle may overrun by at most one room.
  //
  // Tripled with the dungeon. It is a *throughput* budget, not a latency one:
  // at 1× a room was ~360 blocks and a tick wrote 800, so three rooms' worth, and
  // at 3× a room is ~20 000 blocks while a tick still writes 800 — the same tick,
  // the same work per tick, but now one building site instead of three. Below
  // ~200 the batches get so small that the eight-block verification stride
  // dominates, so this does not go down.
  maxBlocksPerTick: 2400,
  // One graph cycle every `cycleTicks`; positions are read every
  // `playerScanIntervalTicks` (twice a second is enough: reading every player at
  // every tick costs more than it brings).
  //
  // Construction is *not* on this clock any more: it runs every tick, on
  // `maxBlocksPerTick`. This value only paces discovery and generation, which
  // cost milliseconds rather than blocks. At 20 the graph advanced once per
  // second and the world waited on it; at 10 a dungeon is ready in 2.1 s instead
  // of 5.1 s, and a cycle costs 1.5 ms on average instead of 4.4 ms.
  cycleTicks: 10,
  playerScanIntervalTicks: 10,

  // ----------------------------------------------------------- construction --
  // Altitude of the walkable floor. Same value as the current generator, so the
  // new engine builds where the old one built.
  floorY: -1000,
  // Blocks written per batch, so a room is spread over several ticks instead of
  // freezing one. A batch is the *minimum* progress of a room in one tick, not a
  // cap on the tick: the budget below decides how much a tick writes, and a
  // batch of 80 against a budget of 800 made a median room take five passes —
  // five ticks of latency for no reason. The batch now follows the budget, which
  // is now 2400 blocks per tick, hence 720 per batch.
  blocksPerBatch: 720,

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
// `rooms` is a count and stays as it is: the difficulty ladder must keep the
// same number of rooms, or every measured difficulty shifts. `maxRadius` is a
// length, and every one of them is ×3 with the rooms: at the new size a room is
// nine times the area, so the same count needs the same factor in radius.
export const DIFFICULTIES = [
  { id: "veryEasy", label: "Very Easy", fromLobby: true, rooms: 10, maxRadius: 288 },
  { id: "easy", label: "Easy", fromLobby: true, rooms: 14, maxRadius: 384 },
  { id: "medium", label: "Medium", fromLobby: true, rooms: 18, maxRadius: 480 },
  { id: "normal", label: "Normal", fromLobby: false, rooms: 24, maxRadius: 600 },
  { id: "hard", label: "Hard", fromLobby: false, rooms: 30, maxRadius: 720 },
  { id: "insane", label: "Insane", fromLobby: false, rooms: 36, maxRadius: 840 },
  { id: "ultraInsane", label: "Ultra Insane", fromLobby: false, rooms: 42, maxRadius: 960 },
  { id: "hell", label: "Hell", fromLobby: false, rooms: 48, maxRadius: 1152 },
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
