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
    { name: "Apple", min: 1, max: 5, weight: 55 },
    { name: "Coal", min: 1, max: 8, weight: 35 },
    { name: "Raw Potato", min: 1, max: 6, weight: 40 },
    { name: "Iron Bar", min: 1, max: 3, weight: 25 },
    { name: "Iron Fragment", min: 3, max: 7, weight: 55 },

    { name: "Wood Sword", amount: 1, weight: 6 },
    { name: "Wood Mace", amount: 1, weight: 7 },
    { name: "Wood Dagger", amount: 1, weight: 7 },
    { name: "Wood Whip", amount: 1, weight: 7 },
    { name: "Wood Club", amount: 1, weight: 7 },
    { name: "Wood Club", amount: 1, weight: 7 },
    { name: "Wood Bow", amount: 1, weight: 7 },
    { name: "Arrow", min: 5, max: 12, weight: 20 },

    { name: "Wood Helmet", amount: 1, weight: 4 },
    { name: "Wood Chestplate", amount: 1, weight: 2 },
    { name: "Wood Gauntlets", amount: 1, weight: 4 },
    { name: "Wood Leggings", amount: 1, weight: 3 },
    { name: "Wood Boots", amount: 1, weight: 4 },
  ],

  Uncommon: [
    { name: "Apple", min: 3, max: 8, weight: 55 },
    { name: "Bread", min: 1, max: 7, weight: 40 },
    { name: "Iron Bar", min: 4, max: 9, weight: 25 },
    { name: "Gold Bar", min: 1, max: 3, weight: 15 },
    { name: "Gold Fragment", min: 1, max: 8, weight: 22 },

    { name: "Stone Sword", amount: 1, weight: 9 },
    { name: "Stone Mace", amount: 1, weight: 7 },
    { name: "Stone Dagger", amount: 1, weight: 7 },
    { name: "Stone Whip", amount: 1, weight: 7 },
    { name: "Stone Club", amount: 1, weight: 7 },
    { name: "Stone Bow", amount: 1, weight: 7 },
    { name: "Arrow", min: 5, max: 12, weight: 20 },

    { name: "Iron Helmet", amount: 1, weight: 4 },
    { name: "Iron Chestplate", amount: 1, weight: 2 },
    { name: "Iron Gauntlets", amount: 1, weight: 4 },
    { name: "Iron Leggings", amount: 1, weight: 3 },
    { name: "Iron Boots", amount: 1, weight: 4 },
  ],

  Rare: [
    { name: "Iron Sword", amount: 1, weight: 9 },
    { name: "Iron Mace", amount: 1, weight: 7 },
    { name: "Iron Dagger", amount: 1, weight: 7 },
    { name: "Iron Whip", amount: 1, weight: 7 },
    { name: "Iron Club", amount: 1, weight: 7 },
    { name: "Iron Bow", amount: 1, weight: 7 },
    { name: "Arrow", min: 5, max: 12, weight: 20 },

    { name: "Gold Helmet", amount: 1, weight: 4 },
    { name: "Gold Chestplate", amount: 1, weight: 2 },
    { name: "Gold Gauntlets", amount: 1, weight: 4 },
    { name: "Gold Leggings", amount: 1, weight: 3 },
    { name: "Gold Boots", amount: 1, weight: 4 },
  ],

  Epic: [
    { name: "Gold Sword", amount: 1, weight: 9 },
    { name: "Gold Mace", amount: 1, weight: 7 },
    { name: "Gold Dagger", amount: 1, weight: 7 },
    { name: "Gold Whip", amount: 1, weight: 7 },
    { name: "Gold Club", amount: 1, weight: 7 },
    { name: "Gold Bow", amount: 1, weight: 7 },
    { name: "Arrow", min: 5, max: 12, weight: 20 },

    { name: "Diamond Helmet", amount: 1, weight: 4 },
    { name: "Diamond Chestplate", amount: 1, weight: 2 },
    { name: "Diamond Gauntlets", amount: 1, weight: 4 },
    { name: "Diamond Leggings", amount: 1, weight: 3 },
    { name: "Diamond Boots", amount: 1, weight: 4 },
  ],

  Legendary: [
    { name: "Knight Sword", amount: 1, weight: 1 },
    { name: "Diamond Sword", amount: 1, weight: 9 },
    { name: "Diamond Mace", amount: 1, weight: 7 },
    { name: "Diamond Dagger", amount: 1, weight: 7 },
    { name: "Diamond Whip", amount: 1, weight: 7 },
    { name: "Diamond Club", amount: 1, weight: 7 },
    { name: "Diamond Bow", amount: 1, weight: 7 },
    { name: "Arrow", min: 5, max: 12, weight: 20 },

    { name: "Diamond Helmet", amount: 1, weight: 4 },
    { name: "Diamond Chestplate", amount: 1, weight: 2 },
    { name: "Diamond Gauntlets", amount: 1, weight: 4 },
    { name: "Diamond Leggings", amount: 1, weight: 3 },
    { name: "Diamond Boots", amount: 1, weight: 4 },  ],
};
