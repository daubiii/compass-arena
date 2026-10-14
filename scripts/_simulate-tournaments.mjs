/* Сквозная проверка логики сетки: «играет» турнир до конца на всех размерах и форматах.
   Для каждой настройки: пока есть матч с двумя известными командами — задаём победителя
   (чередуем сильнейшего и случайного), затем проверяем, что ничего не застряло:
   все играбельные матчи сыграны, чемпион один, победитель каждой команды учтён.
   Запуск: node scripts/_simulate-tournaments.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
let fails = 0;
const ok = (c, l, x) => { if (!c) { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' → ' + x : '')); } };

const dom = new JSDOM('<!doctype html><body data-phase="pre"></body>', {
  url: 'https://compassarena.ru/', pretendToBeVisual: true, runScripts: 'dangerously', virtualConsole: new VirtualConsole(),
  beforeParse(win) { win.fetch = async () => ({ ok: true, json: async () => ({}) }); }
});
const w = dom.window;
for (const f of ['assets/ca-ui.js', 'assets/ca-bracket-engine.js', 'assets/ca-data.js', 'assets/ca-bracket.js']) w.eval(read(f));

let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

function run(n, format, extra, flipFinal) {
  const label = format.toUpperCase() + ' ' + n + ' ' + JSON.stringify(extra || {}) + (flipFinal ? ' (нижний берёт гранд)' : '');
  const teams = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: 'T' + (i + 1), players: [], logo: '' }));
  const plan = w.CA.bracketEngine.generate(Object.assign({ teamCount: n, format, matchType: 'Bo3' }, extra || {}));
  plan.matches.forEach((m) => {
    if (m.round === 1 && m.bracket === 'upper') {
      if (m.team1 !== null) m.team1 = teams[m.team1 - 1] ? teams[m.team1 - 1].id : null;
      if (m.team2 !== null) m.team2 = teams[m.team2 - 1] ? teams[m.team2 - 1].id : null;
    }
  });
  const raw = {
    tournament: { name: 'X', game: 'Dota 2', format: 'Bracket', matches: 'Bo3', dates: '' }, teams, matches: plan.matches,
    schedule: {}, liveMatchId: null, tournamentStart: null, projectStart: null, history: [],
    bracket: { format, teamCount: n, size: plan.size, matchType: 'Bo3', thirdPlace: !!(extra && extra.thirdPlace),
      grandFinal: (extra && extra.grandFinal) || (format === 'de' ? 'simple' : null), byes: plan.byes }
  };
  let D = w.CA.data.setRaw(raw);
  let guard = 0;
  while (guard++ < 200) {
    const next = D.matches.find((m) => !m.winner && !m.idle && m.team1 && m.team2);
    if (!next) break;
    const raws = raw.matches.find((m) => m.id === next.id);
    let win = next.team1;
    if (next.bracket === 'grand' && !next.resetFor && flipFinal) {
      /* у гранд-финала побеждает тот, кто пришёл из нижней сетки (второй слот) */
      win = next.team2;
    } else if (rnd() > 0.5) win = next.team2;
    raws.winner = win; raws.score1 = win === next.team1 ? 2 : 0; raws.score2 = win === next.team1 ? 0 : 2;
    D = w.CA.data.setRaw(raw);
  }
  ok(guard < 200, label + ': цикл завершился');
  const unplayed = D.matches.filter((m) => !m.winner && !m.idle);
  /* Матч сброса может остаться несыгранным, если первый финал выиграл верхний */
  ok(unplayed.length === 0, label + ': все матчи сыграны', unplayed.map((m) => 'M' + m.id + '(' + m.team1 + ',' + m.team2 + ')').join(' '));
  const finals = D.matches.filter((m) => m.bracket === 'grand' && m.winner);
  ok(finals.length >= 1, label + ': есть победитель финала');
  /* Каждая команда проиграла не больше N раз: SE — 1, DE — 2 */
  const losses = {};
  D.matches.forEach((m) => {
    if (!m.winner || m.bye || m.bracket === 'third') return;
    const l = m.winner === m.team1 ? m.team2 : m.team1;
    if (l) losses[l] = (losses[l] || 0) + 1;
  });
  const cap = format === 'de' ? 2 : 1;
  ok(Object.values(losses).every((v) => v <= cap), label + ': лимит поражений не превышен', JSON.stringify(losses));
  /* Раскладка корректна */
  const lay = w.CA.bracket.layout(D.matches);
  const its = Object.values(lay.items);
  let bad = null;
  its.forEach((a, i) => its.slice(i + 1).forEach((b) => {
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) bad = a.id + '×' + b.id;
  }));
  ok(!bad && its.length === D.matches.length, label + ': раскладка без наложений', bad);
}

for (const n of [4, 6, 8, 10, 12, 14, 16]) {
  run(n, 'se'); run(n, 'se', { thirdPlace: true });
  run(n, 'de', { grandFinal: 'simple' });
  run(n, 'de', { grandFinal: 'double' }); run(n, 'de', { grandFinal: 'double' }, true);
}
console.log(fails ? '\nПРОВАЛЕНО: ' + fails : 'симуляция: все настройки доиграны до конца без застревания');
process.exit(fails ? 1 : 0);
