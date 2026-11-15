/**
 * Crate system — config
 * Keys, air chances and loot tables per rarity.
 * Data only, no api.
 * Amount supporte soit `amount` fixe, soit `min`/`max` pour tirage aléatoire inclusif.
 */

export const CRATE_KEYS = {
  Common: "Wooden Key",
  Uncommon: "Stone Key",
  Rare: "Iron Key",
  Epic: "Gold Key",
  Legendary: "Diamond Key",
};

export const AIR_CHANCE = {
  Common: 45,
  Uncommon: 40,
  Rare: 35,
  Epic: 30,
  Legendary: 30,
};

export const LOOT_TABLE = {
  Common: [
    { name: "Apple", min: 2, max: 7, weight: 55 },
    { name: "Arrow", min: 3, max: 8, weight: 35 },
    { name: "Wood Sword", amount: 1, weight: 7 },
    { name: "Wood Helmet", amount: 1, weight: 3 },
    { name: "Wood Boots", amount: 1, weight: 3 },
  ],

  Uncommon: [
    { name: "Stone Sword", amount: 1, weight: 20 },
    { name: "Wood Chestplate", amount: 1, weight: 3 },
    { name: "Wood Leggings", amount: 1, weight: 3 },
    { name: "Iron Helmet", amount: 1, weight: 3 },
    { name: "Iron Boots", amount: 1, weight: 3 },
  ],

  Rare: [
    { name: "Iron Bar", min: 4, max: 8, weight: 45 },
    { name: "Gold Bar", min: 2, max: 6, weight: 35 },
    { name: "Iron Sword", amount: 1, weight: 20 },
  ],

  Epic: [
    { name: "Diamond", min: 2, max: 5, weight: 65 },
    { name: "Diamond Sword", amount: 1, weight: 35 },
  ],

  Legendary: [
    { name: "Knight Sword", amount: 1, weight: 45 },
    { name: "Diamond Chestplate", amount: 1, weight: 30 },
    { name: "Diamond Leggings", amount: 1, weight: 25 },
  ],
};
