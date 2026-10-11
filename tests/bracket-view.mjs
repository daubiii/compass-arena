/* Сайт: отрисовка универсальной сетки (4…16 команд, SE и DE), компактный вид
   с кнопкой разворота и пересчёт связей после ввода результатов.
   Компоненты подключаются так же, как на странице.
   Запуск: node tests/bracket-view.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')); }
};

const TEAMS = ['Team Spirit', 'Team Liquid', 'Gaimin Gladiators', 'BetBoom Team', 'OG', 'Virtus.pro', 'Tundra', 'Falcons',
  'Nigma', 'Entity', 'Heroic', 'Alliance', 'Secret', 'Liquid Academy', 'Navi', 'Spirit Academy']
  .map((name, i) => ({ id: i + 1, name, players: [], logo: '' }));

/** Мини-DOM страницы с нужными контейнерами и скриптами */
async function boot(data) {
  const html = `<!doctype html><html><body data-phase="pre">
    <div id="bracketWrap"></div><div id="toTop"></div>
  </body></html>`;
  const dom = new JSDOM(html, {
    url: 'https://compassarena.ru/',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    virtualConsole: new VirtualConsole(),
    beforeParse(win) {
      win.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) });
    }
  });
  const w = dom.window;
  for (const f of ['assets/ca-ui.js', 'assets/ca-bracket-engine.js', 'assets/ca-data.js', 'assets/ca-bracket.js']) {
    w.eval(read(f));
  }
  await sleep(60);
  return w;
}

/** Собирает сетку движком, расставляет команды и возвращает данные для страницы */
function buildData(w, teamCount, format, extra) {
  const engine = w.CA.bracketEngine;
  const cfg = Object.assign({ teamCount, format, matchType: 'Bo3' }, extra || {});
  const plan = engine.generate(cfg);
  const ordered = TEAMS.slice(0, teamCount);
  plan.matches.forEach((m) => {
    if (m.round === 1 && m.bracket === 'upper') {
      if (m.team1 !== null) m.team1 = ordered[m.team1 - 1] ? ordered[m.team1 - 1].id : null;
      if (m.team2 !== null) m.team2 = ordered[m.team2 - 1] ? ordered[m.team2 - 1].id : null;
    }
  });
  return {
    tournament: { name: 'Compass Arena', game: 'Dota 2', format: 'Bracket', matches: 'Bo3', dates: '1 января 2027' },
    teams: TEAMS.slice(0, teamCount),
    matches: plan.matches,
    schedule: {},
    liveMatchId: null,
    tournamentStart: null,
    projectStart: null,
    bracket: { format: cfg.format, teamCount, size: plan.size, matchType: 'Bo3',
      thirdPlace: !!cfg.thirdPlace, grandFinal: cfg.grandFinal || 'simple', byes: plan.byes },
    history: []
  };
}

function render(w, data) {
  const D = w.CA.data.setRaw(data);
  const wrap = w.document.getElementById('bracketWrap');
  w.CA.bracket.render(wrap, { data: D });
  return { D, wrap };
}

/* ============ A. SE на 8 команд ============ */
console.log('\nA. Single elimination, 8 команд');
{
  const w = await boot({});
  const raw = buildData(w, 8, 'se');
  const { D, wrap } = render(w, raw);
  await sleep(40);

  ok(wrap.querySelectorAll('.match').length === 7, 'семь карточек матчей', wrap.querySelectorAll('.match').length);
  ok(wrap.querySelectorAll('.b-col-head').length === 3, 'три колонки: раунд 1, полуфинал, финал',
    wrap.querySelectorAll('.b-col-head').length);
  const bracket = wrap.querySelector('.bracket');
  ok(!!bracket && bracket.getAttribute('data-cols') === '3', 'в разметке указано число колонок',
    bracket && bracket.getAttribute('data-cols'));

  const first = D.matches.filter((m) => m.round === 1);
  ok(first.every((m) => !!m.team1 && !!m.team2), 'в первом раунде у всех пар есть команды');
  ok(D.matches.filter((m) => m.bracket === 'grand').length === 1, 'один финал');

  /* Сыграем первый матч и посмотрим, что победитель поехал дальше.
     Результат пишем в сырые данные: страница читает именно их. */
  const m1 = first[0];
  const rawFirst = raw.matches.filter((m) => m.id === m1.id)[0];
  rawFirst.winner = m1.team1;
  rawFirst.score1 = 2;
  rawFirst.score2 = 0;
  const D2 = w.CA.data.setRaw(raw);
  const dest = w.CA.bracketEngine.destinations(D2.matches);
  const next = D2.byId[dest[m1.id].winnerTo];
  ok(next.team1 === m1.team1 || next.team2 === m1.team1, 'победитель подставлен в следующий матч',
    JSON.stringify([next.id, next.team1, next.team2]));

  const wrap2 = w.document.getElementById('bracketWrap');
  w.CA.bracket.render(wrap2, { data: D2 });
  await sleep(30);
  ok(/2 : 0/.test(wrap2.textContent), 'счёт серии виден на карточке');
  ok(!!wrap2.querySelector('.slot.is-winner') || /is-winner/.test(wrap2.innerHTML), 'победитель подсвечен');
}

