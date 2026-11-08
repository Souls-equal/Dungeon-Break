/*
 * Openings: the only way a dungeon grows.
 *
 * An opening is a data object, never a boolean on a room. It carries its own
 * identifier, its position on the real contour of the room, its direction and
 * its state. Two rooms are connected only when a connection object names two
 * opening identifiers: proximity alone never creates a link.
 *
 * Lifecycle: pending -> (reserved, in memory only) -> connected
 *                    \-> pending again after a failed attempt
 *                    \-> blocked after repeated failures
 *
 * `reserved` is deliberately never persisted: a reservation only exists during
 * one transaction, so an interrupted generation cannot leave an opening stuck.
 */

import { DUNGEON_CONFIG } from "./config.js";
import { hashParts } from "./random.js";
import { cellAt, clearanceMap, sideVector, SIDES } from "./geometry.js";

export const OPENING_STATUS = {
  PENDING: "pending",
  RESERVED: "reserved",
  CONNECTED: "connected",
  BLOCKED: "blocked",
};

/**
 * Groups the contour cells of a face into runs, one run per eligible span.
 *
 * A span is `width` consecutive cells of the same face whose clearance behind
 * the wall is enough to stand in. A run shorter than `minCornerClearance *
 * 2 + width` cannot host an opening without breaking the corner clearance.
 */
function faceRuns(mask, clearances, side, width) {
  const runs = [];
  const vector = sideVector(side);
  // The cell that must be walkable is the one *behind* the wall, seen from
  // outside: it is the inward direction, the opposite of the outward vector.
  const inwardX = -vector.x;
  const inwardY = -vector.y;
  const alongWidth = side === "north" || side === "south";
  const fixed = side === "north" ? 0
    : side === "south" ? mask.h - 1
      : side === "west" ? 0 : mask.w - 1;
  const last = alongWidth ? mask.w - 1 : mask.h - 1;

  let start = -1;
  for (let index = 0; index <= last; index += 1) {
    const x = alongWidth ? index : fixed;
    const y = alongWidth ? fixed : index;
    const inside = cellAt(mask, x, y) === 1;
    const behindX = x + inwardX;
    const behindY = y + inwardY;
    // The cell behind the doorway must be *standable*, not merely part of the
    // skirt. The builder walls a cell that has an empty neighbour on either
    // axis, so an approach cell framed by two empties is a pillar with a hole
    // through it: the player walks into it. Clearance alone cannot see this
    // (a corner cell also has clearance 2 and only one empty neighbour), hence
    // the explicit count.
    const besideAX = behindX - inwardY;
    const besideAY = behindY - inwardX;
    const besideBX = behindX + inwardY;
    const besideBY = behindY + inwardX;
    const empties = (cellAt(mask, besideAX, besideAY) === 1 ? 0 : 1)
      + (cellAt(mask, besideBX, besideBY) === 1 ? 0 : 1);
    const walkable = inside
      && cellAt(mask, behindX, behindY) === 1
      && clearances[behindY][behindX] >= 1
      && empties <= 1;

    if (walkable && start === -1) start = index;
    if ((!walkable || index === last) && start !== -1) {
      const end = walkable ? index : index - 1;
      runs.push({ from: start, to: end, length: end - start + 1 });
      start = -1;
    }
  }
  // A run too short cannot host an opening and still keep the corner clearance.
  return runs.filter((run) => run.length >= width + DUNGEON_CONFIG.minCornerClearance * 2);
}

/** Score of a candidate span: prefer the middle of long runs, avoid corners. */
function spanScore(run, offset, width) {
  const center = run.from + (run.length - 1) / 2;
  const spanCenter = offset + (width - 1) / 2;
  return Math.abs(center - spanCenter);
}

/**
 * Places the openings of one room.
 *
 * Returns the list of openings, each with a stable identifier derived from the
 * room identifier and its index, so a rebuilt room regenerates the same
 * openings in the same order.
 *
 * Nothing is written: this is pure geometry.
 */
