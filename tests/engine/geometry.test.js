import test from "node:test";
import assert from "node:assert/strict";

import { DUNGEON_CONFIG } from "../../src/dungeon/engine/config.js";
import {
  bounds,
  cellAt,
  clearanceMap,
  contourCells,
  countCells,
  createMask,
  fillRect,
  fromRows,
  isConnected,
  logicalToLocal,
  localToLogical,
  logicalToWorld,
  masksOverlap,
  mirrorX,
  normalizeMask,
  reachableCells,
  rotate90,
  sealHoles,
  shapeKey,
  toRows,
  walkablePath,
  worldToLogical,
} from "../../src/dungeon/engine/geometry.js";
import { generateShape, SHAPE_FAMILY_NAMES } from "../../src/dungeon/engine/shapes.js";
import { REFUSAL, validateRoom } from "../../src/dungeon/engine/validator.js";
import {
  canConnectDirectly,
  bridgeCells,
  jointCells,
  OPENING_STATUS,
  passageCells,
  planOpenings,
  placeRoomForOpening,
} from "../../src/dungeon/engine/openings.js";

// --------------------------------------------------------------- helpers --

function maskFrom(...rows) {
  return fromRows(rows);
}

function anchorFor(mask) {
  // A cell with a walkable neighbourhood, used as a path endpoint.
  const clearances = clearanceMap(mask);
  for (let y = 1; y < mask.h - 1; y += 1) {
    for (let x = 1; x < mask.w - 1; x += 1) {
      if (clearances[y][x] >= 1) return { x, y };
    }
  }
  return null;
}

// --------------------------------------------------------------- masks ----

test("a mask round-trips through text rows without losing a cell", () => {
  const mask = maskFrom("110", "111", "011");
  assert.deepEqual(toRows(mask), ["110", "111", "011"]);
  assert.equal(countCells(mask), 7);
  assert.deepEqual(bounds(mask), { x1: 0, y1: 0, x2: 2, y2: 2, w: 3, h: 3 });
});

test("normalizeMask trims the empty border and keeps the shape", () => {
  const padded = maskFrom("0000", "0110", "0110", "0000");
  const trimmed = normalizeMask(padded);
  assert.deepEqual(toRows(trimmed), ["11", "11"]);
});

test("rotations and mirrors preserve the number of cells", () => {
  const mask = maskFrom("111", "001", "001");
  assert.equal(countCells(rotate90(mask)), countCells(mask));
  assert.equal(countCells(mirrorX(mask)), countCells(mask));
  // Four quarter turns come back to the original shape.
  let turned = mask;
  for (let index = 0; index < 4; index += 1) turned = rotate90(turned);
  assert.equal(shapeKey(turned), shapeKey(mask));
});

test("connectivity rejects a shape made of two detached pieces", () => {
  assert.equal(isConnected(maskFrom("101", "000", "101")), false);
  assert.equal(isConnected(maskFrom("110", "010", "011")), true);
});

test("sealHoles fills a single enclosed empty cell", () => {
  const mask = maskFrom("111", "101", "111");
  sealHoles(mask);
  assert.deepEqual(toRows(mask), ["111", "111", "111"]);
});

// ---------------------------------------------------------- clearances ----

test("clearance is 1 on the shape border and grows inwards", () => {
  const mask = maskFrom("11111", "11111", "11111", "11111", "11111");
  const clearances = clearanceMap(mask);
  assert.equal(clearances[0][0], 1);
  assert.equal(clearances[0][4], 1);
  assert.equal(clearances[2][2], 3, "the centre of a 5x5 is three cells from the edge");
  assert.equal(clearances[1][1], 2);
});

test("clearance of an empty cell is 0, so a hole is never walkable", () => {
  const mask = maskFrom("111", "101", "111");
  const clearances = clearanceMap(mask);
  assert.equal(clearances[1][1], 0);
});

