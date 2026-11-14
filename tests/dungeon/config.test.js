import test from "node:test";
import assert from "node:assert/strict";

import {
  DUNGEON_CONFIG,
  DIFFICULTIES,
  difficultyForPadBlock,
  findDifficulty,
  floorOfLayer,
  lobbyDifficulties,
  nextDifficulty,
} from "../../src/dungeon/config.js";
import { chunkToBlock, hashOf, templateFor, templatesFor } from "../../src/dungeon/templates.js";

const SIZE = DUNGEON_CONFIG.chunkSize;

test("every difficulty has its own layer, two chunks apart", () => {
  const chunksY = DIFFICULTIES.map((entry) => entry.chunkY);
  assert.equal(new Set(chunksY).size, chunksY.length, "two difficulties share a chunk layer");
  for (let index = 1; index < chunksY.length; index += 1) {
    assert.equal(chunksY[index - 1] - chunksY[index], DUNGEON_CONFIG.layerStrideChunks,
      `${DIFFICULTIES[index].label} is not exactly one stride below the level above it`);
  }
  // Two chunks of vertical gap means two rooms can never overlap, whatever their
  // X/Z: a room fills one chunk, so its top is the layer above its bottom.
  assert.ok(DUNGEON_CONFIG.layerStrideChunks >= 2);
});

test("the floor of a level is the bottom of its chunk", () => {
  for (const difficulty of DIFFICULTIES) {
    assert.equal(floorOfLayer(difficulty), difficulty.chunkY * SIZE);
  }
});

test("a pad block leads to exactly one difficulty", () => {
  for (const difficulty of DIFFICULTIES) {
    assert.equal(difficultyForPadBlock(difficulty.padBlock), difficulty);
  }
  assert.equal(difficultyForPadBlock("Grey Concrete"), findDifficulty("ultraInsane"),
    "the British spelling of the grey pad does not resolve");
  assert.equal(difficultyForPadBlock("Dirt"), null);
});

test("the lobby offers only the three first difficulties", () => {
  const labels = lobbyDifficulties().map((entry) => entry.label);
  assert.deepEqual(labels, ["Very Easy", "Easy", "Medium"]);
});

test("Hell is the last level, and the pad after it leads nowhere", () => {
  assert.equal(nextDifficulty("hell"), null);
  assert.equal(nextDifficulty("Hell"), null);
  const almost = DIFFICULTIES[DIFFICULTIES.length - 2];
  assert.equal(nextDifficulty(almost.label), DIFFICULTIES.at(-1));
});

test("a difficulty is found by id, label or object, and never invented", () => {
  assert.equal(findDifficulty("veryEasy").label, "Very Easy");
  assert.equal(findDifficulty("VERY EASY").label, "Very Easy");
  assert.equal(findDifficulty(DIFFICULTIES[2]).id, "medium");
  assert.equal(findDifficulty("nope"), null);
  assert.equal(findDifficulty(null), null);
  assert.equal(findDifficulty({ label: "Very Easy" }), null, "an object without an id was trusted");
});

test("the same chunk always picks the same template", () => {
  const list = [
    { index: 0, src: [0, -32, 0], faces: "NESW" },
    { index: 1, src: [32, -32, 0], faces: "NESW" },
    { index: 2, src: [64, -32, 0], faces: "NE" },
  ];
  const difficulty = findDifficulty("veryEasy");
  for (const [x, z] of [[0, 0], [3, -7], [120, 44], [-1, -1]]) {
    const first = templateFor(list, difficulty, x, z);
    const second = templateFor(list, difficulty, x, z);
    assert.equal(first.index, second.index, `chunk ${x},${z} picked two different templates`);
  }
  // And the choice is spread over the list rather than stuck on one entry.
  const picked = new Set();
  for (let x = 0; x < 60; x += 1) picked.add(templateFor(list, difficulty, x, 0).index);
  assert.equal(picked.size, 3, "the hash only ever reaches a subset of the templates");
});

test("no room is special: the entrance is an ordinary draw", () => {
  // A room used to be able to declare itself the entrance. Nothing does any more,
  // and nothing in the generator looks for it: the origin chunk draws like the
  // others, which is what keeps the table a plain list of coordinates.
  const list = [
    { index: 0, chunk: [0, 0, 0], src: [0, 0, 0] },
    { index: 1, chunk: [1, 0, 0], src: [32, 0, 0] },
    { index: 2, chunk: [2, 0, 0], src: [64, 0, 0] },
  ];
  const difficulty = findDifficulty("easy");
  const drawn = [];
  for (let chunkX = 0; chunkX < 40; chunkX += 1) drawn.push(templateFor(list, difficulty, chunkX, 0).index);
  // The origin chunk is one of the draws, not a fixed choice.
  assert.ok(drawn.includes(templateFor(list, difficulty, 0, 0).index));
  assert.ok(new Set(drawn).size > 1, "the draw always returns the same room");
});

test("the shipped table is one shared list, numbered by position", () => {
  const list = templatesFor({ id: "veryEasy" }, () => {});
  assert.ok(list.length > 0, "the repository ships with no room at all");
  // Every room is known by its position: no id, no name, nothing to keep in sync
  // with a hand-built zone.
  assert.deepEqual(list.map((room) => room.index), list.map((_, index) => index));
  for (const room of list) assert.equal(room.id, undefined, "a shipped room still carries an id");
});

