/* בדיקת עומס ועלות מול המכסה החינמית של Cloudflare (staging בלבד, דורש ALLOW_TEST_LOGIN).
   מדמה N משתמשות: הרשמה, קבוצות של 6, הצטרפות בהזמנה, 3 אתגרים לכל אחת, דיווח,
   ואז רענונים במקביל. מודד זמני תגובה, שגיאות ושורות D1 לכל בקשה (כותרות x-d1-read/x-d1-write),
   ומחשב כמה משתמשות פעילות ביום המכסה החינמית מחזיקה.
   הרצה: BASE_URL=https://mila-staging.mila-app.workers.dev USERS=24 node tests/load.cjs */
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const N = Number(process.env.USERS || 24);
const GROUP = 6;
const ROUNDS = Number(process.env.ROUNDS || 4);
const stamp = Date.now().toString(36);
const stats = {};
const note = (name, ms, res) => {
  const s = stats[name] || (stats[name] = { n: 0, ms: [], read: 0, write: 0, err: 0 });
  s.n++; s.ms.push(ms); s.read += Number(res.headers.get('x-d1-read') || 0); s.write += Number(res.headers.get('x-d1-write') || 0);
  if (res.status >= 400) s.err++;
};
class U {
  constructor(i) { this.i = i; this.cookie = ''; this.email = `load.${stamp}.${i}@test.mila`; }
  async req(path, { method = 'GET', body, name } = {}) {
    const t = Date.now();
    const res = await fetch(BASE + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), cookie: this.cookie, origin: BASE }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) { const m = sc.match(/mila_session=([^;]+)/); if (m) this.cookie = `mila_session=${m[1]}`; }
    note(name || `${method} ${path.replace(/\/action\//, '/')}`, Date.now() - t, res);
    let data = null; try { data = await res.json(); } catch { }
    if (res.status >= 400) throw new Error(`${path} ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
  act(a, body) { return this.req(`/api/action/${a}`, { method: 'POST', body, name: a }); }
}
const LIB = ['food_no_delivery', 'move_walk_30', 'hab_read_10', 'food_8_water', 'move_8000_steps', 'fam_play_15', 'hab_coffee_home', 'move_sleep_by_23', 'food_no_sweets_evening'];
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; };

(async () => {
  console.log(`מילה · בדיקת עומס · ${BASE} · ${N} משתמשות`);
  const users = Array.from({ length: N }, (_, i) => new U(i));
  const t0 = Date.now();
  await Promise.all(users.map(async u => { await u.req('/api/auth/test-login', { method: 'POST', body: { email: u.email, name: `עומס ${u.i}` }, name: 'login' }); await u.req('/api/profile', { method: 'POST', body: { name: `עומס ${u.i}`, ageConfirmed: true, termsAccepted: true, timezone: 'Asia/Jerusalem' }, name: 'profile' }); }));
  // קבוצות: הראשונה בכל שישייה פותחת, השאר מצטרפות עם הקוד (במקביל)
  for (let g = 0; g < N; g += GROUP) {
    const admin = users[g];
    const r = await admin.act('createCircle', { name: `עומס ${g / GROUP}` });
    await Promise.all(users.slice(g + 1, g + GROUP).map(u => u.act('acceptInvite', { token: r.inviteToken })));
  }
  // 3 אתגרים לכל אחת, בתוך הקבוצה שלה
  await Promise.all(users.map(async (u) => {
    const s = await u.req('/api/state', { name: 'state (setup)' });
    const cid = Object.keys(s.circles)[0];
    for (let k = 0; k < 3; k++) await u.act('createPersonalWord', { libraryId: LIB[(u.i + k) % LIB.length], circleId: cid, visibility: 'status' });
  }));
  // דיווח על היום
  await Promise.all(users.map(async (u) => {
    const s = await u.req('/api/state', { name: 'state (setup)' });
    const today = Object.values(s.obligations).filter(o => o.userId === s.me && o.status === 'open' && !o.outcome);
    for (const o of today) await u.act('report', { obligationId: o.id, outcome: Math.random() < .75 ? 'success' : 'miss' });
  }));
  const setupMs = Date.now() - t0;
  // רענונים במקביל: כל אחת פותחת ROUNDS פעמים
  const t1 = Date.now();
  for (let r = 0; r < ROUNDS; r++) await Promise.all(users.map(u => u.req('/api/state', { name: 'state' })));
  for (let r = 0; r < ROUNDS; r++) await Promise.all(users.map(u => u.req('/api/ping', { name: 'ping' })));
  const burstMs = Date.now() - t1;

  console.log(`\nהכנה: ${(setupMs / 1000).toFixed(1)} שנ׳ · ${N * ROUNDS} רענונים במקביל: ${(burstMs / 1000).toFixed(1)} שנ׳\n`);
  console.log('פעולה'.padEnd(22), 'בקשות', 'שגיאות', 'p50ms', 'p95ms', 'קריאות/בקשה', 'כתיבות/בקשה');
  for (const [k, s] of Object.entries(stats)) console.log(k.padEnd(22), String(s.n).padStart(5), String(s.err).padStart(6), String(pct(s.ms, .5)).padStart(5), String(pct(s.ms, .95)).padStart(5), (s.read / s.n).toFixed(0).padStart(11), (s.write / s.n).toFixed(1).padStart(11));
  // מודל ליום של משתמשת פעילה (הנחות ממוצעות)
  const st = stats.state; const rep = stats.report || { read: 0, write: 0, n: 1 };
  const perState = { r: st.read / st.n, w: st.write / st.n };
  const perReport = { r: rep.read / rep.n, w: rep.write / rep.n };
  const model = Number(process.env.STATE_PER_DAY || 12);
  const pg = stats.ping; const perPing = pg ? { r: pg.read / pg.n, w: pg.write / pg.n } : { r: 0, w: 0 };
  const pings = Number(process.env.PING_PER_DAY || 0);
  const daily = { req: model + pings + 4 + 6, read: model * perState.r + pings * perPing.r + 3 * perReport.r, write: model * perState.w + 3 * perReport.w + 2 };
  console.log(`\nמודל ליום למשתמשת פעילה: ${model} טעינות מצב מלאות, ${pings} בדיקות קלות, 3 דיווחים, ~6 בקשות נוספות`);
  console.log(`≈ ${daily.req} בקשות · ${daily.read.toFixed(0)} שורות נקראות · ${daily.write.toFixed(0)} שורות נכתבות`);
  const cap = { req: 100000 / daily.req, read: 5e6 / daily.read, write: 1e5 / Math.max(daily.write, 1) };
  console.log(`תקרה חינמית: Workers ≈ ${cap.req.toFixed(0)} · D1 קריאות ≈ ${cap.read.toFixed(0)} · D1 כתיבות ≈ ${cap.write.toFixed(0)} משתמשות פעילות ביום`);
  console.log(`צוואר הבקבוק: ≈ ${Math.min(cap.req, cap.read, cap.write).toFixed(0)} משתמשות פעילות ביום`);
  const errs = Object.values(stats).reduce((a, s) => a + s.err, 0);
  if (errs) { console.log(`\n${errs} שגיאות`); process.exitCode = 1; }
})().catch(e => { console.error('LOAD FAILED', e.message); process.exit(1); });
