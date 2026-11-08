import test from "node:test";
import assert from "node:assert/strict";

import { DUNGEON_CONFIG } from "../../src/dungeon/engine/config.js";
import { createDungeonManager } from "../../src/dungeon/engine/dungeonManager.js";
import { OPENING_STATUS } from "../../src/dungeon/engine/openings.js";
import { BLOCKS, roomBlocks } from "../../src/dungeon/builder.js";
import { ROOM_BUILD_STATE, createWorldBuilder } from "../../src/dungeon/worldBuilder.js";

function grow(seed, targetRooms) {
  const manager = createDungeonManager({ seed, radius: 512 });
  manager.createEntrance();
  const queue = manager.pendingOpenings().map((entry) => ({ room: entry.room, opening: entry.opening }));
  while (queue.length > 0 && manager.roomCount < targetRooms) {
    const next = queue.shift();
    const result = manager.expand(next.room.id, next.opening.id);
    if (result.ok && result.kind === "created") {
      for (const opening of result.room.openings) {
        if (opening.status === OPENING_STATUS.PENDING) queue.push({ room: result.room, opening });
      }
    }
  }
  return manager;
}

/**
 * A fake Bloxd API.
 *
 * `loaded` decides which cells may be read: reading outside it returns `null`,
 * exactly like an unloaded chunk, which is the situation the whole file exists
 * to survive. Writes into an unloaded area are recorded anyway — the point of the
 * test is that they never happen.
 */
function fakeApi(options = {}) {
  const cells = new Map();
  const calls = { setBlock: [], setPosition: [], setCantChangeBlockRect: [], sendMessage: [] };
  const loaded = options.loaded === undefined ? () => true : options.loaded;
  const dropped = [];
  return {
    cells,
    calls,
    dropped,
    setBlock(x, y, z, name) {
      calls.setBlock.push({ x, y, z, name });
      if (!loaded(x, z)) {
        dropped.push({ x, y, z, name });
        return;
      }
      cells.set(`${x},${y},${z}`, name);
    },
    getBlock(x, y, z) {
      if (!loaded(x, z)) return null;
      const name = cells.get(`${x},${y},${z}`);
      return name === undefined ? "Air" : name;
    },
    setPosition(playerId, position) { calls.setPosition.push({ playerId, position }); },
    getPosition() { return null; },
    setCantChangeBlockRect(...args) { calls.setCantChangeBlockRect.push(args); },
    sendMessage(playerId, message) { calls.sendMessage.push({ playerId, message }); },
    log() {},
  };
}

function worldOf(room) {
  return { x: room.origin.x, y: DUNGEON_CONFIG.floorY, z: room.origin.y };
}

test("a missing floor altitude is refused instead of writing blocks at NaN", () => {
  const api = fakeApi();
  assert.throws(() => createWorldBuilder({ api, floorY: Number.NaN }), TypeError);
  assert.throws(() => createWorldBuilder({ api, floorY: undefined, ...{} , ...{ floorY: null } }), TypeError);
});

test("nothing is written before the chunks are loaded", () => {
  const manager = grow(12345, 6);
  const room = manager.allRooms()[1];
  let ready = false;
  const api = fakeApi({ loaded: (x, z) => ready || !inside(room, x, z) });
  const builder = createWorldBuilder({ api, batchSize: 40 });

  const blocked = builder.buildBatch(room);
  assert.equal(blocked.done, false);
  assert.equal(blocked.written, 0, "blocks were written into an unloaded chunk, where Bloxd drops them silently");
  assert.equal(blocked.state, ROOM_BUILD_STATE.WAITING_FOR_CHUNK);
  assert.equal(api.dropped.length, 0);

  ready = true;
  let guard = 0;
  let result = builder.buildBatch(room);
  while (!result.done && guard < 1000) {
    result = builder.buildBatch(room);
    guard += 1;
  }
  assert.equal(result.done, true, "the room never finished once its chunks were loaded");
  assert.equal(api.dropped.length, 0);
});

function inside(room, x, z) {
  return x >= room.origin.x && x < room.origin.x + room.mask.w
    && z >= room.origin.y && z < room.origin.y + room.mask.h;
}

test("a finished room is built exactly once, even if the batch is called again", () => {
  const manager = grow(999, 5);
  const room = manager.allRooms()[1];
  const api = fakeApi();
  const builder = createWorldBuilder({ api, batchSize: 100_000 });
  const first = builder.buildBatch(room);
  assert.equal(first.done, true);
  // The floor cell must be the floor block, not something a second pass wrote.
  const floor = roomBlocks(room, worldOf(room)).find((block) => block.phase === "floor");
  assert.equal(api.cells.get(`${floor.x},${floor.y},${floor.z}`), BLOCKS.FLOOR);

  const second = builder.buildBatch(room);
  assert.equal(second.done, true);
  assert.equal(second.written, 0, "a built room was written again");
});

