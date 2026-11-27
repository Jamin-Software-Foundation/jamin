# Architecture

Jamin is a static browser application. It has no server-side runtime, bundler,
or compile step: the browser loads the classic scripts and ES modules directly
from the repository. `index.html` provides the initial DOM and import map;
`console-layout.js` moves those controls into the performance-console layout
before the `index.js` module executes.

## Project and dependency map

```mermaid
flowchart TD
    HTML["index.html<br/>DOM, styles, import map"] --> Layout["console-layout.js<br/>builds console UI"]
    HTML --> Offline["offline.js<br/>service-worker registration/status"]
    HTML --> App["index.js<br/>application composition root"]
    Offline --> SW["service-worker.js<br/>offline cache lifecycle"]

    App --> Assets["imported-assets.js<br/>manifest overlay, IndexedDB, decoding"]
    App --> KST["kshp-loader.js<br/>KST parsing and loop loading"]
    App --> Arranger["arranger-player.js<br/>loop scheduling and transitions"]
    App --> Voices["voices.js<br/>two SoundFont voices"]
    App --> MIDI["midi-keyboard.js<br/>Web MIDI and virtual keyboard"]
    App --> CRKD["crkd-bridge.js<br/>Gamepad API adapter"]
    App --> Rig["rig-bridge.js<br/>guitar rig, IRs, registrations"]
    App --> Neo["neouke-ble.js<br/>optional Bluetooth controller"]
    App --> SeqBrowser["strumseq-browser.js<br/>pattern selection"]

    KST --> Assets
    SeqBrowser --> Assets
    Voices --> Scanner["sf2-bank-scanner.js<br/>SoundFont and patch discovery"]
    Voices --> VoiceUI["voice-ui.js<br/>voice controls and effects"]
    Voices --> SynthLib["spessasynth/spessasynth_lib.js"]
    SynthLib --> Core["spessasynth/spessasynth_core.js"]
    SynthLib --> Processor["spessasynth/spessasynth_processor.min.js<br/>AudioWorklet"]
    CRKD --> Engine["crkd-strummer-engine.js<br/>chord and strum state"]
    CRKD --> Profile["crkd-gamepad.js<br/>standard Gamepad mapping"]
    Engine --> DualVoice["dual-guitar-voice.js<br/>string and pad note control"]
    Engine --> Clock["strum-clock-runner.js<br/>pattern clock"]
    Clock --> Parser["strumseq-parser.js<br/>XML pattern events"]
    Rig --> GuitarRig["guitar-rig-ui.js"]
    Rig --> Registrations["registrations.js"]
    Rig --> Assets
    GuitarRig --> Effects["xg-effects.js"]
    GuitarRig --> Cabinet["ir-cabinet.js"]

    App --> Mixer["Web Audio mixer<br/>track gains and master limiter"]
    KST -->|"decoded loop buffers"| Arranger
    Arranger -->|"quantized accompaniment"| Mixer
    Voices -->|"synth output"| Mixer
    DualVoice -->|"notes on Voice 1 / Voice 2"| Voices
    GuitarRig -->|"optional Voice 1 processing"| Mixer
    MIDI -->|"notes, chord detection, controls"| Voices
    MIDI --> Arranger
    CRKD -->|"chords, transport, variations"| Arranger
    Neo -->|"chords and transport"| Arranger

    ImportTool["generate-manifest.html<br/>asset manifest authoring"] -->|"scans assets/"| Manifest["manifest.json<br/>bundled asset tree"]
    SplitTool["sf2-splitter.html<br/>SoundFont chunk authoring"] -. "writes chunks" .-> VoiceAssets["assets/VOICES/&lt;name&gt;/part_NN"]
    VoiceAssets -. "included in manifest" .-> Manifest
```

The manifest generator and SoundFont splitter are authoring utilities, not
runtime dependencies. `manifest.json` describes the `assets/` tree and is read
by the application and service worker. The import map in `index.html` resolves
the `spessasynth_core`, `fflate`, and `stb-vorbis` module names used by the
vendored synthesizer.

### Main source areas

