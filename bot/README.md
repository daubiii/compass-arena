# Compass Arena Bot

Telegram-бот для регистрации команд и игроков на турниры Compass Arena.
Работает на Cloudflare Workers, данные хранит в Cloudflare D1.
По команде `/export` отдаёт админу JSON-файлы, которые тот вручную загружает
в админку сайта. **В KV сайта бот не пишет ничего.**

Дисциплины: Dota 2 и CS:GO · игроков в команде ровно 5 · модерация заявок вручную.

---

## Предварительные требования

- **Node.js 18 или новее** (`node --version`).
- **Аккаунт Cloudflare** с доступом к Workers и D1.
- **Бот, созданный в @BotFather** (токен понадобится ниже).
- Свой **Telegram ID** — узнать можно у @userinfobot.
- Всё делается из папки `bot/`.

Необязательно, но полезно перед деплоем: `npm run check` — прогоняет самопроверку
бота без сети и без Cloudflare (нужен только Node.js).

---

## Пошаговая инструкция

Идём по чек-листу сверху вниз. Команды выполняются в папке `bot/`.

### [ ] 1. Создал бота
В Telegram: **@BotFather** → `/newbot` → имя (например, `Compass Arena Registration`)
→ username (например, `CompassArenaBot`).

### [ ] 2. Сохранил токен
BotFather пришлёт токен — это `BOT_TOKEN`. **Никому не показывать**, в код
и в `wrangler.toml` не вписывать: он задаётся только через `wrangler secret put`.

### [ ] 3. Узнал Telegram ID
Написать **@userinfobot** → он пришлёт ваш числовой ID. Это `ADMIN_ID`
(можно несколько ID через запятую — тогда админов будет несколько).

### [ ] 4. Создал D1
```bash
npx wrangler d1 create compass-arena-bot
```
В ответе будет `database_id` вида `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

### [ ] 5. Вставил database_id
Открыть `bot/wrangler.toml` и заменить заглушку:
```toml
[[d1_databases]]
binding = "DB"
database_name = "compass-arena-bot"
database_id = "<DATABASE_ID_ИЗ_ШАГА_4>"
```

### [ ] 6. npm install
```bash
npm install
```

### [ ] 7. wrangler login
На домашнем компьютере:
```bash
npx wrangler login
```
На VPS/сервере без браузера `login` не сработает — используйте API-токен
(Cloudflare Dashboard → My Profile → API Tokens → Create Token с правами
**Edit Cloudflare Workers** и **D1 Edit**):
```bash
export CLOUDFLARE_API_TOKEN=<CLOUDFLARE_API_TOKEN>
```
Проверить, что wrangler видит аккаунт: `npx wrangler whoami`.

### [ ] 8. Установил BOT_TOKEN
```bash
npx wrangler secret put BOT_TOKEN
# вставить токен из шага 2 и нажать Enter
```
На VPS без интерактива:
```bash
echo "<BOT_TOKEN>" | npx wrangler secret put BOT_TOKEN
```

### [ ] 9. Установил ADMIN_ID
```bash
npx wrangler secret put ADMIN_ID
# вставить ID из шага 3
```

### [ ] 10. Установил WEBHOOK_SECRET
Случайная строка — она защищает webhook от посторонних запросов:
```bash
openssl rand -hex 32          # получить строку
npx wrangler secret put WEBHOOK_SECRET
# вставить эту же строку
```
Эту же строку нужно будет передать скрипту установки webhook на шаге 14 —
он берёт её из переменной окружения или из файла `bot/.dev.vars`.

### [ ] 11. npm run db:init
```bash
npm run db:init
```
Создаёт таблицы `users`, `states`, `leads`, `settings` и начальные настройки в D1.

### [ ] 12. npm run deploy
```bash
npm run deploy
```
В выводе будет адрес воркера, например
`https://compass-arena-bot.<account>.workers.dev`.

### [ ] 13. Скопировал URL
Сохранить адрес воркера — он нужен на следующем шаге.

