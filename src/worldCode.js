/*
 * Dungeon Break — lobby, pads and dungeon entry.
 *
 * The world code is deliberately thin. It owns three things and nothing else:
 *
 *   - the lobby countdown, which is unchanged from the previous version because
 *     it worked: step on a pad, wait ten seconds, step off to cancel;
 *   - the pads, both in the lobby and inside a dungeon, which all go through the
 *     same block-to-difficulty table;
 *   - the **Utilities** shop category, which holds the only way back to spawn now
 *     that the game's own spawn is off, and which ends the dungeon as it teleports;
 *   - the `/dbg` commands, which are how a bug gets reported with numbers.
 *
 * Everything about rooms lives in `src/dungeon/`: one chunk copied per tick, no
 * generated geometry, no block-by-block construction. Player-facing messages are
 * in English, like the rest of the game.
 */

import {
  setInterval as scheduleInterval,
  setTimeout as scheduleTimeout,
  step as stepScheduler,
} from "./utils/scheduler.js";
import { DIFFICULTIES, DUNGEON_CONFIG, DUNGEON_VARIATION, difficultyForPadBlock, priceForDifficulty, formatGold, UNLOCK_CURRENCY, UNLOCK_DB_KEY, DUNGEON_PRICES } from "./dungeon/config.js";
import { LOBBY_POSITION, createDungeonService } from "./dungeon/service.js";
import { isChestBlock } from "./dungeon/loot.js";
import { AURA_PER_LEVEL, MAX_AURA_LEVEL, categoryOf } from "./blessing/config.js";
import { createBlessingService } from "./blessing/service.js";
import * as effects from "./blessing/effects.js";
import {
  announcementOf,
  cardFor,
  choiceTile,
  offerLine,
  oddsOfTable,
  rollMessage,
} from "./blessing/presentation.js";
import { CRATE_KEYS, AIR_CHANCE, LOOT_TABLE } from "./crate/config.js";
import {
  getWeightedRandomItem as crateGetWeightedRandomItem,
  hasKey as crateHasKey,
  consumeKey as crateConsumeKey,
  generateChest as crateGenerateChest,
  isChestOwnedByOther as crateIsOwnedByOther,
  tickCrateLocks as crateTick,
  tickChestClearQueue as crateTickClear,
  clearChestInventory as crateClearChest,
  clearChestInventoryChunked as crateClearChunked,
} from "./crate/service.js";
import { RANKS, NONE_RANK_ID, getRank } from "./ranks/config.js";
import { createRanksService, NONE_ID } from "./ranks/service.js";
import { DIFFICULTY_COLOR, CRATE_COLOR, PRESETS } from "./particles/config.js";
import { spawn as spawnParticles } from "./particles/service.js";
import { CRAFTS, ARMOR_SETS, WEAPON_SETS, SHARD_TO_MATERIAL } from "./crafting/config.js";
import { registerCraftingRecipes } from "./crafting/service.js";
import { applyItemStats } from "./crafting/itemStats.js";
import { tickCombatFx, onWeaponHit, onArmorHit, tickArmorShimmer, forgetPlayer as forgetCombatFx } from "./combatFx/service.js";
import { refreshWeaponStats, tickWeapons, onMobKilled, forgetPlayer as forgetWeaponAbility } from "./weapons/service.js";
import { parseWeaponInfo } from "./combatFx/service.js";
const OWNER_NAME = "K4miNoK4mi";
function getOwnerId() {
  try {
    if (typeof api.getPlayerId === "function") {
      const id = api.getPlayerId(OWNER_NAME);
      if (id) return id;
    }
  } catch(_) {}
  try {
    if (typeof api.getPlayerIds === "function") {
      const ids = api.getPlayerIds();
      for (const id of ids) {
        if (String(id) === OWNER_NAME) return id;
        if (typeof api.getEntityName === "function") {
          const n = api.getEntityName(id);
          if (n === OWNER_NAME) return id;
        }
      }
    }
  } catch(_) {}
  return null;
}
function reportErrorToOwner(e) {
  try {
    const ownerId = getOwnerId();
    if (!ownerId) return;
    const msg = e && e.message ? e.message : String(e);
    api.sendMessage(ownerId, `[Error] ${msg}`);
  } catch(_) {}
}

// expose presets for service helpers (avoid circular)
globalThis.__PARTICLE_PRESETS = { PRESETS };

function safeSendMessage(playerId, message) {
  // Central helper so silent try/catch can be removed — errors surface via throw
  return api.sendMessage(playerId, message);
}

const LOBBY_CONFIG = {
  countdownSeconds: 10,
  ticksPerSecond: 20,
  // Bloxd starts the new block callback before stopping the old one, so a player
  // crossing two pads of the same colour would otherwise restart the countdown.
  padSwitchGraceTicks: 2,
};

// Gold unlock for dungeons (cstm_smp_gold via Market Place plugin)
function getGoldAmount(playerId) {
  try {
    if (typeof api.getCurrencyAmount === "function") {
      const v = api.getCurrencyAmount(playerId, UNLOCK_CURRENCY);
      if (v === null || v === undefined) return 0;
      return Number(v) || 0;
    }
  } catch(e) { reportErrorToOwner(e); }
  return null; // no currency system -> treat as free (for tests)
}
function spendGold(playerId, amount) {
  if (amount <= 0) return true;
  try {
    if (typeof api.giveCurrencyAmount === "function") {
      api.giveCurrencyAmount(playerId, UNLOCK_CURRENCY, -amount);
      return true;
    }
    if (typeof api.setCurrencyAmount === "function") {
      const current = getGoldAmount(playerId);
      if (current !== null) {
        api.setCurrencyAmount(playerId, UNLOCK_CURRENCY, Math.max(0, current - amount));
        return true;
      }
    }
  } catch(e) { reportErrorToOwner(e); }
  return false;
}
function loadUnlocks(playerId) {
  try {
    const raw = api.getPlayerDbValue(playerId, UNLOCK_DB_KEY);
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    if (typeof raw === "string") {
      try { const j = JSON.parse(raw); return j && typeof j === "object" ? j : {}; } catch (_) { return {}; }
    }
  } catch(e) { reportErrorToOwner(e); }
  return {};
}
function saveUnlocks(playerId, data) {
  try {
    const str = JSON.stringify(data);
    api.setPlayerDbValue(playerId, UNLOCK_DB_KEY, str);
  } catch(e) { reportErrorToOwner(e); }
}
function isUnlocked(playerId, difficulty) {
  const d = difficulty && difficulty.id ? difficulty : null;
  if (!d) return false;
  const price = priceForDifficulty(d);
  if (price <= 0) return true;
  const unlocks = loadUnlocks(playerId);
  if (unlocks[d.id]) return true;
  return false;
}
const MSG_COLORS = { gold:"#ffd700", green:"#55ff55", red:"#ff5555", gray:"#aaaaaa", white:"#ffffff", aqua:"#55ffff" };
function cStr(text, color) { return { str: text, style:{color} }; }

function ensureUnlockedOrPay(playerId, difficulty) {
  const d = typeof difficulty === "object" && difficulty.id ? difficulty : null;
  if (!d) return false;
  const price = priceForDifficulty(d);
  if (price <= 0) return true;
  const unlocks = loadUnlocks(playerId);
  if (unlocks[d.id]) return true;
  const gold = getGoldAmount(playerId);
  if (gold === null) return true; // no currency system, allow (tests)
  if (Number.isFinite(gold) && gold >= price) {
    if (spendGold(playerId, price)) {
      unlocks[d.id] = true;
      saveUnlocks(playerId, unlocks);
      api.sendMessage(playerId, [cStr("Unlocked ", MSG_COLORS.green), cStr(d.label, DIFFICULTY_COLOR[d.id]||MSG_COLORS.gold)])
      return true;
    }
    // if spend failed but had enough, still allow and mark unlocked
    unlocks[d.id] = true;
    saveUnlocks(playerId, unlocks);
    return true;
  }
  api.sendMessage(playerId, [cStr("Need ", MSG_COLORS.red), cStr(formatGold(price), MSG_COLORS.gold), cStr(` for ${d.label}`, MSG_COLORS.red)]);
  return false;
}

// Spawn handling: peaceful adventure + blessing reset while in spawn
const SPAWN_GAMEMODE = "PeacefulAdventure";
const DUNGEON_GAMEMODE = "SurvivalAdventure";
const SPAWN_CENTER = LOBBY_POSITION;
const SPAWN_RADIUS = 80;
const spawnMode = new Map(); // playerId -> boolean true=spawn

function isInSpawnPosition(playerId) {
  try {
    const pos = api.getPosition(playerId);
    if (!pos || !Array.isArray(pos) || pos.length < 3) return false;
    const dx = pos[0] - SPAWN_CENTER[0];
    const dy = pos[1] - SPAWN_CENTER[1];
    const dz = pos[2] - SPAWN_CENTER[2];
    return Math.sqrt(dx*dx+dy*dy+dz*dz) <= SPAWN_RADIUS;
  } catch (_) { return false; }
}
function shouldBeInSpawn(playerId) {
  // In spawn if not in dungeon OR near lobby (fallback for edge)
  try { if (!service().inDungeon(playerId)) return true; } catch(e) { reportErrorToOwner(e); }
  return isInSpawnPosition(playerId);
}
function syncPlayerSpawnState(playerId) {
  const shouldSpawn = shouldBeInSpawn(playerId);
  const wasSpawn = spawnMode.get(String(playerId));
  if (wasSpawn === shouldSpawn) return;
  spawnMode.set(String(playerId), shouldSpawn);
  if (shouldSpawn) {
    try { if (typeof api.setPlayerGamemode === "function") api.setPlayerGamemode(playerId, SPAWN_GAMEMODE); } catch(e) { reportErrorToOwner(e); }
    // Spawn: only permanent blessings (run/timed disabled) for clean navigation
    try { applyBlessingOptions(playerId, baseClientOptions()); } catch(e) { reportErrorToOwner(e); }
    // Remove run/timed potion effects (keep permanent none)
    try {
      const k = accountKeyOf(playerId);
      for (const e of effects.runEffects(blessings().runOf(k))) try { api.removeEffect(playerId, e.effectName); } catch(e) { reportErrorToOwner(e); }
      for (const ent of blessings().timedOf(k)) {
        const ef = effects.timedEffectOf(ent.blessing);
        if (ef) try { api.removeEffect(playerId, ef.effectName); } catch(e) { reportErrorToOwner(e); }
      }
      const tracked = sessionPotionEffects.get(String(playerId));
      if (tracked) {
        // Keep tracking but remove effects already handled above; don't delete set
      }
    } catch(e) { reportErrorToOwner(e); }
  } else {
    try { if (typeof api.setPlayerGamemode === "function") api.setPlayerGamemode(playerId, DUNGEON_GAMEMODE); } catch(e) { reportErrorToOwner(e); }
    applyBlessingOptions(playerId, baseClientOptions());
    const k = accountKeyOf(playerId);
    for (const ef of effects.runEffects(blessings().runOf(k))) applyRunEffect(playerId, ef);
    for (const ent of blessings().timedOf(k)) {
      const ef = effects.timedEffectOf(ent.blessing);
      if (!ef) continue;
      const remainingTicks = ent.endsAtTick - tickNow();
      if (remainingTicks <= 0) continue;
      const remainingMs = remainingTicks * 50;
      try {
        const shouldTrack = !hadEffectBefore(playerId, ef.effectName);
        api.applyEffect(playerId, ef.effectName, remainingMs, { inbuiltLevel: ef.level });
        if (shouldTrack) rememberSessionEffect(playerId, ef.effectName);
      } catch(e) { reportErrorToOwner(e); }
    }
  }
}
function tickSpawnCheck() {
  const ids = [...spawnMode.keys()];
  for (const pid of ids) {
    try { syncPlayerSpawnState(pid); } catch(e) { reportErrorToOwner(e); }
  }
  // Periodic enforcement for spawn: keep permanent-only options and peacefulAdventure
  for (const pid of ids) {
    if (spawnMode.get(String(pid)) === true) {
      try {
        if (typeof api.getPlayerGamemode === "function") {
          const gm = api.getPlayerGamemode(pid);
          if (gm !== SPAWN_GAMEMODE && gm !== "PeacefulAdventure" && gm !== 4 && gm !== "pa") {
            api.setPlayerGamemode(pid, SPAWN_GAMEMODE);
          }
        }
      } catch(e) { reportErrorToOwner(e); }
      // Re-apply permanent-only to reset any manual speed changes in spawn
      try { applyBlessingOptions(pid, baseClientOptions()); } catch(e) { reportErrorToOwner(e); }
    }
  }
}

