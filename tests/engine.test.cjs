/* בדיקות מנוע — node tests/engine.test.js
   מריץ את engine.js ו-demo.js בסביבת Node עם shim ל-localStorage ובודק את חוקי המשחק
   ואת תרחישי הקבלה (AT-02, AT-03, AT-04, AT-05, AT-06, AT-07, AT-08, AT-09, AT-12, AT-13, AT-20). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.location = { origin: 'http://localhost', pathname: '/' };
for (const f of ['public/js/library.js', 'public/js/engine.js', 'public/js/demo.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); } }
/* שעון קבוע: היום ב-12:00 (אחרי סגירת חלון ההשלמה של אתמול), כדי שהבדיקות לא יהיו תלויות בשעת ההרצה */
const REAL_TODAY = Mila.today();
function at(dateStr, hour = 12) { const d = new Date(dateStr + 'T00:00:00'); d.setHours(hour, 0, 0, 0); Mila.setClock(() => d.getTime()); }
at(REAL_TODAY, 12);
function fresh(name = 'דנה') { at(REAL_TODAY, 12); Mila.reset(); const u = Mila.createUser({ name, ageConfirmed: true }); Mila.getState().me = u.id; return u; }
const today = Mila.today();

/* אינווריאנטים חשבונאיים שחייבים להתקיים תמיד */
function checkInvariants() {
  const S = Mila.getState();
  // א. תנועת הכרעה פעילה אחת לכל היותר לכל אירוע
  const per = {};
  for (const t of Mila.activeLedger()) { per[t.obligationId] = (per[t.obligationId] || 0) + 1; }
  for (const [k, v] of Object.entries(per)) assert.strictEqual(v, 1, `אירוע ${k} עם ${v} תנועות פעילות`);
  // ב. כל אירוע שהוכרע כהצלחה/פספוס מחזיק בדיוק תנועה אחת; החרגה – אפס
  for (const o of Object.values(S.obligations)) {
    const n = per[o.id] || 0;
    if (o.outcome === 'success' || o.outcome === 'miss') assert.strictEqual(n, 1, `אירוע ${o.localDate} ${o.outcome} עם ${n} תנועות`);
    else assert.strictEqual(n, 0, `אירוע ללא הכרעה/מוחרג עם תנועה`);
  }
  // ג. תקרה: לכל משתמשת ולכל תאריך <= 3
  const cnt = {};
  for (const o of Object.values(S.obligations)) { if (o.status === 'cancelled') continue; const k = o.userId + '|' + o.localDate; cnt[k] = (cnt[k] || 0) + 1; assert.ok(cnt[k] <= Mila.RULES.DAILY_CAP, `חריגה מתקרה ${k}`); }
  // ד. הבנק מסכים עם היומן (AT-09)
  for (const u of Object.values(S.users)) {
    const b = Mila.bankSummary(u.id);
    const earn = Mila.activeLedger().filter(t => t.userId === u.id && t.type === 'EARN').length;
    assert.strictEqual(b.earnedTotal, earn);
    assert.ok(b.earnedTotal >= 0 && b.missedTotal >= 0, 'אין יתרות שליליות');
  }
}

console.log('מילה · בדיקות מנוע');

test('יצירת מילה אישית יוצרת 14 אירועים יומיים והישג ״נתתי מילה״', () => {
  const u = fresh();
  const { commitment } = Mila.createPersonalWord({ title: 'הליכה', rule: '30 דקות', startDate: today });
  assert.strictEqual(Mila.obligationsOf(commitment.id).length, 14);
  assert.strictEqual(commitment.endDate, Mila.addDays(today, 13));
  assert.ok(Mila.achievementsFor(u.id).find(a => a.type === 'first_word').earned);
  checkInvariants();
});

test('AT-03: שלוש מילים חוסמות מילה רביעית, עם הצעת תאריך פנוי', () => {
  fresh();
  for (let i = 0; i < 3; i++) Mila.createPersonalWord({ title: 'מילה ' + i, rule: 'כלל', startDate: today });
  let err = null;
  try { Mila.createPersonalWord({ title: 'רביעית', rule: 'כלל', startDate: today }); } catch (e) { err = e; }
  assert.ok(err && err.code === 'CAP', 'צריכה להיזרק שגיאת תקרה');
  assert.strictEqual(err.cap.nextFree, Mila.addDays(today, 14));
  // מילה שמתחילה אחרי הסבב מותרת
  Mila.createPersonalWord({ title: 'אחרי', rule: 'כלל', startDate: Mila.addDays(today, 14) });
  checkInvariants();
});

