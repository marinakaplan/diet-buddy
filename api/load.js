import { getSupabase } from './_supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const userId = req.query.userId;
        if (!userId) return res.status(200).json({ data: null });

        const db = getSupabase();

        // Load all data in parallel
        const [
            { data: user },
            { data: meals },
            { data: weights },
            { data: measurements },
            { data: bloodTests },
            { data: exercises },
            { data: waterLog },
            { data: gamification },
            { data: favorites }
        ] = await Promise.all([
            db.from('users').select('*').eq('user_id', userId).single(),
            db.from('meals').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
            db.from('weights').select('*').eq('user_id', userId).order('date', { ascending: true }),
            db.from('measurements').select('*').eq('user_id', userId).order('date', { ascending: true }),
            db.from('blood_tests').select('*').eq('user_id', userId).order('date', { ascending: true }),
            db.from('exercises').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
            db.from('water_log').select('*').eq('user_id', userId),
            db.from('gamification').select('*').eq('user_id', userId).single(),
            db.from('favorites').select('*').eq('user_id', userId)
        ]);

        if (!user) return res.status(200).json({ data: null });

        // Group meals by date
        const mealsByDate = {};
        (meals || []).forEach(m => {
            const key = m.date;
            if (!mealsByDate[key]) mealsByDate[key] = [];
            mealsByDate[key].push({
                description: m.description, mealType: m.meal_type,
                calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat,
                health_score: m.health_score, time: m.time, photo: m.photo_url,
                detected_food: m.detected_food, notes: m.notes, _id: m.id
            });
        });

        // Group exercises by date
        const exercisesByDate = {};
        (exercises || []).forEach(e => {
            const key = e.date;
            if (!exercisesByDate[key]) exercisesByDate[key] = [];
            exercisesByDate[key].push({
                type: e.type, name: e.name, icon: e.icon,
                duration: e.duration, caloriesBurned: e.calories_burned, time: e.time, _id: e.id
            });
        });

        // Water by date
        const waterByDate = {};
        (waterLog || []).forEach(w => { waterByDate[w.date] = w.cups; });

        return res.status(200).json({
            data: {
                profile: user.profile,
                publicStats: user.public_stats,
                displayName: user.display_name,
                friendCode: user.friend_code,
                meals: mealsByDate,
                weights: (weights || []).map(w => ({ date: w.date, value: w.value, _id: w.id })),
                measurements: (measurements || []).map(m => ({
                    date: m.date, waist: m.waist, hips: m.hips, arm: m.arm, _id: m.id
                })),
                bloodTests: (bloodTests || []).map(b => ({
                    date: b.date, glucose: b.glucose, cholesterol: b.cholesterol,
                    triglycerides: b.triglycerides, iron: b.iron, b12: b.b12, vitd: b.vitd, tsh: b.tsh, _id: b.id
                })),
                exercises: exercisesByDate,
                water: waterByDate,
                gamification: gamification ? {
                    xp: gamification.xp, streak: gamification.streak,
                    streakLastDate: gamification.streak_last_date,
                    achievements: gamification.achievements, xpLog: gamification.xp_log
                } : null,
                favorites: (favorites || []).map(f => f.meal_data)
            }
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
