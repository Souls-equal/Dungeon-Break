/**
 * combatFx/service.js — hooks visuels armes/armures
 * - parse heldItem / armor slots → type/set
 * - compteurs de coups → proc tous les X
 * - spawn particules + middle text cooldown visuel
 */
import {
  WEAPON_TYPES,
  WEAPON_FX,
  WEAPON_SETS_FX,
  ARMOR_SETS_FX,
  weaponColorFor,
  tierScaleForWeaponType,
  tierScaleForArmor,
} from "./config.js";
import { spawn as spawnParticles, weaponFx, weaponProcFx, armorFx, armorShimmer } from "../particles/service.js";
import { tryWeaponAbility } from "../weapons/service.js";
import { weaponBaseDamage } from "../weapons/config.js";

// Compteurs: playerId -> { weaponHits: Map<type,count>, armorHits: count, lastProcTick, lastArmorProcTick }
const hitCounters = new Map();
const COOLDOWN_TICKS = 2; // anti-spam visuel si le moteur envoie 2 events par hit

function countersFor(playerId) {
  const k = String(playerId);
  let c = hitCounters.get(k);
  if (!c) {
    c = { weaponHits: new Map(), armorHits: 0, lastProcTick: new Map(), lastArmorProcTick: 0, tick: 0 };
    hitCounters.set(k, c);
  }
  return c;
}

// ── parsing ───────────────────────────────────────────────────────────
export function parseWeaponInfo(itemName) {
  if (!itemName || typeof itemName !== "string") return null;
  // itemName = "Amethite Sword", "Sanguine Staff", etc.
  // type = dernier mot
  const parts = String(itemName).trim().split(/\s+/);
  if (parts.length < 2) return null;
  const type = parts[parts.length - 1];
  if (!WEAPON_TYPES.includes(type)) return null;
  const setName = parts.slice(0, -1).join(" ");
  if (!WEAPON_SETS_FX[setName]) return null;
  return { type, setName, full: itemName };
}

export function parseArmorSet(itemName) {
  if (!itemName || typeof itemName !== "string") return null;
  // "Amethite Helmet", "Kingly Amethite Chestplate", "Spectral Leggings", etc.
  // On teste les sets connus par préfixe le plus long d'abord
  const names = Object.keys(ARMOR_SETS_FX).sort((a,b)=> b.length - a.length);
  for (const setName of names) {
    if (String(itemName).startsWith(setName + " ")) return setName;
  }
  return null;
}

// armor slots Bloxd: 47 Helmet, 48 Chestplate, 49 Gauntlets, 50 Leggings, 51 Boots (5 pièces)
// (ordre réel peut varier légèrement selon versions — on scanne 47-51 inclusif)
export function getEquippedArmorSet(api, playerId) {
  if (!api || !playerId) return null;
  if (typeof api.getItemSlot !== "function") return null;
  const counts = new Map(); // setName -> pièces
  let total = 0;
  for (let slot = 47; slot <= 51; slot++) {
    try {
      const item = api.getItemSlot(playerId, slot);
      if (!item || !item.name || item.name === "Air") continue;
      const setName = parseArmorSet(item.name);
      if (!setName) continue;
      counts.set(setName, (counts.get(setName) || 0) + 1);
      total++;
    } catch (_) {}
  }
  if (total === 0) return null;
  // dominant set (le plus de pièces) — full set = 5, sinon 3-4 suffit pour l'effet
  let best = null, bestCount = 0;
  for (const [setName, n] of counts) {
    if (n > bestCount) { best = setName; bestCount = n; }
  }
  if (!best) return null;
  return { setName: best, pieces: bestCount, total, fullSet: bestCount >= 5 || (bestCount >= 4 && total >= 4) };
}

export function getHeldWeaponInfo(api, playerId) {
  if (!api || !playerId) return null;
  try {
    if (typeof api.getHeldItem === "function") {
      const held = api.getHeldItem(playerId);
      if (held && held.name) return parseWeaponInfo(held.name);
    }
  } catch (_) {}
  // fallback: try selected slot via getItemSlot(getSelectedInventorySlotI)
  try {
    if (typeof api.getSelectedInventorySlotI === "function" && typeof api.getItemSlot === "function") {
      const idx = api.getSelectedInventorySlotI(playerId);
      if (Number.isFinite(idx) && idx >= 0 && idx < 10) {
        const it = api.getItemSlot(playerId, idx);
        if (it && it.name) return parseWeaponInfo(it.name);
      }
    }
  } catch (_) {}
  return null;
}

// ── tick helpers ─────────────────────────────────────────────────────
let globalTick = 0;
export function tickCombatFx() {
  globalTick++;
  // nettoyage léger tous les 20 ticks: pas besoin de garder les joueurs partis indéfiniment — max 200 entrées
  if (globalTick % 200 === 0 && hitCounters.size > 200) {
    // garde les 100 plus récents (on ne sait pas lesquels sont actifs sans api.getPlayerIds, donc on coupe arbitrairement)
    const keys = [...hitCounters.keys()];
    for (let i = 0; i < keys.length - 100; i++) hitCounters.delete(keys[i]);
  }
}
export function forgetPlayer(playerId) {
  hitCounters.delete(String(playerId));
}