test('AT-06 + AT-20: דיווח הצלחה יוצר תנועת EARN אחת; דיווח כפול לא מכפיל; לפני הכרעה אין שקל', () => {
  fresh();
  const { commitment } = Mila.createPersonalWord({ title: 'קריאה', rule: '10 עמודים', startDate: today });
  const ob = Mila.obligationsOf(commitment.id)[0];
  assert.strictEqual(Mila.bankSummary().earnedTotal, 0);
  assert.strictEqual(Mila.bankSummary().pendingSlots, 14);
  const r1 = Mila.report(ob.id, 'success');
  const r2 = Mila.report(ob.id, 'success');
  assert.strictEqual(r1.duplicate, false); assert.strictEqual(r2.duplicate, true);
  assert.strictEqual(Mila.activeLedger().length, 1);
  assert.strictEqual(Mila.bankSummary().earnedTotal, 1);
  assert.ok(Mila.achievementsFor().find(a => a.type === 'first_day').earned);
  checkInvariants();
});

test('אי אפשר לדווח על יום עתידי', () => {
  fresh();
  const { commitment } = Mila.createPersonalWord({ title: 'מים', rule: '8 כוסות', startDate: today });
  const tomorrow = Mila.obligationsOf(commitment.id)[1];
  assert.throws(() => Mila.report(tomorrow.id, 'success'), /לא התחיל/);
});

test('AT-07: תיקון הצלחה לפספוס = REVERSE + תנועה חדשה; ההיסטוריה נשמרת', () => {
  fresh();
  const { commitment } = Mila.createPersonalWord({ title: 'שינה', rule: 'עד 23:00', startDate: today });
  const ob = Mila.obligationsOf(commitment.id)[0];
  Mila.report(ob.id, 'success');
  assert.throws(() => Mila.correct(ob.id, 'miss', ''), /סיבה/);
  Mila.correct(ob.id, 'miss', 'לחצתי בטעות');
  const S = Mila.getState();
  assert.strictEqual(S.ledger.length, 3, 'EARN, REVERSE, MISS');
  assert.strictEqual(S.ledger.filter(t => t.type === 'REVERSE').length, 1);
  assert.strictEqual(Mila.bankSummary().earnedTotal, 0);
  assert.strictEqual(Mila.bankSummary().missedTotal, 1);
  assert.strictEqual(S.resolutionHistory.filter(h => h.obligationId === ob.id).length, 2);
  checkInvariants();
});

test('AT-08: החרגה לא מנפיקה שקל, לא שוברת רצף, מוגבלת ל-2 בסבב (מסע בזמן יום-יום)', () => {
  fresh();
  const start = Mila.addDays(today, -5);
  at(start, 12);
  const { commitment } = Mila.createPersonalWord({ title: 'מדיטציה', rule: '10 דק', startDate: start });
  const obs = Mila.obligationsOf(commitment.id);
  const plan = ['success', 'success', 'excused', 'success', 'excused'];
  plan.forEach((outcome, i) => { at(obs[i].localDate, 20); Mila.report(obs[i].id, outcome); });
  at(today, 12);
  Mila.refreshStatuses();
  assert.strictEqual(Mila.streak(commitment.id).current, 3, 'החרגה לא שוברת רצף');
  assert.strictEqual(Mila.excusesUsed(commitment.id), 2);
  const todayOb = obs.find(o => o.localDate === today);
  assert.throws(() => Mila.report(todayOb.id, 'excused'), /ימים חריגים/);
  assert.strictEqual(Mila.activeLedger().filter(t => t.obligationId === obs[2].id).length, 0, 'החרגה בלי תנועה');
  assert.strictEqual(Mila.bankSummary().earnedTotal, 3);
  const st = Mila.commitmentStats(commitment.id);
  assert.strictEqual(st.rate, 1, 'החרגות לא נכנסות למכנה');
  checkInvariants();
});

test('יום שלא דווח נזקף אוטומטית כפספוס אחרי 10:00 למחרת, וניתן לתיקון 24 שעות', () => {
  fresh();
  const { commitment } = Mila.createPersonalWord({ title: 'מים', rule: 'כלל', startDate: Mila.addDays(today, -1) });
  const [y, t] = Mila.obligationsOf(commitment.id);
  assert.strictEqual(y.outcome, 'miss'); assert.strictEqual(y.resolveReason, 'auto_unreported');
  assert.strictEqual(t.status, 'open');
  assert.ok(Mila.canCorrect(y), 'בתוך 24 שעות מהסגירה');
  Mila.correct(y.id, 'success', 'דיווח מאוחר');
  assert.strictEqual(Mila.bankSummary().earnedTotal, 1);
  at(Mila.addDays(today, 2), 12);
  assert.strictEqual(Mila.canCorrect(y), false, 'חלון התיקון נסגר');
  checkInvariants();
});

