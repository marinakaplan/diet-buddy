/* ============================================
   DietAgent - Gamification Engine
   RTL Hebrew Diet Tracking App
   ============================================ */

// ============ XP & Levels ============

const XP_REWARDS = {
    log_meal: 10,
    calorie_target: 25,
    weigh_in: 15,
    add_measurements: 10,
    add_blood_test: 20,
    water_complete: 15,
    achievement_unlock: 50,
    challenge_win: 100,
    challenge_participate: 25,
    goal_complete: 75,
    goal_contribute: 10
};

const LEVELS = [
    { level: 1,  name: 'מתחילה',         emoji: ICONS.seedling(16), xpRequired: 0,    avatar: ICONS.seedling(16), avatarColor: '#4DAB9A' },
    { level: 2,  name: 'מתעוררת',        emoji: ICONS.leaf(16), xpRequired: 100,  avatar: ICONS.leaf(16), avatarColor: '#529CCA' },
    { level: 3,  name: 'צומחת',          emoji: ICONS.flower(16), xpRequired: 300,  avatar: ICONS.flower(16), avatarColor: '#CB912F' },
    { level: 4,  name: 'מתקדמת',         emoji: ICONS.star(16), xpRequired: 600,  avatar: ICONS.star(16), avatarColor: '#6940A5' },
    { level: 5,  name: 'מנצנצת',         emoji: ICONS.sparkle(16), xpRequired: 1000, avatar: ICONS.sparkle(16), avatarColor: '#069494' },
    { level: 6,  name: 'בוערת',          emoji: ICONS.flame(16), xpRequired: 1500, avatar: ICONS.flame(16), avatarColor: '#EB5757' },
    { level: 7,  name: 'יהלום',          emoji: ICONS.gem(16), xpRequired: 2200, avatar: ICONS.gem(16), avatarColor: '#529CCA' },
    { level: 8,  name: 'מלכת הבריאות',   emoji: ICONS.crown(16), xpRequired: 3000, avatar: ICONS.crown(16), avatarColor: '#CB912F' },
    { level: 9,  name: 'גיבורת-על',      emoji: ICONS.shield(16), xpRequired: 4000, avatar: ICONS.shield(16), avatarColor: '#6940A5' },
    { level: 10, name: 'אלופת העולם',    emoji: ICONS.trophy(16), xpRequired: 5500, avatar: ICONS.trophy(16), avatarColor: '#FFD700' }
];

// ============ Tips Library ============

const TIP_CATEGORY_COLORS = {
    nutrition: '#4DAB9A',
    hydration: '#069494',
    exercise: '#6940A5',
    wellness: '#CB912F',
    planning: '#529CCA',
    mindset: '#EB5757'
};

