/*
 * The look of a blessing: one card, one chat line, one shop tile.
 *
 * All of the presentation lives here and none of it lives in the world code. Three
 * surfaces, and each uses the API that actually supports it:
 *
 *   - the **shop tile** takes `string | CustomTextStyling` for its title and description,
 *     so a rarity can be written in its colour there;
 *   - the **chat line** takes `CustomTextStyling` too, and the rarity name goes in colour
 *     followed by the blessing's own name;
 *   - the **card** is `sendTopRightHelper`, which takes an icon, plain text and an `rgb()`
 *     background — no markup, no hex — so it is built from the colour table rather than
 *     from a string a player could break.
 *
 * A function that returns styling never throws and never returns `undefined`: an empty
 * string is a message the game drops, and a card that fails is not worth a broken roll.
 */

import { CHOICE_COUNT, categoryOf, formatPercent, rgbOf, rarityOdds, scopeOf } from "./config.js";
import { scopeKeyOf } from "./effects.js";

/** The rarity name, in its own colour: what every surface shares. */
export function rarityText(rarity) {
  return [{ str: rarity.label, style: { color: rarity.textColour, fontWeight: "bold" } }];
}

/** `Toughened Hide` — the blessing's name, in its rarity's colour. */
export function nameText(blessing, rarity) {
  return [{ str: blessing.name, style: { color: rarity.textColour, fontWeight: "bold" } }];
}

/** The scope of a blessing, as a short word: `PERM`, `RUN`, `TIMED`. */
export function scopeShortOf(blessing) {
  const scope = scopeOf(scopeKeyOf(blessing));
  return scope ? scope.short : "RUN";
}

/** `Permanent`, `This run`, `Timed`: what the card and the chat say in full. */
export function scopeLabelOf(blessing) {
  const scope = scopeOf(scopeKeyOf(blessing));
  return scope ? scope.label : "This run";
}

/** `Physical · Common`, for a line that has to stay short. */
export function tagText(blessing, rarity) {
  const category = categoryOf(blessing.category);
  return [
    `${category ? category.label : "Unknown"} · `,
    ...rarityText(rarity),
  ];
}

/** The chat line of a roll, as custom styling the game can draw. */
export function rollMessage(blessing, rarity) {
  return [
    "Blessing: ",
    ...nameText(blessing, rarity),
    " — ",
    ...tagText(blessing, rarity),
  ];
}

/** `Common 60% · Uncommon 25% · …`: the table's odds in one line, for the report. */
export function oddsOfTable() {
  return rarityOdds()
    .map((entry) => `${entry.rarity.label} ${formatPercent(entry.chance)}`)
    .join(" · ");
}

/**
 * The card shown when a choice lands: `sendTopRightHelper(playerId, icon, text, opts)`.
 *
 * `duration` is in **seconds** for this call (the API's default is 8), and the colour is
 * `rgb()` because the docs say hex is refused there. The text is plain — the card has no
 * markup — so it carries the name, the rarity, the scope and the family on separate lines.
 */
export function cardFor(blessing, rarity) {
  const category = categoryOf(blessing.category);
  return {
    icon: blessing.cardIcon,
    text: `${blessing.name}\n${rarity.label} · ${scopeLabelOf(blessing)} · ${category ? category.label : "Unknown"}\n${blessing.description}`,
    opts: {
      duration: 6,
      color: rgbOf(rarity.colour),
      textAndIconColor: "white",
    },
  };
}

/**
 * The picture of a family — now per spec:
 * - Equipment → Chestplates of different materials per rarity
 * - Physical  → Block of materials per rarity (like equipment)
 * - Potion    → Icon related to the potion effect (IngameIconName from docs)
 */
const EQUIPMENT_IMAGES_BY_RARITY = {
  common: "Wood Chestplate",
  uncommon: "Iron Chestplate",
  rare: "Iron Chestplate",
  epic: "Gold Chestplate",
  legendary: "Diamond Chestplate",
  mythic: "Diamond Chestplate",
};
const PHYSICAL_IMAGES_BY_RARITY = {
  common: "Block of Coal",
  uncommon: "Block of Iron",
  rare: "Block of Iron",
  epic: "Block of Gold",
  legendary: "Block of Diamond",
  mythic: "Block of Diamond",
};

export function imageForBlessing(blessing, rarity) {
  const cat = blessing.category;
  const rid = rarity ? rarity.id : blessing.rarity;
  if (cat === "equipment") return EQUIPMENT_IMAGES_BY_RARITY[rid] || "Iron Chestplate";
  if (cat === "physical") return PHYSICAL_IMAGES_BY_RARITY[rid] || "Block of Iron";
  if (cat === "potion") {
    // Use icon related to the effect — IngameIconName from docs (e.g. Speed, Damage, Haste)
    if (blessing.icon) return blessing.icon;
    return "Potion Table";
  }
  return "Beacon";
}

/** Legacy: The image of a family, and `Beacon` for a family nobody has a picture for. */
export function imageOf(categoryId) {
  const map = { physical: "Block of Iron", equipment: "Block of Diamond", potion: "Potion Table" };
  return map[categoryId] || "Beacon";
}

