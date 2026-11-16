/**
 * Ranks service — tracks stats, unlocks, selection.
 * Pure logic + db persistence via injected api.
 */

import { RANKS, getRank, isRestricted, isAvailableForPlayer, isRareRarity } from "./config.js";

export const RANKS_DB_KEY = "dungeonBreak.ranks.v1";
export const NONE_ID = "NONE";

function emptyStats() {
  return {
    crates: 0,
    cratesByRarity: {}, // rarity -> count
    cratesRare: 0,
    kills: 0,
    rooms: 0,
    timeTicks: 0,
    timeHardTicks: 0,
    timeHellTicks: 0,
  };
}

function emptyData() {
  return {
    stats: emptyStats(),
    unlocked: {}, // id -> true (also includes free/member)
    selected: null, // null or rank id, "NONE" means no prefix
  };
}

export function createRanksService(options = {}) {
  const api = options.api || null;
  const log = options.log || (() => {});

  // playerId -> data (in memory)
  const store = new Map();

  function playerNameOf(playerId) {
    try {
      if (api && typeof api.getEntityName === "function") {
        const n = api.getEntityName(playerId);
        if (n) return String(n);
      }
    } catch (_) {}
    return String(playerId);
  }

  function load(playerId) {
    const key = String(playerId);
    if (store.has(key)) return store.get(key);
    let data = emptyData();
    try {
      if (api && typeof api.getPlayerDbValue === "function") {
        const raw = api.getPlayerDbValue(playerId, RANKS_DB_KEY);
        if (raw) {
          let parsed = raw;
          if (typeof raw === "string") {
            try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
          }
          if (parsed && typeof parsed === "object") {
            data.stats = { ...emptyStats(), ...(parsed.stats || {}) };
            data.stats.cratesByRarity = { ...(parsed.stats?.cratesByRarity || {}) };
            data.unlocked = { ...(parsed.unlocked || {}) };
            data.selected = parsed.selected ?? null;
          }
        }
      }
    } catch (e) {
      log(`ranks load failed for ${playerId}: ${e && e.message ? e.message : e}`);
    }
    // ensure free/member is unlocked for all
    data.unlocked["member"] = true;
    // ensure restricted ranks are marked unlocked for eligible players (not persisted unless needed)
    // but we keep them as unlocked in memory if eligible
    const name = playerNameOf(playerId);
    for (const r of RANKS) {
      if (isRestricted(r) && isAvailableForPlayer(r, name)) {
        data.unlocked[r.id] = true;
      }
    }
    store.set(key, data);
    return data;
  }

  function save(playerId) {
    const data = store.get(String(playerId));
    if (!data) return;
    try {
      if (api && typeof api.setPlayerDbValue === "function") {
        api.setPlayerDbValue(playerId, RANKS_DB_KEY, JSON.stringify(data));
      }
    } catch (e) {
      log(`ranks save failed for ${playerId}: ${e && e.message ? e.message : e}`);
    }
  }

  function ensure(playerId) {
    return load(playerId);
  }

  function checkUnlocks(playerId) {
    const data = ensure(playerId);
    let changed = [];
    for (const rank of RANKS) {
      if (data.unlocked[rank.id]) continue;
      if (isRestricted(rank)) continue; // restricted already handled via name
      const u = rank.unlock;
      if (!u) {
        data.unlocked[rank.id] = true;
        changed.push(rank);
        continue;
      }
      let ok = false;
      if (u.type === "crates") ok = (data.stats.crates || 0) >= u.count;
      else if (u.type === "cratesRare") ok = (data.stats.cratesRare || 0) >= u.count;
      else if (u.type === "kills") ok = (data.stats.kills || 0) >= u.count;
      else if (u.type === "rooms") ok = (data.stats.rooms || 0) >= u.count;
      else if (u.type === "time") ok = (data.stats.timeTicks || 0) >= u.countTicks;
      else if (u.type === "timeHard") ok = (data.stats.timeHardTicks || 0) >= u.countTicks;
      else if (u.type === "timeHell") ok = (data.stats.timeHellTicks || 0) >= u.countTicks;
      if (ok) {
        data.unlocked[rank.id] = true;
        changed.push(rank);
      }
    }
    if (changed.length > 0) save(playerId);
    return changed;
  }

  function recordCrate(playerId, rarity) {
    const data = ensure(playerId);
    data.stats.crates = (data.stats.crates || 0) + 1;
    if (rarity) {
      data.stats.cratesByRarity[rarity] = (data.stats.cratesByRarity[rarity] || 0) + 1;
      if (isRareRarity(rarity)) data.stats.cratesRare = (data.stats.cratesRare || 0) + 1;
    }
    save(playerId);
    return checkUnlocks(playerId);
  }

  function recordKill(playerId) {
    const data = ensure(playerId);
    data.stats.kills = (data.stats.kills || 0) + 1;
    save(playerId);
    return checkUnlocks(playerId);
  }

  function recordRoom(playerId) {
    const data = ensure(playerId);
    data.stats.rooms = (data.stats.rooms || 0) + 1;
    save(playerId);
    return checkUnlocks(playerId);
  }

  function recordTime(playerId, difficultyId, ticks = 1) {
    const data = ensure(playerId);
    data.stats.timeTicks = (data.stats.timeTicks || 0) + ticks;
    // Hard+ = hard, insane, nightmare, hell
    const hardIds = ["hard", "insane", "nightmare", "hell"];
    if (hardIds.includes(difficultyId)) data.stats.timeHardTicks = (data.stats.timeHardTicks || 0) + ticks;
    if (difficultyId === "hell") data.stats.timeHellTicks = (data.stats.timeHellTicks || 0) + ticks;
    // don't save every tick — caller saves periodically
  }

  function saveTime(playerId) {
    save(playerId);
    return checkUnlocks(playerId);
  }

  function getAvailableRanks(playerId) {
    const data = ensure(playerId);
    const name = playerNameOf(playerId);
    const list = [];
    for (const r of RANKS) {
      if (data.unlocked[r.id]) {
        // for restricted, double check name still matches (if player renamed, not available)
        if (isRestricted(r) && !isAvailableForPlayer(r, name)) continue;
        list.push(r);
      } else {
        // free/member already unlocked
        if (!r.unlock) {
          // if restricted not eligible skip
          if (isRestricted(r) && !isAvailableForPlayer(r, name)) continue;
          list.push(r);
        }
      }
    }
    return list;
  }

  function getSelectedRank(playerId) {
    const data = ensure(playerId);
    const sel = data.selected;
    if (!sel || sel === NONE_ID) return null;
    const rank = getRank(sel);
    if (!rank) return null;
    // ensure still available
    const avail = getAvailableRanks(playerId).some(r => r.id === sel);
    if (!avail) return null;
    return rank;
  }

  function setSelected(playerId, rankId) {
    const data = ensure(playerId);
    if (!rankId || rankId === NONE_ID) {
      data.selected = NONE_ID;
      save(playerId);
      return null;
    }
    const rank = getRank(rankId);
    if (!rank) return null;
    const avail = getAvailableRanks(playerId).some(r => r.id === rankId);
    if (!avail) return null;
    data.selected = rankId;
    save(playerId);
    return rank;
  }

  function getDisplayRank(playerId) {
    // if player has not chosen, default to restricted rank if they have one, else null
    const data = ensure(playerId);
    if (data.selected === NONE_ID) return null;
    if (data.selected) {
      const r = getRank(data.selected);
      if (r) return r;
    }
    // auto-default: if eligible for owner/tester and no selection, use that
    const name = playerNameOf(playerId);
    for (const r of RANKS) {
      if (isRestricted(r) && isAvailableForPlayer(r, name)) return r;
    }
    return null;
  }

  function forget(playerId) {
    store.delete(String(playerId));
  }

  function statsOf(playerId) {
    return ensure(playerId).stats;
  }

  return {
    load,
    save,
    ensure,
    checkUnlocks,
    recordCrate,
    recordKill,
    recordRoom,
    recordTime,
    saveTime,
    getAvailableRanks,
    getSelectedRank,
    getDisplayRank,
    setSelected,
    forget,
    statsOf,
    // for tests
    _store: store,
  };
}
