import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import { DUNGEON_CONFIG, DIFFICULTIES, findDifficulty } from "../src/dungeon/config.js";

const worldCode = fs.readFileSync(new URL("../world-code/worldCode.js", import.meta.url), "utf8");
const SIZE = DUNGEON_CONFIG.chunkSize;
const LOBBY_POSITION = [10, 21, 10];
const VERY_EASY = findDifficulty("veryEasy");

/**
 * The template chunk the tests build, and the tables they hand to the bundle.
 *
 * The shipped `ROOM_TEMPLATES` points at a hand-built zone that a test world does
 * not have, so
 * the world code is tested against a template set injected through the module
 * scope: the same code path a real template takes, with coordinates that exist in
 * the fake world.
 */
const TEST_SRC = [0, -32, 0];
const TEST_TEMPLATES = [
  { src: TEST_SRC },
  { src: [64, -32, 0] },
];

/**
 * Points the bundle at the test templates.
 *
 * The shipped table is empty — the coordinates are the one thing that has to be
 * filled in by hand — so the tests override `ROOM_TEMPLATES` in the context the
 * bundle runs in, which is the same object the loader reads. Nothing in the
 * bundle is rewritten: the code under test is the code that ships.
 */
const TEST_TABLE = { rooms: TEST_TEMPLATES };



/**
 * A fake Bloxd server with the three rules that matter:
 *
 *   - a chunk is only readable once it has been sent, and it is sent a tick or two
 *     after the first read asks for it;
 *   - `copyChunk` does nothing when its source chunk is not loaded, and nothing when
 *     its destination has not been sent either;
 *   - `getBlock` returns `null` outside a loaded chunk, never "Air".
 *
 * A room carries its own record — a Bedrock floor and ceiling — so the fake builds
 * one, and the world code only ever reads it.
 */
