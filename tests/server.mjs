/* Локальный статический сервер для ручной проверки и скриншотов.
   Запуск: node tests/server.mjs                    (состояние post по умолчанию)
           $env:CA_FIXTURE='live'; node tests/server.mjs
   Порт: 4173 (или $env:CA_PORT).

   /api/save здесь по-настоящему сохраняет состояние в память процесса:
   сгенерированная в админке сетка сразу видна на главной и в расписании
   (до перезапуска сервера). Пароль не проверяем — это локальная песочница. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES } from './fixtures.mjs';

const ROOT = process.cwd();
const PORT = Number(process.env.CA_PORT || 4173);
const PHASE = process.env.CA_FIXTURE || 'post';

/* Текущее состояние «KV» в памяти: стартуем с фикстуры.
   Если рядом лежит tests/fixture-bracket.json (сгенерированная сетка для
   визуальной проверки) — берём её. */
const STATE = { data: loadInitial() };
if (!Array.isArray(STATE.data.history)) STATE.data.history = [];

function loadInitial() {
  const generated = path.join(ROOT, 'tests/fixture-bracket.json');
  if (fs.existsSync(generated)) {
    try {
      console.log('[server] состояние из tests/fixture-bracket.json');
      return JSON.parse(fs.readFileSync(generated, 'utf8'));
    } catch (err) {
      console.warn('[server] fixture-bracket.json не прочитался:', err.message);
    }
  }
  return JSON.parse(JSON.stringify(FIXTURES[PHASE] || FIXTURES.post));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

function sendJson(res, body, status = 200) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch { resolve(null); }
    });
  });
}

/** Страница-щуп: грузит сетку с данными сервера и печатает геометрию карточек */
function probePage() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<link rel="stylesheet" href="/site.css">
<style>body{background:#0a0d12;color:#e8e8ea;font-family:monospace;padding:20px}
pre{white-space:pre-wrap}</style></head>
<body>
<div class="bracket-scroll" id="bracketScroll"><div class="bracket" id="bracketWrap"></div></div>
<pre id="out">…</pre>
<script src="/assets/ca-data.js"></script>
<script src="/assets/ca-bracket-engine.js"></script>
<script src="/assets/ca-ui.js"></script>
<script src="/assets/ca-bracket.js"></script>
<script>
fetch('/api/data').then(function (r) { return r.json(); }).then(function (raw) {
  var D = CA.data.setRaw(raw);
  var wrap = document.getElementById('bracketWrap');
  CA.bracket.render(wrap, { data: D });
  setTimeout(function () {
    var box = wrap.querySelector('.bracket') || wrap;
    var boxRect = box.getBoundingClientRect();
    var cards = Array.prototype.map.call(wrap.querySelectorAll('.match'), function (el) {
      var r = el.getBoundingClientRect();
      return {
        id: Number(el.getAttribute('data-match')),
        col: el.style.gridColumn,
        row: el.style.gridRow,
        top: Math.round(r.top - boxRect.top),
        bottom: Math.round(r.bottom - boxRect.top),
        h: Math.round(r.height)
      };
    });
    var cols = Array.prototype.map.call(wrap.querySelectorAll('.b-col-head'), function (el) {
      var r = el.getBoundingClientRect();
      return { text: el.querySelector('b').textContent, col: el.style.gridColumn, top: Math.round(r.top - boxRect.top) };
    });
    var overlaps = [];
    for (var i = 0; i < cards.length; i++) {
      for (var j = i + 1; j < cards.length; j++) {
        var a = cards[i], b = cards[j];
        if (a.col !== b.col) continue;
        if (a.top < b.bottom && b.top < a.bottom) overlaps.push(a.id + '×' + b.id);
      }
    }
    var D2 = CA.data.get();
    var centerErrors = [];
    (D2.matches || []).forEach(function (m) {
      [m.from1, m.from2].forEach(function (src) {
        if (!src) return;
        var from = cards.filter(function (c) { return c.id === src.m; })[0];
        var to = cards.filter(function (c) { return c.id === m.id; })[0];
        if (!from || !to) return;
        centerErrors.push({ from: src.m, to: m.id,
          dy: Math.round(((to.top + to.bottom) / 2) - ((from.top + from.bottom) / 2)) });
      });
    });
    document.getElementById('out').textContent = JSON.stringify({
      cols: cols, cards: cards, overlaps: overlaps,
      colsCount: box.getAttribute('data-cols'), rows: box.getAttribute('data-rows'),
      bracketHeight: Math.round(boxRect.height), centerErrors: centerErrors
    }, null, 1);
    document.title = 'ready';
  }, 1200);
});
</script>
</body></html>`;
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('[server] ошибка обработки ' + req.url + ':', err && err.message);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': MIME['.txt'] });
    if (!res.writableEnded) res.end('server error');
  });
});

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/data') {
    sendJson(res, STATE.data);
    return;
  }

  if (pathname === '/api/save' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body || !body.data || typeof body.data !== 'object') {
      res.writeHead(400).end('bad request');
      return;
    }
    /* Состояние заменяем целиком — как делает реальный /api/save */
    STATE.data = JSON.parse(JSON.stringify(body.data));
    console.log('[server] сохранено: команд ' + (STATE.data.teams || []).length +
      ', матчей ' + (STATE.data.matches || []).length +
      (STATE.data.bracket ? ', сетка ' + STATE.data.bracket.format + ' на ' + STATE.data.bracket.teamCount : ''));
    sendJson(res, { ok: true });
    return;
  }

  if (pathname === '/') pathname = '/index.html';

  /* Разовая отладочная страница замера геометрии (её отдаёт scripts/_measure.mjs) */
  if (pathname === '/measure-tmp.html') {
    const measureFile = path.join(ROOT, '.tmp-measure.html');
    if (fs.existsSync(measureFile)) {
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(measureFile, 'utf8'));
    } else {
      res.writeHead(404, { 'Content-Type': MIME['.json'] });
      res.end('{"error":"нет .tmp-measure.html — запустите node scripts/_measure.mjs"}');
    }
    return;
  }

  /* Отладочная страница: отдаёт геометрию карточек сетки, чтобы проверять
     раскладку в реальном браузере (chrome --headless --dump-dom /probe.html) */
  if (pathname === '/probe.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    res.end(probePage());
    return;
  }
  const file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const notFound = path.join(ROOT, '404.html');
    if (fs.existsSync(notFound)) {
      res.writeHead(404, { 'Content-Type': MIME['.html'] });
      res.end(fs.readFileSync(notFound));
    } else {
      res.writeHead(404);
      res.end('not found');
    }
    return;
  }

  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

server.listen(PORT, '127.0.0.1', () => {
  console.log('Compass Arena test server: http://127.0.0.1:' + PORT + '/  (state: ' + PHASE + ')');
  console.log('Админка: http://127.0.0.1:' + PORT + '/poasalj1.z23.html (пароль любой, сохранение — в память)');
});
