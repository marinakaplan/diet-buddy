/* ============================================
   DietAgent - AI Agent (Claude API)
   Uses /api/chat serverless proxy on Vercel
   Falls back to direct API for local dev
   ============================================ */

const SYSTEM_PROMPT_DIET = `את דיאטנית קלינית מומחית ואישית. את מדברת בעברית ונותנת ייעוץ חם, מקצועי וממוקד.

הנחיות:
- תמיד דברי בעברית בלשון נקבה (פונה לאישה)
- תני תשובות קצרות וממוקדות
- השתמשי באימוג'ים בצורה מתונה
- כשמנתחת אוכל - תני ערכים מציאותיים ומדויקים
- כשנותנת המלצות - התחשבי בכל הנתונים (משקל, בדיקות דם, ארוחות)
- אם בדיקות הדם מראות ערכים חריגים - ציני זאת והמליצי
- תני טיפים פרקטיים שקל ליישם
- אל תאבחני מצבים רפואיים - המליצי לפנות לרופא כשצריך
- כשנותנת תפריט - התאימי אותו ליעדי הקלוריות של המשתמשת`;

const SYSTEM_PROMPT_FOOD = `את מומחית תזונה. המשימה שלך לנתח ארוחה שמתוארת בטקסט חופשי או בתמונה ולהחזיר ערכים תזונתיים.

החזירי תמיד JSON בפורמט הבא בלבד (ללא טקסט נוסף):
{
  "calories": <number>,
  "protein": <number>,
  "carbs": <number>,
  "fat": <number>,
  "health_score": <number 1-10>,
  "notes": "<הערה קצרה על הארוחה בעברית>",
  "detected_food": "<תיאור קצר של מה שזיהית בתמונה/טקסט>"
}

הנחיות:
- תני ערכים מציאותיים על בסיס מנות ישראליות ממוצעות
- אם לא ניתן לחשב בדיוק, תני הערכה סבירה
- ההערה צריכה להיות טיפ קצר (שורה אחת) על הארוחה
- אם מדובר בתמונת אוכל - זהי את המאכלים, העריכי כמויות ותני ערכים תזונתיים
- detected_food - תארי בקצרה מה זיהית (למשל "סלט ירקות עם טונה וביצה")
- health_score - ציון בריאות מ-1 עד 10. 1=מאוד לא בריא, 5=בינוני, 10=בריא מאוד. התחשבי באיזון מאקרו, ערך תזונתי, רמת עיבוד ותוספת סוכרים`;

