# Jamin

A browser-based audio-loop arranger

## Importing assets

Use **Import** in Global to select a ZIP containing any of `USER_STYLE`,
`USER_MODELING`, and `VOICES` (optionally inside a parent folder). Styles are
`.KST` files; modeling folders contain audio loops; voices can be `.sf2` files
or folders of consecutive `part_00`, `part_01`, ... SoundFont chunks.

Imports are stored per file in the browser's `jamin` IndexedDB and are merged
with the read-only assets when **ON** is pressed. Importing while ON refreshes
the browsers. Reimporting a path replaces the previous imported file, and an
imported modeling loop takes precedence over a built-in loop of the same name.
FLAC and OGG files are preserved; WAV files are converted to lossy Ogg Vorbis
at quality 4. Mono and stereo WAV files are supported. Storage is local to the
browser and subject to its storage quota and site-data clearing.

The Vorbis encoder is vendored from `@audio/encode-ogg`; its license is in
`vendor/encode-ogg/LICENSE`. Run `npm install` and `npm test` for the import
regression tests; the app itself does not require an install or build step.
