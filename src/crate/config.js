/**
 * Crate system — config
 * Keys, air chances and loot tables per rarity.
 * Data only, no api.
 * Amount supports either fixed `amount` or `min`/`max` for inclusive random roll.
 *
 * Règle "au minimum leur crate" (2026-11-23) :
 *  - Common (Wooden Key) : bois uniquement — armes/armures bois, Maple, Stick + consommables de base
 *  - Uncommon (Stone Key) : stone + premiers fragments (Amethite/Magmasteel/Rubellite/Serpentite)
 *  - Rare (Iron Key) : fer + fragments Sanguine/Spectral/Geo et + rares
 *  - Epic (Gold Key) : or + fragments Astral/Comet/Voltite/Moonstone + tout ce qui est + rare
 *  - Legendary (Diamond Key) : diamant + Knight Sword + Star Alloy
 *  - Cotton/Arrow/Coal uniquement Common ; Apple/Bread partout
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

export const CRATE_LOCK_MS = 16000;
export const CRATE_CLEAR_DISTANCE = 6;
export const CRATE_TICK_MS = 1000;

export const LOOT_TABLE = {
  // Common — Wood Key : bois, armes/armures bois, bois + basiques
  Common: [
    { name: "Apple", min: 1, max: 5, weight: 55 },
    { name: "Bread", min: 1, max: 4, weight: 40 },
    { name: "Coal", min: 1, max: 8, weight: 35 },
    { name: "Raw Potato", min: 1, max: 6, weight: 40 },

    { name: "Wood Sword", amount: 1, weight: 6 },
    { name: "Wood Mace", amount: 1, weight: 7 },
    { name: "Wood Dagger", amount: 1, weight: 7 },
    { name: "Wood Whip", amount: 1, weight: 7 },
    { name: "Wood Club", amount: 1, weight: 7 },
    { name: "Wood Bow", amount: 1, weight: 7 },
    { name: "Arrow", min: 5, max: 12, weight: 20 },

    { name: "Wood Helmet", amount: 1, weight: 4 },
    { name: "Wood Chestplate", amount: 1, weight: 2 },
    { name: "Wood Gauntlets", amount: 1, weight: 4 },
    { name: "Wood Leggings", amount: 1, weight: 3 },
    { name: "Wood Boots", amount: 1, weight: 4 },

    { name: "Maple Wood Planks", min: 8, max: 16, weight: 40 },
    { name: "Maple Log", min: 4, max: 8, weight: 40 },
    { name: "Stick", min: 6, max: 12, weight: 35 },

    { name: "Cotton", min: 3, max: 6, weight: 35 },
  ],

  // Uncommon — Stone Key : stone, armes pierre, premiers fragments
  Uncommon: [
    { name: "Apple", min: 3, max: 8, weight: 55 },
    { name: "Bread", min: 1, max: 7, weight: 40 },

    { name: "Stone Sword", amount: 1, weight: 9 },
    { name: "Stone Mace", amount: 1, weight: 7 },
    { name: "Stone Dagger", amount: 1, weight: 7 },
    { name: "Stone Whip", amount: 1, weight: 7 },
    { name: "Stone Club", amount: 1, weight: 7 },
    { name: "Stone Bow", amount: 1, weight: 7 },

    // Premiers fragments — Serpentite avec les 3 précédents
    { name: "Amethite Fragment", min: 1, max: 3, weight: 22 },
    { name: "Magmasteel Fragment", min: 1, max: 3, weight: 16 },
    { name: "Rubellite Fragment", min: 1, max: 3, weight: 14 },
    { name: "Serpentite Fragment", min: 1, max: 2, weight: 10 },
  ],

  // Rare — Iron Key : fer, armes/armures fer, fragments et + rares
  Rare: [
    { name: "Apple", min: 3, max: 8, weight: 40 },
    { name: "Bread", min: 1, max: 6, weight: 35 },

    { name: "Iron Bar", min: 3, max: 8, weight: 25 },
    { name: "Iron Fragment", min: 3, max: 10, weight: 35 },

    { name: "Iron Sword", amount: 1, weight: 9 },
    { name: "Iron Mace", amount: 1, weight: 7 },
    { name: "Iron Dagger", amount: 1, weight: 7 },
    { name: "Iron Whip", amount: 1, weight: 7 },
    { name: "Iron Club", amount: 1, weight: 7 },
    { name: "Iron Bow", amount: 1, weight: 7 },

    { name: "Iron Helmet", amount: 1, weight: 4 },
    { name: "Iron Chestplate", amount: 1, weight: 2 },
    { name: "Iron Gauntlets", amount: 1, weight: 4 },
    { name: "Iron Leggings", amount: 1, weight: 3 },
    { name: "Iron Boots", amount: 1, weight: 4 },

    // Fragments — tier Iron et + rares (au minimum Rare)
    { name: "Sanguine Shard", min: 1, max: 2, weight: 10 },
    { name: "Spectral Shard", min: 1, max: 2, weight: 10 },
    { name: "Geo Shard", min: 1, max: 2, weight: 10 },
    { name: "Voltite Dust", min: 1, max: 2, weight: 6 },
    { name: "Moonstone Dust", min: 1, max: 2, weight: 6 },
    { name: "Copper Wire", min: 1, max: 2, weight: 6 },
  ],

  // Epic — Gold Key : or, armes/armures or, fragments + rares
  Epic: [
    { name: "Apple", min: 3, max: 8, weight: 35 },
    { name: "Bread", min: 1, max: 6, weight: 30 },

    { name: "Gold Bar", min: 1, max: 4, weight: 18 },
    { name: "Gold Fragment", min: 1, max: 8, weight: 22 },

    { name: "Gold Sword", amount: 1, weight: 9 },
    { name: "Gold Mace", amount: 1, weight: 7 },
    { name: "Gold Dagger", amount: 1, weight: 7 },
    { name: "Gold Whip", amount: 1, weight: 7 },
    { name: "Gold Club", amount: 1, weight: 7 },
    { name: "Gold Bow", amount: 1, weight: 7 },

    { name: "Gold Helmet", amount: 1, weight: 4 },
    { name: "Gold Chestplate", amount: 1, weight: 2 },
    { name: "Gold Gauntlets", amount: 1, weight: 4 },
    { name: "Gold Leggings", amount: 1, weight: 3 },
    { name: "Gold Boots", amount: 1, weight: 4 },

    { name: "Moonstone", min: 1, max: 2, weight: 8 },
    { name: "Moonstone Dust", min: 1, max: 3, weight: 10 },
    { name: "Copper Wire", min: 1, max: 3, weight: 10 },

    // Shards — tier Epic et + rares
    { name: "Sanguine Shard", min: 1, max: 3, weight: 10 },
    { name: "Spectral Shard", min: 1, max: 3, weight: 10 },
    { name: "Geo Shard", min: 1, max: 3, weight: 10 },
    { name: "Astral Shard", min: 1, max: 2, weight: 8 },
    { name: "Voltite Dust", min: 1, max: 3, weight: 8 },
    { name: "Comet Shard", min: 1, max: 2, weight: 6 },
    { name: "Raw Voltite", min: 1, max: 2, weight: 4 },
  ],

  // Legendary — Diamond Key : diamant, armes diamant, endgame
  Legendary: [
    { name: "Apple", min: 3, max: 8, weight: 30 },
    { name: "Bread", min: 1, max: 6, weight: 25 },

    { name: "Diamond", min: 2, max: 5, weight: 12 },
    { name: "Diamond Fragment", min: 2, max: 4, weight: 10 },

    { name: "Knight Sword", amount: 1, weight: 1 },
    { name: "Diamond Sword", amount: 1, weight: 9 },
    { name: "Diamond Mace", amount: 1, weight: 7 },
    { name: "Diamond Dagger", amount: 1, weight: 7 },
    { name: "Diamond Whip", amount: 1, weight: 7 },
    { name: "Diamond Club", amount: 1, weight: 7 },
    { name: "Diamond Bow", amount: 1, weight: 7 },

    { name: "Diamond Helmet", amount: 1, weight: 4 },
    { name: "Diamond Chestplate", amount: 1, weight: 2 },
    { name: "Diamond Gauntlets", amount: 1, weight: 4 },
    { name: "Diamond Leggings", amount: 1, weight: 3 },
    { name: "Diamond Boots", amount: 1, weight: 4 },

    // Shards — endgame, au minimum Legendary
    { name: "Sanguine Shard", min: 1, max: 3, weight: 8 },
    { name: "Spectral Shard", min: 1, max: 3, weight: 8 },
    { name: "Geo Shard", min: 1, max: 3, weight: 10 },
    { name: "Astral Shard", min: 1, max: 3, weight: 12 },
    { name: "Comet Shard", min: 1, max: 3, weight: 8 },
    { name: "Voltite Dust", min: 1, max: 3, weight: 8 },
    { name: "Raw Voltite", min: 1, max: 2, weight: 6 },
    { name: "Star Alloy", min: 1, max: 2, weight: 4 },
    { name: "Moonstone", min: 1, max: 3, weight: 10 },
    { name: "Moonstone Dust", min: 1, max: 3, weight: 12 },
    { name: "Copper Wire", min: 1, max: 3, weight: 12 },
  ],
};
