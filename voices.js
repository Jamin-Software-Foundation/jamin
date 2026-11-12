import { WorkletSynthesizer } from './spessasynth/spessasynth_lib.js';
import { MIDIUtils, SoundBankLoader } from 'spessasynth_core';

export function createVoices(getAudio, getMixer, log) {
    const voices = [0, 1].map(() => ({
        synth: null, request: 0, queue: Promise.resolve(), file: null, patch: null,
        octave: 0, transpose: 0, effect: '0', lowFrequency: '0', lowGain: '0',
        highFrequency: '0', highGain: '0', mode: null, notes: new Map()
    }));
    let selected = 0;
    let scanGeneration = 0;
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
        if (voice.patch) selectPatchOnSynth(voice);
    }
    function selectPatchOnSynth(voice) {
        const p = voice.patch;
        const channel = p.isGMGSDrum ? 9 : 0;
        voice.channel = channel;
        voice.synth.controllerChange(channel, 0, p.bankMSB);
        voice.synth.controllerChange(channel, 32, p.bankLSB);
        voice.synth.programChange(channel, p.program);
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
                if (!modulePromise) modulePromise = audio.audioWorklet.addModule('./spessasynth/spessasynth_processor.min.js').catch(error => { modulePromise = null; throw error; });
                await modulePromise;
                if (!voice.synth) {
                    created = new WorkletSynthesizer(audio, { coreUrl: './spessasynth/spessasynth_core.js', fflateUrl: './spessasynth/fflate.js', stbVorbisUrl: './spessasynth/stb-vorbis.js' });
                    await created.isReady;
                }
                const target = voice.synth || created;
                if (voice.file !== item) {
                    const file = await item.getFile();
                    const buffer = await file.arrayBuffer();
                    if (request !== voice.request) { if (created) created.destroy(); return; }
                    if (voice.synth) release(voice);
                    await target.soundBankManager.addSoundBank(buffer, 'selected-soundfont');
                    voice.file = item;
                }
                if (created) {
                    created.connect(getMixer()[`voice${index + 1}`]);
                    voice.synth = created;
                }
                if (request !== voice.request) return;
                release(voice);
                voice.patch = patch;
                voice.mode = null;
                applyEffects(voice);
                $(`voice${index + 1}-name`).textContent = patch.name;
                render();
                status(`Voice ${index + 1}: ${patch.name} (${item.path})`);
                showSettings();
            } catch (error) {
                if (created && created !== voice.synth) created.destroy();
                console.error('SoundFont load failed:', error);
                status(`Voice ${index + 1} SoundFont error: ${error.message}`);
            }
        });
    }
    for (const [id, key] of Object.entries(fields)) {
        $(id).addEventListener('input', () => {
            const voice = voices[selected];
            voice[key] = key === 'octave' || key === 'transpose' ? Number($(id).value) : $(id).value;
            if (key !== 'octave' && key !== 'transpose') applyEffects(voice);
            showSettings();
        });
    }
    [0, 1].forEach(index => $(`select-voice${index + 1}`).addEventListener('click', () => { selected = index; showSettings(); }));

    const views = [{ open: null }, { open: null }];
    let lastItems = [];
    function render(items = lastItems) {
        lastItems = items;
        voices.forEach((voice, index) => {
            const groups = items.map(item => ({
                name: item.path,
                items: item.patches.map(patch => ({
                    label: patch.name,
                    title: `Bank ${patch.bankMSB}, program ${patch.program}${patch.isGMGSDrum ? ' (drums)' : ''}`,
                    selected: voice.file === item && voice.patch === patch,
                    onClick: () => load(index, item, patch)
                }))
            }));
            window.renderTwoLevel($(`voice${index + 1}-browser`), views[index], groups, 'Connect a folder and scan for SoundFonts.');
        });
    }
    async function readItem(getFile, path) {
        const file = await getFile();
        const bank = SoundBankLoader.fromArrayBuffer(await file.arrayBuffer());
        const patches = bank.presets.map((p, index) => ({
            name: p.name || `(Unnamed ${index + 1})`, program: p.program, bankMSB: p.bankMSB,
            bankLSB: p.bankLSB, isGMGSDrum: p.isGMGSDrum, key: String(index)
        }));
        return { getFile, path, patches };
    }
    async function scan(root) {
        const generation = ++scanGeneration;
        const found = [];
        const errors = [];
        $('sf2-scan-status').textContent = 'Scanning SoundFonts and patches...';
        async function walk(folder, path = '') {
            for await (const entry of folder.values()) {
                const name = path ? `${path}/${entry.name}` : entry.name;
                if (entry.kind === 'directory') await walk(entry, name);
                else if (/\.sf2$/i.test(entry.name)) {
                    try { found.push(await readItem(() => entry.getFile(), name)); }
                    catch (error) { errors.push(`${name}: ${error.message}`); }
                }
            }
        }
        try {
            await walk(root);
            if (generation !== scanGeneration) return;
            found.sort((a, b) => a.path.localeCompare(b.path));
            render(found);
            const count = found.reduce((sum, item) => sum + item.patches.length, 0);
            $('sf2-scan-status').textContent = `Found ${found.length} SoundFonts, ${count} patches.${errors.length ? ` ${errors.length} failed: ${errors.join('; ')}` : ''}`;
            errors.forEach(error => log(`SoundFont scan: ${error}`));
        } catch (error) {
            if (generation === scanGeneration) $('sf2-scan-status').textContent = `SoundFont scan failed: ${error.message}`;
            console.error('SoundFont scan failed:', error);
        }
    }
    $('sf2-input').addEventListener('change', async event => {
        const file = event.target.files[0];
        if (!file) return;
        try {
            const item = await readItem(() => Promise.resolve(file), file.name);
            render([item]);
            if (item.patches.length) load(selected, item, item.patches[0]);
            else status(`No patches found in ${file.name}.`);
        } catch (error) { status(`SoundFont error: ${error.message}`); console.error(error); }
    });
    $('sf2-play-btn').addEventListener('click', async () => {
        const voice = voices[selected];
        if (!voice.synth) return;
        const audio = getAudio();
        if (audio.state === 'suspended') await audio.resume();
        const channel = voice.channel;
        voice.synth.noteOn(channel, 60, 100);
        setTimeout(() => voice.synth.noteOff(channel, 60), 1000);
    });
    showSettings();
    return {
        scan,
        cancelScan() { scanGeneration++; views.forEach(view => { view.open = null; }); render([]); },
        getState() {
            return {
                selected,
                voices: voices.map(voice => ({
                    soundFont: voice.file ? voice.file.path : null,
                    patch: voice.patch ? { key: voice.patch.key, name: voice.patch.name } : null,
                    octave: voice.octave, transpose: voice.transpose, effect: voice.effect,
                    lowFrequency: voice.lowFrequency, lowGain: voice.lowGain,
                    highFrequency: voice.highFrequency, highGain: voice.highGain
                }))
            };
        },
        setState(state) {
            const missing = [];
            state.voices.forEach((saved, index) => {
                const voice = voices[index];
                for (const key of ['octave', 'transpose', 'effect', 'lowFrequency', 'lowGain', 'highFrequency', 'highGain']) {
                    if (saved[key] !== undefined) voice[key] = saved[key];
                }
                applyEffects(voice);
                if (!saved.soundFont) return;
                const item = lastItems.find(candidate => candidate.path === saved.soundFont);
                const patch = item?.patches.find(candidate => candidate.key === saved.patch?.key && candidate.name === saved.patch?.name);
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
                if (voice.notes.has(note)) {
                    const previous = voice.notes.get(note);
                    voice.synth.noteOff(previous.channel, previous.note);
                }
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
        }
    };
}
