// כלי תחזוקה (לא חלק מהבנייה): מוחק מ-public/styles.css חוקים שכל הסלקטורים שלהם מפנים למחלקות שאף קובץ לא משתמש בהן.
// הרצה: node scripts/prune-css.mjs [--write]
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url).pathname;
const css = readFileSync(root + 'public/styles.css', 'utf8');
const src = ['public/js/app.js', 'public/js/a11y.js', 'public/js/install.js', 'public/js/icons.js', 'public/js/engine.js', 'public/index.html', 'public/privacy.html', 'public/terms.html', 'public/accessibility.html', 'src/static.js'].map(f => readFileSync(root + f, 'utf8')).join('\n');
const used = (c) => new RegExp('(?<![\\w-])' + c.replace(/-/g, '\\-') + '(?![\\w-])').test(src);
const deadSel = (sel) => { const cls = [...sel.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(m => m[1]); return cls.some(c => !used(c)); };
let removed = 0;
function prune(text) {
  let out = '', i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) { out += text.slice(i); break; }
    // סוף הבלוק (עם קינון)
    let depth = 1, j = open + 1;
    while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
    const preludeRaw = text.slice(i, open); const body = text.slice(open + 1, j - 1);
    const lead = preludeRaw.match(/^(\s*(\/\*[\s\S]*?\*\/\s*)*)/)[0]; const prelude = preludeRaw.slice(lead.length).trim();
    if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
      const inner = prune(body);
      if (inner.trim()) out += lead + prelude + ' {' + inner + '}'; else { out += lead; removed++; }
    } else if (prelude.startsWith('@')) out += preludeRaw + '{' + body + '}';
    else {
      const sels = prelude.split(',').map(s => s.trim()).filter(Boolean);
      const keep = sels.filter(s => !deadSel(s));
      if (!keep.length) { out += lead; removed++; }
      else out += lead + (keep.length === sels.length ? prelude : keep.join(', ')) + ' {' + body + '}';
    }
    i = j;
  }
  return out;
}
let res = prune(css);
// keyframes שאף אחד לא מפנה אליהם יותר
for (const m of [...res.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)]) {
  const name = m[1]; const refs = (res.match(new RegExp('(?<![\\w-])' + name + '(?![\\w-])', 'g')) || []).length + (src.match(new RegExp('(?<![\\w-])' + name + '(?![\\w-])', 'g')) || []).length;
  if (refs <= 1) { const a = res.indexOf(m[0]); let d = 1, j = a + m[0].length; while (d) { if (res[j] === '{') d++; else if (res[j] === '}') d--; j++; } res = res.slice(0, a) + res.slice(j); removed++; }
}
res = res.replace(/\n{3,}/g, '\n\n');
console.log(`rules removed: ${removed}; ${css.length} → ${res.length} bytes`);
if (process.argv.includes('--write')) writeFileSync(root + 'public/styles.css', res);