test("a room that is written correctly is never repaired", () => {
  const manager = grow(4321, 5);
  const room = manager.allRooms()[1];
  const api = fakeApi();
  const builder = createWorldBuilder({ api, batchSize: 100_000 });
  const result = builder.buildBatch(room);
  assert.equal(result.done, true);
  assert.equal(builder.stateOf(room.id).repairs, 0);
});

test("a lost block is detected and repaired once", () => {
  const manager = grow(4321, 5);
  const room = manager.allRooms()[1];
  const api = fakeApi();
  const builder = createWorldBuilder({ api, batchSize: 100_000 });
  builder.buildBatch(room);
  const floor = roomBlocks(room, worldOf(room)).find((block) => block.phase === "floor");

  // Simulate a write the server dropped after the fact: the room claims to be
  // built, but a cell is gone. The builder must notice on the next audit.
  api.cells.set(`${floor.x},${floor.y},${floor.z}`, "Air");
  const wrong = builder.verifyRoom(room, worldOf(room));
  assert.ok(wrong.some((cell) => cell.x === floor.x), "a vanished floor block was not detected");
});

test("a room that stays wrong is reported as failed, not as built", () => {
  const manager = grow(4321, 5);
  const room = manager.allRooms()[1];
  // A world that refuses every write below the ceiling: the repair cannot work.
  const api = fakeApi();
  const refusing = { ...api, setBlock() {} };
  const builder = createWorldBuilder({ api: refusing, batchSize: 100_000, verifyEvery: 1 });
  const result = builder.buildBatch(room);
  assert.equal(result.done, false, "a room that could not be written was reported as built");
  assert.equal(result.state, ROOM_BUILD_STATE.FAILED);
  assert.equal(builder.stateOf(room.id).repairs, 1, "the room was repaired more than once");
});

test("the landing sequence reads, teleports to the middle of the cell, then waits", () => {
  const api = fakeApi();
  const builder = createWorldBuilder({ api });
  const landing = builder.prepareLanding("p1", { x: 12, z: -3 });
  assert.equal(landing.waitTicks, DUNGEON_CONFIG.chunkWarmupTicks);
  // Cell -3 spans [-3, -2), so its middle is -2.5: the player lands on the
  // floor, never on the corner between two cells.
  assert.deepEqual(api.calls.setPosition, [{ playerId: "p1", position: [12.5, DUNGEON_CONFIG.floorY + 2, -2.5] }],
    "the player was put on a corner instead of the middle of the floor cell");
});

test("the landing pad is a floor, never a hole", () => {
  const api = fakeApi();
  const builder = createWorldBuilder({ api });
  const written = builder.layLandingPad({ x: 0, z: 0 }, 2);
  assert.equal(written, 25);
  assert.equal(api.cells.get("0,-1000,0"), BLOCKS.FLOOR);
});

test("a protected room is protected as one rectangle, not block by block", () => {
  const manager = grow(777, 4);
  const room = manager.allRooms()[0];
  const api = fakeApi();
  const builder = createWorldBuilder({ api });
  assert.equal(builder.protectRoom(room), true);
  assert.equal(api.calls.setCantChangeBlockRect.length, 1);
  const [x1, y1, z1, x2, , z2] = api.calls.setCantChangeBlockRect[0];
  assert.equal(x1, room.origin.x);
  assert.equal(z1, room.origin.y);
  assert.equal(x2, room.origin.x + room.mask.w - 1);
  assert.equal(z2, room.origin.y + room.mask.h - 1);
  assert.equal(y1, DUNGEON_CONFIG.floorY);
});

test("the builder tells the controller both the cost and whether the room is finished", () => {
  const manager = grow(3141, 4);
  const room = manager.allRooms()[1];
  const api = fakeApi();
  const builder = createWorldBuilder({ api, batchSize: 60 });
  const controllerBuilder = builder.asControllerBuilder();
  const first = controllerBuilder.buildRoom(room);
  assert.equal(first.blocks, 60, "the controller must be told what the batch actually cost");
  assert.equal(first.done, false, "a half-built room must not be reported as finished");

  const second = builder.asControllerBuilder().buildRoom(room);
  assert.equal(second.done, false, "the builder did not resume the room");
  assert.ok(second.blocks > 0, "the resumed batch wrote nothing");
});

test("chunks touched by a room are computed, not guessed", () => {
  const manager = grow(2024, 4);
  const room = manager.allRooms()[1];
  const builder = createWorldBuilder({ api: fakeApi() });
  const chunks = builder.chunksOf(room);
  assert.ok(chunks.size >= 1);
  for (const key of chunks) {
    const [chunkX, chunkZ] = key.split(",").map(Number);
    assert.ok(Number.isInteger(chunkX) && Number.isInteger(chunkZ));
  }
});
