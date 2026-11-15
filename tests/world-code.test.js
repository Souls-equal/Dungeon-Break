import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import { DUNGEON_CONFIG, DIFFICULTIES, findDifficulty } from "../src/dungeon/config.js";
import { AURA_PER_LEVEL, MAX_AURA_LEVEL } from "../src/benediction/config.js";

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
  // Mobs and the per-block data the code reads back: a cleared room is a record on a block.
  const mobs = new Map();
  const mobSpawns = [];
  const mobDespawns = [];
  const blockData = new Map();
  const blockDataWrites = [];
  // Keys dropped, where they landed, and every block the code set.
  const itemDrops = [];
  const setBlocks = [];
  // Aura (the game's XP) paid to players, and the level the fake game reports.
  const auraGiven = [];
  const auraLevels = {};
  if (options.auraLevel !== undefined) {
    for (const playerId of onlinePlayerIds) auraLevels[playerId] = options.auraLevel;
  }
  // The database, per player, as the game keeps it.
  const dbValues = new Map();
  /** Every per-player shop item the code asked for: playerId → category → key → item. */
  const playerShop = new Map();
  /** The cards drawn in the top-right corner, and the banners queued mid-screen. */
  const helperCards = [];
  const middleTexts = [];
  /** Which players have the shop open, the category configuration, and every open/close. */
  const shopOpen = new Set();
  const shopCategories = [];
  const shopCalls = [];
  /** Auroras reset by the code, and the custom currencies it defined: `player|currency`. */
  const aurasReset = [];
  /**
   * Every `resetShopItemForPlayer` call: that is how a tile is **removed**. The fake applies
   * it for real (the tile leaves the category), because "hidden" was what the owner saw fail.
   */
  const removedTiles = [];
  const currencies = new Map();
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
      // A tile for one player, which is how a per-player count is shown.
      createShopItemForPlayer: (playerId, categoryKey, itemKey, item) => {
        if (!playerShop.has(playerId)) playerShop.set(playerId, new Map());
        const categories = playerShop.get(playerId);
        if (!categories.has(categoryKey)) categories.set(categoryKey, new Map());
        categories.get(categoryKey).set(itemKey, item);
      },
      // **How a tile is actually removed**, per the documented API: it deletes this player's
      // override for the key, and does nothing if there is none — it never throws. The fake
      // removes it for real, so a tile the code forgets to reset stays visible in the tests.
      resetShopItemForPlayer: (playerId, categoryKey, itemKey) => {
        removedTiles.push({ playerId, categoryKey, itemKey });
        const categories = playerShop.get(playerId);
        const items = categories && categories.get(categoryKey);
        if (items) items.delete(itemKey);
      },
      configureShopCategoryForPlayer: (playerId, categoryKey, config) => {
        if (!playerShop.has(playerId)) playerShop.set(playerId, new Map());
        const categories = playerShop.get(playerId);
        if (!categories.has(categoryKey)) categories.set(categoryKey, new Map());
        shopCategories.push({ playerId, categoryKey, config });
      },
      // `openShop(playerId, toggle)`: a toggle on an open shop closes it. The fake counts
      // what it was asked, because "the shop closes itself" is part of the request.
      openShop: (playerId, toggle) => {
        const wasOpen = shopOpen.has(playerId);
        if (toggle === true) {
          if (wasOpen) shopOpen.delete(playerId);
          else shopOpen.add(playerId);
        } else {
          shopOpen.add(playerId);
        }
        shopCalls.push({ playerId, toggle: Boolean(toggle), wasOpen });
      },
      // Benedictions: the game's aura level, a permanent id, and the player database.
      getAuraInfo: (playerId) => ({
        level: auraLevels[playerId] === undefined ? 1 : auraLevels[playerId],
        totalAura: 0,
        auraPerLevel: 100,
      }),
      // The aura is a number the game holds: `setTotalAura(0)` is the reset, and it is
      // visible here because the next `getAuraInfo` must answer level 1.
      setTotalAura: (playerId, total) => {
        aurasReset.push({ playerId, total });
        auraLevels[playerId] = 1;
      },
      // The points are a custom currency: the fake keeps the last amount per currency.
      setCurrency: (playerId, currencyId, info) => currencies.set(`${playerId}|${currencyId}`, info),
      setCurrencyAmount: (playerId, currencyId, amount, subtext) => {
        const existing = currencies.get(`${playerId}|${currencyId}`) || {};
        currencies.set(`${playerId}|${currencyId}`, { ...existing, amount, subtext });
      },
      getPlayerDbId: (playerId) => `db-${playerId}`,
      getPlayerDbValue: (playerId, key2) => {
        const values = dbValues.get(playerId);
        return values && values.has(key2) ? values.get(key2) : null;
      },
      setPlayerDbValue: (playerId, key2, value) => {
        if (!dbValues.has(playerId)) dbValues.set(playerId, new Map());
        dbValues.get(playerId).set(key2, value);
      },
      sendTopRightHelper: (playerId, icon, text, opts) => {
        helperCards.push({ playerId, icon, text, opts });
      },
      queueMiddleTextUpper: (playerId, text, duration) => {
        middleTexts.push({ playerId, text, duration });
      },
      // Nothing may be written into a chunk, loaded or not: a write is a failure on
      // its own, and the fake keeps the world as the copies made it.
      setBlock: (x, y, z, blockName) => {
        // A written block is a violation, **except** the one write the owner asked for: a
        // chest that becomes Air when it pays out. And the write is applied, so the next
        // read answers what the game would answer.
        setBlocks.push({ x, y, z, blockName });
        if (blockName !== "Air") violations.push({ x, y, z, blockName });
        world.set(key(x, y, z), blockName);
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
      // --- mobs -------------------------------------------------------------
      // A spawn hands back an id at once, but the mob only exists one tick later: the
      // fake keeps that delay, because applying a setting too early is the bug the
      // docs warn about.
      attemptSpawnMob: (mobType, x, y, z, opts = {}) => {
        mobSpawns.push({ mobType, x, y, z, opts });
        const mobId = `mob-${mobSpawns.length}`;
        mobs.set(mobId, { type: mobType, settings: new Map(), pending: true });
        return mobId;
      },
      despawnMob: (mobId) => {
        mobDespawns.push(mobId);
        mobs.delete(mobId);
      },
      getMobIds: () => Array.from(mobs.keys()),
      getMobSetting: (mobId, setting) => {
        const mob = mobs.get(mobId);
        if (!mob || mob.pending) return undefined;
        return mob.settings.has(setting) ? mob.settings.get(setting) : 150;
      },
      setMobSetting: (mobId, setting, value) => {
        const mob = mobs.get(mobId);
        if (!mob || mob.pending) return;
        mob.settings.set(setting, value);
      },
      // Solid, and solid for an unloaded chunk — the documented trap.
      getBlockSolidity: (x, y, z) => {
        if (!near(x, y, z)) return true;
        const name = context.api.getBlock(x, y, z);
        return !(name === "Air" || name === "Short Grass");
      },
      applyAuraChange: (playerId, amount) => {
        auraGiven.push({ playerId, amount });
        return amount;
      },
      createItemDrop: (x, y, z, itemName, amount) => {
        itemDrops.push({ x, y, z, itemName, amount });
        return `drop-${itemDrops.length}`;
      },
      getBlockData: (x, y, z) => blockData.get(key(x, y, z)) || null,
      setBlockData: (x, y, z, data) => {
        blockData.set(key(x, y, z), data);
        blockDataWrites.push({ x, y, z, data });
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
    mobs,
    mobSpawns,
    mobDespawns,
    blockData,
    blockDataWrites,
    itemDrops,
    setBlocks,
    auraGiven,
    auraLevels,
    shopOpen,
    shopCategories,
    shopCalls,
    aurasReset,
    currencies,
    removedTiles,
    dbValues,
    playerShop,
    helperCards,
    middleTexts,
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
        // A mob spawned on the previous tick exists now, which is when its stats apply.
        for (const mob of mobs.values()) mob.pending = false;
        context.tick();
      }
    },
    movePlayer: (playerId, position) => { players[playerId] = position; },
    setAuraLevel: (playerId, level) => { auraLevels[playerId] = level; },
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
  {
    const v = world.clientOptions.at(-1).value;
    assert.ok(Array.isArray(v), "countdown should be a translation");
    assert.equal(v[0].str.translationKey, "greenvilleGame:spleefGameStartCounter");
    assert.equal(v[0].str.params.seconds, "10s");
    assert.equal(v[0].style.color, "#ffd700");
  }

  world.tick(199);
  assert.equal(world.copies.length, 0, "a room was copied during the countdown");
  {
    const v = world.clientOptions.at(-1).value;
    assert.ok(Array.isArray(v));
    assert.equal(v[0].str.params.seconds, "1s");
  }
});

