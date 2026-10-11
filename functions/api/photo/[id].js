// GET /api/photo/<id> — отдаёт фото архива из KV.
// Фото хранятся отдельно от основного JSON (ключ photo:<id>), поэтому /api/data остаётся лёгким,
// а браузер забирает только те кадры, которые реально показывает просмотрщик.
// id случайный и не меняется, поэтому ответ можно кэшировать навсегда.
export async function onRequestGet(context) {
  const { params, env } = context;
  const id = String(params.id || '');
  if (!/^[a-f0-9]{32}$/.test(id)) return new Response('Not found', { status: 404 });

  const { value, metadata } = await env.COMPASS_KV.getWithMetadata('photo:' + id, { type: 'arrayBuffer' });
  if (!value) return new Response('Not found', { status: 404 });

  return new Response(value, {
    headers: {
      'Content-Type': (metadata && metadata.type) || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
