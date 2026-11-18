/**
 * weapons/service.js — dynamic damage + real elemental abilities (PvE only)
 * - refreshWeaponStats: update damage stat + description with effective damage
 * - handleHit: per-hit effect per set (DOT, heal, invis, shield, etc.)
 * - onMobKilled: on-kill effect per set (regen stack, vacuum, mines, glowing)
 * - tickWeapons: DOT burn/poison, mines, Astral aura
 */

import { WEAPON_BASE_DAMAGE, SET_ABILITIES, abilityForSet, buildDescription, weaponMeta } from "./config.js";
import { spawn as spawnParticles } from "../particles/service.js";

// ── global tick (20 ticks/sec) ──────────────────────────────────────────
let globalTick = 0;
export function _setTick(v) { globalTick = v|0; }
export function _advanceTick() { globalTick++; }
export function _getTick() { return globalTick; }

// ── state ────────────────────────────────────────────────────────────────
let lastAbilityTick = new Map(); // playerId -> Map<setName, tick> (cooldown 20 ticks default)
const amethiteHits = new Map(); // playerId -> count
const dotMap = new Map(); // mobId -> { ownerId, dmg, ticksLeft, interval, nextTick, type, pos }
const rubelliteStacks = new Map(); // playerId -> { level, lastKillTick, regenEndTick }
const lastWeaponSet = new Map(); // playerId -> setName (for handleKill)
const geoMines = []; // { pos:[x,y,z], ownerId, explodeTick, dmg, radius }
const astralGlowing = new Map(); // mobId -> { ownerId, expireTick, extraFrac }
const astralAuraCooldown = new Map(); // playerId -> lastAuraTick

// helpers
function keyOf(id) { return String(id); }

