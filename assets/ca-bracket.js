/* ==========================================================
   Compass Arena — компонент турнирной сетки
   ----------------------------------------------------------
   Раскладка — на CSS Grid (полушаги), соединительные линии —
   SVG по реальным координатам карточек (ResizeObserver).
   На узких экранах сетка превращается в вертикальную ленту.
   ========================================================== */
(function (global) {
  'use strict';

  var CA = global.CA = global.CA || {};
  var D = CA.data;

  var LAYOUT = {
    1: { col: 1, rowStart: 2, rowEnd: 4 },
    2: { col: 1, rowStart: 4, rowEnd: 6 },
    3: { col: 1, rowStart: 6, rowEnd: 8 },
    4: { col: 2, rowStart: 2, rowEnd: 6 },
    5: { col: 3, rowStart: 3, rowEnd: 8 }
  };
  var COLUMNS = [
    { col: 1, label: 'Раунд 1' },
    { col: 2, label: 'Полуфинал' },
    { col: 3, label: 'Гранд-финал' }
  ];

  function esc(s) { return D.esc(s); }
  function ic(name, cls) { return CA.ui.icon(name, cls); }

  /* ---------- Позиция карточки в сетке ---------- */
  function gridArea(matchId) {
    var l = LAYOUT[matchId];
    if (!l) return '';
    return l.rowStart + ' / ' + l.col + ' / ' + l.rowEnd + ' / ' + (l.col + 1);
  }
  function columnOf(matchId) {
    var l = LAYOUT[matchId];
    if (l) return l.col;
    var m = D.match(matchId);
    if (!m) return 1;
    if (m.bracket === 'grand') return 3;
    if (m.round >= 2) return 2;
    return 1;
  }

  /* ---------- Карточка матча ---------- */
  function statusHtml(m, phase) {
    if (m.state === 'live') {
      return '<span class="st st-live"><span class="dot-live"></span>В эфире</span>';
    }
    if (m.winner) {
      var score = (m.score1 != null && m.score2 != null) ? m.score1 + ' : ' + m.score2 : '';
      return '<span class="st st-done">' + ic('check') + (score ? esc(score) : 'Сыгран') + '</span>';
    }
    var when = m.scheduled ? D.fmtShort(m.scheduled) : '';
    if (m.isNext && when) return '<span class="st st-next">' + ic('clock') + esc(when) + '</span>';
    if (when) return '<span class="st">' + esc(when) + '</span>';
    return '<span class="st st-flag">Время уточняется</span>';
  }

  function slotHtml(m, slot) {
    var info = D.slotLabel(m, slot);
    var score = slot === 1 ? m.score1 : m.score2;
    var hasScore = m.score1 != null && m.score2 != null;
    var teamId = slot === 1 ? m.team1 : m.team2;

    if (!info.known) {
      return '<div class="slot is-tbd" data-slot="' + slot + '">' +
        '<span class="slot-seed"></span>' +
        '<span class="slot-name">' + esc(info.text) + '</span>' +
        '<span class="slot-side"></span></div>';
    }

    var cls = 'slot is-clickable';
    if (m.winner) cls += (m.winner === teamId) ? ' is-winner' : ' is-loser';

    var html = '<div class="' + cls + '" data-team="' + teamId + '" data-slot="' + slot + '" role="button" tabindex="0"' +
      ' aria-label="' + esc(info.text) + ' — состав команды">' +
      '<span class="slot-seed">' + teamId + '</span>' +
      '<span class="slot-name">' + esc(info.text) + '</span>' +
      '<span class="slot-side">' +
      (hasScore ? '<span class="slot-score">' + esc(score) + '</span>' : '') +
      '<span class="slot-info" aria-hidden="true">i</span>' +
      '</span></div>';
    return html;
  }

  function matchHtml(m) {
    if (!m) return '';
    var cls = 'match m' + m.id;
    if (m.state === 'done') cls += ' is-done';
    if (m.state === 'live') cls += ' is-live';
    if (m.state === 'upcoming' && !m.isNext && m.bothKnown) cls += ' is-upcoming';
    if (m.isNext) cls += ' is-next';
    if (m.bracket === 'grand') cls += ' is-grand';
    if (m.bracket === 'grand' && m.winner) cls += ' is-champion';

    var head = '<div class="match-head">' +
      '<span class="m-id">M' + m.id + ' · ' + esc(D.stageLabel(m)) + '</span>' +
      statusHtml(m) +
      '</div>';

    var vod = '';
    if (m.vod && m.state === 'done') {
      vod = '<a class="btn btn-quiet btn-sm vod-link" href="' + esc(m.vod) + '" target="_blank" rel="noopener">' +
        ic('play') + 'VOD</a>';
    }

    return '<div class="' + cls + '" data-match="' + m.id + '" style="grid-area:' + gridArea(m.id) + '">' +
      head + slotHtml(m, 1) + slotHtml(m, 2) +
      (vod ? '<div class="match-foot">' + vod + '</div>' : '') +
      '</div>';
  }

  function colHeadHtml(col, matches) {
    var list = matches.filter(function (m) { return columnOf(m.id) === col.col; });
    var done = list.filter(function (m) { return !!m.winner; }).length;
    return '<div class="b-col-head" style="grid-column:' + col.col + '">' +
      '<b>' + col.label + '</b>' +
      '<span>' + (list.length ? done + '/' + list.length + ' сыграно' : '') + '</span>' +
      '</div>';
  }

  /* ---------- Полная разметка ---------- */
  function html(data) {
    var D0 = data || D.get();
    var matches = D0.matches.slice().sort(function (a, b) { return a.id - b.id; });
    var parts = [];
    COLUMNS.forEach(function (c) { parts.push(colHeadHtml(c, matches)); });
    matches.forEach(function (m) {
      if (!LAYOUT[m.id]) return;
      parts.push(matchHtml(m));
    });
    parts.push('<svg class="b-lines" aria-hidden="true"></svg>');
    return parts.join('');
  }

  /* ---------- Линии связей ---------- */
  function elbow(x1, y1, xm, y2, x2) {
    var r = Math.min(10, Math.abs(y2 - y1) / 2, Math.max(0, xm - x1));
    var d = y2 >= y1 ? 1 : -1;
    if (Math.abs(y2 - y1) < 1) return 'M' + x1 + ' ' + y1 + ' H' + x2;
    return 'M' + x1 + ' ' + y1 + ' H' + (xm - r) +
      ' Q' + xm + ' ' + y1 + ' ' + xm + ' ' + (y1 + d * r) +
      ' V' + (y2 - d * r) +
      ' Q' + xm + ' ' + y2 + ' ' + (xm + r) + ' ' + y2 + ' H' + x2;
  }

  function drawLines(root) {
    var box = root.querySelector('.bracket');
    if (!box) return;
    var svg = box.querySelector('.b-lines');
    if (!svg) return;
    var rect = box.getBoundingClientRect();
    if (!rect.width) return;

    svg.setAttribute('width', rect.width);
    svg.setAttribute('height', rect.height);
    svg.setAttribute('viewBox', '0 0 ' + rect.width + ' ' + rect.height);

    function card(id) { return box.querySelector('.match[data-match="' + id + '"]'); }
    function geo(id) {
      var el = card(id);
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return {
        left: r.left - rect.left, right: r.right - rect.left, top: r.top - rect.top,
        height: r.height
      };
    }

    var G = {};
    [1, 2, 3, 4, 5].forEach(function (id) { G[id] = geo(id); });

    /* центр строки слота внутри карточки (head занимает верх) */
    function rowCenter(g, idx, id) {
      var el = card(id);
      var slotEl = el ? el.querySelector('.slot[data-slot="' + (idx + 1) + '"]') : null;
      if (!slotEl) return g.top + g.height / 2;
      var sr = slotEl.getBoundingClientRect();
      return sr.top - rect.top + sr.height / 2;
    }

    function link(fromId, toId, rowIdx) {
      var a = G[fromId], b = G[toId];
      if (!a || !b) return '';
      var m = D.match(fromId);
      if (!m) return '';
      var xm = (a.right + b.left) / 2;
      var y1 = rowCenter(a, rowIdx, fromId);
      var y2 = rowCenter(b, rowIdx, toId);
      var cls = m.state === 'live' ? ' class="live"' : (m.winner ? ' class="on"' : '');
      return '<path' + cls + ' d="' + elbow(a.right, y1, xm, y2, b.left) + '"/>';
    }

    var paths = link(1, 4, 0) + link(2, 4, 1) + link(4, 5, 0) + link(3, 5, 1);
    svg.innerHTML = paths;
  }

  /* ---------- Монтирование ---------- */
  var instances = [];

  function render(root, opts) {
    if (!root) return;
    opts = opts || {};
    root.innerHTML = html(opts.data);
    var box = root.querySelector('.bracket');
    if (box) {
      var frame = function () { drawLines(root); };
      if (global.ResizeObserver) {
        if (root._caRO) root._caRO.disconnect();
        root._caRO = new ResizeObserver(function () { requestAnimationFrame(frame); });
        root._caRO.observe(box);
      }
      requestAnimationFrame(frame);
      setTimeout(frame, 120);
      if (global.document && global.document.fonts && global.document.fonts.ready) {
        global.document.fonts.ready.then(frame);
      }
    }
  }

  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  var onResize = debounce(function () {
    instances.forEach(function (root) { drawLines(root); });
  }, 120);

  function autoInit(root, opts) {
    instances.push(root);
    render(root, opts);
  }

  CA.bracket = {
    html: html,
    render: render,
    drawLines: drawLines,
    autoInit: autoInit,
    gridArea: gridArea,
    columnOf: columnOf
  };

  if (global.addEventListener) global.addEventListener('resize', onResize);
})(typeof window !== 'undefined' ? window : globalThis);
