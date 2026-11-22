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
      1: { desc: "When hit: 15% chance to emit a wave dealing 6 damage in 5 blocks (1 target).", chance: 0.15, damage: 6, radius: 5, knock: 0, maxHits: 1 },
      2: { desc: "When hit: 17% chance to emit a wave dealing 9 damage in 5.5 blocks (2 targets).", chance: 0.17, damage: 9, radius: 5.5, knock: 0, maxHits: 2 },
      3: { desc: "When hit: 19% chance to emit a wave dealing 11 damage in 6 blocks (2 targets).", chance: 0.19, damage: 11, radius: 6, knock: 0, maxHits: 2 },
      4: { desc: "When hit: 21% chance to emit a wave dealing 12 damage in 6.5 blocks, hitting 3 targets and pushing them.", chance: 0.21, damage: 12, radius: 6.5, knock: 0.6, maxHits: 3 },
      5: { desc: "When hit: 25% chance to emit a wave dealing 16 damage in 7 blocks, hitting 5 targets with strong knockback.", chance: 0.25, damage: 16, radius: 7, knock: 0.9, maxHits: 5, extraMult: 1.3 },
    }
  },
  Magmasteel: {
    id: "Magmasteel", label: "Magmasteel", tier: 1, color: "#E67E22", colors: ["#E67E22","#FF7700"],
    type: "Fire / Lava resistance",
    particles: { lava: "magmaLavaProtect", burn: "magmaBurn", explosion: "magmaExplosion" },
    levels: {
      1: { desc: "Grants Heat Resistance (immune to lava/fire).", burnChance: 0, burnDmg: 0, burnDur: 0 },
      2: { desc: "Grants Heat Resistance.", burnChance: 0, burnDmg: 0, burnDur: 0 },
      3: { desc: "Grants Heat Resistance. When hit: 14% chance to burn attacker for 2 damage/sec over 3s.", burnChance: 0.14, burnDmg: 2, burnDur: 60, burnInterval: 20 },
      4: { desc: "Grants Heat Resistance. When hit: 16% chance to burn for 3 damage/sec over 5s.", burnChance: 0.16, burnDmg: 3, burnDur: 100, burnInterval: 20 },
      5: { desc: "Grants Heat Resistance. When hit: 18% chance to burn (3 dmg/sec, 5s). Burning enemies explode on death (8 dmg, 5 radius) and spread burn.", burnChance: 0.18, burnDmg: 3, burnDur: 100, burnInterval: 20, explosion: { radius: 5, damage: 8, spreadBurn: true } },
    }
  },
  Rubellite: {
    id: "Rubellite", label: "Rubellite", tier: 1, color: "#E91E63", colors: ["#E91E63","#FF88CC"],
    type: "Healing / Regeneration",
    particles: { kill: "rubelliteKillZone", regen: "rubelliteRegen", maxAura: "rubelliteMaxAura" },
    levels: {
      1: { desc: "On kill: heal 3 HP.", healOnKill: 3, regenMs: 0, regenLevel: 0, maxLevel: 0, excessToShield: 0 },
      2: { desc: "On kill: heal 4 HP and gain Health Regen for 15s.", healOnKill: 4, regenMs: 15000, regenLevel: 1, maxLevel: 1, excessToShield: 0, windowTicks: [Infinity] },
      3: { desc: "On kill: heal 4 HP + Regen 15s. Kill again within 10s to upgrade to Regen II.", healOnKill: 4, regenMs: 15000, regenLevel: 1, maxLevel: 2, excessToShield: 0, windowTicks: [200,180] },
      4: { desc: "On kill: heal 5 HP + Regen 15s. Chain kills within 10s/9s to reach Regen III (max).", healOnKill: 5, regenMs: 15000, regenLevel: 1, maxLevel: 3, excessToShield: 0, windowTicks: [200,180,160] },
      5: { desc: "On kill: heal 5 HP + Regen 15s. Chain to Regen III. At max, excess healing becomes shield.", healOnKill: 5, regenMs: 15000, regenLevel: 1, maxLevel: 3, excessToShield: 0.5, windowTicks: [200,180,160] },
    }
  },
  Serpentite: {
    id: "Serpentite", label: "Serpentite", tier: 1, color: "#32CD32", colors: ["#32CD32","#2ECC71"],
    type: "Poison / Debuff",
    particles: { apply: "serpentPoison", active: "serpentActive", spread: "serpentSpread" },
    levels: {
      1: { desc: "When hit: 15% chance to poison attacker (1 dmg/sec for 3s).", poisonChance: 0.15, poisonDmg: 1, poisonDur: 60, poisonInterval: 20, debuff: 0 },
      2: { desc: "When hit: 17% chance to poison (1 dmg/sec for 5s).", poisonChance: 0.17, poisonDmg: 1, poisonDur: 100, poisonInterval: 20, debuff: 0 },
      3: { desc: "When hit: 18% chance to poison (2 dmg/sec for 5s).", poisonChance: 0.18, poisonDmg: 2, poisonDur: 100, poisonInterval: 20, debuff: 0 },
      4: { desc: "When hit: 20% chance to poison (2 dmg/sec for 6s). Poisoned enemies deal 15% less damage.", poisonChance: 0.20, poisonDmg: 2, poisonDur: 120, poisonInterval: 20, debuff: 0.15 },
      5: { desc: "When hit: 22% chance to poison (2 dmg/sec, 6s, -15% dmg). On death, poison spreads to 2 enemies within 5 blocks.", poisonChance: 0.22, poisonDmg: 2, poisonDur: 120, poisonInterval: 20, debuff: 0.15, spreadRadius: 5, spreadCount: 2 },
    }
  },
  Cursemetal: {
    id: "Cursemetal", label: "Cursemetal", tier: 2, color: "#87CEEB", colors: ["#87CEEB","#111111"],
    type: "Curse / Debuff",
    particles: { apply: "curseApply", active: "curseActive", spread: "curseSpread", explosion: "curseExplosion" },
    levels: {
      1: { desc: "When hit: 14% chance to curse attacker for 10s.", curseChance: 0.14, dmgTakenMult: 1.0, dmgDealtMult: 1.0, spread: 0, explosion: null },
      2: { desc: "When hit: 16% chance to curse. Cursed enemies take +15% damage.", curseChance: 0.16, dmgTakenMult: 1.15, dmgDealtMult: 1.0, spread: 0, explosion: null },
      3: { desc: "When hit: 18% chance to curse. Cursed take +20% damage and deal -15%.", curseChance: 0.18, dmgTakenMult: 1.20, dmgDealtMult: 0.85, spread: 0, explosion: null },
      4: { desc: "When hit: 19% chance to curse (+22% taken, -18% dealt). On cursed death, spread to 1 enemy within 5 blocks.", curseChance: 0.19, dmgTakenMult: 1.22, dmgDealtMult: 0.82, spread: 1, spreadRadius: 5, explosion: null },
      5: { desc: "When hit: 21% chance to curse (+25% taken, -20% dealt). Spread on death + explosion (10 dmg, 5 radius).", curseChance: 0.21, dmgTakenMult: 1.25, dmgDealtMult: 0.80, spread: 1, spreadRadius: 5, explosion: { radius: 5, damage: 10 } },
    }
  },
  "Kingly Amethite": {
    id: "Kingly Amethite", label: "Kingly Amethite", tier: 2, color: "#9B59B6", colors: ["#9B59B6","#FFFFFF"],
    type: "Magic / Ability enhancement",
    particles: { activation: "kinglyAmethiteActivation", accumulation: "kinglyAmethiteAccum", circle: "kinglyAmethiteCircle", explosion: "kinglyAmethiteExplosion" },
    levels: {
      1: { desc: "Ability damage +10%.", abilityDmgMult: 1.10, costRed: 0, consecutiveBonus: 0, aoeBonus: 0, explosionAfter: 0 },
      2: { desc: "Ability damage +12%. Ability cost -12%.", abilityDmgMult: 1.12, costRed: 0.12, consecutiveBonus: 0, aoeBonus: 0, explosionAfter: 0 },
      3: { desc: "Ability damage +12% (-12% cost). Cast 3 abilities within 8s to gain +20% damage for 5s.", abilityDmgMult: 1.12, costRed: 0.12, consecutiveBonus: 0.20, consecutiveWindow: 160, consecutiveBuffDur: 100, consecutiveNeed: 3, aoeBonus: 0, explosionAfter: 0 },
      4: { desc: "Ability damage +14% (-12% cost). 3-in-8s combo: +20% for 5s and +1.0 block AoE.", abilityDmgMult: 1.14, costRed: 0.12, consecutiveBonus: 0.20, consecutiveWindow: 160, consecutiveBuffDur: 100, consecutiveNeed: 3, aoeBonus: 1.0, explosionAfter: 0 },
      5: { desc: "Ability damage +15% (-15% cost). 3-in-8s combo: +22% for 5s, +1.2 AoE. Every 5th ability triggers explosion (12 dmg, 5 radius).", abilityDmgMult: 1.15, costRed: 0.15, consecutiveBonus: 0.22, consecutiveWindow: 160, consecutiveBuffDur: 100, consecutiveNeed: 3, aoeBonus: 1.2, explosionAfter: 5, explosion: { radius: 5, damage: 12 } },
    }
  },
  "Kingly Diamond": {
    id: "Kingly Diamond", label: "Kingly Diamond", tier: 2, color: "#FFD700", colors: ["#FFD700","#FFFFFF"],
    type: "Defense / Shield",
    particles: { shieldGen: "kinglyDiamondShieldGen", active: "kinglyDiamondActive", breakFx: "kinglyDiamondBreak", ultimate: "kinglyDiamondUltimate" },
    levels: {
      1: { desc: "Damage taken -5%.", defense: 0.05, shieldConvert: 0, shieldBreak: null, lowHealth: null },
      2: { desc: "Damage -6%. Convert 15% of damage taken into shield.", defense: 0.06, shieldConvert: 0.15, shieldBreak: null, lowHealth: null },
      3: { desc: "Damage -7%. Convert 25% into shield.", defense: 0.07, shieldConvert: 0.25, shieldBreak: null, lowHealth: null },
      4: { desc: "Damage -8%. 25% to shield. When shield breaks, shockwave (6 dmg, 5 radius, push).", defense: 0.08, shieldConvert: 0.25, shieldBreak: { radius: 5, push: 0.9, damage: 6 }, lowHealth: null },
      5: { desc: "Damage -8%. 28% to shield. Shield-break shockwave (7 dmg, 5.5 radius). Below 35% HP: +30% defense and +10 shield for 8s (20s cooldown).", defense: 0.08, shieldConvert: 0.28, shieldBreak: { radius: 5.5, push: 1.0, damage: 7 }, lowHealth: { threshold: 0.35, defenseBonus: 0.30, shield: 10, duration: 160, cooldown: 400 } },
    }
  },
  Sanguine: {
    id: "Sanguine", label: "Sanguine", tier: 3, color: "#8B0000", colors: ["#8B0000","#000000"],
    type: "Lifesteal / Offensive healing",
    particles: { drain: "sanguineDrainMob", heal: "sanguineHealPlayer", wave: "sanguineWave", explosion: "sanguineExplosion" },
    levels: {
      1: { desc: "Heal 4% of damage dealt.", lifesteal: 0.04, excessToShield: 0, killWaveHeal: 0, killExplosion: null },
      2: { desc: "Heal 7% of damage dealt.", lifesteal: 0.07, excessToShield: 0, killWaveHeal: 0, killExplosion: null },
      3: { desc: "Heal 7% of damage. Excess healing when full becomes shield (50%).", lifesteal: 0.07, excessToShield: 0.5, killWaveHeal: 0, killExplosion: null },
      4: { desc: "Heal 8% of damage (50% excess → shield). On kill: heal 6 HP.", lifesteal: 0.08, excessToShield: 0.5, killWaveHeal: 6, killExplosion: null },
      5: { desc: "Heal 9% of damage (50% → shield). On kill: heal 6 HP and explode (10 dmg, 5 radius) healing 5 HP.", lifesteal: 0.09, excessToShield: 0.5, killWaveHeal: 6, killExplosion: { radius: 5, damage: 10, heal: 5 } },
    }
  },
  Spectral: {
    id: "Spectral", label: "Spectral", tier: 3, color: "#00D4C8", colors: ["#00D4C8","#111111"],
    type: "Invisibility / Crowd control",
    particles: { invis: "spectralInvis", reappear: "spectralReappear", spiral: "spectralSpiral", explosion: "spectralExplosion" },
    levels: {
      1: { desc: "When hit: become invisible for 1.5s.", invisDur: 30, speedBonus: 0, attract: null, explosion: null },
      2: { desc: "When hit: invisibility for 2.5s.", invisDur: 50, speedBonus: 0, attract: null, explosion: null },
      3: { desc: "When hit: invisibility 2.5s + Speed for 3s.", invisDur: 50, speedBonus: 0.25, speedDur: 60, attract: null, explosion: null },
      4: { desc: "When hit: invis 2.8s + Speed 3s. On kill: pull nearby enemies within 6 blocks to death position.", invisDur: 55, speedBonus: 0.25, speedDur: 60, attract: { radius: 6, strength: 1.0 }, explosion: null },
      5: { desc: "When hit: invis 3s + Speed 3.5s. On kill: pull 6.5 radius then explosion (10 dmg, 5 radius).", invisDur: 60, speedBonus: 0.30, speedDur: 70, attract: { radius: 6.5, strength: 1.2 }, explosion: { radius: 5, damage: 10, delay: 10 } },
    }
  },
  Geo: {
    id: "Geo", label: "Geo", tier: 3, color: "#D4A574", colors: ["#D4A574","#000000"],
    type: "Shield / Mines",
    particles: { shield: "geoShield", seismic: "geoSeismic", mineAppear: "geoMineTick", mineExplosion: "geoMineExplosion" },
    levels: {
      1: { desc: "When hit: gain +2 shield (max 12).", shield: 2, shieldCap: 12, seismicEvery: 0, seismic: null, mines: null },
      2: { desc: "When hit: gain +3 shield (max 14).", shield: 3, shieldCap: 14, seismicEvery: 0, seismic: null, mines: null },
      3: { desc: "When hit: +3 shield (max 14). Every 5 hits: seismic wave (8 dmg, 5 radius).", shield: 3, shieldCap: 14, seismicEvery: 5, seismic: { radius: 5, damage: 8, push: 0.5 }, mines: null },
      4: { desc: "When hit: +3 shield. Every 5 hits: seismic wave. On kill: spawn 2 mines (6 dmg, 5 radius, 3s delay).", shield: 3, shieldCap: 14, seismicEvery: 5, seismic: { radius: 5, damage: 8, push: 0.5 }, mines: { count: 2, damage: 6, radius: 5, delay: 60, chain: false } },
      5: { desc: "When hit: +4 shield (max 16). Every 5 hits: seismic wave (10 dmg, 5.5 radius). On kill: 3 mines (9 dmg, 5.5 radius) with chain explosions.", shield: 4, shieldCap: 16, seismicEvery: 5, seismic: { radius: 5.5, damage: 10, push: 0.6 }, mines: { count: 3, damage: 9, radius: 5.5, delay: 60, chain: true, chainRadius: 5 } },
    }
  },
  Astral: {
    id: "Astral", label: "Astral", tier: 4, color: "#8A2BE2", colors: ["#8A2BE2","#111111"],
    type: "Crowd control / Damage over time",
    particles: { slow: "astralAura", glowing: "astralGlowing", tornado: "astralTornado", aura: "astralAura" },
    levels: {
      1: { desc: "Aura: slow enemies within 5 blocks by 20%.", slow: 0.20, slowRadius: 5, slowDmgMult: 0, glowing: null, aura: null },
      2: { desc: "Aura 5 blocks: slow 20%. Slowed enemies take +15% damage.", slow: 0.20, slowRadius: 5, slowDmgMult: 0.15, glowing: null, aura: null },
      3: { desc: "Aura 6 blocks: slow 22%. Slowed take +15% damage.", slow: 0.22, slowRadius: 6, slowDmgMult: 0.15, glowing: null, aura: null },
      4: { desc: "Aura 6 blocks: slow 22%, +18% damage to slowed. On kill: glow on nearby enemies for 10s (+15% damage).", slow: 0.22, slowRadius: 6, slowDmgMult: 0.18, glowing: { radius: 8, duration: 200, extraDmg: 0.15 }, aura: null },
      5: { desc: "Aura 6 blocks: slow 25%, +20% damage to slowed. On kill: glow 9 radius 10s (+18% dmg). Passive aura deals 2 dmg/sec within 6 blocks.", slow: 0.25, slowRadius: 6.5, slowDmgMult: 0.20, glowing: { radius: 9, duration: 200, extraDmg: 0.18 }, aura: { radius: 6, dps: 2, interval: 20, slowDur: 40 } },
    }
  },
  Voltplate: {
    id: "Voltplate", label: "Voltplate", tier: 4, color: "#00E5FF", colors: ["#78909C","#00E5FF"],
    type: "Electricity / Chain attacks",
    particles: { discharge: "voltplateDischarge", chain: "voltplateChain", charge: "voltplateCharge", ultimate: "voltplateUltimate" },
    levels: {
      1: { desc: "When hit: 18% chance to shock 1 enemy within 5 blocks for 5 damage.", dischargeChance: 0.18, dischargeDmg: 5, dischargeRadius: 5, dischargeTargets: 1, slow: 0, charges: null, chainUltimate: null },
      2: { desc: "When hit: 20% chance to shock 1 enemy for 7 damage (5.2 radius).", dischargeChance: 0.20, dischargeDmg: 7, dischargeRadius: 5.2, dischargeTargets: 1, slow: 0, charges: null, chainUltimate: null },
      3: { desc: "When hit: 22% chance to shock 3 enemies for 8 damage (5.5 radius).", dischargeChance: 0.22, dischargeDmg: 8, dischargeRadius: 5.5, dischargeTargets: 3, slow: 0, charges: null, chainUltimate: null },
      4: { desc: "When hit: 23% chance to shock 3 enemies for 9 damage (5.5 radius) and slow 2s.", dischargeChance: 0.23, dischargeDmg: 9, dischargeRadius: 5.5, dischargeTargets: 3, slow: { chance: 1.0, duration: 40, level: 1 }, charges: null, chainUltimate: null },
      5: { desc: "When hit: 25% chance to shock 3 enemies for 10 damage (6 radius, slow). Gain charge; at 5 charges: chain lightning (12 dmg, 5 hits, 6 radius).", dischargeChance: 0.25, dischargeDmg: 10, dischargeRadius: 6, dischargeTargets: 3, slow: { chance: 1.0, duration: 40, level: 1 }, charges: { max: 5, perDischarge: 1 }, chainUltimate: { damage: 12, hits: 5, radius: 6, consume: true } },
    }
  },
  Nova: {
    id: "Nova", label: "Nova", tier: 4, color: "#FFFFFF", colors: ["#FFFFFF","#32CD32"],
    type: "Explosion / Charge accumulation",
    particles: { orbit: "novaOrbit", bright: "novaBright", small: "novaSmall", major: "novaMajor" },
    levels: {
      1: { desc: "On kill: +1 Nova charge (max 4). Each charge gives +2% damage.", chargePerKill: 1, maxCharges: 4, dmgPerCharge: 0.02, smallAt: 0, majorAt: 0, small: null, major: null },
      2: { desc: "On kill: +1 charge (max 4). Each charge +3.5% damage.", chargePerKill: 1, maxCharges: 4, dmgPerCharge: 0.035, smallAt: 0, majorAt: 0, small: null, major: null },
      3: { desc: "On kill: +1 charge (max 7). Each charge +3.5% damage.", chargePerKill: 1, maxCharges: 7, dmgPerCharge: 0.035, smallAt: 0, majorAt: 0, small: null, major: null },
      4: { desc: "On kill: +1 charge (max 7, +3.5% dmg each). At 4 charges: small explosion (8 dmg, 5 radius).", chargePerKill: 1, maxCharges: 7, dmgPerCharge: 0.035, smallAt: 4, small: { radius: 5, damage: 8 }, majorAt: 0, major: null },
      5: { desc: "On kill: +1 charge (max 10, +4% dmg each). At 4: small explosion (9 dmg, 5.5 radius). At 10: major Nova explosion (18 dmg, 5 radius, consumes charges).", chargePerKill: 1, maxCharges: 10, dmgPerCharge: 0.04, smallAt: 4, small: { radius: 5.5, damage: 9 }, majorAt: 10, major: { radius: 5, damage: 18, consume: true } },
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
export function getArmorDescription(setId, level) {
  const def = getLevelDef(setId, level);
  return (def && def.desc) ? def.desc : "";
}
// Dynamic description based on equipped count (1-5). Includes current effect and next-level preview.
export function getArmorDescriptionForCount(setId, count) {
  const lvl = armorLevelForCount(count);
  if (lvl <= 0) {
    const preview = getLevelDef(setId, 1)?.desc || "";
    return `[0/5] Inactive\nEquip 1 to activate:\n${preview}`;
  }
  const cur = getLevelDef(setId, lvl)?.desc || "";
  let out = `[${count}/5]\n${cur}`;
  if (lvl < 5) {
    const nxt = getLevelDef(setId, lvl + 1)?.desc || "";
    if (nxt) out += `\nNext [${count + 1}/5]:\n${nxt}`;
  } else {
    out += `\nMAX`;
  }
  return out;
}
// Short version without next preview, for compact tooltips
export function getArmorDescriptionCurrentOnly(setId, count) {
  const lvl = armorLevelForCount(count);
  if (lvl <= 0) {
    const preview = getLevelDef(setId, 1)?.desc || "";
    return `[0/5] Inactive\nEquip 1 to activate:\n${preview}`;
  }
  const cur = getLevelDef(setId, lvl)?.desc || "";
  return `[${count}/5]\n${cur}`;
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
