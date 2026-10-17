/* Проверка пароля администратора с блокировкой перебора (общая для /api/save и /api/upload). */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000; // 10 минут блокировки после превышения лимита

/**
 * @returns {Promise<Response|null>} null — пароль верный; иначе готовый ответ (403 или 429)
 */
export async function authorize(env, request, password) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateKey = 'ip:' + ip;
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
  if (record && now - record.firstAttempt >= LOCKOUT_MS) record = null;

  if (!password || password !== env.ADMIN_PASSWORD) {
    const next = record
      ? { count: record.count + 1, firstAttempt: record.firstAttempt }
      : { count: 1, firstAttempt: now };
    await env.COMPASS_KV.put(rateKey, JSON.stringify(next));
    return new Response('Forbidden', { status: 403 });
  }

  // Пароль верный — сбрасываем счётчик неудачных попыток
  if (record) await env.COMPASS_KV.delete(rateKey);
  return null;
}
