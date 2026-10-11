/* Проверка «как в браузере»: страница админки грузится по HTTP вместе со своими
   <script src>, генерация запускается кликом по кнопке, результат читается из
   /api/data (локальный сервер сохраняет состояние в память).
   Запуск: node tests/e2e-bracket.mjs   (нужен запущенный tests/server.mjs) */
import { JSDOM, VirtualConsole } from 'jsdom';

const BASE = process.env.CA_BASE || 'http://127.0.0.1:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** jsdom не умеет fetch сам — отдаём ему сетевой fetch из Node.
    Относительные адреса (/api/data) разворачиваем в абсолютные по адресу страницы. */
function withFetch(win) {
  win.fetch = (input, init) => {
    const raw = (input && typeof input === 'object' && input.url) ? input.url : String(input);
    let target = raw;
    try { target = new URL(raw, win.location.href).href; } catch { /* оставляем как есть */ }
    return fetch(target, init);
  };
}

let fails = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')); }
};

/* Достаём разметку админки как её отдаёт сервер */
const html = await (await fetch(BASE + '/poasalj1.z23.html')).text();

const dom = new JSDOM(html, {
  url: BASE + '/poasalj1.z23.html',
  pretendToBeVisual: true,
  runScripts: 'dangerously',
  resources: 'usable',
  virtualConsole: new VirtualConsole(),
  beforeParse(win) {
    win.confirm = () => true;
    win.prompt = () => 'pw';
    win.alert = () => {};
    withFetch(win);
  }
});
const w = dom.window;

/* Ждём, пока подгрузятся скрипты страницы (движок сетки идёт отдельным тегом)
   и админка получит данные с сервера */
for (let i = 0; i < 80; i++) {
  if (w.CA && w.CA.bracketEngine && w.DATA_READY === true) break;
  await sleep(100);
}

console.log('\nE2E: админка по HTTP + генерация сетки + сохранение в /api/data');
ok(!!(w.CA && w.CA.bracketEngine), 'движок сетки подключился своим <script src>');
ok(w.DATA_READY === true, 'данные с сервера загрузились', w.DATA_READY);
ok(w.document.querySelectorAll('#teamList .team-item').length > 0, 'команды отрисованы',
  w.document.querySelectorAll('#teamList .team-item').length);

/* Пользователь выбирает формат и жмёт кнопку «Сгенерировать сетку» */
const countEl = w.document.getElementById('brTeamCount');
const formatEl = w.document.getElementById('brFormat');
const matchEl = w.document.getElementById('brMatchType');
const teams = w.DATA.teams.filter((t) => t && t.name && !/^слот/i.test(t.name)).length;

countEl.value = String(teams >= 8 ? 8 : 6);
formatEl.value = 'de';
matchEl.value = 'Bo3';
formatEl.dispatchEvent(new w.Event('change', { bubbles: true }));

const button = Array.from(w.document.querySelectorAll('#bracketCard button'))
  .filter((b) => /Сгенерировать сетку/.test(b.textContent))[0];
ok(!!button, 'кнопка «Сгенерировать сетку» есть на вкладке настроек');
button.click();
await sleep(600);

const data = await (await fetch(BASE + '/api/data')).json();
ok(!!data.bracket, 'после клика сетка сохранена на сервере', JSON.stringify(data.bracket));
ok(data.bracket && data.bracket.format === 'de' && data.bracket.teamCount === Number(countEl.value),
  'в сохранённых настройках формат и число команд', JSON.stringify(data.bracket));
const upper = (data.matches || []).filter((m) => m.bracket === 'upper').length;
const lower = (data.matches || []).filter((m) => m.bracket === 'lower').length;
ok(upper > 0 && lower > 0, 'в сохранённой сетке есть верхняя и нижняя части', JSON.stringify([upper, lower]));
ok((data.matches || []).every((m) => 'from1' in m || 'from2' in m), 'у матчей сохранены источники слотов');

/* Главная страница читает те же данные и должна нарисовать сетку */
const home = await (await fetch(BASE + '/')).text();
const homeDom = new JSDOM(home, {
  url: BASE + '/', pretendToBeVisual: true, runScripts: 'dangerously', resources: 'usable',
  virtualConsole: new VirtualConsole(),
  beforeParse: withFetch
});
for (let i = 0; i < 40 && !(homeDom.window.CA && homeDom.window.CA.bracket); i++) await sleep(100);
await sleep(300);
const hw = homeDom.window;
const cards = hw.document.querySelectorAll('#bracketWrap .match').length;
ok(cards === (data.matches || []).length, 'главная отрисовала все матчи сохранённой сетки',
  JSON.stringify([cards, (data.matches || []).length]));
const heads = Array.from(hw.document.querySelectorAll('#bracketWrap .b-col-head b')).map((b) => b.textContent);
ok(heads.some((h) => /Нижняя/.test(h)), 'на главной есть колонки нижней сетки', heads.join(' | '));

/* Расписание тоже должно собраться из новой сетки */
const sched = await (await fetch(BASE + '/schedule.html')).text();
const schedDom = new JSDOM(sched, {
  url: BASE + '/schedule.html', pretendToBeVisual: true, runScripts: 'dangerously', resources: 'usable',
  virtualConsole: new VirtualConsole(),
  beforeParse: withFetch
});
await sleep(700);
const text = schedDom.window.document.getElementById('scheduleList').textContent;
ok(!/Загрузка/.test(text), 'расписание отрисовалось', text.slice(0, 80));

console.log(fails ? '\nПРОВАЛЕНО: ' + fails : '\nвсе проверки пройдены');
process.exit(fails ? 1 : 0);
