/* Проверка окна просмотра сетки в реальном Chrome: открытие, свободная
   прокрутка вбок и вниз, закрытие кнопкой/Esc. Требует запущенного сервера.
   Запуск: node scripts/_verify-viewer.mjs [url] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PAGE = process.argv[2] || 'http://127.0.0.1:4173/index.html';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9226;
const profile = path.join(process.cwd(), '.tmp-chrome-viewer');
fs.mkdirSync(profile, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--disable-crash-reporter', '--disable-breakpad',
  '--user-data-dir=' + profile, '--window-size=1440,900',
  '--remote-debugging-port=' + PORT, PAGE
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const page = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)[0];
      if (page) return page;
    } catch { /* ждём */ }
    await sleep(250);
  }
  throw new Error('не дождались Chrome');
}

let id = 0;
function send(ws, method, params) {
  return new Promise((resolve, reject) => {
    const msgId = ++id;
    const onMessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id !== msgId) return;
      ws.removeEventListener('message', onMessage);
      if (data.error) reject(new Error(method + ': ' + data.error.message));
      else resolve(data.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
  });
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve));
await send(ws, 'Page.enable');
await sleep(4000);

let fails = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')); }
};

async function evaluate(expression) {
  const res = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    throw new Error('ошибка в выражении: ' + (res.exceptionDetails.exception && res.exceptionDetails.exception.description));
  }
  return res.result.value;
}

const before = JSON.parse(await evaluate(`JSON.stringify((function(){
  var v=document.getElementById('bracketViewer');
  return { hidden: !v || v.hasAttribute('hidden'), preview: Math.round(document.getElementById('bracketScroll').getBoundingClientRect().height) };
})())`));
ok(before.hidden, 'окно закрыто до клика');
ok(before.preview > 0 && before.preview <= 600, 'превью компактное', before.preview);

await evaluate(`document.getElementById('bracketExpand').click()`);
await sleep(1200);

const opened = JSON.parse(await evaluate(`JSON.stringify((function(){
  var v=document.getElementById('bracketViewer');
  var c=document.getElementById('bracketViewerCanvas');
  var b=document.getElementById('bracketViewerBracket');
  var panel=document.querySelector('.bview-panel').getBoundingClientRect();
  return {
    open: !v.hasAttribute('hidden'),
    panel: [Math.round(panel.width), Math.round(panel.height)],
    viewport: [innerWidth, innerHeight],
    scrollW: c.scrollWidth, clientW: c.clientWidth,
    scrollH: c.scrollHeight, clientH: c.clientHeight,
    cards: b.querySelectorAll('.match').length,
    paths: b.parentNode.querySelectorAll('.b-lines path').length,
    bodyLocked: document.body.classList.contains('bview-open')
  };
})())`));
ok(opened.open, 'клик по кнопке открыл окно');
ok(opened.panel[0] > opened.viewport[0] * 0.9 && opened.panel[1] > opened.viewport[1] * 0.9,
  'панель занимает почти весь экран', JSON.stringify(opened.panel));
ok(opened.cards > 0, 'в окне нарисованы карточки', opened.cards);
ok(opened.paths > 0, 'линии связей нарисованы', opened.paths);
ok(opened.bodyLocked, 'фон страницы заблокирован от прокрутки');
ok(opened.scrollW > opened.clientW, 'полотно шире окна — есть прокрутка вбок',
  opened.scrollW + ' > ' + opened.clientW);
ok(opened.scrollH > opened.clientH, 'полотно выше окна — есть прокрутка вниз',
  opened.scrollH + ' > ' + opened.clientH);

/* Свободная прокрутка: вбок и вниз независимо, оба ползунка на одном контейнере */
const scrolled = JSON.parse(await evaluate(`(function(){
  var c=document.getElementById('bracketViewerCanvas');
  c.scrollLeft = 400; c.scrollTop = 700;
  return JSON.stringify({ left: c.scrollLeft, top: c.scrollTop });
})()`));
ok(scrolled.left > 0 && scrolled.top > 0, 'полотно листается и вбок, и вниз', JSON.stringify(scrolled));

/* Снимок самого окна просмотра — в начале полотна */
await evaluate(`(function(){ var c=document.getElementById('bracketViewerCanvas'); c.scrollTop=0; c.scrollLeft=0; return true; })()`);
await sleep(400);
const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('.tmp-viewer.png', Buffer.from(shot.data, 'base64'));

/* Клик по карточке внутри окна не должен закрывать окно */
await evaluate(`(function(){ var s=document.querySelector('#bracketViewerBracket .slot[data-team]'); if (s) s.click(); return true; })()`);
await sleep(300);
const stillOpen = await evaluate(`String(document.getElementById('bracketViewer').hasAttribute('hidden'))`);
ok(stillOpen === 'false', 'клик по команде внутри окна окно не закрывает', stillOpen);

/* Диалог команды должен оказаться поверх окна просмотра */
const layering = await evaluate(`(function(){
  var d=document.getElementById('teamDialog');
  if (!d) return 'нет диалога';
  var z=getComputedStyle(d).zIndex;
  return String(d.hasAttribute('hidden')) + '|' + z;
})()`);
ok(/^false\|/.test(String(layering)), 'диалог команды открывается поверх окна', layering);
await evaluate(`(function(){ var d=document.getElementById('teamDialog'); if (d) { var b=d.querySelector('[data-close],.dlg-close,button'); if (b) b.click(); } return true; })()`);
await sleep(300);

/* Закрытие */
await evaluate(`document.getElementById('bracketViewerClose').click()`);
await sleep(600);
const closedByButton = await evaluate(`String(document.getElementById('bracketViewer').hasAttribute('hidden'))`);
ok(closedByButton === 'true', 'кнопка «Свернуть» закрывает окно', closedByButton);
const unlocked = await evaluate(`String(document.body.classList.contains('bview-open'))`);
ok(unlocked === 'false', 'прокрутка страницы разблокирована', unlocked);

await evaluate(`document.getElementById('bracketExpand').click()`);
await sleep(700);
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
await sleep(500);
const closedByEsc = await evaluate(`String(document.getElementById('bracketViewer').hasAttribute('hidden'))`);
ok(closedByEsc === 'true', 'Esc закрывает окно', closedByEsc);

ws.close();
chrome.kill();
console.log(fails ? '\nПРОВАЛЕНО: ' + fails : '\nвсе проверки пройдены');
process.exit(fails ? 1 : 0);
