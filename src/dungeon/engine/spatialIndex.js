/*
 * Spatial index over placed rooms.
 *
 * Two structures, both hash maps:
 *   - a coarse region grid over room bounds, for "which rooms are near this
 *     rectangle" in constant time;
 *   - an index of openings keyed by the cell just outside them, for "is there
 *     already an opening facing mine" in one lookup.
 *
 * The index never decides anything. It returns candidates, and the validator
 * decides on real cells. Kept separate for exactly that reason: a bug here must
 * never be able to accept a wrong room on its own.
 */

import { DUNGEON_CONFIG } from "./config.js";
import { OPENING_STATUS } from "./openings.js";

// 80 = 16 × 5, following the dungeon's scale: a room is at most 55 cells across,
// and the grid must still be able to hold one room and its immediate
// neighbourhood per cell rather than smearing a single room over nine regions.
export const REGION_SIZE = 80;

export function regionKey(x, y) {
  return `${Math.floor(x / REGION_SIZE)},${Math.floor(y / REGION_SIZE)}`;
}

export function openingKey(side, x, y) {
  return `${side}:${x},${y}`;
}

export function createSpatialIndex() {
  const regions = new Map();
  const openings = new Map();
  const rooms = new Map();

  function regionKeysFor(room) {
    const keys = [];
    const margin = room.margin === undefined ? 0 : room.margin;
    const minX = room.origin.x - margin;
    const minY = room.origin.y - margin;
    const maxX = room.origin.x + room.mask.w - 1 + margin;
    const maxY = room.origin.y + room.mask.h - 1 + margin;
    for (let rx = Math.floor(minX / REGION_SIZE); rx <= Math.floor(maxX / REGION_SIZE); rx += 1) {
      for (let ry = Math.floor(minY / REGION_SIZE); ry <= Math.floor(maxY / REGION_SIZE); ry += 1) {
        keys.push(`${rx},${ry}`);
      }
    }
    return keys;
  }

  return {
    get size() {
      return rooms.size;
    },

    has(roomId) {
      return rooms.has(roomId);
    },

    get(roomId) {
      return rooms.get(roomId) || null;
    },

    insert(room) {
      if (rooms.has(room.id)) return;
      const keys = regionKeysFor(room);
      rooms.set(room.id, { room, keys });
      for (let index = 0; index < keys.length; index += 1) {
        const bucket = regions.get(keys[index]);
        if (bucket) bucket.push(room.id);
        else regions.set(keys[index], [room.id]);
      }
      indexOpenings(room);
    },

    remove(roomId) {
      const entry = rooms.get(roomId);
      if (!entry) return;
      for (let index = 0; index < entry.keys.length; index += 1) {
        const bucket = regions.get(entry.keys[index]);
        if (!bucket) continue;
        const at = bucket.indexOf(roomId);
        if (at !== -1) bucket.splice(at, 1);
        if (bucket.length === 0) regions.delete(entry.keys[index]);
      }
      unindexOpenings(entry.room);
      rooms.delete(roomId);
    },

    /**
     * Rooms whose grown bounds can touch `rect`. Returns real room records; the
     * caller still has to test cells.
     */
    queryRect(rect) {
      const found = new Map();
      for (let rx = Math.floor(rect.x1 / REGION_SIZE); rx <= Math.floor(rect.x2 / REGION_SIZE); rx += 1) {
        for (let ry = Math.floor(rect.y1 / REGION_SIZE); ry <= Math.floor(rect.y2 / REGION_SIZE); ry += 1) {
          const bucket = regions.get(`${rx},${ry}`);
          if (!bucket) continue;
          for (let index = 0; index < bucket.length; index += 1) {
            const entry = rooms.get(bucket[index]);
            if (entry) found.set(bucket[index], entry.room);
          }
        }
      }
      const list = [];
      found.forEach((room) => list.push(room));
      return list;
    },

    /** Rooms near a point, nearest first, capped. */
    nearest(point, limit = DUNGEON_CONFIG.reuseCandidateLimit) {
      const margin = 8;
      const candidates = this.queryRect({
        x1: point.x - margin,
        y1: point.y - margin,
        x2: point.x + margin,
        y2: point.y + margin,
      });
      const scored = candidates.map((room) => {
        const cx = room.origin.x + room.mask.w / 2;
        const cy = room.origin.y + room.mask.h / 2;
        return { room, distance: Math.abs(cx - point.x) + Math.abs(cy - point.y) };
      });
      scored.sort((a, b) => a.distance - b.distance);
      return scored.slice(0, limit).map((entry) => entry.room);
    },

    /**
     * The opening of another room that faces `room`'s opening back, at exactly
     * the distance implied by the wall gap. One lookup, no proximity guess: if
     * the partner cell holds no opening, there is no connection to make.
     */
    openingFacing(room, opening, excludeRoomId = null) {
      const opposite = { north: "south", south: "north", east: "west", west: "east" }[opening.side];
      const normals = { north: { x: 0, y: -1 }, south: { x: 0, y: 1 }, east: { x: 1, y: 0 }, west: { x: -1, y: 0 } };
      const normal = normals[opening.side];
      // The partner opening is on the facing wall, one joint away. Every cell of
      // the facing row is tried, not only the one exactly opposite the centre:
      // two wide doorways meet whenever their spans *overlap*, and the partner's
      // centre may sit anywhere along that row. The row is one joint away and as
      // long as the doorway plus its own width, so the cost is bounded and does
      // not depend on the size of the dungeon.
      const distance = DUNGEON_CONFIG.wallGap + 1;
      const across = {
        x: room.origin.x + opening.centerX + normal.x * distance,
        y: room.origin.y + opening.centerY + normal.y * distance,
      };
      const reach = opening.width + DUNGEON_CONFIG.minOpeningSpacing;
      const cells = [];
      for (let step = -reach; step <= reach; step += 1) {
        const x = normal.x !== 0 ? across.x : across.x + step;
        const y = normal.x !== 0 ? across.y + step : across.y;
        cells.push(openingKey(opposite, x, y));
      }
      // The exact cell first, so the common case stays a single lookup.
      const ordered = [openingKey(opposite, across.x, across.y)].concat(cells);
      for (let at = 0; at < ordered.length; at += 1) {
        const bucket = openings.get(ordered[at]);
        if (!bucket) continue;
        const found = pick(bucket, opposite, excludeRoomId);
        if (found) return found;
      }
      return null;
    },

    /**
     * Every pending opening whose centre lies inside `rect`, with its room.
     *
     * This is the bounded candidate query the connector uses to look for a
     * loop: it is limited to a small rectangle around the opening being
     * developed, so the cost never depends on the dungeon size.
     */
    openingsInRect(rect, excludeRoomId = null) {
      const found = [];
      openings.forEach((bucket) => {
        for (let index = 0; index < bucket.length; index += 1) {
          const record = bucket[index];
          if (record.roomId === excludeRoomId) continue;
          if (record.opening.status !== OPENING_STATUS.PENDING) continue;
          if (record.point.x < rect.x1 || record.point.x > rect.x2) continue;
          if (record.point.y < rect.y1 || record.point.y > rect.y2) continue;
          found.push(record);
        }
      });
      return found;
    },

    /** All pending openings registered at one outside cell. Diagnostics. */
    openingsAt(point) {
      const found = [];
      openings.forEach((bucket) => {
        for (let index = 0; index < bucket.length; index += 1) {
          if (bucket[index].point.x === point.x && bucket[index].point.y === point.y) found.push(bucket[index]);
        }
      });
      return found;
    },

    /** Re-index one room after a status change. */
    refreshOpenings(room) {
      unindexOpenings(room);
      indexOpenings(room);
    },
  };

  /** The first usable record of a bucket, or null. */
  function pick(bucket, opposite, excludeRoomId) {
    for (let index = 0; index < bucket.length; index += 1) {
      const record = bucket[index];
      if (record.roomId === excludeRoomId) continue;
      if (record.opening.side !== opposite) continue;
      if (record.opening.status === OPENING_STATUS.CONNECTED) continue;
      if (record.opening.status === OPENING_STATUS.BLOCKED) continue;
      return record;
    }
    return null;
  }

  function indexOpenings(room) {
    const list = room.openings || [];
    for (let index = 0; index < list.length; index += 1) {
      const opening = list[index];
      if (opening.status === OPENING_STATUS.CONNECTED) continue;
      if (opening.status === OPENING_STATUS.BLOCKED) continue;
      // Keyed by the opening's own centre cell, on the room's face. Two
      // openings facing each other are then exactly `doorwayDistance()`
      // apart, so finding the partner is one lookup at a computed cell.
      const point = {
        x: room.origin.x + opening.centerX,
        y: room.origin.y + opening.centerY,
      };
      const key = openingKey(opening.side, point.x, point.y);
      const bucket = openings.get(key);
      const record = { roomId: room.id, room, opening, point };
      if (bucket) bucket.push(record);
      else openings.set(key, [record]);
    }
  }

  function unindexOpenings(room) {
    const list = room.openings || [];
    for (let index = 0; index < list.length; index += 1) {
      const opening = list[index];
      if (opening.status === OPENING_STATUS.CONNECTED) continue;
      if (opening.status === OPENING_STATUS.BLOCKED) continue;
      const point = {
        x: room.origin.x + opening.centerX,
        y: room.origin.y + opening.centerY,
      };
      const key = openingKey(opening.side, point.x, point.y);
      const bucket = openings.get(key);
      if (!bucket) continue;
      for (let at = bucket.length - 1; at >= 0; at -= 1) {
        if (bucket[at].roomId === room.id && bucket[at].opening.id === opening.id) bucket.splice(at, 1);
      }
      if (bucket.length === 0) openings.delete(key);
    }
  }
}
