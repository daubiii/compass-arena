import { applyChallonge } from '../_lib/challonge.js';

// ============================================================
// DEFAULT_DATA — сид для первого запуска.
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
    { id: 1, round: 1, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null, vod: '' },
    { id: 2, round: 1, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null, vod: '' },
    { id: 3, round: 1, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null, vod: '' },
    { id: 4, round: 2, team1: null, team2: null, winner: null, bracket: 'upper', score1: null, score2: null, vod: '' },
    { id: 5, round: 3, team1: null, team2: null, winner: null, bracket: 'grand', score1: null, score2: null, vod: '' }
  ],
  schedule: {},
  liveMatchId: null,
  tournamentStart: null,
  projectStart: null,
  nextSeason: null,
  // id главы архива, которой зафиксирован текущий сезон (null — ещё не зафиксирован).
  // Нужен админке, чтобы один сезон = одна глава и не появлялись дубликаты.
  archivedSnapshotId: null,
  alwaysShowBracketBanner: true
};

/** id всех кадров архива: они лежат в отдельных ключах photo:<id> */
function photoIdsIn(history) {
  const ids = new Set();
  if (!Array.isArray(history)) return ids;
  for (const chapter of history) {
    const photos = chapter && Array.isArray(chapter.photos) ? chapter.photos : [];
    for (const photo of photos) {
      const match = /^\/api\/photo\/([a-f0-9]{32})$/.exec(String((photo && photo.url) || ''));
      if (match) ids.add(match[1]);
    }
  }
  return ids;
}

/** Байты → base64 (чанками: кадры бывают по несколько мегабайт) */
function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function onRequestGet(context) {
  const { env } = context;

  let data = await env.COMPASS_KV.get('tournament', { type: 'json' });
  if (!data) {
    data = DEFAULT_DATA;
    await env.COMPASS_KV.put('tournament', JSON.stringify(data));
  }

  // Если турнир подключён к Challonge — подтягиваем сетку оттуда.
  // Ошибка сети или кривая ссылка не должны ронять страницу: тогда отдаём
  // сохранённые матчи и причину в bracketSource.
  if (data.challonge && data.challonge.enabled) {
    data = await applyChallonge(env, data);
  }

  // История турниров — отдельный ключ. Если нет — пустой массив.
  let history = await env.COMPASS_KV.get('history', { type: 'json' });
  if (!Array.isArray(history)) history = [];

  // Публичным страницам нужны только ссылки на кадры: ?light=1 экономит трафик
  // и не заставляет воркер тянуть из KV мегабайты base64.
  const light = new URL(context.request ? context.request.url : 'https://x/').searchParams.get('light') === '1';
  if (!light) history = await hydratePhotos(env, history);

  // Универсальная сетка (генератор на brackets-manager) — свои ключи.
  // Пока сетку не сгенерировали, отдаём null: страница покажет заглушку.
  let brackets = null;
  try {
    brackets = await env.COMPASS_KV.get('brackets_data', { type: 'json' });
  } catch {
    brackets = null;
  }
  if (!brackets || typeof brackets !== 'object' || !Array.isArray(brackets.matches)) {
    brackets = null;
  }

  let bracketsMeta = null;
  try {
    bracketsMeta = await env.COMPASS_KV.get('brackets_meta', { type: 'json' });
  } catch {
    bracketsMeta = null;
  }
  if (!bracketsMeta || typeof bracketsMeta !== 'object') bracketsMeta = null;

  // Отдаём объединённый объект: текущие данные + history + сетка
  const response = Object.assign({}, data, { history, brackets, bracketsMeta });

  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

/**
 * Собирает фото обратно в data:-URL — их ждёт админка (превью, скачивание
 * архива, повторное сохранение). Ошибка чтения одного кадра не роняет ответ.
 */
async function hydratePhotos(env, history) {
  const ids = photoIdsIn(history);
  if (!ids.size) return history;

  const urls = new Map();
  for (const id of ids) {
    try {
      const { value, metadata } = await env.COMPASS_KV.getWithMetadata('photo:' + id, { type: 'arrayBuffer' });
      if (!value) continue;
      const mime = (metadata && metadata.type) || 'image/jpeg';
      urls.set(id, 'data:' + mime + ';base64,' + bytesToBase64(new Uint8Array(value)));
    } catch {
      // кадр потерялся — просто не подставляем его
    }
  }

  return history.map((chapter) => {
    const photos = chapter && Array.isArray(chapter.photos) ? chapter.photos : [];
    const restored = photos.map((photo) => {
      const match = /^\/api\/photo\/([a-f0-9]{32})$/.exec(String((photo && photo.url) || ''));
      if (!match || !urls.has(match[1])) return photo;
      return Object.assign({}, photo, { url: urls.get(match[1]) });
    });
    return Object.assign({}, chapter, { photos: restored });
  });
}
