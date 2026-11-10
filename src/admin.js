/* פאנל ניהול: סטטיסטיקה מצטברת למנהלת המערכת בלבד (users.is_admin = 1).
   נקרא לעיתים רחוקות, לכן מותר לו לקרוא יותר שורות מהמסכים הרגילים. אין כאן אימיילים. */
import './../public/js/library.js';
import { localDate, addDays } from './util.js';
const Lib = globalThis.MilaLibrary;

export async function adminStats(env) {
  const one = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
  const many = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results || [];
  const now = Date.now(); const ago = (d) => new Date(now - d * 86400000).toISOString();
  const today = localDate('Asia/Jerusalem'); const d7 = addDays(today, -6), d14 = addDays(today, -13), d30 = addDays(today, -29);

  const [users, act, groups, ch, rep, inv, ledger] = await Promise.all([
    one(`select sum(status = 'active') as active, sum(status not in ('active','deleted')) as pending, sum(status = 'deleted') as deleted,
           sum(status = 'active' and created_at >= ?) as new1, sum(status = 'active' and created_at >= ?) as new7, sum(status = 'active' and created_at >= ?) as new30,
           sum(invited_by is not null and status = 'active') as viaInvite from users`, ago(1), ago(7), ago(30)),
    one(`select (select count(*) from user_days where day = ?) as dau, (select count(distinct user_id) from user_days where day >= ?) as wau, (select count(distinct user_id) from user_days where day >= ?) as mau`, today, d7, d30),
    one(`select (select count(*) from circles where status = 'active') as active, (select count(*) from circles where created_at >= ?) as new7,
           (select count(*) from circles where status = 'archived') as closed, (select count(*) from circle_memberships m join circles c on c.id = m.circle_id where m.left_at is null and c.status = 'active') as memberships`, ago(7)),
    one(`select sum(status = 'active') as active, sum(created_at >= ?) as new7, sum(status = 'completed') as completed, count(*) as total from word_commitments`, ago(7)),
    one(`select sum(created_at >= ?) as r1, sum(created_at >= ?) as r7 from resolution_history where reason = 'self_report' and created_at >= ?`, ago(1), ago(7), ago(7)),
    one(`select (select count(*) from circle_invites) as created, (select count(*) from circle_invites where created_at >= ?) as created7,
           (select count(*) from invite_opens) as opens, (select count(*) from invite_opens where created_at >= ?) as opens7,
           (select count(*) from users where invited_by is not null and status = 'active') as signups, (select count(*) from circle_memberships where via_invite is not null) as joins`, ago(7), ago(7)),
    one(`select sum(transaction_type = 'EARN') as earn, sum(transaction_type in ('MISS_TO_CIRCLE','MISS_PERSONAL')) as miss from virtual_ledger where local_date >= ?`, d7),
  ]);

  // סדרות ל-14 יום
  const days = Array.from({ length: 14 }, (_, i) => addDays(d14, i));
  const toMap = (rows) => Object.fromEntries(rows.map(r => [r.d, r.n]));
  const [sSign, sAct, sRep, sGroups, sOpens] = await Promise.all([
    many(`select substr(created_at, 1, 10) as d, count(*) as n from users where created_at >= ? and status <> 'deleted' group by d`, ago(15)),
    many(`select day as d, count(*) as n from user_days where day >= ? group by day`, d14),
    many(`select substr(created_at, 1, 10) as d, count(*) as n from resolution_history where reason = 'self_report' and created_at >= ? group by d`, ago(15)),
    many(`select substr(created_at, 1, 10) as d, count(*) as n from circles where created_at >= ? group by d`, ago(15)),
    many(`select substr(created_at, 1, 10) as d, count(*) as n from invite_opens where created_at >= ? group by d`, ago(15)),
  ]);
  const series = { days, signups: toMap(sSign), active: toMap(sAct), reports: toMap(sRep), groups: toMap(sGroups), opens: toMap(sOpens) };

  // מי הביאה את מי: כמה בנות נחשפו (פתחו קישור), נרשמו והצטרפו דרך כל מזמינה
  const referrers = await many(`select u.id, u.display_name as name,
      (select count(*) from circle_invites i where i.inviter_id = u.id) as invites,
      (select count(*) from invite_opens o where o.inviter_id = u.id) as opens,
      (select count(*) from users x where x.invited_by = u.id and x.status = 'active') as signups,
      (select count(*) from circle_memberships m where m.via_invite in (select token_hash from circle_invites i where i.inviter_id = u.id)) as joins
    from users u where u.id in (select inviter_id from circle_invites) and u.status <> 'deleted'
    order by opens desc, signups desc, invites desc limit 60`);
  const activeRefs = referrers.filter(r => r.opens + r.signups + r.joins > 0).slice(0, 15);
  const kinds = await many(`select coalesce(kind, 'follow') as kind, count(*) as n from invite_opens group by kind`);

  // אתגרים: הכי פופולריים מהספרייה, קטגוריות, ואתגרים אישיים
  const topCh = await many(`select d.library_id as id, count(*) as n, sum(k.status = 'active') as active from word_commitments k join word_definitions d on d.id = k.definition_id where d.library_id is not null and k.status <> 'cancelled' group by d.library_id order by n desc limit 10`);
  const cats = await many(`select coalesce(d.category, 'custom') as cat, count(*) as n from word_commitments k join word_definitions d on d.id = k.definition_id where k.status <> 'cancelled' group by cat order by n desc`);
  // קבוצות: הגדולות, והתפלגות גודל
  const topGroups = await many(`select c.id, c.name, substr(c.created_at, 1, 10) as created, (select count(*) from circle_memberships m where m.circle_id = c.id and m.left_at is null) as members,
      (select count(*) from word_commitments k join word_definitions d on d.id = k.definition_id where d.circle_id = c.id and k.status = 'active') as challenges
    from circles c where c.status = 'active' order by members desc, challenges desc limit 15`);
  const sizes = await many(`select n as size, count(*) as groups from (select count(*) as n from circle_memberships m join circles c on c.id = m.circle_id where m.left_at is null and c.status = 'active' group by m.circle_id) group by n order by n`);
  // שימור: מי שנרשמה לפני 7–14 יום וחזרה בשבוע האחרון
  const ret = await one(`select count(*) as cohort, sum(exists(select 1 from user_days d where d.user_id = u.id and d.day >= ?)) as back from users u where u.status = 'active' and u.created_at >= ? and u.created_at < ?`, d7, ago(14), ago(7));
  const reports7 = await one(`select count(*) as n from abuse_reports where created_at >= ?`, ago(7));

  return {
    generatedAt: new Date().toISOString(),
    users, activity: act, groups: { ...groups, avgSize: groups.active ? +(groups.memberships / groups.active).toFixed(1) : 0 }, challenges: ch, reports: rep,
    successRate7: ledger.earn + ledger.miss ? Math.round((100 * ledger.earn) / (ledger.earn + ledger.miss)) : null,
    invites: inv, inviteKinds: kinds, referrers: activeRefs, invitersTotal: referrers.length, series,
    topChallenges: topCh.map(r => ({ ...r, title: (Lib.get(r.id) || {}).title || r.id })),
    categories: cats.map(r => ({ ...r, name: r.cat === 'custom' ? 'אתגר אישי' : ((Lib.category(r.cat) || {}).name || r.cat) })),
    topGroups, groupSizes: sizes, retention: ret, abuseReports7: reports7.n,
  };
}
