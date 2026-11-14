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
import { DIFFICULTIES, DUNGEON_CONFIG, difficultyForPadBlock } from "./dungeon/config.js";
import { LOBBY_POSITION, createDungeonService } from "./dungeon/service.js";
import { findRoomChests, isChestBlock } from "./dungeon/loot.js";

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
  chests: ["chests", "chest", "loot", "keys"],
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
  if (verb === "chests") {
    const dungeon = service().dungeonOf(playerId);
    if (!dungeon) {
      debugSay(playerId, "[dbg] you are not in a dungeon — step on a pad first");
      return;
    }
    const level = service().levelStateOf(playerId);
    const position = report.position;
    const centre = { x: Math.floor(position[0] / DUNGEON_CONFIG.chunkSize), z: Math.floor(position[2] / DUNGEON_CONFIG.chunkSize) };
    let found = 0;
    let incomplete = 0;
    const rooms = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const scan = findRoomChests(api, level, centre.x + dx, centre.z + dz);
        found += scan.chests.length;
        if (!scan.complete) incomplete += 1;
        rooms.push(`${centre.x + dx},${centre.z + dz}: ${scan.chests.length}${scan.complete ? "" : " (chunk not sent)"}`);
      }
    }
    debugSay(playerId, `[dbg] chests · ${found} in 9 rooms · ${incomplete} room(s) unreadable`);
    debugSay(playerId, `[dbg] ${rooms.join(" · ")}`);
    debugSay(playerId, "[dbg] a chest outside the scan box is not loot — see `chestBox` in config.js");
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

const SHOP_ITEMS = [
  {
    category: SHOP_CATEGORY,
    key: SPAWN_ITEM,
    item: {
      // A block name is an image the game already has, which keeps this readable in
      // every world. `api.getBlock` is not involved: nothing is placed.
      image: "Lime Concrete",
      customTitle: "Teleport to spawn",
      description: "Return to the lobby, at spawn. Stops the dungeon you are in.",
      buyButtonText: "Teleport",
      // Free, and a purchase rather than a display tile: the callback is what tells
      // the code a player asked for it.
      cost: 0,
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
}

onPlayerBoughtShopItem = (playerId, categoryKey, itemKey) => {
  if (categoryKey !== SHOP_CATEGORY || itemKey !== SPAWN_ITEM) return;
  // Teleport and forget are one call, so the tick can never see a player at spawn
  // with a dungeon: `teleportToSpawn` moves first, then drops the record.
  const wasInDungeon = service().teleportToSpawn(playerId);
  stopLobbyCountdown(playerId);
  api.setClientOption(playerId, "middleTextUpper", "");
  api.sendMessage(
    playerId,
    wasInDungeon ? "Back to spawn. Your dungeon stopped." : "Back to spawn.",
  );
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
  // The shop is re-registered per join: an item created while nobody was online is
  // not always offered to the first player who arrives, and replacing it is free.
  registerShopItems();
  api.setPosition(playerId, LOBBY_POSITION);
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
    // A death that cannot be filed must not break the tick that follows it.
    try {
      api.log(`[Dungeon] mob kill failed: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // Nothing left to do.
    }
  }
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

onRespawnRequest = (playerId) => {
  // Dying is not a way out of the dungeon, and not a way to lose it either: the player
  // comes back at the entrance of **the level they are already in**. Same rooms, same
  // cleared rooms, same landing height — a dungeon is not redrawn for a death.
  //
  // What changes is the fight: the mobs of the dungeon are killed, and the rooms around
  // the entrance are filled again. Coming back into the pack that killed you would trap
  // the player at the entrance, and a room with its mobs already dead is not a second
  // chance.
  //
  // What comes back is **the position**, not `true`: `true` means "I handle the
  // teleport myself", and the game would leave the player where they died while this code
  // never moved them. A position is the documented answer, and it is the entrance landing
  // that was verified on the way in.
  const dungeon = service().dungeonOf(playerId);
  if (!dungeon) return false;
  const spot = service().resetMobs(playerId);
  if (!spot) return false;
  api.sendMessage(playerId, "Back at the entrance — the rooms around you have been restocked.");
  return spot;
};

// Kept for the reports: the level table is a public part of the world code.
// The ladder, for the game side to read. No layer: a dungeon's height is drawn per
// entry, so the only place that knows it is the dungeon itself.
globalThis.DUNGEON_LEVELS = DIFFICULTIES.map((entry) => ({ id: entry.id, label: entry.label }));

// The shop is registered once at load; `onPlayerJoin` repeats it for the first player.
registerShopItems();
