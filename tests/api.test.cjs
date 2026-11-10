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
    const bad = await A.req('/api/profile', { method: 'POST', body: { name: 'יעל', ageConfirmed: false, termsAccepted: true } }); assert.strictEqual(bad.status, 400, 'מגבלת גיל');
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
  await test('חשיפה רק מצטמצמת', async () => { await A.ok('setVisibility', { defId, visibility: 'summary' }); await A.fail('setVisibility', { defId, visibility: 'status' }, 'VALIDATION'); });
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
    for (let i = 0; i < 3; i++) assert.strictEqual((await anon.req('/api/invite/open', { method: 'POST', body: { token: t, visitor: `visitor-${stamp}` } })).data.ok, true);
    assert.strictEqual((await anon.req('/api/invite/open', { method: 'POST', body: { token: 'ZZZZZZ', visitor: `visitor-${stamp}` } })).data.ok, false);
    const F = new Client('F'); await F.login(`f.${stamp}@test.mila`, 'שירה');
    await F.req('/api/profile', { method: 'POST', body: { name: 'שירה', ageConfirmed: true, termsAccepted: true, timezone: 'Asia/Jerusalem', inviteToken: t } });
    await F.ok('acceptInvite', { token: t });
    const r = await C.req('/api/admin/stats'); assert.strictEqual(r.status, 403, 'פאנל ניהול רק למנהלת מערכת');
  });
  await test('קבוצות: מנהלת נוספת, הסרה עוצרת אתגרים, סגירת קבוצה (רק מנהלת) מוציאה את כולן ושומרת נקודות', async () => {
    await D.fail('setMemberRole', { circleId: c2, userId: (await C.state()).me, role: 'member' }, 'FORBIDDEN');
    const sD0 = await D.state(); const dId = sD0.me; const cId = (await C.state()).me;
    await C.ok('setMemberRole', { circleId: c2, userId: dId, role: 'admin' });
    assert.strictEqual((await D.state()).memberships.find(m => m.circleId === c2 && m.userId === dId).role, 'admin');
    await C.ok('setMemberRole', { circleId: c2, userId: dId, role: 'member' });
    await C.fail('setMemberRole', { circleId: c2, userId: cId, role: 'member' }, 'VALIDATION');
    const pointsD = (await D.state()).ledger.filter(t => t.userId === dId && t.type === 'EARN').length;
    await D.fail('deleteCircle', { circleId: c2 }, 'FORBIDDEN');
    await C.ok('deleteCircle', { circleId: c2 });
    const sC = await C.state(); const sD = await D.state();
    assert.ok(!sC.circles[c2] && !sD.circles[c2], 'הקבוצה לא מופיעה יותר');
    assert.ok(Object.values(sD.commitments).filter(k => k.userId === dId).every(k => k.status !== 'active'), 'האתגרים של מ בקבוצה נעצרו');
    assert.strictEqual(sD.ledger.filter(t => t.userId === dId && t.type === 'EARN').length, pointsD, 'הנקודות נשארות');
    assert.ok(sD.notifications.some(n => n.type === 'circle_closed'), 'מ קיבלה הודעה שהקבוצה נסגרה');
    assert.strictEqual((await D.ok('previewInvite', { token: tokCompete })).ok, false, 'ההזמנות בוטלו');
  });
  await test('ייצוא ומחיקת חשבון', async () => {
    const ex = await Z.ok('exportData'); assert.ok(ex.user && Array.isArray(ex.ledger));
    await Z.ok('deleteAccount'); const r = await Z.req('/api/state'); assert.strictEqual(r.status, 401);
  });
  console.log(`\n${passed} בדיקות עברו`);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });

function addDays(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
