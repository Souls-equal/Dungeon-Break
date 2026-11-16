/**
 * Particles service — safe wrapper autour de api.playParticleEffect
 * Ne crash jamais si API manquante (tests).
 */

export function canUseParticles(api) {
  return api && typeof api.playParticleEffect === "function";
}

export function spawn(api, pos, preset, extra = {}) {
  if (!canUseParticles(api)) return null;
  if (!pos || pos.length < 3) return null;
  const [x, y, z] = pos;
  // pos1/pos2 définissent la zone d’émission (petite boîte autour du centre)
  const r = extra.radius ?? 0.5;
  const h = extra.height ?? 0.5;
  const pos1 = [x - r, y, z - r];
  const pos2 = [x + r, y + h, z + r];
  // dir1/dir2 = dispersion vitesse
  const dir1 = extra.dir1 || [-1, -1, -1];
  const dir2 = extra.dir2 || [1, 1, 1];
  const cfg = { ...preset, pos1, pos2, dir1, dir2, ...extra.overrides };
  try {
    api.playParticleEffect(cfg);
    return true;
  } catch (_) {
    return null;
  }
}

// Helpers spécifiques — 1 ligne par endroit
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
