import { getSupabase } from './_supabase.js';

// Action-specific handlers
const actionHandlers = {
    register: handleRegister,
    login: handleLogin,
    sync: handleSync,
    loaduser: handleLoadUser,
};

export default async function handler(req, res) {
    const { action } = req.query;
    if (!action || !actionHandlers[action]) {
        return res.status(400).json({ error: 'Invalid or missing action parameter. Valid: ' + Object.keys(actionHandlers).join(', ') });
    }
    return actionHandlers[action](req, res);
}

// ======================== REGISTER ========================
function generateId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return 'u_' + id;
}

function generateFriendCode() {
    return 'SHFT-' + String(Math.floor(1000 + Math.random() * 9000));
}

async function handleRegister(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { displayName } = req.body || {};
        const userId = generateId();
        const friendCode = generateFriendCode();
        const db = getSupabase();

        const userData = {
            user_id: userId,
            friend_code: friendCode,
            display_name: displayName || '',
            profile: {},
            public_stats: { xp: 0, level: 1, levelName: '\u05DE\u05EA\u05D7\u05D9\u05DC\u05D4', levelEmoji: '\uD83C\uDF31', streak: 0, weightLost: 0, lastActive: null },
            created_at: new Date().toISOString()
        };

        const { error: userErr } = await db.from('users').insert(userData);
        if (userErr) throw userErr;

        const { error: codeErr } = await db.from('friend_codes').insert({ friend_code: friendCode, user_id: userId });
        if (codeErr) throw codeErr;

        // Init gamification row
        await db.from('gamification').insert({ user_id: userId, xp: 0, streak: 0, achievements: [], xp_log: [] });

        return res.status(200).json({ userId, friendCode });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// ======================== LOGIN ========================
async function handleLogin(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { friendCode } = req.body;
        if (!friendCode) return res.status(400).json({ error: 'friendCode required' });

        const code = friendCode.trim().toUpperCase();
        const db = getSupabase();

        const { data: lookup, error: lookupErr } = await db
            .from('friend_codes')
            .select('user_id')
            .eq('friend_code', code)
            .single();

        if (lookupErr || !lookup) {
            return res.status(404).json({ error: '\u05D4\u05E7\u05D5\u05D3 \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0. \u05D1\u05D3\u05E7\u05D9 \u05E9\u05D4\u05E7\u05DC\u05D3\u05EA \u05E0\u05DB\u05D5\u05DF.' });
        }

        const { data: user, error: userErr } = await db
            .from('users')
            .select('*')
            .eq('user_id', lookup.user_id)
            .single();

        if (userErr || !user) {
            return res.status(404).json({ error: '\u05D4\u05DE\u05E9\u05EA\u05DE\u05E9\u05EA \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4.' });
        }

        return res.status(200).json({
            userId: user.user_id,
            friendCode: user.friend_code,
            displayName: user.display_name,
            data: {},
            groups: [],
            publicStats: user.public_stats || {}
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// ======================== SYNC ========================
async function handleSync(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userId, publicStats, profile, displayName } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId required' });

        const db = getSupabase();

        const updates = {};
        if (publicStats) updates.public_stats = publicStats;
        if (profile) updates.profile = profile;
        if (displayName || publicStats?.displayName) updates.display_name = displayName || publicStats.displayName;

        const { error } = await db
            .from('users')
            .update(updates)
            .eq('user_id', userId);

        if (error) throw error;

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// ======================== LOAD USER ========================
async function handleLoadUser(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const userId = req.query.userId;
        if (!userId) return res.status(400).json({ error: 'userId required' });

        const db = getSupabase();

        const { data: user, error } = await db
            .from('users')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error || !user) return res.status(200).json({ data: null });

        return res.status(200).json({
            data: {},
            publicStats: user.public_stats,
            groups: [],
            friendCode: user.friend_code,
            displayName: user.display_name,
            profile: user.profile
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
