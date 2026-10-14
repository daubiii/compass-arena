/* ============================================================
   Обёртка над Telegram Bot API
   ------------------------------------------------------------
   Все запросы идут на https://api.telegram.org/bot<BOT_TOKEN>/...
   Разметка — HTML (см. lib/esc.js).

   Экспорт:
     sendMessage / sendLongMessage / editMessageText /
     editMessageReplyMarkup / deleteMessage / answerCallbackQuery /
     sendChatAction / sendPhoto / sendDocument /
     getFile / downloadFile / getPhotoDataUrl / inlineKeyboard
   ============================================================ */

import { bytesToBase64 } from './esc.js';

const API_ROOT = 'https://api.telegram.org';

/** Ошибка Bot API: содержит код и описание от Telegram */
export class TelegramError extends Error {
  constructor(method, errorCode, description) {
    super(`Telegram ${method} failed (${errorCode}): ${description}`);
    this.name = 'TelegramError';
    this.method = method;
    this.errorCode = errorCode;
    this.description = description;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function tokenOf(env) {
  const token = env && env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN не задан: выполните `wrangler secret put BOT_TOKEN`');
  return token;
}

/**
 * Базовый вызов Bot API.
 * JSON-тело, повтор один раз при 429 (Telegram сам присылает retry_after).
 */
async function api(env, method, payload = {}, attempt = 0) {
  const token = tokenOf(env);
  const res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    throw new TelegramError(method, res.status, 'ответ не является JSON');
  }

  if (!data || data.ok !== true) {
    const code = (data && data.error_code) || res.status;
    const description = (data && data.description) || 'неизвестная ошибка';
    if (code === 429 && attempt < 2) {
      const retryAfter = (data && data.parameters && data.parameters.retry_after) || 2;
      console.warn(`[telegram] ${method}: 429, повтор через ${retryAfter} c`);
      await sleep(retryAfter * 1000);
      return api(env, method, payload, attempt + 1);
    }
    throw new TelegramError(method, code, description);
  }
  return data.result;
}

/** Вызов с multipart/form-data (отправка файлов) */
async function apiForm(env, method, formData, attempt = 0) {
  const token = tokenOf(env);
  const res = await fetch(`${API_ROOT}/bot${token}/${method}`, { method: 'POST', body: formData });
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    throw new TelegramError(method, res.status, 'ответ не является JSON');
  }
  if (!data || data.ok !== true) {
    const code = (data && data.error_code) || res.status;
    const description = (data && data.description) || 'неизвестная ошибка';
    if (code === 429 && attempt < 2) {
      const retryAfter = (data && data.parameters && data.parameters.retry_after) || 2;
      await sleep(retryAfter * 1000);
      return apiForm(env, method, formData, attempt + 1);
    }
    throw new TelegramError(method, code, description);
  }
  return data.result;
}

/* ============================================================
   Клавиатуры
   ============================================================ */

/**
 * Собирает inline-клавиатуру.
 * @param {Array<Array<{text: string, data?: string, url?: string}>>} rows
 * @returns {{inline_keyboard: Array<Array<object>>}}
 */
export function inlineKeyboard(rows) {
  const keyboard = [];
  for (const row of (rows || [])) {
    const buttons = keyboardRow(row);
    if (!buttons.length) {
      console.warn('[keyboard] строка клавиатуры без кнопок пропущена');
      continue;
    }
    keyboard.push(buttons.map((btn) => {
      if (btn.url) return { text: btn.text, url: btn.url };
      return { text: btn.text, callback_data: String(btn.data || '').slice(0, 64) };
    }));
  }
  return { inline_keyboard: keyboard };
}

/**
 * Строка клавиатуры может прийти в трёх видах:
 *   [{...}, {...}] — обычная строка кнопок;
 *   {...}          — одна кнопка (её оборачиваем);
 *   [[{...}]]      — лишняя вложенность (разворачиваем).
 * Так кнопка не может «потеряться» из-за формы записи.
 */
function keyboardRow(row) {
  if (!row) return [];
  if (Array.isArray(row)) {
    const flat = row.length && Array.isArray(row[0]) ? row.flat(1) : row;
    return flat.filter((btn) => btn && typeof btn === 'object' && !Array.isArray(btn));
  }
  if (typeof row === 'object') return [row];
  return [];
}

/** Клавиатура «назад в меню» — используется почти на каждом шаге */
export function backKeyboard(data = 'act:menu') {
  return inlineKeyboard([[{ text: '⬅️ В меню', data }]]);
}

/* ============================================================
   Сообщения
   ============================================================ */

