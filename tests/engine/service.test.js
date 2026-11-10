import test from "node:test";
import assert from "node:assert/strict";

import { DUNGEON_CONFIG, DIFFICULTIES, findDifficulty } from "../../src/dungeon/engine/config.js";
import { BLOCKS } from "../../src/dungeon/builder.js";
import { step as stepScheduler } from "../../src/utils/scheduler.js";
import { anchorOf, CHUNK_ANCHOR_BLOCK } from "../../src/dungeon/chunkStore.js";
import {
  LOBBY_POSITION,
  createDungeonService,
  dungeonSeedFor,
  padTargetOf,
} from "../../src/dungeon/service.js";

/**
 * A fake Bloxd API with one important property: a cell is only readable once the
 * player has been placed there. That is the whole spawn rule — read, teleport,
 * wait, build — expressed as a constraint the fake enforces.
 */
/**
 * How far the fake server keeps chunks loaded around a player.
 *
 * Bigger than the 48 originally used, and deliberately so: a room is now up to 55
 * cells across and the masonry between two rooms is 15 cells, so a room built
 * beside a player who never moves can sit far beyond the old radius — and then the
 * fake "loses" those writes, which is the fake being wrong, not the builder. The
 * case this number must never hide (a write into an unloaded chunk) is covered
 * directly by `worldBuilder.test`, which can put the boundary anywhere it likes.
 */
const LOAD_RADIUS = 400;

function fakeApi() {
  const cells = new Map();
  const calls = { setBlock: [], setPosition: [], sendMessage: [], setCanChangeType: [], setBlockData: [] };
  const positions = new Map();
  const loadedRects = [];
  const near = (x, z) => loadedRects.some((rect) => x >= rect.x1 && x <= rect.x2 && z >= rect.z1 && z <= rect.z2);
  return {
    cells,
    calls,
    setBlock(x, y, z, name) {
      calls.setBlock.push({ x, y, z, name });
      if (!near(x, z)) return;
      cells.set(`${x},${y},${z}`, name);
    },
    getBlock(x, y, z) {
      if (!near(x, z)) return null;
      const name = cells.get(`${x},${y},${z}`);
      return name === undefined ? "Air" : name;
    },
    setPosition(playerId, position) {
      calls.setPosition.push({ playerId, position });
      positions.set(playerId, position);
      // Teleporting is what loads the chunks around the player, as in the game:
      // a few chunks. This radius is wider than 32 blocks on purpose, because
      // the distance between two rooms can exceed one chunk, but it is not
      // unlimited — a fake that accepts every write cannot catch a builder that
      // writes into the void. `worldBuilder.test` covers that case directly.
      loadedRects.push({
        x1: Math.floor(position[0]) - LOAD_RADIUS, x2: Math.floor(position[0]) + LOAD_RADIUS,
        z1: Math.floor(position[2]) - LOAD_RADIUS, z2: Math.floor(position[2]) + LOAD_RADIUS,
      });
    },
    getPosition(playerId) {
      const position = positions.get(playerId);
      return position || null;
    },
    setCanChangeType(blockType, allowed) { calls.setCanChangeType.push({ blockType, allowed }); },
    sendMessage(playerId, message) { calls.sendMessage.push({ playerId, message }); },
    log() {},
  };
}

/** A cell under the player counts as floor if it carries any floor block. */
const FLOOR_BLOCKS = BLOCKS.FLOOR_POOL;

/** Steps the shared scheduler until `done()` holds, or fails the test. */
function runUntil(done, label, limit = 4000) {
  for (let index = 0; index < limit; index += 1) {
    if (done()) return index;
    stepScheduler();
  }
  throw new Error(`gave up waiting for ${label} after ${limit} ticks`);
}

test("the seed of a dungeon never depends on the clock", () => {
  const first = dungeonSeedFor("easy", "lobby-1");
  const second = dungeonSeedFor("easy", "lobby-1");
  assert.equal(first, second);
  assert.notEqual(first, dungeonSeedFor("hard", "lobby-1"));
  assert.notEqual(first, dungeonSeedFor("easy", "lobby-2"));
  assert.ok(Number.isInteger(first) && first > 0);
});

test("the pads walk the difficulty table, and Hell is the end", () => {
  assert.equal(padTargetOf("Very Easy").label, "Easy");
  assert.equal(padTargetOf("Ultra Insane").label, "Hell");
  assert.equal(padTargetOf("Hell"), null);
  for (let index = 0; index < DIFFICULTIES.length - 1; index += 1) {
    assert.equal(padTargetOf(DIFFICULTIES[index].label).label, DIFFICULTIES[index + 1].label);
  }
});

