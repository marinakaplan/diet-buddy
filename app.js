/* ============================================
   DietAgent - Core Application Logic
   ============================================ */

// ============ State ============
let currentPage = 'home';
let foodDayOffset = 0;
let currentMealType = 'breakfast';
let lastAnalysis = null;
let weightChart = null;
let bloodChart = null;
let weekDashboardOffset = 0;
let weeklyCalorieChart = null;
let weeklyWeightChart = null;
let weeklyDashboardCollapsed = false;
let selectedExerciseType = null;
let _selectedDay = null; // null means today, set in initDaySelector
let _metricsRange = '7d';
let calorieChart = null;

// ============ Data Helpers ============
let _syncTimer = null;

function getData(key, fallback = null) {
    try {
        const val = localStorage.getItem('da_' + key);
        return val ? JSON.parse(val) : fallback;
    } catch { return fallback; }
}

function setData(key, value) {
    localStorage.setItem('da_' + key, JSON.stringify(value));
    // Debounced cloud sync - saves after 2 seconds of inactivity
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => {
        if (typeof syncToCloudWithUser === 'function' && getUserId()) {
            syncToCloudWithUser();
        } else {
            syncToCloud();
        }
    }, 2000);
}

// ============ Cloud Sync ============
async function syncToCloud() {
    const userId = typeof getUserId === 'function' ? getUserId() : getData('userId', null);
    if (!userId) return; // Need userId for Supabase

    try {
        // Collect all data from localStorage into structured format
        const profile = getProfile();

        // Collect meals by date
        const meals = {};
        const exercises = {};
        const water = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('da_meals_')) {
                const dateKey = key.replace('da_meals_', '');
                meals[dateKey] = getData('meals_' + dateKey, []);
            }
            if (key.startsWith('da_exercises_')) {
                const dateKey = key.replace('da_exercises_', '');
                exercises[dateKey] = getData('exercises_' + dateKey, []);
            }
            if (key.startsWith('da_water_')) {
                const dateKey = key.replace('da_water_', '');
                water[dateKey] = getData('water_' + dateKey, 0);
            }
        }

        const body = {
            userId,
            profile,
            meals,
            weights: getData('weights', []),
            measurements: getData('measurements', []),
            bloodTests: getData('bloodTests', []),
            exercises,
            water,
            gamification: {
                xp: getData('game_xp', 0),
                streak: getData('game_streak', { count: 0 }).count || 0,
                streakLastDate: getData('game_streak', {}).lastActiveDate || null,
                achievements: getData('game_achievements', []),
                xpLog: getData('game_xp_log', [])
            },
            favorites: getData('favorites', [])
        };

        const response = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (response.ok) {
            console.log('☁️ סונכרן לענן');
            localStorage.setItem('da__lastSyncTime', JSON.stringify(Date.now()));
        }
    } catch (err) {
        console.log('Sync failed (offline):', err.message);
    }
}

async function loadFromCloud() {
    const userId = typeof getUserId === 'function' ? getUserId() : getData('userId', null);
    if (!userId) return false;

    try {
        const response = await fetch(`/api/load?userId=${userId}`);
        if (!response.ok) return false;
        const { data } = await response.json();
        if (!data) return false;

        // Load structured data into localStorage
        if (data.profile) setData('profile', data.profile);
        if (data.weights) setData('weights', data.weights);
        if (data.measurements) setData('measurements', data.measurements);
        if (data.bloodTests) setData('bloodTests', data.bloodTests);
        if (data.favorites) setData('favorites', data.favorites);

        // Meals by date
        if (data.meals) {
            Object.entries(data.meals).forEach(([dateKey, mealList]) => {
                setData('meals_' + dateKey, mealList);
            });
        }

        // Exercises by date
        if (data.exercises) {
            Object.entries(data.exercises).forEach(([dateKey, exList]) => {
                setData('exercises_' + dateKey, exList);
            });
        }

        // Water by date
        if (data.water) {
            Object.entries(data.water).forEach(([dateKey, cups]) => {
                setData('water_' + dateKey, cups);
            });
        }

        // Gamification
        if (data.gamification) {
            setData('game_xp', data.gamification.xp || 0);
            setData('game_xp_log', data.gamification.xpLog || []);
            setData('game_achievements', data.gamification.achievements || []);
            setData('game_streak', {
                count: data.gamification.streak || 0,
                lastActiveDate: data.gamification.streakLastDate || null
            });
        }

        if (data.friendCode) setData('friendCode', data.friendCode);
        if (data.displayName) {
            const p = getProfile();
            p.name = data.displayName;
            setData('profile', p);
        }

        console.log('☁️ נתונים נטענו מהענן');
        return true;
    } catch {
        return false;
    }
}

function getProfile() {
    return getData('profile', {
        name: '', age: '', height: '', gender: '',
        activityLevel: 'light',
        targetWeight: '', targetCalories: '',
        targetProtein: '', targetCarbs: '', targetFat: '', targetFiber: '',
        apiKey: ''
    });
}

function getTodayKey(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().split('T')[0];
}

function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ============ Navigation ============
function navigateTo(page) {
    currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`.nav-item[data-page="${page}"]`).classList.add('active');

    const titles = { home: 'שיפטי', food: 'מעקב אוכל', groups: 'חברות', metrics: 'מדדים', chat: 'הדיאטנית שלי', profile: 'פרופיל' };
    document.getElementById('page-title').textContent = titles[page];

    // Hide FAB on non-home pages
    const fab = document.querySelector('.fab');
    if (fab) fab.style.display = page === 'home' ? 'flex' : 'none';

    // Refresh page data
    if (page === 'home') refreshDashboard();
    if (page === 'food') { refreshFoodLog(); refreshFoodGallery(); loadCachedDayPlan(); }
    if (page === 'groups') refreshGroupsPage();
    if (page === 'metrics') refreshMetrics();
    if (page === 'profile') loadProfile();
}

// ============ Dashboard ============
function initDaySelector() {
    if (!_selectedDay) _selectedDay = getTodayKey();
    renderDaySelector();
}

function renderDaySelector() {
    const bar = document.getElementById('day-selector-bar');
    if (!bar) return;
    const todayKey = getTodayKey();
    const weekdayLetters = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
    let html = '';
    // Today first on the left, older days going right
    for (let i = 0; i >= -6; i--) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const key = d.toISOString().split('T')[0];
        const dayNum = d.getDate();
        const weekday = weekdayLetters[d.getDay()];
        const isSelected = key === _selectedDay;
        const isToday = key === todayKey;
        html += `<button class="day-circle${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}" onclick="selectDay('${key}')">
            <span class="day-weekday">${weekday}</span>
            <span class="day-num">${dayNum}</span>
        </button>`;
    }
    bar.innerHTML = html;
}

function selectDay(dayKey) {
    _selectedDay = dayKey;
    renderDaySelector();
    refreshDashboard();
}

function refreshDashboard() {
    initDaySelector();

    // Greeting
    const hour = new Date().getHours();
    const profile = getProfile();
    const name = profile.name || '';
    let greeting = 'בוקר טוב';
    if (hour >= 12 && hour < 17) greeting = 'צהריים טובים';
    else if (hour >= 17 && hour < 21) greeting = 'ערב טוב';
    else if (hour >= 21 || hour < 5) greeting = 'לילה טוב';
    document.getElementById('greeting-text').textContent = `${greeting}${name ? ', ' + name : ''}`;

    // Date - show selected day's date
    const selectedDate = new Date(_selectedDay + 'T00:00:00');
    const todayKey = getTodayKey();
    if (_selectedDay === todayKey) {
        document.getElementById('date-display').textContent = selectedDate.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } else {
        document.getElementById('date-display').textContent = selectedDate.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    // Daily totals - use selected day
    const meals = getData('meals_' + _selectedDay, []);
    const totals = meals.reduce((acc, m) => {
        acc.calories += m.calories || 0;
        acc.protein += m.protein || 0;
        acc.carbs += m.carbs || 0;
        acc.fat += m.fat || 0;
        return acc;
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

    document.getElementById('cal-value').textContent = Math.round(totals.calories);
    document.getElementById('protein-value').textContent = Math.round(totals.protein);
    document.getElementById('carbs-value').textContent = Math.round(totals.carbs);
    document.getElementById('fat-value').textContent = Math.round(totals.fat);

    // Update rings
    const targets = {
        calories: profile.targetCalories || 1500,
        protein: profile.targetProtein || 80,
        carbs: profile.targetCarbs || 150,
        fat: profile.targetFat || 50
    };
    updateRing('calories', totals.calories, targets.calories);
    updateRing('protein', totals.protein, targets.protein);
    updateRing('carbs', totals.carbs, targets.carbs);
    updateRing('fat', totals.fat, targets.fat);

    // Weight
    const weights = getData('weights', []);
    if (weights.length > 0) {
        const latest = weights[weights.length - 1];
        document.getElementById('current-weight').textContent = latest.value;
        if (weights.length >= 2) {
            const prev = weights[weights.length - 2];
            const diff = (latest.value - prev.value).toFixed(1);
            const el = document.getElementById('weight-trend');
            if (diff < 0) { el.textContent = `${diff} ↓`; el.className = 'weight-trend down'; }
            else if (diff > 0) { el.textContent = `+${diff} ↑`; el.className = 'weight-trend up'; }
            else { el.textContent = 'ללא שינוי'; el.className = 'weight-trend same'; }
        }
    }

    const targetW = profile.targetWeight;
    if (targetW) {
        document.getElementById('weight-target-display').textContent = `יעד: ${targetW} ק״ג`;
    }

    // Render gamification elements
    renderGameWidgets();
}

function renderGameWidgets() {
    const gameHeader = document.getElementById('game-header-container');
    if (gameHeader) gameHeader.innerHTML = renderGameHeader();

    const waterTracker = document.getElementById('water-tracker-container');
    if (waterTracker) waterTracker.innerHTML = renderWaterTracker();

    const challenges = document.getElementById('daily-challenges-container');
    if (challenges) challenges.innerHTML = renderDailyChallenges();

    const achievements = document.getElementById('achievements-container');
    if (achievements) achievements.innerHTML = renderAchievementsGrid();

    // Weekly Smart Dashboard
    renderAndInitWeeklyDashboard();
}

function updateRing(type, current, target) {
    const pct = Math.min(current / target, 1);
    const circumference = 2 * Math.PI * 42; // r=42
    const offset = circumference * (1 - pct);
    const ring = document.querySelector(`.${type}-ring`);
    if (ring) ring.style.strokeDashoffset = offset;
}

// ============ Weekly Smart Dashboard ============

function getWeekStartDate(weekOffset = 0) {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun
    const start = new Date(today);
    start.setDate(today.getDate() - dayOfWeek + (weekOffset * 7));
    start.setHours(0, 0, 0, 0);
    return start;
}

function getWeekKey(weekOffset = 0) {
    const start = getWeekStartDate(weekOffset);
    return start.toISOString().split('T')[0];
}

function getWeekData(weekOffset = 0) {
    const start = getWeekStartDate(weekOffset);
    const profile = getProfile();
    const targetCalories = profile.targetCalories || 1500;
    const allWeights = getData('weights', []);

    const days = [];
    const dayNames = ['א','ב','ג','ד','ה','ו','ש'];
    for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const dateKey = d.toISOString().split('T')[0];
        const meals = getData('meals_' + dateKey, []);
        const totals = meals.reduce((acc, m) => {
            acc.calories += m.calories || 0;
            acc.protein += m.protein || 0;
            acc.carbs += m.carbs || 0;
            acc.fat += m.fat || 0;
            return acc;
        }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
        const water = getData('water_' + dateKey, 0);
        const dayWeight = allWeights.find(w => w.date === dateKey);

        days.push({
            dateKey,
            date: d,
            dayName: dayNames[d.getDay()],
            calories: Math.round(totals.calories),
            protein: Math.round(totals.protein),
            carbs: Math.round(totals.carbs),
            fat: Math.round(totals.fat),
            water,
            weight: dayWeight ? dayWeight.value : null,
            hasMeals: meals.length > 0
        });
    }

    const daysWithCalories = days.filter(d => d.hasMeals);
    const avgCalories = daysWithCalories.length > 0
        ? Math.round(daysWithCalories.reduce((s, d) => s + d.calories, 0) / daysWithCalories.length)
        : 0;
    const daysWithWater = days.filter(d => d.water > 0);
    const avgWater = daysWithWater.length > 0
        ? (daysWithWater.reduce((s, d) => s + d.water, 0) / daysWithWater.length).toFixed(1)
        : 0;
    const weightsThisWeek = days.filter(d => d.weight !== null);
    const avgWeight = weightsThisWeek.length > 0
        ? (weightsThisWeek.reduce((s, d) => s + d.weight, 0) / weightsThisWeek.length).toFixed(1)
        : null;

    return { days, targetCalories, avgCalories, avgWater, avgWeight, profile };
}

function getWeekLabel(weekOffset) {
    const start = getWeekStartDate(weekOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const fmt = (d) => d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
    if (weekOffset === 0) return 'השבוע הנוכחי';
    if (weekOffset === -1) return 'שבוע שעבר';
    return `${fmt(start)} - ${fmt(end)}`;
}

function renderWeeklyDashboard() {
    const weekData = getWeekData(weekDashboardOffset);
    const prevWeekData = getWeekData(weekDashboardOffset - 1);
    const weekKey = getWeekKey(weekDashboardOffset);
    const cachedScore = getData('weekly_score_' + weekKey, null);

    const collapsedClass = weeklyDashboardCollapsed ? ' collapsed' : '';

    // Comparison calculations
    const calDiff = weekData.avgCalories && prevWeekData.avgCalories
        ? weekData.avgCalories - prevWeekData.avgCalories : null;
    const waterDiff = weekData.avgWater > 0 && prevWeekData.avgWater > 0
        ? (weekData.avgWater - prevWeekData.avgWater).toFixed(1) : null;
    const weightDiff = weekData.avgWeight && prevWeekData.avgWeight
        ? (weekData.avgWeight - prevWeekData.avgWeight).toFixed(1) : null;

    function compValue(diff, unit, invertColors) {
        if (diff === null || diff === undefined) return '<span class="weekly-comp-value neutral">--</span>';
        const num = parseFloat(diff);
        if (num === 0) return '<span class="weekly-comp-value neutral">ללא שינוי</span>';
        const isPos = num > 0;
        const colorClass = invertColors ? (isPos ? 'negative' : 'positive') : (isPos ? 'positive' : 'negative');
        const arrow = isPos ? icon('chevronUp', 14) : icon('chevronDown', 14);
        const sign = isPos ? '+' : '';
        return '<span class="weekly-comp-value ' + colorClass + '">' + arrow + ' ' + sign + diff + unit + '</span>';
    }

    // Score HTML
    let scoreHtml = '';
    if (cachedScore) {
        const scoreClass = cachedScore.score >= 7 ? 'score-high' : cachedScore.score >= 4 ? 'score-mid' : 'score-low';
        scoreHtml = '<div class="weekly-score-circle ' + scoreClass + '">' + cachedScore.score + '</div>' +
            '<span class="weekly-score-label">ציון AI שבועי</span>';
    } else {
        scoreHtml = '<div class="weekly-score-circle">--</div>' +
            '<span class="weekly-score-label">ציון AI שבועי</span>' +
            '<button class="weekly-nav-btn" onclick="event.stopPropagation(); loadWeeklyAIScore()" style="margin-top:4px;width:auto;padding:2px 10px;font-size:0.72rem;">חשבי ציון</button>';
    }

    const disabledAttr = weekDashboardOffset >= 0 ? ' disabled style="opacity:0.3;pointer-events:none;"' : '';

    const html = '<div class="weekly-dashboard-card' + collapsedClass + '">' +
        '<div class="weekly-header" onclick="toggleWeeklyDashboard()">' +
            '<div class="weekly-header-right">' +
                '<span class="weekly-icon">' + icon('barChart', 20) + '</span>' +
                '<h3>דשבורד שבועי</h3>' +
            '</div>' +
            '<span class="weekly-collapse-icon">' + icon('chevronUp', 18) + '</span>' +
        '</div>' +
        '<div class="weekly-body">' +
            '<div class="weekly-nav">' +
                '<button class="weekly-nav-btn" onclick="changeWeekOffset(1)">' + icon('chevronRight', 16) + '</button>' +
                '<span class="weekly-nav-label">' + getWeekLabel(weekDashboardOffset) + '</span>' +
                '<button class="weekly-nav-btn" onclick="changeWeekOffset(-1)"' + disabledAttr + '>' + icon('chevronLeft', 16) + '</button>' +
            '</div>' +
            '<div class="weekly-charts-row">' +
                '<div class="weekly-chart-box">' +
                    '<h4>' + icon('flame', 14) + ' קלוריות יומיות</h4>' +
                    '<canvas id="weekly-calories-chart"></canvas>' +
                '</div>' +
                '<div class="weekly-chart-box">' +
                    '<h4>' + icon('scale', 14) + ' מגמת משקל</h4>' +
                    '<canvas id="weekly-weight-chart"></canvas>' +
                '</div>' +
            '</div>' +
            '<div class="weekly-bottom-row">' +
                '<div class="weekly-score-card">' + scoreHtml + '</div>' +
                '<div class="weekly-comparison">' +
                    '<h4>השוואה לשבוע קודם</h4>' +
                    '<div class="weekly-comp-row">' +
                        '<span class="weekly-comp-label">קלוריות (ממוצע)</span>' +
                        compValue(calDiff, ' קק״ל', true) +
                    '</div>' +
                    '<div class="weekly-comp-row">' +
                        '<span class="weekly-comp-label">מים (ממוצע)</span>' +
                        compValue(waterDiff, ' כוסות', false) +
                    '</div>' +
                    '<div class="weekly-comp-row">' +
                        '<span class="weekly-comp-label">משקל (ממוצע)</span>' +
                        compValue(weightDiff, ' ק״ג', true) +
                    '</div>' +
                '</div>' +
            '</div>' +
            (cachedScore && cachedScore.explanation ? '<div class="weekly-ai-explanation">' + cachedScore.explanation + '</div>' : '') +
        '</div>' +
    '</div>';

    return { html, weekData };
}

function initWeeklyCharts(weekData) {
    if (weeklyCalorieChart) { weeklyCalorieChart.destroy(); weeklyCalorieChart = null; }
    if (weeklyWeightChart) { weeklyWeightChart.destroy(); weeklyWeightChart = null; }

    const calCanvas = document.getElementById('weekly-calories-chart');
    const weightCanvas = document.getElementById('weekly-weight-chart');
    if (!calCanvas || !weightCanvas) return;

    const labels = weekData.days.map(d => d.dayName);
    const caloriesData = weekData.days.map(d => d.hasMeals ? d.calories : null);
    const target = weekData.targetCalories;

    weeklyCalorieChart = new Chart(calCanvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'קלוריות',
                    data: caloriesData,
                    backgroundColor: caloriesData.map(v => v !== null ? '#069494' : 'transparent'),
                    borderRadius: 4,
                    barPercentage: 0.6,
                },
                {
                    label: 'יעד',
                    data: Array(7).fill(target),
                    type: 'line',
                    borderColor: '#B4B4B0',
                    borderDash: [5, 3],
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false,
                }
            ]
        },
        options: {
            rtl: true,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    rtl: true,
                    callbacks: {
                        label: function(ctx) { return ctx.dataset.label + ': ' + (ctx.raw || 0) + ' קק״ל'; }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11 } },
                    reverse: true,
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#F0F0ED' },
                    ticks: { font: { size: 10 }, maxTicksLimit: 4 }
                }
            }
        }
    });

    // Weight line chart
    const weightValues = weekData.days.map(d => d.weight);
    const hasWeight = weightValues.some(v => v !== null);

    weeklyWeightChart = new Chart(weightCanvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'משקל',
                data: weightValues,
                borderColor: '#6940A5',
                backgroundColor: 'rgba(105, 64, 165, 0.1)',
                borderWidth: 2,
                pointRadius: hasWeight ? 4 : 0,
                pointBackgroundColor: '#6940A5',
                fill: true,
                tension: 0.3,
                spanGaps: true,
            }]
        },
        options: {
            rtl: true,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    rtl: true,
                    callbacks: {
                        label: function(ctx) { return ctx.raw ? ctx.raw + ' ק״ג' : 'אין נתון'; }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11 } },
                    reverse: true,
                },
                y: {
                    grid: { color: '#F0F0ED' },
                    ticks: { font: { size: 10 }, maxTicksLimit: 4 },
                }
            }
        }
    });
}

