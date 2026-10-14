/* Скриншот сетки во всю высоту: страница + включённый показ полотна целиком.
   Требует запущенного сервера. Запуск: node scripts/_shot-bracket.mjs [файл.png] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || '.tmp-bracket-full.png';
const PAGE = process.argv[3] || 'http://127.0.0.1:4173/index.html';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9227;
const profile = path.join(process.cwd(), '.tmp-chrome-shot');
fs.mkdirSync(profile, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--disable-crash-reporter', '--disable-breakpad',
  '--user-data-dir=' + profile, '--window-size=1500,1400',
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
await send(ws, 'Emulation.setDeviceMetricsOverride', {
  width: 1500, height: 1200, deviceScaleFactor: 1, mobile: false
});
await sleep(4000);

/* Показываем сетку целиком: снимаем компактный ограничитель и раскрываем превью */
await send(ws, 'Runtime.evaluate', {
  expression: `(function(){
    var box = document.getElementById('bracketWrapBox');
    if (box) { box.style.setProperty('--b-cap','none'); box.classList.remove('is-compact'); }
    return true;
  })()`
});
await sleep(600);

/* Растягиваем окно под высоту сетки и снимаем целиком */
const height = await send(ws, 'Runtime.evaluate', {
  expression: `Math.round(document.getElementById('bracketWrap').getBoundingClientRect().height) + 400`,
  returnByValue: true
});
await send(ws, 'Emulation.setDeviceMetricsOverride', {
  width: 1500, height: Math.min(6000, height.result.value || 2000), deviceScaleFactor: 1, mobile: false
});
await sleep(1200);

const shot = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('снимок: ' + OUT + ' (' + Math.round(fs.statSync(OUT).size / 1024) + ' КБ)');
ws.close();
chrome.kill();
process.exit(0);