// One service for the whole world: two players in the same level see the same
// rooms, because there is one level, not one per player.
let dungeonService = null;

function service() {
  if (!dungeonService) {
    dungeonService = createDungeonService({
      api,
      log: (message) => {
        try {
          api.log(`[Dungeon] ${message}`);
        } catch (_) {
          // A logging failure must never break a build.
        }
      },
      onRoomDiscovered: (playerId, chunkX, chunkZ, difficulty) => {
        try {
          const newly = ranks().recordRoom(playerId);
          if (newly && newly.length) handleRankUnlocks(playerId, newly);
        } catch(e) { reportErrorToOwner(e); }
        // particules room clear: anneau + burst
        try {
          const col = difficulty ? (DIFFICULTY_COLOR[difficulty.id] || "#FFD700") : "#FFD700";
          const cx = chunkX * 32 + 16;
          const cz = chunkZ * 32 + 16;
          // y from player pos or difficulty floor
          let y = 0;
          try { const p = api.getPosition(playerId); if(p) y = p[1]; } catch(e) { reportErrorToOwner(e); }
          spawnParticles(api, [cx, y+0.5, cz], PRESETS.roomClear(col), { radius: 1.2, height: 1.2 });
        } catch(e) { reportErrorToOwner(e); }
      },
    });
  }
  return dungeonService;
}

// -------------------------------------------------------------- the lobby --

const lobbyCountdowns = {};

function padKey(x, y, z) {
  return `${x},${y},${z}`;
}

function showCountdown(playerId, difficulty, secondsLeft) {
  api.setClientOption(playerId, "middleTextUpper", [
    { str: { translationKey: "greenvilleGame:spleefGameStartCounter", params: { seconds: `${secondsLeft}s` } }, style: { color: "#ffd700" } },
  ]);
}

function stopLobbyCountdown(playerId) {
  const countdown = lobbyCountdowns[playerId];
  if (!countdown) return false;
  countdown.timer.stop();
  if (countdown.cancelTimer) countdown.cancelTimer.stop();
  delete lobbyCountdowns[playerId];
  api.setClientOption(playerId, "middleTextUpper", "");
  return true;
}

function cancelLobbyCountdown(playerId) {
  const countdown = lobbyCountdowns[playerId];
  if (countdown && countdown.completed) return;
  if (stopLobbyCountdown(playerId)) {
    api.sendMessage(playerId, [cStr("Countdown cancelled", MSG_COLORS.gray)])
  }
}

/**
 * Variation — only on entry.
 * In custom game switch from "default" (lobby) to `DUNGEON_VARIATION`.
 * In world API does not exist → silent fail.
 */
function switchToDungeonVariation(playerId) {
  try {
    if (typeof api.getVariation !== "function" || typeof api.matchmakeToVariation !== "function") return;
    const current = api.getVariation();
    if (current !== "default") return;
    api.matchmakeToVariation(playerId, DUNGEON_VARIATION);
  } catch(e) { reportErrorToOwner(e); }
}

function completeLobbyCountdown(playerId, countdown) {
  if (lobbyCountdowns[playerId] !== countdown) return;
  countdown.completed = true;
  stopLobbyCountdown(playerId);
  // vortex at pad before teleport
  try {
    const col = DIFFICULTY_COLOR[countdown.difficulty.id] || "#FFD700";
    const pad = Object.keys(countdown.activePads)[0];
    if (pad) {
      const [px,py,pz] = pad.split(",").map(Number);
      spawnParticles(api, [px+0.5, py+1, pz+0.5], PRESETS.entryVortex(col), { radius: 0.6, height: 3.5 });
    }
  } catch(e) { reportErrorToOwner(e); }
  const entered = service().enterDifficulty(playerId, countdown.difficulty, (diff, landing)=>{
    // vortex at landing
    try {
      const col = DIFFICULTY_COLOR[diff.id] || "#FFD700";
      spawnParticles(api, landing, PRESETS.entryVortex(col), { radius: 0.6, height: 3.5 });
    } catch(e) { reportErrorToOwner(e); }
  });
  if (entered) {
    try { spawnMode.set(String(playerId), false); } catch(e) { reportErrorToOwner(e); }
    try { if (typeof api.setPlayerGamemode === "function") api.setPlayerGamemode(playerId, DUNGEON_GAMEMODE); } catch(e) { reportErrorToOwner(e); }
    try { applyBlessingOptions(playerId, baseClientOptions()); } catch(e) { reportErrorToOwner(e); }
    // re-apply run potion effects for dungeon
    try {
      const k = accountKeyOf(playerId);
      for (const ef of effects.runEffects(blessings().runOf(k))) applyRunEffect(playerId, ef);
    } catch(e) { reportErrorToOwner(e); }
  }
}

function deferLobbyCountdownCancellation(playerId, countdown) {
  if (countdown.cancelTimer) return;
  countdown.cancelTimer = scheduleTimeout(() => {
    countdown.cancelTimer = null;
    if (lobbyCountdowns[playerId] !== countdown || countdown.activePadCount !== 0) return;
    // A stale stop callback in the final tick must not cancel a selection the
    // countdown is about to complete.
    if (countdown.secondsLeft <= 1) {
      completeLobbyCountdown(playerId, countdown);
      return;
    }
    cancelLobbyCountdown(playerId);
  }, LOBBY_CONFIG.padSwitchGraceTicks);
}

function startLobbyCountdown(playerId, x, y, z, difficulty) {
  if (!ensureUnlockedOrPay(playerId, difficulty)) return;
  // particles: anneau au pad
  try {
    const col = DIFFICULTY_COLOR[difficulty.id] || "#FFD700";
    spawnParticles(api, [x+0.5, y+0.5, z+0.5], PRESETS.padRing(col), { radius: 0.9, height: 0.1 });
  } catch(e) { reportErrorToOwner(e); }
  const key = padKey(x, y, z);
  const current = lobbyCountdowns[playerId];

  if (current && current.difficulty.id === difficulty.id) {
    if (current.cancelTimer) {
      current.cancelTimer.stop();
      current.cancelTimer = null;
    }
    if (!current.activePads[key]) {
      current.activePads[key] = true;
      current.activePadCount += 1;
    }
    return;
  }
  if (current) stopLobbyCountdown(playerId);

  const countdown = {
    difficulty,
    activePads: { [key]: true },
    activePadCount: 1,
    secondsLeft: LOBBY_CONFIG.countdownSeconds,
    completed: false,
    timer: null,
    cancelTimer: null,
  };
  lobbyCountdowns[playerId] = countdown;

  api.sendMessage(playerId, [cStr(difficulty.label, DIFFICULTY_COLOR[difficulty.id]||MSG_COLORS.gold), cStr(` · ${LOBBY_CONFIG.countdownSeconds}s`, MSG_COLORS.white)]);
  showCountdown(playerId, difficulty, countdown.secondsLeft);

  countdown.timer = scheduleInterval(() => {
    if (lobbyCountdowns[playerId] !== countdown) {
      countdown.timer.stop();
      return;
    }
    // tick particules
    try {
      const col = DIFFICULTY_COLOR[difficulty.id] || "#FFD700";
      spawnParticles(api, [x+0.5, y+0.5, z+0.5], PRESETS.padTick(col), { radius: 0.5, height: 0.8 });
    } catch(e) { reportErrorToOwner(e); }
    countdown.secondsLeft -= 1;
    if (countdown.secondsLeft <= 0) {
      completeLobbyCountdown(playerId, countdown);
      return;
    }
    showCountdown(playerId, difficulty, countdown.secondsLeft);
  }, LOBBY_CONFIG.ticksPerSecond);
}

// ------------------------------------------------------------------ pads --
//
// One handler for every pad, in the lobby and in a dungeon: the block names the
// difficulty, and where the player is decides what happens. Fewer paths means
// fewer places for a pad to work in one room and not in the next.

function onPadStart(playerId, x, y, z, difficulty) {
  if (!difficulty) return;
  if (service().inDungeon(playerId)) {
    const progressed = service().usePad(playerId);
    if (progressed) {
      try { spawnMode.set(String(playerId), false); } catch(e) { reportErrorToOwner(e); }
      try { if (typeof api.setPlayerGamemode === "function") api.setPlayerGamemode(playerId, DUNGEON_GAMEMODE); } catch(e) { reportErrorToOwner(e); }
      try { applyBlessingOptions(playerId, baseClientOptions()); } catch(e) { reportErrorToOwner(e); }
    }
    return;
  }
  startLobbyCountdown(playerId, x, y, z, difficulty);
}

function onPadStop(playerId, x, y, z, difficulty) {
  if (!difficulty) return;
  if (service().inDungeon(playerId)) return;
  const countdown = lobbyCountdowns[playerId];
  if (!countdown || countdown.difficulty.id !== difficulty.id) return;
  const key = padKey(x, y, z);
  if (!countdown.activePads[key]) return;
  delete countdown.activePads[key];
  countdown.activePadCount -= 1;
  if (countdown.activePadCount === 0) deferLobbyCountdownCancellation(playerId, countdown);
}

onBlockStandStart = (playerId, x, y, z, blockName) => {
  onPadStart(playerId, x, y, z, difficultyForPadBlock(blockName));
};

onBlockStandStop = (playerId, x, y, z, blockName) => {
  onPadStop(playerId, x, y, z, difficultyForPadBlock(blockName));
};

// ------------------------------------------------------------------ debug --
//
// A bug report is a screenshot plus numbers. These commands are the numbers.
// They read state and write nothing, and `/dbg templates` is the one that
// answers the only question a broken room raises: "can the server read the chunk
// you pointed me at".

const DEBUG_COMMANDS = {
  info: ["debug", "dbg", "info", "here", "where"],
  templates: ["templates", "template", "rooms", "src"],
  mem: ["mem", "memory", "leak"],
  seed: ["seed", "seedonly"],
  level: ["level", "dungeon", "dgn"],
  chests: ["chests", "chest", "loot", "keys"],
  blessings: ["blessings", "blessing", "rolls"],
  crafts: ["crafts", "craft", "recipes", "recipe"],
  shards: ["shards", "shard", "materials", "mats"],
  vider: ["vider", "empty", "clear", "vidercoffre", "emptychest", "clearchest"],
};

