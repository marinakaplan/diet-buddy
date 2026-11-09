-- ============================================================
-- מילה — סכמת נתונים (PostgreSQL / Supabase)
-- מימוש סעיף 22 באפיון. השרת הוא מקור האמת לחוקי המשחק.
-- כרגע האפליקציה רצה local-first (localStorage) עם אותו מודל נתונים;
-- הסכמה הזו מוכנה למעבר לשרת.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  locale        TEXT NOT NULL DEFAULT 'he',
  timezone      TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
  age_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  status        TEXT NOT NULL DEFAULT 'active',      -- active | deleted
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id            TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reminder_time      TIME DEFAULT '20:00',
  push_reminders     BOOLEAN NOT NULL DEFAULT TRUE,
  social_digest      BOOLEAN NOT NULL DEFAULT TRUE,
  hide_from_leaderboard BOOLEAN NOT NULL DEFAULT FALSE,
  lock_screen_privacy   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS circles (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  description    TEXT NOT NULL DEFAULT '',
  owner_id       TEXT NOT NULL REFERENCES users(id),
  color          TEXT NOT NULL DEFAULT 'pink',
  who_can_propose TEXT NOT NULL DEFAULT 'all',       -- all | admins
  max_members    INT  NOT NULL DEFAULT 8,
  round_start    DATE NOT NULL,                      -- עוגן לסבבים של 14 יום
  rules_version  INT  NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'active',     -- active | closing | archived
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS circle_memberships (
  id         TEXT PRIMARY KEY,
  circle_id  TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',         -- admin | member
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at    TIMESTAMPTZ,
  removed_by TEXT REFERENCES users(id)
);
-- חברוּת פעילה יחידה לכל משתמשת במעגל
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_membership ON circle_memberships(circle_id, user_id) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS circle_invites (
  token_hash  TEXT PRIMARY KEY,                      -- לא שומרים את האסימון עצמו
  circle_id   TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  inviter_id  TEXT NOT NULL REFERENCES users(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  max_uses    INT NOT NULL DEFAULT 20,
  uses        INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active',        -- active | revoked
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS word_definitions (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,                         -- personal | group
  circle_id   TEXT REFERENCES circles(id),
  owner_id    TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  rule        TEXT NOT NULL CHECK (char_length(rule) BETWEEN 1 AND 200),
  icon        TEXT NOT NULL DEFAULT 'leaf',
  visibility  TEXT NOT NULL DEFAULT 'private',       -- private | status | summary
  version     INT  NOT NULL DEFAULT 1,
  start_date  DATE NOT NULL,
  end_date    DATE,                                  -- למילה קבוצתית
  status      TEXT NOT NULL DEFAULT 'active',        -- proposed | active | cancelled | ended
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS word_commitments (
  id            TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES word_definitions(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',      -- active | completed | ended_early | cancelled
  end_reason    TEXT,
  summary_seen  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
-- אימוץ אחד פעיל לכל משתמשת למילה קבוצתית
CREATE UNIQUE INDEX IF NOT EXISTS uq_commitment_per_def ON word_commitments(definition_id, user_id) WHERE status <> 'cancelled';

CREATE TABLE IF NOT EXISTS daily_obligations (
  id             TEXT PRIMARY KEY,
  commitment_id  TEXT NOT NULL REFERENCES word_commitments(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id),
  local_date     DATE NOT NULL,
  status         TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | open | confirmed_success | confirmed_miss | excused | cancelled
  outcome        TEXT,                               -- success | miss | excused
  resolve_reason TEXT,                               -- self_report | auto_unreported | correction
  resolved_at    TIMESTAMPTZ,
  corrected_at   TIMESTAMPTZ,
  note           TEXT,
  UNIQUE (commitment_id, local_date)
);
CREATE INDEX IF NOT EXISTS idx_obligations_user_date ON daily_obligations(user_id, local_date);

-- תקרה: עד 3 אירועים מחייבים ליום למשתמשת. נאכף בטרנזקציה עם נעילה
-- (SELECT ... FOR UPDATE על שורות המשתמשת) בעת יצירה/אימוץ, לא רק בתצוגה.
CREATE OR REPLACE FUNCTION enforce_daily_cap() RETURNS TRIGGER AS $$
DECLARE n INT;
BEGIN
  IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO n FROM daily_obligations
   WHERE user_id = NEW.user_id AND local_date = NEW.local_date AND status <> 'cancelled' AND id <> NEW.id;
  IF n >= 3 THEN RAISE EXCEPTION 'DAILY_CAP_EXCEEDED for % on %', NEW.user_id, NEW.local_date; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_daily_cap ON daily_obligations;
CREATE TRIGGER trg_daily_cap BEFORE INSERT OR UPDATE ON daily_obligations FOR EACH ROW EXECUTE FUNCTION enforce_daily_cap();

CREATE TABLE IF NOT EXISTS reports (
  id              TEXT PRIMARY KEY,
  obligation_id   TEXT NOT NULL REFERENCES daily_obligations(id) ON DELETE CASCADE,
  reporter_id     TEXT NOT NULL REFERENCES users(id),
  outcome         TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,              -- חזרתיות בטוחה
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resolution_history (
  id            TEXT PRIMARY KEY,
  obligation_id TEXT NOT NULL REFERENCES daily_obligations(id) ON DELETE CASCADE,
  from_state    TEXT,
  to_state      TEXT NOT NULL,
  reason        TEXT NOT NULL,
  actor_id      TEXT,                                -- NULL = system
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- יומן תנועות וירטואלי: append-only. אין UPDATE/DELETE.
CREATE TABLE IF NOT EXISTS virtual_ledger (
  id               TEXT PRIMARY KEY,
  obligation_id    TEXT NOT NULL REFERENCES daily_obligations(id),
  user_id          TEXT NOT NULL REFERENCES users(id),
  definition_id    TEXT NOT NULL REFERENCES word_definitions(id),
  circle_id        TEXT REFERENCES circles(id),
  transaction_type TEXT NOT NULL,                    -- EARN | MISS_TO_CIRCLE | MISS_PERSONAL | REVERSE | (עתידי) ALLOCATE_IMPACT
  amount           INT  NOT NULL CHECK (amount IN (1, -1)),
  reversal_of      TEXT REFERENCES virtual_ledger(id),
  local_date       DATE NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- תנועת הכרעה פעילה אחת לכל אירוע (REVERSE אינו נספר)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_reversal ON virtual_ledger(reversal_of) WHERE reversal_of IS NOT NULL;
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'virtual_ledger is append-only'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ledger_ro ON virtual_ledger;
CREATE TRIGGER trg_ledger_ro BEFORE UPDATE OR DELETE ON virtual_ledger FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

-- יתרות נגזרות (לא נשמרות): כל סכום במסך מגיע מכאן
CREATE OR REPLACE VIEW active_ledger AS
  SELECT l.* FROM virtual_ledger l
  WHERE l.transaction_type <> 'REVERSE'
    AND NOT EXISTS (SELECT 1 FROM virtual_ledger r WHERE r.reversal_of = l.id);

CREATE OR REPLACE VIEW user_balances AS
  SELECT user_id,
         COUNT(*) FILTER (WHERE transaction_type = 'EARN')  AS earned_total,
         COUNT(*) FILTER (WHERE transaction_type <> 'EARN') AS missed_total
  FROM active_ledger GROUP BY user_id;

CREATE OR REPLACE VIEW circle_pools AS
  SELECT circle_id, COUNT(*) AS missed_pool
  FROM active_ledger WHERE transaction_type = 'MISS_TO_CIRCLE' GROUP BY circle_id;

CREATE TABLE IF NOT EXISTS achievements (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  source_ref TEXT,
  earned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, type)
);

CREATE TABLE IF NOT EXISTS social_events (
  id         TEXT PRIMARY KEY,
  circle_id  TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  actor_id   TEXT NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'circle',
  payload    JSONB NOT NULL DEFAULT '{}',            -- ללא הוכחות, ללא נתונים רפואיים
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_circle ON social_events(circle_id, created_at DESC);

CREATE TABLE IF NOT EXISTS encouragements (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES social_events(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL,                       -- clap | heart | muscle | fire | star
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, user_id)                         -- מניעת ספאם
);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS abuse_reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL,                         -- user | circle | invite | word
  entity_id   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  details     TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_jobs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  dedupe_key   TEXT NOT NULL UNIQUE
);

-- ---------- שכבת השפעה (עתידי, P2, מבודד) ----------
CREATE TABLE IF NOT EXISTS impact_campaigns (
  id            TEXT PRIMARY KEY,
  sponsor_id    TEXT NOT NULL,
  funded_budget NUMERIC(12,2) NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'ILS',
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft'        -- draft | funding_verified | open_for_allocation | allocation_closed | distribution_approved | paid | failed
);
CREATE TABLE IF NOT EXISTS impact_allocations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  campaign_id TEXT NOT NULL REFERENCES impact_campaigns(id),
  cause_id    TEXT NOT NULL,
  units       INT NOT NULL CHECK (units > 0),
  locked_at   TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS impact_disbursements (
  id                TEXT PRIMARY KEY,
  campaign_id       TEXT NOT NULL REFERENCES impact_campaigns(id),
  cause_id          TEXT NOT NULL,
  amount            NUMERIC(12,2) NOT NULL,
  payment_reference TEXT,                            -- אסמכתה חובה לפני סטטוס paid
  status            TEXT NOT NULL DEFAULT 'pending'
);
