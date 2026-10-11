// POST /api/challonge — действия админки с Challonge (нужен пароль админки).
//   { password, action: 'test', tournament }         — проверить ссылку и ключ, вернуть краткую сводку
//   { password, action: 'push', tournament }         — добавить в Challonge команды из нашего списка
// Ключ CHALLONGE_API_KEY задаётся в настройках Cloudflare Pages (Secret) и наружу не отдаётся.
import { parseTournamentId, fetchTournament, normalizeBracket, pushParticipants, ChallongeError } from '../_lib/challonge.js';

const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const isPlaceholder = (n) => { const s = String(n || '').trim(); return !s || /^(слот|команда|team|участник)\s*[№#]?\s*\d*$/i.test(s); };

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) { return new Response('Bad request', { status: 400 }); }
  const { password, action, tournament } = body || {};

  if (!env.ADMIN_PASSWORD || typeof password !== 'string' || password !== env.ADMIN_PASSWORD) {
    return new Response('Forbidden', { status: 403 });
  }

  const id = parseTournamentId(tournament);
  if (!id) return json({ ok: false, error: 'Не удалось разобрать ссылку на турнир Challonge' }, 400);

  try {
    if (action === 'test') {
      const t = await fetchTournament(id, env.CHALLONGE_API_KEY, context.fetchImpl);
      const nb = normalizeBracket(t, []);
      return json({ ok: true, id, info: nb.info });
    }
    if (action === 'push') {
      const stored = await env.COMPASS_KV.get('tournament', { type: 'json' });
      const names = ((stored && stored.teams) || []).map((t) => t && t.name).filter((n) => !isPlaceholder(n));
      if (!names.length) return json({ ok: false, error: 'В нашем списке нет настоящих команд (только заглушки «Слот N»)' }, 400);
      const r = await pushParticipants(env, id, names, context.fetchImpl);
      return json({ ok: true, id, added: r.added, skipped: r.skipped });
    }
    return json({ ok: false, error: 'Неизвестное действие' }, 400);
  } catch (e) {
    if (e instanceof ChallongeError) return json({ ok: false, code: e.code, error: e.message }, 502);
    return json({ ok: false, error: 'Внутренняя ошибка' }, 500);
  }
}
