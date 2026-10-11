const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000; // 10 минут блокировки после превышения лимита

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

    if (trimmedHistory.length > 0 || storedCount === 0 || clearHistory === true) {
      await env.COMPASS_KV.put('history', JSON.stringify(trimmedHistory));
    } else {
      historyKept = true;
    }
  }

  return new Response(JSON.stringify({ ok: true, historyKept }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
