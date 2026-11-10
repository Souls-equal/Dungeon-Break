/*
 * Chunk storage: one record per chunk, in a block's data.
 *
 * The whole point of these tests is that the format is checked against the API's
 * two documented rules, not against a convenient assumption:
 *
 *   setBlockData(x, y, z, { …object… })   → the doc's type is `object`;
 *   getBlockData(x, y, z)                 → `any`;
 *   "Data is cleared when block changes".
 *
 * So the fake world here **clears the data when a block is set**, like the real
 * one. Every test that would pass on a fake which quietly kept the data is a test
 * that would pass in the game and fail on the server.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { DUNGEON_CONFIG } from "../../src/dungeon/engine/config.js";
import {
  CHUNK_ANCHOR_BLOCK,
  CHUNK_RECORD_VERSION,
  anchorOf,
  chunkOfCell,
  createChunkRecord,
  parseChunkRecord,
  readChunkRecord,
  verifyChunkRecord,
  writeChunkRecord,
} from "../../src/dungeon/chunkStore.js";

/** A fake Bloxd world with the two documented behaviours that matter. */
function fakeWorld(options = {}) {
  const blocks = new Map();
  const data = new Map();
  const calls = { setBlock: 0, setBlockData: 0, getBlockData: 0 };
  const key = (x, y, z) => `${x},${y},${z}`;
  return {
    blocks,
    data,
    calls,
    api: {
      getBlock(x, y, z) {
        if (options.unloaded && !options.unloaded(x, z)) return null;
        return blocks.get(key(x, y, z)) || "Air";
      },
      setBlock(x, y, z, name) {
        calls.setBlock += 1;
        blocks.set(key(x, y, z), name);
        // The documented rule, enforced: a block change clears its data.
        data.delete(key(x, y, z));
      },
      setBlockData(x, y, z, value) {
        calls.setBlockData += 1;
        // Deep-copied the way a serialisation boundary copies: a reference that
        // was never serialised would hide a format that does not survive.
        data.set(key(x, y, z), value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)));
      },
      getBlockData(x, y, z) {
        calls.getBlockData += 1;
        return data.has(key(x, y, z)) ? data.get(key(x, y, z)) : null;
      },
    },
  };
}

const samplePlans = [
  { kind: "room", id: "r0.1", blocks: 4211 },
  { kind: "passage", id: "c:r0.1.o2+r0.o1", blocks: 840 },
];
const sampleProgress = [
  { kind: "room", id: "r0.1", state: "built", cursor: 4211 },
  { kind: "passage", id: "c:r0.1.o2+r0.o1", state: "building", cursor: 360 },
];

test("a record round-trips through the block data exactly as it was written", () => {
  const world = fakeWorld();
  const result = verifyChunkRecord(world.api, {
    dungeonId: "lobby|normal",
    seed: 1234567,
    chunkX: 2,
    chunkZ: -3,
    floorY: DUNGEON_CONFIG.floorY,
    tick: 812,
    plans: samplePlans,
    progress: sampleProgress,
  });

  assert.equal(result.code, "ROUND_TRIP_OK", `round trip failed: ${JSON.stringify(result)}`);
  assert.deepEqual(result.differences, []);
  const record = result.read.record;
  assert.equal(record.version, CHUNK_RECORD_VERSION);
  assert.equal(record.id, "lobby|normal");
  assert.equal(record.seed, 1234567);
  assert.equal(record.chunkX, 2);
  assert.equal(record.chunkZ, -3);
  assert.equal(record.tick, 812);
  assert.deepEqual(record.plans, samplePlans);
  assert.deepEqual(record.progress, sampleProgress);
  // The payload is round-trippable as JSON in both directions: nothing in it is a
  // function, a node, a class instance or `undefined`.
  assert.equal(JSON.stringify(record).includes("undefined"), false);
});

