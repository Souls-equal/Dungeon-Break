/*
 * Blessings: what an aura level buys.
 *
 * A player gains **one point per aura level** (the game's own XP, `getAuraInfo`), and a point
 * buys one roll in the shop. A roll is a rarity first, then a blessing of that rarity — the
 * same two-step shape as a chest's key, and for the same reason: the odds belong to the
 * rarity table, and the catalogue is free to grow without touching them.
 *
 * Everything here is **data and pure functions**. What a blessing *does* is described by its
 * `effect`, and applying it is the world's job (`src/blessing/effects.js`); this file only
 * knows the catalogue.
 *
 * Three **scopes**, which is the owner's model:
 *
 *   - `permanent`: saved in a player database value, restored on every reconnection, and
 *     stacked forever. `damageResist` is capped so the stack cannot reach immunity.
 *   - `run`:          lasts until the run ends — death, leaving, or teleporting to spawn.
 *   - `timed`:        a potion effect with a duration between 30 s and 2 min, nothing else:
 *     the engine already limits those in time.
 */

/**
 * The six rarities, **in the order the owner gave them**, with the colour of each.
 *
 * `weight` is relative, not a percentage: `rarityOdds()` normalises it, so the numbers
 * below can be read as "for every 1000 Common rolls, 420 Uncommon ones". That is roughly
 * 60 / 25 / 9.6 / 3.6 / 1.1 / 0.2 %, and it keeps every rarity reachable — a Mythic is a
 * bad bet, not an impossibility.
 *
 * Two colours per rarity, and the difference is the API's. `colour` is the hex of the
 * family, used for the card's background — `sendTopRightHelper` wants `rgb()` and the docs
 * are explicit that hex does not work there — and `textColour` is a CSS colour name for
 * styled text, which is the form the docs use (`{ color: "gold" }`). One table, two
 * renderers, no guessing about what a colour string means on the way in.
 */
export const RARITIES = [
  { id: "common", label: "Common", colour: "#95A5A6", textColour: "#95A5A6", weight: 1000 },
  { id: "uncommon", label: "Uncommon", colour: "#2ECC71", textColour: "#2ECC71", weight: 420 },
  { id: "rare", label: "Rare", colour: "#3498DB", textColour: "#3498DB", weight: 160 },
  { id: "epic", label: "Epic", colour: "#9B59B6", textColour: "#9B59B6", weight: 60 },
  { id: "legendary", label: "Legendary", colour: "#F1C40F", textColour: "#F1C40F", weight: 18 },
  { id: "mythic", label: "Mythic", colour: "#E74C3C", textColour: "#E74C3C", weight: 4 },
];

/** The three families the owner asked for. A blessing belongs to exactly one. */
export const CATEGORIES = [
  { id: "physical", label: "Physical", colour: "#1ABC9C", textColour: "#1ABC9C" },
  { id: "equipment", label: "Equipment", colour: "#E67E22", textColour: "#E67E22" },
  { id: "potion", label: "Potion effect", colour: "#8E44AD", textColour: "#8E44AD" },
];

/**
 * The three **scopes**, and the colour each one is written in on the tile.
 *
 * The scope is the part of a blessing a player must read before choosing: two cards can say
 * "+20 % damage" and be worth very different things. It goes on the **title**, because a
 * description is one colour and the title is what is read first.
 */
export const SCOPES = [
  { id: "permanent", label: "Permanent", short: "PERM", textColour: "gold" },
  { id: "run", label: "This run", short: "RUN", textColour: "aqua" },
  { id: "timed", label: "Timed", short: "TIMED", textColour: "violet" },
];

/**
 * The catalogue.
 *
 * `icon` is an **in-game icon** (the `IngameIconName` values the client already draws),
 * used in chat; `cardIcon` is the Font Awesome one the top-right card needs, because
 * `sendTopRightHelper` only accepts those.
 *
 * `effect` is data, not code: `kind` says which channel it uses and the rest is its
 * magnitude. Every kind is applied by `src/blessing/effects.js`:
 *
 *   - `potion`  — an in-engine effect (`api.applyEffect`), `effectName` + `level`, and a
 *                 `durationMs` when the scope is `timed`;
 *   - `run`     — a number the run's bonus object carries, summed with the others;
 *   - `client`  — a **client option** (`option`), absolute (`mode: "set"`) or added to the
 *                 world's baseline (`mode: "add"`).
 *
 * `damage` and `reduction` below are **fractions of the engine's own scale**: `+20 %` is
 * `0.2`. That is how the damage multipliers and `receivingDamageMultiplier` are written, so
 * a bonus is added to a multiplier rather than multiplied twice.
 */
