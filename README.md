# Jamin

A browser-based audio-loop arranger

## Guitar gamepad

Connect the CRKD multi-platform Les Paul USB receiver, select PC and guitar
default mode (not KEYJAM or Festival), then press **Enable guitar**. Press a
controller button if the browser has not yet exposed it. The first standard
gamepad is used until disconnected; disable other gamepads to avoid selecting
the wrong device. Browser/OS support for the Gamepad API and its standard
mapping is required.

Strum up or down while holding a supported fret combination to select a chord,
relative to the arranger key. No fret or an unlisted combination does nothing.
The CRKD logo starts/stops the arranger. Hold Starpower with green, red, yellow
or blue for ARR A, B, C or D; orange advances, as does releasing Starpower
without a fret. Starpower combinations do not strum chords. The headstock
D-pad left/right transposes the arranger and both voices down/up one semitone;
the change is blocked if either voice would exceed its -12 to +12 range.
Some browsers or operating systems may reserve the logo button.

| Chord | Frets | Chord | Frets |
| --- | --- | --- | --- |
| 1 | Yellow | 1sus | Yellow + Orange |
| 2m | Blue | 1/3 | Yellow + Blue |
| 3m | Green + Blue | 2 | Red + Blue |
| 4 | Orange | 3b | Red + Blue + Orange |
| 5 | Green | 3 | Green + Yellow + Blue |
| 6m | Red | 4min | Red + Yellow + Blue + Orange |
| 4/5 | Yellow + Blue + Orange | 4/6 | Blue + Orange |
| 5sus | Green + Yellow | 5min | Green + Orange |
| 5/7 | Green + Red | 5b | Green + Red + Yellow |
| 6 | Red + Yellow + Blue | 7b | Red + Yellow |

Guitar input controls the arranger directly; it does not send MIDI to external
devices or play the SoundFont voices. The profile in `guitar-gamepad.js` can be
extended for other controllers with different button layouts.

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
