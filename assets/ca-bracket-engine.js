/* ==========================================================
   Compass Arena — движок универсальной сетки
   ----------------------------------------------------------
   Генерирует структуру матчей для турнира с любым числом
   команд (4, 6, 8, 10, 12, 14, 16) в форматах:
     • SE — single elimination (олимпийка), опционально матч за 3-е место;
     • DE — double elimination (верхняя + нижняя сетка + гранд-финал,
       который может быть одним матчем или «до двух поражений»).

   Матч описывается теми же полями, что и раньше (id, round, bracket,
   team1, team2, winner, score1, score2, vod) плюс источники слотов:
     from1 / from2 = { m: <id матча>, as: 'w' | 'l' }  — слот берётся у
     победителя или проигравшего указанного матча. Если источника нет,
     слот заполняется командой вручную (или остаётся BYE).

   Команды с номерами сеяных: первый раунд расставляет их по схеме
   «сильнейший против слабейшего». Если команд меньше размера сетки,
   лишние слоты остаются пустыми — это BYE, команда проходит без игры.

   Модуль не зависит ни от чего: один и тот же файл подключают и
   публичные страницы, и админка, и node-тесты.

   Экспорт: CA.bracketEngine
     nextPow2(n) · sizeFor(n) · byesFor(n)
     seedingOrder(size) · seedPairs(size)
     generate({ teamCount, format, matchType, thirdPlace, grandFinal })
     destinations(matches) · describe(matches)
   ========================================================== */
