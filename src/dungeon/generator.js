import { setInterval as scheduleInterval } from "../utils/scheduler.js";

const DUNGEON_CONFIG = {
  minCoordinate: -50000,
  maxCoordinate: 50000,
  floorY: -1000,
  // Rooms are 5x5 interiors walled on every side. Neighbouring rooms are
  // separated by exactly one free cell, which becomes their connection
  // corridor when both rooms own a door on that side.
  roomSize: 5,
  roomGap: 1,
  wallHeight: 3,
  doorWidth: 3,
  blocksPerTick: 120,
  progressCheckTicks: 10,
  // The spawn pad is laid first and checked again after the teleport, because
  // writes into a chunk the server has not loaded yet can be lost.
  spawnPadRadius: 1,
  spawnCheckTicks: 5,
  spawnCheckAttempts: 6,
  entranceLandingDepth: 2,
  // Streamed rooms stay at least this many blocks ahead of the player.
  streamBufferDistance: 36,
  maxStreamRoomSize: 9,
  minStreamRoomSize: 7,
  streamingRunway: 50000,
  extraPassageChance: 0.12,
  blockName: "Stone Bricks",
  wallBlockNames: [
    "Stone",
    "Messy Stone",
    "Smooth Stone",
    "Stone Bricks",
    "Cracked Stone Bricks",
    "Mossy Stone Bricks",
  ],
  cellsByDifficulty: {
    "Very Easy": 4,
    Easy: 5,
    Medium: 6,
    Normal: 7,
    Hard: 8,
    Insane: 9,
    "Ultra Insane": 10,
    Hell: 11,
  },
};

export const ROOM_TYPES = ["open", "pillar", "twinPillars", "alcove", "fourPillars", "zigzag"];

const RANDOM_MODULUS = 2147483647;
// Two consecutive rooms (grid room or streamed room) are always separated by
// one corridor cell, so the next room starts two cells after the previous end.
const ROOM_CONNECTION_GAP = 1;
let dungeonSequence = 0;

function makeRandom(seed) {
  let state = seed % RANDOM_MODULUS;
  if (state <= 0) state += RANDOM_MODULUS - 1;

  return () => {
    state = (state * 48271) % RANDOM_MODULUS;
    return state / RANDOM_MODULUS;
  };
}

function randomInteger(random, min, max) {
  const scaled = random() * (max - min + 1);
  return min + (scaled - (scaled % 1));
}

function wallBlockName(random) {
  return DUNGEON_CONFIG.wallBlockNames[
    randomInteger(random, 0, DUNGEON_CONFIG.wallBlockNames.length - 1)
  ];
}

function roomTypeFor(random) {
  return ROOM_TYPES[randomInteger(random, 0, ROOM_TYPES.length - 1)];
}

/**
 * Randomized spanning tree over the room grid, then a few braided passages so
 * big dungeons keep loops instead of turning into one long dead-end maze.
 * Every edge is stored once, so both rooms always agree on a shared door.
 */
function makeMazeEdges(cellCount, random) {
  const totalRooms = cellCount * cellCount;
  const visited = new Array(totalRooms).fill(false);
  const eastOpen = new Array(totalRooms).fill(false);
  const southOpen = new Array(totalRooms).fill(false);
  const stack = [0];
  visited[0] = true;

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const column = current % cellCount;
    const row = (current - column) / cellCount;
    const candidates = [];

    if (column > 0 && !visited[current - 1]) candidates.push([current - 1, "west"]);
    if (column + 1 < cellCount && !visited[current + 1]) candidates.push([current + 1, "east"]);
    if (row > 0 && !visited[current - cellCount]) candidates.push([current - cellCount, "north"]);
    if (row + 1 < cellCount && !visited[current + cellCount]) candidates.push([current + cellCount, "south"]);

    if (candidates.length === 0) {
      stack.pop();
      continue;
    }

    const [next, direction] = candidates[randomInteger(random, 0, candidates.length - 1)];
    if (direction === "west") eastOpen[next] = true;
    if (direction === "east") eastOpen[current] = true;
    if (direction === "north") southOpen[next] = true;
    if (direction === "south") southOpen[current] = true;
    visited[next] = true;
    stack.push(next);
  }

  for (let row = 0; row < cellCount; row += 1) {
    for (let column = 0; column < cellCount; column += 1) {
      const index = row * cellCount + column;
      if (column + 1 < cellCount && !eastOpen[index] && random() < DUNGEON_CONFIG.extraPassageChance) {
        eastOpen[index] = true;
      }
      if (row + 1 < cellCount && !southOpen[index] && random() < DUNGEON_CONFIG.extraPassageChance) {
        southOpen[index] = true;
      }
    }
  }

  return { eastOpen, southOpen };
}

