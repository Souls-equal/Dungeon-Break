/**
 * Item display overrides via api.setItemStat(playerId, itemName, stat, value)
 * Per-player renames + descriptions for all custom alloys/armors.
 * Called onPlayerJoin after registerCraftingRecipes.
 * Uses the 32 settable stats (displayName, description confirmed in API notes 22 Sep 2026).
 */

export const ITEM_STAT_OVERRIDES = {
 // ── Tier 1 base materials ──
 "Amethite": { displayName: "Amethite Ingot", description: "Tier 1 crystal — Inventory: 4 Amethite Fragment → 1. → Artisan Bench: armor | Workbench: weapon." },
 "Magmasteel": { displayName: "Magmasteel Ingot", description: "Tier 1 steel — Inventory: 4 Magmasteel Fragment → 1. → Artisan Bench: armor | Workbench: weapon." },
 "Rubellite": { displayName: "Rubellite Gem", description: "Tier 1 gem — Inventory: 4 Rubellite Fragment → 1. → Artisan Bench: armor | Workbench: weapon." },
 "Serpentite": { displayName: "Serpentite Scale", description: "Tier 1 scale — Inventory: 4 Serpentite Fragment → 1. → Artisan Bench: armor | Workbench: weapon." },
 "Amethite Fragment": { displayName: "Amethite Fragment", description: "Common shard." },
 "Magmasteel Fragment": { displayName: "Magmasteel Fragment", description: "Common shard." },
 "Rubellite Fragment": { displayName: "Rubellite Fragment", description: "Common shard." },
 "Serpentite Fragment": { displayName: "Serpentite Fragment", description: "Uncommon shard." },

 // ── Tier 2 alloys ──
 "Iron Plate": { displayName: "Cursemetal Ingot", description: "Tier 2 — Inventory: 2 Rubellite Frag + 2 Serpentite Frag + 1 Iron Bar → 1. → Artisan Bench: Cursemetal set." },
 "Gold Plate": { displayName: "Kingly Amethite Ingot", description: "Tier 2 — Inventory: 3 Amethite + 2 Gold Bar + 1 Diamond Fragment → 1. → Artisan Bench: Kingly Amethite." },
 "Machine Hull": { displayName: "Kingly Diamond Ingot", description: "Tier 2 — Inventory: 2 Diamond + 2 Gold Bar + 2 Amethite Frag → 1. → Artisan Bench: Kingly Diamond." },

 // ── Tier 3 alloys ──
 "Steel Bar": { displayName: "Sanguine Alloy", description: "Tier 3 — Inventory: 4 Sanguine Shard + 1 Iron Bar → 1. → Sanguine set." },
 "Logic Board": { displayName: "Spectral Essence", description: "Tier 3 — Inventory: 4 Spectral Shard + 2 Gold Fragment → 1. → Spectral set." },
 "Copper Bar": { displayName: "Geo Core", description: "Tier 3 — Inventory: 4 Geo Shard + 1 Iron Bar → 1. → Geo set." },
 "Sanguine Shard": { displayName: "Sanguine Shard", description: "Tier 3 — Uncommon+ crate → Inventory → Sanguine Alloy." },
 "Spectral Shard": { displayName: "Spectral Shard", description: "Tier 3 — Uncommon+ crate → Inventory → Spectral Essence." },
 "Geo Shard": { displayName: "Geo Shard", description: "Tier 3 — Rare+ crate → Inventory → Geo Core." },
 "Voltite Dust": { displayName: "Voltite Dust", description: "Tier 3-4 — Rare+ crate → Inventory → Voltplate Core." },

 // ── Tier 4 alloys ──
 "Star Alloy": { displayName: "Astral Essence", description: "Tier 4 — Inventory: 3 Astral Shard + 2 Comet Shard + 1 Moonstone Dust → 1. → Astral set." },
 "Voltite Cell": { displayName: "Voltplate Core", description: "Tier 4 — Inventory: 3 Voltite Dust + 2 Raw Voltite + 1 Copper Wire → 1. → Voltplate set." },
 "Astral Shard": { displayName: "Astral Shard", description: "Tier 4 — Epic+ crate → Inventory → Astral Essence." },
 "Comet Shard": { displayName: "Comet Shard", description: "Tier 4 — Epic+ crate → Astral set." },
 "Raw Voltite": { displayName: "Raw Voltite", description: "Tier 4 — Epic+ crate → Voltplate set." },
 "Moonstone Dust": { displayName: "Moonstone Dust", description: "Tier 3-4 — Rare+ crate → Spectral & Astral (Inventory)." },
 "Comet Core": { displayName: "Comet Core", description: "Rare comet core. Used in endgame crafts." },

 // ── Armors Tier 1 ──
 "Amethite Helmet": { displayName: "Amethite Helmet", description: "Amethite Armor — Wave on hit. More pieces = higher chance, damage, radius and targets." },
 "Amethite Chestplate": { displayName: "Amethite Chestplate", description: "Amethite Armor — Wave on hit. More pieces = higher chance, damage, radius and targets." },
 "Amethite Leggings": { displayName: "Amethite Leggings", description: "Amethite Armor — Wave on hit. More pieces = higher chance, damage, radius and targets." },
 "Amethite Boots": { displayName: "Amethite Boots", description: "Amethite Armor — Wave on hit. More pieces = higher chance, damage, radius and targets." },
 "Amethite Gauntlets": { displayName: "Amethite Gauntlets", description: "Amethite Armor — Wave on hit. More pieces = higher chance, damage, radius and targets." },

 "Magmasteel Helmet": { displayName: "Magmasteel Helmet", description: "Magmasteel Armor — Lava resistance and burn on hit. More pieces = stronger burn and death explosion." },
 "Magmasteel Chestplate": { displayName: "Magmasteel Chestplate", description: "Magmasteel Armor — Lava resistance and burn on hit. More pieces = stronger burn and death explosion." },
 "Magmasteel Leggings": { displayName: "Magmasteel Leggings", description: "Magmasteel Armor — Lava resistance and burn on hit. More pieces = stronger burn and death explosion." },
 "Magmasteel Boots": { displayName: "Magmasteel Boots", description: "Magmasteel Armor — Lava resistance and burn on hit. More pieces = stronger burn and death explosion." },
 "Magmasteel Gauntlets": { displayName: "Magmasteel Gauntlets", description: "Magmasteel Armor — Lava resistance and burn on hit. More pieces = stronger burn and death explosion." },

 "Rubellite Helmet": { displayName: "Rubellite Helmet", description: "Rubellite Armor — Heal on kill + Regen. Chain kills to increase Regen, max gives shield from excess." },
 "Rubellite Chestplate": { displayName: "Rubellite Chestplate", description: "Rubellite Armor — Heal on kill + Regen. Chain kills to increase Regen, max gives shield from excess." },
 "Rubellite Leggings": { displayName: "Rubellite Leggings", description: "Rubellite Armor — Heal on kill + Regen. Chain kills to increase Regen, max gives shield from excess." },
 "Rubellite Boots": { displayName: "Rubellite Boots", description: "Rubellite Armor — Heal on kill + Regen. Chain kills to increase Regen, max gives shield from excess." },
 "Rubellite Gauntlets": { displayName: "Rubellite Gauntlets", description: "Rubellite Armor — Heal on kill + Regen. Chain kills to increase Regen, max gives shield from excess." },

 "Serpentite Helmet": { displayName: "Serpentite Helmet", description: "Serpentite Armor — Poison on hit. More pieces = longer poison and enemies deal less damage; spreads on death." },
 "Serpentite Chestplate": { displayName: "Serpentite Chestplate", description: "Serpentite Armor — Poison on hit. More pieces = longer poison and enemies deal less damage; spreads on death." },
 "Serpentite Leggings": { displayName: "Serpentite Leggings", description: "Serpentite Armor — Poison on hit. More pieces = longer poison and enemies deal less damage; spreads on death." },
 "Serpentite Boots": { displayName: "Serpentite Boots", description: "Serpentite Armor — Poison on hit. More pieces = longer poison and enemies deal less damage; spreads on death." },
 "Serpentite Gauntlets": { displayName: "Serpentite Gauntlets", description: "Serpentite Armor — Poison on hit. More pieces = longer poison and enemies deal less damage; spreads on death." },

 // ── Tier 2 armors ──
 "Cursemetal Helmet": { displayName: "Cursemetal Helmet", description: "Cursemetal Armor — Curse on hit (take more, deal less). More pieces = stronger curse, spreads and explodes on death." },
 "Cursemetal Chestplate": { displayName: "Cursemetal Chestplate", description: "Cursemetal Armor — Curse on hit (take more, deal less). More pieces = stronger curse, spreads and explodes on death." },
 "Cursemetal Leggings": { displayName: "Cursemetal Leggings", description: "Cursemetal Armor — Curse on hit (take more, deal less). More pieces = stronger curse, spreads and explodes on death." },
 "Cursemetal Boots": { displayName: "Cursemetal Boots", description: "Cursemetal Armor — Curse on hit (take more, deal less). More pieces = stronger curse, spreads and explodes on death." },
 "Cursemetal Gauntlets": { displayName: "Cursemetal Gauntlets", description: "Cursemetal Armor — Curse on hit (take more, deal less). More pieces = stronger curse, spreads and explodes on death." },

 "Kingly Amethite Helmet": { displayName: "Kingly Amethite Helmet", description: "Kingly Amethite Armor — Ability damage and cost reduction. Combo 3 hits for bonus and explosion with more pieces." },
 "Kingly Amethite Chestplate": { displayName: "Kingly Amethite Chestplate", description: "Kingly Amethite Armor — Ability damage and cost reduction. Combo 3 hits for bonus and explosion with more pieces." },
 "Kingly Amethite Leggings": { displayName: "Kingly Amethite Leggings", description: "Kingly Amethite Armor — Ability damage and cost reduction. Combo 3 hits for bonus and explosion with more pieces." },
 "Kingly Amethite Boots": { displayName: "Kingly Amethite Boots", description: "Kingly Amethite Armor — Ability damage and cost reduction. Combo 3 hits for bonus and explosion with more pieces." },
 "Kingly Amethite Gauntlets": { displayName: "Kingly Amethite Gauntlets", description: "Kingly Amethite Armor — Ability damage and cost reduction. Combo 3 hits for bonus and explosion with more pieces." },

 "Kingly Diamond Helmet": { displayName: "Kingly Diamond Helmet", description: "Kingly Diamond Armor — Damage reduction and shield from hits. Shield-break shockwave; low-HP emergency with 5 pieces." },
 "Kingly Diamond Chestplate": { displayName: "Kingly Diamond Chestplate", description: "Kingly Diamond Armor — Damage reduction and shield from hits. Shield-break shockwave; low-HP emergency with 5 pieces." },
 "Kingly Diamond Leggings": { displayName: "Kingly Diamond Leggings", description: "Kingly Diamond Armor — Damage reduction and shield from hits. Shield-break shockwave; low-HP emergency with 5 pieces." },
 "Kingly Diamond Boots": { displayName: "Kingly Diamond Boots", description: "Kingly Diamond Armor — Damage reduction and shield from hits. Shield-break shockwave; low-HP emergency with 5 pieces." },
 "Kingly Diamond Gauntlets": { displayName: "Kingly Diamond Gauntlets", description: "Kingly Diamond Armor — Damage reduction and shield from hits. Shield-break shockwave; low-HP emergency with 5 pieces." },

 // ── Tier 3 armors ──
 "Sanguine Helmet": { displayName: "Sanguine Helmet", description: "Sanguine Armor — Lifesteal on damage. Excess to shield. Heals and explodes on kill with more pieces." },
 "Sanguine Chestplate": { displayName: "Sanguine Chestplate", description: "Sanguine Armor — Lifesteal on damage. Excess to shield. Heals and explodes on kill with more pieces." },
 "Sanguine Leggings": { displayName: "Sanguine Leggings", description: "Sanguine Armor — Lifesteal on damage. Excess to shield. Heals and explodes on kill with more pieces." },
 "Sanguine Boots": { displayName: "Sanguine Boots", description: "Sanguine Armor — Lifesteal on damage. Excess to shield. Heals and explodes on kill with more pieces." },
 "Sanguine Gauntlets": { displayName: "Sanguine Gauntlets", description: "Sanguine Armor — Lifesteal on damage. Excess to shield. Heals and explodes on kill with more pieces." },

 "Spectral Helmet": { displayName: "Spectral Helmet", description: "Spectral Armor — Invisibility when hit. More pieces = longer invis, speed, pull and explosion on kill." },
 "Spectral Chestplate": { displayName: "Spectral Chestplate", description: "Spectral Armor — Invisibility when hit. More pieces = longer invis, speed, pull and explosion on kill." },
 "Spectral Leggings": { displayName: "Spectral Leggings", description: "Spectral Armor — Invisibility when hit. More pieces = longer invis, speed, pull and explosion on kill." },
 "Spectral Boots": { displayName: "Spectral Boots", description: "Spectral Armor — Invisibility when hit. More pieces = longer invis, speed, pull and explosion on kill." },
 "Spectral Gauntlets": { displayName: "Spectral Gauntlets", description: "Spectral Armor — Invisibility when hit. More pieces = longer invis, speed, pull and explosion on kill." },

 "Geo Helmet": { displayName: "Geo Helmet", description: "Geo Armor — Shield on hit. Every 5 hits seismic wave. Mines on kill with more pieces, chain with 5." },
 "Geo Chestplate": { displayName: "Geo Chestplate", description: "Geo Armor — Shield on hit. Every 5 hits seismic wave. Mines on kill with more pieces, chain with 5." },
 "Geo Leggings": { displayName: "Geo Leggings", description: "Geo Armor — Shield on hit. Every 5 hits seismic wave. Mines on kill with more pieces, chain with 5." },
 "Geo Boots": { displayName: "Geo Boots", description: "Geo Armor — Shield on hit. Every 5 hits seismic wave. Mines on kill with more pieces, chain with 5." },
 "Geo Gauntlets": { displayName: "Geo Gauntlets", description: "Geo Armor — Shield on hit. Every 5 hits seismic wave. Mines on kill with more pieces, chain with 5." },

 // ── Tier 4 armors ──
 "Astral Helmet": { displayName: "Astral Helmet", description: "Astral Armor — Slowing aura. More pieces = larger aura, extra dmg vs slowed, glow and damage aura on kill." },
 "Astral Chestplate": { displayName: "Astral Chestplate", description: "Astral Armor — Slowing aura. More pieces = larger aura, extra dmg vs slowed, glow and damage aura on kill." },
 "Astral Leggings": { displayName: "Astral Leggings", description: "Astral Armor — Slowing aura. More pieces = larger aura, extra dmg vs slowed, glow and damage aura on kill." },
 "Astral Boots": { displayName: "Astral Boots", description: "Astral Armor — Slowing aura. More pieces = larger aura, extra dmg vs slowed, glow and damage aura on kill." },
 "Astral Gauntlets": { displayName: "Astral Gauntlets", description: "Astral Armor — Slowing aura. More pieces = larger aura, extra dmg vs slowed, glow and damage aura on kill." },

 "Voltplate Helmet": { displayName: "Voltplate Helmet", description: "Voltplate Armor — Shock on hit. More pieces = more damage/targets, slow and chain lightning with 5 pieces." },
 "Voltplate Chestplate": { displayName: "Voltplate Chestplate", description: "Voltplate Armor — Shock on hit. More pieces = more damage/targets, slow and chain lightning with 5 pieces." },
 "Voltplate Leggings": { displayName: "Voltplate Leggings", description: "Voltplate Armor — Shock on hit. More pieces = more damage/targets, slow and chain lightning with 5 pieces." },
 "Voltplate Boots": { displayName: "Voltplate Boots", description: "Voltplate Armor — Shock on hit. More pieces = more damage/targets, slow and chain lightning with 5 pieces." },
 "Voltplate Gauntlets": { displayName: "Voltplate Gauntlets", description: "Voltplate Armor — Shock on hit. More pieces = more damage/targets, slow and chain lightning with 5 pieces." },

 "Moonstone Sword": { displayName: "Moonstone Sword", description: "Tier 5 sword — Balanced blade — high damage, crit 1.35x. 52 dmg. No proc — pure damage after Diamond." },
 "Nova Alloy": { displayName: "Nova Alloy", description: "Tier 6 — Inventory: 2 Star Alloy + 1 Voltite Cell → 1 Nova Matter. → Artisan: Nova set | Workbench: Nova Blade." },
 "Nova Shard": { displayName: "Nova Shard", description: "Tier 6 shard. Found in Epic+ crates. → Nova Alloy." },
 "Nova Helmet": { displayName: "Nova Helmet", description: "Nova Armor — Charges on kill for damage. Small explosion at 4 charges and major Nova at 10 with full set." },
 "Nova Chestplate": { displayName: "Nova Chestplate", description: "Nova Armor — Charges on kill for damage. Small explosion at 4 charges and major Nova at 10 with full set." },
 "Nova Leggings": { displayName: "Nova Leggings", description: "Nova Armor — Charges on kill for damage. Small explosion at 4 charges and major Nova at 10 with full set." },
 "Nova Boots": { displayName: "Nova Boots", description: "Nova Armor — Charges on kill for damage. Small explosion at 4 charges and major Nova at 10 with full set." },
 "Nova Gauntlets": { displayName: "Nova Gauntlets", description: "Nova Armor — Charges on kill for damage. Small explosion at 4 charges and major Nova at 10 with full set." },
 "Nova Blade": { displayName: "Nova Blade", description: "Tier 6 blade — Energy blade — 68 dmg. Slash every hit · Speed when held · 20 charges laser (crouch+attack)." },

 // ── Weapons Tier 1 — Amethite — Every 4th hit: violet zone +60% ──
 "Amethite Sword": { displayName: "Amethite Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35x. 36 dmg. Every 4th hit: violet zone +60%." },
 "Amethite Dagger": { displayName: "Amethite Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. 18 dmg. Every 4th hit: violet zone +60%." },
 "Amethite Spear": { displayName: "Amethite Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. 30 dmg. Every 4th hit: violet zone +60%." },
 "Amethite Club": { displayName: "Amethite Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. 36 dmg. Every 4th hit: violet zone +60%." },
 "Amethite Mace": { displayName: "Amethite Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. 20 dmg. Every 4th hit: violet zone +60%." },
 "Amethite Whip": { displayName: "Amethite Whip", description: "Tier 1 whip — Whip — pulls enemies to you. 16 dmg. Every 4th hit: violet zone +60%." },
 "Amethite Bow": { displayName: "Amethite Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. 28 dmg. Every 4th hit: violet zone +60%." },
 "Amethite Crossbow": { displayName: "Amethite Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. 34 dmg. Every 4th hit: violet zone +60%." },
 "Amethite Boomerang": { displayName: "Amethite Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. 16 dmg. Every 4th hit: violet zone +60%." },
 "Magmasteel Sword": { displayName: "Magmasteel Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35x. 36 dmg. Burn 20%/s for 5s (fire)." },
 "Magmasteel Dagger": { displayName: "Magmasteel Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. 18 dmg. Burn 20%/s for 5s (fire)." },
 "Magmasteel Spear": { displayName: "Magmasteel Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. 30 dmg. Burn 20%/s for 5s (fire)." },
 "Magmasteel Club": { displayName: "Magmasteel Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. 36 dmg. Burn 20%/s for 5s (fire)." },
 "Magmasteel Mace": { displayName: "Magmasteel Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. 20 dmg. Burn 20%/s for 5s (fire)." },
 "Magmasteel Whip": { displayName: "Magmasteel Whip", description: "Tier 1 whip — Whip — pulls enemies to you. 16 dmg. Burn 20%/s for 5s (fire)." },
 "Magmasteel Bow": { displayName: "Magmasteel Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. 28 dmg. Burn 20%/s for 5s (fire)." },
 "Magmasteel Crossbow": { displayName: "Magmasteel Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. 34 dmg. Burn 20%/s for 5s (fire)." },
 "Magmasteel Boomerang": { displayName: "Magmasteel Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. 16 dmg. Burn 20%/s for 5s (fire)." },
 "Rubellite Sword": { displayName: "Rubellite Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35x. 37 dmg. Kill: Regen 15s (stack 10/9/8s)." },
 "Rubellite Dagger": { displayName: "Rubellite Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. 19 dmg. Kill: Regen 15s (stack 10/9/8s)." },
 "Rubellite Spear": { displayName: "Rubellite Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. 31 dmg. Kill: Regen 15s (stack 10/9/8s)." },
 "Rubellite Club": { displayName: "Rubellite Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. 37 dmg. Kill: Regen 15s (stack 10/9/8s)." },
 "Rubellite Mace": { displayName: "Rubellite Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. 21 dmg. Kill: Regen 15s (stack 10/9/8s)." },
 "Rubellite Whip": { displayName: "Rubellite Whip", description: "Tier 1 whip — Whip — pulls enemies to you. 17 dmg. Kill: Regen 15s (stack 10/9/8s)." },
 "Rubellite Bow": { displayName: "Rubellite Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. 29 dmg. Kill: Regen 15s (stack 10/9/8s)." },
 "Rubellite Crossbow": { displayName: "Rubellite Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. 35 dmg. Kill: Regen 15s (stack 10/9/8s)." },
 "Rubellite Boomerang": { displayName: "Rubellite Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. 17 dmg. Kill: Regen 15s (stack 10/9/8s)." },
 "Serpentite Sword": { displayName: "Serpentite Sword", description: "Tier 1 sword — Balanced blade — high damage, crit 1.35x. 38 dmg. Poison 10%/s for 8s." },
 "Serpentite Dagger": { displayName: "Serpentite Dagger", description: "Tier 1 dagger — Fast dagger — low damage, double from behind, combo scaling. 19 dmg. Poison 10%/s for 8s." },
 "Serpentite Spear": { displayName: "Serpentite Spear", description: "Tier 1 spear — Dash spear — lunges 7 blocks on hit. 32 dmg. Poison 10%/s for 8s." },
 "Serpentite Club": { displayName: "Serpentite Club", description: "Tier 1 club — Heavy club — sword damage + massive knockback. 38 dmg. Poison 10%/s for 8s." },
 "Serpentite Mace": { displayName: "Serpentite Mace", description: "Tier 1 mace — Crushing mace — damage scales with fall/speed. 22 dmg. Poison 10%/s for 8s." },
 "Serpentite Whip": { displayName: "Serpentite Whip", description: "Tier 1 whip — Whip — pulls enemies to you. 17 dmg. Poison 10%/s for 8s." },
 "Serpentite Bow": { displayName: "Serpentite Bow", description: "Tier 1 bow — Chargeable bow — hold to charge, scales with draw. 30 dmg. Poison 10%/s for 8s." },
 "Serpentite Crossbow": { displayName: "Serpentite Crossbow", description: "Tier 1 crossbow — Crossbow — slower, higher burst. 36 dmg. Poison 10%/s for 8s." },
 "Serpentite Boomerang": { displayName: "Serpentite Boomerang", description: "Tier 1 boomerang — Throwing boomerang — returns, hits twice. 17 dmg. Poison 10%/s for 8s." },
 // ── Weapons Tier 3 — Sanguine / Spectral / Geo ──
 "Sanguine Sword": { displayName: "Sanguine Sword", description: "Tier 3 sword — Balanced blade — high damage, crit 1.35x. 42 dmg. Heal 5% of damage dealt." },
 "Sanguine Dagger": { displayName: "Sanguine Dagger", description: "Tier 3 dagger — Fast dagger — low damage, double from behind, combo scaling. 22 dmg. Heal 5% of damage dealt." },
 "Sanguine Spear": { displayName: "Sanguine Spear", description: "Tier 3 spear — Dash spear — lunges 7 blocks on hit. 35 dmg. Heal 5% of damage dealt." },
 "Sanguine Club": { displayName: "Sanguine Club", description: "Tier 3 club — Heavy club — sword damage + massive knockback. 42 dmg. Heal 5% of damage dealt." },
 "Sanguine Mace": { displayName: "Sanguine Mace", description: "Tier 3 mace — Crushing mace — damage scales with fall/speed. 24 dmg. Heal 5% of damage dealt." },
 "Sanguine Whip": { displayName: "Sanguine Whip", description: "Tier 3 whip — Whip — pulls enemies to you. 20 dmg. Heal 5% of damage dealt." },
 "Sanguine Bow": { displayName: "Sanguine Bow", description: "Tier 3 bow — Chargeable bow — hold to charge, scales with draw. 34 dmg. Heal 5% of damage dealt." },
 "Sanguine Crossbow": { displayName: "Sanguine Crossbow", description: "Tier 3 crossbow — Crossbow — slower, higher burst. 40 dmg. Heal 5% of damage dealt." },
 "Sanguine Staff": { displayName: "Sanguine Staff", description: "Tier 3 staff — Magic staff — channels elemental power. 38 dmg. Heal 5% of damage dealt." },
 "Spectral Sword": { displayName: "Spectral Sword", description: "Tier 3 sword — Balanced blade — high damage, crit 1.35x. 44 dmg. Invis 3s + vacuum & explosion on kill." },
 "Spectral Dagger": { displayName: "Spectral Dagger", description: "Tier 3 dagger — Fast dagger — low damage, double from behind, combo scaling. 23 dmg. Invis 3s + vacuum & explosion on kill." },
 "Spectral Spear": { displayName: "Spectral Spear", description: "Tier 3 spear — Dash spear — lunges 7 blocks on hit. 36 dmg. Invis 3s + vacuum & explosion on kill." },
 "Spectral Club": { displayName: "Spectral Club", description: "Tier 3 club — Heavy club — sword damage + massive knockback. 44 dmg. Invis 3s + vacuum & explosion on kill." },
 "Spectral Mace": { displayName: "Spectral Mace", description: "Tier 3 mace — Crushing mace — damage scales with fall/speed. 25 dmg. Invis 3s + vacuum & explosion on kill." },
 "Spectral Whip": { displayName: "Spectral Whip", description: "Tier 3 whip — Whip — pulls enemies to you. 21 dmg. Invis 3s + vacuum & explosion on kill." },
 "Spectral Bow": { displayName: "Spectral Bow", description: "Tier 3 bow — Chargeable bow — hold to charge, scales with draw. 36 dmg. Invis 3s + vacuum & explosion on kill." },
 "Spectral Crossbow": { displayName: "Spectral Crossbow", description: "Tier 3 crossbow — Crossbow — slower, higher burst. 42 dmg. Invis 3s + vacuum & explosion on kill." },
 "Spectral Staff": { displayName: "Spectral Staff", description: "Tier 3 staff — Magic staff — channels elemental power. 40 dmg. Invis 3s + vacuum & explosion on kill." },
 "Geo Sword": { displayName: "Geo Sword", description: "Tier 3 sword — Balanced blade — high damage, crit 1.35x. 45 dmg. Shield per hit + mines (3s delay)." },
 "Geo Dagger": { displayName: "Geo Dagger", description: "Tier 3 dagger — Fast dagger — low damage, double from behind, combo scaling. 23 dmg. Shield per hit + mines (3s delay)." },
 "Geo Spear": { displayName: "Geo Spear", description: "Tier 3 spear — Dash spear — lunges 7 blocks on hit. 38 dmg. Shield per hit + mines (3s delay)." },
 "Geo Club": { displayName: "Geo Club", description: "Tier 3 club — Heavy club — sword damage + massive knockback. 45 dmg. Shield per hit + mines (3s delay)." },
 "Geo Mace": { displayName: "Geo Mace", description: "Tier 3 mace — Crushing mace — damage scales with fall/speed. 26 dmg. Shield per hit + mines (3s delay)." },
 "Geo Whip": { displayName: "Geo Whip", description: "Tier 3 whip — Whip — pulls enemies to you. 22 dmg. Shield per hit + mines (3s delay)." },
 "Geo Bow": { displayName: "Geo Bow", description: "Tier 3 bow — Chargeable bow — hold to charge, scales with draw. 37 dmg. Shield per hit + mines (3s delay)." },
 "Geo Crossbow": { displayName: "Geo Crossbow", description: "Tier 3 crossbow — Crossbow — slower, higher burst. 44 dmg. Shield per hit + mines (3s delay)." },
 "Geo Staff": { displayName: "Geo Staff", description: "Tier 3 staff — Magic staff — channels elemental power. 41 dmg. Shield per hit + mines (3s delay)." },
 // ── Weapons Tier 4 — Astral ──
 "Astral Sword": { displayName: "Astral Sword", description: "Tier 4 sword — Balanced blade — high damage, crit 1.35x. 50 dmg. Kill: Glowing 15b + tornado + slow aura." },
 "Astral Dagger": { displayName: "Astral Dagger", description: "Tier 4 dagger — Fast dagger — low damage, double from behind, combo scaling. 26 dmg. Kill: Glowing 15b + tornado + slow aura." },
 "Astral Spear": { displayName: "Astral Spear", description: "Tier 4 spear — Dash spear — lunges 7 blocks on hit. 42 dmg. Kill: Glowing 15b + tornado + slow aura." },
 "Astral Club": { displayName: "Astral Club", description: "Tier 4 club — Heavy club — sword damage + massive knockback. 50 dmg. Kill: Glowing 15b + tornado + slow aura." },
 "Astral Mace": { displayName: "Astral Mace", description: "Tier 4 mace — Crushing mace — damage scales with fall/speed. 28 dmg. Kill: Glowing 15b + tornado + slow aura." },
 "Astral Whip": { displayName: "Astral Whip", description: "Tier 4 whip — Whip — pulls enemies to you. 24 dmg. Kill: Glowing 15b + tornado + slow aura." },
 "Astral Bow": { displayName: "Astral Bow", description: "Tier 4 bow — Chargeable bow — hold to charge, scales with draw. 40 dmg. Kill: Glowing 15b + tornado + slow aura." },
 "Astral Crossbow": { displayName: "Astral Crossbow", description: "Tier 4 crossbow — Crossbow — slower, higher burst. 48 dmg. Kill: Glowing 15b + tornado + slow aura." },
 "Astral Staff": { displayName: "Astral Staff", description: "Tier 4 staff — Magic staff — channels elemental power. 45 dmg. Kill: Glowing 15b + tornado + slow aura." },
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
