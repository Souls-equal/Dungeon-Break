/**
 * Particle presets — centralized, minimal
 * Colors as hex for Bloxd gradients (via RGB 0-255)
 * Shapes: ring, vortex, burst, fountain
 */

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

export const PARTICLE_TEXTURES = {
  star: "glint",
  spark: "bubble",
  smoke: "generic_2",
  flame: "effect_5",
  magic: "soul_0",
};

// Difficulty colors → pad block mapping
export const DIFFICULTY_COLOR = {
  veryEasy: "#7CFC00", // Lime
  easy: "#87CEEB", // Light Blue
  medium: "#FFD700", // Yellow
  normal: "#FF8C00", // Orange
  hard: "#FF3B30", // Red
  insane: "#9B59B6", // Purple
  nightmare: "#7D3C98", // Dark violet
  hell: "#111111", // Black with dark red glow
};

export const CRATE_COLOR = {
  Common: "#AAAAAA",
  Uncommon: "#5DADE2",
  Rare: "#3498DB",
  Epic: "#A569BD",
  Legendary: "#F1C40F",
};

// Weapon colors — one per set (visible on slash)
export const WEAPON_SET_COLOR = {
  Amethite: "#9B59B6",   // crystal violet
  Magmasteel: "#E74C3C", // fire red
  Rubellite: "#E91E63",  // ruby pink
  Serpentite: "#2ECC71", // scale green
  Sanguine: "#8B0000",   // dark blood (Steel Bar)
  Spectral: "#00D4C8",   // spectral cyan
  Geo: "#D4A574",        // earth ochre (Copper Bar)
  Astral: "#8A2BE2",     // cosmic violet (Star Alloy)
  Moonstone: "#B0E0E6",  // moonstone pale blue
  Nova: "#00FFFF",       // nova cyan
};

// Same palette for armors (defense)
export const ARMOR_SET_COLOR = {
  Amethite: "#9B59B6",
  Magmasteel: "#E74C3C",
  Rubellite: "#E91E63",
  Serpentite: "#2ECC71",
  Cursemetal: "#5D4037", // cursed brown (Iron Plate)
  "Kingly Amethite": "#FFD700", // royal gold (Gold Plate)
  "Kingly Diamond": "#BDC3C7", // diamond (Machine Hull)
  Sanguine: "#8B0000",
  Spectral: "#00D4C8",
  Geo: "#D4A574",
  Astral: "#8A2BE2",
  Voltplate: "#00E5FF", // tech cyan (Voltite Cell)
  Nova: "#00FFFF", // nova cyan
};