function addRect(rects, x1, y1, z1, x2, y2, z2) {
  if (x1 > x2 || y1 > y2 || z1 > z2) return;
  rects.push({ from: [x1, y1, z1], to: [x2, y2, z2] });
}

function doorHalfWidth() {
  return (DUNGEON_CONFIG.doorWidth - 1) / 2;
}

function roomPorts(index, row, column, cellCount, edges) {
  const isStart = index === 0;
  const isExit = index === cellCount * cellCount - 1;
  return {
    north: row === 0 ? isStart : edges.southOpen[index - cellCount],
    east: column + 1 < cellCount && edges.eastOpen[index],
    south: row + 1 < cellCount ? edges.southOpen[index] : isExit,
    west: column > 0 && edges.eastOpen[index - 1],
  };
}

/** Interior floor plus the corridor cells the room itself owns. */
function roomFloorRects(room) {
  const floorY = room.floorY;
  const half = doorHalfWidth();
  const minX = room.x;
  const maxX = room.x + room.width - 1;
  const minZ = room.z;
  const maxZ = room.z + room.depth - 1;
  const centerX = room.x + (room.width - 1) / 2;
  const centerZ = room.z + (room.depth - 1) / 2;
  const rects = [];

  addRect(rects, minX, floorY, minZ, maxX, floorY, maxZ);
  // Corridors are owned by the room standing before them (east/south), so a
  // shared corridor is floored exactly once and never left with a hole.
  if (room.ports.east) addRect(rects, maxX + 1, floorY, centerZ - half, maxX + 1, floorY, centerZ + half);
  if (room.ports.south) addRect(rects, centerX - half, floorY, maxZ + 1, centerX + half, floorY, maxZ + 1);

  return rects;
}

function* solidColumn(random, x, z, bottomY, topY) {
  for (let y = bottomY; y <= topY; y += 1) {
    yield { x, y, z, blockName: wallBlockName(random) };
  }
}

function* solidRow(random, minX, maxX, z, bottomY, topY) {
  for (let x = minX; x <= maxX; x += 1) {
    yield* solidColumn(random, x, z, bottomY, topY);
  }
}

function* wallAlongX(random, minX, maxX, z, bottomY, topY, doorCenter, hasDoor) {
  const half = doorHalfWidth();
  const doorMin = doorCenter - half;
  const doorMax = doorCenter + half;

  for (let x = minX; x <= maxX; x += 1) {
    if (hasDoor && x >= doorMin && x <= doorMax) continue;
    yield* solidColumn(random, x, z, bottomY, topY);
  }
}

function* wallAlongZ(random, x, minZ, maxZ, bottomY, topY, doorCenter, hasDoor) {
  const half = doorHalfWidth();
  const doorMin = doorCenter - half;
  const doorMax = doorCenter + half;

  for (let z = minZ; z <= maxZ; z += 1) {
    if (hasDoor && z >= doorMin && z <= doorMax) continue;
    yield* solidColumn(random, x, z, bottomY, topY);
  }
}

/**
 * Decoration templates stay in the corner quadrants of a room. The centred
 * 3-wide cross that links every doorway is never obstructed, so a room can be
 * crossed in a straight line whatever its template.
 */
