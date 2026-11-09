/* כלי עזר לשרת: מזהים, זמן ואזורי זמן, שגיאות */

export class AppError extends Error {
  constructor(code, hint, status = 400, extra = {}) { super(code); this.code = code; this.hint = hint; this.status = status; this.extra = extra; }
}
export const err = (code, hint, status = 400, extra) => new AppError(code, hint, status, extra);

export const uid = () => crypto.randomUUID();
export const nowISO = () => new Date().toISOString();
const pad = (n) => String(n).padStart(2, '0');

/* תאריך מקומי (YYYY-MM-DD) של רגע נתון באזור זמן */
export function localDate(tz, at = new Date()) {
  const p = parts(tz, at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
function parts(tz, at) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const o = {};
  for (const { type, value } of f.formatToParts(at)) if (type !== 'literal') o[type] = Number(value);
  if (o.hour === 24) o.hour = 0;
  return o;
}
/* הופך "תאריך+שעה מקומיים באזור זמן" לרגע UTC (עם תיקון לשעון קיץ) */
export function zonedToUtc(dateStr, hour, minute, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, hour, minute, 0);
  for (let i = 0; i < 2; i++) {
    const p = parts(tz, new Date(guess));
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += Date.UTC(y, m - 1, d, hour, minute, 0) - asUtc;
  }
  return new Date(guess);
}
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
export function diffDays(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
export const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
export function isValidTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }

/* חלון דיווח: מתחילת היום המקומי עד 10:00 למחרת */
export const GRACE_HOUR = 10;
export const ROUND_DAYS = 14;
export const DAILY_CAP = 3;
export const MAX_EXCUSES = 2;
export const CORRECTION_MS = 24 * 3600 * 1000;
export function windowOf(dateStr, tz) {
  return { opens: zonedToUtc(dateStr, 0, 0, tz), closes: zonedToUtc(addDays(dateStr, 1), GRACE_HOUR, 0, tz) };
}

export async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = crypto.getRandomValues(new Uint8Array(6));
  return [...a].map(b => alphabet[b % alphabet.length]).join('');
}

export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
export const parseCookies = (req) => Object.fromEntries((req.headers.get('cookie') || '').split(';').map(c => c.trim()).filter(Boolean).map(c => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
export function cookie(name, value, { maxAge, path = '/', httpOnly = true, secure = true, sameSite = 'Lax' } = {}) {
  let s = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (httpOnly) s += '; HttpOnly';
  if (secure) s += '; Secure';
  if (maxAge !== undefined) s += `; Max-Age=${maxAge}`;
  return s;
}