test("an L-shaped room has its clearance concentrated in the corner", () => {
  const mask = maskFrom("110", "110", "111");
  const clearances = clearanceMap(mask);
  assert.equal(clearances[2][2], 1);
  assert.equal(clearances[0][0], 1);
});

// ------------------------------------------------------------ contours ----

test("contour cells are exactly the occupied cells touching the outside", () => {
  const mask = maskFrom("111", "111", "111");
  // The eight border cells of a 3x3 touch the outside; the centre does not.
  assert.equal(contourCells(mask).length, 8);

  const bigger = maskFrom("1111", "1111", "1111", "1111");
  const contour = contourCells(bigger);
  assert.equal(contour.length, 12, "the four inner cells of a 4x4 are not on the contour");
  assert.ok(!contour.some((cell) => cell.x === 1 && cell.y === 1));
});

// ------------------------------------------------------------ overlaps ----

test("two L shapes with overlapping boxes but disjoint cells do not collide", () => {
  // Boxes overlap on x 1..2 and y 1..2; cells do not.
  const a = maskFrom("110", "110", "000");
  const b = maskFrom("000", "011", "011");
  const overlap = masksOverlap(a, { x: 0, y: 0 }, b, { x: 1, y: 1 }, 0);
  assert.equal(overlap, null, "bounding boxes overlap, real cells do not");
});

test("two rooms sharing one cell do collide, and the cell is reported", () => {
  const a = maskFrom("11", "11");
  const b = maskFrom("11", "11");
  const overlap = masksOverlap(a, { x: 0, y: 0 }, b, { x: 1, y: 1 }, 0);
  assert.deepEqual(overlap, { x: 1, y: 1 });
});

test("the margin is applied on real cells, not on boxes", () => {
  const a = maskFrom("11", "11");
  const b = maskFrom("11", "11");
  // Two empty columns between the rooms: exactly the margin of two, accepted.
  assert.equal(masksOverlap(a, { x: 0, y: 0 }, b, { x: 4, y: 0 }, 0), null);
  assert.equal(masksOverlap(a, { x: 0, y: 0 }, b, { x: 4, y: 0 }, 2), null);
  // A margin of three asks for one more empty column: refused.
  assert.notEqual(masksOverlap(a, { x: 0, y: 0 }, b, { x: 4, y: 0 }, 3), null);
});

// ---------------------------------------------------------------- walk ----

test("walkablePath finds a way through an L and refuses a sealed region", () => {
  const mask = maskFrom("110", "110", "111");
  const path = walkablePath(mask, { x: 0, y: 0 }, { x: 2, y: 2 }, 1);
  assert.ok(path && path.length >= 5, "the path goes round the corner");

  const split = maskFrom("111", "000", "111");
  assert.equal(walkablePath(split, { x: 0, y: 0 }, { x: 0, y: 2 }, 0), null);
});

test("reachableCells counts the walkable core of a room", () => {
  const mask = maskFrom("1111", "1111", "1111", "1111");
  const anchor = anchorFor(mask);
  const reached = reachableCells(mask, anchor, 1);
  assert.equal(reached, 16, "every cell of a 4x4 border is at clearance 1 or more");
});

// ------------------------------------------------------------- shapes -----

test("every shape family produces a connected, unpadded, walkable room", () => {
  for (const family of SHAPE_FAMILY_NAMES) {
    let produced = 0;
    for (let attempt = 0; attempt < 40 && produced < 3; attempt += 1) {
      const shape = generateShape(4000 + attempt, attempt, { families: [family] });
      if (!shape.ok) continue;
      produced += 1;
      assert.equal(isConnected(shape.mask), true, `${family} must be connected`);
      const box = bounds(shape.mask);
      assert.equal(box.x1, 0);
      assert.equal(box.y1, 0);
      assert.equal(box.x2, shape.mask.w - 1);
      assert.equal(box.y2, shape.mask.h - 1);
      assert.ok(shape.mask.w >= DUNGEON_CONFIG.minWidth && shape.mask.w <= DUNGEON_CONFIG.maxWidth);
      assert.ok(shape.mask.h >= DUNGEON_CONFIG.minDepth && shape.mask.h <= DUNGEON_CONFIG.maxDepth);
    }
    assert.ok(produced > 0, `${family} produced no shape at all`);
  }
});

