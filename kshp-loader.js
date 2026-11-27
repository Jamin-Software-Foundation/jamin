// kshp-loader.js
import { readAsset, readAudioAsset } from './imported-assets.js';

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function getStringFromBuffer(buffer, offset, length = null) {
  const view = new Uint8Array(buffer);
  if (length !== null) return new TextDecoder('utf-8').decode(view.subarray(offset, offset + length));
  let end = offset;
  while (end < view.length && view[end] !== 0) end++;
  return new TextDecoder('utf-8').decode(view.subarray(offset, end));
}

function findStringOffset(buffer, searchString) {
  const view = new Uint8Array(buffer);
  const bytes = new TextEncoder().encode(searchString);
  for (let i = 0; i <= view.length - bytes.length; i++) {
    let match = true;
    for (let j = 0; j < bytes.length; j++) {
      if (view[i + j] !== bytes[j]) { match = false; break; }
    }
    if (match) return i;
  }
  return -1;
}

export async function scanStyleFolderDeep(json, styleGroups, currentPath = '') {
  const entries = [];
  for await (const entry of json.children) entries.push(entry);
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.type === 'directory') {
      await scanStyleFolderDeep(entry, styleGroups, currentPath ? `${currentPath}/${entry.name}` : entry.name);
    } else if (entry.type === 'file' && entry.name.toLowerCase().endsWith('.kst')) {
      const genre = currentPath || 'Root';
      if (!styleGroups.has(genre)) styleGroups.set(genre, []);
      styleGroups.get(genre).push(entry);
    }
  }
}

export async function parseAndLoadKst(buffer, rootDirJson, audioCtx, logger, onProgress = () => {}) {
  const view = new DataView(buffer);
  let extractedBpm = 120;
  for (let i = 0; i < buffer.byteLength - 6; i++) {
    if (view.getUint8(i) === 0xFF && view.getUint8(i + 1) === 0x51 && view.getUint8(i + 2) === 0x03) {
      const micro = (view.getUint8(i + 3) << 16) | (view.getUint8(i + 4) << 8) | view.getUint8(i + 5);
      if (micro > 0) extractedBpm = Math.round(60000000 / micro);
      break;
    }
  }

  const origin = findStringOffset(buffer, '/media/USBACK/USER_MODELING/LiveDrum/');
  if (origin < 0) throw new Error('LiveDrum path not found in KST; format not supported.');

  const drumFolder = getStringFromBuffer(buffer, origin + 37);
  const bassFolder = Array.of(0, 1, 2, 3).map(f => getStringFromBuffer(buffer, origin + 2542 + (f * 80)));
  const chordFolder = Array.of(0, 1, 2, 3).map(f => getStringFromBuffer(buffer, origin + 3022 + (f * 80)));

  document.getElementById('out-tempo').innerText = `${extractedBpm} BPM`;
  document.getElementById('style-tempo').textContent = `${extractedBpm} BPM`;
  document.getElementById('out-drum').innerText = `USER_MODELING/LiveDrum/${drumFolder}`;
  for (let i = 0; i < 4; i++) {
    document.getElementById(`out-bass${i + 1}`).innerText = `USER_MODELING/RealBass/${bassFolder[i]}`;
    document.getElementById(`out-chord${i + 1}`).innerText = `USER_MODELING/RealChord/${chordFolder[i]}`;
  }

  const parts = drumFolder.split('_');
  const drumTempo = parseInt(parts[parts.length - 1], 10);
  const finalTempo = (Number.isFinite(drumTempo) && drumTempo > 0) ? drumTempo : extractedBpm;

  const loopAudioBuffers = { drums: {}, bass: {}, chords: {} };
  const decodedByPath = new Map();
  const instruments = ['drums', 'bass', 'chords'];
  const handles = [
    [rootDirJson.list['USER_MODELING']?.list['LiveDrum']?.list[drumFolder]],
    bassFolder.map(f => f ? rootDirJson.list['USER_MODELING']?.list['RealBass']?.list[f] : null),
    chordFolder.map(f => f ? rootDirJson.list['USER_MODELING']?.list['RealChord']?.list[f] : null)
  ];

  if (!handles[0][0]) throw new Error(`Missing LiveDrum folder: ${drumFolder}`);

  const tasks = [];
  const uniquePaths = new Set();
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < handles[i].length; j++) {
      const folder = handles[i][j];
      if (!folder) continue;
      for await (const handle of folder.children) {
        if (handle.type === 'file' && /\.(wav|ogg|flac)$/i.test(handle.name)) {
          const base = handle.name.toUpperCase().split('.')[0];
          const key = i === 0 ? base : `${j}_${base}`;
          if (!loopAudioBuffers[instruments[i]][key]) {
            loopAudioBuffers[instruments[i]][key] = true; // reserve slot
            tasks.push({ instrument: instruments[i], key, handle });
            uniquePaths.add(handle.path);
          }
        }
      }
    }
  }

  let loadedCount = 0;
  const totalCount = uniquePaths.size;
  onProgress(0, totalCount);

  for (const { instrument, key, handle } of tasks) {
    let decoded = decodedByPath.get(handle.path);
    if (!decoded) {
      decoded = await readAudioAsset(handle, audioCtx);
      decodedByPath.set(handle.path, decoded);
      loadedCount++;
      onProgress(loadedCount, totalCount);
    }
    loopAudioBuffers[instrument][key] = decoded;
  }



  // Fallback aliases for missing intro/ending chord & bass files
  for (let v = 0; v < 4; v++) {
    for (const root of noteNames) {
      for (const [prefix, fallback] of [['BIN_MAJ_', 'BMAJ_'], ['BIN_MIN_', 'BMIN_'], ['BEN_MAJ_', 'BMAJ_'], ['BEN_MIN_', 'BMIN_']]) {
        if (!loopAudioBuffers.bass[`${v}_${prefix}${root}`]) loopAudioBuffers.bass[`${v}_${prefix}${root}`] = loopAudioBuffers.bass[`${v}_${fallback}${root}`];
      }
      for (const [prefix, fallback] of [['IN_MAJ_', 'MAJ_'], ['IN_MIN_', 'MIN_'], ['EN_MAJ_', 'MAJ_'], ['EN_MIN_', 'MIN_']]) {
        if (!loopAudioBuffers.chords[`${v}_${prefix}${root}`]) loopAudioBuffers.chords[`${v}_${prefix}${root}`] = loopAudioBuffers.chords[`${v}_${fallback}${root}`];
      }
    }
  }

  logger(`Style loaded (${finalTempo} BPM).`);
  return { tempo: finalTempo, loopAudioBuffers };
}
