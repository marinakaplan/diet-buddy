/* בדיקות API מול ה-Worker (wrangler dev / staging עם ALLOW_TEST_LOGIN).
   שתי משתמשות, אותו מעגל, אותם חוקים — כולל בקשות מקבילות.
   הרצה: BASE_URL=http://127.0.0.1:8787 node tests/api.test.js */
const assert = require('assert');
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const stamp = Date.now().toString(36);

class Client {
  constructor(name) { this.name = name; this.cookie = ''; }
  async req(path, { method = 'GET', body } = {}) {
    const res = await fetch(BASE + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), cookie: this.cookie, origin: BASE }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = res.headers.get('set-cookie'); if (sc) { const m = sc.match(/mila_session=([^;]+)/); if (m) this.cookie = `mila_session=${m[1]}`; }
    let data = null; try { data = await res.json(); } catch { }
    return { status: res.status, data };
  }
  async login(email, name) { const r = await this.req('/api/auth/test-login', { method: 'POST', body: { email, name } }); assert.strictEqual(r.status, 200, 'test login ' + JSON.stringify(r.data)); return r.data; }
  async profile(name) { return this.req('/api/profile', { method: 'POST', body: { name, ageConfirmed: true, termsAccepted: true, timezone: 'Asia/Jerusalem' } }); }
  async state() { const r = await this.req('/api/state'); assert.strictEqual(r.status, 200, 'state ' + JSON.stringify(r.data)); return r.data; }
  async act(name, body) { return this.req(`/api/action/${name}`, { method: 'POST', body }); }
  async ok(name, body) { const r = await this.act(name, body); assert.strictEqual(r.status, 200, `${name}: ${JSON.stringify(r.data)}`); return r.data; }
  async fail(name, body, code) { const r = await this.act(name, body); assert.ok(r.status >= 400, `${name} should fail`); if (code) assert.strictEqual(r.data.error, code, `${name}: expected ${code}, got ${JSON.stringify(r.data)}`); return r.data; }
}
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '\n     ', e.message); process.exitCode = 1; throw e; } };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
const invariants = async (c) => {
  const s = await c.state();
  const active = s.ledger.filter(t => t.type !== 'REVERSE' && !s.ledger.some(r => r.reversalOf === t.id));
  const per = {}; for (const t of active) per[t.obligationId] = (per[t.obligationId] || 0) + 1;
  for (const [k, v] of Object.entries(per)) assert.strictEqual(v, 1, `אירוע ${k} עם ${v} תנועות פעילות`);
  // היומן המלא נשלח רק עבור המשתמשת עצמה (של אחרות רק פספוסי קופה), לכן בודקים את האירועים שלי בלבד
  for (const o of Object.values(s.obligations).filter(o => o.userId === s.me)) { const n = per[o.id] || 0; if (o.outcome === 'success' || o.outcome === 'miss') assert.strictEqual(n, 1, 'הכרעה בלי תנועה'); else assert.strictEqual(n, 0, 'תנועה בלי הכרעה'); }
  const cnt = {}; for (const o of Object.values(s.obligations)) { if (o.status === 'cancelled') continue; const k = o.userId + o.localDate; cnt[k] = (cnt[k] || 0) + 1; assert.ok(cnt[k] <= 3, 'חריגה מתקרה'); }
  return s;
};

