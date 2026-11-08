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
  w.fetch = async (u) => { const g = (String(u).match(/game=(\w+)/) || [])[1]; const empty = g && g !== 'dota2'; return { ok: true, json: async () => empty ? { game: g, teams: [], matches: [] } : fixture }; };
  for (const f of scripts) {
    try { w.eval(read('assets/' + f)); } catch (e) { throw new Error(f + ': ' + e.message); }
  }
  return dom;
}

const HOME = ['ca-data.js', 'ca-ui.js', 'ca-views.js', 'ca-bracket.js', 'ca-bracket-viewer.js', 'ca-home.js'];
const SCHED = ['ca-games.js', 'ca-data.js', 'ca-ui.js', 'ca-views.js', 'ca-schedule.js'];
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
  ok((d.querySelector('#bracketWrap .match').getAttribute('style') || '').includes('left:'), 'карточка расставлена по координатам полотна');
  ok(!!d.querySelector('#bracketWrap .bracket'), 'сетка собрана в контейнер .bracket');
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

/* ---------------- текущий турнир: настройка из админки ---------------- */
function makeConfigured(file, scripts, settings, teamsByGame) {
  const seen = [];
  const dom = makeDom(file, PRE, ['ca-games.js']);   /* страница + реестр игр, остальное подключим ниже */
  const w = dom.window;
  w.fetch = async (u) => {
    u = String(u); seen.push(u);
    if (u.indexOf('/api/settings') >= 0) return { ok: true, json: async () => settings };
    const g = (u.match(/game=(\w+)/) || [])[1] || 'dota2';
    return { ok: true, json: async () => ({ game: g, teams: teamsByGame[g] || [], matches: [], tournamentStart: new Date(Date.now() + 5 * 86400000).toISOString() }) };
  };
  for (const f of scripts) w.eval(read('assets/' + f));
  return { dom, seen };
}
const cfg = { configured: true, current: 'csgo', season: '2 сезон', prize: { enabled: true, perTeam: 1000, base: 500, note: 'Пояснение' } };
const six = [1, 2, 3, 4, 5, 6].map((i) => ({ id: i, name: 'Vitality' + i, players: [] }));

console.log('\nindex.html — настроен текущий турнир (CS2)');
{
  const { dom, seen } = makeConfigured('index.html', HOME, cfg, { csgo: six });
  await sleep(1500);   /* число в банке набегает ~1,1 с */
  const d = dom.window.document;
  ok(seen.filter((u) => u.indexOf('/api/data') >= 0).every((u) => u.indexOf('game=csgo') >= 0) && seen.some((u) => u.indexOf('/api/data') >= 0), 'грузится только CS2', seen.join(' '));
  ok(d.documentElement.getAttribute('data-game') === 'csgo', 'тема CS2');
  ok(d.body.classList.contains('is-locked'), 'переключатель дисциплин скрыт');
  ok(d.getElementById('gameBar').children.length === 0, 'вкладки игр не отрисованы');
  ok(d.getElementById('prize').hidden === false, 'банк призовых показан');
  ok(d.getElementById('navPrize').hidden === false, 'пункт «Призовые» в меню');
  ok(d.getElementById('prizeAmount').textContent.replace(/\s/g, '').indexOf('6500') === 0, 'банк = 500 + 6 × 1000', d.getElementById('prizeAmount').textContent);
  ok(!/1\s?000|1000/.test(d.getElementById('prizeRule').textContent) && /Каждая команда/.test(d.getElementById('prizeRule').textContent), 'зрители не видят формулу, только «каждая команда растит банк»', d.getElementById('prizeRule').textContent);
  ok(!d.getElementById('prizeLadder') && !d.getElementById('prizeBase'), 'ступеней «N команд = N ₽» нет');
  ok(d.getElementById('heroKicker').textContent.indexOf('2 сезон') >= 0, 'сезон в заголовке', d.getElementById('heroKicker').textContent);
  ok(d.getElementById('prizeNote').textContent === 'Пояснение', 'пояснение под банком');
}

console.log('\nindex.html — настройка не задана: всё как раньше');
{
  const { dom } = makeConfigured('index.html', HOME, { configured: false, current: 'dota2', season: '', prize: { enabled: true, perTeam: 1000, base: 0, note: '' } }, {});
  await sleep(200);
  const d = dom.window.document;
  ok(!d.body.classList.contains('is-locked') && d.getElementById('gameBar').children.length === 4, 'переключатель на месте');
  ok(d.getElementById('prize').hidden === true, 'банк скрыт');
}

console.log('\nschedule.html — настроен текущий турнир');
{
  const { dom, seen } = makeConfigured('schedule.html', ['ca-data.js', 'ca-ui.js', 'ca-views.js', 'ca-schedule.js'], cfg, { csgo: six });
  await sleep(200);
  const d = dom.window.document;
  const dataCalls = seen.filter((u) => u.indexOf('/api/data') >= 0);
  ok(dataCalls.length === 1 && dataCalls[0].indexOf('game=csgo') >= 0, 'запрошена одна дисциплина', dataCalls.join(' '));
  ok(d.getElementById('gameFilters').hidden === true, 'фильтр игр скрыт');
  ok(d.getElementById('curTournament').hidden === false && d.getElementById('curTournament').textContent.indexOf('CS2') >= 0, 'плашка текущего турнира', d.getElementById('curTournament').textContent);
  ok(/\d+ д \d\d:\d\d:\d\d/.test(d.querySelector('#curTournament .ct-count').textContent), 'отсчёт до старта', d.querySelector('#curTournament .ct-count').textContent);
}

console.log(fails ? '\nПровалено проверок: ' + fails : '\nВсе проверки пройдены');
process.exit(fails ? 1 : 0);
