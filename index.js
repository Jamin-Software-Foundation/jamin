import { createVoices } from './voices.js';
import { importAssets, mergeImportedAssets, readAsset } from './imported-assets.js';
import { createStrumSeqBrowser } from './strumseq-browser.js';
import { scanStyleFolderDeep, parseAndLoadKst } from './kshp-loader.js';
import { initMidiAndKeyboard } from './midi-keyboard.js';
import { createArrangerPlayer } from './arranger-player.js';
import { createCrkdBridge } from './crkd-bridge.js';
import { initNeoUke } from './neouke-ble.js';
import { initRigBridge } from './rig-bridge.js';

let audioCtx = null, mixer = null, rootDirJson = null, selectedStyleInfo = null, rigBridge = null;
let styleGroups = new Map();
const styleView = { open: null }, noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const mixerState = Object.fromEntries(['drums', 'bass', 'chords', 'voice1', 'voice2', 'master'].map(n => [n, { volume: 1, muted: false }]));
const getAudio = () => (audioCtx ||= new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }));
const getChannelGain = (n) => (mixerState[n].muted ? 0 : mixerState[n].volume * (n === 'voice1' || n === 'voice2' ? 2.8 : 1));

function ensureMixer() {
  if (mixer) return mixer; getAudio(); mixer = {};
  for (const n of Object.keys(mixerState)) { mixer[n] = audioCtx.createGain(); mixer[n].gain.value = getChannelGain(n); }
  const limiter = audioCtx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 6; limiter.ratio.value = 12;
  limiter.attack.value = 0.003; limiter.release.value = 0.15;
  mixer.master.connect(limiter); limiter.connect(audioCtx.destination);
  for (const n of ['drums', 'bass', 'chords', 'voice1', 'voice2']) mixer[n].connect(mixer.master);
  return mixer;
}

const mixerUpdaters = {};
for (const n of Object.keys(mixerState)) {
  const slider = document.getElementById(`volume-${n}`), mute = document.getElementById(`mute-${n}`);
  const update = () => {
    document.getElementById(`level-${n}`).textContent = `${Math.round(mixerState[n].volume * 100)}%`;
    mute.setAttribute('aria-pressed', String(mixerState[n].muted));
    if (mixer) mixer[n].gain.setValueAtTime(getChannelGain(n), audioCtx.currentTime);
  };
  mixerUpdaters[n] = () => { slider.value = Math.round(mixerState[n].volume * 100); update(); };
  slider.addEventListener('input', () => { mixerState[n].volume = Number(slider.value) / 100; update(); });
  mute.addEventListener('click', () => { mixerState[n].muted = !mixerState[n].muted; update(); });
}

function logger(msg) {
  const win = document.getElementById('log-window'), line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  win.appendChild(line); win.scrollTop = win.scrollHeight;
  document.getElementById('engine-status').textContent = msg;
}

const voices = createVoices(getAudio, ensureMixer, logger, (s) => rigBridge?.attachVoice1Synth(s));
const tempoInput = document.getElementById('ctrl-tempo'), keyInput = document.getElementById('ctrl-key');
const bridgeRef = { strummer: null };

const arranger = createArrangerPlayer({
  getAudio, ensureMixer, logger,
  strummer: {
    set externalClockLocked(v) { if (bridgeRef.strummer) bridgeRef.strummer.externalClockLocked = v; },
    clock: { get isRunning() { return Boolean(bridgeRef.strummer?.clock.isRunning); }, get barStartTimeSec() { return bridgeRef.strummer?.clock.barStartTimeSec ?? null; }, set bpm(v) { if (bridgeRef.strummer) bridgeRef.strummer.clock.bpm = v; } },
    setVariationIndex: v => bridgeRef.strummer?.setVariationIndex(v), syncBarStart: t => bridgeRef.strummer?.syncBarStart(t), stop: () => bridgeRef.strummer?.stop()
  }
});

const { strummer, isGuitarEnabled } = createCrkdBridge({ getAudio, voices, arranger, mixerState, mixerUpdaters, getRegs: () => rigBridge?.regs, logger });
bridgeRef.strummer = strummer;
const strumSeqBrowser = createStrumSeqBrowser('strumseq-browser', 'strumseq-status', xml => strummer.loadStrumSeqXML(xml, Boolean(selectedStyleInfo)), logger);

async function initializeAssets() {
  const json = await (await fetch('./manifest.json')).json();
  await mergeImportedAssets(json);
  if (arranger.getState().isPlaying) arranger.stopImmediate();
  rootDirJson = json; voices.cancelScan(); styleGroups.clear(); styleView.open = null;

  if (json.list['USER_STYLE']) await scanStyleFolderDeep(json.list['USER_STYLE'], styleGroups);
  renderStyles(); await voices.scan(json.list['VOICES']); await strumSeqBrowser.scan(json); rigBridge.scanManifestIRs(json);
  document.getElementById('btn-link-dir').textContent = 'ON'; document.getElementById('btn-link-dir').classList.add('active');
  document.getElementById('btn-scan-sf2').disabled = false; logger('Assets ready.');
}

