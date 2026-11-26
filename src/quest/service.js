/**
 * Daily Quests — service
 *
 * - NPC spawns directly at [5.5,21,4.5], never despawns, looks at nearest player every 5s
 * - No default quest: player gets one with a single click on NPC
 * - Crouch + click to draw another quest (reroll)
 * - Sidebar RightInfoText with extensible text format + rewards
 * - Quest scaled to player strength (gold/stats/optional equipment)
 * - Daily storage via PlayerDbValue + gold/aura rewards
 *
 * Integration in worldCode.js:
 *   initQuestSystem(api)              // on load
 *   onQuestPlayerJoin(api, pid)       // onPlayerJoin
 *   onQuestMobKilled(api, pid)        // onPlayerKilledMob
 *   onQuestCrateOpened(api, pid, rarity) // generateChest success (rarity optional)
 *   onQuestTick(api)                  // tick (sidebar refresh + NPC respawn guard + walk/time)
 *   onQuestMobDespawned(mobId)        // onMobDespawned / onEntityDeleted
 *   onQuestPlayerLeave(pid)           // onPlayerLeave (cleanup sidebar)
 *   onQuestInteract(api, pid, targetId) // onPlayerClick / onPlayerDamagingMob
 *   onQuestDamageDealt(api, pid, amount) // onPlayerDamagingMob
 *   onQuestDamageTaken(api, pid, amount) // onMobDamagingPlayer / onPlayerTookDamage
 *   onQuestDungeonEntered(api, pid)  // lobby pad -> dungeon
 *   onQuestRoomDiscovered(api, pid)    // service onRoomDiscovered
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
import { rollQuestPassXp } from "../pass/config.js";
import { addPassXp } from "../pass/service.js";

let npcId = null;
let npcSpawnTries = 0;
let npcLookCounter = 0;
let sidebarCounter = 0;
let initialized = false;

const questCache = new Map();

// Debounce for rapid double events (click + damage same tick)
const NPC_ATTACK_DEBOUNCE_MS = 100;
const confirmMap = new Map();

// Walk & time tracking
const lastPosMap = new Map(); // pid -> [x,y,z]
// LOBBY is [10,21,10]; dungeons are far (20000 separation, Y ~1000+). Check dungeon-only for time_played
const LOBBY_POS = [10, 21, 10];
function isInDungeonForQuest(api, playerId) {
  try {
    const pos = api.getPosition(playerId);
    if (!pos || !Array.isArray(pos) || pos.length<3) return false;
    // Y check: dungeons are at y ~ 1000+, lobby y=21
    if (pos[1] > 100) return true;
    const dx = pos[0]-LOBBY_POS[0], dy = pos[1]-LOBBY_POS[1], dz = pos[2]-LOBBY_POS[2];
    const d2 = dx*dx+dy*dy+dz*dz;
    // far from lobby (>50 blocks) => in dungeon
    if (d2 > 2500) return true;
    return false;
  } catch(_) { return false; }
}

/** Helpers */
function nowMs() {
  try {
    if (typeof api !== "undefined" && typeof api.now === "function") return api.now();
  } catch (_) {}
  try { return Date.now(); } catch (_) { return 0; }
}

function isNpcDebounced(playerId, mobId) {
  const key = String(playerId) + ":" + String(mobId);
  const now = nowMs();
  const last = confirmMap.get(key);
  if (last && now - last < NPC_ATTACK_DEBOUNCE_MS) return true;
  confirmMap.set(key, now);
  return false;
}

function isPlayerCrouching(api, playerId) {
  try { if (typeof api.isPlayerCrouching === "function" && api.isPlayerCrouching(playerId)) return true; } catch(_) {}
  try { if (typeof api.getIsCrouching === "function" && api.getIsCrouching(playerId)) return true; } catch(_) {}
  try { if (typeof api.isCrouching === "function" && api.isCrouching(playerId)) return true; } catch(_) {}
  try { if (typeof api.getPlayerIsCrouching === "function" && api.getPlayerIsCrouching(playerId)) return true; } catch(_) {}
  return false;
}

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
  if (!state) {
    questCache.delete(pidStr);
    try { if (typeof api.setPlayerDbValue === "function") api.setPlayerDbValue(playerId, QUEST_DB_KEY, ""); } catch(_) {}
    return;
  }
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

function templateForState(state) {
  if (!state) return null;
  return findTemplate(state.questId) || null;
}

