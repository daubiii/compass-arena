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

  /* Раскладка считается из самих матчей и их связей (from1/from2), поэтому подходит любой структуре:
     single / double elimination, матч за 3-е место, сброс гранд-финала, произвольные ручные сетки.
     Единица сетки — «строка»: карточка занимает STEP строк, заголовки — 2 строки. */
  var STEP = 4;
  var ROW0 = 3;          // первая строка карточек верхней сетки (строки 1–2 — заголовки)
  var SECTION_GAP = 1;   // пустых строк между верхней и нижней сеткой

  function esc(s) { return D.esc(s); }
  function ic(name, cls) { return CA.ui.icon(name, cls); }

  /* ---------- Раскладка ---------- */
  function sectionOf(m) { return m.bracket === 'lower' ? 'lower' : (m.bracket === 'grand' ? 'grand' : (m.bracket === 'third' ? 'third' : 'upper')); }
  function byNum(a, b) { return (a.num - b.num) || (a.id - b.id); }
  function uniqSorted(list) {
    var out = [];
    list.forEach(function (x) { if (out.indexOf(x) === -1) out.push(x); });
    return out.sort(function (a, b) { return a - b; });
  }

  /* Вертикальная позиция матчей раздела: первый круг — подряд, дальше — по центру между источниками */
  function placeSection(list, by, sec) {
    var y = {};
    uniqSorted(list.map(function (m) { return m.round; })).forEach(function (r) {
      var items = list.filter(function (m) { return m.round === r; }).sort(byNum);
      var rows = items.map(function (m) {
        var srcs = [m.from1, m.from2].filter(function (l) { return l && l.as === 'w'; })
          .map(function (l) { return by[l.m]; })
          .filter(function (src) { return src && sectionOf(src) === sec && y[src.id] !== undefined; });
        var want = srcs.length ? Math.round(srcs.reduce(function (acc, src) { return acc + y[src.id]; }, 0) / srcs.length) : null;
        return { m: m, want: want };
      });
      rows.sort(function (a, b) {
        if (a.want === null && b.want === null) return byNum(a.m, b.m);
        if (a.want === null) return 1;
        if (b.want === null) return -1;
        return a.want - b.want || byNum(a.m, b.m);
      });
      var prev = -STEP;
      rows.forEach(function (o) {
        var v = o.want === null ? prev + STEP : Math.max(o.want, prev + STEP);
        y[o.m.id] = v; prev = v;
      });
    });
    return y;
  }

  function layout(matches) {
    var by = {};
    matches.forEach(function (m) { by[m.id] = m; });
    var secs = { upper: [], lower: [], grand: [], third: [] };
    matches.forEach(function (m) { secs[sectionOf(m)].push(m); });

    var out = { items: {}, heads: [], cols: 0, rows: 0, order: [] };
    var colOf = {};
    function assignCols(list, startCol) {
      var rounds = uniqSorted(list.map(function (m) { return m.round; }));
      list.forEach(function (m) { colOf[m.id] = startCol + rounds.indexOf(m.round); });
      return rounds.length;
    }
    var nUp = assignCols(secs.upper, 1);
    var nLo = assignCols(secs.lower, 1);
    var finalCol = Math.max(nUp, nLo, 1) + 1;
    var nGr = assignCols(secs.grand, finalCol);
    var thirdCol = nUp ? nUp : finalCol;
    secs.third.forEach(function (m) { colOf[m.id] = thirdCol; });
    out.cols = Math.max(nUp, nLo, nGr ? finalCol + nGr - 1 : 0, secs.third.length && !nUp ? finalCol : 0, 1);

    var rowOf = {};
    var yUp = placeSection(secs.upper, by, 'upper');
    var upH = 0;
    secs.upper.forEach(function (m) { rowOf[m.id] = ROW0 + yUp[m.id]; upH = Math.max(upH, yUp[m.id] + STEP); });

    var lowHeadRow = 1;
    if (secs.lower.length) {
      lowHeadRow = ROW0 + (secs.upper.length ? upH + SECTION_GAP : 0);
      var base = lowHeadRow + 2;
      var yLo = placeSection(secs.lower, by, 'lower');
      secs.lower.forEach(function (m) { rowOf[m.id] = base + yLo[m.id]; });
    }
    if (!secs.upper.length && secs.lower.length) lowHeadRow = 1;

    // гранд-финал и «сброс»: по центру между источниками (по абсолютной позиции)
    function absRow(id) { return rowOf[id]; }
    secs.grand.slice().sort(function (a, b) { return a.round - b.round || byNum(a, b); }).forEach(function (m, i) {
      var srcs = [m.from1, m.from2].filter(function (l) { return l && l.as === 'w' && rowOf[l.m] !== undefined; });
      var v = srcs.length ? Math.round(srcs.reduce(function (acc, l) { return acc + absRow(l.m); }, 0) / srcs.length) : ROW0 + i * STEP;
      rowOf[m.id] = v;
    });
    // матч за 3-е место — под финалом
    secs.third.forEach(function (m) {
      var lastUp = secs.upper.filter(function (x) { return colOf[x.id] === thirdCol; }).sort(byNum).pop();
      rowOf[m.id] = lastUp ? rowOf[lastUp.id] + STEP + 1 : ROW0;
    });

    matches.forEach(function (m) {
      out.items[m.id] = { col: colOf[m.id], row: rowOf[m.id], span: STEP };
      out.rows = Math.max(out.rows, rowOf[m.id] + STEP - 1);
    });

    // заголовки колонок: верхняя/общая строка 1, нижняя сетка — над своим блоком
    function addHeads(list, row) {
      uniqSorted(list.map(function (m) { return colOf[m.id]; })).forEach(function (c) {
        var inCol = list.filter(function (m) { return colOf[m.id] === c; }).sort(byNum);
        out.heads.push({ col: c, row: row, matches: inCol });
      });
    }
    addHeads(secs.upper, 1);
    addHeads(secs.lower, secs.upper.length ? lowHeadRow : 1);
    addHeads(secs.grand, 1);
    out.rows = Math.max(out.rows, 2);

    // порядок в DOM (для мобильной ленты): верхняя, нижняя, гранд, 3-е место; внутри — по колонкам
    ['upper', 'lower', 'grand', 'third'].forEach(function (k) {
      uniqSorted(secs[k].map(function (m) { return colOf[m.id]; })).forEach(function (c) {
        out.order.push({ sec: k, col: c, matches: secs[k].filter(function (m) { return colOf[m.id] === c; }).sort(byNum) });
      });
    });
    return out;
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

  /* Номер в углу слота: посев команды, а если его нет — её номер в списке (для команд, добавленных из Challonge, пусто) */
  function seedOf(teamId) {
    var t = D.team(teamId);
    if (t && t.seed) return t.seed;
    return teamId != null && teamId < 1000000 ? teamId : '';
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
      '<span class="slot-seed">' + (seedOf(teamId)) + '</span>' +
      '<span class="slot-name">' + esc(info.text) + '</span>' +
      '<span class="slot-side">' +
      (hasScore ? '<span class="slot-score">' + esc(score) + '</span>' : '') +
      '<span class="slot-info" aria-hidden="true">i</span>' +
      '</span></div>';
    return html;
  }

  function matchHtml(m, place) {
    if (!m) return '';
    var cls = 'match m' + m.id;
    if (m.state === 'done') cls += ' is-done';
    if (m.state === 'live') cls += ' is-live';
    if (m.state === 'upcoming' && !m.isNext && m.bothKnown) cls += ' is-upcoming';
    if (m.isNext) cls += ' is-next';
    if (m.bracket === 'grand') cls += ' is-grand';
    if (m.bracket === 'grand' && m.winner) cls += ' is-champion';

    /* VOD — в шапке карточки, а не отдельной строкой снизу: высота карточки не зависит от наличия записи */
    var vod = '';
    if (m.vod && m.state === 'done') {
      vod = '<a class="vod-link" href="' + esc(m.vod) + '" target="_blank" rel="noopener" aria-label="Запись матча">' +
        ic('play') + 'VOD</a>';
    }
    var head = '<div class="match-head">' +
      '<span class="m-id">M' + m.num + ' · ' + esc(D.stageShort(m)) + '</span>' +
      '<span class="m-right">' + vod + statusHtml(m) + '</span>' +
      '</div>';

    var pos = place || { col: 1, row: ROW0, span: STEP };
    return '<div class="' + cls + '" data-match="' + m.id + '" style="grid-area:' + pos.row + ' / ' + pos.col + ' / ' + (pos.row + pos.span) + ' / ' + (pos.col + 1) + '">' +
      head + slotHtml(m, 1) + slotHtml(m, 2) +
      '</div>';
  }

  function colHeadHtml(h) {
    var done = h.matches.filter(function (m) { return !!m.winner; }).length;
    var label = D.colLabel(h.matches[0]);
    return '<div class="b-col-head" style="grid-column:' + h.col + ';grid-row:' + h.row + ' / span 2">' +
      '<b>' + esc(label) + '</b>' +
      '<span>' + (h.matches.length ? done + '/' + h.matches.length + ' сыграно' : '') + '</span>' +
      '</div>';
  }

  /* ---------- Полная разметка ---------- */
  function html(data) {
    var D0 = data || D.get();
    var lay = layout(D0.matches);
    var heads = {};
    lay.heads.forEach(function (h) { heads[h.col + ':' + (h.matches[0] ? h.matches[0].bracket : '')] = h; });
    var parts = [];
    lay.order.forEach(function (g) {
      var first = g.matches[0];
      var head = lay.heads.filter(function (h) { return h.col === g.col && h.matches.indexOf(first) !== -1; })[0];
      var inner = (head ? colHeadHtml(head) : '') + g.matches.map(function (m) { return matchHtml(m, lay.items[m.id]); }).join('');
      parts.push('<div class="b-col" data-sec="' + g.sec + '">' + inner + '</div>');
    });
    parts.push('<svg class="b-lines" aria-hidden="true"></svg>');
    return { html: parts.join(''), layout: lay };
  }

  /* Контейнер сетки: сам root (страница монтирует в .bracket) или вложенный .bracket */
  function boxOf(root) {
    if (!root) return null;
    return root.classList && root.classList.contains('bracket') ? root : root.querySelector('.bracket');
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
    var box = boxOf(root);
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

    var gap = parseFloat(global.getComputedStyle(box).columnGap) || 48;
    var G = {};
    D.get().matches.forEach(function (m) { G[m.id] = geo(m.id); });

    /* центр строки слота внутри карточки (head занимает верх) */
    function rowCenter(g, idx, id) {
      var el = card(id);
      var slotEl = el ? el.querySelector('.slot[data-slot="' + (idx + 1) + '"]') : null;
      if (!slotEl) return g.top + g.height / 2;
      var sr = slotEl.getBoundingClientRect();
      return sr.top - rect.top + sr.height / 2;
    }

    /* Рисуем пути победителей. Падение проигравших в нижнюю сетку линией не показываем —
       его описывает подпись «Проигравший M5» в слоте. Вертикаль — в зазоре перед целевой колонкой,
       поэтому длинная связь (финал верхней сетки → гранд-финал) не пересекает чужие карточки. */
    var paths = '';
    D.get().matches.forEach(function (target) {
      [target.from1, target.from2].forEach(function (link, idx) {
        if (!link || link.as !== 'w') return;
        var src = D.match(link.m), a = G[link.m], b = G[target.id];
        if (!src || !a || !b) return;
        var y1 = rowCenter(a, 0, link.m) - (a.height ? 0 : 0);
        y1 = a.top + a.height / 2;
        var y2 = rowCenter(b, idx, target.id);
        var xm = b.left - gap / 2;
        var cls = src.state === 'live' ? ' class="live"' : (src.winner ? ' class="on"' : '');
        paths += '<path' + cls + ' d="' + elbow(a.right, y1, xm, y2, b.left) + '"/>';
      });
    });
    svg.innerHTML = paths;
  }

  /* Подсказка «листайте вбок» — только когда сетка шире экрана (на телефоне сетка вертикальная) */
  function updateHint(root) {
    var box = boxOf(root);
    var scroller = box && box.closest ? box.closest('.bracket-scroll') : null;
    var hint = global.document ? global.document.querySelector('.bracket-hint') : null;
    if (!scroller || !hint) return;
    var wide = scroller.scrollWidth > scroller.clientWidth + 4 && global.innerWidth > 820;
    hint.style.display = wide ? 'inline' : '';
  }

  /* ---------- Монтирование ---------- */
  var instances = [];

  function render(root, opts) {
    if (!root) return;
    opts = opts || {};
    var built = html(opts.data);
    root.innerHTML = built.html;
    var box = boxOf(root);
    if (box) {
      box.style.setProperty('--cols', built.layout.cols);
      box.style.setProperty('--rows', built.layout.rows);
    }
    if (box) {
      var frame = function () { drawLines(root); updateHint(root); };
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
    instances.forEach(function (root) { drawLines(root); updateHint(root); });
  }, 120);

  function autoInit(root, opts) {
    instances.push(root);
    render(root, opts);
  }

  CA.bracket = {
    html: function (data) { return html(data).html; },
    layout: layout,
    render: render,
    drawLines: drawLines,
    autoInit: autoInit
  };

  if (global.addEventListener) global.addEventListener('resize', onResize);
})(typeof window !== 'undefined' ? window : globalThis);
