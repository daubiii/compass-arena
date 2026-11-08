import { SETTINGS_KEY, normalizeSettings } from '../_lib/settings.js';
import { authorize } from '../_lib/auth.js';
import { cacheGet, cachePut, cachePurge } from '../_lib/edge-cache.js';

/* GET  /api/settings — публичные настройки (кэшируются на краю, один маленький ключ KV)
   POST /api/settings — {password, settings}: сохранение из админки */

export async function onRequestGet(context) {
  const { env } = context;
  const fresh = new URL(context.request ? context.request.url : 'https://x/').searchParams.get('nocache') === '1';
  const hit = fresh ? null : await cacheGet('settings', false);
  if (hit) return new Response(hit.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Cache': 'HIT' } });

  let stored = null;
  try { stored = await env.COMPASS_KV.get(SETTINGS_KEY, { type: 'json' }); } catch { stored = null; }
  const body = JSON.stringify(normalizeSettings(stored, !!stored));
  if (!fresh) await cachePut(context, 'settings', false, body);
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch { return new Response('Bad request', { status: 400 }); }

  const denied = await authorize(env, request, body && body.password);
  if (denied) return denied;
  if (!body || typeof body.settings !== 'object' || !body.settings) return new Response('Bad request: missing settings', { status: 400 });

  const settings = normalizeSettings(body.settings, true);
  await env.COMPASS_KV.put(SETTINGS_KEY, JSON.stringify(settings));
  await cachePurge('settings');
  return new Response(JSON.stringify({ ok: true, settings }), { headers: { 'Content-Type': 'application/json' } });
}