function toggleWeeklyDashboard() {
    weeklyDashboardCollapsed = !weeklyDashboardCollapsed;
    const card = document.querySelector('.weekly-dashboard-card');
    if (card) {
        card.classList.toggle('collapsed', weeklyDashboardCollapsed);
        if (!weeklyDashboardCollapsed) {
            const weekData = getWeekData(weekDashboardOffset);
            initWeeklyCharts(weekData);
        }
    }
}

function changeWeekOffset(delta) {
    weekDashboardOffset -= delta;
    if (weekDashboardOffset > 0) weekDashboardOffset = 0;
    renderAndInitWeeklyDashboard();
}

function renderAndInitWeeklyDashboard() {
    const container = document.getElementById('weekly-dashboard-container');
    if (!container) return;
    const { html, weekData } = renderWeeklyDashboard();
    container.innerHTML = html;
    if (!weeklyDashboardCollapsed) {
        initWeeklyCharts(weekData);
    }
}

async function loadWeeklyAIScore() {
    const weekKey = getWeekKey(weekDashboardOffset);
    const cached = getData('weekly_score_' + weekKey, null);
    if (cached) {
        renderAndInitWeeklyDashboard();
        return;
    }

    const weekData = getWeekData(weekDashboardOffset);
    const daysWithData = weekData.days.filter(d => d.hasMeals);
    if (daysWithData.length === 0) {
        showToast('אין מספיק נתונים לציון שבועי');
        return;
    }

    const profile = weekData.profile;
    const summary = weekData.days.map(d => {
        if (!d.hasMeals) return d.dayName + ': אין נתונים';
        return d.dayName + ': ' + d.calories + ' קק״ל, חלבון ' + d.protein + 'גר, פחמ ' + d.carbs + 'גר, שומן ' + d.fat + 'גר, מים ' + d.water + ' כוסות' + (d.weight ? ', משקל ' + d.weight + ' ק״ג' : '');
    }).join('\n');

    const systemPrompt = 'אתה דיאטנית מומחית. תני ציון שבועי מ-1 עד 10 בהתבסס על הנתונים. ענה בפורמט JSON בלבד: {"score": NUMBER, "explanation": "הסבר קצר בעברית תוך 2 משפטים"}';
    const userMsg = 'הנה הנתונים השבועיים שלי:\nיעד קלוריות: ' + (profile.targetCalories || 1500) + '\nיעד חלבון: ' + (profile.targetProtein || 80) + 'גר\n\n' + summary;

    try {
        const scoreBtn = document.querySelector('.weekly-score-card .weekly-nav-btn');
        if (scoreBtn) { scoreBtn.textContent = 'מחשב...'; scoreBtn.disabled = true; }

        const response = await callAPI(systemPrompt, [{ role: 'user', content: userMsg }], 256);
        const text = response.content ? response.content[0].text : response.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            setData('weekly_score_' + weekKey, parsed);
        }
    } catch (err) {
        console.error('Weekly AI score error:', err);
        showToast('שגיאה בחישוב ציון AI');
    }

    renderAndInitWeeklyDashboard();
}


// ============ Food Log ============
const MEAL_TYPES = [
    { id: 'breakfast', name: 'בוקר',   icon: 'sunrise' },
    { id: 'lunch',     name: 'צהריים', icon: 'sun' },
    { id: 'dinner',    name: 'ערב',    icon: 'sunset' },
    { id: 'snack',     name: 'חטיף',   icon: 'cookie' }
];

function renderMealTypeSelector() {
    const container = document.getElementById('meal-type-selector');
    if (!container) return;
    container.innerHTML = MEAL_TYPES.map(t => {
        const active = t.id === currentMealType ? ' active' : '';
        return `<button class="meal-type${active}" data-meal="${t.id}" onclick="selectMealType(this)">
            <span class="meal-type-icon">${icon(t.icon, 16)}</span>
            <span>${t.name}</span>
        </button>`;
    }).join('');
}

function selectMealType(btn) {
    document.querySelectorAll('.meal-type').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMealType = btn.dataset.meal;
}

// ============ Food Photo Handling ============
let currentFoodPhoto = null; // base64 string of current photo

function handleFoodPhoto(input) {
    const file = input.files[0];
    if (!file) return;

    // Compress and convert to base64
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            // Resize to max 800px for efficient API calls
            const canvas = document.createElement('canvas');
            const maxSize = 800;
            let w = img.width, h = img.height;
            if (w > maxSize || h > maxSize) {
                if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                else { w = Math.round(w * maxSize / h); h = maxSize; }
            }
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const base64 = canvas.toDataURL('image/jpeg', 0.8);
            currentFoodPhoto = base64.split(',')[1]; // Remove data:image/jpeg;base64, prefix

            // Show preview
            document.getElementById('photo-preview').src = base64;
            document.getElementById('photo-preview-container').classList.remove('hidden');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    input.value = ''; // Reset so same file can be selected again
}

function removePhotoPreview() {
    currentFoodPhoto = null;
    document.getElementById('photo-preview-container').classList.add('hidden');
    document.getElementById('photo-preview').src = '';
}

async function analyzeFood() {
    const input = document.getElementById('food-input').value.trim();
    if (!input && !currentFoodPhoto) {
        showToast('תארי מה אכלת או צלמי תמונה');
        return;
    }

    const profile = getProfile();

    const loadingText = currentFoodPhoto ? 'מנתחת את התמונה...' : 'מנתחת את הארוחה...';
    showLoading(loadingText);
    try {
        const result = await analyzeFoodWithAI(input, profile, currentFoodPhoto);
        const description = result.detected_food || input || 'ארוחה מצולמת';
        lastAnalysis = {
            ...result,
            description,
            mealType: currentMealType,
            photo: currentFoodPhoto ? `data:image/jpeg;base64,${currentFoodPhoto}` : null
        };
        displayAnalysis(result);
    } catch (err) {
        showToast('שגיאה בניתוח: ' + err.message);
    }
    hideLoading();
}

// Portion tracking for analysis
let _currentPortions = 1;
let _baseAnalysisValues = null;

function displayAnalysis(data) {
    _currentPortions = 1;
    _baseAnalysisValues = {
        calories: data.calories,
        protein: data.protein,
        carbs: data.carbs,
        fat: data.fat
    };

    // Show photo in analysis if exists
    const photoPreview = document.getElementById('analysis-photo-preview');
    const photoImg = document.getElementById('analysis-photo-img');
    if (currentFoodPhoto) {
        photoImg.src = `data:image/jpeg;base64,${currentFoodPhoto}`;
        photoPreview.classList.remove('hidden');
    } else {
        photoPreview.classList.add('hidden');
    }

    // Show detected food with health score, portion adjuster, and bookmark
    const detectedEl = document.getElementById('analysis-detected');
    const healthScore = data.health_score || 5;
    const scoreColor = healthScore >= 7 ? 'var(--success)' : healthScore >= 4 ? 'var(--warning)' : 'var(--danger)';
    const isFav = isMealFavorited(data);

    if (data.detected_food) {
        detectedEl.innerHTML = `
            <div class="analysis-detected-row">
                <div class="health-score-circle" style="background: ${scoreColor};" title="ציון בריאות: ${healthScore}/10">${healthScore}</div>
                <span class="detected-food-name">${data.detected_food}</span>
                <div class="portion-adjuster">
                    <button class="portion-btn" onclick="adjustPortions(-1)" title="פחות">${icon('minus', 16)}</button>
                    <span class="portion-count" id="portion-count">1</span>
                    <button class="portion-btn" onclick="adjustPortions(1)" title="עוד">${icon('plus', 16)}</button>
                </div>
                <button class="bookmark-btn${isFav ? ' bookmarked' : ''}" id="analysis-bookmark-btn" onclick="toggleFavorite()" title="שמרי למועדפים">${icon(isFav ? 'bookmarkFilled' : 'bookmark', 20)}</button>
            </div>
        `;
        detectedEl.classList.remove('hidden');
    } else {
        detectedEl.classList.add('hidden');
    }

    const grid = document.getElementById('analysis-grid');
    grid.innerHTML = `
        <div class="analysis-item cal"><span class="label">קלוריות</span><input type="number" class="value macro-input" id="macro-calories" value="${data.calories}" data-base="${data.calories}"></div>
        <div class="analysis-item protein"><span class="label">חלבון</span><input type="number" class="value macro-input" id="macro-protein" value="${data.protein}" data-base="${data.protein}"></div>
        <div class="analysis-item carbs"><span class="label">פחמימות</span><input type="number" class="value macro-input" id="macro-carbs" value="${data.carbs}" data-base="${data.carbs}"></div>
        <div class="analysis-item fat"><span class="label">שומן</span><input type="number" class="value macro-input" id="macro-fat" value="${data.fat}" data-base="${data.fat}"></div>
    `;
    document.getElementById('analysis-notes').textContent = data.notes || '';
    document.getElementById('food-analysis-result').classList.remove('hidden');
}

function adjustPortions(delta) {
    const newVal = _currentPortions + delta;
    if (newVal < 1) return;
    _currentPortions = newVal;
    document.getElementById('portion-count').textContent = _currentPortions;

    if (_baseAnalysisValues) {
        ['calories', 'protein', 'carbs', 'fat'].forEach(f => {
            const input = document.getElementById('macro-' + f);
            if (input) {
                input.value = Math.round(_baseAnalysisValues[f] * _currentPortions);
            }
        });
    }
}

function isMealFavorited(data) {
    const favorites = getData('favorites', []);
    return favorites.some(f => f.detected_food === data.detected_food);
}

