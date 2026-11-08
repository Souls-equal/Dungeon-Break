import { setInterval as scheduleInterval } from "../utils/scheduler.js";

const DUNGEON_CONFIG = {
  minCoordinate: -50000,
  maxCoordinate: 50000,
  floorY: -1000,
  roomSize: 5,
  wallHeight: 3,
  corridorWidth: 3,
  stairwellSize: 3,
  levelGap: 8,
  blocksPerTick: 12,
  blockName: "Stone Bricks",
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
  levelsByDifficulty: {
    "Very Easy": 2,
    Easy: 2,
    Medium: 3,
    Normal: 3,
    Hard: 3,
    Insane: 4,
    "Ultra Insane": 4,
    Hell: 5,
  },
};

const RANDOM_MODULUS = 2147483647;
const STAIR_RING_PATH = [
  [1, 0], [2, 0], [2, 1], [2, 2],
  [1, 2], [0, 2], [0, 1], [0, 0],
];
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
  const totalCells = cellCount * cellCount;
  const visited = new Array(totalCells).fill(false);
  const eastOpen = new Array(totalCells).fill(false);
  const southOpen = new Array(totalCells).fill(false);
  const eastNarrow = new Array(totalCells).fill(false);
  const southNarrow = new Array(totalCells).fill(false);
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
    const narrowPassage = randomInteger(random, 0, 1) === 0;
    if (direction === "west") {
      eastOpen[next] = true;
      eastNarrow[next] = narrowPassage;
    }
    if (direction === "east") {
      eastOpen[current] = true;
      eastNarrow[current] = narrowPassage;
    }
    if (direction === "north") {
      southOpen[next] = true;
      southNarrow[next] = narrowPassage;
    }
    if (direction === "south") {
      southOpen[current] = true;
      southNarrow[current] = narrowPassage;
    }

    visited[next] = true;
    stack.push(next);
  }

  return { eastOpen, southOpen, eastNarrow, southNarrow };
}

function addRect(rects, x1, y1, z1, x2, y2, z2) {
  if (x1 > x2 || y1 > y2 || z1 > z2) return;
  rects.push({ from: [x1, y1, z1], to: [x2, y2, z2] });
}

function addWall(walls, x1, y1, z1, x2, y2, z2) {
  addRect(walls, x1, y1, z1, x2, y2, z2);
}

function makeFloorRects(originX, originZ, maxX, maxZ, floorY, stairwell) {
  const { minX, maxX: holeMaxX, minZ, maxZ: holeMaxZ } = stairwell;
  const floors = [];

  // Four rectangles leave a 3x3 open shaft in the exit room.
  addRect(floors, originX, floorY, originZ, maxX, floorY, minZ - 1);
  addRect(floors, originX, floorY, holeMaxZ + 1, maxX, floorY, maxZ);
  addRect(floors, originX, floorY, minZ, minX - 1, floorY, holeMaxZ);
  addRect(floors, holeMaxX + 1, floorY, minZ, maxX, floorY, holeMaxZ);

  return floors;
}

function addHorizontalDoorWalls(walls, originX, maxX, z, gapStartX, gapWidth, yBottom, yTop) {
  addWall(walls, originX, yBottom, z, gapStartX - 1, yTop, z);
  addWall(walls, gapStartX + gapWidth, yBottom, z, maxX, yTop, z);
}

