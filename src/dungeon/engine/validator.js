/*
 * Geometric validation of a candidate room.
 *
 * The validator is a pure function: it reads the candidate and the rooms the
 * index returned, and it writes nothing. A refusal is a result, not an
 * exception, and it always carries a code so the diagnostic tool can explain
 * why a branch stopped growing.
 *
 * Collisions are tested on real cells, never on bounding boxes: two L-shaped
 * rooms whose boxes overlap but whose cells do not must be accepted, and two
 * rooms one cell apart must be refused.
 */

import { DUNGEON_CONFIG } from "./config.js";
import {
  bounds,
  cellAt,
  contourCells,
  masksOverlap,
  walkablePath,
} from "./geometry.js";
import { OPENING_STATUS, passageCells } from "./openings.js";

export const REFUSAL = {
  OUT_OF_BOUNDS: "OUT_OF_BOUNDS",
  NO_OPENING: "NO_OPENING",
  OPENING_NOT_ON_CONTOUR: "OPENING_NOT_ON_CONTOUR",
  OPENING_IN_CORNER: "OPENING_IN_CORNER",
  OPENING_TOO_CLOSE: "OPENING_TOO_CLOSE",
  OPENING_NO_APPROACH: "OPENING_NO_APPROACH",
  COLLISION_CELL: "COLLISION_CELL",
  NO_CLEARANCE: "NO_CLEARANCE",
  CORRIDOR_BLOCKED: "CORRIDOR_BLOCKED",
  DOOR_MISMATCH: "DOOR_MISMATCH",
  NO_WALKABLE_PATH: "NO_WALKABLE_PATH",
  ROOM_DISCONNECTED: "ROOM_DISCONNECTED",
};

function refuse(code, detail) {
  return { ok: false, code, detail: detail || null };
}

/**
 * Cell overlap between the candidate and every nearby room.
 *
 * `joint` describes the cells that are legitimately shared with the parent:
 * the passage punch. Those cells are exempt from the margin, which is the only
 * way a safety margin can coexist with direct connections.
 */
function findCollision(rooms, candidate, joint) {
  for (let index = 0; index < rooms.length; index += 1) {
    const other = rooms[index];
    const overlap = masksOverlap(
      candidate.mask,
      candidate.origin,
      other.mask,
      other.origin,
      DUNGEON_CONFIG.structureMargin,
    );
    if (!overlap) continue;
    // Wall gap already keeps the interiors apart; `structureMargin` adds on top
    // of it. Any overlap left is a real geometric conflict.
    return { roomId: other.id, at: overlap };
  }
  return null;
}

/** Do the candidate's own openings stay reachable from each other on foot? */
function openingsReachable(mask, openings, clearances) {
  if (openings.length < 2) return true;
  const anchors = openings.map((opening) => {
    // The cell behind the doorway is the reference: that is where the player
    // will stand after walking through.
    const x = opening.centerX - opening.vectorX;
    const y = opening.centerY - opening.vectorY;
    return { x, y };
  });
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (clearances[anchor.y] === undefined) return false;
    if (!cellAt(mask, anchor.x, anchor.y)) return false;
    // Clearance 1 is a cell the builder walls, so it is not a place to stand.
    if (clearances[anchor.y][anchor.x] <= DUNGEON_CONFIG.minApproachDepth) return false;
  }
  for (let index = 1; index < anchors.length; index += 1) {
    const path = walkablePath(mask, anchors[0], anchors[index], DUNGEON_CONFIG.minApproachDepth + 1);
    if (!path) return false;
  }
  return true;
}

/**
 * The first doorway of the candidate that looks straight into a neighbouring room.
 *
 * The test is symmetric on purpose: the candidate's own spans are checked against
 * the rooms already placed, *and* every doorway of those rooms is checked against
 * the candidate. A corridor committed earlier runs through the cells just outside
 * its doorway, and nothing else in the engine re-reads them — so the arriving room
 * is the last moment at which the collision can be seen at all.
 */
function blockedCorridor(corridors, candidate) {
  if (!corridors || corridors.size === 0) return null;
  const mask = candidate.mask;
  for (let localY = 0; localY < mask.h; localY += 1) {
    for (let localX = 0; localX < mask.w; localX += 1) {
      if (!mask.cells[localY][localX]) continue;
      const key = `${candidate.origin.x + localX},${candidate.origin.y + localY}`;
      if (corridors.has(key)) return { x: candidate.origin.x + localX, y: candidate.origin.y + localY };
    }
  }
  return null;
}

