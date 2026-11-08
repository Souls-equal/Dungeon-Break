import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ENGINE = new URL("../../src/dungeon/engine/", import.meta.url).pathname;

function engineFiles() {
  return readdirSync(ENGINE).filter((entry) => entry.endsWith(".js")).sort();
}

test("the logical engine never touches the Bloxd API", () => {
  for (const file of engineFiles()) {
    const source = readFileSync(join(ENGINE, file), "utf8");
    const code = stripComments(source);
    assert.ok(!/\bapi\./.test(code), `${file} calls the Bloxd api`);
    assert.ok(!/\bapi\b\s*[,)]/.test(code), `${file} mentions api in code`);
  }
});

test("the logical engine uses no timers, no promises and no wall clock", () => {
  const forbidden = [
    [/\bsetTimeout\s*\(/, "setTimeout"],
    [/\bsetInterval\s*\(/, "setInterval"],
    [/\bDate\.now\s*\(/, "Date.now"],
    [/\bawait\b/, "await"],
    [/\bimport\s*\(/, "dynamic import"],
  ];
  for (const file of engineFiles()) {
    const code = stripComments(readFileSync(join(ENGINE, file), "utf8"));
    for (const [pattern, label] of forbidden) {
      assert.ok(!pattern.test(code), `${file} uses ${label}`);
    }
  }
});

test("the only clock in the engine is a measurement, never a decision", () => {
  // `performance.now()` is allowed in exactly one place — the controller's
  // per-job counters — and must never be read to decide anything. The rule is
  // asserted, not trusted: a clock that starts driving behaviour is how a
  // testable engine becomes untestable.
  const allowed = new Set(["controller.js"]);
  for (const file of engineFiles()) {
    const code = stripComments(readFileSync(join(ENGINE, file), "utf8"));
    if (!/performance\.now/.test(code)) continue;
    assert.ok(allowed.has(file), `${file} reads the wall clock`);
    const occurrences = code.match(/performance\.now/g).length;
    assert.equal(occurrences, 1, `${file} reads the wall clock in ${occurrences} places`);
  }
});

test("the logical engine imports nothing from the game side", () => {
  for (const file of engineFiles()) {
    const source = readFileSync(join(ENGINE, file), "utf8");
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const target = match[1];
      assert.ok(target.startsWith("./"), `${file} imports ${target}, which is outside the engine`);
    }
  }
});

test("the block planner owns its block names, but never the world", () => {
  // The builder is the boundary: it plans writes and executes them through an
  // injected writer. It must stay free of the global `api`, of timers and of the
  // wall clock, for the same reason the engine does — it is tested in Node.
  const source = readFileSync(new URL("../../src/dungeon/builder.js", import.meta.url).pathname, "utf8");
  const code = stripComments(source);
  assert.ok(!/\bapi\./.test(code), "builder.js calls the Bloxd api");
  for (const [pattern, label] of [
    [/\bsetTimeout\s*\(/, "setTimeout"],
    [/\bDate\.now\s*\(/, "Date.now"],
  ]) {
    assert.ok(!pattern.test(code), `builder.js uses ${label}`);
  }
});

test("only the bridge and the service touch the Bloxd api", () => {
  // Everything above the bridge is pure data. If a second file starts calling
  // `api.setBlock`, the dungeon becomes untestable in Node again.
  const files = ["builder.js", "worldBuilder.js", "service.js"];
  for (const file of files) {
    const code = stripComments(readFileSync(new URL(`../../src/dungeon/${file}`, import.meta.url).pathname, "utf8"));
    const calls = (code.match(/\bapi\.\w+/g) || []).filter((call) => call !== "api.log");
    if (file === "builder.js") {
      assert.equal(calls.length, 0, "builder.js is not allowed to touch the api");
      continue;
    }
    // The bridge and the service are the game-facing layer: they may call the
    // api, but only through the `api` object they were given.
    assert.ok(!/\bglobalThis\b/.test(code), `${file} reaches for a global instead of its injected api`);
  }
});

/** Comments explain why a pattern is forbidden; they must not trigger the test. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
