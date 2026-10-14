/* Проверка синтаксиса: модули в assets/ и inline-скрипты в HTML (+валидность JSON-LD).
   Запуск: node tests/syntax.mjs */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
let fails = 0;
const check = (cond, label, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'ok   ' : 'FAIL ') + label + (cond || extra === undefined ? '' : ' — ' + extra));
};

/* 1. Модули страниц */
const files = fs.readdirSync(path.join(ROOT, 'assets')).filter((f) => f.endsWith('.js')).sort();
for (const f of files) {
  const code = fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8');
  let err = null;
  try { new Function(code); } catch (e) { err = e.message; }
  check(!err, 'assets/' + f, err);
}

/* 2. Inline-скрипты и JSON-LD в страницах */
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
for (const page of pages) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const blocks = Array.from(html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g))
    .filter((m) => !/\bsrc=/.test(m[1]))
    .map((m) => {
      const t = m[1].match(/type="([^"]+)"/);
      return { type: t ? t[1] : 'text/javascript', code: m[2] };
    });

  const js = blocks.filter((b) => b.type === 'text/javascript');
  const json = blocks.filter((b) => b.type === 'application/ld+json');
  let err = null;
  for (const b of js) {
    try { new Function(b.code); } catch (e) { err = e.message; break; }
  }
  check(!err, page + ': inline-JS (' + js.length + ')', err);

  let jsonErr = null;
  for (const b of json) {
    try { JSON.parse(b.code); } catch (e) { jsonErr = e.message; break; }
  }
  check(!jsonErr, page + ': JSON-LD (' + json.length + ')', jsonErr);
}

console.log(fails ? '\nПровалено проверок: ' + fails : '\nВсе проверки пройдены');
process.exit(fails ? 1 : 0);
