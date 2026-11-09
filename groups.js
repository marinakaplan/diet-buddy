/* ============================================
   שיפטי - Groups & Social System
   ============================================ */

// ============ Custom Modal Helpers ============
function showConfirmModal(title, text, onConfirm) {
    document.getElementById('confirm-modal-title').textContent = title;
    document.getElementById('confirm-modal-text').textContent = text;
    const btn = document.getElementById('confirm-modal-btn');
    btn.onclick = function() {
        closeModal('confirm-modal');
        onConfirm();
    };
    openModal('confirm-modal');
}

// ============ User Identity ============
async function ensureUserIdentity() {
    let userId = getData('userId', null);
    let friendCode = getData('friendCode', null);

    if (userId && friendCode) return { userId, friendCode };

    try {
        const profile = getProfile();
        const resp = await fetch('/api/user?action=register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName: profile.name || '' })
        });
        const data = await resp.json();
        if (data.userId) {
            setData('userId', data.userId);
            setData('friendCode', data.friendCode);
            return data;
        }
    } catch (e) {
        console.log('Registration failed:', e.message);
    }
    return { userId: null, friendCode: null };
}

function getUserId() {
    return getData('userId', null);
}

function getFriendCode() {
    return getData('friendCode', null);
}

// ============ Compute Public Stats ============
function computePublicStats() {
    const profile = getProfile();
    const xp = getData('game_xp', 0);
    const level = getLevel(xp);
    const info = getLevelInfo(level);
    const streak = getStreak();
    const weights = getData('weights', []);
    let weightLost = 0;
    if (weights.length >= 2) {
        const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
        weightLost = Math.max(0, sorted[0].value - sorted[sorted.length - 1].value);
    }

    return {
        displayName: profile.name || 'ללא שם',
        xp,
        level,
        levelName: info.name,
        levelEmoji: info.emoji,
        streak,
        weightLost: Math.round(weightLost * 10) / 10,
        lastActive: getTodayKey()
    };
}

// ============ Enhanced Cloud Sync ============
async function syncToCloudWithUser() {
    const userId = getUserId();
    if (!userId) return syncToCloud();

    try {
        const publicStats = computePublicStats();
        const profile = getProfile();

        // Sync public stats + profile to users table
        await fetch('/api/user?action=sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, publicStats, profile, displayName: profile.name })
        });

        // Full data sync via save endpoint
        await syncToCloud();

        console.log(ICONS.cloud(14) + ' סונכרן לענן (משתמש)');
        localStorage.setItem('da__lastSyncTime', JSON.stringify(Date.now()));
        if (typeof updateSyncStatus === 'function') updateSyncStatus();
    } catch (err) {
        console.log(ICONS.warning(14) + ' סנכרון נכשל:', err.message);
        syncToCloud();
    }
}

async function loadFromCloudWithUser() {
    const userId = getUserId();
    if (!userId) return loadFromCloud();

    try {
        // Use the unified load endpoint
        return await loadFromCloud();
    } catch {
        return false;
    }
}

// ============ Groups ============
function createGroup() {
    const userId = getUserId();
    if (!userId) {
        showToast('יש להירשם קודם');
        return;
    }
    document.getElementById('input-group-name').value = '';
    openModal('create-group-modal');
    setTimeout(() => document.getElementById('input-group-name').focus(), 300);
}

async function submitCreateGroup() {
    const groupName = document.getElementById('input-group-name').value.trim();
    if (!groupName) {
        showToast('הכניסי שם לקבוצה');
        return;
    }
    closeModal('create-group-modal');

    // Make sure user is registered
    let userId = getUserId();
    if (!userId) {
        const identity = await ensureUserIdentity();
        userId = identity.userId;
    }
    if (!userId) {
        showToast('שגיאה בהרשמה, נסי שוב');
        return;
    }

    showLoading(ICONS.hourglass(14) + ' יוצרת קבוצה...');
    try {
        const resp = await fetch('/api/group?action=create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, groupName: groupName.trim() })
        });
        const data = await resp.json();
        hideLoading();

        if (data.error) {
            showToast('שגיאה: ' + data.error);
            return null;
        }

        // Save group locally
        const groups = getData('myGroups', []);
        groups.push({ groupId: data.groupId, name: data.name, inviteCode: data.inviteCode });
        setData('myGroups', groups);

        // Check social achievements
        checkAchievements();

        // Show success popup with share options
        showGroupCreatedPopup(data.name, data.inviteCode);
        refreshGroupsPage();
        return data;
    } catch (e) {
        hideLoading();
        console.error('Create group error:', e);
        if (e.name === 'AbortError' || e.message?.includes('timeout')) {
            showToast('הבקשה נמשכה יותר מדי זמן, נסי שוב');
        } else {
            showToast('שגיאה ביצירת קבוצה: ' + (e.message || 'נסי שוב'));
        }
        return null;
    }
}

