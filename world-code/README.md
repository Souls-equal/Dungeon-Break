# World Code compact

`worldCode.js` is generated from `src/` — the lobby, the scheduler and the
chunk-copy dungeon generator — and nothing else.

Do not edit it by hand; edit `src/` and run `npm run build` (or leave
`npm run watch` running). `npm run check` fails if the committed file is out of
date, if a Bloxd callback is missing, or if the bundler renamed one of the two
globals the game reads back (`ROOM_TEMPLATES`, `DUNGEON_LEVELS`) or dropped
`copyChunk`.

Copy the entire `worldCode.js` file into Bloxd World Code. It is one script with
no imports, so no separate file needs to be pasted.

Before it can build a dungeon, fill `globalThis.ROOM_TEMPLATES` in
`src/dungeon/templates.js` with the coordinates of your 32×32×32 room chunks —
see the README.
