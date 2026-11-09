import { getSupabase } from './_supabase.js';

// Action-specific handlers
const actionHandlers = {
    create: handleCreate,
    join: handleJoin,
    leave: handleLeave,
    leaderboard: handleLeaderboard,
    activity: handleActivity,
    'challenge-create': handleChallengeCreate,
    'challenge-join': handleChallengeJoin,
    'challenge-progress': handleChallengeProgress,
    'challenge-complete': handleChallengeComplete,
    'goal-create': handleGoalCreate,
    'goal-progress': handleGoalProgress,
};

export default async function handler(req, res) {
    const { action } = req.query;
    if (!action || !actionHandlers[action]) {
        return res.status(400).json({ error: 'Invalid or missing action parameter. Valid: ' + Object.keys(actionHandlers).join(', ') });
    }
    return actionHandlers[action](req, res);
}

// ======================== CREATE ========================
function generateGroupId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return 'g_' + id;
}

function generateInviteCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

async function handleCreate(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userId, groupName } = req.body;
        if (!userId || !groupName) return res.status(400).json({ error: 'userId and groupName required' });

        const db = getSupabase();

        const { data: user } = await db.from('users').select('display_name').eq('user_id', userId).single();
        const displayName = user?.display_name || 'ללא שם';

        const groupId = generateGroupId();
        const inviteCode = generateInviteCode();

        const members = [{ userId, displayName, joinedAt: new Date().toISOString(), role: 'admin' }];

        const { error } = await db.from('groups').insert({
            group_id: groupId,
            name: groupName,
            invite_code: inviteCode,
            created_by: userId,
            members
        });

        if (error) throw error;

        return res.status(200).json({ groupId, inviteCode, name: groupName });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// ======================== JOIN ========================
