# Jamin

A static, browser-based audio arranger with loop playback, two SoundFont voices,
MIDI and gamepad control, and a live guitar strummer. The application runs
directly from its source files; it has no build step.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the module dependency map, data
storage boundaries, and Mermaid diagrams of the main workflows.

## Run and test

Serve the repository root over localhost or HTTPS, then open it in a
Web-Audio-capable browser. The browser loads `index.html`, which assembles the
console UI and starts the application. For example, from the repository root:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/`. Hardware input requires browser support and
device permissions. Install the Node dependencies and run the regression tests
with `npm install` and `npm test`; these are for development and are not needed
to run the app.

## Offline use

Open Jamin over HTTPS or localhost while connected and keep the page open until
the Global status says **Offline ready**. The service worker downloads the app
shell and all bundled files listed in `manifest.json` (about 928 MB in this
checkout), so sufficient browser storage is required. A connection is required
for the initial download and updates; an incomplete download is not
offline-ready. If preparation fails, check the connection and storage, then
reload to retry. Browser storage eviction or clearing site data removes the
offline copy and imported files.

After preparation, reopen the same URL offline. Imported assets remain in the
browser's local IndexedDB; hardware features still require compatible devices,
browser support and any required permissions. Offline updates may wait until
all Jamin tabs are closed. To deploy an update, increment `CACHE_NAME` in
`service-worker.js` whenever the app shell or bundled assets change, and keep
its shell list and `manifest.json` in sync with the deployed files. Files
listed in the manifest must actually be deployed.

## Guitar gamepad & live strummer

Connect the CRKD multi-platform Les Paul USB receiver, select PC and guitar
default mode (not KEYJAM or Festival), then press **Guitar Off** to enable the
input (the button changes to **Guitar On**). Press a controller button if the
browser has not yet exposed it. The first standard gamepad is used until
disconnected; disable other gamepads to avoid selecting the wrong device.
Browser/OS support for the Gamepad API and its standard mapping is required.

### Playing chords, strums & dual voices
Pressing fret combinations stages the next chord relative to the arranger key;
flicking or holding the **strum bar up or down** commits the chord change and
plays both SoundFont voices:
* **Voice 1 (Primary Guitar):** Plays 6-string strummed chords, `.strumseq`
  rhythmic patterns, alternating root/5th basslines, fingerstyle arpeggios, or
  no-fret percussive guitar noises. Automatically switches to a tight, dry
  mix during strumming and Boom-Chick modes and opens into subtle room ambience
  during fingerstyle arpeggios.
* **Voice 2 (Sustaining Pad / Strings):** Plays smooth, legato block chords
  underneath Voice 1 and sustains across rhythms until a new chord is strummed
  or the Whammy bar is pressed alone (`Whammy` + no frets) to cut it off.
* **Tempo & Bar-Phase Sync:** Selecting a `.KST` style immediately locks the
  guitar strummer to the style's BPM (including Tempo Shift). Starting a
  `.strumseq` groove first allows the arranger band to drop in cleanly on the
  next bar downbeat when started.

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

### Arranger, variation & fill/break controls
* **CRKD Logo (Button 16):** Starts the arranger (snapping onto Beat 1 of an
  active `.strumseq` loop if strumming started first), schedules the
  bar-quantized ending when pressed with no frets, or stops immediately when
  pressed while holding any fret.
* **Starpower (Button 14):**
  * **No frets:** Advances to the next variation (with Auto-Fill if enabled).
  * **Orange:** Steps back to the previous variation.
  * **Green / Red / Yellow / Blue:** Jumps directly to **Variations 1–4** (`ARRA`–`ARRD`).
  * **G+R / R+Y / Y+B / B+O:** Jumps directly to **Variations 5–8** (`ARRA_1`–`ARRD_1`).
* **Start (Button 11):** Plays a bar-quantized **Drum Break** (`BRKA`–`BRKD`)
  when pressed with no frets, or triggers **Drum Fills 1–4** (`FILA`–`FILD`)
  when held with **Green**, **Red**, **Yellow**, or **Blue**.
* **Button 8 + Frets (Masks 1–20):** Recalls saved **Registrations 1–20**
  (restoring style, tempo, key, mixer levels, SoundFont voices, and active
  `.strumseq` / guitar mode settings).
* **Headstock D-pad Left / Right (Buttons 10 / 15):** Transposes the arranger
  key and both SoundFont voices down or up one semitone (blocked if either voice
  would exceed its -12 to +12 range).

### Whammy modal matrix (strumming, arpeggios & mutes)
Holding the **Whammy bar (Button 6)** turns the fret buttons into a modal
command selector (triggered on Whammy release):

| Whammy + Frets | Action |
| --- | --- |
| *(No frets)* | Cutoff / choke sustained **Voice 2** pad chord |
| **Green** | **StrumSeq mode** (enables Auto-Strum and plays `.strumseq` patterns) |
| **Red** | **Boom-Chick mode** (alternating root/5th bass on strum down, treble strum on strum up) |
| **Yellow / Blue / Orange** | **Arpeggio modes 1–3** (root bass on strum down, sequence step on strum up; open chord strum when no frets are held) |
| **Green + Red** | Toggle **Auto-Hold** ON/OFF (latches `.strumseq` loop continuously across chord changes) |
| **Green + Yellow** | Toggle **Auto-Strum** ON/OFF (when Auto-Strum is ON and Auto-Hold is OFF, `.strumseq` plays while the strum bar is held up or down and stops when returned to neutral; when Auto-Strum is OFF, strum bar plays manual down/up strums only) |
| **Red + Yellow + Strum Down** | **Tap Tempo** for the `.strumseq` clock |
| **Yellow + Blue** | Toggle no-fret guitar noise between **tempo-synced muted rakes** and **MIDI FX notes** |
| **Blue + Orange** | Toggle **Voice 2 (Pad)** mute ON/OFF |
| **G + R + Y** | Mute / unmute **Drums** |
| **R + Y + B** | Mute / unmute **Bass** |
| **Y + B + O** | Mute / unmute **Backing Chords** |
| **G + B + O** | Mute / unmute **Voice 1 (Guitar)** |
| **G + R + O** | Mute / unmute **Voice 2 (Pad)** |
| **All 5 Frets** | **Panic / Stop** (silences all guitar strings, pad notes, and Auto-Hold) |

The profile in `crkd-gamepad.js` can be extended for other controllers with
different button layouts.

## Importing assets

Use **Import** in Global to select a ZIP containing any of `USER_STYLE`,
`USER_MODELING`, `USER_IR`, `VOICES`, and `STRUMSEQ` (optionally inside a parent
folder). Styles are `.KST` files; modeling folders contain audio loops; IR
folders contain impulse responses; voices can be `.sf2` files or folders of
consecutive `part_00`, `part_01`, ... SoundFont chunks; and `STRUMSEQ` folders
contain Ample Sound `.strumseq` XML pattern files (which can also be browsed in
the lower half of the **Voice 1** panel).

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
