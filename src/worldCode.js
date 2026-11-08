/*
 * Dungeon Break — lobby difficulty picker
 * Paste this entire file into Bloxd World Code (F8).
 * Player-facing messages are intentionally in English.
 */

const LOBBY_CONFIG = {
  countdownSeconds: 10,
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
// Each entry is { difficulty, padKey, deadline, lastDisplayedSecond }.
const lobbyCountdowns = {};
const chosenDifficulties = {};

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

function cancelLobbyCountdown(playerId) {
  if (!lobbyCountdowns[playerId]) return;

  delete lobbyCountdowns[playerId];
  api.sendMessage(playerId, "Countdown cancelled. Step on a difficulty pad to try again.");
}

function startLobbyCountdown(playerId, x, y, z, blockName) {
  const difficulty = LOBBY_CONFIG.difficultyByBlock[blockName];
  if (!difficulty) return;

  const padKey = lobbyPadKey(x, y, z);
  const current = lobbyCountdowns[playerId];

  // Avoid restarting the countdown if the callback fires again on the same pad.
  if (current && current.padKey === padKey) return;

  chosenDifficulties[playerId] = difficulty;
  lobbyCountdowns[playerId] = {
    difficulty,
    padKey,
    deadline: api.now() + LOBBY_CONFIG.countdownSeconds * 1000,
    lastDisplayedSecond: LOBBY_CONFIG.countdownSeconds,
  };

  api.sendMessage(
    playerId,
    `${difficulty} selected. Starting in ${LOBBY_CONFIG.countdownSeconds} seconds — step off the pad to cancel.`,
  );
  showCountdown(playerId, difficulty, LOBBY_CONFIG.countdownSeconds);
}

function onLobbyCountdownComplete(playerId, difficulty) {
  // Dungeon generation and teleportation are intentionally not part of this
  // first lobby-only version. Replace this message with the dungeon start flow.
  api.sendMessage(
    playerId,
    `${difficulty} selected! Dungeon generation and teleportation will be added next.`,
  );
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

tick = (ms) => {
  const now = api.now();

  for (const playerId of Object.keys(lobbyCountdowns)) {
    const countdown = lobbyCountdowns[playerId];
    const secondsLeft = Math.ceil((countdown.deadline - now) / 1000);

    if (secondsLeft <= 0) {
      delete lobbyCountdowns[playerId];
      onLobbyCountdownComplete(playerId, countdown.difficulty);
      continue;
    }

    if (secondsLeft !== countdown.lastDisplayedSecond) {
      countdown.lastDisplayedSecond = secondsLeft;
      showCountdown(playerId, countdown.difficulty, secondsLeft);
    }
  }
};

onPlayerLeave = (playerId) => {
  delete lobbyCountdowns[playerId];
  delete chosenDifficulties[playerId];
};

onPlayerJoin = (playerId) => {
  api.sendMessage(
    playerId,
    "Welcome to Dungeon Break! Step on a colored Concrete pad to choose your difficulty.",
  );
};