// ---- Gain/Loose helpers for description (no +/-) ----
function formatEffectAmount(option, amount) {
  // Human-readable label for client options
  const labels = {
    maxHealth: "max health",
    receivingDamageMultiplier: "resistance",
    dealingDamageMultiplier: "damage",
    speedMultiplier: "speed",
    healthRegenAmount: "health regen",
    canClimbWalls: "wall climbing",
    runningSpeed: "speed",
    walkingSpeed: "speed",
  };
  const label = labels[option] || option;
  if (option === "canClimbWalls") return amount ? "Gain wall climbing" : "Loose wall climbing";
  // Multipliers are fractions (0.2 = 20%)
  const isPercent = option.includes("Multiplier") || option === "healthRegenAmount";
  let pct = "";
  if (isPercent) {
    // keep one decimal if needed, else integer
    const perc = Math.round(Math.abs(amount) * 1000) / 10;
    pct = Number.isInteger(perc) ? `${perc}%` : `${perc}%`;
  } else {
    pct = `${Math.abs(amount)}`;
  }
  // receivingDamageMultiplier: negative = gain resistance, positive = loose
  if (option === "receivingDamageMultiplier") {
    return amount < 0 ? `Gain ${pct} ${label}` : `Loose ${pct} ${label}`;
  }
  return amount > 0 ? `Gain ${pct} ${label}` : `Loose ${pct} ${label}`;
}

function describeClientEffect(effect) {
  if (!effect || !effect.option) return null;
  if (effect.mode === "set") return formatEffectAmount(effect.option, effect.value ? 1 : -1);
  const main = formatEffectAmount(effect.option, effect.amount);
  if (effect.second) {
    const sec = effect.second.option ? formatEffectAmount(effect.second.option, effect.second.amount ?? effect.second.value) : null;
    if (sec) {
      // Tradeoff: always line-break before Loose for readable shop tile
      if (sec.startsWith("Loose")) return `${main}\n${sec}`;
      return `${main} ${sec}`;
    }
  }
  return main;
}

function describeRunBonus(effect) {
  const map = { damage: "damage", reduction: "resistance", speed: "speed", maxHealth: "max health" };
  const label = map[effect.bonus] || effect.bonus;
  const abs = Math.abs(effect.amount);
  const pct = effect.bonus === "maxHealth" ? `${abs}` : `${Math.round(abs * 100)}%`;
  return effect.amount > 0 ? `Gain ${pct} ${label}` : `Loose ${pct} ${label}`;
}

function describePotionEffect(effect) {
  if (!effect) return null;
  const name = effect.effectName || "effect";
  const lvl = effect.level > 1 ? ` ${effect.level}` : "";
  // Loose not used for potions (all positive), but handle negative level? always Gain
  return `Gain ${name}${lvl}`;
}

export function effectDescription(blessing) {
  const eff = blessing.effect;
  if (!eff) return blessing.description || "";
  if (eff.kind === "client") {
    const parts = [];
    const primary = describeClientEffect(eff);
    if (primary) parts.push(primary);
    const out = parts.join(" ") || blessing.description;
    // Ensure any remaining " Loose" is split onto new line (shop tile readability)
    return out.replace(/ Loose/g, "\nLoose");
  }
  if (eff.kind === "run") {
    return describeRunBonus(eff);
  }
  if (eff.kind === "potion") {
    // timed vs run potion
    if (Number.isFinite(eff.durationMs)) {
      const secs = Math.round(eff.durationMs / 1000);
      return `${describePotionEffect(eff)} for ${secs}s`;
    }
    return describePotionEffect(eff);
  }
  return blessing.description;
}

/**
 * The tile of one offered blessing: the shop's three choices, each a shop item.
 *
 * A shop tile is the only "card" a player can click, so an offer is three tiles whose
 * titles are the blessing's name **and its scope** — a permanent and a timed blessing can
 * both say "+damage", and only the scope tells a player what they are buying — and whose
 * button is `Choose`.
 *
 * The rarity is **named** rather than colour-coded: a tile's description is a single
 * colour, and inventing a colour for it would be a second source of truth next to the
 * table. `colour` rides along for the card drawn once a choice is made.
 */
export function choiceTile(draw, position) {
  const { blessing, rarity } = draw;
  const category = categoryOf(blessing.category) || { label: blessing.category, colour: "#ffffff", textColour: "#ffffff" };
  const rarityColor = rarity ? (rarity.colour || rarity.textColour) : "#ffffff";
  const catColor = category.colour || category.textColour || "#ffffff";
  const rawEffect = effectDescription(blessing);
  const effectStr = rawEffect.replace(/ Loose/g, "\nLoose");
  return {
    image: imageForBlessing(blessing, rarity),
    customTitle: blessing.name,
    description: [
      { str: `[${rarity ? rarity.label : "Unknown"}]\n`, style: { color: rarityColor } },
      { str: `[${category.label}]\n`, style: { color: catColor } },
      { str: effectStr },
    ],
    buyButtonText: "Choose",
    cost: 0,
    canBuy: true,
    sortPriority: 100 - position,
    onBoughtMessage: `${blessing.name} chosen.`,
  };
}
/** `1. Iron Hide — Common · Physical`, for a line that has to list the offer. */
export function offerLine(draw, position) {
  const category = categoryOf(draw.blessing.category);
  return `${position + 1}. ${draw.blessing.name} (${scopeShortOf(draw.blessing)}) — ${draw.rarity.label} · ${category ? category.label : "Unknown"}`;
}

/** The one line the middle of the screen shows, kept short enough to read at a glance. */
export function announcementOf(blessing, rarity) {
  return `${blessing.name} — ${rarity.label}`;
}

/** `+20 % damage dealt for this run`: the description without its flavour, for the chat. */
export function effectLineOf(blessing) {
  return `${blessing.description.replace(/\s*\(No effect yet\.\)\s*$/, "")}`;
}

/** How many choices an offer has, for the chat line that introduces it. */
export function choiceCount() {
  return CHOICE_COUNT;
}