const TIPS_LIBRARY = [
    { id: 't1',  text: 'שתי כוס מים לפני כל ארוחה - זה ממלא את הבטן ומפחית אכילת יתר', minLevel: 1, category: 'hydration' },
    { id: 't2',  text: 'חלבון בכל ארוחה עוזר לשמור על שובע לאורך זמן', minLevel: 1, category: 'nutrition' },
    { id: 't3',  text: 'תכנון ארוחות מראש מקטין את הסיכוי לחטיפים לא מתוכננים', minLevel: 1, category: 'planning' },
    { id: 't4',  text: 'ירקות צבעוניים מספקים מגוון ויטמינים ומינרלים - נסי להוסיף צבעים לכל ארוחה', minLevel: 1, category: 'nutrition' },
    { id: 't5',  text: 'הליכה של 10 דקות אחרי ארוחה עוזרת לאזן רמות סוכר', minLevel: 2, category: 'exercise' },
    { id: 't6',  text: 'שינה טובה של 7-8 שעות חיונית לירידה במשקל ולוויסות תיאבון', minLevel: 2, category: 'wellness' },
    { id: 't7',  text: 'אגוזים הם חטיף מצוין - 10 שקדים = כ-70 קלוריות ושובע ל-2 שעות', minLevel: 2, category: 'nutrition' },
    { id: 't8',  text: 'הימנעי מלאכול מול מסך - אכילה מודעת עוזרת לזהות שובע', minLevel: 2, category: 'mindset' },
    { id: 't9',  text: 'שעועית, עדשים וחומוס הם מקור מעולה לחלבון צמחי וסיבים', minLevel: 3, category: 'nutrition' },
    { id: 't10', text: 'מדדי את המנות בכפות ולא "בעין" - זה עושה הבדל של מאות קלוריות', minLevel: 3, category: 'planning' },
    { id: 't11', text: 'תרגילי כוח מגדילים מסת שריר, שמעלה את המטבוליזם גם במנוחה', minLevel: 3, category: 'exercise' },
    { id: 't12', text: 'ביצים הן אחד המזונות המשביעים ביותר - מעולה לארוחת בוקר', minLevel: 3, category: 'nutrition' },
    { id: 't13', text: 'לחץ מעלה קורטיזול שגורם לאגירת שומן - מצאי דרכים להירגע', minLevel: 4, category: 'wellness' },
    { id: 't14', text: 'חלבון מי גבינה (whey) אחרי אימון עוזר לשיקום שרירים', minLevel: 4, category: 'exercise' },
    { id: 't15', text: 'דגים שמנים (סלמון, טונה) עשירים באומגה 3 שטובה ללב ולמוח', minLevel: 4, category: 'nutrition' },
    { id: 't16', text: 'החליפי אורז לבן בקינואה או בורגול - יותר חלבון וסיבים', minLevel: 4, category: 'nutrition' },
    { id: 't17', text: 'צום לסירוגין (16:8) עוזר לחלק - אבל לא מתאים לכולם', minLevel: 5, category: 'planning' },
    { id: 't18', text: 'מעקב אחרי סיבים תזונתיים חשוב כמו מעקב קלוריות', minLevel: 5, category: 'nutrition' },
    { id: 't19', text: 'אבוקדו עשיר בשומנים בריאים שעוזרים לספיגת ויטמינים', minLevel: 5, category: 'nutrition' },
    { id: 't20', text: 'שתי תה ירוק - מכיל נוגדי חמצון ומעלה מעט את המטבוליזם', minLevel: 5, category: 'wellness' },
    { id: 't21', text: 'תוספי מגנזיום יכולים לעזור לשינה ולשרירים - שאלי רופא', minLevel: 6, category: 'wellness' },
    { id: 't22', text: 'NEAT - תנועה לא ספורטיבית (מדרגות, עמידה, סידור) שורפת 300+ קלוריות ביום', minLevel: 6, category: 'exercise' },
    { id: 't23', text: 'עדיפות לפחמימות מורכבות (שיבולת שועל, בטטה) על פני פשוטות (סוכר, לחם לבן)', minLevel: 6, category: 'nutrition' },
    { id: 't24', text: 'אל תדלגי על ארוחות - זה מאט את המטבוליזם ומגביר אכילת יתר', minLevel: 7, category: 'planning' },
    { id: 't25', text: 'ויטמין D חיוני לבריאות העצמות ולחיסון - בדקי את הרמות שלך', minLevel: 7, category: 'wellness' },
    { id: 't26', text: 'פרה-ביוטיקה (שום, בצל, בננה) מזינה את חיידקי המעי הטובים', minLevel: 7, category: 'nutrition' },
    { id: 't27', text: 'אימון HIIT של 20 דקות יכול להיות יעיל כמו ריצה של 45 דקות', minLevel: 8, category: 'exercise' },
    { id: 't28', text: 'תעדי גם את הרגשות סביב אכילה - זה עוזר לזהות דפוסים', minLevel: 8, category: 'mindset' },
    { id: 't29', text: 'Carb cycling - ימי פחמימות גבוהים/נמוכים לפי עצימות האימון', minLevel: 9, category: 'planning' },
    { id: 't30', text: 'את כבר מומחית! עזרי לאחרות בקבוצה שלך - ללמד זה הדרך הכי טובה ללמוד', minLevel: 10, category: 'mindset' }
];

function getDailyTip() {
    const stats = getGameStats();
    const available = TIPS_LIBRARY.filter(t => t.minLevel <= stats.level);
    if (available.length === 0) return null;
    const today = getTodayKey();
    const seed = today.split('-').join('');
    const hash = _simpleHash(seed + 'tip');
    const idx = hash % available.length;
    return available[idx];
}

function getLevelAvatar(level) {
    const idx = Math.max(0, Math.min(level - 1, LEVELS.length - 1));
    return LEVELS[idx];
}

function getGameStats() {
    const xp = getData('game_xp', 0);
    const level = getLevel(xp);
    const info = getLevelInfo(level);
    const streak = getStreak();
    const waterToday = getWaterToday();
    const achievements = getUnlockedAchievements();

    return {
        xp,
        level,
        levelName: info.name,
        levelEmoji: info.emoji,
        nextLevelXP: info.nextXP,
        streak,
        waterToday,
        achievements
    };
}

function addXP(amount, reason) {
    const oldXP = getData('game_xp', 0);
    const oldLevel = getLevel(oldXP);
    const newXP = oldXP + amount;
    setData('game_xp', newXP);

    // Log XP event
    const xpLog = getData('game_xp_log', []);
    xpLog.push({ amount, reason, date: new Date().toISOString() });
    // Keep last 100 entries
    if (xpLog.length > 100) xpLog.splice(0, xpLog.length - 100);
    setData('game_xp_log', xpLog);

    const newLevel = getLevel(newXP);
    const leveledUp = newLevel > oldLevel;

    if (leveledUp) {
        const info = getLevelInfo(newLevel);
        showLevelUpAnimation(newLevel, info.name, info.emoji);
    }

    return { newXP, leveledUp, newLevel };
}

