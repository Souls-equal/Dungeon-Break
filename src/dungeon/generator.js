import { setInterval as scheduleInterval } from "../utils/scheduler.js";

const DUNGEON_CONFIG = {
  minCoordinate: -50000,
  maxCoordinate: 50000,
  floorY: -1000,
  roomSize: 5,
  wallHeight: 3,
  doorWidth: 3,
  blocksPerTick: 120,
  progressCheckTicks: 10,
  generationAheadDistance: 18,
  maxStreamRoomSize: 9,
  minStreamRoomSize: 7,
  streamingRunway: 50000,
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

const RANDOM_MODULUS = 2147483647;
const ROOM_TYPES = ["open", "pillar", "twinPillars", "alcove", "fourPillars", "zigzag"];
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

function makeMazeEdges(cellCount, random) {
  const totalRooms = cellCount * cellCount;
  const visited = new Array(totalRooms).fill(false);
  const eastOpen = new Array(totalRooms).fill(false);
  const southOpen = new Array(totalRooms).fill(false);
  const stack = [0];
  visited[0] = true;

  // A randomized spanning tree makes every room reachable from the entrance.
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

  return { eastOpen, southOpen };
}

function addRect(rects, x1, y1, z1, x2, y2, z2) {
  if (x1 > x2 || y1 > y2 || z1 > z2) return;
  rects.push({ from: [x1, y1, z1], to: [x2, y2, z2] });
}

function addWall(walls, x1, y1, z1, x2, y2, z2) {
  addRect(walls, x1, y1, z1, x2, y2, z2);
}

function addDoorwayWall(walls, minX, maxX, z, centerX, yBottom, yTop) {
  const halfDoor = (DUNGEON_CONFIG.doorWidth - 1) / 2;
  addWall(walls, minX, yBottom, z, centerX - halfDoor - 1, yTop, z);
  addWall(walls, centerX + halfDoor + 1, yBottom, z, maxX, yTop, z);
}

function markRandomWallTextures(walls) {
  for (const wall of walls) wall.randomWallTexture = true;
}

function roomTypeFor(random) {
  return ROOM_TYPES[randomInteger(random, 0, ROOM_TYPES.length - 1)];
}

function addRoomDecoration(walls, room, floorY, roomWidth, roomDepth) {
  const centerX = room.x + (roomWidth - 1) / 2;
  const centerZ = room.z + (roomDepth - 1) / 2;
  const bottomY = floorY + 1;
  const topY = floorY + DUNGEON_CONFIG.wallHeight;
  const pillarY = floorY + 2;
  const pillar = (dx, dz, top = pillarY) => {
    addWall(walls, centerX + dx, bottomY, centerZ + dz, centerX + dx, top, centerZ + dz);
  };

  // Every template uses the same centered 3-wide doorway sockets. The central
  // cross stays open so decorations never block a room's puzzle-piece exits.
  if (room.type === "pillar") {
    pillar(-1, -1, topY);
  } else if (room.type === "twinPillars") {
    pillar(-1, -1);
    pillar(1, 1);
  } else if (room.type === "fourPillars") {
    pillar(-1, -1);
    pillar(1, -1);
    pillar(-1, 1);
    pillar(1, 1);
  } else if (room.type === "alcove") {
    addWall(walls, centerX - 1, bottomY, centerZ - 1, centerX, pillarY, centerZ - 1);
    addWall(walls, centerX, bottomY, centerZ + 1, centerX + 1, pillarY, centerZ + 1);
  } else if (room.type === "zigzag") {
    pillar(-1, -1);
    pillar(1, 1, topY);
  }
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

function makeDungeonRooms(seed, cellCount, originX, originZ, floorY) {
  const random = makeRandom(seed);
  const edges = makeMazeEdges(cellCount, random);
  const roomStride = DUNGEON_CONFIG.roomSize + 1;
  const rooms = [];
  const roomStyleCounts = Object.fromEntries(ROOM_TYPES.map((type) => [type, 0]));

  for (let row = 0; row < cellCount; row += 1) {
    for (let column = 0; column < cellCount; column += 1) {
      const index = row * cellCount + column;
      const room = {
        index,
        row,
        column,
        x: originX + 1 + column * roomStride,
        z: originZ + 1 + row * roomStride,
        type: roomTypeFor(random),
        ports: roomPorts(index, row, column, cellCount, edges),
      };
      rooms.push(room);
      roomStyleCounts[room.type] += 1;
    }
  }

  const roomMaxX = DUNGEON_CONFIG.roomSize - 1;
  const roomMaxZ = DUNGEON_CONFIG.roomSize - 1;
  const maxX = originX + cellCount * roomStride;
  const maxZ = originZ + cellCount * roomStride;
  const wallBottomY = floorY + 1;
  const wallTopY = floorY + DUNGEON_CONFIG.wallHeight;
  const walls = [];
  const startRoom = rooms[0];
  const exitRoom = rooms.at(-1);
  const startCenterX = startRoom.x + roomMaxX / 2;
  const exitCenterX = exitRoom.x + roomMaxX / 2;

  // Boundary walls, with only the entrance and final exit doorway left open.
  addDoorwayWall(walls, originX, maxX, originZ, startCenterX, wallBottomY, wallTopY);
  addDoorwayWall(walls, originX, maxX, maxZ, exitCenterX, wallBottomY, wallTopY);
  addWall(walls, originX, wallBottomY, originZ, originX, wallTopY, maxZ);
  addWall(walls, maxX, wallBottomY, originZ, maxX, wallTopY, maxZ);

  // Each pair of adjacent room pieces shares one divider. Open graph edges get
  // a centered 3-wide socket; closed edges remain solid wall pieces.
  for (const room of rooms) {
    const eastDividerX = room.x + DUNGEON_CONFIG.roomSize;
    const southDividerZ = room.z + DUNGEON_CONFIG.roomSize;

    if (room.column + 1 < cellCount) {
      if (room.ports.east) {
        addWall(walls, eastDividerX, wallBottomY, room.z, eastDividerX, wallTopY, room.z);
        addWall(
          walls,
          eastDividerX,
          wallBottomY,
          room.z + DUNGEON_CONFIG.roomSize - 1,
          eastDividerX,
          wallTopY,
          room.z + DUNGEON_CONFIG.roomSize - 1,
        );
      } else {
        addWall(
          walls,
          eastDividerX,
          wallBottomY,
          room.z,
          eastDividerX,
          wallTopY,
          room.z + roomMaxZ,
        );
      }
    }

    if (room.row + 1 < cellCount) {
      if (room.ports.south) {
        addWall(walls, room.x, wallBottomY, southDividerZ, room.x, wallTopY, southDividerZ);
        addWall(
          walls,
          room.x + DUNGEON_CONFIG.roomSize - 1,
          wallBottomY,
          southDividerZ,
          room.x + DUNGEON_CONFIG.roomSize - 1,
          wallTopY,
          southDividerZ,
        );
      } else {
        addWall(
          walls,
          room.x,
          wallBottomY,
          southDividerZ,
          room.x + roomMaxX,
          wallTopY,
          southDividerZ,
        );
      }
    }

    addRoomDecoration(walls, room, floorY, DUNGEON_CONFIG.roomSize, DUNGEON_CONFIG.roomSize);
  }

  markRandomWallTextures(walls);

  const width = cellCount * roomStride + 1;
  const floorRects = [];
  // A continuous, single-level floor includes the entrance and exit landings.
  addRect(floorRects, originX, floorY, originZ - 2, maxX, floorY, maxZ + 2);

  return {
    originX,
    originZ,
    width,
    cellCount,
    roomCount: rooms.length,
    floorY,
    floorRects,
    walls,
    rooms,
    roomStyleCounts,
    passageCount: rooms.reduce((total, room) => total + Number(room.ports.east) + Number(room.ports.south), 0) - 1,
    spawnPosition: [startCenterX + 0.5, floorY + 1, startRoom.z + roomMaxZ / 2 + 0.5],
    endlessFrontier: {
      centerX: exitCenterX,
      floorY,
      z: maxZ + 2,
    },
  };
}

// The plan is pure so tests can verify room sockets, floor coverage and bounds.
export function createDungeonPlan(seed, difficulty) {
  const cellCount = DUNGEON_CONFIG.cellsByDifficulty[difficulty] || DUNGEON_CONFIG.cellsByDifficulty.Normal;
  const roomStride = DUNGEON_CONFIG.roomSize + 1;
  const width = cellCount * roomStride + 1;
  const random = makeRandom(seed);
  const maxOriginX = DUNGEON_CONFIG.maxCoordinate - width - DUNGEON_CONFIG.maxStreamRoomSize;
  const maxOriginZ = DUNGEON_CONFIG.maxCoordinate - width - DUNGEON_CONFIG.streamingRunway - 2;
  const originX = randomInteger(random, DUNGEON_CONFIG.minCoordinate, maxOriginX);
  const originZ = randomInteger(random, DUNGEON_CONFIG.minCoordinate + 2, maxOriginZ);

  return makeDungeonRooms(seed, cellCount, originX, originZ, DUNGEON_CONFIG.floorY);
}

function addStreamRoomWalls(walls, minX, maxX, minZ, maxZ, centerX, floorY, hasFollowingRoom) {
  const bottomY = floorY + 1;
  const topY = floorY + DUNGEON_CONFIG.wallHeight;
  addDoorwayWall(walls, minX, maxX, minZ, centerX, bottomY, topY);
  if (hasFollowingRoom) {
    addDoorwayWall(walls, minX, maxX, maxZ, centerX, bottomY, topY);
  } else {
    addWall(walls, minX, bottomY, maxZ, maxX, topY, maxZ);
  }
  addWall(walls, minX, bottomY, minZ, minX, topY, maxZ);
  addWall(walls, maxX, bottomY, minZ, maxX, topY, maxZ);
}

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
  const availableDepth = maxEndZ - startZ + 1;
  const requestedDepth = randomInteger(random, 0, 1) === 0
    ? DUNGEON_CONFIG.minStreamRoomSize
    : DUNGEON_CONFIG.maxStreamRoomSize;
  const roomDepth = requestedDepth > availableDepth
    ? DUNGEON_CONFIG.minStreamRoomSize
    : requestedDepth;
  const minX = centerX - (roomWidth - 1) / 2;
  const maxX = centerX + (roomWidth - 1) / 2;
  const endZ = startZ + roomDepth - 1;
  const room = {
    x: minX,
    z: startZ,
    type: roomTypeFor(random),
  };
  const floorRects = [];
  const walls = [];

  addRect(floorRects, minX, floorY, startZ, maxX, floorY, endZ);
  addStreamRoomWalls(walls, minX, maxX, startZ, endZ, centerX, floorY, hasFollowingRoom);
  addRoomDecoration(walls, room, floorY, roomWidth, roomDepth);
  markRandomWallTextures(walls);

  return {
    startZ,
    endZ,
    roomWidth,
    roomDepth,
    hasFollowingRoom,
    type: room.type,
    floorRects,
    walls,
    operations: floorRects.concat(walls),
  };
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

export function stopDungeonForPlayer(playerId) {
  const session = dungeonSessions[playerId];
  if (!session) return;

  session.active = false;
  if (session.buildTimer) session.buildTimer.stop();
  if (session.progressTimer) session.progressTimer.stop();
  delete dungeonSessions[playerId];
}

function reportGenerationFailure(playerId, error) {
  try {
    api.log(`[Dungeon] Stone Bricks generation failed: ${error && error.message ? error.message : error}`);
  } catch (_) {
    // Logging must not hide the generation failure.
  }

  stopDungeonForPlayer(playerId);
  if (isPlayerOnline(playerId)) {
    api.sendMessage(playerId, "Dungeon generation failed. Please try again.");
  }
}

function withoutFloorBlock(rectangles, blockX, floorY, blockZ) {
  const result = [];
  for (const rectangle of rectangles) {
    const [minX, y, minZ] = rectangle.from;
    const [maxX, , maxZ] = rectangle.to;
    if (y !== floorY || blockX < minX || blockX > maxX || blockZ < minZ || blockZ > maxZ) {
      result.push(rectangle);
      continue;
    }

    addRect(result, minX, floorY, minZ, blockX - 1, floorY, maxZ);
    addRect(result, blockX + 1, floorY, minZ, maxX, floorY, maxZ);
    addRect(result, blockX, floorY, minZ, blockX, floorY, blockZ - 1);
    addRect(result, blockX, floorY, blockZ + 1, blockX, floorY, maxZ);
  }
  return result;
}

function createBlockCursor(operations, materialSeed) {
  const random = makeRandom(materialSeed);
  let operationIndex = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  let initialized = false;

  return {
    isDone() {
      return operationIndex >= operations.length;
    },
    next() {
      if (this.isDone()) return null;

      const operation = operations[operationIndex];
      if (!initialized) {
        x = operation.from[0];
        y = operation.from[1];
        z = operation.from[2];
        initialized = true;
      }

      const blockName = operation.randomWallTexture
        ? DUNGEON_CONFIG.wallBlockNames[
          randomInteger(random, 0, DUNGEON_CONFIG.wallBlockNames.length - 1)
        ]
        : operation.blockName || DUNGEON_CONFIG.blockName;
      const block = { x, y, z, blockName };

      if (z < operation.to[2]) {
        z += 1;
      } else {
        z = operation.from[2];
        if (y < operation.to[1]) {
          y += 1;
        } else {
          y = operation.from[1];
          if (x < operation.to[0]) {
            x += 1;
          } else {
            operationIndex += 1;
            initialized = false;
          }
        }
      }

      return block;
    },
  };
}

function runBlockBuild(session, operations, onComplete) {
  session.blockBuildSequence += 1;
  const materialSeed = (session.seed + session.blockBuildSequence * 49979687) % RANDOM_MODULUS || 1;
  const cursor = createBlockCursor(operations, materialSeed);
  const buildTimer = scheduleInterval(() => {
    try {
      let placedThisTick = 0;
      while (!cursor.isDone() && placedThisTick < DUNGEON_CONFIG.blocksPerTick) {
        const block = cursor.next();
        api.setBlock(block.x, block.y, block.z, block.blockName);
        placedThisTick += 1;
      }
    } catch (error) {
      buildTimer.stop();
      session.buildTimer = null;
      reportGenerationFailure(session.playerId, error);
      return;
    }

    if (!cursor.isDone()) return;

    buildTimer.stop();
    session.buildTimer = null;
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
  session.buildTimer = buildTimer;
}

function buildRoomInStages(session, floorRects, walls, onComplete) {
  runBlockBuild(session, floorRects, () => {
    runBlockBuild(session, walls, onComplete);
  });
}

function buildNextEndlessRoom(session, playerZ) {
  if (!session.active || session.isBuilding || session.finished) return;
  if (playerZ < session.frontierZ - DUNGEON_CONFIG.generationAheadDistance) return;

  const startZ = session.frontierZ + 1;
  if (startZ + DUNGEON_CONFIG.minStreamRoomSize - 1 > DUNGEON_CONFIG.maxCoordinate) {
    session.finished = true;
    session.progressTimer.stop();
    api.sendMessage(session.playerId, "The dungeon reached the world boundary.");
    return;
  }

  const roomSeed = (session.seed + (session.roomIndex + 1) * 130363) % RANDOM_MODULUS || 1;
  const preview = createEndlessRoomPlan(
    roomSeed,
    session.centerX,
    session.floorY,
    startZ,
    true,
    DUNGEON_CONFIG.maxCoordinate,
  );
  const minimumNextEnd = preview.endZ + DUNGEON_CONFIG.minStreamRoomSize;
  const hasFollowingRoom = minimumNextEnd <= DUNGEON_CONFIG.maxCoordinate;
  const roomPlan = hasFollowingRoom
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
    session.finished = true;
    session.progressTimer.stop();
    api.sendMessage(session.playerId, "The dungeon reached the world boundary.");
    return;
  }

  session.isBuilding = true;
  buildRoomInStages(session, roomPlan.floorRects, roomPlan.walls, () => {
    session.frontierZ = roomPlan.endZ;
    session.roomIndex += 1;
    session.isBuilding = false;

    if (!roomPlan.hasFollowingRoom) {
      session.finished = true;
      session.progressTimer.stop();
      api.sendMessage(session.playerId, "You reached the edge of the generated dungeon area.");
    }
  });
}

function startDungeonProgress(session) {
  session.progressTimer = scheduleInterval(() => {
    if (!session.active || !isPlayerOnline(session.playerId)) {
      stopDungeonForPlayer(session.playerId);
      return;
    }

    try {
      const position = api.getPosition(session.playerId);
      if (position && position.length >= 3) buildNextEndlessRoom(session, position[2]);
    } catch (error) {
      try {
        api.log(`[Dungeon] Position check failed: ${error && error.message ? error.message : error}`);
      } catch (_) {
        // Logging must not stop future position checks.
      }
    }
  }, DUNGEON_CONFIG.progressCheckTicks);
}

export function generateDungeon(playerId, difficulty) {
  stopDungeonForPlayer(playerId);
  const seed = nextDungeonSeed();
  const plan = createDungeonPlan(seed, difficulty);
  const spawnBlockX = plan.spawnPosition[0] - 0.5;
  const spawnBlockZ = plan.spawnPosition[2] - 0.5;
  const remainingFloor = withoutFloorBlock(plan.floorRects, spawnBlockX, plan.floorY, spawnBlockZ);
  const session = {
    playerId,
    seed,
    centerX: plan.endlessFrontier.centerX,
    floorY: plan.endlessFrontier.floorY,
    frontierZ: plan.endlessFrontier.z,
    roomIndex: 0,
    blockBuildSequence: 0,
    isBuilding: false,
    finished: false,
    active: true,
    buildTimer: null,
    progressTimer: null,
  };
  dungeonSessions[playerId] = session;

  // Support the exact teleport tile synchronously before scheduling any other
  // work. Then build the rest of the continuous floor, followed by all walls.
  try {
    api.setBlock(spawnBlockX, plan.floorY, spawnBlockZ, DUNGEON_CONFIG.blockName);
  } catch (error) {
    reportGenerationFailure(playerId, error);
    return;
  }

  if (isPlayerOnline(playerId)) {
    api.sendMessage(playerId, `Building a ${difficulty} single-level dungeon...`);
  }

  buildRoomInStages(session, remainingFloor, plan.walls, () => {
    api.setPosition(playerId, plan.spawnPosition);
    api.sendMessage(
      playerId,
      `${difficulty} dungeon ready: ${plan.roomCount} connected rooms. Keep advancing to generate more rooms!`,
    );
    startDungeonProgress(session);
  });
}