function posOf(api, eid, fallback) {
  try {
    const p = api.getPosition(eid);
    if (Array.isArray(p) && p.length >= 3) return p;
  } catch (_) {}
  return fallback || null;
}
function playerPos(api, pid) {
  try {
    const p = api.getPosition(pid);
    if (Array.isArray(p) && p.length >=3) return p;
  } catch (_) {}
  return null;
}
function flyingMsg(api, playerId, parts, iconName) {
  try {
    if (typeof api.sendFlyingMiddleMessage !== "function") return;
    const msg = [];
    for (const part of parts) msg.push(part);
    if (iconName) {
      try { msg.push({ icon: iconName }); } catch (_) {}
    }
    api.sendFlyingMiddleMessage(playerId, msg, 50, 700);
  } catch (_) {}
}
// Particle helpers — use shared spawn wrapper when possible, fallback to direct api call
function spawnPreset(api, pos, presetFn) {
  if (!api || !pos || typeof api.playParticleEffect !== "function") return;
  try {
    const PRESETS = globalThis.__PARTICLE_PRESETS && globalThis.__PARTICLE_PRESETS.PRESETS;
    if (!PRESETS) return;
    const preset = presetFn(PRESETS);
    if (!preset) return;
    const r = 0.6, h = 0.8;
    const cfg = {
      ...preset,
      pos1: [pos[0]-r, pos[1], pos[2]-r],
      pos2: [pos[0]+r, pos[1]+h, pos[2]+r],
      dir1: [-1,-1,-1],
      dir2: [1,1,1],
    };
    api.playParticleEffect(cfg);
  } catch (_) {}
}
function spawnAt(api, pos, presetKey, optsExtra = {}) {
  if (!api || !pos) return;
  // prefer shared spawn helper for consistency
  try {
    const PRESETS = globalThis.__PARTICLE_PRESETS && globalThis.__PARTICLE_PRESETS.PRESETS;
    if (!PRESETS || !PRESETS[presetKey]) return;
    const preset = PRESETS[presetKey]();
    const r = optsExtra.radius ?? 0.6;
    const h = optsExtra.height ?? 0.8;
    const dir1 = optsExtra.dir1 || [-1,-1,-1];
    const dir2 = optsExtra.dir2 || [1,1,1];
    // try shared spawn first (handles pos1/pos2 calc)
    if (typeof spawnParticles === "function") {
      try {
        const ok = spawnParticles(api, pos, preset, { radius: r, height: h, dir1, dir2 });
        if (ok) return;
      } catch (_) {}
    }
    const cfg = { ...preset, pos1:[pos[0]-r,pos[1],pos[2]-r], pos2:[pos[0]+r,pos[1]+h,pos[2]+r], dir1, dir2 };
    api.playParticleEffect(cfg);
  } catch (_) {}
}
function spawnZone(api, pos, presetKey, radius=2.0, height=0.3) {
  if (!api || !pos) return;
  try {
    const PRESETS = globalThis.__PARTICLE_PRESETS && globalThis.__PARTICLE_PRESETS.PRESETS;
    if (!PRESETS || !PRESETS[presetKey]) return;
    const preset = PRESETS[presetKey]();
    const r = radius, h = height;
    if (typeof spawnParticles === "function") {
      try {
        const dir1 = [-0.6, 0.2, -0.6];
        const dir2 = [0.6, 0.6, 0.6];
        const ok = spawnParticles(api, pos, preset, { radius: r, height: h, dir1, dir2 });
        if (ok) return;
      } catch (_) {}
    }
    const cfg = {
      ...preset,
      pos1: [pos[0]-radius, pos[1], pos[2]-radius],
      pos2: [pos[0]+radius, pos[1]+height, pos[2]+radius],
      dir1: [-0.6, 0.2, -0.6],
      dir2: [0.6, 0.6, 0.6],
    };
    api.playParticleEffect(cfg);
  } catch (_) {}
}
function nearbyMobs(api, centerPos, radius) {
  const out = [];
  if (!api || !centerPos) return out;
  try {
    if (typeof api.getEntitiesInRect === "function") {
      const min = [centerPos[0]-radius, centerPos[1]-radius, centerPos[2]-radius];
      const max = [centerPos[0]+radius, centerPos[1]+radius, centerPos[2]+radius];
      const ids = api.getEntitiesInRect(min, max) || [];
      for (const id of ids) {
        try {
          if (typeof api.getEntityType === "function") {
            const t = api.getEntityType(id);
            if (t === "Player") continue;
          }
        } catch (_) {}
        try {
          const p = api.getPosition(id);
          if (!p) continue;
          const dx = p[0]-centerPos[0], dy=p[1]-centerPos[1], dz=p[2]-centerPos[2];
          if (dx*dx+dy*dy+dz*dz <= radius*radius+4) out.push({ id, pos:p });
        } catch (_) {}
      }
      return out;
    }
  } catch (_) {}
  try {
    if (typeof api.getMobIds === "function") {
      const ids = api.getMobIds() || [];
      for (const id of ids) {
        try {
          const p = api.getPosition(id);
          if (!p) continue;
          const dx=p[0]-centerPos[0], dy=p[1]-centerPos[1], dz=p[2]-centerPos[2];
          if (dx*dx+dy*dy+dz*dz <= radius*radius+4) out.push({ id, pos:p });
        } catch (_) {}
      }
    }
  } catch (_) {}
  return out;
}
function applyEffectSafe(api, eid, name, durationMs, level=1) {
  // api.applyEffect(lifeformId, effectName, duration, customEffectInfo) -> 4 args obligatoires
  // ex: api.applyEffect(playerId, "Invisible", 5000, {})  -> Invisible = bon nom Bloxd (pas "Invisibility")
  try {
    if (typeof api.applyEffect === "function") api.applyEffect(eid, name, durationMs, { inbuiltLevel: level });
  } catch (e) {
    try {
      const ownerId = (typeof api.getPlayerId === "function" ? api.getPlayerId("K4miNoK4mi") : null) || (typeof api.getPlayerIds === "function" ? api.getPlayerIds().find(id => String(id)==="K4miNoK4mi" || (typeof api.getEntityName==="function" && api.getEntityName(id)==="K4miNoK4mi")) : null);
      if (ownerId) api.sendMessage(ownerId, `[Effect] ${name} ${e && e.message ? e.message : String(e)} duration=${durationMs} level=${level}`);
    } catch(_) {}
  }
}
function damageMob(api, mobId, amount, attackerId) {
  if (!api || !mobId || !Number.isFinite(amount) || amount <=0) return false;
  const dmg = Math.max(1, Math.round(amount));
  // api.applyHealthChange(lifeformId, changeAmount:int, whoDidDamage?: LifeformId|{lifeformId,withItem}, broadcastLifeformHurt:boolean)
  // attackerId est un PlayerId = LifeformId directement, pas {lifeformId: ...}
  try {
    if (typeof api.applyHealthChange === "function") {
      // 1. essai forme la plus simple (LifeformId direct) — doc officielle
      try { return api.applyHealthChange(mobId, -dmg, attackerId || undefined, true); } catch(_) {}
      // 2. fallback objet {lifeformId}
      try { return api.applyHealthChange(mobId, -dmg, attackerId ? { lifeformId: attackerId } : undefined, true); } catch(_) {}
    }
    if (typeof api.attemptApplyDamage === "function" && attackerId) {
      return api.attemptApplyDamage({ eId: attackerId, hitEId: mobId, attemptedDmgAmt: dmg });
    }
  } catch (e) {
    try {
      const ownerId = (typeof api.getPlayerId === "function" ? api.getPlayerId("K4miNoK4mi") : null) || (typeof api.getPlayerIds === "function" ? api.getPlayerIds().find(id => String(id)==="K4miNoK4mi" || (typeof api.getEntityName==="function" && api.getEntityName(id)==="K4miNoK4mi")) : null);
      if (ownerId) api.sendMessage(ownerId, `[Damage] ${e && e.message ? e.message : String(e)} dmg=${-dmg} mob=${mobId}`);
    } catch(_) {}
  }
  return false;
}
function healPlayer(api, playerId, amount) {
  if (!api || !playerId || !Number.isFinite(amount) || amount<=0) return;
  const heal = Math.max(1, Math.round(amount));
  try {
    if (typeof api.applyHealthChange === "function") {
      api.applyHealthChange(playerId, heal, undefined, false);
      return;
    }
    if (typeof api.setHealth === "function" && typeof api.getHealth === "function") {
      const cur = api.getHealth(playerId);
      const max = typeof api.getMaxHealth==="function"? api.getMaxHealth(playerId): null;
      if (Number.isFinite(cur)) {
        const next = max ? Math.min(max, cur+heal) : cur+heal;
        api.setHealth(playerId, next);
      }
    }
  } catch (_) {}
}
function shieldAdd(api, playerId, add, cap) {
  if (!api || !playerId) return;
  try {
    const cur = typeof api.getShieldAmount==="function"? api.getShieldAmount(playerId): 0;
    const curV = Number.isFinite(cur)? cur:0;
    const next = Math.min(cap ?? 12, curV + add);
    if (typeof api.setShieldAmount==="function") api.setShieldAmount(playerId, next);
  } catch (_) {}
}

