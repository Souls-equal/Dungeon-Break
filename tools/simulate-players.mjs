#!/usr/bin/env node
/*
 * Headless player simulation.
 *
 * Runs the controller exactly as the game would — same ticks, same cycle, same
 * budgets — with players walking through the dungeon, and prints the counters
 * that matter. This is the tool that answers "does it hold at scale?" without
 * opening Bloxd.
 *
 *   node tools/simulate-players.mjs --seed 12345 --players 2 --ticks 1200
 *   node tools/simulate-players.mjs --seed 12345 --players 6 --static
 *
 * `--static` keeps the players on the spot: it measures what the controller
 * costs when nothing is new to discover, which is the state the game is in most
 * of the time.
 */

import { createDungeonManager } from "../src/dungeon/engine/dungeonManager.js";
import { createDungeonController } from "../src/dungeon/engine/controller.js";
import { DUNGEON_CONFIG } from "../src/dungeon/engine/config.js";
import { openingCells } from "../src/dungeon/engine/discovery.js";
import { OPENING_STATUS } from "../src/dungeon/engine/openings.js";

function parseArguments(argv) {
  const options = { seed: 12345, players: 1, ticks: 1200, walk: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--seed") { options.seed = Number(value); index += 1; }
    else if (flag === "--players") { options.players = Number(value); index += 1; }
    else if (flag === "--ticks") { options.ticks = Number(value); index += 1; }
    else if (flag === "--walk") { options.walk = Number(value); index += 1; }
    else if (flag === "--static") { options.walk = 0; }
    else if (flag === "--help" || flag === "-h") {
      process.stdout.write("Usage: node tools/simulate-players.mjs [--seed N] [--players N] [--ticks N] [--walk N|--static]\n");
      process.exit(0);
    } else {
      process.stderr.write(`Unknown option: ${flag}\n`);
      process.exit(2);
    }
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));

const manager = createDungeonManager({ seed: options.seed, radius: 512 });
manager.createEntrance();

// A builder that counts blocks and never fails, so this harness measures the
// controller, not the world.
let blocks = 0;
const builder = {
  buildRoom(room) {
    const cost = room.mask.w * room.mask.h;
    blocks += cost;
    return cost;
  },
};

const controller = createDungeonController({ manager, builder });

/** Teleports a player onto the next free doorway of its room, like walking would. */
function advance(playerId) {
  const record = controller.playerList().find((entry) => entry.id === playerId);
  if (!record || !record.roomId) return false;
  const room = manager.getRoom(record.roomId);
  if (!room) return false;
  const connectionId = room.connections[0];
  if (connectionId === undefined) {
    // Dead end: pick any free doorway and stay there, which is what a player
    // exploring would do.
    const free = room.openings.find((opening) => opening.status === OPENING_STATUS.PENDING);
    if (!free) return false;
    const cell = openingCells(room, free)[0];
    controller.upsertPlayer({ id: playerId, position: { x: cell.x, y: 0, z: cell.y } });
    return true;
  }
  const connection = manager.getConnection(connectionId);
  const otherId = connection.a.roomId === room.id ? connection.b.roomId : connection.a.roomId;
  const other = manager.getRoom(otherId);
  if (!other) return false;
  controller.upsertPlayer({
    id: playerId,
    position: { x: other.origin.x + 1, y: 0, z: other.origin.y + 1 },
  });
  return true;
}

for (let index = 0; index < options.players; index += 1) {
  const entrance = manager.getRoom(manager.entranceRoomId);
  controller.upsertPlayer({
    id: `p${index}`,
    position: { x: entrance.origin.x + 1, y: 0, z: entrance.origin.y + 1 },
  });
}

const started = process.hrtime.bigint();
let worstCycleMs = 0;
// Recorded separately: a long cycle on the very first calls is compile/JIT, not
// the workload, and reporting the two together makes the numbers look alarming
// when the steady state is fine.
let steadyCycleMs = 0;
let steadyCycles = 0;
for (let tickIndex = 1; tickIndex <= options.ticks; tickIndex += 1) {
  const cycleStarted = process.hrtime.bigint();
  const ran = controller.tick();
  if (ran !== null) {
    const elapsed = Number(process.hrtime.bigint() - cycleStarted) / 1e6;
    if (elapsed > worstCycleMs) worstCycleMs = elapsed;
    if (tickIndex > DUNGEON_CONFIG.cycleTicks * 5) {
      steadyCycles += 1;
      if (elapsed > steadyCycleMs) steadyCycleMs = elapsed;
    }
  }
  if (options.walk > 0 && tickIndex % options.walk === 0) {
    for (let index = 0; index < options.players; index += 1) advance(`p${index}`);
  }
}
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

const rooms = manager.allRooms();
const connections = manager.allConnections();
const freeOpenings = rooms.reduce(
  (total, room) => total + room.openings.filter((opening) => opening.status === OPENING_STATUS.PENDING).length,
  0,
);

process.stdout.write(`${JSON.stringify({
  seed: options.seed,
  players: options.players,
  ticks: options.ticks,
  cycles: controller.stats.cycles,
  rooms: rooms.length,
  connections: connections.length,
  loops: manager.stats.loops,
  freeOpenings,
  blocks,
  worstCycleMs: Number(worstCycleMs.toFixed(2)),
  worstSteadyCycleMs: Number(steadyCycleMs.toFixed(2)),
  steadyCycles,
  totalMs: Number(elapsedMs.toFixed(1)),
  perCycleMs: Number((elapsedMs / Math.max(1, controller.stats.cycles)).toFixed(2)),
  stats: controller.stats,
  cycleTicks: DUNGEON_CONFIG.cycleTicks,
}, null, 2)}
`);