function toggleFavorite() {
    if (!lastAnalysis) return;
    const favorites = getData('favorites', []);
    const idx = favorites.findIndex(f => f.detected_food === lastAnalysis.detected_food);
    const btn = document.getElementById('analysis-bookmark-btn');

    if (idx >= 0) {
        favorites.splice(idx, 1);
        setData('favorites', favorites);
        if (btn) { btn.innerHTML = icon('bookmark', 20); btn.classList.remove('bookmarked'); }
        showToast('הוסר מהמועדפים');
    } else {
        const meal = {
            calories: parseInt(document.getElementById('macro-calories')?.value) || lastAnalysis.calories,
            protein: parseInt(document.getElementById('macro-protein')?.value) || lastAnalysis.protein,
            carbs: parseInt(document.getElementById('macro-carbs')?.value) || lastAnalysis.carbs,
            fat: parseInt(document.getElementById('macro-fat')?.value) || lastAnalysis.fat,
            health_score: lastAnalysis.health_score || 5,
            detected_food: lastAnalysis.detected_food || lastAnalysis.description,
            description: lastAnalysis.description,
            notes: lastAnalysis.notes || '',
            mealType: lastAnalysis.mealType || currentMealType
        };
        favorites.push(meal);
        setData('favorites', favorites);
        if (btn) { btn.innerHTML = icon('bookmarkFilled', 20); btn.classList.add('bookmarked'); }
        showToast('נשמר למועדפים');
    }
    refreshFavorites();
}

function loadFavorites() {
    return getData('favorites', []);
}

function removeFavorite(index) {
    const favorites = getData('favorites', []);
    favorites.splice(index, 1);
    setData('favorites', favorites);
    showToast('הוסר מהמועדפים');
    refreshFavorites();
}

function addFavoriteAsMeal(index) {
    const favorites = getData('favorites', []);
    const fav = favorites[index];
    if (!fav) return;

    const dayKey = getTodayKey();
    const meals = getData('meals_' + dayKey, []);
    const mealId = Date.now();
    meals.push({
        ...fav,
        photo: null,
        time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
        id: mealId
    });
    setData('meals_' + dayKey, meals);
    showToast('הארוחה נוספה מהמועדפים');
    addXP(XP_REWARDS.log_meal, 'log_meal');
    markTodayActive();
    checkAchievements();
    refreshFoodLog();
    refreshFavorites();
}

function refreshFavorites() {
    const container = document.getElementById('favorites-section');
    if (!container) return;
    const favorites = getData('favorites', []);

    if (favorites.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    const list = container.querySelector('.favorites-list');
    if (!list) return;

    list.innerHTML = favorites.map((fav, i) => `
        <div class="favorite-chip" onclick="addFavoriteAsMeal(${i})">
            <span class="favorite-chip-name">${fav.detected_food || fav.description}</span>
            <span class="favorite-chip-cal">${fav.calories} קק״ל</span>
            <button class="favorite-chip-remove" onclick="event.stopPropagation(); removeFavorite(${i})" title="הסרה">\u2715</button>
        </div>
    `).join('');
}

// ============ Share Meal ============
function shareMealAnalysis() {
    if (!lastAnalysis) return;
    const m = lastAnalysis;
    const text = `${m.description}\n${m.calories} קק"ל | ח: ${m.protein}g | פ: ${m.carbs}g | ש: ${m.fat}g\n${m.notes ? m.notes : ''}\n\nשיפטי - הדיאטנית החכמה שלך`;

    if (navigator.share) {
        const shareData = { title: 'שיפטי - ניתוח ארוחה', text };
        // If photo exists try to share it too
        if (m.photo && navigator.canShare) {
            fetch(m.photo).then(r => r.blob()).then(blob => {
                const file = new File([blob], 'meal.jpg', { type: 'image/jpeg' });
                const withFile = { ...shareData, files: [file] };
                if (navigator.canShare(withFile)) {
                    navigator.share(withFile).catch(() => {});
                } else {
                    navigator.share(shareData).catch(() => {});
                }
            }).catch(() => navigator.share(shareData).catch(() => {}));
        } else {
            navigator.share(shareData).catch(() => {});
        }
    } else {
        navigator.clipboard.writeText(text).then(() => showToast('הועתק!'));
    }
}

function saveMeal() {
    if (!lastAnalysis) return;

    // Read edited macro values from inputs (user may have edited them)
    const editedCalories = parseInt(document.getElementById('macro-calories')?.value);
    const editedProtein = parseInt(document.getElementById('macro-protein')?.value);
    const editedCarbs = parseInt(document.getElementById('macro-carbs')?.value);
    const editedFat = parseInt(document.getElementById('macro-fat')?.value);

    if (!isNaN(editedCalories)) lastAnalysis.calories = editedCalories;
    if (!isNaN(editedProtein)) lastAnalysis.protein = editedProtein;
    if (!isNaN(editedCarbs)) lastAnalysis.carbs = editedCarbs;
    if (!isNaN(editedFat)) lastAnalysis.fat = editedFat;

    const dayKey = getTodayKey();
    const meals = getData('meals_' + dayKey, []);
    const mealId = Date.now();

    // Save photo separately to avoid bloating meals data
    if (lastAnalysis.photo) {
        const photos = getData('meal_photos', {});
        photos[mealId] = lastAnalysis.photo;
        setData('meal_photos', photos);
    }

    meals.push({
        ...lastAnalysis,
        photo: lastAnalysis.photo ? mealId : null, // Store photo reference, not full base64
        time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
        id: mealId
    });
    setData('meals_' + dayKey, meals);

    lastAnalysis = null;
    currentFoodPhoto = null;
    document.getElementById('food-input').value = '';
    document.getElementById('photo-preview-container').classList.add('hidden');
    document.getElementById('food-analysis-result').classList.add('hidden');
    showToast('הארוחה נשמרה');

    // Gamification: XP + streak + achievements
    addXP(XP_REWARDS.log_meal, 'log_meal');
    markTodayActive();
    checkAchievements();

    // Share to groups feed
    const savedMeal = meals[meals.length - 1];
    postGroupActivity('meal', {
        mealType: savedMeal.mealType,
        description: savedMeal.description,
        calories: savedMeal.calories,
        protein: savedMeal.protein
    });

    refreshFoodLog();
    refreshFoodGallery();

    // Scroll back to input after saving
    const stickyTop = document.querySelector('.food-sticky-top');
    if (stickyTop) stickyTop.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function changeFoodDay(dir) {
    foodDayOffset += dir;
    if (foodDayOffset > 0) foodDayOffset = 0;
    refreshFoodLog();
}

function refreshFoodLog() {
    const dayKey = getTodayKey(foodDayOffset);
    const label = document.getElementById('food-day-label');
    if (foodDayOffset === 0) label.textContent = 'היום';
    else if (foodDayOffset === -1) label.textContent = 'אתמול';
    else label.textContent = formatDate(dayKey);

    const meals = getData('meals_' + dayKey, []);
    const list = document.getElementById('food-log-list');

    if (meals.length === 0) {
        list.innerHTML = `<div class="empty-state"><p>אין ארוחות ליום הזה</p></div>`;
        document.getElementById('daily-score-container').style.display = 'none';
        return;
    }

    const mealLabels = { breakfast: 'בוקר', lunch: 'צהריים', dinner: 'ערב', snack: 'חטיף' };
    const photos = getData('meal_photos', {});
    list.innerHTML = meals.map((m, i) => {
        const hasPhoto = m.photo && photos[m.photo];
        const thumbSrc = hasPhoto ? photos[m.photo] : '';
        return `
        <div class="food-log-item${hasPhoto ? ' food-log-item--with-photo' : ''}">
            ${hasPhoto
                ? `<img class="food-log-thumb" src="${thumbSrc}" alt="" onclick="openFoodPhoto(${m.photo})">`
                : `<span class="food-emoji">${mealLabels[m.mealType] || 'ארוחה'}</span>`
            }
            <div class="food-details">
                <div class="food-name">${m.description}</div>
                <div class="food-macros">ח: ${m.protein}g · פ: ${m.carbs}g · ש: ${m.fat}g · ${m.time || ''}</div>
            </div>
            <span class="food-cal">${m.calories} קק״ל</span>
            <button class="food-share-btn" onclick="event.stopPropagation(); shareSavedMeal('${dayKey}', ${i})" title="שתפי">שתפי</button>
            <button class="food-edit" onclick="editMeal('${dayKey}', ${i})" title="עריכה">${icon('edit', 14)}</button>
            <button class="food-delete" onclick="deleteMeal('${dayKey}', ${i})" title="מחיקה">✕</button>
        </div>
    `}).join('');

    // Daily totals & score
    const totals = meals.reduce((acc, m) => {
        acc.calories += m.calories || 0;
        acc.protein += m.protein || 0;
        return acc;
    }, { calories: 0, protein: 0 });

    const profile = getProfile();
    const targetCal = profile.targetCalories || 1500;
    const pct = totals.calories / targetCal;
    let score, note;
    if (pct >= 0.85 && pct <= 1.05) { score = 'מצוין'; note = 'בטווח הקלוריות היומי!'; }
    else if (pct < 0.85 && pct >= 0.6) { score = 'סביר'; note = 'אכלת פחות מהיעד'; }
    else if (pct > 1.05 && pct <= 1.2) { score = 'קצת מעל'; note = 'חרגת מעט מהיעד'; }
    else if (pct < 0.6) { score = 'נמוך'; note = 'אכלת מעט מדי היום'; }
    else { score = 'חריגה'; note = 'חריגה משמעותית מהיעד'; }

    document.getElementById('daily-score').textContent = score;
    document.getElementById('daily-score-note').textContent = note;
    document.getElementById('daily-score-container').style.display = 'block';

    // Award calorie target XP if in range and today
    if (foodDayOffset === 0 && pct >= 0.85 && pct <= 1.05) {
        const calTargetKey = 'game_cal_target_' + getTodayKey();
        if (!getData(calTargetKey, false)) {
            setData(calTargetKey, true);
            addXP(XP_REWARDS.calorie_target, 'calorie_target');
            checkAchievements();
        }
    }

    // Refresh favorites bar
    refreshFavorites();
}

function deleteMeal(dayKey, index) {
    const meals = getData('meals_' + dayKey, []);
    // Also delete photo if exists
    const meal = meals[index];
    if (meal && meal.photo) {
        const photos = getData('meal_photos', {});
        delete photos[meal.photo];
        setData('meal_photos', photos);
    }
    meals.splice(index, 1);
    setData('meals_' + dayKey, meals);
    refreshFoodLog();
    refreshFoodGallery();
    showToast('הארוחה נמחקה');
}

function editMeal(dayKey, index) {
    const meals = getData('meals_' + dayKey, []);
    const m = meals[index];
    if (!m) return;

    const mealLabels = { breakfast: 'בוקר', lunch: 'צהריים', dinner: 'ערב', snack: 'חטיף' };
    const items = document.querySelectorAll('.food-log-item');
    const item = items[index];
    if (!item) return;

    item.innerHTML = `
        <div style="width:100%;display:flex;flex-direction:column;gap:8px;padding:4px 0">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <input type="text" id="edit-meal-desc-${index}" value="${m.description}" style="flex:1;min-width:150px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);font-family:Heebo;font-size:0.82rem" placeholder="תיאור">
                <select id="edit-meal-type-${index}" style="padding:6px;border:1px solid var(--border);border-radius:var(--radius);font-family:Heebo;font-size:0.82rem">
                    ${Object.entries(mealLabels).map(([k, v]) => `<option value="${k}" ${k === m.mealType ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <label style="font-size:0.75rem;color:var(--text-muted)">קלוריות:</label>
                <input type="number" id="edit-meal-cal-${index}" value="${m.calories}" style="width:70px;padding:6px;border:1px solid var(--border);border-radius:var(--radius);font-family:Heebo;font-size:0.82rem">
                <label style="font-size:0.75rem;color:var(--text-muted)">ח:</label>
                <input type="number" id="edit-meal-protein-${index}" value="${m.protein}" style="width:55px;padding:6px;border:1px solid var(--border);border-radius:var(--radius);font-family:Heebo;font-size:0.82rem">
                <label style="font-size:0.75rem;color:var(--text-muted)">פ:</label>
                <input type="number" id="edit-meal-carbs-${index}" value="${m.carbs}" style="width:55px;padding:6px;border:1px solid var(--border);border-radius:var(--radius);font-family:Heebo;font-size:0.82rem">
                <label style="font-size:0.75rem;color:var(--text-muted)">ש:</label>
                <input type="number" id="edit-meal-fat-${index}" value="${m.fat}" style="width:55px;padding:6px;border:1px solid var(--border);border-radius:var(--radius);font-family:Heebo;font-size:0.82rem">
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button class="history-save-btn" onclick="saveMealEdit('${dayKey}', ${index})">שמור</button>
                <button class="history-cancel-btn" onclick="refreshFoodLog()">ביטול</button>
            </div>
        </div>`;
}

function saveMealEdit(dayKey, index) {
    const meals = getData('meals_' + dayKey, []);
    const m = meals[index];
    if (!m) return;

    m.description = document.getElementById('edit-meal-desc-' + index)?.value || m.description;
    m.mealType = document.getElementById('edit-meal-type-' + index)?.value || m.mealType;
    m.calories = parseInt(document.getElementById('edit-meal-cal-' + index)?.value) || 0;
    m.protein = parseInt(document.getElementById('edit-meal-protein-' + index)?.value) || 0;
    m.carbs = parseInt(document.getElementById('edit-meal-carbs-' + index)?.value) || 0;
    m.fat = parseInt(document.getElementById('edit-meal-fat-' + index)?.value) || 0;

    setData('meals_' + dayKey, meals);
    refreshFoodLog();
    showToast('הארוחה עודכנה');
}

// ============ AI Day Plan ============
async function planMyDay() {
    try {
        showLoading('מתכננת את היום שלך...');
        const profile = getProfile();
        const todayMeals = getData('meals_' + getTodayKey(), []);
        const plan = await generateDayPlan(profile, todayMeals);

        // Cache the plan
        setData('day_plan_' + getTodayKey(), plan);

        renderDayPlan(plan);
        hideLoading();
    } catch (err) {
        hideLoading();
        showToast(err.message || 'שגיאה ביצירת תפריט');
    }
}

function renderDayPlan(plan) {
    const container = document.getElementById('day-plan-container');
    if (!container || !plan || !plan.meals) return;

    const mealLabels = {breakfast: 'ארוחת בוקר', lunch: 'ארוחת צהריים', dinner: 'ארוחת ערב', snack: 'חטיף'};
    const mealIcons = {breakfast: 'sunrise', lunch: 'sun', dinner: 'moon', snack: 'apple'};

    let html = '<div class="day-plan-card">';
    html += '<div class="day-plan-header"><h3>התפריט שלך להיום</h3></div>';

    plan.meals.forEach((meal, index) => {
        html += `
        <div class="day-plan-meal" data-meal-index="${index}">
            <div class="day-plan-meal-header">
                <span class="day-plan-meal-type">${icon(mealIcons[meal.type] || 'utensils', 16)} ${mealLabels[meal.type] || meal.type}</span>
                <span class="day-plan-meal-cal">${meal.calories} קק״ל</span>
            </div>
            <div class="day-plan-meal-name">${meal.name}</div>
            <div class="day-plan-meal-desc">${meal.description || ''}</div>
            ${meal.ingredients && meal.ingredients.length > 0 ? `
            <div class="day-plan-ingredients">
                ${meal.ingredients.map(ing => `<span class="day-plan-ingredient">${ing}</span>`).join('')}
            </div>` : ''}
            <div class="day-plan-macros">
                <span>חלבון: ${meal.protein}g</span>
                <span>פחמימות: ${meal.carbs}g</span>
                <span>שומן: ${meal.fat}g</span>
            </div>
            <div class="day-plan-actions">
                <button class="btn-swap-meal" onclick="swapPlanMeal('${meal.type}')">
                    ${icon('x', 14)} החליפי מנה
                </button>
                <button class="btn-add-to-log" onclick="addPlanMealToLog(${index})">
                    ${icon('plus', 14)} הוסיפי ליומן
                </button>
            </div>
        </div>`;
    });

    if (plan.total) {
        html += `
        <div class="day-plan-total">
            <span class="day-plan-total-label">סה״כ:</span>
            <span>${plan.total.calories} קק״ל</span>
            <span>ח: ${plan.total.protein}g</span>
            <span>פ: ${plan.total.carbs}g</span>
            <span>ש: ${plan.total.fat}g</span>
        </div>`;
    }

    if (plan.tip) {
        html += `<div class="day-plan-tip">${icon('zap', 14)} ${plan.tip}</div>`;
    }

    html += '</div>';
    container.innerHTML = html;
    container.style.display = 'block';
}

async function swapPlanMeal(mealType) {
    try {
        showLoading('מחליפה מנה...');
        const profile = getProfile();
        const plan = getData('day_plan_' + getTodayKey(), null);
        if (!plan || !plan.meals) { hideLoading(); return; }

        const otherMeals = plan.meals.filter(m => m.type !== mealType);
        const newMeal = await swapMeal(mealType, profile, otherMeals);

        // Update the plan
        const idx = plan.meals.findIndex(m => m.type === mealType);
        if (idx !== -1) {
            plan.meals[idx] = newMeal;
        }

        // Recalculate total
        plan.total = plan.meals.reduce((acc, m) => ({
            calories: acc.calories + (m.calories || 0),
            protein: acc.protein + (m.protein || 0),
            carbs: acc.carbs + (m.carbs || 0),
            fat: acc.fat + (m.fat || 0)
        }), {calories: 0, protein: 0, carbs: 0, fat: 0});

        setData('day_plan_' + getTodayKey(), plan);
        renderDayPlan(plan);
        hideLoading();
        showToast('המנה הוחלפה');
    } catch (err) {
        hideLoading();
        showToast(err.message || 'שגיאה בהחלפת מנה');
    }
}

function addPlanMealToLog(mealIndex) {
    const plan = getData('day_plan_' + getTodayKey(), null);
    if (!plan || !plan.meals || !plan.meals[mealIndex]) return;

    const meal = plan.meals[mealIndex];
    const dayKey = getTodayKey();
    const meals = getData('meals_' + dayKey, []);
    const mealId = Date.now();

    meals.push({
        description: meal.name,
        detected_food: meal.name,
        calories: Math.round(meal.calories || 0),
        protein: Math.round(meal.protein || 0),
        carbs: Math.round(meal.carbs || 0),
        fat: Math.round(meal.fat || 0),
        mealType: meal.type,
        notes: meal.description || '',
        time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
        id: mealId,
        photo: null
    });
    setData('meals_' + dayKey, meals);

    showToast('הארוחה נוספה ליומן');

    // Gamification
    addXP(XP_REWARDS.log_meal, 'log_meal');
    markTodayActive();
    checkAchievements();

    // Share to groups feed
    const savedMeal = meals[meals.length - 1];
    postGroupActivity('meal', {
        mealType: savedMeal.mealType,
        description: savedMeal.description,
        calories: savedMeal.calories,
        protein: savedMeal.protein
    });

    refreshFoodLog();
}

function loadCachedDayPlan() {
    const plan = getData('day_plan_' + getTodayKey(), null);
    if (plan && plan.meals && plan.meals.length > 0) {
        renderDayPlan(plan);
    }
}

// ============ Food Gallery ============
function refreshFoodGallery() {
    const galleryEl = document.getElementById('food-gallery');
    if (!galleryEl) return;

    const photos = getData('meal_photos', {});
    const photoIds = Object.keys(photos).sort((a, b) => b - a); // Newest first

    if (photoIds.length === 0) {
        galleryEl.innerHTML = '<div class="gallery-empty">תמונות הארוחות שלך יופיעו כאן</div>';
        return;
    }

    // Show last 12 photos
    galleryEl.innerHTML = photoIds.slice(0, 12).map(id => `
        <div class="gallery-item" onclick="openFoodPhoto(${id})">
            <img src="${photos[id]}" alt="ארוחה" loading="lazy">
        </div>
    `).join('');
}

function openFoodPhoto(photoId) {
    const photos = getData('meal_photos', {});
    const src = photos[photoId];
    if (!src) return;

    // Create full-screen overlay
    const overlay = document.createElement('div');
    overlay.className = 'photo-overlay';
    overlay.innerHTML = `
        <div class="photo-overlay-content">
            <img src="${src}" alt="ארוחה">
            <div class="photo-overlay-actions">
                <button onclick="this.closest('.photo-overlay').remove()">✕ סגרי</button>
                <button onclick="sharePhoto(${photoId})">שתפי</button>
            </div>
        </div>
    `;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
}

function sharePhoto(photoId) {
    const photos = getData('meal_photos', {});
    const src = photos[photoId];
    if (!src) return;

    if (navigator.share && navigator.canShare) {
        fetch(src).then(r => r.blob()).then(blob => {
            const file = new File([blob], 'meal.jpg', { type: 'image/jpeg' });
            const shareData = { title: 'שיפטי - ארוחה', files: [file] };
            if (navigator.canShare(shareData)) {
                navigator.share(shareData).catch(() => {});
            } else {
                showToast('השיתוף לא נתמך במכשיר');
            }
        });
    } else {
        showToast('השיתוף לא נתמך בדפדפן הזה');
    }
}

function shareSavedMeal(dayKey, index) {
    const meals = getData('meals_' + dayKey, []);
    const m = meals[index];
    if (!m) return;

    const text = `${m.description}\n${m.calories} קק"ל | ח: ${m.protein}g | פ: ${m.carbs}g | ש: ${m.fat}g\n${m.notes ? m.notes : ''}\n\nשיפטי - הדיאטנית החכמה שלך`;

    if (navigator.share) {
        const shareData = { title: 'שיפטי - ארוחה', text };
        const photos = getData('meal_photos', {});
        if (m.photo && photos[m.photo] && navigator.canShare) {
            fetch(photos[m.photo]).then(r => r.blob()).then(blob => {
                const file = new File([blob], 'meal.jpg', { type: 'image/jpeg' });
                const withFile = { ...shareData, files: [file] };
                if (navigator.canShare(withFile)) {
                    navigator.share(withFile).catch(() => {});
                } else {
                    navigator.share(shareData).catch(() => {});
                }
            }).catch(() => navigator.share(shareData).catch(() => {}));
        } else {
            navigator.share(shareData).catch(() => {});
        }
    } else {
        navigator.clipboard.writeText(text).then(() => showToast('הועתק!'));
    }
}

// ============ Metrics ============
function refreshMetrics() {
    updateMetricsRangeTabs();
    renderCalorieChart();
    renderWeightChart();
    renderMeasurements();
    renderBloodTests();
    renderProgressGallery();
    checkMonthlyPhotoPrompt();
}

function getMetricsDateRange() {
    const now = new Date();
    let startDate;
    switch (_metricsRange) {
        case '7d': startDate = new Date(now); startDate.setDate(now.getDate() - 6); break;
        case '30d': startDate = new Date(now); startDate.setDate(now.getDate() - 29); break;
        case '3m': startDate = new Date(now); startDate.setMonth(now.getMonth() - 3); break;
        case 'all': default: return null; // no filter
    }
    return startDate.toISOString().split('T')[0];
}

function updateMetricsRangeTabs() {
    const tabs = document.querySelectorAll('.range-tab');
    tabs.forEach(tab => {
        const range = tab.getAttribute('onclick').match(/'([^']+)'/)?.[1];
        tab.classList.toggle('active', range === _metricsRange);
    });
}

function changeMetricsRange(range) {
    _metricsRange = range;
    updateMetricsRangeTabs();
    renderCalorieChart();
    renderWeightChart();
}

function renderCalorieChart() {
    const ctx = document.getElementById('calorie-chart');
    if (!ctx) return;
    if (calorieChart) calorieChart.destroy();

    const startDateStr = getMetricsDateRange();
    const now = new Date();
    const todayKey = getTodayKey();

    // Determine how many days to show
    let numDays;
    if (_metricsRange === '7d') numDays = 7;
    else if (_metricsRange === '30d') numDays = 30;
    else if (_metricsRange === '3m') numDays = 90;
    else numDays = 90; // for 'all', show last 90 days max for chart readability

    const labels = [];
    const proteinData = [];
    const carbsData = [];
    const fatData = [];
    let totalCalories = 0;
    let daysWithData = 0;

    for (let i = -(numDays - 1); i <= 0; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const key = d.toISOString().split('T')[0];

        // For 'all' mode, only show days that have data
        const meals = getData('meals_' + key, []);
        if (_metricsRange === 'all' && meals.length === 0) continue;

        const totals = meals.reduce((acc, m) => {
            acc.protein += (m.protein || 0) * 4; // cal from protein
            acc.carbs += (m.carbs || 0) * 4;     // cal from carbs
            acc.fat += (m.fat || 0) * 9;         // cal from fat
            acc.calories += m.calories || 0;
            return acc;
        }, { protein: 0, carbs: 0, fat: 0, calories: 0 });

        labels.push(d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }));
        proteinData.push(Math.round(totals.protein));
        carbsData.push(Math.round(totals.carbs));
        fatData.push(Math.round(totals.fat));

        if (totals.calories > 0) {
            totalCalories += totals.calories;
            daysWithData++;
        }
    }

    const avgCalories = daysWithData > 0 ? Math.round(totalCalories / daysWithData) : 0;

    // Update average display
    const avgEl = document.getElementById('avg-calories-display');
    if (avgEl) {
        avgEl.innerHTML = daysWithData > 0
            ? `<span class="avg-label">ממוצע יומי:</span> <span class="avg-value">${avgCalories}</span> <span class="avg-unit">קק״ל</span>`
            : '<span class="avg-label">אין נתונים עדיין</span>';
    }

    const style = getComputedStyle(document.documentElement);
    const proteinColor = style.getPropertyValue('--protein-color').trim() || '#6940A5';
    const carbsColor = style.getPropertyValue('--carbs-color').trim() || '#CB912F';
    const fatColor = style.getPropertyValue('--fat-color').trim() || '#EB5757';

    calorieChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'חלבון',
                    data: proteinData,
                    backgroundColor: proteinColor,
                    borderRadius: 2
                },
                {
                    label: 'פחמימות',
                    data: carbsData,
                    backgroundColor: carbsColor,
                    borderRadius: 2
                },
                {
                    label: 'שומן',
                    data: fatData,
                    backgroundColor: fatColor,
                    borderRadius: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { font: { family: 'Heebo', size: 11 }, usePointStyle: true, pointStyle: 'circle', padding: 12 }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + context.raw + ' קק״ל';
                        },
                        footer: function(items) {
                            const total = items.reduce((s, i) => s + i.raw, 0);
                            return 'סה״כ: ' + total + ' קק״ל';
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: { font: { family: 'Heebo', size: 10 }, maxRotation: 45 },
                    grid: { display: false }
                },
                y: {
                    stacked: true,
                    ticks: { font: { family: 'Heebo', size: 11 } },
                    grid: { color: '#F3F4F6' }
                }
            }
        }
    });
}

