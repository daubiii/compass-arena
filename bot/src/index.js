/* ============================================================
   Compass Arena Bot — точка входа
   ------------------------------------------------------------
   Cloudflare Worker принимает апдейты Telegram по webhook:
     POST /webhook  — апдейт от Telegram (проверяем секрет,
                      отвечаем 200 сразу, обработка в ctx.waitUntil)
     GET  /         — проверка живости
     GET  /health   — проверка живости + доступности D1

   Роутер передаёт апдейт обработчикам из src/handlers/*.js.
   Каждый обработчик объявляет:
     commands[]         — какие команды он обслуживает
     callbackPrefixes[] — префиксы callback_data («disc», «mod», …)
     handleCommand / handleCallback / handleText / handlePhoto
   Первый обработчик, вернувший true, считается обработавшим апдейт.
   ============================================================ */

import { sendMessage, answerCallbackQuery, inlineKeyboard, notifyAdmins } from './lib/telegram.js';
import { touchUser, isAdmin } from './lib/db.js';
import { esc, truncate } from './lib/esc.js';

import * as startHandler from './handlers/start.js';
import * as registrationHandler from './handlers/registration.js';
import * as moderationHandler from './handlers/moderation.js';
import * as exportHandler from './handlers/export.js';

/** Порядок важен: /start и /cancel перехватываются первыми */
const HANDLERS = [startHandler, registrationHandler, moderationHandler, exportHandler];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ---------- Проверка живости ----------
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      let db = null;
      try {
        const row = await env.DB.prepare('SELECT COUNT(*) AS leads FROM leads').first();
        db = { ok: true, leads: row ? row.leads : 0 };
      } catch (err) {
        db = { ok: false, error: String(err && err.message || err) };
      }
      const healthy = db.ok;
      return json({
        ok: healthy,
        service: 'compass-arena-bot',
        time: new Date().toISOString(),
        db,
        adminConfigured: Boolean(env.ADMIN_ID),
        botTokenConfigured: Boolean(env.BOT_TOKEN),
        webhookSecretConfigured: Boolean(env.WEBHOOK_SECRET)
      }, healthy ? 200 : 503);
    }

    // ---------- Webhook ----------
    if (request.method === 'POST' && url.pathname === '/webhook') {
      // В production без секрета не работаем: иначе кто угодно может слать апдейты
      if (!env.WEBHOOK_SECRET) {
        if (isProduction(env)) {
          console.error('CRITICAL: WEBHOOK_SECRET not set in production');
          return json({ ok: false, error: 'WEBHOOK_SECRET not set in production' }, 500);
        }
        console.warn('[webhook] WEBHOOK_SECRET не задан — проверка пропущена (только для отладки!)');
      } else if (!checkWebhookSecret(request, env)) {
        console.warn('[webhook] отклонён: неверный X-Telegram-Bot-Api-Secret-Token');
        return new Response('forbidden', { status: 403 });
      }

      let update = null;
      try {
        update = await request.json();
      } catch (err) {
        return new Response('bad request', { status: 400 });
      }

      // Отвечаем Telegram сразу, обработка — в фоне
      ctx.waitUntil(handleUpdate(env, update));
      return new Response('ok', { status: 200 });
    }

    return new Response('not found', { status: 404 });
  }
};

/* ============================================================
   Обработка апдейта
   ============================================================ */

/**
 * Разбор апдейта и вызов нужного обработчика.
 * Ошибки не должны «ронять» воркер: логируем и сообщаем админу.
 */
export async function handleUpdate(env, update) {
  try {
    if (update.message) return await onMessage(env, update.message);
    if (update.callback_query) return await onCallbackQuery(env, update.callback_query);
    // edited_message, channel_post и прочее игнорируем осознанно
    return null;
  } catch (err) {
    console.error('[update] ошибка:', err && err.stack ? err.stack : err);
    await notifyAdmin(env, update, err);
    return null;
  }
}

