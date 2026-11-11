/* בניית מצב המשתמשת: רק מה שמותר לה לראות.
   הפלט באותו מבנה שהמנוע בדפדפן (engine.js) משתמש בו לקריאה, כך שהתצוגות לא השתנו. */
import { nowISO, localDate, addDays } from './util.js';
import { settle, myCircleIds } from './game.js';

const q = async (env, sql, binds) => (await env.DB.prepare(sql).bind(...binds).all()).results || [];
const ph = (arr) => arr.map(() => '?').join(',');
/* D1 מגביל ל-100 פרמטרים בשאילתה: רשימות IN ארוכות נשלחות במנות */
const CHUNK = 60;
async function qIn(env, ids, sqlOf, bindsOf = (part) => part) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) { const part = ids.slice(i, i + CHUNK); out.push(...await q(env, sqlOf(ph(part)), bindsOf(part))); }
  return out;
}

export async function myState(env, user) {
  await settle(env, user);
  const circleIds = (await myCircleIds(env, user.id)).slice(0, 25);
  const cids = circleIds.length ? circleIds : ['__none__'];
  const P = ph(cids);
  // חלונות זמן: מצב קל לטעינה גם כשיש הרבה היסטוריה (חברות: 30 יום אחורה, שלי: 90)
  const today = localDate(user.timezone);
  const since30 = addDays(today, -30), since90 = addDays(today, -90);
  const evSince = new Date(Date.now() - 21 * 86400000).toISOString();
  const [memberships, circles, defs, invites, events, achievements, notifications, blocks, myHistory] = await Promise.all([
    q(env, `select * from circle_memberships where circle_id in (${P})`, cids),
    q(env, `select * from circles where id in (${P})`, cids),
    q(env, `select * from word_definitions where (owner_id = ? and (end_date is null or end_date >= ?)) or (circle_id in (${P}) and status <> 'cancelled' and (kind = 'group' or visibility <> 'private') and (end_date is null or end_date >= ?))`, [user.id, since90, ...cids, since30]),
    q(env, `select token_hint, circle_id, inviter_id, created_at, expires_at, status, uses, max_uses, kind from circle_invites where circle_id in (${P}) and status = 'active' and expires_at > ?`, [...cids, nowISO()]),
    q(env, `select * from social_events where circle_id in (${P}) and created_at > ? order by created_at desc limit 120`, [...cids, evSince]),
    q(env, `select * from achievements where user_id = ?`, [user.id]),
    q(env, `select * from notifications where user_id = ? order by created_at desc limit 40`, [user.id]),
    q(env, `select * from user_blocks where blocker_id = ?`, [user.id]),
    q(env, `select h.* from resolution_history h join daily_obligations o on o.id = h.obligation_id where o.user_id = ? and o.local_date >= ?`, [user.id, since30]),
  ]);
  const defIds = defs.map(d => d.id);
  // של אחרות: רק בקבוצות שאני חברה בהן עכשיו (גם אם אני זו שפתחה את האתגר ועזבתי)
  const commitments = await qIn(env, defIds, (DP) => `select k.* from word_commitments k join word_definitions d on d.id = k.definition_id where k.definition_id in (${DP}) and ((k.user_id = ? and (k.status = 'active' or k.end_date >= ?)) or (d.circle_id in (${P}) and k.status <> 'cancelled' and d.visibility <> 'private' and (k.status = 'active' or k.end_date >= ?)))`, (part) => [...part, user.id, since90, ...cids, since30]);
  const [obligations, ledger, encouragements] = await Promise.all([
    loadObligations(env, commitments, user.id, today),
    q(env, `select * from virtual_ledger where user_id = ? order by created_at`, [user.id]),
    qIn(env, events.map(e => e.id), (EP) => `select * from encouragements where event_id in (${EP})`),
  ]);
  // פרופילים: אני + חברות המעגלים + מי שמופיעה באירועים
  const uids = new Set([user.id, ...memberships.map(m => m.user_id), ...events.map(e => e.actor_id)]);
  const users = await qIn(env, [...uids], (UP) => `select id, display_name, color, status, settings, timezone, created_at, age_confirmed, email from users where id in (${UP})`);

  const settingsOf = (u) => { const s = safe(u.settings); return u.id === user.id ? s : { hideFromLeaderboard: !!s.hideFromLeaderboard }; };
  return {
    me: user.id, serverNow: nowISO(),
    users: obj(users, u => [u.id, { id: u.id, name: u.display_name, color: u.color, deleted: u.status === 'deleted', settings: settingsOf(u), timezone: u.id === user.id ? u.timezone : null, email: u.id === user.id ? u.email : null, createdAt: u.id === user.id ? u.created_at : null, ageConfirmed: u.id === user.id ? !!u.age_confirmed : true }]),
    circles: obj(circles, c => [c.id, { id: c.id, name: c.name, description: c.description, ownerId: c.owner_id, color: c.color, whoCanPropose: c.who_can_propose, maxMembers: c.max_members, roundStart: c.round_start, status: c.status, createdAt: c.created_at }]),
    memberships: memberships.map(m => ({ id: m.id, circleId: m.circle_id, userId: m.user_id, role: m.role, joinedAt: m.joined_at, leftAt: m.left_at })),
    invites: obj(invites, (i, idx) => [`inv_${idx}`, { hint: i.token_hint, circleId: i.circle_id, inviterId: i.inviter_id, createdAt: i.created_at, expiresAt: i.expires_at, status: i.status, uses: i.uses, maxUses: i.max_uses, kind: i.kind || 'follow' }]),
    wordDefs: obj(defs, d => [d.id, { id: d.id, kind: d.kind, circleId: d.circle_id, ownerId: d.owner_id, title: d.title, rule: d.rule, icon: d.icon, libraryId: d.library_id || null, category: d.category || null, visibility: d.visibility, version: d.version, startDate: d.start_date, endDate: d.end_date, status: d.status, createdAt: d.created_at }]),
    commitments: obj(commitments, k => [k.id, { id: k.id, defId: k.definition_id, userId: k.user_id, startDate: k.start_date, endDate: k.end_date, status: k.status, endReason: k.user_id === user.id ? k.end_reason : null, reward: (k.user_id === user.id || k.reward_shared) ? (k.reward || '') : '', rewardShared: !!k.reward_shared, summarySeen: !!k.summary_seen, createdAt: k.created_at, completedAt: k.completed_at, timezone: k.user_id === user.id ? k.timezone : null }]),
    obligations: obj(obligations, o => [o.id, { id: o.id, commitmentId: o.commitment_id, userId: o.user_id, localDate: o.local_date, status: o.status, outcome: o.outcome, resolveReason: o.user_id === user.id ? o.resolve_reason : null, resolvedAt: o.resolved_at, correctedAt: o.corrected_at, note: o.user_id === user.id ? o.note : null }]),
    ledger: ledger.map(l => ({ id: l.id, obligationId: l.obligation_id, userId: l.user_id, defId: l.definition_id, circleId: l.circle_id, type: l.transaction_type, amount: l.amount, reversalOf: l.reversal_of, localDate: l.local_date, createdAt: l.created_at })),
    resolutionHistory: myHistory.map(h => ({ id: h.id, obligationId: h.obligation_id, from: h.from_state, to: h.to_state, reason: h.reason, actorId: h.actor_id, at: h.created_at })),
    achievements: achievements.map(a => ({ id: a.id, userId: a.user_id, type: a.type, earnedAt: a.earned_at, sourceRef: a.source_ref })),
    socialEvents: events.map(e => ({ id: e.id, circleId: e.circle_id, actorId: e.actor_id, type: e.type, payload: safe(e.payload), createdAt: e.created_at })),
    encouragements: encouragements.map(r => ({ id: r.id, eventId: r.event_id, userId: r.user_id, reaction: r.reaction, createdAt: r.created_at })),
    blocks: blocks.map(b => ({ blockerId: b.blocker_id, blockedId: b.blocked_id, at: b.created_at })),
    notifications: notifications.map(n => ({ id: n.id, userId: n.user_id, type: n.type, title: n.title, body: n.body, ref: safe(n.ref), read: !!n.read, createdAt: n.created_at })),
  };
}
/* שלי: כל 14 הימים (לרשת הימים). של חברות: רק עד היום (לדירוג ולמצב) – ימים עתידיים לא נטענים */
async function loadObligations(env, commitments, myId, today) {
  const mine = commitments.filter(k => k.user_id === myId).map(k => k.id);
  const others = commitments.filter(k => k.user_id !== myId).map(k => k.id);
  const [a, b] = await Promise.all([
    qIn(env, mine, (MP) => `select * from daily_obligations where commitment_id in (${MP})`),
    qIn(env, others, (OP) => `select * from daily_obligations where commitment_id in (${OP}) and local_date <= ?`, (part) => [...part, today]),
  ]);
  return [...a, ...b];
}
function obj(rows, fn) { const o = {}; rows.forEach((r, i) => { const [k, v] = fn(r, i); o[k] = v; }); return o; }
function safe(s) { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }
