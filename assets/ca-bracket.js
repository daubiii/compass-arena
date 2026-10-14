/* ==========================================================
   Compass Arena — компонент турнирной сетки
   ----------------------------------------------------------
   Раскладка как на The International. Всё считается в пикселях
   по данным матчей (раунды и источники слотов), поэтому подходит
   любой сетке: 4…16 команд, SE и DE, старая сетка M1–M5.

     • «Верхняя сетка» — полосой сверху, раунды слева направо;
     • «Нижняя сетка» — отдельной полосой ниже, на той же сетке колонок:
       финал верхней стоит над финалом нижней;
     • гранд-финал — справа, по вертикали ровно между двумя финалами;
     • у каждой секции своё название и подписи колонок над линией;
     • линии связей — только «победитель идёт дальше». Куда падает
       проигравший, написано в самом слоте («Проигравший M5»), а при
       наведении на матч подсвечиваются оба его пункта назначения.

   Координаты карточек и линий считаются из данных (а не снимаются
   с DOM), поэтому линии не «плывут» при масштабировании и перерисовке.
   ========================================================== */
(function (global) {
  'use strict';

  var CA = global.CA = global.CA || {};
  var D = CA.data;

  /* Геометрия полотна, px. Сама карточка матча не менялась. */
  var G = {
    CARD_W: 236,
    CARD_H: 116,
    FOOT_H: 39,        /* добавочная высота карточки с кнопкой VOD */
    COL_GAP: 60,       /* между колонками: здесь идут линии связей */
    PITCH: 158,        /* шаг карточек первого раунда по вертикали */
    MIN_SEP: 132,      /* меньше этого две карточки одной колонки не сближаются */
    HEAD_H: 86,        /* название секции + подписи колонок, до золотой линии */
    TOP_PAD: 40,       /* от линии до первой карточки */
    SEC_GAP: 60,       /* между верхней и нижней сеткой */
    STACK: 200,        /* шаг стопки в колонке гранд-финала (сброс, матч за 3-е) */
    LABEL_GAP: 36,     /* подпись над карточкой гранд-финала */
    LABELS_Y: 56       /* ряд подписей колонок от верха секции */
  };

  function esc(s) { return D.esc(s); }
  function ic(name, cls) { return CA.ui.icon(name, cls); }
  function byId(a, b) { return a.id - b.id; }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  /* ---------- Раскладка ---------- */

  /** Раунды секции: колонки по возрастанию номера раунда, внутри — по id */
  function sectionColumns(list) {
    var by = {};
    var rounds = [];
    (list || []).forEach(function (m) {
      var r = m.round || 1;
      if (!by[r]) { by[r] = { round: r, matches: [] }; rounds.push(by[r]); }
      by[r].matches.push(m);
    });
    rounds.sort(function (a, b) { return a.round - b.round; });
    rounds.forEach(function (col, i) { col.index = i; col.matches.sort(byId); });
    return rounds;
  }

  /**
   * Вертикальные центры карточек внутри секции (px от начала области карточек).
   * Первый раунд — подряд с шагом PITCH. Матч с двумя источниками встаёт ровно
   * между ними, с одним — на одной высоте с ним (так стоит нижняя сетка: матч,
   * куда падает проигравший сверху, идёт строго напротив своего источника).
   */
  function localCenters(columns) {
    var cy = {};
    columns.forEach(function (col) {
      var prev = null;
      col.matches.forEach(function (m) {
        var src = [m.from1, m.from2]
          .filter(function (s) { return s && s.as === 'w' && cy[s.m] != null; })
          .map(function (s) { return cy[s.m]; });
        var c;
        if (src.length >= 2) c = (Math.min.apply(null, src) + Math.max.apply(null, src)) / 2;
        else if (src.length === 1) c = src[0];
        else c = prev == null ? G.CARD_H / 2 : prev + G.PITCH;
        /* Страховка от наложений при нестандартных данных */
        if (prev != null && c < prev + G.MIN_SEP) c = prev + G.MIN_SEP;
        cy[m.id] = c;
        prev = c;
      });
    });
    return cy;
  }

  /**
   * Номер колонки раунда верхней сетки. В двойной сетке финал верхней должен
   * стоять над финалом нижней, а раунд k верхней — над тем раундом нижней, куда
   * падают его проигравшие (раунд 2 нижней, затем каждый второй). Для обычной
   * формы (нижних раундов вдвое больше) это 0, 1, 3, 5…; если форма нестандартна —
   * раунды идут подряд, а финал уезжает в последнюю колонку.
   */
  function upperColIndex(i, U, L) {
    if (!L) return i;
    if (L === 2 * (U - 1)) return i === 0 ? 0 : 2 * i - 1;
    return i === U - 1 ? Math.max(L, U) - 1 : i;
  }

  function cardHeight(m) {
    return G.CARD_H + ((m.vod && m.state === 'done') ? G.FOOT_H : 0);
  }

  /** Подпись колонки раунда (на русском, регистр делает CSS) */
  function roundTitle(key, i, n, col, ctx) {
    if (ctx.de) {
      if (i === n - 1) return key === 'lower' ? 'Финал нижней сетки' : 'Финал верхней сетки';
      return 'Раунд ' + (i + 1);
    }
    /* Одиночная сетка: считаем от финала */
    var total = n + (ctx.hasFinal ? 1 : 0);
    var left = total - (i + 1);
    if (left === 0) return 'Финал';
    if (left === 1) return 'Полуфинал';
    if (left === 2 && col.matches.length === 4) return 'Четвертьфинал';
    return 'Раунд ' + (i + 1);
  }

  /**
   * Полная раскладка.
   * @returns {{width, height, items, cols, groups, columnCount, de}}
   *   items[id] = { x, y, w, h, cx, cy, col, section }
   */
  function layout(matches) {
    var list = (matches || []).slice().sort(byId);
    var lower = list.filter(function (m) { return m.bracket === 'lower'; });
    var third = list.filter(function (m) { return m.bracket === 'third'; });
    var grand = list.filter(function (m) { return m.bracket === 'grand'; });
    var upper = list.filter(function (m) { return m.bracket !== 'lower' && m.bracket !== 'grand' && m.bracket !== 'third'; });

    var de = lower.length > 0;
    var upCols = sectionColumns(upper);
    var loCols = sectionColumns(lower);
    var U = upCols.length;
    var L = loCols.length;
    var ctx = { de: de, hasFinal: grand.length > 0 };

    var upIdx = upCols.map(function (c, i) { return upperColIndex(i, U, L); });
    var mainCols = Math.max(L, U ? Math.max.apply(null, upIdx) + 1 : 0);
    var extra = (grand.length || third.length) ? 1 : 0;
    var totalCols = mainCols + extra;
    var step = G.CARD_W + G.COL_GAP;
    function colX(i) { return i * step; }
    var width = totalCols ? totalCols * G.CARD_W + (totalCols - 1) * G.COL_GAP : 0;
    var ruleW = mainCols ? mainCols * G.CARD_W + (mainCols - 1) * G.COL_GAP : width;
    if (!de) ruleW = width;

    var items = {};
    var cols = [];
    var groups = [];

    function placeSection(key, title, columns, colIndexOf, top, sectionMatches) {
      var cy = localCenters(columns);
      var originY = top + G.HEAD_H + G.TOP_PAD;
      var bottom = top + G.HEAD_H + G.TOP_PAD;
      var group = { kind: 'section', key: key, title: title, top: top, ruleW: ruleW, columns: [], matches: sectionMatches };

      columns.forEach(function (col, i) {
        var ci = colIndexOf(i);
        var label = roundTitle(key, i, columns.length, col, ctx);
        var meta = { section: key, round: col.round, matches: col.matches, col: ci, x: colX(ci), label: label,
          last: i === columns.length - 1 };
        cols.push(meta);
        var colGroup = {
          head: { x: colX(ci), y: top + G.LABELS_Y, w: G.CARD_W, text: label, final: meta.last && (de || !grand.length) },
          matches: col.matches
        };
        group.columns.push(colGroup);
        col.matches.forEach(function (m) {
          var h = cardHeight(m);
          var y = Math.round(originY + cy[m.id] - h / 2);
          items[m.id] = { id: m.id, col: ci, x: colX(ci), y: y, w: G.CARD_W, h: h,
            cx: colX(ci) + G.CARD_W / 2, cy: y + h / 2, section: key };
          bottom = Math.max(bottom, y + h);
        });
      });
      group.bottom = bottom;
      groups.push(group);
      return group;
    }

    var upperGroup = U ? placeSection('upper', de ? 'Верхняя сетка' : 'Плей-офф', upCols,
      function (i) { return upIdx[i]; }, 0, upper) : null;
    var lowerTop = upperGroup ? upperGroup.bottom + G.SEC_GAP : 0;
    var lowerGroup = L ? placeSection('lower', 'Нижняя сетка', loCols,
      function (i) { return i; }, lowerTop, lower) : null;

    /* Колонка гранд-финала: по вертикали ровно между своими источниками */
    var bottomAll = Math.max(upperGroup ? upperGroup.bottom : 0, lowerGroup ? lowerGroup.bottom : 0);
    if (extra) {
      var gx = colX(mainCols);
      var stack = { kind: 'stack', blocks: [] };
      var first = grand.filter(function (m) { return !m.resetFor; })[0] || grand[0];
      var base;
      var srcs = first ? [first.from1, first.from2]
        .filter(function (s) { return s && items[s.m]; })
        .map(function (s) { return items[s.m].cy; }) : [];
      if (srcs.length >= 2) base = (Math.min.apply(null, srcs) + Math.max.apply(null, srcs)) / 2;
      else if (srcs.length === 1) base = srcs[0];
      else if (upperGroup) base = (G.HEAD_H + G.TOP_PAD + upperGroup.bottom) / 2;
      else base = G.HEAD_H + G.TOP_PAD + G.CARD_H / 2;
      /* Подпись не должна залезать на заголовок секции */
      base = Math.max(base, G.HEAD_H + G.TOP_PAD + G.CARD_H / 2);

      var k = 0;
      var stackList = grand.slice().sort(function (a, b) {
        return (a.resetFor ? 1 : 0) - (b.resetFor ? 1 : 0) || a.id - b.id;
      }).concat(third);
      stackList.forEach(function (m) {
        var h = cardHeight(m);
        var c = base + k * G.STACK;
        var y = Math.round(c - h / 2);
        items[m.id] = { id: m.id, col: mainCols, x: gx, y: y, w: G.CARD_W, h: h, cx: gx + G.CARD_W / 2,
          cy: y + h / 2, section: m.bracket === 'third' ? 'third' : 'grand' };
        var text;
        if (m.bracket === 'third') text = 'Матч за 3-е место';
        else if (m.resetFor) text = 'Гранд-финал · сброс';
        else text = de ? 'Гранд-финал' : 'Финал';
        /* В одиночной сетке подпись финала стоит в общем ряду подписей, как у остальных колонок */
        var headY = (!de && k === 0) ? G.LABELS_Y : y - G.LABEL_GAP;
        /* В одиночной сетке подпись «Финал» — обычная колонка в ряду подписей, без отдельного подчёркивания */
        var inRow = !de && k === 0;
        stack.blocks.push({ head: { x: gx, y: headY, w: G.CARD_W, text: text, final: m.bracket !== 'third', grand: !inRow }, match: m });
        bottomAll = Math.max(bottomAll, y + h);
        k++;
      });
      cols.push({ section: 'grand', round: first ? first.round : 0, matches: grand.concat(third), col: mainCols,
        x: gx, label: de ? 'Гранд-финал' : 'Финал', last: true });
      groups.push(stack);
    }

    /* Совместимость со служебными скриптами проверки: row/span — это y/h в пикселях */
    Object.keys(items).forEach(function (id) { items[id].row = items[id].y; items[id].span = items[id].h; });

    return {
      rows: bottomAll ? bottomAll + 6 : 0,
      unit: 1,
      tracks: cols,
      width: width,
      height: bottomAll ? bottomAll + 6 : 0,
      items: items,
      cols: cols,
      groups: groups,
      columnCount: totalCols,
      mainCols: mainCols,
      de: de,
      upperBottom: upperGroup ? upperGroup.bottom : 0,
      cardW: G.CARD_W,
      cardH: G.CARD_H
    };
  }

  /** Подпись колонки (для тестов и внешних вызовов) */
  function colLabel(col) {
    if (col && col.label) return col.label;
    if (col && col.section === 'lower') return 'Раунд ' + col.round;
    if (col && col.section === 'grand') return 'Финал';
    return 'Раунд ' + (col ? col.round : '');
  }

  /* ---------- Карточка матча (внешний вид не менялся) ---------- */

  function statusHtml(m) {
    if (m.state === 'live') return '<span class="st st-live"><span class="dot-live"></span>В эфире</span>';
    if (m.bye && m.winner) return '<span class="st st-done">' + ic('check') + 'Без игры</span>';
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

  function matchHtml(m, lay, dest) {
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
    var style = pos ? 'left:' + pos.x + 'px;top:' + pos.y + 'px;width:' + pos.w + 'px;height:' + pos.h + 'px;' : '';

    /* Название стадии стоит над колонкой, поэтому в шапке карточки — только номер матча */
    var head = '<div class="match-head">' +
      '<span class="m-id">M' + m.id + '</span>' +
      statusHtml(m) +
      '</div>';

    var vod = '';
    if (m.vod && m.state === 'done') {
      vod = '<a class="btn btn-quiet btn-sm vod-link" href="' + esc(m.vod) + '" target="_blank" rel="noopener">' +
        ic('play') + 'VOD</a>';
    }

    var body = m.idle
      ? '<div class="slot is-tbd is-note"><span class="slot-name">соперник прошёл без игры</span></div>'
      : (slotHtml(m, 1) + slotHtml(m, 2));

    var d = dest[m.id] || {};
    var srcIds = [m.from1, m.from2].filter(Boolean).map(function (s) { return s.m; });
    var attrs = ' data-match="' + m.id + '"' +
      (d.w ? ' data-w-to="' + d.w + '"' : '') +
      (d.l ? ' data-l-to="' + d.l + '"' : '') +
      (srcIds.length ? ' data-src="' + srcIds.join(',') + '"' : '');

    return '<div class="' + cls + '"' + attrs + ' title="' + esc(D.stageLabel(m)) + '" style="' + style + '">' +
      head + body +
      (vod ? '<div class="match-foot">' + vod + '</div>' : '') +
      '</div>';
  }

  /* ---------- Заголовки ---------- */

  function headHtml(h) {
    var cls = 'b-col-head' + (h.final ? ' is-final' : '') + (h.grand ? ' is-grand' : '');
    return '<div class="' + cls + '" style="left:' + h.x + 'px;top:' + h.y + 'px;width:' + h.w + 'px">' +
      '<b>' + esc(h.text) + '</b></div>';
  }

  function sectionHeadHtml(g) {
    var playable = g.matches.filter(function (m) { return !m.idle && !m.bye; });
    var done = playable.filter(function (m) { return !!m.winner; }).length;
    var meta = playable.length ? done + ' / ' + playable.length + ' сыграно' : '';
    return '<div class="b-sec" data-sec="' + g.key + '" style="top:' + g.top + 'px;width:' + g.ruleW + 'px">' +
      '<h3 class="b-sec-title">' + esc(g.title) + '</h3>' +
      (meta ? '<span class="b-sec-meta">' + esc(meta) + '</span>' : '') +
      '</div>' +
      '<div class="b-rule" style="top:' + (g.top + G.HEAD_H) + 'px;width:' + g.ruleW + 'px"></div>';
  }

  /* ---------- Линии связей ---------- */

  /**
   * Только «победитель идёт дальше». У цели с двумя источниками — одна скобка:
   * от каждого источника вправо до середины зазора, вертикаль к центру цели и
   * общий отрезок в карточку. Проигравшего линиями не рисуем: они пересекали бы
   * полотно, а в слоте и так написано «Проигравший M…».
   */
  function linesHtml(lay, matches) {
    var map = {};
    matches.forEach(function (m) { map[m.id] = m; });
    var out = [];
    function p(d, state, a, b) {
      var cls = state ? ' class="' + state + '"' : '';
      out.push('<path' + cls + ' data-a="' + a + '" data-b="' + b + '" d="' + d + '"/>');
    }
    function n(v) { return Math.round(v) + .5; }

    matches.forEach(function (t) {
      var tp = lay.items[t.id];
      if (!tp) return;
      var srcs = [t.from1, t.from2].filter(function (s) { return s && s.as === 'w' && lay.items[s.m]; });
      if (!srcs.length) return;

      var xm = n(tp.x - G.COL_GAP / 2);
      var ty = n(tp.cy);
      var tx = n(tp.x);
      var anyDone = false;
      var anyLive = false;
      var needJoin = false;

      srcs.forEach(function (s) {
        var sp = lay.items[s.m];
        var sm = map[s.m];
        var done = !!(sm && sm.winner);
        var live = !!(sm && sm.state === 'live');
        anyDone = anyDone || done;
        anyLive = anyLive || live;
        var state = done ? 'on' : (live ? 'live' : '');
        var x1 = n(sp.x + sp.w);
        var y1 = n(sp.cy);
        if (x1 > xm) return;
        if (srcs.length === 1 && Math.abs(y1 - ty) < 1) {
          p('M' + x1 + ' ' + y1 + ' H' + tx, state, s.m, t.id);
        } else {
          p('M' + x1 + ' ' + y1 + ' H' + xm + ' V' + ty, state, s.m, t.id);
          needJoin = true;
        }
      });
      if (needJoin) p('M' + xm + ' ' + ty + ' H' + tx, anyDone ? 'on' : (anyLive ? 'live' : ''), 'j', t.id);
    });

    return '<svg class="b-lines" width="' + lay.width + '" height="' + lay.height + '" viewBox="0 0 ' +
      lay.width + ' ' + lay.height + '" aria-hidden="true">' + out.join('') + '</svg>';
  }

  /** Куда идут победитель и проигравший каждого матча (по связям from1/from2) */
  function destinationsOf(matches) {
    var dest = {};
    matches.forEach(function (m) {
      [m.from1, m.from2].forEach(function (s) {
        if (!s) return;
        dest[s.m] = dest[s.m] || {};
        if (s.as === 'l') dest[s.m].l = m.id; else dest[s.m].w = m.id;
      });
    });
    return dest;
  }

  /* ---------- Полная разметка ---------- */

  function html(data) {
    var D0 = data || D.get();
    var matches = (D0.matches || []).slice().sort(byId);
    var lay = layout(matches);
    if (!matches.length || !lay.columnCount) {
      return '<div class="b-stage"><div class="bracket" data-cols="0" data-w="0" data-h="0"></div></div>';
    }
    var dest = destinationsOf(matches);
    var parts = [];

    lay.groups.forEach(function (g) {
      if (g.kind === 'section') {
        parts.push(sectionHeadHtml(g));
        g.columns.forEach(function (c) {
          parts.push(headHtml(c.head));
          c.matches.forEach(function (m) { parts.push(matchHtml(m, lay, dest)); });
        });
      } else {
        g.blocks.forEach(function (b) {
          parts.push(headHtml(b.head));
          parts.push(matchHtml(b.match, lay, dest));
        });
      }
    });
    parts.push(linesHtml(lay, matches));

    return '<div class="b-stage" style="width:' + lay.width + 'px;height:' + lay.height + 'px">' +
      '<div class="bracket' + (lay.de ? ' is-de' : ' is-se') + '" data-cols="' + lay.columnCount + '"' +
      ' data-w="' + lay.width + '" data-h="' + lay.height + '"' +
      ' style="width:' + lay.width + 'px;height:' + lay.height + 'px">' +
      parts.join('') + '</div></div>';
  }

  /* ---------- Подсветка связей при наведении ---------- */

  function clearHighlight(root) {
    each(root.querySelectorAll('.is-hl, .is-hl-win, .is-hl-lose, .is-hl-src, .b-lines .hl'), function (el) {
      el.classList.remove('is-hl', 'is-hl-win', 'is-hl-lose', 'is-hl-src', 'hl');
    });
  }

  function highlight(root, card) {
    clearHighlight(root);
    var id = card.getAttribute('data-match');
    card.classList.add('is-hl');
    function mark(matchId, cls) {
      if (!matchId) return;
      var el = root.querySelector('.match[data-match="' + matchId + '"]');
      if (el) el.classList.add(cls);
    }
    mark(card.getAttribute('data-w-to'), 'is-hl-win');
    mark(card.getAttribute('data-l-to'), 'is-hl-lose');
    (card.getAttribute('data-src') || '').split(',').forEach(function (s) { mark(s, 'is-hl-src'); });
    each(root.querySelectorAll('.b-lines path'), function (path) {
      var a = path.getAttribute('data-a');
      var b = path.getAttribute('data-b');
      if (a === id || b === id) path.classList.add('hl');
    });
  }

  function bindHover(root) {
    if (root._caHoverBound) return;
    root._caHoverBound = true;
    root.addEventListener('mouseover', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('.match') : null;
      if (card && root.contains(card)) highlight(root, card);
    });
    root.addEventListener('mouseout', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('.match') : null;
      if (!card) return;
      if (e.relatedTarget && card.contains(e.relatedTarget)) return;
      clearHighlight(root);
    });
    root.addEventListener('focusin', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('.match') : null;
      if (card) highlight(root, card);
    });
    root.addEventListener('focusout', function () { clearHighlight(root); });
  }

  /* ---------- Масштаб превью ---------- */

  /**
   * Вписывает полотно по ширине контейнера (превью на странице). Сетка — это
   * готовое полотно W×H, поэтому масштаб — просто transform: scale. В узком
   * окне (телефон) раскладку берёт на себя CSS (вертикальная лента).
   */
  function fit(root, opts) {
    opts = opts || {};
    var stage = root.querySelector('.b-stage');
    var box = root.querySelector('.bracket');
    if (!stage || !box) return 1;
    var W = Number(box.getAttribute('data-w')) || 0;
    var H = Number(box.getAttribute('data-h')) || 0;
    if (!W || !H) return 1;

    var s = 1;
    if (opts.fit !== false) {
      var avail = root.clientWidth || (root.parentNode && root.parentNode.clientWidth) || 0;
      if (avail) s = Math.max(opts.minScale || 0.42, Math.min(1, avail / W));
    }
    box.style.setProperty('--s', String(s));
    if (opts.fit !== false) {
      stage.style.width = Math.round(W * s) + 'px';
      stage.style.height = Math.round(H * s) + 'px';
    }
    root._caScale = s;
    return s;
  }

  /** Размеры полотна и текущий масштаб — для компактного вида на главной */
  function metrics(root) {
    var box = root && root.querySelector ? root.querySelector('.bracket') : null;
    var W = box ? Number(box.getAttribute('data-w')) || 0 : 0;
    var H = box ? Number(box.getAttribute('data-h')) || 0 : 0;
    var s = (root && root._caScale) || 1;
    return { width: W, height: H, scale: s, scaledHeight: Math.round(H * s) };
  }

  /* ---------- Монтирование ---------- */

  function render(root, opts) {
    if (!root) return;
    opts = opts || {};
    root.innerHTML = html(opts.data);
    root._caOpts = opts;
    bindHover(root);
    fit(root, opts);

    if (opts.fit !== false && global.ResizeObserver) {
      if (!root._caRO) {
        root._caRO = new global.ResizeObserver(function () {
          var before = root._caScale;
          fit(root, root._caOpts);
          /* Масштаб поменялся (окно сузили/расширили) — страница пересчитывает обрезку */
          if (root._caScale !== before && root._caOpts && root._caOpts.onFit) root._caOpts.onFit(root._caScale);
        });
        root._caRO.observe(root);
      }
    } else if (root._caRO) {
      root._caRO.disconnect();
      root._caRO = null;
    }
  }

  function autoInit(root, opts) { render(root, opts); }

  /** Линии теперь строятся вместе с разметкой; функция оставлена для совместимости */
  function drawLines() { return; }

  CA.bracket = {
    html: html,
    render: render,
    fit: fit,
    metrics: metrics,
    drawLines: drawLines,
    autoInit: autoInit,
    layout: layout,
    sectionColumns: sectionColumns,
    colLabel: colLabel,
    geometry: G
  };
})(typeof window !== 'undefined' ? window : globalThis);