function renderWeightChart() {
    let weights = getData('weights', []);
    const ctx = document.getElementById('weight-chart');
    if (!ctx) return;

    if (weightChart) weightChart.destroy();

    // Filter by selected range
    const startDateStr = getMetricsDateRange();
    if (startDateStr) {
        weights = weights.filter(w => w.date >= startDateStr);
    }

    if (weights.length === 0) {
        weightChart = new Chart(ctx, {
            type: 'line',
            data: { labels: ['עדיין אין נתונים'], datasets: [{ data: [0] }] },
            options: { plugins: { legend: { display: false } }, scales: { y: { display: false }, x: { display: false } } }
        });
        return;
    }

    const profile = getProfile();
    const labels = weights.map(w => formatDate(w.date));
    const data = weights.map(w => w.value);

    const datasets = [{
        label: 'משקל',
        data: data,
        borderColor: '#10B981',
        backgroundColor: 'rgba(16,185,129,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#10B981'
    }];

    if (profile.targetWeight) {
        datasets.push({
            label: 'יעד',
            data: Array(data.length).fill(parseFloat(profile.targetWeight)),
            borderColor: '#E5E7EB',
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false
        });
    }

    weightChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    ticks: { font: { family: 'Heebo', size: 11 } },
                    grid: { color: '#F3F4F6' }
                },
                x: {
                    ticks: { font: { family: 'Heebo', size: 10 }, maxRotation: 45 },
                    grid: { display: false }
                }
            }
        }
    });
    renderWeightHistory();
}

function renderMeasurements() {
    const measurements = getData('measurements', []);
    if (measurements.length === 0) return;
    const latest = measurements[measurements.length - 1];
    if (latest.waist) document.getElementById('m-waist').textContent = latest.waist;
    if (latest.hips) document.getElementById('m-hips').textContent = latest.hips;
    if (latest.arm) document.getElementById('m-arm').textContent = latest.arm;

    // BMI
    const profile = getProfile();
    const weights = getData('weights', []);
    if (profile.height && weights.length > 0) {
        const heightM = profile.height / 100;
        const bmi = (weights[weights.length - 1].value / (heightM * heightM)).toFixed(1);
        document.getElementById('m-bmi').textContent = bmi;
    }
    renderMeasurementsHistory();
}

// ============ Weight History (Edit/Delete) ============
function renderWeightHistory() {
    const container = document.getElementById('weight-history-list');
    if (!container) return;
    const weights = getData('weights', []);
    if (weights.length === 0) { container.innerHTML = ''; return; }

    const sorted = [...weights].sort((a, b) => b.date.localeCompare(a.date));
    container.innerHTML = `
        <button class="history-list-toggle" onclick="toggleHistory('weight-history-items')">
            ${icon('list', 14)} היסטוריה (${sorted.length})
        </button>
        <div id="weight-history-items" class="history-items">
            ${sorted.map((w, i) => {
                const origIdx = weights.indexOf(w);
                return `<div class="history-item" id="weight-row-${origIdx}">
                    <span class="history-item-date">${formatDate(w.date)}</span>
                    <span class="history-item-value">${w.value} ק״ג</span>
                    <div class="history-item-actions">
                        <button class="history-edit-btn" onclick="editWeight(${origIdx})" title="עריכה">${icon('edit', 14)}</button>
                        <button class="history-delete-btn" onclick="deleteWeight(${origIdx})" title="מחיקה">✕</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
}

