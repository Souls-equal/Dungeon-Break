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

export function hasKey(api, playerId, rarity) {
  const key = CRATE_KEYS[rarity];
  if (!key) return false;
  return (api.getPlayerDbValue(playerId, key) || 0) > 0;
}

export function consumeKey(api, playerId, rarity) {
  const key = CRATE_KEYS[rarity];
  if (!key) return;
  const current = api.getPlayerDbValue(playerId, key) || 0;
  api.setPlayerDbValue(playerId, key, current - 1);
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
    try { api.setStandardChestItemSlot(chestPos, i, item.name, item.amount, playerId); } catch (_) {}
  }
  try {
    api.sendMessage(playerId, "Chest opened (" + rarity + ")!", { color: "lightgray" });
  } catch (_) {
    try { api.sendMessage(playerId, "Chest opened (" + rarity + ")!"); } catch (_) {}
  }
  return true;
}
