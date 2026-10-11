/* ==========================================================
   Compass Arena — компонент турнирной сетки
   ----------------------------------------------------------
   Работает с любой сеткой: 4…16 команд, SE и DE. Раскладка
   считается из данных (раунды и источники слотов), а не из
   жёсткой карты M1–M5:
     • колонка — раунд (сначала верхняя сетка, потом нижняя, в конце финалы);
     • внутри колонки карточки разнесены по вертикали так, чтобы
       получатели стояли ровно между своими источниками;
     • линии связей рисует SVG по реальным координатам карточек.
   Старая сетка (6 команд, M1–M5) рисуется той же логикой.
   ========================================================== */
(function (global) {
  'use strict';

  var CA = global.CA = global.CA || {};
  var D = CA.data;

  var GAP = 0.6;              /* доля пустого места между блоками сетки */
  var BASE_ROW = 100;         /* условная высота ряда, влияет только на пропорции */

  function esc(s) { return D.esc(s); }
  function ic(name, cls) { return CA.ui.icon(name, cls); }

  /* ---------- Раскладка ---------- */

  /** Группируем матчи по «колонкам»: раунд внутри своей части сетки */
  function columns(matches) {
    var list = (matches || []).slice().sort(function (a, b) { return a.id - b.id; });
    var cols = [];
    var seen = {};

    list.forEach(function (m) {
      var section = m.bracket === 'grand' ? 'grand' : (m.bracket === 'lower' ? 'lower' : 'upper');
      var key = section + ':' + m.round;
      var col = seen[key];
      if (!col) {
        col = { key: key, section: section, round: m.round, matches: [] };
        seen[key] = col;
        cols.push(col);
      }
      col.matches.push(m);
    });

    /* Порядок блоков: верхняя → нижняя → финалы (каждый блок — по возрастанию раунда) */
    var rank = { upper: 0, lower: 1, grand: 2 };
    cols.sort(function (a, b) {
      return (rank[a.section] - rank[b.section]) || (a.round - b.round);
    });
    cols.forEach(function (col, index) {
      /* Пустая колонка-разделитель перед новым блоком, чтобы блоки не сливались */
      col.col = index + 1;
      if (index > 0 && cols[index - 1].section !== col.section) col.col += GAP;
    });
    return cols;
  }

  /**
   * Раскладка карточек: { items: { id: { col, row, span } }, cols, rows }.
   * Правило: первый раунд блока идёт парами по 1 ряду, каждый следующий
   * занимает вдвое больше и центрируется относительно своих источников.
   */
  function layout(matches) {
    var cols = columns(matches);
    var items = {};
    var rows = 1;

    cols.forEach(function (col) {
      var count = col.matches.length;
      /* Ряд в «условных» единицах: у финалов 4, у остальных 2^(раунд−1) */
      var span = (col.section === 'grand') ? 4 : Math.pow(2, Math.min(col.round - 1, 6));
      span = Math.max(1, Math.min(span, 64));

      var step;                 /* через сколько условных рядов ставить следующую карточку */
      if (col.section === 'grand') {
        step = span * 1.5;
      } else if (col.matches.some(function (m) { return m.from1 || m.from2; })) {
        step = span * 2;
      } else {
        step = span * 2;
      }

      col.matches.forEach(function (m, i) {
        items[m.id] = {
          col: col.col,
          row: 1 + i * step,
          span: span,
          label: col.label
        };
      });
      rows = Math.max(rows, 1 + (count - 1) * step + span);
    });

    return { items: items, cols: cols, rows: rows, columnCount: cols.length };
  }

  function colLabel(col) {
    var engine = window.CA && CA.bracketEngine;
    var first = col.matches[0];
    if (engine && first) {
      var gen = window.CA && CA.bracketEngine && CA.data.get().bracket;
      if (gen) {
        var plan = engine.generate({
          teamCount: gen.teamCount, format: gen.format, matchType: gen.matchType,
          thirdPlace: gen.thirdPlace, grandFinal: gen.grandFinal
        });
        if (plan.stageLabels && plan.stageLabels[first.id]) return plan.stageLabels[first.id];
      }
    }
    if (first) {
      var label = D.stageLabel(first);
      if (label) return label;
    }
    if (col.section === 'lower') return 'Нижняя · раунд ' + col.round;
    if (col.section === 'grand') return 'Гранд-финал';
    return 'Раунд ' + col.round;
  }

  /* ---------- Карточка матча ---------- */

  function statusHtml(m) {
    if (m.state === 'live') return '<span class="st st-live"><span class="dot-live"></span>В эфире</span>';
    if (m.bye) return '<span class="st st-done">' + ic('check') + 'Проходит без игры</span>';
    if (m.winner) {
      var score = (m.score1 != null && m.score2 != null) ? m.score1 + ' : ' + m.score2 : '';
      return '<span class="st st-done">' + ic('check') + (score ? esc(score) : 'Сыгран') + '</span>';
    }
    if (m.idle) return '<span class="st st-flag">Не играется</span>';
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
      var bye = !(slot === 1 ? m.from1 : m.from2) && !teamId;
      return '<div class="slot is-tbd" data-slot="' + slot + '">' +
        '<span class="slot-seed"></span>' +
        '<span class="slot-name">' + esc(bye && !m.idle ? 'проходит без игры' : info.text) + '</span>' +
        '<span class="slot-side"></span></div>';
    }

    var cls = 'slot is-clickable';
    if (m.winner) cls += (m.winner === teamId) ? ' is-winner' : ' is-loser';

    return '<div class="' + cls + '" data-team="' + teamId + '" data-slot="' + slot + '" role="button" tabindex="0"' +
      ' aria-label="' + esc(info.text) + ' — состав команды">' +
      '<span class="slot-seed">' + teamId + '</span>' +
      '<span class="slot-name">' + esc(info.text) + '</span>' +
      '<span class="slot-side">' +
      (hasScore ? '<span class="slot-score">' + esc(score) + '</span>' : '') +
      '<span class="slot-info" aria-hidden="true">i</span>' +
      '</span></div>';
  }

  function matchHtml(m, lay) {
    if (!m) return '';
    var cls = 'match m' + m.id;
    if (m.state === 'done') cls += ' is-done';
    if (m.state === 'live') cls += ' is-live';
    if (m.state === 'upcoming' && !m.isNext && m.bothKnown) cls += ' is-upcoming';
    if (m.isNext) cls += ' is-next';
    if (m.bracket === 'grand') cls += ' is-grand';
    if (m.bracket === 'grand' && m.winner) cls += ' is-champion';
    if (m.bracket === 'lower') cls += ' is-lower';
    if (m.bracket === 'third') cls += ' is-third';
    if (m.idle) cls += ' is-idle';

    var pos = lay.items[m.id];
    var style = pos ? 'grid-column:' + pos.col + ';grid-row:' + pos.row + ' / span ' + pos.span + ';' : '';

    var head = '<div class="match-head">' +
      '<span class="m-id">M' + m.id + ' · ' + esc(D.stageLabel(m)) + '</span>' +
      statusHtml(m) +
      '</div>';

    var vod = '';
    if (m.vod && m.state === 'done') {
      vod = '<a class="btn btn-quiet btn-sm vod-link" href="' + esc(m.vod) + '" target="_blank" rel="noopener">' +
        ic('play') + 'VOD</a>';
    }

    var body = m.idle
      ? '<div class="slot is-tbd"><span class="slot-name">соперник прошёл без игры</span></div>'
      : (slotHtml(m, 1) + slotHtml(m, 2));

    return '<div class="' + cls + '" data-match="' + m.id + '" style="' + style + '">' +
      head + body +
      (vod ? '<div class="match-foot">' + vod + '</div>' : '') +
      '</div>';
  }

  function colHeadHtml(col, lay) {
    var done = col.matches.filter(function (m) { return !!m.winner; }).length;
    var total = col.matches.filter(function (m) { return !m.idle; }).length;
    return '<div class="b-col-head" style="grid-column:' + Math.round(col.col) + '">' +
      '<b>' + esc(colLabel(col)) + '</b>' +
      '<span>' + (total ? done + '/' + total + ' сыграно' : '') + '</span>' +
      '</div>';
  }

  /* ---------- Полная разметка ---------- */

  function html(data) {
    var D0 = data || D.get();
    var matches = (D0.matches || []).slice().sort(function (a, b) { return a.id - b.id; });
    var lay = layout(matches);
    var parts = [];

    lay.cols.forEach(function (col) { parts.push(colHeadHtml(col, lay)); });

    matches.forEach(function (m) {
      if (!lay.items[m.id]) return;
      parts.push(matchHtml(m, lay));
    });

    parts.push('<svg class="b-lines" aria-hidden="true"></svg>');

    return '<div class="bracket b-cols-' + lay.columnCount + '" data-cols="' + lay.columnCount + '"' +
      ' data-rows="' + lay.rows + '" style="--b-cols:' + lay.columnCount + ';--b-rows:' + lay.rows + '">' +
      parts.join('') + '</div>';
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
    svg.style.width = rect.width + 'px';
    svg.style.height = rect.height + 'px';

    function card(id) { return box.querySelector('.match[data-match="' + id + '"]'); }
    function geo(id) {
      var el = card(id);
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return { left: r.left - rect.left, right: r.right - rect.left, top: r.top - rect.top, height: r.height };
    }
    function slotCenter(id, slot) {
      var el = card(id);
      var slotEl = el ? el.querySelector('.slot[data-slot="' + slot + '"]') : null;
      if (!slotEl) {
        var g = geo(id);
        return g ? g.top + g.height / 2 : 0;
      }
      var sr = slotEl.getBoundingClientRect();
      return sr.top - rect.top + sr.height / 2;
    }

    var D0 = D.get();
    var matches = (D0.matches || []);
    var paths = [];

    matches.forEach(function (m) {
      var target = geo(m.id);
      if (!target) return;
      [1, 2].forEach(function (slot) {
        var src = slot === 1 ? m.from1 : m.from2;
        if (!src) return;
        var from = geo(src.m);
        if (!from) return;
        var source = matches.filter(function (x) { return x.id === src.m; })[0];
        var cls = '';
        if (source && source.winner) cls = ' class="on"';
        else if (source && source.state === 'live') cls = ' class="live"';
        /* Проигравший уходит вниз — рисуем пунктиром, чтобы не путать с победителем */
        if (src.as === 'l') cls = cls ? ' class="on is-loser"' : ' class="is-loser"';
        var xm = (from.right + target.left) / 2;
        var y1 = slotCenter(src.m, src.as === 'l' ? loserSlot(source) : winnerSlot(source));
        var y2 = slotCenter(m.id, slot);
        paths.push('<path' + cls + ' d="' + elbow(from.right, y1, xm, y2, target.left) + '"/>');
      });
    });

    svg.innerHTML = paths.join('');
  }

  /** Какой слот матча отдаёт победителя (для линии): обычно первый найденный */
  function winnerSlot(m) {
    if (!m) return 1;
    if (m.winner && m.team2 === m.winner) return 2;
    return 1;
  }
  function loserSlot(m) {
    if (!m) return 2;
    if (m.winner && m.team1 === m.winner) return 2;
    return 1;
  }

  /* ---------- Монтирование ---------- */
  var instances = [];

  function render(root, opts) {
    if (!root) return;
    opts = opts || {};
    root.innerHTML = html(opts.data);
    var box = root.querySelector('.bracket');
    if (!box) return;

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

  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  var onResize = debounce(function () {
    instances.forEach(function (root) { drawLines(root); });
  }, 120);

  function autoInit(root, opts) {
    if (instances.indexOf(root) < 0) instances.push(root);
    render(root, opts);
  }

  CA.bracket = {
    html: html,
    render: render,
    drawLines: drawLines,
    autoInit: autoInit,
    layout: layout,
    columns: columns,
    colLabel: colLabel
  };

  if (global.addEventListener) global.addEventListener('resize', onResize);
})(typeof window !== 'undefined' ? window : globalThis);