test("moving between same-colour pads keeps the countdown running", () => {
  const world = createWorld(["p1"]);
  world.context.onBlockStandStart("p1", 2, 10, 3, "Lime Concrete");
  world.tick(25);
  world.context.onBlockStandStart("p1", 3, 10, 3, "Lime Concrete");
  world.tick(15);
  {
    const v = world.clientOptions.at(-1).value;
    assert.equal(v[0].str.params.seconds, "8s",
      "crossing to another pad of the same difficulty restarted the countdown");
  }
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
    // And the floor is really there, read from the world and not from a tally. The
    // landing is read in the room that was copied into the entrance chunk, so this is
    // the block the player stands on — the bug report that started this check was a
    // player inside the ground with no message.

    assert.equal(world.blockAt(Math.floor(landing[0]), landing[1] - DUNGEON_CONFIG.spawnAboveFloor, Math.floor(landing[2])),
      "Stone Bricks");
    assert.ok(said(world, "p1").includes("Level: Very Easy"));
    // The two numbers a player can report if it ever goes wrong again.
    assert.ok(said(world, "p1").some((message) => /^Landed at y \d+ · floor block at y \d+$/.test(message)),
      `the landing was not reported: ${JSON.stringify(said(world, "p1").slice(-4))}`);
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
  world.context.onPlayerBoughtShopItem("p1", "utilities", "Teleport to spawn", {}, "");

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
  world.context.onPlayerBoughtShopItem("p1", "utilities", "Teleport to spawn", {}, "");
  world.tick(20);
  assert.ok(!said(world, "p1").includes("Level: Very Easy"),
    "the entrance was completed after the player had gone to spawn");
  assert.deepEqual(world.positions.at(-1).position.slice(0, 3), [10, 21, 10]);
});

