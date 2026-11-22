/**
 * Daily Quests — configuration
 *
 * - NPC positioned at [5.5,21,4.5] (lobby, never moves)
 * - One quest per day, daily rotation (UTC)
 * - Displayed in sidebar (RightInfoText) with extensible text format
 * - Scaled to player strength: gold, aura/stats, optional equipment
 *
 * Example quest text format (extensible):
 *   { id, title, description(target): string, type, baseTarget, reward(target): {gold, aura, label} }
 *
 * To add a new quest:
 *   1. Add an entry to QUEST_TEMPLATES with a new `id` and `type`
 *   2. If new type, add a handler in quest/service.js (onProgress(type))
 *   3. Done — daily selection picks automatically from the array
 */

export const QUEST_NPC_POS = [5.5, 21, 4.5];
export const QUEST_NPC_NAME = "Quest";
export const QUEST_DB_KEY = "dungeonBreak.quest.daily.v1";
export const QUEST_DONE_KEY = "dungeonBreak.quest.daily.done.v1"; // tracks daily completion streak/reward claim
export const QUEST_NPC_LOOK_INTERVAL_TICKS = 100; // 5s @ 20 TPS
export const QUEST_SIDEBAR_REFRESH_TICKS = 40; // 2s

/**
 * Extensible templates — each entry is an example of a possible quest.
 *
 * `type` determines which event advances the quest:
 *   kill  -> onPlayerKilledMob
 *   crate -> generateChest / crate opened
 *
 * Add a new type = add a hook calling questService.onProgress(playerId, type, amount)
 */
export const QUEST_TEMPLATES = [
  {
    id: "slayer",
    title: "Slayer",
    description: (target) => `Kill ${target} dungeon monsters`,
    detail: (progress, target) => `${progress}/${target} monsters`,
    type: "kill",
    baseTarget: 10,
    reward: (target) => ({
      gold: target * 40,
      aura: Math.max(5, Math.round(target * 1.5)),
      label: `${target * 40} gold · +${Math.max(5, Math.round(target * 1.5))} Aura`,
    }),
    icon: "⚔️",
    color: "#FF5555",
    passXpBase: 250,
  },
  {
    id: "treasure_hunter",
    title: "Treasure Hunter",
    description: (target) => `Open ${target} treasure chests`,
    detail: (progress, target) => `${progress}/${target} chests`,
    type: "crate",
    baseTarget: 3,
    reward: (target) => ({
      gold: target * 80,
      aura: target * 3,
      label: `${target * 80} gold · +${target * 3} Aura`,
    }),
    icon: "🗝️",
    color: "#FFD700",
    passXpBase: 300,
  },
  {
    id: "exterminator",
    title: "Exterminator",
    description: (target) => `Eliminate ${target} hostile creatures`,
    detail: (progress, target) => `${progress}/${target} eliminated`,
    type: "kill",
    baseTarget: 15,
    reward: (target) => ({
      gold: target * 30,
      aura: target * 1,
      label: `${target * 30} gold · +${target} Aura`,
    }),
    icon: "💀",
    color: "#AA00AA",
    passXpBase: 350,
  },
  {
    id: "collector",
    title: "Collector",
    description: (target) => `Loot ${target} ancient chests`,
    detail: (progress, target) => `${progress}/${target} looted`,
    type: "crate",
    baseTarget: 5,
    reward: (target) => ({
      gold: target * 60,
      aura: target * 2,
      label: `${target * 60} gold · +${target * 2} Aura`,
    }),
    icon: "📦",
    color: "#55FFFF",
    passXpBase: 400,
  },
  {
    id: "berserker",
    title: "Berserker",
    description: (target) => `Slay ${target} monsters`,
    detail: (progress, target) => `${progress}/${target} slain`,
    type: "kill",
    baseTarget: 25,
    reward: (target) => ({
      gold: target * 25,
      aura: Math.round(target * 1.2),
      label: `${target * 25} gold · +${Math.round(target * 1.2)} Aura`,
    }),
    icon: "🔥",
    color: "#FF6B00",
    passXpBase: 500,
  },
];

