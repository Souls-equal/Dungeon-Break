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
import { AURA_PER_LEVEL, MAX_AURA_LEVEL, categoryOf } from "./benediction/config.js";
import { createBenedictionService } from "./benediction/service.js";
import {
  announcementOf,
  cardFor,
  choiceTile,
  offerLine,
  oddsOfTable,
  rollMessage,
} from "./benediction/presentation.js";
import { CRATE_KEYS, AIR_CHANCE, LOOT_TABLE } from "./crate/config.js";
import {
  getWeightedRandomItem as crateGetWeightedRandomItem,
  hasKey as crateHasKey,
  consumeKey as crateConsumeKey,
  generateChest as crateGenerateChest,
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
  benedictions: ["benedictions", "benediction", "blessings", "rolls"],
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
  if (verb === "benedictions") {
    // The whole mechanic in four lines: the level the game reports, the points it pays,
    // what was spent, and the six rarities with their odds. It works outside a dungeon on
    // purpose — a level is gained anywhere.
    const level = auraLevelOf(playerId);
    const key = accountKeyOf(playerId);
    const account = benedictions().accountOf(key);
    const points = benedictions().pointsFor(key, level);
    const offer = account.offer.length > 0 ? ` · ${account.offer.length} on offer` : "";
    debugSay(playerId, `[dbg] aura level ${level}/${MAX_AURA_LEVEL} · ${points} point(s) · ${account.spent} spent${offer}`);
    debugSay(playerId, `[dbg] scale ${AURA_PER_LEVEL} aura a level · nothing is saved between sessions`);
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

const SHOP_CATEGORY = "utilities";
const SPAWN_ITEM = "Teleport to spawn";

// ----------------------------------------------------------- benedictions --
//
// A benediction is bought with a **point**, and a point is what an aura level gives. The
// shop is the whole interface: one tile to roll, one tile that says what the odds are, and
// one tile that shows the last thing this player rolled. Nothing is drawn in the world and
// nothing is written into a chunk — a benediction is a record on a player, not a block.
//
// The tile is **per player** (`createShopItemForPlayer`): a tile that says "you have 3
// points" cannot be shared, and the game's own shop would otherwise show one player's
// count to everybody.

const BENEDICTION_CATEGORY = "Benedictions";
const ROLL_ITEM = "Roll a Benediction";
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
 * The owner asked for the points to *be* a currency rather than a number in a tile's text:
 * `setCurrency` defines it for a player and puts it on the HUD, so a point is visible
 * without opening the shop. It is explicitly **not persistent** — the owner asked for
 * nothing to survive a reconnection, and the aura it is derived from is reset on join.
 */
const POINTS_CURRENCY = "Benediction Point";

/** The bookkeeping, created once for the world. In memory only, by the owner's rule. */
let benedictionService = null;

function benedictions() {
  if (!benedictionService) benedictionService = createBenedictionService({});
  return benedictionService;
}

/**
 * The key an account is held under **for this session**.
 *
 * It is the player id, because that is what a session is: there is no database read and no
 * database write, so the permanent id would buy nothing. What it does buy is the promise
 * that a reconnection starts from nothing — which is exactly the behaviour asked for.
 */
function accountKeyOf(playerId) {
  return String(playerId);
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

/**
 * What a player has, as one short line: the level and the points.
 *
 * The odds **used to be here** and are gone: the owner called the tile overloaded, and a
 * player who wants them has `/dbg benedictions`. Two numbers, one line, that is the tile.
 */
function benedictionSummary(playerId, level) {
  const points = benedictions().pointsFor(accountKeyOf(playerId), level);
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
    api.setCurrencyAmount(playerId, POINTS_CURRENCY, points, "Benediction");
  } catch (_) {
    // `setCurrency` above already carried the amount; this only keeps the subtext honest.
  }
}

/**
 * Removes this player's override of a tile, which is how a tile is taken away.
 *
 * `resetShopItemForPlayer` deletes the per-player item and does **nothing** if this player
 * has none — the documented behaviour, and the reason it can be called blind on every
 * refresh. The old code called a `deleteShopItemForPlayer` that the API does not have: the
 * call threw, the cleanup silently did nothing, and the three choice tiles stayed on screen
 * — which is exactly what the owner saw.
 */
function removePlayerTile(playerId, itemKey) {
  try {
    api.resetShopItemForPlayer(playerId, BENEDICTION_CATEGORY, itemKey);
    return true;
  } catch (error) {
    try {
      api.log(`[Dungeon] benediction tile "${itemKey}" could not be removed: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // Nothing left to do.
    }
    return false;
  }
}

/**
 * Draws this player's benediction tiles: the roll, and the offer when there is one.
 *
 * **The roll is the one tile that always exists**, so the category is never empty — the
 * shop bug the owner reported was a category being emptied. While an offer is live, three
 * `Choose` tiles join it; when the offer ends (`choose` consumed it, or it was dropped) they
 * are **deleted** with `resetShopItemForPlayer`, not hidden. Nothing else is ever touched:
 * `Last roll` is not drawn at all any more — the owner found it noise — and the roll tile's
 * description is a single line, level and points, because the odds made it unreadable.
 *
 * Called on a join, when the shop is opened, after a roll and after a choice.
 */
function refreshBenedictionTiles(playerId) {
  const key = accountKeyOf(playerId);
  const level = auraLevelOf(playerId);
  const points = benedictions().pointsFor(key, level);
  const account = benedictions().accountOf(key);
  const offer = account.offer;
  showPoints(playerId, points);

  try {
    api.createShopItemForPlayer(playerId, BENEDICTION_CATEGORY, ROLL_ITEM, offer.length > 0
      ? {
        image: "Beacon",
        customTitle: "Select one",
        description: "",
        canBuy: false,
        redDot: false,
        sortPriority: 110,
      }
      : {
        image: "Beacon",
        customTitle: "Roll a Benediction",
        description: benedictionSummary(playerId, level),
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
      api.createShopItemForPlayer(playerId, BENEDICTION_CATEGORY, itemKey, choiceTile(draw, position));
    } catch (error) {
      logShopFailure(itemKey, error);
    }
  });

  try {
    api.configureShopCategoryForPlayer(playerId, BENEDICTION_CATEGORY, {
      customTitle: offer.length > 0 ? "Select one" : "Benedictions",
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
    api.log(`[Dungeon] benediction item "${itemKey}" could not be created: ${error && error.message ? error.message : error}`);
  } catch (_) {
    // Nothing left to do.
  }
}

/** Shows the chosen benediction the way a result is always shown: chat, banner, card. */
function announceBenediction(playerId, benediction, rarity, pointsLeft) {
  api.sendMessage(playerId, rollMessage(benediction, rarity));
  api.sendMessage(
    playerId,
    `Benediction: ${benediction.name} — ${rarity.label} · ${categoryOf(benediction.category).label}`
      + ` · ${pointsLeft} point${pointsLeft === 1 ? "" : "s"} left`,
  );
  // The middle of the screen, big: the rarity is what a player reads first.
  try {
    api.queueMiddleTextUpper(playerId, [{ str: announcementOf(benediction, rarity), style: { color: rarity.textColour } }], 2500);
  } catch (_) {
    // The message and the card carry the news; a missing banner is not a lost choice.
  }
  try {
    const card = cardFor(benediction, rarity);
    api.sendTopRightHelper(playerId, card.icon, card.text, card.opts);
  } catch (_) {
    // Same: the choice happened.
  }
}

/**
 * Rolls: lays three benedictions out and **reserves** the point that will pay for the pick.
 *
 * A roll with no point is refused with a message, and a roll while an offer is open re-shows
 * that offer instead of redrawing it — otherwise a player could roll, look, and roll again
 * until the three were good.
 */
function rollBenediction(playerId) {
  const key = accountKeyOf(playerId);
  const level = auraLevelOf(playerId);
  const offer = benedictions().roll(key, level);
  if (!offer) {
    refreshBenedictionTiles(playerId);
    return false;
  }
  refreshBenedictionTiles(playerId);
  return true;
}

/**
 * Chooses one of the three: **this is the point being spent**.
 *
 * The service refuses anything that is not one of the offered benedictions — a stale tile,
 * a card clicked after the offer was consumed — so the shop can never be charged for a
 * choice that was not on screen. Then the tiles go **back to their normal state**, the point
 * on the HUD moves, and the shop is **closed**: the pick is final.
 */
function chooseBenediction(playerId, position) {
  const key = accountKeyOf(playerId);
  const level = auraLevelOf(playerId);
  const result = benedictions().choose(key, level, position);
  if (!result) {
    refreshBenedictionTiles(playerId);
    return false;
  }
  // Shop closes first — chat is invisible while it is open, so the
  // announcement must come after the close to be seen.
  refreshBenedictionTiles(playerId);
  closeShop(playerId);
  announceBenediction(playerId, result.benediction, result.rarity, result.pointsLeft);
  return true;
}

/**
 * Closes the shop, if the game can.
 *
 * `openShop(playerId, toggle)` is the documented door, and `toggle: true` on an open shop is
 * the only way to shut it. It is wrapped because a shop that stays open is a cosmetic
 * problem, while an exception thrown from a callback is not: the choice has already been
 * recorded by the time this runs.
 */
function closeShop(playerId) {
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
 * A player's benedictions, **from zero**.
 *
 * The owner asked for two things that are the same thing: the point is a currency (so it is
 * tied to the session, not to an account), and the aura is reset to 0 on a join. Both happen
 * here: the game's aura is set back to nothing, the in-memory account is dropped, the points
 * currency is shown at 0, and the tiles are drawn for a player who has chosen nothing yet.
 *
 * The side effect is the one wanted: a reconnection is a fresh run, and no database read can
 * hand back a level, a point, or an offer from the session before.
 */
function resetPlayerProgress(playerId) {
  applyClientOptions(playerId);
  try {
    api.setTotalAura(playerId, 0);
  } catch (error) {
    try {
      api.log(`[Dungeon] the aura of ${playerId} could not be reset: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // Nothing left to do.
    }
  }
  benedictions().forget(accountKeyOf(playerId));
  showPoints(playerId, 0);
  return refreshBenedictionTiles(playerId);
}

/**
 * Tells the game what this world's aura is worth: **the scale and the ceiling**.
 *
 * Two client options, both documented: `auraPerLevel` (what a level costs) and `maxAuraLevel`
 * (the highest level, `0` meaning "aura off"). They are set on every join because a client
 * option is per player and does not survive a reconnection either.
 */
function applyClientOptions(playerId) {
  // Two rules, one call: the owner's respawn (`autoRespawn`, 3 s) and the world's aura scale.
  // Everything here is a client option, so the next join re-sends the same object.
  try {
    api.setClientOptions(playerId, {
      autoRespawn: true,
      secsToRespawn: 3,
      auraPerLevel: AURA_PER_LEVEL,
      maxAuraLevel: MAX_AURA_LEVEL,
    });
  } catch (error) {
    try {
      api.log(`[Dungeon] the aura scale could not be applied: ${error && error.message ? error.message : error}`);
    } catch (_) {
      // The game's own defaults still work; the shop says what it reads.
    }
  }
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
  // Category display name — not just the id — via customTitle with translationKey.
  // Supports translationKeys as CustomTextStyling, like the button above.
  try {
    if (typeof api.configureShopCategory === "function") {
      api.configureShopCategory(SHOP_CATEGORY, {
        customTitle: [{ translationKey: "classicGame:utilities" }],
      });
    }
  } catch (_) {
    // The title is a nicety; the tile is the feature.
  }
}

onPlayerBoughtShopItem = (playerId, categoryKey, itemKey) => {
  // A benediction roll: the point is checked in the service, so a tile the game let
  // through one tick after the last roll cannot buy a second one for free.
  if (categoryKey === BENEDICTION_CATEGORY) {
    try {
      if (itemKey === ROLL_ITEM) rollBenediction(playerId);
      // A choice tile is one of three, and its key names its position in the offer: the
      // offer itself is what decides what the pick was worth, not the key.
      else {
        const position = CHOICE_KEYS.indexOf(itemKey);
        if (position >= 0) chooseBenediction(playerId, position);
      }
    } catch (error) {
      try {
        api.log(`[Dungeon] benediction failed: ${error && error.message ? error.message : error}`);
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
  if (!isOpen) return;
  try {
    refreshBenedictionTiles(playerId);
  } catch (error) {
    try {
      api.log(`[Dungeon] benediction tiles could not be refreshed: ${error && error.message ? error.message : error}`);
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
  try {
    closeShop(playerId);
  } catch (_) {}
  service().leave(playerId);
  // The account is memory, so a leave is where it is dropped: a session that ends holds
  // nothing, which is the other half of "nothing survives a reconnection".
  benedictions().forget(accountKeyOf(playerId));
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
  // Reset XP to 0 — same as rejoin — and clear the benediction points.
  try {
    api.setTotalAura(playerId, 0);
  } catch (error) {
    try {
      api.log(`[Dungeon] the aura of ${playerId} could not be reset: ${error && error.message ? error.message : error}`);
    } catch (_) {}
  }
  benedictions().forget(accountKeyOf(playerId));
  showPoints(playerId, 0);
  refreshBenedictionTiles(playerId);
  closeShop(playerId);
  api.sendMessage(playerId, "You died. Back to spawn — your dungeon stopped.");
  return LOBBY_POSITION;
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