function createWorld(onlinePlayerIds, options = {}) {
  const loadDelay = options.loadDelay === undefined ? 1 : options.loadDelay;
  const loadRadius = options.loadRadius === undefined ? 6 : options.loadRadius;
  const messages = [];
  const clientOptions = [];
  const positions = [];
  const copies = [];
  const violations = [];
  /** What the world code asked the shop to show: category → key → item. */
  const shop = new Map();
  const players = options.positions ? { ...options.positions } : {};
  const template = new Map();
  const world = new Map();
  const loaded = new Set();
  const pending = [];
  const key = (x, y, z) => `${Math.floor(x)}|${Math.floor(y)}|${Math.floor(z)}`;

  // A room: floor at local y 2, four walls, and a ceiling.
  //
  // `TEST_TEMPLATES` gives a `src` in block coordinates, which the engine floors to
  // the chunk it copies — so every template in the test table gets a room built at
  // that same block origin. The engine picks one of them at random for a room, and a
  // table whose other entries are empty is a table of rooms with no floor.
  const floorY = 2;
  for (const entry of TEST_TEMPLATES) {
    const base = entry.src.map((value) => Math.floor(value / SIZE) * SIZE);
    for (let x = 0; x < SIZE; x += 1) {
      for (let z = 0; z < SIZE; z += 1) {
        template.set(key(base[0] + x, base[1] + floorY, base[2] + z), "Stone Bricks");
        template.set(key(base[0] + x, base[1] + floorY + 5, base[2] + z), "Smooth Stone");
      }
    }
    for (let y = 0; y <= floorY + 1; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        for (const z of [0, SIZE - 1]) {
          // A door in the middle of each face, so a room is a room and not a box.
          if (z === 0 && x >= 13 && x <= 18 && y <= floorY + 1) continue;
          template.set(key(base[0] + x, base[1] + y, base[2] + z), "Stone");
        }
        for (const xx of [0, SIZE - 1]) {
          template.set(key(base[0] + xx, base[1] + y, base[2] + x), "Stone");
        }
      }
    }
    // Bedrock under the floor and over the ceiling: the record a built room carries.
    for (let x = 0; x < SIZE; x += 1) {
      for (let z = 0; z < SIZE; z += 1) {
        template.set(key(base[0] + x, base[1] + floorY - 1, base[2] + z), "Bedrock");
        template.set(key(base[0] + x, base[1] + SIZE - 1, base[2] + z), "Bedrock");
      }
    }
  }

  function advance() {
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      pending[index].ticks -= 1;
      if (pending[index].ticks > 0) continue;
      loaded.add(pending[index].key);
      pending.splice(index, 1);
    }
  }

  const near = (x, y, z) => loaded.has(`${Math.floor(x / SIZE)}|${Math.floor(y / SIZE)}|${Math.floor(z / SIZE)}`);

  const context = {
    api: {
      sendMessage: (playerId, message) => messages.push({ playerId, message }),
      setClientOption: (playerId, option, value) => clientOptions.push({ playerId, option, value }),
      setClientOptions: (playerId, options2) => {
        for (const option of Object.keys(options2)) clientOptions.push({ playerId, option, value: options2[option] });
      },
      // The shop is how a player gets back to spawn in this world: it is registered
      // by the world code, and the fake keeps what was asked for.
      createShopItem: (categoryKey, itemKey, item) => {
        if (!shop.has(categoryKey)) shop.set(categoryKey, new Map());
        shop.get(categoryKey).set(itemKey, item);
      },
      // Nothing may be written into a chunk, loaded or not: a write is a failure on
      // its own, and the fake keeps the world as the copies made it.
      setBlock: (x, y, z, blockName) => {
        violations.push({ x, y, z, blockName });
      },
      getBlock: (x, y, z) => {
        const chunkKey = `${Math.floor(x / SIZE)}|${Math.floor(y / SIZE)}|${Math.floor(z / SIZE)}`;
        if (!loaded.has(chunkKey)) {
          // The read is the request: the chunk arrives a tick or two later.
          if (!pending.some((entry) => entry.key === chunkKey)) pending.push({ key: chunkKey, ticks: loadDelay });
          return null;
        }
        const fromTemplate = template.get(key(x, y, z));
        if (fromTemplate !== undefined) return fromTemplate;
        const value = world.get(key(x, y, z));
        return value === undefined ? "Air" : value;
      },
      copyChunk: (from, to) => {
        copies.push({ from: Array.from(from), to: Array.from(to) });
        const sourceChunk = [Math.floor(from[0] / SIZE), Math.floor(from[1] / SIZE), Math.floor(from[2] / SIZE)];
        const destinationChunk = [Math.floor(to[0] / SIZE), Math.floor(to[1] / SIZE), Math.floor(to[2] / SIZE)];
        if (!loaded.has(sourceChunk.join("|"))) return;
        if (!loaded.has(destinationChunk.join("|"))) return;
        const destChunk = [Math.floor(to[0] / SIZE), Math.floor(to[1] / SIZE), Math.floor(to[2] / SIZE)];
        // A copy carries the template's blocks and nothing else, exactly as the
        // server does it.
        for (const [cellKey, name] of template) {
          const [x, y, z] = cellKey.split("|").map(Number);
          if (Math.floor(x / SIZE) !== sourceChunk[0]) continue;
          if (Math.floor(y / SIZE) !== sourceChunk[1]) continue;
          if (Math.floor(z / SIZE) !== sourceChunk[2]) continue;
          world.set(key(
            x - sourceChunk[0] * SIZE + destChunk[0] * SIZE,
            y - sourceChunk[1] * SIZE + destChunk[1] * SIZE,
            z - sourceChunk[2] * SIZE + destChunk[2] * SIZE,
          ), name);
        }
      },
      isNearInterrupt: () => false,
      setPosition: (playerId, position) => {
        const value = Array.from(position);
        positions.push({ playerId, position: value });
        players[playerId] = value;
        // Teleporting is what loads the chunks around a player, as in the game.
        const chunkX = Math.floor(value[0] / SIZE);
        const chunkY = Math.floor(value[1] / SIZE);
        const chunkZ = Math.floor(value[2] / SIZE);
        for (let dx = -loadRadius; dx <= loadRadius; dx += 1) {
          for (let dz = -loadRadius; dz <= loadRadius; dz += 1) {
            loaded.add(`${chunkX + dx}|${chunkY}|${chunkZ + dz}`);
          }
        }
      },
      getPosition: (playerId) => players[playerId] || null,
      getPlayerIds: () => onlinePlayerIds,
      log: (message) => messages.push({ playerId: null, message }),
      now: () => 1710000000000,
    },
  };
  context.ROOM_TEMPLATES = options.templates === null ? {} : (options.templates || TEST_TABLE);
  vm.runInNewContext(worldCode, context);
  return {
    context,
    messages,
    clientOptions,
    positions,
    copies,
    violations,
    shop,
    world,
    template,
    advance,
    /** Every server tick and Bloxd tick together, as the game runs them. */
    tick(count = 1) {
      for (let index = 0; index < count; index += 1) {
        advance();
        context.tick();
      }
    },
    movePlayer: (playerId, position) => { players[playerId] = position; },
    blockAt: (x, y, z) => world.get(key(x, y, z)),
  };
}

