/* הגשת קובצי האפליקציה מתוך ה-Worker (ללא Static Assets). SPA: כל נתיב לא מוכר → index.html */
import FILES from './assets.generated.js';

const hashes = new Map();
const bins = new Map();
const bytesOf = (path, b64) => { if (!bins.has(path)) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); bins.set(path, u); } return bins.get(path); };
async function etagFor(path, body) {
  if (!hashes.has(path)) { const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(body)); hashes.set(path, '"' + [...new Uint8Array(d)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('') + '"'); }
  return hashes.get(path);
}
/* /fresh: מנקה בטלפון את המטמון וה-service worker הישנים (בלי לנתק מהחשבון) וטוען את הגרסה העדכנית */
const FRESH = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>מילה</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FCFAF9;color:#1C1A1F;font:600 18px system-ui,-apple-system,Arial,sans-serif}</style></head>
<body><p>טוענת את הגרסה החדשה…</p><script>
(async function () {
  try { if (navigator.serviceWorker) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(function (r) { return r.unregister(); })); } } catch (e) {}
  try { if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map(function (k) { return caches.delete(k); })); } } catch (e) {}
  location.replace('/?r=' + Date.now());
})();
</script></body></html>`;
export async function serveStatic(req) {
  const url = new URL(req.url);
  if (url.pathname === '/fresh') return new Response(FRESH, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'clear-site-data': '"cache"' } });
  let path = decodeURIComponent(url.pathname);
  if (!FILES[path] && FILES[path + '.html']) path += '.html'; // /privacy, /terms
  if (path === '/' || !FILES[path]) path = FILES[path] ? path : '/index.html';
  const f = FILES[path];
  // index.html: כתובות מוחלטות לתמונת השיתוף (og:image) לפי הדומיין שממנו נטען הדף
  const body = f.b64 ? bytesOf(path, f.b64) : path === '/index.html' ? f.body.replaceAll('%ORIGIN%', url.origin) : f.body;
  const etag = await etagFor(path + '|' + (path === '/index.html' ? url.origin : ''), f.b64 || body);
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
  const isHtml = path.endsWith('.html');
  return new Response(req.method === 'HEAD' ? null : body, {
    headers: {
      'content-type': f.type, etag,
      'cache-control': isHtml || path === '/sw.js' || path === '/manifest.json' ? 'no-cache' : url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      ...(isHtml ? { 'referrer-policy': 'strict-origin-when-cross-origin', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'" } : {}),
    },
  });
}
