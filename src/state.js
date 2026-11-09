/* בניית מצב המשתמשת: רק מה שמותר לה לראות.
   הפלט באותו מבנה שהמנוע בדפדפן (engine.js) משתמש בו לקריאה, כך שהתצוגות לא השתנו. */
import { nowISO } from './util.js';
import { settle, myCircleIds } from './game.js';

const q = async (env, sql, binds) => (await env.DB.prepare(sql).bind(...binds).all()).results || [];
const ph = (arr) => arr.map(() => '?').join(',');

export async function myState(env, user) {
  await settle(env, user);
  const circleIds = await myCircleIds(env, user.id);
  const cids = circleIds.length ? circleIds : ['__none__'];
  const P = ph(cids);
  const [memberships, circles, defs, invites, events, achievements, notifications, blocks, myHistory] = await Promise.all([
    q(env, `select * from circle_memberships where circle_id in (${P})`, cids),
    q(env, `select * from circles where id in (${P})`, cids),
    q(env, `select * from word_definitions where owner_id = ? or (circle_id in (${P}) and status <> 'cancelled' and (kind = 'group' or visibility <> 'private'))`, [user.id, ...cids]),
    q(env, `select token_hint, circle_id, inviter_id, created_at, expires_at, status, uses, max_uses from circle_invites where circle_id in (${P}) and status = 'active' and expires_at > ?`, [...cids, nowISO()]),
    q(env, `select * from social_events where circle_id in (${P}) order by created_at desc limit 300`, cids),
    q(env, `select * from achievements where user_id = ?`, [user.id]),
    q(env, `select * from notifications where user_id = ? order by created_at desc limit 100`, [user.id]),
    q(env, `select * from user_blocks where blocker_id = ?`, [user.id]),
    q(env, `select h.* from resolution_history h join daily_obligations o on o.id = h.obligation_id where o.user_id = ?`, [user.id]),
  ]);
  const defIds = defs.map(d => d.id); const DP = ph(defIds.length ? defIds : ['__none__']);
  const commitments = await q(env, `select k.* from word_commitments k join word_definitions d on d.id = k.definition_id where k.definition_id in (${DP}) and (k.user_id = ? or (d.circle_id is not null and k.status <> 'cancelled' and d.visibility <> 'private'))`, [...(defIds.length ? defIds : ['__none__']), user.id]);
  const kIds = commitments.map(k => k.id); const KP = ph(kIds.length ? kIds : ['__none__']);
  const [obligations, ledger, encouragements] = await Promise.all([
    q(env, `select * from daily_obligations where commitment_id in (${KP})`, kIds.length ? kIds : ['__none__']),
    q(env, `select * from virtual_ledger where user_id = ? or (circle_id in (${P}) and transaction_type in ('MISS_TO_CIRCLE','REVERSE')) order by created_at`, [user.id, ...cids]),
    events.length ? q(env, `select * from encouragements where event_id in (${ph(events)})`, events.map(e => e.id)) : [],
  ]);
  // פרופילים: אני + חברות המעגלים + מי שמופיעה באירועים
  const uids = new Set([user.id, ...memberships.map(m => m.user_id), ...events.map(e => e.actor_id)]);
  const users = await q(env, `select id, display_name, color, status, settings, timezone, created_at, age_confirmed, email from users where id in (${ph([...uids])})`, [...uids]);

  const settingsOf = (u) => { const s = safe(u.settings); return u.id === user.id ? s : { hideFromLeaderboard: !!s.hideFromLeaderboard }; };
  return {
    me: user.id, serverNow: nowISO(),
    users: obj(users, u => [u.id, { id: u.id, name: u.display_name, color: u.color, deleted: u.status === 'deleted', settings: settingsOf(u), timezone: u.id === user.id ? u.timezone : null, email: u.id === user.id ? u.email : null, createdAt: u.created_at, ageConfirmed: !!u.age_confirmed }]),
    circles: obj(circles, c => [c.id, { id: c.id, name: c.name, description: c.description, ownerId: c.owner_id, color: c.color, whoCanPropose: c.who_can_propose, maxMembers: c.max_members, roundStart: c.round_start, status: c.status, createdAt: c.created_at }]),
    memberships: memberships.map(m => ({ id: m.id, circleId: m.circle_id, userId: m.user_id, role: m.role, joinedAt: m.joined_at, leftAt: m.left_at })),
    invites: obj(invites, (i, idx) => [`inv_${idx}`, { hint: i.token_hint, circleId: i.circle_id, inviterId: i.inviter_id, createdAt: i.created_at, expiresAt: i.expires_at, status: i.status, uses: i.uses, maxUses: i.max_uses }]),
    wordDefs: obj(defs, d => [d.id, { id: d.id, kind: d.kind, circleId: d.circle_id, ownerId: d.owner_id, title: d.title, rule: d.rule, icon: d.icon, visibility: d.visibility, version: d.version, startDate: d.start_date, endDate: d.end_date, status: d.status, createdAt: d.created_at }]),
    commitments: obj(commitments, k => [k.id, { id: k.id, defId: k.definition_id, userId: k.user_id, startDate: k.start_date, endDate: k.end_date, status: k.status, endReason: k.end_reason, summarySeen: !!k.summary_seen, createdAt: k.created_at, completedAt: k.completed_at, timezone: k.timezone }]),
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
function obj(rows, fn) { const o = {}; rows.forEach((r, i) => { const [k, v] = fn(r, i); o[k] = v; }); return o; }
function safe(s) { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }
