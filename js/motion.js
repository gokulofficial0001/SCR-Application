/* ============================================================
   Motion — subtle, professional polish layer
   ------------------------------------------------------------
   • scroll-reveal: content blocks fade/slide up as they enter
     the viewport, lightly staggered (premium "feel").
   • count-up: dashboard KPI numbers tick up from 0.

   Progressive enhancement + fail-open: if anything errors or
   IntersectionObserver is unavailable, content stays fully
   visible. Reveal classes are removed after the entrance so
   hover/other transitions keep working normally.
   ============================================================ */
const Motion = {
  _io: null,

  // Blocks worth revealing (not tiny/interactive chrome like the filter bar).
  _SELECTOR: [
    '.page-header', '.kpi-card', '.card', '.chart-card', '.table-container',
    '.scr-form-section', '.approval-card', '.empty-state',
    '.quick-action-card', '.activity-feed'
  ].join(', '),

  reveal(root) {
    try {
      if (!root || !('IntersectionObserver' in window)) return; // fail open → visible

      const els = Array.from(root.querySelectorAll(this._SELECTOR))
        .filter(el => !el.classList.contains('mo-reveal'));
      if (!els.length) return;

      if (this._io) this._io.disconnect();
      this._io = new IntersectionObserver((entries, obs) => {
        entries.forEach(e => {
          if (!e.isIntersecting) return;
          const el = e.target;
          el.classList.add('mo-in');
          obs.unobserve(el);
          // hand the element back to normal CSS once the entrance is done
          const delay = parseInt(el.style.getPropertyValue('--mo-delay'), 10) || 0;
          setTimeout(() => {
            el.classList.remove('mo-reveal', 'mo-in');
            el.style.removeProperty('--mo-delay');
          }, 720 + delay);
        });
      }, { threshold: 0.06, rootMargin: '0px 0px -4% 0px' });

      els.forEach((el, i) => {
        el.style.setProperty('--mo-delay', Math.min(i * 55, 340) + 'ms');
        el.classList.add('mo-reveal');
        this._io.observe(el);
      });

      // Safety: reveal anything still hidden, then clean every class off.
      setTimeout(() => els.forEach(el => el.classList.add('mo-in')), 1200);
      setTimeout(() => els.forEach(el => {
        el.classList.remove('mo-reveal', 'mo-in');
        el.style.removeProperty('--mo-delay');
      }), 2200);
    } catch (_) { /* fail open */ }
  },

  countUp(root) {
    try {
      const els = (root || document).querySelectorAll('.kpi-value');
      els.forEach(el => {
        const raw = (el.textContent || '').trim();
        if (!/^\d{1,6}$/.test(raw)) return;             // integers only
        const target = parseInt(raw, 10);
        if (target <= 0) return;
        const dur = 850;
        const ease = t => 1 - Math.pow(1 - t, 3);       // easeOutCubic
        let start = null;
        el.textContent = '0';
        const step = (now) => {
          if (start === null) start = now;
          const p = Math.min((now - start) / dur, 1);
          el.textContent = Math.round(ease(p) * target).toString();
          if (p < 1) requestAnimationFrame(step);
          else el.textContent = raw;                     // restore exact value
        };
        requestAnimationFrame(step);
      });
    } catch (_) { /* leave numbers as-is */ }
  }
};
