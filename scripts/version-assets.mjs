/* Версионирование ассетов: проставляет ?v=<версия> у ссылок на скрипты и стили
   во всех HTML-страницах. Браузер считает такой адрес новым ресурсом, поэтому
   после деплоя никто не увидит старую сетку из кеша.

   Запуск:
     node scripts/version-assets.mjs            — версия из текущего коммита git
     node scripts/version-assets.mjs 2026-10-12 — своя версия
     node scripts/version-assets.mjs --check     — только проверить, всё ли версионировано

   Запускать перед пушем: npm run version:assets */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const PAGES = ['index.html', 'schedule.html', 'history.html', 'rules.html', '404.html', 'poasalj1.z23.html'];
const ASSET_RE = /(\s(?:src|href)=")(\/?(?:assets\/[^"?]+\.(?:js|css)|site\.css))(\?v=[^"]*)?(")/g;

function currentVersion() {
  const arg = process.argv[2];
  if (arg && !arg.startsWith('--')) return arg;
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    /* git нет — берём дату, она тоже меняется от релиза к релизу */
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }
}

/** Переписывает ссылки на ассеты в одном файле; возвращает число правок */
function versionFile(file, version, checkOnly) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return 0;
  const before = fs.readFileSync(full, 'utf8');
  let changed = 0;
  const after = before.replace(ASSET_RE, (all, pre, url, old, post) => {
    const clean = url.replace(/^\.\//, '');
    const next = pre + clean + '?v=' + version + post;
    if (next !== all) changed++;
    return next;
  });
  void checkOnly;
  if (changed && !checkOnly) fs.writeFileSync(full, after, 'utf8');
  return changed;
}

const checkOnly = process.argv.includes('--check');
const version = currentVersion();
let total = 0;
const report = [];

PAGES.forEach((page) => {
  const changed = versionFile(page, version, checkOnly);
  total += changed;
  if (changed) report.push('  ' + page + ': ' + changed);
});

if (checkOnly) {
  if (total) {
    console.log('Не все ссылки на ассеты версионированы (нужно ' + total + ' правок):');
    console.log(report.join('\n'));
    console.log('\nЗапустите: npm run version:assets');
    process.exit(1);
  }
  console.log('все ссылки на ассеты версионированы');
  process.exit(0);
}

if (!total) {
  console.log('версия уже стоит: ' + version);
} else {
  console.log('версия ' + version + ' проставлена:');
  console.log(report.join('\n'));
  console.log('\nНе забудьте запушить изменённые HTML-страницы.');
}
