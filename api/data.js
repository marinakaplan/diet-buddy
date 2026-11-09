import { getSupabase } from './_supabase.js';

// Table-specific handlers
const tableHandlers = {
    meals: handleMeals,
    weights: handleWeights,
    measurements: handleMeasurements,
    'blood-tests': handleBloodTests,
    exercises: handleExercises,
    water: handleWater,
    favorites: handleFavorites,
};

export default async function handler(req, res) {
    const { table } = req.query;
    if (!table || !tableHandlers[table]) {
        return res.status(400).json({ error: 'Invalid or missing table parameter. Valid: ' + Object.keys(tableHandlers).join(', ') });
    }
    return tableHandlers[table](req, res);
}

// ======================== MEALS ========================
async function handleMeals(req, res) {
    const db = getSupabase();

    if (req.method === 'GET') {
        try {
            const { userId, date } = req.query;
            if (!userId) return res.status(400).json({ error: 'userId required' });

            let query = db.from('meals').select('*').eq('user_id', userId);
            if (date) query = query.eq('date', date);
            query = query.order('created_at', { ascending: true });

            const { data, error } = await query;
            if (error) throw error;

            return res.status(200).json({ meals: data || [] });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const { userId, date, meal } = req.body;
            if (!userId || !date || !meal) return res.status(400).json({ error: 'userId, date, meal required' });

            const { data, error } = await db.from('meals').insert({
                user_id: userId, date,
                meal_type: meal.mealType || 'lunch',
                description: meal.description || '',
                calories: meal.calories || 0,
                protein: meal.protein || 0,
                carbs: meal.carbs || 0,
                fat: meal.fat || 0,
                health_score: meal.health_score || 0,
                time: meal.time || '',
                photo_url: meal.photo || '',
                detected_food: meal.detected_food || '',
                notes: meal.notes || ''
            }).select().single();

            if (error) throw error;
            return res.status(200).json({ meal: data });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'PUT') {
        try {
            const { id, meal } = req.body;
            if (!id || !meal) return res.status(400).json({ error: 'id and meal required' });

            const updates = {};
            if (meal.description !== undefined) updates.description = meal.description;
            if (meal.calories !== undefined) updates.calories = meal.calories;
            if (meal.protein !== undefined) updates.protein = meal.protein;
            if (meal.carbs !== undefined) updates.carbs = meal.carbs;
            if (meal.fat !== undefined) updates.fat = meal.fat;
            if (meal.mealType !== undefined) updates.meal_type = meal.mealType;
            if (meal.time !== undefined) updates.time = meal.time;

            const { error } = await db.from('meals').update(updates).eq('id', id);
            if (error) throw error;

            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'id required' });

            const { error } = await db.from('meals').delete().eq('id', id);
            if (error) throw error;

            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

// ======================== WEIGHTS ========================
async function handleWeights(req, res) {
    const db = getSupabase();

    if (req.method === 'GET') {
        try {
            const { userId } = req.query;
            if (!userId) return res.status(400).json({ error: 'userId required' });

            const { data, error } = await db.from('weights').select('*')
                .eq('user_id', userId).order('date', { ascending: true });
            if (error) throw error;

            return res.status(200).json({ weights: data || [] });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const { userId, date, value } = req.body;
            if (!userId || !date || value === undefined) return res.status(400).json({ error: 'userId, date, value required' });

            const { data, error } = await db.from('weights').insert({
                user_id: userId, date, value
            }).select().single();
            if (error) throw error;

            return res.status(200).json({ weight: data });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'PUT') {
        try {
            const { id, date, value } = req.body;
            if (!id) return res.status(400).json({ error: 'id required' });

            const updates = {};
            if (date !== undefined) updates.date = date;
            if (value !== undefined) updates.value = value;

            const { error } = await db.from('weights').update(updates).eq('id', id);
            if (error) throw error;

            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'id required' });

            const { error } = await db.from('weights').delete().eq('id', id);
            if (error) throw error;

            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

// ======================== MEASUREMENTS ========================
async function handleMeasurements(req, res) {
    const db = getSupabase();

    if (req.method === 'GET') {
        try {
            const { userId } = req.query;
            if (!userId) return res.status(400).json({ error: 'userId required' });

            const { data, error } = await db.from('measurements').select('*')
                .eq('user_id', userId).order('date', { ascending: true });
            if (error) throw error;

            return res.status(200).json({ measurements: data || [] });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const { userId, date, waist, hips, arm } = req.body;
            if (!userId || !date) return res.status(400).json({ error: 'userId, date required' });

            const { data, error } = await db.from('measurements').insert({
                user_id: userId, date, waist: waist || null, hips: hips || null, arm: arm || null
            }).select().single();
            if (error) throw error;

            return res.status(200).json({ measurement: data });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'PUT') {
        try {
            const { id, date, waist, hips, arm } = req.body;
            if (!id) return res.status(400).json({ error: 'id required' });

            const updates = {};
            if (date !== undefined) updates.date = date;
            if (waist !== undefined) updates.waist = waist;
            if (hips !== undefined) updates.hips = hips;
            if (arm !== undefined) updates.arm = arm;

            const { error } = await db.from('measurements').update(updates).eq('id', id);
            if (error) throw error;

            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'id required' });

            const { error } = await db.from('measurements').delete().eq('id', id);
            if (error) throw error;

            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

// ======================== BLOOD TESTS ========================
async function handleBloodTests(req, res) {
    const db = getSupabase();

    if (req.method === 'GET') {
        try {
            const { userId } = req.query;
            if (!userId) return res.status(400).json({ error: 'userId required' });

            const { data, error } = await db.from('blood_tests').select('*')
                .eq('user_id', userId).order('date', { ascending: true });
            if (error) throw error;

            return res.status(200).json({ bloodTests: data || [] });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const { userId, date, glucose, cholesterol, triglycerides, iron, b12, vitd, tsh } = req.body;
            if (!userId || !date) return res.status(400).json({ error: 'userId, date required' });

            const { data, error } = await db.from('blood_tests').insert({
                user_id: userId, date,
                glucose: glucose || null, cholesterol: cholesterol || null,
                triglycerides: triglycerides || null, iron: iron || null,
                b12: b12 || null, vitd: vitd || null, tsh: tsh || null
            }).select().single();
            if (error) throw error;

            return res.status(200).json({ bloodTest: data });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'PUT') {
        try {
            const { id, date, glucose, cholesterol, triglycerides, iron, b12, vitd, tsh } = req.body;
            if (!id) return res.status(400).json({ error: 'id required' });

            const updates = {};
            if (date !== undefined) updates.date = date;
            if (glucose !== undefined) updates.glucose = glucose;
            if (cholesterol !== undefined) updates.cholesterol = cholesterol;
            if (triglycerides !== undefined) updates.triglycerides = triglycerides;
            if (iron !== undefined) updates.iron = iron;
            if (b12 !== undefined) updates.b12 = b12;
            if (vitd !== undefined) updates.vitd = vitd;
            if (tsh !== undefined) updates.tsh = tsh;

            const { error } = await db.from('blood_tests').update(updates).eq('id', id);
            if (error) throw error;

            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'id required' });

            const { error } = await db.from('blood_tests').delete().eq('id', id);
            if (error) throw error;

            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

// ======================== EXERCISES ========================
async function handleExercises(req, res) {
    const db = getSupabase();

    if (req.method === 'GET') {
        try {
            const { userId, date } = req.query;
            if (!userId) return res.status(400).json({ error: 'userId required' });

            let query = db.from('exercises').select('*').eq('user_id', userId);
            if (date) query = query.eq('date', date);
            query = query.order('created_at', { ascending: true });

            const { data, error } = await query;
            if (error) throw error;

            return res.status(200).json({ exercises: data || [] });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const { userId, date, exercise } = req.body;
            if (!userId || !date || !exercise) return res.status(400).json({ error: 'userId, date, exercise required' });

            const { data, error } = await db.from('exercises').insert({
                user_id: userId, date,
                type: exercise.type || '', name: exercise.name || '', icon: exercise.icon || 'heart',
                duration: exercise.duration || 0, calories_burned: exercise.caloriesBurned || 0,
                time: exercise.time || ''
            }).select().single();
            if (error) throw error;

            return res.status(200).json({ exercise: data });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'PUT') {
        try {
            const { id, exercise } = req.body;
            if (!id || !exercise) return res.status(400).json({ error: 'id and exercise required' });

            const updates = {};
            if (exercise.name !== undefined) updates.name = exercise.name;
            if (exercise.type !== undefined) updates.type = exercise.type;
            if (exercise.duration !== undefined) updates.duration = exercise.duration;
            if (exercise.caloriesBurned !== undefined) updates.calories_burned = exercise.caloriesBurned;
            if (exercise.time !== undefined) updates.time = exercise.time;

            const { error } = await db.from('exercises').update(updates).eq('id', id);
            if (error) throw error;

            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'id required' });

            const { error } = await db.from('exercises').delete().eq('id', id);
            if (error) throw error;

            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

// ======================== WATER ========================
async function handleWater(req, res) {
    const db = getSupabase();

    if (req.method === 'GET') {
        try {
            const { userId, date } = req.query;
            if (!userId) return res.status(400).json({ error: 'userId required' });

            let query = db.from('water_log').select('*').eq('user_id', userId);
            if (date) query = query.eq('date', date);

            const { data, error } = await query;
            if (error) throw error;

            return res.status(200).json({ water: data || [] });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const { userId, date, cups } = req.body;
            if (!userId || !date || cups === undefined) return res.status(400).json({ error: 'userId, date, cups required' });

            const { data, error } = await db.from('water_log').upsert(
                { user_id: userId, date, cups, updated_at: new Date().toISOString() },
                { onConflict: 'user_id,date' }
            ).select().single();
            if (error) throw error;

            return res.status(200).json({ water: data });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

// ======================== FAVORITES ========================
async function handleFavorites(req, res) {
    const db = getSupabase();

    if (req.method === 'GET') {
        try {
            const { userId } = req.query;
            if (!userId) return res.status(400).json({ error: 'userId required' });

            const { data, error } = await db.from('favorites').select('*')
                .eq('user_id', userId).order('created_at', { ascending: false });
            if (error) throw error;

            return res.status(200).json({ favorites: (data || []).map(f => ({ ...f.meal_data, _id: f.id })) });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const { userId, mealData } = req.body;
            if (!userId || !mealData) return res.status(400).json({ error: 'userId, mealData required' });

            const { data, error } = await db.from('favorites').insert({
                user_id: userId, meal_data: mealData
            }).select().single();
            if (error) throw error;

            return res.status(200).json({ favorite: data });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'id required' });

            const { error } = await db.from('favorites').delete().eq('id', id);
            if (error) throw error;

            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
