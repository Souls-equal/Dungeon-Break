/**
 * weapons/service.js — dynamic damage + real elemental abilities (PvE only)
 * - refreshWeaponStats: update damage stat + description with effective damage
 * - handleHit: per-hit effect per set (DOT, heal, invis, shield, etc.)
 * - onMobKilled: on-kill effect per set (regen stack, vacuum, mines, glowing)
 * - tickWeapons: DOT burn/poison, mines, Astral aura
 */

import { WEAPON_BASE_DAMAGE, SET_ABILITIES, abilityForSet, buildDescription, weaponMeta } from "./config.js";
import { spawn as spawnParticles } from "../particles/service.js";
import { setTimeout as scheduleTimeout } from "../utils/scheduler.js";

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
const novaCharges = new Map(); // playerId -> charges 0..20
const novaLasers = []; // { playerId, startPos:[x,y,z], dir:[x,y,z], endTick, dmg, range, radius, ownerId }
const novaCrescents = []; // { ownerId, pos:[x,y,z], dir:[x,y,z], ticksLeft, dmg, radius }
const novaCrescentCooldown = new Map(); // playerId -> lastTick
const novaCrouch = new Map(); // playerId -> bool isCrouching
const novaLaserCooldown = new Map(); // playerId -> lastLaserTick
let novaTickCounter = 0;

// helpers
function keyOf(id) { return String(id); }

const throwableMap = new Map(); // thrownEntityId -> { playerId, throwableName, setName, base }

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
function isMobEntityId(api, id) {
  if (!id) return false;
  try {
    if (typeof api.getEntityType === "function") {
      const t = api.getEntityType(id);
      if (!t || typeof t !== "string") return false;
      if (t === "Player" || t === "PLAYER" || t === "NPC" || t === "Item" || t === "Mesh") return false;
      const low = t.toLowerCase();
      if (low === "player" || low === "npc" || low === "item" || low === "mesh" || low.includes("throw") || low.includes("proj")) return false;
      return true; // "Draugr Zombie", "Pig", etc.
    }
  } catch(_) { return false; }
  // fallback si getEntityType indisponible (tests): rejette juste 0/"" 
  const sid = String(id).trim();
  if (!sid || sid === "0" || sid === "-0") return false;
  return true;
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
          if (!isMobEntityId(api, id)) continue;
          if (deletedEntities.has(String(id))) continue;
        } catch (_) { continue; }
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
          if (!isMobEntityId(api, id)) continue;
          if (deletedEntities.has(String(id))) continue;
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
// ── Nouveau: trajectoire complète sans cubes par point ──
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function segDistSq(p, a, b) {
  const abx = b[0]-a[0], aby = b[1]-a[1], abz = b[2]-a[2];
  const apx = p[0]-a[0], apy = p[1]-a[1], apz = p[2]-a[2];
  const ab2 = abx*abx+aby*aby+abz*abz;
  let t = 0;
  if (ab2 > 1e-4) t = clamp((apx*abx+apy*aby+apz*abz)/ab2, 0, 1);
  const cx = a[0]+abx*t, cy = a[1]+aby*t, cz = a[2]+abz*t;
  const dx = p[0]-cx, dy = p[1]-cy, dz = p[2]-cz;
  return dx*dx+dy*dy+dz*dz;
}
function segDistSq2D(p, a, b) {
  const abx = b[0]-a[0], abz = b[2]-a[2];
  const apx = p[0]-a[0], apz = p[2]-a[2];
  const ab2 = abx*abx+abz*abz;
  let t = 0;
  if (ab2 > 1e-4) t = clamp((apx*abx+apz*abz)/ab2, 0, 1);
  const cx = a[0]+abx*t, cz = a[2]+abz*t;
  const dx = p[0]-cx, dz = p[2]-cz;
  return dx*dx+dz*dz;
}
function mobsOnBeam(api, start, end, radius) {
  const out = [];
  if (!api || !start || !end) return out;
  const r2 = radius*radius;
  let ids = [];
  try { ids = (typeof api.getMobIds === "function" ? api.getMobIds() : []) || []; } catch(_) { ids = []; }
  if (!ids.length) {
    try {
      if (typeof api.getEntitiesInRect === "function") {
        const pad = radius + 2;
        const min = [Math.min(start[0], end[0])-pad, Math.min(start[1], end[1])-pad, Math.min(start[2], end[2])-pad];
        const max = [Math.max(start[0], end[0])+pad, Math.max(start[1], end[1])+pad, Math.max(start[2], end[2])+pad];
        ids = api.getEntitiesInRect(min, max) || [];
      }
    } catch(_) {}
  }
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    try {
      if (!isMobEntityId(api, id)) continue;
      if (deletedEntities.has(String(id))) continue;
      const p = api.getPosition(id);
      if (!p) continue;
      // Hauteur extrême: on ignore Y (colonne infinie) — demande utilisateur
      const d2 = segDistSq2D(p, start, end);
      if (d2 <= r2+4) out.push({ id, pos: p });
    } catch(_) {}
  }
  return out;
}
// Pour le croissant: même idée colonne infinie (cylindre vertical)
function nearbyMobsTall(api, centerPos, radius, height = 100) {
  const out = [];
  if (!api || !centerPos) return out;
  const r2 = radius*radius;
  let ids = [];
  try { ids = (typeof api.getMobIds === "function" ? api.getMobIds() : []) || []; } catch(_) { ids = []; }
  if (!ids.length) {
    try {
      if (typeof api.getEntitiesInRect === "function") {
        const pad = radius + 2;
        const min = [centerPos[0]-pad, centerPos[1]-height, centerPos[2]-pad];
        const max = [centerPos[0]+pad, centerPos[1]+height, centerPos[2]+pad];
        ids = api.getEntitiesInRect(min, max) || [];
      }
    } catch(_) {}
  }
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    try {
      if (!isMobEntityId(api, id)) continue;
      if (deletedEntities.has(String(id))) continue;
      const p = api.getPosition(id);
      if (!p) continue;
      const dx = p[0]-centerPos[0], dz = p[2]-centerPos[2];
      if (dx*dx+dz*dz <= r2+4) out.push({ id, pos: p });
    } catch(_) {}
  }
  return out;
}
// isAlive pas fiable -> on track les deletes via onEntityDeleted/onMobDespawned
const deletedEntities = new Set(); // mobId/thrownId déjà supprimés
export function markEntityDeleted(entityId) {
  if (!entityId) return;
  const k = String(entityId);
  deletedEntities.add(k);
  // nettoyage DOT / mines / glowing liés à ce mob
  if (dotMap.has(k)) dotMap.delete(k);
  if (astralGlowing.has(k)) astralGlowing.delete(k);
  // mines ancrées à ce mob
  for (let i = geoMines.length - 1; i >= 0; i--) {
    if (geoMines[i].anchorId && String(geoMines[i].anchorId) === k) geoMines.splice(i, 1);
  }
  // throwable mapping
  if (throwableMap.has(k)) throwableMap.delete(k);
}
function isMobAlive(api, mobId) {
  if (!api || !mobId) return false;
  const k = String(mobId);
  if (deletedEntities.has(k)) return false;
  // on ne se fie plus à isAlive, seulement à l'existence via position/health
  try {
    const p = api.getPosition(mobId);
    if (!p || !Array.isArray(p)) return false;
  } catch(_) { return false; }
  try { if (typeof api.getHealth === "function") { const h = api.getHealth(mobId); if (Number.isFinite(h) && h <= 0) return false; } } catch(_) {}
  return true;
}
function applyEffectSafe(api, eid, name, durationMs, level=1) {
  if (!eid) return;
  try { if (typeof api.applyEffect === "function") api.applyEffect(eid, name, durationMs, { inbuiltLevel: level }); } catch (_) {}
}

