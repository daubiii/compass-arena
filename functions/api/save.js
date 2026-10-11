const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000; // 10 минут блокировки после превышения лимита

// ---- Фото архива ----
// Админка присылает новые фото как data:-URL. Здесь они уезжают в отдельные ключи KV (photo:<id>),
// а в истории остаётся короткая ссылка /api/photo/<id>.
const PHOTO_URL = /^\/api\/photo\/[a-f0-9]{32}$/;
const MAX_NEW_PHOTOS = 25;                 // за одно сохранение (лимит обращений к KV на один запрос)
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;   // после декодирования
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function parseDataUrl(url) {
  const m = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
  if (!m || PHOTO_TYPES.indexOf(m[1]) === -1) return null;
  const bin = atob(m[2].replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { type: m[1], bytes };
}
function photoIds(history) {
  const ids = new Set();
  for (const h of history || []) {
    for (const p of (h && h.photos) || []) {
      if (p && typeof p.url === 'string' && PHOTO_URL.test(p.url)) ids.add(p.url.slice('/api/photo/'.length));
    }
  }
  return ids;
}
function newPhotoCount(history) {
  let n = 0;
  for (const h of history || []) for (const p of (h && h.photos) || []) if (p && typeof p.url === 'string' && p.url.startsWith('data:')) n++;
  return n;
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
  // history храним отдельно, чтобы не раздувать основной ключ.
  const { history, clearHistory, ...tournamentData } = data;

  // Проверяем фото заранее: если что-то не так — ничего не записываем, а не сохраняем наполовину.
  let trimmedHistory = null;
  if (Array.isArray(history)) {
    trimmedHistory = history.slice(0, 20);
    if (newPhotoCount(trimmedHistory) > MAX_NEW_PHOTOS) {
      return new Response('Слишком много новых фото за раз (максимум ' + MAX_NEW_PHOTOS + '). Сохраните часть, потом добавьте остальные.', { status: 413 });
    }
  }

  await env.COMPASS_KV.put('tournament', JSON.stringify(tournamentData));

  // ---- Сохраняем историю (если передана) ----
  let historyKept = false;
  let savedHistory = null;
  if (trimmedHistory) {
    // Защита от потери архива: пустой список затирает историю только
    // по явному запросу (кнопка «Очистить архив» в админке).
    const stored = await env.COMPASS_KV.get('history', { type: 'json' });
    const storedCount = Array.isArray(stored) ? stored.length : 0;

    if (trimmedHistory.length > 0 || storedCount === 0 || clearHistory === true) {
      let converted = 0;
      for (const h of trimmedHistory) {
        if (!h || !Array.isArray(h.photos)) continue;
        const keep = [];
        for (const p of h.photos) {
          if (!p || typeof p.url !== 'string') continue;
          if (PHOTO_URL.test(p.url)) { keep.push(p); continue; }
          const parsed = p.url.startsWith('data:') ? parseDataUrl(p.url) : null;
          if (!parsed || parsed.bytes.length > MAX_PHOTO_BYTES) continue;   // неподходящий файл пропускаем
          const id = crypto.randomUUID().replace(/-/g, '');
          await env.COMPASS_KV.put('photo:' + id, parsed.bytes, { metadata: { type: parsed.type } });
          keep.push(Object.assign({}, p, { url: '/api/photo/' + id }));
          converted++;
        }
        h.photos = keep;
      }
      await env.COMPASS_KV.put('history', JSON.stringify(trimmedHistory));
      if (converted) savedHistory = trimmedHistory;

      // Фото, которых больше нет ни в одной главе, удаляем из KV
      const before = photoIds(stored);
      const after = photoIds(trimmedHistory);
      for (const id of before) if (!after.has(id)) await env.COMPASS_KV.delete('photo:' + id);
    } else {
      historyKept = true;
    }
  }

  return new Response(JSON.stringify({ ok: true, historyKept, history: savedHistory }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
