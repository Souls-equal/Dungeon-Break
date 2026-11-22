/**
 * Crate system — logic (api-free core + api helpers)
 * Mirrors the example given by the user exactly.
 */

import { CRATE_KEYS, AIR_CHANCE, LOOT_TABLE, CRATE_LOCK_MS, CRATE_CLEAR_DISTANCE } from "./config.js";

// Registry for 16s roll protection — tested every second per spec
const activeCrates = new Map(); // key "x|y|z" -> { x, y, z, ownerId, lockUntil }

// Bloxd chests have 36 slots, not 27 (field guide §9.5 CONFIRMED). Keep in sync everywhere.
export const CHEST_SLOT_COUNT = 36;

// Only these keys are allowed in crate BlockData. Everything else (inventory, leftover attributes, etc.) is discarded
// to avoid InternalError: Argument too large when existing data is huge.
const ALLOWED_CRATE_KEYS = ["crateOwnerId","crateOwnerName","crateRarity","crateOpenedAt","crateLockUntil","crateLowered"];

function sanitizeCrateData(data) {
  if (!data || typeof data !== "object") return {};
  const out = {};
  for (const k of ALLOWED_CRATE_KEYS) {
    if (k in data) {
      const v = data[k];
      // Cap string values to 200 chars to avoid attribute JSON bloat (field guide: 400 cap)
      if (typeof v === "string" && v.length > 200) out[k] = v.slice(0, 200);
      else out[k] = v;
    }
  }
  return out;
}

function safeSetBlockData(api, x, y, z, data) {
  if (!data || typeof data !== "object") data = {};
  // Extra safety: if serialized data would be >800 chars (inventory chunk), truncate to allowed keys only
  try {
    const s = JSON.stringify(data);
    if (s && s.length > 800) {
      // Force sanitize — discard everything but allowed keys
      data = sanitizeCrateData(data);
    }
  } catch (_) {
    data = sanitizeCrateData(data);
  }
  try { api.setBlockData(x, y, z, data); } catch (_) {}
}

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
  // Supports fixed {amount} or inclusive random {min,max}, or {amountMin,amountMax}
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
  // CRITICAL: only copy allowed crate keys, not entire existingData (which may be huge -> Argument too large)
  const newData = { ...sanitizeCrateData(existingData), crateLowered: true };
  try { api.setBlock(below.x, below.y, below.z, blockName); } catch (_) { try { api.setBlock(below.x, below.y, below.z, "Chest"); } catch (_) {} }
  safeSetBlockData(api, below.x, below.y, below.z, newData);
  try { api.setBlock(p.x, p.y, p.z, "Air"); } catch (_) {}
  safeSetBlockData(api, p.x, p.y, p.z, {});
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
  // Only keep allowed keys from existing, discard huge inventory/lore
  const base = sanitizeCrateData(existing);
  const merged = {
    ...base,
    crateOwnerId: playerId,
    crateOwnerName: displayName,
    crateRarity: rarity,
    crateOpenedAt: now,
    crateLockUntil: now + CRATE_LOCK_MS,
  };
  safeSetBlockData(api, p.x, p.y, p.z, merged);
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
  // Sanitize: only keep allowed keys that are not crate lock keys, discard rest (which may be huge)
  const rest = sanitizeCrateData(data);
  delete rest.crateOwnerId;
  delete rest.crateOwnerName;
  delete rest.crateRarity;
  delete rest.crateOpenedAt;
  delete rest.crateLockUntil;
  // keep crateLowered if it was there
  safeSetBlockData(api, p.x, p.y, p.z, rest);
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
          const sanitized = sanitizeCrateData(data);
          delete sanitized.crateLockUntil;
          safeSetBlockData(api, crate.x, crate.y, crate.z, sanitized);
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
          const sanitized = sanitizeCrateData(d2);
          delete sanitized.crateLockUntil;
          safeSetBlockData(api, crate.x, crate.y, crate.z, sanitized);
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
 * Empties a chest without error even if full (Argument too large).
 * Fix: 36 slots (not 27), no undefined args, sanitize BlockData, clearStandardChest first.
 */
function isCrateInUse(api, chestPos) {
  try {
    const p = normalizeChestPos(chestPos);
    if (!p) return false;
    const data = (()=>{ try{ return api.getBlockData(p.x,p.y,p.z)||{} }catch(_){return {}} })();
    if (!data || !data.crateLockUntil) return false;
    const now = nowMs(api);
    if (now >= data.crateLockUntil) return false;
    // si proprio encore à <6 blocks, on considère qu'il fouille encore
    try {
      const ownerPos = api.getPosition ? api.getPosition(data.crateOwnerId) : null;
      if (ownerPos && Array.isArray(ownerPos)) {
        const dx=ownerPos[0]-(p.x+0.5), dy=ownerPos[1]-(p.y+0.5), dz=ownerPos[2]-(p.z+0.5);
        if (Math.sqrt(dx*dx+dy*dy+dz*dz) <= CRATE_CLEAR_DISTANCE) return true;
      } else {
        // pas de pos (deco?) mais lock actif → on bloque quand même pour éviter clear fantôme
        return true;
      }
    } catch(_){ return true; }
  } catch(_){}
  return false;
}

