/**
 * Daily Quests — service
 *
 * - NPC spawns directly at [5.5,21,4.5], never despawns, looks at nearest player every 5s
 * - Sidebar RightInfoText with extensible text format + rewards
 * - Quest scaled to player strength (gold/stats/optional equipment)
 * - Daily storage via PlayerDbValue + gold/aura rewards
 *
 * Integration in worldCode.js:
 *   initQuestSystem(api)            // on load
 *   onQuestPlayerJoin(api, pid)     // onPlayerJoin
 *   onQuestMobKilled(api, pid)      // onPlayerKilledMob
 *   onQuestCrateOpened(api, pid)    // generateChest success
 *   onQuestTick(api)                // tick (sidebar refresh + NPC respawn guard)
 *   onQuestMobDespawned(mobId)      // onMobDespawned / onEntityDeleted
 *   onQuestPlayerLeave(pid)         // onPlayerLeave (cleanup sidebar)
 */

import { setTimeout as scheduleTimeout } from "../utils/scheduler.js";
import {
  QUEST_NPC_POS,
  QUEST_NPC_NAME,
  QUEST_DB_KEY,
  QUEST_TEMPLATES,
  QUEST_NPC_LOOK_INTERVAL_TICKS,
  QUEST_SIDEBAR_REFRESH_TICKS,
  powerScore,
  scaledTarget,
  pickTemplateForToday,
  findTemplate,
  todayDateUTC,
} from "./config.js";

let npcId = null;
let npcSpawnTries = 0;
let npcLookCounter = 0;
let sidebarCounter = 0;
let initialized = false;

// In-memory progress (mirrors DB) for fast access
const questCache = new Map(); // playerIdStr -> { date, questId, target, progress, completed, claimed }

/** Helpers */
function loadQuestState(api, playerId) {
  const pidStr = String(playerId);
  if (questCache.has(pidStr)) return questCache.get(pidStr);
  try {
    if (typeof api.getPlayerDbValue === "function") {
      const raw = api.getPlayerDbValue(playerId, QUEST_DB_KEY);
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed && parsed.date && parsed.questId) {
          questCache.set(pidStr, parsed);
          return parsed;
        }
      }
    }
  } catch (_) {}
  return null;
}

function saveQuestState(api, playerId, state) {
  const pidStr = String(playerId);
  questCache.set(pidStr, state);
  try {
    if (typeof api.setPlayerDbValue === "function") {
      api.setPlayerDbValue(playerId, QUEST_DB_KEY, JSON.stringify(state));
    }
  } catch (_) {}
}

function getGoldAmount(api, playerId) {
  try {
    if (typeof api.getCurrencyAmount === "function") {
      const v = api.getCurrencyAmount(playerId, "cstm_smp_gold");
      if (v !== null && v !== undefined) return Number(v) || 0;
    }
  } catch (_) {}
  return 0;
}

function getAuraLevel(api, playerId) {
  try {
    if (typeof api.getAuraInfo === "function") {
      const info = api.getAuraInfo(playerId);
      if (info && Number.isFinite(info.level)) return info.level;
    }
  } catch (_) {}
  return 1;
}

function getOrCreateDailyQuest(api, playerId) {
  const today = todayDateUTC();
  const pidStr = String(playerId);
  let state = loadQuestState(api, playerId);
  if (state && state.date === today) {
    if (!findTemplate(state.questId)) {
      state = null;
    } else {
      return state;
    }
  }
  const template = pickTemplateForToday(pidStr, today);
  const power = powerScore(api, playerId, getAuraLevel.bind(null, api), getGoldAmount.bind(null, api));
  const target = scaledTarget(template.baseTarget, power);
  const fresh = {
    date: today,
    questId: template.id,
    target,
    progress: 0,
    completed: false,
    claimed: false,
    power,
  };
  saveQuestState(api, playerId, fresh);
  return fresh;
}

function templateForState(state) {
  if (!state) return null;
  return findTemplate(state.questId) || null;
}

