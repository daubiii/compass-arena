/* Регрессия админки: фиксация турнира в архив.
   Проверяем, что один сезон = одна глава, что удаление команд не плодит главы,
   что устаревшая глава обновляется без потери MVP/фото и что дубликаты убираются.

   Запуск: node tests/admin-archive.mjs */
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

const TEAMS = [
  { id: 1, name: 'Team Spirit', logo: '', players: [{ nick: 'Yatoro', role: 1 }] },
  { id: 2, name: 'Virtus.pro', logo: '', players: [] },
  { id: 3, name: 'Team Liquid', logo: '', players: [] },
  { id: 4, name: 'OG', logo: '', players: [] },
  { id: 5, name: 'Gaimin Gladiators', logo: '', players: [] },
  { id: 6, name: 'BetBoom Team', logo: '', players: [] }
];
const M = (id, round, bracket, t1, t2, winner, s1, s2) => ({ id, round, bracket, team1: t1, team2: t2, winner, score1: s1, score2: s2 });

const TOURNAMENT = {
  tournament: { name: 'Compass Arena', game: 'Dota 2', format: 'Custom Bracket', matches: 'Bo3', dates: '27 сентября 2026' },
  teams: TEAMS,
  matches: [M(1, 1, 'upper', 1, 2, 1, 2, 1), M(2, 1, 'upper', 3, 4, 3, 2, 0), M(3, 1, 'upper', 5, 6, 5, 2, 1),
    M(4, 2, 'upper', 1, 3, 1, 2, 0), M(5, 3, 'grand', 1, 5, 1, 2, 1)],
  schedule: { 1: '2026-09-26T12:00' }, liveMatchId: null,
  tournamentStart: '2026-09-26T12:00:00+03:00', projectStart: '2026-01-01T00:00:00+03:00',
  nextSeason: null, archivedSnapshotId: null, alwaysShowBracketBanner: true, history: []
};

