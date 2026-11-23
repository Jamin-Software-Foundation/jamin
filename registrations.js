// registrations.js
export function createRegistrationManager({ getState, applyState, voices, mixerState, mixerUpdaters, logger }) {
  const regSelect = document.getElementById('reg-select');
  let recalling = false;

  function refresh() {
    for (let n = 1; n <= 20; n++) {
      const saved = localStorage.getItem(`jamin-registration-${n}`);
      regSelect.options[n - 1].textContent = `Reg ${n}${saved ? ' ●' : ''}`;
    }
  }

  function save(n) {
    const s = getState();
    const payload = {
      version: 1,
      style: s.selectedStyleInfo ? { path: s.selectedStyleInfo.path, name: s.selectedStyleInfo.name } : null,
      performance: {
        key: s.key, tempoShift: s.tempoShift, autoFill: document.getElementById('auto-fill').checked,
        introEnding: s.introEnding, variation: s.currentVariation % 4, alt: s.altVariation, solo: s.soloActive
      },
      guitar: s.guitar || null,
      mixer: JSON.parse(JSON.stringify(mixerState)),
      voices: voices.getState()
    };
    localStorage.setItem(`jamin-registration-${n}`, JSON.stringify(payload, null, 2));
    logger(`Registration ${n} saved.`);
    refresh();
  }

  async function recall(n) {
    if (recalling) return;
    const text = localStorage.getItem(`jamin-registration-${n}`);
    if (!text) return logger(`Registration ${n} is empty.`);
    recalling = true;
    try {
      const reg = JSON.parse(text);
      for (const name of Object.keys(mixerState)) {
        if (!reg.mixer?.[name]) continue;
        mixerState[name].volume = Math.min(1, Math.max(0, Number(reg.mixer[name].volume) || 0));
        mixerState[name].muted = Boolean(reg.mixer[name].muted);
        mixerUpdaters[name]();
      }
      const missing = voices.setState(reg.voices);
      await applyState(reg, n, missing);
    } catch (err) {
      logger(`Registration ${n} error: ${err.message}`);
    } finally {
      recalling = false;
    }
  }

  document.getElementById('btn-reg-save').addEventListener('click', () => save(Number(regSelect.value)));
  document.getElementById('btn-reg-recall').addEventListener('click', () => recall(Number(regSelect.value)));
  refresh();

  return { recall, isRecalling: () => recalling };
}