function showGroupCreatedPopup(groupName, inviteCode) {
    const whatsappText = encodeURIComponent(`הי! 💪 פתחתי קבוצת דיאטה בשיפטי - אפליקציה חינמית למעקב אוכל ודיאטה ביחד!\n\nהקבוצה: "${groupName}"\n\nאיך להצטרף (לוקח דקה):\n1. לחצי על הלינק הזה:\nhttps://diet-agent.vercel.app\n2. תרשמי שם (רק שם ומשקל)\n3. לחצי למטה על "חברות" 👥\n4. לחצי "הצטרפי עם קוד"\n5. הכניסי את הקוד: *${inviteCode}*\n\nככה נוכל לראות אחת את השנייה, לעקוב על אוכל ומים ולעודד אחת את השנייה! 🙌`);

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'group-popup-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
        <div class="group-popup">
            <div class="group-popup-icon">${icon('users', 40)}</div>
            <h3 class="group-popup-title">הקבוצה נוצרה!</h3>
            <p class="group-popup-subtitle">"${groupName}"</p>
            <div class="group-popup-code-box">
                <div class="group-popup-code-label">קוד הצטרפות</div>
                <div class="group-popup-code">${inviteCode}</div>
            </div>
            <p class="group-popup-text">שלחי את הקוד לחברות שלך כדי שיצטרפו!</p>
            <div class="group-popup-actions">
                <a href="https://wa.me/?text=${whatsappText}" target="_blank" class="group-popup-btn group-popup-btn--whatsapp" onclick="this.closest('.group-popup-overlay').remove()">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    שלחי בוואטסאפ
                </a>
                <button class="group-popup-btn group-popup-btn--copy" onclick="navigator.clipboard.writeText('${inviteCode}'); showToast('הקוד הועתק!'); this.closest('.group-popup-overlay').remove()">
                    ${icon('copy', 16)} העתיקי קוד
                </button>
            </div>
            <button class="group-popup-close" onclick="this.closest('.group-popup-overlay').remove()">סגרי</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

function joinGroup() {
    const userId = getUserId();
    if (!userId) {
        showToast('יש להירשם קודם');
        return;
    }
    document.getElementById('input-invite-code').value = '';
    openModal('join-group-modal');
    setTimeout(() => document.getElementById('input-invite-code').focus(), 300);
}

async function submitJoinGroup() {
    const inviteCode = document.getElementById('input-invite-code').value.trim();
    if (!inviteCode) {
        showToast('הכניסי קוד הצטרפות');
        return;
    }
    closeModal('join-group-modal');

    // Make sure user is registered
    let userId = getUserId();
    if (!userId) {
        const identity = await ensureUserIdentity();
        userId = identity.userId;
    }
    if (!userId) {
        showToast('שגיאה בהרשמה, נסי שוב');
        return;
    }

    showLoading(ICONS.hourglass(14) + ' מצטרפת לקבוצה...');
    try {
        const resp = await fetch('/api/group?action=join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, inviteCode: inviteCode.trim() })
        });
        const data = await resp.json();
        hideLoading();

        if (data.error) {
            showToast('שגיאה: ' + data.error);
            return;
        }

        const group = data.group;
        const groups = getData('myGroups', []);
        if (!groups.some(g => g.groupId === group.groupId)) {
            groups.push({ groupId: group.groupId, name: group.name, inviteCode: group.inviteCode });
            setData('myGroups', groups);
        }

        // Check social achievements
        checkAchievements();

        showToast('הצטרפת לקבוצה: ' + group.name + '!');
        // Auto-open the group
        _activeGroupView = group.groupId;
        refreshGroupsPage();
    } catch (e) {
        hideLoading();
        console.error('Join group error:', e);
        showToast('שגיאה בהצטרפות: ' + (e.message || 'נסי שוב'));
    }
}

async function loadGroupLeaderboard(groupId) {
    try {
        const resp = await fetch(`/api/group?action=leaderboard&groupId=${groupId}`);
        if (!resp.ok) return null;
        return await resp.json();
    } catch {
        return null;
    }
}

function shareInviteCode(code, groupName) {
    const text = `בואי להצטרף לקבוצה "${groupName}" בשיפטי!\nקוד הצטרפות: ${code}\nhttps://diet-agent.vercel.app`;

    if (navigator.share) {
        navigator.share({ title: 'שיפטי - הזמנה לקבוצה', text }).catch(() => {});
    } else {
        navigator.clipboard.writeText(text).then(() => {
            showToast('הקוד הועתק!');
        });
    }
}

