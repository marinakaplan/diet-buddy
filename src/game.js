/* מנוע המשחק בצד השרת. כל פעולה: אימות בעלות/חברות → בדיקת חוקים → batch אטומי ב-D1.
   עקרונות: שקל נוצר רק בהכרעה; יומן append-only; תיקון = REVERSE + תנועה חדשה; דיווח כפול = idempotent;
   תקרת 3 ביום נבדקת כאן ונאכפת שוב בטריגר בתוך אותו batch. */
import '../public/js/library.js';   // קובע globalThis.MilaLibrary (UMD; הקובץ משותף עם הדפדפן)
const MilaLibrary = globalThis.MilaLibrary;
import { err, uid, nowISO, localDate, addDays, diffDays, isValidDate, windowOf, ROUND_DAYS, DAILY_CAP, MAX_EXCUSES, CORRECTION_MS, GRACE_HOUR, sha256hex, inviteCode, cleanName } from './util.js';

const ACH = {
  first_word: ['נתתי מילה', 'בחרת את האתגר הראשון שלך'],
  first_day: ['חתום וסגור', 'הנקודה הראשונה שלך'],
  streak_7: ['מילה אחר מילה', 'שבע הצלחות ברצף באותו אתגר'],
  streak_14: ['מילה בסלע', '14 הצלחות ברצף. סבב מושלם'],
  first_circle: ['קבוצה ראשונה', 'הצטרפת לקבוצה'],
  first_group_word: ['יש לך מילה', 'הצטרפת לאתגר משותף'],
  first_encouragement: ['מילה טובה', 'עודדת חברה'],
  round_complete: ['אמרת ועשית', 'סיימת סבב שלם'],
  second_round: ['עוד סיבוב?', 'חזרת לסבב שני'],
};

const S = (env, sql, ...binds) => env.DB.prepare(sql).bind(...binds);
const first = (env, sql, ...binds) => S(env, sql, ...binds).first();
const all = async (env, sql, ...binds) => (await S(env, sql, ...binds).all()).results || [];

/* ---------- עזרי חברות ---------- */
export async function isMember(env, circleId, userId) { return !!(await first(env, `select 1 as x from circle_memberships where circle_id = ? and user_id = ? and left_at is null`, circleId, userId)); }
export async function isAdmin(env, circleId, userId) { return !!(await first(env, `select 1 as x from circle_memberships where circle_id = ? and user_id = ? and left_at is null and role = 'admin'`, circleId, userId)); }
async function isBlocked(env, blocker, blocked) { return !!(await first(env, `select 1 as x from user_blocks where blocker_id = ? and blocked_id = ?`, blocker, blocked)); }
export async function myCircleIds(env, userId) { return (await all(env, `select circle_id from circle_memberships where user_id = ? and left_at is null`, userId)).map(r => r.circle_id); }

/* ---------- הישגים, התראות, אירועים (כ-statements) ---------- */
function grantStmts(env, userId, type, src, tz) {
  const [title, body] = ACH[type];
  const id = uid();
  return [
    S(env, `insert or ignore into achievements(id, user_id, type, source_ref) values (?,?,?,?)`, id, userId, type, String(src)),
    // התראה רק אם ההישג חדש (הכנסה הצליחה) – נבדק לפי קיום ה-id שזה עתה ניסינו להכניס
    S(env, `insert or ignore into notifications(id, user_id, type, title, body, ref, dedupe_key) select ?, ?, 'achievement', ?, ?, ?, ? where exists (select 1 from achievements where id = ?)`,
      uid(), userId, 'הישג חדש: ' + title, body, JSON.stringify({ type }), `achievement|${type}`, id),
  ];
}
/* כל עדכון שנוצר נרשם גם לשליחת התראה לטלפון אחרי שהפעולה הצליחה (index.js → push.social) */
const notifyStmt = (env, userId, type, title, body, ref, day) => ((env.__notified || (env.__notified = new Set())).add(userId), S(env, `insert or ignore into notifications(id, user_id, type, title, body, ref, dedupe_key) values (?,?,?,?,?,?,?)`, uid(), userId, type, title, body || '', JSON.stringify(ref || {}), `${type}|${title}|${day}`));
const eventStmt = (env, circleId, actorId, type, payload) => S(env, `insert into social_events(id, circle_id, actor_id, type, payload) values (?,?,?,?,?)`, uid(), circleId, actorId, type, JSON.stringify(payload || {}));

/* ---------- ולידציה ---------- */
function validateWord(title, rule) {
  title = String(title || '').trim(); rule = String(rule || '').trim();
  if (!title) throw err('VALIDATION', 'צריך שם לאתגר');
  if (title.length > 60) throw err('VALIDATION', 'שם האתגר ארוך מדי (עד 60 תווים)');
  if (!rule) throw err('VALIDATION', 'צריך לכתוב מה נחשב הצלחה, כדי שתדעי על מה לדווח');
  if (rule.length > 200) throw err('VALIDATION', 'הכלל ארוך מדי (עד 200 תווים)');
  if (/(הרעב|לא לאכול כלום|צום של|להקיא|לפגוע|חיתוך|סמים|לשתות עד|להשמין)/.test(title + ' ' + rule)) throw err('VALIDATION', 'הניסוח הזה עלול להיות מסוכן. נסי אתגר שמוסיף משהו טוב ליום.');
  return { title, rule };
}
const ICONS = new Set(['walk', 'run', 'dumbbell', 'book', 'noPhone', 'water', 'sleep', 'moon', 'noSugar', 'leaf', 'meditate', 'pencil', 'heart', 'smile', 'home', 'users', 'coffee', 'call', 'tools', 'star']);
const icon = (i) => (ICONS.has(i) ? i : 'leaf');
const COLORS = new Set(['lime', 'pink', 'lavender', 'mint', 'peach', 'sky']);

/* ---------- תקרה ---------- */
export async function capInfo(env, userId, start, days = ROUND_DAYS) {
  const end = addDays(start, days - 1);
  const horizon = addDays(start, 60 + days);
  const rows = await all(env, `select local_date, count(*) as n from daily_obligations where user_id = ? and status <> 'cancelled' and local_date between ? and ? group by local_date`, userId, start, horizon);
  const count = Object.fromEntries(rows.map(r => [r.local_date, r.n]));
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const conflicts = dates.filter(d => (count[d] || 0) >= DAILY_CAP);
  const maxCount = Math.max(0, ...dates.map(d => count[d] || 0));
  let nextFree = null;
  for (let i = 0; i < 60 && !nextFree; i++) { const s = addDays(start, i); if (Array.from({ length: days }, (_, k) => addDays(s, k)).every(d => (count[d] || 0) < DAILY_CAP)) nextFree = s; }
  let conflictingWords = [];
  if (conflicts.length) conflictingWords = await all(env, `select d.title from daily_obligations o join word_commitments k on k.id = o.commitment_id join word_definitions d on d.id = k.definition_id where o.user_id = ? and o.local_date = ? and o.status <> 'cancelled'`, userId, conflicts[0]);
  return { ok: conflicts.length === 0, conflicts, maxCount, nextFree, conflictingWords, end };
}

