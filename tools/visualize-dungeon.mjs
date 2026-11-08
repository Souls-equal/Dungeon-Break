#!/usr/bin/env node
/*
 * Headless dungeon visualiser.
 *
 * Renders the output of the logical engine as ASCII art and as an SVG file, so
 * a dungeon can be inspected, diffed and pasted into an issue without launching
 * the game. Everything is derived from the seed alone: the same seed always
 * produces the same picture.
 *
 *   node tools/visualize-dungeon.mjs --seed 12345 --rooms 60
 *   node tools/visualize-dungeon.mjs --seed 12345 --ascii out.txt --svg out.svg
 *   node tools/visualize-dungeon.mjs --seed 12345 --json
 *
 * The ASCII picture uses one character per cell:
 *   #  wall          .  floor         o  doorway (opening cell)
 *   =  joint         +  bridge        E  entrance room
 *
 * The diagnostic section explains every refusal, so a branch that stops
 * growing is never a silent failure.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createDungeonManager } from "../src/dungeon/engine/dungeonManager.js";
import { OPENING_STATUS, jointCells } from "../src/dungeon/engine/openings.js";

const USAGE = `Usage: node tools/visualize-dungeon.mjs [options]

  --seed <number>     Dungeon seed (default 12345)
  --rooms <number>    Stop after this many rooms (default 60)
  --radius <number>   Allowed radius in cells (default 512)
  --ascii <path>      Write the ASCII map to this file
  --svg <path>        Write the SVG map to this file
  --json              Print a machine-readable summary on stdout
  --help              Show this message
`;

function parseArguments(argv) {
  const options = { seed: 12345, rooms: 60, radius: 512, ascii: null, svg: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--help" || flag === "-h") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (flag === "--seed") { options.seed = Number(value); index += 1; }
    else if (flag === "--rooms") { options.rooms = Number(value); index += 1; }
    else if (flag === "--radius") { options.radius = Number(value); index += 1; }
    else if (flag === "--ascii") { options.ascii = value; index += 1; }
    else if (flag === "--svg") { options.svg = value; index += 1; }
    else if (flag === "--json") { options.json = true; }
    else {
      process.stderr.write(`Unknown option: ${flag}\n\n${USAGE}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(options.seed) || !Number.isFinite(options.rooms) || !Number.isFinite(options.radius)) {
    process.stderr.write(`Options must be numbers.\n\n${USAGE}`);
    process.exit(2);
  }
  return options;
}

/** Grows the dungeon breadth-first, exactly like the game's connector would. */
function grow(options) {
  const manager = createDungeonManager({ seed: options.seed, radius: options.radius });
  manager.createEntrance();
  const queue = manager.pendingOpenings().map((entry) => ({ room: entry.room, opening: entry.opening }));
  const refusals = new Map();
  while (queue.length > 0 && manager.roomCount < options.rooms) {
    const next = queue.shift();
    const result = manager.expand(next.room.id, next.opening.id);
    if (result.ok && result.kind === "created") {
      for (const opening of result.room.openings) {
        if (opening.status === OPENING_STATUS.PENDING) queue.push({ room: result.room, opening });
      }
    } else if (result.ok && result.kind === "reuse") {
      // A loop or a shortcut: nothing to add to the queue.
    } else if (!result.ok) {
      refusals.set(result.code, (refusals.get(result.code) || 0) + 1);
    }
  }
  return { manager, refusals, queue };
}

