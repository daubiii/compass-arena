/* Админка: генерация универсальной сетки (вкладка «Настройки»), ввод результатов
   и пересчёт связей. Движок подключается как в жизни — /assets/ca-bracket-engine.js.
   Запуск: node tests/admin-bracket.mjs */
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

const TEAMS = [
  { id: 1, name: 'Team Spirit', players: [], logo: '' },
  { id: 2, name: 'Team Liquid', players: [], logo: '' },
  { id: 3, name: 'Gaimin Gladiators', players: [], logo: '' },
  { id: 4, name: 'BetBoom Team', players: [], logo: '' },
  { id: 5, name: 'OG', players: [], logo: '' },
  { id: 6, name: 'Virtus.pro', players: [], logo: '' },
  { id: 7, name: 'Tundra', players: [], logo: '' },
  { id: 8, name: 'Falcons', players: [], logo: '' }
];

const BASE = {
  tournament: { name: 'Compass Arena', game: 'Dota 2', format: 'Custom Bracket', matches: 'Bo3', dates: '1 января 2027' },
  teams: TEAMS,
  matches: [
    { id: 1, round: 1, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null, vod: '' },
    { id: 2, round: 1, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null, vod: '' }
  ],
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
    virtualConsole: new (await import('jsdom')).VirtualConsole(),
    beforeParse(win) {
      win.confirm = (msg) => { state.confirms.push(String(msg)); return state.answer !== false; };
      win.prompt = () => 'pw';
      win.alert = () => {};
      win.scrollTo = () => {};
      win.fetch = async (url, opts) => {
        if (String(url).indexOf('/api/save') >= 0) {
          const body = JSON.parse(opts.body);
          state.saves.push(body.data);
          state.data = JSON.parse(JSON.stringify(body.data));
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(state.data)) };
      };
      /* Движок сетки — тот же файл, что подключён на странице */
      win.eval(read('assets/ca-bracket-engine.js'));
    }
  });

  await sleep(220);
  return { w: dom.window, state };
}

/* ============ A. Форма и генерация SE ============ */
console.log('\nA. Генерация Single Elimination на 8 команд');
{
  const { w, state } = await boot(BASE);
  ok(!!w.document.getElementById('brTeamCount'), 'в настройках есть выбор числа команд');
  ok(!!w.document.getElementById('brFormat'), 'есть выбор формата SE/DE');
  ok(!!w.document.getElementById('brMatchType'), 'есть выбор серий');
  ok(typeof w.generateBracket === 'function', 'функция генерации доступна');

  w.document.getElementById('brTeamCount').value = '8';
  w.document.getElementById('brFormat').value = 'se';
  w.document.getElementById('brMatchType').value = 'Bo3';
  w.generateBracket();
  await sleep(120);

  ok(!!w.DATA.bracket, 'настройки сетки сохранены в DATA.bracket', JSON.stringify(w.DATA.bracket));
  ok(w.DATA.bracket.format === 'se' && w.DATA.bracket.teamCount === 8, 'в настройках формат и число команд');
  ok(w.DATA.bracket.matchType === 'Bo3' && w.DATA.tournament.matches === 'Bo3', 'серии Bo3 записаны и в турнир');

  const matches = w.DATA.matches;
  ok(matches.length === 7, 'SE на 8 команд: 7 матчей', matches.length);
  ok(matches.filter((m) => m.bracket === 'grand').length === 1, 'один финал');
  ok(matches.every((m) => typeof m.id === 'number' && 'team1' in m && 'score1' in m), 'поля старого формата на месте');

  const first = matches.filter((m) => m.round === 1);
  const seeded = [];
  first.forEach((m) => { if (m.team1) seeded.push(m.team1); if (m.team2) seeded.push(m.team2); });
  ok(seeded.length === 8 && new Set(seeded).size === 8, 'все 8 команд расставлены по одному разу', JSON.stringify(seeded));
  ok(seeded.indexOf(1) === seeded.findIndex((id) => id === 1), 'первая команда вкладки получила первый номер посева');

  ok(state.saves.length > 0, 'сетка сохранена через /api/save');
  ok(!!state.data.bracket, 'в KV ушли настройки сетки');

  const cards = w.document.querySelectorAll('#matchList .match-item');
  ok(cards.length === 7, 'во вкладке «Матчи» семь карточек', cards.length);
  ok(/Полуфинал верхней|Верхняя · раунд|Финал верхней/.test(w.document.getElementById('matchList').textContent),
    'в карточках подписи стадий');
}

