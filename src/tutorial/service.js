/**
 * Tutorial ~90s — 3 steps, native groundArrowPath.
 * 1) Join → Wooden Key + red arrow to crate [31.5,20,-0.5] + highlight hotbar slot
 * 2) generateChest() → "collect the loot" + remove highlight
 * 3) Green arrow to dungeon [21.5,20,-24.5]
 * Flag hasDoneTutorial via api.get/setPlayerDbValue with t:0/t:1 (persisted).
 */
import { setTimeout as scheduleTimeout } from "../utils/scheduler.js";
import { track } from "../utils/analytics.js";
export const TUTORIAL_DB_KEY = "t";
const LEGACY_TUTORIAL_KEY = "dungeonBreak.tutorial.v1";
const TUTORIAL_STEP_KEY = "dungeonBreak.tutorial.step";
export const TUTORIAL_STEPS = ["crate", "loot", "dungeon", "done"];

export const TUTORIAL_CRATE_TARGET = [31.5, 20, -0.5];
export const TUTORIAL_DUNGEON_TARGET = [21.5, 20, -24.5];
export const TUTORIAL_CRATE_POS = [31, 20, -1];
export const TUTORIAL_PORTAL_POS = [2, 21, -8];

export function hasDoneTutorial(api, playerId) {
  try {
    const v = api.getPlayerDbValue(playerId, TUTORIAL_DB_KEY);
    if (v === 1 || v === "1" || v === true || v === "true") return true;
    // legacy compat: dungeonBreak.tutorial.v1 === true/"1"/"done"
    const legacy = api.getPlayerDbValue(playerId, LEGACY_TUTORIAL_KEY);
    if (legacy === true || legacy === "1" || legacy === 1 || legacy === "done" || legacy === "true") return true;
    // also step done
    const step = api.getPlayerDbValue(playerId, TUTORIAL_STEP_KEY);
    if (step === "done") return true;
  } catch { return false; }
  return false;
}
export function markDone(api, playerId) {
  try {
    api.setPlayerDbValue(playerId, TUTORIAL_DB_KEY, 1);
    api.setPlayerDbValue(playerId, LEGACY_TUTORIAL_KEY, 1);
    api.setPlayerDbValue(playerId, TUTORIAL_STEP_KEY, "done");
  } catch {}
}
export function shouldRunTutorial(api, playerId) {
  return !hasDoneTutorial(api, playerId);
}
function getStep(api, playerId) {
  try {
    const v = api.getPlayerDbValue(playerId, TUTORIAL_STEP_KEY);
    return v && TUTORIAL_STEPS.includes(v) ? v : "crate";
  } catch { return "crate"; }
}
export function advanceStep(api, playerId, step) {
  try { api.setPlayerDbValue(playerId, TUTORIAL_STEP_KEY, step); } catch {}
}
function setArrow(api, playerId, colour, target) {
  try {
    if (typeof api.setClientOption === "function") api.setClientOption(playerId, "groundArrowPath", { colour, target });
  } catch {}
}
function clearArrow(api, playerId) {
  try {
    if (typeof api.setClientOption === "function") api.setClientOption(playerId, "groundArrowPath", null);
  } catch {}
}

function findWoodenKeyHotbarSlot(api, playerId) {
  if (!api || !playerId || typeof api.getItemSlot !== "function") return null;
  for (let i = 0; i < 10; i++) {
    try {
      const it = api.getItemSlot(playerId, i);
      if (!it || !it.name) continue;
      const n = String(it.name).toLowerCase();
      if (n.includes("wooden key")) return i;
    } catch {}
  }
  return null;
}
function findWoodenKeyAnySlot(api, playerId) {
  if (!api || !playerId || typeof api.getItemSlot !== "function") return null;
  for (let i = 0; i < 60; i++) {
    try {
      const it = api.getItemSlot(playerId, i);
      if (!it || !it.name) continue;
      const n = String(it.name).toLowerCase();
      if (n.includes("wooden key")) return i;
    } catch {}
  }
  return null;
}
export function highlightWoodenKey(api, playerId) {
  try {
    let slot = findWoodenKeyHotbarSlot(api, playerId);
    if (slot === null) {
      // pas encore en hotbar (giveItem async) → retry 1 tick
      try {
        scheduleTimeout(() => {
          try {
            const s = findWoodenKeyHotbarSlot(api, playerId);
            if (s !== null) api.setClientOption(playerId, "highlightedHotbarSlots", [s]);
          } catch {}
        }, 1);
      } catch {}
      return;
    }
    api.setClientOption(playerId, "highlightedHotbarSlots", [slot]);
  } catch {}
}
export function clearHighlight(api, playerId) {
  try { api.setClientOption(playerId, "highlightedHotbarSlots", []); } catch {}
}
export function tickTutorialHighlight(api) {
  // si le joueur a bougé la clé en hotbar pendant le step crate, on re-highlight
  try {
    const ids = typeof api.getPlayerIds === "function" ? api.getPlayerIds() : [];
    for (const pid of ids) {
      if (hasDoneTutorial(api, pid)) continue;
      const step = getStep(api, pid);
      if (step !== "crate") continue;
      let cur = null;
      try { cur = api.getClientOption ? api.getClientOption(pid, "highlightedHotbarSlots") : null; } catch {}
      const hasHighlight = Array.isArray(cur) && cur.length > 0;
      const slot = findWoodenKeyHotbarSlot(api, pid);
      if (slot !== null && !hasHighlight) {
        try { api.setClientOption(pid, "highlightedHotbarSlots", [slot]); } catch {}
      } else if (slot === null && hasHighlight) {
        const anySlot = findWoodenKeyAnySlot(api, pid);
        if (anySlot === null) {
          try { api.setClientOption(pid, "highlightedHotbarSlots", []); } catch {}
        }
      }
    }
  } catch {}
}

