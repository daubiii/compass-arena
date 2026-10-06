/* Smoke-тест публичных страниц в jsdom.
   Запуск: node tests/smoke.mjs   (из корня проекта, нужен jsdom) */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { PRE, LIVE, POST } from './fixtures.mjs';

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')); }
}

function makeDom(file, fixture, scripts) {
  let html = read(file).replace(/<script src="[^"]+"[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'https://compassarena.ru/' + file.replace('index.html', ''),
    pretendToBeVisual: true,
    runScripts: 'dangerously'
  });
  const w = dom.window;
  w.fetch = async () => ({ ok: true, json: async () => fixture });
  for (const f of scripts) {
    try { w.eval(read('assets/' + f)); } catch (e) { throw new Error(f + ': ' + e.message); }
  }
  return dom;
}

const HOME = ['ca-data.js', 'ca-ui.js', 'ca-views.js', 'ca-bracket.js', 'ca-home.js'];
const SCHED = ['ca-data.js', 'ca-ui.js', 'ca-views.js', 'ca-schedule.js'];
const HIST = ['ca-data.js', 'ca-ui.js', 'ca-views.js', 'ca-history.js'];

/* ---------------- главная ---------------- */
console.log('\nindex.html — состояние pre');
{
  const dom = makeDom('index.html', PRE, HOME);
  await sleep(120);
  const d = dom.window.document;
  ok(d.body.dataset.phase === 'pre', 'фаза pre', d.body.dataset.phase);
  ok(!!d.querySelector('#heroStatus .cd'), 'отсчёт отрисован');
  ok(d.querySelector('#cdDays') && d.querySelector('#cdDays').textContent !== '--', 'дни заполнены');
  ok(d.querySelectorAll('#bracketWrap .match').length === 5, 'пять карточек в сетке');
  ok((d.querySelector('#bracketWrap .match').getAttribute('style') || '').includes('grid-area'), 'карточка имеет grid-area');
  ok(d.querySelectorAll('#teamsGrid .team-card').length === 6, 'шесть карточек команд');
  ok(!d.querySelector('#schedulePreviewList').textContent.includes('Загрузка'), 'превью расписания отрисовано');
  ok(d.querySelector('#championSection').hidden === true, 'блок чемпиона скрыт');
  ok(d.querySelector('#streamWaiting').hidden === false, 'карточка ожидания эфира видна');
  ok(d.querySelector('#streamLive').hidden === true, 'плеер скрыт');
  ok(d.querySelector('#next-season').hidden === true, 'следующий сезон скрыт');
  ok(!!d.getElementById('ca-sprite'), 'спрайт иконок вставлен');
  ok(!!d.getElementById('ca-schema'), 'JSON-LD добавлен');
  ok(d.querySelector('#phaseNote').textContent.includes('МСК'), 'подпись про МСК');
  ok(d.querySelectorAll('img:not([alt])').length === 0, 'у всех img есть alt');
}

console.log('\nindex.html — состояние live');
{
  const dom = makeDom('index.html', LIVE, HOME);
  await sleep(120);
  const d = dom.window.document;
  ok(d.body.dataset.phase === 'live', 'фаза live', d.body.dataset.phase);
  ok(!!d.querySelector('#heroStatus .nm'), 'блок следующего матча');
  ok(d.querySelector('#streamLive').hidden === false, 'плеер показан');
  ok(d.querySelector('#streamWaiting').hidden === true, 'ожидание скрыто');
  ok(d.querySelector('#streamPosterTitle').textContent.includes('включайтесь'), 'заголовок постера');
  ok(d.querySelectorAll('#bracketWrap .match.is-live').length === 1, 'матч помечен live');
  ok(d.querySelector('#headProgress').style.getPropertyValue('--p') !== '', 'прогресс-бар заполнен');
}

console.log('\nindex.html — состояние post');
{
  const dom = makeDom('index.html', POST, HOME);
  await sleep(120);
  const d = dom.window.document;
  ok(d.body.dataset.phase === 'post', 'фаза post', d.body.dataset.phase);
  ok(d.querySelector('#championSection').hidden === false, 'блок чемпиона показан');
  ok(d.querySelector('#championBanner').textContent.includes('Team Spirit'), 'имя чемпиона в баннере');
  ok(d.querySelector('#champChip').classList.contains('visible'), 'плашка чемпиона видна');
  ok(d.querySelector('#next-season').hidden === false, 'блок следующего сезона показан');
  ok(d.querySelector('#nextSeasonBody').textContent.includes('второй сезон'), 'контент следующего сезона');
  ok(d.querySelector('#archiveSection').hidden === false, 'архив показан');
  ok(d.querySelectorAll('#archiveList .season-card').length === POST.history.length, 'карточки сезонов в архиве', d.querySelectorAll('#archiveList .season-card').length);
  ok(d.querySelectorAll('#bracketWrap .match.is-champion').length === 1, 'гранд-финал помечен чемпионским');
  ok(d.querySelectorAll('#bracketWrap .match.is-done').length === 5, 'все матчи сыграны');
  ok(d.querySelectorAll('.out-item').length > 0, 'список выбывших не пуст');
  ok(d.querySelectorAll('#schedulePreviewList .s-row').length > 0, 'превью расписания не пусто');
  ok(d.querySelector('#heroTitle').textContent.includes('Team Spirit'), 'заголовок про чемпиона');

  const card = d.querySelector('#teamsGrid .team-card');
  card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await sleep(160);
  ok(d.querySelector('#teamDialog').classList.contains('active'), 'диалог команды открылся');
  ok(d.querySelector('#teamDialogName').textContent.length > 0, 'имя в диалоге');
  ok(d.querySelector('#teamDialogStats').textContent.includes('Победы'), 'статистика в диалоге');
}

