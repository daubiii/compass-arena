/* ==========================================================
   Compass Arena — архив организации (history.html)
   ----------------------------------------------------------
   Страница собирает всю историю турниров в «книгу глав»:
     • первый экран со сводными цифрами по всей истории;
     • текущий сезон отдельной главой (идёт / завершён / до старта);
     • главы архива: обложка, чемпион, финалист, MVP, путь к титулу,
       галерея с лайтбоксом;
     • сводка чемпионов и таблица клубов и титулов;
     • витрина MVP, навигация по главам, JSON-LD.
   Вся разметка — в этом файле, HTML содержит только «скелет».
   Стиль кода: ES5 (var/function), как в остальных файлах проекта.
   ========================================================== */
(function (global) {
  'use strict';

  var CA = global.CA = global.CA || {};

  function D() { return CA.data; }
  function U() { return CA.ui; }
  function esc(s) { return D().esc(s); }
  function ic(n, c) { return U().icon(n, c); }
  function isObs() { return 'IntersectionObserver' in global; }

  /* ---------- Мелкие помощники ---------- */
  function pad2(n) {
    var s = String(n);
    return s.length < 2 ? '0' + s : s;
  }
  function byId(list, id) {
    list = list || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }
  function nameOf(list, id) {
    var t = byId(list, id);
    return t && t.name ? t.name : '—';
  }
  function photosOf(h) {
    var out = [];
    var src = (h && h.photos) || [];
    for (var i = 0; i < src.length; i++) {
      if (src[i] && src[i].url) out.push(src[i]);
    }
    return out;
  }
  function createdTs(h) {
    if (!h) return 0;
    var t = h.createdAt ? new Date(h.createdAt).getTime() : NaN;
    return isNaN(t) ? 0 : t;
  }
  function sortHistory(list) {
    return (list || []).slice().sort(function (a, b) {
      var d = createdTs(a) - createdTs(b);
      if (d) return d;
      return String((a && a.id) || '') < String((b && b.id) || '') ? -1 : 1;
    });
  }
  function dateText(h) {
    if (h && h.date) return String(h.date);
    var t = createdTs(h);
    if (!t) return '';
    return D().whenDate(t, { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function isSlotName(name) {
    /* «Слот 1», «Команда 3» и пустые имена — заглушки, а не команды */
    return D().isPlaceholderName ? D().isPlaceholderName(name) : (!name || /^Слот\s*\d+$/i.test(String(name).trim()));
  }

  /* ---------- Нумерация турниров ----------
     Одинаковые названия («Compass Arena» и «Compass Arena») разводим
     номерами: «Compass Arena #1», «Compass Arena #2». */
  function decorateSeasons(sorted) {
    var counts = {}, seen = {};
    for (var i = 0; i < sorted.length; i++) {
      var k = String((sorted[i] && sorted[i].name) || 'Compass Arena').trim().toLowerCase();
      counts[k] = (counts[k] || 0) + 1;
    }
    return sorted.map(function (h, i) {
      var key = String((h && h.name) || 'Compass Arena').trim().toLowerCase();
      seen[key] = (seen[key] || 0) + 1;
      var base = (h && h.name) || 'Compass Arena';
      return {
        h: h,
        index: i,
        season: i + 1,
        ordinal: seen[key],
        repeat: counts[key] > 1,
        label: counts[key] > 1 ? base + ' #' + seen[key] : base
      };
    });
  }
  function plural(n, one, few, many) { return D().plural(n, one, few, many); }
  function teamCardName(name, mark, cls) {
    return '<span class="now-team' + (cls ? ' ' + cls : '') + '">' +
      (mark || '') + esc(name) + '</span>';
  }

  /* ---------- Нормализация матчей истории ----------
     Админка отдаёт историю как есть, поэтому приводим поля
     к тому же виду, что и у текущего турнира. */
  function matchesOf(h) {
    var src = (h && h.matches) || [];
    var out = [];
    for (var i = 0; i < src.length; i++) {
      var m = src[i];
      if (!m) continue;
      var w = m.winner == null || m.winner === '' ? null : parseInt(m.winner, 10);
      if (isNaN(w)) w = null;
      out.push({
        id: m.id,
        round: m.round == null || m.round === '' ? 1 : parseInt(m.round, 10) || 1,
        bracket: m.bracket || 'upper',
        team1: m.team1 == null || m.team1 === '' ? null : parseInt(m.team1, 10),
        team2: m.team2 == null || m.team2 === '' ? null : parseInt(m.team2, 10),
        winner: w,
        score1: m.score1 == null || m.score1 === '' ? null : parseInt(m.score1, 10),
        score2: m.score2 == null || m.score2 === '' ? null : parseInt(m.score2, 10),
        vod: m.vod || '',
        scheduled: m.scheduled || null,
        num: parseInt(m.num, 10) || parseInt(m.id, 10) || 0,
        label: m.label ? String(m.label) : '',
        final: !!m.final,
        played: !!w
      });
    }
    return out;
  }
  /* Подпись стадии для матча главы. list — все матчи этой главы (нужны, чтобы понять, где финал сетки) */
  function stageOf(m, list) {
    if (!m) return '';
    if (m.label) return m.label;
    list = list || [];
    function has(b) { return list.some(function (x) { return x.bracket === b; }); }
    function maxRound(b) {
      var r = 0;
      list.forEach(function (x) { if (x.bracket === b && x.round > r) r = x.round; });
      return r;
    }
    if (m.bracket === 'grand') {
      var rounds = [];
      list.forEach(function (x) { if (x.bracket === 'grand' && rounds.indexOf(x.round) === -1) rounds.push(x.round); });
      rounds.sort(function (a, b) { return a - b; });
      return rounds.indexOf(m.round) >= 1 ? 'Гранд-финал · сброс' : 'Гранд-финал';
    }
    if (m.bracket === 'third') return 'Матч за 3-е место';
    if (m.bracket === 'lower') return m.round === maxRound('lower') ? 'Финал нижней сетки' : 'Нижняя сетка · раунд ' + m.round;
    var fromEnd = maxRound('upper') - m.round;
    if (has('lower')) {
      if (fromEnd === 0) return 'Финал верхней сетки';
      if (fromEnd === 1) return 'Полуфинал верхней сетки';
      return 'Верхняя сетка · раунд ' + m.round;
    }
    if (has('grand')) return fromEnd === 0 ? 'Полуфинал' : 'Раунд ' + m.round;
    if (fromEnd === 0 && maxRound('upper') > 1) return 'Финал';
    if (fromEnd === 1) return 'Полуфинал';
    if (fromEnd === 2) return 'Четвертьфинал';
    return 'Раунд ' + (m.round || 1);
  }
  function loserOf(m) {
    if (!m || !m.winner) return null;
    if (m.team1 === m.winner) return m.team2;
    if (m.team2 === m.winner) return m.team1;
    return null;
  }
  function scoreOf(m) {
    if (!m || m.score1 == null || m.score2 == null) return '';
    return m.score1 + ':' + m.score2;
  }
  /* Финальная серия главы: матч с пометкой final, иначе гранд-финал (последний по порядку), иначе последний сыгранный */
  function isFinalish(m) { return !!m && (m.final || m.bracket === 'grand'); }
  function grandOf(list) {
    var played = list.filter(function (m) { return m.played; });
    var flagged = played.filter(function (m) { return m.final; });
    if (flagged.length) return flagged[flagged.length - 1];
    var grands = played.filter(function (m) { return m.bracket === 'grand'; })
      .sort(function (a, b) { return a.round - b.round || a.num - b.num; });
    if (grands.length) return grands[grands.length - 1];
    var rest = played.filter(function (m) { return m.bracket !== 'third'; })
      .sort(function (a, b) { return a.num - b.num; });
    return rest.length ? rest[rest.length - 1] : null;
  }

  /* ---------- Агрегация по всем турнирам ----------
     Считаем все зафиксированные турниры архива и текущий сезон,
     если в нём уже определился чемпион. */
  function allTime(d) {
    var history = d.history || [];
    var res = {
      tournaments: 0,
      matches: 0,
      teams: [],
      clubs: {},
      order: [],
      clubList: [],
      currentPlayed: false
    };
    var seenTeams = {};

    function club(team) {
      if (!team || isSlotName(team.name)) return null;
      var key = String(team.id) + ':' + String(team.name);
      var c = res.clubs[key];
      if (!c) {
        c = res.clubs[key] = { team: team, titles: 0, finals: 0, played: 0, wins: 0, losses: 0, mapsWon: 0, mapsLost: 0 };
        res.order.push(key);
      }
      return c;
    }

    function collectTeams(teams) {
      for (var t = 0; t < (teams || []).length; t++) {
        var team = teams[t];
        if (!team || isSlotName(team.name)) continue;
        var nameKey = String(team.name).trim().toLowerCase();
        if (seenTeams[nameKey]) continue;
        seenTeams[nameKey] = true;
        res.teams.push(team);
      }
    }

    function account(teams, list, isCurrent) {
      res.tournaments++;
      res.matches += list.length;
      collectTeams(teams);
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (!m.played) continue;
        var s1 = m.score1, s2 = m.score2;
        var has = s1 != null && s2 != null;
        var w = byId(teams, m.winner);
        var l = byId(teams, loserOf(m));
        if (w) {
          var cw = club(w);
          if (cw) {
            cw.played++;
            cw.wins++;
            if (has) { cw.mapsWon += (m.winner === m.team1 ? s1 : s2); cw.mapsLost += (m.winner === m.team1 ? s2 : s1); }
          }
          if (isCurrent) res.currentPlayed = true;
        }
        if (l) {
          var cl = club(l);
          if (cl) {
            cl.played++;
            cl.losses++;
            if (has) { cl.mapsWon += (l.id === m.team1 ? s1 : s2); cl.mapsLost += (l.id === m.team1 ? s2 : s1); }
          }
          if (isCurrent) res.currentPlayed = true;
        }
      }
    }

    for (var i = 0; i < history.length; i++) {
      var h = history[i] || {};
      var teams = h.teams || [];
      account(teams, matchesOf(h), false);

      var champ = byId(teams, h.championId);
      var runner = byId(teams, h.runnerUpId);
      if (champ) {
        var cc = club(champ);
        if (cc) { cc.titles++; cc.finals++; }
      }
      if (runner) {
        var cr = club(runner);
        if (cr) cr.finals++;
      }
    }

    for (var o = 0; o < res.order.length; o++) res.clubList.push(res.clubs[res.order[o]]);
    res.clubList.sort(function (a, b) {
      if (b.titles !== a.titles) return b.titles - a.titles;
      if (b.finals !== a.finals) return b.finals - a.finals;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return (b.mapsWon - b.mapsLost) - (a.mapsWon - a.mapsLost);
    });
    return res;
  }

  /* ==========================================================
     Первый экран
     ========================================================== */
  function heroPhoto(sorted) {
    for (var i = sorted.length - 1; i >= 0; i--) {
      var list = photosOf(sorted[i]);
      if (list.length) return { url: list[0].url, caption: list[0].caption || '', tournament: sorted[i].name || '' };
    }
    return null;
  }

  function renderHero(d, sorted, at) {
    var img = document.getElementById('heroImg');
    var sub = document.getElementById('heroSub');
    var kicker = document.getElementById('heroKicker');
    var figures = document.getElementById('heroFigures');
    var photo = heroPhoto(sorted);
    var latest = sorted.length ? sorted[sorted.length - 1] : null;
    var latestChamp = latest ? byId(latest.teams, latest.championId) : null;
    if (img) {
      img.src = photo ? photo.url : '/img/hero.webp';
      img.alt = photo
        ? (photo.caption || 'Кадр с турнира ' + (photo.tournament || 'Compass Arena'))
        : 'Тёмная арена турнира Compass Arena';
    }
    if (kicker) {
      kicker.textContent = at.tournaments
        ? 'Архив организации · ' + at.tournaments + ' ' + plural(at.tournaments, 'турнир', 'турнира', 'турниров') + ' в истории'
        : 'Архив организации';
    }
    if (sub) {
      var text;
      if (latestChamp) {
        text = 'Последний титул взяла команда «' + latestChamp.name + '». Ниже — все завершённые турниры организации, один за другим.';
      } else if (at.tournaments) {
        text = 'В архиве ' + at.tournaments + ' ' + plural(at.tournaments, 'турнир', 'турнира', 'турниров') + '. Чемпионы, ключевые серии и кадры с турниров — по главам.';
      } else {
        text = 'Здесь появятся завершённые турниры: чемпион, состав, путь к титулу и фотографии. Турнир попадает в архив, когда организаторы закрепляют его итоги.';
      }
      sub.textContent = text;
    }

    if (figures) {
      var html = '';
      html += figure(at.tournaments, 'турниров в архиве');
      html += figure(at.matches, 'матчей сыграно');
      html += figure(at.teams.length, 'команд за историю');
      html += figure(latestChamp ? latestChamp.name : '—', 'действующий чемпион', true);
      figures.innerHTML = html;
    }
  }

  function figure(value, label, plain) {
    return '<div class="h-figure' + (plain ? ' plain' : '') + '"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }

  /* ==========================================================
     Глава архива
     ========================================================== */
  function rosterHtml(team) {
    var players = (team && team.players) || [];
    if (!players.length) return '<p class="ch-quiet">Состав не сохранён.</p>';
    return '<ul class="ch-roster">' + players.map(function (p, i) {
      var nick = typeof p === 'string' ? p : (p.nick || p.name || '—');
      var role = typeof p === 'string' ? (i + 1) : (p.role || (i + 1));
      return '<li><b>' + esc(nick) + '</b><span>' + esc(D().roleName(role)) + '</span></li>';
    }).join('') + '</ul>';
  }

  function ladderRows(list, teams) {
    var played = [];
    for (var i = 0; i < list.length; i++) if (list[i].played) played.push(list[i]);
    /* порядок игры (номер матча), а не раунд: так читается и двойная сетка */
    played.sort(function (a, b) { return a.num - b.num; });
    return played.map(function (m) {
      var stage = stageOf(m, list);
      var grand = isFinalish(m);
      var sc = scoreOf(m);
      return '<div class="ch-row">' +
        '<div class="stage' + (grand ? ' is-grand' : '') + '">' + esc(stage) + '</div>' +
        '<div class="vs"><span class="win">' + esc(nameOf(teams, m.winner)) + '</span>' +
          (sc ? '<span class="score">' + esc(sc) + '</span>' : '<span class="sides">победа</span>') +
          '<span class="lose">' + esc(nameOf(teams, loserOf(m))) + '</span></div>' +
        '<div class="sides">' + (sc ? 'карты' : '') + '</div>' +
      '</div>';
    }).join('');
  }

  /* Просмотрщик фото: на виду один кадр целиком (без обрезки, на размытой подложке из него же),
     справа заметная стрелка «Ещё N» — приглашение листать. Клик по кадру — полноэкранный режим. */
  function photoAlt(p, chapterName, n) {
    return p.caption || ('Фото с турнира ' + chapterName + ' — кадр ' + n);
  }
  function viewerHtml(photos, chapterId, chapterName) {
    if (!photos.length) return '';
    var n = photos.length;
    var slides = photos.map(function (p, i) {
      var alt = photoAlt(p, chapterName, i + 1);
      var src = i === 0 ? 'src="' + esc(p.url) + '"' : 'data-src="' + esc(p.url) + '"';
      return '<figure class="pv-slide' + (i === 0 ? ' is-on' : '') + '" data-cap="' + esc(p.caption || '') + '"' + (i === 0 ? '' : ' aria-hidden="true"') + '>' +
        '<img class="pv-bg" ' + src + ' alt="" aria-hidden="true" decoding="async">' +
        '<img class="pv-img" ' + src + ' alt="' + esc(alt) + '" decoding="async">' +
      '</figure>';
    }).join('');
    var controls = n > 1
      ? '<button class="pv-btn pv-prev" type="button" aria-label="Предыдущее фото" hidden>' + ic('arrow-right') + '</button>' +
        '<button class="pv-btn pv-next" type="button" aria-label="Следующее фото"><span class="pv-more">Ещё ' + (n - 1) + '</span>' + ic('arrow-right') + '</button>'
      : '';
    var segs = '';
    if (n > 1 && n <= 14) {
      for (var k = 0; k < n; k++) segs += '<i' + (k === 0 ? ' class="is-on"' : '') + '></i>';
      segs = '<div class="pv-segs" aria-hidden="true">' + segs + '</div>';
    }
    return '<div class="pv reveal" data-gallery="' + esc(chapterId) + '" data-gname="' + esc(chapterName) + '" data-n="' + n + '"' +
        ' role="group" aria-roledescription="карусель" aria-label="Фотографии: ' + esc(chapterName) + '">' +
      '<div class="pv-stage">' + slides + controls + '</div>' +
      segs +
      '<div class="pv-bar"><span class="pv-cap" aria-live="polite">' + esc(photos[0].caption || '') + '</span>' +
        (n > 1 ? '<span class="pv-count"><b>1</b> / ' + n + '</span>' : '') + '</div>' +
    '</div>';
  }

  function initViewers() {
    var viewers = document.querySelectorAll('.pv');
    Array.prototype.forEach.call(viewers, function (pv) {
      var slides = pv.querySelectorAll('.pv-slide');
      var n = slides.length;
      var cur = 0;
      var cap = pv.querySelector('.pv-cap');
      var cnt = pv.querySelector('.pv-count b');
      var segs = pv.querySelectorAll('.pv-segs i');
      var prev = pv.querySelector('.pv-prev');
      var next = pv.querySelector('.pv-next');

      function load(i) {
        var sl = slides[(i + n) % n];
        Array.prototype.forEach.call(sl.querySelectorAll('img[data-src]'), function (img) {
          img.src = img.getAttribute('data-src');
          img.removeAttribute('data-src');
        });
      }
      function go(to, user) {
        to = (to + n) % n;
        if (to === cur) return;
        load(to);
        slides[cur].classList.remove('is-on');
        slides[cur].setAttribute('aria-hidden', 'true');
        slides[to].classList.add('is-on');
        slides[to].removeAttribute('aria-hidden');
        if (segs.length) { segs[cur].classList.remove('is-on'); segs[to].classList.add('is-on'); }
        cur = to;
        if (cap) cap.textContent = slides[cur].getAttribute('data-cap') || '';
        if (cnt) cnt.textContent = String(cur + 1);
        if (user) {
          pv.classList.add('is-touched');
          if (prev) prev.hidden = false;
        }
        load(cur + 1);
      }
      pv._go = go;
      pv._cur = function () { return cur; };
      if (n < 2) return;
      load(1);
      next.addEventListener('click', function (e) { e.stopPropagation(); go(cur + 1, true); });
      prev.addEventListener('click', function (e) { e.stopPropagation(); go(cur - 1, true); });
      pv.setAttribute('tabindex', '0');
      pv.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { go(cur + 1, true); e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { go(cur - 1, true); e.preventDefault(); }
      });
      var x0 = null;
      var stage = pv.querySelector('.pv-stage');
      stage.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
      stage.addEventListener('touchend', function (e) {
        if (x0 == null) return;
        var dx = e.changedTouches[0].clientX - x0;
        x0 = null;
        if (Math.abs(dx) > 40) go(cur + (dx < 0 ? 1 : -1), true);
      }, { passive: true });
    });
  }

  function chapterHtml(entry, dur) {
    var item = (entry && entry.h) || {};
    var index = entry && entry.index != null ? entry.index : 0;
    var season = entry && entry.season ? entry.season : index + 1;
    var teams = item.teams || [];
    var list = matchesOf(item);
    var champion = byId(teams, item.championId);
    var runner = byId(teams, item.runnerUpId);
    var photos = photosOf(item);
    var no = pad2(season);
    var chapterId = 'ch-' + (item.id != null ? item.id : index);
    var title = (entry && entry.label) || item.name || 'Compass Arena';
    var grand = grandOf(list);
    var score = scoreOf(grand);
    var date = dateText(item);
    var tag = item.game ? String(item.game) : '';

    /* Чемпион: имя, финал, состав списком */
    var champBlock;
    if (champion) {
      champBlock = '<p class="ch-k">Чемпион</p>' +
        '<div class="ch-champ-name">' + esc(champion.name) + '</div>' +
        (runner ? '<p class="ch-final">Гранд-финал против ' + esc(runner.name) + (score ? ', ' + esc(score) : '') + '</p>' : '') +
        rosterHtml(champion);
    } else {
      champBlock = '<p class="ch-k">Чемпион</p><p class="ch-quiet">В этой главе чемпион не зафиксирован.</p>';
    }

    /* MVP либо финалист — если MVP не сохранили */
    var sideBlock;
    if (item.mvp && item.mvp.playerNick) {
      var mvpTeam = byId(teams, item.mvp.teamId);
      sideBlock = '<p class="ch-k">MVP турнира</p>' +
        '<div class="ch-mvp">' +
          '<div class="mvp-name">' + esc(item.mvp.playerNick) + '</div>' +
          (mvpTeam ? '<div class="mvp-team">' + esc(mvpTeam.name) + '</div>' : '') +
          (item.mvp.note ? '<p class="mvp-note">' + esc(item.mvp.note) + '</p>' : '') +
        '</div>';
    } else {
      sideBlock = '<p class="ch-k">Финалист</p>' +
        (runner
          ? '<div class="ch-champ-name is-runner">' + esc(runner.name) + '</div>' + rosterHtml(runner)
          : '<p class="ch-quiet">Данные о финалисте не сохранены.</p>');
    }

    var rows = ladderRows(list, teams);
    var ladderHtml = rows
      ? '<div class="ch-ladder"><h3 class="ch-h">Путь к титулу</h3><div class="ch-rows">' + rows + '</div></div>'
      : '';

    /* Дата уже стоит в марке главы — в чипах её не повторяем */
    var facts = [];
    if (item.format) facts.push('<span class="h-fact">' + esc(item.format) + '</span>');
    facts.push('<span class="h-fact">' + esc(tag) + '</span>');
    if (list.length) {
      var playedCount = 0;
      for (var i = 0; i < list.length; i++) if (list[i].played) playedCount++;
      facts.push('<span class="h-fact">' + playedCount + ' ' + plural(playedCount, 'серия', 'серии', 'серий') + '</span>');
    }

    return '<section class="ch' + (season % 2 === 0 ? ' is-alt' : '') + '" id="' + esc(chapterId) +
        '" data-chapter="' + no + '" data-season="' + season + '" data-title="' + esc(title) + '">' +
        '<div class="wrap">' +
          '<div class="h-mark"><span class="no">Турнир №' + season + ' из ' + pad2(dur) + '</span><span class="rule"></span><span class="date">' + esc(date) + '</span></div>' +
          '<div class="ch-title reveal"><h2>' + esc(title) + '</h2><div class="ch-meta">' + facts.join('') + '</div></div>' +
          viewerHtml(photos, chapterId, title) +
          '<div class="ch-story">' +
            '<div class="ch-block reveal">' + champBlock + '</div>' +
            '<div class="ch-block reveal">' + sideBlock + '</div>' +
          '</div>' +
          ladderHtml +
          '<div class="ch-end"><div class="rule"></div></div>' +
        '</div>' +
      '</section>';
  }

  /* ==========================================================
     Навигация по главам
     ========================================================== */
  function renderNav(chapters) {
    var nav = document.getElementById('chapterNav');
    var inner = document.getElementById('chapterNavInner');
    if (!nav || !inner) return;
    if (chapters.length <= 1) {
      nav.hidden = true;
      inner.innerHTML = '';
      return;
    }
    nav.hidden = false;
    inner.innerHTML = chapters.map(function (c) {
      return '<a class="h-chip' + (c.current ? ' is-current' : '') + '" href="#' + esc(c.id) + '" data-target="' + esc(c.id) + '">' +
        '<span class="no">' + esc(c.no) + '</span><span class="ttl">' + esc(c.title) + '</span>' +
        (c.date ? '<span class="dt">' + esc(c.date) + '</span>' : '') + '</a>';
    }).join('');
  }

  /* ==========================================================
     Сводные таблицы
     ========================================================== */
  function championsTable(entries) {
    if (!entries.length) return '';
    var rows = entries.map(function (entry) {
      var item = entry.h || {};
      var teams = item.teams || [];
      var champ = byId(teams, item.championId);
      var runner = byId(teams, item.runnerUpId);
      var score = scoreOf(grandOf(matchesOf(item)));
      var date = dateText(item);
      return '<tr>' +
        '<td class="num gold">№' + entry.season + '</td>' +
        '<td class="dim">' + (date ? esc(date) : '—') + '</td>' +
        '<td class="name"><a class="text-link" href="#ch-' + esc(item.id != null ? item.id : entry.index) + '">' + esc(entry.label) + '</a></td>' +
        '<td class="name' + (champ ? ' gold' : '') + '">' + (champ ? esc(champ.name) : '—') + '</td>' +
        '<td class="dim">' + (runner ? esc(runner.name) : '—') + '</td>' +
        '<td class="num">' + (score ? esc(score) : '—') + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="h-table-block reveal">' +
      '<h3 class="h3">Чемпионы турниров</h3>' +
      '<div class="tbl-scroll"><table class="tbl">' +
        '<thead><tr><th class="num">Турнир</th><th>Дата</th><th>Название</th><th>Чемпион</th><th>Финалист</th><th class="num">Финал</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div></div>';
  }

  function clubsTable(at) {
    if (!at.clubList.length) return '';
    var rows = at.clubList.map(function (c) {
      var maps = c.mapsWon || c.mapsLost ? (c.mapsWon + ':' + c.mapsLost) : '—';
      var rec = c.played ? (c.wins + '–' + c.losses) : '—';
      return '<tr>' +
        '<td class="name">' + esc(c.team.name) + '</td>' +
        '<td class="num' + (c.titles ? ' gold' : '') + '">' + (c.titles || '—') + '</td>' +
        '<td class="num">' + (c.finals || '—') + '</td>' +
        '<td class="num">' + (c.played || '—') + '</td>' +
        '<td class="num">' + rec + '</td>' +
        '<td class="num">' + esc(maps) + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="h-table-block reveal">' +
      '<h3 class="h3">Клубы и титулы</h3>' +
      '<div class="tbl-scroll"><table class="tbl">' +
        '<thead><tr><th>Команда</th><th class="num">Титулы</th><th class="num">Финалы</th><th class="num">Матчи</th><th class="num">Победы–поражения</th><th class="num">Карты</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div></div>';
  }

  /* ==========================================================
     Витрина MVP
     ========================================================== */
  function mvpShowcase(entries) {
    var items = [];
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var h = entry.h || {};
      if (!h.mvp || !h.mvp.playerNick) continue;
      var team = byId(h.teams, h.mvp.teamId);
      items.push({
        nick: h.mvp.playerNick,
        team: team ? team.name : '',
        note: h.mvp.note || '',
        title: entry.label,
        id: 'ch-' + (h.id != null ? h.id : entry.index),
        season: entry.season
      });
    }
    if (!items.length) return '';
    return '<section class="h-sec" id="mvp">' +
      '<div class="wrap">' +
        '<div class="h-sec-head">' +
          '<div><h2 class="h2">Витрина MVP</h2></div>' +
          '<p class="h-note">Игроки, которых организаторы отметили в каждом турнире организации.</p>' +
        '</div>' +
        '<div class="h-mvp-grid">' + items.map(function (m) {
          return '<a class="h-mvp-card reveal" href="#' + esc(m.id) + '">' +
            '<div class="nick">' + esc(m.nick) + '</div>' +
            (m.team ? '<div class="team">' + esc(m.team) + '</div>' : '') +
            (m.note ? '<div class="note">' + esc(m.note) + '</div>' : '') +
            '<div class="src">Турнир №' + m.season + ' · ' + esc(m.title) + '</div>' +
            '</a>';
        }).join('') + '</div>' +
      '</div></section>';
  }

  /* ==========================================================
     JSON-LD
     ========================================================== */
  function idUrl(id) {
    return 'https://compassarena.ru/history.html#' + id;
  }
  function injectSchema(d, entries) {
    var items = entries.map(function (entry) {
      var h = entry.h || {};
      var teams = h.teams || [];
      var champ = byId(teams, h.championId);
      var runner = byId(teams, h.runnerUpId);
      var id = 'ch-' + (h.id != null ? h.id : entry.index);
      var item = {
        '@type': 'ListItem',
        position: entry.season,
        url: idUrl(id),
        name: entry.label
      };
      var ev = { '@type': 'SportsEvent', name: entry.label, sport: 'Esports', url: idUrl(id) };
      var date = dateText(h);
      if (date) ev.description = 'Турнир №' + entry.season + (entry.h && entry.h.game ? ' по ' + entry.h.game : '') + ' — ' + date;
      if (h.game) ev.about = h.game;
      ev.competitor = teams.filter(function (t) { return t && !isSlotName(t.name); })
        .map(function (t) { return { '@type': 'SportsTeam', name: t.name }; });
      if (champ) ev.winner = { '@type': 'SportsTeam', name: champ.name };
      if (runner) ev.secondPlace = { '@type': 'SportsTeam', name: runner.name };
      if (h.mvp && h.mvp.playerNick) ev.award = 'MVP: ' + h.mvp.playerNick;
      item.item = ev;
      return item;
    });

    var payload = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'История турниров Compass Arena',
      description: 'Все турниры организации Compass Arena: чемпионы, финалисты и MVP.',
      numberOfItems: items.length,
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      itemListElement: items
    };

    var el = document.getElementById('ca-schema');
    if (!el) {
      el = document.createElement('script');
      el.type = 'application/ld+json';
      el.id = 'ca-schema';
      document.head.appendChild(el);
    }
    try { el.textContent = JSON.stringify(payload); } catch (e) {}
  }

  /* ==========================================================
     Лайтбокс галерей
     ========================================================== */
  var lb = { photos: [], index: 0, groups: {}, names: {}, bound: false };

  function setCount() {
    var count = document.getElementById('lbCount');
    if (!count) return;
    var multi = lb.photos.length > 1;
    count.textContent = lb.photos.length ? (lb.index + 1) + ' / ' + lb.photos.length : '';
    count.hidden = !multi;
  }
  function paintLb() {
    var img = document.getElementById('lbImg');
    var cap = document.getElementById('lbCap');
    var p = lb.photos[lb.index];
    if (!p) return;
    if (img) { img.src = p.url; img.alt = p.alt || ''; }
    if (cap) cap.textContent = p.caption || '';
    setCount();
    var multi = lb.photos.length > 1;
    var prev = document.getElementById('lbPrev');
    var next = document.getElementById('lbNext');
    if (prev) { prev.hidden = !multi; prev.disabled = !multi; }
    if (next) { next.hidden = !multi; next.disabled = !multi; }
  }
  function lbOpen(photos, index) {
    if (!photos || !photos.length) return;
    lb.photos = photos;
    lb.index = Math.max(0, Math.min(index || 0, photos.length - 1));
    paintLb();
    var el = document.getElementById('lb');
    if (!el) return;
    el.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function lbClose() {
    var el = document.getElementById('lb');
    if (el) el.classList.remove('active');
    document.body.style.overflow = '';
  }
  function lbStep(dir) {
    if (lb.photos.length < 2) return;
    lb.index = (lb.index + dir + lb.photos.length) % lb.photos.length;
    paintLb();
  }

  function collectGroups() {
    lb.groups = {};
    lb.names = {};
    var views = document.querySelectorAll('.pv[data-gallery]');
    for (var i = 0; i < views.length; i++) {
      var key = views[i].getAttribute('data-gallery');
      var slides = views[i].querySelectorAll('.pv-slide');
      var list = [];
      for (var j = 0; j < slides.length; j++) {
        var img = slides[j].querySelector('img.pv-img');
        list.push({
          url: img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '',
          caption: slides[j].getAttribute('data-cap') || '',
          alt: img ? (img.getAttribute('alt') || '') : ''
        });
      }
      lb.groups[key] = list;
      lb.names[key] = views[i].getAttribute('data-gname') || 'Compass Arena';
    }
  }

  function chapterPhotos(key) {
    var raw = lb.groups[key] || [];
    var name = lb.names[key] || 'Compass Arena';
    return raw.map(function (p, i) {
      return {
        url: p.url,
        caption: p.caption,
        alt: p.alt || p.caption || ('Фото с турнира ' + name + ' — кадр ' + (i + 1))
      };
    });
  }

  function initLightbox() {
    if (lb.bound) return;
    lb.bound = true;
    var el = document.getElementById('lb');

    /* Клик по кадру — открыть лайтбокс на нужном фото главы */
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      if (target.closest('.pv-btn')) return;
      var stage = target.closest('.pv-stage');
      if (!stage) return;
      var pv = stage.closest('.pv');
      if (!pv) return;
      lbOpen(chapterPhotos(pv.getAttribute('data-gallery')), pv._cur ? pv._cur() : 0);
    });

    var close = document.getElementById('lbClose');
    if (close) close.addEventListener('click', lbClose);
    var prev = document.getElementById('lbPrev');
    if (prev) prev.addEventListener('click', function () { lbStep(-1); });
    var next = document.getElementById('lbNext');
    if (next) next.addEventListener('click', function () { lbStep(1); });
    if (el) el.addEventListener('click', function (e) { if (e.target === el) lbClose(); });

    document.addEventListener('keydown', function (e) {
      if (!el || !el.classList.contains('active')) return;
      if (e.key === 'Escape') { e.preventDefault(); lbClose(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); lbStep(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); lbStep(1); }
    });

    /* Свайп по кадру */
    var x0 = null;
    var frame = el ? el.querySelector('.lb-frame') : null;
    if (frame) {
      frame.addEventListener('touchstart', function (e) { x0 = e.touches && e.touches.length ? e.touches[0].clientX : null; }, { passive: true });
      frame.addEventListener('touchend', function (e) {
        if (x0 == null || !e.changedTouches || !e.changedTouches.length) return;
        var dx = e.changedTouches[0].clientX - x0;
        x0 = null;
        if (Math.abs(dx) > 40) lbStep(dx > 0 ? -1 : 1);
      }, { passive: true });
    }
  }

  /* ==========================================================
     Наблюдатели: появление блоков, зум обложек, активная глава
     ========================================================== */
  var coverIo = null;
  var spyIo = null;
  var lastActive = null;

  function initCoverObserver() {
    var items = document.querySelectorAll('.h-hero');
    if (coverIo) { coverIo.disconnect(); coverIo = null; }
    if (!isObs()) {
      for (var i = 0; i < items.length; i++) items[i].classList.add('in');
      return;
    }
    coverIo = new global.IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          entries[i].target.classList.add('in');
          coverIo.unobserve(entries[i].target);
        }
      }
    }, { threshold: .35 });
    for (var j = 0; j < items.length; j++) {
      if (!items[j].classList.contains('in')) coverIo.observe(items[j]);
    }
  }

  function markActive(id) {
    if (lastActive === id) return;
    lastActive = id;
    var chips = document.querySelectorAll('.h-chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('is-active', chips[i].getAttribute('data-target') === id);
    }
  }

  function initSpy() {
    var sections = document.querySelectorAll('#books [id^="ch-"]');
    if (spyIo) { spyIo.disconnect(); spyIo = null; }
    lastActive = null;
    if (sections.length <= 1 || !isObs()) return;
    spyIo = new global.IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) markActive(entries[i].target.id);
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    for (var j = 0; j < sections.length; j++) spyIo.observe(sections[j]);
  }

  /* ==========================================================
     Полный рендер
     ========================================================== */
  /* Между турнирами отдельный разделитель не нужен: марка главы уже называет номер турнира */
  function divider() { return ''; }

  function safe(fn, fallback, label) {
    try { return fn(); } catch (e) {
      if (global.console) console.warn('[CA.history] блок «' + label + '» не отрисован:', e);
      return fallback || '';
    }
  }

  function render(d) {
    /* Ни один блок не должен ронять страницу целиком: архив обязан
       показываться даже если текущий сезон пустой или битый. */
    var sorted = safe(function () { return sortHistory(d.history); }, [], 'история');
    var entries = safe(function () { return decorateSeasons(sorted); }, [], 'нумерация турниров');
    var at = safe(function () { return allTime(d); }, { tournaments: 0, matches: 0, teams: [], clubList: [], currentPlayed: false }, 'сводка');
    var chapters = [];
    var archiveCount = entries.length;

    safe(function () { renderHero(d, sorted, at); }, null, 'первый экран');

    var archive = '';
    for (var i = 0; i < entries.length; i++) {
      (function (entry) {
        if (i > 0) archive += divider(entry.season);
        archive += safe(function () { return chapterHtml(entry, archiveCount); }, chapterFallback(entry), 'турнир №' + entry.season);
        chapters.push({
          id: 'ch-' + (entry.h && entry.h.id != null ? entry.h.id : entry.index),
          no: '№' + entry.season,
          title: entry.label,
          date: dateText(entry.h),
          current: false
        });
      })(entries[i]);
    }

    if (!entries.length) {
      archive = '<section class="ch-empty wrap reveal">' +
        '<div class="orn"><svg class="ic" aria-hidden="true"><use href="#i-compass"></use></svg></div>' +
        '<h2 class="h2">Архив пока пуст</h2>' +
        '<p class="lead">Здесь появятся завершённые турниры организации: чемпион, состав, путь к титулу и кадры. ' +
        'Когда сезон доигран, организаторы фиксируют его в админке — и он встаёт в хронику отдельным турниром.</p>' +
        '<div class="row" style="margin-top:22px"><a class="btn btn-gold" href="/#bracket">' + 'Текущая сетка</a>' +
        '<a class="btn btn-ghost" href="/schedule.html">' + 'Расписание</a></div>' +
        '</section>';
    }

    /* Сводки: чемпионы, клубы, MVP */
    var extras = '';
    var champs = safe(function () { return championsTable(entries); }, '', 'таблица чемпионов');
    var clubs = safe(function () { return clubsTable(at); }, '', 'таблица клубов');
    if (champs || clubs) {
      extras += '<section class="h-sec" id="summary"><div class="wrap">' +
        '<div class="h-sec-head">' +
          '<div><h2 class="h2">Сводка чемпионов</h2></div>' +
          '<p class="h-note">Одна таблица на всю историю: номер турнира, кто взял титул и с каким счётом закончился финал.</p>' +
        '</div>' +
        '<div class="h-tables">' + champs + clubs + '</div>' +
      '</div></section>';
    }
    var mvp = safe(function () { return mvpShowcase(entries); }, '', 'витрина MVP');

    var books = document.getElementById('books');
    if (books) books.innerHTML = archive + extras + mvp;

    safe(function () { renderNav(chapters); }, null, 'навигация');
    safe(function () { injectSchema(d, entries); }, null, 'schema.org');

    safe(function () { U().observeReveals(document); }, null, 'анимации');
    safe(function () { initCoverObserver(); }, null, 'обложки');
    safe(function () { collectGroups(); }, null, 'галереи');
    safe(function () { initViewers(); }, null, 'просмотрщик фото');
    safe(function () { initSpy(); }, null, 'активная глава');
    safe(function () { initLightbox(); }, null, 'лайтбокс');

    var progress = 0;
    if (d.stats && d.stats.matchesTotal) progress = d.stats.played / d.stats.matchesTotal;
    safe(function () { U().setProgress(d.phase === 'post' ? 1 : progress); }, null, 'прогресс');

    /* та же фаза, что на других страницах: от неё зависит плашка «идёт эфир» в шапке */
    document.body.setAttribute('data-phase', d.phase || 'pre');
  }

  /* Запасной вариант главы: если турнир почему-то не отрисовался,
     показываем хотя бы его номер, название и дату — без дыр в хронике. */
  function chapterFallback(entry) {
    var item = (entry && entry.h) || {};
    var date = dateText(item);
    return '<section class="ch' + (entry.season % 2 === 0 ? ' is-alt' : '') + '" id="ch-' +
        esc(item.id != null ? item.id : entry.index) + '" data-season="' + entry.season + '">' +
      '<div class="wrap">' +
        '<div class="h-mark"><span class="no">Турнир №' + entry.season + '</span><span class="rule"></span><span class="date">' + esc(date) + '</span></div>' +
        '<div class="ch-title reveal"><h2>' + esc(entry.label) + '</h2></div>' +
        '<p class="ch-quiet">Данные этого турнира не удалось отрисовать. Попробуйте обновить страницу — сами записи архива целы.</p>' +
      '</div></section>';
  }

  /* ==========================================================
     Старт
     ========================================================== */
  function init() {
    U().injectSprite();
    U().initChrome();

    var year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());

    D().load().then(render);
    D().startAutoRefresh(60000);

    var scheduled = false;
    D().onChange(function () {
      if (scheduled) return;
      scheduled = true;
      var raf = global.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
      raf(function () { scheduled = false; render(D().get()); });
    });
  }

  CA.history = { render: render, init: init, allTime: allTime };
  U().contentReady(init);
})(typeof window !== 'undefined' ? window : globalThis);
