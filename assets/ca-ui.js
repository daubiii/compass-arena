/* ==========================================================
   Compass Arena — UI-кит
   ----------------------------------------------------------
   Спрайт иконок, «хром» страницы (шапка, меню, наверх),
   диалоги с ловушкой фокуса, залипающие баннеры, тосты,
   появление блоков при прокрутке.
   ========================================================== */
(function (global) {
  'use strict';

  var CA = global.CA = global.CA || {};
  var doc = global.document;

  /* ==========================================================
     Иконки
     ========================================================== */
  var SPRITE = [
    '<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false">',
    '<symbol id="i-compass" viewBox="0 0 100 100" fill="none" stroke="currentColor">',
    '<circle cx="50" cy="50" r="46.5" stroke-width="1" opacity=".55"/>',
    '<circle cx="50" cy="50" r="37" stroke-width=".7" opacity=".35"/>',
    '<g stroke-width="1" opacity=".5"><path d="M50 3.5v9M50 87.5v9M3.5 50h9M87.5 50h9"/>',
    '<path d="M17 17l6 6M77 77l6 6M83 17l-6 6M23 77l-6 6" opacity=".6"/></g>',
    '<path d="M50 12 56.5 45 50 50 43.5 45Z" fill="currentColor" stroke="none"/>',
    '<path d="M50 88 43.5 55 50 50 56.5 55Z" fill="currentColor" stroke="none" opacity=".4"/>',
    '<path d="M12 50 45 43.5 50 50 45 56.5Z" fill="currentColor" stroke="none" opacity=".4"/>',
    '<path d="M88 50 55 56.5 50 50 55 43.5Z" fill="currentColor" stroke="none" opacity=".4"/>',
    '<circle cx="50" cy="50" r="3.2" stroke-width="1.2"/></symbol>',

    '<symbol id="i-trophy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">',
    '<path d="M7 3.5h10V9a5 5 0 0 1-10 0V3.5Z"/><path d="M7 5H4.4v1.6A3.6 3.6 0 0 0 8 10.2M17 5h2.6v1.6A3.6 3.6 0 0 1 16 10.2"/>',
    '<path d="M12 14v3.2M9.4 20.5h5.2l-.6-3.3H10l-.6 3.3Z"/></symbol>',

    '<symbol id="i-live" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">',
    '<circle cx="12" cy="12" r="3.1" fill="currentColor" stroke="none"/>',
    '<path d="M6.6 6.6a7.6 7.6 0 0 0 0 10.8M17.4 6.6a7.6 7.6 0 0 1 0 10.8"/>',
    '<path d="M3.7 3.7a11.7 11.7 0 0 0 0 16.6M20.3 3.7a11.7 11.7 0 0 1 0 16.6" opacity=".4"/></symbol>',

    '<symbol id="i-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">',
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/></symbol>',

    '<symbol id="i-calendar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">',
    '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.8h17M8 3.5v3M16 3.5v3"/>',
    '<path d="M7.5 13.5h3M7.5 17h6" opacity=".55"/></symbol>',

    '<symbol id="i-bracket" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">',
    '<rect x="2.5" y="3.5" width="6.5" height="5" rx="1.5"/><rect x="2.5" y="15.5" width="6.5" height="5" rx="1.5"/>',
    '<rect x="15" y="9.5" width="6.5" height="5" rx="1.5"/><path d="M9 6h3.2v6h2.8M9 18h3.2v-6"/></symbol>',

    '<symbol id="i-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.3v13.4L19 12z"/></symbol>',

    '<symbol id="i-twitch" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">',
    '<path d="M3.5 3.5h17V14l-3.6 3.6h-3.7L10.4 20.4H8.6v-2.8H3.5z"/><path d="M11 8v4M15.5 8v4"/></symbol>',

    '<symbol id="i-telegram" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">',
    '<path d="M21.4 4.2 2.8 11.4l4.9 1.7 1.9 5.6 2.7-3.3 4.6 3.4z"/><path d="M7.7 13.1 21.4 4.2"/></symbol>',

    '<symbol id="i-external" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">',
    '<path d="M14 4h6v6M20 4l-8.6 8.6"/><path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h4.5"/></symbol>',

    '<symbol id="i-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">',
    '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 5.5v-1a1 1 0 0 0-1-1h-10a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1"/></symbol>',

    '<symbol id="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"/></symbol>',
    '<symbol id="i-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/></symbol>',
    '<symbol id="i-arrow-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></symbol>',
    '<symbol id="i-arrow-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V4.5M5.5 11 12 4.5 18.5 11"/></symbol>',
    '<symbol id="i-chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 9l6.5 6.5L18.5 9"/></symbol>',
    '<symbol id="i-chevron-left" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4.5 7.5 12l7.5 7.5"/></symbol>',
    '<symbol id="i-chevron-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4.5 16.5 12 9 19.5"/></symbol>',

    '<symbol id="i-photo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">',
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l4.5-4.5 4 4 3-2.5L20 18"/></symbol>',

    '<symbol id="i-star" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.8l6.1-.9z"/></symbol>',

    '<symbol id="i-mvp" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">',
    '<circle cx="12" cy="12" r="9"/><path d="M12 6.6l1.7 3.5 3.8.5-2.8 2.7.7 3.8-3.4-1.8-3.4 1.8.7-3.8L6.5 10.6l3.8-.5z" fill="currentColor" stroke="none"/></symbol>',

    '<symbol id="i-shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2l8 2.9v6c0 4.9-3.4 8.1-8 9.5-4.6-1.4-8-4.6-8-9.5v-6z"/><path d="M8.6 12.2l2.4 2.4 4.4-4.6"/></symbol>',

    '<symbol id="i-swords" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">',
    '<path d="M4 4h3l9.5 9.5M20 4h-3L7.5 13.5"/><path d="M14.5 15.5 17 18M9.5 15.5 7 18M4 20l3.5-3.5M20 20l-3.5-3.5"/></symbol>',

    '<symbol id="i-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none"/></symbol>',
    '<symbol id="i-alert" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.8 21 19.5H3z"/><path d="M12 9.5v4.2"/><circle cx="12" cy="16.6" r=".9" fill="currentColor" stroke="none"/></symbol>',

    '<symbol id="i-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15"/></symbol>',
    '<symbol id="i-share" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="5.6" r="2.6"/><circle cx="18" cy="18.4" r="2.6"/><path d="M8.4 10.8l7.2-3.9M8.4 13.2l7.2 3.9"/></symbol>',
    '<symbol id="i-users" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9.5" cy="8.5" r="3.2"/><path d="M3.8 19.5c.7-3.4 3-5.2 5.7-5.2s5 1.8 5.7 5.2"/><path d="M16.2 6.1a3 3 0 0 1 0 5.6M17 14.6c2 .5 3.4 2.2 3.8 4.9" opacity=".6"/></symbol>',
    '<symbol id="i-tv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.8" y="4.5" width="18.4" height="12.5" rx="2.4"/><path d="M8.5 20.5h7M12 17v3.5"/></symbol>',
    '<symbol id="i-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 20.5V4M5.5 5.5h11l-2.2 3.4 2.2 3.4h-11"/></symbol>',
    '<symbol id="i-list" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01"/></symbol>'
  ].join('') + '</svg>';

  function injectSprite() {
    if (!doc || doc.getElementById('ca-sprite')) return;
    var holder = doc.createElement('div');
    holder.id = 'ca-sprite';
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    holder.innerHTML = SPRITE;
    doc.body.insertBefore(holder, doc.body.firstChild);
  }

  function icon(name, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false"><use href="#i-' + name + '"></use></svg>';
  }

  /* ==========================================================
     Мелкие помощники
     ========================================================== */
  function $(sel, root) { return (root || doc).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }
  function on(el, ev, fn, opt) { if (el) el.addEventListener(ev, fn, opt); }
  function ready(fn) {
    if (!doc) return;
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  function setHtml(el, html) { if (el) el.innerHTML = html; }
  function setText(el, text) { if (el) el.textContent = text; }

  var TOAST = null;
  function toast(msg, ms) {
    if (!doc) return;
    if (!TOAST) {
      TOAST = doc.createElement('div');
      TOAST.className = 'ca-toast';
      TOAST.setAttribute('role', 'status');
      TOAST.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translate(-50%,14px);z-index:400;' +
        'padding:11px 20px;border-radius:999px;background:rgba(14,17,22,.96);border:1px solid rgba(201,163,90,.5);' +
        'font-size:14px;color:#ece9e1;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;' +
        'backdrop-filter:blur(8px);max-width:calc(100vw - 32px);text-align:center';
      doc.body.appendChild(TOAST);
    }
    TOAST.textContent = msg;
    TOAST.style.opacity = '1';
    TOAST.style.transform = 'translate(-50%,0)';
    clearTimeout(TOAST._t);
    TOAST._t = setTimeout(function () {
      TOAST.style.opacity = '0';
      TOAST.style.transform = 'translate(-50%,14px)';
    }, ms || 2200);
  }

  /* Копирование ссылки / системный «поделиться» */
  function share(title, url) {
    url = url || location.href;
    if (global.navigator && global.navigator.share) {
      global.navigator.share({ title: title, url: url }).catch(function () {});
      return;
    }
    var done = function () { toast('Ссылка скопирована'); };
    if (global.navigator && global.navigator.clipboard) {
      global.navigator.clipboard.writeText(url).then(done, function () { toast(url); });
      return;
    }
    toast(url);
  }

  /* ==========================================================
     Диалоги
     ========================================================== */
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
  var openDialogs = [];

  function dialog(el, opts) {
    if (!el || el._caDialog) return el && el._caDialog;
    opts = opts || {};
    var lastFocus = null;

    function close() {
      el.classList.remove('visible');
      el.classList.remove('active');
      el.setAttribute('aria-hidden', 'true');
      var i = openDialogs.indexOf(api);
      if (i >= 0) openDialogs.splice(i, 1);
      if (!openDialogs.length) doc.body.style.overflow = '';
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function open(trigger) {
      lastFocus = trigger || doc.activeElement;
      el.classList.add('active');
      el.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(function () { el.classList.add('visible'); });
      openDialogs.push(api);
      doc.body.style.overflow = 'hidden';
      var first = el.querySelector('[data-autofocus]') || $$(FOCUSABLE, el)[0];
      if (first) setTimeout(function () { first.focus(); }, 60);
    }
    function isOpen() { return el.classList.contains('active'); }

    var api = { el: el, open: open, close: close, isOpen: isOpen, toggle: function () { isOpen() ? close() : open(); } };
    el._caDialog = api;

    on(el.querySelector('[data-dialog-close]'), 'click', close);
    on(el, 'click', function (e) { if (e.target === el) close(); });
    on(doc, 'keydown', function (e) {
      if (!isOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var items = $$(FOCUSABLE, el).filter(function (n) { return n.offsetParent !== null; });
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    return api;
  }

  /* ==========================================================
     Залипающие блоки (закрыл — больше не показываем)
     ========================================================== */
  function storageKey(k) { return 'ca_dismiss_' + k; }
  function isDismissed(key) {
    try { return localStorage.getItem(storageKey(key)) === '1'; } catch (e) { return false; }
  }
  function dismiss(key, el) {
    try { localStorage.setItem(storageKey(key), '1'); } catch (e) {}
    if (el) {
      el.classList.remove('visible');
      el.setAttribute('hidden', 'hidden');
    }
  }

  /* ==========================================================
     Появление блоков
     ========================================================== */
  var io = null;
  function observeReveals(root) {
    var nodes = $$('.reveal', root || doc);
    if (!('IntersectionObserver' in global)) {
      nodes.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    if (!io) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
        });
        /* порог 0 — для блоков выше экрана: у них доля пересечения может
           никогда не дойти до 0.12, и они остались бы невидимыми */
      }, { threshold: [0, .12], rootMargin: '0px 0px -8% 0px' });
    }
    nodes.forEach(function (el) { if (!el.classList.contains('in')) io.observe(el); });
  }

  /* ==========================================================
     Прогресс турнира
     ========================================================== */
  function setProgress(fraction) {
    var bar = doc.getElementById('headProgress');
    if (!bar) return;
    var p = Math.max(0, Math.min(1, isFinite(fraction) ? fraction : 0));
    bar.style.setProperty('--p', p.toFixed(4));
    bar.parentNode.setAttribute('aria-valuenow', Math.round(p * 100));
  }

  /* ==========================================================
     Хром страницы
     ========================================================== */
  function initChrome() {
    var head = doc.getElementById('head');
    var top = doc.getElementById('toTop');
    var burger = doc.getElementById('burgerBtn');
    var menu = doc.getElementById('menuPanel');

    function onScroll() {
      if (head) head.classList.toggle('solid', global.scrollY > 24);
      if (top) top.classList.toggle('visible', global.scrollY > 700);
    }
    on(global, 'scroll', onScroll, { passive: true });
    onScroll();
    on(top, 'click', function () { global.scrollTo({ top: 0, behavior: 'smooth' }); });

    function toggleMenu(force) {
      if (!burger || !menu) return;
      var willOpen = typeof force === 'boolean' ? force : !menu.classList.contains('open');
      burger.classList.toggle('open', willOpen);
      menu.classList.toggle('open', willOpen);
      burger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      menu.setAttribute('aria-hidden', willOpen ? 'false' : 'true');
      doc.body.style.overflow = willOpen ? 'hidden' : '';
    }
    on(burger, 'click', function () { toggleMenu(); });
    on(menu, 'click', function (e) { if (e.target.closest('a')) toggleMenu(false); });
    on(doc, 'keydown', function (e) { if (e.key === 'Escape') toggleMenu(false); });
    toggleMenu(false);

    observeReveals();
  }

  function contentReady(fn) { ready(fn); }

  CA.ui = {
    icon: icon,
    injectSprite: injectSprite,
    $: $, $$: $$, on: on, ready: ready,
    setHtml: setHtml, setText: setText,
    toast: toast,
    share: share,
    dialog: dialog,
    observeReveals: observeReveals,
    isDismissed: isDismissed,
    dismiss: dismiss,
    setProgress: setProgress,
    initChrome: initChrome,
    contentReady: contentReady
  };
})(typeof window !== 'undefined' ? window : globalThis);
