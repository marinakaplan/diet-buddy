/* ============================================================
   מילה — שכבת API מול Supabase (api.js)
   - אימות: הרשמה/כניסה באימייל וסיסמה (Supabase Auth).
   - קריאה: rpc_my_state() מחזירה רק מה שהמשתמשת רשאית לראות; נטען לתוך
     אותו מבנה state שהמנוע המקומי משתמש בו, כך שכל פונקציות התצוגה עובדות.
   - כתיבה: כל פעולה היא RPC בשרת (הרשאות, תקרה, יומן). אחרי כל כתיבה – sync.
   ============================================================ */
const Api = (() => {
  'use strict';
  const cfg = window.MILA_CONFIG || {};
  const enabled = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  let client = null;
  let session = null;
  let syncTimer = null;
  const inviteTokens = {};       // circleId -> plaintext token שנוצר בסשן הזה
  const previewCache = {};       // token -> preview
  const listeners = new Set();

  function init() {
    if (!enabled) return Promise.resolve(null);
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    client.auth.onAuthStateChange((_e, s) => { session = s; });
    return client.auth.getSession().then(({ data }) => { session = data.session; return session; });
  }
  function isCloud() { return enabled && !!session; }
  function userId() { return session ? session.user.id : null; }

  /* ---------- שגיאות ---------- */
  function wrap(e) {
    const msg = (e && (e.hint || e.details || e.message)) || 'משהו השתבש';
    const code = (e && e.message || '').split(/[\s:]/)[0];
    const err = new Error(msg);
    err.userMessage = e && e.hint ? e.hint : friendly(msg);
    if (code === 'CAP') err.code = 'CAP';
    if (code === 'AUTH_REQUIRED' || code === 'PROFILE_REQUIRED') err.code = code;
    return err;
  }
  function friendly(m) {
    const map = {
      'Invalid login credentials': 'האימייל או הסיסמה לא נכונים',
      'User already registered': 'האימייל הזה כבר רשום. אפשר להתחבר.',
      'Password should be at least 6 characters': 'סיסמה של 6 תווים לפחות',
      'Email not confirmed': 'צריך לאשר את האימייל לפני הכניסה. בדקי את תיבת הדואר.',
      'Failed to fetch': 'אין חיבור לשרת. נסי שוב בעוד רגע.',
      'Email rate limit exceeded': 'נשלחו יותר מדי מיילים. נסי שוב בעוד כמה דקות.',
      'AUTH_REQUIRED': 'צריך להתחבר', 'PROFILE_REQUIRED': 'צריך להשלים הרשמה', 'FORBIDDEN': 'אין הרשאה לפעולה הזו', 'NOT_FOUND': 'לא נמצא',
    };
    for (const k of Object.keys(map)) if (m.includes(k)) return map[k];
    return m;
  }

  async function rpc(name, args = {}) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw wrap(error);
    return data;
  }

  /* ---------- אימות ---------- */
  async function signUp({ email, password, name, ageConfirmed }) {
    const { data, error } = await client.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name } } });
    if (error) throw wrap(error);
    session = data.session;
    if (!session) return { needsConfirmation: true };
    await rpc('rpc_upsert_profile', { p_name: name, p_age_confirmed: !!ageConfirmed, p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    await sync();
    return { needsConfirmation: false };
  }
  async function signIn({ email, password }) {
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw wrap(error);
    session = data.session;
    await sync();
  }
  async function completeProfile({ name, ageConfirmed }) {
    await rpc('rpc_upsert_profile', { p_name: name, p_age_confirmed: !!ageConfirmed, p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    await sync();
  }
  async function resetPassword(email) {
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
    if (error) throw wrap(error);
  }
  async function updatePassword(password) {
    const { error } = await client.auth.updateUser({ password });
    if (error) throw wrap(error);
  }
  async function signOut() {
    stopAutoSync();
    await client.auth.signOut();
    session = null;
    Mila.setState(Object.assign(Mila.emptyState(), { meta: { createdAt: new Date().toISOString(), demo: false, cloud: false } }));
  }

  /* ---------- סנכרון ---------- */
  async function sync() {
    if (!isCloud()) return null;
    const s = await rpc('rpc_my_state');
    if (!s || !s.me) { Mila.setState(Object.assign(Mila.emptyState(), { me: null, meta: { cloud: true, profileMissing: true } })); notify(); return null; }
    const prev = Mila.getState();
    const next = Object.assign(Mila.emptyState(), s, {
      invites: s.invites || {},
      drafts: (prev && prev.drafts) || {},
      pendingInvite: prev && prev.pendingInvite,
      meta: { createdAt: s.serverNow, demo: false, cloud: true, serverNow: s.serverNow, syncedAt: new Date().toISOString() },
    });
    Mila.setState(next);
    notify();
    return next;
  }
  function onSync(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function notify() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
  function startAutoSync(ms = 30000) {
    stopAutoSync();
    syncTimer = setInterval(() => { if (document.visibilityState === 'visible') sync().catch(() => {}); }, ms);
  }
  function stopAutoSync() { if (syncTimer) clearInterval(syncTimer); syncTimer = null; }

  /* ---------- פעולות (כולן בשרת) ---------- */
  const after = async (p) => { const r = await p; await sync(); return r; };
  const cloud = {
    updateSettings: (patch) => after(rpc('rpc_update_settings', { p_patch: patch })),
    renameMe: (name) => after(rpc('rpc_rename', { p_name: name })),
    createCircle: async (o) => {
      const r = await rpc('rpc_create_circle', { p_name: o.name, p_description: o.description || '', p_color: o.color || 'pink', p_who_can_propose: o.whoCanPropose || 'all', p_max_members: o.maxMembers || 8, p_round_start: o.roundStart || null });
      inviteTokens[r.circleId] = r.inviteToken;
      await sync();
      return { circle: Mila.getState().circles[r.circleId], invite: { token: r.inviteToken } };
    },
    updateCircle: (id, patch) => after(rpc('rpc_update_circle', { p_circle: id, p_patch: patch })),
    createInvite: async (circleId) => { const r = await rpc('rpc_create_invite', { p_circle: circleId }); inviteTokens[circleId] = r.token; await sync(); return { token: r.token, circleId }; },
    inviteToken: (circleId) => inviteTokens[circleId] || null,
    revokeInvite: async (token) => { await rpc('rpc_revoke_invite', { p_token: token }); for (const k of Object.keys(inviteTokens)) if (inviteTokens[k] === token) delete inviteTokens[k]; await sync(); },
    previewInvite: async (token) => { const p = await rpc('rpc_preview_invite', { p_token: token }); previewCache[token.toUpperCase()] = p; return p; },
    cachedPreview: (token) => previewCache[(token || '').toUpperCase()] || null,
    acceptInvite: async (token) => { const r = await rpc('rpc_accept_invite', { p_token: token }); await sync(); return Mila.getState().circles[r.circleId]; },
    leaveCircle: (id) => after(rpc('rpc_leave_circle', { p_circle: id })),
    removeMember: (id, userId) => after(rpc('rpc_remove_member', { p_circle: id, p_user: userId })),
    createPersonalWord: async (o) => {
      const r = await rpc('rpc_create_personal_word', { p_title: o.title, p_rule: o.rule, p_icon: o.icon || 'leaf', p_start: o.startDate, p_circle: o.circleId || null, p_visibility: o.visibility || 'private' });
      await sync();
      const S = Mila.getState(); delete S.drafts.word;
      return { def: S.wordDefs[r.defId], commitment: S.commitments[r.commitmentId] };
    },
    proposeGroupWord: async (circleId, o) => { const r = await rpc('rpc_propose_group_word', { p_circle: circleId, p_title: o.title, p_rule: o.rule, p_icon: o.icon || 'leaf', p_start: o.startDate, p_visibility: o.visibility || 'status' }); await sync(); return Mila.getState().wordDefs[r.defId]; },
    adoptGroupWord: async (defId) => { const r = await rpc('rpc_adopt_group_word', { p_def: defId }); await sync(); return Mila.getState().commitments[r.commitmentId]; },
    cancelProposal: (defId) => after(rpc('rpc_cancel_proposal', { p_def: defId })),
    endCommitment: (id) => after(rpc('rpc_end_commitment', { p_k: id })),
    updateWordVisibility: (defId, vis) => after(rpc('rpc_set_visibility', { p_def: defId, p_vis: vis })),
    report: async (obligationId, outcome, { note = '' } = {}) => { const r = await rpc('rpc_report', { p_obligation: obligationId, p_outcome: outcome, p_note: note }); await sync(); return { obligation: Mila.getState().obligations[obligationId], duplicate: !!r.duplicate }; },
    correct: async (obligationId, outcome, reason) => { await rpc('rpc_correct', { p_obligation: obligationId, p_outcome: outcome, p_reason: reason }); await sync(); return Mila.getState().obligations[obligationId]; },
    encourage: (eventId, reaction) => after(rpc('rpc_encourage', { p_event: eventId, p_reaction: reaction })),
    sendEncouragement: (circleId, to, reaction) => after(rpc('rpc_send_encouragement', { p_circle: circleId, p_to: to, p_reaction: reaction })),
    block: (uid) => after(rpc('rpc_block', { p_user: uid })),
    unblock: (uid) => after(rpc('rpc_unblock', { p_user: uid })),
    reportAbuse: (o) => after(rpc('rpc_report_abuse', { p_type: o.entityType, p_id: String(o.entityId), p_reason: o.reason, p_details: o.details || '' })),
    markAllRead: () => after(rpc('rpc_mark_notifications_read')),
    markSummarySeen: (id) => after(rpc('rpc_mark_summary_seen', { p_k: id })),
    deleteAccount: async () => { await rpc('rpc_delete_account'); await signOut(); },
  };

  return { enabled, init, isCloud, userId, signUp, signIn, signOut, completeProfile, resetPassword, updatePassword, sync, onSync, startAutoSync, stopAutoSync, cloud, rpc, get session() { return session; } };
})();
