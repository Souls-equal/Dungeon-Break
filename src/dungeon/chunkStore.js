/*
 * Chunk storage: one dungeon's per-chunk facts, written into a block's data.
 *
 * What goes in
 * -----------
 * For every chunk of a dungeon:
 *
 *   - **plans**: the rooms and thresholds whose cells touch the chunk, with the
 *     block volume each one writes. A plan is a pure function of the room seed,
 *     so storing it is a cache, not a source of truth — but it is the cache the
 *     builder recomputes thousands of times, and it is what tells a resumed
 *     build exactly what the chunk should contain;
 *   - **progress**: which rooms and thresholds of the chunk are written, which
 *     are half written (and at which cursor), which are waiting for their chunk.
 *
 * Why a block's data is a valid home for it
 * -----------------------------------------
 * The format is the one the API documents, and nothing else:
 *
 *   api.setBlockData(x, y, z, { …plain object… })   // the doc's type is `object`
 *   api.getBlockData(x, y, z) → any
 *
 * The doc adds one warning — "Data is cleared when block changes" — and that is
 * the rule this module is built around rather than against: **the anchor block is
 * written once, before its data, and never written again.** A plain cell is
 * written at most once by construction (three tests in `builder.test` enforce
 * that), and the anchor goes further: `worldBuilder` **seals** it, so even a
 * repair pass, a room built over that corner, or a second record write cannot
 * issue the `setBlock` that would erase the data. When something else does
 * overwrite the anchor — a player who breaks it, an admin edit, a world reset —
 * its data is gone, and `readChunkRecord` reports `NO_ANCHOR` with the block it
 * found instead, rather than pretending.
 *
 * What is deliberately **not** stored, because the API does not document it:
 *
 *   - no string over a few hundred characters (the doc promises nothing about
 *     size, so the record is chunked and the caller keeps the chunks small);
 *   - no `null`/`undefined` inside the object: the record is plain numbers,
 *     booleans and short strings, so a round trip cannot change its shape;
 *   - no functions, no arrays of objects where a flat array of numbers will do:
 *     the doc says `object` and stops there, so the payload stays boring.
 *
 * The record is versioned. A record written by an older build is read and
 * rejected by version, never misread as the current shape.
 */

import { DUNGEON_CONFIG } from "./engine/config.js";

/** Bumped whenever the shape of a record changes. */
export const CHUNK_RECORD_VERSION = 1;

/**
 * The block the anchor sits on.
 *
 * A block that is already part of the structure would be a trap: the builder
 * writes it, which clears the data. This one is chosen to be *outside* the
 * palette (`STONE_PALETTE`, floors, ceiling, pad), so a chunk can never contain a
 * second one by accident — and the report can find it by name alone.
 */
export const CHUNK_ANCHOR_BLOCK = "Polished Diorite";

/** Longest string a record may carry, and longest flat array. */
export const CHUNK_RECORD_LIMITS = {
  // A room plan identifier is `r0.0.1`, a chunk id is a short string: 24 is
  // enough for both and short enough that a record stays cheap.
  maxStringLength: 24,
  // 5 000 ids in one record is 2 500 rooms: far beyond any dungeon this engine
  // builds (48 rooms), and still a bounded payload.
  maxIdentifiers: 5000,
};

/**
 * Where the anchor of a chunk lives: the corner of the chunk, **one block above the
 * floor** — the block a player's feet occupy over the corner cell of the dungeon.
 *
 * Why above the floor and not on it
 * ---------------------------------
 * On the floor level the anchor cell is a **structural** cell of the dungeon: any
 * room whose footprint covers the chunk's corner writes a floor block or a wall
 * there, and every one of those writes clears the data. Reserving the cell only
 * helped when the anchor happened to be written first. One block higher the cell
 * is air — the interior of a room, or the open space of a corridor — so nothing
 * the builder produces ever lands on it, and the anchor is genuinely alone.
 *
 * Why not lower
 * -------------
 * A chunk is 32 blocks tall, so `floorY - 1` is very often a **different chunk**:
 * the chunk below the one the player is standing in, which the server has not
 * sent, and a write there is lost without an error. One block above the floor is
 * the same chunk, loaded by the same player, one cell over.
 *
 * The anchor is therefore air in a normal dungeon: `writeAnchor` writes it once
 * (creating the block) and seals the cell. It shows as a single `Polished Diorite`
 * block floating over the corner of every chunk the dungeon touches — which is
 * also how `/dbg chunk` and a player can find it.
 */
