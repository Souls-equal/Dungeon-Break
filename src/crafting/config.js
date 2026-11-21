/**
 * Crafts for custom armors and weapons — 2 steps:
 *  1) Shards (from Crates) -> Materials (ingots/alloys)
 *  2) Materials -> Armors (5 pieces per set) + Weapons (9 types per set)
 *
 * Each set is Diamond-level by default, tunable via setItemStat if needed.
 * Shards are dungeon currency, materials are the visible intermediate craft step.
 *
 * Stations (réorg étape 2):
 *  - Workbench: all weapons (swords, daggers, bows, etc.)
 *  - Artisan Bench: all armors (5 pieces per set)
 *  - Inventory (station ""): all materials (shards -> ingots/alloy)
 */

// Helper to declare a craft: result = itemName, requires = [{items:[], amt}]
export const CRAFTS = [
  // ────────────── STEP 1: Shards -> Materials (ingots) ──────────────
  // Tier 1 — basic fragments -> elemental ingots (Workbench)
  { isStarterRecipe: true,
    result: "Amethite",
    produces: 1,
    station: "",
    requires: [{ items: ["Amethite Fragment"], amt: 4 }],
  },
  { isStarterRecipe: true,
    result: "Magmasteel",
    produces: 1,
    station: "",
    requires: [{ items: ["Magmasteel Fragment"], amt: 4 }],
  },
  { isStarterRecipe: true,
    result: "Rubellite",
    produces: 1,
    station: "",
    requires: [{ items: ["Rubellite Fragment"], amt: 4 }],
  },
  { isStarterRecipe: true,
    result: "Serpentite",
    produces: 1,
    station: "",
    requires: [{ items: ["Serpentite Fragment"], amt: 4 }],
  },
  // Tier 2 — Cursemetal alloy (Rubellite + Serpentite mix)
  { isStarterRecipe: true,
    result: "Iron Plate",
    produces: 1,
    station: "",
    requires: [
      { items: ["Rubellite Fragment"], amt: 2 },
      { items: ["Serpentite Fragment"], amt: 2 },
      { items: ["Iron Bar"], amt: 1 },
    ],
    // Iron Plate = Cursemetal Ingot (proxy)
  },
  // Tier 2 — Kingly Amethite (refined Amethite)
  { isStarterRecipe: true,
    result: "Gold Plate",
    produces: 1,
    station: "",
    requires: [
      { items: ["Amethite"], amt: 3 },
      { items: ["Gold Bar"], amt: 2 },
      { items: ["Diamond Fragment"], amt: 1 },
    ],
    // Gold Plate = Kingly Amethite Ingot
  },
  // Tier 2 — Kingly Diamond (refined Diamond)
  { isStarterRecipe: true,
    result: "Machine Hull",
    produces: 1,
    station: "",
    requires: [
      { items: ["Diamond"], amt: 2 },
      { items: ["Gold Bar"], amt: 2 },
      { items: ["Amethite Fragment"], amt: 2 },
    ],
    // Machine Hull = Kingly Diamond Ingot
  },
  // Tier 3 — Sanguine (blood) -> Steel Bar
  { isStarterRecipe: true,
    result: "Steel Bar",
    produces: 1,
    station: "",
    requires: [
      { items: ["Sanguine Shard"], amt: 4 },
      { items: ["Iron Bar"], amt: 1 },
    ],
  },
  // Tier 3 — Spectral (ghost) -> Logic Board
  { isStarterRecipe: true,
    result: "Logic Board",
    produces: 1,
    station: "",
    requires: [
      { items: ["Spectral Shard"], amt: 4 },
      { items: ["Gold Fragment"], amt: 2 },
    ],
  },
  // Tier 3 — Geo (earth) -> Copper Bar
  { isStarterRecipe: true,
    result: "Copper Bar",
    produces: 1,
    station: "",
    requires: [
      { items: ["Geo Shard"], amt: 4 },
      { items: ["Iron Bar"], amt: 1 },
    ],
  },
  // Tier 4 — Astral (cosmos) -> Star Alloy
  { isStarterRecipe: true,
    result: "Star Alloy",
    produces: 1,
    station: "",
    requires: [
      { items: ["Astral Shard"], amt: 3 },
      { items: ["Comet Shard"], amt: 2 },
      { items: ["Moonstone Dust"], amt: 1 },
    ],
  },
  // Tier 4 — Voltplate (tech) -> Voltite Cell
  { isStarterRecipe: true,
    result: "Voltite Cell",
    produces: 1,
    station: "",
    requires: [
      { items: ["Voltite Dust"], amt: 3 },
      { items: ["Raw Voltite"], amt: 2 },
      { items: ["Copper Wire"], amt: 1 },
    ],
  },
  // Tier 5 — Nova (ultimate) -> Nova Matter
  { isStarterRecipe: true,
    result: "Nova Matter",
    produces: 1,
    station: "",
    requires: [
      { items: ["Star Alloy"], amt: 2 },
      { items: ["Voltite Cell"], amt: 1 },
    ],
  },

  // ────────────── Recyclage (inspiré vanilla) ──────────────
  { isStarterRecipe: true, result: "Amethite Fragment", produces: 2, station: "", requires: [{ items: ["Amethite"], amt: 1 }] },
  { isStarterRecipe: true, result: "Magmasteel Fragment", produces: 2, station: "", requires: [{ items: ["Magmasteel"], amt: 1 }] },
  { isStarterRecipe: true, result: "Rubellite Fragment", produces: 2, station: "", requires: [{ items: ["Rubellite"], amt: 1 }] },
  { isStarterRecipe: true, result: "Serpentite Fragment", produces: 2, station: "", requires: [{ items: ["Serpentite"], amt: 1 }] },

  // ────────────── Basic fragments -> bars (inventory, handcraft) ──────────────
  { isStarterRecipe: true, result: "Iron Bar", produces: 1, station: "", requires: [{ items: ["Iron Fragment"], amt: 4 }] },
  { isStarterRecipe: true, result: "Gold Bar", produces: 1, station: "", requires: [{ items: ["Gold Fragment"], amt: 4 }] },
  { isStarterRecipe: true, result: "Diamond", produces: 1, station: "", requires: [{ items: ["Diamond Fragment"], amt: 4 }] },

  // ────────────── Maple conversions (handcraft, visible everywhere) ──────────────
  { isStarterRecipe: true, result: "Maple Wood Planks", produces: 4, station: "", requires: [{ items: ["Maple Log"], amt: 1 }] },
  { isStarterRecipe: true, result: "Stick", produces: 1, station: "", requires: [{ items: ["Maple Wood Planks"], amt: 2 }] },

  // ────────────── STEP 2: Materials -> Armors (5 pieces per set) ──────────────
  // Costs: Helmet 5, Chestplate 8, Leggings 7, Boots 4, Gauntlets 4
  // Each set has a secondary thematic filler

  // Amethite — Workbench + Iron Bar filler
  { isStarterRecipe: true, result: "Amethite Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Amethite"], amt: 5 }, { items: ["Iron Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Amethite Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Amethite"], amt: 8 }, { items: ["Iron Bar"], amt: 3 }] },
  { isStarterRecipe: true, result: "Amethite Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Amethite"], amt: 7 }, { items: ["Iron Bar"], amt: 3 }] },
  { isStarterRecipe: true, result: "Amethite Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Amethite"], amt: 4 }, { items: ["Iron Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Amethite Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Amethite"], amt: 4 }, { items: ["Iron Bar"], amt: 2 }] },

  // Magmasteel — Workbench + Coal (fire)
  { isStarterRecipe: true, result: "Magmasteel Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Magmasteel"], amt: 5 }, { items: ["Coal"], amt: 2 }] },
  { isStarterRecipe: true, result: "Magmasteel Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Magmasteel"], amt: 8 }, { items: ["Coal"], amt: 3 }] },
  { isStarterRecipe: true, result: "Magmasteel Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Magmasteel"], amt: 7 }, { items: ["Coal"], amt: 3 }] },
  { isStarterRecipe: true, result: "Magmasteel Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Magmasteel"], amt: 4 }, { items: ["Coal"], amt: 2 }] },
  { isStarterRecipe: true, result: "Magmasteel Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Magmasteel"], amt: 4 }, { items: ["Coal"], amt: 2 }] },

  // Rubellite — Workbench + Gold Fragment (gem)
  { isStarterRecipe: true, result: "Rubellite Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Rubellite"], amt: 5 }, { items: ["Gold Fragment"], amt: 2 }] },
  { isStarterRecipe: true, result: "Rubellite Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Rubellite"], amt: 8 }, { items: ["Gold Fragment"], amt: 3 }] },
  { isStarterRecipe: true, result: "Rubellite Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Rubellite"], amt: 7 }, { items: ["Gold Fragment"], amt: 3 }] },
  { isStarterRecipe: true, result: "Rubellite Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Rubellite"], amt: 4 }, { items: ["Gold Fragment"], amt: 2 }] },
  { isStarterRecipe: true, result: "Rubellite Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Rubellite"], amt: 4 }, { items: ["Gold Fragment"], amt: 2 }] },

  // Serpentite — Workbench + Iron Fragment (scale)
  { isStarterRecipe: true, result: "Serpentite Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Serpentite"], amt: 5 }, { items: ["Iron Fragment"], amt: 2 }] },
  { isStarterRecipe: true, result: "Serpentite Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Serpentite"], amt: 8 }, { items: ["Iron Fragment"], amt: 3 }] },
  { isStarterRecipe: true, result: "Serpentite Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Serpentite"], amt: 7 }, { items: ["Iron Fragment"], amt: 3 }] },
  { isStarterRecipe: true, result: "Serpentite Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Serpentite"], amt: 4 }, { items: ["Iron Fragment"], amt: 2 }] },
  { isStarterRecipe: true, result: "Serpentite Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Serpentite"], amt: 4 }, { items: ["Iron Fragment"], amt: 2 }] },

  // Cursemetal — Artisan Bench (Iron Plate = Cursemetal Ingot) + Gold Fragment
  { isStarterRecipe: true, result: "Cursemetal Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Iron Plate"], amt: 5 }, { items: ["Gold Fragment"], amt: 2 }] },
  { isStarterRecipe: true, result: "Cursemetal Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Iron Plate"], amt: 8 }, { items: ["Gold Fragment"], amt: 3 }] },
  { isStarterRecipe: true, result: "Cursemetal Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Iron Plate"], amt: 7 }, { items: ["Gold Fragment"], amt: 3 }] },
  { isStarterRecipe: true, result: "Cursemetal Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Iron Plate"], amt: 4 }, { items: ["Gold Fragment"], amt: 2 }] },
  { isStarterRecipe: true, result: "Cursemetal Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Iron Plate"], amt: 4 }, { items: ["Gold Fragment"], amt: 2 }] },

  // Kingly Amethite — Artisan Bench (Gold Plate = Kingly Amethite Ingot) + Gold Bar
  { isStarterRecipe: true, result: "Kingly Amethite Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Gold Plate"], amt: 5 }, { items: ["Gold Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Kingly Amethite Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Gold Plate"], amt: 8 }, { items: ["Gold Bar"], amt: 3 }] },
  { isStarterRecipe: true, result: "Kingly Amethite Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Gold Plate"], amt: 7 }, { items: ["Gold Bar"], amt: 3 }] },
  { isStarterRecipe: true, result: "Kingly Amethite Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Gold Plate"], amt: 4 }, { items: ["Gold Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Kingly Amethite Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Gold Plate"], amt: 4 }, { items: ["Gold Bar"], amt: 2 }] },

  // Kingly Diamond — Artisan Bench (Machine Hull = Kingly Diamond Ingot) + Diamond
  { isStarterRecipe: true, result: "Kingly Diamond Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Machine Hull"], amt: 5 }, { items: ["Diamond"], amt: 2 }] },
  { isStarterRecipe: true, result: "Kingly Diamond Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Machine Hull"], amt: 8 }, { items: ["Diamond"], amt: 3 }] },
  { isStarterRecipe: true, result: "Kingly Diamond Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Machine Hull"], amt: 7 }, { items: ["Diamond"], amt: 3 }] },
  { isStarterRecipe: true, result: "Kingly Diamond Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Machine Hull"], amt: 4 }, { items: ["Diamond"], amt: 2 }] },
  { isStarterRecipe: true, result: "Kingly Diamond Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Machine Hull"], amt: 4 }, { items: ["Diamond"], amt: 2 }] },

  // Sanguine — Artisan Bench (Steel Bar = Sanguine Ingot) + Gold Bar
  { isStarterRecipe: true, result: "Sanguine Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 5 }, { items: ["Gold Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Sanguine Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 8 }, { items: ["Gold Bar"], amt: 3 }] },
  { isStarterRecipe: true, result: "Sanguine Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 7 }, { items: ["Gold Bar"], amt: 3 }] },
  { isStarterRecipe: true, result: "Sanguine Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 4 }, { items: ["Gold Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Sanguine Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Steel Bar"], amt: 4 }, { items: ["Gold Bar"], amt: 2 }] },

  // Spectral — Artisan Bench (Logic Board = Spectral Essence) + Moonstone Dust
  { isStarterRecipe: true, result: "Spectral Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 5 }, { items: ["Moonstone Dust"], amt: 2 }] },
  { isStarterRecipe: true, result: "Spectral Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 8 }, { items: ["Moonstone Dust"], amt: 3 }] },
  { isStarterRecipe: true, result: "Spectral Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 7 }, { items: ["Moonstone Dust"], amt: 3 }] },
  { isStarterRecipe: true, result: "Spectral Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 4 }, { items: ["Moonstone Dust"], amt: 2 }] },
  { isStarterRecipe: true, result: "Spectral Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Logic Board"], amt: 4 }, { items: ["Moonstone Dust"], amt: 2 }] },

  // Geo — Artisan Bench (Copper Bar = Geo Core) + Iron Bar
  { isStarterRecipe: true, result: "Geo Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 5 }, { items: ["Iron Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Geo Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 8 }, { items: ["Iron Bar"], amt: 3 }] },
  { isStarterRecipe: true, result: "Geo Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 7 }, { items: ["Iron Bar"], amt: 3 }] },
  { isStarterRecipe: true, result: "Geo Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 4 }, { items: ["Iron Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Geo Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Copper Bar"], amt: 4 }, { items: ["Iron Bar"], amt: 2 }] },

  // Astral — Artisan Bench (Star Alloy = Astral Essence) + Comet Shard
  { isStarterRecipe: true, result: "Astral Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 5 }, { items: ["Comet Shard"], amt: 2 }] },
  { isStarterRecipe: true, result: "Astral Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 8 }, { items: ["Comet Shard"], amt: 3 }] },
  { isStarterRecipe: true, result: "Astral Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 7 }, { items: ["Comet Shard"], amt: 3 }] },
  { isStarterRecipe: true, result: "Astral Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 4 }, { items: ["Comet Shard"], amt: 2 }] },
  { isStarterRecipe: true, result: "Astral Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Star Alloy"], amt: 4 }, { items: ["Comet Shard"], amt: 2 }] },

  // Voltplate — Artisan Bench (Voltite Cell = Voltplate Core) + Copper Wire
  { isStarterRecipe: true, result: "Voltplate Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Voltite Cell"], amt: 5 }, { items: ["Copper Wire"], amt: 2 }] },
  { isStarterRecipe: true, result: "Voltplate Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Voltite Cell"], amt: 8 }, { items: ["Copper Wire"], amt: 3 }] },
  { isStarterRecipe: true, result: "Voltplate Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Voltite Cell"], amt: 7 }, { items: ["Copper Wire"], amt: 3 }] },
  { isStarterRecipe: true, result: "Voltplate Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Voltite Cell"], amt: 4 }, { items: ["Copper Wire"], amt: 2 }] },
  { isStarterRecipe: true, result: "Voltplate Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Voltite Cell"], amt: 4 }, { items: ["Copper Wire"], amt: 2 }] },
];

