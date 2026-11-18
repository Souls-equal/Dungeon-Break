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
};

// Flavor per weapon type (short lore, no dmg numbers)
export const TYPE_FLAVOR = {
  Sword: "Balanced blade — high damage, crit 1.35×.",
  Dagger: "Fast dagger — low damage, double from behind, combo scaling.",
  Spear: "Dash spear — lunges 7 blocks on hit.",
  Club: "Heavy club — sword damage + massive knockback.",
  Mace: "Crushing mace — damage scales with fall/speed.",
  Whip: "Whip — pulls enemies to you.",
  Bow: "Chargeable bow — hold to charge, scales with draw.",
  Crossbow: "Crossbow — slower, higher burst.",
  Boomerang: "Throwing boomerang — returns, hits twice.",
  Staff: "Magic staff — channels elemental power.",
};

// Base damages extracted from itemStats.js (72 weapons)
export const WEAPON_BASE_DAMAGE = {
  "Amethite Sword": 36, "Amethite Dagger": 18, "Amethite Spear": 30, "Amethite Club": 36, "Amethite Mace": 20, "Amethite Whip": 16, "Amethite Bow": 28, "Amethite Crossbow": 34, "Amethite Boomerang": 16,
  "Magmasteel Sword": 36, "Magmasteel Dagger": 18, "Magmasteel Spear": 30, "Magmasteel Club": 36, "Magmasteel Mace": 20, "Magmasteel Whip": 16, "Magmasteel Bow": 28, "Magmasteel Crossbow": 34, "Magmasteel Boomerang": 16,
  "Rubellite Sword": 37, "Rubellite Dagger": 19, "Rubellite Spear": 31, "Rubellite Club": 37, "Rubellite Mace": 21, "Rubellite Whip": 17, "Rubellite Bow": 29, "Rubellite Crossbow": 35, "Rubellite Boomerang": 17,
  "Serpentite Sword": 38, "Serpentite Dagger": 19, "Serpentite Spear": 32, "Serpentite Club": 38, "Serpentite Mace": 22, "Serpentite Whip": 17, "Serpentite Bow": 30, "Serpentite Crossbow": 36, "Serpentite Boomerang": 17,
  "Sanguine Sword": 42, "Sanguine Dagger": 22, "Sanguine Spear": 35, "Sanguine Club": 42, "Sanguine Mace": 24, "Sanguine Whip": 20, "Sanguine Bow": 34, "Sanguine Crossbow": 40, "Sanguine Staff": 38,
  "Spectral Sword": 44, "Spectral Dagger": 23, "Spectral Spear": 36, "Spectral Club": 44, "Spectral Mace": 25, "Spectral Whip": 21, "Spectral Bow": 36, "Spectral Crossbow": 42, "Spectral Staff": 40,
  "Geo Sword": 45, "Geo Dagger": 23, "Geo Spear": 38, "Geo Club": 45, "Geo Mace": 26, "Geo Whip": 22, "Geo Bow": 37, "Geo Crossbow": 44, "Geo Staff": 41,
  "Astral Sword": 50, "Astral Dagger": 26, "Astral Spear": 42, "Astral Club": 50, "Astral Mace": 28, "Astral Whip": 24, "Astral Bow": 40, "Astral Crossbow": 48, "Astral Staff": 45,
};

// Elemental ability per set — déclenchée sur le proc visuel (every N coups)
// Chaque capacité ajoute un vrai effet gameplay (pas juste visuel)
export const SET_ABILITIES = {
  Amethite: {
    name: "Éclat cristallin",
    short: "4e coup +60% en zone",
    desc: "Éclat cristallin — tous les 3 coups, +60% dégâts en zone",
    color: "#9B59B6",
    extraMult: 0.60, // +60% base
    chance: 1.0,
    buff: null,
  },
  Magmasteel: {
    name: "Fournaise",
    short: "Brûlure +5 & Force I 3s",
    desc: "Fournaise — 25% : brûlure +5 dmg + Force I 3s",
    color: "#E74C3C",
    extraFlat: 5,
    chance: 0.25,
    buff: { effect: "Damage", level: 1, duration: 3000 },
  },
  Rubellite: {
    name: "Cœur rubis",
    short: "Vol de vie 8% + Régén. I",
    desc: "Cœur rubis — vol de vie 8% + Régénération I 2s",
    color: "#C0392B",
    lifesteal: 0.08,
    chance: 1.0,
    buff: { effect: "Health Regen", level: 1, duration: 2000 },
  },
  Serpentite: {
    name: "Venin",
    short: "Poison +6 & Vitesse I 2s",
    desc: "Venin — 3e coup +6 dmg poison + Vitesse I 2s",
    color: "#2ECC71",
    extraFlat: 6,
    chance: 0.33,
    buff: { effect: "Speed", level: 1, duration: 2000 },
  },
  Sanguine: {
    name: "Siphon sanglant",
    short: "Vol de vie 10% + Régén. II",
    desc: "Siphon sanglant — vol de vie 10% + Régén. II 3s",
    color: "#8B0000",
    lifesteal: 0.10,
    chance: 1.0,
    buff: { effect: "Health Regen", level: 2, duration: 3000 },
  },
  Spectral: {
    name: "Voile spectral",
    short: "15% Invisibilité + Vitesse 2s",
    desc: "Voile spectral — 15% : Invisibilité + Vitesse 2s",
    color: "#85C1E9",
    chance: 0.15,
    buff: { effect: "Invisibility", level: 1, duration: 2000 },
    buff2: { effect: "Speed", level: 1, duration: 2000 },
  },
  Geo: {
    name: "Peau de pierre",
    short: "20% Résistance I 4s",
    desc: "Peau de pierre — 20% : Résistance I 4s",
    color: "#D4A574",
    chance: 0.20,
    buff: { effect: "Damage Reduction", level: 1, duration: 4000 },
  },
  Astral: {
    name: "Nova astrale",
    short: "Explosion +12 dmg",
    desc: "Nova astrale — explosion +12 dmg en zone",
    color: "#F1C40F",
    extraFlat: 12,
    chance: 0.20,
  },
};

export function weaponTierForSet(setName) {
  return WEAPON_SET_TIER[setName] ?? 1;
}

export function weaponBaseDamage(weaponName) {
  return WEAPON_BASE_DAMAGE[weaponName] ?? null;
}

export function abilityForSet(setName) {
  return SET_ABILITIES[setName] ?? null;
}

export function weaponMeta(weaponName) {
  if (!weaponName || typeof weaponName !== "string") return null;
  const base = WEAPON_BASE_DAMAGE[weaponName];
  if (!base) return null;
  const parts = weaponName.trim().split(/\s+/);
  const type = parts[parts.length - 1];
  const setName = parts.slice(0, -1).join(" ");
  const tier = WEAPON_SET_TIER[setName];
  if (!tier) return null;
  const flavor = TYPE_FLAVOR[type];
  const ability = SET_ABILITIES[setName];
  if (!flavor || !ability) return null;
  return { weaponName, base, type, setName, tier, flavor, ability };
}

export function buildDescription(weaponName, effectiveDmg) {
  const meta = weaponMeta(weaponName);
  if (!meta) return null;
  // Format: "Tier X type — flavor N dmg. Ability"
  // Keep it short for tooltip
  return `Tier ${meta.tier} ${meta.type.toLowerCase()} — ${meta.flavor} ${effectiveDmg} dmg. ${abilityForSet(meta.setName).short}.`;
}

export function allWeaponNames() {
  return Object.keys(WEAPON_BASE_DAMAGE);
}
