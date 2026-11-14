/*
 * The items a chest gives, checked against the game's own list.
 *
 * A name that is not in `ITEM_NAMES.txt` is a silent no-op in game: `giveItem` takes an
 * `ItemName`, and a typo does not throw, it just does nothing — a chest that pays nothing.
 * So the names live here once, and `tools/build-world-code.mjs` refuses a bundle that
 * names an item the ship does not know, the same way it refuses a missing `copyChunk`.
 *
 * The five keys are **separate items**, not one `Key` with a label: the ship's list has
 * `Wooden Key` … `Diamond Key` and no plain `Key`, which is also what the owner asked for.
 */

/** The item name for a key of a given label — `Wooden` → `Wooden Key`. */
export function keyItemName(label) {
  return `${label} Key`;
}

/** Every item name this module can produce, for the build check. */
export const GIVEN_ITEMS = ["Wooden Key", "Stone Key", "Iron Key", "Gold Key", "Diamond Key"];
