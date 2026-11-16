/*
 * What a blessing *does*: the three scopes, and the one place an effect is turned into client
 * options.
 *
 * The owner's model, in three lines:
 *
 *   - a **permanent** blessing is saved (a player database value) and comes back on every
 *     reconnection; its effects **stack**;
 *   - a **run** blessing lasts until the run ends — death, leave, or teleport to spawn;
 *   - a **timed** blessing is a potion effect of 30 s to 2 min, and nothing else, because the
 *     engine already ends those on time.
 *
 * So this module owns two things the catalogue must not: **how bonuses add up**, and **what
 * has to be put back** when a run ends. It is pure: no `api` here, only the data the world
 * code needs to call `setClientOptions`, `applyEffect` and friends, which keeps all of that in
 * one place in `src/worldCode.js` and testable without a fake server.
 *
 * One accumulator, deliberately: a permanent `+5 health` and a run `+40 health` must be
 * **45**, not "the run's value replaces the permanent one". Everything additive goes through
 * `addBonuses`, and `optionsFor` turns the sums into absolute client options in one pass.
 */

import { BLESSINGS, blessingOf, SCOPES } from "./config.js";

/** What the world's own client options are, before any blessing touches them. */
export const BASE_CLIENT_OPTIONS = Object.freeze({
  maxHealth: 100,
  receivingDamageMultiplier: 1,
  dealingDamageMultiplier: 1,
  speedMultiplier: 1,
  runningSpeed: 7,
  walkingSpeed: 4,
  healthRegenAmount: 0.05,
});

/**
 * The owner's cap: **-40 % damage taken at most**, so a stack of `Scarred Skin` can never
 * reach immunity. Written here because this is where it is enforced.
 */
export const DAMAGE_TAKEN_FLOOR = 0.6;

/** The options the world derives from others rather than setting directly. */
const DERIVED_OPTIONS = ["runningSpeed", "walkingSpeed"];

/**
 * A blessing's scope, **read from the entry, never guessed**.
 *
 * A catalogue entry with no scope is treated as `run`: the shortest non-permanent lifetime is
 * the safe default, because a save that was never asked for is worse than an effect that ends
 * when the run does.
 */
export function scopeKeyOf(blessing) {
  const scope = blessing && blessing.scope;
  return SCOPES.some((entry) => entry.id === scope) ? scope : "run";
}

/** The rarity bonus of a scope, for the tile: `PERM`, `RUN`, `TIMED`. */
export function scopeLabelOf(blessing) {
  const scope = SCOPES.find((entry) => entry.id === scopeKeyOf(blessing));
  return scope ? scope.short : "RUN";
}

/** An empty accumulator: additive amounts per client option, plus switches. */
export function createBonuses() {
  return { add: {}, set: {}, floors: {} };
}

/**
 * Adds one blessing's effect to the accumulator.
 *
 * `run` bonuses are client-option adds by definition; a `client` effect is one too, with an
 * optional `floor` (a soft cap) and an optional `set` for a switch such as wall climbing. A
 * `potion` effect touches no client option at all here — it is the engine's.
 */
export function addBonuses(bonuses, blessing) {
  const effect = effectOf(blessing);
  if (!effect) return bonuses;
  if (effect.kind === "run") {
    // A run bonus names its channel (`damage`, `reduction`, `speed`, `maxHealth`), which are
    // client options under another name: the tile talks about damage, the API about a
    // multiplier, and this table is the one place the two are tied together.
    const option = RUN_BONUS_OPTIONS[effect.bonus];
    if (!option) return bonuses;
    addOption(bonuses, option, effect.amount);
    return bonuses;
  }
  if (effect.kind !== "client" || !effect.option) return bonuses;
  // A `client` effect. The two speed values are derived from `speedMultiplier` in
  // `optionsFor`: an effect naming one of them directly is ignored rather than added twice,
  // so there is one number that decides how fast a player moves.
  applyClientEffect(bonuses, effect);
  // A blessing may carry a second client effect: the Mythic one does two things at once, and
  // splitting it into two catalogue entries would make it two rolls instead of one.
  if (effect.second) applyClientEffect(bonuses, { ...effect.second, mode: effect.second.mode || "add" });
  return bonuses;
}

/** Applies one `client` effect to the accumulator: a value, or a switch. */
function applyClientEffect(bonuses, effect) {
  if (!effect || !effect.option) return;
  if (DERIVED_OPTIONS.includes(effect.option)) return;
  if (effect.mode === "set") {
    bonuses.set[effect.option] = effect.value;
    return;
  }
  addOption(bonuses, effect.option, effect.amount);
  if (Number.isFinite(effect.floor)) {
    bonuses.floors[effect.option] = Number.isFinite(bonuses.floors[effect.option])
      ? Math.max(bonuses.floors[effect.option], effect.floor)
      : effect.floor;
  }
}

