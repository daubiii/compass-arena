/* ============================================================
   /start, /help, /cancel — меню и общие команды
   ------------------------------------------------------------
   Здесь же живёт showMainMenu() — экран выбора дисциплины,
   который переиспользуют другие обработчики.
   ============================================================ */

import { sendMessage, answerCallbackQuery, inlineKeyboard } from '../lib/telegram.js';
import { resetState, getSetting, isRegistrationOpen, getState } from '../lib/db.js';
import { esc } from '../lib/esc.js';
import { DISCIPLINES, DISCIPLINE_KEYS, disciplinesAndLabel } from '../lib/domain.js';
import { CONTACTS, DEFAULT_TOURNAMENT, contactsBlock } from '../lib/texts.js';

export const commands = ['start', 'help', 'cancel'];
export const callbackPrefixes = ['act']; // обрабатываем только act:menu, остальное — registration.js

/**
 * Экран выбора дисциплины.
 * @param {object} env
 * @param {number|string} chatId
 * @param {number} userId
 * @param {string} [intro] — текст перед меню
 */
export async function showMainMenu(env, chatId, userId, intro = '') {
  const open = await isRegistrationOpen(env);
  const tournament = await getSetting(env, 'current_tournament', DEFAULT_TOURNAMENT);

  const lines = [];
  if (intro) lines.push(intro, '');
  lines.push(
    '🏆 <b>Compass Arena — регистрация</b>',
    '',
    `Турнир: <b>${esc(tournament)}</b>`,
    `Дисциплины: ${esc(disciplinesAndLabel())}`
  );

  if (!open) {
    lines.push('', `⚠️ <b>Регистрация сейчас закрыта.</b>`, `Напиши организаторам: ${CONTACTS}`);
    await sendMessage(env, chatId, lines.join('\n'), {
      keyboard: inlineKeyboard([[{ text: 'ℹ️ Справка', data: 'act:help' }]])
    });
    return;
  }

  lines.push('', 'Выбери дисциплину:');

  const rows = DISCIPLINE_KEYS.map((key) => ([{
    text: `${DISCIPLINES[key].emoji} ${DISCIPLINES[key].label}`,
    data: `reg:disc:${key}`
  }]));
  rows.push([{ text: 'ℹ️ Справка', data: 'act:help' }]);

  await sendMessage(env, chatId, lines.join('\n'), { keyboard: inlineKeyboard(rows) });
}

/* ============================================================
   Команды
   ============================================================ */

export async function handleCommand(env, message, ctx) {
  if (ctx.cmd === 'start') {
    // /start всегда начинает с чистого листа: сбрасываем незавершённый диалог
    await resetState(env, ctx.userId);
    await showMainMenu(env, ctx.chatId, ctx.userId);
    return true;
  }

  if (ctx.cmd === 'help') {
    await sendHelp(env, ctx.chatId, ctx.isAdmin);
    return true;
  }

  if (ctx.cmd === 'cancel') {
    const state = await getState(env, ctx.userId);
    // Шаги модерации/экспорта — не регистрация, и текст отмены другой
    const foreign = /^(mod_|export_)/.test(String(state.step || ''));
    await resetState(env, ctx.userId);
    await showMainMenu(env, ctx.chatId, ctx.userId, foreign ? 'Ввод причины сброшен.' : 'Регистрация сброшена.');
    return true;
  }

  return false;
}

export async function handleCallback(env, query, ctx) {
  if (ctx.data === 'act:menu') {
    await answerCallbackQuery(env, query.id);
    await resetState(env, ctx.userId);
    await showMainMenu(env, ctx.chatId, ctx.userId);
    return true;
  }
  if (ctx.data === 'act:help') {
    await answerCallbackQuery(env, query.id);
    await sendHelp(env, ctx.chatId, ctx.isAdmin);
    return true;
  }
  return false;
}

/** Если человек написал «меню»/«начать» текстом — показываем меню,
 *  но НЕ сбрасываем активный диалог регистрации. */
export async function handleText(env, message, ctx) {
  if (!/^(меню|начать|start|menu|привет|здравствуйте|hi|hello)$/i.test(ctx.text)) return false;

  const state = await getState(env, ctx.userId);
  if (state.step) {
    await sendMessage(env, ctx.chatId,
      'Ты в середине регистрации — прогресс сохранён.\n' +
      'Продолжи текущий шаг или нажми /cancel.'
    );
    return true;
  }

  await showMainMenu(env, ctx.chatId, ctx.userId);
  return true;
}

export async function handlePhoto() {
  return false;
}

/* ============================================================
   Справка
   ============================================================ */

async function sendHelp(env, chatId, admin) {
  const lines = [
    'ℹ️ <b>Как проходит регистрация</b>',
    '',
    '1. Выбери дисциплину: Dota 2 или CS:GO.',
    '2. Выбери тип заявки:',
    '   • Команда — название, логотип и 5 игроков с ролями',
    '   • Свободный агент — ник, роль, ранг, описание',
    '   • Заявка игрока — ник, команда, роль',
    '3. Заявка уходит на ручную модерацию.',
    '4. После решения придёт уведомление.',
    '',
    '<b>Команды</b>',
    '/start — меню',
    '/help — эта справка',
    '/cancel — сбросить текущий шаг'
  ];

  if (admin) {
    lines.push(
      '',
      '<b>Для организаторов:</b>',
      '/leads — модерация заявок',
      '/export — выгрузка JSON для сайта'
    );
  }

  lines.push('', contactsBlock());

  await sendMessage(env, chatId, lines.join('\n'), {
    keyboard: inlineKeyboard([[{ text: '🏠 В меню', data: 'act:menu' }]])
  });
}