(function (global) {
  'use strict';

  var CA = global.CA = global.CA || {};
  var VERSION = '2.1.0';   /* поднимается при правках движка — видно в тестах */

  /** Ближайшая степень двойки вверх: 6 → 8, 10 → 16 */
  function nextPow2(n) {
    var size = 1;
    while (size < Math.max(1, Number(n) || 0)) size *= 2;
    return size;
  }

  /** Размер сетки под число команд: 6 → 8, 12 → 16 */
  function sizeFor(teamCount) {
    return nextPow2(Math.max(2, Number(teamCount) || 0));
  }

  /** Сколько команд проходят первый раунд без игры */
  function byesFor(teamCount) {
    var count = Math.max(2, Number(teamCount) || 0);
    return sizeFor(count) - count;
  }

  /**
   * Порядок сеяных в первом раунде: 8 → [1,8,4,5,2,7,3,6].
   * Классическая схема: сильнейший играет со слабейшим, а 1 и 2
   * могут встретиться только в финале.
   */
  function seedingOrder(size) {
    var order = [1];
    while (order.length < size) {
      var round = order.length * 2;
      var next = [];
      for (var i = 0; i < order.length; i++) {
        next.push(order[i]);
        next.push(round + 1 - order[i]);
      }
      order = next;
    }
    return order;
  }

  /** Пары первого раунда: [[1,8],[4,5],[2,7],[3,6]] для size 8 */
  function seedPairs(size) {
    var order = seedingOrder(size);
    var pairs = [];
    for (var i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
    return pairs;
  }

  /**
   * Кто из команд попадает в каждый слот первого раунда, когда команд меньше
   * размера сетки.
   *
   * Раскладываем команды по позициям в порядке сеяных: 1-я команда встаёт в
   * первый слот порядка, 2-я — во второй и так далее. Последние (size − teamCount)
   * позиций остаются пустыми — это BYE, и они всегда достаются слотам, соседним
   * с сильнейшими. Для 6 команд в сетке на 8 порядок [1,8,4,5,2,7,3,6] даёт:
   *
   *   [[1,BYE],[4,5],[2,BYE],[3,6]]
   *
   * то есть без игры проходят 1 и 2, а играют 4–5 и 3–6. Пар из двух BYE не
   * бывает ни при каком размере: пустые позиции всегда предпоследняя и последняя.
   */
  function seedAssignment(teamCount) {
    var size = sizeFor(teamCount);
    var count = Math.max(2, Number(teamCount) || 0);
    var order = seedingOrder(size);        /* слот → номер сеяного */
    var position = {};                     /* номер сеяного → позиция в порядке */
    order.forEach(function (seedNumber, index) { position[seedNumber] = index + 1; });

    var map = {};                          /* номер сеяного → команда или null */
    var team = 1;
    order.forEach(function (seedNumber) {
      /* Первые (size − BYE) слотов заполняем по порядку, остальные — BYE */
      if (team <= count) {
        map[seedNumber] = team;
        team++;
      } else {
        map[seedNumber] = null;
      }
    });

    return { size: size, order: order, byes: Math.max(0, size - count), map: map, position: position };
  }

  /**
   * Автопроход по BYE. Матч первого раунда, где пришла одна команда (соперник —
   * пустой слот), не играется: команда сразу идёт дальше. Здесь мы проставляем
   * ей победу, а матчи, в которые некому прийти (обе ветки пустые), помечаем
   * idle — они держат структуру сетки, но счёт в них не вводят.
   *
   * Вызывается после сборки, поэтому просто идём по матчам по порядку id:
   * к моменту обработки матча все его источники уже разрешены.
   */
  function resolveByes(matches) {
    var byId = {};
    (matches || []).forEach(function (m) { byId[m.id] = m; });

    (matches || []).forEach(function (m) {
      if (m.idle) return;
      /* Матчи первого раунда уже расставлены по посеву — их не трогаем */
      if (!m.from1 && !m.from2) return;
      m.team1 = m.from1 ? fromSource(byId, m.from1) : m.team1;
      m.team2 = m.from2 ? fromSource(byId, m.from2) : m.team2;

      var filled = (m.team1 != null ? 1 : 0) + (m.team2 != null ? 1 : 0);
      if (filled === 0) { m.idle = true; return; }   /* сюда некому прийти */
      if (filled === 1 && !m.winner) {
        m.winner = m.team1 != null ? m.team1 : m.team2;
        m.bye = true;
      }
    });
    return matches;
  }

  /** Кто приходит в слот: победитель или проигравший указанного матча */
  function fromSource(byId, src) {
    var source = byId[src.m];
    if (!source) return null;
    if (src.as === 'l') {
      if (!source.winner || !source.team1 || !source.team2) return null;
      return source.winner === source.team1 ? source.team2 : source.team1;
    }
    return source.winner || null;
  }

  /** Номера сеяных, которые уходят в BYE (для подписей и проверок) */
  function byeSeeds(teamCount) {
    var a = seedAssignment(teamCount);
    return a.order.filter(function (seedNumber) { return a.map[seedNumber] === null; });
  }

  /* ==========================================================
     Генерация
     ========================================================== */

  /**
   * @param {{teamCount: number, format?: 'se'|'de', matchType?: 'Bo1'|'Bo3'|'Bo5',
   *          thirdPlace?: boolean, grandFinal?: 'simple'|'double'}} config
   */
  function generate(config) {
    var cfg = config || {};
    var teamCount = Math.max(2, Number(cfg.teamCount) || 0);
    var size = sizeFor(teamCount);
    var format = cfg.format === 'de' ? 'de' : 'se';
    var matchType = cfg.matchType || 'Bo3';

    var ctx = {
      size: size,
      teamCount: teamCount,
      matches: [],
      nextId: 1
    };

    var upper = buildUpperBracket(ctx);
    var lastUpper = upper[upper.length - 1];

    var result = {
      format: format,
      teamCount: teamCount,
      size: size,
      matchType: matchType,
      byes: byesFor(teamCount),
      rounds: { upper: upper.length, lower: 0 },
      grandFinal: null,
      thirdPlace: null,
      matches: ctx.matches,
      stageLabels: {}
    };

    if (format === 'se') {
      var finalMatch = lastUpper[0];
      finalMatch.bracket = 'grand';

      /* Матч за 3-е место — между проигравшими полуфиналов */
      if (cfg.thirdPlace && upper.length >= 2) {
        var semis = upper[upper.length - 2];
        if (semis.length === 2) {
          var third = addMatch(ctx, {
            round: upper.length,
            bracket: 'third',
            from1: { m: semis[0].id, as: 'l' },
            from2: { m: semis[1].id, as: 'l' }
          });
          result.thirdPlace = third.id;
        }
      }

      result.grandFinal = { ids: [finalMatch.id], rule: 'single' };
      /* Команды с BYE проходят первый раунд автоматически */
      resolveByes(result.matches);
      result.stageLabels = stageLabels(upper, result.matches, null, size);
      return result;
    }

    /* ---------- нижняя сетка + гранд-финал ---------- */
    var lower = buildLowerBracket(ctx, upper);
    result.rounds.lower = lower.length;

    var wbFinal = lastUpper[0];
    var lbFinal = lower.length ? lower[lower.length - 1][0] : null;

    var gf = addMatch(ctx, {
      round: upper.length + lower.length + 1,
      bracket: 'grand',
      from1: { m: wbFinal.id, as: 'w' },
      from2: lbFinal ? { m: lbFinal.id, as: 'w' } : null
    });

    var gfIds = [gf.id];
    var gfRule = cfg.grandFinal === 'double' ? 'double' : 'single';
    if (gfRule === 'double') {
      /* Сброс играется, только если первый гранд-финал выиграл выходец нижней сетки */
      var reset = addMatch(ctx, {
        round: gf.round + 1,
        bracket: 'grand',
        from1: { m: gf.id, as: 'w' },
        from2: { m: gf.id, as: 'l' },
        resetFor: gf.id
      });
      gfIds.push(reset.id);
    }

    result.grandFinal = { ids: gfIds, first: gf.id, rule: gfRule };
    /* Команды с BYE проходят первый раунд автоматически, «мёртвые» матчи — idle */
    resolveByes(result.matches);
    result.stageLabels = stageLabels(upper, result.matches, lower, size);
    result.matches = ctx.matches;
    return result;
  }

  /** Верхняя сетка: массив раундов, каждый — массив матчей */
  function buildUpperBracket(ctx) {
    var rounds = [];
    var size = ctx.size;
    var first = [];
    var pairs = seedPairs(size);
    /* Кто именно попадает в каждый сеяный слот (с BYE у слабейших сеяных) */
    var assignment = seedAssignment(ctx.teamCount);
    /* Для отладки и проверок: видно, что именно разложил движок */
    ctx.seedMap = assignment.map;
    ctx.seedPairs = pairs;

    for (var i = 0; i < pairs.length; i++) {
      var a = pairs[i][0];
      var b = pairs[i][1];
      first.push(addMatch(ctx, {
        round: 1,
        bracket: 'upper',
        seed1: a in assignment.map ? assignment.map[a] : null,
        seed2: b in assignment.map ? assignment.map[b] : null
      }));
    }
    rounds.push(first);

    /* Дальше пары собираются из победителей предыдущего раунда */
    var prev = first;
    var roundNumber = 2;
    while (prev.length > 1) {
      var next = [];
      for (var k = 0; k < prev.length; k += 2) {
        next.push(addMatch(ctx, {
          round: roundNumber,
          bracket: 'upper',
          from1: { m: prev[k].id, as: 'w' },
          from2: prev[k + 1] ? { m: prev[k + 1].id, as: 'w' } : null
        }));
      }
      rounds.push(next);
      prev = next;
      roundNumber++;
    }
    return rounds;
  }

  /**
   * Нижняя сетка. Считаем по номинальному размеру сетки (size), а не по числу
   * сыгранных матчей: иначе BYE в первом раунде ломают раунды ниже.
   *
   * Раунды идут парами:
   *   LB1: проигравшие WB1 между собой        — size/2 матчей
   *   LB2: победители LB1 против проигравших WB2 — size/2
   *   LB3: победители LB2 между собой          — size/4
   *   LB4: победители LB3 против проигравших WB3 — size/4 … и так до 1.
   * Итого 2·size − 4 матчей (для 8 команд — 6, для 16 — 14).
   *
   * Матч, в который некому прийти (соперник прошёл BYE), помечается idle:
   * он не играется и не требует счёта, но держит структуру.
   */
  function buildLowerBracket(ctx, upper) {
    var rounds = [];
    var roundNumber = 1;
    var size = ctx.size;

    /* LB1: проигравшие первого раунда верхней сетки между собой (size/4 матчей) */
    var first = upper[0] || [];
    var pool = [];
    var l1Count = Math.floor(size / 4);
    for (var i = 0; i < l1Count; i++) {
      var l1 = loserOf(first[i * 2], ctx);
      var l2 = loserOf(first[i * 2 + 1], ctx);
      pool.push(addMatch(ctx, {
        round: roundNumber,
        bracket: 'lower',
        from1: l1,
        from2: l2,
        idle: !l1 && !l2
      }));
    }
    if (pool.length) rounds.push(pool);
    roundNumber++;

    /* Классическая схема нижней сетки:
         • падение — победители нижней против проигравших очередного раунда WB;
         • слияние — победители нижней между собой.
       Слияние нужно, когда в нижней матчей стало больше, чем команд упадёт в
       следующий раз. Когда остаётся один победитель — играется финал нижней. */
    var nextRound = 1;                   /* следующий раунд верхней сетки для падения */
    var mergeNext = false;
    while (pool.length > 1) {
      /* Кто упадёт из верхней сетки: матч, где есть оба участника. Пары с BYE
         проигравшего не дают, а матчи следующих раундов ещё ждут победителей —
         у них team1/team2 пустые, но источники (from1/from2) уже заданы. */
      var contestants = (upper[nextRound] || []).filter(playable);
      var dropRound = nextRound;
      var made = [];

      if (!mergeNext && contestants.length && pool.length <= contestants.length) {
        /* Падение: победители нижней против проигравших раунда WB */
        for (var d = 0; d < pool.length; d++) {
          made.push(addMatch(ctx, {
            round: roundNumber,
            bracket: 'lower',
            from1: { m: pool[d].id, as: 'w' },
            from2: { m: contestants[d].id, as: 'l' }
          }));
        }
        nextRound = dropRound + 1;
        mergeNext = true;
      } else {
        /* Слияние */
        for (var m = 0; m + 1 < pool.length; m += 2) {
          made.push(addMatch(ctx, {
            round: roundNumber,
            bracket: 'lower',
            from1: { m: pool[m].id, as: 'w' },
            from2: { m: pool[m + 1].id, as: 'w' }
          }));
        }
        if (pool.length % 2 === 1) {
          made.push(addMatch(ctx, {
            round: roundNumber,
            bracket: 'lower',
            from1: { m: pool[pool.length - 1].id, as: 'w' },
            from2: null
          }));
        }
        mergeNext = false;
      }

      rounds.push(made);
      pool = made;
      roundNumber++;
    }

    /* Финальная часть: сокращаем нижнюю сетку до одного победителя, затем
       играем финал нижней против проигравшего финала верхней сетки. */
    var wbFinal = upper[upper.length - 1] || [];
    while (pool.length > 1) {
      var merge = [];
      for (var q = 0; q + 1 < pool.length; q += 2) {
        merge.push(addMatch(ctx, {
          round: roundNumber,
          bracket: 'lower',
          from1: { m: pool[q].id, as: 'w' },
          from2: { m: pool[q + 1].id, as: 'w' }
        }));
      }
      if (pool.length % 2 === 1) {
        merge.push(addMatch(ctx, {
          round: roundNumber,
          bracket: 'lower',
          from1: { m: pool[pool.length - 1].id, as: 'w' },
          from2: null
        }));
      }
      rounds.push(merge);
      pool = merge;
      roundNumber++;
    }

    if (pool.length === 1) {
      rounds.push([addMatch(ctx, {
        round: roundNumber,
        bracket: 'lower',
        from1: { m: pool[0].id, as: 'w' },
        from2: wbFinal[0] ? { m: wbFinal[0].id, as: 'l' } : null
      })]);
    }

    return rounds;
  }

  /** В матче есть оба участника: либо сеяные, либо оба источника из других матчей */
  function playable(match) {
    if (!match) return false;
    if (match.team1 !== null && match.team2 !== null) return true;
    return Boolean(match.from1 && match.from2);
  }

  /** Проигравший матча как источник слота; у BYE-пары проигравшего нет */
  function loserOf(match, ctx) {
    if (!match) return null;
    if (match.team1 === null || match.team2 === null) return null;
    return { m: match.id, as: 'l' };
  }

  /** Создаёт матч и кладёт его в общий список */
  function addMatch(ctx, spec) {
    var match = {
      id: ctx.nextId++,
      round: spec.round || 1,
      bracket: spec.bracket || 'upper',
      team1: spec.seed1 || null,
      team2: spec.seed2 || null,
      winner: null,
      score1: null,
      score2: null,
      vod: '',
      from1: spec.from1 || null,
      from2: spec.from2 || null
    };
    if (spec.resetFor) match.resetFor = spec.resetFor;
    if (spec.idle) match.idle = true;
    ctx.matches.push(match);
    return match;
  }

  /* ---------- подписи стадий ---------- */
  function stageLabels(upper, matches, lower, size) {
    var labels = {};
    var r, i;
    for (r = 0; r < upper.length; r++) {
      for (i = 0; i < upper[r].length; i++) labels[upper[r][i].id] = upperLabel(r + 1, upper.length, size);
    }
    if (lower) {
      for (r = 0; r < lower.length; r++) {
        for (i = 0; i < lower[r].length; i++) labels[lower[r][i].id] = lowerLabel(r + 1, lower.length, size);
      }
    }
    matches.forEach(function (m) {
      if (m.bracket === 'grand') labels[m.id] = m.resetFor ? 'Гранд-финал · сброс' : 'Гранд-финал';
      if (m.bracket === 'third') labels[m.id] = 'Матч за 3-е место';
    });
    return labels;
  }

  /**
   * Подпись раунда. Названия по «остатку» до финала понятны на любой сетке,
   * а ранние раунды называем по числу матчей в них: «1/4 финала», «1/8 финала».
   */
  function roundLabel(part, round, total, size) {
    var left = total - round;
    if (left === 0) return 'Финал ' + part;
    if (left === 1) return 'Полуфинал ' + part;
    if (left === 2) return 'Четвертьфинал ' + part;
    /* В раунде столько матчей, сколько участников делить на два */
    var inRound = Math.max(1, Math.round((size || Math.pow(2, total)) / Math.pow(2, round)));
    if (inRound >= 2) return '1/' + inRound + ' финала ' + part;
    return 'Раунд ' + round + ' ' + part;
  }

  function upperLabel(round, total, size) {
    return roundLabel('верхней', round, total, size);
  }

  function lowerLabel(round, total, size) {
    return roundLabel('нижней', round, total, size);
  }

  /**
   * Куда попадает победитель и проигравший каждого матча.
   * @returns {{[id: number]: {winnerTo: number|null, loserTo: number|null}}}
   */
  function destinations(matches) {
    var map = {};
    (matches || []).forEach(function (m) { map[m.id] = { winnerTo: null, loserTo: null }; });
    (matches || []).forEach(function (m) {
      [m.from1, m.from2].forEach(function (src) {
        if (!src || !map[src.m]) return;
        var key = src.as === 'l' ? 'loserTo' : 'winnerTo';
        if (!map[src.m][key]) map[src.m][key] = m.id;
      });
    });
    return map;
  }

  /** Короткая сводка: сколько матчей в каждой части сетки */
  function describe(matches) {
    var info = { total: 0, upper: 0, lower: 0, grand: 0, third: 0, idle: 0 };
    (matches || []).forEach(function (m) {
      info.total++;
      if (m.bracket === 'upper') info.upper++;
      else if (m.bracket === 'lower') info.lower++;
      else if (m.bracket === 'third') info.third++;
      else info.grand++;
      if (m.idle) info.idle++;
    });
    return info;
  }

  CA.bracketEngine = {
    VERSION: VERSION,
    nextPow2: nextPow2,
    sizeFor: sizeFor,
    byesFor: byesFor,
    seedingOrder: seedingOrder,
    seedPairs: seedPairs,
    seedAssignment: seedAssignment,
    byeSeeds: byeSeeds,
    generate: generate,
    destinations: destinations,
    describe: describe,
    upperLabel: upperLabel,
    lowerLabel: lowerLabel
  };
})(typeof window !== 'undefined' ? window : globalThis);
