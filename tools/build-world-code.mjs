#!/usr/bin/env node
// Bundle src/worldCode.js and its scheduler into one compact Bloxd script.
// Run `npm run build`, `npm run check`, or `npm run watch`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(ROOT, "src", "worldCode.js");
const OUT_DIR = path.join(ROOT, "world-code");
const OUT_FILE = path.join(OUT_DIR, "worldCode.js");
const CHECK_ONLY = process.argv.includes("--check");
const WATCH = process.argv.includes("--watch");
const CALLBACKS = [
  "onBlockStandStart",
  "onBlockStandStop",
  "onPlayerJoin",
  "onPlayerLeave",
  "onRespawnRequest",
  "tick",
];
/**
 * Names that must survive minification, because they are read from outside the
 * bundle: the template table a player edits, and the level table a report prints.
 * A constant renamed to `he` is a constant nobody can debug in game.
 */
const ANCHORED_GLOBALS = ["globalThis.ROOM_TEMPLATES", "globalThis.DUNGEON_LEVELS"];

function validate(code) {
  if (/^\s*(?:import|export)\b/m.test(code)) {
    throw new Error("Generated World Code must not contain import/export statements.");
  }

  for (const callback of CALLBACKS) {
    const assignment = new RegExp(`(?:^|[;,{}])\\s*${callback}\\s*=`);
    if (!assignment.test(code)) {
      throw new Error(`Bloxd callback assignment was lost during bundling: ${callback}`);
    }
  }

  for (const name of ANCHORED_GLOBALS) {
    if (!code.includes(name)) {
      throw new Error(`A name that must stay reachable was renamed during bundling: ${name}`);
    }
  }

  // The one call the whole generator is built on. A bundle without it is a bundle
  // that writes blocks one at a time again, which is the code this replaced.
  if (!code.includes("copyChunk")) {
    throw new Error("api.copyChunk is not called anywhere in the bundle");
  }
}

function options(write) {
  return {
    entryPoints: [ENTRY],
    outfile: OUT_FILE,
    bundle: true,
    write,
    format: "esm",
    platform: "browser",
    target: "es2020",
    minify: true,
    // Keep external/global names intact; minify syntax and whitespace.
    minifyIdentifiers: false,
    legalComments: "none",
    charset: "ascii",
    logLevel: "warning",
  };
}

function getOutput(result) {
  const output = result.outputFiles?.find((file) => path.resolve(file.path) === OUT_FILE);
  if (!output) throw new Error("esbuild did not produce world-code/worldCode.js");
  const code = output.text.trim() + "\n";
  validate(code);
  return code;
}

function writeOutput(code) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, code, "utf8");
  console.log(`Generated world-code/worldCode.js (${code.length.toLocaleString("en-US")} chars)`);
}

if (WATCH) {
  if (CHECK_ONLY) throw new Error("Use either --watch or --check, not both.");

  const context = await esbuild.context({
    ...options(false),
    plugins: [
      {
        name: "write-validated-world-code",
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length) return;
            try {
              writeOutput(getOutput(result));
            } catch (error) {
              console.error(error.message || error);
            }
          });
        },
      },
    ],
  });

  await context.watch();
  console.log("Watching src/ for changes; generated output is world-code/worldCode.js.");
} else {
  const result = await esbuild.build(options(false));
  const code = getOutput(result);

  if (CHECK_ONLY) {
    if (!fs.existsSync(OUT_FILE) || fs.readFileSync(OUT_FILE, "utf8") !== code) {
      console.error("world-code/worldCode.js is out of date. Run `npm run build`.");
      process.exitCode = 1;
    } else {
      console.log("world-code/worldCode.js is up to date.");
    }
  } else {
    writeOutput(code);
  }
}
