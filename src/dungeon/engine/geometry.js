/*
 * Cell geometry: masks, clearances, contours and distances.
 *
 * A shape is an independent logical object. It never mentions a block name or
 * a world coordinate: `{ w, h, cells }` where `cells[y][x]` is 1 inside the
 * room and 0 outside, y being the depth axis and x the width axis.
 *
 * Everything here is integer arithmetic on small grids. No `api`, no world
 * access, so every function is testable outside Bloxd.
 */

import { DUNGEON_CONFIG } from "./config.js";

// ------------------------------------------------------------------ masks --

export function createMask(width, height) {
  const cells = [];
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) row.push(0);
    cells.push(row);
  }
  return { w: width, h: height, cells };
}

export function fillRect(mask, x1, y1, x2, y2, value = 1) {
  const minX = Math.max(0, Math.min(x1, x2));
  const maxX = Math.min(mask.w - 1, Math.max(x1, x2));
  const minY = Math.max(0, Math.min(y1, y2));
  const maxY = Math.min(mask.h - 1, Math.max(y1, y2));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) mask.cells[y][x] = value;
  }
  return mask;
}

export function cloneMask(mask) {
  const copy = createMask(mask.w, mask.h);
  for (let y = 0; y < mask.h; y += 1) {
    for (let x = 0; x < mask.w; x += 1) copy.cells[y][x] = mask.cells[y][x];
  }
  return copy;
}

/** 0 outside the grid, so callers never index out of bounds by accident. */
export function cellAt(mask, x, y) {
  if (x < 0 || y < 0 || x >= mask.w || y >= mask.h) return 0;
  return mask.cells[y][x];
}

export function setCell(mask, x, y, value) {
  if (x < 0 || y < 0 || x >= mask.w || y >= mask.h) return;
  mask.cells[y][x] = value ? 1 : 0;
}

/** Compact, stable text form: one string per row. Used by tests and tools. */
export function toRows(mask) {
  const rows = [];
  for (let y = 0; y < mask.h; y += 1) rows.push(mask.cells[y].join(""));
  return rows;
}

export function fromRows(rows) {
  const height = rows.length;
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const mask = createMask(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) mask.cells[y][x] = rows[y][x] === "1" ? 1 : 0;
  }
  return mask;
}

export function countCells(mask) {
  let total = 0;
  for (let y = 0; y < mask.h; y += 1) {
    const row = mask.cells[y];
    for (let x = 0; x < mask.w; x += 1) total += row[x];
  }
  return total;
}

