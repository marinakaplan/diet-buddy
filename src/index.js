/* מילה — Cloudflare Worker: נתיבי API + נכסים סטטיים.
   כל /api/* עובר כאן; כל השאר מוגש מ-public/ (Static Assets, SPA). */
import { AppError, json, localDate, nowISO } from './util.js';
import * as auth from './auth.js';
import * as game from './game.js';
import { myState } from './state.js';
import { serveStatic } from './static.js';

const ACTIONS = {
  createPersonalWord: game.createPersonalWord, proposeGroupWord: game.proposeGroupWord, adoptGroupWord: game.adoptGroupWord, cancelProposal: game.cancelProposal,
  endCommitment: game.endCommitment, setVisibility: game.setVisibility, report: game.report, correct: game.correct,
  createCircle: game.createCircle, updateCircle: game.updateCircle, createInvite: game.createInvite, revokeCircleInvites: game.revokeCircleInvites,
  previewInvite: game.previewInvite, acceptInvite: game.acceptInvite, leaveCircle: game.leaveCircle, removeMember: game.removeMember,
  encourage: game.encourage, sendEncouragement: game.sendEncouragement, block: game.block, unblock: game.unblock, reportAbuse: game.reportAbuse,
  markNotificationsRead: game.markNotificationsRead, markSummarySeen: game.markSummarySeen, updateSettings: game.updateSettings, rename: game.rename,
  deleteAccount: game.deleteAccount, exportData: game.exportData,
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(req) : serveStatic(req);
    try {
      return await handleApi(req, env, ctx, url);
    } catch (e) {
      if (e instanceof AppError) return json({ error: e.code, hint: e.hint, ...e.extra }, e.status);
      const msg = String(e && e.message || e);
      console.error('API error', url.pathname, msg);
      if (/limit|quota|exceeded|too many/i.test(msg)) return json({ error: 'QUOTA', hint: 'הגענו למכסת השימוש היומית של השרת החינמי. נסי שוב מאוחר יותר.' }, 503);
      return json({ error: 'INTERNAL', hint: 'משהו השתבש בשרת. נסי שוב בעוד רגע.' }, 500);
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
  if (path === 'auth/config') return json({ google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), testLogin: env.ALLOW_TEST_LOGIN === 'true', env: env.APP_ENV });

  const user = await auth.currentUser(req, env);
  if (path === 'me') return json({ user: user ? publicMe(user) : null, config: { google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), env: env.APP_ENV } });
  if (!user) return json({ error: 'AUTH_REQUIRED', hint: 'צריך להתחבר' }, 401);

  if (path === 'profile' && req.method === 'POST') { await auth.completeProfile(user, await body(req), env); return json({ ok: true }); }
  if (user.status !== 'active') return json({ error: 'PROFILE_REQUIRED', hint: 'צריך להשלים הרשמה' }, 403);

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
    return json(result === undefined ? { ok: true } : result);
  }
  return json({ error: 'NOT_FOUND' }, 404);
}

const publicMe = (u) => ({ id: u.id, name: u.display_name, email: u.email, status: u.status, timezone: u.timezone, color: u.color });
async function body(req) { try { return await req.json(); } catch { return {}; } }
/* "נראתה לאחרונה" + מונה שימוש יומי לניטור מכסות (כתיבה אחת לקריאת מצב) */
async function touch(env, user) {
  try {
    const day = localDate('UTC');
    await env.DB.batch([
      env.DB.prepare(`update users set last_seen_at = ? where id = ?`).bind(nowISO(), user.id),
      env.DB.prepare(`insert into usage_daily(day, requests) values (?, 1) on conflict(day) do update set requests = requests + 1`).bind(day),
    ]);
  } catch (e) { /* ניטור בלבד */ }
}