export function planOpenings(roomId, mask, seed) {
  const clearances = clearanceMap(mask);
  // One width for every doorway of the dungeon. The room size only decides
  // whether the wider option is allowed, and the configuration has the last
  // word: with min = max = 1, every span is one cell wide whatever the room.
  const width = Math.max(
    DUNGEON_CONFIG.minPassageWidth,
    Math.min(
      DUNGEON_CONFIG.maxPassageWidth,
      Math.min(mask.w, mask.h) >= 6 ? DUNGEON_CONFIG.maxPassageWidth : DUNGEON_CONFIG.minPassageWidth,
    ),
  );

  // Every legal span on every face, before any choice is made.
  const candidates = [];
  for (let sideIndex = 0; sideIndex < SIDES.length; sideIndex += 1) {
    const side = SIDES[sideIndex];
    const runs = faceRuns(mask, clearances, side, width);
    for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
      const run = runs[runIndex];
      for (let offset = run.from + DUNGEON_CONFIG.minCornerClearance;
        offset + width - 1 <= run.to - DUNGEON_CONFIG.minCornerClearance;
        offset += 1) {
        candidates.push({
          side,
          offsetStart: offset,
          offsetEnd: offset + width - 1,
          width,
          // Prefer the middle of a long wall: corner-adjacent openings are
          // valid but read badly.
          score: spanScore(run, offset, width),
          tie: hashParts(seed, side, offset) / 4294967296,
        });
      }
    }
  }

  if (candidates.length === 0) return { openings: [], width };

  candidates.sort((a, b) => (a.score - b.score) || (a.tie - b.tie));

  const wanted = Math.max(
    DUNGEON_CONFIG.minOpenings,
    Math.min(
      DUNGEON_CONFIG.maxOpenings,
      Math.floor(contourLength(mask) / DUNGEON_CONFIG.cellsPerOpening),
    ),
  );

  const chosen = [];
  const perSide = { north: 0, east: 0, south: 0, west: 0 };
  // Greedy with a diversity penalty: spreading openings over several faces is
  // what makes a room a crossroads instead of a corridor with two doors.
  let guard = 0;
  while (chosen.length < wanted && guard < candidates.length * 2) {
    guard += 1;
    let best = null;
    let bestScore = Infinity;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (candidate.taken) continue;
      if (!fits(candidate, chosen)) continue;
      const score = candidate.score + perSide[candidate.side] * 3;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (!best) break;
    best.taken = true;
    chosen.push(best);
    perSide[best.side] += 1;
  }

  const openings = chosen.map((candidate, index) => buildOpening(roomId, mask, candidate, index));
  return { openings, width };
}

/** No two openings on the same face may be closer than the spacing rule. */
function fits(candidate, chosen) {
  for (let index = 0; index < chosen.length; index += 1) {
    const other = chosen[index];
    if (other.side !== candidate.side) continue;
    if (candidate.offsetStart <= other.offsetEnd + DUNGEON_CONFIG.minOpeningSpacing
      && other.offsetStart <= candidate.offsetEnd + DUNGEON_CONFIG.minOpeningSpacing) {
      return false;
    }
  }
  return true;
}

function contourLength(mask) {
  let total = 0;
  for (let y = 0; y < mask.h; y += 1) {
    for (let x = 0; x < mask.w; x += 1) {
      if (!cellAt(mask, x, y)) continue;
      if (!cellAt(mask, x + 1, y) || !cellAt(mask, x - 1, y)
        || !cellAt(mask, x, y + 1) || !cellAt(mask, x, y - 1)) total += 1;
    }
  }
  return total;
}

function buildOpening(roomId, mask, candidate, index) {
  const { side } = candidate;
  const height = Math.min(DUNGEON_CONFIG.passageHeight, DUNGEON_CONFIG.wallHeight);
  // `x`/`y` are the outer face cells of the opening, in room-local
  // coordinates: the cell of the room that the doorway pierces.
  const cells = [];
  for (let offset = candidate.offsetStart; offset <= candidate.offsetEnd; offset += 1) {
    if (side === "north") cells.push({ x: offset, y: 0 });
    else if (side === "south") cells.push({ x: offset, y: mask.h - 1 });
    else if (side === "west") cells.push({ x: 0, y: offset });
    else cells.push({ x: mask.w - 1, y: offset });
  }
  const middle = cells[Math.floor(cells.length / 2)];
  const vector = sideVector(side);
  return {
    id: `${roomId}.o${index}`,
    roomId,
    side,
    // Middle cell of the span: connections are measured from it, and the
    // index is keyed on it (§11).
    centerX: middle.x,
    centerY: middle.y,
    offsetStart: candidate.offsetStart,
    offsetEnd: candidate.offsetEnd,
    width: candidate.width === undefined
      ? candidate.offsetEnd - candidate.offsetStart + 1
      : candidate.width,
    height,
    vectorX: vector.x,
    vectorY: vector.y,
    status: OPENING_STATUS.PENDING,
    connectionId: null,
    failures: 0,
  };
}