export function clearChestInventory(api, chestPos) {
  // anti clear forcé mid-view (retours crate)
  if (isCrateInUse(api, chestPos)) return;
  const p = normalizeChestPos(chestPos);
  if (!p) return;
  const posArr = [p.x, p.y, p.z];

  // 1) Sanitize BlockData: keep only allowed crate keys, discard huge inventory/lore
  // This alone empties the chest if the engine stores inventory in blockData
  try {
    let data = null;
    try { data = api.getBlockData(p.x, p.y, p.z); } catch (_) { data = null; }
    if (data && typeof data === "object") {
      const sanitized = sanitizeCrateData(data);
      // If original had extra keys beyond allowed, it likely contained inventory — replace with sanitized small version
      const extraKeys = Object.keys(data).filter(k => !ALLOWED_CRATE_KEYS.includes(k));
      if (extraKeys.length > 0) {
        safeSetBlockData(api, p.x, p.y, p.z, sanitized);
      }
    }
  } catch (_) {}

  // 2) Try atomic clear (best for full chests — single call, no per-slot serialization of full inventory)
  let clearedByAtomic = false;
  try {
    if (typeof api.clearStandardChest === "function") {
      api.clearStandardChest(posArr);
      clearedByAtomic = true;
    }
  } catch (_) {}
  // Also try alternative name
  if (!clearedByAtomic) {
    try {
      if (typeof api.clearChest === "function") {
        api.clearChest(posArr);
        clearedByAtomic = true;
      }
    } catch (_) {}
  }

  // 3) Fallback: brute force Air on all 36 slots — 3 args only (Air ignores amount), no undefined playerId
  // Use minimal args to avoid large argument serialization. Each slot cleared individually.
  for (let i = 0; i < CHEST_SLOT_COUNT; i++) {
    try { api.setStandardChestItemSlot(posArr, i, "Air"); } catch (_) {}
  }

  // 4) Last resort: if still not empty (some engines need explicit Air with player context), try with correct arity
  // We do not pass undefined — we omit optional args entirely.
}

// Queue for tick-striped safe clearing of extremely full chests (Argument too large guard, field guide §1.3)
const chestClearQueue = [];
let chestClearActive = false;

function enqueueChestClear(posArr, totalSlots = CHEST_SLOT_COUNT) {
  chestClearQueue.push({ posArr, nextSlot: 0, totalSlots });
}

export function tickChestClearQueue(api) {
  if (chestClearQueue.length === 0) return;
  // Process at most 6 slots per tick to keep per-tick argument size small
  const BATCH = 6;
  const job = chestClearQueue[0];
  let done = 0;
  while (done < BATCH && job.nextSlot < job.totalSlots) {
    try { api.setStandardChestItemSlot(job.posArr, job.nextSlot, "Air"); } catch (_) {}
    job.nextSlot++;
    done++;
  }
  if (job.nextSlot >= job.totalSlots) {
    chestClearQueue.shift();
    // try atomic again in case some slots were missed due to earlier failure
    try { if (typeof api.clearStandardChest === "function") api.clearStandardChest(job.posArr); } catch (_) {}
  }
}

export function isChestClearQueueBusy() {
  return chestClearQueue.length > 0;
}

/**
 * Empty a chest in a chunked, tick-safe way for extremely full chests that throw Argument too large
 * when cleared synchronously. Returns true if fully cleared sync, false if chunked async started.
 * Use this for manual "vider coffre" command.
 */
