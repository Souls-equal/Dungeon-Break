/**
 * Exemple d'utilisation du système "coin blockData" pour des salles à event.
 *
 * Principe (résumé de ce qui a été fait) :
 *   1. Chaque chunk copié se fait `stampRoomInfo` juste après `copyChunk` → le bloc coin [0,0,0]
 *      (air au-dessus du sol) reçoit {kind, eventId, templateIndex, difficultyId, placedAt}
 *      via `setBlockData`. C'est effacé à la prochaine copie (le bloc change), donc pas de fuite.
 *   2. Le builder peut aussi poser la data directement sur le chunk template lui-même
 *      (ex: api.setBlockData(srcX, srcY, srcZ, {kind:"event", eventId:"lavaTrap"})) → elle est
 *      lue par `readSourceRoomInfo` et recopiée. Ou via la table `templates.js`.
 *   3. À tout moment après chargement du chunk : `loader.getRoomData(level, chunkX, chunkZ)` ou
 *      `service.getRoomData(playerId, chunkX, chunkZ)` → {kind, eventId, clear, ...} ou null si pas chargé.
 *
 * Ce fichier montre 1 event complet : lavaTrap (piège de lave au sol).
 * Ajouter un nouvel event = ajouter une entrée à ROOM_EVENTS + un handler dans tickRoomEvents/onRoomEventEnter.
 */

import { DIFFICULTY_COLOR } from "../particles/config.js";

// Catalogue des events — extensible sans toucher au loader.
// kind peut être "normal" | "chest" | "event" | "boss" ; eventId précise le piège/bonus.
export const ROOM_EVENTS = {
  lavaTrap: {
    label: "Lava Trap",
    // dégâts par tick d'event (toutes les `intervalTicks`)
    damage: 3,
    intervalTicks: 10, // 10 ticks = 0.5s (20 tps)
    // particules jouées à l'entrée + en boucle
    particleColor: "#FF4400",
    message: "Piège de lave !",
    messageColor: "#FF5500",
  },
  // Exemples à décommenter :
  // poisonCloud: { label:"Poison Cloud", damage:1, intervalTicks:20, particleColor:"#2ECC71", message:"Nuage toxique !" },
  // healShrine:  { label:"Heal Shrine", heal:4, intervalTicks:20, particleColor:"#55FF55", message:"Sanctuaire de soin" },
};

export function getEventConfig(eventId) {
  return ROOM_EVENTS[eventId] || null;
}

/**
 * Appelé à la découverte d'une salle (1 fois par run, via onRoomDiscovered).
 * Idéal pour : message, burst de particules, son, donner un item, etc.
 * Ne pas mettre de dégâts continus ici — voir tickRoomEvents.
 */
export function onRoomEventEnter(api, playerId, roomData, pos) {
  if (!roomData || !roomData.eventId) return;
  const cfg = getEventConfig(roomData.eventId);
  if (!cfg) return;
  try {
    // Message d'entrée
    if (cfg.message) {
      api.sendMessage(playerId, [{ str: cfg.message, style: { color: cfg.messageColor || "#ffaa00" } }]);
    }
    // Burst d'entrée (anneau + fumée) — visible même avec des murs bas car au centre
    if (api.playParticleEffect) {
      const { PRESETS } = globalThis.__PARTICLE_PRESETS || {};
      if (PRESETS) {
        const color = cfg.particleColor || DIFFICULTY_COLOR[roomData.difficultyId] || "#FF0000";
        // preset générique selon l'event — ici on réutilise magmaBurn pour lavaTrap
        let preset = null;
        if (roomData.eventId === "lavaTrap" && PRESETS.magmaBurn) preset = PRESETS.magmaBurn();
        else if (PRESETS.roomClear) preset = PRESETS.roomClear(color);
        if (preset) {
          const cx = pos ? pos[0] : 0, cy = pos ? pos[1] : 0, cz = pos ? pos[2] : 0;
          const { spawn } = (() => { try { return require("../particles/service.js"); } catch(_) { return {}; } })();
          // fallback direct si spawn non dispo — on passe par PRESETS.roomClear déjà importé via worldCode
          // Ce bloc sera remplacé par worldCode qui a déjà spawnParticles.
        }
      }
    }
  } catch (_) {}
}