function toggleHistory(id) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('open');
}

function editWeight(index) {
    const weights = getData('weights', []);
    const w = weights[index];
    if (!w) return;
    const row = document.getElementById('weight-row-' + index);
    if (!row) return;
    row.outerHTML = `<div class="history-item-edit" id="weight-row-${index}">
        <input type="date" id="edit-weight-date-${index}" value="${w.date}">
        <input type="number" id="edit-weight-val-${index}" value="${w.value}" step="0.1"> ק״ג
        <button class="history-save-btn" onclick="saveWeightEdit(${index})">שמור</button>
        <button class="history-cancel-btn" onclick="renderWeightHistory(); renderWeightChart();">ביטול</button>
    </div>`;
}

function saveWeightEdit(index) {
    const weights = getData('weights', []);
    const newDate = document.getElementById('edit-weight-date-' + index)?.value;
    const newVal = parseFloat(document.getElementById('edit-weight-val-' + index)?.value);
    if (!newVal) { showToast('הכניסי ערך תקין'); return; }
    weights[index] = { date: newDate || weights[index].date, value: newVal };
    weights.sort((a, b) => a.date.localeCompare(b.date));
    setData('weights', weights);
    showToast('המשקל עודכן');
    renderWeightChart();
    renderWeightHistory();
    refreshDashboard();
}

function deleteWeight(index) {
    const weights = getData('weights', []);
    weights.splice(index, 1);
    setData('weights', weights);
    showToast('הרשומה נמחקה');
    renderWeightChart();
    renderWeightHistory();
    refreshDashboard();
}

// ============ Measurements History (Edit/Delete) ============
function renderMeasurementsHistory() {
    const container = document.getElementById('measurements-history-list');
    if (!container) return;
    const measurements = getData('measurements', []);
    if (measurements.length === 0) { container.innerHTML = ''; return; }

    const sorted = [...measurements].sort((a, b) => b.date.localeCompare(a.date));
    container.innerHTML = `
        <button class="history-list-toggle" onclick="toggleHistory('measurements-history-items')">
            ${icon('list', 14)} היסטוריה (${sorted.length})
        </button>
        <div id="measurements-history-items" class="history-items">
            ${sorted.map((m, i) => {
                const origIdx = measurements.indexOf(m);
                const parts = [];
                if (m.waist) parts.push('מותן: ' + m.waist);
                if (m.hips) parts.push('ירכ: ' + m.hips);
                if (m.arm) parts.push('זרוע: ' + m.arm);
                return `<div class="history-item" id="meas-row-${origIdx}">
                    <span class="history-item-date">${formatDate(m.date)}</span>
                    <span class="history-item-details">${parts.join(' · ')}</span>
                    <div class="history-item-actions">
                        <button class="history-edit-btn" onclick="editMeasurement(${origIdx})" title="עריכה">${icon('edit', 14)}</button>
                        <button class="history-delete-btn" onclick="deleteMeasurement(${origIdx})" title="מחיקה">✕</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
}

function editMeasurement(index) {
    const measurements = getData('measurements', []);
    const m = measurements[index];
    if (!m) return;
    const row = document.getElementById('meas-row-' + index);
    if (!row) return;
    row.outerHTML = `<div class="history-item-edit" id="meas-row-${index}">
        <input type="date" id="edit-meas-date-${index}" value="${m.date}">
        <input type="number" id="edit-meas-waist-${index}" value="${m.waist || ''}" placeholder="מותן" step="0.1">
        <input type="number" id="edit-meas-hips-${index}" value="${m.hips || ''}" placeholder="ירכ" step="0.1">
        <input type="number" id="edit-meas-arm-${index}" value="${m.arm || ''}" placeholder="זרוע" step="0.1">
        <button class="history-save-btn" onclick="saveMeasurementEdit(${index})">שמור</button>
        <button class="history-cancel-btn" onclick="refreshMetrics()">ביטול</button>
    </div>`;
}

function saveMeasurementEdit(index) {
    const measurements = getData('measurements', []);
    const newDate = document.getElementById('edit-meas-date-' + index)?.value;
    const waist = parseFloat(document.getElementById('edit-meas-waist-' + index)?.value) || null;
    const hips = parseFloat(document.getElementById('edit-meas-hips-' + index)?.value) || null;
    const arm = parseFloat(document.getElementById('edit-meas-arm-' + index)?.value) || null;
    if (!waist && !hips && !arm) { showToast('הכניסי לפחות ערך אחד'); return; }
    measurements[index] = { date: newDate || measurements[index].date, waist, hips, arm };
    measurements.sort((a, b) => a.date.localeCompare(b.date));
    setData('measurements', measurements);
    showToast('המידות עודכנו');
    refreshMetrics();
}

function deleteMeasurement(index) {
    const measurements = getData('measurements', []);
    measurements.splice(index, 1);
    setData('measurements', measurements);
    showToast('הרשומה נמחקה');
    refreshMetrics();
}

// ============ Blood Tests History (Edit/Delete) ============
function renderBloodTestsHistory() {
    const container = document.getElementById('blood-history-list');
    if (!container) return;
    const tests = getData('bloodTests', []);
    if (tests.length === 0) { container.innerHTML = ''; return; }

    const sorted = [...tests].sort((a, b) => b.date.localeCompare(a.date));
    const fields = ['glucose', 'cholesterol', 'triglycerides', 'iron', 'b12', 'vitd', 'tsh'];
    const labels = { glucose: 'סוכר', cholesterol: 'כולס׳', triglycerides: 'טריגלי׳', iron: 'ברזל', b12: 'B12', vitd: 'D', tsh: 'TSH' };

    container.innerHTML = `
        <button class="history-list-toggle" onclick="toggleHistory('blood-history-items')">
            ${icon('list', 14)} היסטוריה (${sorted.length})
        </button>
        <div id="blood-history-items" class="history-items">
            ${sorted.map((t, i) => {
                const origIdx = tests.indexOf(t);
                const vals = fields.filter(f => t[f]).map(f => labels[f] + ': ' + t[f]).join(' · ');
                return `<div class="history-item" id="blood-row-${origIdx}">
                    <span class="history-item-date">${formatDate(t.date)}</span>
                    <span class="history-item-details">${vals || 'ללא ערכים'}</span>
                    <div class="history-item-actions">
                        <button class="history-edit-btn" onclick="editBloodTest(${origIdx})" title="עריכה">${icon('edit', 14)}</button>
                        <button class="history-delete-btn" onclick="deleteBloodTest(${origIdx})" title="מחיקה">✕</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
}

function editBloodTest(index) {
    const tests = getData('bloodTests', []);
    const t = tests[index];
    if (!t) return;
    const row = document.getElementById('blood-row-' + index);
    if (!row) return;
    row.outerHTML = `<div class="history-item-edit" id="blood-row-${index}" style="flex-wrap:wrap">
        <input type="date" id="edit-blood-date-${index}" value="${t.date}">
        <input type="number" id="edit-blood-glucose-${index}" value="${t.glucose || ''}" placeholder="סוכר" step="0.1">
        <input type="number" id="edit-blood-cholesterol-${index}" value="${t.cholesterol || ''}" placeholder="כולסטרול" step="0.1">
        <input type="number" id="edit-blood-trig-${index}" value="${t.triglycerides || ''}" placeholder="טריגלי" step="0.1">
        <input type="number" id="edit-blood-iron-${index}" value="${t.iron || ''}" placeholder="ברזל" step="0.1">
        <input type="number" id="edit-blood-b12-${index}" value="${t.b12 || ''}" placeholder="B12" step="0.1">
        <input type="number" id="edit-blood-vitd-${index}" value="${t.vitd || ''}" placeholder="ויט D" step="0.1">
        <input type="number" id="edit-blood-tsh-${index}" value="${t.tsh || ''}" placeholder="TSH" step="0.01">
        <button class="history-save-btn" onclick="saveBloodTestEdit(${index})">שמור</button>
        <button class="history-cancel-btn" onclick="refreshMetrics()">ביטול</button>
    </div>`;
}

function saveBloodTestEdit(index) {
    const tests = getData('bloodTests', []);
    tests[index] = {
        date: document.getElementById('edit-blood-date-' + index)?.value || tests[index].date,
        glucose: parseFloat(document.getElementById('edit-blood-glucose-' + index)?.value) || null,
        cholesterol: parseFloat(document.getElementById('edit-blood-cholesterol-' + index)?.value) || null,
        triglycerides: parseFloat(document.getElementById('edit-blood-trig-' + index)?.value) || null,
        iron: parseFloat(document.getElementById('edit-blood-iron-' + index)?.value) || null,
        b12: parseFloat(document.getElementById('edit-blood-b12-' + index)?.value) || null,
        vitd: parseFloat(document.getElementById('edit-blood-vitd-' + index)?.value) || null,
        tsh: parseFloat(document.getElementById('edit-blood-tsh-' + index)?.value) || null
    };
    tests.sort((a, b) => a.date.localeCompare(b.date));
    setData('bloodTests', tests);
    showToast('הבדיקה עודכנה');
    refreshMetrics();
}

function deleteBloodTest(index) {
    const tests = getData('bloodTests', []);
    tests.splice(index, 1);
    setData('bloodTests', tests);
    showToast('הבדיקה נמחקה');
    refreshMetrics();
}

function renderBloodTests() {
    const tests = getData('bloodTests', []);
    if (tests.length === 0) return;
    const sortedTests = [...tests].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sortedTests[sortedTests.length - 1];
    const previous = sortedTests.length > 1 ? sortedTests[sortedTests.length - 2] : null;

    const ranges = {
        glucose: { min: 70, max: 100 },
        cholesterol: { min: 0, max: 200 },
        triglycerides: { min: 0, max: 150 },
        iron: { min: 60, max: 170 },
        b12: { min: 200, max: 900 },
        vitd: { min: 30, max: 100 },
        tsh: { min: 0.4, max: 4.0 }
    };

    Object.keys(ranges).forEach(key => {
        const val = latest[key];
        const el = document.getElementById('b-' + key);
        const statusEl = document.getElementById('bs-' + key);
        if (val != null && el) {
            el.textContent = val;
            const { min, max } = ranges[key];
            if (val >= min && val <= max) statusEl.className = 'b-status normal';
            else if (val < min * 0.8 || val > max * 1.3) statusEl.className = 'b-status danger';
            else statusEl.className = 'b-status warning';
        }
    });

    // Render trend arrows
    renderBloodTrends(latest, previous);

    // Blood chart
    renderBloodChart(tests);

    // Show cached AI analysis if available
    const cacheKey = 'blood_analysis_' + latest.date;
    const cachedAnalysis = getData(cacheKey, null);
    if (cachedAnalysis) {
        renderBloodAIInsight(cachedAnalysis);
    }
    renderBloodTestsHistory();
}

function renderBloodTrends(latest, previous) {
    if (!previous) return;

    const keys = ['glucose', 'cholesterol', 'triglycerides', 'iron', 'b12', 'vitd', 'tsh'];
    keys.forEach(key => {
        const el = document.getElementById('b-' + key);
        if (!el) return;
        // Remove any existing trend arrow
        const existingArrow = el.parentElement.querySelector('.blood-trend-arrow');
        if (existingArrow) existingArrow.remove();

        const curr = latest[key];
        const prev = previous[key];
        if (curr == null || prev == null) return;

        const diff = curr - prev;
        if (Math.abs(diff) < 0.01) return;

        const arrow = document.createElement('span');
        arrow.className = 'blood-trend-arrow';
        if (diff > 0) {
            arrow.textContent = '\u2191';
            arrow.classList.add('trend-up');
        } else {
            arrow.textContent = '\u2193';
            arrow.classList.add('trend-down');
        }
        el.parentElement.appendChild(arrow);
    });
}

function renderBloodAIInsight(analysis) {
    const container = document.getElementById('blood-ai-insight');
    if (!container || !analysis) return;

    let html = '<div class="blood-ai-header">';
    html += '<div class="blood-score-circle">';
    html += `<span class="blood-score-value">${analysis.score || '--'}</span>`;
    html += '<span class="blood-score-label">ציון</span>';
    html += '</div>';
    html += `<div class="blood-ai-summary">${analysis.summary || ''}</div>`;
    html += '</div>';

    // Abnormal values
    if (analysis.abnormal && analysis.abnormal.length > 0) {
        html += '<div class="blood-abnormal-section">';
        html += '<h4 class="blood-section-title">ערכים חריגים</h4>';
        analysis.abnormal.forEach(item => {
            const badgeClass = item.status === 'high' ? 'badge-high' : 'badge-low';
            const statusText = item.status === 'high' ? 'גבוה' : 'נמוך';
            html += `<div class="blood-abnormal-item">`;
            html += `<span class="blood-abnormal-badge ${badgeClass}">${item.name} - ${statusText}</span>`;
            html += `<div class="blood-recommendation">${item.recommendation || ''}</div>`;
            html += '</div>';
        });
        html += '</div>';
    }

    // Improvements
    if (analysis.improvements && analysis.improvements.length > 0) {
        html += '<div class="blood-improvements-section">';
        html += '<h4 class="blood-section-title">שינויים מבדיקה קודמת</h4>';
        analysis.improvements.forEach(item => {
            const arrow = item.direction === 'up' ? '\u2191' : '\u2193';
            html += `<div class="blood-improvement-item">${arrow} ${item.name}: ${item.note || ''}</div>`;
        });
        html += '</div>';
    }

    // Tips
    if (analysis.tips && analysis.tips.length > 0) {
        html += '<div class="blood-tips-section">';
        html += '<h4 class="blood-section-title">טיפים</h4>';
        analysis.tips.forEach(tip => {
            html += `<div class="blood-tip-item">${tip}</div>`;
        });
        html += '</div>';
    }

    container.innerHTML = html;
    container.style.display = 'block';
}

