import { setInterval as scheduleInterval } from "../utils/scheduler.js";

const DUNGEON_CONFIG = {
  minCoordinate: -50000,
  maxCoordinate: 50000,
  floorY: -1000,
  // Every room is 7x7 and walled on all four sides. Neighbouring rooms are
  // separated by exactly one free cell, which becomes their connection
  // corridor. Both rooms own a centred 3-wide door on that side, so the shape
  // of a module is nothing more than the set of doors it carries.
  roomSize: 7,
  roomGap: 1,
  wallHeight: 3,
  doorWidth: 3,
  // Staying under the engine budget keeps a floor pass and its audit in
  // separate ticks, so a tick never writes a whole room at once.
  blocksPerTick: 80,
  progressCheckTicks: 10,
  // A chunk is 32 blocks wide and the player only loads the chunks around
  // them. The spawn pad is laid first and checked again after the teleport,
  // because writes into a chunk the server has not loaded yet can be lost.
  spawnPadRadius: 1,
  // A wider patch is floored before the teleport, so the player can walk to the
  // box walls without stepping over a hole that is not built yet.
  landingPadRadius: 2,
  spawnCheckTicks: 5,
  spawnCheckAttempts: 6,
  entranceLandingDepth: 2,
  // Nothing is generated further than this from the player, so every write
  // lands in a chunk their client has already loaded.
  generationRadius: 60,
  // The player is boxed in while the first room is built, so they cannot walk
  // out of the loaded chunks before the floor exists. The walls are cleared
  // once the level is walkable, and the depth matches the 3-wide doors.
  boxWallOffset: 2,
  boxWallHeight: 3,
  // Streamed rooms stay at least this many blocks ahead of the player.
  streamBufferDistance: 36,
  streamingRunway: 50000,
  extraPassageChance: 0.14,
  blockName: "Stone Bricks",
  stairBlockNames: ["Stone Bricks", "Stone Brick Stairs"],
  wallBlockNames: [
    "Stone",
    "Messy Stone",
    "Smooth Stone",
    "Stone Bricks",
    "Cracked Stone Bricks",
    "Mossy Stone Bricks",
  ],
  // Rock deliberately avoids Stone Bricks: the walkable floor stays readable
  // at a glance, and a floor tile is always the floor material.
  rockBlockNames: ["Stone", "Messy Stone", "Smooth Stone"],
  // Rocky footprint in rooms, by difficulty.
  footprintByDifficulty: {
    "Very Easy": 4,
    Easy: 5,
    Medium: 5,
    Normal: 6,
    Hard: 7,
    Insane: 8,
    "Ultra Insane": 9,
    Hell: 10,
  },
  // Rooms carved into that footprint; the rest stays rock.
  roomsByDifficulty: {
    "Very Easy": 8,
    Easy: 12,
    Medium: 16,
    Normal: 22,
    Hard: 28,
    Insane: 34,
    "Ultra Insane": 40,
    Hell: 48,
  },
};

const SIDE_ORDER = ["north", "east", "south", "west"];
const OPPOSITE_SIDE = { north: "south", south: "north", east: "west", west: "east" };
const SIDE_VECTOR = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

// A module is defined by its doors; the label is what the player sees.
const MODULE_TYPES = {
  END: { id: "end", label: "Salle à une entrée" },
  CORRIDOR: { id: "corridor", label: "Couloir" },
  TURN: { id: "turn", label: "Virage" },
  T_JUNCTION: { id: "tJunction", label: "Chemin à 3 directions" },
  CROSSROADS: { id: "crossroads", label: "Chemin vers les 4 directions" },
  STAIRS: { id: "stairs", label: "Escalier" },
};

export const MODULE_TYPE_IDS = Object.keys(MODULE_TYPES).map((key) => MODULE_TYPES[key].id);

const RANDOM_MODULUS = 2147483647;
// Two consecutive rooms are always separated by one corridor cell, so the next
// streamed room starts two cells after the previous one ends.
const ROOM_CONNECTION_GAP = 1;
// Bloxd chunks are 32 blocks wide.
const CHUNK_SIZE = 32;
// Step height of each band of a staircase room, measured from the room floor.
// Both ends stay at floor level so the doors line up with their corridors, and
// every step is exactly one block high, which the player can walk both ways.
const STAIR_PROFILE = [0, 0, 1, 2, 2, 1, 0];
let dungeonSequence = 0;

function makeRandom(seed) {
  let state = seed % RANDOM_MODULUS;
  if (state <= 0) state += RANDOM_MODULUS - 1;
  // Small or consecutive seeds start with strongly correlated values, so the
  // state is warmed up before it is used.
  for (let warmUp = 0; warmUp < 8; warmUp += 1) state = (state * 48271) % RANDOM_MODULUS;

  return () => {
    state = (state * 48271) % RANDOM_MODULUS;
    return state / RANDOM_MODULUS;
  };
}

function randomInteger(random, min, max) {
  const scaled = random() * (max - min + 1);
  return min + (scaled - (scaled % 1));
}

function pick(random, values) {
  return values[randomInteger(random, 0, values.length - 1)];
}

function randomWallBlock(random) {
  return DUNGEON_CONFIG.wallBlockNames[
    randomInteger(random, 0, DUNGEON_CONFIG.wallBlockNames.length - 1)
  ];
}

function randomRockBlock(random) {
  return DUNGEON_CONFIG.rockBlockNames[
    randomInteger(random, 0, DUNGEON_CONFIG.rockBlockNames.length - 1)
  ];
}

function doorHalfWidth() {
  return (DUNGEON_CONFIG.doorWidth - 1) / 2;
}

function roomStride() {
  return DUNGEON_CONFIG.roomSize + DUNGEON_CONFIG.roomGap;
}

function roomCenterX(room) {
  return room.x + (room.width - 1) / 2;
}

function roomCenterZ(room) {
  return room.z + (room.depth - 1) / 2;
}

function openSides(ports) {
  return SIDE_ORDER.filter((side) => ports[side] === true);
}

function countPorts(ports) {
  return openSides(ports).length;
}

function isStraightPair(sides) {
  return (sides.indexOf("north") !== -1 && sides.indexOf("south") !== -1)
    || (sides.indexOf("east") !== -1 && sides.indexOf("west") !== -1);
}

/** The shape of a module is exactly the set of doors it opens on. */
export function moduleTypeForSides(sides) {
  if (sides.length <= 1) return MODULE_TYPES.END;
  if (sides.length === 2) return isStraightPair(sides) ? MODULE_TYPES.CORRIDOR : MODULE_TYPES.TURN;
  if (sides.length === 3) return MODULE_TYPES.T_JUNCTION;
  return MODULE_TYPES.CROSSROADS;
}

