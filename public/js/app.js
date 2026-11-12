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
  const ICON_HE = { walk: 'Walk', run: 'Run', dumbbell: 'Dumbbell', book: 'Book', noPhone: 'No phone', water: 'Water', sleep: 'Sleep', moon: 'Moon', noSugar: 'No sweets', leaf: 'Leaf', meditate: 'Meditation', pencil: 'Pencil', heart: 'Heart', smile: 'Smile', home: 'Home', users: 'Friends', coffee: 'Coffee', call: 'Call', tools: 'Tools', star: 'Star' };
  const TILE_COLORS = ['lime', 'pink', 'lav', 'mint', 'peach', 'sky'];
  const COLOR_TO_TILE = { lime: 'lime', pink: 'pink', lavender: 'lav', mint: 'mint', peach: 'peach', sky: 'sky' };
  const tileColorFor = (str) => TILE_COLORS[Mila.hashStr(str || '') % TILE_COLORS.length];
  const pct = (n) => `${Math.round(n * 100)}%`;
  const REACTION_ICON = { clap: 'clap', heart: 'heart', muscle: 'muscle', fire: 'flame', star: 'star' };
  const REACTION_LABEL = { clap: 'Well done', heart: 'Love it', muscle: 'Strong', fire: 'On fire', star: 'Star' };

  /* Store: אותו ממשק פעולות, שני מימושים – מקומי (דמו) או שרת (Supabase). */
  const Local = {};
  for (const k of ['updateSettings','setBirthDate','renameMe','updateCircle','leaveCircle','removeMember','setMemberRole','deleteCircle','cancelProposal','endCommitment','report','correct','encourage','sendEncouragement','block','unblock','reportAbuse','markAllRead','markSummarySeen','deleteAccount','acceptInvite','adoptGroupWord','proposeGroupWord','createPersonalWord','shareToCircle','createCircle','createInvite','previewInvite']) Local[k] = async (...a) => Mila[k](...a);
  Local.poke = async () => ({ sent: true });   // במצב מקומי אין למי לשלוח
  Local.inviteFriends = async () => ({ invited: 0 });   // במצב מקומי אין חברות אמיתיות להזמין
  Local.inviteToken = (circleId) => (Mila.currentInvite(circleId) || {}).token || null;
  Local.cachedPreview = (token) => Mila.previewInvite(token);
  Local.revokeCircleInvites = async (circleId) => { Mila.revokeCircleInvites(circleId); return Mila.createInvite(circleId); };
  /* מצב שהגיע מהשרת אבל אין חיבור פעיל (אין רשת, או שהכניסה פגה): לא כותבות ״מקומית״ — זה היה נראה כאילו נשמר ונעלם ברענון */
  const Blocked = new Proxy({}, { get: (_, k) => (k === 'inviteToken' || k === 'cachedPreview') ? () => null : async () => { const e = new Error('offline'); e.userMessage = "No connection to the server right now, so this wasn't saved. Try again when you're back online."; throw e; } });
  const Store = () => { if (Api.isCloud()) return Api.cloud; const m = Mila.getState().meta || {}; return Api.enabled && (m.cloud || m.offline) ? Blocked : Local; };
  /* נעילה מפני לחיצה כפולה: פעולה שכבר בדרך לשרת לא נשלחת שוב */
  let acting = false;
  const once = (fn) => async (...a) => { if (acting) return; acting = true; try { return await fn(...a); } finally { acting = false; } };
  const isCloud = () => Api.isCloud();
  let authForm = { name: '', age: false, terms: false };
  let busy = false;

  let stack = [];
  let wiz = null;        // אשף יצירת מילה
  let gwiz = null;       // אשף מילה קבוצתית
  let cwiz = null;       // יצירת קבוצה
  let pick = null;       // בחירת אתגרים מהספרייה
  let inv = null;        // גיליון הזמנה (סוג + הודעה)
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
  function tab(name) { stack = [{ name, params: {} }]; render(); window.scrollTo({ top: 0 }); FX.pop(document.querySelector('#nav button.on .ic'), 'fx-bounce'); }
  function current() { return stack[stack.length - 1]; }
  function sheetOpen() { return $('#sheet').classList.contains('open'); }

  /* ---------- מיקרו־אינטראקציות: קונפטי, קפיצה, רעד, ספירה, רטט קל ---------- */
  const FX = {
    reduced: () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches),
    buzz: (ms = 12) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } },
    center: (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; },
    confetti(x, y, { n = 18, power = 1, items = null } = {}) {
      if (FX.reduced()) return;
      const box = document.createElement('div'); box.className = 'fx-confetti'; box.style.left = x + 'px'; box.style.top = y + 'px';
      const cols = ['#DCF36E', '#FFD3E4', '#E3DAFB', '#FFD9C7', '#D5F1E3', '#1C1A1F'];
      box.innerHTML = Array.from({ length: n }, (_, i) => {
        const a = (Math.PI * 2 * i) / n + Math.random() * .5; const d = (60 + Math.random() * 70) * power;
        const dx = Math.cos(a) * d; const dy = Math.sin(a) * d - 40 * power;
        const st = `--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--r:${Math.round(Math.random() * 540 - 270)}deg;--c:${cols[i % cols.length]};--t:${(.7 + Math.random() * .4).toFixed(2)}s`;
        return items ? `<i class="em" style="${st}">${items[i % items.length]}</i>` : `<i class="${i % 3 ? 'sq' : 'ln'}" style="${st}"></i>`;
      }).join('');
      document.body.appendChild(box); setTimeout(() => box.remove(), 1300);
    },
    confettiAt(el, opts) { if (el) { const [x, y] = FX.center(el); FX.confetti(x, y, opts); } },
    pop(el, cls = 'fx-pop') { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); },
    countUp(el, ms = 650) {
      const to = Number(el.textContent) || 0; if (!to || FX.reduced()) return;
      const t0 = performance.now(); el.textContent = '0';
      const step = (t) => { const k = Math.min(1, (t - t0) / ms); el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    },
  };
  let lastScreen = null, countUpNext = true;
  function render({ keepSheet = false } = {}) {
    if (!keepSheet) closeSheet(true);
    Mila.refreshStatuses();
    const cur = current();
    const screen = SCREENS[cur.name];
    const root = $('#screen');
    let html;
    if (!screen) html = errorScreen('notfound');
    else { try { html = screen(cur.params); } catch (e) { console.error('render', cur.name, e); html = errorScreen('crash'); } }   // תקלה בציור מסך לא משאירה מסך לבן
    root.innerHTML = html;
    const isTop = TOP.includes(cur.name) && Mila.me();
    root.classList.toggle('no-nav', !isTop);
    document.body.classList.toggle('wide', cur.name === 'admin');
    $('#nav').classList.toggle('hidden', !isTop);
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === cur.name));
    if (lastScreen !== cur.name) { FX.pop(root, 'scr-in'); if (cur.name === 'today') countUpNext = true; }
    lastScreen = cur.name;
    a11yFix(root);
    if (POST[cur.name]) POST[cur.name](cur.params);
  }
  function refresh() { render(); }
  /* משיכה למטה בראש המסך מרעננת את הנתונים. באפליקציה המותקנת אין רענון של דפדפן, אז זה הרענון. */
  /* גרסה חדשה: אפליקציה מותקנת שנשארה פתוחה ברקע ממשיכה לרוץ עם הקוד הישן עד שנטענת מחדש.
     משוות את גרסאות הקבצים שבדף הפתוח לאלה שהשרת מגיש עכשיו. */
  async function newVersion() {
    try {
      const mine = [...document.querySelectorAll('script[src], link[rel="stylesheet"]')].map(e => (e.getAttribute('src') || e.getAttribute('href') || '')).filter(u => /\?v=/.test(u)).map(u => u.replace(/^\//, ''));
      if (!mine.length) return false;
      const r = await fetch('/?_=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return false;
      const html = await r.text(); if (!/js\/app\.js\?v=/.test(html)) return false;
      return mine.some(u => !html.includes(u));
    } catch (e) { return false; }
  }
  /* לא טוענות מחדש יותר מפעם בשתי דקות, כדי שלא תיווצר לולאה אם משהו בהשוואה משתבש */
  function reloadOnce() { try { const k = 'mila.reloaded'; const t = Number(sessionStorage.getItem(k) || 0); if (Date.now() - t < 120000) return false; sessionStorage.setItem(k, String(Date.now())); } catch (e) { /* בלי אחסון: טוענות */ } location.reload(); return true; }
  let lastVersionCheck = Date.now();
  async function updateIfIdle() {
    if (Date.now() - lastVersionCheck < 3 * 60000) return; lastVersionCheck = Date.now();
    const el = document.activeElement; const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
    if (typing || sheetOpen() || acting || !stack.length || !TOP.includes(current().name)) return;   // לא באמצע משהו
    if (await newVersion()) reloadOnce();
  }
  async function pullRefresh() {
    if (navigator.serviceWorker) navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
    if (await newVersion() && reloadOnce()) return new Promise(() => {});   // משיכה לרענון מביאה גם גרסה חדשה
    if (current().name === 'admin') { adminData = await Api.adminStats(adminDays); adminErr = null; render(); return; }
    if (Api.isCloud()) await Api.sync(); else render();
  }
  /* אייפון, אפליקציה מותקנת: אחרי שהמקלדת נסגרת (או כשחוזרים לאפליקציה) גובה המסך לפעמים ״נתקע״ בגובה שהיה עם המקלדת,
     ואז התפריט התחתון צף באמצע המסך. כותבות מחדש את הגדרת ה-viewport (אותו ערך) וזזות פיקסל הלוך וחזור:
     זה גורם לספארי לחשב את הגובה מחדש. רץ רק באייפון, ולא יותר מפעם ב-400 אלפיות שנייה. */
  let lastViewportFix = 0;
  function fixViewport() {
    const d = I() ? I().detect() : null; if (!d || d.os !== 'ios') return;
    const el = document.activeElement; if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;   // המקלדת פתוחה: לא נוגעות
    if (Date.now() - lastViewportFix < 400) return; lastViewportFix = Date.now();
    const vp = document.querySelector('meta[name="viewport"]');
    if (vp) { const c = vp.getAttribute('content'); vp.setAttribute('content', c + ', minimum-scale=1'); requestAnimationFrame(() => vp.setAttribute('content', c)); }
    const y = window.scrollY; window.scrollTo(0, y + 1); requestAnimationFrame(() => window.scrollTo(0, y));
  }
  function initViewportFix() {
    document.addEventListener('focusout', (e) => { if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) setTimeout(fixViewport, 180); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(fixViewport, 250); });
    window.addEventListener('pageshow', () => setTimeout(fixViewport, 250));
    window.addEventListener('orientationchange', () => setTimeout(fixViewport, 350));
    // המקלדת נסגרה: האזור הנראה גדל בחזרה
    if (window.visualViewport) { let h = window.visualViewport.height; window.visualViewport.addEventListener('resize', () => { const n = window.visualViewport.height; if (n > h + 80) setTimeout(fixViewport, 120); h = n; }); }
  }
  function initPull() {
    const el = document.createElement('div'); el.id = 'ptr'; el.setAttribute('aria-hidden', 'true'); el.innerHTML = `<span class="ptr-ic">${icon('refresh', 16)}</span><span class="ptr-t"></span>`; document.body.appendChild(el);
    const ic = el.firstChild, tx = el.lastChild;
    const MAX = 96, GO = 58; let y0 = null, x0 = 0, d = 0, pulling = false, busy = false;
    const set = (px, smooth) => {
      const f = Math.min(1, px / GO);   // הפס יורד מלמעלה עם האצבע, ונעצר כשהוא כולו בפנים
      el.classList.toggle('smooth', !!smooth); el.classList.toggle('on', px > 0); el.classList.toggle('ready', px >= GO);
      el.style.transform = `translate(-50%, ${-(1 - f) * 100}%)`; ic.style.transform = busy ? '' : `rotate(${Math.round(px * 3.2)}deg)`;
      if (px > 0) tx.textContent = busy ? 'Refreshing…' : px >= GO ? 'Release to refresh' : 'Pull to refresh';
    };
    const can = (e) => !busy && e.touches.length === 1 && window.scrollY <= 0 && stack.length && Mila.me() && !$('#sheet-backdrop').classList.contains('open') && !(e.target.closest && e.target.closest('input, textarea, select, [contenteditable]'));
    document.addEventListener('touchstart', (e) => { pulling = false; d = 0; if (can(e)) { y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; } else y0 = null; }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (y0 === null) return;
      const dy = e.touches[0].clientY - y0, dx = Math.abs(e.touches[0].clientX - x0);
      if (!pulling) {
        if (dy < -4 || dx > 14 || window.scrollY > 0) { y0 = null; return; }   // גלילה רגילה או החלקה הצידה: לא שלנו
        if (dy < 8 || dx > dy) return;
        pulling = true;
      }
      if (e.cancelable) e.preventDefault();
      const was = d; d = Math.min(MAX, Math.max(0, dy - 8) * .55);
      if (was < GO && d >= GO && navigator.vibrate) { try { navigator.vibrate(8); } catch (err) { /* ignore */ } }
      set(d);
    }, { passive: false });
    const run = async () => {
      busy = true; set(GO, true); el.classList.add('spin');
      const t = Date.now();
      try { await pullRefresh(); } catch (e) { if (!e || e.status !== 401) toast(e && e.code === 'OFFLINE' ? "No connection. Try again when you're back online." : "The refresh didn't work. Try again."); }
      const wait = 450 - (Date.now() - t); if (wait > 0) await new Promise(r => setTimeout(r, wait));
      el.classList.remove('spin'); busy = false; set(0, true);
    };
    const end = (go) => { if (y0 === null) return; y0 = null; if (!pulling) return; pulling = false; if (go && d >= GO) run(); else set(0, true); };
    document.addEventListener('touchend', () => end(true), { passive: true });
    document.addEventListener('touchcancel', () => end(false), { passive: true });
  }
  /* נגישות מקלדת וקוראי מסך: כל אלמנט לחיץ שאינו כפתור או קישור מקבל תפקיד, מקום בסדר הטאב והפעלה ב-Enter/רווח */
  function a11yFix(root) {
    root.querySelectorAll('[onclick]').forEach(el => {
      if (/^(BUTTON|A|INPUT|TEXTAREA|SELECT|LABEL)$/.test(el.tagName)) return;
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      const role = el.getAttribute('role') || (el.classList.contains('checkbox-row') || el.classList.contains('pick-row') ? 'checkbox' : el.querySelector(':scope > .radio') ? 'radio' : 'button');
      el.setAttribute('role', role);
      if (role === 'checkbox' || role === 'radio') el.setAttribute('aria-checked', String(el.classList.contains('on')));
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target; if (!t || !t.matches || !t.matches('[onclick][role]') || /^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    e.preventDefault(); t.click();
  });

  /* ---------- גיליון תחתון וטוסט ---------- */
  function sheet(html) {
    const el = $('#sheet');
    el.innerHTML = `<div class="sheet-handle"></div>${html}`;
    a11yFix(el);
    $('#sheet-backdrop').classList.add('open');
    requestAnimationFrame(() => { el.classList.add('open'); const f = el.querySelector('button, a[href], input, textarea, select'); if (f) { try { f.focus({ preventScroll: true }); } catch (e) { } } });
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
  function stamp(text, sub = '') {
    const el = document.createElement('div'); el.className = sub ? 'stamp with-sub' : 'stamp'; el.innerHTML = `<span>${esc(text)}</span>${sub ? `<p class="stamp-sub">${esc(sub)}</p>` : ''}`;
    document.body.appendChild(el); requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { FX.confetti(innerWidth / 2, innerHeight / 2, { n: 34, power: 1.6 }); FX.buzz(20); }, 260);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, sub ? 2600 : 1600);
  }
  function fail(e) {
    toast(e.userMessage || e.message || 'Something went wrong'); if (!e.userMessage) console.error(e);
    if (e && (e.code === 'QUOTA' || e.status >= 500)) Api.track(e.code === 'QUOTA' ? 'err:quota' : 'err:server');   // גם תקלה שהופיעה כהודעה קצרה נספרת באנליטיקה
  }
  function confirmSheet({ title, sub, okText = 'OK', okClass = 'dark', onOk, cancelText = 'Cancel' }) {
    sheet(`<div class="sheet-title">${esc(title)}</div><div class="sheet-sub">${sub || ''}</div>
      <div class="btn-row"><button class="btn soft" onclick="App.closeSheet()">${esc(cancelText)}</button><button class="btn ${okClass}" id="sheet-ok">${esc(okText)}</button></div>`);
    $('#sheet-ok').onclick = async () => { try { await onOk(); } catch (e) { fail(e); } };
  }

  /* ---------- רכיבים משותפים ---------- */
  function topbar({ title, subtitle = '', back: hasBack = true, end = '', start = '' }) {
    return `<div class="topbar">
      <div class="topbar-side">${hasBack ? `<button class="icon-btn" aria-label="Back" onclick="App.back()">${icon('back', 24)}</button>` : start}</div>
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
    <div class="legend"><span><i style="background:var(--lime)"></i>Kept it</span><span><i style="background:var(--pink)"></i>Missed</span><span><i style="background:var(--lav)"></i>Day off</span><span><i style="background:#F4F1F3"></i>Not yet</span></div>`;
  }
  /* רעיונות למילה: תחומים כטאבים, רק התחום הפתוח מוצג, ואחרי בחירה הכול מתקפל לשורה אחת */
  let ideasCat = 0; let ideasOpen = true;
  function templateChips(handler, selectedTitle) {
    const cats = [...new Set(Mila.TEMPLATES.filter(t => !t.sensitive || Mila.isAdult()).map(t => t.cat))];
    if (selectedTitle && !ideasOpen) {
      return `<div class="ideas collapsed mb"><span class="small">${icon('check', 14)} <b>${esc(selectedTitle)}</b></span><button class="btn text xs" onclick="App.ideasToggle(true)">Another idea</button></div>`;
    }
    if (!ideasOpen) return `<button class="btn text xs ideas-open" onclick="App.ideasToggle(true)">${icon('sparkle', 15)} Need an idea?</button>`;
    const cat = cats[Math.min(ideasCat, cats.length - 1)];
    return `<div class="ideas mb">
      <div class="ideas-head"><span class="bold small">Ideas</span><button class="btn text xs" onclick="App.ideasToggle(false)">Close</button></div>
      <div class="chips scroll ideas-cats">${cats.map((c, i) => `<button class="chip ${c === cat ? 'lime' : ''}" onclick="App.ideasCat(${i})">${esc(c)}</button>`).join('')}</div>
      <div class="chips">${Mila.TEMPLATES.map((t, i) => t.cat === cat ? `<button class="chip select ${selectedTitle === t.title ? 'on' : ''}" onclick="App.${handler}(${i})">${icon(t.icon, 15)} ${esc(t.title)}</button>` : '').join('')}</div>
    </div>`;
  }
  function setIdeasCat(i) { ideasCat = i; ideasOpen = true; render(); }
  function ideasToggle(open) { ideasOpen = open; render(); }
  /* מצב ריק אחיד: פרצוף, משפט אחד שמסביר, ופעולה אחת (אם יש מה לעשות) */
  function emptyState({ mood = 'sleepy', title, text = '', actions = '', card = true }) {
    return `<div class="${card ? 'card ' : ''}empty es">${moodFace(mood, 72)}<div class="t">${title}</div>${text ? `<div class="m">${text}</div>` : ''}${actions ? `<div class="btn-row">${actions}</div>` : ''}</div>`;
  }
  const backBtn = (label = 'Back') => `<button class="btn soft" onclick="App.back()">${label}</button>`;
  /* מסך שגיאה מלא: מה קרה, ומה עושים עכשיו. בלי קודי שגיאה ובלי התנצלויות. */
  const ERRORS = {
    offline: ['offline', "No connection right now", "Check that you're online, then we'll try again. Your check-ins so far are saved."],
    server: ['oops', "Something went wrong on our side", "It's not you. Try again in a moment."],
    quota: ['sleepy', "It's busy right now", "A lot of people are coming in right now. Try again a little later. Your check-ins are saved."],
    crash: ['oops', 'This screen got stuck', 'You can go back to Today, or reload Mila.'],
    notfound: ['oops', "We couldn't find this screen", "The link may be old."],
  };
  function errorScreen(kind = 'crash') {
    const [mood, title, text] = ERRORS[kind] || ERRORS.crash;
    if (kind !== 'offline' && ERRORS[kind]) { try { Api.track('err:' + kind); } catch (e) { /* מעקב בלבד */ } }
    const home = Mila.me() && (kind === 'crash' || kind === 'notfound');
    return `<div class="err-screen" role="alert">${moodFace(mood, 104)}<h1>${title}</h1><p>${text}</p>
      <div class="err-actions">${home ? `<button class="btn primary" onclick="App.tab('today')">Back to Today</button><button class="btn text" onclick="App.retry()">Reload</button>` : `<button class="btn primary" onclick="App.retry()">Try again</button>`}</div></div>`;
  }
  function retry() { location.reload(); }
  function hebrewPlural(n, one, many) { return n === 1 ? one : `${n} ${many}`; }

  /* ============================================================
     S01 — פתיחה
     ============================================================ */
  const SCREENS = {};
  SCREENS.error = ({ kind } = {}) => errorScreen(kind);
  const POST = {};

  /* הבטחות מתחלפות במסך הפתיחה: יומיומיות, בגוף ראשון */
  const PROMISES = [
    "OK, starting today I don't touch my phone when I'm with the kids.",
    "OK, starting today I don't order takeout.",
    "OK, starting today I'm in bed by 10pm.",
    'OK, starting today 8,000 steps a day.',
    'OK, starting today no sweets after dinner.',
    "OK, starting today I don't yell at the kids.",
  ];
  SCREENS.welcome = () => {
    const cta = Api.enabled ? `<button class="btn dark hero-btn" onclick="App.googleSignIn()">${googleMark()} ${invitePeek && invitePeek.ok ? "I'm in" : "I'm in"}</button>` : `<button class="btn dark hero-btn" onclick="App.go('signup')">I'm in</button>`;
    /* מסך פתיחה מצומצם: לוגו חי, משפט אחד, הבטחה מתחלפת, כפתור. */
    return `
    <div class="hero w2">
      <div class="hero-blobs" aria-hidden="true"><i></i><i></i><i></i></div>
      ${invitePeek && invitePeek.ok ? `<div class="w2-main">
        <div class="w2-brand w2-brand-sm">${liveLogo(30)} Mila.</div>
        <div class="w2-invite">${inviteHero(invitePeek)}</div>
      </div>` : `<div class="w2-main">
        <div class="w2-logo">${liveLogo(76)}</div>
        <div class="w2-brand">Mila.</div>
        <h1 class="w2-h"><span>We all make promises.</span><span>Let's see who <mark>keeps them</mark>.</span></h1>
        <div class="w2-rot" aria-hidden="true">${PROMISES.map((t, i) => `<span style="--i:${i}">${t}</span>`).join('')}</div>
      </div>
      ${pendingInviteToken ? `<div class="invited-banner w2-inv">A friend invited you to their group. Sign in with Google and you're in.</div>` : ''}`}
      <div class="hero-cta w2-cta">${cta}
        <button class="btn text" onclick="App.howSheet()">How does it work?</button>
        <div class="disclaimer">Sign in with Google · Free · Beta</div>
        ${Api.enabled && Api.config && Api.config.env === 'staging' ? `<button class="btn text sm" onclick="App.tryNow()">Try it now with a test account</button>` : ''}
        <nav class="legal-links" aria-label="Legal information"><a href="/accessibility">Accessibility</a><a href="/privacy">Privacy</a><a href="/terms">Terms of Use</a></nav>
      </div>
    </div>`;
  };

  /* ״איך זה עובד?״ — הסבר קצר במקום דוגמה */
  function howSheet() {
    const cta = Api.enabled ? `<button class="btn dark" onclick="App.closeSheet(); App.googleSignIn()">${googleMark()} I'm in</button>` : `<button class="btn dark" onclick="App.closeSheet(); App.go('signup')">I'm in</button>`;
    sheet(`<div class="how">
      <div class="sheet-title">How does it work?</div>
      <ol class="how-steps">
        <li><b>1</b><div><div class="t">Pick up to 3 things to stick to</div><div class="m">For 14 days. For example: no phone when the kids are with you.</div></div></li>
        <li><b>2</b><div><div class="t">Every evening, mark it: kept it or not</div><div class="m">Two seconds. Mila reminds you.</div></div></li>
        <li><b>3</b><div><div class="t">Your friends can see</div><div class="m">They cheer, encourage, and compete with you on sticking with it.</div></div></li>
      </ol>
      <div class="how-why"><div class="t">Why does it work?</div><p>Because when someone can see, it's much harder to give up. And 14 days is short enough to start, and long enough to become a habit.</p></div>
      ${cta}
    </div>`);
  }

  /* ============================================================
     S02 — הרשמה
     ============================================================ */
  let signupForm = { name: '', age: false, terms: false };
  SCREENS.signup = () => `
    ${topbar({ title: '' })}
    <div class="step-title">What's your name?</div>
    <div class="step-sub">This is how your friends will see you.</div>
    <div class="field"><input class="input" id="su-name" placeholder="Display name" value="${esc(signupForm.name)}" autocomplete="given-name" maxlength="30" oninput="App.suChange('name', this.value)"></div>
    <div class="checkbox-row ${signupForm.terms ? 'on' : ''}" onclick="App.suToggle('terms')"><span class="box">${signupForm.terms ? icon('check', 16) : ''}</span><span>Got it: game points, no real money.</span></div>
    <div class="mt-lg"><button class="btn primary" id="su-go" ${signupForm.name.trim() && signupForm.terms ? '' : 'disabled'} onclick="App.signup()">Continue</button></div>`;
  function suChange(k, v) { signupForm[k] = v; $('#su-go').disabled = !(signupForm.name.trim() && signupForm.terms); }
  function suToggle(k) { signupForm[k] = !signupForm[k]; render(); setTimeout(() => { const i = $('#su-name'); if (i && !signupForm.name) i.focus(); }, 0); }
  function signup() {
    const u = Mila.createUser({ name: signupForm.name, ageConfirmed: true });
    Mila.getState().me = u.id; Mila.save();
    const token = pendingInviteToken; pendingInviteToken = null;
    if (token) { go('today', {}, { reset: true }); openInvite(token); }
    else { ob = { step: 2, picks: [], friend: null }; go('onboard', {}, { reset: true }); }
  }
  let pendingInviteToken = null;
  let invitePeek = null;   // מי מזמינה ולאיזו קבוצה (נטען מהשרת לפי הקוד, לפני הכניסה)
  let lostOnce = false;   // כדי ש״החיבור פג״ יוצג פעם אחת, ולא בזמן יציאה יזומה
  /* קישור הזמנה שנפתח נשמר במכשיר עד שהיא מצטרפת או מוותרת (עד 7 ימים): רענון, סגירת הלשונית או כניסה שנכשלה לא מאבדים אותו */
  const INVITE_KEY = 'mila.invite';
  const saveInvite = (token) => { try { localStorage.setItem(INVITE_KEY, JSON.stringify({ token, at: Date.now() })); } catch (e) { /* בלי אחסון: נשאר רק בזיכרון */ } };
  const savedInvite = () => { try { const v = JSON.parse(localStorage.getItem(INVITE_KEY) || 'null'); return v && /^[A-Za-z0-9]{4,12}$/.test(v.token || '') && Date.now() - v.at < 7 * 86400000 ? v.token : null; } catch (e) { return null; } };
  const clearInvite = () => { invitePeek = null; try { localStorage.removeItem(INVITE_KEY); } catch (e) { /* ignore */ } };   // ההזמנה מומשה או בוטלה: גם ״מי הזמינה״ לא מוצג יותר
  /* ״מי הזמינה אותי״ לפני הכניסה: נטען מהשרת לפי הקוד, ומוצג במסך הפתיחה ובשלב השם */
  function loadInvitePeek(token) {
    if (!token || !Api.enabled) return;
    Api.peekInvite(token).then(p => {
      if (p && p.busy) return;                                   // עומס רגעי: נשארות עם הנוסח הכללי
      invitePeek = p && p.ok ? p : null;
      if (!invitePeek) { clearInvite(); if (pendingInviteToken === token) pendingInviteToken = null; }   // הקישור כבר לא בתוקף
      if (stack.length && ['welcome', 'profile'].includes(current().name) && !sheetOpen()) { const el = document.activeElement; const typing = el && el.id === 'pf-name'; if (!typing) render(); }
    }).catch(() => {});
  }
  const INVITE_WHAT = {
    follow: (p) => `wants you to help them keep their word.`,
    compete: (p) => `wants to see which of you sticks with it longer.`,
    same: (p) => p.wordTitle ? `wants you to do this together: ${esc(p.wordTitle)}.` : `wants you to do the same challenge together.`,
  };
  /* ״יעל מזמינה אותך״: מי, לאיזו קבוצה, ומה היא כתבה. משותף למסך הפתיחה ולמסך ההצטרפות */
  function inviteHero(p, { what = true } = {}) {
    const name = esc(String(p.inviter.name || '').split(' ')[0]);
    return `${avatar(p.inviter, 76)}
      <h1 class="inv-h"><b>${name}</b> is inviting you</h1>
      <div class="inv-g">to the group “${esc(p.circleName)}”${p.members > 1 ? ` · ${p.members} friends` : ''}</div>
      ${p.message ? `<div class="inv-bubble">${esc(p.message)}</div>` : ''}
      ${what ? `<div class="inv-what">${name} ${(INVITE_WHAT[p.kind] || INVITE_WHAT.follow)(p)}</div>` : ''}`;
  }

  /* ============================================================
     S02b — כניסה אמיתית: Google OAuth (השרת מנהל את הסשן בעוגיית HttpOnly)
     ============================================================ */
  function googleMark() { return `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.2-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41.4 35 44 30 44 24c0-1.2-.1-2.4-.4-3.5z"/></svg>`; }
  function googleSignIn(here) {
    if (!Api.config.google) return toast("Sign in with Google isn't set up in this environment yet");
    const next = pendingInviteToken ? `/?invite=${encodeURIComponent(pendingInviteToken)}` : '/';
    const d = I() ? I().detect() : null;
    if (d && d.inapp && here !== true) return inappSheet(d, next);   // בתוך אינסטגרם/פייסבוק: קודם מציעות את הדפדפן הרגיל
    location.href = Api.googleUrl(next);   // הלחיצה נספרת בשרת
  }
  /* נפתחה מתוך אפליקציה אחרת (אינסטגרם, פייסבוק, לינקדאין…): שם הכניסה עם Google לפעמים נחסמת, ובדרך כלל היא גם לא מחוברת שם ל-Google.
     מציעות לפתוח בדפדפן הרגיל בלחיצה אחת (הקישור שומר על ההזמנה), ומשאירות אפשרות להמשיך מכאן. */
  function inappSheet(d, next) {
    const link = location.origin + next; const ios = d.os === 'ios';
    const href = ios ? `x-safari-${link}` : `intent://${location.host}${next}#Intent;scheme=https;package=com.android.chrome;end`;
    sheet(`<button class="icon-btn sheet-x" aria-label="Close" onclick="App.closeSheet()">${icon('x', 22)}</button>
      <div class="sheet-title">You're inside ${esc(d.inapp)}</div>
      <div class="sheet-sub">Sign in with Google is sometimes blocked from here. In your regular browser it works, and takes 10 seconds.</div>
      <a class="btn dark" href="${esc(href)}" onclick="Api.track('inapp_open')">Open in ${ios ? 'Safari' : 'Chrome'}</a>
      <button class="btn soft mt" onclick="App.copyText('${esc(link)}')">${icon('copy', 18)} Copy link</button>
      <button class="btn text mt" onclick="App.googleSignIn(true)">Continue here</button>`);
  }
  /* Staging only: a throwaway test account, so the edition can be tried before Google sign-in is set up for it.
     The server accepts this only where ALLOW_TEST_LOGIN is on (never in production). */
  async function tryNow() {
    try {
      const r = await fetch('/api/auth/test-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `try.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@test.mila`, name: 'Alex' }) });
      if (!r.ok) throw new Error('test-login');
      location.reload();
    } catch (e) { toast('Test accounts are not available here.'); }
  }
  function afterAuth() {
    busy = false;
    Api.startAutoSync();
    const token = pendingInviteToken; pendingInviteToken = null;
    const first = !Mila.activeCommitments().length && !Mila.myCircles().length;
    if (first && !token) { ob = { step: 2, picks: [], friend: null }; go('onboard', {}, { reset: true }); return; }
    go('today', {}, { reset: true });
    if (token) openInvite(token);
  }
  /* השלמת פרופיל אחרי הכניסה הראשונה: שם והסכמה לתנאים */
  const obDots = (n) => `<div class="ob-dots" role="img" aria-label="Step ${n} of 3">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;
  SCREENS.profile = () => {
    const agreed = authForm.terms;
    return `<div class="ob">
      ${obDots(1)}
      <div class="ob-hero">${liveLogo(72)}</div>
      <h1 class="ob-title">Nice to meet you!<br>What's your name?</h1>
      <p class="ob-sub">${invitePeek && invitePeek.ok ? `<b>${esc(invitePeek.inviter.name)}</b> is waiting for you in the group “${esc(invitePeek.circleName)}”. This is how they'll see you.` : 'This is how your friends will see you.'}</p>
      <input class="input ob-input" id="pf-name" placeholder="Your name" maxlength="30" value="${esc(authForm.name || (Api.me && Api.me.name) || '')}" oninput="App.authSet('name', this.value)">
      <div class="checkbox-row ob-agree ${agreed ? 'on' : ''}" role="presentation" tabindex="-1" onclick="App.authAgree()"><span class="box" role="checkbox" tabindex="0" aria-checked="${agreed}" aria-labelledby="agree-text" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();App.authAgree()}">${agreed ? icon('check', 16) : ''}</span><span id="agree-text">I agree to the Terms of Use and the Privacy Policy</span></div>
      <div class="ob-legal">Read: <a href="/terms" target="_blank" rel="noopener">Terms of Use</a> · <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a></div>
      <div class="ob-foot"><button class="btn primary" id="pf-go" ${busy ? 'disabled' : ''} onclick="App.completeProfile()">${busy ? 'One moment…' : 'Continue'}</button>
      <button class="btn text" onclick="App.signOut()">Sign out</button></div>
    </div>`;
  };
  function authAgree() { const kb = document.activeElement && document.activeElement.matches && document.activeElement.matches('.ob-agree .box'); const v = !authForm.terms; authForm.age = v; authForm.terms = v; render(); if (kb) { const b = document.querySelector('.ob-agree .box'); if (b) b.focus(); } }
  function authSet(k, v) { authForm[k] = v; }
  async function completeProfile() {
    if (busy) return;
    const name = (authForm.name || (Api.me && Api.me.name) || '').trim();
    if (!name) return toast('Add a display name');
    if (!authForm.terms) return toast('Tick the box to agree to the Terms of Use and the Privacy Policy');
    busy = true; render();
    try { await Api.completeProfile({ name, ageConfirmed: true, termsAccepted: true, inviteToken: pendingInviteToken }); afterAuth(); }
    catch (e) { busy = false; fail(e); render(); }
  }
  async function signOut() { lostOnce = true; try { if (window.MilaInstall) await MilaInstall.onSignOut(); await Api.signOut(); } catch (e) { /* ignore */ } stack = []; pendingInviteToken = null; clearInvite(); go('welcome', {}, { reset: true }); lostOnce = false; }

  /* ============================================================
     S03 — התחלת משחק
     ============================================================ */
  /* ============================================================
     אונבורדינג: 3 שלבים קצרים — שם · הבטחה ראשונה · לבד או עם חברה
     ============================================================ */
  let ob = null;
  const OB_PICKS = ['fam_no_phone_kids', 'food_no_choc_20', 'hab_no_insta_bed', 'move_walk_anyway', 'move_bed_22', 'hab_zero_cart'];
  SCREENS.onboard = () => {
    if (!ob) ob = { step: 2, picks: [], friend: null };
    const L = Mila.LIBRARY; const first = (Mila.me().name || '').split(' ')[0];
    if (ob.step === 2) {
      const n = ob.picks.length;
      return `<div class="ob ob-in">
        ${obDots(2)}
        <h1 class="ob-title ob-title-sm ob-title-gap">${esc(first)},<br>give your word<br>to stick to…</h1>
        <div class="ob-grid">${OB_PICKS.map((id, i) => { const ch = L.get(id); const on = ob.picks.includes(id); return `<button class="ob-pick ${on ? 'on' : ''}" style="--i:${i}" onclick="App.obToggle('${id}')"><span class="ic">${icon(ch.icon || 'leaf', 22)}</span><span class="t">${esc(ch.title)}</span></button>`; }).join('')}</div>
        <button class="btn text ob-more" onclick="App.obMore()">${L.CHALLENGES.length - OB_PICKS.length} more ideas, or your own challenge ›</button>
        <div class="ob-foot"><button class="btn primary" ${n ? '' : 'disabled'} onclick="App.obNext()">${n ? `Continue with ${n === 1 ? '1 challenge' : `${n} challenges`}` : 'Pick at least one'}</button>
        <div class="ob-links"><button class="btn text" onclick="App.joinByCodeSheet()">I have a code from a friend</button><button class="btn text" onclick="App.obSkip()">Take a look first</button></div></div>
      </div>`;
    }
    return `<div class="ob ob-in">
      ${obDots(3)}
      <h1 class="ob-title">On your own, or with a friend?</h1>
      <p class="ob-sub">With a friend it's much easier to keep your word. And more fun.</p>
      <button class="ob-choice ${ob.friend === true ? 'on' : ''}" onclick="App.obFriend(true)"><span class="ic">${icon('users', 24)}</span><span><b>With a friend</b><small>Start a group and send them an invite on WhatsApp</small></span></button>
      <button class="ob-choice ${ob.friend === false ? 'on' : ''}" onclick="App.obFriend(false)"><span class="ic">${icon('user', 24)}</span><span><b>On my own for now</b><small>You can invite friends any time</small></span></button>
      <div class="ob-foot"><button class="btn primary ob-go" ${ob.friend === null || busy ? 'disabled' : ''} onclick="App.obCommit()">${busy ? 'One moment…' : 'Give my word'}</button>
      <button class="btn text" onclick="App.obBack()">Back</button></div>
    </div>`;
  };
  function obToggle(id) {
    const i = ob.picks.indexOf(id);
    const adding = i < 0;
    if (i >= 0) ob.picks.splice(i, 1); else { if (ob.picks.length >= Mila.RULES.DAILY_CAP) { FX.pop(document.querySelector('.ob-grid'), 'fx-shake'); return toast('Up to 3 challenges. You can remove one and pick another.'); } ob.picks.push(id); }
    render();
    if (adding) { FX.buzz(8); FX.confettiAt(document.querySelector(`.ob-pick[onclick*="${id}"] .ic`), { n: 8, power: .55 }); }
  }
  function obNext() { if (!ob.picks.length) return; ob.step = 3; render(); window.scrollTo({ top: 0 }); }
  function obBack() { ob.step = 2; render(); }
  function obFriend(v) { ob.friend = v; render(); }
  function obSkip() { ob = null; go('today', {}, { reset: true }); }
  function obMore() { const picks = ob.picks.slice(); ob = null; openPick(picks); }
  async function obCommit() {
    if (busy || !ob || ob.friend === null) return;
    busy = true; render();
    try {
      // מה שכבר נוצר נזכר ב-ob, כך שניסיון חוזר אחרי תקלה ממשיך מאותה נקודה ולא יוצר קבוצה ואתגרים כפולים
      if (ob.friend && !ob.circleId) { const { circle } = await Store().createCircle({ name: `${(Mila.me().name || '').split(' ')[0]}'s group`, description: '', whoCanPropose: 'all', maxMembers: 8, color: 'pink' }); ob.circleId = circle.id; }
      const circleId = ob.friend ? ob.circleId : null;
      ob.done = ob.done || 0;
      for (const id of [...ob.picks]) { await Store().createPersonalWord({ libraryId: id, startDate: Mila.today(), circleId, reward: '', shareSensitive: false }); ob.picks = ob.picks.filter(x => x !== id); ob.done++; }
      const n = ob.done; const friend = ob.friend; ob = null; busy = false;
      stack = [{ name: 'today', params: {} }]; render();
      stamp(n === 1 ? 'I gave my word.' : `${n} challenges. I gave my word.`, '14 days. Every evening, just mark whether you kept it.');
      // ישר להודעה המוכנה לחברה (בלי שלב הבחירות): ״בואי תראי אם עמדתי במילה שלי״
      if (friend && circleId) setTimeout(() => { inviteFlow({ circleId, kind: 'follow', created: true }); inv.step = 2; render(); }, 2700);
      else afterFirstCommit();
    } catch (e) { busy = false; render(); fail(e); }
  }

  /* ============================================================
     S04 — היום שלי
     ============================================================ */
  POST.today = () => { if (countUpNext) { countUpNext = false; document.querySelectorAll('.stats-line b').forEach(b => FX.countUp(b)); } };
  SCREENS.today = () => {
    const u = Mila.me();
    if (!u) return SCREENS.welcome();
    const hour = new Date().getHours();
    const greet = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 21 ? 'Good evening' : 'Good evening';
    const allCards = Mila.todayCards();
    const byK = new Map();
    for (const x of allCards) { const cur = byK.get(x.commitmentId); const pending = x.late && !x.outcome; if (!cur || (pending && !(cur.late && !cur.outcome))) byK.set(x.commitmentId, x); }
    const cards = [...byK.values()];
    const active = Mila.activeCommitments();
    const bank = Mila.bankSummary();
    const unread = Mila.unreadCount();
    const pendingSum = Mila.pendingSummaries();
    const digest = Mila.myFeedDigest(2);
    const upcoming = Mila.upcomingWords();
    // סבב "ראשי" להצגה בטבעת: ההתחייבות הפעילה עם הכי הרבה ימים שעברו
    const main = active.map(c => ({ c, st: Mila.commitmentStats(c.id) })).sort((a, b) => b.st.dayIndex - a.st.dayIndex)[0];
    // אתגר משותף שחברה פתחה ועוד לא הצטרפתי אליו
    const sharedWaiting = Mila.myCircles().flatMap(c => Object.values(Mila.getState().wordDefs).filter(d => d.circleId === c.id && d.kind === 'group' && d.status !== 'cancelled' && (d.endDate || '9999') >= Mila.today() && !Mila.myAdoption(d.id) && d.ownerId !== u.id && Mila.adopters(d.id).length > 0));
    // ימים פתוחים מאתמול מוצגים בנפרד, בכותרת משלהם (ולא עם תווית על כל שורה)
    const lateCards = cards.filter(x => x.late && !x.outcome); const nowCards = cards.filter(x => !(x.late && !x.outcome));
    const fresh = !active.length && !upcoming.length; // עוד לא בחרה אף אתגר
    const bestStreak = Math.max(0, ...active.map(c => Mila.streak(c.id).current));
    const rankAll = Mila.myCircles().map(c => ({ c, ri: Mila.rankInsight(c.id) })).filter(x => x.ri);
    const rankCircle = rankAll.find(x => x.ri.place) || rankAll[0];

    return `
      <div class="today-head">
        <div class="th-brand">${liveLogo(30)}<span>Mila.</span></div>
        <div class="th-actions">
          <button class="icon-btn" aria-label="Updates" onclick="App.go('notifications')">${icon('bell', 24)}${unread ? '<span class="badge-dot"></span>' : ''}</button>
          <button class="th-me" aria-label="My profile" onclick="App.tab('me')">${esc(((u.name || '').trim()[0]) || '?')}</button>
        </div>
      </div>
      <div class="greeting"><div><div class="hello">${greet}, ${esc((u.name || '').split(' ')[0])} ${icon(hour >= 17 || hour < 5 ? 'moon' : 'sun', 22)}</div><div class="sub">${fresh ? "Let's start." : todaySubtitle(cards)}</div>${main ? `<div class="stats-line"><span>Day <b>${main.st.dayIndex}</b></span><span><b>${bank.earnedCurrentRound}</b> ${bank.earnedCurrentRound === 1 ? 'point' : 'points'}</span>${bestStreak >= 2 ? `<span><b>${bestStreak}</b> days in a row</span>` : ''}</div>` : ''}</div></div>
      ${installCard()}
      ${Mila.getState().meta.demo ? `<div class="demo-banner"><span>This is a demo with made-up friends.</span><button class="btn dark sm" onclick="App.exitDemo()">Exit demo</button></div>` : ''}



      ${pendingSum.length ? pendingSum.slice(0, 1).map(c => `<div class="card pastel-lav clickable tight" onclick="App.go('summary',{id:'${c.id}'})"><div style="display:flex;align-items:center;gap:12px"><span class="tile lav">${icon('medal')}</span><div style="flex:1"><div class="bold">Round over: ${esc(Mila.wordDef(c.defId).title)}</div><div class="small muted">How did it go?</div></div>${icon('chev', 20)}</div></div>`).join('') : ''}

      ${fresh ? `<div class="card start-card">
          <div class="start-title">What will you stick to for the next 14 days?</div>
          <ol class="start-steps">
            <li><b>1</b><span>Pick up to 3 challenges</span></li>
            <li><b>2</b><span>Every evening, mark whether you kept them</span></li>
            <li><b>3</b><span>Invite friends to help you keep your word</span></li>
          </ol>
          <button class="btn primary" onclick="App.openPick()">Pick challenges</button>
        </div>` : `${lateCards.length ? `<div class="section-title">Still to check in from yesterday <small>open until ${Mila.RULES.GRACE_HOUR}:00</small></div>${lateCards.map(todayRow).join('')}` : ''}
      ${nowCards.length || !lateCards.length ? `<div class="section-title">My challenges for today ${nowCards.length ? `<small>${nowCards.filter(x => x.outcome).length}/${nowCards.length}</small>` : ''}</div>
      ${nowCards.length ? nowCards.map(todayRow).join('') : emptyState({ mood: 'sleepy', title: 'You have no challenge today', text: "The challenges you picked haven't started yet, or have already ended.", actions: active.length < Mila.RULES.DAILY_CAP ? `<button class="btn primary" onclick="App.openPick()">Pick a challenge</button>` : '' })}` : ''}`}
      ${cards.length && active.length < Mila.RULES.DAILY_CAP ? `<button class="btn ghost mt" onclick="App.openPick()">${icon('plus', 20)} Another challenge</button>` : ''}
      ${groupInvites().slice(0, 1).map(groupInviteCard).join('')}
      ${sharedWaiting.slice(0, 1).map(sharedInviteCard).join('')}
      ${rankAll.length ? `<div class="card tight my-ranks"><div class="card-title">${rankAll.length === 1 ? 'Your group' : 'Your groups'}</div>${rankAll.map(({ c, ri }) => {
        const hasWord = active.some(k => Mila.inCircle(Mila.wordDef(k.defId), c.id));
        const status = ri.place ? `#${ri.place} of ${ri.total}` : !hasWord ? 'You have no challenge here' : 'Not ranked yet';
        return `<div class="rk-row" onclick="App.go('circle',{id:'${c.id}'})"><span class="rk-name">${esc(c.name)}</span><span class="rk-status">${status}</span>${icon('chev', 16)}</div>`; }).join('')}</div>` : ''}

      ${upcoming.length ? `<div class="section-title">Challenges starting soon</div>${upcoming.map(c => `<div class="word-row" onclick="App.go('word',{id:'${c.id}'})">${wordTile(c.def, 'sm')}<div class="body"><div class="name">${esc(c.def.title)}</div><div class="meta">Starts ${Mila.relDay(c.startDate).replace(/^(Today|Tomorrow|Yesterday)$/, x => x.toLowerCase())}</div></div>${icon('chev', 18)}</div>`).join('')}` : ''}

      ${supportCard()}
      ${digest.length ? `<div class="section-title">From your friends <small onclick="App.tab('circles')" style="cursor:pointer">All</small></div>
        <div class="card tight">${digest.map(e => `<div class="feed-item" onclick="App.go('circle',{id:'${e.circleId}'})">${avatar(e.actor, 36)}<div class="body"><div class="t">${feedText(e)}</div><div class="m">${esc(e.circle.name)} · ${timeAgo(e.createdAt)}</div></div></div>`).join('')}</div>` : ''}
      ${!fresh && !Mila.myCircles().length ? `<div class="card pastel-pink clickable tight" onclick="App.inviteFlow({})"><div style="display:flex;align-items:center;gap:12px"><span class="tile pink">${icon('users')}</span><div style="flex:1"><div class="bold">Invite a friend to help you keep it</div><div class="small muted">They see your progress, and you can also compete.</div></div>${icon('chev', 20)}</div></div>` : ''}
    `;
  };

  function todaySubtitle(cards) {
    if (!cards.length) return 'You have no challenge today';
    const late = cards.filter(x => x.late && !x.outcome).length;
    if (late) return late === 1 ? '1 challenge from yesterday left to check in' : `${late} challenges from yesterday left to check in`;
    const left = cards.filter(x => !x.outcome).length;
    const kept = cards.filter(x => x.outcome === 'success').length;
    if (left === 0) return kept === cards.length ? "You kept all your challenges today 🎉" : "You've checked in on everything. Tomorrow is another day.";
    if (left === cards.length) return cards.length === 1 ? 'You have 1 challenge today' : `You have ${cards.length} challenges today`;
    return left === 1 ? '1 left to check in' : `${left} left to check in`;
  }
  /* שורת אתגר: אייקון ושם בלבד. האייקון נצבע לפי מצב היום; תווית רק כשיש מה לומר (פספוס / יום חריג) */
  function todayRow(x) {
    const st = x.outcome === 'success' ? 'done' : x.outcome === 'miss' ? 'miss' : x.outcome === 'excused' ? 'excused' : '';
    const meta = x.outcome === 'miss' ? `<span class="chip pink">Missed</span>` : x.outcome === 'excused' ? '<span class="chip lav">Day off</span>' : '';
    return `<div class="word-row tap ${st}" data-ob="${x.id}" onclick="App.reportSheet('${x.id}')">
      <span class="wt-state ${st}">${wordTile(x.def)}</span>
      <div class="body"><div class="name">${esc(x.def.title)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</div>
    </div>`;
  }

  /* ============================================================
     S07 — דיווח (גיליון)
     ============================================================ */
  function reportSheet(obligationId) {
    const o = Mila.decorate(Mila.getState().obligations[obligationId]);
    if (o.outcome) {
      // כבר הוכרע: הצגה + אפשרות תיקון
      return sheet(`<div class="sheet-hero">${wordTile(o.def, 'lg')}<div class="sheet-title">${esc(o.def.title)}</div><div class="sheet-sub">${Mila.relDay(o.localDate)} · ${o.outcome === 'success' ? 'You said it. You did it. +1' : o.outcome === 'miss' ? 'Not today. The streak reset' : 'Day off'}</div></div>
        ${o.canCorrect ? `<button class="btn soft" onclick="App.correctionSheet('${o.id}')">${icon('edit', 18)} Mistake? Fix it</button><div class="tiny muted center mt">You can fix it up to 24 hours after checking in.</div>` : '<div class="note">' + icon('lock', 18) + '<span>Locked. 24 hours have passed.</span></div>'}
        ${sheetMore(o)}`);
    }
    if (!o.open) return toast(o.localDate > Mila.today() ? "This day hasn't come yet" : "This day is closed");
    const excusesLeft = Mila.RULES.MAX_EXCUSES_PER_ROUND - Mila.excusesUsed(o.commitmentId);
    sheet(`<div class="sheet-hero">${wordTile(o.def, 'lg')}<div class="sheet-title">${esc(o.def.title)}</div><div class="sheet-sub">${esc(o.def.rule)}</div>${o.localDate < Mila.today() ? `<div class="chip peach" style="margin-top:8px">How was yesterday?</div>` : ''}</div>
      <div class="outcome-btns">
        <button class="btn primary" onclick="App.doReport('${o.id}','success')">${icon('check', 26)}Kept it<small>+1 point</small></button>
        <button class="btn pink" onclick="App.confirmMiss('${o.id}')">${icon('x', 24)}Missed<small>Streak resets</small></button>
      </div>
      <button class="btn text mt" ${excusesLeft > 0 ? `onclick="App.excuseSheet('${o.id}')"` : 'disabled'}>${icon('minus', 16)} Day off ${excusesLeft > 0 ? `(${excusesLeft} left)` : '(none left)'}</button>
      ${sheetMore(o)}`);
  }
  /* בתחתית גיליון הדיווח: להזמין חברה לאתגר הזה, ולפתוח את המסך המלא שלו */
  function sheetMore(o) {
    return `<div class="btn-row sheet-more"><button class="btn soft sm" onclick="App.closeSheet(); App.inviteFlow({ commitmentId: '${o.commitmentId}', kind: 'follow' })">${icon('users', 16)} Invite a friend</button><button class="btn soft sm" onclick="App.closeSheet(); App.go('word',{id:'${o.commitmentId}'})">${icon('calendar', 16)} All details</button></div>`;
  }
  function confirmMiss(id) {
    const o = Mila.decorate(Mila.getState().obligations[id]);
    confirmSheet({ title: 'Not today?', sub: 'The streak for this challenge resets. The points you earned stay. Back at it tomorrow.', okText: 'Yes, I missed', okClass: 'pink', onOk: () => doReport(id, 'miss') });
  }
  function excuseSheet(id) {
    sheet(`<div class="sheet-title">Day off</div><div class="sheet-sub">Doesn't count and doesn't break your streak. Up to 2 per round.</div>
      ${['Sick', 'Family event', 'Travel', 'Other'].map(r => `<div class="choice" onclick="App.doReport('${id}','excused','${r}')"><span class="radio"></span><div class="body"><div class="t">${r}</div></div></div>`).join('')}`);
  }
  const doReport = once(async (id, outcome, note = '') => {
    try {
      // ״המהפך״ בענן: הדירוג מחושב בטלפון (לפני ואחרי), והשרת רק רושם את העקיפה
      const ob0 = Mila.getState().obligations[id]; const k0 = ob0 && Mila.commitment(ob0.commitmentId); const d0 = k0 && Mila.wordDef(k0.defId);
      const ranked = (cid) => Mila.leaderboard(cid).rows.filter(r => r.ranked).map(r => r.user.id);
      const cids = isCloud() && outcome === 'success' && d0 ? Mila.defCircles(d0) : [];   // אתגר אישי נספר בכל הקבוצות שלי
      const befores = cids.map(ranked);
      const { obligation, duplicate } = await Store().report(id, outcome, { note });
      if (cids.length && !duplicate) {
        const meId = Mila.me().id; let first = null;
        cids.forEach((cid, n) => {
          const before = befores[n], after = ranked(cid); const myAfter = after.indexOf(meId); const myBefore = before.indexOf(meId);
          if (myAfter < 0) return;
          const passed = after.filter((u, i) => u !== meId && i > myAfter && (myBefore < 0 ? before.includes(u) : before.indexOf(u) >= 0 && before.indexOf(u) < myBefore));
          passed.forEach(u => Api.cloud.overtake(cid, u).catch(() => {}));
          if (passed.length && !first) first = passed[0];
        });
        if (first) setTimeout(() => toast(`You passed ${Mila.user(first).name}. Now let's see if they let you stay there 😏`, 'lime'), 1600);
      }
      closeSheet(true);
      render();
      const row = document.querySelector(`.word-row[data-ob="${id}"] .wt-state`);
      const cards = Mila.todayCards(); const allDone = cards.length > 0 && cards.every(c => c.outcome);
      if (duplicate) toast('Already saved');
      else if (outcome === 'success') {
        FX.buzz(14); FX.pop(row, 'fx-win'); FX.confettiAt(row, { n: 16 });
        FX.pop(document.querySelector('.stats-line span:nth-child(2) b'), 'fx-bump');
        if (allDone) { setTimeout(() => { FX.confetti(innerWidth / 2, innerHeight * .3, { n: 42, power: 1.8 }); FX.buzz(30); }, 380); toast('All your challenges for today. Perfect.', 'lime'); }
        else toast('You said it. You did it. +1 point', 'lime');
      }
      else if (outcome === 'miss') { FX.pop(row, 'fx-shake'); toast('Not today. Back at it tomorrow.'); }
      else toast('Day off. Your streak stays.');
    } catch (e) { fail(e); }
  });

  /* ---------- S21 — תיקון דיווח ---------- */
  function correctionSheet(id) {
    corrPick = null;   // בחירה מתיקון קודם לא נגררת ליום אחר
    const o = Mila.decorate(Mila.getState().obligations[id]);
    const opts = [['success', 'Kept my word', 'lime'], ['miss', 'Missed', 'pink'], ['excused', 'Day off', 'lav']].filter(([k]) => k !== o.outcome);
    sheet(`<div class="sheet-title">Fix check-in</div><div class="sheet-sub">${esc(o.def.title)} · ${Mila.relDay(o.localDate)}. The original check-in stays in the history.</div>
      <div class="field"><label>What really happened?</label>${opts.map(([k, l, c]) => `<div class="choice" data-k="${k}" onclick="App._corrPick('${k}')"><span class="radio"></span><div class="body"><div class="t">${l}</div></div></div>`).join('')}</div>
      <div class="field"><label>Why?</label><input class="input" id="corr-reason" placeholder="I tapped by mistake"></div>
      <button class="btn dark" onclick="App.doCorrect('${id}')">Fix it</button>`);
  }
  let corrPick = null;
  function _corrPick(k) { corrPick = k; document.querySelectorAll('#sheet .choice').forEach(c => { c.classList.toggle('on', c.dataset.k === k); c.setAttribute('aria-checked', String(c.dataset.k === k)); c.querySelector('.radio').innerHTML = c.dataset.k === k ? icon('check', 14) : ''; }); }
  const doCorrect = once(async (id) => {
    try {
      if (!corrPick) return toast('What really happened?');
      const reason = $('#corr-reason').value;
      await Store().correct(id, corrPick, reason);
      corrPick = null; closeSheet(true); toast('Fixed.'); render();
    } catch (e) { fail(e); }
  });

  /* ============================================================
     S05 — יצירת מילה (4 צעדים)
     ============================================================ */
  function openWordWizard(prefill = {}) {
    const draft = Mila.getState().drafts.word;
    wiz = Object.assign({ step: 1, title: '', rule: '', icon: 'leaf', circleId: null }, draft || {}, prefill, { step: 1, startDate: Mila.today() });
    ideasOpen = false; ideasCat = 0;
    go('wordNew');
  }
  SCREENS.wordNew = () => {
    if (!wiz) wiz = { step: 1, title: '', rule: '', icon: 'leaf', startDate: Mila.today(), circleId: null };
    const steps = `<div class="steps">${[1, 2].map(i => `<i class="${i <= wiz.step ? 'on' : ''}"></i>`).join('')}</div>`;
    const header = topbar({ title: 'Your own challenge', start: `<button class="icon-btn" aria-label="Back" onclick="App.wizHeadBack()">${icon('back', 24)}</button>`, back: false, end: `<button class="icon-btn" aria-label="Close" onclick="App.wizCancel()">${icon('x', 22)}</button>` });
    if (wiz.step === 1) return `${header}${steps}
      <div class="step-title">What's the challenge?</div><div class="step-sub">Something you can tick off at the end of each day.</div>
      <div class="field"><label for="w-title">Challenge name</label><input class="input" id="w-title" placeholder="e.g. 8,000 steps a day" maxlength="60" value="${esc(wiz.title)}" oninput="App.wizSet('title', this.value)"></div>
      <div class="field"><label for="w-rule">What counts as success?</label><textarea class="input" id="w-rule" placeholder="e.g. at least 8,000 steps by midnight" maxlength="200" oninput="App.wizSet('rule', this.value)">${esc(wiz.rule)}</textarea></div>
      ${templateChips('wizTemplate', wiz.title)}
      <div class="field"><label>Icon</label><div class="icon-picker">${Mila.WORD_ICONS.map(ic => `<span class="tile ${tileColorFor(wiz.title || ic)} ${wiz.icon === ic ? 'on' : ''}" aria-label="${ICON_HE[ic] || ic}" aria-pressed="${wiz.icon === ic}" onclick="App.wizSet('icon','${ic}'); App.refresh()">${icon(ic, 24)}</span>`).join('')}</div></div>
      <div class="mt-lg"><button class="btn primary" onclick="App.wizNext()">Continue</button></div>`;
    // שלב 2 — אישור: מתחיל היום (כמו בבחירה מהספרייה), עם מי, ופרס אם רוצים
    wiz.step = 2; wiz.startDate = Mila.today();
    const circles = Mila.myCircles();
    if (wiz.circleId && !circles.some(c => c.id === wiz.circleId)) wiz.circleId = null;
    const wd = wiz.days === 21 ? 21 : 14;
    const cap = Mila.capCheck(Mila.me().id, wiz.startDate, wd);
    return `${header}${steps}
      <div class="step-title">Ready?</div><div class="step-sub">${wd} days, starting today. Every evening you mark whether you kept it.</div>
      <div class="card"><div style="display:flex;gap:12px;align-items:center">${wordTile({ title: wiz.title, icon: wiz.icon }, 'lg')}<div><div class="bold" style="font-size:1.15rem">${esc(wiz.title)}</div><div class="small muted">${esc(wiz.rule)}</div></div></div></div>
      <div class="field"><label>For how long?</label><div class="chips"><button class="chip select ${wd === 14 ? 'on' : ''}" onclick="App.wizSet('days', 14); App.refresh()">14 days</button><button class="chip select ${wd === 21 ? 'on' : ''}" onclick="App.wizSet('days', 21); App.refresh()">21 days</button></div></div>
      ${circles.length ? `<div class="field"><label>Who can see it?</label><div class="chips"><button class="chip select ${!wiz.private ? 'on' : ''}" onclick="App.wizSet('private', false); App.refresh()">${icon('users', 14)} My friends</button><button class="chip select ${wiz.private ? 'on' : ''}" onclick="App.wizSet('private', true); App.refresh()">${icon('lock', 14)} Only me</button></div></div>` : ''}
      <div class="field"><label for="w-reward">If I make it, I'll…</label><input class="input" id="w-reward" maxlength="80" placeholder="e.g. buy myself something nice" value="${esc(wiz.reward || '')}" oninput="App.wizSet('reward', this.value)"><div class="hint">Optional.</div></div>
      ${!cap.ok ? `<div class="note warn">${icon('info', 18)}<span>You already have 3 challenges, and that's the maximum. When one of them ends you can start this one. We saved your wording.</span></div>` : ''}
      <button class="btn primary mt" ${cap.ok ? '' : 'disabled'} onclick="App.wizCommit()">Start</button>`;
  };
  function wizSet(k, v) { wiz[k] = v; Mila.getState().drafts.word = { ...wiz }; Mila.save(); }
  function wizTemplate(i) { const t = Mila.TEMPLATES[i]; wiz.title = t.title; wiz.rule = t.rule; wiz.icon = t.icon; wizSet('title', t.title); ideasOpen = false; render(); }
  function wizNext() {
    try {
      if (wiz.step === 1) validateStep1();
      wiz.step = 2; render(); window.scrollTo({ top: 0 });
    } catch (e) { fail(e); }
  }
  function validateStep1() { if (!wiz.title.trim()) throw { userMessage: "What's the challenge called?" }; if (!wiz.rule.trim()) throw { userMessage: 'What counts as success?' }; }
  function wizPrev() { wiz.step = 1; render(); }
  /* ״עוד סיבוב״: אותו אתגר שוב. מהספרייה → מסך הבחירה; אתגר משלה → האשף עם אותו ניסוח */
  function again(commitmentId) {
    const c = Mila.commitment(commitmentId); const def = c && Mila.wordDef(c.defId); if (!def) return;
    closeSheet(true);
    if (def.libraryId && Mila.LIBRARY.get(def.libraryId)) return openPick([def.libraryId]);
    openWordWizard({ title: def.title, rule: def.rule, icon: def.icon });
  }
  function wizHeadBack() { if (wiz && wiz.step > 1) wizPrev(); else wizCancel(); }
  function wizCancel() { Mila.getState().drafts.word = { ...wiz }; Mila.save(); wiz = null; back(); if (Mila.getState().drafts.word && Mila.getState().drafts.word.title) toast('Draft saved.'); }
  const wizCommit = once(async () => {
    try {
      const { def, commitment } = await Store().createPersonalWord({ title: wiz.title, rule: wiz.rule, icon: wiz.icon, startDate: wiz.startDate, circleId: wiz.circleId, private: !!wiz.private, days: wiz.days === 21 ? 21 : 14, reward: wiz.reward || '' });
      wiz = null; pick = null;
      stack = [{ name: 'today', params: {} }];
      go('word', { id: commitment.id, fresh: true });
      stamp('I gave my word.');
    } catch (e) {
      if (e.code === 'CAP') { wiz.step = 2; render(); }
      fail(e);
    }
  });

  /* ============================================================
     S05b — ספריית האתגרים: בחירת עד 3 + ״אם אצליח, אני…״
     ============================================================ */
  function freeSlots(startDate) {
    const me = Mila.me().id;
    const taken = Math.max(0, ...Mila.dateRange(startDate, Mila.RULES.ROUND_DAYS).map(d => Mila.activeWordsOn(me, d).length));
    return Math.max(0, Mila.RULES.DAILY_CAP - taken);
  }
  function newPick(prefillIds = [], opts = {}) {
    const L = Mila.LIBRARY;
    const circles = Mila.myCircles();
    const startDate = Mila.today();
    prefillIds = prefillIds.filter(id => !L.isSensitive(id) || Mila.isAdult());   // אתגר מהתחום שמגיל 18 לא נבחר מראש למי שהוא לא פתוח לה
    return { step: 1, selected: prefillIds.filter(id => L.get(id)).slice(0, Mila.RULES.DAILY_CAP), open: (L.get(prefillIds.find(id => L.get(id))) || {}).cat || L.CATEGORIES[0].id, rewards: {}, startDate, circleId: opts.circleId || (circles.length === 1 ? circles[0].id : null), visibility: 'status', shareSensitive: false, newCircleName: `${(Mila.me().name || '').split(' ')[0]}'s group`, exStart: Math.floor(Math.random() * 10) };
  }
  function openPick(prefillIds = [], opts = {}) { pick = newPick(prefillIds, opts); go('pick', {}, { replace: stack.length > 0 && current().name === 'pick' }); }
  SCREENS.pick = () => {
    if (!pick) pick = newPick();   // בלי go() בתוך ציור המסך (היה משאיר מסך ריק)
    const L = Mila.LIBRARY;
    const free = freeSlots(pick.startDate);
    const n = pick.selected.length;
    const header = topbar({ title: 'So what are you starting with?', start: `<button class="icon-btn" aria-label="Back" onclick="App.pickHeadBack()">${icon('back', 24)}</button>`, back: false, end: `<button class="icon-btn" aria-label="Close" onclick="App.pickCancel()">${icon('x', 22)}</button>` });
    if (pick.step === 2) return pickReview(header);
    if (free === 0 && !n) return `${header}
      ${emptyState({ mood: 'happy', title: 'You already have 3 challenges', text: "That's the maximum, so you can really keep them. When one of them ends you can pick a new one.", actions: `<button class="btn primary" onclick="App.pickCancel()">Back to my challenges</button>` })}`;
    return `${header}
      <div class="pick-head"><div class="step-sub" style="margin:0">Pick up to 3 challenges for the next 14 days.</div><span class="chip ${n ? 'lime' : ''} lg">${n}/${Mila.RULES.DAILY_CAP}</span></div>
      ${free === 0 ? `<div class="note warn">${icon('info', 18)}<span>You already have 3 challenges on these days. You can start a new one when one ends.</span></div>` : free < Mila.RULES.DAILY_CAP ? `<div class="tiny muted mb">You already have ${Mila.RULES.DAILY_CAP - free}. Room for ${free === 1 ? 'one more' : `${free} more`}.</div>` : ''}
      ${L.CATEGORIES.map(cat => {
        const locked = cat.sensitive && !Mila.isAdult();   // התחום שמגיל 18: נעול עד שנשאלה על תאריך הלידה
        const items = L.inCategory(cat.id); const open = !locked && pick.open === cat.id; const chosen = items.filter(ch => pick.selected.includes(ch.id)).length;
        return `<div class="cat ${open ? 'open' : ''} ${locked ? 'locked' : ''}">
          <button class="cat-head" onclick="App.pickCat('${cat.id}')"><span class="emoji">${cat.emoji}</span><span class="name">${esc(cat.name)}</span><span class="count">${locked ? `<span class="chip">${icon('lock', 12)} 18+</span>` : chosen ? `<span class="chip lime">${chosen}</span>` : items.length}</span>${icon('chev', 18)}</button>
          ${open ? `<div class="cat-body">${items.map(ch => { const on = pick.selected.includes(ch.id); const off = !on && n >= free; return `<div class="pick-row ${on ? 'on' : ''} ${off ? 'off' : ''}" onclick="App.pickToggle('${ch.id}')"><span class="box">${on ? icon('check', 14) : ''}</span><div class="body"><div class="t">${esc(ch.title)}</div>${on ? `<div class="m">${esc(ch.rule)}</div>` : ''}</div>${cat.sensitive ? `<span class="chip">${icon('lock', 12)} Private</span>` : ''}</div>`; }).join('')}</div>` : ''}
        </div>`;
      }).join('')}
      <div class="pick-bar"><span class="small">${n === 0 ? '0 of 3 picked' : n === 1 ? '1 of 3 picked' : `${n} of 3 picked`}</span>${n ? `<button class="btn text xs" onclick="App.pickClear()">Clear selection</button>` : ''}</div>
      <button class="btn primary" ${n ? '' : 'disabled'} onclick="App.pickNext()">Picked. What's next?</button>
      <button class="btn text mt" onclick="App.pickCustom()">${icon('plus', 16)} Didn't find one? Create your own challenge</button>`;
  };
  const REWARD_EXAMPLES = ['e.g. eat the chocolate I hid from the kids', 'e.g. get a whole evening where nobody needs anything from me', 'e.g. buy the outfit I have nowhere to wear', 'e.g. sleep in till 10 on Saturday while someone else gets up with the kids', 'e.g. have a bath. With the door locked.', 'e.g. leave the preschool WhatsApp group', 'e.g. tell everyone. Twice.', 'e.g. order sushi and share none of it', 'e.g. have a glass of wine and an hour when no one talks to me', 'e.g. get a massage, and someone else pays'];
  const rewardExample = (id, i) => REWARD_EXAMPLES[((pick.exStart || 0) + i) % REWARD_EXAMPLES.length]; // כל אתגר דוגמה אחרת, ומשתנה בכל פתיחה
  function pickReview(header) {
    const L = Mila.LIBRARY;
    const circles = Mila.myCircles();
    const cap = Mila.capCheck(Mila.me().id, pick.startDate);
    const sensitive = pick.selected.filter(id => L.isSensitive(id));
    const circle = pick.circleId === '__new__' ? { name: pick.newCircleName || 'The new group' } : pick.circleId ? Mila.getState().circles[pick.circleId] : null;
    const opts = [[Mila.today(), 'Today'], [Mila.addDays(Mila.today(), 1), 'Tomorrow']];
    const ro = pick.rewardOpen || {};
    // מי רואה: שורה אחת קומפקטית, הבחירה עצמה נפתחת בגיליון
    const who = !pick.circleId ? { t: 'Only me', m: 'No group. No ranking.', tile: `<span class="tile sm gray">${icon('lock', 18)}</span>` }
      : pick.circleId === '__new__' ? { t: circle.name, m: 'A new group. You invite friends right after.', tile: `<span class="tile sm pink">${icon('users', 18)}</span>` }
      : { t: circle.name, m: `${Mila.circleMembers(circle.id).length === 1 ? '1 member' : `${Mila.circleMembers(circle.id).length} members`} · you join the ranking`, tile: circleTile(circle, 'sm') };
    return `${header}
      <div class="step-title">Ready?</div><div class="step-sub">14 days. Every evening you mark whether you kept it.</div>
      <div class="card tight pr-list">${pick.selected.map((id, i) => { const ch = L.get(id); const r = (pick.rewards[id] || '').trim(); return `<div class="pr-item">
        <div class="pr-row">${wordTile(ch, 'sm')}<div class="pr-t">${esc(ch.title)}</div><button class="icon-btn" aria-label="Remove" onclick="App.pickToggle('${id}')">${icon('x', 16)}</button></div>
        ${ro[id] ? `<input class="input pr-input" id="rw-${id}" maxlength="80" placeholder="${rewardExample(id, i)}" value="${esc(pick.rewards[id] || '')}" oninput="App.pickReward('${id}', this.value)" onblur="App.pickRewardDone('${id}')">`
          : `<button class="pr-reward ${r ? 'set' : ''}" onclick="App.pickRewardOpen('${id}')">${r ? `If I make it: ${esc(r)}` : `${icon('plus', 13)} If I make it, I'll…`}</button>`}
      </div>`; }).join('')}</div>
      <div class="field"><label>When do you start?</label><div class="seg">${opts.map(([d, l]) => `<button class="${pick.startDate === d ? 'on' : ''}" onclick="${d === Mila.today() ? `App.pickSet('startDate','${d}')` : 'App.pickTomorrow()'}">${l}</button>`).join('')}</div></div>
      <div class="field"><label>Who can see it?</label>
        <div class="choice on clickable" onclick="App.pickWhoSheet()"><div class="body"><div class="t">${esc(who.t)}</div><div class="m">${who.m}</div></div><span class="pr-change">Change</span>${who.tile}</div>
        ${pick.circleId === '__new__' ? `<div class="field" style="margin:8px 0 0"><label>What's the group called?</label><input class="input" maxlength="50" value="${esc(pick.newCircleName)}" oninput="App.pickNewName(this.value)"></div>` : ''}
      </div>
      ${circle && sensitive.length ? `<div class="checkbox-row ${pick.shareSensitive ? 'on' : ''}" onclick="App.pickSet('shareSensitive', ${!pick.shareSensitive})"><span class="box">${pick.shareSensitive ? icon('check', 16) : ''}</span><span>Also share ${sensitive.length === 1 ? 'the private challenge' : 'the private challenges'} (relationships) with ${esc(circle.name)}. Otherwise ${sensitive.length === 1 ? 'it stays' : 'they stay'} with you only.</span></div>` : ''}
      ${!cap.ok ? `<div class="note warn">${icon('info', 18)}<span>3 challenges are already running on these days.${cap.nextFree ? ` Free from ${Mila.fmtDate(cap.nextFree)}.` : ''}</span></div>` : ''}
      <button class="btn primary mt-lg" ${cap.ok && pick.selected.length ? '' : 'disabled'} ${busy ? 'disabled' : ''} onclick="App.pickCommit()">${busy ? 'One moment…' : 'Start'}</button>`;
  }
  function pickRewardOpen(id) { pick.rewardOpen = { ...(pick.rewardOpen || {}), [id]: true }; render(); const el = document.getElementById('rw-' + id); if (el) el.focus(); }
  function pickRewardDone(id) { if (pick && pick.rewardOpen) delete pick.rewardOpen[id]; } // בלי לרנדר מחדש באמצע לחיצה; בשינוי הבא יוצג כטקסט
  function pickWhoSheet() {
    const circles = Mila.myCircles();
    const opt = (val, t, m, tile) => { const on = (pick.circleId || null) === val; return `<div class="choice ${on ? 'on' : ''}" onclick="App.pickSet('circleId', ${val === null ? 'null' : `'${val}'`})"><span class="radio">${on ? icon('check', 14) : ''}</span><div class="body"><div class="t">${t}</div><div class="m">${m}</div></div>${tile}</div>`; };
    sheet(`<div class="sheet-title">Who can see it?</div><div class="sheet-sub">You can change this later too.</div>
      ${opt(null, 'Only me', 'No group. No ranking.', `<span class="tile sm gray">${icon('lock', 18)}</span>`)}
      ${circles.map(c => opt(c.id, esc(c.name), `${Mila.circleMembers(c.id).length === 1 ? '1 member' : `${Mila.circleMembers(c.id).length} members`} · you join the ranking`, circleTile(c, 'sm'))).join('')}
      ${opt('__new__', circles.length ? 'A new group with friends' : 'With friends', 'Open a group, then invite friends right after', `<span class="tile sm pink">${icon('users', 18)}</span>`)}`);
  }
  function pickCat(id) {
    const cat = Mila.LIBRARY.CATEGORIES.find(c => c.id === id);
    if (cat && cat.sensitive && !Mila.isAdult()) return ageSheet(() => pickCat(id));
    pick.open = pick.open === id ? null : id; render();
  }
  /* ---------- גיל: תחום ״זוגיות ואינטימיות״ פתוח מגיל 18 ---------- */
  let ageAfter = null;
  function ageSheet(after) {
    ageAfter = after || null;
    const u = Mila.me();
    if (u.adult === false && u.adultFrom) {
      return sheet(`<div class="sheet-hero">${moodFace('sleepy', 72)}<div class="sheet-title">This category opens for you on <bdi>${u.adultFrom.split('-').reverse().map(Number).join('.')}</bdi></div><div class="sheet-sub">It's for ages 18 and up. Until then, dozens of other challenges are waiting for you.</div></div>
        <button class="btn primary" onclick="App.closeSheet()">Back to challenges</button>`);
    }
    sheet(`<div class="sheet-hero">${moodFace('wink', 72)}<div class="sheet-title">This category is 18+</div><div class="sheet-sub">It has challenges about relationships and intimacy, which aren't suitable for anyone under 18.</div></div>
      <div class="field"><label for="age-bd">What's your date of birth?</label><input class="input ltr" id="age-bd" type="date" min="1900-01-01" max="${Mila.today()}" autocomplete="bday"></div>
      <div class="tiny muted">We don't store the date of birth itself. We only store that the category is open for you, or when it will open.</div>
      <div class="btn-row mt"><button class="btn soft" onclick="App.closeSheet()">Cancel</button><button class="btn primary" onclick="App.ageSubmit()">Continue</button></div>`);
  }
  const ageSubmit = once(async () => {
    const el = $('#age-bd'); const v = el ? el.value : '';
    if (!v) return toast('You need to choose a date of birth');
    try {
      const r = await Store().setBirthDate(v);
      if (r && r.adult) { const f = ageAfter; ageAfter = null; closeSheet(true); render(); toast('The category is open for you.', 'lime'); if (f) f(); }
      else { render({ keepSheet: true }); ageSheet(); }
    } catch (e) { fail(e); }
  });
  function pickToggle(id) {
    if (Mila.LIBRARY.isSensitive(id) && !Mila.isAdult()) return ageSheet(() => pickToggle(id));
    const i = pick.selected.indexOf(id);
    if (i >= 0) pick.selected.splice(i, 1);
    else { if (pick.selected.length >= freeSlots(pick.startDate)) return toast(freeSlots(pick.startDate) === 0 ? 'No free slot on these days.' : 'Up to 3 challenges. To add one, stop one first.'); pick.selected.push(id); }
    if (pick.step === 2 && !pick.selected.length) pick.step = 1;
    render();
  }
  function pickClear() { pick.selected = []; render(); }
  function pickSet(k, v) { pick[k] = v; if (k === 'startDate' && pick.selected.length > freeSlots(v)) { pick.selected = pick.selected.slice(0, freeSlots(v)); toast('There is less room on that date.'); } render(); }
  function pickReward(id, v) { pick.rewards[id] = v; }
  function pickNewName(v) { pick.newCircleName = v; }
  /* ״מחר״? נו באמת. */
  function pickTomorrow() {
    sheet(`<div class="sheet-hero tomorrow-sheet"><div class="tm-logo">${liveLogo(64)}</div><div class="sheet-title">Come on now 😏</div><div class="sheet-sub">You know tomorrow won't happen.</div></div>
      <button class="btn primary" onclick="App.pickSet('startDate','${Mila.today()}'); App.closeSheet()">Start today</button>`);
  }
  function pickNext() { if (!pick.selected.length) return toast('Pick at least one challenge.'); pick.step = 2; render(); window.scrollTo({ top: 0 }); }
  function pickBack() { pick.step = 1; render(); }
  function pickHeadBack() { if (pick && pick.step === 2) pickBack(); else pickCancel(); }
  function popAll(name, fallback = 'today') { while (stack.length && current().name === name) stack.pop(); if (!stack.length) stack = [{ name: fallback, params: {} }]; render(); }
  function pickCancel() { pick = null; popAll('pick'); }
  function pickCustom() { const circleId = pick && pick.circleId !== '__new__' ? pick.circleId : null; openWordWizard(circleId ? { circleId } : {}); }   // הבחירה נשארת: חזרה מהאשף מחזירה אליה
  async function pickCommit() {
    if (busy) return;
    busy = true; render();
    const created = []; let newCircleId = pick.newCircleId || null;
    try {
      if (pick.circleId === '__new__') {
        const name = (pick.newCircleName || '').trim() || `${(Mila.me().name || '').split(' ')[0]}'s group`;
        const { circle } = await Store().createCircle({ name, description: '', whoCanPropose: 'all', maxMembers: 8, color: 'pink' });
        pick.circleId = pick.newCircleId = newCircleId = circle.id;
      }
      for (const id of [...pick.selected]) {
        const r = await Store().createPersonalWord({ libraryId: id, startDate: pick.startDate, circleId: pick.circleId, reward: pick.rewards[id] || '', shareSensitive: pick.shareSensitive });
        created.push(r.commitment.id);
        pick.selected = pick.selected.filter(x => x !== id);
      }
      busy = false; pick = null;
      stack = [{ name: 'today', params: {} }];
      render();
      stamp(created.length === 1 ? 'I gave my word.' : `${created.length} challenges. I gave my word.`);
      if (newCircleId) setTimeout(() => inviteFlow({ circleId: newCircleId, created: true }), 1700); // ישר להזמנת החברות
      else afterFirstCommit();
    } catch (e) {
      busy = false; render();
      if (created.length && pick) toast(`${created.length === 1 ? '1 challenge was saved' : `${created.length} challenges were saved`}. ${e.userMessage || 'The rest were not. Try again.'}`); else fail(e);
    }
  }

  /* ============================================================
     S06 — פרטי מילה
     ============================================================ */
  SCREENS.word = ({ id, fresh }) => {
    const c = Mila.commitment(id);
    if (!c) return `${topbar({ title: 'Challenge' })}${emptyState({ mood: 'oops', title: 'This challenge is no longer here', text: 'Maybe it was deleted, or the link is old.', actions: backBtn(), card: false })}`;
    const def = Mila.wordDef(c.defId);
    const st = Mila.commitmentStats(id);
    const circle = def.kind === 'group' && def.circleId ? Mila.getState().circles[def.circleId] : null;
    // אתגר אישי: החברות בכל הקבוצות שלי רואות אותו, אלא אם הוא פרטי
    const seenBy = def.kind === 'group' ? (circle ? esc(circle.name) : 'Only me') : def.visibility === 'private' ? 'Only me' : Mila.defCircles(def).length ? 'Friends in my groups' : 'Only me, until I have a group';
    const todayOb = Mila.obligationsOf(id).find(o => o.localDate === Mila.today());
    const obs = Mila.obligationsOf(id).filter(o => o.status !== 'cancelled');
    const correctable = obs.filter(o => Mila.canCorrect(o));
    const mine = c.userId === Mila.me().id;
    return `${topbar({ title: '', end: mine ? `<button class="icon-btn" aria-label="More" onclick="App.wordMenu('${id}')">${icon('more', 22)}</button>` : '' })}
      <div class="sheet-hero" style="margin-top:-6px">${wordTile(def, 'lg')}<div class="sheet-title">${esc(def.title)}</div><div class="sheet-sub" style="margin-bottom:6px">${esc(def.rule)}</div>
        <div class="chips">${def.kind === 'group' ? `<span class="chip lav">${icon('users', 13)} Shared challenge</span>` : `<span class="chip">${icon('user', 13)} Personal</span>`}${circle ? `<span class="chip outline" onclick="App.go('circle',{id:'${circle.id}'})">${esc(circle.name)}</span>` : def.kind !== 'group' && def.visibility === 'private' ? '<span class="chip outline">Only me</span>' : ''}${c.status !== 'active' ? `<span class="chip outline">${c.status === 'completed' ? 'Ended' : 'Stopped'}</span>` : ''}</div></div>
      ${fresh ? `<div class="note lime">${icon('sparkle', 18)}<span>Starts ${Mila.relDay(c.startDate).replace(/^(Today|Tomorrow|Yesterday)$/, x => x.toLowerCase())}. Check in by ${Mila.RULES.GRACE_HOUR}:00 the next day.</span></div>` : ''}
      <div class="stat-grid mb"><div class="stat lime"><div class="n">${st.success}</div><div class="l">Kept it</div></div><div class="stat pink"><div class="n">${st.miss}</div><div class="l">Missed</div></div><div class="stat lav"><div class="n">${st.current}${icon('flame', 18)}</div><div class="l">in a row</div></div></div>
      ${c.reward ? `<div class="card tight pastel-lav"><div class="tiny muted">${mine ? "If I make it, I'll…" : `${esc(Mila.user(c.userId).name)}'s reward for making it`}</div><div class="bold">${esc(c.reward)}</div></div>` : ''}
      ${mine && c.status === 'active' ? `<div class="btn-row mb word-invite"><button class="btn ghost sm" onclick="App.inviteFlow({ commitmentId: '${id}', kind: 'follow' })">Help me keep my word</button><button class="btn ghost sm" onclick="App.inviteFlow({ commitmentId: '${id}', kind: 'same' })">Come on, we both need this</button></div>` : ''}
      <div class="card"><div class="card-title">The ${st.length || 14} days <span class="link">${c.status === 'active' ? `Day ${Math.max(st.dayIndex, 1)}` : `${Mila.fmtDate(c.startDate)} – ${Mila.fmtDate(c.endDate)}`}</span></div>${days14(id)}</div>
      ${mine && todayOb && !todayOb.outcome && Mila.isOpenNow(todayOb) ? `<button class="btn primary mb" onclick="App.reportSheet('${todayOb.id}')">${icon('check', 20)} Check in for today</button>` : ''}
      <div class="card tight">
        <div class="kv"><span class="k">${icon('calendar', 18)} Round</span><span class="v">${Mila.fmtDate(c.startDate)} – ${Mila.fmtDate(c.endDate)}</span></div>
        <div class="kv"><span class="k">${icon('chart', 18)} Success</span><span class="v">${st.rate === null ? 'Too early to tell' : pct(st.rate)}</span></div>
        <div class="kv"><span class="k">${icon('minus', 18)} Days off</span><span class="v">${st.excused} of ${Mila.RULES.MAX_EXCUSES_PER_ROUND}</span></div>
        <div class="kv"><span class="k">${icon('flame', 18)} Longest streak</span><span class="v">${st.best} ${st.best === 1 ? 'day' : 'days'}</span></div>
        <div class="kv"><span class="k">${icon('eye', 18)} Who can see it</span><span class="v">${seenBy}</span></div>
      </div>
      ${correctable.length && mine ? `<div class="section-title">Recent days <small>can be fixed for 24 hours</small></div><div class="card tight">${correctable.map(o => `<div class="list-row clickable" onclick="App.reportSheet('${o.id}')"><span class="tile sm ${o.outcome === 'success' ? 'lime' : o.outcome === 'miss' ? 'pink' : 'lav'}">${icon(o.outcome === 'success' ? 'check' : o.outcome === 'miss' ? 'x' : 'minus', 18)}</span><div class="body"><div class="t">${Mila.relDay(o.localDate)} · ${o.outcome === 'success' ? 'Kept it' : o.outcome === 'miss' ? 'Missed' : 'Day off'}</div><div class="m">${o.resolveReason === 'auto_unreported' ? 'No check-in, counted as missed' : o.correctedAt ? 'Fixed' : Mila.fmtTime(o.resolvedAt)}</div></div>${icon('edit', 18)}</div>`).join('')}</div>` : ''}
    `;
  };
  function wordMenu(id) {
    const c = Mila.commitment(id); const def = Mila.wordDef(c.defId);
    sheet(`<div class="sheet-title">${esc(def.title)}</div>
      ${c.status === 'active' ? `<div class="list-row clickable" onclick="App.endWord('${id}')"><span class="tile sm pink">${icon('x', 18)}</span><div class="body"><div class="t">Stop the challenge</div><div class="m">The points you earned stay</div></div></div>` : ''}
      ${c.status !== 'active' ? `<div class="list-row clickable" onclick="App.again('${c.id}')"><span class="tile sm lime">${icon('repeat', 18)}</span><div class="body"><div class="t">Another round</div><div class="m">Same challenge, 14 new days</div></div></div>` : ''}`);
  }
  function endWord(id) {
    confirmSheet({ title: 'Stop the challenge?', sub: 'The points you earned stay. You can start it again whenever you like.', okText: 'Stop', okClass: 'pink', onOk: async () => { await Store().endCommitment(id); closeSheet(true); toast('Stopped.'); render(); } });
  }

  /* ============================================================
     S16 — סיכום סבב
     ============================================================ */
  SCREENS.summary = ({ id }) => {
    const s = Mila.roundSummary(id);
    if (!s.commitment.summarySeen) { s.commitment.summarySeen = true; Store().markSummarySeen(id).catch(() => {}); }
    const rate = s.stats.rate === null ? null : s.stats.rate;
    const line = rate === null ? 'There were no days to count.' : rate >= 0.85 ? 'Hardly a miss.' : rate >= 0.6 ? 'You kept it most days.' : 'A tough round. What you kept stays.';
    return `${topbar({ title: 'Summary', back: true })}
      <div class="sheet-hero">${wordTile(s.def, 'lg')}<div class="sheet-title">${rate !== null && s.stats.miss === 0 && s.stats.success >= (s.stats.length || 14) ? 'Rock solid.' : 'You said it. You did it.'}</div><div class="sheet-sub">${esc(s.def.title)} · ${s.stats.length || 14} days</div></div>
      <div class="card balance-card pastel-lime"><div class="label">Points this round</div><div class="amount">${icon('star', 34)}<span class="num">${s.earned}</span><span class="cur">pts</span></div><div class="note" style="display:inline-flex;margin:8px 0 0">${line}</div></div>
      <div class="stat-grid mb"><div class="stat lime"><div class="n">${s.stats.success}</div><div class="l">Kept it</div></div><div class="stat pink"><div class="n">${s.stats.miss}</div><div class="l">Missed</div></div><div class="stat lav"><div class="n">${s.stats.excused}</div><div class="l">Days off</div></div></div>
      <div class="card"><div class="card-title">Day by day <span class="link">${s.stats.rate !== null ? pct(s.stats.rate) : ''}</span></div>${days14(id)}<div class="kv mt"><span class="k">${icon('flame', 18)} Longest streak</span><span class="v">${s.stats.best} ${s.stats.best === 1 ? 'day' : 'days'}</span></div></div>
      ${s.circle ? `<div class="card tight clickable" onclick="App.go('circle',{id:'${s.circle.id}'})"><div class="list-row">${circleTile(s.circle, 'sm')}<div class="body"><div class="t">${esc(s.circle.name)}</div><div class="m">Who's leading?</div></div>${icon('chev', 18)}</div></div>` : ''}
      <button class="btn primary" onclick="App.again('${id}')">${icon('repeat', 20)} Another round?</button>
      <button class="btn text mt" onclick="App.tab('today')">Not now</button>`;
  };

  /* ============================================================
     S08 — הקבוצות שלי
     ============================================================ */
  SCREENS.circles = () => {
    const circles = Mila.myCircles();
    const S = Mila.getState();
    const proposals = circles.flatMap(c => Object.values(S.wordDefs).filter(d => d.circleId === c.id && d.kind === 'group' && d.status !== 'cancelled' && !Mila.myAdoption(d.id) && (d.endDate || '9999') >= Mila.today()).map(d => ({ d, c })));
    return `${topbar({ title: 'My groups', back: false, end: `<button class="icon-btn lime" aria-label="New group" onclick="App.circleAddSheet()">${icon('plus', 22)}</button>` })}
      ${circles.length ? circles.map(c => {
        const members = Mila.circleMembers(c.id);
        const words = Object.values(S.wordDefs).filter(d => Mila.inCircle(d, c.id) && d.status !== 'cancelled' && (d.kind === 'group' ? (d.endDate || '9999') >= Mila.today() : d.visibility !== 'private' && Object.values(S.commitments).some(k => k.defId === d.id && k.status === 'active'))).length;
        const ri = Mila.rankInsight(c.id); const rd = Mila.circleRound(c.id);
        return `<div class="row-card" onclick="App.go('circle',{id:'${c.id}'})">${avatarStack(members, 34, 3)}<div class="body"><div class="t">${esc(c.name)}</div><div class="m">${ri && ri.place ? `#${ri.place} of ${ri.total} · ` : ''}Day ${rd.dayIndex}${Mila.isAdmin(c.id) ? " · you're an admin" : ''}</div></div>${icon('chev', 20)}</div>`;
      }).join('') : emptyState({ mood: 'wink', title: "It's easier to keep your word with friends", text: 'Open a group and invite friends. Everyone picks their own challenges, and you all see who sticks with it.', actions: `<button class="btn primary" onclick="App.go('circleNew')">Open a group</button><button class="btn ghost" onclick="App.joinByCodeSheet()">I have a code from a friend</button>` })}

      ${proposals.length ? `<div class="section-title">Challenges waiting for you</div>${proposals.map(({ d, c }) => `<div class="word-row" onclick="App.go('groupWord',{id:'${d.id}'})">${wordTile(d)}<div class="body"><div class="name">${esc(d.title)}</div><div class="meta"><span class="chip outline">${esc(c.name)}</span><span class="chip lav">${Mila.adopters(d.id).length} in</span></div></div>${icon('chev', 18)}</div>`).join('')}` : ''}
`;
  };
  function circleAddSheet() {
    sheet(`<div class="sheet-title">A group with friends</div>
      <div class="list-row clickable" onclick="App.closeSheet(); App.go('circleNew')"><span class="tile sm lime">${icon('plus', 18)}</span><div class="body"><div class="t">Open a new group</div><div class="m">and invite friends to join</div></div>${icon('chev', 18)}</div>
      <div class="list-row clickable" onclick="App.joinByCodeSheet()"><span class="tile sm pink">${icon('link', 18)}</span><div class="body"><div class="t">Join a friend's group</div><div class="m">A friend sent you a code or a link? Enter it here.</div></div>${icon('chev', 18)}</div>`);
  }
  function joinByCodeSheet() {
    sheet(`<div class="sheet-title">Join a friend's group</div><div class="sheet-sub">Type the code from the message you got (6 characters), or paste the whole link.</div>
      <div class="input-row"><input class="input ltr" id="join-code" placeholder="ABC123" maxlength="200" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.15em;text-align:center"><button class="btn dark sm" onclick="App.joinByCode()">Continue</button></div>
`);
    setTimeout(() => $('#join-code') && $('#join-code').focus(), 50);
  }
  async function joinByCode() {
    const raw = ($('#join-code').value || '').trim();
    const m = raw.match(/invite=([A-Za-z0-9]+)/);
    const token = (m ? m[1] : raw).toUpperCase();
    try {
      const p = await Store().previewInvite(token);
      if (!p.ok) return toast(p.reason === 'not_found' ? 'That code was not found.' : p.reason === 'expired' ? 'That code has expired. Ask for a new one.' : 'That code is not valid.');
      closeSheet(true); go('invite', { token });
    } catch (e) { fail(e); }
  }
  /* טוען תצוגה מקדימה של הזמנה (בענן – מהשרת) ואז מנווט */
  async function openInvite(token) {
    // ההזמנה השמורה מוצגת פעם אחת למשתמשת מחוברת, ואז נמחקת מהמכשיר (לא קופצת שוב בכל פתיחה; הקישור עצמו עדיין עובד)
    try { await Store().previewInvite(token); clearInvite(); go('invite', { token }); } catch (e) { clearInvite(); fail(e); }
  }

  /* ============================================================
     S10 — יצירת קבוצה
     ============================================================ */
  /* חברות שכבר איתי במילה: מי שנמצאת איתי בקבוצה כלשהי (חוץ ממי שכבר בקבוצה exceptCircleId) */
  function myFriends(exceptCircleId) {
    const meId = Mila.me().id; const seen = new Map();
    for (const c of Mila.myCircles()) for (const u of Mila.circleMembers(c.id)) if (u.id !== meId && !u.deleted && !seen.has(u.id)) seen.set(u.id, u);
    const inside = exceptCircleId ? new Set(Mila.circleMembers(exceptCircleId).map(u => u.id)) : new Set();
    return [...seen.values()].filter(u => !inside.has(u.id));
  }
  const friendRow = (u, on, handler) => `<div class="pick-row friend-row ${on ? 'on' : ''}" onclick="${handler}">${avatar(u, 34)}<div class="body"><div class="t">${esc(u.name)}</div></div><span class="box">${on ? icon('check', 14) : ''}</span></div>`;
  /* גיליון: להזמין לקבוצה קיימת חברות שכבר במילה */
  let fsel = null;
  function friendsSheet(circleId) {
    if (!fsel || fsel.circleId !== circleId) fsel = { circleId, ids: [] };
    const list = myFriends(circleId); const c = Mila.getState().circles[circleId];
    sheet(`<div class="sheet-title">Invite friends already on Mila</div><div class="sheet-sub">They'll get an invite to “${esc(c.name)}” inside the app, and join with one tap. No link.</div>
      ${list.length ? list.map(u => friendRow(u, fsel.ids.includes(u.id), `App.friendToggle('${u.id}')`)).join('') : '<div class="tiny muted">All your friends are already in this group.</div>'}
      <button class="btn primary mt" ${fsel.ids.length ? '' : 'disabled'} onclick="App.friendsInvite()">${fsel.ids.length > 1 ? `Invite ${fsel.ids.length} friends` : 'Invite'}</button>`);
  }
  function friendToggle(id) { fsel.ids = fsel.ids.includes(id) ? fsel.ids.filter(x => x !== id) : [...fsel.ids, id]; friendsSheet(fsel.circleId); }
  const friendsInvite = once(async () => {
    try {
      const r = await Store().inviteFriends(fsel.circleId, fsel.ids); fsel = null; closeSheet(true);
      toast(r.invited ? (r.invited === 1 ? 'Invite sent to 1 friend.' : `Invite sent to ${r.invited} friends.`) : 'Already in the group.', 'lime');
    } catch (e) { fail(e); }
  });
  function cwFriend(id) { cwiz.friends = (cwiz.friends || []).includes(id) ? cwiz.friends.filter(x => x !== id) : [...(cwiz.friends || []), id]; render(); const i = $('#cw-name'); if (i) i.value = cwiz.name; }

  /* שורת מקומות: מי שכבר בפנים ומקומות פנויים. קבוצה היא יותר משתיים, וזה צריך להיראות ככה. */
  function seats(users, total = 5) {
    const u = users.filter(Boolean).slice(0, total); const free = total - u.length;
    return `<div class="seats" aria-hidden="true">${u.map((x, i) => `<span class="seat" style="--i:${i}">${avatar(x, 38)}</span>`).join('')}${Array.from({ length: free }, (_, i) => `<span class="seat free" style="--i:${u.length + i}">${icon('plus', 15)}</span>`).join('')}</div>`;
  }

  SCREENS.circleNew = () => {
    if (!cwiz) cwiz = { name: '', description: '', whoCanPropose: 'all', maxMembers: 8, color: 'pink', friends: [] };
    const friends = myFriends();
    return `${topbar({ title: 'New group' })}
      <div class="step-title">What's the group called?</div>
      <div class="field"><label for="cw-name">Group name</label><input class="input" id="cw-name" placeholder="e.g. The office crew" maxlength="50" value="${esc(cwiz.name)}" oninput="App.cwSet('name', this.value)" onkeydown="if(event.key==='Enter')App.cwCreate()"></div>
      <div class="hint">You can change it later when managing the group.</div>
      ${seats([Mila.me(), ...friends.filter(u => (cwiz.friends || []).includes(u.id))])}
      <div class="tiny muted">Up to ${cwiz.maxMembers} people in a group. Everyone picks their own challenges.</div>
      ${friends.length ? `<div class="section-title">Who's in the group? <small>friends already with you on Mila</small></div>
        ${friends.map(u => friendRow(u, (cwiz.friends || []).includes(u.id), `App.cwFriend('${u.id}')`)).join('')}
        <div class="tiny muted mt">They'll get an invite inside the app. You invite new friends later with a link.</div>` : ''}
      <div class="mt-lg"><button class="btn primary" ${cwiz.name.trim() ? '' : 'disabled'} onclick="App.cwCreate()">${(cwiz.friends || []).length ? 'Open the group and invite them' : 'Open and invite friends'}</button></div>`;
  };
  function cwSet(k, v) { cwiz[k] = v; const b = $('#screen .btn.primary'); if (b) b.disabled = !cwiz.name.trim(); }
  const cwCreate = once(async () => {
    try {
      const picked = (cwiz.friends || []).slice();
      const { circle } = await Store().createCircle({ name: cwiz.name, description: cwiz.description, whoCanPropose: cwiz.whoCanPropose, maxMembers: Math.max(cwiz.maxMembers, picked.length + 1), color: cwiz.color });
      cwiz = null;
      stack = [{ name: 'circles', params: {} }];
      stack.push({ name: 'circle', params: { id: circle.id } });
      if (picked.length) {
        // חברות שכבר במילה: הזמנה בתוך האפליקציה, בלי קישור
        let n = 0; try { n = (await Store().inviteFriends(circle.id, picked)).invited; } catch (e) { fail(e); }
        render(); window.scrollTo({ top: 0 });
        if (n) toast(n === 1 ? 'Group opened. Invite sent to 1 friend.' : `Group opened. Invite sent to ${n} friends.`, 'lime');
        return;
      }
      inviteFlow({ circleId: circle.id, created: true });
    } catch (e) { fail(e); }
  });

  /* ============================================================
     S09 — בתוך קבוצה
     ============================================================ */
  SCREENS.circle = ({ id }) => {
    const S = Mila.getState();
    const c = S.circles[id];
    if (!c || !Mila.isMember(id)) return `${topbar({ title: 'Group' })}${emptyState({ mood: 'oops', title: "You're not in this group", text: 'If a friend invited you, ask them for a new link.', actions: `<button class="btn primary" onclick="App.tab('circles')">Go to my groups</button>`, card: false })}`;
    const meId = Mila.me().id;
    const members = Mila.circleMembers(id).slice().sort((x, y) => (x.id === meId ? -1 : y.id === meId ? 1 : 0));
    const round = Mila.circleRound(id);
    const left = Math.max(0, Mila.RULES.ROUND_DAYS - round.dayIndex);
    const today = Mila.today();
    // מי עשתה מה היום: לכל חברה, האתגרים שלה בקבוצה הזו ומה דיווחה
    const todayObs = Object.values(S.obligations).filter(o => o.localDate === today && o.status !== 'cancelled');
    const itemsOf = (uid) => todayObs.filter(o => o.userId === uid).map(o => { const k = Mila.commitment(o.commitmentId); const d = k && Mila.wordDef(k.defId); return d && Mila.inCircle(d, id) ? { o, d } : null; }).filter(Boolean);
    const stateOf = (o) => o.outcome === 'success' ? ['done', 'Kept it'] : o.outcome === 'miss' ? ['miss', 'Missed'] : o.outcome === 'excused' ? ['skip', 'Day off'] : ['wait', 'Not yet'];
    // פרגונים על ימים מסוימים: מה שאני שלחתי (הלב מתמלא), ומה שקיבלתי (מונה קטן בשורה שלי)
    const hearts = S.socialEvents.filter(e => e.type === 'encouragement' && e.payload && e.payload.obligationId);
    const cheered = (obId) => cheeredNow.has(obId) || hearts.some(e => e.actorId === meId && e.payload.obligationId === obId);
    const heartsOn = (obId) => hearts.filter(e => e.payload.toUserId === meId && e.payload.obligationId === obId).length;
    const todayRows = members.map(u => {
      const mine = u.id === meId; const items = itemsOf(u.id);
      const doneN = items.filter(x => x.o.outcome === 'success').length;
      /* השורה עצמה היא הפעולה, בלי כפתורים נוספים:
         אצלי – לחיצה מדווחת. אצל חברה – לב קטן כשדיווחה (לחיצה מפרגנת לה על היום הזה), ו״נו?״ כשעוד לא דיווחה. */
      const nudged = poked[u.id] && Date.now() - poked[u.id] < 6 * 3600000;
      /* רשימה שקטה: בלי רקעים צבעוניים. סימון קטן בתחילת השורה אומר מה המצב (מלא = עמדה, ריק = עוד לא דיווחה, קו = לא היום),
         ומילה רק כשצריך. ״נו?״ מופיע פעם אחת לכל חברה, בשורה הראשונה שעוד לא דווחה. */
      const mark = (o) => o.outcome === 'success' ? `<span class="tg-m done">${icon('check', 11)}</span>` : o.outcome ? '<span class="tg-m off"></span>' : '<span class="tg-m"></span>';
      const firstWait = items.findIndex(x => !x.o.outcome);
      const list = items.length ? items.map(({ o, d }, n) => {
        const [cls, txt] = stateOf(o); const title = `<span class="tg-t">${esc(d.title)}</span>`;
        if (mine) {
          const h = heartsOn(o.id); const hearts = h ? `<span class="tg-h" aria-label="${h === 1 ? '1 friend cheered' : h + ' friends cheered'}">${icon('heart', 13)}${h > 1 ? h : ''}</span>` : '';
          const tail = !o.outcome ? '<span class="tg-go">Check in</span>' : o.outcome === 'success' ? '' : `<span class="tg-s">${txt}</span>`;
          return `<button class="tg-item ${cls}" aria-label="${esc(d.title)}: ${o.outcome ? txt : 'Check in'}" onclick="App.reportSheet('${o.id}')">${mark(o)}${title}${hearts}${tail}</button>`;
        }
        if (!o.outcome) {
          if (n !== firstWait) return `<div class="tg-item wait" aria-label="${esc(d.title)}: ${txt}">${mark(o)}${title}</div>`;
          return `<button class="tg-item wait" ${nudged ? 'disabled' : ''} aria-label="${esc(d.title)}: ${txt}. Send ${esc(u.name)}: So, how's it going?" onclick="App.poke('${id}','${u.id}')">${mark(o)}${title}<span class="tg-a ${nudged ? 'sent' : 'nu'}">${nudged ? 'Sent' : 'Nudge'}</span></button>`;
        }
        if (o.outcome === 'excused') return `<div class="tg-item ${cls}">${mark(o)}${title}<span class="tg-s">${txt}</span></div>`;
        const loved = cheered(o.id);
        return `<button class="tg-item ${cls} ${loved ? 'loved' : ''}" ${loved ? 'disabled' : ''} aria-label="${esc(d.title)}: ${txt}. ${loved ? 'You cheered' : `Cheer ${esc(u.name)} on`}" onclick="App.cheer('${id}','${u.id}','${o.id}')">${mark(o)}${title}${o.outcome === 'miss' ? `<span class="tg-s">${txt}</span>` : ''}<span class="tg-a">${icon('heart', 16)}</span></button>`;
      }).join('')
        : `<div class="tg-none">${mine ? `You don't have a challenge yet. <a href="#" onclick="event.preventDefault(); App.openPick([], { circleId: '${id}' })">Pick one</a>` : 'No challenge yet'}</div>`;
      // הפרצוף קטן ויושב ליד השם, כדי שהשורות של האתגרים יקבלו את כל הרוחב
      return `<div class="tg-row ${mine ? 'me' : ''}"><div class="tg-body"><div class="tg-name"><span class="tg-who">${avatar(u, 22, items.length && doneN === items.length ? 'happy' : '')}${mine ? 'You' : esc(u.name)}</span>${items.length ? `<span class="tg-sum">${doneN} of ${items.length}</span>` : ''}</div>${list}</div></div>`;
    }).join('');
    // דירוג פשוט
    const { rows } = Mila.leaderboard(id);
    const ranked = rows.filter(r => r.ranked);
    const rankHtml = ranked.length ? ranked.map(r => `<div class="rk2 ${r.user.id === meId ? 'me' : ''}"><span class="rk2-p ${r.place === 1 ? 'first' : ''}">${r.place}</span><span class="rk2-n">${r.user.id === meId ? 'You' : esc(r.user.name)}</span><span class="rk2-pts">${r.success} pts</span><span class="rk2-v">${Math.round(r.rate * 100)}%</span></div>`).join('')
      : `<div class="tiny muted">The ranking starts after ${Mila.RULES.MIN_RANKED_EVENTS} check-ins from each person.</div>`;
    // אתגר משותף שמחכה לי
    const groupWords = Object.values(S.wordDefs).filter(d => d.circleId === id && d.kind === 'group' && d.status !== 'cancelled' && (d.endDate || '9999') >= today);
    const waiting = groupWords.filter(d => !Mila.myAdoption(d.id) && (Mila.adopters(d.id).length > 0 || d.ownerId === meId));   // אתגר שכולן עזבו לא מוצע יותר
    const waitHtml = waiting.slice(0, 2).map(sharedInviteCard).join('');
    const feed = Mila.feed(id, 30).filter(e => !(e.type === 'encouragement' && e.payload && e.payload.obligationId)).slice(0, 6);   // לב על יום מסוים נשאר בין שתיהן, לא ממלא את העדכונים
    return `${topbar({ title: c.name, subtitle: left === 0 ? `Day ${round.dayIndex} · last day` : `Day ${round.dayIndex} · ${left} ${left === 1 ? 'day' : 'days'} left`, end: `<button class="icon-btn lime" aria-label="Invite friends" onclick="App.inviteFlow({ circleId: '${id}' })">${icon('plus', 20)}</button><button class="icon-btn" aria-label="More" onclick="App.circleMenu('${id}')">${icon('more', 22)}</button>` })}
      ${waitHtml}
      <div class="section-title">Today in the group</div>
      <div class="card tight tg-card">${todayRows}</div>
      <div class="section-title">Who's leading?</div>
      <div class="card tight">${rankHtml}</div>
      ${feed.length ? `<div class="section-title">Recent activity</div><div class="card tight">${feed.map(e => `<div class="feed-item">${avatar(e.actor, 32)}<div class="body"><div class="t">${feedText(e)}</div><div class="m">${timeAgo(e.createdAt)}</div></div></div>`).join('')}</div>` : ''}
      <div class="btn-row mt"><button class="btn soft" onclick="App.inviteFlow({ circleId: '${id}' })">${icon('plus', 18)} Invite friends</button>${(c.whoCanPropose === 'all' || Mila.isAdmin(id)) ? `<button class="btn soft" onclick="App.openGroupWizard('${id}')">${icon('users', 18)} Shared challenge</button>` : ''}</div>
    `;
  };

  function feedText(e) {
    const t = e.payload && e.payload.title ? `“${esc(e.payload.title)}”` : '';
    // מה שאני עשיתי מנוסח אליי (״עמדת ב…״), לא בשם המלא שלי בגוף שלישי
    if (Mila.me() && e.actor.id === Mila.me().id) {
      switch (e.type) {
        case 'day_success': return `<b>You kept</b> ${t}`;
        case 'day_miss': return `<b>You missed</b> ${t}`;
        case 'day_excused': return `<b>Your day off</b>: ${t}`;
        case 'overtake': { const p = Mila.user(e.payload.passedUserId); return `<b>You passed</b> ${p ? esc(p.name) : 'a friend'} ${icon('trophy', 14)}`; }
        case 'streak': return `<b>${e.payload.streak} days in a row</b> for you: ${t} ${icon('flame', 14)}`;
        case 'group_word_proposed': return `<b>You opened</b> a shared challenge: ${t}`;
        case 'group_word_adopted': return `<b>You joined</b> ${t}`;
        case 'word_committed': return `<b>You started</b> ${t}`;
        case 'member_joined': { const by = e.payload && e.payload.inviterId && Mila.user(e.payload.inviterId); return `<b>You joined</b> the group${by ? `. ${esc(by.name)} invited you` : ''}`; }
        case 'circle_created': return `<b>You opened</b> the group`;
        case 'admin_transferred': return `<b>You're an admin</b> now`;
        case 'encouragement': { const to = Mila.user(e.payload.toUserId); return `<b>You sent</b> a kind word to ${to ? esc(to.name) : 'a friend'} ${icon(REACTION_ICON[e.payload.reaction] || 'clap', 14)}`; }
      }
    }
    const n = `<b>${esc(e.actor.name)}</b>`;
    switch (e.type) {
      case 'day_success': return `${n} kept ${t}`;
      case 'day_miss': return `${n} missed ${t}`;
      case 'overtake': { const p = Mila.user(e.payload.passedUserId); return `${n} passed ${p ? esc(p.name) : 'a friend'} ${icon('trophy', 14)}`; }
      case 'day_excused': return `${n} took a day off: ${t}`;
      case 'streak': return `${n} is at ${e.payload.streak} days in a row: ${t} ${icon('flame', 14)}`;
      case 'group_word_proposed': return `${n} opened a shared challenge: ${t}`;
      case 'group_word_adopted': return `${n} joined ${t}`;
      case 'word_committed': return `${n} started ${t}`;
      case 'member_joined': { const by = e.payload && e.payload.inviterId && Mila.user(e.payload.inviterId); return `${n} joined${by ? (Mila.me() && by.id === Mila.me().id ? '. Invited by you' : `. Invited by ${esc(by.name)}`) : ''}`; }
      case 'member_left': return `${n} left`;
      case 'member_removed': return `${n} removed a member`;
      case 'admin_transferred': return `${n} is an admin now`;
      case 'circle_created': return `${n} opened the group`;
      case 'encouragement': { const to = Mila.user(e.payload.toUserId); return `${n} sent a kind word to ${to ? esc(to.name) : 'a friend'} ${icon(REACTION_ICON[e.payload.reaction] || 'clap', 14)}`; }
      default: return `${n} · ${e.type}`;
    }
  }
  function timeAgo(iso) {
    const diff = (Date.now() - new Date(iso)) / 60000;
    if (diff < 1) return 'Just now'; if (diff < 60) return `${Math.round(diff)} min ago`;
    if (diff < 60 * 24) return `${Math.round(diff / 60)} hr ago`;
    const d = Mila.diffDays(Mila.toLocalDate(new Date(iso)), Mila.today());
    return d === 1 ? 'Yesterday' : d < 7 ? `${d} days ago` : Mila.fmtDate(Mila.toLocalDate(new Date(iso)));
  }
  /* פעולות על חברה: מילה טובה, (מנהלת:) להפוך למנהלת / להחזיר לחברה / להסיר, בטיחות */
  function memberSheet(circleId, userId) {
    const u = Mila.circleMembers(circleId).find(x => x.id === userId); if (!u) return;
    const admin = Mila.isAdmin(circleId);
    sheet(`<div class="sheet-hero">${avatar(u, 56)}<div class="sheet-title" style="margin-top:8px">${esc(u.name)}</div><div class="sheet-sub">${u.role === 'admin' ? 'Admin' : 'Member'} of the group</div></div>
      <div class="list-row clickable" onclick="App.encourageSheet('${circleId}','${userId}')"><span class="tile sm lime">${icon('clap', 18)}</span><div class="body"><div class="t">A kind word</div><div class="m">A little encouragement</div></div></div>
      ${admin && u.role !== 'admin' ? `<div class="list-row clickable" onclick="App.setRole('${circleId}','${userId}','admin')"><span class="tile sm lav">${icon('star', 18)}</span><div class="body"><div class="t">Make admin</div><div class="m">${esc(u.name)} will be able to manage the group with you</div></div></div>` : ''}
      ${admin && u.role === 'admin' ? `<div class="list-row clickable" onclick="App.setRole('${circleId}','${userId}','member')"><span class="tile sm gray">${icon('user', 18)}</span><div class="body"><div class="t">Make a regular member</div><div class="m">No admin permissions</div></div></div>` : ''}
      ${admin ? `<div class="list-row clickable" onclick="App.removeMember('${circleId}','${userId}')"><span class="tile sm pink">${icon('x', 18)}</span><div class="body"><div class="t">Remove from the group</div><div class="m">${esc(u.name)} leaves this group and keeps their own challenges and points.</div></div></div>` : ''}
      <div class="list-row clickable" onclick="App.safetySheet('${userId}','${circleId}')"><span class="tile sm gray">${icon('shield', 18)}</span><div class="body"><div class="t">Report or block</div><div class="m">If something is not right</div></div></div>`);
  }
  async function setRole(circleId, userId, role) { try { await Store().setMemberRole(circleId, userId, role); closeSheet(true); render(); toast(role === 'admin' ? 'Made admin.' : 'Back to a regular member.'); } catch (e) { fail(e); } }
  function removeMember(circleId, userId) {
    const u = Mila.user(userId);
    confirmSheet({ title: `Remove ${u.name}?`, sub: "They will no longer see the group. Only the group's shared challenge stops for them; their own challenges and points stay with them.", okText: 'Remove', okClass: 'pink', onOk: async () => { await Store().removeMember(circleId, userId); closeSheet(true); render(); toast('Removed from the group'); } });
  }
  function encourageSheet(circleId, toUserId) {
    const u = Mila.user(toUserId);
    sheet(`<div class="sheet-title">A kind word for ${esc(u.name)}</div>
      <div class="sheet-sub">Pick one, and ${esc(u.name)} gets a notification.</div>
      <div class="react-picker labeled">${Mila.REACTIONS.map(r => `<button onclick="App.sendEncouragement('${circleId}','${toUserId}','${r}')">${icon(REACTION_ICON[r], 24)}<small>${REACTION_LABEL[r]}</small></button>`).join('')}</div>`);
  }
  async function sendEncouragement(circleId, toUserId, reaction) { try { await Store().sendEncouragement(circleId, toUserId, reaction); closeSheet(true); toast('Sent.'); render(); FX.confetti(innerWidth / 2, innerHeight * .55, { n: 10, power: .9, items: ['💛', '💗', '✨'] }); } catch (e) { fail(e); } }
  function circleMenu(id) {
    const admin = Mila.isAdmin(id);
    const c = Mila.getState().circles[id];
    sheet(`<div class="sheet-title">${esc(c.name)}</div>
      ${c.whoCanPropose === 'all' || admin ? `<div class="list-row clickable" onclick="App.closeSheet(); App.openGroupWizard('${id}')"><span class="tile sm lav">${icon('pencil', 18)}</span><div class="body"><div class="t">Shared challenge</div><div class="m">Each friend chooses whether to join</div></div></div>` : ''}
      <div class="list-row clickable" onclick="App.closeSheet(); App.inviteFlow({ circleId: '${id}' })"><span class="tile sm lime">${icon('share', 18)}</span><div class="body"><div class="t">Invite friends</div><div class="m">One link for everyone</div></div></div>
      ${admin ? `<div class="list-row clickable" onclick="App.closeSheet(); App.go('circleManage',{id:'${id}'})"><span class="tile sm lav">${icon('settings', 18)}</span><div class="body"><div class="t">Manage group</div><div class="m">Name, members, permissions, closing</div></div></div>` : ''}
      <div class="list-row clickable" onclick="App.closeSheet(); App.safetySheet(null,'${id}')"><span class="tile sm gray">${icon('flag', 18)}</span><div class="body"><div class="t">Report</div><div class="m">Offensive content or pressure</div></div></div>
      <div class="list-row clickable" onclick="App.leaveCircle('${id}')"><span class="tile sm pink">${icon('logout', 18)}</span><div class="body"><div class="t">Leave the group</div><div class="m">Your own challenges keep going</div></div></div>`);
  }
  function leaveCircle(id) {
    confirmSheet({ title: 'Leave the group?', sub: "The group's shared challenge stops for you. Your own challenges and points stay yours.", okText: 'Leave', okClass: 'pink', onOk: async () => { await Store().leaveCircle(id); closeSheet(true); tab('circles'); toast('You left the group.'); } });
  }
  /* שלושה סוגי הזמנה. הטקסט נבנה מתבניות (בלי בינה מלאכותית) ואפשר לערוך לפני השליחה. */
  const INVITE_KINDS = {
    follow: { title: 'Help me keep my word', sub: 'A friend sees your progress.', cta: 'I want to invite a friend', icon: 'eye', tile: 'lav' },
    compete: { title: "Let's see you stick with it longer than me", sub: 'A friend picks 3 challenges of their own. You compete on who sticks with it.', cta: 'I want to invite a friend to compete', icon: 'trophy', tile: 'lime' },
    same: { title: 'Come on, we both need this', sub: 'A friend takes on the same challenge.', cta: 'I want to challenge a friend', icon: 'users', tile: 'pink' },
  };
  /* הודעות מוכנות להזמנה. הטון: חברה שמבקשת עזרה לעמוד במילה שלה, בביטחון. לא ״תראי אם אני נכשלת״. */
  const HELP_ME = 'Help me keep my word.';
  const INVITE_BY_LIBRARY = {
    food_no_delivery: { follow: [`14 days without ordering takeout. ${HELP_ME}`], same: ["14 days without ordering takeout. I'm in. You coming?"] },
    move_8000_steps: { follow: [`8,000 steps a day, 14 days. ${HELP_ME}`], same: ["8,000 steps a day. Let's see who moves more.", 'Are we walking the walk? Literally.'] },
    move_no_phone_bed: { follow: [`14 nights with no phone in bed. ${HELP_ME}`], same: ["My phone sleeps in the living room. I sleep in bed. 14 days. Let's see you do it."] },
    hab_no_impulse_buy: { follow: [`14 days without buying stuff I don't need. ${HELP_ME}`], same: ["14 days without buying stuff we don't need. I'm in. You coming?", 'No impulse buys. We both know we need this.'] },
    food_no_sweets_evening: { follow: [`No sweets after dinner, 14 days. ${HELP_ME}`], same: ["No sweets after dinner, 14 days. I'm in. You coming?"] },
  };
  function inviteMessages(kind, w, libraryId, group, days = 14) {
    const out = inviteMessages14(kind, w, libraryId, group);
    return days === 14 ? out : out.map(t => t.replace(/\b14 (days|nights)\b/g, `${days} $1`));   // אתגר של 21 יום: אותם נוסחים, עם המספר שלו
  }
  function inviteMessages14(kind, w, libraryId, group) {
    const n = Math.min(Math.max(Mila.me() ? Mila.activeCommitments().length : 3, 1), 3); const nA = n === 1 ? 'one challenge' : `${n} challenges`;
    if (group) {   // הזמנה לקבוצה: אותו קישור הולך לכמה חברות, אז ההודעה פונה לכולן
      if (kind === 'compete') return ["I started a group for us on Mila. 14 days, everyone picks up to 3 challenges. Who's in?", "14 days, 3 challenges, and one of us wins. Who's coming?", "I'm sure I'll stick with it longer than all of you. Prove me wrong."];
      if (kind === 'same') return w ? [`${w}, 14 days. I'm in. Who's with me?`, `${w} for 14 days. Let's see who sticks with it longer.`] : ["Same challenge, 14 days, all of us. Who's with me?"];
      return w ? [`I gave my word: ${w}, 14 days. ${HELP_ME}`, `${w}, 14 days. I said it. I'm doing it. Come be my witnesses.`] : [`I took on ${nA} for 14 days. ${HELP_ME}`, "I said it. I'm doing it. Come be my witnesses."];
    }
    const special = (libraryId && INVITE_BY_LIBRARY[libraryId]) || {};
    if (kind === 'compete') return [`I picked ${nA} for 14 days. Pick yours too. Let's see who sticks with it longer.`, '14 days, 3 challenges, one of us wins. You in?', "I'm sure I'll stick with it longer than you. Prove me wrong."];
    if (kind === 'same') return [...(special.same || []), ...(w ? [`${w}, 14 days. I'm in. You coming?`, `${w}. We both know we need this.`, `${w} for 14 days. Let's see who sticks with it longer.`] : ['Same challenge, 14 days, the two of us. You in?'])];
    return [...(special.follow || []), ...(w ? [`I gave my word: ${w}, 14 days. ${HELP_ME}`, `${w}, 14 days. Come see if I keep my word.`, `${w}, 14 days. I said it. I'm doing it. Come be my witness.`] : [`I took on ${nA} for 14 days. ${HELP_ME}`, `I took on ${nA} for 14 days. Come see if I keep my word.`, "I said it. I'm doing it. Come be my witness."])];
  }
  /* ============================================================
     הזמנת חברה — 3 צעדים: מה היא תעשה → ההודעה → נשלח (קישור וקוד תמיד גלויים)
     ============================================================ */
  const KIND_PLAIN = {
    follow: { emoji: '👀', title: 'See me keep my word', what: 'Your friend joins the group and sees every day whether you kept your word.', step3: 'Sees your progress',
      titleG: 'See me keep my word', whatG: 'They join the group and see every day whether you kept your word.', step3G: 'They see your progress' },
    compete: { emoji: '🏁', title: 'Compete with me', what: 'Your friend picks up to 3 challenges of their own, and you both join the ranking.', step3: 'Picks up to 3 challenges of their own and joins the ranking',
      titleG: 'Compete with me', whatG: 'Everyone picks up to 3 challenges of their own, and you all join the ranking.', step3G: 'They pick up to 3 challenges and join the ranking' },
    same: { emoji: '🤝', title: 'Do the same challenge with me', what: 'Your friend takes on one of your challenges for 14 days, and you compete on it.', step3: 'Starts the same challenge for 14 days',
      titleG: 'Do the same challenge with me', whatG: 'They take on one of your challenges for 14 days, and you all compete on it.', step3G: 'They start the same challenge for 14 days' },
  };
  function newInv(opts = {}) {
    const circles = Mila.myCircles();
    let wordTitle = opts.wordTitle || '', libraryId = opts.libraryId || null, circleId = opts.circleId || null, commitmentId = opts.commitmentId || null;
    let days = 14;
    if (commitmentId) { const k = Mila.commitment(commitmentId); const d = k && Mila.wordDef(k.defId); if (k) days = Mila.diffDays(k.startDate, k.endDate) + 1 === 21 ? 21 : 14; if (d) { wordTitle = d.title; libraryId = d.libraryId || null; circleId = circleId || d.circleId || null; } }
    if (!circleId && circles.length === 1) circleId = circles[0].id;
    return { created: !!opts.created, group: !commitmentId, days, step: 1, kind: opts.kind || (opts.created ? 'compete' : null), circleId, commitmentId, wordTitle, libraryId, newCircle: `${Mila.me().name} and friends`, message: null, idx: 0, token: null, busy: false };
  }
  function inviteFlow(opts = {}) { inv = newInv(opts); go('inviteNew', {}, { replace: stack.length > 0 && current().name === 'inviteNew' }); }
  function myActiveWords() { return Mila.activeCommitments().map(k => ({ k, d: Mila.wordDef(k.defId) })).filter(x => x.d); }
  SCREENS.inviteNew = () => {
    if (!inv) inv = newInv();   // בלי go() בתוך ציור המסך
    const circles = Mila.myCircles();
    const dots = `<div class="steps">${[1, 2, 3].map(i => `<i class="${i <= inv.step ? 'on' : ''}"></i>`).join('')}</div>`;
    const g = inv.group;   // הזמנה לקבוצה (לא לאתגר מסוים): מדברות ברבים
    const head = topbar({ title: g ? 'Invite friends' : 'Invite a friend', start: `<button class="icon-btn" aria-label="Back" onclick="App.invHeadBack()">${icon('back', 24)}</button>`, back: false, end: `<button class="icon-btn" aria-label="Close" onclick="App.inviteClose()">${icon('x', 22)}</button>` });
    const circleName = inv.circleId ? (Mila.getState().circles[inv.circleId] || {}).name : inv.newCircle;
    // אחרי פתיחת קבוצה: להבהיר שזה השלב הבא בכוונה, ושאפשר לדלג
    const created = inv.created && inv.step < 3 ? `<div class="created-note"><div><b>The group “${esc(circleName || '')}” is ready.</b><br>Now invite your friends.${inv.circleId ? seats(Mila.circleMembers(inv.circleId)) : ''}</div><button class="btn text sm" onclick="App.inviteClose()">Later</button></div>` : '';
    if (inv.step === 1) {
      const words = myActiveWords();
      const needWord = inv.kind === 'same' && !inv.wordTitle;
      const ready = inv.kind && !(inv.kind === 'same' && !inv.wordTitle) && (inv.circleId || (inv.newCircle || '').trim());
      return `${head}${dots}${created}
        ${inv.circleId && myFriends(inv.circleId).length ? `<button class="btn soft mb" onclick="App.friendsSheet('${inv.circleId}')">${icon('users', 18)} Friends already on Mila: invite with one tap</button>` : ''}
        <div class="step-title">${g ? 'What do you want them to do?' : 'What do you want your friend to do?'}</div><div class="step-sub">${g ? 'Choose, then write them a message.' : 'Choose, then write a personal message.'}</div>
        ${Object.entries(KIND_PLAIN).map(([k, v]) => `<div class="choice inv-kind ${inv.kind === k ? 'on' : ''}" onclick="App.invSet('kind','${k}')"><span class="radio">${inv.kind === k ? icon('check', 14) : ''}</span><div class="body"><div class="t">${v.emoji} ${g ? v.titleG : v.title}</div><div class="m">${g ? v.whatG : v.what}</div></div></div>`).join('')}
        ${inv.kind === 'same' ? `<div class="field mt"><label>Which challenge?</label>${words.length ? `<div class="chips">${words.map(({ d }) => `<button class="chip select ${inv.wordTitle === d.title ? 'on' : ''}" onclick="App.invWord('${d.id}')">${icon(d.icon, 15)} ${esc(d.title)}</button>`).join('')}</div>` : `<div class="note">${icon('info', 18)}<span>You don't have an active challenge yet. Pick a challenge first, or invite ${g ? 'them' : 'your friend'} to compete.</span></div>`}</div>` : ''}
        ${inv.created ? '' : `<div class="field mt"><label>${g ? 'Which group are they joining?' : 'Which group is your friend joining?'}</label>
          ${circles.length ? `<div class="chips">${circles.map(c => `<button class="chip select ${inv.circleId === c.id ? 'on' : ''}" onclick="App.invSet('circleId','${c.id}')">${esc(c.name)}</button>`).join('')}<button class="chip select ${!inv.circleId ? 'on' : ''}" onclick="App.invSet('circleId', null)">${icon('plus', 14)} New group</button></div>` : ''}
          ${!inv.circleId ? `<input class="input ${circles.length ? 'mt' : ''}" maxlength="50" placeholder="A name for your group" value="${esc(inv.newCircle)}" oninput="App.invNewCircle(this.value)"><div class="hint">We'll open a new group. You're the admin.</div>` : ''}
        </div>`}
        <div class="mt-lg"><button class="btn primary" id="inv-next" ${ready ? '' : 'disabled'} onclick="App.invNext()">Continue</button></div>
        ${needWord && !words.length ? '' : ''}`;
    }
    if (inv.step === 2) {
      const msgs = inviteMessages(inv.kind, inv.wordTitle, inv.libraryId, inv.group, inv.days);
      if (inv.message === null) inv.message = msgs[0];
      const v = KIND_PLAIN[inv.kind];
      return `${head}${dots}${created}
        <div class="step-title">Your message</div><div class="step-sub">${g ? 'You can edit it. The same link works for all your friends, so you can send it to a whole WhatsApp group.' : 'You can edit it. The link is added automatically.'}</div>
        <div class="wa-bubble"><textarea id="inv-msg" aria-label="${g ? 'Message to your friends' : 'Message to your friend'}" maxlength="200" rows="3" oninput="App.inviteMsg(this.value)">${esc(inv.message)}</textarea><div class="wa-link">🔗 mila.mila-app.workers.dev/?invite=…</div></div>
        <button class="btn text xs" onclick="App.inviteRotate()">${icon('repeat', 14)} Another version</button>
        <div class="card tight mt"><div class="card-title">${g ? 'What happens when they tap the link' : 'What happens when your friend taps the link'}</div>
          <ol class="inv-steps"><li>${g ? 'They sign in' : 'Signs in'} with Google. It takes 10 seconds.</li><li>${g ? 'They join' : 'Joins'} the group <b>${esc(circleName)}</b>.</li><li>${g ? v.step3G : v.step3}${inv.kind === 'same' ? `: <b>${esc(inv.wordTitle)}</b>` : ''}.</li></ol>
        </div>
        <button class="btn primary mt" ${inv.busy ? 'disabled' : ''} onclick="App.inviteSend('whatsapp')">${inv.busy ? 'One moment…' : '💬 Send on WhatsApp'}</button>
        <div class="btn-row mt"><button class="btn soft" ${inv.busy ? 'disabled' : ''} onclick="App.inviteSend('share')">${icon('share', 18)} Share another way</button><button class="btn soft" ${inv.busy ? 'disabled' : ''} onclick="App.inviteSend('copy')">${icon('copy', 18)} Copy</button></div>`;
    }
    const url = Mila.inviteUrl(inv.token);
    return `${head}${dots}${created}
      <div class="sheet-hero"><div class="inv-done">🎉</div><div class="sheet-title">Your invite is out</div><div class="sheet-sub">${g ? `Every friend who joins will show up in ${esc(circleName)}, and you'll get an update.` : `When your friend joins you'll get an update, and they'll show up in ${esc(circleName)}.`}</div>${g && inv.circleId ? seats(Mila.circleMembers(inv.circleId)) : ''}</div>
      <div class="card tight"><div class="card-title">Didn't go through? Here's the link</div>
        <div class="inv-link ltr">${esc(url)}</div>
        <div class="btn-row mt"><button class="btn soft sm" onclick="App.copyText('${esc(url)}')">${icon('copy', 16)} Copy the link</button><button class="btn soft sm" onclick="App.copyText('${inv.token}')">${icon('copy', 16)} Code: <span class="ltr" style="letter-spacing:.12em">${inv.token}</span></button></div>
        <div class="tiny muted mt">${g ? "The same link and code work for all your friends. The code goes in “Join a friend's group”. Valid for 7 days." : "You can also read the code out to your friend. They enter it in “Join a friend's group”. Valid for 7 days."}</div>
      </div>
      <button class="btn primary mt" onclick="App.inviteFlow({ circleId: '${inv.circleId}' })">${icon('plus', 18)} ${g ? 'Invite more friends' : 'Invite another friend'}</button>
      <button class="btn text mt" onclick="App.inviteDone()">Go to the group</button>`;
  };
  function invSet(k, v) { inv[k] = v; if (k === 'kind') { inv.message = null; if (v !== 'same' && !inv.commitmentId) { inv.wordTitle = ''; inv.libraryId = null; } } render(); }
  function invWord(defId) { const d = Mila.wordDef(defId); inv.wordTitle = d.title; inv.libraryId = d.libraryId || null; inv.message = null; render(); }
  function invNewCircle(v) { inv.newCircle = v; const b = $('#inv-next'); if (b) b.disabled = !(inv.kind && !(inv.kind === 'same' && !inv.wordTitle) && v.trim()); }
  function invNext() { inv.step = 2; render(); window.scrollTo({ top: 0 }); }
  function invBack() { inv.step = 1; render(); }
  function invHeadBack() { if (inv && inv.step === 2) invBack(); else inviteClose(); }
  function inviteClose() { const cid = inv && inv.circleId; const created = inv && inv.created; inv = null; popAll('inviteNew', cid ? 'circles' : 'today'); if (created) afterFirstCommit(); }
  function inviteDone() { const cid = inv.circleId; const created = inv.created; inv = null; stack = [{ name: 'circles', params: {} }]; go('circle', { id: cid }); if (created) afterFirstCommit(); }
  function inviteRotate() { const msgs = inviteMessages(inv.kind, inv.wordTitle, inv.libraryId, inv.group, inv.days); inv.idx = (inv.idx + 1) % msgs.length; inv.message = msgs[inv.idx]; const t = $('#inv-msg'); if (t) t.value = inv.message; }
  function inviteMsg(v) { inv.message = v; }
  async function inviteSend(how) {
    if (inv.busy) return;
    inv.busy = true; render();
    try {
      if (!inv.circleId) { const { circle } = await Store().createCircle({ name: inv.newCircle.trim() || 'Our group', color: 'pink' }); inv.circleId = circle.id; }
      const r = await Store().createInvite(inv.circleId, { kind: inv.kind, message: inv.message, libraryId: inv.libraryId, wordTitle: inv.wordTitle });
      inv.token = r.token;
      const text = `${(inv.message || '').trim()}\n${Mila.inviteUrl(r.token)}`;
      inv.busy = false; inv.step = 3; render(); window.scrollTo({ top: 0 });
      setTimeout(() => FX.confetti(innerWidth / 2, innerHeight * .25, { n: 30, power: 1.4 }), 120);
      if (how === 'whatsapp') { window.location.href = `https://wa.me/?text=${encodeURIComponent(text)}`; return; }
      if (how === 'share' && navigator.share) { try { await navigator.share({ text }); } catch (e) { /* בוטל */ } return; }
      await copyText(text);
    } catch (e) { inv.busy = false; render(); fail(e); }
  }
  async function rotateInvite(circleId) { try { await Store().revokeCircleInvites(circleId); toast('New code. The old codes were canceled.'); render(); } catch (e) { fail(e); } }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); toast('Copied.'); return true; } catch (e) { /* נופלות לשיטה הישנה */ }
    try { const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); if (ok) { toast('Copied.'); return true; } } catch (e) { /* */ }
    toast("We couldn't copy it. You can select it and copy it manually."); return false;
  }

  /* ---------- S20 — ניהול קבוצה ---------- */
  SCREENS.circleManage = ({ id }) => {
    const c = Mila.getState().circles[id];
    if (!c || !Mila.isAdmin(id)) return `${topbar({ title: 'Manage' })}${emptyState({ mood: 'oops', title: 'Only the group admin can come in here', actions: backBtn(), card: false })}`;
    const members = Mila.circleMembers(id); const meId = Mila.me().id;
    const iv = Object.values(Mila.getState().invites).filter(i => i.circleId === id && i.status === 'active').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return `${topbar({ title: 'Manage group', subtitle: c.name })}
      <div class="section-title" style="margin-top:4px">Details</div>
      <div class="card tight">
        <div class="field"><label>Name</label><input class="input" value="${esc(c.name)}" maxlength="50" onchange="App.cmSet('${id}','name',this.value)"></div>
        <div class="field"><label>Description</label><input class="input" value="${esc(c.description)}" maxlength="120" placeholder="What are we about?" onchange="App.cmSet('${id}','description',this.value)"></div>
        <div class="field" style="margin-bottom:4px"><label>Color</label><div class="chips">${Mila.AVATAR_COLORS.map(col => `<button class="chip select ${c.color === col ? 'on' : ''}" aria-label="${col}" onclick="App.cmSet('${id}','color','${col}')"><span class="tile sm ${COLOR_TO_TILE[col]}" style="width:18px;height:18px"></span></button>`).join('')}</div></div>
      </div>
      <div class="section-title">Members <small>${members.length} of ${c.maxMembers}</small></div>
      <div class="card tight">${members.map(u => `<div class="list-row ${u.id !== meId ? 'clickable' : ''}" ${u.id !== meId ? `onclick="App.memberSheet('${id}','${u.id}')"` : ''}>${avatar(u, 36)}<div class="body"><div class="t">${esc(u.name)}${u.id === meId ? ' (you)' : ''}${u.role === 'admin' ? ' <span class="chip lime">Admin</span>' : ''}</div></div>${u.id !== meId ? icon('chev', 18) : ''}</div>`).join('')}
        <button class="btn ghost sm mt" onclick="App.inviteFlow({ circleId: '${id}' })">${icon('plus', 16)} Invite friends</button></div>
      <div class="section-title">Rules</div>
      <div class="card tight">
        <div class="field"><label>Who can start a shared challenge?</label><div class="seg"><button class="${c.whoCanPropose === 'all' ? 'on' : ''}" onclick="App.cmSet('${id}','whoCanPropose','all')">Anyone</button><button class="${c.whoCanPropose === 'admins' ? 'on' : ''}" onclick="App.cmSet('${id}','whoCanPropose','admins')">Admins only</button></div><div class="hint">Each friend chooses whether to join.</div></div>
        <div class="field" style="margin-bottom:4px"><label>How many members at most?</label><div class="chips">${[4, 6, 8, 12, 20].map(n => `<button class="chip select ${c.maxMembers === n ? 'on' : ''}" ${n < members.length ? 'disabled' : ''} onclick="App.cmSet('${id}','maxMembers',${n})">${n}</button>`).join('')}</div></div>
      </div>
      <div class="section-title">Invite code</div>
      <div class="card tight">${iv ? `<div class="kv"><span class="k">Code</span><span class="v ltr" style="letter-spacing:.15em">${iv.token || (iv.hint + '····')}</span></div><div class="kv"><span class="k">Valid until</span><span class="v">${Mila.fmtDate(Mila.toLocalDate(new Date(iv.expiresAt)))}</span></div><div class="kv"><span class="k">Joined with it</span><span class="v">${iv.uses}</span></div>` : '<div class="small muted">No active code.</div>'}
        <button class="btn soft sm mt" onclick="App.rotateInvite('${id}')">New code (cancels the old ones)</button></div>
      <div class="section-title">Close the group</div>
      <div class="card tight danger-zone"><div class="small muted mb">The group's shared challenges stop, and everyone leaves it. Each person keeps their own challenges, points and history.</div>
        <button class="btn danger" onclick="App.deleteCircle('${id}')">${icon('trash', 18)} Close the group</button></div>`;
  };
  function deleteCircle(id) {
    const c = Mila.getState().circles[id];
    const n = Mila.circleMembers(id).length - 1;
    confirmSheet({ title: `Close ${c.name}?`, sub: `${n > 0 ? `${n === 1 ? '1 friend leaves the group and gets' : `${n} friends leave the group and get`} a notification. ` : ''}The group's shared challenges stop. This can't be undone.`, okText: 'Close the group', okClass: 'danger', onOk: async () => { await Store().deleteCircle(id); closeSheet(true); stack = []; go('circles', {}, { reset: true }); toast('The group was closed.'); } });
  }
  async function cmSet(id, k, v) { try { await Store().updateCircle(id, { [k]: v }); render(); } catch (e) { fail(e); } }

  /* ============================================================
     S11 — קבלת הזמנה
     ============================================================ */
  SCREENS.invite = ({ token }) => {
    const p = Store().cachedPreview(token) || { ok: false, reason: 'not_found' };
    if (!p.ok) return `${topbar({ title: 'Invite' })}${emptyState({ mood: 'oops', title: p.reason === 'expired' ? 'This invite has expired' : p.reason === 'revoked' ? 'This invite was canceled' : p.reason === 'full' ? 'This invite has already been used' : "We couldn't find this invite", text: 'Ask your friend to send you a new link.', actions: `<button class="btn primary" onclick="App.tab('today')">Back to Today</button>` })}`;
    const kind = INVITE_KINDS[p.kind] ? p.kind : 'follow';
    const title = p.wordTitle || (p.challenge && p.challenge.title) || '';
    const hero = { inviter: p.inviter, circleName: p.circle.name, members: p.memberCount, message: p.message || '', kind, wordTitle: title };
    // כבר יש לה אתגרים: הם מופיעים בכל קבוצה שלה, ולכן אומרות לה את זה לפני שהיא מצטרפת (ולא מבקשות לבחור שוב)
    const shared = Mila.me() ? Mila.activeCommitments().filter(k => { const d = Mila.wordDef(k.defId); return d && d.kind === 'personal' && d.visibility !== 'private'; }).length : 0;
    const next = shared && kind !== 'same' ? `${shared === 1 ? 'Your challenge will show up' : `Your ${shared} challenges will show up`} in the group, and your friends will see your check-ins.` : kind === 'follow' ? `You'll see every day whether ${esc(String(p.inviter.name || '').split(' ')[0])} kept their word. No commitment on your side.` : kind === 'compete' ? 'After joining, you pick up to 3 challenges of your own and join the ranking.' : `After joining, you start ${title ? `“${esc(title)}”` : 'the same challenge'} for 14 days.`;
    return `${topbar({ title: 'Invite' })}
      <div class="inv-screen">${inviteHero(hero, { what: false })}</div>
      <div class="note lime">${icon('info', 18)}<span>${next}</span></div>
      ${p.alreadyMember ? `<button class="btn primary mt" onclick="App.go('circle',{id:'${p.circle.id}'})">You're already in</button>` : `<button class="btn primary mt" onclick="App.acceptInvite('${token}')">I'm in</button>`}
      <div class="btn-row mt"><button class="btn text" onclick="App.declineInvite('${token}')">Not this time</button><button class="btn text" onclick="App.safetySheet('${p.inviter.id}', null, '${token}')">${icon('flag', 16)} Report</button></div>`;
  };
  const acceptInvite = once(async (token) => {
    try {
      const p = Store().cachedPreview(token) || {};
      const c = await Store().acceptInvite(token);
      clearInvite();
      stack = [{ name: 'circles', params: {} }, { name: 'circle', params: { id: c.id } }];
      if (Mila.activeCommitments().length && p.kind !== 'same') { render(); window.scrollTo({ top: 0 }); toast("You're in. Your challenges are already in the group.", 'lime'); return; }   // אין מה לבחור או להביא: הם מופיעים בכל קבוצה שלה
      if (p.kind === 'compete') { render(); openPick([], { circleId: c.id }); toast("You're in. Now pick your challenges.", 'lime'); return; }
      if (p.kind === 'same') {
        if (p.libraryId) { render(); openPick([p.libraryId], { circleId: c.id }); }
        else { render(); openWordWizard({ title: p.wordTitle || '', circleId: c.id }); }
        toast("You're in.", 'lime'); return;
      }
      render(); window.scrollTo({ top: 0 }); toast("You're in.", 'lime');
    } catch (e) { fail(e); }
  });
  function declineInvite() { clearInvite(); back('circles'); }

  /* לב על יום של חברה: מתמלא מיד, והיא מקבלת התראה שאומרת על מה. בפעם הראשונה מסבירות מה קרה. */
  const cheeredNow = new Set();
  const cheer = once(async (circleId, toUserId, obId) => {
    if (cheeredNow.has(obId)) return;
    const u = Mila.user(toUserId); const name = u ? (u.name || '').split(' ')[0] : 'your friend';
    cheeredNow.add(obId); render({ keepSheet: true });
    const el = document.querySelector('.tg-item.loved[onclick*="' + obId + '"] .tg-a'); if (el) FX.pop(el, 'heart-pop');
    try {
      await Store().sendEncouragement(circleId, toUserId, 'heart', obId);
      let first = true; try { first = !localStorage.getItem('mila.cheered'); localStorage.setItem('mila.cheered', '1'); } catch (e) { /* ignore */ }
      if (first) toast(`You cheered ${name} on. They get a notification.`, 'lime');
    } catch (e) { cheeredNow.delete(obId); render({ keepSheet: true }); fail(e); }
  });

  function nudgeByWhatsapp(name) {
    const text = `So, how's it going? Are you keeping your word today?\n${location.origin}/?go=today`;
    sheet(`<button class="icon-btn sheet-x" aria-label="Close" onclick="App.closeSheet()">${icon('x', 22)}</button>
      <div class="sheet-title">Your nudge is waiting for ${esc(name)} on Mila</div>
      <div class="sheet-sub">They haven't turned on notifications yet, so they'll only see it when they open Mila. On WhatsApp they'll see it now.</div>
      <a class="btn dark" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener" onclick="App.closeSheet()">Send it on WhatsApp too</a>`);
  }
  /* ״נו, מה איתך?״ לחברה שעוד לא דיווחה היום. השרת שולח לה התראה, פעם ב-6 שעות. */
  const poked = {};
  const poke = once(async (circleId, toUserId) => {
    const u = Mila.user(toUserId); const name = u ? (u.name || '').split(' ')[0] : 'your friend';
    try {
      const r = await Store().poke(circleId, toUserId);
      if (r && (r.sent || r.reason === 'wait')) poked[toUserId] = Date.now();
      render({ keepSheet: true });
      // אין לה התראות: ה״נו״ מחכה לה בתוך מילה, אז מציעות לשלוח אותו גם בוואטסאפ (שם היא בטוח תראה)
      if (r && r.push === false && (r.sent || r.reason === 'wait')) { nudgeByWhatsapp(name); return; }
      toast(r && r.sent ? `Sent to ${name}: So, how's it going?` : r && r.reason === 'done' ? `${name} already checked in today.` : r && r.reason === 'wait' ? `You already nudged ${name}. You can nudge again in a few hours.` : 'Not sent.', r && r.sent ? 'lime' : '');
    } catch (e) { fail(e); }
  });


  /* ============================================================
     S12 — הצעת מילה קבוצתית
     ============================================================ */
  function openGroupWizard(circleId) { ideasOpen = false; ideasCat = 0; const r = Mila.circleRound(circleId); gwiz = { circleId, title: '', rule: '', icon: 'leaf', startDate: Mila.today(), visibility: 'status' }; go('groupWordNew'); }
  SCREENS.groupWordNew = () => {
    const c = Mila.getState().circles[gwiz.circleId];
    const others = Mila.circleMembers(gwiz.circleId).length - 1;
    const cap = Mila.capCheck(Mila.me().id, Mila.today());
    return `${topbar({ title: 'Shared challenge', subtitle: c.name })}
      <div class="step-title">Which challenge are you doing together?</div><div class="step-sub">You start it today, for 14 days. ${others ? `${others === 1 ? 'Your friend in the group gets' : `Your ${others} friends in the group get`} an invite to join, and you all see who sticks with it longer.` : 'Afterwards, invite a friend to do it with you.'}</div>
      ${templateChips('gwTemplate', gwiz.title)}
      <div class="field"><label>Challenge name</label><input class="input" placeholder="For example: 8,000 steps a day" maxlength="60" value="${esc(gwiz.title)}" oninput="App.gwSet('title', this.value)"></div>
      <div class="field"><label>What counts as success?</label><textarea class="input" maxlength="200" placeholder="A rule everyone can measure" oninput="App.gwSet('rule', this.value)">${esc(gwiz.rule)}</textarea></div>
      <div class="field"><label>Icon</label><div class="icon-picker">${Mila.WORD_ICONS.map(ic => `<span class="tile ${tileColorFor(gwiz.title || ic)} ${gwiz.icon === ic ? 'on' : ''}" aria-label="${ICON_HE[ic] || ic}" aria-pressed="${gwiz.icon === ic}" onclick="App.gwSet('icon','${ic}'); App.refresh()">${icon(ic, 24)}</span>`).join('')}</div></div>
      ${!cap.ok ? `<div class="note warn">${icon('info', 18)}<span>You already have 3 challenges, and that's the maximum. When one of them ends you can start a shared challenge.</span></div>` : ''}
      <div class="mt-lg"><button class="btn primary" ${cap.ok ? '' : 'disabled'} onclick="App.gwPropose()">${others ? 'Start and invite the group' : 'Start'}</button></div>`;
  };
  function gwSet(k, v) { gwiz[k] = v; }
  function gwTemplate(i) { const t = Mila.TEMPLATES[i]; gwiz.title = t.title; gwiz.rule = t.rule; gwiz.icon = t.icon; ideasOpen = false; render(); }
  const gwPropose = once(async () => {
    try {
      if (!String(gwiz.title || '').trim()) return toast("What's the challenge called?");
      if (!String(gwiz.rule || '').trim()) return toast('What counts as success?');
      const def = await Store().proposeGroupWord(gwiz.circleId, gwiz); const cid = gwiz.circleId; gwiz = null;
      const alone = Mila.circleMembers(cid).length <= 1;
      stack = [{ name: 'circles', params: {} }, { name: 'circle', params: { id: cid } }]; render(); window.scrollTo({ top: 0 });
      stamp('I gave my word.', alone ? 'Now invite a friend to do it with you.' : "You're in. Your friends got an invite to join.");
      const mine = Mila.myAdoption(def.id);
      if (alone && mine) setTimeout(() => { inviteFlow({ commitmentId: mine.id, kind: 'same' }); inv.step = 2; render(); }, 2700);
    } catch (e) { fail(e); }
  });

  /* הזמנה לקבוצה מחברה שכבר במילה: מופיעה במסך היום עד שמצטרפת או מוותרת (עד 7 ימים) */
  const GI_KEY = 'mila.gi.x';
  const giDismissed = () => { try { return JSON.parse(localStorage.getItem(GI_KEY) || '[]'); } catch (e) { return []; } };
  function groupInvites() {
    const S = Mila.getState(); const gone = giDismissed(); const seen = new Set();
    return Mila.notifications().filter(n => n.type === 'group_invite' && n.ref && n.ref.token && n.ref.circleId && !S.circles[n.ref.circleId] && !gone.includes(n.id) && Date.now() - new Date(n.createdAt) < 7 * 86400000 && !seen.has(n.ref.circleId) && seen.add(n.ref.circleId));
  }
  function groupInviteCard(n) {
    const by = n.ref.inviterId && Mila.user(n.ref.inviterId);
    return `<div class="card tight pastel-lime tg-invite"><div class="tg-inv-body"><div class="small muted">${by ? esc(by.name.split(' ')[0]) : 'A friend'} invited you to a group</div><div class="bold">${esc(n.ref.circleName || 'New group')}</div><button class="btn text xs gi-no" onclick="App.groupInviteNo('${n.id}')">Not now</button></div><button class="btn primary sm" onclick="App.groupInviteYes('${n.id}')">I'm in</button></div>`;
  }
  function groupInviteNo(id) { try { localStorage.setItem(GI_KEY, JSON.stringify([...giDismissed(), id].slice(-40))); } catch (e) { /* ignore */ } render(); }
  async function groupInviteYes(id) {
    const n = Mila.notifications().find(x => x.id === id); if (!n) return;
    try { await Store().previewInvite(n.ref.token); } catch (e) { /* ההצטרפות עצמה תגיד מה לא בסדר */ }
    const p = Store().cachedPreview(n.ref.token);
    if (p && p.ok === false) { groupInviteNo(id); return toast('This invite is no longer valid.'); }
    await acceptInvite(n.ref.token);
  }

  /* הזמנה לאתגר משותף (בקבוצה ובמסך היום): מי פתחה, מי כבר בפנים, והצטרפות בלחיצה אחת */
  function sharedInviteCard(d) {
    const meId = Mila.me().id; const owner = Mila.user(d.ownerId); const ad = Mila.adopters(d.id);
    const names = ad.map(u => esc(u.name.split(' ')[0]));
    const who = !ad.length ? '' : names.length === 1 ? `${names[0]} is already in` : names.length === 2 ? `${names[0]} and ${names[1]} are already in` : `${names[0]}, ${names[1]} and ${names.length - 2} more are already in`;
    const head = d.ownerId === meId ? 'The shared challenge you started' : `${esc(owner ? owner.name.split(' ')[0] : 'A friend')} invited you to a shared challenge`;
    return `<div class="card tight pastel-lime tg-invite"><div class="tg-inv-body" role="button" tabindex="0" onclick="App.go('groupWord',{id:'${d.id}'})"><div class="small muted">${head}</div><div class="bold">${esc(d.title)}</div>${who ? `<div class="tiny muted">${who}</div>` : ''}</div><button class="btn primary sm" onclick="App.adopt('${d.id}')">I'm in</button></div>`;
  }

  /* ============================================================
     S13 — אימוץ מילה קבוצתית
     ============================================================ */
  SCREENS.groupWord = ({ id, fresh }) => {
    const def = Mila.wordDef(id);
    if (!def || !Mila.isMember(def.circleId)) return `${topbar({ title: 'Challenge' })}${emptyState({ mood: 'oops', title: "This challenge isn't in your groups", actions: backBtn(), card: false })}`;
    const circle = Mila.getState().circles[def.circleId];
    const ad = Mila.adopters(id);
    const mine = Mila.myAdoption(id);
    const start = def.startDate < Mila.today() ? Mila.today() : def.startDate;
    const over = (def.endDate || '9999') < Mila.today();
    const cap = mine || over ? { ok: true } : Mila.capCheck(Mila.me().id, start);
    const owner = Mila.user(def.ownerId);
    const canCancel = !ad.length && (def.ownerId === Mila.me().id || Mila.isAdmin(def.circleId)) && def.status === 'proposed';
    const members = Mila.circleMembers(def.circleId); const inIds = new Set(ad.map(u => u.id));
    const notYet = members.filter(u => !inIds.has(u.id));
    return `${topbar({ title: 'Shared challenge', subtitle: circle.name })}
      <div class="sheet-hero">${wordTile(def, 'lg')}<div class="sheet-title">${esc(def.title)}</div><div class="sheet-sub" style="margin-bottom:8px">${esc(def.rule)}</div></div>
      <div class="note lime">${icon('users', 18)}<span>The same challenge for everyone who joins. Everyone checks in for themselves, and the group sees who sticks with it longer.</span></div>
      <div class="card tight"><div class="card-title">Who's in</div>
        ${ad.length ? ad.map(u => { const st = Mila.commitmentStats(u.commitmentId); return `<div class="list-row">${avatar(u, 36)}<div class="body"><div class="t">${u.id === Mila.me().id ? 'You' : esc(u.name)}${u.id === def.ownerId ? ' · started the challenge' : ''}</div><div class="m">${st.resolved ? `${st.success} of ${st.resolved} ${st.resolved === 1 ? 'day' : 'days'}${st.current >= 2 ? ` · ${st.current} in a row` : ''}` : 'Not yet'}</div></div></div>`; }).join('') : '<div class="tiny muted">No one yet.</div>'}
        ${notYet.length && !over ? `<div class="tiny muted" style="padding-top:8px">Haven't joined yet: ${notYet.map(u => u.id === Mila.me().id ? 'you' : esc(u.name.split(' ')[0])).join(', ')}</div>` : ''}
      </div>
      ${mine ? `<button class="btn ghost" onclick="App.go('word',{id:'${mine.id}'})">My days in this challenge</button>${members.length < 2 ? `<button class="btn primary mt" onclick="App.inviteFlow({ commitmentId: '${mine.id}', kind: 'same' })">Invite a friend to this challenge</button>` : ''}` :
        over ? `<div class="note">${icon('info', 18)}<span>This challenge has ended.</span></div>` :
        !cap.ok ? `<div class="note warn">${icon('info', 18)}<span>You already have 3 challenges, and that's the maximum. When one of them ends you can join.</span></div>` :
        `<button class="btn primary" onclick="App.adopt('${id}')">I'm in</button><div class="tiny muted center mt">Starts today, runs until ${Mila.fmtDate(def.endDate)}.</div>`}
      ${canCancel ? `<button class="btn text mt" onclick="App.cancelProposal('${id}')">Cancel the challenge</button>` : ''}`;
  };
  const adopt = once(async (id) => {
    try {
      const def = Mila.wordDef(id);
      await Store().adoptGroupWord(id); closeSheet(true);
      const cur = current(); if (cur.name === 'groupWord' || cur.name === 'circle' || cur.name === 'today') render(); else go('circle', { id: def.circleId });
      stamp("I'm in.", 'You start today. Every evening, mark whether you kept it.');
    } catch (e) { fail(e); if (e.code === 'CAP') render(); }
  });
  function cancelProposal(id) { confirmSheet({ title: 'Cancel this challenge?', sub: 'No one is in yet.', okText: 'Cancel it', cancelText: 'Keep it', okClass: 'pink', onOk: async () => { await Store().cancelProposal(id); closeSheet(true); back(); toast('Canceled.'); } }); }

  /* ============================================================
     S14 — הנקודות שלי
     ============================================================ */
  SCREENS.bank = () => {
    const b = Mila.bankSummary();
    const S = Mila.getState();
    const circles = Object.keys(b.byCircle).filter(k => k !== 'personal').map(k => S.circles[k]).filter(Boolean);
    const txs = b.transactions.filter(t => bankFilter === 'all' || (bankFilter === 'earn' ? t.type === 'EARN' : t.type !== 'EARN'));
    return `${topbar({ title: 'My points' })}
      <div class="card balance-card pastel-lime"><div class="label">Total points</div><div class="amount">${icon('star', 40)}<span class="num">${b.earnedTotal}</span><span class="cur">pts</span></div><div class="note" style="display:inline-flex;margin:6px 0 0;padding:6px 12px">One point for every day you kept your word.</div></div>
      <div class="stat-grid mb"><div class="stat lime"><div class="n">${b.earnedCurrentRound}</div><div class="l">This round</div></div><div class="stat pink"><div class="n">${b.missedCurrentRound}</div><div class="l">Missed</div></div><div class="stat lav"><div class="n">${b.pendingSlots}</div><div class="l">Still to earn</div></div></div>
      ${circles.length || b.byCircle.personal ? `<div class="card tight"><div class="card-title">By group</div>${circles.map(c => `<div class="kv"><span class="k">${circleTile(c, 'sm')} ${esc(c.name)}</span><span class="v"><span class="chip lime">${b.byCircle[c.id].earned} pts</span> <span class="chip pink">${b.byCircle[c.id].missed} missed</span></span></div>`).join('')}${b.byCircle.personal ? `<div class="kv"><span class="k"><span class="tile sm gray">${icon('lock', 18)}</span> Only me</span><span class="v"><span class="chip lime">Earned ${b.byCircle.personal.earned}</span> <span class="chip pink">Missed ${b.byCircle.personal.missed}</span></span></div>` : ''}</div>` : ''}
      <div class="section-title">Day by day</div>
      <div class="seg mb"><button class="${bankFilter === 'all' ? 'on' : ''}" onclick="App.bankFilter('all')">All</button><button class="${bankFilter === 'earn' ? 'on' : ''}" onclick="App.bankFilter('earn')">Points</button><button class="${bankFilter === 'miss' ? 'on' : ''}" onclick="App.bankFilter('miss')">Missed</button></div>
      ${txs.length ? `<div class="card tight">${txs.slice(0, 60).map(t => {
        const plus = t.type === 'EARN'; const rev = t.type === 'REVERSE';
        return `<div class="tx ${t.reversed ? 'reversed' : ''}"><span class="amt ${rev ? 'zero' : plus ? 'plus' : 'minus'}">${rev ? '↺' : plus ? '+1' : '0'}</span><div class="body"><div class="t">${esc(t.title || 'Challenge')}</div><div class="m">${rev ? 'Correction' : plus ? 'You said it. You did it' : t.type === 'MISS_TO_CIRCLE' ? `Missed · ${esc(t.circleName || 'the group')}` : 'Missed'} · ${Mila.relDay(t.localDate)}${t.reversed ? ' · canceled' : ''}</div></div>${wordTile({ title: t.title, icon: t.icon }, 'sm')}</div>`;
      }).join('')}</div>` : emptyState({ mood: 'sleepy', title: 'No points here yet', text: 'Every day you keep your word earns a point, and it shows up here.', actions: `<button class="btn primary" onclick="App.tab('today')">Check in for today</button>`, card: false })}`;
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
    return `${topbar({ title: 'Me', back: false, end: `<button class="icon-btn" aria-label="Settings" onclick="App.go('settings')">${icon('settings', 24)}</button>` })}
      <div class="sheet-hero" style="margin-top:0">${avatar(u, 84)}<div class="sheet-title" style="margin-top:10px">${esc(u.name)}</div><div class="sheet-sub">${completed ? `${hebrewPlural(completed, '1 round', 'rounds')} · ` : ''}${hebrewPlural(active.length, '1 challenge now', 'challenges now')}</div></div>
      <div class="card tight clickable pastel-lime" onclick="App.go('bank')"><div style="display:flex;align-items:center;gap:12px"><span class="tile lime">${icon('star')}</span><div style="flex:1"><div class="bold">${b.earnedTotal} ${b.earnedTotal === 1 ? 'point' : 'points'}</div><div class="small muted">My points</div></div>${icon('chev', 20)}</div></div>
      <div class="stat-grid mb"><div class="stat lime"><div class="n">${b.earnedTotal}</div><div class="l">Points</div></div><div class="stat pink"><div class="n">${b.missedTotal}</div><div class="l">Missed</div></div><div class="stat lav"><div class="n">${ach.filter(a => a.earned).length}</div><div class="l">Achievements</div></div></div>
      <div class="section-title">Achievements <small>${ach.filter(a => a.earned).length}/${ach.length}</small></div>
      <div class="ach-grid">${ach.map(a => `<div class="ach ${a.earned ? '' : 'locked'}"><span class="tile sm ${a.earned ? 'lime' : 'gray'}">${icon(a.icon, 20)}</span><div><div class="t">${esc(a.title)}</div><div class="m">${esc(a.desc)}</div></div></div>`).join('')}</div>
      ${active.length ? `<div class="section-title">My challenges</div>${active.map(c => { const d = Mila.wordDef(c.defId); const st = Mila.commitmentStats(c.id); return `<div class="word-row" onclick="App.go('word',{id:'${c.id}'})">${wordTile(d, 'sm')}<div class="body"><div class="name">${esc(d.title)}</div><div class="meta">Day ${Math.max(st.dayIndex, 1)} · ${st.success} ${st.success === 1 ? 'win' : 'wins'}${st.current ? ` · ${st.current} in a row` : ''}</div></div>${icon('chev', 18)}</div>`; }).join('')}` : ''}
      ${hist.length ? `<div class="section-title">Finished challenges</div>${hist.map(h => `<div class="word-row" onclick="App.go('summary',{id:'${h.id}'})">${wordTile(h.def, 'sm')}<div class="body"><div class="name">${esc(h.def.title)}</div><div class="meta">${Mila.fmtDate(h.startDate)} – ${Mila.fmtDate(h.endDate)} · ${h.stats.rate !== null ? pct(h.stats.rate) : ''}${h.status === 'ended_early' ? ' · stopped' : ''}</div></div>${icon('chev', 18)}</div>`).join('')}` : ''}
`;
  };

  /* ============================================================
     S17 — התראות
     ============================================================ */
  SCREENS.notifications = () => {
    const list = Mila.notifications();
    if (Mila.unreadCount()) setTimeout(() => Store().markAllRead().catch(() => {}), 400);
    const ic = { invite: ['users', 'pink'], group_invite: ['users', 'lime'], encouragement: ['clap', 'lime'], poke: ['bell', 'pink'], group_word: ['pencil', 'lav'], achievement: ['medal', 'peach'], reminder: ['bell', 'sky'], overtake: ['trophy', 'lime'] };
    return `${topbar({ title: 'Updates' })}
      ${list.length ? `<div class="card tight">${list.map(n => { const [i, c] = ic[n.type] || ['bell', 'gray']; const act = n.ref && n.ref.token ? `App.openInvite('${n.ref.token}')` : n.ref && n.ref.defId ? `App.go('groupWord',{id:'${n.ref.defId}'})` : n.ref && n.ref.circleId ? `App.go('circle',{id:'${n.ref.circleId}'})` : n.ref && n.ref.type ? `App.tab('me')` : ''; return `<div class="list-row ${act ? 'clickable' : ''}" ${act ? `onclick="${act}"` : ''}><span class="tile sm ${c}">${icon(i, 18)}</span><div class="body"><div class="t" style="${n.read ? 'font-weight:600' : ''}">${esc(n.title)}</div><div class="m">${esc(n.body || '')}${n.body ? ' · ' : ''}${timeAgo(n.createdAt)}</div></div>${act ? icon('chev', 18) : ''}</div>`; }).join('')}</div>` : emptyState({ mood: 'sleepy', title: 'Quiet here', text: 'When a friend joins, passes you or sends a kind word, it shows up here.', actions: `<button class="btn primary" onclick="App.inviteFlow()">Invite a friend</button>`, card: false })}`;
  };

  /* ============================================================
     מילה על המסך הראשי + התראות (install.js מזהה את המכשיר)
     ============================================================ */
  let instOs = null;
  const I = () => window.MilaInstall;
  function installSheet({ os = null, intro = '' } = {}) {
    if (!I()) return;
    instOs = os; const d = I().detect(); const g = I().guide(d, os);   // os: רק לבדיקות; בממשק תמיד המכשיר שזוהה
    if (!os) Api.track('install_sheet');
    // רק ההוראות של המכשיר שזוהה: בלי לשוניות של מכשירים אחרים ובלי שורת ״זיהינו״
    const steps = (g.steps || []).length ? `<ol class="inst-steps">${g.steps.map((x, i) => `<li style="--i:${i}"><span class="n">${i + 1}</span><span class="g">${x.glyph}</span><div><div class="t">${x.title}</div>${x.sub ? `<div class="m">${x.sub}</div>` : ''}</div></li>`).join('')}</ol>` : '';
    const link = location.origin + '/';
    const extra = g.kind === 'inapp'
      ? `<div class="btn-row">${g.openIn === 'safari' ? `<a class="btn dark" href="x-safari-${link}">Open in Safari</a>` : `<a class="btn dark" href="intent://${location.host}/#Intent;scheme=https;package=com.android.chrome;end">Open in Chrome</a>`}<button class="btn soft" onclick="App.copyText('${link}')">Copy link</button></div><div class="tiny muted center">Didn't open? Copy the link and paste it into your browser.</div>`
      : g.safariLink ? `<button class="btn soft" onclick="App.copyText('${link}')">Copy the link (to paste into Safari)</button>`
      : g.copyOnly ? `<button class="btn dark" onclick="App.shareLink()">Send the link to your phone</button>` : '';
    const head = g.kind === 'installed'
      ? `<div class="inst-head"><img class="inst-icon" src="/icons/icon-192.png" alt=""><div><div class="sheet-title">Mila is already on your home screen 🎉</div><div class="sheet-sub">It opens like an app. Now just make sure it reminds you.</div></div></div>`
      : `<div class="inst-head"><img class="inst-icon" src="/icons/icon-192.png" alt=""><div><div class="sheet-title">${intro || esc(g.title)}</div><div class="sheet-sub">${esc(g.sub || '')}</div></div></div>`;
    sheet(`<button class="icon-btn sheet-x" aria-label="Close" onclick="App.closeSheet()">${icon('x', 22)}</button><div class="inst">${head}
      ${g.prompt ? `<button class="btn primary inst-go" onclick="App.installNow()">${I().G.install} Install with one tap</button><div class="inst-or">or do it manually</div>` : ''}
      ${steps}${extra}
      ${d.pushNeedsInstall && g.kind !== 'installed' ? '' : pushBlock(d)}
      ${g.arrow ? '<div class="inst-arrow" aria-hidden="true"><span>The Share button in the bottom bar</span><i>↓</i></div>' : ''}</div>`);
  }
  function pushBlock(d) {
    const box = (tile, t, m, body = '') => `<div class="inst-push"><div class="inst-push-h"><span class="tile sm ${tile}">${icon('bell', 18)}</span><div><div class="t">${t}</div><div class="m">${m}</div></div></div>${body}</div>`;
    if (!isCloud()) return box('gray', 'Notifications', 'Available once you sign in with an account.');
    if (d.iosTooOld) return box('peach', 'Notifications need iOS 16.4 or later', '“Settings” → “General” → “Software Update”.');
    if (d.pushNeedsInstall) return box('lav', 'On iPhone, notifications only come from the home screen', 'Apple only allows notifications for an app you added to your home screen. Add it using the steps, open it from there, and turn them on.');
    if (!d.pushApi) return box('gray', 'Notifications', "This browser doesn't support notifications. It works in Chrome or Safari.");
    const perm = I().permission();
    if (perm === 'denied') return box('pink', 'Notifications are blocked on this device', "Here's how to unblock them:", `<ol class="inst-steps sm">${I().unblockSteps(d).map((x, i) => `<li><span class="n">${i + 1}</span><span class="g">${x.glyph}</span><div><div class="t">${x.title}</div></div></li>`).join('')}</ol>`);
    const rt = (Mila.me() && Mila.me().settings.reminderTime) || '20:00';
    if (I().pushOn) return box('lime', 'Notifications are on ✓', `A reminder at ${esc(rt)} if you haven't checked in yet. And an update when someone passes you.`, `<div class="btn-row"><button class="btn soft sm" id="push-test" onclick="App.pushTest()">Send a test notification</button><button class="btn text sm" onclick="App.pushOff()">Turn off notifications</button></div>`);
    return box('lime', 'Want Mila to remind you?', `At ${esc(rt)}, only if you haven't checked in yet. And it tells you when someone passes you.`, `<button class="btn dark" onclick="App.pushEnable()">${icon('bell', 18)} Turn on notifications</button>`);
  }
  async function installNow() { const r = await I().prompt(); if (r === 'accepted') { closeSheet(); toast('Mila is on your home screen 🎉', 'lime'); } else if (r === 'none') installSheet({ os: instOs }); }
  async function pushEnable() {
    try { await I().enablePush(); toast('Notifications are on ✓', 'lime'); }
    catch (e) { if (e.code !== 'DENIED') fail(e); else toast(e.userMessage); }
    if (sheetOpen()) installSheet({ os: instOs }); else render();
  }
  async function pushOff() { await I().disablePush(); toast('Notifications are off on this device'); if (sheetOpen()) installSheet({ os: instOs }); else render(); }
  let pushTesting = false;
  async function pushTest() {
    if (pushTesting) return; pushTesting = true;
    const b = $('#push-test'); if (b) { b.disabled = true; b.textContent = 'Sending…'; }   // תגובה מיידית ללחיצה
    try { await I().testPush(); toast('Sent. It will arrive in a few seconds.', 'lime'); } catch (e) { fail(e); }
    pushTesting = false; const b2 = $('#push-test'); if (b2) { b2.disabled = false; b2.textContent = 'Send a test notification'; }
  }
  async function shareLink() { const url = location.origin + '/'; try { if (navigator.share) { await navigator.share({ title: 'Mila', text: "We all make promises. Let's see who keeps them.", url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; } copyText(url); }
  /* תמונת סטורי לשיתוף (וואטסאפ/אינסטגרם) עם הקישור */
  async function shareStory() {
    const url = location.origin + '/';
    try {
      const blob = await (await fetch('/icons/share-story.png')).blob();
      const file = new File([blob], 'mila-story.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: `We all make promises. Let's see who keeps them. ${url}` }); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mila-story.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast('The image was downloaded. You can post it to your story.');
    } catch (e) { if (!(e && e.name === 'AbortError')) toast("We couldn't share it. Try again."); }
  }
  function installCard() {
    if (!isCloud() || !I() || !Mila.activeCommitments().length) return '';
    const d = I().detect(); const st = I().get();
    if (st.cardHidden && Date.now() - st.cardHidden < 5 * 864e5) return '';
    const x = `<button class="icon-btn inst-x" aria-label="Not now" onclick="event.stopPropagation(); App.installHide()">${icon('x', 16)}</button>`;
    if (!d.standalone && d.os !== 'desktop') return `<div class="card tight inst-card inst-hero">${x}<div style="display:flex;align-items:center;gap:12px"><img class="inst-icon sm" src="/icons/icon-192.png" alt=""><div style="flex:1"><div class="bold">Add Mila to your home screen</div><div class="small">That way it opens like an app and reminds you to check in.</div></div></div><button class="btn dark mt" onclick="App.installSheet()">How to add it? 30 seconds</button></div>`;
    if (d.pushApi && I().pushChecked && !I().pushOn && I().permission() !== 'denied') { const rt = Mila.me().settings.reminderTime || '20:00'; return `<div class="card tight inst-card">${x}<div style="display:flex;align-items:center;gap:12px"><span class="tile lime">${icon('bell', 22)}</span><div style="flex:1"><div class="bold">Want Mila to remind you at ${esc(rt)}?</div><div class="small muted">Only if you haven't checked in yet.</div></div><button class="btn dark sm" onclick="App.pushEnable()">Turn on</button></div></div>`; }
    return '';
  }
  /* באנר פרגון בעמוד הבית: מטוס קטן טס לפורטוגל, לב פועם. אפשר להסתיר לשבוע. */
  function supportCard() {
    return ''; /* English edition: the support banner is Israel-only, so it renders nothing. The original logic below is kept. */ if (!Mila.me() || Mila.getState().meta.demo) return '';
    let hid = 0; try { hid = Number(localStorage.getItem('mila.supportHidden') || 0); } catch (e) { }
    if (hid && Date.now() - hid < 7 * 864e5) return '';
    return `<div class="card sup-card">
      <button class="icon-btn sup-x" aria-label="Not now" onclick="App.supportHide()">${icon('x', 16)}</button>
      <div class="sup-sky" aria-hidden="true"><svg class="sup-path" viewBox="0 0 300 60" preserveAspectRatio="none"><path d="M296 46 C 220 6, 90 6, 4 40" fill="none" stroke="#1C1A1F" stroke-width="1.6" stroke-dasharray="3 6" opacity=".35"/></svg>
        <svg class="sup-plane" width="26" height="26" viewBox="0 0 24 24"><path d="M2.5 13.2l7.6-1.6 4.6-7.8c.4-.7 1.5-.7 1.7.2l-1.2 7.1 4.7-1c1.2-.2 2.1.9 1.6 1.9-.2.4-.6.7-1 .8l-4.8 1-2.4 6.9c-.3.8-1.4.8-1.6 0l-.6-6.1-7.4 1.6c-.6.1-1-.6-.6-1.1l-.6-1.9z" fill="#1C1A1F" transform="scale(-1,1) translate(-24,0)"/></svg>
        <span class="sup-dest">Portugal</span></div>
      <div class="sup-body">${heartArt(46)}<div><div class="sup-kicker">Hapoel Ironi Yavne · Acrobatics</div><div class="bold sup-q">If we help you keep your word, will you help us get to the competition in Portugal?</div></div></div>
      <div class="btn-row mt"><button class="btn primary" onclick="App.go('treat')">I want to support</button><button class="btn soft" onclick="App.teamSheet()">About the team</button></div>
    </div>`;
  }
  /* חלון ״על הנבחרת״: הפועל עירוני יבנה, אקרובטיקה, מימון ההורים */
  function teamSheet() { return; /* English edition: the team popup is Israel-only, so it renders nothing. The original logic below is kept. */
    sheet(`<div class="team">
      <div class="team-hero" aria-hidden="true"><span class="team-medal">${icon('medal', 34)}</span><span class="team-spark s1"></span><span class="team-spark s2"></span><span class="team-spark s3"></span></div>
      <div class="team-kicker">Hapoel Ironi Yavne · Acrobatics</div>
      <div class="sheet-title team-title">Our team is on its way to Portugal</div>
      <p>Israel brings home a lot of medals in acrobatics. The girls on our competitive team work very, very hard to be part of that, and now they are on their way to a competition in Portugal.</p>
      <p>The parents are paying for the whole trip.</p>
      <p class="team-you">This is where you come in, and help us get there.</p>
      <p class="small muted">This app was built to fund the trip: you keep your word, and you help a girl make a dream come true. Every bit of support gets them closer to the flight.</p>
      <button class="btn primary" onclick="App.closeSheet(); App.go('treat')">I want to support</button>
    </div>`);
  }
  function supportHide() { try { localStorage.setItem('mila.supportHidden', String(Date.now())); } catch (e) { } render(); }
  function installHide() { I().mark('cardHidden'); render(); }
  function phoneCard() {
    if (!I()) return '';
    const d = I().detect(); const perm = I().permission();
    const pushTxt = !isCloud() ? 'After you sign in' : d.pushNeedsInstall ? 'Add Mila to your home screen first' : !d.pushApi ? 'Not supported in this browser' : perm === 'denied' ? 'Blocked. How to unblock?' : I().pushOn ? 'On ✓' : 'Off. Turn on?';
    return `<div class="card tight"><div class="card-title">Mila on your phone</div>
      <div class="list-row clickable" onclick="App.installSheet()"><img class="inst-icon xs" src="/icons/icon-192.png" alt=""><div class="body"><div class="t">On your home screen</div><div class="m">${d.standalone ? 'Installed ✓' : `Instructions for ${esc(I().platformName(d))}`}</div></div>${icon('chev', 18)}</div>
      <div class="list-row clickable" onclick="App.installSheet()"><span class="tile sm lime">${icon('bell', 18)}</span><div class="body"><div class="t">Notifications on this device</div><div class="m">${pushTxt}</div></div>${icon('chev', 18)}</div>
      <div class="list-row clickable" onclick="App.shareStory()"><span class="tile sm peach">${icon('share', 18)}</span><div class="body"><div class="t">Story image</div><div class="m">Share Mila on WhatsApp or Instagram</div></div>${icon('chev', 18)}</div></div>`;
  }
  /* אחרי האתגר הראשון: הזמן הכי טוב להציע (פעם אחת) */
  function afterFirstCommit() {
    if (!isCloud() || !I()) return; const d = I().detect(); const st = I().get();
    if (st.askedAfterFirst) return;
    const needInstall = !d.standalone && d.os !== 'desktop'; const needPush = d.pushApi && !I().pushOn && I().permission() === 'default';
    if (!needInstall && !needPush) return;
    I().mark('askedAfterFirst');
    // רק אם היא עדיין במסך ראשי: לא קופצות באמצע אשף או הקלדה (הכרטיס במסך היום נשאר בכל מקרה)
    setTimeout(() => { if (!sheetOpen() && stack.length && TOP.includes(current().name)) installSheet({ intro: needInstall ? 'Want Mila to remind you to check in?' : '' }); }, 1900);
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
    const tog = (k, t, m) => `<div class="toggle-row"><div><div class="t">${t}</div><div class="m">${m}</div></div><button class="switch ${s[k] ? 'on' : ''}" role="switch" aria-checked="${!!s[k]}" aria-label="${t}" onclick="App.setSetting('${k}', ${!s[k]})"></button></div>`;
    return `${topbar({ title: 'Settings' })}
      ${isCloud() && Api.me && Api.me.isAdmin ? `<div class="card tight clickable admin-entry" onclick="App.go('admin')"><div style="display:flex;align-items:center;gap:12px"><span class="tile lime">${icon('chart', 22)}</span><div style="flex:1"><div class="bold">Analytics</div><div class="small muted">Growth, invites, retention, challenges and groups</div></div>${icon('chev', 20)}</div></div>` : ''}
      ${false ? `<div class="card tight clickable treat-entry" onclick="App.go('treat')"><div style="display:flex;align-items:center;gap:12px">${heartArt(44)}<div style="flex:1"><div class="bold">Want to support us? 💛</div><div class="small muted">Help the team fly to the competition in Portugal</div></div>${icon('chev', 20)}</div></div>` : ''}
      ${phoneCard()}
      <div class="card tight"><div class="field" style="margin:6px 0 10px"><label>Display name</label><input class="input" aria-label="Display name" value="${esc(u.name)}" maxlength="30" onchange="App.rename(this.value)"></div>
        <div class="kv"><span class="k">${icon('clock', 18)} Time zone</span><span class="v">${u.timezone === 'Asia/Jerusalem' ? 'Israel' : esc(String(u.timezone || '').split('/').pop().replace(/_/g, ' '))}</span></div>
        <div class="kv"><span class="k">${icon('bell', 18)} Reminder time</span><input class="input ltr" type="time" aria-label="Reminder time" value="${s.reminderTime}" style="width:auto;padding:8px 12px" onchange="App.setSetting('reminderTime', this.value)"></div></div>
      <div class="card tight">${tog('pushReminders', 'Check-in reminder', `At ${esc(s.reminderTime || '20:00')} if you haven't checked in yet, and at 9:00 if yesterday is still open`)}${tog('socialDigest', 'Updates from friends', 'Who passed you, who joined, a kind word')}${tog('hideFromLeaderboard', 'Leave me out of the ranking', 'Playing, not competing')}${tog('lockScreenPrivacy', 'Discreet lock screen', 'No challenge names in notifications')}</div>
      <div class="card tight"><div class="card-title">Safety</div>${blocked.length ? blocked.map(b => `<div class="list-row">${avatar(b, 32)}<div class="body"><div class="t">${esc(b.name)}</div><div class="m">Blocked</div></div><button class="btn xs soft" onclick="App.unblock('${b.id}')">Unblock</button></div>`).join('') : '<div class="small muted">No one is blocked.</div>'}</div>
      <div class="card tight"><div class="card-title">How it works</div><div class="small muted">Up to 3 challenges for 14 days. Every evening you mark whether you kept each one.<br>Kept it? One point. Missed? That challenge's streak resets, your points stay.<br>The group ranking goes by consistency rate, from ${Mila.RULES.MIN_RANKED_EVENTS} check-ins and up. At the end of the 14 days there is a winner.</div></div>
      <div class="card tight"><div class="card-title">Accessibility and legal</div>
        <div class="list-row clickable" onclick="MilaA11y.open()"><span class="tile sm sky">${icon('eye', 18)}</span><div class="body"><div class="t">Accessibility menu</div><div class="m">Large text, contrast, no animations</div></div>${icon('chev', 18)}</div>
        <a class="list-row clickable" href="/accessibility"><span class="tile sm gray">${icon('info', 18)}</span><div class="body"><div class="t">Accessibility statement</div></div>${icon('chev', 18)}</a>
        <a class="list-row clickable" href="/privacy"><span class="tile sm gray">${icon('lock', 18)}</span><div class="body"><div class="t">Privacy Policy</div></div>${icon('chev', 18)}</a>
        <a class="list-row clickable" href="/terms"><span class="tile sm gray">${icon('book', 18)}</span><div class="body"><div class="t">Terms of Use</div></div>${icon('chev', 18)}</a></div>
      <div class="card tight"><div class="list-row clickable" onclick="App.exportData()"><span class="tile sm sky">${icon('download', 18)}</span><div class="body"><div class="t">Export my data</div><div class="m">A file with your challenges and check-ins</div></div></div>
        ${S.meta.demo ? `<div class="list-row clickable" onclick="App.resetDemo()"><span class="tile sm peach">${icon('repeat', 18)}</span><div class="body"><div class="t">Reset the demo</div><div class="m">And start for real</div></div></div>` : ''}
        ${isCloud() ? `<div class="list-row clickable" onclick="App.signOut()"><span class="tile sm gray">${icon('logout', 18)}</span><div class="body"><div class="t">Sign out</div><div class="m">${esc((Api.me && Api.me.email) || '')}</div></div></div>` : ''}
        <div class="list-row clickable" onclick="App.deleteAccount()"><span class="tile sm pink">${icon('trash', 18)}</span><div class="body"><div class="t" style="color:var(--danger)">Delete account</div><div class="m">Permanent</div></div></div></div>
      <div class="made-by"><span>Built with love</span><span class="made-heart" aria-hidden="true">${icon('heart', 15)}</span><span>by</span><a href="https://www.linkedin.com/in/marinarudinsky/" target="_blank" rel="noopener" aria-label="Marina Kaplan, LinkedIn profile">Marina Kaplan</a></div>
      <div class="tiny muted center">Mila · beta</div>`;
  };
  async function setSetting(k, v) { try { await Store().updateSettings({ [k]: v }); render(); } catch (e) { fail(e); } }
  async function rename(name) { try { if (!name.trim()) return; await Store().renameMe(name); toast('Updated.'); } catch (e) { fail(e); } }
  async function unblock(id) { try { await Store().unblock(id); render(); } catch (e) { fail(e); } }
  async function exportData() { const data = isCloud() ? JSON.stringify(await Api.cloud.exportData(), null, 2) : Mila.exportData(); const blob = new Blob([data], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mila-export.json'; a.click(); URL.revokeObjectURL(a.href); toast('File downloaded'); }
  function exitDemo() { Mila.reset(); stack = []; go('welcome', {}, { reset: true }); }
  function resetDemo() { confirmSheet({ title: 'Reset the demo?', sub: 'You go back to the welcome screen.', okText: 'Reset', okClass: 'pink', onOk: () => { Mila.reset(); closeSheet(true); go('welcome', {}, { reset: true }); } }); }
  function deleteAccount() { confirmSheet({ title: 'Delete your account?', sub: 'This is permanent. Your challenges, check-ins and achievements are deleted. Groups keep an anonymous record.', okText: 'Delete', okClass: 'danger', onOk: async () => { await Store().deleteAccount(); closeSheet(true); go('welcome', {}, { reset: true }); toast('Deleted.'); } }); }

  /* ============================================================
     אנליטיקה (מנהלת המערכת בלבד; השרת בודק הרשאה)
     טווח 7/30/90 יום עם השוואה לתקופה הקודמת. כל גרף עם קריאה במעבר עכבר/נגיעה וטבלה.
     ============================================================ */
  let adminData = null, adminErr = null, adminLoading = false, adminDays = 30, adminTab = 'overview';
  const AD_TABS = [['overview', 'Overview'], ['growth', 'Growth & invites'], ['engage', 'Engagement'], ['retain', 'Retention'], ['challenges', 'Challenges'], ['groups', 'Groups & social'], ['app', 'App & notifications'], ['more', 'Support & safety']];
  const AD_C = { blue: '#2a78d6', orange: '#eb6834', teal: '#1baf7a' };
  const adCharts = {};
  /* רוחב אמיתי בפיקסלים (בלי מתיחה של טקסט): שני גרפים בשורה במחשב, אחד בטלפון */
  function adW(full) { const cw = document.documentElement.clientWidth; const box = Math.min(cw, 1120) - (cw >= 600 ? 48 : 40) - 26; return Math.max(260, Math.floor(!full && cw >= 900 ? (box - 10) / 2 : box)); }
  let adResizeT = null;
  window.addEventListener('resize', () => { clearTimeout(adResizeT); adResizeT = setTimeout(() => { if (stack.length && current().name === 'admin' && adminData) render(); }, 200); });
  async function loadAdmin(days) {
    if (days) adminDays = days;
    adminLoading = true; adminErr = null; render();
    try { adminData = await Api.adminStats(adminDays); } catch (e) { adminErr = e.userMessage || 'Could not load'; }
    adminLoading = false; render();
  }
  function adminSetTab(t) { adminTab = t; render(); window.scrollTo({ top: 0 }); }
  const adN = (x) => { const v = Number(x || 0); return Math.abs(v) >= 10000 ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : v.toLocaleString('en-US'); };
  const adP = (x) => (x == null ? '–' : `${x}%`);
  /* שינוי מול התקופה הקודמת. upGood: האם עלייה טובה. kind 'pp' = נקודות אחוז */
  function adDelta(cur, prev, { upGood = true, kind = 'rel' } = {}) {
    if (cur == null || prev == null) return '';
    if (kind === 'pp') { const d = Math.round((cur - prev) * 10) / 10; if (!d) return `<span class="ad-d flat">Same as the previous period</span>`; return `<span class="ad-d ${(d > 0) === upGood ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)} pct. points</span> <span class="vs">vs the previous period</span>`; }
    if (!prev) return cur ? `<span class="ad-d good">New</span> <span class="vs">the previous period had 0</span>` : `<span class="ad-d flat">Same as the previous period</span>`;
    const d = Math.round(((cur - prev) / prev) * 100); if (!d) return `<span class="ad-d flat">Same as the previous period</span>`;
    return `<span class="ad-d ${(d > 0) === upGood ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%</span> <span class="vs">vs the previous period</span>`;
  }
  const adTile = (label, value, { delta = '', sub = '', help = '' } = {}) => `<div class="ad-tile"><div class="l">${label}</div><div class="v">${value}</div>${delta ? `<div class="dl">${delta}</div>` : ''}${sub ? `<div class="s">${sub}</div>` : ''}${help ? `<div class="h">${help}</div>` : ''}</div>`;
  const adSec = (title, intro) => `<div class="ad-sec"><h3>${title}</h3>${intro ? `<p>${intro}</p>` : ''}</div>`;
  const adTable = (id, cols, rows) => `<details class="ad-details"><summary>Table</summary><div class="ad-tbl-wrap"><table class="ad-tbl"><thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(typeof c[0] === 'function' ? c[0](r) : r[c[0]])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><button class="btn text xs" onclick="App.adCsv('${id}')">${icon('download', 14)} Download CSV</button></details>`;
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
      ${adWithTable(id, [[r => Mila.fmtDate(r.d), 'Day'], ...series.map((s, k) => [r => r.v[k], s.name])], days.map((d, i) => ({ d, v: vals.map(v => v[i]) })).reverse())}</div>`;
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
      ${adWithTable(id, [['l', 'Category'], ['v', title]], labels.map((l, i) => ({ l, v: values[i] })))}</div>`;
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
    adCsvData[id] = { cols: [['label', 'Name'], ['n', 'Value']], rows };
    return `<div class="ad-hbars">${rows.map((r, i) => `<div class="ad-hb"><div class="lab"><span>${esc(r.label)}</span><b>${fmt(r.n)}</b></div><div class="ad-track"><i style="width:${Math.max(r.n ? 2 : 0, (100 * r.n) / max)}%;background:${color}"></i></div>${sub ? `<div class="sub">${sub(r, i)}</div>` : ''}</div>`).join('')}</div><button class="btn text xs" onclick="App.adCsv('${id}')">${icon('download', 14)} Download CSV</button>`;
  };
  const adHeat = (p) => { if (p == null) return ''; const steps = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95']; const i = Math.min(steps.length - 1, Math.floor(p / 100 * steps.length)); return `background:${steps[i]};color:${i >= 3 ? '#fff' : 'var(--ink)'}`; };

  SCREENS.admin = () => {
    if (!adminData && !adminLoading && !adminErr) setTimeout(() => loadAdmin(), 0);
    const head = topbar({ title: 'Analytics', end: `<button class="icon-btn" aria-label="Refresh" onclick="App.loadAdmin()">${icon('repeat', 20)}</button>` });
    const ctrl = `<div class="ad-ctrl"><div class="seg">${[7, 30, 90].map(d => `<button class="${adminDays === d ? 'on' : ''}" onclick="App.loadAdmin(${d})">${d} days</button>`).join('')}</div>${adminData ? `<span class="tiny muted">${Mila.fmtDate(adminData.range.start)}–${Mila.fmtDate(adminData.range.end)} · vs ${Mila.fmtDate(adminData.range.prevStart)}–${Mila.fmtDate(adminData.range.prevEnd)} · updated ${Mila.fmtTime(adminData.generatedAt)}</span>` : ''}</div>
      <div class="ad-tabs">${AD_TABS.map(([k, l]) => `<button class="${adminTab === k ? 'on' : ''}" onclick="App.adminSetTab('${k}')">${l}</button>`).join('')}</div>`;
    if (adminErr) return `${head}${ctrl}<div class="card empty"><div class="t">${esc(adminErr)}</div><button class="btn soft" onclick="App.loadAdmin()">Try again</button></div>`;
    if (!adminData) return `${head}${ctrl}<div class="empty"><div class="muted small">Loading data…</div></div>`;
    const d = adminData, k = d.kpi, sd = d.series.days, per = `the last ${d.range.days} days`;
    let body = '';
    if (adminTab === 'overview') {
      body = `<div class="ad-hero"><div class="v">${adN(k.dau)}</div><div class="l">Active users today</div><div class="s">${adN(k.wau)} this week · ${adN(k.mau)} in 30 days · ${adN(k.users)} registered</div></div>
        ${adSec(`What happened in ${per}`, 'Every number is compared with the previous period of the same length.')}
        <div class="ad-grid">
          ${adTile('Signed up', adN(k.signups.cur), { delta: adDelta(k.signups.cur, k.signups.prev) })}
          ${adTile('Active per day (average)', adN(k.activeAvg.cur), { delta: adDelta(k.activeAvg.cur, k.activeAvg.prev), help: 'Users who opened the app that day' })}
          ${adTile('Check-ins', adN(k.reports.cur), { delta: adDelta(k.reports.cur, k.reports.prev) })}
          ${adTile('Check-in rate', adP(k.reportRate.cur), { delta: adDelta(k.reportRate.cur, k.reportRate.prev, { kind: 'pp' }), help: 'Days checked in out of all days that closed: checked in ÷ (checked in + closed without a check-in)' })}
          ${adTile('Success rate', adP(k.success.cur), { delta: adDelta(k.success.cur, k.success.prev, { kind: 'pp' }), help: 'Kept ÷ (kept + missed). A day closed without a check-in counts as missed' })}
          ${adTile('Came from an invite', adN(k.viaInvite.cur), { delta: adDelta(k.viaInvite.cur, k.viaInvite.prev) })}
          ${adTile('New groups', adN(k.groups.cur), { delta: adDelta(k.groups.cur, k.groups.prev) })}
        </div>
        <div class="ad-charts">${adLine('ov-active', 'Active users per day', sd, [{ name: 'Active', color: AD_C.blue, data: d.series.active }])}
        ${adLine('ov-signups', 'Sign-ups per day', sd, [{ name: 'All sign-ups', color: AD_C.blue, data: d.series.signups }, { name: 'Site visits', color: AD_C.orange, data: d.series.visits }])}</div>
        <div class="ad-grid">
          ${adTile('Stickiness', adP(k.stickiness), { help: 'Active today out of active this month. 20%+ is good.' })}
          ${adTile('Active challenges', adN(k.challengesActive))}
          ${adTile('Active groups', adN(k.groupsActive))}
          ${adTile('Signed up, not completed', adN(k.pending), { help: 'Signed in with Google and did not confirm their details' })}
        </div>`;
    } else if (adminTab === 'growth') {
      const f = d.funnel, top = f[0].n || f.find(x => x.n).n || 1;
      const v = d.viral, kinds = { follow: 'Help me keep my word', compete: 'Compete', same: 'Same challenge' }; const fi = d.friendInvites || { sent: 0, joins: 0, rate: null };
      const src = d.sources, srcTot = src.invite + src.direct;
      body = `${adSec('Sign-up funnel', `People who visited in ${per}, and what they did. The percentage at each step is out of the previous step, and in brackets out of site visits.`)}
        ${(() => { const en = d.entry || {}; const bits = [en.inapp ? `${adN(en.inapp)} came from inside another app (Instagram, Facebook and the like)${en.inappOpen ? `, ${adN(en.inappOpen)} of them moved to the regular browser` : ''}` : '', en.googleCancel ? `${adN(en.googleCancel)} cancelled on the Google screen` : '', en.googleFail ? `${adN(en.googleFail)} came back from Google without signing in` : ''].filter(Boolean); return bits.length ? `<div class="note mb">${icon('info', 18)}<span>${bits.join(' · ')}.</span></div>` : ''; })()}
        <div class="card">${adHBars('funnel', f, { sub: (r, i) => i === 0 ? 'Unique visitors (by device)' : `${adP(f[i - 1].n ? Math.round((1000 * r.n) / f[i - 1].n) / 10 : null)} of the previous step (${adP(top ? Math.round((1000 * r.n) / top) / 10 : null)} of visits)` })}</div>
        ${adSec('Where they came from', 'People who signed up in the period: through an invite from a friend, or directly.')}
        <div class="card">${srcTot ? `<div class="ad-seg"><i style="width:${(100 * src.invite) / srcTot}%;background:${AD_C.blue}"><span>${Math.round((100 * src.invite) / srcTot)}%</span></i><i style="width:${(100 * src.direct) / srcTot}%;background:${AD_C.orange}"><span>${Math.round((100 * src.direct) / srcTot)}%</span></i></div><div class="ad-legend"><span><i style="background:${AD_C.blue}"></i>From an invite · ${adN(src.invite)}</span><span><i style="background:${AD_C.orange}"></i>Direct · ${adN(src.direct)}</span></div>` : '<div class="small muted">No sign-ups in this period yet.</div>'}</div>
        ${adSec('Virality', 'How many people each active user brings in. A coefficient above 1 = each user brings in more than one friend, and the app grows on its own.')}
        <div class="ad-grid">
          ${adTile('Viral coefficient', String(v.k), { help: `New users from invites ÷ active users in the period (${adN(v.signups)} ÷ ${adN(v.activeUsers)})` })}
          ${adTile('Invites per active user', String(v.invitesPerUser), { sub: `${adN(v.invitesSent)} invites sent` })}
          ${adTile('Opened', adP(v.openRate), { sub: `${adN(v.opens)} link opens`, help: 'Unique opens ÷ invites sent' })}
          ${adTile('Signed up, of those who opened', adP(v.signupRate), { help: 'Can go above 100% when a friend joins with a code without opening a link' })}
        </div>
        ${adLine('gr-inv', 'Invites and opens per day', sd, [{ name: 'Invites sent', color: AD_C.blue, data: d.series.invites }, { name: 'Links opened', color: AD_C.orange, data: d.series.opens }], { area: false, full: true })}
        ${adSec('By invite type', 'Invite links created in the period, and what happened to them.')}
        <div class="card tight"><div class="ad-table c5"><div class="ad-row h"><span>Type</span><span>Sent</span><span>Opened</span><span>Signed up</span><span>Joined</span></div>${d.inviteKinds.map(x => `<div class="ad-row"><span>${kinds[x.kind] || x.kind}</span><span>${adN(x.sent)}</span><span>${adN(x.opens)}</span><span>${adN(x.signups)}</span><span>${adN(x.joins)}</span></div>`).join('')}</div>
          ${adWithTable('kinds', [[r => kinds[r.kind] || r.kind, 'Type'], ['sent', 'Sent'], ['opens', 'Opened'], ['signups', 'Signed up'], ['joins', 'Joined']], d.inviteKinds)}</div>
        ${adSec('In-app invites', 'Friends already on Mila who were invited to another group, without a link.')}
        <div class="ad-grid">
          ${adTile('Friends invited', adN(fi.sent))}
          ${adTile('Joined', adN(fi.joins), { sub: fi.rate === null ? '' : `${adP(fi.rate)} of those invited` })}
        </div>
        ${adSec('Who brought whom', `Top inviters in ${per}. Reached = unique visitors who opened a link the inviter sent.`)}
        <div class="card tight">${d.referrers.length ? `<div class="ad-table c6"><div class="ad-row h"><span>Inviter</span><span>Invites</span><span>Reached</span><span>Signed up</span><span>Joined</span><span>Total brought in</span></div>${d.referrers.map((r, i) => `<div class="ad-row"><span>${i < 3 ? ['🥇', '🥈', '🥉'][i] + ' ' : ''}${esc(r.name || 'No name')}</span><span>${adN(r.invites)}</span><span>${adN(r.opens)}</span><span>${adN(r.signups)}</span><span>${adN(r.joins)}</span><span>${adN(r.signupsAll)}</span></div>`).join('')}</div>
          ${adWithTable('referrers', [['name', 'Inviter'], ['invites', 'Invites'], ['opens', 'Reached'], ['signups', 'Signed up'], ['joins', 'Joined'], ['signupsAll', 'Total brought in']], d.referrers)}<div class="tiny muted mt">${adN(d.invitersTotal)} have ever sent an invite.</div>` : '<div class="small muted">No invites in this period yet.</div>'}</div>`;
    } else if (adminTab === 'engage') {
      const e = d.engagement; const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      body = `${adSec('How much they use it', 'Active = opened the app that day.')}
        <div class="ad-grid">
          ${adTile('Today', adN(k.dau))}${adTile('7 days', adN(k.wau))}${adTile('30 days', adN(k.mau))}
          ${adTile('Stickiness', adP(k.stickiness), { help: 'Today ÷ 30 days' })}
          ${adTile('Check-ins per active user', String(e.reportsPerActive), { help: `In ${per}` })}
          ${adTile('Closed without a check-in', adN(k.autoClosed.cur), { delta: adDelta(k.autoClosed.cur, k.autoClosed.prev, { upGood: false }), sub: `Check-in rate: ${adP(k.reportRate.cur)}`, help: 'Days not checked in by 10:00 the next morning, closed automatically as missed' })}
        </div>
        <div class="ad-charts">${adLine('en-rep', 'Check-ins per day', sd, [{ name: 'Checked in', color: AD_C.blue, data: d.series.reports }, { name: 'Closed without a check-in', color: AD_C.orange, data: d.series.autoClosed }])}
        ${adCols('en-per', 'Active challenges per user', e.perUser.map(x => (x.n === 3 ? '3' : String(x.n))), e.perUser.map(x => x.users), { note: 'Registered users' })}
        ${adCols('en-hour', 'When they check in (hour of day)', Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}`), e.hours, { color: AD_C.teal, note: 'Israel time' })}
        ${adCols('en-wd', 'Check-ins by day of week', [...wd], [...e.weekdays], { color: AD_C.teal })}</div>`;
    } else if (adminTab === 'retain') {
      const r = d.retention;
      body = `${adSec('Do they come back?', 'Out of those who signed up long enough ago to measure.')}
        <div class="ad-grid">
          ${adTile('Came back the next day', adP(r.d1.pct), { sub: `${adN(r.d1.n)} of ${adN(r.d1.of)}` })}
          ${adTile('Active on day 7', adP(r.d7.pct), { sub: `${adN(r.d7.n)} of ${adN(r.d7.of)}` })}
          ${adTile('Active on day 14', adP(r.d14.pct), { sub: `${adN(r.d14.n)} of ${adN(r.d14.of)}` })}
          ${adTile('Rounds completed', adP(r.rounds.rate), { sub: `${adN(r.rounds.completed)} completed · ${adN(r.rounds.ended)} stopped midway`, help: 'Challenges that ended in the period' })}
        </div>
        ${adSec('By sign-up week', 'Each row: people who signed up in the same week. Each cell: what percentage of them opened the app in week 1, 2, 3, 4 after signing up. Darker = more came back.')}
        <div class="card tight ad-cohort"><table><thead><tr><th>Sign-up week</th><th>Signed up</th><th>Week 1</th><th>Week 2</th><th>Week 3</th><th>Week 4</th></tr></thead><tbody>
          ${r.cohorts.map(c => `<tr><td>${Mila.fmtDate(c.start)}–${Mila.fmtDate(c.end)}</td><td>${adN(c.size)}</td>${c.cells.map(x => (x ? `<td style="${adHeat(x.pct)}" title="${x.n} of ${x.of}">${adP(x.pct)}</td>` : '<td class="na">·</td>')).join('')}</tr>`).join('')}
        </tbody></table><div class="tiny muted mt">· = not enough time has passed yet. Hover over a cell to see how many people.</div>
        ${adWithTable('cohorts', [[c => `${c.start}–${c.end}`, 'Sign-up week'], ['size', 'Signed up'], ...[0, 1, 2, 3].map(i => [c => (c.cells[i] ? c.cells[i].pct + '%' : ''), `Week ${i + 1}`])], r.cohorts)}</div>`;
    } else if (adminTab === 'challenges') {
      const cats = d.categories;
      body = `${adSec('Categories', `How many challenges were chosen in ${per}, and their success rate.`)}
        <div class="card">${adHBars('cats', cats.map(c => ({ label: c.name, n: c.chosen })), { sub: (r, i) => `${adN(cats[i].active)} active now · success ${adP(cats[i].success)}` })}</div>
        ${adSec('All challenges', 'Chosen in the period, active now, success rate on days checked in, and the share of rounds completed (out of those that ended in the period).')}
        <div class="card tight"><div class="ad-table c6 wide1"><div class="ad-row h"><span>Challenge</span><span>Chosen</span><span>Active</span><span>Success</span><span>Completed</span><span>Stopped</span></div>
          ${d.challenges.slice(0, 50).map(c => `<div class="ad-row"><span>${esc(c.title)}</span><span>${adN(c.chosen)}</span><span>${adN(c.active)}</span><span>${adP(c.success)}</span><span>${adP(c.completionRate)}</span><span>${adN(c.ended)}</span></div>`).join('')}</div>
          ${adWithTable('challenges', [['title', 'Challenge'], [c => (cats.find(x => x.cat === c.cat) || {}).name || '', 'Category'], ['chosen', 'Chosen'], ['active', 'Active'], [c => adP(c.success), 'Success'], ['reports', 'Check-ins'], [c => adP(c.completionRate), 'Completed'], ['ended', 'Stopped']], d.challenges)}</div>`;
    } else if (adminTab === 'groups') {
      const g = d.groups, s = d.social;
      body = `${adSec('Groups', 'How many groups there are, how big they are, and how many users play with friends.')}
        <div class="ad-grid">
          ${adTile('Active groups', adN(g.active), { delta: adDelta(k.groups.cur, k.groups.prev), sub: `${adN((g.created || {}).cur || 0)} created in the period` })}
          ${adTile('Average size', String(g.avgSize), { help: 'Members per group' })}
          ${adTile('Playing with friends', adP(g.inGroupPct), { sub: `${adN(g.inGroup)} of ${adN(k.users)}` })}
          ${adTile('Closed groups', adN(g.closed))}
        </div>
        ${g.sizes.length ? adCols('gr-size', 'Members per group', g.sizes.map(x => String(x.size)), g.sizes.map(x => x.groups), { note: 'Number of groups', full: true }) : ''}
        ${adSec('Social', `What happened inside the groups in ${per}.`)}
        <div class="ad-grid">
          ${adTile('Kind words', adN(s.encouragements + s.reactions), { sub: `${adN(s.encouragements)} encouragements · ${adN(s.reactions)} reactions` })}
          ${adTile('Overtakes in the ranking', adN(s.overtakes))}
          ${adTile('Shared challenges', adN(s.shared), { sub: `${adN(s.sharedJoins)} friends joined`, help: 'Whoever starts it is already in; only the friends who joined afterwards are counted here' })}
          ${adTile('Joined groups', adN(s.joins))}
        </div>
        ${adSec('Most active groups', `By number of check-ins in ${per}.`)}
        <div class="card tight">${g.top.length ? `<div class="ad-table c5 wide1"><div class="ad-row h"><span>Group</span><span>Members</span><span>Challenges</span><span>Check-ins</span><span>Success</span></div>${g.top.map(x => `<div class="ad-row"><span>${esc(x.name)}</span><span>${adN(x.members)}</span><span>${adN(x.challenges)}</span><span>${adN(x.reports)}</span><span>${adP(x.success)}</span></div>`).join('')}</div>
          ${adWithTable('groups', [['name', 'Group'], ['members', 'Members'], ['challenges', 'Active challenges'], ['reports', 'Check-ins'], [x => adP(x.success), 'Success'], ['created', 'Created']], g.top)}` : '<div class="small muted">No groups yet.</div>'}</div>`;
    } else if (adminTab === 'app') {
      const a = d.app || { platforms: [] };
      body = `${adSec('On the home screen', `Unique devices in ${per}. “Opened from the home screen” = opened as an installed app (at least once).`)}
        <div class="ad-grid">
          ${adTile('Opened from the home screen', adN(a.opens), { help: 'Devices that opened Mila as an app' })}
          ${adTile('Saw the install guide', adN(a.sheet))}
          ${adTile('Tapped “Install”', adN(a.prompt), { sub: `${adN(a.installed)} installed (Android/desktop)`, help: 'On iPhone installing is manual and is not measured here' })}
        </div>
        ${adSec('Notifications', 'Subscriptions active now (each device separately), and who allowed or blocked them in ' + per + '.')}
        <div class="ad-grid">
          ${adTile('Devices with notifications', adN(a.subscriptions), { sub: `${adN(a.pushUsers)} users` })}
          ${adTile('Actually received a notification', adN(a.delivered || 0), { sub: a.failing ? `${adN(a.failing)} with a failed send` : '', help: 'Devices that at least one send reached' })}
          ${adTile('Turned on notifications', adN(a.pushOn))}
          ${adTile('Blocked notifications', adN(a.pushDenied))}
        </div>
        ${(a.pushErrors || []).length ? `<div class="card tight"><div class="card-title">Why sends failed</div><div class="tiny muted mb">What the push service answered: service, code and reason.</div>${adHBars('pusherrs', a.pushErrors.map(x => ({ label: x.why, n: x.n })), { color: AD_C.orange })}</div>` : ''}
        ${a.platforms.length ? `<div class="card tight"><div class="card-title">By device type</div>${adHBars('pushplat', a.platforms.map(x => ({ label: x.platform, n: x.n })), { color: AD_C.teal })}</div>` : ''}
        ${adSec('Errors users saw', `Error screens in ${per} (a device is counted once a day per type). “No connection” is not counted, because it cannot be reported without a network.`)}
        <div class="card">${(a.errors || []).some(x => x.n) ? adHBars('errs', (a.errors || []).map(x => ({ label: { server: 'Server error', quota: 'Daily quota ran out', crash: 'Screen crashed', notfound: 'Screen not found' }[x.kind], n: x.n })), { color: AD_C.orange }) : '<div class="small muted">No errors seen in this period.</div>'}</div>`;
    } else {
      const t = d.treats, names = { 18: '₪18 · Chai', 50: '₪50', 100: '₪100', 180: '₪180', 360: '₪360', other: 'Other amount', cookie: '🍪 Cookie (old)', espresso: '☕ Espresso (old)', latte: '🥛 Latte (old)' };
      const sf = d.safety;
      body = `${adSec('Support', `How many tapped each amount in ${per} (one tap a day per device). The payment itself is only visible in PayBox or Bit.`)}
        <div class="card">${adHBars('treats', t.map(x => ({ label: names[x.kind], n: x.clicks })), { color: AD_C.orange })}</div>
        ${adSec('Age', 'The “Relationships and intimacy” area is open from age 18. The date of birth itself is not stored. Anyone who signed up before 11 Nov 2026 confirmed 18+ at sign-up.')}
        <div class="ad-grid">
          ${adTile('Area open to them', adN((d.age || {}).adults || 0), { help: 'Aged 18 and over' })}
          ${adTile('Under 18', adN((d.age || {}).minors || 0), { help: 'They were asked, and the area opens for them on their 18th birthday' })}
          ${adTile('Not asked yet', adN((d.age || {}).unknown || 0), { help: 'Have not tried to enter the area' })}
        </div>
        ${adSec('Safety', `Reports and blocks in ${per}.`)}
        <div class="ad-grid">
          ${adTile('Reports about users', adN(sf.reports.reduce((a, b) => a + b.n, 0)))}
          ${adTile('Blocks', adN(sf.blocks))}
          ${adTile('Deleted accounts', adN(sf.deleted), { help: 'Since the start' })}
        </div>
        ${sf.reports.length ? `<div class="card tight"><div class="card-title">Report reasons</div>${adHBars('abuse', sf.reports.map(x => ({ label: x.reason, n: x.n })), { color: AD_C.orange })}</div>` : ''}`;
    }
    return `${head}${ctrl}${adminLoading ? '<div class="tiny muted mb">Updating…</div>' : ''}${body}<div class="tiny muted center mt-lg">Aggregate data, no emails. Days are counted by Israel time.</div>`;
  };

  /* ============================================================
     פרגון — ״רוצה לפרגן?״ · מימון נסיעת הנבחרת לתחרות בפורטוגל
     מדרג סכומים. התשלום עצמו ב-PayBox (קבוצה) או בביט, מחוץ לאפליקציה.
     PAYBOX_LINK: קישור ההזמנה לקבוצה (PayBox ← הקבוצה ← שיתוף קישור). ריק = מוצג רק ביט.
     ============================================================ */
  const PAYBOX_LINK = 'https://links.payboxapp.com/1UMNyxiuX7b'; // קבוצת "נסיעה לפורטוגל נבחרת לאומית"
  const BIT_LINK = 'https://www.bitpay.co.il/app/me/DBBB417F-9257-B2BF-4E31-4F9C93FDF7ECAB91';
  const TIERS = [
    { amt: 18, emoji: '💛', name: 'Chai', sub: 'Every shekel gets them closer to Portugal' },
    { amt: 50, emoji: '📣', name: 'Cheering from the stands', sub: 'So they know someone believes in them' },
    { amt: 100, emoji: '💪', name: 'Pushing them forward', sub: 'One more real step toward the flight' },
    { amt: 180, emoji: '✨', name: 'Partner in the dream', sub: 'A real part of their journey' },
    { amt: 360, emoji: '✈️', name: 'Giving them wings', sub: 'The biggest boost' },
  ];
  const heartArt = (size) => `<svg class="th-heart" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 42C9 32 4 24 6.5 16.5 9 9.5 18 8 24 15c6-7 15-5.5 17.5 1.5C44 24 39 32 24 42z" fill="#FFC3DF" stroke="#1C1A1F" stroke-width="2.4" stroke-linejoin="round"/><path d="M17 23c1.4-2.3 4-2.3 5.4 0M26 23c1.4-2.3 4-2.3 5.4 0M19.5 29c2.6 2.6 6.4 2.6 9 0" stroke="#1C1A1F" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>`;
  SCREENS.treat = () => false ? `${topbar({ title: 'Want to support us?' })}
    <div class="treat-hero">
      <div class="th-hearts" aria-hidden="true">${['💛', '💚', '💜', '🧡', '💗'].map((h, i) => `<span style="--i:${i}">${h}</span>`).join('')}</div>
      ${heartArt(64)}
      <div class="th-title">Want to support us? 💛</div>
      <p>We (okay, the dads too 😉) are raising money to send a competitive team to a competition in Portugal. The girls work very, very hard, and this app was created to fund the trip.</p>
      <p class="bold">So now you know: you keep your word, and you help a girl make a dream come true.</p>
      <button class="btn text team-link" onclick="App.teamSheet()">About the Hapoel Ironi Yavne team ›</button>
    </div>
    <div class="tier-list">${TIERS.map((t, i) => `<button class="tier" style="--i:${i}" onclick="App.treatPick(${t.amt}, this)">
      <span class="tier-emo" aria-hidden="true">${t.emoji}</span>
      <span class="tier-body"><span class="tier-name">${t.name}</span><span class="tier-sub">${t.sub}</span></span>
      <span class="tier-amt">₪${t.amt}</span>
    </button>`).join('')}
      <button class="tier other" style="--i:${TIERS.length}" onclick="App.treatPick(0, this)"><span class="tier-emo" aria-hidden="true">🤍</span><span class="tier-body"><span class="tier-name">Other amount</span><span class="tier-sub">Every amount helps</span></span></button>
    </div>
    <div class="tiny muted center mt">Support goes through ${PAYBOX_LINK ? 'PayBox or ' : ''}Bit, outside the app. It has no effect on the game, the points or the ranking.</div>` : '';
  function treatPick(amt, el) {
    Api.track(`support:${amt || 'other'}`);
    if (el) {
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      const burst = document.createElement('span'); burst.className = 'tc-burst'; burst.setAttribute('aria-hidden', 'true');
      burst.innerHTML = ['💛', '✨', '💗', '✈️', '✨', '💜'].map((e, i) => `<i style="--a:${-70 + i * 28}deg">${e}</i>`).join('');
      el.querySelector('.tier-emo').appendChild(burst); setTimeout(() => burst.remove(), 1100);
    }
    const t = TIERS.find(x => x.amt === amt);
    const pay = (href, label, cls) => `<a class="btn ${cls} treat-go" href="${esc(href)}" target="_blank" rel="noopener" onclick="App.closeSheet()">${label}</a>`;
    if (false) setTimeout(() => sheet(`<div class="sheet-hero treat-sheet">${heartArt(72)}<div class="sheet-title">Thank you! You are amazing 💛</div><div class="sheet-sub">${t ? `${t.emoji} ${t.name}` : 'Every amount helps them fly'}</div></div>
      ${amt ? `<div class="treat-amount"><span>In the app, type</span><b>₪${amt}</b></div>` : ''}
      ${PAYBOX_LINK ? pay(PAYBOX_LINK, `<span>Support with <bdi>PayBox</bdi>${amt ? ` · <bdi>₪${amt}</bdi>` : ''}</span>`, 'primary') : ''}
      ${BIT_LINK ? pay(BIT_LINK, `<span>Support with Bit${amt ? ` · <bdi>₪${amt}</bdi>` : ''}</span>`, PAYBOX_LINK ? 'soft mt' : 'primary') : ''}
      <button class="btn text mt" onclick="App.closeSheet()">Maybe later</button>`), el ? 420 : 0);
  }


  /* ============================================================
     S19 — בטיחות: חסימה ודיווח
     ============================================================ */
  function safetySheet(userId, circleId, inviteToken) {
    const u = userId ? Mila.user(userId) : null;
    const reasons = ['Pressure or harassment', 'Offensive content', 'Encouraging risky behavior', 'Impersonation or spam', 'Other'];
    sheet(`<div class="sheet-title">${u ? `Safety · ${esc(u.name)}` : 'Report this group'}</div><div class="sheet-sub">Blocking takes effect right away. Reports are reviewed.</div>
      <div class="field"><label>Reason for the report</label>${reasons.map(r => `<div class="choice" onclick="App.doReportAbuse('${u ? 'user' : inviteToken ? 'invite' : 'circle'}','${u ? u.id : inviteToken || circleId}','${r}')"><span class="radio"></span><div class="body"><div class="t">${r}</div></div></div>`).join('')}</div>
      ${u && !Mila.isBlocked(Mila.me().id, u.id) ? `<button class="btn danger" onclick="App.blockUser('${u.id}')">${icon('shield', 18)} Block ${esc(u.name)}</button><div class="tiny muted center mt">${esc(u.name)} won't see you and won't be able to invite you.</div>` : ''}`);
  }
  async function doReportAbuse(entityType, entityId, reason) { try { await Store().reportAbuse({ entityType, entityId, reason }); closeSheet(true); toast('Received. Thank you.'); } catch (e) { fail(e); } }
  async function blockUser(id) { try { await Store().block(id); closeSheet(true); toast('Blocked.'); render(); } catch (e) { fail(e); } }

  /* ============================================================
     אתחול
     ============================================================ */
  async function init() {
    Mila.load();
    $('#nav-ic-today').innerHTML = ICONS.home(22); $('#nav-ic-circles').innerHTML = ICONS.users(22); $('#nav-ic-me').innerHTML = ICONS.user(22);
    const params = new URLSearchParams(location.search);
    const urlToken = params.get('invite'); if (urlToken) saveInvite(urlToken);
    const token = urlToken || savedInvite();
    const goUrl = params.get('go') ? location.href : null;
    if (params.get('go') || params.get('source')) history.replaceState(null, '', location.pathname + (urlToken ? `?invite=${encodeURIComponent(urlToken)}` : ''));
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
    /* רישום ה-service worker, רענון כשחוזרים לאפליקציה וכשהרשת חוזרת. חייב לרוץ לפני הטעינה מהשרת:
       כל ענף שם מסתיים ב-return, ובלי זה ה-service worker לא נרשם (ואז אין התראות ואין עבודה בלי רשת). */
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(() => {});
    let lastDay = Mila.today();
    const dayTick = () => {
      if (!stack.length || document.visibilityState !== 'visible') return;
      const before = JSON.stringify(Object.values(Mila.getState().obligations).map(o => o.status)); Mila.refreshStatuses();
      const changed = JSON.stringify(Object.values(Mila.getState().obligations).map(o => o.status)) !== before || lastDay !== Mila.today(); lastDay = Mila.today();
      if (changed && TOP.includes(current().name) && !sheetOpen() && !busy) render();
    };
    /* נפתחה מהעותק השמור (אין תשובה מהשרת בהפעלה): בודקות שוב כשחוזרים לאפליקציה ופעם בדקה, וטוענות מחדש כשהשרת עונה */
    let probing = false;
    const probe = () => { if (probing || !Api.enabled || Api.hasSession() || !(Mila.getState().meta || {}).offline) return; probing = true; Api.init().then(u => { if (u) location.reload(); }).catch(() => {}).finally(() => { probing = false; }); };
    setInterval(() => { dayTick(); if (document.visibilityState === 'visible') probe(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible' || !stack.length) return; if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {}); dayTick(); probe(); updateIfIdle(); if (Api.isCloud()) Api.sync().catch(() => {}); });
    window.addEventListener('online', () => { if (Api.isCloud()) Api.sync().then(() => toast('Back online. Everything is up to date.', 'lime')).catch(() => {}); else if (Api.enabled && ((Mila.getState().meta || {}).offline || (stack.length && current().name === 'error'))) location.reload(); });   // נפתחה בלי רשת מהעותק השמור: טוענות מחדש כשהרשת חוזרת
    initPull(); initViewportFix();
    Api.track('visit');
    if (I() && I().detect().inapp) Api.track('visit_inapp');
    if (urlToken) { history.replaceState(null, '', location.pathname); Api.trackInviteOpen(urlToken); Api.track('visit_invite'); }
    const authError = params.get('auth_error');
    if (authError) { history.replaceState(null, '', location.pathname); setTimeout(() => toast('Sign-in was not completed. Try again.'), 300); }
    if (Api.enabled) {
      $('#screen').innerHTML = '<div class="empty" style="padding-top:40vh"><div class="muted small">Loading…</div></div>';
      try {
        await Api.init();
        Api.onSync(() => {
          if (!Api.hasSession() && Mila.getState().meta && Mila.getState().meta.cloud) return authLost();
          const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && $('#screen').contains(document.activeElement);
          if (stack.length && !sheetOpen() && !busy && !acting && !typing) render({ keepSheet: true });   // לא מציירות מחדש באמצע הקלדה (הפוקוס והמקלדת היו נעלמים)
        });
        if (Api.hasSession() && !Api.isCloud()) { pendingInviteToken = token; loadInvitePeek(token); go('profile', {}, { reset: true }); return; }
        if (Api.isCloud()) {
          await Api.sync();
          Api.startAutoSync();
          go('today', {}, { reset: true });
          // קישור הזמנה שנפתח עכשיו קודם; אחריו יעד של התראה; הזמנה שמורה מפעם קודמת רק אם אין יעד אחר
          if (urlToken) openInvite(urlToken); else if (goUrl) routeFromUrl(goUrl); else if (token) openInvite(token);
          if (window.MilaInstall) MilaInstall.refreshPush();
          return;
        }
      } catch (e) {
        console.error(e);
        if (e.code === 'OFFLINE' && Api.loadCache()) { toast('No network. This is the last saved version.'); go('today', {}, { reset: true }); return; }
        pendingInviteToken = token;
        go('error', { kind: e.code === 'OFFLINE' ? 'offline' : e.code === 'QUOTA' ? 'quota' : 'server' }, { reset: true }); return;
      }
      // אין session: אם יש מצב דמו מקומי שמור – נכבד אותו; אחרת מסך פתיחה
      if (Mila.me() && Mila.getState().meta.demo) { go('today', {}, { reset: true }); return; }
      pendingInviteToken = token; loadInvitePeek(token); go('welcome', {}, { reset: true }); return;
    }
    if (!Mila.me()) { pendingInviteToken = token; go('welcome', {}, { reset: true }); }
    else { go('today', {}, { reset: true }); if (token) openInvite(token); }
  }
  /* הכניסה פגה (401) באמצע שימוש: חוזרות למסך הפתיחה עם הסבר, במקום להמשיך ״לשמור״ לשום מקום */
  function authLost() {
    if (lostOnce) return; lostOnce = true;
    Api.stopAutoSync(); wiz = gwiz = cwiz = pick = inv = ob = null; busy = false;
    Mila.setState(Object.assign(Mila.emptyState(), { meta: { createdAt: new Date().toISOString(), demo: false, cloud: false } }));
    go('welcome', {}, { reset: true }); toast('Your sign-in expired. You need to sign in again.');
  }
  document.addEventListener('DOMContentLoaded', init);

  return {
    go, back, tab, refresh, closeSheet, toast, tryNow,     suChange, suToggle, signup, googleSignIn, authSet, completeProfile, signOut,
    sendEncouragement, rotateInvite, openInvite, rename, unblock, ideasCat: setIdeasCat, ideasToggle,
    reportSheet, confirmMiss, excuseSheet, doReport, correctionSheet, _corrPick, doCorrect,
    openWordWizard, wizSet, wizTemplate, wizNext, wizPrev, wizCancel, wizCommit, wordMenu, endWord,
    circleAddSheet, joinByCodeSheet, joinByCode, cwSet, cwCreate, encourageSheet, poke, cheer, circleMenu, leaveCircle, copyText, removeMember, cmSet,
    acceptInvite, declineInvite, openGroupWizard, memberSheet, setRole, deleteCircle, openPick, pickCat, pickToggle, pickClear, pickSet, pickReward, pickNext, pickBack, pickCancel, pickCustom, pickCommit, inviteFlow, invSet, invWord, invNewCircle, invNext, invBack, inviteClose, inviteDone, inviteRotate, inviteMsg, inviteSend, gwSet, gwTemplate, gwPropose, adopt, cancelProposal,
    again, retry, ageSubmit, friendsSheet, friendToggle, friendsInvite, cwFriend, groupInviteNo, groupInviteYes, teamSheet, supportHide, howSheet, exitDemo, invHeadBack, pickHeadBack, wizHeadBack, obToggle, obNext, obBack, obFriend, obSkip, obMore, obCommit, authAgree, pickTomorrow, pickNewName, pickRewardOpen, pickRewardDone, pickWhoSheet, installSheet, installNow, installHide, pushEnable, pushOff, pushTest, shareLink, shareStory,
    bankFilter: setBankFilter, treatPick, loadAdmin, adminSetTab, adHover, adLeave, adCsv, setSetting, exportData, resetDemo, deleteAccount, safetySheet, doReportAbuse, blockUser,
  };
})();
