/* Проверка логики версионирования: скрипт должен подставлять ?v= в ссылки на ассеты и не трогать картинки.
   Запуск: node scripts/_test-versioning.mjs */
import fs from 'node:fs';

let fails = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')); }
};

const script = fs.readFileSync('scripts/version-assets.mjs', 'utf8');

console.log('\n1. Скрипт версионирования: все страницы');
{
  const pages = ['index.html', 'schedule.html', 'history.html', 'rules.html', '404.html', 'poasalj1.z23.html'];
  pages.forEach((page) => {
    const html = fs.readFileSync(page, 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="(\/?(?:assets\/[^"?]+|site\.css))(\?v=[^"]*)?"/g)];
    const missing = refs.filter((m) => !m[2]);
    ok(refs.length > 0 && missing.length === 0,
      page + ': ссылок ' + refs.length + ', без версии ' + missing.length,
      missing.map((m) => m[1]).join(', '));
  });

  /* Версия во всех страницах должна совпадать */
  const versions = new Set();
  pages.forEach((page) => {
    [...fs.readFileSync(page, 'utf8').matchAll(/\?v=([^"]+)"/g)].forEach((m) => versions.add(m[1]));
  });
  ok(versions.size === 1, 'на всех страницах одна версия', [...versions].join(', '));

  ok(/ASSET_RE/.test(script) && /git rev-parse/.test(script), 'скрипт берёт версию из git (или даты)');
  ok(/-check/.test(script), 'у скрипта есть режим проверки --check');
}

console.log('\n2. Кеш-политика');
{
  const headers = fs.readFileSync('_headers', 'utf8');
  ok(/\/assets\/\*/.test(headers) && /immutable/.test(headers),
    'ассеты можно кешировать надолго — адрес меняется с версией');
  ok(/must-revalidate/.test(headers), 'HTML перепроверяется');
}

console.log(fails ? '\nПРОВАЛЕНО: ' + fails : '\nвсе проверки пройдены');
process.exit(fails ? 1 : 0);
