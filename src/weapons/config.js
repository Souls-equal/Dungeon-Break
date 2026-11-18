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

// Elemental ability per set — real gameplay, PvE only
// short = tooltip (1 line), desc = longer for docs, icon = small flying icon key
export const SET_ABILITIES = {
  Amethite: {
    name: "Zone violette",
    short: "4e coup zone violette +60%",
    desc: "Amethite — 4e coup: zone violette +60% dégâts en cercle",
    color: "#9B59B6",
    icon: "star",
    every: 4,
    extraMult: 0.60,
  },
  Magmasteel: {
    name: "Brûlure",
    short: "Brûlure 20%/s ×5s (feu)",
    desc: "Magmasteel — brûlure 20% dmg/s pendant 5s",
    color: "#E74C3C",
    icon: "fire",
    burnTicks: 5 * 20,
    burnInterval: 20,
    burnFrac: 0.20,
  },
  Rubellite: {
    name: "Cœur rubis",
    short: "Kill: Régén. 15s (stack 10/9/8s)",
    desc: "Rubellite — kill: Health Regen 15s, stack si kill dans 10/9/8s",
    color: "#E91E63",
    icon: "heart",
    regenMs: 15000,
    stackWindows: [10, 9, 8],
  },
  Serpentite: {
    name: "Venin",
    short: "Poison vert faible long",
    desc: "Serpentite — poison vert plus faible mais plus long",
    color: "#2ECC71",
    icon: "skull",
    poisonTicks: 8 * 20,
    poisonInterval: 20,
    poisonFrac: 0.10,
  },
  Sanguine: {
    name: "Siphon",
    short: "Soin 5% dmg infligé",
    desc: "Sanguine — rend 5% des dégâts en vie",
    color: "#8B0000",
    icon: "heart",
    healFrac: 0.05,
  },
  Spectral: {
    name: "Voile spectral",
    short: "Invis 3s + aspiration & explosion à la mort",
    desc: "Spectral — 3s invisibilité par coup; mort: aspiration + explosion zone",
    color: "#00D4C8",
    icon: "eye-slash",
    invisMs: 3000,
    explosionRadius: 5,
    explosionFrac: 0.8,
  },
  Geo: {
    name: "Peau de pierre",
    short: "Bouclier par coup + mines 3s",
    desc: "Geo — bouclier à chaque coup + mines sur mobs proches à la mort (3s)",
    color: "#D4A574",
    icon: "shield",
    shieldPerHit: 2,
    shieldCap: 12,
    mineDelay: 60,
    mineRadius: 3,
    mineFrac: 0.7,
  },
  Astral: {
    name: "Nova astrale",
    short: "Kill: Glowing 15b + tornade + aura lenteur",
    desc: "Astral — kill Glowing 15b (+dmg), tornade au hit, aura lenteur+dégâts en main",
    color: "#8A2BE2",
    icon: "star",
    glowingMs: 10000,
    glowingRadius: 15,
    glowingExtraFrac: 0.35,
    auraRadius: 8,
    auraSlownessMs: 2000,
    auraDps: 2,
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
  return `Tier ${meta.tier} ${meta.type.toLowerCase()} — ${meta.flavor} ${effectiveDmg} dmg. ${abilityForSet(meta.setName).short}.`;
}

export function allWeaponNames() {
  return Object.keys(WEAPON_BASE_DAMAGE);
}
