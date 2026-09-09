/* VissRad — site behaviour: theme, header, drawer, reveal, contact form */
(function () {
  'use strict';

  /* ---------- Theme ---------- */
  var root = document.documentElement;
  var toggle = document.querySelector('[data-theme-toggle]');
  var STORE_KEY = 'vissrad-theme';

  /* Dark is the brand default. The operating system preference is deliberately
     ignored; only an explicit choice by the visitor overrides dark. */
  function storedTheme() {
    try {
      var v = window.localStorage.getItem(STORE_KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) {
      return null; /* storage blocked (private mode, sandboxed frame) */
    }
  }

  function rememberTheme(m) {
    try {
      window.localStorage.setItem(STORE_KEY, m);
    } catch (e) {
      /* non-fatal: theme still applies for this page view */
    }
  }

  var mode = storedTheme() || 'dark';

  var SUN =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4"/></svg>';
  var MOON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20.5 14.2A8.6 8.6 0 1 1 10.4 3.3a6.9 6.9 0 0 0 10.1 10.9z"/></svg>';

  function applyTheme(m) {
    root.setAttribute('data-theme', m);
    if (toggle) {
      toggle.innerHTML = m === 'dark' ? SUN : MOON;
      toggle.setAttribute('aria-label', 'Switch to ' + (m === 'dark' ? 'light' : 'dark') + ' mode');
    }
  }
  applyTheme(mode);
  if (toggle) {
    toggle.addEventListener('click', function () {
      mode = mode === 'dark' ? 'light' : 'dark';
      rememberTheme(mode);
      applyTheme(mode);
    });
  }

  /* ---------- Header shadow on scroll ---------- */
  var header = document.querySelector('.header');
  function onScroll() {
    if (!header) return;
    header.classList.toggle('header--scrolled', window.scrollY > 8);
  }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Mobile drawer ---------- */
  var burger = document.querySelector('[data-burger]');
  var drawer = document.querySelector('[data-drawer]');
  if (burger && drawer) {
    burger.addEventListener('click', function () {
      var open = drawer.getAttribute('data-open') === 'true';
      drawer.setAttribute('data-open', open ? 'false' : 'true');
      burger.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
    drawer.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        drawer.setAttribute('data-open', 'false');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- Reveal on scroll ---------- */
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && items.length) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add('is-in');
            io.unobserve(en.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    items.forEach(function (el, i) {
      el.style.transitionDelay = Math.min(i % 4, 3) * 70 + 'ms';
      io.observe(el);
    });
  } else {
    items.forEach(function (el) {
      el.classList.add('is-in');
    });
  }

  /* ---------- Contact form → email ---------- */
  var form = document.querySelector('[data-contact-form]');
  if (form) {
    var status = form.querySelector('[data-form-status]');
    var btn = form.querySelector('button[type="submit"]');
    var subjectField = form.querySelector('input[name="_subject"]');

    form.addEventListener('submit', function () {
      // Native submission proceeds; we only enrich the subject line and
      // show progress. The browser handles validation via `required`.
      var data = new FormData(form);
      var get = function (k) { return (data.get(k) || '').toString().trim(); };

      if (subjectField) {
        subjectField.value = 'VissRad enquiry' + ' \u2014 ' +
          (get('company') || get('name') || 'website');
      }
      if (status) {
        status.textContent = 'Sending\u2026';
        status.setAttribute('data-state', 'busy');
      }
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending\u2026';
      }
    });
  }
})();
