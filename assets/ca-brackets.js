/* ============================================================
   Универсальная сетка: генерация (brackets-manager) и рендер
   (brackets-viewer).
   ------------------------------------------------------------
   Библиотека подключается одним файлом: dist-сборка brackets-viewer
   создаёт сразу три глобальных объекта —
     window.bracketsViewer   — рендер,
     window.bracketsManager  — генератор (уже соединён с in-memory БД),
     window.inMemoryDatabase — хранилище в памяти.
   Отдельный brackets-manager не нужен, поэтому и бандлить нечего.

   Файлы лежат локально (/vendor/...): CDN в РФ может не ответить,
   а размер статики Cloudflare Pages не ограничен. Если локальной
   копии нет — подхватываем jsDelivr.

   Экспорт: CA.brackets
     ensureLibrary()      — гарантирует загрузку библиотеки
     nextPowerOfTwo(n)    — размер сетки под число команд
     buildStageInput()    — параметры create.stage() из формы
     generate()           — собрать структуру сетки по списку команд
     toViewerData(data)   — привести данные manager к формату viewer
     render(container, data, opts) — нарисовать сетку
     ruLocale()           — русские подписи
   ============================================================ */
(function () {
  'use strict';

  var global = typeof window !== 'undefined' ? window : globalThis;
  var CA = global.CA || (global.CA = {});

  var LOCAL_JS = '/vendor/brackets-viewer.min.js';
  var LOCAL_CSS = '/vendor/brackets-viewer.min.css';
  var CDN_JS = 'https://cdn.jsdelivr.net/npm/brackets-viewer@1.9.1/dist/brackets-viewer.min.js';
  var CDN_CSS = 'https://cdn.jsdelivr.net/npm/brackets-viewer@1.9.1/dist/brackets-viewer.min.css';

  var libPromise = null;

  /* ---------- загрузка библиотеки ---------- */

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = src;
      tag.async = true;
      tag.onload = function () { resolve(src); };
      tag.onerror = function () { reject(new Error('не загрузился ' + src)); };
      document.head.appendChild(tag);
    });
  }

  function loadStyle(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    var tag = document.createElement('link');
    tag.rel = 'stylesheet';
    tag.href = href;
    document.head.appendChild(tag);
  }

  /** Гарантирует, что window.bracketsViewer и bracketsManager доступны */
  function ensureLibrary() {
    if (libPromise) return libPromise;
    libPromise = (function () {
      if (global.bracketsViewer && global.bracketsManager) {
        loadStyle(LOCAL_CSS);
        return Promise.resolve('готово');
      }
      loadStyle(LOCAL_CSS);
      return loadScript(LOCAL_JS).catch(function () {
        console.warn('[CA.brackets] локальная копия недоступна, пробуем CDN');
        return loadScript(CDN_JS);
      }).then(function () {
        if (!global.bracketsViewer || !global.bracketsManager) {
          throw new Error('библиотека сетки не инициализировалась');
        }
        return 'загружено';
      });
    })();
    return libPromise;
  }

  /* ---------- расчёты и генерация ---------- */

  /** Размер сетки обязан быть степенью двойки: 6 команд → 8 (два BYE) */
  function nextPowerOfTwo(count) {
    var size = 1;
    while (size < Math.max(1, Number(count) || 0)) size *= 2;
    return size;
  }

  /** 'Bo3' → 3 (сколько игр внутри матча); 'Bo1' → 0 (матч без дочерних игр) */
  function gamesPerMatch(matchType) {
    var n = parseInt(String(matchType || '').replace(/[^0-9]/g, ''), 10);
    if (!n || n <= 1) return 0;
    return Math.min(n, 9);
  }

  /**
   * Параметры для manager.create.stage().
   * @param {{name: string, type: string, matchType: string, thirdPlace?: boolean,
   *          grandFinal?: string, teams: Array<{name: string, logo?: string}>}} form
   * @param {number} tournamentId
   */
  function buildStageInput(form, tournamentId) {
    var teams = form.teams || [];
    var size = nextPowerOfTwo(teams.length);
    var settings = {
      size: size,
      seedOrdering: ['inner_outer'],
      balanceByes: true,
      matchesChildCount: gamesPerMatch(form.matchType)
    };
    if (form.type === 'double_elimination') {
      settings.grandFinal = form.grandFinal === 'double' ? 'double' : 'simple';
    } else if (form.thirdPlace === true) {
      settings.consolationFinal = true;
    }

    return {
      name: form.name || 'Compass Arena',
      tournamentId: Number(tournamentId) || 1,
      type: form.type === 'double_elimination' ? 'double_elimination' : 'single_elimination',
      // Логотип протаскиваем прямо в участника: лишние поля библиотека сохраняет
      seeding: teams.map(function (team) {
        var item = { name: String(team.name || '').trim() || 'Команда' };
        if (team.logo) item.logo = team.logo;
        return item;
      }),
      settings: settings
    };
  }

  /**
   * Генерирует сетку и возвращает её структуру в формате viewer.
   * @returns {Promise<{stages, matches, matchGames, participants, stage}>}
   */
  async function generate(form, tournamentId) {
    await ensureLibrary();
    var manager = global.bracketsManager;
    var input = buildStageInput(form, tournamentId);
    var stage = await manager.create.stage(input);
    var data = await manager.get.tournamentData(input.tournamentId);
    return toViewerData(data, stage);
  }

  /** get.tournamentData() отдаёт ключи в snake_case — раскладываем как ждёт viewer */
  function toViewerData(data, stage) {
    var stages = data.stage || data.stages || [];
    if (stage && !stages.some(function (s) { return s.id === stage.id; })) stages = stages.concat([stage]);
    return {
      stages: stages,
      matches: data.match || data.matches || [],
      matchGames: data.match_game || data.matchGames || [],
      participants: data.participant || data.participants || [],
      stage: stage || stages[0] || null
    };
  }

  /* ---------- русские подписи ---------- */

  function ruLocale() {
    return {
      common: {
        'round-name': 'Раунд {{roundNumber}}',
        'round-name-final': 'Финал',
        bye: 'ПРОПУСК',
        'best-of-x': 'до {{x}}'
      },
      'match-status': {
        locked: 'Заблокирован',
        waiting: 'Ожидание',
        ready: 'Готов',
        running: 'Идёт',
        completed: 'Завершён',
        archived: 'Архив'
      },
      abbreviations: {
        win: 'В',
        loss: 'П',
        forfeit: 'Н',
        position: 'П',
        seed: '#',
        'winner-bracket': 'ВС',
        'loser-bracket': 'НС',
        match: 'М',
        'grand-final': 'ГФ'
      }
    };
  }

  /** Подписи раундов: финал, полуфинал, финал нижней сетки и т.д. */
  function roundName(info) {
    var group = info.groupType;
    var prefix = group === 'winner-bracket' ? 'Верхняя · ' : (group === 'loser-bracket' ? 'Нижняя · ' : '');
    if (info.fractionOfFinal === 1) return group === 'loser-bracket' ? 'Финал нижней' : 'Финал';
    if (info.fractionOfFinal === 0.5) return prefix + 'Полуфинал';
    if (info.fractionOfFinal === 0.25) return prefix + 'Четвертьфинал';
    return undefined;
  }

  /* ---------- рендер ---------- */

  /**
   * Рисует сетку в контейнер (у него обязан быть класс brackets-viewer).
   * @param {Element|string} root
   * @param {object} data — результат generate() или brackets_data из KV
   * @param {{meta?: object, onMatchClick?: Function}} [opts]
   */
  async function render(root, data, opts) {
    opts = opts || {};
    var el = typeof root === 'string' ? document.querySelector(root) : root;
    if (!el) throw new Error('нет контейнера для сетки');
    await ensureLibrary();

    // Аргумент render() ждёт camelCase-ключи, а из KV приходит структура manager
    var view = toViewerData(data);

    if (!view.stages.length || !view.matches.length) {
      throw new Error('в данных сетки нет стадий или матчей');
    }

    var viewer = global.bracketsViewer;

    // Логотипы: и из метаданных (по имени команды), и из полей участника
    var meta = opts.meta || {};
    var logoByName = {};
    (meta.teams || []).forEach(function (team) {
      if (team && team.name && team.logo) logoByName[team.name] = team.logo;
    });
    var images = [];
    view.participants.forEach(function (p) {
      var url = p.logo || logoByName[p.name];
      if (url) images.push({ participantId: p.id, imageUrl: url });
    });
    if (images.length && typeof viewer.setParticipantImages === 'function') {
      viewer.setParticipantImages(images);
    }

    // Язык: библиотека берёт его из localStorage, а не из config
    try {
      if (typeof viewer.addLocale === 'function') viewer.addLocale('ru', ruLocale());
      var lang = (global.navigator && String(global.navigator.language || '')).toLowerCase().indexOf('ru') === 0 ? 'ru' : 'en';
      if (global.localStorage) global.localStorage.setItem('i18nextLng', lang);
    } catch (err) {
      console.warn('[CA.brackets] локаль не применилась:', err && err.message);
    }

    await viewer.render(view, {
      selector: '#' + el.id,
      clear: true,
      showSlotsOrigin: true,
      showLowerBracketSlotsOrigin: true,
      highlightParticipantOnHover: true,
      separatedChildCountLabel: true,
      participantOriginPlacement: 'before',
      customRoundName: roundName,
      onMatchClick: opts.onMatchClick || undefined
    });

    return view;
  }

  CA.brackets = {
    ensureLibrary: ensureLibrary,
    nextPowerOfTwo: nextPowerOfTwo,
    gamesPerMatch: gamesPerMatch,
    buildStageInput: buildStageInput,
    generate: generate,
    toViewerData: toViewerData,
    render: render,
    roundName: roundName,
    ruLocale: ruLocale,
    LOCAL_JS: LOCAL_JS,
    CDN_JS: CDN_JS
  };
})();