function renderBloodChart(tests) {
    const ctx = document.getElementById('blood-chart');
    if (!ctx || tests.length < 2) return;

    if (bloodChart) bloodChart.destroy();

    const labels = tests.map(t => formatDate(t.date));
    const datasets = [];
    const colors = { glucose: '#EF4444', cholesterol: '#3B82F6', b12: '#8B5CF6', vitd: '#F59E0B' };
    const normalRanges = {
        glucose: { min: 70, max: 100 },
        cholesterol: { min: 0, max: 200 },
        b12: { min: 200, max: 900 },
        vitd: { min: 30, max: 100 }
    };

    const chartKeys = ['glucose', 'cholesterol', 'b12', 'vitd'];
    chartKeys.forEach(key => {
        const data = tests.map(t => t[key] || null);
        if (data.some(d => d !== null)) {
            const names = { glucose: 'סוכר', cholesterol: 'כולסטרול', b12: 'B12', vitd: 'ויט D' };
            datasets.push({
                label: names[key],
                data,
                borderColor: colors[key],
                tension: 0.3,
                pointRadius: 3,
                fill: false
            });
        }
    });

    if (datasets.length === 0) return;

    // Normal range band plugin
    const normalRangeBandsPlugin = {
        id: 'normalRangeBands',
        beforeDraw(chart) {
            const { ctx: c, chartArea, scales } = chart;
            if (!chartArea) return;
            const yScale = scales.y;

            // Draw normal range bands for each visible dataset
            chart.data.datasets.forEach((ds, i) => {
                if (ds._normalRange && chart.isDatasetVisible(i)) {
                    const { min, max } = ds._normalRange;
                    const yTop = yScale.getPixelForValue(max);
                    const yBottom = yScale.getPixelForValue(min);
                    const color = ds.borderColor || '#000';

                    c.save();
                    c.fillStyle = color.replace(')', ', 0.06)').replace('rgb(', 'rgba(').replace('#', '');
                    // Convert hex to rgba
                    const hex = ds.borderColor;
                    const r = parseInt(hex.slice(1, 3), 16);
                    const g = parseInt(hex.slice(3, 5), 16);
                    const b = parseInt(hex.slice(5, 7), 16);
                    c.fillStyle = `rgba(${r}, ${g}, ${b}, 0.07)`;
                    c.fillRect(chartArea.left, yTop, chartArea.right - chartArea.left, yBottom - yTop);

                    // Draw dashed border lines for the range
                    c.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.25)`;
                    c.setLineDash([4, 4]);
                    c.lineWidth = 1;
                    c.beginPath();
                    c.moveTo(chartArea.left, yTop);
                    c.lineTo(chartArea.right, yTop);
                    c.moveTo(chartArea.left, yBottom);
                    c.lineTo(chartArea.right, yBottom);
                    c.stroke();
                    c.restore();
                }
            });
        }
    };

    // Attach normal range metadata to datasets
    datasets.forEach(ds => {
        const key = chartKeys.find(k => {
            const names = { glucose: 'סוכר', cholesterol: 'כולסטרול', b12: 'B12', vitd: 'ויט D' };
            return names[k] === ds.label;
        });
        if (key && normalRanges[key]) {
            ds._normalRange = normalRanges[key];
        }
    });

    bloodChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        plugins: [normalRangeBandsPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { family: 'Heebo', size: 11 }, usePointStyle: true } }
            },
            scales: {
                y: { ticks: { font: { family: 'Heebo', size: 11 } }, grid: { color: '#F3F4F6' } },
                x: { ticks: { font: { family: 'Heebo', size: 10 } }, grid: { display: false } }
            }
        }
    });
}

// ============ Save Data Functions ============
function saveWeight() {
    const val = parseFloat(document.getElementById('input-weight').value);
    if (!val) { showToast('הכניסי משקל'); return; }
    const date = document.getElementById('input-weight-date').value || getTodayKey();
    const weights = getData('weights', []);
    weights.push({ value: val, date });
    weights.sort((a, b) => a.date.localeCompare(b.date));
    setData('weights', weights);
    closeModal('weight-modal');
    showToast('המשקל נשמר');

    // Gamification
    addXP(XP_REWARDS.weigh_in, 'weigh_in');
    markTodayActive();
    checkAchievements();

    // Share to groups feed
    postGroupActivity('weight', { weight: val });

    refreshMetrics();
    refreshDashboard();
}

function saveMeasurements() {
    const waist = parseFloat(document.getElementById('input-waist').value) || null;
    const hips = parseFloat(document.getElementById('input-hips').value) || null;
    const arm = parseFloat(document.getElementById('input-arm').value) || null;
    const date = document.getElementById('input-measurements-date').value || getTodayKey();
    if (!waist && !hips && !arm) { showToast('הכניסי לפחות מדד אחד'); return; }
    const measurements = getData('measurements', []);
    measurements.push({ waist, hips, arm, date });
    measurements.sort((a, b) => a.date.localeCompare(b.date));
    setData('measurements', measurements);
    closeModal('measurements-modal');
    showToast('המידות נשמרו');
    addXP(XP_REWARDS.add_measurements, 'add_measurements');
    markTodayActive();
    checkAchievements();
    refreshMetrics();
}

async function handleBloodFileUpload(input) {
    const file = input.files[0];
    if (!file) return;

    const statusEl = document.getElementById('blood-upload-status');
    statusEl.classList.remove('hidden');
    statusEl.textContent = 'מנתחת את הבדיקה...';
    statusEl.className = 'blood-upload-status loading';

    try {
        // Convert to base64
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const maxSize = 1200;
                    let w = img.width, h = img.height;
                    if (w > maxSize || h > maxSize) {
                        if (w > h) { h = (h / w) * maxSize; w = maxSize; }
                        else { w = (w / h) * maxSize; h = maxSize; }
                    }
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
                };
                img.onerror = reject;
                img.src = reader.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

        const values = await extractBloodTestFromImage(base64);

        // Fill form fields with extracted values
        const fieldMap = {
            glucose: 'input-glucose',
            cholesterol: 'input-cholesterol',
            triglycerides: 'input-triglycerides',
            iron: 'input-iron',
            b12: 'input-b12',
            vitd: 'input-vitd',
            tsh: 'input-tsh'
        };

        let filled = 0;
        Object.entries(fieldMap).forEach(([key, inputId]) => {
            if (values[key] != null) {
                document.getElementById(inputId).value = values[key];
                filled++;
            }
        });

        statusEl.textContent = `נמצאו ${filled} ערכים - בדקי ושמרי`;
        statusEl.className = 'blood-upload-status success';
    } catch (err) {
        statusEl.textContent = 'לא הצלחתי לקרוא את הבדיקה. נסי תמונה ברורה יותר';
        statusEl.className = 'blood-upload-status error';
    }

    input.value = '';
}

async function saveBloodTests() {
    const data = {
        glucose: parseFloat(document.getElementById('input-glucose').value) || null,
        cholesterol: parseFloat(document.getElementById('input-cholesterol').value) || null,
        triglycerides: parseFloat(document.getElementById('input-triglycerides').value) || null,
        iron: parseFloat(document.getElementById('input-iron').value) || null,
        b12: parseFloat(document.getElementById('input-b12').value) || null,
        vitd: parseFloat(document.getElementById('input-vitd').value) || null,
        tsh: parseFloat(document.getElementById('input-tsh').value) || null,
        date: document.getElementById('input-blood-date').value || getTodayKey()
    };
    const hasValue = Object.values(data).some((v, i) => i < 7 && v !== null);
    if (!hasValue) { showToast('הכניסי לפחות ערך אחד'); return; }
    const tests = getData('bloodTests', []);
    tests.push(data);
    tests.sort((a, b) => a.date.localeCompare(b.date));
    setData('bloodTests', tests);
    closeModal('blood-modal');
    showToast('בדיקות הדם נשמרו');
    addXP(XP_REWARDS.add_blood_test, 'add_blood_test');
    markTodayActive();
    checkAchievements();
    refreshMetrics();

    // Trigger AI analysis
    const sortedTests = [...tests].sort((a, b) => a.date.localeCompare(b.date));
    const currentTest = sortedTests[sortedTests.length - 1];
    const previousTest = sortedTests.length > 1 ? sortedTests[sortedTests.length - 2] : null;
    try {
        showLoading('מנתחת בדיקות דם...');
        const analysis = await analyzeBloodTests(currentTest, previousTest);
        hideLoading();
        renderBloodAIInsight(analysis);
    } catch (err) {
        hideLoading();
        console.error('Blood AI analysis error:', err);
    }
}

// ============ Smart Goals Calculator ============
function getCurrentWeight() {
    const weights = getData('weights', []);
    if (weights.length === 0) return 0;
    const sorted = [...weights].sort((a, b) => b.date.localeCompare(a.date));
    return sorted[0].value;
}

function saveCurrentWeight() {
    const val = parseFloat(document.getElementById('profile-current-weight').value);
    if (!val) return;

    const weights = getData('weights', []);
    const today = getTodayKey();
    // Update today's entry or add new
    const idx = weights.findIndex(w => w.date === today);
    if (idx >= 0) {
        weights[idx].value = val;
    } else {
        weights.push({ value: val, date: today });
    }
    weights.sort((a, b) => a.date.localeCompare(b.date));
    setData('weights', weights);
    updateProfileHeader();
    showToast('המשקל עודכן');
}

function calculateSmartGoals() {
    const profile = getProfile();
    const age = parseInt(profile.age);
    const height = parseInt(profile.height);
    const gender = profile.gender;

    if (!age || !height) {
        showToast('מלאי קודם גיל וגובה');
        return;
    }

    // Get current weight from field or from weights history
    let currentWeight = parseFloat(document.getElementById('profile-current-weight').value) || getCurrentWeight();

    if (!currentWeight) {
        showToast('מלאי את המשקל הנוכחי שלך');
        return;
    }

    if (!gender) {
        showToast('בחרי מין בפרטים אישיים');
        return;
    }

    // Mifflin-St Jeor equation for BMR
    let bmr;
    if (gender === 'male') {
        bmr = 10 * currentWeight + 6.25 * height - 5 * age + 5;
    } else {
        bmr = 10 * currentWeight + 6.25 * height - 5 * age - 161;
    }

    // TDEE based on activity level
    const activityLevel = document.getElementById('profile-activity-level').value || 'light';
    const activityMultipliers = {
        sedentary: 1.2,
        light: 1.375,
        moderate: 1.55,
        active: 1.725
    };
    const activityLabels = {
        sedentary: 'יושבנית',
        light: 'קלה',
        moderate: 'בינונית',
        active: 'גבוהה'
    };
    const multiplier = activityMultipliers[activityLevel] || 1.375;
    const tdee = Math.round(bmr * multiplier);

    // Calorie deficit for weight loss (500 cal deficit, min 1200)
    const targetCalories = Math.round(Math.max(1200, tdee - 500));

    // Target weight: use existing or suggest BMI-based
    const existingTargetWeight = parseFloat(document.getElementById('profile-target-weight').value);
    const bmiHealthyWeight = Math.round(22 * (height / 100) * (height / 100));
    const useTargetWeight = existingTargetWeight || bmiHealthyWeight;
    if (!existingTargetWeight) {
        document.getElementById('profile-target-weight').value = useTargetWeight;
    }

    // Protein: 1.6g per kg (recommended for fat loss + muscle preservation)
    const targetProtein = Math.round(currentWeight * 1.6);

    // Remaining calories split: ~55% carbs, ~45% fat
    const proteinCalories = targetProtein * 4;
    const remainingCalories = Math.max(400, targetCalories - proteinCalories);
    const targetCarbs = Math.round((remainingCalories * 0.55) / 4);
    const targetFat = Math.round((remainingCalories * 0.45) / 9);

    // Fiber: 14g per 1000 cal (standard recommendation)
    const targetFiber = Math.round(targetCalories / 1000 * 14);

    // Fill in values
    document.getElementById('profile-target-calories').value = targetCalories;
    document.getElementById('profile-target-protein').value = targetProtein;
    document.getElementById('profile-target-carbs').value = targetCarbs;
    document.getElementById('profile-target-fat').value = targetFat;
    document.getElementById('profile-target-fiber').value = targetFiber;

    saveProfile();

    // Show explanation
    const hint = document.getElementById('smart-calc-hint');
    hint.style.display = 'block';
    hint.innerHTML = `
        <div class="smart-calc-result">
            <div class="smart-calc-title">המלצה מותאמת אישית</div>
            <div class="smart-calc-details">
                <strong>${currentWeight}</strong> ק"ג · ${height} ס"מ · גיל ${age} · פעילות ${activityLabels[activityLevel]}
                <br>קצב מטבוליזם בסיסי (BMR): <strong>${Math.round(bmr)}</strong> קל׳
                <br>צריכה יומית (TDEE): <strong>${tdee}</strong> קל׳
                <br>לירידה בריאה (גרעון 500): <strong>${targetCalories}</strong> קל׳
                ${!existingTargetWeight ? `<br>משקל יעד מומלץ (BMI 22): <strong>${bmiHealthyWeight}</strong> ק"ג` : ''}
            </div>
        </div>
    `;

    showToast('היעדים עודכנו');
}

function updateProfileHeader() {
    const profile = getProfile();
    const nameEl = document.getElementById('profile-display-name');
    const metaEl = document.getElementById('profile-display-meta');

    if (nameEl && profile.name) {
        nameEl.textContent = profile.name;
    }

    if (metaEl) {
        const parts = [];
        if (profile.age) parts.push(`גיל ${profile.age}`);
        if (profile.height) parts.push(`${profile.height} ס״מ`);
        const cw = getCurrentWeight();
        if (cw) parts.push(`${cw} ק״ג`);
        if (profile.gender === 'female') parts.push('נקבה');
        else if (profile.gender === 'male') parts.push('זכר');
        metaEl.textContent = parts.join(' · ');
    }

    // Show friend code in profile
    const fcEl = document.getElementById('profile-friend-code');
    if (fcEl) {
        const fc = typeof getFriendCode === 'function' ? getFriendCode() : getData('friendCode', null);
        fcEl.textContent = fc || 'ממתין לרישום...';
    }

    // Show sync status
    updateSyncStatus();
}

function updateSyncStatus() {
    const statusEl = document.getElementById('profile-sync-status');
    if (!statusEl) return;
    const userId = typeof getUserId === 'function' ? getUserId() : getData('userId', null);
    if (userId) {
        const lastSync = getData('_lastSyncTime', null);
        const timeStr = lastSync ? new Date(lastSync).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';
        statusEl.innerHTML = `<span class="sync-ok">מסונכרן לענן</span>${timeStr ? ` · ${timeStr}` : ''}`;
    } else {
        statusEl.innerHTML = '<span class="sync-warn">לא מסונכרן - ממתין לחיבור</span>';
    }
}

function copyFriendCode() {
    const fc = typeof getFriendCode === 'function' ? getFriendCode() : getData('friendCode', null);
    if (!fc) { showToast('אין קוד עדיין'); return; }
    navigator.clipboard.writeText(fc).then(() => showToast('הקוד הועתק')).catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = fc; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        showToast('הקוד הועתק');
    });
}

// ============ Profile ============
function saveProfile() {
    const profile = {
        name: document.getElementById('profile-name').value,
        age: document.getElementById('profile-age').value,
        height: document.getElementById('profile-height').value,
        gender: document.getElementById('profile-gender').value,
        activityLevel: document.getElementById('profile-activity-level').value,
        targetWeight: document.getElementById('profile-target-weight').value,
        targetCalories: parseInt(document.getElementById('profile-target-calories').value) || '',
        targetProtein: parseInt(document.getElementById('profile-target-protein').value) || '',
        targetCarbs: parseInt(document.getElementById('profile-target-carbs').value) || '',
        targetFat: parseInt(document.getElementById('profile-target-fat').value) || '',
        targetFiber: parseInt(document.getElementById('profile-target-fiber').value) || '',
        apiKey: document.getElementById('profile-api-key').value
    };
    setData('profile', profile);
}

function loadProfile() {
    const p = getProfile();
    document.getElementById('profile-name').value = p.name || '';
    document.getElementById('profile-age').value = p.age || '';
    document.getElementById('profile-height').value = p.height || '';
    document.getElementById('profile-gender').value = p.gender || '';
    document.getElementById('profile-activity-level').value = p.activityLevel || 'light';
    document.getElementById('profile-target-weight').value = p.targetWeight || '';
    document.getElementById('profile-target-calories').value = p.targetCalories || '';
    document.getElementById('profile-target-protein').value = p.targetProtein || '';
    document.getElementById('profile-target-carbs').value = p.targetCarbs || '';
    document.getElementById('profile-target-fat').value = p.targetFat || '';
    document.getElementById('profile-target-fiber').value = p.targetFiber || '';
    document.getElementById('profile-api-key').value = p.apiKey || '';
    // Load current weight from weights history
    const cw = getCurrentWeight();
    if (cw) document.getElementById('profile-current-weight').value = cw;
    updateProfileHeader();
}

// ============ Chat ============
function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
    }
}

function sendSuggestion(text) {
    document.getElementById('chat-input').value = text;
    sendChat();
}

async function sendChat() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    const profile = getProfile();

    // Remove welcome if present
    const welcome = document.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    // Add user message
    addChatMessage(text, 'user');
    input.value = '';
    input.style.height = 'auto';

    // Show typing
    const typingId = addTypingIndicator();

    try {
        const context = buildChatContext();
        const response = await chatWithAI(text, context, profile);
        removeTypingIndicator(typingId);
        addChatMessage(response, 'assistant');

        // Track chat count for gamification
        const chatCount = getData('game_chat_count', 0);
        setData('game_chat_count', chatCount + 1);
        const todayChatKey = 'game_today_chat_' + getTodayKey();
        setData(todayChatKey, (getData(todayChatKey, 0)) + 1);
        markTodayActive();
        checkAchievements();
    } catch (err) {
        removeTypingIndicator(typingId);
        addChatMessage('מצטערת, משהו השתבש: ' + err.message, 'assistant');
    }
}

function addChatMessage(text, role) {
    const container = document.getElementById('chat-container');
    const div = document.createElement('div');
    div.className = 'chat-message ' + role;
    div.innerHTML = `<div class="chat-bubble">${formatMessageText(text)}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function formatMessageText(text) {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
}

function addTypingIndicator() {
    const container = document.getElementById('chat-container');
    const div = document.createElement('div');
    const id = 'typing-' + Date.now();
    div.id = id;
    div.className = 'chat-message assistant';
    div.innerHTML = `<div class="chat-bubble"><div class="chat-typing"><span></span><span></span><span></span></div></div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return id;
}

function removeTypingIndicator(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function buildChatContext() {
    const profile = getProfile();
    const weights = getData('weights', []);
    const todayMeals = getData('meals_' + getTodayKey(), []);
    const bloodTests = getData('bloodTests', []);
    const measurements = getData('measurements', []);

    let ctx = '';
    if (profile.name) ctx += `שם: ${profile.name}\n`;
    if (profile.age) ctx += `גיל: ${profile.age}\n`;
    if (profile.height) ctx += `גובה: ${profile.height} ס"מ\n`;
    if (profile.gender) ctx += `מין: ${profile.gender === 'female' ? 'נקבה' : 'זכר'}\n`;
    if (profile.targetWeight) ctx += `משקל יעד: ${profile.targetWeight} ק"ג\n`;
    ctx += `יעד קלוריות: ${profile.targetCalories}\n`;

    if (weights.length > 0) {
        ctx += `\nמשקל אחרון: ${weights[weights.length - 1].value} ק"ג (${weights[weights.length - 1].date})`;
        if (weights.length >= 2) {
            const first = weights[0];
            ctx += `\nמשקל ראשון: ${first.value} ק"ג (${first.date})`;
            ctx += `\nשינוי כולל: ${(weights[weights.length - 1].value - first.value).toFixed(1)} ק"ג`;
        }
        ctx += '\n';
    }

    if (todayMeals.length > 0) {
        ctx += '\nארוחות היום:\n';
        todayMeals.forEach(m => {
            ctx += `- ${m.description} (${m.calories} קק"ל, ח:${m.protein}g פ:${m.carbs}g ש:${m.fat}g)\n`;
        });
    }

    if (bloodTests.length > 0) {
        const latest = bloodTests[bloodTests.length - 1];
        ctx += `\nבדיקות דם אחרונות (${latest.date}):\n`;
        if (latest.glucose) ctx += `סוכר: ${latest.glucose}\n`;
        if (latest.cholesterol) ctx += `כולסטרול: ${latest.cholesterol}\n`;
        if (latest.triglycerides) ctx += `טריגליצרידים: ${latest.triglycerides}\n`;
        if (latest.iron) ctx += `ברזל: ${latest.iron}\n`;
        if (latest.b12) ctx += `B12: ${latest.b12}\n`;
        if (latest.vitd) ctx += `ויטמין D: ${latest.vitd}\n`;
        if (latest.tsh) ctx += `TSH: ${latest.tsh}\n`;
    }

    if (measurements.length > 0) {
        const latest = measurements[measurements.length - 1];
        ctx += `\nמידות אחרונות (${latest.date}):\n`;
        if (latest.waist) ctx += `מותניים: ${latest.waist} ס"מ\n`;
        if (latest.hips) ctx += `ירכיים: ${latest.hips} ס"מ\n`;
        if (latest.arm) ctx += `זרוע: ${latest.arm} ס"מ\n`;
    }

    return ctx;
}

// ============ Exercise Tracking ============
const EXERCISE_TYPES = [
    { id: 'walking',  name: 'הליכה',      icon: 'walking',  met: 3.5 },
    { id: 'running',  name: 'ריצה',       icon: 'running',  met: 8.0 },
    { id: 'cycling',  name: 'אופניים',    icon: 'bike',     met: 7.5 },
    { id: 'swimming', name: 'שחייה',      icon: 'swim',     met: 6.0 },
    { id: 'yoga',     name: 'יוגה',       icon: 'yoga',     met: 2.5 },
    { id: 'gym',      name: 'חדר כושר',   icon: 'dumbbell', met: 5.0 },
    { id: 'dancing',  name: 'ריקוד',      icon: 'dance',    met: 4.5 },
    { id: 'hiit',     name: 'HIIT',       icon: 'flame',    met: 9.0 },
    { id: 'pilates',  name: 'פילאטיס',    icon: 'pilates',  met: 3.0 },
    { id: 'boxing',   name: 'איגרוף',     icon: 'boxing',   met: 7.0 },
    { id: 'stretch',  name: 'מתיחות',     icon: 'stretch',  met: 2.0 },
    { id: 'tennis',   name: 'טניס',       icon: 'tennis',   met: 7.0 },
    { id: 'stairs',   name: 'מדרגות',     icon: 'stairs',   met: 6.0 },
    { id: 'other',    name: 'אחר',        icon: 'heart',    met: 4.0 }
];

function renderExerciseTypeGrid() {
    const grid = document.getElementById('exercise-type-grid');
    if (!grid) return;
    grid.innerHTML = EXERCISE_TYPES.map(t => {
        const selected = selectedExerciseType === t.id ? ' selected' : '';
        return `<button class="exercise-type-btn${selected}" onclick="selectExerciseType('${t.id}')">
            <span class="exercise-type-icon">${icon(t.icon, 22)}</span>
            <span class="exercise-type-name">${t.name}</span>
        </button>`;
    }).join('');
}

function selectExerciseType(typeId) {
    selectedExerciseType = typeId;
    renderExerciseTypeGrid();
    updateBurnPreview();
}

function calculateCalorieBurn(met, durationMinutes) {
    const weight = getCurrentWeight() || 70;
    return Math.round(met * weight * (durationMinutes / 60));
}

function updateBurnPreview() {
    const preview = document.getElementById('exercise-burn-preview');
    const valueEl = document.getElementById('exercise-burn-value');
    if (!preview || !valueEl) return;

    const duration = parseInt(document.getElementById('input-exercise-duration').value) || 0;
    const type = EXERCISE_TYPES.find(t => t.id === selectedExerciseType);

    if (type && duration > 0) {
        const burn = calculateCalorieBurn(type.met, duration);
        valueEl.textContent = burn;
        preview.style.display = 'flex';
    } else {
        preview.style.display = 'none';
    }
}

function saveExercise() {
    if (!selectedExerciseType) {
        showToast('בחרי סוג פעילות');
        return;
    }
    const duration = parseInt(document.getElementById('input-exercise-duration').value);
    if (!duration || duration < 1) {
        showToast('הכניסי משך פעילות');
        return;
    }

    const type = EXERCISE_TYPES.find(t => t.id === selectedExerciseType);
    const caloriesBurned = calculateCalorieBurn(type.met, duration);
    const dayKey = getTodayKey();
    const exercises = getData('exercises_' + dayKey, []);

    exercises.push({
        typeId: type.id,
        name: type.name,
        icon: type.icon,
        met: type.met,
        duration: duration,
        caloriesBurned: caloriesBurned,
        time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
        id: Date.now()
    });

    setData('exercises_' + dayKey, exercises);
    closeModal('exercise-modal');

    // Reset modal state
    selectedExerciseType = null;
    document.getElementById('input-exercise-duration').value = '';
    document.getElementById('exercise-burn-preview').style.display = 'none';

    showToast(`${type.name} - ${caloriesBurned} קק״ל נשרפו`);

    // Gamification
    addXP(XP_REWARDS.log_exercise, 'log_exercise');
    markTodayActive();
    checkAchievements();

    // Share to groups
    postGroupActivity('exercise', {
        name: type.name,
        duration: duration,
        caloriesBurned: caloriesBurned
    });

    refreshExerciseLog();
    refreshDashboard();
}

function refreshExerciseLog() {
    const dayKey = getTodayKey(foodDayOffset);
    const exercises = getData('exercises_' + dayKey, []);
    const list = document.getElementById('exercise-log-list');
    const summary = document.getElementById('exercise-summary');
    if (!list) return;

    if (exercises.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>עדיין לא הוספת פעילות היום</p></div>';
        if (summary) summary.style.display = 'none';
        return;
    }

    list.innerHTML = exercises.map((ex, i) => `
        <div class="exercise-log-item">
            <span class="exercise-log-icon">${icon(ex.icon || 'heart', 18)}</span>
            <div class="exercise-log-details">
                <div class="exercise-log-name">${ex.name}</div>
                <div class="exercise-log-meta">${ex.duration} דקות · ${ex.time || ''}</div>
            </div>
            <span class="exercise-log-burn">-${ex.caloriesBurned} קק״ל</span>
            <button class="food-edit" onclick="editExercise('${dayKey}', ${i})" title="עריכה">${icon('edit', 14)}</button>
            <button class="food-delete" onclick="deleteExercise('${dayKey}', ${i})" title="מחיקה">${icon('x', 14)}</button>
        </div>
    `).join('');

    // Summary
    const totalBurn = exercises.reduce((sum, ex) => sum + ex.caloriesBurned, 0);
    if (summary) {
        summary.innerHTML = `<span>סה״כ שריפה:</span> <strong>${totalBurn} קק״ל</strong>`;
        summary.style.display = 'flex';
    }
}

function deleteExercise(dayKey, index) {
    const exercises = getData('exercises_' + dayKey, []);
    exercises.splice(index, 1);
    setData('exercises_' + dayKey, exercises);
    refreshExerciseLog();
    refreshDashboard();
    showToast('הפעילות נמחקה');
}

function editExercise(dayKey, index) {
    const exercises = getData('exercises_' + dayKey, []);
    const ex = exercises[index];
    if (!ex) return;

    const items = document.querySelectorAll('.exercise-log-item');
    const item = items[index];
    if (!item) return;

    item.innerHTML = `
        <div style="width:100%;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:4px 0">
            <input type="text" id="edit-ex-name-${index}" value="${ex.name}" style="flex:1;min-width:100px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);font-family:Heebo;font-size:0.82rem" placeholder="שם">
            <label style="font-size:0.75rem;color:var(--text-muted)">דקות:</label>
            <input type="number" id="edit-ex-dur-${index}" value="${ex.duration}" style="width:60px;padding:6px;border:1px solid var(--border);border-radius:var(--radius);font-family:Heebo;font-size:0.82rem">
            <button class="history-save-btn" onclick="saveExerciseEdit('${dayKey}', ${index})">שמור</button>
            <button class="history-cancel-btn" onclick="refreshExerciseLog()">ביטול</button>
        </div>`;
}

function saveExerciseEdit(dayKey, index) {
    const exercises = getData('exercises_' + dayKey, []);
    const ex = exercises[index];
    if (!ex) return;

    ex.name = document.getElementById('edit-ex-name-' + index)?.value || ex.name;
    const newDuration = parseInt(document.getElementById('edit-ex-dur-' + index)?.value) || ex.duration;

    // Recalculate calories if duration changed
    if (newDuration !== ex.duration) {
        const profile = getProfile();
        const weight = parseFloat(profile.weight) || getData('weights', []).slice(-1)[0]?.value || 70;
        const exerciseTypes = {
            walking: 3.5, running: 8.0, cycling: 7.5, swimming: 6.0, yoga: 2.5, gym: 5.0,
            dancing: 4.5, hiit: 9.0, pilates: 3.0, boxing: 7.0, stretching: 2.0, tennis: 7.0,
            stairs: 6.0, other: 4.0
        };
        const met = exerciseTypes[ex.type] || 4.0;
        ex.caloriesBurned = Math.round(met * weight * (newDuration / 60));
        ex.duration = newDuration;
    }

    setData('exercises_' + dayKey, exercises);
    refreshExerciseLog();
    refreshDashboard();
    showToast('הפעילות עודכנה');
}

function getNetCalories() {
    const dayKey = getTodayKey();
    const meals = getData('meals_' + dayKey, []);
    const exercises = getData('exercises_' + dayKey, []);

    const eaten = meals.reduce((sum, m) => sum + (m.calories || 0), 0);
    const burned = exercises.reduce((sum, ex) => sum + (ex.caloriesBurned || 0), 0);

    return { eaten: Math.round(eaten), burned: Math.round(burned), net: Math.round(eaten - burned) };
}

function renderNetCaloriesDisplay() {
    const container = document.getElementById('net-calories-container');
    if (!container) return;

    const { eaten, burned, net } = getNetCalories();
    if (burned === 0) {
        container.innerHTML = '';
        return;
    }

    const profile = getProfile();
    const target = profile.targetCalories || 1500;
    const pct = Math.round((net / target) * 100);

    container.innerHTML = `
        <div class="net-calories-display">
            <div class="net-calories-header">
                <span class="net-calories-title">קלוריות נטו</span>
            </div>
            <div class="net-calories-row">
                <div class="net-cal-item">
                    <span class="net-cal-label">אכילה</span>
                    <span class="net-cal-value eaten">${eaten}</span>
                </div>
                <span class="net-cal-minus">−</span>
                <div class="net-cal-item">
                    <span class="net-cal-label">שריפה</span>
                    <span class="net-cal-value burned">${burned}</span>
                </div>
                <span class="net-cal-equals">=</span>
                <div class="net-cal-item">
                    <span class="net-cal-label">נטו</span>
                    <span class="net-cal-value net">${net}</span>
                </div>
            </div>
            <div class="net-calories-bar-track">
                <div class="net-calories-bar-fill" style="width: ${Math.min(100, Math.max(0, pct))}%"></div>
            </div>
            <div class="net-calories-target">${pct}% מהיעד (${target} קק״ל)</div>
        </div>
    `;
}

// ============ Modals ============
function openModal(id) {
    document.getElementById(id).classList.add('active');
    // Set default date to today
    const dateInputs = document.querySelectorAll(`#${id} input[type="date"]`);
    dateInputs.forEach(d => { if (!d.value) d.value = getTodayKey(); });
    // Render exercise type grid when opening exercise modal
    if (id === 'exercise-modal') renderExerciseTypeGrid();
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function closeModalOverlay(e) {
    if (e.target === e.currentTarget) {
        e.target.classList.remove('active');
    }
}

// ============ Data Export/Import ============
function exportData() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('da_')) {
            data[key] = localStorage.getItem(key);
        }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shifty-backup-${getTodayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('הנתונים יוצאו בהצלחה');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            Object.entries(data).forEach(([key, val]) => {
                localStorage.setItem(key, val);
            });
            showToast('הנתונים יובאו בהצלחה!');
            refreshDashboard();
        } catch {
            showToast('שגיאה בייבוא הקובץ');
        }
    };
    reader.readAsText(file);
}

function clearAllData() {
    showConfirmModal('מחיקת נתונים', 'למחוק את כל הנתונים? פעולה זו לא ניתנת לביטול!', function() {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('da_')) keys.push(key);
        }
        keys.forEach(k => localStorage.removeItem(k));
        showToast('כל הנתונים נמחקו');
        location.reload();
    });
}

// ============ UI Helpers ============
function showLoading(text) {
    document.querySelector('.loading-text').textContent = text || 'מנתחת...';
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.classList.add('hidden'), 300);
    }, 2500);
}

