/**
 * combatFx/config.js — visual effects for weapons/armors
 * Each weapon type has identifiable feedback + color per set + rhythm (every X hits).
 * Each armor has shield + shimmer.
 */

import { WEAPON_SET_COLOR, ARMOR_SET_COLOR } from "../particles/config.js";

export const WEAPON_TYPES = ["Sword","Dagger","Spear","Club","Mace","Whip","Bow","Crossbow","Boomerang","Staff","Blade"];

// Rhythm: every N hits the big proc triggers (light hit always visible)
export const WEAPON_FX = {
  Sword:     { every: 3, label: "Slash",       tierScale: {1:1.0, 3:1.25, 4:1.45, 5:1.55, 6:1.7} },
  Dagger:    { every: 2, label: "Fury",        tierScale: {1:1.0, 3:1.2, 4:1.35, 5:1.45, 6:1.6} },
  Spear:     { every: 3, label: "Thrust",      tierScale: {1:1.0, 3:1.25, 4:1.45, 5:1.55, 6:1.7} },
  Club:      { every: 4, label: "Shockwave",   tierScale: {1:1.0, 3:1.25, 4:1.45, 5:1.55, 6:1.7} },
  Mace:      { every: 3, label: "Crush",       tierScale: {1:1.0, 3:1.3, 4:1.5, 5:1.6, 6:1.75} },
  Whip:      { every: 2, label: "Lash",        tierScale: {1:1.0, 3:1.2, 4:1.35, 5:1.45, 6:1.6} },
  Bow:       { every: 1, label: "Arrow",       tierScale: {1:1.0, 3:1.25, 4:1.4, 5:1.5, 6:1.65} },
  Crossbow:  { every: 1, label: "Bolt",        tierScale: {1:1.0, 3:1.25, 4:1.4, 5:1.5, 6:1.65} },
  Boomerang: { every: 1, label: "Spin",        tierScale: {1:1.0, 3:1.2, 4:1.35, 5:1.45, 6:1.6} },
  Staff:     { every: 2, label: "Arcane",      tierScale: {1:1.0, 3:1.3, 4:1.55, 5:1.65, 6:1.8} },
  Blade:     { every: 1, label: "Nova Slash",  tierScale: {1:1.0, 3:1.3, 4:1.55, 5:1.65, 6:1.9} },
};

// Mapping setId -> { color, tier } for weapons and armors
export const WEAPON_SETS_FX = {
  Amethite:   { color: WEAPON_SET_COLOR.Amethite, tier: 1 },
  Magmasteel: { color: WEAPON_SET_COLOR.Magmasteel, tier: 1 },
  Rubellite:  { color: WEAPON_SET_COLOR.Rubellite, tier: 1 },
  Serpentite: { color: WEAPON_SET_COLOR.Serpentite, tier: 1 },
  Sanguine:   { color: WEAPON_SET_COLOR.Sanguine, tier: 3 },
  Spectral:   { color: WEAPON_SET_COLOR.Spectral, tier: 3 },
  Geo:        { color: WEAPON_SET_COLOR.Geo, tier: 3 },
  Astral:     { color: WEAPON_SET_COLOR.Astral, tier: 4 },
  Moonstone:  { color: WEAPON_SET_COLOR.Moonstone, tier: 5 },
  Nova:       { color: WEAPON_SET_COLOR.Nova, tier: 6 },
};

// Armors: 14 sets, tiers 1-6
export const ARMOR_SETS_FX = {
  Amethite:          { color: ARMOR_SET_COLOR.Amethite, tier: 1, every: 5 },
  Magmasteel:        { color: ARMOR_SET_COLOR.Magmasteel, tier: 1, every: 5 },
  Rubellite:         { color: ARMOR_SET_COLOR.Rubellite, tier: 1, every: 5 },
  Serpentite:        { color: ARMOR_SET_COLOR.Serpentite, tier: 1, every: 5 },
  Cursemetal:        { color: ARMOR_SET_COLOR.Cursemetal, tier: 2, every: 4 },
  "Kingly Amethite": { color: ARMOR_SET_COLOR["Kingly Amethite"], tier: 2, every: 4 },
  "Kingly Diamond":  { color: ARMOR_SET_COLOR["Kingly Diamond"], tier: 2, every: 4 },
  Sanguine:         { color: ARMOR_SET_COLOR.Sanguine, tier: 3, every: 3 },
  Spectral:         { color: ARMOR_SET_COLOR.Spectral, tier: 3, every: 3 },
  Geo:              { color: ARMOR_SET_COLOR.Geo, tier: 3, every: 3 },
  Astral:           { color: ARMOR_SET_COLOR.Astral, tier: 4, every: 2 },
  Voltplate:        { color: ARMOR_SET_COLOR.Voltplate, tier: 4, every: 2 },
  Moonstone:        { color: ARMOR_SET_COLOR.Moonstone, tier: 5, every: 2 },
  Nova:             { color: ARMOR_SET_COLOR.Nova, tier: 6, every: 2 },
};

export function weaponColorFor(setName) {
  const fx = WEAPON_SETS_FX[setName];
  return fx ? fx.color : "#FFFFFF";
}
export function weaponTierFor(setName) {
  const fx = WEAPON_SETS_FX[setName];
  return fx ? fx.tier : 1;
}
export function armorColorFor(setName) {
  const fx = ARMOR_SETS_FX[setName];
  return fx ? fx.color : "#AAAAAA";
}
export function armorTierFor(setName) {
  const fx = ARMOR_SETS_FX[setName];
  return fx ? fx.tier : 1;
}
export function tierScaleForWeapon(setName) {
  return tierScaleForWeaponType("Sword", setName);
}
export function tierScaleForWeaponType(weaponType, setName) {
  const tier = weaponTierFor(setName);
  const cfg = WEAPON_FX[weaponType];
  if (!cfg) return 1;
  return cfg.tierScale[tier] || 1;
}
export function tierScaleForArmor(setName) {
  const tier = armorTierFor(setName);
  if (tier === 4) return 1.45;
  if (tier === 3) return 1.25;
  if (tier === 2) return 1.12;
  return 1.0;
}