function commitmentStmts(env, defId, user, start, end) {
  const kid = uid(); const today = localDate(user.timezone);
  const stmts = [S(env, `insert into word_commitments(id, definition_id, user_id, start_date, end_date, timezone) values (?,?,?,?,?,?)`, kid, defId, user.id, start, end, user.timezone)];
  for (let d = start; d <= end; d = addDays(d, 1)) stmts.push(S(env, `insert into daily_obligations(id, commitment_id, user_id, local_date, status) values (?,?,?,?,?)`, uid(), kid, user.id, d, d <= today ? 'open' : 'scheduled'));
  return { kid, stmts };
}
async function runBatch(env, stmts) {
  try { return await env.DB.batch(stmts); }
  catch (e) {
    const m = String(e && e.message || e);
    if (m.includes('DAILY_CAP_EXCEEDED')) throw err('CAP', 'כבר יש לך 3 אתגרים בימים האלה', 409);
    if (m.includes('LEDGER_APPEND_ONLY')) throw err('LEDGER', 'יומן התנועות אינו ניתן לשינוי', 409);
    if (m.includes('UNIQUE')) throw err('CONFLICT', 'הפעולה כבר בוצעה', 409);
    throw e;
  }
}

/* ---------- מילים ---------- */
export async function createPersonalWord(env, user, b) {
  // אתגר מהספרייה: הכותרת, הכלל והאייקון נלקחים מהספרייה (מזהה יציב), לא מהלקוח
  let lib = null;
  if (b.libraryId) { lib = MilaLibrary.get(String(b.libraryId)); if (!lib) throw err('VALIDATION', 'האתגר לא נמצא בספרייה'); }
  const { title, rule } = validateWord(lib ? lib.title : b.title, lib ? lib.rule : b.rule);
  const today = localDate(user.timezone);
  if (b.startDate != null && !isValidDate(b.startDate)) throw err('VALIDATION', 'תאריך ההתחלה לא תקין');
  const start = b.startDate || today;
  if (start < today) throw err('VALIDATION', 'אי אפשר להתחיל בתאריך שעבר');
  if (diffDays(today, start) > 60) throw err('VALIDATION', 'אפשר לתכנן עד 60 יום קדימה');
  let circleId = b.circleId || null;
  // אתגר רגיש: פרטי כברירת מחדל; שיתוף עם קבוצה רק בבחירה מפורשת
  if (lib && MilaLibrary.isSensitive(lib.id) && b.shareSensitive !== true) circleId = null;
  if (circleId && !(await isMember(env, circleId, user.id))) throw err('FORBIDDEN', 'את לא חברה בקבוצה הזו', 403);
  const vis = circleId ? 'status' : 'private';   // בקבוצה כולן רואות הכול; בלי קבוצה – רק אני
  const reward = String(b.reward || '').trim().slice(0, 80) || null;
  const rewardShared = reward && b.rewardShared === true ? 1 : 0;
  const cap = await capInfo(env, user.id, start);
  if (!cap.ok) throw err('CAP', 'כבר יש לך 3 אתגרים בימים האלה', 409, { cap });
  const did = uid(); const end = addDays(start, ROUND_DAYS - 1);
  const { kid, stmts } = commitmentStmts(env, did, user, start, end);
  const batch = [S(env, `insert into word_definitions(id, kind, circle_id, owner_id, title, rule, icon, visibility, start_date, end_date, status, library_id, category, library_version) values (?,?,?,?,?,?,?,?,?,?,'active',?,?,?)`, did, 'personal', circleId, user.id, title, rule, icon(lib ? lib.icon : b.icon), vis, start, end, lib ? lib.id : null, lib ? lib.cat : null, lib ? lib.version : null), ...stmts];
  if (reward) batch.push(S(env, `update word_commitments set reward = ?, reward_shared = ? where id = ?`, reward, rewardShared, kid));
  if (circleId && vis !== 'private') batch.push(eventStmt(env, circleId, user.id, 'word_committed', { defId: did, title }));
  batch.push(...grantStmts(env, user.id, 'first_word', did));
  await runBatch(env, batch);
  return { defId: did, commitmentId: kid };
}

export async function proposeGroupWord(env, user, b) {
  const c = await first(env, `select * from circles where id = ? and status = 'active'`, b.circleId);
  if (!c) throw err('NOT_FOUND', 'קבוצה לא נמצאה', 404);
  if (!(await isMember(env, c.id, user.id))) throw err('FORBIDDEN', 'את לא חברה בקבוצה הזו', 403);
  if (c.who_can_propose === 'admins' && !(await isAdmin(env, c.id, user.id))) throw err('FORBIDDEN', 'בקבוצה הזו רק מנהלות פותחות אתגר משותף', 403);
  const { title, rule } = validateWord(b.title, b.rule);
  const today = localDate(user.timezone);
  if (b.startDate != null && !isValidDate(b.startDate)) throw err('VALIDATION', 'תאריך ההתחלה לא תקין');
  const start = b.startDate || today;
  if (start < today) throw err('VALIDATION', 'אי אפשר להתחיל בתאריך שעבר');
  const did = uid(); const vis = 'status';
  const members = await all(env, `select user_id from circle_memberships where circle_id = ? and left_at is null and user_id <> ?`, c.id, user.id);
  const batch = [
    S(env, `insert into word_definitions(id, kind, circle_id, owner_id, title, rule, icon, visibility, start_date, end_date, status) values (?,?,?,?,?,?,?,?,?,?,'proposed')`, did, 'group', c.id, user.id, title, rule, icon(b.icon), vis, start, addDays(start, ROUND_DAYS - 1)),
    eventStmt(env, c.id, user.id, 'group_word_proposed', { defId: did, title }),
    ...members.map(m => notifyStmt(env, m.user_id, 'group_word', `באה איתי? · ${c.name}`, `${user.display_name} פתחה אתגר משותף: ${title}`, { defId: did, circleId: c.id }, today)),
  ];
  await runBatch(env, batch);
  return { defId: did };
}

export async function adoptGroupWord(env, user, b) {
  const d = await first(env, `select * from word_definitions where id = ? and kind = 'group'`, b.defId);
  if (!d) throw err('NOT_FOUND', 'האתגר לא נמצא', 404);
  if (!(await isMember(env, d.circle_id, user.id))) throw err('FORBIDDEN', 'את לא חברה בקבוצה הזו', 403);
  if (d.status === 'cancelled') throw err('VALIDATION', 'ההצעה בוטלה');
  const existing = await first(env, `select id from word_commitments where definition_id = ? and user_id = ? and status <> 'cancelled'`, d.id, user.id);
  if (existing) return { commitmentId: existing.id, duplicate: true };
  const today = localDate(user.timezone);
  const start = d.start_date > today ? d.start_date : today;
  if (start > d.end_date) throw err('VALIDATION', 'האתגר הזה כבר הסתיים. אפשר לפתוח אותו מחדש לסבב הבא.');
  const cap = await capInfo(env, user.id, start, diffDays(start, d.end_date) + 1);
  if (!cap.ok) throw err('CAP', 'כבר יש לך 3 אתגרים בימים האלה', 409, { cap });
  const { kid, stmts } = commitmentStmts(env, d.id, user, start, d.end_date);
  const batch = [...stmts, S(env, `update word_definitions set status = 'active' where id = ? and status = 'proposed'`, d.id), eventStmt(env, d.circle_id, user.id, 'group_word_adopted', { defId: d.id, title: d.title }), ...grantStmts(env, user.id, 'first_word', d.id), ...grantStmts(env, user.id, 'first_group_word', d.id)];
  try { await runBatch(env, batch); }
  catch (e) { if (e.code === 'CONFLICT') { const k = await first(env, `select id from word_commitments where definition_id = ? and user_id = ? and status <> 'cancelled'`, d.id, user.id); if (k) return { commitmentId: k.id, duplicate: true }; } throw e; }
  return { commitmentId: kid, duplicate: false };
}

