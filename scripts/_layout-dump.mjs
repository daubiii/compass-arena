/* Сводка раскладки: где оказалась каждая карточка (колонка/ряд) и нет ли
   наложений. Запуск: node scripts/_layout-dump.mjs [файл-фикстуры] */
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const fixture = process.argv[2] || 'tests/fixture-bracket.json';
const data = JSON.parse(fs.readFileSync(fixture, 'utf8'));

const dom = new JSDOM('<!doctype html><html><body><div id="bracketWrap"></div></body></html>', {
  url: 'https://x/', pretendToBeVisual: true, runScripts: 'dangerously', virtualConsole: new VirtualConsole()
});
const w = dom.window;
for (const f of ['assets/ca-ui.js', 'assets/ca-bracket-engine.js', 'assets/ca-data.js', 'assets/ca-bracket.js']) {
  w.eval(fs.readFileSync(f, 'utf8'));
}

const D = w.CA.data.setRaw(data);
const lay = w.CA.bracket.layout(D.matches);
const unit = lay.unit === undefined ? 0 : lay.unit;

console.log('колонок: ' + lay.columnCount + ' | дорожек: ' + lay.tracks.length +
  ' | рядов: ' + lay.rows + ' | ряд: ' + unit + 'px | высота ≈ ' + Math.round(lay.rows * unit) + 'px');
console.log('');

D.matches.slice().sort((a, b) => a.id - b.id).forEach((m) => {
  const it = lay.items[m.id];
  if (!it) { console.log('M' + m.id + ' — без позиции!'); return; }
  const src = (m.from1 ? (m.from1.as === 'l' ? 'L' : 'W') + m.from1.m : '—') + ' + ' +
    (m.from2 ? (m.from2.as === 'l' ? 'L' : 'W') + m.from2.m : '—');
  console.log(('M' + m.id).padEnd(5) + String(m.bracket).padEnd(7) + ('р.' + m.round).padEnd(5) +
    'col=' + String(it.col).padEnd(4) + 'row=' + String(it.row).padEnd(5) +
    '[' + (m.team1 == null ? '—' : m.team1) + ' / ' + (m.team2 == null ? '—' : m.team2) + ']' +
    '  ' + src + (m.idle ? '  idle' : '') + (m.bye ? '  bye' : ''));
});

/* Наложения: две карточки в одной колонке с пересечением по рядам */
const cards = Object.keys(lay.items).map((id) => ({ id: id, col: lay.items[id].col, row: lay.items[id].row, span: lay.items[id].span }));
let overlaps = 0;
for (let i = 0; i < cards.length; i++) {
  for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i], b = cards[j];
    if (a.col !== b.col) continue;
    if (a.row < b.row + b.span && b.row < a.row + a.span) {
      overlaps++;
      console.log('НАЛОЖЕНИЕ: M' + a.id + ' (ряд ' + a.row + ') и M' + b.id + ' (ряд ' + b.row + ')');
    }
  }
}
console.log('\nналожений: ' + overlaps);
process.exit(0);
