import { DEFAULT_GAME, GAMES, gameFrom, tournamentKey } from '../_lib/games.js';


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

/** Пустой турнир новой дисциплины: команд и сетки ещё нет */
function emptyTournament(game) {
  return {
    tournament: { name: 'Compass Arena', game: GAMES[game].name, format: 'Custom Bracket', matches: 'Bo3', dates: '' },
    teams: [],
    matches: [],
    schedule: {},
    liveMatchId: null,
    tournamentStart: null,
    projectStart: null,
    nextSeason: null,
    archivedSnapshotId: null,
    alwaysShowBracketBanner: true
  };
}

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

  // Дисциплина: ?game=csgo (по умолчанию Dota 2 — её данные в старом ключе `tournament`)
  const reqUrl = new URL(context.request ? context.request.url : 'https://x/');
  const game = gameFrom(reqUrl.searchParams.get('game'));
  if (!game) return new Response('Unknown game', { status: 400 });
  const key = tournamentKey(game);

  /* Бесплатный тариф Workers — 10 мс CPU на запрос. Разбор и сборка JSON на несколько мегабайт
     (логотипы и фото внутри данных) эти 10 мс съедают, поэтому данные и архив отдаём ТЕКСТОМ,
     не разбирая: просто склеиваем строки. Фото в ответе — ссылки /api/photo/<id>;
     data:-URL собираются только по ?full=1 (резервная копия в админке). */
  let raw = await env.COMPASS_KV.get(key);
  if (!raw) {
    raw = JSON.stringify(game === DEFAULT_GAME ? DEFAULT_DATA : emptyTournament(game));
    await env.COMPASS_KV.put(key, raw);
  }

  let historyRaw = await env.COMPASS_KV.get('history');
  if (!historyRaw || !String(historyRaw).trim()) historyRaw = '[]';

  const full = reqUrl.searchParams.get('full') === '1';
  if (full) {
    let history = [];
    try { history = JSON.parse(historyRaw); } catch { history = []; }
    historyRaw = JSON.stringify(await hydratePhotos(env, Array.isArray(history) ? history : []));
  }

  return new Response(joinResponse(raw, historyRaw, game), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

/** {"teams":…} + history + game одной строкой, без JSON.parse/stringify */
function joinResponse(raw, historyRaw, game) {
  const text = String(raw).trim();
  const end = text.lastIndexOf('}');
  if (!text.startsWith('{') || end < 0) {
    return '{"history":' + historyRaw + ',"game":' + JSON.stringify(game) + '}';
  }
  const head = text.slice(0, end);
  const sep = /\{\s*$/.test(head) ? '' : ',';
  return head + sep + '"history":' + historyRaw + ',"game":' + JSON.stringify(game) + '}';
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
