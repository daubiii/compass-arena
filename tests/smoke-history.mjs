/* Smoke-тест архива истории (history.html) в jsdom.
   Запуск: node tests/smoke-history.mjs   (из корня проекта) */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const TEAMS = [
  { id: 1, name: 'Team Spirit', logo: '', players: [{ nick: 'Yatoro', role: 1 }, { nick: 'Larl', role: 2 }] },
  { id: 2, name: 'Virtus.pro', logo: '', players: ['Nightfall', 'gpk'] },
  { id: 3, name: 'Team Liquid', logo: '', players: [{ nick: 'Nisha', role: 2 }] },
  { id: 4, name: 'OG', logo: '', players: [] },
  { id: 5, name: 'Gaimin Gladiators', logo: '', players: [{ nick: 'Quinn', role: 2 }] },
  { id: 6, name: 'BetBoom Team', logo: '', players: [] }
];
const M = (id, round, bracket, t1, t2, winner, s1, s2) => ({ id, round, bracket, team1: t1, team2: t2, winner, score1: s1, score2: s2 });

/* Текущий турнир — до старта, без чемпиона */
const PRE = {
  tournament: { name: 'Compass Arena', game: 'Dota 2', format: 'Custom Bracket', matches: 'Bo3', dates: '26 сентября 2026' },
  teams: TEAMS,
  matches: [M(1, 1, 'upper', 1, 2), M(2, 1, 'upper', 3, 4), M(3, 1, 'upper', 5, 6), M(4, 2, 'upper'), M(5, 3, 'grand', 1, 5)],
  schedule: {},
  liveMatchId: null,
  tournamentStart: '2030-09-26T12:00:00+03:00',
  projectStart: '2030-01-01T00:00:00+03:00',
  history: []
};

/* История из двух турниров: фото, MVP, полные серии */
const HIST = [
  {
    id: 'ca-2025-05-10',
    name: 'Compass Arena — весна 2025',
    date: '10.05.2025',
    createdAt: '2025-05-11T00:00:00Z',
    format: 'Custom Bracket · Bo3',
    game: 'Dota 2',
    teams: TEAMS,
    matches: [
      M(1, 1, 'upper', 1, 2, 1, 2, 0),
      M(2, 1, 'upper', 3, 4, 4, 1, 2),
      M(4, 2, 'upper', 1, 4, 1, 2, 1),
      M(5, 3, 'grand', 1, 5, 1, 2, 1)
    ],
    championId: 1,
    runnerUpId: 5,
    mvp: { teamId: 1, playerNick: 'Yatoro', note: 'Решающая игра на пятой позиции' },
    photos: [
      { url: 'https://cdn.example.com/s1-cover.jpg', caption: 'Финал весны 2025' },
      { url: 'https://cdn.example.com/s1-a.jpg', caption: 'Церемония награждения' }
    ]
  },
  {
    id: 'ca-2026-02-14',
    name: 'Compass Arena — зима 2026',
    date: '14.02.2026',
    createdAt: '2026-02-15T00:00:00Z',
    format: 'Custom Bracket · Bo3',
    game: 'Dota 2',
    teams: TEAMS,
    matches: [
      M(1, 1, 'upper', 1, 3, 3, 0, 2),
      M(2, 1, 'upper', 5, 6, 5, 2, 1),
      M(4, 2, 'upper', 3, 5, 5, 1, 2),
      M(5, 3, 'grand', 5, 1, 5, 2, 0)
    ],
    championId: 5,
    runnerUpId: 1,
    mvp: { teamId: 5, playerNick: 'Quinn', note: 'Лучший мидер серии' },
    photos: [
      { url: 'https://cdn.example.com/s2-cover.jpg', caption: 'Зимний финал' },
      { url: 'https://cdn.example.com/s2-a.jpg', caption: '' },
      { url: 'https://cdn.example.com/s2-b.jpg', caption: 'Болельщики на арене' },
      { url: 'https://cdn.example.com/s2-c.jpg', caption: 'Трофей' },
      { url: 'https://cdn.example.com/s2-d.jpg', caption: 'Состав чемпионов' }
    ]
  }
];

