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
    resumed: 0,
    repairs: 0,
    passages: 0,
    discoveryScans: 0,
    buildTicks: 0,
    verified: 0,
    verifyFailures: 0,
    skippedAir: 0,
    // Wall-clock cost of one tick, and how much work the tick budget refused to
    // start. `budgetHits` is the number that explains a slow build: work that is
    // deferred is not lost, it is served by the next tick.
    tickMs: 0,
    worstTickMs: 0,
    budgetHits: 0,
    generatedDeferred: 0,
    builtDeferred: 0,
  };

  let elapsedTicks = 0;
  let cycleRunning = false;
  /** End of the current tick's time budget, or `null` when there is no clock. */
  let deadline = null;
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
   * One tick.
   *
   * Construction runs **every tick**, on its own budget; discovery and
   * generation keep running at their own, much slower cadence. They were once
   * welded together, which meant the world was written one tick in twenty: a
   * dungeon took twenty seconds to appear and the graph was not the reason.
   * Writing is cheap per tick; deciding is not, and the two do not belong to the
   * same clock.
   */
  function tick() {
    elapsedTicks += 1;
    stats.ticks += 1;
    const started = nowMs();
    // The deadline of this tick, shared by construction, discovery and
    // generation: the three run in the same tick and the world pays for all of
    // them. `null` when the host has no clock, in which case the three other
    // budgets are the only limits and nothing changes.
    deadline = deadlineOf(started);
    try {
      // Construction first: it is what the player is waiting for, and it costs a
      // bounded number of blocks.
      const built = buildStep();
      stats.buildTicks += 1;
      if (built) lastState = built;
      if (elapsedTicks % DUNGEON_CONFIG.cycleTicks !== 0) return null;
      return cycle();
    } finally {
      const spent = nowMs() - started;
      stats.tickMs = spent;
      if (spent > stats.worstTickMs) stats.worstTickMs = spent;
      deadline = null;
    }
  }

  /**
   * The moment this tick must stop starting work, or `null` when there is no
   * clock to measure it with.
   *
   * The budget is expressed in milliseconds because the constraint Bloxd imposes
   * is one: a tick that runs too long is killed with
   * `InternalError: interrupted`, which the player reads in chat. Every other
   * budget here counts work; this one counts the thing the engine actually
   * punishes.
   */
  function deadlineOf(started) {
    if (!started) return null;
    return started + DUNGEON_CONFIG.tickBudgetMs * DUNGEON_CONFIG.tickReserveShare;
  }

  /** Whether a new unit of work may start in this tick. */
  function canStartWork() {
    if (deadline === null) return true;
    if (nowMs() < deadline) return true;
    stats.budgetHits += 1;
    return false;
  }

  /**
   * One full graph cycle: discovery, then generation.
   *
   * Re-entrance is refused rather than queued: two cycles fighting over the same
   * opening is exactly how a room gets generated twice.
   *
   * Construction used to run here too, which tied the world's write rate to the
   * graph's rate. It now runs every tick, in `buildStep`.
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
      timeJob(generate, stats, "generateMs", afterDiscovery);
      lastState = CYCLE_STATE.IDLE;
    } finally {
      cycleRunning = false;
    }
    return lastState;
  }

  /**
   * The construction step of one tick, on its own budget.
   *
   * It is a separate entry point so the host can drive it without touching the
   * graph, and so a cycle that generates nothing still builds something.
   */
  function buildStep() {
    if (!builder) return null;
    const started = nowMs();
    // A direct `buildStep` call — the host's own loop, a test, a repair command —
    // has no deadline of its own, so it takes one for the duration of the call.
    // Without this the budget only existed for callers that went through `tick()`,
    // and a host that drives construction itself was unbounded.
    const outerDeadline = deadline;
    if (deadline === null) deadline = deadlineOf(started);
    // The audit first: it is a bounded read of one finished room, and doing it
    // before the writes keeps a tick that is out of budget from starving it.
    if (typeof builder.auditRoom === "function") {
      const audited = builder.auditRoom(manager);
      if (audited) {
        stats.verified += 1;
        if (audited.repaired > 0) stats.repairs += audited.repaired;
        if (audited.verified === false) stats.verifyFailures += 1;
      }
    }
    if (ownQueues.size(QUEUE.BUILD) > 0) {
      // Construction and the graph never touch the same state (the builder
      // writes blocks, the cycle decides openings), so both may run in one tick.
      timeJob(build, stats, "buildMs", started);
    } else {
      stats.buildMs += nowMs() - started;
    }
    // The deadline a caller of `tick()` owns is kept until the tick ends; the one
    // taken here is dropped so it cannot leak into the next call.
    if (outerDeadline === null) deadline = null;
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
      // One room's generation is bounded (a handful of candidate shapes), so this
      // is the right place to stop: at the boundary between two units of work,
      // never inside one.
      if (!canStartWork()) {
        stats.generatedDeferred += 1;
        break;
      }
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
        queueBuild(result.room, { ...entry, connection: result.connection });
        // The loops this room closed needed a passage too, and nobody else was
        // going to ask for it.
        const loops = result.loops || [];
        for (let at = 0; at < loops.length; at += 1) queuePassage(result.room, loops[at].id, entry);
      } else if (result.ok) {
        // A reuse (loop or shortcut) costs neither a room nor a budget slot —
        // but it does pierce a wall, so its passage has to be built.
        stats.reused += 1;
        if (result.connection) {
          const room = manager.getRoom(entry.roomId);
          if (room) queuePassage(room, result.connection.id, entry);
        }
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
    const priority = entry && entry.priority !== undefined ? entry.priority : room.depth;
    // The passage is queued *first*, on purpose. The queue is served in order,
    // and a passage opens the doorways of both rooms it joins: if it ran after
    // the room, the room's own plan — computed while that doorway was still
    // pending, so with a wall in it — would be written on top of the opening.
    const connection = entry && entry.connection && entry.connection.id;
    if (connection) queuePassage(room, connection, { ...entry, priority: priority - 1 });
    ownQueues.push(QUEUE.BUILD, { roomId: room.id, priority });
  }

  /**
   * Queues the passage of one connection.
   *
   * A passage is queued for *every* connection, including the ones a loop or a
   * shortcut commits between two rooms that already exist: those rooms were
   * built while their opening was still pending, so their doorway is walled and
   * the threshold between them was never dug. Forgetting this case left whole
   * branches of the dungeon sealed behind a bricked-up door.
   *
   * `priority` is one step better than the room it leads to, so the queue — which
   * is sorted — always serves the threshold before the interior it opens onto.
   */
  function queuePassage(room, connectionId, entry) {
    if (!builder || typeof builder.buildPassage !== "function") return;
    ownQueues.push(QUEUE.BUILD, {
      roomId: room.id,
      connectionId,
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
      // Time comes before blocks: a tick that has spent its wall-clock budget
      // must not start another room, even with blocks left over. The entry stays
      // in the queue — deferring is free, interrupting a room is not. One more
      // room may take the cycle slightly past the budget, and that is deliberate:
      // the only way to stay under it exactly would be to interrupt a room
      // mid-construction, and a half-built room is worse than a slightly long tick.
      if (!canStartWork()) {
        stats.builtDeferred += 1;
        break;
      }
      if (written >= DUNGEON_CONFIG.maxBlocksPerTick) break;
      // No single entry may take the tick past the budget plus one batch. A room
      // and a passage are both written through the same batched writer, so the
      // overshoot is bounded by `blocksPerBatch` per entry that is running when
      // the budget runs out — and "the overshoot is at most one room" stopped
      // being true the day a room could be 3 000 cells of shell.
      const ceiling = DUNGEON_CONFIG.maxBlocksPerTick + DUNGEON_CONFIG.blocksPerBatch;
      if (written >= ceiling) break;
      // The passages are checked *before* an entry is taken, so a cycle that
      // reached its budget leaves the queue exactly as it was: taking an entry
      // to push it back would reorder the queue for no reason.
      const entry = ownQueues.take(QUEUE.BUILD);
      if (!entry) break;
      if (suspended.has(entry.roomId)) {
        stats.suspended += 1;
        continue;
      }
      const room = manager.getRoom(entry.roomId);
      if (entry.connectionId) {
        // A passage is small and finishes in one pass, so it has no cursor. It
        // is still guarded by the chunk check inside the builder.
        const connection = manager.getConnection(entry.connectionId);
        if (!connection) continue;
        const passage = builder.buildPassage(connection, manager) || {};
        const cost = passage.blocks || 0;
        written += cost;
        stats.blocksWritten += cost;
        if (passage.done === true && cost > 0) stats.passages += 1;
        // A threshold whose chunk is not loaded yet — or that is only half
        // written, now that a passage is served one batch at a time like a room —
        // goes back in the queue. Dropping it lost the passage for good, and a
        // room whose only connection was lost is unreachable: the dungeon then has
        // rooms that are built, visible, and impossible to enter.
        if (passage.done !== true) {
          ownQueues.push(QUEUE.BUILD, entry);
          stats.resumed += 1;
          // A batch that filled the budget ends the cycle here. Continuing is how
          // a backlog of thresholds starves everything behind it, and it also
          // means the ceiling below is checked on the next entry rather than after
          // the work is done.
          if (cost >= DUNGEON_CONFIG.blocksPerBatch) written = ceiling;
          continue;
        }
        continue;
      }
      if (!room || inProgress.has(room.id)) continue;
      const sizeBefore = ownQueues.size(QUEUE.BUILD);
      inProgress.add(room.id);
      let outcome = null;
      try {
        outcome = builder.buildRoom(room);
      } finally {
        inProgress.delete(room.id);
      }
      // A builder may report `{ blocks, done }` or a bare block count. Both are
      // accepted, but the resumption rule is not optional: a room that is only
      // half written must be queued again, or the rest of it is never built and
      // the player walks into a half-dug hole.
      const blocks = typeof outcome === "number" ? outcome : (outcome && outcome.blocks) || 0;
      // `done` is authoritative when the builder provides it: a finished room
      // costs nothing on its last pass, and reading "0 blocks" as "unfinished"
      // put it back in the queue for ever. The bare-number contract can only
      // mean "written something, therefore finished".
      const reportedDone = typeof outcome === "object" && outcome !== null && typeof outcome.done === "boolean"
        ? outcome.done
        : blocks > 0;
      const halfBuilt = !reportedDone;
      written += blocks;
      stats.blocksWritten += blocks;
      if (!halfBuilt) {
        stats.built += 1;
        // The room is finished, and its plan was frozen when it started. A
        // doorway that became a connection since then is still walled in that
        // plan, so the wall is cleared once more, now that nothing will write
        // over it.
        if (typeof builder.reopenDoorways === "function") {
          const cleared = builder.reopenDoorways(room) || 0;
          written += cleared;
          stats.blocksWritten += cleared;
        }
      }
      if (halfBuilt) {
        // Back of the queue, and keep going. Breaking here served exactly one
        // room per cycle: a dungeon that needs nine passes per room then queued
        // every threshold behind a room that never finished, and the passages
        // were left unbuilt while their rooms were there to be seen.
        if (ownQueues.size(QUEUE.BUILD) === sizeBefore) ownQueues.push(QUEUE.BUILD, entry);
        stats.resumed += 1;
        continue;
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
    buildStep,
    upsertPlayer,
    removePlayer,
    playerList,
    suspendFarRooms,
    setSuspended,
    isSuspended(roomId) { return suspended.has(roomId); },
    get state() { return lastState; },
    get busy() { return cycleRunning; },
    pendingBuilds() { return ownQueues.snapshot(QUEUE.BUILD); },
    /** The wall-clock budget of a tick, in milliseconds. */
    get tickBudgetMs() { return DUNGEON_CONFIG.tickBudgetMs; },
  };
}
