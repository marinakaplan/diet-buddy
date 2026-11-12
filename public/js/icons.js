/* ============================================================
   מילה — מערכת אייקונים (SVG, קו 1.8, קצוות מעוגלים)
   ============================================================ */
const ICONS = (() => {
  const w = (body, sw = 1.8) => (s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  return {
    home: w('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>'),
    users: w('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.5c2.8.2 4.6 1.8 5 4.5"/>'),
    user: w('<circle cx="12" cy="8" r="4"/><path d="M4 21c.6-4.2 3.6-6.5 8-6.5s7.4 2.3 8 6.5"/>'),
    bell: w('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    coins: w('<ellipse cx="10" cy="7" rx="6.5" ry="3"/><path d="M3.5 7v4c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3V7"/><path d="M3.5 11v4c0 1.7 2.9 3 6.5 3 1 0 2-.1 2.8-.3"/><path d="M14 14.5c2.6.3 5 1.4 5 3 0 1.7-2.9 3-6.5 3-1.2 0-2.3-.1-3.2-.4"/>'),
    coin: w('<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5h3.2a2 2 0 0 1 0 4H9.5M9.5 9.5v7M9.5 13.5h3"/>'),
    plus: w('<path d="M12 5v14M5 12h14"/>', 2.2),
    check: w('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 2.4),
    refresh: w('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.5h-4.5"/>', 2),
    x: w('<path d="M6 6l12 12M18 6 6 18"/>', 2.2),
    back: w('<path d="M15 5l-7 7 7 7"/>', 2),         // LTR: חזרה מצביעה שמאלה
    chev: w('<path d="M9 5l7 7-7 7"/>', 2),           // LTR: המשך מצביע ימינה
    sun: w('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    moon: w('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
    walk: w('<circle cx="13" cy="4" r="1.8"/><path d="M10.5 21l2-6 2.5 2.5V21"/><path d="M8 13l2.5-5 3 1.5 2 3.5 2.5 1"/><path d="M8.5 21l2.5-6.5"/><path d="M12.5 9.5 10 12"/>'),
    run: w('<circle cx="15" cy="4" r="1.8"/><path d="M6 21l4-6 3 2 2.5-5.5"/><path d="M11 10l3-2 2 3 3 1"/><path d="M14 8l-3 2-3.5-1"/><path d="M4 15l3.5-1"/>'),
    book: w('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/><path d="M9 8h7M9 11h5"/>'),
    tools: w('<path d="M5 3v8c0 1.5 1 2.5 2.5 2.5S10 12.5 10 11V3"/><path d="M7.5 13.5V21"/><path d="M5 3v4M10 3v4"/><path d="M17 3c-2 1.5-3 4-3 7 0 1.5 1 2.5 2 2.5h1V21"/>'),
    noPhone: w('<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/><path d="M4 4l16 16"/>'),
    water: w('<path d="M12 3.5c3.5 4.5 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 2.5-6.5 6-11z"/><path d="M9 15a3 3 0 0 0 2.5 2.8"/>'),
    sleep: w('<path d="M3 18V9.5h12a4 4 0 0 1 4 4V18"/><path d="M3 15h16M3 18v2M19 18v2"/><circle cx="7" cy="12" r="1.5"/>'),
    noSugar: w('<path d="M12 7c-4 0-7 3-7 7 0 3.5 2.5 6.5 5 6.5 1 0 1.5-.5 2-.5s1 .5 2 .5c2.5 0 5-3 5-6.5 0-4-3-7-7-7z"/><path d="M12 7V4.5M12 4.5c1.5-1.5 3-1.5 4-1"/><path d="M5 5l14 14"/>'),
    meditate: w('<circle cx="12" cy="5" r="2"/><path d="M8 11.5c1-1.5 2.5-2 4-2s3 .5 4 2"/><path d="M12 9.5v6"/><path d="M4 19c2-1 4-2 5.5-3.5L12 15.5l2.5 0C16 17 18 18 20 19"/><path d="M4 19h16"/>'),
    pencil: w('<path d="M4 20l4-1L19.5 7.5a2 2 0 0 0-3-3L5 16z"/><path d="M14.5 6.5 17.5 9.5"/>'),
    heart: w('<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>'),
    leaf: w('<path d="M5 19C5 10 10 5 20 4c-.5 9-5 14.5-13 15"/><path d="M5 19c3-5 6-8 10-10"/>'),
    sprout: w('<path d="M12 21v-8"/><path d="M12 13c0-4-3-6.5-7-6.5 0 4 3 6.5 7 6.5z"/><path d="M12 10c0-3.5 2.5-6 6.5-6 0 3.5-2.5 6-6.5 6z"/>'),
    coffee: w('<path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M16 11h1.5a2 2 0 0 1 0 4H16"/><path d="M8 5.5c0-1 .8-1 .8-2M11.5 5.5c0-1 .8-1 .8-2"/>'),
    dumbbell: w('<path d="M4 10v4M20 10v4M6.5 8v8M17.5 8v8M6.5 12h11"/>'),
    call: w('<path d="M5 4h4l1.5 4L8.5 9.5a11 11 0 0 0 6 6L16 13.5l4 1.5v4a1.5 1.5 0 0 1-1.5 1.5C10 20.5 3.5 14 3.5 5.5A1.5 1.5 0 0 1 5 4z"/>'),
    calendar: w('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    repeat: w('<path d="M4 11a7 7 0 0 1 12-5l2 2"/><path d="M18 4v4h-4"/><path d="M20 13a7 7 0 0 1-12 5l-2-2"/><path d="M6 20v-4h4"/>'),
    eye: w('<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
    eyeOff: w('<path d="M3 3l18 18"/><path d="M10.5 6c.5-.1 1-.1 1.5-.1 6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.8"/><path d="M6.5 7.3A15 15 0 0 0 2.5 12s3.5 6.5 9.5 6.5c1.4 0 2.6-.3 3.7-.8"/><path d="M9.9 9.9a2.8 2.8 0 0 0 4 4"/>'),
    trophy: w('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 3.5M16 6h3a3 3 0 0 1-3 3.5"/><path d="M12 13v3M9 20h6M10 16.5h4L15 20H9z"/>'),
    medal: w('<circle cx="12" cy="14.5" r="5"/><path d="M9 10 6 3h4l2 4 2-4h4l-3 7"/><path d="m12 12.5.9 1.8 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z"/>'),
    flame: w('<path d="M12 21c-4 0-6.5-2.7-6.5-6.3 0-3 2.5-5.3 3.5-8.2 1.5 1.5 2.2 3 2.2 4.5 1.3-1 2-2.7 2-5 3 2 5.3 5 5.3 8.7 0 3.6-2.5 6.3-6.5 6.3z"/><path d="M12 21c-1.8 0-3-1.3-3-3 0-1.5 1.2-2.5 1.8-3.6.8.7 1.2 1.4 1.2 2.2.8-.5 1.1-1.3 1.1-2.3 1.3 1 2 2.3 2 3.7 0 1.7-1.3 3-3.1 3z"/>'),
    shield: w('<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/><path d="m9.5 12 2 2 3.5-4"/>'),
    flag: w('<path d="M5 21V4"/><path d="M5 4h12l-2.5 4 2.5 4H5"/>'),
    share: w('<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'),
    link: w('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    copy: w('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
    settings: w('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4.9a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2 1.2l-2.4-.9-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-.9a7 7 0 0 0 2 1.2L10 21h4l.5-2.5a7 7 0 0 0 2-1.2l2.4.9 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z"/>'),
    sparkle: w('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>'),
    clock: w('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    info: w('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>'),
    lock: w('<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
    logout: w('<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M15 8l4 4-4 4M19 12H9"/>'),
    trash: w('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/><path d="M10 11v5M14 11v5"/>'),
    edit: w('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/>'),
    target: w('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>'),
    clap: w('<path d="M7 11 4.5 8.5a1.4 1.4 0 0 1 2-2L10 10"/><path d="M10 10 6.5 6.5a1.4 1.4 0 0 1 2-2L13 9"/><path d="M13 9 9.5 5.5a1.4 1.4 0 0 1 2-2L16 8"/><path d="M16 8l-1-1a1.4 1.4 0 0 1 2-2l3 3c2 2 2 5.5 0 7.5l-2 2c-2.5 2.5-6 2.5-8.5 0L5 13a1.4 1.4 0 0 1 2-2l3 3"/>'),
    muscle: w('<path d="M5 16c0-4 2-7 4-9l3-3 2 2-1 3 3-1 3 2c1 2 1 5-1 7l-3 3c-3 3-10 1-10-4z"/><path d="M9 14c1-1 2.5-1 3.5 0"/>'),
    star: w('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
    chart: w('<path d="M4 20h16"/><path d="M7 16v-5M12 16V7M17 16v-3"/>'),
    gift: w('<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M4 13h16M12 9v11"/><path d="M12 9c-2 0-4.5-1-4.5-3S10 3.5 12 9zM12 9c2 0 4.5-1 4.5-3S14 3.5 12 9z"/>'),
    smile: w('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14c1 1.5 2.2 2 3.5 2s2.5-.5 3.5-2"/><path d="M9 10h.01M15 10h.01"/>'),
    download: w('<path d="M12 4v11"/><path d="m8 11 4 4 4-4"/><path d="M5 19h14"/>'),
    more: w('<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>', 2.4),
    inbox: w('<path d="M4 13 6.5 5h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h5l1 2h4l1-2h5"/>'),
    hourglass: w('<path d="M7 3h10M7 21h10M8 3c0 5 4 6 4 9s-4 4-4 9M16 3c0 5-4 6-4 9s4 4 4 9"/>'),
    minus: w('<path d="M5 12h14"/>', 2.2),
  };
})();

function icon(name, size = 22) {
  const fn = ICONS[name] || ICONS.leaf;
  return `<span class="ic">${fn(size)}</span>`;
}

/* הלוגו: ריבוע ליים מעוגל עם חיוך */
function logoMark(size = 40) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><rect x="2" y="2" width="44" height="44" rx="14" fill="#D9F565"/><path d="M15 21c1.5-2.5 4.5-2.5 6 0M27 21c1.5-2.5 4.5-2.5 6 0" stroke="#1B1B1F" stroke-width="2.6" stroke-linecap="round" fill="none"/><path d="M18 30c3 3 9 3 12 0" stroke="#1B1B1F" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>`;
}

/* אווטאר חייכן צבעוני לפי שם */
const AVATAR_FILL = { lime: '#D9F565', pink: '#FFC3DF', lavender: '#D9CBFF', mint: '#C8F2DE', peach: '#FFD9C2', sky: '#C9E3FF' };
/* הפרצוף חי: ממצמץ מדי פעם וחיוך קטן (כל פרצוף בתזמון משלו, לפי השם). פרצופים גדולים גם מרחפים בעדינות.
   mood: 'happy' (קופץ משמחה, למשל כשעמדה בכל האתגרים היום). האנימציות ב-styles.css, וכבות ב״הפחתת תנועה״. */
function avatar(user, size = 36, mood = '') {
  const color = (user && user.color) || 'sky';
  const fill = AVATAR_FILL[color] || AVATAR_FILL.sky;
  const seed = user && user.name ? Mila.hashStr(user.name) : 0;
  const variant = seed % 3;
  const eyes = variant === 0 ? '<circle cx="16" cy="21" r="2.2" fill="#1B1B1F"/><circle cx="32" cy="21" r="2.2" fill="#1B1B1F"/>'
    : variant === 1 ? '<path d="M13 22c1.5-2.5 4.5-2.5 6 0M29 22c1.5-2.5 4.5-2.5 6 0" stroke="#1B1B1F" stroke-width="2.4" stroke-linecap="round" fill="none"/>'
    : '<circle cx="16" cy="21" r="2.2" fill="#1B1B1F"/><path d="M29 22c1.5-2.5 4.5-2.5 6 0" stroke="#1B1B1F" stroke-width="2.4" stroke-linecap="round" fill="none"/>';
  const mouth = variant === 2 ? '<path d="M18 30c3 2 9 2 12 0" stroke="#1B1B1F" stroke-width="2.4" stroke-linecap="round" fill="none"/>' : '<path d="M18 29c3 3.5 9 3.5 12 0" stroke="#1B1B1F" stroke-width="2.4" stroke-linecap="round" fill="none"/>';
  const cls = ['avatar', size >= 56 ? 'av-big' : '', mood === 'happy' ? 'av-happy' : ''].filter(Boolean).join(' ');
  const delay = ((seed % 37) / 10).toFixed(1);   // 0–3.6 שניות: לא כולן ממצמצות יחד
  return `<span class="${cls}" style="width:${size}px;height:${size}px;--avd:${delay}s" title="${user && user.name ? String(user.name).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';') : ''}"><svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true"><circle cx="24" cy="24" r="23" fill="${fill}"/><g class="av-face"><g class="av-eyes">${eyes}</g><g class="av-mouth">${mouth}</g></g></svg></span>`;
}
function avatarStack(users, size = 30, max = 4) {
  // תמיד לכל היותר max עיגולים: אם יש יותר, העיגול האחרון הוא ״+N״ (כך כל הכרטיסים באותו רוחב)
  const shown = users.length > max ? users.slice(0, max - 1) : users;
  const extra = users.length - shown.length;
  return `<span class="avatar-stack">${shown.map(u => avatar(u, size)).join('')}${extra > 0 ? `<span class="avatar avatar-more" dir="ltr" style="width:${size}px;height:${size}px">+${extra}</span>` : ''}</span>`;
}

/* פרצוף מצב למסכים ריקים ולמסכי שגיאה: אותו פרצוף של מילה, בהבעה שמתאימה למצב.
   sleepy = עוד אין כאן כלום · wink = בואי נתחיל · happy = הכול טוב · oops = משהו השתבש · offline = אין חיבור */
function moodFace(mood = 'sleepy', size = 72) {
  const ink = '#1B1B1F'; const st = `stroke="${ink}" stroke-width="2.6" stroke-linecap="round" fill="none"`;
  const M = {
    sleepy: { fill: '#E3DAFB', body: `<path d="M13 22c1.5 2 4.5 2 6 0M29 22c1.5 2 4.5 2 6 0" ${st}/><path d="M21 31.5c1.5 1 4.5 1 6 0" ${st}/><g class="mood-z" stroke="${ink}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M33 8.5h4.5l-4.5 4.5h4.5"/><path d="M39.5 3.5h3l-3 3h3" opacity=".6"/></g>` },
    wink: { fill: '#D5F1E3', body: `<circle cx="16" cy="21.5" r="2.5" fill="${ink}"/><path d="M29 22c1.5-2.5 4.5-2.5 6 0" ${st}/><path d="M17 29.5c3.5 4 10.5 4 14 0" ${st}/>` },
    happy: { fill: '#D9F565', body: `<path d="M13 22.5c1.5-2.5 4.5-2.5 6 0M29 22.5c1.5-2.5 4.5-2.5 6 0" ${st}/><path d="M16.5 29c3.5 4.5 11.5 4.5 15 0" ${st}/>` },
    oops: { fill: '#FFD3E4', body: `<path d="M12 15l7-1.6M36 15l-7-1.6" ${st}/><circle cx="16" cy="22" r="2.6" fill="${ink}"/><circle cx="32" cy="22" r="2.6" fill="${ink}"/><ellipse cx="24" cy="32" rx="3" ry="3.6" ${st}/><path class="mood-drop" d="M39.5 9.5c1.5 2 2.2 3.1 2.2 4.2a2.2 2.2 0 0 1-4.4 0c0-1.1.7-2.2 2.2-4.2z" fill="#7DB9F5"/>` },
    offline: { fill: '#FFD9C7', body: `<circle cx="16" cy="21.5" r="2.5" fill="${ink}"/><path d="M29.5 19l5 5M34.5 19l-5 5" ${st}/><path d="M16 32c2.2-2.4 4.4 2.4 8 0s5.8 2.4 8 0" ${st}/>` },
  };
  const m = M[mood] || M.sleepy;
  return `<svg class="mood mood-${M[mood] ? mood : 'sleepy'}" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><rect x="2" y="2" width="44" height="44" rx="14" fill="${m.fill}"/>${m.body}</svg>`;
}

/* לוגו חי: עצבני בזמן שהתירוצים נמחקים, מחייך כשהחותמת נוחתת, ממצמץ,
   ומדי פעם מציץ הצידה עם גבות מורמות וחיוך עקום ("נראה אם תעמדי בזה"). */
function liveLogo(size = 26) {
  const ink = '#1B1B1F';
  return `<svg class="live-logo" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">
    <rect x="2" y="2" width="44" height="44" rx="14" fill="#D9F565"/>
    <g class="ll-brows" stroke="${ink}" stroke-width="2.8" stroke-linecap="round"><path d="M11 14.5l8 3.2"/><path d="M37 14.5l-8 3.2"/></g>
    <g class="ll-eyes-narrow"><g class="ll-eyes-blink"><g class="ll-pupils" fill="${ink}"><circle cx="16.5" cy="22.5" r="2.8"/><circle cx="31.5" cy="22.5" r="2.8"/></g></g></g>
    <path class="ll-frown" d="M17.5 33c3.5-3 9.5-3 13 0" stroke="${ink}" stroke-width="2.8" stroke-linecap="round" fill="none"/>
    <path class="ll-smile" d="M16.5 29c3.8 4.4 11.2 4.4 15 0" stroke="${ink}" stroke-width="2.8" stroke-linecap="round" fill="none"/>
  </svg>`;
}