/**
 * Отправка сообщения с HTML-разметкой.
 * @param {object} env
 * @param {number|string} chatId
 * @param {string} text
 * @param {{keyboard?: object, disablePreview?: boolean, replyTo?: number, threadId?: number}} [opts]
 */
export async function sendMessage(env, chatId, text, opts = {}) {
  return api(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: opts.disablePreview !== false,
    link_preview_options: { is_disabled: opts.disablePreview !== false },
    reply_markup: opts.keyboard,
    reply_to_message_id: opts.replyTo,
    message_thread_id: opts.threadId
  });
}

/** Отправка длинного текста: режем на части по 3500 символов (лимит Telegram — 4096) */
export async function sendLongMessage(env, chatId, text, opts = {}) {
  const value = String(text == null ? '' : text);
  if (value.length <= 3500) return sendMessage(env, chatId, value, opts);

  const parts = [];
  let rest = value;
  while (rest.length > 3500) {
    let cut = rest.lastIndexOf('\n', 3500);
    if (cut < 1000) cut = 3500;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  parts.push(rest);

  let last = null;
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    last = await sendMessage(env, chatId, parts[i], isLast ? opts : { ...opts, keyboard: undefined });
  }
  return last;
}

/** Редактирование текста сообщения (кнопки можно заменить тем же вызовом) */
export async function editMessageText(env, chatId, messageId, text, opts = {}) {
  return api(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    link_preview_options: { is_disabled: true },
    reply_markup: opts.keyboard
  });
}

/** Замена только клавиатуры у сообщения */
export async function editMessageReplyMarkup(env, chatId, messageId, keyboard) {
  return api(env, 'editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: keyboard
  });
}

/** Удаление сообщения (например, чтобы не мусорить шагами диалога) */
export async function deleteMessage(env, chatId, messageId) {
  try {
    return await api(env, 'deleteMessage', { chat_id: chatId, message_id: messageId });
  } catch (err) {
    // сообщение могло быть удалено вручную — это не ошибка сценария
    console.warn('[telegram] deleteMessage:', err.message);
    return null;
  }
}

/**
 * Ответ на нажатие inline-кнопки.
 * Обязательно вызывать, иначе у пользователя «крутится» индикатор.
 */
export async function answerCallbackQuery(env, callbackQueryId, opts = {}) {
  try {
    return await api(env, 'answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: opts.text,
      show_alert: opts.showAlert === true,
      url: opts.url,
      cache_time: opts.cacheTime
    });
  } catch (err) {
    console.warn('[telegram] answerCallbackQuery:', err.message);
    return null;
  }
}

/** Индикатор «печатает…» / «отправляет фото…» */
export async function sendChatAction(env, chatId, action = 'typing') {
  try {
    return await api(env, 'sendChatAction', { chat_id: chatId, action });
  } catch (err) {
    console.warn('[telegram] sendChatAction:', err.message);
    return null;
  }
}

/**
 * Отправка изображения.
 * @param {object} env
 * @param {number|string} chatId
 * @param {string} photo — file_id, URL или data:URL
 */
export async function sendPhoto(env, chatId, photo, opts = {}) {
  return api(env, 'sendPhoto', {
    chat_id: chatId,
    photo,
    caption: opts.caption,
    parse_mode: 'HTML',
    reply_markup: opts.keyboard
  });
}

/**
 * Отправка файла (используется в /export).
 * @param {object} env
 * @param {number|string} chatId
 * @param {{filename: string, content: string|Uint8Array, contentType?: string}} file
 */
export async function sendDocument(env, chatId, file, opts = {}) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (opts.caption) {
    form.append('caption', opts.caption);
    form.append('parse_mode', 'HTML');
  }
  if (opts.keyboard) form.append('reply_markup', JSON.stringify(opts.keyboard));

  const blob = file.content instanceof Uint8Array
    ? new Blob([file.content], { type: file.contentType || 'application/octet-stream' })
    : new Blob([String(file.content)], { type: file.contentType || 'application/json' });
  form.append('document', blob, file.filename);

  return apiForm(env, 'sendDocument', form);
}

/* ============================================================
   Файлы
   ============================================================ */

/** Метаданные файла: { file_id, file_unique_id, file_size, file_path } */
export async function getFile(env, fileId) {
  return api(env, 'getFile', { file_id: fileId });
}

/** Скачивание файла по file_path из getFile — возвращает Uint8Array */
export async function downloadFile(env, filePath) {
  const token = tokenOf(env);
  const res = await fetch(`${API_ROOT}/file/bot${token}/${filePath}`);
  if (!res.ok) throw new TelegramError('downloadFile', res.status, `не удалось скачать ${filePath}`);
  return new Uint8Array(await res.arrayBuffer());
}

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif'
};

