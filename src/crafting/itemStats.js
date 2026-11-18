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
  "Amethite Helmet": { displayName: "Amethite Helmet", description: "Tier 1 helmet. 5 Amethite + 2 Iron Bar. Balanced Tier 1 set. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Amethite Chestplate": { displayName: "Amethite Chestplate", description: "Tier 1 chestplate. 8 Amethite + 3 Iron Bar. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Amethite Leggings": { displayName: "Amethite Leggings", description: "Tier 1 leggings. 7 Amethite + 3 Iron Bar. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Amethite Boots": { displayName: "Amethite Boots", description: "Tier 1 boots. 4 Amethite + 2 Iron Bar. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Amethite Gauntlets": { displayName: "Amethite Gauntlets", description: "Tier 1 gauntlets. 4 Amethite + 2 Iron Bar. FX: Guard every 5 hits (shield dome) + faint shimmer." },

  "Magmasteel Helmet": { displayName: "Magmasteel Helmet", description: "Tier 1 fire helmet. 5 Magmasteel + 2 Coal. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Magmasteel Chestplate": { displayName: "Magmasteel Chestplate", description: "Tier 1 fire chestplate. 8 Magmasteel + 3 Coal. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Magmasteel Leggings": { displayName: "Magmasteel Leggings", description: "Tier 1 fire leggings. 7 Magmasteel + 3 Coal. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Magmasteel Boots": { displayName: "Magmasteel Boots", description: "Tier 1 fire boots. 4 Magmasteel + 2 Coal. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Magmasteel Gauntlets": { displayName: "Magmasteel Gauntlets", description: "Tier 1 fire gauntlets. 4 Magmasteel + 2 Coal. FX: Guard every 5 hits (shield dome) + faint shimmer." },

  "Rubellite Helmet": { displayName: "Rubellite Helmet", description: "Tier 1 gem helmet. 5 Rubellite + 2 Gold Fragment. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Rubellite Chestplate": { displayName: "Rubellite Chestplate", description: "Tier 1 gem chestplate. 8 Rubellite + 3 Gold Fragment. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Rubellite Leggings": { displayName: "Rubellite Leggings", description: "Tier 1 gem leggings. 7 Rubellite + 3 Gold Fragment. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Rubellite Boots": { displayName: "Rubellite Boots", description: "Tier 1 gem boots. 4 Rubellite + 2 Gold Fragment. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Rubellite Gauntlets": { displayName: "Rubellite Gauntlets", description: "Tier 1 gem gauntlets. 4 Rubellite + 2 Gold Fragment. FX: Guard every 5 hits (shield dome) + faint shimmer." },

  "Serpentite Helmet": { displayName: "Serpentite Helmet", description: "Tier 1 scale helmet. 5 Serpentite + 2 Iron Fragment. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Serpentite Chestplate": { displayName: "Serpentite Chestplate", description: "Tier 1 scale chestplate. 8 Serpentite + 3 Iron Fragment. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Serpentite Leggings": { displayName: "Serpentite Leggings", description: "Tier 1 scale leggings. 7 Serpentite + 3 Iron Fragment. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Serpentite Boots": { displayName: "Serpentite Boots", description: "Tier 1 scale boots. 4 Serpentite + 2 Iron Fragment. FX: Guard every 5 hits (shield dome) + faint shimmer." },
  "Serpentite Gauntlets": { displayName: "Serpentite Gauntlets", description: "Tier 1 scale gauntlets. 4 Serpentite + 2 Iron Fragment. FX: Guard every 5 hits (shield dome) + faint shimmer." },

  // ── Tier 2 armors ──
  "Cursemetal Helmet": { displayName: "Cursemetal Helmet", description: "Tier 2 cursed helmet. 5 Cursemetal Ingot + 2 Gold Fragment. FX: Guard every 4 hits (shield dome) + shimmer." },
  "Cursemetal Chestplate": { displayName: "Cursemetal Chestplate", description: "Tier 2 cursed chestplate. 8 + 3. FX: Guard every 4 hits (shield dome) + shimmer." },
  "Cursemetal Leggings": { displayName: "Cursemetal Leggings", description: "Tier 2 cursed leggings. 7 + 3. FX: Guard every 4 hits (shield dome) + shimmer." },
  "Cursemetal Boots": { displayName: "Cursemetal Boots", description: "Tier 2 cursed boots. 4 + 2. FX: Guard every 4 hits (shield dome) + shimmer." },
  "Cursemetal Gauntlets": { displayName: "Cursemetal Gauntlets", description: "Tier 2 cursed gauntlets. 4 + 2. FX: Guard every 4 hits (shield dome) + shimmer." },

  "Kingly Amethite Helmet": { displayName: "Kingly Amethite Helmet", description: "Tier 2 royal amethite helmet. 5 Kingly Amethite Ingot + 2 Gold Bar. FX: Guard every 4 hits (shield dome) + shimmer." },
  "Kingly Amethite Chestplate": { displayName: "Kingly Amethite Chestplate", description: "Tier 2 royal chestplate. 8 + 3. FX: Guard every 4 hits (shield dome) + shimmer." },
  "Kingly Amethite Leggings": { displayName: "Kingly Amethite Leggings", description: "Tier 2 royal leggings. 7 + 3. FX: Guard every 4 hits (shield dome) + shimmer." },
  "Kingly Amethite Boots": { displayName: "Kingly Amethite Boots", description: "Tier 2 royal boots. 4 + 2. FX: Guard every 4 hits (shield dome) + shimmer." },
  "Kingly Amethite Gauntlets": { displayName: "Kingly Amethite Gauntlets", description: "Tier 2 royal gauntlets. 4 + 2. FX: Guard every 4 hits (shield dome) + shimmer." },

  "Kingly Diamond Helmet": { displayName: "Kingly Diamond Helmet", description: "Tier 2 diamond sovereign helmet. 5 Kingly Diamond Ingot + 2 Diamond. FX: Guard every 4 hits (shield dome) + shimmer." },
  "Kingly Diamond Chestplate": { displayName: "Kingly Diamond Chestplate", description: "Tier 2 sovereign chestplate. 8 + 3. FX: Guard every 4 hits (shield dome) + shimmer." },
  "Kingly Diamond Leggings": { displayName: "Kingly Diamond Leggings", description: "Tier 2 sovereign leggings. 7 + 3. FX: Guard every 4 hits (shield dome) + shimmer." },
  "Kingly Diamond Boots": { displayName: "Kingly Diamond Boots", description: "Tier 2 sovereign boots. 4 + 2. FX: Guard every 4 hits (shield dome) + shimmer." },
  "Kingly Diamond Gauntlets": { displayName: "Kingly Diamond Gauntlets", description: "Tier 2 sovereign gauntlets. 4 + 2. FX: Guard every 4 hits (shield dome) + shimmer." },

  // ── Tier 3 armors ──
  "Sanguine Helmet": { displayName: "Sanguine Helmet", description: "Tier 3 blood helmet. 5 Sanguine Alloy + 2 Gold Bar. FX: Guard every 3 hits (shield dome) + shimmer." },
  "Sanguine Chestplate": { displayName: "Sanguine Chestplate", description: "Tier 3 blood chestplate. 8 + 3. FX: Guard every 3 hits (shield dome) + shimmer." },
  "Sanguine Leggings": { displayName: "Sanguine Leggings", description: "Tier 3 blood leggings. 7 + 3. FX: Guard every 3 hits (shield dome) + shimmer." },
  "Sanguine Boots": { displayName: "Sanguine Boots", description: "Tier 3 blood boots. 4 + 2. FX: Guard every 3 hits (shield dome) + shimmer." },
  "Sanguine Gauntlets": { displayName: "Sanguine Gauntlets", description: "Tier 3 blood gauntlets. 4 + 2. FX: Guard every 3 hits (shield dome) + shimmer." },

  "Spectral Helmet": { displayName: "Spectral Helmet", description: "Tier 3 spectral helmet. 5 Spectral Essence + 2 Moonstone Dust. FX: Guard every 3 hits (shield dome) + shimmer." },
  "Spectral Chestplate": { displayName: "Spectral Chestplate", description: "Tier 3 spectral chestplate. 8 + 3. FX: Guard every 3 hits (shield dome) + shimmer." },
  "Spectral Leggings": { displayName: "Spectral Leggings", description: "Tier 3 spectral leggings. 7 + 3. FX: Guard every 3 hits (shield dome) + shimmer." },
  "Spectral Boots": { displayName: "Spectral Boots", description: "Tier 3 spectral boots. 4 + 2. FX: Guard every 3 hits (shield dome) + shimmer." },
  "Spectral Gauntlets": { displayName: "Spectral Gauntlets", description: "Tier 3 spectral gauntlets. 4 + 2. FX: Guard every 3 hits (shield dome) + shimmer." },

  "Geo Helmet": { displayName: "Geo Helmet", description: "Tier 3 geo helmet. 5 Geo Core + 2 Iron Bar. FX: Guard every 3 hits (shield dome) + shimmer." },
  "Geo Chestplate": { displayName: "Geo Chestplate", description: "Tier 3 geo chestplate. 8 + 3. FX: Guard every 3 hits (shield dome) + shimmer." },
  "Geo Leggings": { displayName: "Geo Leggings", description: "Tier 3 geo leggings. 7 + 3. FX: Guard every 3 hits (shield dome) + shimmer." },
  "Geo Boots": { displayName: "Geo Boots", description: "Tier 3 geo boots. 4 + 2. FX: Guard every 3 hits (shield dome) + shimmer." },
  "Geo Gauntlets": { displayName: "Geo Gauntlets", description: "Tier 3 geo gauntlets. 4 + 2. FX: Guard every 3 hits (shield dome) + shimmer." },

  // ── Tier 4 armors ──
  "Astral Helmet": { displayName: "Astral Helmet", description: "Tier 4 astral helmet. 5 Astral Essence + 2 Comet Shard. FX: Guard every 2 hits (shield dome) + bright aura." },
  "Astral Chestplate": { displayName: "Astral Chestplate", description: "Tier 4 astral chestplate. 8 + 3. FX: Guard every 2 hits (shield dome) + bright aura." },
  "Astral Leggings": { displayName: "Astral Leggings", description: "Tier 4 astral leggings. 7 + 3. FX: Guard every 2 hits (shield dome) + bright aura." },
  "Astral Boots": { displayName: "Astral Boots", description: "Tier 4 astral boots. 4 + 2. FX: Guard every 2 hits (shield dome) + bright aura." },
  "Astral Gauntlets": { displayName: "Astral Gauntlets", description: "Tier 4 astral gauntlets. 4 + 2. FX: Guard every 2 hits (shield dome) + bright aura." },

  "Voltplate Helmet": { displayName: "Voltplate Helmet", description: "Tier 4 voltplate helmet. 5 Voltplate Core + 2 Copper Wire. FX: Guard every 2 hits (shield dome) + bright aura." },
  "Voltplate Chestplate": { displayName: "Voltplate Chestplate", description: "Tier 4 voltplate chestplate. 8 + 3. FX: Guard every 2 hits (shield dome) + bright aura." },
  "Voltplate Leggings": { displayName: "Voltplate Leggings", description: "Tier 4 voltplate leggings. 7 + 3. FX: Guard every 2 hits (shield dome) + bright aura." },
  "Voltplate Boots": { displayName: "Voltplate Boots", description: "Tier 4 voltplate boots. 4 + 2. FX: Guard every 2 hits (shield dome) + bright aura." },
  "Voltplate Gauntlets": { displayName: "Voltplate Gauntlets", description: "Tier 4 voltplate gauntlets. 4 + 2. FX: Guard every 2 hits (shield dome) + bright aura." },

  // ── Armes Tier 1 — Amethite (Workbench, scalent avec dealingDamageMultiplier) ──
  "Amethite Sword": { displayName: "Amethite Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35×. Base 36 dmg. 2 Amethite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Slash every 3 hits (colored arc) + hit spark." },
  "Amethite Dagger": { displayName: "Amethite Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 18 dmg. 1 Amethite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Fury every 2 hits (twin spark) + hit spark." },
  "Amethite Spear": { displayName: "Amethite Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. Base 30 dmg. 1 Amethite + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Thrust every 3 hits (piercing line) + hit spark." },
  "Amethite Club": { displayName: "Amethite Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. Base 36 dmg. 3 Amethite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Shockwave every 4 hits (ground ring) + hit spark." },
  "Amethite Mace": { displayName: "Amethite Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. Base 20 dmg. 2 Amethite + 1 Stick + 1 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Crush every 3 hits (flame smash) + hit spark." },
  "Amethite Whip": { displayName: "Amethite Whip", description: "Tier 1 whip — Whip — pulls enemies to you. Base 16 dmg. 1 Amethite + 1 Cotton → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Lash every 2 hits (curved trail) + hit spark." },
  "Amethite Bow": { displayName: "Amethite Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. Base 28 dmg. 3 Amethite + 1 Cotton + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Arrow trail every hit (light streak)." },
  "Amethite Crossbow": { displayName: "Amethite Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. Base 34 dmg. 4 Amethite + 1 Cotton + 2 Stick + 2 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Bolt burst every hit (star burst)." },
  "Amethite Boomerang": { displayName: "Amethite Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. Base 16 dmg. 2 Amethite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Spin ring every hit (orbiting ring)." },
  "Magmasteel Sword": { displayName: "Magmasteel Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35×. Base 36 dmg. 2 Magmasteel + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Slash every 3 hits (colored arc) + hit spark." },
  "Magmasteel Dagger": { displayName: "Magmasteel Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 18 dmg. 1 Magmasteel + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Fury every 2 hits (twin spark) + hit spark." },
  "Magmasteel Spear": { displayName: "Magmasteel Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. Base 30 dmg. 1 Magmasteel + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Thrust every 3 hits (piercing line) + hit spark." },
  "Magmasteel Club": { displayName: "Magmasteel Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. Base 36 dmg. 3 Magmasteel + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Shockwave every 4 hits (ground ring) + hit spark." },
  "Magmasteel Mace": { displayName: "Magmasteel Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. Base 20 dmg. 2 Magmasteel + 1 Stick + 1 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Crush every 3 hits (flame smash) + hit spark." },
  "Magmasteel Whip": { displayName: "Magmasteel Whip", description: "Tier 1 whip — Whip — pulls enemies to you. Base 16 dmg. 1 Magmasteel + 1 Cotton → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Lash every 2 hits (curved trail) + hit spark." },
  "Magmasteel Bow": { displayName: "Magmasteel Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. Base 28 dmg. 3 Magmasteel + 1 Cotton + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Arrow trail every hit (light streak)." },
  "Magmasteel Crossbow": { displayName: "Magmasteel Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. Base 34 dmg. 4 Magmasteel + 1 Cotton + 2 Stick + 2 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Bolt burst every hit (star burst)." },
  "Magmasteel Boomerang": { displayName: "Magmasteel Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. Base 16 dmg. 2 Magmasteel + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Spin ring every hit (orbiting ring)." },
  "Rubellite Sword": { displayName: "Rubellite Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35×. Base 37 dmg. 2 Rubellite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Slash every 3 hits (colored arc) + hit spark." },
  "Rubellite Dagger": { displayName: "Rubellite Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 19 dmg. 1 Rubellite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Fury every 2 hits (twin spark) + hit spark." },
  "Rubellite Spear": { displayName: "Rubellite Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. Base 31 dmg. 1 Rubellite + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Thrust every 3 hits (piercing line) + hit spark." },
  "Rubellite Club": { displayName: "Rubellite Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. Base 37 dmg. 3 Rubellite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Shockwave every 4 hits (ground ring) + hit spark." },
  "Rubellite Mace": { displayName: "Rubellite Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. Base 21 dmg. 2 Rubellite + 1 Stick + 1 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Crush every 3 hits (flame smash) + hit spark." },
  "Rubellite Whip": { displayName: "Rubellite Whip", description: "Tier 1 whip — Whip — pulls enemies to you. Base 17 dmg. 1 Rubellite + 1 Cotton → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Lash every 2 hits (curved trail) + hit spark." },
  "Rubellite Bow": { displayName: "Rubellite Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. Base 29 dmg. 3 Rubellite + 1 Cotton + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Arrow trail every hit (light streak)." },
  "Rubellite Crossbow": { displayName: "Rubellite Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. Base 35 dmg. 4 Rubellite + 1 Cotton + 2 Stick + 2 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Bolt burst every hit (star burst)." },
  "Rubellite Boomerang": { displayName: "Rubellite Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. Base 17 dmg. 2 Rubellite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Spin ring every hit (orbiting ring)." },
  "Serpentite Sword": { displayName: "Serpentite Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35×. Base 38 dmg. 2 Serpentite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Slash every 3 hits (colored arc) + hit spark." },
  "Serpentite Dagger": { displayName: "Serpentite Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 19 dmg. 1 Serpentite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Fury every 2 hits (twin spark) + hit spark." },
  "Serpentite Spear": { displayName: "Serpentite Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. Base 32 dmg. 1 Serpentite + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Thrust every 3 hits (piercing line) + hit spark." },
  "Serpentite Club": { displayName: "Serpentite Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. Base 38 dmg. 3 Serpentite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Shockwave every 4 hits (ground ring) + hit spark." },
  "Serpentite Mace": { displayName: "Serpentite Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. Base 22 dmg. 2 Serpentite + 1 Stick + 1 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Crush every 3 hits (flame smash) + hit spark." },
  "Serpentite Whip": { displayName: "Serpentite Whip", description: "Tier 1 whip — Whip — pulls enemies to you. Base 17 dmg. 1 Serpentite + 1 Cotton → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Lash every 2 hits (curved trail) + hit spark." },
  "Serpentite Bow": { displayName: "Serpentite Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. Base 30 dmg. 3 Serpentite + 1 Cotton + 2 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Arrow trail every hit (light streak)." },
  "Serpentite Crossbow": { displayName: "Serpentite Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. Base 36 dmg. 4 Serpentite + 1 Cotton + 2 Stick + 2 Iron Bar → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Bolt burst every hit (star burst)." },
  "Serpentite Boomerang": { displayName: "Serpentite Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. Base 17 dmg. 2 Serpentite + 1 Stick → Workbench. Scales with dealingDamageMultiplier (Blessings). FX: Spin ring every hit (orbiting ring)." },
  // ── Armes Tier 3 — Sanguine / Spectral / Geo (Artisan Bench) ──
  "Sanguine Sword": { displayName: "Sanguine Sword", description: "Tier 3 sword — Balanced blade — high damage, crit 1.35×. Base 42 dmg. 2 Steel Bar + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Slash every 3 hits (colored arc) + hit spark." },
  "Sanguine Dagger": { displayName: "Sanguine Dagger", description: "Tier 3 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 22 dmg. 1 Steel Bar + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Fury every 2 hits (twin spark) + hit spark." },
  "Sanguine Spear": { displayName: "Sanguine Spear", description: "Tier 3 spear — Dash spear — lunges 7 blocks on hit. Base 35 dmg. 1 Steel Bar + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Thrust every 3 hits (piercing line) + hit spark." },
  "Sanguine Club": { displayName: "Sanguine Club", description: "Tier 3 club — Heavy club — sword damage + massive knockback. Base 42 dmg. 3 Steel Bar + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Shockwave every 4 hits (ground ring) + hit spark." },
  "Sanguine Mace": { displayName: "Sanguine Mace", description: "Tier 3 mace — Crushing mace — damage scales with fall/speed. Base 24 dmg. 2 Steel Bar + 1 Stick + 1 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Crush every 3 hits (flame smash) + hit spark." },
  "Sanguine Whip": { displayName: "Sanguine Whip", description: "Tier 3 whip — Whip — pulls enemies to you. Base 20 dmg. 1 Steel Bar + 1 Cotton → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Lash every 2 hits (curved trail) + hit spark." },
  "Sanguine Bow": { displayName: "Sanguine Bow", description: "Tier 3 bow — Chargeable bow — hold to charge, scales with draw. Base 34 dmg. 3 Steel Bar + 1 Cotton + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Arrow trail every hit (light streak)." },
  "Sanguine Crossbow": { displayName: "Sanguine Crossbow", description: "Tier 3 crossbow — Crossbow — slower, higher burst. Base 40 dmg. 4 Steel Bar + 1 Cotton + 2 Stick + 2 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Bolt burst every hit (star burst)." },
  "Sanguine Staff": { displayName: "Sanguine Staff", description: "Tier 3 staff — Magic staff — channels elemental power, benefits from blessings. Base 38 dmg. 2 Steel Bar + 2 Stick + 1 Gold Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Arcane vortex every 2 hits (magic vortex) + hit spark." },
  "Spectral Sword": { displayName: "Spectral Sword", description: "Tier 3 sword — Balanced blade — high damage, crit 1.35×. Base 44 dmg. 2 Logic Board + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Slash every 3 hits (colored arc) + hit spark." },
  "Spectral Dagger": { displayName: "Spectral Dagger", description: "Tier 3 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 23 dmg. 1 Logic Board + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Fury every 2 hits (twin spark) + hit spark." },
  "Spectral Spear": { displayName: "Spectral Spear", description: "Tier 3 spear — Dash spear — lunges 7 blocks on hit. Base 36 dmg. 1 Logic Board + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Thrust every 3 hits (piercing line) + hit spark." },
  "Spectral Club": { displayName: "Spectral Club", description: "Tier 3 club — Heavy club — sword damage + massive knockback. Base 44 dmg. 3 Logic Board + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Shockwave every 4 hits (ground ring) + hit spark." },
  "Spectral Mace": { displayName: "Spectral Mace", description: "Tier 3 mace — Crushing mace — damage scales with fall/speed. Base 25 dmg. 2 Logic Board + 1 Stick + 1 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Crush every 3 hits (flame smash) + hit spark." },
  "Spectral Whip": { displayName: "Spectral Whip", description: "Tier 3 whip — Whip — pulls enemies to you. Base 21 dmg. 1 Logic Board + 1 Cotton → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Lash every 2 hits (curved trail) + hit spark." },
  "Spectral Bow": { displayName: "Spectral Bow", description: "Tier 3 bow — Chargeable bow — hold to charge, scales with draw. Base 36 dmg. 3 Logic Board + 1 Cotton + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Arrow trail every hit (light streak)." },
  "Spectral Crossbow": { displayName: "Spectral Crossbow", description: "Tier 3 crossbow — Crossbow — slower, higher burst. Base 42 dmg. 4 Logic Board + 1 Cotton + 2 Stick + 2 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Bolt burst every hit (star burst)." },
  "Spectral Staff": { displayName: "Spectral Staff", description: "Tier 3 staff — Magic staff — channels elemental power, benefits from blessings. Base 40 dmg. 2 Logic Board + 2 Stick + 1 Moonstone Dust → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Arcane vortex every 2 hits (magic vortex) + hit spark." },
  "Geo Sword": { displayName: "Geo Sword", description: "Tier 3 sword — Balanced blade — high damage, crit 1.35×. Base 45 dmg. 2 Copper Bar + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Slash every 3 hits (colored arc) + hit spark." },
  "Geo Dagger": { displayName: "Geo Dagger", description: "Tier 3 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 23 dmg. 1 Copper Bar + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Fury every 2 hits (twin spark) + hit spark." },
  "Geo Spear": { displayName: "Geo Spear", description: "Tier 3 spear — Dash spear — lunges 7 blocks on hit. Base 38 dmg. 1 Copper Bar + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Thrust every 3 hits (piercing line) + hit spark." },
  "Geo Club": { displayName: "Geo Club", description: "Tier 3 club — Heavy club — sword damage + massive knockback. Base 45 dmg. 3 Copper Bar + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Shockwave every 4 hits (ground ring) + hit spark." },
  "Geo Mace": { displayName: "Geo Mace", description: "Tier 3 mace — Crushing mace — damage scales with fall/speed. Base 26 dmg. 2 Copper Bar + 1 Stick + 1 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Crush every 3 hits (flame smash) + hit spark." },
  "Geo Whip": { displayName: "Geo Whip", description: "Tier 3 whip — Whip — pulls enemies to you. Base 22 dmg. 1 Copper Bar + 1 Cotton → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Lash every 2 hits (curved trail) + hit spark." },
  "Geo Bow": { displayName: "Geo Bow", description: "Tier 3 bow — Chargeable bow — hold to charge, scales with draw. Base 37 dmg. 3 Copper Bar + 1 Cotton + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Arrow trail every hit (light streak)." },
  "Geo Crossbow": { displayName: "Geo Crossbow", description: "Tier 3 crossbow — Crossbow — slower, higher burst. Base 44 dmg. 4 Copper Bar + 1 Cotton + 2 Stick + 2 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Bolt burst every hit (star burst)." },
  "Geo Staff": { displayName: "Geo Staff", description: "Tier 3 staff — Magic staff — channels elemental power, benefits from blessings. Base 41 dmg. 2 Copper Bar + 2 Stick + 1 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Arcane vortex every 2 hits (magic vortex) + hit spark." },
  // ── Armes Tier 4 — Astral (Artisan Bench) ──
  "Astral Sword": { displayName: "Astral Sword", description: "Tier 4 sword — Balanced blade — high damage, crit 1.35×. Base 50 dmg. 2 Star Alloy + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Slash every 3 hits (colored arc) + hit spark." },
  "Astral Dagger": { displayName: "Astral Dagger", description: "Tier 4 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 26 dmg. 1 Star Alloy + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Fury every 2 hits (twin spark) + hit spark." },
  "Astral Spear": { displayName: "Astral Spear", description: "Tier 4 spear — Dash spear — lunges 7 blocks on hit. Base 42 dmg. 1 Star Alloy + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Thrust every 3 hits (piercing line) + hit spark." },
  "Astral Club": { displayName: "Astral Club", description: "Tier 4 club — Heavy club — sword damage + massive knockback. Base 50 dmg. 3 Star Alloy + 1 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Shockwave every 4 hits (ground ring) + hit spark." },
  "Astral Mace": { displayName: "Astral Mace", description: "Tier 4 mace — Crushing mace — damage scales with fall/speed. Base 28 dmg. 2 Star Alloy + 1 Stick + 1 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Crush every 3 hits (flame smash) + hit spark." },
  "Astral Whip": { displayName: "Astral Whip", description: "Tier 4 whip — Whip — pulls enemies to you. Base 24 dmg. 1 Star Alloy + 1 Cotton → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Lash every 2 hits (curved trail) + hit spark." },
  "Astral Bow": { displayName: "Astral Bow", description: "Tier 4 bow — Chargeable bow — hold to charge, scales with draw. Base 40 dmg. 3 Star Alloy + 1 Cotton + 2 Stick → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Arrow trail every hit (light streak)." },
  "Astral Crossbow": { displayName: "Astral Crossbow", description: "Tier 4 crossbow — Crossbow — slower, higher burst. Base 48 dmg. 4 Star Alloy + 1 Cotton + 2 Stick + 2 Iron Bar → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Bolt burst every hit (star burst)." },
  "Astral Staff": { displayName: "Astral Staff", description: "Tier 4 staff — Magic staff — channels elemental power, benefits from blessings. Base 45 dmg. 2 Star Alloy + 2 Stick + 1 Comet Shard → Artisan Bench. Scales with dealingDamageMultiplier (Blessings). FX: Arcane vortex every 2 hits (magic vortex) + hit spark." },
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