| Area | Responsibility |
| --- | --- |
| `index.html`, `console-layout.js`, `index.css`, `console.css` | Static page, dynamic console layout, and presentation |
| `index.js` | Creates shared audio/mixer state, connects feature modules, and handles asset/style selection |
| `imported-assets.js`, `manifest.json`, `assets/` | Built-in and imported asset tree; imported files are persisted in IndexedDB |
| `kshp-loader.js`, `arranger-player.js` | Extract style metadata and audio-loop paths, then schedule accompaniment |
| `voices.js`, `voice-ui.js`, `sf2-bank-scanner.js`, `spessasynth/` | SoundFont discovery, patch selection, voice settings, and AudioWorklet synthesis |
| `crkd-*.js`, `dual-guitar-voice.js`, `guitar-voicing.js`, `strum-clock-runner.js`, `strumseq-*.js` | Gamepad mapping, guitar voicing, dual-voice performance, and sequenced strumming |
| `midi-keyboard.js`, `neouke-ble.js` | MIDI, on-screen keyboard, and optional Bluetooth controller input |
| `rig-bridge.js`, `guitar-rig-ui.js`, `xg-effects.js`, `ir-cabinet.js`, `registrations.js` | Guitar processing, impulse responses, and saved performance state |
| `offline.js`, `service-worker.js`, `web-manifest.json` | Installable web app metadata and offline caching |
| `test/` | Node test suite for imported assets, gamepad input, and service-worker behavior |
| `generate-manifest.html`, `sf2-splitter.html`, `convert-wav-to-flac.ps1` | Asset preparation utilities; not loaded by the application |

## Core workflows

### Startup and asset discovery

Selecting **ON** fetches `manifest.json`, overlays imported files from
IndexedDB, then scans the merged tree for styles, SoundFonts, strum patterns,
and IRs. The merged tree is an in-memory index: built-in files are fetched by
path, while imported files are read from IndexedDB.

```mermaid
sequenceDiagram
    actor User
    participant UI as console-layout.js
    participant App as index.js
    participant Manifest as manifest.json
    participant Store as IndexedDB
    participant Scanners as style / voice / pattern / IR scanners

    User->>UI: Select ON
    UI->>App: btn-link-dir click
    App->>Manifest: fetch asset tree
    App->>Store: merge imported file paths
    Store-->>App: imported entries
    App->>App: overlay imported entries onto tree
    App->>Scanners: scan merged tree
    Scanners-->>UI: populate styles, patches, patterns, IRs
    App-->>UI: Assets ready
```

### Style load and arranger playback

A selected `.KST` style contains tempo and references to its drum, bass, and
chord loop folders. `index.js` reads the style file, then `kshp-loader.js`
extracts those references, reads and decodes the audio files in small batches,
and returns buffers to `arranger-player.js`. Playback uses Web Audio buffer
sources, one gain route per accompaniment track, and a shared master
compressor. Variation, fill, break, and ending transitions are scheduled
against the current bar phase; chord changes replace bass and chord loops
immediately while preserving their position in the loop.

```mermaid
sequenceDiagram
    actor User
    participant App as index.js
    participant Loader as kshp-loader.js
    participant Assets as imported-assets.js
    participant Player as arranger-player.js
    participant Clock as StrumClockRunner
    participant Mixer as Web Audio mixer

    User->>App: Select style
    App->>Assets: read selected KST
    Assets-->>App: KST bytes
    App->>Loader: parseAndLoadKst(KST bytes, merged tree)
    Loader->>Assets: read referenced loops
    Assets-->>Loader: decoded AudioBuffers
    Loader-->>App: style tempo and loop buffers
    App->>Player: setStyleData(tempo, buffers)
    User->>Player: Start
    alt StrumSeq clock already running
        Player->>Clock: use next shared bar boundary
    else no active strum clock
        Player->>Clock: synchronize bar start
    end
    Player->>Mixer: schedule intro and accompaniment loops
    User->>Player: Chord change
    Player->>Mixer: replace bass and chord loops at current loop offset
    User->>Player: Variation, fill, break, or ending
    Player->>Mixer: schedule transition at next bar boundary
```

The tempo-shift control changes playback rate and effective BPM. When the
strummer is active, the arranger uses its clock's bar start so the
accompaniment can enter on a shared downbeat. MIDI chord detection and
committed gamepad chords both feed `arranger-player.js`; the arranger owns
accompaniment state and quantized transitions.

### Live input and sound generation

