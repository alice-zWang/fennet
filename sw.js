// Offline support. App files: network first (so updates arrive), cache fallback.
// Versioned CDN libraries: cache first.
const CACHE = 'openpage-v24';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/design/continue.png', 'icons/design/mark.png', 'icons/design/icon-grid.svg', 'icons/design/icon-sliders.svg',
  'fonts/space-grotesk-latin-wght.woff2', 'fonts/jetbrains-mono-latin-400.woff2', 'fonts/jetbrains-mono-latin-500.woff2',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/theme.js', 'js/security.js', 'js/collab.js', 'js/mascot.js', 'js/demo.js', 'js/studystack.js', 'js/editor.js', 'js/render.js', 'js/db.js', 'js/util.js', 'js/ui.js', 'js/icons.js', 'js/shapes.js', 'js/export.js',
  'js/templates.js', 'js/gallery.js', 'js/colorpicker.js', 'js/sidepanel.js', 'js/ai.js', 'js/ocr.js', 'js/scanner.js', 'js/importers.js', 'js/sync.js',
];
const VENDOR = [
  'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js', 'vendor/jspdf.umd.min.js', 'vendor/mammoth.browser.min.js', 'vendor/jszip.min.js',
  'vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js', 'vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/tesseract-core-lstm.wasm.js', 'vendor/tesseract/lang/eng.traineddata.gz',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    // Best effort: pre-cache bundled libraries (PDF, OCR, import) so they work offline.
    await Promise.all(VENDOR.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === 'https://cdnjs.cloudflare.com') {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return;
  // no-cache: always revalidate with the server so updates arrive as soon as you're online
  e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())));
});