async function onMessage(env, message) {
  const from = message.from || {};
  await touchUser(env, from);

  const chatId = message.chat.id;
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const context = {
    userId: from.id,
    username: from.username || '',
    chatId,
    messageId: message.message_id,
    text,
    isAdmin: await isAdmin(env, from.id)
  };

  // ---------- Фото (логотип команды) ----------
  if (Array.isArray(message.photo) && message.photo.length) {
    for (const handler of HANDLERS) {
      if (typeof handler.handlePhoto !== 'function') continue;
      if (await handler.handlePhoto(env, message, context)) return;
    }
    return;
  }

  // ---------- Команды ----------
  if (text.startsWith('/')) {
    const [raw, ...args] = text.split(/\s+/);
    const cmd = raw.slice(1).split('@')[0].toLowerCase();
    const commandContext = { ...context, cmd, args };

    for (const handler of HANDLERS) {
      if (!Array.isArray(handler.commands) || !handler.commands.includes(cmd)) continue;
      if (await handler.handleCommand(env, message, commandContext)) return;
    }

    await sendUnknownCommand(env, chatId, cmd, context.isAdmin);
    return;
  }

  // ---------- Текстовый ввод на шаге диалога ----------
  for (const handler of HANDLERS) {
    if (typeof handler.handleText !== 'function') continue;
    if (await handler.handleText(env, message, context)) return;
  }

  // Ничего не ждём от пользователя — показываем меню
  await startHandler.showMainMenu(env, chatId, from.id, 'Не понял сообщение. Вот меню:');
}

async function onCallbackQuery(env, query) {
  const from = query.from || {};
  await touchUser(env, from);

  const data = String(query.data || '');
  const prefix = data.split(':')[0];
  const context = {
    userId: from.id,
    username: from.username || '',
    chatId: query.message ? query.message.chat.id : from.id,
    messageId: query.message ? query.message.message_id : null,
    data,
    isAdmin: await isAdmin(env, from.id)
  };

  for (const handler of HANDLERS) {
    if (!Array.isArray(handler.callbackPrefixes) || !handler.callbackPrefixes.includes(prefix)) continue;
    const handled = await handler.handleCallback(env, query, context);
    if (handled) return;
  }

  // Кнопка от старого сообщения или неизвестный префикс
  await answerCallbackQuery(env, query.id, { text: 'Кнопка больше не активна', showAlert: false });
}

/* ============================================================
   Служебные ответы
   ============================================================ */

async function sendUnknownCommand(env, chatId, cmd, admin) {
  const lines = [
    `Команда <code>/${esc(cmd)}</code> не поддерживается.`,
    '',
    'Доступные команды:',
    '/start — меню регистрации',
    '/help — справка',
    '/cancel — сбросить текущий шаг'
  ];
  if (admin) {
    lines.push('', 'Для администратора:', '/leads — модерация заявок', '/export — экспорт JSON');
  }
  await sendMessage(env, chatId, lines.join('\n'), {
    keyboard: inlineKeyboard([[{ text: '🏠 В меню', data: 'act:menu' }]])
  });
}

/** Сообщение админам об необработанной ошибке */
async function notifyAdmin(env, update, err) {
  try {
    const where = update.message
      ? `message от ${update.message.from && update.message.from.id}`
      : update.callback_query
        ? `callback ${update.callback_query.data} от ${update.callback_query.from && update.callback_query.from.id}`
        : 'неизвестный апдейт';

    await notifyAdmins(env,
      `⚠️ <b>Ошибка бота</b>\n\n` +
      `Где: ${esc(where)}\n` +
      `Текст: <code>${esc(truncate(err && err.message ? err.message : String(err), 300))}</code>`,
      { keyboard: inlineKeyboard([[{ text: '🏠 В меню', data: 'act:menu' }]]) }
    );
  } catch (notifyErr) {
    console.error('[update] не удалось уведомить админа:', notifyErr && notifyErr.message);
  }
}

/** Прод-окружение: задаётся в wrangler.toml [vars] и переопределяется в .dev.vars */
export function isProduction(env) {
  return String((env && env.ENVIRONMENT) || '').toLowerCase() === 'production';
}

/* ============================================================
   Утилиты воркера
   ============================================================ */

/**
 * Сравнение секрета webhook с постоянным временем.
 * Если WEBHOOK_SECRET не задан — работаем как в режиме отладки,
 * но пишем предупреждение (в проде секрет обязателен).
 * Экспортируется для самопроверки (scripts/self-check.mjs).
 */
export function checkWebhookSecret(request, env) {
  const expected = env.WEBHOOK_SECRET;
  if (!expected) {
    console.warn('[webhook] WEBHOOK_SECRET не задан — пропускаю проверку (только для отладки!)');
    return true;
  }
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  return safeEqual(provided, expected);
}

function safeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length || left.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