test("a player enters: the floor exists before anything is announced", () => {
  const api = fakeApi();
  const service = createDungeonService({ api });
  let ready = null;
  service.enterDifficulty("p1", "Easy", (dungeon, spawn) => { ready = { dungeon, spawn }; });

  runUntil(() => ready !== null, "the entrance to be built");

  // The first and only teleport is into the dungeon: the player is already in
  // the lobby when they step on the pad, so sending them back would be a
  // visible flicker.
  assert.equal(api.calls.setPosition.length, 1, "the player was teleported more than once");
  const landing = api.calls.setPosition[0].position;
  assert.equal(landing[1], DUNGEON_CONFIG.floorY + 2);
  assert.equal(landing[0] % 1, 0.5, "the player is not in the middle of the cell on x");
  assert.equal(landing[2] % 1, 0.5, "the player is not in the middle of the cell on z");

  // Nothing is announced before the floor exists.
  for (const message of api.calls.sendMessage) {
    assert.ok(!/ready/i.test(message.message), "a message was sent before the dungeon was ready");
  }

  // The floor under the landing cell must exist at the moment `onReady` fires.
  const cell = ready.spawn.cell;
  assert.ok(FLOOR_BLOCKS.includes(api.cells.get(`${cell.x},${DUNGEON_CONFIG.floorY},${cell.z}`)),
    "the player was told the dungeon was ready while standing over a hole");
  // The pad under the player follows the scale too: the service passing a fixed
  // radius is how the pad stayed at 5×5 while the rooms grew to 55. It is clipped
  // to the entrance's own footprint, so the cells that must carry floor are the
  // ones the room actually has — a pad spilling through the walls would put a
  // slab of floor in the joint and in front of the doorway.
  const padRadius = DUNGEON_CONFIG.scale * 2;
  const entrance = ready.dungeon.manager.getRoom(ready.dungeon.entranceRoomId);
  let padCells = 0;
  for (let dx = -padRadius; dx <= padRadius; dx += 1) {
    for (let dz = -padRadius; dz <= padRadius; dz += 1) {
      const x = cell.x + dx;
      const z = cell.z + dz;
      const localX = x - entrance.origin.x;
      const localZ = z - entrance.origin.y;
      const inside = Boolean(entrance.mask.cells[localZ] && entrance.mask.cells[localZ][localX]);
      const block = api.cells.get(`${x},${DUNGEON_CONFIG.floorY},${z}`);
      if (inside) {
        padCells += 1;
        assert.ok(FLOOR_BLOCKS.includes(block), `the landing pad is missing the room cell ${localX},${localZ}`);
      }
    }
  }
  assert.ok(padCells > 50, `only ${padCells} cells of pad were laid`);

  // No lock is requested: `survivalAdventure` already keeps the shell intact.
  assert.equal(api.calls.setCanChangeType.length, 0,
    "a permission was requested, but nothing is breakable by default");
});

test("two players of the same difficulty share one dungeon", () => {
  const api = fakeApi();
  const service = createDungeonService({ api });
  const ready = [];
  service.enterDifficulty("p1", "Medium", (dungeon) => ready.push(dungeon));
  service.enterDifficulty("p2", "Medium", (dungeon) => ready.push(dungeon));
  runUntil(() => ready.length === 2, "both players to be ready");

  assert.equal(service.dungeons.size, 1, "a second dungeon was generated for the same difficulty");
  assert.equal(ready[0], ready[1]);
  assert.equal(service.dungeonOf("p1"), service.dungeonOf("p2"));
  // One entrance: the room identifiers are not duplicated.
  assert.equal(ready[0].manager.roomCount, 1);
});

test("two difficulties are two dungeons", () => {
  const api = fakeApi();
  const service = createDungeonService({ api });
  const ready = [];
  service.enterDifficulty("p1", "Easy", (dungeon) => ready.push(dungeon));
  service.enterDifficulty("p2", "Hard", (dungeon) => ready.push(dungeon));
  runUntil(() => ready.length === 2, "both dungeons to be ready");
  assert.equal(service.dungeons.size, 2);
  assert.notEqual(ready[0].seed, ready[1].seed);
});

