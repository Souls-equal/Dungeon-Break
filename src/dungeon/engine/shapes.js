/*
 * Procedural room shapes.
 *
 * A shape family draws on a mask, then the result goes through a single
 * acceptance gate: occupied (not hollow), connected, big enough to walk in,
 * and not a duplicate of a shape already produced for this room. Rejected
 * draws are retried with the next sub-seed, which keeps the whole thing
 * deterministic.
 *
 * The grammar is a list of families rather than a list of models: adding a
 * family is adding one entry in SHAPE_FAMILIES, nothing else.
 */

import { DUNGEON_CONFIG } from "./config.js";
import { createRandomSource, hashParts } from "./random.js";
import {
  bounds,
  countCells,
  contourCells,
  createMask,
  fillRect,
  clearanceMap,
  isConnected,
  sealHoles,
  shapeKey,
  toRows,
} from "./geometry.js";

/**
 * Largest square of walkable cells a shape contains, judged on the clearance
 * map. A room with no 2x2 of interior cells would be a one-cell corridor, which
 * is not what "a room" means in this design.
 */
function hasWalkableCore(mask) {
  const clearances = clearanceMap(mask);
  for (let y = 1; y < mask.h - 1; y += 1) {
    for (let x = 1; x < mask.w - 1; x += 1) {
      if (clearances[y][x] < 2) continue;
      if (clearances[y][x + 1] >= 2 && clearances[y + 1][x] >= 2 && clearances[y + 1][x + 1] >= 2) {
        return true;
      }
    }
  }
  return false;
}

/** Every family fills `mask` in place. Dimensions come from the caller. */
const SHAPE_FAMILIES = {
  rect(mask) {
    fillRect(mask, 0, 0, mask.w - 1, mask.h - 1);
  },

  /** A rectangle with one corner bitten off: still a room, visibly asymmetric. */
  notch(mask, random) {
    fillRect(mask, 0, 0, mask.w - 1, mask.h - 1);
    const depth = Math.max(1, Math.floor(Math.min(mask.w, mask.h) * 0.35));
    const across = Math.max(1, Math.floor(Math.min(mask.w, mask.h) * 0.35));
    const corner = random.int(0, 3);
    if (corner === 0) fillRect(mask, 0, 0, across, depth, 0);
    else if (corner === 1) fillRect(mask, mask.w - 1 - across, 0, mask.w - 1, depth, 0);
    else if (corner === 2) fillRect(mask, 0, mask.h - 1 - depth, across, mask.h - 1, 0);
    else fillRect(mask, mask.w - 1 - across, mask.h - 1 - depth, mask.w - 1, mask.h - 1, 0);
  },

  /** One cell-wide wings on opposite sides: an L or a T, depending on the ends. */
  wings(mask, random) {
    const horizontal = random.chance(0.5);
    const thickness = random.int(1, Math.max(1, Math.floor(Math.min(mask.w, mask.h) / 2) - 1));
    if (horizontal) {
      const y1 = random.int(0, mask.h - 1 - thickness);
      fillRect(mask, 0, y1, mask.w - 1, y1 + thickness);
      const legX1 = random.chance(0.5) ? 0 : mask.w - 1 - thickness;
      fillRect(mask, legX1, 0, legX1 + thickness, mask.h - 1);
    } else {
      const x1 = random.int(0, mask.w - 1 - thickness);
      fillRect(mask, x1, 0, x1 + thickness, mask.h - 1);
      const legY1 = random.chance(0.5) ? 0 : mask.h - 1 - thickness;
      fillRect(mask, 0, legY1, mask.w - 1, legY1 + thickness);
    }
  },

  /** A cross: a horizontal bar and a vertical bar whose arms may be asymmetric. */
  cross(mask, random) {
    const barHeight = random.int(1, Math.max(1, Math.floor(mask.h / 3)));
    const barWidth = random.int(1, Math.max(1, Math.floor(mask.w / 3)));
    const y1 = random.int(0, mask.h - 1 - barHeight);
    const x1 = random.int(0, mask.w - 1 - barWidth);
    fillRect(mask, 0, y1, mask.w - 1, y1 + barHeight);
    fillRect(mask, x1, 0, x1 + barWidth, mask.h - 1);
  },

  /** A rectangle plus one or two side chambers: alcoves and lateral extensions. */
  extensions(mask, random) {
    fillRect(mask, 0, 0, mask.w - 1, mask.h - 1);
    const count = random.int(1, 2);
    for (let index = 0; index < count; index += 1) {
      const side = random.int(0, 3);
      const span = random.int(1, Math.max(1, Math.floor((side % 2 === 0 ? mask.w : mask.h) / 2)));
      if (side === 0) {
        const x1 = random.int(0, mask.w - 1 - span);
        fillRect(mask, x1, 0, x1 + span, Math.max(1, Math.floor(mask.h / 3)), 1);
      } else if (side === 1) {
        const y1 = random.int(0, mask.h - 1 - span);
        fillRect(mask, mask.w - 1 - Math.max(1, Math.floor(mask.w / 3)), y1, mask.w - 1, y1 + span, 1);
      } else if (side === 2) {
        const x1 = random.int(0, mask.w - 1 - span);
        fillRect(mask, x1, mask.h - 1 - Math.max(1, Math.floor(mask.h / 3)), x1 + span, mask.h - 1, 1);
      } else {
        const y1 = random.int(0, mask.h - 1 - span);
        fillRect(mask, 0, y1, Math.max(1, Math.floor(mask.w / 3)), y1 + span, 1);
      }
    }
  },

  /**
   * Irregular: a rectangle with bites taken out of its edges, plus one or two
   * flat protrusions. Bites only ever start on the contour, so they can deepen
   * an edge but never punch a hole in the floor, and a shape that a bite would
   * cut in two is rejected by the connectivity gate and redrawn.
   */
  irregular(mask, random) {
    fillRect(mask, 0, 0, mask.w - 1, mask.h - 1);
    const bites = random.int(2, 5);
    for (let index = 0; index < bites; index += 1) {
      const side = random.int(0, 3);
      const span = random.int(1, 2);
      const depth = random.int(1, 2);
      if (side === 0) {
        const x1 = random.int(1, Math.max(1, mask.w - 1 - span));
        fillRect(mask, x1, 0, x1 + span - 1, depth - 1, 0);
      } else if (side === 2) {
        const x1 = random.int(1, Math.max(1, mask.w - 1 - span));
        fillRect(mask, x1, mask.h - depth, x1 + span - 1, mask.h - 1, 0);
      } else if (side === 1) {
        const y1 = random.int(1, Math.max(1, mask.h - 1 - span));
        fillRect(mask, mask.w - depth, y1, mask.w - 1, y1 + span - 1, 0);
      } else {
        const y1 = random.int(1, Math.max(1, mask.h - 1 - span));
        fillRect(mask, 0, y1, depth - 1, y1 + span - 1, 0);
      }
    }
    // Two cells deep at most, and never on a corner: the result stays a room
    // with uneven walls rather than a maze.
  },

  /** A wide room narrowed in its middle: two chambers joined by a neck. */
  narrow(mask, random) {
    fillRect(mask, 0, 0, mask.w - 1, mask.h - 1);
    const horizontal = random.chance(0.5);
    if (horizontal) {
      const from = Math.max(1, Math.floor(mask.w / 2) - 1);
      const to = Math.min(mask.w - 2, Math.floor(mask.w / 2));
      const top = random.int(1, Math.max(1, Math.floor(mask.h / 3)));
      const bottom = mask.h - 1 - random.int(1, Math.max(1, Math.floor(mask.h / 3)));
      fillRect(mask, from - 1, 0, to + 1, top, 0);
      fillRect(mask, from - 1, bottom, to + 1, mask.h - 1, 0);
    } else {
      const from = Math.max(1, Math.floor(mask.h / 2) - 1);
      const to = Math.min(mask.h - 2, Math.floor(mask.h / 2));
      const left = random.int(1, Math.max(1, Math.floor(mask.w / 3)));
      const right = mask.w - 1 - random.int(1, Math.max(1, Math.floor(mask.w / 3)));
      fillRect(mask, 0, from - 1, left, to + 1, 0);
      fillRect(mask, right, from - 1, mask.w - 1, to + 1, 0);
    }
  },
};