test('AT-02: הצטרפות למעגל לא יוצרת אירוע מחייב ולא שקל', () => {
  const owner = fresh('יעל');
  const { circle, invite } = Mila.createCircle({ name: 'חברות' });
  const S = Mila.getState();
  const guest = Mila.createUser({ name: 'נועה', ageConfirmed: true });
  S.me = guest.id;
  const p = Mila.previewInvite(invite.token);
  assert.ok(p.ok && p.memberCount === 1);
  Mila.acceptInvite(invite.token);
  assert.ok(Mila.isMember(circle.id, guest.id));
  assert.strictEqual(Object.values(S.obligations).filter(o => o.userId === guest.id).length, 0);
  assert.strictEqual(Mila.bankSummary(guest.id).earnedTotal, 0);
  // הזמנה שבוטלה לא עובדת
  S.me = owner.id; Mila.revokeInvite(invite.token); S.me = guest.id;
  assert.strictEqual(Mila.previewInvite(invite.token).ok, false);
});

test('AT-04 + AT-05: מילה קבוצתית = מופע נפרד לכל אחת; פספוס מחייב רק את מי שפספסה', () => {
  const a = fresh('יעל');
  const { circle, invite } = Mila.createCircle({ name: 'צעדים' });
  const S = Mila.getState();
  const b = Mila.createUser({ name: 'נועה', ageConfirmed: true });
  S.me = b.id; Mila.acceptInvite(invite.token); S.me = a.id;
  const def = Mila.proposeGroupWord(circle.id, { title: '8,000 צעדים', rule: 'מונה', startDate: today });
  const ka = Mila.adoptGroupWord(def.id);
  S.me = b.id; const kb = Mila.adoptGroupWord(def.id); S.me = a.id;
  assert.notStrictEqual(ka.id, kb.id);
  assert.strictEqual(Mila.adopters(def.id).length, 2);
  // א' פספסה, ב' הצליחה
  Mila.report(Mila.obligationsOf(ka.id)[0].id, 'miss');
  S.me = b.id; Mila.report(Mila.obligationsOf(kb.id)[0].id, 'success'); S.me = a.id;
  assert.strictEqual(Mila.bankSummary(a.id).missedTotal, 1);
  assert.strictEqual(Mila.bankSummary(b.id).missedTotal, 0);
  assert.strictEqual(Mila.bankSummary(b.id).earnedTotal, 1);
  assert.strictEqual(Mila.circlePool(circle.id), 1, 'הפספוס בקופת המעגל');
  // אימוץ חוזר מחזיר את אותו מופע
  assert.strictEqual(Mila.adoptGroupWord(def.id).id, ka.id);
  checkInvariants();
});

test('AT-13: דירוג לפי שיעור הצלחה, לא לפי כמות שקלים; מעט פעילות = לא מדורגת', () => {
  const a = fresh('יעל');
  const { circle, invite } = Mila.createCircle({ name: 'דירוג' });
  const S = Mila.getState();
  const b = Mila.createUser({ name: 'נועה', ageConfirmed: true });
  S.me = b.id; Mila.acceptInvite(invite.token); S.me = a.id;
  // א' – 3 מילים: 2 הצלחות ופספוס מתוך 3 הכרעות (66%) ; ב' – מילה אחת: הצלחה אחת (לא מספיק לדירוג)
  const start = today;
  const defs = [1, 2, 3].map(i => Mila.proposeGroupWord(circle.id, { title: 'מילה ' + i, rule: 'כלל', startDate: start }));
  const ks = defs.map(d => Mila.adoptGroupWord(d.id));
  // הימים שעברו (אתמול) נזקפו אוטומטית כפספוס אם חלון ההשלמה נסגר – נשתמש בתיקונים כדי לקבוע תוצאות
  ks.forEach((k, i) => { const obs = Mila.obligationsOf(k.id); setOutcome(obs[0], i < 2 ? 'success' : 'miss'); });
  // ב' מצטרפת מאוחר: ההתחייבות שלה מתחילה מהיום, לא בדיעבד
  S.me = b.id; const kb = Mila.adoptGroupWord(defs[0].id); const obsB = Mila.obligationsOf(kb.id); assert.strictEqual(obsB[0].localDate, today); setOutcome(obsB[0], 'success'); S.me = a.id;
  const lb = Mila.leaderboard(circle.id);
  const rowA = lb.rows.find(r => r.user.id === a.id), rowB = lb.rows.find(r => r.user.id === b.id);
  assert.strictEqual(rowA.success, 2); assert.strictEqual(rowA.miss, 1); assert.ok(Math.abs(rowA.rate - 2 / 3) < 1e-9); assert.ok(rowA.ranked);
  assert.strictEqual(rowB.success, 1); assert.strictEqual(rowB.ranked, false, 'פחות מ-3 הכרעות = לא מדורגת');
  assert.strictEqual(lb.rows[0].user.id, a.id);
  checkInvariants();
});
function setOutcome(o, outcome) {
  if (!o.outcome) { if (Mila.isOpenNow(o)) Mila.report(o.id, outcome); else Mila.correct(o.id, outcome, 'בדיקה'); }
  else if (o.outcome !== outcome) Mila.correct(o.id, outcome, 'בדיקה');
}