/** The client option a run bonus channel is written to. */
const RUN_BONUS_OPTIONS = {
  damage: "dealingDamageMultiplier",
  reduction: "receivingDamageMultiplier",
  speed: "speedMultiplier",
  maxHealth: "maxHealth",
};

/** Adds every blessing of a list to a fresh accumulator. */
export function bonusesOf(blessings = []) {
  const bonuses = createBonuses();
  for (const blessing of blessings) addBonuses(bonuses, blessing);
  return bonuses;
}

/**
 * Turns an accumulator into the **absolute** client options to send.
 *
 * Everything the game knows a baseline for is `baseline + the sums`, then clamped: the damage
 * taken multiplier never goes below `DAMAGE_TAKEN_FLOOR` (the owner's cap), and the two speed
 * values follow the multiplier so a player who stacked speed really does move faster both
 * ways. Options with no baseline are sent as the raw sum, which is the honest guess for a
 * number this world does not own.
 */
export function optionsFor(bonuses, base = {}) {
  const options = { ...(base || {}) };
  const add = bonuses && bonuses.add ? bonuses.add : {};
  const set = bonuses && bonuses.set ? bonuses.set : {};
  const floors = bonuses && bonuses.floors ? bonuses.floors : {};

  // **Every managed option is always sent**, with its baseline when nothing modifies it.
  // A client option is state the game keeps for the player: dropping a bonus and simply not
  // mentioning it would leave the old value in place for ever, which is exactly how a run
  // blessing would outlive its run. Sending the baseline is what ends it.
  for (const option of MANAGED_OPTIONS) {
    if (DERIVED_OPTIONS.includes(option)) continue;
    const baseline = Number.isFinite(BASE_CLIENT_OPTIONS[option]) ? BASE_CLIENT_OPTIONS[option] : 0;
    let value = roundOption(baseline + (Number.isFinite(add[option]) ? add[option] : 0));
    if (Number.isFinite(floors[option])) value = Math.max(floors[option], value);
    if (option === "receivingDamageMultiplier") value = Math.max(DAMAGE_TAKEN_FLOOR, value);
    options[option] = value;
  }

  // The two speed values follow the multiplier, so there is one number to reason about.
  const multiplier = Number.isFinite(options.speedMultiplier)
    ? options.speedMultiplier
    : BASE_CLIENT_OPTIONS.speedMultiplier;
  options.speedMultiplier = roundOption(multiplier);
  options.runningSpeed = roundOption(BASE_CLIENT_OPTIONS.runningSpeed * multiplier);
  options.walkingSpeed = roundOption(BASE_CLIENT_OPTIONS.walkingSpeed * multiplier);

  // Switches default to **off**, for the same reason: wall climbing ends when its run does.
  for (const option of SWITCH_OPTIONS) {
    if (!(option in options)) options[option] = false;
  }
  for (const [option, value] of Object.entries(set)) options[option] = value;
  return options;
}

/** The switches a blessing may turn on: off is the baseline, so a run can turn them back off. */
const SWITCH_OPTIONS = ["canClimbWalls"];

/** Every **numeric** client option this module owns, and therefore always sends. */
const MANAGED_OPTIONS = Object.keys(BASE_CLIENT_OPTIONS);

/**
 * Reads a save into a list of **permanent** blessings, stacking preserved.
 *
 * The save is a plain map of `{ [blessingId]: count }`, written by `saveOf`. Ids that are no
 * longer in the catalogue are **dropped silently**: a removed blessing must not crash a
 * reconnection, and must not come back either. A corrupted entry is dropped the same way.
 */