export const BLESSINGS = [
  // ------------------------------------------------------------- permanent --
  {
    id: "toughened_hide",
    name: "Toughened Hide",
    category: "physical",
    rarity: "uncommon",
    scope: "permanent",
    icon: "Max Health",
    cardIcon: "fa-solid fa-heart-pulse",
    description: "+5 max health, permanently.",
    effect: { kind: "client", option: "maxHealth", mode: "add", amount: 5 },
  },
  {
    id: "scarred_skin",
    name: "Scarred Skin",
    category: "physical",
    rarity: "rare",
    scope: "permanent",
    icon: "Damage Reduction",
    cardIcon: "fa-solid fa-shield-halved",
    description: "-1 % damage taken, permanently. \nCapped at -40 %.",
    effect: { kind: "client", option: "receivingDamageMultiplier", mode: "add", amount: -0.01, floor: 0.6 },
  },
  {
    id: "long_stride",
    name: "Long Stride",
    category: "physical",
    rarity: "rare",
    scope: "permanent",
    icon: "Speed",
    cardIcon: "fa-solid fa-shoe-prints",
    description: "+0.1 walk and run speed multiplier, permanently.",
    effect: { kind: "client", option: "speedMultiplier", mode: "add", amount: 0.1, also: { runningSpeed: 0.1, walkingSpeed: 0.1 } },
  },
  {
    id: "grim_focus",
    name: "Grim Focus",
    category: "equipment",
    rarity: "epic",
    scope: "permanent",
    icon: "Damage Enchantment",
    cardIcon: "fa-solid fa-swords",
    description: "+2 % damage dealt, permanently.",
    effect: { kind: "client", option: "dealingDamageMultiplier", mode: "add", amount: 0.02 },
  },

  // ------------------------------------------------------------------- run --
  {
    id: "battle_rush",
    name: "Battle Rush",
    category: "equipment",
    rarity: "common",
    scope: "run",
    icon: "Damage",
    cardIcon: "fa-solid fa-bolt",
    description: "+20 % damage dealt for this run.",
    effect: { kind: "run", bonus: "damage", amount: 0.2 },
  },
  {
    id: "worn_shield",
    name: "Worn Shield",
    category: "equipment",
    rarity: "common",
    scope: "run",
    icon: "Damage Reduction",
    cardIcon: "fa-solid fa-shield",
    description: "-15 % damage taken for this run.",
    effect: { kind: "run", bonus: "reduction", amount: 0.15 },
  },
  {
    id: "runner_legs",
    name: "Runner's Legs",
    category: "physical",
    rarity: "uncommon",
    scope: "run",
    icon: "Speed",
    cardIcon: "fa-solid fa-person-running",
    description: "+0.3 walk and run speed multiplier for this run.",
    effect: { kind: "run", bonus: "speed", amount: 0.3 },
  },
  {
    id: "thick_blood",
    name: "Thick Blood",
    category: "physical",
    rarity: "uncommon",
    scope: "run",
    icon: "Health",
    cardIcon: "fa-solid fa-droplet",
    description: "+15 max health for this run.",
    effect: { kind: "run", bonus: "maxHealth", amount: 15 },
  },
  {
    id: "venous_surge",
    name: "Venous Surge",
    category: "physical",
    rarity: "rare",
    scope: "run",
    icon: "Health Regen",
    cardIcon: "fa-solid fa-heart-circle-plus",
    description: "Health regen, stronger than the dungeon's own, for this run.",
    effect: { kind: "client", option: "healthRegenAmount", mode: "add", amount: 0.02 },
  },
  {
    id: "thorned_coat",
    name: "Thorned Coat",
    category: "potion",
    rarity: "rare",
    scope: "run",
    icon: "Thorns",
    cardIcon: "fa-solid fa-seedling",
    description: "Thorns: whatever hits you takes damage back.",
    effect: { kind: "potion", effectName: "Thorns", level: 1, durationMs: null },
  },
  {
    id: "iron_ribs",
    name: "Iron Ribs",
    category: "physical",
    rarity: "epic",
    scope: "run",
    icon: "Max Health",
    cardIcon: "fa-solid fa-shield-heart",
    description: "+40 max health for this run.",
    effect: { kind: "run", bonus: "maxHealth", amount: 40 },
  },
  {
    id: "butcher_hands",
    name: "Butcher Hands",
    category: "equipment",
    rarity: "epic",
    scope: "run",
    icon: "Damage Enchantment",
    cardIcon: "fa-solid fa-axe-battle",
    description: "+35 % damage dealt for this run.",
    effect: { kind: "run", bonus: "damage", amount: 0.35 },
  },
  {
    id: "wall_crawler",
    name: "Wall Crawler",
    category: "physical",
    rarity: "legendary",
    scope: "run",
    icon: "Wall Climbing",
    cardIcon: "fa-solid fa-spider",
    description: "Climb walls for this run.",
    effect: { kind: "client", option: "canClimbWalls", mode: "set", value: true },
  },

  // ----------------------------------------------------------------- timed --
  // A potion effect, and **only** a potion effect: the engine already ends those on time,
  // which is the owner's reason for letting the short blessings be nothing else.
  {
    id: "bloodletting",
    name: "Bloodletting",
    category: "potion",
    rarity: "common",
    scope: "timed",
    icon: "Damage",
    cardIcon: "fa-solid fa-burst",
    description: "+damage for 50 seconds.",
    effect: { kind: "potion", effectName: "Damage", level: 1, durationMs: 50000 },
  },
  {
    id: "hasty_hands",
    name: "Hasty Hands",
    category: "potion",
    rarity: "common",
    scope: "timed",
    icon: "Haste",
    cardIcon: "fa-solid fa-gauge-high",
    description: "Haste for 30 seconds.",
    effect: { kind: "potion", effectName: "Haste", level: 1, durationMs: 30000 },
  },
  {
    id: "bark_skin",
    name: "Bark Skin",
    category: "potion",
    rarity: "uncommon",
    scope: "timed",
    icon: "Damage Reduction",
    cardIcon: "fa-solid fa-tree",
    description: "-damage taken for 60 seconds.",
    effect: { kind: "potion", effectName: "Damage Reduction", level: 1, durationMs: 60000 },
  },
  {
    id: "swift_brew",
    name: "Swift Brew",
    category: "potion",
    rarity: "uncommon",
    scope: "timed",
    icon: "Speed",
    cardIcon: "fa-solid fa-wind",
    description: "Speed for 45 seconds.",
    effect: { kind: "potion", effectName: "Speed", level: 1, durationMs: 45000 },
  },
  {
    id: "mending_draught",
    name: "Mending Draught",
    category: "potion",
    rarity: "rare",
    scope: "timed",
    icon: "Health Regen",
    cardIcon: "fa-solid fa-flask-vial",
    description: "Health regen for 90 seconds.",
    effect: { kind: "potion", effectName: "Health Regen", level: 1, durationMs: 90000 },
  },
  {
    id: "long_reach",
    name: "Long Reach",
    category: "potion",
    rarity: "epic",
    scope: "timed",
    icon: "Haste",
    cardIcon: "fa-solid fa-hand-fist",
    description: "Strong haste for 2 minutes.",
    effect: { kind: "potion", effectName: "Haste", level: 2, durationMs: 120000 },
  },

  // ────────────── NEW: huge roguelike expansion (bonus/malus) ──────────────
  // Common — run tradeoffs inspired by Hades/Dead Cells
  {
    id: "light_pack",
    name: "Light Pack",
    category: "equipment",
    rarity: "common",
    scope: "run",
    icon: "Speed",
    cardIcon: "fa-solid fa-person-running",
    description: "+20% speed but -10% damage for this run.",
    effect: { kind: "client", option: "speedMultiplier", mode: "add", amount: 0.20, second: { option: "dealingDamageMultiplier", amount: -0.10 } },
  },
  {
    id: "hollow_bones",
    name: "Hollow Bones",
    category: "physical",
    rarity: "common",
    scope: "run",
    icon: "Speed",
    cardIcon: "fa-solid fa-feather-pointed",
    description: "+15% speed but -10 max health for this run.",
    effect: { kind: "client", option: "speedMultiplier", mode: "add", amount: 0.15, second: { option: "maxHealth", amount: -10 } },
  },
  {
    id: "bouncy_step",
    name: "Bouncy Step",
    category: "physical",
    rarity: "common",
    scope: "run",
    icon: "Bounciness",
    cardIcon: "fa-solid fa-basketball",
    description: "+15% speed but +8% damage taken for this run.",
    effect: { kind: "client", option: "speedMultiplier", mode: "add", amount: 0.15, second: { option: "receivingDamageMultiplier", amount: 0.08 } },
  },
  {
    id: "scouts_resolve",
    name: "Scout's Resolve",
    category: "physical",
    rarity: "common",
    scope: "run",
    icon: "Max Health",
    cardIcon: "fa-solid fa-compass",
    description: "+12 max health but -8% damage for this run.",
    effect: { kind: "client", option: "maxHealth", mode: "add", amount: 12, second: { option: "dealingDamageMultiplier", amount: -0.08 } },
  },
  // Uncommon run tradeoffs
  {
    id: "berserkers_brew",
    name: "Berserker's Brew",
    category: "equipment",
    rarity: "uncommon",
    scope: "run",
    icon: "Damage",
    cardIcon: "fa-solid fa-fire",
    description: "+25% damage but +12% damage taken for this run.",
    effect: { kind: "client", option: "dealingDamageMultiplier", mode: "add", amount: 0.25, second: { option: "receivingDamageMultiplier", amount: 0.12 } },
  },
  {
    id: "featherweight",
    name: "Featherweight",
    category: "physical",
    rarity: "uncommon",
    scope: "run",
    icon: "Speed",
    cardIcon: "fa-solid fa-wind",
    description: "+30% speed but -12 max health for this run.",
    effect: { kind: "client", option: "speedMultiplier", mode: "add", amount: 0.30, second: { option: "maxHealth", amount: -12 } },
  },
  {
    id: "frost_soul",
    name: "Frost Soul",
    category: "equipment",
    rarity: "uncommon",
    scope: "run",
    icon: "Frozen",
    cardIcon: "fa-solid fa-snowflake",
    description: "-18% damage taken but -18% speed for this run.",
    effect: { kind: "client", option: "receivingDamageMultiplier", mode: "add", amount: -0.18, second: { option: "speedMultiplier", amount: -0.18 } },
  },
  {
    id: "heavy_plate",
    name: "Heavy Plate",
    category: "equipment",
    rarity: "uncommon",
    scope: "run",
    icon: "Protection Enchantment",
    cardIcon: "fa-solid fa-shield",
    description: "-15% damage taken but -15% speed for this run.",
    effect: { kind: "client", option: "receivingDamageMultiplier", mode: "add", amount: -0.15, second: { option: "speedMultiplier", amount: -0.15 } },
  },
  {
    id: "eagle_eye",
    name: "Eagle Eye",
    category: "physical",
    rarity: "uncommon",
    scope: "run",
    icon: "Speed",
    cardIcon: "fa-solid fa-eye",
    description: "+15 max health but -10% speed for this run.",
    effect: { kind: "client", option: "maxHealth", mode: "add", amount: 15, second: { option: "speedMultiplier", amount: -0.10 } },
  },
  // Rare run tradeoffs
  {
    id: "storm_legs",
    name: "Storm Legs",
    category: "physical",
    rarity: "rare",
    scope: "run",
    icon: "Speed",
    cardIcon: "fa-solid fa-wind",
    description: "+35% speed but +15% damage taken for this run.",
    effect: { kind: "client", option: "speedMultiplier", mode: "add", amount: 0.35, second: { option: "receivingDamageMultiplier", amount: 0.15 } },
  },
  {
    id: "titan_heart_run",
    name: "Titan's Heart",
    category: "physical",
    rarity: "rare",
    scope: "run",
    icon: "Max Health",
    cardIcon: "fa-solid fa-heart-pulse",
    description: "+45 max health but -20% speed for this run.",
    effect: { kind: "client", option: "maxHealth", mode: "add", amount: 45, second: { option: "speedMultiplier", amount: -0.20 } },
  },
  {
    id: "glass_cannon_run",
    name: "Glass Cannon",
    category: "equipment",
    rarity: "rare",
    scope: "run",
    icon: "Damage Enchantment",
    cardIcon: "fa-solid fa-gun",
    description: "+40% damage but -20 max health for this run.",
    effect: { kind: "client", option: "dealingDamageMultiplier", mode: "add", amount: 0.40, second: { option: "maxHealth", amount: -20 } },
  },
  {
    id: "shadow_veil",
    name: "Shadow Veil",
    category: "physical",
    rarity: "rare",
    scope: "run",
    icon: "Invisibility",
    cardIcon: "fa-solid fa-ghost",
    description: "Can climb walls but -15 max health for this run.",
    effect: { kind: "client", option: "canClimbWalls", mode: "set", value: true, second: { option: "maxHealth", amount: -15 } },
  },
  {
    id: "ember_core",
    name: "Ember Core",
    category: "equipment",
    rarity: "rare",
    scope: "run",
    icon: "Damage",
    cardIcon: "fa-solid fa-fire-flame-curved",
    description: "+25% damage but -10 max health for this run.",
    effect: { kind: "client", option: "dealingDamageMultiplier", mode: "add", amount: 0.25, second: { option: "maxHealth", amount: -10 } },
  },
  {
    id: "poisoned_blade",
    name: "Poisoned Blade",
    category: "equipment",
    rarity: "rare",
    scope: "run",
    icon: "Poisoned",
    cardIcon: "fa-solid fa-skull-crossbones",
    description: "+22% damage but +8% damage taken for this run.",
    effect: { kind: "client", option: "dealingDamageMultiplier", mode: "add", amount: 0.22, second: { option: "receivingDamageMultiplier", amount: 0.08 } },
  },
  // Epic run tradeoffs
  {
    id: "colossus_plate",
    name: "Colossus Plate",
    category: "equipment",
    rarity: "epic",
    scope: "run",
    icon: "Damage Reduction",
    cardIcon: "fa-solid fa-shield-halved",
    description: "-30% damage taken but -25% speed for this run.",
    effect: { kind: "client", option: "receivingDamageMultiplier", mode: "add", amount: -0.30, second: { option: "speedMultiplier", amount: -0.25 } },
  },
  {
    id: "giant_leap",
    name: "Giant's Leap",
    category: "physical",
    rarity: "epic",
    scope: "run",
    icon: "Jump Boost",
    cardIcon: "fa-solid fa-person-jumping",
    description: "+35 max health but +15% damage taken for this run.",
    effect: { kind: "client", option: "maxHealth", mode: "add", amount: 35, second: { option: "receivingDamageMultiplier", amount: 0.15 } },
  },
  {
    id: "worldbreaker",
    name: "Worldbreaker",
    category: "physical",
    rarity: "epic",
    scope: "run",
    icon: "Damage",
    cardIcon: "fa-solid fa-hammer",
    description: "+30% damage but -15 max health for this run.",
    effect: { kind: "client", option: "dealingDamageMultiplier", mode: "add", amount: 0.30, second: { option: "maxHealth", amount: -15 } },
  },
  {
    id: "thorn_weave",
    name: "Thorn Weave",
    category: "equipment",
    rarity: "epic",
    scope: "run",
    icon: "Thorns",
    cardIcon: "fa-solid fa-leaf",
    description: "-18% damage taken but -12% speed for this run.",
    effect: { kind: "client", option: "receivingDamageMultiplier", mode: "add", amount: -0.18, second: { option: "speedMultiplier", amount: -0.12 } },
  },
  {
    id: "chrono_haste",
    name: "Chrono Haste",
    category: "physical",
    rarity: "epic",
    scope: "run",
    icon: "Haste",
    cardIcon: "fa-solid fa-stopwatch",
    description: "+30% speed but +12% damage taken for this run.",
    effect: { kind: "client", option: "speedMultiplier", mode: "add", amount: 0.30, second: { option: "receivingDamageMultiplier", amount: 0.12 } },
  },
  // Legendary run tradeoffs
  {
    id: "nightstalker",
    name: "Nightstalker",
    category: "physical",
    rarity: "legendary",
    scope: "run",
    icon: "Invisibility",
    cardIcon: "fa-solid fa-moon",
    description: "+35% speed but -20 max health for this run.",
    effect: { kind: "client", option: "speedMultiplier", mode: "add", amount: 0.35, second: { option: "maxHealth", amount: -20 } },
  },
  {
    id: "titans_footfall",
    name: "Titan's Footfall",
    category: "physical",
    rarity: "legendary",
    scope: "run",
    icon: "Max Health",
    cardIcon: "fa-solid fa-shoe-prints",
    description: "+40 max health but -18% speed for this run.",
    effect: { kind: "client", option: "maxHealth", mode: "add", amount: 40, second: { option: "speedMultiplier", amount: -0.18 } },
  },
  {
    id: "singularity",
    name: "Singularity",
    category: "equipment",
    rarity: "legendary",
    scope: "run",
    icon: "VoidJump",
    cardIcon: "fa-solid fa-atom",
    description: "+35% damage but +20% damage taken for this run.",
    effect: { kind: "client", option: "dealingDamageMultiplier", mode: "add", amount: 0.35, second: { option: "receivingDamageMultiplier", amount: 0.20 } },
  },
  {
    id: "divine_aegis",
    name: "Divine Aegis",
    category: "equipment",
    rarity: "legendary",
    scope: "run",
    icon: "Protection Enchantment",
    cardIcon: "fa-solid fa-shield-heart",
    description: "+50 max health but -12% damage for this run.",
    effect: { kind: "client", option: "maxHealth", mode: "add", amount: 50, second: { option: "dealingDamageMultiplier", amount: -0.12 } },
  },
  {
    id: "void_pact_run",
    name: "Void Pact",
    category: "equipment",
    rarity: "legendary",
    scope: "run",
    icon: "Brain Rot",
    cardIcon: "fa-solid fa-skull",
    description: "+30% damage but +18% damage taken for this run.",
    effect: { kind: "client", option: "dealingDamageMultiplier", mode: "add", amount: 0.30, second: { option: "receivingDamageMultiplier", amount: 0.18 } },
  },
  {
    id: "golden_fleece",
    name: "Golden Fleece",
    category: "equipment",
    rarity: "legendary",
    scope: "run",
    icon: "Health",
    cardIcon: "fa-solid fa-vest-patches",
    description: "+40 max health but -10% damage for this run.",
    effect: { kind: "client", option: "maxHealth", mode: "add", amount: 40, second: { option: "dealingDamageMultiplier", amount: -0.10 } },
  },
  // Permanent tradeoffs (stacking forever — Isaac-like)
  {
    id: "resilient_core",
    name: "Resilient Core",
    category: "physical",
    rarity: "common",
    scope: "permanent",
    icon: "Max Health",
    cardIcon: "fa-solid fa-heart",
    description: "+8 max health but -7% speed, permanently.",
    effect: { kind: "client", option: "maxHealth", mode: "add", amount: 8, second: { option: "speedMultiplier", amount: -0.07 } },
  },
  {
    id: "keen_edge_perm",
    name: "Keen Edge",
    category: "equipment",
    rarity: "common",
    scope: "permanent",
    icon: "Damage Enchantment",
    cardIcon: "fa-solid fa-swords",
    description: "+3% damage but -2 max health, permanently.",
    effect: { kind: "client", option: "dealingDamageMultiplier", mode: "add", amount: 0.03, second: { option: "maxHealth", amount: -2 } },
  },
  {
    id: "cursed_vitality",
    name: "Cursed Vitality",
    category: "physical",
    rarity: "uncommon",
    scope: "permanent",
    icon: "Health",
    cardIcon: "fa-solid fa-droplet",
    description: "+12 max health but +6% damage taken, permanently.",
    effect: { kind: "client", option: "maxHealth", mode: "add", amount: 12, second: { option: "receivingDamageMultiplier", amount: 0.06 } },
  },
  {
    id: "fleet_feet_perm",
    name: "Fleet Feet",
    category: "physical",
    rarity: "uncommon",
    scope: "permanent",
    icon: "Speed",
    cardIcon: "fa-solid fa-wind",
    description: "+6% speed but -3 max health, permanently.",
    effect: { kind: "client", option: "speedMultiplier", mode: "add", amount: 0.06, second: { option: "maxHealth", amount: -3 } },
  },
  {
    id: "adamant_skin",
    name: "Adamant Skin",
    category: "equipment",
    rarity: "rare",
    scope: "permanent",
    icon: "Damage Reduction",
    cardIcon: "fa-solid fa-mountain",
    description: "+15 max health but -10% speed, permanently.",
    effect: { kind: "client", option: "maxHealth", mode: "add", amount: 15, second: { option: "speedMultiplier", amount: -0.10 } },
  },
  {
    id: "glass_cannon_perm",
    name: "Glass Cannon (Perm)",
    category: "equipment",
    rarity: "epic",
    scope: "permanent",
    icon: "Damage",
    cardIcon: "fa-solid fa-gun",
    description: "+4% damage but -5 max health, permanently.",
    effect: { kind: "client", option: "dealingDamageMultiplier", mode: "add", amount: 0.04, second: { option: "maxHealth", amount: -5 } },
  },
  // Extra timed for variety (pure, since timed only potion)
  {
    id: "iron_will",
    name: "Iron Will",
    category: "potion",
    rarity: "rare",
    scope: "timed",
    icon: "Damage Reduction",
    cardIcon: "fa-solid fa-shield",
    description: "Damage Reduction II for 60 seconds.",
    effect: { kind: "potion", effectName: "Damage Reduction", level: 2, durationMs: 60000 },
  },
  {
    id: "phantom_step",
    name: "Phantom Step",
    category: "potion",
    rarity: "epic",
    scope: "timed",
    icon: "Invisibility",
    cardIcon: "fa-solid fa-ghost",
    description: "Invisibility for 30 seconds.",
    effect: { kind: "potion", effectName: "Invisible", level: 1, durationMs: 30000 },
  },
  {
    id: "frenzy_tonic",
    name: "Frenzy Tonic",
    category: "potion",
    rarity: "legendary",
    scope: "timed",
    icon: "Damage",
    cardIcon: "fa-solid fa-bolt",
    description: "Damage II for 40 seconds.",
    effect: { kind: "potion", effectName: "Damage", level: 2, durationMs: 40000 },
  },

  // ---------------------------------------------------------------- mythic --
  {
    id: "undying_heart",
    name: "Undying Heart",
    category: "equipment",
    rarity: "mythic",
    scope: "permanent",
    icon: "Lifesteal",
    cardIcon: "fa-solid fa-gem",
    description: "+25 max health and -5 % damage taken, permanently.",
    effect: {
      kind: "client",
      option: "maxHealth",
      mode: "add",
      amount: 25,
      second: { option: "receivingDamageMultiplier", amount: -0.05, floor: 0.6 },
    },
  },
];

