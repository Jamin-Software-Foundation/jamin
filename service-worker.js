// Change this version whenever the app shell or bundled assets change.
const CACHE_NAME = 'jamin-offline-v1.1';
const SHELL = [
  './', './index.html', './index.css', './console.css', './console-layout.js',
  './index.js', './arranger-player.js', './crkd-bridge.js', './crkd-gamepad.js',
  './crkd-strummer-engine.js', './dual-guitar-voice.js', './guitar-rig-ui.js',
  './guitar-voicing.js', './imported-assets.js', './ir-cabinet.js', './kshp-loader.js',
  './midi-keyboard.js', './neouke-ble.js', './offline.js', './registrations.js',
  './rig-bridge.js', './sf2-bank-scanner.js', './strum-clock-runner.js',
  './strumseq-browser.js', './strumseq-parser.js', './voice-ui.js', './voices.js',
  './webaudio-controls.js', './xg-effects.js', './web-manifest.json', './favicon.png',
  './icon-1024x1024.png', './icon-512x512.png', './icon-297x288.png',
  './spessasynth/fflate.js', './spessasynth/spessasynth_core.js',
  './spessasynth/spessasynth_lib.js', './spessasynth/spessasynth_processor.min.js',
  './spessasynth/stb-vorbis.js', './vendor/encode-ogg/ogg-encode.js'
];

async function notify(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage({ source: 'jamin-offline', ...message });
}

function assetPaths(node, paths = []) {
  if (node.type === 'file') {
    const parts = node.path.split('/');
    if (parts[0] !== 'assets' || parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) {
      throw new Error(`Invalid asset path: ${node.path}`);
    }
    paths.push('./' + parts.map(encodeURIComponent).join('/'));
  } else if (node.type === 'directory' && Array.isArray(node.children)) {
    for (const child of node.children) assetPaths(child, paths);
  } else {
    throw new Error('Invalid asset manifest.');
  }
  return paths;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const manifestResponse = await fetch(new URL('./manifest.json', self.registration.scope), { cache: 'no-store' });
      if (!manifestResponse.ok) throw new Error(`manifest.json: HTTP ${manifestResponse.status}`);
      const manifest = await manifestResponse.clone().json();
      const urls = [...new Set([...SHELL, ...assetPaths(manifest)])];
      const cache = await caches.open(CACHE_NAME);
      await cache.put(new URL('./manifest.json', self.registration.scope), manifestResponse);
      for (let i = 0; i < urls.length; i++) {
        const url = new URL(urls[i], self.registration.scope);
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`${urls[i]}: HTTP ${response.status}`);
        await cache.put(url, response);
        await notify({ type: 'progress', done: i + 1, total: urls.length });
      }
    } catch (error) {
      await caches.delete(CACHE_NAME);
      await notify({ type: 'error', message: error.message });
      throw error;
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('jamin-offline-') && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(event.request, { ignoreSearch: true }) || fetch(event.request);
  })());
});