MIDI notes can trigger both SoundFont voices; the keyboard input path also
detects multi-note chords and forwards them to the arranger. The CRKD bridge
polls a standard-mapped Gamepad and delegates button interpretation to
`CRKDGamepadController`. Its strummer engine resolves fret masks into voicings,
then drives Voice 1 guitar notes and sustaining Voice 2 pad notes through
`DualGuitarVoice`. `.strumseq` events are parsed into a sixteenth-note pattern
and scheduled by the strum clock.

```mermaid
flowchart LR
    MIDI["Web MIDI / virtual keyboard"] --> MIDIInput["midi-keyboard.js"]
    MIDIInput -->|"notes"| Voices["voices.js"]
    MIDIInput -->|"detected chord"| Arranger["arranger-player.js"]

    Pad["CRKD Gamepad API"] --> Bridge["crkd-bridge.js"]
    Bridge --> Controller["crkd-gamepad.js"]
    Controller --> Engine["crkd-strummer-engine.js"]
    Engine -->|"committed chord / transport / variation"| Arranger
    Engine --> Dual["dual-guitar-voice.js"]
    Pattern[".strumseq XML"] --> Parser["strumseq-parser.js"]
    Parser --> Clock["strum-clock-runner.js"]
    Clock --> Engine

    Dual -->|"guitar notes"| Voice1["SoundFont Voice 1"]
    Dual -->|"pad notes"| Voice2["SoundFont Voice 2"]
    Voices --> Voice1
    Voices --> Voice2
    Voice1 -->|"optional effects and IR cabinet"| Mixer["track mixer + master limiter"]
    Voice2 --> Mixer
    Arranger -->|"drum / bass / chord loops"| Mixer
    Mixer --> Output["AudioContext destination"]
```

The optional guitar rig inserts effects and an IR cabinet into Voice 1's audio
route while guitar mode is active; Voice 2 and arranger loops use their own
mixer channels. Mixer state is shared with the hardware mute and registration
controls.

### Import and persistence

Imports are ZIP files with recognized roots: `USER_STYLE`, `USER_MODELING`,
`USER_IR`, `VOICES`, and `STRUMSEQ`. The importer validates paths and the ZIP
directory, stages entries in IndexedDB, converts WAV audio to Ogg, then commits
the staged files so a failed import does not replace existing imports.
`mergeImportedAssets()` overlays these paths on the built-in manifest tree;
imported modeling audio takes precedence over a built-in audio file with the
same stem. User imports live in the browser's `jamin` database.

Registrations are a separate persistence mechanism: the 20 saved states are
JSON values in `localStorage`. They capture selected style and performance
controls, guitar settings, mixer levels, and selected voices. Imported assets
and registrations are local to the browser profile and are not synchronized.

### Offline lifecycle

`offline.js` registers the service worker only in a secure context. During
installation, `service-worker.js` fetches the asset manifest, validates its
paths, and caches both the application shell and every file in the manifest.
Progress and failures are reported to the page. Same-origin GET requests are
served cache-first; activation removes older `jamin-offline-*` caches.

```mermaid
flowchart TD
    Page["HTTPS / localhost page"] --> Register["offline.js registers service-worker.js"]
    Register --> Install["Install event"]
    Install --> Manifest["Fetch manifest.json"]
    Manifest --> Paths["Validate paths and enumerate asset files"]
    Paths --> Cache["Cache shell + all manifest assets"]
    Cache --> Ready["Worker activates; page reports Offline ready"]
    Page --> Request["Same-origin GET"]
    Request --> CacheFirst{"Cached response?"}
    CacheFirst -->|Yes| Cached["Return cache"]
    CacheFirst -->|No| Network["Fetch network"]
    Activate["New worker activates"] --> Cleanup["Delete old jamin-offline-* caches"]
```

The offline cache and imported IndexedDB files are independent stores.
Increment `CACHE_NAME` in `service-worker.js` when deploying app-shell or
bundled-asset changes, and regenerate or update `manifest.json` when the asset
tree changes.

## Dependencies and tests

There is no application build pipeline. The browser loads vendored SpessaSynth modules and the local Ogg encoder module
for WAV-to-Ogg import conversion.
`package.json` provides the Node test command; `fake-indexeddb` supports the
asset-import tests. Run `npm install` and `npm test` to execute the tests.
