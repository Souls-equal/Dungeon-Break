/**
 * Crate system — logic (api-free core + api helpers)
 * Mirrors the example given by the user exactly.
 */

import { CRATE_KEYS, AIR_CHANCE, LOOT_TABLE, CRATE_LOCK_MS } from "./config.js";

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

function normalizeChestPos(chestPos) {
  if (!chestPos) return null;
  if (Array.isArray(chestPos) && chestPos.length >= 3) return { x: Math.floor(chestPos[0]), y: Math.floor(chestPos[1]), z: Math.floor(chestPos[2]) };
  if (typeof chestPos === "object" && chestPos !== null) {
    if (Number.isFinite(chestPos.x) && Number.isFinite(chestPos.y) && Number.isFinite(chestPos.z)) return { x: Math.floor(chestPos.x), y: Math.floor(chestPos.y), z: Math.floor(chestPos.z) };
    if (Number.isFinite(chestPos[0]) && Number.isFinite(chestPos[1]) && Number.isFinite(chestPos[2])) return { x: Math.floor(chestPos[0]), y: Math.floor(chestPos[1]), z: Math.floor(chestPos[2]) };
  }
  return null;
}

function nowMs(api) {
  try { if (typeof api.now === "function") return api.now(); } catch (_) {}
  try { if (typeof api.getTime === "function") return api.getTime(); } catch (_) {}
  return Date.now();
}

export function getChestData(api, chestPos) {
  const p = normalizeChestPos(chestPos);
  if (!p) return null;
  try { return api.getBlockData(p.x, p.y, p.z) || {}; } catch (_) { return {}; }
}

function getPlayerDisplayName(api, playerId) {
  try {
    if (typeof api.getEntityName === "function") {
      const name = api.getEntityName(playerId);
      if (name) return name;
    }
  } catch (_) {}
  return playerId;
}

export function setChestOwner(api, chestPos, playerId, rarity) {
  const p = normalizeChestPos(chestPos);
  if (!p) return;
  let existing = {};
  try { existing = api.getBlockData(p.x, p.y, p.z) || {}; } catch (_) { existing = {}; }
  if (existing === null || typeof existing !== "object") existing = {};
  const now = nowMs(api);
  const displayName = getPlayerDisplayName(api, playerId);
  const merged = {
    ...existing,
    crateOwnerId: playerId,
    crateOwnerName: displayName,
    crateRarity: rarity,
    crateOpenedAt: now,
    crateLockUntil: now + CRATE_LOCK_MS,
  };
  try { api.setBlockData(p.x, p.y, p.z, merged); } catch (_) {}
}

export function isChestLocked(api, chestPos, playerId) {
  const p = normalizeChestPos(chestPos);
  if (!p) return false;
  let data = null;
  try { data = api.getBlockData(p.x, p.y, p.z); } catch (_) { data = null; }
  if (!data || typeof data !== "object") return false;
  if (!data.crateOwnerId || !data.crateLockUntil) return false;
  if (data.crateOwnerId === playerId) return false; // même joueur a la priorité
  const now = nowMs(api);
  return now < data.crateLockUntil;
}

export function generateChest(api, playerId, chestPos, rarity, random = Math.random) {
  if (isChestLocked(api, chestPos, playerId)) {
    const data = getChestData(api, chestPos);
    const now = nowMs(api);
    const remaining = data && data.crateLockUntil ? Math.ceil((data.crateLockUntil - now) / 1000) : Math.ceil(CRATE_LOCK_MS / 1000);
    let ownerDisplay = data && (data.crateOwnerName || data.crateOwnerId) ? (data.crateOwnerName || data.crateOwnerId) : "another player";
    // privilégie getEntityName pour afficher le pseudo au lieu de l'id
    if (data && data.crateOwnerId) {
      try { const n = api.getEntityName ? api.getEntityName(data.crateOwnerId) : null; if (n) ownerDisplay = n; } catch (_) {}
    }
    try {
      api.sendMessage(playerId, "This crate is being used by " + ownerDisplay + " - please wait " + remaining + "s", { color: "red" });
    } catch (_) {
      try { api.sendMessage(playerId, "This crate is being used by another player - please wait " + remaining + "s"); } catch (_) {}
    }
    return false;
  }
  if (!hasKey(api, playerId, rarity)) {
    try {
      api.sendMessage(playerId, "You need a " + CRATE_KEYS[rarity] + " to open this chest!", { color: "red" });
    } catch (_) {
      try { api.sendMessage(playerId, "You need a " + CRATE_KEYS[rarity] + " to open this chest!"); } catch (_) {}
    }
    return false;
  }
  consumeKey(api, playerId, rarity);
  setChestOwner(api, chestPos, playerId, rarity);
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
  // Ouvre automatiquement le coffre pour le joueur (api: openChestForPlayer)
  try {
    if (typeof api.openChestForPlayer === "function") {
      const pos = normalizeChestPos(chestPos);
      if (pos) api.openChestForPlayer(playerId, pos.x, pos.y, pos.z);
    }
  } catch (_) {}
  return true;
}
