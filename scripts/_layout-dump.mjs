/* Раскладка сетки на фикстуре: печатает колонки, ряды и связи, чтобы глазами
   проверить арифметику без браузера. Запуск: node scripts/_layout-dump.mjs [файл] */
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const fixture = process.argv[2] || 'tests/fixture-bracket.json';
const data = JSON.parse(fs.readFileSync(fixture, 'utf8'));

const html = fs.readFileSync('index.html', 'utf8').replace(/<script src="[^"]+"[^>]*><\/script>/g, '');
const dom = new JSDOM(html, {
  url: 'https://x/', pretendToBeVisual: true, runScripts: 'dangerously',
  virtualConsole: new VirtualConsole(),
  beforeParse(w) { w.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) }); }
});
const w = dom.window;
for (const f of ['assets/ca-data.js', 'assets/ca-bracket-engine.js', 'assets/ca-ui.js', 'assets/ca-views.js', 'assets/ca-bracket.js', 'assets/ca-home.js']) {
  w.eval(fs.readFileSync(f, 'utf8'));
}
await new Promise((r) => setTimeout(r, 500));

const D = w.CA.data.get();
const lay = w.CA.bracket.layout(D.matches);
console.log('колонок: ' + lay.columnCount + ' · рядов: ' + lay.rows + ' · ряд = ' + lay.unit + 'px · высота ≈ ' + Math.round(lay.rows * lay.unit) + 'px');
console.log('карточка занимает 2 ряда = ' + (lay.unit * 2) + 'px (контент 116px + запас)');
console.log('');
const rows = D.matches.slice().sort((a, b) => a.id - b.id).map((m) => {
  const it = lay.items[m.id];
  if (!it) return { m: m.id, bad: true };
  const src = (m.from1 ? 'M' + m.from1.m + ':' + (m.from1.as === 'l' ? 'проигр' : 'побед') : '—') +
    ' + ' + (m.from2 ? 'M' + m.from2.m + ':' + (m.from2.as === 'l' ? 'проигр' : 'побед') : '—');
  return { id: m.id, bracket: m.bracket, round: m.round, col: it.col, row: it.row, span: it.span, src: src, team1: m.team1, team2: m.team2 };
});
rows.forEach((r) => {
  console.log(('M' + r.id).padEnd(4) + String(r.bracket).padEnd(6) + ('р.' + r.round).padEnd(4) +
    'col=' + String(r.col).padEnd(4) + 'row=' + String(r.row).padEnd(5) + 'span=' + String(r.span).padEnd(3) +
    '| ' + r.src + ' | команды: ' + r.team1 + '/' + r.team2);
});
/* Проверяем, что карточка-получатель стоит по центру источников */
const byId = {};
rows.forEach((r) => { byId[r.id] = r; });
let worst = 0;
rows.forEach((r) => {
  const m = D.byId[r.id];
  const srcs = [m.from1, m.from2].filter(Boolean).map((s) => byId[s.m]).filter(Boolean);
  if (!srcs.length) return;
  const center = (x) => x.row + x.span / 2;
  const avg = srcs.reduce((a, s) => a + center(s), 0) / srcs.length;
  const diff = Math.abs(avg - center(r));
  worst = Math.max(worst, diff);
});
console.log('\nмаксимальное смещение получателя от центра источников: ' + worst + ' ряда (0.5 = половина карточки)');
process.exit(0);