// ============ Group Activity Feed ============
async function postGroupActivity(type, data) {
    const userId = getUserId();
    if (!userId) return;

    const groups = getData('myGroups', []);
    if (groups.length === 0) return;

    const groupIds = groups.map(g => g.groupId);

    try {
        await fetch('/api/group?action=activity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId,
                groupIds,
                activity: { type, data }
            })
        });
    } catch (e) {
        console.log('Activity post failed:', e.message);
    }
}

async function loadGroupActivities(groupId) {
    try {
        const resp = await fetch(`/api/group?action=activity&groupId=${groupId}&limit=30`);
        if (!resp.ok) return [];
        const result = await resp.json();
        return result.activities || [];
    } catch {
        return [];
    }
}

function formatActivityTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);

    if (diffMin < 1) return 'עכשיו';
    if (diffMin < 60) return `לפני ${diffMin} דק׳`;
    if (diffHr < 24) return `לפני ${diffHr} שע׳`;

    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 1) return 'אתמול';
    if (diffDays < 7) return `לפני ${diffDays} ימים`;
    return date.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

function getActivityIcon(type) {
    switch (type) {
        case 'meal': return icon('utensils', 16);
        case 'water': return icon('droplet', 16);
        case 'weight': return icon('scale', 16);
        case 'achievement': return icon('trophy', 16);
        case 'streak': return icon('flame', 16);
        case 'exercise': return icon('heart', 16);
        case 'challenge': return ICONS.target(16);
        case 'goal': return ICONS.sparkle(16);
        default: return icon('star', 16);
    }
}

function getActivityText(activity) {
    const name = activity.displayName;
    switch (activity.type) {
        case 'meal': {
            const d = activity.data;
            const mealLabels = { breakfast: 'ארוחת בוקר', lunch: 'ארוחת צהריים', dinner: 'ארוחת ערב', snack: 'חטיף' };
            const mealLabel = mealLabels[d.mealType] || 'ארוחה';
            return `<strong>${name}</strong> רשמה ${mealLabel}${d.description ? ': ' + d.description : ''}`;
        }
        case 'water': {
            const cups = activity.data.cups || 0;
            if (cups >= 8) return `<strong>${name}</strong> השלימה יעד מים יומי! ${cups} כוסות`;
            return `<strong>${name}</strong> שתתה כוס מים (${cups}/8)`;
        }
        case 'weight':
            return `<strong>${name}</strong> עדכנה משקל: ${activity.data.weight} ק"ג`;
        case 'achievement':
            return `<strong>${name}</strong> השיגה הישג: ${activity.data.name || ''}`;
        case 'streak':
            return `<strong>${name}</strong> ברצף של ${activity.data.days} ימים!`;
        case 'exercise':
            return `<strong>${name}</strong> התאמנה: ${activity.data.name || 'אימון'}${activity.data.duration ? ' (' + activity.data.duration + ' דק׳)' : ''}`;
        case 'challenge': {
            const d = activity.data || {};
            if (d.action === 'created') return `<strong>${name}</strong> יצרה אתגר חדש: ${d.title}`;
            if (d.action === 'joined') return `<strong>${name}</strong> הצטרפה לאתגר: ${d.title}`;
            if (d.action === 'completed') return ICONS.trophy(16) + ` <strong>${d.winnerName || name}</strong> ניצחה באתגר: ${d.title}!`;
            return `<strong>${name}</strong> עדכנה אתגר`;
        }
        case 'goal': {
            const d = activity.data || {};
            if (d.action === 'created') return `<strong>${name}</strong> הגדירה יעד: ${d.title}`;
            if (d.action === 'contributed') return `<strong>${name}</strong> תרמה ליעד: ${d.title}`;
            if (d.action === 'completed') return ICONS.party(14) + ` היעד הושלם: ${d.title}!`;
            return `<strong>${name}</strong> עדכנה יעד`;
        }
        default:
            return `<strong>${name}</strong> עדכנה נתונים`;
    }
}

function getActivityCalories(activity) {
    if (activity.type === 'meal' && activity.data.calories) {
        return `<span class="activity-cal">${activity.data.calories} קל׳</span>`;
    }
    return '';
}