function addRect(rects, x1, y1, z1, x2, y2, z2) {
  if (x1 > x2 || y1 > y2 || z1 > z2) return;
  rects.push({ from: [x1, y1, z1], to: [x2, y2, z2] });
}

// ------------------------------------------------------------------ layout --

/**
 * Randomized spanning tree over the module grid, then a few braided passages.
 * Every connection is stored once, so both rooms always agree on a shared door.
 */
function makeConnections(cellCount, cells, cellsSet, random) {
  const visited = new Set();
  const eastOpen = new Set();
  const southOpen = new Set();
  const start = cells[0];
  const stack = [start];
  visited.add(start);

  const connect = (from, to) => {
    const delta = to - from;
    if (delta === 1) eastOpen.add(from);
    else if (delta === -1) eastOpen.add(to);
    else if (delta === cellCount) southOpen.add(from);
    else southOpen.add(to);
  };

  // Depth-first spanning tree, strictly inside the carved cells: every room is
  // reachable and no connection ever points at solid rock.
  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const candidates = gridNeighbourIndexes(cellCount, current)
      .filter((cell) => cellsSet.has(cell) && !visited.has(cell));

    if (candidates.length === 0) {
      stack.pop();
      continue;
    }

    const next = pick(random, candidates);
    connect(current, next);
    visited.add(next);
    stack.push(next);
  }

  // A few braided passages so big dungeons keep loops and junctions.
  for (const cell of cells) {
    const row = Math.floor(cell / cellCount);
    const column = cell % cellCount;
    if (column + 1 < cellCount && cellsSet.has(cell + 1)
      && !eastOpen.has(cell) && random() < DUNGEON_CONFIG.extraPassageChance) {
      eastOpen.add(cell);
    }
    if (row + 1 < cellCount && cellsSet.has(cell + cellCount)
      && !southOpen.has(cell) && random() < DUNGEON_CONFIG.extraPassageChance) {
      southOpen.add(cell);
    }
  }

  return { eastOpen, southOpen };
}

function portsFor(index, cellCount, connections) {
  const column = index % cellCount;
  const row = (index - column) / cellCount;
  return {
    north: row > 0 && connections.southOpen.has(index - cellCount),
    east: column + 1 < cellCount && connections.eastOpen.has(index),
    south: row + 1 < cellCount && connections.southOpen.has(index),
    west: column > 0 && connections.eastOpen.has(index - 1),
  };
}

function gridNeighbourIndexes(cellCount, index) {
  const row = Math.floor(index / cellCount);
  const column = index % cellCount;
  const list = [];
  if (row > 0) list.push(index - cellCount);
  if (row + 1 < cellCount) list.push(index + cellCount);
  if (column > 0) list.push(index - 1);
  if (column + 1 < cellCount) list.push(index + 1);
  return list;
}

/**
 * Carves the rooms out of the rocky footprint by growing the set from the
 * entrance, which keeps it connected by construction. Growth is mostly random
 * with a bias for extending the last added room, so dungeons get corridors and
 * lobes instead of a perfect square.
 */
/**
 * The entrance sits at the middle of the footprint, so the whole level fits in
 * the chunks the player loads around their landing: nothing is ever written
 * more than `generationRadius` blocks away.
 */
function middleCellIndex(cellCount, random) {
  const middle = Math.floor(cellCount / 2);
  const candidates = [
    middle * cellCount + middle,
    middle * cellCount + middle - 1,
    (middle - 1) * cellCount + middle,
    (middle - 1) * cellCount + middle - 1,
  ].filter((index) => index >= 0 && index < cellCount * cellCount);
  return randomInteger(random, 0, 1) === 0 ? candidates[0] : (candidates[1] ?? candidates[0]);
}

function pickRoomCells(cellCount, targetCount, originIndex, random) {
  const chosen = new Set([originIndex]);
  const frontier = gridNeighbourIndexes(cellCount, originIndex).slice();
  let lastAdded = originIndex;

  while (chosen.size < targetCount && frontier.length > 0) {
    let index = null;
    const extensions = gridNeighbourIndexes(cellCount, lastAdded).filter((cell) => !chosen.has(cell));

    if (extensions.length > 0 && random() < 0.4) {
      index = pick(random, extensions);
      const at = frontier.indexOf(index);
      if (at !== -1) frontier.splice(at, 1);
    } else {
      const at = randomInteger(random, 0, frontier.length - 1);
      index = frontier[at];
      frontier.splice(at, 1);
    }
    if (chosen.has(index)) continue;

    chosen.add(index);
    lastAdded = index;
    for (const neighbour of gridNeighbourIndexes(cellCount, index)) {
      if (!chosen.has(neighbour) && frontier.indexOf(neighbour) === -1) frontier.push(neighbour);
    }
  }
  return chosen;
}

function makeRoom(index, row, column, x, z, floorY, ports, width, depth) {
  const room = {
    index,
    row,
    column,
    x,
    z,
    width,
    depth,
    floorY,
    ports,
    type: moduleTypeForSides(openSides(ports)),
    stairKind: null,
    stairDirection: null,
  };
  room.floorRects = roomFloorRects(room);
  return room;
}

/** Interior floor plus the corridor cells the room itself owns. */
function roomFloorRects(room) {
  const floorY = room.floorY;
  const half = doorHalfWidth();
  const minX = room.x;
  const maxX = room.x + room.width - 1;
  const minZ = room.z;
  const maxZ = room.z + room.depth - 1;
  const centerX = roomCenterX(room);
  const centerZ = roomCenterZ(room);
  const rects = [];

  addRect(rects, minX, floorY, minZ, maxX, floorY, maxZ);
  // Corridors are owned by the room standing before them (east/south), so a
  // shared corridor is floored exactly once and never left with a hole.
  if (room.ports.east) addRect(rects, maxX + 1, floorY, centerZ - half, maxX + 1, floorY, centerZ + half);
  if (room.ports.south) addRect(rects, centerX - half, floorY, maxZ + 1, centerX + half, floorY, maxZ + 1);

  return rects;
}

// ------------------------------------------------------------------ stairs --

function stairRunsAlongZ(room) {
  return room.stairDirection === "north" || room.stairDirection === "south";
}

/** A staircase keeps both doors at floor level on the axis of its two doors. */
function canHostStairs(room) {
  // The entrance room hosts the spawn box, so it must stay flat under the player.
  if (room.isEntrance) return false;
  const sides = openSides(room.ports);
  if (sides.length !== 2 || !isStraightPair(sides)) return false;
  return room.width === STAIR_PROFILE.length && room.depth === STAIR_PROFILE.length;
}

