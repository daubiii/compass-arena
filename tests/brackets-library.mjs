/* Настоящая библиотека сетки: генерация для 4/6/8/12/16 команд, SE и DE,
   Bo1/Bo3/Bo5, BYE, связи между матчами, размер данных для KV.
   Запуск: node tests/brackets-library.mjs
   Требует установленных devDependencies (npm install). */
import { BracketsManager } from 'brackets-manager';
import { InMemoryDatabase } from 'brackets-memory-db';

let failed = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('  ok   ' + label);
  else { failed++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')); }
};

const nextPow2 = (n) => { let s = 1; while (s < n) s *= 2; return s; };
const teams = (n) => Array.from({ length: n }, (_, i) => ({ name: 'Team ' + (i + 1), logo: '' }));

async function build({ count, type, matchType, grandFinal, thirdPlace }) {
  const manager = new BracketsManager(new InMemoryDatabase());
  const games = matchType === 'Bo1' ? 0 : Number(matchType.replace(/\D/g, ''));
  const settings = {
    size: nextPow2(count),
    seedOrdering: ['inner_outer'],
    balanceByes: true,
    matchesChildCount: games
  };
  if (type === 'double_elimination') settings.grandFinal = grandFinal || 'simple';
  else if (thirdPlace) settings.consolationFinal = true;

  const stage = await manager.create.stage({
    name: 'CA test',
    tournamentId: 1,
    type,
    seeding: teams(count),
    settings
  });
  const data = await manager.get.tournamentData(1);
  return { manager, stage, data };
}

console.log('\n1. Размеры и типы сеток');
for (const count of [4, 6, 8, 12, 16]) {
  for (const type of ['single_elimination', 'double_elimination']) {
    const { data, stage } = await build({ count, type, matchType: 'Bo3' });
    const size = nextPow2(count);
    const byes = data.participant.filter((p) => p && p.name === 'BYE').length;
    const sizeOk = stage.settings.size === size;
    const participantsOk = data.participant.length === count;
    const matchesOk = data.match.length > 0;
    ok(sizeOk && participantsOk && matchesOk,
      `${count} команд · ${type === 'single_elimination' ? 'SE' : 'DE'}: размер ${stage.settings.size}, участников ${data.participant.length}, матчей ${data.match.length}`,
      JSON.stringify({ size: stage.settings.size, byes }));
    if (count === 6) {
      ok(byes === 0, '  BYE не создаётся как участник (пустой слот — opponent === null)', byes);
    }
  }
}

console.log('\n2. BYE: 6 команд в сетке на 8');
{
  const { data } = await build({ count: 6, type: 'single_elimination', matchType: 'Bo1' });
  const firstRound = data.match.filter((m) => m.round_id === Math.min(...data.match.map((x) => x.round_id)));
  const emptySlots = firstRound.filter((m) => !m.opponent1 || !m.opponent2 || m.opponent1.id === null || m.opponent2.id === null);
  ok(firstRound.length === 4, 'в первом раунде четыре пары', firstRound.length);
  ok(emptySlots.length === 2, 'две пары с BYE (пустым слотом)', emptySlots.length);
  const winners = emptySlots.filter((m) => (m.opponent1 && m.opponent1.result === 'win') || (m.opponent2 && m.opponent2.result === 'win'));
  ok(winners.length === 2, 'у соперника BYE сразу проставлена победа', winners.length);
}

console.log('\n3. Bo1 / Bo3 / Bo5');
for (const [matchType, games] of [['Bo1', 0], ['Bo3', 3], ['Bo5', 5]]) {
  const { data, stage } = await build({ count: 8, type: 'single_elimination', matchType });
  const total = data.match.reduce((sum, m) => sum + (Number(m.child_count) || 0), 0);
  ok(stage.settings.matchesChildCount === games, `${matchType}: matchesChildCount = ${games}`, stage.settings.matchesChildCount);
  ok(total === data.match.length * games, `${matchType}: игр внутри матчей — ${total}`, total);
}

