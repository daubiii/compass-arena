/* Движок универсальной сетки: генерация SE/DE для 4…16 команд,
   BYE, посев, связи (кто куда попадает), подписи стадий.
   Запуск: node tests/bracket-engine2.mjs */
import '../assets/ca-bracket-engine.js';

const E = globalThis.CA.bracketEngine;
let failed = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('  ok   ' + label);
  else { failed++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')); }
};

/* ---------- базовые функции ---------- */
console.log('\n1. Размер сетки, BYE и посев');
{
  ok(E.sizeFor(6) === 8 && E.sizeFor(10) === 16 && E.sizeFor(12) === 16, '10 и 12 команд → сетка на 16');
  ok(E.sizeFor(4) === 4 && E.sizeFor(16) === 16, 'степени двойки остаются как есть');
  ok(E.byesFor(6) === 2 && E.byesFor(10) === 6 && E.byesFor(16) === 0, 'число BYE считается верно');
  ok(JSON.stringify(E.seedingOrder(8)) === JSON.stringify([1, 8, 4, 5, 2, 7, 3, 6]),
    'классический порядок сеяных для 8', JSON.stringify(E.seedingOrder(8)));
  ok(JSON.stringify(E.seedPairs(4)) === JSON.stringify([[1, 4], [2, 3]]), 'пары первого раунда для 4',
    JSON.stringify(E.seedPairs(4)));
}

/* ---------- SE ---------- */
console.log('\n2. Single elimination: структура');
for (const count of [4, 6, 8, 10, 12, 14, 16]) {
  const b = E.generate({ teamCount: count, format: 'se', matchType: 'Bo3' });
  const desc = E.describe(b.matches);
  const size = E.sizeFor(count);
  ok(b.matches.length === size - 1, `${count} команд: матчей ${b.matches.length} (сетка на ${size} → ${size - 1})`,
    JSON.stringify(desc));
  ok(desc.upper === size - 2 && desc.grand === 1, `${count} команд: ${desc.upper} матчей раньше финала + финал`);
  const first = b.matches.filter((m) => m.round === 1);
  const seeded = first.reduce((n, m) => n + (m.team1 ? 1 : 0) + (m.team2 ? 1 : 0), 0);
  ok(seeded === count, `${count} команд расставлены в первом раунде (${seeded}), остальные слоты — BYE`,
    `${seeded} из ${count}`);
}

console.log('\n3. SE: BYE достаются первым сеяным, команды не дублируются');
{
  const b = E.generate({ teamCount: 6, format: 'se', matchType: 'Bo3' });
  const first = b.matches.filter((m) => m.round === 1);
  const byes = first.filter((m) => m.team1 === null || m.team2 === null);
  ok(first.length === 4, 'первый раунд: 4 пары', first.length);
  ok(byes.length === 2, 'две пары с BYE', byes.length);
  const seededNumbers = [];
  first.forEach((m) => { if (m.team1) seededNumbers.push(m.team1); if (m.team2) seededNumbers.push(m.team2); });
  ok(seededNumbers.length === 6 && new Set(seededNumbers).size === 6, 'все 6 команд расставлены по одному разу',
    JSON.stringify(seededNumbers));
  const byeTeams = byes.map((m) => m.team1 || m.team2);
  ok(byeTeams.every((s) => s <= 2), 'без игры проходят первые сеяные', JSON.stringify(byeTeams));
}

console.log('\n4. SE: матч за 3-е место');
{
  const withThird = E.generate({ teamCount: 8, format: 'se', matchType: 'Bo1', thirdPlace: true });
  const without = E.generate({ teamCount: 8, format: 'se', matchType: 'Bo1' });
  ok(withThird.matches.length === without.matches.length + 1, 'матч за 3-е место добавляет один матч');
  const third = withThird.matches.filter((m) => m.bracket === 'third')[0];
  ok(!!third && third.from1.as === 'l' && third.from2.as === 'l', 'в матч за 3-е место идут проигравшие полуфиналов',
    JSON.stringify(third && [third.from1, third.from2]));
  ok(withThird.matches.filter((m) => m.bracket === 'grand').length === 1, 'финал остаётся один');
}

/* ---------- DE ---------- */
console.log('\n5. Double elimination: структура');
/* Классическая схема: в нижнюю сетку падает каждый, кроме победителя верхней,
   поэтому матчей нижней ровно size − 2 (для 8 команд — 6, для 16 — 14). */
for (const count of [4, 6, 8, 10, 12, 14, 16]) {
  const size = E.sizeFor(count);
  const b = E.generate({ teamCount: count, format: 'de', matchType: 'Bo3', grandFinal: 'simple' });
  const desc = E.describe(b.matches);
  ok(desc.upper === size - 1, `${count} команд (DE, сетка ${size}): матчей верхней ${desc.upper} (размер − 1)`, desc.upper);
  ok(desc.lower === size - 2, `${count} команд (DE): матчей нижней ${desc.lower} (размер − 2)`, `ждали ${size - 2}`);
  ok(desc.grand === 1, `${count} команд (DE): один гранд-финал`, desc.grand);
  ok(desc.total === desc.upper + desc.lower + 1, `${count} команд (DE): всего матчей ${desc.total}`);
  ok(desc.total === 2 * size - 2, `${count} команд (DE): всего 2·${size} − 2 = ${2 * size - 2}`, desc.total);
  if (count === 8) {
    /* Классическая схема для 8 команд: LB1 — 2 матча, LB2 — 2, LB3 — 1, LB4 — 1 */
    const byRound = {};
    b.matches.filter((m) => m.bracket === 'lower').forEach((m) => { byRound[m.round] = (byRound[m.round] || 0) + 1; });
    ok(JSON.stringify(byRound) === JSON.stringify({ 1: 2, 2: 2, 3: 1, 4: 1 }),
      'DE-8: нижняя сетка 2 / 2 / 1 / 1', JSON.stringify(byRound));
  }
  if (count === 16) {
    const byRound = {};
    b.matches.filter((m) => m.bracket === 'lower').forEach((m) => { byRound[m.round] = (byRound[m.round] || 0) + 1; });
    ok(JSON.stringify(byRound) === JSON.stringify({ 1: 4, 2: 4, 3: 2, 4: 2, 5: 1, 6: 1 }),
      'DE-16: нижняя сетка 4 / 4 / 2 / 2 / 1 / 1', JSON.stringify(byRound));
  }
}