function stairBlocks(room, random) {
  const blocks = [];
  if (!room.stairKind) return blocks;

  const bottomY = room.floorY + 1;
  const half = doorHalfWidth();
  const centerX = roomCenterX(room);
  const centerZ = roomCenterZ(room);
  const alongZ = stairRunsAlongZ(room);
  const span = STAIR_PROFILE.length;

  for (let band = 0; band < span; band += 1) {
    const height = STAIR_PROFILE[band];
    if (height === 0) continue;
    // Only the 3-wide walking lane is raised; the sides stay as open ledges.
    const x1 = alongZ ? centerX - half : room.x + band;
    const x2 = alongZ ? centerX + half : room.x + band;
    const z1 = alongZ ? room.z + band : centerZ - half;
    const z2 = alongZ ? room.z + band : centerZ + half;

    for (let x = x1; x <= x2; x += 1) {
      for (let z = z1; z <= z2; z += 1) {
        for (let y = bottomY; y <= room.floorY + height; y += 1) {
          blocks.push({ x, y, z, blockName: pick(random, DUNGEON_CONFIG.stairBlockNames) });
        }
      }
    }
  }
  return blocks;
}

/** Stairs spell out how deep the level goes, so the message says it too. */
function stairLabel(room) {
  return room.stairKind === "descending" ? "Escalier descendant" : "Escalier montant";
}

// ------------------------------------------------------------------- build --

/**
 * The way out always starts from the deepest row that still has a room, so the
 * streamed rooms continue the level instead of opening a hole in its middle.
 */
function chooseExitPort(rooms, byIndex, cellCount) {
  let best = null;
  for (const room of rooms) {
    if (!best || room.row > best.row) best = room;
    else if (room.row === best.row && roomCenterX(room) < roomCenterX(best)) best = room;
  }
  const candidate = best || rooms[rooms.length - 1];
  // Prefer a room that is not already crowded with doors.
  let exitRoom = candidate;
  for (const room of rooms) {
    if (room.row !== candidate.row) continue;
    if (countPorts(room.ports) < countPorts(exitRoom.ports)) exitRoom = room;
  }
  exitRoom.ports.south = true;
  exitRoom.type = moduleTypeForSides(openSides(exitRoom.ports));
  // The new door carves a corridor, so the room must re-own its floor: without
  // this the exit lane stays a rock row and the streamed rooms are cut off.
  exitRoom.floorRects = roomFloorRects(exitRoom);
  void byIndex;
  void cellCount;
  return exitRoom;
}

function makeDungeonLevel(seed, difficulty) {
  const cellCount = DUNGEON_CONFIG.footprintByDifficulty[difficulty]
    || DUNGEON_CONFIG.footprintByDifficulty.Normal;
  const targetRooms = DUNGEON_CONFIG.roomsByDifficulty[difficulty]
    || DUNGEON_CONFIG.roomsByDifficulty.Normal;
  const random = makeRandom(seed);
  const stride = roomStride();
  const width = cellCount * stride + 1;
  const maxOriginX = DUNGEON_CONFIG.maxCoordinate - width - DUNGEON_CONFIG.roomSize;
  const maxOriginZ = DUNGEON_CONFIG.maxCoordinate - width - DUNGEON_CONFIG.streamingRunway - 2;
  const originX = randomInteger(random, DUNGEON_CONFIG.minCoordinate, maxOriginX);
  const originZ = randomInteger(
    random,
    DUNGEON_CONFIG.minCoordinate + DUNGEON_CONFIG.entranceLandingDepth,
    maxOriginZ,
  );
  const floorY = DUNGEON_CONFIG.floorY;
  const entranceIndex = middleCellIndex(cellCount, random);
  const chosen = pickRoomCells(cellCount, targetRooms, entranceIndex, random);
  const cellList = Array.from(chosen).sort((a, b) => a - b);
  const connections = makeConnections(cellCount, cellList, chosen, random);
  const rooms = [];
  const byIndex = {};

  for (let row = 0; row < cellCount; row += 1) {
    for (let column = 0; column < cellCount; column += 1) {
      const index = row * cellCount + column;
      if (!chosen.has(index)) continue;
      const room = makeRoom(
        index,
        row,
        column,
        originX + 1 + column * stride,
        originZ + 1 + row * stride,
        floorY,
        portsFor(index, cellCount, connections),
        DUNGEON_CONFIG.roomSize,
        DUNGEON_CONFIG.roomSize,
      );
      rooms.push(room);
      byIndex[index] = room;
    }
  }

  const bestExitRoom = chooseExitPort(rooms, byIndex, cellCount);

  // The spawn room must never be a dead end: its north side is the landing and
  // its south side is the way out of the first chamber. Doors are only added,
  // never removed, so a neighbour already connected here keeps its own door.
  const entranceRoom = byIndex[entranceIndex];
  entranceRoom.isEntrance = true;
  entranceRoom.ports.north = true;
  entranceRoom.ports.south = true;
  entranceRoom.type = moduleTypeForSides(openSides(entranceRoom.ports));
  entranceRoom.label = entranceRoom.type.label;
  entranceRoom.floorRects = roomFloorRects(entranceRoom);
  // The landing in front of the north door is walked on, so it is floored too,
  // but only where that cell is not already owned by another room's corridor:
  // a tile is floored exactly once.
  const ownedTiles = new Set();
  for (const room of rooms) {
    for (const rect of room.floorRects) {
      for (let x = rect.from[0]; x <= rect.to[0]; x += 1) {
        for (let z = rect.from[2]; z <= rect.to[2]; z += 1) ownedTiles.add(`${x},${z}`);
      }
    }
  }
  const landingHalf = doorHalfWidth();
  const landingCenterX = roomCenterX(entranceRoom);
  for (let x = landingCenterX - landingHalf; x <= landingCenterX + landingHalf; x += 1) {
    for (let z = entranceRoom.z - DUNGEON_CONFIG.entranceLandingDepth; z < entranceRoom.z; z += 1) {
      if (ownedTiles.has(`${x},${z}`)) continue;
      ownedTiles.add(`${x},${z}`);
      addRect(entranceRoom.floorRects, x, floorY, z, x, floorY, z);
    }
  }
  byIndex[entranceIndex] = entranceRoom;

  const openCells = new Set();
  for (const room of rooms) {
    for (let x = room.x; x < room.x + room.width; x += 1) {
      for (let z = room.z; z < room.z + room.depth; z += 1) openCells.add(`${x},${z}`);
    }
    for (const rect of room.floorRects) {
      for (let x = rect.from[0]; x <= rect.to[0]; x += 1) {
        for (let z = rect.from[2]; z <= rect.to[2]; z += 1) openCells.add(`${x},${z}`);
      }
    }
  }
  const level = {
    seed,
    originX,
    originZ,
    width,
    cellCount,
    entranceIndex,
    entranceRoom: byIndex[entranceIndex],
    floorY,
    rooms,
    rockCells: new Set(),
    stairCount: 0,
    roomAt: (row, column) => byIndex[row * cellCount + column] || null,
    roomCount: rooms.length,
    passageCount: rooms.reduce(
      (total, room) => total + Number(room.ports.east) + Number(room.ports.south),
      0,
    ),
  };
  // Solid rock fills every cell the player can never reach, and closes the
  // footprint so the level reads as a set of chambers carved in stone. It hugs
  // the rooms that were actually kept: rock past the deepest room would bury
  // the streamed rooms that continue the route beyond the exit.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const room of rooms) {
    minX = Math.min(minX, room.x);
    maxX = Math.max(maxX, room.x + room.width - 1);
    minZ = Math.min(minZ, room.z);
    maxZ = Math.max(maxZ, room.z + room.depth - 1);
  }
  minX = Math.min(minX, originX + 1);
  minZ = Math.min(minZ, originZ + 1);
  for (let x = minX - 1; x <= maxX + 1; x += 1) {
    for (let z = minZ - 1; z <= maxZ + 1; z += 1) {
      const key = `${x},${z}`;
      if (!openCells.has(key)) level.rockCells.add(key);
    }
  }
  // The landing in front of the entrance stays open.
  const startRoom = byIndex[entranceIndex];
  for (let z = startRoom.z - DUNGEON_CONFIG.entranceLandingDepth; z < startRoom.z; z += 1) {
    for (let x = roomCenterX(startRoom) - doorHalfWidth(); x <= roomCenterX(startRoom) + doorHalfWidth(); x += 1) {
      level.rockCells.delete(`${x},${z}`);
    }
  }
  // Rock hugs the rooms that were kept, so it must never reach the row just
  // after the deepest room: that row is the exit corridor, and the streamed
  // rooms continue right behind it.
  const deepestRow = Math.max(...rooms.map((room) => room.z + room.depth - 1));
  for (let x = minX - 1; x <= maxX + 1; x += 1) {
    for (let z = deepestRow + 1; z <= maxZ + 1; z += 1) level.rockCells.delete(`${x},${z}`);
  }

  level.spawnPosition = [roomCenterX(startRoom) + 0.5, floorY + 1, roomCenterZ(startRoom) + 0.5];
  level.entrance = { centerX: roomCenterX(startRoom), floorY, z: startRoom.z };
  level.exit = {
    room: bestExitRoom,
    side: "south",
    centerX: roomCenterX(bestExitRoom),
    z: bestExitRoom.z + bestExitRoom.depth - 1,
    corridorZ: bestExitRoom.z + bestExitRoom.depth,
  };
  // The exit corridor is carved out of the rock that closes the footprint.
  for (let x = level.exit.centerX - doorHalfWidth(); x <= level.exit.centerX + doorHalfWidth(); x += 1) {
    level.rockCells.delete(`${x},${level.exit.corridorZ}`);
  }
  return level;
}

