/*
 * Benedictions: what an aura level buys.
 *
 * A player gains **one point per aura level** (the game's own XP, `getAuraInfo`), and a
 * point buys one roll in the shop. A roll is a rarity first, then a benediction of that
 * rarity — the same two-step shape as a chest's key, and for the same reason: the odds
 * belong to the rarity table, and the catalogue is free to grow without touching them.
 *
 * Everything here is **data and pure functions**. Nothing in this file knows what a
 * benediction does, because for now they do nothing: the point of this first version is
 * the look — six rarities, six colours, one card — and the mechanic that pays for them.
 * Effects will be added as entries with a `key` the game side reads; no rarity, no colour
 * and no odds will have to change to add one.
 */

/**
 * The six rarities, **in the order the owner gave them**, with the colour of each.
 *
 * `weight` is relative, not a percentage: `rarityOdds()` normalises it, so the numbers
 * below can be read as "for every 1000 Common rolls, 420 Uncommon ones". That is roughly
 * 60 / 25 / 10 / 3.6 / 1.1 / 0.2 %, and it keeps every rarity reachable — a Mythic is a
 * bad bet, not an impossibility.
 *
 * Two colours per rarity, and the difference is the API's. `colour` is the hex of the
 * family, used for the card's background — `sendTopRightHelper` wants `rgb()` and the docs
 * are explicit that hex does not work there — and `textColour` is a CSS colour name for
 * styled text, which is the form the docs use (`{ color: "gold" }`). One table, two
 * renderers, no guessing about what a colour string means on the way in.
 */
export const RARITIES = [
  { id: "common", label: "Common", colour: "#9e9e9e", textColour: "gray", weight: 1000 },
  { id: "uncommon", label: "Uncommon", colour: "#55ff55", textColour: "lime", weight: 420 },
  { id: "rare", label: "Rare", colour: "#55aaff", textColour: "dodgerblue", weight: 160 },
  { id: "epic", label: "Epic", colour: "#c04bff", textColour: "mediumorchid", weight: 60 },
  { id: "legendary", label: "Legendary", colour: "#ff9d00", textColour: "orange", weight: 18 },
  { id: "mythic", label: "Mythic", colour: "#ff2d2d", textColour: "red", weight: 4 },
];

/** The three families the owner asked for. A benediction belongs to exactly one. */
export const CATEGORIES = [
  { id: "physical", label: "Physical" },
  { id: "equipment", label: "Equipment" },
  { id: "potion", label: "Potion effect" },
];

/**
 * The catalogue.
 *
 * `icon` is an **in-game icon** (the `IngameIconName` values the client already draws),
 * used in chat and in the big announcement; `cardIcon` is the Font Awesome one the
 * top-right card needs, because `sendTopRightHelper` only accepts those. The owner asked
 * for a look; this is the look.
 *
 * Every benediction says what it will do and that it does nothing yet. A player must never
 * believe they gained something that a later version has to take away.
 */
export const BENEDICTIONS = [
  {
    id: "iron_hide",
    name: "Iron Hide",
    category: "physical",
    rarity: "common",
    icon: "Damage Reduction",
    cardIcon: "fa-solid fa-shield-halved",
    description: "Your skin thickens like a slab of iron. (No effect yet.)",
  },
  {
    id: "field_rations",
    name: "Field Rations",
    category: "potion",
    rarity: "common",
    icon: "Health Regen",
    cardIcon: "fa-solid fa-cookie",
    description: "A warm meal in your pocket, slowly stitching you back together. (No effect yet.)",
  },
  {
    id: "quick_feet",
    name: "Quick Feet",
    category: "physical",
    rarity: "uncommon",
    icon: "Speed",
    cardIcon: "fa-solid fa-boot",
    description: "Your steps come a little faster than they should. (No effect yet.)",
  },
  {
    id: "sturdy_straps",
    name: "Sturdy Straps",
    category: "equipment",
    rarity: "uncommon",
    icon: "Protection Enchantment",
    cardIcon: "fa-solid fa-shirt",
    description: "Every buckle of your gear is tightened and reinforced. (No effect yet.)",
  },
  {
    id: "honed_edge",
    name: "Honed Edge",
    category: "equipment",
    rarity: "rare",
    icon: "Damage Enchantment",
    cardIcon: "fa-solid fa-swords",
    description: "Your blade keeps an edge no whetstone gave it. (No effect yet.)",
  },
  {
    id: "bitter_draught",
    name: "Bitter Draught",
    category: "potion",
    rarity: "rare",
    icon: "Haste",
    cardIcon: "fa-solid fa-fire",
    description: "One mouthful, and your hands move ahead of your thoughts. (No effect yet.)",
  },
  {
    id: "second_wind",
    name: "Second Wind",
    category: "potion",
    rarity: "epic",
    icon: "Healing Pulse",
    cardIcon: "fa-solid fa-heart",
    description: "A pulse of warmth runs through you at the worst moment. (No effect yet.)",
  },
  {
    id: "ghost_step",
    name: "Ghost Step",
    category: "physical",
    rarity: "legendary",
    icon: "Invisibility",
    cardIcon: "fa-solid fa-feather-pointed",
    description: "You leave no sound and hardly a shadow. (No effect yet.)",
  },
  {
    id: "heart_of_the_dungeon",
    name: "Heart of the Dungeon",
    category: "equipment",
    rarity: "mythic",
    icon: "Lifesteal",
    cardIcon: "fa-solid fa-gem",
    description: "The dungeon's own heart, still beating in your chest. (No effect yet.)",
  },
];