test("the anchor is written once, and its data is still there afterwards", () => {
  const world = fakeWorld();
  const first = writeChunkRecord(world.api, {
    dungeonId: "lobby|normal",
    seed: 7,
    chunkX: 0,
    chunkZ: 0,
    floorY: DUNGEON_CONFIG.floorY,
    plans: samplePlans,
    progress: sampleProgress,
  });
  assert.equal(first.ok, true);
  assert.equal(world.api.getBlock(first.anchor.x, first.anchor.y, first.anchor.z), CHUNK_ANCHOR_BLOCK);

  // Writing again must not rewrite the block: a `setBlock` there would clear the
  // data, which is the one documented rule this design depends on.
  const blockWritesAfterFirst = world.calls.setBlock;
  const second = writeChunkRecord(world.api, {
    dungeonId: "lobby|normal",
    seed: 7,
    chunkX: 0,
    chunkZ: 0,
    floorY: DUNGEON_CONFIG.floorY,
    tick: 42,
    plans: samplePlans,
    progress: sampleProgress,
  });
  assert.equal(second.ok, true, "the second write failed");
  assert.equal(second.code, "WROTE_DATA", "the second write rewrote the block, which clears the data");
  assert.equal(world.calls.setBlock, blockWritesAfterFirst, "the anchor block was written a second time");
  const read = readChunkRecord(world.api, { chunkX: 0, chunkZ: 0, floorY: DUNGEON_CONFIG.floorY });
  assert.equal(read.ok, true);
  assert.equal(read.record.tick, 42, "the refreshed record was not read back");
});

test("a structural write on the anchor is detectable, and named", () => {
  const world = fakeWorld();
  writeChunkRecord(world.api, {
    dungeonId: "lobby|normal", seed: 7, chunkX: 0, chunkZ: 0, floorY: DUNGEON_CONFIG.floorY,
    plans: samplePlans, progress: sampleProgress,
  });
  const anchor = anchorOf(0, 0, DUNGEON_CONFIG.floorY);

  // The failure mode this whole design has to be honest about: anyone rewriting
  // that block clears the data, with no error.
  world.api.setBlock(anchor.x, anchor.y, anchor.z, "Stone");
  const read = readChunkRecord(world.api, { chunkX: 0, chunkZ: 0, floorY: DUNGEON_CONFIG.floorY });
  assert.equal(read.ok, false);
  assert.equal(read.code, "NO_ANCHOR");
  assert.equal(read.block, "Stone", "the report does not say what is there instead");
});

test("an unloaded chunk is refused rather than written into", () => {
  const world = fakeWorld({ unloaded: () => false });
  const result = writeChunkRecord(world.api, {
    dungeonId: "lobby|normal", seed: 7, chunkX: 0, chunkZ: 0, floorY: DUNGEON_CONFIG.floorY,
    plans: samplePlans, progress: sampleProgress,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "CHUNK_NOT_LOADED");
  assert.equal(world.calls.setBlock, 0, "a block was written into an unloaded chunk");
  assert.equal(world.calls.setBlockData, 0, "data was written into an unloaded chunk");
});

test("a record from another version is refused by version, not misread", () => {
  const { ok } = parseChunkRecord({ v: CHUNK_RECORD_VERSION + 1, id: "x", plans: [], progress: [] });
  assert.equal(ok, false);
  const result = parseChunkRecord({ v: CHUNK_RECORD_VERSION + 1 });
  assert.equal(result.code, "VERSION");
  assert.equal(result.version, CHUNK_RECORD_VERSION + 1);

  assert.equal(parseChunkRecord(null).code, "EMPTY");
  assert.equal(parseChunkRecord("a string").code, "NOT_A_RECORD");
  assert.equal(parseChunkRecord([]).code, "NOT_A_RECORD");
});

test("a record with a malformed line is refused, and the line is named", () => {
  const good = {
    v: CHUNK_RECORD_VERSION, id: "d", seed: 1, cx: 0, cz: 0, tick: 0, y: -1000,
    plans: ["room|10|r0.0"], progress: ["room|built|10|r0.0"],
  };
  assert.equal(parseChunkRecord(good).ok, true);

  const withBadPlan = { ...good, plans: ["room|10|r0.0", "garbage"] };
  const plan = parseChunkRecord(withBadPlan);
  assert.equal(plan.ok, false);
  assert.equal(plan.code, "BAD_PLAN");
  assert.equal(plan.at, 1);

  const withBadProgress = { ...good, progress: ["room|built|10|r0.0", "passage|built|not-a-number|x"] };
  const progress = parseChunkRecord(withBadProgress);
  assert.equal(progress.ok, false);
  assert.equal(progress.code, "BAD_PROGRESS");
  assert.equal(progress.at, 1);
});

test("an id that contains the separator does not break the record", () => {
  // Connection ids are `c:r0.0.o1+r0.o2` — colons and pluses, on purpose. The
  // separator is `|` and the id is the last field, so an id may hold anything the
  // engine can produce.
  const id = "c:r0.0.o1+r0.o2";
  const record = createChunkRecord({
    dungeonId: "lobby|easy", seed: 3, chunkX: 0, chunkZ: 0, tick: 0,
    plans: [{ kind: "passage", id, blocks: 75 }],
    progress: [{ kind: "passage", id, state: "built", cursor: 75 }],
  });
  const parsed = parseChunkRecord(record);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.record.plans[0].id, id);
  assert.equal(parsed.record.progress[0].id, id);
});

