// ============================================================
// Challonge → наша модель сетки.
// Ключ API живёт только на сервере (env.CHALLONGE_API_KEY) и в браузер не попадает.
// Работаем с API v1 (api.challonge.com/v1, ключ из настроек аккаунта).
//
// Модель матча на выходе:
//   { id, num, round, bracket: 'upper'|'lower'|'grand'|'third',
//     team1, team2, winner, score1, score2, vod,
//     from1, from2 }   // from* = { m: <id матча-источника>, as: 'w'|'l' } | null
// ============================================================

const API = 'https://api.challonge.com/v1';
const FRESH_MS = 20 * 1000;           // не чаще одного запроса к Challonge в 20 секунд
const TEAM_ID_OFFSET = 1000000000;    // id команд, которых нет в нашем списке (участник Challonge → 1e9 + id)

/* Принимает slug, «sub-slug» или любую ссылку вида https://challonge.com/slug, https://sub.challonge.com/slug */
export function parseTournamentId(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9_-]+$/.test(raw)) return raw;
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch (e) { return null; }
  const host = u.hostname.toLowerCase();
  if (host !== 'challonge.com' && !host.endsWith('.challonge.com')) return null;
  const slug = u.pathname.split('/').filter(Boolean)[0];
  if (!slug || !/^[A-Za-z0-9_-]+$/.test(slug)) return null;
  const sub = host === 'challonge.com' || host === 'www.challonge.com' ? '' : host.slice(0, -'.challonge.com'.length);
  return sub ? sub + '-' + slug : slug;
}

export class ChallongeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export async function fetchTournament(id, apiKey, fetchImpl) {
  const f = fetchImpl || fetch;
  if (!apiKey) throw new ChallongeError('no_key', 'На сервере не задан CHALLONGE_API_KEY');
  const url = API + '/tournaments/' + encodeURIComponent(id) + '.json?api_key=' + encodeURIComponent(apiKey) +
    '&include_participants=1&include_matches=1';
  let res;
  try { res = await f(url, { headers: { Accept: 'application/json' } }); }
  catch (e) { throw new ChallongeError('network', 'Не удалось связаться с Challonge'); }
  if (res.status === 401 || res.status === 403) throw new ChallongeError('auth', 'Challonge не принял API-ключ или нет доступа к турниру');
  if (res.status === 404) throw new ChallongeError('not_found', 'Турнир не найден — проверьте ссылку');
  if (!res.ok) throw new ChallongeError('http', 'Challonge ответил ошибкой ' + res.status);
  let body;
  try { body = await res.json(); } catch (e) { throw new ChallongeError('bad_json', 'Challonge вернул не JSON'); }
  const t = body && body.tournament;
  if (!t) throw new ChallongeError('bad_json', 'Неожиданный ответ Challonge');
  return t;
}

/* ---------- Нормализация ---------- */
const normName = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
const unwrap = (list, key) => (Array.isArray(list) ? list : []).map((x) => (x && x[key]) || x).filter(Boolean);
const int = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };

/* «2-1» — счёт серии; «1-0,0-1,1-0» — счёт по картам, считаем выигранные */
function parseScores(csv) {
  const parts = String(csv || '').split(',').map((s) => s.trim()).filter(Boolean);
  const pairs = [];
  for (const p of parts) {
    const m = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(p);
    if (m) pairs.push([parseInt(m[1], 10), parseInt(m[2], 10)]);
  }
  if (!pairs.length) return { s1: null, s2: null };
  if (pairs.length === 1) return { s1: pairs[0][0], s2: pairs[0][1] };
  let a = 0, b = 0;
  for (const [x, y] of pairs) { if (x > y) a++; else if (y > x) b++; }
  return { s1: a, s2: b };
}

