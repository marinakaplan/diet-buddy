/* ============================================================
   מילה — נתוני דמו (demo.js)
   זורע קבוצות, חברות ומילים כדי שהאפליקציה תרגיש חיה מהרגע הראשון.
   כל הדיווחים של החברות נוצרים דרך אותו מנוע ואותם חוקים.
   ============================================================ */
const MilaDemo = (() => {
  'use strict';

  const FRIENDS = [
    { name: 'יעל', color: 'pink' }, { name: 'נועה', color: 'lavender' }, { name: 'ענבל', color: 'lime' },
    { name: 'מאיה', color: 'peach' }, { name: 'דנה', color: 'mint' }, { name: 'שירה', color: 'sky' },
    { name: 'רותם', color: 'pink' }, { name: 'הילה', color: 'lavender' },
  ];

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
    const [yael, noa, inbal, maya, dana, shira, rotem, hila] = friends;

    // --- קבוצה 1: חברות קרובות (סבב ביום 8) ---
    const roundStart = Mila.addDays(today, -7);
    const c1 = Mila.createCircle({ name: 'חברות קרובות (דוגמה)', description: 'קבוצה לדוגמה. הבנות מהתיכון.', color: 'pink', roundStart: Mila.addDays(roundStart, -14) }).circle;
    addMembers(c1.id, [yael, noa, inbal, maya], Mila.addDays(roundStart, -14));

    // --- קבוצה 2: הבנות מהמשרד ---
    const c2 = Mila.createCircle({ name: 'הבנות מהמשרד (דוגמה)', description: 'קבוצה לדוגמה. בלי לחץ.', color: 'lavender', roundStart: Mila.addDays(today, -3) }).circle;
    addMembers(c2.id, [dana, shira, rotem], Mila.addDays(today, -3));

    // --- קבוצה 3: קבוצת ריצה ---
    const c3 = Mila.createCircle({ name: 'קבוצת ריצה (דוגמה)', description: 'קבוצה לדוגמה. ריצות קלות.', color: 'mint', roundStart: Mila.addDays(today, -1) }).circle;
    addMembers(c3.id, [hila], Mila.addDays(today, -1));
    // בקבוצה הריצה הילה היא המנהלת
    S.memberships.find(m => m.circleId === c3.id && m.userId === hila.id).role = 'admin';
    S.memberships.find(m => m.circleId === c3.id && m.userId === meUser.id).role = 'member';
    c3.ownerId = hila.id;

    // --- סבב קודם שהסתיים (היסטוריה לבנק) ---
    const prevStart = Mila.addDays(today, -22);
    const prevWord = asUser(meUser.id, () => Mila.createPersonalWord({ title: '8 כוסות מים', rule: 'שמונה כוסות מים לאורך היום', icon: 'water', startDate: prevStart }));
    simulate(prevWord.commitment.id, 0.82, rand, iso, { excuses: 1 });
    const prevWord2 = asUser(meUser.id, () => Mila.createPersonalWord({ title: 'בלי טלפון במיטה', rule: 'הטלפון מחוץ לחדר השינה מרגע הכיבוי', icon: 'noPhone', startDate: prevStart }));
    simulate(prevWord2.commitment.id, 0.7, rand, iso);

    // --- מילה קבוצתית: 8,000 צעדים (חברות קרובות) ---
    const steps = asUser(yael.id, () => Mila.proposeGroupWord(c1.id, { title: '8,000 צעדים ביום', rule: 'מונה הצעדים מראה 8,000 או יותר עד סוף היום', icon: 'run', startDate: roundStart }));
    steps.createdAt = iso(Mila.addDays(roundStart, -2));
    for (const u of [meUser, yael, noa, inbal, maya]) {
      const k = adoptBackdated(steps, u.id, roundStart, iso);
      simulate(k.id, u.id === meUser.id ? 0.86 : 0.55 + rand() * 0.4, rand, iso);
    }

    // --- המילים האישיות שלי בסבב הנוכחי ---
    const walk = asUser(meUser.id, () => Mila.createPersonalWord({ title: 'הליכה 30 דקות', rule: 'לפחות 30 דקות הליכה רצופה ביום', icon: 'walk', startDate: roundStart, circleId: c1.id, visibility: 'status' }));
    simulate(walk.commitment.id, 0.9, rand, iso);
    const read = asUser(meUser.id, () => Mila.createPersonalWord({ title: 'קריאה 10 עמודים', rule: 'קוראת 10 עמודים מספר (לא מסך)', icon: 'book', startDate: roundStart }));
    simulate(read.commitment.id, 0.75, rand, iso, { excuses: 1 });

    // --- הצעה פתוחה בקבוצה המשרד (תדגים את התקרה) ---
    const delivery = asUser(dana.id, () => Mila.proposeGroupWord(c2.id, { title: 'בלי משלוחים', rule: 'אף הזמנת אוכל במשלוח היום', icon: 'tools', startDate: Mila.addDays(today, -3) }));
    for (const u of [dana, shira]) { const k = adoptBackdated(delivery, u.id, Mila.addDays(today, -3), iso); simulate(k.id, 0.7, rand, iso); }

    // --- הצעה בקבוצה הריצה ---
    const runWord = asUser(hila.id, () => Mila.proposeGroupWord(c3.id, { title: 'ריצה 20 דקות', rule: 'ריצה קלה של 20 דקות, בכל קצב', icon: 'run', startDate: today }));
    asUser(hila.id, () => Mila.adoptGroupWord(runWord.id));

    // --- הזמנה ממאיה לקבוצה חדשה ---
    const c4 = asUser(maya.id, () => Mila.createCircle({ name: 'הבנות של מאיה', description: 'אתגר בלי סוכר ל-14 יום', color: 'peach', roundStart: Mila.addDays(today, 2) }));
    asUser(maya.id, () => Mila.proposeGroupWord(c4.circle.id, { title: 'בלי סוכר', rule: 'ללא ממתקים ומשקאות ממותקים', icon: 'noSugar', startDate: Mila.addDays(today, 2) }));
    S.pendingInvite = { token: c4.invite.token, from: maya.id };

    // --- עידודים ופיד ---
    const ev = S.socialEvents.filter(e => e.circleId === c1.id && e.actorId === meUser.id && e.type === 'day_success').slice(-1)[0];
    if (ev) { S.encouragements.push({ id: Mila.uid('r'), eventId: ev.id, userId: yael.id, reaction: 'clap', createdAt: Mila.nowISO() }); S.encouragements.push({ id: Mila.uid('r'), eventId: ev.id, userId: noa.id, reaction: 'heart', createdAt: Mila.nowISO() }); }
    S.socialEvents.push({ id: Mila.uid('e'), circleId: c1.id, actorId: yael.id, type: 'encouragement', payload: { toUserId: meUser.id, reaction: 'clap' }, createdAt: iso(today, 8) });

    // --- התראות ---
    S.notifications = [];
    Mila.notify(meUser.id, 'invite', 'מאיה: באה איתי?', 'הבנות של מאיה · בלי סוכר', { token: c4.invite.token });
    Mila.notify(meUser.id, 'encouragement', 'יעל שלחה לך מילה טובה', 'על הליכה 30 דקות', { circleId: c1.id });
    Mila.notify(meUser.id, 'group_word', 'באה איתי? · הבנות מהמשרד', 'דנה פתחה אתגר משותף: בלי משלוחים', { defId: delivery.id, circleId: c2.id });
    S.notifications.forEach((n, i) => { n.createdAt = iso(i === 0 ? today : Mila.addDays(today, -1), 9 + i); });

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
