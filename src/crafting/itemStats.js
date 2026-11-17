/**
 * Item display overrides via api.setItemStat(playerId, itemName, stat, value)
 * Per-player renames + descriptions for all custom alloys/armors.
 * Called onPlayerJoin after registerCraftingRecipes.
 * Uses the 32 settable stats (displayName, description confirmed in API notes 22 Sep 2026).
 */

export const ITEM_STAT_OVERRIDES = {
  // ── Tier 1 base materials (already named, but lore added) ──
  "Amethite": { displayName: "Amethite Ingot", description: "Tier 1 crystal ingot. 4 Amethite Fragments → Workbench. Craft Amethite armor." },
  "Magmasteel": { displayName: "Magmasteel Ingot", description: "Tier 1 molten steel. 4 Fragments → Workbench. Craft Magmasteel armor." },
  "Rubellite": { displayName: "Rubellite Gem", description: "Tier 1 blood gem. 4 Fragments → Workbench. Craft Rubellite armor." },
  "Serpentite": { displayName: "Serpentite Scale", description: "Tier 1 serpent scale. 4 Fragments → Workbench. Craft Serpentite armor." },
  "Amethite Fragment": { displayName: "Amethite Fragment", description: "Common shard. Combine 4 → Amethite Ingot at Workbench." },
  "Magmasteel Fragment": { displayName: "Magmasteel Fragment", description: "Common shard. Combine 4 → Magmasteel Ingot at Workbench." },
  "Rubellite Fragment": { displayName: "Rubellite Fragment", description: "Common shard. Combine 4 → Rubellite Gem at Workbench." },
  "Serpentite Fragment": { displayName: "Serpentite Fragment", description: "Uncommon shard. Combine 4 → Serpentite Scale at Workbench." },

  // ── Tier 2 alloys (proxy vanilla items renommés) ──
  "Iron Plate": { displayName: "Cursemetal Ingot", description: "Tier 2 cursed alloy. 2 Rubellite + 2 Serpentite + 1 Iron Bar → Workbench. Craft Cursemetal armor at Artisan Bench." },
  "Gold Plate": { displayName: "Kingly Amethite Ingot", description: "Tier 2 royal alloy. 3 Amethite + 2 Gold Bar + 1 Diamond Fragment → Artisan Bench. Craft Kingly Amethite armor." },
  "Machine Hull": { displayName: "Kingly Diamond Ingot", description: "Tier 2 reinforced core. 2 Diamond + 2 Gold Bar + 2 Amethite Fragment → Artisan Bench. Craft Kingly Diamond armor." },

  // ── Tier 3 alloys ──
  "Steel Bar": { displayName: "Sanguine Alloy", description: "Tier 3 blood-forged alloy. 4 Sanguine Shards + 1 Iron Bar → Artisan Bench. Craft Sanguine armor." },
  "Logic Board": { displayName: "Spectral Essence", description: "Tier 3 ethereal essence. 4 Spectral Shards + 2 Gold Fragments → Artisan Bench. Craft Spectral armor." },
  "Copper Bar": { displayName: "Geo Core", description: "Tier 3 earthen core. 4 Geo Shards + 1 Iron Bar → Artisan Bench. Craft Geo armor." },
  "Sanguine Shard": { displayName: "Sanguine Shard", description: "Tier 3 shard. Found in Uncommon+ crates. → Sanguine Alloy." },
  "Spectral Shard": { displayName: "Spectral Shard", description: "Tier 3 shard. Found in Uncommon+ crates. → Spectral Essence." },
  "Geo Shard": { displayName: "Geo Shard", description: "Tier 3 shard. Found in Rare+ crates. → Geo Core." },
  "Voltite Dust": { displayName: "Voltite Dust", description: "Tier 3-4 dust. Found in Rare+ crates. → Voltplate Core." },

  // ── Tier 4 alloys ──
  "Star Alloy": { displayName: "Astral Essence", description: "Tier 4 cosmic essence. 3 Astral Shards + 2 Comet Shards + 1 Moonstone Dust → Artisan Bench. Craft Astral armor." },
  "Voltite Cell": { displayName: "Voltplate Core", description: "Tier 4 charged core. 3 Voltite Dust + 2 Raw Voltite + 1 Copper Wire → Artisan Bench. Craft Voltplate armor." },
  "Astral Shard": { displayName: "Astral Shard", description: "Tier 4 shard. Found in Epic+ crates. → Astral Essence." },
  "Comet Shard": { displayName: "Comet Shard", description: "Tier 4 comet fragment. Epic+ crates. Used for Astral armor." },
  "Raw Voltite": { displayName: "Raw Voltite", description: "Tier 4 raw voltite. Epic+ crates. Used for Voltplate armor." },
  "Moonstone Dust": { displayName: "Moonstone Dust", description: "Mystical dust. Used for Spectral & Astral crafts." },
  "Comet Core": { displayName: "Comet Core", description: "Rare comet core. Used in endgame crafts." },

  // ── Armors Tier 1 ──
  "Amethite Helmet": { displayName: "Amethite Helmet", description: "Tier 1 helmet. 5 Amethite + 2 Iron Bar. Balanced Tier 1 set." },
  "Amethite Chestplate": { displayName: "Amethite Chestplate", description: "Tier 1 chestplate. 8 Amethite + 3 Iron Bar." },
  "Amethite Leggings": { displayName: "Amethite Leggings", description: "Tier 1 leggings. 7 Amethite + 3 Iron Bar." },
  "Amethite Boots": { displayName: "Amethite Boots", description: "Tier 1 boots. 4 Amethite + 2 Iron Bar." },
  "Amethite Gauntlets": { displayName: "Amethite Gauntlets", description: "Tier 1 gauntlets. 4 Amethite + 2 Iron Bar." },

  "Magmasteel Helmet": { displayName: "Magmasteel Helmet", description: "Tier 1 fire helmet. 5 Magmasteel + 2 Coal." },
  "Magmasteel Chestplate": { displayName: "Magmasteel Chestplate", description: "Tier 1 fire chestplate. 8 Magmasteel + 3 Coal." },
  "Magmasteel Leggings": { displayName: "Magmasteel Leggings", description: "Tier 1 fire leggings. 7 Magmasteel + 3 Coal." },
  "Magmasteel Boots": { displayName: "Magmasteel Boots", description: "Tier 1 fire boots. 4 Magmasteel + 2 Coal." },
  "Magmasteel Gauntlets": { displayName: "Magmasteel Gauntlets", description: "Tier 1 fire gauntlets. 4 Magmasteel + 2 Coal." },

  "Rubellite Helmet": { displayName: "Rubellite Helmet", description: "Tier 1 gem helmet. 5 Rubellite + 2 Gold Fragment." },
  "Rubellite Chestplate": { displayName: "Rubellite Chestplate", description: "Tier 1 gem chestplate. 8 Rubellite + 3 Gold Fragment." },
  "Rubellite Leggings": { displayName: "Rubellite Leggings", description: "Tier 1 gem leggings. 7 Rubellite + 3 Gold Fragment." },
  "Rubellite Boots": { displayName: "Rubellite Boots", description: "Tier 1 gem boots. 4 Rubellite + 2 Gold Fragment." },
  "Rubellite Gauntlets": { displayName: "Rubellite Gauntlets", description: "Tier 1 gem gauntlets. 4 Rubellite + 2 Gold Fragment." },

  "Serpentite Helmet": { displayName: "Serpentite Helmet", description: "Tier 1 scale helmet. 5 Serpentite + 2 Iron Fragment." },
  "Serpentite Chestplate": { displayName: "Serpentite Chestplate", description: "Tier 1 scale chestplate. 8 Serpentite + 3 Iron Fragment." },
  "Serpentite Leggings": { displayName: "Serpentite Leggings", description: "Tier 1 scale leggings. 7 Serpentite + 3 Iron Fragment." },
  "Serpentite Boots": { displayName: "Serpentite Boots", description: "Tier 1 scale boots. 4 Serpentite + 2 Iron Fragment." },
  "Serpentite Gauntlets": { displayName: "Serpentite Gauntlets", description: "Tier 1 scale gauntlets. 4 Serpentite + 2 Iron Fragment." },

  // ── Tier 2 armors ──
  "Cursemetal Helmet": { displayName: "Cursemetal Helmet", description: "Tier 2 cursed helmet. 5 Cursemetal Ingot + 2 Gold Fragment." },
  "Cursemetal Chestplate": { displayName: "Cursemetal Chestplate", description: "Tier 2 cursed chestplate. 8 + 3." },
  "Cursemetal Leggings": { displayName: "Cursemetal Leggings", description: "Tier 2 cursed leggings. 7 + 3." },
  "Cursemetal Boots": { displayName: "Cursemetal Boots", description: "Tier 2 cursed boots. 4 + 2." },
  "Cursemetal Gauntlets": { displayName: "Cursemetal Gauntlets", description: "Tier 2 cursed gauntlets. 4 + 2." },

  "Kingly Amethite Helmet": { displayName: "Kingly Amethite Helmet", description: "Tier 2 royal amethite helmet. 5 Kingly Amethite Ingot + 2 Gold Bar." },
  "Kingly Amethite Chestplate": { displayName: "Kingly Amethite Chestplate", description: "Tier 2 royal chestplate. 8 + 3." },
  "Kingly Amethite Leggings": { displayName: "Kingly Amethite Leggings", description: "Tier 2 royal leggings. 7 + 3." },
  "Kingly Amethite Boots": { displayName: "Kingly Amethite Boots", description: "Tier 2 royal boots. 4 + 2." },
  "Kingly Amethite Gauntlets": { displayName: "Kingly Amethite Gauntlets", description: "Tier 2 royal gauntlets. 4 + 2." },

  "Kingly Diamond Helmet": { displayName: "Kingly Diamond Helmet", description: "Tier 2 diamond sovereign helmet. 5 Kingly Diamond Ingot + 2 Diamond." },
  "Kingly Diamond Chestplate": { displayName: "Kingly Diamond Chestplate", description: "Tier 2 sovereign chestplate. 8 + 3." },
  "Kingly Diamond Leggings": { displayName: "Kingly Diamond Leggings", description: "Tier 2 sovereign leggings. 7 + 3." },
  "Kingly Diamond Boots": { displayName: "Kingly Diamond Boots", description: "Tier 2 sovereign boots. 4 + 2." },
  "Kingly Diamond Gauntlets": { displayName: "Kingly Diamond Gauntlets", description: "Tier 2 sovereign gauntlets. 4 + 2." },

  // ── Tier 3 armors ──
  "Sanguine Helmet": { displayName: "Sanguine Helmet", description: "Tier 3 blood helmet. 5 Sanguine Alloy + 2 Gold Bar." },
  "Sanguine Chestplate": { displayName: "Sanguine Chestplate", description: "Tier 3 blood chestplate. 8 + 3." },
  "Sanguine Leggings": { displayName: "Sanguine Leggings", description: "Tier 3 blood leggings. 7 + 3." },
  "Sanguine Boots": { displayName: "Sanguine Boots", description: "Tier 3 blood boots. 4 + 2." },
  "Sanguine Gauntlets": { displayName: "Sanguine Gauntlets", description: "Tier 3 blood gauntlets. 4 + 2." },

  "Spectral Helmet": { displayName: "Spectral Helmet", description: "Tier 3 spectral helmet. 5 Spectral Essence + 2 Moonstone Dust." },
  "Spectral Chestplate": { displayName: "Spectral Chestplate", description: "Tier 3 spectral chestplate. 8 + 3." },
  "Spectral Leggings": { displayName: "Spectral Leggings", description: "Tier 3 spectral leggings. 7 + 3." },
  "Spectral Boots": { displayName: "Spectral Boots", description: "Tier 3 spectral boots. 4 + 2." },
  "Spectral Gauntlets": { displayName: "Spectral Gauntlets", description: "Tier 3 spectral gauntlets. 4 + 2." },

  "Geo Helmet": { displayName: "Geo Helmet", description: "Tier 3 geo helmet. 5 Geo Core + 2 Iron Bar." },
  "Geo Chestplate": { displayName: "Geo Chestplate", description: "Tier 3 geo chestplate. 8 + 3." },
  "Geo Leggings": { displayName: "Geo Leggings", description: "Tier 3 geo leggings. 7 + 3." },
  "Geo Boots": { displayName: "Geo Boots", description: "Tier 3 geo boots. 4 + 2." },
  "Geo Gauntlets": { displayName: "Geo Gauntlets", description: "Tier 3 geo gauntlets. 4 + 2." },

  // ── Tier 4 armors ──
  "Astral Helmet": { displayName: "Astral Helmet", description: "Tier 4 astral helmet. 5 Astral Essence + 2 Comet Shard." },
  "Astral Chestplate": { displayName: "Astral Chestplate", description: "Tier 4 astral chestplate. 8 + 3." },
  "Astral Leggings": { displayName: "Astral Leggings", description: "Tier 4 astral leggings. 7 + 3." },
  "Astral Boots": { displayName: "Astral Boots", description: "Tier 4 astral boots. 4 + 2." },
  "Astral Gauntlets": { displayName: "Astral Gauntlets", description: "Tier 4 astral gauntlets. 4 + 2." },

  "Voltplate Helmet": { displayName: "Voltplate Helmet", description: "Tier 4 voltplate helmet. 5 Voltplate Core + 2 Copper Wire." },
  "Voltplate Chestplate": { displayName: "Voltplate Chestplate", description: "Tier 4 voltplate chestplate. 8 + 3." },
  "Voltplate Leggings": { displayName: "Voltplate Leggings", description: "Tier 4 voltplate leggings. 7 + 3." },
  "Voltplate Boots": { displayName: "Voltplate Boots", description: "Tier 4 voltplate boots. 4 + 2." },
  "Voltplate Gauntlets": { displayName: "Voltplate Gauntlets", description: "Tier 4 voltplate gauntlets. 4 + 2." },
};

export function applyItemStats(api, playerId) {
  if (!api || !playerId || typeof api.setItemStat !== "function") return 0;
  let ok = 0;
  for (const [itemName, stats] of Object.entries(ITEM_STAT_OVERRIDES)) {
    if (stats.displayName) {
      try { api.setItemStat(playerId, itemName, "displayName", stats.displayName); ok++; } catch (_) {}
    }
    if (stats.description) {
      try { api.setItemStat(playerId, itemName, "description", stats.description); ok++; } catch (_) {}
    }
  }
  return ok;
}
