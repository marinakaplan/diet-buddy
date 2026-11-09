/* ============================================================
   מילה — שכבת הממשק (app.js)
   ניתוב מבוסס מחסנית, מסכים כתבניות, גיליונות תחתונים וטוסטים.
   כל פעולה עוברת דרך Mila (המנוע) – הממשק לא מחשב יתרות בעצמו.
   ============================================================ */
const App = (() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TOP = ['today', 'circles', 'me'];
  const TILE_COLORS = ['lime', 'pink', 'lav', 'mint', 'peach', 'sky'];
  const COLOR_TO_TILE = { lime: 'lime', pink: 'pink', lavender: 'lav', mint: 'mint', peach: 'peach', sky: 'sky' };
  const tileColorFor = (str) => TILE_COLORS[Mila.hashStr(str || '') % TILE_COLORS.length];
  const pct = (n) => `${Math.round(n * 100)}%`;
  const REACTION_ICON = { clap: 'clap', heart: 'heart', muscle: 'muscle', fire: 'flame', star: 'star' };
  const REACTION_LABEL = { clap: 'כל הכבוד', heart: 'אוהבת', muscle: 'חזקה', fire: 'אש', star: 'כוכבת' };

  /* Store: אותו ממשק פעולות, שני מימושים – מקומי (דמו) או שרת (Supabase). */
  const Local = {};
  for (const k of ['updateSettings','renameMe','updateCircle','leaveCircle','removeMember','cancelProposal','endCommitment','updateWordVisibility','report','correct','encourage','sendEncouragement','block','unblock','reportAbuse','markAllRead','markSummarySeen','deleteAccount','acceptInvite','adoptGroupWord','proposeGroupWord','createPersonalWord','createCircle','createInvite','previewInvite']) Local[k] = async (...a) => Mila[k](...a);
  Local.inviteToken = (circleId) => (Mila.currentInvite(circleId) || {}).token || null;
  Local.cachedPreview = (token) => Mila.previewInvite(token);
  Local.revokeCircleInvites = async (circleId) => { Mila.revokeCircleInvites(circleId); return Mila.createInvite(circleId); };
  const Store = () => (Api.isCloud() ? Api.cloud : Local);
  const isCloud = () => Api.isCloud();
  let authForm = { name: '', age: false, terms: false };
  let busy = false;

  let stack = [];
  let wiz = null;        // אשף יצירת מילה
  let gwiz = null;       // אשף מילה קבוצתית
  let cwiz = null;       // יצירת מעגל
  let circleTab = 'feed';
  let bankFilter = 'all';
  let toastTimer = null;

  /* ---------- ניתוב ---------- */
  function go(name, params = {}, { replace = false, reset = false } = {}) {
    if (reset) stack = [];
    if (replace && stack.length) stack.pop();
    stack.push({ name, params });
    render();
    window.scrollTo({ top: 0 });
  }
  function back(fallback = 'today') {
    if (stack.length > 1) stack.pop(); else stack = [{ name: fallback, params: {} }];
    render();
  }
  function tab(name) { stack = [{ name, params: {} }]; render(); window.scrollTo({ top: 0 }); }
  function current() { return stack[stack.length - 1]; }
  function sheetOpen() { return $('#sheet').classList.contains('open'); }
  function render({ keepSheet = false } = {}) {
    if (!keepSheet) closeSheet(true);
    Mila.refreshStatuses();
    const cur = current();
    const screen = SCREENS[cur.name];
    const root = $('#screen');
    if (!screen) { root.innerHTML = '<div class="empty"><div class="t">המסך לא נמצא</div></div>'; return; }
    const html = screen(cur.params);
    root.innerHTML = html;
    const isTop = TOP.includes(cur.name) && Mila.me();
    root.classList.toggle('no-nav', !isTop);
    $('#nav').classList.toggle('hidden', !isTop);
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === cur.name));
    if (POST[cur.name]) POST[cur.name](cur.params);
  }
  function refresh() { render(); }

  /* ---------- גיליון תחתון וטוסט ---------- */
  function sheet(html) {
    const el = $('#sheet');
    el.innerHTML = `<div class="sheet-handle"></div>${html}`;
    $('#sheet-backdrop').classList.add('open');
    requestAnimationFrame(() => el.classList.add('open'));
  }
  function closeSheet(immediate = false) {
    $('#sheet').classList.remove('open');
    $('#sheet-backdrop').classList.remove('open');
    if (immediate) $('#sheet').innerHTML = '';
  }
  function toast(msg, kind = '') {
    const t = $('#toast');
    t.textContent = msg; t.className = `show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  /* חותמת: האינטראקציה המזוהה של מילה — מופיעה אחרי חתימה על התחייבות */
  function stamp(text) {
    const el = document.createElement('div'); el.className = 'stamp'; el.innerHTML = `<span>${esc(text)}</span>`;
    document.body.appendChild(el); requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 1600);
  }
  function fail(e) { toast(e.userMessage || e.message || 'משהו השתבש'); if (!e.userMessage) console.error(e); }
  function confirmSheet({ title, sub, okText = 'אישור', okClass = 'dark', onOk, cancelText = 'ביטול' }) {
    sheet(`<div class="sheet-title">${esc(title)}</div><div class="sheet-sub">${sub || ''}</div>
      <div class="btn-row"><button class="btn soft" onclick="App.closeSheet()">${esc(cancelText)}</button><button class="btn ${okClass}" id="sheet-ok">${esc(okText)}</button></div>`);
    $('#sheet-ok').onclick = async () => { try { await onOk(); } catch (e) { fail(e); } };
  }

  /* ---------- רכיבים משותפים ---------- */
  function topbar({ title, subtitle = '', back: hasBack = true, end = '', start = '' }) {
    return `<div class="topbar">
      <div class="topbar-side">${hasBack ? `<button class="icon-btn" aria-label="חזרה" onclick="App.back()">${icon('back', 24)}</button>` : start}</div>
      <div class="title-wrap"><div class="title">${esc(title)}</div>${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ''}</div>
      <div class="topbar-side end">${end}</div>
    </div>`;
  }
  function wordTile(def, size = '') { return `<span class="tile ${size} ${tileColorFor(def.title)}">${icon(def.icon || 'leaf', size === 'lg' ? 30 : size === 'sm' ? 20 : 24)}</span>`; }
  function circleTile(circle, size = '') { return `<span class="tile ${size} ${COLOR_TO_TILE[circle.color] || 'pink'}">${icon('users', size === 'lg' ? 28 : 22)}</span>`; }
  function coinLabel(n) { return `${n} ₪ מילה`; }
  function days14(commitmentId) {
    const obs = Mila.obligationsOf(commitmentId);
    const today = Mila.today();
    return `<div class="days14">${obs.map((o, i) => {
      const cls = o.status === 'cancelled' ? 'future' : o.outcome === 'success' ? 'success' : o.outcome === 'miss' ? 'miss' : o.outcome === 'excused' ? 'excused' : o.localDate > today ? 'future' : '';
      const ic = o.outcome === 'success' ? icon('check', 16) : o.outcome === 'miss' ? icon('x', 14) : o.outcome === 'excused' ? icon('minus', 14) : '';
      return `<div class="day-cell ${cls} ${o.localDate === today ? 'today' : ''}" title="${esc(Mila.fmtDate(o.localDate))}">${ic || (i + 1)}</div>`;
    }).join('')}</div>
    <div class="legend"><span><i style="background:var(--lime)"></i>עמדתי</span><span><i style="background:var(--pink)"></i>פספסתי</span><span><i style="background:var(--lav)"></i>החרגה</span><span><i style="background:#F4F1F3"></i>עוד לא</span></div>`;
  }
  function ring(value, total, center = '') {
    const p = total ? Math.min(value / total, 1) : 0;
    return `<div class="ring-wrap"><div class="ring-center">${center}</div><svg viewBox="0 0 240 130">
      <path class="ring-track" d="M20 120 A100 100 0 0 1 220 120" fill="none" stroke-width="16" stroke-linecap="round"/>
      <path class="ring-fill" d="M20 120 A100 100 0 0 1 220 120" fill="none" stroke-width="16" stroke-linecap="round" pathLength="100" stroke-dasharray="${(p * 100).toFixed(1)} 100"/>
    </svg></div>`;
  }
  /* רעיונות למילה: מקובצים לפי תחום, לחיצה ממלאת את הטופס ואפשר לערוך */
  function templateChips(handler, selectedTitle) {
    const cats = [...new Set(Mila.TEMPLATES.map(t => t.cat))];
    return `<div class="ideas mb">
      <div class="ideas-head"><span class="bold small">רעיונות למילה</span><span class="tiny muted">לוחצים, זה ממלא את הטופס, ואפשר לשנות הכול</span></div>
      ${cats.map(c => `<div class="ideas-cat">${esc(c)}</div><div class="chips">${Mila.TEMPLATES.map((t, i) => t.cat === c ? `<button class="chip select ${selectedTitle === t.title ? 'on' : ''}" onclick="App.${handler}(${i})">${icon(t.icon, 15)} ${esc(t.title)}</button>` : '').join('')}</div>`).join('')}
    </div>`;
  }
  function hebrewPlural(n, one, many) { return n === 1 ? one : `${n} ${many}`; }

  /* ============================================================
     S01 — פתיחה
     ============================================================ */
  const SCREENS = {};
  const POST = {};

  SCREENS.welcome = () => `
    <div class="welcome">
      <div class="logo-row">${logoMark(54)}<span class="brand">מילה.</span></div>
      <div class="tag">מילה שלך. עכשיו נראה אותך.</div>
      <div class="examples">
        <div class="ex"><span class="tile lime">${icon('walk')}</span><div>הליכה 30 דקות<small>14 יום · שקל מילה על הכף בכל יום</small></div></div>
        <div class="ex"><span class="tile pink">${icon('users')}</span><div>8,000 צעדים עם החברות<small>כל אחת נמדדת בפני עצמה · הקופה משותפת</small></div></div>
        <div class="ex"><span class="tile lav">${icon('book')}</span><div>קריאה 10 עמודים<small>רצף של 14 הצלחות = הישג</small></div></div>
      </div>
      ${Api.enabled ? `<button class="btn dark" onclick="App.googleSignIn()">${googleMark()} להמשיך עם Google</button>` : `<button class="btn primary" onclick="App.go('signup')">תני מילה</button>`}
      <button class="btn text mt" onclick="App.startDemo()">${icon('sparkle', 18)} להציץ עם נתוני דוגמה</button>
      ${Api.enabled ? `<div class="tiny muted center">הכניסה עם גוגל בלבד. לא נבקש גישה לאנשי הקשר ולא נפרסם בשמך.</div>` : ''}
      <div class="disclaimer">שקלי מילה הם מטבע משחק, לא כסף אמיתי. אי אפשר לרכוש, למשוך או להמיר אותם.</div>
    </div>`;

  function startDemo() {
    Mila.reset();
    MilaDemo.seed('דניאלה');
    go('today', {}, { reset: true });
    toast('נטענו נתוני דוגמה. אפשר לאפס אותם מההגדרות.', 'lime');
  }

  /* ============================================================
     S02 — הרשמה
     ============================================================ */
  let signupForm = { name: '', age: false, terms: false };
  SCREENS.signup = () => `
    ${topbar({ title: '' })}
    <div class="step-title">איך קוראים לך?</div>
    <div class="step-sub">השם יוצג לחברות במעגלים שתבחרי להצטרף אליהם.</div>
    <div class="field"><input class="input" id="su-name" placeholder="שם תצוגה" value="${esc(signupForm.name)}" autocomplete="given-name" maxlength="30" oninput="App.suChange('name', this.value)"></div>
    <div class="checkbox-row ${signupForm.age ? 'on' : ''}" onclick="App.suToggle('age')"><span class="box">${signupForm.age ? icon('check', 16) : ''}</span><span>אני בת 18 ומעלה</span></div>
    <div class="checkbox-row ${signupForm.terms ? 'on' : ''}" onclick="App.suToggle('terms')"><span class="box">${signupForm.terms ? icon('check', 16) : ''}</span><span>קראתי והבנתי: שקלי מילה הם מטבע משחק בלבד, ללא ערך כספי, ללא רכישה או פדיון.</span></div>
    <div class="note">${icon('lock', 18)}<span>לא נבקש גישה לאנשי הקשר שלך ולא נשלח הודעות בשמך. הנתונים נשמרים במכשיר הזה.</span></div>
    <div class="mt-lg"><button class="btn primary" id="su-go" ${signupForm.name.trim() && signupForm.age && signupForm.terms ? '' : 'disabled'} onclick="App.signup()">יוצרים חשבון</button></div>`;
  function suChange(k, v) { signupForm[k] = v; $('#su-go').disabled = !(signupForm.name.trim() && signupForm.age && signupForm.terms); }
  function suToggle(k) { signupForm[k] = !signupForm[k]; render(); setTimeout(() => { const i = $('#su-name'); if (i && !signupForm.name) i.focus(); }, 0); }
  function signup() {
    if (!signupForm.age) return toast('בגרסת הבטא המשחק פתוח לבנות 18 ומעלה');
    const u = Mila.createUser({ name: signupForm.name, ageConfirmed: true });
    Mila.getState().me = u.id; Mila.save();
    const token = pendingInviteToken; pendingInviteToken = null;
    go('start', {}, { reset: true });
    if (token) openInvite(token);
  }
  let pendingInviteToken = null;

  /* ============================================================
     S02b — כניסה אמיתית: Google OAuth (השרת מנהל את הסשן בעוגיית HttpOnly)
     ============================================================ */
  function googleMark() { return `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.2-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41.4 35 44 30 44 24c0-1.2-.1-2.4-.4-3.5z"/></svg>`; }
  function googleSignIn() {
    if (!Api.config.google) return toast('התחברות עם גוגל עוד לא הוגדרה בסביבה הזו');
    const next = pendingInviteToken ? `/?invite=${encodeURIComponent(pendingInviteToken)}` : '/';
    location.href = Api.googleUrl(next);
  }
  function afterAuth() {
    busy = false;
    Api.startAutoSync();
    const token = pendingInviteToken; pendingInviteToken = null;
    const first = !Mila.activeCommitments().length && !Mila.myCircles().length;
    go(first ? 'start' : 'today', {}, { reset: true });
    if (token) openInvite(token);
  }
  /* השלמת פרופיל אחרי הכניסה הראשונה: שם, 18+, תנאים */
  SCREENS.profile = () => `
    <div class="welcome" style="justify-content:flex-start;padding-top:40px">
      <div class="logo-row" style="justify-content:flex-start;gap:8px">${logoMark(36)}<span class="brand" style="font-size:1.6rem">מילה.</span></div>
      <div class="step-title mt-lg">רגע לפני המילה הראשונה</div><div class="step-sub">השם יוצג לחברות במעגלים שתבחרי. את שאר הפרטים אנחנו לא צריכות.</div>
      <div class="field"><label>איך קוראים לך?</label><input class="input" id="pf-name" placeholder="שם תצוגה" maxlength="30" value="${esc(authForm.name || (Api.me && Api.me.name) || '')}" oninput="App.authSet('name', this.value)"></div>
      <div class="checkbox-row ${authForm.age ? 'on' : ''}" onclick="App.authToggle('age')"><span class="box">${authForm.age ? icon('check', 16) : ''}</span><span>אני בת 18 ומעלה</span></div>
      <div class="checkbox-row ${authForm.terms ? 'on' : ''}" onclick="App.authToggle('terms')"><span class="box">${authForm.terms ? icon('check', 16) : ''}</span><span>קראתי את <a href="#" onclick="event.preventDefault(); App.termsSheet()">תנאי השימוש</a>: מילה היא משחק חברתי. שקלי מילה הם מטבע משחק בלבד, בלי ערך כספי, רכישה או פדיון.</span></div>
      <div class="mt-lg"><button class="btn primary" id="pf-go" ${busy ? 'disabled' : ''} onclick="App.completeProfile()">${busy ? 'רגע…' : 'חותמת על זה'}</button></div>
      <button class="btn text mt" onclick="App.signOut()">יציאה</button>
    </div>`;
  function authSet(k, v) { authForm[k] = v; }
  function authToggle(k) { authForm[k] = !authForm[k]; render(); }
  function termsSheet() {
    sheet(`<div class="sheet-title">תנאי שימוש (בטא)</div>
      <div class="small muted" style="line-height:1.7">
      <p><b>מה זה.</b> מילה היא משחק חברתי של התחייבויות ל-14 יום. הדיווח הוא עצמי ומבוסס אמון.</p>
      <p><b>שקלי מילה.</b> יחידת משחק בלבד. אין להם ערך כספי, אי אפשר לקנות, למכור, להעביר, למשוך או להמיר אותם, ואין בהם הימור או פרס. אין תרומות באפליקציה.</p>
      <p><b>גיל.</b> השימוש מותר מגיל 18.</p>
      <p><b>מידע.</b> נשמרים: שם תצוגה, אימייל (לכניסה בלבד), אזור זמן, המילים והדיווחים שלך. חברות במעגל רואות את מה שבחרת לחשוף. אין גישה לאנשי קשר, אין מכירת מידע.</p>
      <p><b>שליטה.</b> אפשר לייצא את הנתונים ולמחוק את החשבון מההגדרות בכל רגע. לאחר מחיקה הפרופיל הופך לאנונימי; תנועות היסטוריות של קופות משותפות נשמרות ללא זיהוי.</p>
      <p><b>התנהגות.</b> בלי הטרדה, לחץ או תוכן פוגעני. אפשר לחסום ולדווח מכל מעגל. אנחנו רשאיות להסיר תוכן או חשבון שמפר את זה.</p>
      <p><b>בטא.</b> השירות ניתן כפי שהוא, ללא התחייבות לזמינות. הוא רץ על תשתית חינמית; ייתכנו הגבלות שימוש.</p>
      </div><button class="btn soft mt" onclick="App.closeSheet()">סגירה</button>`);
  }
  async function completeProfile() {
    if (busy) return;
    const name = (authForm.name || (Api.me && Api.me.name) || '').trim();
    if (!name) return toast('צריך שם תצוגה');
    if (!authForm.age) return toast('בגרסת הבטא המשחק פתוח לבנות 18 ומעלה');
    if (!authForm.terms) return toast('צריך לאשר את תנאי השימוש');
    busy = true; render();
    try { await Api.completeProfile({ name, ageConfirmed: true, termsAccepted: true }); afterAuth(); }
    catch (e) { busy = false; fail(e); render(); }
  }
  async function signOut() { try { await Api.signOut(); } catch (e) { /* ignore */ } stack = []; pendingInviteToken = null; go('welcome', {}, { reset: true }); }

  /* ============================================================
     S03 — התחלת משחק
     ============================================================ */
  SCREENS.start = () => `
    <div class="welcome" style="justify-content:flex-start;padding-top:40px">
      <div class="logo-row" style="justify-content:flex-start;gap:8px">${logoMark(36)}<span class="brand" style="font-size:1.6rem">מילה.</span></div>
      <div class="step-title mt-lg">היי ${esc(Mila.me().name)}, מאיפה מתחילים?</div>
      <div class="step-sub">אף מילה לא מתחילה בלי שתבחרי. גם הצטרפות למעגל לא מחייבת כלום.</div>
      <div class="row-card" onclick="App.openWordWizard()"><span class="tile lg lime">${icon('pencil', 28)}</span><div class="body"><div class="t">תני מילה</div><div class="m">מילה קטנה, 14 ימים. את בוחרת.</div></div>${icon('chev', 20)}</div>
      <div class="row-card" onclick="App.joinByCodeSheet()"><span class="tile lg pink">${icon('users', 28)}</span><div class="body"><div class="t">מצטרפת למעגל</div><div class="m">קיבלת קישור או קוד מחברה? מכאן.</div></div>${icon('chev', 20)}</div>
      <div class="row-card" onclick="App.tab('today')"><span class="tile lg lav">${icon('eye', 28)}</span><div class="body"><div class="t">עוד לא בטוחה? להסתכל קודם</div><div class="m">אפשר לראות את מסך היום ולהחליט אחר כך.</div></div>${icon('chev', 20)}</div>
    </div>`;

  /* ============================================================
     S04 — היום שלי
     ============================================================ */
  SCREENS.today = () => {
    const u = Mila.me();
    if (!u) return SCREENS.welcome();
    const hour = new Date().getHours();
    const greet = hour < 5 ? 'לילה טוב' : hour < 12 ? 'בוקר טוב' : hour < 17 ? 'צהריים טובים' : hour < 21 ? 'ערב טוב' : 'לילה טוב';
    const cards = Mila.todayCards();
    const active = Mila.activeCommitments();
    const bank = Mila.bankSummary();
    const unread = Mila.unreadCount();
    const pendingSum = Mila.pendingSummaries();
    const digest = Mila.myFeedDigest(2);
    const upcoming = Mila.upcomingWords();
    // סבב "ראשי" להצגה בטבעת: ההתחייבות הפעילה עם הכי הרבה ימים שעברו
    const main = active.map(c => ({ c, st: Mila.commitmentStats(c.id) })).sort((a, b) => b.st.dayIndex - a.st.dayIndex)[0];
    const done = cards.filter(x => x.outcome).length;

    return `
      <div class="topbar" style="padding-bottom:4px">
        <div class="topbar-side"><button class="icon-btn" aria-label="התראות" onclick="App.go('notifications')">${icon('bell', 24)}${unread ? '<span class="badge-dot"></span>' : ''}</button></div>
        <div class="title-wrap">${active.length < Mila.RULES.DAILY_CAP ? `<button class="btn primary sm" onclick="App.openWordWizard()">${icon('plus', 16)} תני מילה</button>` : ''}</div>
        <div class="topbar-side end"><button class="icon-btn" aria-label="הפרופיל שלי" onclick="App.tab('me')">${avatar(u, 40)}</button></div>
      </div>
      ${Mila.getState().meta.demo ? `<div class="demo-banner">נתוני דוגמה: המעגלים, החברות וההיסטוריה כאן מומצאים כדי להראות איך זה נראה. <a href="#" onclick="event.preventDefault(); App.resetDemo()">איפוס והתחלה אמיתית</a></div>` : ''}
      <div class="greeting"><div><div class="hello">${greet}, ${esc(u.name)} ${icon(hour >= 17 || hour < 5 ? 'moon' : 'sun', 22)}</div><div class="sub">${todaySubtitle(cards)}</div></div></div>

      ${main ? `<div class="card ring-card">
          ${ring(main.st.dayIndex, Mila.RULES.ROUND_DAYS, `<div class="label">סבב נוכחי</div><div class="big"><b>${main.st.dayIndex}</b> מתוך ${Mila.RULES.ROUND_DAYS}</div>`)}
          <div class="ring-dots">${active.slice(0, 3).map((c, i) => `<i class="${c.id === main.c.id ? 'on' : ''}"></i>`).join('')}</div>
          <div class="ring-meta"><span>נשמרו בסבב <b>${bank.earnedCurrentRound}</b></span><span>בקופות <b>${bank.missedCurrentRound}</b></span><span>על הכף היום <b>${bank.pendingToday}</b></span></div>
        </div>` : ''}

      ${pendingSum.length ? pendingSum.map(c => `<div class="card pastel-lav clickable tight" onclick="App.go('summary',{id:'${c.id}'})"><div style="display:flex;align-items:center;gap:12px"><span class="tile lav">${icon('medal')}</span><div style="flex:1"><div class="bold">סיכום סבב מוכן: ${esc(Mila.wordDef(c.defId).title)}</div><div class="small muted">14 ימים אחרי. הנה כל מה שקיימת.</div></div>${icon('chev', 20)}</div></div>`).join('') : ''}

      <div class="section-title">במה אני עומדת היום ${cards.length ? `<small>${done}/${cards.length}</small>` : ''}</div>
      ${cards.length ? cards.map(todayRow).join('') : `<div class="card empty"><span class="tile lg lime">${icon('pencil', 28)}</span><div class="t">מה המילה הראשונה שלך?</div><div class="m">דבר קטן, מדיד, ל-14 יום. שקל מילה אחד על הכף בכל יום.</div><button class="btn primary" onclick="App.openWordWizard()">תני מילה</button></div>`}
      ${cards.length && active.length < Mila.RULES.DAILY_CAP ? `<button class="btn ghost mt" onclick="App.openWordWizard()">${icon('plus', 20)} תני עוד מילה</button>` : ''}
      ${cards.length && active.length >= Mila.RULES.DAILY_CAP ? `<div class="note">${icon('info', 18)}<span>שלוש מילים זה המקסימום ליום. כשאחת מסתיימת, אפשר לתת חדשה.</span></div>` : ''}

      ${upcoming.length ? `<div class="section-title">מתחילות בקרוב</div>${upcoming.map(c => `<div class="word-row" onclick="App.go('word',{id:'${c.id}'})">${wordTile(c.def, 'sm')}<div class="body"><div class="name">${esc(c.def.title)}</div><div class="meta">מתחילה ${Mila.relDay(c.startDate)}</div></div>${icon('chev', 18)}</div>`).join('')}` : ''}

      <div class="card pastel-lime clickable tight mt" onclick="App.go('bank')">
        <div style="display:flex;align-items:center;gap:12px"><span class="tile lime">${icon('coins')}</span><div style="flex:1"><div class="bold">השקלים שלי · ${coinLabel(bank.earnedTotal)}</div><div class="small muted">${bank.pendingSlots > 0 ? `עוד ${bank.pendingSlots} שקלים על הכף עד סוף הסבב` : 'הסבב הזה הוכרע עד הסוף'}</div></div>${icon('chev', 20)}</div>
      </div>

      ${digest.length ? `<div class="section-title">מה קורה במעגלים <small onclick="App.tab('circles')" style="cursor:pointer">הכול</small></div>
        <div class="card tight">${digest.map(e => `<div class="feed-item" onclick="App.go('circle',{id:'${e.circleId}'})">${avatar(e.actor, 36)}<div class="body"><div class="t">${feedText(e)}</div><div class="m">${esc(e.circle.name)} · ${timeAgo(e.createdAt)}</div></div></div>`).join('')}</div>` : ''}
      ${!Mila.myCircles().length ? `<div class="card pastel-pink clickable tight" onclick="App.tab('circles')"><div style="display:flex;align-items:center;gap:12px"><span class="tile pink">${icon('users')}</span><div style="flex:1"><div class="bold">יחד זה מחזיק יותר</div><div class="small muted">פתחי מעגל או הצטרפי עם קוד. בלי התחייבות.</div></div>${icon('chev', 20)}</div></div>` : ''}
    `;
  };

  function todaySubtitle(cards) {
    if (!cards.length) return 'אין מילה על הכף היום';
    const left = cards.filter(x => !x.outcome).length;
    const kept = cards.filter(x => x.outcome === 'success').length;
    if (left === 0) return kept === cards.length ? 'עמדת בכולן היום. אמרת, עשית.' : 'היום הוכרע. מחר מתחילות מחדש.';
    if (left === cards.length) return cards.length === 1 ? 'מילה אחת לעמוד בה היום' : `${cards.length} מילים לעמוד בהן היום`;
    return left === 1 ? 'נשארה עוד מילה אחת להיום' : `נשארו עוד ${left} מילים להיום`;
  }
  function todayRow(x) {
    const st = x.outcome === 'success' ? 'done' : x.outcome === 'miss' ? 'miss' : x.outcome === 'excused' ? 'excused' : x.late ? 'late' : '';
    const mark = x.outcome === 'success' ? icon('check', 18) : x.outcome === 'miss' ? icon('x', 16) : x.outcome === 'excused' ? icon('minus', 16) : '';
    const meta = x.outcome === 'success' ? '<span class="chip lime">עמדת במילה</span>' : x.outcome === 'miss' ? '<span class="chip pink">לא היום</span>' : x.outcome === 'excused' ? '<span class="chip lav">יום מוחרג</span>' : x.late ? `<span class="chip peach">${icon('clock', 13)} אתמול, אפשר להשלים עד 10:00</span>` : '';
    const streak = x.stats.current >= 2 ? `<span class="chip">${icon('flame', 13)} ${x.stats.current} ימים ברצף</span>` : '';
    return `<div class="word-row ${x.outcome === 'success' ? 'done' : ''}">
      <button class="check ${st}" aria-label="דיווח" onclick="event.stopPropagation(); App.reportSheet('${x.id}')">${mark}</button>
      <div class="body" onclick="App.go('word',{id:'${x.commitmentId}'})"><div class="name">${esc(x.def.title)}</div><div class="meta">${meta}${streak}${x.circle ? `<span class="chip outline">${esc(x.circle.name)}</span>` : ''}</div></div>
      <span onclick="App.go('word',{id:'${x.commitmentId}'})">${wordTile(x.def)}</span>
    </div>`;
  }

  /* ============================================================
     S07 — דיווח (גיליון)
     ============================================================ */
  function reportSheet(obligationId) {
    const o = Mila.decorate(Mila.getState().obligations[obligationId]);
    if (o.outcome) {
      // כבר הוכרע: הצגה + אפשרות תיקון
      return sheet(`<div class="sheet-hero">${wordTile(o.def, 'lg')}<div class="sheet-title">${esc(o.def.title)}</div><div class="sheet-sub">${Mila.relDay(o.localDate)} · ${o.outcome === 'success' ? 'עמדת במילה, שקל מילה נשמר' : o.outcome === 'miss' ? (o.circle ? 'השקל עבר לקופת המעגל' : 'פספוס') : 'יום מוחרג, בלי שקל'}</div></div>
        ${o.canCorrect ? `<button class="btn soft" onclick="App.correctionSheet('${o.id}')">${icon('edit', 18)} תיקון דיווח</button><div class="tiny muted center mt">אפשר לתקן עד 24 שעות אחרי ההכרעה. התיקון נרשם ביומן.</div>` : '<div class="note">' + icon('lock', 18) + '<span>חלון התיקון נסגר. ההכרעה נעולה.</span></div>'}
        <button class="btn text mt" onclick="App.closeSheet()">סגירה</button>`);
    }
    if (!o.open) return toast(o.localDate > Mila.today() ? 'עוד אי אפשר לדווח על יום שלא התחיל' : 'חלון הדיווח ליום הזה נסגר');
    const excusesLeft = Mila.RULES.MAX_EXCUSES_PER_ROUND - Mila.excusesUsed(o.commitmentId);
    sheet(`<div class="sheet-hero">${wordTile(o.def, 'lg')}<div class="sheet-title">${esc(o.def.title)}</div><div class="sheet-sub">${Mila.relDay(o.localDate)} · ${esc(o.def.rule)}</div></div>
      <div class="outcome-btns">
        <button class="btn primary" onclick="App.doReport('${o.id}','success')">${icon('check', 26)}עמדתי במילה<small>שקל מילה נשמר</small></button>
        <button class="btn pink" onclick="App.confirmMiss('${o.id}')">${icon('x', 24)}פספסתי<small>${o.circle ? 'השקל לקופת המעגל' : 'נרשם כפספוס'}</small></button>
      </div>
      <button class="btn text mt" ${excusesLeft > 0 ? `onclick="App.excuseSheet('${o.id}')"` : 'disabled'}>${icon('minus', 16)} צריכה החרגה ${excusesLeft > 0 ? `(נשארו ${excusesLeft})` : '(נוצלו)'}</button>
      <div class="tiny muted center">דיווח עצמי. אין כאן שופטת, יש מילה.</div>`);
  }
  function confirmMiss(id) {
    const o = Mila.decorate(Mila.getState().obligations[id]);
    confirmSheet({ title: 'היום זה לא קרה?', sub: `${o.circle ? 'שקל מילה יעבור לקופת המעגל. ' : ''}מחר אפשר להתחיל מחדש.`, okText: 'כן, פספסתי', okClass: 'pink', onOk: () => doReport(id, 'miss') });
  }
  function excuseSheet(id) {
    sheet(`<div class="sheet-title">יום מוחרג</div><div class="sheet-sub">יום שלא מזכה ולא מחייב. לא שובר רצף, לא נספר להישג 14 ימים. בלי פירוט, רק סיבה כללית.</div>
      ${['מחלה', 'אירוע משפחתי', 'נסיעה', 'אחר'].map(r => `<div class="choice" onclick="App.doReport('${id}','excused','${r}')"><span class="radio"></span><div class="body"><div class="t">${r}</div></div></div>`).join('')}`);
  }
  async function doReport(id, outcome, note = '') {
    try {
      const { obligation, duplicate } = await Store().report(id, outcome, { note });
      closeSheet(true);
      if (duplicate) toast('הדיווח כבר נשמר');
      else if (outcome === 'success') toast('אמרת. עשית. השקל שלך נשמר.', 'lime');
      else if (outcome === 'miss') toast(Mila.decorate(obligation).circle ? 'היום זה לא קרה. שקל מילה עבר לקופה. מחר מתחילות מחדש.' : 'היום זה לא קרה. מחר מתחילות מחדש.');
      else toast('היום הוחרג. הרצף נשמר.');
      render();
    } catch (e) { fail(e); }
  }

  /* ---------- S21 — תיקון דיווח ---------- */
  function correctionSheet(id) {
    const o = Mila.decorate(Mila.getState().obligations[id]);
    const opts = [['success', 'עמדתי במילה', 'lime'], ['miss', 'פספסתי', 'pink'], ['excused', 'החרגה', 'lav']].filter(([k]) => k !== o.outcome);
    sheet(`<div class="sheet-title">תיקון דיווח</div><div class="sheet-sub">${esc(o.def.title)} · ${Mila.relDay(o.localDate)}. התוצאה המקורית תבוטל ותירשם חדשה. שתיהן נשמרות ביומן.</div>
      <div class="field"><label>תוצאה מתוקנת</label>${opts.map(([k, l, c]) => `<div class="choice" data-k="${k}" onclick="App._corrPick('${k}')"><span class="radio"></span><div class="body"><div class="t">${l}</div></div></div>`).join('')}</div>
      <div class="field"><label>סיבה קצרה</label><input class="input" id="corr-reason" placeholder="למשל: לחצתי בטעות"></div>
      <button class="btn dark" onclick="App.doCorrect('${id}')">שמירת תיקון</button>`);
  }
  let corrPick = null;
  function _corrPick(k) { corrPick = k; document.querySelectorAll('#sheet .choice').forEach(c => { c.classList.toggle('on', c.dataset.k === k); c.querySelector('.radio').innerHTML = c.dataset.k === k ? icon('check', 14) : ''; }); }
  async function doCorrect(id) {
    try {
      if (!corrPick) return toast('בחרי תוצאה מתוקנת');
      const reason = $('#corr-reason').value;
      await Store().correct(id, corrPick, reason);
      corrPick = null; closeSheet(true); toast('התיקון נרשם. הבנק והמעגל עודכנו.'); render();
    } catch (e) { fail(e); }
  }

  /* ============================================================
     S05 — יצירת מילה (4 צעדים)
     ============================================================ */
  function openWordWizard(prefill = {}) {
    const draft = Mila.getState().drafts.word;
    wiz = Object.assign({ step: 1, title: '', rule: '', icon: 'leaf', startDate: Mila.today(), circleId: null, visibility: 'status' }, draft || {}, prefill, { step: 1 });
    go('wordNew');
  }
  SCREENS.wordNew = () => {
    if (!wiz) wiz = { step: 1, title: '', rule: '', icon: 'leaf', startDate: Mila.today(), circleId: null, visibility: 'status' };
    const steps = `<div class="steps">${[1, 2, 3, 4].map(i => `<i class="${i <= wiz.step ? 'on' : ''}"></i>`).join('')}</div>`;
    const header = topbar({ title: 'לתת מילה', end: `<button class="icon-btn" aria-label="סגירה" onclick="App.wizCancel()">${icon('x', 22)}</button>` });
    if (wiz.step === 1) return `${header}${steps}
      <div class="step-title">אז, על מה את חותמת?</div><div class="step-sub">מילה קטנה, 14 ימים. משהו שאפשר לסמן עליו וי בסוף היום.</div>
      ${templateChips('wizTemplate', wiz.title)}
      <div class="field"><label>כותרת</label><input class="input" id="w-title" placeholder="למשל: 8,000 צעדים ביום" maxlength="60" value="${esc(wiz.title)}" oninput="App.wizSet('title', this.value)"></div>
      <div class="field"><label>מה נחשב הצלחה?</label><textarea class="input" id="w-rule" placeholder="הכלל שלפיו תסמני ״עמדתי במילה״" maxlength="200" oninput="App.wizSet('rule', this.value)">${esc(wiz.rule)}</textarea><div class="hint">בלי מידע רגיש. החברות רואות רק סטטוס, לא פרטים.</div></div>
      <div class="field"><label>אייקון</label><div class="icon-picker">${Mila.WORD_ICONS.map(ic => `<span class="tile ${tileColorFor(wiz.title || ic)} ${wiz.icon === ic ? 'on' : ''}" onclick="App.wizSet('icon','${ic}'); App.refresh()">${icon(ic, 24)}</span>`).join('')}</div></div>
      <div class="mt-lg"><button class="btn primary" onclick="App.wizNext()">המשך</button></div>`;
    if (wiz.step === 2) {
      const opts = [[Mila.today(), 'היום'], [Mila.addDays(Mila.today(), 1), 'מחר'], [nextSunday(), 'יום ראשון הקרוב']];
      return `${header}${steps}
      <div class="step-title">מתי?</div><div class="step-sub">סבב של ${Mila.RULES.ROUND_DAYS} ימים, כל יום. חלון הדיווח נסגר למחרת ב-${Mila.RULES.GRACE_HOUR}:00.</div>
      ${opts.map(([d, l]) => `<div class="choice ${wiz.startDate === d ? 'on' : ''}" onclick="App.wizSet('startDate','${d}'); App.refresh()"><span class="radio">${wiz.startDate === d ? icon('check', 14) : ''}</span><div class="body"><div class="t">${l}</div><div class="m">${Mila.fmtDateLong(d)}</div></div></div>`).join('')}
      <div class="field"><label>או תאריך אחר</label><input class="input ltr" type="date" min="${Mila.today()}" value="${wiz.startDate}" onchange="App.wizSet('startDate', this.value); App.refresh()"></div>
      <div class="kv"><span class="k">${icon('calendar', 18)} משך הסבב</span><span class="v">${Mila.RULES.ROUND_DAYS} ימים · ${Mila.fmtDate(wiz.startDate)} – ${Mila.fmtDate(Mila.addDays(wiz.startDate, 13))}</span></div>
      <div class="kv"><span class="k">${icon('repeat', 18)} תדירות</span><span class="v">מדי יום</span></div>
      <div class="btn-row mt-lg"><button class="btn soft" onclick="App.wizPrev()">חזרה</button><button class="btn primary" onclick="App.wizNext()">המשך</button></div>`;
    }
    if (wiz.step === 3) {
      const circles = Mila.myCircles();
      return `${header}${steps}
      <div class="step-title">מי רואה?</div><div class="step-sub">אפשר לשנות אחר כך רק לכיוון של פחות חשיפה.</div>
      <div class="choice ${!wiz.circleId ? 'on' : ''}" onclick="App.wizSet('circleId', null); App.refresh()"><span class="radio">${!wiz.circleId ? icon('check', 14) : ''}</span><div class="body"><div class="t">מילה פרטית</div><div class="m">רק את רואה. פספוס נרשם אצלך, לא בקופה.</div></div><span class="tile sm gray">${icon('lock', 18)}</span></div>
      ${circles.map(c => `<div class="choice ${wiz.circleId === c.id ? 'on' : ''}" onclick="App.wizSet('circleId','${c.id}'); App.refresh()"><span class="radio">${wiz.circleId === c.id ? icon('check', 14) : ''}</span><div class="body"><div class="t">${esc(c.name)}</div><div class="m">${Mila.circleMembers(c.id).length} חברות · פספוס נזקף לקופת המעגל</div></div>${circleTile(c, 'sm')}</div>`).join('')}
      ${!circles.length ? `<div class="note">${icon('info', 18)}<span>עוד אין לך מעגלים. אפשר להתחיל פרטי ולשתף סיכום אחר כך.</span></div>` : ''}
      ${wiz.circleId ? `<div class="field mt"><label>מה החברות רואות</label>
        <div class="seg"><button class="${wiz.visibility === 'status' ? 'on' : ''}" onclick="App.wizSet('visibility','status'); App.refresh()">סטטוס יומי</button><button class="${wiz.visibility === 'summary' ? 'on' : ''}" onclick="App.wizSet('visibility','summary'); App.refresh()">סיכום בלבד</button></div>
        <div class="hint">${wiz.visibility === 'status' ? 'הצלחה/פספוס מופיעים בפיד המעגל. בלי הוכחות ובלי פרטים.' : 'רק אחוז העמידה בסוף הסבב מוצג במעגל.'}</div></div>` : ''}
      <div class="btn-row mt-lg"><button class="btn soft" onclick="App.wizPrev()">חזרה</button><button class="btn primary" onclick="App.wizNext()">המשך</button></div>`;
    }
    // step 4 — סיכום לפני נתינת מילה
    const cap = Mila.capCheck(Mila.me().id, wiz.startDate);
    const circle = wiz.circleId ? Mila.getState().circles[wiz.circleId] : null;
    return `${header}${steps}
      <div class="step-title">בדיקה אחרונה</div><div class="step-sub">מילה זה דבר שמחזיקים. הנה מה שאת לוקחת על עצמך.</div>
      <div class="card"><div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">${wordTile({ title: wiz.title, icon: wiz.icon }, 'lg')}<div><div class="bold" style="font-size:1.15rem">${esc(wiz.title)}</div><div class="small muted">${esc(wiz.rule)}</div></div></div>
        <div class="kv"><span class="k">${icon('calendar', 18)} סבב</span><span class="v">${Mila.fmtDate(wiz.startDate)} – ${Mila.fmtDate(Mila.addDays(wiz.startDate, 13))}</span></div>
        <div class="kv"><span class="k">${icon('coin', 18)} על הכף</span><span class="v">שקל מילה אחד ליום · עד ${Mila.RULES.ROUND_DAYS}</span></div>
        <div class="kv"><span class="k">${icon('eye', 18)} מי רואה</span><span class="v">${circle ? `${esc(circle.name)} · ${wiz.visibility === 'status' ? 'סטטוס יומי' : 'סיכום'}` : 'רק אני'}</span></div>
        <div class="kv"><span class="k">${icon('users', 18)} תקרה</span><span class="v">${cap.ok ? `${cap.maxCount + 1} מתוך ${Mila.RULES.DAILY_CAP} ביום` : 'מלאה'}</span></div>
      </div>
      ${!cap.ok ? `<div class="note warn">${icon('info', 18)}<span>יש לך כבר שלוש מילים על הכף ב-${cap.conflicts.length} מהימים האלה (${cap.conflictingWords.map(w => esc(w.title)).join(', ')}). ${cap.nextFree ? `אפשר להתחיל ב-${Mila.fmtDate(cap.nextFree)}.` : ''}</span></div>${cap.nextFree ? `<button class="btn soft" onclick="App.wizSet('startDate','${cap.nextFree}'); App.refresh()">להתחיל ב-${Mila.fmtDate(cap.nextFree)}</button>` : ''}` : ''}
      <div class="tiny muted center mt">שקלי מילה הם מטבע משחק בלבד. אין רכישה, פדיון או העברה.</div>
      <div class="btn-row mt"><button class="btn soft" onclick="App.wizPrev()">חזרה</button><button class="btn primary" ${cap.ok ? '' : 'disabled'} onclick="App.wizCommit()">חותמת על זה</button></div>`;
  };
  function nextSunday() { const d = new Date(); const diff = (7 - d.getDay()) % 7 || 7; return Mila.addDays(Mila.today(), diff); }
  function wizSet(k, v) { wiz[k] = v; Mila.getState().drafts.word = { ...wiz }; Mila.save(); }
  function wizTemplate(i) { const t = Mila.TEMPLATES[i]; wiz.title = t.title; wiz.rule = t.rule; wiz.icon = t.icon; wizSet('title', t.title); render(); }
  function wizNext() {
    try {
      if (wiz.step === 1) Mila.getState() && validateStep1();
      if (wiz.step === 2 && wiz.startDate < Mila.today()) throw { userMessage: 'אי אפשר לתת מילה על ימים שעברו' };
      wiz.step += 1; render();
    } catch (e) { fail(e); }
  }
  function validateStep1() { if (!wiz.title.trim()) throw { userMessage: 'צריך כותרת למילה' }; if (!wiz.rule.trim()) throw { userMessage: 'מה נחשב הצלחה? בלי כלל אי אפשר לתת מילה' }; }
  function wizPrev() { wiz.step -= 1; render(); }
  function wizCancel() { Mila.getState().drafts.word = { ...wiz }; Mila.save(); wiz = null; back(); if (Mila.getState().drafts.word && Mila.getState().drafts.word.title) toast('הטיוטה נשמרה'); }
  async function wizCommit() {
    try {
      const { def, commitment } = await Store().createPersonalWord({ title: wiz.title, rule: wiz.rule, icon: wiz.icon, startDate: wiz.startDate, circleId: wiz.circleId, visibility: wiz.circleId ? wiz.visibility : 'private' });
      wiz = null;
      stack = [{ name: 'today', params: {} }];
      go('word', { id: commitment.id, fresh: true });
      stamp('מילה שלי.');
    } catch (e) {
      if (e.code === 'CAP') { wiz.step = 4; render(); }
      fail(e);
    }
  }

  /* ============================================================
     S06 — פרטי מילה
     ============================================================ */
  SCREENS.word = ({ id, fresh }) => {
    const c = Mila.commitment(id);
    if (!c) return `${topbar({ title: 'מילה' })}<div class="empty"><div class="t">המילה לא נמצאה</div></div>`;
    const def = Mila.wordDef(c.defId);
    const st = Mila.commitmentStats(id);
    const circle = def.circleId ? Mila.getState().circles[def.circleId] : null;
    const todayOb = Mila.obligationsOf(id).find(o => o.localDate === Mila.today());
    const obs = Mila.obligationsOf(id).filter(o => o.status !== 'cancelled');
    const correctable = obs.filter(o => Mila.canCorrect(o));
    const mine = c.userId === Mila.me().id;
    return `${topbar({ title: '', end: mine ? `<button class="icon-btn" aria-label="עוד" onclick="App.wordMenu('${id}')">${icon('more', 22)}</button>` : '' })}
      <div class="sheet-hero" style="margin-top:-6px">${wordTile(def, 'lg')}<div class="sheet-title">${esc(def.title)}</div><div class="sheet-sub" style="margin-bottom:6px">${esc(def.rule)}</div>
        <div class="chips">${def.kind === 'group' ? `<span class="chip lav">${icon('users', 13)} מילה קבוצתית</span>` : `<span class="chip">${icon('user', 13)} מילה אישית</span>`}${circle ? `<span class="chip outline" onclick="App.go('circle',{id:'${circle.id}'})">${esc(circle.name)}</span>` : '<span class="chip outline">פרטית</span>'}<span class="chip ${c.status === 'active' ? 'lime' : 'outline'}">${c.status === 'active' ? 'פעילה' : c.status === 'completed' ? 'הסתיימה' : c.status === 'ended_early' ? 'הופסקה' : c.status}</span></div></div>
      ${fresh ? `<div class="note lime">${icon('sparkle', 18)}<span>המילה על הכף מ-${Mila.relDay(c.startDate)}. הדיווח הראשון נפתח ב-${Mila.fmtDate(c.startDate)} ונסגר למחרת ב-${Mila.RULES.GRACE_HOUR}:00.</span></div>` : ''}
      <div class="stat-grid mb"><div class="stat lime"><div class="n">${st.success}</div><div class="l">עמדתי</div></div><div class="stat pink"><div class="n">${st.miss}</div><div class="l">פספסתי</div></div><div class="stat lav"><div class="n">${st.current}${icon('flame', 18)}</div><div class="l">ברצף</div></div></div>
      <div class="card"><div class="card-title">14 הימים <span class="link">${c.status === 'active' ? `יום ${Math.max(st.dayIndex, 1)} מתוך 14` : `${Mila.fmtDate(c.startDate)} – ${Mila.fmtDate(c.endDate)}`}</span></div>${days14(id)}</div>
      ${mine && todayOb && !todayOb.outcome && Mila.isOpenNow(todayOb) ? `<button class="btn primary mb" onclick="App.reportSheet('${todayOb.id}')">${icon('check', 20)} לדווח על היום</button>` : ''}
      <div class="card tight">
        <div class="kv"><span class="k">${icon('calendar', 18)} סבב</span><span class="v">${Mila.fmtDate(c.startDate)} – ${Mila.fmtDate(c.endDate)}</span></div>
        <div class="kv"><span class="k">${icon('chart', 18)} שיעור עמידה</span><span class="v">${st.rate === null ? 'עוד אין מספיק ימים' : pct(st.rate)}</span></div>
        <div class="kv"><span class="k">${icon('minus', 18)} החרגות</span><span class="v">${st.excused} מתוך ${Mila.RULES.MAX_EXCUSES_PER_ROUND}</span></div>
        <div class="kv"><span class="k">${icon('flame', 18)} רצף הכי ארוך</span><span class="v">${st.best} ימים</span></div>
        <div class="kv"><span class="k">${icon('eye', 18)} מי רואה</span><span class="v">${!circle ? 'רק אני' : def.visibility === 'summary' ? 'סיכום בלבד' : 'סטטוס יומי במעגל'}</span></div>
      </div>
      ${correctable.length && mine ? `<div class="section-title">הכרעות אחרונות <small>ניתנות לתיקון 24 שעות</small></div><div class="card tight">${correctable.map(o => `<div class="list-row clickable" onclick="App.reportSheet('${o.id}')"><span class="tile sm ${o.outcome === 'success' ? 'lime' : o.outcome === 'miss' ? 'pink' : 'lav'}">${icon(o.outcome === 'success' ? 'check' : o.outcome === 'miss' ? 'x' : 'minus', 18)}</span><div class="body"><div class="t">${Mila.relDay(o.localDate)} · ${o.outcome === 'success' ? 'עמדתי' : o.outcome === 'miss' ? 'פספסתי' : 'החרגה'}</div><div class="m">${o.resolveReason === 'auto_unreported' ? 'לא דווח – נזקף אוטומטית' : o.correctedAt ? 'תוקן' : 'דיווח עצמי'} · ${Mila.fmtTime(o.resolvedAt)}</div></div>${icon('edit', 18)}</div>`).join('')}</div>` : ''}
    `;
  };
  function wordMenu(id) {
    const c = Mila.commitment(id); const def = Mila.wordDef(c.defId);
    sheet(`<div class="sheet-title">${esc(def.title)}</div><div class="sheet-sub">פעולות על המילה</div>
      ${def.circleId && def.visibility !== 'summary' && def.ownerId === Mila.me().id ? `<div class="list-row clickable" onclick="App.setVisibility('${def.id}','summary')"><span class="tile sm gray">${icon('eyeOff', 18)}</span><div class="body"><div class="t">לצמצם חשיפה לסיכום בלבד</div><div class="m">אי אפשר להרחיב בחזרה בלי לבחור מחדש</div></div></div>` : ''}
      ${c.status === 'active' ? `<div class="list-row clickable" onclick="App.endWord('${id}')"><span class="tile sm pink">${icon('x', 18)}</span><div class="body"><div class="t">לסיים את המילה מוקדם</div><div class="m">הימים שהוכרעו נשארים. ימים עתידיים מתבטלים.</div></div></div>` : ''}
      <div class="list-row clickable" onclick="App.closeSheet(); App.openWordWizard({title:'${esc(def.title).replace(/'/g, '&#39;')}', rule:'${esc(def.rule).replace(/'/g, '&#39;')}', icon:'${def.icon}', startDate:'${c.endDate >= Mila.today() ? Mila.addDays(c.endDate, 1) : Mila.today()}'})"><span class="tile sm lime">${icon('repeat', 18)}</span><div class="body"><div class="t">עוד סיבוב עם אותה מילה</div><div class="m">סבב חדש מתחיל רק כשאת בוחרת</div></div></div>`);
  }
  function endWord(id) {
    confirmSheet({ title: 'לסיים את המילה מוקדם?', sub: 'ההיסטוריה נשמרת. ימים שעוד לא הגיעו לא יחייבו שקל. אפשר לתת אותה מילה שוב בכל זמן.', okText: 'לסיים', okClass: 'pink', onOk: async () => { await Store().endCommitment(id); closeSheet(true); toast('המילה הסתיימה. ההיסטוריה נשמרה.'); render(); } });
  }
  async function setVisibility(defId, vis) { try { await Store().updateWordVisibility(defId, vis); closeSheet(true); render(); toast('החשיפה צומצמה לסיכום בלבד'); } catch (e) { fail(e); } }

  /* ============================================================
     S16 — סיכום סבב
     ============================================================ */
  SCREENS.summary = ({ id }) => {
    const s = Mila.roundSummary(id);
    if (!s.commitment.summarySeen) { s.commitment.summarySeen = true; Store().markSummarySeen(id).catch(() => {}); }
    const rate = s.stats.rate === null ? null : s.stats.rate;
    const line = rate === null ? 'סבב ללא הכרעות' : rate >= 0.85 ? 'כמעט בלי להחמיץ. זו עקביות.' : rate >= 0.6 ? 'רוב הימים עמדת. זה מה שבונה הרגל.' : 'סבב לא פשוט. כל יום שעמדת בו נשמר.';
    return `${topbar({ title: 'המילה האחרונה', back: true })}
      <div class="sheet-hero">${wordTile(s.def, 'lg')}<div class="sheet-title">${rate !== null && s.stats.miss === 0 && s.stats.success >= 14 ? 'מילה בסלע.' : '14 ימים אחרי.'}</div><div class="sheet-sub">הנה כל מה שקיימת ב״${esc(s.def.title)}״</div></div>
      <div class="card balance-card pastel-lime"><div class="label">שקלי מילה שנשמרו בסבב</div><div class="amount">${icon('coins', 34)}<span class="num">${s.earned}</span><span class="cur">₪ מילה</span></div><div class="note" style="display:inline-flex;margin:8px 0 0">${line}</div></div>
      <div class="stat-grid mb"><div class="stat lime"><div class="n">${s.stats.success}</div><div class="l">עמדתי</div></div><div class="stat pink"><div class="n">${s.stats.miss}</div><div class="l">${s.circle ? 'לקופת המעגל' : 'פספסתי'}</div></div><div class="stat lav"><div class="n">${s.stats.excused}</div><div class="l">החרגות</div></div></div>
      <div class="card"><div class="card-title">הסבב יום אחרי יום <span class="link">${s.stats.rate !== null ? pct(s.stats.rate) + ' עמידה' : ''}</span></div>${days14(id)}<div class="kv mt"><span class="k">${icon('flame', 18)} רצף הכי ארוך</span><span class="v">${s.stats.best} ימים</span></div></div>
      ${s.circle ? `<div class="card tight clickable" onclick="App.go('circle',{id:'${s.circle.id}'})"><div class="list-row">${circleTile(s.circle, 'sm')}<div class="body"><div class="t">${esc(s.circle.name)}</div><div class="m">לראות איך עבר הסבב על כולן</div></div>${icon('chev', 18)}</div></div>` : ''}
      <button class="btn primary" onclick="App.openWordWizard({title:'${esc(s.def.title).replace(/'/g, '&#39;')}', rule:'${esc(s.def.rule).replace(/'/g, '&#39;')}', icon:'${s.def.icon}', startDate:'${Mila.today()}'})">${icon('repeat', 20)} עוד סיבוב?</button>
      <button class="btn text mt" onclick="App.tab('today')">לא עכשיו</button>
      <div class="tiny muted center">סבב חדש לא נפתח לבד. רק כשאת בוחרת.</div>`;
  };

  /* ============================================================
     S08 — המעגלים שלי
     ============================================================ */
  SCREENS.circles = () => {
    const circles = Mila.myCircles();
    const S = Mila.getState();
    const pending = S.pendingInvite && !Mila.isMember(S.invites[S.pendingInvite.token] ? S.invites[S.pendingInvite.token].circleId : '') ? S.pendingInvite : null;
    const pendingPreview = pending ? Mila.previewInvite(pending.token) : null;
    const proposals = circles.flatMap(c => Object.values(S.wordDefs).filter(d => d.circleId === c.id && d.kind === 'group' && d.status !== 'cancelled' && !Mila.myAdoption(d.id) && (d.endDate || '9999') >= Mila.today()).map(d => ({ d, c })));
    return `${topbar({ title: 'המעגלים שלי', back: false, end: `<button class="icon-btn lime" aria-label="מעגל חדש" onclick="App.circleAddSheet()">${icon('plus', 22)}</button>` })}
      ${circles.length ? circles.map(c => {
        const members = Mila.circleMembers(c.id);
        const words = Object.values(S.wordDefs).filter(d => d.circleId === c.id && d.status !== 'cancelled' && (d.kind === 'group' ? (d.endDate || '9999') >= Mila.today() : d.visibility !== 'private' && Object.values(S.commitments).some(k => k.defId === d.id && k.status === 'active'))).length;
        return `<div class="row-card" onclick="App.go('circle',{id:'${c.id}'})">${avatarStack(members, 34, 3)}<div class="body"><div class="t">${esc(c.name)}</div><div class="m">${hebrewPlural(words, 'מילה אחת', 'מילים')} · ${hebrewPlural(members.length, 'חברה אחת', 'חברות')}</div></div>${icon('chev', 20)}</div>`;
      }).join('') : `<div class="card empty"><span class="tile lg pink">${icon('users', 28)}</span><div class="t">עוד אין לך מעגל</div><div class="m">מעגל הוא קבוצה פרטית של חברות. כל אחת בוחרת לאילו מילים להצטרף. הצטרפות לא מחייבת כלום.</div><div class="btn-row"><button class="btn primary" onclick="App.go('circleNew')">פותחת מעגל</button><button class="btn ghost" onclick="App.joinByCodeSheet()">יש לי קוד</button></div></div>`}

      ${pendingPreview && pendingPreview.ok ? `<div class="section-title">הזמנות חדשות</div>
        <div class="row-card" onclick="App.openInvite('${pending.token}')">${avatarStack([pendingPreview.inviter], 40, 1)}<div class="body"><div class="t">${esc(pendingPreview.inviter.name)} הזמינה אותך</div><div class="m">${esc(pendingPreview.circle.name)}${pendingPreview.sampleWord ? ` · לאתגר: ${esc(pendingPreview.sampleWord.title)}` : ''}</div></div>${icon('chev', 20)}</div>` : ''}

      ${proposals.length ? `<div class="section-title">מילים שמחכות לך</div>${proposals.map(({ d, c }) => `<div class="word-row" onclick="App.go('groupWord',{id:'${d.id}'})">${wordTile(d)}<div class="body"><div class="name">${esc(d.title)}</div><div class="meta"><span class="chip outline">${esc(c.name)}</span><span class="chip lav">${Mila.adopters(d.id).length} בפנים</span></div></div>${icon('chev', 18)}</div>`).join('')}` : ''}
      ${circles.length ? `<div class="note mt">${icon('info', 18)}<span>הזמנה למעגל היא קישור או קוד. לא נבקש גישה לאנשי הקשר שלך.</span></div>` : ''}`;
  };
  function circleAddSheet() {
    sheet(`<div class="sheet-title">מעגל חדש</div><div class="sheet-sub">קבוצה פרטית. רק מי שקיבלה קישור יכולה להצטרף.</div>
      <div class="list-row clickable" onclick="App.closeSheet(); App.go('circleNew')"><span class="tile sm lime">${icon('plus', 18)}</span><div class="body"><div class="t">פותחת מעגל</div><div class="m">שם, תיאור, קישור הזמנה. פחות מדקה.</div></div>${icon('chev', 18)}</div>
      <div class="list-row clickable" onclick="App.joinByCodeSheet()"><span class="tile sm pink">${icon('link', 18)}</span><div class="body"><div class="t">מצטרפת עם קוד</div><div class="m">קיבלת קוד או קישור מחברה</div></div>${icon('chev', 18)}</div>`);
  }
  function joinByCodeSheet() {
    sheet(`<div class="sheet-title">הצטרפות למעגל</div><div class="sheet-sub">הדביקי את הקוד מהקישור שקיבלת.</div>
      <div class="input-row"><input class="input ltr" id="join-code" placeholder="ABC123" maxlength="6" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.15em;text-align:center"><button class="btn dark sm" onclick="App.joinByCode()">בדיקה</button></div>
      <div class="tiny muted mt">הצטרפות למעגל לא יוצרת התחייבות ולא מחייבת שקל.</div>`);
    setTimeout(() => $('#join-code') && $('#join-code').focus(), 50);
  }
  async function joinByCode() {
    const raw = ($('#join-code').value || '').trim();
    const m = raw.match(/invite=([A-Za-z0-9]+)/);
    const token = (m ? m[1] : raw).toUpperCase();
    try {
      const p = await Store().previewInvite(token);
      if (!p.ok) return toast(p.reason === 'not_found' ? 'הקוד לא נמצא. בדקי אותו שוב.' : p.reason === 'expired' ? 'תוקף הקוד פג. בקשי קישור חדש.' : 'לא ניתן להשתמש בקוד הזה');
      closeSheet(true); go('invite', { token });
    } catch (e) { fail(e); }
  }
  /* טוען תצוגה מקדימה של הזמנה (בענן – מהשרת) ואז מנווט */
  async function openInvite(token) {
    try { await Store().previewInvite(token); go('invite', { token }); } catch (e) { fail(e); }
  }

  /* ============================================================
     S10 — יצירת מעגל
     ============================================================ */
  SCREENS.circleNew = () => {
    if (!cwiz) cwiz = { name: '', description: '', whoCanPropose: 'all', maxMembers: 8, color: 'pink' };
    return `${topbar({ title: 'מעגל חדש' })}
      <div class="step-title">איך קוראים למעגל?</div><div class="step-sub">רק החברות יראו את השם. אפשר לשנות אחר כך.</div>
      <div class="field"><label>שם המעגל</label><input class="input" placeholder="למשל: הבנות מהמשרד" maxlength="50" value="${esc(cwiz.name)}" oninput="App.cwSet('name', this.value)"></div>
      <div class="field"><label>תיאור קצר (לא חובה)</label><input class="input" placeholder="על מה המעגל הזה?" maxlength="120" value="${esc(cwiz.description)}" oninput="App.cwSet('description', this.value)"></div>
      <div class="field"><label>צבע</label><div class="chips">${Mila.AVATAR_COLORS.map(c => `<button class="chip select ${cwiz.color === c ? 'on' : ''}" onclick="App.cwSet('color','${c}'); App.refresh()"><span class="tile sm ${COLOR_TO_TILE[c]}" style="width:18px;height:18px;border-radius:6px"></span> ${{ lime: 'ליים', pink: 'ורוד', lavender: 'לבנדר', mint: 'מנטה', peach: 'אפרסק', sky: 'תכלת' }[c]}</button>`).join('')}</div></div>
      <div class="field"><label>מי יכולה להציע מילים?</label><div class="seg"><button class="${cwiz.whoCanPropose === 'all' ? 'on' : ''}" onclick="App.cwSet('whoCanPropose','all'); App.refresh()">כולן</button><button class="${cwiz.whoCanPropose === 'admins' ? 'on' : ''}" onclick="App.cwSet('whoCanPropose','admins'); App.refresh()">מנהלות בלבד</button></div></div>
      <div class="field"><label>מקסימום חברות</label><div class="chips">${[4, 6, 8, 12].map(n => `<button class="chip select ${cwiz.maxMembers === n ? 'on' : ''}" onclick="App.cwSet('maxMembers',${n}); App.refresh()">${n}</button>`).join('')}</div><div class="hint">כל אחת בוחרת בעצמה אם להצטרף למילה. אין הפעלה אוטומטית.</div></div>
      <div class="mt-lg"><button class="btn primary" ${cwiz.name.trim() ? '' : 'disabled'} onclick="App.cwCreate()">יצירת המעגל וקישור הזמנה</button></div>`;
  };
  function cwSet(k, v) { cwiz[k] = v; const b = $('#screen .btn.primary'); if (b) b.disabled = !cwiz.name.trim(); }
  async function cwCreate() {
    try {
      const { circle } = await Store().createCircle(cwiz);
      cwiz = null;
      stack = [{ name: 'circles', params: {} }];
      go('circle', { id: circle.id });
      setTimeout(() => inviteSheet(circle.id), 350);
    } catch (e) { fail(e); }
  }

  /* ============================================================
     S09 — בתוך מעגל
     ============================================================ */
  SCREENS.circle = ({ id }) => {
    const S = Mila.getState();
    const c = S.circles[id];
    if (!c || !Mila.isMember(id)) return `${topbar({ title: 'מעגל' })}<div class="empty"><div class="t">אין גישה למעגל הזה</div><div class="m">אולי עזבת אותו או שהוא נסגר.</div></div>`;
    const members = Mila.circleMembers(id);
    const round = Mila.circleRound(id);
    const pool = Mila.circlePool(id, round);
    const groupWords = Object.values(S.wordDefs).filter(d => d.circleId === id && d.kind === 'group' && d.status !== 'cancelled').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const liveGroup = groupWords.filter(d => (d.endDate || '9999') >= Mila.today());
    const hero = liveGroup[0];
    const heroAdopters = hero ? Mila.adopters(hero.id) : [];
    const canPropose = c.whoCanPropose === 'all' || Mila.isAdmin(id);
    return `${topbar({ title: 'המילה שלנו', end: `${canPropose ? `<button class="icon-btn lime" aria-label="מילה חדשה למעגל" onclick="App.openGroupWizard('${id}')">${icon('plus', 22)}</button>` : ''}<button class="icon-btn" aria-label="עוד" onclick="App.circleMenu('${id}')">${icon('more', 22)}</button>` })}
      <div class="avatar-hero">${avatarStack(members, 44, 3)}</div>
      <div class="center"><div class="bold" style="font-size:1.35rem">${hero ? esc(hero.title) : esc(c.name)}</div><div class="muted small">${hero ? `האתגר של מעגל ${esc(c.name)}` : (c.description ? esc(c.description) : 'מעגל פרטי')}</div>
        <div class="chips" style="justify-content:center;margin-top:10px">${hero ? `<span class="chip lav">${avatarStack(heroAdopters, 18, 3)} ${heroAdopters.length} בפנים</span>` : ''}<span class="chip">${members.length} חברות</span></div></div>

      <div class="card mt" style="padding:14px 16px"><div class="two-col">
        <div class="mini-card"><div class="l">התקדמות הסבב</div><div class="v">${round.dayIndex} מתוך ${Mila.RULES.ROUND_DAYS} ימים</div><div class="progress mt" style="margin-top:8px"><i style="width:${(round.dayIndex / Mila.RULES.ROUND_DAYS) * 100}%"></i></div></div>
        <div class="mini-card"><div class="l">קופת המעגל</div><div class="v pool"><span class="big">${icon('coins', 22)}${pool}</span></div><div class="tiny muted">שקלי פספוס בסבב · מטבע משחק</div></div>
      </div></div>

      ${hero && !Mila.myAdoption(hero.id) ? `<div class="card pastel-lime clickable tight" onclick="App.go('groupWord',{id:'${hero.id}'})"><div style="display:flex;align-items:center;gap:12px">${wordTile(hero)}<div style="flex:1"><div class="bold">עוד לא בפנים</div><div class="small muted">לראות את התנאים ולהחליט. בלי לחץ.</div></div><button class="btn primary sm">אני בפנים</button></div></div>` : ''}

      <div class="tabs">${[['feed', 'פעילות'], ['rank', 'דירוג'], ['words', 'מילים'], ['members', 'חברות']].map(([k, l]) => `<button class="${circleTab === k ? 'on' : ''}" onclick="App.setCircleTab('${k}')">${l}</button>`).join('')}</div>
      ${circleTab === 'feed' ? circleFeed(id) : circleTab === 'rank' ? circleRank(id) : circleTab === 'words' ? circleWords(id, groupWords) : circleMembersView(id, members)}
    `;
  };
  function setCircleTab(k) { circleTab = k; render(); }

  function feedText(e) {
    const n = `<b>${esc(e.actor.name)}</b>`;
    const t = e.payload && e.payload.title ? `״${esc(e.payload.title)}״` : '';
    switch (e.type) {
      case 'day_success': return `${n} שמרה שקל ב-${t}`;
      case 'day_miss': return `${n} פספסה היום ב-${t}. מחר שוב.`;
      case 'day_excused': return `${n} החריגה יום ב-${t}`;
      case 'streak': return `${n} השלימה ${e.payload.streak} ימים רצופים ב-${t} ${icon('flame', 14)}`;
      case 'group_word_proposed': return `${n} מציעה מילה חדשה: ${t}`;
      case 'group_word_adopted': return `${n} הצטרפה ל-${t}`;
      case 'word_committed': return `${n} נתנה מילה: ${t}`;
      case 'member_joined': return `${n} הצטרפה למעגל`;
      case 'member_left': return `${n} עזבה את המעגל`;
      case 'member_removed': return `${n} הסירה חברה מהמעגל`;
      case 'admin_transferred': return `${n} היא עכשיו מנהלת המעגל`;
      case 'circle_created': return `${n} פתחה את המעגל`;
      case 'encouragement': { const to = Mila.user(e.payload.toUserId); return `${n} שלחה ${REACTION_LABEL[e.payload.reaction] || 'עידוד'} ל${to ? esc(to.name) : 'חברה'} ${icon(REACTION_ICON[e.payload.reaction] || 'clap', 14)}`; }
      default: return `${n} · ${e.type}`;
    }
  }
  function timeAgo(iso) {
    const diff = (Date.now() - new Date(iso)) / 60000;
    if (diff < 1) return 'עכשיו'; if (diff < 60) return `לפני ${Math.round(diff)} דק׳`;
    if (diff < 60 * 24) return `לפני ${Math.round(diff / 60)} שע׳`;
    const d = Mila.diffDays(Mila.toLocalDate(new Date(iso)), Mila.today());
    return d === 1 ? 'אתמול' : d < 7 ? `לפני ${d} ימים` : Mila.fmtDate(Mila.toLocalDate(new Date(iso)));
  }
  function circleFeed(id) {
    const items = Mila.feed(id, 25);
    if (!items.length) return `<div class="empty"><span class="tile lg lav">${icon('sparkle', 28)}</span><div class="t">עוד שקט כאן</div><div class="m">כשחברות מדווחות, מצטרפות או שולחות עידוד – זה מופיע פה.</div></div>`;
    return `<div class="card tight">${items.map(e => `<div class="feed-item">${avatar(e.actor, 38)}<div class="body"><div class="t">${feedText(e)}</div><div class="m">${timeAgo(e.createdAt)}</div>
      ${['day_success', 'streak', 'group_word_adopted', 'word_committed'].includes(e.type) ? `<div class="reactions">${Mila.REACTIONS.map(r => { const n = e.reactions.filter(x => x.reaction === r).length; const mine = e.reactions.some(x => x.reaction === r && x.userId === Mila.me().id); return (n || true) ? `<button class="react ${mine ? 'on' : ''}" onclick="App.react('${e.id}','${r}')">${icon(REACTION_ICON[r], 14)}${n ? ` ${n}` : ''}</button>` : ''; }).join('')}</div>` : ''}
    </div></div>`).join('')}</div>`;
  }
  function circleRank(id) {
    const { round, rows } = Mila.leaderboard(id);
    const meId = Mila.me().id;
    return `<div class="card tight"><div class="tiny muted" style="padding:6px 0 4px">סבב ${round.index} · ${Mila.fmtDate(round.start)} – ${Mila.fmtDate(round.end)} · לפי שיעור עמידה, לא לפי כמות מילים</div>
      ${rows.map(r => `<div class="rank-row ${r.place === 1 ? 'first' : ''} ${r.user.id === meId ? 'me' : ''}"><span class="place">${r.place ?? '–'}</span>${avatar(r.user, 38)}<div class="body"><div class="t">${esc(r.user.name)}${r.user.id === meId ? ' (את)' : ''}</div><div class="m">${r.hidden ? 'בחרה להסתיר מהדירוג' : r.ranked ? `${r.success} הצלחות · ${r.miss} פספוסים${r.streak ? ` · ${r.streak} ברצף` : ''}` : r.words ? 'אין מספיק פעילות לדירוג' : 'עוד לא הצטרפה למילה'}</div></div><span class="rate">${r.ranked ? pct(r.rate) : ''}</span>${r.user.id !== meId ? `<button class="icon-btn" aria-label="עידוד" onclick="App.encourageSheet('${id}','${r.user.id}')">${icon('clap', 20)}</button>` : ''}</div>`).join('')}
    </div><div class="tiny muted center mt">שוויון מלא = מקום משותף. החרגות לא נספרות.</div>`;
  }
  function circleWords(id, groupWords) {
    const S = Mila.getState();
    const personal = Object.values(S.wordDefs).filter(d => d.circleId === id && d.kind === 'personal' && d.visibility !== 'private');
    const canPropose = S.circles[id].whoCanPropose === 'all' || Mila.isAdmin(id);
    return `${canPropose ? `<button class="btn ghost mb" onclick="App.openGroupWizard('${id}')">${icon('plus', 20)} להציע מילה למעגל</button>` : ''}
      ${groupWords.length ? `<div class="section-title" style="margin-top:6px">מילים משותפות</div>${groupWords.map(d => { const ad = Mila.adopters(d.id); const mine = Mila.myAdoption(d.id); const over = (d.endDate || '9999') < Mila.today(); return `<div class="word-row" onclick="App.go('groupWord',{id:'${d.id}'})">${wordTile(d)}<div class="body"><div class="name">${esc(d.title)}</div><div class="meta">${avatarStack(ad, 18, 4)} ${ad.length} בפנים ${mine ? '<span class="chip lime">את בפנים</span>' : over ? '<span class="chip">הסתיימה</span>' : '<span class="chip lav">פתוחה</span>'}</div></div>${icon('chev', 18)}</div>`; }).join('')}` : ''}
      ${personal.length ? `<div class="section-title">מילים אישיות שחברות משתפות</div>${personal.map(d => { const k = Object.values(S.commitments).find(x => x.defId === d.id && x.status === 'active'); const u = Mila.user(d.ownerId); const st = k ? Mila.commitmentStats(k.id) : null; return `<div class="word-row" ${d.ownerId === Mila.me().id && k ? `onclick="App.go('word',{id:'${k.id}'})"` : ''}>${wordTile(d)}<div class="body"><div class="name">${esc(d.title)}</div><div class="meta">${avatar(u, 16)} ${esc(u.name)}${st && d.visibility === 'status' ? ` · ${st.success} הצלחות${st.current ? ` · ${st.current} ברצף` : ''}` : ''}</div></div></div>`; }).join('')}` : ''}
      ${!groupWords.length && !personal.length ? `<div class="empty"><span class="tile lg lime">${icon('pencil', 28)}</span><div class="t">עוד אין מילים במעגל</div><div class="m">הציעי מילה משותפת. כל חברה בוחרת אם להצטרף.</div></div>` : ''}`;
  }
  function circleMembersView(id, members) {
    const meId = Mila.me().id; const admin = Mila.isAdmin(id); const c = Mila.getState().circles[id];
    return `<div class="card tight">${members.map(u => `<div class="list-row">${avatar(u, 40)}<div class="body"><div class="t">${esc(u.name)}${u.id === meId ? ' (את)' : ''}</div><div class="m">${u.role === 'admin' ? 'מנהלת המעגל' : 'חברה'} · מאז ${Mila.fmtDate(Mila.toLocalDate(new Date(u.joinedAt)))}</div></div>${u.id !== meId ? `<button class="icon-btn" aria-label="בטיחות" onclick="App.safetySheet('${u.id}','${id}')">${icon('shield', 20)}</button>` : ''}${admin && u.id !== meId ? `<button class="icon-btn" aria-label="הסרה" onclick="App.removeMember('${id}','${u.id}')">${icon('x', 20)}</button>` : ''}</div>`).join('')}</div>
      <button class="btn ghost mt" onclick="App.inviteSheet('${id}')">${icon('share', 20)} להזמין חברה</button>
      <div class="tiny muted center mt">${members.length} מתוך ${c.maxMembers} מקומות</div>`;
  }
  function removeMember(circleId, userId) {
    const u = Mila.user(userId);
    confirmSheet({ title: `להסיר את ${u.name} מהמעגל?`, sub: 'היא לא תוכל לראות את המעגל ואת התוצאות העתידיות. היתרה האישית שלה לא נמחקת.', okText: 'להסיר', okClass: 'pink', onOk: async () => { await Store().removeMember(circleId, userId); closeSheet(true); render(); toast('הוסרה מהמעגל'); } });
  }
  function encourageSheet(circleId, toUserId) {
    const u = Mila.user(toUserId);
    sheet(`<div class="sheet-title">מילה טובה ל${esc(u.name)}</div><div class="sheet-sub">בלי טקסט חופשי. רק מילה טובה.</div>
      <div class="react-picker">${Mila.REACTIONS.map(r => `<button title="${REACTION_LABEL[r]}" onclick="App.sendEncouragement('${circleId}','${toUserId}','${r}')">${icon(REACTION_ICON[r], 24)}</button>`).join('')}</div>`);
  }
  async function react(eventId, reaction) { try { await Store().encourage(eventId, reaction); render(); } catch (e) { fail(e); } }
  async function sendEncouragement(circleId, toUserId, reaction) { try { await Store().sendEncouragement(circleId, toUserId, reaction); closeSheet(true); toast(`נשלח ${REACTION_LABEL[reaction]}`); render(); } catch (e) { fail(e); } }
  function circleMenu(id) {
    const admin = Mila.isAdmin(id);
    const c = Mila.getState().circles[id];
    sheet(`<div class="sheet-title">${esc(c.name)}</div>
      ${c.whoCanPropose === 'all' || admin ? `<div class="list-row clickable" onclick="App.closeSheet(); App.openGroupWizard('${id}')"><span class="tile sm lav">${icon('pencil', 18)}</span><div class="body"><div class="t">להציע מילה למעגל</div><div class="m">כלל אחד לכולן, כל אחת בוחרת אם להצטרף</div></div></div>` : ''}
      <div class="list-row clickable" onclick="App.inviteSheet('${id}')"><span class="tile sm lime">${icon('share', 18)}</span><div class="body"><div class="t">להזמין חברה</div><div class="m">קישור או קוד עם תוקף</div></div></div>
      ${admin ? `<div class="list-row clickable" onclick="App.closeSheet(); App.go('circleManage',{id:'${id}'})"><span class="tile sm lav">${icon('settings', 18)}</span><div class="body"><div class="t">ניהול המעגל</div><div class="m">שם, הרשאות, קישור, חברות</div></div></div>` : ''}
      <div class="list-row clickable" onclick="App.closeSheet(); App.safetySheet(null,'${id}')"><span class="tile sm gray">${icon('flag', 18)}</span><div class="body"><div class="t">דיווח על המעגל</div><div class="m">תוכן פוגעני או לחץ</div></div></div>
      <div class="list-row clickable" onclick="App.leaveCircle('${id}')"><span class="tile sm pink">${icon('logout', 18)}</span><div class="body"><div class="t">לעזוב את המעגל</div><div class="m">המילים שלך במעגל יסתיימו. ההיסטוריה נשמרת.</div></div></div>`);
  }
  function leaveCircle(id) {
    confirmSheet({ title: 'לעזוב את המעגל?', sub: 'לא תראי יותר את המעגל ותוצאותיו. מילים פעילות במעגל יסתיימו מוקדם. השקלים שנשמרו נשארים בבנק שלך.', okText: 'לעזוב', okClass: 'pink', onOk: async () => { await Store().leaveCircle(id); closeSheet(true); tab('circles'); toast('עזבת את המעגל'); } });
  }
  async function inviteSheet(circleId) {
    try {
      let token = Store().inviteToken(circleId);
      if (!token) token = (await Store().createInvite(circleId)).token;
      const url = Mila.inviteUrl(token);
      const inv = Object.values(Mila.getState().invites).filter(i => i.circleId === circleId && i.status === 'active').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      sheet(`<div class="sheet-title">מי איתך במעגל?</div><div class="sheet-sub">בחרי את החברות שיעזרו לך לעמוד במילה שלך. שלחי להן את הקוד או את הקישור, והן בפנים. כל אחת בוחרת לבד לאילו מילים להצטרף.</div>
        <div class="card soft center" style="margin-bottom:12px"><div class="tiny muted">קוד הזמנה</div><div class="bold" style="font-size:2rem;letter-spacing:.2em;direction:ltr">${token}</div><div class="tiny muted">${inv ? `בתוקף עד ${Mila.fmtDate(Mila.toLocalDate(new Date(inv.expiresAt)))} · ${inv.maxUses - inv.uses} שימושים` : 'בתוקף 7 ימים'}</div></div>
        <div class="btn-row"><button class="btn dark" onclick="App.shareInvite('${esc(url)}')">${icon('share', 18)} שיתוף</button><button class="btn soft" onclick="App.copyText('${esc(url)}')">${icon('copy', 18)} העתקה</button></div>
        ${Mila.isAdmin(circleId) ? `<button class="btn text mt" onclick="App.rotateInvite('${circleId}')">הקוד דלף? להנפיק קוד חדש</button>` : ''}`);
    } catch (e) { fail(e); }
  }
  async function rotateInvite(circleId) { try { await Store().revokeCircleInvites(circleId); toast('הקישורים הקודמים בוטלו. נוצר קישור חדש'); inviteSheet(circleId); } catch (e) { fail(e); } }
  async function shareInvite(url) {
    const text = `יש לי מילה איתך. בואי למעגל שלי במילה, נעמוד בזה ביחד: ${url}`;
    if (navigator.share) { try { await navigator.share({ text }); } catch (e) { /* בוטל */ } }
    else copyText(text);
  }
  async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('הועתק'); } catch (e) { toast('לא הצלחנו להעתיק'); } }

  /* ---------- S20 — ניהול מעגל ---------- */
  SCREENS.circleManage = ({ id }) => {
    const c = Mila.getState().circles[id];
    if (!Mila.isAdmin(id)) return `${topbar({ title: 'ניהול מעגל' })}<div class="empty"><div class="t">רק מנהלת יכולה לנהל</div></div>`;
    const inv = Object.values(Mila.getState().invites).filter(i => i.circleId === id && i.status === 'active').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return `${topbar({ title: 'ניהול מעגל' })}
      <div class="field"><label>שם</label><input class="input" value="${esc(c.name)}" maxlength="50" onchange="App.cmSet('${id}','name',this.value)"></div>
      <div class="field"><label>תיאור</label><input class="input" value="${esc(c.description)}" maxlength="120" onchange="App.cmSet('${id}','description',this.value)"></div>
      <div class="field"><label>מי מציעה מילים</label><div class="seg"><button class="${c.whoCanPropose === 'all' ? 'on' : ''}" onclick="App.cmSet('${id}','whoCanPropose','all')">כולן</button><button class="${c.whoCanPropose === 'admins' ? 'on' : ''}" onclick="App.cmSet('${id}','whoCanPropose','admins')">מנהלות בלבד</button></div></div>
      <div class="field"><label>מקסימום חברות</label><div class="chips">${[4, 6, 8, 12].map(n => `<button class="chip select ${c.maxMembers === n ? 'on' : ''}" onclick="App.cmSet('${id}','maxMembers',${n})">${n}</button>`).join('')}</div></div>
      <div class="card tight"><div class="card-title">קישור הזמנה</div>${inv ? `<div class="kv"><span class="k">קוד</span><span class="v" style="direction:ltr;letter-spacing:.15em">${inv.token || (inv.hint + '····')}</span></div><div class="kv"><span class="k">תוקף</span><span class="v">${Mila.fmtDate(Mila.toLocalDate(new Date(inv.expiresAt)))}</span></div><div class="kv"><span class="k">שימושים</span><span class="v">${inv.uses} / ${inv.maxUses}</span></div><div class="btn-row mt"><button class="btn soft sm" onclick="App.inviteSheet('${id}')">שיתוף</button><button class="btn danger sm" onclick="App.rotateInvite('${id}')">ביטול והנפקה מחדש</button></div>` : `<button class="btn soft sm" onclick="App.inviteSheet('${id}')">הנפקת קישור חדש</button>`}</div>
      <div class="note">${icon('info', 18)}<span>מנהלת לא יכולה להפעיל מילה, לערוך דיווח או לשנות יתרה עבור אחרת. אם תעזבי, הניהול עובר לחברה הוותיקה.</span></div>`;
  };
  async function cmSet(id, k, v) { try { await Store().updateCircle(id, { [k]: v }); render(); } catch (e) { fail(e); } }

  /* ============================================================
     S11 — קבלת הזמנה
     ============================================================ */
  SCREENS.invite = ({ token }) => {
    const p = Store().cachedPreview(token) || { ok: false, reason: 'not_found' };
    if (!p.ok) return `${topbar({ title: 'הזמנה' })}<div class="card empty"><span class="tile lg gray">${icon('hourglass', 28)}</span><div class="t">${p.reason === 'expired' ? 'תוקף ההזמנה פג' : p.reason === 'revoked' ? 'ההזמנה בוטלה' : 'ההזמנה לא נמצאה'}</div><div class="m">${p.reason === 'expired' ? 'בקשי מהחברה קישור חדש. זה לוקח שנייה.' : 'בדקי את הקוד או בקשי קישור חדש.'}</div><button class="btn soft" onclick="App.tab('circles')">למעגלים שלי</button></div>`;
    return `${topbar({ title: 'הזמנה למעגל' })}
      <div class="sheet-hero">${avatar(p.inviter, 72)}<div class="sheet-title" style="margin-top:10px">יש לי מילה איתך.</div><div class="sheet-sub">${esc(p.inviter.name)} מזמינה אותך למעגל${p.sampleWord ? `. היא נתנה מילה: ${esc(p.sampleWord.title)}` : ''}. ועכשיו היא רוצה לדעת אם גם את בפנים.</div></div>
      <div class="card"><div style="display:flex;gap:12px;align-items:center">${circleTile(p.circle, 'lg')}<div><div class="bold" style="font-size:1.15rem">${esc(p.circle.name)}</div><div class="small muted">${esc(p.circle.description || 'מעגל פרטי')}</div></div></div>
        <div class="divider"></div>
        <div class="kv"><span class="k">${icon('users', 18)} חברות</span><span class="v">${p.memberCount} מתוך ${p.maxMembers}</span></div>
        <div class="kv"><span class="k">${icon('calendar', 18)} סבב נוכחי</span><span class="v">${p.round.dayIndex > 0 ? `יום ${p.round.dayIndex} מתוך 14` : `מתחיל ב-${Mila.fmtDate(p.round.start)}`}</span></div>
        ${p.sampleWord ? `<div class="kv"><span class="k">${icon('pencil', 18)} מילה לדוגמה</span><span class="v">${esc(p.sampleWord.title)}</span></div>` : ''}
        <div class="kv"><span class="k">${icon('eye', 18)} מה רואים</span><span class="v">שם, סטטוס יומי לפי בחירתך</span></div>
      </div>
      <div class="note lime">${icon('shield', 18)}<span>הצטרפות למעגל לא מחייבת שקל ולא מפעילה מילה. את בוחרת לאילו מילים להצטרף, אם בכלל.</span></div>
      ${p.alreadyMember ? `<button class="btn primary" onclick="App.go('circle',{id:'${p.circle.id}'})">את כבר במעגל · לפתוח</button>` : `<button class="btn primary" onclick="App.acceptInvite('${token}')">הצטרפי למעגל</button>`}
      <div class="btn-row mt"><button class="btn text" onclick="App.declineInvite('${token}')">הפעם לא</button><button class="btn text" onclick="App.safetySheet('${p.inviter.id}', null, '${token}')">${icon('flag', 16)} דיווח</button></div>`;
  };
  async function acceptInvite(token) {
    try { const c = await Store().acceptInvite(token); const S = Mila.getState(); if (S.pendingInvite && S.pendingInvite.token === token) { delete S.pendingInvite; Mila.save(); } stack = [{ name: 'circles', params: {} }]; go('circle', { id: c.id }); toast('הצטרפת למעגל. שום מילה לא מתחילה בלי שתבחרי.', 'lime'); } catch (e) { fail(e); }
  }
  function declineInvite(token) { const S = Mila.getState(); if (S.pendingInvite && S.pendingInvite.token === token) { delete S.pendingInvite; Mila.save(); } back('circles'); }

  /* ============================================================
     S12 — הצעת מילה קבוצתית
     ============================================================ */
  function openGroupWizard(circleId) { const r = Mila.circleRound(circleId); gwiz = { circleId, title: '', rule: '', icon: 'leaf', startDate: r.dayIndex <= 2 ? r.start : Mila.today(), visibility: 'status' }; go('groupWordNew'); }
  SCREENS.groupWordNew = () => {
    const c = Mila.getState().circles[gwiz.circleId];
    const r = Mila.circleRound(gwiz.circleId);
    const opts = [[Mila.today(), 'מהיום', '14 יום מהיום, מי שמצטרפת אחר כך מתחילה מהיום שלה'], [r.nextStart, 'בסבב הבא', `מתחיל ב-${Mila.fmtDate(r.nextStart)}, כולן באותו קו התחלה`]];
    return `${topbar({ title: 'המילה שלנו', subtitle: c.name })}
      <div class="step-title">מה מציעים למעגל?</div><div class="step-sub">כלל אחד זהה לכולן, אבל כל אחת נמדדת בפני עצמה. אין קנס אמיתי ואין כישלון קולקטיבי.</div>
      ${templateChips('gwTemplate', gwiz.title)}
      <div class="field"><label>כותרת</label><input class="input" placeholder="למשל: 8,000 צעדים ביום" maxlength="60" value="${esc(gwiz.title)}" oninput="App.gwSet('title', this.value)"></div>
      <div class="field"><label>מה נחשב הצלחה?</label><textarea class="input" maxlength="200" placeholder="כלל ברור שכולן יכולות למדוד" oninput="App.gwSet('rule', this.value)">${esc(gwiz.rule)}</textarea></div>
      <div class="field"><label>אייקון</label><div class="icon-picker">${Mila.WORD_ICONS.map(ic => `<span class="tile ${tileColorFor(gwiz.title || ic)} ${gwiz.icon === ic ? 'on' : ''}" onclick="App.gwSet('icon','${ic}'); App.refresh()">${icon(ic, 24)}</span>`).join('')}</div></div>
      <div class="field"><label>מתי מתחילים?</label>${opts.map(([d, l, m]) => `<div class="choice ${gwiz.startDate === d ? 'on' : ''}" onclick="App.gwSet('startDate','${d}'); App.refresh()"><span class="radio">${gwiz.startDate === d ? icon('check', 14) : ''}</span><div class="body"><div class="t">${l}</div><div class="m">${m}</div></div></div>`).join('')}</div>
      <div class="field"><label>מה החברות רואות</label><div class="seg"><button class="${gwiz.visibility === 'status' ? 'on' : ''}" onclick="App.gwSet('visibility','status'); App.refresh()">סטטוס יומי</button><button class="${gwiz.visibility === 'summary' ? 'on' : ''}" onclick="App.gwSet('visibility','summary'); App.refresh()">סיכום בלבד</button></div></div>
      <div class="mt-lg"><button class="btn primary" onclick="App.gwPropose()">להציע למעגל</button></div>
      <div class="tiny muted center mt">ההצעה לא מחייבת אף אחת, גם לא אותך. אחרי שמישהי מצטרפת, שינוי מהותי דורש הסכמה מחדש.</div>`;
  };
  function gwSet(k, v) { gwiz[k] = v; }
  function gwTemplate(i) { const t = Mila.TEMPLATES[i]; gwiz.title = t.title; gwiz.rule = t.rule; gwiz.icon = t.icon; render(); }
  async function gwPropose() {
    try { const def = await Store().proposeGroupWord(gwiz.circleId, gwiz); const cid = gwiz.circleId; gwiz = null; stack = [{ name: 'circles', params: {} }, { name: 'circle', params: { id: cid } }]; go('groupWord', { id: def.id, fresh: true }); } catch (e) { fail(e); }
  }

  /* ============================================================
     S13 — אימוץ מילה קבוצתית
     ============================================================ */
  SCREENS.groupWord = ({ id, fresh }) => {
    const def = Mila.wordDef(id);
    if (!def || !Mila.isMember(def.circleId)) return `${topbar({ title: 'מילה' })}<div class="empty"><div class="t">אין גישה</div></div>`;
    const circle = Mila.getState().circles[def.circleId];
    const ad = Mila.adopters(id);
    const mine = Mila.myAdoption(id);
    const start = def.startDate < Mila.today() ? Mila.today() : def.startDate;
    const over = (def.endDate || '9999') < Mila.today();
    const cap = mine || over ? { ok: true } : Mila.capCheck(Mila.me().id, start);
    const owner = Mila.user(def.ownerId);
    const canCancel = !ad.length && (def.ownerId === Mila.me().id || Mila.isAdmin(def.circleId)) && def.status === 'proposed';
    return `${topbar({ title: 'המילה שלנו', subtitle: circle.name })}
      <div class="sheet-hero">${wordTile(def, 'lg')}<div class="sheet-title">${esc(def.title)}</div><div class="sheet-sub" style="margin-bottom:8px">${esc(def.rule)}</div><div class="chips" style="justify-content:center"><span class="chip">${avatar(owner, 16)} הציעה ${esc(owner.name)}</span><span class="chip lav">${ad.length} בפנים</span>${mine ? '<span class="chip lime">את בפנים</span>' : ''}</div></div>
      ${fresh ? `<div class="note lime">${icon('sparkle', 18)}<span>ההצעה פורסמה במעגל. גם את בוחרת אם להצטרף.</span></div>` : ''}
      <div class="card tight">
        <div class="kv"><span class="k">${icon('calendar', 18)} הסבב</span><span class="v">${Mila.fmtDate(def.startDate)} – ${Mila.fmtDate(def.endDate)}</span></div>
        <div class="kv"><span class="k">${icon('coin', 18)} על הכף</span><span class="v">שקל מילה ליום · לכל אחת בנפרד</span></div>
        <div class="kv"><span class="k">${icon('coins', 18)} פספוס</span><span class="v">נזקף לקופת ${esc(circle.name)}</span></div>
        <div class="kv"><span class="k">${icon('eye', 18)} חשיפה</span><span class="v">${def.visibility === 'summary' ? 'סיכום בלבד' : 'סטטוס יומי במעגל'}</span></div>
        <div class="kv"><span class="k">${icon('check', 18)} דיווח</span><span class="v">עצמי, עד ${Mila.RULES.GRACE_HOUR}:00 למחרת</span></div>
      </div>
      ${ad.length ? `<div class="card tight"><div class="card-title">מי כבר בפנים</div>${ad.map(u => { const st = Mila.commitmentStats(u.commitmentId); return `<div class="list-row">${avatar(u, 36)}<div class="body"><div class="t">${esc(u.name)}${u.id === Mila.me().id ? ' (את)' : ''}</div><div class="m">${st.resolved ? `${st.success} הצלחות${st.current ? ` · ${st.current} ברצף` : ''}` : 'עוד לא התחילה'}</div></div></div>`; }).join('')}</div>` : ''}
      ${mine ? `<button class="btn ghost" onclick="App.go('word',{id:'${mine.id}'})">למילה שלי בסבב הזה</button>` :
        over ? `<div class="note">${icon('info', 18)}<span>המילה הזו הסתיימה. אפשר להציע אותה שוב לסבב הבא.</span></div>` :
        !cap.ok ? `<div class="note warn">${icon('info', 18)}<span>שלוש מילים כבר על הכף בתאריכים האלה (${cap.conflictingWords.map(w => esc(w.title)).join(', ')}). אפשר להישאר צופה, או להצטרף כשמילה אחרת מסתיימת${cap.nextFree && cap.nextFree <= def.endDate ? ` (מ-${Mila.fmtDate(cap.nextFree)})` : ''}.</span></div><button class="btn soft" disabled>אני בפנים · התקרה מלאה</button><div class="tiny muted center mt">לא מוחקים התחייבות קיימת כדי לפנות מקום.</div>` :
        `<button class="btn primary" onclick="App.adoptSheet('${id}')">מילה שלי, אני בפנים</button><div class="tiny muted center mt">לחיצה פותחת מסך אישור. לא מחייבת מיד.</div>`}
      ${canCancel ? `<button class="btn text mt" onclick="App.cancelProposal('${id}')">לבטל את ההצעה</button>` : ''}`;
  };
  function adoptSheet(id) {
    const def = Mila.wordDef(id); const start = def.startDate < Mila.today() ? Mila.today() : def.startDate;
    const end = def.endDate; const days = Mila.diffDays(start, end) + 1;
    sheet(`<div class="sheet-hero">${wordTile(def, 'lg')}<div class="sheet-title">נותנת מילה?</div><div class="sheet-sub">${esc(def.title)} · ${days} ימים מ-${Mila.relDay(start)}</div></div>
      <div class="kv"><span class="k">${icon('coin', 18)} על הכף</span><span class="v">עד ${days} שקלי מילה</span></div>
      <div class="kv"><span class="k">${icon('users', 18)} תקרה</span><span class="v">${Mila.capCheck(Mila.me().id, start).maxCount + 1} מתוך ${Mila.RULES.DAILY_CAP}</span></div>
      <div class="kv"><span class="k">${icon('eye', 18)} החברות רואות</span><span class="v">${def.visibility === 'summary' ? 'סיכום' : 'סטטוס יומי'}</span></div>
      <div class="btn-row mt"><button class="btn soft" onclick="App.closeSheet()">הפעם לא</button><button class="btn primary" onclick="App.adopt('${id}')">חותמת על זה</button></div>`);
  }
  async function adopt(id) {
    try { const k = await Store().adoptGroupWord(id); closeSheet(true); go('word', { id: k.id, fresh: true }, { replace: true }); stamp('תפסתי אותך במילה.'); } catch (e) { fail(e); if (e.code === 'CAP') render(); }
  }
  function cancelProposal(id) { confirmSheet({ title: 'לבטל את ההצעה?', sub: 'עוד אף אחת לא הצטרפה, אז אין חיובים.', okText: 'לבטל הצעה', okClass: 'pink', onOk: async () => { await Store().cancelProposal(id); closeSheet(true); back(); toast('ההצעה בוטלה'); } }); }

  /* ============================================================
     S14 — בנק מילה
     ============================================================ */
  SCREENS.bank = () => {
    const b = Mila.bankSummary();
    const S = Mila.getState();
    const circles = Object.keys(b.byCircle).filter(k => k !== 'personal').map(k => S.circles[k]).filter(Boolean);
    const txs = b.transactions.filter(t => bankFilter === 'all' || (bankFilter === 'earn' ? t.type === 'EARN' : t.type !== 'EARN'));
    return `${topbar({ title: 'השקלים שלי', subtitle: 'מה שמרתי, מה עבר לקופות' })}
      <div class="card balance-card pastel-lime"><div class="label">יתרת שקלי מילה</div><div class="amount">${icon('coins', 40)}<span class="num">${b.earnedTotal}</span><span class="cur">₪ מילה</span></div><div class="note" style="display:inline-flex;margin:6px 0 0;padding:6px 12px">${icon('info', 16)}<span>מטבע משחק בלבד. אין ערך כספי, רכישה, משיכה או המרה.</span></div></div>
      <div class="stat-grid mb"><div class="stat lime"><div class="n">${b.earnedCurrentRound}${icon('check', 18)}</div><div class="l">שמרתי בסבב</div></div><div class="stat pink"><div class="n">${b.missedCurrentRound}${icon('coin', 18)}</div><div class="l">פספסתי</div></div><div class="stat lav"><div class="n">${b.pendingSlots}${icon('hourglass', 18)}</div><div class="l">ממתינים להכרעה</div></div></div>
      ${circles.length || b.byCircle.personal ? `<div class="card tight"><div class="card-title">לפי מעגל</div>${circles.map(c => `<div class="kv"><span class="k">${circleTile(c, 'sm')} ${esc(c.name)}</span><span class="v"><span class="chip lime">${b.byCircle[c.id].earned} נשמרו</span> <span class="chip pink">${b.byCircle[c.id].missed} בקופה</span></span></div>`).join('')}${b.byCircle.personal ? `<div class="kv"><span class="k"><span class="tile sm gray">${icon('lock', 18)}</span> מילים פרטיות</span><span class="v"><span class="chip lime">${b.byCircle.personal.earned} נשמרו</span> <span class="chip pink">${b.byCircle.personal.missed} פספוסים</span></span></div>` : ''}</div>` : ''}
      <div class="section-title">פעילות אחרונה</div>
      <div class="seg mb"><button class="${bankFilter === 'all' ? 'on' : ''}" onclick="App.bankFilter('all')">הכול</button><button class="${bankFilter === 'earn' ? 'on' : ''}" onclick="App.bankFilter('earn')">נשמרו</button><button class="${bankFilter === 'miss' ? 'on' : ''}" onclick="App.bankFilter('miss')">פספוסים</button></div>
      ${txs.length ? `<div class="card tight">${txs.slice(0, 60).map(t => {
        const plus = t.type === 'EARN'; const rev = t.type === 'REVERSE';
        return `<div class="tx ${t.reversed ? 'reversed' : ''}"><span class="amt ${rev ? 'zero' : plus ? 'plus' : 'minus'}">${rev ? '↺' : plus ? '+1' : '−1'}</span><div class="body"><div class="t">${esc(t.title || 'מילה')}</div><div class="m">${rev ? 'תנועה מבטלת בעקבות תיקון דיווח' : plus ? 'שקל מילה נשמר בעקבות דיווח הצלחה' : t.type === 'MISS_TO_CIRCLE' ? `שקל מילה הועבר לקופת ${esc(t.circleName || 'המעגל')} בעקבות פספוס` : 'פספוס נרשם (מילה פרטית)'} · ${Mila.relDay(t.localDate)}${t.reversed ? ' · בוטל' : ''}</div></div>${wordTile({ title: t.title, icon: t.icon }, 'sm')}</div>`;
      }).join('')}</div>` : `<div class="empty"><div class="t">עוד אין תנועות</div><div class="m">כל הכרעה של יום יוצרת תנועה אחת. הכול שקוף, הכול ניתן להסבר.</div></div>`}
      <div class="tiny muted center mt">כל תנועה מקושרת ליום ולמילה. תיקון נרשם כביטול + תנועה חדשה, לא כמחיקה.</div>`;
  };
  function setBankFilter(f) { bankFilter = f; render(); }

  /* ============================================================
     אני — פרופיל, הישגים, היסטוריה
     ============================================================ */
  SCREENS.me = () => {
    const u = Mila.me();
    const b = Mila.bankSummary();
    const ach = Mila.achievementsFor();
    const hist = Mila.wordHistory();
    const active = Mila.activeCommitments();
    const completed = hist.filter(h => h.status === 'completed').length;
    return `${topbar({ title: 'אני', back: false, end: `<button class="icon-btn" aria-label="הגדרות" onclick="App.go('settings')">${icon('settings', 24)}</button>` })}
      <div class="sheet-hero" style="margin-top:0">${avatar(u, 84)}<div class="sheet-title" style="margin-top:10px">${esc(u.name)}</div><div class="sheet-sub">${completed ? `${hebrewPlural(completed, 'סבב אחד הושלם', 'סבבים הושלמו')} · ` : ''}${hebrewPlural(active.length, 'מילה פעילה', 'מילים פעילות')}</div></div>
      <div class="card tight clickable pastel-lime" onclick="App.go('bank')"><div style="display:flex;align-items:center;gap:12px"><span class="tile lime">${icon('coins')}</span><div style="flex:1"><div class="bold">${coinLabel(b.earnedTotal)}</div><div class="small muted">השקלים שלי · היסטוריה ותנועות</div></div>${icon('chev', 20)}</div></div>
      <div class="stat-grid mb"><div class="stat lime"><div class="n">${b.earnedTotal}</div><div class="l">נשמרו סה״כ</div></div><div class="stat pink"><div class="n">${b.missedTotal}</div><div class="l">פספוסים</div></div><div class="stat lav"><div class="n">${ach.filter(a => a.earned).length}</div><div class="l">הישגים</div></div></div>
      <div class="section-title">הישגים <small>${ach.filter(a => a.earned).length}/${ach.length}</small></div>
      <div class="ach-grid">${ach.map(a => `<div class="ach ${a.earned ? '' : 'locked'}"><span class="tile sm ${a.earned ? 'lime' : 'gray'}">${icon(a.icon, 20)}</span><div><div class="t">${esc(a.title)}</div><div class="m">${esc(a.desc)}</div></div></div>`).join('')}</div>
      ${active.length ? `<div class="section-title">המילים הפעילות שלי</div>${active.map(c => { const d = Mila.wordDef(c.defId); const st = Mila.commitmentStats(c.id); return `<div class="word-row" onclick="App.go('word',{id:'${c.id}'})">${wordTile(d, 'sm')}<div class="body"><div class="name">${esc(d.title)}</div><div class="meta">יום ${Math.max(st.dayIndex, 1)}/14 · ${st.success} הצלחות${st.current ? ` · ${st.current} ברצף` : ''}</div></div>${icon('chev', 18)}</div>`; }).join('')}` : ''}
      ${hist.length ? `<div class="section-title">מילים שנשמרו</div>${hist.map(h => `<div class="word-row" onclick="App.go('summary',{id:'${h.id}'})">${wordTile(h.def, 'sm')}<div class="body"><div class="name">${esc(h.def.title)}</div><div class="meta">${Mila.fmtDate(h.startDate)} – ${Mila.fmtDate(h.endDate)} · ${h.stats.rate !== null ? pct(h.stats.rate) + ' עמידה' : 'ללא הכרעות'}${h.status === 'ended_early' ? ' · הופסקה' : ''}</div></div>${icon('chev', 18)}</div>`).join('')}` : ''}
      <div class="tiny muted center mt-lg">אין כאן ״ציון אמינות״. יש היסטוריה של מילים שקיימת.</div>`;
  };

  /* ============================================================
     S17 — התראות
     ============================================================ */
  SCREENS.notifications = () => {
    const list = Mila.notifications();
    if (Mila.unreadCount()) setTimeout(() => Store().markAllRead().catch(() => {}), 400);
    const ic = { invite: ['users', 'pink'], encouragement: ['clap', 'lime'], group_word: ['pencil', 'lav'], achievement: ['medal', 'peach'], reminder: ['bell', 'sky'] };
    return `${topbar({ title: 'עדכונים' })}
      ${list.length ? `<div class="card tight">${list.map(n => { const [i, c] = ic[n.type] || ['bell', 'gray']; const act = n.ref && n.ref.token ? `App.openInvite('${n.ref.token}')` : n.ref && n.ref.defId ? `App.go('groupWord',{id:'${n.ref.defId}'})` : n.ref && n.ref.circleId ? `App.go('circle',{id:'${n.ref.circleId}'})` : n.ref && n.ref.type ? `App.tab('me')` : ''; return `<div class="list-row ${act ? 'clickable' : ''}" ${act ? `onclick="${act}"` : ''}><span class="tile sm ${c}">${icon(i, 18)}</span><div class="body"><div class="t" style="${n.read ? 'font-weight:600' : ''}">${esc(n.title)}</div><div class="m">${esc(n.body || '')}${n.body ? ' · ' : ''}${timeAgo(n.createdAt)}</div></div>${act ? icon('chev', 18) : ''}</div>`; }).join('')}</div>` : `<div class="empty"><span class="tile lg sky">${icon('bell', 28)}</span><div class="t">שקט כאן</div><div class="m">תזכורות, הזמנות ועידודים יופיעו פה. פעם ביום, מקובץ.</div></div>`}
      <div class="tiny muted center mt">התראות ניתנות לשליטה בהגדרות. תוכן רגיש לא מופיע במסך הנעילה.</div>`;
  };

  /* ============================================================
     S18 — הגדרות
     ============================================================ */
  SCREENS.settings = () => {
    const u = Mila.me(); const s = u.settings; const S = Mila.getState();
    const blocked = Mila.blockedUsers();
    const tog = (k, t, m) => `<div class="toggle-row"><div><div class="t">${t}</div><div class="m">${m}</div></div><button class="switch ${s[k] ? 'on' : ''}" role="switch" aria-checked="${!!s[k]}" onclick="App.setSetting('${k}', ${!s[k]})"></button></div>`;
    return `${topbar({ title: 'הגדרות' })}
      <div class="card tight"><div class="field" style="margin:6px 0 10px"><label>שם תצוגה</label><input class="input" value="${esc(u.name)}" maxlength="30" onchange="App.rename(this.value)"></div>
        <div class="kv"><span class="k">${icon('clock', 18)} אזור זמן</span><span class="v">${esc(u.timezone)}</span></div>
        <div class="kv"><span class="k">${icon('bell', 18)} שעת תזכורת</span><input class="input ltr" type="time" value="${s.reminderTime}" style="width:auto;padding:8px 12px" onchange="App.setSetting('reminderTime', this.value)"></div></div>
      <div class="card tight">${tog('pushReminders', 'תזכורת דיווח', 'פעם ביום, מקובץ לכל המילים')}${tog('socialDigest', 'עדכוני מעגל', 'סיכום יומי של מה שקרה אצל החברות')}${tog('hideFromLeaderboard', 'להסתיר אותי מהדירוג', 'ממשיכה לשחק, בלי להופיע בטבלה')}${tog('lockScreenPrivacy', 'פרטיות במסך נעילה', 'התראות בלי שמות מילים')}</div>
      <div class="card tight"><div class="card-title">בטיחות</div>${blocked.length ? blocked.map(b => `<div class="list-row">${avatar(b, 32)}<div class="body"><div class="t">${esc(b.name)}</div><div class="m">חסומה</div></div><button class="btn xs soft" onclick="App.unblock('${b.id}')">ביטול חסימה</button></div>`).join('') : '<div class="small muted">אין משתמשות חסומות. חסימה ודיווח זמינים מתוך כל מעגל.</div>'}</div>
      <div class="card tight"><div class="card-title">מה זה שקל מילה?</div><div class="small muted">יחידת משחק שנוצרת רק כשיום מוכרע. הצלחה שומרת שקל, פספוס זוקף שקל לקופת המעגל, החרגה לא יוצרת מטבע. אי אפשר לרכוש, למכור, להעביר או להמיר שקלי מילה לכסף. אין חוב ואין יתרה שלילית. בעתיד, אם יהיה תקציב תרומות ממומן על ידי שותף, הצלחות יוכלו להעניק משקל בבחירת מטרות. זה לא קיים עדיין.</div></div>
      <div class="card tight"><div class="list-row clickable" onclick="App.exportData()"><span class="tile sm sky">${icon('download', 18)}</span><div class="body"><div class="t">ייצוא הנתונים שלי</div><div class="m">קובץ JSON עם המילים, הדיווחים והתנועות</div></div></div>
        ${S.meta.demo ? `<div class="list-row clickable" onclick="App.resetDemo()"><span class="tile sm peach">${icon('repeat', 18)}</span><div class="body"><div class="t">איפוס נתוני הדוגמה</div><div class="m">חזרה למסך הפתיחה</div></div></div>` : ''}
        ${isCloud() ? `<div class="list-row clickable" onclick="App.signOut()"><span class="tile sm gray">${icon('logout', 18)}</span><div class="body"><div class="t">יציאה מהחשבון</div><div class="m">${esc((Api.session && Api.session.user && Api.session.user.email) || '')}</div></div></div>` : ''}
        <div class="list-row clickable" onclick="App.deleteAccount()"><span class="tile sm pink">${icon('trash', 18)}</span><div class="body"><div class="t" style="color:var(--danger)">מחיקת חשבון</div><div class="m">הפרטים שלך נמחקים. תנועות במעגלים הופכות לאנונימיות.</div></div></div></div>
      <div class="tiny muted center mt">מילה · גרסת בטא · 18+ · שקלי מילה הם מטבע משחק בלבד</div>`;
  };
  async function setSetting(k, v) { try { await Store().updateSettings({ [k]: v }); render(); } catch (e) { fail(e); } }
  async function rename(name) { try { if (!name.trim()) return; await Store().renameMe(name); toast('השם עודכן'); } catch (e) { fail(e); } }
  async function unblock(id) { try { await Store().unblock(id); render(); } catch (e) { fail(e); } }
  async function exportData() { const data = isCloud() ? JSON.stringify(await Api.cloud.exportData(), null, 2) : Mila.exportData(); const blob = new Blob([data], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mila-export.json'; a.click(); URL.revokeObjectURL(a.href); toast('הקובץ ירד'); }
  function resetDemo() { confirmSheet({ title: 'לאפס את נתוני הדוגמה?', sub: 'הכול יימחק מהמכשיר ותחזרי למסך הפתיחה.', okText: 'איפוס', okClass: 'pink', onOk: () => { Mila.reset(); closeSheet(true); go('welcome', {}, { reset: true }); } }); }
  function deleteAccount() { confirmSheet({ title: 'למחוק את החשבון?', sub: 'הפעולה סופית. המילים, הדיווחים וההישגים שלך יימחקו מהמכשיר. במעגלים ייוותרו תנועות אנונימיות לצורך תקינות הקופות.', okText: 'מחיקה סופית', okClass: 'danger', onOk: async () => { await Store().deleteAccount(); closeSheet(true); go('welcome', {}, { reset: true }); toast('החשבון נמחק'); } }); }

  /* ============================================================
     S19 — בטיחות: חסימה ודיווח
     ============================================================ */
  function safetySheet(userId, circleId, inviteToken) {
    const u = userId ? Mila.user(userId) : null;
    const reasons = ['לחץ חברתי או הטרדה', 'תוכן פוגעני', 'עידוד להתנהגות מסוכנת', 'התחזות או ספאם', 'אחר'];
    sheet(`<div class="sheet-title">${u ? `בטיחות · ${esc(u.name)}` : 'דיווח על המעגל'}</div><div class="sheet-sub">דיווח נבדק על ידי הצוות. חסימה פועלת מיד.</div>
      <div class="field"><label>סיבת הדיווח</label>${reasons.map(r => `<div class="choice" onclick="App.doReportAbuse('${u ? 'user' : inviteToken ? 'invite' : 'circle'}','${u ? u.id : inviteToken || circleId}','${r}')"><span class="radio"></span><div class="body"><div class="t">${r}</div></div></div>`).join('')}</div>
      ${u && !Mila.isBlocked(Mila.me().id, u.id) ? `<button class="btn danger" onclick="App.blockUser('${u.id}')">${icon('shield', 18)} לחסום את ${esc(u.name)}</button><div class="tiny muted center mt">היא לא תוכל להזמין אותך או להופיע בפיד שלך.</div>` : ''}`);
  }
  async function doReportAbuse(entityType, entityId, reason) { try { await Store().reportAbuse({ entityType, entityId, reason }); closeSheet(true); toast('הדיווח התקבל. תודה שעזרת לשמור על המקום הזה.'); } catch (e) { fail(e); } }
  async function blockUser(id) { try { await Store().block(id); closeSheet(true); toast('נחסמה'); render(); } catch (e) { fail(e); } }

  /* ============================================================
     אתחול
     ============================================================ */
  async function init() {
    Mila.load();
    $('#nav-ic-today').innerHTML = ICONS.home(22); $('#nav-ic-circles').innerHTML = ICONS.users(22); $('#nav-ic-me').innerHTML = ICONS.user(22);
    const params = new URLSearchParams(location.search);
    const token = params.get('invite');
    if (token) { history.replaceState(null, '', location.pathname); }
    const authError = params.get('auth_error');
    if (authError) { history.replaceState(null, '', location.pathname); setTimeout(() => toast('הכניסה עם גוגל לא הושלמה. נסי שוב.'), 300); }
    if (Api.enabled) {
      $('#screen').innerHTML = '<div class="empty" style="padding-top:40vh"><div class="muted small">טוענות…</div></div>';
      try {
        await Api.init();
        Api.onSync(() => { if (stack.length && !sheetOpen() && !busy) render({ keepSheet: true }); });
        if (Api.hasSession() && !Api.isCloud()) { pendingInviteToken = token; go('profile', {}, { reset: true }); return; }
        if (Api.isCloud()) {
          await Api.sync();
          Api.startAutoSync();
          go('today', {}, { reset: true }); if (token) openInvite(token); return;
        }
      } catch (e) {
        console.error(e);
        if (e.code === 'OFFLINE' && Api.loadCache()) { toast('אין חיבור. מציגות את המצב האחרון שנשמר.'); go('today', {}, { reset: true }); return; }
        toast('לא הצלחנו להתחבר לשרת. אפשר לנסות שוב בעוד רגע.');
      }
      // אין session: אם יש מצב דמו מקומי שמור – נכבד אותו; אחרת מסך פתיחה
      if (Mila.me() && Mila.getState().meta.demo) { go('today', {}, { reset: true }); return; }
      pendingInviteToken = token; go('welcome', {}, { reset: true }); return;
    }
    if (!Mila.me()) { pendingInviteToken = token; go('welcome', {}, { reset: true }); }
    else { go('today', {}, { reset: true }); if (token) openInvite(token); }
    setInterval(() => { if (document.visibilityState === 'visible' && TOP.includes(current().name)) { const before = JSON.stringify(Object.values(Mila.getState().obligations).map(o => o.status)); Mila.refreshStatuses(); if (JSON.stringify(Object.values(Mila.getState().obligations).map(o => o.status)) !== before) render(); } }, 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (Api.isCloud()) Api.sync().catch(() => {}); else render(); } });
    window.addEventListener('online', () => { if (Api.isCloud()) Api.sync().then(() => toast('החיבור חזר. הכול מעודכן.', 'lime')).catch(() => {}); });
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  document.addEventListener('DOMContentLoaded', init);

  return {
    go, back, tab, refresh, closeSheet, toast, startDemo,
    suChange, suToggle, signup, googleSignIn, authSet, authToggle, termsSheet, completeProfile, signOut,
    setVisibility, react, sendEncouragement, rotateInvite, openInvite, rename, unblock,
    reportSheet, confirmMiss, excuseSheet, doReport, correctionSheet, _corrPick, doCorrect,
    openWordWizard, wizSet, wizTemplate, wizNext, wizPrev, wizCancel, wizCommit, wordMenu, endWord,
    circleAddSheet, joinByCodeSheet, joinByCode, cwSet, cwCreate, setCircleTab, encourageSheet, circleMenu, leaveCircle, inviteSheet, shareInvite, copyText, removeMember, cmSet,
    acceptInvite, declineInvite, openGroupWizard, gwSet, gwTemplate, gwPropose, adoptSheet, adopt, cancelProposal,
    bankFilter: setBankFilter, setSetting, exportData, resetDemo, deleteAccount, safetySheet, doReportAbuse, blockUser,
  };
})();
