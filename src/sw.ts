/// <reference no-default-lib="true" />
/// <reference lib="webworker" />
/// <reference lib="esnext" />

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = 'pixel-sorter-v2';
const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'codec-worker.js',
  'fonts/JetBrainsMono.ttf',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

// Network-first: a new deploy shows up on the next load; the cache only serves offline.
sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== sw.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) ?? Response.error()),
  );
});
