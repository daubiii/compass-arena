/* Серверная часть Challonge: разбор ссылки, нормализация сетки, кэш, запасная копия, админ-эндпоинт.
   Фикстуры собраны по описанию API v1 (tournament → participants/matches с обёртками participant/match). */
import { parseTournamentId, normalizeBracket, getBracket, applyChallonge, fetchTournament, pushParticipants } from '../functions/_lib/challonge.js';
import { onRequestPost as adminPost } from '../functions/api/challonge.js';
import { onRequestGet as getData } from '../functions/api/data.js';

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error('✗', m); } else console.log('✓', m); };

/* ---- подставной KV и кэш ---- */
function fakeKV() {
  const m = new Map();
  return { m,
    async get(k, o) { const v = m.get(k); if (v == null) return null; return o && o.type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, typeof v === 'string' ? v : String(v)); }, async delete(k) { m.delete(k); } };
}
const cacheMap = new Map();
globalThis.caches = { default: {
  async match(req) { const r = cacheMap.get(req.url); return r ? r.clone() : undefined; },
  async put(req, res) { cacheMap.set(req.url, res); } } };

import { de8, NAMES } from './challonge-fixtures.mjs';

/* ---- parseTournamentId ---- */
ok(parseTournamentId('abc123') === 'abc123', 'slug как есть');
ok(parseTournamentId('https://challonge.com/abc123') === 'abc123', 'ссылка challonge.com/slug');
ok(parseTournamentId('https://challonge.com/abc123/module') === 'abc123', 'ссылка с хвостом');
ok(parseTournamentId('https://compass.challonge.com/cup1') === 'compass-cup1', 'ссылка организации → sub-slug');
ok(parseTournamentId('challonge.com/abc123') === 'abc123', 'ссылка без схемы');
ok(parseTournamentId('https://evil.com/abc123') === null, 'чужой домен отвергается');
ok(parseTournamentId('https://challonge.com.evil.com/abc') === null, 'подделка домена отвергается');
ok(parseTournamentId('') === null && parseTournamentId(null) === null, 'пусто → null');

/* ---- normalizeBracket ---- */
const T = de8().tournament;
const ours = [{ id: 1, name: 'alpha ', players: [{ nick: 'x' }], logo: 'L' }, { id: 2, name: 'Слот 2', players: [], logo: '' }];
const nb = normalizeBracket(T, ours);
ok(nb.matches.length === 15, '15 матчей', nb.matches.length);
const by = {}; nb.matches.forEach((m) => { by[m.id] = m; });
ok(by[101].bracket === 'upper' && by[101].round === 1, 'раунд 1 верхней сетки');
ok(by[108].bracket === 'lower' && by[108].round === 1 && by[113].round === 4, 'нижняя сетка: отрицательные раунды → 1..4');
ok(by[114].bracket === 'grand' && by[115].bracket === 'grand', 'гранд-финал и сброс определены');
ok(by[114].round === 1 && by[115].round === 2, 'раунды гранда 1 и 2');
ok(by[107].bracket === 'upper', 'финал верхней сетки остался верхней');
ok(by[105].from1 && by[105].from1.m === 101 && by[105].from1.as === 'w', 'связь «победитель M101»');
ok(by[108].from1.as === 'l' && by[110].from1.as === 'w' && by[110].from2.as === 'l' && by[110].from2.m === 106, 'связи: проигравшие падают в нижнюю сетку, победители идут дальше');
ok(by[101].score1 === 2 && by[101].score2 === 1, 'счёт по картам 1-0,0-1,1-0 → 2:1');
ok(by[102].score1 === 2 && by[102].score2 === 0, 'счёт серии «2-0»');
ok(by[103].winner === null && by[103].score1 === null, 'несыгранный матч без счёта');
ok(by[101].team1 === 1, 'команда сопоставлена с нашей по названию (регистр и пробелы не важны)');
ok(by[101].winner === 1 && by[101].team2 === 1000000000 + 5008, 'новая команда получила id 1e9+id участника');
ok(nb.teams.length === 9 && nb.teams[1].name === 'Слот 2' && nb.teams[0].logo === 'L' && nb.teams[0].players.length === 1, 'наши данные команды (лого, состав) сохранены');
ok(nb.teams.filter((t) => t.id >= 1000000000).length === 7, 'остальные 7 участников добавлены как новые команды');
ok(nb.info.type === 'double elimination' && nb.info.matches === 15, 'info заполнен');

const se = { tournament_type: 'single elimination', participants: [], matches: [
  { match: { id: 1, round: 1, player1_id: null, player2_id: null }}, { match: { id: 2, round: 1 } },
  { match: { id: 3, round: 2, player1_prereq_match_id: 1, player2_prereq_match_id: 2 } },
  { match: { id: 4, round: 2, player1_prereq_match_id: 1, player2_prereq_match_id: 2, player1_is_prereq_match_loser: true, player2_is_prereq_match_loser: true } }] };
const nse = normalizeBracket(se, []);
ok(nse.matches.find((m) => m.id === 4).bracket === 'third', 'матч за 3-е место (single elimination)');
ok(nse.matches.find((m) => m.id === 3).bracket === 'upper', 'финал single elimination — верхняя сетка');

