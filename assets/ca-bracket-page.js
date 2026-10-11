/* ==========================================================
   Compass Arena — публичная страница сетки (/brackets.html)
   ----------------------------------------------------------
   Читает /api/data, берёт ключи brackets (структура от
   brackets-manager) и bracketsMeta (название, формат, логотипы),
   рисует сетку через /assets/ca-brackets.js и открывает модалку
   с деталями серии по клику на матч.
   ========================================================== */
(function (global) {
  'use strict';

  var CA = global.CA = global.CA || {};
  var U = CA.ui;
  var B = CA.brackets;
  var ic = U.icon;

  /** id участника → имя и логотип: берём из отрисованного DOM и метаданных */
  var names = {};
  var logos = {};

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function participantName(id) {
    if (id === null || id === undefined) return 'TBD';
    return names[id] || ('Участник #' + id);
  }

  function matchTypeLabel(meta) {
    if (meta && meta.matchType) return meta.matchType;
    var settings = meta && meta.stageSettings;
    var games = settings && Number(settings.matchesChildCount);
    if (games >= 5) return 'Bo5';
    if (games >= 3) return 'Bo3';
    return 'Bo1';
  }

  function formatLabel(meta) {
    if (meta && meta.formatLabel) return meta.formatLabel;
    var type = meta && meta.type;
    if (type === 'double_elimination') return 'Double Elimination';
    if (type === 'single_elimination') return 'Single Elimination';
    return 'Сетка';
  }

  function teamCount(meta) {
    if (meta && Number(meta.teamCount)) return Number(meta.teamCount);
    return (meta && Array.isArray(meta.teams)) ? meta.teams.length : 0;
  }

  /* ---------- шапка страницы ---------- */

  function renderFacts(meta) {
    var box = document.getElementById('bracketFacts');
    if (!box) return;
    var teams = teamCount(meta);
    var facts = [];
    if (meta && meta.name) facts.push('<span class="st st-gold">' + ic('champion') + esc(meta.name) + '</span>');
    facts.push('<span class="st st-done">' + ic('bracket') + esc(formatLabel(meta)) + '</span>');
    facts.push('<span class="st">' + ic('swords') + esc(matchTypeLabel(meta)) + '</span>');
    if (teams) facts.push('<span class="st">' + ic('users') + teams + ' ' + (teams === 1 ? 'команда' : (teams < 5 ? 'команды' : 'команд')) + '</span>');
    if (meta && meta.dates) facts.push('<span class="st">' + ic('calendar') + esc(meta.dates) + '</span>');
    box.innerHTML = facts.join('');
  }

  function renderNote(meta) {
    var note = document.getElementById('bracketNote');
    if (!note) return;
    var withLogos = Object.keys(logos).length;
    var parts = [];
    if (meta && meta.savedAt) {
      var date = new Date(meta.savedAt);
      if (!isNaN(date.getTime())) {
        parts.push('Сетка собрана ' + date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }));
      }
    }
    parts.push('Нажмите на пару, чтобы увидеть детали серии');
    if (withLogos) parts.push('логотипы команд — из заявок в Telegram-боте');
    note.textContent = parts.join(' · ');
  }

  /* ---------- имена и логотипы ---------- */

  function collectParticipants(view) {
    var byId = {};
    (view.participants || []).forEach(function (p) {
      byId[p.id] = { name: p.name, logo: p.logo || null };
    });
    return byId;
  }

  /** После рендера в DOM есть title с именем участника — берём оттуда точно */
  function learnNamesFromDom() {
    var nodes = document.querySelectorAll('#bracketViewer .participant[data-participant-id]');
    for (var i = 0; i < nodes.length; i++) {
      var id = nodes[i].getAttribute('data-participant-id');
      var title = nodes[i].getAttribute('title');
      if (id && title && !/^BYE$/i.test(title)) names[id] = title;
    }
  }

  /* ---------- модалка с деталями матча ---------- */

  function gameScore(game) {
    var o1 = game.opponent1 || {};
    var o2 = game.opponent2 || {};
    if (o1.score === undefined && o2.score === undefined) return '—';
    return (o1.score === undefined ? 0 : o1.score) + ' : ' + (o2.score === undefined ? 0 : o2.score);
  }

  function openMatch(match, view) {
    var dlg = document.getElementById('matchDialog');
    if (!dlg) return;

    var meta = match.metadata || {};
    var round = meta.roundNumber ? 'Раунд ' + meta.roundNumber : '';
    var title = participantName(match.opponent1 && match.opponent1.id) + ' — ' + participantName(match.opponent2 && match.opponent2.id);
    document.getElementById('matchDialogTitle').textContent = title;

    var games = (meta.games || []).filter(function (g) { return g && g.status !== undefined; });
    var childCount = games.length || Number(match.child_count) || 0;
    var sub = [];
    sub.push(match.id !== undefined ? 'Матч #' + match.id : 'Матч');
    if (round) sub.push(round);
    if (meta.stageType === 'double_elimination') sub.push('Double Elimination');
    if (childCount > 1) sub.push('до ' + Math.ceil(childCount / 2) + ' побед');
    document.getElementById('matchDialogSub').textContent = sub.join(' · ');

    var rows = [];
    ['opponent1', 'opponent2'].forEach(function (key) {
      var opp = match[key] || {};
      var isWin = opp.result === 'win';
      rows.push('<div class="bm-row"><span class="bm-team"' + (isWin ? ' style="color:var(--gold-hi)"' : '') + '>' +
        (opp.id === null || opp.id === undefined ? 'TBD' : esc(participantName(opp.id))) + '</span>' +
        '<span class="bm-score">' + (opp.score === undefined ? '—' : opp.score) + '</span></div>');
    });

    var html = rows.join('');
    if (childCount) {
      html += '<ul class="bm-games">';
      games.forEach(function (game, i) {
        html += '<li>Игра ' + (i + 1) + ': ' + esc(gameScore(game)) + (game.status === 4 ? ' · завершена' : '') + '</li>';
      });
      html += '</ul>';
    }

    // составы команд, если они есть в метаданных
    var teams = (view && view.meta && view.meta.teams) || [];
    var roster = [];
    [match.opponent1, match.opponent2].forEach(function (opp) {
      if (!opp || opp.id === null || opp.id === undefined) return;
      var name = participantName(opp.id);
      var team = teams.filter(function (t) { return t && t.name === name; })[0];
      if (team && Array.isArray(team.players) && team.players.length) {
        roster.push('<div class="bm-games"><b>' + esc(name) + '</b><ul>' +
          team.players.map(function (p) { return '<li>' + esc(p.nick || p) + '</li>'; }).join('') + '</ul></div>');
      }
    });
    if (roster.length) html += roster.join('');

    document.getElementById('matchDialogBody').innerHTML = html;
    dlg.classList.add('active');
  }

  function closeMatch() {
    var dlg = document.getElementById('matchDialog');
    if (dlg) dlg.classList.remove('active');
  }

  function initDialog() {
    var dlg = document.getElementById('matchDialog');
    if (!dlg) return;
    var close = document.getElementById('matchDialogClose');
    if (close) close.addEventListener('click', closeMatch);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) closeMatch(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dlg.classList.contains('active')) closeMatch();
    });
  }

  /* ---------- отрисовка ---------- */

  function show(which) {
    var status = document.getElementById('bracketStatus');
    var shell = document.getElementById('bracketShell');
    var empty = document.getElementById('bracketEmpty');
    if (status) status.hidden = which !== 'loading';
    if (shell) shell.hidden = which !== 'ready';
    if (empty) empty.hidden = which !== 'empty';
  }

  function render(raw) {
    var data = raw && raw.brackets;
    var meta = (raw && raw.bracketsMeta) || {};

    renderFacts(meta);

    if (!data || !Array.isArray(data.matches) || !data.matches.length) {
      show('empty');
      return;
    }

    show('ready');
    var view = B.toViewerData(data);
    var byId = collectParticipants(view);
    Object.keys(byId).forEach(function (id) {
      names[id] = byId[id].name;
      if (byId[id].logo) logos[id] = byId[id].logo;
    });

    return B.render('#bracketViewer', data, {
      meta: meta,
      onMatchClick: function (match) {
        learnNamesFromDom();
        openMatch(match, { meta: meta });
      }
    }).then(function (rendered) {
      learnNamesFromDom();
      renderNote(meta);
      if (U.observeReveals) U.observeReveals();
      return rendered;
    }).catch(function (err) {
      console.warn('[CA.brackets] не удалось нарисовать сетку:', err);
      var status = document.getElementById('bracketStatus');
      if (status) {
        status.hidden = false;
        status.textContent = 'Сетка не отрисовалась: ' + (err && err.message ? err.message : 'неизвестная ошибка');
      }
      var shell = document.getElementById('bracketShell');
      if (shell) shell.hidden = true;
    });
  }

  function init() {
    U.injectSprite();
    U.initChrome();
    initDialog();

    fetch('/api/data?light=1', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (raw) {
        if (raw && raw.tournament && U.setProgress) {
          // прогресс турнира в шапке — по данным турнира, если они есть
          var played = (raw.matches || []).filter(function (m) { return m && m.winner; }).length;
          var total = (raw.matches || []).length || 1;
          U.setProgress(played / total);
        }
        return render(raw);
      })
      .catch(function (err) {
        console.warn('[CA.brackets] /api/data недоступен:', err);
        show('empty');
      });
  }

  CA.bracketPage = { init: init, render: render };
  U.contentReady(init);
})(typeof window !== 'undefined' ? window : globalThis);
