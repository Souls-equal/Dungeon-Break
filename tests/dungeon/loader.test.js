import test from "node:test";
import assert from "node:assert/strict";

import { DUNGEON_CONFIG, findDifficulty, floorOfLayer } from "../../src/dungeon/config.js";
import { createLoader, chunkOfWorld } from "../../src/dungeon/loader.js";
import { reset as resetScheduler } from "../../src/utils/scheduler.js";

const SIZE = DUNGEON_CONFIG.chunkSize;
const VERY_EASY = findDifficulty("veryEasy");

/**
 * A fake Bloxd server that enforces the three rules this engine is built around.
 *
 *   - A chunk is readable only once the server has sent it. A `getBlock` in an
 *     unsent chunk **is the request**: the chunk arrives `loadDelay` ticks later,
 *     which is the behaviour the whole engine is timed on.
 *   - A destination chunk that has not been sent rejects a copy, silently.
 *   - `copyChunk` **does nothing** when the source chunk is not loaded either. The
 *     doc says so in one line, and a fake that quietly copied anyway would hide the
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
      const destinationKey = chunkKeyOf(to[0], to[1], to[2]);
      // Documented behaviour: silence, not an error — at either end.
      if (!loadedChunks.has(sourceKey) || !loadedChunks.has(destinationKey)) return;
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
    templateBlocks,
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
      // Bedrock under the floor and over the ceiling, as every built room has: this
      // is the record the engine reads to know a chunk holds a room. Nothing is
      // written by the code.
      for (let x = 0; x < SIZE; x += 1) {
        for (let z = 0; z < SIZE; z += 1) {
          templateBlocks.set(cellKey(base[0] + x, base[1] + floorY - 1, base[2] + z), "Bedrock");
          templateBlocks.set(cellKey(base[0] + x, base[1] + SIZE - 1, base[2] + z), "Bedrock");
        }
      }
      return base;
    },
  };
}

/** A loader with the shipped repository templates replaced by a test set. */
// The place these tests build at: the engine draws one per entry, in all three
// directions, and a test that asserts absolute coordinates wants a known one. Layer 0
// keeps the numbers small; the drawn layer is a number like any other.
const TEST_ORIGIN = { x: 0, y: 0, z: 0 };

function createTestLoader(server, templates, difficulty = VERY_EASY, entryId = "player") {
  const loader = createLoader({ api: server.api, log: () => {} });
  const level = loader.levelState(difficulty, entryId);
  level.templates = templates;
  level.origin = { ...TEST_ORIGIN };
  return { loader, level, entryId };
}

/**
 * Wipes what the loader remembers about the entrance chunk, so `placeEntrance` copies
 * again — the state a fresh level is in, and the state a test needs when it swaps the
 * room under the entrance between two runs.
 */
function forgetEntrance(level) {
  level.entrance = null;
  level.planned.delete(`${TEST_ORIGIN.x}|${TEST_ORIGIN.z}`);
}

/** Marks a chunk as requested and ready now, as a scan or the entrance does. */
function readyNow(level, chunkX, chunkZ) {
  level.ready.set(`${chunkX}|${chunkZ}`, level.tick);
}

const TEMPLATE_A = [0, -32, 0];
const TEMPLATE_B = [64, -32, 0];
const ROOMS = [
  { index: 0, src: TEMPLATE_A, faces: "NESW", spawn: true },
  { index: 1, src: TEMPLATE_B, faces: "NESW", spawn: false },
];

test.beforeEach(() => resetScheduler());

test("a room is one chunk copy, and the copy is the documented call", () => {
  const server = createServer();
  const base = server.addTemplate(TEMPLATE_A);
  const { loader, level, entryId } = createTestLoader(server, ROOMS);

  loader.warmTemplates(VERY_EASY, entryId);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  loader.placeEntrance(VERY_EASY, entryId);
  assert.equal(server.calls.copy.length, 1, "the entrance is not one copy");
  const [call] = server.calls.copy;
  assert.deepEqual(call.from, TEMPLATE_A, "the copy does not read the template chunk");
  assert.deepEqual(call.to, [0, floorOfLayer(TEST_ORIGIN.y), 0],
    "the entrance is not placed at the origin of the level's own layer");

  // And the room really is there: the floor, read back from the world.
  for (let tick = 0; tick < 3; tick += 1) server.advance();
  loader.tick([{ difficulty: VERY_EASY, entryId, chunks: [{ x: 0, z: 0 }] }]);
  assert.equal(server.api.getBlock(base[0] + 16, base[1] + 2, base[2] + 16), "Stone Bricks");
});