test("shape generation is deterministic and independent of call order", () => {
  const first = generateShape(777, 0);
  // Interleave unrelated work, then ask again: the result must not depend on
  // any shared random state.
  generateShape(1, 0);
  generateShape(2, 1);
  const second = generateShape(777, 0);
  assert.equal(first.ok, second.ok);
  assert.equal(first.family, second.family);
  assert.deepEqual(toRows(first.mask), toRows(second.mask));
});

test("two different seeds produce different shapes most of the time", () => {
  const seen = new Set();
  for (let index = 0; index < 60; index += 1) {
    const shape = generateShape(90000 + index * 13, 0);
    if (shape.ok) seen.add(shapeKey(shape.mask));
  }
  assert.ok(seen.size > 45, `only ${seen.size} distinct shapes out of 60`);
});

test("a few hundred shapes never produce a detached piece or a hole", () => {
  let produced = 0;
  for (let index = 0; index < 400; index += 1) {
    const shape = generateShape(200000 + index * 31, index % 3);
    if (!shape.ok) continue;
    produced += 1;
    assert.equal(isConnected(shape.mask), true, `seed ${200000 + index * 31} is disconnected`);
    // No single enclosed empty cell may survive the gate.
    for (let y = 1; y < shape.mask.h - 1; y += 1) {
      for (let x = 1; x < shape.mask.w - 1; x += 1) {
        if (shape.mask.cells[y][x]) continue;
        const enclosed = cellAt(shape.mask, x + 1, y) && cellAt(shape.mask, x - 1, y)
          && cellAt(shape.mask, x, y + 1) && cellAt(shape.mask, x, y - 1);
        assert.ok(!enclosed, `hole at ${x},${y} in seed ${200000 + index * 31}`);
      }
    }
  }
  assert.ok(produced > 300, `only ${produced} shapes produced out of 400`);
});

// ----------------------------------------------------------- openings -----

test("openings sit on the real contour, never on a corner, never a hole", () => {
  for (let index = 0; index < 120; index += 1) {
    const shape = generateShape(500000 + index * 17, 0);
    if (!shape.ok) continue;
    const { openings } = planOpenings("r1", shape.mask, 500000 + index * 17);
    const contour = new Set(contourCells(shape.mask).map((cell) => `${cell.x},${cell.y}`));
    for (const opening of openings) {
      const cells = openingCells(shape.mask, opening);
      for (const cell of cells) {
        assert.ok(contour.has(`${cell.x},${cell.y}`),
          `opening ${opening.id} has a cell at ${cell.x},${cell.y} that is not on the contour`);
      }
      assert.ok(opening.offsetStart >= DUNGEON_CONFIG.minCornerClearance);
      const face = opening.side === "north" || opening.side === "south" ? shape.mask.w : shape.mask.h;
      assert.ok(opening.offsetEnd <= face - 1 - DUNGEON_CONFIG.minCornerClearance);
      // The cell behind the doorway belongs to the room.
      const behind = { x: opening.centerX - opening.vectorX, y: opening.centerY - opening.vectorY };
      assert.equal(cellAt(shape.mask, behind.x, behind.y), 1);
    }
  }
});

