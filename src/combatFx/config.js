/**
 * combatFx/config.js — effets visibles des armes/armures
 * Chaque type d'arme a son feedback identifiable + couleur par set + rythme (tous les X coups).
 * Chaque armure a son bouclier + shimmer.
 */

import { WEAPON_SET_COLOR, ARMOR_SET_COLOR } from "../particles/config.js";

export const WEAPON_TYPES = ["Sword","Dagger","Spear","Club","Mace","Whip","Bow","Crossbow","Boomerang","Staff"];

// Rythme: tous les N coups le gros effet proc (le hit léger est toujours visible)
export const WEAPON_FX = {
  Sword:     { every: 3, label: "Slash",       tierScale: {1:1.0, 3:1.25, 4:1.45} },
  Dagger:    { every: 2, label: "Fury",        tierScale: {1:1.0, 3:1.2, 4:1.35} },
  Spear:     { every: 3, label: "Thrust",      tierScale: {1:1.0, 3:1.25, 4:1.45} },
  Club:      { every: 4, label: "Shockwave",   tierScale: {1:1.0, 3:1.25, 4:1.45} },
  Mace:      { every: 3, label: "Crush",       tierScale: {1:1.0, 3:1.3, 4:1.5} },
  Whip:      { every: 2, label: "Lash",        tierScale: {1:1.0, 3:1.2, 4:1.35} },
  Bow:       { every: 1, label: "Arrow",       tierScale: {1:1.0, 3:1.25, 4:1.4} },
  Crossbow:  { every: 1, label: "Bolt",        tierScale: {1:1.0, 3:1.25, 4:1.4} },
  Boomerang: { every: 1, label: "Spin",        tierScale: {1:1.0, 3:1.2, 4:1.35} },
  Staff:     { every: 2, label: "Arcane",      tierScale: {1:1.0, 3:1.3, 4:1.55} },
};

// Mapping setId -> { color, tier } pour armes et armures
export const WEAPON_SETS_FX = {
  Amethite:   { color: WEAPON_SET_COLOR.Amethite, tier: 1 },
  Magmasteel: { color: WEAPON_SET_COLOR.Magmasteel, tier: 1 },
  Rubellite:  { color: WEAPON_SET_COLOR.Rubellite, tier: 1 },
  Serpentite: { color: WEAPON_SET_COLOR.Serpentite, tier: 1 },
  Sanguine:   { color: WEAPON_SET_COLOR.Sanguine, tier: 3 },
  Spectral:   { color: WEAPON_SET_COLOR.Spectral, tier: 3 },
  Geo:        { color: WEAPON_SET_COLOR.Geo, tier: 3 },
  Astral:     { color: WEAPON_SET_COLOR.Astral, tier: 4 },
};

// Armures: 12 sets, 1-4
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
  const tier = weaponTierFor(setName);
  const type = "Sword"; // default scale tier mapping, override per type via WEAPON_FX label but we use generic tier->scale
  // pick Sword scale as generic; per-type via lookup below
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
