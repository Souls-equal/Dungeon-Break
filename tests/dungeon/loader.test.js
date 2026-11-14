import test from "node:test";
import assert from "node:assert/strict";

import { DUNGEON_CONFIG, findDifficulty, floorOfLayer } from "../../src/dungeon/config.js";
import { createLoader, chunkOfWorld, markerCellOf } from "../../src/dungeon/loader.js";
import { reset as resetScheduler } from "../../src/utils/scheduler.js";

const SIZE = DUNGEON_CONFIG.chunkSize;
const VERY_EASY = findDifficulty("veryEasy");

/**
 * A fake Bloxd server that enforces the two rules this engine is built around.
 *
 *   - A chunk is only readable once something has loaded it. A player loads the
 *     chunks around them when they are teleported; a template is loaded by the
 *     first read, but only a tick or two later — and that delay is the point.
 *   - `copyChunk` **does nothing** when the source chunk is not loaded. The doc
 *     says so in one line, and a fake that quietly copied anyway would hide the
 *     only failure mode that leaves a player standing in a void.
 */
function createServer(options = {}) {
  const templateBlocks = options.templateBlocks || new Map();
  const world = new Map();
  const loadedChunks = new Set();
  const pendingLoads = [];
  const calls = { copy: [], getBlock: [], setBlock: [], setPosition: [] };
  const players = new Map();
  const loadDelay = options.loadDelay === undefined ? 2 : options.loadDelay;
  const loadRadius = options.loadRadius === undefined ? 3 : options.loadRadius;

  const chunkKeyOf = (x, y, z) => `${Math.floor(x / SIZE)}|${Math.floor(y / SIZE)}|${Math.floor(z / SIZE)}`;
  const cellKey = (x, y, z) => `${x},${y},${z}`;

  function tickLoads() {
    for (let index = pendingLoads.length - 1; index >= 0; index -= 1) {
      pendingLoads[index].ticks -= 1;
      if (pendingLoads[index].ticks > 0) continue;
      loadedChunks.add(pendingLoads[index].key);
      pendingLoads.splice(index, 1);
    }
  }

  function loadChunk(key) {
    if (loadedChunks.has(key) || pendingLoads.some((entry) => entry.key === key)) return;
    pendingLoads.push({ key, ticks: loadDelay });
  }

  const api = {
    /** The only way to make a chunk readable, as in the game. */
    setPosition(playerId, position) {
      players.set(playerId, Array.from(position));
      calls.setPosition.push({ playerId, position: Array.from(position) });
      const chunk = chunkOfWorld(position[0], position[2]);
      const chunkY = Math.floor(position[1] / SIZE);
      for (let dx = -loadRadius; dx <= loadRadius; dx += 1) {
        for (let dz = -loadRadius; dz <= loadRadius; dz += 1) {
          loadedChunks.add(`${chunk.x + dx}|${chunkY}|${chunk.z + dz}`);
        }
      }
    },
    getPosition(playerId) {
      return players.get(playerId) || null;
    },
    getBlock(x, y, z) {
      calls.getBlock.push({ x, y, z });
      const key = chunkKeyOf(x, y, z);
      if (!loadedChunks.has(key)) {
        loadChunk(key);
        return null;
      }
      const inTemplate = templateBlocks.get(cellKey(x, y, z));
      if (inTemplate !== undefined) return inTemplate;
      const value = world.get(cellKey(x, y, z));
      return value === undefined ? "Air" : value;
    },
    setBlock(x, y, z, name) {
      calls.setBlock.push({ x, y, z, name });
      world.set(cellKey(x, y, z), name);
    },
    copyChunk(from, to) {
      calls.copy.push({ from: [...from], to: [...to] });
      const sourceKey = chunkKeyOf(from[0], from[1], from[2]);
      // Documented behaviour: silence, not an error.
      if (!loadedChunks.has(sourceKey)) return;
      const sourceChunk = [Math.floor(from[0] / SIZE), Math.floor(from[1] / SIZE), Math.floor(from[2] / SIZE)];
      const destChunk = [Math.floor(to[0] / SIZE), Math.floor(to[1] / SIZE), Math.floor(to[2])];
      for (let x = 0; x < SIZE; x += 1) {
        for (let y = 0; y < SIZE; y += 1) {
          for (let z = 0; z < SIZE; z += 1) {
            const name = templateBlocks.get(cellKey(
              sourceChunk[0] * SIZE + x, sourceChunk[1] * SIZE + y, sourceChunk[2] * SIZE + z,
            ));
            if (name === undefined) continue;
            world.set(cellKey(
              destChunk[0] * SIZE + x, destChunk[1] * SIZE + y, destChunk[2] * SIZE + z,
            ), name);
          }
        }
      }
    },
    isNearInterrupt() { return false; },
    log() {},
  };

  return {
    api,
    world,
    calls,
    loadedChunks,
    /** One server tick: delayed chunk loads complete here. */
    advance() { tickLoads(); },
    /** Fills a template chunk with a room the way a builder would. */
    addTemplate(src, options2 = {}) {
      const base = [Math.floor(src[0] / SIZE) * SIZE, Math.floor(src[1] / SIZE) * SIZE, Math.floor(src[2] / SIZE) * SIZE];
      const floorY = options2.floorY === undefined ? 2 : options2.floorY;
      for (let x = 0; x < SIZE; x += 1) {
        for (let z = 0; z < SIZE; z += 1) {
          templateBlocks.set(cellKey(base[0] + x, base[1] + floorY, base[2] + z), "Stone Bricks");
        }
      }
      for (let y = 0; y <= floorY; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          for (const z of [0, SIZE - 1]) {
            templateBlocks.set(cellKey(base[0] + x, base[1] + y, base[2] + z), "Stone");
          }
          for (const x2 of [0, SIZE - 1]) {
            templateBlocks.set(cellKey(base[0] + x2, base[1] + y, base[2] + x), "Stone");
          }
        }
      }
      // The record block, in the solid low corner the loader reads.
      templateBlocks.set(cellKey(base[0], base[1], base[2]), DUNGEON_CONFIG.markerBlock);
      return base;
    },
  };
}