test("the landing cell is a floor cell, never a doorway", () => {
  const api = fakeApi();
  const service = createDungeonService({ api });
  let spawn = null;
  service.enterDifficulty("p1", "Normal", (dungeon, landed) => { spawn = landed; });
  runUntil(() => spawn !== null, "the entrance to be built");

  const dungeon = service.dungeonOf("p1");
  const room = dungeon.manager.getRoom(spawn.roomId);
  const localX = spawn.cell.x - room.origin.x;
  const localZ = spawn.cell.z - room.origin.y;
  assert.equal(room.mask.cells[localZ][localX], 1, "the landing cell is not part of the room's floor");
  for (const opening of room.openings) {
    const along = opening.side === "north" || opening.side === "south" ? localX : localZ;
    if (along < opening.offsetStart || along > opening.offsetEnd) continue;
    const onEdge = (opening.side === "north" && localZ === 0)
      || (opening.side === "south" && localZ === room.mask.h - 1)
      || (opening.side === "west" && localX === 0)
      || (opening.side === "east" && localX === room.mask.w - 1);
    assert.equal(onEdge, false, "the player lands in a doorway");
  }
});

test("an unknown difficulty is refused with a message, not a crash", () => {
  const api = fakeApi();
  const service = createDungeonService({ api });
  const dungeon = service.enterDifficulty("p1", "Impossible");
  assert.equal(dungeon, null);
  assert.equal(api.calls.sendMessage.length, 1);
  assert.equal(service.dungeons.size, 0);
});

test("stepping on the pad of Hell says so instead of teleporting to nowhere", () => {
  const api = fakeApi();
  const service = createDungeonService({ api });
  const result = service.usePad("p1", "Hell");
  assert.equal(result, null);
  assert.match(api.calls.sendMessage[0].message, /as far as the dungeon goes/);
});

test("a pad takes the player to the next difficulty and leaves the previous dungeon", () => {
  const api = fakeApi();
  const service = createDungeonService({ api });
  const ready = [];
  service.enterDifficulty("p1", "Hard", (dungeon) => ready.push(dungeon));
  runUntil(() => ready.length === 1, "Hard to be ready");

  const lobbyBefore = LOBBY_POSITION.slice();
  service.usePad("p1", "Hard", (dungeon) => ready.push(dungeon));
  runUntil(() => ready.length === 2, "Insane to be ready");

  assert.equal(ready[1].difficulty.label, "Insane");
  assert.equal(service.dungeonOf("p1").difficulty.label, "Insane");
  // The way out of a dungeon is always the lobby position, then the next
  // landing: the player is never teleported from one dungeon straight into
  // another, which would leave them mid-air in an unbuilt chunk.
  const positions = api.calls.setPosition.map((call) => call.position);
  const lobbyIndex = positions.findIndex((position) => position === LOBBY_POSITION
    || (position[0] === lobbyBefore[0] && position[1] === lobbyBefore[1] && position[2] === lobbyBefore[2]));
  assert.ok(lobbyIndex >= 1, "the player left the dungeon without passing through the lobby position");
});

test("leaving puts the player back in the lobby and forgets the dungeon link", () => {
  const api = fakeApi();
  const service = createDungeonService({ api });
  let ready = false;
  service.enterDifficulty("p1", "Very Easy", () => { ready = true; });
  runUntil(() => ready, "the entrance to be built");
  service.leave("p1");
  assert.equal(service.dungeonOf("p1"), null);
  assert.deepEqual(api.calls.setPosition.pop().position, LOBBY_POSITION);
});

test("a tick without players does not generate rooms", () => {
  const api = fakeApi();
  const service = createDungeonService({ api });
  let ready = false;
  service.enterDifficulty("p1", "Easy", () => { ready = true; });
  runUntil(() => ready, "the entrance to be built");
  const dungeon = service.dungeonOf("p1");
  const before = dungeon.manager.roomCount;
  service.leave("p1");
  for (let index = 0; index < 60; index += 1) service.tick();
  assert.equal(dungeon.manager.roomCount, before, "rooms were generated with nobody inside");
});

test("the service reports one entry per dungeon that exists", () => {
  const api = fakeApi();
  const service = createDungeonService({ api });
  const ready = [];
  service.enterDifficulty("p1", "Easy", (dungeon) => ready.push(dungeon));
  runUntil(() => ready.length === 1, "Easy to be ready");
  const stats = service.stats();
  assert.equal(stats.length, 1);
  assert.equal(stats[0].difficulty, findDifficulty("Easy").label);
  assert.equal(stats[0].rooms, 1);
});

