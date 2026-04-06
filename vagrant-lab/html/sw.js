const CACHE_NAME = 'financeiro-cache-v3';
const OFFLINE_FILES = ['/', '/dashboard.html', '/manifest.webmanifest', '/app-config.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_FILES)));
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((response) => response || caches.match('/')))
  );
});
