// POST /api/upload — загрузка одной картинки (логотип или фото архива) «как есть», бинарным телом.
// Зачем: base64 внутри JSON заставляет воркер на бесплатном тарифе (10 мс CPU) разбирать и собирать
// мегабайты текста при каждом запросе. Картинка кладётся в KV отдельным ключом photo:<id>, а в данных
// остаётся короткая ссылка /api/photo/<id>.
// Заголовки: X-Admin-Password, Content-Type: image/jpeg|png|webp|gif. Ответ: { url }.
import { authorize } from '../_lib/auth.js';

const MIME = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1 };
const MAX_BYTES = 3 * 1024 * 1024;

function newId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const denied = await authorize(env, request, request.headers.get('X-Admin-Password'));
  if (denied) return denied;

  const type = String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!MIME[type]) return new Response('Unsupported type', { status: 415 });

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return new Response('Empty body', { status: 400 });
  if (bytes.byteLength > MAX_BYTES) return new Response('Too large (max 3 MB)', { status: 413 });

  const id = newId();
  await env.COMPASS_KV.put('photo:' + id, bytes, { metadata: { type } });

  return new Response(JSON.stringify({ ok: true, url: '/api/photo/' + id }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