function* roomDecorationBlocks(room, random) {
  if (room.type === "open") return;

  const bottomY = room.floorY + 1;
  const pillarTopY = room.floorY + 2;
  const fullTopY = room.floorY + DUNGEON_CONFIG.wallHeight;
  const centerX = room.x + (room.width - 1) / 2;
  const centerZ = room.z + (room.depth - 1) / 2;
  const cornerX = (room.width - 1) / 2 - 1;
  const cornerZ = (room.depth - 1) / 2 - 1;
  const pillar = (dx, dz, topY = pillarTopY) => solidColumn(
    random,
    centerX + dx * cornerX,
    centerZ + dz * cornerZ,
    bottomY,
    topY,
  );

  if (room.type === "pillar") {
    yield* pillar(-1, -1, fullTopY);
  } else if (room.type === "twinPillars") {
    yield* pillar(-1, -1);
    yield* pillar(1, 1);
  } else if (room.type === "fourPillars") {
    yield* pillar(-1, -1);
    yield* pillar(1, -1);
    yield* pillar(-1, 1);
    yield* pillar(1, 1);
  } else if (room.type === "alcove") {
    // Two opposing ledges frame the crossing without narrowing it.
    yield* solidRow(random, centerX - cornerX, centerX - cornerX, room.z + 1, bottomY, pillarTopY);
    yield* solidRow(random, centerX + cornerX, centerX + cornerX, room.z + room.depth - 2, bottomY, pillarTopY);
  } else if (room.type === "zigzag") {
    yield* pillar(-1, -1);
    yield* pillar(1, 1, fullTopY);
  }
}

/**
 * One complete room: its four walls with the doors it owns, then decorations.
 * Corners are emitted by the north/south walls only, so no block is written
 * twice and every opening is exactly `doorWidth` blocks wide.
 */
export function* roomBlockIterator(room, random) {
  const bottomY = room.floorY + 1;
  const topY = room.floorY + DUNGEON_CONFIG.wallHeight;
  const minX = room.x;
  const maxX = room.x + room.width - 1;
  const minZ = room.z;
  const maxZ = room.z + room.depth - 1;
  const centerX = room.x + (room.width - 1) / 2;
  const centerZ = room.z + (room.depth - 1) / 2;

  yield* wallAlongX(random, minX, maxX, minZ, bottomY, topY, centerX, room.ports.north);
  yield* wallAlongX(random, minX, maxX, maxZ, bottomY, topY, centerX, room.ports.south);
  yield* wallAlongZ(random, minX, minZ + 1, maxZ - 1, bottomY, topY, centerZ, room.ports.west);
  yield* wallAlongZ(random, maxX, minZ + 1, maxZ - 1, bottomY, topY, centerZ, room.ports.east);
  yield* roomDecorationBlocks(room, random);
}

function makeRoom(index, row, column, x, z, floorY, type, ports, width, depth) {
  const room = {
    index,
    row,
    column,
    x,
    z,
    width,
    depth,
    floorY,
    type,
    ports,
  };
  room.floorRects = roomFloorRects(room);
  return room;
}

