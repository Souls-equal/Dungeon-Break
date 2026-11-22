/**
 * Pass — service
 * - DB persistence via PlayerDbValue
 * - 500 XP per tier, 20 tiers
 * - Each tier has 2 shop tiles: [Reward clickable] [Description textStyling, no icon if possible]
 */

import { PASS_CATEGORY, PASS_DB_KEY, PASS_MAX_TIER, PASS_XP_PER_TIER, PASS_TIERS, PASS_XP_PER_QUEST, tierRequirement } from "./config.js";

const cache = new Map(); // pid -> {xp:number, claimed:number[]}  claimed = list of tier numbers

function pidKey(pid) { return String(pid); }

function emptyState() {
  return { xp: 0, claimed: [] };
}

function cloneState(s) {
  return { xp: s.xp|0, claimed: Array.isArray(s.claimed) ? [...s.claimed] : [] };
}

export function loadPassState(api, playerId) {
  const k = pidKey(playerId);
  if (cache.has(k)) return cloneState(cache.get(k));
  let state = emptyState();
  try {
    if (api && typeof api.getPlayerDbValue === "function") {
      const raw = api.getPlayerDbValue(playerId, PASS_DB_KEY);
      if (raw) {
        let parsed = raw;
        if (typeof raw === "string") {
          try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
        }
        if (parsed && typeof parsed === "object") {
          state.xp = Number(parsed.xp) || 0;
          state.claimed = Array.isArray(parsed.claimed) ? parsed.claimed.filter(n => Number.isFinite(n)) : [];
        }
      }
    }
  } catch (_) {}
  cache.set(k, cloneState(state));
  return cloneState(state);
}

export function savePassState(api, playerId, state) {
  const k = pidKey(playerId);
  cache.set(k, cloneState(state));
  try {
    if (api && typeof api.setPlayerDbValue === "function") {
      api.setPlayerDbValue(playerId, PASS_DB_KEY, JSON.stringify({ xp: state.xp|0, claimed: state.claimed }));
    }
  } catch (_) {}
}

export function getPassTier(xp) {
  return Math.min(PASS_MAX_TIER, Math.floor((xp|0) / PASS_XP_PER_TIER) + 1);
}
export function xpForTier(tier) {
  return tierRequirement(tier);
}

export function canClaim(state, tier) {
  const req = tierRequirement(tier);
  return (state.xp >= req) && !state.claimed.includes(tier);
}
export function isClaimed(state, tier) {
  return state.claimed.includes(tier);
}

function giveRewardItems(api, playerId, tierDef) {
  let given = [];
  for (const r of (tierDef.rewards || [])) {
    try {
      if (r.type === "gold") {
        if (typeof api.giveCurrencyAmount === "function") {
          api.giveCurrencyAmount(playerId, "cstm_smp_gold", r.amount);
        } else if (typeof api.setCurrencyAmount === "function" && typeof api.getCurrencyAmount === "function") {
          const cur = Number(api.getCurrencyAmount(playerId, "cstm_smp_gold") || 0);
          api.setCurrencyAmount(playerId, "cstm_smp_gold", cur + r.amount);
        } else if (typeof api.giveItem === "function") {
          // fallback as item? shouldn't happen
        }
        given.push(`${r.amount} gold`);
      } else if (r.type === "item") {
        const name = r.name;
        const amt = r.amount|0;
        if (typeof api.giveItem === "function") api.giveItem(playerId, name, amt);
        else if (typeof api.giveItemStack === "function") api.giveItemStack(playerId, name, amt);
        else if (typeof api.setItemSlot === "function") {
          // fallback brute: find empty slot
          for (let i=0;i<60;i++) { try { const it = api.getItemSlot(playerId,i); if(!it || !it.name || it.name==="Air") { api.setItemSlot(playerId,i,name,amt); break; } } catch(_){} }
        }
        given.push(`${amt}x ${name}`);
      } else if (r.type === "aura") {
        if (typeof api.applyAuraChange === "function") api.applyAuraChange(playerId, r.amount);
        given.push(`+${r.amount} Aura`);
      }
    } catch (_) {}
  }
  return given;
}

