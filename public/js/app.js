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
    const ppl = { noa: { name: 'נועה', color: 'lavender' }, me: { name: 'את', color: 'lime' }, dana: { name: 'דנה', color: 'mint' } };
    const burst = [[-70, -46], [-34, -70], [12, -64], [52, -40], [-62, 14], [60, 10], [-20, 40], [30, 44]];
    const cta = Api.enabled ? `<button class="btn dark hero-btn" onclick="App.googleSignIn()">${googleMark()} יאללה, אני בפנים</button>` : `<button class="btn dark hero-btn" onclick="App.go('signup')">יאללה, אני בפנים</button>`;
    return `
    <div class="hero">
      <div class="hero-blobs" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="hero-top">${liveLogo(26)}<span class="brand">מילה.</span><span class="beta">בטא</span></div>
      ${pendingInviteToken ? `<div class="invited-banner">💌 הוזמנת לקבוצה של חברה. נכנסים עם Google, ואז מצטרפים.</div>` : ''}

      <div class="hero-stage">
        <div class="eyebrow">מכירה את זה?</div>
        <span class="excuse" style="--d:.15s">ממחר ספורט.</span>
        <span class="excuse" style="--d:.35s">ממחר בלי מתוקים.</span>
        <span class="excuse" style="--d:.55s">ממחר לישון מוקדם.</span>
        <div class="caption">ואז מגיע מחר. וכלום. 😂</div>
        <div class="stamp2">אז די.</div>
        <div class="burst" aria-hidden="true">${burst.map(([x, y], i) => `<i style="--x:${x}px;--y:${y}px;--c:var(--${['lime-deep', 'pink-ink', 'lav-ink', 'peach-ink'][i % 4]})"></i>`).join('')}</div>
      </div>

      <h1 class="hero-h"><span>כולנו מבטיחות.</span><span>בואי נראה מי <mark>מקיימת</mark>.</span></h1>

      <div class="race">
        <div class="race-head"><div class="promise-rot" aria-live="off">${PROMISES.map((t, i) => `<span style="--i:${i}">${t}</span>`).join('')}</div><div class="race-chips"><span style="--d:2.5s">3 אתגרים</span><span style="--d:2.6s">14 ימים</span><span style="--d:2.7s">חברות</span></div></div>
        <div class="race-title"><b>🏁 מי מובילה?</b><span class="live"><i></i>עכשיו</span></div>
        <div class="race-body">
          <div class="race-places"><span class="first">1</span><span>2</span><span>3</span></div>
          <div class="race-rows">
            ${[['noa', 'נועה', 86], ['me', 'את', 91], ['dana', 'דנה', 71]].map(([k, nm, p]) => `<div class="ln ${k}" style="--to:${p / 100}">
              <div class="track"><div class="trail"></div><span class="nm">${nm}</span><span class="flag">🏁</span><span class="runner">${k === 'me' ? '<span class="crown">👑</span>' : ''}${avatar(ppl[k], 30)}</span></div>
              <span class="pc">${k === 'me' ? '<span class="a">83%</span><span class="b">91%</span>' : `${p}%`}</span>
            </div>`).join('')}
            <div class="ovt">עקפת את נועה 😏</div>
          </div>
        </div>
      </div>

      <div class="hero-cta">${cta}
        <button class="btn text" onclick="App.startDemo()">${icon('sparkle', 18)} להציץ בדוגמה</button>
        <div class="disclaimer">כניסה עם Google · מגיל 18 · חינם</div>
      </div>
    </div>`;
  };

  function startDemo() {
    Mila.reset();
    MilaDemo.seed('דניאלה');
    go('today', {}, { reset: true });
    toast('זו דוגמה. איפוס מההגדרות.', 'lime');
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
    <div class="mt-lg"><button class="btn primary" id="su-go" ${signupForm.name.trim() && signupForm.age && signupForm.terms ? '' : 'disabled'} onclick="App.signup()">חותמת על זה</button></div>`;
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
      <div class="step-title mt-lg">איך קוראים לך?</div><div class="step-sub">ככה החברות יראו אותך.</div>
      <div class="field"><input class="input" id="pf-name" placeholder="שם תצוגה" maxlength="30" value="${esc(authForm.name || (Api.me && Api.me.name) || '')}" oninput="App.authSet('name', this.value)"></div>
      <div class="checkbox-row ${authForm.age ? 'on' : ''}" onclick="App.authToggle('age')"><span class="box">${authForm.age ? icon('check', 16) : ''}</span><span>אני בת 18 ומעלה</span></div>
      <div class="checkbox-row ${authForm.terms ? 'on' : ''}" onclick="App.authToggle('terms')"><span class="box">${authForm.terms ? icon('check', 16) : ''}</span><span>קראתי את <a href="#" onclick="event.preventDefault(); App.termsSheet()">תנאי השימוש</a>. נקודות משחק, בלי כסף אמיתי.</span></div>
      <div class="mt-lg"><button class="btn primary" id="pf-go" ${busy ? 'disabled' : ''} onclick="App.completeProfile()">${busy ? 'רגע…' : 'חותמת על זה'}</button></div>
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
      <div class="step-title mt-lg">היי ${esc(Mila.me().name)}. מאיפה מתחילות?</div>
      <div class="row-card" onclick="App.openPick()"><span class="tile lg lime">${icon('pencil', 28)}</span><div class="body"><div class="t">בוחרת אתגרים</div><div class="m">עד 3 אתגרים ל-14 יום.</div></div>${icon('chev', 20)}</div>
      <div class="row-card" onclick="App.joinByCodeSheet()"><span class="tile lg pink">${icon('users', 28)}</span><div class="body"><div class="t">מצטרפת לקבוצה של חברה</div><div class="m">קיבלת קוד או קישור? מכניסים אותו כאן.</div></div>${icon('chev', 20)}</div>
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
    const bestStreak = Math.max(0, ...active.map(c => Mila.streak(c.id).current));
    const rankCircle = Mila.myCircles().map(c => ({ c, ri: Mila.rankInsight(c.id) })).find(x => x.ri);

    return `
      <div class="topbar" style="padding-bottom:4px">
        <div class="topbar-side"><button class="icon-btn" aria-label="התראות" onclick="App.go('notifications')">${icon('bell', 24)}${unread ? '<span class="badge-dot"></span>' : ''}</button></div>
        <div class="title-wrap">${active.length < Mila.RULES.DAILY_CAP ? `<button class="btn primary sm" onclick="App.openPick()">${icon('plus', 16)} אתגר חדש</button>` : ''}</div>
        <div class="topbar-side end"><button class="icon-btn" aria-label="הפרופיל שלי" onclick="App.tab('me')">${avatar(u, 40)}</button></div>
      </div>
      ${Mila.getState().meta.demo ? `<div class="demo-banner">דוגמה. הקבוצות והחברות מומצאות. <a href="#" onclick="event.preventDefault(); App.resetDemo()">להתחיל באמת</a></div>` : ''}
      <div class="greeting"><div><div class="hello">${greet}, ${esc(u.name)} ${icon(hour >= 17 || hour < 5 ? 'moon' : 'sun', 22)}</div><div class="sub">${todaySubtitle(cards)}</div></div></div>

      ${main ? `<div class="card ring-card">
          ${ring(main.st.dayIndex, Mila.RULES.ROUND_DAYS, `<div class="label">יום</div><div class="big"><b>${main.st.dayIndex}</b> מתוך ${Mila.RULES.ROUND_DAYS}</div>`)}
          <div class="ring-dots">${active.slice(0, 3).map((c, i) => `<i class="${c.id === main.c.id ? 'on' : ''}"></i>`).join('')}</div>
          <div class="ring-meta"><span>הצלחות <b>${bank.earnedCurrentRound}</b></span><span>רצף <b>${bestStreak}</b></span>${rankCircle && rankCircle.ri.place ? `<span>מקום <b>${rankCircle.ri.place}</b> מתוך ${rankCircle.ri.total}</span>` : `<span>היום <b>${done}/${cards.length}</b></span>`}</div>
        </div>` : ''}

      ${rankCircle ? `<div class="card tight clickable pastel-lav" onclick="App.go('circle',{id:'${rankCircle.c.id}'})"><div style="display:flex;align-items:center;gap:12px"><span class="tile lav">${icon('trophy')}</span><div style="flex:1"><div class="bold">${esc(rankCircle.ri.text)}</div><div class="small muted">${esc(rankCircle.c.name)} · יום ${Mila.circleRound(rankCircle.c.id).dayIndex} מתוך ${Mila.RULES.ROUND_DAYS}</div></div>${icon('chev', 20)}</div></div>` : ''}

      ${pendingSum.length ? pendingSum.map(c => `<div class="card pastel-lav clickable tight" onclick="App.go('summary',{id:'${c.id}'})"><div style="display:flex;align-items:center;gap:12px"><span class="tile lav">${icon('medal')}</span><div style="flex:1"><div class="bold">הסבב נגמר: ${esc(Mila.wordDef(c.defId).title)}</div><div class="small muted">איך הלך?</div></div>${icon('chev', 20)}</div></div>`).join('') : ''}

      <div class="section-title">האתגרים שלי להיום ${cards.length ? `<small>${done}/${cards.length}</small>` : ''}</div>
      ${cards.length ? cards.map(todayRow).join('') : `<div class="card empty"><span class="tile lg lime">${icon('pencil', 28)}</span><div class="t">אז במה את מתחילה?</div><div class="m">עד 3 אתגרים ל-14 יום.</div><button class="btn primary" onclick="App.openPick()">בוחרת אתגרים</button></div>`}
      ${cards.length && active.length < Mila.RULES.DAILY_CAP ? `<button class="btn ghost mt" onclick="App.openPick()">${icon('plus', 20)} עוד אתגר</button>` : ''}
      ${cards.length && active.length >= Mila.RULES.DAILY_CAP ? `<div class="note">${icon('info', 18)}<span>3 אתגרים. זה המקסימום.</span></div>` : ''}

      ${upcoming.length ? `<div class="section-title">מתחילות בקרוב</div>${upcoming.map(c => `<div class="word-row" onclick="App.go('word',{id:'${c.id}'})">${wordTile(c.def, 'sm')}<div class="body"><div class="name">${esc(c.def.title)}</div><div class="meta">מתחילה ${Mila.relDay(c.startDate)}</div></div>${icon('chev', 18)}</div>`).join('')}` : ''}

      ${digest.length ? `<div class="section-title">אצל החברות <small onclick="App.tab('circles')" style="cursor:pointer">הכול</small></div>
        <div class="card tight">${digest.map(e => `<div class="feed-item" onclick="App.go('circle',{id:'${e.circleId}'})">${avatar(e.actor, 36)}<div class="body"><div class="t">${feedText(e)}</div><div class="m">${esc(e.circle.name)} · ${timeAgo(e.createdAt)}</div></div></div>`).join('')}</div>` : ''}
      ${!Mila.myCircles().length ? `<div class="card pastel-pink clickable tight" onclick="App.inviteFlow({ kind: 'compete' })"><div style="display:flex;align-items:center;gap:12px"><span class="tile pink">${icon('users')}</span><div style="flex:1"><div class="bold">נראה אותך עומדת בזה יותר ממני</div><div class="small muted">הזמיני חברה. מתחרות על התמדה.</div></div>${icon('chev', 20)}</div></div>` : ''}
    `;
  };

  function todaySubtitle(cards) {
    if (!cards.length) return 'אין אתגר על הכף היום';
    const left = cards.filter(x => !x.outcome).length;
    const kept = cards.filter(x => x.outcome === 'success').length;
    if (left === 0) return kept === cards.length ? 'אמרת ועשית. הכול היום.' : 'זהו להיום. מחר שוב.';
    if (left === cards.length) return cards.length === 1 ? 'אתגר אחד על הכף היום' : `${cards.length} אתגרים על הכף היום`;
    return left === 1 ? 'נשאר עוד אחד להיום' : `נשארו עוד ${left} להיום`;
  }
  function todayRow(x) {
    const st = x.outcome === 'success' ? 'done' : x.outcome === 'miss' ? 'miss' : x.outcome === 'excused' ? 'excused' : x.late ? 'late' : '';
    const mark = x.outcome === 'success' ? icon('check', 18) : x.outcome === 'miss' ? icon('x', 16) : x.outcome === 'excused' ? icon('minus', 16) : '';
    const meta = x.outcome === 'success' ? '<span class="chip lime">+1</span>' : x.outcome === 'miss' ? `<span class="chip pink">לא היום</span>` : x.outcome === 'excused' ? '<span class="chip lav">יום חריג</span>' : x.late ? `<span class="chip peach">${icon('clock', 13)} אתמול · עד 10:00</span>` : '';
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
        ${o.canCorrect ? `<button class="btn soft" onclick="App.correctionSheet('${o.id}')">${icon('edit', 18)} טעות? לתקן</button><div class="tiny muted center mt">עד 24 שעות.</div>` : '<div class="note">' + icon('lock', 18) + '<span>נעול. עברו 24 שעות.</span></div>'}
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
      const { obligation, duplicate } = await Store().report(id, outcome, { note });
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
    sheet(`<div class="sheet-title">לתקן</div><div class="sheet-sub">${esc(o.def.title)} · ${Mila.relDay(o.localDate)}. התיקון נשמר ליד המקור.</div>
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
      <div class="step-title">אז, על מה את חותמת?</div><div class="step-sub">משהו שאפשר לסמן עליו וי בסוף כל יום.</div>
      ${templateChips('wizTemplate', wiz.title)}
      <div class="field"><label>המילה</label><input class="input" id="w-title" placeholder="למשל: 8,000 צעדים ביום" maxlength="60" value="${esc(wiz.title)}" oninput="App.wizSet('title', this.value)"></div>
      <div class="field"><label>מה נחשב הצלחה?</label><textarea class="input" id="w-rule" placeholder="הכלל שלפיו תסמני וי" maxlength="200" oninput="App.wizSet('rule', this.value)">${esc(wiz.rule)}</textarea></div>
      <div class="field"><label>אייקון</label><div class="icon-picker">${Mila.WORD_ICONS.map(ic => `<span class="tile ${tileColorFor(wiz.title || ic)} ${wiz.icon === ic ? 'on' : ''}" onclick="App.wizSet('icon','${ic}'); App.refresh()">${icon(ic, 24)}</span>`).join('')}</div></div>
      <div class="mt-lg"><button class="btn primary" onclick="App.wizNext()">המשך</button></div>`;
    if (wiz.step === 2) {
      const opts = [[Mila.today(), 'היום'], [Mila.addDays(Mila.today(), 1), 'מחר'], [nextSunday(), 'יום ראשון הקרוב']];
      return `${header}${steps}
      <div class="step-title">מתי מתחילות?</div><div class="step-sub">${Mila.RULES.ROUND_DAYS} ימים רצוף. מדווחות עד ${Mila.RULES.GRACE_HOUR}:00 למחרת.</div>
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
      ${wiz.circleId ? `<div class="field mt"><label>מה הן רואות</label>
        <div class="seg"><button class="${wiz.visibility === 'status' ? 'on' : ''}" onclick="App.wizSet('visibility','status'); App.refresh()">כל יום</button><button class="${wiz.visibility === 'summary' ? 'on' : ''}" onclick="App.wizSet('visibility','summary'); App.refresh()">רק בסוף</button></div>
        <div class="hint">${wiz.visibility === 'status' ? 'עמדת או פספסת, יום יום. בלי פרטים.' : 'רק אחוז ההצלחה בסוף הסבב.'}</div></div>` : ''}
      <div class="btn-row mt-lg"><button class="btn soft" onclick="App.wizPrev()">חזרה</button><button class="btn primary" onclick="App.wizNext()">המשך</button></div>`;
    }
    // step 4 — סיכום לפני נתינת מילה
    const cap = Mila.capCheck(Mila.me().id, wiz.startDate);
    const circle = wiz.circleId ? Mila.getState().circles[wiz.circleId] : null;
    return `${header}${steps}
      <div class="step-title">חותמת?</div><div class="step-sub">14 יום. כל יום מדווחות: עמדתי או לא.</div>
      <div class="card"><div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">${wordTile({ title: wiz.title, icon: wiz.icon }, 'lg')}<div><div class="bold" style="font-size:1.15rem">${esc(wiz.title)}</div><div class="small muted">${esc(wiz.rule)}</div></div></div>
        <div class="kv"><span class="k">${icon('calendar', 18)} סבב</span><span class="v">${Mila.fmtDate(wiz.startDate)} – ${Mila.fmtDate(Mila.addDays(wiz.startDate, 13))}</span></div>
        <div class="kv"><span class="k">${icon('eye', 18)} מי רואה</span><span class="v">${circle ? esc(circle.name) : 'רק אני'}</span></div>
      </div>
      <div class="field"><label>אם אצליח, אני…</label><input class="input" maxlength="80" placeholder="למשל: קונה לעצמי משהו נחמד" value="${esc(wiz.reward || '')}" oninput="App.wizSet('reward', this.value)"><div class="hint">לא חובה. משהו קטן שיהיה שווה להתאמץ בשבילו.</div></div>
      ${!cap.ok ? `<div class="note warn">${icon('info', 18)}<span>3 מילים כבר רצות בימים האלה (${cap.conflictingWords.map(w => esc(w.title)).join(', ')}).</span></div>${cap.nextFree ? `<button class="btn soft" onclick="App.wizSet('startDate','${cap.nextFree}'); App.refresh()">להתחיל ב-${Mila.fmtDate(cap.nextFree)}</button>` : ''}` : ''}
      <div class="btn-row mt"><button class="btn soft" onclick="App.wizPrev()">חזרה</button><button class="btn primary" ${cap.ok ? '' : 'disabled'} onclick="App.wizCommit()">חותמת על זה</button></div>`;
  };
  function nextSunday() { const d = new Date(); const diff = (7 - d.getDay()) % 7 || 7; return Mila.addDays(Mila.today(), diff); }
  function wizSet(k, v) { wiz[k] = v; Mila.getState().drafts.word = { ...wiz }; Mila.save(); }
  function wizTemplate(i) { const t = Mila.TEMPLATES[i]; wiz.title = t.title; wiz.rule = t.rule; wiz.icon = t.icon; wizSet('title', t.title); ideasOpen = false; render(); }
  function wizNext() {
    try {
      if (wiz.step === 1) Mila.getState() && validateStep1();
      if (wiz.step === 2 && wiz.startDate < Mila.today()) throw { userMessage: 'לא על ימים שעברו' };
      wiz.step += 1; render();
    } catch (e) { fail(e); }
  }
  function validateStep1() { if (!wiz.title.trim()) throw { userMessage: 'איזו מילה?' }; if (!wiz.rule.trim()) throw { userMessage: 'מה נחשב הצלחה?' }; }
  function wizPrev() { wiz.step -= 1; render(); }
  function wizCancel() { Mila.getState().drafts.word = { ...wiz }; Mila.save(); wiz = null; back(); if (Mila.getState().drafts.word && Mila.getState().drafts.word.title) toast('שמרנו טיוטה.'); }
  async function wizCommit() {
    try {
      const { def, commitment } = await Store().createPersonalWord({ title: wiz.title, rule: wiz.rule, icon: wiz.icon, startDate: wiz.startDate, circleId: wiz.circleId, visibility: wiz.circleId ? wiz.visibility : 'private', reward: wiz.reward || '' });
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
      <button class="btn text mt" onclick="App.pickCustom()">${icon('plus', 16)} לא מצאת? תצרי אתגר משלך</button>`;
  };
  function pickReview(header) {
    const L = Mila.LIBRARY;
    const circles = Mila.myCircles();
    const cap = Mila.capCheck(Mila.me().id, pick.startDate);
    const sensitive = pick.selected.filter(id => L.isSensitive(id));
    const circle = pick.circleId ? Mila.getState().circles[pick.circleId] : null;
    const opts = [[Mila.today(), 'היום'], [Mila.addDays(Mila.today(), 1), 'מחר']];
    return `${header}
      <div class="step-title">חותמת?</div><div class="step-sub">14 ימים. כל יום מדווחות: עמדתי או לא.</div>
      ${pick.selected.map(id => { const ch = L.get(id); return `<div class="card tight"><div style="display:flex;gap:12px;align-items:center">${wordTile(ch)}<div style="flex:1;min-width:0"><div class="bold">${esc(ch.title)}</div><div class="small muted">${esc(ch.rule)}</div></div><button class="icon-btn" aria-label="הסרה" onclick="App.pickToggle('${id}')">${icon('x', 18)}</button></div>
        <div class="field" style="margin:10px 0 0"><label>אם אצליח, אני…</label><input class="input" maxlength="80" placeholder="למשל: קונה לעצמי משהו נחמד" value="${esc(pick.rewards[id] || '')}" oninput="App.pickReward('${id}', this.value)"></div></div>`; }).join('')}
      <div class="tiny muted mb">לא חובה. משהו קטן שיהיה שווה להתאמץ בשבילו. רק את רואה.</div>
      <div class="field"><label>מתי מתחילים?</label><div class="seg">${opts.map(([d, l]) => `<button class="${pick.startDate === d ? 'on' : ''}" onclick="App.pickSet('startDate','${d}')">${l}</button>`).join('')}</div></div>
      <div class="field"><label>מי רואה?</label>
        <div class="choice ${!pick.circleId ? 'on' : ''}" onclick="App.pickSet('circleId', null)"><span class="radio">${!pick.circleId ? icon('check', 14) : ''}</span><div class="body"><div class="t">רק אני</div><div class="m">בלי קבוצה. בלי דירוג.</div></div><span class="tile sm gray">${icon('lock', 18)}</span></div>
        ${circles.map(c => `<div class="choice ${pick.circleId === c.id ? 'on' : ''}" onclick="App.pickSet('circleId','${c.id}')"><span class="radio">${pick.circleId === c.id ? icon('check', 14) : ''}</span><div class="body"><div class="t">${esc(c.name)}</div><div class="m">${Mila.circleMembers(c.id).length} חברות · נכנסת לדירוג</div></div>${circleTile(c, 'sm')}</div>`).join('')}
        ${!circles.length ? `<div class="tiny muted">עוד אין לך קבוצה. אפשר להזמין חברות אחר כך.</div>` : ''}
      </div>
      ${circle && sensitive.length ? `<div class="checkbox-row ${pick.shareSensitive ? 'on' : ''}" onclick="App.pickSet('shareSensitive', ${!pick.shareSensitive})"><span class="box">${pick.shareSensitive ? icon('check', 16) : ''}</span><span>לשתף גם ${sensitive.length === 1 ? 'את האתגר הפרטי' : 'את האתגרים הפרטיים'} (זוגיות) עם ${esc(circle.name)}. בלי זה הם נשארים רק אצלך.</span></div>` : ''}
      ${!cap.ok ? `<div class="note warn">${icon('info', 18)}<span>3 אתגרים כבר רצים בימים האלה.${cap.nextFree ? ` פנוי מ-${Mila.fmtDate(cap.nextFree)}.` : ''}</span></div>` : ''}
      <div class="btn-row mt-lg"><button class="btn soft" onclick="App.pickBack()">חזרה</button><button class="btn primary" ${cap.ok && pick.selected.length ? '' : 'disabled'} ${busy ? 'disabled' : ''} onclick="App.pickCommit()">${busy ? 'רגע…' : 'חותמת על זה'}</button></div>`;
  }
  function pickCat(id) { pick.open = pick.open === id ? null : id; render(); }
  function pickToggle(id) {
    const i = pick.selected.indexOf(id);
    if (i >= 0) pick.selected.splice(i, 1);
    else { if (pick.selected.length >= freeSlots(pick.startDate)) return toast(freeSlots(pick.startDate) === 0 ? 'אין מקום פנוי בימים האלה.' : 'עד 3 אתגרים. להחליף? בטלי אחד.'); pick.selected.push(id); }
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
      stamp(created.length === 1 ? 'מילה שלי.' : `${created.length} אתגרים. מילה שלי.`);
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
        <div class="chips">${def.kind === 'group' ? `<span class="chip lav">${icon('users', 13)} מילה לכולנו</span>` : `<span class="chip">${icon('user', 13)} מילה שלי</span>`}${circle ? `<span class="chip outline" onclick="App.go('circle',{id:'${circle.id}'})">${esc(circle.name)}</span>` : '<span class="chip outline">רק אני</span>'}${c.status !== 'active' ? `<span class="chip outline">${c.status === 'completed' ? 'נגמר' : 'הופסקה'}</span>` : ''}</div></div>
      ${fresh ? `<div class="note lime">${icon('sparkle', 18)}<span>מתחיל ${Mila.relDay(c.startDate)}. דיווח עד ${Mila.RULES.GRACE_HOUR}:00 למחרת.</span></div>` : ''}
      <div class="stat-grid mb"><div class="stat lime"><div class="n">${st.success}</div><div class="l">עמדתי</div></div><div class="stat pink"><div class="n">${st.miss}</div><div class="l">פספסתי</div></div><div class="stat lav"><div class="n">${st.current}${icon('flame', 18)}</div><div class="l">ברצף</div></div></div>
      ${c.reward ? `<div class="card tight pastel-lav"><div class="tiny muted">${mine ? 'אם אצליח, אני…' : `${esc(Mila.user(c.userId).name)} הבטיחה לעצמה`}</div><div class="bold">${esc(c.reward)}</div></div>` : ''}
      ${mine && c.status === 'active' ? `<div class="btn-row mb"><button class="btn ghost sm" onclick="App.inviteFlow({ commitmentId: '${id}', kind: 'follow' })">${icon('eye', 16)} תראי אם אני עומדת במילה שלי</button><button class="btn ghost sm" onclick="App.inviteFlow({ commitmentId: '${id}', kind: 'same' })">${icon('users', 16)} בואי, שתינו צריכות את זה</button></div>` : ''}
      <div class="card"><div class="card-title">14 הימים <span class="link">${c.status === 'active' ? `יום ${Math.max(st.dayIndex, 1)}` : `${Mila.fmtDate(c.startDate)} – ${Mila.fmtDate(c.endDate)}`}</span></div>${days14(id)}</div>
      ${mine && todayOb && !todayOb.outcome && Mila.isOpenNow(todayOb) ? `<button class="btn primary mb" onclick="App.reportSheet('${todayOb.id}')">${icon('check', 20)} עמדתי היום?</button>` : ''}
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
      ${c.status === 'active' ? `<div class="list-row clickable" onclick="App.endWord('${id}')"><span class="tile sm pink">${icon('x', 18)}</span><div class="body"><div class="t">לעצור את המילה</div><div class="m">מה שהרווחת נשאר</div></div></div>` : ''}
      <div class="list-row clickable" onclick="App.closeSheet(); ${def.libraryId ? `App.openPick(['${def.libraryId}'])` : `App.openWordWizard({title:'${esc(def.title).replace(/'/g, '&#39;')}', rule:'${esc(def.rule).replace(/'/g, '&#39;')}', icon:'${def.icon}', startDate:'${c.endDate >= Mila.today() ? Mila.addDays(c.endDate, 1) : Mila.today()}'})`}"><span class="tile sm lime">${icon('repeat', 18)}</span><div class="body"><div class="t">עוד סיבוב</div><div class="m">אותה מילה, 14 יום חדשים</div></div></div>`);
  }
  function endWord(id) {
    confirmSheet({ title: 'לעצור את המילה?', sub: 'מה שהרווחת נשאר. אפשר לתת אותה שוב מתי שתרצי.', okText: 'לעצור', okClass: 'pink', onOk: async () => { await Store().endCommitment(id); closeSheet(true); toast('נעצרה.'); render(); } });
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
        return `<div class="row-card" onclick="App.go('circle',{id:'${c.id}'})">${avatarStack(members, 34, 3)}<div class="body"><div class="t">${esc(c.name)}</div><div class="m">${hebrewPlural(words, 'מילה אחת', 'מילים')} · ${hebrewPlural(members.length, 'חברה אחת', 'חברות')}</div></div>${icon('chev', 20)}</div>`;
      }).join('') : `<div class="card empty"><span class="tile lg pink">${icon('users', 28)}</span><div class="t">נראה אותך עומדת בזה יותר ממני</div><div class="m">כל אחת בוחרת אתגרים משלה. מתחרות על התמדה.</div><div class="btn-row"><button class="btn primary" onclick="App.go('circleNew')">פותחת קבוצה</button><button class="btn ghost" onclick="App.joinByCodeSheet()">יש לי קוד מחברה</button></div></div>`}

      ${pendingPreview && pendingPreview.ok ? `<div class="section-title">באה איתי?</div>
        <div class="row-card" onclick="App.openInvite('${pending.token}')">${avatarStack([pendingPreview.inviter], 40, 1)}<div class="body"><div class="t">${esc(pendingPreview.inviter.name)} מזמינה אותך</div><div class="m">${esc(pendingPreview.circle.name)}${pendingPreview.sampleWord ? ` · ${esc(pendingPreview.sampleWord.title)}` : ''}</div></div>${icon('chev', 20)}</div>` : ''}

      ${proposals.length ? `<div class="section-title">מילים שמחכות לך</div>${proposals.map(({ d, c }) => `<div class="word-row" onclick="App.go('groupWord',{id:'${d.id}'})">${wordTile(d)}<div class="body"><div class="name">${esc(d.title)}</div><div class="meta"><span class="chip outline">${esc(c.name)}</span><span class="chip lav">${Mila.adopters(d.id).length} בפנים</span></div></div>${icon('chev', 18)}</div>`).join('')}` : ''}
`;
  };
  function circleAddSheet() {
    sheet(`<div class="sheet-title">מתחרות עם חברות</div>
      <div class="list-row clickable" onclick="App.closeSheet(); App.go('circleNew')"><span class="tile sm lime">${icon('plus', 18)}</span><div class="body"><div class="t">פותחת קבוצה חדשה</div><div class="m">ומזמינה חברות להתחרות איתך</div></div>${icon('chev', 18)}</div>
      <div class="list-row clickable" onclick="App.joinByCodeSheet()"><span class="tile sm pink">${icon('link', 18)}</span><div class="body"><div class="t">מצטרפת לקבוצה של חברה</div><div class="m">חברה שלחה לך קוד או קישור? מכניסים אותו כאן.</div></div>${icon('chev', 18)}</div>`);
  }
  function joinByCodeSheet() {
    sheet(`<div class="sheet-title">מצטרפת לקבוצה של חברה</div><div class="sheet-sub">מקלידים את הקוד מההודעה שקיבלת (6 תווים), או מדביקים את הקישור כולו.</div>
      <div class="input-row"><input class="input ltr" id="join-code" placeholder="ABC123" maxlength="200" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.15em;text-align:center"><button class="btn dark sm" onclick="App.joinByCode()">בדיקה</button></div>
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
      <div class="field"><label>מי יכולה לתת מילה לכולנו?</label><div class="seg"><button class="${cwiz.whoCanPropose === 'all' ? 'on' : ''}" onclick="App.cwSet('whoCanPropose','all'); App.refresh()">כולן</button><button class="${cwiz.whoCanPropose === 'admins' ? 'on' : ''}" onclick="App.cwSet('whoCanPropose','admins'); App.refresh()">מנהלות בלבד</button></div></div>
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
      case 'group_word_proposed': return `${n} נתנה מילה לכולנו: ${t}`;
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
    return `${canPropose ? `<button class="btn ghost mb" onclick="App.openGroupWizard('${id}')">${icon('plus', 20)} מילה לכולנו</button>` : ''}
      ${groupWords.length ? `<div class="section-title" style="margin-top:6px">אתגרים לכולנו</div>${groupWords.map(d => { const ad = Mila.adopters(d.id); const mine = Mila.myAdoption(d.id); const over = (d.endDate || '9999') < Mila.today(); return `<div class="word-row" onclick="App.go('groupWord',{id:'${d.id}'})">${wordTile(d)}<div class="body"><div class="name">${esc(d.title)}</div><div class="meta">${avatarStack(ad, 18, 4)} ${ad.length} בפנים ${mine ? '<span class="chip lime">את בפנים</span>' : over ? '<span class="chip">נגמרה</span>' : '<span class="chip lav">באה איתנו?</span>'}</div></div>${icon('chev', 18)}</div>`; }).join('')}` : ''}
      ${personal.length ? `<div class="section-title">האתגרים של החברות</div>${personal.map(d => { const k = Object.values(S.commitments).find(x => x.defId === d.id && x.status === 'active'); const u = Mila.user(d.ownerId); const st = k ? Mila.commitmentStats(k.id) : null; return `<div class="word-row" ${d.ownerId === Mila.me().id && k ? `onclick="App.go('word',{id:'${k.id}'})"` : ''}>${wordTile(d)}<div class="body"><div class="name">${esc(d.title)}</div><div class="meta">${avatar(u, 16)} ${esc(u.name)}${st && d.visibility === 'status' ? ` · ${st.success} הצלחות${st.current ? ` · ${st.current} ברצף` : ''}` : ''}</div></div></div>`; }).join('')}` : ''}
      ${!groupWords.length && !personal.length ? `<div class="empty"><span class="tile lg lime">${icon('pencil', 28)}</span><div class="t">עוד אין מילה לכולנו</div><div class="m">תני אחת. כל חברה בוחרת אם להצטרף.</div></div>` : ''}`;
  }
  function circleMembersView(id, members) {
    const meId = Mila.me().id; const admin = Mila.isAdmin(id); const c = Mila.getState().circles[id];
    return `<div class="card tight">${members.map(u => `<div class="list-row">${avatar(u, 40)}<div class="body"><div class="t">${esc(u.name)}${u.id === meId ? ' (את)' : ''}</div><div class="m">${u.role === 'admin' ? 'מנהלת' : 'חברה'} · מאז ${Mila.fmtDate(Mila.toLocalDate(new Date(u.joinedAt)))}</div></div>${u.id !== meId ? `<button class="icon-btn" aria-label="בטיחות" onclick="App.safetySheet('${u.id}','${id}')">${icon('shield', 20)}</button>` : ''}${admin && u.id !== meId ? `<button class="icon-btn" aria-label="הסרה" onclick="App.removeMember('${id}','${u.id}')">${icon('x', 20)}</button>` : ''}</div>`).join('')}</div>
      <button class="btn ghost mt" onclick="App.inviteFlow({ circleId: '${id}' })">${icon('share', 20)} להזמין חברה</button>
      <div class="tiny muted center mt">${members.length} מתוך ${c.maxMembers}</div>`;
  }
  function removeMember(circleId, userId) {
    const u = Mila.user(userId);
    confirmSheet({ title: `להסיר את ${u.name}?`, sub: 'היא לא תראה יותר את הקבוצה. הנקודות שלה נשארות שלה.', okText: 'להסיר', okClass: 'pink', onOk: async () => { await Store().removeMember(circleId, userId); closeSheet(true); render(); toast('הוסרה מהקבוצה'); } });
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
      ${c.whoCanPropose === 'all' || admin ? `<div class="list-row clickable" onclick="App.closeSheet(); App.openGroupWizard('${id}')"><span class="tile sm lav">${icon('pencil', 18)}</span><div class="body"><div class="t">מילה לכולנו</div><div class="m">כל חברה בוחרת אם להצטרף</div></div></div>` : ''}
      <div class="list-row clickable" onclick="App.closeSheet(); App.inviteFlow({ circleId: '${id}' })"><span class="tile sm lime">${icon('share', 18)}</span><div class="body"><div class="t">להזמין חברה</div><div class="m">קוד או קישור</div></div></div>
      ${admin ? `<div class="list-row clickable" onclick="App.closeSheet(); App.go('circleManage',{id:'${id}'})"><span class="tile sm lav">${icon('settings', 18)}</span><div class="body"><div class="t">ניהול</div><div class="m">שם, הרשאות, חברות</div></div></div>` : ''}
      <div class="list-row clickable" onclick="App.closeSheet(); App.safetySheet(null,'${id}')"><span class="tile sm gray">${icon('flag', 18)}</span><div class="body"><div class="t">דיווח</div><div class="m">תוכן פוגעני או לחץ</div></div></div>
      <div class="list-row clickable" onclick="App.leaveCircle('${id}')"><span class="tile sm pink">${icon('logout', 18)}</span><div class="body"><div class="t">לעזוב</div><div class="m">המילים שלך כאן ייעצרו</div></div></div>`);
  }
  function leaveCircle(id) {
    confirmSheet({ title: 'לעזוב?', sub: 'המילים שלך כאן ייעצרו. מה שהרווחת נשאר שלך.', okText: 'לעזוב', okClass: 'pink', onOk: async () => { await Store().leaveCircle(id); closeSheet(true); tab('circles'); toast('עזבת.'); } });
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
    follow: { emoji: '👀', title: 'שתראה אותי עומדת במילה שלי', what: 'היא מצטרפת לקבוצה ורואה כל יום אם עמדת. בלי אתגרים משלה.', step3: 'רואה את ההתקדמות שלך' },
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
        <div class="step-title">מה את רוצה שהיא תעשה?</div><div class="step-sub">בוחרים, ואז כותבים לה הודעה אישית.</div>
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
    if (!Mila.isAdmin(id)) return `${topbar({ title: 'ניהול' })}<div class="empty"><div class="t">רק מנהלת</div></div>`;
    const inv = Object.values(Mila.getState().invites).filter(i => i.circleId === id && i.status === 'active').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return `${topbar({ title: 'ניהול' })}
      <div class="field"><label>שם</label><input class="input" value="${esc(c.name)}" maxlength="50" onchange="App.cmSet('${id}','name',this.value)"></div>
      <div class="field"><label>תיאור</label><input class="input" value="${esc(c.description)}" maxlength="120" onchange="App.cmSet('${id}','description',this.value)"></div>
      <div class="field"><label>מי נותנת מילה לכולנו</label><div class="seg"><button class="${c.whoCanPropose === 'all' ? 'on' : ''}" onclick="App.cmSet('${id}','whoCanPropose','all')">כולן</button><button class="${c.whoCanPropose === 'admins' ? 'on' : ''}" onclick="App.cmSet('${id}','whoCanPropose','admins')">מנהלות בלבד</button></div></div>
      <div class="field"><label>מקסימום חברות</label><div class="chips">${[4, 6, 8, 12].map(n => `<button class="chip select ${c.maxMembers === n ? 'on' : ''}" onclick="App.cmSet('${id}','maxMembers',${n})">${n}</button>`).join('')}</div></div>
      <div class="card tight"><div class="card-title">קוד הזמנה</div>${inv ? `<div class="kv"><span class="k">קוד</span><span class="v" style="direction:ltr;letter-spacing:.15em">${inv.token || (inv.hint + '····')}</span></div><div class="kv"><span class="k">תוקף</span><span class="v">${Mila.fmtDate(Mila.toLocalDate(new Date(inv.expiresAt)))}</span></div><div class="kv"><span class="k">שימושים</span><span class="v">${inv.uses} / ${inv.maxUses}</span></div><div class="btn-row mt"><button class="btn soft sm" onclick="App.inviteSheet('${id}')">להזמין</button><button class="btn danger sm" onclick="App.rotateInvite('${id}')">קוד חדש</button></div>` : `<button class="btn soft sm" onclick="App.inviteSheet('${id}')">הנפקת קישור חדש</button>`}</div>`;
  };
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
        <ol class="inv-steps"><li>מצטרפת לקבוצה <b>${esc(p.circle.name)}</b> של ${esc(p.inviter.name)}.</li><li>${kind === 'follow' ? `רואה כל יום אם ${esc(p.inviter.name)} עומדת במילה שלה. בלי התחייבות.` : kind === 'compete' ? 'בוחרת עד 3 אתגרים משלך ל-14 יום.' : `מתחילה את האתגר <b>${esc(p.wordTitle || (p.challenge && p.challenge.title) || '')}</b> ל-14 יום.`}</li>${kind === 'follow' ? '' : '<li>נכנסת לדירוג ״מי מובילה?״.</li>'}</ol>
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
    return `${topbar({ title: 'מילה לכולנו', subtitle: c.name })}
      <div class="step-title">איזו מילה נותנות ביחד?</div><div class="step-sub">כל אחת נמדדת לבד. מתחרות על התמדה.</div>
      ${templateChips('gwTemplate', gwiz.title)}
      <div class="field"><label>המילה</label><input class="input" placeholder="למשל: 8,000 צעדים ביום" maxlength="60" value="${esc(gwiz.title)}" oninput="App.gwSet('title', this.value)"></div>
      <div class="field"><label>מה נחשב הצלחה?</label><textarea class="input" maxlength="200" placeholder="כלל שכולן יכולות למדוד" oninput="App.gwSet('rule', this.value)">${esc(gwiz.rule)}</textarea></div>
      <div class="field"><label>אייקון</label><div class="icon-picker">${Mila.WORD_ICONS.map(ic => `<span class="tile ${tileColorFor(gwiz.title || ic)} ${gwiz.icon === ic ? 'on' : ''}" onclick="App.gwSet('icon','${ic}'); App.refresh()">${icon(ic, 24)}</span>`).join('')}</div></div>
      <div class="field"><label>מתי מתחילים?</label>${opts.map(([d, l, m]) => `<div class="choice ${gwiz.startDate === d ? 'on' : ''}" onclick="App.gwSet('startDate','${d}'); App.refresh()"><span class="radio">${gwiz.startDate === d ? icon('check', 14) : ''}</span><div class="body"><div class="t">${l}</div><div class="m">${m}</div></div></div>`).join('')}</div>
      <div class="field"><label>מה רואות</label><div class="seg"><button class="${gwiz.visibility === 'status' ? 'on' : ''}" onclick="App.gwSet('visibility','status'); App.refresh()">כל יום</button><button class="${gwiz.visibility === 'summary' ? 'on' : ''}" onclick="App.gwSet('visibility','summary'); App.refresh()">רק בסוף</button></div></div>
      <div class="mt-lg"><button class="btn primary" onclick="App.gwPropose()">חותמת ומזמינה</button></div>
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
    if (!def || !Mila.isMember(def.circleId)) return `${topbar({ title: 'מילה' })}<div class="empty"><div class="t">לא שלך</div></div>`;
    const circle = Mila.getState().circles[def.circleId];
    const ad = Mila.adopters(id);
    const mine = Mila.myAdoption(id);
    const start = def.startDate < Mila.today() ? Mila.today() : def.startDate;
    const over = (def.endDate || '9999') < Mila.today();
    const cap = mine || over ? { ok: true } : Mila.capCheck(Mila.me().id, start);
    const owner = Mila.user(def.ownerId);
    const canCancel = !ad.length && (def.ownerId === Mila.me().id || Mila.isAdmin(def.circleId)) && def.status === 'proposed';
    return `${topbar({ title: 'מילה לכולנו', subtitle: circle.name })}
      <div class="sheet-hero">${wordTile(def, 'lg')}<div class="sheet-title">${esc(def.title)}</div><div class="sheet-sub" style="margin-bottom:8px">${esc(def.rule)}</div><div class="chips" style="justify-content:center"><span class="chip">${avatar(owner, 16)} ${esc(owner.name)} נתנה</span><span class="chip lav">${ad.length} בפנים</span>${mine ? '<span class="chip lime">את בפנים</span>' : ''}</div></div>
      ${fresh ? `<div class="note lime">${icon('sparkle', 18)}<span>החברות קיבלו הודעה.</span></div>` : ''}
      <div class="card tight">
        <div class="kv"><span class="k">${icon('calendar', 18)} הסבב</span><span class="v">${Mila.fmtDate(def.startDate)} – ${Mila.fmtDate(def.endDate)}</span></div>
        <div class="kv"><span class="k">${icon('star', 18)} נקודות</span><span class="v">נקודה לכל יום שעמדת בו</span></div>
        <div class="kv"><span class="k">${icon('flame', 18)} פספוס</span><span class="v">הרצף מתאפס</span></div>
        <div class="kv"><span class="k">${icon('eye', 18)} רואות</span><span class="v">${def.visibility === 'summary' ? 'רק בסוף' : 'כל יום'}</span></div>
      </div>
      ${ad.length ? `<div class="card tight"><div class="card-title">מי בפנים</div>${ad.map(u => { const st = Mila.commitmentStats(u.commitmentId); return `<div class="list-row">${avatar(u, 36)}<div class="body"><div class="t">${esc(u.name)}${u.id === Mila.me().id ? ' (את)' : ''}</div><div class="m">${st.resolved ? `${st.success} הצלחות${st.current ? ` · ${st.current} ברצף` : ''}` : 'עוד לא התחילה'}</div></div></div>`; }).join('')}</div>` : ''}
      ${mine ? `<button class="btn ghost" onclick="App.go('word',{id:'${mine.id}'})">המילה שלי כאן</button>` :
        over ? `<div class="note">${icon('info', 18)}<span>נגמרה. אפשר לתת אותה שוב לסבב הבא.</span></div>` :
        !cap.ok ? `<div class="note warn">${icon('info', 18)}<span>3 מילים כבר רצות אצלך בימים האלה (${cap.conflictingWords.map(w => esc(w.title)).join(', ')}).${cap.nextFree && cap.nextFree <= def.endDate ? ` פנוי מ-${Mila.fmtDate(cap.nextFree)}.` : ''}</span></div><button class="btn soft" disabled>אני בפנים · אין מקום</button>` :
        `<button class="btn primary" onclick="App.adoptSheet('${id}')">אני בפנים</button>`}
      ${canCancel ? `<button class="btn text mt" onclick="App.cancelProposal('${id}')">לבטל</button>` : ''}`;
  };
  function adoptSheet(id) {
    const def = Mila.wordDef(id); const start = def.startDate < Mila.today() ? Mila.today() : def.startDate;
    const end = def.endDate; const days = Mila.diffDays(start, end) + 1;
    sheet(`<div class="sheet-hero">${wordTile(def, 'lg')}<div class="sheet-title">אני בפנים?</div><div class="sheet-sub">${esc(def.title)} · ${days} ימים מ-${Mila.relDay(start)}</div></div>
      <div class="kv"><span class="k">${icon('star', 18)} נקודות</span><span class="v">עד ${days}</span></div>
      <div class="kv"><span class="k">${icon('eye', 18)} רואות</span><span class="v">${def.visibility === 'summary' ? 'רק בסוף' : 'כל יום'}</span></div>
      <div class="btn-row mt"><button class="btn soft" onclick="App.closeSheet()">הפעם לא</button><button class="btn primary" onclick="App.adopt('${id}')">חותמת על זה</button></div>`);
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
      ${hist.length ? `<div class="section-title">מילים שנשמרו</div>${hist.map(h => `<div class="word-row" onclick="App.go('summary',{id:'${h.id}'})">${wordTile(h.def, 'sm')}<div class="body"><div class="name">${esc(h.def.title)}</div><div class="meta">${Mila.fmtDate(h.startDate)} – ${Mila.fmtDate(h.endDate)} · ${h.stats.rate !== null ? pct(h.stats.rate) : ''}${h.status === 'ended_early' ? ' · נעצרה' : ''}</div></div>${icon('chev', 18)}</div>`).join('')}` : ''}
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
      ${list.length ? `<div class="card tight">${list.map(n => { const [i, c] = ic[n.type] || ['bell', 'gray']; const act = n.ref && n.ref.token ? `App.openInvite('${n.ref.token}')` : n.ref && n.ref.defId ? `App.go('groupWord',{id:'${n.ref.defId}'})` : n.ref && n.ref.circleId ? `App.go('circle',{id:'${n.ref.circleId}'})` : n.ref && n.ref.type ? `App.tab('me')` : ''; return `<div class="list-row ${act ? 'clickable' : ''}" ${act ? `onclick="${act}"` : ''}><span class="tile sm ${c}">${icon(i, 18)}</span><div class="body"><div class="t" style="${n.read ? 'font-weight:600' : ''}">${esc(n.title)}</div><div class="m">${esc(n.body || '')}${n.body ? ' · ' : ''}${timeAgo(n.createdAt)}</div></div>${act ? icon('chev', 18) : ''}</div>`; }).join('')}</div>` : `<div class="empty"><span class="tile lg sky">${icon('bell', 28)}</span><div class="t">שקט כאן</div><div class="m">הזמנות, מילים טובות והישגים.</div></div>`}`;
  };

  /* ============================================================
     S18 — הגדרות
     ============================================================ */
  SCREENS.settings = () => {
    const u = Mila.me(); const s = u.settings; const S = Mila.getState();
    const blocked = Mila.blockedUsers();
    const tog = (k, t, m) => `<div class="toggle-row"><div><div class="t">${t}</div><div class="m">${m}</div></div><button class="switch ${s[k] ? 'on' : ''}" role="switch" aria-checked="${!!s[k]}" onclick="App.setSetting('${k}', ${!s[k]})"></button></div>`;
    return `${topbar({ title: 'הגדרות' })}
      <div class="card tight clickable treat-entry" onclick="App.go('treat')"><div style="display:flex;align-items:center;gap:12px">${treatArt('espresso', 46)}<div style="flex:1"><div class="bold">להזמין את מרינה לקפה ☕</div><div class="small muted">האפליקציה נבנתה באהבה. פרגון קטן?</div></div>${icon('chev', 20)}</div></div>
      <div class="card tight"><div class="field" style="margin:6px 0 10px"><label>שם תצוגה</label><input class="input" value="${esc(u.name)}" maxlength="30" onchange="App.rename(this.value)"></div>
        <div class="kv"><span class="k">${icon('clock', 18)} אזור זמן</span><span class="v">${esc(u.timezone)}</span></div>
        <div class="kv"><span class="k">${icon('bell', 18)} שעת תזכורת</span><input class="input ltr" type="time" value="${s.reminderTime}" style="width:auto;padding:8px 12px" onchange="App.setSetting('reminderTime', this.value)"></div></div>
      <div class="card tight">${tog('pushReminders', 'תזכורת יומית', 'פעם ביום')}${tog('socialDigest', 'מה אצל החברות', 'סיכום יומי')}${tog('hideFromLeaderboard', 'בלי אותי בדירוג', 'משחקת, לא מתחרה')}${tog('lockScreenPrivacy', 'מסך נעילה דיסקרטי', 'בלי שמות של מילים')}</div>
      <div class="card tight"><div class="card-title">בטיחות</div>${blocked.length ? blocked.map(b => `<div class="list-row">${avatar(b, 32)}<div class="body"><div class="t">${esc(b.name)}</div><div class="m">חסומה</div></div><button class="btn xs soft" onclick="App.unblock('${b.id}')">ביטול חסימה</button></div>`).join('') : '<div class="small muted">אף אחת לא חסומה.</div>'}</div>
      <div class="card tight"><div class="card-title">איך זה עובד</div><div class="small muted">עד 3 אתגרים ל-14 יום. כל יום מדווחות: עמדתי או לא.<br>עמדת? נקודה. פספסת? הרצף של האתגר מתאפס, הנקודות נשארות.<br>הדירוג בקבוצה לפי אחוז ההתמדה, מ-${Mila.RULES.MIN_RANKED_EVENTS} דיווחים. בסוף 14 יום יש מנצחת.</div></div>
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
  function resetDemo() { confirmSheet({ title: 'לאפס את הדוגמה?', sub: 'חוזרות למסך הפתיחה.', okText: 'איפוס', okClass: 'pink', onOk: () => { Mila.reset(); closeSheet(true); go('welcome', {}, { reset: true }); } }); }
  function deleteAccount() { confirmSheet({ title: 'למחוק את החשבון?', sub: 'סופי. האתגרים, הדיווחים וההישגים נמחקים. בקבוצות נשאר רישום אנונימי.', okText: 'למחוק', okClass: 'danger', onOk: async () => { await Store().deleteAccount(); closeSheet(true); go('welcome', {}, { reset: true }); toast('נמחק.'); } }); }

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
    if (el) {
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      const burst = document.createElement('span'); burst.className = 'tc-burst'; burst.setAttribute('aria-hidden', 'true');
      burst.innerHTML = ['💛', '✨', kind === 'cookie' ? '🍪' : '☕', '💗', '✨', '💜'].map((e, i) => `<i style="--a:${-70 + i * 28}deg">${e}</i>`).join('');
      el.querySelector('.tc-art').appendChild(burst); setTimeout(() => burst.remove(), 1100);
    }
    setTimeout(() => sheet(`<div class="sheet-hero treat-sheet">${treatArt(kind, 120)}<div class="sheet-title">תודה! זה ממש משמח 💛</div><div class="sheet-sub">${t.name}</div></div>
      <div class="treat-amount"><span>בביט מקלידים</span><b>${t.price} ₪</b></div>
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
    if (token) { history.replaceState(null, '', location.pathname); }
    const authError = params.get('auth_error');
    if (authError) { history.replaceState(null, '', location.pathname); setTimeout(() => toast('הכניסה לא הושלמה. נסי שוב.'), 300); }
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
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (Api.isCloud()) Api.sync().catch(() => {}); else render(); } });
    window.addEventListener('online', () => { if (Api.isCloud()) Api.sync().then(() => toast('החיבור חזר. הכול מעודכן.', 'lime')).catch(() => {}); });
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  document.addEventListener('DOMContentLoaded', init);

  return {
    go, back, tab, refresh, closeSheet, toast, startDemo,
    suChange, suToggle, signup, googleSignIn, authSet, authToggle, termsSheet, completeProfile, signOut,
    setVisibility, react, sendEncouragement, rotateInvite, openInvite, rename, unblock, ideasCat: setIdeasCat, ideasToggle,
    reportSheet, confirmMiss, excuseSheet, doReport, correctionSheet, _corrPick, doCorrect,
    openWordWizard, wizSet, wizTemplate, wizNext, wizPrev, wizCancel, wizCommit, wordMenu, endWord,
    circleAddSheet, joinByCodeSheet, joinByCode, cwSet, cwCreate, setCircleTab, encourageSheet, circleMenu, leaveCircle, inviteSheet, shareInvite, copyText, removeMember, cmSet,
    acceptInvite, declineInvite, openGroupWizard, openPick, pickCat, pickToggle, pickClear, pickSet, pickReward, pickNext, pickBack, pickCancel, pickCustom, pickCommit, inviteFlow, invSet, invWord, invNewCircle, invNext, invBack, inviteClose, inviteDone, inviteRotate, inviteMsg, inviteSend, inviteFromWord, gwSet, gwTemplate, gwPropose, adoptSheet, adopt, cancelProposal,
    bankFilter: setBankFilter, treatPick, setSetting, exportData, resetDemo, deleteAccount, safetySheet, doReportAbuse, blockUser,
  };
})();
