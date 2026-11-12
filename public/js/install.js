/* מילה — "מילה על המסך הראשי" + התראות (install.js)
   מזהה טלפון/דפדפן ומציגה הוראות מדויקות לכל אחד:
   אייפון (Safari / Chrome / דפדפנים אחרים), אנדרואיד (Chrome עם התקנה בלחיצה, סמסונג, פיירפוקס),
   דפדפן בתוך אפליקציה (וואטסאפ, אינסטגרם, פייסבוק, טיקטוק…), מחשב, וכבר מותקנת.
   התראות: Web Push דרך השרת שלנו (מפתח VAPID ציבורי בלבד בדפדפן). */
(function (root) {
  'use strict';
  const nav = root.navigator || {}; const ua = nav.userAgent || '';
  // Api מוגדר ב-api.js כ-const גלובלי (לא window.Api), לכן ניגשות אליו כך:
  const A = () => (typeof Api !== 'undefined' ? Api : null);
  let deferred = null; // אירוע beforeinstallprompt (אנדרואיד/מחשב בכרום ואדג׳)
  const listeners = new Set();
  const changed = () => listeners.forEach(f => { try { f(); } catch (e) { } });
  root.addEventListener && root.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; changed(); });
  root.addEventListener && root.addEventListener('appinstalled', () => { deferred = null; mark('installed'); A() && A().track('installed'); changed(); });

  /* ---------- זיהוי ---------- */
  function detect() {
    const iPadOS = /Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1;
    const ios = /iPhone|iPad|iPod/.test(ua) || iPadOS;
    const android = /Android/i.test(ua);
    const inapp = /WhatsApp/i.test(ua) ? 'WhatsApp' : /Instagram/i.test(ua) ? 'Instagram' : /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua) ? 'Facebook' : /musical_ly|Bytedance|TikTok/i.test(ua) ? 'TikTok' : /Messenger/i.test(ua) ? 'Messenger' : /LinkedInApp/i.test(ua) ? 'LinkedIn' : /Snapchat/i.test(ua) ? 'Snapchat' : /Line\//.test(ua) ? 'Line' : /Telegram/i.test(ua) ? 'Telegram' : /GSA\//.test(ua) && ios ? 'Google' : (android && /; wv\)/.test(ua)) ? 'an app' : null;
    const browser = ios
      ? (/CriOS/.test(ua) ? 'chrome' : /FxiOS/.test(ua) ? 'firefox' : /EdgiOS/.test(ua) ? 'edge' : /OPiOS|OPT\//.test(ua) ? 'opera' : /DuckDuckGo/i.test(ua) ? 'duck' : 'safari')
      : /SamsungBrowser/i.test(ua) ? 'samsung' : /Firefox|FxiOS/i.test(ua) ? 'firefox' : /Edg\//.test(ua) ? 'edge' : /OPR\/|Opera/.test(ua) ? 'opera' : /Chrome|Chromium|CriOS/.test(ua) ? 'chrome' : /Safari/.test(ua) ? 'safari' : 'other';
    const m = ua.match(/OS (\d+)[_.](\d+)/); const iosVersion = ios && m ? Number(m[1]) + Number(m[2]) / 100 : null;
    const standalone = !!((root.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: minimal-ui)').matches)) || nav.standalone);
    const os = ios ? 'ios' : android ? 'android' : 'desktop';
    const pushApi = 'serviceWorker' in nav && 'PushManager' in root && 'Notification' in root;
    return { os, browser, inapp, standalone, iosVersion, iPad: iPadOS || /iPad/.test(ua), canPrompt: !!deferred, pushApi, pushNeedsInstall: ios && !standalone, iosTooOld: ios && iosVersion && iosVersion < 16.4 };
  }
  const platformName = (d) => d.os === 'ios' ? (d.iPad ? 'iPad' : 'iPhone') : d.os === 'android' ? (/SM-|Samsung/i.test(ua) ? 'Samsung' : 'Android') : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'desktop';
  const browserName = { safari: 'Safari', chrome: 'Chrome', firefox: 'Firefox', edge: 'Edge', samsung: 'Samsung Internet', opera: 'Opera', duck: 'DuckDuckGo', other: 'your browser' };

  /* ---------- זיכרון מקומי קטן ---------- */
  const LS = 'mila.install';
  const get = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } };
  const mark = (k, v = Date.now()) => { try { const o = get(); o[k] = v; localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { } };

  /* ---------- התקנה ---------- */
  async function prompt() {
    if (!deferred) return 'none';
    A() && A().track('install_prompt');
    deferred.prompt();
    let r = 'dismissed'; try { r = (await deferred.userChoice).outcome; } catch (e) { }
    deferred = null; changed();
    return r;
  }

  /* ---------- התראות ---------- */
  const b64ToBytes = (s) => { const raw = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
  const permission = () => ('Notification' in root ? Notification.permission : 'unsupported');
  /* בלי לחכות לנצח: אם ה-service worker לא פעיל (למשל טעינה ראשונה), מחכות עד 8 שניות לכל היותר */
  async function registration(wait = false) {
    if (!('serviceWorker' in nav)) return null;
    try { const r = await nav.serviceWorker.getRegistration(); if ((r && r.active) || !wait) return r || null; } catch (e) { return null; }
    return Promise.race([nav.serviceWorker.ready.catch(() => null), new Promise(res => setTimeout(() => res(null), 8000))]);
  }
  async function subscription() { const reg = await registration(); if (!reg || !reg.pushManager) return null; try { return await reg.pushManager.getSubscription(); } catch (e) { return null; } }
  let pushState = { checked: false, on: false };
  async function refreshPush() {
    const d = detect();
    if (!d.pushApi || permission() !== 'granted') { pushState = { checked: true, on: false }; changed(); return pushState; }
    const sub = await subscription();
    let on = !!sub;
    if (sub && A() && A().isCloud()) { try { on = (await Api.call('push/status', { method: 'POST', body: { endpoint: sub.endpoint } })).subscribed; if (!on) on = await save(sub); } catch (e) { } }
    pushState = { checked: true, on }; changed(); return pushState;
  }
  async function save(sub) {
    const d = detect();
    await Api.call('push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), platform: `${d.os}-${d.browser}${d.standalone ? '-app' : ''}` } });
    return true;
  }
  /* מפעילה: בקשת הרשאה (חייבת לבוא מלחיצה), מינוי, ושמירה בשרת */
  async function enablePush() {
    const d = detect();
    if (!d.pushApi) throw Object.assign(new Error('unsupported'), { userMessage: d.pushNeedsInstall ? 'On iPhone, first add Mila to your home screen and open it from there.' : "This browser doesn't support notifications." });
    if (!(A() && A().isCloud())) throw Object.assign(new Error('auth'), { userMessage: 'Notifications work once you sign in with an account.' });
    const p = permission() === 'granted' ? 'granted' : await Notification.requestPermission();
    if (p !== 'granted') { Api.track('push_denied'); changed(); throw Object.assign(new Error('denied'), { code: 'DENIED', userMessage: 'Notifications are blocked. You can unblock them in settings.' }); }
    const reg = await registration(true); if (!reg) throw Object.assign(new Error('sw'), { userMessage: "Something didn't load. Refresh and try again." });
    let sub = await reg.pushManager.getSubscription();
    const { key } = await Api.call('push/key');
    // מינוי ישן עם מפתח אחר (נדיר) — מחליפות
    if (sub && sub.options && sub.options.applicationServerKey) { const a = new Uint8Array(sub.options.applicationServerKey); const b = b64ToBytes(key); if (a.length !== b.length || a.some((x, i) => x !== b[i])) { await sub.unsubscribe(); sub = null; } }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    await save(sub);
    Api.track('push_on'); mark('pushOn');
    pushState = { checked: true, on: true }; changed();
    return true;
  }
  async function disablePush() {
    const sub = await subscription();
    if (sub) { try { await Api.call('push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); } catch (e) { } try { await sub.unsubscribe(); } catch (e) { } }
    pushState = { checked: true, on: false }; changed();
  }
  async function testPush() {
    const none = () => Object.assign(new Error('no'), { userMessage: "Notifications aren't active on this device. Turn them off and on again." });
    const send = (s) => Api.call('push/test', { method: 'POST', body: { endpoint: s.endpoint } });
    let sub = await subscription();
    if (!sub) { if (permission() !== 'granted') throw none(); await enablePush(); sub = await subscription(); if (!sub) throw none(); }   // יש הרשאה אבל המינוי נעלם: יוצרות אותו מחדש
    try { return await send(sub); }
    catch (e) {
      if (e.code === 'NOT_SUBSCRIBED') { await save(sub); return send(sub); }   // השרת לא מכיר את המכשיר: רושמות אותו ושולחות
      if (!e.gone) throw e;
      // שירות ההתראות דחה את המינוי של המכשיר: יוצרות מינוי חדש ומנסות פעם אחת
      try { await sub.unsubscribe(); } catch (x) { /* ignore */ }
      await enablePush(); sub = await subscription(); if (!sub) throw e;
      return send(sub);
    }
  }
  /* ביציאה מהחשבון: המכשיר מפסיק לקבל התראות של החשבון הזה */
  async function onSignOut() { try { const sub = await subscription(); if (sub) { await Api.call('push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe(); } } catch (e) { } pushState = { checked: true, on: false }; }

  /* ---------- הוראות לכל מכשיר ---------- */
  const G = {
    share: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M7 10H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1"/></svg>',
    addSq: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M12 8v8M8 12h8"/></svg>',
    dots: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    hdots: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    burger: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    install: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2.5"/><path d="M12 8v6M9 11l3 3 3-3M8 21h8"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    home: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="3"/><rect x="9" y="6.5" width="6" height="6" rx="1.6" fill="#D9F565" stroke="currentColor"/></svg>',
    compass: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor"/></svg>',
    bell: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
  };
  const step = (glyph, title, sub = '') => ({ glyph, title, sub });

  function guide(d, osOverride) {
    const os = osOverride || d.os;
    const real = !osOverride || osOverride === d.os;
    if (real && d.standalone) return { kind: 'installed' };
    if (real && d.inapp) return {
      kind: 'inapp', title: `You're in ${d.inapp}`, sub: "You can't add Mila to your home screen from here. Open it in your regular browser and continue from there.",
      steps: os === 'ios'
        ? [step(G.hdots, 'Tap ⋯ or the compass icon', 'Usually in a top or bottom corner'), step(G.compass, 'Choose “Open in Safari”', 'or “Open in browser”'), step(G.share, 'In Safari, follow the iPhone instructions')]
        : [step(G.dots, 'Tap ⋮ in the top corner'), step(G.compass, 'Choose “Open in Chrome”', 'or “Open in browser”'), step(G.addSq, 'In Chrome, follow the Android instructions')],
      openIn: os === 'ios' ? 'safari' : 'chrome',
    };
    if (os === 'ios') {
      const notSafari = real && d.browser !== 'safari';
      return {
        kind: 'ios', title: d.iPad && real ? 'Add Mila to your iPad home screen' : 'Add Mila to your iPhone home screen',
        sub: notSafari ? `This works from ${browserName[d.browser] || 'this browser'} too. Safari is the safest choice.` : '30 seconds, one time. After that it opens like any other app.',
        steps: notSafari
          ? [step(G.share, 'Tap the Share button', "Next to the address bar. If it isn't there, look in the ⋯ menu"), step(G.addSq, 'Choose “Add to Home Screen”', "Don't see it? Scroll down the list a little"), step(G.check, 'Tap “Add”'), step(G.home, 'Open Mila from your home screen', 'and turn on notifications from there')]
          : [step(G.share, 'Tap the Share button', d.iPad && real ? 'At the top, next to the address bar' : "In the bottom bar. Don't see it? Tap ⋯ first"), step(G.addSq, 'Choose “Add to Home Screen”', 'Not there? Scroll down, or tap “More”'), step(G.check, 'Leave “Open as Web App” on and tap “Add”', "If the switch isn't there, just tap “Add”"), step(G.home, 'Open Mila from your home screen', 'and turn on notifications from there')],
        safariLink: notSafari, arrow: real && !d.iPad && d.browser === 'safari',
      };
    }
    if (os === 'android') {
      const b = real ? d.browser : 'chrome';
      if (b === 'samsung') return { kind: 'android', title: 'Add Mila to your home screen', sub: 'In Samsung Internet.', prompt: real && d.canPrompt,
        steps: [step(G.burger, 'Tap ☰ in the bottom bar'), step(G.addSq, 'Choose “Add page to”', 'or the download icon in the address bar'), step(G.home, 'Choose “Home screen” and confirm')] };
      if (b === 'firefox') return { kind: 'android', title: 'Add Mila to your home screen', sub: 'In Firefox.',
        steps: [step(G.dots, 'Tap ⋮'), step(G.addSq, 'Choose “Add to Home screen”', 'or “Install”'), step(G.check, 'Confirm with “Add”')] };
      return { kind: 'android', title: 'Install Mila on your phone', sub: real && d.canPrompt ? 'One tap. No store and no download.' : 'No store and no download.', prompt: real && d.canPrompt,
        steps: [step(G.dots, 'Tap ⋮ in the top corner'), step(G.addSq, 'Choose “Install app”', 'or “Add to Home screen”'), step(G.check, 'Tap “Install”'), step(G.home, 'Mila is waiting for you on your home screen')] };
    }
    // מחשב
    const b = real ? d.browser : 'chrome';
    if (b === 'safari') return { kind: 'desktop', title: 'Mila in your Mac Dock', sub: 'In Safari (macOS Sonoma or later).', steps: [step(G.share, 'Open the “File” menu, or the Share button'), step(G.addSq, 'Choose “Add to Dock”'), step(G.check, 'Confirm with “Add”')] };
    if (b === 'firefox') return { kind: 'desktop', title: 'Best on your phone', sub: "Firefox on desktop doesn't install web apps. Send yourself the link and open it on your phone.", steps: [], copyOnly: true };
    return { kind: 'desktop', title: 'Install Mila on your computer', sub: real && d.canPrompt ? 'One click.' : 'In Chrome or Edge.', prompt: real && d.canPrompt,
      steps: [step(G.install, 'Click the install icon in the address bar', 'A small screen with an arrow, at the end of the address bar'), step(G.check, 'Click “Install”'), step(G.bell, "And it's even better on your phone", 'Open the same link on your phone')] };
  }

  /* הוראות לפתיחת התראות שנחסמו */
  function unblockSteps(d) {
    if (d.os === 'ios') return [step(G.gear, 'Open “Settings” on your iPhone'), step(G.bell, '“Notifications” → Mila'), step(G.check, 'Turn on “Allow Notifications”')];
    if (d.os === 'android') return d.standalone
      ? [step(G.home, 'Long-press the Mila icon'), step(G.gear, '“App info” → “Notifications”'), step(G.check, 'Turn them on')]
      : [step(G.lock, 'Tap the lock or ⚙ next to the address'), step(G.gear, '“Permissions” → “Notifications”'), step(G.check, 'Choose “Allow”')];
    return [step(G.lock, 'Click the lock next to the address'), step(G.bell, 'Notifications → “Allow”'), step(G.check, 'Refresh the page')];
  }

  root.MilaInstall = { detect, platformName, browserName, guide, unblockSteps, prompt, permission, enablePush, disablePush, testPush, refreshPush, onSignOut, get pushOn() { return pushState.on; }, get pushChecked() { return pushState.checked; }, onChange: (f) => listeners.add(f), get: get, mark, G };
})(typeof window !== 'undefined' ? window : globalThis);