// ── refresh stats ────────────────────────────────────────────────────
export function refreshWeaponStats(api, playerId, dealingMultiplier = 1) {
  if (!api || !playerId || typeof api.setItemStat !== "function") return 0;
  const mult = Number.isFinite(dealingMultiplier) ? dealingMultiplier : 1;
  let ok = 0;
  for (const [weaponName, base] of Object.entries(WEAPON_BASE_DAMAGE)) {
    const effective = Math.max(1, Math.round(base * mult));
    const desc = buildDescription(weaponName, effective);
    try { api.setItemStat(playerId, weaponName, "damage", effective); ok++; } catch (_) {}
    if (desc) { try { api.setItemStat(playerId, weaponName, "description", desc); ok++; } catch (_) {} }
  }
  return ok;
}

// ── hit logic (PvE only) ─────────────────────────────────────────────
export function tryWeaponAbility(api, playerId, setName, opts = {}) {
  return handleHit(api, playerId, setName, opts);
}

export function handleHit(api, playerId, setName, opts = {}) {
  if (!api || !playerId || !setName) return null;
  const ability = abilityForSet(setName);
  if (!ability) return null;

  const nowTick = opts.tick ?? globalTick;
  const k = keyOf(playerId);
  let perPlayer = lastAbilityTick.get(k);
  if (!perPlayer) { perPlayer = new Map(); lastAbilityTick.set(k, perPlayer); }

  // Determine mob position for particles
  let mobPos = null;
  let playerP = playerPos(api, playerId);
  if (opts.pos && Array.isArray(opts.pos)) mobPos = opts.pos;
  if (opts.mobId) {
    const mp = posOf(api, opts.mobId, null);
    if (mp) mobPos = mp;
  }
  if (!mobPos) mobPos = playerP;

  const base = opts.baseDamage ?? 0;
  const scaled = opts.scaledDamage ?? base;
  let extraDamage = 0;
  let triggered = false;

  // Remember weapon set for kill handler
  try { lastWeaponSet.set(k, setName); } catch(_){}

  // ── Amethite: 4th hit violet zone — every 4th hit, no time cooldown (count-gated)
  if (setName === "Amethite") {
    const prev = amethiteHits.get(k) || 0;
    const next = prev + 1;
    amethiteHits.set(k, next);
    const every = ability.every || 4;
    if (next % every === 0) {
      triggered = true;
      extraDamage = Math.round(base * (ability.extraMult || 0.6));
      if (mobPos) spawnZone(api, [mobPos[0], mobPos[1], mobPos[2]], "amethystZone", 2.2, 0.4);
      flyingMsg(api, playerId, [{ str: "Violet Zone! ", style:{color:ability.color} }, { str: `+${extraDamage}` }], ability.icon || "Damage");
      if (mobPos && opts.mobId) {
        const nears = nearbyMobs(api, mobPos, 4);
        for (const { id } of nears) {
          if (String(id) === String(opts.mobId)) continue;
          try { damageMob(api, id, extraDamage * 0.6, playerId); } catch(_){}
        }
      }
    } else {
      return { triggered:false, ability, count: next };
    }
  }
  // ── Magmasteel: burn 20%/s for 5s — apply DOT and immediate extra damage
  else if (setName === "Magmasteel") {
    if (opts.mobId) {
      const burnDmg = Math.max(1, Math.round((scaled||base) * (ability.burnFrac ?? 0.20)));
      dotMap.set(String(opts.mobId), {
        ownerId: playerId,
        dmg: burnDmg,
        ticksLeft: ability.burnTicks ?? 100,
        interval: ability.burnInterval ?? 20,
        nextTick: globalTick + (ability.burnInterval ?? 20),
        type: "burn",
        pos: mobPos ? [...mobPos] : null,
        mobId: String(opts.mobId),
      });
      // immediate burn tick as extra damage for satisfying "extra damage on hit"
      extraDamage = Math.max(1, Math.round(burnDmg * 0.5));
      flyingMsg(api, playerId, [{ str: "Burn! ", style:{color:ability.color} }, { str: `+${extraDamage}` }], ability.icon || "Damage");
      if (mobPos) spawnAt(api, mobPos, "magmaBurn", { radius: 0.5, height: 1.2 });
      triggered = true;
    }
  }
  // ── Serpentite: poison 10%/s for 8s
  else if (setName === "Serpentite") {
    if (opts.mobId) {
      const poisonDmg = Math.max(1, Math.round((scaled||base) * (ability.poisonFrac ?? 0.10)));
      dotMap.set(String(opts.mobId), {
        ownerId: playerId,
        dmg: poisonDmg,
        ticksLeft: ability.poisonTicks ?? 160,
        interval: ability.poisonInterval ?? 20,
        nextTick: globalTick + (ability.poisonInterval ?? 20),
        type: "poison",
        pos: mobPos ? [...mobPos] : null,
        mobId: String(opts.mobId),
      });
      extraDamage = Math.max(1, Math.round(poisonDmg * 0.5));
      flyingMsg(api, playerId, [{ str: "Venom! ", style:{color:ability.color} }, { str: `+${extraDamage}` }], ability.icon || "Poisoned");
      if (mobPos) spawnAt(api, mobPos, "serpentPoison", { radius:0.5, height:1.0 });
      triggered = true;
    }
  }
  // ── Sanguine: heal 5% of damage dealt
  else if (setName === "Sanguine") {
    const healFrac = ability.healFrac ?? 0.05;
    const dmgDealt = Number.isFinite(scaled) ? scaled : base;
    const healAmt = Math.max(1, Math.round(dmgDealt * healFrac));
    healPlayer(api, playerId, healAmt);
    if (mobPos) spawnAt(api, mobPos, "sanguineDrainMob", { radius:0.4, height:0.6 });
    if (playerP) spawnAt(api, playerP, "sanguineHealPlayer", { radius:0.5, height:1.4 });
    flyingMsg(api, playerId, [{ str: `+${healAmt} `, style:{color:ability.color} }, { str:"HP" }], ability.icon || "Lifesteal");
    triggered = true;
  }
  // ── Spectral: 3s invisibility — Bloxd effectName est "Invisible" (pas "Invisibility")
  else if (setName === "Spectral") {
    applyEffectSafe(api, playerId, "Invisible", ability.invisMs ?? 3000, 1);
    if (playerP) spawnAt(api, playerP, "spectralInvis", { radius:0.6, height:1.6 });
    flyingMsg(api, playerId, [{ str:"Spectral Veil! ", style:{color:ability.color} }], ability.icon || "Invisible");
    triggered = true;
  }
  // ── Geo: shield per hit
  else if (setName === "Geo") {
    shieldAdd(api, playerId, ability.shieldPerHit ?? 2, ability.shieldCap ?? 12);
    if (playerP) spawnAt(api, playerP, "geoMineTick", { radius:0.6, height:1.2 });
    flyingMsg(api, playerId, [{ str:"+Shield ", style:{color:ability.color} }], ability.icon || "HealthShield");
    triggered = true;
    const last = perPlayer.get(setName) ?? -9999;
    // minimal cooldown 5 ticks to avoid spam but still give shield each hit
    if (nowTick - last < 5) {
      // shield already added, keep tick for cooldown tracking
    }
    perPlayer.set(setName, nowTick);
  }
  // ── Astral: tornado on hit + glowing bonus damage
  else if (setName === "Astral") {
    if (opts.mobId && astralGlowing.has(String(opts.mobId))) {
      const g = astralGlowing.get(String(opts.mobId));
      if (g && g.expireTick > globalTick) {
        const bonus = ability.glowingExtraFrac ?? 0.35;
        extraDamage += Math.round(base * bonus);
      }
    }
    if (mobPos) {
      const last = perPlayer.get("Astral_tornado") ?? -9999;
      if (nowTick - last >= 5) {
        perPlayer.set("Astral_tornado", nowTick);
        spawnZone(api, [mobPos[0], mobPos[1], mobPos[2]], "astralTornado", 1.4, 1.8);
        const extraStr = extraDamage ? ` +${extraDamage}` : "";
        flyingMsg(api, playerId, [{ str:`Astral Tornado!${extraStr} `, style:{color:ability.color} }], ability.icon || "Glowing");
        triggered = true;
      } else if (extraDamage) {
        flyingMsg(api, playerId, [{ str:`Astral Bonus! +${extraDamage} `, style:{color:ability.color} }], ability.icon || "Glowing");
        triggered = true;
      }
    }
  }

  if (triggered || extraDamage) {
    return { triggered, ability, extraDamage, lifesteal: ability.lifesteal ?? 0 };
  }
  if (triggered) return { triggered, ability, extraDamage:0 };
  return { triggered:false, ability };
}