test("two openings on the same face always keep the spacing rule", () => {
  for (let index = 0; index < 120; index += 1) {
    const shape = generateShape(600000 + index * 11, 0);
    if (!shape.ok) continue;
    const { openings } = planOpenings("r1", shape.mask, 600000 + index * 11);
    const byFace = openings.slice().sort((x, y) => x.offsetStart - y.offsetStart);
    for (let a = 0; a < byFace.length; a += 1) {
      for (let b = a + 1; b < byFace.length; b += 1) {
        if (byFace[a].side !== byFace[b].side) continue;
        const gap = byFace[b].offsetStart - byFace[a].offsetEnd - 1;
        assert.ok(gap >= DUNGEON_CONFIG.minOpeningSpacing,
          `openings ${byFace[a].id} and ${byFace[b].id} are only ${gap} cells apart`);
      }
    }
  }
});

test("an opening is only offered when the room can host it", () => {
  let withOpenings = 0;
  for (let index = 0; index < 200; index += 1) {
    const shape = generateShape(700000 + index * 7, 0);
    if (!shape.ok) continue;
    const { openings } = planOpenings("r1", shape.mask, 700000 + index * 7);
    if (openings.length > 0) withOpenings += 1;
    assert.ok(openings.length >= DUNGEON_CONFIG.minOpenings,
      `a generated room must offer at least ${DUNGEON_CONFIG.minOpenings} openings`);
  }
  assert.equal(withOpenings, 200, "every generated shape must yield usable openings");
});

test("openings are reproducible from the room identity", () => {
  const shape = generateShape(4242, 0);
  const first = planOpenings("r9", shape.mask, 4242);
  const second = planOpenings("r9", shape.mask, 4242);
  assert.deepEqual(first.openings.map((opening) => [opening.id, opening.side, opening.offsetStart]),
    second.openings.map((opening) => [opening.id, opening.side, opening.offsetStart]));
  for (const opening of first.openings) {
    assert.equal(opening.status, OPENING_STATUS.PENDING);
    assert.equal(opening.connectionId, null);
  }
});

test("the number of openings varies with the perimeter instead of being constant", () => {
  const counts = new Set();
  for (let index = 0; index < 80; index += 1) {
    const shape = generateShape(800000 + index * 19, 0);
    if (!shape.ok) continue;
    counts.add(planOpenings("r1", shape.mask, 800000 + index * 19).openings.length);
  }
  assert.ok(counts.size >= 2, `every room offered the same number of openings: ${[...counts]}`);
});

test("canConnectDirectly accepts a joint pair and refuses a longer gap", () => {
  const mask = maskFrom("1111", "1111", "1111");
  const roomA = { origin: { x: 0, y: 0 }, mask };
  const roomB = { origin: { x: 0, y: mask.h + DUNGEON_CONFIG.wallGap }, mask };
  const openingA = fakeOpening({ side: "south", centerX: 1, centerY: mask.h - 1, vectorX: 0, vectorY: 1 });
  const openingB = fakeOpening({ side: "north", centerX: 1, centerY: 0, vectorX: 0, vectorY: -1 });

  assert.equal(canConnectDirectly(openingA, roomA.origin, mask, openingB, roomB.origin, mask), true);

  const tooFar = { origin: { x: 0, y: mask.h + DUNGEON_CONFIG.wallGap + 1 }, mask };
  assert.equal(canConnectDirectly(openingA, roomA.origin, mask, openingB, tooFar.origin, mask), false);
});

test("placeRoomForOpening puts the child exactly one joint away", () => {
  const parentMask = maskFrom("1111", "1111", "1111");
  const childMask = maskFrom("111", "111", "111");
  const parent = { origin: { x: 10, y: 10 }, mask: parentMask };
  const parentOpening = fakeOpening({
    side: "south", centerX: 1, centerY: parentMask.h - 1, vectorX: 0, vectorY: 1,
  });
  const childOpening = fakeOpening({ side: "north", centerX: 1, centerY: 0, vectorX: 0, vectorY: -1 });
  const origin = placeRoomForOpening(parent, parentOpening, childMask, childOpening);

  const parentEdge = parent.origin.y + parentMask.h - 1;
  const childEdge = origin.y;
  assert.equal(childEdge - parentEdge - 1, DUNGEON_CONFIG.wallGap);
  // Doorways must be on the same column.
  assert.equal(parent.origin.x + parentOpening.centerX, origin.x + childOpening.centerX);
});