function makeFloorPlan(seed, options) {
  const random = makeRandom(seed);
  const {
    cellCount,
    originX,
    originZ,
    floorY,
    levelIndex,
    levelCount,
    width,
    stairwell,
  } = options;
  const roomStride = DUNGEON_CONFIG.roomSize + 1;
  const maxX = originX + width - 1;
  const maxZ = originZ + width - 1;
  const wallBottomY = floorY + 1;
  const wallTopY = floorY + DUNGEON_CONFIG.wallHeight;
  const { eastOpen, southOpen, eastNarrow, southNarrow } = makeMazeEdges(cellCount, random);
  const walls = [];
  const roomStyleCounts = { open: 0, pillar: 0, twinPillars: 0, alcove: 0 };
  let pillarCount = 0;
  let alcoveCount = 0;
  let narrowCorridorCount = 0;
  let widePassageCount = 0;

  const firstRoomX = originX + 1;
  const firstRoomZ = originZ + 1;
  const entranceGapStart = firstRoomX + 1;
  const exitCell = cellCount * cellCount - 1;
  const exitColumn = exitCell % cellCount;
  const exitRow = (exitCell - exitColumn) / cellCount;
  const exitRoomX = originX + 1 + exitColumn * roomStride;
  const exitRoomZ = originZ + 1 + exitRow * roomStride;
  const exitGapStart = exitRoomX + 1;

  // Outer perimeter. Only the bottom floor has an entrance; only the top has an exit.
  if (levelIndex === 0) {
    addHorizontalDoorWalls(walls, originX, maxX, originZ, entranceGapStart, 3, wallBottomY, wallTopY);
  } else {
    addWall(walls, originX, wallBottomY, originZ, maxX, wallTopY, originZ);
  }

  if (levelIndex === levelCount - 1) {
    addHorizontalDoorWalls(walls, originX, maxX, maxZ, exitGapStart, 3, wallBottomY, wallTopY);
  } else {
    addWall(walls, originX, wallBottomY, maxZ, maxX, wallTopY, maxZ);
  }
  addWall(walls, originX, wallBottomY, originZ, originX, wallTopY, maxZ);
  addWall(walls, maxX, wallBottomY, originZ, maxX, wallTopY, maxZ);

  // Internal dividers: some remain closed, some become wide archways, and
  // some become explicit three-block-wide corridors inside the five-block rooms.
  for (let row = 0; row < cellCount; row += 1) {
    for (let column = 0; column < cellCount; column += 1) {
      const index = row * cellCount + column;
      const roomX = originX + 1 + column * roomStride;
      const roomZ = originZ + 1 + row * roomStride;

      if (column + 1 < cellCount) {
        const dividerX = roomX + DUNGEON_CONFIG.roomSize;
        if (!eastOpen[index]) {
          addWall(
            walls,
            dividerX,
            wallBottomY,
            roomZ,
            dividerX,
            wallTopY,
            roomZ + DUNGEON_CONFIG.roomSize - 1,
          );
        } else if (eastNarrow[index]) {
          const edge = (DUNGEON_CONFIG.roomSize - DUNGEON_CONFIG.corridorWidth) / 2;
          addWall(walls, dividerX, wallBottomY, roomZ, dividerX, wallTopY, roomZ + edge - 1);
          addWall(
            walls,
            dividerX,
            wallBottomY,
            roomZ + edge + DUNGEON_CONFIG.corridorWidth,
            dividerX,
            wallTopY,
            roomZ + DUNGEON_CONFIG.roomSize - 1,
          );
          narrowCorridorCount += 1;
        } else {
          widePassageCount += 1;
        }
      }

      if (row + 1 < cellCount) {
        const dividerZ = roomZ + DUNGEON_CONFIG.roomSize;
        if (!southOpen[index]) {
          addWall(
            walls,
            roomX,
            wallBottomY,
            dividerZ,
            roomX + DUNGEON_CONFIG.roomSize - 1,
            wallTopY,
            dividerZ,
          );
        } else if (southNarrow[index]) {
          const edge = (DUNGEON_CONFIG.roomSize - DUNGEON_CONFIG.corridorWidth) / 2;
          addWall(walls, roomX, wallBottomY, dividerZ, roomX + edge - 1, wallTopY, dividerZ);
          addWall(
            walls,
            roomX + edge + DUNGEON_CONFIG.corridorWidth,
            wallBottomY,
            dividerZ,
            roomX + DUNGEON_CONFIG.roomSize - 1,
            wallTopY,
            dividerZ,
          );
          narrowCorridorCount += 1;
        } else {
          widePassageCount += 1;
        }
      }

      // The start/stairwell and goal rooms stay open. The rest get one of
      // several simple Stone Bricks room silhouettes.
      const lastCell = cellCount * cellCount - 1;
      if (index === 0 || index === lastCell) {
        roomStyleCounts.open += 1;
        continue;
      }

      const styleRoll = randomInteger(random, 0, 9);
      if (styleRoll <= 3) {
        roomStyleCounts.open += 1;
      } else if (styleRoll <= 6) {
        roomStyleCounts.pillar += 1;
        const pillarX = roomX + 2;
        const pillarZ = roomZ + 2;
        const pillarHeight = randomInteger(random, 2, DUNGEON_CONFIG.wallHeight);
        addWall(walls, pillarX, wallBottomY, pillarZ, pillarX, floorY + pillarHeight, pillarZ);
        pillarCount += 1;
      } else if (styleRoll <= 8) {
        roomStyleCounts.twinPillars += 1;
        const pillarHeight = randomInteger(random, 2, DUNGEON_CONFIG.wallHeight);
        addWall(walls, roomX + 1, wallBottomY, roomZ + 1, roomX + 1, floorY + pillarHeight, roomZ + 1);
        addWall(walls, roomX + 3, wallBottomY, roomZ + 3, roomX + 3, floorY + pillarHeight, roomZ + 3);
        pillarCount += 2;
      } else {
        roomStyleCounts.alcove += 1;
        addWall(walls, roomX + 1, wallBottomY, roomZ + 1, roomX + 1, wallTopY, roomZ + 2);
        addWall(walls, roomX + 3, wallBottomY, roomZ + 2, roomX + 3, wallTopY, roomZ + 3);
        alcoveCount += 2;
      }
    }
  }

  const floorRects = makeFloorRects(originX, originZ, maxX, maxZ, floorY, stairwell);
  if (levelIndex === 0) {
    addRect(floorRects, entranceGapStart, floorY, originZ - 2, entranceGapStart + 2, floorY, originZ - 1);
  }
  if (levelIndex === levelCount - 1) {
    addRect(floorRects, exitGapStart, floorY, maxZ + 1, exitGapStart + 2, floorY, maxZ + 2);
  }

  return {
    floorY,
    floorRects,
    walls,
    passageCount: eastOpen.filter(Boolean).length + southOpen.filter(Boolean).length,
    narrowCorridorCount,
    widePassageCount,
    pillarCount,
    alcoveCount,
    roomStyleCounts,
  };
}

