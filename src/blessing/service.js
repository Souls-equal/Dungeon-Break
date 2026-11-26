/*
 * Points, offers, and what a player currently holds — **for this session only**.
 *
 * The owner's rule: a blessing point is a **custom currency**, and nothing about it has to
 * survive a reconnection. The aura is reset on join, the points are derived from it, and the
 * account lives in memory for as long as the player is here.
 *
 * A player's account is four things:
 *
 *   - **spent**: points already spent on a chosen blessing;
 *   - **reserved**: points promised to an offer that is still on the table — an offer costs
 *     its point when it is drawn, not when it is picked, or three offers could be rolled
 *     from one level's worth of points;
 *   - **offer**: the three blessings laid out right now, waiting for a choice;
 *   - **history**: the last few things they chose, for the shop's tile.
 *
 * Points are **derived, never counted**: `level - AURA_LEVEL_BASE - spent - reserved`. There
 * is no counter to keep in sync and no way for a reconnection to duplicate anything.
 *
 * **What a player holds is a second, separate thing**, and it is what the owner's three
 * scopes describe: `permanent` counts, the `run` list, and the `timed` effects still running.
 * The world code reads and writes those; this module only keeps them in order, so a test can
 * assert lifetimes without a fake server. The permanent counts are the one part that *is*
 * saved — by the world, in a player database value — and this module never touches `api`.
 */

import { BLESSINGS, drawChoices, pointsLeft, rarityOf } from "./config.js";


/** How many chosen blessings the shop keeps for its history. */
export const HISTORY_LIMIT = 5;

/**
 * Creates the bookkeeping.
 *
 * `random` is injected so a test can pin a draw, exactly as the key table does.
 */
