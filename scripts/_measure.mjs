/* Разовый замер геометрии карточек сетки в реальном Chrome:
   выясняем, что именно делает карточку выше ожидаемого.
   Запуск (при работающем npm run serve): node scripts/_measure.mjs */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outFile = path.join(ROOT, '.tmp-measure.html');
const profile = path.join(ROOT, '.tmp-chrome-measure');
fs.mkdirSync(profile, { recursive: true });

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<link rel="stylesheet" href="/site.css">
<style>body{background:#0a0d12;color:#e8e8ea;font-family:monospace;padding:16px}
pre{white-space:pre-wrap;font-size:12px}</style></head><body>
<div class="bracket-scroll"><div class="bracket" id="bracketWrap"></div></div>
<pre id="out"></pre>
<script src="/assets/ca-data.js"></script>
<script src="/assets/ca-bracket-engine.js"></script>
<script src="/assets/ca-ui.js"></script>
<script src="/assets/ca-bracket.js"></script>
<script>
fetch('/api/data').then(r=>r.json()).then(function(raw){
  var D = CA.data.setRaw(raw);
  CA.bracket.render(document.getElementById('bracketWrap'), { data: D });
  setTimeout(function(){
    var wrap = document.getElementById('bracketWrap');
    var box = wrap.querySelector('.bracket');
    var res = { unit: getComputedStyle(box).getPropertyValue('--b-unit').trim(), box: Math.round(box.getBoundingClientRect().height), cards: [] };
    Array.prototype.forEach.call(wrap.querySelectorAll('.match'), function(el){
      var r = el.getBoundingClientRect();
      var head = el.querySelector('.match-head');
      var slots = el.querySelectorAll('.slot');
      var slotH = Array.prototype.map.call(slots, function(s){ return Math.round(s.getBoundingClientRect().height); });
      var headH = head ? Math.round(head.getBoundingClientRect().height) : 0;
      var cs = getComputedStyle(el);
      res.cards.push({ id: el.getAttribute('data-match'), h: Math.round(r.height),
        head: headH, slots: slotH, minH: cs.minHeight, pad: cs.padding,
        gridRow: el.style.gridRow, foot: el.querySelector('.match-foot') ? 1 : 0 });
    });
    document.getElementById('out').textContent = JSON.stringify(res);
    document.title = 'ready';
  }, 1200);
});
</script></body></html>`;
fs.writeFileSync(outFile, html, 'utf8');

const dom = execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-crash-reporter', '--disable-breakpad',
  '--user-data-dir=' + profile, '--window-size=1440,1600', '--virtual-time-budget=8000',
  '--dump-dom', 'http://127.0.0.1:4173/measure-tmp.html'
], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });

const m = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom);
if (!m) { console.log('не удалось получить замер'); process.exit(1); }
const res = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
console.log('--b-unit = ' + res.unit + ' · высота полотна ' + res.box + 'px');
res.cards.forEach((c) => {
  console.log('M' + String(c.id).padEnd(3) + 'row=' + String(c.gridRow).padEnd(14) +
    'высота=' + String(c.h).padEnd(5) + 'шапка=' + String(c.head).padEnd(4) +
    'слоты=[' + c.slots.join(', ') + '] min-height=' + c.minH + (c.foot ? ' + VOD' : ''));
});
fs.unlinkSync(outFile);