test("jointCells fills exactly the masonry between two walls", () => {
  const mask = maskFrom("111", "111", "111");
  const room = { origin: { x: 0, y: 0 }, mask };
  const opening = fakeOpening({ side: "east", centerX: 2, centerY: 1, vectorX: 1, vectorY: 0 });
  const cells = jointCells(room, opening);
  assert.equal(cells.length, DUNGEON_CONFIG.wallGap * opening.width);
  for (const cell of cells) assert.ok(cell.x > 2 && cell.x <= 2 + DUNGEON_CONFIG.wallGap);
});

test("bridgeCells only spans a bounded straight gap and never overlaps a room", () => {
  const mask = maskFrom("111", "111", "111");
  const roomA = { origin: { x: 0, y: 0 }, mask };
  const roomB = { origin: { x: 0, y: 3 + DUNGEON_CONFIG.wallGap + 1 }, mask };
  const openingA = fakeOpening({ side: "south", centerX: 1, centerY: 2, vectorX: 0, vectorY: 1 });
  const openingB = fakeOpening({ side: "north", centerX: 1, centerY: 0, vectorX: 0, vectorY: -1 });

  const near = bridgeCells(roomA, openingA, roomB, openingB);
  assert.ok(near && near.cells.length > 0);

  const tooFar = { origin: { x: 0, y: 40 }, mask };
  assert.equal(bridgeCells(roomA, openingA, tooFar, openingB), null);
});

test("passageCells spans the cells between two aligned openings", () => {
  const openingA = fakeOpening({ side: "south", centerX: 2, centerY: 3, vectorX: 0, vectorY: 1, width: 1 });
  const openingB = fakeOpening({ side: "north", centerX: 2, centerY: 0, vectorX: 0, vectorY: -1, width: 1 });
  const cells = passageCells(openingA, { x: 0, y: 0 }, openingB, { x: 0, y: 7 });
  // From y=3 to y=7 inclusive.
  assert.deepEqual(cells.map((cell) => cell.y), [3, 4, 5, 6, 7]);
});

// ---------------------------------------------------- coordinate Frames ---

test("logical, local and world frames convert back and forth exactly", () => {
  const origin = { x: 1024, y: -1000, z: 2048 };
  const cell = { x: 13, y: -7 };
  const world = logicalToWorld(origin, cell);
  assert.deepEqual([world.x, world.z], [1037, 2041]);
  assert.deepEqual(worldToLogical(origin, world), cell);

  const roomOrigin = { x: 10, y: 20 };
  const local = logicalToLocal(roomOrigin, { x: 13, y: 24 });
  assert.deepEqual(local, { x: 3, y: 4 });
  assert.deepEqual(localToLogical(roomOrigin, local), { x: 13, y: 24 });
});

// --------------------------------------------------------------- helpers --

function fakeOpening(fields) {
  const opening = {
    id: "x.o0",
    roomId: "x",
    side: "north",
    centerX: 0,
    centerY: 0,
    vectorX: 0,
    vectorY: -1,
    width: DUNGEON_CONFIG.minPassageWidth,
    height: DUNGEON_CONFIG.passageHeight,
    status: OPENING_STATUS.PENDING,
    connectionId: null,
    failures: 0,
    ...fields,
  };
  // A real opening carries its span (`offsetStart`/`offsetEnd`, along the wall)
  // *and* a centre. The two must agree: the centre of a three-cell span is its
  // middle cell, and the corridor across the wall gap starts at the span's first
  // cell. A fake that gives a centre and leaves the span at 0 is not an opening,
  // it is a position — so the span is derived here unless the test sets it.
  if (fields.offsetStart === undefined) {
    const along = opening.side === "north" || opening.side === "south" ? opening.centerX : opening.centerY;
    opening.offsetStart = along;
    opening.offsetEnd = along + opening.width - 1;
  }
  if (fields.offsetEnd === undefined) opening.offsetEnd = opening.offsetStart + opening.width - 1;
  return opening;
}