/**
 * Compute player power score to scale quest difficulty.
 * Based on real strength: gold (wealth), aura (level), optional equipment.
 * Returns 0..8 — 0 = beginner, 8 = geared veteran.
 */
export function powerScore(api, playerId, auraLevelFn, getGoldFn) {
  let score = 0;
  // Gold — log10 scale
  try {
    const gold = getGoldFn ? getGoldFn(playerId) : 0;
    if (Number.isFinite(gold) && gold > 0) {
      // 0 gold=0, 100=1, 1k=2, 10k=3, 100k=4, 1M=5
      const goldTier = Math.min(5, Math.floor(Math.log10(Math.max(1, gold)) * 1) - 1);
      score += Math.max(0, goldTier);
    }
  } catch (_) {}
  // Aura level
  try {
    const lvl = auraLevelFn ? auraLevelFn(playerId) : 1;
    if (Number.isFinite(lvl) && lvl > 1) {
      if (lvl >= 36) score += 4;
      else if (lvl >= 21) score += 3;
      else if (lvl >= 13) score += 2;
      else if (lvl >= 6) score += 1;
    }
  } catch (_) {}
  // Optional equipment scan — 0..60 slots
  try {
    if (typeof api.getItemSlot === "function") {
      let bestTier = 0;
      const maxSlot = 60;
      for (let i = 0; i < maxSlot; i++) {
        try {
          const it = api.getItemSlot(playerId, i);
          if (!it || !it.name || it.name === "Air") continue;
          const name = String(it.name);
          const tier = tierOfItem(name);
          if (tier > bestTier) bestTier = tier;
        } catch (_) {}
      }
      if (bestTier >= 5) score += 2;
      else if (bestTier >= 3) score += 1;
    }
  } catch (_) {}
  return Math.min(8, Math.max(0, score));
}

function tierOfItem(name) {
  const tiers = [
    { keys: ["Wood", "Leather"], tier: 0 },
    { keys: ["Stone", "Iron", "Chain"], tier: 1 },
    { keys: ["Amethite", "Magmasteel", "Rubellite", "Serpentite"], tier: 1 },
    { keys: ["Cursemetal", "Kingly"], tier: 2 },
    { keys: ["Sanguine", "Spectral", "Geo"], tier: 3 },
    { keys: ["Astral", "Voltplate"], tier: 4 },
    { keys: ["Moonstone"], tier: 5 },
    { keys: ["Nova"], tier: 6 },
  ];
  for (let i = tiers.length - 1; i >= 0; i--) {
    for (const k of tiers[i].keys) if (name.includes(k)) return tiers[i].tier;
  }
  if (name.includes("Diamond") || name.includes("Gold")) return 2;
  return 0;
}

/**
 * Scaled target based on power.
 * Base + 25% per power point — gentle, doesn't punish new players.
 */
export function scaledTarget(base, power) {
  const mult = 1 + power * 0.25;
  return Math.max(1, Math.round(base * mult));
}

/**
 * Deterministic daily template choice for this player.
 * Same day -> same quest (daily). Uses UTC date + player seed.
 */
export function pickTemplateForToday(playerId, dateStr) {
  const seed = `${dateStr}|${playerId}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const idx = h % QUEST_TEMPLATES.length;
  return QUEST_TEMPLATES[idx];
}

export function findTemplate(id) {
  return QUEST_TEMPLATES.find((t) => t.id === id) || null;
}

export function todayDateUTC() {
  try {
    return new Date().toISOString().slice(0, 10);
  } catch (_) {
    try {
      const ms = typeof api !== "undefined" && typeof api.now === "function" ? api.now() : Date.now();
      return new Date(ms).toISOString().slice(0, 10);
    } catch (_) {
      return "2026-01-01";
    }
  }
}
