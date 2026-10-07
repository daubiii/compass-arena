/* Регрессия админки: импорт файлов от бота (вкладка «📥 Импорт из бота»).
   Проверяем разбор и валидацию файлов, предупреждения перед разрушением,
   полную замену команд со сбросом сетки, свободных агентов и файл настроек.

   Запуск: node tests/admin-import.mjs (нужен jsdom: npm install) */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')); }
}

/* ============================================================
   Фикстуры
   ============================================================ */
const DOTA_PLAYERS = [
  { nick: 'Yatoro', role: 1, roleLabel: 'Керри' },
  { nick: 'Larl', role: 2, roleLabel: 'Мидер' },
  { nick: 'Collapse', role: 3, roleLabel: 'Офлейн' },
  { nick: 'Mira', role: 4, roleLabel: 'Саппорт 4' },
  { nick: 'Miposhka', role: 5, roleLabel: 'Саппорт 5' }
];

function botTeam(name, opts) {
  const o = opts || {};
  return {
    id: o.id || 'team_1',
    num: o.num || 1,
    name: name,
    logo: o.logo || '',
    logoOversized: !!o.oversized,
    captainNick: '@cap',
    captainTelegramId: 100,
    players: o.players || DOTA_PLAYERS
  };
}
function teamsDoc(teams, agents, discipline) {
  const doc = {
    type: 'teams',
    version: 1,
    exportedAt: '2026-10-07T15:30:00.000Z',
    discipline: discipline || 'dota2',
    teams: teams
  };
  if (agents !== undefined) doc.freeAgents = agents;
  return doc;
}
function settingsDoc(over) {
  const t = Object.assign({
    name: 'Compass Arena Season 3',
    game: 'CS:GO',
    format: 'Custom Bracket',
    matches: 'Bo5',
    dates: '1 ноября 2026'
  }, over || {});
  return { type: 'settings', version: 1, exportedAt: '2026-10-07T15:30:00.000Z', discipline: 'csgo', tournament: t, bracket: { size: 8, structure: 'custom', notes: '' } };
}
const AGENT = (nick, type) => ({
  nick: nick, role: 2, roleLabel: 'AWPer', rank: 'Premier 21 000', note: 'играю вечером',
  telegramId: 555, type: type || 'looking_for_team'
});

function initialData(over) {
  const o = over || {};
  return {
    tournament: { name: 'Compass Arena', game: 'Dota 2', format: 'Custom Bracket', matches: 'Bo3', dates: '26 сентября 2026' },
    teams: [
      { id: 1, name: 'Старая 1', logo: '', players: [] },
      { id: 2, name: 'Старая 2', logo: '', players: [] }
    ],
    matches: [
      { id: 1, round: 1, team1: 1, team2: 2, winner: o.finished ? 1 : null, bracket: 'upper', score1: o.finished ? 2 : null, score2: o.finished ? 0 : null, vod: '' },
      { id: 2, round: 1, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null, vod: '' },
      { id: 3, round: 1, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null, vod: '' },
      { id: 4, round: 2, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null, vod: '' },
      { id: 5, round: 3, team1: null, team2: null, winner: null, bracket: 'grand', score1: null, score2: null, vod: '' }
    ],
    schedule: { 1: '2026-09-26T12:00', 2: '2026-09-26T15:00' },
    liveMatchId: 1,
    freeAgents: o.freeAgents || [],
    tournamentStart: '2026-09-26T12:00:00+03:00',
    projectStart: '2026-01-01T00:00:00+03:00',
    nextSeason: null,
    archivedSnapshotId: null,
    alwaysShowBracketBanner: true,
    history: []
  };
}

/* ============================================================
   Запуск админки в jsdom
   ============================================================ */
async function boot(initial) {
  const state = {
    data: JSON.parse(JSON.stringify(initial)),
    saves: [],
    confirms: [],
    answer: true
  };

  const html = read('poasalj1.z23.html').replace(/<script src="[^"]+"[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'https://compassarena.ru/admin',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    beforeParse(win) {
      win.confirm = (msg) => { state.confirms.push(String(msg)); return state.answer; };
      win.prompt = () => 'pw';
      win.fetch = async (url, opts) => {
        if (String(url).indexOf('/api/save') >= 0) {
          const body = JSON.parse(opts.body);
          state.saves.push(body.data);
          state.data = JSON.parse(JSON.stringify(body.data));
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(state.data)) };
      };
    }
  });
  const w = dom.window;
  await sleep(150);
  return { w, state };
}