export function readPermanentSave(value) {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (_) {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object") return {};
  const counts = {};
  for (const [id, count] of Object.entries(parsed)) {
    const blessing = blessingOf(id);
    if (!blessing || scopeKeyOf(blessing) !== "permanent") continue;
    const amount = Number.isFinite(count) ? Math.floor(count) : 0;
    if (amount > 0) counts[id] = amount;
  }
  return counts;
}

/** The save value for a map of counts: `{"toughened_hide":3}` — stable order, no spaces. */
export function saveOf(counts) {
  const sorted = Object.keys(counts || {}).sort();
  const clean = {};
  for (const id of sorted) {
    const amount = Math.floor(Number(counts[id]));
    if (amount > 0) clean[id] = amount;
  }
  return JSON.stringify(clean);
}

/** The permanent blessings of a map of counts, each copy listed separately. */
export function permanentList(counts) {
  const list = [];
  for (const [id, amount] of Object.entries(counts || {})) {
    const blessing = blessingOf(id);
    if (!blessing || scopeKeyOf(blessing) !== "permanent") continue;
    for (let copy = 0; copy < amount; copy += 1) list.push(blessing);
  }
  return list;
}

/** How many copies of each permanent the player holds, from a list of chosen blessings. */
export function countsOfPermanent(blessings = []) {
  const counts = {};
  for (const blessing of blessings) {
    if (scopeKeyOf(blessing) !== "permanent") continue;
    counts[blessing.id] = (counts[blessing.id] || 0) + 1;
  }
  return counts;
}

/**
 * The client options a player should have, from **both** scopes at once.
 *
 * This is the function the world calls: the permanent stack (saved) and the run's list (in
 * memory) go into one accumulator, so a run's `+40` really is added to a permanent `+5`.
 */
export function optionsFrom(permanentCounts, runBlessings = [], base = {}) {
  const categories = [...permanentList(permanentCounts), ...runBlessings];
  return optionsFor(bonusesOf(categories), base);
}

/**
 * The **timed** effect of a blessing, or `null`.
 *
 * The owner's window: 30 s at the shortest, 2 min at the longest, and a value outside it is
 * clamped rather than refused — a catalogue typo must still give a blessing that works.
 */
export const TIMED_MIN_MS = 30000;
export const TIMED_MAX_MS = 120000;

export function timedEffectOf(blessing) {
  const effect = effectOf(blessing);
  if (!effect || effect.kind !== "potion") return null;
  if (!Number.isFinite(effect.durationMs)) return null;
  return {
    effectName: String(effect.effectName),
    level: Number.isFinite(effect.level) ? Math.max(1, Math.floor(effect.level)) : 1,
    durationMs: Math.min(TIMED_MAX_MS, Math.max(TIMED_MIN_MS, effect.durationMs)),
  };
}

/**
 * The potion effects a **run** blessing holds for the whole run (Thorns).
 *
 * A potion effect with no duration is not timed: the engine keeps it until it is removed, and
 * `endRun` is what removes it.
 */
export function runEffects(runBlessings = []) {
  const effects = [];
  for (const blessing of runBlessings) {
    const effect = effectOf(blessing);
    if (!effect || effect.kind !== "potion" || Number.isFinite(effect.durationMs)) continue;
    effects.push({
      effectName: String(effect.effectName),
      level: Number.isFinite(effect.level) ? Math.max(1, Math.floor(effect.level)) : 1,
    });
  }
  return effects;
}

/** The blessing's effect object, with the catalogue as the fallback for a bare object. */
function effectOf(blessing) {
  if (!blessing) return null;
  if (blessing.effect) return blessing.effect;
  const known = blessingOf(blessing.id);
  return known && known.effect ? known.effect : null;
}

function addOption(bonuses, option, amount) {
  const current = Number.isFinite(bonuses.add[option]) ? bonuses.add[option] : 0;
  bonuses.add[option] = roundOption(current + (Number.isFinite(amount) ? amount : 0));
}

/** Three decimals is enough for a multiplier, and keeps `0.1 + 0.2` from showing as 0.30000000000000004. */
function roundOption(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * The tiles' one-line summary of a permanent stack, e.g. `3 permanent · +15 health`.
 *
 * The shop shows it so a player can see what they own without a fourth category: it is the
 * description of the permanent tile, which already exists.
 */
export function permanentSummary(counts) {
  const total = Object.values(counts || {})
    .reduce((sum, amount) => sum + (Number.isFinite(amount) ? amount : 0), 0);
  if (total === 0) return "No permanent blessing yet";
  const options = optionsFrom(counts, []);
  const parts = [];
  const health = roundOption((options.maxHealth || BASE_CLIENT_OPTIONS.maxHealth) - BASE_CLIENT_OPTIONS.maxHealth);
  if (health !== 0) parts.push(`${health > 0 ? "+" : ""}${health} health`);
  const taken = Math.round(((options.receivingDamageMultiplier || 1) - 1) * 100);
  if (taken !== 0) parts.push(`${taken}% damage taken`);
  const dealt = Math.round(((options.dealingDamageMultiplier || 1) - 1) * 100);
  if (dealt !== 0) parts.push(`+${dealt}% damage dealt`);
  const speed = roundOption((options.speedMultiplier || 1) - 1);
  if (speed !== 0) parts.push(`+${speed} speed`);
  return `${total} permanent${parts.length > 0 ? ` · ${parts.join(" · ")}` : ""}`;
}

/** Every permanent a save holds, for a debug report: `Toughened Hide ×3, …`. */
export function debugPermanent(counts) {
  return Object.entries(counts || {})
    .map(([id, amount]) => ({ id, amount, name: blessingOf(id) ? blessingOf(id).name : id }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => `${entry.name} ×${entry.amount}`)
    .join(", ");
}

/** The number of **distinct** blessings in the catalogue, for the tests and the report. */
export function catalogueIds() {
  return BLESSINGS.map((entry) => entry.id);
}
