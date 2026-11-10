/* בדיקת מוצר מקצה לקצה בדפדפן, שתי משתמשות בשני "טלפונים" (שני הקשרי דפדפן נפרדים).
   הזרימה: א נרשמת ← פותחת קבוצה ← קישור הזמנה ← ב נרשמת דרך הקישור ומצטרפת ← א מילה קבוצתית ←
   ב מאמצת ← שתיהן מדווחות ← בנק וקופה ועדכונים אצל שתיהן ← רענון/מכשיר חדש שומר הכול ← ניתוק רשת.
   הכניסה: /api/auth/test-login (קיים רק כש-ALLOW_TEST_LOGIN="true", סביבת בדיקות).
   הרצה: BASE_URL=http://127.0.0.1:8787 node tests/e2e.two-users.cjs */
const { chromium, devices } = require('playwright');
const assert = require('assert');
const fs = require('fs');

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const SHOTS = process.env.SHOTS_DIR || 'shots-e2e';
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const A = { name: 'יעל', email: `e2e.a.${stamp}@test.mila` };
const B = { name: 'נועה', email: `e2e.b.${stamp}@test.mila` };

async function phone(browser, label) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL', timezoneId: 'Asia/Jerusalem', bypassCSP: true, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`[${label}] PAGEERROR`, e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|favicon|fonts|net::/.test(m.text())) console.log(`[${label}] console`, m.text()); });
  return { ctx, page, label };
}
const shot = (p, name) => p.page.screenshot({ path: `${SHOTS}/${name}.png` });
const ready = (p) => p.page.waitForFunction(() => typeof App !== 'undefined' && typeof Api !== 'undefined' && document.querySelector('#screen').children.length > 0, null, { timeout: 30000 });

