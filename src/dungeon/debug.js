/*
 * Debug: what the player is standing in, said in one message.
 *
 * The bug reports this file exists for are the ones a screenshot cannot carry —
 * "the corridor is weird here" is only actionable if the seed, the room, the
 * doorway and the cell are known together. So this module answers, for one
 * position: which dungeon, which room, which doorway or corridor, which block,
 * how the room was built, and which rooms are its neighbours.
 *
 * It is deliberately **pure and separate from the world**: it reads a manager
 * and a position and returns a report object, so every number it prints can be
 * tested in Node. The game-side plumbing (chat commands, chat lines) lives in
 * `src/worldCode.js`, next to the only code that knows about `api`.
 *
 * Nothing here writes a block, and nothing here is on the tick path: a report is
 * built when a player asks for one, never per tick.
 */

import { DUNGEON_CONFIG } from "./engine/config.js";
import { OPENING_STATUS, doorwayStart, openingSpan } from "./engine/openings.js";
import { locatePlayerRoom } from "./engine/discovery.js";

/**
 * Tolerance, in cells, for "the player is on this corridor".
 *
 * A report is written from a position the player *reports*, which is the middle
 * of a cell (`x.5`), and a corridor is a band of cells five wide: half a cell of
 * slack is what makes "I am standing in the corridor" true while the player is
 * still in it. Beyond that, `corridor.distance` says how far the nearest
 * corridor is, so a screenshot taken from a room still points somewhere.
 */
const CORRIDOR_TOLERANCE = 0.75;

/** One cell, keyed the way the manager keys its corridors. */
const cellKey = (x, y) => `${x},${y}`;

/**
 * One point, on the two axes the geometry uses.
 *
 * The world speaks `(x, y, z)` and the dungeon's plan speaks `(x, y)`: a cell is
 * `x` across and `y` *along the ground*, which is the world's `z`. In a world
 * position `y` is the altitude — a dungeon floor sits at a thousand blocks down —
 * so reading it as the ground axis puts every report a kilometre from the
 * dungeon. `z` is therefore authoritative whenever it is present, and `y` is the
 * ground axis only on a plan point (`{ x, y }`, what `locatePlayerRoom` takes).
 */
function toPlanPoint(point) {
  return {
    x: point.x,
    y: point.z === undefined || point.z === null ? point.y : point.z,
    z: point.z,
  };
}

/**
 * The corridor a position stands in, or the nearest one.
 *
 * Corridors are the cells stored on each connection: `joint` for a minimum joint
 * (the fifteen cells of masonry between two walls) and `bridge` for a carved
 * passage. Both are exact, because the manager stores what it committed — this
 * function never guesses a corridor from the shape of the gap.
 */
export function findCorridor(manager, pointRef) {
  const point = toPlanPoint(pointRef);
  let best = null;
  const connections = manager.allConnections();
  for (let at = 0; at < connections.length; at += 1) {
    const connection = connections[at];
    const lists = [connection.joint, connection.bridge];
    for (let list = 0; list < lists.length; list += 1) {
      const cells = lists[list] || [];
      for (let index = 0; index < cells.length; index += 1) {
        const cell = cells[index];
        // Distance to the cell's own square, not to its centre: a player at the
        // edge of a corridor is still in the corridor. The square runs from
        // `cell` to `cell + 1`, so a point at `x.5` is 0 cells away from it.
        const dx = Math.max(cell.x - point.x, 0, point.x - (cell.x + 1));
        const dy = Math.max(cell.y - point.y, 0, point.y - (cell.y + 1));
        const distance = Math.max(dx, dy);
        if (!best || distance < best.distance) {
          best = {
            distance,
            connectionId: connection.id,
            kind: connection.kind,
            width: connection.width,
            cells: cells.length,
            role: list === 0 ? "joint" : "bridge",
            from: connection.a.roomId,
            to: connection.b.roomId,
            cell: { x: cell.x, z: cell.y },
          };
        }
        if (distance === 0) break;
      }
    }
  }
  if (!best) return null;
  return { ...best, onCorridor: best.distance <= CORRIDOR_TOLERANCE };
}

/**
 * The doorway a position is standing in, on its room's own face.
 *
 * A doorway is only **one** cell thick on the room's face, and that cell is the
 * one a player steps through; the corridor behind it is `wallGap` cells deep.
 * The check is on the room-local cell, so it also reports a doorway the player
 * is standing *in front of* rather than on — which is exactly where a blocked
 * entrance is reported from.
 */
