const CACHE = 'notely-v8';
const ASSETS = [
  './', './index.html', './styles.css?v=8', './app.js?v=8', './manifest.json', './icon-192.png', './icon-512.png',
  './vendor/ocr/tesseract.min.js',
  './vendor/ocr/worker.min.js',
  './vendor/ocr/tesseract-core-simd.wasm.js',
  './vendor/ocr/tesseract-core.wasm.js',
  './vendor/ocr/tesseract-core-lstm.wasm.js',
  './vendor/ocr/tesseract-core-simd-lstm.wasm.js',
  './vendor/ocr/lang/eng.traineddata.gz',
  './vendor/ocr/lang/ben.traineddata.gz',
  './fonts/inter-var.woff2',
  './fonts/source-serif-var.woff2',
  './fonts/hind-siliguri-400.woff2',
  './fonts/hind-siliguri-600.woff2',
  './fonts/noto-sans-bengali-400.woff2',
  './fonts/noto-sans-bengali-700.woff2',
  './fonts/noto-serif-bengali-var.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const update = fetch(e.request)
        .then((res) => {
          if (res && res.status === 200 && e.request.url.startsWith(self.location.origin)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => null);
      return hit || update;
    })
  );
});