function renderActivityFeed(activities) {
    if (!activities || activities.length === 0) {
        return `<div style="text-align:center; padding:32px 16px; color:var(--text-muted);">
    <div style="font-size:40px; margin-bottom:12px; opacity:0.5;">${ICONS.messageCircle(32)}</div>
    <div style="font-weight:600; margin-bottom:4px; color:var(--text-secondary);">עדיין אין פעילות בקבוצה</div>
    <div style="font-size:0.82rem;">כשחברות ירשמו ארוחות או ישתו מים, זה יופיע כאן</div>
</div>`;
    }

    let html = '';
    let lastDate = '';

    activities.forEach(a => {
        const date = new Date(a.timestamp).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
        if (date !== lastDate) {
            html += `<div class="activity-date-divider">${date}</div>`;
            lastDate = date;
        }

        html += `
            <div class="activity-item activity-item--${a.type}">
                <div class="activity-icon">${getActivityIcon(a.type)}</div>
                <div class="activity-content">
                    <div class="activity-text">${getActivityText(a)}</div>
                    <div class="activity-meta">
                        ${getActivityCalories(a)}
                        <span class="activity-time">${formatActivityTime(a.timestamp)}</span>
                    </div>
                </div>
            </div>
        `;
    });

    return html;
}

// ============ Groups Page Render ============
let _activeGroupView = null; // Track which group detail is open
let _groupDataCache = {}; // Cache loaded leaderboard data
let _activeGroupTab = {}; // Track active tab per group: 'leaderboard' or 'feed'
let _activityCache = {}; // Cache loaded activity feeds
let _challengeCache = {};
let _celebratedChallenges = {};
let _activeCreateGroupId = null;  // tracks which group the create modals are for

function renderGroupSkeleton(count = 3) {
    let html = '';
    for (let i = 0; i < count; i++) {
        html += `<div class="skeleton skeleton-card" style="opacity:${1 - i * 0.2}"></div>`;
    }
    return html;
}

function getChallengeTypeInfo(type) {
    const types = {
        water: { icon: ICONS.droplet(16), label: '\u05E9\u05EA\u05D9\u05D9\u05EA \u05DE\u05D9\u05DD', color: '#069494', unit: '\u05DB\u05D5\u05E1\u05D5\u05EA' },
        exercise_streak: { icon: ICONS.flame(16), label: '\u05E8\u05E6\u05E3 \u05D0\u05D9\u05DE\u05D5\u05E0\u05D9\u05DD', color: '#EB5757', unit: '\u05D9\u05DE\u05D9\u05DD' },
        weight_loss: { icon: ICONS.trendingDown(16), label: '\u05D9\u05E8\u05D9\u05D3\u05D4 \u05D1\u05DE\u05E9\u05E7\u05DC', color: '#6940A5', unit: '\u05E7"\u05D2' },
        healthy_eating: { icon: ICONS.salad(16), label: '\u05D0\u05D5\u05DB\u05DC \u05D1\u05E8\u05D9\u05D0', color: '#4DAB9A', unit: '\u05E6\u05D9\u05D5\u05DF' },
        calories: { icon: ICONS.target(16), label: '\u05E9\u05DC\u05D9\u05D8\u05D4 \u05D1\u05E7\u05DC\u05D5\u05E8\u05D9\u05D5\u05EA', color: '#CB912F', unit: '\u05D9\u05DE\u05D9\u05DD' },
    };
    return types[type] || types.water;
}

