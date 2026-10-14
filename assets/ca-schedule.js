/* ==========================================================
   Compass Arena — страница расписания
   ----------------------------------------------------------
   Фильтры-табы с счётчиками, группировка по дням, выделение
   «идёт сейчас» и «следующий», календарь .ics и VOD-ссылки.
   ========================================================== */
(function (global) {
  'use strict';

  var CA = global.CA = global.CA || {};
  var D = CA.data;
  var U = CA.ui;
  var V = CA.views;
  var ic = U.icon;

  var FILTER = 'all';
  var FILTERS = [
    { key: 'all', label: 'Все матчи' },
    { key: 'r1', label: 'Раунд 1' },
    { key: 'semi', label: 'Полуфинал' },
    { key: 'grand', label: 'Гранд-финал' },
    { key: 'done', label: 'Сыгранные' }
  ];
  var TICK = null;

  function stageKey(m) {
    if (m.bracket === 'grand' || m.id === 5) return 'grand';
    if (m.round === 2 || m.id === 4) return 'semi';
    return 'r1';
  }

  function visibleMatches(d) {
    return d.matches.filter(function (m) {
      if (!m.bothKnown && !m.scheduled) return false;
      if (FILTER === 'done') return !!m.winner;
      if (FILTER !== 'all' && stageKey(m) !== FILTER) return false;
      return true;
    }).sort(function (a, b) {
      var ta = a.scheduled || 9e15, tb = b.scheduled || 9e15;
      return ta - tb || a.id - b.id;
    });
  }

  function countFor(d, key) {
    return d.matches.filter(function (m) {
      if (!m.bothKnown && !m.scheduled) return false;
      if (key === 'done') return !!m.winner;
      if (key !== 'all' && stageKey(m) !== key) return false;
      return true;
    }).length;
  }

  function renderFilters(d) {
    var box = document.getElementById('filters');
    if (!box) return;
    box.innerHTML = FILTERS.map(function (f) {
      var n = countFor(d, f.key);
      return '<button class="chip-f' + (FILTER === f.key ? ' active' : '') + '" type="button" role="tab"' +
        ' aria-selected="' + (FILTER === f.key) + '" data-filter="' + f.key + '">' +
        f.label + '<span class="chip-n">' + n + '</span></button>';
    }).join('');
  }

  /* ---------- Карточка «сейчас / следом» ---------- */
  function renderNextCard(d) {
    var box = document.getElementById('nextCard');
    if (!box) return;
    var m = d.liveMatch || d.nextMatch;
    if (!m) {
      box.innerHTML = '<div class="next-card is-empty">' +
        '<div class="nc-left"><p class="kicker">Расписание</p>' +
        '<div class="nc-teams dim">Время матчей ещё не объявлено</div>' +
        '<div class="nc-meta">Следите за анонсами в Telegram — как только организаторы назначат время, матчи появятся здесь.</div></div>' +
        '<div class="nc-right"><a class="btn btn-ghost" href="https://t.me/compassarenaa" target="_blank" rel="noopener">' + ic('telegram') + 'Telegram</a></div>' +
        '</div>';
      return;
    }
    var isLive = m.state === 'live';
    var a = D.slotLabel(m, 1).text, b = D.slotLabel(m, 2).text;
    var has = m.score1 != null && m.score2 != null;
    box.innerHTML = '<div class="next-card' + (isLive ? ' is-live' : '') + '">' +
      '<div class="nc-left">' +
        '<p class="kicker">' + (isLive ? '<span class="dot-live"></span> Идёт прямо сейчас' : ic('clock') + ' Следующий матч') + '</p>' +
        '<div class="nc-teams">' + D.esc(a) +
          (has ? ' <span class="sc">' + D.esc(m.score1) + ':' + D.esc(m.score2) + '</span> ' : ' <span class="vs">против</span> ') +
          D.esc(b) + '</div>' +
        '<div class="nc-meta">' + D.esc(D.stageLabel(m)) +
          (m.scheduled ? ' · ' + D.esc(D.fmtDateTime(m.scheduled)) : ' · время уточняется') +
          (D.localTime(m.scheduled) ? ' · у вас ' + D.esc(D.localTime(m.scheduled)) : '') + '</div>' +
      '</div>' +
      '<div class="nc-right">' +
        '<div class="nc-count" id="ncCount"></div>' +
        (isLive
          ? '<a class="btn btn-live" href="https://www.twitch.tv/compassarena" target="_blank" rel="noopener">' + ic('live') + 'Смотреть</a>'
          : (V.actions(d, m, {}) || '<a class="btn btn-ghost" href="/#bracket">' + ic('bracket') + 'Сетка</a>')) +
      '</div>' +
      '</div>';
    tickCard();
  }

  function tickCard() {
    var box = document.getElementById('ncCount');
    if (!box) return;
    var d = D.get();
    var m = d.liveMatch || d.nextMatch;
    if (!m) { box.innerHTML = ''; return; }
    if (m.state === 'live') {
      box.innerHTML = '<b class="live-num">LIVE</b><small>матч идёт</small>';
      return;
    }
    if (!m.scheduled) { box.innerHTML = ''; return; }
    var diff = m.scheduled - Date.now();
    if (diff <= 0) { box.innerHTML = '<b>Скоро</b><small>матч вот-вот начнётся</small>'; return; }
    var days = Math.floor(diff / 86400000);
    var h = Math.floor((diff % 86400000) / 3600000);
    var mi = Math.floor((diff % 3600000) / 60000);
    var s = Math.floor((diff % 60000) / 1000);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var txt = (days > 0 ? days + 'д ' : '') + pad(h) + ':' + pad(mi) + ':' + pad(s);
    box.innerHTML = '<b>' + txt + '</b><small>до начала</small>';
  }

  /* ---------- Список матчей ---------- */
  function renderList(d) {
    var box = document.getElementById('scheduleList');
    if (!box) return;
    var list = visibleMatches(d);
    if (!list.length) {
      box.innerHTML = '<div class="s-empty">По этому фильтру матчей нет</div>';
      return;
    }

    var groups = [], index = {};
    list.forEach(function (m) {
      var key = m.scheduled ? D.fmtDayKey(m.scheduled) : 'Дата уточняется';
      if (!(key in index)) { index[key] = groups.length; groups.push({ key: key, items: [] }); }
      groups[index[key]].items.push(m);
    });

    box.innerHTML = groups.map(function (g) {
      var title = g.key === 'Дата уточняется' ? g.key : (g.key.charAt(0).toUpperCase() + g.key.slice(1));
      var label = g.items.length + ' ' + D.plural(g.items.length, 'матч', 'матча', 'матчей');
      return '<section class="day">' +
        '<h2 class="day-title">' + D.esc(title) + '<small>' + label + '</small></h2>' +
        V.scheduleRows(d, g.items, { date: false }) +
        '</section>';
    }).join('');
  }

  function renderTzNote() {
    var el = document.getElementById('tzNote');
    if (!el) return;
    el.textContent = D.isMoscow()
      ? ''
      : ' Рядом с каждым матчем — ваше местное время.';
  }

  function render(d) {
    document.body.setAttribute('data-phase', d.phase);
    renderFilters(d);
    renderNextCard(d);
    renderList(d);
    renderTzNote();
    var played = d.stats.played, total = d.stats.matchesTotal || 1;
    U.setProgress(d.phase === 'post' ? 1 : played / total);
  }

  /* ---------- URL-состояние фильтра ---------- */
  function filterFromUrl() {
    try {
      var f = new URLSearchParams(location.search).get('f');
      if (f && FILTERS.some(function (x) { return x.key === f; })) return f;
    } catch (e) {}
    return 'all';
  }
  function pushFilter(key) {
    try {
      var url = new URL(location.href);
      if (key === 'all') url.searchParams.delete('f');
      else url.searchParams.set('f', key);
      history.replaceState(null, '', url.pathname + (url.search || '') + location.hash);
    } catch (e) {}
  }

  function init() {
    U.injectSprite();
    U.initChrome();
    FILTER = filterFromUrl();

    var filters = document.getElementById('filters');
    if (filters) {
      filters.addEventListener('click', function (e) {
        var btn = e.target.closest('.chip-f');
        if (!btn) return;
        FILTER = btn.getAttribute('data-filter');
        pushFilter(FILTER);
        render(D.get());
        U.observeReveals();
      });
      filters.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var items = U.$$('.chip-f', filters);
        var i = items.indexOf(document.activeElement);
        if (i < 0) return;
        e.preventDefault();
        var next = items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
        next.focus();
        next.click();
      });
    }

    D.load().then(function (d) {
      render(d);
      U.observeReveals();
    });

    var queued = false;
    D.onChange(function () {
      if (queued) return;
      queued = true;
      global.requestAnimationFrame(function () { queued = false; render(D.get()); });
    });

    if (TICK) clearInterval(TICK);
    TICK = setInterval(tickCard, 1000);
  }

  CA.schedule = { init: init, render: render };
  U.contentReady(init);
})(typeof window !== 'undefined' ? window : globalThis);
