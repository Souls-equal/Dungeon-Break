/*
 * Discovery: from a player's position to the list of openings worth developing.
 *
 * This module answers exactly one question — "which free doorways are near this
 * player, and which of them is the most urgent?" — and answers it without
 * generating anything. Keeping it separate from generation is what makes the
 * per-tick cost negligible: a scan reads positions and a few dozen numbers.
 *
 * No timer, no promise, no clock: the caller decides when a scan happens.
 */

import { DUNGEON_CONFIG } from "./config.js";
import { OPENING_STATUS } from "./openings.js";

/** Priority classes, lowest first: a crossing doorway is handled before any other. */
export const PRIORITY_CLASS = {
  CROSSING: 0,
  NEAR: 1,
};

/** The world cells of a doorway, on its room's own face. */
export function openingCells(room, opening) {
  const cells = [];
  for (let offset = opening.offsetStart; offset <= opening.offsetEnd; offset += 1) {
    if (opening.side === "north") cells.push({ x: room.origin.x + offset, y: room.origin.y });
    else if (opening.side === "south") cells.push({ x: room.origin.x + offset, y: room.origin.y + room.mask.h - 1 });
    else if (opening.side === "west") cells.push({ x: room.origin.x, y: room.origin.y + offset });
    else cells.push({ x: room.origin.x + room.mask.w - 1, y: room.origin.y + offset });
  }
  return cells;
}

/**
 * Distance from a point to a doorway, in cells.
 *
 * Measured to the closest cell of the doorway, not to its middle: a doorway is
 * up to five cells wide, and a player standing at one end of a wide threshold
 * would otherwise look farther away than they are.
 */
export function distanceToOpening(point, room, opening) {
  const cells = openingCells(room, opening);
  let best = Infinity;
  for (let index = 0; index < cells.length; index += 1) {
    const distance = Math.max(
      Math.abs(cells[index].x - point.x),
      Math.abs(cells[index].y - point.y),
    );
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * Priority of one doorway for one player.
 *
 * Lower is more urgent. The formula is the one the specification gives:
 *
 *     class = crossing ? 0 : 1
 *     priority = distance + depth * 40
 *
 * `depth` counts links from the player's own room, not from the entrance: a
 * player who walked ten rooms deep must not be starved by a player still next to
 * the entrance.
 */
export function priorityOf({ distance, depth, crossing }) {
  const bucket = crossing ? PRIORITY_CLASS.CROSSING : PRIORITY_CLASS.NEAR;
  return { bucket, priority: distance + depth * DUNGEON_CONFIG.priorityDepthWeight };
}

/** Distance from a point to the nearest cell of a room, in cells. */
export function distanceToRoom(point, room) {
  const dx = Math.max(room.origin.x - point.x, 0, point.x - (room.origin.x + room.mask.w - 1));
  const dy = Math.max(room.origin.y - point.y, 0, point.y - (room.origin.y + room.mask.h - 1));
  return Math.max(dx, dy);
}

/**
 * Picks the doorways worth developing for a set of players.
 *
 * Returns `{ roomId, openingId, bucket, priority, distance, depth, players }`
 * sorted by class, then priority, then opening id. The identifier is the last
 * key so the order is total: an unstable sort would make the whole pipeline
 * unreproducible, and that only shows up later as a flaky test.
 *
 * Every branch is walked, not just the one the player seems to follow: the
 * anticipation must cover the whole neighbourhood, otherwise a player who turns
 * back would find an unfinished branch.
 */
export function discoverOpenings({ manager, players, reach = null }) {
  const limit = reach === null ? DUNGEON_CONFIG.discoveryDistance : reach;
  const best = new Map();

  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    if (!player || !player.position) continue;
    const point = { x: player.position.x, y: player.position.y };
    const home = player.roomId ? manager.getRoom(player.roomId) : null;
    if (!home) continue;

    const frontier = [{ room: home, depth: 0 }];
    const seen = new Set([home.id]);
    let cursor = 0;
    while (cursor < frontier.length) {
      const entry = frontier[cursor];
      cursor += 1;
      if (distanceToRoom(point, entry.room) > DUNGEON_CONFIG.maxAnticipationDistance) continue;

      for (let at = 0; at < entry.room.openings.length; at += 1) {
        const opening = entry.room.openings[at];
        if (opening.status !== OPENING_STATUS.PENDING) continue;
        const distance = distanceToOpening(point, entry.room, opening);
        if (distance > limit) continue;
        const crossing = distance <= DUNGEON_CONFIG.crossingDistance;
        const { bucket, priority } = priorityOf({ distance, depth: entry.depth, crossing });
        const key = `${entry.room.id}/${opening.id}`;
        const previous = best.get(key);
        if (!previous || priority < previous.priority) {
          best.set(key, {
            roomId: entry.room.id,
            openingId: opening.id,
            bucket,
            priority,
            distance,
            depth: entry.depth,
            players: previous && !previous.players.includes(player.id)
              ? previous.players.concat([player.id])
              : (previous ? previous.players : [player.id]),
          });
        } else if (!previous.players.includes(player.id)) {
          previous.players.push(player.id);
        }
      }

      if (entry.depth >= DUNGEON_CONFIG.anticipationDepth) continue;
      for (let at = 0; at < entry.room.connections.length; at += 1) {
        const connection = manager.getConnection(entry.room.connections[at]);
        if (!connection) continue;
        const otherId = connection.a.roomId === entry.room.id ? connection.b.roomId : connection.a.roomId;
        if (seen.has(otherId)) continue;
        const other = manager.getRoom(otherId);
        if (!other) continue;
        seen.add(otherId);
        frontier.push({ room: other, depth: entry.depth + 1 });
      }
    }
  }

  const list = [...best.values()];
  list.sort((a, b) => (a.bucket - b.bucket)
    || (a.priority - b.priority)
    || (a.openingId < b.openingId ? -1 : a.openingId > b.openingId ? 1 : 0));
  return list;
}

/**
 * Finds the room a point is in, or the nearest one when the point is in a joint.
 *
 * Bounded by the spatial index. The first exact hit wins, so a player standing
 * on a threshold belongs to the room whose cell they are actually on.
 */
export function locatePlayerRoom(manager, point) {
  const candidates = manager.index.queryRect({ x1: point.x, y1: point.y, x2: point.x, y2: point.y });
  for (let index = 0; index < candidates.length; index += 1) {
    const room = candidates[index];
    const localX = point.x - room.origin.x;
    const localY = point.y - room.origin.y;
    if (localX < 0 || localY < 0 || localX >= room.mask.w || localY >= room.mask.h) continue;
    if (room.mask.cells[localY][localX]) return { room, distance: 0 };
  }
  let closest = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const distance = distanceToRoom(point, candidates[index]);
    if (!closest || distance < closest.distance) closest = { room: candidates[index], distance };
  }
  return closest;
}
