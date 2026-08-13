const CACHE_NAME = 'stocktrack-v5';
const ASSETS = [
  './', './index.html', './app.js', './manifest.json',
  './icon-192.png', './icon-512.png', './icon-512-maskable.png',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@600;700&display=swap',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-database-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))); self.clients.claim(); });
self.addEventListener('fetch', event => {
  const url = event.request.url;
  if (url.includes('firebasedatabase.app') || url.includes('firebaseio.com')) return;
  const isAppShell = url.includes('/index.html') || url.includes('/app.js') || url.includes('/manifest.json') || url.endsWith('/stock-tracker/') || url.endsWith('/stock-tracker');
  if (isAppShell) {
    event.respondWith(fetch(event.request).then(response => { if (response && response.status === 200) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)); } return response; }).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => { const network = fetch(event.request).then(response => { if (response && response.status === 200) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)); } return response; }).catch(() => cached); return cached || network; }));
});
