import test from "node:test";
import assert from "node:assert/strict";

import {
  AURA_LEVEL_BASE,
  BENEDICTIONS,
  CHOICE_COUNT,
  CATEGORIES,
  RARITIES,
  benedictionsOf,
  categoryOf,
  drawBenediction,
  drawChoices,
  formatPercent,
  pointsEarned,
  pointsLeft,
  rarityOdds,
  rarityOf,
  rgbOf,
} from "../../src/benediction/config.js";
import { createBenedictionService } from "../../src/benediction/service.js";
import {
  announcementOf,
  cardFor,
  nameText,
  oddsOfTable,
  rarityText,
  rollDescription,
  rollMessage,
  tagText,
} from "../../src/benediction/presentation.js";

// ------------------------------------------------------------------ tables --

test("the six rarities are the owner's, in his order and his colours", () => {
  assert.deepEqual(RARITIES.map((entry) => entry.label), [
    "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic",
  ]);
  // Grey, green, blue, purple, orange, red — the owner's list, one for one.
  assert.deepEqual(RARITIES.map((entry) => entry.colour), [
    "#9e9e9e", "#55ff55", "#55aaff", "#c04bff", "#ff9d00", "#ff2d2d",
  ]);
  for (const rarity of RARITIES) {
    assert.ok(rarity.textColour, `${rarity.label} has no colour for styled text`);
    assert.ok(rarity.weight > 0, `${rarity.label} can never be drawn`);
  }
  // Rarer means rarer: the weights strictly fall as the list goes on.
  for (let index = 1; index < RARITIES.length; index += 1) {
    assert.ok(RARITIES[index].weight < RARITIES[index - 1].weight,
      `${RARITIES[index].label} is not rarer than ${RARITIES[index - 1].label}`);
  }
});

test("the three families are the owner's, and every benediction belongs to exactly one", () => {
  assert.deepEqual(CATEGORIES.map((entry) => entry.label), ["Physical", "Equipment", "Potion effect"]);
  const ids = new Set(BENEDICTIONS.map((entry) => entry.id));
  assert.equal(ids.size, BENEDICTIONS.length, "two benedictions share an id");
  for (const benediction of BENEDICTIONS) {
    assert.ok(categoryOf(benediction.category), `${benediction.name} has no family`);
    assert.ok(rarityOf(benediction.rarity), `${benediction.name} has no rarity`);
    assert.ok(benediction.icon, `${benediction.name} has no in-game icon`);
    assert.ok(benediction.cardIcon, `${benediction.name} has no card icon`);
    assert.match(benediction.description, /No effect yet\./, `${benediction.name} promises something it does not do`);
  }
});

test("every rarity and every family is represented in the catalogue", () => {
  for (const rarity of RARITIES) {
    assert.ok(benedictionsOf(rarity.id).length > 0, `nothing is ${rarity.label}`);
  }
  for (const category of CATEGORIES) {
    assert.ok(BENEDICTIONS.some((entry) => entry.category === category.id),
      `the ${category.label} family is empty`);
  }
});

// -------------------------------------------------------------------- odds --

test("the odds are normalised, and reach every rarity", () => {
  const odds = rarityOdds();
  assert.equal(odds.length, RARITIES.length, "a rarity was dropped from the table");
  const total = odds.reduce((sum, entry) => sum + entry.chance, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `the chances sum to ${total}`);
  for (const entry of odds) {
    assert.ok(entry.chance > 0, `${entry.rarity.label} can never be rolled`);
    assert.ok(entry.pool.length > 0);
  }
  // The shape the weights describe: about 60 % Common, and a Mythic well under 1 %.
  assert.ok(odds[0].chance > 0.55 && odds[0].chance < 0.65);
  assert.ok(odds[odds.length - 1].chance < 0.01);
});

test("a rarity with no benediction is left out instead of being rerolled", () => {
  // The table follows the catalogue: emptying a rarity must remove its slice of
  // probability, not turn its rolls into a second draw nobody asked for. The table is a
  // parameter for exactly this reason.
  const withoutMythic = BENEDICTIONS.filter((entry) => entry.rarity !== "mythic");
  const odds = rarityOdds(withoutMythic);
  assert.equal(odds.length, RARITIES.length - 1, "an empty rarity stayed in the table");
  assert.ok(!odds.some((entry) => entry.rarity.id === "mythic"));
  const total = odds.reduce((sum, entry) => sum + entry.chance, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `the remaining rarities do not add up: ${total}`);

  // And a draw over the shortened wheel never lands on the empty one.
  for (let index = 0; index < 500; index += 1) {
    const draw = drawBenediction(() => index / 500, withoutMythic);
    assert.notEqual(draw.rarity.id, "mythic");
  }
});

