/* ============================================================
   Управление webhook бота — без сторонних зависимостей.
   ------------------------------------------------------------
   Использование (из папки bot/):

     node scripts/set-webhook.mjs set https://compass-arena-bot.<account>.workers.dev
     node scripts/set-webhook.mjs info
     node scripts/set-webhook.mjs delete

   Откуда берутся BOT_TOKEN и WEBHOOK_SECRET:
     1) переменные окружения;
     2) файл bot/.dev.vars (формат KEY=VALUE, как у wrangler).
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEV_VARS = path.join(HERE, '..', '.dev.vars');

/** Разбор .dev.vars (если файла нет — пустой объект) */
function readDevVars() {
  try {
    const text = fs.readFileSync(DEV_VARS, 'utf8');
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

const [, , action = 'info', urlArg] = process.argv;
const env = { ...readDevVars(), ...process.env };
const token = env.BOT_TOKEN;
const secret = env.WEBHOOK_SECRET;

if (!token) {
  console.error('❌ Не найден BOT_TOKEN. Задайте переменную окружения или строку BOT_TOKEN=... в bot/.dev.vars');
  process.exit(1);
}

async function call(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`❌ ${method}: ${data.description || 'ошибка'} (код ${data.error_code})`);
    process.exit(1);
  }
  return data.result;
}

function normalizeBase(url) {
  const value = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//.test(value)) {
    console.error('❌ Укажите https-адрес воркера, например: node scripts/set-webhook.mjs set https://compass-arena-bot.me.workers.dev');
    process.exit(1);
  }
  return value;
}

if (action === 'set') {
  const base = normalizeBase(urlArg);
  if (!secret) {
    console.warn('⚠️ WEBHOOK_SECRET не задан — Telegram не будет присылать заголовок с секретом, воркер пропустит проверку.');
  }
  const result = await call('setWebhook', {
    url: `${base}/webhook`,
    secret_token: secret || undefined,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true
  });
  console.log('✅ Webhook установлен:', `${base}/webhook`);
  console.log('   Ответ Telegram:', result === true ? 'true' : JSON.stringify(result));
  const info = await call('getWebhookInfo', {});
  console.log('   Проверка:', JSON.stringify(info, null, 2));
} else if (action === 'delete') {
  await call('deleteWebhook', { drop_pending_updates: true });
  console.log('🗑 Webhook удалён');
} else {
  const info = await call('getWebhookInfo', {});
  console.log('ℹ️ Текущий webhook:', JSON.stringify(info, null, 2));
  if (info.last_error_message) {
    console.log(`⚠️ Последняя ошибка доставки: ${info.last_error_message} (${info.last_error_date})`);
  }
}
