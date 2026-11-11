/* אימות: Google OAuth 2.0 (authorization code + PKCE) וסשנים ב-D1.
   למה לא Better Auth: ברירת המחדל שלו ל-email/password היא scrypt, שחורגת בקלות מ-10ms CPU
   של Workers Free. אנחנו צריכות רק גוגל, ולכן שכבה קטנה וקריאה:
   אסימון סשן אקראי (32 בתים) נשמר כ-hash בלבד, בעוגיית HttpOnly/Secure/SameSite=Lax. */
import { err, json, uid, nowISO, sha256hex, randomToken, parseCookies, cookie, isValidTz, cleanName } from './util.js';

const SESSION_COOKIE = 'mila_session';
const OAUTH_COOKIE = 'mila_oauth';
const SESSION_DAYS = 90;

export async function currentUser(req, env) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const hash = await sha256hex(token);
  const row = await env.DB.prepare(`select u.* from sessions s join users u on u.id = s.user_id where s.token_hash = ? and s.expires_at > ? and u.status <> 'deleted'`).bind(hash, nowISO()).first();
  return row || null;
}

async function createSession(env, userId, req) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare(`insert into sessions(token_hash, user_id, expires_at, user_agent) values (?,?,?,?)`).bind(await sha256hex(token), userId, expires, (req.headers.get('user-agent') || '').slice(0, 200)).run();
  return cookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400, secure: isSecure(req) });
}
const isSecure = (req) => new URL(req.url).protocol === 'https:';

export async function logout(req, env) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await env.DB.prepare(`delete from sessions where token_hash = ?`).bind(await sha256hex(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': cookie(SESSION_COOKIE, '', { maxAge: 0, secure: isSecure(req) }) });
}

/* ---------- Google ---------- */
export async function googleStart(req, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw err('AUTH_NOT_CONFIGURED', 'התחברות עם גוגל עוד לא הוגדרה בסביבה הזו', 503);
  const url = new URL(req.url);
  const state = randomToken(16);
  const verifier = randomToken(48);
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const next = sanitizeNext(url.searchParams.get('next'));
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${url.origin}/api/auth/google/callback`, response_type: 'code',
    scope: 'openid email profile', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account', access_type: 'online',
  });
  return new Response(null, { status: 302, headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, 'set-cookie': cookie(OAUTH_COOKIE, JSON.stringify({ state, verifier, next }), { maxAge: 600, secure: isSecure(req) }) } });
}

export async function googleCallback(req, env) {
  const url = new URL(req.url);
  const saved = safeJson(parseCookies(req)[OAUTH_COOKIE]);
  const code = url.searchParams.get('code'); const state = url.searchParams.get('state');
  const clear = cookie(OAUTH_COOKIE, '', { maxAge: 0, secure: isSecure(req) });
  if (!saved || !code || !state || state !== saved.state) return redirect(`/?auth_error=state`, clear);
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${url.origin}/api/auth/google/callback`, grant_type: 'authorization_code', code_verifier: saved.verifier }),
  });
  if (!tokenRes.ok) return redirect(`/?auth_error=token`, clear);
  const tok = await tokenRes.json();
  // ה-id_token התקבל ישירות מגוגל ב-TLS; לפי הנחיות גוגל אין צורך באימות חתימה במקרה הזה. בודקים aud ו-iss בכל זאת.
  const claims = decodeJwt(tok.id_token);
  if (!claims || claims.aud !== env.GOOGLE_CLIENT_ID || !/^(https:\/\/)?accounts\.google\.com$/.test(claims.iss) || !claims.sub) return redirect(`/?auth_error=claims`, clear);
  if (claims.email && claims.email_verified === false) return redirect(`/?auth_error=email`, clear);
  const user = await upsertGoogleUser(env, claims);
  await grantAdminIfOwner(env, user.id, claims.email);
  const session = await createSession(env, user.id, req);
  const headers = new Headers({ location: saved.next || '/' });
  headers.append('set-cookie', clear); headers.append('set-cookie', session);
  return new Response(null, { status: 302, headers });
}

