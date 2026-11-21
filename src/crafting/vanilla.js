/**
 * Vanilla crafts re-exposed after hide-all.
 *
 * Goal: hide all non-modded crafts (removeItemCraftingRecipes(null))
 * then add back only what makes sense: vanilla armors + weapons.
 * Custom crafts (CRAFTS) remain the main progression.
 *
 * Constraint: all ingredients/results must exist in item-names.txt
 * (otherwise craft does nothing / validation fails). So we use
 * valid proxies for Wood/Stone (Stick / Coal).
 *
 * Stations (reorg step 2):
 *  - Workbench: weapons (swords, bows, etc.)
 *  - Artisan Bench: armor
 *  - Inventory (""): materials (handcraft)
 *
 * Quantities based on Bloxd.io wiki (Equipment):
 *  - armor: Helmet 5, Chestplate 8, Leggings 7, Boots 4, Gauntlets 4 (28/set)
 *  - sword: Wood 3 planks, Stone/Iron/Gold/Diamond/Moonstone = 2 mat +1 Stick
 *  - pickaxe/axe: 3 mat +1 Stick (Wood only: 4 Stick)
 *  - shovel: 1 mat +1 Stick (Wood only: 2 Stick)
 *  - hoe: 2 mat +1 Stick (Wood only: 3 Stick)
 *  - bow: 3 mat +1 Cotton +2 Stick
 *  - crossbow: variants (see below)
 *  - spear/dagger/mace/club/whip/boomerang: patterns inspired by community code blocks
 */

// ------------------------------------------------------------------
// helpers
function armorSet(material, barItem, station) {
  const s = station ?? undefined;
  return [
    { result: `${material} Helmet`, produces: 1, station: s, isStarterRecipe: true, requires: [{ items: [barItem], amt: 5 }] },
    { result: `${material} Chestplate`, produces: 1, station: s, isStarterRecipe: true, requires: [{ items: [barItem], amt: 8 }] },
    { result: `${material} Leggings`, produces: 1, station: s, isStarterRecipe: true, requires: [{ items: [barItem], amt: 7 }] },
    { result: `${material} Boots`, produces: 1, station: s, isStarterRecipe: true, requires: [{ items: [barItem], amt: 4 }] },
    { result: `${material} Gauntlets`, produces: 1, station: s, isStarterRecipe: true, requires: [{ items: [barItem], amt: 4 }] },
  ];
}

function craft(result, station, requires) {
  return { result, produces: 1, station, isStarterRecipe: true, requires };
}

// Wood/Stone are blocks, not listed items — we use Stick/Coal as valid proxies
// (player gets them by breaking wood/stone, understandable)
const WOOD_ING = ["Stick"];
const STONE_ING = ["Coal"];