function makeDungeonRooms(seed, cellCount, originX, originZ, floorY) {
  const random = makeRandom(seed);
  const edges = makeMazeEdges(cellCount, random);
  const stride = DUNGEON_CONFIG.roomSize + DUNGEON_CONFIG.roomGap;
  const rooms = [];
  const roomStyleCounts = Object.fromEntries(ROOM_TYPES.map((type) => [type, 0]));

  for (let row = 0; row < cellCount; row += 1) {
    for (let column = 0; column < cellCount; column += 1) {
      const index = row * cellCount + column;
      const room = makeRoom(
        index,
        row,
        column,
        originX + 1 + column * stride,
        originZ + 1 + row * stride,
        floorY,
        roomTypeFor(random),
        roomPorts(index, row, column, cellCount, edges),
        DUNGEON_CONFIG.roomSize,
        DUNGEON_CONFIG.roomSize,
      );
      rooms.push(room);
      roomStyleCounts[room.type] += 1;
    }
  }

  const startRoom = rooms[0];
  const exitRoom = rooms[rooms.length - 1];
  const startCenterX = startRoom.x + (startRoom.width - 1) / 2;
  const startCenterZ = startRoom.z + (startRoom.depth - 1) / 2;
  const exitCenterX = exitRoom.x + (exitRoom.width - 1) / 2;
  const exitMaxZ = exitRoom.z + exitRoom.depth - 1;
  const half = doorHalfWidth();
  const floorRects = [];

  for (const room of rooms) {
    for (const rect of room.floorRects) floorRects.push(rect);
  }
  // Entrance landing in front of the start room's north door. The exit
  // corridor is owned by the exit room itself and leads to streamed rooms.
  addRect(
    floorRects,
    startCenterX - half,
    floorY,
    originZ + 1 - DUNGEON_CONFIG.entranceLandingDepth,
    startCenterX + half,
    floorY,
    originZ,
  );

  const width = cellCount * stride + 1;
  const passageCount = rooms.reduce(
    (total, room) => total + Number(room.ports.east) + Number(room.ports.south),
    0,
  ) - 1;

  return {
    seed,
    originX,
    originZ,
    width,
    cellCount,
    roomCount: rooms.length,
    floorY,
    floorRects,
    rooms,
    roomStyleCounts,
    passageCount,
    spawnPosition: [startCenterX + 0.5, floorY + 1, startCenterZ + 0.5],
    endlessFrontier: {
      centerX: exitCenterX,
      floorY,
      z: exitMaxZ + ROOM_CONNECTION_GAP,
      nextRoomZ: exitMaxZ + ROOM_CONNECTION_GAP + 1,
    },
  };
}

// The plan is pure so tests can verify room sockets, floor coverage and bounds.
export function createDungeonPlan(seed, difficulty) {
  const cellCount = DUNGEON_CONFIG.cellsByDifficulty[difficulty] || DUNGEON_CONFIG.cellsByDifficulty.Normal;
  const stride = DUNGEON_CONFIG.roomSize + DUNGEON_CONFIG.roomGap;
  const width = cellCount * stride + 1;
  const random = makeRandom(seed);
  const maxOriginX = DUNGEON_CONFIG.maxCoordinate - width - DUNGEON_CONFIG.maxStreamRoomSize;
  const maxOriginZ = DUNGEON_CONFIG.maxCoordinate - width - DUNGEON_CONFIG.streamingRunway - 2;
  const originX = randomInteger(random, DUNGEON_CONFIG.minCoordinate, maxOriginX);
  const originZ = randomInteger(
    random,
    DUNGEON_CONFIG.minCoordinate + DUNGEON_CONFIG.entranceLandingDepth,
    maxOriginZ,
  );

  return makeDungeonRooms(seed, cellCount, originX, originZ, DUNGEON_CONFIG.floorY);
}

function* floorRectBlocks(rect) {
  const [minX, y, minZ] = rect.from;
  const [maxX, , maxZ] = rect.to;

  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      yield { x, y, z, blockName: DUNGEON_CONFIG.blockName };
    }
  }
}

export function blockKey(x, y, z) {
  return `${x},${y},${z}`;
}

/**
 * Streams the whole dungeon: every floor block first, then each room's walls
 * and decorations. Nothing is materialised as a block list, so the build cost
 * stays constant whatever the dungeon size.
 */
export function* dungeonBlockIterator(plan, options = {}) {
  const random = makeRandom(options.textureSeed === undefined ? plan.seed : options.textureSeed);
  const skipFloorKeys = options.skipFloorKeys;
  const floorRects = options.floorRects || plan.floorRects;

  for (const rect of floorRects) {
    for (const block of floorRectBlocks(rect)) {
      if (skipFloorKeys && skipFloorKeys.has(blockKey(block.x, block.y, block.z))) continue;
      yield block;
    }
  }

  for (const room of plan.rooms) {
    yield* roomBlockIterator(room, random);
  }
}