export function anchorOf(chunkX, chunkZ, floorY) {
  const size = DUNGEON_CONFIG.chunkSize;
  return {
    x: chunkX * size,
    y: floorY + 1,
    z: chunkZ * size,
  };
}

/** The chunk a cell belongs to, on the two ground axes. */
export function chunkOfCell(x, z) {
  const size = DUNGEON_CONFIG.chunkSize;
  return { x: Math.floor(x / size), z: Math.floor(z / size) };
}

/** `x,z` key of a chunk, the form the records carry. */
export const chunkKey = (chunkX, chunkZ) => `${chunkX},${chunkZ}`;

/**
 * Builds the record of one chunk.
 *
 * Pure: it takes what the caller knows and returns the exact object to hand to
 * `setBlockData`. Nothing is read from the world here.
 */
export function createChunkRecord(options) {
  const dungeonId = options.dungeonId === undefined ? "" : String(options.dungeonId);
  const seed = options.seed === undefined ? 0 : options.seed;
  const chunkX = options.chunkX;
  const chunkZ = options.chunkZ;
  const plans = Array.isArray(options.plans) ? options.plans : [];
  const progress = Array.isArray(options.progress) ? options.progress : [];
  const anchor = options.anchor || anchorOf(chunkX, chunkZ, DUNGEON_CONFIG.floorY);

  if (dungeonId.length > CHUNK_RECORD_LIMITS.maxStringLength) {
    throw new RangeError(`dungeon id is too long for a chunk record: ${dungeonId.length} characters`);
  }
  if (plans.length > CHUNK_RECORD_LIMITS.maxIdentifiers) {
    throw new RangeError(`too many plans for one chunk record: ${plans.length}`);
  }

  return {
    // `v` first, so a reader can reject a foreign record before touching it.
    v: CHUNK_RECORD_VERSION,
    id: dungeonId,
    seed,
    cx: chunkX,
    cz: chunkZ,
    // One plan per line: `kind|blocks|id` — kind is "room" or "passage", blocks is
    // how many cells the plan writes, and the id is **last** because a connection
    // id contains colons and plus signs (`c:r0.0.o1+r0.o2`): a separator that can
    // appear in the payload is how a format breaks on its second day.
    plans: plans.map((plan) => `${plan.kind}|${plan.blocks === undefined ? 0 : plan.blocks}|${plan.id}`),
    // One progress per line: `kind|state|cursor|id`, with the same rule. A room
    // whose build has not started has no cursor, and the record holds no `null`:
    // `-1` is the sentinel and the parser turns it back into `null`. The difference
    // matters — "no cursor" and "cursor 0" are not the same progress.
    progress: progress.map((entry) => `${entry.kind}|${entry.state}|${entry.cursor === null || entry.cursor === undefined ? -1 : entry.cursor}|${entry.id}`),
    // Seconds-resolution stamp is deliberately absent: a record that changes with
    // the clock cannot be compared between two reads. `tick` is the dungeon's own
    // tick counter, which is what a report wants anyway.
    tick: options.tick === undefined ? 0 : options.tick,
    // The anchor's own altitude, so a reader never has to guess where the block
    // it just read lives. `y` is not a "fact about the chunk" like the others:
    // it is what makes the record self-locating if the floor moves.
    y: anchor.y,
  };
}

/**
 * Parses `kind|blocks|id`, returning null on anything malformed.
 *
 * The id is the last field and is not split further: a connection id contains
 * colons, and the first version of this format used `:` as the separator — it
 * broke on the first passage, which is exactly what the round-trip test is for.
 */
function parsePlan(text) {
  if (typeof text !== "string") return null;
  const first = text.indexOf("|");
  const second = text.indexOf("|", first + 1);
  if (first <= 0 || second <= first) return null;
  const kind = text.slice(0, first);
  if (kind !== "room" && kind !== "passage") return null;
  const blocks = Number(text.slice(first + 1, second));
  if (!Number.isFinite(blocks)) return null;
  const id = text.slice(second + 1);
  if (id.length === 0) return null;
  return { kind, id, blocks };
}

