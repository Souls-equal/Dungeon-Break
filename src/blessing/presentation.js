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
 * The picture of a family.
 *
 * The shop takes a **block name** as an image, so this is a table of blocks the player
 * already knows, one per family: a shield for the body, armour for the gear, a bottle for
 * the brews. Nothing is placed in the world — the game only draws the picture.
 */
const FAMILY_IMAGES = {
  physical: "Block of Iron",
  equipment: "Block of Diamond",
  potion: "Potion Table",
};

/** The image of a family, and `Beacon` for a family nobody has a picture for. */
export function imageOf(categoryId) {
  return FAMILY_IMAGES[categoryId] || "Beacon";
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
  const category = categoryOf(blessing.category);
  return {
    // A block name is an image the game already has, like the spawn item's. The family
    // picks it, so three choices are never three identical tiles.
    image: imageOf(blessing.category),
    customTitle: `${blessing.name} (${scopeShortOf(blessing)})`,
    description: `${rarity.label} · ${category ? category.label : "Unknown"} · ${scopeLabelOf(blessing)}\n${blessing.description}`,
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
