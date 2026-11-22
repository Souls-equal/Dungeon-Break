/**
 * Mob loot — léger, max 2 items différents par mob.
 * Inspiré des crates mais allégé, 1-2 drops max, quantités faibles.
 * Utilisé dans worldCode.onPlayerKilledMob.
 */

import { DIFFICULTIES } from "./config.js";

// Chance de drop (0-1) par difficulté — augmente avec la difficulté
export const MOB_DROP_CHANCE = {
  veryEasy: 0.35,
  easy: 0.40,
  medium: 0.45,
  normal: 0.50,
  hard: 0.55,
  insane: 0.60,
  nightmare: 0.65,
  hell: 0.70,
};

// Table allégée par palier — max 2 items différents, quantités 1-3
// Noms validés contre src/data/item-names.txt (build vérifie crates, même source)
export const MOB_LOOT_TABLE = {
  veryEasy: [
    { name: "Apple", min: 1, max: 2, weight: 30 },
    { name: "Coal", min: 1, max: 2, weight: 20 },
    { name: "Iron Fragment", min: 1, max: 2, weight: 30 },
    { name: "Stick", min: 1, max: 3, weight: 20 },
    { name: "Cotton", min: 1, max: 2, weight: 15 },
    { name: "Amethite Fragment", min: 1, max: 1, weight: 12 },
  ],
  easy: [
    { name: "Apple", min: 1, max: 2, weight: 28 },
    { name: "Iron Fragment", min: 1, max: 3, weight: 25 },
    { name: "Iron Bar", min: 1, max: 1, weight: 12 },
    { name: "Stick", min: 1, max: 3, weight: 18 },
    { name: "Cotton", min: 1, max: 3, weight: 15 },
    { name: "Amethite Fragment", min: 1, max: 2, weight: 14 },
    { name: "Magmasteel Fragment", min: 1, max: 1, weight: 8 },
  ],
  medium: [
    { name: "Apple", min: 1, max: 3, weight: 25 },
    { name: "Iron Fragment", min: 1, max: 3, weight: 20 },
    { name: "Iron Bar", min: 1, max: 2, weight: 15 },
    { name: "Gold Fragment", min: 1, max: 2, weight: 10 },
    { name: "Cotton", min: 1, max: 3, weight: 15 },
    { name: "Amethite Fragment", min: 1, max: 2, weight: 12 },
    { name: "Magmasteel Fragment", min: 1, max: 2, weight: 12 },
    { name: "Rubellite Fragment", min: 1, max: 1, weight: 10 },
  ],
  normal: [
    { name: "Iron Bar", min: 1, max: 2, weight: 18 },
    { name: "Gold Fragment", min: 1, max: 2, weight: 14 },
    { name: "Diamond Fragment", min: 1, max: 1, weight: 8 },
    { name: "Cotton", min: 1, max: 3, weight: 14 },
    { name: "Magmasteel Fragment", min: 1, max: 2, weight: 12 },
    { name: "Rubellite Fragment", min: 1, max: 2, weight: 12 },
    { name: "Serpentite Fragment", min: 1, max: 1, weight: 10 },
  ],
  hard: [
    { name: "Iron Bar", min: 1, max: 2, weight: 16 },
    { name: "Gold Bar", min: 1, max: 1, weight: 8 },
    { name: "Diamond Fragment", min: 1, max: 2, weight: 12 },
    { name: "Diamond", min: 1, max: 1, weight: 6 },
    { name: "Serpentite Fragment", min: 1, max: 2, weight: 14 },
    { name: "Sanguine Shard", min: 1, max: 1, weight: 10 },
    { name: "Spectral Shard", min: 1, max: 1, weight: 10 },
    { name: "Moonstone Dust", min: 1, max: 1, weight: 8 },
  ],
  insane: [
    { name: "Gold Bar", min: 1, max: 1, weight: 10 },
    { name: "Diamond Fragment", min: 1, max: 2, weight: 12 },
    { name: "Diamond", min: 1, max: 1, weight: 8 },
    { name: "Serpentite Fragment", min: 1, max: 2, weight: 12 },
    { name: "Sanguine Shard", min: 1, max: 2, weight: 12 },
    { name: "Spectral Shard", min: 1, max: 2, weight: 12 },
    { name: "Geo Shard", min: 1, max: 1, weight: 10 },
    { name: "Moonstone Dust", min: 1, max: 2, weight: 10 },
  ],
  nightmare: [
    { name: "Gold Bar", min: 1, max: 2, weight: 10 },
    { name: "Diamond", min: 1, max: 2, weight: 10 },
    { name: "Serpentite Fragment", min: 1, max: 2, weight: 10 },
    { name: "Sanguine Shard", min: 1, max: 2, weight: 10 },
    { name: "Spectral Shard", min: 1, max: 2, weight: 10 },
    { name: "Geo Shard", min: 1, max: 2, weight: 12 },
    { name: "Astral Shard", min: 1, max: 1, weight: 10 },
    { name: "Moonstone Dust", min: 1, max: 2, weight: 8 },
    { name: "Voltite Dust", min: 1, max: 1, weight: 6 },
  ],
  hell: [
    { name: "Diamond", min: 1, max: 2, weight: 12 },
    { name: "Diamond Fragment", min: 1, max: 2, weight: 10 },
    { name: "Geo Shard", min: 1, max: 2, weight: 12 },
    { name: "Astral Shard", min: 1, max: 2, weight: 12 },
    { name: "Sanguine Shard", min: 1, max: 2, weight: 8 },
    { name: "Spectral Shard", min: 1, max: 2, weight: 8 },
    { name: "Comet Shard", min: 1, max: 1, weight: 8 },
    { name: "Voltite Dust", min: 1, max: 2, weight: 10 },
    { name: "Moonstone Dust", min: 1, max: 2, weight: 8 },
    { name: "Copper Wire", min: 1, max: 1, weight: 5 },
    // Très rare — endgame
    { name: "Star Alloy", min: 1, max: 1, weight: 2 },
  ],
};

