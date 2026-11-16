/**
 * Particles presets — centralisé, minimal
 * Couleurs = hex pour gradients Bloxd (via RGB 0-255)
 * Formes: ring, vortex, burst, fountain
 */

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

export const PARTICLE_TEXTURES = {
  star: "star",
  spark: "sparkle",
  smoke: "smoke",
  flame: "flame",
  magic: "magic",
};

// Couleurs difficultés → padBlock mapping
export const DIFFICULTY_COLOR = {
  veryEasy: "#7CFC00", // Lime
  easy: "#87CEEB", // Light Blue
  medium: "#FFD700", // Yellow
  normal: "#FF8C00", // Orange
  hard: "#FF3B30", // Red
  insane: "#9B59B6", // Purple
  nightmare: "#7D3C98", // Gray -> violet dark
  hell: "#111111", // Black -> dark red glow
};

export const CRATE_COLOR = {
  Common: "#AAAAAA",
  Uncommon: "#5DADE2",
  Rare: "#3498DB",
  Epic: "#A569BD",
  Legendary: "#F1C40F",
};

// Presets réutilisables
export const PRESETS = {
  // Pad countdown: anneau plat au sol + étoile centre
  padRing: (colorHex) => ({
    texture: PARTICLE_TEXTURES.star,
    minLifeTime: 0.6, maxLifeTime: 0.9,
    minEmitPower: 0.2, maxEmitPower: 0.5,
    minSize: 0.25, maxSize: 0.45,
    gravity: [0, -1, 0],
    blendMode: 1,
    manualEmitCount: 18,
    colorGradients: [{ timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb(colorHex), 1] }],
    velocityGradients: [{ timeFraction: 0, factor: 1, factor2: 1 }],
  }),
  padTick: (colorHex) => ({
    texture: PARTICLE_TEXTURES.spark,
    minLifeTime: 0.3, maxLifeTime: 0.5,
    minEmitPower: 1, maxEmitPower: 2,
    minSize: 0.15, maxSize: 0.25,
    gravity: [0, 2, 0],
    blendMode: 1,
    manualEmitCount: 6,
    colorGradients: [{ timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb("#FFFFFF"), 1] }],
  }),
  // Entrée: vortex colonne 4 blocks
  entryVortex: (colorHex) => ({
    texture: PARTICLE_TEXTURES.magic,
    minLifeTime: 0.9, maxLifeTime: 1.4,
    minEmitPower: 1.5, maxEmitPower: 3,
    minSize: 0.3, maxSize: 0.6,
    gravity: [0, 3, 0],
    blendMode: 1,
    manualEmitCount: 30,
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb(colorHex), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#FFFFFF"), 0.2], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  // Room clear: explosion + anneau
  roomClear: (colorHex) => ({
    texture: PARTICLE_TEXTURES.star,
    minLifeTime: 0.5, maxLifeTime: 1.0,
    minEmitPower: 2, maxEmitPower: 4,
    minSize: 0.35, maxSize: 0.7,
    gravity: [0, -2, 0],
    blendMode: 1,
    manualEmitCount: 28,
    colorGradients: [{ timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb(colorHex), 0.8] }],
  }),
  // Crate: fontaine hélice
  crateFountain: (colorHex, rarity) => {
    const counts = { Common: 14, Uncommon: 18, Rare: 24, Epic: 30, Legendary: 40 };
    const sizes = { Common: 0.2, Uncommon: 0.25, Rare: 0.3, Epic: 0.35, Legendary: 0.45 };
    return {
      texture: rarity === "Legendary" ? PARTICLE_TEXTURES.magic : PARTICLE_TEXTURES.spark,
      minLifeTime: 0.7, maxLifeTime: 1.2,
      minEmitPower: 1, maxEmitPower: 2.5,
      minSize: sizes[rarity] || 0.25, maxSize: (sizes[rarity] || 0.25) + 0.15,
      gravity: [0, 4, 0],
      blendMode: 1,
      manualEmitCount: counts[rarity] || 18,
      colorGradients: [
        { timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb(colorHex), 1] },
        { timeFraction: 1, minColor: [...hexToRgb("#FFFFFF"), 1], maxColor: [...hexToRgb("#FFFFFF"), 0] },
      ],
    };
  },
};