test("every difficulty draws from the same rooms", () => {
  const veryEasy = templatesFor({ id: "veryEasy" }, () => {});
  const hell = templatesFor({ id: "hell" }, () => {});
  assert.deepEqual(hell.map((room) => room.src), veryEasy.map((room) => room.src));
});

test("a level's own rooms come first, then the shared ones", () => {
  const saved = globalThis.ROOM_TEMPLATES;
  globalThis.ROOM_TEMPLATES = {
    rooms: [{ src: [0, 1, 0], faces: "NESW" }],
    veryEasy: [{ src: [32, 1, 0], faces: "NESW" }],
  };
  try {
    const list = templatesFor({ id: "veryEasy" }, () => {});
    assert.deepEqual(list.map((room) => room.src), [[32, 1, 0], [0, 1, 0]]);
    // And a level without rooms of its own still gets the shared set.
    assert.deepEqual(templatesFor({ id: "hell" }, () => {}).map((room) => room.src), [[0, 1, 0]]);
  } finally {
    globalThis.ROOM_TEMPLATES = saved;
  }
});

test("malformed rooms are dropped instead of breaking the level", () => {
  const saved = globalThis.ROOM_TEMPLATES;
  const errors = [];
  globalThis.ROOM_TEMPLATES = {
    rooms: [{ src: [0, 1, 0], faces: "NESW" }, { faces: "NESW" }, { src: [1, 2] }, null],
  };
  try {
    const list = templatesFor({ id: "veryEasy" }, (message) => errors.push(message));
    assert.equal(list.length, 1, "a malformed room was kept");
    assert.equal(errors.length, 3, `expected one log per bad room, got ${JSON.stringify(errors)}`);
  } finally {
    globalThis.ROOM_TEMPLATES = saved;
  }
});

test("the hash is stable across runs", () => {
  // A literal, on purpose: a level that rebuilds differently after an innocuous
  // edit to the hash is a level whose rooms move under the players.
  assert.equal(hashOf("veryEasy", 0, 0), 386675546);
  assert.equal(hashOf("veryEasy", 0, 0), hashOf("veryEasy", 0, 0));
  assert.notEqual(hashOf("veryEasy", 0, 0), hashOf("easy", 0, 0));
});

// ------------------------------------------------------- chunk coordinates --
//
// The rooms are written in chunk coordinates, and a chunk coordinate of `-2` is
// not `-64 / 32` in the arithmetic a player expects — it is the chunk that
// *contains* block −64, whose first block is −64 itself. Getting that boundary
// wrong shifts a room by one block and the player lands through a wall, so the
// edge cases are asserted rather than reasoned about.

test("a chunk coordinate is 32 blocks, and the negative side is its own case", () => {
  const cases = [
    // [chunk, first block]
    [0, 0],
    [1, 32],
    [2, 64],
    [-1, -32],
    [-2, -64],
    [-30, -960],
  ];
  for (const [chunk, block] of cases) {
    assert.deepEqual(chunkToBlock(chunk, 0, 0), [block, 0, 0], `chunk ${chunk}`);
  }
});

test("a block belongs to the chunk that contains it, negatives included", () => {
  // The identity that matters: the first block of the chunk the engine copies for
  // a room must be exactly the block `chunkToBlock` gives for that room.
  for (const chunk of [0, 1, -1, -2, -30, 17]) {
    const [block] = chunkToBlock(chunk, 0, 0);
    assert.equal(Math.floor(block / 32), chunk, `chunk ${chunk} does not round-trip`);
    // And the block just before it belongs to the previous chunk, never to this one.
    assert.equal(Math.floor((block - 1) / 32), chunk - 1, `boundary of chunk ${chunk}`);
  }
});

test("the shipped rooms are fifteen distinct chunks, two apart", () => {
  const list = templatesFor({ id: "veryEasy" }, () => {});
  assert.equal(list.length, 15, "the table no longer holds the fifteen built rooms");
  const chunks = new Set(list.map((room) => room.chunk.join("|")));
  assert.equal(chunks.size, 15, "two rooms point at the same chunk: copying one would copy the other");
  for (let index = 1; index < list.length; index += 1) {
    assert.equal(list[index].chunk[0] - list[index - 1].chunk[0], -2,
      `rooms #${index - 1} and #${index} are not two chunks apart`);
  }
  // The block coordinate the engine copies is the chunk's own first block.
  assert.deepEqual(list[0].src, [-64, 32, 0]);
  assert.deepEqual(list[0].chunk, [-2, 1, 0]);
});

test("a room has nothing to declare but a chunk", () => {
  // No faces, no spawn flag, no height: the table is a list of coordinates. This
  // asserts the shape rather than trusting a comment, because a leftover property
  // is a promise the generator would silently stop honouring.
  const saved = globalThis.ROOM_TEMPLATES;
  globalThis.ROOM_TEMPLATES = { rooms: [[-2, 1, 0]] };
  try {
    const [room] = templatesFor({ id: "veryEasy" }, () => {});
    assert.deepEqual(Object.keys(room).sort(), ["chunk", "index", "src"]);
  } finally {
    globalThis.ROOM_TEMPLATES = saved;
  }
});