function getLevel(xp) {
    let level = 1;
    for (let i = LEVELS.length - 1; i >= 0; i--) {
        if (xp >= LEVELS[i].xpRequired) {
            level = LEVELS[i].level;
            break;
        }
    }
    return level;
}

function getLevelInfo(level) {
    const idx = Math.max(0, Math.min(level - 1, LEVELS.length - 1));
    const current = LEVELS[idx];
    const next = idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null;

    return {
        name: current.name,
        emoji: current.emoji,
        xpRequired: current.xpRequired,
        nextXP: next ? next.xpRequired : null
    };
}

function getLevelProgress() {
    const xp = getData('game_xp', 0);
    const level = getLevel(xp);
    const info = getLevelInfo(level);

    if (info.nextXP === null) return 1; // Max level

    const currentLevelXP = info.xpRequired;
    const nextLevelXP = info.nextXP;
    const range = nextLevelXP - currentLevelXP;
    if (range <= 0) return 1;

    return Math.min(1, Math.max(0, (xp - currentLevelXP) / range));
}

// ============ Streak System ============

function checkAndUpdateStreak() {
    const streak = getData('game_streak', { count: 0, lastActiveDate: null });
    const today = getTodayKey();
    const yesterday = getTodayKey(-1);

    if (streak.lastActiveDate === today) {
        // Already active today, nothing to do
        return streak.count;
    }

    if (streak.lastActiveDate === yesterday) {
        // Streak continues, but don't increment until markTodayActive
        return streak.count;
    }

    // Streak broken (or first time)
    if (streak.lastActiveDate && streak.lastActiveDate !== yesterday && streak.lastActiveDate !== today) {
        streak.count = 0;
        setData('game_streak', streak);
    }

    return streak.count;
}

function getStreak() {
    const streak = getData('game_streak', { count: 0, lastActiveDate: null });
    const today = getTodayKey();
    const yesterday = getTodayKey(-1);

    // If last active was before yesterday, streak is broken
    if (streak.lastActiveDate && streak.lastActiveDate !== today && streak.lastActiveDate !== yesterday) {
        return 0;
    }
    return streak.count;
}

function markTodayActive() {
    const streak = getData('game_streak', { count: 0, lastActiveDate: null });
    const today = getTodayKey();

    if (streak.lastActiveDate === today) {
        return streak.count; // Already marked today
    }

    const yesterday = getTodayKey(-1);

    if (streak.lastActiveDate === yesterday) {
        streak.count += 1;
    } else if (!streak.lastActiveDate) {
        streak.count = 1;
    } else {
        // Streak broken
        streak.count = 1;
    }

    streak.lastActiveDate = today;
    setData('game_streak', streak);

    // Daily streak XP bonus (capped at 50)
    const streakBonus = Math.min(5 * streak.count, 50);
    addXP(streakBonus, 'streak_bonus');

    return streak.count;
}

// ============ Water Tracking ============

function _playWaterSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        // Water bubble/drop sound
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        // Descending pitch for water drop effect
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
        // Second bubble
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(800, ctx.currentTime + 0.1);
        osc2.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.25);
        gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.1);
        gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc2.start(ctx.currentTime + 0.1);
        osc2.stop(ctx.currentTime + 0.3);
        setTimeout(() => ctx.close(), 500);
    } catch (e) { /* silence errors on unsupported browsers */ }
}

function addWaterCup() {
    const today = getTodayKey();
    const key = 'water_' + today;
    let cups = getData(key, 0);

    if (cups >= 20) {
        showToast('וואו, 20 כוסות! שתית מספיק להיום ' + ICONS.droplet(16));
        return cups;
    }

    cups += 1;
    setData(key, cups);
    _playWaterSound();

    if (cups === 8) {
        addXP(XP_REWARDS.water_complete, 'water_complete');
        showToast('שתית 8 כוסות מים! +15 XP');
        checkAchievements();
        // Share water milestone to groups
        postGroupActivity('water', { cups });
    } else {
        showToast(`כוס ${cups}/8`);
        // Share every 4th cup to groups (not spam every cup)
        if (cups % 4 === 0) {
            postGroupActivity('water', { cups });
        }
    }

    return cups;
}

function removeWaterCup() {
    const today = getTodayKey();
    const key = 'water_' + today;
    let cups = getData(key, 0);
    if (cups <= 0) return 0;
    cups -= 1;
    setData(key, cups);
    showToast(`כוס הוסרה (${cups}/8)`);
    return cups;
}

function getWaterToday() {
    const today = getTodayKey();
    return getData('water_' + today, 0);
}