export async function cancelProposal(env, user, b) {
  const d = await first(env, `select * from word_definitions where id = ?`, b.defId);
  if (!d) throw err('NOT_FOUND', 'לא נמצא', 404);
  if (!d.circle_id || !(await isMember(env, d.circle_id, user.id)) || (d.owner_id !== user.id && !(await isAdmin(env, d.circle_id, user.id)))) throw err('FORBIDDEN', 'אין הרשאה', 403);
  if (await first(env, `select 1 as x from word_commitments where definition_id = ? and status <> 'cancelled'`, d.id)) throw err('VALIDATION', 'חברות כבר הצטרפו לאתגר, אז אי אפשר לבטל אותו. אפשר לעצור את האתגר שלך.');
  await S(env, `update word_definitions set status = 'cancelled' where id = ?`, d.id).run();
}

function endCommitmentStmts(env, kid, userId, reason) {
  return [
    S(env, `update word_commitments set status = 'ended_early', end_reason = ? where id = ? and user_id = ? and status = 'active'`, reason, kid, userId),
    S(env, `update daily_obligations set status = 'cancelled' where commitment_id = ? and outcome is null and status in ('scheduled','open')`, kid),
  ];
}
export async function endCommitment(env, user, b) {
  const k = await first(env, `select id from word_commitments where id = ? and user_id = ?`, b.commitmentId, user.id);
  if (!k) throw err('FORBIDDEN', 'אין הרשאה', 403);
  await runBatch(env, endCommitmentStmts(env, k.id, user.id, 'ended_by_user'));
}

/* ---------- הכרעה ---------- */
const statusOf = (o) => (o === 'success' ? 'confirmed_success' : o === 'miss' ? 'confirmed_miss' : 'excused');
function ledgerType(outcome, circleId) { return outcome === 'success' ? 'EARN' : circleId ? 'MISS_TO_CIRCLE' : 'MISS_PERSONAL'; }

/* statements להכרעה ראשונה של אירוע. כל ההכנסות מותנות בכך שה-UPDATE שלנו הוא שהכריע (resolved_at = at). */
function resolveStmts(env, o, d, outcome, reason, actorId, at, note) {
  const stmts = [
    S(env, `update daily_obligations set outcome = ?, status = ?, resolved_at = ?, resolve_reason = ?, resolution_no = resolution_no + 1, note = coalesce(?, note) where id = ? and outcome is null`, outcome, statusOf(outcome), at, reason, note || null, o.id),
    S(env, `insert into resolution_history(id, obligation_id, from_state, to_state, reason, actor_id, created_at) select ?, id, ?, ?, ?, ?, ? from daily_obligations where id = ? and resolved_at = ?`, uid(), o.status, statusOf(outcome), reason, actorId, at, o.id, at),
  ];
  if (outcome !== 'excused') stmts.push(S(env, `insert into virtual_ledger(id, obligation_id, user_id, definition_id, circle_id, transaction_type, amount, resolution_no, local_date, created_at) select ?, id, user_id, ?, ?, ?, 1, resolution_no, local_date, ? from daily_obligations where id = ? and resolved_at = ?`, uid(), d.id, d.circle_id, ledgerType(outcome, d.circle_id), at, o.id, at));
  if (d.circle_id && d.visibility !== 'private' && reason === 'self_report') stmts.push(S(env, `insert into social_events(id, circle_id, actor_id, type, payload) select ?, ?, ?, ?, ? from daily_obligations where id = ? and resolved_at = ?`, uid(), d.circle_id, o.user_id, outcome === 'success' ? 'day_success' : outcome === 'miss' ? 'day_miss' : 'day_excused', JSON.stringify({ title: d.title, defId: d.id, date: o.local_date }), o.id, at));
  return stmts;
}

async function streakOf(env, kid) {
  const rows = await all(env, `select outcome from daily_obligations where commitment_id = ? and status <> 'cancelled' and outcome is not null order by local_date desc`, kid);
  let s = 0; for (const r of rows) { if (r.outcome === 'success') s++; else if (r.outcome === 'miss') break; }
  return s;
}
async function afterSuccess(env, user, o, d) {
  const stmts = [...grantStmts(env, user.id, 'first_day', o.id)];
  const s = await streakOf(env, o.commitment_id);
  if (s >= 7) stmts.push(...grantStmts(env, user.id, 'streak_7', o.commitment_id));
  if (s >= 14) stmts.push(...grantStmts(env, user.id, 'streak_14', o.commitment_id));
  if (d.circle_id && d.visibility !== 'private' && [3, 7, 14].includes(s)) stmts.push(eventStmt(env, d.circle_id, user.id, 'streak', { title: d.title, streak: s, defId: d.id }));
  await env.DB.batch(stmts);
}

export async function report(env, user, b) {
  const outcome = b.outcome;
  if (!['success', 'miss', 'excused'].includes(outcome)) throw err('VALIDATION', 'תוצאה לא תקינה');
  const o = await first(env, `select * from daily_obligations where id = ?`, b.obligationId);
  if (!o) throw err('NOT_FOUND', 'היום הזה לא נמצא', 404);
  if (o.user_id !== user.id) throw err('FORBIDDEN', 'רק מי שלקחה את האתגר יכולה לדווח עליו', 403);
  if (o.status === 'cancelled') throw err('VALIDATION', 'היום הזה בוטל');
  if (o.outcome) return { duplicate: true, outcome: o.outcome };
  const k = await first(env, `select * from word_commitments where id = ?`, o.commitment_id);
  const d = await first(env, `select * from word_definitions where id = ?`, k.definition_id);
  const w = windowOf(o.local_date, k.timezone); const now = new Date();
  if (now < w.opens) throw err('VALIDATION', 'עוד אי אפשר לדווח על יום שלא התחיל');
  if (now >= w.closes) throw err('VALIDATION', 'עבר הזמן לדווח על היום הזה (אפשר עד 10:00 למחרת).');
  if (outcome === 'excused') {
    const used = await first(env, `select count(*) as n from daily_obligations where commitment_id = ? and outcome = 'excused'`, k.id);
    if (used.n >= MAX_EXCUSES) throw err('VALIDATION', `כבר השתמשת ב-${MAX_EXCUSES} ימים חריגים בסבב הזה`);
  }
  const at = nowISO();
  try { await runBatch(env, resolveStmts(env, o, d, outcome, 'self_report', user.id, at, b.note ? String(b.note).slice(0, 60) : null)); }
  catch (e) { if (e.code === 'CONFLICT') { const cur = await first(env, `select outcome from daily_obligations where id = ?`, o.id); return { duplicate: true, outcome: cur.outcome }; } throw e; }
  const after = await first(env, `select resolved_at, outcome from daily_obligations where id = ?`, o.id);
  if (after.resolved_at !== at) return { duplicate: true, outcome: after.outcome };   // מישהי הקדימה אותנו (בקשה מקבילה)
  if (outcome === 'success') await afterSuccess(env, user, o, d);
  return { duplicate: false, outcome };
}

/* ״המהפך״: הטלפון מחשב את הדירוג (כבר יש לו את הנתונים) ומדווח עקיפה.
   השרת מוודא חברות בקבוצה והצלחה טרייה, ושומר אירוע אחד והתראה לחברה שנעקפה. */
export async function overtake(env, user, b) {
  const cid = String(b.circleId || ''), other = String(b.passedUserId || '');
  if (!cid || !other || other === user.id || !(await isMember(env, cid, user.id)) || !(await isMember(env, cid, other))) throw err('FORBIDDEN', 'אין הרשאה', 403);
  const today = localDate(user.timezone);
  const fresh = await first(env, `select 1 as x from daily_obligations o join word_commitments k on k.id = o.commitment_id join word_definitions d on d.id = k.definition_id where o.user_id = ? and o.local_date >= ? and o.outcome = 'success' and d.circle_id = ? limit 1`, user.id, addDays(today, -1), cid);
  if (!fresh) throw err('VALIDATION', 'אין דיווח חדש');
  const dup = await first(env, `select 1 as x from social_events where circle_id = ? and created_at > ? and actor_id = ? and type = 'overtake' and payload like ? limit 1`, cid, new Date(Date.now() - 20 * 3600000).toISOString(), user.id, `%${other}%`);
  if (dup) return { ok: true, duplicate: true };
  await env.DB.batch([
    eventStmt(env, cid, user.id, 'overtake', { passedUserId: other }),
    notifyStmt(env, other, 'overtake', `${user.display_name} עקפה אותך.`, 'עוד הצלחה אחת ואת חוזרת.', { circleId: cid }, today + user.id),
  ]);
  return { ok: true };
}

