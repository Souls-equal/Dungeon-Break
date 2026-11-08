import test from "node:test";
import assert from "node:assert/strict";
import { setInterval, setTimeout, step } from "../src/utils/scheduler.js";

test("one-shot tasks run after their tick delay and only once", () => {
  let calls = 0;
  setTimeout(() => {
    calls += 1;
  }, 2);

  step();
  assert.equal(calls, 0);
  step();
  assert.equal(calls, 1);
  step();
  assert.equal(calls, 1);
});

test("interval tasks repeat until stopped", () => {
  let calls = 0;
  let handle;
  handle = setInterval(() => {
    calls += 1;
    if (calls === 3) handle.stop();
  }, 2);

  for (let i = 0; i < 10; i += 1) step();
  assert.equal(calls, 3);
});

test("a failing task is isolated and stopped after repeated failures", () => {
  const errors = [];
  globalThis.api = { log: (message) => errors.push(message) };
  let healthyTaskCalls = 0;

  setInterval(() => {
    throw new Error("expected test error");
  }, 1);
  setTimeout(() => {
    healthyTaskCalls += 1;
  }, 2);

  for (let i = 0; i < 7; i += 1) step();

  assert.equal(healthyTaskCalls, 1);
  assert.equal(errors.length, 3, "errors should be logged at most three times per task");
  delete globalThis.api;
});
