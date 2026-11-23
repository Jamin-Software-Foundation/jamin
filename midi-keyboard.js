// midi-keyboard.js
const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CC_MAP = { 21: 'drums', 12: 'drums', 22: 'bass', 13: 'bass', 23: 'chords', 14: 'chords', 24: 'voice1', 16: 'voice1', 25: 'voice2', 17: 'voice2', 26: 'master', 15: 'master' };

export function initMidiAndKeyboard({ getAudio, voices, mixer, mixerState, callbacks, logger }) {
  const activeNotes = new Map();
  let chordTimer = null;

  function updateKeyVisual(note, state) {
    const el = document.getElementById(`note-${note}`);
    if (!el) return;
    el.classList.remove('active-melody', 'active-chord');
    if (state === 'melody' || state === 'chord') el.classList.add(`active-${state}`);
  }

  function analyzeHarmony() {
    if (activeNotes.size < 3 || callbacks.isGuitarEnabled()) return;
    const notes = Array.from(activeNotes.keys()).sort((a, b) => a - b);
    let bestRoot = notes[0], bestType = 'Maj', bestWeight = -1;

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
    callbacks.onChordDetected(bestType, bestRoot % 12, notes[0] % 12);
  }

  function routeMidi(status, note, velocity) {
    const type = status & 0xF0;
    const audio = getAudio();

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
    } else if (type === 240 || (type === 176 && note === 23 && velocity === 127)) {
      callbacks.onTogglePlay();
    } else if (type === 192) {
      callbacks.onProgramChange(note);
    } else if (type === 176 && CC_MAP[note]) {
      const name = CC_MAP[note];
      const val = velocity / 127;
      mixerState[name].volume = val;
      document.querySelector(`#volume-${name}`).value = val * 100;
      document.getElementById(`level-${name}`).textContent = `${Math.round(val * 100)}%`;
      const m = mixer();
      if (m) m[name].gain.setValueAtTime(val, audio.currentTime);
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

  document.getElementById('btn-midi-init').addEventListener('click', async () => {
    if (!navigator.requestMIDIAccess) return logger('Web MIDI not supported in this browser.');
    try {
      const access = await navigator.requestMIDIAccess();
      const connect = () => {
        let count = 0;
        for (const input of access.inputs.values()) {
          if (input.state === 'connected') {
            input.onmidimessage = e => routeMidi(...e.data);
            count++;
          }
        }
        const badge = document.getElementById('midi-status');
        badge.innerText = count ? `${count} MIDI input${count === 1 ? '' : 's'} connected` : 'Virtual keyboard';
        badge.style.background = count ? '#00e676' : '#ffb300';
        badge.style.color = '#000';
        document.getElementById('btn-midi-init').classList.add('active');
      };
      access.onstatechange = () => { activeNotes.clear(); connect(); };
      connect();
    } catch (err) { logger(`MIDI init failed: ${err.message}`); }
  });
}