const WITH_HISTORY = { ...PRE, history: HIST };

function makeDom(file, fixture) {
  let html = read(file);
  html = html.replace(/<script src="[^"]+"[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://compassarena.ru/' + file, pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  w.fetch = async () => ({ ok: true, status: 200, json: async () => fixture });
  for (const f of ['ca-data.js', 'ca-ui.js', 'ca-views.js', 'ca-history.js']) {
    try { w.eval(read('assets/' + f)); }
    catch (e) { throw new Error(f + ': ' + e.message); }
  }
  return dom;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')); }
}

/* ================= (а) history пуст: только текущий сезон ================= */
console.log('\nhistory.html — пустая история (текущий сезон)');
{
  const dom = makeDom('history.html', PRE);
  const { window } = dom;
  await sleep(160);
  const d = window.document;
  const q = (s) => d.querySelector(s);

  ok(!!d.getElementById('ca-sprite'), 'спрайт иконок вставлен');
  ok(!!d.getElementById('ca-schema'), 'JSON-LD добавлен');
  ok(d.body.textContent.includes('История Compass Arena'), 'заголовок первого экрана');

  // текущий сезон — единственная глава
  ok(!!d.getElementById('ch-now'), 'блок текущего сезона отрисован');
  ok(d.body.textContent.includes('Сезон №1'), 'марка текущего сезона');
  ok(d.querySelectorAll('#chapters .now').length === 1, 'ровно один блок текущего сезона');
  ok(d.querySelectorAll('#books .ch').length === 0, 'глав архива нет');
  ok(d.getElementById('chapterNav').hidden === true, 'панель навигации скрыта при одной главе');
  ok(d.querySelectorAll('.h-chip').length === 0, 'чипов навигации нет');

  // цифры первого экрана
  const figs = d.querySelectorAll('#heroFigures .h-figure');
  ok(figs.length === 4, 'четыре сводные цифры', figs.length);
  ok(figs[0] && figs[0].textContent.includes('0'), 'ноль турниров в архиве', figs[0] && figs[0].textContent.trim());
  ok(figs[1] && figs[1].textContent.includes('5'), 'матчей текущего сезона — 5', figs[1] && figs[1].textContent.trim());
  ok(figs[2] && figs[2].textContent.includes('6'), 'команд — 6', figs[2] && figs[2].textContent.trim());
  ok(figs[3] && figs[3].textContent.includes('—'), 'действующий чемпион — прочерк', figs[3] && figs[3].textContent.trim());

  // пустое состояние текущего сезона
  ok(d.body.textContent.includes('До старта'), 'статус «До старта»');
  ok(d.querySelectorAll('#ch-now .now-team').length === 6, 'шесть участников', d.querySelectorAll('#ch-now .now-team').length);
  ok(!!q('#ch-now .now-bar i'), 'полоса прогресса есть');
  ok(!!q('#ch-now a[href="/#bracket"]') && !!q('#ch-now a[href="/schedule.html"]'), 'кнопки на сетку и расписание');

  // мёртвых зон нет
  ok(d.getElementById('summary') === null, 'сводки нет без истории');
  ok(d.getElementById('mvp') === null, 'витрины MVP нет');
  ok(d.querySelectorAll('.h-blank').length === 0, 'нет пустых заглушек');
  ok(d.querySelectorAll('img').length > 0 && Array.from(d.querySelectorAll('img')).every((i) => i.hasAttribute('alt')), 'у всех img есть alt');

  // ссылки «назад» с главной работают: якорь существует
  ok(!!d.getElementById('ch-ca-2025-05-10') === false, 'якорей архива нет (ожидаемо)');
}