// ============ Init ============
// ============ Welcome / Login / Init ============
function showWelcomeScreen() {
    document.getElementById('welcome-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    // Reset to initial state
    document.getElementById('welcome-main').style.display = '';
    document.getElementById('login-form').style.display = 'none';
}

function hideWelcomeScreen() {
    document.getElementById('welcome-screen').style.display = 'none';
    document.getElementById('app').style.display = '';
}

function showLoginForm() {
    document.getElementById('welcome-main').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
    document.querySelector('.welcome-options').style.display = 'none';
    document.getElementById('login-code-input').focus();
}

function hideLoginForm() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('welcome-main').style.display = '';
}

async function startNewAccount() {
    const nameInput = document.getElementById('register-name');
    const name = nameInput ? nameInput.value.trim() : '';

    if (!name) {
        showToast('נא להכניס שם');
        if (nameInput) nameInput.focus();
        return;
    }

    showLoading('יוצרת חשבון...');
    try {
        const resp = await fetch('/api/user?action=register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName: name })
        });
        const data = await resp.json();
        if (data.userId) {
            setData('userId', data.userId);
            setData('friendCode', data.friendCode);

            const profile = getProfile();
            profile.name = name;
            setData('profile', profile);

            hideLoading();
            hideWelcomeScreen();
            showSaveCodeModal(data.friendCode);
            await initApp();
            return;
        }
    } catch (e) {
        console.log('Register API failed, using local fallback:', e.message);
    }

    // Fallback: create local account if API fails
    const localId = 'u_local_' + Date.now().toString(36);
    setData('userId', localId);
    setData('friendCode', '');

    const profile = getProfile();
    profile.name = name;
    setData('profile', profile);

    hideLoading();
    hideWelcomeScreen();
    await initApp();
}