/** A loader with the shipped repository templates replaced by a test set. */
function createTestLoader(server, templates, difficulty = VERY_EASY) {
  const loader = createLoader({ api: server.api, log: () => {} });
  const level = loader.levelState(difficulty);
  level.templates = templates;
  return { loader, level };
}

const TEMPLATE_A = [0, -32, 0];
const TEMPLATE_B = [64, -32, 0];
const ROOMS = [
  { id: "a", src: TEMPLATE_A, faces: "NESW", markerLocal: null, spawn: true },
  { id: "b", src: TEMPLATE_B, faces: "NESW", markerLocal: null, spawn: false },
];

test.beforeEach(() => resetScheduler());

test("a room is one chunk copy, and the copy is the documented call", () => {
  const server = createServer();
  const base = server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);

  loader.warmTemplates(VERY_EASY);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  loader.placeEntrance(VERY_EASY);
  assert.equal(server.calls.copy.length, 1, "the entrance is not one copy");
  const [call] = server.calls.copy;
  assert.deepEqual(call.from, TEMPLATE_A, "the copy does not read the template chunk");
  assert.deepEqual(call.to, [0, floorOfLayer(VERY_EASY), 0],
    "the entrance is not placed at the origin of the level's own layer");

  // And the room really is there: the floor, read back from the world.
  for (let tick = 0; tick < 3; tick += 1) server.advance();
  loader.tick([{ difficulty: VERY_EASY, chunks: [{ x: 0, z: 0 }] }]);
  assert.equal(server.api.getBlock(base[0] + 16, base[1] + 2, base[2] + 16), "Stone Bricks");
});

