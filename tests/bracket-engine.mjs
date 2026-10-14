/* Движок сетки на клиенте: связи матчей, финал, подписи стадий, раскладка. Без браузера и зависимостей. */
import { normalizeBracket } from '../functions/_lib/challonge.js';
import { de8, se8 } from './challonge-fixtures.mjs';
await import('../assets/ca-data.js');
await import('../assets/ca-bracket.js');
const CA = globalThis.CA, D = CA.data;

let failed = 0;
const ok = (c, m, extra) => { if (!c) { failed++; console.error('✗', m, extra === undefined ? '' : extra); } else console.log('✓', m); };

const raw = (nb, over) => Object.assign({
  tournament: { name: 'T', game: 'CS:GO', matches: 'Bo3' }, teams: nb.teams, matches: nb.matches, schedule: {}
}, over || {});

/* ---- классическая сетка без связей получает их сама ---- */
{
  const teams = [1, 2, 3, 4, 5, 6].map((i) => ({ id: i, name: 'Team ' + i, players: [] }));
  const mk = (id, round, bracket, extra) => Object.assign({ id, round, bracket, team1: null, team2: null, winner: null, score1: null, score2: null }, extra);
  const d = D.finalize(D.normalize({ teams, matches: [
    mk(1, 1, 'upper', { team1: 1, team2: 2, winner: 1, score1: 2, score2: 0 }),
    mk(2, 1, 'upper', { team1: 3, team2: 4, winner: 4, score1: 1, score2: 2 }),
    mk(3, 1, 'upper', { team1: 5, team2: 6 }),
    mk(4, 2, 'upper'), mk(5, 3, 'grand')] }));
  ok(d.byId[4].team1 === 1 && d.byId[4].team2 === 4, 'M4 = победители M1 и M2 (связи по умолчанию)');
  ok(d.byId[5].team1 === null && d.byId[5].team2 === null, 'M5 ждёт M4 и M3');
  ok(D.stageLabel(d.byId[1]) === 'Раунд 1' && D.stageLabel(d.byId[4]) === 'Полуфинал' && D.stageLabel(d.byId[5]) === 'Гранд-финал', 'подписи стадий как раньше');
  D.setRaw({ teams, matches: d.matches });
  ok(D.slotLabel(D.get().byId[5], 2).text === 'Победитель M3', 'подсказка слота: «Победитель M3»');
  ok(d.grandFinal && d.grandFinal.id === 5, 'финал — M5');
  d.byId[4].winner = 1; // победитель, которого в паре нет и быть не может — но пока M4 не готов
  const d2 = D.finalize(D.normalize({ teams, matches: d.matches.map((m) => Object.assign({}, m, m.id === 4 ? { winner: 1, score1: 2, score2: 0 } : {})) }));
  ok(d2.byId[5].team1 === 1, 'победитель M4 проходит в M5');
}

/* ---- double elimination на 8 команд ---- */
{
  const nb = normalizeBracket(de8().tournament, []);
  const idOf = (name) => nb.teams.find((t) => t.name === name).id;
  const d = D.finalize(D.normalize(raw(nb)));
  const S = (id) => D.stageLabel(d.byId[id]);
  ok(S(101) === 'Верхняя сетка · раунд 1', 'подпись: верхняя сетка, раунд 1', S(101));
  ok(S(105) === 'Полуфинал верхней сетки' && S(107) === 'Финал верхней сетки', 'подписи верхней сетки');
  ok(S(108) === 'Нижняя сетка · раунд 1' && S(113) === 'Финал нижней сетки', 'подписи нижней сетки');
  ok(S(114) === 'Гранд-финал' && S(115) === 'Гранд-финал · сброс', 'гранд-финал и сброс');
  ok(D.colLabel(d.byId[107]) === 'Финал верхней' && D.stageShort(d.byId[108]) === 'Нижняя', 'короткие подписи для колонок и карточек');
  D.setRaw(raw(nb));
  ok(D.slotLabel(D.get().byId[110], 2).text === 'Проигравший M6', 'подсказка: проигравший падает в нижнюю сетку', D.slotLabel(D.get().byId[110], 2).text);
  ok(d.byId[108].team1 === idOf('Hotel') && d.byId[108].team2 === idOf('Echo'), 'проигравшие первого круга в нижней сетке', JSON.stringify([d.byId[108].team1, d.byId[108].team2]));
  ok(d.grandFinal && d.grandFinal.id === 115 && d.champion === null, 'пока играют — финал это «сброс», чемпиона нет');

  // сценарий: победитель верхней сетки выиграл первый гранд-финал → сброс не нужен
  const play = (m, w, s1, s2) => Object.assign({}, m, { winner: w, score1: s1, score2: s2 });
  const A = idOf('Alpha'), B = idOf('Bravo');
  const base = nb.matches.map((m) => Object.assign({}, m));
  const setM = (list, id, w) => list.map((m) => (m.id === id ? Object.assign({}, m, { winner: w, score1: 2, score2: 1 }) : m));
  // играем всё нужное до гранд-финала: верхняя сетка (A побеждает везде), нижняя (B выходит в финал нижней)
  let list = base;
  const t = (id, a, b) => { list = list.map((m) => (m.id === id ? Object.assign({}, m, { team1: a, team2: b }) : m)); };
  // чтобы не плодить 13 матчей руками, подставляем итоговых финалистов напрямую в гранд-финал и играем его
  list = list.map((m) => (m.id === 114 ? Object.assign({}, m, { from1: null, from2: null, team1: A, team2: B }) : m));
  let d3 = D.finalize(D.normalize(raw({ teams: nb.teams, matches: setM(list, 114, A) })));
  ok(d3.grandFinal.id === 114 && d3.champion && d3.champion.id === A, 'победил игрок верхней сетки → решает первый гранд-финал');
  d3 = D.finalize(D.normalize(raw({ teams: nb.teams, matches: setM(list, 114, B) })));
  ok(d3.grandFinal.id === 115 && d3.champion === null, 'победил игрок нижней сетки → нужен сброс, чемпиона ещё нет');
  let withReset = setM(list, 114, B).map((m) => (m.id === 115 ? Object.assign({}, m, { winner: A, score1: 2, score2: 0 }) : m));
  let d4 = D.finalize(D.normalize(raw({ teams: nb.teams, matches: withReset })));
  ok(d4.grandFinal.id === 115 && d4.champion && d4.champion.id === A, 'сброс сыгран → чемпион по нему');
  ok(d4.runnerUp && d4.runnerUp.id === B, 'финалист определён');
}