/**
 * Builds a streamed room. It keeps the same centred 3-wide door sockets as
 * the grid rooms, so each new room clips into the previous one.
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
  const roomWidth = randomInteger(random, 0, 1) === 0
    ? DUNGEON_CONFIG.minStreamRoomSize
    : DUNGEON_CONFIG.maxStreamRoomSize;
  // When another room follows, one cell must stay free for the corridor.
  const availableDepth = maxEndZ - startZ + 1 - (hasFollowingRoom ? 1 : 0);
  const requestedDepth = randomInteger(random, 0, 1) === 0
    ? DUNGEON_CONFIG.minStreamRoomSize
    : DUNGEON_CONFIG.maxStreamRoomSize;
  const roomDepth = requestedDepth > availableDepth ? availableDepth : requestedDepth;
  const roomX = centerX - (roomWidth - 1) / 2;
  const room = makeRoom(
    0,
    0,
    0,
    roomX,
    startZ,
    floorY,
    roomTypeFor(random),
    { north: true, east: false, south: hasFollowingRoom, west: false },
    roomWidth,
    roomDepth,
  );

  const endZ = startZ + roomDepth - 1;

  return {
    seed,
    startZ,
    endZ,
    roomWidth,
    roomDepth,
    hasFollowingRoom,
    type: room.type,
    floorY,
    room,
    floorRects: room.floorRects,
  };
}

export function* endlessRoomBlockIterator(roomPlan, textureSeed = roomPlan.seed) {
  const random = makeRandom(textureSeed);

  for (const rect of roomPlan.floorRects) {
    yield* floorRectBlocks(rect);
  }
  yield* roomBlockIterator(roomPlan.room, random);
}

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
  const padX = plan.spawnPosition[0] - 0.5;
  const padZ = plan.spawnPosition[2] - 0.5;
  const tiles = [];

  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      tiles.push({ x: padX + dx, z: padZ + dz });
    }
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

// A block can only be written into a chunk that already exists server side.
// Poking the target cell in the previous tick makes the engine create the
// chunk before the real write, which is what used to swallow the spawn floor.
function primeChunk(plan) {
  readBlockName(plan.spawnPosition[0] - 0.5, plan.floorY, plan.spawnPosition[2] - 0.5);
}

/**
 * Tiles of the pad that are not the expected floor block. Returns null when the
 * engine cannot read blocks, so callers fall back to rewriting the whole pad
 * instead of assuming it is correct.
 */
function missingSpawnPadTiles(plan) {
  const missing = [];
  for (const tile of spawnPadTiles(plan)) {
    const current = readBlockName(tile.x, plan.floorY, tile.z);
    if (current === null) return null;
    if (current !== DUNGEON_CONFIG.blockName) missing.push(tile);
  }
  return missing;
}

function placeSpawnPad(plan) {
  const tiles = spawnPadTiles(plan);

  for (const { x, z } of tiles) api.setBlock(x, plan.floorY, z, DUNGEON_CONFIG.blockName);
  return new Set(tiles.map(({ x, z }) => blockKey(x, plan.floorY, z)));
}

