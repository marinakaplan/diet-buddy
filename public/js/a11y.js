/* מילה — נגישות ופרטיות בצד הלקוח (a11y.js)
   - תפריט נגישות (אייקון קבוע): הגדלת טקסט, ניגודיות גבוהה, הדגשת קישורים, עצירת אנימציות, גופן קריא, איפוס
   - הודעת עוגיות קצרה (פעם אחת): ״הבנתי״ או ״רק הכרחי״ (מבטל את המונה האנונימי)
   - דילוג לתוכן, סגירת חלונות ב-Escape
   ההעדפות נשמרות במכשיר בלבד (localStorage). */
(function () {
  'use strict';
  const KEY = 'mila.a11y', CONSENT = 'mila.consent';
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const html = document.documentElement;
  let prefs = Object.assign({ text: 0, contrast: false, links: false, still: false, font: false }, get(KEY, {}));

  function apply() {
    html.classList.remove('a11y-text-1', 'a11y-text-2', 'a11y-text-3');
    if (prefs.text) html.classList.add('a11y-text-' + prefs.text);
    html.classList.toggle('a11y-contrast', !!prefs.contrast);
    html.classList.toggle('a11y-links', !!prefs.links);
    html.classList.toggle('a11y-still', !!prefs.still);
    html.classList.toggle('a11y-font', !!prefs.font);
    const b = document.getElementById('a11y-btn'); if (b) b.classList.toggle('on', isActive());
  }
  const isActive = () => !!(prefs.text || prefs.contrast || prefs.links || prefs.still || prefs.font);
  apply(); // לפני שהאפליקציה מציירת, כדי שלא יהיה הבהוב

  const ICON = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="6.6" r="1.4" fill="currentColor" stroke="none"/><path d="M7 9.2l5 1 5-1M12 10.2v4.3M12 14.5l-2.6 4.3M12 14.5l2.6 4.3"/></svg>';

  function panelHtml() {
    const row = (k, label, on) => `<button class="a11y-opt ${on ? 'on' : ''}" role="switch" aria-checked="${!!on}" data-k="${k}"><span>${label}</span><i aria-hidden="true"></i></button>`;
    return `<div class="a11y-head"><h2 id="a11y-title">נגישות</h2><button class="a11y-x" data-act="close" aria-label="סגירת תפריט הנגישות">✕</button></div>
      <div class="a11y-size" role="group" aria-label="גודל טקסט"><span>גודל טקסט</span>
        <div><button data-act="minus" aria-label="הקטנת טקסט">א-</button><b aria-live="polite">${['רגיל', 'גדול', 'גדול מאוד', 'ענק'][prefs.text]}</b><button data-act="plus" aria-label="הגדלת טקסט">א+</button></div></div>
      ${row('contrast', 'ניגודיות גבוהה', prefs.contrast)}
      ${row('links', 'הדגשת קישורים וכפתורים', prefs.links)}
      ${row('still', 'עצירת אנימציות', prefs.still)}
      ${row('font', 'גופן קריא', prefs.font)}
      <button class="a11y-reset" data-act="reset">איפוס הגדרות הנגישות</button>
      <a class="a11y-link" href="/accessibility">הצהרת נגישות</a>`;
  }
  let lastFocus = null;
  function open() {
    let p = document.getElementById('a11y-panel');
    if (!p) { p = document.createElement('div'); p.id = 'a11y-panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'true'); p.setAttribute('aria-labelledby', 'a11y-title'); document.body.appendChild(p); p.addEventListener('click', onClick); }
    lastFocus = document.activeElement;
    p.innerHTML = panelHtml(); p.classList.add('open');
    const f = p.querySelector('button'); if (f) f.focus();
  }
  function close() { const p = document.getElementById('a11y-panel'); if (p) p.classList.remove('open'); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  function onClick(e) {
    const t = e.target.closest('button'); if (!t) return;
    const act = t.dataset.act, k = t.dataset.k;
    if (act === 'close') return close();
    if (act === 'plus') prefs.text = Math.min(3, prefs.text + 1);
    if (act === 'minus') prefs.text = Math.max(0, prefs.text - 1);
    if (act === 'reset') prefs = { text: 0, contrast: false, links: false, still: false, font: false };
    if (k) prefs[k] = !prefs[k];
    set(KEY, prefs); apply();
    const p = document.getElementById('a11y-panel'); const keep = t.dataset.act || ('k:' + k);
    p.innerHTML = panelHtml();
    const again = keep.startsWith('k:') ? p.querySelector(`[data-k="${k}"]`) : p.querySelector(`[data-act="${act}"]`); if (again) again.focus();
  }

  /* ---------- הודעת עוגיות ---------- */
  function cookieNotice() {
    if (get(CONSENT, null)) return;
    const n = document.createElement('div'); n.id = 'cookie-note'; n.setAttribute('role', 'region'); n.setAttribute('aria-label', 'הודעה על עוגיות');
    n.innerHTML = `<p>מילה משתמשת בעוגייה אחת שמשאירה אותך מחוברת, ובמונה אנונימי שסופר כניסות. בלי פרסומות ובלי מעקב. <a href="/privacy">מדיניות פרטיות</a></p>
      <div><button class="ck-ok">הבנתי</button><button class="ck-min">רק הכרחי</button></div>`;
    document.body.appendChild(n);
    n.querySelector('.ck-ok').onclick = () => { set(CONSENT, 'all'); n.remove(); };
    n.querySelector('.ck-min').onclick = () => { set(CONSENT, 'essential'); n.remove(); };
  }

  function init() {
    // דילוג לתוכן
    const skip = document.createElement('a'); skip.href = '#screen'; skip.className = 'skip-link'; skip.textContent = 'דילוג לתוכן';
    skip.onclick = (e) => { e.preventDefault(); const s = document.getElementById('screen'); if (s) { s.setAttribute('tabindex', '-1'); s.focus(); } };
    document.body.prepend(skip);
    // כפתור הנגישות
    const b = document.createElement('button'); b.id = 'a11y-btn'; b.type = 'button'; b.setAttribute('aria-label', 'תפריט נגישות'); b.innerHTML = ICON; b.onclick = open;
    document.body.appendChild(b); apply();
    cookieNotice();
    // Escape סוגר חלונות
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const p = document.getElementById('a11y-panel'); if (p && p.classList.contains('open')) return close();
      if (window.App && document.getElementById('sheet') && document.getElementById('sheet').classList.contains('open')) App.closeSheet();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.MilaA11y = { open, close, consent: () => get(CONSENT, null) };
})();