/** The passage cells between two aligned openings, both room-local. */
export function passageCells(ownOpening, ownRoomOrigin, otherOpening, otherRoomOrigin) {
  const own = {
    x: ownOpening.centerX + ownRoomOrigin.x,
    y: ownOpening.centerY + ownRoomOrigin.y,
  };
  const other = {
    x: otherOpening.centerX + otherRoomOrigin.x,
    y: otherOpening.centerY + otherRoomOrigin.y,
  };
  const cells = [];
  if (ownOpening.side === "north" || ownOpening.side === "south") {
    const from = Math.min(own.y, other.y);
    const to = Math.max(own.y, other.y);
    for (let y = from; y <= to; y += 1) {
      for (let dx = 0; dx < ownOpening.width; dx += 1) {
        cells.push({ x: own.x + dx, y });
      }
    }
  } else {
    const from = Math.min(own.x, other.x);
    const to = Math.max(own.x, other.x);
    for (let x = from; x <= to; x += 1) {
      for (let dy = 0; dy < ownOpening.width; dy += 1) {
        cells.push({ x, y: own.y + dy });
      }
    }
  }
  return cells;
}

/**
 * Distance, in cells, between two room edges that face each other.
 *
 * Single source of truth for the joint: the placement of a child room, the
 * opening index and the compatibility check all derive from it, so they can
 * never disagree.
 */
export function jointWidth() {
  return DUNGEON_CONFIG.wallGap;
}

/**
 * Can these two openings be connected directly?
 *
 * Direct means: opposite faces, same width, doorways on the same axis, and the
 * joint exactly `wallGap` cells wide between the two room walls. Anything else
 * would need a corridor of its own length, which this engine does not build
 * implicitly: a connection must describe something reproducible.
 */
export function canConnectDirectly(ownOpening, ownRoomOrigin, ownMask, otherOpening, otherRoomOrigin, otherMask) {
  if (ownOpening.side === otherOpening.side) return false;
  if (ownOpening.width !== otherOpening.width) return false;
  const opposite = { north: "south", south: "north", east: "west", west: "east" }[ownOpening.side];
  if (opposite !== otherOpening.side) return false;

  const own = { x: ownOpening.centerX + ownRoomOrigin.x, y: ownOpening.centerY + ownRoomOrigin.y };
  const other = { x: otherOpening.centerX + otherRoomOrigin.x, y: otherOpening.centerY + otherRoomOrigin.y };

  const vertical = ownOpening.side === "north" || ownOpening.side === "south";
  if (vertical) {
    if (own.x !== other.x) return false;
    // Distance between the two room edges, not between the openings' centres:
    // that is what the joint is made of.
    const ownEdge = ownRoomOrigin.y + (ownOpening.side === "north" ? 0 : ownMask.h - 1);
    const otherEdge = otherRoomOrigin.y + (otherOpening.side === "north" ? 0 : otherMask.h - 1);
    return Math.abs(otherEdge - ownEdge) - 1 === DUNGEON_CONFIG.wallGap;
  }
  if (own.y !== other.y) return false;
  const ownEdge = ownRoomOrigin.x + (ownOpening.side === "west" ? 0 : ownMask.w - 1);
  const otherEdge = otherRoomOrigin.x + (otherOpening.side === "west" ? 0 : otherMask.w - 1);
  return Math.abs(otherEdge - ownEdge) - 1 === DUNGEON_CONFIG.wallGap;
}

/**
 * Placement of a child room on one of its parent's openings.
 *
 * The two doorway centres are kept on the same column or row, and the child's
 * own edge on the facing side is put exactly `wallGap` cells away from the
 * parent's edge: the joint is the only variable distance, and it is a constant
 * of the configuration. Applying `wallGap` to a *centre* would silently give a
 * zero-width joint whenever the child's own edge is not at local coordinate 0,
 * which is why the calculation is written in terms of edges.
 */