function debugSay(playerId, message) {
  try {
    api.sendMessage(playerId, message);
  } catch (_) {
    // A debug command must never break the tick that carries it.
  }
}

function debugSayAll(playerId, lines) {
  for (let index = 0; index < lines.length; index += 1) debugSay(playerId, lines[index]);
}

function runDebugCommand(playerId, verb) {
  if (verb === "templates") {
    const rows = service().templatesReport();
    if (rows.length === 0) {
      debugSay(playerId, "[dbg] no level has been loaded yet — step on a pad first");
      return;
    }
    for (const row of rows) {
      const state = row.disabled ? "DISABLED" : row.loaded ? "loaded" : "NOT LOADED";
      debugSay(
        playerId,
        `[dbg] ${row.difficulty} · #${row.index} chunk ${row.chunk.join(",")}`
          + ` → block ${row.src.join(",")} · ${state}`,
      );
    }
    return;
  }
  if (verb === "mem") {
    const rows = service().memoryReport();
    if (rows.length === 0) {
      debugSay(playerId, "[dbg] no level has been loaded yet — step on a pad first");
      return;
    }
    for (const row of rows) {
      debugSay(
        playerId,
        `[dbg] ${row.difficulty} · layer ${row.chunkY === null ? "none" : row.chunkY} · room origin`
          + ` ${row.origin ? row.origin.x + "," + row.origin.y + "," + row.origin.z : "none"}`
          + ` · templates ${row.templates} (off ${row.disabled})`,
      );
      debugSay(
        playerId,
        `[dbg]   queued ${row.queued} · planned ${row.planned} · rooms ${row.placedInView}`
          + ` (${row.inFlight} in flight) · placed ${row.placed} · loading ${row.loading}`
          + ` · failed ${row.failures}`,
      );
    }
    return;
  }
  if (verb === "blessings") {
    // The whole mechanic, in the order a player lives it: the level, the points, then the
    // three lifetimes — what is permanent (and saved), what this run holds, what is still
    // counting down. It works outside a dungeon on purpose: a level is gained anywhere.
    const level = auraLevelOf(playerId);
    const key = accountKeyOf(playerId);
    const account = blessings().accountOf(key);
    const points = blessings().pointsFor(key, level);
    const offer = account.offer.length > 0 ? ` · ${account.offer.length} on offer` : "";
    const permanent = blessings().permanentOf(key);
    const run = blessings().runOf(key);
    const timed = blessings().timedOf(key);
    debugSay(playerId, `[dbg] aura level ${level}/${MAX_AURA_LEVEL} · ${points} point(s) · ${account.spent} spent${offer}`);
    debugSay(playerId, `[dbg] permanent (saved): ${effects.debugPermanent(permanent) || "none"} · ${effects.permanentSummary(permanent)}`);
    debugSay(playerId, `[dbg] this run: ${run.length > 0 ? run.map((entry) => entry.id).join(", ") : "none"}`
      + ` · timed: ${timed.length > 0 ? timed.map((entry) => `${entry.blessing.id} (${entry.endsAtTick - tickNow()} ticks)`).join(", ") : "none"}`);
    debugSay(playerId, `[dbg] session ${key} · last ${account.history.length} picked:`
      + (account.history.length > 0 ? ` ${account.history.map((entry) => `${entry.name} (${entry.rarity})`).join(", ")}` : " none"));
    debugSay(playerId, `[dbg] odds ${oddsOfTable()}`);
    return;
  }
  if (verb === "crafts") {
    debugSay(playerId, `[dbg] crafts: ${CRAFTS.length} recipes registered (shards -> materials -> armors + 72 weapons)`);
    for (const set of ARMOR_SETS) {
      debugSay(playerId, `[dbg] ${set.label} — mat: ${set.material} from ${set.shard} (tier ${set.tier})`);
    }
    for (const set of WEAPON_SETS) {
      debugSay(playerId, `[dbg] ${set.label} weapons (${set.weapons} types): Sword/Dagger/Spear/Club/Mace/Whip/Bow/Crossbow/${set.label === "Sanguine" || set.label === "Spectral" || set.label === "Geo" || set.label === "Astral" ? "Staff" : "Boomerang"} — mat ${set.material} (tier ${set.tier})`);
    }
    debugSay(playerId, `[dbg] Workbench: Amethite/Magmasteel/Rubellite/Serpentite (4 frag -> 1 ingot) + armor + weapons`);
    debugSay(playerId, `[dbg] Artisan Bench: Cursemetal/Kingly/Sanguine/Spectral/Geo/Astral/Voltplate + weapons`);
    debugSay(playerId, `[dbg] Example: 4 Amethite Fragment -> 1 Amethite | 2 Amethite+1 Stick -> Amethite Sword (dmg auto-scaled + elemental ability) | 5 Amethite+2 Iron Bar -> Amethite Helmet`);
    debugSay(playerId, `[dbg] Weapons: damage auto-updated (base x dealingMultiplier) + elemental abilities per set (Amethite burst, Magmasteel burn, Sanguine lifesteal...)`);
    return;
  }
  if (verb === "shards") {
    debugSay(playerId, `[dbg] shards in Crates -> materials -> armors`);
    for (const [shard, mat] of Object.entries(SHARD_TO_MATERIAL)) {
      debugSay(playerId, `[dbg] ${shard} -> ${mat}`);
    }
    debugSay(playerId, `[dbg] Common crates: Amethite/Magmasteel/Rubellite | Uncommon: +Serpentite/Sanguine/Spectral`);
    debugSay(playerId, `[dbg] Rare: +Geo/Voltite | Epic: +Astral/Comet/Raw Voltite | Legendary: Astral/Geo/Sanguine/Spectral`);
    debugSay(playerId, `[dbg] Open crates with keys from dungeon chests: Wooden->Common ... Diamond->Legendary`);
    return;
  }
  const report = service().reportOf(playerId);
  if (!report) {
    debugSay(playerId, "[dbg] you are not in a dungeon — step on a pad first");
    return;
  }
  if (verb === "chests") {
    // There is nothing to scan: a room's chests are in its build, and the code only meets
    // one when a player clicks it. What this prints is the state of the rule instead.
    debugSay(playerId, "[dbg] chests are `Chest` blocks, opened by clicking them: they become Air and drop a key.");
    debugSay(playerId, "[dbg] nothing is searched, so a chest anywhere in a room works.");
    return;
  }
  if (verb === "seed") {
    debugSay(playerId, `[dbg] ${report.difficulty.label} · layer ${report.chunkY === null ? "none" : report.chunkY}`);
    return;
  }
  debugSayAll(playerId, [
    `[dbg] ${report.difficulty.label} · layer ${report.chunkY === null ? "none" : report.chunkY} · tick ${report.ticks}`,
    `[dbg] you ${report.position.map((value) => Math.round(value * 10) / 10).join(", ")}`
      + ` · chunk ${report.chunk.x},${report.chunk.z}`
      + ` · origin ${report.origin ? report.origin.x + "," + report.origin.y + "," + report.origin.z : "none"}`,
    `[dbg] rooms planned ${report.planned} · queued ${report.queued} · placed ${report.placed}`
      + ` · templates ${report.templates} (off ${report.disabled})`,
    `[dbg] room example chunk ${report.exampleChunk ? report.exampleChunk.join(",") : "none"} — /dbg templates`,
    `[dbg] entrance chunk ${report.entrance.chunkX},${report.entrance.chunkY},${report.entrance.chunkZ}`
      + ` · ${report.entrance.loaded ? "loaded" : "NOT loaded"}`
      + ` · ${report.entrance.occupied ? "a room is there" : "empty"}`
      + ` · Bedrock ${report.entrance.bottomName || "unreadable"} / ${report.entrance.topName || "unreadable"}`,
    `[dbg] mobs · ${report.mobs.mobs} alive in ${report.mobs.rooms} room(s)`
      + ` · ${report.mobs.cleared} room(s) written clear`
      + (report.mobs.types.length > 0 ? ` · refused ${report.mobs.types.join("; ")}` : ""),
    `[dbg] room #${report.entrance.templateIndex === null ? "-" : report.entrance.templateIndex}`
      + ` · ${report.entrance.templateSource || "unreadable"}`
      + ` · floor block y ${report.entrance.floorBlockY === null ? "unknown" : report.entrance.floorBlockY}`
      + ` · failed ${report.entrance.failures}`,
  ]);
}

function findNearbyChestForVider(api, playerId, radius = 6) {
  let pos = null;
  try { pos = api.getPosition(playerId); } catch(_) { return null; }
  if (!pos || pos.length < 3) return null;
  const cx = Math.floor(pos[0]), cy = Math.floor(pos[1]), cz = Math.floor(pos[2]);
  for (let dy = -2; dy <= 3; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const x = cx+dx, y = cy+dy, z = cz+dz;
        try {
          const b = api.getBlock(x,y,z);
          if (b && typeof b === "string" && b.includes("Chest")) return [x,y,z];
        } catch(e) { reportErrorToOwner(e); }
      }
    }
  }
  return null;
}

function parseDebugCommand(raw) {
  const text = String(raw === undefined || raw === null ? "" : raw).trim();
  if (text.length === 0) return null;
  const parts = text.split(/\s+/);
  let head = parts[0].toLowerCase();
  if (head.startsWith("/")) head = head.slice(1);
  if (head.startsWith("!")) head = head.slice(1);
  for (const [verb, aliases] of Object.entries(DEBUG_COMMANDS)) {
    if (aliases.includes(head)) return verb;
  }
  // `/debug templates`: the word `debug` is the namespace, the next word the verb.
  if (head === "debug" || head === "dbg") {
    const next = (parts[1] || "info").toLowerCase();
    for (const [verb, aliases] of Object.entries(DEBUG_COMMANDS)) {
      if (aliases.includes(next)) return verb;
    }
    return "info";
  }
  return null;
}

playerCommand = (playerId, command) => {
  const raw = String(command === undefined || command === null ? "" : command).trim();
  const low = raw.toLowerCase();
  if (low.startsWith("!vider") || low.startsWith("/vider") || low.startsWith("!empty") || low.startsWith("/empty") || low.startsWith("!clear") || low.startsWith("/clear") || low === "vider" || low === "empty" || low === "clear") {
    try {
      const parts = raw.split(/\s+/);
      let chestPos = null;
      if (parts.length >= 4) {
        const x = Number(parts[1]), y = Number(parts[2]), z = Number(parts[3]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) chestPos = [x,y,z];
      }
      if (!chestPos) chestPos = findNearbyChestForVider(api, playerId, 6);
      if (!chestPos) {
        debugSay(playerId, "[vider] no chest nearby — stand next to it or use: /vider x y z");
        return true;
      }
      try { crateClearChunked(api, chestPos, () => {}); } catch(_) { try { crateClearChest(api, chestPos); } catch(e) { reportErrorToOwner(e); } }
      debugSay(playerId, `[vider] emptying chest ${chestPos[0]},${chestPos[1]},${chestPos[2]} — 36 slots chunked (6/tick) to avoid Argument too large`);
      return true;
    } catch (e) {
      debugSay(playerId, `[vider] failed: ${e && e.message ? e.message : e}`);
      return true;
    }
  }
  const verb = parseDebugCommand(command);
  if (!verb) return false;
  try {
    if (verb === "vider") {
      const chestPos = findNearbyChestForVider(api, playerId, 6);
      if (!chestPos) { debugSay(playerId, "[vider] no chest nearby — stand next to it"); return true; }
      try { crateClearChunked(api, chestPos, () => {}); } catch(_) { try { crateClearChest(api, chestPos); } catch(e) { reportErrorToOwner(e); } }
      debugSay(playerId, `[vider] emptying chest ${chestPos[0]},${chestPos[1]},${chestPos[2]} — chunked clear started`);
      return true;
    }
    runDebugCommand(playerId, verb);
  } catch (error) {
    debugSay(playerId, `[dbg] report failed: ${error && error.message ? error.message : "unknown error"}`);
  }
  return true;
};