// Reusable presets
export const PRESETS = {
  // Pad countdown: flat ring on ground + center star
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
  // Entry: vortex column 4 blocks high
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
  // Room clear: explosion + ring
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
  // Crate: helix fountain
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
  // ── Combat FX — weapons ──────────────────────────────────────────────
  // Sword slash: flat horizontal arc, trailing stars
  weaponSlash: (colorHex, tierScale = 1) => ({
    texture: PARTICLE_TEXTURES.star,
    minLifeTime: 0.35, maxLifeTime: 0.55,
    minEmitPower: 1.2 * tierScale, maxEmitPower: 2.4 * tierScale,
    minSize: 0.2 * tierScale, maxSize: 0.42 * tierScale,
    gravity: [0, -0.5, 0],
    blendMode: 1,
    manualEmitCount: Math.round(16 * tierScale),
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb(colorHex), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#FFFFFF"), 0.9], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  // Dagger: two quick bursts (combo)
  weaponDagger: (colorHex, tierScale = 1) => ({
    texture: PARTICLE_TEXTURES.spark,
    minLifeTime: 0.25, maxLifeTime: 0.4,
    minEmitPower: 1.0 * tierScale, maxEmitPower: 2.0 * tierScale,
    minSize: 0.12 * tierScale, maxSize: 0.28 * tierScale,
    gravity: [0, 1, 0],
    blendMode: 1,
    manualEmitCount: Math.round(12 * tierScale),
    colorGradients: [{ timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb("#FFFFFF"), 0.8] }],
  }),
  // Spear: thrust trail — long and thin
  weaponSpear: (colorHex, tierScale = 1) => ({
    texture: PARTICLE_TEXTURES.spark,
    minLifeTime: 0.3, maxLifeTime: 0.5,
    minEmitPower: 2.0 * tierScale, maxEmitPower: 3.5 * tierScale,
    minSize: 0.18 * tierScale, maxSize: 0.32 * tierScale,
    gravity: [0, 0, 0],
    blendMode: 1,
    manualEmitCount: Math.round(14 * tierScale),
    colorGradients: [{ timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb(colorHex), 0] }],
  }),
  // Club: circular shockwave
  weaponClub: (colorHex, tierScale = 1) => ({
    texture: PARTICLE_TEXTURES.smoke,
    minLifeTime: 0.5, maxLifeTime: 0.8,
    minEmitPower: 1.5 * tierScale, maxEmitPower: 3.0 * tierScale,
    minSize: 0.35 * tierScale, maxSize: 0.65 * tierScale,
    gravity: [0, -1, 0],
    blendMode: 1,
    manualEmitCount: Math.round(20 * tierScale),
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb(colorHex), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#FFFFFF"), 0.6], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  // Mace: vertical smash with flames
  weaponMace: (colorHex, tierScale = 1) => ({
    texture: PARTICLE_TEXTURES.flame,
    minLifeTime: 0.4, maxLifeTime: 0.7,
    minEmitPower: 1.8 * tierScale, maxEmitPower: 3.2 * tierScale,
    minSize: 0.28 * tierScale, maxSize: 0.5 * tierScale,
    gravity: [0, 2, 0],
    blendMode: 1,
    manualEmitCount: Math.round(18 * tierScale),
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb("#FFFFFF"), 1] },
      { timeFraction: 1, minColor: [...hexToRgb(colorHex), 0.4], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  // Whip: light curved trail
  weaponWhip: (colorHex, tierScale = 1) => ({
    texture: PARTICLE_TEXTURES.spark,
    minLifeTime: 0.4, maxLifeTime: 0.65,
    minEmitPower: 1.4 * tierScale, maxEmitPower: 2.8 * tierScale,
    minSize: 0.18 * tierScale, maxSize: 0.35 * tierScale,
    gravity: [0, 0.5, 0],
    blendMode: 1,
    manualEmitCount: Math.round(14 * tierScale),
    colorGradients: [{ timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb("#FFFFFF"), 0.7] }],
  }),
  // Bow: glowing arrow trail
  weaponBow: (colorHex, tierScale = 1) => ({
    texture: PARTICLE_TEXTURES.spark,
    minLifeTime: 0.35, maxLifeTime: 0.6,
    minEmitPower: 1.5 * tierScale, maxEmitPower: 2.8 * tierScale,
    minSize: 0.2 * tierScale, maxSize: 0.38 * tierScale,
    gravity: [0, 1, 0],
    blendMode: 1,
    manualEmitCount: Math.round(10 * tierScale),
    colorGradients: [{ timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb("#FFFFFF"), 0.9] }],
  }),
  // Crossbow: piercing burst
  weaponCrossbow: (colorHex, tierScale = 1) => ({
    texture: PARTICLE_TEXTURES.star,
    minLifeTime: 0.4, maxLifeTime: 0.65,
    minEmitPower: 2.0 * tierScale, maxEmitPower: 3.5 * tierScale,
    minSize: 0.22 * tierScale, maxSize: 0.42 * tierScale,
    gravity: [0, -0.5, 0],
    blendMode: 1,
    manualEmitCount: Math.round(16 * tierScale),
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb(colorHex), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#FFFFFF"), 0.5], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  // Boomerang: spinning ring
  weaponBoomerang: (colorHex, tierScale = 1) => ({
    texture: PARTICLE_TEXTURES.star,
    minLifeTime: 0.45, maxLifeTime: 0.7,
    minEmitPower: 1.2 * tierScale, maxEmitPower: 2.2 * tierScale,
    minSize: 0.22 * tierScale, maxSize: 0.4 * tierScale,
    gravity: [0, 0.8, 0],
    blendMode: 1,
    manualEmitCount: Math.round(12 * tierScale),
    colorGradients: [{ timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb("#FFFFFF"), 0.7] }],
  }),
  // Staff: magic vortex
  weaponStaff: (colorHex, tierScale = 1) => ({
    texture: PARTICLE_TEXTURES.magic,
    minLifeTime: 0.6, maxLifeTime: 1.0,
    minEmitPower: 1.4 * tierScale, maxEmitPower: 2.8 * tierScale,
    minSize: 0.28 * tierScale, maxSize: 0.55 * tierScale,
    gravity: [0, 2.5, 0],
    blendMode: 1,
    manualEmitCount: Math.round(22 * tierScale),
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb(colorHex), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#FFFFFF"), 0.8], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  // Base hit: small spark on every hit (all types, single subtle particle)
  weaponHit: (colorHex, tierScale = 1) => ({
    texture: PARTICLE_TEXTURES.spark,
    minLifeTime: 0.2, maxLifeTime: 0.35,
    minEmitPower: 0.8 * tierScale, maxEmitPower: 1.4 * tierScale,
    minSize: 0.12 * tierScale, maxSize: 0.22 * tierScale,
    gravity: [0, 1.5, 0],
    blendMode: 1,
    manualEmitCount: Math.round(4 * tierScale),
    colorGradients: [{ timeFraction: 0, minColor: [...hexToRgb(colorHex), 1], maxColor: [...hexToRgb("#FFFFFF"), 0.6] }],
  }),
  // ── Armors ──────────────────────────────────────────────────────────
  // Defensive shield (when hit with full set)
  armorShield: (colorHex, tierScale = 1) => ({
    texture: PARTICLE_TEXTURES.magic,
    minLifeTime: 0.5, maxLifeTime: 0.85,
    minEmitPower: 0.8 * tierScale, maxEmitPower: 1.8 * tierScale,
    minSize: 0.25 * tierScale, maxSize: 0.5 * tierScale,
    gravity: [0, 1.2, 0],
    blendMode: 1,
    manualEmitCount: Math.round(16 * tierScale),
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb(colorHex), 0.9], maxColor: [...hexToRgb(colorHex), 0.9] },
      { timeFraction: 1, minColor: [...hexToRgb("#FFFFFF"), 0.6], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  // Passive shimmer (set aura)
  armorShimmer: (colorHex, tierScale = 1) => ({
    texture: PARTICLE_TEXTURES.spark,
    minLifeTime: 0.6, maxLifeTime: 1.0,
    minEmitPower: 0.4 * tierScale, maxEmitPower: 0.9 * tierScale,
    minSize: 0.15 * tierScale, maxSize: 0.28 * tierScale,
    gravity: [0, 1.8, 0],
    blendMode: 1,
    manualEmitCount: Math.round(6 * tierScale),
    colorGradients: [{ timeFraction: 0, minColor: [...hexToRgb(colorHex), 0.7], maxColor: [...hexToRgb(colorHex), 0] }],
  }),

  // ── Special sets — new effects ──────────────────────────────────
  // Amethite: large violet ring on ground
  amethystZone: (tierScale = 1) => ({
    texture: PARTICLE_TEXTURES.magic,
    minLifeTime: 0.55, maxLifeTime: 0.9,
    minEmitPower: 0.6, maxEmitPower: 1.8,
    minSize: 0.32 * tierScale, maxSize: 0.58 * tierScale,
    gravity: [0, 0.4, 0],
    blendMode: 1,
    manualEmitCount: Math.round(26 * tierScale),
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb("#9B59B6"), 1], maxColor: [...hexToRgb("#D8B4FE"), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#FFFFFF"), 0.7], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  // Magmasteel: burn — rising flames orange to red
  magmaBurn: () => ({
    texture: PARTICLE_TEXTURES.flame,
    minLifeTime: 0.45, maxLifeTime: 0.8,
    minEmitPower: 0.8, maxEmitPower: 2.2,
    minSize: 0.22, maxSize: 0.45,
    gravity: [0, 2.8, 0],
    blendMode: 1,
    manualEmitCount: 16,
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb("#E74C3C"), 1], maxColor: [...hexToRgb("#FF7700"), 1] },
      { timeFraction: 0.5, minColor: [...hexToRgb("#FF4400"), 0.9], maxColor: [...hexToRgb("#FFAA00"), 0.9] },
      { timeFraction: 1, minColor: [...hexToRgb("#FFCC00"), 0], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  // Rubellite: large pink zone around player on kill
  rubelliteKillZone: () => ({
    texture: PARTICLE_TEXTURES.magic,
    minLifeTime: 0.7, maxLifeTime: 1.1,
    minEmitPower: 0.5, maxEmitPower: 1.6,
    minSize: 0.30, maxSize: 0.60,
    gravity: [0, 1.2, 0],
    blendMode: 1,
    manualEmitCount: 34,
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb("#E91E63"), 1], maxColor: [...hexToRgb("#FF88CC"), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#FFD6E8"), 0.6], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  // Serpentite: swirling green poison
  serpentPoison: () => ({
    texture: PARTICLE_TEXTURES.spark,
    minLifeTime: 0.6, maxLifeTime: 1.0,
    minEmitPower: 0.4, maxEmitPower: 1.2,
    minSize: 0.20, maxSize: 0.38,
    gravity: [0, 1.0, 0],
    blendMode: 1,
    manualEmitCount: 14,
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb("#2ECC71"), 0.95], maxColor: [...hexToRgb("#1A7A3A"), 0.95] },
      { timeFraction: 1, minColor: [...hexToRgb("#2ECC71"), 0], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  // Sanguine: heal — falling on mob (dark red) + rising on player (pink)
  sanguineDrainMob: () => ({
    texture: PARTICLE_TEXTURES.spark,
    minLifeTime: 0.4, maxLifeTime: 0.7,
    minEmitPower: 0.7, maxEmitPower: 1.6,
    minSize: 0.18, maxSize: 0.34,
    gravity: [0, -2.0, 0],
    blendMode: 1,
    manualEmitCount: 12,
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb("#8B0000"), 1], maxColor: [...hexToRgb("#FF0000"), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#000000"), 0.8], maxColor: [...hexToRgb("#8B0000"), 0] },
    ],
  }),
  sanguineHealPlayer: () => ({
    texture: PARTICLE_TEXTURES.star,
    minLifeTime: 0.5, maxLifeTime: 0.85,
    minEmitPower: 0.9, maxEmitPower: 1.8,
    minSize: 0.20, maxSize: 0.40,
    gravity: [0, 2.5, 0],
    blendMode: 1,
    manualEmitCount: 14,
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb("#FF3366"), 1], maxColor: [...hexToRgb("#FF88AA"), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#FFFFFF"), 0.7], maxColor: [...hexToRgb("#FF3366"), 0] },
    ],
  }),
  // Spectral: cyan/black invisibility
  spectralInvis: () => ({
    texture: PARTICLE_TEXTURES.magic,
    minLifeTime: 0.5, maxLifeTime: 0.9,
    minEmitPower: 0.6, maxEmitPower: 1.6,
    minSize: 0.22, maxSize: 0.44,
    gravity: [0, 1.6, 0],
    blendMode: 1,
    manualEmitCount: 18,
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb("#00D4C8"), 1], maxColor: [...hexToRgb("#111111"), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#00D4C8"), 0.3], maxColor: [...hexToRgb("#000000"), 0] },
    ],
  }),
  // Spectral: large cyan/black explosion
  spectralExplosion: () => ({
    texture: PARTICLE_TEXTURES.star,
    minLifeTime: 0.55, maxLifeTime: 0.95,
    minEmitPower: 1.8, maxEmitPower: 3.6,
    minSize: 0.35, maxSize: 0.70,
    gravity: [0, 1.2, 0],
    blendMode: 1,
    manualEmitCount: 38,
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb("#00D4C8"), 1], maxColor: [...hexToRgb("#0A0A0A"), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#00D4C8"), 0.2], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  // Geo: mine — pulsing ochre blink
  geoMineTick: () => ({
    texture: PARTICLE_TEXTURES.spark,
    minLifeTime: 0.35, maxLifeTime: 0.6,
    minEmitPower: 0.3, maxEmitPower: 0.9,
    minSize: 0.20, maxSize: 0.36,
    gravity: [0, 0.8, 0],
    blendMode: 1,
    manualEmitCount: 10,
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb("#D4A574"), 1], maxColor: [...hexToRgb("#8B5A2B"), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#FFD9A0"), 0.6], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  geoMineExplosion: () => ({
    texture: PARTICLE_TEXTURES.smoke,
    minLifeTime: 0.5, maxLifeTime: 0.9,
    minEmitPower: 1.6, maxEmitPower: 3.2,
    minSize: 0.38, maxSize: 0.72,
    gravity: [0, -0.5, 0],
    blendMode: 1,
    manualEmitCount: 28,
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb("#D4A574"), 1], maxColor: [...hexToRgb("#5A3A1A"), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#D4A574"), 0.4], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  // Astral: Glowing violet
  astralGlowing: () => ({
    texture: PARTICLE_TEXTURES.magic,
    minLifeTime: 0.6, maxLifeTime: 1.0,
    minEmitPower: 0.4, maxEmitPower: 1.3,
    minSize: 0.24, maxSize: 0.48,
    gravity: [0, 1.4, 0],
    blendMode: 1,
    manualEmitCount: 20,
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb("#8A2BE2"), 1], maxColor: [...hexToRgb("#111111"), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#DAAAFF"), 0.5], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  // Astral: violet/black tornado around mob
  astralTornado: () => ({
    texture: PARTICLE_TEXTURES.magic,
    minLifeTime: 0.7, maxLifeTime: 1.15,
    minEmitPower: 1.0, maxEmitPower: 2.6,
    minSize: 0.28, maxSize: 0.55,
    gravity: [0, 2.6, 0],
    blendMode: 1,
    manualEmitCount: 26,
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb("#8A2BE2"), 1], maxColor: [...hexToRgb("#000000"), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#DAAAFF"), 0.6], maxColor: [...hexToRgb("#000000"), 0] },
    ],
  }),
  // Astral: enveloping aura (slowness)
  astralAura: () => ({
    texture: PARTICLE_TEXTURES.spark,
    minLifeTime: 0.5, maxLifeTime: 0.9,
    minEmitPower: 0.3, maxEmitPower: 0.9,
    minSize: 0.18, maxSize: 0.34,
    gravity: [0, 0.9, 0],
    blendMode: 1,
    manualEmitCount: 14,
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb("#8A2BE2"), 0.85], maxColor: [...hexToRgb("#111111"), 0.85] },
      { timeFraction: 1, minColor: [...hexToRgb("#8A2BE2"), 0], maxColor: [...hexToRgb("#000000"), 0] },
    ],
  }),
  // Nova: slash each hit (cyan)
  novaSlash: () => ({
    texture: PARTICLE_TEXTURES.star,
    minLifeTime: 0.35, maxLifeTime: 0.6,
    minEmitPower: 1.5, maxEmitPower: 3.0,
    minSize: 0.3, maxSize: 0.55,
    gravity: [0, 0, 0],
    blendMode: 1,
    manualEmitCount: 20,
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb("#00FFFF"), 1], maxColor: [...hexToRgb("#FFFFFF"), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#00FFFF"), 0.2], maxColor: [...hexToRgb("#FFFFFF"), 0] },
    ],
  }),
  // Nova: laser beam (long line)
  novaLaser: () => ({
    texture: PARTICLE_TEXTURES.star,
    minLifeTime: 0.4, maxLifeTime: 0.7,
    minEmitPower: 2.0, maxEmitPower: 4.0,
    minSize: 0.35, maxSize: 0.65,
    gravity: [0, 0, 0],
    blendMode: 1,
    manualEmitCount: 30,
    colorGradients: [
      { timeFraction: 0, minColor: [...hexToRgb("#00FFFF"), 1], maxColor: [...hexToRgb("#88FFFF"), 1] },
      { timeFraction: 1, minColor: [...hexToRgb("#FFFFFF"), 0.8], maxColor: [...hexToRgb("#00FFFF"), 0] },
    ],
  }),
};
