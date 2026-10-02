/* Compass Arena — общее поведение для внутренних страниц (расписание, правила) */
(function () {
  var head = document.getElementById('head');
  var top = document.getElementById('toTop');
  var burger = document.getElementById('burgerBtn');
  var menu = document.getElementById('menuPanel');

  function onScroll() {
    if (head) head.classList.toggle('solid', window.scrollY > 24);
    if (top) top.classList.toggle('visible', window.scrollY > 700);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if (top) top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });

  function toggleMenu(force) {
    if (!burger || !menu) return;
    var willOpen = (typeof force === 'boolean') ? force : !menu.classList.contains('open');
    burger.classList.toggle('open', willOpen);
    menu.classList.toggle('open', willOpen);
    burger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    document.body.style.overflow = willOpen ? 'hidden' : '';
  }
  if (burger) burger.addEventListener('click', function () { toggleMenu(); });
  if (menu) menu.addEventListener('click', function (e) { if (e.target.closest('a')) toggleMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') toggleMenu(false); });

  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: .12 });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('in'); });
  }
})();