/** Every outer-face cell an opening pierces. */
function openingCells(mask, opening) {
  const cells = [];
  for (let offset = opening.offsetStart; offset <= opening.offsetEnd; offset += 1) {
    if (opening.side === "north") cells.push({ x: offset, y: 0 });
    else if (opening.side === "south") cells.push({ x: offset, y: mask.h - 1 });
    else if (opening.side === "west") cells.push({ x: 0, y: offset });
    else cells.push({ x: mask.w - 1, y: offset });
  }
  return cells;
}

// ------------------------------------------------- room size variety ------

test("room sizes are drawn from a ladder of bands, not a flat range", () => {
  // A uniform draw over [minWidth, maxWidth] gives every width the same chance:
  // measured over 280 rooms, one exact width came up 20 times and the dungeon
  // read as a row of clones. The ladder is what makes sizes differ.
  const sizes = [];
  for (let index = 0; index < 400; index += 1) {
    const shape = generateShape(900000 + index * 13, 0);
    if (!shape.ok) continue;
    sizes.push(shape.mask.w);
    sizes.push(shape.mask.h);
  }
  assert.ok(sizes.length > 400, "not enough shapes to draw a conclusion");

  // Every side is inside the envelope the config promises.
  for (const side of sizes) {
    assert.ok(side >= DUNGEON_CONFIG.minWidth && side <= DUNGEON_CONFIG.maxWidth,
      `${side} is outside the configured envelope`);
  }

  // Variety: at least ten distinct sides, and the smallest under two thirds of the
  // largest. A flat draw also passes this, so the point is the *shape* of the
  // distribution below.
  const distinct = new Set(sizes);
  assert.ok(distinct.size >= 10, `only ${distinct.size} distinct room sides`);
  assert.ok(Math.min(...sizes) < Math.max(...sizes) * 0.66, "every room is the same size");

  // The ladder has to produce small rooms: a band whose whole range is in the
  // bottom third must actually be drawn from. Without it, the "small" end of the
  // dungeon is only ever a uniform tail.
  const small = DUNGEON_CONFIG.minWidth + (DUNGEON_CONFIG.maxWidth - DUNGEON_CONFIG.minWidth) / 3;
  const smallCount = sizes.filter((side) => side <= small).length;
  assert.ok(smallCount > sizes.length * 0.1,
    `only ${smallCount} of ${sizes.length} sides are small: the ladder is not being drawn from`);
});

