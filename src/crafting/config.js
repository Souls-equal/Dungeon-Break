/**
 * Crafts for custom armors and weapons — 2 steps:
 *  1) Shards (from Crates) -> Materials (ingots/alloys)
 *  2) Materials -> Armors (5 pieces per set) + Weapons (9 types per set)
 *
 * Each set is Diamond-level by default, tunable via setItemStat if needed.
 * Shards are dungeon currency, materials are the visible intermediate craft step.
 *
 * Stations:
 *  - Workbench: Tier 1 (Amethite, Magmasteel, Rubellite, Serpentite)
 *  - Artisan Bench: Tier 2+ (Cursemetal, Kingly, Sanguine, Spectral, Geo, Astral, Voltplate)
 */

// Helper to declare a craft: result = itemName, requires = [{items:[], amt}]
export const CRAFTS = [
  // ────────────── STEP 1: Shards -> Materials (ingots) ──────────────
  // Tier 1 — basic fragments -> elemental ingots (Workbench)
  {
    result: "Amethite",
    produces: 1,
    station: "Workbench",
    requires: [{ items: ["Amethite Fragment"], amt: 4 }],
  },
  {
    result: "Magmasteel",
    produces: 1,
    station: "Workbench",
    requires: [{ items: ["Magmasteel Fragment"], amt: 4 }],
  },
  {
    result: "Rubellite",
    produces: 1,
    station: "Workbench",
    requires: [{ items: ["Rubellite Fragment"], amt: 4 }],
  },
  {
    result: "Serpentite",
    produces: 1,
    station: "Workbench",
    requires: [{ items: ["Serpentite Fragment"], amt: 4 }],
  },
  // Tier 2 — Cursemetal alloy (Rubellite + Serpentite mix)
  {
    result: "Iron Plate",
    produces: 1,
    station: "Workbench",
    requires: [
      { items: ["Rubellite Fragment"], amt: 2 },
      { items: ["Serpentite Fragment"], amt: 2 },
      { items: ["Iron Bar"], amt: 1 },
    ],
    // Iron Plate = Cursemetal Ingot (proxy)
  },
  // Tier 2 — Kingly Amethite (refined Amethite)
  {
    result: "Gold Plate",
    produces: 1,
    station: "Artisan Bench",
    requires: [
      { items: ["Amethite"], amt: 3 },
      { items: ["Gold Bar"], amt: 2 },
      { items: ["Diamond Fragment"], amt: 1 },
    ],
    // Gold Plate = Kingly Amethite Ingot
  },
  // Tier 2 — Kingly Diamond (refined Diamond)
  {
    result: "Machine Hull",
    produces: 1,
    station: "Artisan Bench",
    requires: [
      { items: ["Diamond"], amt: 2 },
      { items: ["Gold Bar"], amt: 2 },
      { items: ["Amethite Fragment"], amt: 2 },
    ],
    // Machine Hull = Kingly Diamond Ingot
  },
  // Tier 3 — Sanguine (blood) -> Steel Bar
  {
    result: "Steel Bar",
    produces: 1,
    station: "Artisan Bench",
    requires: [
      { items: ["Sanguine Shard"], amt: 4 },
      { items: ["Iron Bar"], amt: 1 },
    ],
  },
  // Tier 3 — Spectral (ghost) -> Logic Board
  {
    result: "Logic Board",
    produces: 1,
    station: "Artisan Bench",
    requires: [
      { items: ["Spectral Shard"], amt: 4 },
      { items: ["Gold Fragment"], amt: 2 },
    ],
  },
  // Tier 3 — Geo (earth) -> Copper Bar
  {
    result: "Copper Bar",
    produces: 1,
    station: "Artisan Bench",
    requires: [
      { items: ["Geo Shard"], amt: 4 },
      { items: ["Iron Bar"], amt: 1 },
    ],
  },
  // Tier 4 — Astral (cosmos) -> Star Alloy
  {
    result: "Star Alloy",
    produces: 1,
    station: "Artisan Bench",
    requires: [
      { items: ["Astral Shard"], amt: 3 },
      { items: ["Comet Shard"], amt: 2 },
      { items: ["Moonstone Dust"], amt: 1 },
    ],
  },
  // Tier 4 — Voltplate (tech) -> Voltite Cell
  {
    result: "Voltite Cell",
    produces: 1,
    station: "Artisan Bench",
    requires: [
      { items: ["Voltite Dust"], amt: 3 },
      { items: ["Raw Voltite"], amt: 2 },
      { items: ["Copper Wire"], amt: 1 },
    ],
  },

  // ────────────── STEP 2: Materials -> Armors (5 pieces per set) ──────────────
  // Costs: Helmet 5, Chestplate 8, Leggings 7, Boots 4, Gauntlets 4
  // Each set has a secondary thematic filler

  // Amethite — Workbench + Iron Bar filler
  { result: "Amethite Helmet", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 5 }, { items: ["Iron Bar"], amt: 2 }] },
  { result: "Amethite Chestplate", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 8 }, { items: ["Iron Bar"], amt: 3 }] },
  { result: "Amethite Leggings", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 7 }, { items: ["Iron Bar"], amt: 3 }] },
  { result: "Amethite Boots", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 4 }, { items: ["Iron Bar"], amt: 2 }] },
  { result: "Amethite Gauntlets", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 4 }, { items: ["Iron Bar"], amt: 2 }] },

  // Magmasteel — Workbench + Coal (fire)
  { result: "Magmasteel Helmet", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 5 }, { items: ["Coal"], amt: 2 }] },
  { result: "Magmasteel Chestplate", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 8 }, { items: ["Coal"], amt: 3 }] },
  { result: "Magmasteel Leggings", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 7 }, { items: ["Coal"], amt: 3 }] },
  { result: "Magmasteel Boots", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 4 }, { items: ["Coal"], amt: 2 }] },
  { result: "Magmasteel Gauntlets", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 4 }, { items: ["Coal"], amt: 2 }] },

  // Rubellite — Workbench + Gold Fragment (gem)
  { result: "Rubellite Helmet", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 5 }, { items: ["Gold Fragment"], amt: 2 }] },
  { result: "Rubellite Chestplate", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 8 }, { items: ["Gold Fragment"], amt: 3 }] },
  { result: "Rubellite Leggings", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 7 }, { items: ["Gold Fragment"], amt: 3 }] },
  { result: "Rubellite Boots", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 4 }, { items: ["Gold Fragment"], amt: 2 }] },
  { result: "Rubellite Gauntlets", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 4 }, { items: ["Gold Fragment"], amt: 2 }] },

  // Serpentite — Workbench + Iron Fragment (scale)
  { result: "Serpentite Helmet", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 5 }, { items: ["Iron Fragment"], amt: 2 }] },
  { result: "Serpentite Chestplate", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 8 }, { items: ["Iron Fragment"], amt: 3 }] },
  { result: "Serpentite Leggings", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 7 }, { items: ["Iron Fragment"], amt: 3 }] },
  { result: "Serpentite Boots", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 4 }, { items: ["Iron Fragment"], amt: 2 }] },
  { result: "Serpentite Gauntlets", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 4 }, { items: ["Iron Fragment"], amt: 2 }] },

  // Cursemetal — Artisan Bench (Iron Plate = Cursemetal Ingot) + Gold Fragment
  { result: "Cursemetal Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Iron Plate"], amt: 5 }, { items: ["Gold Fragment"], amt: 2 }] },
  { result: "Cursemetal Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Iron Plate"], amt: 8 }, { items: ["Gold Fragment"], amt: 3 }] },
  { result: "Cursemetal Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Iron Plate"], amt: 7 }, { items: ["Gold Fragment"], amt: 3 }] },
  { result: "Cursemetal Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Iron Plate"], amt: 4 }, { items: ["Gold Fragment"], amt: 2 }] },
  { result: "Cursemetal Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Iron Plate"], amt: 4 }, { items: ["Gold Fragment"], amt: 2 }] },

  // Kingly Amethite — Artisan Bench (Gold Plate = Kingly Amethite Ingot) + Gold Bar
  { result: "Kingly Amethite Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Gold Plate"], amt: 5 }, { items: ["Gold Bar"], amt: 2 }] },
  { result: "Kingly Amethite Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Gold Plate"], amt: 8 }, { items: ["Gold Bar"], amt: 3 }] },
  { result: "Kingly Amethite Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Gold Plate"], amt: 7 }, { items: ["Gold Bar"], amt: 3 }] },
  { result: "Kingly Amethite Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Gold Plate"], amt: 4 }, { items: ["Gold Bar"], amt: 2 }] },
  { result: "Kingly Amethite Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Gold Plate"], amt: 4 }, { items: ["Gold Bar"], amt: 2 }] },

  // Kingly Diamond — Artisan Bench (Machine Hull = Kingly Diamond Ingot) + Diamond
  { result: "Kingly Diamond Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Machine Hull"], amt: 5 }, { items: ["Diamond"], amt: 2 }] },
  { result: "Kingly Diamond Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Machine Hull"], amt: 8 }, { items: ["Diamond"], amt: 3 }] },
  { result: "Kingly Diamond Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Machine Hull"], amt: 7 }, { items: ["Diamond"], amt: 3 }] },
  { result: "Kingly Diamond Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Machine Hull"], amt: 4 }, { items: ["Diamond"], amt: 2 }] },
  { result: "Kingly Diamond Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Machine Hull"], amt: 4 }, { items: ["Diamond"], amt: 2 }] },

  // Sanguine — Artisan Bench (Steel Bar = Sanguine Ingot) + Gold Bar
  { result: "Sanguine Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 5 }, { items: ["Gold Bar"], amt: 2 }] },
  { result: "Sanguine Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 8 }, { items: ["Gold Bar"], amt: 3 }] },
  { result: "Sanguine Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 7 }, { items: ["Gold Bar"], amt: 3 }] },
  { result: "Sanguine Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 4 }, { items: ["Gold Bar"], amt: 2 }] },
  { result: "Sanguine Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 4 }, { items: ["Gold Bar"], amt: 2 }] },

  // Spectral — Artisan Bench (Logic Board = Spectral Essence) + Moonstone Dust
  { result: "Spectral Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 5 }, { items: ["Moonstone Dust"], amt: 2 }] },
  { result: "Spectral Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 8 }, { items: ["Moonstone Dust"], amt: 3 }] },
  { result: "Spectral Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 7 }, { items: ["Moonstone Dust"], amt: 3 }] },
  { result: "Spectral Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 4 }, { items: ["Moonstone Dust"], amt: 2 }] },
  { result: "Spectral Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 4 }, { items: ["Moonstone Dust"], amt: 2 }] },

  // Geo — Artisan Bench (Copper Bar = Geo Core) + Iron Bar
  { result: "Geo Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 5 }, { items: ["Iron Bar"], amt: 2 }] },
  { result: "Geo Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 8 }, { items: ["Iron Bar"], amt: 3 }] },
  { result: "Geo Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 7 }, { items: ["Iron Bar"], amt: 3 }] },
  { result: "Geo Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 4 }, { items: ["Iron Bar"], amt: 2 }] },
  { result: "Geo Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 4 }, { items: ["Iron Bar"], amt: 2 }] },

  // Astral — Artisan Bench (Star Alloy = Astral Essence) + Comet Shard
  { result: "Astral Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 5 }, { items: ["Comet Shard"], amt: 2 }] },
  { result: "Astral Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 8 }, { items: ["Comet Shard"], amt: 3 }] },
  { result: "Astral Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 7 }, { items: ["Comet Shard"], amt: 3 }] },
  { result: "Astral Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 4 }, { items: ["Comet Shard"], amt: 2 }] },
  { result: "Astral Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 4 }, { items: ["Comet Shard"], amt: 2 }] },

  // Voltplate — Artisan Bench (Voltite Cell = Voltplate Core) + Copper Wire
  { result: "Voltplate Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Voltite Cell"], amt: 5 }, { items: ["Copper Wire"], amt: 2 }] },
  { result: "Voltplate Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Voltite Cell"], amt: 8 }, { items: ["Copper Wire"], amt: 3 }] },
  { result: "Voltplate Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Voltite Cell"], amt: 7 }, { items: ["Copper Wire"], amt: 3 }] },
  { result: "Voltplate Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Voltite Cell"], amt: 4 }, { items: ["Copper Wire"], amt: 2 }] },
  { result: "Voltplate Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Voltite Cell"], amt: 4 }, { items: ["Copper Wire"], amt: 2 }] },
];

// ────────────── STEP 2b: Materials -> Weapons (9 types per set, 72 weapons) ──────────────
// Each weapon follows the player's dealingDamageMultiplier via
// - the client option dealingDamageMultiplier (Bloxd already applies the multiplier to weapon damage)
// - the onPlayerDamagingMob hook that multiplies returned damage (fallback / custom mobs)
// Costs inspired by vanilla: Sword 2+1, Dagger 1+1, Spear 1+2, Club 3+1, Mace 2+1+1, Whip 1+1, Bow 3+1+2, Crossbow 4+1+2+2, Boomerang 2+1, Staff 2+2+1
export const WEAPON_CRAFTS = [
  // Amethite — Workbench (Tier 1)
  { result: "Amethite Sword", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { result: "Amethite Dagger", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { result: "Amethite Spear", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Amethite Club", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { result: "Amethite Mace", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { result: "Amethite Whip", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { result: "Amethite Bow", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Amethite Crossbow", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { result: "Amethite Boomerang", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  // Magmasteel — Workbench
  { result: "Magmasteel Sword", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { result: "Magmasteel Dagger", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { result: "Magmasteel Spear", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Magmasteel Club", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { result: "Magmasteel Mace", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { result: "Magmasteel Whip", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { result: "Magmasteel Bow", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Magmasteel Crossbow", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { result: "Magmasteel Boomerang", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  // Rubellite — Workbench
  { result: "Rubellite Sword", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { result: "Rubellite Dagger", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { result: "Rubellite Spear", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Rubellite Club", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { result: "Rubellite Mace", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { result: "Rubellite Whip", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { result: "Rubellite Bow", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Rubellite Crossbow", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { result: "Rubellite Boomerang", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  // Serpentite — Workbench
  { result: "Serpentite Sword", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { result: "Serpentite Dagger", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { result: "Serpentite Spear", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Serpentite Club", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { result: "Serpentite Mace", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { result: "Serpentite Whip", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { result: "Serpentite Bow", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Serpentite Crossbow", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { result: "Serpentite Boomerang", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  // Sanguine — Artisan Bench (Steel Bar = Sanguine Alloy)
  { result: "Sanguine Sword", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { result: "Sanguine Dagger", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { result: "Sanguine Spear", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Sanguine Club", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { result: "Sanguine Mace", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { result: "Sanguine Whip", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { result: "Sanguine Bow", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Sanguine Crossbow", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { result: "Sanguine Staff", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 2 }, { items: ["Stick"], amt: 2 }, { items: ["Gold Bar"], amt: 1 }] },
  // Spectral — Artisan Bench (Logic Board = Spectral Essence)
  { result: "Spectral Sword", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { result: "Spectral Dagger", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { result: "Spectral Spear", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Spectral Club", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { result: "Spectral Mace", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { result: "Spectral Whip", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { result: "Spectral Bow", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Spectral Crossbow", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { result: "Spectral Staff", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 2 }, { items: ["Stick"], amt: 2 }, { items: ["Moonstone Dust"], amt: 1 }] },
  // Geo — Artisan Bench (Copper Bar = Geo Core)
  { result: "Geo Sword", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { result: "Geo Dagger", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { result: "Geo Spear", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Geo Club", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { result: "Geo Mace", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { result: "Geo Whip", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { result: "Geo Bow", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Geo Crossbow", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { result: "Geo Staff", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 2 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 1 }] },
  // Astral — Artisan Bench (Star Alloy = Astral Essence)
  { result: "Astral Sword", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { result: "Astral Dagger", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { result: "Astral Spear", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Astral Club", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { result: "Astral Mace", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { result: "Astral Whip", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { result: "Astral Bow", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { result: "Astral Crossbow", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { result: "Astral Staff", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 2 }, { items: ["Stick"], amt: 2 }, { items: ["Comet Shard"], amt: 1 }] },
];

// Shard -> Material mapping for display / debug
export const SHARD_TO_MATERIAL = {
  "Amethite Fragment": "Amethite",
  "Magmasteel Fragment": "Magmasteel",
  "Rubellite Fragment": "Rubellite",
  "Serpentite Fragment": "Serpentite",
  "Sanguine Shard": "Steel Bar (Sanguine Alloy)",
  "Spectral Shard": "Logic Board (Spectral Essence)",
  "Geo Shard": "Copper Bar (Geo Core)",
  "Astral Shard": "Star Alloy (Astral Essence)",
  "Voltite Dust": "Voltite Cell (Voltplate Core)",
};

// Armor sets for debug
export const ARMOR_SETS = [
  { id: "amethite", label: "Amethite", material: "Amethite", shard: "Amethite Fragment", tier: 1 },
  { id: "magmasteel", label: "Magmasteel", material: "Magmasteel", shard: "Magmasteel Fragment", tier: 1 },
  { id: "rubellite", label: "Rubellite", material: "Rubellite", shard: "Rubellite Fragment", tier: 1 },
  { id: "serpentite", label: "Serpentite", material: "Serpentite", shard: "Serpentite Fragment", tier: 1 },
  { id: "cursemetal", label: "Cursemetal", material: "Iron Plate", shard: "Rubellite/Serpentite Fragment", tier: 2 },
  { id: "kinglyAmethite", label: "Kingly Amethite", material: "Gold Plate", shard: "Amethite + Gold", tier: 2 },
  { id: "kinglyDiamond", label: "Kingly Diamond", material: "Machine Hull", shard: "Diamond + Gold", tier: 2 },
  { id: "sanguine", label: "Sanguine", material: "Steel Bar", shard: "Sanguine Shard", tier: 3 },
  { id: "spectral", label: "Spectral", material: "Logic Board", shard: "Spectral Shard", tier: 3 },
  { id: "geo", label: "Geo", material: "Copper Bar", shard: "Geo Shard", tier: 3 },
  { id: "astral", label: "Astral", material: "Star Alloy", shard: "Astral Shard", tier: 4 },
  { id: "voltplate", label: "Voltplate", material: "Voltite Cell", shard: "Voltite Dust", tier: 4 },
];

// Weapon sets for debug (same tiers, 9 weapons per set, 72 total)
export const WEAPON_SETS = [
  { id: "amethite", label: "Amethite", material: "Amethite", shard: "Amethite Fragment", tier: 1, weapons: 9 },
  { id: "magmasteel", label: "Magmasteel", material: "Magmasteel", shard: "Magmasteel Fragment", tier: 1, weapons: 9 },
  { id: "rubellite", label: "Rubellite", material: "Rubellite", shard: "Rubellite Fragment", tier: 1, weapons: 9 },
  { id: "serpentite", label: "Serpentite", material: "Serpentite", shard: "Serpentite Fragment", tier: 1, weapons: 9 },
  { id: "sanguine", label: "Sanguine", material: "Steel Bar", shard: "Sanguine Shard", tier: 3, weapons: 9 },
  { id: "spectral", label: "Spectral", material: "Logic Board", shard: "Spectral Shard", tier: 3, weapons: 9 },
  { id: "geo", label: "Geo", material: "Copper Bar", shard: "Geo Shard", tier: 3, weapons: 9 },
  { id: "astral", label: "Astral", material: "Star Alloy", shard: "Astral Shard", tier: 4, weapons: 9 },
];

// Merge CRAFTS (armor + weapons) for backwards compat: service imports CRAFTS
for (const w of WEAPON_CRAFTS) CRAFTS.push(w);