function placeStaircasesIn(level, seed) {
  const random = makeRandom((seed + 7717) % RANDOM_MODULUS || 1);
  const used = new Set();

  const candidates = level.rooms.filter(canHostStairs);
  for (const room of candidates) {
    if (random() > 0.4 || used.has(room.index)) continue;
    room.stairKind = random() < 0.5 ? "descending" : "ascending";
    room.stairDirection = pick(random, openSides(room.ports));
    room.type = MODULE_TYPES.STAIRS;
    room.label = stairLabel(room);
    level.stairCount += 1;
    // One room of clearance so two staircases never share a corridor.
    for (const side of SIDE_ORDER) {
      const [dx, dz] = SIDE_VECTOR[side];
      const neighbour = level.roomAt(room.row + dz, room.column + dx);
      if (neighbour) used.add(neighbour.index);
    }
  }
}

/** Where the endless streamed rooms start, aligned with the exit door. */
function exitFrontier(level) {
  return {
    centerX: level.exit.centerX,
    floorY: level.floorY,
    z: level.exit.corridorZ,
    nextRoomZ: level.exit.corridorZ + 1,
  };
}

function decorateLevelTypes(level) {
  for (const room of level.rooms) {
    if (!room.label) room.label = room.type.label;
  }
}

// The plan is pure so tests can verify doors, floor coverage and bounds.
export function createDungeonPlan(seed, difficulty) {
  const level = makeDungeonLevel(seed, difficulty);
  placeStaircasesIn(level, seed);
  decorateLevelTypes(level);
  return { seed, level, frontier: exitFrontier(level) };
}

// ------------------------------------------------------- streamed modules --

/**
 * Rooms generated further along the route. `entry` is the route axis seen from
 * the new room (the side facing the previous room), and `mode` is either
 * "through" (route continues) or "end" (the route stops here).
 */
function streamedPorts(entry, mode) {
  const ports = { north: false, east: false, south: false, west: false };
  const entrySides = Array.isArray(entry) ? entry : [entry];
  for (const side of entrySides) ports[side] = true;
  if (mode !== "through") return ports;

  if (entrySides.length > 1) {
    // Rejoining a previous module: keep going on the opposite axis.
    const [first] = entrySides;
    ports[OPPOSITE_SIDE[first]] = true;
    return ports;
  }

  ports[OPPOSITE_SIDE[entrySides[0]]] = true;
  return ports;
}

/**
 * Rooms generated further along the route. The entry door always faces the
 * previous room, and the exit door is chosen among the other sides, so the
 * stream keeps producing turns, corridors, three-way rooms and dead ends
 * instead of one repeated chamber.
 */
export function createEndlessRoomPlan(
  seed,
  centerX,
  floorY,
  startZ,
  hasFollowingRoom = true,
  maxEndZ = DUNGEON_CONFIG.maxCoordinate,
) {
  const random = makeRandom(seed);
  const size = DUNGEON_CONFIG.roomSize;
  // When another room follows, one cell must stay free for the corridor.
  const availableDepth = maxEndZ - startZ + 1 - (hasFollowingRoom ? 1 : 0);
  const roomDepth = Math.min(size, availableDepth);
  const roomWidth = size;
  const ports = { north: true, east: false, south: false, west: false };

  if (hasFollowingRoom) {
    const exitSides = ["south", "south", "south", "east", "west"];
    ports[pick(random, exitSides)] = true;
    // Sometimes a side branch makes the streamed room a three-way junction.
    if (random() < 0.15) {
      const extra = pick(random, SIDE_ORDER.filter((side) => side !== "north" && !ports[side]));
      ports[extra] = true;
    }
  }

  const entryIndex = 0;
  // The door of a streamed room is the middle 3 cells of its north wall, so the
  // room must be centred on the corridor: x = centerX - (width - 1) / 2.
  const roomX = centerX - (roomWidth - 1) / 2;
  const room = makeRoom(entryIndex, 0, 0, roomX, startZ, floorY, ports, roomWidth, roomDepth);

  return {
    seed,
    startZ,
    endZ: startZ + roomDepth - 1,
    roomWidth,
    roomDepth,
    hasFollowingRoom,
    floorY,
    room,
    ports,
  };
}