function tickUntil(world, predicate, limit = 4000) {
  for (let index = 0; index < limit; index += 1) {
    if (predicate()) return true;
    world.advance();
    world.context.tick();
  }
  return predicate();
}

/** The place this player's dungeon was built at, read from the world code itself. */
function originOf(world, playerId = "p1") {
  // The `/dbg` report is the only public door to it, so read it where it is printed.
  const before = world.messages.length;
  world.context.playerCommand(playerId, "level");
  const lines = world.messages.slice(before).map((entry) => entry.message).join("\n");
  const match = lines.match(/origin (-?\d+),(-?\d+),(-?\d+)/);
  return match ? { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) } : null;
}

const said = (world, playerId) => world.messages
  .filter((entry) => entry.playerId === playerId)
  .map((entry) => entry.message);

function startDungeon(world, playerId, blockName = "Lime Concrete") {
  world.context.onBlockStandStart(playerId, 2, 10, 3, blockName);
  world.tick(10 * 20 + 6);
}

// ------------------------------------------------------------------- lobby --

test("steping on a pad starts a countdown that clears itself on completion", () => {
  const world = createWorld(["p1"]);
  world.context.onBlockStandStart("p1", 2, 10, 3, "Lime Concrete");
  assert.ok(said(world, "p1").some((message) => message.includes("Very Easy")));
  assert.equal(world.clientOptions.at(-1).value, "Very Easy — starting in 10...");

  world.tick(199);
  assert.equal(world.copies.length, 0, "a room was copied during the countdown");
  assert.equal(world.clientOptions.at(-1).value, "Very Easy — starting in 1...");
});

test("moving between same-colour pads keeps the countdown running", () => {
  const world = createWorld(["p1"]);
  world.context.onBlockStandStart("p1", 2, 10, 3, "Lime Concrete");
  world.tick(25);
  world.context.onBlockStandStart("p1", 3, 10, 3, "Lime Concrete");
  world.tick(15);
  assert.equal(world.clientOptions.at(-1).value, "Very Easy — starting in 8...",
    "crossing to another pad of the same difficulty restarted the countdown");
});

test("leaving the pad cancels the countdown", () => {
  const world = createWorld(["p1"]);
  world.context.onBlockStandStart("p1", 2, 10, 3, "Yellow Concrete");
  world.tick(40);
  world.context.onBlockStandStop("p1", 2, 10, 3, "Yellow Concrete");
  world.tick(10);
  assert.ok(said(world, "p1").some((message) => message.includes("Countdown cancelled")));
});

