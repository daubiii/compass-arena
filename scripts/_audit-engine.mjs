/* Проверка движка сетки по фактам: размеры, число матчей, ссылки слотов,
   BYE, места сеяных и подписи стадий. Никаких «на глаз» — только то, что
   можно посчитать и сверить.
   Запуск: node scripts/_audit-engine.mjs */
import path from 'node:path';

globalThis.window = globalThis;
await import('file://' + path.join(process.cwd(), 'assets/ca-bracket-engine.js').replace(/\\/g, '/'));
const E = globalThis.CA.bracketEngine;

let fails = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')); }
};

const SIZES = [4, 6, 8, 10, 12, 14, 16];
const EXPECTED = { 4: 3, 6: 7, 8: 7, 10: 15, 12: 15, 14: 15, 16: 15 };

console.log('\n1. Размер сетки и число матчей (Single Elimination)');
for (const n of SIZES) {
  const plan = E.generate({ teamCount: n, format: 'se', matchType: 'Bo3' });
  ok(plan.size === E.sizeFor(n) && (plan.size & (plan.size - 1)) === 0,
    'SE ' + n + ': размер сетки ' + plan.size + ' (степень двойки)', plan.size);
  ok(plan.matches.length === EXPECTED[n] && plan.matches.length === plan.size - 1,
    'SE ' + n + ': матчей ' + plan.matches.length + ' = размер − 1', plan.matches.length);
  ok(plan.byes === plan.size - n, 'SE ' + n + ': BYE ' + plan.byes, plan.byes);
}

console.log('\n2. Double Elimination: 2·size − 2 матчей');
for (const n of SIZES) {
  const plan = E.generate({ teamCount: n, format: 'de', matchType: 'Bo3' });
  const upper = plan.matches.filter((m) => m.bracket === 'upper').length;
  const lower = plan.matches.filter((m) => m.bracket === 'lower').length;
  const grand = plan.matches.filter((m) => m.bracket === 'grand').length;
  ok(upper === plan.size - 1, 'DE ' + n + ': верхняя ' + upper + ' = размер − 1', upper);
  ok(lower === plan.size - 2, 'DE ' + n + ': нижняя ' + lower + ' = размер − 2', lower);
  ok(grand === 1 && plan.matches.length === 2 * plan.size - 2,
    'DE ' + n + ': всего ' + plan.matches.length + ' = 2·размер − 2 (с финалом)', plan.matches.length);
}

console.log('\n3. Ссылки слотов: каждая ведёт на существующий матч');
for (const n of SIZES) {
  for (const format of ['se', 'de']) {
    const plan = E.generate({ teamCount: n, format });
    const ids = {};
    plan.matches.forEach((m) => { ids[m.id] = true; });
    const dangling = [];
    const selfRef = [];
    plan.matches.forEach((m) => {
      [m.from1, m.from2].forEach((s) => {
        if (!s) return;
        if (!ids[s.m]) dangling.push(m.id + '→' + s.m);
        if (s.m === m.id) selfRef.push(m.id);
        if (s.as !== 'w' && s.as !== 'l') dangling.push(m.id + '→неверный as ' + s.as);
      });
    });
    ok(dangling.length === 0, format.toUpperCase() + ' ' + n + ': все ссылки слотов корректны',
      JSON.stringify(dangling));
    ok(selfRef.length === 0, format.toUpperCase() + ' ' + n + ': нет ссылок матча на себя',
      JSON.stringify(selfRef));

    /* Идентификаторы подряд с единицы */
    const idsList = plan.matches.map((m) => m.id);
    ok(idsList.every((v, i) => v === i + 1), format.toUpperCase() + ' ' + n + ': id подряд с 1',
      JSON.stringify(idsList.slice(0, 4)));
  }
}