/* Подделка FileReader + выбор файла через настоящий обработчик вкладки */
function stubReader(w, content) {
  w.FileReader = function FakeReader() {
    const self = this;
    this.readAsText = function () {
      setTimeout(function () { if (self.onload) self.onload({ target: { result: content } }); }, 0);
    };
  };
}
async function chooseFile(w, content, name) {
  stubReader(w, content);
  w.onBotFileChosen({ target: { files: [{ name: name || 'teams_2026-10-07_dota2.json' }], value: 'x' } });
  await sleep(30);
}

const el = (w, id) => w.document.getElementById(id);
const textOf = (w, id) => (el(w, id) ? el(w, id).textContent || '' : '');
const statusText = (w) => textOf(w, 'botImportStatus');
const modalOpen = (w) => !!el(w, 'botModal') && el(w, 'botModal').classList.contains('active');
const modalTitle = (w) => textOf(w, 'botModalTitle');
const modalBody = (w) => textOf(w, 'botModalBody');
const modalButtons = (w) => Array.from(w.document.querySelectorAll('#botModalActions button')).map((b) => b.textContent.trim());
function clickModal(w, needle) {
  const btn = Array.from(w.document.querySelectorAll('#botModalActions button'))
    .find((b) => b.textContent.indexOf(needle) >= 0);
  if (!btn) return false;
  btn.click();
  return true;
}
const lastSave = (state) => (state.saves.length ? state.saves[state.saves.length - 1] : null);

/* ============================================================
   1. Вкладки
   ============================================================ */
console.log('\n1. Вкладки админки');
{
  const { w } = await boot(initialData());
  const tabs = Array.from(w.document.querySelectorAll('.tab')).map((t) => t.dataset.tab);
  ok(tabs.indexOf('import') >= 0, 'есть вкладка «Импорт из бота»', tabs.join(','));
  ok(tabs.indexOf('agents') >= 0, 'есть вкладка «Свободные агенты»');
  ok(!!el(w, 'tab-import') && !!el(w, 'tab-agents'), 'у вкладок есть свои блоки контента');
  ok(!!el(w, 'botFileInput'), 'на вкладке импорта есть выбор файла');

  w.switchTab('agents');
  await sleep(20);
  ok(el(w, 'tab-agents').classList.contains('active'), 'переключение на агентов работает');
  ok(/агент/i.test(textOf(w, 'agentsCount')), 'счётчик агентов на месте', textOf(w, 'agentsCount'));
  ok(/Свободных агентов пока нет/.test(textOf(w, 'agentList')), 'пустой список агентов объясняет, что делать');
}

/* ============================================================
   2. Ошибки файла
   ============================================================ */
console.log('\n2. Битые и чужие файлы');
{
  const { w, state } = await boot(initialData());
  const teamsBefore = JSON.stringify(w.DATA.teams);

  await chooseFile(w, '{ это не json');
  ok(/Файл повреждён/.test(statusText(w)), 'битый JSON → «Файл повреждён»', statusText(w).slice(0, 60));
  ok(!modalOpen(w), 'модалка не открывается на битом файле');

  await chooseFile(w, JSON.stringify({ version: 1, teams: [] }), 'x.json');
  ok(/Это не файл от бота/.test(statusText(w)), 'без поля type → «Это не файл от бота»', statusText(w).slice(0, 60));

  await chooseFile(w, JSON.stringify({ type: 'teams', version: 2, teams: [] }), 'x.json');
  ok(/Файл из будущей версии/.test(statusText(w)), 'version 2 → «Файл из будущей версии»', statusText(w).slice(0, 60));

  await chooseFile(w, JSON.stringify({ type: 'standings', version: 1 }), 'x.json');
  ok(/неизвестный type/i.test(statusText(w)), 'неизвестный type → понятная ошибка', statusText(w).slice(0, 70));

  await chooseFile(w, '[]');
  ok(/Это не файл от бота/.test(statusText(w)), 'массив вместо объекта → «Это не файл от бота»');

  ok(JSON.stringify(w.DATA.teams) === teamsBefore, 'команды не тронуты после ошибок');
  ok(state.saves.length === 0, 'ничего не сохранялось');
}

