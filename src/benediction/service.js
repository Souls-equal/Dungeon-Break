/*
 * Points, rolls and the record of what a player rolled.
 *
 * This module holds **state and rules**, never the game: it does not touch `api`, it does
 * not draw a card, and it does not read a shop. `src/worldCode.js` does that, and the
 * separation is what lets the mechanic be tested without a world — the same shape as
 * `src/dungeon/`, where the loader and the service own the state and the world code owns
 * the calls.
 *
 * A player's account has two numbers, a list, and an **offer**:
 *
 *   - **level**: their aura level, the game's own (`getAuraInfo().level`), never stored;
 *   - **spent**: points already spent on a chosen benediction;
 *   - **history**: the last few things they chose, for the shop's "last roll" tile;
 *   - **offer**: the three benedictions laid out for them right now, waiting for a choice.
 *
 * **A roll is an offer, not a result.** Rolling lays three benedictions out and spends
 * nothing; choosing one spends the point and is the only thing that writes a history. An
 * offer nobody has chosen survives a reconnect, so closing the shop — or the game — is not
 * a way to reroll for free, and a player cannot be charged for a screen they never saw.
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

import { BENEDICTIONS, CHOICE_COUNT, drawChoices, pointsLeft, rarityOf } from "./config.js";

const CATALOGUE = BENEDICTIONS;

/** How many rolls the "last rolls" line remembers. Enough to show, short enough to store. */
export const HISTORY_LIMIT = 5;

/**
 * Creates the bookkeeping.
 *
 * `random` is injected so a test can pin a draw, exactly as the key table does.
 */
export function createBenedictionService(options = {}) {
  const random = options.random || Math.random;
  /** Permanent player id → { spent, history, offer }. */
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
      account = { spent: 0, history: [], offer: [] };
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
    // An offer is stored as **ids**, and read back through the catalogue: a benediction
    // whose id has disappeared is dropped instead of resurrected from a stale copy.
    account.offer = Array.isArray(stored && stored.offer)
      ? stored.offer
        .map((id) => catalogueDraw(id))
        .filter((draw) => draw !== null)
        .slice(0, CHOICE_COUNT)
      : [];
    return account;
  }

  /** One catalogue entry by id, as a draw: the shape every surface already knows. */
  function catalogueDraw(id) {
    const found = CATALOGUE.find((entry) => entry.id === id);
    return found ? { benediction: found, rarity: rarityOf(found.rarity) } : null;
  }

  /** The account's offer, as draws: what the shop shows. */
  function offerOf(playerKey) {
    return accountOf(playerKey).offer.slice();
  }

  /** What to write to the database: only what the game does not already know. */
  function save(playerKey) {
    const account = accountOf(playerKey);
    return {
      spent: account.spent,
      history: account.history.slice(0, HISTORY_LIMIT),
      offer: account.offer.map((draw) => draw.benediction.id),
    };
  }

  /** Points this player has not spent. `level` is the game's aura level, read by the caller. */
  function pointsFor(playerKey, level) {
    return pointsLeft(level, accountOf(playerKey).spent);
  }

  /**
   * Rolls: **lays out an offer**, and spends nothing.
   *
   * Returns the offer (`[{ benediction, rarity }]`), or `null` when there is no point to
   * spend or no benediction to offer. An existing offer is **reused**, not redrawn: the
   * shop calls this every time it is drawn, and a player who closes the shop and comes back
   * must find the same three choices rather than a fresh roll for free.
   *
   * The point is not checked here twice on purpose — it is checked again on `choose`,
   * against the live level, because a level can also be *lost* by the game.
   */
  function roll(playerKey, level) {
    const account = accountOf(playerKey);
    if (pointsLeft(level, account.spent) <= 0) return null;
    if (account.offer.length > 0) return account.offer.slice();
    const choices = drawChoices(random);
    if (choices.length === 0) return null;
    account.offer = choices;
    return account.offer.slice();
  }

  /**
   * Chooses one of the offers: **this is what spends the point.**
   *
   * `index` is a position in the current offer, and anything else — a stale shop, a click
   * on a card that has been redrawn, a pick made after the offer was consumed — returns
   * `null` and costs nothing. The offered benediction is the one recorded: the offer is a
   * promise, and re-drawing at the moment of the choice would make the three cards a lie.
   */
  function choose(playerKey, level, index) {
    const account = accountOf(playerKey);
    const position = Number.isInteger(index) ? index : -1;
    const chosen = position >= 0 && position < account.offer.length ? account.offer[position] : null;
    if (!chosen) return null;
    if (pointsLeft(level, account.spent) <= 0) return null;
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
      pointsLeft: pointsLeft(level, account.spent),
    };
  }

  /** Drops the offer without spending anything: what a shop closing on a fresh look does. */
  function clearOffer(playerKey) {
    accountOf(playerKey).offer = [];
  }

  /** Forgets everything. Only `/dbg` uses it, and only to prove a reset is a reset. */
  function forget() {
    accounts.clear();
  }

  return { accountOf, load, save, pointsFor, roll, choose, clearOffer, offerOf, forget };
}
