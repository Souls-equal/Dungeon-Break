/**
 * Weapons config — base damages + elemental abilities per set
 * Used for dynamic damage display (base * dealingMultiplier) and special procs.
 */

export const WEAPON_SET_TIER = {
  Amethite: 1,
  Magmasteel: 1,
  Rubellite: 1,
  Serpentite: 1,
  Sanguine: 3,
  Spectral: 3,
  Geo: 3,
  Astral: 4,
  Moonstone: 5,
  Nova: 6,
};

// Flavor per weapon type (short lore, no dmg numbers)
export const TYPE_FLAVOR = {
  Sword: "Balanced blade — high damage, crit 1.35x.",
  Dagger: "Fast dagger — low damage, double from behind, combo scaling.",
  Spear: "Dash spear — lunges 7 blocks on hit.",
  Club: "Heavy club — sword damage + massive knockback.",
  Mace: "Crushing mace — damage scales with fall/speed.",
  Whip: "Whip — pulls enemies to you.",
  Bow: "Chargeable bow — hold to charge, scales with draw.",
  Crossbow: "Crossbow — slower, higher burst.",
  Boomerang: "Throwing boomerang — returns, hits twice.",
  Staff: "Magic staff — channels elemental power.",
  Blade: "Energy blade — slash + speed + laser.",
};

// Base damages extracted from itemStats.js (72 weapons) + Moonstone + Nova
export const WEAPON_BASE_DAMAGE = {
  "Amethite Sword": 36, "Amethite Dagger": 18, "Amethite Spear": 30, "Amethite Club": 36, "Amethite Mace": 20, "Amethite Whip": 16, "Amethite Bow": 28, "Amethite Crossbow": 34, "Amethite Boomerang": 16,
  "Magmasteel Sword": 36, "Magmasteel Dagger": 18, "Magmasteel Spear": 30, "Magmasteel Club": 36, "Magmasteel Mace": 20, "Magmasteel Whip": 16, "Magmasteel Bow": 28, "Magmasteel Crossbow": 34, "Magmasteel Boomerang": 16,
  "Rubellite Sword": 37, "Rubellite Dagger": 19, "Rubellite Spear": 31, "Rubellite Club": 37, "Rubellite Mace": 21, "Rubellite Whip": 17, "Rubellite Bow": 29, "Rubellite Crossbow": 35, "Rubellite Boomerang": 17,
  "Serpentite Sword": 38, "Serpentite Dagger": 19, "Serpentite Spear": 32, "Serpentite Club": 38, "Serpentite Mace": 22, "Serpentite Whip": 17, "Serpentite Bow": 30, "Serpentite Crossbow": 36, "Serpentite Boomerang": 17,
  "Sanguine Sword": 42, "Sanguine Dagger": 22, "Sanguine Spear": 35, "Sanguine Club": 42, "Sanguine Mace": 24, "Sanguine Whip": 20, "Sanguine Bow": 34, "Sanguine Crossbow": 40, "Sanguine Staff": 38,
  "Spectral Sword": 44, "Spectral Dagger": 23, "Spectral Spear": 36, "Spectral Club": 44, "Spectral Mace": 25, "Spectral Whip": 21, "Spectral Bow": 36, "Spectral Crossbow": 42, "Spectral Staff": 40,
  "Geo Sword": 45, "Geo Dagger": 23, "Geo Spear": 38, "Geo Club": 45, "Geo Mace": 26, "Geo Whip": 22, "Geo Bow": 37, "Geo Crossbow": 44, "Geo Staff": 41,
  "Astral Sword": 50, "Astral Dagger": 26, "Astral Spear": 42, "Astral Club": 50, "Astral Mace": 28, "Astral Whip": 24, "Astral Bow": 40, "Astral Crossbow": 48, "Astral Staff": 45,
  "Moonstone Sword": 52,
  "Nova Blade": 68,
};