/* ---------------- расписание ---------------- */
console.log('\nschedule.html — состояние live');
{
  const dom = makeDom('schedule.html', LIVE, SCHED);
  await sleep(120);
  const d = dom.window.document;
  ok(d.body.dataset.phase === 'live', 'фаза live', d.body.dataset.phase);
  ok(d.querySelectorAll('#filters .chip-f').length === 5, 'пять фильтров');
  ok(d.querySelector('#nextCard .nc-teams').textContent.includes('Team Spirit'), 'карточка следующего матча');
  ok(!!d.querySelector('#ncCount b'), 'таймер до матча');
  ok(d.querySelectorAll('#scheduleList .s-row').length >= 3, 'строки расписания');
  ok(d.querySelectorAll('#scheduleList .day').length >= 1, 'группировка по дням');
  ok(d.querySelectorAll('#scheduleList .s-row.is-live').length === 1, 'матч в эфире подсвечен');
  ok(d.querySelectorAll('#scheduleList a[download$=".ics"]').length >= 2, 'ссылки «в календарь»');
  ok(d.querySelector('#scheduleList').textContent.includes('Раунд 1'), 'стадия в строке');

  const doneChip = Array.from(d.querySelectorAll('#filters .chip-f')).find((b) => b.dataset.filter === 'done');
  doneChip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  ok(d.querySelectorAll('#scheduleList .s-row').length === 0, 'фильтр «сыгранные» пуст в лайве');
}

console.log('\nschedule.html — состояние post');
{
  const dom = makeDom('schedule.html', POST, SCHED);
  await sleep(120);
  const d = dom.window.document;
  ok(d.body.dataset.phase === 'post', 'фаза post', d.body.dataset.phase);
  ok(d.querySelectorAll('#scheduleList .s-row').length === 5, 'все пять матчей');
  const vodCount = POST.matches.filter((m) => m.vod).length;
  ok(d.querySelectorAll('#scheduleList a[href*="twitch.tv/videos"]').length === vodCount, 'VOD-ссылки', d.querySelectorAll('#scheduleList a[href*="twitch.tv/videos"]').length);
  ok(d.querySelectorAll('#scheduleList .s-row.done').length === 5, 'все строки помечены сыгранными');
  ok(d.querySelectorAll('#scheduleList .sc').length === 5, 'счёт серий показан');
  ok(d.querySelector('#scheduleList').textContent.includes('Гранд-финал'), 'стадия гранд-финала');
}

/* ---------------- архив ---------------- */
if (exists('assets/ca-history.js')) {
  console.log('\nhistory.html — архив');
  const dom = makeDom('history.html', POST, HIST);
  await sleep(160);
  const d = dom.window.document;
  ok(d.querySelectorAll('img:not([alt])').length === 0, 'у всех img есть alt');
  ok(d.querySelectorAll('[id^="ch-"]').length >= 2, 'главы с якорями #ch-*');
  ok(!d.body.textContent.includes('Загрузка'), 'контент отрисован');

  const empty = makeDom('history.html', { ...POST, history: [] }, HIST);
  await sleep(160);
  ok(empty.window.document.body.textContent.length > 200, 'пустое состояние не «дыра»');
}

/* ---------------- правила и 404 ---------------- */
console.log('\nrules.html / 404.html');
{
  const dom = makeDom('rules.html', {}, ['ca-ui.js', 'ca-rules.js']);
  await sleep(80);
  const d = dom.window.document;
  ok(!!d.getElementById('ca-sprite'), 'спрайт на странице правил');
  ok(d.querySelectorAll('#toc a').length === 6, 'оглавление из 6 пунктов');
  ok(d.querySelectorAll('.reveal.in').length > 0, 'блоки правил раскрыты');
  ok(d.getElementById('year').textContent.length === 4, 'год в подвале');
  ok(d.querySelectorAll('.rule').length === 5, 'пять разделов регламента');
}
{
  const dom = makeDom('404.html', {}, ['ca-ui.js']);
  await sleep(60);
  const d = dom.window.document;
  ok(!!d.getElementById('ca-sprite'), 'спрайт на 404');
  ok(d.querySelector('.err-code').textContent.trim() === '404', 'код 404');
  ok(d.querySelectorAll('.err-actions a').length === 3, 'ссылки на 404');
}

console.log(fails ? '\nПровалено проверок: ' + fails : '\nВсе проверки пройдены');
process.exit(fails ? 1 : 0);