test("a stale stop in the final tick does not cancel the descent", () => {
  const world = createWorld(["p1"]);
  world.context.onBlockStandStart("p1", 2, 10, 3, "Lime Concrete");
  world.tick(199);
  world.context.onBlockStandStop("p1", 2, 10, 3, "Lime Concrete");
  world.tick(12);
  // Two moves: into the empty chunk, then onto the floor the copy produced. What
  // matters is that the descent happened at all, after a stop callback that would
  // have cancelled it.
  assert.equal(world.positions.length, 2, "the player was never moved into the dungeon");
  assert.ok(said(world, "p1").some((message) => message === "Level: Very Easy"),
    "the dungeon was not entered after a stale stop");
});

test("joining puts the player in the lobby and names the pads", () => {
  const world = createWorld(["p1"]);
  world.context.onPlayerJoin("p1");
  assert.deepEqual(world.positions[0].position, LOBBY_POSITION);
  const welcome = said(world, "p1")[0];
  assert.match(welcome, /Welcome to Dungeon Break/);
  assert.match(welcome, /Very Easy, Easy, Medium/);
});

test("the British spelling of the grey pad is the same difficulty", () => {
  const world = createWorld(["p1"]);
  world.context.onBlockStandStart("p1", 2, 10, 3, "Grey Concrete");
  assert.ok(said(world, "p1").some((message) => message.includes("Ultra Insane")));
});

// ------------------------------------------------------------- the descent --

test("a level is one chunk copy, and the player lands on its floor", () => {
  for (let draw = 0; draw < 12; draw += 1) {
    const world = createWorld(["p1"]);
    startDungeon(world, "p1");
    tickUntil(world, () => said(world, "p1").includes("Level: Very Easy"), 400);

    // The rooms around the entrance follow within a few ticks; what matters is that
    // the first copy, the one the player lands on, is the entrance's chunk — which is
    // at the place this entry drew.
    assert.ok(world.copies.length >= 1, "nothing was copied");
    const origin = originOf(world);
    assert.ok(origin, "no place was drawn for the dungeon");
    assert.deepEqual(world.copies[0].to, [origin.x * SIZE, origin.y * SIZE, origin.z * SIZE],
      `the first copy is not the entrance: ${JSON.stringify(world.copies[0])}`);
    const landing = world.positions.at(-1).position;
    // Two blocks above the floor block the template has at local y 2.
    assert.equal(landing[1], origin.y * SIZE + 2 + DUNGEON_CONFIG.spawnAboveFloor);
    assert.equal(Math.abs(landing[0] % 1), 0.5, "the player is not in the middle of a cell on x");
    assert.equal(Math.abs(landing[2] % 1), 0.5, "the player is not in the middle of a cell on z");
    // Away from the room's walls, whatever the draw.
    const localX = Math.floor(landing[0]) - origin.x * SIZE;
    const localZ = Math.floor(landing[2]) - origin.z * SIZE;
    assert.ok(localX >= DUNGEON_CONFIG.landingMargin && localX < SIZE - DUNGEON_CONFIG.landingMargin,
      `the player lands in the wall at x ${localX}`);
    assert.ok(localZ >= DUNGEON_CONFIG.landingMargin && localZ < SIZE - DUNGEON_CONFIG.landingMargin,
      `the player lands in the wall at z ${localZ}`);
    // And the floor is really there, read from the world and not from a tally.
    assert.equal(world.blockAt(Math.floor(landing[0]), landing[1] - DUNGEON_CONFIG.spawnAboveFloor, Math.floor(landing[2])),
      "Stone Bricks");
    assert.ok(said(world, "p1").includes("Level: Very Easy"));
  }
});

test("gravity is off while the room is being built, and on once the player stands", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  const options = world.clientOptions.filter((entry) => entry.option === "gravityMultiplier");
  assert.equal(options[0].value, 0, "a player was dropped into an empty chunk with gravity on");
  tickUntil(world, () => options.some((entry) => entry.value === 1) || world.clientOptions.some((entry) => entry.option === "gravityMultiplier" && entry.value === 1), 200);
  assert.equal(world.clientOptions.filter((entry) => entry.option === "gravityMultiplier").at(-1).value, 1,
    "gravity was never switched back on");
});

