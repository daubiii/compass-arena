/* Проверка: админка генерирует сетку на N команд, сайт показывает то же самое.
   Требует запущенного локального сервера (npm run serve).
   Запуск: node scripts/_e2e-counts.mjs [N ...] */
import { JSDOM, VirtualConsole } from 'jsdom';

const BASE = process.env.CA_BASE || 'http://127.0.0.1:4173';

function withFetch(win) {
  win.fetch = (input, init) => {
    const raw = (input && typeof input === 'object' && input.url) ? input.url : String(input);
    let target = raw;
    try { target = new URL(raw, win.location.href).href; } catch { /* как есть */ }
    return fetch(target, init);
  };
}

async function bootAdmin() {
  const html = await (await fetch(BASE + '/poasalj1.z23.html')).text();
  const dom = new JSDOM(html, {
    url: BASE + '/poasalj1.z23.html', pretendToBeVisual: true, runScripts: 'dangerously',
    resources: 'usable', virtualConsole: new VirtualConsole(),
    beforeParse(win) { win.confirm = () => true; win.prompt = () => 'ebat'; win.alert = () => {}; withFetch(win); }
  });
  const w = dom.window;
  for (let i = 0; i < 80 && !(w.CA && w.CA.bracketEngine && w.DATA_READY); i++) await new Promise((r) => setTimeout(r, 100));
  return w;
}

async function generate(w, count, format) {
  w.document.getElementById('brTeamCount').value = String(count);
  w.document.getElementById('brFormat').value = format;
  w.document.getElementById('brMatchType').value = 'Bo3';
  const button = Array.from(w.document.querySelectorAll('#bracketCard button'))
    .filter((b) => /Сгенерировать сетку/.test(b.textContent))[0];
  button.click();
  await new Promise((r) => setTimeout(r, 700));
}

async function home(count, format) {
  const html = await (await fetch(BASE + '/')).text();
  const dom = new JSDOM(html, {
    url: BASE + '/', pretendToBeVisual: true, runScripts: 'dangerously', resources: 'usable',
    virtualConsole: new VirtualConsole(), beforeParse: withFetch
  });
  const w = dom.window;
  for (let i = 0; i < 80 && !(w.CA && w.CA.bracket && w.CA.data.get().fromServer); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 400));
  const cards = w.document.querySelectorAll('#bracketWrap .match').length;
  const heads = Array.from(w.document.querySelectorAll('#bracketWrap .b-col-head b')).map((b) => b.textContent);
  const data = await (await fetch(BASE + '/api/data')).json();
  return { cards, heads, data, kicker: (w.document.getElementById('bracketKicker') || {}).textContent };
}

const counts = process.argv.slice(2).map(Number).filter((n) => n >= 4);
const list = counts.length ? counts : [4, 6, 10, 16];
let fails = 0;

for (const count of list) {
  const format = count === 16 ? 'de' : 'se';
  const w = await bootAdmin();
  await generate(w, count, format);
  const h = await home(count, format);
  const expectedMatches = h.data.matches.length;
  const okCards = h.cards === expectedMatches;
  /* В локальном состоянии команд может быть меньше, чем слотов в сетке:
     свободные слоты — это BYE. Проверяем сами слоты сетки, а не заявки. */
  const slotCount = h.data.bracket ? h.data.bracket.teamCount : h.data.teams.length;
  const okTeams = slotCount === count;
  const okBracket = h.data.bracket && h.data.bracket.teamCount === count && h.data.bracket.format === format;
  if (!okCards || !okTeams || !okBracket) fails++;
  console.log((okCards && okTeams && okBracket ? 'ок   ' : 'ОШИБКА ') +
    count + ' команд ' + format.toUpperCase() +
    ': на сайте карточек ' + h.cards + ' из ' + expectedMatches +
    ', слотов в сетке ' + slotCount +
    ', bracket=' + (h.data.bracket ? h.data.bracket.format + '/' + h.data.bracket.teamCount : 'нет') +
    ' | колонки: ' + h.heads.join(' · ') +
    ' | подпись: ' + (h.kicker || '—'));
  w.close();
}

console.log(fails ? '\nпроблем: ' + fails : '\nвсе размеры отрисовались верно');
process.exit(fails ? 1 : 0);
