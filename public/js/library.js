/* מילה — ספריית האתגרים הקבועה (library.js)
   קובץ משותף לדפדפן (window.MilaLibrary) ולשרת (import ב-Worker דרך esbuild).
   כל אתגר: מזהה יציב, קטגוריה, שם, הגדרת הצלחה מדידה, תדירות, גרסה.
   כל האתגרים כרגע יומיים: הם נמדדים יום-יום בדיווח עצמי, במסגרת תקרת 3 ביום.
   'weekly' שמור במבנה לעתיד ולא נשלח בספרייה עד שיהיה מנגנון מדידה שבועי.
   קטגוריה רגישה (sensitive) → פרטי כברירת מחדל: לא מופיע בפעילות הקבוצה בלי בחירה מפורשת. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MilaLibrary = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1;
  const CATEGORIES = [
    { id: 'food', name: 'אוכל ותזונה', emoji: '🍟', sensitive: false },
    { id: 'move', name: 'תנועה ובריאות', emoji: '🏃', sensitive: false },
    { id: 'family', name: 'הורות ומשפחה', emoji: '🧸', sensitive: false },
    { id: 'couple', name: 'זוגיות ואינטימיות', emoji: '❤️', sensitive: true },
    { id: 'habits', name: 'הרגלים וכסף', emoji: '🛍️', sensitive: false },
  ];
  const D = (id, cat, title, rule, icon) => ({ id, cat, title, rule, icon, frequency: 'daily', version: 1 });
  const CHALLENGES = [
    // אוכל ותזונה
    D('food_no_sweets_evening', 'food', 'בלי מתוק אחרי ארוחת ערב', 'אחרי ארוחת הערב לא נוגעות במתוק. תה ופרי בסדר.', 'noSugar'),
    D('food_no_delivery', 'food', 'בלי להזמין אוכל', 'אף משלוח ואף טייקאוויי היום.', 'home'),
    D('food_8_water', 'food', '8 כוסות מים ביום', 'שמונה כוסות מים עד סוף היום.', 'water'),
    D('food_no_tv_snacks', 'food', 'בלי נשנושים מול הטלוויזיה', 'מול הטלוויזיה לא אוכלות. רוצה נשנוש? בשולחן.', 'noPhone'),
    D('food_breakfast_home', 'food', 'ארוחת בוקר בבית', 'אוכלות ארוחת בוקר לפני שיוצאות מהבית.', 'coffee'),
    D('food_no_sweet_drinks', 'food', 'בלי שתייה מתוקה', 'מים, סודה, תה או קפה. בלי סוכר ובלי ממותקים.', 'water'),
    D('food_veg_two_meals', 'food', 'ירקות בשתי ארוחות', 'ירק בשתי ארוחות לפחות היום.', 'leaf'),
    D('food_no_snack_way_home', 'food', 'בלי חטיף בדרך הביתה', 'מהעבודה הביתה בלי עצירה בפיצוציה.', 'walk'),
    D('food_cook_home', 'food', 'לבשל בבית', 'ארוחה אחת לפחות היום מבושלת בבית.', 'home'),
    D('food_no_screen_eating', 'food', 'בלי לאכול מול המסך', 'כל ארוחה בלי טלפון, טלוויזיה או מחשב.', 'noPhone'),
    // תנועה ובריאות
    D('move_8000_steps', 'move', '8,000 צעדים ביום', 'מונה הצעדים מראה 8,000 או יותר עד סוף היום.', 'run'),
    D('move_walk_30', 'move', 'הליכה 30 דקות', 'לפחות 30 דקות הליכה רצופה.', 'walk'),
    D('move_workout_5', 'move', 'אימון 5 דקות', 'חמש דקות של תרגילים, בכל שעה שנוחה.', 'dumbbell'),
    D('move_stairs', 'move', 'מדרגות במקום מעלית', 'כל עלייה היום במדרגות.', 'walk'),
    D('move_sleep_by_23', 'move', 'לישון עד 23:00', 'במיטה ואורות כבויים עד 23:00.', 'sleep'),
    D('move_stretch_10', 'move', '10 דקות מתיחות', 'עשר דקות מתיחות, בבוקר או בערב.', 'meditate'),
    D('move_20_squats', 'move', '20 סקוואטים', 'עשרים סקוואטים, ברצף או בחלקים.', 'dumbbell'),
    D('move_no_phone_bed', 'move', 'בלי טלפון במיטה', 'הטלפון מחוץ לחדר השינה מרגע הכיבוי.', 'noPhone'),
    D('move_outside_15', 'move', '15 דקות בחוץ', 'אוויר ושמש. רבע שעה בחוץ לפחות.', 'leaf'),
    D('move_no_snooze', 'move', 'לקום בלי נודניק', 'צלצול ראשון, קמות.', 'star'),
    // הורות ומשפחה
    D('fam_no_yelling', 'family', 'לא לצעוק על הילדים', 'יום שלם בלי להרים את הקול בבית.', 'home'),
    D('fam_play_15', 'family', '15 דקות משחק עם הילדים', 'משחק משותף בלי מסכים, 15 דקות לפחות.', 'smile'),
    D('fam_dinner_no_screens', 'family', 'ארוחת ערב בלי מסכים', 'כולם בשולחן, הטלפונים בצד.', 'users'),
    D('fam_bedtime_story', 'family', 'סיפור לפני השינה', 'סיפור אחד לפחות לפני שהילדים נרדמים.', 'book'),
    D('fam_one_on_one', 'family', '10 דקות אחד על אחד', 'עם ילד אחד, בלי אחים ובלי טלפון.', 'heart'),
    D('fam_call_parents', 'family', 'שיחה עם ההורים', 'שיחת טלפון או ביקור. גם קצר נחשב.', 'call'),
    D('fam_no_phone_pickup', 'family', 'בלי טלפון באיסוף', 'מהרגע שרואות אותם, הטלפון בתיק.', 'noPhone'),
    D('fam_compliment_kid', 'family', 'מחמאה לכל ילד', 'מחמאה אמיתית אחת לכל ילד, לא על התוצאה אלא על המאמץ.', 'star'),
    D('fam_cook_together', 'family', 'לבשל ביחד', 'הילדים עוזרים במשהו במטבח.', 'home'),
    D('fam_morning_no_screens', 'family', 'בוקר בלי מסכים', 'עד היציאה מהבית, בלי טלוויזיה וטאבלט.', 'moon'),
    // זוגיות ואינטימיות (רגיש: פרטי כברירת מחדל)
    D('cpl_compliment', 'couple', 'מחמאה אחת ביום', 'מחמאה אמיתית לבן או בת הזוג.', 'heart'),
    D('cpl_no_phones_evening', 'couple', 'שעה בערב בלי טלפונים', 'שעה אחת ביחד, הטלפונים בחדר אחר.', 'noPhone'),
    D('cpl_ten_min_talk', 'couple', '10 דקות שיחה אמיתית', 'לא על הילדים ולא על הלו״ז.', 'call'),
    D('cpl_hug_20', 'couple', 'חיבוק של 20 שניות', 'חיבוק ארוך אחד. עשרים שניות, באמת.', 'heart'),
    D('cpl_thank_you', 'couple', 'תודה על משהו קטן', 'להגיד תודה על דבר אחד שקרה היום.', 'smile'),
    D('cpl_date_step', 'couple', 'צעד אחד לקראת דייט', 'להזמין מקום, לסדר בייביסיטר או לקבוע תאריך.', 'star'),
    D('cpl_no_criticism', 'couple', 'יום בלי ביקורת', 'יום שלם בלי הערה מבקרת.', 'leaf'),
    D('cpl_sleep_together', 'couple', 'ללכת לישון ביחד', 'נכנסות למיטה באותה שעה.', 'sleep'),
    D('cpl_us_time', 'couple', 'רבע שעה רק שלנו', 'רבע שעה ביחד בלי מסכים ובלי ילדים.', 'heart'),
    D('cpl_good_morning', 'couple', 'בוקר טוב לפני הטלפון', 'הדבר הראשון בבוקר: בוקר טוב לבן או בת הזוג, לא לטלפון.', 'coffee'),
    // הרגלים וכסף
    D('hab_no_impulse_buy', 'habits', 'בלי קניות אימפולסיביות', 'שום קנייה שלא תוכננה מראש.', 'coffee'),
    D('hab_coffee_home', 'habits', 'קפה מהבית', 'בלי לקנות קפה בחוץ היום.', 'coffee'),
    D('hab_no_social_before_10', 'habits', 'בלי רשתות עד 10:00', 'אינסטגרם, טיקטוק ופייסבוק נפתחים רק אחרי עשר.', 'noPhone'),
    D('hab_read_10', 'habits', 'קריאה 10 עמודים', 'עשרה עמודים מספר. לא מסך.', 'book'),
    D('hab_tidy_10', 'habits', '10 דקות סידור', 'טיימר של עשר דקות וסידור של פינה אחת.', 'tools'),
    D('hab_three_good', 'habits', '3 דברים טובים', 'לכתוב שלושה דברים טובים שקרו היום.', 'pencil'),
    D('hab_meditate_10', 'habits', '10 דקות מדיטציה', 'תרגול נשימה או מדיטציה של עשר דקות.', 'meditate'),
    D('hab_track_spending', 'habits', 'לרשום כל הוצאה', 'כל שקל שיצא היום נרשם.', 'pencil'),
    D('hab_screen_under_2h', 'habits', 'פחות משעתיים מסך', 'זמן מסך בטלפון מתחת לשעתיים ביום.', 'noPhone'),
    D('hab_no_online_shopping', 'habits', 'בלי קניות אונליין', 'אף הזמנה באתרים ובאפליקציות היום.', 'tools'),
  ];
  const byId = {}; CHALLENGES.forEach(c => { byId[c.id] = c; });
  const catById = {}; CATEGORIES.forEach(c => { catById[c.id] = c; });
  return {
    VERSION, CATEGORIES, CHALLENGES,
    get: (id) => byId[id] || null,
    category: (id) => catById[id] || null,
    isSensitive: (id) => { const c = byId[id]; return !!(c && catById[c.cat] && catById[c.cat].sensitive); },
    inCategory: (catId) => CHALLENGES.filter(c => c.cat === catId),
  };
});
