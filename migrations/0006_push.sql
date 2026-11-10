-- התראות Web Push: מינוי לכל מכשיר + מפתחות VAPID שנוצרים ב-Worker (לא סוד בקוד, לא שירות חיצוני)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint        TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  platform        TEXT,
  created_at      TEXT NOT NULL,
  next_at         INTEGER,            -- מתי לבדוק תזכורת (מילישניות UTC). NULL = תזכורות כבויות
  last_ok_at      TEXT,
  last_social_at  INTEGER,
  fails           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_next ON push_subscriptions(next_at) WHERE next_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS server_keys (
  id           TEXT PRIMARY KEY,
  public_key   TEXT NOT NULL,
  private_jwk  TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
