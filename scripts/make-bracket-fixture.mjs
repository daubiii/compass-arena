/* ============================================================
   Генератор тестовой сетки для локального сервера
   ------------------------------------------------------------
   Строит настоящую сетку библиотекой (SE на 6 команд, Bo3),
   играет несколько матчей и кладёт результат в
   tests/bracket-fixture.json — локальный сервер отдаёт её
   в фикстуре 'brackets', чтобы страницу /brackets.html можно
   было смотреть без KV и деплоя.

   Запуск: npm run fixture:brackets
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { BracketsManager } from 'brackets-manager';
import { InMemoryDatabase } from 'brackets-memory-db';

const root = process.cwd();

const TEAMS = [
  { name: 'Team Spirit', logo: '', players: ['Yatoro', 'Larl', 'Collapse', 'Mira', 'Miposhka'] },
  { name: 'Team Liquid', logo: '', players: ['m1CKe', 'Nisha', '33', 'Boxi', 'Insania'] },
  { name: 'Gaimin Gladiators', logo: '', players: ['dyrachyo', 'Quinn', 'Ace', 'tOfu', 'Seleri'] },
  { name: 'BetBoom Team', logo: '', players: ['Pure', 'gpk', 'Save', 'TORONTOTOKYO', 'MieRo'] },
  { name: 'OG', logo: '', players: ['Yuragi', 'bzm', 'ATF', 'Taiga', 'Misha'] },
  { name: 'Virtus.pro', logo: '', players: ['Nightfall', 'Kiritych', 'Noticed', 'Save-', 'Fng'] }
];

const MATCH_TYPE = process.env.CA_MATCH_TYPE || 'Bo3';
const TYPE = process.env.CA_BRACKET_TYPE || 'single_elimination';
const TOURNAMENT_ID = 1;

const nextPow2 = (n) => { let s = 1; while (s < n) s *= 2; return s; };

const manager = new BracketsManager(new InMemoryDatabase());
const games = MATCH_TYPE === 'Bo1' ? 0 : Number(MATCH_TYPE.replace(/\D/g, ''));

const settings = {
  size: nextPow2(TEAMS.length),
  seedOrdering: ['inner_outer'],
  balanceByes: true,
  matchesChildCount: games
};
if (TYPE === 'double_elimination') settings.grandFinal = 'simple';

await manager.create.stage({
  name: 'Compass Arena — плей-офф',
  tournamentId: TOURNAMENT_ID,
  type: TYPE,
  seeding: TEAMS.map((t) => ({ name: t.name, logo: t.logo })),
  settings
});

/* Играем первый круг: первый матч — «сухой» 2:0, второй — 2:1, дальше не трогаем */
async function playMatch(match, scores) {
  const childGames = data.match_game.filter((g) => g.parent_id === match.id).sort((a, b) => a.number - b.number);
  if (childGames.length) {
    for (let i = 0; i < childGames.length; i++) {
      const pair = scores[i] || [0, 0];
      await manager.update.matchGame({
        id: childGames[i].id,
        opponent1: { score: pair[0] },
        opponent2: { score: pair[1] },
        status: 4
      });
    }
    return;
  }
  const [s1, s2] = scores[0];
  await manager.update.match({
    id: match.id,
    opponent1: { score: s1, result: s1 > s2 ? 'win' : 'loss' },
    opponent2: { score: s2, result: s2 > s1 ? 'win' : 'loss' }
  });
}

let data = await manager.get.tournamentData(TOURNAMENT_ID);
const ready = data.match.filter((m) => m.status === 2);
if (ready[0]) await playMatch(ready[0], [[2, 0], [2, 1], [2, 0]]);
data = await manager.get.tournamentData(TOURNAMENT_ID);
const readyNext = data.match.filter((m) => m.status === 2 && m.id !== (ready[0] && ready[0].id));
if (readyNext[0]) {
  await playMatch(readyNext[0], [[1, 2], [2, 0], [2, 1]]);
  // переворачиваем результат второй игры, чтобы серия вышла 2:1 в пользу второго
}

data = await manager.get.tournamentData(TOURNAMENT_ID);

const fixture = {
  brackets: {
    stages: data.stage,
    matches: data.match,
    matchGames: data.match_game,
    participants: data.participant
  },
  bracketsMeta: {
    name: 'Compass Arena — плей-офф',
    type: TYPE,
    matchType: MATCH_TYPE,
    grandFinal: TYPE === 'double_elimination' ? 'simple' : null,
    thirdPlace: false,
    teamCount: TEAMS.length,
    bracketSize: nextPow2(TEAMS.length),
    savedAt: new Date().toISOString(),
    teams: TEAMS.map((t, i) => ({ name: t.name, logo: t.logo, players: t.players.map((nick) => ({ nick })) }))
  }
};

const out = path.join(root, 'tests/bracket-fixture.json');
fs.writeFileSync(out, JSON.stringify(fixture, null, 1), 'utf8');
console.log('✓ ' + path.relative(root, out) +
  ' — ' + TYPE + ', ' + MATCH_TYPE + ', команд ' + TEAMS.length +
  ', матчей ' + data.match.length + ', игр ' + data.match_game.length +
  ', размер ' + Math.round(JSON.stringify(fixture).length / 1024) + ' КБ');