/* ============================================================
   3. Валидация содержимого
   ============================================================ */
console.log('\n3. Проверка содержимого файла команд');
{
  const { w, state } = await boot(initialData());

  const fourPlayers = [botTeam('Мало игроков', { players: DOTA_PLAYERS.slice(0, 4) })];
  await chooseFile(w, JSON.stringify(teamsDoc(fourPlayers, [])));
  ok(/4 игрока вместо 5/.test(statusText(w)), 'команда с 4 игроками → «4 игрока вместо 5»', statusText(w).slice(0, 120));
  ok(/Мало игроков/.test(statusText(w)), 'в ошибке указано название команды');
  ok(!modalOpen(w), 'импорт с ошибкой не открывает подтверждение');

  const badNick = [botTeam('Плохой ник', { players: [{ nick: 'X', role: 1 }, { nick: 'Larl', role: 2 }, { nick: 'Collapse', role: 3 }, { nick: 'Mira', role: 4 }, { nick: 'Miposhka', role: 5 }] })];
  await chooseFile(w, JSON.stringify(teamsDoc(badNick, [])));
  ok(/ник должен быть от 2 до 30 символов/.test(statusText(w)), 'короткий ник → ошибка с пояснением', statusText(w).slice(0, 140));

  const badRole = [botTeam('Плохая роль', { players: [{ nick: 'Yatoro', role: 7 }, { nick: 'Larl', role: 2 }, { nick: 'Collapse', role: 3 }, { nick: 'Mira', role: 4 }, { nick: 'Miposhka', role: 5 }] })];
  await chooseFile(w, JSON.stringify(teamsDoc(badRole, [])));
  ok(/роль "7" не подходит для Dota 2/.test(statusText(w)), 'недопустимая роль → ошибка с дисциплиной', statusText(w).slice(0, 140));

  const csRoles = [botTeam('Тест CS', {
    players: [{ nick: 's1mple', role: 7 }, { nick: 'b1t', role: 2 }, { nick: 'electroNic', role: 3 }, { nick: 'Perfecto', role: 4 }, { nick: 'Boombl4', role: 5 }]
  })];
  await chooseFile(w, JSON.stringify(teamsDoc(csRoles, [], 'csgo')));
  ok(/не подходит для CS:GO/.test(statusText(w)), 'ошибка роли называет CS:GO', statusText(w).slice(0, 140));

  await chooseFile(w, JSON.stringify({ type: 'teams', version: 1, discipline: 'dota2' }));
  ok(/Нет списка команд/.test(statusText(w)), 'без массива teams → понятная ошибка', statusText(w).slice(0, 80));

  ok(state.saves.length === 0, 'при ошибках ничего не сохранялось');
}

/* ============================================================
   4. Полный импорт команд
   ============================================================ */
