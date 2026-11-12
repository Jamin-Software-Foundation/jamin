(() => {
    const old = id => document.getElementById(id);
    const variationRacks = [...document.querySelectorAll('.variation-rack')];
    const mixerRows = [...document.querySelectorAll('#volume-drums, #volume-bass, #volume-chords, #volume-synth, #volume-master')].map(el => el.parentElement);
    const effectBox = old('effect-type').closest('.box');
    const consoleElement = document.createElement('main');
    consoleElement.className = 'console';
    consoleElement.innerHTML = `
        <div class="topline"><span>JAMIN ARRANGER</span><span>A WEB AUDIO VERSION OF THE KETRON EVENT MODULE (EVM)</span></div>
        <div class="console-grid">
            <section class="panel-head" id="head-global"><small>System</small><strong>GLOBAL</strong><select id="reg-select" aria-label="Registration"></select></section>
            <section class="panel-head browse-head" data-browse="style" tabindex="0" role="button"><small>Style / <span id="style-category">No category</span></small><strong id="style-name">SELECT A STYLE</strong><span id="style-tempo"></span> <span id="style-chord"></span></section>
            <section class="panel-head teal browse-head" data-browse="voice1" tabindex="0" role="button"><small>SoundFont / Voice 1</small><strong id="voice1-name">NO VOICE SELECTED</strong></section>
            <section class="panel-head browse-head" data-browse="voice2" tabindex="0" role="button"><small>SoundFont / Voice 2</small><strong id="voice2-name">NO VOICE SELECTED</strong></section>
            <section class="panel-head"><small>Selected part</small><strong id="selected-voice-label">VOICE 1</strong></section>
            <section class="panel-body side-left"><div class="action-grid" id="global-actions"></div>
                <div class="status" id="global-status"></div><p class="status" id="engine-status" role="status">Choose a root folder to begin.</p></section>
            <section class="panel-body browser-area" id="browser-area"><div class="browser-title" id="browser-title"></div>
                <div class="style-list" id="style-browser"></div><div class="patch-list" id="voice1-browser" hidden></div><div class="patch-list" id="voice2-browser" hidden></div><div id="style-inspect"></div></section>
            <section class="panel-body side-right voice-settings"><div class="voice-tools"><button id="select-voice1" class="selected">Voice 1</button><button id="select-voice2">Voice 2</button></div>
                <div id="voice-controls"></div><div id="effect-controls"></div></section>
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
    old('style-browser').appendChild(old('kst-items'));
    old('file-display').remove();
    move('btn-parse', 'style-inspect');
    old('btn-parse').textContent = 'Load selected style';
    old('btn-link-dir').textContent = 'Root folder';
    old('btn-midi-init').textContent = 'MIDI';
    old('btn-scan-sf2').textContent = 'Scan SF2';
    for (const [id, text] of [['btn-reg-save', 'Save reg'], ['btn-reg-recall', 'Recall']]) {
        const button = document.createElement('button');
        button.id = id;
        button.textContent = text;
        old('global-actions').appendChild(button);
    }
    for (let i = 1; i <= 20; i++) old('reg-select').add(new Option(`Reg ${i}`, i));

    // Two-level pick list: groups first, then the items of the opened group.
    window.renderTwoLevel = (container, state, groups, emptyText) => {
        container.replaceChildren();
        if (!groups.length) { container.textContent = emptyText; return; }
        const open = state.open === null ? null : groups.find(group => group.name === state.open);
        if (!open) state.open = null;
        const add = (text, className, handler, title) => {
            const button = document.createElement('button');
            button.textContent = text;
            if (className) button.className = className;
            if (title) button.title = title;
            button.addEventListener('click', handler);
            container.appendChild(button);
            return button;
        };
        if (!open) {
            for (const group of groups) {
                add(`${group.name}  (${group.items.length})`, group.items.some(item => item.selected) ? 'group selected' : 'group',
                    () => { state.open = group.name; window.renderTwoLevel(container, state, groups, emptyText); });
            }
            return;
        }
        add('◄ ' + open.name, 'back', () => { state.open = null; window.renderTwoLevel(container, state, groups, emptyText); });
        for (const item of open.items) add(item.label, item.selected ? 'selected' : '', item.onClick, item.title);
    };
    const browserViews = { style: 'style-browser', voice1: 'voice1-browser', voice2: 'voice2-browser' };
    const browserTitles = { style: 'Styles', voice1: 'Voice 1 SoundFonts', voice2: 'Voice 2 SoundFonts' };
    window.showBrowser = view => {
        for (const [name, id] of Object.entries(browserViews)) old(id).hidden = name !== view;
        old('browser-title').textContent = browserTitles[view];
        document.querySelectorAll('.browse-head').forEach(head => head.classList.toggle('browsing', head.dataset.browse === view));
        if (view !== 'style') old(`select-${view}`).click();
    };
    document.querySelectorAll('.browse-head').forEach(head => {
        head.addEventListener('click', () => window.showBrowser(head.dataset.browse));
        head.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.showBrowser(head.dataset.browse); } });
    });
    window.showBrowser('style');
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
