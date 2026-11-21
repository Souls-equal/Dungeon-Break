import { spawn as spawnParticles } from "../particles/service.js";
import { PRESETS } from "../particles/config.js";

/**
 * Tutoriel jouable ~90s — rapide, visuel, 3 messages max.
 * Couloir: pad VeryEasy → coffre clé → crate Rare → craft Amethite → mob → récompense
 * Guidage par flèches directionnelles (2 types : sol + aérienne), pas de nouveau shop.
 * Flag hasDoneTutorial via api.get/setPlayerDbValue.
 */
export const TUTORIAL_DB_KEY = "dungeonBreak.tutorial.v1";
const TUTORIAL_STEP_KEY = "dungeonBreak.tutorial.step";
export const TUTORIAL_STEPS = ["portal", "chest", "crate", "craft", "kill", "done"];

export function hasDoneTutorial(api, playerId) {
  try {
    const v = api.getPlayerDbValue(playerId, TUTORIAL_DB_KEY);
    return v === true || v === "1" || v === 1 || v === "done";
  } catch { return false; }
}
export function markDone(api, playerId) {
  try { api.setPlayerDbValue(playerId, TUTORIAL_DB_KEY, true); api.setPlayerDbValue(playerId, TUTORIAL_STEP_KEY, "done"); } catch {}
}
export function startTutorial(api, playerId) {
  try { api.setPlayerDbValue(playerId, TUTORIAL_DB_KEY, "started"); api.setPlayerDbValue(playerId, TUTORIAL_STEP_KEY, "portal"); } catch {}
}
export function shouldRunTutorial(api, playerId) {
  return !hasDoneTutorial(api, playerId);
}

// Config à remplir avec tes coordonnées (blocks) — null = désactivé jusqu'à coords fournies
// portalPos: [x,y,z] du premier portail (Lime Concrete Very Easy)
// cratePos: [x,y,z] de la première crate Rare
export function buildTutorialConfig(portalPos, cratePos) {
  return {
    portalPos,
    cratePos,
    arrows: [
      { from: portalPos, to: cratePos, kind: 0 },
      { from: cratePos, to: null, kind: 1 },
    ],
  };
}

// Renseigne ici dès que tu as les coords (ou laisse null pour désactiver les flèches)
export const TUTORIAL_CONFIG = buildTutorialConfig(null, null);

export const TUTORIAL_MESSAGES = {
  welcome: "→ Suis la flèche verte → portail",
  afterPortal: "Coffre → clé → crate Rare",
  final: "Bien joué ! /dbg crafts pour crafter",
};

function getStep(api, playerId) {
  try {
    const v = api.getPlayerDbValue(playerId, TUTORIAL_STEP_KEY);
    return v && TUTORIAL_STEPS.includes(v) ? v : "portal";
  } catch { return "portal"; }
}
export function advanceStep(api, playerId, step) {
  try { api.setPlayerDbValue(playerId, TUTORIAL_STEP_KEY, step); } catch {}
}

export function tickTutorialArrows(api, tutorialConfig, playerId) {
  if (!tutorialConfig || !tutorialConfig.portalPos || !api.getPosition) return;
  const step = getStep(api, playerId);
  let target = null;
  if (step === "portal") target = tutorialConfig.portalPos;
  else if (step === "chest" || step === "crate") target = tutorialConfig.cratePos;
  if (!target) return;
  try {
    const col = "#55FF55";
    const preset = step === "portal" ? PRESETS.padRing(col) : PRESETS.entryVortex(col);
    spawnParticles(api, [target[0] + 0.5, target[1] + 0.5, target[2] + 0.5], preset, { radius: 0.5, height: 1.2 });
  } catch {}
}

export function onTutorialJoin(api, playerId, cfg) {
  if (!cfg || !cfg.portalPos) return false;
  if (hasDoneTutorial(api, playerId)) return false;
  startTutorial(api, playerId);
  try {
    api.sendMessage(playerId, [{ str: TUTORIAL_MESSAGES.welcome, style: { color: "#55FF55" } }]);
    tickTutorialArrows(api, cfg, playerId);
  } catch {}
  return true;
}
export function onTutorialPortalUsed(api, playerId) {
  advanceStep(api, playerId, "chest");
  try { api.sendMessage(playerId, [{ str: TUTORIAL_MESSAGES.afterPortal, style: { color: "#FFFF55" } }]); } catch {}
}
export function onTutorialComplete(api, playerId) {
  markDone(api, playerId);
  try { api.sendMessage(playerId, [{ str: TUTORIAL_MESSAGES.final, style: { color: "#FFD700" } }]); } catch {}
}