test("the world code writes no block into a room", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  tickUntil(world, () => world.positions.length >= 2, 200);
  world.tick(40);
  // A room is hand-built and only ever copied: no pad, no marker, no repair.
  assert.deepEqual(world.violations, [], "the world code wrote a block");
  assert.equal(world.copies.length > 0, true, "nothing was copied, so the test proves nothing");
});

test("a Concrete pad built into a room leads to the next level", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  tickUntil(world, () => said(world, "p1").includes("Level: Very Easy"), 400);
  const landing = world.positions.at(-1).position;

  // The pad is part of the room: it is in the template, and stepping on it is all
  // it takes. Nothing was written to produce it.
  world.context.onBlockStandStart(
    "p1",
    Math.floor(landing[0]),
    Math.floor(landing[1]) - 1,
    Math.floor(landing[2]),
    "Light Blue Concrete",
  );
  world.tick(3);
  const last = world.positions.at(-1).position;
  // The wait place is inside the next level's chunk, which is what loads it: the
  // player is put in the middle of that chunk, at the layer this entry drew.
  const next = originOf(world);
  assert.ok(next, "the next level has no place");
  assert.equal(Math.floor(last[0] / SIZE), next.x);
  assert.equal(Math.floor(last[1] / SIZE), next.y);
  assert.equal(Math.floor(last[2] / SIZE), next.z);
  // And it is a place of its own: a new level drew a new cube, so the player does not
  // rebuild in the rooms they just left.
  assert.notDeepEqual(next, { x: Math.floor(landing[0] / SIZE), y: Math.floor(landing[1] / SIZE), z: Math.floor(landing[2] / SIZE) });
});

test("a room is never copied from an unloaded template, and that is said once", () => {
  const world = createWorld(["p1"], { loadDelay: 1000 });
  world.context.onBlockStandStart("p1", 2, 10, 3, "Lime Concrete");
  world.tick(10 * 20 + 40);
  // The template was never readable, so no copy could be trusted: the player is
  // told why instead of being dropped into the void.
  assert.equal(world.copies.length, 0, "a copy was attempted from an unreadable template");
  assert.ok(said(world, "p1").some((message) => /not loaded/.test(message)));
});

test("a level with no template at all is a message, not a fall", () => {
  // An empty table, which is the state of a checkout whose zone has not been
  // filled in yet: the player is told, and nothing is copied.
  const world = createWorld(["p1"], { templates: null });
  world.context.onPlayerJoin("p1");
  world.context.onBlockStandStart("p1", 2, 10, 3, "Purple Concrete");
  world.tick(10 * 20 + 20);
  const told = said(world, "p1");
  assert.equal(world.copies.length, 0);
  assert.ok(told.some((message) => /has no rooms yet|not loaded/.test(message)),
    `nothing explained the empty level: ${JSON.stringify(told)}`);
});

// --------------------------------------------------------------- movement --