test("a draw always answers, whatever the generator says", () => {
  for (const value of [0, 0.4999, 0.5, 0.999999, 1]) {
    const draw = drawBenediction(() => value);
    assert.ok(draw, `a roll of ${value} gave nothing`);
    assert.ok(draw.benediction);
    assert.ok(draw.rarity);
    assert.equal(draw.benediction.rarity, draw.rarity.id);
  }
  // A generator that walks the wheel hits each rarity in turn, which is what "by weight"
  // has to mean: the same table a player sees, drawn in order.
  const seen = new Set();
  // 2 000 points around the wheel: a Mythic is 0.2 % of it, so the grain has to be
  // finer than its slice or the test would accuse the table of a hole it does not have.
  for (let index = 0; index < 2000; index += 1) {
    const draw = drawBenediction(() => index / 2000);
    seen.add(draw.rarity.id);
  }
  assert.equal(seen.size, RARITIES.length, "a rarity is unreachable through the wheel");
});

test("odds are written short and never rounded to nothing", () => {
  assert.equal(formatPercent(0.6), "60%");
  assert.equal(formatPercent(0.096), "9.6%");
  assert.equal(formatPercent(0.002), "0.2%");
  assert.equal(formatPercent(0.00001), "0.1%", "an unlikely rarity was written as 0%");
  assert.match(oddsOfTable(), /^Common 60% · Uncommon 25% · /);
});

test("three choices are drawn, all different, from the whole wheel", () => {
  for (let index = 0; index < 200; index += 1) {
    const choices = drawChoices();
    assert.equal(choices.length, CHOICE_COUNT);
    assert.equal(new Set(choices.map((draw) => draw.benediction.id)).size, CHOICE_COUNT,
      "an offer repeated a benediction");
    for (const draw of choices) assert.equal(draw.benediction.rarity, draw.rarity.id);
  }
  // A catalogue too small for three is filled to what it has, never padded with a copy.
  const two = BENEDICTIONS.slice(0, 2);
  const small = drawChoices(Math.random, two);
  assert.equal(small.length, 2);
  assert.equal(new Set(small.map((draw) => draw.benediction.id)).size, 2);
  // And a generator that never moves still fills the offer from the catalogue.
  const stuck = drawChoices(() => 0.999999);
  assert.equal(stuck.length, CHOICE_COUNT);
  assert.equal(new Set(stuck.map((draw) => draw.benediction.id)).size, CHOICE_COUNT);
});

// ------------------------------------------------------------------ points --

test("an aura level pays one point, and the first level pays none", () => {
  assert.equal(AURA_LEVEL_BASE, 1);
  assert.equal(pointsEarned(1), 0, "a brand-new player was given a point for nothing");
  assert.equal(pointsEarned(2), 1);
  assert.equal(pointsEarned(7), 6);
  assert.equal(pointsLeft(4, 2), 1);
  assert.equal(pointsLeft(4, 99), 0, "spending more than earned went negative");
  assert.equal(pointsLeft(NaN, NaN), 0);
});

// ------------------------------------------------------------------- rolls --

test("a roll lays out three choices and spends nothing", () => {
  const service = createBenedictionService({ random: () => 0.5 });
  assert.equal(service.pointsFor("db-p1", 3), 2);
  const offer = service.roll("db-p1", 3);
  assert.equal(offer.length, 3, "the roll did not offer three benedictions");
  assert.equal(new Set(offer.map((draw) => draw.benediction.id)).size, 3, "a choice was duplicated");
  // **Nothing is spent by a roll**: the point is the pick.
  assert.equal(service.pointsFor("db-p1", 3), 2);
  assert.equal(service.save("db-p1").spent, 0);
  assert.deepEqual(service.save("db-p1").history, []);
});

test("rolling again while an offer is open shows the same three", () => {
  // Otherwise a player could roll, look, and roll again until the three were good — which
  // is a reroll nobody paid for.
  const service = createBenedictionService({ random: () => 0.5 });
  const first = service.roll("db-p1", 4);
  const second = service.roll("db-p1", 4);
  assert.deepEqual(second.map((draw) => draw.benediction.id), first.map((draw) => draw.benediction.id));
});

test("choosing spends exactly one point, and only once", () => {
  const service = createBenedictionService({ random: () => 0.5 });
  const offer = service.roll("db-p1", 3);
  const chosen = service.choose("db-p1", 3, 1);
  assert.ok(chosen, "a point was available and the choice did nothing");
  assert.equal(chosen.benediction.id, offer[1].benediction.id, "the choice is not the card that was picked");
  assert.equal(chosen.pointsLeft, 1);
  assert.equal(service.pointsFor("db-p1", 3), 1);
  assert.equal(service.save("db-p1").spent, 1);
  assert.deepEqual(service.save("db-p1").history.map((entry) => entry.id), [chosen.benediction.id]);
  // The offer is consumed: the same pick cannot be made twice.
  assert.equal(service.choose("db-p1", 3, 1), null, "one offer paid for two choices");
  assert.equal(service.save("db-p1").spent, 1);
});

