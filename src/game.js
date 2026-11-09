/* מנוע המשחק בצד השרת. כל פעולה: אימות בעלות/חברות → בדיקת חוקים → batch אטומי ב-D1.
   עקרונות: שקל נוצר רק בהכרעה; יומן append-only; תיקון = REVERSE + תנועה חדשה; דיווח כפול = idempotent;
   תקרת 3 ביום נבדקת כאן ונאכפת שוב בטריגר בתוך אותו batch. */
import { err, uid, nowISO, localDate, addDays, diffDays, isValidDate, windowOf, ROUND_DAYS, DAILY_CAP, MAX_EXCUSES, CORRECTION_MS, sha256hex, inviteCode } from './util.js';

const ACH = {
  first_word: ['נתתי מילה', 'יצרת את ההתחייבות הראשונה שלך'],
  first_day: ['חתום וסגור', 'המילה הראשונה שקוימה'],
  streak_7: ['מילה אחר מילה', 'שבע הצלחות ברצף באותה מילה'],
  streak_14: ['מילה בסלע', '14 הצלחות ברצף. סבב מושלם'],
  first_circle: ['מעגל ראשון', 'הצטרפת למעגל'],
  first_group_word: ['יש לך מילה', 'הצטרפת למילה משותפת'],
  first_encouragement: ['מילה טובה', 'עודדת חברה'],
  round_complete: ['אמרת ועשית', 'סיימת סבב של 14 ימים'],
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
const notifyStmt = (env, userId, type, title, body, ref, day) => S(env, `insert or ignore into notifications(id, user_id, type, title, body, ref, dedupe_key) values (?,?,?,?,?,?,?)`, uid(), userId, type, title, body || '', JSON.stringify(ref || {}), `${type}|${title}|${day}`);
const eventStmt = (env, circleId, actorId, type, payload) => S(env, `insert into social_events(id, circle_id, actor_id, type, payload) values (?,?,?,?,?)`, uid(), circleId, actorId, type, JSON.stringify(payload || {}));

/* ---------- ולידציה ---------- */
function validateWord(title, rule) {
  title = String(title || '').trim(); rule = String(rule || '').trim();
  if (!title) throw err('VALIDATION', 'צריך כותרת למילה');
  if (title.length > 60) throw err('VALIDATION', 'הכותרת ארוכה מדי (עד 60 תווים)');
  if (!rule) throw err('VALIDATION', 'מה נחשב הצלחה? בלי כלל הצלחה אי אפשר לתת מילה');
  if (rule.length > 200) throw err('VALIDATION', 'הכלל ארוך מדי (עד 200 תווים)');
  if (/(הרעב|לא לאכול כלום|צום של|להקיא|לפגוע|חיתוך|סמים|לשתות עד|להשמין)/.test(title + ' ' + rule)) throw err('VALIDATION', 'הניסוח הזה עלול להיות מסוכן. נסי מילה שמוסיפה משהו טוב ליום.');
  return { title, rule };
}
const ICONS = new Set(['walk', 'book', 'noPhone', 'water', 'sleep', 'run', 'noSugar', 'meditate', 'pencil', 'heart', 'leaf', 'coffee', 'dumbbell', 'call', 'tools']);
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
    if (m.includes('DAILY_CAP_EXCEEDED')) throw err('CAP', 'יש לך כבר שלוש מילים על הכף בימים האלה', 409);
    if (m.includes('LEDGER_APPEND_ONLY')) throw err('LEDGER', 'יומן התנועות אינו ניתן לשינוי', 409);
    if (m.includes('UNIQUE')) throw err('CONFLICT', 'הפעולה כבר בוצעה', 409);
    throw e;
  }
}

/* ---------- מילים ---------- */
export async function createPersonalWord(env, user, b) {
  const { title, rule } = validateWord(b.title, b.rule);
  const today = localDate(user.timezone);
  const start = isValidDate(b.startDate) ? b.startDate : today;
  if (start < today) throw err('VALIDATION', 'אי אפשר לתת מילה על ימים שעברו');
  if (diffDays(today, start) > 60) throw err('VALIDATION', 'אפשר לתכנן עד 60 יום קדימה');
  const circleId = b.circleId || null;
  if (circleId && !(await isMember(env, circleId, user.id))) throw err('FORBIDDEN', 'את לא חברה במעגל הזה', 403);
  const vis = circleId ? (['status', 'summary'].includes(b.visibility) ? b.visibility : 'status') : 'private';
  const cap = await capInfo(env, user.id, start);
  if (!cap.ok) throw err('CAP', 'יש לך כבר שלוש מילים על הכף בימים האלה', 409, { cap });
  const did = uid(); const end = addDays(start, ROUND_DAYS - 1);
  const { kid, stmts } = commitmentStmts(env, did, user, start, end);
  const batch = [S(env, `insert into word_definitions(id, kind, circle_id, owner_id, title, rule, icon, visibility, start_date, end_date, status) values (?,?,?,?,?,?,?,?,?,?,'active')`, did, 'personal', circleId, user.id, title, rule, icon(b.icon), vis, start, end), ...stmts];
  if (circleId && vis !== 'private') batch.push(eventStmt(env, circleId, user.id, 'word_committed', { defId: did, title }));
  batch.push(...grantStmts(env, user.id, 'first_word', did));
  await runBatch(env, batch);
  return { defId: did, commitmentId: kid };
}