/* ---- single elimination с матчем за 3-е место ---- */
{
  const nb = normalizeBracket(se8().tournament, []);
  const d = D.finalize(D.normalize(raw(nb)));
  const S = (id) => D.stageLabel(d.byId[id]);
  ok(S(201) === 'Четвертьфинал' && S(205) === 'Полуфинал' && S(207) === 'Финал' && S(208) === 'Матч за 3-е место', 'подписи single elimination', [S(201), S(205), S(207), S(208)].join(' | '));
  ok(d.grandFinal && d.grandFinal.id === 207, 'финал — не матч за 3-е место');
}

/* ---- защита от циклов в связях ---- */
{
  const teams = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
  const m = (id, extra) => Object.assign({ id, round: 1, bracket: 'upper', team1: null, team2: null, winner: null }, extra);
  const t0 = Date.now();
  const d = D.finalize(D.normalize({ teams, matches: [
    m(1, { from1: { m: 2, as: 'w' }, from2: null, team2: 1 }),
    m(2, { from1: { m: 1, as: 'w' }, from2: null, team2: 2 })] }));
  ok(Date.now() - t0 < 500 && d.matches.length === 2, 'циклическая связь не вешает страницу');
}

/* ---- раскладка ---- */
function checkLayout(name, matches) {
  const lay = CA.bracket.layout(matches);
  const items = matches.map((m) => Object.assign({ id: m.id }, lay.items[m.id]));
  let overlap = null;
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.col === b.col && a.row < b.row + b.span && b.row < a.row + a.span) overlap = a.id + '×' + b.id;
  }
  ok(!overlap, name + ': карточки не накладываются', overlap);
  ok(items.every((x) => x.col >= 1 && x.col <= lay.cols && x.row >= 3), name + ': все в пределах сетки');
  // источники слева от получателей
  let wrong = null;
  matches.forEach((m) => [m.from1, m.from2].forEach((l) => {
    if (l && l.as === 'w' && lay.items[l.m] && lay.items[l.m].col >= lay.items[m.id].col) wrong = l.m + '→' + m.id;
  }));
  ok(!wrong, name + ': победители идут слева направо', wrong);
  return lay;
}
{
  const nb = normalizeBracket(de8().tournament, []);
  const d = D.finalize(D.normalize(raw(nb)));
  const lay = checkLayout('double elimination', d.matches);
  ok(lay.cols === 6, 'double elimination 8: 6 колонок (4 нижней сетки + гранд-финал и сброс)', lay.cols);
  ok(lay.items[114].col === 5 && lay.items[115].col === 6, 'гранд-финал и сброс — после нижней сетки');
  const up = lay.items[107].row, lo = lay.items[113].row, gf = lay.items[114].row;
  ok(gf > up && gf < lo + 1, 'гранд-финал между финалами верхней и нижней сеток');
  const nb2 = normalizeBracket(se8().tournament, []);
  const d2 = D.finalize(D.normalize(raw(nb2)));
  const lay2 = checkLayout('single elimination', d2.matches);
  ok(lay2.items[208].row > lay2.items[207].row, 'матч за 3-е место под финалом');
  ok(lay2.items[205].row === Math.round((lay2.items[201].row + lay2.items[202].row) / 2), 'полуфинал по центру между источниками');
}

console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nвсе проверки пройдены');
process.exit(failed ? 1 : 0);