export function findDoorway(room, cellX, cellY) {
  if (!room) return null;
  const localX = cellX - room.origin.x;
  const localY = cellY - room.origin.y;
  for (let index = 0; index < room.openings.length; index += 1) {
    const opening = room.openings[index];
    const span = openingSpan(opening);
    const onFace = span.alongX ? localY === span.across : localX === span.across;
    if (!onFace) continue;
    const along = span.alongX ? localX : localY;
    if (along < span.from || along > span.to) continue;
    return { opening, span, local: { x: localX, z: localY } };
  }
  return null;
}

/** Floor cells of a room, counted on its mask. */
function countFloorCells(room) {
  let count = 0;
  for (let y = 0; y < room.mask.h; y += 1) {
    for (let x = 0; x < room.mask.w; x += 1) {
      if (room.mask.cells[y][x]) count += 1;
    }
  }
  return count;
}

/** Every doorway of a room, in world cells, so a report can list the exits. */
export function doorwaysOf(room) {
  if (!room) return [];
  return room.openings.map((opening) => {
    const start = doorwayStart(room, opening);
    const span = openingSpan(opening);
    const outward = opening.side === "north" ? { x: 0, z: -1 }
      : opening.side === "south" ? { x: 0, z: 1 }
        : opening.side === "west" ? { x: -1, z: 0 } : { x: 1, z: 0 };
    return {
      id: opening.id,
      side: opening.side,
      status: opening.status,
      width: opening.width,
      connectionId: opening.connectionId || null,
      // The first cell of the span, in world coordinates: the cell a player
      // walks through, and the one that must be clear.
      cell: span.alongX ? { x: start.x, z: start.across } : { x: start.across, z: start.y },
      outward,
    };
  });
}

/**
 * Chebyshev distance from a point to the nearest floor cell of a room.
 *
 * Zero when the point is on a floor cell, which is the only answer that makes
 * "you are standing in this room" true. Bounded by the mask, so a 55×55 room
 * costs 3 000 comparisons — a report is asked for, never ticked.
 */
function distanceToRoomCells(room, point) {
  let best = Infinity;
  for (let y = 0; y < room.mask.h; y += 1) {
    for (let x = 0; x < room.mask.w; x += 1) {
      if (!room.mask.cells[y][x]) continue;
      const dx = Math.max(room.origin.x + x - point.x, 0, point.x - (room.origin.x + x + 1));
      const dy = Math.max(room.origin.y + y - point.y, 0, point.y - (room.origin.y + y + 1));
      const distance = Math.max(dx, dy);
      if (distance < best) best = distance;
    }
  }
  return best;
}

/**
 * What the report says about the room a player is in or beside.
 *
 * `buildState` is read from the builder, not from the room record: the manager's
 * record carries a `buildState` field that nothing ever advances, and a debug
 * line that always prints `not_started` is worse than no line at all.
 */
function describeRoom(room, distance, buildState) {
  if (!room) return null;
  return {
    id: room.id,
    depth: room.depth,
    origin: { x: room.origin.x, z: room.origin.y },
    size: { width: room.mask.w, depth: room.mask.h },
    // Floor cells, not the bounding box: a cross-shaped room of 55×55 covers a
    // quarter of its box, and that is the number that makes a report believable.
    area: countFloorCells(room),
    seed: room.seed,
    buildState: buildState ? buildState.state : (room.buildState || null),
    buildCursor: buildState ? buildState.cursor : (room.buildCursor === undefined ? null : room.buildCursor),
    buildWritten: buildState ? buildState.written : null,
    buildTotal: buildState ? buildState.total : null,
    buildAttempts: buildState ? buildState.attempts : null,
    distance,
    connections: room.connections.length,
    doorways: doorwaysOf(room),
    pendingOpenings: room.openings.filter((opening) => opening.status === OPENING_STATUS.PENDING).length,
  };
}

/**
 * The rooms closest to a point, cheapest first.
 *
 * A bad seam is always a *pair* of rooms, and the report has to name both: the
 * room the player is in and the one whose wall it is looking at. Four is enough
 * to cover a doorway and the room behind it, and short enough to read on a phone.
 */