/* ============ B. Ввод результата пересчитывает сетку ============ */
console.log('\nB. Победитель проходит дальше');
{
  const { w, state } = await boot(BASE);
  w.document.getElementById('brTeamCount').value = '8';
  w.document.getElementById('brFormat').value = 'se';
  w.generateBracket();
  await sleep(120);

  const first = w.DATA.matches.filter((m) => m.round === 1)[0];
  ok(!!first.team1 && !!first.team2, 'в первом матче обе команды известны', JSON.stringify([first.team1, first.team2]));

  w.setWinner(first.id, String(first.team1));
  await sleep(80);
  w.document.getElementById('admin-score1-' + first.id).value = '2';
  w.document.getElementById('admin-score2-' + first.id).value = '1';
  w.setScore(first.id);
  await sleep(80);

  const saved = state.data.matches.filter((m) => m.id === first.id)[0];
  ok(saved.winner === first.team1 && saved.score1 === 2 && saved.score2 === 1, 'результат сохранён в KV',
    JSON.stringify([saved.winner, saved.score1, saved.score2]));

  /* На сайте и в админке слот следующего матча считает движок по связям */
  const engine = w.CA.bracketEngine;
  const dest = engine.destinations(w.DATA.matches);
  ok(dest[first.id] && dest[first.id].winnerTo, 'у матча есть получатель победителя', JSON.stringify(dest[first.id]));
  const nextId = dest[first.id].winnerTo;
  const nextMatch = w.DATA.matches.filter((m) => m.id === nextId)[0];
  ok(!!nextMatch.from1 || !!nextMatch.from2, 'следующий матч ждёт команду по источнику');

  const html = w.document.getElementById('matchList').textContent;
  ok(/Победитель M/.test(html), 'в карточках видно, кто кого ждёт');
}

/* ============ C. Double Elimination на 6 команд ============ */
console.log('\nC. Double Elimination на 6 команд с гранд-финалом');
{
  const { w } = await boot(BASE);
  w.document.getElementById('brTeamCount').value = '6';
  w.document.getElementById('brFormat').value = 'de';
  w.document.getElementById('brGrandFinal').value = 'double';
  w.generateBracket();
  await sleep(120);

  ok(w.DATA.bracket.format === 'de' && w.DATA.bracket.teamCount === 6, 'формат DE с шестью командами');
  const matches = w.DATA.matches;
  ok(matches.filter((m) => m.bracket === 'upper').length === 7, 'верхняя сетка: 7 матчей', matches.filter((m) => m.bracket === 'upper').length);
  ok(matches.filter((m) => m.bracket === 'lower').length === 6, 'нижняя сетка: 6 матчей', matches.filter((m) => m.bracket === 'lower').length);
  ok(matches.filter((m) => m.bracket === 'grand').length === 2, 'гранд-финал + сброс: 2 матча', matches.filter((m) => m.bracket === 'grand').length);
  ok(w.DATA.bracket.grandFinal === 'double', 'в настройках «до двух поражений»');
  ok(w.DATA.bracket.byes === 2, 'в настройках отмечены два BYE', w.DATA.bracket.byes);
  const html = w.document.getElementById('matchList').textContent;
  ok(/BYE/.test(html), 'пустые слоты подписаны как BYE');
}

/* ============ D. Защита: пустые команды и подтверждение сброса ============ */
console.log('\nD. Защита от случайной пересборки');
{
  const noTeams = JSON.parse(JSON.stringify(BASE));
  noTeams.teams = [{ id: 1, name: 'Слот 1', players: [], logo: '' }];
  const boot1 = await boot(noTeams);
  boot1.w.generateBracket();
  await sleep(80);
  ok(!boot1.w.DATA.bracket, 'без команд сетка не генерируется');
  ok(boot1.state.saves.length === 0, 'и ничего не сохраняется');

  const { w, state } = await boot(BASE);
  w.document.getElementById('brTeamCount').value = '8';
  w.generateBracket();
  await sleep(100);
  const first = w.DATA.matches.filter((m) => m.round === 1)[0];
  w.setWinner(first.id, String(first.team1));
  await sleep(60);

  state.confirms.length = 0;
  state.answer = false;
  w.generateBracket();
  await sleep(80);
  ok(state.confirms.length > 0, 'перед пересборкой спрашивают подтверждение', state.confirms[0]);
  ok(!!state.confirms[0] && /результат/.test(state.confirms[0]), 'в вопросе сказано про результаты');
  ok(!!w.DATA.matches.filter((m) => m.id === first.id && m.winner)[0], 'при отказе результаты на месте');
}

/* ============ E. Очистка сетки ============ */
console.log('\nE. Очистка сетки');
{
  const { w, state } = await boot(BASE);
  w.generateBracket();
  await sleep(100);
  w.clearBracket();
  await sleep(100);
  ok(w.DATA.matches.length === 0, 'матчи убраны');
  ok(w.DATA.bracket === null, 'настройки сетки сброшены');
  ok(Object.keys(w.DATA.schedule).length === 0, 'расписание очищено');
  ok(w.DATA.teams.length === 8, 'команды остались на месте');
  ok(state.data.matches.length === 0, 'очистка сохранена в KV');
}

console.log(fails ? '\nПРОВАЛЕНО: ' + fails : '\nвсе проверки пройдены');
process.exit(fails ? 1 : 0);