function createNewQuest(api, playerId, excludeId) {
  const today = todayDateUTC();
  const pidStr = String(playerId);
  let template;
  if (excludeId) {
    const pool = QUEST_TEMPLATES.filter(t => t.id !== excludeId);
    if (pool.length === 0) {
      template = findTemplate(excludeId);
    } else {
      const idx = Math.floor(Math.random() * pool.length);
      template = pool[idx];
    }
  } else {
    template = pickTemplateForToday(pidStr, today);
  }
  if (!template) template = QUEST_TEMPLATES[0];
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

/** Sidebar — empty when no quest or finished */
function buildSidebarLines(api, playerId, state) {
  if (!state || state.completed) {
    return [];
  }
  const tpl = templateForState(state);
  if (!tpl) {
    return [];
  }
  const reward = tpl.reward(state.target);
  const lines = [];
  lines.push({ str: "══ Daily Quest ══\n", style: { color: "#FFD700", fontWeight: "bold" } });
  lines.push({ str: `${tpl.icon || "★"} ${tpl.title}\n`, style: { color: tpl.color || "#FFFFFF", fontWeight: "bold" } });
  lines.push({ str: tpl.description(state.target) + "\n", style: { color: "#FFFFFF" } });
  if (state.completed) {
    lines.push({ str: "Completed!\n", style: { color: "#55FF55", fontWeight: "bold" } });
  } else {
    const detail = tpl.detail ? tpl.detail(state.progress, state.target) : `${state.progress}/${state.target}`;
    const pct = state.target > 0 ? Math.min(100, Math.round((state.progress / state.target) * 100)) : 0;
    lines.push({ str: `${detail} (${pct}%)\n`, style: { color: "#AAAAAA" } });
    const filled = Math.round((state.progress / Math.max(1, state.target)) * 10);
    const bar = "█".repeat(Math.min(10, filled)) + "░".repeat(Math.max(0, 10 - filled));
    lines.push({ str: bar + "\n", style: { color: state.progress > 0 ? "#55FF55" : "#555555" } });
  }
  lines.push({ str: `Reward: ${reward.label}\n`, style: { color: "#FFD700" } });
  return lines;
}

function refreshSidebar(api, playerId) {
  try {
    const state = loadQuestState(api, playerId);
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

/** Reward — minimal chat (1 line) */
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
  // Pass XP — random in [x-100, x+100] where x depends on quest difficulty (template + power scaling)
  try {
    const passXp = rollQuestPassXp(tpl, state.power);
    addPassXp(api, playerId, passXp);
    // show Pass XP gain in chat alongside quest reward
    try {
      if (typeof api.sendMessage === "function") {
        api.sendMessage(playerId, [
          { str: `+${passXp} Pass XP`, style: { color: "#55FFFF", fontWeight: "bold" } },
          { str: ` (Tier progress)`, style: { color: "#AAAAAA" } },
        ]);
      }
    } catch (_) {}
    try {
      if (typeof api.sendFlyingMiddleMessage === "function") {
        api.sendFlyingMiddleMessage(playerId, [{ str: `+${passXp} Pass XP`, style: { color: "#55FFFF" } }], 500, 800);
      }
    } catch (_) {}
  } catch (_) {}
  // Chat line with multiple colors for readability
  try {
    if (typeof api.sendMessage === "function") {
      api.sendMessage(playerId, [
        { str: "Quest done! ", style: { color: "#55FF55", fontWeight: "bold" } },
        { str: `+${reward.gold} gold`, style: { color: "#FFD700", fontWeight: "bold" } },
        { str: " ", style: { color: "#FFFFFF" } },
        { str: `+${reward.aura} Aura`, style: { color: "#AA00FF", fontWeight: "bold" } },
      ]);
    }
    if (typeof api.sendFlyingMiddleMessage === "function") {
      api.sendFlyingMiddleMessage(playerId, [{ str: `+${reward.gold} Gold`, style: { color: "#FFD700" } }], 600, 900);
    }
  } catch (_) {}
}

/** Progression — only if player has a quest */
function addProgress(api, playerId, type, amount = 1, meta) {
  try {
    const state = loadQuestState(api, playerId);
    if (!state || state.completed) return;
    const tpl = templateForState(state);
    if (!tpl || tpl.type !== type) return;
    // rarity filter for crate_rarity
    if (type === "crate_rarity") {
      if (!tpl.rarity || !meta || !meta.rarity) return;
      if (String(tpl.rarity).toLowerCase() !== String(meta.rarity).toLowerCase()) return;
    }
    state.progress = Math.min(state.target, (state.progress || 0) + amount);
    if (state.progress >= state.target) {
      state.completed = true;

      // Minimal completion hint (flying only, not chat flood) — prolonged for visibility (lime)
      try {
        if (typeof api.sendFlyingMiddleMessage === "function") {
          api.sendFlyingMiddleMessage(playerId, [{ str: "Quest complete! Click NPC", style: { color: "#55FF55" } }], 500, 1400);
        }
      } catch(_){}
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

function refreshNpcLabelForPlayer(api, playerId, targetId) {
  const nid = targetId || npcId;
  if (!nid || !playerId) return;
  try {
    if (typeof api.setOtherEntitySetting !== "function") return;
    api.setOtherEntitySetting(playerId, nid, "multilineTextBox", { content: [
        {str:"Click:", style:{color:"lightgray"}},
        {str:" Get / Claim Quest", style:{color:"white"}},
        {str:"\nCrouch + Click:", style:{color:"lightgray"}},
        {str:" Change of Quest", style:{color:"white"}},
    ]});
  } catch(_) {}
}

function refreshNpcLabelForAll(api) {
  if (!npcId) return;
  try {
    const ids = typeof api.getPlayerIds === "function" ? api.getPlayerIds() : [];
    for (const pid of ids) refreshNpcLabelForPlayer(api, pid, npcId);
  } catch(_) {}
}

function applyNpcTuning(api, id) {
  if (typeof api.setMobSetting !== "function") return;
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
  // Also apply the explanatory multilineTextBox next to the NPC (custom styling)
  try { refreshNpcLabelForAll(api); } catch(_){}
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

/** Walk tracking — called each tick for each player */
function tickWalkAndTime(api) {
  try {
    const ids = typeof api.getPlayerIds === "function" ? api.getPlayerIds() : [];
    for (const pid of ids) {
      // WALK: compute distance since last tick
      try {
        const pos = api.getPosition(pid);
        if (pos && Array.isArray(pos) && pos.length>=3) {
          const last = lastPosMap.get(String(pid));
          if (last && Array.isArray(last)) {
            const dx = pos[0]-last[0], dy = pos[1]-last[1], dz = pos[2]-last[2];
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            // ignore teleports > 20 blocks (dungeon enter etc.) and tiny jitter <0.1
            if (dist >= 0.2 && dist <= 20) {
              // add floored blocks walked
              const blocks = Math.floor(dist);
              if (blocks>0) addProgress(api, pid, "walk", blocks);
              else if (dist >= 0.5) addProgress(api, pid, "walk", 1);
            }
          }
          lastPosMap.set(String(pid), [pos[0], pos[1], pos[2]]);
        }
      } catch(_){}
      // TIME_PLAYED: only in dungeon (halved to 5 min, dungeon-only)
      try {
        const state = loadQuestState(api, pid);
        if (state && !state.completed) {
          const tpl = templateForState(state);
          if (tpl && tpl.type === "time_played") {
            if (isInDungeonForQuest(api, pid)) {
              addProgress(api, pid, "time_played", 1);
            }
          }
        }
      } catch(_){}
    }
  } catch(_){}
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
    refreshSidebar(api, playerId);
    // Show explanatory label next to NPC for this player
    try { refreshNpcLabelForPlayer(api, playerId, npcId); } catch(_){}
    // init walk pos
    try {
      const p = api.getPosition(playerId);
      if (p && Array.isArray(p)) lastPosMap.set(String(playerId), [p[0],p[1],p[2]]);
    } catch(_){}
  } catch (_) {}
}

export function onQuestPlayerLeave(api, playerId) {
  try {
    clearSidebar(api, playerId);
    questCache.delete(String(playerId));
    lastPosMap.delete(String(playerId));
  } catch (_) {}
}

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
  // walk & time tracking
  try { tickWalkAndTime(api); } catch(_){}
}

export function onQuestMobKilled(api, playerId) {
  addProgress(api, playerId, "kill", 1);
}

export function onQuestCrateOpened(api, playerId, rarity) {
  // generic crate quests (any rarity)
  addProgress(api, playerId, "crate", 1);
  // rarity-specific
  if (rarity) addProgress(api, playerId, "crate_rarity", 1, { rarity });
}

export function onQuestDamageDealt(api, playerId, amount) {
  if (!Number.isFinite(amount) || amount<=0) return;
  addProgress(api, playerId, "damage_dealt", Math.max(1, Math.round(amount)));
}

export function onQuestDamageTaken(api, playerId, amount) {
  if (!Number.isFinite(amount) || amount<=0) return;
  addProgress(api, playerId, "damage_taken", Math.max(1, Math.round(amount)));
}

export function onQuestDungeonEntered(api, playerId) {
  addProgress(api, playerId, "dungeon_enter", 1);
}

export function onQuestRoomDiscovered(api, playerId) {
  addProgress(api, playerId, "room_discover", 1);
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

// Single-click to take (if no quest), crouch+click to reroll, click to claim (with 1s removal)
export function onQuestInteract(api, playerId, targetId) {
  if (!targetId || !npcId) return false;
  if (String(targetId) !== String(npcId)) return false;
  if (isNpcDebounced(playerId, targetId)) return true;
  const crouching = isPlayerCrouching(api, playerId);
  const state = loadQuestState(api, playerId);


  // No quest -> single click gives one immediately (multi-color for readability)
  if (!state) {
    const fresh = createNewQuest(api, playerId);

    const tpl = templateForState(fresh);
    try {
      api.sendMessage(playerId, [
        { str: "Quest: ", style: { color: "#FFD700", fontWeight: "bold" } },
        { str: `${tpl.icon} ${tpl.title}`, style: { color: tpl.color, fontWeight: "bold" } },
        { str: ` - ${tpl.description(fresh.target)}`, style: { color: "#FFFFFF" } },
      ]);
    } catch(_) {}
    refreshSidebar(api, playerId);
    return true;
  }

  // Has quest — crouch+click to reroll (even if completed, reroll takes priority) — keep ↻ emoji
  if (crouching) {
    const fresh = createNewQuest(api, playerId, state.questId);

    const tpl = templateForState(fresh);
    try {
      api.sendMessage(playerId, [
        { str: "↻ ", style: { color: "#55FFFF", fontWeight: "bold" } },
        { str: "New quest: ", style: { color: "#FFD700", fontWeight: "bold" } },
        { str: `${tpl.icon} ${tpl.title}`, style: { color: tpl.color, fontWeight: "bold" } },
        { str: ` - ${tpl.description(fresh.target)}`, style: { color: "#FFFFFF" } },
      ]);
    } catch(_) {}
    refreshSidebar(api, playerId);
    return true;
  }

  // Has quest, completed -> click to claim, then remove from sidebar 1s after
  if (state.completed && !state.claimed) {
    giveReward(api, playerId, state);

    state.claimed = true;
    saveQuestState(api, playerId, state);
    refreshSidebar(api, playerId);
    // Remove from sidebar 1s later (20 ticks)
    try {
      scheduleTimeout(() => {
        try {
          saveQuestState(api, playerId, null);
          refreshSidebar(api, playerId);
        } catch(_) {}
      }, 20);
    } catch(_) {
      // fallback if scheduler unavailable: clear immediately
      try { saveQuestState(api, playerId, null); } catch(_) {}
    }
    return true;
  }

  // Has quest already — simple feedback (multi-color, not single-color)
  try {
    api.sendMessage(playerId, [
      { str: "⌬ A ", style: { color: "#CCCCCC" } },
      { str: "quest", style: { color: "#FFD700", fontWeight: "bold" } },
      { str: " is already ", style: { color: "#CCCCCC" } },
      { str: "active", style: { color: "#55FF55", fontWeight: "bold" } },
    ]);
  } catch(_) {}
  return true;
}

export function onQuestClickNear(api, playerId, x, y, z) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  if (!npcId) return false;
  const dx = x - QUEST_NPC_POS[0], dy = y - QUEST_NPC_POS[1], dz = z - QUEST_NPC_POS[2];
  if (dx*dx+dy*dy+dz*dz > 9) return false;
  return onQuestInteract(api, playerId, npcId);
}

export function needsQuestArrow(api, playerId) {
  try {
    const state = loadQuestState(api, playerId);
    if (!state) return true; // no quest → go get one
    if (state.completed && !state.claimed) return true; // finished → go claim
    return false;
  } catch(_) { return false; }
}

export function _resetForTests() {
  npcId = null;
  npcSpawnTries = 0;
  npcLookCounter = 0;
  sidebarCounter = 0;
  initialized = false;
  questCache.clear();
  confirmMap.clear();
  lastPosMap.clear();
}

export function _getNpcId() { return npcId; }
export function _getCache() { return questCache; }
export function _getLastPos() { return lastPosMap; }