function getWaterTarget() {
    return 8;
}

// ============ Achievements System ============

const ACHIEVEMENTS = [
    {
        id: 'first_meal',
        name: 'ביצה טריה',
        emoji: ICONS.egg(16),
        description: 'תיעדת ארוחה ראשונה',
        check: function() {
            // Check if any meals exist across any day
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith('da_meals_')) {
                    const meals = JSON.parse(localStorage.getItem(key));
                    if (meals && meals.length > 0) return true;
                }
            }
            return false;
        }
    },
    {
        id: 'three_day_streak',
        name: 'שלושה ברצף',
        emoji: ICONS.flame(16),
        description: '3 ימים רצופים של מעקב',
        check: function() {
            return getStreak() >= 3;
        }
    },
    {
        id: 'week_streak',
        name: 'שבוע על אש',
        emoji: ICONS.flame(16),
        description: '7 ימים רצופים',
        check: function() {
            return getStreak() >= 7;
        }
    },
    {
        id: 'month_streak',
        name: 'חודש של מחויבות',
        emoji: ICONS.muscle(16),
        description: '30 ימים רצופים',
        check: function() {
            return getStreak() >= 30;
        }
    },
    {
        id: 'first_weigh',
        name: 'שקילה ראשונה',
        emoji: ICONS.scale(16),
        description: 'שקלת את עצמך בפעם הראשונה',
        check: function() {
            const weights = getData('weights', []);
            return weights.length > 0;
        }
    },
    {
        id: 'first_kg_lost',
        name: 'קילו ראשון',
        emoji: ICONS.trendingDown(16),
        description: 'ירדת קילו ראשון',
        check: function() {
            const weights = getData('weights', []);
            if (weights.length < 2) return false;
            const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
            const first = sorted[0].value;
            const latest = sorted[sorted.length - 1].value;
            return (first - latest) >= 1;
        }
    },
    {
        id: 'five_kg_lost',
        name: '5 קילו!',
        emoji: ICONS.party(16),
        description: 'ירדת 5 קילו',
        check: function() {
            const weights = getData('weights', []);
            if (weights.length < 2) return false;
            const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
            const first = sorted[0].value;
            const latest = sorted[sorted.length - 1].value;
            return (first - latest) >= 5;
        }
    },
    {
        id: 'ten_kg_lost',
        name: '10 קילו!',
        emoji: ICONS.medal(16),
        description: 'ירדת 10 קילו',
        check: function() {
            const weights = getData('weights', []);
            if (weights.length < 2) return false;
            const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
            const first = sorted[0].value;
            const latest = sorted[sorted.length - 1].value;
            return (first - latest) >= 10;
        }
    },
    {
        id: 'first_blood_test',
        name: 'בדיקה ראשונה',
        emoji: ICONS.blood(16),
        description: 'הוספת בדיקת דם',
        check: function() {
            const tests = getData('bloodTests', []);
            return tests.length > 0;
        }
    },
    {
        id: 'hydration_master',
        name: 'מלכת המים',
        emoji: ICONS.droplet(16),
        description: 'שתית 8 כוסות ביום',
        check: function() {
            return getWaterToday() >= 8;
        }
    },
    {
        id: 'perfect_day',
        name: 'יום מושלם',
        emoji: ICONS.target(16),
        description: 'עמדת ביעד הקלוריות',
        check: function() {
            const today = getTodayKey();
            const meals = getData('meals_' + today, []);
            if (meals.length === 0) return false;
            const profile = getData('profile', {});
            const target = profile.targetCalories || 1500;
            const total = meals.reduce((sum, m) => sum + (m.calories || 0), 0);
            const ratio = total / target;
            return ratio >= 0.85 && ratio <= 1.05;
        }
    },
    {
        id: 'week_logging',
        name: 'שבוע מעקב',
        emoji: ICONS.barChart(16),
        description: 'תיעדת ארוחות 7 ימים',
        check: function() {
            let daysWithMeals = 0;
            for (let i = 0; i < 30; i++) {
                const day = getTodayKey(-i);
                const meals = getData('meals_' + day, []);
                if (meals.length > 0) daysWithMeals++;
            }
            return daysWithMeals >= 7;
        }
    },
    {
        id: 'protein_queen',
        name: 'מלכת החלבון',
        emoji: ICONS.muscle(16),
        description: 'עמדת ביעד החלבון 5 ימים',
        check: function() {
            const profile = getData('profile', {});
            const proteinTarget = profile.targetProtein || 60;
            let daysHit = 0;
            for (let i = 0; i < 14; i++) {
                const day = getTodayKey(-i);
                const meals = getData('meals_' + day, []);
                const totalProtein = meals.reduce((sum, m) => sum + (m.protein || 0), 0);
                if (meals.length > 0 && totalProtein >= proteinTarget) daysHit++;
            }
            return daysHit >= 5;
        }
    },
    {
        id: 'early_bird',
        name: 'מקדימה',
        emoji: ICONS.sunrise(16),
        description: 'תיעדת ארוחת בוקר 5 ימים',
        check: function() {
            let breakfastDays = 0;
            for (let i = 0; i < 14; i++) {
                const day = getTodayKey(-i);
                const meals = getData('meals_' + day, []);
                const hasBreakfast = meals.some(m => m.mealType === 'breakfast');
                if (hasBreakfast) breakfastDays++;
            }
            return breakfastDays >= 5;
        }
    },
    {
        id: 'chat_fan',
        name: 'חברה של AI',
        emoji: ICONS.messageCircle(16),
        description: 'דיברת עם הדיאטנית 10 פעמים',
        check: function() {
            const chatCount = getData('game_chat_count', 0);
            return chatCount >= 10;
        }
    },
    // Social achievements
    {
        id: 'social_first_group',
        name: 'חברותית',
        emoji: ICONS.dancers(16),
        description: 'הצטרפת או יצרת קבוצה ראשונה',
        check: function() {
            const groups = getData('myGroups', []);
            return groups.length >= 1;
        }
    },
    {
        id: 'social_group_creator',
        name: 'מנהיגה',
        emoji: ICONS.crown(16),
        description: 'יצרת קבוצה והזמנת חברות',
        check: function() {
            const groups = getData('myGroups', []);
            return groups.length >= 1;
        }
    },
    {
        id: 'social_two_groups',
        name: 'רב-קבוצתית',
        emoji: ICONS.globe(16),
        description: 'חברה ב-2 קבוצות לפחות',
        check: function() {
            const groups = getData('myGroups', []);
            return groups.length >= 2;
        }
    },
    {
        id: 'social_streak_share',
        name: 'מלכת הרצף',
        emoji: ICONS.link(16),
        description: 'רצף של 7 ימים בזמן שאת בקבוצה',
        check: function() {
            const groups = getData('myGroups', []);
            return groups.length >= 1 && getStreak() >= 7;
        }
    },
    {
        id: 'social_water_champ',
        name: 'שתיינית חברתית',
        emoji: ICONS.swim(16),
        description: 'השלמת יעד מים כשאת בקבוצה',
        check: function() {
            const groups = getData('myGroups', []);
            return groups.length >= 1 && getWaterToday() >= 8;
        }
    },
    {
        id: 'social_first_challenge',
        name: 'מאתגרת',
        emoji: ICONS.target(16),
        description: 'הצטרפת לאתגר קבוצתי ראשון',
        check: function() {
            return getData('game_challenges_joined', 0) >= 1;
        }
    },
    {
        id: 'social_challenge_winner',
        name: 'אלופת האתגרים',
        emoji: ICONS.trophy(16),
        description: 'ניצחת באתגר קבוצתי',
        check: function() {
            return getData('game_challenges_won', 0) >= 1;
        }
    },
    {
        id: 'social_goal_crusher',
        name: 'שוברת יעדים',
        emoji: ICONS.explosion(16),
        description: 'השלמת יעד קבוצתי',
        check: function() {
            return getData('game_goals_completed', 0) >= 1;
        }
    }
];