/* ---- кэш и запасная копия ---- */
const env = { COMPASS_KV: fakeKV(), CHALLONGE_API_KEY: 'k', ADMIN_PASSWORD: 'pw' };
let calls = 0; let mode = 'ok';
const fakeFetch = async (url, init) => {
  calls++;
  if (mode === 'down') throw new Error('net');
  if (mode === '401') return new Response('no', { status: 401 });
  if (init && init.method === 'POST') { fakeFetch.lastPost = JSON.parse(init.body); return new Response('{}', { status: 200 }); }
  return new Response(JSON.stringify(de8()), { status: 200 });
};
let r = await getBracket(env, 'abc', { fetchImpl: fakeFetch });
ok(!r.stale && r.raw && calls === 1, 'первый запрос идёт в Challonge');
ok(!String(fakeFetch.lastUrl || '').includes('x') && env.COMPASS_KV.m.has('challonge-last'), 'копия сохранена в KV');
r = await getBracket(env, 'abc', { fetchImpl: fakeFetch });
ok(calls === 1, 'повторный запрос в пределах 20 с берётся из кэша');
cacheMap.clear(); mode = 'down';
r = await getBracket(env, 'abc', { fetchImpl: fakeFetch });
ok(r.stale === true && r.raw && r.error && r.error.code === 'network', 'сбой сети → последняя копия, stale');
env.COMPASS_KV.m.delete('challonge-last'); cacheMap.clear();
r = await getBracket(env, 'abc', { fetchImpl: fakeFetch });
ok(r.raw === null && r.error, 'нет копии и сбой → raw null и ошибка');
mode = '401'; cacheMap.clear();
r = await getBracket(env, 'abc', { fetchImpl: fakeFetch });
ok(r.error && r.error.code === 'auth', 'неверный ключ → код auth');

/* ---- applyChallonge ---- */
mode = 'ok'; cacheMap.clear();
const stored = { tournament: { name: 'X' }, teams: ours, matches: [{ id: 1 }], challonge: { enabled: false, tournament: 'abc' } };
ok((await applyChallonge(env, stored, { fetchImpl: fakeFetch })) === stored, 'выключено → данные не тронуты');
stored.challonge.enabled = true;
// applyChallonge вызывает fetch глобально — подменяем
const realFetch = globalThis.fetch; globalThis.fetch = fakeFetch;
let ap = await applyChallonge(env, stored);
ok(ap.matches.length === 15 && ap.bracketSource.ok === true, 'включено → матчи из Challonge');
ok(ap.teams.length === 9, 'команды объединены (заглушка «Слот 2» остаётся, на сайте она не считается командой)');
stored.challonge.tournament = 'https://evil.com/x';
ap = await applyChallonge(env, stored);
ok(ap.bracketSource.ok === false && ap.matches.length === 1, 'кривая ссылка → сохранённые матчи и ошибка в bracketSource');
stored.challonge.tournament = 'abc';

/* ---- /api/data ---- */
env.COMPASS_KV.m.set('tournament', JSON.stringify(stored));
const d = await (await getData({ env })).json();
ok(d.matches.length === 15 && d.bracketSource.info.participants === 8, '/api/data отдаёт сетку Challonge');
ok(!JSON.stringify(d).includes('"k"') && !JSON.stringify(d).includes('api_key'), 'ключ API в ответ не попадает');

/* ---- админ-эндпоинт ---- */
const post = (b) => adminPost({ request: new Request('http://x', { method: 'POST', body: JSON.stringify(b) }), env, fetchImpl: fakeFetch });
ok((await post({ password: 'bad', action: 'test', tournament: 'abc' })).status === 403, 'без пароля нельзя');
let rr = await post({ password: 'pw', action: 'test', tournament: 'https://challonge.com/abc' });
let body = await rr.json();
ok(rr.status === 200 && body.ok && body.info.participants === 8, 'test: сводка по турниру');
rr = await post({ password: 'pw', action: 'test', tournament: 'nonsense url' });
ok(rr.status === 400, 'test: кривая ссылка → 400');
mode = '401'; rr = await post({ password: 'pw', action: 'test', tournament: 'abc' });
body = await rr.json();
ok(rr.status === 502 && body.code === 'auth', 'test: ошибка ключа объяснена');
mode = 'ok';

/* ---- push участников ---- */
const names = ['Alpha', 'Zulu', 'Yankee', 'Слот 3'];
env.COMPASS_KV.m.set('tournament', JSON.stringify({ teams: names.map((n, i) => ({ id: i + 1, name: n })) }));
// у de8 state = underway → добавлять нельзя
rr = await post({ password: 'pw', action: 'push', tournament: 'abc' });
body = await rr.json();
ok(rr.status === 502 && body.code === 'started', 'push: идущий турнир — участников не добавляем');
const pend = () => { const t = de8(); t.tournament.state = 'pending'; return t; };
const f2 = async (url, init) => init && init.method === 'POST' ? (f2.last = JSON.parse(init.body), new Response('{}', { status: 200 })) : new Response(JSON.stringify(pend()), { status: 200 });
const pr = await pushParticipants(env, 'abc', ['Alpha', 'Zulu', 'Yankee'], f2);
ok(pr.added === 2 && pr.skipped === 1, 'push: Alpha уже есть — добавлены только Zulu и Yankee');
ok(f2.last.participants.map((p) => p.name).join() === 'Zulu,Yankee' && f2.last.api_key === 'k', 'push: тело запроса верное');
globalThis.fetch = realFetch;

console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nвсе проверки пройдены');
process.exit(failed ? 1 : 0);