export function addPassXp(api, playerId, amount) {
  if (!amount || amount <=0) return null;
  const state = loadPassState(api, playerId);
  const before = state.xp|0;
  state.xp = Math.min(totalMaxXp(), (state.xp|0) + (amount|0));
  savePassState(api, playerId, state);
  const after = state.xp;
  // notify
  try {
    const tierReached = Math.floor(after / PASS_XP_PER_TIER);
    const prevTierReached = Math.floor(before / PASS_XP_PER_TIER);
    if (tierReached > prevTierReached) {
      try {
        if (typeof api.sendMessage === "function") {
          api.sendMessage(playerId, [
            { str: `Pass: `, style: { color: "#FFD700", fontWeight: "bold" } },
            { str: `Tier ${tierReached} unlocked! `, style: { color: "#55FF55", fontWeight: "bold" } },
            { str: `(${after}/${PASS_MAX_TIER*PASS_XP_PER_TIER} XP)`, style: { color: "#AAAAAA" } },
          ]);
        }
        if (typeof api.sendFlyingMiddleMessage === "function") {
          api.sendFlyingMiddleMessage(playerId, [{ str: `Pass Tier ${tierReached} unlocked!`, style: { color: "#FFD700" } }], 400, 700);
        }
      } catch (_) {}
    } else {
      // small progress toast? not spam
    }
  } catch (_) {}
  try { refreshPassShop(api, playerId); } catch (_) {}
  return state;
}

function totalMaxXp() { return PASS_MAX_TIER * PASS_XP_PER_TIER; }

export function tryClaimTier(api, playerId, tier) {
  if (!Number.isFinite(tier) || tier <1 || tier > PASS_MAX_TIER) return { ok:false, reason:"bad tier" };
  const state = loadPassState(api, playerId);
  if (state.claimed.includes(tier)) return { ok:false, reason:"already claimed" };
  const req = tierRequirement(tier);
  if (state.xp < req) return { ok:false, reason:"not enough xp", need: req, have: state.xp };
  const tierDef = PASS_TIERS.find(t=>t.tier===tier);
  if (!tierDef) return { ok:false, reason:"unknown tier" };
  // give
  const given = giveRewardItems(api, playerId, tierDef);
  state.claimed.push(tier);
  state.claimed.sort((a,b)=>a-b);
  savePassState(api, playerId, state);
  try {
    if (typeof api.sendMessage === "function") {
      api.sendMessage(playerId, [
        { str: `Pass Tier ${tier}: `, style: { color: "#FFD700", fontWeight: "bold" } },
        { str: `claimed `, style: { color: "#55FF55" } },
        { str: tierDef.title, style: { color: "#FFFFFF", fontWeight: "bold" } },
        { str: given.length ? ` (${given.join(", ")})` : "", style: { color: "#AAAAAA" } },
      ]);
    }
  } catch (_) {}
  try { refreshPassShop(api, playerId); } catch (_) {}
  return { ok:true, tier, title: tierDef.title, given };
}

