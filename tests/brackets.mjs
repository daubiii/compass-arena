/* Универсальная сетка на клиенте: генерация через brackets-manager и рендер
   через brackets-viewer. Библиотеки подменяются заглушками — проверяем наш код
   (формат данных, параметры стадии, локаль, обязательный класс контейнера).
   Формат: node tests/brackets.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failed = 0;
const ok = (c, m, extra) => {
  if (!c) { failed++; console.error('✗', m, extra === undefined ? '' : extra); }
  else console.log('✓', m);
};

/* ---------- заглушки библиотеки ---------- */

function makeEnv() {
  const dom = new JSDOM('<!doctype html><html><body><div id="bracketViewer" class="brackets-viewer"></div></body></html>', {
    url: 'https://compassarena.ru/brackets.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const win = dom.window;

  const calls = { stage: null, render: null, images: null, locale: null };

  const participants = [
    { id: 0, name: 'Alpha', tournament_id: 1 },
    { id: 1, name: 'Bravo', tournament_id: 1 },
    { id: 2, name: 'Charlie', tournament_id: 1 }
  ];

  win.bracketsManager = {
    create: { stage: async (stage) => { calls.stage = stage; return { id: 0, name: stage.name, type: stage.type, settings: stage.settings }; } },
    get: { tournamentData: async () => ({ stage: [{ id: 0, name: 'S' }], match: [{ id: 0 }], match_game: [], participant: participants }) }
  };

  win.bracketsViewer = {
    addLocale(name, locale) { calls.locale = { name, locale }; },
    setParticipantImages(images) { calls.images = images; },
    async render(data, config) {
      calls.render = { data, config };
      const root = win.document.querySelector(config.selector);
      if (!root.classList.contains('brackets-viewer')) throw new Error('The selected root must have a .brackets-viewer class');
      if (config.clear !== true) throw new Error('ожидали clear: true');
      // имитируем DOM, который строит библиотека
      root.innerHTML = data.participants.map((p) =>
        '<div class="participant" data-participant-id="' + p.id + '" title="' + p.name + '"><div class="name">' + p.name + '</div></div>'
      ).join('');
    }
  };

  try {
    win.eval(read('assets/ca-brackets.js'));
  } catch (err) {
    console.error('не удалось выполнить ca-brackets.js в jsdom:', err && err.message);
    throw err;
  }
  if (!win.CA || !win.CA.brackets) throw new Error('CA.brackets не появился');
  return { win, calls, participants };
}

/* ---------- тесты ---------- */

/* 1. Размер сетки — степень двойки */
{
  const { win } = makeEnv();
  const B = win.CA.brackets;
  ok(B.nextPowerOfTwo(1) === 1 && B.nextPowerOfTwo(4) === 4, 'степень двойки для 1 и 4 команд');
  ok(B.nextPowerOfTwo(6) === 8 && B.nextPowerOfTwo(9) === 16, '6 команд → 8, 9 команд → 16', [B.nextPowerOfTwo(6), B.nextPowerOfTwo(9)].join());
  ok(B.gamesPerMatch('Bo1') === 0 && B.gamesPerMatch('Bo3') === 3 && B.gamesPerMatch('Bo5') === 5,
    'Bo1 — матч без дочерних игр, Bo3/Bo5 — 3 и 5 игр');
}

/* 2. Параметры стадии */
{
  const { win } = makeEnv();
  const B = win.CA.brackets;
  const teams = [{ name: 'Alpha', logo: 'data:image/png;base64,AAA' }, { name: 'Bravo' }, { name: 'Charlie' }, { name: 'Delta' }, { name: 'Echo' }, { name: 'Foxtrot' }];

  const se = B.buildStageInput({ name: 'CA', type: 'single_elimination', matchType: 'Bo3', thirdPlace: true, teams }, 7);
  ok(se.tournamentId === 7 && se.type === 'single_elimination', 'тип стадии и id турнира переданы');
  ok(se.settings.size === 8 && se.settings.matchesChildCount === 3, '6 команд → размер 8, Bo3 → 3 игры');
  ok(se.settings.consolationFinal === true && se.settings.grandFinal === undefined, 'матч за 3-е место только для single elimination');
  ok(se.seeding.length === 6 && se.seeding[0].name === 'Alpha' && se.seeding[0].logo === 'data:image/png;base64,AAA',
    'посев сохраняет порядок команд и логотип', JSON.stringify(se.seeding[0]));

  const de = B.buildStageInput({ name: 'CA', type: 'double_elimination', matchType: 'Bo5', grandFinal: 'double', teams }, 8);
  ok(de.settings.grandFinal === 'double' && de.settings.matchesChildCount === 5 && de.settings.consolationFinal === undefined,
    'double elimination: grandFinal и Bo5');

  const deDefault = B.buildStageInput({ name: 'CA', type: 'double_elimination', matchType: 'Bo1', teams }, 9);
  ok(deDefault.settings.grandFinal === 'simple' && deDefault.settings.matchesChildCount === 0,
    'без выбора — гранд-финал из одного матча и Bo1');
}

/* 3. Генерация и приведение данных к формату viewer */
{
  const { win, calls } = makeEnv();
  const B = win.CA.brackets;
  const view = await B.generate({ name: 'CA', type: 'single_elimination', matchType: 'Bo3', teams: [{ name: 'Alpha' }, { name: 'Bravo' }] }, 3);

  ok(calls.stage && calls.stage.tournamentId === 3, 'create.stage вызван с нашим турниром');
  ok(Array.isArray(view.stages) && Array.isArray(view.matches) && Array.isArray(view.matchGames) && Array.isArray(view.participants),
    'на выходе — camelCase-ключи stages/matches/matchGames/participants');
  ok(view.participants.length === 3 && view.stages[0].id === 0, 'участники и стадии на месте');

  const raw = { stage: [{ id: 1 }], match: [{ id: 2 }], match_game: [{ id: 3 }], participant: [{ id: 4 }] };
  const converted = B.toViewerData(raw);
  ok(converted.stages[0].id === 1 && converted.matches[0].id === 2 && converted.matchGames[0].id === 3 && converted.participants[0].id === 4,
    'snake_case из get.tournamentData раскладывается в camelCase');
}

/* 4. Рендер: класс контейнера обязателен, локаль и логотипы передаются */
{
  const { win, calls } = makeEnv();
  const B = win.CA.brackets;
  const data = {
    stages: [{ id: 0, name: 'S', type: 'single_elimination' }],
    matches: [{ id: 0, stage_id: 0, opponent1: { id: 0 }, opponent2: { id: 1 } }],
    matchGames: [],
    participants: [{ id: 0, name: 'Alpha' }, { id: 1, name: 'Bravo' }]
  };

  const rendered = await B.render('#bracketViewer', data, {
    meta: { teams: [{ name: 'Alpha', logo: '/img/a.png' }] },
    onMatchClick: () => {}
  });

  ok(calls.render && calls.render.config.selector === '#bracketViewer', 'render вызван с нашим селектором');
  ok(calls.render.config.clear === true, 'clear: true — повторный рендер не наслаивается');
  ok(calls.render.config.customRoundName === B.roundName || typeof calls.render.config.customRoundName === 'function',
    'подписи раундов переведены на русский');
  ok(calls.locale && calls.locale.name === 'ru' && calls.locale.locale.common.bye === 'ПРОПУСК', 'русская локаль добавлена');
  ok(Array.isArray(calls.images) && calls.images[0].participantId === 0 && calls.images[0].imageUrl === '/img/a.png',
    'логотип команды ушёл в setParticipantImages', JSON.stringify(calls.images));
  ok(rendered.matches.length === 1, 'render возвращает приведённые данные');

  // пустые данные — понятная ошибка, а не падение в библиотеке
  let err = null;
  try { await B.render('#bracketViewer', { stages: [], matches: [], participants: [] }); } catch (e) { err = e; }
  ok(err && /нет стадий или матчей/.test(err.message), 'пустая сетка даёт понятную ошибку', err && err.message);

  let missing = null;
  try { await B.render('#nope', data); } catch (e) { missing = e; }
  ok(missing && /нет контейнера/.test(missing.message), 'без контейнера — понятная ошибка');
}

/* 5. Подписи раундов */
{
  const { win } = makeEnv();
  const R = win.CA.brackets.roundName;
  ok(R({ groupType: 'single-bracket', fractionOfFinal: 1 }) === 'Финал', 'финал single elimination');
  ok(R({ groupType: 'winner-bracket', fractionOfFinal: 0.5 }) === 'Верхняя · Полуфинал', 'полуфинал верхней сетки');
  ok(R({ groupType: 'loser-bracket', fractionOfFinal: 1 }) === 'Финал нижней', 'финал нижней сетки');
  ok(R({ groupType: 'winner-bracket', fractionOfFinal: 0.25 }) === 'Верхняя · Четвертьфинал', 'четвертьфинал верхней сетки');
  ok(R({ groupType: 'single-bracket', fractionOfFinal: 0.125 }) === undefined, 'остальные раунды остаются дефолтными');
}

console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nвсе проверки пройдены');
process.exit(failed ? 1 : 0);
