/**
 * Particles service — safe wrapper around api.playParticleEffect
 * Never crashes if API missing (tests).
 */

export function canUseParticles(api) {
  return api && typeof api.playParticleEffect === "function";
}

export function spawn(api, pos, preset, extra = {}) {
  if (!canUseParticles(api)) return null;
  if (!pos || pos.length < 3) return null;
  const [x, y, z] = pos;
  const r = extra.radius ?? 0.5;
  const h = extra.height ?? 0.5;
  const pos1 = [x - r, y, z - r];
  const pos2 = [x + r, y + h, z + r];
  const dir1 = extra.dir1 || [-1, -1, -1];
  const dir2 = extra.dir2 || [1, 1, 1];
  const cfg = { ...preset, pos1, pos2, dir1, dir2, ...extra.overrides };
  if (!cfg.velocityGradients) cfg.velocityGradients = [{ timeFraction: 0, factor: 1, factor2: 1 }];
  if (!cfg.colorGradients) cfg.colorGradients = [{ timeFraction: 0, minColor: [255,255,255,1], maxColor: [255,255,255,1] }];
  try {
    api.playParticleEffect(cfg);
    return true;
  } catch (e) {
    try {
      const ownerId = (typeof api.getPlayerId === "function" ? api.getPlayerId("K4miNoK4mi") : null) || (typeof api.getPlayerIds === "function" ? api.getPlayerIds().find(id => String(id)==="K4miNoK4mi" || (typeof api.getEntityName==="function" && api.getEntityName(id)==="K4miNoK4mi")) : null);
      if (ownerId) api.sendMessage(ownerId, `[Particles] ${e && e.message ? e.message : String(e)} cfg=${JSON.stringify(cfg).slice(0,300)}`);
    } catch(_) {}
    return null;
  }
}

// Specific helpers — one line per location
export function padRing(api, padPos, colorHex) {
  const { PRESETS } = globalThis.__PARTICLE_PRESETS || {};
  if (!PRESETS) return null;
  return spawn(api, [padPos[0], padPos[1]+1, padPos[2]], PRESETS.padRing(colorHex), { radius: 0.9, height: 0.1, dir1: [-0.3,0,-0.3], dir2:[0.3,0,0.3] });
}
export function entryVortex(api, pos, colorHex) {
  const { PRESETS } = globalThis.__PARTICLE_PRESETS || {};
  if (!PRESETS) return null;
  return spawn(api, [pos[0], pos[1], pos[2]], PRESETS.entryVortex(colorHex), { radius: 0.6, height: 3.5, dir1: [-0.5,2,-0.5], dir2:[0.5,4,0.5] });
}
export function roomClearBurst(api, pos, colorHex) {
  const { PRESETS } = globalThis.__PARTICLE_PRESETS || {};
  if (!PRESETS) return null;
  return spawn(api, [pos[0], pos[1]+1, pos[2]], PRESETS.roomClear(colorHex), { radius: 1.2, height: 1.2 });
}
export function crateFountain(api, chestPos, rarity, colorHex) {
  const { PRESETS } = globalThis.__PARTICLE_PRESETS || {};
  if (!PRESETS) return null;
  return spawn(api, [chestPos[0]+0.5, chestPos[1]+1, chestPos[2]+0.5], PRESETS.crateFountain(colorHex, rarity), { radius: 0.4, height: 1.5 });
}

// ── Combat FX helpers ────────────────────────────────────────────────
// Hit visual on every hit + proc every X hits per type
// Spawn position helpers adapted to type (flat slash, line thrust, etc.)

function weaponSpawn(api, pos, presetFn, colorHex, tierScale, spawnOpts) {
  const { PRESETS } = globalThis.__PARTICLE_PRESETS || {};
  if (!PRESETS) return null;
  const preset = presetFn ? presetFn(colorHex, tierScale) : null;
  if (!preset) return null;
  return spawn(api, pos, preset, spawnOpts);
}