/** Sidebar — RightInfoText with extensible text format */
function buildSidebarLines(api, playerId, state) {
  const tpl = templateForState(state);
  if (!tpl) {
    return [{ str: "Daily Quest — none\n", style: { color: "#AAAAAA" } }];
  }
  const reward = tpl.reward(state.target);
  const lines = [];
  lines.push({ str: "══ Daily Quest ══\n", style: { color: "#FFD700", fontWeight: "bold" } });
  lines.push({ str: `${tpl.icon || "★"} ${tpl.title}\n`, style: { color: tpl.color || "#FFFFFF", fontWeight: "bold" } });
  const desc = tpl.description(state.target);
  lines.push({ str: desc + "\n", style: { color: "#FFFFFF" } });
  if (state.completed) {
    lines.push({ str: "✔ Completed!\n", style: { color: "#55FF55", fontWeight: "bold" } });
  } else {
    const detail = tpl.detail ? tpl.detail(state.progress, state.target) : `${state.progress}/${state.target}`;
    const pct = state.target > 0 ? Math.min(100, Math.round((state.progress / state.target) * 100)) : 0;
    lines.push({ str: `${detail}  (${pct}%)\n`, style: { color: "#AAAAAA" } });
    const filled = Math.round((state.progress / Math.max(1, state.target)) * 10);
    const bar = "█".repeat(Math.min(10, filled)) + "░".repeat(Math.max(0, 10 - filled));
    lines.push({ str: bar + "\n", style: { color: state.progress > 0 ? "#55FF55" : "#555555" } });
  }
  lines.push({ str: `Reward: ${reward.label}\n`, style: { color: "#FFD700" } });
  if (state.completed && !state.claimed) {
    lines.push({ str: "→ Talk to the NPC to claim!\n", style: { color: "#55FFFF" } });
  } else if (state.claimed) {
    lines.push({ str: "Reward claimed\n", style: { color: "#55FF55" } });
  }
  lines.push({ str: "NPC: [5.5,21,4.5]\n", style: { color: "#777777", fontSize: "12px" } });
  return lines;
}

function refreshSidebar(api, playerId) {
  try {
    const state = getOrCreateDailyQuest(api, playerId);
    const lines = buildSidebarLines(api, playerId, state);
    if (typeof api.setClientOption === "function") {
      api.setClientOption(playerId, "RightInfoText", lines);
    }
  } catch (_) {}
}

function clearSidebar(api, playerId) {
  try {
    if (typeof api.setClientOptionToDefault === "function") {
      api.setClientOptionToDefault(playerId, "RightInfoText");
    } else if (typeof api.setClientOption === "function") {
      api.setClientOption(playerId, "RightInfoText", "");
    }
  } catch (_) {}
}

/** Reward — gold + aura */
function giveReward(api, playerId, state) {
  const tpl = templateForState(state);
  if (!tpl) return;
  const reward = tpl.reward(state.target);
  try {
    if (typeof api.giveCurrencyAmount === "function" && reward.gold) {
      api.giveCurrencyAmount(playerId, "cstm_smp_gold", reward.gold);
    } else if (typeof api.setCurrencyAmount === "function" && reward.gold) {
      const cur = getGoldAmount(api, playerId);
      api.setCurrencyAmount(playerId, "cstm_smp_gold", cur + reward.gold);
    }
  } catch (_) {}
  try {
    if (typeof api.applyAuraChange === "function" && reward.aura) {
      api.applyAuraChange(playerId, reward.aura);
    }
  } catch (_) {}
  try {
    if (typeof api.sendMessage === "function") {
      api.sendMessage(playerId, [
        { str: "✔ Quest completed! ", style: { color: "#55FF55", fontWeight: "bold" } },
        { str: `+${reward.gold} gold`, style: { color: "#FFD700" } },
        { str: ` +${reward.aura} Aura`, style: { color: "#AA00FF" } },
      ]);
    }
    if (typeof api.sendFlyingMiddleMessage === "function") {
      api.sendFlyingMiddleMessage(playerId, [{ str: `+${reward.gold} Gold`, style: { color: "#FFD700" } }], 600, 900);
    }
  } catch (_) {}
}