export function* endlessRoomBlockIterator(roomPlan, textureSeed = roomPlan.seed) {
  const random = makeRandom(textureSeed);
  for (const rect of roomPlan.room.floorRects) {
    for (const block of floorRectBlocks(rect)) yield block;
  }
  yield* moduleBlocksWithRandom(roomPlan.room, random);
}

/** Index of the chunk a world coordinate falls into, for a 32-block chunk. */
function chunkIndexOf(coordinate) {
  return Math.floor(coordinate / CHUNK_SIZE);
}

/** Every chunk a level block touches, so a build can wait for them. */
export function* levelChunkIterator(plan) {
  const seen = new Set();
  const level = plan.level;

  function* forRoom(room) {
    for (const rect of room.floorRects) {
      const [minX, , minZ] = rect.from;
      const [maxX, , maxZ] = rect.to;
      for (let x = minX; x <= maxX; x += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          const chunkX = chunkIndexOf(x);
          const chunkZ = chunkIndexOf(z);
          const key = `${chunkX},${chunkZ}`;
          if (seen.has(key)) continue;
          seen.add(key);
          yield { chunkX, chunkZ };
        }
      }
    }
  }

  for (const room of level.rooms) yield* forRoom(room);
  for (const key of level.rockCells) {
    const [x, z] = key.split(",").map(Number);
    const chunkX = chunkIndexOf(x);
    const chunkZ = chunkIndexOf(z);
    const chunkKey = `${chunkX},${chunkZ}`;
    if (seen.has(chunkKey)) continue;
    seen.add(chunkKey);
    yield { chunkX, chunkZ };
  }
}

/** Cells the level itself writes: the box must never erase a block of the room. */
function levelBlockKeys(plan) {
  const random = makeRandom(plan.seed);
  const keys = new Set();
  for (const room of plan.level.rooms) {
    for (const rect of room.floorRects) {
      for (const block of floorRectBlocks(rect)) keys.add(blockKey(block.x, block.y, block.z));
    }
    for (const block of moduleBlocksWithRandom(room, random)) keys.add(blockKey(block.x, block.y, block.z));
  }
  for (const key of plan.level.rockCells) {
    for (let y = plan.level.floorY; y <= plan.level.floorY + DUNGEON_CONFIG.wallHeight; y += 1) {
      keys.add(`${key.split(",")[0]},${y},${key.split(",")[1]}`);
    }
  }
  return keys;
}

/** Blocks of the closed box the player waits in, around the spawn cell. */
export function boxWallBlocks(plan, options = {}) {
  const level = plan.level;
  const [spawnX, , spawnZ] = level.spawnPosition;
  const distance = options.distance || DUNGEON_CONFIG.generationRadius;
  const half = Math.floor((DUNGEON_CONFIG.boxWallOffset + DUNGEON_CONFIG.doorWidth) / 2);
  const centerX = spawnX - 0.5;
  const centerZ = spawnZ - 0.5;
  const minX = Math.round(centerX) - half;
  const maxX = Math.round(centerX) + half;
  const minZ = Math.round(centerZ) - half;
  const maxZ = Math.round(centerZ) + half;
  const bottomY = level.floorY + 1;
  const topY = level.floorY + DUNGEON_CONFIG.boxWallHeight;
  const blockName = options.blockName || DUNGEON_CONFIG.wallBlockNames[0];
  const blocks = [];
  const roomKeys = levelBlockKeys(plan);

  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      const onEdge = x === minX || x === maxX || z === minZ || z === maxZ;
      if (!onEdge) continue;
      // Never overwrite a wall, a stair or a decoration of the entrance module.
      if (roomKeys.has(`${x},${bottomY},${z}`)) continue;
      // The box must sit inside the loaded chunks, otherwise its own writes
      // would be the ones that get lost.
      if (Math.abs(x - centerX) > distance || Math.abs(z - centerZ) > distance) continue;
      for (let y = bottomY; y <= topY; y += 1) blocks.push({ x, y, z, blockName });
    }
  }
  return blocks;
}

// ------------------------------------------------------------ block stream --

export function blockKey(x, y, z) {
  return `${x},${y},${z}`;
}

function floorRectBlocks(rect) {
  const blocks = [];
  const [minX, y, minZ] = rect.from;
  const [maxX, , maxZ] = rect.to;

  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) blocks.push({ x, y, z, blockName: DUNGEON_CONFIG.blockName });
  }
  return blocks;
}

function moduleBlocksWithoutRock(room, random) {
  return moduleBlocksWithRandom(room, random);
}

function* moduleBlocksWithRandom(room, random) {
  yield* roomBlockIterator(room, random);
  for (const block of stairBlocks(room, random)) yield block;
  yield* roomDecorationBlocks(room, random);
}

/**
 * Streams the whole level: every floor block first (rooms and corridors),
 * then each module's walls, stairs and decorations, then the surrounding rock.
 * The spawn pad is skipped because it was already laid down.
 */
export function* dungeonBlockIterator(plan, options = {}) {
  const random = makeRandom(options.textureSeed === undefined ? plan.seed : options.textureSeed);
  const skipFloorKeys = options.skipFloorKeys;
  const level = plan.level;
  // Cells already floored before the player moved are listed once, so a tile
  // is never written twice even though it belongs to a room and its corridor.
  const floorTiles = options.floorTiles || [];
  const listed = new Set();

  if (floorTiles.length > 0) {
    for (const tile of floorTiles) {
      const key = `${tile.x},${tile.z}`;
      if (listed.has(key)) continue;
      listed.add(key);
      const block = { x: tile.x, y: level.floorY, z: tile.z, blockName: DUNGEON_CONFIG.blockName };
      if (skipFloorKeys && skipFloorKeys.has(blockKey(block.x, block.y, block.z))) continue;
      yield block;
    }
  } else {
    for (const room of level.rooms) {
      for (const rect of room.floorRects) {
        for (const block of floorRectBlocks(rect)) {
          const key = `${block.x},${block.z}`;
          if (listed.has(key)) continue;
          listed.add(key);
          if (skipFloorKeys && skipFloorKeys.has(blockKey(block.x, block.y, block.z))) continue;
          yield block;
        }
      }
    }
  }
  for (const room of level.rooms) yield* moduleBlocksWithRandom(room, random);
  yield* rockBlocks(level, random);
}