console.log('\n4. Импорт команд: предупреждения, замена, сброс сетки');
{
  const { w, state } = await boot(initialData());
  const doc = teamsDoc([
    botTeam('Team Spirit', { logo: 'data:image/jpeg;base64,AAAA' }),
    botTeam('Virtus.pro'),
    botTeam('BetBoom Team', { oversized: true })
  ], [AGENT('s1mple'), AGENT('Nightfall', 'player')]);

  await chooseFile(w, JSON.stringify(doc));
  await sleep(20);
  ok(modalOpen(w), 'после проверки открывается подтверждение');
  ok(/Импорт команд/.test(modalTitle(w)), 'первый шаг — импорт команд', modalTitle(w));
  ok(/Импорт заменит список команд полностью/.test(modalBody(w)), 'есть предупреждение о полной замене');
  ok(/Команд в файле: 3/.test(modalBody(w)) || /Команд в файле<\/span>/.test(el(w, 'botModalBody').innerHTML),
    'в сводке указано число команд');
  ok(modalButtons(w).join('|').indexOf('Продолжить') >= 0 && modalButtons(w).join('|').indexOf('Отмена') >= 0,
    'кнопки «Продолжить» и «Отмена»', modalButtons(w).join(' | '));

  ok(clickModal(w, 'Продолжить'), 'нажали «Продолжить»');
  await sleep(10);
  ok(/Сброс сетки/.test(modalTitle(w)), 'второй шаг — предупреждение о сбросе сетки', modalTitle(w));
  ok(/Импорт команд сбросит текущую сетку \(матчи и расписание\)/.test(modalBody(w)),
    'текст про сброс сетки совпадает с требованием');
  ok(/Все пары нужно будет расставить заново/.test(modalBody(w)), 'и про расстановку пар заново');
  ok(state.saves.length === 0, 'до подтверждения ничего не сохраняется');

  ok(clickModal(w, 'Продолжить'), 'подтвердили сброс сетки');
  await sleep(60);

  const saved = lastSave(state);
  ok(!!saved, 'данные сохранены на сервер');
  ok(saved.teams.length === 3, 'в сохранении три команды', saved.teams && saved.teams.length);
  ok(saved.teams.map((t) => t.name).join(',') === 'Team Spirit,Virtus.pro,BetBoom Team', 'порядок команд сохранён',
    saved.teams.map((t) => t.name).join(','));
  ok(saved.teams.map((t) => t.id).join(',') === '1,2,3', 'id переназначены 1..N', saved.teams.map((t) => t.id).join(','));
  ok(saved.teams[0].players.length === 5 && saved.teams[0].players[0].role === 1, 'состав и роли на месте');
  ok(saved.teams[0].logo.indexOf('data:image') === 0, 'логотип перенесён');

  ok(saved.matches.length === 5, 'сетка осталась из 5 матчей');
  const dirty = saved.matches.filter((m) => m.team1 !== null || m.team2 !== null || m.winner !== null);
  ok(dirty.length === 0, 'все пары и результаты сброшены', JSON.stringify(dirty));
  ok(Object.keys(saved.schedule || {}).length === 0, 'расписание очищено', JSON.stringify(saved.schedule));
  ok(saved.liveMatchId === null, 'liveMatchId сброшен');

  ok(Array.isArray(saved.freeAgents) && saved.freeAgents.length === 2, 'агенты записаны в DATA.freeAgents');
  ok(saved.freeAgents[0].type === 'looking_for_team' && saved.freeAgents[1].type === 'player', 'типы агентов сохранены');

  ok(/Импортировано команд: <b>3<\/b>/.test(statusText(w)) || /Импортировано команд: 3/.test(statusText(w)),
    'в статусе видно число импортированных команд', statusText(w).slice(0, 80));
  ok(/Найдено свободных агентов/.test(statusText(w)), 'уведомление про найденных агентов');
  ok(/2/.test(statusText(w)), 'в уведомлении есть число агентов');
  ok(/больше 200 КБ/.test(statusText(w)), 'отдельно отмечены oversized-логотипы');

  const lookBtn = Array.from(el(w, 'botImportStatus').querySelectorAll('button'))
    .find((b) => b.textContent.indexOf('Посмотреть') >= 0);
  ok(!!lookBtn, 'есть кнопка «Посмотреть»');
  if (lookBtn) {
    lookBtn.click();
    await sleep(30);
    ok(el(w, 'tab-agents').classList.contains('active'), 'кнопка открывает вкладку агентов');
    ok(el(w, 'agentList').querySelectorAll('.bot-item').length === 2, 'агенты отрисованы в списке',
      el(w, 'agentList').querySelectorAll('.bot-item').length);
    ok(/s1mple/.test(textOf(w, 'agentList')) && /заявка игрока/.test(textOf(w, 'agentList')),
      'в карточках ники и тип заявки');
    ok(el(w, 'agentList').querySelectorAll('a[href^="tg://user?id="]').length === 2, 'есть ссылки «написать» в Telegram');
  }
}

/* ============================================================
   5. Дубликаты названий и отмена
   ============================================================ */