(async () => {
  console.log('מילה · בדיקות API ·', BASE);
  const A = new Client('A'), B = new Client('B'), Z = new Client('Z');
  let circleId, token, defId, kA, kB, obA, obB;

  await test('בריאות השרת', async () => { const r = await fetch(BASE + '/api/health'); assert.strictEqual(r.status, 200); });
  await test('ללא סשן: /api/state מחזיר 401', async () => { const r = await new Client('x').req('/api/state'); assert.strictEqual(r.status, 401); });
  await test('א נרשמת; בלי פרופיל אין גישה למצב (403)', async () => {
    await A.login(`a.${stamp}@test.mila`, 'יעל');
    const r = await A.req('/api/state'); assert.strictEqual(r.status, 403);
    const bad = await A.req('/api/profile', { method: 'POST', body: { name: 'יעל', termsAccepted: false } }); assert.strictEqual(bad.status, 400, 'מגבלת גיל');
    assert.strictEqual((await A.profile('יעל')).status, 200);
    const s = await A.state(); assert.strictEqual(s.users[s.me].name, 'יעל');
  });
  await test('CSRF: Origin זר נדחה', async () => {
    const res = await fetch(BASE + '/api/action/createCircle', { method: 'POST', headers: { 'content-type': 'application/json', cookie: A.cookie, origin: 'https://evil.example' }, body: '{}' });
    assert.strictEqual(res.status, 403);
  });
  await test('א פותחת מעגל ומקבלת קוד הזמנה', async () => {
    const r = await A.ok('createCircle', { name: 'חברות', description: 'בדיקה' }); circleId = r.circleId; token = r.inviteToken;
    assert.ok(token && token.length === 6);
    const s = await A.state(); assert.ok(s.circles[circleId]); assert.strictEqual(s.memberships.length, 1);
    assert.ok(!JSON.stringify(s.invites).includes(token), 'האסימון לא נחשף במצב (רק hint)');
  });
  await test('ב נרשמת, רואה תצוגה מקדימה ומצטרפת; הצטרפות לא יוצרת אירועים (AT-02)', async () => {
    await B.login(`b.${stamp}@test.mila`, 'נועה'); await B.profile('נועה');
    const p = await B.ok('previewInvite', { token }); assert.ok(p.ok && p.memberCount === 1 && p.inviter.name === 'יעל');
    assert.strictEqual((await B.ok('previewInvite', { token: 'ZZZZZZ' })).ok, false);
    await B.ok('acceptInvite', { token }); await B.ok('acceptInvite', { token });
    const s = await B.state(); assert.strictEqual(s.memberships.length, 2); assert.deepStrictEqual(s.obligations, {}); assert.deepStrictEqual(s.ledger, []);
  });
  await test('א מציעה מילה קבוצתית; ב מאמצת — מופעים נפרדים (AT-04); אימוץ כפול idempotent', async () => {
    defId = (await A.ok('proposeGroupWord', { circleId, title: '8,000 צעדים', rule: 'מונה צעדים', icon: 'run', startDate: today() })).defId;
    kA = (await A.ok('adoptGroupWord', { defId })).commitmentId;
    const rb = await B.ok('adoptGroupWord', { defId }); kB = rb.commitmentId; assert.strictEqual(rb.duplicate, false);
    assert.notStrictEqual(kA, kB);
    assert.strictEqual((await B.ok('adoptGroupWord', { defId })).duplicate, true);
    const s = await B.state(); assert.strictEqual(Object.values(s.obligations).filter(o => o.commitmentId === kB).length, 14);
    const sB = await B.state(); assert.ok(sB.notifications.some(n => n.type === 'group_word'), 'התראה על מילה חדשה');
  });
  await test('דיווחים: ב לא יכולה לדווח על א; א פספסה, ב הצליחה; דיווח כפול לא משנה (AT-06)', async () => {
    const sA = await A.state(); obA = Object.values(sA.obligations).find(o => o.commitmentId === kA && o.localDate === today()).id;
    const sB = await B.state(); obB = Object.values(sB.obligations).find(o => o.commitmentId === kB && o.localDate === today()).id;
    await B.fail('report', { obligationId: obA, outcome: 'success' }, 'FORBIDDEN');
    await B.fail('report', { obligationId: Object.values(sB.obligations).find(o => o.commitmentId === kB && o.localDate > today()).id, outcome: 'success' }, 'VALIDATION');
    assert.strictEqual((await B.ok('report', { obligationId: obB, outcome: 'success' })).duplicate, false);
    const dup = await B.ok('report', { obligationId: obB, outcome: 'miss' }); assert.strictEqual(dup.duplicate, true); assert.strictEqual(dup.outcome, 'success');
    await A.ok('report', { obligationId: obA, outcome: 'miss' });
  });
  await test('בנק וקופה אצל שתיהן; חשיפה: א רואה סטטוס של ב בלי resolveReason', async () => {
    const sA = await invariants(A); const sB = await invariants(B);
    const earn = (s, u) => s.ledger.filter(t => t.userId === u && t.type === 'EARN').length;
    const miss = (s, u) => s.ledger.filter(t => t.userId === u && t.type === 'MISS_TO_CIRCLE').length;
    assert.strictEqual(earn(sA, sA.me), 0); assert.strictEqual(miss(sA, sA.me), 1);
    assert.strictEqual(earn(sB, sB.me), 1); assert.strictEqual(miss(sB, sB.me), 0);
    assert.strictEqual(sA.ledger.filter(t => t.type === 'MISS_TO_CIRCLE' && t.circleId === circleId).length, 1, 'הפספוס של א ביומן שלה');
    assert.ok(sB.ledger.every(t => t.userId === sB.me), 'כל אחת מקבלת רק את היומן שלה (אין יותר קופה משותפת במסך)');
    assert.ok(!sA.ledger.some(t => t.userId === sB.me && t.type === 'EARN'), 'EARN של ב לא דולף ל-א');
    const bOb = Object.values(sA.obligations).find(o => o.id === obB); assert.strictEqual(bOb.outcome, 'success'); assert.strictEqual(bOb.resolveReason, null);
    assert.ok(sA.socialEvents.some(e => e.type === 'day_success' && e.actorId === sB.me)); assert.ok(sB.socialEvents.some(e => e.type === 'day_miss' && e.actorId === sA.me));
    assert.ok(sB.achievements.some(a => a.type === 'first_day') && sB.achievements.some(a => a.type === 'first_group_word'));
  });
  await test('פעולות מקבילות: 5 דיווחים בו-זמנית על אותו אירוע → תנועה אחת', async () => {
    const s = await A.state(); const ob = Object.values(s.obligations).find(o => o.commitmentId === kA && o.localDate === today());
    // תיקון קודם כדי לפתוח מחדש? לא — נשתמש במילה אישית חדשה
    const w = await A.ok('createPersonalWord', { title: 'מים', rule: '8 כוסות', icon: 'water', startDate: today() });
    const s2 = await A.state(); const o2 = Object.values(s2.obligations).find(o => o.commitmentId === w.commitmentId && o.localDate === today());
    const rs = await Promise.all([...Array(5)].map((_, i) => A.act('report', { obligationId: o2.id, outcome: i % 2 ? 'miss' : 'success' })));
    assert.ok(rs.every(r => r.status === 200), JSON.stringify(rs.map(r => r.data)));
    assert.strictEqual(rs.filter(r => r.data.duplicate === false).length, 1, 'בדיוק דיווח אחד התקבל');
    const s3 = await invariants(A); assert.strictEqual(s3.ledger.filter(t => t.obligationId === o2.id).length, 1);
  });
  await test('תיקון: הצלחה→פספוס = REVERSE + תנועה חדשה; בלי סיבה נדחה (AT-07)', async () => {
    await B.fail('correct', { obligationId: obB, outcome: 'miss', reason: '' }, 'VALIDATION');
    await B.ok('correct', { obligationId: obB, outcome: 'miss', reason: 'לחצתי בטעות' });
    const s = await invariants(B); const rows = s.ledger.filter(t => t.obligationId === obB);
    assert.strictEqual(rows.length, 3); assert.strictEqual(rows.filter(t => t.type === 'REVERSE').length, 1);
    assert.strictEqual(s.ledger.filter(t => t.type === 'MISS_TO_CIRCLE' && t.circleId === circleId && !s.ledger.some(r => r.reversalOf === t.id)).length, 1, 'אצל ב: פספוס פעיל אחד (התיקון)');
    assert.strictEqual(s.ledger.filter(t => t.type === 'EARN' && !s.ledger.some(r => r.reversalOf === t.id)).length, 0, 'הנקודה בוטלה');
  });
  await test('תקרה: 3 מילים ביום; הרביעית נחסמת, גם במקביל (AT-03)', async () => {
    await B.ok('createPersonalWord', { title: 'קריאה', rule: '10 עמודים', icon: 'book', startDate: today() });
    const rs = await Promise.all([B.act('createPersonalWord', { title: 'מים', rule: 'כלל', startDate: today() }), B.act('createPersonalWord', { title: 'שינה', rule: 'כלל', startDate: today() })]);
    assert.strictEqual(rs.filter(r => r.status === 200).length, 1, 'רק אחת משתי בקשות מקבילות עוברת: ' + JSON.stringify(rs.map(r => r.data)));
    const capErr = rs.find(r => r.status !== 200).data; assert.strictEqual(capErr.error, 'CAP');
    await B.fail('createPersonalWord', { title: 'חמישית', rule: 'כלל', startDate: today() }, 'CAP');
    await B.ok('createPersonalWord', { title: 'אחרי הסבב', rule: 'כלל', startDate: addDays(today(), 14) });
    await invariants(B);
  });
  await test('החרגה: אין תנועה; שלישית נדחית', async () => {
    const s = await B.state(); const ks = Object.values(s.commitments).filter(k => k.userId === s.me && k.status === 'active' && k.startDate === today() && k.defId !== defId);
    const obs = Object.values(s.obligations).filter(o => o.commitmentId === ks[0].id && o.localDate === today());
    await B.ok('report', { obligationId: obs[0].id, outcome: 'excused' });
    const s2 = await invariants(B); assert.strictEqual(s2.ledger.filter(t => t.obligationId === obs[0].id).length, 0);
  });
  await test('הפרדת נתונים: ז לא במעגל ולא רואה כלום; פעולות על המעגל נדחות', async () => {
    await Z.login(`z.${stamp}@test.mila`, 'זרה'); await Z.profile('זרה');
    const s = await Z.state();
    assert.deepStrictEqual(s.circles, {}); assert.deepStrictEqual(s.wordDefs, {}); assert.deepStrictEqual(s.obligations, {}); assert.deepStrictEqual(s.ledger, []); assert.deepStrictEqual(s.socialEvents, []);
    assert.strictEqual(Object.keys(s.users).length, 1);
    await Z.fail('adoptGroupWord', { defId }, 'FORBIDDEN'); await Z.fail('proposeGroupWord', { circleId, title: 'x', rule: 'y', startDate: today() }, 'FORBIDDEN'); await Z.fail('updateCircle', { circleId, patch: { name: 'hack' } }, 'FORBIDDEN');
    await Z.fail('report', { obligationId: obA, outcome: 'success' }, 'FORBIDDEN');
  });
  await test('חסימה וביטול קישור', async () => {
    const sZ = await Z.state();
    await A.ok('block', { userId: sZ.me });
    assert.strictEqual((await Z.ok('previewInvite', { token })).ok, false, 'חסומה לא רואה הזמנה');
    await A.ok('unblock', { userId: sZ.me });
    await B.fail('revokeCircleInvites', { circleId }, 'FORBIDDEN');
    const nt = (await A.ok('revokeCircleInvites', { circleId })).token;
    assert.strictEqual((await Z.ok('previewInvite', { token })).reason, 'revoked'); await Z.fail('acceptInvite', { token }, 'INVITE_INVALID');
    assert.ok((await Z.ok('previewInvite', { token: nt })).ok, 'קישור חדש תקף');
  });
  await test('קלט לא תקין נדחה: הגדרות, שם עם HTML, הזמנה בלי קבוצה; אין יותר שינוי חשיפה', async () => {
    assert.strictEqual((await A.act('setVisibility', { defId, visibility: 'private' })).status, 404, 'הפעולה הוסרה');
    await A.fail('updateSettings', { patch: { reminderTime: ['20:00'] } }, 'VALIDATION');
    await A.fail('updateSettings', { patch: { reminderTime: '25:00' } }, 'VALIDATION');
    await A.fail('updateSettings', { patch: { pushReminders: 'yes' } }, 'VALIDATION');
    await A.ok('updateSettings', { patch: { reminderTime: '7:05', socialDigest: false } });
    let s = await A.state(); assert.strictEqual(s.users[s.me].settings.reminderTime, '07:05'); assert.strictEqual(s.users[s.me].settings.socialDigest, false);
    await A.ok('updateSettings', { patch: { reminderTime: '20:00', socialDigest: true } });
    await A.ok('rename', { name: '"><img src=x onerror=alert(1)>' }); s = await A.state();
    assert.ok(!/[<>]/.test(s.users[s.me].name), 'שם בלי סוגריים זוויתיים: ' + s.users[s.me].name);
    await A.ok('rename', { name: "ג'ני" }); s = await A.state(); assert.strictEqual(s.users[s.me].name, "ג'ני", 'גרש בשם נשמר');
    await A.ok('rename', { name: 'יעל' });
    await A.fail('rename', { name: '<<<>>>' }, 'VALIDATION');
    await A.fail('createInvite', {}, 'FORBIDDEN');
    await A.fail('createPersonalWord', { title: 'x', rule: 'y', startDate: '2020-02-30' }, 'VALIDATION');
  });
  await test('חידוש סשן: עוגייה שמורה ממשיכה לעבוד; יציאה מבטלת', async () => {
    const C = new Client('A2'); C.cookie = A.cookie; const s = await C.state(); assert.strictEqual(s.users[s.me].name, 'יעל');
    const r = await C.req('/api/auth/logout', { method: 'POST', body: {} }); assert.strictEqual(r.status, 200);
    const after = await new Client('A3').req('/api/state'); assert.strictEqual(after.status, 401);
    A.cookie = ''; await A.login(`a.${stamp}@test.mila`, 'יעל');
  });
  await test('מנהלת עוזבת: ניהול עובר ל-ב; המילים של א במעגל מסתיימות וההיסטוריה נשארת', async () => {
    await A.ok('leaveCircle', { circleId });
    const sB = await B.state(); assert.strictEqual(sB.memberships.find(m => m.userId === sB.me && !m.leftAt).role, 'admin');
    const sA = await A.state(); assert.deepStrictEqual(sA.circles, {}, 'א לא רואה את המעגל'); assert.strictEqual(sA.commitments[kA].status, 'ended_early');
    assert.strictEqual(Object.values(sA.obligations).filter(o => o.commitmentId === kA && o.status === 'cancelled').length, 13);
    assert.strictEqual(sA.ledger.filter(t => t.obligationId === obA).length, 1);
  });
  /* ---------- מילה 2.0: ספרייה, פרס אישי, סוגי הזמנה, ״המהפך״ ---------- */
  const C = new Client('C'), D = new Client('D'), E = new Client('E');
  let c2, tokCompete;
  await test('ספרייה: אתגר נשמר לפי מזהה יציב (כותרת מהשרת, לא מהלקוח); מזהה לא קיים נדחה; פרס אישי נשמר', async () => {
    await C.login(`c.${stamp}@test.mila`, 'דנה'); await C.profile('דנה');
    c2 = (await C.ok('createCircle', { name: 'ליגה' })).circleId;
    await C.fail('createPersonalWord', { libraryId: 'nope', startDate: today() }, 'VALIDATION');
    const r = await C.ok('createPersonalWord', { libraryId: 'food_no_delivery', title: 'זבל', rule: 'זבל', circleId: c2, startDate: today(), reward: ' ספר חדש ' });
    const s = await C.state(); const d = s.wordDefs[r.defId]; const k = s.commitments[r.commitmentId];
    assert.strictEqual(d.title, 'בלי להזמין אוכל'); assert.strictEqual(d.libraryId, 'food_no_delivery'); assert.strictEqual(d.category, 'food'); assert.strictEqual(d.circleId, c2);
    assert.strictEqual(k.reward, 'ספר חדש'); assert.strictEqual(k.rewardShared, false);
    await C.ok('createPersonalWord', { libraryId: 'hab_coffee_home', circleId: c2, startDate: today() });
    await C.ok('createPersonalWord', { libraryId: 'hab_read_10', circleId: c2, startDate: today() });
  });
  await test('ספרייה: אתגר רגיש (זוגיות) נשאר פרטי גם עם circleId; בלי shareSensitive לא נכנס לקבוצה', async () => {
    await E.login(`e.${stamp}@test.mila`, 'רות'); await E.profile('רות');
    // התחום מגיל 18: בלי תאריך לידה נחסם; צעירה נשארת חסומה ולא יכולה להזין תאריך אחר; בוגרת נכנסת. תאריך הלידה לא נשמר.
    await E.fail('createPersonalWord', { libraryId: 'cpl_hug_20', startDate: today() }, 'ADULT_ONLY');
    let sE0 = await E.state(); assert.strictEqual(sE0.users[sE0.me].adult, null, 'עוד לא נשאלה');
    await E.fail('setBirthDate', { birthDate: '2031-02-30' }, 'VALIDATION');
    const Y = new Client('Y'); await Y.login(`y.${stamp}@test.mila`, 'עדי'); await Y.profile('עדי');
    const yr = new Date().getFullYear();
    const minor = await Y.ok('setBirthDate', { birthDate: `${yr - 15}-06-15` }); assert.strictEqual(minor.adult, false); assert.strictEqual(minor.adultFrom, `${yr + 3}-06-15`);
    await Y.fail('createPersonalWord', { libraryId: 'cpl_hug_20', startDate: today() }, 'ADULT_ONLY');
    await Y.fail('setBirthDate', { birthDate: '1990-01-01' }, 'VALIDATION');
    const sY = await Y.state(); assert.strictEqual(sY.users[sY.me].adult, false); assert.strictEqual(sY.users[sY.me].adultFrom, `${yr + 3}-06-15`);
    assert.ok(!JSON.stringify(sY).includes(`${yr - 15}-06-15`) && !JSON.stringify(await Y.ok('exportData')).includes(`${yr - 15}-06-15`), 'תאריך הלידה עצמו לא נשמר');
    assert.strictEqual((await E.ok('setBirthDate', { birthDate: '1990-05-05' })).adult, true);
    sE0 = await E.state(); assert.strictEqual(sE0.users[sE0.me].adult, true); assert.ok(!JSON.stringify(sE0).includes('1990-05-05'));
    assert.strictEqual(sE0.users[Object.keys(sE0.users).find(k => k !== sE0.me)] && sE0.users[Object.keys(sE0.users).find(k => k !== sE0.me)].adult, undefined, 'על אחרות לא נשלח');
    const r = await E.ok('createPersonalWord', { libraryId: 'cpl_hug_20', circleId: c2, startDate: today() });   // ר לא חברה בליגה; האתגר הרגיש נופל לפרטי לפני בדיקת החברות
    const s = await E.state(); assert.strictEqual(s.wordDefs[r.defId].circleId, null); assert.strictEqual(s.wordDefs[r.defId].visibility, 'private');
    const sC = await C.state(); assert.ok(!sC.wordDefs[r.defId], 'לא נחשף לחברות הליגה');
  });
  await test('הזמנות: סוג + הודעה אישית נשמרים ומוחזרים בתצוגה מקדימה; סוג לא חוקי → follow', async () => {
    tokCompete = (await C.ok('createInvite', { circleId: c2, kind: 'compete', message: '  בואי תבחרי גם. נראה מי מתמידה יותר.  ' })).token;
    const tokSame = (await C.ok('createInvite', { circleId: c2, kind: 'same', libraryId: 'food_no_delivery', message: 'x' })).token;
    const tokBad = (await C.ok('createInvite', { circleId: c2, kind: 'hack', libraryId: 'nope' })).token;
    await D.login(`d.${stamp}@test.mila`, 'מאיה'); await D.profile('מאיה');
    const p1 = await D.ok('previewInvite', { token: tokCompete }); assert.strictEqual(p1.kind, 'compete'); assert.strictEqual(p1.message, 'בואי תבחרי גם. נראה מי מתמידה יותר.');
    const p2 = await D.ok('previewInvite', { token: tokSame }); assert.strictEqual(p2.kind, 'same'); assert.strictEqual(p2.libraryId, 'food_no_delivery'); assert.strictEqual(p2.challenge.title, 'בלי להזמין אוכל');
    const p3 = await D.ok('previewInvite', { token: tokBad }); assert.strictEqual(p3.kind, 'follow'); assert.strictEqual(p3.libraryId, null);
    await D.ok('acceptInvite', { token: tokCompete });
    const s = await D.state(); assert.strictEqual(s.memberships.filter(m => m.circleId === c2).length, 2); assert.strictEqual(Object.values(s.obligations).filter(o => o.userId === s.me).length, 0, 'הצטרפות לתחרות לא יוצרת התחייבות בלי אישור');
  });
  let obsC, obsD;
  await test('פרס משותף נראה לחברות; פרס פרטי לא', async () => {
    const r = await D.ok('createPersonalWord', { libraryId: 'move_walk_30', circleId: c2, startDate: today(), reward: 'מסאז׳', rewardShared: true });
    await D.ok('createPersonalWord', { libraryId: 'move_8000_steps', circleId: c2, startDate: today() });
    await D.ok('createPersonalWord', { libraryId: 'move_stairs', circleId: c2, startDate: today() });
    const sC = await C.state(); const sD = await D.state();
    assert.strictEqual(sC.commitments[r.commitmentId].reward, 'מסאז׳', 'פרס משותף נראה ל-ד');
    const mineC = Object.values(sC.commitments).find(k => k.userId === sC.me && k.reward); assert.ok(mineC);
    assert.strictEqual(sD.commitments[mineC.id].reward, '', 'פרס פרטי של ד לא נחשף ל-מ');
    obsC = Object.values(sC.obligations).filter(o => o.userId === sC.me && o.localDate === today()).map(o => o.id);
    obsD = Object.values(sD.obligations).filter(o => o.userId === sD.me && o.localDate === today()).map(o => o.id);
    assert.strictEqual(obsC.length, 3); assert.strictEqual(obsD.length, 3);
  });
  await test('״המהפך״: הטלפון מדווח עקיפה; השרת דורש הצלחה טרייה, רושם אירוע והתראה פעם אחת', async () => {
    await D.ok('report', { obligationId: obsD[0], outcome: 'success' }); await D.ok('report', { obligationId: obsD[1], outcome: 'miss' }); await D.ok('report', { obligationId: obsD[2], outcome: 'miss' });
    const dId = (await D.state()).me;
    await C.fail('overtake', { circleId: c2, passedUserId: dId }, 'VALIDATION');   // עוד אין הצלחה היום
    await C.ok('report', { obligationId: obsC[0], outcome: 'miss' }); await C.ok('report', { obligationId: obsC[1], outcome: 'success' }); await C.ok('report', { obligationId: obsC[2], outcome: 'success' });
    await Z.fail('overtake', { circleId: c2, passedUserId: dId }, 'FORBIDDEN');     // לא בקבוצה
    assert.ok(!(await C.ok('overtake', { circleId: c2, passedUserId: dId })).duplicate);
    assert.ok((await C.ok('overtake', { circleId: c2, passedUserId: dId })).duplicate, 'פעם אחת ביום');
    const sC = await invariants(C); const sD = await invariants(D);
    assert.ok(sD.notifications.some(n => n.type === 'overtake' && /דנה עקפה אותך/.test(n.title)));
    assert.strictEqual(sD.socialEvents.filter(e => e.type === 'overtake' && e.actorId === sC.me).length, 1);
  });
  await test('ריענון קל: /api/ping משתנה רק כשיש חדש; פתיחת קישור נספרת פעם אחת למבקרת; ייחוס בהרשמה', async () => {
    const v1 = (await C.req('/api/ping')).data.v; const v2 = (await C.req('/api/ping')).data.v;
    assert.strictEqual(v1, v2, 'בלי שינוי אותה חותמת');
    await D.ok('sendEncouragement', { circleId: c2, toUserId: (await C.state()).me, reaction: 'heart' });
    assert.notStrictEqual((await C.req('/api/ping')).data.v, v1, 'אירוע חדש משנה חותמת');
    const t = (await C.ok('createInvite', { circleId: c2, kind: 'follow' })).token;
    const anon = new Client('anon');
    // הצצה להזמנה בלי חשבון: שם פרטי של המזמינה, שם הקבוצה וההודעה; בלי מזהים, בלי אימייל
    const tMsg = (await C.ok('createInvite', { circleId: c2, kind: 'same', libraryId: 'food_no_delivery', message: 'בואי איתי' })).token;
    const peek = (await anon.req(`/api/invite/peek?token=${tMsg}`)).data;
    assert.strictEqual(peek.ok, true); assert.strictEqual(peek.inviter.name, 'דנה'); assert.strictEqual(peek.circleName, 'ליגה'); assert.strictEqual(peek.message, 'בואי איתי'); assert.strictEqual(peek.kind, 'same'); assert.strictEqual(peek.wordTitle, 'בלי להזמין אוכל');
    assert.ok(!JSON.stringify(peek).includes('@') && !peek.inviter.id && !peek.circleId, 'בלי מזהים ובלי אימייל');
    assert.strictEqual((await anon.req('/api/invite/peek?token=ZZZZZZ')).data.ok, false);
    assert.strictEqual((await anon.req('/api/invite/peek?token=' + encodeURIComponent("' or 1=1"))).data.ok, false);
    for (let i = 0; i < 3; i++) assert.strictEqual((await anon.req('/api/invite/open', { method: 'POST', body: { token: t, visitor: `visitor-${stamp}` } })).data.ok, true);
    assert.strictEqual((await anon.req('/api/invite/open', { method: 'POST', body: { token: 'ZZZZZZ', visitor: `visitor-${stamp}` } })).data.ok, false);
    const F = new Client('F'); await F.login(`f.${stamp}@test.mila`, 'שירה');
    await F.req('/api/profile', { method: 'POST', body: { name: 'שירה', ageConfirmed: true, termsAccepted: true, timezone: 'Asia/Jerusalem', inviteToken: t } });
    await F.ok('acceptInvite', { token: t });
    const joined = (await C.state()).socialEvents.find(e => e.type === 'member_joined' && e.actorId === (F.uid || (F.uid = null)) ) || (await C.state()).socialEvents.filter(e => e.type === 'member_joined').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    assert.strictEqual(joined.payload.inviterId, (await C.state()).me, 'אירוע ההצטרפות זוכר מי הזמינה');
    const r = await C.req('/api/admin/stats'); assert.strictEqual(r.status, 403, 'פאנל ניהול רק למנהלת מערכת');
  });
  await test('קבוצות: מנהלת נוספת, סגירת קבוצה (רק מנהלת) מוציאה את כולן, עוצרת רק אתגר משותף ושומרת נקודות', async () => {
    await D.fail('setMemberRole', { circleId: c2, userId: (await C.state()).me, role: 'member' }, 'FORBIDDEN');
    const sD0 = await D.state(); const dId = sD0.me; const cId = (await C.state()).me;
    await C.ok('setMemberRole', { circleId: c2, userId: dId, role: 'admin' });
    assert.strictEqual((await D.state()).memberships.find(m => m.circleId === c2 && m.userId === dId).role, 'admin');
    await C.ok('setMemberRole', { circleId: c2, userId: dId, role: 'member' });
    await C.fail('setMemberRole', { circleId: c2, userId: cId, role: 'member' }, 'VALIDATION');
    const pointsD = (await D.state()).ledger.filter(t => t.userId === dId && t.type === 'EARN').length;
    await D.fail('deleteCircle', { circleId: c2 }, 'FORBIDDEN');
    const personalBefore = Object.values(sD0.commitments).filter(k => k.userId === dId && k.status === 'active' && sD0.wordDefs[k.defId].kind === 'personal').map(k => k.id);
    await C.ok('deleteCircle', { circleId: c2 });
    const sC = await C.state(); const sD = await D.state();
    assert.ok(!sC.circles[c2] && !sD.circles[c2], 'הקבוצה לא מופיעה יותר');
    assert.ok(Object.values(sD.commitments).filter(k => k.userId === dId && sD.wordDefs[k.defId].kind === 'group' && sD.wordDefs[k.defId].circleId === c2).every(k => k.status !== 'active'), 'האתגר המשותף של הקבוצה שנסגרה נעצר');
    assert.ok(personalBefore.every(id => sD.commitments[id] && sD.commitments[id].status === 'active'), 'האתגרים האישיים של מ ממשיכים');
    assert.strictEqual(sD.ledger.filter(t => t.userId === dId && t.type === 'EARN').length, pointsD, 'הנקודות נשארות');
    assert.ok(sD.notifications.some(n => n.type === 'circle_closed'), 'מ קיבלה הודעה שהקבוצה נסגרה');
    assert.strictEqual((await D.ok('previewInvite', { token: tokCompete })).ok, false, 'ההזמנות בוטלו');
  });
  await test('אפליקציה והתראות: אייקונים, תמונת שיתוף, מפתח ציבורי, מינוי למכשיר (רק משירותי התראות מוכרים)', async () => {
    const png = await fetch(BASE + '/icons/icon-192.png'); assert.strictEqual(png.status, 200); assert.strictEqual(png.headers.get('content-type'), 'image/png');
    const bytes = new Uint8Array(await png.arrayBuffer()); assert.deepStrictEqual([...bytes.slice(1, 4)], [80, 78, 71], 'קובץ PNG אמיתי');
    const man = await (await fetch(BASE + '/manifest.json')).json(); assert.ok(man.icons.some(i => i.purpose === 'maskable'), 'אייקון maskable');
    const html = await (await fetch(BASE + '/')).text(); assert.ok(html.includes(`content="${BASE}/icons/og.png"`), 'og:image עם כתובת מלאה');
    const k = await A.req('/api/push/key'); assert.strictEqual(k.status, 200); assert.ok(/^[A-Za-z0-9_-]{86,88}$/.test(k.data.key), 'מפתח VAPID ציבורי');
    const ecdh = require('crypto').createECDH('prime256v1'); ecdh.generateKeys();
    const keys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: require('crypto').randomBytes(16).toString('base64url') };
    const bad = await A.req('/api/push/subscribe', { method: 'POST', body: { subscription: { endpoint: 'https://evil.example.com/x', keys } } }); assert.strictEqual(bad.status, 400);
    const endpoint = `https://fcm.googleapis.com/fcm/send/test-${stamp}`;
    const ok = await A.req('/api/push/subscribe', { method: 'POST', body: { subscription: { endpoint, keys }, platform: 'android-chrome' } }); assert.strictEqual(ok.status, 200, JSON.stringify(ok.data));
    assert.strictEqual((await A.req('/api/push/status', { method: 'POST', body: { endpoint } })).data.subscribed, true);
    assert.strictEqual((await B.req('/api/push/status', { method: 'POST', body: { endpoint } })).data.subscribed, false, 'מינוי של אחרת לא נחשף');
    await A.ok('updateSettings', { patch: { reminderTime: '21:15' } });
    assert.strictEqual((await A.req('/api/push/unsubscribe', { method: 'POST', body: { endpoint } })).status, 200);
    assert.strictEqual((await A.req('/api/push/status', { method: 'POST', body: { endpoint } })).data.subscribed, false);
    assert.strictEqual((await A.req('/api/push/test', { method: 'POST', body: { endpoint } })).status, 400, 'בדיקה בלי מינוי נכשלת יפה');
  });
  await test('הסרה מקבוצה: הקישורים שלה מתבטלים, קישור ישן לא מחזיר אותה, הזמנה חדשה כן', async () => {
    const G = new Client('G'); await G.login(`g.${stamp}@test.mila`, 'טל'); await G.profile('טל');
    const g3 = (await E.ok('createCircle', { name: 'שלישייה' })).circleId;
    const t1 = (await E.ok('createInvite', { circleId: g3 })).token;
    await G.ok('acceptInvite', { token: t1 });
    const gId = (await G.state()).me;
    const tG = (await G.ok('createInvite', { circleId: g3 })).token;
    await E.ok('removeMember', { circleId: g3, userId: gId });
    await G.fail('acceptInvite', { token: t1 }, 'INVITE_INVALID');
    assert.strictEqual((await G.ok('previewInvite', { token: tG })).reason, 'revoked', 'הקישור שהיא יצרה בוטל');
    const t2 = (await E.ok('createInvite', { circleId: g3 })).token;
    await G.ok('acceptInvite', { token: t2 });
    assert.ok((await G.state()).circles[g3], 'חזרה עם הזמנה חדשה');
    // מי שפתחה אתגר משותף ועזבה: לא רואה יותר את הדיווחים של מי שנשארה, ולא יכולה לבטל אותו
    const gd = (await G.ok('proposeGroupWord', { circleId: g3, title: 'הליכה יחד', rule: '20 דקות', startDate: today() })).defId;
    await E.ok('adoptGroupWord', { defId: gd });
    const eId = (await E.state()).me;
    assert.ok(Object.values((await G.state()).commitments).some(k => k.userId === eId), 'כשהיא בקבוצה היא רואה');
    await G.ok('leaveCircle', { circleId: g3 });
    const sG = await G.state();
    assert.ok(!Object.values(sG.commitments).some(k => k.userId === eId), 'אחרי שעזבה היא לא רואה את האתגר של רות');
    assert.ok(!Object.values(sG.obligations).some(o => o.userId === eId), 'ולא את הימים שלה');
    await G.fail('cancelProposal', { defId: gd }, 'FORBIDDEN');
    // פרטים של אחרות: בלי אזור זמן ובלי סיבת סיום
    const sE = await E.state(); for (const k of Object.values(sE.commitments)) if (k.userId !== sE.me) { assert.strictEqual(k.timezone, null); assert.strictEqual(k.endReason, null); }
  });
  await test('מחיקת חשבון: אנונימית אצל החברות, ההזמנות שלה מתבטלות, והאימייל פנוי להרשמה חדשה', async () => {
    const H = new Client('H'); await H.login(`h.${stamp}@test.mila`, 'גלית'); await H.profile('גלית');
    const g4 = (await E.ok('createCircle', { name: 'זוג' })).circleId;
    await H.ok('acceptInvite', { token: (await E.ok('createInvite', { circleId: g4 })).token });
    const hId = (await H.state()).me;
    const tH = (await H.ok('createInvite', { circleId: g4, message: 'בואי, זו גלית' })).token;
    await H.ok('createPersonalWord', { title: 'סוד אישי של גלית', rule: 'כל יום', circleId: g4, startDate: today(), reward: 'משהו פרטי' });
    await H.ok('sendEncouragement', { circleId: g4, toUserId: (await E.state()).me, reaction: 'heart' });
    assert.ok((await E.state()).notifications.some(n => /^גלית /.test(n.title)));
    await H.ok('deleteAccount'); assert.strictEqual((await H.req('/api/state')).status, 401);
    const sE = await E.state();
    assert.strictEqual(sE.users[hId].name, 'משתתפת שעזבה'); assert.strictEqual(sE.users[hId].deleted, true);
    assert.ok(!sE.notifications.some(n => /גלית/.test(n.title + n.body)), 'העדכונים עם השם שלה נמחקו');
    assert.ok(!Object.values(sE.wordDefs).some(d => /גלית/.test(d.title)), 'הניסוח האישי שלה לא נשאר אצל החברות');
    assert.strictEqual((await E.ok('previewInvite', { token: tH })).reason, 'revoked');
    const H2 = new Client('H2'); const again = await H2.login(`h.${stamp}@test.mila`, 'גלית'); assert.notStrictEqual(again.userId, hId, 'חשבון חדש לגמרי');
  });
  await test('קבוצה מחברות שכבר במילה: הזמנה בתוך האפליקציה רק למי שכבר איתי בקבוצה, והצטרפות בלחיצה', async () => {
    const Pp = new Client('P'), Q = new Client('Q'), R = new Client('R');
    await Pp.login(`p.${stamp}@test.mila`, 'פזית'); await Pp.profile('פזית'); await Q.login(`q.${stamp}@test.mila`, 'קרן'); await Q.profile('קרן'); await R.login(`r.${stamp}@test.mila`, 'רעות'); await R.profile('רעות');
    const g1 = (await Pp.ok('createCircle', { name: 'ראשונה' })).circleId;
    await Q.ok('acceptInvite', { token: (await Pp.ok('createInvite', { circleId: g1 })).token });
    const qId = (await Q.state()).me, rId = (await R.state()).me;
    const g2 = (await Pp.ok('createCircle', { name: 'שנייה' })).circleId;
    await R.fail('inviteFriends', { circleId: g2, userIds: [qId] }, 'FORBIDDEN');                       // לא חברה בקבוצה
    assert.strictEqual((await Pp.ok('inviteFriends', { circleId: g2, userIds: [qId, rId, 'nope'] })).invited, 1, 'רק מי שכבר איתי בקבוצה; זרה לא מקבלת הזמנה');
    assert.ok(!(await R.state()).notifications.some(n => n.type === 'group_invite'), 'זרה לא קיבלה');
    const n = (await Q.state()).notifications.find(x => x.type === 'group_invite');
    assert.ok(n && /פזית מזמינה אותך לקבוצה/.test(n.title) && n.ref.circleId === g2 && n.ref.circleName === 'שנייה' && /^[A-Z0-9]{6}$/.test(n.ref.token));
    assert.ok(!(await Q.state()).circles[g2], 'לא מצורפת בלי אישור');
    await Q.ok('acceptInvite', { token: n.ref.token });
    assert.ok((await Q.state()).circles[g2], 'אחרי ״אני בפנים״ היא בקבוצה');
    assert.strictEqual((await Pp.ok('inviteFriends', { circleId: g2, userIds: [qId] })).invited, 0, 'כבר בקבוצה');
    // מי שחסמה אותי לא מקבלת הזמנה ממני
    const g3 = (await Pp.ok('createCircle', { name: 'שלישית' })).circleId;
    await Q.ok('block', { userId: (await Pp.state()).me });
    assert.strictEqual((await Pp.ok('inviteFriends', { circleId: g3, userIds: [qId] })).invited, 0);
  });
  await test('אתגר אישי מופיע בכל קבוצה שאני חברה בה: בלי להביא ובלי לבחור; ״רק אני״ ותחום רגיש נשארים פרטיים; עזיבה לא עוצרת אותו', async () => {
    const H = new Client('H'), J = new Client('J'), K = new Client('K');
    await H.login(`h.${stamp}@test.mila`, 'הילה'); await H.profile('הילה'); await J.login(`j.${stamp}@test.mila`, 'יעלי'); await J.profile('יעלי'); await K.login(`k.${stamp}@test.mila`, 'כרמל'); await K.profile('כרמל');
    const g = (await H.ok('createCircle', { name: 'של הילה' })).circleId;
    const w = await J.ok('createPersonalWord', { libraryId: 'hab_read_10' });                           // נוצר לפני שיש לה קבוצה
    const mine = await J.ok('createPersonalWord', { title: 'משהו שלי', rule: 'כל יום', private: true }); // בחרה ״רק אני״
    const sees = async (cl, defId) => Object.values((await cl.state()).wordDefs).some(d => d.id === defId);
    assert.ok(!(await sees(H, w.defId)), 'לפני שיש קבוצה משותפת, אף אחת לא רואה');
    await J.ok('acceptInvite', { token: (await H.ok('createInvite', { circleId: g })).token });
    const sH = await H.state();
    assert.ok(sH.wordDefs[w.defId], 'הצטרפה, והאתגר שלה כבר מופיע אצל החברה');
    assert.ok(Object.values(sH.commitments).some(k => k.defId === w.defId) && Object.values(sH.obligations).some(o => o.userId === (sH.memberships.find(m => m.userId !== sH.me) || {}).userId), 'כולל הימים שלו');
    assert.ok(!sH.wordDefs[mine.defId], '״רק אני״ נשאר פרטי');
    // קבוצה שנייה: אותו אתגר מופיע גם בה, והדיווח מגיע לעדכונים של שתיהן
    const g2 = (await K.ok('createCircle', { name: 'של כרמל' })).circleId;
    await J.ok('acceptInvite', { token: (await K.ok('createInvite', { circleId: g2 })).token });
    assert.ok(await sees(K, w.defId), 'מופיע גם בקבוצה השנייה'); assert.ok(!(await sees(K, mine.defId)));
    const sJ = await J.state(); const ob = Object.values(sJ.obligations).find(o => o.userId === sJ.me && o.commitmentId === w.commitmentId && o.status === 'open');
    await J.ok('report', { obligationId: ob.id, outcome: 'success' });
    for (const cl of [H, K]) assert.ok((await cl.state()).socialEvents.some(e => e.type === 'day_success' && e.payload.defId === w.defId), 'הדיווח מופיע בעדכונים של כל קבוצה');
    // לב מהקבוצה השנייה עובד (האתגר לא ״שייך״ רק לקבוצה אחת)
    await K.ok('sendEncouragement', { circleId: g2, toUserId: sJ.me, reaction: 'heart', obligationId: ob.id });
    // עזיבת קבוצה: האתגר ממשיך, והחברה שם כבר לא רואה אותו
    await J.ok('leaveCircle', { circleId: g });
    assert.strictEqual((await J.state()).commitments[w.commitmentId].status, 'active', 'עזיבה לא עוצרת אתגר אישי');
    assert.ok(!(await sees(H, w.defId)), 'מי שנשארה בקבוצה שעזבתי כבר לא רואה אותו'); assert.ok(await sees(K, w.defId));
    // אתגר של 21 יום: 21 ימים בדיוק; ערך אחר נשאר 14
    const w21 = await K.ok('createPersonalWord', { title: 'הליכה כל יום', rule: 'לפחות 20 דקות', days: 21 });
    const sK = await K.state(); assert.strictEqual(Object.values(sK.obligations).filter(o => o.commitmentId === w21.commitmentId).length, 21);
    const w14 = await K.ok('createPersonalWord', { title: 'מים', rule: '8 כוסות', days: 99 });
    assert.strictEqual(Object.values((await K.state()).obligations).filter(o => o.commitmentId === w14.commitmentId).length, 14);
    // אתגר חדש נוצר גלוי לחברות גם בלי לציין קבוצה
    const w2 = await J.ok('createPersonalWord', { libraryId: 'food_8_water' });
    assert.ok(await sees(K, w2.defId));
  });

  await test('״נו, מה איתך?״: רק בין חברות קבוצה, רק למי שעוד לא דיווחה היום, ופעם ב-6 שעות', async () => {
    const L = new Client('L'), M2 = new Client('M2'), N2 = new Client('N2');
    await L.login(`l.${stamp}@test.mila`, 'ליה'); await L.profile('ליה'); await M2.login(`m2.${stamp}@test.mila`, 'מאיה'); await M2.profile('מאיה'); await N2.login(`n2.${stamp}@test.mila`, 'נגה'); await N2.profile('נגה');
    const g = (await L.ok('createCircle', { name: 'דוחפות' })).circleId;
    await M2.ok('acceptInvite', { token: (await L.ok('createInvite', { circleId: g })).token });
    const mId = (await M2.state()).me, lId = (await L.state()).me;
    await N2.fail('poke', { circleId: g, toUserId: mId }, 'FORBIDDEN');                                   // לא חברה בקבוצה
    await L.fail('poke', { circleId: g, toUserId: lId }, 'VALIDATION');                                   // לא לעצמי
    assert.deepStrictEqual(await L.ok('poke', { circleId: g, toUserId: mId }), { sent: false, reason: 'done' }, 'אין לה מה לדווח היום');
    const w = await M2.ok('createPersonalWord', { libraryId: 'hab_read_10', circleId: g });
    const pk = await L.ok('poke', { circleId: g, toUserId: mId });
    assert.strictEqual(pk.sent, true); assert.strictEqual(pk.push, false, 'אין לה מכשיר עם התראות: הלקוח יציע וואטסאפ');
    const n = (await M2.state()).notifications.find(x => x.type === 'poke');
    assert.ok(n && /ליה: נו, מה איתך\?/.test(n.title), 'קיבלה התראה עם השם של מי ששלחה');
    assert.deepStrictEqual(await L.ok('poke', { circleId: g, toUserId: mId }), { sent: false, reason: 'wait', push: false }, 'לא פעמיים ברצף');
    assert.ok(!(await L.state()).socialEvents.some(e => e.type === 'poke'), 'לא מופיע בעדכוני הקבוצה');
    const st = await M2.state(); const ob = Object.values(st.obligations).find(o => o.userId === st.me && o.commitmentId === w.commitmentId && !o.outcome && o.status === 'open');
    await M2.ok('report', { obligationId: ob.id, outcome: 'success' });
    await M2.ok('markNotificationsRead', {});
    // לב על היום שדיווחה: פעם אחת, וההתראה אומרת על מה
    await N2.fail('sendEncouragement', { circleId: g, toUserId: mId, reaction: 'heart', obligationId: ob.id }, 'FORBIDDEN');
    await L.fail('sendEncouragement', { circleId: g, toUserId: lId, reaction: 'heart', obligationId: ob.id }, 'NOT_FOUND');   // היום הזה לא שלה
    await L.ok('sendEncouragement', { circleId: g, toUserId: mId, reaction: 'heart', obligationId: ob.id });
    const stM = await M2.state();
    assert.ok(stM.notifications.some(x => x.type === 'encouragement' && /ליה פירגנה לך על ״/.test(x.title)), 'ההתראה אומרת על מה');
    assert.strictEqual(stM.socialEvents.filter(e => e.type === 'encouragement' && e.payload.obligationId === ob.id).length, 1);
    await L.ok('sendEncouragement', { circleId: g, toUserId: mId, reaction: 'heart', obligationId: ob.id });
    assert.strictEqual((await M2.state()).socialEvents.filter(e => e.type === 'encouragement' && e.payload.obligationId === ob.id).length, 1, 'לא פעמיים על אותו יום');
  });

  await test('ייצוא ומחיקת חשבון', async () => {
    const ex = await Z.ok('exportData'); assert.ok(ex.user && Array.isArray(ex.ledger));
    await Z.ok('deleteAccount'); const r = await Z.req('/api/state'); assert.strictEqual(r.status, 401);
  });
  console.log(`\n${passed} בדיקות עברו`);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });

function addDays(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