/**
 * The footprint is solid rock, so rooms read as carved chambers and unexplored
 * cells stay opaque: the floor layer plus the wall layer, exactly as tall as a
 * room, so the level keeps its single floor height.
 */
function* rockBlocks(level, random) {
  const walls = level.rockCells;

  for (const key of walls) {
    const [x, z] = key.split(",").map(Number);
    for (let y = level.floorY; y <= level.floorY + DUNGEON_CONFIG.wallHeight; y += 1) {
      yield { x, y, z, blockName: randomRockBlock(random) };
    }
  }
}

// -------------------------------------------------------------- wall blocks --

function* solidColumn(random, x, z, bottomY, topY) {
  for (let y = bottomY; y <= topY; y += 1) yield { x, y, z, blockName: randomWallBlock(random) };
}

function* solidRow(random, minX, maxX, z, bottomY, topY) {
  for (let x = minX; x <= maxX; x += 1) yield* solidColumn(random, x, z, bottomY, topY);
}

function* wallAlongX(random, minX, maxX, z, bottomY, topY, doorCenter, hasDoor) {
  const half = doorHalfWidth();

  for (let x = minX; x <= maxX; x += 1) {
    if (hasDoor && Math.abs(x - doorCenter) <= half) continue;
    yield* solidColumn(random, x, z, bottomY, topY);
  }
}

function* wallAlongZ(random, x, minZ, maxZ, bottomY, topY, doorCenter, hasDoor) {
  const half = doorHalfWidth();

  for (let z = minZ; z <= maxZ; z += 1) {
    if (hasDoor && Math.abs(z - doorCenter) <= half) continue;
    yield* solidColumn(random, x, z, bottomY, topY);
  }
}

/**
 * One module: its four walls with the doors it owns, corners included. Corners
 * are emitted by the north/south walls only, so no block is written twice and
 * every opening is exactly `doorWidth` blocks wide.
 */
function* roomBlockIterator(room, random) {
  const bottomY = room.floorY + 1;
  const topY = room.floorY + DUNGEON_CONFIG.wallHeight;
  const minX = room.x;
  const maxX = room.x + room.width - 1;
  const minZ = room.z;
  const maxZ = room.z + room.depth - 1;
  const centerX = roomCenterX(room);
  const centerZ = roomCenterZ(room);

  yield* wallAlongX(random, minX, maxX, minZ, bottomY, topY, centerX, room.ports.north);
  yield* wallAlongX(random, minX, maxX, maxZ, bottomY, topY, centerX, room.ports.south);
  yield* wallAlongZ(random, minX, minZ + 1, maxZ - 1, bottomY, topY, centerZ, room.ports.west);
  yield* wallAlongZ(random, maxX, minZ + 1, maxZ - 1, bottomY, topY, centerZ, room.ports.east);
}

/**
 * Decorations are short pillars standing in the inner corners of a room. The
 * centred 3-wide cross that links the doors is always free, and the corners are
 * kept one cell away from the walls, so a pillar can never grow on a wall,
 * inside a doorway or on a corridor cell.
 */
function* roomDecorationBlocks(room, random) {
  if (room.stairKind) return;
  if (random() > 0.55) return;

  const bottomY = room.floorY + 1;
  const topY = room.floorY + 2;
  const minX = room.x + 1;
  const maxX = room.x + room.width - 2;
  const minZ = room.z + 1;
  const maxZ = room.z + room.depth - 2;
  const centerX = roomCenterX(room);
  const centerZ = roomCenterZ(room);
  const corners = [
    [minX, minZ],
    [maxX, minZ],
    [minX, maxZ],
    [maxX, maxZ],
  ].filter(([x, z]) => x !== centerX && z !== centerZ);

  const count = 1 + randomInteger(random, 0, 2);
  for (let index = 0; index < count && corners.length > 0; index += 1) {
    const at = randomInteger(random, 0, corners.length - 1);
    const [x, z] = corners[at];
    corners.splice(at, 1);
    yield* solidColumn(random, x, z, bottomY, topY);
  }
}

// ---------------------------------------------------------------- runtime ---

function nextDungeonSeed() {
  dungeonSequence += 1;
  const timeSeed = api.now() % RANDOM_MODULUS;
  return (timeSeed + dungeonSequence * 104729) % RANDOM_MODULUS || 1;
}

const dungeonSessions = {};

function isPlayerOnline(playerId) {
  try {
    return api.getPlayerIds().indexOf(playerId) !== -1;
  } catch (_) {
    return false;
  }
}

function logFailure(message, error) {
  try {
    api.log(`[Dungeon] ${message}: ${error && error.message ? error.message : error}`);
  } catch (_) {
    // Logging must never hide the original failure.
  }
}

export function stopDungeonForPlayer(playerId) {
  const session = dungeonSessions[playerId];
  if (!session) return;

  session.active = false;
  if (session.buildTimer) session.buildTimer.stop();
  if (session.progressTimer) session.progressTimer.stop();
  if (session.spawnGuardTimer) session.spawnGuardTimer.stop();
  delete dungeonSessions[playerId];
}

function reportGenerationFailure(playerId, error) {
  logFailure("Stone Bricks generation failed", error);

  stopDungeonForPlayer(playerId);
  if (isPlayerOnline(playerId)) {
    api.sendMessage(playerId, "Dungeon generation failed. Please try again.");
  }
}

function spawnPadTiles(plan) {
  const radius = DUNGEON_CONFIG.spawnPadRadius;
  const padX = plan.level.spawnPosition[0] - 0.5;
  const padZ = plan.level.spawnPosition[2] - 0.5;
  const tiles = [];

  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) tiles.push({ x: padX + dx, z: padZ + dz });
  }
  return tiles;
}

function readBlockName(x, y, z) {
  try {
    if (typeof api.getBlock !== "function") return null;
    const name = api.getBlock(x, y, z);
    return typeof name === "string" ? name : null;
  } catch (_) {
    return null;
  }
}

/**
 * Tiles of the pad that are not the expected floor block. Returns null when the
 * engine cannot read blocks, so callers rewrite the pad instead of trusting it.
 */
function missingSpawnPadTiles(plan) {
  const missing = [];
  for (const tile of spawnPadTiles(plan)) {
    const current = readBlockName(tile.x, plan.level.floorY, tile.z);
    if (current === null) return null;
    if (current !== DUNGEON_CONFIG.blockName) missing.push(tile);
  }
  return missing;
}

function placeSpawnPad(plan) {
  const tiles = spawnPadTiles(plan);

  for (const { x, z } of tiles) api.setBlock(x, plan.level.floorY, z, DUNGEON_CONFIG.blockName);
  return new Set(tiles.map(({ x, z }) => blockKey(x, plan.level.floorY, z)));
}

