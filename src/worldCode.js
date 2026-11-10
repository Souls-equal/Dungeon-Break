/*
 * Dungeon Break — lobby difficulty picker
 * Source entry point. Build the copyable, compact script with `npm run build`.
 * Player-facing messages are intentionally in English.
 */

import {
  setInterval as scheduleInterval,
  setTimeout as scheduleTimeout,
  step as stepScheduler,
} from "./utils/scheduler.js";
import { createDungeonService } from "./dungeon/service.js";

const LOBBY_CONFIG = {
  countdownSeconds: 10,
  ticksPerSecond: 20,
  padSwitchGraceTicks: 2,
  // Block names are compared exactly with Bloxd's onBlockStandStart callback.
  // Keep each pad's top surface made from one of these Concrete blocks.
  difficultyByBlock: {
    "Lime Concrete": "Very Easy",
    "Light Blue Concrete": "Easy",
    "Yellow Concrete": "Medium",
    "Orange Concrete": "Normal",
    "Red Concrete": "Hard",
    "Purple Concrete": "Insane",
    "Gray Concrete": "Ultra Insane",
    "Grey Concrete": "Ultra Insane",
    "Black Concrete": "Hell",
  },
};

// The dungeon service owns one dungeon per difficulty, shared by every player
// inside it: two players walking into the same branch must see the same walls.
// It is created once, at load, and never rebuilt.
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

// Active countdowns are per-player, so players can pick independently.
// Each entry tracks the pads currently supporting the player, so moving
// between same-difficulty Concrete blocks does not restart the countdown.
const lobbyCountdowns = {};

function lobbyPadKey(x, y, z) {
  return `${x},${y},${z}`;
}