export const VANILLA_CRAFTS = [
  // ────────────────────────── VANILLA ARMORS ──────────────────────────
  // Réorg étape 2 : armures → Artisan Bench (Workbench = armes), Wood reste inventaire
  ...armorSet("Wood", "Stick", undefined),
  ...armorSet("Iron", "Iron Bar", "Artisan Bench"),
  ...armorSet("Gold", "Gold Bar", "Artisan Bench"),
  ...armorSet("Diamond", "Diamond", "Artisan Bench"),

  // ────────────────────────── VANILLA TOOLS ──────────────────────────
  craft("Wood Pickaxe", undefined, [{ items: WOOD_ING, amt: 4 }]),
  craft("Wood Axe", undefined, [{ items: WOOD_ING, amt: 4 }]),
  craft("Wood Spade", undefined, [{ items: WOOD_ING, amt: 2 }]),
  craft("Wood Hoe", undefined, [{ items: WOOD_ING, amt: 3 }]),

  craft("Stone Pickaxe", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: STONE_ING, amt: 3 }]),
  craft("Stone Axe", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: STONE_ING, amt: 3 }]),
  craft("Stone Spade", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: STONE_ING, amt: 1 }]),
  craft("Stone Hoe", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: STONE_ING, amt: 2 }]),

  craft("Iron Pickaxe", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 3 }]),
  craft("Iron Axe", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 3 }]),
  craft("Iron Spade", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }]),
  craft("Iron Hoe", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 2 }]),

  craft("Gold Pickaxe", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Gold Bar"], amt: 3 }]),
  craft("Gold Axe", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Gold Bar"], amt: 3 }]),
  craft("Gold Spade", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Gold Bar"], amt: 1 }]),
  craft("Gold Hoe", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Gold Bar"], amt: 2 }]),

  craft("Diamond Pickaxe", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Diamond"], amt: 3 }]),
  craft("Diamond Axe", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Diamond"], amt: 3 }]),
  craft("Diamond Spade", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Diamond"], amt: 1 }]),
  craft("Diamond Hoe", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Diamond"], amt: 2 }]),

  craft("Moonstone Pickaxe", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Moonstone"], amt: 3 }]),
  craft("Moonstone Axe", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Moonstone"], amt: 3 }]),

  // ────────────────────────── VANILLA SWORDS ──────────────────────────
  craft("Wood Sword", undefined, [{ items: WOOD_ING, amt: 3 }]),
  craft("Stone Sword", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: STONE_ING, amt: 2 }]),
  craft("Iron Sword", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 2 }]),
  craft("Gold Sword", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Gold Bar"], amt: 2 }]),
  craft("Diamond Sword", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Diamond"], amt: 2 }]),
  craft("Moonstone Sword", "Workbench", [{ items: ["Stick"], amt: 1 }, { items: ["Moonstone"], amt: 2 }]),
  craft("Knight Sword", "Workbench", [{ items: ["Diamond Sword"], amt: 1 }, { items: ["Knight Heart"], amt: 3 }]),

  // ────────────────────────── VANILLA BOWS / CROSSBOWS ──────────────────────────
  craft("Wood Bow", "Workbench", [{ items: WOOD_ING, amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }]),
  craft("Stone Bow", "Workbench", [{ items: STONE_ING, amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }]),
  craft("Iron Bow", "Workbench", [{ items: ["Iron Bar"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }]),
  craft("Gold Bow", "Workbench", [{ items: ["Gold Bar"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }]),
  craft("Diamond Bow", "Workbench", [{ items: ["Diamond"], amt: 3 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }]),

  craft("Wood Crossbow", "Workbench", [{ items: WOOD_ING, amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }]),
  craft("Stone Crossbow", "Workbench", [{ items: STONE_ING, amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }]),
  craft("Iron Crossbow", "Workbench", [{ items: ["Iron Bar"], amt: 6 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }]),
  craft("Gold Crossbow", "Workbench", [{ items: ["Gold Bar"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }]),
  craft("Diamond Crossbow", "Workbench", [{ items: ["Diamond"], amt: 4 }, { items: ["Cotton"], amt: 1 }, { items: ["Stick"], amt: 2 }, { items: ["Iron Bar"], amt: 2 }]),

  // ────────────────────────── SPEARS / DAGGERS / MACES / CLUBS / WHIPS / BOOMERANGS ──────────────────────────
  craft("Wood Spear", "Workbench", [{ items: WOOD_ING, amt: 1 }, { items: ["Stick"], amt: 2 }]),
  craft("Stone Spear", "Workbench", [{ items: STONE_ING, amt: 1 }, { items: ["Stick"], amt: 2 }]),
  craft("Iron Spear", "Workbench", [{ items: ["Iron Bar"], amt: 1 }, { items: ["Stick"], amt: 2 }]),
  craft("Gold Spear", "Workbench", [{ items: ["Gold Bar"], amt: 1 }, { items: ["Stick"], amt: 2 }]),
  craft("Diamond Spear", "Workbench", [{ items: ["Diamond"], amt: 1 }, { items: ["Stick"], amt: 2 }]),
  craft("Moonstone Spear", "Workbench", [{ items: ["Moonstone"], amt: 1 }, { items: ["Stick"], amt: 2 }]),

  craft("Wood Dagger", "Workbench", [{ items: WOOD_ING, amt: 1 }, { items: ["Stick"], amt: 1 }]),
  craft("Stone Dagger", "Workbench", [{ items: STONE_ING, amt: 1 }, { items: ["Stick"], amt: 1 }]),
  craft("Iron Dagger", "Workbench", [{ items: ["Iron Bar"], amt: 1 }, { items: ["Stick"], amt: 1 }]),
  craft("Gold Dagger", "Workbench", [{ items: ["Gold Bar"], amt: 1 }, { items: ["Stick"], amt: 1 }]),
  craft("Diamond Dagger", "Workbench", [{ items: ["Diamond"], amt: 1 }, { items: ["Stick"], amt: 1 }]),
  craft("Moonstone Dagger", "Workbench", [{ items: ["Moonstone"], amt: 1 }, { items: ["Stick"], amt: 1 }]),

  craft("Wood Club", "Workbench", [{ items: WOOD_ING, amt: 3 }, { items: ["Stick"], amt: 1 }]),
  craft("Stone Club", "Workbench", [{ items: STONE_ING, amt: 3 }, { items: ["Stick"], amt: 1 }]),
  craft("Iron Club", "Workbench", [{ items: ["Iron Bar"], amt: 3 }, { items: ["Stick"], amt: 1 }]),
  craft("Gold Club", "Workbench", [{ items: ["Gold Bar"], amt: 3 }, { items: ["Stick"], amt: 1 }]),
  craft("Diamond Club", "Workbench", [{ items: ["Diamond"], amt: 3 }, { items: ["Stick"], amt: 1 }]),
  craft("Moonstone Club", "Workbench", [{ items: ["Moonstone"], amt: 3 }, { items: ["Stick"], amt: 1 }]),

  craft("Wood Mace", "Workbench", [{ items: WOOD_ING, amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }]),
  craft("Stone Mace", "Workbench", [{ items: STONE_ING, amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }]),
  craft("Iron Mace", "Workbench", [{ items: ["Iron Bar"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }]),
  craft("Gold Mace", "Workbench", [{ items: ["Gold Bar"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }]),
  craft("Diamond Mace", "Workbench", [{ items: ["Diamond"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }]),
  craft("Moonstone Mace", "Workbench", [{ items: ["Moonstone"], amt: 2 }, { items: ["Stick"], amt: 1 }, { items: ["Iron Bar"], amt: 1 }]),

  craft("Wood Whip", "Workbench", [{ items: WOOD_ING, amt: 1 }, { items: ["Cotton"], amt: 1 }]),
  craft("Stone Whip", "Workbench", [{ items: STONE_ING, amt: 1 }, { items: ["Cotton"], amt: 1 }]),
  craft("Iron Whip", "Workbench", [{ items: ["Iron Bar"], amt: 1 }, { items: ["Cotton"], amt: 1 }]),
  craft("Gold Whip", "Workbench", [{ items: ["Gold Bar"], amt: 1 }, { items: ["Cotton"], amt: 1 }]),
  craft("Diamond Whip", "Workbench", [{ items: ["Diamond"], amt: 1 }, { items: ["Cotton"], amt: 1 }]),
  craft("Moonstone Whip", "Workbench", [{ items: ["Moonstone"], amt: 1 }, { items: ["Cotton"], amt: 1 }]),

  craft("Wood Boomerang", "Workbench", [{ items: WOOD_ING, amt: 2 }, { items: ["Stick"], amt: 1 }]),
  craft("Stone Boomerang", "Workbench", [{ items: STONE_ING, amt: 2 }, { items: ["Stick"], amt: 1 }]),
  craft("Iron Boomerang", "Workbench", [{ items: ["Iron Bar"], amt: 2 }, { items: ["Stick"], amt: 1 }]),
  craft("Gold Boomerang", "Workbench", [{ items: ["Gold Bar"], amt: 2 }, { items: ["Stick"], amt: 1 }]),
  craft("Diamond Boomerang", "Workbench", [{ items: ["Diamond"], amt: 2 }, { items: ["Stick"], amt: 1 }]),
  craft("Moonstone Boomerang", "Workbench", [{ items: ["Moonstone"], amt: 2 }, { items: ["Stick"], amt: 1 }]),
];
