/**
 * Tutorial ~90s — 3 steps, native groundArrowPath.
 * 1) Join → Wooden Key + red arrow to crate [31.5,20,-0.5]
 * 2) generateChest() → "collect the loot"
 * 3) Green arrow to dungeon [2.5,20,-7.5]
 * Flag hasDoneTutorial via api.get/setPlayerDbValue.
 */
export const TUTORIAL_DB_KEY = "dungeonBreak.tutorial.v1";
const TUTORIAL_STEP_KEY = "dungeonBreak.tutorial.step";
export const TUTORIAL_STEPS = ["crate", "loot", "dungeon", "done"];

export const TUTORIAL_CRATE_TARGET = [31.5, 20, -0.5];
export const TUTORIAL_DUNGEON_TARGET = [2.5, 20, -7.5];
export const TUTORIAL_CRATE_POS = [31, 20, -1];
export const TUTORIAL_PORTAL_POS = [2, 21, -8];

export function hasDoneTutorial(api, playerId) {
  try {
    const v = api.getPlayerDbValue(playerId, TUTORIAL_DB_KEY);
    return v === true || v === "1" || v === 1 || v === "done";
  } catch { return false; }
}
export function markDone(api, playerId) {
  try { api.setPlayerDbValue(playerId, TUTORIAL_DB_KEY, true); api.setPlayerDbValue(playerId, TUTORIAL_STEP_KEY, "done"); } catch {}
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

export const TUTORIAL_MESSAGES = {
  join: "Tutorial: Use your key on the crate! Follow the red arrow.",
  crateOpened: "Great! Collect the loot inside the crate.",
  toDungeon: "Now find Keys inside the dungeon! Follow the green arrow.",
  final: "Well done!",
};

export function onTutorialJoin(api, playerId) {
  if (hasDoneTutorial(api, playerId)) return false;
  try { api.setPlayerDbValue(playerId, TUTORIAL_DB_KEY, "started"); api.setPlayerDbValue(playerId, TUTORIAL_STEP_KEY, "crate"); } catch {}
  try {
    if (typeof api.giveItem === "function") api.giveItem(playerId, "Wooden Key", 1, { customDisplayName: "Tutorial Key", customDescription: "Your first key.\nUsed in the tutorial." });
  } catch {}
  setArrow(api, playerId, "red", TUTORIAL_CRATE_TARGET);
  try { api.sendMessage(playerId, [{ str: TUTORIAL_MESSAGES.join, style: { color: "#ff5555" } }]); } catch {}
  return true;
}

export function onTutorialCrateOpened(api, playerId) {
  if (hasDoneTutorial(api, playerId)) return;
  const step = getStep(api, playerId);
  if (step !== "crate") return;
  advanceStep(api, playerId, "loot");
  try { api.sendMessage(playerId, [{ str: TUTORIAL_MESSAGES.crateOpened, style: { color: "#FFFF55" } }]); } catch {}
  setArrow(api, playerId, "#69EA5E", TUTORIAL_DUNGEON_TARGET);
  try { api.sendMessage(playerId, [{ str: TUTORIAL_MESSAGES.toDungeon, style: { color: "#69EA5E" } }]); } catch {}
  advanceStep(api, playerId, "dungeon");
}

export function onTutorialDungeonEntered(api, playerId) {
  if (hasDoneTutorial(api, playerId)) return;
  const step = getStep(api, playerId);
  if (step !== "dungeon" && step !== "loot") return;
  markDone(api, playerId);
  clearArrow(api, playerId);
  try { api.sendMessage(playerId, [{ str: TUTORIAL_MESSAGES.final, style: { color: "#FFD700" } }]); } catch {}
}

export function buildTutorialConfig(portalPos, cratePos) {
  return { portalPos, cratePos, crateTarget: TUTORIAL_CRATE_TARGET, dungeonTarget: TUTORIAL_DUNGEON_TARGET };
}
export const TUTORIAL_CONFIG = buildTutorialConfig(TUTORIAL_PORTAL_POS, TUTORIAL_CRATE_POS);
export function tickTutorialArrows() {}
export function onTutorialComplete(api, playerId) { markDone(api, playerId); }
export function onTutorialPortalUsed() {}
