# מילה. — כולנו מבטיחות. בואי נראה מי מקיימת.

משחק חברתי של התמדה: כל אחת בוחרת עד 3 אתגרים מספרייה של 50 (או אתגר משלה) ל-14 יום, מדווחת כל יום, והקבוצה מתחרה על אחוז ההתמדה.
כל הצלחה = שקל וירטואלי; פספוס בקבוצה = שקל לקופה. אין כסף אמיתי, אין רכישה, אין פדיון. חלוקת הקופה בסוף הסבב עדיין לא ממומשת (החלטה פתוחה).

PWA בעברית (RTL) על תשתית חינמית: **Cloudflare Workers + Static Assets + D1**, התחברות עם **Google**.
אין שירות בתשלום, אין אמצעי תשלום, אין תלות ב-CDN חיצוני.

## מבנה

| נתיב | תפקיד |
|---|---|
| `src/index.js` | ה-Worker: נתיבי `/api/*`, הגשת נכסים סטטיים, CSRF, ניטור מכסות |
| `src/auth.js` | Google OAuth 2.0 (code + PKCE), סשנים ב-D1 (אסימון נשמר כ-hash, עוגיית HttpOnly), כניסת בדיקה לסביבת staging בלבד |
| `src/game.js` | **חוקי המשחק בשרת**: תקרת 3 ביום, חלונות דיווח לפי אזור זמן, החרגות, תיקונים כ-REVERSE, דיווח idempotent, קבוצות, שלושה סוגי הזמנה, ״המהפך״ (עקיפה בדירוג), חסימות |
| `public/js/library.js` | **ספריית 50 האתגרים** (משותפת לדפדפן ולשרת): מזהה יציב, קטגוריה, הגדרת הצלחה, תדירות, גרסה; קטגוריה רגישה = פרטי כברירת מחדל |
| `docs/SCREENS.md`, `docs/GLOSSARY.md` | מפת מסכים 2.0 ומילון המונחים |
| `src/state.js` | בניית מצב המשתמשת — רק מה שמותר לה לראות |
| `migrations/0001_init.sql`, `0002_library_invites.sql` | סכמת D1 (SQLite) עם טריגרי תקרה ויומן append-only; ספרייה, פרס אישי, סוגי הזמנה |
| `public/` | האפליקציה: `index.html`, `styles.css`, `js/engine.js` (מודל קריאה + מצב דמו מקומי), `js/app.js` (מסכים), `js/api.js` (קריאות לשרת) |
| `tests/engine.test.cjs` | חוקי המנוע בלקוח (מצב דמו) |
| `tests/api.test.cjs` | 24 בדיקות שרת: ספרייה, פרטיות אתגר רגיש, סוגי הזמנה, פרס משותף, המהפך, שתי משתמשות, הרשאות, בקשות מקבילות, תקרה, תיקונים, חסימה, סשן |
| `tests/e2e.two-users.cjs` | Playwright: שני "טלפונים", מעגל משותף, הזמנה, מילה קבוצתית, דיווחים, בנק וקופה, מכשיר חדש, ניתוק רשת |
| `docs/AUDIT.md` | ביקורת מימוש מול האפיון |

## פיתוח מקומי

```bash
npm install
npm run db:migrate:local     # D1 מקומי (Miniflare)
npm run dev                  # http://127.0.0.1:8787  (ALLOW_TEST_LOGIN=true בסביבת ברירת המחדל)
npm run test:engine
BASE_URL=http://127.0.0.1:8787 npm run test:api
BASE_URL=http://127.0.0.1:8787 npm run test:e2e
```

## פריסה (Cloudflare Free)

הגדרה חד-פעמית בחשבון Cloudflare (ללא אמצעי תשלום):

```bash
npx wrangler login                                   # או CLOUDFLARE_API_TOKEN
npx wrangler d1 create mila-db                       # staging  → להעתיק את database_id ל-wrangler.toml
npx wrangler d1 create mila-db-prod                  # production → להעתיק ל-[env.production]
npm run db:migrate                                   # מיגרציה ל-staging
npm run db:migrate:prod                              # מיגרציה לייצור
npx wrangler secret put GOOGLE_CLIENT_SECRET         # staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env production
npm run deploy                                       # https://mila-staging.<subdomain>.workers.dev
npm run deploy:prod                                  # https://mila.<subdomain>.workers.dev
```

ב-`wrangler.toml` ממלאים את `GOOGLE_CLIENT_ID` (ציבורי) לכל סביבה. ב-Google Cloud Console → OAuth client (Web):
Authorized redirect URIs = `https://<host>/api/auth/google/callback` לכל סביבה.

סביבת הבדיקות (`mila-staging`) מאפשרת `POST /api/auth/test-login` לבדיקות אוטומטיות; בייצור הנתיב מוחזר כ-404.

## מגבלות המסלול החינמי ואיך עומדים בהן

| משאב | מגבלה (Free) | מילה |
|---|---|---|
| Workers בקשות | 100,000 / יום | ~30 בקשות למשתמשת ליום (מסך + פעולות). 100 משתמשות פעילות ≈ 3% מהמכסה. נכסים סטטיים לא נספרים כבקשות Worker כשהם מוגשים ישירות |
| Workers CPU | 10 ms / בקשה | אין hashing כבד (לכן לא Better Auth עם scrypt); OAuth הוא I/O; בניית מצב ~1–3 ms |
| D1 קריאות | 5,000,000 שורות / יום | `GET /state` קורא כמה עשרות עד מאות שורות; רענון אוטומטי כל 45 שניות רק כשהמסך גלוי |
| D1 כתיבות | 100,000 שורות / יום | דיווח = 3–5 שורות; מילה חדשה = ~16 שורות |
| D1 אחסון | 5 GB | שנה של 1,000 משתמשות פעילות ≈ עשרות MB |

- כשמגיעים למכסה, Cloudflare מחזירה שגיאה (לא חיוב). השרת ממפה אותה להודעה ברורה: ״הגענו למכסת השימוש היומית״.
- `usage_daily` סופרת קריאות מצב ליום; `GET /api/health` לבדיקת חיים. ניטור מפורט: Cloudflare Dashboard → Workers & Pages / D1 → Metrics.
- גיבוי: `npx wrangler d1 export mila-db-prod --remote --output backup.sql`. ייצוא אישי: הגדרות → ייצוא הנתונים שלי.
- סביבות נפרדות: Worker ו-D1 שונים ל-staging ולייצור; `ALLOW_TEST_LOGIN` כבוי בייצור.