export function getMobDropChance(difficulty) {
  const id = difficulty && difficulty.id ? difficulty.id : String(difficulty || "");
  return MOB_DROP_CHANCE[id] ?? 0.45;
}

function pickOne(list, random) {
  let total = 0;
  for (const e of list) total += e.weight;
  let r = random() * total;
  for (const e of list) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return list[0];
}

function amountOf(entry, random) {
  if (Number.isFinite(entry.min) && Number.isFinite(entry.max)) {
    const min = Math.floor(entry.min);
    const max = Math.floor(entry.max);
    if (max <= min) return min;
    return Math.floor(random() * (max - min + 1)) + min;
  }
  if (Number.isFinite(entry.amount)) return entry.amount;
  return 1;
}

/**
 * Tire le loot d'un mob : 0-2 items différents max.
 * @param {object|string} difficulty
 * @param {function} random
 * @returns {Array<{name:string,amount:number}>}
 */
export function rollMobLoot(difficulty, random = Math.random) {
  const id = difficulty && difficulty.id ? difficulty.id : String(difficulty || "veryEasy");
  const table = MOB_LOOT_TABLE[id] || MOB_LOOT_TABLE.veryEasy;
  const chance = getMobDropChance(difficulty);
  if (random() >= chance) return [];
  const out = [];
  const first = pickOne(table, random);
  out.push({ name: first.name, amount: amountOf(first, random) });
  // 30% chance d'un 2e item différent (léger)
  if (random() < 0.30) {
    const rest = table.filter((e) => e.name !== first.name);
    if (rest.length > 0) {
      const second = pickOne(rest, random);
      out.push({ name: second.name, amount: amountOf(second, random) });
    }
  }
  return out;
}

// Tous les noms donnés aux mobs, pour validation build
export const MOB_GIVEN_ITEMS = [...new Set(Object.values(MOB_LOOT_TABLE).flat().map((e) => e.name))];
