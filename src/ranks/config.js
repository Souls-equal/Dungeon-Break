/**
 * Ranks — config
 * Each rank has a unique color (chat prefix + leaderboard).
 * Restricted ones (OWNER/TESTER) are only available to named players.
 * Others are unlocked via achievements: crates, kills, rooms/time.
 */

export const RANK_COLORS = {
  owner: "#FF3B30",
  tester: "#2ECC71",
};

export const RANKS = [
  // Restricted / default
  {
    id: "owner",
    label: "OWNER",
    prefix: "[OWNER]",
    color: "#FF3B30",
    sort: 100,
    restrictedTo: ["K4miNoK4mi"],
    unlock: null,
  },
  {
    id: "tester",
    label: "TESTER",
    prefix: "[TESTER]",
    color: "#2ECC71",
    sort: 90,
    restrictedTo: ["TheSageOfDeath", "Xarvath"],
    unlock: null,
  },
  // Free / early
  {
    id: "member",
    label: "MEMBER",
    prefix: "[MEMBER]",
    color: "#AAAAAA",
    sort: 10,
    unlock: null, // free for all
  },
  // Crates — palier 1,2 + rarity
  {
    id: "hunter",
    label: "HUNTER",
    prefix: "[HUNTER]",
    color: "#A569BD",
    sort: 20,
    unlock: { type: "crates", count: 10 },
  },
  {
    id: "hunter2",
    label: "HUNTER+",
    prefix: "[HUNTER+]",
    color: "#7D3C98",
    sort: 21,
    unlock: { type: "crates", count: 50 },
  },
  {
    id: "rare_hunter",
    label: "RARE HUNTER",
    prefix: "[RARE HUNTER]",
    color: "#F39C12",
    sort: 22,
    unlock: { type: "cratesRare", count: 10 }, // Rare+ (Rare/Epic/Legendary)
  },
  // Kills — paliers
  {
    id: "slayer",
    label: "SLAYER",
    prefix: "[SLAYER]",
    color: "#E74C3C",
    sort: 30,
    unlock: { type: "kills", count: 50 },
  },
  {
    id: "slayer2",
    label: "SLAYER+",
    prefix: "[SLAYER+]",
    color: "#C0392B",
    sort: 31,
    unlock: { type: "kills", count: 250 },
  },
  // Exploration / rooms
  {
    id: "explorer",
    label: "EXPLORER",
    prefix: "[EXPLORER]",
    color: "#3498DB",
    sort: 40,
    unlock: { type: "rooms", count: 25 },
  },
  // Time in dungeon — paliers
  {
    id: "veteran",
    label: "VETERAN",
    prefix: "[VETERAN]",
    color: "#1ABC9C",
    sort: 50,
    unlock: { type: "time", countTicks: 20 * 60 * 30 }, // 30 min
  },
  {
    id: "champion",
    label: "CHAMPION",
    prefix: "[CHAMPION]",
    color: "#F1C40F",
    sort: 51,
    unlock: { type: "timeHard", countTicks: 20 * 60 * 60 }, // 60 min in Hard+
  },
  {
    id: "legend",
    label: "LEGEND",
    prefix: "[LEGEND]",
    color: "#E67E22",
    sort: 60,
    unlock: { type: "timeHell", countTicks: 20 * 60 * 60 }, // 60 min in Hell
  },
];

export const NONE_RANK_ID = "NONE";

const BY_ID = {};
for (const r of RANKS) BY_ID[r.id] = r;

export function getRank(id) {
  if (!id) return null;
  return BY_ID[id] || null;
}
export function isRestricted(rank) {
  return Array.isArray(rank.restrictedTo) && rank.restrictedTo.length > 0;
}
export function isAvailableForPlayer(rank, playerName) {
  if (!rank) return false;
  if (!isRestricted(rank)) return true;
  return rank.restrictedTo.includes(playerName);
}
// unlock helpers — rarity groups
export const RARE_RARITIES = ["Rare", "Epic", "Legendary"];
export function isRareRarity(rarity) {
  return RARE_RARITIES.includes(rarity);
}