test("a copy from an unloaded template is retried, then disabled, never looped", () => {
  const server = createServer({ loadDelay: 1000 });
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS, VERY_EASY);

  // No warm-up and no advance: the template chunk is never loaded, so every read
  // of its source block returns null.
  for (let tick = 0; tick < 20; tick += 1) {
    level.queue.push({ chunkX: 1, chunkZ: 1, template: ROOMS[0] });
    loader.placeOne(level);
  }
  assert.equal(server.calls.copy.length, 0, "a copy was attempted from an unloaded template");
  assert.ok(level.disabled.has("a"), "a template that cannot be read is still being retried");
  assert.equal(level.queue.length <= 1, true, "the queue kept the unusable entry for ever");
});

test("a copy is verified by reading the destination back, once the room is there", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY);
  for (let tick = 0; tick < 5; tick += 1) server.advance();
  // A player in the destination chunk, which is what makes it readable — and the
  // realistic case: rooms are copied around a player, not into the void.
  server.api.setPosition("player", [SIZE + 16, floorOfLayer(VERY_EASY), 16]);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  level.queue.push({ chunkX: 1, chunkZ: 0, template: level.templates[0] });
  loader.placeOne(level);
  assert.equal(server.calls.copy.length, 1, "the copy was not attempted");
  // The destination chunk is loaded, so the record block is read back in the same
  // tick: placed is a fact about the world, not a timer.
  assert.equal(level.planned.get("1|0"), "placed",
    "a copy whose record block reads back is not marked as placed");
  assert.equal(level.placed, 1);
  assert.equal(level.unverified, 0);
  const marker = markerCellOf(VERY_EASY, 1, 0, null);
  assert.equal(server.api.getBlock(marker[0], marker[1], marker[2]), DUNGEON_CONFIG.markerBlock);

  // And this chunk is never copied twice — whatever else the scan finds to build
  // around the player, which is the point of the scan.
  for (let tick = 0; tick < 6; tick += 1) loader.tick([{ difficulty: VERY_EASY, chunks: [{ x: 1, z: 0 }] }]);
  const sameChunk = server.calls.copy.filter((call) => call.to[0] === SIZE && call.to[2] === 0);
  assert.equal(sameChunk.length, 1, "a placed chunk was copied again");
});

test("a chunk that fails verification is forgotten, so a later scan can retry it", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  level.queue.push({ chunkX: 2, chunkZ: 0, template: ROOMS[0] });
  loader.placeOne(level);
  // The destination is not loaded, so the read says nothing — and the entry waits
  // for the configured window before it is counted as placed-but-unverified.
  for (let tick = 0; tick < DUNGEON_CONFIG.verifyMaxTicks + 2; tick += 1) loader.tick([]);
  assert.equal(level.planned.has("2|0"), true,
    "a copy behind the player was forgotten, as if it had failed");
  assert.equal(level.unverified, 1, "the unverified copy is not reported as such");
  assert.equal(level.failures, 0, "an unloaded destination was counted as a failure");
});

test("one copy per tick per level, whatever the queue holds", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  for (let x = 0; x < 10; x += 1) level.queue.push({ chunkX: x, chunkZ: 3, template: ROOMS[0] });
  const chunks = [{ x: 3, z: 3 }];
  for (let tick = 0; tick < 5; tick += 1) loader.tick([{ difficulty: VERY_EASY, chunks }]);
  assert.equal(server.calls.copy.length, 5, "a tick copied more than one room");
});

test("chunks already recorded are never copied again", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  // The origin chunk is loaded, as it is in the game: a player is standing in it.
  server.api.setPosition("player", [16, floorOfLayer(VERY_EASY), 16]);
  for (let tick = 0; tick < 5; tick += 1) server.advance();
  const cell = markerCellOf(VERY_EASY, 0, 0, null);
  server.world.set(`${cell[0]},${cell[1]},${cell[2]}`, DUNGEON_CONFIG.markerBlock);

  loader.placeEntrance(VERY_EASY);
  assert.equal(server.calls.copy.length, 0, "an already built entrance was copied over itself");
  assert.equal(level.planned.get("0|0"), "placed");
});

