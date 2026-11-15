/*
 * Points, offers, and the record of what a player chose — **for this session only**.
 *
 * The owner's rule: a benediction point is a **custom currency**, and nothing about it has to
 * survive a reconnection. The aura is reset on join, the points are derived from it, and the
 * account lives in memory for as long as the player is here. There is no database read, no
 * database write, and no "my points are on another lobby" to explain.
 *
 * A player's account is four things:
 *
 *   - **spent**: points already spent on a chosen benediction;
 *   - **reserved**: points promised to an offer that is still on the table — an offer costs
 *     its point when it is drawn, not when it is picked, or three offers could be rolled
 *     from one level's worth of points;
 *   - **offer**: the three benedictions laid out right now, waiting for a choice;
 *   - **history**: the last few things they chose, for the shop's "last roll" tile.
 *
 * The level is **not** part of the account: it is the game's own answer (`getAuraInfo`), read
 * by the caller, and since the game's aura is reset on join it always starts the session at
 * level 1 — so the first point is the second level, never something carried in.
 *
 * Points are **derived, never counted**: `level - AURA_LEVEL_BASE - spent - reserved`. There
 * is no counter to keep in sync, no write to lose, and no way for a reconnection to duplicate
 * anything.
 */

import { BENEDICTIONS, drawChoices, pointsLeft, rarityOf } from "./config.js";

/** How many chosen benedictions the shop's "last roll" keeps. */
export const HISTORY_LIMIT = 5;

/**
 * Creates the bookkeeping.
 *
 * `random` is injected so a test can pin a draw, exactly as the key table does.
 */
export function createBenedictionService(options = {}) {
  const random = options.random || Math.random;
  /** Player id → { spent, reserved, offer, history }. Never written anywhere. */
  const accounts = new Map();

  function accountOf(playerKey) {
    let account = accounts.get(playerKey);
    if (!account) {
      account = { spent: 0, reserved: 0, offer: [], history: [] };
      accounts.set(playerKey, account);
    }
    return account;
  }

  /** One catalogue entry by id, as a draw: the shape every surface already knows. */
  function catalogueDraw(id) {
    const found = BENEDICTIONS.find((entry) => entry.id === id);
    return found ? { benediction: found, rarity: rarityOf(found.rarity) } : null;
  }

  /** Points this player has not spent and has not promised. */
  function pointsFor(playerKey, level) {
    const account = accountOf(playerKey);
    return pointsLeft(level, account.spent + account.reserved);
  }

  /** The account's offer, as draws: what the shop shows. */
  function offerOf(playerKey) {
    return accountOf(playerKey).offer.slice();
  }

  /**
   * Rolls: **lays an offer out, and promises its point.**
   *
   * Returns the offer (`[{ benediction, rarity }]`), or `null` when there is no point to
   * spend or no benediction to offer. An existing offer is **reused**, not redrawn: the shop
   * calls this every time it is drawn, and a player who closes the shop and comes back must
   * find the same three choices rather than a fresh roll for free.
   *
   * The point is reserved here rather than taken here, and the reservation is **held** rather
   * than spent: `choose` turns it into a spend, a pick that cannot be made after the level's
   * points moved gives the promise back, and a finished choice has nothing to give back. That
   * is the one rule that keeps this module honest across a reconnection — nothing is stored,
   * so nothing can be stale.
   */
  function roll(playerKey, level) {
    const account = accountOf(playerKey);
    if (account.offer.length > 0) return account.offer.slice();
    if (pointsFor(playerKey, level) <= 0) return null;
    const choices = drawChoices(random);
    if (choices.length === 0) return null;
    account.offer = choices;
    account.reserved += 1;
    return account.offer.slice();
  }

  /**
   * Chooses one: **this is the point being spent.**
   *
   * `index` is a position in the current offer, and anything else — a stale shop, a click on
   * a card that has been redrawn, a pick made after the offer was consumed — returns `null`
   * and costs nothing. The offered benediction is the one recorded: the offer is a promise,
   * and re-drawing at the moment of the choice would make the three cards a lie.
   */
  function choose(playerKey, level, index) {
    const account = accountOf(playerKey);
    const position = Number.isInteger(index) ? index : -1;
    const chosen = position >= 0 && position < account.offer.length ? account.offer[position] : null;
    if (!chosen) return null;
    // The level can only go up while a player plays, but a level that is not paying for the
    // promise any more must not produce a free benediction: the reservation is dropped and
    // the choice is refused.
    if (account.reserved <= 0) {
      account.offer = [];
      return null;
    }
    account.reserved -= 1;
    account.spent += 1;
    account.offer = [];
    account.history.unshift({
      id: chosen.benediction.id,
      name: chosen.benediction.name,
      rarity: chosen.rarity.id,
    });
    account.history = account.history.slice(0, HISTORY_LIMIT);
    return {
      benediction: chosen.benediction,
      rarity: chosen.rarity,
      pointsLeft: pointsFor(playerKey, level),
    };
  }

  /** Drops the offer without spending it: the promise goes back with it. */
  function clearOffer(playerKey) {
    const account = accountOf(playerKey);
    if (account.offer.length > 0 && account.reserved > 0) account.reserved -= 1;
    account.offer = [];
  }

  /**
   * Forgets a player: what a join and a leave both do.
   *
   * **A join forgets too**, and that is the whole of "reset on reconnect": the game's aura is
   * reset to 0, the account goes with it, and the next level 2 is the first point of a new
   * session.
   */
  function forget(playerKey) {
    accounts.delete(playerKey);
  }

  /** Every account, for `/dbg`: what is in memory, and nothing else. */
  function accountsOf() {
    return Array.from(accounts.entries()).map(([key, account]) => ({ key, ...account }));
  }

  return { accountOf, pointsFor, roll, choose, clearOffer, offerOf, forget, accountsOf };
}