/* ============ B. DE на 6 команд с BYE ============ */
console.log('\nB. Double elimination, 6 команд (два BYE)');
{
  const w = await boot({});
  const raw = buildData(w, 6, 'de', { grandFinal: 'simple' });
  const { D, wrap } = render(w, raw);
  await sleep(40);

  const upper = D.matches.filter((m) => m.bracket === 'upper').length;
  const lower = D.matches.filter((m) => m.bracket === 'lower').length;
  ok(upper === 7 && lower === 6, 'верхняя 7, нижняя 6 матчей', JSON.stringify([upper, lower]));
  ok(D.matches.filter((m) => m.bracket === 'grand').length === 1, 'один гранд-финал');

  const heads = Array.from(wrap.querySelectorAll('.b-col-head b')).map((b) => b.textContent);
  ok(heads.some((h) => /нижней/.test(h)), 'есть колонки нижней сетки', JSON.stringify(heads));
  ok(heads[0] === 'Четвертьфинал верхней' || /верхней/.test(heads[0]), 'первая колонка — верхняя сетка', heads[0]);
  ok(heads[heads.length - 1] === 'Гранд-финал', 'последняя колонка — гранд-финал', heads.join(' | '));
  ok(wrap.querySelectorAll('.match.is-lower').length === 6, 'карточки нижней сетки помечены',
    wrap.querySelectorAll('.match.is-lower').length);

  const byeMatches = D.matches.filter((m) => m.round === 1 && m.bracket === 'upper' && (!m.team1 || !m.team2));
  ok(byeMatches.length === 2, 'две пары с BYE', byeMatches.length);
  ok(byeMatches.every((m) => m.winner), 'победитель BYE-пары проставлен автоматически',
    JSON.stringify(byeMatches.map((m) => m.winner)));
  ok(/Без игры|Без соперника/.test(wrap.textContent), 'на карточке видно, что команда прошла без игры');
}

/* ============ C. Двойное поражение проигравшего ============ */
console.log('\nC. Проигравший уезжает в нижнюю сетку');
{
  const w = await boot({});
  const raw = buildData(w, 8, 'de', { grandFinal: 'simple' });
  const D = w.CA.data.setRaw(raw);
  const m1 = D.matches.filter((m) => m.round === 1 && m.bracket === 'upper')[0];
  const loser = m1.team2;
  const rawFirst = raw.matches.filter((m) => m.id === m1.id)[0];
  rawFirst.winner = m1.team1;
  rawFirst.score1 = 2;
  rawFirst.score2 = 1;
  const D2 = w.CA.data.setRaw(raw);
  const dest = w.CA.bracketEngine.destinations(D2.matches);
  const lowerMatch = D2.byId[dest[m1.id].loserTo];
  ok(!!lowerMatch, 'у матча есть получатель проигравшего');
  ok(lowerMatch.team1 === loser || lowerMatch.team2 === loser, 'проигравший подставлен в нижнюю сетку',
    JSON.stringify([lowerMatch.id, lowerMatch.bracket, lowerMatch.team1, lowerMatch.team2]));
  ok(lowerMatch.bracket === 'lower', 'и это именно матч нижней сетки');
}

