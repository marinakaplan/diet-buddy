// יוצר src/assets.generated.js עם כל קובצי public/ (טקסט כמו שהוא, תמונות כ-base64).
// למה: העלאת Static Assets ל-Cloudflare משתמשת ב-JWT זמני בכותרת Authorization,
// שסביבת ההרצה שלנו דורסת. הגשת הקבצים מתוך ה-Worker עצמו עוקפת את זה בלי שירות נוסף.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
const root = new URL('../public/', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
const binary = new Set(['.png', '.jpg', '.ico']);
const out = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const rel = '/' + relative(root, p).split('\\').join('/');
    const type = types[extname(name)];
    if (!type) continue;
    out[rel] = binary.has(extname(name)) ? { type, b64: readFileSync(p).toString('base64') } : { type, body: readFileSync(p, 'utf8') };
  }
})(root);
// גרסה אוטומטית לפי התוכן: כל שינוי בקובץ משנה את ?v= שלו, וכל שינוי בכלל משנה את מטמון ה-service worker.
// בלי זה טלפון שכבר טען גרסה נשאר עם הקוד הישן (הקבצים נשמרים במטמון כ״לא משתנים לעולם״).
const hash = (str) => createHash('sha256').update(str).digest('hex').slice(0, 10);
if (out['/index.html']) out['/index.html'].body = out['/index.html'].body.replace(/((?:src|href)="\/?)([^"?]+\.(?:js|css))\?v=[^"]*"/g, (m, pre, file) => {
  const f = out['/' + file.replace(/^\//, '')]; return f ? `${pre}${file}?v=${hash(f.body || f.b64)}"` : m;
});
const all = hash(Object.keys(out).sort().map(k => k + (out[k].body || out[k].b64)).join('|'));
if (out['/sw.js']) {
  // רשימת הקבצים למטמון הראשוני: בדיוק הכתובות (עם ?v=) שהדף מבקש, כדי שפתיחה בלי רשת תמצא אותן
  const versioned = [...out['/index.html'].body.matchAll(/(?:src|href)="(\/?[^"?]+\.(?:js|css)\?v=[^"]*)"/g)].map(m => (m[1].startsWith('/') ? m[1] : '/' + m[1]));
  const precache = ['/', ...new Set(versioned), '/manifest.json', '/icons/icon-192.png', '/icons/badge-96.png'];
  const missing = versioned.filter(u => !out[u.split('?')[0]]);
  if (missing.length || versioned.length < 5) throw new Error('embed: רשימת הקבצים ל-service worker לא שלמה: ' + JSON.stringify({ versioned, missing }));
  out['/sw.js'].body = out['/sw.js'].body
    .replace(/const CACHE_NAME = '[^']*';/, `const CACHE_NAME = 'mila-${all}';`)
    .replace(/const PRECACHE = \[[^\]]*\];/, `const PRECACHE = ${JSON.stringify(precache)};`);
  if (!out['/sw.js'].body.includes(`'mila-${all}'`) || !out['/sw.js'].body.includes(JSON.stringify(precache))) throw new Error('embed: sw.js לא עודכן');
}
writeFileSync(new URL('../src/assets.generated.js', import.meta.url), `// נוצר אוטומטית על ידי scripts/embed-assets.mjs — לא לערוך ידנית\nexport default ${JSON.stringify(out)};\n`);
console.log(`embedded ${Object.keys(out).length} files, ${Math.round(JSON.stringify(out).length / 1024)} KB`);
