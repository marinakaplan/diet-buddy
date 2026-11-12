/* מילה — service worker: עבודה בלי רשת + התראות.
   CACHE_NAME ו-PRECACHE מוזרקים בזמן הבנייה (scripts/embed-assets.mjs): שם המטמון הוא hash של כל הקבצים,
   והרשימה כוללת את אותן כתובות עם ?v= שהדף מבקש — כך שהפתיחה הראשונה בלי רשת אחרי התקנה או עדכון עובדת. */
const CACHE_NAME = 'mila-dev';
const PRECACHE = ['/', '/styles.css', '/js/a11y.js', '/js/library.js', '/js/engine.js', '/js/icons.js', '/js/demo.js', '/js/api.js', '/js/install.js', '/js/app.js', '/manifest.json', '/icons/icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', (e) => {
  // כל קובץ בנפרד: קובץ אחד שנכשל לא מבטל את השאר
  e.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.all(PRECACHE.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = (req, res) => { if (res && res.ok && res.type === 'basic') { const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => {}); } return res; };

// קבצים עם גרסה (?v=): מהמטמון קודם (הכתובת משתנה כשהתוכן משתנה).
// דף האפליקציה ושאר הבקשות: רשת קודם, ואם אין רשת – מהמטמון. תשובות שגיאה לא נשמרות.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname === '/fresh' || url.pathname === '/sw.js') return;
  if (url.searchParams.has('v')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => put(e.request, res)).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || Response.error()))));
    return;
  }
  if (e.request.mode === 'navigate') {
    // ניווט: /?go=today וכדומה הם אותו דף אפליקציה; דפים משפטיים נשמרים בכתובת שלהם
    const key = url.pathname === '/' || url.pathname === '/index.html' ? '/' : url.pathname;
    e.respondWith(fetch(e.request).then(res => put(key, res)).catch(() => caches.match(key).then(r => r || caches.match('/')).then(r => r || Response.error())));
    return;
  }
  e.respondWith(fetch(e.request).then(res => put(e.request, res)).catch(() => caches.match(e.request).then(r => r || Response.error())));
});

/* ---------- התראות ---------- */
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data && e.data.text() }; }
  const title = m.title || 'Mila';
  e.waitUntil((async () => {
    // תמיד מציגות התראה: דפדפנים (ובעיקר ספארי באייפון) מבטלים מינוי שמקבל התראות ״שקטות״.
    // אם האפליקציה פתוחה מול העיניים היא גם מתרעננת מיד.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) if (w.visibilityState === 'visible') w.postMessage({ type: 'mila-sync' });
    await self.registration.showNotification(title, {
      body: m.body || '', tag: m.tag || 'mila', renotify: true, lang: 'en', dir: 'ltr',
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
    const w = wins.find(c => { try { const u = new URL(c.url); return u.origin === self.location.origin && (u.pathname === '/' || u.pathname === '/index.html'); } catch { return false; } });   // רק חלון של האפליקציה עצמה (לא דף משפטי)
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
