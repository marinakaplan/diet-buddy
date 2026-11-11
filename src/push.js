/* מילה — התראות Web Push בלי שירות חיצוני בתשלום.
   - מפתחות VAPID (ES256) נוצרים פעם אחת ב-Worker ונשמרים ב-D1 (טבלת server_keys). המפתח הציבורי בלבד יוצא לדפדפן.
   - התוכן מוצפן לפי RFC 8291 (aes128gcm) עם WebCrypto, כך ששירות ההתראות של אפל/גוגל/מוזילה לא רואה אותו.
   - תזכורות: Cron כל 5 דקות שולף רק מינויים ש-next_at שלהם הגיע (אינדקס), עד 40 שליחות בהרצה (מגבלת 50 בקשות יוצאות בחינמי).
   - התראות חברתיות (עקיפה, הצטרפות, מילה טובה, אתגר משותף) נשלחות מיד אחרי הפעולה, ב-waitUntil. */
import { addDays, err, localDate, nowISO, zonedToUtc } from './util.js';

const enc = new TextEncoder();
const b64u = (buf) => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => { const t = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)); const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/* שירותי ההתראות המוכרים בלבד (מונע שימוש בשרת כמתווך לכתובות שרירותיות) */
const PUSH_HOST = /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)\//i;
export const MAX_SENDS = 40;

/* ---------- מפתחות VAPID ---------- */
let vapidCache = null;
export async function vapidKeys(env) {
  if (vapidCache) return vapidCache;
  let row = await env.DB.prepare(`select public_key, private_jwk from server_keys where id = 'vapid'`).first();
  if (!row) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
    const jwk = JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey));
    await env.DB.prepare(`insert or ignore into server_keys(id, public_key, private_jwk, created_at) values ('vapid', ?, ?, ?)`).bind(pub, jwk, nowISO()).run();
    row = await env.DB.prepare(`select public_key, private_jwk from server_keys where id = 'vapid'`).first(); // אם שתי בקשות יצרו במקביל — כולן משתמשות באותו
  }
  const key = await crypto.subtle.importKey('jwk', JSON.parse(row.private_jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  vapidCache = { publicKey: row.public_key, key, jwts: new Map() };
  return vapidCache;
}
async function vapidHeader(env, endpoint) {
  const v = await vapidKeys(env);
  const aud = new URL(endpoint).origin; const now = Math.floor(Date.now() / 1000);
  const hit = v.jwts.get(aud);
  if (hit && hit.exp - now > 3600) return `vapid t=${hit.jwt}, k=${v.publicKey}`;
  const exp = now + 12 * 3600;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp, sub: env.PUBLIC_URL || 'https://mila.mila-app.workers.dev' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, enc.encode(`${head}.${claims}`));
  const jwt = `${head}.${claims}.${b64u(sig)}`;
  v.jwts.set(aud, { jwt, exp });
  return `vapid t=${jwt}, k=${v.publicKey}`;
}

/* ---------- הצפנת התוכן (RFC 8291, aes128gcm) ---------- */
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8));
}
export async function encryptPayload(p256dh, authSecret, payload) {
  const uaPublic = unb64u(p256dh); const auth = unb64u(authSecret);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(enc.encode(payload), new Uint8Array([2])); // 2 = רשומה אחרונה, בלי ריפוד
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/* שליחה למינוי אחד. לא נוגעת במסד: מחזירה את התוצאה ואת עדכון ההנהלה (bookkeeping) שלה,
   כדי שמי שקוראת תריץ את כל העדכונים ב-batch אחד (פחות פניות ל-D1 בכל ריצת cron). 404/410 = המינוי כבר לא קיים → נמחק. */
async function sendOne(env, sub, msg, { ttl = 6 * 3600, urgency = 'normal' } = {}) {
  const D = (sql, ...b) => env.DB.prepare(sql).bind(...b);
  try {
    const body = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(msg));
    const res = await fetch(sub.endpoint, { method: 'POST', body, headers: { authorization: await vapidHeader(env, sub.endpoint), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: String(ttl), urgency, ...(msg.tag ? { topic: String(msg.tag).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}) } });
    if (res.status === 404 || res.status === 410) return { r: 'gone', stmts: [D(`delete from push_subscriptions where endpoint = ?`, sub.endpoint)] };
    if (res.ok) return { r: 'ok', stmts: [D(`update push_subscriptions set last_ok_at = ?, fails = 0 where endpoint = ?`, nowISO(), sub.endpoint)] };
    console.warn('push', res.status, new URL(sub.endpoint).host, (await res.text()).slice(0, 200));
  } catch (e) { console.warn('push error', String(e && e.message || e)); }
  return { r: 'fail', stmts: [D(`update push_subscriptions set fails = fails + 1 where endpoint = ?`, sub.endpoint), D(`delete from push_subscriptions where endpoint = ? and fails >= 20`, sub.endpoint)] };
}
async function flush(env, stmts) { if (stmts.length) { try { await env.DB.batch(stmts); } catch (e) { console.warn('push bookkeeping', String(e && e.message || e)); } } }