/** Progression */
function addProgress(api, playerId, type, amount = 1) {
  try {
    const state = getOrCreateDailyQuest(api, playerId);
    if (!state || state.completed) return;
    const tpl = templateForState(state);
    if (!tpl || tpl.type !== type) return;
    state.progress = Math.min(state.target, (state.progress || 0) + amount);
    if (state.progress >= state.target) {
      state.completed = true;
      try {
        if (typeof api.sendFlyingMiddleMessage === "function") {
          api.sendFlyingMiddleMessage(playerId, [{ str: "Quest completed! Talk to the NPC", style: { color: "#55FF55" } }], 400, 600);
        }
      } catch(_) {}
    }
    saveQuestState(api, playerId, state);
    refreshSidebar(api, playerId);
  } catch (_) {}
}

/** NPC spawn & look */
function spawnQuestNPC(api) {
  if (npcId) {
    try {
      if (typeof api.getPosition === "function") {
        const p = api.getPosition(npcId);
        if (p && Array.isArray(p)) return;
      }
      if (typeof api.getMobIds === "function") {
        const ids = api.getMobIds();
        if (Array.isArray(ids) && ids.includes(npcId)) return;
      }
    } catch (_) {}
    npcId = null;
  }
  try {
    if (typeof api.attemptSpawnMob !== "function") return;
    const [x, y, z] = QUEST_NPC_POS;
    const opts = { name: QUEST_NPC_NAME, variation: "default" };
    const id = api.attemptSpawnMob("NPC", x, y, z, opts);
    if (!id) {
      npcSpawnTries++;
      return;
    }
    npcId = id;
    npcSpawnTries = 0;
    try {
      applyNpcTuning(api, id);
    } catch (_) {}
    try {
      scheduleTimeout(() => { try { applyNpcTuning(api, id); } catch (_) {} }, 1);
    } catch(_) { try { applyNpcTuning(api, id); } catch(_){} }
  } catch (_) {}
}

function applyNpcTuning(api, id) {
  if (typeof api.setMobSetting !== "function") return;
  // Keep NPC stationary and non-hostile; do NOT change health (PvE immunity handles protection)
  const settings = [
    ["baseWalkingSpeed", 0],
    ["baseRunningSpeed", 0],
    ["walkingSpeedMultiplier", 0],
    ["runningSpeedMultiplier", 0],
    ["attackDamage", 0],
    ["chaseRadius", 0],
    ["hostilityRadius", 0],
    ["territoryRadius", 0],
    ["stoppingRadius", 0],
    ["attackRadius", 0],
    ["attackInterval", 999999],
  ];
  for (const [k, v] of settings) {
    try { api.setMobSetting(id, k, v); } catch (_) {}
  }
}

function updateNpcLook(api) {
  if (!npcId) return;
  let npcPos = null;
  try {
    if (typeof api.getPosition === "function") npcPos = api.getPosition(npcId);
  } catch (_) {}
  if (!npcPos || !Array.isArray(npcPos)) {
    npcPos = QUEST_NPC_POS;
  }
  let nearest = null;
  let bestDist2 = Infinity;
  try {
    const ids = typeof api.getPlayerIds === "function" ? api.getPlayerIds() : [];
    for (const pid of ids) {
      try {
        const p = api.getPosition(pid);
        if (!p || !Array.isArray(p)) continue;
        const dx = p[0] - npcPos[0];
        const dy = p[1] - npcPos[1];
        const dz = p[2] - npcPos[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestDist2) {
          bestDist2 = d2;
          nearest = p;
        }
      } catch (_) {}
    }
  } catch (_) {}
  if (!nearest) return;
  const dx = nearest[0] - npcPos[0];
  const dz = nearest[2] - npcPos[2];
  let yaw = Math.atan2(dx, dz);
  if (yaw < 0) yaw += Math.PI * 2;
  try {
    if (typeof api.setEntityHeading === "function") {
      api.setEntityHeading(npcId, yaw);
      return;
    }
    if (typeof api.setEntityRotation === "function") {
      api.setEntityRotation(npcId, 0, yaw, 0);
      return;
    }
    if (typeof api.setMobSetting === "function") {
      try { api.setMobSetting(npcId, "heading", yaw); } catch (_) {}
    }
  } catch (_) {}
}

/** Public API */

