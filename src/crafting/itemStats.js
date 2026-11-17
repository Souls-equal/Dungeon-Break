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

  // ── Armes Tier 1 — Amethite (Workbench, scalent avec dealingDamageMultiplier) ──
  "Amethite Sword": { displayName: "Amethite Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35×. Base 36 dmg. 2 Amethite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Amethite Dagger": { displayName: "Amethite Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 18 dmg. 1 Amethite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Amethite Spear": { displayName: "Amethite Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. Base 30 dmg. 1 Amethite + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Amethite Club": { displayName: "Amethite Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. Base 36 dmg. 3 Amethite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Amethite Mace": { displayName: "Amethite Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. Base 20 dmg. 2 Amethite + 1 Stick + 1 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Amethite Whip": { displayName: "Amethite Whip", description: "Tier 1 whip — Whip — pulls enemies to you. Base 16 dmg. 1 Amethite + 1 Cotton → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Amethite Bow": { displayName: "Amethite Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. Base 28 dmg. 3 Amethite + 1 Cotton + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Amethite Crossbow": { displayName: "Amethite Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. Base 34 dmg. 4 Amethite + 1 Cotton + 2 Stick + 2 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Amethite Boomerang": { displayName: "Amethite Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. Base 16 dmg. 2 Amethite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Magmasteel Sword": { displayName: "Magmasteel Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35×. Base 36 dmg. 2 Magmasteel + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Magmasteel Dagger": { displayName: "Magmasteel Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 18 dmg. 1 Magmasteel + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Magmasteel Spear": { displayName: "Magmasteel Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. Base 30 dmg. 1 Magmasteel + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Magmasteel Club": { displayName: "Magmasteel Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. Base 36 dmg. 3 Magmasteel + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Magmasteel Mace": { displayName: "Magmasteel Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. Base 20 dmg. 2 Magmasteel + 1 Stick + 1 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Magmasteel Whip": { displayName: "Magmasteel Whip", description: "Tier 1 whip — Whip — pulls enemies to you. Base 16 dmg. 1 Magmasteel + 1 Cotton → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Magmasteel Bow": { displayName: "Magmasteel Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. Base 28 dmg. 3 Magmasteel + 1 Cotton + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Magmasteel Crossbow": { displayName: "Magmasteel Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. Base 34 dmg. 4 Magmasteel + 1 Cotton + 2 Stick + 2 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Magmasteel Boomerang": { displayName: "Magmasteel Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. Base 16 dmg. 2 Magmasteel + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Rubellite Sword": { displayName: "Rubellite Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35×. Base 37 dmg. 2 Rubellite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Rubellite Dagger": { displayName: "Rubellite Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 19 dmg. 1 Rubellite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Rubellite Spear": { displayName: "Rubellite Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. Base 31 dmg. 1 Rubellite + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Rubellite Club": { displayName: "Rubellite Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. Base 37 dmg. 3 Rubellite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Rubellite Mace": { displayName: "Rubellite Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. Base 21 dmg. 2 Rubellite + 1 Stick + 1 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Rubellite Whip": { displayName: "Rubellite Whip", description: "Tier 1 whip — Whip — pulls enemies to you. Base 17 dmg. 1 Rubellite + 1 Cotton → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Rubellite Bow": { displayName: "Rubellite Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. Base 29 dmg. 3 Rubellite + 1 Cotton + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Rubellite Crossbow": { displayName: "Rubellite Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. Base 35 dmg. 4 Rubellite + 1 Cotton + 2 Stick + 2 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Rubellite Boomerang": { displayName: "Rubellite Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. Base 17 dmg. 2 Rubellite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Serpentite Sword": { displayName: "Serpentite Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35×. Base 38 dmg. 2 Serpentite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Serpentite Dagger": { displayName: "Serpentite Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 19 dmg. 1 Serpentite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Serpentite Spear": { displayName: "Serpentite Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. Base 32 dmg. 1 Serpentite + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Serpentite Club": { displayName: "Serpentite Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. Base 38 dmg. 3 Serpentite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Serpentite Mace": { displayName: "Serpentite Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. Base 22 dmg. 2 Serpentite + 1 Stick + 1 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Serpentite Whip": { displayName: "Serpentite Whip", description: "Tier 1 whip — Whip — pulls enemies to you. Base 17 dmg. 1 Serpentite + 1 Cotton → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Serpentite Bow": { displayName: "Serpentite Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. Base 30 dmg. 3 Serpentite + 1 Cotton + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Serpentite Crossbow": { displayName: "Serpentite Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. Base 36 dmg. 4 Serpentite + 1 Cotton + 2 Stick + 2 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  "Serpentite Boomerang": { displayName: "Serpentite Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. Base 17 dmg. 2 Serpentite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings)." },
  // ── Armes Tier 3 — Sanguine / Spectral / Geo (Artisan Bench) ──
  "Sanguine Sword": { displayName: "Sanguine Sword", description: "Tier 3 sword — Balanced blade — high damage, crit 1.35×. Base 42 dmg. 2 Steel Bar + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Sanguine Dagger": { displayName: "Sanguine Dagger", description: "Tier 3 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 22 dmg. 1 Steel Bar + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Sanguine Spear": { displayName: "Sanguine Spear", description: "Tier 3 spear — Dash spear — lunges 7 blocks on hit. Base 35 dmg. 1 Steel Bar + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Sanguine Club": { displayName: "Sanguine Club", description: "Tier 3 club — Heavy club — sword damage + massive knockback. Base 42 dmg. 3 Steel Bar + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Sanguine Mace": { displayName: "Sanguine Mace", description: "Tier 3 mace — Crushing mace — damage scales with fall/speed. Base 24 dmg. 2 Steel Bar + 1 Stick + 1 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Sanguine Whip": { displayName: "Sanguine Whip", description: "Tier 3 whip — Whip — pulls enemies to you. Base 20 dmg. 1 Steel Bar + 1 Cotton → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Sanguine Bow": { displayName: "Sanguine Bow", description: "Tier 3 bow — Chargeable bow — hold to charge, scales with draw. Base 34 dmg. 3 Steel Bar + 1 Cotton + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Sanguine Crossbow": { displayName: "Sanguine Crossbow", description: "Tier 3 crossbow — Crossbow — slower, higher burst. Base 40 dmg. 4 Steel Bar + 1 Cotton + 2 Stick + 2 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Sanguine Staff": { displayName: "Sanguine Staff", description: "Tier 3 staff — Magic staff — channels elemental power, benefits from blessings. Base 38 dmg. 2 Steel Bar + 2 Stick + 1 Gold Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Spectral Sword": { displayName: "Spectral Sword", description: "Tier 3 sword — Balanced blade — high damage, crit 1.35×. Base 44 dmg. 2 Logic Board + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Spectral Dagger": { displayName: "Spectral Dagger", description: "Tier 3 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 23 dmg. 1 Logic Board + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Spectral Spear": { displayName: "Spectral Spear", description: "Tier 3 spear — Dash spear — lunges 7 blocks on hit. Base 36 dmg. 1 Logic Board + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Spectral Club": { displayName: "Spectral Club", description: "Tier 3 club — Heavy club — sword damage + massive knockback. Base 44 dmg. 3 Logic Board + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Spectral Mace": { displayName: "Spectral Mace", description: "Tier 3 mace — Crushing mace — damage scales with fall/speed. Base 25 dmg. 2 Logic Board + 1 Stick + 1 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Spectral Whip": { displayName: "Spectral Whip", description: "Tier 3 whip — Whip — pulls enemies to you. Base 21 dmg. 1 Logic Board + 1 Cotton → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Spectral Bow": { displayName: "Spectral Bow", description: "Tier 3 bow — Chargeable bow — hold to charge, scales with draw. Base 36 dmg. 3 Logic Board + 1 Cotton + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Spectral Crossbow": { displayName: "Spectral Crossbow", description: "Tier 3 crossbow — Crossbow — slower, higher burst. Base 42 dmg. 4 Logic Board + 1 Cotton + 2 Stick + 2 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Spectral Staff": { displayName: "Spectral Staff", description: "Tier 3 staff — Magic staff — channels elemental power, benefits from blessings. Base 40 dmg. 2 Logic Board + 2 Stick + 1 Moonstone Dust → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Geo Sword": { displayName: "Geo Sword", description: "Tier 3 sword — Balanced blade — high damage, crit 1.35×. Base 45 dmg. 2 Copper Bar + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Geo Dagger": { displayName: "Geo Dagger", description: "Tier 3 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 23 dmg. 1 Copper Bar + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Geo Spear": { displayName: "Geo Spear", description: "Tier 3 spear — Dash spear — lunges 7 blocks on hit. Base 38 dmg. 1 Copper Bar + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Geo Club": { displayName: "Geo Club", description: "Tier 3 club — Heavy club — sword damage + massive knockback. Base 45 dmg. 3 Copper Bar + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Geo Mace": { displayName: "Geo Mace", description: "Tier 3 mace — Crushing mace — damage scales with fall/speed. Base 26 dmg. 2 Copper Bar + 1 Stick + 1 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Geo Whip": { displayName: "Geo Whip", description: "Tier 3 whip — Whip — pulls enemies to you. Base 22 dmg. 1 Copper Bar + 1 Cotton → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Geo Bow": { displayName: "Geo Bow", description: "Tier 3 bow — Chargeable bow — hold to charge, scales with draw. Base 37 dmg. 3 Copper Bar + 1 Cotton + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Geo Crossbow": { displayName: "Geo Crossbow", description: "Tier 3 crossbow — Crossbow — slower, higher burst. Base 44 dmg. 4 Copper Bar + 1 Cotton + 2 Stick + 2 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Geo Staff": { displayName: "Geo Staff", description: "Tier 3 staff — Magic staff — channels elemental power, benefits from blessings. Base 41 dmg. 2 Copper Bar + 2 Stick + 1 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  // ── Armes Tier 4 — Astral (Artisan Bench) ──
  "Astral Sword": { displayName: "Astral Sword", description: "Tier 4 sword — Balanced blade — high damage, crit 1.35×. Base 50 dmg. 2 Star Alloy + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Astral Dagger": { displayName: "Astral Dagger", description: "Tier 4 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 26 dmg. 1 Star Alloy + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Astral Spear": { displayName: "Astral Spear", description: "Tier 4 spear — Dash spear — lunges 7 blocks on hit. Base 42 dmg. 1 Star Alloy + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Astral Club": { displayName: "Astral Club", description: "Tier 4 club — Heavy club — sword damage + massive knockback. Base 50 dmg. 3 Star Alloy + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Astral Mace": { displayName: "Astral Mace", description: "Tier 4 mace — Crushing mace — damage scales with fall/speed. Base 28 dmg. 2 Star Alloy + 1 Stick + 1 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Astral Whip": { displayName: "Astral Whip", description: "Tier 4 whip — Whip — pulls enemies to you. Base 24 dmg. 1 Star Alloy + 1 Cotton → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Astral Bow": { displayName: "Astral Bow", description: "Tier 4 bow — Chargeable bow — hold to charge, scales with draw. Base 40 dmg. 3 Star Alloy + 1 Cotton + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Astral Crossbow": { displayName: "Astral Crossbow", description: "Tier 4 crossbow — Crossbow — slower, higher burst. Base 48 dmg. 4 Star Alloy + 1 Cotton + 2 Stick + 2 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
  "Astral Staff": { displayName: "Astral Staff", description: "Tier 4 staff — Magic staff — channels elemental power, benefits from blessings. Base 45 dmg. 2 Star Alloy + 2 Stick + 1 Comet Shard → Artisan Bench. Scales with dealingDamageMultiplier (Blessings)." },
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