/** Every rarity, and every family, must have something: an empty slice is a dead weight. */

/** The scope with this id, or `null`. */
export function scopeOf(id) {
  return SCOPES.find((entry) => entry.id === id) || null;
}

/**
 * The **XP scale of this world**, written once and applied to every player.
 *
 * The game charges `auraPerLevel` aura for each level and stops at `maxAuraLevel`; by
 * default that is 100 aura a level, and a cap the owner wants lower so a run's aura buys
 * something instead of dribbling into empty levels. Both numbers are set here and pushed by
 * `setClientOptions` — the game is told, rather than the code guessing what it charges.
 *
 * `AURA_PER_LEVEL` also decides what a room's aura is worth in levels, so it is a balance
 * number as much as an API one: 10 aura a room at 50 a level is a point every five rooms,
 * and a Very Easy run — the entrance plus the ring of rooms around it — pays for roughly one
 * choice.
 */
export const AURA_PER_LEVEL = 50;

/**
 * The highest level this world allows. **Lowered from the game's own ceiling**, and the
 * pool of points is the level itself: a player who reaches it holds the whole ladder.
 */
export const MAX_AURA_LEVEL = 999;

/**
 * The level a player starts at: a fresh player is level 1 with no aura, and therefore
 * **no points**. Points are `level - AURA_LEVEL_BASE`, which is what the owner asked for —
 * one point per level gained, not one per level reached.
 */