/** Every opening must sit on the real contour, not on a hole left by a bite. */
function openingsOnContour(mask, openings) {
  const contour = new Set(contourCells(mask).map((cell) => `${cell.x},${cell.y}`));
  for (let index = 0; index < openings.length; index += 1) {
    const opening = openings[index];
    // An opening is a span of the face, not a point: every cell it pierces must
    // be on the real contour, otherwise the doorway would open into a hole.
    if (openingCells(mask, opening).some((cell) => !contour.has(`${cell.x},${cell.y}`))) {
      return opening.id;
    }
  }
  return null;
}

/** Every cell of the room's own face that an opening pierces. */
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

/**
 * Validates a candidate room.
 *
 * `input.candidate`  : { mask, origin, openings }
 * `input.nearby`     : rooms from the spatial index (real cell test follows)
 * `input.parent`     : { room, opening } the child hangs from, or null
 * `input.childOpening`: the candidate's opening that faces the parent
 * `input.radius`     : maximum distance from the dungeon origin
 * `input.clearances` : precomputed clearance map of the candidate, optional
 */
export function validateRoom(input) {
  const { candidate, nearby, parent, childOpening } = input;
  const mask = candidate.mask;
  const origin = candidate.origin;
  const radius = input.radius === undefined ? DUNGEON_CONFIG.maxDungeonRadius : input.radius;
  const clearances = input.clearances || null;

  if (!candidate.openings || candidate.openings.length === 0) {
    return refuse(REFUSAL.NO_OPENING);
  }

  // 1. The dungeon must stay inside its allocated region.
  const box = bounds(mask);
  const minX = origin.x + box.x1;
  const minY = origin.y + box.y1;
  const maxX = origin.x + box.x2;
  const maxY = origin.y + box.y2;
  if (Math.abs(minX) > radius || Math.abs(maxX) > radius
    || Math.abs(minY) > radius || Math.abs(maxY) > radius) {
    return refuse(REFUSAL.OUT_OF_BOUNDS, { minX, maxX, minY, maxY, radius });
  }

  // 2. Openings must be on the contour and far enough from corners.
  const offContour = openingsOnContour(mask, candidate.openings);
  if (offContour) return refuse(REFUSAL.OPENING_NOT_ON_CONTOUR, { openingId: offContour });

  for (let index = 0; index < candidate.openings.length; index += 1) {
    const opening = candidate.openings[index];
    if (opening.offsetStart < DUNGEON_CONFIG.minCornerClearance) {
      return refuse(REFUSAL.OPENING_IN_CORNER, { openingId: opening.id });
    }
    const faceLength = opening.side === "north" || opening.side === "south" ? mask.w : mask.h;
    if (opening.offsetEnd > faceLength - 1 - DUNGEON_CONFIG.minCornerClearance) {
      return refuse(REFUSAL.OPENING_IN_CORNER, { openingId: opening.id });
    }
    // The cell straight behind the doorway must be part of the room.
    const behindX = opening.centerX - opening.vectorX;
    const behindY = opening.centerY - opening.vectorY;
    if (!cellAt(mask, behindX, behindY)) {
      return refuse(REFUSAL.OPENING_NO_APPROACH, { openingId: opening.id });
    }
  }

  // 3. Real cell collisions against the rooms the index returned.
  const joint = parent ? { parentRoom: parent.room, parentOpening: parent.opening } : null;
  const collision = findCollision(nearby, candidate, joint);
  if (collision) return refuse(REFUSAL.COLLISION_CELL, collision);

  // 4. A clearance band narrower than the structure margin is a wall the
  //    builder cannot place between two rooms; that is a refusal, not a fixup.
  if (DUNGEON_CONFIG.structureMargin > 0) {
    for (let index = 0; index < nearby.length; index += 1) {
      const other = nearby[index];
      const gap = cellGap(mask, origin, other.mask, other.origin);
      if (gap !== null && gap > 0 && gap < DUNGEON_CONFIG.structureMargin) {
        return refuse(REFUSAL.NO_CLEARANCE, { roomId: other.id, gap });
      }
    }
  }

  // 5. The child opening must line up with its parent opening.
  if (parent && childOpening) {
    const aligned = parent.opening.width === childOpening.width
      && parent.opening.side !== childOpening.side;
    if (!aligned) return refuse(REFUSAL.DOOR_MISMATCH, { openingId: childOpening.id });
  }

  // 5 bis. No room may land on a corridor that is already committed.
  //
  // Deliberately narrow. A room's own *pending* doorway that happens to look at a
  // neighbour is not a conflict: the builder walls a doorway that leads nowhere, so
  // it costs a wasted door and nothing else, and refusing those cost a third of
  // the loops. A committed corridor is different — it is the only way through to
  // the rooms it joins, nothing re-reads it, and a room arriving on top of it seals
  // a branch that was already walkable. Measured with the broad size ladder, 60
  // rooms out of 750 were cut off that way.
  const blocked = blockedCorridor(input.corridors, candidate);
  if (blocked) return refuse(REFUSAL.CORRIDOR_BLOCKED, blocked);

  // 6. Every opening of the room must be reachable from the others on foot.
  if (clearances && !openingsReachable(mask, candidate.openings, clearances)) {
    return refuse(REFUSAL.ROOM_DISCONNECTED);
  }

  return { ok: true };
}

