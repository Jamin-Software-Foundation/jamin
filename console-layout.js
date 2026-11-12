(() => {
    const old = id => document.getElementById(id);
    const variationRacks = [...document.querySelectorAll('.variation-rack')];
    const mixerRows = [...document.querySelectorAll('#volume-drums, #volume-bass, #volume-chords, #volume-synth, #volume-master')].map(el => el.parentElement);
    const effectBox = old('effect-type').closest('.box');
    const consoleElement = document.createElement('main');
    consoleElement.className = 'console';
    consoleElement.innerHTML = `
        <div class="topline"><span>VIBE ARRANGER / EVENT MODULE</span><span>WEB AUDIO PERFORMANCE</span></div>
        <div class="console-grid">
            <section class="panel"><div class="panel-head"><small>System</small><strong>GLOBAL</strong></div>
                <div class="panel-body"><div class="action-grid" id="global-actions"></div>
                <div class="status" id="global-status"></div><p class="status" id="engine-status" role="status">Choose a root folder to begin.</p></div></section>
            <section class="panel"><div class="panel-head"><small>Style / <span id="style-category">No category</span></small><strong id="style-name">SELECT A STYLE</strong><span id="style-tempo"></span> <span id="style-chord"></span></div>
                <div class="panel-body"><div class="style-list" id="style-browser"></div><div id="style-inspect"></div></div></section>
            <section class="panel"><div class="panel-head teal"><small>SoundFont / Voice 1</small><strong id="voice1-name">NO VOICE SELECTED</strong></div>
                <div class="panel-body"><div id="voice1-browser"></div></div></section>
            <section class="panel"><div class="panel-head"><small>SoundFont / Voice 2</small><strong id="voice2-name">NO VOICE SELECTED</strong></div>
                <div class="panel-body"><div id="voice2-browser"></div></div></section>
            <section class="panel"><div class="panel-head"><small>Selected part</small><strong id="selected-voice-label">VOICE 1</strong></div>
                <div class="panel-body voice-settings"><div class="voice-tools"><button id="select-voice1" class="selected">Voice 1</button><button id="select-voice2">Voice 2</button></div>
                <div id="voice-controls"></div><div id="effect-controls"></div></div></section>
            <section class="mixer" id="console-mixer"><span class="mixer-title">MIXER</span></section>
        </div>
        <nav class="toolbar" aria-label="Style performance controls" id="performance"></nav>
        <details><summary>Keyboard and diagnostics</summary><div id="diagnostics"></div></details>`;
    document.body.insertBefore(consoleElement, document.querySelector('script[type="module"]'));
    const move = (id, parent) => old(parent).appendChild(old(id));
    move('btn-link-dir', 'global-actions');
    move('btn-midi-init', 'global-actions');
    move('btn-scan-sf2', 'global-actions');
    move('txt-dir', 'global-status');
    move('midi-status', 'global-status');
    move('sf2-scan-status', 'global-status');
    move('status', 'global-status');
    move('file-display', 'style-browser');
    move('btn-parse', 'style-inspect');
    old('btn-parse').textContent = 'Load selected style';
    old('btn-link-dir').textContent = 'Root folder';
    old('btn-midi-init').textContent = 'MIDI';
    old('btn-scan-sf2').textContent = 'Scan SF2';
    mixerRows.forEach(row => {
        row.className = 'channel';
        old('console-mixer').appendChild(row);
    });
    const synthRow = old('volume-synth').parentElement;
    synthRow.querySelector('label').textContent = 'Voice 1';
    synthRow.querySelector('label').htmlFor = 'volume-voice1';
    for (const prefix of ['volume', 'level', 'mute']) old(`${prefix}-synth`).id = `${prefix}-voice1`;
    old('mute-voice1').textContent = 'Mute';
    const secondRow = synthRow.cloneNode(true);
    for (const prefix of ['volume', 'level', 'mute']) secondRow.querySelector(`#${prefix}-voice1`).id = `${prefix}-voice2`;
    secondRow.querySelector('label').htmlFor = 'volume-voice2';
    secondRow.querySelector('label').textContent = 'Voice 2';
    synthRow.after(secondRow);
    document.querySelectorAll('.channel button').forEach(button => button.textContent = 'Mute');
    old('effect-controls').append(...effectBox.querySelectorAll(':scope > .control-row, :scope > fieldset'));
    const toolbar = old('performance');
    for (let i = 1; i <= 3; i++) {
        const button = document.createElement('button');
        button.textContent = `In / End ${i}`;
        button.className = 'intro-choice';
        button.dataset.intro = String(i - 1);
        button.setAttribute('aria-pressed', String(i === 3));
        toolbar.appendChild(button);
    }
    variationRacks.forEach(rack => toolbar.append(...rack.children));
    toolbar.append(old('auto-fill').parentElement, old('ctrl-key'), old('lbl-tempo'), old('ctrl-tempo'), old('btn-play'), old('btn-stop'));
    old('btn-play').textContent = 'Start / End';
    old('btn-play').disabled = true;
    old('btn-stop').textContent = 'Stop';
    old('ctrl-key').setAttribute('aria-label', 'Arranger key');
    old('ctrl-tempo').setAttribute('aria-label', 'Tempo shift');
    const diagnostics = old('diagnostics');
    diagnostics.append(old('out-tempo').closest('.data-card'), old('out-chord').closest('.data-card'), old('virtual-keyboard'), old('sf2-input'), old('sf2-play-btn'), old('log-window'));
    old('style-chord').appendChild(old('out-chord'));
    old('sf2-input').setAttribute('aria-label', 'Upload SoundFont for selected voice');
    old('sf2-play-btn').textContent = 'Test selected voice';
})();
