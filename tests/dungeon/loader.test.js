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
function createTestLoader(server, templates, difficulty = VERY_EASY) {
  const loader = createLoader({ api: server.api, log: () => {} });
  const level = loader.levelState(difficulty);
  level.templates = templates;
  return { loader, level };
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


test("the loader never writes a block, anywhere", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);
  // A player in the destination chunk, so every read is answered.
  server.api.setPosition("player", [16, floorOfLayer(VERY_EASY), 16]);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  const written = server.calls.setBlock.length;
  loader.placeEntrance(VERY_EASY);
  for (let tick = 0; tick < 20; tick += 1) loader.tick([{ difficulty: VERY_EASY, chunks: [{ x: 0, z: 0 }] }]);

  assert.deepEqual(server.calls.setBlock.slice(written), [],
    "the loader wrote into a room: a template is hand-built and must only be copied");
});

test("a copied room is confirmed by the world on the next tick", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);
  // The template chunk has to be sent before it can be copied from.
  loader.warmTemplates(VERY_EASY);
  server.api.setPosition("player", [16, floorOfLayer(VERY_EASY), 16]);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  loader.placeEntrance(VERY_EASY);
  assert.equal(level.planned.get("0|0"), "placing", "the entrance was not copied");
  // Counted as in flight, not as placed: the copy has not been applied yet.
  assert.equal(level.placed, 0, "a copy was counted as a room before the world showed it");

  // One tick later the room answers, and the counter says what the world says.
  loader.tick([{ difficulty: VERY_EASY, chunks: [{ x: 0, z: 0 }] }]);
  assert.equal(level.planned.get("0|0"), "placed");
  assert.equal(level.placed, 1);
  assert.equal(loader.statsOf(VERY_EASY).inFlight, 0);

  // Within the session, the room is never copied twice.
  for (let tick = 0; tick < 10; tick += 1) loader.tick([{ difficulty: VERY_EASY, chunks: [{ x: 0, z: 0 }] }]);
  const sameRoom = server.calls.copy.filter((call) => call.to[0] === 0 && call.to[2] === 0);
  assert.equal(sameRoom.length, 1, "a room copied in this session was copied again");
});

test("a room of a previous session is found by its Bedrock, not rebuilt", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY);
  server.api.setPosition("player", [16, floorOfLayer(VERY_EASY), 16]);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  loader.placeEntrance(VERY_EASY);
  loader.tick([{ difficulty: VERY_EASY, chunks: [{ x: 0, z: 0 }] }]);
  const copies = server.calls.copy.length;

  // A new loader is a restart: no memory at all, and the world is the only witness.
  const restarted = createLoader({ api: server.api, log: () => {} });
  const fresh = restarted.levelState(VERY_EASY);
  fresh.templates = ROOMS;
  restarted.placeEntrance(VERY_EASY);

  assert.equal(server.calls.copy.length, copies, "a room already in the world was copied again");
  assert.equal(fresh.planned.get("0|0"), "placed");
});

test("a chunk says whether it is sent and whether it holds a room", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY);
  for (let tick = 0; tick < 5; tick += 1) server.advance();
  server.api.setPosition("player", [16, floorOfLayer(VERY_EASY), 16]);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  // A chunk nobody asked for: the probe is the request, and the answer is honest.
  const unsent = loader.probeChunk(40, VERY_EASY.chunkY, 40);
  assert.deepEqual(unsent, { loaded: false, occupied: false });

  // The entrance chunk, empty: sent, and nothing in it.
  assert.deepEqual(loader.probeChunk(0, VERY_EASY.chunkY, 0), { loaded: true, occupied: false });

  // After the copy: sent, and a room.
  loader.placeEntrance(VERY_EASY);
  assert.deepEqual(loader.probeChunk(0, VERY_EASY.chunkY, 0), { loaded: true, occupied: true });

  // The template chunk, which holds the room being copied.
  assert.deepEqual(loader.probeChunk(0, -1, 0), { loaded: true, occupied: true });
});

test("a layer without Bedrock still counts as a room, by not being Air", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  // Strip the Bedrock from the bottom layer and leave stone on it: the owner's rule
  // is "if a layer has no Bedrock, just check the block is not Air".
  const base = { x: 0, y: -32, z: 0 };
  for (const [localX, localZ] of DUNGEON_CONFIG.probeLocalXZ) {
    server.templateBlocks.set(`${base.x + localX},${base.y},${base.z + localZ}`, "Stone");
  }
  for (const [localX, localZ] of DUNGEON_CONFIG.probeLocalXZ) {
    server.templateBlocks.set(`${base.x + localX},${base.y + SIZE - 1},${base.z + localZ}`, "Air");
  }
  assert.deepEqual(loader.probeChunk(0, -1, 0), { loaded: true, occupied: true },
    "a room whose bottom layer is stone instead of Bedrock was read as empty");
});