/**
 * The **XP scale of this world**, written once and applied to every player.
 *
 * The game charges `auraPerLevel` aura for each level and stops at `maxAuraLevel`; by
 * default that is 100 aura a level, and a cap the owner wants lower so a run's aura buys
 * something instead of dribbling into empty levels. Both numbers are set here and pushed by
 * `setClientOptions` — the game is told, rather than the code guessing what it charges.
 *
 * `AURA_PER_LEVEL` also decides what a room's aura is worth in levels, so it is a balance
 * number as much as an API one: 10 aura a room at 50 a level is a point every five rooms,
 * and a Very Easy run — the entrance plus the ring of rooms around it — pays for roughly one
 * choice.
 */
export const AURA_PER_LEVEL = 50;

/**
 * The highest level this world allows. **Lowered from the game's own ceiling**, and the
 * pool of points is the level itself: a player who reaches it holds the whole ladder.
 */
export const MAX_AURA_LEVEL = 40;

/**
 * The level a player starts at: a fresh player is level 1 with no aura, and therefore
 * **no points**. Points are `level - AURA_LEVEL_BASE`, which is what the owner asked for —
 * one point per level gained, not one per level reached.
 */
export const AURA_LEVEL_BASE = 1;

/** Points earned per aura level. The owner asked for one. */
export const POINTS_PER_LEVEL = 1;

/** Every point this world can pay out: the whole ladder, from level 1 to the cap. */
export function maxPoints() {
  return (MAX_AURA_LEVEL - AURA_LEVEL_BASE) * POINTS_PER_LEVEL;
}

/**
 * How many benedictions a roll **offers**. The owner asked for three: enough that the
 * choice is a choice, few enough that a shop screen holds them without scrolling.
 */
export const CHOICE_COUNT = 3;

/** The rarity with this id, or `null` for a name nobody uses. */
export function rarityOf(id) {
  return RARITIES.find((entry) => entry.id === id) || null;
}

/** The family with this id, or `null`. */
export function categoryOf(id) {
  return CATEGORIES.find((entry) => entry.id === id) || null;
}

/** Every benediction of a rarity, in catalogue order. */
export function benedictionsOf(rarityId, catalogue = BENEDICTIONS) {
  return catalogue.filter((entry) => entry.rarity === rarityId);
}

/**
 * The rarities that can actually be drawn, with their weight and their chance.
 *
 * A rarity with no benediction is **left out**, not drawn and then thrown away: a Mythic
 * slot with an empty pool would otherwise turn into a reroll nobody asked for. The
 * weights are renormalised, so the chances always sum to 1.
 */
export function rarityOdds(catalogue = BENEDICTIONS) {
  const filled = RARITIES
    .map((rarity) => ({ rarity, pool: benedictionsOf(rarity.id, catalogue) }))
    .filter((entry) => entry.pool.length > 0);
  const total = filled.reduce((sum, entry) => sum + entry.rarity.weight, 0);
  return filled.map((entry) => ({
    rarity: entry.rarity,
    pool: entry.pool,
    weight: entry.rarity.weight,
    chance: total > 0 ? entry.rarity.weight / total : 0,
  }));
}