// ── kill handler ────────────────────────────────────────────────────────
export function onMobKilled(api, playerId, mobId) {
  if (!api || !playerId || !mobId) return;
  const k = keyOf(playerId);
  const setName = lastWeaponSet.get(k) || null;
  let detectedSet = setName;
  if (!detectedSet) {
    try {
      let held = null;
      if (typeof api.getHeldItem==="function") { const h=api.getHeldItem(playerId); if(h&&h.name) held=h.name; }
      if (!held && typeof api.getSelectedInventorySlotI==="function" && typeof api.getItemSlot==="function") {
        const idx=api.getSelectedInventorySlotI(playerId);
        if (Number.isFinite(idx) && idx>=0 && idx<10) { const it=api.getItemSlot(playerId, idx); if(it&&it.name) held=it.name; }
      }
      if (held) {
        const clean = String(held).split("|")[0].trim();
        const parts=clean.split(/\s+/);
        const s=parts.slice(0,-1).join(" ");
        if (SET_ABILITIES[s]) detectedSet=s;
      }
    } catch(_){}
  }
  if (!detectedSet) return;

  const ability = abilityForSet(detectedSet);
  if (!ability) return;

  const playerP = playerPos(api, playerId);
  const mobP = posOf(api, mobId, playerP);

  // ── Rubellite: stacking regen
  if (detectedSet === "Rubellite") {
    const now = globalTick;
    let entry = rubelliteStacks.get(k);
    if (!entry) entry = { level:0, lastKillTick:-9999, regenEndTick:0 };
    const windows = ability.stackWindows || [10,9,8];
    const last = entry.lastKillTick;
    const lvl = entry.level;
    const elapsedTicks = now - last;
    let windowTicks = 0;
    if (lvl>=1 && lvl<=3) {
      const wSec = windows[lvl-1] ?? 8;
      windowTicks = wSec * 20;
    } else {
      windowTicks = Infinity;
    }
    let newLevel = 1;
    if (lvl===0) newLevel=1;
    else if (elapsedTicks <= windowTicks) {
      newLevel = Math.min(3, lvl+1);
    } else {
      newLevel = 1;
    }
    entry.level = newLevel;
    entry.lastKillTick = now;
    entry.regenEndTick = now + Math.ceil((ability.regenMs||15000)/50);
    rubelliteStacks.set(k, entry);

    applyEffectSafe(api, playerId, "Health Regen", ability.regenMs || 15000, newLevel);
    if (playerP) spawnZone(api, [playerP[0], playerP[1], playerP[2]], "rubelliteKillZone", 2.0, 0.6);
    const lvlStr = newLevel===1 ? "I" : newLevel===2 ? "II" : "III";
    flyingMsg(api, playerId, [{ str:`Ruby Heart ${lvlStr}! `, style:{color:ability.color} }], ability.icon || "Health Regen");
    dotMap.delete(String(mobId));
  }
  // ── Spectral: vacuum + explosion
  else if (detectedSet === "Spectral") {
    const center = mobP || playerP;
    if (center) {
      const nears = nearbyMobs(api, center, 8);
      for (const { id, pos } of nears) {
        if (String(id) === String(mobId)) continue;
        const dx = center[0]-pos[0], dy = (center[1]+0.5)-pos[1], dz = center[2]-pos[2];
        const dist = Math.sqrt(dx*dx+dy*dy+dz*dz) || 1;
        const strength = 1.2;
        const vx = (dx/dist)*strength, vy = (dy/dist)*strength + 0.4, vz = (dz/dist)*strength;
        try {
          if (typeof api.applyImpulse === "function") api.applyImpulse(id, vx, vy, vz);
          else if (typeof api.setVelocity === "function") api.setVelocity(id, vx, vy, vz);
          else if (typeof api.setPosition === "function") {
            api.setPosition(id, pos[0]+vx*0.8, pos[1]+vy*0.5, pos[2]+vz*0.8);
          }
        } catch(_){}
        try { spawnAt(api, pos, "spectralInvis", { radius:0.4, height:0.8 }); } catch(_){}
      }
      const baseForExpl = (()=>{ try { const meta = weaponMeta(detectedSet + " Sword"); return meta ? meta.base : 44; } catch(_){ return 44; }})();
      const explDmg = Math.round(baseForExpl * (ability.explosionFrac ?? 0.8));
      for (const { id } of nears) {
        if (String(id)===String(mobId)) continue;
        try { damageMob(api, id, explDmg, playerId); } catch(_){}
      }
      spawnZone(api, center, "spectralExplosion", 2.5, 1.0);
      flyingMsg(api, playerId, [{ str:"Spectral Explosion! ", style:{color:ability.color} }], ability.icon || "Damage");
    }
    dotMap.delete(String(mobId));
    astralGlowing.delete(String(mobId));
  }
  // ── Geo: mines on nearby mobs (3s delay, avoidable)
  else if (detectedSet === "Geo") {
    const center = mobP || playerP;
    if (center) {
      const nears = nearbyMobs(api, center, 6);
      const targets = nears.length ? nears : [{ id: null, pos: center }];
      for (const { id, pos: mp } of targets) {
        const p = mp || center;
        const mPos = [p[0], p[1], p[2]];
        const dmgBase = (()=>{ try { const meta = weaponMeta(detectedSet + " Sword"); return meta? meta.base:45; } catch(_){ return 45; }})();
        const dmg = Math.round(dmgBase * (ability.mineFrac ?? 0.7));
        geoMines.push({
          pos: [...mPos],
          ownerId: playerId,
          explodeTick: globalTick + (ability.mineDelay ?? 60),
          dmg,
          radius: ability.mineRadius ?? 3,
          anchorId: id ? String(id) : null,
        });
        spawnAt(api, mPos, "geoMineTick", { radius:0.5, height:0.6 });
      }
      flyingMsg(api, playerId, [{ str:"Mines deployed! ", style:{color:ability.color} }], ability.icon || "Damage Reduction");
    }
    dotMap.delete(String(mobId));
  }
  // ── Astral: kill gives Glowing to mobs in 15 blocks + violet particles + extra dmg flag
  else if (detectedSet === "Astral") {
    const center = mobP || playerP;
    if (center) {
      const nears = nearbyMobs(api, center, ability.glowingRadius ?? 15);
      for (const { id, pos } of nears) {
        if (String(id)===String(mobId)) continue;
        applyEffectSafe(api, id, "Glowing", ability.glowingMs ?? 10000, 1);
        astralGlowing.set(String(id), { ownerId: playerId, expireTick: globalTick + Math.ceil((ability.glowingMs??10000)/50), extraFrac: ability.glowingExtraFrac ?? 0.35 });
        spawnAt(api, pos, "astralGlowing", { radius:0.5, height:1.0 });
      }
      spawnZone(api, center, "astralGlowing", 2.5, 1.2);
      const cnt = nears.length;
      if (cnt>0) flyingMsg(api, playerId, [{ str:`Glowing x${cnt}! `, style:{color:ability.color} }], ability.icon || "Glowing");
    }
    dotMap.delete(String(mobId));
  }
  // ── other sets: no kill effect, but clean DOT
  else {
    dotMap.delete(String(mobId));
    astralGlowing.delete(String(mobId));
  }
}