test("the loader never writes a block, anywhere", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level, entryId } = createTestLoader(server, ROOMS);
  // A player in the destination chunk, so every read is answered.
  server.api.setPosition("player", [16, floorOfLayer(TEST_ORIGIN.y), 16]);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  const written = server.calls.setBlock.length;
  loader.placeEntrance(VERY_EASY, entryId);
  for (let tick = 0; tick < 20; tick += 1) loader.tick([{ difficulty: VERY_EASY, entryId, chunks: [{ x: 0, z: 0 }] }]);

  assert.deepEqual(server.calls.setBlock.slice(written), [],
    "the loader wrote into a room: a template is hand-built and must only be copied");
});

test("a copied room is confirmed by the world on the next tick", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level, entryId } = createTestLoader(server, ROOMS);
  // The template chunk has to be sent before it can be copied from.
  loader.warmTemplates(VERY_EASY, entryId);
  server.api.setPosition("player", [16, floorOfLayer(TEST_ORIGIN.y), 16]);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  loader.placeEntrance(VERY_EASY, entryId);
  assert.equal(level.planned.get("0|0"), "placing", "the entrance was not copied");
  // Counted as in flight, not as placed: the copy has not been applied yet.
  assert.equal(level.placed, 0, "a copy was counted as a room before the world showed it");

  // One tick later the room answers, and the counter says what the world says.
  loader.tick([{ difficulty: VERY_EASY, entryId, chunks: [{ x: 0, z: 0 }] }]);
  assert.equal(level.planned.get("0|0"), "placed");
  assert.equal(level.placed, 1);
  assert.equal(loader.statsOf(VERY_EASY, entryId).inFlight, 0);

  // Within the session, the room is never copied twice.
  for (let tick = 0; tick < 10; tick += 1) loader.tick([{ difficulty: VERY_EASY, entryId, chunks: [{ x: 0, z: 0 }] }]);
  const sameRoom = server.calls.copy.filter((call) => call.to[0] === 0 && call.to[2] === 0);
  assert.equal(sameRoom.length, 1, "a room copied in this session was copied again");
});

test("a room of a previous session is found by its Bedrock, not rebuilt", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level, entryId } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY, entryId);
  server.api.setPosition("player", [16, floorOfLayer(TEST_ORIGIN.y), 16]);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  loader.placeEntrance(VERY_EASY, entryId);
  loader.tick([{ difficulty: VERY_EASY, entryId, chunks: [{ x: 0, z: 0 }] }]);
  const copies = server.calls.copy.length;

  // A new loader is a restart: no memory at all, and the world is the only witness.
  const restarted = createLoader({ api: server.api, log: () => {} });
  const fresh = restarted.levelState(VERY_EASY, "player");
  fresh.templates = ROOMS;
  fresh.origin = { ...TEST_ORIGIN };
  restarted.placeEntrance(VERY_EASY, "player");

  assert.equal(server.calls.copy.length, copies, "a room already in the world was copied again");
  assert.equal(fresh.planned.get("0|0"), "placed");
});

test("a chunk says whether it is sent and whether it holds a room", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level, entryId } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY, entryId);
  for (let tick = 0; tick < 5; tick += 1) server.advance();
  server.api.setPosition("player", [16, floorOfLayer(TEST_ORIGIN.y), 16]);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  // A chunk nobody asked for: the probe is the request, and the answer is honest.
  const unsent = loader.probeChunk(40, TEST_ORIGIN.y, 40);
  assert.deepEqual(unsent, { loaded: false, occupied: false });

  // The entrance chunk, empty: sent, and nothing in it.
  assert.deepEqual(loader.probeChunk(0, TEST_ORIGIN.y, 0), { loaded: true, occupied: false });

  // After the copy: sent, and a room.
  loader.placeEntrance(VERY_EASY, entryId);
  assert.deepEqual(loader.probeChunk(0, TEST_ORIGIN.y, 0), { loaded: true, occupied: true });

  // The template chunk, which holds the room being copied.
  assert.deepEqual(loader.probeChunk(0, -1, 0), { loaded: true, occupied: true });
});

