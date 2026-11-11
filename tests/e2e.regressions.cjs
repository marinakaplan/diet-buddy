/* בדיקות דפדפן לתקלות שנמצאו ותוקנו בביקורת (נובמבר 2026). כל בדיקה כאן נכשלה לפני התיקון.
   הרצה: BASE_URL=https://mila-staging... NODE_USE_ENV_PROXY=1 node tests/e2e.regressions.cjs */
const assert = require('assert');
const { chromium, devices } = require('playwright');
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const stamp = Date.now().toString(36);
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '\n     ', String(e.message).split('\n')[0]); process.exitCode = 1; } };

(async () => {
  console.log('מילה · בדיקות רגרסיה בדפדפן ·', BASE);
  const browser = await chromium.launch();
  const mk = async () => {
    const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
    await ctx.addInitScript(() => { try { localStorage.setItem('mila.consent', '"all"'); } catch (e) { } });
    const page = await ctx.newPage(); page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));
    return { ctx, page };
  };
  const login = (page, email, name) => page.evaluate(async ({ email, name }) => (await fetch('/api/auth/test-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name }) })).status, { email, name });
  const onboard = async (page, alone = true) => {
    await page.waitForSelector('#pf-name'); await page.click('.ob-agree'); await page.click('#pf-go');
    await page.waitForSelector('.ob-grid'); await page.click('.ob-pick >> nth=0'); await page.click('.ob-foot .btn.primary');
    await page.waitForSelector('.ob-choice'); await page.click(`.ob-choice >> nth=${alone ? 1 : 0}`); await page.click('.ob-go');
    await page.waitForFunction(() => typeof Mila !== 'undefined' && Mila.activeCommitments().length === 1, null, { timeout: 20000 });
  };

  const A = await mk(); const B = await mk();
  let token, circleId;

  await test('service worker נרשם בכניסה לאפליקציה, והמטמון כולל את קובצי הגרסה הנוכחית', async () => {
    await A.page.goto(BASE + '/'); await A.page.waitForSelector('.w2');
    await A.page.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).length === 1, null, { timeout: 15000 });
    await A.page.waitForFunction(async () => { const ks = await caches.keys(); if (!ks.length) return false; const reqs = await (await caches.open(ks[0])).keys(); return reqs.some(r => /\/js\/app\.js\?v=/.test(r.url)) && reqs.some(r => /\/js\/api\.js\?v=/.test(r.url)); }, null, { timeout: 20000 });
  });

  await test('אונבורדינג; חזרה מ״אתגר משלך״ ומהזמנה שנייה לא משאירה מסך ריק', async () => {
    await login(A.page, `reg.a.${stamp}@test.mila`, 'מיכל'); await A.page.reload(); await onboard(A.page, false);
    await A.page.waitForSelector('#inv-msg', { timeout: 20000 });
    circleId = await A.page.evaluate(() => Mila.myCircles()[0].id);
    await A.page.evaluate(() => { App.inviteClose(); App.closeSheet(); App.tab('today'); });
    await A.page.evaluate(() => { App.openPick(); App.pickCustom(); });
    await A.page.waitForSelector('#w-title'); await A.page.evaluate(() => App.wizHeadBack());
    assert.ok((await A.page.innerText('#screen')).includes('אז במה את מתחילה?'), 'חוזרת למסך הבחירה');
    await A.page.evaluate(() => App.pickCancel());
    assert.ok((await A.page.innerText('#screen')).trim().length > 40, 'מסך היום מוצג');
    await A.page.evaluate((id) => { App.tab('circles'); App.inviteFlow({ circleId: id }); App.inviteFlow({ circleId: id }); App.inviteClose(); }, circleId);
    assert.ok((await A.page.innerText('#screen')).includes('הקבוצות שלי'), 'סגירת ההזמנה מחזירה לקבוצות');
    assert.deepStrictEqual(A.page.errors, []);
  });

  await test('קישור הזמנה שורד רענון של הדף לפני הכניסה, והחברה החדשה מגיעה למסך ההצטרפות', async () => {
    token = await A.page.evaluate(async (id) => (await Api.cloud.createInvite(id, { kind: 'follow', message: 'בואי' })).token, circleId);
    await B.page.goto(`${BASE}/?invite=${token}`); await B.page.waitForSelector('.w2-invite');
    let txt = await B.page.innerText('.w2-invite'); assert.ok(/מיכל מזמינה אותך/.test(txt) && /הקבוצה של מיכל/.test(txt) && /בואי/.test(txt), 'לפני הכניסה רואים מי מזמינה, לאיזו קבוצה ומה כתבה: ' + txt.replace(/\s+/g, ' '));
    await B.page.reload(); await B.page.waitForSelector('.w2-invite');   // הכתובת כבר בלי ?invite=, ועדיין זוכרות
    await login(B.page, `reg.b.${stamp}@test.mila`, 'שני'); await B.page.reload();
    await B.page.waitForSelector('#pf-name'); await B.page.waitForFunction(() => /מיכל מחכה לך/.test(document.querySelector('#screen').innerText), null, { timeout: 15000 });
    await B.page.click('.ob-agree'); await B.page.click('#pf-go');
    await B.page.waitForSelector('.inv-screen', { timeout: 20000 });
    assert.ok(/מיכל מזמינה אותך/.test(await B.page.innerText('.inv-screen')), 'מסך ההצטרפות: מי מזמינה');
    await B.page.evaluate((t) => App.acceptInvite(t), token);
    await B.page.waitForFunction((id) => typeof Mila !== 'undefined' && !!Mila.getState().circles[id], circleId, { timeout: 20000 });
    assert.strictEqual(await B.page.evaluate(() => localStorage.getItem('mila.invite')), null, 'אחרי ההצטרפות ההזמנה השמורה נמחקת');
    await B.page.reload(); await B.page.waitForSelector('.today-head, .tg-row, #nav:not(.hidden)', { timeout: 20000 });
    assert.ok(!/באה איתי\?|הפעם לא/.test(await B.page.innerText('#screen')), 'מסך ההזמנה לא קופץ שוב בפתיחה הבאה');
    await B.page.evaluate((id) => App.go('circle', { id }, { reset: true }), circleId);
    assert.ok(/הצטרפת לקבוצה\. מיכל הזמינה אותך/.test(await B.page.innerText('#screen')), 'בקבוצה כתוב מי הזמינה אותי');
  });

  await test('שם עם תווי HTML לא מריץ קוד אצל החברות', async () => {
    await B.page.evaluate(async () => { await Api.call('action/rename', { method: 'POST', body: { name: '"><img src=x onerror=__x=1>' } }); });
    await A.page.evaluate(async (id) => { window.__x = 0; await Api.sync(); App.go('circle', { id }, { reset: true }); }, circleId);
    await A.page.waitForTimeout(800);
    assert.strictEqual(await A.page.evaluate(() => window.__x), 0);
    assert.ok(!/[<>]/.test(await A.page.evaluate(() => Object.values(Mila.getState().users).map(u => u.name).join(''))), 'השרת מנקה תווי HTML מהשם');
    assert.strictEqual(await A.page.locator('#screen img[src="x"]').count(), 0);
  });

  await test('שורות לחיצות נגישות במקלדת: Enter על אתגר פותח את הדיווח', async () => {
    await A.page.evaluate(() => App.tab('today'));
    const row = A.page.locator('.word-row.tap').first();
    assert.strictEqual(await row.getAttribute('role'), 'button'); assert.strictEqual(await row.getAttribute('tabindex'), '0');
    await row.focus(); await A.page.keyboard.press('Enter');
    await A.page.waitForSelector('#sheet.open .outcome-btns');
    await A.page.evaluate(() => App.closeSheet());
  });

  await test('לחיצה כפולה על ״עמדתי בזה״ שולחת דיווח אחד', async () => {
    const id = await A.page.evaluate(() => Mila.todayCards().find(c => !c.outcome).id);
    let reports = 0; A.page.on('request', r => { if (r.url().endsWith('/api/action/report')) reports++; });
    await A.page.evaluate((id) => { App.doReport(id, 'success'); App.doReport(id, 'success'); }, id);
    await A.page.waitForFunction((id) => Mila.getState().obligations[id].outcome === 'success', id, { timeout: 20000 });
    await A.page.waitForTimeout(600);
    assert.strictEqual(reports, 1);
  });

  await test('בלי רשת: האפליקציה נפתחת מהמטמון, ודיווח לא ״נשמר״ בשקט אלא מסביר שאין חיבור', async () => {
    await A.page.evaluate(async () => { await Api.sync(); });
    await A.ctx.setOffline(true);
    await A.page.reload(); await A.page.waitForSelector('.today-head', { timeout: 20000 });
    const open = await A.page.evaluate(() => { const c = Mila.todayCards().find(c => !c.outcome); return c ? c.id : null; });
    if (open) {
      await A.page.evaluate((id) => App.doReport(id, 'success'), open);
      await A.page.waitForFunction(() => /אין חיבור/.test(document.querySelector('#toast').textContent), null, { timeout: 10000 });
      assert.strictEqual(await A.page.evaluate((id) => Mila.getState().obligations[id].outcome, open), null, 'לא סומן כאילו נשמר');
    }
    await A.ctx.setOffline(false);
    // כשהרשת חוזרת האפליקציה טוענת את עצמה מחדש מהשרת
    await A.page.waitForFunction(() => typeof Api !== 'undefined' && Api.isCloud(), null, { timeout: 20000 });
  });

  await test('כניסה שפגה: חוזרות למסך הפתיחה עם הסבר, בלי להמשיך לכתוב לשום מקום', async () => {
    await A.page.waitForSelector('.today-head', { timeout: 20000 });
    await A.ctx.clearCookies();
    await A.page.evaluate(() => Api.sync().catch(() => {}));
    await A.page.waitForSelector('.w2', { timeout: 15000 });
    assert.ok(/פג/.test(await A.page.innerText('#toast')));
  });

  await browser.close();
  console.log(`\n${passed} בדיקות עברו${process.exitCode ? ' · יש כישלונות' : ''}`);
  if (!process.exitCode) console.log('REGRESSIONS PASSED');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