test("the shop offers spawn in a Utilities category", () => {
  const world = createWorld(["p1"]);
  world.context.onPlayerJoin("p1");
  const items = world.shop.get("utilities");
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
  world.context.onPlayerBoughtShopItem("p1", "utilities", "Something else", {}, "");
  assert.deepEqual(world.positions.at(-1).position, lastDungeonPosition);
  assert.ok(world.context.playerCommand("p1", "level"));
  assert.ok(!said(world, "p1").some((message) => /not in a dungeon/.test(message)));
});

// -------------------------------------------------------------------- mobs --

test("entering a dungeon puts mobs in the rooms around, and writes the entrance clear", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  world.tick(80);

  assert.ok(world.mobSpawns.length > 0, "no mob was spawned around the entrance");
  // The record is written on a block of the room, not in the code's memory.
  const records = world.blockDataWrites.filter((write) => write.data && write.data.clear);
  assert.ok(records.length > 0, "the entrance room was never written as clear");
  // The first record is the room the player is standing in.
  const position = world.positions.at(-1).position;
  const entranceX = Math.floor(position[0] / SIZE) * SIZE;
  const entranceZ = Math.floor(position[2] / SIZE) * SIZE;
  assert.ok(records.some((write) => write.x === entranceX && write.z === entranceZ),
    "the room the player landed in is not the one recorded as clear");
  // Nothing is written as a block: only the corner record, which is data on a block.
  assert.deepEqual(world.violations, [], "the mob code wrote a block into a room");
});

test("killing the last mob of a room says CLEAR and records the room", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  world.tick(80);

  const roomIds = Array.from(world.mobs.keys());
  assert.ok(roomIds.length > 0, "there was nothing to kill");
  // Kill them one by one, as the game calls back.
  const before = world.blockDataWrites.length;
  for (const mobId of roomIds) {
    world.context.onPlayerKilledMob("p1", mobId);
    world.mobs.delete(mobId);
  }
  assert.ok(world.blockDataWrites.length > before, "the rooms cleared by the last kill were not recorded");
  assert.ok(said(world, "p1").some((message) => message.includes("CLEAR")),
    "the player was never told the room is clear");
});

test("going back to spawn despawns the mobs of the dungeon", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  world.tick(80);
  assert.ok(world.mobs.size > 0, "no mob was spawned, so there is nothing to clean up");
  world.context.onPlayerBoughtShopItem("p1", "utilities", "Teleport to spawn");
  assert.equal(world.mobs.size, 0, "a mob of the dungeon survived the way back to spawn");
  assert.equal(world.context.DUNGEON_LEVELS.length, 8);
});

// --------------------------------------------------------- death and respawn --

test("dying sends the player to spawn and stops the dungeon, like the shop button", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  world.tick(80);
  assert.ok(world.mobs.size > 0, "there were no mobs, so nothing can be cleaned up");
  const copies = world.copies.length;

  const spot = world.context.onRespawnRequest("p1");
  // A **position**, never `true`: `true` means "I teleport myself", and nothing moved the
  // player in that case — they would come back where they died.
  // `Array.from`: the bundle runs in a `vm`, so its arrays have another prototype.
  assert.deepEqual(Array.from(spot), LOBBY_POSITION, "the respawn did not answer the lobby position");
  assert.deepEqual(Array.from(world.positions.at(-1).position), LOBBY_POSITION,
    "the player was not moved to spawn");
  assert.equal(world.mobs.size, 0, "the mobs of the dungeon survived the death");
  assert.ok(said(world, "p1").some((message) => message.includes("You died")),
    "the player was not told what happened");

  // And the dungeon is **over**: no room copied afterwards, and `/dbg` sees no dungeon.
  world.tick(40);
  assert.equal(world.copies.length, copies, "a room was copied for a player who died");
  assert.equal(originOf(world), null, "the player still has a dungeon after dying");
});

test("dying outside a dungeon is left to the game", () => {
  const world = createWorld(["p1"]);
  world.context.onPlayerJoin("p1");
  // The game's own respawn is used: no message, no dungeon, and the callback does not take over.
  const said_before = said(world, "p1").length;
  const spot = world.context.onRespawnRequest("p1");
  assert.equal(spot, false, "the code took over a respawn it had no dungeon for");
  assert.equal(said(world, "p1").length, said_before, "a player with no dungeon was told they died");
});

// ------------------------------------------------------------------ chests --

