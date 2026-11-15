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

import { categoryOf, formatPercent, rgbOf, rarityOdds } from "./config.js";

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

/**
 * The shop tile's description.
 *
 * Two colours in one string is not possible — a description that is a string is drawn as
 * one colour — so the rarity is written first, followed by the odds of the whole table,
 * which is the only other thing a player needs before spending a point.
 */
export function rollDescription() {
  return `Roll one Benediction. ${rarityOdds().length} rarities, weight by weight: ${oddsOfTable()}`;
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

/** The one line the middle of the screen shows, kept short enough to read at a glance. */
export function announcementOf(benediction, rarity) {
  return `${benediction.name} — ${rarity.label}`;
}
