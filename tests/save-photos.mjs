/* Проверка серверной части фото архива: вынос data:-URL в отдельные ключи KV, чистка, лимиты. Без зависимостей. */
import { onRequestPost } from '../functions/api/save.js';
import { onRequestGet as getPhoto } from '../functions/api/photo/[id].js';
import { onRequestGet as getData } from '../functions/api/data.js';

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error('✗', m); } else console.log('✓', m); };

function fakeKV() {
  const m = new Map();
  return {
    m,
    async get(k, o) { const e = m.get(k); if (!e) return null; return o && o.type === 'json' ? JSON.parse(e.v) : e.v; },
    async getWithMetadata(k) { const e = m.get(k); return e ? { value: e.v.buffer ? e.v.buffer.slice(e.v.byteOffset, e.v.byteOffset + e.v.byteLength) : e.v, metadata: e.meta } : { value: null, metadata: null }; },
    async put(k, v, o) { m.set(k, { v: typeof v === 'string' ? v : new Uint8Array(v), meta: o && o.metadata }); },
    async delete(k) { m.delete(k); }
  };
}
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
/* В браузере и в Worker crypto — глобальный объект; в Node 18+ он тоже есть,
   но в песочнице теста может быть скрыт для страницы — берём на всякий случай явный. */
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}
const env = { COMPASS_KV: fakeKV(), ADMIN_PASSWORD: 'pw' };
const save = (data, password = 'pw') => onRequestPost({
  request: new Request('http://x/api/save', { method: 'POST', body: JSON.stringify({ password, data }) }), env
});
const ch = (id, photos) => ({ id, name: 'T' + id, photos });

let r = await save({ teams: [], history: [ch('a', [{ url: PNG, caption: 'c1' }, { url: 'javascript:alert(1)' }, { url: 'data:image/svg+xml;base64,PHN2Zz4=' }])] });
let out = await r.json();
ok(r.status === 200, 'сохранение проходит');

/* Ответ на сохранение больше не отдаёт архив целиком (он живёт в KV),
   поэтому проверяем результат по /api/data: именно его видит админка.
   Лёгкий вариант (?light=1) — то, что видят публичные страницы. */
const light = await (await getData({ env, request: new Request('http://x/api/data?light=1') })).json();
const d1 = await (await getData({ env, request: new Request('http://x/api/data') })).json();
ok(light.history[0].photos.length === 1, 'мусор и svg отброшены, валидное фото осталось', light.history[0].photos.length);
const url = light.history[0].photos[0].url;
ok(/^\/api\/photo\/[a-f0-9]{32}$/.test(url), 'в лёгком ответе ссылка на /api/photo/<id>', url);
ok(/^data:image\/png;base64,/.test(d1.history[0].photos[0].url), 'админке фото отдаётся как data:-URL');
ok(d1.history[0].photos[0].caption === 'c1', 'подпись сохранена');
const stored = JSON.parse(env.COMPASS_KV.m.get('history').v);
ok(!JSON.stringify(stored).includes('base64'), 'в ключе history нет base64');
const id = url.split('/').pop();
const pr = await getPhoto({ params: { id }, env });
ok(pr.status === 200 && pr.headers.get('Content-Type') === 'image/png', 'фото отдаётся с верным типом');
ok(/immutable/.test(pr.headers.get('Cache-Control')), 'фото кэшируется навсегда');
ok((await getPhoto({ params: { id: '../x' }, env })).status === 404, 'левый id → 404');
ok((await getPhoto({ params: { id: 'a'.repeat(32) }, env })).status === 404, 'несуществующее фото → 404');
const dl = await (await getData({ env, request: new Request('http://x/api/data?light=1') })).json();
ok(dl.history[0].photos[0].url === url && !JSON.stringify(dl).includes('base64'), '?light=1 отдаёт только ссылки');

r = await save({ teams: [], history: stored });
out = await r.json();
ok(out.historyKept === true && env.COMPASS_KV.m.size >= 3, 'повторное сохранение со ссылками ничего не пересоздаёт');
ok([...env.COMPASS_KV.m.keys()].filter(k => k.startsWith('photo:')).length === 1, 'в KV одно фото');

r = await save({ teams: [], history: [ch('a', [])] });
ok([...env.COMPASS_KV.m.keys()].filter(k => k.startsWith('photo:')).length === 0, 'удалённое из главы фото стёрто из KV');

const many = Array.from({ length: 26 }, () => ({ url: PNG }));
const before = env.COMPASS_KV.m.size;
r = await save({ teams: [{ id: 99 }], history: [ch('a', many)] });
ok(r.status === 413 && env.COMPASS_KV.m.size === before, '26 новых фото → 413, в KV ничего не записано');

r = await save({ teams: [], history: [ch('a', [{ url: PNG }])] }, 'wrong');
ok(r.status === 403, 'неверный пароль → 403');

r = await save({ teams: [], history: [] });
out = await r.json();
ok(out.historyKept === true, 'пустая история не затирает архив без clearHistory');

console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nвсе проверки пройдены');
process.exit(failed ? 1 : 0);