console.log('\n5. Повторяющиеся названия');
{
  const { w, state } = await boot(initialData());
  const doc = teamsDoc([botTeam('Team Spirit', { players: [{ nick: 'Первая', role: 1 }].concat(DOTA_PLAYERS.slice(1)) }),
    botTeam('Другая'), botTeam('Team Spirit', { players: [{ nick: 'Вторая', role: 1 }].concat(DOTA_PLAYERS.slice(1)) })], []);

  await chooseFile(w, JSON.stringify(doc));
  await sleep(20);
  ok(/Повторяющиеся названия/.test(modalTitle(w)), 'дубликаты → отдельный шаг', modalTitle(w));
  ok(/Team Spirit/.test(modalBody(w)), 'в предупреждении указано название-дубликат');
  ok(modalButtons(w).join('|').indexOf('Заменить') >= 0 && modalButtons(w).join('|').indexOf('Пропустить') >= 0,
    'есть выбор «Заменить / Пропустить»', modalButtons(w).join(' | '));

  ok(modalButtons(w).join('|').indexOf('Отмена') >= 0, 'есть кнопка отмены');
  ok(clickModal(w, 'Отмена'), 'нажали «Отмена»');
  await sleep(20);
  ok(!modalOpen(w), 'модалка закрылась');
  ok(state.saves.length === 0, 'после отмены ничего не сохранилось');
  ok(w.DATA.teams.length === 2, 'старые команды на месте');

  /* «Заменить» — остаётся последняя версия */
  await chooseFile(w, JSON.stringify(doc));
  await sleep(20);
  clickModal(w, 'Заменить');
  await sleep(10);
  clickModal(w, 'Продолжить');
  await sleep(10);
  clickModal(w, 'Продолжить');
  await sleep(60);
  let saved = lastSave(state);
  ok(saved.teams.length === 2, 'после «Заменить» осталось две команды', saved.teams.length);
  ok(saved.teams[0].players[0].nick === 'Вторая', 'оставлена последняя версия дубликата', saved.teams[0].players[0].nick);

  /* «Пропустить» — остаётся первая версия */
  await boot(initialData()).then(async (second) => {
    const w2 = second.w;
    await chooseFile(w2, JSON.stringify(doc));
    await sleep(20);
    clickModal(w2, 'Пропустить');
    await sleep(10);
    clickModal(w2, 'Продолжить');
    await sleep(10);
    clickModal(w2, 'Продолжить');
    await sleep(60);
    const saved2 = lastSave(second.state);
    ok(saved2.teams.length === 2, 'после «Пропустить» тоже две команды', saved2.teams.length);
    ok(saved2.teams[0].players[0].nick === 'Первая', 'оставлена первая версия дубликата', saved2.teams[0].players[0].nick);
  });
}

/* ============================================================
   6. Файл настроек
   ============================================================ */
console.log('\n6. Файл настроек турнира');
{
  const { w, state } = await boot(initialData());
  const teamsBefore = JSON.stringify(w.DATA.teams);
  const matchesBefore = JSON.stringify(w.DATA.matches);

  await chooseFile(w, JSON.stringify(settingsDoc()), 'settings_2026-10-07_csgo.json');
  await sleep(20);
  ok(modalOpen(w), 'файл настроек открывает подтверждение');
  ok(/Настройки турнира/.test(modalTitle(w)), 'шаг называется «Настройки турнира»', modalTitle(w));
  ok(/Команды и сетка матчей не изменятся/.test(modalBody(w)), 'сказано, что команды и матчи не тронем');
  ok(/Compass Arena/.test(modalBody(w)) && /Compass Arena Season 3/.test(modalBody(w)), 'в превью видно «было → станет»');

  ok(clickModal(w, 'Применить'), 'нажали «Применить»');
  await sleep(60);
  const saved = lastSave(state);
  ok(saved.tournament.name === 'Compass Arena Season 3', 'название турнира обновлено', saved.tournament.name);
  ok(saved.tournament.game === 'CS:GO', 'игра обновлена');
  ok(saved.tournament.matches === 'Bo5', 'формат матчей обновлён');
  ok(saved.tournament.dates === '1 ноября 2026', 'даты обновлены');
  ok(JSON.stringify(saved.teams) === teamsBefore, 'команды не изменились');
  ok(JSON.stringify(saved.matches) === matchesBefore, 'матчи не изменились');
  ok(/Настройки турнира обновлены/.test(statusText(w)), 'статус сообщает об успехе', statusText(w).slice(0, 80));

  /* Битый файл настроек */
  await chooseFile(w, JSON.stringify({ type: 'settings', version: 1, discipline: 'dota2' }));
  await sleep(20);
  ok(/Нет блока tournament/.test(statusText(w)), 'настройки без tournament → ошибка', statusText(w).slice(0, 80));
}

/* ============================================================
   7. Агенты и пустой список
   ============================================================ */