test("only Bedrock proves a room; ground at the same depth does not", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, entryId } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY, entryId);
  for (let tick = 0; tick < 5; tick += 1) server.advance();
  server.api.setPosition("player", [16, floorOfLayer(TEST_ORIGIN.y), 16]);

  const [localX, localZ] = DUNGEON_CONFIG.probeLocalXZ;
  // Terrain at a room's depth, in the cell the probe reads: not a room. Counting it
  // as one would skip the copy and leave the player with nothing to land on.
  server.templateBlocks.set(`${localX},${floorOfLayer(TEST_ORIGIN.y)},${localZ}`, "Stone");
  assert.deepEqual(loader.probeChunk(0, TEST_ORIGIN.y, 0), { loaded: true, occupied: false });

  // The room's own shell, in the same cell: a room.
  server.templateBlocks.set(`${localX},${floorOfLayer(TEST_ORIGIN.y)},${localZ}`, "Bedrock");
  assert.deepEqual(loader.probeChunk(0, TEST_ORIGIN.y, 0), { loaded: true, occupied: true });

  // And a room with no ceiling Bedrock is still a room, by its floor.
  const top = TEST_ORIGIN.y * SIZE + SIZE - 1;
  server.templateBlocks.set(`${localX},${top},${localZ}`, "Air");
  assert.deepEqual(loader.probeChunk(0, TEST_ORIGIN.y, 0), { loaded: true, occupied: true },
    "a room whose ceiling is open was read as empty");
});

test("a copy waits for the chunk it was asked about, then lands", () => {
  const server = createServer({ loadDelay: 2, loadRadius: 0 });
  server.addTemplate(TEMPLATE_A);
  const { loader, level, entryId } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY, entryId);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  // The player only loads what is loaded for real: nothing near the destination, so
  // the scan's probe has to request it.
  server.api.setPosition("player", [900, floorOfLayer(TEST_ORIGIN.y), 900]);
  loader.planAround(level, 0, 0);
  assert.ok(server.calls.getBlock.length > 0, "the scan did not ask for anything");
  assert.equal(level.queue.length, 0, "a copy was queued before the chunk was sent");

  // Two ticks later the chunk exists: the scan queues it, the copy lands, and the
  // next tick's probe confirms the room.
  for (let tick = 0; tick < 2; tick += 1) server.advance();
  loader.planAround(level, 0, 0);
  assert.ok(level.queue.length > 0, "the chunk was sent but never queued");
  loader.tick([{ difficulty: VERY_EASY, entryId, chunks: [{ x: 0, z: 0 }] }]);
  const copied = server.calls.copy.length;
  assert.equal(copied > 0, true, "nothing was copied once the destination existed");
  loader.tick([{ difficulty: VERY_EASY, entryId, chunks: [{ x: 0, z: 0 }] }]);
  assert.equal(level.placed > 0, true, "the copy was never seen by the probe");
});

test("a copy from an unloaded template is retried, then disabled, never looped", () => {
  const server = createServer({ loadDelay: 1000 });
  server.addTemplate(TEMPLATE_A);
  const { loader, level, entryId } = createTestLoader(server, ROOMS, VERY_EASY);

  // No warm-up and no advance: the template chunk is never loaded, so every read
  // of its source block returns null. The destination is ready, so the template is
  // the only thing standing between the level and a copy.
  for (let tick = 0; tick < 20; tick += 1) {
    readyNow(level, 1, 1);
    level.queue.push({ chunkX: 1, chunkZ: 1, template: ROOMS[0] });
    loader.placeOne(level);
  }
  assert.equal(server.calls.copy.length, 0, "a copy was attempted from an unloaded template");
  assert.ok(level.disabled.has(0), "a template that cannot be read is still being retried");
  assert.equal(level.queue.length <= 1, true, "the queue kept the unusable entry for ever");
});

test("a room is placed once in a session, and only where the server has sent it", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level, entryId } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY, entryId);
  for (let tick = 0; tick < 5; tick += 1) server.advance();
  server.api.setPosition("player", [SIZE + 16, floorOfLayer(TEST_ORIGIN.y), 16]);

  readyNow(level, 1, 0);
  level.queue.push({ chunkX: 1, chunkZ: 0, template: level.templates[0] });
  loader.placeOne(level);
  assert.equal(server.calls.copy.length, 1, "the copy was not attempted");
  assert.equal(level.planned.get("1|0"), "placing");

  // Never copied twice, whatever else the scan finds to build around the player.
  for (let tick = 0; tick < 6; tick += 1) loader.tick([{ difficulty: VERY_EASY, entryId, chunks: [{ x: 1, z: 0 }] }]);
  const sameChunk = server.calls.copy.filter((call) => call.to[0] === SIZE && call.to[2] === 0);
  assert.equal(sameChunk.length, 1, "a placed chunk was copied again");
});

