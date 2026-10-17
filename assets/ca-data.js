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
  /* «Слот 1», «Команда 2», «Team 3» и пустые имена — это не команда, а место под неё.
     Нужно, чтобы после сброса сезона заглушки не становились «чемпионами» и не попадали в статистику. */
  var SLOT_RE = /^(слот|команда|team|участник)\s*[№#]?\s*\d*$/i;
  function isPlaceholderName(name) {
    var s = String(name == null ? '' : name).trim();
    if (!s) return true;
    if (SLOT_RE.test(s)) return true;
    if (/^(слот|команда)\b/i.test(s) && /\d/.test(s)) return true;
    return false;
  }
  function isRealTeam(t) { return !!t && !isPlaceholderName(t.name); }

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
      /* Настройки универсальной сетки (если турнир собран движком) */
      bracket: (src.bracket && typeof src.bracket === 'object') ? src.bracket : null,
      history: Array.isArray(src.history) ? src.history : [],
      fromServer: !!(raw && typeof raw === 'object' && (src.teams || src.matches))
    };

    /* Dota 2 без команд показывает заглушку «Слот 1–6»; новые дисциплины стартуют пустыми */
    var emptyOk = !!(src.game && src.game !== 'dota2');
    D.game = src.game || 'dota2';
    var teams = Array.isArray(src.teams) && src.teams.length ? src.teams : (emptyOk ? [] : def.teams);
    for (var i = 0; i < teams.length; i++) {
      var t = teams[i] || {};
      D.teams.push({
        id: toInt(t.id) != null ? toInt(t.id) : i + 1,
        name: String(t.name == null ? '' : t.name),
        logo: t.logo || '',
        players: normPlayers(t.players)
      });
    }

    var matches = Array.isArray(src.matches) && src.matches.length ? src.matches : (emptyOk ? [] : def.matches);
    for (var m = 0; m < matches.length; m++) {
      var mm = matches[m] || {};
      var match = {
        id: toInt(mm.id) != null ? toInt(mm.id) : m + 1,
        round: toInt(mm.round) || 1,
        bracket: mm.bracket || (toInt(mm.round) >= 3 ? 'grand' : 'upper'),
        team1: toInt(mm.team1),
        team2: toInt(mm.team2),
        winner: toInt(mm.winner),
        score1: mm.score1 == null || mm.score1 === '' ? null : toInt(mm.score1),
        score2: mm.score2 == null || mm.score2 === '' ? null : toInt(mm.score2),
        vod: mm.vod || ''
      };
      /* Источники слотов универсальной сетки: { m: id, as: 'w'|'l' } */
      if (mm.from1) match.from1 = { m: toInt(mm.from1.m), as: mm.from1.as === 'l' ? 'l' : 'w' };
      if (mm.from2) match.from2 = { m: toInt(mm.from2.m), as: mm.from2.as === 'l' ? 'l' : 'w' };
      if (mm.idle) match.idle = true;
      if (mm.resetFor) match.resetFor = toInt(mm.resetFor);
      D.matches.push(match);
    }

    if (src.schedule && typeof src.schedule === 'object') {
      Object.keys(src.schedule).forEach(function (k) {
        var ts = toTs(src.schedule[k]);
        if (ts) D.schedule[k] = ts;
      });
    }
    return D;
  }

  /* ---------- Связи сетки ----------
     Старый турнир (6 команд, M1–M5) расставляется жёстко; новая универсальная
     сетка приходит с готовыми источниками слотов (from1/from2), и мы просто
     подставляем победителей и проигравших по этим связям. */
  function linkBracket(D) {
    var by = {};
    D.matches.forEach(function (m) { by[m.id] = m; });

    if (D.bracket && D.bracket.format) {
      linkGeneratedBracket(D, by);
    } else {
      if (by[4]) {
        by[4].team1 = by[1] ? by[1].winner : by[4].team1;
        by[4].team2 = by[2] ? by[2].winner : by[4].team2;
      }
      if (by[5]) {
        by[5].team1 = by[4] ? by[4].winner : by[5].team1;
        by[5].team2 = by[3] ? by[3].winner : by[5].team2;
      }
    }

    // Чистим результаты, которые потеряли смысл после правок.
    // Матчи с BYE — исключение: там победитель есть, хотя второго слота нет.
    D.matches.forEach(function (m) {
      if (m.bye) return;
      if (m.winner && m.winner !== m.team1 && m.winner !== m.team2) {
        m.winner = null; m.score1 = null; m.score2 = null;
      }
      if ((m.team1 == null || m.team2 == null) && m.winner != null) {
        m.winner = null; m.score1 = null; m.score2 = null;
      }
    });
    return D;
  }

  /**
   * Универсальная сетка: проходим матчи по порядку и раскладываем команды
   * из источников (победитель/проигравший другого матча). Матчи с одним
   * участником (BYE) отдают победу автоматически, чтобы команда шла дальше.
   */
  function linkGeneratedBracket(D, by) {
    var order = D.matches.slice().sort(function (a, b) { return a.id - b.id; });

    function fromSource(src) {
      if (!src) return null;
      var m = by[src.m];
      if (!m || !m.winner) return null;
      if (src.as === 'l') {
        if (!m.team1 || !m.team2) return null;
        return m.winner === m.team1 ? m.team2 : m.team1;
      }
      return m.winner;
    }

    /* Состояние матчей, у которых «нет исхода»:
         void — играть некому (оба источника мертвы), победителя и проигравшего не будет;
         pass — один источник мёртв, команда другого слота проходит без игры (проигравшего нет).
       Мёртвый источник — пустой матч (void) или проигравший матча-прохода (pass). */
    var status = {};
    function srcDead(src) {
      var st = src && status[src.m];
      if (!st) return false;
      if (st.void) return true;
      return src.as === 'l' && st.pass;
    }

    order.forEach(function (m) {
      var st = { void: false, pass: false };
      m.dead1 = false; m.dead2 = false;

      if (!m.from1 && !m.from2) {
        /* Первый раунд: команды расставлены по посеву */
        if (m.team1 && !m.team2) { m.winner = m.team1; m.bye = true; st.pass = true; }
        else if (m.team2 && !m.team1) { m.winner = m.team2; m.bye = true; st.pass = true; }
        else if (!m.team1 && !m.team2) {
          if (m.winner) { m.winner = null; m.score1 = null; m.score2 = null; }
          if (m.idle) st.void = true;
        }
      } else if (m.idle) {
        m.winner = null; st.void = true;
      } else if (m.resetFor && by[m.resetFor] && by[m.resetFor].winner &&
                 by[m.resetFor].winner === by[m.resetFor].team1) {
        /* Матч сброса: первый гранд-финал выиграл выходец верхней сетки — играть нечего */
        m.team1 = null; m.team2 = null; m.winner = null; m.score1 = null; m.score2 = null;
        m.bye = false; m.idle = true; m.dead1 = true; m.dead2 = true;
        st.void = true;
      } else {
        var d1 = m.from1 ? srcDead(m.from1) : true;
        var d2 = m.from2 ? srcDead(m.from2) : true;
        m.team1 = (m.from1 && !d1) ? fromSource(m.from1) : null;
        m.team2 = (m.from2 && !d2) ? fromSource(m.from2) : null;
        m.dead1 = d1; m.dead2 = d2;
        if (d1 && d2) {
          m.winner = null; m.score1 = null; m.score2 = null; m.bye = false; m.idle = true;
          st.void = true;
        } else if (d1 || d2) {
          /* Соперника не будет: команда пройдёт, как только появится */
          var only = d1 ? m.team2 : m.team1;
          m.bye = true; st.pass = true;
          m.winner = only || null;
        } else if (m.bye) {
          m.bye = false;
        }
      }
      status[m.id] = st;
    });
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
    /* Гранд-финал: в старой сетке это жёстко M5, в универсальной — последний матч
       сетки (а при гранд-финале «до двух поражений» — матч сброса, если он сыгран). */
    var grand = null;
    if (D.bracket && D.bracket.format) {
      var finals = D.matches.filter(function (m) { return m.bracket === 'grand'; });
      /* Если первый финал взял выходец нижней сетки, главным становится матч сброса */
      var resetNeeded = finals.filter(function (m) {
        var gf = m.resetFor && D.byId[m.resetFor];
        return gf && gf.winner && gf.winner === gf.team2 && !m.idle;
      })[0];
      grand = resetNeeded
        || finals.filter(function (m) { return m.winner; })[0]
        || finals[0]
        || null;
    } else {
      grand = D.byId[5] || null;
    }
    D.grandFinal = grand || null;
    /* Чемпионом считается только реально существующая команда: если после сброса сезона
       в сетке остался старый winner, а команда удалена (или подставлена заглушка «Слот N»),
       турнир не должен выглядеть завершённым. */
    D.champion = grand && grand.winner ? team(D, grand.winner) : null;
    if (!isRealTeam(D.champion)) D.champion = null;
    D.runnerUp = grand && grand.winner ? team(D, loserOf(grand)) : null;
    if (!isRealTeam(D.runnerUp)) D.runnerUp = null;
    D.realTeams = D.teams.filter(isRealTeam);
    D.isRegistration = D.realTeams.length === 0;

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
    if (grand && grand.winner && D.champion) D.phase = 'post';
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
      teams: (D.realTeams || D.teams).length,
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
      if (!isRealTeam(t)) return;
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
  /**
   * Подпись раунда по «остатку» до финала: финал, полуфинал, четвертьфинал,
   * а ранние раунды — по числу матчей в них («1/8 финала»). Считается от самих
   * матчей, поэтому подписи всегда соответствуют тому, что нарисовано, даже
   * если конфиг сетки почему-то разошёлся с данными.
   */
  function roundLabel(part, round, total, size) {
    var left = total - round;
    if (left === 0) return 'Финал ' + part;
    if (left === 1) return 'Полуфинал ' + part;
    if (left === 2) return 'Четвертьфинал ' + part;
    var inRound = Math.max(1, Math.round((size || Math.pow(2, total)) / Math.pow(2, round)));
    if (inRound >= 2) return '1/' + inRound + ' финала ' + part;
    return 'Раунд ' + round + ' ' + part;
  }

  /** Сколько раундов в части сетки (по самим матчам) и размер сетки */
  function bracketShape(matches) {
    var maxUpper = 0, maxLower = 0, firstRound = null;
    (matches || []).forEach(function (m) {
      if (m.bracket === 'lower') maxLower = Math.max(maxLower, m.round);
      else if (m.bracket !== 'grand' && m.bracket !== 'third') maxUpper = Math.max(maxUpper, m.round);
      if (m.bracket !== 'grand' && m.bracket !== 'third') {
        firstRound = firstRound === null ? m.round : Math.min(firstRound, m.round);
      }
    });
    var size = 1;
    if (firstRound !== null) {
      var firstRoundMatches = (matches || []).filter(function (m) {
        return m.round === firstRound && m.bracket !== 'grand' && m.bracket !== 'third';
      }).length;
      size = Math.pow(2, Math.round(Math.log(firstRoundMatches * 2) / Math.LN2)) || 2;
    }
    return { upper: maxUpper, lower: maxLower, size: size };
  }

  /**
   * Подпись стадии. У универсальной сетки (есть настройки D.bracket) считаем
   * по раундам, у старой сетки на шесть матчей остаётся прежняя логика по
   * номерам: у неё раундов «как надо» нет, и «1/2 финала» выглядело бы странно.
   */
  function stageLabel(m, matches) {
    if (!m) return '';
    if (m.bracket === 'grand') return m.resetFor ? 'Гранд-финал · сброс' : 'Гранд-финал';
    if (m.bracket === 'third') return 'Матч за 3-е место';
    var generated = !!(D && D.bracket && D.bracket.format);
    var list = matches || (D && D.matches);
    if (generated && list && list.length) {
      var shape = bracketShape(list);
      if (m.bracket === 'lower' && shape.lower) return roundLabel('нижней', m.round, shape.lower, shape.size / 2);
      if (shape.upper) return roundLabel('верхней', m.round, shape.upper, shape.size);
    }
    if (m.id === 5 && !m.resetFor) return 'Гранд-финал';
    if (m.bracket === 'lower') return 'Нижняя · раунд ' + m.round;
    if (m.round === 2 || m.id === 4) return 'Полуфинал';
    return 'Раунд ' + m.round;
  }
  var TBD = { 4: ['Победитель M1', 'Победитель M2'], 5: ['Победитель M4', 'Победитель M3'] };
  function slotLabel(D, m, slot) {
    var t = team(D, slot === 1 ? m.team1 : m.team2);
    var hint = TBD[m.id] ? TBD[m.id][slot - 1] : 'Ожидается';
    /* Универсальная сетка знает источник слота: победитель или проигравший другого матча */
    var src = slot === 1 ? m.from1 : m.from2;
    if (src) hint = (src.as === 'l' ? 'Проигравший M' : 'Победитель M') + src.m;
    else if (m.idle) hint = 'Не играется';
    else if (!src && m.id > 5) hint = 'Проходит без игры';
    if (m['dead' + slot]) hint = 'Без соперника';
    /* Заглушка («Слот 3») — это не участник: показываем подсказку, откуда придёт команда */
    if (!isRealTeam(t)) return { text: hint, team: null, known: false };
    return { text: t.name, team: t, known: true };
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

  var GAME = 'dota2';
  function dataUrl(game, light) {
    return '/api/data?game=' + encodeURIComponent(game) + (light ? '&light=1' : '');
  }
  function fetchRaw(game, light) {
    return fetch(dataUrl(game, light), { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  /** Загружает данные дисциплины (по умолчанию — текущей) и делает их текущими */
  function load(game) {
    if (game) GAME = game;
    var requested = GAME;
    return fetchRaw(requested)
      .then(function (raw) {
        if (requested !== GAME) return D;      // успели переключиться на другую игру
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

  /** Все дисциплины сразу (расписание, архив): { games: {id: D}, history } — текущее состояние не трогает */
  function loadAll() {
    var ids = (CA.games && CA.games.ids) || ['dota2'];
    return Promise.all(ids.map(function (id) {
      return fetchRaw(id, true)
        .then(function (raw) { var d = finalize(normalize(Object.assign({ game: id }, raw))); d.fromServer = true; return [id, d, raw]; })
        .catch(function () { return [id, finalize(normalize({ game: id })), null]; });
    })).then(function (list) {
      var games = {};
      var history = [];
      list.forEach(function (it) {
        games[it[0]] = it[1];
        if (!history.length && it[2] && Array.isArray(it[2].history)) history = it[2].history;
      });
      return { games: games, history: history };
    });
  }

  function setGame(game) { GAME = (CA.games && CA.games.isGame(game)) ? game : 'dota2'; return GAME; }
  function getGame() { return GAME; }

  function startAutoRefresh(ms) {
    if (timer) clearInterval(timer);
    timer = setInterval(function () { load(); }, ms || 60000);
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
    loadAll: loadAll,
    setGame: setGame,
    game: getGame,
    setRaw: setRaw,
    onChange: onChange,
    startAutoRefresh: startAutoRefresh,
    esc: esc,
    attr: attr,
    initials: initials,
    plural: plural,
    isPlaceholderName: isPlaceholderName,
    isRealTeam: isRealTeam,
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