test('עזיבת מעגל מסיימת מילים פעילות במעגל ושומרת היסטוריה', () => {
  fresh('יעל');
  const { circle } = Mila.createCircle({ name: 'עזיבה' });
  const def = Mila.proposeGroupWord(circle.id, { title: 'ריצה', rule: '20 דק', startDate: today });
  const k = Mila.adoptGroupWord(def.id);
  Mila.report(Mila.obligationsOf(k.id)[0].id, 'success');
  Mila.leaveCircle(circle.id);
  assert.strictEqual(Mila.commitment(k.id).status, 'ended_early');
  assert.strictEqual(Mila.obligationsOf(k.id).filter(o => o.status === 'cancelled').length, 13);
  assert.strictEqual(Mila.bankSummary().earnedTotal, 1, 'השקל שנשמר נשאר');
  assert.strictEqual(Mila.getState().circles[circle.id].status, 'archived', 'מעגל ללא חברות נסגר');
  checkInvariants();
});

test('AT-12: סיום סבב לא פותח סבב חדש; סיכום ממתין לצפייה', () => {
  fresh();
  const { commitment } = Mila.createPersonalWord({ title: 'ישן', rule: 'כלל', startDate: Mila.addDays(today, -14) });
  Mila.refreshStatuses();  // היום האחרון היה אתמול; החלון שלו נסגר ב-10:00 היום
  assert.strictEqual(Mila.commitment(commitment.id).status, 'completed');
  assert.strictEqual(Mila.pendingSummaries().length, 1);
  assert.strictEqual(Mila.activeCommitments().length, 0, 'אין סבב חדש אוטומטי');
  assert.ok(Mila.achievementsFor().find(a => a.type === 'round_complete').earned);
});

test('חסימה: משתמשת חסומה לא רואה הזמנה של החוסמת ולא מופיעה בפיד', () => {
  const a = fresh('יעל');
  const { circle, invite } = Mila.createCircle({ name: 'בטיחות' });
  const S = Mila.getState();
  const b = Mila.createUser({ name: 'זרה', ageConfirmed: true });
  Mila.block(b.id);
  S.me = b.id;
  assert.strictEqual(Mila.previewInvite(invite.token).ok, false, 'חסומה לא נחשפת למעגל');
  S.me = a.id;
  assert.ok(Mila.feed(circle.id).every(e => e.actorId !== b.id));
});

test('ולידציה: ניסוח מסוכן נחסם; כלל הצלחה חובה', () => {
  fresh();
  assert.throws(() => Mila.createPersonalWord({ title: 'צום של 3 ימים', rule: 'לא לאכול כלום', startDate: today }), /מסוכן/);
  assert.throws(() => Mila.createPersonalWord({ title: 'משהו', rule: '', startDate: today }), /הצלחה/);
});

test('דמו: מצומצם (קבוצה אחת, 2 אתגרים) ועובר את כל האינווריאנטים', () => {
  Mila.setClock(null);
  Mila.reset();
  const u = MilaDemo.seed('דניאלה');
  const S = Mila.getState();
  assert.strictEqual(S.me, u.id);
  assert.strictEqual(Mila.todayCards().length, 2);
  assert.strictEqual(Mila.myCircles().length, 1);
  assert.ok(Mila.bankSummary().earnedTotal > 5, 'יש נקודות');
  assert.strictEqual(Mila.pendingSummaries().length, 0, 'אין סיכומי סבב שמחכים');
  const lb = Mila.leaderboard(Mila.myCircles()[0].id);
  assert.ok(lb.rows.some(r => r.ranked));
  checkInvariants();
});