/** The entrance landing, read from the message the player got on the way in. */
function landingOf(world, playerId) {
  const line = said(world, playerId).find((message) => message.startsWith("Landed at y "));
  const y = Number(line.split(" ")[3]);
  const position = world.positions.at(-1).position;
  return [position[0], y, position[2]];
}

/**
 * A chest the test puts in the room the player landed in.
 *
 * Anywhere in the room: the code does not look for chests, it waits for a click, so the
 * test only has to name a block inside the room the player is standing in.
 */
function placeChest(world, playerId) {
  const [x, y, z] = landingOf(world, playerId);
  const cell = [Math.floor(x) + 3, Math.floor(y) - 1, Math.floor(z) + 3];
  world.world.set(cell.join("|"), "Chest");
  return cell;
}

test("a chest in a dungeon gives a key, and becomes air", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  world.tick(40);
  const chest = placeChest(world, "p1");

  world.context.onPlayerClick("p1", false, chest[0], chest[1], chest[2], "Chest", null);
  assert.equal(world.itemDrops.length, 1, "the chest gave nothing");
  assert.match(world.itemDrops[0].itemName, /^(Wooden|Stone|Iron|Gold|Diamond) Key$/,
    "the chest gave something that is not one of the five keys");
  // The key lands at the middle of the block, and the block is air.
  assert.deepEqual({ x: world.itemDrops[0].x, y: world.itemDrops[0].y, z: world.itemDrops[0].z },
    { x: chest[0] + 0.5, y: chest[1], z: chest[2] + 0.5 },
    "the key did not fall at the middle of the chest");
  assert.deepEqual(world.setBlocks, [{ x: chest[0], y: chest[1], z: chest[2], blockName: "Air" }],
    "the chest was not replaced by Air");
  assert.ok(said(world, "p1").some((message) => message.includes("You found a")),
    "the player was not told what they found");

  // The same click again: there is no chest left, so there is nothing to open.
  world.context.onPlayerClick("p1", false, chest[0], chest[1], chest[2], "Chest", null);
  assert.equal(world.itemDrops.length, 1, "an emptied chest paid out twice");
});

test("a click that is not a chest gives nothing", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  world.tick(40);
  const [x, y, z] = landingOf(world, "p1");

  // A block that is not a chest, and a chest-shaped click on an entity.
  world.world.set(`${Math.floor(x) + 2}|${Math.floor(y) - 1}|${Math.floor(z)}`, "Stone");
  world.context.onPlayerClick("p1", false, Math.floor(x) + 2, Math.floor(y) - 1, Math.floor(z), "Stone", null);
  world.context.onPlayerClick("p1", false, Math.floor(x), Math.floor(y) - 1, Math.floor(z), "Chest", "entity1");
  assert.deepEqual(world.itemDrops, [], "a click that was not a chest of the dungeon gave a key");
  assert.deepEqual(world.setBlocks, [], "a click that was not a chest wrote a block");
});

test("a chest outside a dungeon is left alone", () => {
  const world = createWorld(["p1"]);
  world.context.onPlayerJoin("p1");
  world.world.set("2|20|2", "Chest");
  world.context.onPlayerClick("p1", false, 2, 20, 2, "Chest", null);
  assert.deepEqual(world.itemDrops, [], "a chest in the lobby paid out");
  assert.deepEqual(world.setBlocks, [], "a chest in the lobby was emptied");
});

test("a chest whose key cannot be dropped is reported, not silent", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  world.tick(40);
  const chest = placeChest(world, "p1");

  // The world is at its item-drop limit.
  world.context.api.createItemDrop = () => null;
  world.context.onPlayerClick("p1", false, chest[0], chest[1], chest[2], "Chest", null);
  assert.ok(said(world, "p1").some((message) => message.includes("could not be dropped")),
    "a key that could not be dropped was not reported");
});

// ------------------------------------------------------------- discovering --

test("landing in the entrance pays for the room, once", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  world.tick(40);

  const paid = world.auraGiven.filter((entry) => entry.playerId === "p1");
  assert.equal(paid.length, 1, "the entrance was paid for more than once");
  assert.ok(paid[0].amount > 0, "the entrance paid no aura");
  assert.ok(said(world, "p1").some((message) => message.includes("New room discovered")),
    "the player was not told they discovered a room");
});

test("a room pays the first time it is walked into, and only the first time", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  world.tick(40);
  const [x, y, z] = landingOf(world, "p1");
  const before = world.auraGiven.length;

  // Walk one room east, into a room the scan has copied: the copy is a tick or two behind
  // the walk, and a room is only a room once the world shows it.
  const next = [Math.floor(x) + SIZE, y, Math.floor(z)];
  world.movePlayer("p1", next);
  world.tick(30);
  const afterEast = world.auraGiven.length;
  assert.ok(afterEast > before, "walking into a new room paid nothing");

  // Stay there: no second payment for the room the player is standing in.
  world.tick(60);
  assert.equal(world.auraGiven.length, afterEast, "a room was paid for twice");

  // Come back to the entrance: it was discovered already, so it pays nothing again.
  world.movePlayer("p1", [x, y, z]);
  world.tick(3);
  assert.equal(world.auraGiven.length, afterEast, "a room discovered already paid a second time");
});