test("a choice that is not in the offer costs nothing", () => {
  const service = createBenedictionService({ random: () => 0.5 });
  service.roll("db-p1", 3);
  const before = service.save("db-p1");
  for (const index of [-1, 3, 99, 1.5, undefined]) {
    assert.equal(service.choose("db-p1", 3, index), null, `index ${index} was accepted`);
  }
  assert.deepEqual(service.save("db-p1"), before, "a refused choice spent something");
});

test("a roll and a choice with no point left are refused", () => {
  const service = createBenedictionService({ random: () => 0.5 });
  assert.equal(service.roll("db-p1", 1), null, "the first level paid a point");
  const broke = createBenedictionService({ random: () => 0.5 });
  broke.roll("db-p2", 2);
  broke.choose("db-p2", 2, 0);
  // A level that goes backwards (a lost level) must not leave a spendable offer behind.
  broke.clearOffer("db-p2");
  assert.equal(broke.roll("db-p2", 1), null);
});

test("an account survives a reload, offer included", () => {
  const service = createBenedictionService({ random: () => 0.5 });
  service.roll("db-p1", 5);
  service.choose("db-p1", 5, 0);
  const chosen = service.save("db-p1").history[0];
  service.roll("db-p1", 5);
  const offer = service.offerOf("db-p1").map((draw) => draw.benediction.id);
  const stored = JSON.parse(JSON.stringify(service.save("db-p1")));

  const reloaded = createBenedictionService({ random: () => 0.5 });
  reloaded.load("db-p1", stored);
  assert.equal(reloaded.pointsFor("db-p1", 5), 3, "a reload refunded a spent point");
  assert.equal(reloaded.save("db-p1").history[0].id, chosen.id);
  // **The offer comes back too**: closing the game mid-choice must not reroll it.
  assert.deepEqual(reloaded.offerOf("db-p1").map((draw) => draw.benediction.id), offer);

  // Nothing stored is an empty account, not a crash.
  const fresh = createBenedictionService({ random: () => 0.5 });
  fresh.load("db-p2", null);
  assert.equal(fresh.pointsFor("db-p2", 4), 3);
  assert.deepEqual(fresh.save("db-p2").history, []);
  assert.deepEqual(fresh.offerOf("db-p2"), []);
});

test("the history is bounded, and keeps the newest first", () => {
  const service = createBenedictionService({ random: () => 0 });
  for (let index = 0; index < 12; index += 1) {
    service.roll("db-p1", 40);
    service.choose("db-p1", 40, 0);
  }
  const history = service.save("db-p1").history;
  assert.equal(history.length, 5);
  assert.equal(service.save("db-p1").spent, 12);
});

// ----------------------------------------------------------- presentation --

test("a roll is shown in its rarity's colour, on every surface", () => {
  const benediction = BENEDICTIONS[0];
  const rarity = rarityOf(benediction.rarity);

  // Chat: CustomTextStyling, so the name is written in the rarity's colour.
  const message = rollMessage(benediction, rarity);
  assert.equal(message[0], "Benediction: ");
  const styled = message.find((part) => part && part.str === benediction.name);
  assert.ok(styled, "the name is not in the message");
  assert.equal(styled.style.color, rarity.textColour);
  assert.deepEqual(rarityText(rarity)[0].style.color, rarity.textColour);
  assert.ok(tagText(benediction, rarity)[0].startsWith("Physical"));

  // The card: `sendTopRightHelper` takes rgb() only, and the docs are explicit about it.
  const card = cardFor(benediction, rarity);
  assert.equal(card.opts.color, rgbOf(rarity.colour));
  assert.match(card.opts.color, /^rgb\(\d+, \d+, \d+\)$/);
  assert.ok(card.text.includes(benediction.name));
  assert.ok(card.text.includes(rarity.label));
  assert.ok(card.text.includes("No effect yet."));
  assert.ok(card.icon.startsWith("fa-solid fa-"));
  assert.ok(card.opts.duration > 0);

  assert.equal(announcementOf(benediction, rarity), `${benediction.name} — ${rarity.label}`);
  assert.ok(nameText(benediction, rarity)[0].style.color);
});

test("the shop tile says what the odds are, in plain text", () => {
  const description = rollDescription();
  assert.match(description, /Roll one Benediction/);
  assert.match(description, new RegExp(oddsOfTable().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(!description.includes("undefined"));
});

test("a colour that is not a hex is passed through, not mangled", () => {
  assert.equal(rgbOf("#ff2d2d"), "rgb(255, 45, 45)");
  assert.equal(rgbOf("rgb(1, 2, 3)"), "rgb(1, 2, 3)");
  assert.equal(rgbOf(undefined), undefined);
});