test('ספרייה: אתגר מהספרייה נשמר עם מזהה יציב, כותרת וכלל מהספרייה; מזהה לא קיים נדחה', () => {
  fresh();
  assert.strictEqual(Mila.LIBRARY.CHALLENGES.length, 50);
  assert.strictEqual(new Set(Mila.LIBRARY.CHALLENGES.map(c => c.id)).size, 50, 'מזהים ייחודיים');
  for (const cat of Mila.LIBRARY.CATEGORIES) assert.strictEqual(Mila.LIBRARY.inCategory(cat.id).length, 10, cat.name);
  const { def, commitment } = Mila.createPersonalWord({ libraryId: 'food_8_water', title: 'משהו אחר', rule: 'x', reward: ' ספר חדש ' });
  assert.strictEqual(def.libraryId, 'food_8_water'); assert.strictEqual(def.title, '8 כוסות מים ביום'); assert.strictEqual(def.category, 'food');
  assert.strictEqual(commitment.reward, 'ספר חדש'); assert.strictEqual(commitment.rewardShared, false);
  assert.throws(() => Mila.createPersonalWord({ libraryId: 'nope' }), /לא נמצא/);
  checkInvariants();
});

test('ספרייה: אתגר רגיש (זוגיות) נשאר פרטי גם כשנבחרה קבוצה, אלא אם שותף במפורש', () => {
  fresh();
  const c = Mila.createCircle({ name: 'ק' }).circle;
  const a = Mila.createPersonalWord({ libraryId: 'cpl_hug_20', circleId: c.id, visibility: 'status' });
  assert.strictEqual(a.def.circleId, null); assert.strictEqual(a.def.visibility, 'private'); assert.ok(a.def.sensitive);
  assert.ok(!Mila.getState().socialEvents.some(e => e.type === 'word_committed'), 'לא הופיע בפעילות הקבוצה');
  const b = Mila.createPersonalWord({ libraryId: 'cpl_compliment', circleId: c.id, visibility: 'status', shareSensitive: true });
  assert.strictEqual(b.def.circleId, c.id);
  checkInvariants();
});

test('הזמנות: שלושה סוגים עם הודעה אישית; תצוגה מקדימה מחזירה סוג, הודעה ואתגר', () => {
  fresh();
  const c = Mila.createCircle({ name: 'ק' }).circle;
  const inv = Mila.createInvite(c.id, { kind: 'same', message: '  14 ימים בלי משלוחים. באה?  ', libraryId: 'food_no_delivery' });
  const p = Mila.previewInvite(inv.token);
  assert.strictEqual(p.kind, 'same'); assert.strictEqual(p.message, '14 ימים בלי משלוחים. באה?'); assert.strictEqual(p.challenge.id, 'food_no_delivery');
  const bad = Mila.createInvite(c.id, { kind: 'whatever', libraryId: 'nope' });
  assert.strictEqual(Mila.previewInvite(bad.token).kind, 'follow'); assert.strictEqual(Mila.previewInvite(bad.token).libraryId, null);
});

