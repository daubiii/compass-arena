// Список дисциплин на сервере. Должен совпадать с assets/ca-games.js
// (за этим следит tests/games.mjs). Dota 2 хранится в старом ключе `tournament`.
export const GAMES = {
  dota2: { name: 'Dota 2' },
  csgo: { name: 'CS:GO' },
  clash: { name: 'Clash Royale' },
  brawl: { name: 'Brawl Stars' }
};
export const DEFAULT_GAME = 'dota2';

export function gameFrom(value) {
  const id = String(value == null || value === '' ? DEFAULT_GAME : value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(GAMES, id) ? id : null;
}

/** Ключ KV с данными турнира игры */
export function tournamentKey(game) {
  return game === DEFAULT_GAME ? 'tournament' : 'tournament:' + game;
}
