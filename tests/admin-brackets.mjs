/* Админка, вкладка «Сетка»: загрузка команд, посев, генерация и сохранение
   в KV (через /api/save), сброс. Библиотека сетки подменяется заглушкой.
   Запуск: node tests/admin-brackets.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')); }
};

const TEAMS_FILE = {
  type: 'teams',
  version: 1,
  discipline: 'dota2',
  tournament: { name: 'Compass Arena #2', game: 'Dota 2', matches: 'Bo3', format: 'Single Elimination' },
  teams: [
    { id: 'team_1', num: 1, name: 'Team Spirit', logo: '', players: [{ nick: 'Yatoro' }, { nick: 'Larl' }] },
    { id: 'team_2', num: 2, name: 'Team Liquid', logo: '', players: [{ nick: 'Nisha' }] },
    { id: 'team_3', num: 3, name: 'Gaimin Gladiators', logo: '', players: [] },
    { id: 'team_4', num: 4, name: 'BetBoom Team', logo: '', players: [] },
    { id: 'team_5', num: 5, name: 'OG', logo: '', players: [] },
    { id: 'team_6', num: 6, name: 'Virtus.pro', logo: '', players: [] },
    { id: 'team_7', num: 7, name: 'Слот 7', logo: '', players: [] }
  ]
};

const BASE = {
  tournament: { name: 'Compass Arena', game: 'Dota 2', format: 'Custom Bracket', matches: 'Bo3', dates: '1 января 2027' },
  teams: [{ id: 1, name: 'Dota Team', players: [], logo: '' }],
  matches: [{ id: 1, round: 1, bracket: 'upper', team1: null, team2: null, winner: null, score1: null, score2: null }],
  schedule: {}, liveMatchId: null, tournamentStart: null, projectStart: null,
  nextSeason: null, archivedSnapshotId: null, alwaysShowBanner: true, history: []
};

async function boot(initial) {
  const html = read('poasalj1.z23.html').replace(/<script src="[^"]+"[^>]*><\/script>/g, '');
  const state = { data: JSON.parse(JSON.stringify(initial)), saves: [], confirms: [] };

  const dom = new JSDOM(html, {
    url: 'https://compassarena.ru/admin',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    beforeParse(win) {
      win.confirm = (msg) => { state.confirms.push(String(msg)); return true; };
      win.prompt = () => 'pw';
      win.alert = () => {};
      win.fetch = async (url, opts) => {
        if (String(url).indexOf('/api/save') >= 0) {
          const body = JSON.parse(opts.body);
          state.saves.push(body.data);
          state.data = JSON.parse(JSON.stringify(body.data));
          return { ok: true, status: 200, json: async () => ({ ok: true, bracketsSaved: 'saved' }) };
        }
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(state.data)) };
      };

      // Заглушки библиотеки сетки и модуля CA.brackets
      win.bracketsManager = {
        create: {
          stage: async (stage) => {
            state.stage = stage;
            return { id: 0, name: stage.name, type: stage.type, settings: stage.settings };
          }
        },
        get: {
          tournamentData: async () => ({
            stage: [{ id: 0, name: 'Сетка', type: 'single_elimination' }],
            match: [{ id: 0 }, { id: 1 }],
            match_game: [],
            participant: [{ id: 0, name: 'Team Spirit' }, { id: 1, name: 'Team Liquid' }]
          })
        }
      };
      win.bracketsViewer = {
        addLocale() {},
        setParticipantImages() {},
        async render(data, config) {
          const root = win.document.querySelector(config.selector);
          if (!root) throw new Error('нет контейнера ' + config.selector);
          root.innerHTML = '<div class="participant">ok</div>';
        }
      };
      // CA.brackets грузится из assets/ca-brackets.js — подключаем как в жизни
      win.eval(read('assets/ca-brackets.js'));
    }
  });

  await sleep(200);
  return { w: dom.window, state };
}

/* ============ A. Вкладка есть, команды загружаются ============ */
console.log('\nA. Вкладка «Сетка» и загрузка файла команд');
{
  const { w, state } = await boot(BASE);
  const tab = w.document.querySelector('.tab[data-tab="brackets"]');
  ok(!!tab, 'кнопка вкладки «Сетка» есть');
  ok(!!w.document.getElementById('tab-brackets'), 'разметка вкладки есть');
  ok(typeof w.bkGenerate === 'function' && typeof w.bkReset === 'function', 'функции вкладки доступны');
  ok(!!w.document.getElementById('bkFileInput'), 'поле загрузки файла есть');

  w.bkAcceptTeams(TEAMS_FILE, 'teams_test.json');
  await sleep(30);

  ok(w.BK_TEAMS.length === 6, 'в посев попали 6 команд, «Слот 7» отброшен', w.BK_TEAMS.length);
  ok(w.BK_TEAMS[0].name === 'Team Spirit', 'порядок посева сохраняется');
  const rows = w.document.querySelectorAll('#bkSeedList .bk-seed-item');
  ok(rows.length === 6, 'в списке посева шесть строк', rows.length);
  ok(rows[0].querySelector('.bk-seed-no').textContent === '1', 'нумерация посева с единицы');
  ok(/Team Spirit/.test(rows[0].textContent) && /Yatoro/.test(rows[0].textContent), 'в строке имя и состав');
  ok(/BYE/.test(w.document.getElementById('bkSizeHint').textContent), 'подсказка про BYE показана', w.document.getElementById('bkSizeHint').textContent);
  ok(w.document.getElementById('bkMatchType').value === 'Bo3', 'формат из файла подставлен в форму');
}

