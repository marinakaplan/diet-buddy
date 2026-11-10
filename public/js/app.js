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
  for (const k of ['updateSettings','renameMe','updateCircle','leaveCircle','removeMember','setMemberRole','deleteCircle','cancelProposal','endCommitment','updateWordVisibility','report','correct','encourage','sendEncouragement','block','unblock','reportAbuse','markAllRead','markSummarySeen','deleteAccount','acceptInvite','adoptGroupWord','proposeGroupWord','createPersonalWord','createCircle','createInvite','previewInvite']) Local[k] = async (...a) => Mila[k](...a);
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
  let cwiz = null;       // יצירת קבוצה
  let pick = null;       // בחירת אתגרים מהספרייה
  let inv = null;        // גיליון הזמנה (סוג + הודעה)
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
    document.body.classList.toggle('wide', cur.name === 'admin');
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
  function days14(commitmentId) {
    const obs = Mila.obligationsOf(commitmentId);
    const today = Mila.today();
    return `<div class="days14">${obs.map((o, i) => {
      const cls = o.status === 'cancelled' ? 'future' : o.outcome === 'success' ? 'success' : o.outcome === 'miss' ? 'miss' : o.outcome === 'excused' ? 'excused' : o.localDate > today ? 'future' : '';
      const ic = o.outcome === 'success' ? icon('check', 16) : o.outcome === 'miss' ? icon('x', 14) : o.outcome === 'excused' ? icon('minus', 14) : '';
      return `<div class="day-cell ${cls} ${o.localDate === today ? 'today' : ''}" title="${esc(Mila.fmtDate(o.localDate))}">${ic || (i + 1)}</div>`;
    }).join('')}</div>
    <div class="legend"><span><i style="background:var(--lime)"></i>עמדתי</span><span><i style="background:var(--pink)"></i>פספסתי</span><span><i style="background:var(--lav)"></i>יום חריג</span><span><i style="background:#F4F1F3"></i>עוד לא</span></div>`;
  }
  function ring(value, total, center = '') {
    const p = total ? Math.min(value / total, 1) : 0;
    return `<div class="ring-wrap"><div class="ring-center">${center}</div><svg viewBox="0 0 240 130">
      <path class="ring-track" d="M20 120 A100 100 0 0 1 220 120" fill="none" stroke-width="16" stroke-linecap="round"/>
      <path class="ring-fill" d="M20 120 A100 100 0 0 1 220 120" fill="none" stroke-width="16" stroke-linecap="round" pathLength="100" stroke-dasharray="${(p * 100).toFixed(1)} 100"/>
    </svg></div>`;
  }
  /* רעיונות למילה: תחומים כטאבים, רק התחום הפתוח מוצג, ואחרי בחירה הכול מתקפל לשורה אחת */
  let ideasCat = 0; let ideasOpen = true;
  function templateChips(handler, selectedTitle) {
    const cats = [...new Set(Mila.TEMPLATES.map(t => t.cat))];
    if (selectedTitle && !ideasOpen) {
      return `<div class="ideas collapsed mb"><span class="small">${icon('check', 14)} <b>${esc(selectedTitle)}</b></span><button class="btn text xs" onclick="App.ideasToggle(true)">רעיון אחר</button></div>`;
    }
    const cat = cats[Math.min(ideasCat, cats.length - 1)];
    return `<div class="ideas mb">
      <div class="ideas-head"><span class="bold small">רעיונות</span>${selectedTitle ? `<button class="btn text xs" onclick="App.ideasToggle(false)">סגירה</button>` : ''}</div>
      <div class="chips scroll ideas-cats">${cats.map((c, i) => `<button class="chip ${c === cat ? 'lime' : ''}" onclick="App.ideasCat(${i})">${esc(c)}</button>`).join('')}</div>
      <div class="chips">${Mila.TEMPLATES.map((t, i) => t.cat === cat ? `<button class="chip select ${selectedTitle === t.title ? 'on' : ''}" onclick="App.${handler}(${i})">${icon(t.icon, 15)} ${esc(t.title)}</button>` : '').join('')}</div>
    </div>`;
  }
  function setIdeasCat(i) { ideasCat = i; ideasOpen = true; render(); }
  function ideasToggle(open) { ideasOpen = open; render(); }
  function hebrewPlural(n, one, many) { return n === 1 ? one : `${n} ${many}`; }

  /* ============================================================
     S01 — פתיחה
     ============================================================ */
  const SCREENS = {};
  const POST = {};

  /* הבטחות מתחלפות במסך הפתיחה: יומיומיות, בגוף ראשון */
  const PROMISES = [
    'יאללה, מהיום אני לא נוגעת בטלפון כשאני עם הילדים.',
    'יאללה, מהיום אני לא מזמינה משלוחים.',
    'יאללה, מהיום אני במיטה עד 23:00.',
    'יאללה, מהיום 8,000 צעדים ביום.',
    'יאללה, מהיום בלי מתוק אחרי ארוחת ערב.',
    'יאללה, מהיום אני לא צועקת על הילדים.',
  ];
  SCREENS.welcome = () => {
    const cta = Api.enabled ? `<button class="btn dark hero-btn" onclick="App.googleSignIn()">${googleMark()} יאללה, אני בפנים</button>` : `<button class="btn dark hero-btn" onclick="App.go('signup')">יאללה, אני בפנים</button>`;
    /* מסך פתיחה מצומצם: לוגו חי, משפט אחד, הבטחה מתחלפת, כפתור. */
    return `
    <div class="hero w2">
      <div class="hero-blobs" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="w2-main">
        <div class="w2-logo">${liveLogo(76)}</div>
        <div class="w2-brand">מילה.</div>
        <h1 class="w2-h"><span>כולנו מבטיחות.</span><span>בואי נראה מי <mark>מקיימת</mark>.</span></h1>
        <div class="w2-rot" aria-hidden="true">${PROMISES.map((t, i) => `<span style="--i:${i}">${t}</span>`).join('')}</div>
      </div>
      ${pendingInviteToken ? `<div class="invited-banner w2-inv">💌 הוזמנת לקבוצה של חברה. נכנסת עם Google, ומצטרפת.</div>` : ''}
      <div class="hero-cta w2-cta">${cta}
        <button class="btn text" onclick="App.startDemo()">להציץ בדוגמה</button>
        <div class="disclaimer">כניסה עם Google · מגיל 18 · חינם · בטא</div>
      </div>
    </div>`;
  };

  function startDemo() {
    Mila.reset();
    MilaDemo.seed('דניאלה');
    go('today', {}, { reset: true });
    toast('זו דוגמה עם חברות מומצאות. כדי להתחיל באמת: הגדרות ← איפוס הדוגמה.', 'lime');
  }

  /* ============================================================
     S02 — הרשמה
     ============================================================ */
  let signupForm = { name: '', age: false, terms: false };
  SCREENS.signup = () => `
    ${topbar({ title: '' })}
    <div class="step-title">איך קוראים לך?</div>
    <div class="step-sub">ככה החברות יראו אותך.</div>
    <div class="field"><input class="input" id="su-name" placeholder="שם תצוגה" value="${esc(signupForm.name)}" autocomplete="given-name" maxlength="30" oninput="App.suChange('name', this.value)"></div>
    <div class="checkbox-row ${signupForm.age ? 'on' : ''}" onclick="App.suToggle('age')"><span class="box">${signupForm.age ? icon('check', 16) : ''}</span><span>אני בת 18 ומעלה</span></div>
    <div class="checkbox-row ${signupForm.terms ? 'on' : ''}" onclick="App.suToggle('terms')"><span class="box">${signupForm.terms ? icon('check', 16) : ''}</span><span>הבנתי: נקודות משחק, בלי כסף אמיתי.</span></div>
    <div class="mt-lg"><button class="btn primary" id="su-go" ${signupForm.name.trim() && signupForm.age && signupForm.terms ? '' : 'disabled'} onclick="App.signup()">ממשיכה</button></div>`;
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
    Api.track('signin_click');
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
      <div class="step-title mt-lg">איך קוראים לך?</div><div class="step-sub">ככה החברות יראו אותך.</div>
      <div class="field"><input class="input" id="pf-name" placeholder="שם תצוגה" maxlength="30" value="${esc(authForm.name || (Api.me && Api.me.name) || '')}" oninput="App.authSet('name', this.value)"></div>
      <div class="checkbox-row ${authForm.age ? 'on' : ''}" onclick="App.authToggle('age')"><span class="box">${authForm.age ? icon('check', 16) : ''}</span><span>אני בת 18 ומעלה</span></div>
      <div class="checkbox-row ${authForm.terms ? 'on' : ''}" onclick="App.authToggle('terms')"><span class="box">${authForm.terms ? icon('check', 16) : ''}</span><span>קראתי את <a href="#" onclick="event.preventDefault(); App.termsSheet()">תנאי השימוש</a>. נקודות משחק, בלי כסף אמיתי.</span></div>
      <div class="mt-lg"><button class="btn primary" id="pf-go" ${busy ? 'disabled' : ''} onclick="App.completeProfile()">${busy ? 'רגע…' : 'ממשיכה'}</button></div>
      <button class="btn text mt" onclick="App.signOut()">יציאה</button>
    </div>`;
  function authSet(k, v) { authForm[k] = v; }
  function authToggle(k) { authForm[k] = !authForm[k]; render(); }
  function termsSheet() {
    sheet(`<div class="sheet-title">תנאי שימוש (בטא)</div>
      <div class="small muted" style="line-height:1.7">
      <p><b>מה זה.</b> מילה היא משחק חברתי של התחייבויות ל-14 יום. הדיווח הוא עצמי ומבוסס אמון.</p>
      <p><b>נקודות.</b> יחידת משחק בלבד: נקודה על כל יום שעמדת בו. אין להן ערך כספי, אי אפשר לקנות, למכור, להעביר או להמיר אותן, ואין בהן הימור או פרס. המשחק חינמי. אפשר, אם רוצים, לפרגן ליוצרת דרך ביט, מחוץ לאפליקציה. הפרגון לא משפיע על המשחק, על הנקודות או על הדירוג.</p>
      <p><b>גיל.</b> השימוש מותר מגיל 18.</p>
      <p><b>מידע.</b> נשמרים: שם תצוגה, אימייל (לכניסה בלבד), אזור זמן, המילים והדיווחים שלך. חברות בקבוצה רואות את מה שבחרת לחשוף. אין גישה לאנשי קשר, אין מכירת מידע.</p>
      <p><b>שליטה.</b> אפשר לייצא את הנתונים ולמחוק את החשבון מההגדרות בכל רגע. לאחר מחיקה הפרופיל הופך לאנונימי; ההיסטוריה של הקבוצות נשמרת ללא זיהוי.</p>
      <p><b>התנהגות.</b> בלי הטרדה, לחץ או תוכן פוגעני. אפשר לחסום ולדווח מכל קבוצה. אנחנו רשאיות להסיר תוכן או חשבון שמפר את זה.</p>
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
    try { await Api.completeProfile({ name, ageConfirmed: true, termsAccepted: true, inviteToken: pendingInviteToken }); afterAuth(); }
    catch (e) { busy = false; fail(e); render(); }
  }
  async function signOut() { try { if (window.MilaInstall) await MilaInstall.onSignOut(); await Api.signOut(); } catch (e) { /* ignore */ } stack = []; pendingInviteToken = null; go('welcome', {}, { reset: true }); }

  /* ============================================================
     S03 — התחלת משחק
     ============================================================ */
  SCREENS.start = () => `
    <div class="welcome" style="justify-content:flex-start;padding-top:40px">
      <div class="logo-row" style="justify-content:flex-start;gap:8px">${logoMark(36)}<span class="brand" style="font-size:1.6rem">מילה.</span></div>
      <div class="step-title mt-lg">היי ${esc(Mila.me().name)}. במה את מתחילה?</div>
      <div class="row-card" onclick="App.openPick()"><span class="tile lg lime">${icon('pencil', 28)}</span><div class="body"><div class="t">בוחרת אתגרים</div><div class="m">עד 3 אתגרים ל-14 יום.</div></div>${icon('chev', 20)}</div>
      <div class="row-card" onclick="App.joinByCodeSheet()"><span class="tile lg pink">${icon('users', 28)}</span><div class="body"><div class="t">מצטרפת לקבוצה של חברה</div><div class="m">קיבלת קוד או קישור? מכניסה אותו כאן.</div></div>${icon('chev', 20)}</div>
      <div class="row-card" onclick="App.tab('today')"><span class="tile lg lav">${icon('eye', 28)}</span><div class="body"><div class="t">קודם להסתכל</div><div class="m">בלי להתחייב.</div></div>${icon('chev', 20)}</div>
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
    const fresh = !active.length && !upcoming.length; // עוד לא בחרה אף אתגר
    const bestStreak = Math.max(0, ...active.map(c => Mila.streak(c.id).current));
    const rankAll = Mila.myCircles().map(c => ({ c, ri: Mila.rankInsight(c.id) })).filter(x => x.ri);
    const rankCircle = rankAll.find(x => x.ri.place) || rankAll[0];

    return `
      <div class="topbar" style="padding-bottom:4px">
        <div class="topbar-side"><button class="icon-btn" aria-label="התראות" onclick="App.go('notifications')">${icon('bell', 24)}${unread ? '<span class="badge-dot"></span>' : ''}</button></div>
        <div class="title-wrap"></div>
        <div class="topbar-side end"><button class="icon-btn" aria-label="הפרופיל שלי" onclick="App.tab('me')">${avatar(u, 40)}</button></div>
      </div>
      ${Mila.getState().meta.demo ? `<div class="demo-banner">דוגמה. הקבוצות והחברות מומצאות. <a href="#" onclick="event.preventDefault(); App.resetDemo()">להתחיל באמת</a></div>` : ''}
      <div class="greeting"><div><div class="hello">${greet}, ${esc(u.name)} ${icon(hour >= 17 || hour < 5 ? 'moon' : 'sun', 22)}</div><div class="sub">${fresh ? 'בואי נתחיל.' : todaySubtitle(cards)}</div></div></div>

      ${main ? `<div class="card ring-card">
          ${ring(main.st.dayIndex, Mila.RULES.ROUND_DAYS, `<div class="label">יום</div><div class="big"><b>${main.st.dayIndex}</b> מתוך ${Mila.RULES.ROUND_DAYS}</div>`)}
          <div class="ring-dots">${active.slice(0, 3).map((c, i) => `<i class="${c.id === main.c.id ? 'on' : ''}"></i>`).join('')}</div>
          <div class="ring-meta"><span>הצלחות <b>${bank.earnedCurrentRound}</b></span><span>רצף <b>${bestStreak}</b></span>${rankCircle && rankCircle.ri.place ? `<span>מקום <b>${rankCircle.ri.place}</b> מתוך ${rankCircle.ri.total}</span>` : `<span>היום <b>${done}/${cards.length}</b></span>`}</div>
        </div>` : ''}

      ${rankAll.slice(0, 3).map(({ c, ri }) => `<div class="card tight clickable pastel-lav rank-card" onclick="App.go('circle',{id:'${c.id}'})"><div style="display:flex;align-items:center;gap:12px">${ri.place ? `<span class="rank-place ${ri.place === 1 ? 'first' : ''}">${ri.place}</span>` : `<span class="tile lav">${icon('trophy')}</span>`}<div style="flex:1;min-width:0"><div class="bold">${esc(ri.text)}</div><div class="small muted">${esc(c.name)} · יום ${Mila.circleRound(c.id).dayIndex} מתוך ${Mila.RULES.ROUND_DAYS}</div></div>${icon('chev', 20)}</div></div>`).join('')}

      ${pendingSum.length ? pendingSum.map(c => `<div class="card pastel-lav clickable tight" onclick="App.go('summary',{id:'${c.id}'})"><div style="display:flex;align-items:center;gap:12px"><span class="tile lav">${icon('medal')}</span><div style="flex:1"><div class="bold">הסבב נגמר: ${esc(Mila.wordDef(c.defId).title)}</div><div class="small muted">איך הלך?</div></div>${icon('chev', 20)}</div></div>`).join('') : ''}

      ${installCard()}
      ${fresh ? `<div class="card start-card">
          <div class="start-title">במה את עומדת ב-14 הימים הקרובים?</div>
          <ol class="start-steps">
            <li><b>1</b><span>בוחרת עד 3 אתגרים</span></li>
            <li><b>2</b><span>כל ערב מסמנת אם עמדת בהם</span></li>
            <li><b>3</b><span>מזמינה חברות שיעזרו לך לעמוד במילה שלך</span></li>
          </ol>
          <button class="btn primary" onclick="App.openPick()">בוחרת אתגרים</button>
        </div>` : `<div class="section-title">האתגרים שלי להיום ${cards.length ? `<small>${done}/${cards.length}</small>` : ''}</div>
      ${cards.length ? cards.map(todayRow).join('') : `<div class="card tight muted small">אין לך אתגר היום.</div>`}`}
      ${cards.length && active.length < Mila.RULES.DAILY_CAP ? `<button class="btn ghost mt" onclick="App.openPick()">${icon('plus', 20)} עוד אתגר</button>` : ''}
      ${cards.length && active.length >= Mila.RULES.DAILY_CAP ? `<div class="note">${icon('info', 18)}<span>3 אתגרים. זה המקסימום.</span></div>` : ''}

      ${upcoming.length ? `<div class="section-title">אתגרים שמתחילים בקרוב</div>${upcoming.map(c => `<div class="word-row" onclick="App.go('word',{id:'${c.id}'})">${wordTile(c.def, 'sm')}<div class="body"><div class="name">${esc(c.def.title)}</div><div class="meta">מתחילה ${Mila.relDay(c.startDate)}</div></div>${icon('chev', 18)}</div>`).join('')}` : ''}

      ${digest.length ? `<div class="section-title">אצל החברות <small onclick="App.tab('circles')" style="cursor:pointer">הכול</small></div>
        <div class="card tight">${digest.map(e => `<div class="feed-item" onclick="App.go('circle',{id:'${e.circleId}'})">${avatar(e.actor, 36)}<div class="body"><div class="t">${feedText(e)}</div><div class="m">${esc(e.circle.name)} · ${timeAgo(e.createdAt)}</div></div></div>`).join('')}</div>` : ''}
      ${!fresh && !Mila.myCircles().length ? `<div class="card pastel-pink clickable tight" onclick="App.inviteFlow({})"><div style="display:flex;align-items:center;gap:12px"><span class="tile pink">${icon('users')}</span><div style="flex:1"><div class="bold">הזמיני חברה שתעזור לך לעמוד בזה</div><div class="small muted">היא רואה את ההתקדמות שלך, ואפשר גם להתחרות.</div></div>${icon('chev', 20)}</div></div>` : ''}
    `;
  };

  function todaySubtitle(cards) {
    if (!cards.length) return 'אין לך אתגר היום';
    const left = cards.filter(x => !x.outcome).length;
    const kept = cards.filter(x => x.outcome === 'success').length;
    if (left === 0) return kept === cards.length ? 'עמדת בכל האתגרים היום 🎉' : 'דיווחת על הכול. מחר עוד יום.';
    if (left === cards.length) return cards.length === 1 ? 'יש לך אתגר אחד היום' : `יש לך ${cards.length} אתגרים היום`;
    return left === 1 ? 'נשאר לדווח על אחד' : `נשאר לדווח על ${left}`;
  }
  function todayRow(x) {
    const st = x.outcome === 'success' ? 'done' : x.outcome === 'miss' ? 'miss' : x.outcome === 'excused' ? 'excused' : x.late ? 'late' : '';
    const mark = x.outcome === 'success' ? icon('check', 18) : x.outcome === 'miss' ? icon('x', 16) : x.outcome === 'excused' ? icon('minus', 16) : '';
    const meta = x.outcome === 'success' ? '<span class="chip lime">+1</span>' : x.outcome === 'miss' ? `<span class="chip pink">פספוס</span>` : x.outcome === 'excused' ? '<span class="chip lav">יום חריג</span>' : x.late ? `<span class="chip peach">${icon('clock', 13)} מאתמול · לדווח עד 10:00</span>` : '';
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
      return sheet(`<div class="sheet-hero">${wordTile(o.def, 'lg')}<div class="sheet-title">${esc(o.def.title)}</div><div class="sheet-sub">${Mila.relDay(o.localDate)} · ${o.outcome === 'success' ? 'אמרת ועשית. +1' : o.outcome === 'miss' ? 'לא היום. הרצף התאפס' : 'יום חריג'}</div></div>
        ${o.canCorrect ? `<button class="btn soft" onclick="App.correctionSheet('${o.id}')">${icon('edit', 18)} טעות? לתקן</button><div class="tiny muted center mt">אפשר לתקן עד 24 שעות אחרי הדיווח.</div>` : '<div class="note">' + icon('lock', 18) + '<span>נעול. עברו 24 שעות.</span></div>'}
        <button class="btn text mt" onclick="App.closeSheet()">סגירה</button>`);
    }
    if (!o.open) return toast(o.localDate > Mila.today() ? 'עוד לא הגיע היום הזה' : 'היום הזה נסגר');
    const excusesLeft = Mila.RULES.MAX_EXCUSES_PER_ROUND - Mila.excusesUsed(o.commitmentId);
    sheet(`<div class="sheet-hero">${wordTile(o.def, 'lg')}<div class="sheet-title">${esc(o.def.title)}</div><div class="sheet-sub">${esc(o.def.rule)}</div></div>
      <div class="outcome-btns">
        <button class="btn primary" onclick="App.doReport('${o.id}','success')">${icon('check', 26)}עמדתי בזה<small>+1 נקודה</small></button>
        <button class="btn pink" onclick="App.confirmMiss('${o.id}')">${icon('x', 24)}פספסתי<small>הרצף מתאפס</small></button>
      </div>
      <button class="btn text mt" ${excusesLeft > 0 ? `onclick="App.excuseSheet('${o.id}')"` : 'disabled'}>${icon('minus', 16)} יום חריג ${excusesLeft > 0 ? `(נשארו ${excusesLeft})` : '(נגמרו)'}</button>`);
  }
  function confirmMiss(id) {
    const o = Mila.decorate(Mila.getState().obligations[id]);
    confirmSheet({ title: 'לא היום?', sub: 'הרצף של האתגר מתאפס. הנקודות שצברת נשארות. מחר שוב.', okText: 'כן, פספסתי', okClass: 'pink', onOk: () => doReport(id, 'miss') });
  }
  function excuseSheet(id) {
    sheet(`<div class="sheet-title">יום חריג</div><div class="sheet-sub">לא נספר ולא שובר רצף. עד 2 בסבב.</div>
      ${['מחלה', 'אירוע משפחתי', 'נסיעה', 'אחר'].map(r => `<div class="choice" onclick="App.doReport('${id}','excused','${r}')"><span class="radio"></span><div class="body"><div class="t">${r}</div></div></div>`).join('')}`);
  }
  async function doReport(id, outcome, note = '') {
    try {
      // ״המהפך״ בענן: הדירוג מחושב בטלפון (לפני ואחרי), והשרת רק רושם את העקיפה
      const ob0 = Mila.getState().obligations[id]; const k0 = ob0 && Mila.commitment(ob0.commitmentId); const d0 = k0 && Mila.wordDef(k0.defId);
      const cid = isCloud() && outcome === 'success' && d0 && d0.circleId ? d0.circleId : null;
      const before = cid ? Mila.leaderboard(cid).rows.filter(r => r.ranked).map(r => r.user.id) : null;
      const { obligation, duplicate } = await Store().report(id, outcome, { note });
      if (cid && !duplicate) {
        const after = Mila.leaderboard(cid).rows.filter(r => r.ranked).map(r => r.user.id);
        const meId = Mila.me().id; const myAfter = after.indexOf(meId); const myBefore = before.indexOf(meId);
        if (myAfter >= 0) {
          const passed = after.filter((u, i) => u !== meId && i > myAfter && (myBefore < 0 ? before.includes(u) : before.indexOf(u) >= 0 && before.indexOf(u) < myBefore));
          passed.forEach(u => Api.cloud.overtake(cid, u).catch(() => {}));
          if (passed.length) setTimeout(() => toast(`עקפת את ${Mila.user(passed[0]).name}. עכשיו נראה אם היא תיתן לך להישאר שם 😏`, 'lime'), 1600);
        }
      }
      closeSheet(true);
      if (duplicate) toast('כבר נשמר');
      else if (outcome === 'success') toast('אמרת ועשית. +1 נקודה', 'lime');
      else if (outcome === 'miss') toast('לא היום. מחר שוב.');
      else toast('יום חריג. הרצף נשאר.');
      render();
    } catch (e) { fail(e); }
  }

  /* ---------- S21 — תיקון דיווח ---------- */
  function correctionSheet(id) {
    const o = Mila.decorate(Mila.getState().obligations[id]);
    const opts = [['success', 'עמדתי במילה', 'lime'], ['miss', 'פספסתי', 'pink'], ['excused', 'יום חריג', 'lav']].filter(([k]) => k !== o.outcome);
    sheet(`<div class="sheet-title">לתקן</div><div class="sheet-sub">${esc(o.def.title)} · ${Mila.relDay(o.localDate)}. הדיווח המקורי נשאר בהיסטוריה.</div>
      <div class="field"><label>מה באמת קרה?</label>${opts.map(([k, l, c]) => `<div class="choice" data-k="${k}" onclick="App._corrPick('${k}')"><span class="radio"></span><div class="body"><div class="t">${l}</div></div></div>`).join('')}</div>
      <div class="field"><label>למה?</label><input class="input" id="corr-reason" placeholder="לחצתי בטעות"></div>
      <button class="btn dark" onclick="App.doCorrect('${id}')">לתקן</button>`);
  }
  let corrPick = null;
  function _corrPick(k) { corrPick = k; document.querySelectorAll('#sheet .choice').forEach(c => { c.classList.toggle('on', c.dataset.k === k); c.querySelector('.radio').innerHTML = c.dataset.k === k ? icon('check', 14) : ''; }); }
  async function doCorrect(id) {
    try {
      if (!corrPick) return toast('מה באמת קרה?');
      const reason = $('#corr-reason').value;
      await Store().correct(id, corrPick, reason);
      corrPick = null; closeSheet(true); toast('תוקן.'); render();
    } catch (e) { fail(e); }
  }

  /* ============================================================
     S05 — יצירת מילה (4 צעדים)
     ============================================================ */
  function openWordWizard(prefill = {}) {
    const draft = Mila.getState().drafts.word;
    wiz = Object.assign({ step: 1, title: '', rule: '', icon: 'leaf', startDate: Mila.today(), circleId: null, visibility: 'status' }, draft || {}, prefill, { step: 1 });
    ideasOpen = !wiz.title; ideasCat = 0;
    go('wordNew');
  }
  SCREENS.wordNew = () => {
    if (!wiz) wiz = { step: 1, title: '', rule: '', icon: 'leaf', startDate: Mila.today(), circleId: null, visibility: 'status' };
    const steps = `<div class="steps">${[1, 2, 3, 4].map(i => `<i class="${i <= wiz.step ? 'on' : ''}"></i>`).join('')}</div>`;
    const header = topbar({ title: 'אתגר משלך', end: `<button class="icon-btn" aria-label="סגירה" onclick="App.wizCancel()">${icon('x', 22)}</button>` });
    if (wiz.step === 1) return `${header}${steps}
      <div class="step-title">מה האתגר?</div><div class="step-sub">משהו שאפשר לסמן עליו וי בסוף כל יום.</div>
      ${templateChips('wizTemplate', wiz.title)}
      <div class="field"><label>שם האתגר</label><input class="input" id="w-title" placeholder="למשל: 8,000 צעדים ביום" maxlength="60" value="${esc(wiz.title)}" oninput="App.wizSet('title', this.value)"></div>
      <div class="field"><label>מה נחשב הצלחה?</label><textarea class="input" id="w-rule" placeholder="הכלל שלפיו תסמני וי" maxlength="200" oninput="App.wizSet('rule', this.value)">${esc(wiz.rule)}</textarea></div>
      <div class="field"><label>אייקון</label><div class="icon-picker">${Mila.WORD_ICONS.map(ic => `<span class="tile ${tileColorFor(wiz.title || ic)} ${wiz.icon === ic ? 'on' : ''}" onclick="App.wizSet('icon','${ic}'); App.refresh()">${icon(ic, 24)}</span>`).join('')}</div></div>
      <div class="mt-lg"><button class="btn primary" onclick="App.wizNext()">המשך</button></div>`;
    if (wiz.step === 2) {
      const opts = [[Mila.today(), 'היום'], [Mila.addDays(Mila.today(), 1), 'מחר'], [nextSunday(), 'יום ראשון הקרוב']];
      return `${header}${steps}
      <div class="step-title">מתי מתחילה?</div><div class="step-sub">${Mila.RULES.ROUND_DAYS} ימים ברצף. אפשר לדווח עד ${Mila.RULES.GRACE_HOUR}:00 למחרת.</div>
      ${opts.map(([d, l]) => `<div class="choice ${wiz.startDate === d ? 'on' : ''}" onclick="App.wizSet('startDate','${d}'); App.refresh()"><span class="radio">${wiz.startDate === d ? icon('check', 14) : ''}</span><div class="body"><div class="t">${l}</div><div class="m">${Mila.fmtDateLong(d)}</div></div></div>`).join('')}
      <div class="field"><label>או תאריך אחר</label><input class="input ltr" type="date" min="${Mila.today()}" value="${wiz.startDate}" onchange="App.wizSet('startDate', this.value); App.refresh()"></div>
      <div class="kv"><span class="k">${icon('calendar', 18)} הסבב</span><span class="v">${Mila.fmtDate(wiz.startDate)} – ${Mila.fmtDate(Mila.addDays(wiz.startDate, 13))}</span></div>
      <div class="btn-row mt-lg"><button class="btn soft" onclick="App.wizPrev()">חזרה</button><button class="btn primary" onclick="App.wizNext()">המשך</button></div>`;
    }
    if (wiz.step === 3) {
      const circles = Mila.myCircles();
      return `${header}${steps}
      <div class="step-title">מי רואה?</div>
      <div class="choice ${!wiz.circleId ? 'on' : ''}" onclick="App.wizSet('circleId', null); App.refresh()"><span class="radio">${!wiz.circleId ? icon('check', 14) : ''}</span><div class="body"><div class="t">רק אני</div><div class="m">בלי קבוצה. בלי דירוג.</div></div><span class="tile sm gray">${icon('lock', 18)}</span></div>
      ${circles.map(c => `<div class="choice ${wiz.circleId === c.id ? 'on' : ''}" onclick="App.wizSet('circleId','${c.id}'); App.refresh()"><span class="radio">${wiz.circleId === c.id ? icon('check', 14) : ''}</span><div class="body"><div class="t">${esc(c.name)}</div><div class="m">${Mila.circleMembers(c.id).length} חברות · נכנסת לדירוג</div></div>${circleTile(c, 'sm')}</div>`).join('')}
      ${!circles.length ? `<div class="tiny muted">עוד אין לך קבוצה. אפשר לפתוח אחת אחר כך.</div>` : ''}
      ${wiz.circleId ? `<div class="field mt"><label>מה החברות רואות</label>
        <div class="seg"><button class="${wiz.visibility === 'status' ? 'on' : ''}" onclick="App.wizSet('visibility','status'); App.refresh()">כל יום</button><button class="${wiz.visibility === 'summary' ? 'on' : ''}" onclick="App.wizSet('visibility','summary'); App.refresh()">רק בסוף</button></div>
        <div class="hint">${wiz.visibility === 'status' ? 'עמדת או פספסת, יום יום. בלי פרטים.' : 'רק אחוז ההצלחה בסוף הסבב.'}</div></div>` : ''}
      <div class="btn-row mt-lg"><button class="btn soft" onclick="App.wizPrev()">חזרה</button><button class="btn primary" onclick="App.wizNext()">המשך</button></div>`;
    }
    // step 4 — סיכום לפני נתינת מילה
    const cap = Mila.capCheck(Mila.me().id, wiz.startDate);
    const circle = wiz.circleId ? Mila.getState().circles[wiz.circleId] : null;
    return `${header}${steps}
      <div class="step-title">מוכנה?</div><div class="step-sub">14 יום. כל ערב מסמנת אם עמדת באתגר.</div>
      <div class="card"><div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">${wordTile({ title: wiz.title, icon: wiz.icon }, 'lg')}<div><div class="bold" style="font-size:1.15rem">${esc(wiz.title)}</div><div class="small muted">${esc(wiz.rule)}</div></div></div>
        <div class="kv"><span class="k">${icon('calendar', 18)} סבב</span><span class="v">${Mila.fmtDate(wiz.startDate)} – ${Mila.fmtDate(Mila.addDays(wiz.startDate, 13))}</span></div>
        <div class="kv"><span class="k">${icon('eye', 18)} מי רואה</span><span class="v">${circle ? esc(circle.name) : 'רק אני'}</span></div>
      </div>
      <div class="field"><label>אם אצליח, אני…</label><input class="input" maxlength="80" placeholder="למשל: קונה לעצמי משהו נחמד" value="${esc(wiz.reward || '')}" oninput="App.wizSet('reward', this.value)"><div class="hint">לא חובה. משהו קטן שיהיה שווה להתאמץ בשבילו.</div></div>
      ${!cap.ok ? `<div class="note warn">${icon('info', 18)}<span>כבר יש לך 3 אתגרים בימים האלה (${cap.conflictingWords.map(w => esc(w.title)).join(', ')}).</span></div>${cap.nextFree ? `<button class="btn soft" onclick="App.wizSet('startDate','${cap.nextFree}'); App.refresh()">להתחיל ב-${Mila.fmtDate(cap.nextFree)}</button>` : ''}` : ''}
      <div class="btn-row mt"><button class="btn soft" onclick="App.wizPrev()">חזרה</button><button class="btn primary" ${cap.ok ? '' : 'disabled'} onclick="App.wizCommit()">מתחילה</button></div>`;
  };
  function nextSunday() { const d = new Date(); const diff = (7 - d.getDay()) % 7 || 7; return Mila.addDays(Mila.today(), diff); }
  function wizSet(k, v) { wiz[k] = v; Mila.getState().drafts.word = { ...wiz }; Mila.save(); }
  function wizTemplate(i) { const t = Mila.TEMPLATES[i]; wiz.title = t.title; wiz.rule = t.rule; wiz.icon = t.icon; wizSet('title', t.title); ideasOpen = false; render(); }
  function wizNext() {
    try {
      if (wiz.step === 1) Mila.getState() && validateStep1();
      if (wiz.step === 2 && wiz.startDate < Mila.today()) throw { userMessage: 'אי אפשר להתחיל בתאריך שעבר' };
      wiz.step += 1; render();
    } catch (e) { fail(e); }
  }
  function validateStep1() { if (!wiz.title.trim()) throw { userMessage: 'איך קוראים לאתגר?' }; if (!wiz.rule.trim()) throw { userMessage: 'מה נחשב הצלחה?' }; }
  function wizPrev() { wiz.step -= 1; render(); }
  function wizCancel() { Mila.getState().drafts.word = { ...wiz }; Mila.save(); wiz = null; back(); if (Mila.getState().drafts.word && Mila.getState().drafts.word.title) toast('שמרנו טיוטה.'); }
  async function wizCommit() {
    try {
      const { def, commitment } = await Store().createPersonalWord({ title: wiz.title, rule: wiz.rule, icon: wiz.icon, startDate: wiz.startDate, circleId: wiz.circleId, visibility: wiz.circleId ? wiz.visibility : 'private', reward: wiz.reward || '' });
      wiz = null;
      stack = [{ name: 'today', params: {} }];
      go('word', { id: commitment.id, fresh: true });
      stamp('נתתי מילה.');
    } catch (e) {
      if (e.code === 'CAP') { wiz.step = 4; render(); }
      fail(e);
    }
  }

  /* ============================================================
     S05b — ספריית האתגרים: בחירת עד 3 + ״אם אצליח, אני…״
     ============================================================ */
  function freeSlots(startDate) {
    const me = Mila.me().id;
    const taken = Math.max(0, ...Mila.dateRange(startDate, Mila.RULES.ROUND_DAYS).map(d => Mila.activeWordsOn(me, d).length));
    return Math.max(0, Mila.RULES.DAILY_CAP - taken);
  }
  function openPick(prefillIds = [], opts = {}) {
    const L = Mila.LIBRARY;
    const circles = Mila.myCircles();
    const startDate = Mila.today();
    pick = { step: 1, selected: prefillIds.filter(id => L.get(id)).slice(0, Mila.RULES.DAILY_CAP), open: prefillIds.length ? L.get(prefillIds[0]).cat : L.CATEGORIES[0].id, rewards: {}, startDate, circleId: opts.circleId || (circles.length === 1 ? circles[0].id : null), visibility: 'status', shareSensitive: false };
    go('pick');
  }
  SCREENS.pick = () => {
    if (!pick) { openPick(); return ''; }
    const L = Mila.LIBRARY;
    const free = freeSlots(pick.startDate);
    const n = pick.selected.length;
    const header = topbar({ title: 'אז במה את מתחילה?', end: `<button class="icon-btn" aria-label="סגירה" onclick="App.pickCancel()">${icon('x', 22)}</button>` });
    if (pick.step === 2) return pickReview(header);
    return `${header}
      <div class="pick-head"><div class="step-sub" style="margin:0">בחרי עד 3 אתגרים ל-14 הימים הקרובים.</div><span class="chip ${n ? 'lime' : ''} lg">${n}/${Mila.RULES.DAILY_CAP}</span></div>
      ${free === 0 ? `<div class="note warn">${icon('info', 18)}<span>כבר יש לך 3 אתגרים בימים האלה. אפשר להתחיל חדש כשאחד נגמר.</span></div>` : free < Mila.RULES.DAILY_CAP ? `<div class="tiny muted mb">יש לך כבר ${Mila.RULES.DAILY_CAP - free}. נשאר מקום ל${free === 1 ? 'אתגר אחד' : `-${free}`}.</div>` : ''}
      ${L.CATEGORIES.map(cat => {
        const items = L.inCategory(cat.id); const open = pick.open === cat.id; const chosen = items.filter(ch => pick.selected.includes(ch.id)).length;
        return `<div class="cat ${open ? 'open' : ''}">
          <button class="cat-head" onclick="App.pickCat('${cat.id}')"><span class="emoji">${cat.emoji}</span><span class="name">${esc(cat.name)}</span><span class="count">${chosen ? `<span class="chip lime">${chosen}</span>` : items.length}</span>${icon('chev', 18)}</button>
          ${open ? `<div class="cat-body">${items.map(ch => { const on = pick.selected.includes(ch.id); const off = !on && n >= free; return `<div class="pick-row ${on ? 'on' : ''} ${off ? 'off' : ''}" onclick="App.pickToggle('${ch.id}')"><span class="box">${on ? icon('check', 14) : ''}</span><div class="body"><div class="t">${esc(ch.title)}</div>${on ? `<div class="m">${esc(ch.rule)}</div>` : ''}</div>${cat.sensitive ? `<span class="chip">${icon('lock', 12)} פרטי</span>` : ''}</div>`; }).join('')}</div>` : ''}
        </div>`;
      }).join('')}
      <div class="pick-bar"><span class="small">${n === 0 ? '0 מתוך 3 נבחרו' : n === 1 ? 'אחד מתוך 3 נבחר' : `${n} מתוך 3 נבחרו`}</span>${n ? `<button class="btn text xs" onclick="App.pickClear()">ניקוי בחירה</button>` : ''}</div>
      <button class="btn primary" ${n ? '' : 'disabled'} onclick="App.pickNext()">בחרתי. מה הלאה?</button>
      <button class="btn text mt" onclick="App.pickCustom()">${icon('plus', 16)} לא מצאת? צרי אתגר משלך</button>`;
  };
  function pickReview(header) {
    const L = Mila.LIBRARY;
    const circles = Mila.myCircles();
    const cap = Mila.capCheck(Mila.me().id, pick.startDate);
    const sensitive = pick.selected.filter(id => L.isSensitive(id));
    const circle = pick.circleId ? Mila.getState().circles[pick.circleId] : null;
    const opts = [[Mila.today(), 'היום'], [Mila.addDays(Mila.today(), 1), 'מחר']];
    return `${header}
      <div class="step-title">מוכנה?</div><div class="step-sub">14 ימים. כל ערב מסמנת אם עמדת באתגר.</div>
      ${pick.selected.map(id => { const ch = L.get(id); return `<div class="card tight"><div style="display:flex;gap:12px;align-items:center">${wordTile(ch)}<div style="flex:1;min-width:0"><div class="bold">${esc(ch.title)}</div><div class="small muted">${esc(ch.rule)}</div></div><button class="icon-btn" aria-label="הסרה" onclick="App.pickToggle('${id}')">${icon('x', 18)}</button></div>
        <div class="field" style="margin:10px 0 0"><label>אם אצליח, אני…</label><input class="input" maxlength="80" placeholder="למשל: קונה לעצמי משהו נחמד" value="${esc(pick.rewards[id] || '')}" oninput="App.pickReward('${id}', this.value)"></div></div>`; }).join('')}
      <div class="tiny muted mb">לא חובה. משהו קטן שיהיה שווה להתאמץ בשבילו. רק את רואה.</div>
      <div class="field"><label>מתי מתחילה?</label><div class="seg">${opts.map(([d, l]) => `<button class="${pick.startDate === d ? 'on' : ''}" onclick="App.pickSet('startDate','${d}')">${l}</button>`).join('')}</div></div>
      <div class="field"><label>מי רואה?</label>
        <div class="choice ${!pick.circleId ? 'on' : ''}" onclick="App.pickSet('circleId', null)"><span class="radio">${!pick.circleId ? icon('check', 14) : ''}</span><div class="body"><div class="t">רק אני</div><div class="m">בלי קבוצה. בלי דירוג.</div></div><span class="tile sm gray">${icon('lock', 18)}</span></div>
        ${circles.map(c => `<div class="choice ${pick.circleId === c.id ? 'on' : ''}" onclick="App.pickSet('circleId','${c.id}')"><span class="radio">${pick.circleId === c.id ? icon('check', 14) : ''}</span><div class="body"><div class="t">${esc(c.name)}</div><div class="m">${Mila.circleMembers(c.id).length} חברות · נכנסת לדירוג</div></div>${circleTile(c, 'sm')}</div>`).join('')}
        ${!circles.length ? `<div class="tiny muted">עוד אין לך קבוצה. אפשר להזמין חברות אחר כך.</div>` : ''}
      </div>
      ${circle && sensitive.length ? `<div class="checkbox-row ${pick.shareSensitive ? 'on' : ''}" onclick="App.pickSet('shareSensitive', ${!pick.shareSensitive})"><span class="box">${pick.shareSensitive ? icon('check', 16) : ''}</span><span>לשתף גם ${sensitive.length === 1 ? 'את האתגר הפרטי' : 'את האתגרים הפרטיים'} (זוגיות) עם ${esc(circle.name)}. בלי זה הם נשארים רק אצלך.</span></div>` : ''}
      ${!cap.ok ? `<div class="note warn">${icon('info', 18)}<span>3 אתגרים כבר רצים בימים האלה.${cap.nextFree ? ` פנוי מ-${Mila.fmtDate(cap.nextFree)}.` : ''}</span></div>` : ''}
      <div class="btn-row mt-lg"><button class="btn soft" onclick="App.pickBack()">חזרה</button><button class="btn primary" ${cap.ok && pick.selected.length ? '' : 'disabled'} ${busy ? 'disabled' : ''} onclick="App.pickCommit()">${busy ? 'רגע…' : 'מתחילה'}</button></div>`;
  }
  function pickCat(id) { pick.open = pick.open === id ? null : id; render(); }
  function pickToggle(id) {
    const i = pick.selected.indexOf(id);
    if (i >= 0) pick.selected.splice(i, 1);
    else { if (pick.selected.length >= freeSlots(pick.startDate)) return toast(freeSlots(pick.startDate) === 0 ? 'אין מקום פנוי בימים האלה.' : 'אפשר עד 3 אתגרים. כדי להוסיף, עצרי קודם אחד.'); pick.selected.push(id); }
    if (pick.step === 2 && !pick.selected.length) pick.step = 1;
    render();
  }
  function pickClear() { pick.selected = []; render(); }
  function pickSet(k, v) { pick[k] = v; if (k === 'startDate' && pick.selected.length > freeSlots(v)) { pick.selected = pick.selected.slice(0, freeSlots(v)); toast('בתאריך הזה יש פחות מקום.'); } render(); }
  function pickReward(id, v) { pick.rewards[id] = v; }
  function pickNext() { if (!pick.selected.length) return toast('בחרי אתגר אחד לפחות.'); pick.step = 2; render(); window.scrollTo({ top: 0 }); }
  function pickBack() { pick.step = 1; render(); }
  function pickCancel() { pick = null; back(); }
  function pickCustom() { const circleId = pick ? pick.circleId : null; pick = null; openWordWizard(circleId ? { circleId } : {}); }
  async function pickCommit() {
    if (busy) return;
    busy = true; render();
    const created = [];
    try {
      for (const id of [...pick.selected]) {
        const r = await Store().createPersonalWord({ libraryId: id, startDate: pick.startDate, circleId: pick.circleId, visibility: pick.visibility, reward: pick.rewards[id] || '', shareSensitive: pick.shareSensitive });
        created.push(r.commitment.id);
        pick.selected = pick.selected.filter(x => x !== id);
      }
      busy = false; pick = null;
      stack = [{ name: 'today', params: {} }];
      render();
      stamp(created.length === 1 ? 'נתתי מילה.' : `${created.length} אתגרים. נתתי מילה.`);
      afterFirstCommit();
    } catch (e) {
      busy = false; render(); fail(e);
      if (created.length) toast(`${created.length} נשמרו. ${pick.selected.length} לא.`);
    }
  }

  /* ============================================================
     S06 — פרטי מילה
     ============================================================ */
  SCREENS.word = ({ id, fresh }) => {
    const c = Mila.commitment(id);
    if (!c) return `${topbar({ title: 'אתגר' })}<div class="empty"><div class="t">האתגר לא נמצא</div></div>`;
    const def = Mila.wordDef(c.defId);
    const st = Mila.commitmentStats(id);
    const circle = def.circleId ? Mila.getState().circles[def.circleId] : null;
    const todayOb = Mila.obligationsOf(id).find(o => o.localDate === Mila.today());
    const obs = Mila.obligationsOf(id).filter(o => o.status !== 'cancelled');
    const correctable = obs.filter(o => Mila.canCorrect(o));
    const mine = c.userId === Mila.me().id;
    return `${topbar({ title: '', end: mine ? `<button class="icon-btn" aria-label="עוד" onclick="App.wordMenu('${id}')">${icon('more', 22)}</button>` : '' })}
      <div class="sheet-hero" style="margin-top:-6px">${wordTile(def, 'lg')}<div class="sheet-title">${esc(def.title)}</div><div class="sheet-sub" style="margin-bottom:6px">${esc(def.rule)}</div>
        <div class="chips">${def.kind === 'group' ? `<span class="chip lav">${icon('users', 13)} אתגר משותף</span>` : `<span class="chip">${icon('user', 13)} אישי</span>`}${circle ? `<span class="chip outline" onclick="App.go('circle',{id:'${circle.id}'})">${esc(circle.name)}</span>` : '<span class="chip outline">רק אני</span>'}${c.status !== 'active' ? `<span class="chip outline">${c.status === 'completed' ? 'נגמר' : 'נעצר'}</span>` : ''}</div></div>
      ${fresh ? `<div class="note lime">${icon('sparkle', 18)}<span>מתחיל ${Mila.relDay(c.startDate)}. דיווח עד ${Mila.RULES.GRACE_HOUR}:00 למחרת.</span></div>` : ''}
      <div class="stat-grid mb"><div class="stat lime"><div class="n">${st.success}</div><div class="l">עמדתי</div></div><div class="stat pink"><div class="n">${st.miss}</div><div class="l">פספסתי</div></div><div class="stat lav"><div class="n">${st.current}${icon('flame', 18)}</div><div class="l">ברצף</div></div></div>
      ${c.reward ? `<div class="card tight pastel-lav"><div class="tiny muted">${mine ? 'אם אצליח, אני…' : `${esc(Mila.user(c.userId).name)} הבטיחה לעצמה`}</div><div class="bold">${esc(c.reward)}</div></div>` : ''}
      ${mine && c.status === 'active' ? `<div class="btn-row mb word-invite"><button class="btn ghost sm" onclick="App.inviteFlow({ commitmentId: '${id}', kind: 'follow' })">תראי אם אני עומדת במילה שלי</button><button class="btn ghost sm" onclick="App.inviteFlow({ commitmentId: '${id}', kind: 'same' })">בואי, שתינו צריכות את זה</button></div>` : ''}
      <div class="card"><div class="card-title">14 הימים <span class="link">${c.status === 'active' ? `יום ${Math.max(st.dayIndex, 1)}` : `${Mila.fmtDate(c.startDate)} – ${Mila.fmtDate(c.endDate)}`}</span></div>${days14(id)}</div>
      ${mine && todayOb && !todayOb.outcome && Mila.isOpenNow(todayOb) ? `<button class="btn primary mb" onclick="App.reportSheet('${todayOb.id}')">${icon('check', 20)} דיווח על היום</button>` : ''}
      <div class="card tight">
        <div class="kv"><span class="k">${icon('calendar', 18)} הסבב</span><span class="v">${Mila.fmtDate(c.startDate)} – ${Mila.fmtDate(c.endDate)}</span></div>
        <div class="kv"><span class="k">${icon('chart', 18)} הצלחה</span><span class="v">${st.rate === null ? 'עוד מוקדם' : pct(st.rate)}</span></div>
        <div class="kv"><span class="k">${icon('minus', 18)} ימים חריגים</span><span class="v">${st.excused} מתוך ${Mila.RULES.MAX_EXCUSES_PER_ROUND}</span></div>
        <div class="kv"><span class="k">${icon('flame', 18)} הרצף הכי ארוך</span><span class="v">${st.best} ימים</span></div>
        <div class="kv"><span class="k">${icon('eye', 18)} מי רואה</span><span class="v">${!circle ? 'רק אני' : def.visibility === 'summary' ? `${esc(circle.name)} · רק בסוף` : esc(circle.name)}</span></div>
      </div>
      ${correctable.length && mine ? `<div class="section-title">הימים האחרונים <small>אפשר לתקן 24 שעות</small></div><div class="card tight">${correctable.map(o => `<div class="list-row clickable" onclick="App.reportSheet('${o.id}')"><span class="tile sm ${o.outcome === 'success' ? 'lime' : o.outcome === 'miss' ? 'pink' : 'lav'}">${icon(o.outcome === 'success' ? 'check' : o.outcome === 'miss' ? 'x' : 'minus', 18)}</span><div class="body"><div class="t">${Mila.relDay(o.localDate)} · ${o.outcome === 'success' ? 'עמדתי' : o.outcome === 'miss' ? 'פספסתי' : 'יום חריג'}</div><div class="m">${o.resolveReason === 'auto_unreported' ? 'לא דיווחת, נספר כפספוס' : o.correctedAt ? 'תוקן' : Mila.fmtTime(o.resolvedAt)}</div></div>${icon('edit', 18)}</div>`).join('')}</div>` : ''}
    `;
  };
  function wordMenu(id) {
    const c = Mila.commitment(id); const def = Mila.wordDef(c.defId);
    sheet(`<div class="sheet-title">${esc(def.title)}</div>
      ${def.circleId && def.visibility !== 'summary' && def.ownerId === Mila.me().id ? `<div class="list-row clickable" onclick="App.setVisibility('${def.id}','summary')"><span class="tile sm gray">${icon('eyeOff', 18)}</span><div class="body"><div class="t">להראות לחברות רק בסוף</div><div class="m">בלי הדיווח היומי</div></div></div>` : ''}
      ${c.status === 'active' ? `<div class="list-row clickable" onclick="App.endWord('${id}')"><span class="tile sm pink">${icon('x', 18)}</span><div class="body"><div class="t">לעצור את האתגר</div><div class="m">הנקודות שצברת נשארות</div></div></div>` : ''}
      <div class="list-row clickable" onclick="App.closeSheet(); ${def.libraryId ? `App.openPick(['${def.libraryId}'])` : `App.openWordWizard({title:'${esc(def.title).replace(/'/g, '&#39;')}', rule:'${esc(def.rule).replace(/'/g, '&#39;')}', icon:'${def.icon}', startDate:'${c.endDate >= Mila.today() ? Mila.addDays(c.endDate, 1) : Mila.today()}'})`}"><span class="tile sm lime">${icon('repeat', 18)}</span><div class="body"><div class="t">עוד סיבוב</div><div class="m">אותו אתגר, 14 ימים חדשים</div></div></div>`);
  }
  function endWord(id) {
    confirmSheet({ title: 'לעצור את האתגר?', sub: 'הנקודות שצברת נשארות. אפשר להתחיל אותו שוב מתי שתרצי.', okText: 'לעצור', okClass: 'pink', onOk: async () => { await Store().endCommitment(id); closeSheet(true); toast('נעצר.'); render(); } });
  }
  async function setVisibility(defId, vis) { try { await Store().updateWordVisibility(defId, vis); closeSheet(true); render(); toast('החברות יראו רק בסוף.'); } catch (e) { fail(e); } }

  /* ============================================================
     S16 — סיכום סבב
     ============================================================ */
  SCREENS.summary = ({ id }) => {
    const s = Mila.roundSummary(id);
    if (!s.commitment.summarySeen) { s.commitment.summarySeen = true; Store().markSummarySeen(id).catch(() => {}); }
    const rate = s.stats.rate === null ? null : s.stats.rate;
    const line = rate === null ? 'לא היו ימים לספור.' : rate >= 0.85 ? 'כמעט בלי לפספס.' : rate >= 0.6 ? 'רוב הימים עמדת.' : 'סבב קשה. מה שעמדת בו נשאר.';
    return `${topbar({ title: 'סיכום', back: true })}
      <div class="sheet-hero">${wordTile(s.def, 'lg')}<div class="sheet-title">${rate !== null && s.stats.miss === 0 && s.stats.success >= 14 ? 'מילה בסלע.' : 'אמרת ועשית.'}</div><div class="sheet-sub">${esc(s.def.title)} · 14 יום</div></div>
      <div class="card balance-card pastel-lime"><div class="label">נקודות בסבב</div><div class="amount">${icon('star', 34)}<span class="num">${s.earned}</span><span class="cur">נק׳</span></div><div class="note" style="display:inline-flex;margin:8px 0 0">${line}</div></div>
      <div class="stat-grid mb"><div class="stat lime"><div class="n">${s.stats.success}</div><div class="l">עמדתי</div></div><div class="stat pink"><div class="n">${s.stats.miss}</div><div class="l">פספסתי</div></div><div class="stat lav"><div class="n">${s.stats.excused}</div><div class="l">ימים חריגים</div></div></div>
      <div class="card"><div class="card-title">יום אחרי יום <span class="link">${s.stats.rate !== null ? pct(s.stats.rate) : ''}</span></div>${days14(id)}<div class="kv mt"><span class="k">${icon('flame', 18)} הרצף הכי ארוך</span><span class="v">${s.stats.best} ימים</span></div></div>
      ${s.circle ? `<div class="card tight clickable" onclick="App.go('circle',{id:'${s.circle.id}'})"><div class="list-row">${circleTile(s.circle, 'sm')}<div class="body"><div class="t">${esc(s.circle.name)}</div><div class="m">מי מובילה?</div></div>${icon('chev', 18)}</div></div>` : ''}
      <button class="btn primary" onclick="${s.def.libraryId ? `App.openPick(['${s.def.libraryId}'])` : `App.openWordWizard({title:'${esc(s.def.title).replace(/'/g, '&#39;')}', rule:'${esc(s.def.rule).replace(/'/g, '&#39;')}', icon:'${s.def.icon}', startDate:'${Mila.today()}'})`}">${icon('repeat', 20)} עוד סיבוב?</button>
      <button class="btn text mt" onclick="App.tab('today')">לא עכשיו</button>`;
  };

  /* ============================================================
     S08 — הקבוצות שלי
     ============================================================ */
  SCREENS.circles = () => {
    const circles = Mila.myCircles();
    const S = Mila.getState();
    const pending = S.pendingInvite && !Mila.isMember(S.invites[S.pendingInvite.token] ? S.invites[S.pendingInvite.token].circleId : '') ? S.pendingInvite : null;
    const pendingPreview = pending ? Mila.previewInvite(pending.token) : null;
    const proposals = circles.flatMap(c => Object.values(S.wordDefs).filter(d => d.circleId === c.id && d.kind === 'group' && d.status !== 'cancelled' && !Mila.myAdoption(d.id) && (d.endDate || '9999') >= Mila.today()).map(d => ({ d, c })));
    return `${topbar({ title: 'הקבוצות שלי', back: false, end: `<button class="icon-btn lime" aria-label="קבוצה חדשה" onclick="App.circleAddSheet()">${icon('plus', 22)}</button>` })}
      ${circles.length ? circles.map(c => {
        const members = Mila.circleMembers(c.id);
        const words = Object.values(S.wordDefs).filter(d => d.circleId === c.id && d.status !== 'cancelled' && (d.kind === 'group' ? (d.endDate || '9999') >= Mila.today() : d.visibility !== 'private' && Object.values(S.commitments).some(k => k.defId === d.id && k.status === 'active'))).length;
        const ri = Mila.rankInsight(c.id); const rd = Mila.circleRound(c.id);
        return `<div class="row-card" onclick="App.go('circle',{id:'${c.id}'})">${avatarStack(members, 34, 3)}<div class="body"><div class="t">${esc(c.name)}</div><div class="m">${ri && ri.place ? `מקום ${ri.place} מתוך ${ri.total} · ` : ''}יום ${rd.dayIndex} מתוך ${Mila.RULES.ROUND_DAYS}${Mila.isAdmin(c.id) ? ' · את מנהלת' : ''}</div></div>${icon('chev', 20)}</div>`;
      }).join('') : `<div class="card empty"><span class="tile lg pink">${icon('users', 28)}</span><div class="t">עם חברות קל יותר לעמוד במילה</div><div class="m">פותחת קבוצה ומזמינה חברות. כל אחת בוחרת אתגרים משלה, ורואות יחד מי מתמידה.</div><div class="btn-row"><button class="btn primary" onclick="App.go('circleNew')">פותחת קבוצה</button><button class="btn ghost" onclick="App.joinByCodeSheet()">יש לי קוד מחברה</button></div></div>`}

      ${pendingPreview && pendingPreview.ok ? `<div class="section-title">באה איתי?</div>
        <div class="row-card" onclick="App.openInvite('${pending.token}')">${avatarStack([pendingPreview.inviter], 40, 1)}<div class="body"><div class="t">${esc(pendingPreview.inviter.name)} מזמינה אותך</div><div class="m">${esc(pendingPreview.circle.name)}${pendingPreview.sampleWord ? ` · ${esc(pendingPreview.sampleWord.title)}` : ''}</div></div>${icon('chev', 20)}</div>` : ''}

      ${proposals.length ? `<div class="section-title">אתגרים שמחכים לך</div>${proposals.map(({ d, c }) => `<div class="word-row" onclick="App.go('groupWord',{id:'${d.id}'})">${wordTile(d)}<div class="body"><div class="name">${esc(d.title)}</div><div class="meta"><span class="chip outline">${esc(c.name)}</span><span class="chip lav">${Mila.adopters(d.id).length} בפנים</span></div></div>${icon('chev', 18)}</div>`).join('')}` : ''}
