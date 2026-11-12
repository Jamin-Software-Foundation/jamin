# Vibe Arranger

A browser-based audio-loop arranger with two SoundFont voices and live Web MIDI input.

Serve this folder over `localhost` or HTTPS (for example, `python -m http.server`) and open it in a Chromium browser with Web MIDI and the File System Access API. Choose **Root folder** and grant access to the Ketron root. The app scans recursively for `.kst` styles and `.sf2` SoundFonts. Select a style and a patch in each voice column, connect a MIDI keyboard with **MIDI**, and use the bottom controls to start, stop, change variations, fills and breaks. The keyboard and diagnostics panel includes a virtual keyboard and a direct SoundFont upload.

Both voices play incoming notes; the selected voice's octave, transpose, insertion effect and EQ are independent. Mixer levels and mute controls affect drums, bass, chords, each voice and master separately. The arranger detects chords from three or more held notes across the keyboard.

The KST reader is the existing experimental fixed-offset parser, not a complete Ketron format implementation. It expects `USER_MODELING/LiveDrum`, `RealBass` and `RealChord` folders and matching WAV loop names referenced by the style. Unsupported styles or missing assets are reported; no Ketron assets are included. Tempo shift changes loop playback rate and uses the existing pitch-compensation asset mapping, not independent time stretching. Intro and ending controls choose the corresponding drum loops; the existing engine loops the intro until a variation is selected. This is not a full emulation of all EVM functions.
