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
    [/\bperformance\.now\s*\(/, "performance.now"],
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

test("the logical engine imports nothing from the game side", () => {
  for (const file of engineFiles()) {
    const source = readFileSync(join(ENGINE, file), "utf8");
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const target = match[1];
      assert.ok(target.startsWith("./"), `${file} imports ${target}, which is outside the engine`);
    }
  }
});

/** Comments explain why a pattern is forbidden; they must not trigger the test. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