export const SHAPE_FAMILY_NAMES = Object.keys(SHAPE_FAMILIES);

/** Dimensions drawn from the room's own seed, so two rooms differ. */
function drawDimensions(random) {
  const width = random.int(DUNGEON_CONFIG.minWidth, DUNGEON_CONFIG.maxWidth);
  const depth = random.int(DUNGEON_CONFIG.minDepth, DUNGEON_CONFIG.maxDepth);
  // Bias towards squarer rooms half the time, so long corridors of rooms do
  // not dominate an entire dungeon.
  if (random.chance(0.45)) {
    const size = Math.min(width, depth);
    return { w: size, h: size };
  }
  return { w: width, h: depth };
}

/**
 * Builds one candidate shape.
 *
 * Returns `{ ok, mask, family, reason }`. A rejected candidate is a normal
 * outcome, not an error: the caller tries the next family or sub-seed, and the
 * reason is kept so the diagnostic tool can explain a missing room.
 */
export function generateShape(seed, attempt = 0, options = {}) {
  const families = options.families || SHAPE_FAMILY_NAMES;
  const used = new Set();

  for (let pass = 0; pass < families.length * 3; pass += 1) {
    const subSeed = hashParts("shape", seed, attempt, pass);
    const random = createRandomSource(subSeed);
    const dimensions = drawDimensions(random);
    const mask = createMask(dimensions.w, dimensions.h);
    // The family is drawn from the seed, not from the pass index: taking it
    // from the index would always try the same family first and every room
    // would be a rectangle, because a rectangle almost always succeeds.
    const family = families.length === 1
      ? families[0]
      : families[random.int(0, families.length - 1)];
    SHAPE_FAMILIES[family](mask, random);
    sealHoles(mask);

    if (countCells(mask) < 6) {
      used.add("TOO_SMALL");
      continue;
    }
    if (!isConnected(mask)) {
      used.add("DISCONNECTED");
      continue;
    }
    if (!hasWalkableCore(mask)) {
      used.add("NO_WALKABLE_CORE");
      continue;
    }
    const box = bounds(mask);
    // A shape must be its own bounding box: a mask with a dead border would
    // waste cells and confuse the contour.
    if (!box || box.x1 !== 0 || box.y1 !== 0 || box.x2 !== mask.w - 1 || box.y2 !== mask.h - 1) {
      used.add("PADDED");
      continue;
    }
    const key = shapeKey(mask);
    if (options.exclude && options.exclude.has(key)) {
      used.add("DUPLICATE");
      continue;
    }

    return {
      ok: true,
      mask,
      family,
      rows: toRows(mask),
      seed: subSeed,
    };
  }

  return {
    ok: false,
    reason: used.size === 1 ? [...used][0] : "EXHAUSTED",
    tried: [...used],
  };
}
