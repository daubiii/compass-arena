/* Аудит разметки и CSS: баланс скобок, ссылки на id, локальные ссылки.
   Запуск: node tests/audit.mjs */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
let fails = 0;

function check(cond, label, extra) {
  if (!cond) fails++;
  console.log((cond ? 'ok   ' : 'FAIL ') + label + (cond || extra === undefined ? '' : ' — ' + extra));
}

/* 1. Баланс фигурных скобок в CSS */
for (const f of ['site.css']) {
  const s = read(f);
  let depth = 0, line = 1, bad = null;
  for (const ch of s) {
    if (ch === '\n') line++;
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth < 0 && !bad) bad = line; }
  }
  check(depth === 0 && !bad, f + ': скобки сбалансированы', 'глубина ' + depth + (bad ? ', лишняя } в строке ' + bad : ''));
}

/* 2. id, которые JS запрашивает, но которых нет в HTML.
      Часть элементов создаётся скриптами на лету либо необязательна. */
const DYNAMIC = new Set([
  'cdDays', 'cdHours', 'cdMinutes', 'cdSeconds', 'cdAnnounce', 'cdFill', 'cdPercent', 'cdDate',
  'nmCount', 'ncCount', 'ca-schema', 'ca-sprite', 'ca-toast', 'toTop', 'headProgress'
]);

const PAGES = {
  'index.html': ['assets/ca-home.js', 'assets/ca-ui.js', 'assets/ca-bracket.js', 'assets/ca-views.js'],
  'schedule.html': ['assets/ca-schedule.js', 'assets/ca-ui.js', 'assets/ca-views.js'],
  'history.html': ['assets/ca-history.js', 'assets/ca-ui.js', 'assets/ca-views.js'],
  'rules.html': ['assets/ca-rules.js', 'assets/ca-ui.js'],
  '404.html': ['assets/ca-ui.js']
};

for (const [page, scripts] of Object.entries(PAGES)) {
  if (!exists(page)) { console.log('skip ' + page + ' (нет файла)'); continue; }
  const html = read(page);
  const ids = new Set(Array.from(html.matchAll(/id="([^"]+)"/g), (m) => m[1]));
  const used = new Set();
  for (const f of scripts) {
    if (!exists(f)) { check(false, page + ': скрипт на месте', 'нет ' + f); continue; }
    for (const m of read(f).matchAll(/getElementById\('([^']+)'\)/g)) used.add(m[1]);
  }
  const missing = Array.from(used).filter((x) => !ids.has(x) && !DYNAMIC.has(x));
  check(missing.length === 0, page + ': id из JS присутствуют в разметке', missing.join(', '));

  /* 3. Локальные ссылки на файлы */
  const refs = Array.from(html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g), (m) => m[1]);
  const bad = refs.filter((r) => !exists(r.replace(/^\//, '')));
  check(bad.length === 0, page + ': локальные ссылки ведут на существующие файлы', bad.join(', '));
}

/* 4. Ни одна страница не тянет удалённый site.js и не содержит гигантских inline-скриптов */
for (const page of Object.keys(PAGES)) {
  if (!exists(page)) continue;
  const html = read(page);
  const inline = Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g), (m) => m[1]);
  const longest = inline.reduce((n, s) => Math.max(n, s.length), 0);
  check(longest < 600, page + ': нет больших inline-скриптов', longest + ' символов');
}

process.exit(fails ? 1 : 0);