async function handleJoin(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userId, inviteCode } = req.body;
        if (!userId || !inviteCode) return res.status(400).json({ error: 'userId and inviteCode required' });

        const db = getSupabase();

        const { data: group, error: gErr } = await db
            .from('groups')
            .select('*')
            .eq('invite_code', inviteCode)
            .single();

        if (gErr || !group) return res.status(404).json({ error: 'קוד לא נמצא' });

        const members = group.members || [];

        if (members.some(m => m.userId === userId)) {
            return res.status(200).json({ group: { ...group, groupId: group.group_id }, message: 'כבר בקבוצה' });
        }

        if (members.length >= 20) {
            return res.status(400).json({ error: 'הקבוצה מלאה' });
        }

        const { data: user } = await db.from('users').select('display_name').eq('user_id', userId).single();

        members.push({
            userId,
            displayName: user?.display_name || 'משתמשת',
            joinedAt: new Date().toISOString(),
            role: 'member'
        });

        const { error } = await db
            .from('groups')
            .update({ members })
            .eq('group_id', group.group_id);

        if (error) throw error;

        return res.status(200).json({
            group: {
                groupId: group.group_id,
                name: group.name,
                inviteCode: group.invite_code,
                members
            }
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// ======================== LEAVE ========================
async function handleLeave(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userId, groupId } = req.body;
        if (!userId || !groupId) return res.status(400).json({ error: 'userId and groupId required' });

        const db = getSupabase();

        const { data: group } = await db
            .from('groups')
            .select('members')
            .eq('group_id', groupId)
            .single();

        if (group) {
            const members = (group.members || []).filter(m => m.userId !== userId);
            await db.from('groups').update({ members }).eq('group_id', groupId);
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// ======================== LEADERBOARD ========================
async function handleLeaderboard(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { groupId } = req.query;
        if (!groupId) return res.status(400).json({ error: 'groupId required' });

        const db = getSupabase();

        const { data: group, error } = await db
            .from('groups')
            .select('*')
            .eq('group_id', groupId)
            .single();

        if (error || !group) return res.status(404).json({ error: 'Group not found' });

        const memberIds = (group.members || []).map(m => m.userId);

        const { data: users } = await db
            .from('users')
            .select('user_id, display_name, public_stats')
            .in('user_id', memberIds);

        const rankings = (users || []).map(u => ({
            userId: u.user_id,
            displayName: u.display_name || 'ללא שם',
            ...(u.public_stats || {})
        }));

        rankings.sort((a, b) => (b.xp || 0) - (a.xp || 0));

        return res.status(200).json({
            groupId,
            groupName: group.name,
            inviteCode: group.invite_code,
            memberCount: (group.members || []).length,
            updatedAt: new Date().toISOString(),
            rankings
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// ======================== ACTIVITY ========================
async function handleActivity(req, res) {
    const db = getSupabase();

    if (req.method === 'GET') {
        try {
            const { groupId, limit: limitStr } = req.query;
            if (!groupId) return res.status(400).json({ error: 'groupId required' });

            const limit = parseInt(limitStr) || 50;

            const { data, error } = await db
                .from('group_activity')
                .select('*')
                .eq('group_id', groupId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;

            const activities = (data || []).map(a => ({
                id: a.id,
                userId: a.user_id,
                displayName: a.display_name,
                type: a.type,
                data: a.data,
                timestamp: a.created_at
            }));

            return res.status(200).json({ groupId, activities });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const { userId, groupIds, activity } = req.body;
            if (!userId || !groupIds || !activity) {
                return res.status(400).json({ error: 'userId, groupIds, and activity required' });
            }

            const validTypes = ['meal', 'water', 'weight', 'achievement', 'streak', 'exercise', 'challenge', 'goal'];
            if (!validTypes.includes(activity.type)) {
                return res.status(400).json({ error: 'Invalid activity type' });
            }

            const { data: user } = await db.from('users').select('display_name').eq('user_id', userId).single();
            const displayName = user?.display_name || 'ללא שם';

            for (const gid of groupIds) {
                const { data: group } = await db.from('groups').select('members').eq('group_id', gid).single();
                if (!group || !(group.members || []).some(m => m.userId === userId)) continue;

                await db.from('group_activity').insert({
                    group_id: gid,
                    user_id: userId,
                    display_name: displayName,
                    type: activity.type,
                    data: activity.data || {}
                });
            }

            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

// ======================== CHALLENGE CREATE ========================
function generateChallengeId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return 'ch_' + id;
}

function generateGoalId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return 'gl_' + id;
}

function addDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

function todayStr() {
    return new Date().toISOString().split('T')[0];
}

async function postGroupActivity(db, groupId, userId, displayName, type, data) {
    await db.from('group_activity').insert({
        group_id: groupId,
        user_id: userId,
        display_name: displayName,
        type,
        data
    });
}

async function computeChallengeProgress(db, challenge) {
    const { type, participants, start_date, end_date } = challenge;
    const participantIds = participants.map(p => p.userId);
    if (participantIds.length === 0) return participants;

    const updated = participants.map(p => ({ ...p }));

    if (type === 'water') {
        const { data: logs } = await db
            .from('water_log')
            .select('user_id, cups')
            .in('user_id', participantIds)
            .gte('date', start_date)
            .lte('date', end_date);
        const totals = {};
        (logs || []).forEach(l => { totals[l.user_id] = (totals[l.user_id] || 0) + (l.cups || 0); });
        updated.forEach(p => { p.progress = totals[p.userId] || 0; });
    } else if (type === 'exercise_streak') {
        const { data: logs } = await db
            .from('exercises')
            .select('user_id, date')
            .in('user_id', participantIds)
            .gte('date', start_date)
            .lte('date', end_date);
        const counts = {};
        (logs || []).forEach(l => {
            if (!counts[l.user_id]) counts[l.user_id] = new Set();
            counts[l.user_id].add(l.date);
        });
        updated.forEach(p => { p.progress = counts[p.userId] ? counts[p.userId].size : 0; });
    } else if (type === 'weight_loss') {
        const { data: logs } = await db
            .from('weights')
            .select('user_id, weight, date')
            .in('user_id', participantIds)
            .gte('date', start_date)
            .lte('date', end_date)
            .order('date', { ascending: true });
        const byUser = {};
        (logs || []).forEach(l => {
            if (!byUser[l.user_id]) byUser[l.user_id] = { first: l.weight, last: l.weight };
            byUser[l.user_id].last = l.weight;
        });
        updated.forEach(p => {
            const d = byUser[p.userId];
            p.progress = d ? Math.max(0, d.first - d.last) : 0;
        });
    } else if (type === 'healthy_eating') {
        const { data: logs } = await db
            .from('meals')
            .select('user_id, health_score')
            .in('user_id', participantIds)
            .gte('date', start_date)
            .lte('date', end_date);
        const scores = {};
        const counts = {};
        (logs || []).forEach(l => {
            if (l.health_score != null) {
                scores[l.user_id] = (scores[l.user_id] || 0) + l.health_score;
                counts[l.user_id] = (counts[l.user_id] || 0) + 1;
            }
        });
        updated.forEach(p => {
            p.progress = counts[p.userId] ? Math.round((scores[p.userId] / counts[p.userId]) * 10) / 10 : 0;
        });
    } else if (type === 'calories') {
        const { data: users } = await db
            .from('users')
            .select('user_id, target_calories')
            .in('user_id', participantIds);
        const targets = {};
        (users || []).forEach(u => { targets[u.user_id] = u.target_calories || 2000; });

        const { data: logs } = await db
            .from('meals')
            .select('user_id, calories, date')
            .in('user_id', participantIds)
            .gte('date', start_date)
            .lte('date', end_date);
        const dailyCals = {};
        (logs || []).forEach(l => {
            const key = `${l.user_id}_${l.date}`;
            dailyCals[key] = (dailyCals[key] || 0) + (l.calories || 0);
        });
        const goodDays = {};
        Object.entries(dailyCals).forEach(([key, total]) => {
            const uid = key.split('_')[0];
            const target = targets[uid] || 2000;
            const ratio = total / target;
            if (ratio >= 0.85 && ratio <= 1.15) {
                goodDays[uid] = (goodDays[uid] || 0) + 1;
            }
        });
        updated.forEach(p => { p.progress = goodDays[p.userId] || 0; });
    }

    return updated;
}

async function handleChallengeCreate(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userId, groupId, type, title, durationDays, dare } = req.body;
        if (!userId || !groupId || !type || !title || !durationDays) {
            return res.status(400).json({ error: 'userId, groupId, type, title, and durationDays required' });
        }

        const db = getSupabase();

        const { data: user } = await db.from('users').select('display_name').eq('user_id', userId).single();
        const displayName = user?.display_name || 'ללא שם';

        const challengeId = generateChallengeId();
        const start_date = todayStr();
        const end_date = addDays(start_date, durationDays);

        const participants = [{
            userId,
            displayName,
            joinedAt: new Date().toISOString(),
            progress: 0
        }];

        const challenge = {
            challenge_id: challengeId,
            group_id: groupId,
            creator_user_id: userId,
            creator_name: displayName,
            type,
            title,
            start_date,
            end_date,
            duration_days: durationDays,
            participants,
            status: 'active',
            ...(dare ? { dare } : {})
        };

        const { error } = await db.from('group_challenges').insert(challenge);
        if (error) throw error;

        await postGroupActivity(db, groupId, userId, displayName, 'challenge', { action: 'created', title });

        return res.status(200).json(challenge);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// ======================== CHALLENGE JOIN ========================
async function handleChallengeJoin(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userId, challengeId } = req.body;
        if (!userId || !challengeId) return res.status(400).json({ error: 'userId and challengeId required' });

        const db = getSupabase();

        const { data: challenge, error: cErr } = await db
            .from('group_challenges')
            .select('*')
            .eq('challenge_id', challengeId)
            .single();

        if (cErr || !challenge) return res.status(404).json({ error: 'Challenge not found' });
        if (challenge.status !== 'active') return res.status(400).json({ error: 'Challenge is not active' });

        const participants = challenge.participants || [];
        if (participants.some(p => p.userId === userId)) {
            return res.status(400).json({ error: 'Already joined this challenge' });
        }

        const { data: user } = await db.from('users').select('display_name').eq('user_id', userId).single();
        const displayName = user?.display_name || 'ללא שם';

        participants.push({
            userId,
            displayName,
            joinedAt: new Date().toISOString(),
            progress: 0
        });

        const { error } = await db
            .from('group_challenges')
            .update({ participants })
            .eq('challenge_id', challengeId);

        if (error) throw error;

        await postGroupActivity(db, challenge.group_id, userId, displayName, 'challenge', { action: 'joined', title: challenge.title });

        return res.status(200).json({ ...challenge, participants });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// ======================== CHALLENGE PROGRESS ========================
async function handleChallengeProgress(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { groupId } = req.query;
        if (!groupId) return res.status(400).json({ error: 'groupId required' });

        const db = getSupabase();

        const { data: challenges, error } = await db
            .from('group_challenges')
            .select('*')
            .eq('group_id', groupId)
            .in('status', ['active', 'completed'])
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;

        const results = [];
        for (const ch of (challenges || [])) {
            if (ch.status === 'active') {
                ch.participants = await computeChallengeProgress(db, ch);
            }
            results.push(ch);
        }

        return res.status(200).json({ groupId, challenges: results });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// ======================== CHALLENGE COMPLETE ========================
async function handleChallengeComplete(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { challengeId } = req.body;
        if (!challengeId) return res.status(400).json({ error: 'challengeId required' });

        const db = getSupabase();

        const { data: challenge, error: cErr } = await db
            .from('group_challenges')
            .select('*')
            .eq('challenge_id', challengeId)
            .single();

        if (cErr || !challenge) return res.status(404).json({ error: 'Challenge not found' });
        if (challenge.status !== 'active') return res.status(400).json({ error: 'Challenge is not active' });

        const today = todayStr();
        if (challenge.end_date > today) {
            return res.status(400).json({ error: 'Challenge has not ended yet' });
        }

        const participants = await computeChallengeProgress(db, challenge);

        let winner = null;
        let maxProgress = -1;
        for (const p of participants) {
            if ((p.progress || 0) > maxProgress) {
                maxProgress = p.progress || 0;
                winner = p;
            }
        }

        // Find loser (participant with lowest progress) for dare
        let loser = null;
        if (challenge.dare && participants.length > 1) {
            let minProgress = Infinity;
            for (const p of participants) {
                if ((p.progress || 0) < minProgress) {
                    minProgress = p.progress || 0;
                    loser = p;
                }
            }
        }

        const updateData = {
            status: 'completed',
            participants,
            winner_user_id: winner?.userId || null,
            winner_name: winner?.displayName || null,
            ...(loser ? { loser_user_id: loser.userId, loser_name: loser.displayName } : {})
        };

        const { error } = await db
            .from('group_challenges')
            .update(updateData)
            .eq('challenge_id', challengeId);

        if (error) throw error;

        const activityData = {
            action: 'completed',
            title: challenge.title,
            winnerName: winner?.displayName || null
        };
        if (challenge.dare && loser) {
            activityData.loser = loser.displayName;
            activityData.dare = challenge.dare;
        }

        await postGroupActivity(db, challenge.group_id, challenge.creator_user_id, winner?.displayName || '', 'challenge', activityData);

        const responseData = { ...challenge, ...updateData };
        if (challenge.dare && loser) {
            responseData.loser = loser.displayName;
            responseData.dare = challenge.dare;
        }

        return res.status(200).json(responseData);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// ======================== GOAL CREATE ========================
async function handleGoalCreate(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userId, groupId, type, category, title, targetValue, unit, deadline } = req.body;
        if (!userId || !groupId || !title || !targetValue) {
            return res.status(400).json({ error: 'userId, groupId, title, and targetValue required' });
        }

        const db = getSupabase();

        const { data: user } = await db.from('users').select('display_name').eq('user_id', userId).single();
        const displayName = user?.display_name || 'ללא שם';

        const goalId = generateGoalId();

        const goal = {
            goal_id: goalId,
            group_id: groupId,
            creator_user_id: userId,
            creator_name: displayName,
            type: type || 'collective',
            category: category || 'general',
            title,
            target_value: targetValue,
            current_value: 0,
            unit: unit || '',
            deadline: deadline || null,
            contributions: [],
            status: 'active',
            created_at: new Date().toISOString()
        };

        const { error } = await db.from('group_goals').insert(goal);
        if (error) throw error;

        await postGroupActivity(db, groupId, userId, displayName, 'goal', { action: 'created', title });

        return res.status(200).json(goal);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// ======================== GOAL PROGRESS ========================
async function handleGoalProgress(req, res) {
    const db = getSupabase();

    if (req.method === 'GET') {
        try {
            const { groupId } = req.query;
            if (!groupId) return res.status(400).json({ error: 'groupId required' });

            const { data: goals, error } = await db
                .from('group_goals')
                .select('*')
                .eq('group_id', groupId)
                .eq('status', 'active')
                .order('created_at', { ascending: false });

            if (error) throw error;

            return res.status(200).json({ groupId, goals: goals || [] });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const { userId, goalId, amount } = req.body;
            if (!userId || !goalId || amount == null) {
                return res.status(400).json({ error: 'userId, goalId, and amount required' });
            }

            const { data: goal, error: gErr } = await db
                .from('group_goals')
                .select('*')
                .eq('goal_id', goalId)
                .single();

            if (gErr || !goal) return res.status(404).json({ error: 'Goal not found' });

            const { data: user } = await db.from('users').select('display_name').eq('user_id', userId).single();
            const displayName = user?.display_name || 'ללא שם';

            const contributions = goal.contributions || [];
            contributions.push({
                userId,
                displayName,
                amount,
                date: todayStr()
            });

            const newCurrentValue = (goal.current_value || 0) + amount;
            const isCompleted = newCurrentValue >= goal.target_value;

            const updateData = {
                contributions,
                current_value: newCurrentValue,
                ...(isCompleted ? { status: 'completed' } : {})
            };

            const { error } = await db
                .from('group_goals')
                .update(updateData)
                .eq('goal_id', goalId);

            if (error) throw error;

            if (isCompleted) {
                await postGroupActivity(db, goal.group_id, userId, displayName, 'goal', {
                    action: 'completed',
                    title: goal.title
                });
            }

            return res.status(200).json({ ...goal, ...updateData });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
