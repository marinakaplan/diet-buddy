const CACHE_NAME = 'mila-v23';
const ASSETS = ['/', '/index.html', '/styles.css', '/js/library.js', '/js/engine.js', '/js/icons.js', '/js/demo.js', '/js/app.js', '/js/install.js', '/manifest.json', '/icons/icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

// קבצים עם גרסה (?v=) – מהמטמון קודם (לא נשלחת בקשה לשרת בכל פתיחה).
// דף ה-HTML ושאר הבקשות – רשת קודם, ואם אין רשת – מהמטמון.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (url.searchParams.has('v')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => { const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(e.request, clone)); return res; })));
    return;
  }
  e.respondWith(
    fetch(e.request).then(res => { const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(e.request, clone)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
  );
});

/* ---------- התראות ---------- */
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data && e.data.text() }; }
  const title = m.title || 'מילה';
  e.waitUntil((async () => {
    // האפליקציה פתוחה ומול העיניים? מרעננות אותה בשקט במקום להקפיץ התראה (חוץ מתזכורות)
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = wins.find(w => w.visibilityState === 'visible');
    if (visible && m.tag && !String(m.tag).startsWith('reminder') && m.tag !== 'test') { visible.postMessage({ type: 'mila-sync' }); return; }
    await self.registration.showNotification(title, {
      body: m.body || '', tag: m.tag || 'mila', renotify: true, lang: 'he', dir: 'rtl',
      icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', data: { url: m.url || '/?go=today' },
    });
    if (self.navigator && self.navigator.setAppBadge) { try { await self.navigator.setAppBadge(); } catch { } }
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find(c => c.url.startsWith(self.location.origin));
    if (w) { w.postMessage({ type: 'mila-open', url }); return w.focus(); }
    return self.clients.openWindow(url);
  })());
});

// הדפדפן החליף את המינוי (נדיר): נרשמות מחדש עם אותו מפתח ומעדכנות את השרת
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const { key } = await (await fetch('/api/push/key')).json();
      const pad = '='.repeat((4 - key.length % 4) % 4); const raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/'));
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
      await fetch('/api/push/subscribe', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), platform: 'renew' }) });
    } catch { }
  })());
});
