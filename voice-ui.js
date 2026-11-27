import { MIDIUtils } from 'spessasynth_core';

export const VOICE_FIELDS = {
  'voice-octave': 'octave',
  'voice-transpose': 'transpose',
  'voice-reverb': 'reverb',
  'effect-type': 'effect',
  'eq-low-frequency': 'lowFrequency',
  'eq-low-gain': 'lowGain',
  'eq-high-frequency': 'highFrequency',
  'eq-high-gain': 'highGain'
};

export function initVoiceSettingsUI() {
  const settings = document.getElementById('voice-controls');
  settings.innerHTML = `<label for="voice-octave">Keyboard octave</label><select id="voice-octave"></select>
    <label for="voice-transpose">Transpose (semitones)</label><select id="voice-transpose"></select>
    <label for="voice-reverb">Synth reverb <span id="voice-reverb-val">8</span></label>
    <input id="voice-reverb" type="range" min="0" max="127" value="8" />`;

  for (let i = -2; i <= 2; i++) {
    let label = String(i);
    if (i > 0) label = `+${i}`;
    document.getElementById('voice-octave').add(new Option(label, i));
  }
  for (let i = -12; i <= 12; i++) {
    let label = String(i);
    if (i > 0) label = `+${i}`;
    document.getElementById('voice-transpose').add(new Option(label, i));
  }
}

export function renderVoiceSettings(voices, selected) {
  const $ = id => document.getElementById(id);
  const voice = voices[selected];
  $('selected-voice-label').textContent = `VOICE ${selected + 1}`;
  for (const [id, key] of Object.entries(VOICE_FIELDS)) $(id).value = voice[key];
  $('voice-reverb-val').textContent = voice.reverb;
  $('select-voice1').classList.toggle('selected', selected === 0);
  $('select-voice2').classList.toggle('selected', selected === 1);
  $('eq-low-output').textContent = `${voice.lowGain} dB`;
  $('eq-high-output').textContent = `${voice.highGain} dB`;
  $('gs-eq').disabled = voice.effect === 'symphonic';
  $('sf2-play-btn').disabled = !voice.synth;
}

export function applyVoiceEffects(voice, isVoice1) {
  const target = voice.synth;
  if (!target) return;
  const xg = voice.effect === 'symphonic';
  let mode = 'gs';
  if (xg) mode = 'xg';

  if (voice.mode !== mode) {
    if (xg) target.systemExclusive(MIDIUtils.xg(0, 0, 126, Array.of(0)));
    else target.systemExclusive(MIDIUtils.gs(64, 0, 127, Array.of(0)));
    voice.mode = mode;
  }

  if (xg) {
    target.systemExclusive(MIDIUtils.xg(3, 0, 0, Array.of(0x44, 0)));
    target.systemExclusive(MIDIUtils.xg(3, 0, 12, Array.of(0)));
  } else {
    const type = Number(voice.effect);
    const msb = Math.floor(type / 256);
    const lsb = type % 128;
    const activeFlag = type ? 1 : 0;
    target.systemExclusive(MIDIUtils.gs(64, 3, 0, Array.of(msb, lsb)));
    target.systemExclusive(MIDIUtils.gs(64, 0x41, 0x22, Array.of(activeFlag)));
    target.systemExclusive(MIDIUtils.gs(64, 0x41, 0x20, Array.of(1)));
    Array.of(Number(voice.lowFrequency), Number(voice.lowGain) + 64, Number(voice.highFrequency), Number(voice.highGain) + 64)
      .forEach((val, addr) => target.systemExclusive(MIDIUtils.gs(64, 2, addr, Array.of(val))));
  }

  if (voice.patch) {
    const p = voice.patch;
    voice.channel = p.isGMGSDrum ? 9 : 0;
    target.controllerChange(voice.channel, 0, p.bankMSB);
    target.controllerChange(voice.channel, 32, p.bankLSB);
    target.programChange(voice.channel, p.program);
    target.controllerChange(voice.channel, 7, 127);
    target.controllerChange(voice.channel, 11, 127);
    target.controllerChange(voice.channel, 91, voice.reverb);
    target.controllerChange(voice.channel, 93, 0);
    if (!xg) {
      const revMacro = isVoice1 ? 25 : 64;
      target.systemExclusive(MIDIUtils.gs(64, 1, 0x33, Array.of(revMacro)));
    }
  }
}