/** A percentage as short as it can be without lying: 60, 9.6, 0.2 — never 0. */
export function formatPercent(chance) {
  const percent = chance * 100;
  if (percent >= 10) return `${Math.round(percent)}%`;
  const tenths = Math.round(percent * 10) / 10;
  return `${tenths < 0.1 && percent > 0 ? 0.1 : tenths}%`;
}

/**
 * Draws a benediction: a rarity by weight, then a benediction of it at random.
 *
 * `random` is a parameter rather than `Math.random` read inside, for the same reason
 * `drawChestKey` takes one: a distribution is only testable if the draw can be fed.
 */
export function drawBenediction(random = Math.random, catalogue = BENEDICTIONS) {
  const odds = rarityOdds(catalogue);
  if (odds.length === 0) return null;
  const total = odds.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  let picked = odds[odds.length - 1];
  for (const entry of odds) {
    roll -= entry.weight;
    if (roll < 0) {
      picked = entry;
      break;
    }
  }
  // A `random()` that returns exactly 1, or a weight of 0, still gives a benediction:
  // the last entry is the floor of the draw, never nothing.
  const index = Math.min(picked.pool.length - 1, Math.floor(random() * picked.pool.length));
  return { benediction: picked.pool[index], rarity: picked.rarity };
}

/**
 * Draws the **offer**: `CHOICE_COUNT` benedictions from the whole wheel, all different.
 *
 * It is `CHOICE_COUNT` independent draws of `drawBenediction`, not one benediction per
 * rarity: the odds a player sees are the odds of every slot, so a Mythic has the same
 * ~0.2 % chance in all three — three shots at it, not one rarity dealt out by hand.
 *
 * **All different**, because an offer of `Iron Hide`, `Iron Hide`, `Quick Feet` is not a
 * choice. A repeated draw is thrown away and drawn again: the pool is far larger than
 * three, so this settles in a try or two, and a catalogue too small to fill an offer is
 * filled with whatever it has rather than padded with a duplicate.
 */
export function drawChoices(random = Math.random, catalogue = BENEDICTIONS) {
  const wanted = Math.min(CHOICE_COUNT, catalogue.length);
  const picked = [];
  const taken = new Set();
  // The bound is a guard, not a rule: a catalogue of three would otherwise loop for ever
  // once every entry is taken, which cannot happen before `wanted` is reached.
  for (let tries = 0; picked.length < wanted && tries < catalogue.length * 8; tries += 1) {
    const draw = drawBenediction(random, catalogue);
    if (!draw || taken.has(draw.benediction.id)) continue;
    taken.add(draw.benediction.id);
    picked.push(draw);
  }
  // A generator that always lands on the same entry cannot fill the offer by drawing, and
  // the guarantee is worth more than the draw: what is missing is taken from the catalogue,
  // so three choices are three **different** benedictions even then.
  if (picked.length < wanted) {
    for (const benediction of catalogue) {
      if (picked.length >= wanted) break;
      if (taken.has(benediction.id)) continue;
      taken.add(benediction.id);
      picked.push({ benediction, rarity: rarityOf(benediction.rarity) });
    }
  }
  return picked;
}

/** Points earned by reaching this aura level, spending included. */
export function pointsEarned(level) {
  const reached = Number.isFinite(level) ? Math.floor(level) : AURA_LEVEL_BASE;
  return Math.max(0, reached - AURA_LEVEL_BASE) * POINTS_PER_LEVEL;
}

/**
 * Points left: what the levels paid for, minus what has been **held** — the ones spent on a
 * choice and the ones waiting in the current offer. Never negative.
 *
 * The offer counts as spent on purpose: three cards on the table are three points promised,
 * and a player must not be able to roll three offers from one level's worth of points by
 * spending on credit.
 */
export function pointsLeft(level, spent) {
  const used = Number.isFinite(spent) ? Math.max(0, Math.floor(spent)) : 0;
  return Math.max(0, pointsEarned(level) - used);
}

/**
 * A hex colour as `rgb(r, g, b)`.
 *
 * `sendTopRightHelper` is explicit about this in the docs — its `color` must be `rgb()`,
 * and hex is not supported — so the card's background is converted rather than guessed.
 * Anything that is not a six-digit hex comes back unchanged, which is the least
 * surprising thing a colour helper can do.
 */
export function rgbOf(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}
