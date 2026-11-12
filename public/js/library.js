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
    { id: 'food', name: 'Food and nutrition', emoji: '🍟', sensitive: false },
    { id: 'move', name: 'Movement and health', emoji: '🏃', sensitive: false },
    { id: 'family', name: 'Parenting and family', emoji: '🧸', sensitive: false },
    { id: 'couple', name: 'Relationships and intimacy', emoji: '❤️', sensitive: true },
    { id: 'habits', name: 'Habits and money', emoji: '🛍️', sensitive: false },
  ];
  const D = (id, cat, title, rule, icon) => ({ id, cat, title, rule, icon, frequency: 'daily', version: 1 });
  const CHALLENGES = [
    // אוכל ותזונה
    D('food_no_sweets_evening', 'food', 'No sweets after dinner', 'Nothing sweet after dinner. Tea and fruit are fine.', 'noSugar'),
    D('food_no_delivery', 'food', 'No ordering in', 'No delivery and no takeout today.', 'home'),
    D('food_8_water', 'food', '8 glasses of water a day', 'Eight glasses of water by the end of the day.', 'water'),
    D('food_no_tv_snacks', 'food', 'No snacking in front of the TV', 'No eating in front of the TV. Want a snack? At the table.', 'noPhone'),
    D('food_breakfast_home', 'food', 'Breakfast at home', 'Eat breakfast before leaving the house.', 'coffee'),
    D('food_no_sweet_drinks', 'food', 'No sugary drinks', 'Water, sparkling water, tea or coffee. No sugar and no sweetened drinks.', 'water'),
    D('food_veg_two_meals', 'food', 'Vegetables at two meals', 'Vegetables with at least two meals today.', 'leaf'),
    D('food_no_snack_way_home', 'food', 'No snack on the way home', 'From work to home without stopping at the corner store.', 'walk'),
    D('food_cook_home', 'food', 'Cook at home', 'At least one home-cooked meal today.', 'home'),
    D('food_no_screen_eating', 'food', 'No eating in front of a screen', 'Every meal without a phone, TV or computer.', 'noPhone'),
    D('food_no_choc_20', 'food', 'No chocolate after 8 pm', 'After 8 pm the chocolate stays in the cupboard. Even the one you hid.', 'noSugar'),
    // תנועה ובריאות
    D('move_8000_steps', 'move', '8,000 steps a day', 'The step counter shows 8,000 or more by the end of the day.', 'run'),
    D('move_walk_30', 'move', '30-minute walk', 'At least 30 minutes of walking in one go.', 'walk'),
    D('move_workout_5', 'move', '5-minute workout', 'Five minutes of exercise, at whatever time suits you.', 'dumbbell'),
    D('move_stairs', 'move', 'Stairs instead of the elevator', 'Every time you go up today, take the stairs.', 'walk'),
    D('move_sleep_by_23', 'move', 'Go to sleep at 10 pm', 'In bed at 10 pm, lights off.', 'sleep'), // המזהה נשאר (יציב), רק הנוסח עודכן
    D('move_stretch_10', 'move', '10 minutes of stretching', 'Ten minutes of stretching, morning or evening.', 'meditate'),
    D('move_20_squats', 'move', '20 squats', 'Twenty squats, all at once or in sets.', 'dumbbell'),
    D('move_no_phone_bed', 'move', 'No phone in bed', 'From lights out, the phone stays outside the bedroom.', 'noPhone'),
    D('move_outside_15', 'move', '15 minutes outside', 'Fresh air and sun. At least 15 minutes outside.', 'leaf'),
    D('move_no_snooze', 'move', 'No snooze button', 'First alarm, you get up.', 'star'),
    D('move_walk_anyway', 'move', 'A walk, even with no energy', 'A 20-minute walk. Especially on the days you don\'t feel like it.', 'walk'),
    D('move_bed_22', 'move', 'In bed by 10 pm', 'In bed by 10 pm with the lights off. No “one more episode”.', 'sleep'),
    // הורות ומשפחה
    D('fam_no_yelling', 'family', 'No yelling at the kids', 'A whole day without raising your voice at home.', 'home'),
    D('fam_play_15', 'family', '15 minutes of play with the kids', 'Playing together without screens, for at least 15 minutes.', 'smile'),
    D('fam_dinner_no_screens', 'family', 'Screen-free dinner', 'Everyone at the table, phones put aside.', 'users'),
    D('fam_bedtime_story', 'family', 'A bedtime story', 'At least one story before the kids fall asleep.', 'book'),
    D('fam_one_on_one', 'family', '10 minutes one-on-one', 'With one child, no siblings and no phone.', 'heart'),
    D('fam_call_parents', 'family', 'Call my parents', 'A phone call or a visit. A short one counts too.', 'call'),
    D('fam_no_phone_pickup', 'family', 'No phone at pickup', 'From the moment you see them, the phone is put away.', 'noPhone'),
    D('fam_compliment_kid', 'family', 'A compliment for each child', 'One real compliment for each child, for the effort and not the result.', 'star'),
    D('fam_cook_together', 'family', 'Cook together', 'The kids help with something in the kitchen.', 'home'),
    D('fam_morning_no_screens', 'family', 'Screen-free morning', 'No TV or tablet until you leave the house.', 'moon'),
    D('fam_no_phone_kids', 'family', 'No phone when the kids are with me', 'When the kids are with me, the phone is put away. Not even “just to check something”.', 'noPhone'),
    // זוגיות ואינטימיות (רגיש: פרטי כברירת מחדל)
    D('cpl_compliment', 'couple', 'One compliment a day', 'A real compliment for your partner.', 'heart'),
    D('cpl_no_phones_evening', 'couple', 'A phone-free hour in the evening', 'One hour together, phones in another room.', 'noPhone'),
    D('cpl_ten_min_talk', 'couple', '10 minutes of real conversation', 'Not about the kids and not about the schedule.', 'call'),
    D('cpl_hug_20', 'couple', 'A 20-second hug', 'One long hug. Twenty seconds, really.', 'heart'),
    D('cpl_thank_you', 'couple', 'A thank-you for something small', 'Say thank you for one thing that happened today.', 'smile'),
    D('cpl_date_step', 'couple', 'One step toward a date', 'Book a place, arrange a babysitter or set a date.', 'star'),
    D('cpl_no_criticism', 'couple', 'A day without criticism', 'A whole day without a critical remark.', 'leaf'),
    D('cpl_sleep_together', 'couple', 'Go to bed together', 'Get into bed at the same time.', 'sleep'),
    D('cpl_us_time', 'couple', '15 minutes just for us', '15 minutes together, no screens and no kids.', 'heart'),
    D('cpl_good_morning', 'couple', 'Good morning before the phone', 'First thing in the morning: good morning to your partner, not to your phone.', 'coffee'),
    // הרגלים וכסף
    D('hab_no_impulse_buy', 'habits', 'No impulse buys', 'Nothing bought that wasn\'t planned ahead.', 'coffee'),
    D('hab_coffee_home', 'habits', 'Coffee from home', 'No buying coffee out today.', 'coffee'),
    D('hab_no_social_before_10', 'habits', 'No social media before 10 am', 'Instagram, TikTok and Facebook open only after ten.', 'noPhone'),
    D('hab_read_10', 'habits', 'Read 10 pages', 'Ten pages of a book. Not a screen.', 'book'),
    D('hab_tidy_10', 'habits', '10 minutes of tidying', 'A ten-minute timer and one corner tidied.', 'tools'),
    D('hab_three_good', 'habits', '3 good things', 'Write down three good things that happened today.', 'pencil'),
    D('hab_meditate_10', 'habits', '10 minutes of meditation', 'Ten minutes of breathing practice or meditation.', 'meditate'),
    D('hab_track_spending', 'habits', 'Write down every expense', 'Every penny spent today gets written down.', 'pencil'),
    D('hab_screen_under_2h', 'habits', 'Under two hours of screen time', 'Phone screen time under two hours for the day.', 'noPhone'),
    D('hab_no_online_shopping', 'habits', 'No online shopping', 'No orders on websites or apps today.', 'tools'),
    D('hab_no_insta_bed', 'habits', 'No Instagram in bed', 'No scrolling in bed. No social media and no “one more video”.', 'noPhone'),
    D('hab_zero_cart', 'habits', 'Zero online purchases', 'No orders from any site or app. Not even on sale.', 'coins'),
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
