/* Проверка логики версионирования: middleware и скрипт должны одинаково
   подставлять ?v= в ссылки на ассеты и не трогать картинки.
   Запуск: node scripts/_test-versioning.mjs */
import fs from 'node:fs';

let fails = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')); }
};

const middleware = fs.readFileSync('functions/_middleware.js', 'utf8');
const script = fs.readFileSync('scripts/version-assets.mjs', 'utf8');

console.log('\n1. Middleware: подстановка версии');
{
  const reMatch = /const ASSET_RE = (\/.*\/g);/.exec(middleware);
  ok(!!reMatch, 'в middleware есть регулярка для ссылок');
  const re = eval(reMatch[1]);
  const version = 'abc123';

  const cases = [
    ['<link rel="stylesheet" href="/site.css">', '/site.css?v=abc123'],
    ['<script src="/assets/ca-home.js" defer></script>', '/assets/ca-home.js?v=abc123'],
    ['<script src="/assets/ca-bracket-engine.js"></script>', '/assets/ca-bracket-engine.js?v=abc123'],
    ['<script src="/assets/ca-data.js?v=old" defer></script>', '/assets/ca-data.js?v=abc123']
  ];
  cases.forEach(([input, expected]) => {
    const out = input.replace(re, (all, pre, path, old, post) => pre + path + '?v=' + version + post);
    ok(out.includes(expected), 'правит: ' + input.slice(0, 42), out);
  });

  const untouched = [
    '<img src="/img/photo.png">',
    '<a href="/schedule.html">Расписание</a>',
    '<link rel="icon" href="/favicon.png">',
    '<script src="https://example.com/x.js"></script>',
    '<a href="/assets/logo.svg">логотип</a>'
  ];
  untouched.forEach((input) => {
    const out = input.replace(re, (all, pre, path, old, post) => pre + path + '?v=' + version + post);
    ok(out === input, 'не трогает: ' + input.slice(0, 42), out);
  });

  ok(/try\s*\{/.test(middleware) && /catch/.test(middleware), 'при ошибке возвращает страницу как есть');
  ok(/Cache-Control', 'no-store/.test(middleware), 'HTML отдаётся без кеша');
  ok(/CF_PAGES_COMMIT_SHA/.test(middleware), 'версия берётся из окружения Pages');
}

console.log('\n2. Скрипт версионирования: все страницы');
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

console.log('\n3. Кеш-политика');
{
  const headers = fs.readFileSync('_headers', 'utf8');
  ok(/\/assets\/\*/.test(headers) && /immutable/.test(headers),
    'ассеты можно кешировать надолго — адрес меняется с версией');
  ok(/must-revalidate/.test(headers), 'HTML перепроверяется');
}

console.log(fails ? '\nПРОВАЛЕНО: ' + fails : '\nвсе проверки пройдены');
process.exit(fails ? 1 : 0);