function renderStyles() {
  const groups = [...styleGroups].sort((a, b) => a.at(0).localeCompare(b.at(0))).map(([name, entries]) => ({
    name, items: entries.map(entry => ({ label: entry.name, selected: selectedStyleInfo?.handle === entry, onClick: () => selectStyle(entry, name) }))
  }));
  window.renderTwoLevel(document.getElementById('kst-items'), styleView, groups, 'No KST styles found.');
}

let styleLoadToken = 0;

async function selectStyle(entry, genre) {
  const token = ++styleLoadToken;
  if (arranger.getState().isPlaying) arranger.stopImmediate();
  arranger.setStyleData(120, { drums: {}, bass: {}, chords: {} });

  const playBtn = document.getElementById('btn-play');
  playBtn.disabled = true;
  playBtn.style.background = '';

  selectedStyleInfo = { handle: entry, path: genre, name: entry.name };
  document.getElementById('style-name').textContent = entry.name.replace(/\.kst$/i, '');
  document.getElementById('style-category').textContent = genre;
  renderStyles();

  try {
    const statusEl = document.getElementById('engine-status');
    const styleLabel = entry.name.replace(/\.kst$/i, '');
    statusEl.textContent = `Loading ${styleLabel}...`;

    const loaded = await parseAndLoadKst(
      await readAsset(entry),
      rootDirJson,
      getAudio(),
      logger,
      (done, total) => {
        if (token !== styleLoadToken) return;
        const pct = total ? Math.round((done / total) * 100) : 100;
        statusEl.textContent = `Loading ${styleLabel}: ${done}/${total} (${pct}%)`;
      }
    );
    if (token !== styleLoadToken) return;
    arranger.setStyleData(loaded.tempo, loaded.loopAudioBuffers);
    const effectiveBpm = Math.ceil(loaded.tempo * Math.pow(2, Number(tempoInput.value) / 12));
    rigBridge?.syncTempo(effectiveBpm);

    playBtn.disabled = false;
    playBtn.style.background = '#ff3d00';
  } catch (err) {
    if (token === styleLoadToken) logger(`Error loading style: ${err.message}`);
    throw err;
  }

}


function syncKeyToVoices() {
  const idx = noteNames.indexOf(keyInput.value); if (idx < 0) return;
  strummer.voice.stopPadChord(); strummer.voice.muteAllStrings();
  voices.setTransposeBoth?.(idx > 6 ? idx - 12 : idx);
}

document.getElementById('btn-link-dir').addEventListener('click', initializeAssets);
document.getElementById('btn-scan-sf2').addEventListener('click', () => rootDirJson && voices.scan(rootDirJson.list['VOICES']));
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-input').click());

document.getElementById('import-input').addEventListener('change', async e => { if (e.target.files[0]) { await importAssets(e.target.files[0], getAudio(), () => {}); if (rootDirJson) await initializeAssets(); } });

document.querySelectorAll('.intro-choice').forEach(b => b.addEventListener('click', () => { arranger.setIntroEnding(Number(b.dataset.intro)); document.querySelectorAll('.intro-choice').forEach(c => c.setAttribute('aria-pressed', String(c === b))); }));
document.getElementById('btn-play').addEventListener('click', arranger.toggleStartEnd);
document.getElementById('btn-stop').addEventListener('click', arranger.stopImmediate);
document.getElementById('btn-solo').addEventListener('click', () => document.getElementById('btn-solo').classList.toggle('active', arranger.toggleSolo()));
tempoInput.addEventListener('input', e => { 
	const s = arranger.getState(); 
	const bpm = Math.ceil(s.tempo * Math.pow(2, e.target.value / 12)); 
	document.getElementById('style-tempo').textContent = `${bpm} BPM`; 
	strummer.clock.bpm = bpm; 
	rigBridge?.syncTempo(bpm);
	if (s.isPlaying) arranger.restart(); 
});
keyInput.addEventListener('change', () => { syncKeyToVoices(); if (arranger.getState().isPlaying) arranger.restart(); });

window.setVariation = arranger.setVariation; window.setVariationLetter = arranger.setVarLetter; window.toggleAltVariation = arranger.toggleAlt;
window.playFillX = () => arranger.playFill(Math.max(0, arranger.getState().currentVariation)); window.playBreakX = arranger.playBreak;
initMidiAndKeyboard({ getAudio, voices, mixer: () => mixer, mixerState, logger, callbacks: { isGuitarEnabled, onTogglePlay: arranger.toggleStartEnd, onChordDetected: arranger.changeChord, onProgramChange: n => arranger.getState().isPlaying && n < 8 && arranger.setVariation(n) } });

rigBridge = initRigBridge({
  getAudio, ensureMixer, getRootDir: () => rootDirJson, initializeAssets, voices, mixerState, mixerUpdaters,
  arranger, strummer, isGuitarEnabled, strumSeqBrowser, styleGroups,
  getSelectedStyle: () => selectedStyleInfo, selectStyle, keyInput, tempoInput, noteNames, syncKeyToVoices, logger
});
initNeoUke({ arranger, getRegs: () => rigBridge.regs, logger });
