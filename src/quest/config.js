/**
 * Quêtes quotidiennes — configuration
 *
 * - NPC positionné en [5.5,21,4.5] (lobby stable, ne bouge jamais)
 * - Une quête par jour, rotation quotidienne (UTC)
 * - Affichée dans la sidebar (RightInfoText) avec format texte extensible
 * - Adaptée à la force du joueur: or, aura/stats, équipement (optionnel)
 *
 * Exemple de format texte (extensible):
 *   { id, title, description(target): string, type, baseTarget, reward(target): {gold, aura, label} }
 *
 * Pour ajouter une quête:
 *   1. Ajouter une entrée dans QUEST_TEMPLATES avec un nouveau `id` et `type`
 *   2. Si nouveau type, ajouter le handler dans quest/service.js (onProgress(type))
 *   3. C'est tout — la sélection quotidienne pioche automatiquement dans le tableau
 */

export const QUEST_NPC_POS = [5.5, 21, 4.5];
export const QUEST_NPC_NAME = "§6Maître des Quêtes";
export const QUEST_DB_KEY = "dungeonBreak.quest.daily.v1";
export const QUEST_DONE_KEY = "dungeonBreak.quest.daily.done.v1"; // tracks daily completion streak/reward claim
export const QUEST_NPC_LOOK_INTERVAL_TICKS = 100; // 5s @ 20 TPS
export const QUEST_SIDEBAR_REFRESH_TICKS = 40; // 2s

/**
 * Templates extensibles — chaque entrée est un exemple de quête possible.
 *
 * `type` détermine quel événement fait progresser la quête:
 *   kill  -> onPlayerKilledMob
 *   crate -> generateChest / crate ouvert
 *
 * Ajouter un type = ajouter un hook qui appelle questService.onProgress(playerId, type, amount)
 */
export const QUEST_TEMPLATES = [
  {
    id: "slayer",
    title: "Chasseur",
    // description reçoit le target scalé pour le joueur
    description: (target) => `Tuer ${target} monstres du Donjon`,
    detail: (progress, target) => `${progress}/${target} monstres`,
    type: "kill",
    baseTarget: 10,
    // Récompense scalée sur le target (donc indirectement sur la puissance)
    reward: (target) => ({
      gold: target * 40,
      aura: Math.max(5, Math.round(target * 1.5)),
      label: `${target * 40} or · +${Math.max(5, Math.round(target * 1.5))} Aura`,
    }),
    icon: "⚔️",
    color: "#FF5555",
  },
  {
    id: "treasure_hunter",
    title: "Chasseur de Trésors",
    description: (target) => `Ouvrir ${target} coffres au trésor`,
    detail: (progress, target) => `${progress}/${target} coffres`,
    type: "crate",
    baseTarget: 3,
    reward: (target) => ({
      gold: target * 80,
      aura: target * 3,
      label: `${target * 80} or · +${target * 3} Aura`,
    }),
    icon: "🗝️",
    color: "#FFD700",
  },
  {
    id: "exterminator",
    title: "Exterminateur",
    description: (target) => `Éliminer ${target} créatures hostiles`,
    detail: (progress, target) => `${progress}/${target} éliminées`,
    type: "kill",
    baseTarget: 15,
    reward: (target) => ({
      gold: target * 30,
      aura: target * 1,
      label: `${target * 30} or · +${target} Aura`,
    }),
    icon: "💀",
    color: "#AA00AA",
  },
  {
    id: "collector",
    title: "Collectionneur",
    description: (target) => `Piller ${target} coffres anciens`,
    detail: (progress, target) => `${progress}/${target} pillés`,
    type: "crate",
    baseTarget: 5,
    reward: (target) => ({
      gold: target * 60,
      aura: target * 2,
      label: `${target * 60} or · +${target * 2} Aura`,
    }),
    icon: "📦",
    color: "#55FFFF",
  },
  {
    id: "berserker",
    title: "Berserker",
    description: (target) => `Massacrer ${target} monstres`,
    detail: (progress, target) => `${progress}/${target} massacrés`,
    type: "kill",
    baseTarget: 25,
    reward: (target) => ({
      gold: target * 25,
      aura: Math.round(target * 1.2),
      label: `${target * 25} or · +${Math.round(target * 1.2)} Aura`,
    }),
    icon: "🔥",
    color: "#FF6B00",
  },
];

