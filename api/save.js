import { getSupabase } from './_supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userId, meals, weights, measurements, bloodTests, exercises, water, gamification, profile, favorites } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId required' });

        const db = getSupabase();

        // Update profile on users table
        if (profile) {
            await db.from('users').update({ profile }).eq('user_id', userId);
        }

        // Upsert meals (by date)
        if (meals && typeof meals === 'object') {
            for (const [dateKey, mealList] of Object.entries(meals)) {
                // Delete existing meals for this date, then insert new ones
                await db.from('meals').delete().eq('user_id', userId).eq('date', dateKey);
                if (Array.isArray(mealList) && mealList.length > 0) {
                    const rows = mealList.map(m => ({
                        user_id: userId,
                        date: dateKey,
                        meal_type: m.mealType || 'lunch',
                        description: m.description || '',
                        calories: m.calories || 0,
                        protein: m.protein || 0,
                        carbs: m.carbs || 0,
                        fat: m.fat || 0,
                        health_score: m.health_score || 0,
                        time: m.time || '',
                        photo_url: m.photo || '',
                        detected_food: m.detected_food || '',
                        notes: m.notes || ''
                    }));
                    await db.from('meals').insert(rows);
                }
            }
        }

        // Upsert weights
        if (Array.isArray(weights)) {
            await db.from('weights').delete().eq('user_id', userId);
            if (weights.length > 0) {
                const rows = weights.map(w => ({ user_id: userId, date: w.date, value: w.value }));
                await db.from('weights').insert(rows);
            }
        }

        // Upsert measurements
        if (Array.isArray(measurements)) {
            await db.from('measurements').delete().eq('user_id', userId);
            if (measurements.length > 0) {
                const rows = measurements.map(m => ({
                    user_id: userId, date: m.date, waist: m.waist || null, hips: m.hips || null, arm: m.arm || null
                }));
                await db.from('measurements').insert(rows);
            }
        }

        // Upsert blood tests
        if (Array.isArray(bloodTests)) {
            await db.from('blood_tests').delete().eq('user_id', userId);
            if (bloodTests.length > 0) {
                const rows = bloodTests.map(b => ({
                    user_id: userId, date: b.date,
                    glucose: b.glucose || null, cholesterol: b.cholesterol || null,
                    triglycerides: b.triglycerides || null, iron: b.iron || null,
                    b12: b.b12 || null, vitd: b.vitd || null, tsh: b.tsh || null
                }));
                await db.from('blood_tests').insert(rows);
            }
        }

        // Upsert exercises (by date)
        if (exercises && typeof exercises === 'object') {
            for (const [dateKey, exList] of Object.entries(exercises)) {
                await db.from('exercises').delete().eq('user_id', userId).eq('date', dateKey);
                if (Array.isArray(exList) && exList.length > 0) {
                    const rows = exList.map(e => ({
                        user_id: userId, date: dateKey,
                        type: e.type || '', name: e.name || '', icon: e.icon || 'heart',
                        duration: e.duration || 0, calories_burned: e.caloriesBurned || 0, time: e.time || ''
                    }));
                    await db.from('exercises').insert(rows);
                }
            }
        }

        // Upsert water
        if (water && typeof water === 'object') {
            for (const [dateKey, cups] of Object.entries(water)) {
                await db.from('water_log').upsert(
                    { user_id: userId, date: dateKey, cups: cups || 0, updated_at: new Date().toISOString() },
                    { onConflict: 'user_id,date' }
                );
            }
        }

        // Upsert gamification
        if (gamification) {
            await db.from('gamification').upsert({
                user_id: userId,
                xp: gamification.xp || 0,
                streak: gamification.streak || 0,
                streak_last_date: gamification.streakLastDate || null,
                achievements: gamification.achievements || [],
                xp_log: gamification.xpLog || [],
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
        }

        // Upsert favorites
        if (Array.isArray(favorites)) {
            await db.from('favorites').delete().eq('user_id', userId);
            if (favorites.length > 0) {
                const rows = favorites.map(f => ({ user_id: userId, meal_data: f }));
                await db.from('favorites').insert(rows);
            }
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