/** One character per cell, in dungeon coordinates. */
function renderAscii(manager) {
  const rooms = manager.allRooms();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const room of rooms) {
    minX = Math.min(minX, room.origin.x);
    minY = Math.min(minY, room.origin.y);
    maxX = Math.max(maxX, room.origin.x + room.mask.w - 1);
    maxY = Math.max(maxY, room.origin.y + room.mask.h - 1);
  }
  for (const connection of manager.allConnections()) {
    for (const cell of connection.bridge) {
      minX = Math.min(minX, cell.x); maxX = Math.max(maxX, cell.x);
      minY = Math.min(minY, cell.y); maxY = Math.max(maxY, cell.y);
    }
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const grid = [];
  for (let y = 0; y < height; y += 1) grid.push(new Array(width).fill(" "));

  const put = (x, y, character) => {
    const column = x - minX;
    const row = y - minY;
    if (grid[row] === undefined || grid[row][column] === undefined) return;
    grid[row][column] = character;
  };

  for (const room of rooms) {
    const glyph = room.id === manager.entranceRoomId ? "E" : ".";
    for (let y = 0; y < room.mask.h; y += 1) {
      for (let x = 0; x < room.mask.w; x += 1) {
        if (room.mask.cells[y][x]) put(room.origin.x + x, room.origin.y + y, glyph);
      }
    }
  }

  for (const connection of manager.allConnections()) {
    if (connection.kind === "direct") {
      const room = manager.getRoom(connection.a.roomId);
      const opening = room.openings.find((entry) => entry.id === connection.a.openingId);
      for (const cell of jointCells(room, opening)) put(cell.x, cell.y, "=");
    } else {
      for (const cell of connection.bridge) put(cell.x, cell.y, "+");
    }
  }

  // Doorways last: they are the cells that matter when reading the map.
  for (const room of rooms) {
    for (const opening of room.openings) {
      for (let offset = opening.offsetStart; offset <= opening.offsetEnd; offset += 1) {
        const symbol = opening.status === OPENING_STATUS.CONNECTED ? "o" : "p";
        if (opening.side === "north") put(room.origin.x + offset, room.origin.y, symbol);
        else if (opening.side === "south") put(room.origin.x + offset, room.origin.y + room.mask.h - 1, symbol);
        else if (opening.side === "west") put(room.origin.x, room.origin.y + offset, symbol);
        else put(room.origin.x + room.mask.w - 1, room.origin.y + offset, symbol);
      }
    }
  }

  return { text: grid.map((row) => row.join("").replace(/\s+$/, "")).join("\n"), width, height, minX, minY };
}

function renderSvg(manager, ascii) {
  const scale = 6;
  const padding = 10;
  const width = (ascii.width + 2) * scale + padding * 2;
  const height = (ascii.height + 2) * scale + padding * 2;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  parts.push('<rect width="100%" height="100%" fill="#10131a"/>');

  const translate = (x, y) => [padding + (x - ascii.minX + 1) * scale, padding + (y - ascii.minY + 1) * scale];

  for (const room of manager.allRooms()) {
    const colour = room.id === manager.entranceRoomId ? "#3f7f4f" : "#2e4b7a";
    for (let y = 0; y < room.mask.h; y += 1) {
      for (let x = 0; x < room.mask.w; x += 1) {
        if (!room.mask.cells[y][x]) continue;
        const [left, top] = translate(room.origin.x + x, room.origin.y + y);
        parts.push(`<rect x="${left}" y="${top}" width="${scale}" height="${scale}" fill="${colour}" stroke="#0b1a2e" stroke-width="0.3"/>`);
      }
    }
  }

  for (const connection of manager.allConnections()) {
    let cells = [];
    let colour = "#c9a227";
    if (connection.kind === "direct") {
      const room = manager.getRoom(connection.a.roomId);
      const opening = room.openings.find((entry) => entry.id === connection.a.openingId);
      cells = jointCells(room, opening);
    } else {
      cells = connection.bridge;
      colour = "#b05fb0";
    }
    for (const cell of cells) {
      const [left, top] = translate(cell.x, cell.y);
      parts.push(`<rect x="${left}" y="${top}" width="${scale}" height="${scale}" fill="${colour}"/>`);
    }
  }

  for (const room of manager.allRooms()) {
    for (const opening of room.openings) {
      const colour = opening.status === OPENING_STATUS.CONNECTED ? "#7ad17a" : "#e0e0e0";
      for (let offset = opening.offsetStart; offset <= opening.offsetEnd; offset += 1) {
        let cell;
        if (opening.side === "north") cell = { x: room.origin.x + offset, y: room.origin.y };
        else if (opening.side === "south") cell = { x: room.origin.x + offset, y: room.origin.y + room.mask.h - 1 };
        else if (opening.side === "west") cell = { x: room.origin.x, y: room.origin.y + offset };
        else cell = { x: room.origin.x + room.mask.w - 1, y: room.origin.y + offset };
        const [left, top] = translate(cell.x, cell.y);
        parts.push(`<rect x="${left}" y="${top}" width="${scale}" height="${scale}" fill="${colour}"/>`);
      }
    }
  }

  parts.push("</svg>");
  return parts.join("\n");
}

