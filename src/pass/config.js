/**
 * Pass — Battle Pass via Quests
 * 500 XP per tier, 20 tiers = 10 000 total
 * XP via quests (givePassXp), stored in PlayerDbValue, per-player shop category "Pass"
 */

export const PASS_CATEGORY = "Pass";
export const PASS_XP_PER_TIER = 500;
export const PASS_MAX_TIER = 20;
export const PASS_DB_KEY = "dungeonBreak.pass.v1";
export const PASS_XP_PER_QUEST = 100; // fallback for old code — now dynamic per quest difficulty

/**
 * Pass XP for a quest — random in [x-100, x+100] where x is based on difficulty.
 *  - x = template.passXpBase (+ power scaling) → harder quests give more XP
 *  - power 0..8 adds 20 XP per point (scaled difficulty for geared players)
 *  - result clamped to [50, 2000] and random +/-100
 */
export function rollQuestPassXp(template, power) {
  const base = (template && Number.isFinite(template.passXpBase)) ? template.passXpBase : 250;
  const p = Number.isFinite(power) ? Math.max(0, Math.min(8, power|0)) : 0;
  const x = base + p * 20;
  const min = Math.max(50, x - 100);
  const max = x + 100;
  // inclusive random
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
export function questPassXpRange(template, power) {
  const base = (template && Number.isFinite(template.passXpBase)) ? template.passXpBase : 250;
  const p = Number.isFinite(power) ? Math.max(0, Math.min(8, power|0)) : 0;
  const x = base + p * 20;
  return { x, min: Math.max(50, x - 100), max: x + 100 };
}

// Helper to make reward descriptors
// Each tier has: { tier, title, icon, rewards: [{type,gold/item/aura,amount,name}], extraDesc }
export const PASS_TIERS = [
  { tier: 1, title: "1,000 Gold", icon: "Gold Coin", rewards: [{ type: "gold", amount: 1000 }], extraDesc: "Starter funds for your next unlock." },
  { tier: 2, title: "Amethite Pack", icon: "Amethite Fragment", rewards: [{ type: "item", name: "Amethite Fragment", amount: 5 }], extraDesc: "Craft your first elemental ingot." },
  { tier: 3, title: "Wooden Keys x2", icon: "Wooden Key", rewards: [{ type: "item", name: "Wooden Key", amount: 2 }], extraDesc: "Two common crates on us." },
  { tier: 4, title: "2,500 Gold", icon: "Gold Coin", rewards: [{ type: "gold", amount: 2500 }], extraDesc: "Keep unlocking difficulties." },
  { tier: 5, title: "Iron Bars x10", icon: "Iron Bar", rewards: [{ type: "item", name: "Iron Bar", amount: 10 }], extraDesc: "For your workbench crafts." },
  { tier: 6, title: "Magmasteel Pack", icon: "Magmasteel Fragment", rewards: [{ type: "item", name: "Magmasteel Fragment", amount: 5 }], extraDesc: "Fire-forged material." },
  { tier: 7, title: "Stone Keys x2", icon: "Stone Key", rewards: [{ type: "item", name: "Stone Key", amount: 2 }], extraDesc: "Uncommon crates await." },
  { tier: 8, title: "5,000 Gold", icon: "Gold Coin", rewards: [{ type: "gold", amount: 5000 }], extraDesc: "Big step toward Hard unlocks." },
  { tier: 9, title: "Rubellite Pack", icon: "Rubellite Fragment", rewards: [{ type: "item", name: "Rubellite Fragment", amount: 4 }], extraDesc: "Healing essence." },
  { tier: 10, title: "Iron Keys x2", icon: "Iron Key", rewards: [{ type: "item", name: "Iron Key", amount: 2 }], extraDesc: "Rare crate keys." },
  { tier: 11, title: "8,000 Gold", icon: "Gold Coin", rewards: [{ type: "gold", amount: 8000 }], extraDesc: "For the late-game grind." },
  { tier: 12, title: "Sanguine Shards x3", icon: "Sanguine Shard", rewards: [{ type: "item", name: "Sanguine Shard", amount: 3 }], extraDesc: "Craft lifesteal gear." },
  { tier: 13, title: "Gold Key", icon: "Gold Key", rewards: [{ type: "item", name: "Gold Key", amount: 1 }], extraDesc: "Epic crate key." },
  { tier: 14, title: "Spectral Shards x3", icon: "Spectral Shard", rewards: [{ type: "item", name: "Spectral Shard", amount: 3 }], extraDesc: "Ghost-forged gear." },
  { tier: 15, title: "12,000 Gold", icon: "Gold Coin", rewards: [{ type: "gold", amount: 12000 }], extraDesc: "Almost there." },
  { tier: 16, title: "Diamonds x3", icon: "Diamond", rewards: [{ type: "item", name: "Diamond", amount: 3 }], extraDesc: "Shiny endgame currency." },
  { tier: 17, title: "Geo Shards x2", icon: "Geo Shard", rewards: [{ type: "item", name: "Geo Shard", amount: 2 }], extraDesc: "Earthbound power." },
  { tier: 18, title: "Astral Shards x2", icon: "Astral Shard", rewards: [{ type: "item", name: "Astral Shard", amount: 2 }], extraDesc: "Celestial material." },
  { tier: 19, title: "20,000 Gold + Key", icon: "Gold Coin", rewards: [{ type: "gold", amount: 20000 }, { type: "item", name: "Gold Key", amount: 1 }], extraDesc: "Penultimate haul." },
  { tier: 20, title: "Nova Alloy", icon: "Nova Alloy", rewards: [{ type: "item", name: "Nova Alloy", amount: 1 }], extraDesc: "Ultimate reward — endgame material." },
];

export function tierRequirement(tier) {
  return tier * PASS_XP_PER_TIER;
}
export function totalRequirement() {
  return PASS_MAX_TIER * PASS_XP_PER_TIER;
}