function refreshGroupsPage() {
    const container = document.getElementById('groups-content');
    if (!container) return;

    const userId = getUserId();
    const friendCode = getFriendCode();
    const groups = getData('myGroups', []);
    const myStats = computePublicStats();

    let html = '';

    // My Profile Card
    html += `
        <div class="groups-my-profile">
            <div class="groups-my-profile-avatar">${icon('user', 24)}</div>
            <div class="groups-my-profile-info">
                <div class="groups-my-profile-name">${myStats.displayName}</div>
                <div class="groups-my-profile-meta">רמה ${myStats.level} · ${myStats.xp} XP · ${icon('flame', 14)} ${myStats.streak} ימים</div>
            </div>
            ${friendCode ? `
                <div class="groups-my-profile-code" onclick="navigator.clipboard.writeText('${friendCode}'); showToast(ICONS.clipboard(14) + ' הקוד הועתק!'); this.classList.add('copied'); setTimeout(()=>this.classList.remove('copied'),1500);">
                    <span class="groups-code-label">הקוד שלי</span>
                    <span class="groups-code-value">${friendCode}</span>
                </div>
            ` : ''}
        </div>
    `;

    // Action Buttons
    html += `
        <div class="group-actions">
            <button class="group-action-btn group-action-btn--create" onclick="createGroup()">${icon('plus', 16)} צרי קבוצה</button>
            <button class="group-action-btn group-action-btn--join" onclick="joinGroup()">${icon('key', 16)} הצטרפי עם קוד</button>
        </div>
    `;

    // Groups Count
    if (groups.length > 0) {
        html += `<div class="groups-section-title">הקבוצות שלי (${groups.length})</div>`;
    }

    // Groups List
    if (groups.length === 0) {
        html += `
    <div class="groups-empty" style="background:linear-gradient(180deg, var(--primary-light) 0%, var(--bg) 100%); border-radius:20px; padding:48px 32px 36px; text-align:center; border:none; position:relative; overflow:hidden;">
        <div style="position:relative; width:120px; height:120px; margin:0 auto 20px;">
            <div style="position:absolute; width:120px; height:120px; border-radius:50%; background:var(--primary); opacity:0.12; animation:emptyPulse 3s ease-in-out infinite;"></div>
            <div style="position:absolute; width:80px; height:80px; top:20px; left:20px; border-radius:50%; background:var(--primary); opacity:0.18; animation:emptyPulse 3s ease-in-out 0.5s infinite;"></div>
            <div style="position:absolute; width:50px; height:50px; top:35px; left:35px; border-radius:50%; background:var(--primary); opacity:0.25; animation:emptyPulse 3s ease-in-out 1s infinite;"></div>
            <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); z-index:1;">${ICONS.dancers(32)}</div>
        </div>
        <div style="font-size:1.2rem; font-weight:700; color:var(--text); margin-bottom:8px;">יותר כיף ביחד!</div>
        <div style="font-size:0.85rem; color:var(--text-secondary); line-height:1.5; margin-bottom:24px;">הצטרפי לקבוצה עם חברות<br>ותתחילו לעודד אחת את השנייה</div>
    </div>
        `;
    } else {
        for (const group of groups) {
            const cached = _groupDataCache[group.groupId];
            const memberCount = cached ? cached.memberCount || cached.rankings.length : '?';
            const isActive = _activeGroupView === group.groupId;

            html += `
                <div class="group-card ${isActive ? 'group-card--active' : ''}" id="group-${group.groupId}">
                    <div class="group-card-header" onclick="openGroupDetail('${group.groupId}')">
                        <div class="group-card-icon">${icon('users', 20)}</div>
                        <div class="group-card-info">
                            <div class="group-card-name">${group.name}</div>
                            <div class="group-card-meta">${memberCount} חברות · קוד: ${group.inviteCode}</div>
                        </div>
                        <div class="group-card-arrow">${isActive ? icon('chevronUp', 16) : icon('chevronDown', 16)}</div>
                    </div>
                    <div class="group-detail-container" id="detail-${group.groupId}" ${isActive ? '' : 'style="display:none"'}>
                        <div class="group-detail-loading" id="loading-${group.groupId}">${renderGroupSkeleton(2)}</div>
                    </div>
                </div>
            `;
        }
    }

    container.innerHTML = html;

    // Auto-load active group detail
    if (_activeGroupView) {
        loadGroupDetail(_activeGroupView);
    }
}

async function openGroupDetail(groupId) {
    if (_activeGroupView === groupId) {
        // Close it
        _activeGroupView = null;
        refreshGroupsPage();
        return;
    }

    _activeGroupView = groupId;
    refreshGroupsPage();
    await loadGroupDetail(groupId);
}

