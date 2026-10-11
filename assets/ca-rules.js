/* ==========================================================
   Compass Arena — страница правил
   ----------------------------------------------------------
   «Хром» страницы + подсветка активного пункта оглавления.
   ========================================================== */
(function (global) {
  'use strict';

  var CA = global.CA = global.CA || {};
  var U = CA.ui;

  function initToc() {
    var links = U.$$('#toc a');
    if (!links.length || !('IntersectionObserver' in global)) return;
    var map = {};
    links.forEach(function (a) {
      var id = (a.getAttribute('href') || '').slice(1);
      if (id) map[id] = a;
    });

    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting || !map[en.target.id]) return;
        links.forEach(function (a) { a.classList.remove('active'); a.removeAttribute('aria-current'); });
        var link = map[en.target.id];
        link.classList.add('active');
        link.setAttribute('aria-current', 'true');
        var box = document.getElementById('toc');
        if (box && global.innerWidth < 821) {
          box.scrollTo({ left: link.offsetLeft - 20, behavior: 'smooth' });
        }
      });
    }, { rootMargin: '-12% 0px -80% 0px' });

    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) spy.observe(el);
    });

    links.forEach(function (a) {
      a.addEventListener('click', function () {
        links.forEach(function (x) { x.classList.remove('active'); x.removeAttribute('aria-current'); });
        a.classList.add('active');
        a.setAttribute('aria-current', 'true');
      });
    });
  }

  function init() {
    U.injectSprite();
    U.initChrome();
    initToc();
    var year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();
  }

  CA.rules = { init: init };
  U.contentReady(init);
})(typeof window !== 'undefined' ? window : globalThis);