console.log('\n4. Double elimination: нижняя сетка и гранд-финал');
{
  const simple = await build({ count: 8, type: 'double_elimination', matchType: 'Bo1', grandFinal: 'simple' });
  const groups = simple.data.group.map((g) => g.number).sort();
  ok(JSON.stringify(groups) === JSON.stringify([1, 2, 3]), 'DE-8: три группы (верхняя, нижняя, финал)', JSON.stringify(groups));
  // group.number: 1 — верхняя сетка (id 0), 2 — нижняя (id 1), 3 — гранд-финал (id 2)
  const wb = simple.data.match.filter((m) => m.group_id === 0);
  const lb = simple.data.match.filter((m) => m.group_id === 1);
  const gf = simple.data.match.filter((m) => m.group_id === 2);
  ok(wb.length === 7 && lb.length === 6 && gf.length === 1, 'DE-8: 7 матчей верхней, 6 нижней, 1 гранд-финал',
    JSON.stringify([wb.length, lb.length, gf.length]));

  const dbl = await build({ count: 8, type: 'double_elimination', matchType: 'Bo1', grandFinal: 'double' });
  const gf2 = dbl.data.match.filter((m) => m.group_id === 2);
  ok(gf2.length === 2, 'гранд-финал «до двух поражений» — два матча (финал + сброс)', gf2.length);
}

console.log('\n5. Матч за 3-е место (только SE)');
{
  const withThird = await build({ count: 8, type: 'single_elimination', matchType: 'Bo1', thirdPlace: true });
  const without = await build({ count: 8, type: 'single_elimination', matchType: 'Bo1', thirdPlace: false });
  ok(withThird.data.match.length === without.data.match.length + 1,
    'с матчем за 3-е место матчей на один больше',
    JSON.stringify([withThird.data.match.length, without.data.match.length]));
}

console.log('\n6. Связи: победитель идёт дальше, проигравший падает в нижнюю сетку');
{
  const { manager, data } = await build({ count: 8, type: 'double_elimination', matchType: 'Bo1', grandFinal: 'simple' });
  // играем готовый матч верхней сетки (status 2 = Ready)
  const first = data.match.filter((m) => m.group_id === 0 && m.status === 2)[0];
  ok(!!first, 'есть готовый матч верхней сетки');
  const p1 = first.opponent1.id;
  const p2 = first.opponent2.id;
  await manager.update.match({
    id: first.id,
    opponent1: { score: 2, result: 'win' },
    opponent2: { score: 0, result: 'loss' }
  });

  const next = await manager.find.nextMatches(first.id);
  ok(next.length >= 2, 'у матча верхней сетки есть продолжения (победителю и проигравшему)', next.length);
  const after = await manager.get.matches({ id: first.id });
  const updated = after[0];
  ok(updated.status === 4 && updated.opponent1.result === 'win', 'матч закрылся, победитель помечен win', JSON.stringify(updated.opponent1));

  const all = await manager.get.tournamentData(1);
  const usesP1 = all.match.filter((m) => m.id !== first.id && ((m.opponent1 && m.opponent1.id === p1) || (m.opponent2 && m.opponent2.id === p1)));
  ok(usesP1.length === 1, 'победитель автоматически подставлен ровно в один следующий матч', usesP1.length);
  const usesP2 = all.match.filter((m) => m.id !== first.id && ((m.opponent1 && m.opponent1.id === p2) || (m.opponent2 && m.opponent2.id === p2)));
  ok(usesP2.length === 1, 'проигравший попал в нижнюю сетку', usesP2.length);
  ok(usesP2[0].group_id === 1, 'проигравший именно в нижней сетке (вторая группа)', usesP2[0].group_id);
}

console.log('\n7. Размер данных для KV');
for (const [count, type] of [[16, 'single_elimination'], [16, 'double_elimination'], [32, 'double_elimination']]) {
  const { data } = await build({ count, type, matchType: 'Bo5' });
  const json = JSON.stringify({ stages: data.stage, matches: data.match, matchGames: data.match_game, participants: data.participant });
  const kb = Math.round(json.length / 1024);
  ok(json.length < 20 * 1024 * 1024, `${count} команд · ${type === 'single_elimination' ? 'SE' : 'DE'} · Bo5: ${kb} КБ (лимит KV 25 МБ)`);
}

console.log('\n8. Ошибки: размер не степень двойки и числовое сеяние');
{
  const manager = new BracketsManager(new InMemoryDatabase());
  let err = null;
  try {
    await manager.create.stage({ name: 'bad', tournamentId: 1, type: 'single_elimination', seeding: teams(6), settings: { size: 7 } });
  } catch (e) { err = e; }
  ok(!!err && /power of two/i.test(String(err.message)), 'size не степень двойки → понятная ошибка', err && err.message);

  let err2 = null;
  try {
    await manager.create.stage({ name: 'bad', tournamentId: 2, type: 'single_elimination', seeding: [10, 11, 12, 13], settings: { size: 4 } });
  } catch (e) { err2 = e; }
  ok(!!err2, 'несуществующие id участников → ошибка', err2 && err2.message);
}

console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nвсе проверки пройдены');
process.exit(failed ? 1 : 0);