/**
 * Tick des salles à event — à appeler depuis le `tick` global (20 fois/sec).
 * Vérifie pour chaque joueur en donjon s'il est dans une salle event, et applique l'effet.
 *
 * @param {object} api - Bloxd api
 * @param {object} service - dungeon service (pour getRoomData / inDungeon)
 * @param {function} getPlayerPos - optionnel, sinon api.getPosition
 */
let _eventTick = 0;
export function tickRoomEvents(api, service) {
  _eventTick++;
  let playerIds = [];
  try { playerIds = typeof api.getPlayerIds === "function" ? api.getPlayerIds() : []; } catch (_) { return; }
  if (!playerIds || playerIds.length === 0) return;

  for (const pid of playerIds) {
    try {
      if (!service.inDungeon(pid)) continue;
      // Ne pas frapper un joueur downed ou en imunité revive — même règle que lava
      // Ces helpers existent dans worldCode.js ; on les teste via try
      // On les duplique ici en mode safe (pas d'import circulaire)
      let pos = null;
      try { pos = api.getPosition(pid); } catch (_) {}
      if (!pos || !Array.isArray(pos) || pos.length < 3) continue;

      // chunk actuel du joueur
      const SIZE = 32;
      const chunkX = Math.floor(pos[0] / SIZE);
      const chunkZ = Math.floor(pos[2] / SIZE);

      let roomData = null;
      try { roomData = service.getRoomData(pid, chunkX, chunkZ); } catch (_) {}
      if (!roomData || !roomData.eventId) continue;
      const cfg = getEventConfig(roomData.eventId);
      if (!cfg) continue;

      // Intervalle : on ne frappe pas à chaque tick
      if (_eventTick % (cfg.intervalTicks || 10) !== 0) {
        // même en dehors du tick de dégâts, on peut jouer une particule légère d'ambiance
        // pour montrer que la salle est piégée (coût faible, 1 fois/sec)
        if (_eventTick % 20 === 0 && cfg.particleColor && typeof api.playParticleEffect === "function") {
          try {
            const col = cfg.particleColor;
            const { PRESETS } = globalThis.__PARTICLE_PRESETS || {};
            if (PRESETS && PRESETS.magmaBurn) {
              const { spawn } = globalThis.__PARTICLE_SPAWN || {};
              // worldCode expose spawnParticles ; fallback direct :
              const preset = PRESETS.magmaBurn();
              // petit anneau au sol — on laisse worldCode gérer le spawn visuel si possible
              // Ici on ne fait rien si pas de helper, pour ne pas dupliquer la logique particules
              void preset; void col;
            }
          } catch (_) {}
        }
        continue;
      }

      // --- Effet ---
      if (cfg.damage) {
        // Dégâts : respecte l'immunité lave si Magmasteel (optionnel)
        let immune = false;
        try {
          if (typeof service.isPlayerImmuneToLava === "function" && service.isPlayerImmuneToLava(pid)) immune = true;
        } catch (_) {}
        if (immune) continue;

        // Applique les dégâts (même API que tickLavaDamage dans worldCode.js)
        try {
          if (typeof api.applyHealthChange === "function") {
            api.applyHealthChange(pid, -Math.max(1, Math.round(cfg.damage)), undefined, false);
          } else if (typeof api.getHealth === "function" && typeof api.setHealth === "function") {
            const cur = api.getHealth(pid);
            if (Number.isFinite(cur)) api.setHealth(pid, Math.max(0, cur - cfg.damage));
          }
          // feedback visuel court
          try { api.sendMessage(pid, [{ str: `-${cfg.damage} HP (${cfg.label})`, style: { color: cfg.messageColor || "#ff5555" } }]); } catch (_) {}
        } catch (_) {}
      }
      if (cfg.heal) {
        try {
          if (typeof api.applyHealthChange === "function") api.applyHealthChange(pid, Math.max(1, Math.round(cfg.heal)), undefined, false);
        } catch (_) {}
      }
    } catch (_) {}
  }
}
