// strumseq-browser.js
import { readAsset } from './imported-assets.js';

export function createStrumSeqBrowser(containerId, statusId, onSelectXml, log = console.log) {
  const groupsMap = new Map();
  const allItems = [];
  const viewState = { open: null };
  let selectedPath = null;

  async function walk(folder, folderCategory = '') {
    if (!folder?.children) return;
    const entries = [...folder.children].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.type === 'directory') {
        await walk(entry, entry.name);
      } else if (entry.type === 'file' && /\.strumseq$/i.test(entry.name)) {
        const buffer = await readAsset(entry);
        const xmlText = new TextDecoder('utf-8').decode(buffer);
        const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
        const xmlCategory = doc.querySelector('Pattern')?.getAttribute('Category')?.trim();
        const category = xmlCategory || folderCategory || 'Uncategorized';

        const record = { entry, xmlText };
        allItems.push(record);
        if (!groupsMap.has(category)) groupsMap.set(category, []);
        groupsMap.get(category).push(record);
      }
    }
  }

  function render() {
    const container = document.getElementById(containerId);
    if (!container || !window.renderTwoLevel) return;

    const groups = [...groupsMap]
      .sort((a, b) => a.at(0).localeCompare(b.at(0)))
      .map(([name, items]) => ({
        name,
        items: items.map(({ entry, xmlText }) => ({
          label: entry.name.replace(/\.strumseq$/i, ''),
          title: entry.path,
          selected: selectedPath === entry.path,
          onClick: () => selectPattern(entry, xmlText)
        }))
      }));

    window.renderTwoLevel(container, viewState, groups, 'No .strumseq files found in assets/STRUMSEQ.');
  }

  function selectPattern(entry, xmlText) {
    selectedPath = entry.path;
    const cleanName = entry.name.replace(/\.strumseq$/i, '');
    const statusEl = document.getElementById(statusId);
    if (statusEl) statusEl.textContent = `StrumSeq: ${cleanName}`;
    onSelectXml(xmlText, entry);
    render();
    log(`Loaded strum sequence: ${cleanName}`);
  }

  async function scan(rootJson) {
    groupsMap.clear();
    allItems.length = 0;
    viewState.open = null;
    const folder = rootJson?.list?.['STRUMSEQ'] || rootJson?.list?.['USER_STYLE'];
    await walk(folder);
    render();
  }

  function selectByPath(path) {
    if (!path) return true;
    const found = allItems.find(item => item.entry.path === path);
    if (!found) return false;
    selectPattern(found.entry, found.xmlText);
    return true;
  }

  render();
  return { scan, render, getSelectedPath: () => selectedPath, selectByPath };
}