export async function correct(env, user, b) {
  const outcome = b.outcome; const reason = String(b.reason || '').trim();
  if (!['success', 'miss', 'excused'].includes(outcome)) throw err('VALIDATION', 'תוצאה לא תקינה');
  if (!reason) throw err('VALIDATION', 'צריך סיבה קצרה לתיקון');
  const o = await first(env, `select * from daily_obligations where id = ?`, b.obligationId);
  if (!o || o.user_id !== user.id) throw err('FORBIDDEN', 'אין הרשאה', 403);
  if (!o.outcome) throw err('VALIDATION', 'עוד אין דיווח לתקן');
  // יום שנסגר אוטומטית כפספוס ניתן לתיקון כמו כל דיווח (החלטת מוצר קיימת; ראו docs/SPEC-OPEN.md)
  // 24 שעות נמדדות מהדיווח הראשון, לא מהתיקון האחרון (אחרת החלון מתגלגל בלי סוף)
  const firstAt = (await first(env, `select min(created_at) as t from resolution_history where obligation_id = ?`, o.id)).t || o.resolved_at;
  if (Date.now() - Date.parse(firstAt) >= CORRECTION_MS) throw err('VALIDATION', 'חלון התיקון (24 שעות) נסגר');
  if (o.outcome === outcome) return { changed: false };
  const k = await first(env, `select * from word_commitments where id = ?`, o.commitment_id);
  const d = await first(env, `select * from word_definitions where id = ?`, k.definition_id);
  if (outcome === 'excused') {
    const used = await first(env, `select count(*) as n from daily_obligations where commitment_id = ? and outcome = 'excused'`, k.id);
    if (used.n >= MAX_EXCUSES) throw err('VALIDATION', `כבר השתמשת ב-${MAX_EXCUSES} ימים חריגים בסבב הזה`);
  }
  const active = await first(env, `select l.* from virtual_ledger l where l.obligation_id = ? and l.transaction_type <> 'REVERSE' and not exists (select 1 from virtual_ledger r where r.reversal_of = l.id)`, o.id);
  const at = nowISO(); const expected = o.resolution_no;
  const stmts = [
    S(env, `update daily_obligations set outcome = ?, status = ?, corrected_at = ?, resolved_at = ?, resolve_reason = 'correction', resolution_no = resolution_no + 1 where id = ? and resolution_no = ?`, outcome, statusOf(outcome), at, at, o.id, expected),
    S(env, `insert into resolution_history(id, obligation_id, from_state, to_state, reason, actor_id, created_at) select ?, id, ?, ?, ?, ?, ? from daily_obligations where id = ? and resolved_at = ?`, uid(), o.status, 'corrected:' + statusOf(outcome), reason.slice(0, 120), user.id, at, o.id, at),
  ];
  if (active) stmts.push(S(env, `insert into virtual_ledger(id, obligation_id, user_id, definition_id, circle_id, transaction_type, amount, resolution_no, reversal_of, local_date, created_at) select ?, id, user_id, ?, ?, 'REVERSE', -1, resolution_no, ?, local_date, ? from daily_obligations where id = ? and resolved_at = ?`, uid(), d.id, active.circle_id, active.id, at, o.id, at));
  if (outcome !== 'excused') stmts.push(S(env, `insert into virtual_ledger(id, obligation_id, user_id, definition_id, circle_id, transaction_type, amount, resolution_no, local_date, created_at) select ?, id, user_id, ?, ?, ?, 1, resolution_no, local_date, ? from daily_obligations where id = ? and resolved_at = ?`, uid(), d.id, d.circle_id, ledgerType(outcome, d.circle_id), at, o.id, at));
  await runBatch(env, stmts);
  const after = await first(env, `select resolved_at from daily_obligations where id = ?`, o.id);
  if (after.resolved_at !== at) throw err('CONFLICT', 'הדיווח השתנה בינתיים. רענני ונסי שוב.', 409);
  if (outcome === 'success') await afterSuccess(env, user, o, d);
  return { changed: true };
}

/* רענון: פתיחת ימים, זקיפה אוטומטית של ימים שלא דווחו אחרי סגירת החלון, סיום התחייבויות */
export async function settle(env, user) {
  const rows = await all(env, `select o.*, k.timezone, k.definition_id from daily_obligations o join word_commitments k on k.id = o.commitment_id where o.user_id = ? and o.outcome is null and o.status in ('scheduled','open') and k.status = 'active' and o.local_date <= ? order by o.local_date`, user.id, addDays(localDate(user.timezone), 1));
  const now = new Date(); const stmts = [];
  const defCache = {};
  for (const o of rows) {
    const w = windowOf(o.local_date, o.timezone);
    if (now >= w.closes) {
      defCache[o.definition_id] = defCache[o.definition_id] || await first(env, `select * from word_definitions where id = ?`, o.definition_id);
      stmts.push(...resolveStmts(env, o, defCache[o.definition_id], 'miss', 'auto_unreported', null, w.closes.toISOString(), null));
    } else if (now >= w.opens && o.status === 'scheduled') stmts.push(S(env, `update daily_obligations set status = 'open' where id = ? and status = 'scheduled'`, o.id));
  }
  if (stmts.length) { try { await runBatch(env, stmts); } catch (e) { if (e.code !== 'CONFLICT') throw e; } }   // CONFLICT = בקשה מקבילה (או ה-cron) כבר סגרה את אותם ימים
  // סיום התחייבויות שכל ימיהן הוכרעו
  const done = await all(env, `select k.id from word_commitments k where k.user_id = ? and k.status = 'active' and k.end_date < ? and not exists (select 1 from daily_obligations o where o.commitment_id = k.id and o.outcome is null and o.status <> 'cancelled')`, user.id, localDate(user.timezone));
  if (done.length) {
    const completedBefore = (await first(env, `select count(*) as n from word_commitments where user_id = ? and status = 'completed'`, user.id)).n;
    const s2 = [];
    done.forEach((k, i) => { s2.push(S(env, `update word_commitments set status = 'completed', completed_at = ? where id = ?`, nowISO(), k.id)); s2.push(...grantStmts(env, user.id, 'round_complete', k.id)); if (completedBefore + i + 1 >= 2) s2.push(...grantStmts(env, user.id, 'second_round', k.id)); });
    await env.DB.batch(s2);
  }
}

/* Cron: סגירת ימים שלא דווחו אצל כל המשתמשות, כדי שהדירוג בקבוצה יהיה הוגן גם כשמישהי לא פותחת את האפליקציה.
   השאילתה מחזירה רק ימים שכבר אפשר לסגור (לפי אזור הזמן של כל התחייבות), כך שריצה בלי מה לסגור כמעט לא עולה כלום:
   אינדקס חלקי על ימים פתוחים (מיגרציה 0007), רשימת אזורי הזמן נשמרת בזיכרון לחצי שעה, ועד limit ימים בכל ריצה. */