// Elemental ability per set — real gameplay, PvE only
// short = tooltip (1 line), desc = longer for docs, icon = valid IngameIconName for flyingMsg
export const SET_ABILITIES = {
  Amethite: {
    name: "Violet Zone",
    short: "Every 4th hit: violet zone +60%",
    desc: "Amethite — every 4th hit creates a violet zone dealing +60% damage in an area",
    color: "#9B59B6",
    icon: "Damage",
    every: 4,
    extraMult: 0.60,
  },
  Magmasteel: {
    name: "Burn",
    short: "Burn 20%/s for 5s (fire)",
    desc: "Magmasteel — burn for 20% dmg/s over 5s",
    color: "#E74C3C",
    icon: "Damage",
    burnTicks: 5 * 20,
    burnInterval: 20,
    burnFrac: 0.20,
  },
  Rubellite: {
    name: "Ruby Heart",
    short: "Kill: Regen 15s (stack 10/9/8s)",
    desc: "Rubellite — on kill: Health Regen 15s, stacks if kill within 10/9/8s",
    color: "#E91E63",
    icon: "Health Regen",
    regenMs: 15000,
    stackWindows: [10, 9, 8],
  },
  Serpentite: {
    name: "Venom",
    short: "Poison 10%/s for 8s",
    desc: "Serpentite — poison deals 10% dmg/s for 8s (weaker, longer)",
    color: "#2ECC71",
    icon: "Poisoned",
    poisonTicks: 8 * 20,
    poisonInterval: 20,
    poisonFrac: 0.10,
  },
  Sanguine: {
    name: "Siphon",
    short: "Heal 5% of damage dealt",
    desc: "Sanguine — heals 5% of damage as health",
    color: "#8B0000",
    icon: "Lifesteal",
    healFrac: 0.05,
  },
  Spectral: {
    name: "Spectral Veil",
    short: "Invis 3s + vacuum & explosion on kill",
    desc: "Spectral — 3s invisibility per hit; on kill: vacuum + zone explosion",
    color: "#00D4C8",
    icon: "Invisible",
    invisMs: 3000,
    explosionRadius: 5,
    explosionFrac: 0.8,
  },
  Geo: {
    name: "Stone Skin",
    short: "Shield per hit + mines (3s delay)",
    desc: "Geo — shield on each hit + mines on nearby mobs on kill (3s delay, avoidable)",
    color: "#D4A574",
    icon: "HealthShield",
    shieldPerHit: 2,
    shieldCap: 12,
    mineDelay: 60,
    mineRadius: 5,
    mineFrac: 0.7,
  },
  Astral: {
    name: "Astral Nova",
    short: "Kill: Glowing 15b + tornado + slow aura",
    desc: "Astral — on kill Glowing 15 blocks (+dmg), tornado on hit, slow aura while held",
    color: "#8A2BE2",
    icon: "Glowing",
    glowingMs: 10000,
    glowingRadius: 15,
    glowingExtraFrac: 0.35,
    auraRadius: 8,
    auraSlownessMs: 2000,
    auraDps: 2,
  },
  Moonstone: {
    name: "Moonlit Edge",
    short: "No proc — pure damage after Diamond",
    desc: "Moonstone — juste plus de dégâts que Diamond, pas d'effet",
    color: "#B0E0E6",
    icon: "Damage",
  },
  Nova: {
    name: "Nova Overdrive",
    short: "Crescent every click · Slash on hit · Speed when held · 20 charges laser",
    desc: "Nova — Crescent projectile every click, slash on hit, Speed when held, charge per kill (max 20), crouch+attack = long laser 1s/charge",
    color: "#00FFFF",
    icon: "Damage",
    maxCharges: 20,
    laserPerCharge: 20, // ticks = 1s
    laserDps: 9,
    laserRange: 36,
    laserRadius: 8,
    crescentDamageFrac: 0.65,
    crescentRange: 12,
    crescentSpeed: 1.8,
    crescentCooldown: 5,
  },
};

export function weaponTierForSet(setName) {
  return WEAPON_SET_TIER[setName] ?? 1;
}

export function weaponBaseDamage(weaponName) {
  if (!weaponName || typeof weaponName !== "string") return null;
  // strip meta suffix like "|meta|charging2" for bows
  const clean = String(weaponName).split("|")[0].trim();
  return WEAPON_BASE_DAMAGE[clean] ?? null;
}

export function abilityForSet(setName) {
  return SET_ABILITIES[setName] ?? null;
}

export function weaponMeta(weaponName) {
  if (!weaponName || typeof weaponName !== "string") return null;
  const clean = String(weaponName).split("|")[0].trim();
  const base = WEAPON_BASE_DAMAGE[clean];
  if (!base) return null;
  const parts = clean.split(/\s+/);
  const type = parts[parts.length - 1];
  const setName = parts.slice(0, -1).join(" ");
  const tier = WEAPON_SET_TIER[setName];
  if (!tier) return null;
  const flavor = TYPE_FLAVOR[type];
  const ability = SET_ABILITIES[setName];
  if (!flavor || !ability) return null;
  return { weaponName: clean, base, type, setName, tier, flavor, ability };
}

export function buildDescription(weaponName, effectiveDmg) {
  const meta = weaponMeta(weaponName);
  if (!meta) return null;
  return `Tier ${meta.tier} ${meta.type.toLowerCase()} — ${meta.flavor} ${effectiveDmg} dmg. ${abilityForSet(meta.setName).short}.`;
}

export function allWeaponNames() {
  return Object.keys(WEAPON_BASE_DAMAGE);
}
