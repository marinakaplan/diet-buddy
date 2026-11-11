/* ============================================================
   מילה — מנוע המשחק (engine.js)
   מקור האמת לחוקי המשחק. כרגע רץ בצד הלקוח מעל localStorage,
   אבל כתוב כך שניתן להעביר אותו אחד־לאחד לשרת:
   כל פעולה מקבלת state, מאמתת הרשאות וחוקים, וכותבת ביומן.

   חוקים מרכזיים (לפי האפיון):
   - סבב = 14 ימים.          - לכל היותר 3 אירועים מחייבים ביום, בכל הקבוצות יחד.
   - נקודה (EARN) נוצרת רק בהכרעה. - הצלחה -> EARN ; פספוס -> MISS_TO_CIRCLE / MISS_PERSONAL ; החרגה -> אין מטבע.
   - יומן תנועות append-only. תיקון = REVERSE + תנועה חדשה, לא מחיקה.
   - דיווח חוזר מחזיר את ההכרעה הקיימת (idempotent).
   ============================================================ */

const Mila = (() => {
  'use strict';

  const STORAGE_KEY = 'mila.state.v1';
  const RULES = {
    ROUND_DAYS: 14,
    DAILY_CAP: 3,
    MAX_EXCUSES_PER_ROUND: 2,
    GRACE_HOUR: 10,          // חלון השלמה עד 10:00 למחרת
    CORRECTION_HOURS: 24,    // חלון תיקון אחרי הכרעה
    INVITE_DAYS: 7,
    MAX_MEMBERS_DEFAULT: 8,
    MIN_RANKED_EVENTS: 3,
  };

  let state = null;

  /* ---------- כלי עזר ---------- */
  const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
  // שעון ניתן להזרקה (לבדיקות ולמסע-בזמן ב-QA). בייצור: השעון של השרת.
  let clockFn = null;
  const now = () => (clockFn ? new Date(clockFn()) : new Date());
  function setClock(fn) { clockFn = fn; }
  const nowISO = () => now().toISOString();
  const pad = (n) => String(n).padStart(2, '0');

  function toLocalDate(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return toLocalDate(d); }
  function diffDays(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
  function today() { return toLocalDate(now()); }
  function dateRange(start, days) { return Array.from({ length: days }, (_, i) => addDays(start, i)); }
  function fmtDate(s, opts = { day: 'numeric', month: 'numeric' }) {
    return parseDate(s).toLocaleDateString('he-IL', opts);
  }
  function fmtDateLong(s) {
    return parseDate(s).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function relDay(s) {
    const d = diffDays(today(), s);
    if (d === 0) return 'היום';
    if (d === -1) return 'אתמול';
    if (d === 1) return 'מחר';
    return fmtDate(s);
  }
  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }
  function hashStr(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

  /* ---------- state ---------- */
  function emptyState() {
    return {
      version: 1,
      me: null,                 // user id
      users: {},                // id -> {id,name,color,createdAt,settings,ageConfirmed}
      circles: {},              // id -> {...}
      memberships: [],          // {id,circleId,userId,role,joinedAt,leftAt}
      invites: {},              // token -> {token,circleId,inviterId,createdAt,expiresAt,status,uses,maxUses}
      wordDefs: {},             // id -> {id,kind:'personal'|'group',circleId,ownerId,title,rule,icon,visibility,version,startDate,status,createdAt}
      commitments: {},          // id -> {id,defId,userId,startDate,endDate,status,createdAt}
      obligations: {},          // id -> {id,commitmentId,userId,localDate,status,outcome,resolvedAt,reportedAt}
      ledger: [],               // append-only
      resolutionHistory: [],    // {id,obligationId,from,to,reason,actorId,at}
      achievements: [],         // {id,userId,type,earnedAt,sourceRef}
      socialEvents: [],         // {id,circleId,actorId,type,payload,createdAt}
      encouragements: [],       // {id,eventId,userId,reaction,createdAt}
      blocks: [],               // {blockerId,blockedId,at}
      abuseReports: [],
      notifications: [],        // {id,userId,type,title,body,createdAt,read,ref}
      drafts: {},               // {word: {...}}
      meta: { createdAt: nowISO(), demo: false },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      state = raw ? JSON.parse(raw) : emptyState();
    } catch (e) { state = emptyState(); }
    if (!state.version) state = emptyState();
    return state;
  }
  function save() {
    if (state && state.meta && state.meta.cloud) return; // במצב ענן השרת הוא מקור האמת; לא שומרים עותק מקומי
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }
  function reset() { state = emptyState(); save(); return state; }
  function getState() { return state; }
  function setState(s) { state = s; save(); }

  /* ---------- משתמשים ---------- */
  const AVATAR_COLORS = ['lime', 'pink', 'lavender', 'mint', 'peach', 'sky'];

  function createUser({ name, ageConfirmed = false, color }) {
    const id = uid('u');
    const user = {
      id, name: name.trim(), color: color || AVATAR_COLORS[hashStr(name) % AVATAR_COLORS.length],
      createdAt: nowISO(), ageConfirmed, adult: ageConfirmed ? true : null, adultFrom: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      settings: { reminderTime: '20:00', pushReminders: true, socialDigest: true, hideFromLeaderboard: false, lockScreenPrivacy: true },
    };
    state.users[id] = user;
    return user;
  }
  function me() { return state.me ? state.users[state.me] : null; }
  function user(id) { return state.users[id]; }
  function updateSettings(patch) { Object.assign(me().settings, patch); save(); }
  function renameMe(name) { me().name = name.trim(); save(); }

  /* ---------- קבוצות ---------- */
  function activeMemberships(circleId) {
    return state.memberships.filter(m => m.circleId === circleId && !m.leftAt);
  }
  function myCircles(userId = state.me) {
    return state.memberships
      .filter(m => m.userId === userId && !m.leftAt)
      .map(m => state.circles[m.circleId])
      .filter(c => c && c.status === 'active');
  }
  function membership(circleId, userId = state.me) {
    return state.memberships.find(m => m.circleId === circleId && m.userId === userId && !m.leftAt) || null;
  }
  function isMember(circleId, userId = state.me) { return !!membership(circleId, userId); }
  function isAdmin(circleId, userId = state.me) { const m = membership(circleId, userId); return !!m && m.role === 'admin'; }
  function circleMembers(circleId) { return activeMemberships(circleId).map(m => ({ ...state.users[m.userId], role: m.role, joinedAt: m.joinedAt })); }

  function createCircle({ name, description = '', color, whoCanPropose = 'all', maxMembers = RULES.MAX_MEMBERS_DEFAULT, roundStart = today() }) {
    if (!name || !name.trim()) throw err('שם הקבוצה לא יכול להיות ריק');
    if (name.trim().length > 50) throw err('שם הקבוצה ארוך מדי (עד 50 תווים)');
    const id = uid('c');
    const circle = {
      id, name: name.trim(), description: description.trim(), ownerId: state.me,
      color: color || AVATAR_COLORS[hashStr(name) % AVATAR_COLORS.length],
      whoCanPropose, maxMembers, roundStart, status: 'active', createdAt: nowISO(), rulesVersion: 1,
    };
    state.circles[id] = circle;
    state.memberships.push({ id: uid('m'), circleId: id, userId: state.me, role: 'admin', joinedAt: nowISO(), leftAt: null });
    const invite = createInvite(id);
    addEvent(id, state.me, 'circle_created', {});
    grant(state.me, 'first_circle', id);
    save();
    return { circle, invite };
  }

  function updateCircle(circleId, patch) {
    if (!isAdmin(circleId)) throw err('רק מנהלת יכולה לשנות את פרטי הקבוצה');
    const c = state.circles[circleId];
    const allowed = ['name', 'description', 'whoCanPropose', 'maxMembers', 'color'];
    for (const k of allowed) if (k in patch) c[k] = patch[k];
    save();
    return c;
  }

  /* סבב של קבוצה: חלונות של 14 יום מעוגנים ל-roundStart */
  function circleRound(circleId, date = today()) {
    const c = state.circles[circleId];
    const d = diffDays(c.roundStart, date);
    const idx = Math.floor(d / RULES.ROUND_DAYS);
    const start = addDays(c.roundStart, idx * RULES.ROUND_DAYS);
    const end = addDays(start, RULES.ROUND_DAYS - 1);
    const dayIndex = Math.min(Math.max(diffDays(start, date) + 1, 0), RULES.ROUND_DAYS);
    return { index: idx + 1, start, end, dayIndex, nextStart: addDays(start, RULES.ROUND_DAYS) };
  }

  /* ---------- הזמנות ---------- */
  const INVITE_KINDS = ['follow', 'compete', 'same'];
  function createInvite(circleId, { maxUses = 20, kind = 'follow', message = '', libraryId = null, wordTitle = '' } = {}) {
    if (!isMember(circleId)) throw err('אין הרשאה');
    if (!INVITE_KINDS.includes(kind)) kind = 'follow';
    if (libraryId && !LIB.get(libraryId)) libraryId = null;
    const token = Math.random().toString(36).slice(2, 8).toUpperCase();
    const inv = { token, circleId, inviterId: state.me, createdAt: nowISO(), expiresAt: new Date(now().getTime() + RULES.INVITE_DAYS * 86400000).toISOString(), status: 'active', uses: 0, maxUses, kind, message: String(message || '').trim().slice(0, 200), libraryId, wordTitle: String(wordTitle || '').trim().slice(0, 60) };
    state.invites[token] = inv;
    save();
    return inv;
  }
  function currentInvite(circleId) {
    const list = Object.values(state.invites).filter(i => i.circleId === circleId && i.status === 'active' && new Date(i.expiresAt) > now());
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
  }
  function revokeInvite(token) { const i = state.invites[token]; if (i) i.status = 'revoked'; save(); }
  function revokeCircleInvites(circleId) { if (!isAdmin(circleId)) throw err('רק מנהלת יכולה לבטל קישורים'); Object.values(state.invites).filter(i => i.circleId === circleId).forEach(i => { i.status = 'revoked'; }); save(); }
  function inviteUrl(token) { return `${location.origin}${location.pathname}?invite=${token}`; }

  function previewInvite(token) {
    const inv = state.invites[(token || '').toUpperCase()];
    if (!inv) return { ok: false, reason: 'not_found' };
    if (inv.status !== 'active') return { ok: false, reason: 'revoked', inv };
    if (new Date(inv.expiresAt) < now()) return { ok: false, reason: 'expired', inv };
    if (inv.uses >= inv.maxUses) return { ok: false, reason: 'full', inv };
    const circle = state.circles[inv.circleId];
    if (!circle || circle.status !== 'active') return { ok: false, reason: 'not_found' };
    const inviter = state.users[inv.inviterId];
    // משתמשת חסומה לא נחשפת לפרטי הקבוצה
    if (isBlocked(inv.inviterId, state.me) || isBlocked(state.me, inv.inviterId)) return { ok: false, reason: 'not_found' };
    const members = circleMembers(circle.id);
    const sample = Object.values(state.wordDefs).find(d => d.circleId === circle.id && d.kind === 'group' && d.status !== 'cancelled');
    return { ok: true, inv, kind: inv.kind || 'follow', message: inv.message || '', libraryId: inv.libraryId || null, wordTitle: inv.wordTitle || '', challenge: inv.libraryId ? LIB.get(inv.libraryId) : null, circle: { id: circle.id, name: circle.name, description: circle.description, color: circle.color }, inviter, memberCount: members.length, maxMembers: circle.maxMembers, alreadyMember: isMember(circle.id), sampleWord: sample ? { title: sample.title } : null, round: circleRound(circle.id) };
  }

  function acceptInvite(token) {
    const p = previewInvite(token);
    if (!p.ok) throw err(inviteError(p.reason));
    if (p.alreadyMember) return state.circles[p.circle.id];
    if (p.memberCount >= p.maxMembers) throw err('הקבוצה מלאה. אפשר לבקש ממנהלת הקבוצה להגדיל את מספר המקומות.');
    state.memberships.push({ id: uid('m'), circleId: p.circle.id, userId: state.me, role: 'member', joinedAt: nowISO(), leftAt: null });
    p.inv.uses += 1;
    addEvent(p.circle.id, state.me, 'member_joined', {});
    grant(state.me, 'first_circle', p.circle.id);
    save();
    return state.circles[p.circle.id];
  }
  function inviteError(reason) {
    return { not_found: 'הקישור לא נמצא. אולי הוא הועתק לא נכון?', revoked: 'הקישור בוטל על ידי הקבוצה. אפשר לבקש קישור חדש.', expired: 'תוקף הקישור פג. אפשר לבקש הזמנה חדשה.', full: 'הקישור הזה כבר נוצל במלואו. אפשר לבקש קישור חדש.' }[reason] || 'לא ניתן להצטרף כרגע.';
  }

  function leaveCircle(circleId, { endWords = true } = {}) {
    const m = membership(circleId);
    if (!m) return;
    if (m.role === 'admin') {
      const others = activeMemberships(circleId).filter(x => x.userId !== state.me);
      if (others.length) { others[0].role = 'admin'; addEvent(circleId, others[0].userId, 'admin_transferred', {}); }
      else { state.circles[circleId].status = 'archived'; }
    }
    m.leftAt = nowISO();
    if (endWords) {
      // סיום מוקדם של מילים פעילות בקבוצה – ההיסטוריה נשמרת, אירועים עתידיים מבוטלים
      myCommitments().filter(c => (state.wordDefs[c.defId] || {}).circleId === circleId && c.status === 'active').forEach(c => endCommitment(c.id, 'left_circle'));
    }
    addEvent(circleId, state.me, 'member_left', {});
    save();
  }
  function removeMember(circleId, userId) {
    if (!isAdmin(circleId)) throw err('רק מנהלת הקבוצה יכולה להסיר חברות');
    const m = membership(circleId, userId);
    if (!m) return;
    m.leftAt = nowISO();
    m.removedBy = state.me;
    endCircleCommitments(circleId, userId, 'removed_from_circle');
    addEvent(circleId, state.me, 'member_removed', { userId });
    save();
  }
  /* עוצרת את האתגרים הפעילים בקבוצה (של משתמשת אחת, או של כולן) */
  function endCircleCommitments(circleId, userId, reason) {
    Object.values(state.commitments).filter(c => c.status === 'active' && (!userId || c.userId === userId) && (state.wordDefs[c.defId] || {}).circleId === circleId).forEach(c => {
      c.status = 'ended_early'; c.endReason = reason;
      obligationsOf(c.id).filter(o => !o.outcome && ['scheduled', 'open'].includes(o.status)).forEach(o => { o.status = 'cancelled'; });
    });
  }
  function setMemberRole(circleId, userId, role) {
    if (!isAdmin(circleId)) throw err('רק מנהלת יכולה לשנות הרשאות');
    const m = membership(circleId, userId); if (!m) throw err('החברה לא בקבוצה');
    role = role === 'admin' ? 'admin' : 'member';
    if (role === 'member' && m.role === 'admin' && activeMemberships(circleId).filter(x => x.role === 'admin').length <= 1) throw err('צריכה להישאר לפחות מנהלת אחת בקבוצה');
    if (m.role !== role) { m.role = role; if (role === 'admin') addEvent(circleId, userId, 'admin_transferred', {}); }
    save();
  }
  /* סגירת קבוצה: אתגרים נעצרים, הזמנות מבוטלות, כולן יוצאות, הקבוצה בארכיון. הנקודות נשארות. */
  function deleteCircle(circleId) {
    if (!isAdmin(circleId)) throw err('רק מנהלת יכולה לסגור את הקבוצה');
    endCircleCommitments(circleId, null, 'circle_deleted');
    Object.values(state.wordDefs).filter(d => d.circleId === circleId && d.status === 'proposed').forEach(d => { d.status = 'cancelled'; });
    Object.values(state.invites).filter(i => i.circleId === circleId).forEach(i => { i.status = 'revoked'; });
    activeMemberships(circleId).forEach(m => { m.leftAt = nowISO(); });
    state.circles[circleId].status = 'archived';
    save();
  }

  /* ---------- מילים ---------- */
  const WORD_ICONS = ['walk', 'run', 'dumbbell', 'book', 'noPhone', 'water', 'sleep', 'moon', 'noSugar', 'leaf', 'meditate', 'pencil', 'heart', 'smile', 'home', 'users', 'coffee', 'call', 'tools', 'star'];

  /* ספריית האתגרים הקבועה (library.js). TEMPLATES נשמר לתאימות: רשימה שטוחה עם שם קטגוריה. */
  const LIB = typeof MilaLibrary !== 'undefined' ? MilaLibrary : { VERSION: 0, CATEGORIES: [], CHALLENGES: [], get: () => null, category: () => null, isSensitive: () => false, inCategory: () => [] };
  const TEMPLATES = LIB.CHALLENGES.map(ch => ({ id: ch.id, cat: (LIB.category(ch.cat) || {}).name || ch.cat, catId: ch.cat, title: ch.title, rule: ch.rule, icon: ch.icon, sensitive: LIB.isSensitive(ch.id) }));

  function wordDef(id) { return state.wordDefs[id]; }
  function commitment(id) { return state.commitments[id]; }
  function myCommitments(userId = state.me) { return Object.values(state.commitments).filter(c => c.userId === userId); }
  function activeCommitments(userId = state.me, date = today()) {
    return myCommitments(userId).filter(c => c.status === 'active' && c.startDate <= date && c.endDate >= date);
  }
  function obligationsOf(commitmentId) {
    return Object.values(state.obligations).filter(o => o.commitmentId === commitmentId).sort((a, b) => a.localDate.localeCompare(b.localDate));
  }

  /* תקרה: ספירת אירועים מחייבים לכל תאריך */
  function bindingCountByDate(userId, dates) {
    const counts = {};
    for (const d of dates) counts[d] = 0;
    for (const o of Object.values(state.obligations)) {
      if (o.userId !== userId || o.status === 'cancelled') continue;
      if (o.localDate in counts) counts[o.localDate] += 1;
    }
    return counts;
  }
  function capCheck(userId, startDate, days = RULES.ROUND_DAYS) {
    const dates = dateRange(startDate, days);
    const counts = bindingCountByDate(userId, dates);
    const conflicts = dates.filter(d => counts[d] >= RULES.DAILY_CAP);
    const maxCount = Math.max(...dates.map(d => counts[d]));
    // התאריך הראשון שבו יש מקום לכל 14 הימים
    let nextFree = null;
    for (let i = 0; i < 60 && !nextFree; i++) {
      const s = addDays(startDate, i);
      const c = bindingCountByDate(userId, dateRange(s, days));
      if (Object.values(c).every(v => v < RULES.DAILY_CAP)) nextFree = s;
    }
    return { ok: conflicts.length === 0, conflicts, maxCount, nextFree, conflictingWords: conflicts.length ? activeWordsOn(userId, conflicts[0]) : [] };
  }
  function activeWordsOn(userId, date) {
    return Object.values(state.obligations)
      .filter(o => o.userId === userId && o.localDate === date && o.status !== 'cancelled')
      .map(o => ({ ...state.wordDefs[state.commitments[o.commitmentId].defId], commitmentId: o.commitmentId }));
  }

  function validateWordInput({ title, rule }) {
    if (!title || !title.trim()) throw err('צריך שם לאתגר');
    if (title.trim().length > 60) throw err('שם האתגר ארוך מדי (עד 60 תווים)');
    if (!rule || !rule.trim()) throw err('צריך לכתוב מה נחשב הצלחה, כדי שתדעי על מה לדווח');
    const banned = /(הרעב|לא לאכול כלום|צום של|להקיא|לפגוע|חיתוך|סמים|לשתות עד|להשמין|להרזות ב\s*\d+\s*ק)/;
    if (banned.test(title) || banned.test(rule)) throw err('הניסוח הזה עלול להיות מסוכן. נסי אתגר שמוסיף משהו טוב ליום, במקום להגביל בצורה קיצונית.');
  }

  /* גיל: התחום הרגיש פתוח מגיל 18. תאריך הלידה עצמו לא נשמר (רק ״פתוח״ או מתי ייפתח). */
  function isAdult() { const u = me(); return !!u && u.adult === true; }
  function setBirthDate(birthDate) {
    const u = me(); const t = today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate || '') || birthDate > t || birthDate < '1900-01-01') throw err('תאריך הלידה לא תקין');
    if (u.adult === true) return { adult: true, adultFrom: null };
    if (u.adultFrom) throw err('כבר רשום אצלנו מתי התחום נפתח לך. אם נפלה טעות, כתבי לנו.');
    const [y, m, d] = birthDate.split('-'); const turns18 = `${Number(y) + 18}-${m}-${d}`;
    const adult = turns18 <= t;
    u.adult = adult; u.adultFrom = adult ? null : turns18; save();
    return { adult, adultFrom: u.adultFrom };
  }
  /* יצירת מילה אישית (ואופציונלית – חשיפה לקבוצה אחד) */
  /* להביא לקבוצה אתגרים אישיים שכבר רצים (רק כאלה שעוד לא שייכים לקבוצה) */
  function shareToCircle(circleId, commitmentIds = []) {
    if (!isMember(circleId)) throw err('את לא חברה בקבוצה הזו');
    let shared = 0;
    for (const id of commitmentIds) {
      const k = state.commitments[id]; const d = k && state.wordDefs[k.defId];
      if (!k || k.userId !== state.me || k.status !== 'active' || !d || d.kind !== 'personal' || d.circleId) continue;
      d.circleId = circleId; d.visibility = 'status'; shared++;
      addEvent(circleId, state.me, 'word_committed', { defId: d.id, title: d.title });
    }
    save();
    return { shared };
  }
  function createPersonalWord({ title, rule, icon = 'leaf', startDate = today(), circleId = null, visibility = circleId ? 'status' : 'private', libraryId = null, reward = '', rewardShared = false, shareSensitive = false }) {
    let lib = null, category = null, sensitive = false;
    if (libraryId) {
      lib = LIB.get(libraryId);
      if (!lib) throw err('האתגר לא נמצא בספרייה');
      title = lib.title; rule = lib.rule; icon = lib.icon; category = lib.cat; sensitive = LIB.isSensitive(libraryId);
      if (sensitive && !isAdult()) throw Object.assign(err('התחום הזה מגיל 18.'), { code: 'ADULT_ONLY' });
      // אתגר רגיש: פרטי כברירת מחדל. שיתוף עם קבוצה רק בבחירה מפורשת.
      if (sensitive && !shareSensitive) circleId = null;
    }
    validateWordInput({ title, rule });
    if (circleId && !isMember(circleId)) throw err('את לא חברה בקבוצה הזו');
    reward = String(reward || '').trim().slice(0, 80);
    const cap = capCheck(state.me, startDate);
    if (!cap.ok) throw Object.assign(err('כבר יש לך 3 אתגרים בימים האלה'), { code: 'CAP', cap });
    const def = { id: uid('w'), kind: 'personal', circleId, ownerId: state.me, title: title.trim(), rule: rule.trim(), icon, visibility: circleId ? visibility : 'private', version: 1, startDate, status: 'active', createdAt: nowISO(), libraryId: libraryId || null, category, sensitive };
    state.wordDefs[def.id] = def;
    const c = createCommitment(def.id, state.me, startDate);
    c.reward = reward; c.rewardShared = !!(reward && rewardShared);
    if (circleId && visibility !== 'private') addEvent(circleId, state.me, 'word_committed', { defId: def.id, title: def.title });
    grant(state.me, 'first_word', def.id);
    delete state.drafts.word;
    save();
    return { def, commitment: c };
  }

  function createCommitment(defId, userId, startDate) {
    const c = { id: uid('k'), defId, userId, startDate, endDate: addDays(startDate, RULES.ROUND_DAYS - 1), status: 'active', createdAt: nowISO() };
    state.commitments[c.id] = c;
    for (const d of dateRange(startDate, RULES.ROUND_DAYS)) {
      const o = { id: uid('o'), commitmentId: c.id, userId, localDate: d, status: 'scheduled', outcome: null, resolvedAt: null, reportedAt: null };
      state.obligations[o.id] = o;
    }
    refreshStatuses();
    return c;
  }

  /* הצעת מילה קבוצתית */
  function proposeGroupWord(circleId, { title, rule, icon = 'leaf', startDate, visibility = 'status' }) {
    const circle = state.circles[circleId];
    if (!circle) throw err('קבוצה לא נמצאה');
    if (!isMember(circleId)) throw err('את לא חברה בקבוצה הזו');
    if (circle.whoCanPropose === 'admins' && !isAdmin(circleId)) throw err('בקבוצה הזו רק מנהלות פותחות אתגר משותף');
    validateWordInput({ title, rule });
    if (!startDate) startDate = today();
    const cap0 = capCheck(state.me, startDate);
    if (!cap0.ok) throw Object.assign(err('יש לך כבר 3 אתגרים, וזה המקסימום. כשאחד מהם נגמר אפשר לפתוח אתגר משותף.'), { code: 'CAP', cap: cap0 });
    const def = { id: uid('w'), kind: 'group', circleId, ownerId: state.me, title: title.trim(), rule: rule.trim(), icon, visibility, version: 1, startDate, endDate: addDays(startDate, RULES.ROUND_DAYS - 1), status: 'proposed', createdAt: nowISO() };
    state.wordDefs[def.id] = def;
    addEvent(circleId, state.me, 'group_word_proposed', { defId: def.id, title: def.title });
    // התראה לחברות
    for (const m of activeMemberships(circleId)) if (m.userId !== state.me) notify(m.userId, 'group_word', `באה איתי? · ${circle.name}`, `${me().name} פתחה אתגר משותף: ${def.title}`, { defId: def.id, circleId });
    adoptGroupWord(def.id, { silent: true });   // מי שפותחת כבר בפנים
    save();
    return def;
  }
  function adopters(defId) {
    return Object.values(state.commitments).filter(c => c.defId === defId && c.status !== 'cancelled').map(c => ({ ...state.users[c.userId], commitmentId: c.id, status: c.status }));
  }
  function myAdoption(defId, userId = state.me) { return Object.values(state.commitments).find(c => c.defId === defId && c.userId === userId && c.status !== 'cancelled') || null; }

  function adoptGroupWord(defId, { silent = false } = {}) {
    const def = state.wordDefs[defId];
    if (!def || def.kind !== 'group') throw err('האתגר לא נמצא');
    if (!isMember(def.circleId)) throw err('את לא חברה בקבוצה הזו');
    if (def.status === 'cancelled') throw err('ההצעה בוטלה');
    if (myAdoption(defId)) return myAdoption(defId);
    const start = def.startDate < today() ? today() : def.startDate; // הצטרפות מאוחרת מתחילה מהיום
    if (def.endDate && start > def.endDate) throw err('האתגר הזה כבר הסתיים. אפשר לפתוח אותו מחדש לסבב הבא.');
    const cap = capCheck(state.me, start);
    if (!cap.ok) throw Object.assign(err('כבר יש לך 3 אתגרים בימים האלה'), { code: 'CAP', cap });
    const c = createCommitment(def.id, state.me, start);
    // התחייבות של מילה קבוצתית מסתיימת עם המילה הקבוצתית
    if (def.endDate && c.endDate > def.endDate) { c.endDate = def.endDate; obligationsOf(c.id).filter(o => o.localDate > def.endDate).forEach(o => { o.status = 'cancelled'; }); }
    if (def.status === 'proposed') def.status = 'active';
    if (!silent) addEvent(def.circleId, state.me, 'group_word_adopted', { defId: def.id, title: def.title });
    grant(state.me, 'first_word', def.id);
    grant(state.me, 'first_group_word', def.id);
    save();
    return c;
  }
  function cancelProposal(defId) {
    const def = state.wordDefs[defId];
    if (def.ownerId !== state.me && !isAdmin(def.circleId)) throw err('אין הרשאה');
    if (adopters(defId).length) throw err('חברות כבר הצטרפו לאתגר, אז אי אפשר לבטל אותו. אפשר לעצור את האתגר שלך.');
    def.status = 'cancelled';
    save();
  }

  function endCommitment(commitmentId, reason = 'ended_by_user') {
    const c = state.commitments[commitmentId];
    if (!c || c.userId !== state.me) throw err('אין הרשאה');
    c.status = 'ended_early';
    c.endedAt = nowISO();
    c.endReason = reason;
    // אירועים שטרם נפתחו מבוטלים; אירועים שהוכרעו נשארים
    for (const o of obligationsOf(commitmentId)) if (o.status === 'scheduled' || o.status === 'open') o.status = 'cancelled';
    save();
  }
  /* ---------- אירועים יומיים ודיווח ---------- */
  function windowOf(o) {
    const opens = parseDate(o.localDate);                           // 00:00 ביום
    const closes = parseDate(addDays(o.localDate, 1)); closes.setHours(RULES.GRACE_HOUR, 0, 0, 0); // 10:00 למחרת
    return { opens, closes };
  }
  function isOpenNow(o, at = now()) { const w = windowOf(o); return at >= w.opens && at < w.closes; }

  /* רענון סטטוסים: scheduled -> open -> (אוטומטי) confirmed_miss אחרי חלון */
  function refreshStatuses(at = now()) {
    if (state.meta && state.meta.seeding) return; // בזמן זריעת דמו אין הכרעות אוטומטיות
    if (state.meta && state.meta.cloud) {
      // במצב ענן ההכרעות האוטומטיות נעשות בשרת (fn_settle). כאן רק פותחים ימים שהגיעו.
      for (const o of Object.values(state.obligations)) if (o.status === 'scheduled' && !o.outcome && at >= windowOf(o).opens) o.status = 'open';
      return;
    }
    let changed = false;
    for (const o of Object.values(state.obligations)) {
      if (o.status === 'cancelled' || o.outcome) continue;
      const c = state.commitments[o.commitmentId];
      if (!c || c.status !== 'active') { continue; }
      const w = windowOf(o);
      if (at >= w.closes) {
        // יום שלא דווח ועבר חלון ההשלמה – נזקף כפספוס. ניתן לתקן בחלון התיקונים.
        resolve(o, 'miss', { reason: 'auto_unreported', actorId: 'system', at: w.closes.toISOString() });
        changed = true;
      } else if (at >= w.opens && o.status === 'scheduled') { o.status = 'open'; changed = true; }
    }
    // סיום התחייבויות שהסתיימו
    for (const c of Object.values(state.commitments)) {
      if (c.status === 'active' && c.endDate < today() && obligationsOf(c.id).every(o => o.outcome || o.status === 'cancelled')) {
        c.status = 'completed'; c.completedAt = nowISO(); changed = true;
        grant(c.userId, 'round_complete', c.id);
        const prev = myCommitments(c.userId).filter(x => x.status === 'completed').length;
        if (prev >= 2) grant(c.userId, 'second_round', c.id);
      }
    }
    if (changed) save();
  }

  function excusesUsed(commitmentId) { return obligationsOf(commitmentId).filter(o => o.outcome === 'excused').length; }

  function report(obligationId, outcome, { note = '' } = {}) {
    const o = state.obligations[obligationId];
    if (!o) throw err('היום הזה לא נמצא');
    if (o.userId !== state.me) throw err('רק מי שלקחה את האתגר יכולה לדווח עליו');
    if (o.status === 'cancelled') throw err('היום הזה בוטל');
    if (o.outcome) return { obligation: o, duplicate: true };   // idempotent
    const at = now();
    const w = windowOf(o);
    if (at < w.opens) throw err('עוד אי אפשר לדווח על יום שלא התחיל');
    if (at >= w.closes) throw err('עבר הזמן לדווח על היום הזה (אפשר עד 10:00 למחרת).');
    if (outcome === 'excused') {
      if (excusesUsed(o.commitmentId) >= RULES.MAX_EXCUSES_PER_ROUND) throw err(`כבר השתמשת ב-${RULES.MAX_EXCUSES_PER_ROUND} ימים חריגים בסבב הזה`);
    }
    const def = state.wordDefs[state.commitments[o.commitmentId].defId];
    const before = def.circleId ? leaderboard(def.circleId).rows : null;
    resolve(o, outcome, { reason: 'self_report', actorId: state.me, note });
    if (before && outcome === 'success') overtakes(def.circleId, before, leaderboard(def.circleId).rows, def);
    save();
    return { obligation: o, duplicate: false };
  }
  /* ״המהפך״: מי שהייתה מעליי בדירוג לפני הדיווח ונמצאת מתחתיי אחריו */
  function overtakes(circleId, before, after, def) {
    const pos = (rows, id) => { const i = rows.findIndex(r => r.user.id === id && r.ranked); return i < 0 ? null : i; };
    const myBefore = pos(before, state.me), myAfter = pos(after, state.me);
    if (myAfter === null) return [];
    const passed = after.filter((r, i) => r.user.id !== state.me && r.ranked && i > myAfter && (myBefore === null ? pos(before, r.user.id) !== null : pos(before, r.user.id) < myBefore));
    for (const r of passed) {
      addEvent(circleId, state.me, 'overtake', { passedUserId: r.user.id, title: def.title });
      notify(state.me, 'overtake', `עקפת את ${r.user.name}.`, 'עכשיו נראה אם היא תיתן לך להישאר שם.', { circleId });
      notify(r.user.id, 'overtake', `${me().name} עקפה אותך.`, 'עוד הצלחה אחת ואת חוזרת.', { circleId });
    }
    return passed;
  }
  /* משפט המצב שלי בתחרות (לכותרת הקבוצה ולמסך היום) */
  function rankInsight(circleId, userId = state.me) {
    const { rows } = leaderboard(circleId);
    const ranked = rows.filter(r => r.ranked);
    const mine = rows.find(r => r.user.id === userId);
    if (!mine) return null;
    const pct = (x) => Math.round(x * 100);
    if (!mine.ranked) { const left = Math.max(RULES.MIN_RANKED_EVENTS - mine.resolved, 1); return { place: null, total: ranked.length, text: mine.hidden ? 'את מחוץ לדירוג.' : `עוד ${left === 1 ? 'דיווח אחד' : `${left} דיווחים`} ואת בדירוג.` }; }
    const i = ranked.findIndex(r => r.user.id === userId);
    const above = i > 0 ? ranked[i - 1] : null;
    const below = i < ranked.length - 1 ? ranked[i + 1] : null;
    if (!above) {
      if (!below) return { place: mine.place, total: ranked.length, text: 'את מובילה. בינתיים לבד.' };
      const gap = pct(mine.rate) - pct(below.rate);
      return { place: mine.place, total: ranked.length, text: gap > 0 ? `את מובילה. ${below.user.name} אחרייך.` : `את מובילה, ו${below.user.name} צמודה אלייך.` };
    }
    const gap = pct(above.rate) - pct(mine.rate);
    const next = (mine.success + 1) / (mine.resolved + 1);
    const text = gap <= 0 ? `את צמודה ל${above.user.name}. עוד הצלחה אחת ואת עוקפת.` : next >= above.rate ? `${above.user.name} לפנייך. עוד הצלחה אחת ואת עוקפת אותה.` : `${above.user.name} לפנייך. כל הצלחה מקרבת אותך.`;
    return { place: mine.place, total: ranked.length, above: above.user, gap, text };
  }

  /* הכרעה: יוצרת תנועה אחת בלבד לכל אירוע */
  function resolve(o, outcome, { reason, actorId, note = '', at = nowISO() }) {
    const from = o.status;
    const c = state.commitments[o.commitmentId];
    const def = state.wordDefs[c.defId];
    o.outcome = outcome;
    o.status = outcome === 'success' ? 'confirmed_success' : outcome === 'miss' ? 'confirmed_miss' : 'excused';
    o.resolvedAt = at;
    o.reportedAt = at;
    o.resolveReason = reason;
    if (note) o.note = note;
    state.resolutionHistory.push({ id: uid('h'), obligationId: o.id, from, to: o.status, reason, actorId, at });
    postLedger(o, outcome, def);
    if (outcome === 'success') {
      grant(o.userId, 'first_day', o.id);
      const s = streak(o.commitmentId).current;
      if (s >= 7) grant(o.userId, 'streak_7', c.id);
      if (s >= 14) grant(o.userId, 'streak_14', c.id);
      if (def.circleId && def.visibility !== 'private' && (s === 3 || s === 7 || s === 14)) addEvent(def.circleId, o.userId, 'streak', { title: def.title, streak: s });
    }
    if (def.circleId && def.visibility !== 'private' && reason === 'self_report') {
      addEvent(def.circleId, o.userId, outcome === 'success' ? 'day_success' : outcome === 'miss' ? 'day_miss' : 'day_excused', { title: def.title, defId: def.id, date: o.localDate });
    }
  }

  function postLedger(o, outcome, def) {
    if (outcome === 'excused') return; // אין מטבע
    const type = outcome === 'success' ? 'EARN' : def.circleId ? 'MISS_TO_CIRCLE' : 'MISS_PERSONAL';
    state.ledger.push({ id: uid('t'), obligationId: o.id, userId: o.userId, type, circleId: def.circleId || null, defId: def.id, amount: 1, reversalOf: null, createdAt: o.resolvedAt || nowISO(), localDate: o.localDate });
  }

  function canCorrect(o, at = now()) {
    if (!o.outcome) return false;
    if (o.userId !== state.me) return false;
    // 24 שעות מההכרעה הראשונה (לא מהתיקון האחרון), כמו בשרת
    const firstAt = (state.resolutionHistory || []).filter(h => h.obligationId === o.id).map(h => h.at).sort()[0] || o.resolvedAt;
    return (at - new Date(firstAt)) < RULES.CORRECTION_HOURS * 3600000;
  }
  function correct(obligationId, newOutcome, reason) {
    const o = state.obligations[obligationId];
    if (!o) throw err('היום הזה לא נמצא');
    if (!canCorrect(o)) throw err('חלון התיקון (24 שעות) נסגר');
    if (!reason || !reason.trim()) throw err('צריך סיבה קצרה לתיקון');
    if (o.outcome === newOutcome) return o;
    const c = state.commitments[o.commitmentId];
    const def = state.wordDefs[c.defId];
    if (newOutcome === 'excused' && excusesUsed(c.id) >= RULES.MAX_EXCUSES_PER_ROUND) throw err(`כבר השתמשת ב-${RULES.MAX_EXCUSES_PER_ROUND} ימים חריגים בסבב הזה`);
    // היפוך התנועה המקורית
    const original = activeLedger().find(t => t.obligationId === o.id);
    if (original) state.ledger.push({ id: uid('t'), obligationId: o.id, userId: o.userId, type: 'REVERSE', circleId: original.circleId, defId: def.id, amount: -1, reversalOf: original.id, createdAt: nowISO(), localDate: o.localDate, reason });
    const from = o.status;
    o.outcome = newOutcome;
    o.status = newOutcome === 'success' ? 'confirmed_success' : newOutcome === 'miss' ? 'confirmed_miss' : 'excused';
    o.correctedAt = nowISO();
    o.resolvedAt = nowISO(); // חלון תיקון חדש של 24 שעות
    o.correctionReason = reason;
    state.resolutionHistory.push({ id: uid('h'), obligationId: o.id, from, to: 'corrected:' + o.status, reason, actorId: state.me, at: nowISO() });
    postLedger(o, newOutcome, def);
    save();
    return o;
  }

  /* ---------- בנק ויתרות ---------- */
  function activeLedger() {
    const reversed = new Set(state.ledger.filter(t => t.type === 'REVERSE').map(t => t.reversalOf));
    return state.ledger.filter(t => t.type !== 'REVERSE' && !reversed.has(t.id));
  }
  function bankSummary(userId = state.me) {
    const mine = activeLedger().filter(t => t.userId === userId);
    const earnedTotal = mine.filter(t => t.type === 'EARN').length;
    const missedTotal = mine.filter(t => t.type !== 'EARN').length;
    const active = activeCommitments(userId);
    const activeIds = new Set(active.map(c => c.id));
    const roundObs = Object.values(state.obligations).filter(o => activeIds.has(o.commitmentId));
    const earnedCurrentRound = roundObs.filter(o => o.outcome === 'success').length;
    const missedCurrentRound = roundObs.filter(o => o.outcome === 'miss').length;
    const excusedCurrentRound = roundObs.filter(o => o.outcome === 'excused').length;
    const pendingToday = roundObs.filter(o => o.localDate === today() && !o.outcome && o.status !== 'cancelled').length;
    const potential = roundObs.filter(o => o.status !== 'cancelled').length;
    const byCircle = {};
    for (const t of mine) { const k = t.circleId || 'personal'; byCircle[k] = byCircle[k] || { earned: 0, missed: 0 }; byCircle[k][t.type === 'EARN' ? 'earned' : 'missed'] += 1; }
    const transactions = state.ledger.filter(t => t.userId === userId).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(t => {
      const def = state.wordDefs[t.defId] || {};
      return { ...t, title: def.title, icon: def.icon, circleName: t.circleId ? (state.circles[t.circleId] || {}).name : null, reversed: !activeLedger().includes(t) && t.type !== 'REVERSE' };
    });
    return { earnedTotal, missedTotal, earnedCurrentRound, missedCurrentRound, excusedCurrentRound, pendingToday, potential, byCircle, transactions, pendingSlots: potential - earnedCurrentRound - missedCurrentRound - excusedCurrentRound };
  }
  function circlePool(circleId, round = circleRound(circleId)) {
    return activeLedger().filter(t => t.circleId === circleId && t.type === 'MISS_TO_CIRCLE' && t.localDate >= round.start && t.localDate <= round.end).length;
  }
  function circlePoolAllTime(circleId) { return activeLedger().filter(t => t.circleId === circleId && t.type === 'MISS_TO_CIRCLE').length; }

  /* ---------- רצף, סטטיסטיקה ---------- */
  function streak(commitmentId) {
    const obs = obligationsOf(commitmentId).filter(o => o.status !== 'cancelled' && o.localDate <= today());
    let current = 0, best = 0, run = 0;
    for (const o of obs) {
      if (o.outcome === 'success') { run += 1; best = Math.max(best, run); }
      else if (o.outcome === 'miss') { run = 0; }
      // excused / לא הוכרע עדיין – לא שובר ולא מוסיף
    }
    // רצף נוכחי: מהסוף אחורה
    for (let i = obs.length - 1; i >= 0; i--) {
      const o = obs[i];
      if (o.outcome === 'success') current += 1;
      else if (o.outcome === 'miss') break;
    }
    return { current, best };
  }
  function commitmentStats(commitmentId) {
    const obs = obligationsOf(commitmentId).filter(o => o.status !== 'cancelled');
    const success = obs.filter(o => o.outcome === 'success').length;
    const miss = obs.filter(o => o.outcome === 'miss').length;
    const excused = obs.filter(o => o.outcome === 'excused').length;
    const resolved = success + miss;
    const c = state.commitments[commitmentId];
    const dayIndex = Math.min(Math.max(diffDays(c.startDate, today()) + 1, 0), RULES.ROUND_DAYS);
    return { success, miss, excused, resolved, rate: resolved ? success / resolved : null, total: obs.length, dayIndex, remaining: obs.filter(o => !o.outcome).length, ...streak(commitmentId) };
  }

  /* ---------- היום שלי ---------- */
  function todayCards(userId = state.me, date = today()) {
    refreshStatuses();
    const items = Object.values(state.obligations)
      .filter(o => o.userId === userId && o.localDate === date && o.status !== 'cancelled')
      .map(o => decorate(o));
    // גם אירועים של אתמול שעדיין פתוחים (חלון השלמה)
    const y = addDays(date, -1);
    const late = Object.values(state.obligations).filter(o => o.userId === userId && o.localDate === y && !o.outcome && o.status === 'open' && isOpenNow(o)).map(o => ({ ...decorate(o), late: true }));
    return [...late, ...items];
  }
  function decorate(o) {
    const c = state.commitments[o.commitmentId];
    const def = state.wordDefs[c.defId];
    const circle = def.circleId ? state.circles[def.circleId] : null;
    return { ...o, commitment: c, def, circle, stats: commitmentStats(c.id), open: isOpenNow(o), canCorrect: canCorrect(o) };
  }
  function upcomingWords(userId = state.me) {
    return myCommitments(userId).filter(c => c.status === 'active' && c.startDate > today()).map(c => ({ ...c, def: state.wordDefs[c.defId] }));
  }
  function wordHistory(userId = state.me) {
    return myCommitments(userId).filter(c => c.status === 'completed' || c.status === 'ended_early').map(c => ({ ...c, def: state.wordDefs[c.defId], stats: commitmentStats(c.id) })).sort((a, b) => b.endDate.localeCompare(a.endDate));
  }

  /* ---------- דירוג ---------- */
  function leaderboard(circleId, round = circleRound(circleId)) {
    const members = circleMembers(circleId);
    const rows = members.map(u => {
      const cs = myCommitments(u.id).filter(c => (state.wordDefs[c.defId] || {}).circleId === circleId && c.status !== 'cancelled');
      const obs = cs.flatMap(c => obligationsOf(c.id)).filter(o => o.status !== 'cancelled' && o.localDate >= round.start && o.localDate <= round.end);
      const success = obs.filter(o => o.outcome === 'success').length;
      const miss = obs.filter(o => o.outcome === 'miss').length;
      const resolved = success + miss;
      const bestStreak = Math.max(0, ...cs.map(c => streak(c.id).current));
      const hidden = !!(u.settings && u.settings.hideFromLeaderboard);
      return { user: u, success, miss, resolved, rate: resolved ? success / resolved : null, streak: bestStreak, words: cs.length, ranked: resolved >= RULES.MIN_RANKED_EVENTS && !hidden, hidden };
    });
    rows.sort((a, b) => {
      if (a.ranked !== b.ranked) return a.ranked ? -1 : 1;
      if ((b.rate || 0) !== (a.rate || 0)) return (b.rate || 0) - (a.rate || 0);
      if (b.success !== a.success) return b.success - a.success;
      return b.streak - a.streak;
    });
    // מקום משותף בשוויון מלא
    let place = 0, prevKey = null;
    rows.forEach((r, i) => {
      if (!r.ranked) { r.place = null; return; }
      const key = `${r.rate}|${r.success}|${r.streak}`;
      if (key !== prevKey) { place = i + 1; prevKey = key; }
      r.place = place;
    });
    return { round, rows };
  }

  /* המנצחת של הסבב הקודם (מוצג בתחילת סבב חדש) */
  function previousRoundWinner(circleId) {
    const round = circleRound(circleId);
    if (round.index < 2) return null;
    const prev = circleRound(circleId, addDays(round.start, -1));
    const top = leaderboard(circleId, prev).rows.find(r => r.ranked && r.place === 1);
    return top ? { ...top, round: prev } : null;
  }

  /* ---------- פיד חברתי ---------- */
  function addEvent(circleId, actorId, type, payload) {
    state.socialEvents.push({ id: uid('e'), circleId, actorId, type, payload, createdAt: nowISO() });
  }
  function feed(circleId, limit = 40) {
    const blocked = new Set(state.blocks.filter(b => b.blockerId === state.me).map(b => b.blockedId));
    return state.socialEvents.filter(e => e.circleId === circleId && !blocked.has(e.actorId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
      .map(e => ({ ...e, actor: state.users[e.actorId] || { name: 'משתתפת' }, reactions: state.encouragements.filter(x => x.eventId === e.id) }));
  }
  function myFeedDigest(limit = 3) {
    const ids = new Set(myCircles().map(c => c.id));
    const blocked = new Set(state.blocks.filter(b => b.blockerId === state.me).map(b => b.blockedId));
    return state.socialEvents.filter(e => ids.has(e.circleId) && e.actorId !== state.me && !blocked.has(e.actorId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
      .map(e => ({ ...e, actor: state.users[e.actorId], circle: state.circles[e.circleId] }));
  }
  const REACTIONS = ['clap', 'heart', 'muscle', 'fire', 'star'];
  function encourage(eventId, reaction) {
    if (!REACTIONS.includes(reaction)) throw err('תגובה לא נתמכת');
    const existing = state.encouragements.find(x => x.eventId === eventId && x.userId === state.me);
    if (existing) { if (existing.reaction === reaction) { state.encouragements = state.encouragements.filter(x => x !== existing); } else existing.reaction = reaction; }
    else state.encouragements.push({ id: uid('r'), eventId, userId: state.me, reaction, createdAt: nowISO() });
    grant(state.me, 'first_encouragement', eventId);
    save();
  }
  function sendEncouragement(circleId, toUserId, reaction) {
    addEvent(circleId, state.me, 'encouragement', { toUserId, reaction });
    grant(state.me, 'first_encouragement', circleId);
    notify(toUserId, 'encouragement', `${me().name} שלחה לך מילה טובה`, '', { circleId });
    save();
  }

  /* ---------- הישגים ---------- */
  const ACHIEVEMENTS = {
    first_word: { title: 'נתתי מילה', desc: 'האתגר הראשון שלך', icon: 'pencil' },
    first_day: { title: 'חתום וסגור', desc: 'הנקודה הראשונה שלך', icon: 'check' },
    streak_7: { title: 'מילה אחר מילה', desc: 'שבע הצלחות ברצף באותו אתגר', icon: 'flame' },
    streak_14: { title: 'מילה בסלע', desc: '14 הצלחות ברצף. סבב מושלם', icon: 'trophy' },
    first_circle: { title: 'קבוצה ראשונה', desc: 'הצטרפת לקבוצה', icon: 'users' },
    first_group_word: { title: 'יש לך מילה', desc: 'הצטרפת לאתגר משותף', icon: 'link' },
    first_encouragement: { title: 'מילה טובה', desc: 'עודדת חברה', icon: 'clap' },
    round_complete: { title: 'אמרת ועשית', desc: 'סיימת סבב שלם', icon: 'medal' },
    second_round: { title: 'עוד סיבוב?', desc: 'חזרת לסבב שני', icon: 'repeat' },
  };
  function grant(userId, type, sourceRef) {
    if (!ACHIEVEMENTS[type]) return;
    if (state.achievements.some(a => a.userId === userId && a.type === type)) return;
    state.achievements.push({ id: uid('a'), userId, type, earnedAt: nowISO(), sourceRef });
    if (userId === state.me) notify(userId, 'achievement', `הישג חדש: ${ACHIEVEMENTS[type].title}`, ACHIEVEMENTS[type].desc, { type });
  }
  function achievementsFor(userId = state.me) {
    return Object.entries(ACHIEVEMENTS).map(([type, meta]) => ({ type, ...meta, earned: state.achievements.find(a => a.userId === userId && a.type === type) || null }));
  }

  /* ---------- התראות ---------- */
  function notify(userId, type, title, body, ref) {
    if (userId !== state.me) return; // בדמו שומרים התראות רק למשתמשת
    const key = `${type}|${title}|${today()}`;
    if (state.notifications.some(n => n.dedupeKey === key)) return;
    state.notifications.push({ id: uid('n'), userId, type, title, body, ref, createdAt: nowISO(), read: false, dedupeKey: key });
  }
  function notifications() { return state.notifications.filter(n => n.userId === state.me).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  function unreadCount() { return notifications().filter(n => !n.read).length; }
  function markAllRead() { notifications().forEach(n => n.read = true); save(); }

  /* ---------- בטיחות ---------- */
  function isBlocked(blockerId, blockedId) { return state.blocks.some(b => b.blockerId === blockerId && b.blockedId === blockedId); }
  function block(userId) { if (!isBlocked(state.me, userId)) state.blocks.push({ blockerId: state.me, blockedId: userId, at: nowISO() }); save(); }
  function unblock(userId) { state.blocks = state.blocks.filter(b => !(b.blockerId === state.me && b.blockedId === userId)); save(); }
  function blockedUsers() { return state.blocks.filter(b => b.blockerId === state.me).map(b => state.users[b.blockedId]).filter(Boolean); }
  function reportAbuse({ entityType, entityId, reason, details = '' }) {
    state.abuseReports.push({ id: uid('ab'), reporterId: state.me, entityType, entityId, reason, details, status: 'open', createdAt: nowISO() });
    save();
  }

  /* ---------- סיכום סבב ---------- */
  function roundSummary(commitmentId) {
    const c = state.commitments[commitmentId];
    const def = state.wordDefs[c.defId];
    const obs = obligationsOf(commitmentId);
    const st = commitmentStats(commitmentId);
    return { commitment: c, def, obligations: obs, stats: st, circle: def.circleId ? state.circles[def.circleId] : null, earned: activeLedger().filter(t => t.userId === c.userId && t.type === 'EARN' && obs.some(o => o.id === t.obligationId)).length };
  }
  function pendingSummaries(userId = state.me) {
    return myCommitments(userId).filter(c => c.status === 'completed' && !c.summarySeen);
  }
  function markSummarySeen(commitmentId) { const c = state.commitments[commitmentId]; if (c) c.summarySeen = true; save(); }

  /* ---------- חשבון ---------- */
  function exportData() {
    const u = me();
    return JSON.stringify({ user: u, commitments: myCommitments(), obligations: Object.values(state.obligations).filter(o => o.userId === state.me), ledger: state.ledger.filter(t => t.userId === state.me), achievements: state.achievements.filter(a => a.userId === state.me) }, null, 2);
  }
  function deleteAccount() {
    // מחיקה: פרטי המשתמשת נמחקים; תנועות היסטוריות של קבוצות הופכות לאנונימיות לצורכי תקינות
    const id = state.me;
    for (const m of state.memberships) if (m.userId === id && !m.leftAt) m.leftAt = nowISO();
    state.users[id] = { id, name: 'משתתפת שעזבה', color: 'sky', deleted: true, settings: {} };
    state.me = null;
    save();
    localStorage.removeItem(STORAGE_KEY);
    state = emptyState();
    save();
  }

  function err(msg) { const e = new Error(msg); e.userMessage = msg; return e; }

  return {
    RULES, TEMPLATES, LIBRARY: LIB, WORD_ICONS, ACHIEVEMENTS, REACTIONS, AVATAR_COLORS,
    load, save, reset, emptyState, getState, setState, uid, nowISO, now, setClock,
    today, addDays, diffDays, dateRange, fmtDate, fmtDateLong, relDay, fmtTime, toLocalDate, hashStr,
    createUser, me, user, updateSettings, renameMe,
    createCircle, updateCircle, myCircles, membership, isMember, isAdmin, circleMembers, circleRound, leaveCircle, removeMember, setMemberRole, deleteCircle,
    createInvite, currentInvite, revokeInvite, revokeCircleInvites, inviteUrl, previewInvite, acceptInvite,
    wordDef, commitment, myCommitments, activeCommitments, obligationsOf, capCheck, activeWordsOn,
    isAdult, setBirthDate, createPersonalWord, shareToCircle, createCommitment, proposeGroupWord, adoptGroupWord, adopters, myAdoption, cancelProposal, endCommitment,
    windowOf, isOpenNow, refreshStatuses, excusesUsed, report, canCorrect, correct,
    activeLedger, bankSummary, circlePool, circlePoolAllTime, streak, commitmentStats,
    todayCards, decorate, upcomingWords, wordHistory, leaderboard, rankInsight, previousRoundWinner,
    addEvent, feed, myFeedDigest, encourage, sendEncouragement,
    grant, achievementsFor, notify, notifications, unreadCount, markAllRead,
    isBlocked, block, unblock, blockedUsers, reportAbuse,
    roundSummary, pendingSummaries, markSummarySeen, exportData, deleteAccount,
  };
})();
