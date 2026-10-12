/* Cloudflare Pages Function: подставляет версию ассетов в HTML на лету.
   ----------------------------------------------------------
   Зачем: у ассетов стоит длинный кеш (immutable), а имена файлов не меняются.
   Если браузер уже держит старую версию скрипта, он не пойдёт на сервер и
   покажет старую сетку. Здесь мы добавляем к ссылкам ?v=<версия>, поэтому
   каждый деплой отдаёт новые адреса и кеш не мешает.

   Версия берётся из окружения Pages (хэш коммита или ветка), поэтому страницы
   трогать не нужно: даже если забыть про npm run version:assets, всё равно
   обновится. Работает только для HTML — ассеты отдаются как есть.

   Важно: при любой ошибке возвращаем исходный ответ, а не 500, чтобы
   страница продолжала открываться. */
const versionOf = (env) => {
  const raw = (env && (env.CF_PAGES_COMMIT_SHA || env.CF_PAGES_BRANCH)) || '';
  return String(raw).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'dev';
};

const ASSET_RE = /(\s(?:src|href)=")(\/?(?:assets\/[^"?]+\.(?:js|css)|site\.css))(\?v=[^"]*)?(")/g;

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const looksLikePage = url.pathname === '/' || /\.html?$/.test(url.pathname);

  const response = await next();
  if (!looksLikePage) return response;

  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;

  try {
    const version = versionOf(env);
    const html = await response.clone().text();
    const rewritten = html.replace(ASSET_RE, (all, pre, path, old, post) => pre + path + '?v=' + version + post);

    const headers = new Headers(response.headers);
    /* HTML всегда перепроверяем — иначе браузер не увидит новую версию ссылок */
    headers.set('Cache-Control', 'no-store');
    headers.delete('ETag');
    headers.delete('Last-Modified');
    return new Response(rewritten, { status: response.status, headers });
  } catch {
    /* Не смогли переписать — отдаём страницу как есть */
    return response;
  }
}
