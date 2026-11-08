/*
 * The controller: one cycle, three jobs, three budgets.
 *
 * It owns the only loop of the dungeon. It reads players, asks discovery what is
 * urgent, asks the manager to generate, and hands validated rooms to the
 * builder. It never generates geometry itself, never writes a block, and never
 * keeps a timer: the host calls `tick()` from its own scheduler.
 *
 * The three operations are separated because they cost three different orders of
 * magnitude. A discovery scan reads a few positions; a generation builds a shape
 * and validates it; a construction writes hundreds of blocks into chunks that
 * may not even be loaded. Running them at the same frequency would either starve
 * the graph or melt the tick.
 */

import { DUNGEON_CONFIG } from "./config.js";
import { discoverOpenings, distanceToRoom, locatePlayerRoom } from "./discovery.js";
import { OPENING_STATUS } from "./openings.js";
import { QUEUE, compareBuild, compareDiscovery, createQueues } from "./queues.js";

/** What the host may report about the controller's state. */
export const CYCLE_STATE = {
  IDLE: "idle",
  DISCOVERING: "discovering",
  GENERATING: "generating",
  BUILDING: "building",
  THROTTLED: "throttled",
};

/**
 * Creates a controller around a manager.
 *
 * `builder` is optional and injected rather than imported: the builder is the
 * only module that knows about blocks, and the logical engine must stay usable
 * without it. That is what makes this whole file testable in Node.
 */