/* ---------- זמני תזכורת ---------- */
const settingsOf = (u) => { try { return { reminderTime: '20:00', pushReminders: true, socialDigest: true, lockScreenPrivacy: true, ...JSON.parse(u.settings || '{}') }; } catch { return { reminderTime: '20:00', pushReminders: true, socialDigest: true, lockScreenPrivacy: true }; } };
/* שעת התזכורת מההגדרות; כל ערך לא תקין (לא מחרוזת, שעה לא קיימת) = 20:00 */
function reminderHM(s) { const m = typeof s.reminderTime === 'string' && /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.reminderTime); return m ? [Number(m[1]), Number(m[2])] : [20, 0]; }
export const MORNING = [9, 0]; // הבוקר שאחרי: תזכורת אחרונה לפני שחלון הדיווח נסגר ב-10:00
/* הרגע הבא (מילישניות) שבו צריך לבדוק: התזכורת בערב בשעה שבחרה, או 09:00 למחרת. null = כבויה. */
export function nextSlot(user, now = Date.now()) {
  const s = settingsOf(user); if (!s.pushReminders) return null;
  const tz = user.timezone || 'Asia/Jerusalem';
  const [h, m] = reminderHM(s);
  const today = localDate(tz, new Date(now)); let best = null;
  for (const d of [today, addDays(today, 1)]) for (const [hh, mm] of [[h, m], MORNING]) {
    const t = zonedToUtc(d, hh, mm, tz).getTime(); if (t > now + 30000 && (best === null || t < best)) best = t;
  }
  return best;
}
export async function reschedule(env, userId) {
  const u = await env.DB.prepare(`select id, timezone, settings from users where id = ?`).bind(userId).first(); if (!u) return;
  await env.DB.prepare(`update push_subscriptions set next_at = ? where user_id = ?`).bind(nextSlot(u), userId).run();
}

/* ---------- נתיבי API ---------- */
export async function publicKey(env) { return { key: (await vapidKeys(env)).publicKey }; }
export async function subscribe(env, user, b) {
  const s = b && b.subscription; const endpoint = s && s.endpoint; const keys = (s && s.keys) || {};
  if (!endpoint || !PUSH_HOST.test(endpoint) || endpoint.length > 1024) throw err('BAD_ENDPOINT', 'כתובת התראות לא נתמכת');
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(keys.p256dh || '') || !/^[A-Za-z0-9_-]{16,30}$/.test(keys.auth || '')) throw err('BAD_KEYS', 'מפתחות לא תקינים');
  const platform = String(b.platform || '').slice(0, 24);
  // מכשיר אחד = מינוי אחד. אם מינוי עבר למשתמשת אחרת באותו מכשיר — הוא שלה עכשיו.
  await env.DB.prepare(`insert into push_subscriptions(endpoint, user_id, p256dh, auth, platform, created_at, next_at) values (?,?,?,?,?,?,?)
    on conflict(endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, platform = excluded.platform, next_at = excluded.next_at, fails = 0`)
    .bind(endpoint, user.id, keys.p256dh, keys.auth, platform, nowISO(), nextSlot(user)).run();
  // לכל היותר 6 מכשירים למשתמשת: הוותיקים נמחקים
  await env.DB.prepare(`delete from push_subscriptions where user_id = ? and endpoint not in (select endpoint from push_subscriptions where user_id = ? order by created_at desc limit 6)`).bind(user.id, user.id).run();
  return { ok: true };
}
export async function unsubscribe(env, user, b) {
  await env.DB.prepare(`delete from push_subscriptions where endpoint = ? and user_id = ?`).bind(String(b && b.endpoint || ''), user.id).run();
  return { ok: true };
}
export async function status(env, user, endpoint) {
  const row = endpoint ? await env.DB.prepare(`select 1 from push_subscriptions where endpoint = ? and user_id = ?`).bind(endpoint, user.id).first() : null;
  return { subscribed: !!row };
}
export async function test(env, user, b) {
  const sub = await env.DB.prepare(`select * from push_subscriptions where endpoint = ? and user_id = ?`).bind(String(b && b.endpoint || ''), user.id).first();
  if (!sub) throw err('NOT_SUBSCRIBED', 'ההתראות לא פעילות במכשיר הזה');
  if (sub.last_social_at && Date.now() - sub.last_social_at < 20000) throw err('SLOW_DOWN', 'רגע, עוד אחת כבר בדרך');
  await env.DB.prepare(`update push_subscriptions set last_social_at = ? where endpoint = ?`).bind(Date.now(), sub.endpoint).run();
  const { r, stmts } = await sendOne(env, sub, { title: 'ככה זה ייראה 🙂', body: 'מילה תזכיר לך לדווח, ותגיד כשמישהי עוקפת אותך.', url: '/?go=today', tag: 'test' }, { ttl: 300, urgency: 'high' });
  await flush(env, stmts);
  if (r !== 'ok') throw err('PUSH_FAILED', r === 'gone' ? 'המכשיר ביטל את ההתראות. צריך להפעיל מחדש.' : 'השליחה לא הצליחה. נסי שוב בעוד רגע.');
  return { ok: true };
}

