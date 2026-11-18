/**
 * Armor catalog — 13 sets × 5 levels, centralized.
 * Each set defines color, tier, particles and per-level params.
 * Numbers are balanced for PvE dungeon (not overpowered).
 */

export const ARMOR_IDS = [
  "Amethite","Magmasteel","Rubellite","Serpentite",
  "Cursemetal","Kingly Amethite","Kingly Diamond",
  "Sanguine","Spectral","Geo",
  "Astral","Voltplate","Nova"
];

export const ARMOR_SETS = {
  Amethite: {
    id: "Amethite", label: "Amethite", tier: 1, color: "#9B59B6", colors: ["#9B59B6","#D8B4FE"],
    type: "Magic / Area damage",
    particles: { wave: "amethiteWave", charge: "amethiteCharge", circle: "amethystZone" },
    cooldownTicks: 30,
    levels: {
      1: { desc: "Chance to release a small purple arcane wave when hit.", chance: 0.15, damage: 6, radius: 2.5, knock: 0, maxHits: 1 },
      2: { desc: "Increase the wave's damage.", chance: 0.17, damage: 9, radius: 2.8, knock: 0, maxHits: 2 },
      3: { desc: "Increase the wave's radius.", chance: 0.19, damage: 11, radius: 3.5, knock: 0, maxHits: 2 },
      4: { desc: "The wave slightly pushes nearby enemies.", chance: 0.21, damage: 12, radius: 3.5, knock: 0.6, maxHits: 3 },
      5: { desc: "The wave damages multiple enemies and becomes significantly stronger.", chance: 0.25, damage: 16, radius: 4.5, knock: 0.9, maxHits: 5, extraMult: 1.3 },
    }
  },
  Magmasteel: {
    id: "Magmasteel", label: "Magmasteel", tier: 1, color: "#E67E22", colors: ["#E67E22","#FF7700"],
    type: "Fire / Lava resistance",
    particles: { lava: "magmaLavaProtect", burn: "magmaBurn", explosion: "magmaExplosion" },
    levels: {
      1: { desc: "Protection against lava damage.", lavaResist: 0.25, burnChance: 0, burnDmg: 0, burnDur: 0 },
      2: { desc: "Increased lava damage protection.", lavaResist: 0.45, burnChance: 0, burnDmg: 0, burnDur: 0 },
      3: { desc: "Enemies hitting the player have a chance to receive a burning effect.", lavaResist: 0.45, burnChance: 0.14, burnDmg: 2, burnDur: 60, burnInterval: 20 },
      4: { desc: "Burning lasts longer and deals more damage.", lavaResist: 0.50, burnChance: 0.16, burnDmg: 3, burnDur: 100, burnInterval: 20 },
      5: { desc: "When a burning enemy dies, it explodes and spreads burning to nearby enemies.", lavaResist: 0.60, burnChance: 0.18, burnDmg: 3, burnDur: 100, burnInterval: 20, explosion: { radius: 3.2, damage: 8, spreadBurn: true } },
    }
  },
  Rubellite: {
    id: "Rubellite", label: "Rubellite", tier: 1, color: "#E91E63", colors: ["#E91E63","#FF88CC"],
    type: "Healing / Regeneration",
    particles: { kill: "rubelliteKillZone", regen: "rubelliteRegen", maxAura: "rubelliteMaxAura" },
    levels: {
      1: { desc: "Killing a mob restores a small amount of health.", healOnKill: 3, regenMs: 0, regenLevel: 0, maxLevel: 0, excessToShield: 0 },
      2: { desc: "Each kill applies Health Regen for 15 seconds.", healOnKill: 4, regenMs: 15000, regenLevel: 1, maxLevel: 1, excessToShield: 0, windowTicks: [Infinity] },
      3: { desc: "Consecutive kills progressively increase the regeneration level.", healOnKill: 4, regenMs: 15000, regenLevel: 1, maxLevel: 2, excessToShield: 0, windowTicks: [200,180] },
      4: { desc: "Increase the maximum regeneration level.", healOnKill: 5, regenMs: 15000, regenLevel: 1, maxLevel: 3, excessToShield: 0, windowTicks: [200,180,160] },
      5: { desc: "At maximum regeneration, excess healing can be converted into shield.", healOnKill: 5, regenMs: 15000, regenLevel: 1, maxLevel: 3, excessToShield: 0.5, windowTicks: [200,180,160] },
    }
  },
  Serpentite: {
    id: "Serpentite", label: "Serpentite", tier: 1, color: "#32CD32", colors: ["#32CD32","#2ECC71"],
    type: "Poison / Debuff",
    particles: { apply: "serpentPoison", active: "serpentActive", spread: "serpentSpread" },
    levels: {
      1: { desc: "Enemies hitting the player have a chance to become poisoned.", poisonChance: 0.15, poisonDmg: 1, poisonDur: 60, poisonInterval: 20, debuff: 0 },
      2: { desc: "Poison lasts longer.", poisonChance: 0.17, poisonDmg: 1, poisonDur: 100, poisonInterval: 20, debuff: 0 },
      3: { desc: "Increase poison damage.", poisonChance: 0.18, poisonDmg: 2, poisonDur: 100, poisonInterval: 20, debuff: 0 },
      4: { desc: "Poisoned enemies deal less damage.", poisonChance: 0.20, poisonDmg: 2, poisonDur: 120, poisonInterval: 20, debuff: 0.15 },
      5: { desc: "When a poisoned enemy dies, poison spreads to nearby enemies.", poisonChance: 0.22, poisonDmg: 2, poisonDur: 120, poisonInterval: 20, debuff: 0.15, spreadRadius: 4, spreadCount: 2 },
    }
  },
  Cursemetal: {
    id: "Cursemetal", label: "Cursemetal", tier: 2, color: "#87CEEB", colors: ["#87CEEB","#111111"],
    type: "Curse / Debuff",
    particles: { apply: "curseApply", active: "curseActive", spread: "curseSpread", explosion: "curseExplosion" },
    levels: {
      1: { desc: "Enemies hitting the player have a chance to become cursed.", curseChance: 0.14, dmgTakenMult: 1.0, dmgDealtMult: 1.0, spread: 0, explosion: null },
      2: { desc: "Cursed enemies receive increased damage.", curseChance: 0.16, dmgTakenMult: 1.15, dmgDealtMult: 1.0, spread: 0, explosion: null },
      3: { desc: "Cursed enemies deal reduced damage.", curseChance: 0.18, dmgTakenMult: 1.20, dmgDealtMult: 0.85, spread: 0, explosion: null },
      4: { desc: "When a cursed enemy dies, its curse spreads to a nearby enemy.", curseChance: 0.19, dmgTakenMult: 1.22, dmgDealtMult: 0.82, spread: 1, spreadRadius: 5, explosion: null },
      5: { desc: "A cursed enemy's death triggers a dark explosion damaging nearby enemies.", curseChance: 0.21, dmgTakenMult: 1.25, dmgDealtMult: 0.80, spread: 1, spreadRadius: 5, explosion: { radius: 3.5, damage: 10 } },
    }
  },
  "Kingly Amethite": {
    id: "Kingly Amethite", label: "Kingly Amethite", tier: 2, color: "#9B59B6", colors: ["#9B59B6","#FFFFFF"],
    type: "Magic / Ability enhancement",
    particles: { activation: "kinglyAmethiteActivation", accumulation: "kinglyAmethiteAccum", circle: "kinglyAmethiteCircle", explosion: "kinglyAmethiteExplosion" },
    levels: {
      1: { desc: "Slightly increase ability damage.", abilityDmgMult: 1.10, costRed: 0, consecutiveBonus: 0, aoeBonus: 0, explosionAfter: 0 },
      2: { desc: "Slightly reduce ability energy cost.", abilityDmgMult: 1.12, costRed: 0.12, consecutiveBonus: 0, aoeBonus: 0, explosionAfter: 0 },
      3: { desc: "Using several abilities consecutively temporarily increases their power.", abilityDmgMult: 1.12, costRed: 0.12, consecutiveBonus: 0.20, consecutiveWindow: 160, consecutiveBuffDur: 100, consecutiveNeed: 3, aoeBonus: 0, explosionAfter: 0 },
      4: { desc: "Increase ability area of effect.", abilityDmgMult: 1.14, costRed: 0.12, consecutiveBonus: 0.20, consecutiveWindow: 160, consecutiveBuffDur: 100, consecutiveNeed: 3, aoeBonus: 1.0, explosionAfter: 0 },
      5: { desc: "After several ability uses, the next ability triggers an additional arcane explosion.", abilityDmgMult: 1.15, costRed: 0.15, consecutiveBonus: 0.22, consecutiveWindow: 160, consecutiveBuffDur: 100, consecutiveNeed: 3, aoeBonus: 1.2, explosionAfter: 5, explosion: { radius: 3.2, damage: 12 } },
    }
  },
  "Kingly Diamond": {
    id: "Kingly Diamond", label: "Kingly Diamond", tier: 2, color: "#FFD700", colors: ["#FFD700","#FFFFFF"],
    type: "Defense / Shield",
    particles: { shieldGen: "kinglyDiamondShieldGen", active: "kinglyDiamondActive", breakFx: "kinglyDiamondBreak", ultimate: "kinglyDiamondUltimate" },
    levels: {
      1: { desc: "Slightly increase player defense.", defense: 0.05, shieldConvert: 0, shieldBreak: null, lowHealth: null },
      2: { desc: "Convert part of received damage into shield.", defense: 0.06, shieldConvert: 0.15, shieldBreak: null, lowHealth: null },
      3: { desc: "Increase shield generated.", defense: 0.07, shieldConvert: 0.25, shieldBreak: null, lowHealth: null },
      4: { desc: "When the shield breaks, release a shockwave pushing nearby enemies.", defense: 0.08, shieldConvert: 0.25, shieldBreak: { radius: 4, push: 0.9, damage: 6 }, lowHealth: null },
      5: { desc: "When the player's health falls below a threshold, temporarily grant a significant defense and shield bonus.", defense: 0.08, shieldConvert: 0.28, shieldBreak: { radius: 4.2, push: 1.0, damage: 7 }, lowHealth: { threshold: 0.35, defenseBonus: 0.30, shield: 10, duration: 160, cooldown: 400 } },
    }
  },
  Sanguine: {
    id: "Sanguine", label: "Sanguine", tier: 3, color: "#8B0000", colors: ["#8B0000","#000000"],
    type: "Lifesteal / Offensive healing",
    particles: { drain: "sanguineDrainMob", heal: "sanguineHealPlayer", wave: "sanguineWave", explosion: "sanguineExplosion" },
    levels: {
      1: { desc: "Convert a small percentage of damage dealt into health.", lifesteal: 0.04, excessToShield: 0, killWaveHeal: 0, killExplosion: null },
      2: { desc: "Increase lifesteal percentage.", lifesteal: 0.07, excessToShield: 0, killWaveHeal: 0, killExplosion: null },
      3: { desc: "Excess healing generates shield.", lifesteal: 0.07, excessToShield: 0.5, killWaveHeal: 0, killExplosion: null },
      4: { desc: "Killing an enemy releases a small blood wave that heals the player.", lifesteal: 0.08, excessToShield: 0.5, killWaveHeal: 6, killExplosion: null },
      5: { desc: "Every kill triggers a blood explosion damaging nearby enemies and healing the player.", lifesteal: 0.09, excessToShield: 0.5, killWaveHeal: 6, killExplosion: { radius: 3.5, damage: 10, heal: 5 } },
    }
  },
  Spectral: {
    id: "Spectral", label: "Spectral", tier: 3, color: "#00D4C8", colors: ["#00D4C8","#111111"],
    type: "Invisibility / Crowd control",
    particles: { invis: "spectralInvis", reappear: "spectralReappear", spiral: "spectralSpiral", explosion: "spectralExplosion" },
    levels: {
      1: { desc: "After receiving a hit, the player becomes invisible for a short duration.", invisDur: 30, speedBonus: 0, attract: null, explosion: null },
      2: { desc: "Increase invisibility duration.", invisDur: 50, speedBonus: 0, attract: null, explosion: null },
      3: { desc: "Invisibility grants a temporary movement speed bonus.", invisDur: 50, speedBonus: 0.25, speedDur: 60, attract: null, explosion: null },
      4: { desc: "When an enemy dies, nearby enemies are attracted toward its death location.", invisDur: 55, speedBonus: 0.25, speedDur: 60, attract: { radius: 6, strength: 1.0 }, explosion: null },
      5: { desc: "The attraction is followed by a spectral explosion dealing area damage.", invisDur: 60, speedBonus: 0.30, speedDur: 70, attract: { radius: 6.5, strength: 1.2 }, explosion: { radius: 4, damage: 10, delay: 10 } },
    }
  },
  Geo: {
    id: "Geo", label: "Geo", tier: 3, color: "#D4A574", colors: ["#D4A574","#000000"],
    type: "Shield / Mines",
    particles: { shield: "geoShield", seismic: "geoSeismic", mineAppear: "geoMineTick", mineExplosion: "geoMineExplosion" },
    levels: {
      1: { desc: "Each received hit grants a small amount of shield.", shield: 2, shieldCap: 12, seismicEvery: 0, seismic: null, mines: null },
      2: { desc: "Increase shield generated.", shield: 3, shieldCap: 14, seismicEvery: 0, seismic: null, mines: null },
      3: { desc: "After receiving several hits, trigger a seismic wave around the player.", shield: 3, shieldCap: 14, seismicEvery: 5, seismic: { radius: 3.5, damage: 8, push: 0.5 }, mines: null },
      4: { desc: "When an enemy dies, mines appear around nearby enemies.", shield: 3, shieldCap: 14, seismicEvery: 5, seismic: { radius: 3.5, damage: 8, push: 0.5 }, mines: { count: 2, damage: 6, radius: 2.5, delay: 60, chain: false } },
      5: { desc: "Mines deal increased damage and can trigger chain explosions.", shield: 4, shieldCap: 16, seismicEvery: 5, seismic: { radius: 4, damage: 10, push: 0.6 }, mines: { count: 3, damage: 9, radius: 3, delay: 60, chain: true, chainRadius: 3.2 } },
    }
  },
  Astral: {
    id: "Astral", label: "Astral", tier: 4, color: "#8A2BE2", colors: ["#8A2BE2","#111111"],
    type: "Crowd control / Damage over time",
    particles: { slow: "astralAura", glowing: "astralGlowing", tornado: "astralTornado", aura: "astralAura" },
    levels: {
      1: { desc: "Nearby enemies are slightly slowed.", slow: 0.20, slowRadius: 4, slowDmgMult: 0, glowing: null, aura: null },
      2: { desc: "Slowed enemies receive increased damage.", slow: 0.20, slowRadius: 4, slowDmgMult: 0.15, glowing: null, aura: null },
      3: { desc: "Increase the radius of the slowing aura.", slow: 0.22, slowRadius: 6, slowDmgMult: 0.15, glowing: null, aura: null },
      4: { desc: "Killing an enemy applies Glowing to nearby enemies for a short duration.", slow: 0.22, slowRadius: 6, slowDmgMult: 0.18, glowing: { radius: 8, duration: 200, extraDmg: 0.15 }, aura: null },
      5: { desc: "A persistent astral aura surrounds the player, slowing and damaging nearby enemies.", slow: 0.25, slowRadius: 6.5, slowDmgMult: 0.20, glowing: { radius: 9, duration: 200, extraDmg: 0.18 }, aura: { radius: 6, dps: 2, interval: 20, slowDur: 40 } },
    }
  },
  Voltplate: {
    id: "Voltplate", label: "Voltplate", tier: 4, color: "#00E5FF", colors: ["#78909C","#00E5FF"],
    type: "Electricity / Chain attacks",
    particles: { discharge: "voltplateDischarge", chain: "voltplateChain", charge: "voltplateCharge", ultimate: "voltplateUltimate" },
    levels: {
      1: { desc: "Chance to release an electric discharge when an enemy hits the player.", dischargeChance: 0.18, dischargeDmg: 5, dischargeRadius: 2.5, dischargeTargets: 1, slow: 0, charges: null, chainUltimate: null },
      2: { desc: "Increase discharge damage.", dischargeChance: 0.20, dischargeDmg: 7, dischargeRadius: 2.8, dischargeTargets: 1, slow: 0, charges: null, chainUltimate: null },
      3: { desc: "The discharge can hit multiple nearby enemies.", dischargeChance: 0.22, dischargeDmg: 8, dischargeRadius: 3.5, dischargeTargets: 3, slow: 0, charges: null, chainUltimate: null },
      4: { desc: "Hit enemies are briefly slowed.", dischargeChance: 0.23, dischargeDmg: 9, dischargeRadius: 3.5, dischargeTargets: 3, slow: { chance: 1.0, duration: 40, level: 1 }, charges: null, chainUltimate: null },
      5: { desc: "Each successful discharge grants an electrical charge. At maximum charges, trigger a powerful chain lightning.", dischargeChance: 0.25, dischargeDmg: 10, dischargeRadius: 3.8, dischargeTargets: 3, slow: { chance: 1.0, duration: 40, level: 1 }, charges: { max: 5, perDischarge: 1 }, chainUltimate: { damage: 12, hits: 5, radius: 6, consume: true } },
    }
  },
  Nova: {
    id: "Nova", label: "Nova", tier: 4, color: "#FFFFFF", colors: ["#FFFFFF","#32CD32"],
    type: "Explosion / Charge accumulation",
    particles: { orbit: "novaOrbit", bright: "novaBright", small: "novaSmall", major: "novaMajor" },
    levels: {
      1: { desc: "Each enemy killed grants one Nova charge.", chargePerKill: 1, maxCharges: 4, dmgPerCharge: 0.02, smallAt: 0, majorAt: 0, small: null, major: null },
      2: { desc: "Charges progressively increase damage dealt.", chargePerKill: 1, maxCharges: 4, dmgPerCharge: 0.035, smallAt: 0, majorAt: 0, small: null, major: null },
      3: { desc: "Increase maximum number of charges.", chargePerKill: 1, maxCharges: 7, dmgPerCharge: 0.035, smallAt: 0, majorAt: 0, small: null, major: null },
      4: { desc: "At a certain number of charges, automatically trigger a small explosion around the player.", chargePerKill: 1, maxCharges: 7, dmgPerCharge: 0.035, smallAt: 4, small: { radius: 3, damage: 8 }, majorAt: 0, major: null },
      5: { desc: "Reaching maximum charges triggers a major Nova explosion damaging nearby enemies and consuming all charges.", chargePerKill: 1, maxCharges: 10, dmgPerCharge: 0.04, smallAt: 4, small: { radius: 3.2, damage: 9 }, majorAt: 10, major: { radius: 5, damage: 18, consume: true } },
    }
  },
};

export function armorLevelForCount(count) {
  const n = Math.max(0, Math.min(5, Math.floor(count)||0));
  return n;
}
export function getArmorDef(setId) {
  return ARMOR_SETS[setId] || null;
}
export function getLevelDef(setId, level) {
  const set = ARMOR_SETS[setId];
  if (!set) return null;
  const l = Math.max(1, Math.min(5, level|0));
  return set.levels[l] || null;
}
export function allArmorIds() { return ARMOR_IDS.slice(); }
export function validateArmorCatalog() {
  const errs = [];
  for (const id of ARMOR_IDS) {
    const s = ARMOR_SETS[id];
    if (!s) { errs.push(`missing ${id}`); continue; }
    if (!s.tier || !s.color) errs.push(`${id} missing tier/color`);
    for (let i=1;i<=5;i++) if (!s.levels[i]) errs.push(`${id} missing level ${i}`);
  }
  return errs;
}