/** Parses `kind|state|cursor|id`, returning null on anything malformed. */
function parseProgress(text) {
  if (typeof text !== "string") return null;
  const first = text.indexOf("|");
  const second = text.indexOf("|", first + 1);
  const third = text.indexOf("|", second + 1);
  if (first <= 0 || second <= first || third <= second) return null;
  const kind = text.slice(0, first);
  if (kind !== "room" && kind !== "passage") return null;
  const state = text.slice(first + 1, second);
  const cursor = Number(text.slice(second + 1, third));
  if (!Number.isFinite(cursor) || state.length === 0) return null;
  const id = text.slice(third + 1);
  if (id.length === 0) return null;
  return { kind, id, state, cursor: cursor < 0 ? null : cursor };
}

/**
 * Reads and validates a record.
 *
 * Returns `{ ok: true, record }` with the parsed shape, or `{ ok: false, code }`
 * with the reason. A record of another version is refused by version; a record
 * that is not an object at all is refused as `NOT_A_RECORD`. Nothing here throws
 * on bad input — a debug surface must never take the world down.
 */
export function parseChunkRecord(raw) {
  if (raw === null || raw === undefined) return { ok: false, code: "EMPTY" };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "NOT_A_RECORD" };
  if (raw.v !== CHUNK_RECORD_VERSION) return { ok: false, code: "VERSION", version: raw.v };

  const plans = [];
  const progress = [];
  if (Array.isArray(raw.plans)) {
    for (let index = 0; index < raw.plans.length; index += 1) {
      const plan = parsePlan(raw.plans[index]);
      if (!plan) return { ok: false, code: "BAD_PLAN", at: index };
      plans.push(plan);
    }
  }
  if (Array.isArray(raw.progress)) {
    for (let index = 0; index < raw.progress.length; index += 1) {
      const entry = parseProgress(raw.progress[index]);
      if (!entry) return { ok: false, code: "BAD_PROGRESS", at: index };
      progress.push(entry);
    }
  }
  return {
    ok: true,
    record: {
      version: raw.v,
      id: typeof raw.id === "string" ? raw.id : "",
      seed: Number.isFinite(raw.seed) ? raw.seed : 0,
      chunkX: Number.isFinite(raw.cx) ? raw.cx : 0,
      chunkZ: Number.isFinite(raw.cz) ? raw.cz : 0,
      tick: Number.isFinite(raw.tick) ? raw.tick : 0,
      y: Number.isFinite(raw.y) ? raw.y : null,
      plans,
      progress,
    },
  };
}

/**
 * Writes one chunk's record: the anchor block first, its data second.
 *
 * That order is the whole trick. `setBlock` on an existing anchor clears its data,
 * so the write is skipped when the anchor is already there and already right —
 * which is the normal case after the first time. The return value says what
 * happened, because a store that silently does nothing is untestable.
 */
export function writeChunkRecord(api, options) {
  const floorY = options.floorY === undefined ? DUNGEON_CONFIG.floorY : options.floorY;
  const anchor = options.anchor || anchorOf(options.chunkX, options.chunkZ, floorY);
  const record = createChunkRecord({ ...options, chunkX: options.chunkX, chunkZ: options.chunkZ, anchor });

  // `null` is the documented answer for an unloaded chunk; writing into it loses
  // both the block and the record, so nothing is written and the caller is told.
  const current = typeof api.getBlock === "function" ? api.getBlock(anchor.x, anchor.y, anchor.z) : null;
  if (current === null) return { ok: false, code: "CHUNK_NOT_LOADED", anchor };

  // The block is written through the builder, which seals it: the block goes down
  // once, and every later write to that cell is refused so the data cannot be
  // cleared under it. Where no builder is available the write is direct, and the
  // caller accepts that a later structural write would clear the record.
  const writeAnchor = options.writeAnchor || null;
  if (writeAnchor) writeAnchor(anchor.x, anchor.y, anchor.z, CHUNK_ANCHOR_BLOCK);
  else if (current !== CHUNK_ANCHOR_BLOCK) api.setBlock(anchor.x, anchor.y, anchor.z, CHUNK_ANCHOR_BLOCK);

  if (typeof api.setBlockData !== "function") return { ok: false, code: "NO_BLOCK_DATA_API", anchor, record };
  api.setBlockData(anchor.x, anchor.y, anchor.z, record);
  return { ok: true, code: "WROTE_DATA", anchor, record };
}

