/**
 * Crafts pour les armures custom — 2 étapes:
 *  1) Shards (obtenus dans les Crates) -> Matériaux (lingots/alliages)
 *  2) Matériaux -> Armures (5 pièces par set)
 *
 * Chaque set est Diamond-level par défaut, tunable via setItemStat si besoin.
 * Les shards sont la monnaie de donjon, les matériaux l'étape intermédiaire visible en craft.
 *
 * Stations:
 *  - Workbench: Tier 1 (Amethite, Magmasteel, Rubellite, Serpentite)
 *  - Artisan Bench: Tier 2+ (Cursemetal, Kingly, Sanguine, Spectral, Geo, Astral, Voltplate)
 */

// Helper pour déclarer un craft: result = itemName, requires = [{items:[], amt}]
export const CRAFTS = [
  // ────────────── ÉTAPE 1: Shards -> Matériaux (lingots) ──────────────
  // Tier 1 — fragments basiques -> lingots élémentaires (Workbench)
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
  // Tier 2 — alliage Cursemetal (mélange Rubellite + Serpentite)
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
  // Tier 2 — Kingly Amethite (Amethite raffiné)
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
  // Tier 2 — Kingly Diamond (Diamond raffiné)
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
  // Tier 3 — Sanguine (sang) -> Steel Bar
  {
    result: "Steel Bar",
    produces: 1,
    station: "Artisan Bench",
    requires: [
      { items: ["Sanguine Shard"], amt: 4 },
      { items: ["Iron Bar"], amt: 1 },
    ],
  },
  // Tier 3 — Spectral (spectre) -> Logic Board
  {
    result: "Logic Board",
    produces: 1,
    station: "Artisan Bench",
    requires: [
      { items: ["Spectral Shard"], amt: 4 },
      { items: ["Gold Fragment"], amt: 2 },
    ],
  },
  // Tier 3 — Geo (terre) -> Copper Bar
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

  // ────────────── ÉTAPE 2: Matériaux -> Armures (5 pièces par set) ──────────────
  // Coûts: Helmet 5, Chestplate 8, Leggings 7, Boots 4, Gauntlets 4
  // Chaque set a un filler thématique secondaire

  // Amethite — Workbench + Iron Bar filler
  { result: "Amethite Helmet", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 5 }, { items: ["Iron Bar"], amt: 2 }] },
  { result: "Amethite Chestplate", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 8 }, { items: ["Iron Bar"], amt: 3 }] },
  { result: "Amethite Leggings", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 7 }, { items: ["Iron Bar"], amt: 3 }] },
  { result: "Amethite Boots", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 4 }, { items: ["Iron Bar"], amt: 2 }] },
  { result: "Amethite Gauntlets", produces: 1, station: "Workbench", requires: [{ items: ["Amethite"], amt: 4 }, { items: ["Iron Bar"], amt: 2 }] },

  // Magmasteel — Workbench + Coal (feu)
  { result: "Magmasteel Helmet", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 5 }, { items: ["Coal"], amt: 2 }] },
  { result: "Magmasteel Chestplate", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 8 }, { items: ["Coal"], amt: 3 }] },
  { result: "Magmasteel Leggings", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 7 }, { items: ["Coal"], amt: 3 }] },
  { result: "Magmasteel Boots", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 4 }, { items: ["Coal"], amt: 2 }] },
  { result: "Magmasteel Gauntlets", produces: 1, station: "Workbench", requires: [{ items: ["Magmasteel"], amt: 4 }, { items: ["Coal"], amt: 2 }] },

  // Rubellite — Workbench + Gold Fragment (gemme)
  { result: "Rubellite Helmet", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 5 }, { items: ["Gold Fragment"], amt: 2 }] },
  { result: "Rubellite Chestplate", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 8 }, { items: ["Gold Fragment"], amt: 3 }] },
  { result: "Rubellite Leggings", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 7 }, { items: ["Gold Fragment"], amt: 3 }] },
  { result: "Rubellite Boots", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 4 }, { items: ["Gold Fragment"], amt: 2 }] },
  { result: "Rubellite Gauntlets", produces: 1, station: "Workbench", requires: [{ items: ["Rubellite"], amt: 4 }, { items: ["Gold Fragment"], amt: 2 }] },

  // Serpentite — Workbench + Iron Fragment (écaille)
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

// Shard -> Material mapping pour affichage / debug
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

// Armure sets pour debug
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
