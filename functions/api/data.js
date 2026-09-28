// ============================================================
// DEFAULT_DATA — сид для первого запуска.
// Кастомный формат: 6 команд, 5 матчей.
//
// Структура:
//   M1: команда ? vs команда ?  (выбирается в админке)
//   M2: команда ? vs команда ?  (выбирается в админке)
//   M3: команда ? vs команда ?  (выбирается в админке)
//   M4: W(M1) vs W(M2)
//   M5: W(M4) vs W(M3)  ← финал
// ============================================================
const DEFAULT_DATA = {
  tournament: {
    name: "Compass Arena",
    game: "Dota 2",
    format: "Custom Bracket",
    matches: "Bo3",
    dates: "26 сентября 2026"
  },
  teams: [
    { id: 1, name: "Слот 1", players: [], logo: "" },
    { id: 2, name: "Слот 2", players: [], logo: "" },
    { id: 3, name: "Слот 3", players: [], logo: "" },
    { id: 4, name: "Слот 4", players: [], logo: "" },
    { id: 5, name: "Слот 5", players: [], logo: "" },
    { id: 6, name: "Слот 6", players: [], logo: "" }
  ],
  matches: [
    { id: 1, round: 1, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null },
    { id: 2, round: 1, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null },
    { id: 3, round: 1, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null },
    { id: 4, round: 2, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null },
    { id: 5, round: 3, team1: null, team2: null, winner: null, bracket: 'grand', score1: null, score2: null }
  ],
  schedule: {},
  liveMatchId: null,
  tournamentStart: null,
  projectStart: null,
  alwaysShowBracketBanner: true
};

export async function onRequestGet(context) {
  const { env } = context;

  let data = await env.COMPASS_KV.get('tournament', { type: 'json' });
  if (!data) {
    data = DEFAULT_DATA;
    await env.COMPASS_KV.put('tournament', JSON.stringify(data));
  }

  // История турниров — отдельный ключ. Если нет — пустой массив.
  let history = await env.COMPASS_KV.get('history', { type: 'json' });
  if (!Array.isArray(history)) history = [];

  // Отдаём объединённый объект: текущие данные + history
  const response = Object.assign({}, data, { history });

  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}