export function nearbyRooms(manager, pointRef, limit = 4) {
  const point = toPlanPoint(pointRef);
  const rooms = manager.allRooms();
  const list = [];
  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    list.push({
      id: room.id,
      // The distance to the room's *floor*, not to its bounding box: a
      // cross-shaped room leaves its own corners empty, and a report that says
      // "0 cells" while the player stands in that empty corner is a report that
      // sends the wrong room.
      distance: round2(distanceToRoomCells(room, point)),
      size: `${room.mask.w}x${room.mask.h}`,
    });
  }
  list.sort((a, b) => (a.distance - b.distance) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return list.slice(0, limit);
}

/**
 * A full report on one position.
 *
 * Everything is derived from `manager` and the point; the caller supplies the
 * seed label, the difficulty and the block reader, so this file can be tested
 * with a fake API as easily as in the game.
 */
export function describePosition(options) {
  const manager = options.manager;
  const point = options.point;
  const blockAt = options.blockAt || null;
  const plan = toPlanPoint(point);
  const cellX = Math.floor(plan.x);
  const cellY = Math.floor(plan.y);

  const located = locatePlayerRoom(manager, { x: plan.x, y: plan.y });
  const room = located ? located.room : null;
  // `locatePlayerRoom` returns the nearest room when the point is in a corridor,
  // so "the room" and "the room I am in" are two different things. A corridor
  // between two rooms is nearer to one of them, and saying so would be a report
  // that lies about where the player is. `inside` therefore means "on one of that
  // room's own floor cells", and the distance is measured on those cells.
  const roomDistance = room ? round2(distanceToRoomCells(room, plan)) : null;
  const inside = roomDistance === 0;

  const corridor = findCorridor(manager, plan);
  const doorway = inside ? findDoorway(room, cellX, cellY) : null;
  const buildStateOf = options.buildStateOf || null;
  const buildState = buildStateOf && room ? buildStateOf(room.id) : null;
  const floorY = options.floorY === undefined ? DUNGEON_CONFIG.floorY : options.floorY;

  return {
    seed: options.seed === undefined ? manager.seed : options.seed,
    difficulty: options.difficulty === undefined ? null : options.difficulty,
    lobby: options.lobby === undefined ? null : options.lobby,
    cell: { x: cellX, z: cellY },
    position: { x: plan.x, y: point.y === undefined ? null : point.y, z: plan.z },
    where: corridor && corridor.onCorridor ? "corridor" : inside ? "room" : "outside",
    room: describeRoom(room, roomDistance, buildState),
    distanceToRoom: roomDistance,
    doorway: doorway ? {
      openingId: doorway.opening.id,
      side: doorway.opening.side,
      status: doorway.opening.status,
      width: doorway.opening.width,
      connectionId: doorway.opening.connectionId || null,
      local: doorway.local,
      corridor,
    } : null,
    corridor,
    // `light` is the HUD's mode: the same answer about the room and the corridor,
    // without the two things that cost real work (a scan of every room, two block
    // reads). The HUD refreshes twice a second, so it must never do either.
    nearbyRooms: options.light ? [] : nearbyRooms(manager, plan),
    // Two reads per report, and none at all when the caller has no reader: this
    // is what tells "the floor is missing" from "the floor is there but the
    // player cannot walk on it".
    blockBelow: blockAt && !options.light ? blockAt(cellX, floorY, cellY) : null,
    blockAtHead: blockAt && !options.light ? blockAt(cellX, floorY + DUNGEON_CONFIG.passageHeight - 1, cellY) : null,
    rooms: manager.roomCount,
    connections: manager.connectionCount,
  };
}

/**
 * The whole dungeon in a few numbers.
 *
 * A screenshot of a broken corner says nothing about whether the rest of the
 * dungeon is healthy; this does. Connections above `rooms - 1` are loops, the
 * build states say which rooms are still waiting, and the refusals say what the
 * generator tried and could not place — the four things that explain "the
 * corridor looks wrong here" from the other end.
 */
export function describeDungeon(manager, options = {}) {
  const buildStateOf = options.buildStateOf || null;
  const rooms = manager.allRooms();
  const buildStates = {};
  let smallest = null;
  let largest = null;
  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    // The builder holds the real state; the manager's field never advances.
    const buildState = buildStateOf ? buildStateOf(room.id) : null;
    const state = (buildState && buildState.state) || room.buildState || "unknown";
    buildStates[state] = (buildStates[state] || 0) + 1;
    const area = countFloorCells(room);
    if (smallest === null || area < smallest) smallest = area;
    if (largest === null || area > largest) largest = area;
  }
  const refusals = [];
  const byCode = manager.stats.refusedByCode || {};
  const codes = Object.keys(byCode).sort((a, b) => byCode[b] - byCode[a]);
  for (let index = 0; index < codes.length; index += 1) {
    refusals.push({ code: codes[index], count: byCode[codes[index]] });
  }
  return {
    seed: manager.seed,
    rooms: rooms.length,
    connections: manager.connectionCount,
    // Loops = extra links: a spanning tree over n rooms has n - 1 connections.
    loops: Math.max(0, manager.connectionCount - Math.max(0, rooms.length - 1)),
    maxDepth: manager.stats.maxDepth,
    candidates: manager.stats.candidates,
    smallestArea: smallest,
    largestArea: largest,
    buildStates,
    refusals: refusals.slice(0, 6),
  };
}

