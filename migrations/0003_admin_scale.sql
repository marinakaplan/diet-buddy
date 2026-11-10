-- מילה: פאנל ניהול, ייחוס הזמנות, ופעילות יומית זולה.
-- מנהלת המערכת (לא מנהלת קבוצה): רואה את פאנל הניהול.
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
-- ייחוס: מי הביאה אותה (נגיעה ראשונה), ודרך איזו הזמנה.
ALTER TABLE users ADD COLUMN invited_by TEXT;
ALTER TABLE users ADD COLUMN invited_via TEXT;
CREATE INDEX IF NOT EXISTS idx_users_invited_by ON users(invited_by);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
-- הצטרפות לקבוצה דרך הזמנה
ALTER TABLE circle_memberships ADD COLUMN via_invite TEXT;
-- פתיחות קישור הזמנה (גם לפני התחברות). מבקרת ייחודית לכל קישור: (token_hash, visitor_id).
CREATE TABLE IF NOT EXISTS invite_opens (
  token_hash  TEXT NOT NULL,
  visitor_id  TEXT NOT NULL,
  inviter_id  TEXT NOT NULL,
  circle_id   TEXT NOT NULL,
  kind        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (token_hash, visitor_id)
);
CREATE INDEX IF NOT EXISTS idx_invite_opens_inviter ON invite_opens(inviter_id);
CREATE INDEX IF NOT EXISTS idx_invite_opens_created ON invite_opens(created_at);
CREATE INDEX IF NOT EXISTS idx_invites_inviter ON circle_invites(inviter_id);
-- משתמשת פעילה ביום: שורה אחת ליום (במקום כתיבה בכל רענון)
CREATE TABLE IF NOT EXISTS user_days (
  day     TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (day, user_id)
);
-- אינדקסים לסטטיסטיקה ולריענון הקל
CREATE INDEX IF NOT EXISTS idx_events_created ON social_events(created_at);
CREATE INDEX IF NOT EXISTS idx_history_created ON resolution_history(created_at);
CREATE INDEX IF NOT EXISTS idx_circles_created ON circles(created_at);
CREATE INDEX IF NOT EXISTS idx_membership_via ON circle_memberships(via_invite);
CREATE INDEX IF NOT EXISTS idx_user_days_user ON user_days(user_id, day);
