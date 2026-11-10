/* מילה — Cloudflare Worker: נתיבי API + נכסים סטטיים.
   כל /api/* עובר כאן; כל השאר מוגש מ-public/ (Static Assets, SPA). */
import { AppError, json, localDate, nowISO } from './util.js';
import * as auth from './auth.js';
import * as game from './game.js';
import { myState } from './state.js';
import { serveStatic } from './static.js';
import { adminStats, track } from './admin.js';
import * as push from './push.js';

const ACTIONS = {
  createPersonalWord: game.createPersonalWord, proposeGroupWord: game.proposeGroupWord, adoptGroupWord: game.adoptGroupWord, cancelProposal: game.cancelProposal,
  endCommitment: game.endCommitment, setVisibility: game.setVisibility, report: game.report, correct: game.correct,
  createCircle: game.createCircle, updateCircle: game.updateCircle, createInvite: game.createInvite, revokeCircleInvites: game.revokeCircleInvites,
  previewInvite: game.previewInvite, acceptInvite: game.acceptInvite, leaveCircle: game.leaveCircle, removeMember: game.removeMember, setMemberRole: game.setMemberRole, deleteCircle: game.deleteCircle, overtake: game.overtake,
  encourage: game.encourage, sendEncouragement: game.sendEncouragement, block: game.block, unblock: game.unblock, reportAbuse: game.reportAbuse,
  markNotificationsRead: game.markNotificationsRead, markSummarySeen: game.markSummarySeen, updateSettings: game.updateSettings, rename: game.rename,
  deleteAccount: game.deleteAccount, exportData: game.exportData,
};

/* מונה שורות D1 לכל בקשה (שורות שנקראו/נכתבו). מוחזר בכותרות x-d1-read / x-d1-write,
   כדי למדוד עלות אמיתית מול המכסה החינמית (5M קריאות, 100K כתיבות ליום). */
function countingDB(db, c) {
  const add = (m) => { if (m) { c.read += m.rows_read || 0; c.write += m.rows_written || 0; } };
  const wrap = (st) => ({
    bind: (...a) => wrap(st.bind(...a)),
    all: async () => { const r = await st.all(); add(r.meta); return r; },
    run: async () => { const r = await st.run(); add(r.meta); return r; },
    first: async (col) => { const r = await st.all(); add(r.meta); const row = (r.results || [])[0]; return row === undefined ? null : col ? row[col] : row; },
    raw: (...a) => st.raw(...a),
    _st: st,
  });
  return {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: async (stmts) => { const r = await db.batch(stmts.map(x => x._st || x)); r.forEach(x => add(x.meta)); return r; },
    exec: (sql) => db.exec(sql),
  };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(req) : serveStatic(req);
    const c = { read: 0, write: 0 };
    env = { ...env, DB: countingDB(env.DB, c) };
    const res = await this.api(req, env, ctx, url);
    const h = new Headers(res.headers); h.set('x-d1-read', String(c.read)); h.set('x-d1-write', String(c.write));
    return new Response(res.body, { status: res.status, headers: h });
  },
  /* Cron (כל 5 דקות): תזכורות דיווח למי שעוד לא דיווחה */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(push.runReminders(env).then(r => { if (r.due) console.log('reminders', JSON.stringify(r)); }).catch(e => console.error('reminders', e.message)));
  },
  async api(req, env, ctx, url) {
    try {
      return await handleApi(req, env, ctx, url);
    } catch (e) {
      if (e instanceof AppError) return json({ error: e.code, hint: e.hint, ...e.extra }, e.status);
      const msg = String(e && e.message || e);
      console.error('API error', url.pathname, msg);
      if (/limit|quota|exceeded|too many/i.test(msg)) return json({ error: 'QUOTA', hint: 'הגענו למכסת השימוש היומית של השרת החינמי. נסי שוב מאוחר יותר.' }, 503);
      return json({ error: 'INTERNAL', hint: 'משהו השתבש בשרת. נסי שוב בעוד רגע.', ...(env.APP_ENV === 'staging' ? { detail: msg.slice(0, 300) } : {}) }, 500);
    }
  },
};