console.log('\n6. DE: гранд-финал «до двух поражений»');
{
  const simple = E.generate({ teamCount: 8, format: 'de', matchType: 'Bo3', grandFinal: 'simple' });
  const dbl = E.generate({ teamCount: 8, format: 'de', matchType: 'Bo3', grandFinal: 'double' });
  ok(dbl.matches.length === simple.matches.length + 1, 'добавляется матч сброса', dbl.matches.length - simple.matches.length);
  const reset = dbl.matches.filter((m) => m.resetFor)[0];
  ok(!!reset && reset.from1.as === 'w' && reset.from2.as === 'l', 'сброс играют победитель и проигравший первого финала',
    JSON.stringify(reset && [reset.from1, reset.from2]));
  ok(dbl.grandFinal.rule === 'double' && dbl.grandFinal.ids.length === 2, 'в описании два матча гранд-финала');
}

console.log('\n7. Связи: победитель идёт дальше, проигравший падает в нижнюю сетку');
{
  const b = E.generate({ teamCount: 8, format: 'de', matchType: 'Bo1', grandFinal: 'simple' });
  const dest = E.destinations(b.matches);
  const wbFirst = b.matches.filter((m) => m.bracket === 'upper' && m.round === 1);
  ok(wbFirst.every((m) => dest[m.id].winnerTo), 'у каждого матча первого раунда есть получатель победителя');
  ok(wbFirst.every((m) => dest[m.id].loserTo), 'у каждого матча первого раунда есть получатель проигравшего');
  const seedLosers = wbFirst.filter((m) => (m.team1 === null) !== (m.team2 === null));
  ok(seedLosers.length === 0, 'в 8 команд BYE нет — все матчи полноценные', seedLosers.length);
  const lower = b.matches.filter((m) => m.bracket === 'lower');
  ok(lower.every((m) => m.from1 || m.from2), 'все матчи нижней сетки заполняются из других матчей');

  /* у матчей с BYE проигравшего нет — получатель проигравшего не должен их ждать */
  const b6 = E.generate({ teamCount: 6, format: 'de', matchType: 'Bo1' });
  const dest6 = E.destinations(b6.matches);
  const byeMatches = b6.matches.filter((m) => m.round === 1 && m.bracket === 'upper' && (m.team1 === null || m.team2 === null));
  ok(byeMatches.length === 2, 'в сетке на 6 команд две пары с BYE', byeMatches.length);
  ok(byeMatches.every((m) => dest6[m.id].winnerTo), 'победитель BYE-пары всё равно идёт дальше');
}

console.log('\n8. Подписи стадий');
{
  const b = E.generate({ teamCount: 8, format: 'de', matchType: 'Bo3' });
  const labels = b.stageLabels;
  const upper = b.matches.filter((m) => m.bracket === 'upper');
  const lower = b.matches.filter((m) => m.bracket === 'lower');
  const grand = b.matches.filter((m) => m.bracket === 'grand');
  ok(upper.every((m) => typeof labels[m.id] === 'string' && labels[m.id].length > 0), 'у всех матчей верхней есть подпись');
  ok(labels[upper[upper.length - 1].id] === 'Финал верхней', 'последний матч верхней — «Финал верхней»',
    labels[upper[upper.length - 1].id]);
  ok(labels[lower[lower.length - 1].id] === 'Финал нижней', 'последний матч нижней — «Финал нижней»',
    labels[lower[lower.length - 1].id]);
  ok(labels[grand[0].id] === 'Гранд-финал', 'гранд-финал подписан', labels[grand[0].id]);
}

console.log('\n9. Совместимость с админкой и сайтом');
{
  const b = E.generate({ teamCount: 10, format: 'se', matchType: 'Bo5', thirdPlace: true });
  const required = ['id', 'round', 'bracket', 'team1', 'team2', 'winner', 'score1', 'score2', 'vod'];
  const bad = b.matches.filter((m) => required.some((k) => !(k in m)));
  ok(bad.length === 0, 'у всех матчей есть обязательные поля старого формата', bad.slice(0, 2));
  ok(b.matches.every((m, i) => m.id === i + 1), 'идентификаторы идут подряд с единицы');
  ok(b.format === 'se' && b.matchType === 'Bo5' && b.teamCount === 10 && b.size === 16,
    'в описании сетки сохранены формат, серии, число команд и размер',
    JSON.stringify({ format: b.format, matchType: b.matchType, teamCount: b.teamCount, size: b.size }));
}

console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nвсе проверки пройдены');
process.exit(failed ? 1 : 0);