let tzCache = { at: 0, list: [] };
export async function settleAll(env, now = new Date(), limit = 60) {
  if (now.getTime() - tzCache.at > 30 * 60000 || !tzCache.list.length) {
    tzCache = { at: now.getTime(), list: (await all(env, `select distinct timezone from word_commitments where status = 'active'`)).map(r => r.timezone).filter(Boolean).slice(0, 40) };
  }
  if (!tzCache.list.length) return { closed: 0 };
  // יום D נסגר ב-10:00 של D+1 באזור הזמן שלו ⇒ נסגרו כל הימים עד (התאריך המקומי לפני GRACE_HOUR שעות) פחות יום
  const cutoff = (tz) => addDays(localDate(tz, new Date(now.getTime() - GRACE_HOUR * 3600000)), -1);
  const conds = tzCache.list.map(() => '(k.timezone = ? and o.local_date <= ?)').join(' or ');
  const binds = tzCache.list.flatMap(tz => [tz, cutoff(tz)]);
  // אזור זמן שעוד לא ברשימה: כל מה שנסגר בוודאות בכל מקום בעולם (לפני 46 שעות ומעלה)
  const anywhere = addDays(localDate('UTC', new Date(now.getTime() - 22 * 3600000)), -1);
  const rows = await all(env, `select o.id, o.status, o.user_id, o.local_date, k.timezone, d.id as def_id, d.circle_id, d.visibility, d.title
    from daily_obligations o join word_commitments k on k.id = o.commitment_id join word_definitions d on d.id = k.definition_id
    where o.outcome is null and o.status in ('scheduled','open') and k.status = 'active' and (${conds} or o.local_date <= ?) order by o.local_date limit ?`, ...binds, anywhere, limit);
  const stmts = []; let n = 0; const closesAt = new Map();
  for (const o of rows) {
    const key = o.local_date + '|' + o.timezone;
    if (!closesAt.has(key)) closesAt.set(key, windowOf(o.local_date, o.timezone).closes);   // חישוב אזור זמן יקר: פעם אחת לכל תאריך ואזור
    const closes = closesAt.get(key);
    if (now < closes) continue;
    stmts.push(...resolveStmts(env, o, { id: o.def_id, circle_id: o.circle_id, visibility: o.visibility, title: o.title }, 'miss', 'auto_unreported', null, closes.toISOString(), null)); n++;
  }
  if (stmts.length) { try { await runBatch(env, stmts); } catch (e) { if (e.code !== 'CONFLICT') throw e; n = 0; } }
  return { closed: n };
}
/* Cron (פעם ביום): ניקוי נתונים ישנים שאין בהם עוד צורך — עדכונים, sessions שפג תוקפם, אירועי מעקב */
export async function cleanup(env, now = new Date()) {
  const iso = (days) => new Date(now.getTime() - days * 86400000).toISOString();
  await env.DB.batch([
    S(env, `delete from sessions where expires_at < ?`, now.toISOString()),
    S(env, `delete from notifications where created_at < ?`, iso(60)),
    S(env, `delete from track_events where day < ?`, addDays(localDate('Asia/Jerusalem', now), -400)),
    S(env, `delete from invite_opens where created_at < ?`, iso(400)),
  ]);
}

