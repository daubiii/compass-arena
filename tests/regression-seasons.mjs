/* Регрессия: сброс сезона и разделение турниров в архиве.
   Проверяем, что после «удаления команд для регистрации новых»
   история не пропадает и турниры явно разделены.

   Запуск: node tests/regression-seasons.mjs */
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

/* ---------- данные ---------- */
const TEAMS = [
  { id: 1, name: 'Team Spirit', logo: '', players: [{ nick: 'Yatoro', role: 1 }] },
  { id: 2, name: 'Virtus.pro', logo: '', players: [] },
  { id: 3, name: 'Team Liquid', logo: '', players: [] },
  { id: 4, name: 'OG', logo: '', players: [] },
  { id: 5, name: 'Gaimin Gladiators', logo: '', players: [] },
  { id: 6, name: 'BetBoom Team', logo: '', players: [] }
];
const SLOTS = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: 'Слот ' + id, logo: '', players: [] }));
const M = (id, round, bracket, t1, t2, winner, s1, s2) => ({ id, round, bracket, team1: t1, team2: t2, winner, score1: s1, score2: s2 });

/* Два зафиксированных турнира с ОДИНАКОВЫМ названием — как в жизни */
const H1 = {
  id: 'ca-2030-a', name: 'Compass Arena', date: '27.09.2030', createdAt: '2030-09-28T00:00:00Z',
  format: 'Custom Bracket · Bo3', game: 'Dota 2', teams: TEAMS,
  matches: [M(1, 1, 'upper', 1, 2, 1, 2, 1), M(2, 1, 'upper', 3, 4, 3, 2, 0), M(3, 1, 'upper', 5, 6, 5, 2, 1),
    M(4, 2, 'upper', 1, 3, 1, 2, 0), M(5, 3, 'grand', 1, 5, 1, 2, 1)],
  championId: 1, runnerUpId: 5, mvp: { teamId: 1, playerNick: 'Yatoro', note: 'MVP финала' }, photos: []
};
const H2 = {
  id: 'ca-2031-b', name: 'Compass Arena', date: '14.02.2031', createdAt: '2031-02-15T00:00:00Z',
  format: 'Custom Bracket · Bo3', game: 'Dota 2', teams: TEAMS,
  matches: [M(1, 1, 'upper', 1, 2, 2, 1, 2), M(2, 1, 'upper', 3, 4, 4, 0, 2), M(3, 1, 'upper', 5, 6, 5, 2, 0),
    M(4, 2, 'upper', 2, 4, 2, 2, 1), M(5, 3, 'grand', 2, 5, 5, 1, 2)],
  championId: 5, runnerUpId: 2, mvp: { teamId: 5, playerNick: 'Quinn', note: 'Лучший мидер' }, photos: []
};

const EMPTY_MATCHES = [M(1, 1, 'upper'), M(2, 1, 'upper'), M(3, 1, 'upper'), M(4, 2, 'upper'), M(5, 3, 'grand')];

/* A: чистый сброс — команды вернулись к слотам, матчи пустые */
const RESET_CLEAN = {
  tournament: { name: 'Compass Arena', game: 'Dota 2', format: 'Custom Bracket', matches: 'Bo3', dates: 'осень 2031' },
  teams: SLOTS, matches: EMPTY_MATCHES, schedule: {}, liveMatchId: null,
  tournamentStart: '2031-09-26T12:00:00+03:00', projectStart: '2031-01-01T00:00:00+03:00',
  history: [H1, H2]
};

/* B: команды удалены, а матчи остались с прежними id и победителями */
const RESET_DIRTY = {
  ...RESET_CLEAN,
  matches: [M(1, 1, 'upper', 1, 2, 1, 2, 1), M(2, 1, 'upper', 3, 4, 3, 2, 0), M(3, 1, 'upper', 5, 6, 5, 2, 1),
    M(4, 2, 'upper', 1, 3, 1, 2, 0), M(5, 3, 'grand', 1, 5, 1, 2, 1)]
};

/* C: архива ещё нет, идёт регистрация */
const NO_HISTORY = { ...RESET_CLEAN, history: [] };

/* D: битые записи в архиве — страница не должна рассыпаться */
const BROKEN_HISTORY = {
  ...RESET_CLEAN,
  history: [null, { id: 'ca-broken', name: null, teams: null, matches: [{ id: 5, winner: 'x', score1: 'y' }] }, H1]
};

function makeDom(file, fixture, scripts) {
  const html = read(file).replace(/<script src="[^"]+"[^>]*><\/script>/g, '');
  const errors = [];
  const dom = new JSDOM(html, { url: 'https://compassarena.ru/' + file.replace('index.html', ''), pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  w.addEventListener('error', (e) => errors.push('window.error: ' + ((e.error && e.error.stack) || e.message)));
  w.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + ((e.reason && e.reason.stack) || e.reason)));
  w.fetch = async () => ({ ok: true, json: async () => fixture });
  for (const f of scripts) w.eval(read('assets/' + f));
  return { dom, w, errors };
}

const HIST = ['ca-data.js', 'ca-ui.js', 'ca-views.js', 'ca-history.js'];
const HOME = ['ca-data.js', 'ca-ui.js', 'ca-views.js', 'ca-bracket.js', 'ca-home.js'];