function checkAchievements() {
    const unlocked = getData('game_achievements', []);
    const newlyUnlocked = [];

    for (const achievement of ACHIEVEMENTS) {
        if (unlocked.includes(achievement.id)) continue;

        try {
            if (achievement.check()) {
                unlocked.push(achievement.id);
                newlyUnlocked.push(achievement);
                addXP(XP_REWARDS.achievement_unlock, 'achievement_' + achievement.id);
                showAchievementUnlocked(achievement);
            }
        } catch (e) {
            console.warn('שגיאה בבדיקת הישג:', achievement.id, e);
        }
    }

    if (newlyUnlocked.length > 0) {
        setData('game_achievements', unlocked);
    }

    return newlyUnlocked;
}

function getUnlockedAchievements() {
    const unlockedIds = getData('game_achievements', []);
    return ACHIEVEMENTS.filter(a => unlockedIds.includes(a.id));
}

function getAllAchievements() {
    const unlockedIds = getData('game_achievements', []);
    return ACHIEVEMENTS.map(a => ({
        ...a,
        unlocked: unlockedIds.includes(a.id),
        check: undefined // Don't expose check function
    }));
}

// ============ Daily Challenges ============

function getDailyChallenges() {
    const today = getTodayKey();
    const cached = getData('game_challenges_' + today, null);
    if (cached) {
        // Recalculate current progress for cached challenges
        return cached.map(c => _updateChallengeProgress(c));
    }

    const allChallenges = _generateChallengePool();

    // Pick 3 based on a simple seed from the date
    const seed = today.split('-').join('');
    const shuffled = allChallenges.sort((a, b) => {
        const ha = _simpleHash(seed + a.id);
        const hb = _simpleHash(seed + b.id);
        return ha - hb;
    });

    const selected = shuffled.slice(0, 3).map(c => _updateChallengeProgress(c));
    setData('game_challenges_' + today, selected);
    return selected;
}