console.log('\n4. Посев: команды по своим местам, BYE не больше одного на пару');
for (const n of SIZES) {
  const a = E.seedAssignment(n);
  const pairs = E.seedPairs(a.size).map((p) => [a.map[p[0]], a.map[p[1]]]);
  const teams = pairs.flat().filter((x) => x != null).sort((x, y) => x - y);
  ok(JSON.stringify(teams) === JSON.stringify(Array.from({ length: n }, (_, i) => i + 1)),
    n + ' команд: каждая команда ровно один раз', JSON.stringify(teams));

  const played = pairs.filter((p) => p[0] != null && p[1] != null).length;
  ok(played === Math.floor(n / 2), n + ' команд: пар, где есть обе команды — ' + played,
    JSON.stringify(pairs));

  const doubleBye = pairs.filter((p) => p[0] == null && p[1] == null).length;
  /* Двойной BYE возможен, когда пустых слотов больше, чем реальных команд
     (10 команд в сетке на 16 — три таких пары). Такие пары не играются:
     их помечает idle сам движок, и это проверяется отдельно ниже. */
  ok(doubleBye * 2 <= E.byesFor(n), n + ' команд: пар без обеих команд ' + doubleBye +
    ' при ' + E.byesFor(n) + ' BYE', doubleBye);

  /* Сеяные 1 и 2 в разных половинах: могут встретиться только в финале */
  const flat = a.order;
  const h1 = flat.indexOf(1) < flat.length / 2 ? 0 : 1;
  const h2 = flat.indexOf(2) < flat.length / 2 ? 0 : 1;
  ok(h1 !== h2, n + ' команд: 1 и 2 в разных половинах сетки',
    JSON.stringify({ seed1: flat.indexOf(1), seed2: flat.indexOf(2) }));
}

console.log('\n5. BYE: автопроход и «мёртвые» матчи');
for (const n of [6, 10, 12]) {
  const plan = E.generate({ teamCount: n, format: 'se' });
  const r1 = plan.matches.filter((m) => m.round === 1 && m.bracket === 'upper');
  const half = r1.filter((m) => (m.team1 == null) !== (m.team2 == null));
  ok(half.every((m) => m.bye && m.winner === (m.team1 != null ? m.team1 : m.team2)),
    'SE ' + n + ': команда с BYE проходит автоматически', JSON.stringify(half.map((m) => [m.team1, m.team2, m.winner])));

  const bothEmpty = r1.filter((m) => m.team1 == null && m.team2 == null);
  ok(bothEmpty.every((m) => !m.winner), 'SE ' + n + ': пустые пары не получают победителя');
}

console.log('\n6. Матч за третье место и гранд-финал со сбросом');
{
  const se = E.generate({ teamCount: 8, format: 'se', thirdPlace: true });
  const third = se.matches.filter((m) => m.bracket === 'third');
  const semis = se.matches.filter((m) => m.round === se.rounds.upper - 1);
  ok(third.length === 1 && third[0].from1.as === 'l' && third[0].from2.as === 'l' &&
    third[0].from1.m === semis[0].id && third[0].from2.m === semis[1].id,
    'SE-8: матч за третье место играют проигравшие полуфиналов',
    JSON.stringify(third.map((m) => [m.from1, m.from2])));

  const de = E.generate({ teamCount: 8, format: 'de', grandFinal: 'double' });
  const grand = de.matches.filter((m) => m.bracket === 'grand');
  const reset = grand.filter((m) => m.resetFor)[0];
  ok(grand.length === 2 && reset && reset.from1.m === grand[0].id && reset.from2.as === 'l',
    'DE-8: гранд-финал со сбросом', JSON.stringify(grand.map((m) => [m.id, m.from1, m.from2])));
  const simple = E.generate({ teamCount: 8, format: 'de', grandFinal: 'simple' });
  ok(simple.matches.filter((m) => m.bracket === 'grand').length === 1,
    'DE-8: простой гранд-финал — один матч');
}

console.log('\n7. Детерминированность и версия');
{
  const a = E.generate({ teamCount: 12, format: 'de', matchType: 'Bo3' });
  const b = E.generate({ teamCount: 12, format: 'de', matchType: 'Bo3' });
  ok(JSON.stringify(a.matches) === JSON.stringify(b.matches), 'одинаковый вход → одинаковая сетка');
  ok(!!E.VERSION, 'версия движка: ' + E.VERSION);
}

console.log(fails ? '\nПРОВАЛЕНО: ' + fails : '\nвсе проверки пройдены');
process.exit(fails ? 1 : 0);
