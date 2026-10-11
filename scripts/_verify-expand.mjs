/* Превью сетки на главной в реальном Chrome: компактный вид, открытие окна
   просмотра по кнопке и по клику в сетке, возврат обратно.
   Требует запущенного сервера. Запуск: node scripts/_verify-expand.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PAGE = process.argv[2] || 'http://127.0.0.1:4173/index.html';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9224;
const profile = path.join(process.cwd(), '.tmp-chrome-cdp2');
fs.mkdirSync(profile, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--disable-crash-reporter', '--disable-breakpad',
  '--user-data-dir=' + profile, '--window-size=1440,1200',
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

async function evaluate(expression) {
  const res = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true });
  if (res.exceptionDetails) {
    const ex = res.exceptionDetails.exception || {};
    throw new Error('ошибка в выражении: ' + (ex.description || res.exceptionDetails.text));
  }
  return res.result.value;
}

async function state() {
  return JSON.parse(await evaluate(`JSON.stringify((function(){
    var box=document.getElementById('bracketWrapBox');
    var btn=document.getElementById('bracketExpand');
    var view=document.getElementById('bracketViewer');
    return {
      compact: box.classList.contains('is-compact'),
      preview: Math.round(document.getElementById('bracketScroll').getBoundingClientRect().height),
      natural: Math.round(document.getElementById('bracketWrap').getBoundingClientRect().height),
      button: getComputedStyle(btn).display !== 'none',
      label: btn.textContent.trim(),
      viewerOpen: !view.hasAttribute('hidden'),
      cursor: getComputedStyle(box).cursor,
      border: getComputedStyle(box).borderTopColor
    };
  })())`));
}

let fails = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')); }
};

const a = await state();
ok(a.compact, 'превью компактное', JSON.stringify(a));
ok(a.preview > 0 && a.preview <= 600, 'превью не выше ограничителя', a.preview);
ok(a.natural > a.preview, 'сетка целиком выше превью (значит есть что разворачивать)', a.natural + ' > ' + a.preview);
ok(a.button, 'кнопка разворота видна');
ok(a.label === 'Развернуть сетку полностью', 'подпись кнопки', a.label);
ok(a.cursor === 'pointer', 'курсор над сеткой — указатель', a.cursor);
ok(!a.viewerOpen, 'окно просмотра закрыто');

await evaluate(`document.querySelector('#bracketWrapBox .match').click()`);
await sleep(900);
const b = await state();
ok(b.viewerOpen, 'клик по карточке открывает окно просмотра', JSON.stringify(b));

await evaluate(`document.getElementById('bracketViewerClose').click()`);
await sleep(700);
const c = await state();
ok(!c.viewerOpen, 'кнопка «Свернуть» возвращает к превью');
ok(c.preview === a.preview, 'превью осталось прежним', a.preview + ' → ' + c.preview);

await evaluate(`document.getElementById('bracketExpand').click()`);
await sleep(900);
ok((await state()).viewerOpen, 'кнопка «Развернуть» открывает окно');

ws.close();
chrome.kill();
console.log(fails ? '\nПРОВАЛЕНО: ' + fails : '\nвсе проверки пройдены');
process.exit(fails ? 1 : 0);
