/* Реестр игр и API по играм: node tests/games.mjs */
import fs from 'node:fs';
import vm from 'node:vm';
import { GAMES, tournamentKey, gameFrom } from '../functions/_lib/games.js';
import { onRequestGet as getData } from '../functions/api/data.js';
import { onRequestPost as save } from '../functions/api/save.js';

let fails = 0;
const ok = (c, l, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const ctx = { window: {}, document: undefined }; ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('assets/ca-games.js', 'utf8'), ctx);
const G = ctx.CA.games;

console.log('\n1. Реестр');
ok(G.ids.join() === Object.keys(GAMES).join(), 'id на сайте и на сервере совпадают', [G.ids, Object.keys(GAMES)]);
ok(G.list.every((g) => GAMES[g.id].name === g.name), 'названия совпадают');
ok(G.get('clash').teamSize === 1 && G.get('brawl').teamSize === 3 && G.get('csgo').teamSize === 5 && G.get('dota2').teamSize === 5, 'размеры составов');
ok(G.get('nope').id === 'dota2', 'неизвестная игра → Dota 2');
ok(G.fromUrl({ search: '?game=csgo' }) === 'csgo' && G.fromUrl({ search: '', hash: '#brawl' }) === 'brawl' && G.fromUrl({ search: '?game=x' }) === 'dota2', 'игра из адреса');
ok(G.words('clash').participants === 'Игроки' && G.words('dota2').participants === 'Участники', 'подписи участников');
ok(gameFrom('') === 'dota2' && gameFrom('CSGO') === 'csgo' && gameFrom('x') === null, 'gameFrom');
ok(tournamentKey('dota2') === 'tournament' && tournamentKey('csgo') === 'tournament:csgo', 'ключи KV');

console.log('\n2. API по играм');
const kv = new Map();
const env = {
  ADMIN_PASSWORD: 'pw',
  COMPASS_KV: {
    get: async (k, o) => { const v = kv.get(k); return v == null ? null : (o && o.type === 'json' ? JSON.parse(v) : v); },
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
    getWithMetadata: async () => ({ value: null, metadata: null })
  }
};
const get = async (q) => getData({ env, request: new Request('http://x/api/data' + q) });
const post = async (body) => save({ env, request: new Request('http://x/api/save', { method: 'POST', body: JSON.stringify({ password: 'pw', ...body }) }) });

let r = await get('');
let d = await r.json();
ok(r.status === 200 && d.game === 'dota2' && d.teams.length === 6, 'без параметра — Dota 2 (старый ключ)', d.game);
r = await get('?game=csgo'); d = await r.json();
ok(d.game === 'csgo' && d.teams.length === 0 && d.matches.length === 0 && d.tournament.game === 'CS:GO', 'новая игра стартует пустой');
ok(kv.has('tournament') && kv.has('tournament:csgo'), 'данные лежат в разных ключах');
r = await get('?game=zzz');
ok(r.status === 400, 'неизвестная игра → 400');

r = await post({ game: 'csgo', data: { teams: [{ id: 1, name: 'A', players: [] }], matches: [], tournament: { name: 'x', game: 'CS:GO' } } });
ok(r.status === 200 && (await r.json()).game === 'csgo', 'сохранение в CS:GO');
d = await (await get('?game=csgo')).json();
ok(d.teams.length === 1 && d.teams[0].name === 'A', 'CS:GO прочиталась');
d = await (await get('')).json();
ok(d.teams.length === 6, 'Dota 2 не затронута');
r = await post({ data: { teams: [], matches: [], tournament: { name: 'x' } } });
ok(r.status === 200, 'без game сохраняется в Dota 2 (совместимость админки)');
r = await post({ game: 'bad', data: { teams: [] } });
ok(r.status === 400, 'сохранение в неизвестную игру → 400');

console.log(fails ? '\nПровалено: ' + fails : '\nвсе проверки пройдены');
process.exit(fails ? 1 : 0);