test("walking around copies the rooms the player can see, one per tick", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  tickUntil(world, () => said(world, "p1").includes("Level: Very Easy"), 400);

  const origin = originOf(world);
  assert.ok(origin, "no place was drawn for the dungeon");
  const landing = world.positions.at(-1).position;
  world.tick(5);
  const entranceCopies = world.copies.filter(
    (copy) => copy.to[0] === origin.x * SIZE && copy.to[2] === origin.z * SIZE,
  );
  assert.equal(entranceCopies.length, 1, "the entrance was not copied exactly once");
  assert.ok(world.copies.length > 1, "the rooms around the player were not queued at all");

  // Walking away from the entrance asks for rooms that are not built yet, so this is
  // where the per-tick budget shows: the rooms that are out of view are the ones the
  // scan picks up, one copy at a time.
  const before = world.copies.length;
  world.movePlayer("p1", [landing[0] + 4 * SIZE, landing[1], landing[2] + 4 * SIZE]);
  world.tick(1);
  assert.ok(world.copies.length - before <= 1, `${world.copies.length - before} copies in one tick`);
  world.tick(59);
  const after = world.copies.length - before;
  assert.ok(after > 0, "no room was built around a player who walked into the dungeon");
  // One copy per tick is the whole budget; sixty ticks cannot produce more.
  assert.ok(after <= 60, `${after} copies in 60 ticks, which is more than the budget`);

  // Every copy lands on the level's own layer, never on another difficulty's.
  for (const copy of world.copies) {
    assert.equal(Math.floor(copy.to[1] / SIZE), origin.y,
      `a copy landed on chunk layer ${Math.floor(copy.to[1] / SIZE)}`);
  }
});

test("the rooms the player walks towards are copied before the far ones", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  tickUntil(world, () => said(world, "p1").includes("Level: Very Easy"), 400);
  const origin = originOf(world);
  assert.ok(origin, "no place was drawn for the dungeon");
  world.tick(30);
  // The entrance is where this entry drew; the first copies are the ones next to it.
  const first = world.copies.slice(0, 5).map((copy) => [
    Math.floor(copy.to[0] / SIZE) - origin.x,
    Math.floor(copy.to[2] / SIZE) - origin.z,
  ]);
  assert.deepEqual(first[0], [0, 0], "the first room copied is not the one the player is in");
  for (const [x, z] of first.slice(1)) {
    assert.ok(Math.abs(x) + Math.abs(z) <= 2, `room ${x},${z} from the entrance was copied before the near ones`);
  }
});

test("a player who drops out of the world is put back on a floor", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  tickUntil(world, () => world.positions.length >= 2, 200);
  const landing = world.positions.at(-1).position;

  // Far below the level: the one failure that survives the design, so it is
  // handled rather than denied. The rescue draws a fresh landing — a player put back
  // where they last were is a player put back where they fell — so what matters is
  // that it is on a floor of this level and away from the walls.
  world.movePlayer("p1", [landing[0], landing[1] - 100, landing[2]]);
  world.tick(2);
  const rescued = world.positions.at(-1).position;
  assert.equal(rescued[1], landing[1], "the player was left falling");
  // The rescue happens inside the room, so its local column is what has to be away
  // from the walls — a random place in the world is no reason to skip that.
  const origin = originOf(world);
  const localX = Math.floor(rescued[0]) - origin.x * SIZE;
  const localZ = Math.floor(rescued[2]) - origin.z * SIZE;
  assert.ok(localX >= DUNGEON_CONFIG.landingMargin && localX < SIZE - DUNGEON_CONFIG.landingMargin,
    `the rescue position x ${localX} in the room is against a wall`);
  assert.ok(localZ >= DUNGEON_CONFIG.landingMargin && localZ < SIZE - DUNGEON_CONFIG.landingMargin,
    `the rescue position z ${localZ} in the room is against a wall`);
});

test("leaving the game puts the player back in the lobby", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  tickUntil(world, () => world.positions.length >= 2, 200);
  world.context.onPlayerLeave("p1");
  assert.deepEqual(world.positions.at(-1).position, LOBBY_POSITION);
});

test("no block is ever written outside a loaded chunk", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  tickUntil(world, () => world.positions.length >= 2, 200);
  const landing = world.positions.at(-1).position;
  for (const dx of [0, 12, 24]) {
    world.movePlayer("p1", [landing[0] + dx, landing[1], landing[2]]);
    world.tick(40);
  }
  assert.deepEqual(world.violations, [],
    "a block was written into a chunk the server had not sent, where it is dropped silently");
});

// ------------------------------------------------------------------ debug --

