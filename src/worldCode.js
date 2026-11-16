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
  isChestLocked as crateIsChestLocked,
} from "./crate/service.js";

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
  blessings: ["blessings", "blessing", "rolls"],
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
function applyBlessingOptions(playerId, base = {}) {
  const key = accountKeyOf(playerId);
  // Permanent (saved) and run (in memory) go into **one** accumulator: `optionsFrom` is what
  // guarantees a run's `+40 health` is added to a permanent `+5`, not written over it.
  const options = effects.optionsFrom(blessings().permanentOf(key), blessings().runOf(key), base);
  try {
    api.setClientOptions(playerId, options);
    return options;
  } catch (error) {
    try {
      api.log(`[Dungeon] blessing options could not be applied for ${playerId}: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // Nothing left to do: the next refresh tries again.
    }
    return options;
  }
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

/** Puts a timed blessing on the player, through the engine's own effect timer. */
function applyTimedEffect(playerId, blessing) {
  const effect = effects.timedEffectOf(blessing);
  if (!effect) return false;
  try {
    api.applyEffect(playerId, effect.effectName, effect.durationMs, { inbuiltLevel: effect.level });
  } catch (error) {
    try {
      api.log(`[Dungeon] the ${effect.effectName} effect could not be applied: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // The blessing is still recorded; the engine may not know this effect name.
    }
    return false;
  }
  return true;
}

/** Puts a run's lasting potion effect on the player (Thorns). */
function applyRunEffect(playerId, effect) {
  try {
    api.applyEffect(playerId, effect.effectName, null, { inbuiltLevel: effect.level });
    return true;
  } catch (error) {
    try {
      api.log(`[Dungeon] the ${effect.effectName} effect could not be applied: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // Nothing left to do.
    }
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
 * Takes off every effect the session was holding, without touching the permanent stack.
 *
 * Used when a session is dropped (a join, a leave that already ended the run) and when a run
 * ends. The engine ignores an effect it does not have, so this can be called blind — and it
 * must be, or a blessing applied in one session could follow a player into the next one.
 */
function dropSessionEffects(playerId) {
  const key = accountKeyOf(playerId);
  const run = blessings().runOf(key);
  for (const effect of effects.runEffects(run)) {
    try {
      api.removeEffect(playerId, effect.effectName);
    } catch (_) {
      // Nothing left to do: the effect may never have been applied.
    }
  }
  for (const entry of blessings().timedOf(key)) {
    const effect = effects.timedEffectOf(entry.blessing);
    if (!effect) continue;
    try {
      api.removeEffect(playerId, effect.effectName);
    } catch (_) {
      // Nothing left to do.
    }
  }
}

function endRun(playerId, reason) {
  const key = accountKeyOf(playerId);
  // **The effects go first**, while the holdings still say which ones they were.
  dropSessionEffects(playerId);
  const dropped = blessings().clearRun(key);

  const hadSomething = dropped.run.length > 0 || dropped.timed.length > 0;
  applyBlessingOptions(playerId, baseClientOptions());
  if (hadSomething) {
    try {
      api.sendMessage(playerId, reason);
    } catch (_) {
      // Nothing left to do: a message is a nicety.
    }
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

/** Shows the chosen blessing the way a result is always shown: chat, banner, card. */
function announceBlessing(playerId, blessing, rarity, pointsLeft) {
  api.sendMessage(playerId, rollMessage(blessing, rarity));
  api.sendMessage(
    playerId,
    `Blessing: ${blessing.name} — ${rarity.label} · ${categoryOf(blessing.category).label} · ${effects.scopeKeyOf(blessing)}`
      + ` · ${pointsLeft} point${pointsLeft === 1 ? "" : "s"} left`,
  );
  api.sendMessage(playerId, `> ${blessing.description}`);
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
    api.sendMessage(playerId, "No Blessing point to spend. Discover a new room: every aura level gives one.");
    return false;
  }
  // The tiles are what the player is looking at: the shop is open, and chat is not shown
  // while it is. Announcing the offer here would be writing to a screen nobody can see.
  api.sendMessage(playerId, "Three Blessings are offered. Pick one — it costs a point:");
  offer.forEach((draw, position) => api.sendMessage(playerId, offerLine(draw, position)));
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
    api.sendMessage(playerId, "That choice is no longer offered. Open the shop again.");
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
  dropSessionEffects(playerId);
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
  // Category display: id is already "Utilities" (capitalized), no translation needed
  // (translationKey classicGame:utilities does not work on category names)
}

onPlayerBoughtShopItem = (playerId, categoryKey, itemKey) => {
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
  // **Teleporting to spawn ends the run**, one of the owner's three ends. The permanent
  // stack stays; the run's blessings and the timed ones are dropped.
  endRun(playerId, "Your run is over: this run's Blessings are gone. Permanent ones stay.");
  stopLobbyCountdown(playerId);
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
};

onPlayerJoin = (playerId) => {
  // The owner's respawn rule and the aura scale travel together: they are the same call.
  // The shop is re-registered per join: an item created while nobody was online is
  // not always offered to the first player who arrives, and replacing it is free.
  registerShopItems();
  // **A join is a new run**: aura back to 0, points back to 0, no offer, no history.
  // Nothing is read from a database, because nothing was ever written to one.
  resetPlayerProgress(playerId);
  api.setPosition(playerId, LOBBY_POSITION);
  const names = DIFFICULTIES.filter((entry) => entry.fromLobby).map((entry) => entry.label).join(", ");
  api.sendMessage(
    playerId,
    `Welcome to Dungeon Break! Step on a colored Concrete pad to choose your difficulty (${names}).`,
  );
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
};

onPlayerLeave = (playerId) => {
  stopLobbyCountdown(playerId);
  try {
    api.setClientOption(playerId, "middleTextUpper", "");
  } catch (_) {}
  shopOpen.delete(playerId);
  try {
    closeShop(playerId);
  } catch (_) {}
  service().leave(playerId);
  // **Leaving ends the run** — the owner's third end — and the session's account goes with
  // it. The permanent stack was already saved when it changed, so nothing is lost that was
  // meant to be kept.
  endRun(playerId, "");
  // The **session** goes with the player, and only the session: the permanent stack was saved
  // when it changed, so a leave cannot lose it, and the next join reads it back.
  dropSessionEffects(playerId);
  blessings().forget(accountKeyOf(playerId));
  // Clear per-player shop overrides so no tiles linger for a disconnected player.
  for (const key of CHOICE_KEYS) {
    try {
      removePlayerTile(playerId, key);
    } catch (_) {}
  }
  // HUD: back to 0 even while offline — next join starts from a clean slate.
  try {
    showPoints(playerId, 0);
  } catch (_) {}
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

// Empêche tout PvP — demandé explicitement
onPlayerDamagingOtherPlayer = (attackingPlayer, damagedPlayer, damageDealt, withItem, bodyPartHit, damagerDbId, damageInfo) => {
  return "prevent";
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
  api.setClientOption(playerId, "middleTextUpper", "");
  // **Dying ends the run**: this run's Blessings and the timed ones are gone, the permanent
  // stack stays and is re-applied.
  endRun(playerId, "You died — this run's Blessings are gone. Permanent ones stay.");
  // Reset XP to 0 — same as rejoin — and clear the blessing points.
  try {
    api.setTotalAura(playerId, 0);
  } catch (error) {
    try {
      api.log(`[Dungeon] the aura of ${playerId} could not be reset: ${error && error.message ? error.message : error}`);
    } catch (_) {}
  }
  blessings().forget(accountKeyOf(playerId));
  blessings().setPermanent(accountKeyOf(playerId), loadPermanent(playerId));
  applyBlessingOptions(playerId, baseClientOptions());
  showPoints(playerId, 0);
  refreshBlessingTiles(playerId);
  closeShop(playerId);
  api.sendMessage(playerId, "You died. Back to spawn — your dungeon stopped.");
  return LOBBY_POSITION;
};

// ----------------------------------------------------------- crate lock — prevent stealing --
onPlayerAttemptOpenChest = (playerId, x, y, z, isMoonstoneChest, isIronChest) => {
  if (isMoonstoneChest) return;
  try {
    if (crateIsChestLocked(api, [x, y, z], playerId)) {
      let data = null;
      try { data = api.getBlockData(x, y, z); } catch (_) {}
      const now = (typeof api.now === "function" ? api.now() : Date.now());
      const remaining = data && data.crateLockUntil ? Math.ceil((data.crateLockUntil - now) / 1000) : 8;
      let ownerDisplay = data && (data.crateOwnerName || data.crateOwnerId) ? (data.crateOwnerName || data.crateOwnerId) : "another player";
      try { const n = api.getEntityName ? api.getEntityName(data.crateOwnerId) : null; if (n) ownerDisplay = n; } catch (_) {}
      try {
        api.sendMessage(playerId, "This crate is being used by " + ownerDisplay + " - please wait " + remaining + "s", { color: "red" });
      } catch (_) {
        try { api.sendMessage(playerId, "This crate is being used by another player - please wait " + remaining + "s"); } catch (_) {}
      }
      return "preventOpen";
    }
  } catch (_) {}
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
// main entry: must be arrow for code-block reachability
generateChest = (playerId, chestPos, rarity) => crateGenerateChest(api, playerId, chestPos, rarity);
// alias often used in examples
openCrate = generateChest;

// Kept for the reports: the level table is a public part of the world code.
// The ladder, for the game side to read. No layer: a dungeon's height is drawn per
// entry, so the only place that knows it is the dungeon itself.
globalThis.DUNGEON_LEVELS = DIFFICULTIES.map((entry) => ({ id: entry.id, label: entry.label }));

// The shop is registered once at load; `onPlayerJoin` repeats it for the first player.
registerShopItems();