/** Inclusive occupied bounds, or null for an empty mask. */
export function bounds(mask) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < mask.h; y += 1) {
    for (let x = 0; x < mask.w; x += 1) {
      if (!mask.cells[y][x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (minX === Infinity) return null;
  return { x1: minX, y1: minY, x2: maxX, y2: maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Shifts the shape so its occupied bounds start at (0, 0) and trims the empty
 * border. A shape is therefore described by its own size, not by the padding
 * that happened to surround it.
 */
export function normalizeMask(mask) {
  const box = bounds(mask);
  if (!box) return createMask(1, 1);
  const result = createMask(box.w, box.h);
  for (let y = 0; y < box.h; y += 1) {
    for (let x = 0; x < box.w; x += 1) {
      result.cells[y][x] = mask.cells[box.y1 + y][box.x1 + x];
    }
  }
  return result;
}

/** Mirrors and rotations of a shape, all exact and dependency free. */
export function rotate90(mask) {
  const result = createMask(mask.h, mask.w);
  for (let y = 0; y < mask.h; y += 1) {
    for (let x = 0; x < mask.w; x += 1) {
      result.cells[x][mask.h - 1 - y] = mask.cells[y][x];
    }
  }
  return result;
}

export function mirrorX(mask) {
  const result = createMask(mask.w, mask.h);
  for (let y = 0; y < mask.h; y += 1) {
    for (let x = 0; x < mask.w; x += 1) result.cells[y][mask.w - 1 - x] = mask.cells[y][x];
  }
  return result;
}

/** A short stable signature, used to reject duplicate shapes. */
export function shapeKey(mask) {
  return `${mask.w}x${mask.h}:${toRows(mask).join("/")}`;
}

// ------------------------------------------------------------ connectivity --

const FOUR_WAY = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * True when every occupied cell is reachable from every other one through
 * occupied cells. A shape made of two detached pieces is never a room.
 */
export function isConnected(mask) {
  const box = bounds(mask);
  if (!box) return false;
  const total = countCells(mask);
  let first = null;
  for (let y = 0; y < mask.h && !first; y += 1) {
    for (let x = 0; x < mask.w && !first; x += 1) {
      if (mask.cells[y][x]) first = { x, y };
    }
  }
  if (!first) return false;

  const seen = new Uint8Array(mask.w * mask.h);
  const queue = [first];
  seen[first.y * mask.w + first.x] = 1;
  let reached = 0;
  while (queue.length > 0) {
    const current = queue.pop();
    reached += 1;
    for (let index = 0; index < FOUR_WAY.length; index += 1) {
      const nx = current.x + FOUR_WAY[index][0];
      const ny = current.y + FOUR_WAY[index][1];
      if (nx < 0 || ny < 0 || nx >= mask.w || ny >= mask.h) continue;
      const flat = ny * mask.w + nx;
      if (seen[flat] || !mask.cells[ny][nx]) continue;
      seen[flat] = 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return reached === total;
}

/**
 * Fills empty cells that are enclosed on all four sides.
 *
 * A single empty cell inside a room is a hole, not a room feature: it would be
 * built as a one-cell pillar standing in the middle of the floor. Sealing them
 * keeps every irregular shape readable as a chamber.
 */
export function sealHoles(mask) {
  const toFill = [];
  for (let y = 0; y < mask.h; y += 1) {
    for (let x = 0; x < mask.w; x += 1) {
      if (mask.cells[y][x]) continue;
      if (cellAt(mask, x + 1, y) && cellAt(mask, x - 1, y)
        && cellAt(mask, x, y + 1) && cellAt(mask, x, y - 1)) {
        toFill.push({ x, y });
      }
    }
  }
  for (let index = 0; index < toFill.length; index += 1) {
    mask.cells[toFill[index].y][toFill[index].x] = 1;
  }
  return mask;
}

/**
 * Chebyshev distance from each occupied cell to the nearest empty cell.
 *
 * clearances[y][x] is 0 outside the shape. An interior cell whose whole 3x3
 * neighbourhood is occupied reads 2, and so on. This single transform gives
 * both the contour and the "is this cell too close to a wall to be walked on"
 * answer, which is why it is used everywhere instead of ad-hoc neighbour
 * counting.
 */
export function clearanceMap(mask) {
  const width = mask.w;
  const height = mask.h;
  const distance = [];
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      if (!mask.cells[y][x]) {
        row.push(0);
        continue;
      }
      // A cell on the grid border has an out-of-grid neighbour, which counts
      // as empty: the shape edge is a wall.
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        row.push(1);
        continue;
      }
      row.push(LARGE_DISTANCE);
    }
    distance.push(row);
  }

  const relax = (x, y, from) => {
    if (!mask.cells[y][x]) return;
    let best = distance[y][x];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!mask.cells[ny][nx]) {
          if (from < 0 || true) best = Math.min(best, 1);
          continue;
        }
        const candidate = distance[ny][nx] + 1;
        if (candidate < best) best = candidate;
      }
    }
    distance[y][x] = best;
  };

  // Two sweeps, the usual chamfer approximation for a Chebyshev transform.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) relax(x, y, -1);
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) relax(x, y, 1);
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) relax(x, y, 0);
  }
  return distance;
}

const LARGE_DISTANCE = 1000000;