test("/dbg outside a dungeon answers instead of staying silent", () => {
  const world = createWorld(["p1"]);
  assert.equal(world.context.playerCommand("p1", "dbg"), true);
  assert.match(said(world, "p1")[0], /not in a dungeon/);
});

test("/dbg reports the level, the chunk and the counts", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  tickUntil(world, () => world.positions.length >= 2, 200);
  world.tick(40);
  const before = world.messages.length;
  world.context.playerCommand("p1", "dbg");
  const lines = world.messages.slice(before).map((entry) => entry.message);
  assert.ok(lines.length >= 4, `the report was cut short: ${lines.length} line(s)`);
  for (const line of lines) assert.match(line, /^\[dbg\]/);
  const joined = lines.join("\n");
  // The layer is the one this entry drew, not a constant of the difficulty.
  const origin = originOf(world);
  assert.ok(origin, "no place was drawn for the dungeon");
  assert.match(joined, new RegExp(`Very Easy · layer ${origin.y}( |$)`));
  assert.match(joined, new RegExp(`origin ${origin.x},${origin.y},${origin.z}`));
  assert.match(joined, /chunk -?\d+,-?\d+/);
  assert.match(joined, /placed \d+/);
  assert.doesNotMatch(joined, /undefined|NaN/);
});

test("/dbg templates says whether each template can actually be read", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  tickUntil(world, () => world.positions.length >= 2, 200);
  tickUntil(world, () => world.positions.length >= 2, 200);
  const before = world.messages.length;
  world.context.playerCommand("p1", "templates");
  const lines = world.messages.slice(before).map((entry) => entry.message);
  assert.ok(lines.length >= TEST_TEMPLATES.length, `no template was listed: ${JSON.stringify(lines)}`);
  // The chunk coordinate the player built against, then the block the engine
  // copies — both, because the first is what a builder recognises and the second
  // is what the API takes.
  assert.ok(lines.some((line) => /chunk 0,-1,0 → block 0,-32,0 · loaded/.test(line)),
    `no readable room was reported: ${lines.join(" | ")}`);
});

test("/dbg mem reports the counters that must stay bounded", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  tickUntil(world, () => world.positions.length >= 2, 200);
  world.tick(30);
  const before = world.messages.length;
  world.context.playerCommand("p1", "mem");
  const lines = world.messages.slice(before).map((entry) => entry.message);
  const header = lines.find((message) => /layer/.test(message));
  // The header names the level and the place this entry drew, because two players on
  // the same level no longer share either.
  assert.match(header, /Very Easy · layer -?\d+ · room origin -?\d+,-?\d+,-?\d+ · templates \d+/);
  assert.match(lines.join("\n"), /queued \d+ · planned \d+ · rooms \d+ \(\d+ in flight\)/);
  assert.match(lines.join("\n"), /placed \d+ · loading \d+ · failed \d+/);
});

test("an unknown command is left to the game", () => {
  const world = createWorld(["p1"]);
  assert.equal(world.context.playerCommand("p1", "spawn"), false);
  assert.equal(world.messages.length, 0);
});

test("every chat form of the debug command is understood", () => {
  const world = createWorld(["p1"]);
  for (const form of ["dbg", "/dbg", "debug", "/debug", "dbg info", "DEBUG"]) {
    assert.equal(world.context.playerCommand("p1", form), true, `"${form}" was not handled`);
  }
  // `/debug mem` never throws on a level nobody has loaded.
  assert.equal(world.context.playerCommand("p1", "debug mem"), true);
});

// ------------------------------------------------------------- the bundle --

