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

/**
 * The two world cells that describe an opening: the first cell of its span, and
 * the cell of the wall it pierces.
 *
 * Two coordinates, two meanings, and they must never be swapped:
 *
 *   - `x`/`y` : **first cell of the span**, in world coordinates. This is where a
 *     corridor starts, because the corridor is as wide as the doorway.
 *   - `across` : the coordinate **across the wall** (y for a north or south face,
 *     x for a west or east one). It is constant along the corridor, and it is the
 *     only coordinate the two openings of a bridge must share.
 *
 * `alongX` says which axis the span runs on, so callers do not have to re-derive
 * the rule from `side`.
 */
export function doorwayStart(room, opening) {
  const span = openingSpan(opening);
  if (span.alongX) {
    return {
      x: room.origin.x + span.from,
      y: room.origin.y + span.across,
      across: room.origin.y + span.across,
      alongX: true,
    };
  }
  return {
    x: room.origin.x + span.across,
    y: room.origin.y + span.from,
    across: room.origin.x + span.across,
    alongX: false,
  };
}

/**
 * Where an opening's span sits, in room-local coordinates.
 *
 * An opening is described by two things that look redundant and are not:
 *
 *   - `offsetStart`/`offsetEnd`, the span **along the wall** (x on a north or
 *     south face, y on a west or east one);
 *   - `centerX`/`centerY`, the centre of that span — so on the axis of the span
 *     this is its **middle cell**, and on the axis across the wall it is the
 *     wall itself.
 *
 * Reading "the span" out of `centerX`/`centerY` is therefore right on one axis
 * and wrong on the other, and the same mistake in the other direction is just as
 * easy. This helper returns both axes explicitly, so no caller has to decide
 * which number means what:
 *
 *   across the wall (x for west/east faces) : `centerX` for a west/east face,
 *                                              `offsetStart` is y there — so the
 *                                              two are returned separately.
 *
 * `across` is the coordinate on the wall (the cell the doorway pierces);
 * `from` is the first cell of the span, which is the one a corridor must start
 * from, because the corridor is as wide as the doorway.
 */
export function openingSpan(opening) {
  const alongX = opening.side === "north" || opening.side === "south";
  return {
    alongX,
    from: opening.offsetStart,
    to: opening.offsetEnd,
    across: alongX ? opening.centerY : opening.centerX,
  };
}