async function upsertGoogleUser(env, c) {
  const email = (c.email || '').toLowerCase() || null;
  let u = await env.DB.prepare(`select * from users where google_sub = ?`).bind(c.sub).first();
  if (!u && email) {
    u = await env.DB.prepare(`select * from users where email = ?`).bind(email).first();
    if (u) await env.DB.prepare(`update users set google_sub = ? where id = ?`).bind(c.sub, u.id).run();
  }
  if (!u) {
    const id = uid();
    const name = cleanName(c.given_name || c.name).slice(0, 30) || 'משתתפת';
    await env.DB.prepare(`insert into users(id, email, google_sub, display_name, color, status) values (?,?,?,?,?,'pending')`).bind(id, email, c.sub, name, pickColor(name)).run();
    u = await env.DB.prepare(`select * from users where id = ?`).bind(id).first();
  }
  if (u.status === 'deleted') { await env.DB.prepare(`update users set status = 'pending', display_name = ?, email = ? where id = ?`).bind(cleanName(c.given_name).slice(0, 30) || 'משתתפת', email, u.id).run(); u.status = 'pending'; }
  return u;
}

/* כניסת בדיקה — רק כש-ALLOW_TEST_LOGIN="true" (סביבת בדיקות). בייצור הנתיב מחזיר 404. */
export async function testLogin(req, env) {
  if (env.ALLOW_TEST_LOGIN !== 'true') return new Response('Not found', { status: 404 });
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err('VALIDATION', 'אימייל לא תקין');
  let u = await env.DB.prepare(`select * from users where email = ?`).bind(email).first();
  if (!u) {
    // סביבת הבדיקות חולקת מכסת כתיבה יומית עם הייצור: לא יותר מ-5,000 משתמשות בדיקה
    if ((await env.DB.prepare(`select count(*) as n from users`).first()).n >= 5000) throw err('VALIDATION', 'סביבת הבדיקות מלאה. צריך לנקות אותה.');
    const id = uid(); const name = cleanName(body.name).slice(0, 30) || 'בודקת';
    await env.DB.prepare(`insert into users(id, email, display_name, color, status) values (?,?,?,?,'pending')`).bind(id, email, name, pickColor(name)).run();
    u = await env.DB.prepare(`select * from users where id = ?`).bind(id).first();
  }
  await grantAdminIfOwner(env, u.id, u.email);
  const session = await createSession(env, u.id, req);
  return json({ ok: true, userId: u.id, status: u.status }, 200, { 'set-cookie': session });
}

/* השלמת פרופיל: שם, הסכמה לתנאים, אזור זמן. אין דרישת גיל 18 (החלטת מוצר 11.2026); התנאים קובעים גיל 13 ומעלה, ומתחת ל-18 באישור הורה. */
export async function completeProfile(user, body, env) {
  const name = cleanName(body.name);
  if (!name) throw err('VALIDATION', 'צריך שם תצוגה');
  if (name.length > 30) throw err('VALIDATION', 'השם ארוך מדי (עד 30 תווים)');
  if (!body.termsAccepted) throw err('VALIDATION', 'צריך לאשר את תנאי השימוש');
  const tz = isValidTz(body.timezone) ? body.timezone : 'Asia/Jerusalem';
  await env.DB.prepare(`update users set display_name = ?, terms_accepted_at = coalesce(terms_accepted_at, ?), timezone = ?, status = 'active' where id = ?`).bind(name, nowISO(), tz, user.id).run();
  if (body.inviteToken) { const { attributeSignup } = await import('./game.js'); await attributeSignup(env, user, body.inviteToken); }
}

const COLORS = ['lime', 'pink', 'lavender', 'mint', 'peach', 'sky'];
function pickColor(name) { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }
function base64url(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decodeJwt(t) { try { const p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(p)); } catch { return null; } }
function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
/* רק נתיב פנימי: בלי // או /\ בהתחלה ובלי תווי בקרה/רווח (דפדפנים מוחקים טאב, ואז /\t/evil.com הופך ל-//evil.com) */
function sanitizeNext(n) { return typeof n === 'string' && n.length <= 200 && /^\/(?![\/\\])[\x21-\x7e]*$/.test(n) ? n : '/'; }
function redirect(to, setCookie) { return new Response(null, { status: 302, headers: { location: to, 'set-cookie': setCookie } }); }

/* מנהלת מערכת: מזוהה בכניסה לפי SHA-256 של האימייל (ADMIN_EMAIL_SHA256). האימייל לא שמור בקוד. */
export async function grantAdminIfOwner(env, userId, email) {
  try {
    if (!env.ADMIN_EMAIL_SHA256 || !email) return;
    if ((await sha256hex(String(email).trim().toLowerCase())) === env.ADMIN_EMAIL_SHA256) await env.DB.prepare(`update users set is_admin = 1 where id = ? and is_admin = 0`).bind(userId).run();
  } catch (e) { /* לא חוסם כניסה */ }
}