### [ ] 14. Установил webhook
```bash
export BOT_TOKEN=<BOT_TOKEN>
export WEBHOOK_SECRET=<WEBHOOK_SECRET>
node scripts/set-webhook.mjs set https://<WORKER_URL>
```
Скрипт ставит webhook на `<WORKER_URL>/webhook` с тем же секретом, что и в воркере.
Токен и секрет можно не экспортировать, а положить в `bot/.dev.vars`
(файл в `.gitignore`), формат `KEY=VALUE` — см. `bot/.dev.vars.example`.

Проверить, что webhook встал правильно:
```bash
node scripts/set-webhook.mjs info
```
Смотреть в ответе:
- **`url`** — тот самый адрес, `.../webhook` (не опечатка, https);
- **`pending_update_count`** — должно быть `0` (очередь не копится);
- **`last_error_date`** — `null` (Telegram не получает ошибок при доставке);
- если есть `last_error_message` — там причина (см. раздел ниже).

### [ ] 15. Проверил /start
Открыть бота в Telegram → `/start`. Должен появиться экран регистрации
с выбором дисциплины.

### [ ] 16. Проверил /help
`/help` — справка по сценарию. У админа внизу дополнительно `/leads` и `/export`.

### [ ] 17. Проверил /leads
Отправить тестовую заявку через бота, затем `/leads` — должны быть счётчики
и карточка заявки с кнопками «Одобрить / Отклонить / Пропустить».

### [ ] 18. Проверил /export
`/export` → дисциплина → что экспортировать → подтверждение → бот присылает
JSON-файлы. Эти файлы загружаются в админке сайта, раздел «Импорт из бота».

---

## Что делать, если что-то не работает

**`/start` не отвечает** (бот молчит на любые команды) — webhook не установлен
или указывает не туда. Проверить: `node scripts/set-webhook.mjs info`,
в ответе не должно быть пустого `url`. Если URL неправильный — переустановить:
```bash
node scripts/set-webhook.mjs delete
node scripts/set-webhook.mjs set https://<ПРАВИЛЬНЫЙ_URL>
```

**`/start` отвечает `Forbidden`** — неверный `WEBHOOK_SECRET`: секрет в Telegram
не совпадает с секретом воркера. Задать новое значение с двух сторон:
```bash
npx wrangler secret put WEBHOOK_SECRET     # новое значение
export WEBHOOK_SECRET=<то же значение>
node scripts/set-webhook.mjs set https://<WORKER_URL>
```

**`/leads` отвечает «Недостаточно прав»** — неверный `ADMIN_ID`.
Проверить ID у @userinfobot и задать заново, затем повторить деплой:
```bash
npx wrangler secret put ADMIN_ID
npm run deploy
```
Несколько админов указываются через запятую: `111,222`.

**`npm run db:init` падает** — не выполнен вход в Cloudflare (`wrangler login`
или не задан `CLOUDFLARE_API_TOKEN`), либо в `wrangler.toml` неверный
`database_id`. Проверить: `npx wrangler whoami` и `npx wrangler d1 list`.

**`npm run deploy` падает** — синтаксическая ошибка в JS или повреждён
`wrangler.toml`. Проверить локально: `npm run check`, затем
`npx wrangler deploy --dry-run`.

**Диагностика одной командой:** открыть адрес воркера в браузере
(`https://<WORKER_URL>/`) — в ответе JSON: `db.ok: true` (база привязана),
`botTokenConfigured`, `adminConfigured`, `webhookSecretConfigured`.

---

## Обновление бота

После правок в коде — просто задеплоить заново:
```bash
npm run deploy
```
Webhook переустанавливать не нужно: адрес воркера не меняется.
Если менялись секреты — их нужно задать заново (`wrangler secret put ...`),
а для `WEBHOOK_SECRET` дополнительно переустановить webhook (см. выше).

Полезно перед деплоем: `npm run check` — быстрая самопроверка без сети.
Посмотреть живые логи воркера: `npm run tail`.
