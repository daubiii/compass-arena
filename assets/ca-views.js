/* ==========================================================
   Compass Arena — общие представления
   ----------------------------------------------------------
   Кусочки интерфейса, которые нужны на нескольких страницах:
   строка матча, список выбывших, баннер чемпиона, карточка
   сезона и диалог команды.
   ========================================================== */
(function (global) {
  'use strict';

  var CA = global.CA = global.CA || {};
  var D = CA.data;
  function ic(n, c) { return CA.ui.icon(n, c); }
  function esc(s) { return D.esc(s); }

  /* ---------- Кнопки действий матча ---------- */
  function actions(D0, m, opts) {
    opts = opts || {};
    var out = [];
    if (m.vod && m.state === 'done') {
      out.push('<a class="btn btn-quiet btn-sm" href="' + esc(m.vod) + '" target="_blank" rel="noopener" title="Запись матча">' + ic('play') + 'VOD</a>');
    }
    if (m.scheduled && !m.winner && opts.ics !== false) {
      out.push('<a class="btn btn-quiet btn-sm" href="' + D.icsHref(m) + '" download="compass-arena-m' + m.id + '.ics" title="Добавить в календарь">' + ic('calendar') + 'В календарь</a>');
    }
    return out.length ? '<span class="s-actions">' + out.join('') + '</span>' : '';
  }

  /* ---------- Строка матча ---------- */
  function teamsHtml(D0, m) {
    var a = D.slotLabel(m, 1), b = D.slotLabel(m, 2);
    var has = m.score1 != null && m.score2 != null;
    var ca = m.winner ? (m.winner === m.team1 ? 'win' : 'lose') : (a.known ? '' : 'tbd');
    var cb = m.winner ? (m.winner === m.team2 ? 'win' : 'lose') : (b.known ? '' : 'tbd');
    return '<div class="s-teams">' +
      '<span class="' + ca + '">' + esc(a.text) + '</span>' +
      (has ? '<span class="sc">' + esc(m.score1) + ':' + esc(m.score2) + '</span>' + '<span class="sr">победитель ' + esc(D.teamName(m.winner)) + '</span>'
           : '<span class="vs">против</span>') +
      '<span class="' + cb + '">' + esc(b.text) + '</span>' +
      '</div>';
  }

  function whenHtml(D0, m, opts) {
    opts = opts || {};
    if (!m.scheduled) return '<div class="s-when is-tbd">Время уточняется</div>';
    var local = D.localTime(m.scheduled);
    return '<div class="s-when"><b>' + esc(D.mskTime(m.scheduled)) + '</b>' +
      (opts.date === false ? '' : esc(D.whenDate(m.scheduled, { day: 'numeric', month: 'long' }))) +
      '<span class="tz">МСК</span>' +
      (local ? '<small>у вас ' + esc(local) + '</small>' : '') +
      '</div>';
  }

  function tagHtml(m) {
    if (m.state === 'live') return '<span class="st st-live"><span class="dot-live"></span>В эфире</span>';
    if (m.isNext) return '<span class="st st-next">' + ic('clock') + 'Следующий</span>';
    if (m.winner) return '<span class="st st-done">' + ic('check') + 'Сыгран</span>';
    if (!m.bothKnown) return '<span class="st st-flag">Ждём команды</span>';
    return '<span class="st">' + esc(D.stageLabel(m)) + '</span>';
  }

  function scheduleRow(D0, m, opts) {
    opts = opts || {};
    var cls = 's-row';
    if (m.state === 'live') cls += ' is-live';
    if (m.winner) cls += ' done';
    if (m.isNext) cls += ' is-next';
    return '<div class="' + cls + '" data-match="' + m.id + '">' +
      whenHtml(D0, m, opts) +
      teamsHtml(D0, m) +
      '<div class="s-side">' +
        (opts.stage === false ? '' : '<span class="s-tag' + (m.bracket === 'grand' ? ' grand' : '') + '">' + esc(D.stageLabel(m)) + '</span>') +
        tagHtml(m) + actions(D0, m, opts) +
      '</div></div>';
  }

  function scheduleRows(D0, list, opts) {
    if (!list.length) return '<div class="s-empty">Матчей пока нет</div>';
    return '<div class="s-list">' + list.map(function (m) { return scheduleRow(D0, m, opts); }).join('') + '</div>';
  }

  /* ---------- Выбывшие ---------- */
  function outList(D0) {
    var seen = {};
    var rows = [];
    D0.matches.forEach(function (m) {
      if (!m.winner) return;
      var id = D.loserOf(m);
      if (id == null || seen[id]) return;
      seen[id] = true;
      rows.push({ id: id, name: D.teamName(id), matchId: m.id });
    });
    if (!rows.length) return { html: '<div class="out-empty">Пока никого — турнир только начинается</div>', count: 0 };
    return {
      count: rows.length,
      html: rows.map(function (r) {
        return '<div class="out-item" data-team="' + r.id + '" role="button" tabindex="0">' +
          '<span class="name">' + esc(r.name) + '</span>' +
          '<span class="meta">выбыла в M' + r.matchId + '</span></div>';
      }).join('')
    };
  }

  /* ---------- Баннер чемпиона ---------- */
  function champBadge(team, cls) {
    if (team && team.logo) {
      return '<span class="' + (cls || 'champ-badge') + '"><img src="' + esc(team.logo) + '" alt="Логотип ' + esc(team.name) + '" width="58" height="58"></span>';
    }
    return '<span class="' + (cls || 'champ-badge') + '"><span class="ph">' + esc(D.initials(team ? team.name : '?')) + '</span></span>';
  }

  function championBanner(D0, opts) {
    opts = opts || {};
    var champ = D0.champion;
    if (!champ) return '';
    var grand = D0.grandFinal;
    var score = grand && grand.score1 != null ? grand.score1 + ' : ' + grand.score2 : '';
    var sub = D0.runnerUp
      ? 'Гранд-финал против ' + esc(D0.runnerUp.name) + (score ? ' — ' + esc(score) : '')
      : 'Гранд-финал' + (score ? ' — ' + esc(score) : '');
    return '<div class="champ-banner reveal in" data-champion="' + champ.id + '">' +
      champBadge(champ) +
      '<div>' +
        '<div class="cb-label">Победитель ' + esc(D0.tournament.name) + '</div>' +
        '<div class="cb-name">' + esc(champ.name) + '</div>' +
        '<div class="cb-sub">' + sub + '</div>' +
      '</div>' +
      '<div class="champ-actions">' +
        (opts.actions || ('<a class="btn btn-gold" href="#bracket">' + ic('bracket') + 'Сетка</a>' +
          '<a class="btn btn-ghost" href="/history.html">' + ic('trophy') + 'История</a>')) +
      '</div>' +
      '</div>';
  }

  /* ---------- Карточка сезона (архив) ---------- */
  function seasonCard(D0, h, index) {
    var teams = h.teams || [];
    var champ = null;
    for (var i = 0; i < teams.length; i++) if (teams[i] && teams[i].id === h.championId) champ = teams[i];
    var id = 'ch-' + (h.id || index);
    var no = String(index + 1).padStart(2, '0');
    return '<a class="season-card reveal" href="/history.html#' + esc(id) + '">' +
      '<span class="no">' + no + '</span>' +
      '<span><span class="nm">' + esc(h.name || 'Compass Arena') + '</span>' +
      '<span class="meta">' + esc(h.date || '') + (champ ? ' · чемпион: <span class="champ">' + esc(champ.name) + '</span>' : '') + '</span></span>' +
      '<span class="go">' + ic('chevron-right') + '</span>' +
      '</a>';
  }

  /* ---------- Диалог команды ---------- */
  function teamDialogHtml(D0, teamId) {
    var t = D.team(teamId);
    if (!t) return '';
    var logo = t.logo
      ? '<img src="' + esc(t.logo) + '" alt="Логотип ' + esc(t.name) + '" width="60" height="60">'
      : '<span class="ph">' + esc(D.initials(t.name)) + '</span>';

    var roster = t.players && t.players.length
      ? t.players.map(function (p, i) {
          return '<div class="dlg-row"><span class="k">' + esc(p.nick || '—') + '</span>' +
            '<span class="v">' + esc(D.roleName(p.role || i + 1)) + '</span></div>';
        }).join('')
      : '<div class="dlg-row is-none">Состав пока не указан</div>';

    var rec = D0.stats.records[teamId] || { wins: 0, losses: 0, played: 0 };
    var place = '';
    if (D0.champion && D0.champion.id === teamId) place = 'Чемпион турнира';
    else if (D0.runnerUp && D0.runnerUp.id === teamId) place = 'Серебро турнира';
    else if (rec.out) place = 'Выбыла в M' + rec.out;

    var stats = (rec.played > 0)
      ? '<div class="stat-grid" style="margin-top:22px">' +
          '<div class="stat-plate"><div class="v gold">' + rec.wins + '</div><div class="l">Победы</div></div>' +
          '<div class="stat-plate"><div class="v">' + rec.losses + '</div><div class="l">Поражения</div></div>' +
          '<div class="stat-plate"><div class="v">' + rec.mapsWon + ':' + rec.mapsLost + '</div><div class="l">Карты</div></div>' +
        '</div>'
      : '';

    return {
      logo: logo,
      name: t.name,
      sub: place || (D0.phase === 'pre' ? 'Участник турнира' : 'Состав команды'),
      body: roster,
      stats: stats
    };
  }

  CA.views = {
    actions: actions,
    scheduleRow: scheduleRow,
    scheduleRows: scheduleRows,
    outList: outList,
    championBanner: championBanner,
    champBadge: champBadge,
    seasonCard: seasonCard,
    teamDialogHtml: teamDialogHtml,
    tagHtml: tagHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
