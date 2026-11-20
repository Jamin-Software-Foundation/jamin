import "./spessasynth/fflate.js";

const folders = new Set(['VOICES', 'USER_MODELING', 'USER_STYLE']);
const audioExtension = /\.(wav|ogg|flac)$/i;

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('jamin', 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore('files');
            request.result.createObjectStore('staging');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another tab.'));
    });
}

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Storage transaction failed.'));
    });
}

function stagedRange(id) {
    return IDBKeyRange.bound([id, ''], [id, '\uffff']);
}

async function clearStaging(db, id) {
    const tx = db.transaction('staging', 'readwrite');
    tx.objectStore('staging').delete(stagedRange(id));
    await transactionDone(tx);
}

async function encodeWav(data, audioContext) {
    const audio = await audioContext.decodeAudioData(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    if (audio.numberOfChannels > 2) throw new Error('WAV files with more than two channels are not supported.');
    const { default: createEncoder } = await import('./vendor/encode-ogg/ogg-encode.js');
    const encoder = await createEncoder({ sampleRate: audio.sampleRate, channels: audio.numberOfChannels, quality: 4 });
    try {
        const chunks = [];
        for (let offset = 0; offset < audio.length; offset += 16384) {
            const channels = Array.from({ length: audio.numberOfChannels }, (_, i) =>
                audio.getChannelData(i).subarray(offset, Math.min(offset + 16384, audio.length)));
            chunks.push(encoder.encode(channels));
        }
        // Some browser decoders discard the last Vorbis block; retain a looped tail for them.
        const tail = Array.from({ length: audio.numberOfChannels }, (_, i) => {
            const samples = audio.getChannelData(i);
            return Float32Array.from({ length: 128 }, (_, j) => samples[j % samples.length]);
        });
        chunks.push(encoder.encode(tail));
        chunks.push(encoder.flush());
        return { blob: new Blob(chunks, { type: 'audio/ogg' }), frames: audio.length, sampleRate: audio.sampleRate };
    } finally {
        encoder.free();
    }
}

function importPath(name) {
    const parts = name.split('/');
    if (parts.some(part => part === '..' || part === '.') || name.startsWith('/') || name.includes('\\')) {
        throw new Error(`Invalid ZIP path: ${name}`);
    }
    const start = parts.findIndex(part => folders.has(part));
    if (start < 0 || start === parts.length - 1) return null;
    return parts.slice(start).join('/');
}

async function validateZip(file) {
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer());
    const view = new DataView(tail.buffer);
    for (let i = tail.length - 22; i >= 0; i--) {
        if (view.getUint32(i, true) !== 0x06054b50 || i + 22 + view.getUint16(i + 20, true) !== tail.length) continue;
        if (view.getUint16(i + 4, true) || view.getUint16(i + 6, true)) throw new Error('Multi-disk ZIP files are not supported.');
        const directorySize = view.getUint32(i + 12, true);
        const directoryOffset = view.getUint32(i + 16, true);
        const endOffset = file.size - tail.length + i;
        if (directorySize !== 0xffffffff && directoryOffset !== 0xffffffff && directoryOffset + directorySize !== endOffset) {
            throw new Error('The ZIP directory is incomplete.');
        }
        return;
    }
    throw new Error('The ZIP file is incomplete or invalid.');
}

export async function importAssets(file, audioContext, progress = () => {}) {
    const db = await openDatabase();
    const id = crypto.randomUUID();
    let active = 0;
    let count = 0;
    let writes = Promise.resolve();
    let stream;
    const seen = new Set();
    try {
        await validateZip(file);
        const unzip = new fflate.Unzip(entry => {
            if (entry.name.endsWith('/')) return;
            const path = importPath(entry.name);
            if (!path) return;
            const target = path.replace(/\.wav$/i, '.ogg');
            const identity = target.startsWith('USER_MODELING/') ? target.replace(audioExtension, '') : target;
            if (seen.has(identity.toLowerCase())) throw new Error(`Duplicate ZIP entry: ${target}`);
            seen.add(identity.toLowerCase());
            active++;
            const chunks = [];
            entry.ondata = (error, chunk, final) => {
                if (error) {
                    writes = writes.then(() => { throw error; });
                    active--;
                    return;
                }
                chunks.push(chunk);
                if (!final) return;
                active--;
                writes = writes.then(async () => {
                    const blob = new Blob(chunks);
                    const value = /\.wav$/i.test(path)
                        ? await encodeWav(new Uint8Array(await blob.arrayBuffer()), audioContext)
                        : blob;
                    const tx = db.transaction('staging', 'readwrite');
                    tx.objectStore('staging').put(value, [id, target]);
                    await transactionDone(tx);
                    count++;
                    progress(`Importing ${count}: ${target}`);
                });
            };
            entry.start();
        });
        unzip.register(fflate.UnzipInflate);
        stream = file.stream().getReader();
        while (true) {
            const { value, done } = await stream.read();
            unzip.push(value || new Uint8Array(), done);
            await writes;
            if (done) break;
        }
        if (active) throw new Error('The ZIP file is incomplete.');
        if (!count) throw new Error('ZIP contains no files in VOICES, USER_MODELING or USER_STYLE.');
        const tx = db.transaction(['files', 'staging'], 'readwrite');
        const staged = tx.objectStore('staging');
        const files = tx.objectStore('files');
        const keysRequest = files.getAllKeys();
        keysRequest.onsuccess = () => {
            const previous = new Map(keysRequest.result.map(path => [
                (path.startsWith('USER_MODELING/') ? path.replace(audioExtension, '') : path).toLowerCase(), path
            ]));
            staged.openCursor(stagedRange(id)).onsuccess = event => {
                const cursor = event.target.result;
                if (!cursor) return;
                const path = cursor.key[1];
                const identity = path.startsWith('USER_MODELING/') ? path.replace(audioExtension, '') : path;
                const old = previous.get(identity.toLowerCase());
                if (old && old !== path) files.delete(old);
                files.put(cursor.value, path);
                cursor.delete();
                cursor.continue();
            };
        };
        await transactionDone(tx);
        return count;
    } catch (error) {
        await clearStaging(db, id);
        throw error;
    } finally {
        if (stream) stream.releaseLock();
        db.close();
    }
}