function showCountdown(playerId, difficulty, secondsLeft) {
  api.setClientOption(
    playerId,
    "middleTextUpper",
    `${difficulty} — starting in ${secondsLeft}...`,
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
  onLobbyCountdownComplete(playerId, countdown.difficulty);
}

function deferLobbyCountdownCancellation(playerId, countdown) {
  if (countdown.cancelTimer) return;

  countdown.cancelTimer = scheduleTimeout(() => {
    countdown.cancelTimer = null;
    if (lobbyCountdowns[playerId] !== countdown || countdown.activePadCount !== 0) return;

    // A simultaneous final-second tick completes the selection instead of
    // letting a stale stand-stop callback cancel it just before the build starts.
    if (countdown.secondsLeft <= 1) {
      completeLobbyCountdown(playerId, countdown);
      return;
    }

    cancelLobbyCountdown(playerId);
  }, LOBBY_CONFIG.padSwitchGraceTicks);
}

function startLobbyCountdown(playerId, x, y, z, blockName) {
  const difficulty = LOBBY_CONFIG.difficultyByBlock[blockName];
  if (!difficulty) return;

  const padKey = lobbyPadKey(x, y, z);
  const current = lobbyCountdowns[playerId];

  if (current && current.difficulty === difficulty) {
    // Preserve the timer while the player crosses pads of this difficulty.
    if (current.cancelTimer) {
      current.cancelTimer.stop();
      current.cancelTimer = null;
    }
    if (!current.activePads[padKey]) {
      current.activePads[padKey] = true;
      current.activePadCount += 1;
    }
    return;
  }
  if (current) stopLobbyCountdown(playerId);

  const countdown = {
    difficulty,
    activePads: { [padKey]: true },
    activePadCount: 1,
    secondsLeft: LOBBY_CONFIG.countdownSeconds,
    completed: false,
    timer: null,
    cancelTimer: null,
  };
  lobbyCountdowns[playerId] = countdown;

  api.sendMessage(
    playerId,
    `${difficulty} selected. Starting in ${LOBBY_CONFIG.countdownSeconds} seconds — step off the pad to cancel.`,
  );
  showCountdown(playerId, difficulty, countdown.secondsLeft);

  countdown.timer = scheduleInterval(() => {
    // Ignore a stale callback if this player has since selected another pad.
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

// ---------------------------------------------------------------- debug --
//
// Everything below is for bug reports: a player types `/dbg` in chat and gets the
// seed, the cell, the room or corridor they are standing in, and the doorways
// around them — the numbers a screenshot cannot carry. Two rules it must keep:
//
//   - **nothing here touches the tick path.** Reports are built when asked for;
//     a world that prints per tick is a world that stutters.
//   - **no chat spam.** A full report is allowed in a dungeon, where a player is
//     alone with their own build; in the lobby it is one line. The report itself
//     never broadcasts: it goes to the player who asked, and to nobody else.
const DEBUG_COMMANDS = {
  // The full report: seed, cell, room, doorways, nearest corridor.
  info: ["debug", "dbg", "info", "here", "where"],
  // The whole dungeon in four lines: rooms, links, loops, build states, refusals.
  dungeon: ["dungeon", "dgn"],
  // Just the seed, in bold enough a line to read off a screenshot.
  seed: ["seed"],
  // Where the player is, in one line — the one to send when the report is long.
  short: ["short", "line"],
  // Toggles the one-line HUD at the top of the screen. On by default? No: a debug
  // overlay a player did not ask for is a bug of its own.
  hud: ["hud", "overlay"],
  // The rooms around the player: distance, build state, free doorways.
  nearby: ["near", "nearby", "around", "rooms"],
  // The chunk record the player is standing in, read back from the block that
  // holds it. The question a player actually asks after a crash — "did my dungeon
  // survive" — is answered by reading the block, not by trusting a counter.
  chunk: ["chunk", "chunks", "save"],
  // What the engine is holding: the counters that must stay bounded. This is the
  // report for `InternalError: out of memory`, which is a structure that grows,
  // never a single big allocation.
  mem: ["mem", "memory", "leak"],
};

/**
 * How often the HUD line is refreshed, in ticks.
 *
 * Twenty ticks is one second. The line is a *label* on a picture, not a tracker:
 * a player walks two cells before noticing it, and rebuilding it every tick would
 * put a full dungeon scan on the tick path for nobody's benefit. One second is
 * also the fastest a human can read a coordinate.
 */
const DEBUG_HUD_REFRESH_TICKS = 20;

/** Last line sent per player, so an unchanged HUD costs nothing. */
const debugHudLines = {};
const debugHudEnabled = {};
let debugHudTicks = 0;

/**
 * Refreshes the HUD line of every player in a dungeon.
 *
 * Called from `tick`, but does work only every `DEBUG_HUD_REFRESH_TICKS`, and only
 * for players who asked for it — the command is opt-in, so a normal game pays one
 * counter increment per tick and nothing else.
 */
function refreshDebugHud(force = false) {
  debugHudTicks += 1;
  if (!force && debugHudTicks % DEBUG_HUD_REFRESH_TICKS !== 0) return;
  for (const playerId of api.getPlayerIds()) {
    if (!debugHudEnabled[playerId]) continue;
    const line = service().hudLineOf(playerId);
    if (!line) {
      // Outside a dungeon the line is cleared once, then left alone.
      if (debugHudLines[playerId] !== "") {
        debugHudLines[playerId] = "";
        debugSay(playerId, "middleTextTop", "");
      }
      continue;
    }
    if (debugHudLines[playerId] === line) continue;
    debugHudLines[playerId] = line;
    debugSay(playerId, "middleTextTop", line);
  }
}

/** What `command` means, if anything: `{ verb, argument }`, or null. */
function parseDebugCommand(raw) {
  const text = String(raw === undefined || raw === null ? "" : raw).trim();
  if (text.length === 0) return null;
  const parts = text.split(/\s+/);
  let head = parts[0].toLowerCase();
  // Both forms: `/dbg` arrives as "dbg" or "/dbg" depending on the client, and
  // a player who types the full word should not have to know which.
  if (head.startsWith("/")) head = head.slice(1);
  let verb = null;
  for (const [candidate, aliases] of Object.entries(DEBUG_COMMANDS)) {
    if (aliases.includes(head)) { verb = candidate; break; }
  }
  if (!verb) {
    // `/debug dungeon medium` — the word `debug` is the namespace, the next word
    // is the verb.
    if (head !== "debug" && head !== "dbg") return null;
    const next = (parts[1] || "info").toLowerCase();
    for (const [candidate, aliases] of Object.entries(DEBUG_COMMANDS)) {
      if (aliases.includes(next)) { verb = candidate; break; }
    }
    if (!verb) verb = "info";
    return { verb, argument: parts.slice(2).join(" ") || null };
  }
  // `/dbg` on its own is the full report.
  const rest = parts.slice(1).join(" ");
  return { verb, argument: rest || null };
}

/**
 * Sends one debug line, swallowing a sending failure.
 *
 * Two arguments means a client option: `debugSay(playerId, "middleTextTop", text)`
 * writes the HUD. One helper for both keeps every debug output behind the same
 * failure guard — a debug feature that throws in `tick` would be worse than none.
 */
function debugSay(playerId, messageOrOption, value) {
  try {
    if (value !== undefined) api.setClientOption(playerId, messageOrOption, value);
    else api.sendMessage(playerId, messageOrOption);
  } catch (_) {
    // A debug command must never break the tick that carries it.
  }
}

/** Sends every line in order, one message each. */
function debugSayAll(playerId, lines) {
  for (let index = 0; index < lines.length; index += 1) debugSay(playerId, lines[index]);
}

/**
 * `/dbg chunk` — the records around the player, read back from their blocks.
 *
 * The anchor of a chunk is a corner cell, so a player in the middle of a chunk may
 * stand up to a chunk away from it; reporting the chunks **around** the player is
 * what makes the answer useful. The record itself is read from the block, never
 * reconstructed from memory: a counter saying "saved" proves nothing if the data
 * was cleared under it.
 */
function debugChunk(playerId, argument) {
  const radius = argument && /^\d+$/.test(argument.trim()) ? Math.min(3, Number(argument.trim())) : 1;
  const report = service().debugChunkReport(playerId, radius);
  if (!report) {
    debugSay(playerId, "[dbg] you are not in a dungeon — step on a pad first");
    return;
  }
  const lines = [];
  lines.push(`[dbg] chunks saved ${report.chunksSaved} · failed ${report.chunkSaveFailures} · here ${report.cell.x},${report.cell.z} (chunk ${report.chunk.x},${report.chunk.z})`);
  for (const entry of report.records) {
    const at = `chunk ${entry.chunkX},${entry.chunkZ}`;
    if (!entry.read.ok) {
      lines.push(`[dbg] ${at}: ${entry.read.code}${entry.read.block ? ` (block ${entry.read.block})` : ""}`);
      continue;
    }
    const record = entry.read.record;
    const drawn = record.progress.filter((progress) => progress.state === "built").length;
    lines.push(`[dbg] ${at}: ${record.plans.length} plans, ${drawn}/${record.progress.length} built · seed ${record.seed} · tick ${record.tick}`);
    for (const progress of record.progress.slice(0, 3)) {
      lines.push(`[dbg]   ${progress.kind} ${progress.id}: ${progress.state}${progress.cursor === null ? "" : ` @${progress.cursor}`}`);
    }
    if (record.progress.length > 3) lines.push(`[dbg]   and ${record.progress.length - 3} more`);
  }
  debugSayAll(playerId, lines);
}

/**
 * `/dbg mem` — what the engine is holding, dungeon by dungeon.
 *
 * `InternalError: out of memory` in Bloxd is not one large allocation; it is a
 * structure that keeps growing. So this prints the numbers that must stay
 * bounded, and the two that say whether the room cap is doing its job. A dungeon
 * whose `rooms` stops at its `cap` and whose heap keeps climbing is a different
 * bug from one whose `rooms` never stops climbing, and this line is what tells
 * them apart.
 */
function debugMem(playerId) {
  const rows = service().memoryReport();
  if (rows.length === 0) {
    debugSay(playerId, "[dbg] no dungeon exists yet — step on a pad first");
    return;
  }
  const lines = [];
  for (const row of rows) {
    lines.push(`[dbg] ${row.difficulty}: rooms ${row.rooms}/${row.roomCap === null ? "∞" : row.roomCap} · capped ${row.capped} · openings ${row.openings} · links ${row.connections}`);
    lines.push(`[dbg]   unfinished ${row.unfinished} · built ${row.builtRooms} · queued ${row.queued} · chunks ${row.chunks} · records ${row.chunkRecords}`);
  }
  debugSayAll(playerId, lines);
}

function runDebugCommand(playerId, verb, argument) {
  if (verb === "seed") {
    const report = service().debugReport(playerId);
    debugSay(playerId, report
      ? `[dbg] seed ${report.seed} · ${report.difficulty} · dungeon ${report.dungeonId}`
      : "[dbg] you are not in a dungeon — step on a pad first");
    return;
  }
  if (verb === "dungeon") {
    const lines = service().debugDungeonLines(playerId, argument || null);
    debugSayAll(playerId, lines.length > 0
      ? lines
      : ["[dbg] no dungeon by that name is built — /dbg dungeon easy|medium|hard|..."]);
    return;
  }
  if (verb === "nearby") {
    const limit = argument && /^\d+$/.test(argument.trim()) ? Number(argument.trim()) : undefined;
    const lines = service().debugNearbyLines(playerId, limit === undefined ? {} : { limit });
    debugSayAll(playerId, lines.length > 0
      ? lines
      : ["[dbg] you are not in a dungeon — step on a pad first"]);
    return;
  }
  if (verb === "chunk") {
    debugChunk(playerId, argument);
    return;
  }
  if (verb === "mem") {
    debugMem(playerId);
    return;
  }
  if (verb === "hud") {
    const enabled = !debugHudEnabled[playerId];
    debugHudEnabled[playerId] = enabled;
    debugHudLines[playerId] = "";
    debugSay(playerId, "middleTextTop", "");
    debugSay(playerId, enabled
      ? "[dbg] HUD on: the seed and the cell are now written at the top of the screen, so a screenshot carries them"
      : "[dbg] HUD off");
    // Forced: a player who turns the HUD on must see it immediately, not up to a
    // second later on a line they just asked for.
    if (enabled) refreshDebugHud(true);
    return;
  }
  const lines = service().debugLines(playerId);
  if (lines.length === 0) {
    debugSay(playerId, "[dbg] you are not in a dungeon — step on a pad first");
    return;
  }
  // `short` returns everything the full report says in one line; the full report
  // is what gets screenshotted, so it is sent last and stays on screen.
  if (verb === "short") debugSay(playerId, lines[1] || lines[0]);
  else debugSayAll(playerId, lines);
}

// Commands arrive through `playerCommand`, which Bloxd calls for a message
// starting with `/`. Returning `true` marks it handled: the game must not also
// try to run `/dbg` as one of its own commands.
playerCommand = (playerId, command) => {
  const parsed = parseDebugCommand(command);
  if (!parsed) return false;
  try {
    runDebugCommand(playerId, parsed.verb, parsed.argument);
  } catch (error) {
    // A debug command that throws must say so rather than die silently: the
    // whole point is that the player can report what happened.
    debugSay(playerId, `[dbg] report failed: ${error && error.message ? error.message : "unknown error"}`);
  }
  return true;
};

function onLobbyCountdownComplete(playerId, difficulty) {
  // The service reads the landing cell, teleports to the middle of it, waits for
  // the chunks, lays the pad and builds the entrance — in that order. Nothing is
  // announced before the floor exists.
  service().enterDifficulty(playerId, difficulty);
}

onBlockStandStart = (playerId, x, y, z, blockName) => {
  startLobbyCountdown(playerId, x, y, z, blockName);
};

onBlockStandStop = (playerId, x, y, z, blockName) => {
  // Keep the countdown while any same-difficulty pad is still supporting the
  // player. Bloxd starts the new block callback before stopping the old one.
  if (!LOBBY_CONFIG.difficultyByBlock[blockName]) return;

  const countdown = lobbyCountdowns[playerId];
  if (!countdown || countdown.difficulty !== LOBBY_CONFIG.difficultyByBlock[blockName]) return;

  const padKey = lobbyPadKey(x, y, z);
  if (!countdown.activePads[padKey]) return;

  delete countdown.activePads[padKey];
  countdown.activePadCount -= 1;
  if (countdown.activePadCount === 0) deferLobbyCountdownCancellation(playerId, countdown);
};

tick = () => {
  stepScheduler();
  refreshDebugHud();
  // One cycle for every dungeon, from the world's own callback: the engine never
  // keeps a timer of its own.
  service().tick();
};

onPlayerLeave = (playerId) => {
  stopLobbyCountdown(playerId);
  // The HUD is per-player state: keeping it would leak one entry per player who
  // ever played, and a rejoining player has not asked for it again.
  delete debugHudEnabled[playerId];
  delete debugHudLines[playerId];
  // The dungeon keeps existing — other players may be inside it — but this
  // player is no longer tracked in it, and every exit goes through the lobby.
  service().leave(playerId);
};

onPlayerJoin = (playerId) => {
  api.setPosition(playerId, [10, 21, 10]);
  api.sendMessage(
    playerId,
    "Welcome to Dungeon Break! Step on a colored Concrete pad to choose your difficulty.",
  );
};
