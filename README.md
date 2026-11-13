# Jamin Arranger

A browser-based audio-loop arranger with two SoundFont voices and live Web MIDI input to be used as a portable alternative to the Ketron Event Module (EVM) .

<img width="1852" height="1022" alt="image" src="https://github.com/user-attachments/assets/b3947fad-35ab-4f63-bc12-284aed03b3bd" />

Access directly from https://jamin-software-foundation.github.io/jamin/ or download and serve locally over `localhost` or HTTPS (for example, `python -m http.server`). Open it in a Chromium browser with Web MIDI and the File System Access API. Choose **Root folder** and grant access to the Ketron root. The app scans recursively for `.kst` styles and `.sf2` SoundFonts. Select a style and a patch in each voice column, connect a MIDI keyboard with **MIDI**, and use the bottom controls to start, stop, change variations, fills and breaks. Click the Style, Voice 1 or Voice 2 header to show its list in the large display under columns 2-4. Lists are two levels deep: pick a style category (folder) or SoundFont file first, then a style or patch; use the back row to return. `ARR A-D` choose the variation, `VAR 1-4` toggles the `VAR 5-8` alternate of the current variation, and `FILL` / `BREAK` play the fill or break matching the current variation.

Registrations: the dropdown in the Global column selects slots 1-20 (● marks used slots). **Save reg** writes style, voices (SoundFont, patch, octave, transpose, effects, EQ), mixer, key, tempo shift, AutoFill, intro/ending and variation to `REGISTRATIONS/REG_nn.json` in the root folder (the folder picker requests write access); without a root folder it uses browser storage. **Recall** restores the slot; items missing from the scanned folder are reported. Playing state is not restored unless the arranger is running.

Both voices play incoming notes; the selected voice's octave, transpose, insertion effect and EQ are independent. Mixer levels and mute controls affect drums, bass, chords, each voice and master separately. The arranger detects chords from three or more held notes across the keyboard.

The KST file reader is a fixed-offset parser, not a complete Ketron format implementation. It expects `USER_MODELING/LiveDrum`, `RealBass` and `RealChord` folders and matching WAV loop names referenced by the style. Unsupported styles or missing assets are reported; no Ketron assets are included. Tempo shift changes loop playback rate and uses the existing pitch-compensation asset mapping, not independent time stretching. Intro and ending controls choose the corresponding drum loops; the existing engine loops the intro until a variation is selected. 

This is not a full emulation of all EVM functions. It clones and extends the [Vibe Arranger implementation](https://github.com/deleolajide/vibe-arranger).
