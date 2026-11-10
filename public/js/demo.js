/* ============================================================
   מילה — נתוני דמו (demo.js)
   זורע קבוצות, חברות ומילים כדי שהאפליקציה תרגיש חיה מהרגע הראשון.
   כל הדיווחים של החברות נוצרים דרך אותו מנוע ואותם חוקים.
   ============================================================ */
const MilaDemo = (() => {
  'use strict';

  const FRIENDS = [{ name: 'יעל', color: 'pink' }, { name: 'נועה', color: 'lavender' }, { name: 'מאיה', color: 'peach' }];

  // מחולל פסאודו־אקראי דטרמיניסטי כדי שהדמו ייראה אותו דבר בכל טעינה
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  function seed(userName) {
    const S = Mila.getState();
    S.meta.seeding = true;
    const today = Mila.today();
    const rand = rng(Mila.hashStr(userName + 'mila'));
    const iso = (dateStr, h = 20) => { const d = new Date(dateStr + 'T00:00:00'); d.setHours(h, Math.floor(rand() * 59)); return d.toISOString(); };

    // משתמשת
    const meUser = Mila.createUser({ name: userName, ageConfirmed: true, color: 'lime' });
    S.me = meUser.id;
    const friends = FRIENDS.map(f => Mila.createUser({ name: f.name, ageConfirmed: true, color: f.color }));
    const [yael, noa, maya] = friends;

    // דוגמה מצומצמת: קבוצה אחת, שלוש חברות, שלושה אתגרים יומיומיים. מספיק כדי להבין, בלי עומס.
    const roundStart = Mila.addDays(today, -7);
    const c1 = Mila.createCircle({ name: 'חברות קרובות', description: 'הבנות מהתיכון.', color: 'pink', roundStart: Mila.addDays(roundStart, 0) }).circle;
    addMembers(c1.id, [yael, noa, maya], Mila.addDays(roundStart, -14));

    // אתגר משותף: עד 3 קפה ביום (יעל פתחה, כולן בפנים)
    const coffee = asUser(yael.id, () => Mila.proposeGroupWord(c1.id, { title: 'שותה רק 3 קפה ביום', rule: 'עד 3 כוסות קפה ביום, כולל בעבודה.', icon: 'coffee', startDate: roundStart }));
    coffee.createdAt = iso(Mila.addDays(roundStart, -2));
    for (const u of [meUser, yael, noa, maya]) {
      const k = adoptBackdated(coffee, u.id, roundStart, iso);
      simulate(k.id, u.id === meUser.id ? 0.86 : 0.55 + rand() * 0.35, rand, iso);
    }
    // אתגרים אישיים בתוך הקבוצה
    const voice = asUser(meUser.id, () => Mila.createPersonalWord({ title: 'לא מרימה את הקול על הילדים אחרי 18:00', rule: 'מ-18:00 ועד שהם נרדמים, בלי צעקות.', icon: 'home', startDate: roundStart, circleId: c1.id, visibility: 'status' }));
    simulate(voice.commitment.id, 0.8, rand, iso);
    const plate = asUser(meUser.id, () => Mila.createPersonalWord({ title: 'אוכלת קודם ירקות ואח״כ את החלבון ומפחיתה פחמימה', rule: 'בכל ארוחה: קודם הירקות, אחר כך החלבון, והפחמימה בסוף ובקטן.', icon: 'leaf', startDate: roundStart, circleId: c1.id, visibility: 'status' }));
    simulate(plate.commitment.id, 0.9, rand, iso);

    // מילה טובה מיעל
    const ev = S.socialEvents.filter(e => e.circleId === c1.id && e.actorId === meUser.id && e.type === 'day_success').slice(-1)[0];
    if (ev) S.encouragements.push({ id: Mila.uid('r'), eventId: ev.id, userId: yael.id, reaction: 'clap', createdAt: Mila.nowISO() });
    S.socialEvents.push({ id: Mila.uid('e'), circleId: c1.id, actorId: yael.id, type: 'encouragement', payload: { toUserId: meUser.id, reaction: 'clap' }, createdAt: iso(today, 8) });
    S.notifications = [];
    Mila.notify(meUser.id, 'encouragement', 'יעל שלחה לך מילה טובה', 'על הקפה 😉', { circleId: c1.id });

    // סדר כרונולוגי לפיד: אירועי דמו קיבלו זמן אמיתי, נדגום להם זמנים מפוזרים
    S.socialEvents.forEach(e => { if (e.payload && e.payload.date) e.createdAt = iso(e.payload.date, 18 + Math.floor(rand() * 5)); });

    S.meta.demo = true;
    S.meta.seeding = false;
    Mila.refreshStatuses();
    Mila.save();
    return meUser;
  }

  /* אימוץ מילה קבוצתית עם תאריך התחלה בעבר (לדמו בלבד) */
  function adoptBackdated(def, userId, startDate, iso) {
    const S = Mila.getState();
    const k = Mila.createCommitment(def.id, userId, startDate);
    k.createdAt = iso(Mila.addDays(startDate, -1), 12);
    if (def.status === 'proposed') def.status = 'active';
    S.socialEvents.push({ id: Mila.uid('e'), circleId: def.circleId, actorId: userId, type: 'group_word_adopted', payload: { defId: def.id, title: def.title }, createdAt: k.createdAt });
    Mila.grant(userId, 'first_word', def.id);
    return k;
  }

  function addMembers(circleId, users, joinedAt) {
    const S = Mila.getState();
    for (const u of users) S.memberships.push({ id: Mila.uid('m'), circleId, userId: u.id, role: 'member', joinedAt: new Date(joinedAt + 'T10:00:00').toISOString(), leftAt: null });
  }

  /* הרצת פעולה בשם משתמשת אחרת (בדמו בלבד – בשרת זה יהיה אימות אמיתי) */
  function asUser(userId, fn) {
    const S = Mila.getState();
    const prev = S.me; S.me = userId;
    try { return fn(); } finally { S.me = prev; }
  }

  /* סימולציה של דיווחים לימים שעברו */
  function simulate(commitmentId, successRate, rand, iso, { untilYesterday = false, excuses = 0 } = {}) {
    const S = Mila.getState();
    const today = Mila.today();
    const c = S.commitments[commitmentId];
    const def = S.wordDefs[c.defId];
    let excusesLeft = excuses;
    const prev = S.me; S.me = c.userId;
    try {
      for (const o of Mila.obligationsOf(commitmentId)) {
        if (o.localDate >= today) continue;
        if (untilYesterday && o.localDate > Mila.addDays(today, -1)) continue;
        const r = rand();
        let outcome = r < successRate ? 'success' : 'miss';
        if (outcome === 'miss' && excusesLeft > 0 && rand() < 0.5) { outcome = 'excused'; excusesLeft--; }
        // הכרעה ישירה (כמו דיווח שבוצע באותו יום)
        const at = iso(o.localDate, 19 + Math.floor(rand() * 4));
        o.status = 'open';
        resolveAt(o, outcome, def, at);
      }
    } finally { S.me = prev; }
  }

  function resolveAt(o, outcome, def, at) {
    const S = Mila.getState();
    const c = S.commitments[o.commitmentId];
    o.outcome = outcome;
    o.status = outcome === 'success' ? 'confirmed_success' : outcome === 'miss' ? 'confirmed_miss' : 'excused';
    o.resolvedAt = at; o.reportedAt = at; o.resolveReason = 'self_report';
    S.resolutionHistory.push({ id: Mila.uid('h'), obligationId: o.id, from: 'open', to: o.status, reason: 'self_report', actorId: o.userId, at });
    if (outcome !== 'excused') {
      const type = outcome === 'success' ? 'EARN' : def.circleId ? 'MISS_TO_CIRCLE' : 'MISS_PERSONAL';
      S.ledger.push({ id: Mila.uid('t'), obligationId: o.id, userId: o.userId, type, circleId: def.circleId || null, defId: def.id, amount: 1, reversalOf: null, createdAt: at, localDate: o.localDate });
    }
    if (outcome === 'success') {
      Mila.grant(o.userId, 'first_day', o.id);
      const s = Mila.streak(c.id).current;
      if (s >= 7) Mila.grant(o.userId, 'streak_7', c.id);
    }
    if (def.circleId && def.visibility !== 'private') {
      S.socialEvents.push({ id: Mila.uid('e'), circleId: def.circleId, actorId: o.userId, type: outcome === 'success' ? 'day_success' : outcome === 'miss' ? 'day_miss' : 'day_excused', payload: { title: def.title, defId: def.id, date: o.localDate }, createdAt: at });
    }
  }

  return { seed, FRIENDS };
})();
