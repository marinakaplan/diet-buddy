// Renders reel.html to frames, writes audio/sfx-events.json and captions.srt (full voiceover transcript) next to this file.
// Usage: node render.cjs <outDir> [fps] [t1,t2,...]   (with times: PNG preview frames only)
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const out = process.argv[2]; const fps = +(process.argv[3] || 30); const only = process.argv[4];
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto('file://' + path.resolve(__dirname, 'reel.html') + '?t=0');
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(800);
  const { dur, vo, sfx } = await p.evaluate(() => ({ dur: window.DUR, vo: window.VO, sfx: window.SFX }));
  if (!only) fs.writeFileSync(path.resolve(__dirname, 'audio/sfx-events.json'), JSON.stringify({ dur, sfx }));
  if (!only) {
    const ts = s => { const ms = Math.round(s * 1000), h = String(Math.floor(ms / 3600000)).padStart(2, '0'), m = String(Math.floor(ms / 60000) % 60).padStart(2, '0'), sec = String(Math.floor(ms / 1000) % 60).padStart(2, '0'); return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, '0')}`; };
    fs.writeFileSync(path.resolve(__dirname, 'captions.srt'), vo.map((v, i) => `${i + 1}\n${ts(v[0])} --> ${ts(v[1])}\n${v[2]}\n`).join('\n'));
  }
  const times = only ? only.split(',').map(Number) : [...Array(Math.round(dur * fps)).keys()].map(i => i / fps);
  for (let i = 0; i < times.length; i++) {
    await p.evaluate(t => render(t), times[i]);
    await p.screenshot({ path: `${out}/f${String(i).padStart(4, '0')}.${only ? 'png' : 'jpg'}`, ...(only ? {} : { type: 'jpeg', quality: 92 }) });
  }
  await b.close();
})();
