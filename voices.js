import { WorkletSynthesizer } from './spessasynth/spessasynth_lib.js';
import { createSf2Scanner } from './sf2-bank-scanner.js';
import { VOICE_FIELDS, initVoiceSettingsUI, renderVoiceSettings, applyVoiceEffects } from './voice-ui.js';

export function createVoices(getAudio, getMixer, log, onVoice1Created = null) {
  const voices = Array.of(0, 1).map((idx) => ({
    synth: null, request: 0, queue: Promise.resolve(), file: null, patch: null, channel: 0,
    octave: 0, transpose: 0, reverb: idx === 0 ? 8 : 55, effect: '0',
    lowFrequency: '0', lowGain: '0', highFrequency: '0', highGain: '0', mode: null, notes: new Map()
  }));
  let selected = 0, modulePromise = null;
  const $ = id => document.getElementById(id);
  const status = text => { $('status').textContent = text; };
  const showSettings = () => renderVoiceSettings(voices, selected);

  initVoiceSettingsUI();

  function release(voice) {
    for (const { note, channel } of voice.notes.values()) voice.synth.noteOff(channel, note);
    voice.notes.clear();
  }

  function load(index, item, patch) {
    const voice = voices[index], request = ++voice.request;
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
            coreUrl: './spessasynth/spessasynth_core.js', fflateUrl: './spessasynth/fflate.js', stbVorbisUrl: './spessasynth/stb-vorbis.js'
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
        if (created) {
          created.connect(getMixer()[`voice${index + 1}`]);
          voice.synth = created;
          if (index === 0 && onVoice1Created) onVoice1Created(created);
        }
        if (request !== voice.request) return;
        release(voice);
        voice.patch = patch; voice.mode = null;
        applyVoiceEffects(voice, index === 0);
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

  for (const [id, key] of Object.entries(VOICE_FIELDS)) {
    $(id).addEventListener('input', () => {
      const voice = voices[selected];
      voice[key] = (key === 'octave' || key === 'transpose' || key === 'reverb') ? Number($(id).value) : $(id).value;
      if (key === 'reverb' && voice.synth) voice.synth.controllerChange(voice.channel, 91, voice.reverb);
      else if (key !== 'octave' && key !== 'transpose') applyVoiceEffects(voice, selected === 0);
      showSettings();
    });
  }
  Array.of(0, 1).forEach(idx => $(`select-voice${idx + 1}`).addEventListener('click', () => { selected = idx; showSettings(); }));

  $('sf2-input').addEventListener('change', async event => {
    const file = event.target.files?.at(0);
    if (!file) return;
    try {
      const item = scanner.makeItem(await file.arrayBuffer(), file.name);
      scanner.render(Array.of(item));
      if (item.patches.length) load(selected, item, item.patches.at(0));
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
    scan: scanner.scan, cancelScan: scanner.cancelScan,
    getState: () => ({
      selected,
      voices: voices.map(v => ({
        soundFont: v.file?.path || null, patch: v.patch ? { key: v.patch.key, name: v.patch.name } : null,
        octave: v.octave, transpose: v.transpose, reverb: v.reverb, effect: v.effect,
        lowFrequency: v.lowFrequency, lowGain: v.lowGain, highFrequency: v.highFrequency, highGain: v.highGain
      }))
    }),
    transposeBoth(step) {
      if (voices.some(v => v.transpose + step < -12 || v.transpose + step > 12)) return false;
      voices.forEach(v => { v.transpose += step; }); showSettings(); return true;
    },
    setTransposeBoth(semitones) {
      const clamped = Math.max(-12, Math.min(12, semitones));
      voices.forEach(v => { v.transpose = clamped; }); showSettings();
    },
    setState(state) {
      const missing = [];
      state.voices.forEach((saved, index) => {
        const voice = voices[index];
        ['octave', 'transpose', 'reverb', 'effect', 'lowFrequency', 'lowGain', 'highFrequency', 'highGain'].forEach(k => {
          if (saved[k] !== undefined) voice[k] = saved[k];
        });
        applyVoiceEffects(voice, index === 0);
        if (!saved.soundFont) return;
        const item = scanner.getLastItems().find(c => c.path === saved.soundFont);
        const patch = item?.patches.find(c => c.key === saved.patch?.key && c.name === saved.patch?.name);
        if (patch) load(index, item, patch);
        else missing.push(`Voice ${index + 1}: ${saved.soundFont}`);
      });
      selected = state.selected === 1 ? 1 : 0; showSettings(); return missing;
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
        voice.synth.noteOff(played.channel, played.note); voice.notes.delete(note);
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
    },
    setVoiceReverb(index, amount) {
      const voice = voices.at(index);
      if (!voice) return;
      voice.reverb = Math.max(0, Math.min(127, Math.round(amount)));
      if (voice.synth) voice.synth.controllerChange(voice.channel, 91, voice.reverb);
      if (selected === index) showSettings();
    }
  };
}