console.log('\n7. Свободные агенты');
{
  const { w, state } = await boot(initialData());
  await chooseFile(w, JSON.stringify(teamsDoc([botTeam('Без агентов')], [])));
  await sleep(20);
  clickModal(w, 'Продолжить');
  await sleep(10);
  clickModal(w, 'Продолжить');
  await sleep(60);
  ok(Array.isArray(lastSave(state).freeAgents) && lastSave(state).freeAgents.length === 0,
    'пустой freeAgents в файле → пустой массив в данных', JSON.stringify(lastSave(state).freeAgents));
  ok(!/Найдено свободных агентов/.test(statusText(w)), 'без агентов уведомления нет');

  /* Поле freeAgents вообще отсутствует — тоже не ошибка */
  const { w: w2, state: s2 } = await boot(initialData());
  const doc = teamsDoc([botTeam('Нет поля')]);
  delete doc.freeAgents;
  await chooseFile(w2, JSON.stringify(doc));
  await sleep(20);
  clickModal(w2, 'Продолжить');
  await sleep(10);
  clickModal(w2, 'Продолжить');
  await sleep(60);
  ok(Array.isArray(lastSave(s2).freeAgents) && lastSave(s2).freeAgents.length === 0,
    'отсутствие поля freeAgents не ломает импорт');
}

/* ============================================================
   8. Защита архива перед импортом
   ============================================================ */
console.log('\n8. Импорт и незафиксированный сезон');
{
  const { w, state } = await boot(initialData({ finished: true }));
  await chooseFile(w, JSON.stringify(teamsDoc([botTeam('Новая команда')], [])));
  await sleep(20);
  clickModal(w, 'Продолжить');
  await sleep(10);
  clickModal(w, 'Продолжить');
  await sleep(60);
  ok(state.confirms.some((msg) => /импортировать команды из бота/.test(msg)),
    'перед импортом предложено зафиксировать завершённый сезон', state.confirms.join(' | ').slice(0, 120));
  ok(w.HISTORY.length === 1, 'сезон попал в архив', w.HISTORY.length);
  ok(lastSave(state).teams.length === 1, 'импорт всё равно выполнен');
}

/* ============================================================
   9. Логотипы: размер данных и отрисовка (требование по 8×200 КБ)
   ============================================================ */
console.log('\n9. Логотипы 8 команд × ~200 КБ');
{
  const { w, state } = await boot(initialData());
  const bigLogo = 'data:image/jpeg;base64,' + 'A'.repeat(273000); /* ≈200 КБ */
  const many = [];
  for (let i = 1; i <= 8; i++) many.push(botTeam('Команда ' + i, { logo: bigLogo }));

  const t0 = Date.now();
  await chooseFile(w, JSON.stringify(teamsDoc(many, [AGENT('a1')])));
  await sleep(20);
  clickModal(w, 'Продолжить');
  await sleep(10);
  clickModal(w, 'Продолжить');
  await sleep(80);
  const importMs = Date.now() - t0;

  const jsonSize = JSON.stringify(w.DATA).length;
  const t1 = Date.now();
  w.renderTeams();
  const renderMs = Date.now() - t1;
  const items = el(w, 'teamList').querySelectorAll('.team-item').length;

  const payloadSize = JSON.stringify(lastSave(state)).length;
  console.log('       DATA: ' + (jsonSize / 1024 / 1024).toFixed(2) + ' МБ · тело сохранения: ' +
    (payloadSize / 1024 / 1024).toFixed(2) + ' МБ · import: ' + importMs + ' мс · renderTeams: ' + renderMs + ' мс (jsdom)');

  ok(items === 8, 'список команд отрисован полностью', items);
  ok(jsonSize > 1.5 * 1024 * 1024, 'логотипы действительно попали в данные', (jsonSize / 1024 / 1024).toFixed(2) + ' МБ');
  ok(jsonSize < 4 * 1024 * 1024, 'данные не раздулись сверх ожидаемого', (jsonSize / 1024 / 1024).toFixed(2) + ' МБ');
  ok(payloadSize < 5 * 1024 * 1024, 'тело запроса сохранения в разумных пределах', (payloadSize / 1024 / 1024).toFixed(2) + ' МБ');
  ok(renderMs < 3000, 'отрисовка списка не зависает (jsdom)', renderMs + ' мс');
  ok(el(w, 'teamList').querySelectorAll('img').length === 8, 'логотипы отрисованы как <img>');
}

console.log(fails ? '\nПровалено проверок: ' + fails : '\nВсе проверки пройдены');
process.exit(fails ? 1 : 0);
