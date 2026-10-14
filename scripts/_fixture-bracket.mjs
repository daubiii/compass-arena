/* Временный генератор состояния для визуальной проверки сетки на локальном сервере.
   Запуск: node scripts/_fixture-bracket.mjs [команд] [se|de] */
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES } from '../tests/fixtures.mjs';

const ROOT = process.cwd();

/* Движок — обычный браузерный модуль, подключаем как глобальный */
globalThis.window = globalThis;
await import('file://' + path.join(ROOT, 'assets/ca-bracket-engine.js').replace(/\\/g, '/'));
const E = globalThis.CA.bracketEngine;

const teamCount = Number(process.argv[2] || 8);
const format = process.argv[3] === 'de' ? 'de' : 'se';

const base = JSON.parse(JSON.stringify(FIXTURES.post));
const names = ['Team Spirit', 'Team Liquid', 'Gaimin Gladiators', 'BetBoom Team', 'OG', 'Virtus.pro',
  'Tundra', 'Falcons', 'Nigma', 'Entity', 'Heroic', 'Alliance', 'Secret', 'NAVI', 'LGD', 'Aurora'];
const teams = names.slice(0, teamCount).map((name, i) => ({
  id: i + 1, name, logo: '', players: [{ nick: 'Игрок ' + (i + 1), role: 1 }]
}));

const plan = E.generate({ teamCount, format, matchType: 'Bo3', grandFinal: 'simple' });
plan.matches.forEach((m) => {
  if (m.round === 1 && m.bracket === 'upper') {
    /* team1/team2 — это уже номера сеяных, а не команды: расставляем по посеву */
    if (m.team1 !== null) m.team1 = teams[m.team1 - 1] ? teams[m.team1 - 1].id : null;
    if (m.team2 !== null) m.team2 = teams[m.team2 - 1] ? teams[m.team2 - 1].id : null;
  }
});
/* Один сыгранный матч, чтобы видеть подсветку победителя и счёт */
const first = plan.matches.filter((m) => m.round === 1 && m.bracket === 'upper')[0];
if (first && first.team1 && first.team2) {
  first.winner = first.team1;
  first.score1 = 2;
  first.score2 = 1;
}

base.teams = teams;
base.matches = plan.matches;
base.schedule = {};
base.tournament.matches = 'Bo3';
base.bracket = {
  format, teamCount, size: plan.size, matchType: 'Bo3',
  thirdPlace: false, grandFinal: format === 'de' ? 'simple' : null, byes: plan.byes,
  createdAt: new Date().toISOString()
};
base.history = [];

fs.writeFileSync(path.join(ROOT, 'tests/fixture-bracket.json'), JSON.stringify(base, null, 1), 'utf8');
console.log('готово: тестовое состояние ' + format.toUpperCase() + ' на ' + teamCount + ' команд, матчей ' + plan.matches.length);
