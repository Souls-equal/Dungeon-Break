/**
 * combatFx/service.js — visual hooks for weapons/armor
 * - parse heldItem / armor slots → type/set
 * - hit counters → proc every X (visual)
 * - spawn particles + flying message (no middleText)
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
import { handleHit } from "../weapons/service.js";
import { weaponBaseDamage } from "../weapons/config.js";

// Counters: playerId -> { weaponHits: Map<type,count>, armorHits: count, lastProcTick, lastArmorProcTick }
const hitCounters = new Map();
const COOLDOWN_TICKS = 2; // visual anti-spam if engine sends 2 events per hit

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
  const clean = String(itemName).split("|")[0].trim();
  const parts = clean.split(/\s+/);
  if (parts.length < 2) return null;
  const type = parts[parts.length - 1];
  if (!WEAPON_TYPES.includes(type)) return null;
  const setName = parts.slice(0, -1).join(" ");
  if (!WEAPON_SETS_FX[setName]) return null;
  return { type, setName, full: clean };
}

export function parseArmorSet(itemName) {
  if (!itemName || typeof itemName !== "string") return null;
  const clean = String(itemName).split("|")[0].trim();
  const names = Object.keys(ARMOR_SETS_FX).sort((a,b)=> b.length - a.length);
  for (const setName of names) {
    if (clean.startsWith(setName + " ")) return setName;
  }
  return null;
}

export function getEquippedArmorSet(api, playerId) {
  if (!api || !playerId) return null;
  if (typeof api.getItemSlot !== "function") return null;
  const counts = new Map();
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
      if (held && held.name) {
        const info = parseWeaponInfo(held.name);
        if (info) return info;
      }
    }
  } catch (_) {}
  try {
    if (typeof api.getSelectedInventorySlotI === "function" && typeof api.getItemSlot === "function") {
      const idx = api.getSelectedInventorySlotI(playerId);
      if (Number.isFinite(idx) && idx >= 0 && idx < 10) {
        const it = api.getItemSlot(playerId, idx);
        if (it && it.name) {
          const info = parseWeaponInfo(it.name);
          if (info) return info;
        }
      }
    }
  } catch (_) {}
  return null;
}

// ── tick helpers ─────────────────────────────────────────────────────
let globalTick = 0;
export function tickCombatFx() {
  globalTick++;
  if (globalTick % 200 === 0 && hitCounters.size > 200) {
    const keys = [...hitCounters.keys()];
    for (let i = 0; i < keys.length - 100; i++) hitCounters.delete(keys[i]);
  }
}
export function forgetPlayer(playerId) {
  hitCounters.delete(String(playerId));
}

function posOf(api, playerId, fallback) {
  try {
    const p = api.getPosition(playerId);
    if (p && Array.isArray(p) && p.length >= 3) return p;
  } catch (_) {}
  return fallback || [0,0,0];
}

// ── weapon hit — called from onPlayerDamagingMob ─────────────────
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
  try { weaponFx(api, playerPos, type, color, tierScale); } catch (_) {}

  // real elemental ability (PvE) — every hit, not only visual proc
  let abilityResult = null;
  try {
    const base = weaponBaseDamage(info.full) ?? opts.baseDamage ?? 0;
    const scaled = opts.scaledDamage ?? base;
    abilityResult = handleHit(api, playerId, setName, {
      baseDamage: base,
      scaledDamage: scaled,
      tick: globalTick,
      pos: playerPos,
      mobId: opts.mobId,
      type,
    });
  } catch (_) {}

  // visual proc every X hits (independent of ability)
  const every = fxCfg.every;
  const isProc = (count % every === 0);
  if (!isProc) return { type, setName, count, proc: false, ability: abilityResult };

  const lastTick = ctr.lastProcTick.get(type) || -999;
  if (globalTick - lastTick < COOLDOWN_TICKS) return { type, setName, count, proc: false, onCooldown: true, ability: abilityResult };
  ctr.lastProcTick.set(type, globalTick);

  try { weaponProcFx(api, playerPos, type, color, tierScale); } catch (_) {}

  return { type, setName, count, proc: true, color, tierScale, label: fxCfg.label, ability: abilityResult };
}

// ── armor hit — called from onMobDamagingPlayer ───────────────────
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

  const every = fxCfg.every;
  const isProc = (count % every === 0);
  const shouldShimmer = (count % 3 === 0);
  const color = weaponColorFor(setName) || fxCfg.color;
  const tierScale = tierScaleForArmor(setName);
  const playerPos2 = opts.pos || posOf(api, playerId);

  if (shouldShimmer) {
    try { armorShimmer(api, playerPos2, color, tierScale * 0.7); } catch (_) {}
  }
  if (!isProc) return { setName, count, proc: false };
  if (globalTick - (ctr.lastArmorProcTick || -999) < COOLDOWN_TICKS) return { setName, count, proc: false, onCooldown: true };
  ctr.lastArmorProcTick = globalTick;

  try { armorFx(api, playerPos2, color, tierScale); } catch (_) {}
  try {
    if (typeof api.sendFlyingMiddleMessage === "function") {
      api.sendFlyingMiddleMessage(playerId, [{ str: "Guard! ", style:{color} }, { icon: "HealthShield" }], 50, 600);
    }
  } catch (_) {}
  return { setName, count, proc: true, color, tierScale };
}

// ── passive: aura shimmer for full set ─
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
      if (globalTick % 40 !== 0) continue;
      const color = fxCfg.color;
      const tierScale = tierScaleForArmor(armor.setName);
      const p = posOf(api, pid);
      try { armorShimmer(api, p, color, tierScale * 0.9); } catch (_) {}
    } catch (_) {}
  }
}

export function _counters() { return hitCounters; }
export function _reset() { hitCounters.clear(); globalTick = 0; }
export function _setTick(v) { globalTick = v; }
