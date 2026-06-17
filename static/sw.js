// Minimal, safe service worker. Its job is PWA installability + offline icons —
// NOT caching the app shell, which previously caused intermittent blank pages:
// a stale cached "/" (from an earlier deploy) references hashed JS chunks that a
// later deploy has removed, so the page loads HTML but can't boot its scripts.
//
// Rules:
//   • Navigations  → network ONLY (always fresh HTML matching the live deploy);
//                    a tiny inline page is shown only when truly offline.
//   • Hashed JS/CSS & everything else → NOT intercepted; the browser handles them
//     natively (SvelteKit assets are immutable + content-hashed, so the browser's
//     own cache is correct and never stale).
//   • Icons / manifest → cache-first (safe: their URLs are stable).
const CACHE_NAME = 'mundial2026-v3';
const ASSETS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/icon-512.svg',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Sin conexión</title><body style="margin:0;background:#07090f;color:#c9a84c;font-family:system-ui,sans-serif;' +
  'display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center">' +
  '<div><div style="font-size:42px">🏆</div><p style="font-size:14px">Sin conexión.<br>Inténtalo de nuevo.</p></div>';

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin

  // Navigations: always network. Only fall back to a minimal offline page on a
  // genuine network failure — never to a (possibly stale) cached app shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      )
    );
    return;
  }

  // Stable icons/manifest: cache-first.
  if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
    return;
  }

  // Everything else (hashed JS/CSS, /api, etc.): let the browser handle it.
});