/**
 * One round-trip check, the way a test or a debug command uses it.
 *
 * Writes a record and reads it back **through the same API calls the game uses**,
 * then compares the parsed shape field by field. This is the function that proves
 * the format survives Bloxd's own serialisation, and the one a `/dbg chunk`
 * command can call on a real world.
 */
export function verifyChunkRecord(api, options) {
  const written = writeChunkRecord(api, options);
  if (!written.ok) return { ok: false, code: written.code, written };
  const read = readChunkRecord(api, { ...options, anchor: written.anchor });
  if (!read.ok) return { ok: false, code: read.code, written, read };
  const differences = compareRecords(written.record, read.record);
  return {
    ok: differences.length === 0,
    code: differences.length === 0 ? "ROUND_TRIP_OK" : "ROUND_TRIP_MISMATCH",
    differences,
    written,
    read,
  };
}

/** Field-by-field comparison of the record as written and as read back. */
function compareRecords(written, read) {
  const differences = [];
  const fields = ["version", "id", "seed", "chunkX", "chunkZ", "tick", "y"];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    // `v` is written and `version` is read: the same number under two names is the
    // one place the record is allowed to differ from itself.
    const writtenValue = field === "version" ? written.v
      : field === "chunkX" ? written.cx
        : field === "chunkZ" ? written.cz
          : written[field];
    if (writtenValue !== read[field]) differences.push({ field, written: writtenValue, read: read[field] });
  }
  if (written.plans.length !== read.plans.length) {
    differences.push({ field: "plans.length", written: written.plans.length, read: read.plans.length });
  } else {
    for (let index = 0; index < written.plans.length; index += 1) {
      const plan = parsePlan(written.plans[index]);
      const back = read.plans[index];
      if (!plan || !back || plan.kind !== back.kind || plan.id !== back.id || plan.blocks !== back.blocks) {
        differences.push({ field: `plans[${index}]`, written: written.plans[index], read: back });
      }
    }
  }
  if (written.progress.length !== read.progress.length) {
    differences.push({ field: "progress.length", written: written.progress.length, read: read.progress.length });
  } else {
    for (let index = 0; index < written.progress.length; index += 1) {
      const entry = parseProgress(written.progress[index]);
      const back = read.progress[index];
      if (!entry || !back || entry.kind !== back.kind || entry.id !== back.id
        || entry.state !== back.state || entry.cursor !== back.cursor) {
        differences.push({ field: `progress[${index}]`, written: written.progress[index], read: back });
      }
    }
  }
  return differences;
}

/**
 * Reads one chunk's record back and validates it.
 *
 * A missing anchor is `NO_ANCHOR`: either the chunk was never stored, or
 * something rewrote the anchor — which is the one way to lose the data, and the
 * caller is told which it is by the block it finds there.
 */
export function readChunkRecord(api, options) {
  const floorY = options.floorY === undefined ? DUNGEON_CONFIG.floorY : options.floorY;
  const anchor = options.anchor || anchorOf(options.chunkX, options.chunkZ, floorY);
  const block = typeof api.getBlock === "function" ? api.getBlock(anchor.x, anchor.y, anchor.z) : null;
  if (block === null) return { ok: false, code: "CHUNK_NOT_LOADED", anchor };
  if (block !== CHUNK_ANCHOR_BLOCK) return { ok: false, code: "NO_ANCHOR", anchor, block };
  const raw = typeof api.getBlockData === "function" ? api.getBlockData(anchor.x, anchor.y, anchor.z) : null;
  const parsed = parseChunkRecord(raw);
  if (!parsed.ok) return { ok: false, code: parsed.code, anchor, raw, detail: parsed };
  return { ok: true, anchor, record: parsed.record };
}