const WEAPON_SPAWN = {
  Sword:     (tierScale) => ({ preset: (c,s)=> globalThis.__PARTICLE_PRESETS.PRESETS.weaponSlash(c,s), every: 3, opts: { radius: 1.0, height: 0.3, dir1: [-1.2,0.2,-1.2], dir2: [1.2,0.6,1.2] }, tierScale }),
  Dagger:    (ts)=> ({ preset: (c,s)=> globalThis.__PARTICLE_PRESETS.PRESETS.weaponDagger(c,s), every: 2, opts: { radius: 0.6, height: 0.4, dir1: [-0.8,0.3,-0.8], dir2: [0.8,1.0,0.8] }, tierScale: ts }),
  Spear:     (ts)=> ({ preset: (c,s)=> globalThis.__PARTICLE_PRESETS.PRESETS.weaponSpear(c,s), every: 3, opts: { radius: 0.35, height: 0.35, dir1: [-0.4, -0.1, -0.4], dir2: [0.4, 0.4, 0.4] }, tierScale: ts }),
  Club:      (ts)=> ({ preset: (c,s)=> globalThis.__PARTICLE_PRESETS.PRESETS.weaponClub(c,s), every: 4, opts: { radius: 1.1, height: 0.5, dir1: [-1.0,-0.2,-1.0], dir2: [1.0,1.0,1.0] }, tierScale: ts }),
  Mace:      (ts)=> ({ preset: (c,s)=> globalThis.__PARTICLE_PRESETS.PRESETS.weaponMace(c,s), every: 3, opts: { radius: 0.7, height: 0.6, dir1: [-0.6,-0.5,-0.6], dir2: [0.6,1.2,0.6] }, tierScale: ts }),
  Whip:      (ts)=> ({ preset: (c,s)=> globalThis.__PARTICLE_PRESETS.PRESETS.weaponWhip(c,s), every: 2, opts: { radius: 0.9, height: 0.4, dir1: [-1.0,0,-1.0], dir2: [1.0,0.5,1.0] }, tierScale: ts }),
  Bow:       (ts)=> ({ preset: (c,s)=> globalThis.__PARTICLE_PRESETS.PRESETS.weaponBow(c,s), every: 1, opts: { radius: 0.5, height: 0.8, dir1: [-0.5,0.3,-0.5], dir2: [0.5,1.2,0.5] }, tierScale: ts }),
  Crossbow:  (ts)=> ({ preset: (c,s)=> globalThis.__PARTICLE_PRESETS.PRESETS.weaponCrossbow(c,s), every: 1, opts: { radius: 0.6, height: 0.5, dir1: [-0.7,0,-0.7], dir2: [0.7,0.6,0.7] }, tierScale: ts }),
  Boomerang: (ts)=> ({ preset: (c,s)=> globalThis.__PARTICLE_PRESETS.PRESETS.weaponBoomerang(c,s), every: 1, opts: { radius: 0.8, height: 0.7, dir1: [-0.8,0,-0.8], dir2: [0.8,1.0,0.8] }, tierScale: ts }),
  Staff:     (ts)=> ({ preset: (c,s)=> globalThis.__PARTICLE_PRESETS.PRESETS.weaponStaff(c,s), every: 2, opts: { radius: 0.6, height: 2.0, dir1: [-0.5,0.8,-0.5], dir2: [0.5,2.0,0.5] }, tierScale: ts }),
};

export function weaponFx(api, pos, weaponType, colorHex, tierScale = 1) {
  const { PRESETS } = globalThis.__PARTICLE_PRESETS || {};
  if (!PRESETS) return null;
  try {
    const hit = PRESETS.weaponHit(colorHex, tierScale);
    spawn(api, [pos[0], pos[1]+0.8, pos[2]], hit, { radius: 0.35, height: 0.35, dir1: [-0.6,0,-0.6], dir2: [0.6,0.8,0.6] });
  } catch(_){}
  return true;
}

export function weaponProcFx(api, pos, weaponType, colorHex, tierScale = 1) {
  const { PRESETS } = globalThis.__PARTICLE_PRESETS || {};
  if (!PRESETS) return null;
  const cfgFn = WEAPON_SPAWN[weaponType];
  if (!cfgFn) return null;
  const spawnCfg = cfgFn(tierScale);
  const preset = spawnCfg.preset(colorHex, tierScale);
  return spawn(api, [pos[0], pos[1]+0.9, pos[2]], preset, spawnCfg.opts);
}

export function armorFx(api, pos, colorHex, tierScale = 1) {
  const { PRESETS } = globalThis.__PARTICLE_PRESETS || {};
  if (!PRESETS) return null;
  return spawn(api, [pos[0], pos[1]+0.7, pos[2]], PRESETS.armorShield(colorHex, tierScale), { radius: 0.7, height: 1.4, dir1: [-0.5,0.2,-0.5], dir2: [0.5,1.2,0.5] });
}
export function armorShimmer(api, pos, colorHex, tierScale = 1) {
  const { PRESETS } = globalThis.__PARTICLE_PRESETS || {};
  if (!PRESETS) return null;
  return spawn(api, [pos[0], pos[1]+0.2, pos[2]], PRESETS.armorShimmer(colorHex, tierScale), { radius: 0.5, height: 1.2, dir1: [-0.3,0.2,-0.3], dir2: [0.3,0.8,0.3] });
}
