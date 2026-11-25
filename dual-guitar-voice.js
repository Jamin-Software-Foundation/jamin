// dual-guitar-voice.js

export class DualGuitarVoice {
  constructor(voicesApi = null, onVoiceMute = () => {}) {
    this.voices = voicesApi;
    this.onVoiceMute = onVoiceMute;
    this.mutes = { guitar: false, pad: false };

    this.activeStrings = Array.of(null, null, null, null, null, null);
    this.activePadNotes = Array.of();
    this.currentPadKey = null;

    this.noiseMode = 'MUTED_SYNC'; // 'MUTED_SYNC' | 'DEDICATED_MIDI'
    this.noiseMidiNotes = { down: 84, up: 86 };
    this.padVelocity = 62;
  }

  setVoicesApi(voicesApi) { this.voices = voicesApi; }

  setVoiceMute(voiceKey, isMuted, notifyMixer = true) {
    this.mutes[voiceKey] = isMuted;
    if (isMuted) {
      if (voiceKey === 'guitar') this.muteAllStrings();
      if (voiceKey === 'pad') this.stopPadChord();
    }
    if (notifyMixer) this.onVoiceMute(voiceKey, isMuted);
  }

  // --- Voice 1: Primary Guitar Single-String Pluck ---
  pluckString(stringIdx, midiNote, velocity, durationMs = 0) {
    if (!this.voices) return;

    const prevNote = this.activeStrings.at(stringIdx);
    if (prevNote !== null) {
      this.voices.noteOffVoice(0, prevNote);
      this.activeStrings[stringIdx] = null;
    }

    if (!this.mutes.guitar && midiNote !== null) {
      this.voices.noteOnVoice(0, midiNote, velocity);
      this.activeStrings[stringIdx] = midiNote;

      if (durationMs > 0) {
        setTimeout(() => {
          if (this.activeStrings.at(stringIdx) === midiNote) {
            this.voices.noteOffVoice(0, midiNote);
            this.activeStrings[stringIdx] = null;
          }
        }, durationMs);
      }
    }
  }

  muteAllStrings() {
    if (!this.voices) return;
    this.activeStrings.forEach((note, idx) => {
      if (note !== null) {
        this.voices.noteOffVoice(0, note);
        this.activeStrings[idx] = null;
      }
    });
  }

  // --- Voice 2: Soft Pad / String Legato Block Chords ---
  playPadChord(voicing, forceRetrigger = false) {
    if (!this.voices || !voicing) return;
    if (this.mutes.pad) {
      this.stopPadChord();
      return;
    }

    const notes = Array.from(new Set(voicing.strings.filter(n => n !== null)));
    const chordKey = notes.join(',');

    if (!forceRetrigger && chordKey === this.currentPadKey && this.activePadNotes.length > 0) {
      return;
    }

    this.stopPadChord();
    notes.forEach(midiNote => this.voices.noteOnVoice(1, midiNote, this.padVelocity));
    this.activePadNotes = notes;
    this.currentPadKey = chordKey;
  }

  stopPadChord() {
    if (!this.voices) return;
    this.activePadNotes.forEach(midiNote => this.voices.noteOffVoice(1, midiNote));
    this.activePadNotes = Array.of();
    this.currentPadKey = null;
  }

  // --- Voice 1: Physical Strumming & No-Fret Guitar Noise ---
  strumChord(voicing, { direction = 'down', velocity = 95, spreadMs = 36, subset = 'all', staccatoMs = 0 } = {}) {
    if (!voicing) return;
    let indices = Array.of(0, 1, 2, 3, 4, 5).filter(i => voicing.strings.at(i) !== null);

    if (subset === 'treble' && indices.length > 4) indices = indices.slice(-4);
	
    if (subset === 'top3' && indices.length > 3) indices = indices.slice(-3);
    else if (subset === 'treble' && indices.length > 4) indices = indices.slice(-4);

    if (direction === 'up') {
      indices.reverse();
      if (subset !== 'top3' && indices.length > 4) indices = indices.slice(0, 4);
    }


    const stepMs = spreadMs / Math.max(1, indices.length - 1);
    indices.forEach((strIdx, order) => {
      const delay = order === 0 ? 0 : Math.max(1, order * stepMs + (Math.random() - 0.5) * 3);
      const vel = Math.min(127, Math.max(25, velocity - order * 4));
      if (delay === 0) {
        this.pluckString(strIdx, voicing.strings.at(strIdx), vel, staccatoMs);
      } else {
        setTimeout(() => this.pluckString(strIdx, voicing.strings.at(strIdx), vel, staccatoMs), delay);
      }
    });
  }

  triggerGuitarNoise(direction, fallbackVoicing, bpm) {
    if (this.noiseMode === 'MUTED_SYNC') {
      const sixteenthMs = (60 / bpm / 4) * 1000;
      const dampMs = Math.max(28, Math.min(65, sixteenthMs * 0.45));
      this.strumChord(fallbackVoicing, {
        direction, velocity: direction === 'down' ? 68 : 54,
        spreadMs: 18, subset: 'all', staccatoMs: dampMs
      });
    } else {
      const fxNote = direction === 'down' ? this.noiseMidiNotes.down : this.noiseMidiNotes.up;
      this.pluckString(0, fxNote, 88, 180);
    }
  }
}