/** The dungeon summary as chat lines, one per idea. */
export function dungeonLines(seed, difficulty, summary) {
  const lines = [];
  lines.push(`[dbg] dungeon ${difficulty || "?"} · seed ${seed} · ${summary.rooms} rooms · ${summary.connections} connections · ${summary.loops} loop(s) · max depth ${summary.maxDepth}`);
  const states = Object.keys(summary.buildStates)
    .sort()
    .map((state) => `${state} ${summary.buildStates[state]}`)
    .join(" · ");
  lines.push(`[dbg] build: ${states || "nothing built"}`);
  lines.push(`[dbg] areas ${summary.smallestArea}..${summary.largestArea} cells · ${summary.candidates} candidates tried`);
  if (summary.refusals.length > 0) {
    const list = summary.refusals.map((entry) => `${entry.code} ${entry.count}`).join(" · ");
    lines.push(`[dbg] refusals: ${list}`);
  } else {
    lines.push("[dbg] refusals: none");
  }
  return lines;
}

/**
 * The one-line HUD: the numbers every screenshot should carry.
 *
 * Deliberately short — it sits at the top of the screen, in line with the game's
 * own coordinates, and it is read in a picture months later. Seed, cell, room (or
 * corridor), and the doorway if the player is in one: enough to rebuild the exact
 * geometry offline with `tools/visualize-dungeon.mjs`.
 */
export function hudLine(report) {
  const parts = [`seed ${report.seed}`];
  parts.push(`${report.cell.x},${report.cell.z}`);
  if (report.corridor && report.corridor.onCorridor) {
    const corridor = report.corridor;
    parts.push(`corridor ${corridor.width}w ${corridor.from}→${corridor.to}`);
  } else if (report.room) {
    const room = report.room;
    parts.push(`${room.id} ${room.size.width}x${room.size.depth}${report.distanceToRoom ? ` +${round2(report.distanceToRoom)}` : ""}`);
  } else {
    parts.push("no room");
  }
  if (report.doorway) parts.push(`door ${report.doorway.side}`);
  return parts.join(" · ");
}

/**
 * What is around the player: the rooms within `limit` cells, with their build
 * state and their free doorways.
 *
 * This is the answer to "why is there a wall here": a room that has not been
 * built yet, a doorway that is still free, or a corridor that was never carved
 * each look like a bug from inside the dungeon and each has a different cause.
 */
export function describeNearby(manager, pointRef, options = {}) {
  const point = toPlanPoint(pointRef);
  const limit = options.limit === undefined ? 120 : options.limit;
  const buildStateOf = options.buildStateOf || null;
  const list = [];
  const rooms = manager.allRooms();
  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    const distance = round2(distanceToRoomCells(room, point));
    if (distance > limit) continue;
    const state = buildStateOf ? buildStateOf(room.id) : null;
    list.push({
      id: room.id,
      distance,
      size: `${room.mask.w}x${room.mask.h}`,
      buildState: state ? state.state : (room.buildState || null),
      connections: room.connections.length,
      doorways: room.openings.length,
      freeDoorways: room.openings.filter((opening) => opening.status === OPENING_STATUS.PENDING).length,
    });
  }
  list.sort((a, b) => (a.distance - b.distance) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { point: { x: point.x, z: point.z }, rooms: list };
}

/** The nearby-rooms report as chat lines. */
export function nearbyLines(report, options = {}) {
  const max = options.max === undefined ? 10 : options.max;
  if (report.rooms.length === 0) return ["[dbg] no room within the radius — you are past the edge of the dungeon"];
  const lines = [`[dbg] ${report.rooms.length} room(s) near ${report.point.x},${report.point.z}:`];
  for (let index = 0; index < Math.min(max, report.rooms.length); index += 1) {
    const room = report.rooms[index];
    lines.push(`[dbg] ${room.id} ${room.size} @${room.distance} · ${room.buildState} · ${room.connections} link(s) · ${room.freeDoorways}/${room.doorways} free doorway(s)`);
  }
  if (report.rooms.length > max) lines.push(`[dbg] … ${report.rooms.length - max} more`);
  return lines;
}