export async function proposeGroupWord(env, user, b) {
  const c = await first(env, `select * from circles where id = ? and status = 'active'`, b.circleId);
  if (!c) throw err('NOT_FOUND', 'מעגל לא נמצא', 404);
  if (!(await isMember(env, c.id, user.id))) throw err('FORBIDDEN', 'את לא חברה במעגל הזה', 403);
  if (c.who_can_propose === 'admins' && !(await isAdmin(env, c.id, user.id))) throw err('FORBIDDEN', 'במעגל הזה רק מנהלות מציעות מילים', 403);
  const { title, rule } = validateWord(b.title, b.rule);
  const today = localDate(user.timezone);
  const start = isValidDate(b.startDate) ? b.startDate : today;
  if (start < today) throw err('VALIDATION', 'אי אפשר להציע מילה על ימים שעברו');
  const did = uid(); const vis = ['status', 'summary'].includes(b.visibility) ? b.visibility : 'status';
  const members = await all(env, `select user_id from circle_memberships where circle_id = ? and left_at is null and user_id <> ?`, c.id, user.id);
  const batch = [
    S(env, `insert into word_definitions(id, kind, circle_id, owner_id, title, rule, icon, visibility, start_date, end_date, status) values (?,?,?,?,?,?,?,?,?,?,'proposed')`, did, 'group', c.id, user.id, title, rule, icon(b.icon), vis, start, addDays(start, ROUND_DAYS - 1)),
    eventStmt(env, c.id, user.id, 'group_word_proposed', { defId: did, title }),
    ...members.map(m => notifyStmt(env, m.user_id, 'group_word', `יש לי מילה איתך · ${c.name}`, `${user.display_name} נתנה מילה: ${title}`, { defId: did, circleId: c.id }, today)),
  ];
  await runBatch(env, batch);
  return { defId: did };
}

export async function adoptGroupWord(env, user, b) {
  const d = await first(env, `select * from word_definitions where id = ? and kind = 'group'`, b.defId);
  if (!d) throw err('NOT_FOUND', 'מילה לא נמצאה', 404);
  if (!(await isMember(env, d.circle_id, user.id))) throw err('FORBIDDEN', 'את לא חברה במעגל הזה', 403);
  if (d.status === 'cancelled') throw err('VALIDATION', 'ההצעה בוטלה');
  const existing = await first(env, `select id from word_commitments where definition_id = ? and user_id = ? and status <> 'cancelled'`, d.id, user.id);
  if (existing) return { commitmentId: existing.id, duplicate: true };
  const today = localDate(user.timezone);
  const start = d.start_date > today ? d.start_date : today;
  if (start > d.end_date) throw err('VALIDATION', 'המילה הזו כבר הסתיימה. אפשר להציע אותה מחדש לסבב הבא.');
  const cap = await capInfo(env, user.id, start, diffDays(start, d.end_date) + 1);
  if (!cap.ok) throw err('CAP', 'יש לך כבר שלוש מילים על הכף בתאריכים האלה', 409, { cap });
  const { kid, stmts } = commitmentStmts(env, d.id, user, start, d.end_date);
  const batch = [...stmts, S(env, `update word_definitions set status = 'active' where id = ? and status = 'proposed'`, d.id), eventStmt(env, d.circle_id, user.id, 'group_word_adopted', { defId: d.id, title: d.title }), ...grantStmts(env, user.id, 'first_word', d.id), ...grantStmts(env, user.id, 'first_group_word', d.id)];
  try { await runBatch(env, batch); }
  catch (e) { if (e.code === 'CONFLICT') { const k = await first(env, `select id from word_commitments where definition_id = ? and user_id = ? and status <> 'cancelled'`, d.id, user.id); if (k) return { commitmentId: k.id, duplicate: true }; } throw e; }
  return { commitmentId: kid, duplicate: false };
}

