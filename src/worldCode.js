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
import { generateDungeon, stopDungeonForPlayer } from "./dungeon/generator.js";

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
  if (stopLobbyCountdown(playerId)) {
    api.sendMessage(playerId, "Countdown cancelled. Step on a difficulty pad to try again.");
  }
}

function deferLobbyCountdownCancellation(playerId, countdown) {
  if (countdown.cancelTimer) return;

  countdown.cancelTimer = scheduleTimeout(() => {
    countdown.cancelTimer = null;
    if (lobbyCountdowns[playerId] === countdown && countdown.activePadCount === 0) {
      cancelLobbyCountdown(playerId);
    }
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
      stopLobbyCountdown(playerId);
      onLobbyCountdownComplete(playerId, difficulty);
      return;
    }

    showCountdown(playerId, difficulty, countdown.secondsLeft);
  }, LOBBY_CONFIG.ticksPerSecond);
}

function onLobbyCountdownComplete(playerId, difficulty) {
  generateDungeon(playerId, difficulty);
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
};

onPlayerLeave = (playerId) => {
  stopLobbyCountdown(playerId);
  stopDungeonForPlayer(playerId);
};

onPlayerJoin = (playerId) => {
  api.setPosition(playerId, [10, 21, 10]);
  api.sendMessage(
    playerId,
    "Welcome to Dungeon Break! Step on a colored Concrete pad to choose your difficulty.",
  );
};