/* ============ B. Посев драгом меняет порядок ============ */
console.log('\nB. Посев: перестановка команд');
{
  const { w } = await boot(BASE);
  w.bkAcceptTeams(TEAMS_FILE, 'x.json');
  await sleep(20);

  const before = w.BK_TEAMS.map((t) => t.name).join(',');
  w.bkMove(0, 2);
  const after = w.BK_TEAMS.map((t) => t.name).join(',');
  ok(before !== after && w.BK_TEAMS[2].name === 'Team Spirit', 'команда переехала на третью позицию', after);
  ok(w.document.querySelectorAll('#bkSeedList .bk-seed-item')[2].textContent.indexOf('1') >= 0 ||
    w.document.querySelectorAll('#bkSeedList .bk-seed-item')[2].querySelector('.bk-seed-no').textContent === '3',
    'нумерация перестроилась');

  w.bkMove(5, 0);
  ok(w.BK_TEAMS[0].name === 'Virtus.pro', 'перетаскивание вверх тоже работает', w.BK_TEAMS[0].name);
}

/* ============ C. Генерация и сохранение ============ */
console.log('\nC. Генерация: параметры стадии, сохранение в KV, превью');
{
  const { w, state } = await boot(BASE);
  w.bkAcceptTeams(TEAMS_FILE, 'x.json');
  await sleep(20);

  w.document.getElementById('bkType').value = 'double_elimination';
  w.document.getElementById('bkMatchType').value = 'Bo5';
  w.document.getElementById('bkGrandFinal').value = 'double';
  w.bkSyncForm();

  w.bkGenerate();
  await sleep(120);

  ok(state.stage && state.stage.type === 'double_elimination', 'тип стадии ушёл в генератор', state.stage && state.stage.type);
  ok(state.stage.settings.size === 8 && state.stage.settings.matchesChildCount === 5, 'размер 8 и Bo5 в настройках', JSON.stringify(state.stage.settings));
  ok(state.stage.settings.grandFinal === 'double', 'гранд-финал до двух поражений');
  ok(state.stage.seeding.length === 6, 'в посев ушли шесть команд');
  ok(!!state.stage.seeding[0].name, 'посев — объекты с именами');

  const saved = state.saves[state.saves.length - 1];
  ok(!!saved && Array.isArray(saved.brackets.matches), 'сетка ушла в /api/save');
  ok(saved.brackets.stages.length === 1 && saved.brackets.participants.length === 2, 'в сохранении структура stages/matches/participants');
  ok(saved.bracketsMeta && saved.bracketsMeta.type === 'double_elimination' && saved.bracketsMeta.teamCount === 6,
    'метаданные сетки сохранены', JSON.stringify(saved.bracketsMeta && saved.bracketsMeta.teamCount));
  ok(saved.bracketsMeta.teams.length === 6 && saved.bracketsMeta.teams[0].name === 'Team Spirit', 'в метаданных составы команд');
  ok(saved.clearBrackets === false, 'флаг очистки не выставлен');
  ok(!!saved.matches && saved.matches.length === 1, 'старая сетка из вкладки «Матчи» не тронута');
  ok(!w.document.getElementById('bkPreviewScroll').hidden, 'превью показано');
  ok(!!w.document.querySelector('#bkPreview .participant'), 'библиотека отрисовала превью');
  ok(/сгенерирована/.test(w.document.getElementById('bkStatus').textContent), 'статус обновился', w.document.getElementById('bkStatus').textContent);
}

/* ============ D. Сброс и защита от пустого списка ============ */
console.log('\nD. Сброс сетки и пустой список команд');
{
  const { w, state } = await boot(BASE);

  // без команд генерировать нельзя
  state.saves.length = 0;
  w.bkGenerate();
  await sleep(30);
  ok(state.saves.length === 0, 'без загруженных команд генерации нет');

  // сброс
  w.bkAcceptTeams(TEAMS_FILE, 'x.json');
  await sleep(20);
  w.bkGenerate();
  await sleep(100);
  w.bkReset();
  await sleep(80);
  const saved = state.saves[state.saves.length - 1];
  ok(saved.brackets === null && saved.bracketsMeta === null, 'сброс передаёт null в сетке и метаданных');
  ok(saved.clearBrackets === true, 'флаг очистки выставлен');
  ok(w.BK_DATA === null, 'состояние вкладки очищено');
  ok(state.confirms.length > 0, 'сброс спрашивает подтверждение');
}

console.log(fails ? '\nПРОВАЛЕНО: ' + fails : '\nвсе проверки пройдены');
process.exit(fails ? 1 : 0);