// ------------------------------------------------------------------ shop --
//
// The game's own spawn is switched off in this world, so spawn is a place the code
// has to provide. It is one shop item, in a category of its own, and buying it is
// both the teleport and the way out of a dungeon.
//
// **Ending the dungeon is the point.** A player teleported out of their dungeon
// without telling the dungeon would still have a record: the next tick would read the
// chunk they now stand in and keep copying rooms around the spawn. Buying this item
// moves the player and forgets the dungeon in the same call, so nothing is ever
// generated for a player who is at spawn.

const SHOP_CATEGORY = "Utilities";
const SPAWN_ITEM = "Teleport to spawn";

// -------------------------------------------------------------- blessings --
//
// A blessing is bought with a **point**, and a point is what an aura level gives. The shop is
// the whole interface: one tile to roll, and up to three tiles to choose from. Nothing is
// drawn in the world and nothing is written into a chunk — a blessing is a record on a
// player, not a block.
//
// Three lifetimes, and the owner's words for them:
//
//   - **permanent** — saved in a player database value (`BLESSING_DB_KEY`), read back and
//     applied on every reconnection. The stack is a map of counts, so ten copies really are
//     ten copies; the client options it produces are absolute, computed from the counts.
//   - **run** — lasts until the run ends: **death, leave, or teleport to spawn**. The world
//     keeps the list, and `endRun` is the only thing that drops it.
//   - **timed** — a potion effect, 30 s to 2 min, and nothing else. The engine ends it on
//     time; the world only reads its own clock to say what is still running.
//
// The tile is **per player** (`createShopItemForPlayer`): a tile that says "you have 3
// points" cannot be shared, and the game's own shop would otherwise show one player's count
// to everybody.

const BLESSING_CATEGORY = "Blessings";
const ROLL_ITEM = "Roll a Blessing";
/**
 * The keys of the three choice tiles, and **the only tiles that ever come and go**.
 *
 * A shop category shows every tile it has: there is no known way to hide one from the list,
 * and the engine has no `deleteShopItemForPlayer` at all. What it does have is
 * `resetShopItemForPlayer`, which **deletes this player's override** for a key — the tile
 * then falls back to whatever the category itself holds, and disappears when nothing does.
 * That is the documented way to take a tile away, so the choice tiles are created for the
 * offer and reset once the offer is over. The roll tile never moves, which is why the
 * category is never empty: a shop with no tiles left would be the "buttons disappear" bug.
 */
const CHOICE_KEYS = ["Choice 1", "Choice 2", "Choice 3"];
/**
 * The **custom currency** the points are shown in.
 *
 * `setCurrency` defines it for a player and puts it on the HUD, so a point is visible
 * without opening the shop. It is explicitly **not persistent** — the points are a session
 * thing, while the blessings themselves are what is saved.
 */
const POINTS_CURRENCY = "Blessing Point";
/**
 * **Where the permanent blessings live**: one player database value, written since the
 * owner asked for the stack to survive a reconnection.
 *
 * It is a database value (per player, keyed by `getPlayerDbId` in the game's own storage) and
 * not a world variable, because a world variable is shared by everybody and would hand one
 * player's stack to the next one who joined.
 *
 * The value is written **only when it changes** — a choice of a permanent blessing, or a
 * choice that spends a point. Reading it happens once, on a join.
 */
const BLESSING_DB_KEY = "dungeonBreak.blessings.v1";

/** The bookkeeping, created once for the world. In memory only, by the owner's rule. */
let blessingService = null;

function blessings() {
  if (!blessingService) blessingService = createBlessingService({});
  return blessingService;
}

// ------------------------------- ranks ------------------------------------
let ranksService = null;
function ranks() {
  if (!ranksService) ranksService = createRanksService({ api, log: (m)=>{ try{ api.log(m);} catch(e) { reportErrorToOwner(e); } } });
  return ranksService;
}
// map hex -> closest allowed nameColour (fallback if colorInLobbyLeaderboard not supported)
function hexToNameColour(hex) {
  const table = {
    "#FF0000": "red", "#FF1A1A": "red", "#FF3B30": "red", "#C0392B": "red", "#E74C3C": "red",
    "#00FF00": "lime", "#2ECC71": "lime", "#1ABC9C": "green", "#AAAAAA": "default", "#BDC3C7": "default",
    "#FFFF00": "yellow", "#F1C40F": "yellow", "#F39C12": "orange",
    "#0000FF": "blue", "#3498DB": "blue", "#5DADE2": "aqua", "#A569BD": "purple", "#7D3C98": "purple", "#E67E22": "orange",
  };
  const up = String(hex).toUpperCase();
  if (table[up]) return table[up];
  // heuristic
  if (up.includes("FF3B") || up.includes("E74")) return "red";
  if (up.includes("2ECC") || up.includes("1ABC")) return "green";
  if (up.includes("349") || up.includes("5DA")) return "aqua";
  if (up.includes("A569") || up.includes("7D3C")) return "purple";
  if (up.includes("F39") || up.includes("F1C")) return "yellow";
  return "default";
}
function applyRankVisuals(playerId) {
  const rank = ranks().getDisplayRank(playerId);
  const color = rank ? rank.color : "";
  const nameColour = rank ? hexToNameColour(rank.color) : "default";
  try {
    // leaderboard color for everyone seeing this player
    if (typeof api.setTargetedPlayerSettingForEveryone === "function") {
      try { api.setTargetedPlayerSettingForEveryone(playerId, "colorInLobbyLeaderboard", color || "", true); } catch(e) { reportErrorToOwner(e); }
      try { api.setTargetedPlayerSettingForEveryone(playerId, "nameColour", nameColour, true); } catch(e) { reportErrorToOwner(e); }
      // nametag (optional) — show prefix as subtitle? minimal
      if (rank) {
        try { api.setTargetedPlayerSettingForEveryone(playerId, "nameTagInfo", { content: [{str: api.getEntityName(playerId) || String(playerId), style:{color:"white"}}], subtitle: [{str: rank.prefix, style:{color: rank.color}}], backgroundColor: "#00000088" }, true); } catch(e) { reportErrorToOwner(e); }
      } else {
        try { api.setTargetedPlayerSettingForEveryone(playerId, "nameTagInfo", { content: [{str: api.getEntityName(playerId) || String(playerId), style:{color:"white"}}] }, true); } catch(e) { reportErrorToOwner(e); }
      }
    }
  } catch(e) { reportErrorToOwner(e); }
}
function refreshRanksShop(playerId) {
  const avail = ranks().getAvailableRanks(playerId);
  const display = ranks().getDisplayRank(playerId);
  const currentLabel = display ? display.label : "NONE";
  // dropdown options: NONE + available labels (unique), sorted by rank sort
  const sorted = [...avail].sort((a,b)=> (a.sort||0)-(b.sort||0));
  const options = [NONE_RANK_ID, ...sorted.map(r=> r.label)];
  // keep NONE first, rest sorted; but ensure uniqueness
  const uniq = [...new Set(options)];
  try {
    api.createShopItemForPlayer(playerId, "Ranks", "Rank", {
      image: "Crown",
      customTitle: "Ranks",
      description: `Current: ${currentLabel}`,
      buyButtonText: "Select",
      cost: 0,
      canBuy: true,
      sortPriority: 5,
      userInput: { type: "dropdown", dropdownOptions: uniq, shouldResetSelectionOnOptionsChange: false, initialValue: currentLabel },
    });
    api.configureShopCategoryForPlayer(playerId, "Ranks", { customTitle: "Ranks", description: `Current: ${currentLabel}` });
  } catch(e){ try{ api.log(`[Ranks] shop failed ${e && e.message}`);} catch(e) { reportErrorToOwner(e); } }
}
function handleRankUnlocks(playerId, newly) {
  if (!newly || newly.length===0) return;
  for (const r of newly) {
    api.sendMessage(playerId, [cStr("Rank ", MSG_COLORS.white), cStr(r.prefix, r.color)])
  }
  refreshRanksShop(playerId);
}
let rankTickCounter = 0;

/**
 * The key an account is held under **for this session**.
 *
 * The **permanent** stack is the exception: it is saved under the game's permanent player id
 * (`permanentKeyOf`), which is the only thing that survives a reconnection. Points, offers
 * and the run's blessings are keyed by the session, because they must not survive one.
 */
function accountKeyOf(playerId) {
  return String(playerId);
}

/**
 * The permanent key: the game's own id for this player, stable across sessions.
 *
 * `getPlayerDbId` is documented as "their permanent identifier that doesn't change when
 * leaving and re-entering". When the game cannot answer, the session id is used instead: the
 * save is then lost rather than shared, which is the safe way to fail.
 */
function permanentKeyOf(playerId) {
  try {
    const id = api.getPlayerDbId(playerId);
    if (id !== undefined && id !== null && String(id).length > 0) return `db:${id}`;
  } catch (_) {
    // Nothing to do: a save that cannot be named is a save that is not written.
  }
  return `session:${playerId}`;
}

/** Tracks potion effects given *during this run* — so we only clear what **we** gave, not what was already there. */
const sessionPotionEffects = new Map(); // playerId -> Set<effectName>
function getSessionEffects(playerId) {
  let set = sessionPotionEffects.get(String(playerId));
  if (!set) { set = new Set(); sessionPotionEffects.set(String(playerId), set); }
  return set;
}
function hadEffectBefore(playerId, effectName) {
  try {
    if (typeof api.getEffects === "function") {
      const list = api.getEffects(playerId);
      if (Array.isArray(list) && list.includes(effectName)) return true;
    }
    if (typeof api.hasEffect === "function" && api.hasEffect(playerId, effectName)) return true;
  } catch(e) { reportErrorToOwner(e); }
  return false;
}
function rememberSessionEffect(playerId, effectName) {
  if (!effectName) return;
  if (hadEffectBefore(playerId, effectName)) return; // was already there — not ours to clear
  getSessionEffects(playerId).add(effectName);
}

/** The aura level of a player, from the game. `1` when the game cannot say. */
function auraLevelOf(playerId) {
  try {
    const info = api.getAuraInfo(playerId);
    if (info && Number.isFinite(info.level)) return info.level;
  } catch (_) {
    // Nothing to do: a level that cannot be read is the level of a fresh player.
  }
  return 1;
}

/** The game's clock, in ticks, for the timed blessings. */
function tickNow() {
  try {
    if (typeof api.now === "function") return Math.floor(api.now() / 50);
  } catch (_) {
    // Fall through to the scheduler's own count.
  }
  return 0;
}