test("nothing is queued for a chunk the server has not sent", () => {
  const server = createServer({ loadDelay: 1000 });
  server.addTemplate(TEMPLATE_A);
  const { loader, level, entryId } = createTestLoader(server, ROOMS);

  // A player somewhere else entirely: every candidate chunk around the origin is
  // unsent, and a copy there would be dropped without an error.
  server.api.setPosition("player", [900, floorOfLayer(TEST_ORIGIN.y), 900]);
  for (let tick = 0; tick < 6; tick += 1) loader.tick([{ difficulty: VERY_EASY, entryId, chunks: [{ x: 0, z: 0 }] }]);
  assert.equal(server.calls.copy.length, 0, "a copy was queued for an unloaded destination");
  assert.equal(level.queue.length, 0);
});

test("one copy per tick per level, whatever the queue holds", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level, entryId } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY, entryId);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  for (let x = 0; x < 10; x += 1) {
    level.queue.push({ chunkX: x, chunkZ: 3, template: ROOMS[0] });
    readyNow(level, x, 3);
  }
  const chunks = [{ x: 3, z: 3 }];
  for (let tick = 0; tick < 5; tick += 1) loader.tick([{ difficulty: VERY_EASY, entryId, chunks }]);
  assert.equal(server.calls.copy.length, 5, "a tick copied more than one room");
});

test("chunks already recorded are never copied again", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level, entryId } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY, entryId);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  // The room is placed once by the level, which is the only thing that knows.
  server.api.setPosition("player", [16, floorOfLayer(TEST_ORIGIN.y), 16]);
  for (let tick = 0; tick < 5; tick += 1) server.advance();
  loader.placeEntrance(VERY_EASY, entryId);
  const first = server.calls.copy.length;

  loader.placeEntrance(VERY_EASY, entryId);
  assert.equal(server.calls.copy.length, first, "an already built entrance was copied over itself");
  assert.equal(level.planned.get("0|0"), "placed");
});

test("nothing is planned outside what the player has loaded", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level, entryId } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY, entryId);

  // Nothing has been loaded yet: every candidate chunk is unsent, and a copy there
  // would be dropped in silence.
  loader.planAround(level, 0, 0);
  assert.equal(level.queue.length, 0, "a room was queued in a chunk nobody had loaded");
  for (const call of server.calls.getBlock) {
    assert.equal(Number.isFinite(call.x), true);
  }

  // Once a player has loaded the area, the same scan finds rooms to build.
  server.api.setPosition("player", [16, floorOfLayer(TEST_ORIGIN.y), 16]);
  loader.planAround(level, 0, 0);
  assert.ok(level.queue.length > 0, "no room was queued in a loaded chunk");
  assert.ok(level.queue.length <= DUNGEON_CONFIG.maxPlannedPerScan);
});

test("the queue and the plan stay bounded as a player walks away", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level, entryId } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY, entryId);
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

test("the landing height comes from the room that is really in the entrance chunk", () => {
  // Two rooms of different heights. The landing must stand on the floor of whichever one
  // was copied into the entrance chunk — never on the catalogue's first entry, which is
  // the bug that put a player five cells inside a room. One world per run, because a
  // second room in the same entrance chunk would be found there and not copied.
  for (const [index, floorY, src] of [[0, 2, TEMPLATE_A], [1, 5, TEMPLATE_B]]) {
    const templates = [
      { index: 0, src: TEMPLATE_A },
      { index: 1, src: TEMPLATE_B },
    ];
    const server = createServer();
    server.addTemplate(TEMPLATE_A, { floorY: 2 });
    server.addTemplate(TEMPLATE_B, { floorY: 5 });
    const { loader, level, entryId } = createTestLoader(server, templates);
    loader.warmTemplates(VERY_EASY, entryId);
    // The entry teleports into the chunk first, and that teleport is what loads both
    // the destination and the template's own chunk.
    server.api.setPosition("player", [src[0], floorOfLayer(TEST_ORIGIN.y), src[2]]);
    for (let tick = 0; tick < 5; tick += 1) server.advance();
    // A level with the two rooms, and the one under test forced by making it the only
    // room the draw can pick: `placeEntrance` draws per chunk, and overriding its result
    // would be testing the override, not the engine.
    level.templates = [templates[index]];
    loader.placeEntrance(VERY_EASY, entryId);
    for (let tick = 0; tick < 3; tick += 1) server.advance();
    const landing = loader.landingPosition(VERY_EASY, entryId);
    assert.equal(landing[1], floorOfLayer(TEST_ORIGIN.y) + floorY + DUNGEON_CONFIG.spawnAboveFloor,
      `the landing is not above the floor (local y ${floorY}) of the room in the entrance chunk`);
  }
});