test("a service built for one lobby does not reuse another lobby's dungeons", () => {
  const api = fakeApi();
  const first = createDungeonService({ api, lobbyName: "alpha" });
  let ready = false;
  first.enterDifficulty("p1", "Easy", () => { ready = true; });
  runUntil(() => ready, "the entrance to be built");
  first.forgetAll();

  const second = createDungeonService({ api, lobbyName: "beta" });
  let secondReady = false;
  second.enterDifficulty("p2", "Easy", () => { secondReady = true; });
  runUntil(() => secondReady, "the second lobby's entrance");
  assert.notEqual(
    dungeonSeedFor("easy", "alpha"),
    dungeonSeedFor("easy", "beta"),
    "two lobbies would build the identical dungeon",
  );
});

// ------------------------------------------------------- the dungeon on foot --

test("every room of a finished dungeon can be reached on foot from the entrance", () => {
  // The bug this locks in: the rooms were built, the thresholds between them
  // were not, and every doorway opened onto three cells of void. Nothing failed
  // — there was simply no way through. This test walks the dungeon.
  const api = fakeApi();
  const service = createDungeonService({ api, lobbyName: "onfoot" });
  let ready = false;
  service.enterDifficulty("p1", "Easy", () => { ready = true; });
  runUntil(() => ready, "the entrance to be built");

  const dungeon = service.dungeonOf("p1");
  // Enough ticks for the graph to stop growing and for the audit to finish. The
  // bound follows the scale: a room is now up to 55 cells across and costs tens
  // of thousands of blocks, so the dungeon is "finished" at a few hundred ticks,
  // and the test must not stop in the middle of the build — it would then check
  // rooms that are still being written.
  for (let tick = 0; tick < 1600; tick += 1) {
    stepScheduler();
    service.tick();
  }
  // Passages are written one batch at a time (4 000 blocks for a joint at this
  // scale), so a fixed tick count is a bet on the machine's speed. Wait for the
  // build to actually finish instead: the service reports it.
  let stable = 0;
  let lastPassages = -1;
  let lastRooms = -1;
  for (let tick = 0; tick < 6000 && stable < 200; tick += 1) {
    stepScheduler();
    service.tick();
    const built = dungeon.controller.stats.passages;
    const rooms = dungeon.manager.roomCount;
    if (built === lastPassages && rooms === lastRooms) stable += 1;
    else { stable = 0; lastPassages = built; lastRooms = rooms; }
  }

  const rooms = dungeon.manager.allRooms();
  const connections = dungeon.manager.allConnections();
  assert.ok(rooms.length > 3, `only ${rooms.length} room(s) were generated, so the test proves nothing`);
  assert.equal(dungeon.controller.stats.passages, connections.length,
    `${connections.length} connections but ${dungeon.controller.stats.passages} passage(s) built`);

  const floor = new Set();
  const solid = new Set();
  for (const [key, name] of api.cells) {
    const [x, y, z] = key.split(",").map(Number);
    if (name === "Air") continue;
    if (y === DUNGEON_CONFIG.floorY) floor.add(`${x},${z}`);
    else solid.add(key);
  }
  const walkable = (key) => {
    const [x, z] = key.split(",").map(Number);
    return floor.has(key)
      && !solid.has(`${x},${DUNGEON_CONFIG.floorY + 1},${z}`)
      && !solid.has(`${x},${DUNGEON_CONFIG.floorY + 2},${z}`);
  };

  const entrance = dungeon.manager.getRoom(dungeon.entranceRoomId);
  const start = `${entrance.origin.x + 1},${entrance.origin.y + 1}`;
  assert.ok(walkable(start), "the entrance itself is not walkable");
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    const [x, z] = current.split(",").map(Number);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = `${x + dx},${z + dz}`;
      if (seen.has(next) || !walkable(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  const unreachable = rooms.filter((room) => {
    for (let localZ = 0; localZ < room.mask.h; localZ += 1) {
      for (let localX = 0; localX < room.mask.w; localX += 1) {
        if (!room.mask.cells[localZ][localX]) continue;
        if (seen.has(`${room.origin.x + localX},${room.origin.y + localZ}`)) return false;
      }
    }
    return true;
  });
  assert.deepEqual(unreachable.map((room) => room.id), [],
    "rooms were built that nobody can walk into");
});

// ------------------------------------------------------ the chunk records --
//
// A record lives in the data of one block per chunk, and the documented rule is
// that a block change clears that data. So the fake API here has `setBlockData`,
// `getBlockData`, and a `setBlock` that **clears the data of the cell it writes** —
// the same behaviour as the game. A fake that quietly kept the data would let a
// builder overwrite the anchor while the tests stayed green.

function chunkAwareApi() {
  const api = fakeApi();
  const data = new Map();
  // Every write, in order, so the test can ask the only question that matters:
  // was a block written to a cell *after* its data? That is the write that would
  // clear it.
  const log = [];
  const nearEnough = (x, z) => api.getBlock(x, DUNGEON_CONFIG.floorY, z) !== null;
  api.setBlock = (x, y, z, name) => {
    api.calls.setBlock.push({ x, y, z, name });
    log.push({ kind: "block", cell: `${x},${y},${z}`, name });
    data.delete(`${x},${y},${z}`);
    if (!nearEnough(x, z)) return;
    api.cells.set(`${x},${y},${z}`, name);
  };
  api.setBlockData = (x, y, z, value) => {
    api.calls.setBlockData.push({ x, y, z });
    log.push({ kind: "data", cell: `${x},${y},${z}` });
    data.set(`${x},${y},${z}`, JSON.parse(JSON.stringify(value)));
  };
  api.getBlockData = (x, y, z) => (data.has(`${x},${y},${z}`) ? data.get(`${x},${y},${z}`) : null);
  api.data = data;
  api.log = log;
  /** Did anything overwrite the block of this cell after its data was written? */
  api.clearedAfterData = (cell) => {
    const dataIndex = log.findIndex((entry) => entry.kind === "data" && entry.cell === cell);
    if (dataIndex < 0) return false;
    return log.slice(dataIndex + 1).some((entry) => entry.kind === "block" && entry.cell === cell);
  };
  return api;
}

test("a dungeon saves its chunks as it builds, one per tick, and reads them back", () => {
  const api = chunkAwareApi();
  const service = createDungeonService({ api });
  let dungeon = null;
  service.enterDifficulty("p1", "Easy", (ready) => { dungeon = ready; });
  runUntil(() => dungeon !== null, "the entrance");
  // The world ticks the service; the scheduler only drives the builder's internal
  // waits. Both are needed: a test that steps only the scheduler builds the
  // entrance and then saves nothing, because no tick ever runs.
  const settle = () => {
    stepScheduler();
    service.tick();
  };
  for (let index = 0; index < 200; index += 1) {
    if (dungeon.chunksSaved >= 3) break;
    settle();
  }

  assert.equal(dungeon.chunkSaveFailures, 0,
    `${dungeon.chunkSaveFailures} chunk records failed to write: ${JSON.stringify(dungeon.chunksSaved)}`);

  // One write per tick at most: the store must never become a tick-size problem.
  const { ticks } = dungeon.controller.stats;
  assert.ok(dungeon.chunksSaved <= ticks, `${dungeon.chunksSaved} records written in ${ticks} ticks`);

  // A record reads back, with the plans and the progress of its chunk.
  const first = [...dungeon.savedChunks][0];
  const [chunkX, chunkZ] = first.split(",").map(Number);
  const read = service.readChunkAt("p1", chunkX, chunkZ);
  assert.equal(read.read.ok, true, `the record of chunk ${first} does not read back: ${JSON.stringify(read.read)}`);
  const anchor = anchorOf(chunkX, chunkZ, DUNGEON_CONFIG.floorY);
  assert.equal(api.getBlock(anchor.x, anchor.y, anchor.z), CHUNK_ANCHOR_BLOCK);
  // The anchor's block went down before its data did, and never after: a room that
  // later covers that cell is refused by the seal. Writing the block afterwards is
  // the one operation that erases the record, and it must never happen.
  assert.equal(api.clearedAfterData(`${anchor.x},${anchor.y},${anchor.z}`), false,
    "a block was written to the anchor after its data, which clears the record");

  // The record names the dungeon and the seed, so a reader knows what it belongs to.
  assert.equal(read.read.record.id, "lobby|easy");
  assert.equal(read.read.record.seed, dungeon.seed);

  // And nothing else in the dungeon sits on an anchor cell: every anchor block is
  // still there, still one write each.
  for (const key of dungeon.savedChunks) {
    const [x, z] = key.split(",").map(Number);
    const at = anchorOf(x, z, DUNGEON_CONFIG.floorY);
    assert.equal(api.getBlock(at.x, at.y, at.z), CHUNK_ANCHOR_BLOCK, `the anchor of chunk ${key} is gone`);
  }
});
