import { DEFAULT_PEDALS, SUBDIV_LABELS, getSubdivIndex, createPedalChain } from './xg-effects.js';
import { createIRCabinet } from './ir-cabinet.js';

export function createGuitarRig(getAudio, ensureMixer, onLoadIrPath) {
  let chain = null, cabinet = null, voice1Synth = null, rigActive = false, lastBpm = 120;
  const pedals = structuredClone(DEFAULT_PEDALS);
  const host = document.getElementById('rig-browser');

  host.innerHTML = `
    <style>
      #rig-browser { padding: 6px; color: #f4f4f5; }
      #rig-board { display: flex; gap: 8px; flex-wrap: wrap; align-items: stretch; }
      #rig-browser .slot { width: 112px; min-height: 175px; border: 2px dashed #52525b; border-radius: 8px; padding: 5px; display: flex; flex-direction: column; align-items: center; background: rgba(24,24,27,0.5); }
      #rig-browser .pedal { width: 100%; flex: 1; border-radius: 6px; padding: 6px 4px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: space-between; box-shadow: 0 4px 10px rgba(0,0,0,0.55); cursor: grab; transform: translateZ(0); user-select: none; }
      #rig-ir-select, #rig-ir-file { background: #09090b; color: #f4f4f5; border: 1px solid #52525b; border-radius: 4px; padding: 3px 4px; color-scheme: dark; }
      #rig-ir-file::file-selector-button { background: #27272a; color: #f4f4f5; border: 1px solid #52525b; border-radius: 3px; padding: 2px 6px; margin-right: 4px; cursor: pointer; }
    </style>
    <div id="rig-status-bar" style="font-size:0.75rem; margin-bottom:8px; opacity:0.85;">Mode: Bypassed (Enable Guitar Mode to engage)</div>
    <div style="display:flex; gap:8px; align-items:stretch; flex-wrap:wrap;">
      <div id="rig-board">${Array.from(Array(5), (_, i) => `<div class="slot"><small style="font-size:0.62rem; opacity:0.7;">SLOT ${i + 1}</small></div>`).join('')}</div>
      <div style="width:145px; min-height:175px; background:#18181b; border:2px solid #71717a; border-radius:8px; padding:6px; display:flex; flex-direction:column; align-items:center; justify-content:space-between;">
        <strong style="font-size:0.72rem;">IR CAB + ROOM</strong>
        <select id="rig-ir-select" style="width:100%; font-size:0.7rem;"><option value="">No IR (Bypass)</option></select>
        <input type="file" id="rig-ir-file" accept=".wav,.flac,.ogg,audio/*" style="width:100%; font-size:0.68rem;" />
        <div style="display:flex; gap:6px;">
          <div style="text-align:center;"><webaudio-knob id="cab-level" min="0" max="2" step="0.05" value="1" width="32" height="32" diameter="32" colors="#e4e4e7;#27272a;#38bdf8"></webaudio-knob><div style="font-size:0.58rem;">OUT</div></div>
          <div style="text-align:center;"><webaudio-knob id="room-reverb" min="0" max="1" step="0.02" value="0.25" width="32" height="32" diameter="32" colors="#e4e4e7;#27272a;#a855f7"></webaudio-knob><div style="font-size:0.58rem;">ROOM</div></div>
        </div>
        <webaudio-switch id="cab-bypass" type="toggle" value="1" width="24" height="24" colors="#ef4444;#27272a;#f4f4f5"></webaudio-switch>
      </div>
    </div>`;

  const slots = host.querySelectorAll('.slot');
  const sync = () => chain?.sync(pedals);
  const updateDelayLabel = (el, v2) => {
    const lbl = el.querySelector('.l2-txt');
    if (lbl) lbl.textContent = SUBDIV_LABELS.at(getSubdivIndex(v2));
  };

  pedals.forEach((pedal, idx) => {
    const el = document.createElement('div');
    el.className = 'pedal'; el.draggable = true; el.dataset.id = pedal.id; el.style.background = pedal.color;
    const l2Init = pedal.id === 'delay' ? SUBDIV_LABELS.at(getSubdivIndex(pedal.v2)) : pedal.l2;
    el.innerHTML = `
      <strong style="font-size:0.7rem; text-transform:uppercase;">${pedal.name}</strong>
      <div style="display:flex; gap:4px;">
        <div style="text-align:center;"><webaudio-knob class="k1" draggable="false" min="0" max="127" step="1" value="${pedal.v1}" width="32" height="32" diameter="32" colors="#f4f4f5;#18181b;#fbbf24"></webaudio-knob><div style="font-size:0.58rem;">${pedal.l1}</div></div>
        <div style="text-align:center;"><webaudio-knob class="k2" draggable="false" min="0" max="127" step="1" value="${pedal.v2}" width="32" height="32" diameter="32" colors="#f4f4f5;#18181b;#38bdf8"></webaudio-knob><div class="l2-txt" style="font-size:0.58rem;">${l2Init}</div></div>
      </div>
      <webaudio-switch draggable="false" type="toggle" value="${pedal.active ? 1 : 0}" width="24" height="24" colors="#22c55e;#18181b;#f4f4f5"></webaudio-switch>`;
    el.querySelector('.k1').addEventListener('input', e => { pedal.v1 = +e.target.value; sync(); });
    el.querySelector('.k2').addEventListener('input', e => {
      pedal.v2 = +e.target.value;
      if (pedal.id === 'delay') updateDelayLabel(el, pedal.v2);
      sync();
    });
    el.querySelector('webaudio-switch').addEventListener('change', e => { pedal.active = !!e.target.value; sync(); });
    el.addEventListener('dragstart', e => {
      e.stopPropagation(); window.getSelection()?.removeAllRanges(); e.dataTransfer.setData('text/plain', pedal.id);
      const ghost = Object.assign(document.createElement('div'), { textContent: pedal.name });
      Object.assign(ghost.style, { background: pedal.color, color: '#fff', padding: '6px 12px', borderRadius: '6px', position: 'fixed', top: '-1000px' });
      document.body.appendChild(ghost); e.dataTransfer.setDragImage(ghost, 35, 15); setTimeout(() => ghost.remove(), 0);
    });
    slots[idx].appendChild(el);
  });

  slots.forEach(slot => {
    slot.addEventListener('dragover', e => e.preventDefault());
    slot.addEventListener('drop', e => {
      e.preventDefault();
      const dragged = host.querySelector(`.pedal[data-id="${e.dataTransfer.getData('text/plain')}"]`);
      const existing = slot.querySelector('.pedal');
      if (existing && existing !== dragged) dragged.parentElement.appendChild(existing);
      slot.appendChild(dragged); sync();
    });
  });

  function ensureAudioNodes() {
    if (chain) return chain.input;
    const ctx = getAudio(), mixer = ensureMixer();
    cabinet = createIRCabinet(ctx, mixer.voice1);
    chain = createPedalChain(ctx, cabinet);
    chain.setBpm(lastBpm, pedals);
    sync();
    return chain.input;
  }

  function updateRouting() {
    if (!voice1Synth) return;
    const mixer = ensureMixer();
    try { voice1Synth.disconnect(mixer.voice1); } catch (_) {}
    try { if (chain) voice1Synth.disconnect(chain.input); } catch (_) {}
    voice1Synth.connect(rigActive ? ensureAudioNodes() : mixer.voice1);
  }

  host.querySelector('#rig-ir-file').addEventListener('change', async e => {
    const file = e.target.files?.at(0);
    if (!file) return;
    ensureAudioNodes();
    await cabinet.loadBuffer(await file.arrayBuffer(), file.name);
  });
  host.querySelector('#rig-ir-select').addEventListener('change', async e => { if (e.target.value && onLoadIrPath) { ensureAudioNodes(); await onLoadIrPath(e.target.value); } });
  host.querySelector('#cab-level').addEventListener('input', e => cabinet?.setLevel(e.target.value));
  host.querySelector('#room-reverb').addEventListener('input', e => cabinet?.setRoom(e.target.value));
  host.querySelector('#cab-bypass').addEventListener('change', e => cabinet?.setBypass(e.target.value));

  return {
    attachVoice1Synth(s) { voice1Synth = s; updateRouting(); },
    syncTempo(bpm) { if (bpm > 0) { lastBpm = bpm; chain?.setBpm(bpm, pedals); } },
    setActive(en) {
      rigActive = Boolean(en);
      host.querySelector('#rig-status-bar').textContent = rigActive ? 'Mode: ACTIVE (Processing Voice 1 Guitar)' : 'Mode: BYPASSED (Piano / MIDI Keyboard control active)';
      updateRouting();
    },
    populateIrList(paths) {
      host.querySelector('#rig-ir-select').innerHTML = `<option value="">No IR (Bypass)</option>` + paths.map(p => `<option value="${p}">${p.split('/').pop()}</option>`).join('');
    },
    getCabinet: () => cabinet,
    getState: () => ({
      chain: [...slots].map(s => { const p = pedals.find(x => x.id === s.querySelector('.pedal')?.dataset.id); return p ? { id: p.id, v1: p.v1, v2: p.v2, active: p.active } : null; }).filter(Boolean),
      cabinet: cabinet?.getState() || null
    }),
    async setState(state) {
      if (!state?.chain) return;
      ensureAudioNodes();
      state.chain.forEach((item, idx) => {
        const p = pedals.find(x => x.id === item.id), el = host.querySelector(`.pedal[data-id="${item.id}"]`);
        if (!p || !el || !slots[idx]) return;
        p.v1 = item.v1; p.v2 = item.v2; p.active = item.active;
        el.querySelector('.k1').value = item.v1; el.querySelector('.k2').value = item.v2;
        if (item.id === 'delay') updateDelayLabel(el, item.v2);
        el.querySelector('webaudio-switch').value = item.active ? 1 : 0;
        slots[idx].appendChild(el);
      });
      if (state.cabinet) {
        cabinet.setState(state.cabinet);
        host.querySelector('#cab-level').value = state.cabinet.level ?? 1;
        host.querySelector('#room-reverb').value = state.cabinet.room ?? 0.25;
        host.querySelector('#cab-bypass').value = state.cabinet.enabled ? 1 : 0;
        if (state.cabinet.irPath && onLoadIrPath) { host.querySelector('#rig-ir-select').value = state.cabinet.irPath; await onLoadIrPath(state.cabinet.irPath); }
      }
      sync();
    }
  };
}