/* ============ D. 16 команд: колонок больше, ничего не ломается ============ */
console.log('\nD. 16 команд, DE');
{
  const w = await boot({});
  const raw = buildData(w, 16, 'de', { grandFinal: 'double' });
  const { D, wrap } = render(w, raw);
  await sleep(40);

  ok(D.matches.length === 31, 'DE на 16 команд с гранд-финалом «до двух поражений»: 31 матч', D.matches.length);
  const cols = Number(wrap.querySelector('.bracket').getAttribute('data-cols'));
  ok(cols >= 8, 'колонок не меньше восьми (верхняя + нижняя + финалы)', cols);
  ok(wrap.querySelectorAll('.match').length === 31, 'все матчи отрисованы', wrap.querySelectorAll('.match').length);
  ok(wrap.querySelectorAll('.b-col-head').length === cols, 'у каждой колонки есть заголовок');

  /* Карточки не накладываются и у всех есть место в сетке */
  const placed = Array.from(wrap.querySelectorAll('.match')).map((el) => {
    const style = el.getAttribute('style') || '';
    const col = /grid-column:([^;]+)/.exec(style);
    const row = /grid-row:([^;]+)/.exec(style);
    return { id: el.getAttribute('data-match'), col: col && col[1], row: row && row[1] };
  });
  const bad = placed.filter((p) => !p.col || !p.row);
  ok(bad.length === 0, 'у всех карточек заданы колонка и ряд', JSON.stringify(bad.slice(0, 3)));
  const seen = {};
  let overlap = null;
  placed.forEach((p) => {
    const key = p.col + '|' + p.row;
    if (seen[key]) overlap = key;
    seen[key] = true;
  });
  ok(!overlap, 'две карточки не стоят в одной позиции', overlap);
}

/* ============ E. Старая сетка (6 команд, M1–M5) ============ */
console.log('\nE. Старый турнир продолжает рисоваться');
{
  const w = await boot({});
  const legacy = {
    tournament: { name: 'Compass Arena', game: 'Dota 2', format: 'Custom Bracket', matches: 'Bo3', dates: '' },
    teams: TEAMS.slice(0, 6),
    matches: [
      { id: 1, round: 1, bracket: 'upper', team1: 1, team2: 2, winner: 1, score1: 2, score2: 1, vod: '' },
      { id: 2, round: 1, bracket: 'upper', team1: 3, team2: 4, winner: null, score1: null, score2: null, vod: '' },
      { id: 3, round: 1, bracket: 'upper', team1: 5, team2: 6, winner: null, score1: null, score2: null, vod: '' },
      { id: 4, round: 2, bracket: 'upper', team1: null, team2: null, winner: null, score1: null, score2: null, vod: '' },
      { id: 5, round: 3, bracket: 'grand', team1: null, team2: null, winner: null, score1: null, score2: null, vod: '' }
    ],
    schedule: {}, liveMatchId: null, tournamentStart: null, projectStart: null, history: []
  };
  const { D, wrap } = render(w, legacy);
  await sleep(40);
  ok(D.matches.length === 5, 'пять матчей старой сетки', D.matches.length);
  ok(wrap.querySelectorAll('.match').length === 5, 'пять карточек', wrap.querySelectorAll('.match').length);
  ok(D.byId[4].team1 === 1, 'старая связь M1→M4 сработала', D.byId[4].team1);
  const heads = Array.from(wrap.querySelectorAll('.b-col-head b')).map((b) => b.textContent);
  ok(heads.length === 3, 'три колонки старой сетки', heads.join(' | '));
  ok(/Полуфинал/.test(heads.join(' ')), 'подписи старых раундов на месте', heads.join(' | '));
}

