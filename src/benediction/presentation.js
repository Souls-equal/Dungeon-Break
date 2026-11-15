/*
 * The look of a benediction: one card, one chat line, one shop tile.
 *
 * The owner's goal for this first version is visual, so all of the presentation lives here
 * and none of it lives in the world code. Three surfaces, and each uses the API that
 * actually supports it:
 *
 *   - the **shop tile** takes `string | CustomTextStyling` for its title and description,
 *     so a rarity can be written in its colour there;
 *   - the **chat line** takes `CustomTextStyling` too, and the rarity name goes in colour
 *     followed by the benediction's own name;
 *   - the **card** is `sendTopRightHelper`, which takes an icon, plain text and an `rgb()`
 *     background — no markup, no hex — so it is built from the colour table rather than
 *     from a string a player could break.
 *
 * A function that returns styling never throws and never returns `undefined`: an empty
 * string is a message the game drops, and a card that fails is not worth a broken roll.
 */

import { CHOICE_COUNT, categoryOf, formatPercent, rgbOf, rarityOdds } from "./config.js";

/** The rarity name, in its own colour: what every surface shares. */
export function rarityText(rarity) {
  return [{ str: rarity.label, style: { color: rarity.textColour, fontWeight: "bold" } }];
}

/** `Iron Hide` — the benediction's name, in its rarity's colour. */
export function nameText(benediction, rarity) {
  return [{ str: benediction.name, style: { color: rarity.textColour, fontWeight: "bold" } }];
}

/** `Physical · Common`, for a line that has to stay short. */
export function tagText(benediction, rarity) {
  const category = categoryOf(benediction.category);
  return [
    `${category ? category.label : "Unknown"} · `,
    ...rarityText(rarity),
  ];
}

/** The chat line of a roll, as custom styling the game can draw. */
export function rollMessage(benediction, rarity) {
  return [
    "Benediction: ",
    ...nameText(benediction, rarity),
    " — ",
    ...tagText(benediction, rarity),
  ];
}

/** `Common 60% · Uncommon 25% · …`: the table's odds in one line, for the tile. */
export function oddsOfTable() {
  return rarityOdds()
    .map((entry) => `${entry.rarity.label} ${formatPercent(entry.chance)}`)
    .join(" · ");
}

/**
 * The card shown when a roll lands: `sendTopRightHelper(playerId, icon, text, opts)`.
 *
 * `duration` is in **seconds** for this call (the API's default is 8), and the colour is
 * `rgb()` because the docs say hex is refused there. The text is plain — the card has no
 * markup — so it carries the name, the rarity and the family on separate lines.
 */
export function cardFor(benediction, rarity) {
  const category = categoryOf(benediction.category);
  return {
    icon: benediction.cardIcon,
    text: `${benediction.name}\n${rarity.label} · ${category ? category.label : "Unknown"}\n${benediction.description}`,
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
 * The tile of one offered benediction: the shop's three choices, each a shop item.
 *
 * A shop tile is the only "card" a player can click, so an offer is three tiles whose
 * titles are the benediction's name, whose descriptions carry the rarity, the family and
 * what it does, and whose button is `Choose` — the shape of the request: roll, get three,
 * pick one, the shop goes back to normal.
 *
 * The rarity is **named** rather than colour-coded: a tile's description is a single
 * colour, and inventing a colour for it would be a second source of truth next to the
 * table. `colour` rides along for the card drawn once a choice is made.
 */
export function choiceTile(draw, position) {
  const { benediction, rarity } = draw;
  const category = categoryOf(benediction.category);
  return {
    // A block name is an image the game already has, like the spawn item's. The family
    // picks it, so three choices are never three identical tiles.
    image: imageOf(benediction.category),
    customTitle: benediction.name,
    description: `${rarity.label} · ${category ? category.label : "Unknown"}\n${benediction.description}\nChoose it, or pick another of the ${CHOICE_COUNT}.`,
    buyButtonText: "Choose",
    cost: 0,
    canBuy: true,
    sortPriority: 100 - position,
    onBoughtMessage: `${benediction.name} chosen.`,
  };
}

/** `1. Iron Hide — Common · Physical`, for a line that has to list the offer. */
export function offerLine(draw, position) {
  const category = categoryOf(draw.benediction.category);
  return `${position + 1}. ${draw.benediction.name} — ${draw.rarity.label} · ${category ? category.label : "Unknown"}`;
}

/** The one line the middle of the screen shows, kept short enough to read at a glance. */
export function announcementOf(benediction, rarity) {
  return `${benediction.name} — ${rarity.label}`;
}