async function testLogin(p, u) {
  await p.page.goto(BASE + '/'); await ready(p);
  const r = await p.page.evaluate(async (u) => { const res = await fetch('/api/auth/test-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(u) }); return res.status; }, u);
  assert.strictEqual(r, 200, 'test-login');
}
async function signUpViaUi(p, u, url = BASE + '/') {
  await testLogin(p, u);
  await p.page.goto(url); await ready(p);
  await p.page.waitForSelector('#pf-name', { timeout: 20000 });
  await p.page.fill('#pf-name', u.name);
  await p.page.click('.ob-agree');
  await p.page.click('#pf-go');
  await p.page.waitForFunction(() => Api.isCloud() && Mila.me() && Mila.me().name, null, { timeout: 30000 });
}
const state = (p) => p.page.evaluate(() => Mila.getState());
const sync = (p) => p.page.evaluate(() => Api.sync());

(async () => {
  console.log('מילה · E2E שתי משתמשות ·', BASE);
  const browser = await chromium.launch();
  const a = await phone(browser, 'A'); const b = await phone(browser, 'B');
  const cfg = await (await fetch(BASE + '/api/auth/config')).json();
  assert.ok(cfg.testLogin, 'הבדיקה דורשת ALLOW_TEST_LOGIN=true (סביבת בדיקות)');

  console.log('1. א נרשמת (פרופיל, 18+, תנאים)');
  await a.page.goto(BASE + '/'); await ready(a); await shot(a, '01-welcome');
  await signUpViaUi(a, A); await shot(a, '02-a-start');

  console.log('2. א פותחת קבוצה ומקבלת קישור הזמנה');
  await a.page.evaluate(() => App.go('circleNew'));
  await a.page.fill('input[placeholder="למשל: הבנות מהמשרד"]', 'הבנות של יעל');
  await a.page.click('text=פותחת ומזמינה');
  // זרימת ההזמנה: 1) מה היא תעשה 2) ההודעה 3) נשלח, עם קישור וקוד
  await a.page.waitForSelector('text=מה את רוצה שהיא תעשה?', { timeout: 20000 }); await shot(a, '03a-a-invite-step1');
  await a.page.click('text=שתראה אותי עומדת במילה שלי'); await a.page.click('#inv-next');
  await a.page.waitForSelector('#inv-msg', { timeout: 10000 }); await shot(a, '03b-a-invite-step2');
  await a.page.click('button:has-text("העתקה")');
  await a.page.waitForSelector('text=ההזמנה יצאה', { timeout: 20000 }); await shot(a, '03c-a-invite-step3');
  const circleId = await a.page.evaluate(() => Mila.myCircles()[0].id);
  const token = await a.page.evaluate((id) => Api.cloud.inviteToken(id), circleId);
  assert.ok(token && token.length === 6);
  assert.ok(await a.page.evaluate((t) => document.body.innerText.includes(t), token), 'הקוד מוצג בצעד 3');
  await a.page.evaluate(() => App.inviteDone());

  console.log('3. ב פותחת את הקישור בטלפון שלה, נרשמת, רואה תצוגה מקדימה ומצטרפת');
  await signUpViaUi(b, B, `${BASE}/?invite=${token}`);
  await b.page.waitForSelector('text=תראי אם אני עומדת במילה שלי', { timeout: 20000 });
  await b.page.waitForSelector('text=מה קורה כשלוחצים', { timeout: 10000 });
  await shot(b, '04-b-invite-preview');
  await b.page.click('#screen button.btn.primary:has-text("אני בפנים")');
  await b.page.waitForSelector('text=מי מובילה?', { timeout: 20000 });
  await sync(a);
  assert.ok(await a.page.evaluate(() => Mila.notifications().some(n => n.type === 'invite' && /נועה הצטרפה/.test(n.title))), 'א קיבלה עדכון שנועה הצטרפה');
  let sB = await state(b);
  assert.strictEqual(Object.values(sB.obligations).filter(o => o.userId === sB.me).length, 0, 'AT-02: הצטרפות יצרה אירועים');
  assert.strictEqual(sB.memberships.filter(m => !m.leftAt).length, 2);

  console.log('4. א מציעה מילה קבוצתית ומאמצת אותה');
  await a.page.evaluate((id) => App.openGroupWizard(id), circleId);
  await a.page.click('.ideas .chip.select >> nth=1');
  await a.page.click('text=פותחת ומזמינה');
  await a.page.waitForSelector('text=החברות קיבלו הודעה', { timeout: 20000 });
  const defId = await a.page.evaluate(() => Object.values(Mila.getState().wordDefs).find(d => d.kind === 'group').id);
  await a.page.click('button:has-text("אני בפנים")'); await a.page.click('#sheet button:has-text("אני בפנים")');
  await a.page.waitForSelector('text=דיווח עד 10:00 למחרת', { timeout: 20000 });

  console.log('5. ב רואה את המילה (דרך רענון) ומאמצת');
  await sync(b);
  await b.page.evaluate(() => App.tab('circles')); await b.page.waitForSelector('text=אתגרים שמחכים לך', { timeout: 20000 }); await shot(b, '05-b-circles');
  await b.page.evaluate((id) => App.go('groupWord', { id }), defId);
  await b.page.click('button:has-text("אני בפנים")'); await b.page.click('#sheet button:has-text("אני בפנים")');
  await b.page.waitForSelector('text=דיווח עד 10:00 למחרת', { timeout: 20000 });
  assert.strictEqual(await b.page.evaluate((id) => Mila.adopters(id).length, defId), 2, 'AT-04');

  console.log('5b. ב בוחרת 2 אתגרים מהספרייה עם ״אם אצליח, אני…״ (מסך הבחירה בממשק)');
  await b.page.evaluate(() => App.openPick());
  await b.page.waitForSelector('text=אז במה את מתחילה?', { timeout: 20000 }); await shot(b, '05b-b-pick');
  await b.page.click('text=בלי להזמין אוכל'); await b.page.click('text=8 כוסות מים ביום');
  await b.page.waitForSelector('text=2 מתוך 3 נבחרו', { timeout: 10000 }); await shot(b, '05c-b-pick-selected');
  await b.page.click('text=בחרתי. מה הלאה?');
  await b.page.waitForSelector('text=אם אצליח, אני…', { timeout: 10000 });
  await b.page.click('.pr-reward >> nth=0'); await b.page.fill('.pr-input', 'ספר חדש');
  await shot(b, '05d-b-pick-review');
  await b.page.click('button:has-text("מתחילה")');
  await b.page.waitForFunction(() => Mila.activeCommitments().length === 3, null, { timeout: 30000 });
  const libDefs = await b.page.evaluate(() => Mila.activeCommitments().map(c => Mila.wordDef(c.defId)).filter(d => d.libraryId).map(d => d.libraryId + ':' + d.category + ':' + (d.circleId ? 'circle' : 'private')));
  assert.deepStrictEqual(libDefs.sort(), ['food_8_water:food:circle', 'food_no_delivery:food:circle'], 'אתגרי ספרייה: ' + libDefs);
  assert.strictEqual(await b.page.evaluate(() => Mila.activeCommitments().find(c => Mila.wordDef(c.defId).libraryId === 'food_no_delivery').reward), 'ספר חדש');

  console.log('5c. א שולחת הזמנה מסוג ״בואי, שתינו צריכות את זה״ מתוך האתגר; ב רואה את ההודעה האישית');
  const kAid = await a.page.evaluate((id) => Mila.myAdoption(id).id, defId);
  const groupTitle = await a.page.evaluate((id) => Mila.wordDef(id).title, defId);
  await a.page.evaluate((id) => App.go('word', { id }), kAid);
  await a.page.click('#screen button:has-text("בואי, שתינו צריכות את זה")');
  await a.page.waitForSelector('text=מה את רוצה שהיא תעשה?', { timeout: 10000 });
  await a.page.click('#inv-next');
  await a.page.waitForSelector('#inv-msg', { timeout: 10000 }); await shot(a, '05e-a-invite-same');
  await a.page.fill('#inv-msg', '8,000 צעדים ביום. בואי נראה מי זזה יותר.');
  await a.page.click('button:has-text("העתקה")');
  await a.page.waitForSelector('text=ההזמנה יצאה', { timeout: 20000 });
  await a.page.waitForFunction(() => Object.values(Mila.getState().invites).some(i => i.kind === 'same'), null, { timeout: 20000 });
  const tokSame = await a.page.evaluate(() => Api.cloud.inviteToken(Mila.myCircles()[0].id));
  const pv = await b.page.evaluate(async (t) => Api.cloud.previewInvite(t), tokSame);
  assert.strictEqual(pv.kind, 'same'); assert.strictEqual(pv.message, '8,000 צעדים ביום. בואי נראה מי זזה יותר.'); assert.strictEqual(pv.wordTitle, groupTitle);
  await b.page.evaluate((t) => App.go('invite', { token: t }), tokSame); await b.page.waitForSelector('text=את כבר בפנים', { timeout: 10000 }); await shot(b, '05f-b-invite-preview');

  console.log('6. שתיהן מדווחות: א הצליחה, ב פספסה');
  for (const [p, outcome] of [[a, 'success'], [b, 'miss']]) {
    await p.page.evaluate(() => App.tab('today'));
    const obId = await p.page.evaluate((d) => Mila.todayCards().find(x => !x.outcome && x.def.id === d).id, defId);
    await p.page.evaluate((id) => App.reportSheet(id), obId); await p.page.waitForTimeout(400);
    if (outcome === 'success') await p.page.click('text=עמדתי בזה'); else { await p.page.click('.outcome-btns >> text=פספסתי'); await p.page.click('text=כן, פספסתי'); }
    await p.page.waitForFunction((id) => Mila.getState().obligations[id] && Mila.getState().obligations[id].outcome, obId, { timeout: 20000 });
  }
  await shot(a, '06-a-today'); await shot(b, '06-b-today');

  console.log('7. נקודות, דירוג ועדכונים אצל שתיהן');
  await sync(a); await sync(b);
  const bankA = await a.page.evaluate(() => Mila.bankSummary()); const bankB = await b.page.evaluate(() => Mila.bankSummary());
  assert.strictEqual(bankA.earnedTotal, 1); assert.strictEqual(bankA.missedTotal, 0);
  assert.strictEqual(bankB.earnedTotal, 0); assert.strictEqual(bankB.missedTotal, 1, 'רק הפספוס שדווח; אתגרי הספרייה של היום עדיין פתוחים');
  // הדירוג אצל כל אחת משקף את הדיווח של השנייה
  const rowOf = (p, name) => p.page.evaluate(({ id, name }) => { const r = Mila.leaderboard(id).rows.find(x => x.user.name === name); return r ? { s: r.success, m: r.miss } : null; }, { id: circleId, name });
  assert.deepStrictEqual(await rowOf(a, 'נועה'), { s: 0, m: 1 }, 'א רואה את הפספוס של ב בדירוג');
  assert.deepStrictEqual(await rowOf(b, 'יעל'), { s: 1, m: 0 }, 'ב רואה את ההצלחה של א בדירוג');
  const feedA = await a.page.evaluate((id) => Mila.feed(id).map(e => e.type + ':' + e.actor.name), circleId);
  const feedB = await b.page.evaluate((id) => Mila.feed(id).map(e => e.type + ':' + e.actor.name), circleId);
  assert.ok(feedA.includes('day_miss:נועה'), 'א רואה את ב: ' + feedA); assert.ok(feedB.includes('day_success:יעל'), 'ב רואה את א: ' + feedB);
  await a.page.evaluate(() => App.go('bank')); await a.page.waitForTimeout(400); await shot(a, '07-a-bank');
  await b.page.evaluate((id) => { App.go('circle', { id }); }, circleId); await b.page.waitForSelector('text=מי מובילה?', { timeout: 10000 }); await shot(b, '08-b-circle-rank');
  await b.page.evaluate(() => App.setCircleTab('feed')); await b.page.waitForTimeout(300); await shot(b, '09-b-circle-feed');

  console.log('8. דיווח כפול מהדפדפן לא מכפיל; מניפולציה ביתרה לא נשמרת');
  const dup = await a.page.evaluate(async () => { const o = Mila.todayCards().find(x => x.outcome); const r = await Api.cloud.report(o.id, 'miss'); return { dup: r.duplicate, earned: Mila.bankSummary().earnedTotal }; });
  assert.ok(dup.dup && dup.earned === 1, 'AT-06');
  const tamper = await a.page.evaluate(async () => { Mila.getState().ledger.push({ id: 'fake', userId: Mila.me().id, type: 'EARN', amount: 1, obligationId: 'x' }); const before = Mila.bankSummary().earnedTotal; await Api.sync(); return { before, after: Mila.bankSummary().earnedTotal }; });
  assert.strictEqual(tamper.before, 2); assert.strictEqual(tamper.after, 1, 'השרת הוא מקור האמת');
  const fakeCall = await a.page.evaluate(async () => (await fetch('/api/action/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ obligationId: 'nope', outcome: 'success' }) })).status);
  assert.strictEqual(fakeCall, 404);

  console.log('9. מכשיר חדש: סשן שמור → אותו מידע; רענון שומר הכול');
  const cookies = await a.ctx.cookies();
  const c = await phone(browser, 'A-new-phone'); await c.ctx.addCookies(cookies.filter(k => k.name === 'mila_session'));
  await c.page.goto(BASE + '/'); await ready(c); await c.page.waitForFunction(() => Api.isCloud() && Mila.bankSummary().earnedTotal === 1, null, { timeout: 20000 });
  await a.page.reload(); await ready(a); await a.page.waitForFunction(() => Api.isCloud() && Mila.bankSummary().earnedTotal === 1, null, { timeout: 20000 });
  await shot(c, '10-a-new-device');

  console.log('10. ניתוק רשת: קריאה מהמטמון, פעולה נכשלת בעדינות, התאוששות');
  await a.ctx.setOffline(true);
  const offline = await a.page.evaluate(async () => { try { await Api.cloud.report(Mila.todayCards()[0].id, 'success'); return 'no-error'; } catch (e) { return e.code; } });
  assert.strictEqual(offline, 'OFFLINE');
  await a.page.reload().catch(() => {});
  await a.ctx.setOffline(false);
  await a.page.goto(BASE + '/'); await ready(a); await a.page.waitForFunction(() => Api.isCloud(), null, { timeout: 20000 });

  console.log('11. PWA: manifest ו-service worker נגישים; התנתקות');
  const man = await (await fetch(BASE + '/manifest.json')).json(); assert.strictEqual(man.dir, 'rtl'); assert.ok(man.icons.length);
  assert.strictEqual((await fetch(BASE + '/sw.js')).status, 200);
  await b.page.evaluate(() => App.signOut()); await b.page.waitForSelector('text=יאללה, אני בפנים', { timeout: 20000 });
  assert.strictEqual(await b.page.evaluate(async () => (await fetch('/api/state')).status), 401);
  await shot(b, '11-b-signed-out');

  console.log('\nE2E PASSED');
  await browser.close();
})().catch(e => { console.error('E2E FAILED:', e.message); process.exit(1); });
