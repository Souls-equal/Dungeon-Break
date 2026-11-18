/**
 * Crate system — logic (api-free core + api helpers)
 * Mirrors the example given by the user exactly.
 */

import { CRATE_KEYS, AIR_CHANCE, LOOT_TABLE, CRATE_LOCK_MS, CRATE_CLEAR_DISTANCE } from "./config.js";

// Registry for 16s roll protection — tested every second per spec
const activeCrates = new Map(); // key "x|y|z" -> { x, y, z, ownerId, lockUntil }

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

function lowerChestOneBlock(api, chestPos) {
  const p = normalizeChestPos(chestPos);
  if (!p) return chestPos;
  try {
    const data = api.getBlockData(p.x, p.y, p.z);
    if (data && typeof data === "object" && data.crateLowered) return chestPos;
  } catch (_) {}
  const below = { x: p.x, y: p.y - 1, z: p.z };
  let belowBlock = null;
  try { belowBlock = api.getBlock(below.x, below.y, below.z); } catch (_) {}
  if (belowBlock !== null && belowBlock !== "Air" && belowBlock !== undefined) return chestPos;
  let originBlock = null;
  try { originBlock = api.getBlock(p.x, p.y, p.z); } catch (_) {}
  const blockName = originBlock && String(originBlock).includes("Chest") ? originBlock : "Chest";
  let existingData = {};
  try { existingData = api.getBlockData(p.x, p.y, p.z) || {}; } catch (_) {}
  if (existingData === null || typeof existingData !== "object") existingData = {};
  const newData = { ...existingData, crateLowered: true };
  try { api.setBlock(below.x, below.y, below.z, blockName); } catch (_) { try { api.setBlock(below.x, below.y, below.z, "Chest"); } catch (_) {} }
  try { api.setBlockData(below.x, below.y, below.z, newData); } catch (_) {}
  try { api.setBlock(p.x, p.y, p.z, "Air"); } catch (_) {}
  try { api.setBlockData(p.x, p.y, p.z, {}); } catch (_) {}
  const oldKey = `${p.x}|${p.y}|${p.z}`;
  const newKey = `${below.x}|${below.y}|${below.z}`;
  if (activeCrates.has(oldKey)) {
    const entry = activeCrates.get(oldKey);
    activeCrates.delete(oldKey);
    activeCrates.set(newKey, { ...entry, x: below.x, y: below.y, z: below.z });
  }
  return [below.x, below.y, below.z];
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
  // track for 16s roll protection + distance clear
  const key = `${p.x}|${p.y}|${p.z}`;
  activeCrates.set(key, { x: p.x, y: p.y, z: p.z, ownerId: playerId, lockUntil: now + CRATE_LOCK_MS });
}

export function clearCrateLock(api, chestPos) {
  const p = normalizeChestPos(chestPos);
  if (!p) return;
  const key = `${p.x}|${p.y}|${p.z}`;
  activeCrates.delete(key);
  let data = null;
  try { data = api.getBlockData(p.x, p.y, p.z); } catch (_) { data = null; }
  if (!data || typeof data !== "object") return;
  if (!data.crateOwnerId && !data.crateLockUntil) return;
  const { crateOwnerId, crateOwnerName, crateRarity, crateOpenedAt, crateLockUntil, crateLowered, ...rest } = data;
  try { api.setBlockData(p.x, p.y, p.z, rest); } catch (_) {}
  // if no other data, clear to empty
  try {
    if (Object.keys(rest).length === 0) api.setBlockData(p.x, p.y, p.z, {});
  } catch (_) {}
}