test("a landing is drawn inside the room, away from the walls", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A, { floorY: 2 });
  const { loader, level, entryId } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY, entryId);
  server.api.setPosition("player", [16, floorOfLayer(TEST_ORIGIN.y), 16]);
  for (let tick = 0; tick < 5; tick += 1) server.advance();
  loader.placeEntrance(VERY_EASY, entryId);

  const margin = DUNGEON_CONFIG.landingMargin;
  const seen = new Set();
  for (let draw = 0; draw < 20; draw += 1) {
    const landing = loader.landingPosition(VERY_EASY, entryId);
    assert.equal(landing[1], floorOfLayer(TEST_ORIGIN.y) + 2 + DUNGEON_CONFIG.spawnAboveFloor,
      "the drawn landing is not above the room's floor");
    const localX = Math.floor(landing[0]) - TEST_ORIGIN.x * SIZE;
    const localZ = Math.floor(landing[2]) - TEST_ORIGIN.z * SIZE;
    // The room's walls are its first and last cells: a position there is a position
    // inside a wall.
    assert.ok(localX >= margin && localX < SIZE - margin, `x ${localX} is against a wall`);
    assert.ok(localZ >= margin && localZ < SIZE - margin, `z ${localZ} is against a wall`);
    assert.equal(localX === 16 && localZ === 16, false, "the player was put on the pad");
    // Two players never share a column: the level gives each entry its own.
    assert.equal(seen.has(`${localX},${localZ}`), false, "a landing column was handed out twice");
    seen.add(`${localX},${localZ}`);
  }
  assert.ok(seen.size > 1, "the landing is fixed instead of drawn");
  assert.equal(level.landings.size, seen.size);
});

test("the landing is read in the entrance chunk, not in the template's own chunk", () => {
  // A table that names a chunk which does not hold the room — the one thing a hand-made
  // coordinate can get wrong. The landing follows **the copy**: the block that lands in
  // the entrance chunk is the one the player stands on, so the read happens there. The
  // old code read the template's chunk and then wrote the height it guessed, and the
  // check that followed was computed from the same guess.
  const server = createServer();
  // The room is built in chunk 2, the table says chunk 0: the copy takes the chunk the
  // table names, which is empty.
  server.addTemplate([0, 64, 0], { floorY: 2 });
  const templates = [{ index: 0, src: [0, 0, 0] }];
  const { loader, level, entryId } = createTestLoader(server, templates);
  loader.warmTemplates(VERY_EASY, entryId);
  server.api.setPosition("player", [16, floorOfLayer(TEST_ORIGIN.y), 16]);
  for (let tick = 0; tick < 5; tick += 1) server.advance();
  loader.placeEntrance(VERY_EASY, entryId);

  // The entrance chunk is empty, so there is no floor to land on — and the engine says
  // so instead of inventing a height from a room that is not there.
  assert.equal(level.entrance.index, 0);
  assert.equal(loader.landingPosition(VERY_EASY, entryId), null,
    "a landing was drawn in a chunk that holds no room");
});