/** Tiles of the whole landing patch, the 3x3 pad included. */
function landingPadTiles(plan) {
  const radius = DUNGEON_CONFIG.landingPadRadius;
  const padX = plan.level.spawnPosition[0] - 0.5;
  const padZ = plan.level.spawnPosition[2] - 0.5;
  const tiles = [];

  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) tiles.push({ x: padX + dx, z: padZ + dz });
  }
  return tiles;
}

/**
 * Reads back a room floor and rewrites the tiles the world did not keep.
 * Bloxd silently drops writes aimed at a chunk it has not loaded, so the floor
 * is audited instead of assumed. Returns how many tiles had to be repaired.
 */
function repairFloorTiles(tiles, floorY) {
  let repaired = 0;
  let readable = true;
  const broken = [];

  for (const tile of tiles) {
    const current = readBlockName(tile.x, floorY, tile.z);
    if (current === null) {
      readable = false;
      break;
    }
    if (current !== DUNGEON_CONFIG.blockName) broken.push(tile);
  }
  const targets = readable ? broken : tiles;
  for (const { x, z } of targets) {
    api.setBlock(x, floorY, z, DUNGEON_CONFIG.blockName);
    repaired += 1;
  }
  return repaired;
}

/** Every floor tile a room owns, its connection corridors included. */
function roomFloorTiles(room) {
  const tiles = [];
  for (const rect of room.floorRects) {
    const [minX, , minZ] = rect.from;
    const [maxX, , maxZ] = rect.to;
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) tiles.push({ x, z });
    }
  }
  return tiles;
}

/**
 * Teleports the player in and boxes them up *before* anything else is written.
 *
 * Bloxd only keeps the chunks the player loads, so writing the dungeon while
 * the player is still in the lobby silently drops the blocks: that is what left
 * holes in the floor. Moving the player first makes their client load the
 * chunks, and the box keeps them from walking out of them.
 */
function teleportAndBox(playerId, plan) {
  const spawn = plan.level.spawnPosition;
  // x.5 / z.5 puts the player in the middle of the spawn cell.
  const position = [Math.floor(spawn[0]) + 0.5, spawn[1], Math.floor(spawn[2]) + 0.5];
  // 1. Read the landing cell: this forces the engine to create the chunk.
  readBlockName(position[0] - 0.5, plan.level.floorY, position[2] - 0.5);
  // 2. Floor the landing patch, so the player never lands in the void and can
  //    reach the box walls without walking over an unbuilt tile.
  const padKeys = new Set();
  for (const { x, z } of landingPadTiles(plan)) {
    api.setBlock(x, plan.level.floorY, z, DUNGEON_CONFIG.blockName);
    padKeys.add(blockKey(x, plan.level.floorY, z));
  }
  // 3. Move the player in: their client now loads the chunks around them.
  api.setPosition(playerId, position);
  // 4. Close the box, so they cannot walk out of the loaded chunks.
  for (const block of boxWallBlocks(plan)) {
    api.setBlock(block.x, block.y, block.z, block.blockName);
  }
  return { position, padKeys };
}

/** Opens the box again once the floor around the player is walkable. */
function removeBox(playerId, plan) {
  try {
    for (const block of boxWallBlocks(plan)) {
      api.setBlock(block.x, block.y, block.z, "Air");
    }
  } catch (error) {
    logFailure("Box removal failed", error);
  }
}

/**
 * Last line of defence: while the player stands in the box, read the pad back
 * and rewrite whatever the world did not keep.
 */
function startSpawnGuard(session, plan, onFirstPass) {
  let attempts = 0;

  session.spawnGuardTimer = scheduleInterval(() => {
    if (!session.active) return;
    attempts += 1;
    // The player has been moved and their chunk is live: start the real build
    // now, then keep sweeping to repair anything the world swallows.
    if (onFirstPass) {
      const start = onFirstPass;
      onFirstPass = null;
      start();
    }

    let missing = missingSpawnPadTiles(plan);
    // Rewrite the whole pad on the first sweep: an unreadable block still gets
    // a fresh write, so a lost spawn floor is repaired without read support.
    if (attempts > 1 || missing === null) missing = spawnPadTiles(plan);
    if (missing.length === 0) {
      session.spawnGuardTimer.stop();
      session.spawnGuardTimer = null;
      return;
    }

    try {
      for (const { x, z } of missing) api.setBlock(x, plan.level.floorY, z, DUNGEON_CONFIG.blockName);
    } catch (error) {
      logFailure("Spawn pad repair failed", error);
    }

    try {
      const position = api.getPosition(session.playerId);
      if (position && position[1] < plan.level.floorY + 1) api.setPosition(session.playerId, plan.level.spawnPosition);
    } catch (_) {
      // A failed position read must not stop the repair loop.
    }

    if (attempts >= DUNGEON_CONFIG.spawnCheckAttempts) {
      session.spawnGuardTimer.stop();
      session.spawnGuardTimer = null;
    }
  }, DUNGEON_CONFIG.spawnCheckTicks);
}

function startBlockBuild(session, iterator, onComplete, onTick) {
  let done = false;
  let failure = null;
  let placedThisTick = 0;
  let auditPassed = !onTick;
  let idleTicks = 0;

  const timer = scheduleInterval(() => {
    try {
      placedThisTick = 0;
      for (; placedThisTick < DUNGEON_CONFIG.blocksPerTick && !done; placedThisTick += 1) {
        const step = iterator.next();
        if (step.done) {
          done = true;
          break;
        }
        api.setBlock(step.value.x, step.value.y, step.value.z, step.value.blockName);
      }
      // The audit runs on its own quiet tick, never on top of a block batch,
      // so a single tick never writes more than the configured budget.
      if (done && !auditPassed) {
        auditPassed = true;
        onTick();
      }
      // One idle tick lets the audit writes settle before moving on.
      if (done) idleTicks += 1;
    } catch (error) {
      failure = error;
      done = true;
    }

    if (!done || idleTicks < 2) return;

    timer.stop();
    if (session.buildTimer === timer) session.buildTimer = null;
    if (failure) {
      reportGenerationFailure(session.playerId, failure);
      return;
    }
    if (!session.active || !isPlayerOnline(session.playerId)) {
      stopDungeonForPlayer(session.playerId);
      return;
    }

    try {
      onComplete();
    } catch (error) {
      reportGenerationFailure(session.playerId, error);
    }
  }, 1);
  session.buildTimer = timer;
}

function playerPositionZ(session) {
  const position = api.getPosition(session.playerId);
  return position && position.length >= 3 ? position[2] : null;
}

function finishStreaming(session, message) {
  session.finished = true;
  if (session.progressTimer) session.progressTimer.stop();
  try {
    api.sendMessage(session.playerId, message);
  } catch (error) {
    logFailure("Boundary message failed", error);
  }
}