/**
 * Smallest number of empty cells between the two shapes, along their facing
 * axis, or null when they do not face each other. Only used for the clearance
 * diagnostic: the collision test above is the authority.
 */
function cellGap(maskA, originA, maskB, originB) {
  const a = {
    x1: originA.x, y1: originA.y, x2: originA.x + maskA.w - 1, y2: originA.y + maskA.h - 1,
  };
  const b = {
    x1: originB.x, y1: originB.y, x2: originB.x + maskB.w - 1, y2: originB.y + maskB.h - 1,
  };
  const gapX = Math.max(b.x1 - a.x2 - 1, a.x1 - b.x2 - 1);
  const gapY = Math.max(b.y1 - a.y2 - 1, a.y1 - b.y2 - 1);
  if (gapX >= 0 && gapY >= 0) return Math.min(gapX, gapY);
  if (gapX >= 0) return gapX;
  if (gapY >= 0) return gapY;
  return null;
}

/**
 * Is the passage between two facing openings physically walkable?
 *
 * The logical connection is not enough: the passage must be a real corridor of
 * walkable cells from inside one room to inside the other. This is the check
 * the specification calls "une connexion logique ne suffit pas".
 */
export function passageIsWalkable(parentRoom, parentOpening, childRoom, childOpening) {
  // The carved passage belongs to neither room: it is stamped into the merged
  // mask explicitly, otherwise the walk would have to jump from wall to wall.
  const passage = passageCells(parentOpening, parentRoom.origin, childOpening, childRoom.origin);
  const mask = mergeMasks(parentRoom, childRoom, passage);
  if (!mask) return false;
  const from = {
    x: parentRoom.origin.x + parentOpening.centerX - parentOpening.vectorX - mask.origin.x,
    y: parentRoom.origin.y + parentOpening.centerY - parentOpening.vectorY - mask.origin.y,
  };
  const to = {
    x: childRoom.origin.x + childOpening.centerX - childOpening.vectorX - mask.origin.x,
    y: childRoom.origin.y + childOpening.centerY - childOpening.vectorY - mask.origin.y,
  };
  // Clearance 0: the passage cells are carved, not part of a room mask, so they
  // must be allowed here. The passage rectangle is added by mergeMasks.
  return walkablePath(mask.mask, from, to, 0) !== null;
}

/**
 * The two rooms plus the passage cells between them, in one mask, so a path can
 * be searched across the boundary.
 */
export function mergeMasks(roomA, roomB, passage = []) {
  const minX = Math.min(roomA.origin.x, roomB.origin.x);
  const minY = Math.min(roomA.origin.y, roomB.origin.y);
  const maxX = Math.max(roomA.origin.x + roomA.mask.w - 1, roomB.origin.x + roomB.mask.w - 1);
  const maxY = Math.max(roomA.origin.y + roomA.mask.h - 1, roomB.origin.y + roomB.mask.h - 1);
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const cells = [];
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) row.push(0);
    cells.push(row);
  }
  stamp(roomA, minX, minY, cells);
  stamp(roomB, minX, minY, cells);
  for (let index = 0; index < passage.length; index += 1) {
    const cell = passage[index];
    const y = cell.y - minY;
    const x = cell.x - minX;
    if (cells[y] && cells[y][x] !== undefined) cells[y][x] = 1;
  }
  return { mask: { w: width, h: height, cells }, origin: { x: minX, y: minY } };
}

function stamp(room, offsetX, offsetY, cells) {
  for (let y = 0; y < room.mask.h; y += 1) {
    for (let x = 0; x < room.mask.w; x += 1) {
      if (!room.mask.cells[y][x]) continue;
      const targetY = room.origin.y - offsetY + y;
      const targetX = room.origin.x - offsetX + x;
      if (cells[targetY] === undefined) continue;
      cells[targetY][targetX] = 1;
    }
  }
}

/** A room is only usable if at least two of its openings can still be used. */
export function usableOpenings(room) {
  return (room.openings || []).filter(
    (opening) => opening.status === OPENING_STATUS.PENDING || opening.status === OPENING_STATUS.RESERVED,
  );
}