/**
 * What a player has, as one short line: the level and the points.
 *
 * The odds **used to be here** and are gone: the owner called the tile overloaded, and a
 * player who wants them has `/dbg blessings`. Two numbers, one line, that is the tile.
 */
function blessingSummary(playerId, level) {
  const points = blessings().pointsFor(accountKeyOf(playerId), level);
  return `Aura level ${level} · ${points} point${points === 1 ? "" : "s"}`;
}

/**
 * Shows the points on the HUD as the custom currency they are.
 *
 * `setCurrency` defines it — one call — and `setCurrencyAmount` moves it. Both are wrapped:
 * a currency the game refuses is a missing HUD line, while an exception on a join is not.
 * `persistent: false` is the owner's rule written where it is enforced.
 */
function showPoints(playerId, points) {
  try {
    api.setCurrency(playerId, POINTS_CURRENCY, {
      amount: points,
      icon: "fa-solid fa-star",
      iconColour: "orange",
      persistent: false,
    });
  } catch (error) {
    try {
      api.log(`[Dungeon] the points currency could not be shown: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // Nothing left to do.
    }
  }
  try {
    api.setCurrencyAmount(playerId, POINTS_CURRENCY, points, "Blessing");
  } catch (_) {
    // `setCurrency` above already carried the amount; this only keeps the subtext honest.
  }
}

/**
 * Removes this player's override of a tile, which is how a tile is taken away.
 *
 * `resetShopItemForPlayer` deletes the per-player item and does **nothing** if this player
 * has none — the documented behaviour, and the reason it can be called blind on every
 * refresh.
 */
function removePlayerTile(playerId, itemKey) {
  try {
    api.resetShopItemForPlayer(playerId, BLESSING_CATEGORY, itemKey);
    return true;
  } catch (error) {
    try {
      api.log(`[Dungeon] blessing tile "${itemKey}" could not be removed: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // Nothing left to do.
    }
    return false;
  }
}

/**
 * Draws this player's blessing tiles: the roll, and the offer when there is one.
 *
 * **The roll is the one tile that always exists**, so the category is never empty — the
 * shop bug the owner reported was a category being emptied. While an offer is live, three
 * `Choose` tiles join it; when the offer ends they are **deleted** with
 * `resetShopItemForPlayer`, not hidden.
 */
function refreshBlessingTiles(playerId) {
  const key = accountKeyOf(playerId);
  // The engine ends a timed effect on time; this drops the **bookkeeping** of it, so the
  // report and the tiles never claim a bonus that has already run out.
  blessings().pruneTimed(key, tickNow());
  const level = auraLevelOf(playerId);
  const points = blessings().pointsFor(key, level);
  const account = blessings().accountOf(key);
  const offer = account.offer;
  showPoints(playerId, points);

  try {
    // One tile, two states, **one line of text**: the level and the points. While an offer
    // is live the same tile says so and cannot be bought - a roll would cost a second point.
    api.createShopItemForPlayer(playerId, BLESSING_CATEGORY, ROLL_ITEM, offer.length > 0
      ? {
        image: "Beacon",
        customTitle: "Select one of the three",
        description: `${blessingSummary(playerId, level)} · the point is on the table`,
        canBuy: false,
        redDot: false,
        sortPriority: 10,
      }
      : {
        image: "Beacon",
        customTitle: "Roll a Blessing",
        description: blessingSummary(playerId, level),
        buyButtonText: "Roll",
        cost: 0,
        canBuy: points > 0,
        redDot: points > 0,
        sortPriority: 10,
        onBoughtMessage: "Rolling...",
      });
  } catch (error) {
    logShopFailure(ROLL_ITEM, error);
  }

  // **The choices second**, after the roll tile above: `createShopItemForPlayer` is what
  // creates the category, so resetting a key in a category that does not exist yet is an
  // avoidable edge. The screen order is `sortPriority`, not creation order.
  CHOICE_KEYS.forEach((itemKey, position) => {
    const draw = offer[position];
    if (!draw) {
      removePlayerTile(playerId, itemKey);
      return;
    }
    try {
      api.createShopItemForPlayer(playerId, BLESSING_CATEGORY, itemKey, choiceTile(draw, position));
    } catch (error) {
      logShopFailure(itemKey, error);
    }
  });

  try {
    api.configureShopCategoryForPlayer(playerId, BLESSING_CATEGORY, {
      customTitle: offer.length > 0 ? "Select one" : "Blessings",
      redDot: offer.length > 0 || points > 0,
    });
  } catch (_) {
    // The title is a nicety; the tiles are the feature.
  }
  return points;
}

/** One log line per refused tile. A shop is a convenience; it is never a crash. */
function logShopFailure(itemKey, error) {
  try {
    api.log(`[Dungeon] blessing item "${itemKey}" could not be created: ${error && error.message ? error.message : error}`);
  } catch (_) {
    // Nothing left to do.
  }
}

// ------------------------------------------------------- client options --
//
// Every number a blessing changes is a **client option**: the owner asked for the effects to
// be client options, and the ones that are not (a potion effect) are the timed scope. They
// are recomputed from scratch on every change, permanent stack **plus** the run's bonuses,
// so a run ending can never leave a +0.3 speed behind.

/**
 * Applies the client options the current blessings produce.
 *
 * `base` is what this player would have with no blessing at all: the world's own options
 * (respawn, aura scale) and the engine's defaults for health, speed, damage. Each layer is
 * computed by `effects.js`, which is pure, so the sum is testable without a game.
 */
const blessingDamageCache = new Map(); // playerId -> { dealing, receiving }

function refreshDamageCache(playerId, options) {
  try {
    blessingDamageCache.set(String(playerId), {
      dealing: Number.isFinite(options.dealingDamageMultiplier) ? options.dealingDamageMultiplier : 1,
      receiving: Number.isFinite(options.receivingDamageMultiplier) ? options.receivingDamageMultiplier : 1,
    });
  } catch(e) { reportErrorToOwner(e); }
}

function dealingMultiplierOf(playerId) {
  const cached = blessingDamageCache.get(String(playerId));
  if (cached && Number.isFinite(cached.dealing)) return cached.dealing;
  try {
    const key = accountKeyOf(playerId);
    const opts = effects.optionsFrom(blessings().permanentOf(key), blessings().runOf(key), {});
    return Number.isFinite(opts.dealingDamageMultiplier) ? opts.dealingDamageMultiplier : 1;
  } catch (_) { return 1; }
}
function receivingMultiplierOf(playerId) {
  const cached = blessingDamageCache.get(String(playerId));
  if (cached && Number.isFinite(cached.receiving)) return cached.receiving;
  try {
    const key = accountKeyOf(playerId);
    const opts = effects.optionsFrom(blessings().permanentOf(key), blessings().runOf(key), {});
    return Number.isFinite(opts.receivingDamageMultiplier) ? opts.receivingDamageMultiplier : 1;
  } catch (_) { return 1; }
}

function applyBlessingOptions(playerId, base = {}) {
  const key = accountKeyOf(playerId);
  // In spawn, only permanent stack applies (run/timed disabled for navigation, no slowdown)
  if (spawnMode.get(String(playerId)) === true) {
    const spawnOpts = effects.optionsFrom(blessings().permanentOf(key), [], base);
    try { api.setClientOptions(playerId, spawnOpts); } catch(e) { reportErrorToOwner(e); }
    refreshDamageCache(playerId, spawnOpts);
    try { refreshWeaponStats(api, playerId, spawnOpts.dealingDamageMultiplier ?? 1); } catch(e) { reportErrorToOwner(e); }
    return spawnOpts;
  }
  const options = effects.optionsFrom(blessings().permanentOf(key), blessings().runOf(key), base);
  try {
    api.setClientOptions(playerId, options);
  } catch (error) {
    try {
      api.log(`[Dungeon] blessing options could not be applied for ${playerId}: ${error && error.message ? error.message : error}`);
    } catch(e) { reportErrorToOwner(e); }
  }
  refreshDamageCache(playerId, options);
  try { refreshWeaponStats(api, playerId, options.dealingDamageMultiplier ?? 1); } catch(e) { reportErrorToOwner(e); }
  return options;
}

/**
 * The world's own client options, the ones a join always sends.
 *
 * `autoRespawn` is deliberately absent: the owner removed it because of a game bug, and only
 * the delay is set now. The aura scale is here for the same reason as the respawn delay —
 * both are per player and neither survives a reconnection.
 */
function baseClientOptions() {
  return {
    secsToRespawn: 0,
    auraPerLevel: AURA_PER_LEVEL,
    maxAuraLevel: MAX_AURA_LEVEL,
  };
}

/** Puts a timed blessing on the player, through the engine's own effect timer. Uses api.applyEffect — visible icon + timer, as requested. */
function applyTimedEffect(playerId, blessing) {
  // Allow in spawn except Speed (would re-introduce slowdown navigation issue)
  const effectProbe = effects.timedEffectOf(blessing);
  if (effectProbe && effectProbe.effectName === "Speed" && spawnMode.get(String(playerId)) === true) return false;
  const effect = effects.timedEffectOf(blessing);
  if (!effect) return false;
  // Remember only if it wasn't already there — we must not clear a pre-existing effect later
  const shouldTrack = !hadEffectBefore(playerId, effect.effectName);
  try {
    api.applyEffect(playerId, effect.effectName, effect.durationMs, { inbuiltLevel: effect.level });
    if (shouldTrack) rememberSessionEffect(playerId, effect.effectName);
  } catch (error) {
    try {
      api.log(`[Dungeon] the ${effect.effectName} effect could not be applied: ${error && error.message ? error.message : error}`);
    } catch(e) { reportErrorToOwner(e); }
    return false;
  }
  return true;
}

/** Puts a run's lasting potion effect on the player (Thorns). Indefinite until we clear it. */
function applyRunEffect(playerId, effect) {
  if (effect && effect.effectName === "Speed" && spawnMode.get(String(playerId)) === true) return false;
  const shouldTrack = !hadEffectBefore(playerId, effect.effectName);
  try {
    api.applyEffect(playerId, effect.effectName, null, { inbuiltLevel: effect.level });
    if (shouldTrack) rememberSessionEffect(playerId, effect.effectName);
    return true;
  } catch (error) {
    try {
      api.log(`[Dungeon] the ${effect.effectName} effect could not be applied: ${error && error.message ? error.message : error}`);
    } catch(e) { reportErrorToOwner(e); }
    return false;
  }
}

// ----------------------------------------------------------- the save --
//
// One database value per player, holding `{"blessing_id": count}`. Read once on a join,
// written only when the stack changes. A save that cannot be read is an **empty** stack, not
// a crash: a corrupted value must cost a player their permanents, never their session.

/** Reads the permanent stack of a player from the game's database. */
function loadPermanent(playerId) {
  let raw = null;
  try {
    raw = api.getPlayerDbValue(playerId, BLESSING_DB_KEY);
  } catch (error) {
    try {
      api.log(`[Dungeon] the blessings of ${playerId} could not be read: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // Nothing left to do: an empty stack is the safe answer.
    }
    return {};
  }
  return effects.readPermanentSave(raw);
}

/** Writes the permanent stack of a player. Called once per change, never per tick. */
function savePermanent(playerId, counts) {
  try {
    api.setPlayerDbValue(playerId, BLESSING_DB_KEY, effects.saveOf(counts));
    return true;
  } catch (error) {
    try {
      api.log(`[Dungeon] the blessings of ${playerId} could not be saved: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // The blessing still applies for this session; only the next one loses it.
    }
    return false;
  }
}

// ------------------------------------------------------------- the run --

/**
 * **A run ends here**: every `run` blessing and every `timed` one is dropped, and every
 * client option is recomputed so only the permanent stack is left.
 *
 * Death, leave and teleport to spawn all end at this function, which is the owner's list. It
 * is safe to call when there is no run: nothing is applied, nothing is written, and the
 * permanent stack is re-applied for good measure.
 */
/**
 * Takes off every potion effect the session was holding, without touching the permanent stack.
 * ONLY clears effects *we* gave via api.applyEffect during this game — never what was already there.
 * Uses the sessionPotionEffects set populated at apply time (checked via api.getEffects/hasEffect).
 */
function dropSessionEffects(playerId) {
  const tracked = sessionPotionEffects.get(String(playerId));
  if (tracked && tracked.size > 0) {
    for (const effectName of [...tracked]) {
      try { api.removeEffect(playerId, effectName); } catch(e) { reportErrorToOwner(e); }
    }
    // keep set until forget/clearRun fully drops it — endRun will delete below
    return;
  }
  // Fallback for old saves / no tracking yet: remove what the blessing service says we hold
  const key = accountKeyOf(playerId);
  const run = blessings().runOf(key);
  for (const effect of effects.runEffects(run)) {
    try { api.removeEffect(playerId, effect.effectName); } catch(e) { reportErrorToOwner(e); }
  }
  for (const entry of blessings().timedOf(key)) {
    const effect = effects.timedEffectOf(entry.blessing);
    if (!effect) continue;
    try { api.removeEffect(playerId, effect.effectName); } catch(e) { reportErrorToOwner(e); }
  }
}
function clearSessionEffectsTracking(playerId) {
  sessionPotionEffects.delete(String(playerId));
}

function endRun(playerId, reason) {
  const key = accountKeyOf(playerId);
  dropSessionEffects(playerId);
  const dropped = blessings().clearRun(key);
  clearSessionEffectsTracking(playerId);
  const hadSomething = dropped.run.length > 0 || dropped.timed.length > 0;
  applyBlessingOptions(playerId, baseClientOptions());
  if (hadSomething && reason) {
    try {
      if (Array.isArray(reason)) api.sendMessage(playerId, reason);
      else if (typeof reason === "string" && reason.trim()) api.sendMessage(playerId, [cStr(reason, MSG_COLORS.gray)]);
      else if (reason) api.sendMessage(playerId, reason);
    } catch(e) { reportErrorToOwner(e); }
  }
  return dropped;
}

/**
 * Applies one blessing to a player, once, when it is chosen.
 *
 * The three scopes are three different things to do, and this is the only place that decides
 * which — the catalogue says what the blessing is, `effects.js` says what it adds up to, and
 * the world does the calls.
 */
function applyBlessing(playerId, blessing, rarity) {
  const key = accountKeyOf(playerId);
  const scope = effects.scopeKeyOf(blessing);
  if (scope === "permanent") {
    const counts = blessings().addPermanent(key, blessing);
    // **Saved before it is applied**: a player who leaves one tick after the choice keeps
    // what they paid for.
    savePermanent(playerId, counts);
    applyBlessingOptions(playerId, baseClientOptions());
    return { scope, counts };
  }
  if (scope === "timed") {
    const effect = effects.timedEffectOf(blessing);
    blessings().addTimed(key, blessing, tickNow() + Math.ceil((effect ? effect.durationMs : 0) / 50));
    applyTimedEffect(playerId, blessing);
    return { scope, effect };
  }
  // The run: recorded, then applied as bonuses. A potion effect with no duration is a run
  // effect (Thorns), so it is applied for the whole run and removed by `endRun`.
  blessings().addRun(key, blessing);
  applyBlessingOptions(playerId, baseClientOptions());
  for (const effect of effects.runEffects([blessing])) applyRunEffect(playerId, effect);
  return { scope };
}

/** Minimal announcement: styled line + points left, no spam. */
function announceBlessing(playerId, blessing, rarity, pointsLeft) {
  api.sendMessage(playerId, rollMessage(blessing, rarity))
  // Second line: rarity color + points left (minimal, keeps "points left" for tests)
  api.sendMessage(playerId, [
      cStr(rarity.label, rarity.textColour || rarity.colour || MSG_COLORS.gold),
      cStr(` · ${pointsLeft} point${pointsLeft===1?"":"s"} left`, MSG_COLORS.white),
    ])
  // The middle of the screen, big: the rarity is what a player reads first.
  try {
    api.queueMiddleTextUpper(playerId, [{ str: announcementOf(blessing, rarity), style: { color: rarity.textColour } }], 2500);
  } catch (_) {
    // The message and the card carry the news; a missing banner is not a lost choice.
  }
  try {
    const card = cardFor(blessing, rarity);
    api.sendTopRightHelper(playerId, card.icon, card.text, card.opts);
  } catch (_) {
    // Same: the choice happened.
  }
}

/**
 * Rolls: lays three blessings out and **reserves** the point that will pay for the pick.
 *
 * A roll with no point is refused with a message, and a roll while an offer is open re-shows
 * that offer instead of redrawing it — otherwise a player could roll, look, and roll again
 * until the three were good.
 */
function rollBlessing(playerId) {
  const key = accountKeyOf(playerId);
  const level = auraLevelOf(playerId);
  const offer = blessings().roll(key, level);
  refreshBlessingTiles(playerId);
  if (!offer) {
    return false;
  }
  return true;
}

/**
 * Chooses one of the three: **this is the point being spent**, and the blessing is applied.
 *
 * The service refuses anything that is not one of the offered blessings — a stale tile, a
 * card clicked after the offer was consumed — so the shop can never be charged for a choice
 * that was not on screen. Then the tiles go **back to their normal state**, the point on the
 * HUD moves, and the shop is **closed**: the pick is final.
 */
function chooseBlessing(playerId, position) {
  const key = accountKeyOf(playerId);
  const level = auraLevelOf(playerId);
  const result = blessings().choose(key, level, position);
  if (!result) {
    refreshBlessingTiles(playerId);
    return false;
  }
  applyBlessing(playerId, result.blessing, result.rarity);
  // Shop closes first — chat is invisible while it is open, so the announcement must come
  // after the close to be seen.
  refreshBlessingTiles(playerId);
  closeShop(playerId);
  announceBlessing(playerId, result.blessing, result.rarity, result.pointsLeft);
  return true;
}

/**
 * Tracks shop open state — `openShop(playerId, true)` is a toggle, so closing
 * when closed would open it. This is the bug that made death open the shop.
 */
const shopOpen = new Set();

/**
 * Closes the shop, if the game can and the shop is actually open.
 *
 * `openShop(playerId, toggle)` is the documented door, and `toggle: true` on an open shop is
 * the only way to shut it. It is wrapped because a shop that stays open is a cosmetic
 * problem, while an exception thrown from a callback is not: the choice has already been
 * recorded by the time this runs.
 */
function closeShop(playerId) {
  if (!shopOpen.has(playerId)) return;
  try {
    api.openShop(playerId, true);
  } catch (error) {
    try {
      api.log(`[Dungeon] the shop could not be closed for ${playerId}: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // Nothing left to do.
    }
  }
}

/**
 * A player's session, **from zero**: aura, points, offer, run.
 *
 * Three things that must not survive a reconnection and all happen here: the game's aura is
 * set back to nothing, the in-memory account is dropped, the points currency is shown at 0,
 * and any run the player had is over. Then the **permanent** stack is read back from the
 * database value and applied — the one thing that *does* survive, because the owner asked for
 * it to.
 */
function resetPlayerProgress(playerId) {
  try {
    api.setTotalAura(playerId, 0);
  } catch (error) {
    try {
      api.log(`[Dungeon] the aura of ${playerId} could not be reset: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // Nothing left to do.
    }
  }
  // A session that is forgotten must not leave an effect behind: the run's lasting potions
  // (Thorns) and any timer belong to the session that is being dropped.
  // Only effects *we* gave — never what was already there before the game.
  dropSessionEffects(playerId);
  clearSessionEffectsTracking(playerId);
  blessings().forget(accountKeyOf(playerId));
  // **The permanent stack comes back from the save**, before anything is drawn: the tiles
  // show what the player owns, not what the previous session happened to leave in memory.
  blessings().setPermanent(accountKeyOf(playerId), loadPermanent(playerId));
  applyBlessingOptions(playerId, baseClientOptions());
  showPoints(playerId, 0);
  return refreshBlessingTiles(playerId);
}

const SHOP_ITEMS = [
  {
    category: SHOP_CATEGORY,
    key: SPAWN_ITEM,
    item: {
      image: "spawnicon.png",
      customTitle: [{ translationKey: "classicGame:teleportToLobbySpawn" }],
      description: [],
      // pas de cost: sinon le shop affiche le placeholder "free" — ce n'est pas un achat
      canBuy: true,
      sortPriority: 0,
    },
  },
];

/**
 * Registers the shop items, once, at load.
 *
 * Called again by `onPlayerJoin` as a safety net: an item registered while no player
 * was online is not always shown to the first player who joins, and re-creating an
 * existing item simply replaces it — the documented behaviour of `createShopItem`.
 */
function registerShopItems() {
  for (const entry of SHOP_ITEMS) {
    try {
      api.createShopItem(entry.category, entry.key, { ...entry.item });
    } catch (error) {
      // A shop is a convenience: if the API is missing or refuses, the game keeps
      // running and `/dbg` still works. It is logged rather than silenced.
      try {
        api.log(`[Dungeon] shop item "${entry.key}" could not be created: ${error && error.message ? error.message : error}`);
      } catch (_) {
        // Nothing left to do.
      }
    }
  }
  // Category display: id is already "Utilities" (capitalized), no translation needed
  // (translationKey classicGame:utilities does not work on category names)
}

onPlayerBoughtShopItem = (playerId, categoryKey, itemKey, itemOrInput, userInputMaybe) => {
  // Ranks — single button with dropdown
  if (categoryKey === "Ranks" && itemKey === "Rank") {
    try {
      // api may pass (playerId, cat, key, item, userInput) or (playerId, cat, key, userInput) — handle both
      let chosen = null;
      if (typeof userInputMaybe === "string") chosen = userInputMaybe;
      else if (typeof itemOrInput === "string") chosen = itemOrInput;
      else if (itemOrInput && typeof itemOrInput === "object" && typeof itemOrInput.userInput === "string") chosen = itemOrInput.userInput;
      if (!chosen) {
        // fallback: try reading item customTitle? no — just return
        return;
      }
      const label = String(chosen).trim();
      if (label === NONE_RANK_ID || label === "NONE") {
        ranks().setSelected(playerId, NONE_ID);
        applyRankVisuals(playerId);
        refreshRanksShop(playerId);
        api.sendMessage(playerId, [cStr("Rank: ", MSG_COLORS.white), cStr("NONE", MSG_COLORS.gray)])
        return;
      }
      const rank = RANKS.find(r=> r.label === label || r.id === label);
      if (!rank) {
        api.sendMessage(playerId, [cStr(`Rank ${label} ?`, MSG_COLORS.red)])
        return;
      }
      const ok = ranks().setSelected(playerId, rank.id);
      if (!ok) {
        api.sendMessage(playerId, [cStr(rank.prefix, rank.color), cStr(" locked", MSG_COLORS.red)])
        refreshRanksShop(playerId);
        return;
      }
      applyRankVisuals(playerId);
      refreshRanksShop(playerId);
      api.sendMessage(playerId, [cStr("Rank: ", MSG_COLORS.white), cStr(rank.prefix, rank.color)])
    } catch(e){ try{ api.log(`[Ranks] select failed ${e && e.message}`);} catch(e) { reportErrorToOwner(e); } }
    return;
  }
  // A blessing roll: the point is checked in the service, so a tile the game let
  // through one tick after the last roll cannot buy a second one for free.
  if (categoryKey === BLESSING_CATEGORY) {
    try {
      if (itemKey === ROLL_ITEM) rollBlessing(playerId);
      // A choice tile is one of three, and its key names its position in the offer: the
      // offer itself is what decides what the pick was worth, not the key.
      else {
        const position = CHOICE_KEYS.indexOf(itemKey);
        if (position >= 0) chooseBlessing(playerId, position);
      }
    } catch (error) {
      try {
        api.log(`[Dungeon] blessing failed: ${error && error.message ? error.message : error}`);
      } catch (_) {
        // Nothing left to do.
      }
    }
    return;
  }
  if (categoryKey !== SHOP_CATEGORY || itemKey !== SPAWN_ITEM) return;
  // Teleport and forget are one call, so the tick can never see a player at spawn
  // with a dungeon: `teleportToSpawn` moves first, then drops the record.
  service().teleportToSpawn(playerId);
  endRun(playerId, [cStr("Run over — permanent stay", MSG_COLORS.gray)]);
  stopLobbyCountdown(playerId);
  try { spawnMode.set(String(playerId), true); } catch(e) { reportErrorToOwner(e); }
  try { if (typeof api.setPlayerGamemode === "function") api.setPlayerGamemode(playerId, SPAWN_GAMEMODE); } catch(e) { reportErrorToOwner(e); }
  try { applyBlessingOptions(playerId, baseClientOptions()); } catch(e) { reportErrorToOwner(e); }
  api.setClientOption(playerId, "middleTextUpper", "");
  closeShop(playerId);
  api.sendMessage(playerId, [{ str: { translationKey: "classicGame:teleportedToSpawn" } }]);
};

// -------------------------------------------------------------- lifecycle --

tick = () => {
  stepScheduler();
  try {
    service().tick();
  } catch (error) {
    // One failed tick must not stop the scheduler: the next one may be fine.
    try {
      api.log(`[Dungeon] tick failed: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // Nothing left to do.
    }
  }
  try { tickSpawnCheck(); } catch(e) { reportErrorToOwner(e); }
  try { tickCombatFx(); } catch(e) { reportErrorToOwner(e); }
  try { tickWeapons(api); } catch(e) { reportErrorToOwner(e); }
  try { tickArmorShimmer(api); } catch(e) { reportErrorToOwner(e); }
  // ranks time tracking
  try {
    rankTickCounter++;
    // each tick = 50ms, count time while in dungeon
    const ids = (()=>{ try{ return api.getPlayerIds ? api.getPlayerIds() : []; }catch(_){ return []; } })();
    for (const pid of ids) {
      try {
        const d = service().dungeonOf ? service().dungeonOf(pid) : null;
        if (!d || !d.difficulty) continue;
        ranks().recordTime(pid, d.difficulty.id, 1);
        // also track rooms? rooms via discoverRoom hook below — but time already
      } catch(e) { reportErrorToOwner(e); }
    }
    if (rankTickCounter % 20 === 0) {
      for (const pid of ids) {
        try {
          const newly = ranks().saveTime(pid);
          if (newly && newly.length) handleRankUnlocks(pid, newly);
        } catch(e) { reportErrorToOwner(e); }
      }
    }
  } catch(e) { reportErrorToOwner(e); }
};

onPlayerJoin = (playerId) => {
  // Crafts custom: shards -> materials -> armors (12 sets, 72 recipes) + renames/descriptions
  try { registerCraftingRecipes(api, playerId); } catch(e) { reportErrorToOwner(e); }
  try { applyItemStats(api, playerId); } catch(e) { reportErrorToOwner(e); }
  // The owner's respawn rule and the aura scale travel together: they are the same call.
  // The shop is re-registered per join: an item created while nobody was online is
  // not always offered to the first player who arrives, and replacing it is free.
  registerShopItems();
  // ranks load + visuals
  try { ranks().load(playerId); } catch(e) { reportErrorToOwner(e); }
  try { ranks().checkUnlocks(playerId); } catch(e) { reportErrorToOwner(e); }
  // **A join is a new run**: aura back to 0, points back to 0, no offer, no history.
  // Nothing is read from a database, because nothing was ever written to one.
  resetPlayerProgress(playerId);
  api.setPosition(playerId, LOBBY_POSITION);
  try { spawnMode.set(String(playerId), true); } catch(e) { reportErrorToOwner(e); }
  try { if (typeof api.setPlayerGamemode === "function") api.setPlayerGamemode(playerId, SPAWN_GAMEMODE); } catch(e) { reportErrorToOwner(e); }
  // In spawn, keep blessings but fix speed for navigation (no slowdown)
  try { applyBlessingOptions(playerId, baseClientOptions()); } catch(e) { reportErrorToOwner(e); }
  try { applyRankVisuals(playerId); } catch(e) { reportErrorToOwner(e); }
  try { refreshRanksShop(playerId); } catch(e) { reportErrorToOwner(e); }
  const names = DIFFICULTIES.filter((entry) => entry.fromLobby).map((entry) => entry.label).join(", ");
  api.sendMessage(playerId, [cStr("Welcome to Dungeon Break! ", MSG_COLORS.gold), cStr(`(${names})`, MSG_COLORS.white)]);
  api.sendMessage(playerId, [cStr("Shards → Crates → Craft → Weapons", MSG_COLORS.aqua)])
};

/**
 * A player opened the shop: the tiles are redrawn, because the count on them is theirs.
 *
 * A point is derived from the aura level, and a level can be gained while the shop is
 * closed — even outside a dungeon. Redrawing on open is what makes the tile true without a
 * tick spent watching every player's XP.
 *
 * Only the opening matters; a close has nothing to redraw.
 */
onPlayerToggledShopMenu = (playerId, isOpen) => {
  if (isOpen) shopOpen.add(playerId);
  else shopOpen.delete(playerId);
  if (!isOpen) return;
  try {
    refreshBlessingTiles(playerId);
  } catch (error) {
    try {
      api.log(`[Dungeon] blessing tiles could not be refreshed: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // Nothing left to do.
    }
  }
  try { refreshRanksShop(playerId); } catch(e) { reportErrorToOwner(e); }
};

onPlayerLeave = (playerId) => {
  stopLobbyCountdown(playerId);
  try {
    api.setClientOption(playerId, "middleTextUpper", "");
  } catch(e) { reportErrorToOwner(e); }
  shopOpen.delete(playerId);
  try { spawnMode.delete(String(playerId)); } catch(e) { reportErrorToOwner(e); }
  try {
    closeShop(playerId);
  } catch(e) { reportErrorToOwner(e); }
  service().leave(playerId);
  // **Leaving ends the run** — the owner's third end — and the session's account goes with
  // it. The permanent stack was already saved when it changed, so nothing is lost that was
  // meant to be kept.
  endRun(playerId, "");
  // The **session** goes with the player, and only the session: the permanent stack was saved
  // when it changed, so a leave cannot lose it, and the next join reads it back.
  // endRun already cleared tracked potion effects; this is legacy fallback + tracking cleanup
  try { dropSessionEffects(playerId); } catch(e) { reportErrorToOwner(e); }
  clearSessionEffectsTracking(playerId);
  blessings().forget(accountKeyOf(playerId));
  try { blessingDamageCache.delete(String(playerId)); } catch(e) { reportErrorToOwner(e); }
  try { forgetCombatFx(playerId); } catch(e) { reportErrorToOwner(e); }
  try { forgetWeaponAbility(playerId); } catch(e) { reportErrorToOwner(e); }
  // Clear per-player shop overrides so no tiles linger for a disconnected player.
  for (const key of CHOICE_KEYS) {
    try {
      removePlayerTile(playerId, key);
    } catch(e) { reportErrorToOwner(e); }
  }
  // HUD: back to 0 even while offline — next join starts from a clean slate.
  try {
    showPoints(playerId, 0);
  } catch(e) { reportErrorToOwner(e); }
  try { ranks().forget(playerId); } catch(e) { reportErrorToOwner(e); }
};

// ---- chat ranks ----
onPlayerChat = (playerId, chatMessage, channelName) => {
  try {
    const rank = ranks().getDisplayRank(playerId);
    if (!rank) return true; // no prefix
    const name = (()=>{ try{ const n = api.getEntityName(playerId); if(n) return String(n);} catch(e) { reportErrorToOwner(e); } return String(playerId); })();
    const prefixStyled = [{ str: rank.prefix + " ", style: { color: rank.color } }];
    const nameStyled = [{ str: name + ": ", style: { color: "white" } }];
    const msgStyled = [{ str: String(chatMessage), style: { color: "white" } }];
    const full = [...prefixStyled, ...nameStyled, ...msgStyled];
    api.broadcastMessage(full);
    return false;
  } catch(_){ return true; }
};

/**
 * A player clicked a block. In a dungeon, a click on a chest pays a key out once.
 *
 * The documented signature is `(playerId, wasAltClick, x, y, z, block, targetEId)`, and the
 * coordinates are the block that was clicked — the only position used here. Asking
 * `getPosition` would answer where the player stands *now*, a different block and sometimes
 * a different room.
 *
 * A click outside a dungeon, or on anything that is not a chest of it, is left to the game.
 * Clicks on entities are ignored: a chest is a block, and an armour stand that happens to
 * be in front of one must not pay twice.
 */
onPlayerClick = (playerId, wasAltClick, x, y, z, block, targetEId) => {
  // Only a `Chest` — that is the block the builds hold, and the caller does not have to
  // know what a chest gives to know what a chest is.
  if (targetEId) return;
  if (!isChestBlock(block)) return;
  try {
    service().clickPosition(playerId, [x, y, z]);
  } catch (error) {
    try {
      api.log(`[Dungeon] chest failed: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // Nothing left to do.
    }
  }
};

/**
 * A mob of a dungeon died.
 *
 * The count is the dungeon's, not the room's: `mobKilled` knows which room the mob was
 * tracked in, and clears it only when it was the last one. A mob killed outside a
 * dungeon — there are none, but a stale id could drift in — is ignored.
 */
onPlayerKilledMob = (playerId, mobId) => {
  try {
    service().mobKilled(playerId, mobId);
  } catch (error) {
    try {
      api.log(`[Dungeon] mob kill failed: ${error && error.message ? error.message : error}`);
    } catch(e) { reportErrorToOwner(e); }
  }
  // Weapon abilities on kill (PvE) — Rubellite stack, Spectral vacuum, Geo mines, Astral glowing
  try { onMobKilled(api, playerId, mobId); } catch(e) { reportErrorToOwner(e); }
  try {
    const newly = ranks().recordKill(playerId);
    if (newly && newly.length) handleRankUnlocks(playerId, newly);
  } catch(e) { reportErrorToOwner(e); }
};

/**
 * A mob the game removed by itself — too far from any player, or too many for the lobby.
 *
 * Forgotten, and **not** counted as a kill: a room is only clear when the player cleared
 * it, otherwise a mob wandering off would hand out the reward for free.
 */
onMobDespawned = (mobId) => {
  try {
    service().mobGone(mobId);
  } catch (_) {
    // Nothing to report and nothing to fix.
  }
};

// Prevent all PvP in the game — explicitly requested
onPlayerDamagingOtherPlayer = (attackingPlayer, damagedPlayer, damageDealt, withItem, bodyPartHit, damagerDbId, damageInfo) => {
  return "preventDamage";
};

// Damage must be affected by damage multiplier (blessings)
// For custom weapons, effective damage is already in `damage` stat (refreshWeaponStats),
// so we don't apply 2x multiplier. Only add elemental procs.
onPlayerDamagingMob = (playerId, mobId, damageDealt, ...rest) => {
  let baseDmg = Number(damageDealt);
  const hasBase = Number.isFinite(baseDmg);
  // Custom weapon detection: if player holds one of our sets, damage stat is already effective
  let isCustomWeapon = false;
  try {
    let heldName = null;
    try { const h = api.getHeldItem ? api.getHeldItem(playerId) : null; if (h && h.name) heldName = h.name; } catch(e) { reportErrorToOwner(e); }
    if (!heldName) {
      try {
        if (typeof api.getSelectedInventorySlotI === "function" && typeof api.getItemSlot === "function") {
          const idx = api.getSelectedInventorySlotI(playerId);
          if (Number.isFinite(idx) && idx >= 0 && idx < 10) {
            const it = api.getItemSlot(playerId, idx);
            if (it && it.name) heldName = it.name;
          }
        }
      } catch(e) { reportErrorToOwner(e); }
    }
    if (heldName && parseWeaponInfo(heldName)) isCustomWeapon = true;
  } catch(e) { reportErrorToOwner(e); }
  let scaled;
  if (hasBase && !isCustomWeapon) {
    try {
      const mult = dealingMultiplierOf(playerId);
      if (Number.isFinite(mult) && mult !== 1) scaled = baseDmg * mult;
    } catch(e) { reportErrorToOwner(e); }
  } else if (hasBase) {
    scaled = baseDmg; // already effective via setItemStat, keep as is
  }

  // Visual effect + elemental ability (PVE only) — returns proc extraDamage
  let extra = 0;
  let visualResult = null;
  try {
    visualResult = onWeaponHit(api, playerId, { baseDamage: baseDmg, scaledDamage: scaled ?? baseDmg, mobId });
    if (visualResult && visualResult.ability && visualResult.ability.extraDamage) {
      extra = visualResult.ability.extraDamage;
    }
  } catch(e) { reportErrorToOwner(e); }

  if (extra && Number.isFinite(extra) && extra !== 0) {
    const finalBase = Number.isFinite(scaled) ? scaled : (hasBase ? baseDmg : 0);
    return finalBase + extra;
  }
  if (scaled !== undefined) return scaled;
};

onMobDamagingPlayer = (mobId, playerId, damageDealt, ...rest) => {
  let scaled = undefined;
  let pid = playerId;
  let dmg = damageDealt;
  try {
    if (!Number.isFinite(Number(dmg)) && Number.isFinite(Number(playerId))) {
      dmg = Number(playerId);
      pid = mobId;
    }
    if (Number.isFinite(Number(dmg))) {
      const mult = receivingMultiplierOf(pid);
      if (Number.isFinite(mult) && mult !== 1) scaled = Number(dmg) * mult;
    }
  } catch(e) { reportErrorToOwner(e); }
  try { onArmorHit(api, pid); } catch(e) { reportErrorToOwner(e); }
  if (scaled !== undefined) return scaled;
};

/**
 * A player died. **Dying is a way out now**, and it is the same way as the shop button.
 *
 * `teleportToSpawn` is that way: it moves the player to the lobby and forgets the dungeon
 * in the same call, which is what stops the generator — the tick reads `playerDungeons`, so
 * dropping the record ends the scan, the queue and the copies for that player, and the mobs
 * of the dungeon are killed on the way out. Dying and buying "Teleport to spawn" lead to the
 * same place, through the same function, so they cannot drift apart.
 *
 * What comes back is **the position**, never `true`: `true` means "I handle the teleport
 * myself", and nothing here would move the player — they would respawn where they died.
 *
 * A player who is not in a dungeon is left to the game.
 */
onRespawnRequest = (playerId) => {
  // Not in a dungeon: the game's own respawn is the right one, and taking it over would
  // teleport a lobby player into the lobby for nothing.
  if (!service().inDungeon(playerId)) return false;
  stopLobbyCountdown(playerId);
  service().teleportToSpawn(playerId);
  try { spawnMode.set(String(playerId), true); } catch(e) { reportErrorToOwner(e); }
  try { if (typeof api.setPlayerGamemode === "function") api.setPlayerGamemode(playerId, SPAWN_GAMEMODE); } catch(e) { reportErrorToOwner(e); }
  try { applyBlessingOptions(playerId, baseClientOptions()); } catch(e) { reportErrorToOwner(e); }
  api.setClientOption(playerId, "middleTextUpper", "");
  endRun(playerId, [cStr("You died — run lost, permanent stay", MSG_COLORS.gray)]);
  try { api.setTotalAura(playerId, 0); } catch (error) { try { api.log(`[Dungeon] the aura of ${playerId} could not be reset: ${error && error.message ? error.message : error}`); } catch(e) { reportErrorToOwner(e); } }
  blessings().forget(accountKeyOf(playerId));
  blessings().setPermanent(accountKeyOf(playerId), loadPermanent(playerId));
  try { applyBlessingOptions(playerId, baseClientOptions()); } catch(e) { reportErrorToOwner(e); }
  try { forgetCombatFx(playerId); } catch(e) { reportErrorToOwner(e); }
  try { forgetWeaponAbility(playerId); } catch(e) { reportErrorToOwner(e); }
  showPoints(playerId, 0);
  refreshBlessingTiles(playerId);
  closeShop(playerId);
  api.sendMessage(playerId, [cStr("You died", MSG_COLORS.red)])
  return LOBBY_POSITION;
};

// ----------------------------------------------------------- crate lock — prevent stealing (only roller can open, no exceptions) --
onPlayerAttemptOpenChest = (playerId, x, y, z, isMoonstoneChest, isIronChest) => {
  if (isMoonstoneChest) return;
  try {
    if (crateIsOwnedByOther(api, [x, y, z], playerId)) {
      let data = null;
      try { data = api.getBlockData(x, y, z); } catch(e) { reportErrorToOwner(e); }
      let ownerDisplay = data && (data.crateOwnerName || data.crateOwnerId) ? (data.crateOwnerName || data.crateOwnerId) : "another player";
      try { const n = api.getEntityName ? api.getEntityName(data.crateOwnerId) : null; if (n) ownerDisplay = n; } catch(e) { reportErrorToOwner(e); }
      api.sendMessage(playerId, [cStr(`This crate belongs to ${ownerDisplay}`, MSG_COLORS.red)]);
      return "preventOpen";
    }
  } catch(e) { reportErrorToOwner(e); }
};

// ----------------------------------------------------------- crate — global arrow API for code blocks --
// Exposed as arrow functions so a Bloxd code block can call them: `a=()=>{}` pattern required.
// `generateChest` is the entry point a code block calls: `generateChest(playerId, chestPos, rarity)`
//
var CRATE_KEYS_GLOBAL = CRATE_KEYS;
var AIR_CHANCE_GLOBAL = AIR_CHANCE;
var LOOT_TABLE_GLOBAL = LOOT_TABLE;

// keep raw data also on globalThis for inspection / code-block access if needed
globalThis.CRATE_KEYS = CRATE_KEYS;
globalThis.AIR_CHANCE = AIR_CHANCE;
globalThis.LOOT_TABLE = LOOT_TABLE;

getWeightedRandomItem = (rarity) => crateGetWeightedRandomItem(rarity);
hasKey = (playerId, rarity) => crateHasKey(api, playerId, rarity);
consumeKey = (playerId, rarity) => crateConsumeKey(api, playerId, rarity);
// Safe chest empty — works even on overfilled chest (36 slots, chunked 6/tick avoids Argument too large)
emptyChest = (...args) => {
  try {
    let chestPos = null;
    if (args.length === 1) chestPos = args[0];
    else if (args.length === 2 && Array.isArray(args[1])) chestPos = args[1];
    else if (args.length === 3 && Number.isFinite(args[0])) chestPos = [args[0], args[1], args[2]];
    else chestPos = args[0];
    if (!chestPos) return false;
    try { return crateClearChunked(api, chestPos, () => {}); } catch(e) { reportErrorToOwner(e); }
    try { crateClearChest(api, chestPos); return true; } catch (_) { return false; }
  } catch (_) { return false; }
};
clearChest = emptyChest;
viderCoffre = emptyChest;
// main entry: must be arrow for code-block reachability — lowers chest by 1 on open (more space, no misclick roll vs reopen)
generateChest = (playerId, chestPos, rarity) => {
  const result = crateGenerateChest(api, playerId, chestPos, rarity);
  if (result) {
    try {
      const newly = ranks().recordCrate(playerId, rarity);
      if (newly && newly.length) handleRankUnlocks(playerId, newly);
    } catch(e) { reportErrorToOwner(e); }
    try {
      const col = CRATE_COLOR[rarity] || "#FFFFFF";
      const eff = (Array.isArray(result) && result.length >= 3) ? result : chestPos;
      const p = Array.isArray(eff) ? eff : [eff.x, eff.y, eff.z];
      const pos = [Math.floor(p[0])+0.5, Math.floor(p[1])+1, Math.floor(p[2])+0.5];
      spawnParticles(api, pos, PRESETS.crateFountain(col, rarity), { radius: 0.4, height: 1.5 });
    } catch(e) { reportErrorToOwner(e); }
  }
  return !!result;
};
// alias often used in examples
openCrate = generateChest;

// Kept for the reports: the level table is a public part of the world code.
// The ladder, for the game side to read. No layer: a dungeon's height is drawn per
// entry, so the only place that knows it is the dungeon itself.
globalThis.DUNGEON_LEVELS = DIFFICULTIES.map((entry) => ({ id: entry.id, label: entry.label }));

// Crate 16s protection: test every second if owner is >6 blocks away, then clear
scheduleInterval(() => {
  try { crateTick(api); } catch(e) { reportErrorToOwner(e); }
}, 20);

// Spawn peacefulAdventure enforcement: every second
scheduleInterval(() => {
  try { tickSpawnCheck(); } catch(e) { reportErrorToOwner(e); }
}, 20);

// Chest clear queue (Argument too large guard): 6 slots per tick for extremely full chests
scheduleInterval(() => {
  try { crateTickClear(api); } catch(e) { reportErrorToOwner(e); }
}, 1);

// The shop is registered once at load; `onPlayerJoin` repeats it for the first player.
registerShopItems();
