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

  var GAP_COL = 0.55;         /* ширина пустой колонки-разделителя между блоками, в колонках */

  function esc(s) { return D.esc(s); }
  function ic(name, cls) { return CA.ui.icon(name, cls); }

  /* ---------- Раскладка ---------- */

  /**
   * Группируем матчи по «колонкам»: раунд внутри своей части сетки.
   * Между блоками (верхняя → нижняя → финалы) вставляем пустую колонку-разделитель,
   * заданную её шириной, — так номер колонки остаётся целым, а блоки не слипаются.
   */
  function columns(matches) {
    var list = (matches || []).slice().sort(function (a, b) { return a.id - b.id; });
    var raw = [];
    var seen = {};

    list.forEach(function (m) {
      var section = m.bracket === 'grand' ? 'grand' : (m.bracket === 'lower' ? 'lower' : 'upper');
      var key = section + ':' + m.round;
      var col = seen[key];
      if (!col) {
        col = { key: key, section: section, round: m.round, matches: [] };
        seen[key] = col;
        raw.push(col);
      }
      col.matches.push(m);
    });

    /* Порядок блоков: верхняя → нижняя → финалы (каждый блок — по возрастанию раунда) */
    var rank = { upper: 0, lower: 1, grand: 2 };
    raw.sort(function (a, b) {
      return (rank[a.section] - rank[b.section]) || (a.round - b.round);
    });

    /* Нумеруем дорожки целыми числами: разделитель занимает свою дорожку
       шириной GAP_COL, поэтому номер колонки всегда целый и годится для CSS. */
    var tracks = [];
    var cols = [];
    var index = 0;
    raw.forEach(function (item, i) {
      if (i > 0 && raw[i - 1].section !== item.section) {
        tracks.push({ spacer: true, fr: GAP_COL });
        index += 1;
      }
      item.col = index + 1;
      tracks.push({ item: item, fr: 1 });
      cols.push(item);
      index += 1;
    });
    return { cols: cols, tracks: tracks };
  }

  /**
   * Раскладка карточек: { items, cols, rows, unit, columnCount }.
   *
   * Позиции считаются по связям, а не по номеру раунда:
   *   • первый раунд верхней сетки идёт подряд через два ряда;
   *   • каждая следующая карточка встаёт ровно между своими источниками
   *     (при двух — посередине, при одном — на его месте). Поэтому нижняя
   *     сетка естественно «вплетается» в верхнюю, а слоты совпадают с теми,
   *     откуда приходят команды.
   *   • если источников несколько и они далеко друг от друга, карточку
   *     прижимаем к предыдущей в колонке, чтобы не было дыр на пол-экрана.
   *
   * Высота. Один ряд — половина карточки, поэтому переменная --b-unit
   * считается так, что два ряда = высота карточки + зазор: карточка не может
   * вылезти за свою ячейку и налезть на соседей.
   */
  function layout(matches) {
    var split = columns(matches);
    var cols = split.cols;
    var tracks = split.tracks;
    var items = {};
    var rows = 1;

    var CARD_H = 116;               /* min-height карточки из CSS */
    var GAP = 18;                   /* зазор между карточками по вертикали */
    var MAX_SPREAD = 6;             /* насколько карточка может отойти от соседа сверху */
    /* Первый ряд грида — подписи колонок, поэтому карточки начинаем со второго:
       иначе верхняя карточка подлезает под «1/8 финала верхней · 6/8 сыграно». */
    var ROW_OFFSET = 1;

    cols.forEach(function (col) {
      var list = col.matches;
      var prev = null;

      list.forEach(function (m) {
        var srcs = [m.from1, m.from2]
          .filter(function (s) { return s && items[s.m]; })
          .map(function (s) { return items[s.m].center; })
          .sort(function (a, b) { return a - b; });

        var center;
        if (srcs.length >= 2) center = (srcs[0] + srcs[srcs.length - 1]) / 2;
        else if (srcs.length === 1) center = srcs[0];
        else center = prev == null ? 1 : prev + 2;

        /* Не даём карточке уехать слишком далеко от соседа по колонке */
        if (prev != null && center > prev + MAX_SPREAD) center = prev + MAX_SPREAD;
        if (prev != null && center < prev + 2) center = prev + 2;

        var row = Math.round((center - 1) * 2) + 1 + ROW_OFFSET;
        items[m.id] = { col: col.col, row: row, span: 2, center: center };
        rows = Math.max(rows, row + 2);
        prev = center;
      });
    });

    /* Два ряда = карточка + зазор. У больших сеток (нижняя сетка, финалы) шаг
       сжимаем, чтобы полотно не растягивалось на несколько экранов: в самом
       плотном варианте карточки идут почти вплотную (запас 10px), поэтому
       наложения не будет, а пустого воздуха станет заметно меньше. */
    var unit = Math.max(Math.round((CARD_H + GAP) / 2), Math.min(72, Math.round(3400 / Math.max(1, rows))));

    /* Колонок для подписи и CSS — без пустых разделителей */
    var realCols = tracks.filter(function (t) { return !t.spacer; }).length;

    return { items: items, cols: cols, tracks: tracks, rows: rows, unit: unit, columnCount: realCols };
  }

  /**
   * Подпись колонки. Считаем её от самих матчей (через D.stageLabel), а не от
   * настроек сетки: настройки могут разойтись с данными, и тогда подписи
   * «1/8 финала» оказывались над матчами совсем другого раунда.
   */
  function colLabel(col) {
    var first = col.matches[0];
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
    if (m.bye) return '<span class="st st-done">' + ic('check') + 'Без игры</span>';
    if (m.winner) {
      var score = (m.score1 != null && m.score2 != null) ? m.score1 + ' : ' + m.score2 : '';
      return '<span class="st st-done">' + ic('check') + (score ? esc(score) : 'Сыгран') + '</span>';
    }
    if (m.idle) return '<span class="st st-flag">Не играется</span>';
    var when = m.scheduled ? D.fmtShort(m.scheduled) : '';
    if (m.isNext && when) return '<span class="st st-next">' + ic('clock') + esc(when) + '</span>';
    if (when) return '<span class="st">' + esc(when) + '</span>';
    /* Короткая подпись: длинная строка переносится и раздувает карточку */
    return '<span class="st st-flag">' + ic('clock') + 'TBD</span>';
  }

  function slotHtml(m, slot) {
    var info = D.slotLabel(m, slot);
    var score = slot === 1 ? m.score1 : m.score2;
    var hasScore = m.score1 != null && m.score2 != null;
    var teamId = slot === 1 ? m.team1 : m.team2;

    if (!info.known) {
      /* Слот без источника — это BYE: соперника у команды нет, она проходит дальше.
         Если команды нет вообще (первый раунд ещё не разыгран), показываем, кого ждём. */
      var empty = !(slot === 1 ? m.from1 : m.from2) && !teamId;
      var text = (empty && !m.idle) ? 'Без соперника' : info.text;
      return '<div class="slot is-tbd" data-slot="' + slot + '">' +
        '<span class="slot-seed">' + (empty ? '' : '·') + '</span>' +
        '<span class="slot-name">' + esc(text) + '</span>' +
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

  function colHeadHtml(col) {
    var done = col.matches.filter(function (m) { return !!m.winner; }).length;
    var total = col.matches.filter(function (m) { return !m.idle; }).length;
    return '<div class="b-col-head" style="grid-column:' + col.col + '">' +
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

    /* Дорожки: обычная колонка — 1fr, разделитель между блоками — своя доля */
    var columnsCss = lay.tracks.map(function (t) {
      return t.spacer ? t.fr + 'fr' : '1fr';
    }).join(' ');

    lay.cols.forEach(function (col) { parts.push(colHeadHtml(col)); });

    matches.forEach(function (m) {
      if (!lay.items[m.id]) return;
      parts.push(matchHtml(m, lay));
    });

    parts.push('<svg class="b-lines" aria-hidden="true"></svg>');

    return '<div class="bracket b-cols-' + lay.columnCount + '" data-cols="' + lay.columnCount + '"' +
      ' data-rows="' + lay.rows + '"' +
      ' style="--b-cols:' + lay.tracks.length + ';--b-rows:' + lay.rows + ';--b-unit:' + lay.unit + 'px;' +
      'grid-template-columns:' + columnsCss + '">' +
      parts.join('') + '</div>';
  }

  /* ---------- Линии связей ---------- */

  function elbow(x1, y1, xm, y2, x2) {
    var r = Math.min(12, Math.abs(y2 - y1) / 2, Math.max(0, xm - x1));
    var d = y2 >= y1 ? 1 : -1;
    if (Math.abs(y2 - y1) < 1) return 'M' + x1 + ' ' + y1 + ' H' + x2;
    return 'M' + x1 + ' ' + y1 + ' H' + (xm - r) +
      ' Q' + xm + ' ' + y1 + ' ' + xm + ' ' + (y1 + d * r) +
      ' V' + (y2 - d * r) +
      ' Q' + xm + ' ' + y2 + ' ' + (xm + r) + ' ' + y2 + ' H' + x2;
  }

  /**
   * Рисуем линии поверх сетки. Полотно у большой сетки выше окна, поэтому
   * считаем координаты относительно самого полотна (а не окна) и задаём SVG
   * такой же viewBox, как его собственный размер, — тогда путь «1 в 1» совпадает
   * с пикселями и ничего не масштабируется.
   */
  function drawLines(root) {
    var box = root.querySelector('.bracket');
    if (!box) return;
    var svg = box.querySelector('.b-lines');
    if (!svg) return;
    var rect = box.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    svg.setAttribute('viewBox', '0 0 ' + rect.width + ' ' + rect.height);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.width = rect.width + 'px';
    svg.style.height = rect.height + 'px';

    function card(id) { return box.querySelector('.match[data-match="' + id + '"]'); }
    function geo(id) {
      var el = card(id);
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return {
        left: r.left - rect.left,
        right: r.right - rect.left,
        top: r.top - rect.top,
        bottom: r.bottom - rect.top,
        height: r.height
      };
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