/**
 * Calcule le score de puissance d'un joueur pour scaler la quête.
 *
 * Adapté à la force réelle: or (richesse), aura (niveau), équipement (optionnel).
 * Retourne 0..6 environ — 0 = débutant, 6 = vétéran chargé.
 */
export function powerScore(api, playerId, auraLevelFn, getGoldFn) {
  let score = 0;
  // Or — échelle log10
  try {
    const gold = getGoldFn ? getGoldFn(playerId) : 0;
    if (Number.isFinite(gold) && gold > 0) {
      // 0 gold=0, 100=1, 1k=2, 10k=3, 100k=4, 1M=5
      const goldTier = Math.min(5, Math.floor(Math.log10(Math.max(1, gold)) * 1) - 1);
      // clamp: <100 =>0
      score += Math.max(0, goldTier);
    }
  } catch (_) {}
  // Aura / niveau
  try {
    const lvl = auraLevelFn ? auraLevelFn(playerId) : 1;
    if (Number.isFinite(lvl) && lvl > 1) {
      // 1-5 =>0, 6-12=>1, 13-20=>2, 21-35=>3, 36+=>4
      if (lvl >= 36) score += 4;
      else if (lvl >= 21) score += 3;
      else if (lvl >= 13) score += 2;
      else if (lvl >= 6) score += 1;
    }
  } catch (_) {}
  // Équipement (optionnel) — scan 0..10 hotbar + inventory si dispo
  try {
    if (typeof api.getItemSlot === "function") {
      let bestTier = 0;
      // check hotbar 0..9 + inventory extended if present
      const maxSlot = 60;
      for (let i = 0; i < maxSlot; i++) {
        try {
          const it = api.getItemSlot(playerId, i);
          if (!it || !it.name || it.name === "Air") continue;
          const name = String(it.name);
          // tier detection via known sets (extensible — ajout de sets auto-supporté)
          const tier = tierOfItem(name);
          if (tier > bestTier) bestTier = tier;
        } catch (_) {}
      }
      // bestTier 0..6 => contribution 0..2
      if (bestTier >= 5) score += 2;
      else if (bestTier >= 3) score += 1;
    }
  } catch (_) {}
  return Math.min(8, Math.max(0, score));
}

function tierOfItem(name) {
  // Map weapon/armor set name presence → tier 1..6
  // Extensible: ajouter un set ici augmente automatiquement la détection
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
  // also check Diamond/Gold/Netherite as mid tiers
  if (name.includes("Diamond") || name.includes("Gold")) return 2;
  return 0;
}

/**
 * Target scalé selon puissance.
 * base 10 + power*multiplier — doux, ne punit pas les nouveaux.
 */
export function scaledTarget(base, power) {
  // +25% par point de puissance, arrondi
  const mult = 1 + power * 0.25;
  return Math.max(1, Math.round(base * mult));
}

/**
 * Choix déterministe du template du jour pour ce joueur.
 * Même jour → même quête (daily). Utilise date UTC + player seed.
 */
export function pickTemplateForToday(playerId, dateStr) {
  // simple hash: sum charCodes of date + playerId modulo templates length
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
    // Bloxd server has Date
    return new Date().toISOString().slice(0, 10);
  } catch (_) {
    // fallback: use api.now if Date unavailable
    try {
      const ms = typeof api !== "undefined" && typeof api.now === "function" ? api.now() : Date.now();
      return new Date(ms).toISOString().slice(0, 10);
    } catch (_) {
      return "2026-01-01";
    }
  }
}
