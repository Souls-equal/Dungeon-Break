/**
 * Crate system — config
 * Keys, air chances and loot tables per rarity.
 * Data only, no api.
 */

export const CRATE_KEYS = {
  Common: "Green Paintball",
  Uncommon: "Cyan Paintball",
  Rare: "Blue Paintball",
  Epic: "Purple Paintball",
  Legendary: "Yellow Paintball",
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
    { name: "Apple", amount: 3, weight: 55 },
    { name: "Arrow", amount: 5, weight: 35 },
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
    { name: "Iron Bar", amount: 6, weight: 45 },
    { name: "Gold Bar", amount: 4, weight: 35 },
    { name: "Iron Sword", amount: 1, weight: 20 },
  ],

  Epic: [
    { name: "Diamond", amount: 3, weight: 65 },
    { name: "Diamond Sword", amount: 1, weight: 35 },
  ],

  Legendary: [
    { name: "Knight Sword", amount: 1, weight: 45 },
    { name: "Diamond Chestplate", amount: 1, weight: 30 },
    { name: "Diamond Leggings", amount: 1, weight: 25 },
  ],
};