export const AURA_LEVEL_BASE = 1;

/** Reroll cost — paid in gold, scales with blessings already taken. Very affordable. */
export const REROLL_BASE_GOLD = 50;
export const REROLL_GOLD_PER_BLESSING = 15;
export function rerollGoldCost(spent) {
  const n = Number.isFinite(spent) ? Math.max(0, Math.floor(spent)) : 0;
  return REROLL_BASE_GOLD + n * REROLL_GOLD_PER_BLESSING;
}

/** Points earned per aura level — 1 blessing every 2 aura levels (owner request). */
export const POINTS_PER_LEVEL = 0.5;
export const BLESSING_LEVEL_STEP = 2;

/** Every point this world can pay out: the whole ladder, from level 1 to the cap. */
export function maxPoints() {
  return Math.floor((MAX_AURA_LEVEL - AURA_LEVEL_BASE) / BLESSING_LEVEL_STEP);
}

/**
 * How many blessings a roll **offers**. The owner asked for three: enough that the
 * choice is a choice, few enough that a shop screen holds them without scrolling.
 */
export const CHOICE_COUNT = 3;

/** The rarity with this id, or `null` for a name nobody uses. */
export function rarityOf(id) {
  return RARITIES.find((entry) => entry.id === id) || null;
}

/** The family with this id, or `null`. */
export function categoryOf(id) {
  return CATEGORIES.find((entry) => entry.id === id) || null;
}

