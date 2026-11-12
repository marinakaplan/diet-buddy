-- אתגר אישי מופיע בכל הקבוצות של מי שלקחה אותו, ולכן עדכוני ההתקדמות שלה נקראים לפי מי שעשתה אותם
-- (ולא רק לפי הקבוצה שבה נרשמו). האינדקס שומר על הקריאה הזו זולה.
CREATE INDEX IF NOT EXISTS idx_events_actor ON social_events(actor_id, created_at);

-- עד היום אתגר שנוצר בלי קבוצה נשמר ״פרטי״ רק כי לא הייתה קבוצה לשתף איתה (לא מתוך בחירה).
-- מעכשיו ״פרטי״ הוא רק בחירה מפורשת (״רק אני״) או תחום רגיש. לכן, אצל מי שמעולם לא הייתה בקבוצה,
-- האתגרים האלה מסומנים כרגילים: אף אחת לא רואה אותם עד שהיא עצמה מצטרפת לקבוצה או פותחת אחת.
-- תחום רגיש (זוגיות) נשאר פרטי.
UPDATE word_definitions SET visibility = 'status'
WHERE kind = 'personal' AND visibility = 'private' AND status <> 'cancelled'
  AND (category IS NULL OR category <> 'couple')
  AND owner_id NOT IN (SELECT user_id FROM circle_memberships);
