-- מילה 2.0: ספריית אתגרים, פרס אישי, סוגי הזמנה.
-- אתגר מהספרייה: מזהה יציב + קטגוריה (לניתוח מצטבר עתידי; אין מסכי סטטיסטיקה ארצית).
ALTER TABLE word_definitions ADD COLUMN library_id TEXT;
ALTER TABLE word_definitions ADD COLUMN category TEXT;
ALTER TABLE word_definitions ADD COLUMN library_version INTEGER;
CREATE INDEX IF NOT EXISTS idx_defs_library ON word_definitions(library_id);
-- "אם אצליח, אני..." — הבטחה אישית. לא קשורה לשקלים ולא לתשלומים. משותפת רק בבחירה.
ALTER TABLE word_commitments ADD COLUMN reward TEXT;
ALTER TABLE word_commitments ADD COLUMN reward_shared INTEGER NOT NULL DEFAULT 0;
-- הזמנה: לעקוב (follow) / להתחרות (compete) / אותו אתגר (same), עם הודעה אישית.
ALTER TABLE circle_invites ADD COLUMN kind TEXT NOT NULL DEFAULT 'follow';
ALTER TABLE circle_invites ADD COLUMN message TEXT;
ALTER TABLE circle_invites ADD COLUMN library_id TEXT;
ALTER TABLE circle_invites ADD COLUMN word_title TEXT;