/** The blessing with this id, or `null`. The world code uses it when reading a save. */
export function blessingOf(id) {
  return BLESSINGS.find((entry) => entry.id === id) || null;
}

/** Every blessing of a rarity, in catalogue order. */
export function blessingsOf(rarityId, catalogue = BLESSINGS) {
  return catalogue.filter((entry) => entry.rarity === rarityId);
}

/** Every blessing of a scope, in catalogue order. */
export function blessingsWithScope(scopeId, catalogue = BLESSINGS) {
  return catalogue.filter((entry) => entry.scope === scopeId);
}

/**
 * The rarities that can actually be drawn, with their weight and their chance.
 *
 * A rarity with no blessing is **left out**, not drawn and then thrown away: a Mythic
 * slot with an empty pool would otherwise turn into a reroll nobody asked for. The
 * weights are renormalised, so the chances always sum to 1.
 */
export function rarityOdds(catalogue = BLESSINGS) {
  const filled = RARITIES
    .map((rarity) => ({ rarity, pool: blessingsOf(rarity.id, catalogue) }))
    .filter((entry) => entry.pool.length > 0);
  const total = filled.reduce((sum, entry) => sum + entry.rarity.weight, 0);
  return filled.map((entry) => ({
    rarity: entry.rarity,
    pool: entry.pool,
    weight: entry.rarity.weight,
    chance: total > 0 ? entry.rarity.weight / total : 0,
  }));
}