/* ---------- קבוצות ---------- */
const MAX_CIRCLES_PER_USER = 20;
async function assertCircleRoom(env, userId) {
  const n = (await first(env, `select count(*) as n from circle_memberships where user_id = ? and left_at is null`, userId)).n;
  if (n >= MAX_CIRCLES_PER_USER) throw err('VALIDATION', `אפשר להיות בעד ${MAX_CIRCLES_PER_USER} קבוצות. כדי להצטרף לחדשה צריך לעזוב אחת.`);
}
const INVITE_KINDS = new Set(['follow', 'compete', 'same']);
async function newInviteStmt(env, circleId, userId, o = {}) {
  const tok = inviteCode();
  const kind = INVITE_KINDS.has(o.kind) ? o.kind : 'follow';
  const libraryId = o.libraryId && MilaLibrary.get(String(o.libraryId)) ? String(o.libraryId) : null;
  const message = String(o.message || '').trim().slice(0, 200) || null;
  const wordTitle = String(o.wordTitle || '').trim().slice(0, 60) || null;
  return { tok, stmt: S(env, `insert into circle_invites(token_hash, token_hint, circle_id, inviter_id, expires_at, max_uses, kind, message, library_id, word_title) values (?,?,?,?,?,20,?,?,?,?)`, await sha256hex(tok), tok.slice(0, 2), circleId, userId, new Date(Date.now() + 7 * 86400000).toISOString(), kind, message, libraryId, wordTitle) };
}
export async function createCircle(env, user, b) {
  const name = String(b.name || '').trim(); if (!name) throw err('VALIDATION', 'שם הקבוצה לא יכול להיות ריק'); if (name.length > 50) throw err('VALIDATION', 'שם הקבוצה ארוך מדי (עד 50 תווים)');
  await assertCircleRoom(env, user.id);
  const cid = uid(); const today = localDate(user.timezone);
  const roundStart = isValidDate(b.roundStart) ? b.roundStart : today;
  const maxMembers = Math.min(50, Math.max(2, Number(b.maxMembers) || 8));
  const inv = await newInviteStmt(env, cid, user.id);
  await runBatch(env, [
    S(env, `insert into circles(id, name, description, owner_id, color, who_can_propose, max_members, round_start) values (?,?,?,?,?,?,?,?)`, cid, name, String(b.description || '').trim().slice(0, 120), user.id, COLORS.has(b.color) ? b.color : 'pink', b.whoCanPropose === 'admins' ? 'admins' : 'all', maxMembers, roundStart),
    S(env, `insert into circle_memberships(id, circle_id, user_id, role) values (?,?,?,'admin')`, uid(), cid, user.id),
    inv.stmt, eventStmt(env, cid, user.id, 'circle_created', {}), ...grantStmts(env, user.id, 'first_circle', cid),
  ]);
  return { circleId: cid, inviteToken: inv.tok };
}
export async function updateCircle(env, user, b) {
  if (!(await isAdmin(env, b.circleId, user.id))) throw err('FORBIDDEN', 'רק מנהלת יכולה לשנות את פרטי הקבוצה', 403);
  const p = b.patch || {};
  const c = await first(env, `select * from circles where id = ?`, b.circleId);
  const name = p.name !== undefined ? String(p.name).trim() : c.name; if (!name || name.length > 50) throw err('VALIDATION', 'שם לא תקין');
  await S(env, `update circles set name = ?, description = ?, color = ?, who_can_propose = ?, max_members = ? where id = ?`, name, p.description !== undefined ? String(p.description).slice(0, 120) : c.description, COLORS.has(p.color) ? p.color : c.color, p.whoCanPropose === 'admins' || p.whoCanPropose === 'all' ? p.whoCanPropose : c.who_can_propose, p.maxMembers ? Math.min(50, Math.max(2, Number(p.maxMembers))) : c.max_members, c.id).run();
}
export async function createInvite(env, user, b) {
  if (!b.circleId || !(await isMember(env, String(b.circleId), user.id))) throw err('FORBIDDEN', 'אין הרשאה', 403);
  const inv = await newInviteStmt(env, b.circleId, user.id, b); await inv.stmt.run(); return { token: inv.tok };
}
export async function revokeCircleInvites(env, user, b) {
  if (!(await isAdmin(env, b.circleId, user.id))) throw err('FORBIDDEN', 'רק מנהלת יכולה לבטל קישורים', 403);
  const inv = await newInviteStmt(env, b.circleId, user.id);
  await env.DB.batch([S(env, `update circle_invites set status = 'revoked' where circle_id = ? and status = 'active'`, b.circleId), inv.stmt]);
  return { token: inv.tok };
}
export async function previewInvite(env, user, b) {
  const token = String(b.token || '').toUpperCase().trim();
  const inv = await first(env, `select * from circle_invites where token_hash = ?`, await sha256hex(token));
  if (!inv) return { ok: false, reason: 'not_found' };
  if (inv.status !== 'active') return { ok: false, reason: 'revoked' };
  if (inv.expires_at < nowISO()) return { ok: false, reason: 'expired' };
  if (inv.uses >= inv.max_uses) return { ok: false, reason: 'full' };
  const c = await first(env, `select * from circles where id = ? and status = 'active'`, inv.circle_id);
  if (!c) return { ok: false, reason: 'not_found' };
  if (await isBlocked(env, inv.inviter_id, user.id) || await isBlocked(env, user.id, inv.inviter_id)) return { ok: false, reason: 'not_found' };
  const inviter = await first(env, `select id, display_name, color from users where id = ?`, inv.inviter_id);
  const members = (await first(env, `select count(*) as n from circle_memberships where circle_id = ? and left_at is null`, c.id)).n;
  const sample = await first(env, `select title from word_definitions where circle_id = ? and kind = 'group' and status <> 'cancelled' order by created_at desc limit 1`, c.id);
  const today = localDate(user.timezone); const i = Math.floor(diffDays(c.round_start, today) / ROUND_DAYS); const rs = addDays(c.round_start, i * ROUND_DAYS);
  return { ok: true, inv: { token, expiresAt: inv.expires_at, uses: inv.uses, maxUses: inv.max_uses }, kind: inv.kind || 'follow', message: inv.message || '', libraryId: inv.library_id || null, wordTitle: inv.word_title || '', challenge: inv.library_id ? MilaLibrary.get(inv.library_id) : null, circle: { id: c.id, name: c.name, description: c.description, color: c.color }, inviter: { id: inviter.id, name: inviter.display_name, color: inviter.color }, memberCount: members, maxMembers: c.max_members, alreadyMember: await isMember(env, c.id, user.id), sampleWord: sample ? { title: sample.title } : null, round: { index: i + 1, start: rs, end: addDays(rs, 13), dayIndex: Math.min(Math.max(diffDays(rs, today) + 1, 0), 14), nextStart: addDays(rs, 14) } };
}
export async function acceptInvite(env, user, b) {
  const p = await previewInvite(env, user, b);
  if (!p.ok) throw err('INVITE_INVALID', { not_found: 'הקישור לא נמצא. אולי הוא הועתק לא נכון?', revoked: 'הקישור בוטל על ידי הקבוצה. אפשר לבקש קישור חדש.', expired: 'תוקף הקישור פג. אפשר לבקש הזמנה חדשה.', full: 'הקישור הזה כבר נוצל במלואו.' }[p.reason]);
  const cid = p.circle.id;
  if (p.alreadyMember) return { circleId: cid };
  // מי שמנהלת הסירה מהקבוצה לא חוזרת עם קישור שנוצר לפני ההסרה (צריך הזמנה חדשה מחברה בקבוצה)
  const removed = await first(env, `select max(left_at) as t from circle_memberships where circle_id = ? and user_id = ? and removed_by is not null`, cid, user.id);
  if (removed && removed.t) { const row = await first(env, `select created_at, inviter_id from circle_invites where token_hash = ?`, await sha256hex(p.inv.token)); if (!row || row.created_at <= removed.t || row.inviter_id === user.id) throw err('INVITE_INVALID', 'הקישור הזה כבר לא פעיל. אפשר לבקש הזמנה חדשה מחברה בקבוצה.'); }
  await assertCircleRoom(env, user.id);
  if (p.memberCount >= p.maxMembers) throw err('CIRCLE_FULL', 'הקבוצה מלאה. אפשר לבקש ממנהלת הקבוצה להגדיל את מספר המקומות.', 409);
  const hash = await sha256hex(p.inv.token); const mid = uid();
  const joined = `exists (select 1 from circle_memberships where id = '${mid}')`;   // כל השאר קורה רק אם ההצטרפות עצמה הצליחה
  try {
    await runBatch(env, [
      // ההצטרפות מותנית בכך שהקבוצה עדיין לא מלא (בקשות מקבילות)
      S(env, `insert into circle_memberships(id, circle_id, user_id, role) select ?, ?, ?, 'member' where (select count(*) from circle_memberships where circle_id = ? and left_at is null) < ?`, mid, cid, user.id, cid, p.maxMembers),
      S(env, `update circle_invites set uses = uses + 1 where token_hash = ? and ${joined}`, hash),
      S(env, `update circle_memberships set via_invite = ? where circle_id = ? and user_id = ? and left_at is null and via_invite is null`, hash, cid, user.id),
      S(env, `update users set invited_by = ?, invited_via = ? where id = ? and invited_by is null and id <> ? and ${joined}`, p.inviter.id, hash, user.id, p.inviter.id),
      S(env, `insert into social_events(id, circle_id, actor_id, type, payload) select ?, ?, ?, 'member_joined', ? where ${joined}`, uid(), cid, user.id, JSON.stringify({ inviterId: p.inviter.id })), ...grantStmts(env, user.id, 'first_circle', cid),
      // ההזמנה עבדה: עדכון למי ששלחה אותה
      S(env, `insert or ignore into notifications(id, user_id, type, title, body, ref, dedupe_key) select ?, ?, 'invite', ?, 'ההזמנה שלך עבדה.', ?, ? where ${joined}`, uid(), p.inviter.id, `${user.display_name} הצטרפה ל${p.circle.name} 🎉`, JSON.stringify({ circleId: cid }), `invite|${user.id}|${cid}|${localDate(user.timezone)}`),
    ]);
    (env.__notified || (env.__notified = new Set())).add(p.inviter.id);
  } catch (e) { if (e.code !== 'CONFLICT') throw e; }
  if (!(await isMember(env, cid, user.id))) throw err('CIRCLE_FULL', 'הקבוצה התמלאה בדיוק עכשיו.', 409);
  return { circleId: cid };
}
export async function leaveCircle(env, user, b) {
  const m = await first(env, `select * from circle_memberships where circle_id = ? and user_id = ? and left_at is null`, b.circleId, user.id);
  if (!m) return;
  const stmts = [];
  if (m.role === 'admin') {
    const other = await first(env, `select user_id from circle_memberships where circle_id = ? and user_id <> ? and left_at is null order by joined_at limit 1`, b.circleId, user.id);
    if (other) { stmts.push(S(env, `update circle_memberships set role = 'admin' where circle_id = ? and user_id = ? and left_at is null`, b.circleId, other.user_id)); stmts.push(eventStmt(env, b.circleId, other.user_id, 'admin_transferred', {})); }
    else stmts.push(S(env, `update circles set status = 'archived' where id = ?`, b.circleId));
  }
  stmts.push(S(env, `update circle_memberships set left_at = ? where id = ?`, nowISO(), m.id));
  const ks = await all(env, `select k.id from word_commitments k join word_definitions d on d.id = k.definition_id where k.user_id = ? and k.status = 'active' and d.circle_id = ?`, user.id, b.circleId);
  for (const k of ks) stmts.push(...endCommitmentStmts(env, k.id, user.id, 'left_circle'));
  stmts.push(eventStmt(env, b.circleId, user.id, 'member_left', {}));
  await runBatch(env, stmts);
}
export async function removeMember(env, user, b) {
  if (!(await isAdmin(env, b.circleId, user.id))) throw err('FORBIDDEN', 'רק מנהלת הקבוצה יכולה להסיר חברות', 403);
  if (b.userId === user.id) throw err('VALIDATION', 'כדי לצאת בעצמך השתמשי ב״לעזוב את הקבוצה״');
  const stmts = [S(env, `update circle_memberships set left_at = ?, removed_by = ? where circle_id = ? and user_id = ? and left_at is null`, nowISO(), user.id, b.circleId, b.userId), eventStmt(env, b.circleId, user.id, 'member_removed', { userId: b.userId }),
    S(env, `update circle_invites set status = 'revoked' where circle_id = ? and inviter_id = ? and status = 'active'`, b.circleId, b.userId)];
  // האתגרים שלה בקבוצה הזו נעצרים (הנקודות נשארות שלה)
  const ks = await all(env, `select k.id from word_commitments k join word_definitions d on d.id = k.definition_id where k.user_id = ? and k.status = 'active' and d.circle_id = ?`, b.userId, b.circleId);
  for (const k of ks) stmts.push(...endCommitmentStmts(env, k.id, b.userId, 'removed_from_circle'));
  await runBatch(env, stmts);
}
/* מנהלת יכולה להפוך חברה למנהלת, או להחזיר מנהלת אחרת לחברה רגילה (לא את עצמה אם היא היחידה) */
export async function setMemberRole(env, user, b) {
  if (!(await isAdmin(env, b.circleId, user.id))) throw err('FORBIDDEN', 'רק מנהלת יכולה לשנות הרשאות', 403);
  const role = b.role === 'admin' ? 'admin' : 'member';
  const m = await first(env, `select * from circle_memberships where circle_id = ? and user_id = ? and left_at is null`, b.circleId, b.userId);
  if (!m) throw err('NOT_FOUND', 'החברה לא בקבוצה', 404);
  if (role === 'member') {
    const admins = (await first(env, `select count(*) as n from circle_memberships where circle_id = ? and role = 'admin' and left_at is null`, b.circleId)).n;
    if (admins <= 1 && m.role === 'admin') throw err('VALIDATION', 'צריכה להישאר לפחות מנהלת אחת בקבוצה');
  }
  if (m.role === role) return { ok: true };
  await env.DB.batch([
    S(env, `update circle_memberships set role = ? where id = ?`, role, m.id),
    ...(role === 'admin' ? [eventStmt(env, b.circleId, b.userId, 'admin_transferred', {})] : []),
  ]);
  return { ok: true };
}
/* סגירת קבוצה (מנהלת בלבד): האתגרים בקבוצה נעצרים אצל כולן, ההזמנות מבוטלות,
   החברות יוצאות והקבוצה נשמרת בארכיון. הנקודות וההיסטוריה של כל אחת נשארות. */
