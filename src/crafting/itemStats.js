/**
 * Item display overrides via api.setItemStat(playerId, itemName, stat, value)
 * Per-player renames + descriptions for all custom alloys/armors.
 * Called onPlayerJoin after registerCraftingRecipes.
 * Uses the 32 settable stats (displayName, description confirmed in API notes 22 Sep 2026).
 */

export const ITEM_STAT_OVERRIDES = {
 // ── Tier 1 base materials (already named, but lore added) ──
 "Amethite": { displayName: "Amethite Ingot", description: "Tier 1 crystal ingot. Craft Amethite armor." },
 "Magmasteel": { displayName: "Magmasteel Ingot", description: "Tier 1 molten steel. Craft Magmasteel armor." },
 "Rubellite": { displayName: "Rubellite Gem", description: "Tier 1 blood gem. Craft Rubellite armor." },
 "Serpentite": { displayName: "Serpentite Scale", description: "Tier 1 serpent scale. Craft Serpentite armor." },
 "Amethite Fragment": { displayName: "Amethite Fragment", description: "Common shard." },
 "Magmasteel Fragment": { displayName: "Magmasteel Fragment", description: "Common shard." },
 "Rubellite Fragment": { displayName: "Rubellite Fragment", description: "Common shard." },
 "Serpentite Fragment": { displayName: "Serpentite Fragment", description: "Uncommon shard." },

 // ── Tier 2 alloys (proxy vanilla items renommés) ──
 "Iron Plate": { displayName: "Cursemetal Ingot", description: "Tier 2 cursed alloy. Craft Cursemetal armor at Artisan Bench." },
 "Gold Plate": { displayName: "Kingly Amethite Ingot", description: "Tier 2 royal alloy. Craft Kingly Amethite armor." },
 "Machine Hull": { displayName: "Kingly Diamond Ingot", description: "Tier 2 reinforced core. Craft Kingly Diamond armor." },

 // ── Tier 3 alloys ──
 "Steel Bar": { displayName: "Sanguine Alloy", description: "Tier 3 blood-forged alloy. Craft Sanguine armor." },
 "Logic Board": { displayName: "Spectral Essence", description: "Tier 3 ethereal essence. Craft Spectral armor." },
 "Copper Bar": { displayName: "Geo Core", description: "Tier 3 earthen core. Craft Geo armor." },
 "Sanguine Shard": { displayName: "Sanguine Shard", description: "Tier 3 shard. Found in Uncommon+ crates. → Sanguine Alloy." },
 "Spectral Shard": { displayName: "Spectral Shard", description: "Tier 3 shard. Found in Uncommon+ crates. → Spectral Essence." },
 "Geo Shard": { displayName: "Geo Shard", description: "Tier 3 shard. Found in Rare+ crates. → Geo Core." },
 "Voltite Dust": { displayName: "Voltite Dust", description: "Tier 3-4 dust. Found in Rare+ crates. → Voltplate Core." },

 // ── Tier 4 alloys ──
 "Star Alloy": { displayName: "Astral Essence", description: "Tier 4 cosmic essence. Craft Astral armor." },
 "Voltite Cell": { displayName: "Voltplate Core", description: "Tier 4 charged core. Craft Voltplate armor." },
 "Astral Shard": { displayName: "Astral Shard", description: "Tier 4 shard. Found in Epic+ crates. → Astral Essence." },
 "Comet Shard": { displayName: "Comet Shard", description: "Tier 4 comet fragment. Epic+ crates. Used for Astral armor." },
 "Raw Voltite": { displayName: "Raw Voltite", description: "Tier 4 raw voltite. Epic+ crates. Used for Voltplate armor." },
 "Moonstone Dust": { displayName: "Moonstone Dust", description: "Mystical dust. Used for Spectral & Astral crafts." },
 "Comet Core": { displayName: "Comet Core", description: "Rare comet core. Used in endgame crafts." },

 // ── Armors Tier 1 ──
 "Amethite Helmet": { displayName: "Amethite Helmet", description: "Tier 1 helmet. Balanced Tier 1 set." },
 "Amethite Chestplate": { displayName: "Amethite Chestplate", description: "Tier 1 chestplate." },
 "Amethite Leggings": { displayName: "Amethite Leggings", description: "Tier 1 leggings." },
 "Amethite Boots": { displayName: "Amethite Boots", description: "Tier 1 boots." },
 "Amethite Gauntlets": { displayName: "Amethite Gauntlets", description: "Tier 1 gauntlets." },

 "Magmasteel Helmet": { displayName: "Magmasteel Helmet", description: "Tier 1 fire helmet." },
 "Magmasteel Chestplate": { displayName: "Magmasteel Chestplate", description: "Tier 1 fire chestplate." },
 "Magmasteel Leggings": { displayName: "Magmasteel Leggings", description: "Tier 1 fire leggings." },
 "Magmasteel Boots": { displayName: "Magmasteel Boots", description: "Tier 1 fire boots." },
 "Magmasteel Gauntlets": { displayName: "Magmasteel Gauntlets", description: "Tier 1 fire gauntlets." },

 "Rubellite Helmet": { displayName: "Rubellite Helmet", description: "Tier 1 gem helmet." },
 "Rubellite Chestplate": { displayName: "Rubellite Chestplate", description: "Tier 1 gem chestplate." },
 "Rubellite Leggings": { displayName: "Rubellite Leggings", description: "Tier 1 gem leggings." },
 "Rubellite Boots": { displayName: "Rubellite Boots", description: "Tier 1 gem boots." },
 "Rubellite Gauntlets": { displayName: "Rubellite Gauntlets", description: "Tier 1 gem gauntlets." },

 "Serpentite Helmet": { displayName: "Serpentite Helmet", description: "Tier 1 scale helmet." },
 "Serpentite Chestplate": { displayName: "Serpentite Chestplate", description: "Tier 1 scale chestplate." },
 "Serpentite Leggings": { displayName: "Serpentite Leggings", description: "Tier 1 scale leggings." },
 "Serpentite Boots": { displayName: "Serpentite Boots", description: "Tier 1 scale boots." },
 "Serpentite Gauntlets": { displayName: "Serpentite Gauntlets", description: "Tier 1 scale gauntlets." },

 // ── Tier 2 armors ──
 "Cursemetal Helmet": { displayName: "Cursemetal Helmet", description: "Tier 2 cursed helmet." },
 "Cursemetal Chestplate": { displayName: "Cursemetal Chestplate", description: "Tier 2 cursed chestplate." },
 "Cursemetal Leggings": { displayName: "Cursemetal Leggings", description: "Tier 2 cursed leggings." },
 "Cursemetal Boots": { displayName: "Cursemetal Boots", description: "Tier 2 cursed boots." },
 "Cursemetal Gauntlets": { displayName: "Cursemetal Gauntlets", description: "Tier 2 cursed gauntlets." },

 "Kingly Amethite Helmet": { displayName: "Kingly Amethite Helmet", description: "Tier 2 royal amethite helmet." },
 "Kingly Amethite Chestplate": { displayName: "Kingly Amethite Chestplate", description: "Tier 2 royal chestplate." },
 "Kingly Amethite Leggings": { displayName: "Kingly Amethite Leggings", description: "Tier 2 royal leggings." },
 "Kingly Amethite Boots": { displayName: "Kingly Amethite Boots", description: "Tier 2 royal boots." },
 "Kingly Amethite Gauntlets": { displayName: "Kingly Amethite Gauntlets", description: "Tier 2 royal gauntlets." },

 "Kingly Diamond Helmet": { displayName: "Kingly Diamond Helmet", description: "Tier 2 diamond sovereign helmet." },
 "Kingly Diamond Chestplate": { displayName: "Kingly Diamond Chestplate", description: "Tier 2 sovereign chestplate." },
 "Kingly Diamond Leggings": { displayName: "Kingly Diamond Leggings", description: "Tier 2 sovereign leggings." },
 "Kingly Diamond Boots": { displayName: "Kingly Diamond Boots", description: "Tier 2 sovereign boots." },
 "Kingly Diamond Gauntlets": { displayName: "Kingly Diamond Gauntlets", description: "Tier 2 sovereign gauntlets." },

 // ── Tier 3 armors ──
 "Sanguine Helmet": { displayName: "Sanguine Helmet", description: "Tier 3 blood helmet." },
 "Sanguine Chestplate": { displayName: "Sanguine Chestplate", description: "Tier 3 blood chestplate." },
 "Sanguine Leggings": { displayName: "Sanguine Leggings", description: "Tier 3 blood leggings." },
 "Sanguine Boots": { displayName: "Sanguine Boots", description: "Tier 3 blood boots." },
 "Sanguine Gauntlets": { displayName: "Sanguine Gauntlets", description: "Tier 3 blood gauntlets." },

 "Spectral Helmet": { displayName: "Spectral Helmet", description: "Tier 3 spectral helmet." },
 "Spectral Chestplate": { displayName: "Spectral Chestplate", description: "Tier 3 spectral chestplate." },
 "Spectral Leggings": { displayName: "Spectral Leggings", description: "Tier 3 spectral leggings." },
 "Spectral Boots": { displayName: "Spectral Boots", description: "Tier 3 spectral boots." },
 "Spectral Gauntlets": { displayName: "Spectral Gauntlets", description: "Tier 3 spectral gauntlets." },

 "Geo Helmet": { displayName: "Geo Helmet", description: "Tier 3 geo helmet." },
 "Geo Chestplate": { displayName: "Geo Chestplate", description: "Tier 3 geo chestplate." },
 "Geo Leggings": { displayName: "Geo Leggings", description: "Tier 3 geo leggings." },
 "Geo Boots": { displayName: "Geo Boots", description: "Tier 3 geo boots." },
 "Geo Gauntlets": { displayName: "Geo Gauntlets", description: "Tier 3 geo gauntlets." },

 // ── Tier 4 armors ──
 "Astral Helmet": { displayName: "Astral Helmet", description: "Tier 4 astral helmet." },
 "Astral Chestplate": { displayName: "Astral Chestplate", description: "Tier 4 astral chestplate." },
 "Astral Leggings": { displayName: "Astral Leggings", description: "Tier 4 astral leggings." },
 "Astral Boots": { displayName: "Astral Boots", description: "Tier 4 astral boots." },
 "Astral Gauntlets": { displayName: "Astral Gauntlets", description: "Tier 4 astral gauntlets." },

 "Voltplate Helmet": { displayName: "Voltplate Helmet", description: "Tier 4 voltplate helmet." },
 "Voltplate Chestplate": { displayName: "Voltplate Chestplate", description: "Tier 4 voltplate chestplate." },
 "Voltplate Leggings": { displayName: "Voltplate Leggings", description: "Tier 4 voltplate leggings." },
 "Voltplate Boots": { displayName: "Voltplate Boots", description: "Tier 4 voltplate boots." },
 "Voltplate Gauntlets": { displayName: "Voltplate Gauntlets", description: "Tier 4 voltplate gauntlets." },

 // ── Armes Tier 1 — Amethite (Workbench, scalent avec dealingDamageMultiplier) ──
 "Amethite Sword": { displayName: "Amethite Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35×. Base 36 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Amethite Dagger": { displayName: "Amethite Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 18 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Amethite Spear": { displayName: "Amethite Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. Base 30 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Amethite Club": { displayName: "Amethite Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. Base 36 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Amethite Mace": { displayName: "Amethite Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. Base 20 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Amethite Whip": { displayName: "Amethite Whip", description: "Tier 1 whip — Whip — pulls enemies to you. Base 16 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Amethite Bow": { displayName: "Amethite Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. Base 28 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Amethite Crossbow": { displayName: "Amethite Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. Base 34 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Amethite Boomerang": { displayName: "Amethite Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. Base 16 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Magmasteel Sword": { displayName: "Magmasteel Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35×. Base 36 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Magmasteel Dagger": { displayName: "Magmasteel Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 18 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Magmasteel Spear": { displayName: "Magmasteel Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. Base 30 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Magmasteel Club": { displayName: "Magmasteel Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. Base 36 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Magmasteel Mace": { displayName: "Magmasteel Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. Base 20 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Magmasteel Whip": { displayName: "Magmasteel Whip", description: "Tier 1 whip — Whip — pulls enemies to you. Base 16 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Magmasteel Bow": { displayName: "Magmasteel Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. Base 28 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Magmasteel Crossbow": { displayName: "Magmasteel Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. Base 34 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Magmasteel Boomerang": { displayName: "Magmasteel Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. Base 16 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Rubellite Sword": { displayName: "Rubellite Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35×. Base 37 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Rubellite Dagger": { displayName: "Rubellite Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 19 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Rubellite Spear": { displayName: "Rubellite Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. Base 31 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Rubellite Club": { displayName: "Rubellite Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. Base 37 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Rubellite Mace": { displayName: "Rubellite Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. Base 21 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Rubellite Whip": { displayName: "Rubellite Whip", description: "Tier 1 whip — Whip — pulls enemies to you. Base 17 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Rubellite Bow": { displayName: "Rubellite Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. Base 29 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Rubellite Crossbow": { displayName: "Rubellite Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. Base 35 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Rubellite Boomerang": { displayName: "Rubellite Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. Base 17 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Serpentite Sword": { displayName: "Serpentite Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35×. Base 38 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Serpentite Dagger": { displayName: "Serpentite Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 19 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Serpentite Spear": { displayName: "Serpentite Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. Base 32 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Serpentite Club": { displayName: "Serpentite Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. Base 38 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Serpentite Mace": { displayName: "Serpentite Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. Base 22 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Serpentite Whip": { displayName: "Serpentite Whip", description: "Tier 1 whip — Whip — pulls enemies to you. Base 17 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Serpentite Bow": { displayName: "Serpentite Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. Base 30 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Serpentite Crossbow": { displayName: "Serpentite Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. Base 36 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Serpentite Boomerang": { displayName: "Serpentite Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. Base 17 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 // ── Armes Tier 3 — Sanguine / Spectral / Geo (Artisan Bench) ──
 "Sanguine Sword": { displayName: "Sanguine Sword", description: "Tier 3 sword — Balanced blade — high damage, crit 1.35×. Base 42 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Sanguine Dagger": { displayName: "Sanguine Dagger", description: "Tier 3 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 22 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Sanguine Spear": { displayName: "Sanguine Spear", description: "Tier 3 spear — Dash spear — lunges 7 blocks on hit. Base 35 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Sanguine Club": { displayName: "Sanguine Club", description: "Tier 3 club — Heavy club — sword damage + massive knockback. Base 42 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Sanguine Mace": { displayName: "Sanguine Mace", description: "Tier 3 mace — Crushing mace — damage scales with fall/speed. Base 24 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Sanguine Whip": { displayName: "Sanguine Whip", description: "Tier 3 whip — Whip — pulls enemies to you. Base 20 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Sanguine Bow": { displayName: "Sanguine Bow", description: "Tier 3 bow — Chargeable bow — hold to charge, scales with draw. Base 34 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Sanguine Crossbow": { displayName: "Sanguine Crossbow", description: "Tier 3 crossbow — Crossbow — slower, higher burst. Base 40 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Sanguine Staff": { displayName: "Sanguine Staff", description: "Tier 3 staff — Magic staff — channels elemental power, benefits from blessings. Base 38 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Spectral Sword": { displayName: "Spectral Sword", description: "Tier 3 sword — Balanced blade — high damage, crit 1.35×. Base 44 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Spectral Dagger": { displayName: "Spectral Dagger", description: "Tier 3 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 23 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Spectral Spear": { displayName: "Spectral Spear", description: "Tier 3 spear — Dash spear — lunges 7 blocks on hit. Base 36 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Spectral Club": { displayName: "Spectral Club", description: "Tier 3 club — Heavy club — sword damage + massive knockback. Base 44 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Spectral Mace": { displayName: "Spectral Mace", description: "Tier 3 mace — Crushing mace — damage scales with fall/speed. Base 25 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Spectral Whip": { displayName: "Spectral Whip", description: "Tier 3 whip — Whip — pulls enemies to you. Base 21 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Spectral Bow": { displayName: "Spectral Bow", description: "Tier 3 bow — Chargeable bow — hold to charge, scales with draw. Base 36 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Spectral Crossbow": { displayName: "Spectral Crossbow", description: "Tier 3 crossbow — Crossbow — slower, higher burst. Base 42 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Spectral Staff": { displayName: "Spectral Staff", description: "Tier 3 staff — Magic staff — channels elemental power, benefits from blessings. Base 40 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Geo Sword": { displayName: "Geo Sword", description: "Tier 3 sword — Balanced blade — high damage, crit 1.35×. Base 45 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Geo Dagger": { displayName: "Geo Dagger", description: "Tier 3 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 23 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Geo Spear": { displayName: "Geo Spear", description: "Tier 3 spear — Dash spear — lunges 7 blocks on hit. Base 38 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Geo Club": { displayName: "Geo Club", description: "Tier 3 club — Heavy club — sword damage + massive knockback. Base 45 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Geo Mace": { displayName: "Geo Mace", description: "Tier 3 mace — Crushing mace — damage scales with fall/speed. Base 26 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Geo Whip": { displayName: "Geo Whip", description: "Tier 3 whip — Whip — pulls enemies to you. Base 22 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Geo Bow": { displayName: "Geo Bow", description: "Tier 3 bow — Chargeable bow — hold to charge, scales with draw. Base 37 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Geo Crossbow": { displayName: "Geo Crossbow", description: "Tier 3 crossbow — Crossbow — slower, higher burst. Base 44 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Geo Staff": { displayName: "Geo Staff", description: "Tier 3 staff — Magic staff — channels elemental power, benefits from blessings. Base 41 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 // ── Armes Tier 4 — Astral (Artisan Bench) ──
 "Astral Sword": { displayName: "Astral Sword", description: "Tier 4 sword — Balanced blade — high damage, crit 1.35×. Base 50 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Astral Dagger": { displayName: "Astral Dagger", description: "Tier 4 dagger — Fast dagger — low damage, double from behind, combo scaling. Base 26 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Astral Spear": { displayName: "Astral Spear", description: "Tier 4 spear — Dash spear — lunges 7 blocks on hit. Base 42 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Astral Club": { displayName: "Astral Club", description: "Tier 4 club — Heavy club — sword damage + massive knockback. Base 50 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Astral Mace": { displayName: "Astral Mace", description: "Tier 4 mace — Crushing mace — damage scales with fall/speed. Base 28 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Astral Whip": { displayName: "Astral Whip", description: "Tier 4 whip — Whip — pulls enemies to you. Base 24 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Astral Bow": { displayName: "Astral Bow", description: "Tier 4 bow — Chargeable bow — hold to charge, scales with draw. Base 40 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Astral Crossbow": { displayName: "Astral Crossbow", description: "Tier 4 crossbow — Crossbow — slower, higher burst. Base 48 dmg. Scales with dealingDamageMultiplier (Blessings)." },
 "Astral Staff": { displayName: "Astral Staff", description: "Tier 4 staff — Magic staff — channels elemental power, benefits from blessings. Base 45 dmg. Scales with dealingDamageMultiplier (Blessings)." },
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