export const TUTORIAL_MESSAGES = {
  join: "Tutorial: Use your key on the crate! Follow the red arrow.",
  crateOpened: "Great! Collect the loot inside the crate.",
  toDungeon: "Now find Keys inside the dungeon! Follow the green arrow.",
  final: "Well done!",
};

export function onTutorialJoin(api, playerId) {
  if (hasDoneTutorial(api, playerId)) return false;
  // Resume si déjà en cours — ne pas redonner de clé (anti-dupli déco/reco)
  let existingT = null;
  let existingStep = null;
  try { existingT = api.getPlayerDbValue(playerId, TUTORIAL_DB_KEY); } catch {}
  try { existingStep = api.getPlayerDbValue(playerId, TUTORIAL_STEP_KEY); } catch {}
  const alreadyStarted = existingT === 0 || existingT === "0" || (existingStep && TUTORIAL_STEPS.includes(existingStep));
  if (alreadyStarted) {
    const step = getStep(api, playerId);
    if (step === "dungeon" || step === "loot") {
      setArrow(api, playerId, "#69EA5E", TUTORIAL_DUNGEON_TARGET);
      try { clearHighlight(api, playerId); } catch {}
    } else {
      setArrow(api, playerId, "red", TUTORIAL_CRATE_TARGET);
      try { highlightWoodenKey(api, playerId); } catch {}
    }
    return true;
  }
  // Anti-dupe: si le joueur a déjà une Wooden Key (autre source), on ne redonne pas
  try {
    if (findWoodenKeyAnySlot(api, playerId) !== null) {
      try {
        api.setPlayerDbValue(playerId, TUTORIAL_DB_KEY, 0);
        api.setPlayerDbValue(playerId, LEGACY_TUTORIAL_KEY, 0);
        const cur = getStep(api, playerId);
        if (!cur || cur === "crate") api.setPlayerDbValue(playerId, TUTORIAL_STEP_KEY, "crate");
      } catch {}
      setArrow(api, playerId, "red", TUTORIAL_CRATE_TARGET);
      try { highlightWoodenKey(api, playerId); } catch {}
      try { api.sendMessage(playerId, [{ str: TUTORIAL_MESSAGES.join, style: { color: "#ff5555" } }]); } catch {}

      return true;
    }
  } catch {}
  try {
    // t:0 = tutorial in progress, t:1 = done
    api.setPlayerDbValue(playerId, TUTORIAL_DB_KEY, 0);
    api.setPlayerDbValue(playerId, LEGACY_TUTORIAL_KEY, 0);
    api.setPlayerDbValue(playerId, TUTORIAL_STEP_KEY, "crate");
  } catch {}
  try {
    if (typeof api.giveItem === "function") api.giveItem(playerId, "Wooden Key", 1, { customDisplayName: "Tutorial Key", customDescription: "Your first key.\nUsed in the tutorial." });
  } catch {}
  setArrow(api, playerId, "red", TUTORIAL_CRATE_TARGET);
  try { highlightWoodenKey(api, playerId); } catch {}
  try { api.sendMessage(playerId, [{ str: TUTORIAL_MESSAGES.join, style: { color: "#ff5555" } }]); } catch {}

  return true;
}

export function onTutorialCrateOpened(api, playerId) {
  if (hasDoneTutorial(api, playerId)) return;
  const step = getStep(api, playerId);
  if (step !== "crate") return;
  try { clearHighlight(api, playerId); } catch {}
  advanceStep(api, playerId, "loot");
  try { api.sendMessage(playerId, [{ str: TUTORIAL_MESSAGES.crateOpened, style: { color: "#FFFF55" } }]); } catch {}
  setArrow(api, playerId, "#69EA5E", TUTORIAL_DUNGEON_TARGET);
  try { api.sendMessage(playerId, [{ str: TUTORIAL_MESSAGES.toDungeon, style: { color: "#69EA5E" } }]); } catch {}
  try { track(playerId, "tutorial", "crate_opened"); } catch(_){}
  advanceStep(api, playerId, "dungeon");
}

export function onTutorialDungeonEntered(api, playerId) {
  if (hasDoneTutorial(api, playerId)) return;
  const step = getStep(api, playerId);
  if (step !== "dungeon" && step !== "loot") return;
  markDone(api, playerId);
  clearArrow(api, playerId);
  try { clearHighlight(api, playerId); } catch {}
  try { api.sendMessage(playerId, [{ str: TUTORIAL_MESSAGES.final, style: { color: "#FFD700" } }]); } catch {}
  try { track(playerId, "tutorial", "complete"); } catch(_){}
}

export function buildTutorialConfig(portalPos, cratePos) {
  return { portalPos, cratePos, crateTarget: TUTORIAL_CRATE_TARGET, dungeonTarget: TUTORIAL_DUNGEON_TARGET };
}
export const TUTORIAL_CONFIG = buildTutorialConfig(TUTORIAL_PORTAL_POS, TUTORIAL_CRATE_POS);
export function tickTutorialArrows() {}
export function onTutorialComplete(api, playerId) { markDone(api, playerId); clearHighlight(api, playerId); }
export function onTutorialPortalUsed() {}