import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AURA_LEVEL_BASE,
  AURA_PER_LEVEL,
  BLESSINGS,
  CHOICE_COUNT,
  MAX_AURA_LEVEL,
  POINTS_PER_LEVEL,
  BLESSING_LEVEL_STEP,
  CATEGORIES,
  RARITIES,
  blessingsOf,
  categoryOf,
  drawBlessing,
  drawChoices,
  formatPercent,
  maxPoints,
  pointsEarned,
  pointsLeft,
  rarityOdds,
  rarityOf,
  rgbOf,
} from "../../src/blessing/config.js";
import { createBlessingService } from "../../src/blessing/service.js";
import {
  announcementOf,
  cardFor,
  choiceTile,
  nameText,
  oddsOfTable,
  rarityText,
  rollMessage,
  scopeLabelOf,
  scopeShortOf,
  tagText,
} from "../../src/blessing/presentation.js";
import {
  BASE_CLIENT_OPTIONS,
  DAMAGE_TAKEN_FLOOR,
  TIMED_MAX_MS,
  TIMED_MIN_MS,
  catalogueIds,
  countsOfPermanent,
  optionsFrom,
  permanentSummary,
  readPermanentSave,
  runEffects,
  saveOf,
  scopeKeyOf,
  timedEffectOf,
} from "../../src/blessing/effects.js";
import { SCOPES, blessingOf, blessingsWithScope } from "../../src/blessing/config.js";

// ------------------------------------------------------------------ tables --

