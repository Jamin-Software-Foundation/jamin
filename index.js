// index.js
import { createVoices } from './voices.js';
import { importAssets, mergeImportedAssets, readAsset } from './imported-assets.js';
import { createStrumSeqBrowser } from './strumseq-browser.js';
import { scanStyleFolderDeep, parseAndLoadKst } from './kshp-loader.js';
import { initMidiAndKeyboard } from './midi-keyboard.js';
import { createRegistrationManager } from './registrations.js';
import { createArrangerPlayer } from './arranger-player.js';
import { createCrkdBridge } from './crkd-bridge.js';

let audioCtx = null, mixer = null, rootDirJson = null, selectedStyleInfo = null, regs = null;
let styleGroups = new Map();
const styleView = { open: null }, noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const mixerState = Object.fromEntries(['drums', 'bass', 'chords', 'voice1', 'voice2', 'master'].map(n => [n, { volume: 1, muted: false }]));
const getAudio = () => (audioCtx ||= new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }));

function ensureMixer() {
  if (mixer) return mixer; getAudio(); mixer = {};
  for (const n of Object.keys(mixerState)) { mixer[n] = audioCtx.createGain(); mixer[n].gain.value = mixerState[n].muted ? 0 : mixerState[n].volume; }
  mixer.master.connect(audioCtx.destination);
  for (const n of ['drums', 'bass', 'chords', 'voice1', 'voice2']) mixer[n].connect(mixer.master);
  return mixer;
}

const mixerUpdaters = {};
for (const n of Object.keys(mixerState)) {
  const slider = document.getElementById(`volume-${n}`), mute = document.getElementById(`mute-${n}`);
  const update = () => { document.getElementById(`level-${n}`).textContent = `${Math.round(mixerState[n].volume * 100)}%`; mute.setAttribute('aria-pressed', String(mixerState[n].muted)); if (mixer) mixer[n].gain.setValueAtTime(mixerState[n].muted ? 0 : mixerState[n].volume, audioCtx.currentTime); };
  mixerUpdaters[n] = () => { slider.value = Math.round(mixerState[n].volume * 100); update(); };
  slider.addEventListener('input', () => { mixerState[n].volume = Number(slider.value) / 100; update(); });
  mute.addEventListener('click', () => { mixerState[n].muted = !mixerState[n].muted; update(); });
}

