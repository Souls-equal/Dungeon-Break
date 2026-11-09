/*
 * The dungeon graph: rooms, openings and connections.
 *
 * This is the single source of truth for a dungeon, and `commitRoom` is the
 * only function that changes it. A generation is therefore atomic by
 * construction: the candidate is built off-graph, validated, and only then
 * inserted, in one place, with the index, the depths and the counters updated
 * together.
 *
 * Nothing here touches the world: no `api`, no blocks. The same graph is used by
 * the builder, the anticipator and the diagnostic tool.
 */

import { DUNGEON_CONFIG } from "./config.js";
import { makeId, roomSeed } from "./random.js";
import { createSpatialIndex } from "./spatialIndex.js";
import { generateShape } from "./shapes.js";
import {
  bridgeCells,
  openingSpan,
  narrowOpening,
  spanOverlap,
  jointCells,
  OPENING_STATUS,
  planConnection,
  planOpenings,
  placeRoomForOpening,
} from "./openings.js";
import { clearanceMap } from "./geometry.js";
import { passageIsWalkable, REFUSAL, validateRoom } from "./validator.js";

export const BUILD_STATE = {
  NOT_STARTED: "not_started",
  BUILDING: "building",
  BUILT: "built",
  FAILED: "failed",
};

export function createDungeonManager(options = {}) {
  const seed = options.seed === undefined ? 1 : options.seed;
  const difficulty = options.difficulty || "normal";
  const radius = options.radius || DUNGEON_DUNGEON_CONFIG.maxDungeonRadius;
  const index = createSpatialIndex();
  const rooms = new Map();
  const connections = new Map();
  const counters = { room: 0, connection: 0 };
  const stats = {
    candidates: 0,
    committed: 0,
    reused: 0,
    refusedByCode: {},
    loops: 0,
    maxDepth: 0,
  };
  let entranceRoomId = null;
  let indexHits = 0;
  // Dominant reason for the current expansion, so a failed opening reports what
  // actually stopped it instead of a generic "exhausted".
  let lastRefusal = null;
  let indexRejected = 0;
  // Every cell of every committed corridor, keyed `x,y`. The manager owns it
  // because it is the only place that sees a connection the moment it is
  // committed: nothing else re-reads a corridor, so a room that lands on one is a
  // sealed branch, and no later pass would notice.
  const corridorCells = new Set();
  const lastRejections = [];

  function noteRefusal(code) {
    stats.refusedByCode[code] = (stats.refusedByCode[code] || 0) + 1;
    lastRefusal = code;
  }

  /**
   * Identity of a room, derived from the path that reaches it.
   *
   * A counter would make the geometry depend on the order of exploration: two
   * rooms created in a different order would get different seeds, hence
   * different shapes, hence different openings — and the whole "the same seed
   * builds the same dungeon" promise would hold only for one single walk
   * order. Deriving the identity from `(parentPath, openingIndex)` instead
   * makes the dungeon a pure function of the seed, whatever order the
   * frontiers are explored in.
   */
  function nextRoomId(parentId, openingId) {
    counters.room += 1;
    const openingIndex = openingId.slice(openingId.lastIndexOf(".o") + 2);
    return `r${parentId.replace(/^r/, "")}.${openingIndex}`;
  }

  /**
   * Identity of a connection, derived from the two openings it joins.
   *
   * Order-independent by construction: the two ends are sorted, so the same
   * pair of openings always produces the same identifier.
   */
  function nextConnectionId(openingA, openingB) {
    counters.connection += 1;
    const ends = [openingA, openingB].sort();
    return `c:${ends[0]}+${ends[1]}`;
  }

  /**
   * Inserts a room. The only mutation point of the graph.
   *
   * Everything that must stay consistent — index, depths, stats, opening
   * statuses of the parent — is done here, so an interrupted generation cannot
   * leave half a room behind: either `commitRoom` ran and the room is complete,
   * or it did not and nothing changed.
   */
  function commitRoom(room) {
    rooms.set(room.id, room);
    index.insert(room);
    stats.committed += 1;
    if (room.depth > stats.maxDepth) stats.maxDepth = room.depth;
    return room;
  }

  function commitConnection(connection, roomA, openingA, roomB, openingB) {
    connections.set(connection.id, connection);
    openingA.status = OPENING_STATUS.CONNECTED;
    openingA.connectionId = connection.id;
    openingB.status = OPENING_STATUS.CONNECTED;
    openingB.connectionId = connection.id;
    roomA.connections.push(connection.id);
    if (roomA.id !== roomB.id) roomB.connections.push(connection.id);
    index.refreshOpenings(roomA);
    if (roomA.id !== roomB.id) index.refreshOpenings(roomB);
    const lists = [connection.joint, connection.bridge];
    for (let list = 0; list < lists.length; list += 1) {
      const entries = lists[list] || [];
      for (let at = 0; at < entries.length; at += 1) {
        corridorCells.add(`${entries[at].x},${entries[at].y}`);
      }
    }
    return connection;
  }

  /** Depth refresh from the entrance, bounded to the affected component. */
  function refreshDepths(startRoomId) {
    const start = rooms.get(startRoomId);
    if (!start) return;
    const queue = [start];
    const seen = new Set([start.id]);
    let cursor = 0;
    while (cursor < queue.length) {
      const room = queue[cursor];
      cursor += 1;
      for (let index_ = 0; index_ < room.connections.length; index_ += 1) {
        const connection = connections.get(room.connections[index_]);
        if (!connection) continue;
        const otherId = connection.a.roomId === room.id ? connection.b.roomId : connection.a.roomId;
        if (seen.has(otherId)) continue;
        seen.add(otherId);
        const other = rooms.get(otherId);
        if (!other) continue;
        const depth = room.depth + 1;
        if (depth < other.depth) {
          other.depth = depth;
          queue.push(other);
        }
      }
    }
  }

  function makeRoomRecord(id, mask, origin, openings, seedValue, depth, parent) {
    const room = {
      id,
      seed: seedValue,
      depth,
      parentRoomId: parent ? parent.roomId : null,
      parentOpeningId: parent ? parent.openingId : null,
      origin,
      mask,
      floorLevel: 0,
      dimensions: { w: mask.w, h: mask.h, wallHeight: DUNGEON_CONFIG.wallHeight },
      openings,
      connections: [],
      buildState: BUILD_STATE.NOT_STARTED,
      buildCursor: null,
      margin: 0,
    };
    return room;
  }

  /**
   * Creates the entrance room. Its only special feature is that it has no
   * parent; its openings are ordinary ones.
   */
  function createEntrance() {
    counters.room += 1;
    const id = "r0";
    const roomSeedValue = roomSeed(seed, "entrance", id);
    for (let attempt = 0; attempt < DUNGEON_CONFIG.maxGenerationAttempts; attempt += 1) {
      const shape = generateShape(roomSeedValue, attempt);
      if (!shape.ok) {
        noteRefusal(shape.reason);
        continue;
      }
      const openings = planOpenings(id, shape.mask, roomSeedValue).openings;
      if (openings.length < DUNGEON_CONFIG.minOpenings) {
        noteRefusal(REFUSAL.NO_OPENING);
        continue;
      }
      const origin = { x: 0, y: 0 };
      const room = makeRoomRecord(id, shape.mask, origin, openings, roomSeedValue, 0, null);
      const clearances = clearanceMap(shape.mask);
      const verdict = validateRoom({
        candidate: { mask: shape.mask, origin, openings },
        nearby: [],
        parent: null,
        childOpening: null,
        radius,
        clearances,
      });
      if (!verdict.ok) {
        noteRefusal(verdict.code);
        continue;
      }
      entranceRoomId = id;
      commitRoom(room);
      closeLoops(room);
      return room;
    }
    return null;
  }

  /**
   * Tries to connect an opening to an existing room before creating a new one.
   * This is what turns a tree into a network: loops and shortcuts cost nothing.
   */
  function tryReuse(room, opening) {
    const found = index.openingFacing(room, opening, room.id);
    if (found) {
      const direct = commitIfValid(room, opening, found.room, found.opening, "direct");
      if (direct) return direct;
    }
    // No room exactly at joint distance: look for one that can be reached by a
    // short explicit bridge. Bounded rectangle, so the cost is constant.
    const reach = DUNGEON_CONFIG.wallGap + 1 + DUNGEON_CONFIG.maxBridgeLength;
    const center = {
      x: room.origin.x + opening.centerX,
      y: room.origin.y + opening.centerY,
    };
    // A bridge only makes sense straight ahead along the opening's own normal;
    // a rectangle across the axis would also collect pairs that are beside it.
    const along = { x: opening.vectorX, y: opening.vectorY };
    const rect = along.x !== 0
      ? { x1: center.x, x2: center.x + along.x * reach, y1: center.y - reach, y2: center.y + reach }
      : { x1: center.x - reach, x2: center.x + reach, y1: center.y, y2: center.y + along.y * reach };
    const candidates = index.openingsInRect(rect, room.id);
    for (let at = 0; at < candidates.length; at += 1) {
      const record = candidates[at];
      const bridge = commitIfValid(room, opening, record.room, record.opening, "bridge");
      if (bridge) return bridge;
    }
    return null;
  }

  /**
   * Connects two openings if the geometry allows it, and records how.
   *
   * `direct` uses the joint; `bridge` carves a short corridor and stores its
   * cells, so the builder knows exactly what to dig. A connection always names
   * two opening identifiers: it is never inferred from proximity at build time.
   */
  function commitIfValid(roomA, openingA, roomB, openingB, kind) {
    const plan = planConnection(roomA, openingA, roomB, openingB, kind);
    if (!plan.ok) return null;

    // A bridge must not cross a third room. `planConnection` already refused one
    // that runs within `doorwayClearance` of the two rooms it joins; this is the
    // other half — the rooms it joins are not the only rooms in the dungeon.
    if (plan.bridge.length > 0) {
      for (let index_ = 0; index_ < plan.bridge.length; index_ += 1) {
        const rooms_ = index.queryRect({
          x1: plan.bridge[index_].x, y1: plan.bridge[index_].y,
          x2: plan.bridge[index_].x, y2: plan.bridge[index_].y,
        });
        for (let other = 0; other < rooms_.length; other += 1) {
          if (rooms_[other].id === roomA.id || rooms_[other].id === roomB.id) continue;
          const local = {
            x: plan.bridge[index_].x - rooms_[other].origin.x,
            y: plan.bridge[index_].y - rooms_[other].origin.y,
          };
          if (rooms_[other].mask.cells[local.y] && rooms_[other].mask.cells[local.y][local.x]) return null;
        }
      }
    }

    // How wide the corridor is, is how wide the two doorways will be. The
    // narrowing happens off to the side first: a connection that turns out not to
    // be walkable must leave both rooms exactly as it found them, and narrowing is
    // the only mutation in this function that a refusal used to leave behind.
    const narrowed = { from: plan.overlap.from, to: plan.overlap.to };
    const spanA = openingSpan(openingA);
    const spanB = openingSpan(openingB);
    const localA = { from: narrowed.from - (spanA.alongX ? roomA.origin.x : roomA.origin.y), to: narrowed.to - (spanA.alongX ? roomA.origin.x : roomA.origin.y) };
    const localB = { from: narrowed.from - (spanB.alongX ? roomB.origin.x : roomB.origin.y), to: narrowed.to - (spanB.alongX ? roomB.origin.x : roomB.origin.y) };

    // A logical connection is not enough: the corridor it describes must be
    // physically walkable from inside one room to inside the other. This check
    // was written in Phase 2 and never called; it is called here, on the narrowed
    // geometry, because everything else about a connection is geometry on paper,
    // and a room whose only door opens onto a wall is built, visible and
    // impossible to enter.
    if (!passageIsWalkable(roomA, { ...openingA, ...openingSpanFields(openingA, localA) }, roomB, { ...openingB, ...openingSpanFields(openingB, localB) })) {
      return null;
    }

    if (plan.width < openingA.width) {
      narrowOpening(roomA, openingA, narrowed.from, narrowed.to);
      narrowOpening(roomB, openingB, narrowed.from, narrowed.to);
    }

    const connection = {
      id: nextConnectionId(openingA.id, openingB.id),
      a: { roomId: roomA.id, openingId: openingA.id },
      b: { roomId: roomB.id, openingId: openingB.id },
      kind: plan.kind,
      width: plan.width,
      height: openingA.height,
      joint: plan.joint,
      bridge: plan.bridge,
    };
    commitConnection(connection, roomA, openingA, roomB, openingB);
    // The openings just moved to their narrowed span: their index key is the
    // centre cell *on the room's face*, so a stale key would leave the other
    // openings pointing at a door that is no longer there.
    index.refreshOpenings(roomA);
    index.refreshOpenings(roomB);
    refreshDepths(entranceRoomId || roomB.id);
    stats.reused += 1;
    stats.loops += 1;
    return connection;
  }

  /**
   * Closes every loop a freshly placed room can close.
   *
   * A new room often lands with one or two openings pointing at an older room
   * across the joint. Those cost nothing: no generation, no blocks, one lookup
   * each. Calling this after every commit is what turns the spanning tree the
   * generator builds into a network with shortcuts.
   */
  function closeLoops(room) {
    const closed = [];
    for (let index_ = 0; index_ < room.openings.length; index_ += 1) {
      const opening = room.openings[index_];
      if (opening.status !== OPENING_STATUS.PENDING) continue;
      const reused = tryReuse(room, opening);
      if (reused) closed.push(reused);
    }
    return closed;
  }

  /**
   * Develops one opening: reuse if possible, else generate, validate, commit.
   *
   * Returns `{ ok, kind, room, connection, code }`. A refusal changes nothing:
   * the opening stays pending, with one more failure recorded, and becomes
   * blocked only after `maxGenerationAttempts` failures.
   */
  function expand(roomId, openingId, options_ = {}) {
    const room = rooms.get(roomId);
    if (!room) return { ok: false, code: "NO_ROOM" };
    const opening = room.openings.find((entry) => entry.id === openingId);
    if (!opening) return { ok: false, code: "NO_OPENING" };
    if (opening.status !== OPENING_STATUS.PENDING) {
      return { ok: false, code: "NOT_PENDING", status: opening.status };
    }

    // 1. A loop or a shortcut costs nothing and consumes no generation budget.
    const reused = tryReuse(room, opening);
    if (reused) return { ok: true, kind: "reuse", connection: reused };

    // 2. A new room, aligned on this opening.
    const baseSeed = options_.seed === undefined
      ? roomSeed(seed, room.id, opening.id)
      : options_.seed;
    const exclude = options_.exclude || null;

    for (let attempt = 0; attempt < DUNGEON_CONFIG.maxGenerationAttempts; attempt += 1) {
      stats.candidates += 1;
      const shape = generateShape(baseSeed, attempt, { exclude });
      if (!shape.ok) {
        noteRefusal(shape.reason);
        continue;
      }

      // The child opening must face the parent: only the opposite face can be
      // the one we hang from, and only a span of the same width.
      const planned = planOpenings("pending", shape.mask, baseSeed);
      const candidates = planned.openings.filter(
        (entry) => entry.side === oppositeOf(opening.side) && entry.width === opening.width,
      );
      if (candidates.length === 0) {
        noteRefusal(REFUSAL.DOOR_MISMATCH);
        continue;
      }

      // Try each candidate opening of the child: the first that validates wins.
      //
      // Ordered by how much of the parent's doorway the child's doorway actually
      // faces. `placeRoomForOpening` centres the two spans on each other, so the
      // overlap is the window on the parent's door; a candidate that covers at
      // least `minConnectionOverlap` cells gives a corridor as wide as the hole,
      // and anything less is a room hung by two cells of a five-cell door.
      const usable = candidates.filter((entry) => Math.min(opening.width, entry.width) >= DUNGEON_CONFIG.minConnectionOverlap);
      for (let at = 0; at < (usable.length > 0 ? usable.length : candidates.length); at += 1) {
        const childOpeningTemplate = (usable.length > 0 ? usable : candidates)[at];
        const origin = placeRoomForOpening(room, opening, shape.mask, childOpeningTemplate);
        const childId = options_.childId || nextRoomId(room.id, opening.id);
        if (options_.childId && rooms.has(childId)) {
          // Already generated by another request for the same opening.
          return { ok: false, code: "DUPLICATE_PENDING" };
        }
        const openings = rebrandOpenings(planned.openings, childId);
        // Match by identity, not by array position: `index` was removed from
        // the opening record, and a positional lookup silently produced
        // `undefined` when the two lists diverged.
        const childOpening = openings.find((entry) => entry.id === rebrandId(childOpeningTemplate.id, childId));
        const nearby = index.queryRect(grownRect(shape.mask, origin));
        const clearances = clearanceMap(shape.mask);
        const verdict = validateRoom({
          candidate: { mask: shape.mask, origin, openings },
          nearby,
          parent: { room, opening },
          childOpening,
          radius,
          clearances,
          corridors: corridorCells,
        });
        if (!verdict.ok) {
          noteRefusal(verdict.code);
          continue;
        }

        const child = makeRoomRecord(
          childId,
          shape.mask,
          origin,
          openings,
          baseSeed,
          room.depth + 1,
          { roomId: room.id, openingId: opening.id },
        );
        // The corridor is exactly the window the two doorways share. Both are
        // narrowed to it *before* the commit, so no state ever describes a door
        // wider than the hole in front of it, and the joint is carved through the
        // shared cells rather than through the parent's original span.
        const shared = sharedSpan(room, opening, origin, childOpening);
        narrowOpening(room, opening, shared.from, shared.to);
        narrowOpening({ origin }, childOpening, shared.from, shared.to);
        const connection = {
          id: nextConnectionId(opening.id, childOpening.id),
          a: { roomId: room.id, openingId: opening.id },
          b: { roomId: childId, openingId: childOpening.id },
          kind: "direct",
          width: shared.to - shared.from + 1,
          height: opening.height,
          joint: jointCells(room, opening),
          // Declared even when empty: a shape that only sometimes has the field
          // forces every reader to guard, and one of them will forget.
          bridge: [],
        };
        // Single commit point: room, connection, statuses, index, depths.
        commitRoom(child);
        commitConnection(connection, room, opening, child, childOpening);
        refreshDepths(entranceRoomId || childId);
        // The new room may close one or more loops immediately.
        const loops = closeLoops(child);
        return { ok: true, kind: "created", room: child, connection, loops };
      }
    }

    opening.failures += 1;
    const blocked = opening.failures >= DUNGEON_CONFIG.maxGenerationAttempts;
    if (blocked) {
      opening.status = OPENING_STATUS.BLOCKED;
      index.refreshOpenings(room);
    }
    // The caller needs the reason, not the fact that attempts ran out: the
    // diagnostic tool is useless if every dead branch looks the same.
    return { ok: false, code: lastRefusal || "NO_FREE_SPACE", blocked, attempts: opening.failures };
  }

  /**
   * The cells two facing doorways share, in world coordinates, once the child has
   * been placed at `childOrigin`.
   *
   * Both spans are read on the axis *along* the wall — the same axis for the two
   * doorways, since opposite faces run the same way — so the shared window is a
   * plain interval intersection. It is computed before either doorway is narrowed,
   * because narrowing one and then measuring the other is how a corridor ends up
   * one cell wider than the door it leaves.
   */
  function sharedSpan(parentRoom, parentOpening, childOrigin, childOpening) {
    const vertical = parentOpening.side === "north" || parentOpening.side === "south";
    const parentBase = vertical ? parentRoom.origin.x : parentRoom.origin.y;
    const childBase = vertical ? childOrigin.x : childOrigin.y;
    const from = Math.max(parentBase + parentOpening.offsetStart, childBase + childOpening.offsetStart);
    const to = Math.min(parentBase + parentOpening.offsetEnd, childBase + childOpening.offsetEnd);
    return { from, to };
  }

  /** The two span fields a doorway would have, without mutating it. */
  function openingSpanFields(opening, span) {
    const alongX = opening.side === "north" || opening.side === "south";
    const middle = span.from + Math.floor((span.to - span.from) / 2);
    return {
      offsetStart: span.from,
      offsetEnd: span.to,
      width: span.to - span.from + 1,
      ...(alongX ? { centerX: middle } : { centerY: middle }),
    };
  }

  /** The identifier an opening would have once its room is known. */
  function rebrandId(openingId, roomId) {
    const dot = openingId.indexOf(".");
    return dot === -1 ? `${roomId}.${openingId}` : `${roomId}${openingId.slice(dot)}`;
  }

  function rebrandOpenings(openings, roomId) {
    return openings.map((opening, index) => ({
      ...opening,
      id: `${roomId}.o${index}`,
      roomId,
    }));
  }

  function grownRect(mask, origin) {
    const margin = DUNGEON_CONFIG.structureMargin + 1;
    return {
      x1: origin.x - margin,
      y1: origin.y - margin,
      x2: origin.x + mask.w - 1 + margin,
      y2: origin.y + mask.h - 1 + margin,
    };
  }

  function oppositeOf(side) {
    return { north: "south", south: "north", east: "west", west: "east" }[side];
  }

  // ------------------------------------------------------------ inspection --

  function getRoom(roomId) {
    return rooms.get(roomId) || null;
  }

  function getConnection(connectionId) {
    return connections.get(connectionId) || null;
  }

  function allRooms() {
    const list = [];
    rooms.forEach((room) => list.push(room));
    return list;
  }

  function allConnections() {
    const list = [];
    connections.forEach((connection) => list.push(connection));
    return list;
  }

  /** Openings still worth developing, with the room they belong to. */
  function pendingOpenings() {
    const list = [];
    rooms.forEach((room) => {
      for (let index_ = 0; index_ < room.openings.length; index_ += 1) {
        const opening = room.openings[index_];
        if (opening.status === OPENING_STATUS.PENDING) list.push({ room, opening });
      }
    });
    return list;
  }

  function neighbours(roomId) {
    const room = rooms.get(roomId);
    if (!room) return [];
    const list = [];
    for (let index_ = 0; index_ < room.connections.length; index_ += 1) {
      const connection = connections.get(room.connections[index_]);
      if (!connection) continue;
      const otherId = connection.a.roomId === roomId ? connection.b.roomId : connection.a.roomId;
      const other = rooms.get(otherId);
      if (other && other.id !== roomId) list.push(other);
    }
    return list;
  }

  /**
   * Doorway cell of an opening, in the room's own coordinates: the cell a
   * player stands on when they walk through it.
   */
  function doorwayCell(room, opening) {
    return {
      x: room.origin.x + opening.centerX - opening.vectorX,
      y: room.origin.y + opening.centerY - opening.vectorY,
    };
  }

  function setBuildState(roomId, state, cursor) {
    const room = rooms.get(roomId);
    if (!room) return false;
    room.buildState = state;
    room.buildCursor = cursor === undefined ? room.buildCursor : cursor;
    return true;
  }

  return {
    seed,
    difficulty,
    radius,
    stats,
    counters,
    get indexHits() { return indexHits; },
    get lastRejections() { return lastRejections; },
    createEntrance,
    expand,
    getRoom,
    getConnection,
    allRooms,
    allConnections,
    pendingOpenings,
    neighbours,
    doorwayCell,
    setBuildState,
    tryReuse,
    tip: null,
    get entranceRoomId() {
      return entranceRoomId;
    },
    get roomCount() {
      return rooms.size;
    },
    get connectionCount() {
      return connections.size;
    },
    index,
  };
}
