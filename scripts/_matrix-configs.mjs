/* Проверка всех настроек сетки: 4/6/8/10/12/14/16 команд × SE/DE, плюс матч
   за 3-е место и гранд-финал со сбросом. Для каждой конфигурации проверяем, что
   раскладка построилась, карточки не наложились, нижняя сетка ушла ниже верхней,
   а гранд-финал встал между финалами.
   Запуск: node scripts/_matrix-configs.mjs */
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

let fails = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')); }
};

const COUNTS = [4, 6, 8, 10, 12, 14, 16];
const MATCH_TYPES = ['Bo1', 'Bo3', 'Bo5'];

function build(n, format, extra) {
  const cfg = Object.assign({ teamCount: n, format, matchType: 'Bo3' }, extra || {});
  const plan = E.generate(cfg);
  const teams = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: 'Team ' + (i + 1), players: [], logo: '' }));
  const raw = {
    tournament: { name: 'Compass Arena', game: 'Dota 2', matches: cfg.matchType, dates: '' },
    teams: teams,
    matches: plan.matches,
    schedule: {},
    liveMatchId: null,
    tournamentStart: null,
    projectStart: null,
    bracket: { format: format, teamCount: n, size: plan.size, matchType: cfg.matchType,
      thirdPlace: !!cfg.thirdPlace, grandFinal: cfg.grandFinal || null, byes: plan.byes },
    history: []
  };
  const D = w.CA.data.setRaw(raw);
  const lay = w.CA.bracket.layout(D.matches);
  return { D: D, lay: lay, plan: plan };
}

function overlaps(lay) {
  const cards = Object.keys(lay.items).map((id) => ({ id: id, col: lay.items[id].col, row: lay.items[id].row, span: lay.items[id].span }));
  let bad = 0;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      if (a.col !== b.col) continue;
      if (a.row < b.row + b.span && b.row < a.row + a.span) bad++;
    }
  }
  return bad;
}

console.log('\n1. Single Elimination: все размеры и серии');
for (const n of COUNTS) {
  for (const mt of MATCH_TYPES) {
    const built = build(n, 'se', { matchType: mt });
    const lay = built.lay;
    const played = built.D.matches.filter((m) => !m.idle && m.team1 != null && m.team2 != null).length;
    ok(overlaps(lay) === 0 && lay.columnCount > 0 && lay.rows > 0,
      'SE ' + n + ' / ' + mt + ': колонок ' + lay.columnCount + ', рядов ' + lay.rows +
      ', матчей ' + built.D.matches.length + ', играются ' + played);
  }
}

console.log('\n2. Double Elimination: верхняя выше, нижняя ниже, финал между ними');
for (const n of COUNTS) {
  const built = build(n, 'de');
  const lay = built.lay;
  const upperRows = [], lowerRows = [];
  built.D.matches.forEach((m) => {
    const it = lay.items[m.id];
    if (!it) return;
    if (m.bracket === 'upper') upperRows.push(it.row);
    if (m.bracket === 'lower') lowerRows.push(it.row);
  });
  const maxUpper = Math.max.apply(null, upperRows);
  const minLower = Math.min.apply(null, lowerRows);
  ok(overlaps(lay) === 0, 'DE ' + n + ': наложений нет (' + built.D.matches.length + ' матчей)');
  ok(minLower > maxUpper - 1, 'DE ' + n + ': нижняя сетка ниже верхней (верх до ' + maxUpper + ', низ с ' + minLower + ')');

  const grand = built.D.matches.filter((m) => m.bracket === 'grand')[0];
  const gi = grand ? lay.items[grand.id] : null;
  const uf = built.D.matches.filter((m) => m.bracket === 'upper')
    .sort((a, b) => b.round - a.round)[0];
  const lf = built.D.matches.filter((m) => m.bracket === 'lower')
    .sort((a, b) => b.round - a.round)[0];
  const ui = uf ? lay.items[uf.id] : null;
  const li = lf ? lay.items[lf.id] : null;
  ok(!!gi && !!ui && !!li && gi.row > ui.row && gi.row < li.row,
    'DE ' + n + ': гранд-финал между финалами (верх ' + (ui && ui.row) + ', гранд ' + (gi && gi.row) +
    ', низ ' + (li && li.row) + ')');
}

console.log('\n3. Дополнительные настройки');
{
  const third = build(8, 'se', { thirdPlace: true });
  const thirdMatch = third.D.matches.filter((m) => m.bracket === 'third');
  const ti = thirdMatch[0] ? third.lay.items[thirdMatch[0].id] : null;
  ok(thirdMatch.length === 1 && !!ti, 'SE-8 + 3-е место: матч за третье место разложен',
    JSON.stringify(thirdMatch.map((m) => m.id)));
  ok(overlaps(third.lay) === 0, 'SE-8 + 3-е место: наложений нет');

  const reset = build(8, 'de', { grandFinal: 'double' });
  const grand = reset.D.matches.filter((m) => m.bracket === 'grand');
  const rows = grand.map((m) => reset.lay.items[m.id] && reset.lay.items[m.id].row).filter(Boolean);
  ok(grand.length === 2 && rows.length === 2 && rows[1] > rows[0],
    'DE-8 + сброс: два матча гранд-финала друг под другом', JSON.stringify(rows));
  ok(overlaps(reset.lay) === 0, 'DE-8 + сброс: наложений нет');

  const big = build(16, 'de', { grandFinal: 'double', matchType: 'Bo5' });
  ok(overlaps(big.lay) === 0, 'DE-16 Bo5 + сброс: наложений нет (рядов ' + big.lay.rows + ')');

  /* Только верхняя сетка: нижней нет — гранд-финал всё равно в раскладке */
  const noLower = build(8, 'de');
  noLower.D.matches = noLower.D.matches.filter((m) => m.bracket !== 'lower');
  const layNoLower = w.CA.bracket.layout(noLower.D.matches);
  const gm = noLower.D.matches.filter((m) => m.bracket === 'grand')[0];
  ok(overlaps(layNoLower) === 0 && !!layNoLower.items[gm.id],
    'без нижней сетки: раскладка строится, гранд-финал на месте');
}

console.log(fails ? '\nПРОВАЛЕНО: ' + fails : '\nвсе конфигурации разложились верно');
process.exit(fails ? 1 : 0);