test('״המהפך״: עקיפה בדירוג יוצרת אירוע והתראה; משפט המצב מתאר את הפער', () => {
  const me = fresh('דנה');
  const start = Mila.addDays(today, -4);
  const c = Mila.createCircle({ name: 'ק', roundStart: start }).circle;
  const friend = Mila.createUser({ name: 'נועה', ageConfirmed: true });
  Mila.getState().memberships.push({ id: 'm_f', circleId: c.id, userId: friend.id, role: 'member', joinedAt: Mila.nowISO(), leftAt: null });
  const S = Mila.getState();
  // ימים שעברו נזקפים אוטומטית כפספוס. נועה התחילה יום אחרי: 1 הצלחה מתוך 3 (33%); אני: 1 מתוך 4 (25%)
  S.me = friend.id; const kf = Mila.createPersonalWord({ libraryId: 'move_walk_30', circleId: c.id, startDate: Mila.addDays(start, 1) }).commitment;
  S.me = me.id; const km = Mila.createPersonalWord({ libraryId: 'move_walk_30', circleId: c.id, startDate: start }).commitment;
  const setOutcome = (kid, date, outcome) => { const o = Mila.obligationsOf(kid).find(x => x.localDate === date); o.outcome = outcome; o.status = outcome === 'success' ? 'confirmed_success' : 'confirmed_miss'; o.resolvedAt = Mila.nowISO(); };
  setOutcome(kf.id, Mila.addDays(start, 1), 'success');
  setOutcome(km.id, start, 'success');
  let ri = Mila.rankInsight(c.id);
  assert.strictEqual(ri.place, 2, JSON.stringify(ri)); assert.ok(/נועה מובילה עלייך ב-8 נקודות אחוז. עוד הצלחה אחת ואת עוקפת אותה/.test(ri.text), ri.text);
  const todayOb = Mila.obligationsOf(km.id).find(x => x.localDate === today);
  const before = Mila.getState().socialEvents.filter(e => e.type === 'overtake').length;
  Mila.report(todayOb.id, 'success');                                                                     // אני 2/5 = 40% > 33% → עקפתי
  const ev = Mila.getState().socialEvents.filter(e => e.type === 'overtake');
  assert.strictEqual(ev.length, before + 1); assert.strictEqual(ev[ev.length - 1].payload.passedUserId, friend.id);
  assert.ok(Mila.notifications().some(n => n.type === 'overtake' && /עקפת את נועה/.test(n.title)));
  ri = Mila.rankInsight(c.id); assert.strictEqual(ri.place, 1); assert.ok(/את מובילה/.test(ri.text), ri.text);
  checkInvariants();
});


test('קבוצות: הסרת חברה עוצרת את האתגרים שלה בקבוצה; מנהלת נוספת; לא מורידים את המנהלת האחרונה', () => {
  const me = fresh('דנה');
  const c = Mila.createCircle({ name: 'ק' }).circle;
  const f = Mila.createUser({ name: 'נועה', ageConfirmed: true });
  Mila.getState().memberships.push({ id: 'm_f2', circleId: c.id, userId: f.id, role: 'member', joinedAt: Mila.nowISO(), leftAt: null });
  const S = Mila.getState();
  S.me = f.id; const kf = Mila.createPersonalWord({ libraryId: 'move_walk_30', circleId: c.id }).commitment; S.me = me.id;
  Mila.setMemberRole(c.id, f.id, 'admin'); assert.ok(Mila.isAdmin(c.id, f.id));
  Mila.setMemberRole(c.id, f.id, 'member'); assert.ok(!Mila.isAdmin(c.id, f.id));
  assert.throws(() => Mila.setMemberRole(c.id, me.id, 'member'), /לפחות מנהלת אחת/);
  Mila.removeMember(c.id, f.id);
  assert.strictEqual(S.commitments[kf.id].status, 'ended_early'); assert.strictEqual(S.commitments[kf.id].endReason, 'removed_from_circle');
  assert.ok(Mila.obligationsOf(kf.id).filter(o => !o.outcome).every(o => o.status === 'cancelled'));
  checkInvariants();
});

test('קבוצות: סגירת קבוצה עוצרת אתגרים אצל כולן, מבטלת הזמנות ומוציאה את כולן; קבוצה אחרת לא נפגעת', () => {
  const me = fresh('דנה');
  const c1 = Mila.createCircle({ name: 'אחת' }).circle; const c2 = Mila.createCircle({ name: 'שתיים' }).circle;
  const k1 = Mila.createPersonalWord({ libraryId: 'move_walk_30', circleId: c1.id }).commitment;
  const k2 = Mila.createPersonalWord({ libraryId: 'food_8_water', circleId: c2.id }).commitment;
  const inv = Mila.createInvite(c1.id);
  Mila.report(Mila.obligationsOf(k1.id).find(o => o.localDate === today).id, 'success');
  const pointsBefore = Mila.bankSummary().earnedTotal;
  Mila.deleteCircle(c1.id);
  const S = Mila.getState();
  assert.strictEqual(S.circles[c1.id].status, 'archived'); assert.ok(!Mila.isMember(c1.id));
  assert.strictEqual(S.commitments[k1.id].status, 'ended_early'); assert.strictEqual(S.invites[inv.token].status, 'revoked');
  assert.strictEqual(S.commitments[k2.id].status, 'active'); assert.deepStrictEqual(Mila.myCircles().map(c => c.id), [c2.id]);
  assert.strictEqual(Mila.bankSummary().earnedTotal, pointsBefore, 'הנקודות נשארות');
  checkInvariants();
});

console.log(`\n${passed} עברו, ${failed} נכשלו`);
process.exit(failed ? 1 : 0);
