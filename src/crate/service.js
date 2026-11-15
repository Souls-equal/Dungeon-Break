/**
 * Crate system — logic (api-free core + api helpers)
 * Mirrors the example given by the user exactly.
 */

import { CRATE_KEYS, AIR_CHANCE, LOOT_TABLE } from "./config.js";

export function getWeightedRandomItem(rarity, random = Math.random) {
  const list = LOOT_TABLE[rarity];
  if (!list || list.length === 0) return null;
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i].weight;
  let rand = random() * total;
  for (let i = 0; i < list.length; i++) {
    rand -= list[i].weight;
    if (rand <= 0) return list[i];
  }
  return list[0];
}

export function getAmountForItem(item, random = Math.random) {
  if (!item) return 1;
  // Supporte {amount} fixe ou {min,max} aléatoire inclusif, ou {amountMin,amountMax}
  const hasMinMax = (Number.isFinite(item.min) && Number.isFinite(item.max)) || (Number.isFinite(item.amountMin) && Number.isFinite(item.amountMax));
  if (Number.isFinite(item.min) && Number.isFinite(item.max)) {
    const min = Math.floor(item.min);
    const max = Math.floor(item.max);
    if (max < min) return min;
    return Math.floor(random() * (max - min + 1)) + min;
  }
  if (Number.isFinite(item.amountMin) && Number.isFinite(item.amountMax)) {
    const min = Math.floor(item.amountMin);
    const max = Math.floor(item.amountMax);
    if (max < min) return min;
    return Math.floor(random() * (max - min + 1)) + min;
  }
  if (Number.isFinite(item.amount)) return item.amount;
  return 1;
}

export function hasKey(api, playerId, rarity) {
  const key = CRATE_KEYS[rarity];
  if (!key) return false;
  try {
    if (typeof api.hasItem === "function") return api.hasItem(playerId, key);
    if (typeof api.getInventoryItemAmount === "function") return api.getInventoryItemAmount(playerId, key) > 0;
  } catch (_) {}
  // fallback to DB (legacy example) if inventory API not available
  try { return (api.getPlayerDbValue(playerId, key) || 0) > 0; } catch (_) { return false; }
}

export function consumeKey(api, playerId, rarity) {
  const key = CRATE_KEYS[rarity];
  if (!key) return;
  try {
    if (typeof api.removeItemName === "function") { api.removeItemName(playerId, key, 1); return; }
    if (typeof api.removeItem === "function") { api.removeItem(playerId, key, 1); return; }
  } catch (_) {}
  // fallback to DB
  try {
    const current = api.getPlayerDbValue(playerId, key) || 0;
    api.setPlayerDbValue(playerId, key, current - 1);
  } catch (_) {}
}

export function generateChest(api, playerId, chestPos, rarity, random = Math.random) {
  if (!hasKey(api, playerId, rarity)) {
    try {
      api.sendMessage(playerId, "You need a " + CRATE_KEYS[rarity] + " to open this chest!", { color: "red" });
    } catch (_) {
      try { api.sendMessage(playerId, "You need a " + CRATE_KEYS[rarity] + " to open this chest!"); } catch (_) {}
    }
    return false;
  }
  consumeKey(api, playerId, rarity);
  for (let i = 0; i < 27; i++) {
    if (random() * 100 < AIR_CHANCE[rarity]) {
      try { api.setStandardChestItemSlot(chestPos, i, "Air", 1, playerId); } catch (_) {}
      continue;
    }
    const item = getWeightedRandomItem(rarity, random);
    if (!item) continue;
    const amount = getAmountForItem(item, random);
    try { api.setStandardChestItemSlot(chestPos, i, item.name, amount, playerId); } catch (_) {}
  }
  try {
    api.sendMessage(playerId, "Chest opened (" + rarity + ")!", { color: "lightgray" });
  } catch (_) {
    try { api.sendMessage(playerId, "Chest opened (" + rarity + ")!"); } catch (_) {}
  }
  return true;
}