function logger(msg) {
  const win = document.getElementById('log-window'), line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`; win.appendChild(line); win.scrollTop = win.scrollHeight;
  document.getElementById('engine-status').textContent = msg;
}

const voices = createVoices(getAudio, ensureMixer, logger);
const tempoInput = document.getElementById('ctrl-tempo'), keyInput = document.getElementById('ctrl-key');

// Proxy holder so arranger & crkdBridge can reference each other cleanly
const bridgeRef = { strummer: null };
const arranger = createArrangerPlayer({ getAudio, ensureMixer, strummer: { clock: { set bpm(v) { if (bridgeRef.strummer) bridgeRef.strummer.clock.bpm = v; } }, syncBarStart: t => bridgeRef.strummer?.syncBarStart(t), stop: () => bridgeRef.strummer?.stop() }, logger });
const { strummer, isGuitarEnabled } = createCrkdBridge({ getAudio, voices, arranger, mixerState, mixerUpdaters, getRegs: () => regs, logger });
bridgeRef.strummer = strummer;

const strumSeqBrowser = createStrumSeqBrowser('strumseq-browser', 'strumseq-status', xml => strummer.loadStrumSeqXML(xml, true), logger);

async function initializeAssets() {
  const json = await (await fetch('./manifest.json')).json();
  await mergeImportedAssets(json);
  if (arranger.getState().isPlaying) arranger.stopImmediate();
  rootDirJson = json; voices.cancelScan(); styleGroups = new Map(); styleView.open = null;
  if (json.list['USER_STYLE']) await scanStyleFolderDeep(json.list['USER_STYLE'], styleGroups);
  renderStyles(); await voices.scan(json.list['VOICES']); await strumSeqBrowser.scan(json);
  document.getElementById('btn-link-dir').textContent = 'ON'; document.getElementById('btn-link-dir').classList.add('active');
  document.getElementById('btn-scan-sf2').disabled = false; logger('Assets ready.');
}

function renderStyles() {
  const groups = [...styleGroups].sort((a, b) => a.at(0).localeCompare(b.at(0))).map(([name, entries]) => ({
    name, items: entries.map(entry => ({ label: entry.name, selected: selectedStyleInfo?.handle === entry, onClick: () => selectStyle(entry, name) }))
  }));
  window.renderTwoLevel(document.getElementById('kst-items'), styleView, groups, 'No KST styles found.');
}

async function selectStyle(entry, genre) {
  if (arranger.getState().isPlaying) arranger.stopImmediate();
  selectedStyleInfo = { handle: entry, path: genre, name: entry.name };
  document.getElementById('style-name').textContent = entry.name.replace(/\.kst$/i, ''); document.getElementById('style-category').textContent = genre; renderStyles();
  const loaded = await parseAndLoadKst(await readAsset(entry), rootDirJson, getAudio(), logger);
  arranger.setStyleData(loaded.tempo, loaded.loopAudioBuffers);
  document.getElementById('btn-play').disabled = false; document.getElementById('btn-play').style.background = '#ff3d00';
}

document.getElementById('btn-link-dir').addEventListener('click', initializeAssets);
document.getElementById('btn-scan-sf2').addEventListener('click', () => rootDirJson && voices.scan(rootDirJson.list['VOICES']));
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-input').click());
document.getElementById('import-input').addEventListener('change', async e => { if (e.target.files) { await importAssets(e.target.files, getAudio(), () => {}); if (rootDirJson) await initializeAssets(); } });
document.querySelectorAll('.intro-choice').forEach(b => b.addEventListener('click', () => { arranger.setIntroEnding(Number(b.dataset.intro)); document.querySelectorAll('.intro-choice').forEach(c => c.setAttribute('aria-pressed', String(c === b))); }));
tempoInput.addEventListener('input', e => { const s = arranger.getState(); document.getElementById('style-tempo').textContent = `${Math.ceil(s.tempo * Math.pow(2, e.target.value / 12))} BPM`; if (s.isPlaying) arranger.restart(); });
keyInput.addEventListener('change', () => { if (arranger.getState().isPlaying) arranger.restart(); });
document.getElementById('btn-play').addEventListener('click', arranger.toggleStartEnd);
document.getElementById('btn-stop').addEventListener('click', arranger.stopImmediate);
document.getElementById('btn-solo').addEventListener('click', () => document.getElementById('btn-solo').classList.toggle('active', arranger.toggleSolo()));

window.setVariation = arranger.setVariation; window.setVariationLetter = arranger.setVarLetter; window.toggleAltVariation = arranger.toggleAlt;
window.playFillX = () => arranger.playFill(Math.max(0, arranger.getState().currentVariation)); window.playBreakX = arranger.playBreak;

initMidiAndKeyboard({ getAudio, voices, mixer: () => mixer, mixerState, logger, callbacks: { isGuitarEnabled, onTogglePlay: arranger.toggleStartEnd, onChordDetected: arranger.changeChord, onProgramChange: n => arranger.getState().isPlaying && n < 8 && arranger.setVariation(n) } });

regs = createRegistrationManager({
  voices, mixerState, mixerUpdaters, logger,
  getState: () => ({ selectedStyleInfo, key: keyInput.value, tempoShift: Number(tempoInput.value), ...arranger.getState(), guitar: { strumSeqPath: strumSeqBrowser.getSelectedPath(), playMode: strummer.playMode, autoHold: strummer.autoHold, noiseMode: strummer.voice.noiseMode } }),
  applyState: async (reg, n, missing) => {
    if (noteNames.includes(reg.performance.key)) keyInput.value = reg.performance.key;
    tempoInput.value = reg.performance.tempoShift || 0; arranger.applyState(reg.performance);
    if (reg.style) { const entry = styleGroups.get(reg.style.path)?.find(c => c.name === reg.style.name); if (entry && selectedStyleInfo?.handle !== entry) await selectStyle(entry, reg.style.path); }
    if (reg.guitar) {
      strummer.playMode = reg.guitar.playMode || 'STRUMSEQ'; strummer.autoHold = Boolean(reg.guitar.autoHold); strummer.voice.noiseMode = reg.guitar.noiseMode || 'MUTED_SYNC';
      if (reg.guitar.strumSeqPath && !strumSeqBrowser.selectByPath(reg.guitar.strumSeqPath)) missing.push(`StrumSeq: ${reg.guitar.strumSeqPath}`);
      strummer.syncClock(); strummer.emitState();
    }
    logger(`Registration ${n} recalled.${missing.length ? ` Missing: ${missing.join(', ')}` : ''}`);
  }
});
