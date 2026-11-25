// midi-keyboard.js
const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LAUNCHKEY_CC = { 21: 'drums', 22: 'bass', 23: 'chords', 24: 'voice1', 25: 'voice2', 26: 'master' };
const GENERIC_CC = { 12: 'drums', 13: 'bass', 14: 'chords', 16: 'voice1', 17: 'voice2', 15: 'master', ...LAUNCHKEY_CC };
const VOICE_GAIN_BOOST = 2.8;

export function initMidiAndKeyboard({ getAudio, voices, mixer, mixerState, callbacks, logger }) {
  const activeNotes = new Map();
  let chordTimer = null;
  let selectedDeviceId = 'all';

  function updateKeyVisual(note, state) {
    const el = document.getElementById(`note-${note}`);
    if (!el) return;
    el.classList.remove('active-melody', 'active-chord');
    if (state === 'melody' || state === 'chord') el.classList.add(`active-${state}`);
  }

  function analyzeHarmony() {
    if (activeNotes.size < 3 || callbacks.isGuitarEnabled()) return;
    const notes = Array.from(activeNotes.keys()).sort((a, b) => a - b);
    let bestRoot = notes.at(0), bestType = 'Maj', bestWeight = -1;

    const chords = [
      { type: 'Maj', mask: (1 << 0) | (1 << 4) | (1 << 7), weight: 3 },
      { type: 'Min', mask: (1 << 0) | (1 << 3) | (1 << 7), weight: 3 },
      { type: 'Sus2', mask: (1 << 0) | (1 << 2) | (1 << 7), weight: 3 },
      { type: 'Sus4', mask: (1 << 0) | (1 << 5) | (1 << 7), weight: 3 },
      { type: '7th', mask: (1 << 0) | (1 << 4) | (1 << 7) | (1 << 10), weight: 4 },
      { type: '7th', mask: (1 << 0) | (1 << 4) | (1 << 10), weight: 2.5 },
      { type: 'Min7', mask: (1 << 0) | (1 << 3) | (1 << 7) | (1 << 10), weight: 4 }
    ];

    for (const candidate of notes) {
      const bitmask = notes.reduce((m, n) => m | (1 << ((n - candidate + 120) % 12)), 0);
      for (const c of chords) {
        if ((bitmask & c.mask) === c.mask && c.weight > bestWeight) {
          bestWeight = c.weight; bestRoot = candidate; bestType = c.type;
        }
      }
    }
    if (bestWeight < 0) return;
    notes.forEach(n => updateKeyVisual(n, 'chord'));
    callbacks.onChordDetected(bestType, bestRoot % 12, notes.at(0) % 12);
  }

  function setMixerLevel(name, velocity, audio) {
    const val = velocity / 127;
    mixerState[name].volume = val;
    document.querySelector(`#volume-${name}`).value = val * 100;
    document.getElementById(`level-${name}`).textContent = `${Math.round(val * 100)}%`;
    const m = mixer();
    if (m) {
      const boost = (name === 'voice1' || name === 'voice2') ? VOICE_GAIN_BOOST : 1;
      m[name].gain.setValueAtTime(mixerState[name].muted ? 0 : val * boost, audio.currentTime);
    }
  }

  function routeMidi(status, note, velocity, deviceName = '') {
    const type = status & 0xF0;
    const audio = getAudio();
    const dev = deviceName.toLowerCase();
    const isLaunchkey = dev.includes('launchkey');
    const isIRig = dev.includes('irig');

    if (type === 144 && velocity > 0) {
      if (audio?.state === 'suspended') audio.resume();
      activeNotes.set(note, performance.now());
      updateKeyVisual(note, 'melody');
      voices.noteOn(note, velocity);
      clearTimeout(chordTimer);
      chordTimer = setTimeout(analyzeHarmony, 15);
    } else if (type === 128 || (type === 144 && velocity === 0)) {
      activeNotes.delete(note);
      updateKeyVisual(note, 'off');
      voices.noteOff(note);
    } else if (type === 240) {
      callbacks.onTogglePlay();
    } else if (type === 192) {
      callbacks.onProgramChange(note);
    } else if (type === 176) {
      // iRig Keys 2 Pro: CC 23 press = Start/Stop; ignore CC 22 data wheel so Bass volume isn't moved
      if (isIRig) {
        if (note === 23 && velocity === 127) callbacks.onTogglePlay();
        return;
      }
      // Novation Launchkey: CC 21-26 = Mixer faders (and never treat CC 23 as Start/Stop)
      if (isLaunchkey) {
        if (LAUNCHKEY_CC[note]) setMixerLevel(LAUNCHKEY_CC[note], velocity, audio);
        return;
      }
      // Generic / Virtual / Other MIDI controllers
      if (note === 23 && velocity === 127) return callbacks.onTogglePlay();
      if (GENERIC_CC[note]) setMixerLevel(GENERIC_CC[note], velocity, audio);
    }
  }

  const kbd = document.getElementById('virtual-keyboard');
  kbd.innerHTML = '';
  for (let n = 48; n <= 84; n++) {
    const name = noteNames[n % 12];
    const div = document.createElement('div');
    div.id = `note-${n}`;
    div.className = name.includes('#') ? 'key black' : 'key';
    div.innerText = `${name}${Math.floor(n / 12) - 1}`;
    div.onpointerdown = e => { div.setPointerCapture(e.pointerId); routeMidi(144, n, 100); };
    div.onpointerup = div.onpointercancel = () => routeMidi(128, n, 0);
    kbd.appendChild(div);
  }

  const midiSelect = document.getElementById('midi-input-select');
  if (midiSelect) {
    midiSelect.addEventListener('change', () => {
      selectedDeviceId = midiSelect.value;
      for (const note of activeNotes.keys()) {
        voices.noteOff(note);
        updateKeyVisual(note, 'off');
      }
      activeNotes.clear();
      const label = midiSelect.options[midiSelect.selectedIndex]?.textContent || selectedDeviceId;
      logger(`MIDI input target: ${label}`);
    });
  }

  document.getElementById('btn-midi-init').addEventListener('click', async () => {
    if (!navigator.requestMIDIAccess) return logger('Web MIDI not supported in this browser.');
    try {
      const access = await navigator.requestMIDIAccess();
      const connect = () => {
        const connectedInputs = [];
        for (const input of access.inputs.values()) {
          if (input.state === 'connected') {
            connectedInputs.push(input);
            input.onmidimessage = e => {
              if (selectedDeviceId === 'all' || selectedDeviceId === input.id) {
                routeMidi(e.data.at(0), e.data.at(1), e.data.at(2), input.name || '');
              }
            };
          }
        }

        if (midiSelect) {
          midiSelect.replaceChildren(new Option('MIDI Input: ALL', 'all'));
          for (const input of connectedInputs) {
            midiSelect.add(new Option(input.name || `MIDI Device (${input.id})`, input.id));
          }
          const stillExists = connectedInputs.some(i => i.id === selectedDeviceId);
          selectedDeviceId = stillExists ? selectedDeviceId : 'all';
          midiSelect.value = selectedDeviceId;
        }

        const count = connectedInputs.length;
        const badge = document.getElementById('midi-status');
        badge.innerText = count ? `${count} MIDI input${count === 1 ? '' : 's'} connected` : 'Virtual keyboard';
        badge.style.background = count ? '#00e676' : '#ffb300';
        badge.style.color = '#000';
        document.getElementById('btn-midi-init').classList.add('active');
      };

      access.onstatechange = () => {
        for (const note of activeNotes.keys()) {
          voices.noteOff(note);
          updateKeyVisual(note, 'off');
        }
        activeNotes.clear();
        connect();
      };
      connect();
    } catch (err) { logger(`MIDI init failed: ${err.message}`); }
  });
}