export async function deleteCircle(env, user, b) {
  if (!(await isAdmin(env, b.circleId, user.id))) throw err('FORBIDDEN', 'רק מנהלת יכולה לסגור את הקבוצה', 403);
  const c = await first(env, `select * from circles where id = ? and status = 'active'`, b.circleId);
  if (!c) throw err('NOT_FOUND', 'קבוצה לא נמצאה', 404);
  const members = await all(env, `select user_id from circle_memberships where circle_id = ? and left_at is null`, c.id);
  const ks = await all(env, `select k.id, k.user_id from word_commitments k join word_definitions d on d.id = k.definition_id where k.status = 'active' and d.circle_id = ?`, c.id);
  const day = localDate(user.timezone); const at = nowISO();
  const stmts = [];
  for (const k of ks) stmts.push(...endCommitmentStmts(env, k.id, k.user_id, 'circle_deleted'));
  stmts.push(S(env, `update word_definitions set status = 'cancelled' where circle_id = ? and status = 'proposed'`, c.id));
  stmts.push(S(env, `update circle_invites set status = 'revoked' where circle_id = ? and status = 'active'`, c.id));
  stmts.push(S(env, `update circle_memberships set left_at = ? where circle_id = ? and left_at is null`, at, c.id));
  stmts.push(S(env, `update circles set status = 'archived' where id = ?`, c.id));
  for (const m of members) if (m.user_id !== user.id) stmts.push(notifyStmt(env, m.user_id, 'circle_closed', `הקבוצה ${c.name} נסגרה`, `${user.display_name} סגרה את הקבוצה. הנקודות שלך נשארות.`, {}, day));
  await runBatch(env, stmts);
  return { ok: true };
}

