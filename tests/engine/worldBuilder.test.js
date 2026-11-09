import test from "node:test";
import assert from "node:assert/strict";

import { DUNGEON_CONFIG } from "../../src/dungeon/engine/config.js";
import { createDungeonManager } from "../../src/dungeon/engine/dungeonManager.js";
import { OPENING_STATUS } from "../../src/dungeon/engine/openings.js";
import { BLOCKS, STONE_PALETTE, roomBlocks } from "../../src/dungeon/builder.js";

/** True when the name belongs to the stone family the builder is allowed to use. */
const isStructural = (name) => STONE_PALETTE.includes(name);
const isFloor = (name) => BLOCKS.FLOOR_POOL.includes(name);
import { ROOM_BUILD_STATE, createWorldBuilder } from "../../src/dungeon/worldBuilder.js";


/**
 * Grows a dungeon one room at a time, from the manager's own frontier.
 *
 * The frontier is re-read on every step on purpose: the manager is the only place
 * that knows which doorways are still pending. A mirrored queue holds the graph as
 * it was when the room was created — before the room closed its loops and before
 * an attempt blocked a doorway — so it keeps asking for doorways that no longer
 * exist and starves the ones that do. That is how a dungeon ends up with a single
 * trunk and no doors left to develop.
 */
function grow(seed, targetRooms) {
  const manager = createDungeonManager({ seed, radius: 512 });
  manager.createEntrance();
  while (manager.roomCount < targetRooms) {
    const pending = manager.pendingOpenings();
    if (pending.length === 0) break;
    manager.expand(pending[0].room.id, pending[0].opening.id);
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
  const calls = { setBlock: [], setPosition: [], setCanChangeType: [], sendMessage: [] };
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
    setCanChangeType(blockType, allowed) { calls.setCanChangeType.push({ blockType, allowed }); },
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
  assert.ok(isFloor(api.cells.get(`${floor.x},${floor.y},${floor.z}`)),
    "the floor cell is not a floor block");

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
  const entry = wrong.find((cell) => cell.x === floor.x);
  assert.ok(entry, "a vanished floor block was not detected");
  assert.equal(entry.actual, "Air");
  assert.ok(isFloor(entry.expected), `the audit expected ${entry.expected}, which is not a floor block`);
});

test("a room that stays wrong is reported as failed by the audit, not as built", () => {
  const manager = grow(4321, 5);
  const room = manager.allRooms()[1];
  // A world that refuses every write: the audit finds the room empty, repairs it
  // once, and still finds it empty.
  const api = fakeApi();
  const refusing = { ...api, setBlock() {} };
  const builder = createWorldBuilder({ api: refusing, batchSize: 100_000, verifyEvery: 1 });
  const result = builder.buildBatch(room);
  // The build itself succeeds: it cannot know the writes were dropped.
  assert.equal(result.done, true);
  // The audit is what notices, and it is what reports the failure.
  const audited = builder.auditNext((roomId) => manager.getRoom(roomId));
  assert.ok(audited, "the finished room was never audited");
  assert.equal(audited.verified, false, "a room that could not be written passed its audit");
  assert.equal(builder.stateOf(room.id).state, ROOM_BUILD_STATE.FAILED);
  assert.equal(builder.stateOf(room.id).repairs, 1, "the room was repaired more than once");
});

test("auditing works one room at a time, and only on finished rooms", () => {
  const manager = grow(999, 5);
  const rooms = manager.allRooms();
  const api = fakeApi();
  const builder = createWorldBuilder({ api, batchSize: 100_000 });
  for (const room of rooms) builder.buildBatch(room);
  let audited = 0;
  for (let guard = 0; guard < rooms.length + 2; guard += 1) {
    if (!builder.auditNext((roomId) => manager.getRoom(roomId))) break;
    audited += 1;
  }
  assert.equal(audited, rooms.length, "an audit step handled more or fewer rooms than one");
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

test("the landing pad is a floor, never a hole, and its size follows the scale", () => {
  const api = fakeApi();
  const builder = createWorldBuilder({ api });
  const radius = DUNGEON_CONFIG.scale * 2;
  const written = builder.layLandingPad({ x: 0, z: 0 });
  assert.equal(written, (radius * 2 + 1) ** 2,
    "the pad does not grow with the rooms: a 5×5 tile in a 55-cell hall reads as a mistake");
  assert.ok(isFloor(api.cells.get("0,-1000,0")), "the landing pad is not a floor block");
  assert.ok(isFloor(api.cells.get(`${radius},-1000,${-radius}`)), "the pad is not square around the cell");
});

test("the landing pad never spills through the walls of its room", () => {
  // The pad is a square, the room is not. On a thin shape — the entrance can be a
  // cross with a seven-cell bar — a 21-cell square centred on the landing cell
  // writes floor through the wall, into the joint, and in front of the doorway.
  const api = fakeApi();
  const builder = createWorldBuilder({ api });
  // A 12-cell-wide room, narrower than the pad: only the cells it owns may be
  // floored by the pad.
  const rows = ["111111111111", "111111111111", "111111111111"];
  const mask = {
    w: rows[0].length,
    h: rows.length,
    cells: rows.map((row) => [...row].map((value) => (value === "1" ? 1 : 0))),
  };
  const room = { id: "r0", origin: { x: 0, y: 0 }, mask };
  const written = builder.layLandingPad({ x: 6, z: 1 }, { room });
  assert.equal(written, mask.w * mask.h, "the pad wrote cells its room does not own");
  for (const [key] of api.cells) {
    const [x, , z] = key.split(",").map(Number);
    assert.ok(z >= 0 && z < mask.h, `the pad wrote z=${z}, outside the room`);
  }
});

test("nothing is locked: the game mode already keeps the shell unbreakable", () => {
  // `survivalAdventure` forbids breaking a block, so protecting the dungeon
  // would be a call that costs something and buys nothing.
  const api = fakeApi();
  const builder = createWorldBuilder({ api });
  const result = builder.allowMining([]);
  assert.equal(result.allowed, 0);
  assert.equal(api.calls.setCanChangeType.length, 0, "a permission was requested for nothing");
  assert.equal(builder.protectRoom, undefined, "the per-block protection is gone for good");
});

test("mining is opened one block type at a time, never by rectangle", () => {
  const api = fakeApi();
  const builder = createWorldBuilder({ api });
  const result = builder.allowMining(["Iron Ore", "Gold Ore"]);
  assert.equal(result.allowed, 2);
  assert.deepEqual(api.calls.setCanChangeType, [
    { blockType: "Iron Ore", allowed: true },
    { blockType: "Gold Ore", allowed: true },
  ]);
});

test("a type that cannot be opened is reported, not swallowed", () => {
  const api = fakeApi();
  api.setCanChangeType = () => { throw new Error("unknown block type"); };
  const logs = [];
  const builder = createWorldBuilder({ api, log: (message) => logs.push(message) });
  const result = builder.allowMining(["Iron Ore"]);
  assert.equal(result.allowed, 0);
  assert.ok(logs.some((message) => message.includes("unknown block type")),
    "the failure was silent, so an ore would be visible and unmineable with no trace");
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
