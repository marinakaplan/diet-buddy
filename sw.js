const CACHE_NAME = 'shifty-v24';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/ai-agent.js', '/gamification.js', '/groups.js', '/icons.js'];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // Don't cache API calls
    if (e.request.url.includes('/api/') || e.request.url.includes('api.anthropic.com')) {
        return;
    }
    // Network first, fallback to cache (ensures fresh assets)
    e.respondWith(
        fetch(e.request)
            .then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                return response;
            })
            .catch(() => caches.match(e.request))
    );
});
