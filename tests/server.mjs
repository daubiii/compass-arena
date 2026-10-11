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

/* Текущее состояние «KV» в памяти: стартуем с фикстуры */
const STATE = { data: JSON.parse(JSON.stringify(FIXTURES[PHASE] || FIXTURES.post)) };
if (!Array.isArray(STATE.data.history)) STATE.data.history = [];

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

const server = http.createServer(async (req, res) => {
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
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Compass Arena test server: http://127.0.0.1:' + PORT + '/  (state: ' + PHASE + ')');
  console.log('Админка: http://127.0.0.1:' + PORT + '/poasalj1.z23.html (пароль любой, сохранение — в память)');
});