function startBlockBuild(session, iterator, onComplete, onTick) {
  let done = false;
  let failure = null;
  const timer = scheduleInterval(() => {
    try {
      for (let placed = 0; placed < DUNGEON_CONFIG.blocksPerTick && !done; placed += 1) {
        const step = iterator.next();
        if (step.done) {
          done = true;
          break;
        }
        api.setBlock(step.value.x, step.value.y, step.value.z, step.value.blockName);
      }
      if (onTick) onTick();
    } catch (error) {
      failure = error;
      done = true;
    }

    if (!done) return;

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

/**
 * Last line of defence: once the player stands on the spawn cell, read the pad
 * back and rewrite whatever the world did not keep. A chunk that was still
 * being generated when the pad was first written is repaired here instead of
 * leaving the player over a hole.
 */
function startSpawnGuard(session, plan) {
  let attempts = 0;

  session.spawnGuardTimer = scheduleInterval(() => {
    if (!session.active) return;
    attempts += 1;

    let missing = missingSpawnPadTiles(plan);
    // Rewrite the whole pad on the first sweep: an unreadable block still gets
    // a fresh write, so a lost spawn floor is repaired without any read support.
    if (attempts > 1 || missing === null) missing = spawnPadTiles(plan);
    if (missing.length === 0) {
      session.spawnGuardTimer.stop();
      session.spawnGuardTimer = null;
      return;
    }

    try {
      for (const { x, z } of missing) api.setBlock(x, plan.floorY, z, DUNGEON_CONFIG.blockName);
    } catch (error) {
      logFailure("Spawn pad repair failed", error);
    }

    // Keep the player supported while the repair is applied.
    try {
      const position = api.getPosition(session.playerId);
      if (position && position[1] < plan.floorY + 1) api.setPosition(session.playerId, plan.spawnPosition);
    } catch (_) {
      // A failed position read must not stop the repair loop.
    }

    if (attempts >= DUNGEON_CONFIG.spawnCheckAttempts) {
      session.spawnGuardTimer.stop();
      session.spawnGuardTimer = null;
    }
  }, DUNGEON_CONFIG.spawnCheckTicks);
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

function buildNextStreamRoom(session, playerZ) {
  const startZ = session.nextRoomZ;
  if (startZ + DUNGEON_CONFIG.minStreamRoomSize - 1 > DUNGEON_CONFIG.maxCoordinate) {
    finishStreaming(session, "The dungeon reached the world boundary.");
    return;
  }

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
  const canFollow = nextStartZ + DUNGEON_CONFIG.minStreamRoomSize - 1 <= DUNGEON_CONFIG.maxCoordinate;
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
  if (!session.active || session.isBuilding || session.finished) return;

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
  // The dungeon is built room by room until the buffer ahead is filled.
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

export function generateDungeon(playerId, difficulty) {
  stopDungeonForPlayer(playerId);
  const seed = nextDungeonSeed();
  const plan = createDungeonPlan(seed, difficulty);
  // The plan puts the start room close to the randomized dungeon origin, so a
  // "get" on its cell in this tick forces the engine to create the chunk before
  // the real writes land. Placed before the first setBlock on purpose.
  try {
    primeChunk(plan);
  } catch (error) {
    logFailure("Chunk priming failed", error);
  }

  const session = {
    playerId,
    seed,
    centerX: plan.endlessFrontier.centerX,
    floorY: plan.endlessFrontier.floorY,
    frontierZ: plan.endlessFrontier.z,
    nextRoomZ: plan.endlessFrontier.nextRoomZ,
    streamRoomIndex: 0,
    isBuilding: false,
    finished: false,
    active: true,
    buildTimer: null,
    progressTimer: null,
  };
  dungeonSessions[playerId] = session;

  let padKeys;
  try {
    padKeys = placeSpawnPad(plan);
  } catch (error) {
    reportGenerationFailure(playerId, error);
    return;
  }

  if (isPlayerOnline(playerId)) {
    api.sendMessage(playerId, `Building a ${difficulty} single-level dungeon...`);
  }

  // Floors are streamed before any wall, so no room can be walled in on bare
  // ground; the teleport still happens only once the whole level is placed.
  // Each build tick re-pokes the spawn chunk in case it was not ready yet.
  startBlockBuild(
    session,
    dungeonBlockIterator(plan, { skipFloorKeys: padKeys, textureSeed: seed }),
    () => {
      // Re-assert the pad right before the teleport, then keep checking it.
      try {
        for (const { x, z } of spawnPadTiles(plan)) api.setBlock(x, plan.floorY, z, DUNGEON_CONFIG.blockName);
      } catch (error) {
        logFailure("Spawn pad refresh failed", error);
      }

      api.setPosition(playerId, plan.spawnPosition);
      api.sendMessage(
        playerId,
        `${difficulty} dungeon ready: ${plan.roomCount} connected rooms. Keep advancing to generate more rooms!`,
      );
      startSpawnGuard(session, plan);
      startDungeonProgress(session);
    },
    () => primeChunk(plan),
  );
}
