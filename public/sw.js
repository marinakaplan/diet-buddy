const CACHE_NAME = 'mila-v1';
const ASSETS = ['/', '/index.html', '/styles.css', '/js/engine.js', '/js/icons.js', '/js/demo.js', '/js/app.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

// רשת קודם, ואם אין – מהמטמון. כך תמיד מקבלים גרסה עדכנית כשיש חיבור.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request).then(res => { const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(e.request, clone)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
  );
});
