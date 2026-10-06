/* Локальный статический сервер для ручной проверки и скриншотов.
   Запуск: node tests/server.mjs           (состояние post по умолчанию)
           $env:CA_FIXTURE='live'; node tests/server.mjs
   Порт: 4173 (или $env:CA_PORT). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES } from './fixtures.mjs';

const ROOT = process.cwd();
const PORT = Number(process.env.CA_PORT || 4173);
const PHASE = process.env.CA_FIXTURE || 'post';

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/data') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(FIXTURES[PHASE] || FIXTURES.post));
    return;
  }
  if (pathname === '/api/save') {
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify({ ok: true }));
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
});