export function createBlessingService(options = {}) {
  const random = options.random || Math.random;
  /** Player id → { spent, reserved, offer, history }. Never written anywhere. */
  const accounts = new Map();
  /**
   * Player id → { permanent, run, timed }.
   *
   * `permanent` is a map of counts (it mirrors the save, and is rebuilt from it on a join),
   * `run` is the list of blessings chosen for the current run, and `timed` is the list of
   * things still counting down, each `{ blessing, endsAtTick }`.
   */
  const holdings = new Map();

  function accountOf(playerKey) {
    let account = accounts.get(playerKey);
    if (!account) {
      account = { spent: 0, reserved: 0, offer: [], history: [] };
      accounts.set(playerKey, account);
    }
    return account;
  }

  function holdingOf(playerKey) {
    let holding = holdings.get(playerKey);
    if (!holding) {
      holding = { permanent: {}, run: [], timed: [] };
      holdings.set(playerKey, holding);
    }
    return holding;
  }

  /** One catalogue entry by id, as a draw: the shape every surface already knows. */
  function catalogueDraw(id) {
    const found = BLESSINGS.find((entry) => entry.id === id);
    return found ? { blessing: found, rarity: rarityOf(found.rarity) } : null;
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
   * Returns the offer (`[{ blessing, rarity }]`), or `null` when there is no point to spend
   * or no blessing to offer. An existing offer is **reused**, not redrawn: the shop calls
   * this every time it is drawn, and a player who closes the shop and comes back must find
   * the same three choices rather than a fresh roll for free.
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
   * and costs nothing.
   */
  function choose(playerKey, level, index) {
    const account = accountOf(playerKey);
    const position = Number.isInteger(index) ? index : -1;
    const chosen = position >= 0 && position < account.offer.length ? account.offer[position] : null;
    if (!chosen) return null;
    // The level can only go up while a player plays, but a level that is not paying for the
    // promise any more must not produce a free blessing: the reservation is dropped and the
    // choice is refused.
    if (account.reserved <= 0) {
      account.offer = [];
      return null;
    }
    account.reserved -= 1;
    account.spent += 1;
    account.offer = [];
    account.history.unshift({
      id: chosen.blessing.id,
      name: chosen.blessing.name,
      rarity: chosen.rarity.id,
      scope: chosen.blessing.scope,
    });
    account.history = account.history.slice(0, HISTORY_LIMIT);

    return {
      blessing: chosen.blessing,
      rarity: chosen.rarity,
      pointsLeft: pointsFor(playerKey, level),
    };
  }

  /** Rerolls the current offer (gold reroll): replaces the 3 choices, keeps reservation. */
  function rerollOffer(playerKey) {
    const account = accountOf(playerKey);
    if (account.offer.length === 0) return null;
    const oldIds = new Set(account.offer.map((o) => o.blessing.id));
    let tries = 0;
    let choices = null;
    do {
      choices = drawChoices(random);
      tries++;
      if (!choices || choices.length === 0) return null;
      const newIds = new Set(choices.map((c) => c.blessing.id));
      const same = oldIds.size === newIds.size && [...oldIds].every((id) => newIds.has(id));
      if (!same) break;
    } while (tries < 5);
    account.offer = choices;

    return account.offer.slice();
  }

  /** Drops the offer without spending it: the promise goes back with it. */
  function clearOffer(playerKey) {
    const account = accountOf(playerKey);
    if (account.offer.length > 0 && account.reserved > 0) account.reserved -= 1;
    account.offer = [];
  }

  /**
   * Replaces the permanent counts from a save. Called on a join, before anything is applied.
   *
   * The save is the truth: a player whose save says three `Toughened Hide` has three, even if
   * they chose them two sessions ago.
   */
  function setPermanent(playerKey, counts) {
    holdingOf(playerKey).permanent = { ...(counts || {}) };
    return holdingOf(playerKey).permanent;
  }

  /** The permanent counts of a player, as a copy. */
  function permanentOf(playerKey) {
    return { ...holdingOf(playerKey).permanent };
  }

  /** Records a permanent blessing: one more copy, and the new counts. */
  function addPermanent(playerKey, blessing) {
    const holding = holdingOf(playerKey);
    holding.permanent = { ...holding.permanent };
    holding.permanent[blessing.id] = (holding.permanent[blessing.id] || 0) + 1;
    return { ...holding.permanent };
  }

  /** What the current run holds, as a copy. */
  function runOf(playerKey) {
    return holdingOf(playerKey).run.slice();
  }

  /** Records a run blessing. */
  function addRun(playerKey, blessing) {
    const holding = holdingOf(playerKey);
    holding.run.push(blessing);
    return holding.run.slice();
  }

  /** What is still counting down, as a copy: `[{ blessing, endsAtTick }]`. */
  function timedOf(playerKey) {
    return holdingOf(playerKey).timed.slice();
  }

  /** Records a timed blessing and when it ends. */
  function addTimed(playerKey, blessing, endsAtTick) {
    const holding = holdingOf(playerKey);
    holding.timed.push({ blessing, endsAtTick });
    return holding.timed.slice();
  }

  /**
   * Drops the timed entries that are over, and returns the ones that just expired.
   *
   * The engine already stops the effect on time; this is the *bookkeeping* of it, so the
   * shop and the debug report can say what is still running without asking the game.
   */
  function pruneTimed(playerKey, nowTick) {
    const holding = holdingOf(playerKey);
    const expired = [];
    holding.timed = holding.timed.filter((entry) => {
      if (entry.endsAtTick > nowTick) return true;
      expired.push(entry);
      return false;
    });
    return expired;
  }

  /** Drops **the run**: every run blessing and every timed one. What a death does. */
  function clearRun(playerKey) {
    const holding = holdingOf(playerKey);
    const dropped = { run: holding.run.slice(), timed: holding.timed.slice() };
    holding.run = [];
    holding.timed = [];
    return dropped;
  }

  /**
   * Forgets a player: what a join and a leave both do.
   *
   * **A join forgets too**: the game's aura is reset to 0, the account goes with it, and the
   * permanent stack is rebuilt from the save — never from what was in memory.
   */
  function forget(playerKey) {
    accounts.delete(playerKey);
    holdings.delete(playerKey);
  }

  /** Every account, for `/dbg`: what is in memory, and nothing else. */
  function accountsOf() {
    return Array.from(accounts.entries()).map(([key, account]) => ({
      key,
      ...account,
      permanent: { ...(holdings.get(key)?.permanent || {}) },
      run: (holdings.get(key)?.run || []).map((entry) => entry.id),
      timed: (holdings.get(key)?.timed || []).length,
    }));
  }

  return {
    accountOf,
    pointsFor,
    roll,
    choose,
    rerollOffer,
    clearOffer,
    offerOf,
    forget,
    accountsOf,
    catalogueDraw,
    setPermanent,
    permanentOf,
    addPermanent,
    runOf,
    addRun,
    timedOf,
    addTimed,
    pruneTimed,
    clearRun,
  };
}
