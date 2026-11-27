import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const scope = 'https://example.test/jamin/';

function harness({ failPath } = {}) {
    const listeners = {};
    const stores = new Map();
    const messages = [];
    const requests = [];
    const cacheFor = name => {
        if (!stores.has(name)) stores.set(name, new Map());
        const store = stores.get(name);
        return {
            put: async (url, response) => store.set(String(url), response),
            match: async request => store.get(request.url.split('?')[0])
        };
    };
    const caches = {
        open: async name => cacheFor(name),
        keys: async () => [...stores.keys()],
        delete: async name => stores.delete(name)
    };
    const self = {
        registration: { scope },
        location: new URL(scope),
        clients: { matchAll: async () => [{ postMessage: message => messages.push(message) }], claim: async () => {} },
        addEventListener: (type, handler) => { listeners[type] = handler; }
    };
    const fetch = async input => {
        const url = String(input.url || input);
        requests.push(url);
        if (url.endsWith('manifest.json') && !url.endsWith('web-manifest.json')) {
            return new Response(JSON.stringify(manifest), { status: 200 });
        }
        return new Response('asset', { status: url.includes(failPath || '\0') ? 404 : 200 });
    };
    vm.runInNewContext(source, { self, caches, fetch, URL, encodeURIComponent });
    const run = async type => {
        let result;
        listeners[type]({ waitUntil: promise => { result = promise; } });
        return result;
    };
    return { listeners, stores, messages, requests, caches, run };
}

test('precache includes every deployed manifest asset and serves it offline under a subpath', async () => {
    const h = harness();
    await h.run('install');
    const cached = h.stores.get('jamin-offline-v1');
    assert.ok(cached);
    for (const url of cached.keys()) {
        const path = decodeURIComponent(new URL(url).pathname.slice('/jamin/'.length)) || 'index.html';
        await access(resolve(fileURLToPath(new URL('..', import.meta.url)), path));
    }
    const asset = 'assets/STRUMSEQ/Pop/Four_On_The_Floor_Pop.strumseq';
    assert.ok(cached.has(scope + asset));
    assert.equal(h.messages.at(-1).done, h.messages.at(-1).total);
    const before = h.requests.length;
    let response;
    h.listeners.fetch({
        request: { method: 'GET', url: scope + asset + '?v=1' },
        respondWith: promise => { response = promise; }
    });
    assert.equal(await (await response).text(), 'asset');
    assert.equal(h.requests.length, before);
    let intercepted = false;
    h.listeners.fetch({
        request: { method: 'GET', url: 'https://example.test/other/' },
        respondWith: () => { intercepted = true; }
    });
    assert.equal(intercepted, false);
});

test('failed downloads discard the incomplete cache and report the failing file', async () => {
    const h = harness({ failPath: 'index.css' });
    await assert.rejects(h.run('install'), /index.css: HTTP 404/);
    assert.equal(h.stores.has('jamin-offline-v1'), false);
    assert.match(h.messages.at(-1).message, /index.css: HTTP 404/);
});

test('activation removes only previous Jamin caches', async () => {
    const h = harness();
    await h.caches.open('jamin-offline-v0');
    await h.caches.open('another-app');
    await h.caches.open('jamin-offline-v1');
    await h.run('activate');
    assert.deepEqual([...h.stores.keys()], ['another-app', 'jamin-offline-v1']);
});