/** Occupied cells that touch the outside: the inner face of the wall. */
export function contourCells(mask) {
  const cells = [];
  for (let y = 0; y < mask.h; y += 1) {
    for (let x = 0; x < mask.w; x += 1) {
      if (!mask.cells[y][x]) continue;
      let exposed = false;
      for (let index = 0; index < FOUR_WAY.length && !exposed; index += 1) {
        if (!cellAt(mask, x + FOUR_WAY[index][0], y + FOUR_WAY[index][1])) exposed = true;
      }
      if (exposed) cells.push({ x, y });
    }
  }
  return cells;
}

/** Empty cells touching the shape: where the masonry goes. */
export function exteriorCells(mask, thickness = 1) {
  const width = mask.w + thickness * 2;
  const height = mask.h + thickness * 2;
  const result = [];
  for (let y = -thickness; y < mask.h + thickness; y += 1) {
    for (let x = -thickness; x < mask.w + thickness; x += 1) {
      if (cellAt(mask, x, y)) continue;
      let touching = false;
      for (let dy = -thickness; dy <= thickness && !touching; dy += 1) {
        for (let dx = -thickness; dx <= thickness && !touching; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          if (cellAt(mask, x + dx, y + dy)) touching = true;
        }
      }
      if (touching) result.push({ x, y });
    }
  }
  void width;
  void height;
  return result;
}

/**
 * Bounding box of a mask grown by `margin` cells, in its own coordinates.
 * Used by the spatial index, never as a collision test on its own.
 */
export function grownBounds(mask, margin) {
  const box = bounds(mask);
  if (!box) return null;
  return {
    x1: box.x1 - margin,
    y1: box.y1 - margin,
    x2: box.x2 + margin,
    y2: box.y2 + margin,
  };
}

/**
 * Real cell overlap between two shapes, each placed by an offset.
 *
 * This is the test that replaces "do the bounding boxes overlap": two L-shaped
 * rooms can have overlapping boxes and no shared cell, and that must be
 * accepted. The margin is applied on the *other* shape only, so the two
 * offsets stay meaningful.
 */
export function masksOverlap(maskA, atA, maskB, atB, margin = 0) {
  const aMinX = atA.x - margin;
  const aMinY = atA.y - margin;
  const aMaxX = atA.x + maskA.w - 1 + margin;
  const aMaxY = atA.y + maskA.h - 1 + margin;
  const bMinX = atB.x;
  const bMinY = atB.y;
  const bMaxX = atB.x + maskB.w - 1;
  const bMaxY = atB.y + maskB.h - 1;

  const minX = Math.max(aMinX, bMinX);
  const maxX = Math.min(aMaxX, bMaxX);
  const minY = Math.max(aMinY, bMinY);
  const maxY = Math.min(aMaxY, bMaxY);
  if (minX > maxX || minY > maxY) return null;

  for (let y = minY; y <= maxY; y += 1) {
    const ay = y - atA.y;
    const by = y - atB.y;
    for (let x = minX; x <= maxX; x += 1) {
      const ax = x - atA.x;
      const bx = x - atB.x;
      const aInside = cellAt(maskA, ax, ay) === 1;
      const bInside = cellAt(maskB, bx, by) === 1;
      if (!aInside && !bInside) continue;
      // With a margin, a cell of A within `margin` of B's cells collides, and
      // vice versa. Both directions are needed: the margin is symmetric.
      if (aInside && bInside) return { x, y };
      if (margin > 0) {
        if (aInside && nearMask(maskB, bx, by, margin)) return { x, y };
        if (bInside && nearMask(maskA, ax, ay, margin)) return { x, y };
      }
    }
  }
  return null;
}

function nearMask(mask, x, y, radius) {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (cellAt(mask, x + dx, y + dy)) return true;
    }
  }
  return false;
}

/**
 * Breadth-first search on walkable cells.
 *
 * Walkable means occupied and far enough from the outer edge that a player's
 * body fits: clearance >= minClearance. `minClearance` of 1 keeps the path off
 * the wall line, which is what makes the result physically plausible instead
 * of a diagonal slip through a one-cell gap.
 */