`;
  };
  function circleAddSheet() {
    sheet(`<div class="sheet-title">קבוצה עם חברות</div>
      <div class="list-row clickable" onclick="App.closeSheet(); App.go('circleNew')"><span class="tile sm lime">${icon('plus', 18)}</span><div class="body"><div class="t">פותחת קבוצה חדשה</div><div class="m">ומזמינה חברות להצטרף</div></div>${icon('chev', 18)}</div>
      <div class="list-row clickable" onclick="App.joinByCodeSheet()"><span class="tile sm pink">${icon('link', 18)}</span><div class="body"><div class="t">מצטרפת לקבוצה של חברה</div><div class="m">חברה שלחה לך קוד או קישור? מכניסה אותו כאן.</div></div>${icon('chev', 18)}</div>`);
  }
  function joinByCodeSheet() {
    sheet(`<div class="sheet-title">מצטרפת לקבוצה של חברה</div><div class="sheet-sub">מקלידה את הקוד מההודעה שקיבלת (6 תווים), או מדביקה את הקישור כולו.</div>
      <div class="input-row"><input class="input ltr" id="join-code" placeholder="ABC123" maxlength="200" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.15em;text-align:center"><button class="btn dark sm" onclick="App.joinByCode()">המשך</button></div>
`);
    setTimeout(() => $('#join-code') && $('#join-code').focus(), 50);
  }
  async function joinByCode() {
    const raw = ($('#join-code').value || '').trim();
    const m = raw.match(/invite=([A-Za-z0-9]+)/);
    const token = (m ? m[1] : raw).toUpperCase();
    try {
      const p = await Store().previewInvite(token);
      if (!p.ok) return toast(p.reason === 'not_found' ? 'הקוד לא נמצא.' : p.reason === 'expired' ? 'הקוד פג. בקשי חדש.' : 'הקוד לא תקף.');
      closeSheet(true); go('invite', { token });
    } catch (e) { fail(e); }
  }
  /* טוען תצוגה מקדימה של הזמנה (בענן – מהשרת) ואז מנווט */
  async function openInvite(token) {
    try { await Store().previewInvite(token); go('invite', { token }); } catch (e) { fail(e); }
  }

  /* ============================================================
     S10 — יצירת קבוצה
     ============================================================ */
  SCREENS.circleNew = () => {
    if (!cwiz) cwiz = { name: '', description: '', whoCanPropose: 'all', maxMembers: 8, color: 'pink' };
    return `${topbar({ title: 'קבוצה חדשה' })}
      <div class="step-title">איך קוראים לקבוצה?</div>
      <div class="field"><label>שם</label><input class="input" placeholder="למשל: הבנות מהמשרד" maxlength="50" value="${esc(cwiz.name)}" oninput="App.cwSet('name', this.value)"></div>
      <div class="field"><label>תיאור (לא חובה)</label><input class="input" placeholder="על מה אנחנו?" maxlength="120" value="${esc(cwiz.description)}" oninput="App.cwSet('description', this.value)"></div>
      <div class="field"><label>צבע</label><div class="chips">${Mila.AVATAR_COLORS.map(c => `<button class="chip select ${cwiz.color === c ? 'on' : ''}" onclick="App.cwSet('color','${c}'); App.refresh()"><span class="tile sm ${COLOR_TO_TILE[c]}" style="width:18px;height:18px;border-radius:6px"></span> ${{ lime: 'ליים', pink: 'ורוד', lavender: 'לבנדר', mint: 'מנטה', peach: 'אפרסק', sky: 'תכלת' }[c]}</button>`).join('')}</div></div>
      <div class="field"><label>מי פותחת אתגר משותף?</label><div class="seg"><button class="${cwiz.whoCanPropose === 'all' ? 'on' : ''}" onclick="App.cwSet('whoCanPropose','all'); App.refresh()">כל אחת</button><button class="${cwiz.whoCanPropose === 'admins' ? 'on' : ''}" onclick="App.cwSet('whoCanPropose','admins'); App.refresh()">רק מנהלות</button></div><div class="hint">כל חברה בוחרת אם להצטרף.</div></div>
      <div class="field"><label>מקסימום חברות</label><div class="chips">${[4, 6, 8, 12].map(n => `<button class="chip select ${cwiz.maxMembers === n ? 'on' : ''}" onclick="App.cwSet('maxMembers',${n}); App.refresh()">${n}</button>`).join('')}</div></div>
      <div class="mt-lg"><button class="btn primary" ${cwiz.name.trim() ? '' : 'disabled'} onclick="App.cwCreate()">פותחת ומזמינה</button></div>`;
  };
  function cwSet(k, v) { cwiz[k] = v; const b = $('#screen .btn.primary'); if (b) b.disabled = !cwiz.name.trim(); }
  async function cwCreate() {
    try {
      const { circle } = await Store().createCircle(cwiz);
      cwiz = null;
      stack = [{ name: 'circles', params: {} }];
      stack.push({ name: 'circle', params: { id: circle.id } });
      inviteFlow({ circleId: circle.id });
    } catch (e) { fail(e); }
  }

  /* ============================================================
     S09 — בתוך קבוצה
     ============================================================ */
  SCREENS.circle = ({ id }) => {
    const S = Mila.getState();
    const c = S.circles[id];
    if (!c || !Mila.isMember(id)) return `${topbar({ title: 'קבוצה' })}<div class="empty"><div class="t">את לא בקבוצה הזו</div></div>`;
    const members = Mila.circleMembers(id);
    const round = Mila.circleRound(id);
    const prev = Mila.previousRoundWinner(id);
    const left = Math.max(0, Mila.RULES.ROUND_DAYS - round.dayIndex);
    const groupWords = Object.values(S.wordDefs).filter(d => d.circleId === id && d.kind === 'group' && d.status !== 'cancelled').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const liveGroup = groupWords.filter(d => (d.endDate || '9999') >= Mila.today());
    const hero = liveGroup[0];
    const canPropose = c.whoCanPropose === 'all' || Mila.isAdmin(id);
    const { rows } = Mila.leaderboard(id);
    const ri = Mila.rankInsight(id);
    const meId = Mila.me().id;
    return `${topbar({ title: c.name, end: `<button class="icon-btn lime" aria-label="להזמין חברה" onclick="App.inviteFlow({ circleId: '${id}' })">${icon('share', 20)}</button><button class="icon-btn" aria-label="עוד" onclick="App.circleMenu('${id}')">${icon('more', 22)}</button>` })}
      <div class="round-line"><span class="bold">יום ${round.dayIndex} מתוך ${Mila.RULES.ROUND_DAYS}</span><span class="muted">·</span><span class="muted">${left === 0 ? 'היום האחרון' : left === 1 ? 'נשאר יום אחד' : `נשארו ${left} ימים`}</span><span class="chip" style="margin-inline-start:auto">סבב ${round.index}</span></div>
      <div class="progress mb"><i style="width:${(round.dayIndex / Mila.RULES.ROUND_DAYS) * 100}%"></i></div>

      <div class="card"><div class="card-title">מי מובילה?</div>
        ${rows.length ? rows.map(r => `<div class="bar-row ${r.user.id === meId ? 'me' : ''} ${!r.ranked ? 'unranked' : ''}"><span class="place ${r.place === 1 ? 'first' : ''}">${r.place ?? '–'}</span>${avatar(r.user, 32)}<div class="body"><div class="t">${esc(r.user.name)}${r.user.id === meId ? ' (את)' : ''}</div>${r.ranked ? `<div class="bar"><i style="width:${Math.round(r.rate * 100)}%"></i></div>` : `<div class="m">${r.hidden ? 'מחוץ לדירוג' : `עוד ${Math.max(Mila.RULES.MIN_RANKED_EVENTS - r.resolved, 1)} דיווחים`}</div>`}</div><span class="rate">${r.ranked ? pct(r.rate) : ''}</span><span class="pts" title="הצלחות">${r.success}</span></div>`).join('') : `<div class="small muted">עוד אין דיווחים בסבב הזה.</div>`}
        ${ri ? `<div class="insight">${esc(ri.text)}</div>` : ''}
        <div class="tiny muted" style="margin-top:8px">אחוז הצלחה מתוך הימים שדווחו, ומספר הנקודות. ${Mila.RULES.MIN_RANKED_EVENTS} דיווחים לפחות כדי להיכנס לדירוג.</div>
      </div>
      ${prev ? `<div class="card tight pastel-lav"><div style="display:flex;align-items:center;gap:12px"><span class="tile lav">${icon('medal')}</span><div style="flex:1"><div class="bold">${prev.user.id === meId ? 'את ניצחת את הסבב הקודם.' : `${esc(prev.user.name)} ניצחה את הסבב הקודם.`}</div><div class="small muted">${pct(prev.rate)} התמדה · ${prev.success} נקודות · ${Mila.fmtDate(prev.round.start)} – ${Mila.fmtDate(prev.round.end)}</div></div></div></div>` : ''}

      ${hero && !Mila.myAdoption(hero.id) ? `<div class="card pastel-lime clickable tight" onclick="App.go('groupWord',{id:'${hero.id}'})"><div style="display:flex;align-items:center;gap:12px">${wordTile(hero)}<div style="flex:1"><div class="bold">בואי, כולנו צריכות את זה</div><div class="small muted">${esc(hero.title)} · ${Mila.adopters(hero.id).length} בפנים</div></div><button class="btn primary sm">אני בפנים</button></div></div>` : ''}

      <div class="tabs">${[['feed', 'עדכונים'], ['words', 'אתגרים'], ['members', 'חברות']].map(([k, l]) => `<button class="${circleTab === k ? 'on' : ''}" onclick="App.setCircleTab('${k}')">${l}</button>`).join('')}</div>
      ${circleTab === 'feed' ? circleFeed(id) : circleTab === 'words' ? circleWords(id, groupWords) : circleMembersView(id, members)}
    `;
  };
  function setCircleTab(k) { circleTab = k === 'rank' ? 'feed' : k; render(); }

  function feedText(e) {
    const n = `<b>${esc(e.actor.name)}</b>`;
    const t = e.payload && e.payload.title ? `״${esc(e.payload.title)}״` : '';
    switch (e.type) {
      case 'day_success': return `${n} אמרה ועשתה: ${t} <span class="chip lime">+1</span>`;
      case 'day_miss': return `${n} פספסה: ${t}`;
      case 'overtake': { const p = Mila.user(e.payload.passedUserId); return `${n} עקפה את ${p ? esc(p.name) : 'חברה'} ${icon('trophy', 14)}`; }
      case 'day_excused': return `${n} יום חריג: ${t}`;
      case 'streak': return `${n} ${e.payload.streak} ימים ברצף: ${t} ${icon('flame', 14)}`;
      case 'group_word_proposed': return `${n} פתחה אתגר משותף: ${t}`;
      case 'group_word_adopted': return `${n} בפנים: ${t}`;
      case 'word_committed': return `${n} נתנה מילה: ${t}`;
      case 'member_joined': return `${n} הצטרפה`;
      case 'member_left': return `${n} עזבה`;
      case 'member_removed': return `${n} הסירה חברה`;
      case 'admin_transferred': return `${n} מנהלת עכשיו`;
      case 'circle_created': return `${n} פתחה את הקבוצה`;
      case 'encouragement': { const to = Mila.user(e.payload.toUserId); return `${n} שלחה מילה טובה ל${to ? esc(to.name) : 'חברה'} ${icon(REACTION_ICON[e.payload.reaction] || 'clap', 14)}`; }
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
    if (!items.length) return `<div class="empty"><span class="tile lg lav">${icon('sparkle', 28)}</span><div class="t">עוד שקט כאן</div><div class="m">כל הצלחה, פספוס ומילה טובה יופיעו פה.</div></div>`;
    return `<div class="card tight">${items.map(e => `<div class="feed-item">${avatar(e.actor, 38)}<div class="body"><div class="t">${feedText(e)}</div><div class="m">${timeAgo(e.createdAt)}</div>
      ${['day_success', 'streak', 'group_word_adopted', 'word_committed', 'overtake'].includes(e.type) ? `<div class="reactions">${Mila.REACTIONS.map(r => { const n = e.reactions.filter(x => x.reaction === r).length; const mine = e.reactions.some(x => x.reaction === r && x.userId === Mila.me().id); return (n || true) ? `<button class="react ${mine ? 'on' : ''}" onclick="App.react('${e.id}','${r}')">${icon(REACTION_ICON[r], 14)}${n ? ` ${n}` : ''}</button>` : ''; }).join('')}</div>` : ''}
    </div></div>`).join('')}</div>`;
  }
  function circleRank(id) {
    const { round, rows } = Mila.leaderboard(id);
    const meId = Mila.me().id;
    return `<div class="card tight"><div class="tiny muted" style="padding:6px 0 4px">סבב ${round.index} · לפי אחוז הצלחה</div>
      ${rows.map(r => `<div class="rank-row ${r.place === 1 ? 'first' : ''} ${r.user.id === meId ? 'me' : ''}"><span class="place">${r.place ?? '–'}</span>${avatar(r.user, 38)}<div class="body"><div class="t">${esc(r.user.name)}${r.user.id === meId ? ' (את)' : ''}</div><div class="m">${r.hidden ? 'מחוץ לדירוג' : r.ranked ? `${r.success} הצלחות · ${r.miss} פספוסים${r.streak ? ` · ${r.streak} ברצף` : ''}` : r.words ? 'עוד מוקדם לדרג' : 'עוד לא בפנים'}</div></div><span class="rate">${r.ranked ? pct(r.rate) : ''}</span>${r.user.id !== meId ? `<button class="icon-btn" aria-label="עידוד" onclick="App.encourageSheet('${id}','${r.user.id}')">${icon('clap', 20)}</button>` : ''}</div>`).join('')}
    </div>`;
  }
  function circleWords(id, groupWords) {
    const S = Mila.getState();
    const personal = Object.values(S.wordDefs).filter(d => d.circleId === id && d.kind === 'personal' && d.visibility !== 'private');
    const canPropose = S.circles[id].whoCanPropose === 'all' || Mila.isAdmin(id);
    return `${canPropose ? `<button class="btn ghost mb" onclick="App.openGroupWizard('${id}')">${icon('plus', 20)} אתגר משותף</button>` : ''}
      ${groupWords.length ? `<div class="section-title" style="margin-top:6px">אתגרים משותפים</div>${groupWords.map(d => { const ad = Mila.adopters(d.id); const mine = Mila.myAdoption(d.id); const over = (d.endDate || '9999') < Mila.today(); return `<div class="word-row" onclick="App.go('groupWord',{id:'${d.id}'})">${wordTile(d)}<div class="body"><div class="name">${esc(d.title)}</div><div class="meta">${avatarStack(ad, 18, 4)} ${ad.length} בפנים ${mine ? '<span class="chip lime">את בפנים</span>' : over ? '<span class="chip">נגמרה</span>' : '<span class="chip lav">באה איתנו?</span>'}</div></div>${icon('chev', 18)}</div>`; }).join('')}` : ''}
      ${personal.length ? `<div class="section-title">האתגרים של החברות</div>${personal.map(d => { const k = Object.values(S.commitments).find(x => x.defId === d.id && x.status === 'active'); const u = Mila.user(d.ownerId); const st = k ? Mila.commitmentStats(k.id) : null; return `<div class="word-row" ${d.ownerId === Mila.me().id && k ? `onclick="App.go('word',{id:'${k.id}'})"` : ''}>${wordTile(d)}<div class="body"><div class="name">${esc(d.title)}</div><div class="meta">${avatar(u, 16)} ${esc(u.name)}${st && d.visibility === 'status' ? ` · ${st.success} הצלחות${st.current ? ` · ${st.current} ברצף` : ''}` : ''}</div></div></div>`; }).join('')}` : ''}
      ${!groupWords.length && !personal.length ? `<div class="empty"><span class="tile lg lime">${icon('pencil', 28)}</span><div class="t">עוד אין אתגר משותף</div><div class="m">פתחי אחד. כל חברה בוחרת אם להצטרף.</div></div>` : ''}`;
  }
  function circleMembersView(id, members) {
    const meId = Mila.me().id; const admin = Mila.isAdmin(id); const c = Mila.getState().circles[id];
    return `<div class="card tight">${members.map(u => `<div class="list-row">${avatar(u, 40)}<div class="body"><div class="t">${esc(u.name)}${u.id === meId ? ' (את)' : ''}${u.role === 'admin' ? ' <span class="chip lime">מנהלת</span>' : ''}</div><div class="m">מאז ${Mila.fmtDate(Mila.toLocalDate(new Date(u.joinedAt)))}</div></div>${u.id !== meId ? `<button class="icon-btn" aria-label="אפשרויות" onclick="App.memberSheet('${id}','${u.id}')">${icon('more', 20)}</button>` : ''}</div>`).join('')}</div>
      <button class="btn ghost mt" onclick="App.inviteFlow({ circleId: '${id}' })">${icon('share', 20)} להזמין חברה</button>
      <div class="tiny muted center mt">${members.length} מתוך ${c.maxMembers}</div>`;
  }
  /* פעולות על חברה: מילה טובה, (מנהלת:) להפוך למנהלת / להחזיר לחברה / להסיר, בטיחות */
  function memberSheet(circleId, userId) {
    const u = Mila.circleMembers(circleId).find(x => x.id === userId); if (!u) return;
    const admin = Mila.isAdmin(circleId);
    sheet(`<div class="sheet-hero">${avatar(u, 56)}<div class="sheet-title" style="margin-top:8px">${esc(u.name)}</div><div class="sheet-sub">${u.role === 'admin' ? 'מנהלת' : 'חברה'} בקבוצה</div></div>
      <div class="list-row clickable" onclick="App.encourageSheet('${circleId}','${userId}')"><span class="tile sm lime">${icon('clap', 18)}</span><div class="body"><div class="t">מילה טובה</div><div class="m">עידוד קטן</div></div></div>
      ${admin && u.role !== 'admin' ? `<div class="list-row clickable" onclick="App.setRole('${circleId}','${userId}','admin')"><span class="tile sm lav">${icon('star', 18)}</span><div class="body"><div class="t">להפוך למנהלת</div><div class="m">תוכל לנהל את הקבוצה איתך</div></div></div>` : ''}
      ${admin && u.role === 'admin' ? `<div class="list-row clickable" onclick="App.setRole('${circleId}','${userId}','member')"><span class="tile sm gray">${icon('user', 18)}</span><div class="body"><div class="t">להחזיר לחברה רגילה</div><div class="m">בלי הרשאות ניהול</div></div></div>` : ''}
      ${admin ? `<div class="list-row clickable" onclick="App.removeMember('${circleId}','${userId}')"><span class="tile sm pink">${icon('x', 18)}</span><div class="body"><div class="t">להסיר מהקבוצה</div><div class="m">האתגרים שלה כאן ייעצרו. הנקודות נשארות שלה.</div></div></div>` : ''}
      <div class="list-row clickable" onclick="App.safetySheet('${userId}','${circleId}')"><span class="tile sm gray">${icon('shield', 18)}</span><div class="body"><div class="t">דיווח או חסימה</div><div class="m">אם משהו לא בסדר</div></div></div>`);
  }
  async function setRole(circleId, userId, role) { try { await Store().setMemberRole(circleId, userId, role); closeSheet(true); render(); toast(role === 'admin' ? 'עכשיו היא מנהלת.' : 'חזרה להיות חברה.'); } catch (e) { fail(e); } }
  function removeMember(circleId, userId) {
    const u = Mila.user(userId);
    confirmSheet({ title: `להסיר את ${u.name}?`, sub: 'היא לא תראה יותר את הקבוצה, והאתגרים שלה כאן ייעצרו. הנקודות שלה נשארות שלה.', okText: 'להסיר', okClass: 'pink', onOk: async () => { await Store().removeMember(circleId, userId); closeSheet(true); render(); toast('הוסרה מהקבוצה'); } });
  }
  function encourageSheet(circleId, toUserId) {
    const u = Mila.user(toUserId);
    sheet(`<div class="sheet-title">מילה טובה ל${esc(u.name)}</div>
      <div class="react-picker">${Mila.REACTIONS.map(r => `<button title="${REACTION_LABEL[r]}" onclick="App.sendEncouragement('${circleId}','${toUserId}','${r}')">${icon(REACTION_ICON[r], 24)}</button>`).join('')}</div>`);
  }
  async function react(eventId, reaction) { try { await Store().encourage(eventId, reaction); render(); } catch (e) { fail(e); } }
  async function sendEncouragement(circleId, toUserId, reaction) { try { await Store().sendEncouragement(circleId, toUserId, reaction); closeSheet(true); toast('נשלח.'); render(); } catch (e) { fail(e); } }
  function circleMenu(id) {
    const admin = Mila.isAdmin(id);
    const c = Mila.getState().circles[id];
    sheet(`<div class="sheet-title">${esc(c.name)}</div>
      ${c.whoCanPropose === 'all' || admin ? `<div class="list-row clickable" onclick="App.closeSheet(); App.openGroupWizard('${id}')"><span class="tile sm lav">${icon('pencil', 18)}</span><div class="body"><div class="t">אתגר משותף</div><div class="m">כל חברה בוחרת אם להצטרף</div></div></div>` : ''}
      <div class="list-row clickable" onclick="App.closeSheet(); App.inviteFlow({ circleId: '${id}' })"><span class="tile sm lime">${icon('share', 18)}</span><div class="body"><div class="t">להזמין חברה</div><div class="m">קוד או קישור</div></div></div>
      ${admin ? `<div class="list-row clickable" onclick="App.closeSheet(); App.go('circleManage',{id:'${id}'})"><span class="tile sm lav">${icon('settings', 18)}</span><div class="body"><div class="t">ניהול הקבוצה</div><div class="m">שם, חברות, הרשאות, סגירה</div></div></div>` : ''}
      <div class="list-row clickable" onclick="App.closeSheet(); App.safetySheet(null,'${id}')"><span class="tile sm gray">${icon('flag', 18)}</span><div class="body"><div class="t">דיווח</div><div class="m">תוכן פוגעני או לחץ</div></div></div>
      <div class="list-row clickable" onclick="App.leaveCircle('${id}')"><span class="tile sm pink">${icon('logout', 18)}</span><div class="body"><div class="t">לעזוב את הקבוצה</div><div class="m">האתגרים שלך כאן ייעצרו</div></div></div>`);
  }
  function leaveCircle(id) {
    confirmSheet({ title: 'לעזוב את הקבוצה?', sub: 'האתגרים שלך בקבוצה הזו ייעצרו. הנקודות נשארות שלך.', okText: 'לעזוב', okClass: 'pink', onOk: async () => { await Store().leaveCircle(id); closeSheet(true); tab('circles'); toast('עזבת.'); } });
  }
  /* שלושה סוגי הזמנה. הטקסט נבנה מתבניות (בלי בינה מלאכותית) ואפשר לערוך לפני השליחה. */
  const INVITE_KINDS = {
    follow: { title: 'תראי אם אני עומדת במילה שלי 😂', sub: 'חברה רואה את ההתקדמות שלך.', cta: 'אני רוצה להזמין חברה', icon: 'eye', tile: 'lav' },
    compete: { title: 'נראה אותך עומדת בזה יותר ממני', sub: 'חברה בוחרת 3 אתגרים משלה. מתחרות על התמדה.', cta: 'אני רוצה להזמין לתחרות', icon: 'trophy', tile: 'lime' },
    same: { title: 'בואי, שתינו צריכות את זה', sub: 'חברה לוקחת את אותו אתגר.', cta: 'אני רוצה לאתגר חברה', icon: 'users', tile: 'pink' },
  };
  const INVITE_BY_LIBRARY = {
    food_no_delivery: ['שוב נשבעתי שאני מפסיקה עם המשלוחים. תראי אם הפעם זה מחזיק.', '14 ימים בלי להזמין אוכל. את מוזמנת לפקח על הנס.', 'הפעם אני רצינית. כנראה. בואי תראי.'],
    move_8000_steps: ['8,000 צעדים ביום. בואי נראה מי זזה יותר.', 'אנחנו הולכות על זה? תרתי משמע.'],
    move_no_phone_bed: ['14 לילות בלי טלפון במיטה. תראי אם אני שורדת.', 'הטלפון ישן בסלון. אני במיטה. 14 יום. נראה אותך.'],
    hab_no_impulse_buy: ['14 ימים בלי לקנות שטויות. אני בפנים. את באה?', 'בלי קניות אימפולסיביות. שתינו יודעות שאנחנו צריכות את זה.'],
    food_no_sweets_evening: ['בלי מתוק אחרי ארוחת ערב. 14 יום. תראי אם אני מחזיקה.', 'הקינוח נדחה ב-14 יום. את מוזמנת לפקח.'],
  };
  function inviteMessages(kind, w, libraryId) {
    const special = libraryId && INVITE_BY_LIBRARY[libraryId];
    if (kind === 'compete') return ['אני בחרתי 3 אתגרים ל-14 יום. בואי תבחרי גם. נראה מי מתמידה יותר.', '14 ימים, 3 אתגרים, אחת מאיתנו מנצחת. באה?', 'אני בטוחה שאני מתמידה יותר ממך. תוכיחי שלא.'];
    if (kind === 'same') return [...(special || []), ...(w ? [`14 ימים של ${w}. אני בפנים. את באה?`, `${w}. שתינו יודעות שאנחנו צריכות את זה.`, `${w} ל-14 יום. בואי נראה מי מחזיקה יותר.`] : ['אותו אתגר, 14 יום, שתינו. באה?'])];
    return [...(special || []), ...(w ? [`החלטתי: ${w}, 14 יום. נראה לך שאצליח?`, `שוב נשבעתי: ${w}. תראי אם הפעם זה מחזיק.`, `14 ימים של ${w}. את מוזמנת לפקח על הנס.`] : ['החלטתי על 3 אתגרים ל-14 יום. נראה לך שאצליח?', '14 ימים. 3 אתגרים. את מוזמנת לפקח על הנס.', 'הפעם אני רצינית. כנראה. בואי תראי.'])];
  }
  /* ============================================================
     הזמנת חברה — 3 צעדים: מה היא תעשה → ההודעה → נשלח (קישור וקוד תמיד גלויים)
     ============================================================ */
  const KIND_PLAIN = {
    follow: { emoji: '👀', title: 'שתראה אותי עומדת במילה שלי', what: 'היא מצטרפת לקבוצה ורואה כל יום אם עמדת במילה שלך.', step3: 'רואה את ההתקדמות שלך' },
    compete: { emoji: '🏁', title: 'שנתחרה', what: 'היא בוחרת עד 3 אתגרים משלה, ושתיכן נכנסות לדירוג.', step3: 'בוחרת עד 3 אתגרים משלה ונכנסת לדירוג' },
    same: { emoji: '🤝', title: 'שנעשה את אותו אתגר', what: 'היא לוקחת אתגר שלך ל-14 יום, ומתחרות עליו.', step3: 'מתחילה את אותו אתגר ל-14 יום' },
  };
  function inviteFlow(opts = {}) {
    const circles = Mila.myCircles();
    let wordTitle = opts.wordTitle || '', libraryId = opts.libraryId || null, circleId = opts.circleId || null, commitmentId = opts.commitmentId || null;
    if (commitmentId) { const k = Mila.commitment(commitmentId); const d = k && Mila.wordDef(k.defId); if (d) { wordTitle = d.title; libraryId = d.libraryId || null; circleId = circleId || d.circleId || null; } }
    if (!circleId && circles.length === 1) circleId = circles[0].id;
    inv = { step: 1, kind: opts.kind || null, circleId, commitmentId, wordTitle, libraryId, newCircle: `${Mila.me().name} והחברות`, message: null, idx: 0, token: null, busy: false };
    go('inviteNew');
  }
  /* תאימות לקריאות ישנות */
  function inviteSheet(circleId, opts = {}) { inviteFlow({ ...opts, circleId }); }
  function inviteFromWord(commitmentId, kind) { inviteFlow({ commitmentId, kind }); }
  function myActiveWords() { return Mila.activeCommitments().map(k => ({ k, d: Mila.wordDef(k.defId) })).filter(x => x.d); }
  SCREENS.inviteNew = () => {
    if (!inv) { inviteFlow(); return ''; }
    const circles = Mila.myCircles();
    const dots = `<div class="steps">${[1, 2, 3].map(i => `<i class="${i <= inv.step ? 'on' : ''}"></i>`).join('')}</div>`;
    const head = topbar({ title: 'הזמנת חברה', end: `<button class="icon-btn" aria-label="סגירה" onclick="App.inviteClose()">${icon('x', 22)}</button>` });
    const circleName = inv.circleId ? (Mila.getState().circles[inv.circleId] || {}).name : inv.newCircle;
    if (inv.step === 1) {
      const words = myActiveWords();
      const needWord = inv.kind === 'same' && !inv.wordTitle;
      const ready = inv.kind && !(inv.kind === 'same' && !inv.wordTitle) && (inv.circleId || (inv.newCircle || '').trim());
      return `${head}${dots}
        <div class="step-title">מה את רוצה שהיא תעשה?</div><div class="step-sub">בוחרת, ואז כותבת לה הודעה אישית.</div>
        ${Object.entries(KIND_PLAIN).map(([k, v]) => `<div class="choice inv-kind ${inv.kind === k ? 'on' : ''}" onclick="App.invSet('kind','${k}')"><span class="radio">${inv.kind === k ? icon('check', 14) : ''}</span><div class="body"><div class="t">${v.emoji} ${v.title}</div><div class="m">${v.what}</div></div></div>`).join('')}
        ${inv.kind === 'same' ? `<div class="field mt"><label>איזה אתגר?</label>${words.length ? `<div class="chips">${words.map(({ d }) => `<button class="chip select ${inv.wordTitle === d.title ? 'on' : ''}" onclick="App.invWord('${d.id}')">${icon(d.icon, 15)} ${esc(d.title)}</button>`).join('')}</div>` : `<div class="note">${icon('info', 18)}<span>עוד אין לך אתגר פעיל. בחרי אתגר קודם, או הזמיני אותה לתחרות.</span></div>`}</div>` : ''}
        <div class="field mt"><label>לאיזו קבוצה היא מצטרפת?</label>
          ${circles.length ? `<div class="chips">${circles.map(c => `<button class="chip select ${inv.circleId === c.id ? 'on' : ''}" onclick="App.invSet('circleId','${c.id}')">${esc(c.name)}</button>`).join('')}<button class="chip select ${!inv.circleId ? 'on' : ''}" onclick="App.invSet('circleId', null)">${icon('plus', 14)} קבוצה חדשה</button></div>` : ''}
          ${!inv.circleId ? `<input class="input ${circles.length ? 'mt' : ''}" maxlength="50" placeholder="שם לקבוצה שלכן" value="${esc(inv.newCircle)}" oninput="App.invNewCircle(this.value)"><div class="hint">נפתח קבוצה חדשה. את המנהלת.</div>` : ''}
        </div>
        <div class="mt-lg"><button class="btn primary" id="inv-next" ${ready ? '' : 'disabled'} onclick="App.invNext()">המשך</button></div>
        ${needWord && !words.length ? '' : ''}`;
    }
    if (inv.step === 2) {
      const msgs = inviteMessages(inv.kind, inv.wordTitle, inv.libraryId);
      if (inv.message === null) inv.message = msgs[0];
      const v = KIND_PLAIN[inv.kind];
      return `${head}${dots}
        <div class="step-title">ההודעה שלך</div><div class="step-sub">אפשר לערוך. הקישור מצטרף אוטומטית.</div>
        <div class="wa-bubble"><textarea id="inv-msg" maxlength="200" rows="3" oninput="App.inviteMsg(this.value)">${esc(inv.message)}</textarea><div class="wa-link">🔗 mila.mila-app.workers.dev/?invite=…</div></div>
        <button class="btn text xs" onclick="App.inviteRotate()">${icon('repeat', 14)} נוסח אחר</button>
        <div class="card tight mt"><div class="card-title">מה קורה כשהיא לוחצת</div>
          <ol class="inv-steps"><li>נכנסת עם Google. לוקח 10 שניות.</li><li>מצטרפת לקבוצה <b>${esc(circleName)}</b>.</li><li>${v.step3}${inv.kind === 'same' ? `: <b>${esc(inv.wordTitle)}</b>` : ''}.</li></ol>
        </div>
        <button class="btn primary mt" ${inv.busy ? 'disabled' : ''} onclick="App.inviteSend('whatsapp')">${inv.busy ? 'רגע…' : '💬 שליחה בוואטסאפ'}</button>
        <div class="btn-row mt"><button class="btn soft" ${inv.busy ? 'disabled' : ''} onclick="App.inviteSend('share')">${icon('share', 18)} שיתוף אחר</button><button class="btn soft" ${inv.busy ? 'disabled' : ''} onclick="App.inviteSend('copy')">${icon('copy', 18)} העתקה</button></div>
        <button class="btn text mt" onclick="App.invBack()">חזרה</button>`;
    }
    const url = Mila.inviteUrl(inv.token);
    return `${head}${dots}
      <div class="sheet-hero"><div class="inv-done">🎉</div><div class="sheet-title">ההזמנה יצאה</div><div class="sheet-sub">כשהיא מצטרפת תקבלי עדכון, והיא תופיע ב${esc(circleName)}.</div></div>
      <div class="card tight"><div class="card-title">לא נשלח? הנה הקישור</div>
        <div class="inv-link ltr">${esc(url)}</div>
        <div class="btn-row mt"><button class="btn soft sm" onclick="App.copyText('${esc(url)}')">${icon('copy', 16)} העתקת הקישור</button><button class="btn soft sm" onclick="App.copyText('${inv.token}')">${icon('copy', 16)} הקוד: <span class="ltr" style="letter-spacing:.12em">${inv.token}</span></button></div>
        <div class="tiny muted mt">אפשר גם להקריא לה את הקוד. היא מכניסה אותו ב״מצטרפת לקבוצה של חברה״. בתוקף 7 ימים.</div>
      </div>
      <button class="btn primary mt" onclick="App.inviteFlow({ circleId: '${inv.circleId}' })">${icon('plus', 18)} להזמין עוד חברה</button>
      <button class="btn text mt" onclick="App.inviteDone()">לקבוצה</button>`;
  };
  function invSet(k, v) { inv[k] = v; if (k === 'kind') { inv.message = null; if (v !== 'same' && !inv.commitmentId) { inv.wordTitle = ''; inv.libraryId = null; } } render(); }
  function invWord(defId) { const d = Mila.wordDef(defId); inv.wordTitle = d.title; inv.libraryId = d.libraryId || null; inv.message = null; render(); }
  function invNewCircle(v) { inv.newCircle = v; const b = $('#inv-next'); if (b) b.disabled = !(inv.kind && !(inv.kind === 'same' && !inv.wordTitle) && v.trim()); }
  function invNext() { inv.step = 2; render(); window.scrollTo({ top: 0 }); }
  function invBack() { inv.step = 1; render(); }
  function inviteClose() { const cid = inv && inv.circleId; inv = null; back(cid ? 'circles' : 'today'); }
  function inviteDone() { const cid = inv.circleId; inv = null; stack = [{ name: 'circles', params: {} }]; go('circle', { id: cid }); }
  function inviteRotate() { const msgs = inviteMessages(inv.kind, inv.wordTitle, inv.libraryId); inv.idx = (inv.idx + 1) % msgs.length; inv.message = msgs[inv.idx]; const t = $('#inv-msg'); if (t) t.value = inv.message; }
  function inviteMsg(v) { inv.message = v; }
  async function inviteSend(how) {
    if (inv.busy) return;
    inv.busy = true; render();
    try {
      if (!inv.circleId) { const { circle } = await Store().createCircle({ name: inv.newCircle.trim() || 'הקבוצה שלנו', color: 'pink' }); inv.circleId = circle.id; }
      const r = await Store().createInvite(inv.circleId, { kind: inv.kind, message: inv.message, libraryId: inv.libraryId, wordTitle: inv.wordTitle });
      inv.token = r.token;
      const text = `${(inv.message || '').trim()}\n${Mila.inviteUrl(r.token)}`;
      inv.busy = false; inv.step = 3; render(); window.scrollTo({ top: 0 });
      if (how === 'whatsapp') { window.location.href = `https://wa.me/?text=${encodeURIComponent(text)}`; return; }
      if (how === 'share' && navigator.share) { try { await navigator.share({ text }); } catch (e) { /* בוטל */ } return; }
      await copyText(text);
    } catch (e) { inv.busy = false; render(); fail(e); }
  }
  async function rotateInvite(circleId) { try { await Store().revokeCircleInvites(circleId); toast('קוד חדש. הקודים הישנים בוטלו.'); render(); } catch (e) { fail(e); } }
  async function shareInvite(url) {
    const text = `באה איתי? יש לי מילה איתך: ${url}`;
    if (navigator.share) { try { await navigator.share({ text }); } catch (e) { /* בוטל */ } }
    else copyText(text);
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); toast('הועתק.'); return true; } catch (e) { /* נופלות לשיטה הישנה */ }
    try { const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); if (ok) { toast('הועתק.'); return true; } } catch (e) { /* */ }
    toast('לא הצלחנו להעתיק. אפשר לסמן ולהעתיק ידנית.'); return false;
  }

  /* ---------- S20 — ניהול קבוצה ---------- */
  SCREENS.circleManage = ({ id }) => {
    const c = Mila.getState().circles[id];
    if (!c || !Mila.isAdmin(id)) return `${topbar({ title: 'ניהול' })}<div class="empty"><div class="t">רק מנהלת</div></div>`;
    const members = Mila.circleMembers(id); const meId = Mila.me().id;
    const iv = Object.values(Mila.getState().invites).filter(i => i.circleId === id && i.status === 'active').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return `${topbar({ title: 'ניהול הקבוצה', subtitle: c.name })}
      <div class="section-title" style="margin-top:4px">פרטים</div>
      <div class="card tight">
        <div class="field"><label>שם</label><input class="input" value="${esc(c.name)}" maxlength="50" onchange="App.cmSet('${id}','name',this.value)"></div>
        <div class="field"><label>תיאור</label><input class="input" value="${esc(c.description)}" maxlength="120" placeholder="על מה אנחנו?" onchange="App.cmSet('${id}','description',this.value)"></div>
        <div class="field" style="margin-bottom:4px"><label>צבע</label><div class="chips">${Mila.AVATAR_COLORS.map(col => `<button class="chip select ${c.color === col ? 'on' : ''}" aria-label="${col}" onclick="App.cmSet('${id}','color','${col}')"><span class="tile sm ${COLOR_TO_TILE[col]}" style="width:18px;height:18px"></span></button>`).join('')}</div></div>
      </div>
      <div class="section-title">חברות <small>${members.length} מתוך ${c.maxMembers}</small></div>
      <div class="card tight">${members.map(u => `<div class="list-row ${u.id !== meId ? 'clickable' : ''}" ${u.id !== meId ? `onclick="App.memberSheet('${id}','${u.id}')"` : ''}>${avatar(u, 36)}<div class="body"><div class="t">${esc(u.name)}${u.id === meId ? ' (את)' : ''}${u.role === 'admin' ? ' <span class="chip lime">מנהלת</span>' : ''}</div></div>${u.id !== meId ? icon('chev', 18) : ''}</div>`).join('')}
        <button class="btn ghost sm mt" onclick="App.inviteFlow({ circleId: '${id}' })">${icon('plus', 16)} להזמין חברה</button></div>
      <div class="section-title">חוקים</div>
      <div class="card tight">
        <div class="field"><label>מי פותחת אתגר משותף?</label><div class="seg"><button class="${c.whoCanPropose === 'all' ? 'on' : ''}" onclick="App.cmSet('${id}','whoCanPropose','all')">כל אחת</button><button class="${c.whoCanPropose === 'admins' ? 'on' : ''}" onclick="App.cmSet('${id}','whoCanPropose','admins')">רק מנהלות</button></div><div class="hint">כל חברה בוחרת אם להצטרף.</div></div>
        <div class="field" style="margin-bottom:4px"><label>כמה חברות לכל היותר?</label><div class="chips">${[4, 6, 8, 12, 20].map(n => `<button class="chip select ${c.maxMembers === n ? 'on' : ''}" ${n < members.length ? 'disabled' : ''} onclick="App.cmSet('${id}','maxMembers',${n})">${n}</button>`).join('')}</div></div>
      </div>
      <div class="section-title">קוד הזמנה</div>
      <div class="card tight">${iv ? `<div class="kv"><span class="k">קוד</span><span class="v ltr" style="letter-spacing:.15em">${iv.token || (iv.hint + '····')}</span></div><div class="kv"><span class="k">בתוקף עד</span><span class="v">${Mila.fmtDate(Mila.toLocalDate(new Date(iv.expiresAt)))}</span></div><div class="kv"><span class="k">הצטרפו דרכו</span><span class="v">${iv.uses}</span></div>` : '<div class="small muted">אין קוד פעיל.</div>'}
        <button class="btn soft sm mt" onclick="App.rotateInvite('${id}')">קוד חדש (הישנים מתבטלים)</button></div>
      <div class="section-title">סגירת הקבוצה</div>
      <div class="card tight danger-zone"><div class="small muted mb">האתגרים בקבוצה ייעצרו אצל כולן, וכולן ייצאו ממנה. הנקודות וההיסטוריה של כל אחת נשארות.</div>
        <button class="btn danger" onclick="App.deleteCircle('${id}')">${icon('trash', 18)} לסגור את הקבוצה</button></div>`;
  };
  function deleteCircle(id) {
    const c = Mila.getState().circles[id];
    const n = Mila.circleMembers(id).length - 1;
    confirmSheet({ title: `לסגור את ${c.name}?`, sub: `${n > 0 ? `${n === 1 ? 'חברה אחת יוצאת מהקבוצה ומקבלת' : `${n} חברות יוצאות מהקבוצה ומקבלות`} הודעה. ` : ''}האתגרים בקבוצה נעצרים. אי אפשר לבטל.`, okText: 'לסגור את הקבוצה', okClass: 'danger', onOk: async () => { await Store().deleteCircle(id); closeSheet(true); stack = []; go('circles', {}, { reset: true }); toast('הקבוצה נסגרה.'); } });
  }
  async function cmSet(id, k, v) { try { await Store().updateCircle(id, { [k]: v }); render(); } catch (e) { fail(e); } }

  /* ============================================================
     S11 — קבלת הזמנה
     ============================================================ */
  SCREENS.invite = ({ token }) => {
    const p = Store().cachedPreview(token) || { ok: false, reason: 'not_found' };
    if (!p.ok) return `${topbar({ title: 'הזמנה' })}<div class="card empty"><span class="tile lg gray">${icon('hourglass', 28)}</span><div class="t">${p.reason === 'expired' ? 'הקוד פג' : p.reason === 'revoked' ? 'הקוד בוטל' : 'הקוד לא נמצא'}</div><div class="m">בקשי מהחברה קוד חדש.</div><button class="btn soft" onclick="App.back('circles')">חזרה</button></div>`;
    const kind = INVITE_KINDS[p.kind] ? p.kind : 'follow';
    const v = INVITE_KINDS[kind];
    const msg = p.message || inviteMessages(kind, p.wordTitle || (p.challenge && p.challenge.title) || '', p.libraryId)[0];
    const what = kind === 'follow' ? 'את רואה. בלי התחייבות.' : kind === 'compete' ? 'את בוחרת 3 אתגרים משלך. הדירוג משותף.' : `אותו אתגר: ${esc(p.wordTitle || (p.challenge && p.challenge.title) || '')}`;
    return `${topbar({ title: 'הזמנה' })}
      <div class="sheet-hero">${avatar(p.inviter, 72)}<div class="sheet-title" style="margin-top:10px">${v.title}</div><div class="sheet-sub">${esc(p.inviter.name)} · ${esc(p.circle.name)}</div></div>
      <div class="quote">${esc(msg)}</div>
      <div class="card tight"><div class="card-title">מה קורה כשלוחצים ״אני בפנים״</div>
        <ol class="inv-steps"><li>מצטרפת לקבוצה <b>${esc(p.circle.name)}</b> של ${esc(p.inviter.name)}.</li><li>${kind === 'follow' ? `רואה כל יום אם ${esc(p.inviter.name)} עומדת במילה שלה.` : kind === 'compete' ? 'בוחרת עד 3 אתגרים משלך ל-14 יום.' : `מתחילה את האתגר <b>${esc(p.wordTitle || (p.challenge && p.challenge.title) || '')}</b> ל-14 יום.`}</li>${kind === 'follow' ? '' : '<li>נכנסת לדירוג ״מי מובילה?״.</li>'}</ol>
      </div>
      <div class="card tight">
        <div class="kv"><span class="k">${icon('users', 18)} חברות</span><span class="v">${p.memberCount} מתוך ${p.maxMembers}</span></div>
        <div class="kv"><span class="k">${icon('calendar', 18)} הסבב</span><span class="v">${p.round.dayIndex > 0 ? `יום ${p.round.dayIndex} מתוך 14` : `מתחיל ${Mila.fmtDate(p.round.start)}`}</span></div>
      </div>
      ${p.alreadyMember ? `<button class="btn primary mt" onclick="App.go('circle',{id:'${p.circle.id}'})">את כבר בפנים</button>` : `<button class="btn primary mt" onclick="App.acceptInvite('${token}')">${kind === 'follow' ? 'אני בפנים' : kind === 'compete' ? 'אני בפנים. בוחרת אתגרים' : 'אני בפנים'}</button>`}
      <div class="btn-row mt"><button class="btn text" onclick="App.declineInvite('${token}')">הפעם לא</button><button class="btn text" onclick="App.safetySheet('${p.inviter.id}', null, '${token}')">${icon('flag', 16)} דיווח</button></div>`;
  };
  async function acceptInvite(token) {
    try {
      const p = Store().cachedPreview(token) || {};
      const c = await Store().acceptInvite(token);
      const S = Mila.getState(); if (S.pendingInvite && S.pendingInvite.token === token) { delete S.pendingInvite; Mila.save(); }
      stack = [{ name: 'circles', params: {} }, { name: 'circle', params: { id: c.id } }];
      if (p.kind === 'compete') { render(); openPick([], { circleId: c.id }); toast('את בפנים. עכשיו האתגרים שלך.', 'lime'); return; }
      if (p.kind === 'same') {
        if (p.libraryId) { render(); openPick([p.libraryId], { circleId: c.id }); }
        else { render(); openWordWizard({ title: p.wordTitle || '', circleId: c.id }); }
        toast('את בפנים.', 'lime'); return;
      }
      go('circle', { id: c.id }); toast('את בפנים.', 'lime');
    } catch (e) { fail(e); }
  }
  function declineInvite(token) { const S = Mila.getState(); if (S.pendingInvite && S.pendingInvite.token === token) { delete S.pendingInvite; Mila.save(); } back('circles'); }

  /* ============================================================
     S12 — הצעת מילה קבוצתית
     ============================================================ */
  function openGroupWizard(circleId) { ideasOpen = true; ideasCat = 0; const r = Mila.circleRound(circleId); gwiz = { circleId, title: '', rule: '', icon: 'leaf', startDate: r.dayIndex <= 2 ? r.start : Mila.today(), visibility: 'status' }; go('groupWordNew'); }
  SCREENS.groupWordNew = () => {
    const c = Mila.getState().circles[gwiz.circleId];
    const r = Mila.circleRound(gwiz.circleId);
    const opts = [[Mila.today(), 'מהיום', 'מי שמצטרפת אחר כך מתחילה מהיום שלה'], [r.nextStart, 'בסבב הבא', `${Mila.fmtDate(r.nextStart)}, כולן ביחד`]];
    return `${topbar({ title: 'אתגר משותף', subtitle: c.name })}
      <div class="step-title">איזה אתגר עושות ביחד?</div><div class="step-sub">כל אחת נמדדת לבד. מתחרות על התמדה.</div>
      ${templateChips('gwTemplate', gwiz.title)}
      <div class="field"><label>שם האתגר</label><input class="input" placeholder="למשל: 8,000 צעדים ביום" maxlength="60" value="${esc(gwiz.title)}" oninput="App.gwSet('title', this.value)"></div>
      <div class="field"><label>מה נחשב הצלחה?</label><textarea class="input" maxlength="200" placeholder="כלל שכולן יכולות למדוד" oninput="App.gwSet('rule', this.value)">${esc(gwiz.rule)}</textarea></div>
      <div class="field"><label>אייקון</label><div class="icon-picker">${Mila.WORD_ICONS.map(ic => `<span class="tile ${tileColorFor(gwiz.title || ic)} ${gwiz.icon === ic ? 'on' : ''}" onclick="App.gwSet('icon','${ic}'); App.refresh()">${icon(ic, 24)}</span>`).join('')}</div></div>
      <div class="field"><label>מתי מתחילה?</label>${opts.map(([d, l, m]) => `<div class="choice ${gwiz.startDate === d ? 'on' : ''}" onclick="App.gwSet('startDate','${d}'); App.refresh()"><span class="radio">${gwiz.startDate === d ? icon('check', 14) : ''}</span><div class="body"><div class="t">${l}</div><div class="m">${m}</div></div></div>`).join('')}</div>
      <div class="field"><label>מה החברות רואות</label><div class="seg"><button class="${gwiz.visibility === 'status' ? 'on' : ''}" onclick="App.gwSet('visibility','status'); App.refresh()">כל יום</button><button class="${gwiz.visibility === 'summary' ? 'on' : ''}" onclick="App.gwSet('visibility','summary'); App.refresh()">רק בסוף</button></div></div>
      <div class="mt-lg"><button class="btn primary" onclick="App.gwPropose()">פותחת ומזמינה</button></div>
      <div class="tiny muted center mt">כל חברה בוחרת אם להצטרף. גם את.</div>`;
  };
  function gwSet(k, v) { gwiz[k] = v; }
  function gwTemplate(i) { const t = Mila.TEMPLATES[i]; gwiz.title = t.title; gwiz.rule = t.rule; gwiz.icon = t.icon; ideasOpen = false; render(); }
  async function gwPropose() {
    try { const def = await Store().proposeGroupWord(gwiz.circleId, gwiz); const cid = gwiz.circleId; gwiz = null; stack = [{ name: 'circles', params: {} }, { name: 'circle', params: { id: cid } }]; go('groupWord', { id: def.id, fresh: true }); } catch (e) { fail(e); }
  }

  /* ============================================================
     S13 — אימוץ מילה קבוצתית
     ============================================================ */
  SCREENS.groupWord = ({ id, fresh }) => {
    const def = Mila.wordDef(id);
    if (!def || !Mila.isMember(def.circleId)) return `${topbar({ title: 'אתגר' })}<div class="empty"><div class="t">האתגר הזה לא בקבוצות שלך</div></div>`;
    const circle = Mila.getState().circles[def.circleId];
    const ad = Mila.adopters(id);
    const mine = Mila.myAdoption(id);
    const start = def.startDate < Mila.today() ? Mila.today() : def.startDate;
    const over = (def.endDate || '9999') < Mila.today();
    const cap = mine || over ? { ok: true } : Mila.capCheck(Mila.me().id, start);
    const owner = Mila.user(def.ownerId);
    const canCancel = !ad.length && (def.ownerId === Mila.me().id || Mila.isAdmin(def.circleId)) && def.status === 'proposed';
    return `${topbar({ title: 'אתגר משותף', subtitle: circle.name })}
      <div class="sheet-hero">${wordTile(def, 'lg')}<div class="sheet-title">${esc(def.title)}</div><div class="sheet-sub" style="margin-bottom:8px">${esc(def.rule)}</div><div class="chips" style="justify-content:center"><span class="chip">${avatar(owner, 16)} ${esc(owner.name)} פתחה</span><span class="chip lav">${ad.length} בפנים</span>${mine ? '<span class="chip lime">את בפנים</span>' : ''}</div></div>
      ${fresh ? `<div class="note lime">${icon('sparkle', 18)}<span>החברות קיבלו הודעה.</span></div>` : ''}
      <div class="card tight">
        <div class="kv"><span class="k">${icon('calendar', 18)} הסבב</span><span class="v">${Mila.fmtDate(def.startDate)} – ${Mila.fmtDate(def.endDate)}</span></div>
        <div class="kv"><span class="k">${icon('star', 18)} נקודות</span><span class="v">נקודה לכל יום שעמדת בו</span></div>
        <div class="kv"><span class="k">${icon('flame', 18)} פספוס</span><span class="v">הרצף מתאפס</span></div>
        <div class="kv"><span class="k">${icon('eye', 18)} רואות</span><span class="v">${def.visibility === 'summary' ? 'רק בסוף' : 'כל יום'}</span></div>
      </div>
      ${ad.length ? `<div class="card tight"><div class="card-title">מי בפנים</div>${ad.map(u => { const st = Mila.commitmentStats(u.commitmentId); return `<div class="list-row">${avatar(u, 36)}<div class="body"><div class="t">${esc(u.name)}${u.id === Mila.me().id ? ' (את)' : ''}</div><div class="m">${st.resolved ? `${st.success} הצלחות${st.current ? ` · ${st.current} ברצף` : ''}` : 'עוד לא התחילה'}</div></div></div>`; }).join('')}</div>` : ''}
      ${mine ? `<button class="btn ghost" onclick="App.go('word',{id:'${mine.id}'})">האתגר שלי כאן</button>` :
        over ? `<div class="note">${icon('info', 18)}<span>נגמרה. אפשר להתחיל אותו שוב בסבב הבא.</span></div>` :
        !cap.ok ? `<div class="note warn">${icon('info', 18)}<span>כבר יש לך 3 אתגרים בימים האלה (${cap.conflictingWords.map(w => esc(w.title)).join(', ')}).${cap.nextFree && cap.nextFree <= def.endDate ? ` פנוי מ-${Mila.fmtDate(cap.nextFree)}.` : ''}</span></div><button class="btn soft" disabled>אני בפנים · אין מקום</button>` :
        `<button class="btn primary" onclick="App.adoptSheet('${id}')">אני בפנים</button>`}
      ${canCancel ? `<button class="btn text mt" onclick="App.cancelProposal('${id}')">לבטל</button>` : ''}`;
  };
  function adoptSheet(id) {
    const def = Mila.wordDef(id); const start = def.startDate < Mila.today() ? Mila.today() : def.startDate;
    const end = def.endDate; const days = Mila.diffDays(start, end) + 1;
    sheet(`<div class="sheet-hero">${wordTile(def, 'lg')}<div class="sheet-title">מצטרפת לאתגר?</div><div class="sheet-sub">${esc(def.title)} · ${days} ימים מ-${Mila.relDay(start)}</div></div>
      <div class="kv"><span class="k">${icon('star', 18)} נקודות</span><span class="v">עד ${days}</span></div>
      <div class="kv"><span class="k">${icon('eye', 18)} רואות</span><span class="v">${def.visibility === 'summary' ? 'רק בסוף' : 'כל יום'}</span></div>
      <div class="btn-row mt"><button class="btn soft" onclick="App.closeSheet()">הפעם לא</button><button class="btn primary" onclick="App.adopt('${id}')">אני בפנים</button></div>`);
  }
  async function adopt(id) {
    try { const k = await Store().adoptGroupWord(id); closeSheet(true); go('word', { id: k.id, fresh: true }, { replace: true }); stamp('תפסתי אותך במילה.'); } catch (e) { fail(e); if (e.code === 'CAP') render(); }
  }
  function cancelProposal(id) { confirmSheet({ title: 'לבטל?', sub: 'עוד אף אחת לא בפנים.', okText: 'לבטל', okClass: 'pink', onOk: async () => { await Store().cancelProposal(id); closeSheet(true); back(); toast('בוטל.'); } }); }

  /* ============================================================
     S14 — הנקודות שלי
     ============================================================ */
  SCREENS.bank = () => {
    const b = Mila.bankSummary();
    const S = Mila.getState();
    const circles = Object.keys(b.byCircle).filter(k => k !== 'personal').map(k => S.circles[k]).filter(Boolean);
    const txs = b.transactions.filter(t => bankFilter === 'all' || (bankFilter === 'earn' ? t.type === 'EARN' : t.type !== 'EARN'));
    return `${topbar({ title: 'הנקודות שלי' })}
      <div class="card balance-card pastel-lime"><div class="label">נקודות בסך הכול</div><div class="amount">${icon('star', 40)}<span class="num">${b.earnedTotal}</span><span class="cur">נק׳</span></div><div class="note" style="display:inline-flex;margin:6px 0 0;padding:6px 12px">נקודה על כל יום שעמדת בו.</div></div>
      <div class="stat-grid mb"><div class="stat lime"><div class="n">${b.earnedCurrentRound}</div><div class="l">בסבב הזה</div></div><div class="stat pink"><div class="n">${b.missedCurrentRound}</div><div class="l">פספוסים</div></div><div class="stat lav"><div class="n">${b.pendingSlots}</div><div class="l">עוד אפשר לצבור</div></div></div>
      ${circles.length || b.byCircle.personal ? `<div class="card tight"><div class="card-title">לפי קבוצה</div>${circles.map(c => `<div class="kv"><span class="k">${circleTile(c, 'sm')} ${esc(c.name)}</span><span class="v"><span class="chip lime">${b.byCircle[c.id].earned} נק׳</span> <span class="chip pink">${b.byCircle[c.id].missed} פספוסים</span></span></div>`).join('')}${b.byCircle.personal ? `<div class="kv"><span class="k"><span class="tile sm gray">${icon('lock', 18)}</span> רק אני</span><span class="v"><span class="chip lime">הרווחת ${b.byCircle.personal.earned}</span> <span class="chip pink">פספסתי ${b.byCircle.personal.missed}</span></span></div>` : ''}</div>` : ''}
      <div class="section-title">יום אחרי יום</div>
      <div class="seg mb"><button class="${bankFilter === 'all' ? 'on' : ''}" onclick="App.bankFilter('all')">הכול</button><button class="${bankFilter === 'earn' ? 'on' : ''}" onclick="App.bankFilter('earn')">נקודות</button><button class="${bankFilter === 'miss' ? 'on' : ''}" onclick="App.bankFilter('miss')">פספוסים</button></div>
      ${txs.length ? `<div class="card tight">${txs.slice(0, 60).map(t => {
        const plus = t.type === 'EARN'; const rev = t.type === 'REVERSE';
        return `<div class="tx ${t.reversed ? 'reversed' : ''}"><span class="amt ${rev ? 'zero' : plus ? 'plus' : 'minus'}">${rev ? '↺' : plus ? '+1' : '0'}</span><div class="body"><div class="t">${esc(t.title || 'מילה')}</div><div class="m">${rev ? 'תיקון' : plus ? 'אמרת ועשית' : t.type === 'MISS_TO_CIRCLE' ? `פספוס · ${esc(t.circleName || 'הקבוצה')}` : 'פספוס'} · ${Mila.relDay(t.localDate)}${t.reversed ? ' · בוטל' : ''}</div></div>${wordTile({ title: t.title, icon: t.icon }, 'sm')}</div>`;
      }).join('')}</div>` : `<div class="empty"><div class="t">עוד כלום</div><div class="m">כל יום שתדווחי יופיע כאן.</div></div>`}`;
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
      <div class="sheet-hero" style="margin-top:0">${avatar(u, 84)}<div class="sheet-title" style="margin-top:10px">${esc(u.name)}</div><div class="sheet-sub">${completed ? `${hebrewPlural(completed, 'סבב אחד', 'סבבים')} · ` : ''}${hebrewPlural(active.length, 'אתגר אחד עכשיו', 'אתגרים עכשיו')}</div></div>
      <div class="card tight clickable pastel-lime" onclick="App.go('bank')"><div style="display:flex;align-items:center;gap:12px"><span class="tile lime">${icon('star')}</span><div style="flex:1"><div class="bold">${b.earnedTotal} נקודות</div><div class="small muted">הנקודות שלי</div></div>${icon('chev', 20)}</div></div>
      <div class="stat-grid mb"><div class="stat lime"><div class="n">${b.earnedTotal}</div><div class="l">נקודות</div></div><div class="stat pink"><div class="n">${b.missedTotal}</div><div class="l">פספסת</div></div><div class="stat lav"><div class="n">${ach.filter(a => a.earned).length}</div><div class="l">הישגים</div></div></div>
      <div class="section-title">הישגים <small>${ach.filter(a => a.earned).length}/${ach.length}</small></div>
      <div class="ach-grid">${ach.map(a => `<div class="ach ${a.earned ? '' : 'locked'}"><span class="tile sm ${a.earned ? 'lime' : 'gray'}">${icon(a.icon, 20)}</span><div><div class="t">${esc(a.title)}</div><div class="m">${esc(a.desc)}</div></div></div>`).join('')}</div>
      ${active.length ? `<div class="section-title">האתגרים שלי</div>${active.map(c => { const d = Mila.wordDef(c.defId); const st = Mila.commitmentStats(c.id); return `<div class="word-row" onclick="App.go('word',{id:'${c.id}'})">${wordTile(d, 'sm')}<div class="body"><div class="name">${esc(d.title)}</div><div class="meta">יום ${Math.max(st.dayIndex, 1)}/14 · ${st.success} הצלחות${st.current ? ` · ${st.current} ברצף` : ''}</div></div>${icon('chev', 18)}</div>`; }).join('')}` : ''}
      ${hist.length ? `<div class="section-title">אתגרים שהסתיימו</div>${hist.map(h => `<div class="word-row" onclick="App.go('summary',{id:'${h.id}'})">${wordTile(h.def, 'sm')}<div class="body"><div class="name">${esc(h.def.title)}</div><div class="meta">${Mila.fmtDate(h.startDate)} – ${Mila.fmtDate(h.endDate)} · ${h.stats.rate !== null ? pct(h.stats.rate) : ''}${h.status === 'ended_early' ? ' · נעצר' : ''}</div></div>${icon('chev', 18)}</div>`).join('')}` : ''}
`;
  };

  /* ============================================================
     S17 — התראות
     ============================================================ */
  SCREENS.notifications = () => {
    const list = Mila.notifications();
    if (Mila.unreadCount()) setTimeout(() => Store().markAllRead().catch(() => {}), 400);
    const ic = { invite: ['users', 'pink'], encouragement: ['clap', 'lime'], group_word: ['pencil', 'lav'], achievement: ['medal', 'peach'], reminder: ['bell', 'sky'], overtake: ['trophy', 'lime'] };
    return `${topbar({ title: 'עדכונים' })}
      ${list.length ? `<div class="card tight">${list.map(n => { const [i, c] = ic[n.type] || ['bell', 'gray']; const act = n.ref && n.ref.token ? `App.openInvite('${n.ref.token}')` : n.ref && n.ref.defId ? `App.go('groupWord',{id:'${n.ref.defId}'})` : n.ref && n.ref.circleId ? `App.go('circle',{id:'${n.ref.circleId}'})` : n.ref && n.ref.type ? `App.tab('me')` : ''; return `<div class="list-row ${act ? 'clickable' : ''}" ${act ? `onclick="${act}"` : ''}><span class="tile sm ${c}">${icon(i, 18)}</span><div class="body"><div class="t" style="${n.read ? 'font-weight:600' : ''}">${esc(n.title)}</div><div class="m">${esc(n.body || '')}${n.body ? ' · ' : ''}${timeAgo(n.createdAt)}</div></div>${act ? icon('chev', 18) : ''}</div>`; }).join('')}</div>` : `<div class="empty"><span class="tile lg sky">${icon('bell', 28)}</span><div class="t">שקט כאן</div><div class="m">כאן יופיעו הזמנות, מילים טובות והישגים.</div></div>`}`;
  };

  /* ============================================================
     מילה על המסך הראשי + התראות (install.js מזהה את המכשיר)
     ============================================================ */
  let instOs = null;
  const I = () => window.MilaInstall;
  function installSheet({ os = null, intro = '' } = {}) {
    if (!I()) return;
    instOs = os; const d = I().detect(); const g = I().guide(d, os);
    if (!os) Api.track('install_sheet');
    const seg = g.kind === 'installed' ? '' : `<div class="inst-dev"><span>${os && os !== d.os ? 'הוראות ל:' : `זיהינו: ${esc(I().platformName(d))}${d.inapp ? ` · בתוך ${esc(d.inapp)}` : d.os !== 'desktop' || d.browser !== 'other' ? ` · ${esc(I().browserName[d.browser] || '')}` : ''}`}</span>
      <div class="inst-seg" role="tablist">${[['ios', 'אייפון'], ['android', 'אנדרואיד'], ['desktop', 'מחשב']].map(([k, l]) => `<button role="tab" class="${(os || d.os) === k ? 'on' : ''}" onclick="App.installSheet({os:'${k}'})">${l}</button>`).join('')}</div></div>`;
    const steps = (g.steps || []).length ? `<ol class="inst-steps">${g.steps.map((x, i) => `<li style="--i:${i}"><span class="n">${i + 1}</span><span class="g">${x.glyph}</span><div><div class="t">${x.title}</div>${x.sub ? `<div class="m">${x.sub}</div>` : ''}</div></li>`).join('')}</ol>` : '';
    const link = location.origin + '/';
    const extra = g.kind === 'inapp'
      ? `<div class="btn-row">${g.openIn === 'safari' ? `<a class="btn dark" href="x-safari-${link}">פתיחה ב-Safari</a>` : `<a class="btn dark" href="intent://${location.host}/#Intent;scheme=https;package=com.android.chrome;end">פתיחה ב-Chrome</a>`}<button class="btn soft" onclick="App.copyText('${link}')">העתקת קישור</button></div><div class="tiny muted center">לא נפתח? מעתיקה את הקישור ומדביקה בדפדפן.</div>`
      : g.safariLink ? `<button class="btn soft" onclick="App.copyText('${link}')">העתקת הקישור (להדביק ב-Safari)</button>`
      : g.copyOnly ? `<button class="btn dark" onclick="App.shareLink()">שליחת הקישור לטלפון</button>` : '';
    const head = g.kind === 'installed'
      ? `<div class="inst-head"><img class="inst-icon" src="/icons/icon-192.png" alt=""><div><div class="sheet-title">מילה כבר על המסך הראשי 🎉</div><div class="sheet-sub">נפתחת כמו אפליקציה. עכשיו רק לוודא שהיא מזכירה לך.</div></div></div>`
      : `<div class="inst-head"><img class="inst-icon" src="/icons/icon-192.png" alt=""><div><div class="sheet-title">${intro || esc(g.title)}</div><div class="sheet-sub">${esc(g.sub || '')}</div></div></div>`;
    sheet(`<div class="inst">${head}${seg}
      ${g.prompt ? `<button class="btn primary inst-go" onclick="App.installNow()">${I().G.install} התקנה בלחיצה</button><div class="inst-or">או ידנית</div>` : ''}
      ${steps}${extra}
      ${pushBlock(d)}
      <button class="btn text mt" onclick="App.closeSheet()">${g.kind === 'installed' ? 'סגירה' : 'אחר כך'}</button>
      ${g.arrow ? '<div class="inst-arrow" aria-hidden="true"><span>כפתור השיתוף בשורה התחתונה</span><i>↓</i></div>' : ''}</div>`);
  }
  function pushBlock(d) {
    const box = (tile, t, m, body = '') => `<div class="inst-push"><div class="inst-push-h"><span class="tile sm ${tile}">${icon('bell', 18)}</span><div><div class="t">${t}</div><div class="m">${m}</div></div></div>${body}</div>`;
    if (!isCloud()) return box('gray', 'התראות', 'זמינות אחרי כניסה עם חשבון.');
    if (d.iosTooOld) return box('peach', 'התראות צריכות iOS 16.4 ומעלה', '״הגדרות״ ← ״כללי״ ← ״עדכון תוכנה״.');
    if (d.pushNeedsInstall) return box('lav', 'באייפון, התראות מגיעות רק מהמסך הראשי', 'אפל מאפשרת התראות רק לאפליקציה ששמרת. שומרת לפי השלבים, פותחת משם, ומדליקה.');
    if (!d.pushApi) return box('gray', 'התראות', 'הדפדפן הזה לא תומך בהתראות. ב-Chrome או ב-Safari זה עובד.');
    const perm = I().permission();
    if (perm === 'denied') return box('pink', 'ההתראות חסומות במכשיר הזה', 'ככה פותחת אותן:', `<ol class="inst-steps sm">${I().unblockSteps(d).map((x, i) => `<li><span class="n">${i + 1}</span><span class="g">${x.glyph}</span><div><div class="t">${x.title}</div></div></li>`).join('')}</ol>`);
    const rt = (Mila.me() && Mila.me().settings.reminderTime) || '20:00';
    if (I().pushOn) return box('lime', 'התראות פעילות ✓', `תזכורת ב-${esc(rt)} אם עוד לא דיווחת. ועדכון כשמישהי עוקפת אותך.`, `<div class="btn-row"><button class="btn soft sm" onclick="App.pushTest()">שליחת התראת בדיקה</button><button class="btn text sm" onclick="App.pushOff()">כיבוי</button></div>`);
    return box('lime', 'שמילה תזכיר לך?', `ב-${esc(rt)}, רק אם עוד לא דיווחת. ותגיד כשמישהי עוקפת אותך.`, `<button class="btn dark" onclick="App.pushEnable()">${icon('bell', 18)} להפעיל התראות</button>`);
  }
  async function installNow() { const r = await I().prompt(); if (r === 'accepted') { closeSheet(); toast('מילה על המסך הראשי 🎉', 'lime'); } else if (r === 'none') installSheet({ os: instOs }); }
  async function pushEnable() {
    try { await I().enablePush(); toast('התראות פעילות ✓', 'lime'); }
    catch (e) { if (e.code !== 'DENIED') fail(e); else toast(e.userMessage); }
    if (sheetOpen()) installSheet({ os: instOs }); else render();
  }
  async function pushOff() { await I().disablePush(); toast('ההתראות כבויות במכשיר הזה'); if (sheetOpen()) installSheet({ os: instOs }); else render(); }
  async function pushTest() { try { await I().testPush(); toast('נשלחה. תוך כמה שניות.', 'lime'); } catch (e) { fail(e); } }
  async function shareLink() { const url = location.origin + '/'; try { if (navigator.share) { await navigator.share({ title: 'מילה', text: 'כולנו מבטיחות. בואי נראה מי מקיימת.', url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; } copyText(url); }
  /* תמונת סטורי לשיתוף (וואטסאפ/אינסטגרם) עם הקישור */
  async function shareStory() {
    const url = location.origin + '/';
    try {
      const blob = await (await fetch('/icons/share-story.png')).blob();
      const file = new File([blob], 'mila-story.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: `כולנו מבטיחות. בואי נראה מי מקיימת. ${url}` }); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mila-story.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast('התמונה ירדה. אפשר להעלות לסטורי.');
    } catch (e) { if (!(e && e.name === 'AbortError')) toast('לא הצלחנו לשתף. נסי שוב.'); }
  }
  function installCard() {
    if (!isCloud() || !I() || !Mila.activeCommitments().length) return '';
    const d = I().detect(); const st = I().get();
    if (st.cardHidden && Date.now() - st.cardHidden < 5 * 864e5) return '';
    const x = `<button class="icon-btn inst-x" aria-label="לא עכשיו" onclick="event.stopPropagation(); App.installHide()">${icon('x', 16)}</button>`;
    if (!d.standalone && d.os !== 'desktop') return `<div class="card tight clickable inst-card" onclick="App.installSheet()">${x}<div style="display:flex;align-items:center;gap:12px"><img class="inst-icon sm" src="/icons/icon-192.png" alt=""><div style="flex:1"><div class="bold">מילה על המסך הראשי</div><div class="small muted">נפתחת כמו אפליקציה ומזכירה לך לדווח. 30 שניות.</div></div>${icon('chev', 20)}</div></div>`;
    if (d.pushApi && I().pushChecked && !I().pushOn && I().permission() !== 'denied') { const rt = Mila.me().settings.reminderTime || '20:00'; return `<div class="card tight inst-card">${x}<div style="display:flex;align-items:center;gap:12px"><span class="tile lime">${icon('bell', 22)}</span><div style="flex:1"><div class="bold">שמילה תזכיר לך ב-${esc(rt)}?</div><div class="small muted">רק אם עוד לא דיווחת.</div></div><button class="btn dark sm" onclick="App.pushEnable()">להפעיל</button></div></div>`; }
    return '';
  }
  function installHide() { I().mark('cardHidden'); render(); }
  function phoneCard() {
    if (!I()) return '';
    const d = I().detect(); const perm = I().permission();
    const pushTxt = !isCloud() ? 'אחרי כניסה עם חשבון' : d.pushNeedsInstall ? 'קודם שומרת למסך הבית' : !d.pushApi ? 'לא נתמך בדפדפן הזה' : perm === 'denied' ? 'חסומות. איך פותחים?' : I().pushOn ? 'פעילות ✓' : 'כבויות. להפעיל?';
    return `<div class="card tight"><div class="card-title">מילה בטלפון</div>
      <div class="list-row clickable" onclick="App.installSheet()"><img class="inst-icon xs" src="/icons/icon-192.png" alt=""><div class="body"><div class="t">על המסך הראשי</div><div class="m">${d.standalone ? 'מותקנת ✓' : `הוראות ל${esc(I().platformName(d))}`}</div></div>${icon('chev', 18)}</div>
      <div class="list-row clickable" onclick="App.installSheet()"><span class="tile sm lime">${icon('bell', 18)}</span><div class="body"><div class="t">התראות במכשיר הזה</div><div class="m">${pushTxt}</div></div>${icon('chev', 18)}</div>
      <div class="list-row clickable" onclick="App.shareStory()"><span class="tile sm peach">${icon('share', 18)}</span><div class="body"><div class="t">תמונה לסטורי</div><div class="m">לשתף את מילה בוואטסאפ או באינסטגרם</div></div>${icon('chev', 18)}</div></div>`;
  }
  /* אחרי האתגר הראשון: הזמן הכי טוב להציע (פעם אחת) */
  function afterFirstCommit() {
    if (!isCloud() || !I()) return; const d = I().detect(); const st = I().get();
    if (st.askedAfterFirst) return;
    const needInstall = !d.standalone && d.os !== 'desktop'; const needPush = d.pushApi && !I().pushOn && I().permission() === 'default';
    if (!needInstall && !needPush) return;
    I().mark('askedAfterFirst');
    setTimeout(() => { if (!sheetOpen()) installSheet({ intro: needInstall ? 'שמילה תזכיר לך לדווח?' : '' }); }, 1900);
  }
  /* פתיחה מהתראה / קיצור דרך: ?go=today | circle&id= | invite */
  function routeFromUrl(href) {
    let u; try { u = new URL(href, location.origin); } catch (e) { return false; }
    const g = u.searchParams.get('go'); if (!g || !Mila.me()) return false;
    if (g === 'circle' && u.searchParams.get('id') && Mila.getState().circles[u.searchParams.get('id')]) { stack = [{ name: 'circles', params: {} }]; go('circle', { id: u.searchParams.get('id') }); }
    else if (g === 'invite') { tab('today'); inviteFlow({}); }
    else tab('today');
    return true;
  }

  /* ============================================================
     S18 — הגדרות
     ============================================================ */
  SCREENS.settings = () => {
    const u = Mila.me(); const s = u.settings; const S = Mila.getState();
    const blocked = Mila.blockedUsers();
    const tog = (k, t, m) => `<div class="toggle-row"><div><div class="t">${t}</div><div class="m">${m}</div></div><button class="switch ${s[k] ? 'on' : ''}" role="switch" aria-checked="${!!s[k]}" onclick="App.setSetting('${k}', ${!s[k]})"></button></div>`;
    return `${topbar({ title: 'הגדרות' })}
      ${isCloud() && Api.me && Api.me.isAdmin ? `<div class="card tight clickable admin-entry" onclick="App.go('admin')"><div style="display:flex;align-items:center;gap:12px"><span class="tile lime">${icon('chart', 22)}</span><div style="flex:1"><div class="bold">אנליטיקה</div><div class="small muted">צמיחה, הזמנות, שימור, אתגרים וקבוצות</div></div>${icon('chev', 20)}</div></div>` : ''}
      <div class="card tight clickable treat-entry" onclick="App.go('treat')"><div style="display:flex;align-items:center;gap:12px">${treatArt('espresso', 46)}<div style="flex:1"><div class="bold">להזמין את מרינה לקפה ☕</div><div class="small muted">האפליקציה נבנתה באהבה. פרגון קטן?</div></div>${icon('chev', 20)}</div></div>
      ${phoneCard()}
      <div class="card tight"><div class="field" style="margin:6px 0 10px"><label>שם תצוגה</label><input class="input" value="${esc(u.name)}" maxlength="30" onchange="App.rename(this.value)"></div>
        <div class="kv"><span class="k">${icon('clock', 18)} אזור זמן</span><span class="v">${esc(u.timezone)}</span></div>
        <div class="kv"><span class="k">${icon('bell', 18)} שעת תזכורת</span><input class="input ltr" type="time" value="${s.reminderTime}" style="width:auto;padding:8px 12px" onchange="App.setSetting('reminderTime', this.value)"></div></div>
      <div class="card tight">${tog('pushReminders', 'תזכורת לדווח', `ב-${esc(s.reminderTime || '20:00')} אם עוד לא דיווחת, וב-9:00 אם אתמול נשאר פתוח`)}${tog('socialDigest', 'עדכונים מהחברות', 'מי עקפה אותך, מי הצטרפה, מילה טובה')}${tog('hideFromLeaderboard', 'בלי אותי בדירוג', 'משחקת, לא מתחרה')}${tog('lockScreenPrivacy', 'מסך נעילה דיסקרטי', 'בלי שמות של אתגרים בהתראות')}</div>
      <div class="card tight"><div class="card-title">בטיחות</div>${blocked.length ? blocked.map(b => `<div class="list-row">${avatar(b, 32)}<div class="body"><div class="t">${esc(b.name)}</div><div class="m">חסומה</div></div><button class="btn xs soft" onclick="App.unblock('${b.id}')">ביטול חסימה</button></div>`).join('') : '<div class="small muted">אף אחת לא חסומה.</div>'}</div>
      <div class="card tight"><div class="card-title">איך זה עובד</div><div class="small muted">עד 3 אתגרים ל-14 יום. כל ערב מסמנת אם עמדת באתגר.<br>עמדת? נקודה. פספסת? הרצף של האתגר מתאפס, הנקודות נשארות.<br>הדירוג בקבוצה לפי אחוז ההתמדה, מ-${Mila.RULES.MIN_RANKED_EVENTS} דיווחים ומעלה. בסוף 14 הימים יש מנצחת.</div></div>
      <div class="card tight"><div class="list-row clickable" onclick="App.exportData()"><span class="tile sm sky">${icon('download', 18)}</span><div class="body"><div class="t">ייצוא הנתונים שלי</div><div class="m">קובץ עם המילים והדיווחים</div></div></div>
        ${S.meta.demo ? `<div class="list-row clickable" onclick="App.resetDemo()"><span class="tile sm peach">${icon('repeat', 18)}</span><div class="body"><div class="t">איפוס הדוגמה</div><div class="m">ולהתחיל באמת</div></div></div>` : ''}
        ${isCloud() ? `<div class="list-row clickable" onclick="App.signOut()"><span class="tile sm gray">${icon('logout', 18)}</span><div class="body"><div class="t">יציאה מהחשבון</div><div class="m">${esc((Api.session && Api.session.user && Api.session.user.email) || '')}</div></div></div>` : ''}
        <div class="list-row clickable" onclick="App.deleteAccount()"><span class="tile sm pink">${icon('trash', 18)}</span><div class="body"><div class="t" style="color:var(--danger)">מחיקת חשבון</div><div class="m">סופי</div></div></div></div>
      <div class="tiny muted center mt">מילה · בטא · מגיל 18</div>`;
  };
  async function setSetting(k, v) { try { await Store().updateSettings({ [k]: v }); render(); } catch (e) { fail(e); } }
  async function rename(name) { try { if (!name.trim()) return; await Store().renameMe(name); toast('עודכן.'); } catch (e) { fail(e); } }
  async function unblock(id) { try { await Store().unblock(id); render(); } catch (e) { fail(e); } }
  async function exportData() { const data = isCloud() ? JSON.stringify(await Api.cloud.exportData(), null, 2) : Mila.exportData(); const blob = new Blob([data], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mila-export.json'; a.click(); URL.revokeObjectURL(a.href); toast('הקובץ ירד'); }
  function resetDemo() { confirmSheet({ title: 'לאפס את הדוגמה?', sub: 'חוזרת למסך הפתיחה.', okText: 'איפוס', okClass: 'pink', onOk: () => { Mila.reset(); closeSheet(true); go('welcome', {}, { reset: true }); } }); }
  function deleteAccount() { confirmSheet({ title: 'למחוק את החשבון?', sub: 'סופי. האתגרים, הדיווחים וההישגים נמחקים. בקבוצות נשאר רישום אנונימי.', okText: 'למחוק', okClass: 'danger', onOk: async () => { await Store().deleteAccount(); closeSheet(true); go('welcome', {}, { reset: true }); toast('נמחק.'); } }); }

  /* ============================================================
     אנליטיקה (מנהלת המערכת בלבד; השרת בודק הרשאה)
     טווח 7/30/90 יום עם השוואה לתקופה הקודמת. כל גרף עם קריאה במעבר עכבר/נגיעה וטבלה.
     ============================================================ */
  let adminData = null, adminErr = null, adminLoading = false, adminDays = 30, adminTab = 'overview';
  const AD_TABS = [['overview', 'סקירה'], ['growth', 'צמיחה והזמנות'], ['engage', 'מעורבות'], ['retain', 'שימור'], ['challenges', 'אתגרים'], ['groups', 'קבוצות וחברתי'], ['app', 'אפליקציה והתראות'], ['more', 'פרגון ובטיחות']];
  const AD_C = { blue: '#2a78d6', orange: '#eb6834', teal: '#1baf7a' };
  const adCharts = {};
  /* רוחב אמיתי בפיקסלים (בלי מתיחה של טקסט): שני גרפים בשורה במחשב, אחד בטלפון */
  function adW(full) { const cw = document.documentElement.clientWidth; const box = Math.min(cw, 1120) - (cw >= 600 ? 48 : 40) - 26; return Math.max(260, Math.floor(!full && cw >= 900 ? (box - 10) / 2 : box)); }
  let adResizeT = null;
  window.addEventListener('resize', () => { clearTimeout(adResizeT); adResizeT = setTimeout(() => { if (stack.length && current().name === 'admin' && adminData) render(); }, 200); });
  async function loadAdmin(days) {
    if (days) adminDays = days;
    adminLoading = true; adminErr = null; render();
    try { adminData = await Api.adminStats(adminDays); } catch (e) { adminErr = e.userMessage || 'לא נטען'; }
    adminLoading = false; render();
  }
  function adminSetTab(t) { adminTab = t; render(); window.scrollTo({ top: 0 }); }
  const adN = (x) => { const v = Number(x || 0); return Math.abs(v) >= 10000 ? new Intl.NumberFormat('he-IL', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : v.toLocaleString('he-IL'); };
  const adP = (x) => (x == null ? '–' : `${x}%`);
  /* שינוי מול התקופה הקודמת. upGood: האם עלייה טובה. kind 'pp' = נקודות אחוז */
  function adDelta(cur, prev, { upGood = true, kind = 'rel' } = {}) {
    if (cur == null || prev == null) return '';
    if (kind === 'pp') { const d = Math.round((cur - prev) * 10) / 10; if (!d) return `<span class="ad-d flat">כמו בתקופה הקודמת</span>`; return `<span class="ad-d ${(d > 0) === upGood ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)} נק׳ אחוז</span> <span class="vs">מהתקופה הקודמת</span>`; }
    if (!prev) return cur ? `<span class="ad-d good">חדש</span> <span class="vs">בתקופה הקודמת היה 0</span>` : `<span class="ad-d flat">כמו בתקופה הקודמת</span>`;
    const d = Math.round(((cur - prev) / prev) * 100); if (!d) return `<span class="ad-d flat">כמו בתקופה הקודמת</span>`;
    return `<span class="ad-d ${(d > 0) === upGood ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%</span> <span class="vs">מהתקופה הקודמת</span>`;
  }
  const adTile = (label, value, { delta = '', sub = '', help = '' } = {}) => `<div class="ad-tile"><div class="l">${label}</div><div class="v">${value}</div>${delta ? `<div class="dl">${delta}</div>` : ''}${sub ? `<div class="s">${sub}</div>` : ''}${help ? `<div class="h">${help}</div>` : ''}</div>`;
  const adSec = (title, intro) => `<div class="ad-sec"><h3>${title}</h3>${intro ? `<p>${intro}</p>` : ''}</div>`;
  const adTable = (id, cols, rows) => `<details class="ad-details"><summary>טבלה</summary><div class="ad-tbl-wrap"><table class="ad-tbl"><thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(typeof c[0] === 'function' ? c[0](r) : r[c[0]])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><button class="btn text xs" onclick="App.adCsv('${id}')">${icon('download', 14)} הורדת CSV</button></details>`;
  const adCsvData = {};
  function adCsv(id) {
    const t = adCsvData[id]; if (!t) return;
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const csv = '﻿' + [t.cols.map(c => q(c[1])).join(','), ...t.rows.map(r => t.cols.map(c => q(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `mila-${id}-${adminDays}d.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const adWithTable = (id, cols, rows) => { adCsvData[id] = { cols, rows }; return adTable(id, cols, rows); };

  /* קו לאורך זמן (סדרה אחת או יותר). ציר אחד, קווי רשת דקים, קריאה בנגיעה. */
  function adLine(id, title, days, series, { area = series.length === 1, full = false } = {}) {
    const W = adW(full), H = 190, L = 34, R = 10, T = 12, B = 24;
    const vals = series.map(s => days.map(d => Number(s.data[d] || 0)));
    const max = Math.max(1, ...vals.flat()); const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / p) * p; })();
    const n = days.length; const step = n > 1 ? (W - L - R) / (n - 1) : 0; const X = (i) => L + i * step; const Y = (v) => T + (H - T - B) * (1 - v / nice);
    adCharts[id] = { kind: 'line', W, x0: L, step, n, days, series: series.map((s, k) => ({ name: s.name, color: s.color, vals: vals[k] })), Y };
    const grid = [0, .25, .5, .75, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${Y(nice * f)}" y2="${Y(nice * f)}" class="g"/><text x="${L - 6}" y="${Y(nice * f) + 4}" class="ax" text-anchor="end">${adN(Math.round(nice * f))}</text>`).join('');
    const xl = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => `<text x="${X(i)}" y="${H - 6}" class="ax" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${Mila.fmtDate(days[i])}</text>`).join('');
    const paths = series.map((s, k) => { const pts = vals[k].map((v, i) => `${X(i)},${Y(v)}`); return `${area ? `<path d="M${X(0)},${Y(0)} L${pts.join(' L')} L${X(n - 1)},${Y(0)} Z" fill="${s.color}" opacity=".1"/>` : ''}<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${X(n - 1)}" cy="${Y(vals[k][n - 1])}" r="4" fill="${s.color}" stroke="#fff" stroke-width="2"/>`; }).join('');
    const legend = series.length > 1 ? `<div class="ad-legend">${series.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>` : '';
    const totals = series.map((s, k) => `${series.length > 1 ? s.name + ': ' : ''}<b>${adN(vals[k].reduce((a, b) => a + b, 0))}</b>`).join(' · ');
    return `<div class="ad-chart"><div class="ad-ct"><span class="t">${title}</span><span class="tot">${totals}</span></div>${legend}
      <div class="ad-plot"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="ad-svg" onpointermove="App.adHover(event,'${id}')" onpointerleave="App.adLeave('${id}')" onpointerdown="App.adHover(event,'${id}')">${grid}${xl}${paths}<line class="ad-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/></svg><div class="ad-tip" id="tip-${id}"></div></div>
      ${adWithTable(id, [[r => Mila.fmtDate(r.d), 'יום'], ...series.map((s, k) => [r => r.v[k], s.name])], days.map((d, i) => ({ d, v: vals.map(v => v[i]) })).reverse())}</div>`;
  }
  /* עמודות לקטגוריות/שעות (סדרה אחת). עמודה עד 24px, פינה עגולה בקצה הנתון. */
  function adCols(id, title, labels, values, { color = AD_C.blue, unit = '', note = '', full = false } = {}) {
    const W = adW(full), H = 170, L = 34, R = 10, T = 12, B = 26;
    const max = Math.max(1, ...values); const n = labels.length; const slot = (W - L - R) / n; const bw = Math.min(24, slot - 4);
    const Y = (v) => T + (H - T - B) * (1 - v / max);
    adCharts[id] = { kind: 'cols', W, x0: L + slot / 2, step: slot, n, labels, series: [{ name: title, color, vals: values }], unit };
    const bars = values.map((v, i) => { const x = L + i * slot + (slot - bw) / 2, y = Y(v), h = Math.max(0, H - B - y); return h ? `<path d="M${x},${H - B} V${y + Math.min(4, h)} Q${x},${y} ${x + Math.min(4, bw / 2)},${y} H${x + bw - Math.min(4, bw / 2)} Q${x + bw},${y} ${x + bw},${y + Math.min(4, h)} V${H - B} Z" fill="${color}"/>` : ''; }).join('');
    const every = n > 12 ? Math.ceil(n / 8) : 1;
    const xl = labels.map((lb, i) => (i % every === 0 ? `<text x="${L + i * slot + slot / 2}" y="${H - 8}" class="ax" text-anchor="middle">${esc(lb)}</text>` : '')).join('');
    const grid = [0, .5, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${Y(max * f)}" y2="${Y(max * f)}" class="g"/><text x="${L - 6}" y="${Y(max * f) + 4}" class="ax" text-anchor="end">${adN(Math.round(max * f))}</text>`).join('');
    return `<div class="ad-chart"><div class="ad-ct"><span class="t">${title}</span>${note ? `<span class="tot">${note}</span>` : ''}</div>
      <div class="ad-plot"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="ad-svg" onpointermove="App.adHover(event,'${id}')" onpointerleave="App.adLeave('${id}')" onpointerdown="App.adHover(event,'${id}')">${grid}${bars}${xl}<rect class="ad-hl" x="0" y="${T}" width="${slot}" height="${H - T - B}" style="display:none"/></svg><div class="ad-tip" id="tip-${id}"></div></div>
      ${adWithTable(id, [['l', 'קטגוריה'], ['v', title]], labels.map((l, i) => ({ l, v: values[i] })))}</div>`;
  }
  function adHover(ev, id) {
    const c = adCharts[id]; if (!c) return; const svg = ev.currentTarget; const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * c.W;
    const i = Math.max(0, Math.min(c.n - 1, Math.round((x - c.x0) / (c.step || 1))));
    const cx = c.x0 + i * c.step;
    if (c.kind === 'line') { const ln = svg.querySelector('.ad-cross'); ln.setAttribute('x1', cx); ln.setAttribute('x2', cx); ln.style.display = ''; }
    else { const hl = svg.querySelector('.ad-hl'); hl.setAttribute('x', cx - c.step / 2); hl.style.display = ''; }
    const tip = document.getElementById(`tip-${id}`); tip.textContent = '';
    const head = document.createElement('div'); head.className = 'k'; head.textContent = c.kind === 'line' ? Mila.fmtDateLong(c.days[i]) : c.labels[i]; tip.appendChild(head);
    for (const s of c.series) { const row = document.createElement('div'); const b = document.createElement('b'); b.textContent = adN(s.vals[i]) + (c.unit || ''); const key = document.createElement('i'); key.style.background = s.color; const nm = document.createElement('span'); nm.textContent = s.name; row.append(key, b, nm); tip.appendChild(row); }
    const px = (cx / c.W) * r.width; tip.style.display = 'block'; tip.style.left = `${Math.min(Math.max(px - tip.offsetWidth / 2, 0), r.width - tip.offsetWidth)}px`;
  }
  function adLeave(id) { const t = document.getElementById(`tip-${id}`); if (t) t.style.display = 'none'; const svg = t && t.parentElement.querySelector('svg'); if (svg) svg.querySelectorAll('.ad-cross,.ad-hl').forEach(e => { e.style.display = 'none'; }); }
  /* פסים אופקיים (משפך / דירוג): שם, ערך, ואחוז */
  const adHBars = (id, rows, { color = AD_C.blue, pctOf = null, fmt = adN, sub = null } = {}) => {
    const max = Math.max(1, ...rows.map(r => r.n));
    adCsvData[id] = { cols: [['label', 'שם'], ['n', 'ערך']], rows };
    return `<div class="ad-hbars">${rows.map((r, i) => `<div class="ad-hb"><div class="lab"><span>${esc(r.label)}</span><b>${fmt(r.n)}</b></div><div class="ad-track"><i style="width:${Math.max(r.n ? 2 : 0, (100 * r.n) / max)}%;background:${color}"></i></div>${sub ? `<div class="sub">${sub(r, i)}</div>` : ''}</div>`).join('')}</div><button class="btn text xs" onclick="App.adCsv('${id}')">${icon('download', 14)} הורדת CSV</button>`;
  };
  const adHeat = (p) => { if (p == null) return ''; const steps = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95']; const i = Math.min(steps.length - 1, Math.floor(p / 100 * steps.length)); return `background:${steps[i]};color:${i >= 3 ? '#fff' : 'var(--ink)'}`; };

  SCREENS.admin = () => {
    if (!adminData && !adminLoading && !adminErr) setTimeout(() => loadAdmin(), 0);
    const head = topbar({ title: 'אנליטיקה', end: `<button class="icon-btn" aria-label="רענון" onclick="App.loadAdmin()">${icon('repeat', 20)}</button>` });
    const ctrl = `<div class="ad-ctrl"><div class="seg">${[7, 30, 90].map(d => `<button class="${adminDays === d ? 'on' : ''}" onclick="App.loadAdmin(${d})">${d} ימים</button>`).join('')}</div>${adminData ? `<span class="tiny muted">${Mila.fmtDate(adminData.range.start)}–${Mila.fmtDate(adminData.range.end)} · מול ${Mila.fmtDate(adminData.range.prevStart)}–${Mila.fmtDate(adminData.range.prevEnd)} · עודכן ${Mila.fmtTime(adminData.generatedAt)}</span>` : ''}</div>
      <div class="ad-tabs">${AD_TABS.map(([k, l]) => `<button class="${adminTab === k ? 'on' : ''}" onclick="App.adminSetTab('${k}')">${l}</button>`).join('')}</div>`;
    if (adminErr) return `${head}${ctrl}<div class="card empty"><div class="t">${esc(adminErr)}</div><button class="btn soft" onclick="App.loadAdmin()">לנסות שוב</button></div>`;
    if (!adminData) return `${head}${ctrl}<div class="empty"><div class="muted small">טוענות נתונים…</div></div>`;
    const d = adminData, k = d.kpi, sd = d.series.days, per = `${d.range.days} הימים`;
    let body = '';
    if (adminTab === 'overview') {
      body = `<div class="ad-hero"><div class="v">${adN(k.dau)}</div><div class="l">משתמשות פעילות היום</div><div class="s">${adN(k.wau)} השבוע · ${adN(k.mau)} ב-30 יום · ${adN(k.users)} רשומות</div></div>
        ${adSec(`מה קרה ב${per}`, 'כל מספר מושווה לתקופה הקודמת באותו אורך.')}
        <div class="ad-grid">
          ${adTile('נרשמו', adN(k.signups.cur), { delta: adDelta(k.signups.cur, k.signups.prev) })}
          ${adTile('פעילות ביום (ממוצע)', adN(k.activeAvg.cur), { delta: adDelta(k.activeAvg.cur, k.activeAvg.prev), help: 'משתמשות שפתחו את האפליקציה באותו יום' })}
          ${adTile('דיווחים', adN(k.reports.cur), { delta: adDelta(k.reports.cur, k.reports.prev) })}
          ${adTile('אחוז הצלחה', adP(k.success.cur), { delta: adDelta(k.success.cur, k.success.prev, { kind: 'pp' }), help: 'מתוך הימים שדווחו: עמדו / (עמדו + פספסו)' })}
          ${adTile('הגיעו מהזמנה', adN(k.viaInvite.cur), { delta: adDelta(k.viaInvite.cur, k.viaInvite.prev) })}
          ${adTile('קבוצות חדשות', adN(k.groups.cur), { delta: adDelta(k.groups.cur, k.groups.prev) })}
        </div>
        <div class="ad-charts">${adLine('ov-active', 'משתמשות פעילות ביום', sd, [{ name: 'פעילות', color: AD_C.blue, data: d.series.active }])}
        ${adLine('ov-signups', 'הרשמות ביום', sd, [{ name: 'כל ההרשמות', color: AD_C.blue, data: d.series.signups }, { name: 'כניסות לאתר', color: AD_C.orange, data: d.series.visits }])}</div>
        <div class="ad-grid">
          ${adTile('דביקות', adP(k.stickiness), { help: 'פעילות היום מתוך פעילות החודש. 20%+ זה טוב.' })}
          ${adTile('אתגרים פעילים', adN(k.challengesActive))}
          ${adTile('קבוצות פעילות', adN(k.groupsActive))}
          ${adTile('נרשמו ולא השלימו', adN(k.pending), { help: 'נכנסו עם Google ולא אישרו פרטים' })}
        </div>`;
    } else if (adminTab === 'growth') {
      const f = d.funnel, top = f[0].n || f.find(x => x.n).n || 1;
      const v = d.viral, kinds = { follow: '👀 לעקוב', compete: '🏁 להתחרות', same: '🤝 אותו אתגר' };
      const src = d.sources, srcTot = src.invite + src.direct;
      body = `${adSec('משפך הרשמה', `בנות שנכנסו ב${per}, ומה הן עשו. האחוז בכל שלב: מתוך השלב הקודם, ובסוגריים מתוך הכניסה לאתר.`)}
        <div class="card">${adHBars('funnel', f, { sub: (r, i) => i === 0 ? 'מבקרות ייחודיות (לפי מכשיר)' : `${adP(f[i - 1].n ? Math.round((1000 * r.n) / f[i - 1].n) / 10 : null)} מהשלב הקודם (${adP(top ? Math.round((1000 * r.n) / top) / 10 : null)} מהכניסה)` })}</div>
        ${adSec('מאיפה הגיעו', 'בנות שנרשמו בתקופה: דרך הזמנה של חברה, או ישירות.')}
        <div class="card">${srcTot ? `<div class="ad-seg"><i style="width:${(100 * src.invite) / srcTot}%;background:${AD_C.blue}"><span>${Math.round((100 * src.invite) / srcTot)}%</span></i><i style="width:${(100 * src.direct) / srcTot}%;background:${AD_C.orange}"><span>${Math.round((100 * src.direct) / srcTot)}%</span></i></div><div class="ad-legend"><span><i style="background:${AD_C.blue}"></i>מהזמנה · ${adN(src.invite)}</span><span><i style="background:${AD_C.orange}"></i>ישירות · ${adN(src.direct)}</span></div>` : '<div class="small muted">עוד אין הרשמות בתקופה.</div>'}</div>
        ${adSec('ויראליות', 'כמה כל משתמשת פעילה מביאה. מקדם מעל 1 = כל אחת מביאה יותר מחברה אחת, והאפליקציה גדלה לבד.')}
        <div class="ad-grid">
          ${adTile('מקדם ויראלי', String(v.k), { help: `בנות חדשות מהזמנה ÷ פעילות בתקופה (${adN(v.signups)} ÷ ${adN(v.activeUsers)})` })}
          ${adTile('הזמנות לכל פעילה', String(v.invitesPerUser), { sub: `${adN(v.invitesSent)} הזמנות נשלחו` })}
          ${adTile('נפתחו', adP(v.openRate), { sub: `${adN(v.opens)} פתיחות קישור`, help: 'פתיחות ייחודיות ÷ הזמנות שנשלחו' })}
          ${adTile('נרשמו מתוך שפתחו', adP(v.signupRate), { help: 'יכול לעבור 100% כשחברה מצטרפת עם קוד בלי לפתוח קישור' })}
        </div>
        ${adLine('gr-inv', 'הזמנות ופתיחות ביום', sd, [{ name: 'הזמנות שנשלחו', color: AD_C.blue, data: d.series.invites }, { name: 'קישורים שנפתחו', color: AD_C.orange, data: d.series.opens }], { area: false, full: true })}
        ${adSec('לפי סוג הזמנה', 'הזמנות שנשלחו בתקופה, ומה קרה איתן.')}
        <div class="card tight"><div class="ad-table c5"><div class="ad-row h"><span>סוג</span><span>נשלחו</span><span>נפתחו</span><span>נרשמו</span><span>הצטרפו</span></div>${d.inviteKinds.map(x => `<div class="ad-row"><span>${kinds[x.kind] || x.kind}</span><span>${adN(x.sent)}</span><span>${adN(x.opens)}</span><span>${adN(x.signups)}</span><span>${adN(x.joins)}</span></div>`).join('')}</div>
          ${adWithTable('kinds', [[r => kinds[r.kind] || r.kind, 'סוג'], ['sent', 'נשלחו'], ['opens', 'נפתחו'], ['signups', 'נרשמו'], ['joins', 'הצטרפו']], d.inviteKinds)}</div>
        ${adSec('מי הביאה את מי', `המזמינות המובילות ב${per}. נחשפו = מבקרות ייחודיות שפתחו קישור שהיא שלחה.`)}
        <div class="card tight">${d.referrers.length ? `<div class="ad-table c6"><div class="ad-row h"><span>מזמינה</span><span>הזמנות</span><span>נחשפו</span><span>נרשמו</span><span>הצטרפו</span><span>סה״כ הביאה</span></div>${d.referrers.map((r, i) => `<div class="ad-row"><span>${i < 3 ? ['🥇', '🥈', '🥉'][i] + ' ' : ''}${esc(r.name || 'ללא שם')}</span><span>${adN(r.invites)}</span><span>${adN(r.opens)}</span><span>${adN(r.signups)}</span><span>${adN(r.joins)}</span><span>${adN(r.signupsAll)}</span></div>`).join('')}</div>
          ${adWithTable('referrers', [['name', 'מזמינה'], ['invites', 'הזמנות'], ['opens', 'נחשפו'], ['signups', 'נרשמו'], ['joins', 'הצטרפו'], ['signupsAll', 'סה״כ הביאה']], d.referrers)}<div class="tiny muted mt">${adN(d.invitersTotal)} שלחו הזמנה אי פעם.</div>` : '<div class="small muted">עוד אין הזמנות בתקופה.</div>'}</div>`;
    } else if (adminTab === 'engage') {
      const e = d.engagement; const wd = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
      body = `${adSec('כמה הן משתמשות', 'פעילה = פתחה את האפליקציה באותו יום.')}
        <div class="ad-grid">
          ${adTile('היום', adN(k.dau))}${adTile('7 ימים', adN(k.wau))}${adTile('30 יום', adN(k.mau))}
          ${adTile('דביקות', adP(k.stickiness), { help: 'היום ÷ 30 יום' })}
          ${adTile('דיווחים לכל פעילה', String(e.reportsPerActive), { help: `ב${per}` })}
        </div>
        <div class="ad-charts">${adLine('en-rep', 'דיווחים ביום', sd, [{ name: 'דיווחים', color: AD_C.blue, data: d.series.reports }])}
        ${adCols('en-per', 'כמה אתגרים פעילים יש לכל אחת', e.perUser.map(x => (x.n === 3 ? '3' : String(x.n))), e.perUser.map(x => x.users), { note: 'משתמשות רשומות' })}
        ${adCols('en-hour', 'מתי מדווחות (שעה ביום)', Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}`), e.hours, { color: AD_C.teal, note: 'שעון ישראל' })}
        ${adCols('en-wd', 'דיווחים לפי יום בשבוע', [...wd].reverse(), [...e.weekdays].reverse(), { color: AD_C.teal })}</div>`;
    } else if (adminTab === 'retain') {
      const r = d.retention;
      body = `${adSec('חוזרות?', 'מתוך מי שנרשמה מספיק זמן כדי למדוד.')}
        <div class="ad-grid">
          ${adTile('חזרו למחרת', adP(r.d1.pct), { sub: `${adN(r.d1.n)} מתוך ${adN(r.d1.of)}` })}
          ${adTile('פעילות ביום 7', adP(r.d7.pct), { sub: `${adN(r.d7.n)} מתוך ${adN(r.d7.of)}` })}
          ${adTile('פעילות ביום 14', adP(r.d14.pct), { sub: `${adN(r.d14.n)} מתוך ${adN(r.d14.of)}` })}
          ${adTile('סבבים שהושלמו', adP(r.rounds.rate), { sub: `${adN(r.rounds.completed)} הושלמו · ${adN(r.rounds.ended)} נעצרו באמצע`, help: 'אתגרים שהסתיימו בתקופה' })}
        </div>
        ${adSec('לפי שבוע הרשמה', 'כל שורה: בנות שנרשמו באותו שבוע. כל תא: כמה אחוז מהן פתחו את האפליקציה בשבוע 1, 2, 3, 4 אחרי ההרשמה. כהה יותר = יותר חוזרות.')}
        <div class="card tight ad-cohort"><table><thead><tr><th>שבוע הרשמה</th><th>נרשמו</th><th>שבוע 1</th><th>שבוע 2</th><th>שבוע 3</th><th>שבוע 4</th></tr></thead><tbody>
          ${r.cohorts.map(c => `<tr><td>${Mila.fmtDate(c.start)}–${Mila.fmtDate(c.end)}</td><td>${adN(c.size)}</td>${c.cells.map(x => (x ? `<td style="${adHeat(x.pct)}" title="${x.n} מתוך ${x.of}">${adP(x.pct)}</td>` : '<td class="na">·</td>')).join('')}</tr>`).join('')}
        </tbody></table><div class="tiny muted mt">· = עוד לא עבר מספיק זמן. ריחוף על תא מראה כמה בנות.</div>
        ${adWithTable('cohorts', [[c => `${c.start}–${c.end}`, 'שבוע הרשמה'], ['size', 'נרשמו'], ...[0, 1, 2, 3].map(i => [c => (c.cells[i] ? c.cells[i].pct + '%' : ''), `שבוע ${i + 1}`])], r.cohorts)}</div>`;
    } else if (adminTab === 'challenges') {
      const cats = d.categories;
      body = `${adSec('קטגוריות', `כמה אתגרים נבחרו ב${per}, ואחוז ההצלחה בהם.`)}
        <div class="card">${adHBars('cats', cats.map(c => ({ label: c.name, n: c.chosen })), { sub: (r, i) => `${adN(cats[i].active)} פעילים עכשיו · הצלחה ${adP(cats[i].success)}` })}</div>
        ${adSec('כל האתגרים', 'נבחרו בתקופה, פעילים עכשיו, אחוז הצלחה בימים שדווחו, ואחוז הסבבים שהושלמו (מתוך אלה שהסתיימו בתקופה).')}
        <div class="card tight"><div class="ad-table c6 wide1"><div class="ad-row h"><span>אתגר</span><span>נבחרו</span><span>פעילים</span><span>הצלחה</span><span>הושלמו</span><span>נעצרו</span></div>
          ${d.challenges.slice(0, 50).map(c => `<div class="ad-row"><span>${esc(c.title)}</span><span>${adN(c.chosen)}</span><span>${adN(c.active)}</span><span>${adP(c.success)}</span><span>${adP(c.completionRate)}</span><span>${adN(c.ended)}</span></div>`).join('')}</div>
          ${adWithTable('challenges', [['title', 'אתגר'], [c => (cats.find(x => x.cat === c.cat) || {}).name || '', 'קטגוריה'], ['chosen', 'נבחרו'], ['active', 'פעילים'], [c => adP(c.success), 'הצלחה'], ['reports', 'דיווחים'], [c => adP(c.completionRate), 'הושלמו'], ['ended', 'נעצרו']], d.challenges)}</div>`;
    } else if (adminTab === 'groups') {
      const g = d.groups, s = d.social;
      body = `${adSec('קבוצות', 'כמה קבוצות יש, כמה גדולות, וכמה מהבנות משחקות עם חברות.')}
        <div class="ad-grid">
          ${adTile('קבוצות פעילות', adN(g.active), { delta: adDelta(k.groups.cur, k.groups.prev), sub: `${adN(g.created)} נפתחו בתקופה` })}
          ${adTile('גודל ממוצע', String(g.avgSize), { help: 'חברות בקבוצה' })}
          ${adTile('משחקות עם חברות', adP(g.inGroupPct), { sub: `${adN(g.inGroup)} מתוך ${adN(k.users)}` })}
          ${adTile('קבוצות שנסגרו', adN(g.closed))}
        </div>
        ${g.sizes.length ? adCols('gr-size', 'כמה חברות בקבוצה', g.sizes.map(x => String(x.size)), g.sizes.map(x => x.groups), { note: 'מספר קבוצות', full: true }) : ''}
        ${adSec('חברתי', `מה קרה בתוך הקבוצות ב${per}.`)}
        <div class="ad-grid">
          ${adTile('מילים טובות', adN(s.encouragements + s.reactions), { sub: `${adN(s.encouragements)} עידודים · ${adN(s.reactions)} תגובות` })}
          ${adTile('עקיפות בדירוג', adN(s.overtakes))}
          ${adTile('אתגרים משותפים', adN(s.shared), { sub: `${adN(s.sharedJoins)} הצטרפויות` })}
          ${adTile('הצטרפו לקבוצות', adN(s.joins))}
        </div>
        ${adSec('הקבוצות הכי פעילות', `לפי מספר הדיווחים ב${per}.`)}
        <div class="card tight">${g.top.length ? `<div class="ad-table c5 wide1"><div class="ad-row h"><span>קבוצה</span><span>חברות</span><span>אתגרים</span><span>דיווחים</span><span>הצלחה</span></div>${g.top.map(x => `<div class="ad-row"><span>${esc(x.name)}</span><span>${adN(x.members)}</span><span>${adN(x.challenges)}</span><span>${adN(x.reports)}</span><span>${adP(x.success)}</span></div>`).join('')}</div>
          ${adWithTable('groups', [['name', 'קבוצה'], ['members', 'חברות'], ['challenges', 'אתגרים פעילים'], ['reports', 'דיווחים'], [x => adP(x.success), 'הצלחה'], ['created', 'נפתחה']], g.top)}` : '<div class="small muted">עוד אין קבוצות.</div>'}</div>`;
    } else if (adminTab === 'app') {
      const a = d.app || { platforms: [] };
      body = `${adSec('על המסך הראשי', `מכשירים ייחודיים ב${per}. ״נפתחה מהמסך הראשי״ = פתיחה כאפליקציה מותקנת (לפחות פעם אחת).`)}
        <div class="ad-grid">
          ${adTile('נפתחה מהמסך הראשי', adN(a.opens), { help: 'מכשירים שפתחו את מילה כאפליקציה' })}
          ${adTile('ראו את מדריך ההתקנה', adN(a.sheet))}
          ${adTile('לחצו ״התקנה״', adN(a.prompt), { sub: `${adN(a.installed)} התקינו (אנדרואיד/מחשב)`, help: 'באייפון ההתקנה ידנית ולא נמדדת כאן' })}
        </div>
        ${adSec('התראות', 'מינויים פעילים עכשיו (כל מכשיר בנפרד), ומי אישרה או חסמה ב' + per + '.')}
        <div class="ad-grid">
          ${adTile('מכשירים עם התראות', adN(a.subscriptions), { sub: `${adN(a.pushUsers)} משתמשות` })}
          ${adTile('הפעילו התראות', adN(a.pushOn))}
          ${adTile('חסמו התראות', adN(a.pushDenied))}
        </div>
        ${a.platforms.length ? `<div class="card tight"><div class="card-title">לפי סוג מכשיר</div>${adHBars('pushplat', a.platforms.map(x => ({ label: x.platform, n: x.n })), { color: AD_C.teal })}</div>` : ''}`;
    } else {
      const t = d.treats, names = { cookie: '🍪 עוגייה · 4 ₪', espresso: '☕ אספרסו · 10 ₪', latte: '🥛 קפה הפוך · 15 ₪' };
      const sf = d.safety;
      body = `${adSec('פרגון', `כמה לחצו על כל פינוק ב${per} (לחיצה אחת ליום לכל מכשיר). את התשלום עצמו רואים רק בביט.`)}
        <div class="card">${adHBars('treats', t.map(x => ({ label: names[x.kind], n: x.clicks })), { color: AD_C.orange })}</div>
        ${adSec('בטיחות', `דיווחים וחסימות ב${per}.`)}
        <div class="ad-grid">
          ${adTile('דיווחים על משתמשות', adN(sf.reports.reduce((a, b) => a + b.n, 0)))}
          ${adTile('חסימות', adN(sf.blocks))}
          ${adTile('חשבונות שנמחקו', adN(sf.deleted), { help: 'מתחילת הדרך' })}
        </div>
        ${sf.reports.length ? `<div class="card tight"><div class="card-title">סיבות הדיווח</div>${adHBars('abuse', sf.reports.map(x => ({ label: x.reason, n: x.n })), { color: AD_C.orange })}</div>` : ''}`;
    }
    return `${head}${ctrl}${adminLoading ? '<div class="tiny muted mb">מעדכנות…</div>' : ''}${body}<div class="tiny muted center mt-lg">נתונים מצטברים, בלי אימיילים. ימים לפי שעון ישראל.</div>`;
  };

  /* ============================================================
     פרגון — ״להזמין את מרינה לקפה״
     הקישור האישי מביט (אפליקציית ביט ← קוד QR אישי ← שיתוף). הסכום מוקלד בביט.
     ============================================================ */
  const BIT_LINK = 'https://www.bitpay.co.il/app/me/DBBB417F-9257-B2BF-4E31-4F9C93FDF7ECAB91';
  const TREATS = {
    cookie: { name: 'עוגיית כדור שוקולד עם פצפוצים', sub: 'קטנה, מתוקה, ומתפצפצת.', price: 4, tint: 'peach' },
    espresso: { name: 'אספרסו', sub: 'קצר וחזק. כמו מילה שעומדים בה.', price: 10, tint: 'pink' },
    latte: { name: 'קפה הפוך', sub: 'הגדול. עם הרבה קצף ולב.', price: 15, tint: 'lav' },
  };
  /* פצפוצים: מיקומים קבועים על הכדור (x, y, סיבוב, צבע) */
  const CRISPIES = [[49, 42, -68, 0], [65, 90, -26, 0], [34, 59, -19, 0], [63, 36, 64, 0], [89, 72, 69, 0], [65, 57, -24, 0], [55, 67, 66, 1], [64, 76, -54, 0], [41, 76, 29, 1], [33, 51, 46, 1], [75, 50, -62, 0], [50, 92, 27, 0], [73, 36, -1, 2], [46, 57, 8, 0], [88, 55, 76, 0], [60, 46, -7, 0], [87, 64, -38, 2], [81, 44, -8, 0], [37, 66, 76, 1], [84, 83, 20, 2], [45, 85, -39, 0], [51, 76, -74, 1], [77, 66, 48, 1], [40, 47, 22, 0], [30, 70, 39, 0], [59, 82, 63, 0], [67, 64, 51, 0], [45, 68, -29, 2], [71, 82, -41, 1], [55, 37, -76, 0], [74, 90, -6, 1], [76, 58, 25, 0], [48, 50, -80, 0], [68, 46, 14, 1]];
  function treatArt(kind, size = 84) {
    const ink = '#1C1A1F';
    const steam = (x0) => `<g class="steam">${[0, 1, 2].map(i => `<path style="--s:${i}" d="M${x0 + i * 12} 30c-4-5 4-9 0-14s4-9 0-13" stroke="#B9B2BE" stroke-width="2.4" stroke-linecap="round" fill="none"/>`).join('')}</g>`;
    if (kind === 'cookie') return `<svg class="tr-art tr-cookie" width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true">
      <ellipse cx="60" cy="106" rx="30" ry="5" fill="rgba(28,26,31,.1)" class="tr-shadow"/>
      <g class="ball"><circle cx="60" cy="64" r="36" fill="#6B3F2A"/><circle cx="60" cy="64" r="36" fill="none" stroke="#4E2C1C" stroke-width="2"/>
      ${CRISPIES.map(([x, y, r, c]) => `<ellipse class="crisp" style="--k:${(x + y) % 7}" cx="${x}" cy="${y}" rx="3.8" ry="2.4" transform="rotate(${r} ${x} ${y})" fill="${['#F4E4C4', '#EAD0A2', '#FFF6E6'][c]}"/>`).join('')}
      <ellipse cx="46" cy="46" rx="11" ry="6" transform="rotate(-35 46 46)" fill="#fff" opacity=".18"/></g>
    </svg>`;
    if (kind === 'espresso') return `<svg class="tr-art tr-espresso" width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true">
      ${steam(46)}
      <ellipse cx="60" cy="100" rx="42" ry="8" fill="#fff" stroke="${ink}" stroke-width="2.5"/>
      <path d="M88 62c13 0 13 20-2 20" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M32 56h56l-6 36q-1 6-7 6H45q-6 0-7-6z" fill="#fff" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round"/>
      <ellipse cx="60" cy="56" rx="28" ry="5.5" fill="#5A3420" stroke="${ink}" stroke-width="2.5"/>
      <ellipse class="crema" cx="60" cy="56" rx="19" ry="3.4" fill="#C88A4E"/>
    </svg>`;
    return `<svg class="tr-art tr-latte" width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true">
      ${steam(44)}
      <ellipse cx="60" cy="104" rx="46" ry="8" fill="#fff" stroke="${ink}" stroke-width="2.5"/>
      <path d="M92 56c16 0 16 26-3 26" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M24 48h72l-8 46q-1 7-8 7H40q-7 0-8-7z" fill="#fff" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round"/>
      <ellipse cx="60" cy="48" rx="36" ry="7.5" fill="#C99A6B" stroke="${ink}" stroke-width="2.5"/>
      <ellipse cx="60" cy="48" rx="28" ry="5.2" fill="#F6E7D2"/>
      <path class="heart" d="M60 52c-7-4.5-9-7.5-6.4-9.6 2.2-1.7 4.8-.6 6.4 1.6 1.6-2.2 4.2-3.3 6.4-1.6 2.6 2.1.6 5.1-6.4 9.6z" fill="#C99A6B"/>
    </svg>`;
  }
  SCREENS.treat = () => `${topbar({ title: 'פרגון' })}
    <div class="treat-hero">
      <div class="th-hearts" aria-hidden="true">${['💛', '💚', '💜', '🧡', '💗'].map((h, i) => `<span style="--i:${i}">${h}</span>`).join('')}</div>
      <svg class="th-heart" width="64" height="64" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 42C9 32 4 24 6.5 16.5 9 9.5 18 8 24 15c6-7 15-5.5 17.5 1.5C44 24 39 32 24 42z" fill="#FFC3DF" stroke="#1C1A1F" stroke-width="2.4" stroke-linejoin="round"/><path d="M17 23c1.4-2.3 4-2.3 5.4 0M26 23c1.4-2.3 4-2.3 5.4 0M19.5 29c2.6 2.6 6.4 2.6 9 0" stroke="#1C1A1F" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>
      <div class="th-title">האפליקציה הזו נוצרה באהבה<br>על ידי מרינה.</div>
      <p>אם את נהנית ממנה, אם היא מועילה לך, ואם הצלחת לשנות הרגלים, אני שמחה!</p>
      <p class="bold">בא לך להזמין אותי לעוגייה, אספרסו או קפה הפוך? אשמח לפרגון.</p>
    </div>
    ${Object.entries(TREATS).map(([k, t], i) => `<button class="treat-card ${t.tint}" style="--i:${i}" onclick="App.treatPick('${k}', this)">
      <span class="tc-art">${treatArt(k, 84)}</span>
      <span class="tc-body"><span class="tc-name">${t.name}</span><span class="tc-sub">${t.sub}</span></span>
      <span class="tc-price">${t.price} ₪</span>
    </button>`).join('')}
    <div class="tiny muted center mt">הפרגון מגיע ישירות למרינה דרך ביט. הוא לא משפיע על המשחק, על הנקודות או על הדירוג.</div>`;
  function treatPick(kind, el) {
    const t = TREATS[kind];
    Api.track(`treat:${kind}`);
    if (el) {
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      const burst = document.createElement('span'); burst.className = 'tc-burst'; burst.setAttribute('aria-hidden', 'true');
      burst.innerHTML = ['💛', '✨', kind === 'cookie' ? '🍪' : '☕', '💗', '✨', '💜'].map((e, i) => `<i style="--a:${-70 + i * 28}deg">${e}</i>`).join('');
      el.querySelector('.tc-art').appendChild(burst); setTimeout(() => burst.remove(), 1100);
    }
    setTimeout(() => sheet(`<div class="sheet-hero treat-sheet">${treatArt(kind, 120)}<div class="sheet-title">תודה! זה ממש משמח 💛</div><div class="sheet-sub">${t.name}</div></div>
      <div class="treat-amount"><span>בביט מקלידה</span><b>${t.price} ₪</b></div>
      ${BIT_LINK ? `<a class="btn primary treat-go" href="${esc(BIT_LINK)}" target="_blank" rel="noopener" onclick="App.closeSheet()">לפתוח את ביט · ${t.price} ₪</a>` : `<button class="btn primary" disabled>הקישור לביט יתווסף בקרוב</button>`}
      <button class="btn text mt" onclick="App.closeSheet()">אולי אחר כך</button>`), el ? 420 : 0);
  }

  /* ============================================================
     S19 — בטיחות: חסימה ודיווח
     ============================================================ */
  function safetySheet(userId, circleId, inviteToken) {
    const u = userId ? Mila.user(userId) : null;
    const reasons = ['לחץ חברתי או הטרדה', 'תוכן פוגעני', 'עידוד להתנהגות מסוכנת', 'התחזות או ספאם', 'אחר'];
    sheet(`<div class="sheet-title">${u ? `בטיחות · ${esc(u.name)}` : 'דיווח על הקבוצה'}</div><div class="sheet-sub">חסימה פועלת מיד. דיווח נבדק.</div>
      <div class="field"><label>סיבת הדיווח</label>${reasons.map(r => `<div class="choice" onclick="App.doReportAbuse('${u ? 'user' : inviteToken ? 'invite' : 'circle'}','${u ? u.id : inviteToken || circleId}','${r}')"><span class="radio"></span><div class="body"><div class="t">${r}</div></div></div>`).join('')}</div>
      ${u && !Mila.isBlocked(Mila.me().id, u.id) ? `<button class="btn danger" onclick="App.blockUser('${u.id}')">${icon('shield', 18)} לחסום את ${esc(u.name)}</button><div class="tiny muted center mt">היא לא תראה אותך ולא תוכל להזמין אותך.</div>` : ''}`);
  }
  async function doReportAbuse(entityType, entityId, reason) { try { await Store().reportAbuse({ entityType, entityId, reason }); closeSheet(true); toast('התקבל. תודה.'); } catch (e) { fail(e); } }
  async function blockUser(id) { try { await Store().block(id); closeSheet(true); toast('נחסמה.'); render(); } catch (e) { fail(e); } }

  /* ============================================================
     אתחול
     ============================================================ */
  async function init() {
    Mila.load();
    $('#nav-ic-today').innerHTML = ICONS.home(22); $('#nav-ic-circles').innerHTML = ICONS.users(22); $('#nav-ic-me').innerHTML = ICONS.user(22);
    const params = new URLSearchParams(location.search);
    const token = params.get('invite');
    const goUrl = params.get('go') ? location.href : null;
    if (params.get('go') || params.get('source')) history.replaceState(null, '', location.pathname + (token ? `?invite=${encodeURIComponent(token)}` : ''));
    if (window.MilaInstall) {
      if (MilaInstall.detect().standalone) Api.track('app_open');
      MilaInstall.onChange(() => { if (stack.length && !sheetOpen() && ['today', 'settings'].includes(current().name)) render({ keepSheet: true }); });
      if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.type === 'mila-sync' && Api.isCloud()) Api.sync().catch(() => {});
      if (m.type === 'mila-open') { const done = () => routeFromUrl(m.url); if (Api.isCloud()) Api.sync().then(done).catch(done); else done(); }
    });
    Api.track('visit');
    if (token) { history.replaceState(null, '', location.pathname); Api.trackInviteOpen(token); Api.track('visit_invite'); }
    const authError = params.get('auth_error');
    if (authError) { history.replaceState(null, '', location.pathname); setTimeout(() => toast('הכניסה לא הושלמה. נסי שוב.'), 300); }
    if (Api.enabled) {
      $('#screen').innerHTML = '<div class="empty" style="padding-top:40vh"><div class="muted small">טוען…</div></div>';
      try {
        await Api.init();
        Api.onSync(() => { if (stack.length && !sheetOpen() && !busy) render({ keepSheet: true }); });
        if (Api.hasSession() && !Api.isCloud()) { pendingInviteToken = token; go('profile', {}, { reset: true }); return; }
        if (Api.isCloud()) {
          await Api.sync();
          Api.startAutoSync();
          go('today', {}, { reset: true }); if (token) openInvite(token); else if (goUrl) routeFromUrl(goUrl);
          if (window.MilaInstall) MilaInstall.refreshPush();
          return;
        }
      } catch (e) {
        console.error(e);
        if (e.code === 'OFFLINE' && Api.loadCache()) { toast('אין רשת. זה המצב האחרון שנשמר.'); go('today', {}, { reset: true }); return; }
        toast('אין חיבור לשרת. נסי שוב בעוד רגע.');
      }
      // אין session: אם יש מצב דמו מקומי שמור – נכבד אותו; אחרת מסך פתיחה
      if (Mila.me() && Mila.getState().meta.demo) { go('today', {}, { reset: true }); return; }
      pendingInviteToken = token; go('welcome', {}, { reset: true }); return;
    }
    if (!Mila.me()) { pendingInviteToken = token; go('welcome', {}, { reset: true }); }
    else { go('today', {}, { reset: true }); if (token) openInvite(token); }
    setInterval(() => { if (document.visibilityState === 'visible' && TOP.includes(current().name)) { const before = JSON.stringify(Object.values(Mila.getState().obligations).map(o => o.status)); Mila.refreshStatuses(); if (JSON.stringify(Object.values(Mila.getState().obligations).map(o => o.status)) !== before) render(); } }, 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {}); if (Api.isCloud()) Api.sync().catch(() => {}); else render(); } });
    window.addEventListener('online', () => { if (Api.isCloud()) Api.sync().then(() => toast('החיבור חזר. הכול מעודכן.', 'lime')).catch(() => {}); });
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  document.addEventListener('DOMContentLoaded', init);

  return {
    go, back, tab, refresh, closeSheet, toast, startDemo,
    suChange, suToggle, signup, googleSignIn, authSet, authToggle, termsSheet, completeProfile, signOut,
    setVisibility, react, sendEncouragement, rotateInvite, openInvite, rename, unblock, ideasCat: setIdeasCat, ideasToggle,
    reportSheet, confirmMiss, excuseSheet, doReport, correctionSheet, _corrPick, doCorrect,
    openWordWizard, wizSet, wizTemplate, wizNext, wizPrev, wizCancel, wizCommit, wordMenu, endWord,
    circleAddSheet, joinByCodeSheet, joinByCode, cwSet, cwCreate, setCircleTab, encourageSheet, circleMenu, leaveCircle, inviteSheet, shareInvite, copyText, removeMember, cmSet,
    acceptInvite, declineInvite, openGroupWizard, memberSheet, setRole, deleteCircle, openPick, pickCat, pickToggle, pickClear, pickSet, pickReward, pickNext, pickBack, pickCancel, pickCustom, pickCommit, inviteFlow, invSet, invWord, invNewCircle, invNext, invBack, inviteClose, inviteDone, inviteRotate, inviteMsg, inviteSend, inviteFromWord, gwSet, gwTemplate, gwPropose, adoptSheet, adopt, cancelProposal,
    installSheet, installNow, installHide, pushEnable, pushOff, pushTest, shareLink, shareStory,
    bankFilter: setBankFilter, treatPick, loadAdmin, adminSetTab, adHover, adLeave, adCsv, setSetting, exportData, resetDemo, deleteAccount, safetySheet, doReportAbuse, blockUser,
  };
})();
