import { createGuitarRig } from './guitar-rig-ui.js';
import { readAudioAsset, getImportedIrPaths } from './imported-assets.js';
import { createRegistrationManager } from './registrations.js';

export function initRigBridge({
  getAudio, ensureMixer, getRootDir, initializeAssets, voices, mixerState, mixerUpdaters,
  arranger, strummer, isGuitarEnabled, strumSeqBrowser, styleGroups,
  getSelectedStyle, selectStyle, keyInput, tempoInput, noteNames, syncKeyToVoices, logger
}) {
  const rig = createGuitarRig(getAudio, ensureMixer, async (irPath) => {
    const fileName = irPath.split('/').pop();
    const dir = getRootDir()?.list?.['assets']?.list?.['USER_IR'] || getRootDir()?.list?.['USER_IR'];
    const entry = dir?.list?.[fileName] || { path: irPath, imported: !irPath.startsWith('assets/') };
    const buffer = await readAudioAsset(entry, getAudio());
    rig.getCabinet().setAudioBuffer(buffer, irPath);
  });

  function syncMode() {
    const midiActive = document.getElementById('btn-midi-init')?.classList.contains('active');
    rig.setActive(isGuitarEnabled() && !midiActive);
  }

  ['btn-guitar', 'btn-midi-init'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => setTimeout(syncMode, 0));
  });

  function extractManifestIRs(json) {
    const dir = json.list?.['assets']?.list?.['USER_IR'] || json.list?.['USER_IR'];
    return (dir?.children || []).filter(c => c.type === 'file').map(c => c.path);
  }

  async function scanManifestIRs(json) {
    const builtIn = extractManifestIRs(json);
    const imported = await getImportedIrPaths();
    rig.populateIrList([...new Set([...builtIn, ...imported])]);
  }

  // Auto-populate IR dropdown on startup from manifest.json + IndexedDB
  (async () => {
    try {
      const res = await fetch('./manifest.json');
      const json = res.ok ? await res.json() : { list: {} };
      await scanManifestIRs(json);
    } catch (_) {
      rig.populateIrList(await getImportedIrPaths());
    }
  })();

  const regs = createRegistrationManager({
    voices, mixerState, mixerUpdaters, logger,
    getState: () => ({
      selectedStyleInfo: getSelectedStyle(),
      key: keyInput.value,
      tempoShift: Number(tempoInput.value),
      ...arranger.getState(),
      guitar: {
        strumSeqPath: strumSeqBrowser.getSelectedPath(),
        playMode: strummer.playMode,
        autoStrum: strummer.autoStrum,
        autoHold: strummer.autoHold,
        noiseMode: strummer.voice.noiseMode,
        rig: rig.getState()
      }
    }),
    applyState: async (reg, n, missing) => {
      if (noteNames.includes(reg.performance.key)) keyInput.value = reg.performance.key;
      syncKeyToVoices();
      tempoInput.value = reg.performance.tempoShift || 0;
      arranger.applyState(reg.performance);
      if (reg.style) {
        if (styleGroups.size === 0 && initializeAssets) await initializeAssets();
        let entry = styleGroups.get(reg.style.path)?.find(c => c.name === reg.style.name);
        if (!entry) {
          for (const entries of styleGroups.values()) {
            entry = entries.find(c => c.name === reg.style.name);
            if (entry) break;
          }
        }
        if (entry) await selectStyle(entry, reg.style.path);
        else missing.push(`Style: ${reg.style.name}`);
      }
      if (reg.guitar) {
        strummer.playMode = reg.guitar.playMode || 'STRUMSEQ';
        strummer.autoStrum = reg.guitar.autoStrum !== undefined ? Boolean(reg.guitar.autoStrum) : true;
        strummer.autoHold = Boolean(reg.guitar.autoHold);
        strummer.voice.noiseMode = reg.guitar.noiseMode || 'MUTED_SYNC';
        if (reg.guitar.strumSeqPath && !strumSeqBrowser.selectByPath(reg.guitar.strumSeqPath)) {
          missing.push(`StrumSeq: ${reg.guitar.strumSeqPath}`);
        }
        if (reg.guitar.rig) await rig.setState(reg.guitar.rig);
        strummer.syncModeReverb?.();
        strummer.syncClock();
        strummer.emitState();
      }
      syncMode();
      logger(`Registration ${n} recalled.${missing.length ? ` Missing: ${missing.join(', ')}` : ''}`);
    }
  });

  return { attachVoice1Synth: rig.attachVoice1Synth, scanManifestIRs, syncTempo: rig.syncTempo, regs };
   
}
