/* הגשת קובצי האפליקציה מתוך ה-Worker (ללא Static Assets). SPA: כל נתיב לא מוכר → index.html */
import FILES from './assets.generated.js';

const hashes = new Map();
async function etagFor(path, body) {
  if (!hashes.has(path)) { const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(body)); hashes.set(path, '"' + [...new Uint8Array(d)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('') + '"'); }
  return hashes.get(path);
}
export async function serveStatic(req) {
  const url = new URL(req.url);
  let path = decodeURIComponent(url.pathname);
  if (path === '/' || !FILES[path]) path = FILES[path] ? path : '/index.html';
  const f = FILES[path];
  const etag = await etagFor(path, f.body);
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
  const isHtml = path.endsWith('.html');
  return new Response(req.method === 'HEAD' ? null : f.body, {
    headers: {
      'content-type': f.type, etag,
      'cache-control': isHtml || path === '/sw.js' ? 'no-cache' : url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      ...(isHtml ? { 'referrer-policy': 'strict-origin-when-cross-origin', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" } : {}),
    },
  });
}