/** One line, for a chat message: the numbers a screenshot cannot carry. */
export function shortLine(report) {
  const parts = [`seed ${report.seed}`];
  if (report.difficulty) parts.push(String(report.difficulty));
  parts.push(`cell ${report.cell.x},${report.cell.z}`);
  if (report.where === "corridor" && report.corridor) {
    parts.push(`corridor ${report.corridor.connectionId} (${report.corridor.kind}, ${report.corridor.width} wide)`);
  } else if (report.room) {
    parts.push(`room ${report.room.id} ${report.room.size.width}x${report.room.size.depth}`);
  } else {
    parts.push("no room");
  }
  if (report.doorway) parts.push(`door ${report.doorway.side} ${report.doorway.status}`);
  return parts.join(" · ");
}

/**
 * The report as chat lines.
 *
 * Bloxd's `sendMessage` shows one message at a time and a long line is unreadable
 * on a phone, so a full report is several short lines, each one self-contained: a
 * screenshot of any three of them can be read without the others.
 */
export function reportLines(report) {
  const lines = [];
  lines.push(`[dbg] seed ${report.seed}${report.difficulty ? ` · ${report.difficulty}` : ""}${report.lobby ? ` · lobby ${report.lobby}` : ""}`);
  lines.push(`[dbg] cell ${report.cell.x},${report.cell.z} · pos ${round2(report.position.x)},${round2(report.position.z)} · ${report.where}`);
  if (report.room) {
    const room = report.room;
    lines.push(`[dbg] room ${room.id} · ${room.size.width}x${room.size.depth} (${room.area} cells) · origin ${room.origin.x},${room.origin.z} · depth ${room.depth}`);
    const progress = room.buildTotal === null ? "" : ` ${room.buildWritten}/${room.buildTotal}`;
    // The cursor is `{ index, phase }`: printed the way it is written, so a
    // report can be replayed against the same room.
    const at = room.buildCursor && room.buildCursor.index !== undefined
      ? ` @${room.buildCursor.phase}:${room.buildCursor.index}`
      : "";
    const cursor = at;
    const attempts = room.buildAttempts ? ` · ${room.buildAttempts} attempt(s)` : "";
    lines.push(`[dbg] room seed ${room.seed} · build ${room.buildState || "unknown"}${progress}${cursor}${attempts} · ${room.connections} link(s) · ${room.pendingOpenings} free doorway(s)`);
    if (room.doorways.length > 0) {
      const list = room.doorways
        .map((doorway) => `${doorway.side} ${doorway.width}@${doorway.cell.x},${doorway.cell.z} ${doorway.status}`)
        .join(" · ");
      lines.push(`[dbg] doorways: ${list}`);
    }
  } else {
    lines.push("[dbg] no room at this cell");
  }
  if (report.doorway) {
    lines.push(`[dbg] standing in doorway ${report.doorway.openingId} (${report.doorway.side}, ${report.doorway.width} wide, ${report.doorway.status}) → ${report.doorway.connectionId || "no connection"}`);
  }
  if (report.corridor) {
    const corridor = report.corridor;
    lines.push(`[dbg] corridor ${corridor.connectionId} · ${corridor.kind} · ${corridor.width} wide · ${corridor.cells} cells · ${corridor.from}→${corridor.to}${corridor.onCorridor ? "" : ` · ${round2(corridor.distance)} cells away`}`);
  } else {
    lines.push("[dbg] no corridor in this dungeon");
  }
  if (report.nearbyRooms && report.nearbyRooms.length > 0) {
    const list = report.nearbyRooms
      .map((entry) => `${entry.id} ${entry.size} @${entry.distance}`)
      .join(" · ");
    lines.push(`[dbg] nearest rooms (id size distance): ${list}`);
  }
  if (report.blockBelow !== null) {
    lines.push(`[dbg] block under foot ${report.blockBelow || "unloaded"} · at head ${report.blockAtHead || "unloaded"}`);
  }
  lines.push(`[dbg] dungeon: ${report.rooms} rooms · ${report.connections} connections`);
  return lines;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** The cell key the manager uses for its corridor set, exported for tests. */
export const corridorKeyOf = cellKey;
