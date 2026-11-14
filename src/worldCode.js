/*
 * Dungeon Break — lobby, pads and dungeon entry.
 *
 * The world code is deliberately thin. It owns three things and nothing else:
 *
 *   - the lobby countdown, which is unchanged from the previous version because
 *     it worked: step on a pad, wait ten seconds, step off to cancel;
 *   - the pads, both in the lobby and inside a dungeon, which all go through the
 *     same block-to-difficulty table;
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
import { DIFFICULTIES, difficultyForPadBlock } from "./dungeon/config.js";
import { createDungeonService } from "./dungeon/service.js";

const LOBBY_CONFIG = {
  countdownSeconds: 10,
  ticksPerSecond: 20,
  // Bloxd starts the new block callback before stopping the old one, so a player
  // crossing two pads of the same colour would otherwise restart the countdown.
  padSwitchGraceTicks: 2,
};

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
  api.setClientOption(
    playerId,
    "middleTextUpper",
    `${difficulty.label} — starting in ${secondsLeft}...`,
  );
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
    api.sendMessage(playerId, "Countdown cancelled. Step on a difficulty pad to try again.");
  }
}

function completeLobbyCountdown(playerId, countdown) {
  if (lobbyCountdowns[playerId] !== countdown) return;
  countdown.completed = true;
  stopLobbyCountdown(playerId);
  service().enterDifficulty(playerId, countdown.difficulty);
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

  api.sendMessage(
    playerId,
    `${difficulty.label} selected. Starting in ${LOBBY_CONFIG.countdownSeconds} seconds — step off the pad to cancel.`,
  );
  showCountdown(playerId, difficulty, countdown.secondsLeft);

  countdown.timer = scheduleInterval(() => {
    if (lobbyCountdowns[playerId] !== countdown) {
      countdown.timer.stop();
      return;
    }
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
    service().usePad(playerId);
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
  const report = service().reportOf(playerId);
  if (!report) {
    debugSay(playerId, "[dbg] you are not in a dungeon — step on a pad first");
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
    `[dbg] room #${report.entrance.templateIndex === null ? "-" : report.entrance.templateIndex}`
      + ` · ${report.entrance.templateSource || "unreadable"}`
      + ` · floor local y ${report.entrance.floorLocalY === null ? "unknown" : report.entrance.floorLocalY}`
      + ` · failed ${report.entrance.failures}`,
  ]);
}

function parseDebugCommand(raw) {
  const text = String(raw === undefined || raw === null ? "" : raw).trim();
  if (text.length === 0) return null;
  const parts = text.split(/\s+/);
  let head = parts[0].toLowerCase();
  if (head.startsWith("/")) head = head.slice(1);
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
  const verb = parseDebugCommand(command);
  if (!verb) return false;
  try {
    runDebugCommand(playerId, verb);
  } catch (error) {
    debugSay(playerId, `[dbg] report failed: ${error && error.message ? error.message : "unknown error"}`);
  }
  return true;
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
};

onPlayerJoin = (playerId) => {
  api.setPosition(playerId, [10, 21, 10]);
  const names = DIFFICULTIES.filter((entry) => entry.fromLobby).map((entry) => entry.label).join(", ");
  api.sendMessage(
    playerId,
    `Welcome to Dungeon Break! Step on a colored Concrete pad to choose your difficulty (${names}).`,
  );
};

onPlayerLeave = (playerId) => {
  stopLobbyCountdown(playerId);
  service().leave(playerId);
};

onRespawnRequest = (playerId) => {
  // Dying is not a way out of a level: the player comes back at the entrance of
  // the level they were in, which is a floor that has been verified.
  const dungeon = service().dungeonOf(playerId);
  if (!dungeon) return false;
  service().enterDifficulty(playerId, dungeon.difficulty);
  return true;
};

// Kept for the reports: the level table is a public part of the world code.
// The ladder, for the game side to read. No layer: a dungeon's height is drawn per
// entry, so the only place that knows it is the dungeon itself.
globalThis.DUNGEON_LEVELS = DIFFICULTIES.map((entry) => ({ id: entry.id, label: entry.label }));