// ────────────── STEP 2b: Materials -> Weapons (9 types per set, 72 weapons) ──────────────
// Each weapon follows the player's dealingDamageMultiplier via
// - the client option dealingDamageMultiplier (Bloxd already applies the multiplier to weapon damage)
// - the onPlayerDamagingMob hook that multiplies returned damage (fallback / custom mobs)
// Costs inspired by vanilla: Sword 2+1, Dagger 1+1, Spear 1+2, Club 3+1, Mace 2+1+1, Whip 1+1, Bow 3+1+2, Crossbow 4+1+2+2, Boomerang 2+1, Staff 2+2+1
export const WEAPON_CRAFTS = [
  // Amethite — Workbench (Tier 1)
  { isStarterRecipe: true, result: "Amethite Sword", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Amethite Dagger", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Amethite Spear", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Amethite Club", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Amethite Mace", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { isStarterRecipe: true, result: "Amethite Whip", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { isStarterRecipe: true, result: "Amethite Bow", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Amethite Crossbow", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Amethite Boomerang", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  // Magmasteel — Workbench
  { isStarterRecipe: true, result: "Magmasteel Sword", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Magmasteel Dagger", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Magmasteel Spear", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Magmasteel Club", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Magmasteel Mace", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { isStarterRecipe: true, result: "Magmasteel Whip", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { isStarterRecipe: true, result: "Magmasteel Bow", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Magmasteel Crossbow", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Magmasteel Boomerang", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  // Rubellite — Workbench
  { isStarterRecipe: true, result: "Rubellite Sword", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Rubellite Dagger", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Rubellite Spear", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Rubellite Club", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Rubellite Mace", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { isStarterRecipe: true, result: "Rubellite Whip", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { isStarterRecipe: true, result: "Rubellite Bow", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Rubellite Crossbow", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Rubellite Boomerang", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  // Serpentite — Workbench
  { isStarterRecipe: true, result: "Serpentite Sword", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Serpentite Dagger", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Serpentite Spear", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Serpentite Club", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Serpentite Mace", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { isStarterRecipe: true, result: "Serpentite Whip", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { isStarterRecipe: true, result: "Serpentite Bow", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Serpentite Crossbow", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Serpentite Boomerang", produces: 1, station: "Workbench", requires: [{ items: ["Serpentite"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  // Sanguine — Artisan Bench (Steel Bar = Sanguine Alloy)
  { isStarterRecipe: true, result: "Sanguine Sword", produces: 1, station: "Workbench", requires: [{ items: ["Steel Bar"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Sanguine Dagger", produces: 1, station: "Workbench", requires: [{ items: ["Steel Bar"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Sanguine Spear", produces: 1, station: "Workbench", requires: [{ items: ["Steel Bar"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Sanguine Club", produces: 1, station: "Workbench", requires: [{ items: ["Steel Bar"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Sanguine Mace", produces: 1, station: "Workbench", requires: [{ items: ["Steel Bar"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { isStarterRecipe: true, result: "Sanguine Whip", produces: 1, station: "Workbench", requires: [{ items: ["Steel Bar"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { isStarterRecipe: true, result: "Sanguine Bow", produces: 1, station: "Workbench", requires: [{ items: ["Steel Bar"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Sanguine Crossbow", produces: 1, station: "Workbench", requires: [{ items: ["Steel Bar"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Sanguine Staff", produces: 1, station: "Workbench", requires: [{ items: ["Steel Bar"], amt: 2 }, { items: ["Stick"], amt: 2 }, { items: ["Gold Bar"], amt: 1 }] },
  // Spectral — Artisan Bench (Logic Board = Spectral Essence)
  { isStarterRecipe: true, result: "Spectral Sword", produces: 1, station: "Workbench", requires: [{ items: ["Logic Board"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Spectral Dagger", produces: 1, station: "Workbench", requires: [{ items: ["Logic Board"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Spectral Spear", produces: 1, station: "Workbench", requires: [{ items: ["Logic Board"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Spectral Club", produces: 1, station: "Workbench", requires: [{ items: ["Logic Board"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Spectral Mace", produces: 1, station: "Workbench", requires: [{ items: ["Logic Board"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { isStarterRecipe: true, result: "Spectral Whip", produces: 1, station: "Workbench", requires: [{ items: ["Logic Board"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { isStarterRecipe: true, result: "Spectral Bow", produces: 1, station: "Workbench", requires: [{ items: ["Logic Board"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Spectral Crossbow", produces: 1, station: "Workbench", requires: [{ items: ["Logic Board"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Spectral Staff", produces: 1, station: "Workbench", requires: [{ items: ["Logic Board"], amt: 2 }, { items: ["Stick"], amt: 2 }, { items: ["Moonstone Dust"], amt: 1 }] },
  // Geo — Artisan Bench (Copper Bar = Geo Core)
  { isStarterRecipe: true, result: "Geo Sword", produces: 1, station: "Workbench", requires: [{ items: ["Copper Bar"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Geo Dagger", produces: 1, station: "Workbench", requires: [{ items: ["Copper Bar"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Geo Spear", produces: 1, station: "Workbench", requires: [{ items: ["Copper Bar"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Geo Club", produces: 1, station: "Workbench", requires: [{ items: ["Copper Bar"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Geo Mace", produces: 1, station: "Workbench", requires: [{ items: ["Copper Bar"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { isStarterRecipe: true, result: "Geo Whip", produces: 1, station: "Workbench", requires: [{ items: ["Copper Bar"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { isStarterRecipe: true, result: "Geo Bow", produces: 1, station: "Workbench", requires: [{ items: ["Copper Bar"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Geo Crossbow", produces: 1, station: "Workbench", requires: [{ items: ["Copper Bar"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Geo Staff", produces: 1, station: "Workbench", requires: [{ items: ["Copper Bar"], amt: 2 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 1 }] },
  // Astral — Artisan Bench (Star Alloy = Astral Essence)
  { isStarterRecipe: true, result: "Astral Sword", produces: 1, station: "Workbench", requires: [{ items: ["Star Alloy"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Astral Dagger", produces: 1, station: "Workbench", requires: [{ items: ["Star Alloy"], amt: 1 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Astral Spear", produces: 1, station: "Workbench", requires: [{ items: ["Star Alloy"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Astral Club", produces: 1, station: "Workbench", requires: [{ items: ["Star Alloy"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  { isStarterRecipe: true, result: "Astral Mace", produces: 1, station: "Workbench", requires: [{ items: ["Star Alloy"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }] },
  { isStarterRecipe: true, result: "Astral Whip", produces: 1, station: "Workbench", requires: [{ items: ["Star Alloy"], amt: 1 }, { items: ["Cotton"], amt: 1 }] },
  { isStarterRecipe: true, result: "Astral Bow", produces: 1, station: "Workbench", requires: [{ items: ["Star Alloy"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }] },
  { isStarterRecipe: true, result: "Astral Crossbow", produces: 1, station: "Workbench", requires: [{ items: ["Star Alloy"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }] },
  { isStarterRecipe: true, result: "Astral Staff", produces: 1, station: "Workbench", requires: [{ items: ["Star Alloy"], amt: 2 }, { items: ["Stick"], amt: 2 }, { items: ["Comet Shard"], amt: 1 }] },
  // Moonstone Sword — juste après Diamond, plus de dégâts, Workbench
  { isStarterRecipe: true, result: "Moonstone Sword", produces: 1, station: "Workbench", requires: [{ items: ["Moonstone"], amt: 2 }, { items: ["Stick"], amt: 1 }] },
  // Nova Blade — dernière arme, Workbench
  { isStarterRecipe: true, result: "Nova Blade", produces: 1, station: "Workbench", requires: [{ items: ["Nova Matter"], amt: 3 }, { items: ["Stick"], amt: 1 }] },
  // Nova Armors — 5 pièces, Artisan Bench (tier ultime) — 2 ingrédients comme Astral (valide côté serveur)
  { isStarterRecipe: true, result: "Nova Helmet", produces: 1, station: "Artisan Bench", requires: [{ items: ["Nova Matter"], amt: 5 }, { items: ["Comet Shard"], amt: 2 }] },
  { isStarterRecipe: true, result: "Nova Chestplate", produces: 1, station: "Artisan Bench", requires: [{ items: ["Nova Matter"], amt: 8 }, { items: ["Comet Shard"], amt: 3 }] },
  { isStarterRecipe: true, result: "Nova Leggings", produces: 1, station: "Artisan Bench", requires: [{ items: ["Nova Matter"], amt: 7 }, { items: ["Comet Shard"], amt: 3 }] },
  { isStarterRecipe: true, result: "Nova Boots", produces: 1, station: "Artisan Bench", requires: [{ items: ["Nova Matter"], amt: 4 }, { items: ["Comet Shard"], amt: 2 }] },
  { isStarterRecipe: true, result: "Nova Gauntlets", produces: 1, station: "Artisan Bench", requires: [{ items: ["Nova Matter"], amt: 4 }, { items: ["Comet Shard"], amt: 2 }] },
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
  "Nova Shard": "Nova Matter (Nova Core)",
  "Moonstone Fragment": "Moonstone",
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
  { id: "nova", label: "Nova", material: "Nova Matter", shard: "Nova Shard", tier: 6 },
  { id: "moonstone", label: "Moonstone", material: "Moonstone", shard: "Moonstone Fragment", tier: 5 },
];

// Weapon sets for debug (same tiers, 72 total + novelties)
export const WEAPON_SETS = [
  { id: "amethite", label: "Amethite", material: "Amethite", shard: "Amethite Fragment", tier: 1, weapons: 9 },
  { id: "magmasteel", label: "Magmasteel", material: "Magmasteel", shard: "Magmasteel Fragment", tier: 1, weapons: 9 },
  { id: "rubellite", label: "Rubellite", material: "Rubellite", shard: "Rubellite Fragment", tier: 1, weapons: 9 },
  { id: "serpentite", label: "Serpentite", material: "Serpentite", shard: "Serpentite Fragment", tier: 1, weapons: 9 },
  { id: "sanguine", label: "Sanguine", material: "Steel Bar", shard: "Sanguine Shard", tier: 3, weapons: 9 },
  { id: "spectral", label: "Spectral", material: "Logic Board", shard: "Spectral Shard", tier: 3, weapons: 9 },
  { id: "geo", label: "Geo", material: "Copper Bar", shard: "Geo Shard", tier: 3, weapons: 9 },
  { id: "astral", label: "Astral", material: "Star Alloy", shard: "Astral Shard", tier: 4, weapons: 9 },
  { id: "moonstone", label: "Moonstone", material: "Moonstone", shard: "Moonstone Fragment", tier: 5, weapons: 1 },
  { id: "nova", label: "Nova", material: "Nova Matter", shard: "Nova Shard", tier: 6, weapons: 1 },
];

// Merge CRAFTS (armor + weapons) for backwards compat: service imports CRAFTS
for (const w of WEAPON_CRAFTS) CRAFTS.push(w);