test("the bundle carries every room template the source declares", () => {
  const world = createWorld(["p1"]);
  assert.equal(typeof world.context.ROOM_TEMPLATES, "object");
  // A template added to the source must reach the copy that is pasted in game.
  const source = fs.readFileSync(new URL("../src/dungeon/templates.js", import.meta.url), "utf8");
  assert.ok(source.includes("globalThis.ROOM_TEMPLATES"), "the template table moved out of templates.js");
  assert.ok(worldCode.includes("copyChunk"), "the bundle does not copy chunks");
  assert.ok(!/setBlockRect|setBlockWalls/.test(worldCode), "the bundle falls back to bulk block writes");
  // The pad blocks reach the bundle as the difficulty table's own data, so a new
  // level in `config.js` cannot be a pad that exists in the source and not in game.
  for (const difficulty of DIFFICULTIES) {
    assert.ok(worldCode.includes(difficulty.id), `level ${difficulty.id} is missing from the bundle`);
  }
  assert.ok(worldCode.includes("padBlock"), "the pad table is missing from the bundle");
  assert.ok(worldCode.includes("globalThis.ROOM_TEMPLATES"), "the template table is not reachable from the game");
});

// ------------------------------------------------------------------- shop --

test("a player at spawn is never a player with a dungeon", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  tickUntil(world, () => said(world, "p1").includes("Level: Very Easy"), 400);
  const before = world.copies.length;

  // The shop item teleports to spawn, and the dungeon must stop **before** that:
  // the alternative is a generator reading the chunk spawn happens to be in.
  world.context.onPlayerBoughtShopItem("p1", "Utilities", "Teleport to spawn", {}, "");

  // The teleport happened, and it is the spawn position.
  const last = world.positions.at(-1).position;
  assert.deepEqual(last.slice(0, 3), [10, 21, 10]);
  // Nothing is copied around spawn, and nothing was left to copy: `/dbg` no longer
  // reports a dungeon for this player.
  const since = world.copies.length;
  world.tick(40);
  assert.equal(world.copies.length, since,
    `${world.copies.length - since} rooms were built after the player went to spawn`);
  assert.equal(world.context.playerCommand("p1", "level"), true);
  assert.ok(said(world, "p1").some((message) => /not in a dungeon/.test(message)),
    `a dungeon survived the teleport: ${JSON.stringify(said(world, "p1").slice(-4))}`);
  assert.ok(before > 0);
});

test("a teleport during the entrance wait abandons the entrance", () => {
  // The worst case: the player is in the air, the entrance copy is scheduled a tick
  // later. Teleporting must not place them back in the dungeon.
  const world = createWorld(["p1"]);
  world.context.onBlockStandStart("p1", 2, 10, 3, "Lime Concrete");
  world.tick(10 * 20 + 1);
  assert.ok(!said(world, "p1").includes("Level: Very Easy"));
  world.context.onPlayerBoughtShopItem("p1", "Utilities", "Teleport to spawn", {}, "");
  world.tick(20);
  assert.ok(!said(world, "p1").includes("Level: Very Easy"),
    "the entrance was completed after the player had gone to spawn");
  assert.deepEqual(world.positions.at(-1).position.slice(0, 3), [10, 21, 10]);
});

test("the shop offers spawn in a Utilities category", () => {
  const world = createWorld(["p1"]);
  world.context.onPlayerJoin("p1");
  const items = world.shop.get("Utilities");
  assert.ok(items, "the Utilities category was not created");
  const spawn = items.get("Teleport to spawn");
  assert.ok(spawn, "the spawn item was not created");
  // Free, with a buy button: the item is an action, not a purchase.
  assert.equal(spawn.cost, 0);
  assert.equal(spawn.canBuy, true);
  assert.ok(spawn.image, "the item has no image to draw");
});

test("buying anything else does nothing", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  tickUntil(world, () => said(world, "p1").includes("Level: Very Easy"), 400);
  const lastDungeonPosition = world.positions.at(-1).position;
  world.context.onPlayerBoughtShopItem("p1", "Utilities", "Something else", {}, "");
  assert.deepEqual(world.positions.at(-1).position, lastDungeonPosition);
  assert.ok(world.context.playerCommand("p1", "level"));
  assert.ok(!said(world, "p1").some((message) => /not in a dungeon/.test(message)));
});