async function loginWithCode() {
    const input = document.getElementById('login-code-input');
    let code = input.value.trim().toUpperCase();
    if (!code) {
        showToast('הכניסי את הקוד שלך');
        return;
    }
    // Auto-add SHFT- prefix if missing
    if (!code.startsWith('SHFT-')) code = 'SHFT-' + code;

    showLoading('מתחברת...');
    try {
        const resp = await fetch('/api/user?action=login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ friendCode: code })
        });
        const data = await resp.json();
        if (data.error) {
            hideLoading();
            showToast(data.error);
            return;
        }

        // Save identity
        setData('userId', data.userId);
        setData('friendCode', data.friendCode);

        // Restore user data from cloud
        if (data.data && Object.keys(data.data).length > 0) {
            Object.keys(data.data).forEach(key => localStorage.setItem(key, data.data[key]));
        }

        // Restore groups - rebuild myGroups from server group IDs if not in cloud data
        if (data.groups && data.groups.length > 0) {
            const existingGroups = getData('myGroups', []);
            if (existingGroups.length === 0) {
                // Fetch group details to rebuild myGroups
                const groupDetails = await Promise.all(
                    data.groups.map(async (gid) => {
                        try {
                            const resp = await fetch(`/api/group?action=leaderboard&groupId=${gid}`);
                            if (!resp.ok) return null;
                            const gData = await resp.json();
                            return { groupId: gid, name: gData.groupName || 'קבוצה', inviteCode: gData.inviteCode || '' };
                        } catch { return null; }
                    })
                );
                const rebuilt = groupDetails.filter(Boolean);
                if (rebuilt.length > 0) setData('myGroups', rebuilt);
            }
        }

        hideLoading();
        hideWelcomeScreen();
        showToast(`ברוכה השבה, ${data.displayName || 'חברה'}!`);
        await initApp();
    } catch (e) {
        hideLoading();
        showToast('שגיאה בהתחברות: ' + e.message);
    }
}

function showSaveCodeModal(code) {
    document.getElementById('save-code-value').textContent = code;
    document.getElementById('save-code-modal').style.display = 'flex';
}

function closeSaveCodeModal() {
    document.getElementById('save-code-modal').style.display = 'none';
}

function copyMyCode() {
    const code = document.getElementById('save-code-value').textContent;
    navigator.clipboard.writeText(code).then(() => showToast('הקוד הועתק!'));
}

async function initApp() {
    // Auto-register user identity if not exists
    if (typeof ensureUserIdentity === 'function' && !getUserId()) {
        try {
            await ensureUserIdentity();
        } catch (e) {
            console.log('Auto-register skipped:', e.message);
        }
    }

    // Try loading from cloud
    let loadedFromCloud = false;
    if (typeof loadFromCloudWithUser === 'function' && getUserId()) {
        loadedFromCloud = await loadFromCloudWithUser();
    } else if (typeof loadFromCloud === 'function') {
        loadedFromCloud = await loadFromCloud();
    }
    if (loadedFromCloud) {
        showToast('הנתונים נטענו מהענן');
    }

    // Check streak
    checkAndUpdateStreak();

    // Render meal type selector with icons
    renderMealTypeSelector();

    // Render blood upload icon
    const bloodUploadIcon = document.getElementById('blood-upload-icon');
    if (bloodUploadIcon) bloodUploadIcon.innerHTML = icon('camera', 28);

    // Refresh UI
    refreshDashboard();

    // Auto-resize chat input
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        });
    }

    // Sticky shadow for food input
    const stickyTop = document.querySelector('.food-sticky-top');
    if (stickyTop && 'IntersectionObserver' in window) {
        const observer = new IntersectionObserver(
            ([e]) => stickyTop.classList.toggle('stuck', e.intersectionRatio < 1),
            { threshold: [1], rootMargin: '-1px 0px 0px 0px' }
        );
        observer.observe(stickyTop);
    }
}

// ============ Progress Photos ============
const MAX_PROGRESS_PHOTOS = 24;
let compareSelected = [];

function addProgressPhoto() {
    document.getElementById('progress-photo-input').click();
}

function handleProgressPhoto(input) {
    const file = input.files[0];
    if (!file) return;

    const photos = getData('progress_photos', []);
    if (photos.length >= MAX_PROGRESS_PHOTOS) {
        showToast('ניתן לשמור עד ' + MAX_PROGRESS_PHOTOS + ' תמונות. מחקי ישנות כדי להוסיף חדשות');
        input.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const maxSize = 800;
            let w = img.width, h = img.height;
            if (w > maxSize || h > maxSize) {
                if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                else { w = Math.round(w * maxSize / h); h = maxSize; }
            }
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const base64 = canvas.toDataURL('image/jpeg', 0.8);

            const photo = {
                id: Date.now(),
                date: getTodayKey(),
                base64: base64,
                note: ''
            };
            photos.push(photo);
            setData('progress_photos', photos);
            showToast('תמונת התקדמות נשמרה');
            renderProgressGallery();
            checkMonthlyPhotoPrompt();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
}

function renderProgressGallery() {
    const gallery = document.getElementById('progress-gallery');
    if (!gallery) return;
    const photos = getData('progress_photos', []);

    if (photos.length === 0) {
        gallery.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px 0;">עדיין אין תמונות התקדמות</p>';
        document.getElementById('progress-compare-section').style.display = 'none';
        return;
    }

    // Sort newest first
    const sorted = [...photos].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

    gallery.innerHTML = sorted.map(p => `
        <div class="progress-photo-item" onclick="showProgressPhotoMenu(${p.id})">
            <img src="${p.base64}" alt="תמונת התקדמות" loading="lazy">
            <div class="progress-photo-date">${formatProgressDate(p.date)}</div>
        </div>
    `).join('');

    // Show compare button if 2+ photos
    document.getElementById('progress-compare-section').style.display = photos.length >= 2 ? 'block' : 'none';
}

function formatProgressDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

function showProgressPhotoMenu(id) {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-modal-title').textContent = 'מחיקת תמונה';
    document.getElementById('confirm-modal-text').textContent = 'למחוק את תמונת ההתקדמות?';
    document.getElementById('confirm-modal-btn').setAttribute('onclick', `deleteProgressPhoto(${id})`);
    openModal('confirm-modal');
}

function deleteProgressPhoto(id) {
    let photos = getData('progress_photos', []);
    photos = photos.filter(p => p.id !== id);
    setData('progress_photos', photos);
    closeModal('confirm-modal');
    showToast('התמונה נמחקה');
    renderProgressGallery();
    checkMonthlyPhotoPrompt();
}

function checkMonthlyPhotoPrompt() {
    const prompt = document.getElementById('progress-monthly-prompt');
    if (!prompt) return;
    const photos = getData('progress_photos', []);
    const now = new Date();
    const currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const hasThisMonth = photos.some(p => p.date.startsWith(currentMonth));
    prompt.style.display = hasThisMonth ? 'none' : 'block';
}

function startBeforeAfterCompare() {
    compareSelected = [];
    const photos = getData('progress_photos', []);
    if (photos.length < 2) {
        showToast('צריך לפחות 2 תמונות להשוואה');
        return;
    }

    const sorted = [...photos].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const picker = document.getElementById('compare-photo-picker');
    picker.innerHTML = sorted.map(p => `
        <div class="progress-photo-item compare-pick" id="pick-${p.id}" onclick="toggleComparePick(${p.id})" style="cursor:pointer">
            <img src="${p.base64}" alt="בחרי" loading="lazy">
            <div class="progress-photo-date">${formatProgressDate(p.date)}</div>
        </div>
    `).join('');

    document.getElementById('compare-select-ui').style.display = 'block';
    document.getElementById('compare-result').style.display = 'none';
    document.getElementById('compare-go-btn').style.display = 'none';
    openModal('compare-modal');
}

function toggleComparePick(id) {
    const idx = compareSelected.indexOf(id);
    if (idx >= 0) {
        compareSelected.splice(idx, 1);
        document.getElementById('pick-' + id).classList.remove('compare-selected');
    } else {
        if (compareSelected.length >= 2) {
            // Deselect oldest selection
            const old = compareSelected.shift();
            document.getElementById('pick-' + old).classList.remove('compare-selected');
        }
        compareSelected.push(id);
        document.getElementById('pick-' + id).classList.add('compare-selected');
    }
    document.getElementById('compare-go-btn').style.display = compareSelected.length === 2 ? 'block' : 'none';
}

function executeCompare() {
    if (compareSelected.length !== 2) return;
    const photos = getData('progress_photos', []);
    const p1 = photos.find(p => p.id === compareSelected[0]);
    const p2 = photos.find(p => p.id === compareSelected[1]);
    if (!p1 || !p2) return;

    // Sort by date: earlier = before, later = after
    const [before, after] = p1.date <= p2.date ? [p1, p2] : [p2, p1];
    renderBeforeAfterSlider(before, after);
}

function renderBeforeAfterSlider(before, after) {
    document.getElementById('compare-select-ui').style.display = 'none';
    document.getElementById('compare-result').style.display = 'block';

    const container = document.getElementById('compare-container');
    container.innerHTML = `
        <img class="compare-img compare-img--before" src="${before.base64}" alt="לפני">
        <img class="compare-img compare-img--after" src="${after.base64}" alt="אחרי">
        <div class="compare-slider-line" id="compare-line"></div>
        <div class="compare-slider-handle" id="compare-handle">◀▶</div>
        <div class="compare-label compare-label--before">לפני</div>
        <div class="compare-label compare-label--after">אחרי</div>
    `;

    document.getElementById('compare-dates').innerHTML = `
        <span>${formatProgressDate(after.date)}</span>
        <span>${formatProgressDate(before.date)}</span>
    `;

    // Setup drag
    const handle = document.getElementById('compare-handle');
    const line = document.getElementById('compare-line');
    const afterImg = container.querySelector('.compare-img--after');

    let dragging = false;

    function updateSlider(clientX) {
        const rect = container.getBoundingClientRect();
        let pct = ((clientX - rect.left) / rect.width) * 100;
        pct = Math.max(0, Math.min(100, pct));
        // RTL: slider position maps directly (left = 0%, right = 100%)
        afterImg.style.clipPath = `inset(0 0 0 ${pct}%)`;
        handle.style.left = pct + '%';
        line.style.left = pct + '%';
    }

    handle.addEventListener('mousedown', (e) => { dragging = true; e.preventDefault(); });
    document.addEventListener('mousemove', (e) => { if (dragging) updateSlider(e.clientX); });
    document.addEventListener('mouseup', () => { dragging = false; });

    handle.addEventListener('touchstart', (e) => { dragging = true; e.preventDefault(); }, { passive: false });
    document.addEventListener('touchmove', (e) => { if (dragging) updateSlider(e.touches[0].clientX); }, { passive: false });
    document.addEventListener('touchend', () => { dragging = false; });
}

function resetCompare() {
    compareSelected = [];
    document.getElementById('compare-select-ui').style.display = 'block';
    document.getElementById('compare-result').style.display = 'none';
    // Re-render picker
    startBeforeAfterCompare();
}

document.addEventListener('DOMContentLoaded', async () => {
    // Replace data-icon placeholders with SVG icons
    document.querySelectorAll('[data-icon]').forEach(el => {
        const iconName = el.dataset.icon;
        if (ICONS[iconName]) el.innerHTML = ICONS[iconName](el.dataset.iconSize || 16);
    });
    // Set welcome icon
    const welcomeIcon = document.getElementById('welcome-icon');
    if (welcomeIcon && ICONS.orange) welcomeIcon.innerHTML = ICONS.orange(48);

    // Register service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // Check if user already has an identity
    const userId = getData('userId', null);
    if (!userId) {
        // Show welcome screen for new users
        showWelcomeScreen();
        return;
    }

    // Existing user - go straight to app
    await initApp();
});
