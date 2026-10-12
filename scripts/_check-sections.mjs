/* Проверка выравнивания блоков: печатает ряды финалов и гранд-финала,
   чтобы подобрать отступ между верхней и нижней сеткой.
   Запуск: node scripts/_check-sections.mjs */
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="bracketWrap"></div></body></html>', {
  url: 'https://x/', pretendToBeVisual: true, runScripts: 'dangerously', virtualConsole: new VirtualConsole()
});
const w = dom.window;
for (const f of ['assets/ca-ui.js', 'assets/ca-bracket-engine.js', 'assets/ca-data.js', 'assets/ca-bracket.js']) {
  w.eval(fs.readFileSync(f, 'utf8'));
}
const E = w.CA.bracketEngine;

for (const n of [4, 6, 8, 10, 12, 14, 16]) {
  const plan = E.generate({ teamCount: n, format: 'de', matchType: 'Bo3' });
  const teams = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: 'T' + (i + 1) }));
  const D = w.CA.data.setRaw({
    tournament: { name: 'x', game: 'Dota 2', matches: 'Bo3' },
    teams: teams,
    matches: plan.matches,
    schedule: {},
    bracket: { format: 'de', teamCount: n, size: plan.size, matchType: 'Bo3' },
    history: []
  });
  const lay = w.CA.bracket.layout(D.matches);
  const upper = D.matches.filter((m) => m.bracket === 'upper');
  const lower = D.matches.filter((m) => m.bracket === 'lower');
  const grand = D.matches.filter((m) => m.bracket === 'grand');
  const upperFinal = upper.filter((m) => m.round === Math.max.apply(null, upper.map((x) => x.round)))[0];
  const lowerFinal = lower.filter((m) => m.round === Math.max.apply(null, lower.map((x) => x.round)))[0];
  const it = (m) => (m && lay.items[m.id] ? lay.items[m.id].row : '—');
  const gap = (typeof it(upperFinal) === 'number' && typeof it(lowerFinal) === 'number')
    ? it(lowerFinal) - it(upperFinal) : '—';
  console.log(String(n).padStart(2) + ' команд: верхняя финал M' + (upperFinal ? upperFinal.id : '—') + ' ряд ' + it(upperFinal) +
    ' | нижняя финал M' + (lowerFinal ? lowerFinal.id : '—') + ' ряд ' + it(lowerFinal) +
    ' | разрыв ' + gap +
    ' | гранд M' + (grand[0] ? grand[0].id : '—') + ' ряд ' + it(grand[0]) +
    ' | всего рядов ' + lay.rows);
}
process.exit(0);