export async function cancelProposal(env, user, b) {
  const d = await first(env, `select * from word_definitions where id = ?`, b.defId);
  if (!d) throw err('NOT_FOUND', 'לא נמצא', 404);
  if (d.owner_id !== user.id && !(await isAdmin(env, d.circle_id, user.id))) throw err('FORBIDDEN', 'אין הרשאה', 403);
  if (await first(env, `select 1 as x from word_commitments where definition_id = ? and status <> 'cancelled'`, d.id)) throw err('VALIDATION', 'כבר הצטרפו למילה. אפשר לסיים אותה רק דרך סיום מסודר.');
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
export async function setVisibility(env, user, b) {
  const d = await first(env, `select visibility from word_definitions where id = ? and owner_id = ?`, b.defId, user.id);
  if (!d) throw err('FORBIDDEN', 'אין הרשאה', 403);
  const ok = (d.visibility === 'status' && ['summary', 'private'].includes(b.visibility)) || (d.visibility === 'summary' && b.visibility === 'private');
  if (!ok) throw err('VALIDATION', 'אי אפשר להרחיב חשיפה בדיעבד');
  await S(env, `update word_definitions set visibility = ? where id = ?`, b.visibility, b.defId).run();
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
  if (d.circle_id && d.visibility === 'status' && reason === 'self_report') stmts.push(S(env, `insert into social_events(id, circle_id, actor_id, type, payload) select ?, ?, ?, ?, ? from daily_obligations where id = ? and resolved_at = ?`, uid(), d.circle_id, o.user_id, outcome === 'success' ? 'day_success' : outcome === 'miss' ? 'day_miss' : 'day_excused', JSON.stringify({ title: d.title, defId: d.id, date: o.local_date }), o.id, at));
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
  if (d.circle_id && d.visibility === 'status' && [3, 7, 14].includes(s)) stmts.push(eventStmt(env, d.circle_id, user.id, 'streak', { title: d.title, streak: s, defId: d.id }));
  await env.DB.batch(stmts);
}

export async function report(env, user, b) {
  const outcome = b.outcome;
  if (!['success', 'miss', 'excused'].includes(outcome)) throw err('VALIDATION', 'תוצאה לא תקינה');
  const o = await first(env, `select * from daily_obligations where id = ?`, b.obligationId);
  if (!o) throw err('NOT_FOUND', 'אירוע לא נמצא', 404);
  if (o.user_id !== user.id) throw err('FORBIDDEN', 'רק בעלת המילה יכולה לדווח', 403);
  if (o.status === 'cancelled') throw err('VALIDATION', 'האירוע בוטל');
  if (o.outcome) return { duplicate: true, outcome: o.outcome };
  const k = await first(env, `select * from word_commitments where id = ?`, o.commitment_id);
  const d = await first(env, `select * from word_definitions where id = ?`, k.definition_id);
  const w = windowOf(o.local_date, k.timezone); const now = new Date();
  if (now < w.opens) throw err('VALIDATION', 'עוד אי אפשר לדווח על יום שלא התחיל');
  if (now >= w.closes) throw err('VALIDATION', 'חלון הדיווח ליום הזה נסגר. אפשר לבקש תיקון.');
  if (outcome === 'excused') {
    const used = await first(env, `select count(*) as n from daily_obligations where commitment_id = ? and outcome = 'excused'`, k.id);
    if (used.n >= MAX_EXCUSES) throw err('VALIDATION', `כבר השתמשת ב-${MAX_EXCUSES} החרגות בסבב הזה`);
  }
  const at = nowISO();
  try { await runBatch(env, resolveStmts(env, o, d, outcome, 'self_report', user.id, at, b.note ? String(b.note).slice(0, 60) : null)); }
  catch (e) { if (e.code === 'CONFLICT') { const cur = await first(env, `select outcome from daily_obligations where id = ?`, o.id); return { duplicate: true, outcome: cur.outcome }; } throw e; }
  const after = await first(env, `select resolved_at, outcome from daily_obligations where id = ?`, o.id);
  if (after.resolved_at !== at) return { duplicate: true, outcome: after.outcome };   // מישהי הקדימה אותנו (בקשה מקבילה)
  if (outcome === 'success') await afterSuccess(env, user, o, d);
  return { duplicate: false, outcome };
}

export async function correct(env, user, b) {
  const outcome = b.outcome; const reason = String(b.reason || '').trim();
  if (!['success', 'miss', 'excused'].includes(outcome)) throw err('VALIDATION', 'תוצאה לא תקינה');
  if (!reason) throw err('VALIDATION', 'צריך סיבה קצרה לתיקון');
  const o = await first(env, `select * from daily_obligations where id = ?`, b.obligationId);
  if (!o || o.user_id !== user.id) throw err('FORBIDDEN', 'אין הרשאה', 403);
  if (!o.outcome) throw err('VALIDATION', 'אין עדיין הכרעה לתקן');
  if (Date.now() - Date.parse(o.resolved_at) >= CORRECTION_MS) throw err('VALIDATION', 'חלון התיקון (24 שעות) נסגר');
  if (o.outcome === outcome) return { changed: false };
  const k = await first(env, `select * from word_commitments where id = ?`, o.commitment_id);
  const d = await first(env, `select * from word_definitions where id = ?`, k.definition_id);
  if (outcome === 'excused') {
    const used = await first(env, `select count(*) as n from daily_obligations where commitment_id = ? and outcome = 'excused'`, k.id);
    if (used.n >= MAX_EXCUSES) throw err('VALIDATION', `כבר השתמשת ב-${MAX_EXCUSES} החרגות בסבב הזה`);
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
  if (after.resolved_at !== at) throw err('CONFLICT', 'ההכרעה השתנתה בינתיים. רענני ונסי שוב.', 409);
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
  if (stmts.length) await runBatch(env, stmts);
  // סיום התחייבויות שכל ימיהן הוכרעו
  const done = await all(env, `select k.id from word_commitments k where k.user_id = ? and k.status = 'active' and k.end_date < ? and not exists (select 1 from daily_obligations o where o.commitment_id = k.id and o.outcome is null and o.status <> 'cancelled')`, user.id, localDate(user.timezone));
  if (done.length) {
    const completedBefore = (await first(env, `select count(*) as n from word_commitments where user_id = ? and status = 'completed'`, user.id)).n;
    const s2 = [];
    done.forEach((k, i) => { s2.push(S(env, `update word_commitments set status = 'completed', completed_at = ? where id = ?`, nowISO(), k.id)); s2.push(...grantStmts(env, user.id, 'round_complete', k.id)); if (completedBefore + i + 1 >= 2) s2.push(...grantStmts(env, user.id, 'second_round', k.id)); });
    await env.DB.batch(s2);
  }
}

/* ---------- מעגלים ---------- */
async function newInviteStmt(env, circleId, userId) {
  const tok = inviteCode();
  return { tok, stmt: S(env, `insert into circle_invites(token_hash, token_hint, circle_id, inviter_id, expires_at, max_uses) values (?,?,?,?,?,20)`, await sha256hex(tok), tok.slice(0, 2), circleId, userId, new Date(Date.now() + 7 * 86400000).toISOString()) };
}
export async function createCircle(env, user, b) {
  const name = String(b.name || '').trim(); if (!name) throw err('VALIDATION', 'שם המעגל לא יכול להיות ריק'); if (name.length > 50) throw err('VALIDATION', 'שם המעגל ארוך מדי (עד 50 תווים)');
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
  if (!(await isAdmin(env, b.circleId, user.id))) throw err('FORBIDDEN', 'רק מנהלת המעגל יכולה לשנות את פרטיו', 403);
  const p = b.patch || {};
  const c = await first(env, `select * from circles where id = ?`, b.circleId);
  const name = p.name !== undefined ? String(p.name).trim() : c.name; if (!name || name.length > 50) throw err('VALIDATION', 'שם לא תקין');
  await S(env, `update circles set name = ?, description = ?, color = ?, who_can_propose = ?, max_members = ? where id = ?`, name, p.description !== undefined ? String(p.description).slice(0, 120) : c.description, COLORS.has(p.color) ? p.color : c.color, p.whoCanPropose === 'admins' || p.whoCanPropose === 'all' ? p.whoCanPropose : c.who_can_propose, p.maxMembers ? Math.min(50, Math.max(2, Number(p.maxMembers))) : c.max_members, c.id).run();
}
export async function createInvite(env, user, b) {
  if (!(await isMember(env, b.circleId, user.id))) throw err('FORBIDDEN', 'אין הרשאה', 403);
  const inv = await newInviteStmt(env, b.circleId, user.id); await inv.stmt.run(); return { token: inv.tok };
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
  return { ok: true, inv: { token, expiresAt: inv.expires_at, uses: inv.uses, maxUses: inv.max_uses }, circle: { id: c.id, name: c.name, description: c.description, color: c.color }, inviter: { id: inviter.id, name: inviter.display_name, color: inviter.color }, memberCount: members, maxMembers: c.max_members, alreadyMember: await isMember(env, c.id, user.id), sampleWord: sample ? { title: sample.title } : null, round: { index: i + 1, start: rs, end: addDays(rs, 13), dayIndex: Math.min(Math.max(diffDays(rs, today) + 1, 0), 14), nextStart: addDays(rs, 14) } };
}
export async function acceptInvite(env, user, b) {
  const p = await previewInvite(env, user, b);
  if (!p.ok) throw err('INVITE_INVALID', { not_found: 'הקישור לא נמצא. אולי הוקלד לא נכון?', revoked: 'הקישור בוטל על ידי המעגל. אפשר לבקש קישור חדש.', expired: 'תוקף הקישור פג. אפשר לבקש הזמנה חדשה.', full: 'הקישור הזה כבר נוצל במלואו.' }[p.reason]);
  const cid = p.circle.id;
  if (p.alreadyMember) return { circleId: cid };
  if (p.memberCount >= p.maxMembers) throw err('CIRCLE_FULL', 'המעגל מלא. אפשר לבקש ממנהלת המעגל להגדיל את מספר המקומות.', 409);
  const hash = await sha256hex(p.inv.token);
  try {
    await runBatch(env, [
      // ההצטרפות מותנית בכך שהמעגל עדיין לא מלא (בקשות מקבילות)
      S(env, `insert into circle_memberships(id, circle_id, user_id, role) select ?, ?, ?, 'member' where (select count(*) from circle_memberships where circle_id = ? and left_at is null) < ?`, uid(), cid, user.id, cid, p.maxMembers),
      S(env, `update circle_invites set uses = uses + 1 where token_hash = ?`, hash),
      eventStmt(env, cid, user.id, 'member_joined', {}), ...grantStmts(env, user.id, 'first_circle', cid),
    ]);
  } catch (e) { if (e.code !== 'CONFLICT') throw e; }
  if (!(await isMember(env, cid, user.id))) throw err('CIRCLE_FULL', 'המעגל התמלא בדיוק עכשיו.', 409);
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
  if (!(await isAdmin(env, b.circleId, user.id))) throw err('FORBIDDEN', 'רק מנהלת המעגל יכולה להסיר חברות', 403);
  if (b.userId === user.id) throw err('VALIDATION', 'כדי לצאת בעצמך השתמשי ב״לעזוב את המעגל״');
  await env.DB.batch([S(env, `update circle_memberships set left_at = ?, removed_by = ? where circle_id = ? and user_id = ? and left_at is null`, nowISO(), user.id, b.circleId, b.userId), eventStmt(env, b.circleId, user.id, 'member_removed', { userId: b.userId })]);
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
  const cur = JSON.parse(user.settings || '{}'); for (const k of allowed) if (b.patch && k in b.patch) cur[k] = b.patch[k];
  await S(env, `update users set settings = ? where id = ?`, JSON.stringify(cur), user.id).run();
}
export async function rename(env, user, b) { const n = String(b.name || '').trim(); if (!n || n.length > 30) throw err('VALIDATION', 'שם לא תקין'); await S(env, `update users set display_name = ? where id = ?`, n, user.id).run(); }
export async function deleteAccount(env, user) {
  for (const cid of await myCircleIds(env, user.id)) await leaveCircle(env, user, { circleId: cid });
  // הפרופיל הופך לאנונימי; התנועות ההיסטוריות נשארות לתקינות קופות המעגלים
  await env.DB.batch([
    S(env, `update users set display_name = 'משתתפת שעזבה', email = null, google_sub = null, color = 'sky', status = 'deleted', settings = '{}' where id = ?`, user.id),
    S(env, `delete from sessions where user_id = ?`, user.id), S(env, `delete from notifications where user_id = ?`, user.id), S(env, `delete from user_blocks where blocker_id = ?`, user.id),
  ]);
}
export async function exportData(env, user) {
  const [commitments, obligations, ledger, achievements] = await Promise.all([
    all(env, `select * from word_commitments where user_id = ?`, user.id), all(env, `select * from daily_obligations where user_id = ?`, user.id),
    all(env, `select * from virtual_ledger where user_id = ?`, user.id), all(env, `select * from achievements where user_id = ?`, user.id)]);
  return { user: { id: user.id, name: user.display_name, email: user.email, timezone: user.timezone, createdAt: user.created_at }, commitments, obligations, ledger, achievements };
}