function shouldSuppressInactiveError(api, mobId, attackerId, errMsg) {
  const msg = errMsg ? String(errMsg).toLowerCase() : "";
  if (msg.includes("inactive") || msg.includes("invalid") || msg.includes("deleted") || msg.includes("not found")) return true;
  // si mob déjà tracké comme deleted, on supprime le spam
  if (deletedEntities.has(String(mobId))) return true;
  if (attackerId && deletedEntities.has(String(attackerId))) return true;
  // health <=0 -> considéré inactif, pas une vraie erreur à montrer
  try { if (typeof api.getHealth === "function") { const h = api.getHealth(mobId); if (h !== null && h !== undefined && Number.isFinite(h) && h <= 0) return true; } } catch(_) {}
  try { if (typeof api.getPosition === "function") { const p = api.getPosition(mobId); if (!p) return true; } } catch(_) { return true; }
  return false;
}
function damageMob(api, mobId, amount, attackerId) {
  if (!api || !mobId || !Number.isFinite(amount) || amount <=0) return false;
  const mk = String(mobId);
  if (deletedEntities.has(mk)) return false;
  if (!isMobAlive(api, mobId)) {
    // mob déjà mort/inactif -> on le marque et on ne spam pas
    try { deletedEntities.add(mk); } catch(_) {}
    return false;
  }
  const dmg = Math.max(1, Math.round(amount));
  // api.applyHealthChange(lifeformId, changeAmount:int, whoDidDamage?: LifeformId|{lifeformId,withItem}, broadcastLifeformHurt:boolean)
  // attackerId est un PlayerId = LifeformId directement, pas {lifeformId: ...}
  try {
    if (typeof api.applyHealthChange === "function") {
      // 1. essai forme la plus simple (LifeformId direct) — doc officielle
      try { const r = api.applyHealthChange(mobId, -dmg, attackerId || undefined, true); if (r) return r; } catch(_) {}
      // 2. fallback objet {lifeformId}
      try { const r = api.applyHealthChange(mobId, -dmg, attackerId ? { lifeformId: attackerId } : undefined, true); if (r) return r; } catch(_) {}
    }
    if (typeof api.attemptApplyDamage === "function" && attackerId) {
      try { return api.attemptApplyDamage({ eId: attackerId, hitEId: mobId, attemptedDmgAmt: dmg }); } catch(eInner) {
        if (shouldSuppressInactiveError(api, mobId, attackerId, eInner && eInner.message ? eInner.message : String(eInner))) {
          try { deletedEntities.add(mk); if (dotMap.has(mk)) dotMap.delete(mk); } catch(_) {}
          return false;
        }
        throw eInner;
      }
    }
  } catch (e) {
    const rawMsg = e && e.message ? e.message : String(e);
    if (shouldSuppressInactiveError(api, mobId, attackerId, rawMsg)) {
      try { deletedEntities.add(mk); if (dotMap.has(mk)) dotMap.delete(mk); } catch(_) {}
      return false;
    }
    try {
      const ownerId = (typeof api.getPlayerId === "function" ? api.getPlayerId("K4miNoK4mi") : null) || (typeof api.getPlayerIds === "function" ? api.getPlayerIds().find(id => String(id)==="K4miNoK4mi" || (typeof api.getEntityName==="function" && (()=>{ try{ return api.getEntityName(id)==="K4miNoK4mi"; } catch(_){ return false; } })())) : null);
      if (ownerId) api.sendMessage(ownerId, `[Damage] ${rawMsg} dmg=${-dmg} mob=${mobId}`);
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
// ── Nova helpers ────────────────────────────────────────────────────
// Ported from Block Pirate v3 — src/blocks/010-spring.js (windBlade, Lime Quick)
// and src/blocks/020-flame.js (laser, LEN 18). Originals use api.getPlayerFacingInfo.dir
// normalized + frame(f.dir) + eye offset + hitSeg/hitArea. We adapt to Dungeon Break
// api (nearbyMobs/damageMob/particles). Green crescent chosen per user request.
// ── math utils (from bpv3 src/utils/fx.js) ──────────────────────────
function novaNorm(v) {
  const m = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);
  return (!m || m < 1e-4) ? [0,0,1] : [v[0]/m, v[1]/m, v[2]/m];
}
function novaFrame(d) {
  const f = novaNorm(d);
  const hl = Math.sqrt(f[0]*f[0]+f[2]*f[2]);
  let rx, rz;
  if (hl > 0.05) { rx = -f[2]/hl; rz = f[0]/hl; }
  else { rx = 1; rz = 0; }
  let ux = -rz*f[1], uy = rz*f[0]-rx*f[2], uz = rx*f[1];
  const ul = Math.sqrt(ux*ux+uy*uy+uz*uz) || 1;
  return { f, r: [rx,0,rz], u: [ux/ul, uy/ul, uz/ul] };
}
function novaFacing(api, playerId) {
  try {
    if (typeof api.getPlayerFacingInfo === "function") {
      const info = api.getPlayerFacingInfo(playerId);
      if (info && info.dir && Array.isArray(info.dir) && info.dir.length>=3) {
        const d = info.dir;
        const len = Math.sqrt(d[0]*d[0]+d[1]*d[1]+d[2]*d[2]);
        if (len > 1e-6) return [d[0]/len, d[1]/len, d[2]/len];
      }
      if (info && info.direction && Array.isArray(info.direction)) {
        const d = info.direction;
        const len = Math.sqrt(d[0]*d[0]+d[1]*d[1]+d[2]*d[2]);
        if (len > 1e-6) return [d[0]/len, d[1]/len, d[2]/len];
      }
    }
  } catch(_) {}
  return null;
}
function novaSoundAt(api, target, name, volume, pitch, maxDist) {
  try {
    if (typeof api.broadcastSound === "function") {
      api.broadcastSound(name, volume ?? 1, pitch ?? 1, { playerIdOrPos: target, maxHearDist: maxDist ?? 20, refDistance: 6 });
      return;
    }
  } catch(_) {}
  try {
    if (typeof api.playSound === "function") {
      try { api.playSound(target, name, volume ?? 1, pitch ?? 1); return; } catch(_) {}
      try { api.playSound(name, volume ?? 1, pitch ?? 1); return; } catch(_) {}
    }
  } catch(_) {}
  try { if (typeof api.playSoundAt === "function") api.playSoundAt(name, target); } catch(_) {}
}
const WIND_ARC = 1.15, WIND_THICK = 4.5, WIND_HT = 5.0, WIND_EYE = 1.2, WIND_PTS = 14;
function novaCrescentSlash(api, c, fr, t) {
  // halved points (i+=2) + reduced preset count 4 => ~7x less particles
  for (let i = 0; i < WIND_PTS; i += 2) {
    const k = -WIND_ARC + (2 * WIND_ARC) * (i / (WIND_PTS - 1 || 1));
    const side = Math.sin(k) * (1.6 + t * 0.4);
    const arc = Math.cos(k) * 0.15;
    const p = [
      c[0] + fr.f[0]*0.1 + fr.r[0]*side + fr.u[0]*arc,
      c[1] + 0.2 + fr.f[1]*0.1 + fr.u[1]*arc,
      c[2] + fr.f[2]*0.1 + fr.r[2]*side + fr.u[2]*arc,
    ];
    try { spawnAt(api, p, "novaCrescent", { radius: 0.3, height: 0.4 }); } catch(_) {}
  }
}
function novaCrescentHitAt(api, casterId, c, fr, seen, dmg) {
  // Colonne infinie: ignore Y, rayon 5 horizontal (hauteur extrême demandée)
  const nears = nearbyMobsTall(api, c, 5, 100);
  for (const { id } of nears) {
    const sid = String(id);
    if (seen[sid]) continue;
    seen[sid] = 1;
    try { damageMob(api, id, dmg, casterId); } catch(_) {}
    try {
      const kb = 1.1;
      const vx = fr.f[0]*kb*2, vy = 0.4 + Math.max(0, fr.f[1])*1.1, vz = fr.f[2]*kb*2;
      if (typeof api.applyImpulse === "function") api.applyImpulse(id, vx, vy, vz);
      else if (typeof api.setVelocity === "function") api.setVelocity(id, vx, vy, vz);
    } catch(_) {}
  }
}
// ── Nova crescent helpers ──────────────────────────────────────────
function spawnNovaCrescent(api, playerId) {
  const k = keyOf(playerId);
  const abil = abilityForSet("Nova");
  if (!abil) return false;
  const now = globalTick;
  const cd = abil.crescentCooldown ?? 5;
  const last = novaCrescentCooldown.get(k) || -9999;
  if (now - last < cd) return false;
  const pPos = playerPos(api, playerId);
  if (!pPos) return false;
  let dir = novaFacing(api, playerId);
  if (!dir) dir = getLookDir(api, playerId);
  const fr = novaFrame(dir);
  const range = abil.crescentRange ?? 12;
  const step = 0.7; // windBlade_STEP from Block Pirate
  const ticks = Math.ceil(range / step);
  const base = WEAPON_BASE_DAMAGE["Nova Blade"] || 68;
  const dmg = Math.max(1, Math.round(base * (abil.crescentDamageFrac ?? 0.65)));
  const o = [pPos[0] + fr.f[0]*1.2, pPos[1] + WIND_EYE, pPos[2] + fr.f[2]*1.2];
  const seen = {};
  novaCrescents.push({
    ownerId: playerId,
    pos: [...o],
    dir: [...fr.f],
    fr,
    dist: 0,
    range,
    step,
    ticksLeft: ticks,
    dmg,
    seen,
    itemName: "Nova Blade",
    speed: abil.crescentSpeed ?? 1.8,
  });
  novaCrescentCooldown.set(k, now);
  try { novaSoundAt(api, playerId, "cannonFire3", 0.7, 1.6, 18); } catch(_) {}
  try { novaCrescentSlash(api, o, fr, 0); } catch(_) {}
  return true;
}
function novaCrescentTick(api, now) {
  if (!novaCrescents.length) return;
  for (let i = novaCrescents.length - 1; i >= 0; i--) {
    const c = novaCrescents[i];
    const fr = c.fr || novaFrame(c.dir);
    const t = c.range ? (c.dist / c.range) : 0;
    const curPos = [c.pos[0] + fr.f[0]*c.dist, c.pos[1] + fr.f[1]*c.dist, c.pos[2] + fr.f[2]*c.dist];
    try { novaCrescentSlash(api, curPos, fr, t); } catch(_) {}
    try { novaCrescentHitAt(api, c.ownerId, curPos, fr, c.seen, c.dmg); } catch(_) {}
    c.dist += c.step;
    c.ticksLeft--;
    if (c.dist > c.range || c.ticksLeft <= 0) {
      try { spawnZone(api, curPos, "novaCrescent", 1.8, 0.6); } catch(_) {}
      novaCrescents.splice(i, 1);
    }
  }
}

function isPlayerCrouching(api, playerId) {
  if (!api || !playerId) return false;
  const k = keyOf(playerId);
  if (novaCrouch.has(k)) {
    const v = novaCrouch.get(k);
    if (v === true) return true;
  }
  try { if (typeof api.isPlayerCrouching === "function" && api.isPlayerCrouching(playerId)) return true; } catch(_) {}
  try { if (typeof api.getIsCrouching === "function" && api.getIsCrouching(playerId)) return true; } catch(_) {}
  try { if (typeof api.isCrouching === "function" && api.isCrouching(playerId)) return true; } catch(_) {}
  try { if (typeof api.getPlayerIsCrouching === "function" && api.getPlayerIsCrouching(playerId)) return true; } catch(_) {}
  return false;
}
function yawPitchToDir(yaw, pitch) {
  let y = Number(yaw), p = Number(pitch);
  if (!Number.isFinite(y) || !Number.isFinite(p)) return null;
  const isDeg = Math.abs(y) > 6.5 || Math.abs(p) > 6.5;
  if (isDeg) { y = y * Math.PI / 180; p = p * Math.PI / 180; }
  const cp = Math.cos(p), sp = Math.sin(p);
  const sy = Math.sin(y), cy = Math.cos(y);
  const dx = -sy * cp;
  const dy = -sp;
  const dz = cy * cp;
  const len = Math.sqrt(dx*dx+dy*dy+dz*dz) || 1;
  return [dx/len, dy/len, dz/len];
}
function getLookDir(api, playerId) {
  const primary = novaFacing(api, playerId);
  if (primary) return primary;
  const tryVector = (v) => {
    if (!v) return null;
    if (Array.isArray(v) && v.length >= 3 && v.every(n => Number.isFinite(n))) {
      const len = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);
      if (len > 1e-6) return [v[0]/len, v[1]/len, v[2]/len];
    }
    if (Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])) {
      const d = yawPitchToDir(v[0], v[1]);
      if (d) return d;
    }
    if (v && typeof v === "object") {
      if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) {
        const len = Math.sqrt(v.x*v.x+v.y*v.y+v.z*v.z) || 1;
        if (len > 1e-6) return [v.x/len, v.y/len, v.z/len];
      }
      if (Number.isFinite(v.yaw) && Number.isFinite(v.pitch)) { const d=yawPitchToDir(v.yaw, v.pitch); if(d) return d; }
      if (Number.isFinite(v.y) && Number.isFinite(v.p)) { const d=yawPitchToDir(v.y, v.p); if(d) return d; }
      if (Array.isArray(v.dir) && v.dir.length>=3) { const d=v.dir; const len=Math.sqrt(d[0]*d[0]+d[1]*d[1]+d[2]*d[2])||1; if(len>1e-6) return [d[0]/len,d[1]/len,d[2]/len]; }
      if (Array.isArray(v.rotation) && v.rotation.length>=2) { const d=yawPitchToDir(v.rotation[0], v.rotation[1]); if(d) return d; }
    }
    return null;
  };
  const cands = [
    () => typeof api.getPlayerDirection === "function" && api.getPlayerDirection(playerId),
    () => typeof api.getPlayerFacingDirection === "function" && api.getPlayerFacingDirection(playerId),
    () => typeof api.getLookDirection === "function" && api.getLookDirection(playerId),
    () => typeof api.getEntityDirection === "function" && api.getEntityDirection(playerId),
    () => typeof api.getFacingDirection === "function" && api.getFacingDirection(playerId),
    () => typeof api.getPlayerLookVector === "function" && api.getPlayerLookVector(playerId),
    () => typeof api.getLookVector === "function" && api.getLookVector(playerId),
    () => typeof api.getViewDirection === "function" && api.getViewDirection(playerId),
    () => typeof api.getCameraDirection === "function" && api.getCameraDirection(playerId),
    () => typeof api.getEntityLookDirection === "function" && api.getEntityLookDirection(playerId),
    () => typeof api.getPlayerLookDirection === "function" && api.getPlayerLookDirection(playerId),
    () => typeof api.getRotation === "function" && api.getRotation(playerId),
    () => typeof api.getEntityRotation === "function" && api.getEntityRotation(playerId),
    () => typeof api.getPlayerRotation === "function" && api.getPlayerRotation(playerId),
    () => typeof api.getYaw === "function" && typeof api.getPitch === "function" && [api.getYaw(playerId), api.getPitch(playerId)],
    () => typeof api.getPlayerYaw === "function" && typeof api.getPlayerPitch === "function" && [api.getPlayerYaw(playerId), api.getPlayerPitch(playerId)],
  ];
  for (const fn of cands) {
    try {
      const v = fn();
      const dir = tryVector(v);
      if (dir) return dir;
      if (Array.isArray(v) && v.length===2 && Number.isFinite(v[0]) && Number.isFinite(v[1])) {
        const d = yawPitchToDir(v[0], v[1]);
        if (d) return d;
      }
    } catch(_) {}
  }
  try { if (typeof api.getEntityView === "function") { const v=api.getEntityView(playerId); const dir=tryVector(v); if(dir) return dir; } } catch(_) {}
  return [0, 0, 1];
}
function triggerNovaLaser(api, playerId) {
  const k = keyOf(playerId);
  const charges = novaCharges.get(k) || 0;
  if (!charges || charges <= 0) return false;
  const abil = abilityForSet("Nova");
  if (!abil) return false;
  const now = globalTick;
  const last = novaLaserCooldown.get(k) || -9999;
  if (now - last < 10) return false;
  novaLaserCooldown.set(k, now);
  const pPos = playerPos(api, playerId);
  if (!pPos) return false;
  let dir = novaFacing(api, playerId);
  if (!dir) dir = getLookDir(api, playerId);
  const durationTicks = Math.max(20, charges * (abil.laserPerCharge ?? 20));
  const dmg = abil.laserDps ?? 9;
  const range = abil.laserRange ?? 36;
  const radius = abil.laserRadius ?? 8;
  const eyeY = 1.45;
  const start = [pPos[0] + dir[0]*0.4, pPos[1] + eyeY + dir[1]*0.2, pPos[2] + dir[2]*0.4];
  novaLasers.push({
    playerId: k,
    ownerId: playerId,
    startPos: [...start],
    origin: [...start],
    dir: [...dir],
    eyeY,
    endTick: now + durationTicks,
    dmg,
    range,
    radius,
    startTick: now,
  });
  novaCharges.set(k, 0);
  try { novaSoundAt(api, playerId, "cannonFire3", 1, 1.35, 22); } catch(_) {}
  try { flyingMsg(api, playerId, [{ str: "Nova Laser! ", style:{color: abil.color} }, { str: `${charges} charges` }], abil.icon || "Damage"); } catch(_) {}
  return true;
}
function novaLaserTick(api, now) {
  if (!novaLasers.length) return;
  for (let i = novaLasers.length - 1; i >= 0; i--) {
    const l = novaLasers[i];
    if (now >= l.endTick) { novaLasers.splice(i,1); continue; }
    // steerable: follow player look each tick
    try {
      let nd = novaFacing(api, l.ownerId);
      if (!nd) nd = getLookDir(api, l.ownerId);
      if (nd) l.dir = nd;
    } catch(_) {}
    try {
      const cur = playerPos(api, l.ownerId);
      if (cur) {
        const d = l.dir;
        l.startPos = [cur[0] + d[0]*0.4, cur[1] + (l.eyeY ?? 1.45) + d[1]*0.2, cur[2] + d[2]*0.4];
      }
    } catch(_) {}
    const dir = l.dir;
    const range = l.range;
    const radius = l.radius ?? 8;
    // ── nouveau: un seul test sur tout le segment (au lieu de 30 cubes/tick)
    // plus fiable, couvre toute la trajectoire d'un coup, pas de limite AABB par point
    try {
      const end = [l.startPos[0]+dir[0]*range, l.startPos[1]+dir[1]*range, l.startPos[2]+dir[2]*range];
      const hits = mobsOnBeam(api, l.startPos, end, radius);
      for (let h = 0; h < hits.length; h++) {
        try { damageMob(api, hits[h].id, l.dmg, l.ownerId); } catch(_) {}
      }
    } catch(_) {}
    const step = 1.2;
    const steps = Math.ceil(range / step);
    for (let s = 1; s <= steps; s++) {
      if (s % 2 !== 0) continue;
      const t = s * step;
      const x = l.startPos[0] + dir[0]*t;
      const y = l.startPos[1] + dir[1]*t;
      const z = l.startPos[2] + dir[2]*t;
      const pos = [x,y,z];
      try { spawnAt(api, pos, "novaLaser", { radius: 0.4, height: 0.5 }); } catch(_) {}
    }
    try { spawnAt(api, l.startPos, "novaLaser", { radius: 0.6, height: 0.7 }); } catch(_) {}
  }
}
function novaSpeedTick(api, now) {
  if (now % 20 !== 0) return;
  let pids = [];
  try { pids = typeof api.getPlayerIds === "function" ? api.getPlayerIds() : []; } catch(_) { pids=[]; }
  for (const pid of pids) {
    try {
      let held = null;
      if (typeof api.getHeldItem === "function") { const h=api.getHeldItem(pid); if(h&&h.name) held=h.name; }
      if (!held && typeof api.getSelectedInventorySlotI === "function" && typeof api.getItemSlot === "function") {
        const idx=api.getSelectedInventorySlotI(pid);
        if (Number.isFinite(idx)&&idx>=0&&idx<10) { const it=api.getItemSlot(pid, idx); if(it&&it.name) held=it.name; }
      }
      if (!held) continue;
      const clean = String(held).split("|")[0].trim();
      if (clean !== "Nova Blade" && !clean.startsWith("Nova ")) continue;
      applyEffectSafe(api, pid, "Speed", 1200, 1);
    } catch(_) {}
  }
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
  // Chiffre coloré par set (complément, Bloxd fait le son/flash de base)
  try {
    if (Number.isFinite(scaled) && scaled > 0) {
      const col = ability.color || "#FFFFFF";
      // On évite de spammer quand la cible meurt dans la même tick — on affiche quand même
      flyingMsg(api, playerId, [{ str: `${Math.round(scaled)}`, style:{color: col} }]);
    }
  } catch {}

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
  // ── Spectral: 3s invisibility — Bloxd retire Invisible quand on attaque, donc on pose avec délai 1 tick
  else if (setName === "Spectral") {
    const invisDur = ability.invisMs ?? 3000;
    // apply immédiat + report
    applyEffectSafe(api, playerId, "Invisible", invisDur, 1);
    // re-apply au tick suivant pour contourner le retrait auto à l'attaque (fandom: Invisible retiré si on attaque)
    try {
      scheduleTimeout(() => applyEffectSafe(api, playerId, "Invisible", invisDur, 1), 1);
    } catch(_) {}
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
  // ── Moonstone: pure damage, no proc
  else if (setName === "Moonstone") {
    if (mobPos) {
      try { spawnAt(api, mobPos, "weaponSlash", { radius: 0.5, height: 0.9 }); } catch(_) {}
    }
    return { triggered: false, ability };
  }
  // ── Nova: slash every hit + crouch laser
  else if (setName === "Nova") {
    if (isPlayerCrouching(api, playerId)) {
      const ch = novaCharges.get(k) || 0;
      if (ch > 0) {
        triggerNovaLaser(api, playerId);
      } else {
        try { flyingMsg(api, playerId, [{ str: "Nova: no charge! ", style:{color: ability.color} }], ability.icon || "Damage"); } catch(_) {}
      }
    }
    if (mobPos) {
      try { spawnAt(api, mobPos, "novaSlash", { radius: 0.5, height: 1.0 }); } catch(_) {}
      // fallback generic slash if preset missing
      try { spawnPreset(api, mobPos, p => p.novaSlash ? p.novaSlash() : null); } catch(_) {}
    } else if (playerP) {
      try { spawnAt(api, playerP, "novaSlash", { radius: 0.6, height: 1.2 }); } catch(_) {}
    }
    triggered = true;
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
          radius: ability.mineRadius ?? 5,
          anchorId: id ? String(id) : null,
        });
        spawnAt(api, mPos, "geoMineTick", { radius:0.5, height:0.6 });
      }
      flyingMsg(api, playerId, [{ str:"Mines deployed! ", style:{color:ability.color} }], ability.icon || "Damage Reduction");
    }
    dotMap.delete(String(mobId));
  }
  // ── Nova: charge per kill max 20
  else if (detectedSet === "Nova") {
    const maxC = ability.maxCharges ?? 20;
    const cur = novaCharges.get(k) || 0;
    const next = Math.min(maxC, cur + 1);
    novaCharges.set(k, next);
    try { flyingMsg(api, playerId, [{ str: `Nova +1 `, style:{color: ability.color} }, { str: `${next}/${maxC}` }], ability.icon || "Damage"); } catch(_) {}
    if (mobP) { try { spawnAt(api, mobP, "novaSlash", { radius: 0.6, height: 1.0 }); } catch(_) {} }
    else if (playerP) { try { spawnAt(api, playerP, "novaSlash", { radius: 0.6, height: 1.0 }); } catch(_) {} }
    dotMap.delete(String(mobId));
    astralGlowing.delete(String(mobId));
  }
  // ── Moonstone: no kill effect, just clean
  else if (detectedSet === "Moonstone") {
    dotMap.delete(String(mobId));
    astralGlowing.delete(String(mobId));
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

  // Nova: crescent + laser + speed
  try { novaCrescentTick(api, now); } catch(_) {}
  try { novaLaserTick(api, now); } catch(_) {}
  try { novaSpeedTick(api, now); } catch(_) {}

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
// ── throwable callbacks — Boomerang ne passe pas par onPlayerDamagingMob (melee), on le catch ici
export function onThrowableUsed(api, playerId, throwableName, thrownEntityId) {
  if (!throwableName || !thrownEntityId) return;
  const name = String(throwableName);
  if (!name.includes("Boomerang")) return;
  const meta = weaponMeta(name);
  if (!meta) return;
  throwableMap.set(String(thrownEntityId), { playerId: String(playerId), throwableName: name, setName: meta.setName, base: meta.base });
  // nettoyage auto après 8s (boomerang revient)
  try { scheduleTimeout(() => throwableMap.delete(String(thrownEntityId)), 160); } catch(_) {}
}
export function onCollision(api, eId, otherEId) {
  const a = String(eId), b = String(otherEId);
  let tInfo = throwableMap.get(a) || throwableMap.get(b);
  if (!tInfo) return;
  let mobId = throwableMap.has(a) ? otherEId : eId;
  // vérifie que l'autre est bien un mob (pas un joueur ni un autre throwable)
  try {
    if (typeof api.getEntityType === "function") {
      const ty = api.getEntityType(mobId);
      if (!ty || String(ty).toLowerCase().includes("player")) return;
    }
  } catch(_) {}
  if (deletedEntities.has(String(mobId))) return;
  // ne pas déclencher si mob déjà mort
  if (!isMobAlive(api, mobId)) return;
  const mobPos = posOf(api, mobId, null) || playerPos(api, tInfo.playerId);
  // déclenche la capacité comme un hit melee
  try {
    handleHit(api, tInfo.playerId, tInfo.setName, { baseDamage: tInfo.base, scaledDamage: tInfo.base, mobId, pos: mobPos, tick: globalTick });
  } catch(_) {}
  // dégâts supplémentaires du boomerang via handleHit extraDamage déjà gérés par damageMob dans handleHit, sinon on applique le dégât de base via le moteur (déjà fait)
}

// ── Nova crouch tracking ───────────────────────────────────────────────
export function onCrouchChange(api, playerId, isCrouching) {
  const k = keyOf(playerId);
  novaCrouch.set(k, !!isCrouching);
  // if player crouches and has charges + holding Nova, we can hint laser? Not auto fire, only on attack.
  // But also if crouching and we already have laser condition, we could trigger via attack handler
}
export function getNovaCharges(playerId) {
  return novaCharges.get(keyOf(playerId)) || 0;
}
export function _getNovaChargesMap() { return novaCharges; }
export function _getNovaLasers() { return novaLasers; }
export function setNovaCharges(playerId, n) {
  const k = keyOf(playerId);
  if (!Number.isFinite(n) || n <= 0) novaCharges.delete(k);
  else novaCharges.set(k, Math.max(0, Math.min(20, Math.floor(n))));
}
export function tryNovaLaser(api, playerId) {
  return triggerNovaLaser(api, playerId);
}
export function tryNovaCrescent(api, playerId) {
  return spawnNovaCrescent(api, playerId);
}
export function _getNovaCrescents() { return novaCrescents; }
export function isNovaCrouching(api, playerId) {
  return isPlayerCrouching(api, playerId);
}

export function forgetPlayer(playerId) {
  const k = keyOf(playerId);
  lastAbilityTick.delete(k);
  amethiteHits.delete(k);
  rubelliteStacks.delete(k);
  lastWeaponSet.delete(k);
  novaCharges.delete(k);
  novaCrouch.delete(k);
  novaLaserCooldown.delete(k);
  for (let i=novaLasers.length-1;i>=0;i--) if (String(novaLasers[i].playerId)===k) novaLasers.splice(i,1);
  for (let i=novaCrescents.length-1;i>=0;i--) if (String(novaCrescents[i].ownerId)===k) novaCrescents.splice(i,1);
  novaCrescentCooldown.delete(k);
  for (const [mid, e] of [...dotMap.entries()]) if (String(e.ownerId)===k) dotMap.delete(mid);
  for (let i=geoMines.length-1;i>=0;i--) if (String(geoMines[i].ownerId)===k) geoMines.splice(i,1);
  for (const [mid,e] of [...astralGlowing.entries()]) if (String(e.ownerId)===k) astralGlowing.delete(mid);
  for (const [tid, info] of [...throwableMap.entries()]) if (String(info.playerId)===k) throwableMap.delete(tid);
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
  novaCharges.clear();
  novaCrouch.clear();
  novaLaserCooldown.clear();
  novaLasers.length=0;
  novaCrescents.length=0;
  novaCrescentCooldown.clear();
  deletedEntities.clear();
  throwableMap.clear();
  globalTick=0;
}
export function _getLastAbilityTickMap() { return lastAbilityTick; }
export function _getDotMap() { return dotMap; }
export function _getRubelliteStacks() { return rubelliteStacks; }
export function _getMines() { return geoMines; }
export function _getGlowing() { return astralGlowing; }
export function _getAmethiteHits() { return amethiteHits; }