async function loadGroupDetail(groupId) {
    const detailContainer = document.getElementById('detail-' + groupId);
    if (!detailContainer) return;

    detailContainer.style.display = 'block';

    // Show loading
    const loadingEl = document.getElementById('loading-' + groupId);
    if (loadingEl) loadingEl.style.display = 'block';

    const data = await loadGroupLeaderboard(groupId);
    if (!data || !data.rankings) {
        detailContainer.innerHTML = '<div class="group-detail-error">לא ניתן לטעון את נתוני הקבוצה</div>';
        return;
    }

    // Cache the data
    _groupDataCache[groupId] = data;
    const group = getData('myGroups', []).find(g => g.groupId === groupId);
    const myUserId = getUserId();

    let html = '';

    // Group Actions Bar
    html += `
        <div class="group-detail-actions">
            <button class="group-detail-action" onclick="event.stopPropagation(); shareInviteCode('${group?.inviteCode || ''}', '${group?.name || ''}')">
                ${icon('share', 14)} הזמיני חברה
            </button>
            <button class="group-detail-action group-detail-action--secondary" onclick="event.stopPropagation(); copyGroupCode('${group?.inviteCode || ''}')">
                ${icon('copy', 14)} העתיקי קוד
            </button>
            <button class="group-detail-action group-detail-action--danger" onclick="event.stopPropagation(); leaveGroup('${groupId}')">
                ${icon('arrowRight', 14)} עזבי
            </button>
        </div>
    `;

    // Tabs: Feed / Challenges / Leaderboard
    const activeTab = _activeGroupTab[groupId] || 'feed';
    html += `
        <div class="group-tabs">
            <button class="group-tab ${activeTab === 'feed' ? 'group-tab--active' : ''}" onclick="event.stopPropagation(); switchGroupTab('${groupId}', 'feed')">
                ${icon('clock', 14)} פיד
            </button>
            <button class="group-tab ${activeTab === 'challenges' ? 'group-tab--active' : ''}" onclick="event.stopPropagation(); switchGroupTab('${groupId}', 'challenges')">
                ${ICONS.target(14)} אתגרים
            </button>
            <button class="group-tab ${activeTab === 'leaderboard' ? 'group-tab--active' : ''}" onclick="event.stopPropagation(); switchGroupTab('${groupId}', 'leaderboard')">
                ${icon('trophy', 14)} לידרבורד
            </button>
        </div>
    `;

    // Activity Feed Tab
    if (activeTab === 'feed') {
        html += `<div class="group-detail-feed" id="feed-${groupId}">`;
        const activities = _activityCache[groupId];
        if (activities === undefined) {
            html += `<div class="activity-loading">טוענת פעילויות...</div>`;
            // Load activities async
            loadGroupActivities(groupId).then(acts => {
                _activityCache[groupId] = acts;
                const feedEl = document.getElementById('feed-' + groupId);
                if (feedEl) feedEl.innerHTML = renderActivityFeed(acts);
            });
        } else {
            html += renderActivityFeed(activities);
        }
        html += `</div>`;
    }

    // Challenges Tab
    if (activeTab === 'challenges') {
        html += '<div id="challenges-container-' + groupId + '"><div style="text-align:center;padding:20px;color:var(--text-muted)">טוען אתגרים...</div></div>';
        // Load after render
        setTimeout(() => loadChallenges(groupId), 100);
    }

    // Leaderboard Tab
    if (activeTab === 'leaderboard') {
    html += `<div class="group-detail-leaderboard">`;
    html += `<div class="group-detail-lb-title">${icon('trophy', 18)} לידרבורד</div>`;

    data.rankings.forEach((r, idx) => {
        const isMe = r.userId === myUserId;
        const medals = ['🥇', '🥈', '🥉'];
        const rankDisplay = idx < 3
            ? `<span class="lb-rank" style="font-size:20px;">${medals[idx]}</span>`
            : `<span class="lb-rank">${idx + 1}</span>`;
        const isActive = isRecentlyActive(r.lastActive);

        html += `
            <div class="lb-member ${isMe ? 'lb-member--me' : ''}" onclick="event.stopPropagation(); toggleMemberDetail(this)">
                <span class="lb-member-rank">${rankDisplay}</span>
                <div class="lb-member-avatar-wrap">
                    <span class="lb-member-avatar">${r.levelEmoji || ICONS.seedling(20)}</span>
                    ${isActive ? '<span class="lb-member-active-dot"></span>' : ''}
                </div>
                <div class="lb-member-main">
                    <div class="lb-member-name">${r.displayName || 'ללא שם'}${isMe ? ' (את)' : ''}</div>
                    <div class="lb-member-level">רמה ${r.level || 1} · ${r.levelName || ''}</div>
                </div>
                <div class="lb-member-xp">${r.xp || 0} XP</div>
                <div class="lb-member-detail-panel">
                    <div class="lb-member-detail-grid">
                        <div class="lb-detail-stat">
                            <span class="lb-detail-stat-value">${icon('flame', 14)} ${r.streak || 0}</span>
                            <span class="lb-detail-stat-label">רצף ימים</span>
                        </div>
                        <div class="lb-detail-stat">
                            <span class="lb-detail-stat-value">${icon('zap', 14)} ${r.xp || 0}</span>
                            <span class="lb-detail-stat-label">XP</span>
                        </div>
                        <div class="lb-detail-stat">
                            <span class="lb-detail-stat-value">${icon('barChart', 14)} ${r.level || 1}</span>
                            <span class="lb-detail-stat-label">רמה</span>
                        </div>
                        ${r.weightLost > 0 ? `
                        <div class="lb-detail-stat">
                            <span class="lb-detail-stat-value">${icon('scale', 14)} ${r.weightLost}</span>
                            <span class="lb-detail-stat-label">ק"ג ירדה</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    });

    html += `
        <div class="group-detail-footer">
            ${data.memberCount || data.rankings.length} חברות בקבוצה · עודכן ${new Date(data.updatedAt).toLocaleTimeString('he-IL', {hour:'2-digit', minute:'2-digit'})}
        </div>
    `;
    html += `</div>`;
    } // end leaderboard tab

    // Update member count in header
    const metaEl = document.querySelector(`#group-${groupId} .group-card-meta`);
    if (metaEl) {
        metaEl.textContent = `${data.memberCount || data.rankings.length} חברות · קוד: ${group?.inviteCode || ''}`;
    }

    detailContainer.innerHTML = html;
}

async function switchGroupTab(groupId, tab) {
    _activeGroupTab[groupId] = tab;
    // Clear activity cache to force refresh when switching to feed
    if (tab === 'feed') delete _activityCache[groupId];
    if (tab === 'challenges') {
        delete _challengeCache[groupId];
    }
    await loadGroupDetail(groupId);
}

function isRecentlyActive(lastActive) {
    if (!lastActive) return false;
    const today = getTodayKey();
    const yesterday = getTodayKey(-1);
    return lastActive === today || lastActive === yesterday;
}

function toggleMemberDetail(el) {
    el.classList.toggle('lb-member--expanded');
}

function copyGroupCode(code) {
    navigator.clipboard.writeText(code).then(() => showToast('קוד הקבוצה הועתק!'));
}

function leaveGroup(groupId) {
    showConfirmModal('עזיבת קבוצה', 'בטוחה שאת רוצה לעזוב את הקבוצה?', function() {
        doLeaveGroup(groupId);
    });
}

async function doLeaveGroup(groupId) {

    const groups = getData('myGroups', []);
    const updated = groups.filter(g => g.groupId !== groupId);
    setData('myGroups', updated);

    // Clean up
    if (_activeGroupView === groupId) _activeGroupView = null;
    delete _groupDataCache[groupId];

    showToast('עזבת את הקבוצה');
    refreshGroupsPage();

    // Also remove from server
    const userId = getUserId();
    if (userId) {
        try {
            await fetch('/api/group?action=leave', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, groupId })
            });
        } catch { /* ignore server errors */ }
    }
}

