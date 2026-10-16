const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000; // 10 минут блокировки после превышения лимита

/* Лимиты KV: 25 МБ на значение. Держим запас и отдаём понятную ошибку. */
const MAX_HISTORY_BYTES = 20 * 1024 * 1024;

/** Размер значения в байтах (UTF-8) */
function byteLength(value) {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
}

/* ============================================================
   Фото архива
   ------------------------------------------------------------
   data:-URL раздувают ключ history (лимит KV — 25 МБ), поэтому
   base64 выносится в отдельные ключи photo:<id>, а в истории
   остаётся короткая ссылка /api/photo/<id>.
   ============================================================ */

/** Допустимые форматы кадров. SVG не принимаем: он умеет исполнять скрипты */
const PHOTO_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

const PHOTO_URL_RE = /^\/api\/photo\/([a-f0-9]{32})$/;
const MAX_NEW_PHOTOS = 25;

/** id всех кадров, на которые ссылается архив (по ключу истории) */
function photoIdsIn(history) {
  const ids = new Set();
  if (!Array.isArray(history)) return ids;
  for (const chapter of history) {
    const photos = chapter && Array.isArray(chapter.photos) ? chapter.photos : [];
    for (const photo of photos) {
      const match = PHOTO_URL_RE.exec(String((photo && photo.url) || ''));
      if (match) ids.add(match[1]);
    }
  }
  return ids;
}

/** Случайный id кадра (32 hex) */
function photoId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** data:image/jpeg;base64,... → байты (или null, если формат не поддержан) */
function dataUrlToBytes(url) {
  const match = /^data:([a-z0-9.+/-]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(url || ''));
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!PHOTO_MIME[mime]) return null;
  let binary;
  try {
    binary = atob(match[2].replace(/\s+/g, ''));
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.length ? { bytes, mime } : null;
}

/**
 * Разбирает главы архива: новые data:-URL выносит в KV, ссылки /api/photo/…
 * оставляет как есть, мусор (javascript:, svg, битый base64) выбрасывает.
 *
 * @returns {{history: Array, created: Array, used: Set<string>, changed: boolean, error: string|null}}
 */
function extractPhotos(history, env) {
  const created = [];
  const used = new Set();
  let changed = false;

  const chapters = history.map((chapter) => {
    const photos = Array.isArray(chapter && chapter.photos) ? chapter.photos : [];
    const kept = [];

    for (const photo of photos) {
      const url = photo && typeof photo.url === 'string' ? photo.url : '';
      if (!url) { changed = true; continue; }

      const stored = PHOTO_URL_RE.exec(url);
      if (stored) {
        used.add(stored[1]);
        kept.push(photo);
        continue;
      }

      const data = dataUrlToBytes(url);
      if (!data) { changed = true; continue; }

      const id = photoId();
      created.push({ id, bytes: data.bytes, mime: data.mime });
      used.add(id);
      kept.push(Object.assign({}, photo, { url: '/api/photo/' + id }));
      changed = true;
    }

    if (kept.length !== photos.length) changed = true;
    return Object.assign({}, chapter, { photos: kept });
  });

  return { history: chapters, created, used, changed, error: null };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const { password, data } = body || {};

  // В Cloudflare IP можно получить так:
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateKey = 'ip:' + ip;

  // ---- Проверка блокировки по перебору пароля ----
  const now = Date.now();
  let record = await env.COMPASS_KV.get(rateKey, { type: 'json' });

  if (record && now - record.firstAttempt < LOCKOUT_MS && record.count >= MAX_ATTEMPTS) {
    const waitMin = Math.ceil((LOCKOUT_MS - (now - record.firstAttempt)) / 60000);
    return new Response(
      'Слишком много неверных попыток. Попробуйте снова через ' + waitMin + ' мин.',
      { status: 429 }
    );
  }
  // Окно сброшено — начинаем считать заново
  if (record && now - record.firstAttempt >= LOCKOUT_MS) {
    record = null;
  }

  // Проверка пароля (переменная окружения ADMIN_PASSWORD)
  if (!password || password !== env.ADMIN_PASSWORD) {
    const next = record
      ? { count: record.count + 1, firstAttempt: record.firstAttempt }
      : { count: 1, firstAttempt: now };
    await env.COMPASS_KV.put(rateKey, JSON.stringify(next));
    return new Response('Forbidden', { status: 403 });
  }

  // Пароль верный — сбрасываем счётчик неудачных попыток
  if (record) await env.COMPASS_KV.delete(rateKey);

  if (!data || typeof data !== 'object') {
    return new Response('Bad request: missing data', { status: 400 });
  }

  // ---- Сохраняем основное состояние турнира ----
  // history живёт в отдельном ключе.
  const { history, clearHistory, ...tournamentData } = data;

  await env.COMPASS_KV.put('tournament', JSON.stringify(tournamentData));

  // ---- Сохраняем историю (если передана) ----
  let historyKept = false;
  if (Array.isArray(history)) {
    // Защита от разрастания: лимит 20 турниров, каждый с ограничением размера
    const trimmedHistory = history.slice(0, 20);

    // Защита от потери архива: пустой список затирает историю только
    // по явному запросу (кнопка «Очистить архив» в админке).
    const stored = await env.COMPASS_KV.get('history', { type: 'json' });
    const storedCount = Array.isArray(stored) ? stored.length : 0;
    const write = trimmedHistory.length > 0 || storedCount === 0 || clearHistory === true;

    if (write) {
      // Фото выносим в отдельные ключи ДО записи истории: если что-то упадёт,
      // в KV останутся лишние кадры, но ни одна глава не потеряет картинку.
      const photos = extractPhotos(trimmedHistory, env);

      if (photos.created.length > MAX_NEW_PHOTOS) {
        return new Response(
          'Слишком много новых фото за одно сохранение: ' + photos.created.length +
          ' (лимит ' + MAX_NEW_PHOTOS + '). Сохраните по частям.',
          { status: 413 }
        );
      }

      let payloadSize = 0;
      for (const photo of photos.created) {
        payloadSize += photo.bytes.length;
        await env.COMPASS_KV.put('photo:' + photo.id, photo.bytes, {
          metadata: { type: photo.mime }
        });
      }

      if (byteLength(trimmedHistory) + payloadSize > MAX_HISTORY_BYTES) {
        for (const photo of photos.created) await env.COMPASS_KV.delete('photo:' + photo.id);
        return new Response(
          'Архив слишком большой: ' + Math.round((byteLength(trimmedHistory) + payloadSize) / 1024 / 1024) +
          ' МБ (лимит ' + Math.round(MAX_HISTORY_BYTES / 1024 / 1024) + ' МБ).',
          { status: 413 }
        );
      }

      await env.COMPASS_KV.put('history', JSON.stringify(photos.history));

      // Кадры, которые были в прежнем архиве и больше нигде не упомянуты, убираем из KV
      const stale = [];
      for (const id of photoIdsIn(stored)) if (!photos.used.has(id)) stale.push('photo:' + id);
      for (const key of stale) await env.COMPASS_KV.delete(key);

      // Если в историю ничего не менялось (только ссылки) — сообщаем админке,
      // что перезаписывать её не потребовалось.
      if (!photos.changed) historyKept = true;
    } else {
      historyKept = true;
    }
  }

  return new Response(JSON.stringify({ ok: true, historyKept }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
