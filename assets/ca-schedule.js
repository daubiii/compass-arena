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

  var G = CA.games;
  var FILTER = 'all';
  var GAME_FILTER = 'all';           /* 'all' или id дисциплины */
  var ALL = null;                    /* { games: {id: D}, history } */
  var NEXT = null;                   /* ближайший/идущий матч среди всех игр */
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

  function allMatches() {
    var out = [];
    if (!ALL) return out;
    G.ids.forEach(function (id) {
      if (GAME_FILTER !== 'all' && GAME_FILTER !== id) return;
      var ds = ALL.games[id];
      if (ds) ds.matches.forEach(function (m) { out.push(m); });
    });
    return out;
  }

  function passes(m, key) {
    if (!m.bothKnown && !m.scheduled) return false;
    if (key === 'done') return !!m.winner;
    if (key !== 'all' && stageKey(m) !== key) return false;
    return true;
  }

  function visibleMatches() {
    return allMatches().filter(function (m) { return passes(m, FILTER); }).sort(function (a, b) {
      var ta = a.scheduled || 9e15, tb = b.scheduled || 9e15;
      return ta - tb || a.id - b.id || String(a.__game).localeCompare(String(b.__game));
    });
  }

  function countFor(key) {
    return allMatches().filter(function (m) { return passes(m, key); }).length;
  }

  /** Сколько матчей у дисциплины (для счётчика на табе игры) */
  function gameCount(id) {
    var ds = ALL && ALL.games[id];
    return ds ? ds.matches.filter(function (m) { return passes(m, 'all'); }).length : 0;
  }

  /** Ближайший идущий или предстоящий матч среди всех игр */
  function pickNext() {
    var best = null;
    G.ids.forEach(function (id) {
      var ds = ALL && ALL.games[id];
      if (!ds || ds.empty) return;
      var m = ds.liveMatch || ds.nextMatch;
      if (!m) return;
      var score = (m.state === 'live' ? -1e15 : 0) + (m.scheduled || 9e14);
      if (!best || score < best.score) best = { m: m, score: score };
    });
    return best ? best.m : null;
  }

  function renderGameFilters() {
    var box = document.getElementById('gameFilters');
    if (!box) return;
    var items = [{ id: 'all', name: 'Все игры' }].concat(G.list.map(function (g) { return { id: g.id, name: g.short }; }));
    box.innerHTML = items.map(function (it) {
      var on = GAME_FILTER === it.id;
      var glyph = it.id === 'all' ? '' : G.glyph(it.id);
      var count = it.id === 'all'
        ? G.ids.reduce(function (n, id) { return n + gameCount(id); }, 0)
        : gameCount(it.id);
      return '<button class="game-tab sm' + (on ? ' is-on' : '') + '" type="button" role="tab" aria-selected="' + on +
        '" data-gamefilter="' + it.id + '"' + (it.id === 'all' ? '' : ' style="--gc:' + G.get(it.id).theme.accent + '"') + '>' +
        glyph + '<span class="gt-name">' + it.name + '</span><span class="gt-size">' + count + '</span></button>';
    }).join('');
  }

  function renderFilters() {
    var box = document.getElementById('filters');
    if (!box) return;
    box.innerHTML = FILTERS.map(function (f) {
      var n = countFor(f.key);
      return '<button class="chip-f' + (FILTER === f.key ? ' active' : '') + '" type="button" role="tab"' +
        ' aria-selected="' + (FILTER === f.key) + '" data-filter="' + f.key + '">' +
        f.label + '<span class="chip-n">' + n + '</span></button>';
    }).join('');
  }

  /* ---------- Карточка «сейчас / следом» ---------- */
  function renderNextCard() {
    var box = document.getElementById('nextCard');
    if (!box) return;
    var m = NEXT;
    var d = m && m.__d ? m.__d : D.get();
    if (m && m.__d) { var mm = m; return D.using(m.__d, function () { renderNextIn(box, mm, d); }); }
    if (!m) {
      box.innerHTML = '<div class="next-card is-empty">' +
        '<div class="nc-left"><p class="kicker">Расписание</p>' +
        '<div class="nc-teams dim">Время матчей ещё не объявлено</div>' +
        '<div class="nc-meta">Следите за анонсами в Telegram — как только организаторы назначат время, матчи появятся здесь.</div></div>' +
        '<div class="nc-right"><a class="btn btn-ghost" href="https://t.me/compassarenaa" target="_blank" rel="noopener">' + ic('telegram') + 'Telegram</a></div>' +
        '</div>';
      return;
    }
    renderNextIn(box, m, d);
  }

  function renderNextIn(box, m, d) {
    var isLive = m.state === 'live';
    var a = D.slotLabel(m, 1).text, b = D.slotLabel(m, 2).text;
    var has = m.score1 != null && m.score2 != null;
    var gameName = m.__game ? G.get(m.__game).name : '';
    box.innerHTML = '<div class="next-card' + (isLive ? ' is-live' : '') + '">' +
      '<div class="nc-left">' +
        '<p class="kicker">' + (isLive ? '<span class="dot-live"></span> Идёт прямо сейчас' : ic('clock') + ' Следующий матч') + (gameName ? ' · ' + D.esc(gameName) : '') + '</p>' +
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
    var m = NEXT;
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
  function renderList() {
    var box = document.getElementById('scheduleList');
    if (!box) return;
    var list = visibleMatches();
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
        V.scheduleRows(null, g.items, { date: false, games: true }) +
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

  function render() {
    NEXT = pickNext();
    var live = !!(NEXT && NEXT.state === 'live');
    var played = 0, total = 0;
    G.ids.forEach(function (id) { var ds = ALL && ALL.games[id]; if (ds && !ds.empty) { played += ds.stats.played; total += ds.stats.matchesTotal; } });
    document.body.setAttribute('data-phase', live ? 'live' : (played && played >= total ? 'post' : 'pre'));
    /* Тема страницы: у выбранной игры — её цвета, иначе фирменные (Dota 2) */
    G.applyTheme(GAME_FILTER === 'all' ? G.DEFAULT : GAME_FILTER);
    renderGameFilters();
    renderFilters();
    renderNextCard();
    renderList();
    renderTzNote();
    U.setProgress(total ? played / total : 0);
  }

  /* ---------- URL-состояние фильтра ---------- */
  function filterFromUrl() {
    try {
      var f = new URLSearchParams(location.search).get('f');
      if (f && FILTERS.some(function (x) { return x.key === f; })) return f;
    } catch (e) {}
    return 'all';
  }
  function gameFromUrl() {
    try {
      var g = new URLSearchParams(location.search).get('g') || new URLSearchParams(location.search).get('game');
      if (g && G.isGame(g)) return g;
    } catch (e) {}
    return 'all';
  }
  function pushGame(id) {
    try {
      var url = new URL(location.href);
      if (id === 'all') url.searchParams.delete('g');
      else url.searchParams.set('g', id);
      history.replaceState(null, '', url.pathname + (url.search || '') + location.hash);
    } catch (e) {}
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
    GAME_FILTER = gameFromUrl();

    var filters = document.getElementById('filters');
    if (filters) {
      filters.addEventListener('click', function (e) {
        var btn = e.target.closest('.chip-f');
        if (!btn) return;
        FILTER = btn.getAttribute('data-filter');
        pushFilter(FILTER);
        render();
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

    var gf = document.getElementById('gameFilters');
    if (gf) {
      gf.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-gamefilter]');
        if (!btn) return;
        GAME_FILTER = btn.getAttribute('data-gamefilter');
        pushGame(GAME_FILTER);
        render();
        U.observeReveals();
      });
    }

    function refresh() {
      return D.loadAll().then(function (all) {
        ALL = all;
        render();
        U.observeReveals();
      });
    }
    refresh();

    if (TICK) clearInterval(TICK);
    TICK = setInterval(tickCard, 1000);
    setInterval(refresh, 60000);
  }

  CA.schedule = { init: init, render: render, setData: function (all) { ALL = all; render(); } };
  U.contentReady(init);
})(typeof window !== 'undefined' ? window : globalThis);
