/* Alcancía VI · service worker
   Estrategia: red primero, caché como respaldo (para que las actualizaciones
   lleguen de inmediato y la app siga abriendo sin conexión). */
const VERSION = 'alcancia-vi-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/logo_gta.png',
  './assets/logo_vi.png',
  './assets/featured.jpg',
  './assets/featured_mobile.jpg',
  './assets/GTAArtDeco_Bold.woff',
  './assets/GTAArtDeco_CondensedHeavy.woff',
  './assets/GTAArtDeco_Regular.woff',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Solo manejamos nuestro propio origen y los CDNs de librerías/fuentes.
  const propio = url.origin === self.location.origin;
  const cdn = /(^|\.)(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
  if (!propio && !cdn) return;

  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const copia = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copia)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: propio && url.pathname.endsWith('.html') }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