/** A percentage as short as it can be without lying: 60, 9.6, 0.2 — never 0. */
export function formatPercent(chance) {
  const percent = chance * 100;
  if (percent >= 10) return `${Math.round(percent)}%`;
  const tenths = Math.round(percent * 10) / 10;
  return `${tenths < 0.1 && percent > 0 ? 0.1 : tenths}%`;
}

/**
 * Draws a blessing: a rarity by weight, then a blessing of it at random.
 *
 * `random` is a parameter rather than `Math.random` read inside, for the same reason
 * `drawChestKey` takes one: a distribution is only testable if the draw can be fed.
 */
export function drawBlessing(random = Math.random, catalogue = BLESSINGS) {
  const odds = rarityOdds(catalogue);
  if (odds.length === 0) return null;
  const total = odds.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  let picked = odds[odds.length - 1];
  for (const entry of odds) {
    roll -= entry.weight;
    if (roll < 0) {
      picked = entry;
      break;
    }
  }
  // A `random()` that returns exactly 1, or a weight of 0, still gives a blessing:
  // the last entry is the floor of the draw, never nothing.
  const index = Math.min(picked.pool.length - 1, Math.floor(random() * picked.pool.length));
  return { blessing: picked.pool[index], rarity: picked.rarity };
}

/**
 * Draws the **offer**: `CHOICE_COUNT` blessings from the whole wheel, all different.
 *
 * It is `CHOICE_COUNT` independent draws of `drawBlessing`, not one blessing per rarity:
 * the odds a player sees are the odds of every slot, so a Mythic has the same ~0.2 % chance
 * in all three — three shots at it, not one rarity dealt out by hand.
 *
 * **All different**, because an offer of two `Bloodletting` is not a choice. A repeated draw
 * is thrown away and drawn again: the pool is far larger than three, so this settles in a
 * try or two, and a catalogue too small to fill an offer is filled with whatever it has
 * rather than padded with a duplicate.
 */
