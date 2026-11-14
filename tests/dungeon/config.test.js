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
import { hashOf, templateFor, templatesFor } from "../../src/dungeon/templates.js";

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

test("a spawning template is used for the entrance, and only there", () => {
  const list = [
    { index: 0, src: [0, -32, 0], faces: "NESW" },
    { index: 1, src: [96, -32, 0], faces: "NESW", spawn: true },
  ];
  const difficulty = findDifficulty("easy");
  assert.equal(templateFor(list, difficulty, 0, 0).index, 1);
  assert.notEqual(templateFor(list, difficulty, 2, 2).index, 1);
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
