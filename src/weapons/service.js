/**
 * weapons/service.js — gestion dégâts dynamiques + capacités élémentaires
 * - refreshWeaponStats: met à jour damage stat + description avec dégâts effectifs (base * dealingMultiplier)
 * - tryWeaponAbility: déclenche l'effet du set sur le proc visuel (rend extraDamage à ajouter)
 */

import { WEAPON_BASE_DAMAGE, SET_ABILITIES, abilityForSet, buildDescription, weaponMeta } from "./config.js";

let lastAbilityTick = new Map(); // playerId -> Map<setName, tick>

/**
 * Met à jour toutes les armes pour un joueur donné.
 * Doit être appelé après chaque changement de Blessings (join, roll pick, death, leave).
 * Utilise dealingMultiplierOf passé en param ou recalculé via cache.
 */
export function refreshWeaponStats(api, playerId, dealingMultiplier = 1) {
  if (!api || !playerId || typeof api.setItemStat !== "function") return 0;
  const mult = Number.isFinite(dealingMultiplier) ? dealingMultiplier : 1;
  let ok = 0;
  for (const [weaponName, base] of Object.entries(WEAPON_BASE_DAMAGE)) {
    const effective = Math.max(1, Math.round(base * mult));
    const desc = buildDescription(weaponName, effective);
    try {
      // Le vrai dégât de l'arme — le moteur l'utilisera directement si setItemStat/damage est supporté
      // Sinon notre hook onPlayerDamagingMob fera le scaling en fallback
      api.setItemStat(playerId, weaponName, "damage", effective);
      ok++;
    } catch (_) {}
    if (desc) {
      try { api.setItemStat(playerId, weaponName, "description", desc); ok++; } catch (_) {}
    }
    // Optionnel: knockback / range / cooldown custom par set/tier pourrait être ajouté ici via setItemStat
    // Ex: Magmasteel + knockback, Serpentite + range spear, etc.
    // On garde minimal pour ne pas casser l'équilibrage.
  }
  return ok;
}

/**
 * Tente de déclencher la capacité élémentaire du set sur le proc d'arme.
 * Appelé depuis onWeaponHit quand proc === true (tous les every coups).
 * Retourne { extraDamage, lifesteal, triggered, ability } ou null si rien.
 * Toute erreur API est catchée — jamais de crash tick.
 */
export function tryWeaponAbility(api, playerId, setName, opts = {}) {
  if (!api || !playerId || !setName) return null;
  const ability = abilityForSet(setName);
  if (!ability) return null;

  // chance roll
  if (ability.chance != null && ability.chance < 1) {
    const r = opts.random ? opts.random() : Math.random();
    if (r > ability.chance) return { triggered: false, ability };
  }

  // cooldown anti-spam par set: 20 ticks (1s) minimum entre deux procs capacité
  const COOLDOWN_TICKS = ability.cooldownTicks ?? 20;
  const nowTick = opts.tick ?? 0;
  const key = String(playerId);
  let perPlayer = lastAbilityTick.get(key);
  if (!perPlayer) { perPlayer = new Map(); lastAbilityTick.set(key, perPlayer); }
  const last = perPlayer.get(setName) ?? -9999;
  if (nowTick - last < COOLDOWN_TICKS) return { triggered: false, ability, onCooldown: true };
  perPlayer.set(setName, nowTick);

  let extraDamage = 0;
  const base = opts.baseDamage ?? 0;
  if (Number.isFinite(ability.extraMult) && ability.extraMult > 0) {
    extraDamage += Math.round(base * ability.extraMult);
  }
  if (Number.isFinite(ability.extraFlat) && ability.extraFlat > 0) {
    extraDamage += ability.extraFlat;
  }

  // Buffs joueur (toujours PVE, via applyEffect)
  const buffs = [];
  if (ability.buff) buffs.push(ability.buff);
  if (ability.buff2) buffs.push(ability.buff2);

  for (const b of buffs) {
    try {
      if (!b.effect) continue;
      // On évite d'appliquer Speed en spawn (même règle que blessings)
      // Mais ici c'est en donjon PVE only, donc ok.
      api.applyEffect(playerId, b.effect, b.duration ?? 2000, { inbuiltLevel: b.level ?? 1 });
    } catch (_) {}
  }

  // Lifesteal: on donne Health Regen court (8-10% heal simulé)
  // Le vrai heal via setHealth n'est pas documenté comme fiable, donc on reste sur buff.
  // Si une API heal existe, on tente en plus.
  if (ability.lifesteal) {
    try {
      // Tentative heal direct si disponible (certains forks Bloxd ont api.healEntity / setHealth)
      if (typeof api.healEntity === "function" && Number.isFinite(opts.scaledDamage)) {
        const healAmt = Math.max(1, Math.round(opts.scaledDamage * ability.lifesteal));
        try { api.healEntity(playerId, healAmt); } catch (_) {}
      } else if (typeof api.setHealth === "function" && typeof api.getHealth === "function") {
        try {
          const cur = api.getHealth(playerId);
          const max = api.getMaxHealth ? api.getMaxHealth(playerId) : null;
          if (Number.isFinite(cur)) {
            const healAmt = Math.max(1, Math.round((opts.scaledDamage ?? 10) * ability.lifesteal));
            const next = max ? Math.min(max, cur + healAmt) : cur + healAmt;
            api.setHealth(playerId, next);
          }
        } catch (_) {}
      }
      // Le buff Health Regen ci-dessus fait déjà visuellement le heal
    } catch (_) {}
  }

  // Message visuel léger sur proc capacité (pas spam chat)
  try {
    if (typeof api.queueMiddleTextUpper === "function" && ability.name) {
      // On affiche le nom de la capacité en couleur du set
      api.queueMiddleTextUpper(playerId, [{ str: ability.name + "!", style: { color: ability.color || "#FFFFFF" } }], 900);
    }
  } catch (_) {}

  return { triggered: true, ability, extraDamage, lifesteal: ability.lifesteal ?? 0 };
}

export function forgetPlayer(playerId) {
  lastAbilityTick.delete(String(playerId));
}

export function _reset() { lastAbilityTick.clear(); }
export function _setTick(v) { /* compat */ }

export function _getLastAbilityTickMap() { return lastAbilityTick; }
