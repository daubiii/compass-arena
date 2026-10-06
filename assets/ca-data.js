/* ==========================================================
   Compass Arena — слой данных
   ----------------------------------------------------------
   Единый источник правды для всех публичных страниц:
   загрузка /api/data, нормализация, связи сетки, фазы турнира
   (pre → live → post), статистика и форматирование времени.

   Страницы не работают с сырым ответом API напрямую.
   ========================================================== */
(function (global) {
  'use strict';

  var CA = global.CA = global.CA || {};
  var TZ = 'Europe/Moscow';
  /* Резервные даты: если организатор ещё не заполнил поля в админке,
     таймер и полоса прогресса всё равно что-то показывают. */
  var START_FALLBACK = '2026-09-26T12:00:00+03:00';
  var PROJECT_FALLBACK = '2026-01-01T00:00:00+03:00';

  /* ---------- Значения по умолчанию (совпадают с админкой) ---------- */
  function defaults() {
    return {
      tournament: {
        name: 'Compass Arena',
        game: 'Dota 2',
        format: 'Custom Bracket',
        matches: 'Bo3',
        dates: '26 сентября 2026'
      },
      teams: [
        { id: 1, name: 'Слот 1', players: [], logo: '' },
        { id: 2, name: 'Слот 2', players: [], logo: '' },
        { id: 3, name: 'Слот 3', players: [], logo: '' },
        { id: 4, name: 'Слот 4', players: [], logo: '' },
        { id: 5, name: 'Слот 5', players: [], logo: '' },
        { id: 6, name: 'Слот 6', players: [], logo: '' }
      ],
      matches: [
        { id: 1, round: 1, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null, vod: '' },
        { id: 2, round: 1, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null, vod: '' },
        { id: 3, round: 1, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null, vod: '' },
        { id: 4, round: 2, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null, vod: '' },
        { id: 5, round: 3, team1: null, team2: null, winner: null, bracket: 'grand', score1: null, score2: null, vod: '' }
      ],
      schedule: {},
      liveMatchId: null,
      tournamentStart: null,
      projectStart: null,
      nextSeason: null,
      alwaysShowBracketBanner: true
    };
  }

  /* ---------- Мелочи ---------- */
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function attr(s) { return esc(s); }
  function toInt(v) { var n = parseInt(v, 10); return isNaN(n) ? null : n; }
  function toTs(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var t = new Date(v).getTime();
    return isNaN(t) ? null : t;
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }
  function initials(name) {
    var s = String(name == null ? '' : name).trim();
    return s ? s.charAt(0).toUpperCase() : '?';
  }

  /* ---------- Время (всё показываем по Москве + местное рядом) ---------- */
  function mskDate(ts, opts) {
    return new Date(ts).toLocaleDateString('ru-RU', Object.assign({ timeZone: TZ }, opts || {}));
  }
  function mskTime(ts) {
    return new Date(ts).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  }
  function whenDate(ts, opts) {
    try { return mskDate(ts, opts).replace(' г.', ''); } catch (e) { return ''; }
  }
  function fmtDateTime(ts) {
    if (!ts) return '';
    try { return whenDate(ts, { day: 'numeric', month: 'long' }) + ', ' + mskTime(ts) + ' МСК'; }
    catch (e) { return ''; }
  }
  function fmtShort(ts) {
    if (!ts) return '';
    try { return whenDate(ts, { day: 'numeric', month: 'short' }).replace('.', '') + ', ' + mskTime(ts); }
    catch (e) { return ''; }
  }
  function fmtDayKey(ts) {
    try { return whenDate(ts, { day: 'numeric', month: 'long', weekday: 'long' }); }
    catch (e) { return ''; }
  }
  function fmtDayTitle(ts) {
    var s = fmtDayKey(ts);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }
  function isMoscow() {
    try { return -new Date().getTimezoneOffset() === 180; } catch (e) { return true; }
  }
  /* Местное время зрителя — только если он не в Москве */
  function localTime(ts) {
    if (!ts || isMoscow()) return '';
    try {
      var d = new Date(ts);
      var out = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      var sameDay = whenDate(ts, { day: 'numeric', month: 'numeric' }) ===
        d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' });
      if (!sameDay) out += ', ' + whenDate(d.getTime(), { day: 'numeric', month: 'short' }).replace('.', '');
      return out;
    } catch (e) { return ''; }
  }

  /* ---------- Роли ---------- */
  var ROLES = { 1: 'Керри', 2: 'Мидер', 3: 'Офлейн', 4: 'Саппорт 4', 5: 'Саппорт 5' };
  function roleName(role) { return ROLES[role] || ('Позиция ' + role); }
  function normPlayers(list) {
    var out = [];
    if (!list) return out;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (typeof p === 'string') out.push({ nick: p, role: i + 1 });
      else if (p && typeof p === 'object') out.push({ nick: p.nick || p.name || '', role: toInt(p.role) || (i + 1) });
    }
    return out;
  }

  /* ---------- Нормализация ответа API ---------- */
  function normalize(raw) {
    var def = defaults();
    var src = raw && typeof raw === 'object' ? raw : {};
    var startFromServer = !!toTs(src.tournamentStart);
    var projFromServer = !!toTs(src.projectStart);
    var D = {
      tournament: Object.assign(def.tournament, src.tournament || {}),
      teams: [],
      matches: [],
      schedule: {},
      liveMatchId: toInt(src.liveMatchId),
      tournamentStart: startFromServer ? toTs(src.tournamentStart) : toTs(START_FALLBACK),
      projectStart: projFromServer ? toTs(src.projectStart) : toTs(PROJECT_FALLBACK),
      startFromServer: startFromServer,
      nextSeason: src.nextSeason || null,
      alwaysShowBracketBanner: src.alwaysShowBracketBanner !== false,
      history: Array.isArray(src.history) ? src.history : [],
      fromServer: !!(raw && typeof raw === 'object' && (src.teams || src.matches))
    };

    var teams = Array.isArray(src.teams) && src.teams.length ? src.teams : def.teams;
    for (var i = 0; i < teams.length; i++) {
      var t = teams[i] || {};
      D.teams.push({
        id: toInt(t.id) != null ? toInt(t.id) : i + 1,
        name: String(t.name == null ? '' : t.name),
        logo: t.logo || '',
        players: normPlayers(t.players)
      });
    }

    var matches = Array.isArray(src.matches) && src.matches.length ? src.matches : def.matches;
    for (var m = 0; m < matches.length; m++) {
      var mm = matches[m] || {};
      D.matches.push({
        id: toInt(mm.id) != null ? toInt(mm.id) : m + 1,
        round: toInt(mm.round) || 1,
        bracket: mm.bracket || (toInt(mm.round) >= 3 ? 'grand' : 'upper'),
        team1: toInt(mm.team1),
        team2: toInt(mm.team2),
        winner: toInt(mm.winner),
        score1: mm.score1 == null || mm.score1 === '' ? null : toInt(mm.score1),
        score2: mm.score2 == null || mm.score2 === '' ? null : toInt(mm.score2),
        vod: mm.vod || ''
      });
    }

    if (src.schedule && typeof src.schedule === 'object') {
      Object.keys(src.schedule).forEach(function (k) {
        var ts = toTs(src.schedule[k]);
        if (ts) D.schedule[k] = ts;
      });
    }
    return D;
  }

  /* ---------- Связи сетки: M1/M2 → M4, M4/M3 → M5 ---------- */
  function linkBracket(D) {
    var by = {};
    D.matches.forEach(function (m) { by[m.id] = m; });
    if (by[4]) {
      by[4].team1 = by[1] ? by[1].winner : by[4].team1;
      by[4].team2 = by[2] ? by[2].winner : by[4].team2;
    }
    if (by[5]) {
      by[5].team1 = by[4] ? by[4].winner : by[5].team1;
      by[5].team2 = by[3] ? by[3].winner : by[5].team2;
    }
    // Чистим результаты, которые потеряли смысл после правок
    D.matches.forEach(function (m) {
      if (m.winner && m.winner !== m.team1 && m.winner !== m.team2) {
        m.winner = null; m.score1 = null; m.score2 = null;
      }
      if ((m.team1 == null || m.team2 == null) && m.winner != null) {
        m.winner = null; m.score1 = null; m.score2 = null;
      }
    });
    return D;
  }

  /* ---------- Готовый набор + вычисленные поля ---------- */
  function finalize(D) {
    linkBracket(D);

    D.byId = {};
    D.matches.forEach(function (m) { D.byId[m.id] = m; });
    D.teamsById = {};
    D.teams.forEach(function (t) { D.teamsById[t.id] = t; });

    D.matches.forEach(function (m) {
      m.scheduled = D.schedule[m.id] || null;
      m.bothKnown = !!(m.team1 && m.team2);
      if (m.winner) m.state = 'done';
      else if (D.liveMatchId === m.id) m.state = 'live';
      else if (!m.bothKnown) m.state = 'tbd';
      else m.state = 'upcoming';
    });

    var now = Date.now();
    var grand = D.byId[5];
    D.grandFinal = grand || null;
    D.champion = grand && grand.winner ? team(D, grand.winner) : null;
    D.runnerUp = grand && grand.winner ? team(D, loserOf(grand)) : null;

    // Следующий матч: сначала живой эфир, потом ближайший по расписанию
    var live = null, soon = null, late = null;
    D.matches.forEach(function (m) {
      if (m.state === 'live') live = m;
      if (m.winner || !m.scheduled) return;
      if (m.scheduled >= now) { if (!soon || m.scheduled < soon.scheduled) soon = m; }
      else if (!late || m.scheduled < late.scheduled) late = m;
    });
    D.liveMatch = live;
    D.nextMatch = live || soon || late || null;
    D.nextMatchAt = D.nextMatch ? D.nextMatch.scheduled : null;
    if (!live && D.nextMatch && D.nextMatch.state === 'upcoming' && D.nextMatch === soon) {
      D.nextMatch.isNext = true;
    }
    D.matches.forEach(function (m) {
      if (m !== D.nextMatch) m.isNext = false;
    });

    // Фаза: до старта → эфир → после финала.
    // Дата-заглушка не может «включить» эфир — только реальная дата из админки.
    if (grand && grand.winner) D.phase = 'post';
    else if (live || (D.startFromServer && now >= D.tournamentStart)) D.phase = 'live';
    else D.phase = 'pre';

    if (D.phase === 'post') {
      D.matches.forEach(function (m) { if (!m.winner && m.state !== 'live') m.state = 'upcoming'; });
    }

    D.stats = computeStats(D);
    D.phaseLabel = { pre: 'До старта', live: 'Идёт турнир', post: 'Турнир завершён' }[D.phase];
    return D;
  }

  function team(D, id) { return id == null ? null : (D.teamsById[id] || null); }
  function teamName(D, id) { var t = team(D, id); return t ? t.name : '—'; }
  function loserOf(m) {
    if (!m || !m.winner) return null;
    if (m.team1 === m.winner) return m.team2;
    if (m.team2 === m.winner) return m.team1;
    return null;
  }

  /* ---------- Статистика ---------- */
  function computeStats(D) {
    var st = {
      teams: D.teams.length,
      matchesTotal: D.matches.length,
      played: 0,
      remaining: 0,
      maps: 0,
      sweeps: 0,
      deciders: 0,
      live: !!D.liveMatch,
      records: {},
      standings: []
    };
    D.teams.forEach(function (t) {
      st.records[t.id] = { team: t, played: 0, wins: 0, losses: 0, mapsWon: 0, mapsLost: 0, out: null };
    });
    D.matches.forEach(function (m) {
      if (!m.winner) { st.remaining++; return; }
      st.played++;
      var s1 = m.score1, s2 = m.score2;
      if (s1 != null && s2 != null) {
        st.maps += s1 + s2;
        if (s1 === 2 || s2 === 2) { if ((s1 === 0 || s2 === 0)) st.sweeps++; else st.deciders++; }
      }
      var w = st.records[m.winner], l = st.records[loserOf(m)];
      if (w) {
        w.played++; w.wins++;
        if (s1 != null && s2 != null) {
          w.mapsWon += m.winner === m.team1 ? s1 : s2;
          w.mapsLost += m.winner === m.team1 ? s2 : s1;
        }
      }
      if (l) {
        l.played++; l.losses++;
        if (s1 != null && s2 != null) {
          l.mapsWon += l.team.id === m.team1 ? s1 : s2;
          l.mapsLost += l.team.id === m.team1 ? s2 : s1;
        }
        if (!l.out) l.out = m.id;
      }
    });
    st.standings = Object.keys(st.records).map(function (k) { return st.records[k]; })
      .sort(function (a, b) {
        if (b.wins !== a.wins) return b.wins - a.wins;
        var d = (b.mapsWon - b.mapsLost) - (a.mapsWon - a.mapsLost);
        if (d) return d;
        return a.team.id - b.team.id;
      });
    return st;
  }

  /* ---------- Подписи стадий ---------- */
  function stageLabel(m) {
    if (!m) return '';
    if (m.bracket === 'grand' || m.id === 5) return 'Гранд-финал';
    if (m.bracket === 'lower') return 'Нижняя сетка';
    if (m.round === 2 || m.id === 4) return 'Полуфинал';
    return 'Раунд ' + m.round;
  }
  var TBD = { 4: ['Победитель M1', 'Победитель M2'], 5: ['Победитель M4', 'Победитель M3'] };
  function slotLabel(D, m, slot) {
    var t = team(D, slot === 1 ? m.team1 : m.team2);
    if (t) return { text: t.name, team: t, known: true };
    var hint = TBD[m.id] ? TBD[m.id][slot - 1] : 'Ожидается';
    return { text: hint, team: null, known: false };
  }

  /* ---------- Календарь (.ics) ---------- */
  function icsStamp(ts) {
    return new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  function icsFor(D, m) {
    if (!m || !m.scheduled) return '';
    var a = slotLabel(D, m, 1).text, b = slotLabel(D, m, 2).text;
    var title = D.tournament.name + ': ' + a + ' vs ' + b + ' (' + stageLabel(m) + ')';
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Compass Arena//RU', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:compass-arena-m' + m.id + '-' + m.scheduled + '@compassarena.ru',
      'DTSTAMP:' + icsStamp(Date.now()),
      'DTSTART:' + icsStamp(m.scheduled),
      'DTEND:' + icsStamp(m.scheduled + 2 * 3600 * 1000),
      'SUMMARY:' + icsText(title),
      'DESCRIPTION:' + icsText('Трансляция: https://www.twitch.tv/compassarena'),
      'LOCATION:' + icsText('Twitch — compassarena'),
      'URL:https://compassarena.ru/schedule.html',
      'END:VEVENT', 'END:VCALENDAR'
    ];
    return lines.join('\r\n');
  }
  function icsText(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }
  function icsHref(D, m) {
    var body = icsFor(D, m);
    return body ? 'data:text/calendar;charset=utf-8,' + encodeURIComponent(body) : '';
  }

  /* ---------- schema.org ---------- */
  function schemaOrg(D) {
    var origin = 'https://compassarena.ru';
    var ev = {
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      name: D.tournament.name + ' — турнир по ' + D.tournament.game,
      sport: 'Esports',
      description: 'Турнир по ' + D.tournament.game + ' от организации Compass Arena. Формат ' + D.tournament.matches + '.',
      url: origin + '/',
      eventStatus: D.phase === 'post' ? 'https://schema.org/EventScheduled' : 'https://schema.org/EventScheduled',
      organizer: { '@type': 'Organization', name: 'Compass Arena', url: origin + '/' },
      competitor: D.teams.filter(function (t) { return t.name && !/^Слот\s*\d+$/i.test(t.name); })
        .map(function (t) { return { '@type': 'SportsTeam', name: t.name }; })
    };
    if (D.tournamentStart) {
      ev.startDate = new Date(D.tournamentStart).toISOString();
      ev.endDate = new Date(D.tournamentStart + 6 * 3600 * 1000).toISOString();
    }
    if (D.champion) ev.winner = { '@type': 'SportsTeam', name: D.champion.name };
    var sub = D.matches.filter(function (m) { return m.bothKnown; }).map(function (m) {
      var o = {
        '@type': 'SportsEvent',
        name: stageLabel(m) + ': ' + teamName(D, m.team1) + ' — ' + teamName(D, m.team2),
        competitor: [
          { '@type': 'SportsTeam', name: teamName(D, m.team1) },
          { '@type': 'SportsTeam', name: teamName(D, m.team2) }
        ]
      };
      if (m.scheduled) o.startDate = new Date(m.scheduled).toISOString();
      if (m.winner) o.winner = { '@type': 'SportsTeam', name: teamName(D, m.winner) };
      return o;
    });
    if (sub.length) ev.subEvent = sub;
    return ev;
  }

  /* ---------- Хранилище и загрузка ---------- */
  var D = finalize(normalize(null));
  var listeners = [];
  var timer = null;

  function get() { return D; }
  function setRaw(raw) {
    D = finalize(normalize(raw));
    listeners.forEach(function (fn) { try { fn(D); } catch (e) { console.warn(e); } });
    return D;
  }
  function onChange(fn) { listeners.push(fn); return fn; }

  function load() {
    return fetch('/api/data', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (raw) {
        var data = Object.assign({}, raw);
        D = finalize(normalize(data));
        D.fromServer = true;
        listeners.forEach(function (fn) { try { fn(D); } catch (e) { console.warn(e); } });
        return D;
      })
      .catch(function (err) {
        console.warn('[CA] данные не загрузились, показываем резервные', err);
        return D;
      });
  }

  function startAutoRefresh(ms) {
    if (timer) clearInterval(timer);
    timer = setInterval(load, ms || 60000);
    return timer;
  }

  /* ---------- Экспорт ---------- */
  CA.data = {
    TZ: TZ,
    defaults: defaults,
    normalize: normalize,
    finalize: finalize,
    get: get,
    load: load,
    setRaw: setRaw,
    onChange: onChange,
    startAutoRefresh: startAutoRefresh,
    esc: esc,
    attr: attr,
    initials: initials,
    plural: plural,
    roleName: roleName,
    normPlayers: normPlayers,
    team: function (id) { return team(D, id); },
    teamName: function (id) { return teamName(D, id); },
    match: function (id) { return D.byId[id] || null; },
    loserOf: loserOf,
    slotLabel: function (m, slot) { return slotLabel(D, m, slot); },
    stageLabel: stageLabel,
    fmtDateTime: fmtDateTime,
    fmtShort: fmtShort,
    fmtDayKey: fmtDayKey,
    fmtDayTitle: fmtDayTitle,
    mskTime: mskTime,
    mskDate: mskDate,
    whenDate: whenDate,
    localTime: localTime,
    isMoscow: isMoscow,
    icsFor: function (m) { return icsFor(D, m); },
    icsHref: function (m) { return icsHref(D, m); },
    schemaOrg: function () { return schemaOrg(D); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
