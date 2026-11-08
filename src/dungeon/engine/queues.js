/*
 * The three queues, and the rules that keep them honest.
 *
 * Discovery, generation and construction are three different jobs with three
 * different costs, so they get three queues and three budgets. Mixing them is
 * how a game ends up spending its whole tick generating rooms nobody will see
 * for another minute.
 *
 * Every queue is a list plus a membership map: the anti-duplicate check is one
 * `Map` read, never a scan. Nothing here touches the world, and nothing here is
 * persisted — a queue is rebuilt from the graph and the players after a restart.
 */

/** Names of the three queues. */
export const QUEUE = {
  DISCOVERY: "discovery",
  GENERATION: "generation",
  BUILD: "build",
};

/**
 * Creates the three queues.
 *
 * `budgets` overrides the defaults, which is how tests exercise the limits
 * without generating thousands of rooms.
 */
export function createQueues(budgets = {}) {
  const limits = {
    discovery: budgets.discovery || 40,
    generation: budgets.generation || 10,
    build: budgets.build || 800,
  };

  const lists = { discovery: [], generation: [], build: [] };
  const membership = { discovery: new Map(), generation: new Map(), build: new Map() };
  const dropped = { discovery: 0, generation: 0, build: 0 };

  // A room appears once in the build queue; an opening appears once in each of
  // the two graph queues. Different keys for different jobs, on purpose.
  // A room appears once by its identifier; the passage that leads to it is a
  // separate entry keyed by the connection, so both are queued without one
  // shadowing the other.
  const keyOf = (queueName, entry) => (queueName === QUEUE.BUILD
    ? `${entry.roomId}${entry.connectionId ? `#${entry.connectionId}` : ""}`
    : `${entry.roomId}/${entry.openingId}`);

  /**
   * Adds an entry, or updates it when it is already queued.
   *
   * Updating instead of duplicating means a doorway whose player walked closer
   * is served at its new priority, and two players discovering the same doorway
   * in the same tick do not generate it twice.
   */
  function push(queueName, entry) {
    const key = keyOf(queueName, entry);
    const existing = membership[queueName].get(key);
    if (existing) {
      Object.assign(existing, entry);
      return existing;
    }
    const stored = { ...entry };
    lists[queueName].push(stored);
    membership[queueName].set(key, stored);
    return stored;
  }

  function has(queueName, entry) {
    return membership[queueName].has(keyOf(queueName, entry));
  }

  function take(queueName) {
    const entry = lists[queueName].shift();
    if (!entry) return null;
    membership[queueName].delete(keyOf(queueName, entry));
    return entry;
  }

  function remove(queueName, entry) {
    const key = keyOf(queueName, entry);
    const stored = membership[queueName].get(key);
    if (!stored) return false;
    membership[queueName].delete(key);
    const at = lists[queueName].indexOf(stored);
    if (at !== -1) lists[queueName].splice(at, 1);
    return true;
  }

  /** Sorts a queue in place; `compare` must be total so the order is stable. */
  function sort(queueName, compare) {
    lists[queueName].sort(compare);
  }

  /** Keeps the most urgent `limit` entries and counts what was dropped. */
  function trim(queueName, limit) {
    const list = lists[queueName];
    while (list.length > limit) {
      const gone = list.pop();
      membership[queueName].delete(keyOf(queueName, gone));
      dropped[queueName] += 1;
    }
  }

  const size = (queueName) => lists[queueName].length;
  const snapshot = (queueName) => lists[queueName].map((entry) => ({ ...entry }));

  function clear(queueName) {
    for (const entry of lists[queueName]) membership[queueName].delete(keyOf(queueName, entry));
    lists[queueName].length = 0;
  }

  return {
    limits,
    push,
    has,
    take,
    remove,
    sort,
    trim,
    size,
    snapshot,
    clear,
    dropped,
    stats() {
      return {
        discovery: lists.discovery.length,
        generation: lists.generation.length,
        build: lists.build.length,
        dropped: { ...dropped },
      };
    },
  };
}

/**
 * Ordering of a discovery list: class, then priority, then identifier.
 *
 * The identifier is the last key so two entries with the same priority are still
 * ordered deterministically. An unstable sort would only look like a flaky test
 * much later.
 */
export function compareDiscovery(a, b) {
  if (a.bucket !== b.bucket) return a.bucket - b.bucket;
  if (a.priority !== b.priority) return a.priority - b.priority;
  const left = `${a.roomId}/${a.openingId}`;
  const right = `${b.roomId}/${b.openingId}`;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Ordering of a generation list: same rule, no identifier tie-break needed. */
export function compareGeneration(a, b) {
  if (a.bucket !== b.bucket) return a.bucket - b.bucket;
  return a.priority - b.priority;
}

/** Ordering of a build list: rooms closest to a player first, then by id. */
export function compareBuild(a, b) {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : 0;
}
