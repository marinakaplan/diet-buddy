-- אירועי מעקב זולים: מבקרת ייחודית ליום לכל שם אירוע (כניסה לאתר, לחיצה על כניסה, לחיצה על פרגון).
-- שורה אחת לכל (יום, אירוע, מבקרת) – insert or ignore, כך שגלישה חוזרת לא כותבת שוב.
CREATE TABLE IF NOT EXISTS track_events (
  day        TEXT NOT NULL,
  name       TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  PRIMARY KEY (day, name, visitor_id)
);
CREATE INDEX IF NOT EXISTS idx_track_name_day ON track_events(name, day);
CREATE INDEX IF NOT EXISTS idx_invites_created ON circle_invites(created_at);
CREATE INDEX IF NOT EXISTS idx_commitments_created ON word_commitments(created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON virtual_ledger(local_date);