// The plan builder is pure; tests can inspect connectivity, level heights,
// room variety and stair continuity without Bloxd globals.
export function createDungeonPlan(seed, difficulty) {
  const random = makeRandom(seed);
  const cellCount = DUNGEON_CONFIG.cellsByDifficulty[difficulty] || DUNGEON_CONFIG.cellsByDifficulty.Normal;
  const levelCount = DUNGEON_CONFIG.levelsByDifficulty[difficulty] || DUNGEON_CONFIG.levelsByDifficulty.Normal;
  const roomStride = DUNGEON_CONFIG.roomSize + 1;
  const width = cellCount * roomStride + 1;
  // Reserve two Z blocks for the entry and exit landing platforms.
  const maxOrigin = DUNGEON_CONFIG.maxCoordinate - width - 1;
  const originX = randomInteger(random, DUNGEON_CONFIG.minCoordinate, maxOrigin);
  const originZ = randomInteger(random, DUNGEON_CONFIG.minCoordinate + 2, maxOrigin);
  const firstRoomX = originX + 1;
  const firstRoomZ = originZ + 1;
  const stairwellOffset = (DUNGEON_CONFIG.roomSize - DUNGEON_CONFIG.stairwellSize) / 2;
  const exitCell = cellCount * cellCount - 1;
  const exitColumn = exitCell % cellCount;
  const exitRow = (exitCell - exitColumn) / cellCount;
  const exitRoomX = originX + 1 + exitColumn * roomStride;
  const exitRoomZ = originZ + 1 + exitRow * roomStride;
  const stairwell = {
    minX: exitRoomX + stairwellOffset,
    maxX: exitRoomX + stairwellOffset + DUNGEON_CONFIG.stairwellSize - 1,
    minZ: exitRoomZ + stairwellOffset,
    maxZ: exitRoomZ + stairwellOffset + DUNGEON_CONFIG.stairwellSize - 1,
  };
  const floors = [];
  const walls = [];
  const floorRects = [];
  let totalPillars = 0;
  let totalAlcoves = 0;
  let totalNarrowCorridors = 0;
  let totalWidePassages = 0;

  for (let levelIndex = 0; levelIndex < levelCount; levelIndex += 1) {
    const levelSeed = (seed + (levelIndex + 1) * 104729) % RANDOM_MODULUS || 1;
    const floor = makeFloorPlan(levelSeed, {
      cellCount,
      originX,
      originZ,
      floorY: DUNGEON_CONFIG.floorY + levelIndex * DUNGEON_CONFIG.levelGap,
      levelIndex,
      levelCount,
      width,
      stairwell,
    });
    floors.push(floor);
    floorRects.push(...floor.floorRects);
    walls.push(...floor.walls);
    totalPillars += floor.pillarCount;
    totalAlcoves += floor.alcoveCount;
    totalNarrowCorridors += floor.narrowCorridorCount;
    totalWidePassages += floor.widePassageCount;
  }

  const stairBlocks = [];
  const outerRingPath = STAIR_RING_PATH;
  for (let levelIndex = 0; levelIndex < levelCount; levelIndex += 1) {
    const baseY = DUNGEON_CONFIG.floorY + levelIndex * DUNGEON_CONFIG.levelGap;
    // Each full ring rises one floor. On the top floor, one landing block
    // keeps the stairwell safely connected to that level's walkway.
    const stepCount = levelIndex < levelCount - 1 ? outerRingPath.length : 1;
    for (let step = 0; step < stepCount; step += 1) {
      const [dx, dz] = outerRingPath[step];
      const x = stairwell.minX + dx;
      const z = stairwell.minZ + dz;
      const y = baseY + step;
      addWall(stairBlocks, x, y, z, x, y, z);
    }
  }

  const spawnRoomCenterX = firstRoomX + (DUNGEON_CONFIG.roomSize - 1) / 2;
  const spawnRoomCenterZ = firstRoomZ + (DUNGEON_CONFIG.roomSize - 1) / 2;

  return {
    originX,
    originZ,
    width,
    cellCount,
    levelCount,
    floorY: DUNGEON_CONFIG.floorY,
    levelGap: DUNGEON_CONFIG.levelGap,
    floors,
    floorRects,
    walls,
    stairBlocks,
    stairwell,
    spawnPosition: [spawnRoomCenterX + 0.5, DUNGEON_CONFIG.floorY + 1, spawnRoomCenterZ + 0.5],
    passageCount: floors[0].passageCount,
    narrowCorridorCount: totalNarrowCorridors,
    widePassageCount: totalWidePassages,
    pillarCount: totalPillars,
    alcoveCount: totalAlcoves,
  };
}

