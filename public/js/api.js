/* ============================================================
   מילה — שכבת API מול ה-Worker (api.js)
   - אימות: Google OAuth דרך /api/auth/google; הסשן בעוגיית HttpOnly (לא נגיש ל-JS).
   - קריאה: GET /api/state מחזיר רק מה שהמשתמשת רשאית לראות, באותו מבנה של המנוע המקומי.
   - כתיבה: POST /api/action/<name>. כל החוקים נאכפים בשרת. אחרי כל כתיבה – sync.
   אין סודות בצד הלקוח.
   ============================================================ */
const Api = (() => {
  'use strict';
  const enabled = location.protocol.startsWith('http') && !location.search.includes('local=1');
  let me = null;                 // {id,name,email,status}
  let config = { google: false, env: '' };
  let syncTimer = null;
  const inviteTokens = {};
  const previewCache = {};
  const listeners = new Set();

  async function call(path, { method = 'GET', body } = {}) {
    let res;
    try {
      // בלי תשובה תוך 20 שניות = כמו אין רשת (אחרת כפתור ״רגע…״ נתקע לנצח על רשת תקועה)
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null; const timer = ctl ? setTimeout(() => ctl.abort(), 20000) : null;
      try { res = await fetch(`/api/${path}`, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined }); }
      finally { if (timer) clearTimeout(timer); }
    } catch (e) { const err = new Error('offline'); err.userMessage = 'אין חיבור לשרת. הדיווח לא נשמר. נסי שוב כשיש רשת.'; err.code = 'OFFLINE'; throw err; }
    let data = null; try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const err = new Error((data && data.error) || `HTTP ${res.status}`);
      err.code = data && data.error; err.userMessage = (data && data.hint) || 'משהו השתבש. נסי שוב.'; err.status = res.status;
      if (data && data.cap) err.cap = data.cap;
      if (res.status === 401 && me) { me = null; stopAutoSync(); try { localStorage.removeItem('mila.cache'); } catch (e) { /* ignore */ } notify(); }   // הכניסה פגה: האפליקציה חוזרת למסך הפתיחה (app.js → authLost)
      throw err;
    }
    return data;
  }
  const action = (name, body) => call(`action/${name}`, { method: 'POST', body: body || {} });

  async function init() {
    if (!enabled) return null;
    const r = await call('me');
    me = r.user; config = r.config || config;
    if (!me) { try { localStorage.removeItem('mila.cache'); } catch (e) { /* ignore */ } }   // אין כניסה פעילה: לא משאירות עותק של חשבון קודם במכשיר
    return me;
  }
  function isCloud() { return enabled && !!me && me.status === 'active'; }
  function hasSession() { return enabled && !!me; }
  function userId() { return me ? me.id : null; }
  function googleUrl(next) { return `/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ''}`; }
  async function completeProfile({ name, ageConfirmed, termsAccepted, inviteToken }) {
    await call('profile', { method: 'POST', body: { name, ageConfirmed, termsAccepted, inviteToken: inviteToken || undefined, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
    await init(); await sync();
  }
  async function signOut() {
    stopAutoSync();
    try { await call('auth/logout', { method: 'POST', body: {} }); } catch (e) { /* ignore */ }
    me = null;
    try { localStorage.removeItem('mila.cache'); } catch (e) { /* ignore */ }
    Mila.setState(Object.assign(Mila.emptyState(), { meta: { createdAt: new Date().toISOString(), demo: false, cloud: false } }));
  }

  /* מבקרת אנונימית (לספירת פתיחות קישור הזמנה ייחודיות) */
  function visitorId() { try { let v = localStorage.getItem('mila.visitor'); if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).toLowerCase(); localStorage.setItem('mila.visitor', v); } return v; } catch (e) { return 'anon-' + Math.random().toString(36).slice(2, 12); } }
  function trackInviteOpen(token) { if (!enabled || !token) return; if (window.MilaA11y && MilaA11y.consent() === 'essential') return; call('invite/open', { method: 'POST', body: { token, visitor: visitorId() } }).catch(() => {}); }
  /* מי מזמינה ולאיזו קבוצה — לפני הכניסה (ציבורי, קריאה בלבד) */
  const peekInvite = (token) => (enabled && token ? call(`invite/peek?token=${encodeURIComponent(token)}`) : Promise.resolve({ ok: false }));
  const adminStats = (days = 30) => call(`admin/stats?days=${days}`);
  /* מעקב זול: כל אירוע נשלח לכל היותר פעם ביום מכל מכשיר */
  function track(name) {
    if (!enabled) return;
    if (window.MilaA11y && MilaA11y.consent() === 'essential') return; // ״רק הכרחי״: בלי מונה אנונימי
    try { const k = `mila.t.${name}`; const day = new Date().toISOString().slice(0, 10); if (localStorage.getItem(k) === day) return; localStorage.setItem(k, day); } catch (e) { /* בלי אחסון: שולחות בכל זאת */ }
    call('track', { method: 'POST', body: { name, visitor: visitorId() } }).catch(() => {});
  }

  /* ---------- סנכרון ---------- */
  async function sync() {
    if (!isCloud()) return null;
    lastFull = Date.now();
    const s = await call('state');
    const prev = Mila.getState();
    const next = Object.assign(Mila.emptyState(), s, { drafts: (prev && prev.drafts) || {}, meta: { createdAt: s.serverNow, demo: false, cloud: true, serverNow: s.serverNow, syncedAt: new Date().toISOString() } });
    Mila.setState(next);
    try { localStorage.setItem('mila.cache', JSON.stringify(next)); } catch (e) { /* ignore */ }
    notify();
    return next;
  }
  /* טעינת עותק אחרון לקריאה בלבד כשאין רשת. נשמר במכשיר (localStorage) כדי שגם פתיחה של האפליקציה המותקנת בלי רשת תציג את המצב האחרון; נמחק ביציאה מהחשבון. */
  function loadCache() { try { const s = localStorage.getItem('mila.cache'); if (s) { const st = JSON.parse(s); st.meta.offline = true; Mila.setState(st); return true; } } catch (e) { /* ignore */ } return false; }
  function onSync(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function notify() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
  /* ריענון קל: כל 45 שניות בודקות חותמת זולה (/api/ping). טוענות מצב מלא רק כשמשהו השתנה,
     או אחת ל-10 דקות. כך המכסה החינמית מחזיקה הרבה יותר משתמשות. */
  let lastPing = null, lastFull = 0;
  function startAutoSync(ms = 45000) {
    stopAutoSync(); lastFull = Date.now();
    syncTimer = setInterval(async () => {
      if (document.visibilityState !== 'visible' || !isCloud()) return;
      try {
        const { v } = await call('ping');
        const changed = lastPing !== null && v !== lastPing; lastPing = v;
        if (changed || Date.now() - lastFull > 10 * 60000) { lastFull = Date.now(); await sync(); }
      } catch (e) { /* בלי רשת: ננסה בפעם הבאה */ }
    }, ms);
  }
  function stopAutoSync() { if (syncTimer) clearInterval(syncTimer); syncTimer = null; }

  /* ---------- פעולות (כולן בשרת) ---------- */
  const after = async (p) => { const r = await p; await sync(); return r; };
  const cloud = {
    updateSettings: (patch) => after(action('updateSettings', { patch })),
    renameMe: (name) => after(action('rename', { name })),
    setBirthDate: async (birthDate) => { const r = await action('setBirthDate', { birthDate }); await sync(); return r; },
    createCircle: async (o) => { const r = await action('createCircle', o); inviteTokens[r.circleId] = r.inviteToken; await sync(); return { circle: Mila.getState().circles[r.circleId], invite: { token: r.inviteToken } }; },
    updateCircle: (circleId, patch) => after(action('updateCircle', { circleId, patch })),
    createInvite: async (circleId, opts = {}) => { const r = await action('createInvite', { circleId, kind: opts.kind, message: opts.message, libraryId: opts.libraryId, wordTitle: opts.wordTitle }); inviteTokens[circleId] = r.token; await sync(); return { token: r.token, circleId }; },
    inviteFriends: async (circleId, userIds) => { const r = await action('inviteFriends', { circleId, userIds }); await sync(); return r; },
    inviteToken: (circleId) => inviteTokens[circleId] || null,
    revokeCircleInvites: async (circleId) => { const r = await action('revokeCircleInvites', { circleId }); inviteTokens[circleId] = r.token; await sync(); return { token: r.token }; },
    previewInvite: async (token) => { const p = await action('previewInvite', { token }); previewCache[token.toUpperCase()] = p; return p; },
    cachedPreview: (token) => previewCache[(token || '').toUpperCase()] || null,
    acceptInvite: async (token) => { const r = await action('acceptInvite', { token }); await sync(); return Mila.getState().circles[r.circleId]; },
    leaveCircle: (circleId) => after(action('leaveCircle', { circleId })),
    removeMember: (circleId, userId) => after(action('removeMember', { circleId, userId })),
    overtake: (circleId, passedUserId) => action('overtake', { circleId, passedUserId }),
    setMemberRole: (circleId, userId, role) => after(action('setMemberRole', { circleId, userId, role })),
    deleteCircle: (circleId) => after(action('deleteCircle', { circleId })),
    createPersonalWord: async (o) => { const r = await action('createPersonalWord', o); await sync(); const S = Mila.getState(); delete S.drafts.word; return { def: S.wordDefs[r.defId], commitment: S.commitments[r.commitmentId] }; },
    proposeGroupWord: async (circleId, o) => { const r = await action('proposeGroupWord', { ...o, circleId }); await sync(); return Mila.getState().wordDefs[r.defId]; },
    adoptGroupWord: async (defId) => { const r = await action('adoptGroupWord', { defId }); await sync(); return Mila.getState().commitments[r.commitmentId]; },
    cancelProposal: (defId) => after(action('cancelProposal', { defId })),
    endCommitment: (commitmentId) => after(action('endCommitment', { commitmentId })),
    report: async (obligationId, outcome, { note = '' } = {}) => { const r = await action('report', { obligationId, outcome, note }); await sync(); return { obligation: Mila.getState().obligations[obligationId], duplicate: !!r.duplicate }; },
    correct: async (obligationId, outcome, reason) => { await action('correct', { obligationId, outcome, reason }); await sync(); return Mila.getState().obligations[obligationId]; },
    encourage: (eventId, reaction) => after(action('encourage', { eventId, reaction })),
    sendEncouragement: (circleId, toUserId, reaction) => after(action('sendEncouragement', { circleId, toUserId, reaction })),
    block: (userId) => after(action('block', { userId })),
    unblock: (userId) => after(action('unblock', { userId })),
    reportAbuse: (o) => after(action('reportAbuse', o)),
    markAllRead: () => after(action('markNotificationsRead')),
    markSummarySeen: (commitmentId) => after(action('markSummarySeen', { commitmentId })),
    deleteAccount: async () => { await action('deleteAccount'); await signOut(); },
    exportData: () => action('exportData'),
  };

  return { enabled, init, isCloud, hasSession, userId, googleUrl, completeProfile, signOut, sync, trackInviteOpen, peekInvite, adminStats, track, loadCache, onSync, startAutoSync, stopAutoSync, cloud, call, get me() { return me; }, get config() { return config; } };
})();
