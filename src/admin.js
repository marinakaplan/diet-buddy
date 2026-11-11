/* אנליטיקה למנהלת המערכת (users.is_admin = 1). נתונים מצטברים בלבד, בלי אימיילים.
   טווח: 7/30/90 יום, עם השוואה לתקופה הקודמת באותו אורך. ימים לפי שעון ישראל.
   נקרא לעיתים רחוקות, לכן מותר לו לקרוא יותר שורות מהמסכים הרגילים. */
import './../public/js/library.js';
import { localDate, addDays, diffDays } from './util.js';
const Lib = globalThis.MilaLibrary;

/* היסט שעון ישראל כרגע (+2/+3), לשאילתות שמקבצות לפי יום/שעה */
function ilOffsetHours(at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(at).map(x => [x.type, x.value]));
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24);
  return Math.round((local - Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), at.getUTCHours())) / 3600000);
}
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);

export async function adminStats(env, daysParam) {
  const days = [7, 30, 90].includes(Number(daysParam)) ? Number(daysParam) : 30;
  const one = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
  const many = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results || [];
  const off = ilOffsetHours(); const OFF = `${off >= 0 ? '+' : ''}${off} hours`;
  const ilDay = (col) => `substr(datetime(${col}, '${OFF}'), 1, 10)`;   // יום בשעון ישראל מתוך חותמת UTC
  const today = localDate('Asia/Jerusalem');
  const start = addDays(today, -(days - 1)), prevStart = addDays(start, -days), prevEnd = addDays(start, -1);
  const range = { days, start, end: today, prevStart, prevEnd };
  const dayList = Array.from({ length: days }, (_, i) => addDays(start, i));
  const map = (rows) => Object.fromEntries(rows.map(r => [r.d, Number(r.n)]));
  const inRange = (col) => `${ilDay(col)} between ? and ?`;

  // ---------- סדרות יומיות (התקופה + הקודמת, לשם ההשוואה) ----------
  const S = prevStart;
  const [sVisits, sSignups, sActive, sReports, sInvites, sOpens, sGroups, sViaInv, sEarn, sAuto] = await Promise.all([
    many(`select day as d, count(*) as n from track_events where name = 'visit' and day between ? and ? group by day`, S, today),
    many(`select ${ilDay('created_at')} as d, count(*) as n from users where status <> 'deleted' and ${inRange('created_at')} group by d`, S, today),
    many(`select day as d, count(*) as n from user_days where day between ? and ? group by day`, S, today),
    many(`select ${ilDay('created_at')} as d, count(*) as n from resolution_history where reason = 'self_report' and ${inRange('created_at')} group by d`, S, today),
    many(`select ${ilDay('created_at')} as d, count(*) as n from circle_invites where kind <> 'friends' and ${inRange('created_at')} group by d`, S, today),   // קישורי הזמנה בלבד; הזמנות בתוך האפליקציה נספרות בנפרד
    many(`select ${ilDay('created_at')} as d, count(*) as n from invite_opens where ${inRange('created_at')} group by d`, S, today),
    many(`select ${ilDay('created_at')} as d, count(*) as n from circles where ${inRange('created_at')} group by d`, S, today),
    many(`select ${ilDay('created_at')} as d, count(*) as n from users where status = 'active' and invited_by is not null and ${inRange('created_at')} group by d`, S, today),
    many(`select local_date as d, sum(transaction_type = 'EARN') as n, sum(transaction_type in ('MISS_TO_CIRCLE','MISS_PERSONAL')) as m from virtual_ledger where local_date between ? and ? group by local_date`, S, today),
    // ימים שנסגרו אוטומטית כפספוס כי לא דווחו עד 10:00 למחרת (לפי היום של האתגר)
    many(`select local_date as d, count(*) as n from daily_obligations where resolve_reason = 'auto_unreported' and local_date between ? and ? group by local_date`, S, today),
  ]);
  const series = { days: dayList, visits: map(sVisits), signups: map(sSignups), active: map(sActive), reports: map(sReports), invites: map(sInvites), opens: map(sOpens), groups: map(sGroups), autoClosed: map(sAuto) };
  const sum = (m, a, b) => Object.entries(m).filter(([d]) => d >= a && d <= b).reduce((t, [, v]) => t + v, 0);
  const viaM = map(sViaInv);
  const earnM = Object.fromEntries(sEarn.map(r => [r.d, Number(r.n)])), missM = Object.fromEntries(sEarn.map(r => [r.d, Number(r.m)]));
  const succ = (a, b) => { const e = sum(earnM, a, b), m = sum(missM, a, b); return e + m ? Math.round((100 * e) / (e + m)) : null; };
  const both = (m) => ({ cur: sum(m, start, today), prev: sum(m, prevStart, prevEnd) });

  // ---------- ריכוז (KPI) ----------
  const [tot, act] = await Promise.all([
    one(`select sum(status = 'active') as users, sum(status not in ('active','deleted')) as pending, sum(status = 'deleted') as deleted,
           (select count(*) from circles where status = 'active') as groups, (select count(*) from word_commitments where status = 'active') as challenges from users`),
    one(`select (select count(*) from user_days where day = ?) as dau, (select count(distinct user_id) from user_days where day >= ?) as wau,
           (select count(distinct user_id) from user_days where day >= ?) as mau`, today, addDays(today, -6), addDays(today, -29)),
  ]);
  const activeAvg = (a, b) => { const n = diffDays(a, b) + 1; return n ? Math.round((10 * sum(series.active, a, b)) / n) / 10 : 0; };
  const kpi = {
    users: tot.users || 0, pending: tot.pending || 0, deleted: tot.deleted || 0, groupsActive: tot.groups || 0, challengesActive: tot.challenges || 0,
    dau: act.dau || 0, wau: act.wau || 0, mau: act.mau || 0, stickiness: act.mau ? Math.round((100 * act.dau) / act.mau) : null,
    signups: both(series.signups), viaInvite: both(viaM), reports: both(series.reports), invites: both(series.invites), opens: both(series.opens), groups: both(series.groups), visits: both(series.visits),
    activeAvg: { cur: activeAvg(start, today), prev: activeAvg(prevStart, prevEnd) },
    success: { cur: succ(start, today), prev: succ(prevStart, prevEnd) },
    autoClosed: both(series.autoClosed),
  };
  // אחוז דיווח: מתוך הימים שהוכרעו בתקופה, כמה דווחו על ידי המשתמשת עצמה (ולא נסגרו לבד)
  const repRate = (r, a) => (r + a ? Math.round((100 * r) / (r + a)) : null);
  kpi.reportRate = { cur: repRate(kpi.reports.cur, kpi.autoClosed.cur), prev: repRate(kpi.reports.prev, kpi.autoClosed.prev) };

  // ---------- משפך: מכניסה לאתר ועד דיווח וקבוצה (בנות שנרשמו בתקופה) ----------
  const f = await one(`select count(*) as signed,
      sum(u.status = 'active') as profile,
      sum(exists(select 1 from word_commitments k where k.user_id = u.id)) as chose,
      sum(exists(select 1 from daily_obligations o where o.user_id = u.id and o.resolve_reason = 'self_report')) as reported,
      sum(exists(select 1 from circle_memberships m where m.user_id = u.id)) as grouped,
      sum(u.invited_by is not null and u.status = 'active') as invited
    from users u where u.status <> 'deleted' and ${inRange('u.created_at')}`, start, today);
  const [vis, clicks] = await Promise.all([
    one(`select count(distinct visitor_id) as n from track_events where name = 'visit' and day between ? and ?`, start, today),
    one(`select count(distinct visitor_id) as n from track_events where name = 'signin_click' and day between ? and ?`, start, today),
  ]);
  const funnel = [
    { key: 'visit', label: 'נכנסו לאתר', n: vis.n || 0 },
    { key: 'click', label: 'לחצו ״יאללה, אני בפנים״', n: clicks.n || 0 },
    { key: 'signed', label: 'נכנסו עם Google', n: f.signed || 0 },
    { key: 'profile', label: 'השלימו פרטים', n: f.profile || 0 },
    { key: 'chose', label: 'בחרו אתגר', n: f.chose || 0 },
    { key: 'reported', label: 'דיווחו לפחות פעם אחת', n: f.reported || 0 },
    { key: 'grouped', label: 'בקבוצה עם חברות', n: f.grouped || 0 },
  ];
  const sources = { invite: f.invited || 0, direct: Math.max(0, (f.profile || 0) - (f.invited || 0)) };

  // ---------- ויראליות ----------
  const activeInPeriod = (await one(`select count(distinct user_id) as n from user_days where day between ? and ?`, start, today)).n || 0;
  const invitesSent = kpi.invites.cur, viaInv = kpi.viaInvite.cur;
  const viral = {
    activeUsers: activeInPeriod, invitesSent, opens: kpi.opens.cur, signups: viaInv,
    invitesPerUser: activeInPeriod ? Math.round((100 * invitesSent) / activeInPeriod) / 100 : 0,
    openRate: pct(kpi.opens.cur, invitesSent), signupRate: pct(viaInv, kpi.opens.cur),
    k: activeInPeriod ? Math.round((100 * viaInv) / activeInPeriod) / 100 : 0,   // כמה בנות חדשות כל משתמשת פעילה הביאה בתקופה
  };
  const kindRows = await many(`select coalesce(kind, 'follow') as kind, token_hash as h from circle_invites where ${inRange('created_at')}`, start, today);
  const kindOf = Object.fromEntries(kindRows.map(r => [r.h, r.kind]));
  const hashes = kindRows.map(r => r.h);
  const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  const countBy = async (sql) => { const acc = {}; for (const c of chunk(hashes, 90)) for (const r of await many(sql.replace('$$', c.map(() => '?').join(',')), ...c)) acc[kindOf[r.h]] = (acc[kindOf[r.h]] || 0) + Number(r.n); return acc; };
  const [kOpens, kSign, kJoin] = hashes.length ? await Promise.all([
    countBy(`select token_hash as h, count(*) as n from invite_opens where token_hash in ($$) group by token_hash`),
    countBy(`select invited_via as h, count(*) as n from users where status = 'active' and invited_via in ($$) group by invited_via`),
    countBy(`select via_invite as h, count(*) as n from circle_memberships where via_invite in ($$) group by via_invite`),
  ]) : [{}, {}, {}];
  const inviteKinds = ['follow', 'compete', 'same'].map(kind => ({ kind, sent: kindRows.filter(r => r.kind === kind).length, opens: kOpens[kind] || 0, signups: kSign[kind] || 0, joins: kJoin[kind] || 0 }));
  // הזמנות בתוך האפליקציה לחברות שכבר במילה: כמה חברות הוזמנו (עדכון לכל אחת), וכמה הצטרפו
  const friendsSent = (await one(`select count(*) as n from notifications where type = 'group_invite' and ${inRange('created_at')}`, start, today)).n || 0;
  const friendInvites = { sent: friendsSent, joins: kJoin.friends || 0, rate: pct(kJoin.friends || 0, friendsSent) };
  const refsAll = await many(`select u.id, u.display_name as name,
      (select count(*) from circle_invites i where i.inviter_id = u.id and ${inRange('i.created_at')}) as invites,
      (select count(*) from invite_opens o where o.inviter_id = u.id and ${inRange('o.created_at')}) as opens,
      (select count(*) from users x where x.invited_by = u.id and x.status = 'active' and ${inRange('x.created_at')}) as signups,
      (select count(*) from circle_memberships m where m.via_invite in (select token_hash from circle_invites i where i.inviter_id = u.id) and ${inRange('m.joined_at')}) as joins,
      (select count(*) from users x where x.invited_by = u.id and x.status = 'active') as signupsAll
    from users u where u.id in (select inviter_id from circle_invites) and u.status <> 'deleted'
    order by opens desc, signups desc, invites desc limit 200`, start, today, start, today, start, today, start, today);
  const referrers = refsAll.filter(r => r.invites + r.opens + r.signups + r.joins > 0).slice(0, 25);

  // ---------- מעורבות ----------
  const [perUserRows, hourRows, wdRows] = await Promise.all([
    many(`select n, count(*) as users from (select u.id, (select count(*) from word_commitments k where k.user_id = u.id and k.status = 'active') as n from users u where u.status = 'active') group by n order by n`),
    many(`select cast(strftime('%H', datetime(created_at, '${OFF}')) as integer) as h, count(*) as n from resolution_history where reason = 'self_report' and ${inRange('created_at')} group by h`, start, today),
    many(`select cast(strftime('%w', datetime(created_at, '${OFF}')) as integer) as w, count(*) as n from resolution_history where reason = 'self_report' and ${inRange('created_at')} group by w`, start, today),
  ]);
  const hours = Array.from({ length: 24 }, (_, h) => Number((hourRows.find(r => r.h === h) || {}).n || 0));
  const weekdays = Array.from({ length: 7 }, (_, w) => Number((wdRows.find(r => r.w === w) || {}).n || 0));
  const perUser = [0, 1, 2, 3].map(n => ({ n, users: perUserRows.filter(r => (n === 3 ? r.n >= 3 : r.n === n)).reduce((t, r) => t + r.users, 0) }));
  const engagement = {
    reportsPerActive: activeInPeriod ? Math.round((10 * kpi.reports.cur) / activeInPeriod) / 10 : 0,
    perUser, hours, weekdays,
  };

  // ---------- שימור: קבוצות לפי שבוע הרשמה (8 שבועות) ----------
  const cohortFrom = addDays(today, -55);
  const cu = await many(`select id, ${ilDay('created_at')} as d from users where status = 'active' and ${ilDay('created_at')} >= ?`, cohortFrom);
  const cd = cu.length ? await many(`select user_id as u, day from user_days where day >= ? and user_id in (select id from users where status = 'active' and ${ilDay('created_at')} >= ?)`, cohortFrom, cohortFrom) : [];
  const activeDays = {}; for (const r of cd) (activeDays[r.u] = activeDays[r.u] || new Set()).add(r.day);
  const cohorts = [];
  for (let w = 7; w >= 0; w--) {
    const ws = addDays(today, -(w * 7 + 6)), we = addDays(today, -(w * 7));
    const members = cu.filter(x => x.d >= ws && x.d <= we);
    const cells = [];
    for (let k = 1; k <= 4; k++) {
      const eligible = members.filter(x => addDays(x.d, k * 7 + 6) <= today);
      if (!eligible.length) { cells.push(null); continue; }
      const back = eligible.filter(x => { const s = activeDays[x.id]; if (!s) return false; for (let i = 0; i < 7; i++) if (s.has(addDays(x.d, k * 7 + i))) return true; return false; }).length;
      cells.push({ n: back, of: eligible.length, pct: pct(back, eligible.length) });
    }
    cohorts.push({ start: ws, end: we, size: members.length, cells });
  }
  const dayN = (n) => { const el = cu.filter(x => addDays(x.d, n) <= today); const b = el.filter(x => activeDays[x.id] && activeDays[x.id].has(addDays(x.d, n))).length; return { pct: pct(b, el.length), n: b, of: el.length }; };
  const roundsRow = await one(`select sum(status = 'completed') as completed, sum(status = 'ended_early') as ended from word_commitments where end_date between ? and ?`, start, today);
  const retention = { cohorts, d1: dayN(1), d7: dayN(7), d14: dayN(14), rounds: { completed: roundsRow.completed || 0, ended: roundsRow.ended || 0, rate: pct(roundsRow.completed || 0, (roundsRow.completed || 0) + (roundsRow.ended || 0)) } };

  // ---------- אתגרים ----------
  const [chChosen, chActive, chLedger, chEnd] = await Promise.all([
    many(`select coalesce(d.library_id, '_custom') as lid, count(*) as n from word_commitments k join word_definitions d on d.id = k.definition_id where ${inRange('k.created_at')} group by lid`, start, today),
    many(`select coalesce(d.library_id, '_custom') as lid, count(*) as n from word_commitments k join word_definitions d on d.id = k.definition_id where k.status = 'active' group by lid`),
    many(`select coalesce(d.library_id, '_custom') as lid, sum(l.transaction_type = 'EARN') as e, sum(l.transaction_type in ('MISS_TO_CIRCLE','MISS_PERSONAL')) as m from virtual_ledger l join word_definitions d on d.id = l.definition_id where l.local_date between ? and ? group by lid`, start, today),
    many(`select coalesce(d.library_id, '_custom') as lid, sum(k.status = 'completed') as c, sum(k.status = 'ended_early') as x from word_commitments k join word_definitions d on d.id = k.definition_id where k.end_date between ? and ? group by lid`, start, today),
  ]);
  const by = (rows, f2) => Object.fromEntries(rows.map(r => [r.lid, f2(r)]));
  const cC = by(chChosen, r => r.n), cA = by(chActive, r => r.n), cL = by(chLedger, r => r), cE = by(chEnd, r => r);
  const ids = [...new Set([...Object.keys(cC), ...Object.keys(cA), ...Object.keys(cL)])];
  const challenges = ids.map(id => {
    const lib = Lib.get(id); const l = cL[id] || { e: 0, m: 0 }; const e = cE[id] || { c: 0, x: 0 };
    return { id, title: id === '_custom' ? 'אתגרים אישיים (לא מהספרייה)' : lib ? lib.title : id, cat: id === '_custom' ? 'custom' : lib ? lib.cat : '', chosen: cC[id] || 0, active: cA[id] || 0, success: pct(l.e, (l.e || 0) + (l.m || 0)), reports: (l.e || 0) + (l.m || 0), earn: l.e || 0, completed: e.c || 0, ended: e.x || 0, completionRate: pct(e.c || 0, (e.c || 0) + (e.x || 0)) };
  }).sort((a, b) => b.chosen - a.chosen || b.active - a.active);
  const cats = {};
  for (const c of challenges) { const k = c.cat || 'custom'; const t = cats[k] || (cats[k] = { cat: k, name: k === 'custom' ? 'אתגר אישי' : ((Lib.category(k) || {}).name || k), chosen: 0, active: 0, e: 0, r: 0 }); t.chosen += c.chosen; t.active += c.active; t.r += c.reports; t.e += c.earn; }
  const categories = Object.values(cats).map(c => ({ cat: c.cat, name: c.name, chosen: c.chosen, active: c.active, reports: c.r, success: pct(c.e, c.r) })).sort((a, b) => b.chosen - a.chosen || b.active - a.active);

  // ---------- קבוצות וחברתי ----------
  const [gSizes, gTop, gIn, social, closed, reactions] = await Promise.all([
    many(`select n as size, count(*) as groups from (select count(*) as n from circle_memberships m join circles c on c.id = m.circle_id where m.left_at is null and c.status = 'active' group by m.circle_id) group by n order by n`),
    many(`select c.id, c.name, substr(c.created_at, 1, 10) as created,
        (select count(*) from circle_memberships m where m.circle_id = c.id and m.left_at is null) as members,
        (select count(*) from word_commitments k join word_definitions d on d.id = k.definition_id where d.circle_id = c.id and k.status = 'active') as challenges,
        (select count(*) from virtual_ledger l where l.circle_id = c.id and l.local_date between ? and ? and l.transaction_type <> 'REVERSE') as reports,
        (select sum(l.transaction_type = 'EARN') from virtual_ledger l where l.circle_id = c.id and l.local_date between ? and ?) as earn
      from circles c where c.status = 'active' order by reports desc, members desc limit 20`, start, today, start, today),
    one(`select count(distinct m.user_id) as n from circle_memberships m join circles c on c.id = m.circle_id where m.left_at is null and c.status = 'active'`),
    one(`select sum(type = 'encouragement') as encouragements, sum(type = 'overtake') as overtakes, sum(type = 'group_word_proposed') as shared, sum(type = 'group_word_adopted') as sharedJoins, sum(type = 'member_joined') as joins
      from social_events where ${inRange('created_at')}`, start, today),
    one(`select count(*) as n from circles where status = 'archived'`),
    one(`select count(*) as n from encouragements where ${inRange('created_at')}`, start, today),
  ]);
  const memberships = gSizes.reduce((t, r) => t + r.size * r.groups, 0);
  const groups = {
    active: kpi.groupsActive, created: kpi.groups, avgSize: kpi.groupsActive ? Math.round((10 * memberships) / kpi.groupsActive) / 10 : 0,
    inGroupPct: pct(gIn.n || 0, kpi.users), inGroup: gIn.n || 0, sizes: gSizes, closed: closed.n || 0,
    top: gTop.map(g => ({ ...g, success: pct(g.earn || 0, g.reports) })),
  };
  const socialOut = { encouragements: social.encouragements || 0, reactions: reactions.n || 0, overtakes: social.overtakes || 0, shared: social.shared || 0, sharedJoins: social.sharedJoins || 0, joins: social.joins || 0 };

  // ---------- פרגון ובטיחות ----------
  const treatsRows = await many(`select name, count(*) as clicks from track_events where (name like 'treat:%' or name like 'support:%') and day between ? and ? group by name`, start, today);
  const treats = ['18', '50', '100', '180', '360', 'other'].map(k => ({ kind: k, clicks: Number((treatsRows.find(r => r.name === `support:${k}`) || {}).clicks || 0) }));
  // ---------- אפליקציה על המסך והתראות ----------
  const appRows = await many(`select name, count(*) as n, count(distinct visitor_id) as v from track_events where name in ('app_open','install_sheet','install_prompt','installed','push_on','push_denied') and day between ? and ? group by name`, start, today);
  const appN = (k) => Number((appRows.find(r => r.name === k) || {}).v || 0);
  let pushSubs = { n: 0, users: 0 }, pushPlat = [];
  try {
    pushSubs = await one(`select count(*) as n, count(distinct user_id) as users, sum(last_ok_at is not null) as delivered, sum(fails > 0) as failing from push_subscriptions`);
    pushPlat = await many(`select coalesce(nullif(platform,''),'אחר') as platform, count(*) as n from push_subscriptions group by 1 order by n desc`);
  } catch (e) { /* לפני מיגרציה 0006 */ }
  const app = { opens: appN('app_open'), sheet: appN('install_sheet'), prompt: appN('install_prompt'), installed: appN('installed'), pushOn: appN('push_on'), pushDenied: appN('push_denied'), subscriptions: pushSubs.n || 0, pushUsers: pushSubs.users || 0, delivered: pushSubs.delivered || 0, failing: pushSubs.failing || 0, platforms: pushPlat };
  // מסכי שגיאה שמכשירים ראו (מכשיר ייחודי ליום לכל סוג)
  const errRows = await many(`select name, count(*) as n from track_events where name like 'err:%' and day between ? and ? group by name`, start, today);
  app.errors = ['server', 'quota', 'crash', 'notfound'].map(k2 => ({ kind: k2, n: Number((errRows.find(r => r.name === `err:${k2}`) || {}).n || 0) }));
  // למה שליחת התראה נכשלה (שירות:קוד:סיבה), כפי שענה שירות ההתראות
  app.pushErrors = (await many(`select name, count(*) as n from track_events where name like 'pusherr:%' and day between ? and ? group by name order by n desc limit 8`, start, today)).map(r => ({ why: r.name.slice(8), n: Number(r.n) }));
  // גיל: התחום שמגיל 18 (תאריך הלידה עצמו לא נשמר)
  const ageRow = await one(`select sum(adult_from is not null and adult_from <= ?) as adults, sum(adult_from > ?) as minors, sum(adult_from is null) as unknown from users where status = 'active'`, today, today);
  const age = { adults: ageRow.adults || 0, minors: ageRow.minors || 0, unknown: ageRow.unknown || 0 };
  const [abuse, blocks] = await Promise.all([
    many(`select reason, count(*) as n from abuse_reports where ${inRange('created_at')} group by reason order by n desc`, start, today),
    one(`select count(*) as n from user_blocks where ${inRange('created_at')}`, start, today),
  ]);

  return {
    generatedAt: new Date().toISOString(), range, series, kpi, funnel, sources, viral, inviteKinds, referrers, invitersTotal: refsAll.length,
    engagement, retention, challenges, categories, groups, social: socialOut, friendInvites, age, treats, app,
    safety: { reports: abuse, blocks: blocks.n || 0, pending: kpi.pending, deleted: kpi.deleted },
  };
}

/* מעקב אירועים זול: מבקרת ייחודית ליום לכל שם. שמות מותרים בלבד. */
const TRACK = new Set(['visit', 'visit_invite', 'signin_click', 'treat:cookie', 'treat:espresso', 'treat:latte', 'support:18', 'support:50', 'support:100', 'support:180', 'support:360', 'support:other', 'app_open', 'install_sheet', 'install_prompt', 'installed', 'push_on', 'push_denied', 'err:server', 'err:quota', 'err:crash', 'err:notfound']);
export async function track(env, b) {
  const name = String(b.name || ''); const vis = String(b.visitor || '');
  if (!TRACK.has(name) || !/^[a-z0-9-]{8,40}$/.test(vis)) return { ok: false };
  await env.DB.prepare(`insert or ignore into track_events(day, name, visitor_id) values (?, ?, ?)`).bind(localDate('Asia/Jerusalem'), name, vis).run();
  return { ok: true };
}
