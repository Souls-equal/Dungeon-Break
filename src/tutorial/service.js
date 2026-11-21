import { spawn as spawnParticles } from "../particles/service.js";
import { PRESETS } from "../particles/config.js";

/**
 * Tutoriel jouable ~90s — rapide, visuel, 3 messages max.
 * Couloir: pad VeryEasy [2,21,-8] → Wood Crate [30,23,3] → craft → mob
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

// Coords fournies: Super facile [2,21,-8], Wood Crate [30,23,3]
export const TUTORIAL_CONFIG = buildTutorialConfig([2, 21, -8], [30, 23, 3]);

export const TUTORIAL_MESSAGES = {
  welcome: "→ Suis la flèche verte → portail",
  afterPortal: "Coffre → clé → crate",
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

function lerp(a, b, t) { return a + (b - a) * t; }

export function tickTutorialArrows(api, tutorialConfig, playerId) {
  if (!tutorialConfig || !tutorialConfig.portalPos) return;
  const step = getStep(api, playerId);
  let target = null;
  if (step === "portal") target = tutorialConfig.portalPos;
  else if (step === "chest" || step === "crate") target = tutorialConfig.cratePos;
  if (!target) return;
  try {
    const col = "#55FF55";
    // 2 types: 0=anneau au sol (padRing), 1=vortex aérien (entryVortex) — alternés
    const presetMain = step === "portal" ? PRESETS.padRing(col) : PRESETS.entryVortex(col);
    spawnParticles(api, [target[0] + 0.5, target[1] + 0.5, target[2] + 0.5], presetMain, { radius: 0.5, height: 1.2 });

    // Flèches intermédiaires le long du trajet (tous les ~4 blocs)
    // Évite le spam: on tire le trajet depuis position joueur ou lobby vers cible
    let from = null;
    try {
      const p = api.getPosition ? api.getPosition(playerId) : null;
      if (p && typeof p.x === "number") from = [p.x, p.y, p.z];
      else if (Array.isArray(p)) from = p;
    } catch {}
    if (!from) from = step === "portal" ? [10, 21, 10] : tutorialConfig.portalPos;
    const dx = target[0] - from[0], dz = target[2] - from[2];
    const dist = Math.hypot(dx, dz);
    const steps = Math.min(4, Math.floor(dist / 4));
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1);
      const x = lerp(from[0], target[0], t);
      const z = lerp(from[2], target[2], t);
      const y = lerp(from[1], target[1], t) + 0.3;
      // alterne les 2 types pour montrer la variété
      const preset = i % 2 === 0 ? PRESETS.padRing(col) : PRESETS.entryVortex(col);
      const small = { ...preset, manualEmitCount: Math.max(4, Math.floor((preset.manualEmitCount || 12) / 3)), minSize: (preset.minSize || 0.3) * 0.7, maxSize: (preset.maxSize || 0.5) * 0.7 };
      spawnParticles(api, [x, y, z], small, { radius: 0.3, height: 0.8 });
    }
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
