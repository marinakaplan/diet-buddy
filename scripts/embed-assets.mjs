// יוצר src/assets.generated.js עם כל קובצי public/ כטקסט.
// למה: העלאת Static Assets ל-Cloudflare משתמשת ב-JWT זמני בכותרת Authorization,
// שסביבת ההרצה שלנו דורסת. הגשת הקבצים מתוך ה-Worker עצמו עוקפת את זה בלי שירות נוסף.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
const root = new URL('../public/', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
const out = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const rel = '/' + relative(root, p).split('\\').join('/');
    const type = types[extname(name)];
    if (!type) continue;
    out[rel] = { type, body: readFileSync(p, 'utf8') };
  }
})(root);
writeFileSync(new URL('../src/assets.generated.js', import.meta.url), `// נוצר אוטומטית על ידי scripts/embed-assets.mjs — לא לערוך ידנית\nexport default ${JSON.stringify(out)};\n`);
console.log(`embedded ${Object.keys(out).length} files, ${Math.round(JSON.stringify(out).length / 1024)} KB`);
