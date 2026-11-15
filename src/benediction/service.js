/*
 * Points, rolls and the record of what a player rolled.
 *
 * This module holds **state and rules**, never the game: it does not touch `api`, it does
 * not draw a card, and it does not read a shop. `src/worldCode.js` does that, and the
 * separation is what lets the mechanic be tested without a world — the same shape as
 * `src/dungeon/`, where the loader and the service own the state and the world code owns
 * the calls.
 *
 * A player's account has three numbers and a list:
 *
 *   - **level**: their aura level, the game's own (`getAuraInfo().level`);
 *   - **spent**: points already rolled;
 *   - **history**: the last few things they rolled, for the shop's "last roll" tile.
 *
 * Points are **derived, never stored**: `level - AURA_LEVEL_BASE - spent`. There is no
 * counter to keep in sync with the game, so a level the player gains while nobody is
 * looking (or through something other than a dungeon) is honoured the next time they look
 * at the shop, and no reconnection can duplicate or lose a point.
 *
 * Persistence is per **player**, keyed by the game's permanent id (`getPlayerDbId`), and
 * written by the caller. What is stored is `spent` and `history`: the level is the game's
 * answer, and storing it would only be a copy that goes stale.
 */

import { drawBenediction, pointsLeft } from "./config.js";

/** How many rolls the "last rolls" line remembers. Enough to show, short enough to store. */
export const HISTORY_LIMIT = 5;

/**
 * Creates the bookkeeping.
 *
 * `random` is injected so a test can pin a draw, exactly as the key table does.
 */
export function createBenedictionService(options = {}) {
  const random = options.random || Math.random;
  /** Permanent player id → { spent, history }. */
  const accounts = new Map();

  /**
   * The account of a player, created empty the first time they are seen.
   *
   * The key is the **permanent** id when the caller has one: a player id is a session, and
   * a record stored under it would be lost on the next connection. `getPlayerDbId` is the
   * game's answer to "who is this, really".
   */
  function accountOf(playerKey) {
    let account = accounts.get(playerKey);
    if (!account) {
      account = { spent: 0, history: [] };
      accounts.set(playerKey, account);
    }
    return account;
  }

  /** Replaces an account with what was read back from the database. */
  function load(playerKey, stored) {
    const account = accountOf(playerKey);
    account.spent = Number.isFinite(stored && stored.spent) ? Math.max(0, Math.floor(stored.spent)) : 0;
    account.history = Array.isArray(stored && stored.history)
      ? stored.history.filter((entry) => entry && typeof entry.id === "string").slice(0, HISTORY_LIMIT)
      : [];
    return account;
  }

  /** What to write to the database: only what the game does not already know. */
  function save(playerKey) {
    const account = accountOf(playerKey);
    return { spent: account.spent, history: account.history.slice(0, HISTORY_LIMIT) };
  }

  /** Points this player has not spent. `level` is the game's aura level, read by the caller. */
  function pointsFor(playerKey, level) {
    return pointsLeft(level, accountOf(playerKey).spent);
  }

  /**
   * Spends one point and draws a benediction.
   *
   * Returns `{ benediction, rarity, pointsLeft }`, or `null` when there is nothing to
   * spend — the caller says so to the player. The point is spent **before** the draw is
   * reported, and the draw cannot fail: `drawBenediction` always answers while the
   * catalogue has one entry, and an empty catalogue is refused here rather than paid for.
   */
  function roll(playerKey, level) {
    const account = accountOf(playerKey);
    if (pointsLeft(level, account.spent) <= 0) return null;
    const draw = drawBenediction(random);
    if (!draw) return null;
    account.spent += 1;
    account.history.unshift({
      id: draw.benediction.id,
      name: draw.benediction.name,
      rarity: draw.rarity.id,
    });
    account.history = account.history.slice(0, HISTORY_LIMIT);
    return {
      benediction: draw.benediction,
      rarity: draw.rarity,
      pointsLeft: pointsLeft(level, account.spent),
    };
  }

  /** Forgets everything. Only `/dbg` uses it, and only to prove a reset is a reset. */
  function forget() {
    accounts.clear();
  }

  return { accountOf, load, save, pointsFor, roll, forget };
}
