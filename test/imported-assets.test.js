import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

globalThis.self = globalThis;
const { importAssets, mergeImportedAssets, readAsset, readAudioAsset } = await import('../imported-assets.js');

const zip = entries => new File([fflate.zipSync(entries)], 'assets.zip');
const tree = () => ({ name: 'assets', type: 'directory', children: [] });
const bytes = value => new TextEncoder().encode(value);

test('imports, overlays and persists assets; failed imports do not replace them', async () => {
    const first = zip({
        'package/USER_STYLE/Pop/Test.KST': bytes('style'),
        'USER_MODELING/LiveDrum/Beat/ARRA.flac': bytes('audio'),
        'VOICES/Example.sf2': bytes('soundfont')
    });
    assert.equal(await importAssets(first, null), 3);
    let root = await mergeImportedAssets(tree());
    assert.equal(new TextDecoder().decode(await readAsset(root.list.USER_STYLE.list.Pop.list['Test.KST'])), 'style');
    assert.equal(new TextDecoder().decode(await readAsset(root.list.VOICES.list['Example.sf2'])), 'soundfont');

    await importAssets(zip({ 'USER_MODELING/LiveDrum/Beat/ARRA.ogg': bytes('new audio') }), null);
    root = await mergeImportedAssets(tree());
    const drum = root.list.USER_MODELING.list.LiveDrum.list.Beat;
    assert.equal(drum.list['ARRA.flac'], undefined);
    assert.equal(new TextDecoder().decode(await readAsset(drum.list['ARRA.ogg'])), 'new audio');

    await assert.rejects(importAssets(zip({
        'USER_STYLE/Pop/Test.KST': bytes('replacement'),
        'USER_MODELING/LiveDrum/Beat/ARRA.wav': bytes('bad')
    }), { decodeAudioData: async () => { throw new Error('Invalid WAV'); } }), /Invalid WAV/);
    const truncated = new File([(await first.arrayBuffer()).slice(0, -22)], 'bad.zip');
    await assert.rejects(importAssets(truncated, null), /incomplete|invalid/i);
    await assert.rejects(importAssets(zip({ 'USER_STYLE/../Bad.KST': bytes('bad') }), null), /Invalid ZIP path/);
    root = await mergeImportedAssets(tree());
    assert.equal(new TextDecoder().decode(await readAsset(root.list.USER_STYLE.list.Pop.list['Test.KST'])), 'style');
});

test('converts WAV to Ogg and restores the original decoded loop length', async () => {
    const samples = Float32Array.from({ length: 4410 }, (_, i) => Math.sin(i / 10) * 0.2);
    const context = {
        decodeAudioData: async buffer => {
            if (new Uint8Array(buffer)[0] === 1) {
                return { numberOfChannels: 1, sampleRate: 44100, length: samples.length, getChannelData: () => samples };
            }
            return { numberOfChannels: 1, sampleRate: 44100, length: 4538, getChannelData: () => new Float32Array(4538) };
        },
        createBuffer: (channels, length, sampleRate) => ({
            numberOfChannels: channels, length, sampleRate, copyToChannel() {}
        })
    };
    await importAssets(zip({ 'USER_MODELING/LiveDrum/Beat/ARRA.wav': new Uint8Array([1]) }), context);
    const entry = (await mergeImportedAssets(tree())).list.USER_MODELING.list.LiveDrum.list.Beat.list['ARRA.ogg'];
    assert.equal(new TextDecoder().decode(new Uint8Array(await readAsset(entry), 0, 4)), 'OggS');
    assert.equal((await readAudioAsset(entry, context)).length, samples.length);
});