/* ============ (б) история из двух турниров ============ */
console.log('\nhistory.html — архив из двух турниров');
{
  const dom = makeDom('history.html', WITH_HISTORY);
  const { window } = dom;
  await sleep(160);
  const d = window.document;

  // главы и якоря
  ok(d.querySelectorAll('#books .ch').length === 2, 'две главы архива', d.querySelectorAll('#books .ch').length);
  ok(!!d.getElementById('ch-ca-2025-05-10'), 'якорь #ch-ca-2025-05-10');
  ok(!!d.getElementById('ch-ca-2026-02-14'), 'якорь #ch-ca-2026-02-14');
  ok(!!d.getElementById('ch-now'), 'текущий сезон на месте');

  const ch1 = d.getElementById('ch-ca-2025-05-10');
  const ch2 = d.getElementById('ch-ca-2026-02-14');
  ok(ch1.textContent.includes('Compass Arena — весна 2025'), 'название первой главы');
  ok(ch1.textContent.includes('Турнир №1 из 02'), 'нумерация турниров', ch1.querySelector('.h-mark .no').textContent);
  ok(ch2.textContent.includes('Турнир №2 из 02'), 'последний турнир — №2', ch2.querySelector('.h-mark .no').textContent);
  ok(ch1.textContent.includes('Team Spirit'), 'чемпион первой главы');
  ok(ch1.textContent.includes('Yatoro'), 'состав чемпиона');
  ok(ch2.textContent.includes('Quinn'), 'состав второй главы');

  // MVP в главах
  ok(ch1.textContent.includes('Решающая игра на пятой позиции'), 'MVP-комментарий первой главы');
  ok(ch2.textContent.includes('Лучший мидер серии'), 'MVP-комментарий второй главы');

  // путь к титулу
  ok(ch2.querySelectorAll('.ch-row').length === 4, 'четыре сыгранные серии во второй главе', ch2.querySelectorAll('.ch-row').length);
  const rows = Array.from(ch2.querySelectorAll('.ch-row'));
  ok(rows[rows.length - 1].textContent.includes('Гранд-финал'), 'последняя серия — гранд-финал');
  ok(rows[rows.length - 1].textContent.includes('2:0'), 'счёт гранд-финала', rows[rows.length - 1].textContent.trim());
  ok(rows[rows.length - 1].querySelector('.win').textContent.includes('Gaimin Gladiators'), 'победитель гранд-финала');
  ok(rows[rows.length - 1].querySelector('.lose').textContent.includes('Team Spirit'), 'проигравший гранд-финала');

  // обложки: фото и типографика
  ok(!!ch1.querySelector('.ch-cover img'), 'обложка первой главы — фото');
  ok(ch1.querySelector('.ch-cover img').getAttribute('alt').length > 0, 'alt обложки заполнен', ch1.querySelector('.ch-cover img').getAttribute('alt'));
  ok(ch1.querySelector('.ch-cover img').getAttribute('src').includes('s1-cover.jpg'), 'первое фото стало обложкой');

  // галереи: обложка исключается из галереи
  const g1 = ch1.querySelector('.g-grid');
  const g2 = ch2.querySelector('.g-grid');
  ok(!!g1 && g1.querySelectorAll('.g-item').length === 1, 'галерея первой главы — 1 кадр', g1 && g1.querySelectorAll('.g-item').length);
  ok(!!g2 && g2.querySelectorAll('.g-item').length === 4, 'галерея второй главы — 4 кадра', g2 && g2.querySelectorAll('.g-item').length);
  ok(g2.classList.contains('n4'), 'галерея из четырёх кадров получила раскладку n4', g2 && g2.className);
  const gimgs = Array.from(d.querySelectorAll('.g-item img'));
  ok(gimgs.length === 5, 'всего пять кадров в галереях', gimgs.length);
  ok(gimgs.every((i) => (i.getAttribute('alt') || '').length > 0), 'у каждого кадра осмысленный alt');

  // панель навигации по главам
  const nav = d.getElementById('chapterNav');
  ok(nav.hidden === false, 'панель навигации видна');
  const chips = d.querySelectorAll('.h-chip');
  ok(chips.length === 3, 'три чипа в навигации', chips.length);
  ok(chips[1].getAttribute('data-target') === 'ch-ca-2025-05-10', 'чип ведёт на якорь главы', chips[1].getAttribute('data-target'));
  ok(chips[1].getAttribute('href') === '#ch-ca-2025-05-10', 'href чипа — якорь', chips[1].getAttribute('href'));
  ok(chips[0].getAttribute('data-target') === 'ch-now', 'первый чип — текущий сезон');

  // таблица чемпионов
  ok(!!d.getElementById('summary'), 'блок сводки отрисован');
  const tables = d.querySelectorAll('#summary table.tbl');
  ok(tables.length === 2, 'две сводные таблицы', tables.length);
  const champTable = d.querySelector('#summary .h-table-block .tbl');
  const clubTable = d.querySelectorAll('#summary .h-table-block .tbl')[1];
  const champRows = Array.from(champTable.querySelectorAll('tbody tr'));
  ok(champRows.length === 2, 'две строки в таблице чемпионов', champRows.length);
  ok(champRows[0].textContent.includes('Team Spirit'), 'чемпион первой строки');
  ok(champRows[1].textContent.includes('Gaimin Gladiators'), 'чемпион второй строки');
  ok(champRows[1].textContent.includes('2:0'), 'счёт финала во второй строке', champRows[1].textContent.trim());
  ok(champRows[0].querySelectorAll('td').length === 6, 'в строке шесть колонок', champRows[0].querySelectorAll('td').length);

  // таблица клубов и титулов
  const clubRows = Array.from(clubTable.querySelectorAll('tbody tr'));
  ok(clubRows.length > 0, 'таблица клубов и титулов не пуста', clubRows.length);
  ok(clubRows[0].textContent.includes('Gaimin Gladiators'), 'лидер по титулам и финалам — Gaimin Gladiators', clubRows[0].textContent.trim());
  ok(clubRows[0].querySelectorAll('td.num')[0].textContent.trim() === '1', 'один титул у Gaimin Gladiators', clubRows[0].querySelectorAll('td.num')[0].textContent);
  ok(clubRows[0].querySelectorAll('td.num')[1].textContent.trim() === '2', 'два финала у Gaimin Gladiators', clubRows[0].querySelectorAll('td.num')[1].textContent);
  const spiritRow = clubRows.filter((r) => r.textContent.includes('Team Spirit'))[0];
  ok(!!spiritRow, 'Team Spirit есть в таблице клубов');
  ok(spiritRow && spiritRow.querySelectorAll('td.num')[0].textContent.trim() === '1', 'один титул у Team Spirit', spiritRow && spiritRow.querySelectorAll('td.num')[0].textContent);
  ok(spiritRow && !/—/.test(spiritRow.querySelectorAll('td.num')[2].textContent), 'матчи Team Spirit посчитаны', spiritRow && spiritRow.querySelectorAll('td.num')[2].textContent);

  // витрина MVP
  const mvpSection = d.getElementById('mvp');
  ok(!!mvpSection, 'витрина MVP отрисована');
  const mvpCards = d.querySelectorAll('#mvp .h-mvp-card');
  ok(mvpCards.length === 2, 'две карточки MVP', mvpCards.length);
  ok(mvpCards[0].textContent.includes('Yatoro'), 'первый MVP — Yatoro');
  ok(mvpCards[0].textContent.includes('Весна 2025') || mvpCards[0].textContent.includes('весна 2025'), 'карточка MVP ссылается на турнир');
  ok(mvpCards[0].getAttribute('href') === '#ch-ca-2025-05-10', 'MVP ведёт на свою главу', mvpCards[0].getAttribute('href'));

  // JSON-LD
  const schema = JSON.parse(d.getElementById('ca-schema').textContent);
  ok(schema['@type'] === 'ItemList', 'JSON-LD — ItemList');
  ok(schema.itemListElement.length === 2, 'в ItemList два турнира', schema.itemListElement.length);
  ok(schema.itemListElement[0].url.includes('#ch-ca-2025-05-10'), 'URL первого элемента — якорь главы');
  ok(schema.itemListElement[1].item.winner.name === 'Gaimin Gladiators', 'победитель в JSON-LD', JSON.stringify(schema.itemListElement[1].item.winner));

  // лайтбокс
  const grid2 = ch2.querySelector('.g-grid');
  const third = grid2.querySelectorAll('.g-item')[2];
  third.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  const lbEl = d.getElementById('lb');
  ok(lbEl.classList.contains('active'), 'лайтбокс открылся по клику');
  ok(d.getElementById('lbCount').textContent.trim() === '3 / 4', 'счётчик лайтбокса', d.getElementById('lbCount').textContent);
  ok(d.getElementById('lbImg').getAttribute('alt').length > 0, 'alt картинки лайтбокса');
  d.getElementById('lbNext').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  ok(d.getElementById('lbCount').textContent.trim() === '4 / 4', 'переход вперёд по стрелке', d.getElementById('lbCount').textContent);
  d.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  ok(d.getElementById('lbCount').textContent.trim() === '3 / 4', 'переход назад по клавише');
  d.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(!lbEl.classList.contains('active'), 'лайтбокс закрылся по Esc');

  // шапка: прогресс текущего турнира и reveal-анимации
  ok((d.getElementById('headProgress').style.getPropertyValue('--p') || '') !== '', 'полоса прогресса турнира заполнена');
  ok(d.querySelectorAll('.reveal').length > 0, 'есть reveal-блоки');

  // ни одного пустого блока-обёртки
  ok(d.querySelectorAll('#books section').length === 4, 'в хронике 2 главы + сводка + витрина MVP', d.querySelectorAll('#books section').length);
}