test("a room whose chunk is not readable is not discovered", () => {
  const world = createWorld(["p1"]);
  startDungeon(world, "p1");
  world.tick(40);
  const [x, y, z] = landingOf(world, "p1");
  const before = world.auraGiven.length;

  // Far away, in chunks nothing has sent: the position is a teleport through the void, and
  // paying for it would pay for rooms that are not there.
  world.movePlayer("p1", [x + SIZE * 40, y, z + SIZE * 40]);
  world.tick(2);
  assert.equal(world.auraGiven.length, before, "aura was paid for a room the world never sent");
});

// ------------------------------------------------------------- benedictions --
//
// The mechanic the owner asked for: an aura level pays a point, a point buys a roll in the
// shop, and a roll is a rarity first and a benediction second. What is tested here is the
// wiring — the tiles, the level read from the game, the persistence — because the tables
// and the odds have their own file.

/** The benediction tiles this player was offered. */
function benedictionTiles(world, playerId = "p1") {
  const categories = world.playerShop.get(playerId);
  return categories ? categories.get("Benedictions") : undefined;
}

/**
 * Joins, then plays until the game reports `level`.
 *
 * A join is a new run: the code resets the aura to 0, so a level is something a player
 * **earns**, not something a fake server can hand them before they arrive.
 */
function joinAtLevel(world, level, playerId = "p1") {
  world.context.onPlayerJoin(playerId);
  world.setAuraLevel(playerId, level);
  // Opening the shop is what redraws the tiles with the new count.
  world.context.onPlayerToggledShopMenu(playerId, true);
  return world;
}

/** Rolls, then picks the first of the three, as a player does in two clicks. */
function rollAndChoose(world, playerId = "p1", position = 0) {
  world.context.onPlayerBoughtShopItem(playerId, "Benedictions", "Roll a Benediction", {}, "");
  world.context.onPlayerBoughtShopItem(playerId, "Benedictions", `Choice ${position + 1}`, {}, "");
}

/** The three benedictions currently on offer, as `{ name, tile }`. */
function offerTiles(world, playerId = "p1") {
  const tiles = benedictionTiles(world, playerId);
  if (!tiles) return [];
  return ["Choice 1", "Choice 2", "Choice 3"]
    .filter((key) => tiles.has(key))
    .map((key) => ({ key, name: tiles.get(key).customTitle, tile: tiles.get(key) }));
}

test("a join offers the roll, and a fresh player has nothing to spend", () => {
  const world = createWorld(["p1"]);
  world.context.onPlayerJoin("p1");
  const tiles = benedictionTiles(world);
  assert.ok(tiles, "the Benedictions category was not created");
  const roll = tiles.get("Roll a Benediction");
  assert.ok(roll, "the roll tile was not offered");
  assert.equal(roll.cost, 0, "a roll costs a point, not a currency");
  assert.equal(roll.canBuy, false, "a level-1 player was offered a free roll");
  assert.match(roll.description, /Aura level 1 · 0 points/);
  // **Two numbers, one line**: the owner had the odds taken off the tile, which is the only
  // tile a player reads before spending. They are still in `/dbg benedictions`.
  assert.ok(!/Common \d+%/.test(roll.description), "the odds are back on the roll tile");
  assert.equal(roll.description.split("\n").length, 1, "the roll tile is more than one line");
  // **One tile and nothing else.** The three choices do not exist until there is an offer,
  // and the removal is a real one — no disabled ghost tiles, no "Last roll".
  assert.deepEqual([...tiles.keys()], ["Roll a Benediction"], "the category has extra tiles");
  assert.equal(tiles.has("Last roll"), false, "the last-roll tile is back");
});