export function drawChoices(random = Math.random, catalogue = BLESSINGS) {
  const wanted = Math.min(CHOICE_COUNT, catalogue.length);
  const picked = [];
  const taken = new Set();
  // The bound is a guard, not a rule: a catalogue of three would otherwise loop for ever
  // once every entry is taken, which cannot happen before `wanted` is reached.
  for (let tries = 0; picked.length < wanted && tries < catalogue.length * 8; tries += 1) {
    const draw = drawBlessing(random, catalogue);
    if (!draw || taken.has(draw.blessing.id)) continue;
    taken.add(draw.blessing.id);
    picked.push(draw);
  }
  // A generator that always lands on the same entry cannot fill the offer by drawing, and
  // the guarantee is worth more than the draw: what is missing is taken from the catalogue,
  // so three choices are three **different** blessings even then.
  if (picked.length < wanted) {
    for (const blessing of catalogue) {
      if (picked.length >= wanted) break;
      if (taken.has(blessing.id)) continue;
      taken.add(blessing.id);
      picked.push({ blessing, rarity: rarityOf(blessing.rarity) });
    }
  }
  return picked;
}

/** Points earned by reaching this aura level, spending included. */
export function pointsEarned(level) {
  const reached = Number.isFinite(level) ? Math.floor(level) : AURA_LEVEL_BASE;
  return Math.floor(Math.max(0, reached - AURA_LEVEL_BASE) / BLESSING_LEVEL_STEP);
}

/**
 * Points left: what the levels paid for, minus what has been **held** — the ones spent on a
 * choice and the ones waiting in the current offer. Never negative.
 *
 * The offer counts as spent on purpose: three cards on the table are three points promised,
 * and a player must not be able to roll three offers from one level's worth of points by
 * spending on credit.
 */
export function pointsLeft(level, spent) {
  const used = Number.isFinite(spent) ? Math.max(0, Math.floor(spent)) : 0;
  return Math.max(0, pointsEarned(level) - used);
}

/**
 * A hex colour as `rgb(r, g, b)`.
 *
 * `sendTopRightHelper` is explicit about this in the docs — its `color` must be `rgb()`,
 * and hex is not supported — so the card's background is converted rather than guessed.
 * Anything that is not a six-digit hex comes back unchanged, which is the least
 * surprising thing a colour helper can do.
 */
export function rgbOf(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}
