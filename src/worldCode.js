/*
 * Dungeon Break — lobby difficulty picker
 * Source entry point. Build the copyable, compact script with `npm run build`.
 * Player-facing messages are intentionally in English.
 */

import {
  setInterval as scheduleInterval,
  step as stepScheduler,
} from "./utils/scheduler.js";
import { generateDungeon, stopDungeonForPlayer } from "./dungeon/generator.js";

const LOBBY_CONFIG = {
  countdownSeconds: 10,
  ticksPerSecond: 20,
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
// Each entry is { difficulty, padKey, secondsLeft, timer }.
const lobbyCountdowns = {};

function lobbyPadKey(x, y, z) {
  return `${x},${y},${z}`;
}

function showCountdown(playerId, difficulty, secondsLeft) {
  api.sendTopRightHelper(
    playerId,
    "hourglass",
    `${difficulty} — starting in ${secondsLeft}...`,
    {
      duration: 1.2,
      width: 360,
      height: 70,
      color: "rgb(46, 54, 66)",
      textAndIconColor: "white",
      fontSize: "17px",
    },
  );
}

function stopLobbyCountdown(playerId) {
  const countdown = lobbyCountdowns[playerId];
  if (!countdown) return false;

  countdown.timer.stop();
  delete lobbyCountdowns[playerId];
  return true;
}

function cancelLobbyCountdown(playerId) {
  if (stopLobbyCountdown(playerId)) {
    api.sendMessage(playerId, "Countdown cancelled. Step on a difficulty pad to try again.");
  }
}

function startLobbyCountdown(playerId, x, y, z, blockName) {
  const difficulty = LOBBY_CONFIG.difficultyByBlock[blockName];
  if (!difficulty) return;

  const padKey = lobbyPadKey(x, y, z);
  const current = lobbyCountdowns[playerId];

  // Avoid restarting the countdown if the callback fires again on the same pad.
  if (current && current.padKey === padKey) return;
  if (current) stopLobbyCountdown(playerId);

  const countdown = {
    difficulty,
    padKey,
    secondsLeft: LOBBY_CONFIG.countdownSeconds,
    timer: null,
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
  // Only cancel when the player leaves the exact pad currently running their
  // countdown. Bloxd starts the new block callback before stopping the old one
  // when walking directly from one block to another.
  if (!LOBBY_CONFIG.difficultyByBlock[blockName]) return;

  const countdown = lobbyCountdowns[playerId];
  if (countdown && countdown.padKey === lobbyPadKey(x, y, z)) {
    cancelLobbyCountdown(playerId);
  }
};

tick = () => {
  stepScheduler();
};

onPlayerLeave = (playerId) => {
  stopLobbyCountdown(playerId);
  stopDungeonForPlayer(playerId);
};

onPlayerJoin = (playerId) => {
  api.sendMessage(
    playerId,
    "Welcome to Dungeon Break! Step on a colored Concrete pad to choose your difficulty.",
  );
};