function _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit int
    }
    return Math.abs(hash);
}

function _generateChallengePool() {
    return [
        {
            id: 'water_8',
            text: 'שתי 8 כוסות מים',
            emoji: ICONS.droplet(16),
            target: 8,
            current: 0,
            completed: false,
            _getCurrent: function() { return getWaterToday(); }
        },
        {
            id: 'log_3_meals',
            text: 'תעדי 3 ארוחות היום',
            emoji: ICONS.utensils(16),
            target: 3,
            current: 0,
            completed: false,
            _getCurrent: function() {
                const meals = getData('meals_' + getTodayKey(), []);
                return meals.length;
            }
        },
        {
            id: 'calorie_target',
            text: 'עמדי ביעד הקלוריות',
            emoji: ICONS.target(16),
            target: 1,
            current: 0,
            completed: false,
            _getCurrent: function() {
                const meals = getData('meals_' + getTodayKey(), []);
                if (meals.length === 0) return 0;
                const profile = getData('profile', {});
                const target = profile.targetCalories || 1500;
                const total = meals.reduce((sum, m) => sum + (m.calories || 0), 0);
                const ratio = total / target;
                return (ratio >= 0.85 && ratio <= 1.05) ? 1 : 0;
            }
        },
        {
            id: 'weigh_in',
            text: 'הוסיפי שקילה היום',
            emoji: ICONS.scale(16),
            target: 1,
            current: 0,
            completed: false,
            _getCurrent: function() {
                const weights = getData('weights', []);
                const today = getTodayKey();
                return weights.some(w => w.date === today) ? 1 : 0;
            }
        },
        {
            id: 'chat_ai',
            text: 'דברי עם הדיאטנית AI',
            emoji: ICONS.robot(16),
            target: 1,
            current: 0,
            completed: false,
            _getCurrent: function() {
                const todayChats = getData('game_today_chat_' + getTodayKey(), 0);
                return todayChats >= 1 ? 1 : 0;
            }
        },
        {
            id: 'protein_60',
            text: 'אכלי לפחות 60 גרם חלבון',
            emoji: ICONS.muscle(16),
            target: 60,
            current: 0,
            completed: false,
            _getCurrent: function() {
                const meals = getData('meals_' + getTodayKey(), []);
                return meals.reduce((sum, m) => sum + (m.protein || 0), 0);
            }
        }
    ];
}

function _updateChallengeProgress(challenge) {
    // Recreate the getCurrent function from the pool
    const pool = _generateChallengePool();
    const template = pool.find(c => c.id === challenge.id);

    let current = challenge.current;
    if (template && template._getCurrent) {
        current = template._getCurrent();
    }

    return {
        id: challenge.id,
        text: challenge.text,
        emoji: challenge.emoji,
        target: challenge.target,
        current: current,
        completed: current >= challenge.target
    };
}

// ============ Confetti Animation ============

function launchConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';

    const colors = ['#069494', '#6940A5', '#CB912F', '#EB5757', '#4DAB9A', '#529CCA'];

    for (let i = 0; i < 50; i++) {
        const piece = document.createElement('div');
        const color = colors[Math.floor(Math.random() * colors.length)];
        const left = Math.random() * 100;
        const delay = Math.random() * 0.5;
        const duration = 1.5 + Math.random() * 1.5;
        const size = 6 + Math.random() * 6;
        const rotation = Math.random() * 360;

        piece.style.cssText = `
            position: absolute;
            top: -10px;
            left: ${left}%;
            width: ${size}px;
            height: ${size * 0.6}px;
            background: ${color};
            border-radius: 2px;
            animation: confettiFall ${duration}s ease-out ${delay}s forwards;
            transform: rotate(${rotation}deg);
        `;
        container.appendChild(piece);
    }

    // Inject keyframes if not already present
    if (!document.getElementById('confetti-keyframes')) {
        const style = document.createElement('style');
        style.id = 'confetti-keyframes';
        style.textContent = `
            @keyframes confettiFall {
                0% {
                    transform: translateY(0) rotate(0deg) scale(1);
                    opacity: 1;
                }
                100% {
                    transform: translateY(100vh) rotate(720deg) scale(0.5);
                    opacity: 0;
                }
            }
            @keyframes levelUpPulse {
                0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
                50% { transform: translate(-50%, -50%) scale(1.05); opacity: 1; }
                70% { transform: translate(-50%, -50%) scale(0.97); }
                100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            }
            @keyframes achievementSlide {
                0% { transform: translateY(-20px); opacity: 0; }
                12% { transform: translateY(0); opacity: 1; }
                85% { transform: translateY(0); opacity: 1; }
                100% { transform: translateY(-20px); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(container);

    setTimeout(() => {
        container.remove();
    }, 3500);
}

function showLevelUpAnimation(level, name, emoji) {
    launchConfetti();

    const overlay = document.createElement('div');
    overlay.className = 'level-up-overlay';

    const card = document.createElement('div');
    card.className = 'level-up-card';

    card.innerHTML = `
        <div class="level-up-emoji">${icon('star', 48)}</div>
        <div class="level-up-subtitle">עלית רמה!</div>
        <div class="level-up-number">רמה ${level}</div>
        <div class="level-up-name">${name}</div>
        <div class="level-up-xp">+50 XP</div>
    `;

    overlay.appendChild(card);
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);

    setTimeout(() => {
        overlay.remove();
    }, 4000);
}

function showAchievementUnlocked(achievement) {
    const toast = document.createElement('div');
    toast.className = 'achievement-toast';

    toast.innerHTML = `
        <div class="achievement-toast-emoji">${achievement.emoji}</div>
        <div>
            <div class="achievement-toast-label">הישג חדש!</div>
            <div class="achievement-toast-name">${achievement.name}</div>
            <div class="achievement-toast-desc">${achievement.description}</div>
        </div>
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3800);
}

