/*
 * Deterministic random numbers and identifiers.
 *
 * Two rules, both required by the specification:
 *   1. no shared mutable random generator: every value comes from a hash of
 *      explicit inputs, so the result never depends on execution order;
 *   2. a room must be rebuildable from its identity alone.
 *
 * Hash functions are integer only (FNV-1a and mulberry32). They avoid
 * Math.imul-free bit tricks where possible, but rely on `>>>` and `|0`, which
 * are ECMAScript core and available in Bloxd.
 */

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/** FNV-1a over a string, as an unsigned 32 bit integer. */
export function hashString(text) {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    // hash * FNV_PRIME, kept in 32 bits without Math.imul.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/** FNV-1a over a list of scalars, joined with a separator that cannot appear. */
export function hashParts(...parts) {
  return hashString(parts.join("\u0001"));
}

/** mulberry32: small, fast, and fully determined by its 32 bit seed. */
export function createRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = ((t ^ (t >>> 15)) * (1 | t)) >>> 0;
    t = (t + (((t << 7) | (t >>> 25)) * (61 | t))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random source with the small helpers every generator needs. */
export function createRandomSource(seed) {
  const next = createRandom(seed);
  return {
    next,
    /** Integer in [min, max], both inclusive. */
    int(min, max) {
      if (max <= min) return min;
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(probability) {
      return next() < probability;
    },
    pick(list) {
      if (!list || list.length === 0) return null;
      return list[Math.floor(next() * list.length)];
    },
    /** Copy shuffled by Fisher-Yates; the input is never mutated. */
    shuffled(list) {
      const copy = list.slice();
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const at = Math.floor(next() * (index + 1));
        const swap = copy[index];
        copy[index] = copy[at];
        copy[at] = swap;
      }
      return copy;
    },
  };
}

/**
 * Seed of one room. The identity of the parent opening, the parent room and the
 * dungeon seed are the only inputs, so the same room is produced whatever the
 * order in which the player explored the dungeon.
 *
 * `attempt` is part of the identity as well: a rejected attempt must be
 * reproducible, otherwise a validation that fails once would fail randomly.
 */
export function roomSeed(dungeonSeed, parentRoomId, openingId) {
  return hashParts("room", dungeonSeed, parentRoomId, openingId);
}

export function attemptSeed(seed, attempt) {
  return hashParts("attempt", seed, attempt);
}

/** Base-36 identifier, prefixed so a log line is readable at a glance. */
export function makeId(prefix, counter) {
  return `${prefix}${counter.toString(36)}`;
}