test("a roll offers three benedictions and reserves the point; the choice spends it", () => {
  const world = joinAtLevel(createWorld(["p1"]), 4);
  const tiles = benedictionTiles(world);
  assert.equal(tiles.get("Roll a Benediction").canBuy, true, "a player with 3 points could not roll");
  assert.match(tiles.get("Roll a Benediction").description, /Aura level 4 · 3 points/);

  world.context.onPlayerBoughtShopItem("p1", "Benedictions", "Roll a Benediction", {}, "");
  // **The roll replaces the category's tiles with three choices.** Nothing is deleted —
  // the same keys are rewritten — so the roll tile is *replaced* by a title that says the
  // offer is waiting, and the three choices are the only buyable tiles.
  const offered = benedictionTiles(world);
  assert.equal(offered.get("Roll a Benediction").canBuy, false, "the roll button survived the roll");
  assert.match(offered.get("Roll a Benediction").customTitle, /Select one/);
  assert.equal(offered.get("Roll a Benediction").description, "");
  assert.equal(offered.get("Roll a Benediction").sortPriority, 110);
  assert.equal(offerTiles(world).length, 3, "three choices were not offered");
  for (const { tile } of offerTiles(world)) {
    assert.equal(tile.canBuy, true, "an offered benediction cannot be picked");
    assert.equal(tile.buyButtonText, "Choose");
    assert.match(tile.description, /(Common|Uncommon|Rare|Epic|Legendary|Mythic) · /);
    assert.ok(tile.description.includes("No effect yet."));
  }
  // Chat is not visible while the shop is open — the offer is in the tiles,
  // not in the chat, and the roll must not spam the chat.
  assert.equal(world.helperCards.length, 0, "a roll drew a card before a choice");
  assert.equal(world.middleTexts.length, 0);
  assert.equal(said(world, "p1").filter((line) => typeof line === "string" && /Three Benedictions are offered/.test(line)).length, 0,
    "offer was announced while shop is open");
  assert.equal(said(world, "p1").filter((line) => typeof line === "string" && /^\d\. /.test(line)).length, 0,
    "offer was listed in chat while shop open");

  // The pick: one point, one message, one card, one banner — and the shop closes.
  const picked = offerTiles(world)[1];
  world.shopOpen.add("p1");
  world.context.onPlayerBoughtShopItem("p1", "Benedictions", picked.key, {}, "");
  const styled = said(world, "p1").filter((line) => Array.isArray(line));
  assert.equal(styled.length, 1, "the styled announcement is missing or duplicated");
  assert.deepEqual(styled[0][0], "Benediction: ");
  assert.equal(styled[0][1].str, picked.name, "the announced benediction is not the one picked");
  assert.ok(said(world, "p1").some((line) => typeof line === "string" && line.includes("2 points left")));
  assert.equal(world.helperCards.length, 1, "no card was drawn for the pick");
  const card = world.helperCards[0];
  assert.ok(card.text.startsWith(picked.name), "the card is not the benediction that was picked");
  assert.match(card.icon, /^fa-solid fa-/);
  assert.match(card.opts.color, /^rgb\(/, "the card background was not an rgb() colour");
  assert.ok(card.text.includes("No effect yet."), "the card promises an effect that does not exist");
  assert.equal(world.middleTexts.length, 1, "no banner was queued");
  assert.equal(world.shopCalls.length, 1, "the shop was not closed after the choice");
  assert.equal(world.shopOpen.has("p1"), false, "the shop stayed open");

  // And the category is back to what it was: the roll tile alone. The three choices are
  // **removed**, not hidden — `resetShopItemForPlayer`, which is the API's way to delete a
  // player's tile; `hidden` left them on screen, which is what the owner kept seeing.
  const after = benedictionTiles(world);
  assert.deepEqual([...after.keys()], ["Roll a Benediction"], "a choice tile survived the pick");
  assert.equal(after.get("Roll a Benediction").customTitle, "Roll a Benediction");
  assert.match(after.get("Roll a Benediction").description, /2 points/);
  // Every refresh re-asserts the removal (the call is a no-op when the override is gone),
  // so what matters is *which* keys: the three choices, and never the roll.
  const removedKeys = new Set(world.removedTiles.map((entry) => entry.itemKey));
  assert.deepEqual([...removedKeys].sort(), ["Choice 1", "Choice 2", "Choice 3"]);
  for (const entry of world.removedTiles) assert.equal(entry.categoryKey, "Benedictions");
  // The benediction is still announced; it just no longer has a tile of its own.
  assert.equal(world.helperCards[0].text.startsWith(picked.name), true);
});

test("a roll with no point left is refused, and the choice tile closes", () => {
  const world = joinAtLevel(createWorld(["p1"]), 2);
  rollAndChoose(world);
  assert.equal(world.helperCards.length, 1);
  // One point, one benediction: the tile now says so and cannot be bought.
  assert.equal(benedictionTiles(world).get("Roll a Benediction").canBuy, false);
  world.context.onPlayerBoughtShopItem("p1", "Benedictions", "Roll a Benediction", {}, "");
  assert.equal(world.helperCards.length, 1, "a roll was given without a point");
  // No chat while shop stays open — the tile shows it cannot be bought
  assert.equal(said(world, "p1").filter((line) => typeof line === "string" && /No Benediction point/.test(line)).length, 0);
});

test("a second roll while an offer is open shows the same three, and reserves nothing", () => {
  const world = joinAtLevel(createWorld(["p1"]), 3);
  world.context.onPlayerBoughtShopItem("p1", "Benedictions", "Roll a Benediction", {}, "");
  const first = offerTiles(world).map((entry) => entry.name);
  world.context.onPlayerBoughtShopItem("p1", "Benedictions", "Roll a Benediction", {}, "");
  assert.deepEqual(offerTiles(world).map((entry) => entry.name), first,
    "a second roll redrew the offer, which is a free reroll");
  assert.equal(benedictionTiles(world).get("Roll a Benediction").canBuy, false);
});

test("picking a card that is not on the offer does nothing", () => {
  const world = joinAtLevel(createWorld(["p1"]), 5);
  // Before any roll: no offer, so no choice can be picked.
  world.context.onPlayerBoughtShopItem("p1", "Benedictions", "Choice 1", {}, "");
  assert.equal(world.helperCards.length, 0, "a choice was picked from an offer that did not exist");
  assert.equal(world.shopCalls.length, 0, "the shop was closed for nothing");
  world.context.onPlayerBoughtShopItem("p1", "Benedictions", "Roll a Benediction", {}, "");
  const offer = offerTiles(world).map((entry) => entry.name);
  // A stale click on a card that has been redrawn: the offer is gone, so it costs nothing.
  world.context.onPlayerBoughtShopItem("p1", "Benedictions", "Choice 1", {}, "");
  assert.equal(world.helperCards.length, 1);
  world.context.onPlayerBoughtShopItem("p1", "Benedictions", "Choice 1", {}, "");
  assert.equal(world.helperCards.length, 1, "one offer paid for two choices");
  assert.ok(offer.length === 3);
});

test("nothing is saved: a reconnection starts from zero", () => {
  const world = joinAtLevel(createWorld(["p1"]), 5);
  world.context.onPlayerBoughtShopItem("p1", "Benedictions", "Roll a Benediction", {}, "");
  assert.equal(offerTiles(world).length, 3, "the offer is not on screen");
  // Nothing was written: the points are a currency and the account is memory.
  assert.equal(world.dbValues.size, 0, "the roll wrote to the player database");

  // The player leaves and comes back, with the same fake game still reporting level 5.
  world.context.onPlayerLeave("p1");
  world.setAuraLevel("p1", 5);
  world.context.onPlayerJoin("p1");
  // **The join reset the aura to 0**, so the player is back at level 1 with no offer and no
  // history: that is the whole of "reset the XP when you rejoin".
  assert.equal(world.aurasReset.at(-1).total, 0, "the arena was not reset on the join");
  assert.equal(world.aurasReset.at(-1).playerId, "p1");
  assert.equal(offerTiles(world).length, 0, "a reconnection brought the offer back");
  const tiles = benedictionTiles(world);
  assert.deepEqual([...tiles.keys()], ["Roll a Benediction"], "a reconnection left tiles behind");
  assert.equal(tiles.get("Roll a Benediction").canBuy, false, "a reconnection brought a point back");
  assert.equal(world.dbValues.size, 0, "the join wrote to the player database");
});

test("a choice is removed for real, and the roll tile never is", () => {
  // The owner's two halves of the same bug report: the three choices must **go away**
  // (`hidden` did not do it), and the roll must **never** go away — a category that loses all
  // its tiles is the "buttons disappear" side of it.
  const world = joinAtLevel(createWorld(["p1"]), 4);
  // The refreshes before the roll reset keys nobody has: the call does nothing then, which is
  // the documented behaviour and the reason it can be fired blind.
  const beforeRoll = world.removedTiles.length;
  world.context.onPlayerBoughtShopItem("p1", "Benedictions", "Roll a Benediction", {}, "");
  const offered = [...benedictionTiles(world).keys()].sort();
  assert.deepEqual(offered, ["Choice 1", "Choice 2", "Choice 3", "Roll a Benediction"].sort(),
    "the offer is not the roll plus three choices");
  assert.equal(world.removedTiles.length, beforeRoll, "tiles were removed while the offer was live");
  rollAndChoose(world);
  const after = benedictionTiles(world);
  assert.deepEqual([...after.keys()], ["Roll a Benediction"], "the choices are still in the category");
  assert.deepEqual([...new Set(world.removedTiles.map((entry) => entry.itemKey))].sort(),
    ["Choice 1", "Choice 2", "Choice 3"]);
  assert.ok(!world.removedTiles.some((entry) => entry.itemKey === "Roll a Benediction"),
    "the roll tile was removed, which empties the category");
  // A stale click on a removed tile cannot be bought: the offer is over.
  world.context.onPlayerBoughtShopItem("p1", "Benedictions", "Choice 2", {}, "");
  assert.equal(world.helperCards.length, 1, "a removed tile still paid out");
});

test("the points are a custom currency on the HUD, and it is not persistent", () => {
  const world = joinAtLevel(createWorld(["p1"]), 4);
  const shown = world.currencies.get("p1|Benediction Point");
  assert.ok(shown, "the points were not shown as a currency");
  assert.equal(shown.amount, 3, "the currency does not carry the points");
  assert.equal(shown.persistent, false, "the points currency was made persistent");
  assert.ok(shown.icon);
  // Spending a point moves the HUD, not only the tile.
  rollAndChoose(world);
  assert.equal(world.currencies.get("p1|Benediction Point").amount, 2);
});

test("the aura scale and the ceiling are pushed to the game on a join", () => {
  const world = createWorld(["p1"]);
  world.context.onPlayerJoin("p1");
  const scale = world.clientOptions.filter((entry) => entry.option === "auraPerLevel").at(-1);
  const ceiling = world.clientOptions.filter((entry) => entry.option === "maxAuraLevel").at(-1);
  assert.equal(scale.value, AURA_PER_LEVEL, "the world's aura scale was not applied");
  assert.equal(ceiling.value, MAX_AURA_LEVEL, "the world's aura ceiling was not applied");
  // The owner's respawn rule travels in the same call: one `setClientOptions` on a join.
  const respawn = world.clientOptions.filter((entry) => entry.option === "autoRespawn").at(-1);
  assert.equal(respawn.value, true, "autoRespawn was lost");
  assert.equal(world.clientOptions.filter((entry) => entry.option === "secsToRespawn").at(-1).value, 3);
});

test("a player who gains a level while the shop is open is owed the point", () => {
  // Points are derived from the level, never counted: a level gained outside a dungeon —
  // or while the shop was open — is honoured the next time the tiles are drawn.
  const world = joinAtLevel(createWorld(["p1"]), 3);
  assert.match(benedictionTiles(world).get("Roll a Benediction").description, /2 points/);
  world.setAuraLevel("p1", 6);
  // **Opening the shop** is what redraws the tiles: the count is per player, so the shop
  // is refreshed when it is looked at rather than on a tick spent watching everybody's XP.
  world.context.onPlayerToggledShopMenu("p1", true);
  assert.match(benedictionTiles(world).get("Roll a Benediction").description, /Aura level 6 · 5 points/);
  rollAndChoose(world);
  assert.equal(world.helperCards.length, 1);
  assert.match(benedictionTiles(world).get("Roll a Benediction").description, /4 points/);
  // And a close redraws nothing new: there is nothing to show.
  const cards = world.helperCards.length;
  world.context.onPlayerToggledShopMenu("p1", false);
  assert.equal(world.helperCards.length, cards);
});

test("buying a tile that is not in the offer, or another category, does nothing", () => {
  const world = joinAtLevel(createWorld(["p1"]), 9);
  world.context.onPlayerBoughtShopItem("p1", "Benedictions", "Choice 1", {}, "");
  world.context.onPlayerBoughtShopItem("p1", "Something else", "Roll a Benediction", {}, "");
  assert.equal(world.helperCards.length, 0, "a click that is not a roll drew a card");
  assert.equal(benedictionTiles(world).get("Roll a Benediction").canBuy, true);

  // And the spawn item still works after all of it: the two categories do not shadow
  // each other.
  startDungeon(world, "p1");
  tickUntil(world, () => said(world, "p1").includes("Level: Very Easy"), 400);
  world.context.onPlayerBoughtShopItem("p1", "utilities", "Teleport to spawn", {}, "");
  assert.deepEqual(Array.from(world.positions.at(-1).position), LOBBY_POSITION);
});

test("the bundle names only benedictions that exist, and no rarity twice", () => {
  const world = joinAtLevel(createWorld(["p1"]), 20);
  // Spend every point of a level-20 player, which reaches deep into the table.
  const rolls = 19;
  for (let index = 0; index < rolls; index += 1) rollAndChoose(world, "p1", index % 3);
  assert.equal(world.helperCards.length, rolls);
  const names = new Set(world.helperCards.map((card) => card.text.split("\n")[0]));
  for (const name of names) {
    assert.ok(BENEDICTION_NAMES.has(name), `"${name}" is not in the catalogue`);
  }
  // Every card carries a rarity from the six, spelled the way the table spells it.
  const rarities = new Set(world.helperCards.map((card) => card.text.split("\n")[1].split(" · ")[0]));
  for (const rarity of rarities) {
    assert.ok(BENEDICTION_RARITIES.has(rarity), `"${rarity}" is not a rarity`);
  }
});

const BENEDICTION_NAMES = new Set([
  "Iron Hide", "Field Rations", "Quick Feet", "Sturdy Straps", "Honed Edge",
  "Bitter Draught", "Second Wind", "Ghost Step", "Heart of the Dungeon",
]);
const BENEDICTION_RARITIES = new Set([
  "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic",
]);

test("/dbg benedictions reports the level, the points and the odds, outside a dungeon", () => {
  const world = joinAtLevel(createWorld(["p1"]), 7);
  rollAndChoose(world);
  const before = world.messages.length;
  assert.equal(world.context.playerCommand("p1", "benedictions"), true);
  const lines = world.messages.slice(before).map((entry) => entry.message);
  assert.equal(lines.length, 4, `the report was cut short: ${JSON.stringify(lines)}`);
  assert.match(lines[0], /^\[dbg\] aura level 7\/\d+ · \d+ point\(s\) · 1 spent$/);
  assert.match(lines[1], /^\[dbg\] scale \d+ aura a level · nothing is saved between sessions$/);
  assert.match(lines[2], /session p1 · last 1 picked: .+ \([a-z]+\)$/);
  assert.match(lines[3], /^\[dbg\] odds Common \d+%/);
  // A player who never rolled gets a line too, and it says "none" rather than nothing.
  const fresh = createWorld(["p1"]);
  fresh.context.onPlayerJoin("p1");
  fresh.context.playerCommand("p1", "benedictions");
  assert.ok(fresh.messages.some((entry) => /none$/.test(String(entry.message))));
});