// ============ Render Functions ============

function renderGameHeader() {
    const stats = getGameStats();
    const progress = getLevelProgress();
    const progressPercent = Math.round(progress * 100);
    const info = getLevelInfo(stats.level);

    const xpText = info.nextXP !== null
        ? `${stats.xp} / ${info.nextXP} XP`
        : `${stats.xp} XP (מקסימום!)`;

    return `
        <div class="game-header">
            <div class="game-header-top">
                <div class="game-header-level">
                    <span class="game-header-emoji">${icon('star')}</span>
                    <div>
                        <div class="game-header-level-label">רמה ${stats.level}</div>
                        <div class="game-header-level-name">${stats.levelName}</div>
                    </div>
                </div>
                <div class="game-header-streak" title="רצף ימים">
                    ${stats.streak > 0 ? icon('flame', 16) : icon('target', 16)}
                    <span class="game-header-streak-count">${stats.streak}</span>
                </div>
            </div>
            <div class="game-header-progress-track">
                <div class="game-header-progress-fill" style="width: ${progressPercent}%"></div>
            </div>
            <div class="game-header-xp-text">${xpText}</div>
        </div>
    `;
}

function _getWaterEncouragement(cups, target) {
    if (cups === 0) return '';
    if (cups < target / 2) return 'המשיכי ככה!';
    if (cups < target) return 'כמעט שם!';
    if (cups === target) return 'הגעת ליעד!';
    if (cups <= 12) return 'מעבר ליעד, כל הכבוד!';
    return 'אלופה של שתייה!';
}

function renderWaterTracker() {
    const cups = getWaterToday();
    const target = getWaterTarget();
    const maxDisplay = Math.max(target, cups);

    let cupsHTML = '';
    for (let i = 1; i <= maxDisplay; i++) {
        const filled = i <= cups;
        const dropClass = filled ? 'water-drop water-drop--filled' : 'water-drop water-drop--empty';
        cupsHTML += `<span class="${dropClass}">${icon('droplet', 18)}</span>`;
    }

    const ml = cups * 250;
    const litersVal = ml / 1000;
    const litersDisplay = ml < 1000 ? `${ml} מ״ל` : `${parseFloat(litersVal.toFixed(2))} ליטר`;
    const encouragement = _getWaterEncouragement(cups, target);

    return `
        <div class="water-tracker-card">
            <div class="water-tracker-header">
                <div class="water-tracker-title">${icon('droplet', 18)} מעקב מים</div>
                <div class="water-tracker-count">${cups}/${target} כוסות</div>
            </div>
            <div class="water-drops-container">
                ${cupsHTML}
            </div>
            <div class="water-liters">שתית <strong>${litersDisplay}</strong> היום</div>
            ${encouragement ? `<div class="water-encouragement">${encouragement}</div>` : ''}
            <div style="display:flex;gap:8px;justify-content:center">
                <button class="water-add-btn" onclick="addWaterCup(); _refreshWaterUI();">
                    + הוסיפי כוס מים
                </button>
                ${cups > 0 ? `<button class="water-add-btn" onclick="removeWaterCup(); _refreshWaterUI();" style="background:var(--bg-warm);color:var(--text-secondary);border:1px solid var(--border)">
                    - הורידי כוס
                </button>` : ''}
            </div>
        </div>
    `;
}

