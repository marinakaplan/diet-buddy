-- תחום "זוגיות ואינטימיות" פתוח מגיל 18. תאריך הלידה עצמו לא נשמר: נשמר רק adult_from —
-- '1900-01-01' למי שכבר בת 18, או התאריך שבו תהיה בת 18. NULL = עוד לא נשאלה.
ALTER TABLE users ADD COLUMN adult_from TEXT;
-- מי שנרשמה עד עכשיו אישרה "אני בת 18 ומעלה" בהרשמה (הדרישה הוסרה יחד עם המיגרציה הזו)
UPDATE users SET adult_from = '1900-01-01' WHERE age_confirmed = 1 AND status = 'active';