test("a drawn landing never lands in a pillar", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A, { floorY: 2 });
  const { loader, entryId } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY, entryId);
  for (let tick = 0; tick < 5; tick += 1) server.advance();
  // The entry puts the player in the chunk first; that teleport is what loads it.
  server.api.setPosition("player", [16, floorOfLayer(TEST_ORIGIN.y), 16]);
  loader.placeEntrance(VERY_EASY, entryId);

  // A room full of pillars: the two cells a body needs are filled everywhere in the
  // room the entrance chunk got. The engine must fall back to the middle column
  // rather than hand out a column inside stone. This is the "spawn in a wall" case.
  //
  // The pillars are written **in the destination**, where the landing is read now: the
  // copy has already brought the room there, so this is the room the player is in.
  for (let localX = 0; localX < SIZE; localX += 1) {
    for (let localZ = 0; localZ < SIZE; localZ += 1) {
      for (let up = 1; up <= 2; up += 1) {
        // The destination of the copy, not the template: `built` is the room's own
        // chunk, and the room the player is in is the copy.
        server.world.set(
          `${TEST_ORIGIN.x * SIZE + localX},${floorOfLayer(TEST_ORIGIN.y) + 2 + up},${TEST_ORIGIN.z * SIZE + localZ}`,
          "Stone",
        );
      }
    }
  }
  const landing = loader.landingPosition(VERY_EASY, entryId);
  const originX = TEST_ORIGIN.x * SIZE;
  const originZ = TEST_ORIGIN.z * SIZE;
  assert.equal(landing[0], originX + 16.5, "the fallback is not the room's middle column");
  assert.equal(landing[2], originZ + 16.5);
});

test("without a readable template there is no landing position, and no invention", () => {
  const server = createServer({ loadDelay: 1000 });
  server.addTemplate(TEMPLATE_A);
  const { loader, entryId } = createTestLoader(server, ROOMS);
  assert.equal(loader.landingPosition(VERY_EASY, entryId), null,
    "a landing position was invented for a level whose template cannot be read");
});

test("a level with no template is a message, not a crash", () => {
  const server = createServer();
  const loader = createLoader({ api: server.api, log: () => {} });
  const level = loader.levelState(VERY_EASY, "player");
  level.templates = [];
  level.origin = { ...TEST_ORIGIN };
  assert.equal(loader.landingPosition(VERY_EASY, "player"), null);
  loader.tick([{ difficulty: VERY_EASY, entryId: "player", chunks: [{ x: 0, z: 0 }] }]);
  assert.equal(server.calls.copy.length, 0);
});

test("a level nobody is in costs nothing", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level, entryId } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY, entryId);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  const reads = server.calls.getBlock.length;
  for (let tick = 0; tick < 50; tick += 1) loader.tick([]);
  assert.equal(server.calls.getBlock.length, reads, "an empty level is still scanning");
  assert.equal(level.queue.length, 0);
});

// ------------------------------------------------------------- where it is --

test("every entry draws its own place, inside the configured cube", () => {
  const server = createServer();
  const loader = createLoader({ api: server.api, log: () => {} });
  const seen = new Set();
  for (let entry = 0; entry < 20; entry += 1) {
    const origin = loader.claimOrigin(VERY_EASY, `player-${entry}`);
    assert.ok(origin.x >= DUNGEON_CONFIG.spawnChunkMin && origin.x <= DUNGEON_CONFIG.spawnChunkMax,
      `origin x ${origin.x} is outside the square`);
    assert.ok(origin.z >= DUNGEON_CONFIG.spawnChunkMin && origin.z <= DUNGEON_CONFIG.spawnChunkMax,
      `origin z ${origin.z} is outside the square`);
    // The layer is drawn too, in the range the owner gave: blocks 1 000 to 100 000.
    assert.ok(origin.y >= DUNGEON_CONFIG.spawnChunkYMin && origin.y <= DUNGEON_CONFIG.spawnChunkYMax,
      `origin y ${origin.y} is outside the range`);
    assert.ok(origin.y * SIZE >= 1_000, `the dungeon was drawn at y ${origin.y * SIZE}`);
    seen.add(`${origin.x},${origin.z}`);
  }
  // Twenty entries, twenty places: a draw repeated would put two players together.
  assert.equal(seen.size, 20, "two entries were given the same place");
});

test("two living entries are kept apart by the configured separation", () => {
  const server = createServer();
  const loader = createLoader({ api: server.api, log: () => {} });
  const separation = Math.ceil(DUNGEON_CONFIG.spawnSeparation / SIZE);
  const origins = [];
  for (let entry = 0; entry < 30; entry += 1) {
    origins.push(loader.claimOrigin(VERY_EASY, `player-${entry}`));
  }
  for (let a = 0; a < origins.length; a += 1) {
    for (let b = a + 1; b < origins.length; b += 1) {
      // All three directions count: a room fills its chunk, so a dungeon 20 000
      // blocks above another is as far as one 20 000 blocks away on the map.
      const distance = Math.max(
        Math.abs(origins[a].x - origins[b].x),
        Math.abs(origins[a].y - origins[b].y),
        Math.abs(origins[a].z - origins[b].z),
      );
      assert.ok(distance >= separation, `entries ${a} and ${b} are ${distance} chunks apart`);
    }
  }
});