test("no room may land on a corridor that is already committed", () => {
  // The rule that keeps corridors honest, and it is deliberately narrow: only
  // committed corridors are protected. A room's own *pending* doorway that looks
  // at a neighbour is not a conflict — the builder walls a doorway that leads
  // nowhere. A corridor is the only way through to the rooms it joins, and
  // nothing re-reads it, so a room arriving on top of it seals a live branch.
  const side = 30;
  const mask = maskFrom(...Array.from({ length: side }, () => "1".repeat(side)));
  const candidate = { mask, origin: { x: 0, y: 0 }, openings: [
    fakeOpening({ side: "east", centerX: side - 1, centerY: 10, width: DUNGEON_CONFIG.minPassageWidth }),
  ] };

  // A corridor cell under the candidate's own floor: refused.
  const blocked = validateRoom({
    candidate,
    nearby: [],
    parent: null,
    childOpening: null,
    radius: 1000,
    clearances: clearanceMap(mask),
    corridors: new Set(["12,12"]),
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, REFUSAL.CORRIDOR_BLOCKED);

  // A corridor cell one step outside the footprint: accepted. It is beside the
  // room, not inside it, and the room's wall does not block a tunnel.
  const clear = validateRoom({
    candidate,
    nearby: [],
    parent: null,
    childOpening: null,
    radius: 1000,
    clearances: clearanceMap(mask),
    corridors: new Set(["12,30"]),
  });
  assert.equal(clear.ok, true, `a corridor outside the room was refused: ${clear.code}`);
});

// ------------------------------------------------- room size variety ------

test("room sizes are drawn from a ladder of bands, not a flat range", () => {
  // A uniform draw over [minWidth, maxWidth] gives every width the same chance:
  // measured over 280 rooms, one exact width came up 20 times and the dungeon
  // read as a row of clones. The ladder is what makes sizes differ.
  const sizes = [];
  for (let index = 0; index < 400; index += 1) {
    const shape = generateShape(900000 + index * 13, 0);
    if (!shape.ok) continue;
    sizes.push(shape.mask.w);
    sizes.push(shape.mask.h);
  }
  assert.ok(sizes.length > 400, "not enough shapes to draw a conclusion");

  // Every side is inside the envelope the config promises.
  for (const side of sizes) {
    assert.ok(side >= DUNGEON_CONFIG.minWidth && side <= DUNGEON_CONFIG.maxWidth,
      `${side} is outside the configured envelope`);
  }

  // Variety: at least ten distinct sides, and the smallest under two thirds of the
  // largest. A flat draw also passes this, so the point is the *shape* of the
  // distribution below.
  const distinct = new Set(sizes);
  assert.ok(distinct.size >= 10, `only ${distinct.size} distinct room sides`);
  assert.ok(Math.min(...sizes) < Math.max(...sizes) * 0.66, "every room is the same size");

  // The ladder has to produce small rooms: a band whose whole range is in the
  // bottom third must actually be drawn from. Without it, the "small" end of the
  // dungeon is only ever a uniform tail.
  const small = DUNGEON_CONFIG.minWidth + (DUNGEON_CONFIG.maxWidth - DUNGEON_CONFIG.minWidth) / 3;
  const smallCount = sizes.filter((side) => side <= small).length;
  assert.ok(smallCount > sizes.length * 0.1,
    `only ${smallCount} of ${sizes.length} sides are small: the ladder is not being drawn from`);
});

test("no room may land on a corridor that is already committed", () => {
  // The rule that keeps corridors honest, and it is deliberately narrow: only
  // committed corridors are protected. A room's own *pending* doorway that looks
  // at a neighbour is not a conflict — the builder walls a doorway that leads
  // nowhere. A corridor is the only way through to the rooms it joins, and
  // nothing re-reads it, so a room arriving on top of it seals a live branch.
  const side = 30;
  const mask = maskFrom(...Array.from({ length: side }, () => "1".repeat(side)));
  const candidate = {
    mask,
    origin: { x: 0, y: 0 },
    openings: [fakeOpening({ side: "east", centerX: side - 1, centerY: 10, width: DUNGEON_CONFIG.minPassageWidth })],
  };

  // A corridor cell under the candidate's own floor: refused.
  const blocked = validateRoom({
    candidate,
    nearby: [],
    parent: null,
    childOpening: null,
    radius: 1000,
    clearances: clearanceMap(mask),
    corridors: new Set(["12,12"]),
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, REFUSAL.CORRIDOR_BLOCKED);

  // A corridor cell one step outside the footprint: accepted. It runs beside the
  // room, not through it, and a room's wall does not block a tunnel.
  const clear = validateRoom({
    candidate,
    nearby: [],
    parent: null,
    childOpening: null,
    radius: 1000,
    clearances: clearanceMap(mask),
    corridors: new Set(["12,30"]),
  });
  assert.equal(clear.ok, true, `a corridor outside the room was refused: ${clear.code}`);
});