export function clearChestInventoryChunked(api, chestPos, onDone) {
  if (isCrateInUse(api, chestPos)) {
    if (onDone) try { onDone(false); } catch(_){}
    try { const pp = normalizeChestPos(chestPos); if (pp) { const n = (()=>{try{return api.getBlockData(pp.x,pp.y,pp.z)||{}}catch(_){return{}}})().crateOwnerName; if (n) api.sendMessage(n, [{str:"Crate in use — cannot clear", style:{color:"#ff5555"}}]); } } catch(_){}
    return false;
  }
  const p = normalizeChestPos(chestPos);
  if (!p) { if (onDone) try { onDone(); } catch(_){} return true; }
  const posArr = [p.x, p.y, p.z];

  // Try atomic first — if it works, we're done sync (best for Argument too large)
  try {
    if (typeof api.clearStandardChest === "function") { api.clearStandardChest(posArr); if (onDone) onDone(true); return true; }
  } catch (_) {}
  // Sanitize blockData first (may contain huge inventory stored as blockData)
  try {
    let data = api.getBlockData(p.x, p.y, p.z);
    if (data && typeof data === "object") {
      const extra = Object.keys(data).filter(k => !ALLOWED_CRATE_KEYS.includes(k));
      if (extra.length > 0) safeSetBlockData(api, p.x, p.y, p.z, sanitizeCrateData(data));
    }
  } catch (_) {}

  // For manual empty, go directly to chunked queue to guarantee tick-safety for huge chests
  // (sync 36x setStandardChestItemSlot in one tick can still be Argument too large if each serializes 36 large items)
  enqueueChestClear(posArr, CHEST_SLOT_COUNT);
  // Also try to sanitize blockData immediately (small write)
  // Caller can listen for completion via queue empty; we invoke onDone async after ~ (36/6)=6 ticks = 300ms
  // For now, don't poll — worldCode tick will drain queue; we notify immediate that async started
  if (onDone) {
    // Defer callback to avoid blocking; worldCode will handle message
    try { onDone(false); } catch(_){}
  }
  return false;
}

// Expose queue for tests
export function _clearQueueForTest() { chestClearQueue.length = 0; }

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
  // Anti double-open par le proprio pendant qu'il fouille (5-15s): isChestLocked laisse passer le proprio, on bloque ici explicitement
  {
    const data = getChestData(api, chestPos);
    if (data && data.crateOwnerId === playerId && data.crateLockUntil) {
      const now = nowMs(api);
      if (now < data.crateLockUntil) {
        // même proprio mais lock encore actif (= il est encore dedans ou vient d'ouvrir) → on bloque le re-roll qui ferait un clear forcé mid-view
        const remaining = Math.ceil((data.crateLockUntil - now) / 1000);
        try { api.sendMessage(playerId, [{str:"Already opened — wait ", style:{color:"#ff5555"}}, {str:`${remaining}s`, style:{color:"#ffd700"}}, {str:" or move 6 blocks", style:{color:"#aaaaaa"}}]); } catch(_) {}
        return false;
      }
    }
    // aussi checker la position après abaissement (lowerChestOneBlock change de y)
    const altPos = (()=>{ const p=normalizeChestPos(chestPos); if(!p) return null; return [p.x, p.y-1, p.z]; })();
    if (altPos) {
      const data2 = (()=>{ try{ return api.getBlockData(altPos[0],altPos[1],altPos[2])||{} }catch(_){return {}} })();
      if (data2 && data2.crateOwnerId === playerId && data2.crateLockUntil && nowMs(api) < data2.crateLockUntil) {
        const remaining = Math.ceil((data2.crateLockUntil - nowMs(api)) / 1000);
        try { api.sendMessage(playerId, [{str:"Already opened — wait ", style:{color:"#ff5555"}}, {str:`${remaining}s`, style:{color:"#ffd700"}}]); } catch(_) {}
        return false;
      }
    }
  }
  if (!hasKey(api, playerId, rarity)) {
    try { api.sendMessage(playerId, [{str:"Need ", style:{color:"#ff5555"}}, {str:CRATE_KEYS[rarity], style:{color:"#ffd700"}}]); } catch(_) { try { api.sendMessage(playerId, "You need a " + CRATE_KEYS[rarity] + " to open this chest!"); } catch(_){} }
    return false;
  }
  consumeKey(api, playerId, rarity);
  // Lower chest by one block on open for more space and to avoid accidental re-click (roll vs reopen)
  let effectivePos = chestPos;
  try { effectivePos = lowerChestOneBlock(api, chestPos); } catch (_) { effectivePos = chestPos; }
  setChestOwner(api, effectivePos, playerId, rarity);
  clearChestInventory(api, effectivePos);
  // Fill all 36 slots (Bloxd chests are 36, not 27). Use 3-arg form for Air, 4-arg for items (no playerId) to avoid large args.
  const effArr = normalizeChestPos(effectivePos);
  const fillPos = effArr ? [effArr.x, effArr.y, effArr.z] : effectivePos;
  for (let i = 0; i < CHEST_SLOT_COUNT; i++) {
    if (random() * 100 < AIR_CHANCE[rarity]) {
      try { api.setStandardChestItemSlot(fillPos, i, "Air"); } catch (_) {}
      continue;
    }
    const item = getWeightedRandomItem(rarity, random);
    if (!item) continue;
    const amount = getAmountForItem(item, random);
    try { api.setStandardChestItemSlot(fillPos, i, item.name, amount); } catch (_) {}
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
