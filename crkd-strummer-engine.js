// crkd-strummer-engine.js
import { guitarChords, ARPEGGIO_SEQUENCES, resolveSixStringVoicing } from './guitar-voicing.js';
import { DualGuitarVoice } from './dual-guitar-voice.js';
import { CRKDGamepadController, crkdProfile } from './crkd-gamepad.js';
import { StrumClockRunner } from './strum-clock-runner.js';

export class CRKDStrummerEngine {
  constructor(options = {}) {
	this.onFillBreak = options.onFillBreak || (() => {}); 
    this.onStateChange = options.onStateChange || (() => {});
    this.onTrackMute = options.onTrackMute || (() => {});
    this.onChordCommit = options.onChordCommit || (() => {});
    this.onLogoPress = options.onLogoPress || (() => {});
    this.onStarPress = options.onStarPress || (() => {});
    this.onTranspose = options.onTranspose || (() => {});
    this.onRecallReg = options.onRecallReg || (() => {});	

    this.voice = new DualGuitarVoice(options.voices || null, (voiceKey, isMuted) => {
      const mixerKey = voiceKey === 'guitar' ? 'voice1' : 'voice2';
      this.onTrackMute(mixerKey, isMuted);
    });

    this.playMode = 'STRUMSEQ';
    this.autoHold = false;
    this.transpose = 0;
    this.trackMutes = { drums: false, bass: false, chords: false };

    this.currentFretMask = 0;
    this.pendingChordMask = 0;
    this.committedChordMask = 0;
    this.lastValidVoicing = resolveSixStringVoicing(Object.values(guitarChords).at(0), 0);
    this.boomChickToggle = false;
    this.arpStep = 0;

    this.clock = new StrumClockRunner(this.voice, () => this.emitState());
    this.gamepad = new CRKDGamepadController(options.profile || crkdProfile, {
      onLogoPress: (frets) => this.onLogoPress(frets),
      onStarPress: (frets) => this.onStarPress(frets),
      onFillBreak: (frets) => this.onFillBreak(frets),
      onRecallReg: (frets) => this.onRecallReg(frets),
      onTranspose: (d) => this.onTranspose(d),
      onTapTempo: () => { if (this.clock.registerTap()) { this.syncClock(); this.emitState(); } },
      onWhammyCommand: (mask) => this.executeWhammyCommand(mask),
      onFretChange: (mask) => this.handleFretChange(mask),
      onStrum: (dir) => this.handleStrum(dir)
    });
  }

  setAudioContext(ctx) { if (ctx) this.clock.setAudioContext(ctx); }
  syncBarStart(tsSec) { this.clock.syncBarStart(tsSec); }
  stop() { this.clock.stopClock(); this.voice.muteAllStrings(); this.voice.stopPadChord(); }

  loadStrumSeqXML(xmlText, keepCurrentBpm = false) {
    const prevBpm = this.clock.bpm;
    if (this.clock.loadXML(xmlText)) {
      if (keepCurrentBpm) this.clock.bpm = prevBpm;
      this.syncClock();
      this.emitState();
    }
  }

  getCommittedVoicing() {
    const def = guitarChords[this.committedChordMask];
    if (!def) return null;
    this.lastValidVoicing = resolveSixStringVoicing(def, this.transpose);
    return this.lastValidVoicing;
  }

  syncClock() {
    if (this.playMode === 'STRUMSEQ' && this.autoHold && this.committedChordMask > 0) {
      this.clock.startClock(() => this.getCommittedVoicing());
    } else {
      this.clock.stopClock();
    }
  }

  handleFretChange(mask) {
    this.currentFretMask = mask;
    if (mask > 0) this.pendingChordMask = mask;
    else if (!this.autoHold) this.pendingChordMask = 0;
    this.emitState();
  }