function _refreshWaterUI() {
    const waterEl = document.querySelector('.water-tracker-card');
    if (waterEl) {
        const parent = waterEl.parentElement;
        const newHTML = renderWaterTracker();
        const temp = document.createElement('div');
        temp.innerHTML = newHTML;
        parent.replaceChild(temp.firstElementChild, waterEl);
    }
}

function renderDailyChallenges() {
    const challenges = getDailyChallenges();

    let challengesHTML = '';
    for (const c of challenges) {
        const progressPercent = Math.min(100, Math.round((c.current / c.target) * 100));
        const statusIcon = c.completed ? icon('check', 16) : '<span class="challenge-status-empty"></span>';
        const challengeIcon = c.emoji;
        const itemClass = c.completed ? 'challenge-item challenge-item--completed' : 'challenge-item';
        const textClass = c.completed ? 'challenge-text challenge-text--completed' : 'challenge-text';
        const fillClass = c.completed ? 'challenge-progress-fill challenge-progress-fill--done' : 'challenge-progress-fill challenge-progress-fill--active';

        challengesHTML += `
            <div class="${itemClass}">
                <span class="challenge-status">${statusIcon}</span>
                <div class="challenge-content">
                    <div class="${textClass}">
                        ${challengeIcon} ${c.text}
                    </div>
                    <div class="challenge-progress-track">
                        <div class="${fillClass}" style="width: ${progressPercent}%"></div>
                    </div>
                </div>
                <span class="challenge-counter">
                    ${c.current}/${c.target}
                </span>
            </div>
        `;
    }

    return `
        <div class="challenges-card">
            <div class="challenges-title">${icon('target', 18)} אתגרים יומיים</div>
            ${challengesHTML}
        </div>
    `;
}

function renderAchievementsGrid() {
    const all = getAllAchievements();

    let gridHTML = '';
    for (const a of all) {
        const locked = !a.unlocked;
        const itemClass = locked ? 'achievement-item achievement-item--locked' : 'achievement-item achievement-item--unlocked';

        gridHTML += `
            <div class="${itemClass}"
                 onclick="this.querySelector('.achievement-desc').classList.toggle('achievement-desc--visible')">
                <span class="achievement-emoji">${a.emoji}</span>
                <div class="achievement-name">${a.name}</div>
                <div class="achievement-desc">${a.description}</div>
            </div>
        `;
    }

    return `
        <div class="achievements-card">
            <div class="achievements-title">${icon('trophy', 18)} הישגים</div>
            <div class="achievements-grid">
                ${gridHTML}
            </div>
        </div>
    `;
}

// ============ Daily Tip Card ============

function renderDailyTip() {
    const tip = getDailyTip();
    if (!tip) return '';

    const categoryColor = TIP_CATEGORY_COLORS[tip.category] || '#069494';
    const categoryLabels = {
        nutrition: 'תזונה',
        hydration: 'שתייה',
        exercise: 'תנועה',
        wellness: 'בריאות',
        planning: 'תכנון',
        mindset: 'מיינדסט'
    };
    const categoryLabel = categoryLabels[tip.category] || '';

    return `
        <div class="daily-tip-card" style="border-inline-start: 3px solid ${categoryColor};">
            <div class="daily-tip-header">
                <span class="daily-tip-icon">${icon('lightbulb', 18)}</span>
                <span class="daily-tip-title">טיפ יומי</span>
                <span class="daily-tip-level" style="background: ${categoryColor}15; color: ${categoryColor};">${categoryLabel}</span>
            </div>
            <div class="daily-tip-text">${tip.text}</div>
            <div class="daily-tip-meta">
                <span class="daily-tip-min-level">רמה ${tip.minLevel}+</span>
            </div>
        </div>
    `;
}

// ============ Badge Collection ============

function renderBadgeCollection() {
    const all = getAllAchievements();

    let gridHTML = '';
    for (const a of all) {
        const locked = !a.unlocked;
        const itemClass = locked ? 'badge-item badge-item--locked' : 'badge-item badge-item--unlocked';

        gridHTML += `
            <div class="${itemClass}">
                <div class="badge-item-emoji">${a.emoji}</div>
                <div class="badge-item-name">${a.name}</div>
                <div class="badge-item-desc">${a.description}</div>
            </div>
        `;
    }

    return `
        <div class="badge-collection-grid">
            ${gridHTML}
        </div>
    `;
}

// ============ Profile Avatar ============

function renderProfileAvatar() {
    const stats = getGameStats();
    const levelData = getLevelAvatar(stats.level);
    return `
        <div class="profile-avatar-evolving" style="background: ${levelData.avatarColor}15; border-color: ${levelData.avatarColor};">
            <span class="profile-avatar-emoji">${levelData.avatar}</span>
        </div>
    `;
}
