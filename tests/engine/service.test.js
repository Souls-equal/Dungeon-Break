import test from "node:test";
import assert from "node:assert/strict";

import { DUNGEON_CONFIG, DIFFICULTIES, findDifficulty } from "../../src/dungeon/engine/config.js";
import { BLOCKS } from "../../src/dungeon/builder.js";
import { step as stepScheduler } from "../../src/utils/scheduler.js";
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
function fakeApi() {
  const cells = new Map();
  const calls = { setBlock: [], setPosition: [], sendMessage: [], setCantChangeBlockRect: [] };
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
      // Teleporting is what loads the chunks around the player, as in the game.
      loadedRects.push({
        x1: Math.floor(position[0]) - 16, x2: Math.floor(position[0]) + 16,
        z1: Math.floor(position[2]) - 16, z2: Math.floor(position[2]) + 16,
      });
    },
    getPosition(playerId) {
      const position = positions.get(playerId);
      return position || null;
    },
    // Recorded with its arity: a protection called with the wrong number of
    // arguments protects nothing and throws nothing, which is the worst case.
    setCantChangeBlockRect(...args) { calls.setCantChangeBlockRect.push(args); },
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
  assert.equal(api.calls.setCantChangeBlockRect.length, 1, "the entrance was never protected");
  assert.equal(api.calls.setCantChangeBlockRect[0].length, 2,
    "the protection must take two positions, like setBlockRect");
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
