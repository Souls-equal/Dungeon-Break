/*
 * Small tick-based scheduler inspired by the timer utility in the user's
 * Block Pirate project: https://github.com/Souls-equal/block-pirate_v3
 *
 * Delays are measured in Bloxd ticks (20 ticks per second), not milliseconds.
 * Call step() exactly once from the world's tick callback.
 */

const MAX_CONSECUTIVE_FAILURES = 4;
const MAX_ERROR_LOGS_PER_TIMER = 3;

let currentTick = 0;
const timers = [];

function createTimer(callback, delayTicks, intervalTicks) {
  if (typeof callback !== "function") {
    throw new TypeError("A scheduled callback must be a function.");
  }

  const delay = Math.max(0, Math.ceil(Number(delayTicks) || 0));
  const timer = {
    callback,
    nextTick: currentTick + delay,
    interval: intervalTicks,
    active: true,
    consecutiveFailures: 0,
    loggedFailures: 0,
  };

  timers.push(timer);

  return {
    stop() {
      timer.active = false;
    },
  };
}

export function setTimeout(callback, delayTicks) {
  return createTimer(callback, delayTicks, 0);
}

export function setInterval(callback, intervalTicks) {
  const interval = Math.max(1, Math.ceil(Number(intervalTicks) || 0));
  return createTimer(callback, interval, interval);
}

function logTimerError(error) {
  try {
    const message = error && error.message ? error.message : String(error);
    api.log(`[Scheduler] ${message}`);
  } catch (_) {
    // A logging failure must never prevent other scheduled tasks from running.
  }
}

export function step() {
  currentTick += 1;

  // Iterate backwards so timers can be safely removed while processing.
  for (let index = timers.length - 1; index >= 0; index -= 1) {
    const timer = timers[index];

    if (!timer.active) {
      timers.splice(index, 1);
      continue;
    }
    if (currentTick < timer.nextTick) continue;

    try {
      timer.callback();
      timer.consecutiveFailures = 0;
    } catch (error) {
      timer.consecutiveFailures += 1;
      if (timer.loggedFailures < MAX_ERROR_LOGS_PER_TIMER) {
        timer.loggedFailures += 1;
        logTimerError(error);
      }
      if (timer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        timer.active = false;
      }
    }

    if (!timer.active || timer.interval === 0) {
      timers.splice(index, 1);
    } else {
      // Run at most once per scheduler tick, even if the server was delayed.
      timer.nextTick = currentTick + timer.interval;
    }
  }
}
