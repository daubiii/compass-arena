/* ============================================================
   Вендоринг библиотеки сетки
   ------------------------------------------------------------
   Кладёт dist-файлы brackets-viewer из node_modules в /vendor.
   Нужно потому, что CDN (jsDelivr) в РФ может не ответить, а
   статика Cloudflare Pages не ограничена по размеру и бесплатна.
   Viewer тянет за собой и brackets-manager: его dist-сборка
   создаёт сразу три глобальных объекта.

   Запуск: npm run vendor
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  ['node_modules/brackets-viewer/dist/brackets-viewer.min.js', 'vendor/brackets-viewer.min.js'],
  ['node_modules/brackets-viewer/dist/brackets-viewer.min.css', 'vendor/brackets-viewer.min.css'],
  ['node_modules/brackets-viewer/LICENSE', 'vendor/brackets-viewer.LICENSE']
];

fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });

let copied = 0;
for (const [from, to] of files) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) {
    console.warn('нет файла (пропускаю): ' + from);
    continue;
  }
  const bytes = fs.readFileSync(src);
  fs.writeFileSync(path.join(root, to), bytes);
  copied++;
  console.log('✓ ' + to + ' — ' + bytes.length + ' Б');
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/brackets-viewer/package.json'), 'utf8'));
console.log('\nвендорено файлов: ' + copied + ', версия brackets-viewer: ' + pkg.version);
if (!copied) process.exit(1);