function mimeFromPath(filePath) {
  const ext = String(filePath || '').split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/**
 * Логотип из сообщения с фото → data:URL для JSON.
 *
 * Cloudflare Workers не умеют Canvas/ImageBitmap, поэтому «сжимать» сами не можем:
 * берём готовый размер, который отдал Telegram (320/640/800/1280 px),
 * и проверяем его фактический размер через getFile.
 *
 * @param {object} env
 * @param {Array<{file_id: string, width: number, height: number, file_size?: number}>} sizes — message.photo
 * @param {number} maxBytes — лимит (по умолчанию 200 КБ)
 * @returns {Promise<{dataUrl: string, bytes: number, width: number, oversized: boolean, fileId: string}|null>}
 */
export async function getPhotoDataUrl(env, sizes, maxBytes = 200 * 1024) {
  if (!Array.isArray(sizes) || !sizes.length) return null;

  // От большего к меньшему: хотим максимально качественный логотип в пределах лимита
  const candidates = sizes.slice().sort((a, b) => (b.width || 0) - (a.width || 0));

  let fallback = null; // самый маленький вариант — на случай, если всё больше лимита
  let unknown = null;  // Telegram не сообщил размер — проверим фактический после скачивания

  for (const size of candidates) {
    let file = null;
    try {
      file = await getFile(env, size.file_id);
    } catch (err) {
      console.warn('[telegram] getFile:', err.message);
      continue;
    }
    const bytes = file.file_size || size.file_size || 0;
    const candidate = { size, file, bytes };

    if (bytes && bytes <= maxBytes) {
      const data = await downloadFile(env, file.file_path);
      return {
        dataUrl: `data:${mimeFromPath(file.file_path)};base64,${bytesToBase64(data)}`,
        bytes: data.length,
        width: size.width || 0,
        oversized: false,
        fileId: size.file_id
      };
    }
    if (!bytes) {
      if (!unknown) unknown = candidate;
      continue;
    }
    // запоминаем самый лёгкий вариант: если всё больше лимита, отдадим его
    if (!fallback) {
      fallback = candidate;
    } else if (bytes <= fallback.bytes) {
      fallback = candidate;
    }
  }

  // Размер неизвестен — качаем и решаем по фактическим байтам
  if (!fallback && unknown) {
    const data = await downloadFile(env, unknown.file.file_path);
    return {
      dataUrl: `data:${mimeFromPath(unknown.file.file_path)};base64,${bytesToBase64(data)}`,
      bytes: data.length,
      width: unknown.size.width || 0,
      oversized: data.length > maxBytes,
      fileId: unknown.size.file_id
    };
  }

  if (fallback) {
    const data = await downloadFile(env, fallback.file.file_path);
    return {
      dataUrl: `data:${mimeFromPath(fallback.file.file_path)};base64,${bytesToBase64(data)}`,
      bytes: data.length,
      width: fallback.size.width || 0,
      oversized: data.length > maxBytes,
      fileId: fallback.size.file_id
    };
  }
  return null;
}

/* ============================================================
   Уведомления администраторов
   ============================================================ */

/** Список Telegram ID админов из ADMIN_ID (можно несколько через запятую) */
export function adminIds(env) {
  return String((env && env.ADMIN_ID) || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Отправить сообщение всем админам.
 * Ошибка доставки одному админу не мешает остальным и не рвёт сценарий.
 * @returns {Promise<number>} сколько админов получило сообщение
 */
export async function notifyAdmins(env, text, opts = {}) {
  const ids = adminIds(env);
  if (!ids.length) return 0;
  let delivered = 0;
  for (const id of ids) {
    try {
      await sendMessage(env, id, text, opts);
      delivered++;
    } catch (err) {
      console.warn(`[telegram] не удалось уведомить админа ${id}: ${err.message}`);
    }
  }
  return delivered;
}

/* ============================================================
   Служебное (для wrangler dev и отладки воркера)
   ============================================================ */

/** Информация о текущем webhook */
export async function getWebhookInfo(env) {
  return api(env, 'getWebhookInfo');
}

/** Установка webhook (вызывается вручную из скрипта деплоя) */
export async function setWebhook(env, url, secretToken) {
  return api(env, 'setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true
  });
}

/** Удаление webhook */
export async function deleteWebhook(env) {
  return api(env, 'deleteWebhook', { drop_pending_updates: true });
}

/** Регистрация списка команд в меню Telegram */
export async function setMyCommands(env, commands) {
  return api(env, 'setMyCommands', { commands });
}