/* ============ F. Компактное превью и полноэкранный просмотр ============ */
console.log('\nF. Компактная сетка и окно просмотра');
{
  /* Главная при загрузке сама вызывает init() и render(), поэтому даём ей
     минимальный, но полный набор контейнеров: те блоки нам не интересны,
     но без них отрисовка упадёт. */
  const ids = ['heroKicker', 'heroTitle', 'heroLede', 'heroCta', 'heroStatus', 'cdDays', 'cdHours',
    'cdMinutes', 'cdSeconds', 'cdAnnounce', 'nmCount', 'streamSection', 'streamWaiting', 'streamLive',
    'streamBar', 'streamBarText', 'streamPoster', 'streamPosterTitle', 'streamPosterText', 'streamPlay',
    'streamNext', 'streamMiniTimer', 'streamFrame', 'streamToggle', 'bLegend', 'bracketKicker',
    'bracketCopy', 'eliminatedList', 'eliminatedCount', 'eliminatedSection', 'teamsGrid',
    'schedulePreviewList', 'archiveSection', 'archiveList', 'next-season', 'nextSeasonBody',
    'championSection', 'championBanner', 'champChip', 'champChipName', 'teamDialog', 'teamDialogLogo',
    'teamDialogName', 'teamDialogSub', 'teamDialogBody', 'teamDialogStats', 'phaseNote', 'toTop', 'dust',
    'bracketViewer', 'bracketViewerCanvas', 'bracketViewerInner', 'bracketViewerBracket',
    'bracketViewerSub', 'bracketViewerLegend', 'bracketViewerClose'];

  const dom = new JSDOM(
    '<!doctype html><html><body data-phase="pre">' +
    ids.filter((id) => id !== 'bracketViewerClose').map((id) => '<div id="' + id + '"></div>').join('') +
    '<button id="bracketViewerClose" type="button">Свернуть</button>' +
    '<div class="bracket-wrap" id="bracketWrapBox">' +
    '<div class="bracket-scroll" id="bracketScroll"><div class="bracket" id="bracketWrap"></div></div>' +
    '<button class="b-expand" id="bracketExpand" type="button">' +
    '<span class="b-expand-label">Развернуть сетку полностью</span></button>' +
    '</div></body></html>',
    {
      url: 'https://compassarena.ru/', pretendToBeVisual: true, runScripts: 'dangerously',
      virtualConsole: new VirtualConsole(),
      beforeParse(win) { win.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) }); }
    }
  );
  const w = dom.window;
  /* Скрытое окно: в разметке страницы это атрибут hidden */
  w.document.getElementById('bracketViewer').setAttribute('hidden', '');
  for (const f of ['assets/ca-ui.js', 'assets/ca-bracket-engine.js', 'assets/ca-data.js', 'assets/ca-views.js', 'assets/ca-bracket.js', 'assets/ca-home.js']) {
    w.eval(read(f));
  }
  await sleep(80);

  const raw = buildData(w, 10, 'de', { grandFinal: 'simple' });
  /* Зовём именно отрисовку сетки: остальные блоки главной в этом мини-DOM не нужны */
  w.CA.home.renderBracket(w.CA.data.setRaw(raw));
  await sleep(60);

  const box = w.document.getElementById('bracketWrapBox');
  const button = w.document.getElementById('bracketExpand');
  const viewer = w.document.getElementById('bracketViewer');
  const canvas = w.document.getElementById('bracketViewerCanvas');
  const host = w.document.getElementById('bracketViewerBracket');
  ok(!!box && !!button && !!viewer, 'есть превью, кнопка и окно просмотра');

  const cap = Number(box.getAttribute('data-cap'));
  ok(cap > 0 && cap <= 560, 'ограничитель по высоте посчитан', cap);
  ok(box.classList.contains('is-compact'), 'в превью сетка компактная');
  ok(viewer.hidden === true, 'окно просмотра по умолчанию закрыто');
  ok(/Развернуть/.test(button.textContent), 'на кнопке написано «Развернуть»', button.textContent.trim());

  button.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(80);
  ok(viewer.hidden === false, 'клик по кнопке открывает окно просмотра');
  ok(!!host.querySelector('.bracket'), 'внутри окна нарисована сетка');
  ok(host.querySelectorAll('.match').length === raw.matches.length, 'в окне все матчи',
    host.querySelectorAll('.match').length);
  ok((w.document.getElementById('bracketViewerSub').textContent || '').indexOf('10 команд') >= 0,
    'в шапке окна подписано число команд', w.document.getElementById('bracketViewerSub').textContent);
  ok(/Свернуть/.test(w.document.getElementById('bracketViewerClose').textContent),
    'в окне есть кнопка «Свернуть»');

  /* Закрытие кнопкой, фоном и Esc */
  w.document.getElementById('bracketViewerClose').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(40);
  ok(viewer.hidden === true, 'кнопка «Свернуть» закрывает окно');

  button.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(60);
  viewer.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(40);
  ok(viewer.hidden === true, 'клик по фону закрывает окно');

  button.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(60);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(40);
  ok(viewer.hidden === true, 'Esc закрывает окно');

  /* Перерисовка данных при открытом окне не должна его закрывать */
  button.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(60);
  w.CA.home.renderBracket(w.CA.data.get());
  await sleep(60);
  ok(viewer.hidden === false, 'перерисовка данных не закрывает окно');
  ok(host.querySelectorAll('.match').length === raw.matches.length, 'и не теряет матчи',
    host.querySelectorAll('.match').length);

  /* В окне доступны оба направления прокрутки (стили задаёт CSS, здесь — факт наличия) */
  ok(!!canvas, 'полотно окна прокручивается (контейнер на месте)');
  w.CA.home.closeBracketViewer();
  await sleep(30);
  ok(viewer.hidden === true, 'программное закрытие тоже работает');

  /* Для маленькой сетки ограничитель не должен схлопывать карточки */
  const smaller = buildData(w, 4, 'se');
  w.CA.home.renderBracket(w.CA.data.setRaw(smaller));
  await sleep(60);
  const smallCap = Number(box.getAttribute('data-cap'));
  ok(smallCap >= 120, 'для маленькой сетки ограничитель не схлопывает карточки', smallCap);
  w.close();
}

console.log(fails ? '\nПРОВАЛЕНО: ' + fails : '\nвсе проверки пройдены');
process.exit(fails ? 1 : 0);
