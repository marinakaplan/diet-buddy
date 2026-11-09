/* בדיקת מוצר מקצה לקצה עם שתי משתמשות אמיתיות (Playwright + Supabase).
   משתמשת א' נרשמת ← פותחת מעגל ← מזמינה ← משתמשת ב' נרשמת ומצטרפת ←
   א' יוצרת מילה קבוצתית ← ב' מאמצת ← שתיהן מדווחות ← הבנק והקופה מתעדכנים אצל שתיהן.

   הרצה:  BASE_URL=https://<deployment> node tests/e2e.two-users.js
   דורש פרויקט Supabase מוגדר ב-js/config.js ואישור אימייל כבוי (לבדיקות). */
const { chromium } = require('playwright');
const assert = require('assert');

const BASE = process.env.BASE_URL || 'http://localhost:3456/';
const stamp = Date.now().toString(36);
const A = { name: 'יעל', email: `mila.a.${stamp}@example.com`, password: 'Mila!2026test' };
const B = { name: 'נועה', email: `mila.b.${stamp}@example.com`, password: 'Mila!2026test' };
const shotsDir = process.env.SHOTS_DIR || 'shots-e2e';
require('fs').mkdirSync(shotsDir, { recursive: true });

async function newUser(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'he-IL' });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`[${label}] PAGEERROR`, e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|favicon|fonts/.test(m.text())) console.log(`[${label}] console`, m.text()); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.App && window.Api, null, { timeout: 30000 });
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${shotsDir}/${name}.png` });
const settle = (page, ms = 600) => page.waitForTimeout(ms);

async function signUp(page, u) {
  await page.waitForSelector('text=נרשמות', { timeout: 20000 });
  await page.click('text=נרשמות');
  await page.fill('input[autocomplete="given-name"]', u.name);
  await page.fill('input[type="email"]', u.email);
  await page.fill('input[type="password"]', u.password);
  await page.click('text=אני בת 18 ומעלה');
  await page.click('text=הבנתי: שקלי מילה הם מטבע משחק בלבד');
  await page.click('#auth-go');
  await page.waitForFunction(() => Api.isCloud() && Mila.me(), null, { timeout: 30000 });
}

(async () => {
  const browser = await chromium.launch();
  const a = await newUser(browser, 'A');
  const b = await newUser(browser, 'B');
  const cloud = await a.page.evaluate(() => Api.enabled);
  assert.ok(cloud, 'js/config.js חייב להצביע על פרויקט Supabase');

  console.log('1. א נרשמת');
  await signUp(a.page, A);
  await shot(a.page, '1-a-start');

  console.log('2. א פותחת מעגל');
  await a.page.evaluate(() => App.go('circleNew'));
  await a.page.fill('input[placeholder="למשל: הבנות מהמשרד"]', 'הבנות של יעל');
  await a.page.click('text=יצירת המעגל וקישור הזמנה');
  await a.page.waitForSelector('text=קוד הזמנה', { timeout: 20000 });
  const token = await a.page.evaluate(() => { const c = Mila.myCircles()[0]; return Api.cloud.inviteToken(c.id); });
  assert.ok(token && token.length === 6, 'קוד הזמנה');
  await shot(a.page, '2-a-invite');
  await a.page.evaluate(() => App.closeSheet());

  console.log('3. ב נרשמת ומצטרפת דרך קישור');
  await b.page.goto(`${BASE}${BASE.includes('?') ? '&' : '?'}invite=${token}`);
  await b.page.waitForFunction(() => window.App && window.Api, null, { timeout: 30000 });
  await signUp(b.page, B);
  await b.page.waitForSelector('text=הזמינה אותך', { timeout: 20000 });
  await shot(b.page, '3-b-invite-preview');
  // הצטרפות לא יוצרת התחייבות
  await b.page.click('text=הצטרפי למעגל');
  await b.page.waitForSelector('text=המילה שלנו', { timeout: 20000 });
  const bObl = await b.page.evaluate(() => Object.values(Mila.getState().obligations).filter(o => o.userId === Mila.me().id).length);
  assert.strictEqual(bObl, 0, 'AT-02: הצטרפות יצרה אירועים');
  await shot(b.page, '4-b-circle');

  console.log('4. א מציעה מילה קבוצתית');
  const circleId = await a.page.evaluate(() => Mila.myCircles()[0].id);
  await a.page.evaluate((id) => App.openGroupWizard(id), circleId);
  await a.page.click('.chips.scroll .chip.select >> nth=1'); // 8,000 צעדים
  await a.page.click('text=להציע למעגל');
  await a.page.waitForSelector('text=ההצעה פורסמה במעגל', { timeout: 20000 });
  const defId = await a.page.evaluate(() => Object.values(Mila.getState().wordDefs).find(d => d.kind === 'group').id);
  await a.page.click('text=אני בפנים');
  await a.page.click('text=נתתי מילה');
  await a.page.waitForSelector('text=המילה על הכף', { timeout: 20000 });

  console.log('5. ב רואה את ההצעה ומאמצת');
  await b.page.evaluate(() => Api.sync());
  await b.page.evaluate((id) => App.go('groupWord', { id }), defId);
  await b.page.waitForSelector('text=אני בפנים', { timeout: 20000 });
  await shot(b.page, '5-b-group-word');
  await b.page.click('text=אני בפנים');
  await b.page.click('text=נתתי מילה');
  await b.page.waitForSelector('text=המילה על הכף', { timeout: 20000 });
  const adopters = await b.page.evaluate((id) => Mila.adopters(id).length, defId);
  assert.strictEqual(adopters, 2, 'AT-04: שני מופעים');

  console.log('6. שתיהן מדווחות: א הצליחה, ב פספסה');
  for (const [u, outcome] of [[a, 'success'], [b, 'miss']]) {
    await u.page.evaluate(() => App.tab('today'));
    const obId = await u.page.evaluate(() => Mila.todayCards().find(x => !x.outcome).id);
    await u.page.evaluate((id) => App.reportSheet(id), obId);
    await settle(u.page, 400);
    if (outcome === 'success') await u.page.click('text=עמדתי במילה');
    else { await u.page.click('text=פספסתי >> nth=0'); await u.page.click('text=כן, פספסתי'); }
    await u.page.waitForFunction((id) => Mila.getState().obligations[id] && Mila.getState().obligations[id].outcome, obId, { timeout: 20000 });
  }
  await shot(a.page, '6-a-today');
  await shot(b.page, '6-b-today');

  console.log('7. הבנק והקופה מתעדכנים אצל שתיהן');
  await a.page.evaluate(() => Api.sync()); await b.page.evaluate(() => Api.sync());
  const aBank = await a.page.evaluate(() => Mila.bankSummary());
  const bBank = await b.page.evaluate(() => Mila.bankSummary());
  const aPool = await a.page.evaluate((id) => Mila.circlePool(id), circleId);
  const bPool = await b.page.evaluate((id) => Mila.circlePool(id), circleId);
  assert.strictEqual(aBank.earnedTotal, 1, 'א שמרה שקל');
  assert.strictEqual(aBank.missedTotal, 0);
  assert.strictEqual(bBank.earnedTotal, 0);
  assert.strictEqual(bBank.missedTotal, 1, 'ב פספסה');
  assert.strictEqual(aPool, 1, 'הקופה אצל א'); assert.strictEqual(bPool, 1, 'הקופה אצל ב');
  // א רואה את הפספוס של ב בפיד; ב רואה את ההצלחה של א
  const aFeed = await a.page.evaluate((id) => Mila.feed(id).map(e => e.type + ':' + e.actor.name), circleId);
  assert.ok(aFeed.some(x => x === 'day_miss:נועה'), 'פיד של א: ' + aFeed.join(','));
  const bFeed = await b.page.evaluate((id) => Mila.feed(id).map(e => e.type + ':' + e.actor.name), circleId);
  assert.ok(bFeed.some(x => x === 'day_success:יעל'), 'פיד של ב: ' + bFeed.join(','));
  // דיווח כפול לא מכפיל
  const dup = await a.page.evaluate(async () => { const o = Mila.todayCards()[0]; const r = await Api.cloud.report(o.id, 'miss'); return { dup: r.duplicate, earned: Mila.bankSummary().earnedTotal }; });
  assert.ok(dup.dup && dup.earned === 1, 'AT-06');

  await a.page.evaluate(() => App.go('bank')); await settle(a.page); await shot(a.page, '7-a-bank');
  await b.page.evaluate((id) => { App.go('circle', { id }); App.setCircleTab('rank'); }, circleId); await settle(b.page); await shot(b.page, '7-b-rank');
  await b.page.evaluate(() => App.go('bank')); await settle(b.page); await shot(b.page, '7-b-bank');

  console.log('8. הפרדת נתונים: ב לא רואה את היומן הפרטי של א');
  const leak = await b.page.evaluate(() => Mila.getState().ledger.filter(t => t.userId !== Mila.me().id && t.type === 'EARN').length);
  assert.strictEqual(leak, 0, 'דליפת EARN של משתמשת אחרת');

  console.log('\nE2E PASSED');
  await browser.close();
})().catch(e => { console.error('E2E FAILED:', e.message); process.exit(1); });
