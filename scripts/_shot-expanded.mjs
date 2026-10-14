/* Клик по «Развернуть сетку» в реальном Chrome (через DevTools Protocol),
   чтобы увидеть развёрнутый вид и померить высоты. Требует запущенного сервера.
   Запуск: node scripts/_shot-expanded.mjs [url] [файл.png] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const URL_PAGE = process.argv[2] || 'http://127.0.0.1:4173/index.html';
const OUT = process.argv[3] || '.tmp-expanded.png';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;
const profile = path.join(process.cwd(), '.tmp-chrome-cdp');
fs.mkdirSync(profile, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--disable-crash-reporter', '--disable-breakpad',
  '--user-data-dir=' + profile,
  '--window-size=1440,2000',
  '--remote-debugging-port=' + PORT,
  URL_PAGE
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const page = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)[0];
      if (page) return page;
    } catch { /* Chrome ещё поднимается */ }
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

const before = await send(ws, 'Runtime.evaluate', {
  expression: `JSON.stringify((function(){
    var box=document.getElementById('bracketWrapBox');
    var wrap=document.getElementById('bracketWrap');
    var btn=document.getElementById('bracketExpand');
    return {
      compact: box.classList.contains('is-compact'),
      cap: box.getAttribute('data-cap'),
      visible: Math.round(document.getElementById('bracketScroll').getBoundingClientRect().height),
      natural: Math.round(wrap.getBoundingClientRect().height),
      button: !!btn && getComputedStyle(btn).display !== 'none',
      label: btn ? btn.textContent.trim() : null
    };
  })())`,
  returnByValue: true
});

/* Клик по кнопке — как это сделал бы пользователь */
await send(ws, 'Runtime.evaluate', {
  expression: `document.getElementById('bracketExpand').click()`
});
await sleep(1200);

const after = await send(ws, 'Runtime.evaluate', {
  expression: `JSON.stringify((function(){
    var box=document.getElementById('bracketWrapBox');
    return {
      expanded: box.classList.contains('is-expanded'),
      visible: Math.round(document.getElementById('bracketScroll').getBoundingClientRect().height),
      page: Math.round(document.body.scrollHeight)
    };
  })())`,
  returnByValue: true
});

const shot = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));

console.log('до клика:   ' + before.result.value);
console.log('после клика: ' + after.result.value);
console.log('снимок: ' + OUT);
ws.close();
chrome.kill();
process.exit(0);