export function createDungeonController(options) {
  const manager = options.manager;
  const builder = options.builder || null;
  const queues = options.queues || null;
  const ownQueues = queues || createQueues(options.budgets || {});
  const players = new Map();
  const suspended = new Set();
  const inProgress = new Set();

  const stats = {
    ticks: 0,
    // Time spent per job, so a slow cycle can be attributed instead of guessed.
    discoverMs: 0,
    generateMs: 0,
    buildMs: 0,
    cycles: 0,
    generated: 0,
    reused: 0,
    refused: 0,
    built: 0,
    blocksWritten: 0,
    suspended: 0,
    deferred: 0,
    discoveryScans: 0,
  };

  let elapsedTicks = 0;
  let cycleRunning = false;
  let lastState = CYCLE_STATE.IDLE;

  /** Registers or updates a player. The host calls this from its own callbacks. */
  function upsertPlayer(player) {
    if (!player || !player.id || !player.position) return null;
    const point = { x: player.position.x, y: player.position.z };
    const located = locatePlayerRoom(manager, point);
    const record = {
      id: player.id,
      position: point,
      roomId: located ? located.room.id : null,
    };
    players.set(player.id, record);
    return record;
  }

  const removePlayer = (playerId) => players.delete(playerId);
  const playerList = () => [...players.values()];

  /**
   * One tick. Cheap by design: it counts, and runs a cycle when due.
   */
  function tick() {
    elapsedTicks += 1;
    stats.ticks += 1;
    if (elapsedTicks % DUNGEON_CONFIG.cycleTicks !== 0) return null;
    return cycle();
  }

  /**
   * One full cycle: discovery, then generation, then construction.
   *
   * Re-entrance is refused rather than queued: two cycles fighting over the same
   * opening is exactly how a room gets generated twice.
   */
  function cycle() {
    if (cycleRunning) {
      stats.deferred += 1;
      return lastState;
    }
    cycleRunning = true;
    stats.cycles += 1;
    const started = nowMs();
    try {
      const afterDiscovery = timeJob(discover, stats, "discoverMs", started);
      const afterGeneration = timeJob(generate, stats, "generateMs", afterDiscovery);
      timeJob(build, stats, "buildMs", afterGeneration);
      lastState = CYCLE_STATE.IDLE;
    } finally {
      cycleRunning = false;
    }
    return lastState;
  }

  /**
   * The only clock in the engine, and only for measurement.
   *
   * It uses the platform clock when the host provides one, and falls back to
   * nothing at all: a missing clock must never change behaviour, so the fallback
   * returns 0 and the counters simply stay at zero.
   */
  function nowMs() {
    const clock = typeof performance !== "undefined" ? performance.now : null;
    return clock ? clock.call(performance) : 0;
  }

  function timeJob(job, target, field, since) {
    job();
    const now = nowMs();
    target[field] += now - since;
    return now;
  }

  // ------------------------------------------------------------ discovery --

  function discover() {
    const list = playerList();
    if (list.length === 0) return;
    lastState = CYCLE_STATE.DISCOVERING;
    stats.discoveryScans += 1;
    const found = discoverOpenings({ manager, players: list });

    for (let index = 0; index < found.length; index += 1) {
      const entry = found[index];
      // Already being generated: the graph queue is the authority on that.
      if (ownQueues.has(QUEUE.GENERATION, entry)) continue;
      ownQueues.push(QUEUE.DISCOVERY, entry);
    }

    ownQueues.sort(QUEUE.DISCOVERY, compareDiscovery);
    const served = Math.min(ownQueues.size(QUEUE.DISCOVERY), DUNGEON_CONFIG.maxDiscoveryPerCycle);
    for (let index = 0; index < served; index += 1) {
      const entry = ownQueues.take(QUEUE.DISCOVERY);
      if (!entry) break;
      const room = manager.getRoom(entry.roomId);
      const opening = room && room.openings.find((candidate) => candidate.id === entry.openingId);
      // The queue is a hint; the graph is the truth.
      if (!opening || opening.status !== OPENING_STATUS.PENDING) continue;
      ownQueues.push(QUEUE.GENERATION, entry);
    }
    // Unserved entries stay queued, but the queue is capped so its size never
    // grows with the dungeon.
    ownQueues.trim(QUEUE.DISCOVERY, DUNGEON_CONFIG.maxDiscoveryPerCycle);
  }

  // ----------------------------------------------------------- generation --

  function generate() {
    lastState = CYCLE_STATE.GENERATING;
    ownQueues.sort(QUEUE.GENERATION, compareDiscovery);
    let created = 0;
    // Bounded by the budget, not by the queue length: a long queue must not turn
    // into a long tick.
    for (let guard = 0; guard < DUNGEON_CONFIG.maxGenerationPerCycle; guard += 1) {
      if (created >= DUNGEON_CONFIG.maxRoomsPerCycle) break;
      const entry = ownQueues.take(QUEUE.GENERATION);
      if (!entry) break;
      const room = manager.getRoom(entry.roomId);
      if (!room) continue;
      const opening = room.openings.find((candidate) => candidate.id === entry.openingId);
      if (!opening || opening.status !== OPENING_STATUS.PENDING) continue;

      const result = manager.expand(room.id, opening.id);
      if (result.ok && result.kind === "created") {
        created += 1;
        stats.generated += 1;
        queueBuild(result.room, entry);
      } else if (result.ok) {
        // A reuse (loop or shortcut) costs neither a room nor a budget slot.
        stats.reused += 1;
      } else {
        stats.refused += 1;
      }
    }
    if (ownQueues.size(QUEUE.GENERATION) > DUNGEON_CONFIG.backlogThreshold) {
      lastState = CYCLE_STATE.THROTTLED;
    }
  }

  // ---------------------------------------------------------------- build --

  function queueBuild(room, entry) {
    if (!builder) return;
    ownQueues.push(QUEUE.BUILD, {
      roomId: room.id,
      priority: entry && entry.priority !== undefined ? entry.priority : room.depth,
    });
  }

  function build() {
    if (!builder) return;
    lastState = CYCLE_STATE.BUILDING;
    ownQueues.sort(QUEUE.BUILD, compareBuild);
    let written = 0;
    // The bound is captured once: comparing the guard to a queue that shrinks as
    // it is drained stops the loop halfway, which looks exactly like a builder
    // that silently skips rooms.
    const budget = ownQueues.size(QUEUE.BUILD);
    for (let guard = 0; guard < budget; guard += 1) {
      // The check happens before taking the entry, so a cycle that ran out of
      // budget leaves the queue intact for the next one.
      // One more room may take the cycle slightly past the budget: the only way
      // to stay under it exactly would be to interrupt a room mid-construction,
      // and a half-built room is worse than a slightly long tick.
      if (written >= DUNGEON_CONFIG.maxBlocksPerTick) break;
      const entry = ownQueues.take(QUEUE.BUILD);
      if (!entry) break;
      if (suspended.has(entry.roomId)) {
        stats.suspended += 1;
        continue;
      }
      const room = manager.getRoom(entry.roomId);
      if (!room || inProgress.has(room.id)) continue;
      // A room whose construction is resumed is finished later; it is never
      // dropped, so it goes back to the head of the next cycle's queue.
      const sizeBefore = ownQueues.size(QUEUE.BUILD);
      inProgress.add(room.id);
      let blocks = 0;
      try {
        blocks = builder.buildRoom(room) || 0;
      } finally {
        inProgress.delete(room.id);
      }
      written += blocks;
      stats.blocksWritten += blocks;
      if (blocks > 0) stats.built += 1;
      if (blocks === 0 && ownQueues.size(QUEUE.BUILD) === sizeBefore) {
        // The builder accepted nothing this time and did not re-queue itself:
        // put it back so a later cycle retries instead of losing the room.
        ownQueues.push(QUEUE.BUILD, entry);
        break;
      }
    }
  }

  // ----------------------------------------------------------- suspension --

  /**
   * Postpones construction of rooms no player is near, when the queue is long.
   *
   * Suspension is a construction decision only: the room stays in the graph, its
   * openings stay available, and it comes back the moment somebody approaches.
   * Dropping it from the graph would lose the branch.
   */
  function suspendFarRooms() {
    if (ownQueues.size(QUEUE.BUILD) <= DUNGEON_CONFIG.backlogThreshold) return 0;
    const list = playerList();
    let count = 0;
    for (const room of manager.allRooms()) {
      const near = list.some(
        (player) => distanceToRoom(player.position, room) <= DUNGEON_CONFIG.activeRoomDistance,
      );
      if (near) {
        suspended.delete(room.id);
        continue;
      }
      const far = list.every(
        (player) => distanceToRoom(player.position, room) > DUNGEON_CONFIG.suspendDistance,
      );
      if (far) {
        suspended.add(room.id);
        count += 1;
      }
    }
    stats.suspended = count;
    return count;
  }

  function setSuspended(roomId, value) {
    if (value) suspended.add(roomId);
    else suspended.delete(roomId);
  }

  return {
    manager,
    queues: ownQueues,
    stats,
    tick,
    cycle,
    upsertPlayer,
    removePlayer,
    playerList,
    suspendFarRooms,
    setSuspended,
    isSuspended(roomId) { return suspended.has(roomId); },
    get state() { return lastState; },
    get busy() { return cycleRunning; },
    pendingBuilds() { return ownQueues.snapshot(QUEUE.BUILD); },
  };
}