test("the anchor is a function of the chunk alone, and sits one block above the floor", () => {
  for (const [x, z] of [[0, 0], [1, -1], [12, 3], [-40, 7]]) {
    const anchor = anchorOf(x, z, DUNGEON_CONFIG.floorY);
    // One above the floor, never on it: on the floor the cell is structural, and
    // any room covering the chunk's corner would write it and clear the record.
    assert.equal(anchor.y, DUNGEON_CONFIG.floorY + 1,
      "the anchor is on the floor level, where every room writes and the record is cleared");
    assert.ok(anchor.y > DUNGEON_CONFIG.floorY, "the anchor is below the floor, in a chunk nobody loaded");
    assert.equal(anchor.x, x * DUNGEON_CONFIG.chunkSize);
    assert.equal(anchor.z, z * DUNGEON_CONFIG.chunkSize);
    // Asking twice gives the same cell: nothing about it depends on time or order.
    assert.deepEqual(anchor, anchorOf(x, z, DUNGEON_CONFIG.floorY));
  }
});

test("a cell belongs to exactly one chunk, including on its edges", () => {
  const size = DUNGEON_CONFIG.chunkSize;
  assert.deepEqual(chunkOfCell(0, 0), { x: 0, z: 0 });
  assert.deepEqual(chunkOfCell(size - 1, size - 1), { x: 0, z: 0 });
  assert.deepEqual(chunkOfCell(size, size), { x: 1, z: 1 });
  assert.deepEqual(chunkOfCell(-1, -1), { x: -1, z: -1 });
  assert.deepEqual(chunkOfCell(-size, -size), { x: -1, z: -1 });
});

test("a record refuses a payload it cannot be sure of", () => {
  assert.throws(() => createChunkRecord({
    dungeonId: "x".repeat(25), seed: 1, chunkX: 0, chunkZ: 0,
  }), RangeError);
  assert.throws(() => createChunkRecord({
    dungeonId: "d", seed: 1, chunkX: 0, chunkZ: 0,
    plans: new Array(5001).fill({ kind: "room", id: "r", blocks: 1 }),
  }), RangeError);
});

test("the record stays small enough to be a block payload", () => {
  // A chunk of a 48-room dungeon holds a handful of rooms and thresholds; the
  // serialised record must stay in the hundreds of bytes, because the API
  // documents no size for block data and a small payload is the only safe bet.
  const plans = [];
  const progress = [];
  for (let index = 0; index < 12; index += 1) {
    plans.push({ kind: "room", id: `r0.${index}.1`, blocks: 3000 });
    progress.push({ kind: "room", id: `r0.${index}.1`, state: "building", cursor: 1200 });
  }
  const record = createChunkRecord({ dungeonId: "lobby|ultraInsane", seed: 2147483000, chunkX: -12, chunkZ: 9, tick: 24000, plans, progress });
  const size = JSON.stringify(record).length;
  assert.ok(size < 1200, `the record is ${size} characters, too big for one block`);
});