export function placeRoomForOpening(parentRoom, parentOpening, childMask, childOpening) {
  const parentLeft = parentRoom.origin.x;
  const parentTop = parentRoom.origin.y;
  const parentWidth = parentRoom.mask.w;
  const parentHeight = parentRoom.mask.h;
  const joint = DUNGEON_CONFIG.wallGap + 1;

  const origin = {
    x: parentLeft + parentOpening.centerX - childOpening.centerX,
    y: parentTop + parentOpening.centerY - childOpening.centerY,
  };

  if (parentOpening.side === "south") {
    const parentEdge = parentTop + parentHeight - 1;
    const childEdge = childOpening.side === "north" ? 0 : childMask.h - 1;
    origin.y = parentEdge + joint - childEdge;
  } else if (parentOpening.side === "north") {
    const parentEdge = parentTop;
    const childEdge = childOpening.side === "south" ? childMask.h - 1 : 0;
    origin.y = parentEdge - joint - childEdge;
  } else if (parentOpening.side === "east") {
    const parentEdge = parentLeft + parentWidth - 1;
    const childEdge = childOpening.side === "west" ? 0 : childMask.w - 1;
    origin.x = parentEdge + joint - childEdge;
  } else {
    const parentEdge = parentLeft;
    const childEdge = childOpening.side === "east" ? childMask.w - 1 : 0;
    origin.x = parentEdge - joint - childEdge;
  }

  return origin;
}

/**
 * World cells of the joint between a room and the room it was placed against.
 *
 * Masonry, except where the passage is carved. Returned in dungeon coordinates
 * so the builder knows which cells are neither floor nor ordinary wall.
 */
export function jointCells(parentRoom, parentOpening) {
  const cells = [];
  const startX = parentRoom.origin.x + parentOpening.centerX;
  const startY = parentRoom.origin.y + parentOpening.centerY;
  for (let step = 1; step <= DUNGEON_CONFIG.wallGap; step += 1) {
    for (let offset = 0; offset < parentOpening.width; offset += 1) {
      if (parentOpening.side === "north") cells.push({ x: startX + offset, y: startY - step });
      else if (parentOpening.side === "south") cells.push({ x: startX + offset, y: startY + step });
      else if (parentOpening.side === "west") cells.push({ x: startX - step, y: startY + offset });
      else cells.push({ x: startX + step, y: startY + offset });
    }
  }
  return cells;
}

/**
 * The cells of an explicit bridge between two facing openings that are further
 * apart than the minimum joint.
 *
 * Returns null when the pair cannot be bridged: opposite sides, same width,
 * aligned axis, and a length within the configured maximum. Everything else
 * would need a corridor whose route has to be computed, which this engine
 * deliberately does not guess.
 */
export function bridgeCells(roomA, openingA, roomB, openingB) {
  if (openingA.side === openingB.side) return null;
  if (openingA.width !== openingB.width) return null;
  const opposite = { north: "south", south: "north", east: "west", west: "east" }[openingA.side];
  if (opposite !== openingB.side) return null;

  const a = { x: roomA.origin.x + openingA.centerX, y: roomA.origin.y + openingA.centerY };
  const b = { x: roomB.origin.x + openingB.centerX, y: roomB.origin.y + openingB.centerY };
  const vertical = openingA.side === "north" || openingA.side === "south";

  if (vertical ? a.x !== b.x : a.y !== b.y) return null;

  const span = vertical ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
  const minimum = DUNGEON_CONFIG.wallGap + 1;
  if (span < minimum) return null;
  if (span > minimum + DUNGEON_CONFIG.maxBridgeLength) return null;

  const cells = [];
  const step = vertical ? Math.sign(b.y - a.y) : Math.sign(b.x - a.x);
  for (let distance = 1; distance < span; distance += 1) {
    for (let offset = 0; offset < openingA.width; offset += 1) {
      if (vertical) {
        cells.push({ x: a.x + offset, y: a.y + step * distance });
      } else {
        cells.push({ x: a.x + step * distance, y: a.y + offset });
      }
    }
  }
  return { cells, length: span - 1 };
}