test("the six rarities are the owner's, in his order and his colours", () => {
  assert.deepEqual(RARITIES.map((entry) => entry.label), [
    "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic",
  ]);
  // Cool hexa palette per user request — updated from owner's old palette
  assert.deepEqual(RARITIES.map((entry) => entry.colour), [
    "#95A5A6", "#2ECC71", "#3498DB", "#9B59B6", "#F1C40F", "#E74C3C",
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

test("the three families are the owner's, and every blessing belongs to exactly one", () => {
  assert.deepEqual(CATEGORIES.map((entry) => entry.label), ["Physical", "Equipment", "Potion effect"]);
  const ids = new Set(BLESSINGS.map((entry) => entry.id));
  assert.equal(ids.size, BLESSINGS.length, "two blessings share an id");
  for (const blessing of BLESSINGS) {
    assert.ok(categoryOf(blessing.category), `${blessing.name} has no family`);
    assert.ok(rarityOf(blessing.rarity), `${blessing.name} has no rarity`);
    assert.ok(blessing.icon, `${blessing.name} has no in-game icon`);
    assert.ok(blessing.cardIcon, `${blessing.name} has no card icon`);
    assert.ok(blessing.effect, `${blessing.name} has no effect`);
  }
});

test("every rarity and every family is represented in the catalogue", () => {
  for (const rarity of RARITIES) {
    assert.ok(blessingsOf(rarity.id).length > 0, `nothing is ${rarity.label}`);
  }
  for (const category of CATEGORIES) {
    assert.ok(BLESSINGS.some((entry) => entry.category === category.id),
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
  assert.match(oddsOfTable(), /^Common 60% · Uncommon 25% · Rare 9\.6% · /);
  assert.ok(odds[0].chance > 0.55 && odds[0].chance < 0.65);
  assert.ok(odds[odds.length - 1].chance < 0.01);
});

test("a rarity with no blessing is left out instead of being rerolled", () => {
  // The table follows the catalogue: emptying a rarity must remove its slice of
  // probability, not turn its rolls into a second draw nobody asked for. The table is a
  // parameter for exactly this reason.
  const withoutMythic = BLESSINGS.filter((entry) => entry.rarity !== "mythic");
  const odds = rarityOdds(withoutMythic);
  assert.equal(odds.length, RARITIES.length - 1, "an empty rarity stayed in the table");
  assert.ok(!odds.some((entry) => entry.rarity.id === "mythic"));
  const total = odds.reduce((sum, entry) => sum + entry.chance, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `the remaining rarities do not add up: ${total}`);

  // And a draw over the shortened wheel never lands on the empty one.
  for (let index = 0; index < 500; index += 1) {
    const draw = drawBlessing(() => index / 500, withoutMythic);
    assert.notEqual(draw.rarity.id, "mythic");
  }
});

test("a draw always answers, whatever the generator says", () => {
  for (const value of [0, 0.4999, 0.5, 0.999999, 1]) {
    const draw = drawBlessing(() => value);
    assert.ok(draw, `a roll of ${value} gave nothing`);
    assert.ok(draw.blessing);
    assert.ok(draw.rarity);
    assert.equal(draw.blessing.rarity, draw.rarity.id);
  }
  // A generator that walks the wheel hits each rarity in turn, which is what "by weight"
  // has to mean: the same table a player sees, drawn in order.
  const seen = new Set();
  // 2 000 points around the wheel: a Mythic is 0.2 % of it, so the grain has to be
  // finer than its slice or the test would accuse the table of a hole it does not have.
  for (let index = 0; index < 2000; index += 1) {
    const draw = drawBlessing(() => index / 2000);
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
    assert.equal(new Set(choices.map((draw) => draw.blessing.id)).size, CHOICE_COUNT,
      "an offer repeated a blessing");
    for (const draw of choices) assert.equal(draw.blessing.rarity, draw.rarity.id);
  }
  // A catalogue too small for three is filled to what it has, never padded with a copy.
  const two = BLESSINGS.slice(0, 2);
  const small = drawChoices(Math.random, two);
  assert.equal(small.length, 2);
  assert.equal(new Set(small.map((draw) => draw.blessing.id)).size, 2);
  // And a generator that never moves still fills the offer from the catalogue.
  const stuck = drawChoices(() => 0.999999);
  assert.equal(stuck.length, CHOICE_COUNT);
  assert.equal(new Set(stuck.map((draw) => draw.blessing.id)).size, CHOICE_COUNT);
});

// ------------------------------------------------------------------ points --

test("the world sets its own aura scale and ceiling", () => {
  // XP not limited: cap high, blessing every 2 levels.
  assert.ok(AURA_PER_LEVEL > 0);
  assert.ok(MAX_AURA_LEVEL > AURA_LEVEL_BASE);
  assert.equal(maxPoints(), Math.floor((MAX_AURA_LEVEL - AURA_LEVEL_BASE) / BLESSING_LEVEL_STEP));
  assert.ok(MAX_AURA_LEVEL <= 2000, "the cap is absurdly high");
});

test("an aura level pays one point, and the first level pays none", () => {
  assert.equal(AURA_LEVEL_BASE, 1);
  assert.equal(pointsEarned(1), 0, "a brand-new player was given a point for nothing");
  assert.equal(pointsEarned(2), 0, "blessing every 2 levels: level 2 gives 0");
  assert.equal(pointsEarned(3), 1, "level 3 gives first point");
  assert.equal(pointsEarned(5), 2);
  assert.equal(pointsEarned(7), 3);
  assert.equal(pointsLeft(5, 1), 1);
  assert.equal(pointsLeft(4, 99), 0, "spending more than earned went negative");
  assert.equal(pointsLeft(NaN, NaN), 0);
});

// ------------------------------------------------------------------- rolls --

test("a roll lays out three choices and reserves exactly one point", () => {
  const service = createBlessingService({ random: () => 0.5 });
  assert.equal(service.pointsFor("p1", 5), 2);
  const offer = service.roll("p1", 5);
  assert.equal(offer.length, 3, "the roll did not offer three blessings");
  assert.equal(new Set(offer.map((draw) => draw.blessing.id)).size, 3, "a choice was duplicated");
  assert.equal(service.pointsFor("p1", 5), 1);
  assert.equal(service.accountOf("p1").spent, 0);
  assert.deepEqual(service.accountOf("p1").history, []);
});

test("rolling again while an offer is open shows the same three", () => {
  const service = createBlessingService({ random: () => 0.5 });
  const first = service.roll("p1", 5);
  const second = service.roll("p1", 5);
  assert.deepEqual(second.map((draw) => draw.blessing.id), first.map((draw) => draw.blessing.id));
  assert.equal(service.accountOf("p1").reserved, 1, "a second roll promised a second point");
});

test("choosing spends exactly one point, and only once", () => {
  const service = createBlessingService({ random: () => 0.5 });
  const offer = service.roll("p1", 5);
  assert.equal(service.pointsFor("p1", 5), 1, "the offer did not reserve a point");
  const chosen = service.choose("p1", 5, 1);
  assert.ok(chosen, "a point was available and the choice did nothing");
  assert.equal(chosen.blessing.id, offer[1].blessing.id, "the choice is not the card that was picked");
  assert.equal(chosen.pointsLeft, 1);
  assert.equal(service.pointsFor("p1", 5), 1);
  assert.equal(service.accountOf("p1").spent, 1);
  assert.equal(service.accountOf("p1").reserved, 0, "a finished choice still holds a reservation");
  assert.deepEqual(service.accountOf("p1").history.map((entry) => entry.id), [chosen.blessing.id]);
  assert.equal(service.choose("p1", 5, 1), null, "one offer paid for two choices");
  assert.equal(service.accountOf("p1").spent, 1);
});

test("dropping an offer gives its point back", () => {
  const service = createBlessingService({ random: () => 0.5 });
  service.roll("p1", 5);
  assert.equal(service.pointsFor("p1", 5), 1);
  service.clearOffer("p1");
  assert.equal(service.pointsFor("p1", 5), 2, "dropping the offer burned the point it held");
  service.clearOffer("p1");
  assert.equal(service.pointsFor("p1", 5), 2);
});

test("a choice that is not in the offer costs nothing", () => {
  const service = createBlessingService({ random: () => 0.5 });
  service.roll("p1", 5);
  const before = { ...service.accountOf("p1") };
  for (const index of [-1, 3, 99, 1.5, undefined]) {
    assert.equal(service.choose("p1", 3, index), null, `index ${index} was accepted`);
  }
  const after = service.accountOf("p1");
  assert.equal(after.spent, before.spent);
  assert.equal(after.reserved, before.reserved);
  assert.equal(after.offer.length, 3, "a refused choice ate the offer");
});

test("a roll and a choice with no point left are refused", () => {
  const service = createBlessingService({ random: () => 0.5 });
  assert.equal(service.roll("p1", 1), null, "the first level paid a point");
  assert.equal(service.roll("p1", 2), null, "level 2 still gives no point with 1/2 levels");
  const broke = createBlessingService({ random: () => 0.5 });
  broke.roll("p2", 5);
  broke.choose("p2", 5, 0);
  assert.equal(broke.roll("p2", 3), null, "a spent point came back as a free roll");
});

test("an account is memory, and a new session starts from nothing", () => {
  const service = createBlessingService({ random: () => 0.5 });
  service.roll("p1", 7);
  service.choose("p1", 7, 0);
  assert.equal(service.pointsFor("p1", 7), 2);
  service.forget("p1");
  assert.equal(service.pointsFor("p1", 7), 3, "a forgotten session kept its spending");
  assert.deepEqual(service.offerOf("p1"), []);
  assert.deepEqual(service.accountOf("p1").history, []);
  assert.equal(service.pointsFor("p2", 5), 2);
  assert.deepEqual(service.accountOf("p2").history, []);
  assert.deepEqual(service.offerOf("p2"), []);
});

test("the service has no persistence at all", () => {
  // The rule is structural, not a comment: the service cannot write anything, so no code
  // path can bring a point back from another session.
  const service = createBlessingService({ random: () => 0.5 });
  for (const name of ["save", "load", "persist"]) {
    assert.equal(service[name], undefined, `the service still exposes ${name}`);
  }
});

test("the history is bounded, and keeps the newest first", () => {
  const service = createBlessingService({ random: () => 0 });
  for (let index = 0; index < 12; index += 1) {
    service.roll("p1", 40);
    service.choose("p1", 40, 0);
  }
  const account = service.accountOf("p1");
  assert.equal(account.history.length, 5);
  assert.equal(account.spent, 12);
});

// ----------------------------------------------------------- presentation --

test("a roll is shown in its rarity's colour, on every surface", () => {
  const blessing = BLESSINGS[0];
  const rarity = rarityOf(blessing.rarity);

  // Chat: CustomTextStyling, so the name is written in the rarity's colour.
  const message = rollMessage(blessing, rarity);
  // New spec: prefix [TEMP]/[RUN]/[PERM] before rarity in roll display; first element is the scope tag.
  assert.ok(String(message[0].str || message[0]).includes("PERM") || String(message[0].str || message[0]).includes("RUN") || String(message[0].str || message[0]).includes("TEMP"), "rollMessage should start with [PERM]/[RUN]/[TEMP] prefix");
  assert.equal(message[1], "Blessing: ");
  const styled = message.find((part) => part && part.str === blessing.name);
  assert.ok(styled, "the name is not in the message");
  assert.equal(styled.style.color, rarity.textColour);
  assert.deepEqual(rarityText(rarity)[0].style.color, rarity.textColour);
  assert.ok(tagText(blessing, rarity)[0].startsWith("Physical"));

  // The card: `sendTopRightHelper` takes rgb() only, and the docs are explicit about it.
  const card = cardFor(blessing, rarity);
  assert.equal(card.opts.color, rgbOf(rarity.colour));
  assert.match(card.opts.color, /^rgb\(\d+, \d+, \d+\)$/);
  assert.ok(card.text.includes(blessing.name));
  assert.ok(card.text.includes(rarity.label));
  assert.ok(card.text.includes(blessing.description), "the card does not say what the blessing does");
  assert.ok(card.text.includes(scopeLabelOf(blessing)), "the card does not say how long it lasts");
  assert.ok(card.icon.startsWith("fa-solid fa-"));
  assert.ok(card.opts.duration > 0);

  assert.equal(announcementOf(blessing, rarity), `${blessing.name} — ${rarity.label}`);
  assert.ok(nameText(blessing, rarity)[0].style.color);
});

test("the odds are one function, and the tile does not use them", () => {
  // The owner removed the odds from the roll tile: it was the busiest thing on a tile that
  // has to fit a level and a point count. The table is still readable — through the chat
  // report — so `oddsOfTable` keeps its own tests and the tile is simply shorter.
  const table = oddsOfTable();
  assert.match(table, /^Common \d+(\.\d+)?%/);
  assert.equal(table.split(" · ").length, 6, "the report no longer lists six rarities");
  assert.ok(!table.includes("undefined"));
  // `rollDescription` was removed outright: a helper nobody calls is dead weight, and
  // `npm run check` would not catch it.
  const source = readFileSync(new URL("../../src/blessing/presentation.js", import.meta.url), "utf8");
  assert.ok(!source.includes("rollDescription"), "the tile still has a description helper");
});

test("a colour that is not a hex is passed through, not mangled", () => {
  assert.equal(rgbOf("#ff2d2d"), "rgb(255, 45, 45)");
  assert.equal(rgbOf("rgb(1, 2, 3)"), "rgb(1, 2, 3)");
  assert.equal(rgbOf(undefined), undefined);
});

// ------------------------------------------------------- scopes & effects --

test("every blessing has a scope, and the three scopes are the owner's", () => {
  assert.deepEqual(SCOPES.map((entry) => entry.id), ["permanent", "run", "timed"]);
  for (const blessing of BLESSINGS) {
    const scope = scopeKeyOf(blessing);
    assert.ok(["permanent", "run", "timed"].includes(scope), `${blessing.name} has no scope`);
    assert.equal(scope, blessing.scope, `${blessing.name} was given a scope it did not declare`);
    assert.ok(blessing.effect, `${blessing.name} has no effect`);
    // The scope is what a player reads on the tile: it can never be missing or empty.
    assert.ok(scopeShortOf(blessing).length > 0);
    assert.ok(scopeLabelOf(blessing).length > 0);
  }
  // Every scope has something in it, or a roll could only ever offer one kind of thing.
  for (const scope of SCOPES) {
    assert.ok(blessingsWithScope(scope.id).length >= 2, `only ${scope.id} is thin`);
  }
});

test("the permanent blessings are the owner's list, and they stack", () => {
  const permanent = blessingsWithScope("permanent");
  // "+5 max health", "-1 % damage taken", "+0.1 speed", "+2 % damage".
  assert.ok(permanent.some((entry) => entry.effect.option === "maxHealth" && entry.effect.amount === 5));
  assert.ok(permanent.some((entry) => entry.effect.option === "receivingDamageMultiplier" && entry.effect.amount === -0.01));
  assert.ok(permanent.some((entry) => entry.effect.option === "speedMultiplier" && entry.effect.amount === 0.1));
  assert.ok(permanent.some((entry) => entry.effect.option === "dealingDamageMultiplier" && entry.effect.amount === 0.02));

  // Three copies of the health one is +15, and a **run** "+40" is added on top of it.
  const counts = { toughened_hide: 3 };
  const alone = optionsFrom(counts, []);
  assert.equal(alone.maxHealth, BASE_CLIENT_OPTIONS.maxHealth + 15);
  const withRun = optionsFrom(counts, [blessingOf("iron_ribs")]);
  assert.equal(withRun.maxHealth, BASE_CLIENT_OPTIONS.maxHealth + 15 + 40,
    "a run's health replaced the permanent stack instead of adding to it");
});

test("damage taken is capped at -40 %, however many Scarred Skins a player stacks", () => {
  const options = optionsFrom({ scarred_skin: 100 }, []);
  assert.equal(options.receivingDamageMultiplier, DAMAGE_TAKEN_FLOOR);
  assert.equal(DAMAGE_TAKEN_FLOOR, 0.6, "the owner's cap is -40 %");
  // One copy is exactly -1 %, which is what a player is promised.
  assert.equal(optionsFrom({ scarred_skin: 1 }, []).receivingDamageMultiplier, 0.99);
});

test("speed adds up across the scopes, and both speed values follow it", () => {
  const options = optionsFrom({ long_stride: 1 }, [blessingOf("runner_legs")]);
  // +0.1 permanent and +0.3 for the run: 1.4, not 1.3 or 1.1.
  assert.equal(options.speedMultiplier, 1.4);
  assert.equal(options.runningSpeed, Math.round(BASE_CLIENT_OPTIONS.runningSpeed * 1.4 * 1000) / 1000);
  assert.equal(options.walkingSpeed, Math.round(BASE_CLIENT_OPTIONS.walkingSpeed * 1.4 * 1000) / 1000);
  // A run's wall climbing is a switch, and it is set, not added.
  const climbing = optionsFrom({}, [blessingOf("wall_crawler")]);
  assert.equal(climbing.canClimbWalls, true);
  // A run that is over leaves nothing behind: no speed, no climbing.
  const bare = optionsFrom({}, []);
  assert.equal(bare.speedMultiplier, 1);
  // A switch is **sent as off** rather than left out: a client option is state the game
  // keeps, so not mentioning it would leave a run's wall climbing in place for ever.
  assert.equal(bare.canClimbWalls, false);
});

test("a timed blessing is a potion effect of 30 s to 2 min, and nothing else", () => {
  for (const blessing of blessingsWithScope("timed")) {
    const effect = timedEffectOf(blessing);
    assert.ok(effect, `${blessing.name} has no timed effect`);
    assert.ok(effect.durationMs >= TIMED_MIN_MS, `${blessing.name} is shorter than 30 s`);
    assert.ok(effect.durationMs <= TIMED_MAX_MS, `${blessing.name} is longer than 2 min`);
    assert.ok(effect.effectName.length > 0);
    assert.ok(effect.level >= 1);
    // A timed blessing is **only** a potion effect: no client option, nothing to undo.
    assert.equal(blessing.effect.kind, "potion");
  }
  // The owner's two examples: 50 s of damage, and a 2-minute haste.
  assert.equal(timedEffectOf(blessingOf("bloodletting")).durationMs, 50000);
  assert.equal(timedEffectOf(blessingOf("long_reach")).durationMs, 120000);
  // A potion effect with no duration is a **run** effect, not a timed one.
  assert.equal(timedEffectOf(blessingOf("thorned_coat")), null);
  assert.deepEqual(runEffects([blessingOf("thorned_coat")]), [{ effectName: "Thorns", level: 1 }]);
});

test("every managed option is re-sent, so a removed bonus really goes back to its baseline", () => {
  // The bug this pins: a client option is state the game keeps. Dropping a run blessing and
  // simply *not mentioning* the option left the old value in place for ever — a run that
  // never ended. Every option this module owns is therefore always in the payload.
  const bare = optionsFrom({}, []);
  for (const option of ["maxHealth", "receivingDamageMultiplier", "dealingDamageMultiplier", "speedMultiplier"]) {
    assert.ok(option in bare, `${option} is not re-sent when nothing modifies it`);
  }
  assert.equal(bare.receivingDamageMultiplier, 1);
  assert.equal(bare.dealingDamageMultiplier, 1);
  assert.equal(bare.speedMultiplier, 1);
  assert.equal(bare.maxHealth, BASE_CLIENT_OPTIONS.maxHealth);
  // A switch is sent as **off**, for the same reason.
  assert.equal(bare.canClimbWalls, false);
});

test("the save is a stable map of counts, and a bad value is an empty stack", () => {
  const counts = { toughened_hide: 3, scarred_skin: 1 };
  assert.equal(saveOf(counts), '{"scarred_skin":1,"toughened_hide":3}');
  assert.deepEqual(readPermanentSave(saveOf(counts)), counts);
  // A **run** or **timed** blessing can never enter the save, even if it is written there.
  const polluted = saveOf({ toughened_hide: 1 }) && '{"toughened_hide":1,"bloodletting":4,"iron_ribs":2}';
  assert.deepEqual(readPermanentSave(polluted), { toughened_hide: 1 });
  // Unknown ids, corrupted JSON, `null` and a number are all "nothing saved".
  assert.deepEqual(readPermanentSave('{"gone_forever":2}'), {});
  assert.deepEqual(readPermanentSave("{not json"), {});
  assert.deepEqual(readPermanentSave(null), {});
  assert.deepEqual(readPermanentSave(42), {});
  // Counts of zero or less are not a blessing.
  assert.deepEqual(readPermanentSave('{"toughened_hide":0}'), {});
});

test("the permanent summary is what a player owns, in one line", () => {
  assert.equal(permanentSummary({}), "No permanent blessing yet");
  const line = permanentSummary({ toughened_hide: 3, scarred_skin: 2 });
  assert.match(line, /^5 permanent · /);
  assert.match(line, /\+15 health/);
  assert.match(line, /-2% damage taken/);
});

test("a save round-trips through the service, and a run never touches it", () => {
  const service = createBlessingService({ random: () => 0.5 });
  service.setPermanent("db:1", { toughened_hide: 2 });
  assert.deepEqual(service.permanentOf("db:1"), { toughened_hide: 2 });
  service.addPermanent("db:1", blessingOf("toughened_hide"));
  assert.deepEqual(service.permanentOf("db:1"), { toughened_hide: 3 });
  service.addRun("db:1", blessingOf("iron_ribs"));
  service.addTimed("db:1", blessingOf("bloodletting"), 5000);
  assert.deepEqual(service.permanentOf("db:1"), { toughened_hide: 3 }, "a run blessing reached the save");
  assert.equal(service.runOf("db:1").length, 1);
  assert.equal(service.timedOf("db:1").length, 1);

  // The timed entry expires on its own; the run's does not.
  assert.equal(service.pruneTimed("db:1", 4000).length, 0);
  assert.equal(service.pruneTimed("db:1", 6000).length, 1);
  assert.equal(service.timedOf("db:1").length, 0);
  assert.equal(service.runOf("db:1").length, 1);

  // A death drops the run and the timer, and **keeps** the permanent stack.
  const dropped = service.clearRun("db:1");
  assert.equal(dropped.run.length, 1);
  assert.deepEqual(service.runOf("db:1"), []);
  assert.deepEqual(service.permanentOf("db:1"), { toughened_hide: 3 });
  // Only a leave/join forgets the permanent stack, and it comes back from the save.
  service.forget("db:1");
  assert.deepEqual(service.permanentOf("db:1"), {});
  service.setPermanent("db:1", { toughened_hide: 3 });
  assert.deepEqual(service.permanentOf("db:1"), { toughened_hide: 3 });
});

test("the catalogue is written in Blessings, never in Benedictions", () => {
  // The owner asked for the word: the shipped bundle must not carry the old one at all.
  const bundle = readFileSync(new URL("../../world-code/worldCode.js", import.meta.url), "utf8");
  assert.ok(!/benediction/i.test(bundle), "the bundle still says benediction");
  assert.ok(/Blessing/.test(bundle));
  // And no blessing promises an effect it does not have.
  assert.equal(catalogueIds().length, BLESSINGS.length);
  assert.equal(countsOfPermanent(BLESSINGS.filter((entry) => entry.scope === "permanent")).long_stride, 1);
});