// ============ Challenges ============
async function loadChallenges(groupId) {
    const container = document.getElementById('challenges-container-' + groupId);
    if (!container) return;

    try {
        const chRes = await fetch('/api/group?action=challenge-progress&groupId=' + groupId);
        const challenges = chRes.ok ? (await chRes.json()).challenges || [] : [];

        // Auto-complete expired challenges
        const today = getTodayKey();
        for (const ch of challenges) {
            if (ch.status === 'active' && ch.end_date <= today) {
                await fetch('/api/group?action=challenge-complete', {
                    method: 'POST',
                    headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ challengeId: ch.challenge_id })
                });
                ch.status = 'completed';
            }
        }

        container.innerHTML = renderChallengesTab(groupId, challenges);
    } catch(e) {
        container.innerHTML = '<div class="challenges-empty">שגיאה בטעינת אתגרים</div>';
    }
}

function renderChallengesTab(groupId, challenges) {
    const myUserId = localStorage.getItem('userId');
    let html = '';

    // Challenges section
    html += '<div class="challenges-section">';

    const activeChallenges = challenges.filter(c => c.status === 'active');
    const completedChallenges = challenges.filter(c => c.status === 'completed');

    if (activeChallenges.length === 0 && completedChallenges.length === 0) {
        html += `<div class="challenges-empty" style="text-align:center; padding:28px 16px;">
            <div style="margin-bottom:10px;">${ICONS.trophy(32)}</div>
            <div style="font-weight:600; color:var(--text-secondary); margin-bottom:4px;">אין אתגרים עדיין</div>
            <div style="font-size:0.82rem; color:var(--text-muted);">לחצי + כדי ליצור אתגר ראשון!</div>
        </div>`;
    } else {
        activeChallenges.forEach(ch => { html += renderChallengeCard(ch, myUserId); });
        completedChallenges.slice(0, 3).forEach(ch => { html += renderChallengeCard(ch, myUserId); });
    }
    html += '</div>';

    // FAB button
    html += `<button class="challenges-fab" onclick="openCreateChallenge('${groupId}')" title="צרי אתגר חדש">+</button>`;

    return html;
}