export function tickCrateLocks(api) {
  if (activeCrates.size === 0) return;
  const now = nowMs(api);
  for (const [key, crate] of [...activeCrates.entries()]) {
    // Ownership never expires for opening prevention; only the re-roll lock does.
    // After lockUntil, allow re-roll (isChestLocked → false) but keep crateOwnerId
    // so isChestOwnedByOther still blocks unpaid opening.
    if (now >= crate.lockUntil) {
      activeCrates.delete(key);
      // remove lock timer from BlockData but keep owner for strict barrier
      try {
        const data = api.getBlockData(crate.x, crate.y, crate.z);
        if (data && typeof data === "object" && data.crateLockUntil) {
          const { crateLockUntil, ...rest } = data;
          try { api.setBlockData(crate.x, crate.y, crate.z, rest); } catch (_) {}
        }
      } catch (_) {}
      continue;
    }
    let pos = null;
    try {
      pos = api.getPosition(crate.ownerId);
    } catch (_) { pos = null; }
    if (!pos || !Array.isArray(pos) || pos.length < 3) {
      continue;
    }
    const dx = pos[0] - (crate.x + 0.5);
    const dy = pos[1] - (crate.y + 0.5);
    const dz = pos[2] - (crate.z + 0.5);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > CRATE_CLEAR_DISTANCE) {
      // Owner walked away → early unlock for re-roll only, owner stays
      activeCrates.delete(key);
      try {
        const d2 = api.getBlockData(crate.x, crate.y, crate.z);
        if (d2 && typeof d2 === "object" && d2.crateLockUntil) {
          const { crateLockUntil, ...rest2 } = d2;
          try { api.setBlockData(crate.x, crate.y, crate.z, rest2); } catch (_) {}
        }
      } catch (_) {}
    }
  }
}

// Only roller can open — no exceptions (new barrier)
export function isChestOwnedByOther(api, chestPos, playerId) {
  const p = normalizeChestPos(chestPos);
  if (!p) return false;
  let data = null;
  try { data = api.getBlockData(p.x, p.y, p.z); } catch (_) { data = null; }
  if (!data || typeof data !== "object") return false;
  if (!data.crateOwnerId) return false;
  return data.crateOwnerId !== playerId;
}

export function isChestLocked(api, chestPos, playerId) {
  const p = normalizeChestPos(chestPos);
  if (!p) return false;
  let data = null;
  try { data = api.getBlockData(p.x, p.y, p.z); } catch (_) { data = null; }
  if (!data || typeof data !== "object") return false;
  if (!data.crateOwnerId || !data.crateLockUntil) return false;
  if (data.crateOwnerId === playerId) return false; // owner can re-roll
  const now = nowMs(api);
  return now < data.crateLockUntil;
}

/**
 * Vide un coffre sans erreur même s'il est plein (bloquant le précédent setStandardChestItemSlot).
 * 1) Reset des data du coffre qui contiennent aussi les slots (evite l'erreur "chest full" lors du vidage)
 * 2) fallback brute force Air sur 27 slots
 */
export function clearChestInventory(api, chestPos) {
  const p = normalizeChestPos(chestPos);
  if (!p) return;
  // 1) reset data chest — preserve uniquement les clés crateOwner* pour ne pas perdre le lock, le reste (inventory) est jeté
  try {
    let data = null;
    try { data = api.getBlockData(p.x, p.y, p.z); } catch (_) { data = null; }
    if (data && typeof data === "object") {
      const crateKeep = {};
      for (const k of ["crateOwnerId","crateOwnerName","crateRarity","crateOpenedAt","crateLockUntil","crateLowered"]) {
        if (k in data) crateKeep[k] = data[k];
      }
      // Si data contenait des clés d'inventaire (items/slots/inventory etc.), les jeter revient à vider le coffre
      // On détecte si data a plus que les clés crateKeep
      const extraKeys = Object.keys(data).filter(k => !(k in crateKeep));
      if (extraKeys.length > 0) {
        try { api.setBlockData(p.x, p.y, p.z, crateKeep); } catch (_) {}
        // si crateKeep vide, on force {} pour bien reset
        if (Object.keys(crateKeep).length === 0) {
          try { api.setBlockData(p.x, p.y, p.z, {}); } catch (_) {}
        }
      }
    }
  } catch (_) {}
  // 2) brute force Air — couvre le cas où l'engine stocke l'inventaire hors data
  for (let i = 0; i < 27; i++) {
    try { api.setStandardChestItemSlot([p.x, p.y, p.z], i, "Air", 1, playerIdFallback(api, chestPos)); } catch (_) {}
    try { api.setStandardChestItemSlot([p.x, p.y, p.z], i, "Air"); } catch (_) {}
    // aussi via give/remove si dispo: on ignore
  }
  try {
    if (typeof api.clearStandardChest === "function") api.clearStandardChest([p.x, p.y, p.z]);
  } catch (_) {}
}

