/* Сравниваем варианты раздачи BYE: сколько получается пар «команда vs BYE»
   (команда проходит) и пар «пусто vs пусто» (пустое окошко).
   Запуск: node scripts/_compare-bye.mjs */
import path from 'node:path';

globalThis.window = globalThis;
await import('file://' + path.join(process.cwd(), 'assets/ca-bracket-engine.js').replace(/\\/g, '/'));
const E = globalThis.CA.bracketEngine;

/** Как в движке: команды занимают слоты порядка по очереди */
function assignFirst(teamCount) {
  const size = E.sizeFor(teamCount);
  const order = E.seedingOrder(size);
  const map = {};
  let next = 1;
  order.forEach((seed) => { map[seed] = next <= teamCount ? next++ : null; });
  return { size, order, map };
}

/** Вариант «BYE в конце»: пустые слоты достаются последним позициям порядка */
function assignLast(teamCount) {
  const size = E.sizeFor(teamCount);
  const order = E.seedingOrder(size);
  const byes = size - teamCount;
  const map = {};
  order.forEach((seed, index) => { map[seed] = index < size - byes ? index + 1 : null; });
  return { size, order, map };
}

/** Вариант «слабейшие играют отбор»: BYE первым по порядку, но команды раздаются
    так, чтобы пары «команда vs BYE» были у сильных, а пустых пар не возникало */
function assignPlayIn(teamCount) {
  const size = E.sizeFor(teamCount);
  const order = E.seedingOrder(size);
  const pairs = E.seedPairs(size);
  const map = {};
  const byes = size - teamCount;
  /* BYE ставим в те пары, где уже есть сильная команда: идём по порядку и
     помечаем пустым тот слот, который стоит рядом с уже занятым */
  let left = byes;
  const slotOf = {};
  order.forEach((seed, index) => { slotOf[seed] = index; });
  pairs.forEach((p) => {
    if (left <= 0) return;
    /* пустым делаем «партнёра» сильного слота — тот, что идёт позже в порядке */
    const strong = p[0];
    const weak = p[1];
    if (left > 0) { map[weak] = null; left--; }
    void strong;
  });
  let next = 1;
  order.forEach((seed) => {
    if (map[seed] === null) return;
    map[seed] = next <= teamCount ? next++ : null;
  });
  return { size, order, map };
}

function stats(assignment) {
  const pairs = E.seedPairs(assignment.size).map((p) => [assignment.map[p[0]], assignment.map[p[1]]]);
  const withTeam = pairs.filter((p) => (p[0] == null) !== (p[1] == null)).length;
  const both = pairs.filter((p) => p[0] != null && p[1] != null).length;
  const empty = pairs.filter((p) => p[0] == null && p[1] == null).length;
  return { pairs, withTeam, both, empty };
}

for (const n of [3, 5, 6, 7, 10, 12, 14]) {
  console.log('\n' + n + ' команд, сетка на ' + E.sizeFor(n) + ':');
  for (const [name, fn] of [['как сейчас (первые слоты)', assignFirst], ['BYE в конце', assignLast], ['отбор (BYE рядом с сильными)', assignPlayIn]]) {
    const a = fn(n);
    const s = stats(a);
    console.log('  ' + name.padEnd(30) +
      ' реальных пар ' + s.both + ', пар с BYE ' + s.withTeam + ', пустых пар ' + s.empty +
      ' → видимых окошек ' + (s.both + s.withTeam) + ', пустых окошек ' + s.empty);
  }
}