function renderChallengeCard(challenge, myUserId) {
    const info = getChallengeTypeInfo(challenge.type);
    const isCompleted = challenge.status === 'completed';
    const participants = challenge.participants || [];
    const isJoined = participants.some(p => p.userId === myUserId);

    // Countdown
    let countdown = '';
    if (isCompleted) {
        countdown = '<span class="challenge-countdown challenge-countdown--ended">הסתיים ✓</span>';
    } else {
        const endDate = new Date(challenge.end_date + 'T23:59:59');
        const now = new Date();
        const daysLeft = Math.max(0, Math.ceil((endDate - now) / (1000*60*60*24)));
        countdown = `<span class="challenge-countdown">נותרו ${daysLeft} ימים</span>`;
    }

    // Sort participants by progress desc
    const sorted = [...participants].sort((a,b) => (b.progress||0) - (a.progress||0));
    const maxProgress = sorted.length > 0 ? Math.max(1, sorted[0].progress || 1) : 1;

    let html = `<div class="challenge-card ${isCompleted ? 'challenge-card--completed' : ''}">`;
    html += '<div class="challenge-card-header">';
    html += `<div class="challenge-card-icon" style="background:${info.color}15">${info.icon}</div>`;
    html += '<div class="challenge-card-info">';
    html += `<div class="challenge-card-title">${challenge.title}</div>`;
    html += `<div class="challenge-card-meta">${info.label} · ${participants.length} משתתפות</div>`;
    html += '</div>';
    html += countdown;
    html += '</div>';

    // Participants progress
    if (sorted.length > 0) {
        html += '<div class="challenge-participants">';
        sorted.forEach((p, i) => {
            const pct = maxProgress > 0 ? Math.min(100, ((p.progress||0) / maxProgress) * 100) : 0;
            const isMe = p.userId === myUserId;
            html += '<div class="challenge-participant">';
            html += `<span class="challenge-participant-rank">${i+1}</span>`;
            html += `<span class="challenge-participant-name" style="${isMe?'font-weight:700;color:var(--primary)':''}">${p.displayName || 'אנונימית'}${isMe?' (את)':''}</span>`;
            html += '<div class="challenge-participant-bar">';
            html += `<div class="challenge-participant-fill" style="width:${pct}%;background:${info.color}"></div>`;
            html += '</div>';
            html += `<span class="challenge-participant-value">${(p.progress||0).toFixed(info.unit==='ק"ג'?1:0)} ${info.unit}</span>`;
            html += '</div>';
        });
        html += '</div>';
    }

    // Join button
    if (!isCompleted && !isJoined) {
        html += `<button class="challenge-join-btn" onclick="joinChallenge('${challenge.challenge_id}')">${ICONS.muscle(14)} הצטרפי לאתגר!</button>`;
    }

    // Winner banner
    if (isCompleted && challenge.winner_name) {
        html += `<div class="challenge-winner-banner">${ICONS.trophy(16)} ${challenge.winner_name} ניצחה!</div>`;

        // Celebration for current user
        if (challenge.winner_user_id === myUserId && !_celebratedChallenges[challenge.challenge_id]) {
            _celebratedChallenges[challenge.challenge_id] = true;
            setTimeout(() => {
                if (typeof launchConfetti === 'function') launchConfetti();
                showToast(ICONS.trophy(14) + ' ניצחת באתגר! +100 XP');
            }, 500);
        }
    }

    // Dare banner for completed challenges with a dare
    if (isCompleted && challenge.dare && sorted.length > 0) {
        const loser = sorted[sorted.length - 1];
        const loserName = loser.displayName || 'אנונימית';
        html += `<div class="dare-banner">
    <div class="dare-banner-label">העזה למפסידה</div>
    <div class="dare-banner-name">${loserName}</div>
    <div class="dare-banner-text">${challenge.dare}</div>
</div>`;
    }

    html += '</div>';
    return html;
}


// ============ Challenge & Goal Actions ============
function openCreateChallenge(groupId) {
    _activeCreateGroupId = groupId;
    openModal('create-challenge-modal');
}

async function submitCreateChallenge() {
    const type = document.getElementById('input-challenge-type').value;
    const typeNames = { water: 'אתגר שתייה', exercise_streak: 'אתגר אימונים', weight_loss: 'אתגר ירידה במשקל', healthy_eating: 'אתגר אכילה בריאה', calories: 'אתגר קלוריות' };
    const title = typeNames[type] || 'אתגר';
    const duration = parseInt(document.getElementById('input-challenge-duration').value);
    const dare = document.getElementById('input-challenge-dare').value.trim();
    const userId = localStorage.getItem('userId');
    if (!_activeCreateGroupId) return;

    closeModal('create-challenge-modal');
    showToast('יוצרת אתגר...');

    try {
        const resp = await fetch('/api/group?action=challenge-create', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                userId,
                groupId: _activeCreateGroupId,
                type,
                title,
                durationDays: duration,
                dare
            })
        });
        if (resp.ok) {
            showToast(ICONS.target(14) + ' האתגר נוצר!');
            loadChallenges(_activeCreateGroupId);
        } else {
            showToast('שגיאה ביצירת אתגר');
        }
    } catch(e) { showToast('שגיאה ביצירת אתגר'); }
}

async function joinChallenge(challengeId) {
    const userId = localStorage.getItem('userId');
    try {
        const resp = await fetch('/api/group?action=challenge-join', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ userId, challengeId })
        });
        if (resp.ok) {
            showToast(ICONS.muscle(14) + ' הצטרפת לאתגר!');
            // Reload current group challenges
            if (_activeGroupView) loadChallenges(_activeGroupView);
        } else {
            const data = await resp.json().catch(() => ({}));
            showToast(data.error || 'שגיאה בהצטרפות');
        }
    } catch(e) { showToast('שגיאה בהצטרפות'); }
}