/* ---------- חברתי ובטיחות ---------- */
const REACTIONS = new Set(['clap', 'heart', 'muscle', 'fire', 'star']);
export async function encourage(env, user, b) {
  if (!REACTIONS.has(b.reaction)) throw err('VALIDATION', 'תגובה לא נתמכת');
  const e = await first(env, `select circle_id from social_events where id = ?`, b.eventId);
  if (!e || !(await isMember(env, e.circle_id, user.id))) throw err('FORBIDDEN', 'אין הרשאה', 403);
  const cur = await first(env, `select reaction from encouragements where event_id = ? and user_id = ?`, b.eventId, user.id);
  if (cur && cur.reaction === b.reaction) await S(env, `delete from encouragements where event_id = ? and user_id = ?`, b.eventId, user.id).run();
  else await env.DB.batch([S(env, `insert into encouragements(id, event_id, user_id, reaction) values (?,?,?,?) on conflict(event_id, user_id) do update set reaction = excluded.reaction`, uid(), b.eventId, user.id, b.reaction), ...grantStmts(env, user.id, 'first_encouragement', b.eventId)]);
}
export async function sendEncouragement(env, user, b) {
  if (!REACTIONS.has(b.reaction)) throw err('VALIDATION', 'תגובה לא נתמכת');
  if (!(await isMember(env, b.circleId, user.id)) || !(await isMember(env, b.circleId, b.toUserId))) throw err('FORBIDDEN', 'אין הרשאה', 403);
  if (await isBlocked(env, b.toUserId, user.id)) return;
  const sentToday = (await first(env, `select count(*) as n from social_events where circle_id = ? and actor_id = ? and type = 'encouragement' and created_at > ? and payload like ?`, b.circleId, user.id, new Date(Date.now() - 12 * 3600000).toISOString(), `%${String(b.toUserId)}%`)).n;
  if (sentToday >= 5) return;   // מספיק מילים טובות לחצי יום: בלי הצפה
  await env.DB.batch([eventStmt(env, b.circleId, user.id, 'encouragement', { toUserId: b.toUserId, reaction: b.reaction }), notifyStmt(env, b.toUserId, 'encouragement', `${user.display_name} שלחה לך מילה טובה`, '', { circleId: b.circleId }, localDate(user.timezone)), ...grantStmts(env, user.id, 'first_encouragement', b.circleId)]);
}
export async function block(env, user, b) { if (b.userId !== user.id) await S(env, `insert or ignore into user_blocks(blocker_id, blocked_id) values (?,?)`, user.id, b.userId).run(); }
export async function unblock(env, user, b) { await S(env, `delete from user_blocks where blocker_id = ? and blocked_id = ?`, user.id, b.userId).run(); }
export async function reportAbuse(env, user, b) {
  if (!b.reason) throw err('VALIDATION', 'צריך סיבה');
  await S(env, `insert into abuse_reports(id, reporter_id, entity_type, entity_id, reason, details) values (?,?,?,?,?,?)`, uid(), user.id, String(b.entityType || '').slice(0, 20), String(b.entityId || '').slice(0, 80), String(b.reason).slice(0, 80), String(b.details || '').slice(0, 500)).run();
}
export async function markNotificationsRead(env, user) { await S(env, `update notifications set read = 1 where user_id = ? and read = 0`, user.id).run(); }
export async function markSummarySeen(env, user, b) { await S(env, `update word_commitments set summary_seen = 1 where id = ? and user_id = ?`, b.commitmentId, user.id).run(); }
export async function updateSettings(env, user, b) {
  const allowed = ['reminderTime', 'pushReminders', 'socialDigest', 'hideFromLeaderboard', 'lockScreenPrivacy'];
  let cur = {}; try { cur = JSON.parse(user.settings || '{}') || {}; } catch { cur = {}; }
  const p = (b && b.patch && typeof b.patch === 'object') ? b.patch : {};
  for (const k of allowed) {
    if (!(k in p)) continue;
    if (k === 'reminderTime') { const m = typeof p[k] === 'string' && /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(p[k]); if (!m) throw err('VALIDATION', 'שעת התזכורת לא תקינה'); cur[k] = `${m[1].padStart(2, '0')}:${m[2]}`; }
    else { if (typeof p[k] !== 'boolean') throw err('VALIDATION', 'ערך לא תקין'); cur[k] = p[k]; }
  }
  await S(env, `update users set settings = ? where id = ?`, JSON.stringify(cur), user.id).run();
}
export async function rename(env, user, b) { const n = cleanName(b.name); if (!n || n.length > 30) throw err('VALIDATION', 'שם לא תקין'); await S(env, `update users set display_name = ? where id = ?`, n, user.id).run(); }
export async function deleteAccount(env, user) {
  // כל הקבוצות שהייתה בהן אי פעם: רק שם יש עדכונים שמזכירים אותה בשם
  const everCircles = (await all(env, `select distinct circle_id from circle_memberships where user_id = ?`, user.id)).map(r => r.circle_id).slice(0, 40);
  for (const cid of await myCircleIds(env, user.id)) await leaveCircle(env, user, { circleId: cid });
  const likeName = String(user.display_name || '').replace(/[\\%_]/g, '\\$&') + ' %';
  // הפרופיל הופך לאנונימי וכל טקסט חופשי שהיא כתבה נמחק; הספירות ההיסטוריות (נקודות, ימים) נשארות אנונימיות
  await env.DB.batch([
    S(env, `update word_commitments set status = 'ended_early', end_reason = 'account_deleted' where user_id = ? and status = 'active'`, user.id),
    S(env, `update daily_obligations set status = 'cancelled' where user_id = ? and outcome is null and status in ('scheduled','open')`, user.id),
    S(env, `update word_commitments set reward = null, reward_shared = 0 where user_id = ?`, user.id),
    S(env, `update daily_obligations set note = null where user_id = ?`, user.id),
    // אתגרים אישיים שהיא ניסחה בעצמה (לא מהספרייה): הניסוח נמחק
    S(env, `update word_definitions set title = 'אתגר שנמחק', rule = 'נמחק', status = 'cancelled' where owner_id = ? and kind = 'personal' and library_id is null`, user.id),
    S(env, `update circle_invites set status = 'revoked', message = null, word_title = null where inviter_id = ?`, user.id),
    S(env, `update abuse_reports set details = null where reporter_id = ?`, user.id),
    S(env, `update users set display_name = 'משתתפת שעזבה', email = null, google_sub = null, color = 'sky', status = 'deleted', settings = '{}', timezone = 'Asia/Jerusalem', invited_by = null, invited_via = null, last_seen_at = null, is_admin = 0, age_confirmed = 0, terms_accepted_at = null where id = ?`, user.id),
    S(env, `delete from sessions where user_id = ?`, user.id), S(env, `delete from notifications where user_id = ?`, user.id),
    // עדכונים אצל חברות שמזכירים אותה בשם (״X עקפה אותך״) נמחקים גם הם
    ...(everCircles.length ? [S(env, `delete from notifications where (title like ? escape '\\' or body like ? escape '\\') and user_id <> ? and user_id in (select user_id from circle_memberships where circle_id in (${everCircles.map(() => '?').join(',')}))`, likeName, likeName, user.id, ...everCircles)] : []),
    S(env, `delete from user_blocks where blocker_id = ? or blocked_id = ?`, user.id, user.id),
    S(env, `delete from push_subscriptions where user_id = ?`, user.id),
    S(env, `delete from encouragements where user_id = ?`, user.id),
    S(env, `delete from user_days where user_id = ?`, user.id),
  ]);
}
export async function exportData(env, user) {
  const [commitments, obligations, ledger, achievements] = await Promise.all([
    all(env, `select * from word_commitments where user_id = ?`, user.id), all(env, `select * from daily_obligations where user_id = ?`, user.id),
    all(env, `select * from virtual_ledger where user_id = ?`, user.id), all(env, `select * from achievements where user_id = ?`, user.id)]);
  return { user: { id: user.id, name: user.display_name, email: user.email, timezone: user.timezone, createdAt: user.created_at }, commitments, obligations, ledger, achievements };
}

/* הצצה להזמנה לפני הכניסה: מי מזמינה (שם פרטי בלבד), לאיזו קבוצה ומה היא כתבה.
   ציבורי ובלי כתיבה למסד; מוגבל בקצב לפי IP (index.js), והקוד עצמו הוא 6 תווים אקראיים (כמיליארד אפשרויות). */
export async function peekInvite(env, tokenRaw) {
  const tok = String(tokenRaw || '').toUpperCase().trim();
  if (!/^[A-Z0-9]{6}$/.test(tok)) return { ok: false };
  const r = await first(env, `select i.kind, i.message, i.library_id, i.word_title, i.status, i.expires_at, i.uses, i.max_uses,
      c.name as circle_name, c.status as circle_status, c.max_members, u.display_name, u.color, u.status as user_status,
      (select count(*) from circle_memberships m where m.circle_id = i.circle_id and m.left_at is null) as members
    from circle_invites i join circles c on c.id = i.circle_id join users u on u.id = i.inviter_id where i.token_hash = ?`, await sha256hex(tok));
  if (!r || r.status !== 'active' || r.expires_at < nowISO() || r.uses >= r.max_uses || r.circle_status !== 'active' || r.user_status !== 'active') return { ok: false };
  const lib = r.library_id ? MilaLibrary.get(r.library_id) : null;
  return { ok: true, kind: INVITE_KINDS.has(r.kind) ? r.kind : 'follow', message: r.message || '', wordTitle: r.word_title || (lib ? lib.title : ''),
    inviter: { name: String(r.display_name || '').split(' ')[0], color: r.color }, circleName: r.circle_name, members: r.members, full: r.members >= r.max_members };
}

/* פתיחת קישור הזמנה (גם בלי חשבון): מבקרת ייחודית לכל קישור. 2 קריאות, כתיבה אחת לכל היותר. */
export async function trackInviteOpen(env, b) {
  const tok = String(b.token || '').toUpperCase().trim(); const vis = String(b.visitor || '');
  if (!/^[A-Z0-9]{6}$/.test(tok) || !/^[a-z0-9-]{8,40}$/.test(vis)) return { ok: false };
  const hash = await sha256hex(tok);
  const inv = await first(env, `select token_hash, inviter_id, circle_id, kind from circle_invites where token_hash = ?`, hash);
  if (!inv) return { ok: false };
  await S(env, `insert or ignore into invite_opens(token_hash, visitor_id, inviter_id, circle_id, kind) values (?,?,?,?,?)`, hash, vis, inv.inviter_id, inv.circle_id, inv.kind || 'follow').run();
  return { ok: true };
}
/* ייחוס בהרשמה: מי הביאה אותה (אם הגיעה מהזמנה) */
export async function attributeSignup(env, user, token) {
  const tok = String(token || '').toUpperCase().trim(); if (!/^[A-Z0-9]{6}$/.test(tok)) return;
  const hash = await sha256hex(tok);
  const inv = await first(env, `select inviter_id from circle_invites where token_hash = ?`, hash);
  if (inv && inv.inviter_id !== user.id) await S(env, `update users set invited_by = ?, invited_via = ? where id = ? and invited_by is null`, inv.inviter_id, hash, user.id).run();
}