export function normalizeBracket(t, ourTeams) {
  const type = String(t.tournament_type || '').toLowerCase();
  const isDE = type.indexOf('double') !== -1;
  const isSE = type.indexOf('single') !== -1;
  const parts = unwrap(t.participants, 'participant');
  const raw = unwrap(t.matches, 'match');

  // участник Challonge → наша команда (по названию), иначе новая запись
  const byName = {};
  const teams = (ourTeams || []).map((x) => Object.assign({}, x));
  teams.forEach((x) => { if (x && x.name) byName[normName(x.name)] = x; });
  const pid2team = {};
  parts.forEach((p) => {
    const name = p.name || p.display_name || p.username || '';
    const known = byName[normName(name)];
    if (known) { pid2team[p.id] = known.id; return; }
    const id = TEAM_ID_OFFSET + int(p.id);
    pid2team[p.id] = id;
    if (!teams.some((x) => x.id === id)) teams.push({ id, name: String(name), players: [], logo: '', seed: int(p.seed) });
  });

  const byId = {};
  raw.forEach((m) => { byId[m.id] = m; });

  // сетки: отрицательные раунды — нижняя; в double elimination матчи после финала верхней и нижней — гранд-финал
  const bracketOf = {};
  raw.forEach((m) => { bracketOf[m.id] = m.round < 0 ? 'lower' : 'upper'; });
  if (isDE) {
    let changed = true;
    while (changed) {
      changed = false;
      raw.forEach((m) => {
        if (bracketOf[m.id] !== 'upper' || m.round <= 0) return;
        const pre = [m.player1_prereq_match_id, m.player2_prereq_match_id].filter((x) => x != null);
        if (pre.some((p) => bracketOf[p] === 'lower' || bracketOf[p] === 'grand')) { bracketOf[m.id] = 'grand'; changed = true; }
      });
    }
  } else if (isSE) {
    raw.forEach((m) => { if (m.player1_is_prereq_match_loser || m.player2_is_prereq_match_loser) bracketOf[m.id] = 'third'; });
  }
  // нумерация раундов внутри сетки: гранд-финал 1, 2 (сброс); остальные — |round|
  const grandRounds = Array.from(new Set(raw.filter((m) => bracketOf[m.id] === 'grand').map((m) => m.round))).sort((a, b) => a - b);

  const sorted = raw.slice().sort((a, b) => (a.suggested_play_order || 0) - (b.suggested_play_order || 0) || a.id - b.id);
  const matches = sorted.map((m, i) => {
    const bracket = bracketOf[m.id];
    const sc = parseScores(m.scores_csv);
    const link = (preId, isLoser) => (preId != null && byId[preId] ? { m: preId, as: isLoser ? 'l' : 'w' } : null);
    return {
      id: m.id,
      num: m.suggested_play_order || i + 1,
      round: bracket === 'grand' ? grandRounds.indexOf(m.round) + 1 : (bracket === 'third' ? Math.abs(m.round) : Math.abs(m.round) || 1),
      bracket,
      team1: m.player1_id != null && pid2team[m.player1_id] != null ? pid2team[m.player1_id] : null,
      team2: m.player2_id != null && pid2team[m.player2_id] != null ? pid2team[m.player2_id] : null,
      winner: m.winner_id != null && pid2team[m.winner_id] != null ? pid2team[m.winner_id] : null,
      score1: m.winner_id != null ? sc.s1 : null,
      score2: m.winner_id != null ? sc.s2 : null,
      vod: '',
      from1: link(m.player1_prereq_match_id, m.player1_is_prereq_match_loser),
      from2: link(m.player2_prereq_match_id, m.player2_is_prereq_match_loser)
    };
  });

  return {
    teams,
    matches,
    info: {
      name: t.name || '',
      type: t.tournament_type || '',
      state: t.state || '',
      participants: parts.length,
      matches: matches.length,
      url: t.full_challonge_url || ''
    }
  };
}

/* ---------- Кэш и запасной вариант ----------
   Свежий ответ живёт 20 с в кэше Cloudflare (квоты KV не тратятся).
   В KV пишем только когда сетка реально изменилась — это «последняя удачная копия» на случай сбоя Challonge. */
export async function getBracket(env, id, opts) {
  const o = opts || {};
  const cacheStore = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const cacheKey = new Request('https://compass-arena.internal/challonge/' + encodeURIComponent(id));

  if (!o.force && cacheStore) {
    const hit = await cacheStore.match(cacheKey);
    if (hit) return { raw: await hit.json(), stale: false, error: null };
  }
  try {
    const raw = await fetchTournament(id, env.CHALLONGE_API_KEY, o.fetchImpl);
    const text = JSON.stringify(raw);
    if (cacheStore) {
      await cacheStore.put(cacheKey, new Response(text, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + (FRESH_MS / 1000) } }));
    }
    const last = await env.COMPASS_KV.get('challonge-last');
    if (last !== text) await env.COMPASS_KV.put('challonge-last', text);
    return { raw, stale: false, error: null };
  } catch (e) {
    const err = e instanceof ChallongeError ? e : new ChallongeError('unknown', 'Ошибка при запросе к Challonge');
    const last = await env.COMPASS_KV.get('challonge-last', { type: 'json' });
    if (last) return { raw: last, stale: true, error: err };
    return { raw: null, stale: false, error: err };
  }
}

/* Подмешиваем сетку в данные турнира. Если Challonge недоступен и копии нет — отдаём сохранённое как есть. */
export async function applyChallonge(env, data, opts) {
  const cfg = data && data.challonge;
  if (!cfg || !cfg.enabled) return data;
  const id = parseTournamentId(cfg.tournament);
  if (!id) return Object.assign({}, data, { bracketSource: { type: 'challonge', ok: false, error: 'Не указана ссылка на турнир' } });
  const res = await getBracket(env, id, opts);
  if (!res.raw) {
    return Object.assign({}, data, { bracketSource: { type: 'challonge', ok: false, error: res.error ? res.error.message : 'Нет данных' } });
  }
  const nb = normalizeBracket(res.raw, data.teams);
  return Object.assign({}, data, {
    teams: nb.teams,
    matches: nb.matches,
    bracketSource: { type: 'challonge', ok: !res.stale, stale: res.stale, error: res.error ? res.error.message : null, info: nb.info }
  });
}

/* Добавить в Challonge команды, которых там ещё нет (только пока турнир не начат) */
export async function pushParticipants(env, id, names, fetchImpl) {
  const f = fetchImpl || fetch;
  const t = await fetchTournament(id, env.CHALLONGE_API_KEY, f);
  const have = new Set(unwrap(t.participants, 'participant').map((p) => normName(p.name || p.display_name)));
  const fresh = [];
  for (const n of names) {
    const k = normName(n);
    if (k && !have.has(k)) { have.add(k); fresh.push(String(n).trim()); }
  }
  if (!fresh.length) return { added: 0, skipped: names.length };
  if (t.state && t.state !== 'pending') throw new ChallongeError('started', 'Турнир в Challonge уже начат — участников добавлять нельзя');
  const res = await f(API + '/tournaments/' + encodeURIComponent(id) + '/participants/bulk_add.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ api_key: env.CHALLONGE_API_KEY, participants: fresh.map((name) => ({ name })) })
  });
  if (!res.ok) throw new ChallongeError('http', 'Challonge не принял участников (ошибка ' + res.status + ')');
  return { added: fresh.length, skipped: names.length - fresh.length };
}