export function walkablePath(mask, from, to, minClearance = 1, blocked = null) {
  if (!from || !to) return null;
  const clearances = clearanceMap(mask);
  const passable = (x, y) => {
    if (!cellAt(mask, x, y)) return false;
    if (blocked && blocked(x, y)) return false;
    return clearances[y][x] >= minClearance;
  };
  if (!passable(to.x, to.y)) return null;

  const start = { x: from.x, y: from.y };
  const width = mask.w;
  const previous = new Int32Array(mask.w * mask.h);
  for (let index = 0; index < previous.length; index += 1) previous[index] = -2;
  const startFlat = start.y * width + start.x;
  previous[startFlat] = -1;
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current.x === to.x && current.y === to.y) {
      const path = [];
      let flat = current.y * width + current.x;
      while (flat !== -1) {
        path.push({ x: flat % width, y: Math.floor(flat / width) });
        flat = previous[flat];
      }
      return path.reverse();
    }
    for (let index = 0; index < FOUR_WAY.length; index += 1) {
      const nx = current.x + FOUR_WAY[index][0];
      const ny = current.y + FOUR_WAY[index][1];
      if (nx < 0 || ny < 0 || nx >= mask.w || ny >= mask.h) continue;
      const flat = ny * width + nx;
      if (previous[flat] !== -2) continue;
      if (!passable(nx, ny)) continue;
      previous[flat] = current.y * width + current.x;
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

/** How many cells are reachable from `origin` while walking. Diagnostics. */
export function reachableCells(mask, origin, minClearance = 1) {
  const clearances = clearanceMap(mask);
  const seen = new Uint8Array(mask.w * mask.h);
  if (!origin || !cellAt(mask, origin.x, origin.y)) return 0;
  if (clearances[origin.y][origin.x] < minClearance) return 0;
  const queue = [origin];
  seen[origin.y * mask.w + origin.x] = 1;
  let count = 0;
  while (queue.length > 0) {
    const current = queue.pop();
    count += 1;
    for (let index = 0; index < FOUR_WAY.length; index += 1) {
      const nx = current.x + FOUR_WAY[index][0];
      const ny = current.y + FOUR_WAY[index][1];
      if (nx < 0 || ny < 0 || nx >= mask.w || ny >= mask.h) continue;
      const flat = ny * mask.w + nx;
      if (seen[flat]) continue;
      if (!cellAt(mask, nx, ny)) continue;
      if (clearances[ny][nx] < minClearance) continue;
      seen[flat] = 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return count;
}

// ------------------------------------------------------------- world space --

const SIDE_VECTOR = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

export const SIDES = ["north", "east", "south", "west"];

export function sideVector(side) {
  return SIDE_VECTOR[side];
}

export function oppositeSide(side) {
  return { north: "south", south: "north", east: "west", west: "east" }[side];
}

/** Single place where a logical coordinate becomes a world coordinate. */
export function logicalToWorld(origin, cell, floorLevel = 0) {
  const size = DUNGEON_CONFIG.cellSize;
  return {
    x: origin.x + cell.x * size,
    y: origin.y + floorLevel * (DUNGEON_CONFIG.wallHeight + 2),
    z: origin.z + cell.y * size,
  };
}

export function worldToLogical(origin, position) {
  const size = DUNGEON_CONFIG.cellSize;
  return {
    x: Math.floor((position.x - origin.x) / size),
    y: Math.floor((position.z - origin.z) / size),
  };
}

/** Room-local coordinate: 0..w-1 and 0..h-1, independent of the dungeon. */
export function logicalToLocal(roomOrigin, cell) {
  return { x: cell.x - roomOrigin.x, y: cell.y - roomOrigin.y };
}

export function localToLogical(roomOrigin, local) {
  return { x: roomOrigin.x + local.x, y: roomOrigin.y + local.y };
}
