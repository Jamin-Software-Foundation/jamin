// crkd-bridge.js
import { CRKDStrummerEngine } from './crkd-strummer-engine.js';
import { crkdProfile } from './crkd-gamepad.js';

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function createCrkdBridge({ getAudio, voices, arranger, mixerState, mixerUpdaters, getRegs, logger }) {
  const keyInput = document.getElementById('ctrl-key');
  const guitarBtn = document.getElementById('btn-guitar');
  const guitarStatus = document.getElementById('guitar-status');
  
  const MODE_COLORS = {
	  STRUMSEQ:   { bg: '#2ea043', fg: '#fff', label: 'STRUMSEQ' },
	  BOOM_CHICK: { bg: '#da3633', fg: '#fff', label: 'BOOM-CHICK' },
	  ARP_YELLOW: { bg: '#d29922', fg: '#000', label: 'ARP: YELLOW' },
	  ARP_BLUE:   { bg: '#1f6feb', fg: '#fff', label: 'ARP: BLUE' },
	  ARP_ORANGE: { bg: '#db6d28', fg: '#fff', label: 'ARP: ORANGE' }
  };
  
  let guitarEnabled = false;
  let guitarIndex = null;
  let guitarFrame = null;

  const strummer = new CRKDStrummerEngine({
    voices,
    profile: crkdProfile,
    onLogoPress: (frets) => arranger.getState().isPlaying
      ? (frets === 0 ? arranger.toggleStartEnd() : arranger.stopImmediate())
      : arranger.toggleStartEnd(),
    onStarPress: (frets) => {
      if (frets === 0) return arranger.nextVar();
      if (frets === 16) return arranger.prevVar();
      const varMap = { 1: 0, 2: 1, 4: 2, 8: 3, 3: 4, 6: 5, 12: 6, 24: 7 };
      if (varMap[frets] !== undefined) arranger.setVariation(varMap[frets]);
    },
    onFillBreak: (frets) => {
      if (frets === 0) return arranger.playBreak();
      const fillMap = { 1: 0, 2: 1, 4: 2, 8: 3 };
      if (fillMap[frets] !== undefined) arranger.playFill(fillMap[frets]);
    },
    onRecallReg: (frets) => {
      const regs = getRegs();
      if (regs && frets >= 1 && frets <= 20) {
        const regSelect = document.getElementById('reg-select');
        if (regSelect) regSelect.selectedIndex = frets - 1;
        regs.recall(frets);
      }
    },
    onChordCommit: ([t, r, b]) => {
      arranger.requestVariation();
      arranger.changeChord(t, r, b);
    },
	onTranspose: (step) => {
		const nextIdx = (noteNames.indexOf(keyInput.value) + step + 12) % 12;
		keyInput.value = noteNames.at(nextIdx);
		keyInput.dispatchEvent(new Event('change'));
	},

    onTrackMute: (track, isMuted) => {
      if (mixerState[track]) {
        mixerState[track].muted = isMuted;
        mixerUpdaters[track]?.();
      }
    },
    onStateChange: (state) => {
      const modeEl = document.getElementById('hud-mode');
      const holdEl = document.getElementById('hud-hold');
      const noiseEl = document.getElementById('hud-noise');
      const chordEl = document.getElementById('hud-chord');
      if (!modeEl) return;
	  
      const autoStrumEl = document.getElementById('hud-autostrum');
      if (autoStrumEl) {
        autoStrumEl.textContent = `STRUM: ${state.autoStrum ? 'AUTO' : 'MAN'}`;
        autoStrumEl.style.background = state.autoStrum ? '#2ea043' : '#313244';
        autoStrumEl.style.color = state.autoStrum ? '#fff' : '#a6adc8';
      }
	  

      const theme = MODE_COLORS[state.playMode] || MODE_COLORS.STRUMSEQ;
      modeEl.textContent = theme.label;
      modeEl.style.background = theme.bg;
      modeEl.style.color = theme.fg;

      holdEl.textContent = `HOLD: ${state.autoHold ? 'ON' : 'OFF'}`;
      holdEl.style.background = state.autoHold ? '#2ea043' : '#313244';
      holdEl.style.color = state.autoHold ? '#fff' : '#a6adc8';

      noiseEl.textContent = `NOISE: ${state.noiseMode === 'MUTED_SYNC' ? 'SYNC' : 'FX'}`;

      if (state.chordDef) {
        const [qual, root, bass] = state.chordDef;
        const rName = noteNames[(root + state.transpose + 120) % 12];
        const bName = noteNames[(bass + state.transpose + 120) % 12];
        chordEl.textContent = `CHORD: ${rName} ${qual}${root === bass ? '' : `/${bName}`}`;
      } else {
        chordEl.textContent = 'CHORD: --';
      }
    },
	
  });

  function pollGuitar() {
    if (!guitarEnabled) return;
    const pads = navigator.getGamepads();
    let pad = guitarIndex !== null ? pads[guitarIndex] : null;
    if (!pad?.connected || pad.mapping !== 'standard') {
      strummer.gamepad.reset();
      pad = Array.from(pads).find(c => c?.connected && c.mapping === 'standard');
      guitarIndex = pad ? pad.index : null;
      guitarStatus.textContent = pad ? `Guitar: ${pad.id}` : 'Waiting for standard gamepad';
    }
    if (pad) {
      const ctx = getAudio();
      if (ctx && strummer.clock.audioCtx !== ctx) strummer.setAudioContext(ctx);
      strummer.gamepad.update(pad);
    }
    guitarFrame = requestAnimationFrame(pollGuitar);
  }

  guitarBtn.addEventListener('click', () => {
    guitarEnabled = !guitarEnabled;
    if (guitarEnabled) {
      pollGuitar();
    } else {
      cancelAnimationFrame(guitarFrame);
      strummer.stop();
      strummer.gamepad.reset();
      guitarIndex = null;
      guitarStatus.textContent = 'Guitar off';
    }
    guitarBtn.textContent = guitarEnabled ? 'Guitar On' : 'Guitar Off';
    guitarBtn.classList.toggle('active', guitarEnabled);
  });

  return { strummer, isGuitarEnabled: () => guitarEnabled };
}