async function bootServer(initial) {
  const state = {
    data: JSON.parse(JSON.stringify(initial)),
    saves: [],
    confirms: []
  };

  const html = read('poasalj1.z23.html').replace(/<script src="[^"]+"[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'https://compassarena.ru/admin',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    /* fetch/confirm/prompt нужны ДО выполнения скриптов страницы */
    beforeParse(win) {
      win.confirm = (msg) => { state.confirms.push(String(msg)); return state.answer !== undefined ? state.answer : true; };
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

/* ============ A. Одна фиксация — одна глава ============ */
console.log('\nA. Фиксация сезона: повторные нажатия обновляют главу, а не создают новые');
{
  const { w, state } = await bootServer(TOURNAMENT);
  ok(state.data.history.length === 0, 'стартуем с пустым архивом');
  ok(typeof w.snapshotCurrentTournament === 'function', 'кнопка фиксации доступна');

  w.snapshotCurrentTournament();
  await sleep(60);
  ok(w.HISTORY.length === 1, 'после первой фиксации одна глава', w.HISTORY.length);
  ok(!!w.DATA.archivedSnapshotId, 'сезон помечен как зафиксированный');
  ok(w.HISTORY[0].fingerprint, 'в главу записан отпечаток сезона');

  state.answer = true;                     // «обновить существующую главу»
  w.snapshotCurrentTournament();
  await sleep(60);
  ok(w.HISTORY.length === 1, 'повторная фиксация не создала вторую главу', w.HISTORY.length);
}

/* ============ B. Удаление команд не плодит главы ============ */
console.log('\nB. Удаление команд после фиксации');
{
  const { w, state } = await bootServer(TOURNAMENT);
  w.snapshotCurrentTournament();
  await sleep(60);
  const before = w.HISTORY.length;
  state.confirms.length = 0;
  state.answer = true;

  w.deleteTeam(1);
  await sleep(30);
  w.deleteTeam(2);
  await sleep(30);
  w.deleteTeam(3);
  await sleep(30);

  ok(w.HISTORY.length === before, 'главы не размножились при удалении команд', w.HISTORY.length);
  const asked = state.confirms.filter((m) => /Зафиксировать сезон|Турнир выглядит завершённым/.test(m));
  ok(asked.length === 0, 'повторно про фиксацию не спрашивают', asked.length);
  ok(w.DATA.teams.length === 3, 'команды действительно удалены', w.DATA.teams.length);
}

/* ============ C. Устаревшая глава обновляется без потери MVP и фото ============ */
console.log('\nC. Правки после фиксации: глава помечается устаревшей и обновляется');
{
  const { w, state } = await bootServer(TOURNAMENT);
  w.snapshotCurrentTournament();
  await sleep(60);

  // имитируем оформление главы: MVP и фото
  w.HISTORY[0].mvp = { teamId: 1, playerNick: 'Yatoro', note: 'MVP финала' };
  w.HISTORY[0].photos = [{ url: 'data:image/png;base64,AAA', caption: 'кадр' }];

  // правим счёт финала → сезон становится «устаревшим»
  w.DATA.matches[4].score1 = 2;
  w.DATA.matches[4].score2 = 0;
  w.renderHistory();
  await sleep(30);

  ok(w.chapterIsStale() === true, 'глава помечена устаревшей');
  ok(/результаты изменились/.test(w.document.getElementById('historyList').textContent), 'в списке видно предупреждение');

  state.answer = true;
  w.snapshotCurrentTournament();
  await sleep(60);

  ok(w.HISTORY.length === 1, 'глава не продублировалась');
  ok(w.chapterIsStale() === false, 'после обновления глава снова актуальна');
  ok(w.HISTORY[0].mvp && w.HISTORY[0].mvp.playerNick === 'Yatoro', 'MVP сохранён');
  ok(w.HISTORY[0].photos.length === 1, 'фото сохранены');
  ok(w.HISTORY[0].matches[4].score2 === 0, 'в главе новый счёт финала', w.HISTORY[0].matches[4].score2);
}

/* ============ D. Дубликаты находятся и убираются ============ */
console.log('\nD. Дубликаты глав: точные повторы и частичные копии');
{
  const { w, state } = await bootServer(TOURNAMENT);
  w.snapshotCurrentTournament();
  await sleep(60);

  // (1) оформляем главу как в жизни — фото и MVP, затем делаем её «бедный» точный повтор
  w.HISTORY[0].photos = [{ url: 'data:image/png;base64,AAA', caption: 'кадр' }];
  w.HISTORY[0].mvp = { teamId: 1, playerNick: 'Yatoro', note: '' };
  const full = JSON.parse(JSON.stringify(w.HISTORY[0]));
  const twin = JSON.parse(JSON.stringify(full));
  twin.id = 'ca-twin';
  twin.createdAt = new Date(Date.parse(full.createdAt) + 30000).toISOString();
  twin.photos = [];
  twin.mvp = { teamId: null, playerNick: '', note: '' };
  w.HISTORY.push(twin);

  // (2) частичная копия: та же дата и название, но без последних результатов
  const partial = JSON.parse(JSON.stringify(full));
  partial.id = 'ca-partial-copy';
  partial.createdAt = new Date(Date.parse(full.createdAt) + 60000).toISOString();
  partial.matches = partial.matches.map((m) => (m.id === 5 || m.id === 4 ? Object.assign({}, m, { winner: null, score1: null, score2: null }) : m));
  partial.championId = null;
  partial.runnerUpId = null;
  partial.photos = [{ url: 'data:image/png;base64,BBB', caption: 'кадр из копии' }];
  w.HISTORY.push(partial);

  const dupes = w.findDuplicates();
  ok(Object.keys(dupes).length === 2, 'найдены оба вида дублей', JSON.stringify(dupes));
  ok(dupes['ca-twin'] === full.id, 'точный повтор помечен дубликатом «богатой» главы');
  ok(dupes['ca-partial-copy'] === full.id, 'частичная копия помечена дубликатом полной');
  w.renderHistory();
  await sleep(30);
  ok(/дубликат главы/.test(w.document.getElementById('historyList').textContent), 'в списке есть бейдж дубликата');

  state.answer = true;
  w.dedupeHistory();
  await sleep(60);
  ok(w.HISTORY.length === 1, 'лишние копии удалены', w.HISTORY.length);
  ok(w.HISTORY[0].id === full.id, 'полная глава осталась');
  ok(w.DATA.archivedSnapshotId === full.id, 'привязка сезона указывает на полную главу');
  ok(w.HISTORY[0].photos.length === 2, 'фото из копии перенесено в полную главу', w.HISTORY[0].photos.length);
}

/* ============ E. Сброс сезона: архив остаётся, новый сезон = новая глава ============ */
console.log('\nE. Сброс сезона не трогает архив, новый сезон фиксируется отдельно');
{
  const { w, state } = await bootServer(TOURNAMENT);
  w.snapshotCurrentTournament();
  await sleep(60);
  ok(w.HISTORY.length === 1, 'первый сезон зафиксирован');

  state.answer = true;                     // сброс сезона подтверждаем (сезон уже в архиве, про фиксацию не спросят)
  w.resetData();
  await sleep(80);

  ok(w.HISTORY.length === 1, 'архив пережил сброс сезона', w.HISTORY.length);
  ok(w.DATA.archivedSnapshotId === null, 'привязка «сезон зафиксирован» сброшена');
  ok(w.DATA.teams.length === 6 && w.DATA.teams[0].name === 'Слот 1', 'команды обнулены к слотам', w.DATA.teams[0].name);

  // новый сезон: играем финал и фиксируем — должна появиться вторая глава
  w.DATA.teams = JSON.parse(JSON.stringify(TEAMS));
  w.DATA.matches = TOURNAMENT.matches.map((m) => JSON.parse(JSON.stringify(m)));
  w.DATA.tournament.dates = '10 января 2027';
  state.answer = true;
  w.snapshotCurrentTournament();
  await sleep(80);

  ok(w.HISTORY.length === 2, 'новый сезон стал второй главой', w.HISTORY.length);
  const nos = Array.from(w.document.querySelectorAll('#historyList .h-no')).map((el) => el.textContent.trim());
  ok(nos.some((t) => /№2/.test(t)) && nos.some((t) => /№1/.test(t)), 'в списке есть нумерация №1 и №2', nos.join(' | '));
}

/* ============ F. Слияние двух глав одного турнира ============ */
console.log('\nF. Ручное слияние глав (результаты разъехались врозь)');
{
  const { w, state } = await bootServer(TOURNAMENT);
  w.snapshotCurrentTournament();
  await sleep(60);

  // разрезаем главу на две: в одной раунд 1, в другой полуфинал и финал
  const original = JSON.parse(JSON.stringify(w.HISTORY[0]));
  const partA = JSON.parse(JSON.stringify(original));
  partA.id = 'ca-part-a';
  partA.createdAt = new Date(Date.parse(original.createdAt) + 1000).toISOString();
  partA.photos = [{ url: 'data:image/png;base64,AAA', caption: 'из первой половины' }];
  partA.matches = partA.matches.map((m) => (m.id <= 3 ? m : Object.assign({}, m, { winner: null, score1: null, score2: null })));
  const partB = JSON.parse(JSON.stringify(original));
  partB.id = 'ca-part-b';
  partB.createdAt = new Date(Date.parse(original.createdAt) + 2000).toISOString();
  partB.matches = partB.matches.map((m) => (m.id <= 3 ? Object.assign({}, m, { winner: null, score1: null, score2: null }) : m));
  w.HISTORY = [partA, partB];

  state.answer = true;
  w.openHistoryModal('ca-part-b');
  await sleep(30);
  ok(!!w.document.getElementById('histMergeSelect'), 'в окне главы есть выбор главы для слияния');
  const options = Array.from(w.document.querySelectorAll('#histMergeSelect option')).map((o) => o.value);
  ok(options.indexOf('ca-part-a') >= 0, 'в списке есть вторая глава', options.join(','));
  ok(options.indexOf('ca-part-b') < 0, 'сама открытая глава в списке отсутствует');

  w.document.getElementById('histMergeSelect').value = 'ca-part-a';
  w.mergeHistoryIntoCurrent();
  await sleep(80);

  ok(w.HISTORY.length === 1, 'осталась одна глава', w.HISTORY.length);
  const merged = w.HISTORY[0];
  const winners = merged.matches.filter((m) => m.winner).length;
  ok(merged.id === 'ca-part-b', 'слияние идёт в открытую главу');
  ok(winners === 5, 'в объединённой главе все пять результатов', winners);
  ok(merged.photos.length === 1, 'фото из второй половины перенесено', merged.photos.length);
}

console.log(fails ? '\nПровалено проверок: ' + fails : '\nВсе проверки пройдены');
process.exit(fails ? 1 : 0);