/** The passage cells between two aligned openings, both room-local. */
export function passageCells(ownOpening, ownRoomOrigin, otherOpening, otherRoomOrigin) {
  // Both ends are read on the two axes explicitly: the corridor keeps the
  // doorway's width *along* the wall and runs *across* it. Reading both from the
  // same field put the corridor one cell beside the door.
  const vertical = ownOpening.side === "north" || ownOpening.side === "south";
  const ownSpan = openingSpan(ownOpening);
  const otherSpan = openingSpan(otherOpening);
  const own = {
    x: ownRoomOrigin.x + (vertical ? ownSpan.from : ownSpan.across),
    y: ownRoomOrigin.y + (vertical ? ownSpan.across : ownSpan.from),
  };
  const other = {
    x: otherRoomOrigin.x + (vertical ? otherSpan.from : otherSpan.across),
    y: otherRoomOrigin.y + (vertical ? otherSpan.across : otherSpan.from),
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
 * The cells two facing doorway spans share, in world coordinates on the axis
 * along the wall.
 *
 * Openings are described in their own room's frame, so two doorways that "face
 * each other" are compared in world coordinates: this is the only shared frame
 * they have. Returns `null` when they do not overlap at all.
 */
export function spanOverlap(roomA, openingA, roomB, openingB) {
  const spanA = openingSpan(openingA);
  const spanB = openingSpan(openingB);
  const a0 = (spanA.alongX ? roomA.origin.x : roomA.origin.y) + spanA.from;
  const a1 = (spanA.alongX ? roomA.origin.x : roomA.origin.y) + spanA.to;
  const b0 = (spanB.alongX ? roomB.origin.x : roomB.origin.y) + spanB.from;
  const b1 = (spanB.alongX ? roomB.origin.x : roomB.origin.y) + spanB.to;
  const from = Math.max(a0, b0);
  const to = Math.min(a1, b1);
  if (to < from) return null;
  return { from, to, length: to - from + 1, alongX: spanA.alongX };
}

/**
 * Narrows an opening to a world span, in place.
 *
 * A doorway that meets another one on a few cells must become exactly those
 * cells: otherwise the part of the doorway that is not in front of the corridor
 * opens onto masonry, and the player sees a hole with a wall behind it. Narrowing
 * keeps every derived value consistent — the centre moves with the span — so the
 * builder, the passage and the view all agree again.
 */
export function narrowOpening(room, opening, worldFrom, worldTo) {
  const span = openingSpan(opening);
  const origin = span.alongX ? room.origin.x : room.origin.y;
  opening.offsetStart = worldFrom - origin;
  opening.offsetEnd = worldTo - origin;
  opening.width = opening.offsetEnd - opening.offsetStart + 1;
  const middle = opening.offsetStart + Math.floor((opening.width - 1) / 2);
  if (span.alongX) opening.centerX = middle;
  else opening.centerY = middle;
  return opening;
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

  // The two doorways must share at least `minConnectionOverlap` cells. They do
  // *not* have to be centred on each other: with five-cell doorways that is a
  // coincidence, and requiring it is what silently stopped the network from
  // closing any loop.
  const overlap = spanOverlap(
    { origin: ownRoomOrigin }, ownOpening,
    { origin: otherRoomOrigin }, otherOpening,
  );
  if (!overlap || overlap.length < DUNGEON_CONFIG.minConnectionOverlap) return false;

  // Distance between the two room edges, not between the openings' centres: that
  // is what the joint is made of.
  const vertical = ownOpening.side === "north" || ownOpening.side === "south";
  if (vertical) {
    const ownEdge = ownRoomOrigin.y + (ownOpening.side === "north" ? 0 : ownMask.h - 1);
    const otherEdge = otherRoomOrigin.y + (otherOpening.side === "north" ? 0 : otherMask.h - 1);
    return Math.abs(otherEdge - ownEdge) - 1 === DUNGEON_CONFIG.wallGap;
  }
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
 *
 * `span` overrides where the corridor runs along the wall, **in the parent's
 * local coordinates** (`{ from, to }`). It exists because a connection is now
 * *planned* before it is committed: the planner has to know whether the corridor
 * is straight and clear before anything is narrowed, and it must be able to say
 * "the corridor is these cells" rather than read them back off an object it has
 * already mutated.
 */
export function jointCells(parentRoom, parentOpening, span = null) {
  const cells = [];
  // The joint starts at the **first cell of the doorway span**, not at its
  // centre. A one-cell doorway makes no difference between the two, which is why
  // the mistake went unnoticed until the doorways became three cells wide: the
  // carved corridor then sat one cell to the side of the door it was supposed to
  // continue, so a three-cell doorway had a one-cell tunnel in front of it —
  // exactly "the corridors are one block wide".
  const own = openingSpan(parentOpening);
  // Where the corridor runs, along the wall: the narrowed span when the caller
  // gives one, the doorway's own first cell otherwise.
  const from = span ? span.from : own.from;
  const width = span ? span.to - span.from + 1 : parentOpening.width;
  const acrossX = parentRoom.origin.x + (own.alongX ? 0 : own.across);
  const acrossY = parentRoom.origin.y + (own.alongX ? own.across : 0);
  for (let step = 1; step <= DUNGEON_CONFIG.wallGap; step += 1) {
    for (let offset = 0; offset < width; offset += 1) {
      const reach = from + offset;
      if (parentOpening.side === "north") cells.push({ x: parentRoom.origin.x + reach, y: acrossY - step });
      else if (parentOpening.side === "south") cells.push({ x: parentRoom.origin.x + reach, y: acrossY + step });
      else if (parentOpening.side === "west") cells.push({ x: acrossX - step, y: parentRoom.origin.y + reach });
      else cells.push({ x: acrossX + step, y: parentRoom.origin.y + reach });
    }
  }
  return cells;
}

/**
 * Everything a connection does to the world before it is committed.
 *
 * Returns `{ ok: false, code }` or the exact geometry: the straight corridor
 * (`joint` for a minimum joint, `bridge` for a longer one), the span both
 * doorways are narrowed to, and the width the corridor will have.
 *
 * This exists as one function because the checks and the mutations used to be
 * interleaved: `commitIfValid` narrowed both doorways *before* asking whether the
 * corridor was walkable, so a refusal could leave a doorway narrowed and no
 * connection to show for it — and the bridge itself was carved from the doorway
 * spans as they were *before* the narrowing, which is how a four-cell doorway
 * ended up with a five-cell corridor through it.
 *
 * Pure: nothing here mutates a room.
 */
export function planConnection(roomA, openingA, roomB, openingB, kind) {
  let joint = null;
  let bridge = null;

  // The two doorways must share at least `minConnectionOverlap` cells, and that
  // is the span the corridor will have: it is read once, here, and everything
  // else is derived from it.
  const overlap = spanOverlap(roomA, openingA, roomB, openingB);
  if (!overlap || overlap.length < DUNGEON_CONFIG.minConnectionOverlap) {
    return { ok: false, code: "NO_OVERLAP" };
  }
  if (kind === "direct" && !canConnectDirectly(openingA, roomA.origin, roomA.mask, openingB, roomB.origin, roomB.mask)) {
    return { ok: false, code: "NOT_DIRECT" };
  }
  if (kind !== "direct") {
    const built = bridgeCells(roomA, openingA, roomB, openingB);
    if (!built) return { ok: false, code: "NO_BRIDGE" };
    bridge = built.cells;
  }
  if (kind === "direct") {
    // The planner speaks world coordinates; `jointCells` speaks the parent's. The
    // conversion happens here, once, so no caller has to remember which frame a
    // span is in — reading a world span as a local one draws the joint one origin
    // away from the doorway, which is the same class of mistake as the corridor
    // that used to sit beside its door.
    const span = openingSpan(openingA);
    const origin = span.alongX ? roomA.origin.x : roomA.origin.y;
    joint = jointCells(roomA, openingA, { from: overlap.from - origin, to: overlap.to - origin });
  }

  // The corridor runs along `overlap` whatever the kind: a bridge is carved
  // through the same shared span, so both are exactly as wide as the hole they
  // join and neither can be wider than the other.
  const width = overlap.length;
  const cells = joint || bridge;
  if (!cells || cells.length === 0) return { ok: false, code: "EMPTY" };

  // Straight, and no wider than the doorway: one row of cells across the gap, and
  // every cell of that row present. A corridor that is missing a cell is a
  // corridor with a wall in it; a corridor with two rows is a room.
  const vertical = openingA.side === "north" || openingA.side === "south";
  const rows = new Set();
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    rows.add(vertical ? cell.x : cell.y);
  }
  if (rows.size !== width) return { ok: false, code: "NOT_STRAIGHT", rows: rows.size, width };
  const span = Math.abs(
    (vertical ? cells[0].y : cells[0].x) - (vertical ? cells[cells.length - 1].y : cells[cells.length - 1].x),
  );
  if (cells.length !== (span + 1) * width) return { ok: false, code: "GAP" };

  return {
    ok: true,
    kind: kind === "direct" ? "direct" : "bridge",
    joint: joint || [],
    bridge: bridge || [],
    overlap,
    width,
  };
}

/**
 * The cells of an explicit bridge between two facing openings that are further
 * apart than the minimum joint.
 *
 * Returns null when the pair cannot be bridged: opposite sides, aligned axis, a
 * shared span of at least `minConnectionOverlap`, and a length within the
 * configured maximum. Everything else would need a corridor whose route has to be
 * computed, which this engine deliberately does not guess.
 */
export function bridgeCells(roomA, openingA, roomB, openingB) {
  if (openingA.side === openingB.side) return null;
  const opposite = { north: "south", south: "north", east: "west", west: "east" }[openingA.side];
  if (opposite !== openingB.side) return null;

  // Two doorways that face each other must share at least a few cells; they do
  // not have to line up cell for cell. Requiring that was the same mistake as
  // requiring identical centres, and it is what removed every bridge — and so
  // every shortcut — once the doorways became wide.
  const overlap = spanOverlap(roomA, openingA, roomB, openingB);
  if (!overlap || overlap.length < DUNGEON_CONFIG.minConnectionOverlap) return null;
  if (overlap.length !== Math.min(openingA.width, openingB.width) && overlap.length < DUNGEON_CONFIG.minConnectionOverlap) {
    return null;
  }

  const vertical = openingA.side === "north" || openingA.side === "south";
  const a = doorwayStart(roomA, openingA);
  const b = doorwayStart(roomB, openingB);
  const span = Math.abs(b.across - a.across);
  const minimum = DUNGEON_CONFIG.wallGap + 1;
  if (span < minimum) return null;
  if (span > minimum + DUNGEON_CONFIG.maxBridgeLength) return null;

  // A third room standing in the corridor is refused by the manager, which is the
  // only place that can ask the index; a direct connection needs no such test,
  // because `wallGap` cells between two walls leave no room for another room
  // between them. What can still go wrong there is a room arriving *later* on the
  // corridor's flank — that is `CORRIDOR_BLOCKED` in the validator's job, and it
  // is checked on every candidate.
  const cells = [];
  const step = Math.sign(b.across - a.across);
  for (let distance = 1; distance < span; distance += 1) {
    for (let along = overlap.from; along <= overlap.to; along += 1) {
      if (vertical) cells.push({ x: along, y: a.across + step * distance });
      else cells.push({ x: a.across + step * distance, y: along });
    }
  }
  return { cells, length: span - 1, overlap };
}