// ── position helper ──────────────────────────────────────────────────
function posOf(api, playerId, fallback) {
  try {
    const p = api.getPosition(playerId);
    if (p && Array.isArray(p) && p.length >= 3) return p;
  } catch (_) {}
  return fallback || [0,0,0];
}

// ── weapon hit — appelé depuis onPlayerDamagingMob ─────────────────
export function onWeaponHit(api, playerId, opts = {}) {
  if (!api || !playerId) return null;
  const info = getHeldWeaponInfo(api, playerId);
  if (!info) return null;

  const { type, setName } = info;
  const fxCfg = WEAPON_FX[type];
  if (!fxCfg) return null;
  const ctr = countersFor(playerId);
  const count = (ctr.weaponHits.get(type) || 0) + 1;
  ctr.weaponHits.set(type, count);

  const color = weaponColorFor(setName);
  const tierScale = tierScaleForWeaponType(type, setName);
  const playerPos = opts.pos || posOf(api, playerId);
  // toujours un petit hit visible
  try { weaponFx(api, playerPos, type, color, tierScale); } catch (_) {}

  const every = fxCfg.every;
  const isProc = (count % every === 0);
  if (!isProc) return { type, setName, count, proc: false };

  // cooldown visuel: évite double proc si le moteur envoie 2 events pour 1 coup
  const lastTick = ctr.lastProcTick.get(type) || -999;
  if (globalTick - lastTick < COOLDOWN_TICKS) return { type, setName, count, proc: false, onCooldown: true };
  ctr.lastProcTick.set(type, globalTick);

  // gros effet proc
  try { weaponProcFx(api, playerPos, type, color, tierScale); } catch (_) {}

  // capacité élémentaire du set (vrai effet PVE)
  let abilityResult = null;
  try {
    const base = weaponBaseDamage(info.full) ?? opts.baseDamage ?? 0;
    const scaled = opts.scaledDamage ?? base;
    abilityResult = tryWeaponAbility(api, playerId, setName, {
      baseDamage: base,
      scaledDamage: scaled,
      tick: globalTick,
      pos: playerPos,
      type,
    });
  } catch (_) {}

  // cooldown visuel: petit texte middle — si capacité a déjà affiché, on saute le label générique
  if (!abilityResult || !abilityResult.triggered) {
    try {
      if (typeof api.queueMiddleTextUpper === "function") {
        const label = fxCfg.label;
        api.queueMiddleTextUpper(playerId, [{ str: label + "!", style: { color } }], 700);
      }
    } catch (_) {}
  }

  return { type, setName, count, proc: true, color, tierScale, label: fxCfg.label, ability: abilityResult };
}

// ── armor hit — appelé depuis onMobDamagingPlayer ───────────────────
export function onArmorHit(api, playerId, opts = {}) {
  if (!api || !playerId) return null;
  const armor = getEquippedArmorSet(api, playerId);
  if (!armor) return null;
  const { setName } = armor;
  const fxCfg = ARMOR_SETS_FX[setName];
  if (!fxCfg) return null;

  const ctr = countersFor(playerId);
  const count = (ctr.armorHits || 0) + 1;
  ctr.armorHits = count;

  const every = fxCfg.every; // tier 1 toutes les 5 frappes, tier 4 toutes les 2
  const isProc = (count % every === 0);
  // shimmer léger toujours (rare pour ne pas spammer)
  const shouldShimmer = (count % 3 === 0);
  const color = weaponColorFor(setName) || fxCfg.color;
  const tierScale = tierScaleForArmor(setName);
  const playerPos = opts.pos || posOf(api, playerId);

  if (shouldShimmer) {
    try { armorShimmer(api, playerPos, color, tierScale * 0.7); } catch (_) {}
  }
  if (!isProc) return { setName, count, proc: false };
  if (globalTick - (ctr.lastArmorProcTick || -999) < COOLDOWN_TICKS) return { setName, count, proc: false, onCooldown: true };
  ctr.lastArmorProcTick = globalTick;

  try { armorFx(api, playerPos, color, tierScale); } catch (_) {}
  try {
    if (typeof api.queueMiddleTextUpper === "function") {
      api.queueMiddleTextUpper(playerId, [{ str: "Guard!", style: { color } }], 600);
    }
  } catch (_) {}
  return { setName, count, proc: true, color, tierScale };
}

// ── passif: shimmer d'aura pour full set (à appeler périodiquement) ─
export function tickArmorShimmer(api) {
  if (!api || typeof api.getPlayerIds !== "function") return;
  let ids = [];
  try { ids = api.getPlayerIds(); } catch (_) { return; }
  if (!Array.isArray(ids) || ids.length === 0) return;
  for (const pid of ids) {
    try {
      const armor = getEquippedArmorSet(api, pid);
      if (!armor || !armor.fullSet) continue;
      const fxCfg = ARMOR_SETS_FX[armor.setName];
      if (!fxCfg) continue;
      // seulement tous les ~2 sec (40 ticks) pour ne pas spammer
      if (globalTick % 40 !== 0) continue;
      const color = fxCfg.color;
      const tierScale = tierScaleForArmor(armor.setName);
      const p = posOf(api, pid);
      try { armorShimmer(api, p, color, tierScale * 0.9); } catch (_) {}
    } catch (_) {}
  }
}

// Pour tests
export function _counters() { return hitCounters; }
export function _reset() { hitCounters.clear(); globalTick = 0; }
export function _setTick(v) { globalTick = v; }