/* ---------- התראות חברתיות מיד אחרי פעולה ---------- */
const PRIVATE_BODY = { group_word: (n) => (n.body || '').split(':')[0] };
export async function social(env, userIds) {
  const ids = [...new Set(userIds)].slice(0, 20); if (!ids.length) return;
  const P = ids.map(() => '?').join(',');
  const subs = (await env.DB.prepare(`select s.*, u.settings from push_subscriptions s join users u on u.id = s.user_id where s.user_id in (${P}) and u.status = 'active'`).bind(...ids).all()).results;
  if (!subs.length) return;
  // העדכון האחרון שלא נקרא לכל משתמשת, בשאילתה אחת
  const rows = (await env.DB.prepare(`select n.user_id, n.type, n.title, n.body, n.ref from notifications n where n.user_id in (${P}) and n.read = 0 and n.created_at = (select max(created_at) from notifications x where x.user_id = n.user_id and x.read = 0)`).bind(...ids).all()).results;
  const latest = new Map(rows.map(n => [n.user_id, n]));
  const now = Date.now(); let sent = 0; const stmts = [];
  for (const s of subs) {
    if (sent >= MAX_SENDS) break;
    try {
      const st = settingsOf(s); if (st.socialDigest === false) continue;
      if (s.last_social_at && now - s.last_social_at < 90000) continue; // לא יותר מאחת בדקה וחצי לכל מכשיר
      const n = latest.get(s.user_id); if (!n || !['overtake', 'invite', 'encouragement', 'group_word', 'circle_closed'].includes(n.type)) continue;
      let ref = {}; try { ref = JSON.parse(n.ref || '{}'); } catch { }
      const body = st.lockScreenPrivacy && PRIVATE_BODY[n.type] ? PRIVATE_BODY[n.type](n) : n.body;
      stmts.push(env.DB.prepare(`update push_subscriptions set last_social_at = ? where endpoint = ?`).bind(now, s.endpoint));
      const out = await sendOne(env, s, { title: n.title, body: body || '', tag: n.type, url: ref.circleId ? `/?go=circle&id=${encodeURIComponent(ref.circleId)}` : '/?go=today' }, { ttl: 24 * 3600, urgency: n.type === 'overtake' ? 'high' : 'normal' });
      stmts.push(...out.stmts); sent++;
    } catch (e) { console.warn('social push', String(e && e.message || e)); }
  }
  await flush(env, stmts);
}

/* ---------- Cron: תזכורות ----------
   מעט פניות ל-D1 בכל ריצה (שליפה אחת, ספירה אחת, batch אחד), ותקלה במינוי אחד לא עוצרת את האחרים:
   next_at של כל מינוי מתקדם תמיד, גם אם השליחה או החישוב נכשלו. */