/* ====== (в) глава без фото и без MVP — только цифры ====== */
console.log('\nhistory.html — глава без фото и MVP (пустое состояние архива)');
{
  const lean = {
    ...PRE,
    history: [{
      id: 'ca-lean', name: 'Compass Arena — тестовый сезон', date: '01.01.2025', createdAt: '2025-01-02T00:00:00Z',
      format: 'Single Elimination · Bo1', game: 'Dota 2', teams: TEAMS,
      matches: [M(1, 1, 'upper', 1, 2, 1, 1, 0), M(5, 3, 'grand', 1, 3, 1, 1, 0)],
      championId: 1, runnerUpId: 3, photos: []
    }]
  };
  const dom = makeDom('history.html', lean);
  const { window } = dom;
  await sleep(160);
  const d = window.document;
  const ch = d.getElementById('ch-ca-lean');
  ok(!!ch, 'глава без фото отрисована');
  ok(!!ch.querySelector('.ch-cover.is-flat'), 'типографическая обложка вместо фото');
  ok(ch.querySelector('.ch-cover.is-flat img') === null, 'в плоской обложке нет img');
  ok(ch.querySelectorAll('.g-grid').length === 0, 'галерея не рендерится вовсе');
  ok(d.querySelectorAll('#books .g-item').length === 0, 'ни одного кадра на странице');
  ok(ch.querySelectorAll('.ch-row').length === 2, 'путь к титулу из двух серий', ch.querySelectorAll('.ch-row').length);
  ok(d.getElementById('mvp') === null, 'витрины MVP нет без MVP');
  ok(ch.textContent.includes('MVP') === false, 'блок MVP не подмешивается', ch.textContent.includes('MVP'));
  ok(!!ch.textContent.match(/Финалист/), 'вместо MVP показан финалист');
  ok(d.getElementById('chapterNav').hidden === false, 'навигация из двух глав видна');
  ok(d.querySelectorAll('.h-chip').length === 2, 'два чипа', d.querySelectorAll('.h-chip').length);
  ok(!!d.getElementById('summary'), 'сводка по одной главе есть');
  ok(d.querySelectorAll('#summary table.tbl').length === 2, 'обе сводные таблицы на месте');
  const schema = JSON.parse(d.getElementById('ca-schema').textContent);
  ok(schema.itemListElement.length === 1, 'в JSON-LD один турнир', schema.itemListElement.length);
}

process.exit(fails ? 1 : 0);
