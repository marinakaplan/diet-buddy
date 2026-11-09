-- ============================================
-- DietAgent Supabase Schema
-- ============================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    friend_code TEXT UNIQUE NOT NULL,
    display_name TEXT DEFAULT '',
    profile JSONB DEFAULT '{}',
    public_stats JSONB DEFAULT '{"xp":0,"level":1,"levelName":"מתחילה","levelEmoji":"🌱","streak":0,"weightLost":0,"lastActive":null}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Friend codes lookup
CREATE TABLE IF NOT EXISTS friend_codes (
    friend_code TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE
);

-- Meals
CREATE TABLE IF NOT EXISTS meals (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    meal_type TEXT DEFAULT 'lunch',
    description TEXT DEFAULT '',
    calories INTEGER DEFAULT 0,
    protein REAL DEFAULT 0,
    carbs REAL DEFAULT 0,
    fat REAL DEFAULT 0,
    health_score INTEGER DEFAULT 0,
    time TEXT DEFAULT '',
    photo_url TEXT DEFAULT '',
    detected_food TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meals_user_date ON meals(user_id, date);

-- Weights
CREATE TABLE IF NOT EXISTS weights (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    value REAL NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_weights_user_date ON weights(user_id, date);

-- Measurements
CREATE TABLE IF NOT EXISTS measurements (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    waist REAL,
    hips REAL,
    arm REAL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_measurements_user ON measurements(user_id);

-- Blood tests
CREATE TABLE IF NOT EXISTS blood_tests (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    glucose REAL,
    cholesterol REAL,
    triglycerides REAL,
    iron REAL,
    b12 REAL,
    vitd REAL,
    tsh REAL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blood_tests_user ON blood_tests(user_id);

-- Exercises
CREATE TABLE IF NOT EXISTS exercises (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    type TEXT DEFAULT '',
    name TEXT DEFAULT '',
    icon TEXT DEFAULT 'heart',
    duration INTEGER DEFAULT 0,
    calories_burned INTEGER DEFAULT 0,
    time TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_exercises_user_date ON exercises(user_id, date);

-- Water log (one row per user per day)
CREATE TABLE IF NOT EXISTS water_log (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    cups INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_water_user_date ON water_log(user_id, date);

-- Gamification (one row per user)
CREATE TABLE IF NOT EXISTS gamification (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    xp INTEGER DEFAULT 0,
    streak INTEGER DEFAULT 0,
    streak_last_date TEXT,
    achievements JSONB DEFAULT '[]',
    xp_log JSONB DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Groups
CREATE TABLE IF NOT EXISTS groups (
    group_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(user_id),
    members JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_groups_invite ON groups(invite_code);

-- Group activity feed
CREATE TABLE IF NOT EXISTS group_activity (
    id BIGSERIAL PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    type TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_group ON group_activity(group_id, created_at DESC);

-- Favorites
CREATE TABLE IF NOT EXISTS favorites (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    meal_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);

-- ============================================
-- Row Level Security (RLS)
-- ============================================
-- For now, using anon key with server-side API routes,
-- so RLS is permissive. We use service-level access from serverless functions.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE blood_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE gamification ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

-- Allow anon key full access (server-side API handles authorization)
CREATE POLICY "anon_all_users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_friend_codes" ON friend_codes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_meals" ON meals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_weights" ON weights FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_measurements" ON measurements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_blood_tests" ON blood_tests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_exercises" ON exercises FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_water_log" ON water_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_gamification" ON gamification FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_groups" ON groups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_group_activity" ON group_activity FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_favorites" ON favorites FOR ALL USING (true) WITH CHECK (true);