// ── tick handler for DOT, mines, aura ───────────────────────────────────
export function tickWeapons(api) {
  globalTick++;
  const now = globalTick;

  // DOT burns/poisons
  if (dotMap.size) {
    for (const [mobId, entry] of [...dotMap.entries()]) {
      if (!entry) continue;
      try {
        if (typeof api.isAlive === "function" && !api.isAlive(entry.mobId || mobId)) {
          dotMap.delete(mobId);
          continue;
        }
      } catch(_){}
      if (now >= entry.nextTick) {
        try { damageMob(api, entry.mobId || mobId, entry.dmg, entry.ownerId); } catch(_){}
        try {
          let p = entry.pos;
          if (entry.mobId) {
            const cur = posOf(api, entry.mobId, null);
            if (cur) { p = cur; entry.pos = [...cur]; }
          }
          if (p) {
            if (entry.type === "burn") spawnAt(api, p, "magmaBurn", { radius:0.4, height:0.8 });
            else spawnAt(api, p, "serpentPoison", { radius:0.4, height:0.8 });
          }
        } catch(_){}
        entry.nextTick = now + entry.interval;
      }
      entry.ticksLeft--;
      if (entry.ticksLeft <= 0) { dotMap.delete(mobId); continue; }
    }
  }

  // Astral glowing expiry
  if (astralGlowing.size) {
    for (const [mid, e] of [...astralGlowing.entries()]) {
      if (now >= e.expireTick) astralGlowing.delete(mid);
    }
  }

  // Geo mines countdown
  if (geoMines.length) {
    for (let i=geoMines.length-1; i>=0; i--) {
      const m = geoMines[i];
      if (now % 10 === 0) {
        try { spawnAt(api, m.pos, "geoMineTick", { radius:0.4, height:0.5 }); } catch(_){}
      }
      if (now >= m.explodeTick) {
        const nears = nearbyMobs(api, m.pos, m.radius);
        for (const { id } of nears) {
          try {
            const mp = posOf(api, id, null);
            if (mp) {
              const dx=mp[0]-m.pos[0], dy=mp[1]-m.pos[1], dz=mp[2]-m.pos[2];
              if (dx*dx+dy*dy+dz*dz <= (m.radius+0.5)*(m.radius+0.5)) {
                damageMob(api, id, m.dmg, m.ownerId);
              }
            } else {
              damageMob(api, id, m.dmg, m.ownerId);
            }
          } catch(_){}
        }
        spawnZone(api, m.pos, "geoMineExplosion", 1.8, 0.8);
        geoMines.splice(i,1);
      }
    }
  }

  // Astral aura while holding weapon (every 20 ticks)
  if (now % 20 === 0 && api) {
    let pids = [];
    try { pids = typeof api.getPlayerIds==="function" ? api.getPlayerIds() : []; } catch(_) { pids=[]; }
    for (const pid of pids) {
      try {
        let held = null;
        if (typeof api.getHeldItem==="function") { const h=api.getHeldItem(pid); if(h&&h.name) held=h.name; }
        if (!held && typeof api.getSelectedInventorySlotI==="function" && typeof api.getItemSlot==="function") {
          const idx=api.getSelectedInventorySlotI(pid);
          if (Number.isFinite(idx) && idx>=0 && idx<10) { const it=api.getItemSlot(pid, idx); if(it&&it.name) held=it.name; }
        }
        if (!held || !String(held).split("|")[0].trim().startsWith("Astral ")) continue;
        const pPos = playerPos(api, pid);
        if (!pPos) continue;
        const abil = abilityForSet("Astral");
        const radius = abil.auraRadius ?? 8;
        const nears = nearbyMobs(api, pPos, radius);
        for (const { id, pos } of nears) {
          applyEffectSafe(api, id, "Slowness", abil.auraSlownessMs ?? 2000, 2);
          damageMob(api, id, abil.auraDps ?? 2, pid);
          spawnAt(api, pos, "astralAura", { radius:0.5, height:0.8 });
        }
      } catch(_){}
    }
  }

  if (now % 400 === 0) {
    if (amethiteHits.size > 100) {
      const keys=[...amethiteHits.keys()];
      for(let i=0;i<keys.length-50;i++) amethiteHits.delete(keys[i]);
    }
    if (rubelliteStacks.size>100) {
      const keys=[...rubelliteStacks.keys()];
      for(let i=0;i<keys.length-50;i++) rubelliteStacks.delete(keys[i]);
    }
  }
}