const hm = (tz, t) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(t)); const g = (k) => Number(p.find(x => x.type === k).value) % 24; return [g('hour'), g('minute')]; };
export async function runReminders(env, now = Date.now()) {
  const due = (await env.DB.prepare(`select s.*, u.timezone, u.settings, u.status from push_subscriptions s join users u on u.id = s.user_id where s.next_at is not null and s.next_at <= ? order by s.next_at limit ?`).bind(now, MAX_SENDS).all()).results;
  const out = { due: due.length, sent: 0, skipped: 0 };
  if (!due.length) return out;
  const stmts = []; const nextStmts = []; const plan = new Map(); // user_id → { slotDay, morning, evening }
  for (const s of due) {
    let next = now + 6 * 3600000;   // אם החישוב נכשל: מנסות שוב בעוד 6 שעות, ולא נתקעות בראש התור
    try {
      const tz = s.timezone || 'Asia/Jerusalem';
      next = nextSlot(s, Math.max(now, s.next_at));   // null = התזכורות כבויות אצלה
      // סוג התזכורת והיום שלה נגזרים מהרגע המתוזמן (next_at), לא מהשעה שבה ה-cron רץ בפועל
      if (!plan.has(s.user_id) && s.status === 'active' && now - s.next_at < 3 * 3600000) { // איחור של יותר מ-3 שעות (השרת היה למטה) — מדלגות
        const [h, m] = hm(tz, s.next_at); const [rh, rm] = reminderHM(settingsOf(s));
        const isMorning = h === MORNING[0] && m === MORNING[1]; const isEvening = h === rh && m === rm;
        plan.set(s.user_id, { slotDay: localDate(tz, new Date(s.next_at)), morning: isMorning, evening: isEvening || !isMorning });
      }
    } catch (e) { console.warn('reminder plan', String(e && e.message || e)); }
    nextStmts.push(env.DB.prepare(`update push_subscriptions set next_at = ? where endpoint = ?`).bind(next, s.endpoint));
  }
  // התור מתקדם לפני השליחה: אם הריצה נקטעת באמצע, אף אחת לא מקבלת את אותה תזכורת שוב כל 5 דקות. אם העדכון נכשל — לא שולחות.
  await env.DB.batch(nextStmts);
  // כמה אתגרים עוד פתוחים לכל משתמשת, באתמול ובהיום של התזכורת: שאילתה אחת
  const open = new Map(); const users = [...plan.keys()];
  for (let i = 0; i < users.length; i += 30) {
    const part = users.slice(i, i + 30); const binds = []; const conds = [];
    for (const u of part) { const p = plan.get(u); conds.push('(o.user_id = ? and o.local_date in (?, ?))'); binds.push(u, addDays(p.slotDay, -1), p.slotDay); }
    const rows = (await env.DB.prepare(`select o.user_id, o.local_date, count(*) as n from daily_obligations o join word_commitments k on k.id = o.commitment_id where (${conds.join(' or ')}) and o.outcome is null and o.status in ('scheduled','open') and k.status = 'active' group by o.user_id, o.local_date`).bind(...binds).all()).results;
    for (const r of rows) open.set(r.user_id + '|' + r.local_date, r.n);
  }
  for (const s of due) {
    const p = plan.get(s.user_id); let msg = null;
    if (p) {
      const y = open.get(s.user_id + '|' + addDays(p.slotDay, -1)) || 0; const t = open.get(s.user_id + '|' + p.slotDay) || 0;
      if (p.morning && y > 0) msg = { title: 'נשאר עד 10:00 לדווח על אתמול', body: y === 1 ? 'אתגר אחד מאתמול עוד פתוח. עמדת בו?' : `${y} אתגרים מאתמול עוד פתוחים. עמדת בהם?`, url: '/?go=today', tag: 'reminder-morning' };
      else if (p.evening && t > 0) msg = { title: 'עמדת במילה שלך היום?', body: t === 1 ? 'נשאר אתגר אחד לדווח. לוקח שתי שניות.' : `נשארו ${t} אתגרים לדווח. לוקח שתי שניות.`, url: '/?go=today', tag: 'reminder' };
    }
    if (!msg) { out.skipped++; continue; }
    const r = await sendOne(env, s, msg, { ttl: 3 * 3600 });
    stmts.push(...r.stmts); if (r.r === 'ok') out.sent++;
  }
  await flush(env, stmts);
  return out;
}