export async function mergeImportedAssets(root) {
    const db = await openDatabase();
    try {
        const tx = db.transaction('files', 'readonly');
        const request = tx.objectStore('files').getAllKeys();
        const keys = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        await transactionDone(tx);
        function normalize(node) {
            if (node.type !== 'directory') return node;
            node.children = (node.children || []).map(normalize);
            node.list = Object.fromEntries(node.children.map(child => [child.name, child]));
            return node;
        }
        normalize(root);
        for (const path of keys) {
            const parts = path.split('/');
            let folder = root;
            for (const name of parts.slice(0, -1)) {
                let next = folder.list[name];
                if (!next) {
                    next = { name, type: 'directory', children: [], list: {} };
                    folder.list[name] = next;
                    folder.children.push(next);
                }
                if (next.type !== 'directory') throw new Error(`Imported folder conflicts with asset file: ${path}`);
                folder = next;
            }
            const name = parts[parts.length - 1];
            const existing = folder.list[name];
            if (existing) folder.children.splice(folder.children.indexOf(existing), 1);
            if (path.startsWith('USER_MODELING/') && audioExtension.test(name)) {
                const stem = name.replace(audioExtension, '').toLowerCase();
                for (const child of [...folder.children]) {
                    if (child.type === 'file' && audioExtension.test(child.name) && child.name.replace(audioExtension, '').toLowerCase() === stem) {
                        folder.children.splice(folder.children.indexOf(child), 1);
                        delete folder.list[child.name];
                    }
                }
            }
            const entry = { name, path, type: 'file', imported: true };
            folder.list[name] = entry;
            folder.children.push(entry);
        }
        return root;
    } finally {
        db.close();
    }
}

export async function readAsset(entry) {
    if (!entry.imported) {
        const response = await fetch(entry.path.split('/').map(encodeURIComponent).join('/'));
        if (!response.ok) throw new Error(`Failed to fetch ${entry.path}: ${response.status}`);
        return response.arrayBuffer();
    }
    const db = await openDatabase();
    try {
        const tx = db.transaction('files', 'readonly');
        const request = tx.objectStore('files').get(entry.path);
        const value = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        if (!value) throw new Error(`Imported file not found: ${entry.path}`);
        return (value.blob || value).arrayBuffer();
    } finally {
        db.close();
    }
}

export async function readAudioAsset(entry, audioContext) {
    if (!entry.imported) return audioContext.decodeAudioData(await readAsset(entry));
    const db = await openDatabase();
    let value;
    try {
        const request = db.transaction('files', 'readonly').objectStore('files').get(entry.path);
        value = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
    if (!value) throw new Error(`Imported file not found: ${entry.path}`);
    const decoded = await audioContext.decodeAudioData(await (value.blob || value).arrayBuffer());
    if (!value.blob) return decoded;
    const frames = Math.round(value.frames * decoded.sampleRate / value.sampleRate);
    if (decoded.length < frames) throw new Error(`Decoded audio is shorter than its source: ${entry.path}`);
    if (decoded.length === frames) return decoded;
    const trimmed = audioContext.createBuffer(decoded.numberOfChannels, frames, decoded.sampleRate);
    for (let i = 0; i < decoded.numberOfChannels; i++) {
        trimmed.copyToChannel(decoded.getChannelData(i).subarray(0, frames), i);
    }
    return trimmed;
}