async function handleApi(req, env, ctx, url) {
  const path = url.pathname.replace(/^\/api\//, '');
  // CSRF: פעולות משנות רק מאותו מקור
  if (req.method === 'POST') {
    const origin = req.headers.get('origin');
    if (origin && origin !== url.origin) return json({ error: 'FORBIDDEN', hint: 'מקור לא מורשה' }, 403);
  }
  if (path === 'health') return json({ ok: true, env: env.APP_ENV, now: nowISO() });
  if (path === 'auth/google' && req.method === 'GET') return auth.googleStart(req, env);
  if (path === 'auth/google/callback' && req.method === 'GET') return auth.googleCallback(req, env);
  if (path === 'auth/logout' && req.method === 'POST') return auth.logout(req, env);
  if (path === 'auth/test-login' && req.method === 'POST') return auth.testLogin(req, env);
  if (path === 'track' && req.method === 'POST') return json(await track(env, await body(req)));
  if (path === 'invite/open' && req.method === 'POST') return json(await game.trackInviteOpen(env, await body(req)));
  if (path === 'push/key' && req.method === 'GET') return json(await push.publicKey(env));
  if (path === 'auth/config') return json({ google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), testLogin: env.ALLOW_TEST_LOGIN === 'true', env: env.APP_ENV });

  const user = await auth.currentUser(req, env);
  if (path === 'me') return json({ user: user ? publicMe(user) : null, config: { google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), env: env.APP_ENV } });
  if (!user) return json({ error: 'AUTH_REQUIRED', hint: 'צריך להתחבר' }, 401);

  if (path === 'profile' && req.method === 'POST') { await auth.completeProfile(user, await body(req), env); return json({ ok: true }); }
  if (user.status !== 'active') return json({ error: 'PROFILE_REQUIRED', hint: 'צריך להשלים הרשמה' }, 403);

  /* ריענון קל: חותמת שמשתנה כשיש משהו חדש (עדכון, אירוע בקבוצה, שינוי בחברות). ~1 שורה לקבוצה. */
  if (path === 'ping' && req.method === 'GET') return json({ v: await pingStamp(env, user) });
  if (path === 'admin/stats' && req.method === 'GET') {
    if (!user.is_admin) return json({ error: 'FORBIDDEN', hint: 'רק מנהלת המערכת' }, 403);
    return json(await adminStats(env, url.searchParams.get('days')));
  }
  if (path === 'push/subscribe' && req.method === 'POST') return json(await push.subscribe(env, user, await body(req)));
  if (path === 'push/unsubscribe' && req.method === 'POST') return json(await push.unsubscribe(env, user, await body(req)));
  if (path === 'push/status' && req.method === 'POST') return json(await push.status(env, user, (await body(req)).endpoint));
  if (path === 'push/test' && req.method === 'POST') return json(await push.test(env, user, await body(req)));
  if (path === 'state' && req.method === 'GET') {
    const state = await myState(env, user);
    ctx.waitUntil(touch(env, user));
    return json(state);
  }
  if (path.startsWith('action/') && req.method === 'POST') {
    const name = path.slice('action/'.length);
    const fn = ACTIONS[name];
    if (!fn) return json({ error: 'NOT_FOUND', hint: 'פעולה לא מוכרת' }, 404);
    const result = await fn(env, user, await body(req));
    // התראות לטלפון: לחברות שקיבלו עדכון בפעולה הזו; ושינוי שעת תזכורת מעדכן את התזמון
    if (env.__notified && env.__notified.size) ctx.waitUntil(push.social(env, [...env.__notified].filter(id => id !== user.id)).catch(e => console.warn('social push', e.message)));
    if (name === 'updateSettings') ctx.waitUntil(push.reschedule(env, user.id).catch(() => {}));
    return json(result === undefined ? { ok: true } : result);
  }
  return json({ error: 'NOT_FOUND' }, 404);
}

const publicMe = (u) => ({ id: u.id, name: u.display_name, email: u.email, status: u.status, timezone: u.timezone, color: u.color, isAdmin: !!u.is_admin });
async function body(req) { try { return await req.json(); } catch { return {}; } }
/* "נראתה לאחרונה" + משתמשת פעילה ביום: כתיבה רק כשעברו 10 דקות, ושורה אחת ליום בטבלת user_days */
async function touch(env, user) {
  try {
    const now = new Date(); const cutoff = new Date(now - 10 * 60000).toISOString();
    if (user.last_seen_at && user.last_seen_at > cutoff) return;
    await env.DB.batch([
      env.DB.prepare(`update users set last_seen_at = ? where id = ?`).bind(now.toISOString(), user.id),
      env.DB.prepare(`insert or ignore into user_days(day, user_id) values (?, ?)`).bind(localDate('Asia/Jerusalem'), user.id),
    ]);
  } catch (e) { /* ניטור בלבד */ }
}
async function pingStamp(env, user) {
  const cids = (await env.DB.prepare(`select circle_id from circle_memberships where user_id = ? and left_at is null`).bind(user.id).all()).results.map(r => r.circle_id);
  const parts = [`select 'n' as k, created_at as t from (select created_at from notifications where user_id = ? order by created_at desc limit 1)`];
  const binds = [user.id];
  for (const c of cids.slice(0, 20)) { parts.push(`select 'e' as k, created_at as t from (select created_at from social_events where circle_id = ? order by created_at desc limit 1)`); binds.push(c); }
  const rows = (await env.DB.prepare(parts.join(' union all ')).bind(...binds).all()).results;
  return [cids.join(','), ...rows.map(r => r.t)].join('|');
}
