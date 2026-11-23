// sf2-bank-scanner.js
import { SoundBankLoader } from 'spessasynth_core';
import { readAsset } from './imported-assets.js';

export function createSf2Scanner(voices, onSelectPatch, log = console.log) {
  let scanGeneration = 0;
  let lastItems = [];
  const views = [{ open: null }, { open: null }];
  const $ = id => document.getElementById(id);

  function render(items = lastItems) {
    lastItems = items;
    voices.forEach((voice, index) => {
      const groups = items.map(item => ({
        name: item.path,
        items: item.patches.map(patch => ({
          label: patch.name,
          title: `Bank ${patch.bankMSB}, program ${patch.program}${patch.isGMGSDrum ? ' (drums)' : ''}`,
          selected: voice.file === item && voice.patch === patch,
          onClick: () => onSelectPatch(index, item, patch)
        }))
      }));
      window.renderTwoLevel($(`voice${index + 1}-browser`), views[index], groups, 'Connect a folder and scan for SoundFonts.');
    });
  }

  function makeItem(buffer, path) {
    const bank = SoundBankLoader.fromArrayBuffer(buffer);
    const patches = bank.presets.map((p, index) => ({
      name: p.name || `(Unnamed ${index + 1})`, program: p.program, bankMSB: p.bankMSB,
      bankLSB: p.bankLSB, isGMGSDrum: p.isGMGSDrum, key: String(index)
    }));
    return { buffer, path, patches };
  }

  async function readItem(entry) {
    const path = entry.displayPath || entry.name;
    if (entry.type !== 'directory') return makeItem(await readAsset(entry), path);

    const parts = entry.children
      .filter(child => child.type === 'file' && /^part_\d+$/i.test(child.name))
      .sort((a, b) => Number(a.name.slice(5)) - Number(b.name.slice(5)));
    if (!parts.length || parts.some((part, index) => Number(part.name.slice(5)) !== index)) {
      throw new Error('SoundFont parts must start at part_00 and be consecutive.');
    }
    const buffers = await Promise.all(parts.map(readAsset));
    const merged = new Uint8Array(buffers.reduce((sum, part) => sum + part.byteLength, 0));
    let offset = 0;
    for (const part of buffers) { merged.set(new Uint8Array(part), offset); offset += part.byteLength; }
    return makeItem(merged.buffer, path);
  }

  async function scan(root) {
    const generation = ++scanGeneration;
    const found = [];
    const errors = [];
    $('sf2-scan-status').textContent = 'Scanning SoundFonts and patches...';

    async function walk(folder, prefix = '') {
      for (const entry of folder?.children || []) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.type === 'directory' && !entry.children.some(child => /^part_\d+$/i.test(child.name))) {
          await walk(entry, path);
        } else if (entry.type === 'directory' || /\.sf2$/i.test(entry.name)) {
          try { found.push(await readItem({ ...entry, displayPath: path })); }
          catch (error) { errors.push(`${path}: ${error.message}`); }
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
    }
  }

  return {
    scan,
    render,
    makeItem,
    getLastItems: () => lastItems,
    cancelScan() { scanGeneration++; views.forEach(view => { view.open = null; }); render([]); }
  };
}
