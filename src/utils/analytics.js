/**
 * Analytics wrapper — Bloxd internal only (no external call).
 * Uses api.registerAnalyticsEvent when available (custom games), silent otherwise.
 * Respects Bloxd limits: 20 events/min/player, 20 categories, 20 types/cat, 50 values/type.
 *
 * Usage:
 *   import { track, trackPos } from "./utils/analytics.js";
 *   track(playerId, "blessing", "pick", { numericValue: 1, gameCategoryId: "main" });
 */

let gameStartMs = Date.now();
try { if (typeof api !== "undefined" && typeof api.now === "function") gameStartMs = api.now(); } catch(_) {}

export function setGameStartMs(ms) {
  if (Number.isFinite(ms)) gameStartMs = ms;
}

function getGameStartMs(opts) {
  if (opts && Number.isFinite(opts.gameStartTimeMs)) return opts.gameStartTimeMs;
  // Refresh from api.now if available (keeps relative time accurate)
  try { if (typeof api !== "undefined" && typeof api.now === "function") return api.now(); } catch(_) {}
  return gameStartMs;
}

function clampStr(s, max) {
  if (s == null) return null;
  const str = String(s);
  return str.length > max ? str.slice(0, max) : str;
}

export function track(playerId, eventType, eventValue = null, opts = {}) {
  try {
    const pid = String(playerId ?? "unknown");
    const type = clampStr(eventType || "unknown", 64) || "unknown";
    const value = eventValue == null ? null : clampStr(eventValue, 128);
    const cat = opts.gameCategoryId ? clampStr(opts.gameCategoryId, 128) : null;
    const start = getGameStartMs(opts);
    let pos = null;
    if (opts.position && Array.isArray(opts.position) && opts.position.length >= 3) {
      pos = [Number(opts.position[0])||0, Number(opts.position[1])||0, Number(opts.position[2])||0];
    } else if (!opts.noPos) {
      // Try to auto-resolve player position for heatmap when not provided
      try {
        if (typeof api !== "undefined" && typeof api.getPosition === "function" && pid !== "unknown") {
          const p = api.getPosition(pid);
          if (p && Array.isArray(p) && p.length >= 3) pos = [p[0], p[1], p[2]];
        }
      } catch(_) {}
    }
    // Bloxd analytics: y must be -32768..32767, else Invalid argument #6
    if (pos && Array.isArray(pos) && pos.length >= 3) {
      const y = Number(pos[1]);
      if (!Number.isFinite(y) || y < -32768 || y > 32767) pos = null;
    }
    const num = opts.numericValue != null && Number.isFinite(Number(opts.numericValue)) ? Number(opts.numericValue) : null;

    if (typeof api !== "undefined" && typeof api.registerAnalyticsEvent === "function") {
      api.registerAnalyticsEvent(pid, type, value, cat, start, pos, num);
    }
    // silently ignore if analytics not available (no api.log fallback)
  } catch(_e) {
    // Never break game for analytics — silent
  }
}

// Heatmap position — call ~1/sec per player max (limit 120/min)
export function trackPos(playerId, gameCategoryId = null) {
  try {
    if (typeof api === "undefined" || typeof api.registerAnalyticsPlayerPosition !== "function") return;
    let pos = null;
    try { if (typeof api.getPosition === "function") pos = api.getPosition(playerId); } catch(_) {}
    if (!pos || !Array.isArray(pos)) return;
    const y = Number(pos[1]);
    if (!Number.isFinite(y) || y < -32768 || y > 32767) return;
    const cat = gameCategoryId ? String(gameCategoryId).slice(0,128) : null;
    api.registerAnalyticsPlayerPosition(String(playerId), cat, getGameStartMs(), pos);
  } catch(_) {}
}

// Convenience helpers for common events (keep eventType stable for Bloxd limits)
export const Analytics = {
  playerJoin: (pid, props={}) => track(pid, "player", "join", props),
  playerLeave: (pid, props={}) => track(pid, "player", "leave", props),
  playerDeath: (pid, props={}) => track(pid, "player", "death", props),
  dungeonEnter: (pid, difficulty, props={}) => track(pid, "dungeon", "enter", { ...props, numericValue: props.numericValue ?? undefined, gameCategoryId: difficulty || props.gameCategoryId }),
  dungeonLeave: (pid, props={}) => track(pid, "dungeon", "leave", props),
  roomDiscover: (pid, props={}) => track(pid, "dungeon", "room_discover", props),
  mobKill: (pid, props={}) => track(pid, "combat", "kill", props),
  combatHit: (pid, props={}) => track(pid, "combat", "hit", props),
  crateOpen: (pid, rarity, props={}) => track(pid, "crate", "open", { ...props, gameCategoryId: rarity || props.gameCategoryId }),
  blessRoll: (pid, props={}) => track(pid, "blessing", "roll", props),
  blessPick: (pid, blessingId, props={}) => track(pid, "blessing", "pick", { ...props, gameCategoryId: blessingId || props.gameCategoryId }),
  blessReroll: (pid, cost, props={}) => track(pid, "blessing", "reroll", { ...props, numericValue: cost }),
  craftSuccess: (pid, item, props={}) => track(pid, "craft", "success", { ...props, gameCategoryId: item }),
  tutorialStart: (pid, props={}) => track(pid, "tutorial", "start", props),
  tutorialComplete: (pid, props={}) => track(pid, "tutorial", "complete", props),
  questComplete: (pid, questId, props={}) => track(pid, "quest", "complete", { ...props, gameCategoryId: questId }),
  questProgress: (pid, questId, props={}) => track(pid, "quest", "progress", { ...props, gameCategoryId: questId }),
  passLevel: (pid, tier, props={}) => track(pid, "pass", "level", { ...props, numericValue: tier }),
  passXp: (pid, xp, props={}) => track(pid, "pass", "xp_gain", { ...props, numericValue: xp }),
  rankUnlock: (pid, rankId, props={}) => track(pid, "rank", "unlock", { ...props, gameCategoryId: rankId }),
  rankSelect: (pid, rankId, props={}) => track(pid, "rank", "select", { ...props, gameCategoryId: rankId }),
  shopTeleport: (pid, props={}) => track(pid, "shop", "teleport", props),
  padUse: (pid, difficulty, props={}) => track(pid, "pad", "use", { ...props, gameCategoryId: difficulty }),
};