async function callAPI(systemPrompt, messages, maxTokens = 1024) {
    // Try serverless proxy first (Vercel), fall back to direct API
    const useProxy = !window.location.hostname.includes('localhost') || await proxyAvailable();

    if (useProxy) {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ system: systemPrompt, messages, max_tokens: maxTokens })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Error: ${response.status}`);
        }
        return await response.json();
    } else {
        // Direct API call for local dev (uses API key from profile)
        const profile = getProfile();
        if (!profile.apiKey) throw new Error('הגדירי API Key בפרופיל');
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': profile.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: maxTokens,
                system: systemPrompt,
                messages
            })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `API Error: ${response.status}`);
        }
        return await response.json();
    }
}

let _proxyChecked = false;
let _proxyOk = false;
async function proxyAvailable() {
    if (_proxyChecked) return _proxyOk;
    try {
        const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        _proxyOk = r.status !== 404;
    } catch { _proxyOk = false; }
    _proxyChecked = true;
    return _proxyOk;
}

// Chat history for multi-turn conversations
let chatHistory = [];

async function chatWithAI(userMessage, context, profile) {
    const systemPrompt = SYSTEM_PROMPT_DIET + '\n\nנתוני המשתמשת:\n' + context;

    chatHistory.push({ role: 'user', content: userMessage });
    if (chatHistory.length > 20) {
        chatHistory = chatHistory.slice(-20);
    }

    const data = await callAPI(systemPrompt, chatHistory, 1500);
    const reply = data.content[0].text;
    chatHistory.push({ role: 'assistant', content: reply });
    return reply;
}

async function analyzeFoodWithAI(foodDescription, profile, imageBase64 = null) {
    let userContent;

    if (imageBase64) {
        // Vision: send image + optional text
        const contentParts = [];
        contentParts.push({
            type: 'image',
            source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: imageBase64
            }
        });
        const textPrompt = foodDescription
            ? `נתחי את הארוחה בתמונה. המשתמשת הוסיפה: "${foodDescription}"`
            : 'נתחי את הארוחה שבתמונה. זהי את המאכלים ותני ערכים תזונתיים.';
        contentParts.push({ type: 'text', text: textPrompt });
        userContent = contentParts;
    } else {
        userContent = `נתחי את הארוחה הבאה:\n${foodDescription}`;
    }

    const data = await callAPI(
        SYSTEM_PROMPT_FOOD,
        [{ role: 'user', content: userContent }]
    );
    const text = data.content[0].text;

    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                calories: Math.round(parsed.calories || 0),
                protein: Math.round(parsed.protein || 0),
                carbs: Math.round(parsed.carbs || 0),
                fat: Math.round(parsed.fat || 0),
                health_score: Math.min(10, Math.max(1, Math.round(parsed.health_score || 5))),
                notes: parsed.notes || '',
                detected_food: parsed.detected_food || foodDescription || ''
            };
        }
        throw new Error('No JSON found');
    } catch {
        throw new Error('לא הצלחתי לנתח את התשובה. נסי שוב.');
    }
}

// ============ Blood Test Analysis ============
const SYSTEM_PROMPT_BLOOD = `את דיאטנית קלינית מומחית. נתוני בדיקות דם של המשתמשת מוצגים לפניך.
נתחי את התוצאות והחזירי JSON בפורמט:
{
  "score": <1-10>,
  "summary": "<סיכום קצר בעברית>",
  "abnormal": [{"name": "<שם הבדיקה>", "status": "high|low", "value": <number>, "recommendation": "<המלצה תזונתית ספציפית>"}],
  "improvements": [{"name": "<שם>", "direction": "up|down", "note": "<הערה>"}],
  "tips": ["<טיפ 1>", "<טיפ 2>", "<טיפ 3>"]
}
אל תאבחני - המליצי לפנות לרופא אם יש ערכים מדאיגים.
השתמשי בטווחי נורמה: סוכר 70-100, כולסטרול <200, טריגליצרידים <150, ברזל 60-170, B12 200-900, ויטמין D 30-100, TSH 0.4-4.0`;

async function analyzeBloodTests(currentTest, previousTest) {
    // Check cache first
    const cacheKey = 'blood_analysis_' + currentTest.date;
    const cached = getData(cacheKey, null);
    if (cached) return cached;

    let message = 'בדיקת דם נוכחית:\n';
    const names = { glucose: 'סוכר', cholesterol: 'כולסטרול', triglycerides: 'טריגליצרידים', iron: 'ברזל', b12: 'B12', vitd: 'ויטמין D', tsh: 'TSH' };

    Object.keys(names).forEach(key => {
        if (currentTest[key] != null) {
            message += `${names[key]}: ${currentTest[key]}\n`;
        }
    });

    if (previousTest) {
        message += '\nבדיקה קודמת (לצורך השוואה):\n';
        Object.keys(names).forEach(key => {
            if (previousTest[key] != null) {
                message += `${names[key]}: ${previousTest[key]}\n`;
            }
        });
    }

    const data = await callAPI(
        SYSTEM_PROMPT_BLOOD,
        [{ role: 'user', content: message }],
        1500
    );

    const text = data.content[0].text;
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            // Cache result
            setData(cacheKey, parsed);
            return parsed;
        }
        throw new Error('No JSON found');
    } catch {
        throw new Error('לא הצלחתי לנתח את התשובה. נסי שוב.');
    }
}

// ============ Blood Test OCR ============
const SYSTEM_PROMPT_BLOOD_OCR = `את מומחית לקריאת בדיקות דם. התמונה מכילה תוצאות בדיקת דם.
חלצי את הערכים הבאים מהתמונה והחזירי JSON בלבד:
{
  "glucose": <number or null>,
  "cholesterol": <number or null>,
  "triglycerides": <number or null>,
  "iron": <number or null>,
  "b12": <number or null>,
  "vitd": <number or null>,
  "tsh": <number or null>
}
שמות אפשריים בעברית/אנגלית:
- סוכר/Glucose/גלוקוז
- כולסטרול/Cholesterol/Total Cholesterol
- טריגליצרידים/Triglycerides
- ברזל/Iron/Fe
- B12/ויטמין B12
- ויטמין D/Vitamin D/25-OH-D
- TSH/תירואיד
אם ערך לא נמצא, החזירי null. החזירי רק JSON ללא הסברים.`;

async function extractBloodTestFromImage(imageBase64) {
    const data = await callAPI(
        SYSTEM_PROMPT_BLOOD_OCR,
        [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: 'חלצי את ערכי בדיקת הדם מהתמונה.' }
        ]}],
        512
    );
    const text = data.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error('לא הצלחתי לחלץ ערכים מהתמונה');
}

// ============ AI Daily Menu Planner ============
const SYSTEM_PROMPT_MENU_PLANNER = `את דיאטנית קלינית מומחית. בני תפריט יומי מותאם אישית.
החזירי JSON בפורמט הבא בלבד:
{
  "meals": [
    {"type": "breakfast", "name": "<שם הארוחה>", "description": "<תיאור קצר>", "calories": <number>, "protein": <number>, "carbs": <number>, "fat": <number>, "ingredients": ["<רכיב 1>", "<רכיב 2>"]},
    {"type": "lunch", ...},
    {"type": "dinner", ...},
    {"type": "snack", ...}
  ],
  "total": {"calories": <number>, "protein": <number>, "carbs": <number>, "fat": <number>},
  "tip": "<טיפ קצר ליום>"
}
הנחיות:
- התאימי ליעדי הקלוריות והמאקרו
- ארוחות ישראליות ריאליסטיות שקל להכין
- התחשבי במה שכבר נאכל היום
- תני כמויות מדויקות ברכיבים
- כתבי הכל בעברית`;

async function generateDayPlan(profile, alreadyEaten, preferences) {
    let message = 'בני לי תפריט ליום.\n\n';
    message += `יעדים: ${profile.targetCalories || 1500} קלוריות, ${profile.targetProtein || 80}g חלבון, ${profile.targetCarbs || 150}g פחמימות, ${profile.targetFat || 50}g שומן\n`;

    if (alreadyEaten && alreadyEaten.length > 0) {
        const eaten = alreadyEaten.reduce((acc, m) => ({
            calories: acc.calories + (m.calories || 0),
            protein: acc.protein + (m.protein || 0),
            carbs: acc.carbs + (m.carbs || 0),
            fat: acc.fat + (m.fat || 0)
        }), {calories:0, protein:0, carbs:0, fat:0});
        message += `\nכבר אכלתי היום: ${eaten.calories} קלוריות, ${eaten.protein}g חלבון\n`;
        message += 'תכנני רק את שאר הארוחות שנשארו.\n';
    }

    if (preferences) message += `\nהעדפות: ${preferences}\n`;

    const data = await callAPI(SYSTEM_PROMPT_MENU_PLANNER, [{role:'user', content: message}], 2000);
    const text = data.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('לא הצלחתי ליצור תפריט');
    return JSON.parse(jsonMatch[0]);
}

async function swapMeal(mealType, profile, otherMeals) {
    const mealNames = {breakfast:'ארוחת בוקר', lunch:'ארוחת צהריים', dinner:'ארוחת ערב', snack:'חטיף'};
    let message = `החליפי את ה${mealNames[mealType]} בתפריט.\n`;
    message += `יעדים: ${profile.targetCalories || 1500} קלוריות\n`;
    if (otherMeals.length > 0) {
        message += 'שאר הארוחות בתפריט:\n';
        otherMeals.forEach(m => message += `- ${m.name}: ${m.calories} קלוריות\n`);
    }
    message += '\nהחזירי JSON של ארוחה אחת בלבד בפורמט:\n{"type":"'+mealType+'", "name":"...", "description":"...", "calories":..., "protein":..., "carbs":..., "fat":..., "ingredients":["..."]}\n';

    const data = await callAPI(SYSTEM_PROMPT_MENU_PLANNER, [{role:'user', content: message}], 800);
    const text = data.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('לא הצלחתי להחליף מנה');
    return JSON.parse(jsonMatch[0]);
}

async function getDailyInsight(profile, context) {
    try {
        const data = await callAPI(
            SYSTEM_PROMPT_DIET + '\n\nנתוני המשתמשת:\n' + context,
            [{ role: 'user', content: 'תני לי תובנה קצרה (2-3 משפטים) על היום שלי - מה עשיתי טוב ומה אפשר לשפר.' }]
        );
        return data.content[0].text;
    } catch {
        return null;
    }
}