/* ============ A: чистый сброс ============ */
console.log('\nA. История после чистого сброса сезона (команды = слоты)');
{
  const { w, errors } = makeDom('history.html', RESET_CLEAN, HIST);
  await sleep(220);
  const d = w.document;
  const chs = Array.from(d.querySelectorAll('#books .ch'));
  ok(chs.length === 2, 'оба турнира в архиве', chs.length);
  ok(!!d.getElementById('ch-now'), 'блок текущего сезона на месте');
  ok(d.body.textContent.includes('Сезон №3'), 'текущий сезон пронумерован как №3');
  ok(d.body.textContent.includes('регистрация'), 'у сезона явный статус «регистрация»');
  ok(chs[0].textContent.includes('Турнир №1 из 02'), 'марка первого турнира', chs[0].querySelector('.h-mark .no')?.textContent);
  ok(chs[1].textContent.includes('Турнир №2 из 02'), 'марка второго турнира', chs[1].querySelector('.h-mark .no')?.textContent);
  ok(chs[0].textContent.includes('Compass Arena #1'), 'одинаковые названия разведены: #1');
  ok(chs[1].textContent.includes('Compass Arena #2'), 'одинаковые названия разведены: #2');
  ok(d.querySelectorAll('.ch-divider').length === 1, 'между турнирами есть разделитель', d.querySelectorAll('.ch-divider').length);
  ok(d.querySelectorAll('#summary table.tbl').length === 2, 'обе сводные таблицы на месте');
  const champTable = d.querySelector('#summary .h-table-block .tbl');
  ok(champTable.textContent.includes('№1') && champTable.textContent.includes('№2'), 'в таблице чемпионов номера турниров');
  ok(champTable.textContent.includes('Команд') === false && !d.body.textContent.includes('Слот 1'), 'заглушки «Слот N» не попали на страницу');
  ok(d.querySelectorAll('.h-chip').length === 3, 'навигация: текущий сезон + 2 турнира', d.querySelectorAll('.h-chip').length);
  ok(d.querySelector('.h-chip .no').textContent.includes('№3'), 'первый чип — сезон №3', d.querySelector('.h-chip .no').textContent);
  ok(d.querySelectorAll('img:not([alt])').length === 0, 'у всех img есть alt');
  ok(errors.length === 0, 'без ошибок в консоли', errors[0]);
}

/* ============ B: грязный сброс ============ */
console.log('\nB. Сброс с остатками старых матчей (команды-слоты, матчи со старыми id)');
{
  const { w, errors } = makeDom('history.html', RESET_DIRTY, HIST);
  await sleep(220);
  const d = w.document;
  ok(d.body.getAttribute('data-phase') === 'pre', 'фаза не «post» — турнир не считается завершённым', d.body.getAttribute('data-phase'));
  ok(!d.body.textContent.includes('Слот 1'), '«Слот 1» не объявлен чемпионом');
  ok(d.querySelectorAll('#books .ch').length === 2, 'архив не пострадал');
  ok(d.querySelectorAll('#summary table.tbl').length === 2, 'таблицы отрисованы');
  ok(errors.length === 0, 'без ошибок в консоли');
}

/* ============ C: архива нет ============ */
console.log('\nC. Пустой архив + регистрация нового сезона');
{
  const { w, errors } = makeDom('history.html', NO_HISTORY, HIST);
  await sleep(220);
  const d = w.document;
  ok(!!d.querySelector('.ch-empty'), 'есть аккуратное пустое состояние архива');
  ok(d.querySelectorAll('#books .ch').length === 0, 'нет пустых глав');
  ok(d.body.textContent.includes('Сезон №1'), 'текущий сезон — №1');
  ok((d.body.textContent || '').length > 500, 'страница не пустая', (d.body.textContent || '').length);
  ok(errors.length === 0, 'без ошибок в консоли', errors[0]);
}

/* ============ D: битые записи архива ============ */
console.log('\nD. Битые записи в архиве не роняют страницу');
{
  const { w, errors } = makeDom('history.html', BROKEN_HISTORY, HIST);
  await sleep(220);
  const d = w.document;
  ok(d.querySelector('#books .ch') !== null, 'уцелевший турнир отрисован');
  ok(d.body.textContent.includes('Compass Arena'), 'его данные видны');
  ok(d.querySelectorAll('#summary table.tbl').length >= 1, 'сводка построена по уцелевшим данным');
  ok(errors.length === 0, 'без необработанных исключений', errors[0]);
}

/* ============ E: главная не объявляет заглушку чемпионом ============ */
console.log('\nE. Главная после сброса (без победителя)');
{
  const { w, errors } = makeDom('index.html', RESET_DIRTY, HOME);
  await sleep(220);
  const d = w.document;
  ok(d.body.getAttribute('data-phase') === 'pre', 'фаза pre', d.body.getAttribute('data-phase'));
  ok(d.getElementById('championSection').hidden === true, 'баннер чемпиона скрыт');
  ok(!d.body.textContent.includes('Слот 1'), '«Слот 1» нигде не показан как чемпион');
  ok(errors.length === 0, 'без ошибок в консоли');
}

console.log(fails ? '\nПровалено проверок: ' + fails : '\nВсе проверки пройдены');
process.exit(fails ? 1 : 0);