test("the place is drawn once, and a fresh entry keeps it", () => {
  const server = createServer();
  const loader = createLoader({ api: server.api, log: () => {} });
  const first = loader.claimOrigin(VERY_EASY, "player");
  assert.ok(loader.hasOrigin(VERY_EASY, "player"));
  // Claiming again must not move a dungeon the player is standing in.
  assert.deepEqual(loader.claimOrigin(VERY_EASY, "player"), first);
  assert.deepEqual(loader.levelState(VERY_EASY, "player").origin, first);
});

test("a new entry of the same difficulty is given a new place", () => {
  const server = createServer();
  const loader = createLoader({ api: server.api, log: () => {} });
  const first = loader.claimOrigin(VERY_EASY, "player");
  const second = loader.newOrigin(VERY_EASY, "player");
  assert.notDeepEqual(second, first, "the player came back to the same rooms");
  // The landing columns belong to a dungeon, so a new one draws from a clean set.
  assert.equal(loader.levelState(VERY_EASY, "player").landings.size, 0);
});

test("leaving gives the place back, and nothing of it survives", () => {
  const server = createServer();
  const loader = createLoader({ api: server.api, log: () => {} });
  loader.claimOrigin(VERY_EASY, "player");
  assert.equal(loader.states.size, 1);
  loader.release(VERY_EASY, "player");
  assert.equal(loader.states.size, 0, "the dungeon of a player who left is still in memory");
  assert.equal(loader.hasOrigin(VERY_EASY, "player"), false);
  // And a released place is not counted as taken: the draw starts from nothing.
  const afterLeave = loader.claimOrigin(VERY_EASY, "other");
  assert.ok(afterLeave, "no place was drawn after a release");
});

test("two players in the same difficulty get two dungeons, not one shared", () => {
  const server = createServer();
  const loader = createLoader({ api: server.api, log: () => {} });
  const one = loader.claimOrigin(VERY_EASY, "player-1");
  const two = loader.claimOrigin(VERY_EASY, "player-2");
  assert.notDeepEqual(one, two);
  // Separate state means separate queues as well: one player's plan is not the other's.
  assert.notEqual(loader.levelState(VERY_EASY, "player-1"), loader.levelState(VERY_EASY, "player-2"));
  loader.planAround(loader.levelState(VERY_EASY, "player-1"), one.x, one.z);
  assert.equal(loader.levelState(VERY_EASY, "player-2").planned.size, 0,
    "the dungeon of another player was planned into");
});

test("the rooms around an entry are copied on the layer the entry drew", () => {
  // Regression: the layer used to be a constant of the difficulty, so a dungeon
  // drawn at another height would have been copied onto the old one — a player
  // landing in one room and seeing the rest of the level a hundred chunks below.
  const server = createServer();
  server.addTemplate(TEMPLATE_A, { floorY: 2 });
  const { loader, level, entryId } = createTestLoader(server, ROOMS);
  level.origin = { x: 0, y: 700, z: 0 };
  server.api.setPosition("player", [16, floorOfLayer(level.origin.y), 16]);
  loader.warmTemplates(VERY_EASY, entryId);
  loader.placeEntrance(VERY_EASY, entryId);
  loader.planAround(level, 0, 0);
  for (let tick = 0; tick < 30; tick += 1) {
    server.advance();
    loader.tick([{ difficulty: VERY_EASY, entryId, chunks: [{ x: 0, z: 0 }] }]);
  }
  assert.ok(server.calls.copy.length >= 2, "nothing was copied around the entry");
  for (const call of server.calls.copy) {
    assert.equal(call.to[1], floorOfLayer(700), `a room was copied on layer ${call.to[1] / SIZE}`);
  }
  // And the landing is on that layer too: the room the player is in and the rooms
  // around them are the same dungeon.
  const landing = loader.landingPosition(VERY_EASY, entryId);
  assert.ok(landing, "no landing was drawn");
  assert.equal(Math.floor(landing[1] / SIZE), 700);
});