let npcRetryCounter = 0;
let npcRetryAttempts = 0;
export function initQuestSystem(api) {
  if (initialized) return;
  initialized = true;
  try { spawnQuestNPC(api); } catch (_) {}
}

export function onQuestPlayerJoin(api, playerId) {
  try {
    if (!npcId) spawnQuestNPC(api);
    getOrCreateDailyQuest(api, playerId);
    refreshSidebar(api, playerId);
  } catch (_) {}
}

export function onQuestPlayerLeave(api, playerId) {
  try {
    clearSidebar(api, playerId);
    questCache.delete(String(playerId));
  } catch (_) {}
}

/**
 * Tick — called from worldCode.js tick()
 * - NPC look update every 5s (100 ticks)
 * - Sidebar refresh every 2s
 * - NPC respawn guard if despawned
 */
export function onQuestTick(api) {
  npcLookCounter++;
  if (npcLookCounter >= QUEST_NPC_LOOK_INTERVAL_TICKS) {
    npcLookCounter = 0;
    try { updateNpcLook(api); } catch (_) {}
    try {
      if (!npcId) spawnQuestNPC(api);
      else {
        try {
          if (typeof api.getPosition === "function") {
            const p = api.getPosition(npcId);
            if (p && Array.isArray(p)) {
              const [x, y, z] = QUEST_NPC_POS;
              const dx = p[0] - x, dy = p[1] - y, dz = p[2] - z;
              if (dx*dx+dy*dy+dz*dz > 64) {}
            } else {
              npcId = null;
              spawnQuestNPC(api);
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  if (!npcId) {
    npcRetryCounter++;
    if (npcRetryCounter >= 40) {
      npcRetryCounter = 0;
      npcRetryAttempts++;
      if (npcRetryAttempts <= 15) try { spawnQuestNPC(api); } catch(_) {}
    }
  } else {
    npcRetryCounter = 0;
    npcRetryAttempts = 0;
  }
  sidebarCounter++;
  if (sidebarCounter >= QUEST_SIDEBAR_REFRESH_TICKS) {
    sidebarCounter = 0;
    try {
      const ids = typeof api.getPlayerIds === "function" ? api.getPlayerIds() : [];
      for (const pid of ids) {
        try { refreshSidebar(api, pid); } catch (_) {}
      }
    } catch (_) {}
  }
}

export function onQuestMobKilled(api, playerId) {
  addProgress(api, playerId, "kill", 1);
}

export function onQuestCrateOpened(api, playerId) {
  addProgress(api, playerId, "crate", 1);
}

export function onQuestMobDespawned(api, mobId) {
  if (!mobId || !npcId) return;
  if (String(mobId) === String(npcId)) {
    npcId = null;
    try { spawnQuestNPC(api); } catch (_) {}
  }
}

export function onQuestEntityDeleted(api, entityId) {
  onQuestMobDespawned(api, entityId);
}

export function onQuestInteract(api, playerId, targetId) {
  if (!targetId || !npcId) return false;
  if (String(targetId) !== String(npcId)) return false;
  try {
    const state = getOrCreateDailyQuest(api, playerId);
    if (state.completed && !state.claimed) {
      giveReward(api, playerId, state);
      state.claimed = true;
      saveQuestState(api, playerId, state);
      refreshSidebar(api, playerId);
      return true;
    }
    refreshSidebar(api, playerId);
    if (typeof api.sendMessage === "function") {
      const tpl = templateForState(state);
      if (tpl) {
        api.sendMessage(playerId, [
          { str: `${tpl.icon} ${tpl.title}: `, style: { color: tpl.color || "#FFFFFF", fontWeight: "bold" } },
          { str: tpl.description(state.target), style: { color: "#FFFFFF" } },
          { str: ` — ${state.progress}/${state.target}`, style: { color: state.completed ? "#55FF55" : "#AAAAAA" } },
        ]);
      }
    }
    return true;
  } catch (_) {}
  return false;
}

export function _resetForTests() {
  npcId = null;
  npcSpawnTries = 0;
  npcLookCounter = 0;
  sidebarCounter = 0;
  initialized = false;
  questCache.clear();
}

export function _getNpcId() { return npcId; }
export function _getCache() { return questCache; }
