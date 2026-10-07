/* ============================================================
   Мелкие UI-помощники для экранов бота
   ------------------------------------------------------------
   Используются модерацией и экспортом (в ветке регистрации свои
   локальные обёртки, потому что там нужен особый режим правки).

   screen() — правит текущее сообщение, если это возможно,
              иначе отправляет новое (после фото править нельзя).
   screenWithPhoto() — карточка с логотипом: фото + подпись или
              фото и текст отдельным сообщением (лимит подписи 1024).
   ============================================================ */

import { sendMessage, editMessageText, sendPhoto, inlineKeyboard } from './telegram.js';

/** Собираем inline-клавиатуру (короткий алиас) */
export const kb = inlineKeyboard;

/** Кнопка «в меню» */
export const menuRow = { text: '🏠 В меню', data: 'act:menu' };

/** Кнопка «назад» */
export const backRow = (data, text = '⬅️ Назад') => [{ text, data }];

/**
 * Показать экран: сначала пробуем отредактировать сообщение, из которого
 * пришло нажатие, и только при неудаче отправляем новое.
 */
export async function screen(env, ctx, text, keyboard) {
  if (ctx && ctx.messageId) {
    try {
      await editMessageText(env, ctx.chatId, ctx.messageId, text, { keyboard });
      return null;
    } catch (err) {
      console.warn('[ui] не удалось отредактировать сообщение:', err && err.message);
    }
  }
  return sendMessage(env, ctx.chatId, text, { keyboard });
}

/**
 * Экран с картинкой (логотип заявки).
 * Если подпись не влезает в лимит Telegram (1024) — отправляем фото и текст отдельно.
 * При ошибке отправки фото возвращаем false, чтобы вызывающий отправил текст.
 */
export async function screenWithPhoto(env, ctx, { photo, text, caption, keyboard }) {
  const fullCaption = caption || text;
  try {
    if (fullCaption && fullCaption.length <= 1000) {
      await sendPhoto(env, ctx.chatId, photo, { caption: fullCaption, keyboard });
      return true;
    }
    await sendPhoto(env, ctx.chatId, photo, { caption: caption || '🖼 Логотип' });
    await sendMessage(env, ctx.chatId, text, { keyboard });
    return true;
  } catch (err) {
    console.warn('[ui] не удалось отправить фото:', err && err.message);
    return false;
  }
}
