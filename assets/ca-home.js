/* ==========================================================
   Compass Arena — главная страница
   ----------------------------------------------------------
   Один контроллер на три состояния турнира:
     pre  — до старта: отсчёт, набор команд, формат
     live — эфир: следующий матч, плеер, live-акценты
     post — после финала: чемпион, итоги, архив, следующий сезон
   ========================================================== */
(function (global) {
  'use strict';

  var CA = global.CA = global.CA || {};
  var D = CA.data;
  var U = CA.ui;
  var V = CA.views;
  var ic = U.icon;
  var esc = D.esc;

  var TICK = null;

  /* ---------- Первый экран ---------- */
  function renderHero(d) {
    var kicker = document.getElementById('heroKicker');
    var title = document.getElementById('heroTitle');
    var lede = document.getElementById('heroLede');
    var cta = document.getElementById('heroCta');
    var watch = 'https://www.twitch.tv/compassarena';

    if (d.phase === 'post') {
      var champ = d.champion;
      kicker.innerHTML = ic('trophy') + ' Турнир завершён';
      title.innerHTML = champ ? (esc(champ.name) + ' забирает<br><em>первый трофей</em>') : 'Турнир завершён';
      lede.textContent = 'Финал сыгран. Ниже — итоги, сетка и хроника турнира. Следующий сезон Compass Arena уже готовится.';
      cta.innerHTML =
        '<a class="btn btn-gold btn-lg" href="#bracket">' + ic('bracket') + 'Сетка и итоги</a>' +
        '<a class="btn btn-ghost btn-lg" href="#next-season">' + ic('flag') + 'Следующий сезон</a>';
    } else if (d.phase === 'live') {
      kicker.innerHTML = '<span class="dot-live"></span> Идёт прямо сейчас';
      title.innerHTML = 'Турнир идёт —<br><em>смотрите вживую</em>';
      lede.textContent = 'Шесть команд, серии до двух побед и один трофей. Матчи идут по расписанию, трансляция — на Twitch.';
      cta.innerHTML =
        '<a class="btn btn-live btn-lg" href="#stream">' + ic('live') + 'Смотреть эфир</a>' +
        '<a class="btn btn-ghost btn-lg" href="#bracket">' + ic('bracket') + 'Турнирная сетка</a>';
    } else {
      kicker.innerHTML = 'Турнир по Dota 2 · первый сезон';
      title.innerHTML = 'Здесь сражаются<br>не ради участия —<br><em>здесь доказывают</em>';
      lede.textContent = 'Один шанс, полная концентрация и один трофей на всех. Первый турнир организации Compass Arena.';
      cta.innerHTML =
        '<a class="btn btn-gold btn-lg" href="#bracket">' + ic('bracket') + 'Турнирная сетка</a>' +
        '<a class="btn btn-ghost btn-lg" href="#teams">' + ic('users') + 'Участники</a>';
    }
    void watch;
  }

  /* ---------- Статус под первым экраном ---------- */
  function renderHeroStatus(d) {
    var box = document.getElementById('heroStatus');
    if (!box) return;
    var total = (d.tournamentStart && d.projectStart) ? (d.tournamentStart - d.projectStart) : 0;
    var percent = total > 0 ? Math.max(0, Math.min(100, ((Date.now() - d.projectStart) / total) * 100)) : 0;

    if (d.phase === 'post') {
      var grand = d.grandFinal;
      var sc = grand && grand.score1 != null ? grand.score1 + ':' + grand.score2 : '';
      box.innerHTML = '<div class="nm is-post">' +
        '<div class="nm-label">' + ic('trophy') + 'Турнир завершён</div>' +
        '<div class="nm-teams">Чемпион — <span class="win">' + esc(d.champion ? d.champion.name : '—') + '</span></div>' +
        '<div class="nm-meta">' + esc(D.stageLabel(grand)) +
          (d.runnerUp ? ' · финал против ' + esc(d.runnerUp.name) : '') +
          (grand && grand.scheduled ? ' · ' + esc(D.fmtDateTime(grand.scheduled)) : '') + '</div>' +
        (sc ? '<div class="nm-count"><b>' + esc(sc) + '</b><small>счёт финала</small></div>' : '') +
        '</div>';
      U.setProgress(1);
      return;
    }

    if (d.phase === 'live') {
      var m = d.nextMatch;
      var label = (m && m.state === 'live') ? '<span class="dot-live"></span>Идёт сейчас' : (ic('clock') + 'Следующий матч');
      var teams = m ? (esc(D.slotLabel(m, 1).text) + ' <span class="vs">против</span> ' + esc(D.slotLabel(m, 2).text)) : 'Расписание уточняется';
      var meta = m ? (esc(D.stageLabel(m)) + (m.scheduled ? ' · ' + esc(D.fmtDateTime(m.scheduled)) : '')) : '';
      box.innerHTML = '<div class="nm">' +
        '<div class="nm-label">' + label + '</div>' +
        '<div class="nm-teams">' + teams + '</div>' +
        '<div class="nm-meta">' + meta + '</div>' +
        '<div class="nm-count" id="nmCount"></div>' +
        '</div>';
      var played = d.stats.played, tot = d.stats.matchesTotal || 1;
      U.setProgress(played / tot);
      tickNextMatch();
      return;
    }

    /* pre: отсчёт до старта */
    box.innerHTML = '<div class="cd">' +
      '<div class="cd-inner">' +
        '<div class="cd-label">До старта турнира<b id="cdDate">' + esc(D.fmtDateTime(d.tournamentStart)) + '</b></div>' +
        '<div class="cd-nums">' +
          '<div class="cd-num"><b id="cdDays">--</b><small>дней</small></div>' +
          '<div class="cd-num"><b id="cdHours">--</b><small>часов</small></div>' +
          '<div class="cd-num"><b id="cdMinutes">--</b><small>минут</small></div>' +
          '<div class="cd-num"><b id="cdSeconds">--</b><small>секунд</small></div>' +
        '</div>' +
        '<div class="cd-announce" id="cdAnnounce"></div>' +
        '<div class="cd-next">' + firstMatchLine(d) + '</div>' +
        '<div class="cd-track"><i id="cdFill" style="width:' + percent.toFixed(1) + '%"></i></div>' +
        '<div class="cd-caption"><span>Старт проекта</span><span id="cdPercent">' + percent.toFixed(0) + '%</span><span>Турнир</span></div>' +
      '</div></div>';
    U.setProgress(percent / 100);
    tickCountdown();
  }

  function firstMatchLine(d) {
    var m = d.byId[1] || d.matches[0];
    if (!m) return '';
    var a = D.slotLabel(m, 1).text, b = D.slotLabel(m, 2).text;
    return '<span class="k">Первый матч</span><b>' + esc(a) + '</b> против <b>' + esc(b) + '</b>' +
      (m.scheduled ? '<span class="t">' + esc(D.fmtDateTime(m.scheduled)) + '</span>' : '<span class="t">время уточняется</span>');
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function tickCountdown() {
    var d = D.get();
    var el = document.getElementById('cdDays');
    if (!el) return;
    var diff = d.tournamentStart - Date.now();
    if (diff <= 0) {
      el.textContent = '00';
      document.getElementById('cdHours').textContent = '00';
      document.getElementById('cdMinutes').textContent = '00';
      document.getElementById('cdSeconds').textContent = '00';
      if (d.startFromServer) render(d);
      return;
    }
    var days = Math.floor(diff / 86400000);
    var hours = Math.floor((diff % 86400000) / 3600000);
    var mins = Math.floor((diff % 3600000) / 60000);
    var secs = Math.floor((diff % 60000) / 1000);
    el.textContent = pad(days);
    document.getElementById('cdHours').textContent = pad(hours);
    document.getElementById('cdMinutes').textContent = pad(mins);
    document.getElementById('cdSeconds').textContent = pad(secs);

    var ann = document.getElementById('cdAnnounce');
    if (ann) {
      if (diff <= 12 * 3600000) { ann.textContent = 'Стартуем сегодня'; ann.classList.add('visible'); }
      else if (diff <= 24 * 3600000) { ann.textContent = 'Стартуем завтра'; ann.classList.add('visible'); }
      else ann.classList.remove('visible');
    }
  }

  function tickNextMatch() {
    var box = document.getElementById('nmCount');
    if (!box) return;
    var d = D.get();
    var m = d.nextMatch;
    if (!m) { box.innerHTML = ''; return; }
    if (m.state === 'live') {
      var has = m.score1 != null && m.score2 != null;
      box.innerHTML = '<b>' + (has ? esc(m.score1 + ':' + m.score2) : 'LIVE') + '</b><small>' + (has ? 'счёт в серии' : 'матч идёт') + '</small>';
      return;
    }
    if (!m.scheduled) { box.innerHTML = '<b>—</b><small>время уточняется</small>'; return; }
    var diff = m.scheduled - Date.now();
    if (diff <= 0) { box.innerHTML = '<b>Скоро</b><small>матч вот-вот начнётся</small>'; return; }
    var h = Math.floor(diff / 3600000), mn = Math.floor((diff % 3600000) / 60000), s = Math.floor((diff % 60000) / 1000);
    box.innerHTML = '<b>' + (h > 0 ? pad(h) + ':' : '') + pad(mn) + ':' + pad(s) + '</b><small>до начала</small>';
  }

  /* ---------- Трансляция ---------- */
  function renderStream(d) {
    var section = document.getElementById('streamSection');
    var waiting = document.getElementById('streamWaiting');
    var live = document.getElementById('streamLive');
    if (!section) return;

    if (d.phase === 'pre') {
      section.hidden = false;
      if (waiting) waiting.hidden = false;
      if (live) live.hidden = true;
      updateStreamMini();
      return;
    }

    section.hidden = false;
    if (waiting) waiting.hidden = true;
    if (live) live.hidden = false;

    var bar = document.getElementById('streamBar');
    var barText = document.getElementById('streamBarText');
    var poster = document.getElementById('streamPoster');
    var title = document.getElementById('streamPosterTitle');
    var text = document.getElementById('streamPosterText');
    var play = document.getElementById('streamPlay');
    var next = document.getElementById('streamNext');

    if (d.phase === 'post') {
      if (bar) bar.classList.add('off');
      if (barText) barText.textContent = 'Турнир завершён';
      if (title) title.textContent = 'Эфир завершён';
      if (text) text.textContent = 'Все матчи сыграны. Записи трансляций и хроника турнира — в архиве.';
      if (play) {
        play.href = 'https://www.twitch.tv/compassarena/videos';
        play.removeAttribute('data-play-stream');
        play.innerHTML = '<span class="ring">' + ic('play') + '</span><span><b>Записи на Twitch</b><small>полный архив трансляций</small></span>';
      }
      if (next) next.innerHTML = '<a class="text-link" href="/history.html">' + ic('trophy') + ' Хроника турнира</a>';
      return;
    }

    /* live */
    var m = d.videoMatch || d.nextMatch;
    if (bar) bar.classList.toggle('off', !m || m.state !== 'live');
    if (barText) barText.textContent = (m && m.state === 'live') ? 'Прямой эфир' : 'Эфир появится к матчу';
    if (title) title.textContent = (m && m.state === 'live') ? 'Матч идёт — включайтесь' : 'Эфир сейчас не идёт';
    if (text) {
      if (m && m.state === 'live') {
        text.textContent = D.slotLabel(m, 1).text + ' против ' + D.slotLabel(m, 2).text + ' — ' + D.stageLabel(m) + '.';
      } else if (m && m.scheduled) {
        text.textContent = 'Следующий матч — ' + D.fmtDateTime(m.scheduled) + '. Плеер включится здесь, как только начнётся эфир.';
      } else {
        text.textContent = 'Трансляция появится здесь, как только стартует следующий матч.';
      }
    }
    if (play) {
      play.href = 'https://www.twitch.tv/compassarena';
      play.innerHTML = '<span class="ring">' + ic('play') + '</span><span><b>' +
        (m && m.state === 'live' ? 'Смотреть на Twitch' : 'Открыть канал') + '</b><small>compassarena</small></span>';
      play.setAttribute('data-play-stream', '');
    }
    if (next) {
      next.innerHTML = d.nextMatch
        ? 'Следом: <b>' + esc(D.slotLabel(d.nextMatch, 1).text) + '</b> против <b>' + esc(D.slotLabel(d.nextMatch, 2).text) + '</b>' +
          (d.nextMatch.scheduled ? ' · ' + esc(D.fmtDateTime(d.nextMatch.scheduled)) : '')
        : '';
    }
  }

  function fmtDur(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    var days = Math.floor(t / 86400);
    var h = Math.floor((t % 86400) / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    if (days > 0) return days + ' ' + D.plural(days, 'день', 'дня', 'дней') + ' ' + pad(h) + ':' + pad(m) + ':' + pad(s);
    return pad(h) + ':' + pad(m) + ':' + pad(s);
  }

  function updateStreamMini() {
    var mini = document.getElementById('streamMiniTimer');
    if (!mini) return;
    var d = D.get();
    var diff = d.tournamentStart - Date.now();
    mini.innerHTML = diff > 0 ? 'До эфира — <b>' + fmtDur(diff) + '</b>' : 'Старт совсем скоро';
  }

  /* Ленивая загрузка плеера Twitch: только по желанию зрителя */
  function initStreamPlayer() {
    var frame = document.getElementById('streamFrame');
    var poster = document.getElementById('streamPoster');
    if (!frame) return;

    function mount() {
      if (frame.querySelector('iframe')) return;
      var iframe = document.createElement('iframe');
      iframe.src = 'https://player.twitch.tv/?channel=compassarena&parent=' + location.hostname + '&autoplay=true&muted=true';
      iframe.allowFullscreen = true;
      iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
      iframe.setAttribute('title', 'Прямая трансляция Compass Arena');
      iframe.loading = 'lazy';
      frame.appendChild(iframe);
      if (poster) poster.classList.add('gone');
    }
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-play-stream]');
      if (!btn) return;
      e.preventDefault();
      mount();
    });
  }

  /* ---------- Сетка, выбывшие, участники ---------- */
  function renderBracket(d) {
    var root = document.getElementById('bracketWrap');
    if (!root) return;
    CA.bracket.render(root, { data: d });
    var legend = document.getElementById('bLegend');
    if (legend) {
      legend.innerHTML =
        '<span><i class="live"></i>В эфире</span>' +
        '<span><i class="up"></i>Впереди</span>' +
        '<span><i class="done"></i>Сыгран</span>' +
        '<span class="tz">Время — московское (МСК)</span>';
    }
  }

  function renderEliminated(d) {
    var list = document.getElementById('eliminatedList');
    var count = document.getElementById('eliminatedCount');
    var section = document.getElementById('eliminatedSection');
    if (!list) return;
    var res = V.outList(d);
    list.innerHTML = res.html;
    if (count) count.textContent = res.count ? res.count + ' из ' + d.teams.length : '';
    if (section) section.hidden = d.phase === 'pre' && !res.count;
  }

  function renderTeams(d) {
    var grid = document.getElementById('teamsGrid');
    if (!grid) return;
    grid.innerHTML = d.teams.map(function (t) {
      var rec = d.stats.records[t.id] || { wins: 0, losses: 0, played: 0 };
      var logo = t.logo
        ? '<img src="' + esc(t.logo) + '" alt="Логотип ' + esc(t.name) + '" width="52" height="52" loading="lazy">'
        : '<span class="ph">' + esc(D.initials(t.name)) + '</span>';
      var players = t.players.length
        ? t.players.map(function (p) { return esc(p.nick || '—'); }).join(' · ')
        : 'Состав уточняется';
      var mark = '';
      if (d.champion && d.champion.id === t.id) mark = '<span class="st st-gold">' + ic('trophy') + 'Чемпион</span>';
      else if (d.runnerUp && d.runnerUp.id === t.id) mark = '<span class="st st-done">Серебро</span>';
      else if (rec.out) mark = '<span class="st st-flag">Выбыла в M' + rec.out + '</span>';
      return '<button class="team-card reveal" data-team="' + t.id + '" type="button">' +
        '<span class="tc-top"><span class="tc-logo">' + logo + '</span>' + mark + '</span>' +
        '<span class="tc-name">' + esc(t.name) + '</span>' +
        '<span class="tc-players">' + players + '</span>' +
        (rec.played ? '<span class="tc-rec">' + rec.wins + '–' + rec.losses + ' · карты ' + rec.mapsWon + ':' + rec.mapsLost + '</span>' : '') +
        '</button>';
    }).join('');
    U.observeReveals(grid);
  }

  /* ---------- Расписание (превью) ---------- */
  function renderSchedulePreview(d) {
    var box = document.getElementById('schedulePreviewList');
    if (!box) return;
    var played = d.matches.filter(function (m) { return m.winner; });
    var upcoming = d.matches.filter(function (m) { return !m.winner && m.bothKnown && m.scheduled; })
      .sort(function (a, b) { return a.scheduled - b.scheduled; })
      .slice(0, 3);
    var done = played.slice(-3).reverse();
    var list = d.phase === 'post' ? done : upcoming.concat(done);
    box.innerHTML = V.scheduleRows(d, list, {});
  }

  /* ---------- Архив и следующий сезон ---------- */
  function renderArchive(d) {
    var section = document.getElementById('archiveSection');
    var list = document.getElementById('archiveList');
    if (!section || !list) return;
    var history = (d.history || []).slice().sort(function (a, b) {
      return (new Date(a.createdAt || 0).getTime()) - (new Date(b.createdAt || 0).getTime());
    });
    if (!history.length) { section.hidden = true; return; }
    section.hidden = false;
    list.innerHTML = history.slice().reverse().slice(0, 4).map(function (h, i) {
      return V.seasonCard(d, h, history.length - 1 - i);
    }).join('');
    U.observeReveals(list);
  }

  function renderNextSeason(d) {
    var section = document.getElementById('next-season');
    var body = document.getElementById('nextSeasonBody');
    if (!section || !body) return;
    if (d.phase !== 'post') { section.hidden = true; return; }
    section.hidden = false;

    var ns = d.nextSeason || {};
    var title = ns.name || 'Compass Arena · второй сезон';
    var when = ns.date ? D.fmtDateTime(new Date(ns.date).getTime()) : '';
    var note = ns.note || 'Мы готовим следующий турнир: больше команд, полноценная сетка с нижней частью и призовой фонд. Заявки — в Telegram организации.';
    body.innerHTML =
      '<div class="ns-grid">' +
        '<div class="ns-main">' +
          '<p class="kicker">Следующий сезон</p>' +
          '<h2 class="h2">' + esc(title) + '</h2>' +
          '<p class="lead">' + esc(note) + '</p>' +
          (when ? '<div class="ns-when">' + ic('calendar') + '<span>Ориентир — <b>' + esc(when) + '</b></span></div>' : '') +
          '<div class="row" style="margin-top:26px">' +
            '<a class="btn btn-gold" href="' + esc(ns.url || 'https://t.me/compassarenaa') + '" target="_blank" rel="noopener">' + ic('telegram') + 'Подать заявку</a>' +
            '<a class="btn btn-ghost" href="/rules.html">' + ic('shield') + 'Регламент</a>' +
          '</div>' +
        '</div>' +
        '<div class="ns-side">' +
          '<div class="ns-row"><span class="ic-holder">' + ic('users') + '</span><span><b>6–8 команд</b><small>состав сезона</small></span></div>' +
          '<div class="ns-row"><span class="ic-holder">' + ic('bracket') + '</span><span><b>Double Elimination</b><small>сетка с нижней частью</small></span></div>' +
          '<div class="ns-row"><span class="ic-holder">' + ic('tv') + '</span><span><b>Все матчи в эфире</b><small>Twitch, MСК</small></span></div>' +
        '</div>' +
      '</div>';
  }

  /* ---------- Чемпионский баннер и чип ---------- */
  function renderChampion(d) {
    var section = document.getElementById('championSection');
    var box = document.getElementById('championBanner');
    var chip = document.getElementById('champChip');
    var isPost = d.phase === 'post' && d.champion;

    if (section) section.hidden = !isPost;
    if (box && isPost) box.innerHTML = V.championBanner(d, {});

    if (chip) {
      var dismissed = U.isDismissed('champ-chip');
      var show = !!isPost && !dismissed;
      chip.classList.toggle('visible', show);
      var nameEl = document.getElementById('champChipName');
      if (nameEl && d.champion) nameEl.textContent = d.champion.name;
    }
  }

  function initChip() {
    var chip = document.getElementById('champChip');
    if (!chip) return;
    chip.addEventListener('click', function (e) {
      if (e.target.closest('[data-dismiss-chip]')) {
        e.preventDefault();
        e.stopPropagation();
        U.dismiss('champ-chip', chip);
        return;
      }
      var target = document.getElementById('championSection');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else location.href = '/history.html';
    });
  }

  /* ---------- Диалог команды ---------- */
  var teamDialog = null;
  function openTeam(id) {
    var d = D.get();
    var html = V.teamDialogHtml(d, id);
    if (!html || !teamDialog) return;
    document.getElementById('teamDialogLogo').innerHTML = html.logo;
    document.getElementById('teamDialogName').textContent = html.name;
    document.getElementById('teamDialogSub').textContent = html.sub;
    document.getElementById('teamDialogBody').innerHTML = html.body;
    document.getElementById('teamDialogStats').innerHTML = html.stats;
    teamDialog.open(document.activeElement);
  }

  function initTeamDialog() {
    var el = document.getElementById('teamDialog');
    if (!el) return;
    teamDialog = U.dialog(el);
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-team]');
      if (!trigger) return;
      var id = parseInt(trigger.getAttribute('data-team'), 10);
      if (id) openTeam(id);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var t = e.target.closest && e.target.closest('[data-team][role="button"], .out-item[role="button"]');
      if (!t) return;
      e.preventDefault();
      var id = parseInt(t.getAttribute('data-team'), 10);
      if (id) openTeam(id);
    });
  }

  /* ---------- JSON-LD ---------- */
  function injectSchema(d) {
    var el = document.getElementById('ca-schema');
    if (!el) {
      el = document.createElement('script');
      el.type = 'application/ld+json';
      el.id = 'ca-schema';
      document.head.appendChild(el);
    }
    try { el.textContent = JSON.stringify(D.schemaOrg()); } catch (e) {}
  }

  /* ---------- Пыль на первом экране ---------- */
  function initDust() {
    var canvas = document.getElementById('dust');
    if (!canvas || !canvas.getContext) return;
    if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var ctx = canvas.getContext('2d'), parts = [], w = 0, h = 0, running = true;
    if (!ctx) return;
    var count = global.innerWidth < 820 ? 16 : 34;

    function resize() {
      var r = canvas.getBoundingClientRect();
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    global.addEventListener('resize', resize);
    for (var i = 0; i < count; i++) {
      parts.push({
        x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.3 + .4,
        vx: (Math.random() - .5) * .12, vy: -Math.random() * .22 - .04, a: Math.random() * .5 + .15
      });
    }
    function frame() {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.x += p.vx; p.y += p.vy;
        if (p.y < -4) { p.y = h + 4; p.x = Math.random() * w; }
        if (p.x < -4) p.x = w + 4;
        if (p.x > w + 4) p.x = -4;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283);
        ctx.fillStyle = 'rgba(236,214,163,' + p.a + ')'; ctx.fill();
      }
      global.requestAnimationFrame(frame);
    }
    if ('IntersectionObserver' in global) {
      new IntersectionObserver(function (en) {
        var was = running; running = en[0].isIntersecting;
        if (running && !was) global.requestAnimationFrame(frame);
      }).observe(canvas);
    }
    global.requestAnimationFrame(frame);
  }

  /* ---------- Полный рендер ---------- */
  function render(d) {
    document.body.setAttribute('data-phase', d.phase);
    renderHero(d);
    renderHeroStatus(d);
    renderChampion(d);
    renderStream(d);
    renderBracket(d);
    renderEliminated(d);
    renderTeams(d);
    renderSchedulePreview(d);
    renderArchive(d);
    renderNextSeason(d);
    injectSchema(d);

    var phaseNote = document.getElementById('phaseNote');
    if (phaseNote) {
      phaseNote.textContent = d.startFromServer
        ? 'Даты и время матчей — по Москве (МСК).'
        : 'Точные даты турнира уточняются — следите за анонсами в Telegram.';
    }
  }

  /* ---------- Старт ---------- */
  function init() {
    U.injectSprite();
    U.initChrome();
    initChip();
    initTeamDialog();
    initDust();
    initStreamPlayer();

    var toggle = document.getElementById('streamToggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var card = document.getElementById('streamWaiting');
        if (!card) return;
        var open = card.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    D.load().then(function (d) {
      render(d);
      U.observeReveals();
    });

    var rerender = false;
    D.onChange(function () {
      if (rerender) return;
      rerender = true;
      global.requestAnimationFrame(function () { rerender = false; render(D.get()); });
    });

    if (TICK) clearInterval(TICK);
    TICK = setInterval(function () {
      var d = D.get();
      if (d.phase === 'pre') { tickCountdown(); updateStreamMini(); }
      else if (d.phase === 'live') tickNextMatch();
    }, 1000);
  }

  CA.home = { init: init, render: render };
  U.contentReady(init);
})(typeof window !== 'undefined' ? window : globalThis);