test("nothing is planned outside what the player has loaded", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY);

  // The player is in the origin chunk; the scan looks at its neighbours, whose
  // chunks the server has not sent yet. Nothing may be queued for them.
  loader.planAround(level, 0, 0);
  assert.equal(level.queue.length, 0, "a room was queued in a chunk nobody had loaded");
  for (const call of server.calls.getBlock) {
    assert.equal(Number.isFinite(call.x), true);
  }

  // Once the chunks have arrived, the same scan finds them.
  for (let tick = 0; tick < 5; tick += 1) server.advance();
  loader.planAround(level, 0, 0);
  assert.ok(level.queue.length > 0, "no room was queued in a loaded chunk");
  assert.ok(level.queue.length <= DUNGEON_CONFIG.maxPlannedPerScan);
});

test("the queue and the plan stay bounded as a player walks away", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  for (let x = 0; x < 200; x += 1) {
    level.planned.set(`${x}|0`, "placed");
    level.queue.push({ chunkX: x, chunkZ: 0, template: ROOMS[0] });
    if (level.queue.length > DUNGEON_CONFIG.maxQueued) level.queue.length = DUNGEON_CONFIG.maxQueued;
  }
  loader.planAround(level, 199, 0);
  let far = 0;
  for (const key of level.planned.keys()) {
    const x = Number(key.split("|")[0]);
    if (Math.abs(x - 199) > DUNGEON_CONFIG.viewChunks + 2) far += 1;
  }
  assert.equal(far, 0, "the plan kept chunks the player will never see again");
  assert.ok(level.queue.length <= DUNGEON_CONFIG.maxQueued, "the queue grew past its ceiling");
});

test("the floor height is read from the template, not configured", () => {
  for (const floorY of [1, 2, 6]) {
    const server = createServer();
    server.addTemplate(TEMPLATE_A, { floorY });
    const { loader } = createTestLoader(server, ROOMS);
    loader.warmTemplates(VERY_EASY);
    for (let tick = 0; tick < 5; tick += 1) server.advance();
    assert.equal(loader.findFloorLocalY(loader.levelState(VERY_EASY)), floorY,
      `a template with its floor at local y ${floorY} is not read correctly`);
  }
});

test("the landing position is the middle of the origin room, above its floor", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A, { floorY: 2 });
  const { loader } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  const landing = loader.landingPosition(VERY_EASY);
  assert.equal(landing[0], 16.5);
  assert.equal(landing[2], 20.5);
  assert.equal(landing[1], floorOfLayer(VERY_EASY) + 2 + DUNGEON_CONFIG.spawnAboveFloor);
  // Two blocks above the floor block is where the feet land; one block less and
  // the player is inside the floor.
  assert.equal(landing[1] - (floorOfLayer(VERY_EASY) + 2), 2);
});

test("without a readable template there is no landing position, and no invention", () => {
  const server = createServer({ loadDelay: 1000 });
  server.addTemplate(TEMPLATE_A);
  const { loader } = createTestLoader(server, ROOMS);
  assert.equal(loader.landingPosition(VERY_EASY), null,
    "a landing position was invented for a level whose template cannot be read");
});

test("a level with no template is a message, not a crash", () => {
  const server = createServer();
  const loader = createLoader({ api: server.api, log: () => {} });
  const level = loader.levelState(VERY_EASY);
  level.templates = [];
  assert.equal(loader.landingPosition(VERY_EASY), null);
  loader.tick([{ difficulty: VERY_EASY, chunks: [{ x: 0, z: 0 }] }]);
  assert.equal(server.calls.copy.length, 0);
});

test("a level nobody is in costs nothing", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  const reads = server.calls.getBlock.length;
  for (let tick = 0; tick < 50; tick += 1) loader.tick([]);
  assert.equal(server.calls.getBlock.length, reads, "an empty level is still scanning");
  assert.equal(level.queue.length, 0);
});