function nextDungeonSeed() {
  dungeonSequence += 1;
  const timeSeed = api.now() % RANDOM_MODULUS;
  return (timeSeed + dungeonSequence * 104729) % RANDOM_MODULUS || 1;
}

function isPlayerOnline(playerId) {
  try {
    return api.getPlayerIds().indexOf(playerId) !== -1;
  } catch (_) {
    return false;
  }
}

function reportGenerationFailure(playerId, error) {
  try {
    api.log(`[Dungeon] Stone Bricks generation failed: ${error && error.message ? error.message : error}`);
  } catch (_) {
    // Logging must not hide the generation failure.
  }

  if (isPlayerOnline(playerId)) {
    api.sendMessage(playerId, "Dungeon generation failed. Please try again.");
  }
}

export function generateDungeon(playerId, difficulty) {
  const plan = createDungeonPlan(nextDungeonSeed(), difficulty);
  const operations = [];

  for (const floor of plan.floors) operations.push(...floor.floorRects);
  for (const floor of plan.floors) operations.push(...floor.walls);
  operations.push(...plan.stairBlocks);

  if (isPlayerOnline(playerId)) {
    api.sendMessage(playerId, `Building a ${difficulty} dungeon with ${plan.levelCount} floors...`);
  }

  let nextOperation = 0;
  const buildTimer = scheduleInterval(() => {
    try {
      let placedThisTick = 0;
      while (nextOperation < operations.length && placedThisTick < DUNGEON_CONFIG.blocksPerTick) {
        const operation = operations[nextOperation];
        api.setBlockRect(operation.from, operation.to, DUNGEON_CONFIG.blockName);
        nextOperation += 1;
        placedThisTick += 1;
      }
    } catch (error) {
      buildTimer.stop();
      reportGenerationFailure(playerId, error);
      return;
    }

    if (nextOperation < operations.length) return;

    buildTimer.stop();
    if (!isPlayerOnline(playerId)) return;

    try {
      api.setPosition(playerId, plan.spawnPosition);
      api.sendMessage(
        playerId,
        `${difficulty} dungeon ready: ${plan.levelCount} floors. Find the exit at the top!`,
      );
    } catch (error) {
      reportGenerationFailure(playerId, error);
    }
  }, 1);
}
