import { setInterval as scheduleInterval } from "../utils/scheduler.js";

const DUNGEON_CONFIG = {
  minCoordinate: -50000,
  maxCoordinate: 50000,
  floorY: -1000,
  roomSize: 3,
  wallHeight: 3,
  blocksPerTick: 4,
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
};

const RANDOM_MODULUS = 2147483647;
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

  return { eastOpen, southOpen };
}

function addWall(walls, x1, y1, z1, x2, y2, z2) {
  walls.push({ from: [x1, y1, z1], to: [x2, y2, z2] });
}

// Pure layout builder, exported so the maze bounds and connectivity can be tested.
export function createDungeonPlan(seed, difficulty) {
  const random = makeRandom(seed);
  const cellCount = DUNGEON_CONFIG.cellsByDifficulty[difficulty] || DUNGEON_CONFIG.cellsByDifficulty.Normal;
  const roomStride = DUNGEON_CONFIG.roomSize + 1;
  const width = cellCount * roomStride + 1;
  const maxOrigin = DUNGEON_CONFIG.maxCoordinate - width + 1;
  const originX = randomInteger(random, DUNGEON_CONFIG.minCoordinate, maxOrigin);
  const originZ = randomInteger(random, DUNGEON_CONFIG.minCoordinate, maxOrigin);
  const { eastOpen, southOpen } = makeMazeEdges(cellCount, random);
  const walls = [];
  const wallBottomY = DUNGEON_CONFIG.floorY + 1;
  const wallTopY = DUNGEON_CONFIG.floorY + DUNGEON_CONFIG.wallHeight;
  const maxX = originX + width - 1;
  const maxZ = originZ + width - 1;

  // Outer shell, with a wide entrance at the start and an exit opposite it.
  const entranceX = originX + 1;
  const exitX = originX + 1 + (cellCount - 1) * roomStride;
  addWall(walls, originX, wallBottomY, originZ, entranceX - 1, wallTopY, originZ);
  addWall(
    walls,
    entranceX + DUNGEON_CONFIG.roomSize,
    wallBottomY,
    originZ,
    maxX,
    wallTopY,
    originZ,
  );
  addWall(walls, originX, wallBottomY, maxZ, exitX - 1, wallTopY, maxZ);
  addWall(
    walls,
    exitX + DUNGEON_CONFIG.roomSize,
    wallBottomY,
    maxZ,
    maxX,
    wallTopY,
    maxZ,
  );
  addWall(walls, originX, wallBottomY, originZ, originX, wallTopY, maxZ);
  addWall(walls, maxX, wallBottomY, originZ, maxX, wallTopY, maxZ);

  // Close every divider without a DFS-carved passage.
  for (let row = 0; row < cellCount; row += 1) {
    for (let column = 0; column < cellCount; column += 1) {
      const index = row * cellCount + column;
      const roomX = originX + 1 + column * roomStride;
      const roomZ = originZ + 1 + row * roomStride;

      if (column + 1 < cellCount && !eastOpen[index]) {
        const dividerX = roomX + DUNGEON_CONFIG.roomSize;
        addWall(
          walls,
          dividerX,
          wallBottomY,
          roomZ,
          dividerX,
          wallTopY,
          roomZ + DUNGEON_CONFIG.roomSize - 1,
        );
      }

      if (row + 1 < cellCount && !southOpen[index]) {
        const dividerZ = roomZ + DUNGEON_CONFIG.roomSize;
        addWall(
          walls,
          roomX,
          wallBottomY,
          dividerZ,
          roomX + DUNGEON_CONFIG.roomSize - 1,
          wallTopY,
          dividerZ,
        );
      }
    }
  }

  const spawnRoomX = originX + 1 + (DUNGEON_CONFIG.roomSize - 1) / 2;
  const spawnRoomZ = originZ + 1 + (DUNGEON_CONFIG.roomSize - 1) / 2;

  return {
    originX,
    originZ,
    width,
    floorY: DUNGEON_CONFIG.floorY,
    floorFrom: [originX, DUNGEON_CONFIG.floorY, originZ],
    floorTo: [maxX, DUNGEON_CONFIG.floorY, maxZ],
    spawnPosition: [spawnRoomX + 0.5, DUNGEON_CONFIG.floorY + 1, spawnRoomZ + 0.5],
    walls,
    passageCount: eastOpen.filter(Boolean).length + southOpen.filter(Boolean).length,
    cellCount,
  };
}

function nextDungeonSeed() {
  dungeonSequence += 1;
  const timeSeed = api.now() % RANDOM_MODULUS;
  return (timeSeed + dungeonSequence * 104729) % RANDOM_MODULUS || 1;
}

function isPlayerStillInLobby(playerId) {
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

  if (isPlayerStillInLobby(playerId)) {
    api.sendMessage(playerId, "Dungeon generation failed. Please try again.");
  }
}

export function generateDungeon(playerId, difficulty) {
  const plan = createDungeonPlan(nextDungeonSeed(), difficulty);

  try {
    // The rectangle API is designed for setting broad areas efficiently.
    api.setBlockRect(plan.floorFrom, plan.floorTo, DUNGEON_CONFIG.blockName);
  } catch (error) {
    reportGenerationFailure(playerId, error);
    return;
  }

  if (isPlayerStillInLobby(playerId)) {
    api.sendMessage(playerId, `Building a ${difficulty} Stone Bricks maze...`);
  }

  let nextWall = 0;
  const buildTimer = scheduleInterval(() => {
    try {
      let placedThisTick = 0;
      while (nextWall < plan.walls.length && placedThisTick < DUNGEON_CONFIG.blocksPerTick) {
        const wall = plan.walls[nextWall];
        api.setBlockRect(wall.from, wall.to, DUNGEON_CONFIG.blockName);
        nextWall += 1;
        placedThisTick += 1;
      }
    } catch (error) {
      buildTimer.stop();
      reportGenerationFailure(playerId, error);
      return;
    }

    if (nextWall < plan.walls.length) return;

    buildTimer.stop();
    if (!isPlayerStillInLobby(playerId)) return;

    try {
      api.setPosition(playerId, plan.spawnPosition);
      api.sendMessage(playerId, `${difficulty} maze ready. Find your way through the Stone Bricks dungeon!`);
    } catch (error) {
      reportGenerationFailure(playerId, error);
    }
  }, 1);
}
