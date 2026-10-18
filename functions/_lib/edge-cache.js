/* Кэш ответов /api/data на краю Cloudflare (caches.default).
   Зачем: бесплатный лимит KV — 100 тыс. чтений в сутки, а открытые вкладки (расписание, история)
   опрашивают данные раз в минуту. Кэш на ~20 с съедает почти все эти чтения.
   Ключ — служебный URL, не зависящий от параметров запроса; после сохранения из админки его сбрасываем. */
export const CACHE_TTL_SEC = 20;

const keyFor = (game, withHistory) =>
  new Request('https://cache.compassarena.internal/api/data/' + game + '/' + (withHistory ? 'h1' : 'h0'));

function store() {
  try { return typeof caches !== 'undefined' && caches.default ? caches.default : null; } catch { return null; }
}

export async function cacheGet(game, withHistory) {
  const c = store();
  if (!c) return null;
  try { return (await c.match(keyFor(game, withHistory))) || null; } catch { return null; }
}

export async function cachePut(context, game, withHistory, body) {
  const c = store();
  if (!c) return;
  const job = c.put(keyFor(game, withHistory), new Response(body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + CACHE_TTL_SEC }
  })).catch(() => {});
  if (context && typeof context.waitUntil === 'function') context.waitUntil(job);
  else await job;
}

/** Сбрасывает кэш дисциплины (после сохранения) */
export async function cachePurge(game) {
  const c = store();
  if (!c) return;
  try {
    await c.delete(keyFor(game, true));
    await c.delete(keyFor(game, false));
  } catch { /* кэш — только ускорение */ }
}