  handleStrum(direction) {
    const isArpMode = Boolean(ARPEGGIO_SEQUENCES[this.playMode]);

    // 1. When no frets are held (and Auto-Hold is OFF):
    //    - In Yellow/Blue/Orange Arpeggio modes -> play a full strum of the last chord
    //    - In STRUMSEQ / BOOM_CHICK modes -> trigger guitar noise
    if (!this.autoHold && this.currentFretMask === 0) {
      if (isArpMode && this.lastValidVoicing) {
        this.voice.strumChord(this.lastValidVoicing, {
          direction,
          velocity: direction === 'down' ? 100 : 88,
          spreadMs: direction === 'down' ? 36 : 28,
          subset: direction === 'down' ? 'all' : 'treble'
        });
      } else {
        this.committedChordMask = 0;
        this.voice.triggerGuitarNoise(direction, this.lastValidVoicing, this.clock.bpm);
      }
      return this.emitState();
    }


    const targetMask = this.currentFretMask > 0 ? this.currentFretMask : (this.autoHold ? this.pendingChordMask : 0);
    if (!targetMask || !guitarChords[targetMask]) {
      this.voice.stopPadChord();
      this.voice.triggerGuitarNoise(direction, this.lastValidVoicing, this.clock.bpm);
      return this.emitState();
    }

    const chordChanged = targetMask !== this.committedChordMask;
    if (!chordChanged && this.playMode === 'STRUMSEQ' && this.autoHold && this.clock.isRunning) {
      return;
    }

    if (this.clock.barStartTimeSec === null) this.clock.syncBarStart();
    if (chordChanged) {
      this.committedChordMask = targetMask;
      this.boomChickToggle = false;
      this.arpStep = 0;
      this.onChordCommit(guitarChords[targetMask]);
    }

    const voicing = this.getCommittedVoicing();
    // Sustain Voice 2 (Pad/Strings) cleanly under the committed chord
    this.voice.playPadChord(voicing);

    if (this.playMode === 'STRUMSEQ') {
      if (this.autoHold) {
        // Pure .strumseq playback only: start clock if stopped, otherwise let the running
        // pattern pick up the newly committed chord seamlessly on the next grid step!
        if (!this.clock.isRunning) {
          this.syncClock();
        }
      } else {
        // Auto-Hold OFF: manual down/up strums only
        this.voice.strumChord(voicing, {
          direction, velocity: direction === 'down' ? 105 : 92,
          spreadMs: direction === 'down' ? 36 : 28, subset: direction === 'down' ? 'all' : 'treble'
        });
      }
    } else if (this.playMode === 'BOOM_CHICK') {
      if (direction === 'down') {
        const bass = voicing.bassString;
        const alt = Math.min(5, bass + 1);
        const idx = (this.boomChickToggle && voicing.strings.at(alt) !== null) ? alt : bass;
        this.voice.pluckString(idx, voicing.strings.at(idx), 102);
        this.boomChickToggle = !this.boomChickToggle;
      } else {
        this.voice.strumChord(voicing, { direction: 'up', velocity: 88, spreadMs: 30, subset: 'treble' });
      }
    } else if (isArpMode) {
      const seq = ARPEGGIO_SEQUENCES[this.playMode];
      if (direction === 'down') {
        this.arpStep = 1 % seq.length;
        this.voice.pluckString(voicing.bassString, voicing.strings.at(voicing.bassString), 100);
      } else {
        const token = seq.at(this.arpStep % seq.length);
        const idx = token === 'bass' ? voicing.bassString : token;
        const validIdx = voicing.strings.at(idx) !== null ? idx : voicing.bassString;
        this.voice.pluckString(validIdx, voicing.strings.at(validIdx), 86);
        this.arpStep = (this.arpStep + 1) % seq.length;
      }
    }
    this.emitState();
  }
  
  syncModeReverb() {
    if (!this.voice?.voices?.setVoiceReverb) return;
    const isDryRhythm = this.playMode === 'STRUMSEQ' || this.playMode === 'BOOM_CHICK';
    this.voice.voices.setVoiceReverb(0, isDryRhythm ? 8 : 38);
  }
  

  executeWhammyCommand(mask) {
    const toggleTrack = (t) => { this.trackMutes[t] = !this.trackMutes[t]; this.onTrackMute(t, this.trackMutes[t]); };
    switch (mask) {
      case 0:  this.voice.stopPadChord(); break; // Whammy alone -> choke Voice 2 Pad
      case 1:  this.playMode = 'STRUMSEQ'; break;
      case 2:  this.playMode = 'BOOM_CHICK'; break;
      case 4:  this.playMode = 'ARP_YELLOW'; break;
      case 8:  this.playMode = 'ARP_BLUE'; break;
      case 16: this.playMode = 'ARP_ORANGE'; break;
      case 3:
        this.autoHold = !this.autoHold;
        if (this.autoHold && this.currentFretMask > 0) {
          this.pendingChordMask = this.currentFretMask;
          if (!this.committedChordMask) this.committedChordMask = this.currentFretMask;
        }
        break;
      case 12: this.voice.noiseMode = this.voice.noiseMode === 'MUTED_SYNC' ? 'DEDICATED_MIDI' : 'MUTED_SYNC'; break;
      case 24: this.voice.setVoiceMute('pad', !this.voice.mutes.pad); break;
      case 7:  toggleTrack('drums'); break;
      case 14: toggleTrack('bass'); break;
      case 28: toggleTrack('chords'); break;
      case 25: this.voice.setVoiceMute('guitar', !this.voice.mutes.guitar); break;
      case 19: this.voice.setVoiceMute('pad', !this.voice.mutes.pad); break;
      case 31: this.stop(); this.autoHold = false; this.pendingChordMask = 0; this.committedChordMask = 0; this.clock.barStartTimeSec = null; break;
    }
    this.syncModeReverb();	
    this.syncClock();
    this.emitState();
  }

  emitState() {
    const displayMask = this.committedChordMask || this.pendingChordMask;
    const chordDef = guitarChords[displayMask] || null;
    this.onStateChange({
      playMode: this.playMode, autoHold: this.autoHold, noiseMode: this.voice.noiseMode,
      bpm: this.clock.bpm, transpose: this.transpose, currentFretMask: this.currentFretMask,
      chordDef, voicing: chordDef ? resolveSixStringVoicing(chordDef, this.transpose) : null,
      seqStep: this.clock.seqStep, mutes: { ...this.trackMutes, ...this.voice.mutes }
    });
  }
}
