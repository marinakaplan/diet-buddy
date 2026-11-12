-- מילה — סכמת D1 (SQLite)
-- החוקים הקריטיים נאכפים בשכבת ה-Worker ובטריגרים כאן:
--   * תקרת 3 אירועים מחייבים ליום למשתמשת (טריגר) — D1 מסדר כתיבות, וכל פעולה רצה כ-batch אטומי.
--   * יומן תנועות append-only (טריגרים שחוסמים UPDATE/DELETE).
--   * תנועת הכרעה אחת לכל (אירוע, מספר הכרעה) — אינדקס ייחודי.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT UNIQUE,
  google_sub     TEXT UNIQUE,
  display_name   TEXT NOT NULL,
  color          TEXT NOT NULL DEFAULT 'sky',
  timezone       TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
  age_confirmed  INTEGER NOT NULL DEFAULT 0,
  terms_accepted_at TEXT,
  settings       TEXT NOT NULL DEFAULT '{"reminderTime":"20:00","pushReminders":true,"socialDigest":true,"hideFromLeaderboard":false,"lockScreenPrivacy":true}',
  status         TEXT NOT NULL DEFAULT 'pending',   -- pending (עוד בלי פרופיל) | active | deleted
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at   TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS circles (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  description     TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 120),
  owner_id        TEXT NOT NULL REFERENCES users(id),
  color           TEXT NOT NULL DEFAULT 'pink',
  who_can_propose TEXT NOT NULL DEFAULT 'all' CHECK (who_can_propose IN ('all','admins')),
  max_members     INTEGER NOT NULL DEFAULT 8 CHECK (max_members BETWEEN 2 AND 50),
  round_start     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS circle_memberships (
  id         TEXT PRIMARY KEY,
  circle_id  TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  joined_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  left_at    TEXT,
  removed_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_membership ON circle_memberships(circle_id, user_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_membership_user ON circle_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_membership_circle ON circle_memberships(circle_id);

CREATE TABLE IF NOT EXISTS circle_invites (
  token_hash TEXT PRIMARY KEY,
  token_hint TEXT NOT NULL,
  circle_id  TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  inviter_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  max_uses   INTEGER NOT NULL DEFAULT 20,
  uses       INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_invites_circle ON circle_invites(circle_id);

CREATE TABLE IF NOT EXISTS word_definitions (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('personal','group')),
  circle_id  TEXT REFERENCES circles(id),
  owner_id   TEXT NOT NULL REFERENCES users(id),
  title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  rule       TEXT NOT NULL CHECK (length(rule) BETWEEN 1 AND 200),
  icon       TEXT NOT NULL DEFAULT 'leaf',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','status','summary')),
  version    INTEGER NOT NULL DEFAULT 1,
  start_date TEXT NOT NULL,
  end_date   TEXT,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('proposed','active','cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (kind = 'personal' OR circle_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_defs_circle ON word_definitions(circle_id);
CREATE INDEX IF NOT EXISTS idx_defs_owner ON word_definitions(owner_id);

CREATE TABLE IF NOT EXISTS word_commitments (
  id            TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES word_definitions(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  timezone      TEXT NOT NULL,                       -- ננעל בתחילת הסבב (סעיף 10.1)
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','ended_early','cancelled')),
  end_reason    TEXT,
  summary_seen  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at  TEXT,
  CHECK (end_date >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commitment_per_def ON word_commitments(definition_id, user_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_commitments_user ON word_commitments(user_id);
CREATE INDEX IF NOT EXISTS idx_commitments_def ON word_commitments(definition_id);

CREATE TABLE IF NOT EXISTS daily_obligations (
  id             TEXT PRIMARY KEY,
  commitment_id  TEXT NOT NULL REFERENCES word_commitments(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id),
  local_date     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','open','confirmed_success','confirmed_miss','excused','cancelled')),
  outcome        TEXT CHECK (outcome IN ('success','miss','excused')),
  resolution_no  INTEGER NOT NULL DEFAULT 0,         -- עולה בכל הכרעה/תיקון; מפתח לתנועה
  resolve_reason TEXT,
  resolved_at    TEXT,
  corrected_at   TEXT,
  note           TEXT,
  UNIQUE (commitment_id, local_date)
);
CREATE INDEX IF NOT EXISTS idx_obligations_user_date ON daily_obligations(user_id, local_date);
CREATE INDEX IF NOT EXISTS idx_obligations_commitment ON daily_obligations(commitment_id);

-- תקרה: הגנה אחרונה ברמת הטבלה. ה-Worker בודק קודם, והבדיקה כאן רצה בתוך אותו batch אטומי.
CREATE TRIGGER IF NOT EXISTS trg_daily_cap BEFORE INSERT ON daily_obligations
WHEN NEW.status <> 'cancelled' AND (SELECT COUNT(*) FROM daily_obligations WHERE user_id = NEW.user_id AND local_date = NEW.local_date AND status <> 'cancelled') >= 3
BEGIN
  SELECT RAISE(ABORT, 'DAILY_CAP_EXCEEDED');
END;

CREATE TABLE IF NOT EXISTS resolution_history (
  id            TEXT PRIMARY KEY,
  obligation_id TEXT NOT NULL REFERENCES daily_obligations(id) ON DELETE CASCADE,
  from_state    TEXT,
  to_state      TEXT NOT NULL,
  reason        TEXT NOT NULL,
  actor_id      TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_history_obligation ON resolution_history(obligation_id);

CREATE TABLE IF NOT EXISTS virtual_ledger (
  id               TEXT PRIMARY KEY,
  obligation_id    TEXT NOT NULL REFERENCES daily_obligations(id),
  user_id          TEXT NOT NULL REFERENCES users(id),
  definition_id    TEXT NOT NULL REFERENCES word_definitions(id),
  circle_id        TEXT REFERENCES circles(id),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('EARN','MISS_TO_CIRCLE','MISS_PERSONAL','REVERSE')),
  amount           INTEGER NOT NULL CHECK (amount IN (1,-1)),
  resolution_no    INTEGER NOT NULL,
  reversal_of      TEXT REFERENCES virtual_ledger(id),
  local_date       TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- בדיוק תנועת הכרעה אחת לכל הכרעה של אירוע, וביטול אחד לכל תנועה
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_resolution ON virtual_ledger(obligation_id, resolution_no) WHERE transaction_type <> 'REVERSE';
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_reversal ON virtual_ledger(reversal_of) WHERE reversal_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_user ON virtual_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_circle ON virtual_ledger(circle_id);
-- append-only
CREATE TRIGGER IF NOT EXISTS trg_ledger_no_update BEFORE UPDATE ON virtual_ledger BEGIN SELECT RAISE(ABORT, 'LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS trg_ledger_no_delete BEFORE DELETE ON virtual_ledger BEGIN SELECT RAISE(ABORT, 'LEDGER_APPEND_ONLY'); END;

CREATE TABLE IF NOT EXISTS achievements (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  source_ref TEXT,
  earned_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, type)
);

CREATE TABLE IF NOT EXISTS social_events (
  id         TEXT PRIMARY KEY,
  circle_id  TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  actor_id   TEXT NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_circle ON social_events(circle_id, created_at DESC);

CREATE TABLE IF NOT EXISTS encouragements (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES social_events(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction   TEXT NOT NULL CHECK (reaction IN ('clap','heart','muscle','fire','star')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS abuse_reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  details     TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  ref        TEXT NOT NULL DEFAULT '{}',
  read       INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

-- מונה שימוש יומי (ניטור מכסות D1/Workers מתוך האפליקציה)
CREATE TABLE IF NOT EXISTS usage_daily (
  day       TEXT PRIMARY KEY,
  requests  INTEGER NOT NULL DEFAULT 0,
  writes    INTEGER NOT NULL DEFAULT 0
);