/**
 * A streamed room is only built when it fits entirely inside the generation
 * radius around the player: chunk writes further away may never land.
 */
function buildNextStreamRoom(session, playerZ) {
  const startZ = session.nextRoomZ;
  if (startZ + DUNGEON_CONFIG.roomSize - 1 > DUNGEON_CONFIG.maxCoordinate) {
    finishStreaming(session, "The dungeon reached the world boundary.");
    return;
  }
  const currentZ = playerPositionZ(session);
  const anchorZ = currentZ === null ? playerZ : currentZ;
  if (startZ + DUNGEON_CONFIG.roomSize - 1 - anchorZ > DUNGEON_CONFIG.generationRadius) return;

  const roomSeed = (session.seed + (session.streamRoomIndex + 1) * 130363) % RANDOM_MODULUS || 1;
  const preview = createEndlessRoomPlan(
    roomSeed,
    session.centerX,
    session.floorY,
    startZ,
    true,
    DUNGEON_CONFIG.maxCoordinate,
  );
  const nextStartZ = preview.endZ + ROOM_CONNECTION_GAP + 1;
  const canFollow = nextStartZ + DUNGEON_CONFIG.roomSize - 1 <= DUNGEON_CONFIG.maxCoordinate;
  const roomPlan = canFollow
    ? preview
    : createEndlessRoomPlan(
      roomSeed,
      session.centerX,
      session.floorY,
      startZ,
      false,
      DUNGEON_CONFIG.maxCoordinate,
    );

  if (roomPlan.endZ > DUNGEON_CONFIG.maxCoordinate) {
    finishStreaming(session, "The dungeon reached the world boundary.");
    return;
  }

  session.isBuilding = true;
  startBlockBuild(session, endlessRoomBlockIterator(roomPlan, roomSeed), () => {
    // Same audit as the entrance room: a room whose floor was partly swallowed
    // must never become the new frontier.
    try {
      repairFloorTiles(roomFloorTiles(roomPlan.room), roomPlan.floorY);
    } catch (error) {
      logFailure("Streamed floor repair failed", error);
    }
    session.streamRoomIndex += 1;
    session.frontierZ = roomPlan.hasFollowingRoom
      ? roomPlan.endZ + ROOM_CONNECTION_GAP
      : roomPlan.endZ;
    session.nextRoomZ = roomPlan.endZ + ROOM_CONNECTION_GAP + 1;
    session.isBuilding = false;

    if (!roomPlan.hasFollowingRoom) {
      finishStreaming(session, "You reached the edge of the generated dungeon area.");
      return;
    }
    // Keep filling the buffer without waiting for the next progress tick.
    continueStreaming(session, playerZ);
  });
}

function continueStreaming(session, knownPlayerZ) {
  if (!session.active || session.isBuilding || session.finished || !session.buildStarted) return;

  let playerZ = knownPlayerZ;
  if (playerZ === undefined) {
    try {
      playerZ = playerPositionZ(session);
    } catch (error) {
      logFailure("Position check failed", error);
      return;
    }
  }
  if (playerZ === null || playerZ === undefined) return;
  if (session.frontierZ - playerZ >= DUNGEON_CONFIG.streamBufferDistance) return;

  buildNextStreamRoom(session, playerZ);
}

function startDungeonProgress(session) {
  session.progressTimer = scheduleInterval(() => {
    if (!session.active || !isPlayerOnline(session.playerId)) {
      stopDungeonForPlayer(session.playerId);
      return;
    }

    try {
      continueStreaming(session);
    } catch (error) {
      logFailure("Position check failed", error);
    }
  }, DUNGEON_CONFIG.progressCheckTicks);
}

function moduleSummary(level) {
  const counts = {};
  for (const id of MODULE_TYPE_IDS) counts[id] = 0;
  for (const room of level.rooms) counts[room.type.id] += 1;
  return counts;
}

/** Every floor tile of a level, each one listed exactly once. */
function levelFloorTiles(level) {
  const tiles = [];
  const seen = new Set();
  for (const room of level.rooms) {
    for (const tile of roomFloorTiles(room)) {
      const key = `${tile.x},${tile.z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push(tile);
    }
  }
  return tiles;
}

export function generateDungeon(playerId, difficulty) {
  stopDungeonForPlayer(playerId);
  const seed = nextDungeonSeed();
  const plan = createDungeonPlan(seed, difficulty);

  const session = {
    playerId,
    seed,
    centerX: plan.frontier.centerX,
    floorY: plan.frontier.floorY,
    frontierZ: plan.frontier.z,
    nextRoomZ: plan.frontier.nextRoomZ,
    streamRoomIndex: 0,
    isBuilding: false,
    buildStarted: false,
    finished: false,
    active: true,
    buildTimer: null,
    progressTimer: null,
    spawnGuardTimer: null,
  };
  dungeonSessions[playerId] = session;

  // 1. Read the landing cell, floor the landing patch, move the player onto it
  //    (middle of the cell) and box them in. Only then does the world load.
  let landing;
  try {
    landing = teleportAndBox(playerId, plan);
  } catch (error) {
    reportGenerationFailure(playerId, error);
    return;
  }

  if (isPlayerOnline(playerId)) {
    api.sendMessage(playerId, `Building a ${difficulty} single-level dungeon...`);
  }

  const summary = moduleSummary(plan.level);
  const floorTiles = levelFloorTiles(plan.level);

  startSpawnGuard(session, plan, () => {
    if (session.buildStarted) return;
    session.buildStarted = true;

    startBlockBuild(
      session,
      dungeonBlockIterator(plan, {
        skipFloorKeys: landing.padKeys,
        floorTiles,
        textureSeed: seed,
      }),
      () => {
        // Nothing says the world kept every write, so the floor is read back
        // and repaired before the exit lane is trusted.
        try {
          repairFloorTiles(floorTiles, plan.level.floorY);
          for (const { x, z } of spawnPadTiles(plan)) {
            api.setBlock(x, plan.level.floorY, z, DUNGEON_CONFIG.blockName);
          }
        } catch (error) {
          logFailure("Floor audit failed", error);
        }

        removeBox(playerId, plan);
        api.sendMessage(
          playerId,
          `${difficulty} dungeon ready: ${plan.level.roomCount} rooms `
            + `(${summary.crossroads} four-way, ${summary.tJunction} three-way, ${summary.turn} turns, `
            + `${summary.corridor} corridors, ${summary.end} dead ends, ${summary.stairs} stairs). `
            + "Keep advancing to generate more rooms!",
        );
        startDungeonProgress(session);
        continueStreaming(session, landing.position[2]);
      },
    );
  });
}
