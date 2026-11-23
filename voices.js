// voices.js
import { WorkletSynthesizer } from './spessasynth/spessasynth_lib.js';
import { MIDIUtils } from 'spessasynth_core';
import { createSf2Scanner } from './sf2-bank-scanner.js';

export function createVoices(getAudio, getMixer, log) {
  const voices = [0, 1].map(() => ({
    synth: null, request: 0, queue: Promise.resolve(), file: null, patch: null, channel: 0,
    octave: 0, transpose: 0, effect: '0', lowFrequency: '0', lowGain: '0',
    highFrequency: '0', highGain: '0', mode: null, notes: new Map()
  }));
  let selected = 0;
  let modulePromise;
  const $ = id => document.getElementById(id);
  const status = text => { $('status').textContent = text; };

  const settings = $('voice-controls');
  settings.innerHTML = `<label for="voice-octave">Keyboard octave</label><select id="voice-octave"></select>
    <label for="voice-transpose">Transpose (semitones)</label><select id="voice-transpose"></select>`;
  for (let i = -2; i <= 2; i++) $('voice-octave').add(new Option(i > 0 ? `+${i}` : i, i));
  for (let i = -12; i <= 12; i++) $('voice-transpose').add(new Option(i > 0 ? `+${i}` : i, i));

  const fields = {
    'voice-octave': 'octave', 'voice-transpose': 'transpose', 'effect-type': 'effect',
    'eq-low-frequency': 'lowFrequency', 'eq-low-gain': 'lowGain',
    'eq-high-frequency': 'highFrequency', 'eq-high-gain': 'highGain'
  };

  function showSettings() {
    const voice = voices[selected];
    $('selected-voice-label').textContent = `VOICE ${selected + 1}`;
    for (const [id, key] of Object.entries(fields)) $(id).value = voice[key];
    $('select-voice1').classList.toggle('selected', selected === 0);
    $('select-voice2').classList.toggle('selected', selected === 1);
    $('eq-low-output').textContent = `${voice.lowGain} dB`;
    $('eq-high-output').textContent = `${voice.highGain} dB`;
    $('gs-eq').disabled = voice.effect === 'symphonic';
    $('sf2-play-btn').disabled = !voice.synth;
  }

  function applyEffects(voice) {
    const target = voice.synth;
    if (!target) return;
    const xg = voice.effect === 'symphonic';
    const mode = xg ? 'xg' : 'gs';
    if (voice.mode !== mode) {
      target.systemExclusive(xg ? MIDIUtils.xg(0, 0, 126, [0]) : MIDIUtils.gs(64, 0, 127, [0]));
      voice.mode = mode;
    }
    if (xg) {
      target.systemExclusive(MIDIUtils.xg(3, 0, 0, [0x44, 0]));
      target.systemExclusive(MIDIUtils.xg(3, 0, 12, [0]));
    } else {
      const type = Number(voice.effect);
      target.systemExclusive(MIDIUtils.gs(64, 3, 0, [type >> 8, type & 127]));
      target.systemExclusive(MIDIUtils.gs(64, 0x41, 0x22, [type ? 1 : 0]));
      target.systemExclusive(MIDIUtils.gs(64, 0x41, 0x20, [1]));
      [Number(voice.lowFrequency), Number(voice.lowGain) + 64, Number(voice.highFrequency), Number(voice.highGain) + 64]
        .forEach((value, address) => target.systemExclusive(MIDIUtils.gs(64, 2, address, [value])));
    }
    if (voice.patch) {
      const p = voice.patch;
      voice.channel = p.isGMGSDrum ? 9 : 0;
      target.controllerChange(voice.channel, 0, p.bankMSB);
      target.controllerChange(voice.channel, 32, p.bankLSB);
      target.programChange(voice.channel, p.program);
    }
  }

  function release(voice) {
    for (const { note, channel } of voice.notes.values()) voice.synth.noteOff(channel, note);
    voice.notes.clear();
  }

  function load(index, item, patch) {
    const voice = voices[index];
    const request = ++voice.request;
    voice.queue = voice.queue.then(async () => {
      if (request !== voice.request) return;
      status(`Voice ${index + 1}: loading ${item.path}...`);
      let created = null;
      try {
        const audio = getAudio();
        if (!modulePromise) {
          modulePromise = audio.audioWorklet.addModule('./spessasynth/spessasynth_processor.min.js')
            .catch(err => { modulePromise = null; throw err; });
        }
        await modulePromise;
        if (!voice.synth) {
          created = new WorkletSynthesizer(audio, {
            coreUrl: './spessasynth/spessasynth_core.js',
            fflateUrl: './spessasynth/fflate.js',
            stbVorbisUrl: './spessasynth/stb-vorbis.js'
          });
          await created.isReady;
        }
        const target = voice.synth || created;
        if (voice.file !== item) {
          const buffer = item.buffer.slice(0);
          if (request !== voice.request) { if (created) created.destroy(); return; }
          if (voice.synth) release(voice);
          await target.soundBankManager.addSoundBank(buffer, 'selected-soundfont');
          voice.file = item;
        }
        if (created) { created.connect(getMixer()[`voice${index + 1}`]); voice.synth = created; }
        if (request !== voice.request) return;
        release(voice);
        voice.patch = patch;
        voice.mode = null;
        applyEffects(voice);
        $(`voice${index + 1}-name`).textContent = patch.name;
        scanner.render();
        status(`Voice ${index + 1}: ${patch.name} (${item.path})`);
        showSettings();
      } catch (error) {
        if (created && created !== voice.synth) created.destroy();
        status(`Voice ${index + 1} SoundFont error: ${error.message}`);
      }
    });
  }

  const scanner = createSf2Scanner(voices, load, log);

  for (const [id, key] of Object.entries(fields)) {
    $(id).addEventListener('input', () => {
      const voice = voices[selected];
      voice[key] = key === 'octave' || key === 'transpose' ? Number($(id).value) : $(id).value;
      if (key !== 'octave' && key !== 'transpose') applyEffects(voice);
      showSettings();
    });
  }
  [0, 1].forEach(idx => $(`select-voice${idx + 1}`).addEventListener('click', () => { selected = idx; showSettings(); }));

  $('sf2-input').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const item = scanner.makeItem(await file.arrayBuffer(), file.name);
      scanner.render([item]);
      if (item.patches.length) load(selected, item, item.patches[0]);
    } catch (error) { status(`SoundFont error: ${error.message}`); }
  });

  $('sf2-play-btn').addEventListener('click', async () => {
    const voice = voices[selected];
    if (!voice.synth) return;
    const audio = getAudio();
    if (audio.state === 'suspended') await audio.resume();
    voice.synth.noteOn(voice.channel, 60, 100);
    setTimeout(() => voice.synth.noteOff(voice.channel, 60), 1000);
  });

  showSettings();
  return {
    scan: scanner.scan,
    cancelScan: scanner.cancelScan,
    getState: () => ({
      selected,
      voices: voices.map(v => ({
        soundFont: v.file?.path || null,
        patch: v.patch ? { key: v.patch.key, name: v.patch.name } : null,
        octave: v.octave, transpose: v.transpose, effect: v.effect,
        lowFrequency: v.lowFrequency, lowGain: v.lowGain, highFrequency: v.highFrequency, highGain: v.highGain
      }))
    }),
    transposeBoth(step) {
      if (voices.some(v => v.transpose + step < -12 || v.transpose + step > 12)) return false;
      voices.forEach(v => { v.transpose += step; });
      showSettings();
      return true;
    },
    setState(state) {
      const missing = [];
      state.voices.forEach((saved, index) => {
        const voice = voices[index];
        ['octave', 'transpose', 'effect', 'lowFrequency', 'lowGain', 'highFrequency', 'highGain'].forEach(k => {
          if (saved[k] !== undefined) voice[k] = saved[k];
        });
        applyEffects(voice);
        if (!saved.soundFont) return;
        const item = scanner.getLastItems().find(c => c.path === saved.soundFont);
        const patch = item?.patches.find(c => c.key === saved.patch?.key && c.name === saved.patch?.name);
        if (patch) load(index, item, patch);
        else missing.push(`Voice ${index + 1}: ${saved.soundFont}`);
      });
      selected = state.selected === 1 ? 1 : 0;
      showSettings();
      return missing;
    },
    noteOn(note, velocity) {
      for (const voice of voices) {
        if (!voice.synth || !voice.patch) continue;
        const pitch = note + voice.octave * 12 + voice.transpose;
        if (pitch < 0 || pitch > 127) continue;
        if (voice.notes.has(note)) voice.synth.noteOff(voice.notes.get(note).channel, voice.notes.get(note).note);
        voice.synth.noteOn(voice.channel, pitch, velocity);
        voice.notes.set(note, { note: pitch, channel: voice.channel });
      }
    },
    noteOff(note) {
      for (const voice of voices) {
        const played = voice.notes.get(note);
        if (!played) continue;
        voice.synth.noteOff(played.channel, played.note);
        voice.notes.delete(note);
      }
    },
    noteOnVoice(index, note, velocity) {
      const voice = voices[index];
      if (!voice?.synth || !voice.patch) return;
      const pitch = note + voice.octave * 12 + voice.transpose;
      if (pitch >= 0 && pitch <= 127) voice.synth.noteOn(voice.channel, pitch, velocity);
    },
    noteOffVoice(index, note) {
      const voice = voices[index];
      if (!voice?.synth || !voice.patch) return;
      const pitch = note + voice.octave * 12 + voice.transpose;
      if (pitch >= 0 && pitch <= 127) voice.synth.noteOff(voice.channel, pitch);
    }
  };
}