// ── forget / reset ─────────────────────────────────────────────────────
export function forgetPlayer(playerId) {
  const k = keyOf(playerId);
  lastAbilityTick.delete(k);
  amethiteHits.delete(k);
  rubelliteStacks.delete(k);
  lastWeaponSet.delete(k);
  for (const [mid, e] of [...dotMap.entries()]) if (String(e.ownerId)===k) dotMap.delete(mid);
  for (let i=geoMines.length-1;i>=0;i--) if (String(geoMines[i].ownerId)===k) geoMines.splice(i,1);
  for (const [mid,e] of [...astralGlowing.entries()]) if (String(e.ownerId)===k) astralGlowing.delete(mid);
}
export function _reset() {
  lastAbilityTick.clear();
  amethiteHits.clear();
  dotMap.clear();
  rubelliteStacks.clear();
  lastWeaponSet.clear();
  geoMines.length=0;
  astralGlowing.clear();
  astralAuraCooldown.clear();
  globalTick=0;
}
export function _getLastAbilityTickMap() { return lastAbilityTick; }
export function _getDotMap() { return dotMap; }
export function _getRubelliteStacks() { return rubelliteStacks; }
export function _getMines() { return geoMines; }
export function _getGlowing() { return astralGlowing; }
export function _getAmethiteHits() { return amethiteHits; }