function summarise(manager, refusals, queue) {
  const rooms = manager.allRooms();
  const connections = manager.allConnections();
  const neighbours = rooms.map((room) => room.connections.length);
  const histogram = {};
  for (const count of neighbours) histogram[count] = (histogram[count] || 0) + 1;
  const pending = rooms.reduce(
    (total, room) => total + room.openings.filter((opening) => opening.status === OPENING_STATUS.PENDING).length,
    0,
  );
  return {
    seed: manager.seed,
    rooms: rooms.length,
    connections: connections.length,
    directConnections: connections.filter((connection) => connection.kind === "direct").length,
    bridges: connections.filter((connection) => connection.kind === "bridge").length,
    loops: manager.stats.loops,
    deadEnds: neighbours.filter((count) => count === 1).length,
    maxDepth: manager.stats.maxDepth,
    candidates: manager.stats.candidates,
    pendingOpenings: pending,
    unexploredOpenings: queue.length,
    refusals: Object.fromEntries([...refusals.entries()].sort((a, b) => b[1] - a[1])),
    refusedByEngine: manager.stats.refusedByCode,
    neighbourHistogram: histogram,
  };
}

function explain(code) {
  const notes = {
    COLLISION_CELL: "the candidate overlapped a real cell of an existing room",
    DOOR_MISMATCH: "the child had no doorway of the right width on the facing wall",
    OUT_OF_BOUNDS: "the candidate left the dungeon radius",
    OPENING_IN_CORNER: "a doorway was too close to a corner",
    OPENING_NOT_ON_CONTOUR: "a doorway opened into a bite rather than onto the real edge",
    OPENING_NO_APPROACH: "the cell behind a doorway was not part of the room",
    NO_CLEARANCE: "the gap to a neighbour was narrower than the required clearance",
    NO_WALKABLE_PATH: "the room's own doorways could not be reached on foot",
    ROOM_DISCONNECTED: "the room was in several pieces",
    NO_OPENING: "the candidate had no doorway at all",
    EXHAUSTED: "the opening used up its attempts and is now blocked",
    NOT_PENDING: "the opening had already been connected or blocked",
    NO_FREE_SPACE: "every attempt was refused for the reasons above",
  };
  return notes[code] || "unclassified refusal";
}

// ------------------------------------------------------------------ main ---

const options = parseArguments(process.argv.slice(2));
const started = process.hrtime.bigint();
const { manager, refusals, queue } = grow(options);
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

const ascii = renderAscii(manager);
const summary = summarise(manager, refusals, queue);

if (options.json) {
  process.stdout.write(`${JSON.stringify({ ...summary, elapsedMs }, null, 2)}\n`);
} else {
  process.stdout.write(`${ascii.text}\n\n`);
  process.stdout.write(`seed ${summary.seed}: ${summary.rooms} rooms, ${summary.connections} connections `
    + `(${summary.directConnections} joints, ${summary.bridges} bridges), ${summary.loops} loops, `
    + `${summary.deadEnds} dead ends, max depth ${summary.maxDepth}, ${summary.pendingOpenings} openings left\n`);
  process.stdout.write(`${summary.candidates} candidates in ${elapsedMs.toFixed(1)} ms\n`);
  const neighbours = Object.entries(summary.neighbourHistogram)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([count, rooms]) => `${count} neighbour(s): ${rooms}`)
    .join("   ");
  process.stdout.write(`rooms by neighbour count -> ${neighbours}\n`);
  process.stdout.write("refusals:\n");
  const all = Object.entries(summary.refusals);
  if (all.length === 0) process.stdout.write("  none\n");
  for (const [code, count] of all) {
    process.stdout.write(`  ${code.padEnd(24)} ${String(count).padStart(6)}   ${explain(code)}\n`);
  }
}

if (options.ascii) {
  const target = resolve(options.ascii);
  writeFileSync(target, `${ascii.text}\n`, "utf8");
  process.stdout.write(`ASCII written to ${target}\n`);
}
if (options.svg) {
  const target = resolve(options.svg);
  writeFileSync(target, renderSvg(manager, ascii), "utf8");
  process.stdout.write(`SVG written to ${target}\n`);
}