// Build shop tiles for this player
export function refreshPassShop(api, playerId) {
  if (!api || typeof api.createShopItemForPlayer !== "function") return;
  const state = loadPassState(api, playerId);
  const xp = state.xp|0;
  // category header
  try {
    if (typeof api.configureShopCategoryForPlayer === "function") {
      const curTier = Math.min(PASS_MAX_TIER, Math.floor(xp / PASS_XP_PER_TIER));
      const claimedCount = state.claimed.length;
      const desc = `Tier ${curTier}/${PASS_MAX_TIER} · ${xp}/${totalMaxXp()} XP · ${claimedCount} claimed`;
      api.configureShopCategoryForPlayer(playerId, PASS_CATEGORY, { customTitle: "Pass", description: desc, redDot: state.claimed.length < curTier });
    }
  } catch (_) {}

  for (let t=1; t<=PASS_MAX_TIER; t++) {
    const tierDef = PASS_TIERS.find(x=>x.tier===t);
    if (!tierDef) continue;
    const req = tierRequirement(t);
    const unlocked = xp >= req;
    const claimed = state.claimed.includes(t);
    const rewardKey = `Pass T${t} Reward`;
    const infoKey = `Pass T${t} Info`;

    // ---- reward tile: icon + name as title, clickable ----
    try {
      const canBuy = unlocked && !claimed;
      const statusText = claimed ? "Claimed ✓" : unlocked ? "Claim now!" : `Need ${req} XP`;
      const statusColor = claimed ? "#55FF55" : unlocked ? "#FFD700" : "#FF5555";
      // description is short styled status line
      const rewardDesc = [
        { str: `Tier ${t} · `, style: { color: "#AAAAAA" } },
        { str: `${req} XP`, style: { color: unlocked ? "#55FF55" : "#FF5555" } },
        { str: `\n`, style: {} },
        { str: statusText, style: { color: statusColor, fontWeight: "bold" } },
      ];
      api.createShopItemForPlayer(playerId, PASS_CATEGORY, rewardKey, {
        image: tierDef.icon || "Gold Coin",
        customTitle: tierDef.title,
        description: rewardDesc,
        buyButtonText: claimed ? "Claimed" : unlocked ? "Claim" : "Locked",
        canBuy: canBuy,
        redDot: canBuy,
        sortPriority: 1000 - (t*2) + 1, // reward slightly higher than info so they pair
      });
    } catch (_) {}

    // ---- description tile: textStyling only, no icon if possible ----
    try {
      const progress = Math.min(xp, req);
      const pct = Math.min(100, Math.round(progress / req * 100));
      const barFilled = Math.round(pct/10);
      const bar = "█".repeat(barFilled) + "░".repeat(10-barFilled);
      const descLines = [];
      descLines.push({ str: `Tier ${t} — ${tierDef.title}\n`, style: { color: "#FFD700", fontWeight: "bold" } });
      descLines.push({ str: `Requires ${req} XP`, style: { color: unlocked ? "#55FF55" : "#AAAAAA" } });
      descLines.push({ str: ` · You: ${xp} XP (${pct}%)\n`, style: { color: "#FFFFFF" } });
      descLines.push({ str: `${bar}\n`, style: { color: pct>=100 ? "#55FF55" : "#555555" } });
      if (tierDef.extraDesc) descLines.push({ str: tierDef.extraDesc + "\n", style: { color: "#AAAAAA", fontStyle: "italic" } });
      // rewards list
      const rewardText = (tierDef.rewards||[]).map(r=>{
        if(r.type==="gold") return `${r.amount} Gold`;
        if(r.type==="item") return `${r.amount}x ${r.name}`;
        if(r.type==="aura") return `+${r.amount} Aura`;
        return r.title||"";
      }).join(", ");
      descLines.push({ str: `Reward: `, style: { color: "#FFD700", fontWeight: "bold" } });
      descLines.push({ str: rewardText + "\n", style: { color: "#FFFFFF" } });
      if (claimed) descLines.push({ str: "✓ Already claimed", style: { color: "#55FF55", fontWeight: "bold" } });
      else if (unlocked) descLines.push({ str: "→ Claim the reward tile!", style: { color: "#FFD700", fontWeight: "bold" } });
      else descLines.push({ str: `Locked — need ${req - xp} more XP`, style: { color: "#FF5555" } });

      const item = {
        // try no image: omit image field -> Bloxd may default but we attempt
        customTitle: `Tier ${t} Info`,
        description: descLines,
        canBuy: false,
        redDot: false,
        sortPriority: 1000 - (t*2),
      };
      // Attempt to set no icon: if api requires image, fallback to invisible-ish
      // We intentionally do NOT set image to satisfy "pas d'image si possible"
      // But provide it only if the call would fail without — we catch and retry with fallback
      try {
        api.createShopItemForPlayer(playerId, PASS_CATEGORY, infoKey, item);
      } catch (e) {
        // fallback with transparent icon if platform requires image
        try { api.createShopItemForPlayer(playerId, PASS_CATEGORY, infoKey, { ...item, image: "Air" }); } catch(_){}
      }
    } catch (_) {}
  }
}

export function onPassBought(api, playerId, itemKey) {
  // itemKey like "Pass T3 Reward" — extract tier
  const m = String(itemKey||"").match(/^Pass T(\d+) Reward$/);
  if (!m) return false; // not our reward tile (info tiles are not buyable)
  const tier = Number(m[1]);
  const res = tryClaimTier(api, playerId, tier);
  if (!res.ok) {
    // feedback when trying to claim locked/already
    try {
      if (typeof api.sendMessage === "function") {
        if (res.reason === "not enough xp") {
          api.sendMessage(playerId, [
            { str: `Pass Tier ${tier} locked — `, style: { color: "#FF5555" } },
            { str: `${res.have}/${res.need} XP`, style: { color: "#AAAAAA" } },
          ]);
        } else if (res.reason === "already claimed") {
          api.sendMessage(playerId, [{ str: `Pass Tier ${tier} already claimed`, style: { color: "#AAAAAA" } }]);
        }
      }
    } catch (_) {}
    // refresh to keep correct canBuy state
    try { refreshPassShop(api, playerId); } catch(_){}
    return true; // handled
  }
  return true;
}

export function initPassForPlayer(api, playerId) {
  try { loadPassState(api, playerId); } catch(_){}
  try { refreshPassShop(api, playerId); } catch(_){}
}

export function forgetPass(playerId) {
  cache.delete(pidKey(playerId));
}

export function _resetForTests() { cache.clear(); }

export function _getCache() { return cache; }