function playerIdFallback(api, chestPos) {
  // helper to keep signature compatible when playerId non dispo — on tente sans
  return undefined;
}

export function generateChest(api, playerId, chestPos, rarity, random = Math.random) {
  if (isChestLocked(api, chestPos, playerId)) {
    const data = getChestData(api, chestPos);
    const now = nowMs(api);
    const remaining = data && data.crateLockUntil ? Math.ceil((data.crateLockUntil - now) / 1000) : Math.ceil(CRATE_LOCK_MS / 1000);
    let ownerDisplay = data && (data.crateOwnerName || data.crateOwnerId) ? (data.crateOwnerName || data.crateOwnerId) : "another player";
    if (data && data.crateOwnerId) {
      try { const n = api.getEntityName ? api.getEntityName(data.crateOwnerId) : null; if (n) ownerDisplay = n; } catch (_) {}
    }
    try { api.sendMessage(playerId, [{str:"Busy — wait ", style:{color:"#ff5555"}}, {str:`${remaining}s`, style:{color:"#ffd700"}}]); } catch(_) { try { api.sendMessage(playerId, "This crate is being used by " + ownerDisplay + " - please wait " + remaining + "s"); } catch(_){} }
    return false;
  }
  if (!hasKey(api, playerId, rarity)) {
    try { api.sendMessage(playerId, [{str:"Need ", style:{color:"#ff5555"}}, {str:CRATE_KEYS[rarity], style:{color:"#ffd700"}}]); } catch(_) { try { api.sendMessage(playerId, "You need a " + CRATE_KEYS[rarity] + " to open this chest!"); } catch(_){} }
    return false;
  }
  consumeKey(api, playerId, rarity);
  // Descend le coffre d'un bloc à l'ouverture pour laisser plus de place et éviter le re-clic accidentel (roll vs reopen)
  let effectivePos = chestPos;
  try { effectivePos = lowerChestOneBlock(api, chestPos); } catch (_) { effectivePos = chestPos; }
  setChestOwner(api, effectivePos, playerId, rarity);
  clearChestInventory(api, effectivePos);
  for (let i = 0; i < 27; i++) {
    if (random() * 100 < AIR_CHANCE[rarity]) {
      try { api.setStandardChestItemSlot(effectivePos, i, "Air", 1, playerId); } catch (_) {}
      continue;
    }
    const item = getWeightedRandomItem(rarity, random);
    if (!item) continue;
    const amount = getAmountForItem(item, random);
    try { api.setStandardChestItemSlot(effectivePos, i, item.name, amount, playerId); } catch (_) {}
  }
  try { api.sendMessage(playerId, [{str:`${rarity}`, style:{color:"#55ff55"}}, {str:" crate opened", style:{color:"#aaaaaa"}}]); } catch(_) { try { api.sendMessage(playerId, "Chest opened (" + rarity + ")!"); } catch(_){} }
  try {
    if (typeof api.openChestForPlayer === "function") {
      const pos = normalizeChestPos(effectivePos);
      if (pos) api.openChestForPlayer(playerId, pos.x, pos.y, pos.z);
    }
  } catch (_) {}
  return effectivePos;
}