test("a copy waits for the chunk it was asked about, then lands", () => {
  const server = createServer({ loadDelay: 2, loadRadius: 0 });
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  // The player only loads what is loaded for real: nothing near the destination, so
  // the scan's probe has to request it.
  server.api.setPosition("player", [900, floorOfLayer(VERY_EASY), 900]);
  loader.planAround(level, 0, 0);
  assert.ok(server.calls.getBlock.length > 0, "the scan did not ask for anything");
  assert.equal(level.queue.length, 0, "a copy was queued before the chunk was sent");

  // Two ticks later the chunk exists: the scan queues it, the copy lands, and the
  // next tick's probe confirms the room.
  for (let tick = 0; tick < 2; tick += 1) server.advance();
  loader.planAround(level, 0, 0);
  assert.ok(level.queue.length > 0, "the chunk was sent but never queued");
  loader.tick([{ difficulty: VERY_EASY, chunks: [{ x: 0, z: 0 }] }]);
  const copied = server.calls.copy.length;
  assert.equal(copied > 0, true, "nothing was copied once the destination existed");
  loader.tick([{ difficulty: VERY_EASY, chunks: [{ x: 0, z: 0 }] }]);
  assert.equal(level.placed > 0, true, "the copy was never seen by the probe");
});

test("a copy from an unloaded template is retried, then disabled, never looped", () => {
  const server = createServer({ loadDelay: 1000 });
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS, VERY_EASY);

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
  const { loader, level } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY);
  for (let tick = 0; tick < 5; tick += 1) server.advance();
  server.api.setPosition("player", [SIZE + 16, floorOfLayer(VERY_EASY), 16]);

  readyNow(level, 1, 0);
  level.queue.push({ chunkX: 1, chunkZ: 0, template: level.templates[0] });
  loader.placeOne(level);
  assert.equal(server.calls.copy.length, 1, "the copy was not attempted");
  assert.equal(level.planned.get("1|0"), "placing");

  // Never copied twice, whatever else the scan finds to build around the player.
  for (let tick = 0; tick < 6; tick += 1) loader.tick([{ difficulty: VERY_EASY, chunks: [{ x: 1, z: 0 }] }]);
  const sameChunk = server.calls.copy.filter((call) => call.to[0] === SIZE && call.to[2] === 0);
  assert.equal(sameChunk.length, 1, "a placed chunk was copied again");
});

test("nothing is queued for a chunk the server has not sent", () => {
  const server = createServer({ loadDelay: 1000 });
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);

  // A player somewhere else entirely: every candidate chunk around the origin is
  // unsent, and a copy there would be dropped without an error.
  server.api.setPosition("player", [900, floorOfLayer(VERY_EASY), 900]);
  for (let tick = 0; tick < 6; tick += 1) loader.tick([{ difficulty: VERY_EASY, chunks: [{ x: 0, z: 0 }] }]);
  assert.equal(server.calls.copy.length, 0, "a copy was queued for an unloaded destination");
  assert.equal(level.queue.length, 0);
});

test("one copy per tick per level, whatever the queue holds", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY);
  for (let tick = 0; tick < 5; tick += 1) server.advance();

  for (let x = 0; x < 10; x += 1) {
    level.queue.push({ chunkX: x, chunkZ: 3, template: ROOMS[0] });
    readyNow(level, x, 3);
  }
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

  // The room is placed once by the level, which is the only thing that knows.
  server.api.setPosition("player", [16, floorOfLayer(VERY_EASY), 16]);
  for (let tick = 0; tick < 5; tick += 1) server.advance();
  loader.placeEntrance(VERY_EASY);
  const first = server.calls.copy.length;

  loader.placeEntrance(VERY_EASY);
  assert.equal(server.calls.copy.length, first, "an already built entrance was copied over itself");
  assert.equal(level.planned.get("0|0"), "placed");
});

test("nothing is planned outside what the player has loaded", () => {
  const server = createServer();
  server.addTemplate(TEMPLATE_A);
  const { loader, level } = createTestLoader(server, ROOMS);
  loader.warmTemplates(VERY_EASY);

  // Nothing has been loaded yet: every candidate chunk is unsent, and a copy there
  // would be dropped in silence.
  loader.planAround(level, 0, 0);
  assert.equal(level.queue.length, 0, "a room was queued in a chunk nobody had loaded");
  for (const call of server.calls.getBlock) {
    assert.equal(Number.isFinite(call.x), true);
  }

  // Once a player has loaded the area, the same scan finds rooms to build.
  server.api.setPosition("player", [16, floorOfLayer(VERY_EASY), 16]);
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
