/* ============================================================
   Регистрация: команда / свободный агент / заявка игрока
   ------------------------------------------------------------
   Три ветки после выбора дисциплины:

   A. «Зарегистрировать команду» — 7 шагов (8, если у отправителя нет
      @username и нужно спросить ник капитана):
      1 название → 2 логотип (/skip) → [3 ник капитана] → 3..7 пять игроков
      (ник + роль) → финальная проверка с подтверждением и меню правок.
   B. «Найти команду» — 4 шага: ник → позиция → ранг (/skip) → описание (/skip).
   C. «Оставить заявку игрока» — 3 шага: ник → команда (/skip) → позиция.

   Все кнопки — inline, callback_data формата «reg:<action>:<param>».
   Состояние (шаг + temp_data) хранится в таблице states.
   Ошибка на шаге не сбрасывает прогресс: пользователь просто повторяет ввод.
   ============================================================ */

import {
  sendMessage, editMessageText, answerCallbackQuery, sendChatAction,
  inlineKeyboard, notifyAdmins, getPhotoDataUrl
} from '../lib/telegram.js';
import {
  getState, setState, resetState, createLead, canSubmitLead,
  findPendingTeamByName, isRegistrationOpen
} from '../lib/db.js';
import { esc, clean, isNick, isTeamName, plural } from '../lib/esc.js';
import {
  DISCIPLINES, disciplineLabel, roleByKey, rolesOf
} from '../lib/domain.js';
import { CANCEL_HINT, CONTACTS, contactsBlock, problem, stepTitle } from '../lib/texts.js';
import { showMainMenu } from './start.js';

/** /skip нужен на необязательных шагах (логотип, ранг, описание, название команды игрока) */
export const commands = ['skip'];

/** Единственный префикс callback_data у ветки регистрации */
export const callbackPrefixes = ['reg'];

/* ============================================================
   Шаги диалога (значения поля step в states)
   ============================================================ */
const STEP = {
  DISCIPLINE: 'choose_discipline',
  TYPE: 'choose_type',
  TEAM_NAME: 'team_name',
  TEAM_LOGO: 'team_logo',
  TEAM_CAPTAIN: 'team_captain',
  TEAM_PLAYER_NICK: 'team_player_nick',
  TEAM_PLAYER_ROLE: 'team_player_role',
  TEAM_CONFIRM: 'team_confirm',
  TEAM_EDIT_MENU: 'team_edit_menu',
  TEAM_EDIT_FIELD: 'team_edit_field',
  AGENT_NICK: 'agent_nick',
  AGENT_ROLE: 'agent_role',
  AGENT_RANK: 'agent_rank',
  AGENT_NOTE: 'agent_note',
  PLAYER_NICK: 'player_nick',
  PLAYER_TEAM: 'player_team',
  PLAYER_ROLE: 'player_role'
};

/** Шаги, которые обслуживает этот обработчик (чужие шаги игнорируем) */
const OWN_STEPS = new Set(Object.values(STEP));

const TEAM_STEPS = 7;   // ветка A: название, логотип и 5 игроков
const TEAM_STEPS_CAPTAIN = 8; // то же плюс вопрос про ник капитана (когда нет @username)
const AGENT_STEPS = 4;  // ветка B
const PLAYER_STEPS = 3; // ветка C

/** Сколько шагов в ветке команды (8, если спрашиваем ник капитана) */
const totalOf = (temp) => Number(temp.totalSteps) || TEAM_STEPS;

/** Номер шага игрока: 3, когда шага капитана нет, и 4, когда он есть */
const playerStepNo = (temp, index) => (totalOf(temp) >= TEAM_STEPS_CAPTAIN ? 4 : 3) + index;

/* ============================================================
   Вспомогательные функции
   ============================================================ */

const kb = inlineKeyboard;

/** Кнопка «назад» со своим callback_data */
const backRow = (data = 'reg:back', text = '⬅️ Назад') => [{ text, data }];

const menuRow = [{ text: '🏠 В меню', data: 'act:menu' }];

const canSkip = (value) => /^\/?(skip|пропустить|-)$/i.test(clean(value));

function pluralMinutes(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')}`;
}

/** Текст отказа по лимиту частоты: окно берём из настроек воркера */
function rateLimitText(env, retryAfterSec) {
  const windowMinutes = Math.max(1, Math.round((Number(env.LEAD_RATE_LIMIT_SEC) || 300) / 60));
  return 'Заявку можно отправлять не чаще одного раза в ' + windowMinutes + ' ' +
    plural(windowMinutes, 'минуту', 'минуты', 'минут') + '.\n' +
    'Следующая через ' + pluralMinutes(retryAfterSec) + '.';
}

/** Новое сообщение (для шагов с вводом текста) */
async function send(env, ctx, screen) {
  return sendMessage(env, ctx.chatId, screen.text, { keyboard: screen.keyboard });
}

/** Правка текущего сообщения (для навигации по кнопкам); при неудаче — новое сообщение */
async function replace(env, ctx, screen) {
  if (ctx.messageId) {
    try {
      await editMessageText(env, ctx.chatId, ctx.messageId, screen.text, { keyboard: screen.keyboard });
      return null;
    } catch (err) {
      console.warn('[reg] не удалось отредактировать сообщение:', err.message);
    }
  }
  return send(env, ctx, screen);
}

/** Ошибка на шаге: сообщение + повтор текущего экрана, прогресс не сбрасываем */
async function fail(env, ctx, text, screen) {
  await sendMessage(env, ctx.chatId, problem(text));
  return send(env, ctx, screen);
}

const maxLogoBytes = (env) => (Number(env.LOGO_MAX_KB) || 200) * 1024;
const maxLogoKb = (env) => Math.round(maxLogoBytes(env) / 1024);

/** «загружен (84 КБ)» / «не загружен» — для карточки проверки */
function logoStatus(temp) {
  if (!temp.logo) return 'не загружен';
  const kb = temp.logoBytes ? Math.round(temp.logoBytes / 1024) : null;
  return kb ? `загружен (${kb} КБ)` : 'загружен';
}

function playersList(temp, withRoles = true) {
  return (temp.players || []).map((player, index) => {
    const role = withRoles && player.roleLabel ? ` — ${esc(player.roleLabel)}` : '';
    return `${index + 1}. <b>${esc(player.nick || '—')}</b>${role}`;
  }).join('\n');
}

/** Карточка проверки заявки команды */
function teamCard(temp) {
  const total = totalOf(temp);
  return [
    `${DISCIPLINES[temp.discipline].emoji} <b>${esc(disciplineLabel(temp.discipline))}</b> · команда`,
    `${stepTitle(total, total)} · проверка заявки`,
    '',
    `Название: <b>${esc(temp.name || '—')}</b>`,
    `Логотип: ${logoStatus(temp)}`,
    `Капитан: <b>${esc(temp.captainNick || '—')}</b>`,
    '',
    playersList(temp) || '<i>игроки ещё не заполнены</i>'
  ].join('\n');
}

/* ============================================================
   Экраны
   ============================================================ */

function screenType(discipline) {
  return {
    text: [
      `${DISCIPLINES[discipline].emoji} <b>${esc(disciplineLabel(discipline))}</b>`,
      '',
      'Что делаем?',
      '',
      '🏆 Команда — название, логотип и 5 игроков с ролями',
      '🎯 Свободный агент — ник, роль, ранг, описание',
      '🧍 Заявка игрока — ник, команда, роль'
    ].join('\n'),
    keyboard: kb([
      [{ text: '🏆 Зарегистрировать команду', data: 'reg:type:team' }],
      [{ text: '🎯 Найти команду', data: 'reg:type:looking' }],
      [{ text: '🧍 Оставить заявку игрока', data: 'reg:type:player' }],
      [{ text: '⬅️ Другая дисциплина', data: 'reg:back' }]
    ])
  };
}

function screenTeamName(discipline, note, total = TEAM_STEPS) {
  return {
    text: [
      note ? `${note}\n` : '',
      `${DISCIPLINES[discipline].emoji} <b>${esc(disciplineLabel(discipline))}</b> · команда`,
      stepTitle(1, total),
      '',
      'Название команды (2–30 символов).',
      'Только буквы, цифры, пробел, дефис, точка, подчёркивание.' + CANCEL_HINT
    ].filter(Boolean).join('\n'),
    keyboard: kb([backRow()])
  };
}

function screenTeamLogo(temp, note) {
  return {
    text: [
      note ? `${note}\n` : '',
      stepTitle(2, totalOf(temp)),
      '',
      'Пришли логотип команды одним фото.',
      `Лимит: ${maxLogoKb({})} КБ. Больше — не принимается.` + CANCEL_HINT
    ].filter(Boolean).join('\n'),
    keyboard: kb([backRow()])
  };
}

function screenTeamCaptain(temp, note) {
  const total = totalOf(temp);
  return {
    text: [
      note ? `${note}\n` : '',
      `${stepTitle(3, total)} · капитан`,
      '',
      'Укажи ник капитана (2–30 символов).',
      'В Telegram нет @username, поэтому нужен ник вручную.' + CANCEL_HINT
    ].filter(Boolean).join('\n'),
    keyboard: kb([
      [{ text: 'Взять ник игрока 1', data: 'reg:skip:captain' }],
      backRow()
    ])
  };
}

function screenTeamPlayerNick(temp, note) {
  const index = temp.playerIndex || 0;
  return {
    text: [
      note ? `${note}\n` : '',
      stepTitle(playerStepNo(temp, index), totalOf(temp)),
      '',
      `Ник игрока ${index + 1} (2–30 символов).` + CANCEL_HINT
    ].filter(Boolean).join('\n'),
    keyboard: kb([backRow()])
  };
}

function screenTeamPlayerRole(temp, note) {
  const index = temp.playerIndex || 0;
  const roles = rolesOf(temp.discipline);
  const rows = [];
  for (let i = 0; i < roles.length; i += 2) {
    rows.push(roles.slice(i, i + 2).map((role) => ({
      text: role.title,
      data: `reg:role:${role.key}`
    })));
  }
  rows.push(backRow());

  return {
    text: [
      note ? `${note}\n` : '',
      stepTitle(playerStepNo(temp, index), totalOf(temp)),
      '',
      `Игрок ${index + 1}: <b>${esc(temp.pendingNick || '')}</b>`,
      'Выбери роль:'
    ].filter(Boolean).join('\n'),
    keyboard: kb(rows)
  };
}

function screenTeamConfirm(temp, note) {
  return {
    text: [note ? `${note}\n` : '', teamCard(temp)].filter(Boolean).join('\n'),
    keyboard: kb([
      [{ text: 'Подтвердить', data: 'reg:confirm' }, { text: 'Изменить', data: 'reg:edit' }],
      backRow()
    ])
  };
}

function screenEditMenu(temp, note) {
  const rows = [
    [{ text: 'Название', data: 'reg:edit:name' }, { text: 'Логотип', data: 'reg:edit:logo' }]
  ];
  (temp.players || []).forEach((player, index) => {
    rows.push([{ text: `Игрок ${index + 1}: ${player.nick}`, data: `reg:edit:player:${index + 1}` }]);
  });
  rows.push(backRow('reg:back', '⬅️ Назад к проверке'));

  return {
    text: [
      note ? `${note}\n` : '',
      '<b>Что изменить?</b>',
      '',
      `Название: <b>${esc(temp.name || '—')}</b>`,
      `Логотип: ${logoStatus(temp)}`,
      '',
      playersList(temp)
    ].filter(Boolean).join('\n'),
    keyboard: kb(rows)
  };
}

function screenEditName(temp, note) {
  return {
    text: [
      note ? `${note}\n` : '',
      '<b>Изменение названия</b>',
      '',
      `Сейчас: <b>${esc(temp.name || '—')}</b>`,
      'Название команды (2–30 символов).',
      'Только буквы, цифры, пробел, дефис, точка, подчёркивание.' + CANCEL_HINT
    ].filter(Boolean).join('\n'),
    keyboard: kb([backRow('reg:edit', '⬅️ Назад к списку полей')])
  };
}

function screenEditLogo(temp, note) {
  return {
    text: [
      note ? `${note}\n` : '',
      '<b>Изменение логотипа</b>',
      '',
      `Сейчас: ${logoStatus(temp)}`,
      'Пришли новое фото одним сообщением.',
      `Лимит: ${maxLogoKb({})} КБ. Больше — не принимается.` + CANCEL_HINT
    ].filter(Boolean).join('\n'),
    keyboard: kb([backRow('reg:edit', '⬅️ Назад к списку полей')])
  };
}

function screenEditPlayer(temp, index, note) {
  return {
    text: [
      note ? `${note}\n` : '',
      `<b>Изменение игрока ${index + 1}</b>`,
      '',
      `Сейчас: <b>${esc((temp.players[index] || {}).nick || '—')}</b>`,
      'Ник (2–30 символов).' + CANCEL_HINT
    ].filter(Boolean).join('\n'),
    keyboard: kb([backRow('reg:edit', '⬅️ Назад к списку полей')])
  };
}

function screenAgentNick(temp, note) {
  return {
    text: [
      note ? `${note}\n` : '',
      `${DISCIPLINES[temp.discipline].emoji} <b>${esc(disciplineLabel(temp.discipline))}</b> · поиск команды`,
      stepTitle(1, AGENT_STEPS),
      '',
      'Твой игровой ник (2–30 символов).' + CANCEL_HINT
    ].filter(Boolean).join('\n'),
    keyboard: kb([backRow()])
  };
}

function screenAgentRole(temp, note) {
  const roles = rolesOf(temp.discipline);
  const rows = [];
  for (let i = 0; i < roles.length; i += 2) {
    rows.push(roles.slice(i, i + 2).map((role) => ({ text: role.title, data: `reg:role:${role.key}` })));
  }
  rows.push(backRow());
  return {
    text: [
      note ? `${note}\n` : '',
      stepTitle(2, AGENT_STEPS),
      '',
      `Ник: <b>${esc(temp.nick || '')}</b>`,
      'Позиция:'
    ].filter(Boolean).join('\n'),
    keyboard: kb(rows)
  };
}

function screenAgentRank(temp, note) {
  return {
    text: [
      note ? `${note}\n` : '',
      stepTitle(3, AGENT_STEPS),
      '',
      'Ранг (до 40 символов).',
      'Пример: Divine 3, Immortal, Premier 18 000.',
      'Если не указываешь — /skip.' + CANCEL_HINT
    ].filter(Boolean).join('\n'),
    keyboard: kb([[{ text: 'Без ранга', data: 'reg:skip:rank' }], backRow()])
  };
}

function screenAgentNote(temp, note) {
  return {
    text: [
      note ? `${note}\n` : '',
      stepTitle(4, AGENT_STEPS),
      '',
      'Кратко о себе: опыт, сильные стороны, когда играешь (до 300 символов).',
      'Если не нужно — /skip.' + CANCEL_HINT
    ].filter(Boolean).join('\n'),
    keyboard: kb([[{ text: 'Без описания', data: 'reg:skip:note' }], backRow()])
  };
}

function screenPlayerLeadNick(temp, note) {
  return {
    text: [
      note ? `${note}\n` : '',
      `${DISCIPLINES[temp.discipline].emoji} <b>${esc(disciplineLabel(temp.discipline))}</b> · заявка игрока`,
      stepTitle(1, PLAYER_STEPS),
      '',
      'Твой ник (2–30 символов).' + CANCEL_HINT
    ].filter(Boolean).join('\n'),
    keyboard: kb([backRow()])
  };
}

function screenPlayerTeam(temp, note) {
  return {
    text: [
      note ? `${note}\n` : '',
      stepTitle(2, PLAYER_STEPS),
      '',
      `Ник: <b>${esc(temp.nick || '')}</b>`,
      'Название текущей команды (2–30 символов).',
      'Нет команды — /skip.' + CANCEL_HINT
    ].filter(Boolean).join('\n'),
    keyboard: kb([[{ text: 'Без команды', data: 'reg:skip:team' }], backRow()])
  };
}

function screenPlayerLeadRole(temp, note) {
  const roles = rolesOf(temp.discipline);
  const rows = [];
  for (let i = 0; i < roles.length; i += 2) {
    rows.push(roles.slice(i, i + 2).map((role) => ({ text: role.title, data: `reg:role:${role.key}` })));
  }
  rows.push(backRow());
  return {
    text: [
      note ? `${note}\n` : '',
      stepTitle(3, PLAYER_STEPS),
      '',
      `Ник: <b>${esc(temp.nick || '')}</b>`,
      'Позиция:'
    ].filter(Boolean).join('\n'),
    keyboard: kb(rows)
  };
}

/* ============================================================
   /skip
   ============================================================ */
export async function handleCommand(env, message, ctx) {
  if (ctx.cmd !== 'skip') return false;
  return handleSkip(env, ctx);
}

async function handleSkip(env, ctx) {
  const state = await getState(env, ctx.userId);
  // Чужие шаги (например, ввод причины отклонения в модерации) — не наш /skip
  if (state.step && !OWN_STEPS.has(state.step)) return false;

  if (!state.step) {
    await sendMessage(env, ctx.chatId, 'Сейчас нечего пропускать. /start — начать регистрацию.');
    return true;
  }

  const temp = state.temp || {};

  // Ник капитана: можно взять ник первого игрока
  if (state.step === STEP.TEAM_CAPTAIN) {
    const updated = { ...temp, captainNick: '' };
    await goToFirstPlayer(env, ctx, updated);
    return true;
  }

  // Логотип обязателен: /skip здесь не работает
  const editingLogo = state.step === STEP.TEAM_EDIT_FIELD && temp.editField === 'logo';
  if (state.step === STEP.TEAM_LOGO || editingLogo) {
    await sendMessage(env, ctx.chatId, problem('Логотип обязателен. Пришли фото команды.'),
      { keyboard: kb([menuRow]) });
    return true;
  }

  if (state.step === STEP.AGENT_RANK) {
    const updated = { ...temp, rank: '' };
    await setState(env, ctx.userId, STEP.AGENT_NOTE, updated);
    await replace(env, ctx, screenAgentNote(updated));
    return true;
  }

  if (state.step === STEP.AGENT_NOTE) {
    return submitAgent(env, ctx, { ...temp, note: '' });
  }

  if (state.step === STEP.PLAYER_TEAM) {
    const updated = { ...temp, teamName: null };
    await setState(env, ctx.userId, STEP.PLAYER_ROLE, updated);
    await replace(env, ctx, screenPlayerLeadRole(updated));
    return true;
  }

  await sendMessage(env, ctx.chatId,
    'Здесь /skip не нужен — выполни текущий шаг или нажми /cancel.',
    { keyboard: kb([menuRow]) }
  );
  return true;
}

/* ============================================================
   Кнопки
   ============================================================ */
export async function handleCallback(env, query, ctx) {
  const [, action, ...params] = String(ctx.data || '').split(':');

  try {
    switch (action) {
      case 'disc': return await onDiscipline(env, query, ctx, params[0]);
      case 'type': return await onType(env, query, ctx, params[0]);
      case 'role': return await onRole(env, query, ctx, params[0]);
      case 'skip': return await onSkipButton(env, query, ctx, params[0]);
      case 'confirm': return await onConfirm(env, query, ctx);
      case 'edit': return await onEdit(env, query, ctx, params);
      case 'back': return await onBack(env, query, ctx);
      default:
        await answerCallbackQuery(env, query.id, { text: 'Неизвестное действие' });
        return true;
    }
  } catch (err) {
    console.error('[reg] ошибка обработки кнопки', ctx.data, err && err.stack ? err.stack : err);
    await answerCallbackQuery(env, query.id, { text: 'Что-то пошло не так, попробуй ещё раз' });
    return true;
  }
}

/* ---------- Выбор дисциплины ---------- */
async function onDiscipline(env, query, ctx, discipline) {
  if (!DISCIPLINES[discipline]) {
    await answerCallbackQuery(env, query.id, { text: 'Неизвестная дисциплина', showAlert: true });
    return true;
  }
  if (!(await isRegistrationOpen(env))) {
    await answerCallbackQuery(env, query.id, { text: 'Регистрация сейчас закрыта', showAlert: true });
    return true;
  }

  await answerCallbackQuery(env, query.id);
  await setState(env, ctx.userId, STEP.TYPE, { discipline, type: null });
  await replace(env, ctx, screenType(discipline));
  return true;
}

/* ---------- Выбор действия ---------- */
async function onType(env, query, ctx, type) {
  const state = await getState(env, ctx.userId);
  const discipline = state.temp && state.temp.discipline;
  if (!discipline) {
    await answerCallbackQuery(env, query.id, { text: 'Начни заново: /start', showAlert: true });
    return true;
  }
  await answerCallbackQuery(env, query.id);

  if (type === 'team') {
    // Если у пользователя нет @username — понадобится отдельный вопрос про ник капитана
    const needsCaptainNick = !ctx.username;
    const temp = {
      discipline, type: 'team',
      name: '', logo: '', logoOversized: false, logoBytes: 0,
      players: [], playerIndex: 0, pendingNick: '', editField: null,
      captainNick: needsCaptainNick ? '' : '@' + ctx.username,
      totalSteps: needsCaptainNick ? TEAM_STEPS_CAPTAIN : TEAM_STEPS
    };
    await setState(env, ctx.userId, STEP.TEAM_NAME, temp);
    await replace(env, ctx, screenTeamName(discipline, null, temp.totalSteps));
    return true;
  }

  if (type === 'looking') {
    const temp = { discipline, type: 'looking', nick: '', role: null, roleLabel: '', rank: '', note: '' };
    await setState(env, ctx.userId, STEP.AGENT_NICK, temp);
    await replace(env, ctx, screenAgentNick(temp));
    return true;
  }

  if (type === 'player') {
    const temp = { discipline, type: 'player', nick: '', teamName: null, role: null, roleLabel: '' };
    await setState(env, ctx.userId, STEP.PLAYER_NICK, temp);
    await replace(env, ctx, screenPlayerLeadNick(temp));
    return true;
  }

  await answerCallbackQuery(env, query.id, { text: 'Неизвестное действие' });
  return true;
}

/* ---------- Выбор роли (все три ветки) ---------- */
async function onRole(env, query, ctx, roleKey) {
  const state = await getState(env, ctx.userId);
  const temp = state.temp || {};
  const role = roleByKey(temp.discipline, roleKey);

  if (!role) {
    await answerCallbackQuery(env, query.id, { text: 'Неизвестная роль', showAlert: true });
    return true;
  }

  // Роль выбирают: игрок команды, свободный агент, заявитель-игрок
  const isTeamRole = state.step === STEP.TEAM_PLAYER_ROLE;
  const isAgentRole = state.step === STEP.AGENT_ROLE;
  const isPlayerRole = state.step === STEP.PLAYER_ROLE;

  if (!isTeamRole && !isAgentRole && !isPlayerRole) {
    await answerCallbackQuery(env, query.id, { text: 'Кнопка устарела — начни заново: /start', showAlert: true });
    return true;
  }

  await answerCallbackQuery(env, query.id, { text: role.label });

  if (isTeamRole) {
    const index = Number(temp.playerIndex) || 0;
    const players = (temp.players || []).slice();
    players[index] = { nick: temp.pendingNick || (players[index] || {}).nick || '', role: role.num, roleLabel: role.label };
    const updated = { ...temp, players, pendingNick: '' };

    // Правка ника существующего игрока — сразу назад к проверке
    if (String(temp.editField || '').startsWith('player:')) {
      const done = { ...updated, editField: null };
      await setState(env, ctx.userId, STEP.TEAM_CONFIRM, done);
      await replace(env, ctx, screenTeamConfirm(done));
      return true;
    }

    if (index < 4) {
      const next = { ...updated, playerIndex: index + 1 };
      await setState(env, ctx.userId, STEP.TEAM_PLAYER_NICK, next);
      await replace(env, ctx, screenTeamPlayerNick(next));
      return true;
    }

    await setState(env, ctx.userId, STEP.TEAM_CONFIRM, updated);
    await replace(env, ctx, screenTeamConfirm(updated));
    return true;
  }

  if (isAgentRole) {
    const updated = { ...temp, role: role.num, roleLabel: role.label };
    await setState(env, ctx.userId, STEP.AGENT_RANK, updated);
    await replace(env, ctx, screenAgentRank(updated));
    return true;
  }

  // Ветка C: после роли сразу отправляем заявку
  const updated = { ...temp, role: role.num, roleLabel: role.label };
  await setState(env, ctx.userId, STEP.PLAYER_ROLE, updated);
  return submitPlayer(env, ctx, updated);
}

/* ---------- Кнопки «пропустить» (капитан, ранг, описание, команда) ---------- */
async function onSkipButton(env, query, ctx, what) {
  const state = await getState(env, ctx.userId);
  const temp = state.temp || {};

  if (what === 'captain' && state.step === STEP.TEAM_CAPTAIN) {
    await answerCallbackQuery(env, query.id, { text: 'Капитаном будет игрок 1' });
    const updated = { ...temp, captainNick: '' };
    await goToFirstPlayer(env, ctx, updated);
    return true;
  }

  if (what === 'rank' && state.step === STEP.AGENT_RANK) {
    await answerCallbackQuery(env, query.id, { text: 'Без ранга' });
    const updated = { ...temp, rank: '' };
    await setState(env, ctx.userId, STEP.AGENT_NOTE, updated);
    await replace(env, ctx, screenAgentNote(updated));
    return true;
  }

  if (what === 'note' && state.step === STEP.AGENT_NOTE) {
    await answerCallbackQuery(env, query.id, { text: 'Без описания' });
    return submitAgent(env, ctx, { ...temp, note: '' });
  }

  if (what === 'team' && state.step === STEP.PLAYER_TEAM) {
    await answerCallbackQuery(env, query.id, { text: 'Без команды' });
    const updated = { ...temp, teamName: null };
    await setState(env, ctx.userId, STEP.PLAYER_ROLE, updated);
    await replace(env, ctx, screenPlayerLeadRole(updated));
    return true;
  }

  await answerCallbackQuery(env, query.id, { text: 'Кнопка устарела', showAlert: true });
  return true;
}

/* ---------- Подтверждение заявки команды ---------- */
async function onConfirm(env, query, ctx) {
  const state = await getState(env, ctx.userId);
  const temp = state.temp || {};

  if (state.step !== STEP.TEAM_CONFIRM) {
    await answerCallbackQuery(env, query.id, { text: 'Кнопка устарела — начни заново: /start', showAlert: true });
    return true;
  }

  const players = temp.players || [];
  if (players.length !== 5 || players.some((player) => !player || !player.nick || !player.role)) {
    await answerCallbackQuery(env, query.id, { text: 'Состав заполнен не полностью', showAlert: true });
    return true;
  }

  // Логотип обязателен: без него заявку не отправляем
  if (!temp.logo) {
    await answerCallbackQuery(env, query.id, { text: 'Нужен логотип', showAlert: true });
    await setState(env, ctx.userId, STEP.TEAM_LOGO, temp);
    await sendMessage(env, ctx.chatId, problem('Нужен логотип команды. Пришли фото.'), { keyboard: kb([menuRow]) });
    return true;
  }

  // 1. Дубликат: у этого же пользователя уже есть pending-заявка с таким названием
  const duplicate = await findPendingTeamByName(env, ctx.userId, temp.name);
  if (duplicate) {
    await answerCallbackQuery(env, query.id, { text: 'Такая заявка уже есть', showAlert: true });
    await sendMessage(env, ctx.chatId,
      `У тебя уже есть заявка на команду «<b>${esc(temp.name)}</b>» — она ещё на модерации.\n` +
      'Дождись решения организаторов или напиши им: ' + CONTACTS + '.',
      { keyboard: kb([menuRow]) }
    );
    return true;
  }

  // 2. Rate limit
  const rate = await canSubmitLead(env, ctx.userId);
  if (!rate.allowed) {
    await answerCallbackQuery(env, query.id, { text: 'Слишком часто', showAlert: true });
    await sendMessage(env, ctx.chatId, rateLimitText(env, rate.retryAfterSec),
      { keyboard: kb([[{ text: 'Подтвердить', data: 'reg:confirm' }], menuRow]) }
    );
    return true;
  }

  // 3. Создание заявки
  const captainNick = temp.captainNick || (ctx.username ? '@' + ctx.username : players[0].nick);
  const payload = {
    name: temp.name,
    logo: temp.logo || '',
    logoOversized: Boolean(temp.logoOversized),
    captainNick,
    captainTelegramId: ctx.userId,
    players: players.map((player) => ({ nick: player.nick, role: player.role, roleLabel: player.roleLabel }))
  };

  const leadId = await createLead(env, {
    telegramId: ctx.userId,
    type: 'team',
    discipline: temp.discipline,
    payload
  });

  await answerCallbackQuery(env, query.id, { text: 'Заявка отправлена' });
  await resetState(env, ctx.userId);

  await sendMessage(env, ctx.chatId,
    `Заявка <code>#${leadId}</code> отправлена на модерацию.\n` +
    `Дисциплина: ${esc(disciplineLabel(temp.discipline))}\n\n` +
    'Решение придёт в этот чат.\n' + contactsBlock(),
    { keyboard: kb([menuRow]) }
  );

  await notifyAdmins(env,
    `📥 <b>Новая заявка на команду</b>\n` +
    `${esc(temp.name)} · ${esc(disciplineLabel(temp.discipline))}\n` +
    `Игроков: ${players.length} · заявка <code>#${leadId}</code>\n` +
    'Открой /leads для модерации.'
  );
  return true;
}

/* ---------- Меню правок ---------- */
async function onEdit(env, query, ctx, params) {
  const state = await getState(env, ctx.userId);
  const temp = state.temp || {};

  const editable = [STEP.TEAM_CONFIRM, STEP.TEAM_EDIT_MENU, STEP.TEAM_EDIT_FIELD];
  if (!editable.includes(state.step)) {
    await answerCallbackQuery(env, query.id, { text: 'Кнопка устарела — начни заново: /start', showAlert: true });
    return true;
  }

  // Открыть список полей
  if (!params.length) {
    await answerCallbackQuery(env, query.id);
    const opened = { ...temp, editField: null };
    await setState(env, ctx.userId, STEP.TEAM_EDIT_MENU, opened);
    await replace(env, ctx, screenEditMenu(opened));
    return true;
  }

  const field = params[0];
  await answerCallbackQuery(env, query.id);

  if (field === 'name') {
    const updated = { ...temp, editField: 'name' };
    await setState(env, ctx.userId, STEP.TEAM_EDIT_FIELD, updated);
    await replace(env, ctx, screenEditName(updated));
    return true;
  }

  if (field === 'logo') {
    const updated = { ...temp, editField: 'logo' };
    await setState(env, ctx.userId, STEP.TEAM_EDIT_FIELD, updated);
    await replace(env, ctx, screenEditLogo(updated));
    return true;
  }

  if (field === 'player') {
    const index = Number(params[1]);
    if (!(index >= 1 && index <= 5)) {
      await sendMessage(env, ctx.chatId, 'Неизвестный номер игрока — открой меню правок заново.');
      return true;
    }
    const updated = {
      ...temp,
      editField: `player:${index}`,
      playerIndex: index - 1,
      pendingNick: ((temp.players || [])[index - 1] || {}).nick || ''
    };
    await setState(env, ctx.userId, STEP.TEAM_EDIT_FIELD, updated);
    await replace(env, ctx, screenEditPlayer(updated, index - 1));
    return true;
  }

  await sendMessage(env, ctx.chatId, 'Неизвестное поле для изменения.');
  return true;
}

/* ---------- Назад ---------- */
async function onBack(env, query, ctx) {
  const state = await getState(env, ctx.userId);
  const temp = state.temp || {};
  const discipline = temp.discipline;
  await answerCallbackQuery(env, query.id);

  switch (state.step) {
    case STEP.TYPE:
      if (!discipline) { await showMainMenu(env, ctx.chatId, ctx.userId); return true; }
      await showMainMenu(env, ctx.chatId, ctx.userId);
      return true;

    case STEP.TEAM_NAME:
      await setState(env, ctx.userId, STEP.TYPE, { discipline, type: null });
      await replace(env, ctx, screenType(discipline));
      return true;

    case STEP.TEAM_LOGO:
      await setState(env, ctx.userId, STEP.TEAM_NAME, temp);
      await replace(env, ctx, screenTeamName(discipline, '⬅️ Возврат к названию команды.', totalOf(temp)));
      return true;

    case STEP.TEAM_CAPTAIN:
      await setState(env, ctx.userId, STEP.TEAM_LOGO, temp);
      await replace(env, ctx, screenTeamLogo(temp, '⬅️ Возврат к логотипу.'));
      return true;

    case STEP.TEAM_PLAYER_NICK: {
      const index = Number(temp.playerIndex) || 0;
      if (index === 0) {
        // если спрашивали ник капитана — возвращаемся к нему
        const backToCaptain = totalOf(temp) >= TEAM_STEPS_CAPTAIN && !temp.captainNick && !ctx.username;
        if (backToCaptain) {
          await setState(env, ctx.userId, STEP.TEAM_CAPTAIN, temp);
          await replace(env, ctx, screenTeamCaptain(temp, '⬅️ Возврат к нику капитана.'));
        } else {
          await setState(env, ctx.userId, STEP.TEAM_LOGO, temp);
          await replace(env, ctx, screenTeamLogo(temp, '⬅️ Возврат к логотипу.'));
        }
      } else {
        const prev = { ...temp, playerIndex: index - 1 };
        await setState(env, ctx.userId, STEP.TEAM_PLAYER_NICK, prev);
        await replace(env, ctx, screenTeamPlayerNick(prev, `⬅️ Возврат к игроку ${index}.`));
      }
      return true;
    }

    case STEP.TEAM_PLAYER_ROLE: {
      const index = Number(temp.playerIndex) || 0;
      await setState(env, ctx.userId, STEP.TEAM_PLAYER_NICK, temp);
      await replace(env, ctx, screenTeamPlayerNick(temp, `⬅️ Возврат к нику игрока ${index + 1}.`));
      return true;
    }

    case STEP.TEAM_CONFIRM: {
      const last = { ...temp, playerIndex: 4 };
      await setState(env, ctx.userId, STEP.TEAM_PLAYER_NICK, last);
      await replace(env, ctx, screenTeamPlayerNick(last, '⬅️ Возврат к последнему игроку.'));
      return true;
    }

    case STEP.TEAM_EDIT_MENU:
    case STEP.TEAM_EDIT_FIELD: {
      const done = { ...temp, editField: null };
      await setState(env, ctx.userId, STEP.TEAM_CONFIRM, done);
      await replace(env, ctx, screenTeamConfirm(done, '⬅️ Возврат к проверке.'));
      return true;
    }

    case STEP.AGENT_NICK:
      await setState(env, ctx.userId, STEP.TYPE, { discipline, type: null });
      await replace(env, ctx, screenType(discipline));
      return true;

    case STEP.AGENT_ROLE: {
      const updated = { ...temp, nick: temp.nick || '' };
      await setState(env, ctx.userId, STEP.AGENT_NICK, updated);
      await replace(env, ctx, screenAgentNick(updated, '⬅️ Возврат к нику.'));
      return true;
    }

    case STEP.AGENT_RANK: {
      await setState(env, ctx.userId, STEP.AGENT_ROLE, temp);
      await replace(env, ctx, screenAgentRole(temp, '⬅️ Возврат к позиции.'));
      return true;
    }

    case STEP.AGENT_NOTE: {
      await setState(env, ctx.userId, STEP.AGENT_RANK, temp);
      await replace(env, ctx, screenAgentRank(temp, '⬅️ Возврат к рангу.'));
      return true;
    }

    case STEP.PLAYER_NICK:
      await setState(env, ctx.userId, STEP.TYPE, { discipline, type: null });
      await replace(env, ctx, screenType(discipline));
      return true;

    case STEP.PLAYER_TEAM: {
      await setState(env, ctx.userId, STEP.PLAYER_NICK, temp);
      await replace(env, ctx, screenPlayerLeadNick(temp, '⬅️ Возврат к нику.'));
      return true;
    }

    case STEP.PLAYER_ROLE: {
      await setState(env, ctx.userId, STEP.PLAYER_TEAM, temp);
      await replace(env, ctx, screenPlayerTeam(temp, '⬅️ Возврат к команде.'));
      return true;
    }

    default:
      await showMainMenu(env, ctx.chatId, ctx.userId);
      return true;
  }
}

/* ============================================================
   Текстовый ввод
   ============================================================ */
export async function handleText(env, message, ctx) {
  const state = await getState(env, ctx.userId);
  if (!state.step) return false;          // не наш апдейт — пусть index покажет меню
  // Шаги других обработчиков (например, причина отклонения) не трогаем
  if (!OWN_STEPS.has(state.step)) return false;

  const temp = state.temp || {};
  const value = ctx.text;

  switch (state.step) {
    case STEP.TEAM_NAME: return onTeamName(env, ctx, temp, value);
    case STEP.TEAM_LOGO: return onLogoText(env, ctx, temp, value);
    case STEP.TEAM_CAPTAIN: return onTeamCaptain(env, ctx, temp, value);
    case STEP.TEAM_PLAYER_NICK: return onPlayerNick(env, ctx, temp, value);
    case STEP.TEAM_EDIT_FIELD: return onEditFieldText(env, ctx, temp, value);
    case STEP.AGENT_NICK: return onAgentNick(env, ctx, temp, value);
    case STEP.AGENT_RANK: return onAgentRank(env, ctx, temp, value);
    case STEP.AGENT_NOTE: return onAgentNote(env, ctx, temp, value);
    case STEP.PLAYER_NICK: return onPlayerNickInput(env, ctx, temp, value);
    case STEP.PLAYER_TEAM: return onPlayerTeam(env, ctx, temp, value);
    default:
      // Шаг кнопочный: подсказываем, но прогресс не сбрасываем
      await sendMessage(env, ctx.chatId,
        'На этом шаге нужно нажать кнопку ниже или отменить всё командой /cancel.',
        { keyboard: kb([menuRow]) }
      );
      return true;
  }
}

/* ---------- Ветка A: текстовые шаги ---------- */
async function onTeamName(env, ctx, temp, raw) {
  const name = clean(raw);
  if (!isTeamName(name)) {
    return fail(env, ctx, 'Название: 2–30 символов, без спецсимволов.', screenTeamName(temp.discipline, null, totalOf(temp)));
  }
  const updated = { ...temp, name };
  await setState(env, ctx.userId, STEP.TEAM_LOGO, updated);
  await send(env, ctx, screenTeamLogo(updated));
  return true;
}

/** Ник капитана (спрашиваем, только если у пользователя нет @username) */
async function onTeamCaptain(env, ctx, temp, raw) {
  const nick = clean(raw);
  if (!isNick(nick)) {
    return fail(env, ctx, 'Ник: 2–30 символов.', screenTeamCaptain(temp));
  }
  const updated = { ...temp, captainNick: nick };
  return goToFirstPlayer(env, ctx, updated);
}

/** На шаге логотипа принимаем только фото */
async function onLogoText(env, ctx, temp) {
  return fail(env, ctx, 'Нужно фото. Пришли логотип или /cancel.', screenTeamLogo(temp));
}

async function onPlayerNick(env, ctx, temp, raw) {
  const nick = clean(raw);
  const index = Number(temp.playerIndex) || 0;
  const screen = screenTeamPlayerNick(temp);

  if (!isNick(nick)) return fail(env, ctx, 'Ник: 2–30 символов.', screen);

  const players = temp.players || [];
  const taken = players.some((player, i) => i !== index && player && player.nick &&
    player.nick.toLowerCase() === nick.toLowerCase());
  if (taken) return fail(env, ctx, 'Такой ник уже есть в составе.', screen);

  const updated = { ...temp, players: players.map((player) => player), pendingNick: nick };
  await setState(env, ctx.userId, STEP.TEAM_PLAYER_ROLE, updated);
  await send(env, ctx, screenTeamPlayerRole(updated));
  return true;
}

/** Первый игрок после логотипа */
async function goToFirstPlayer(env, ctx, temp, note) {
  const updated = { ...temp, playerIndex: 0, pendingNick: '' };
  await setState(env, ctx.userId, STEP.TEAM_PLAYER_NICK, updated);
  await send(env, ctx, screenTeamPlayerNick(updated, note));
  return true;
}

/**
 * Шаг после логотипа: если у отправителя нет @username и ник капитана ещё
 * не указан — один раз спрашиваем его, иначе сразу идём к игрокам.
 */
async function proceedAfterLogo(env, ctx, temp, note) {
  const needsCaptain = totalOf(temp) >= TEAM_STEPS_CAPTAIN && !temp.captainNick && !ctx.username;
  if (needsCaptain) {
    await setState(env, ctx.userId, STEP.TEAM_CAPTAIN, temp);
    await send(env, ctx, screenTeamCaptain(temp, note));
    return true;
  }
  return goToFirstPlayer(env, ctx, temp, note);
}

/* ---------- Правка полей ---------- */
async function onEditFieldText(env, ctx, temp, raw) {
  const field = String(temp.editField || '');

  if (field === 'name') {
    const name = clean(raw);
    if (!isTeamName(name)) return fail(env, ctx, 'Название: 2–30 символов, без спецсимволов.', screenEditName(temp));
    const updated = { ...temp, name, editField: null };
    await setState(env, ctx.userId, STEP.TEAM_CONFIRM, updated);
    await send(env, ctx, screenTeamConfirm(updated));
    return true;
  }

  if (field.startsWith('player:')) {
    const index = Number(field.split(':')[1]) - 1;
    const nick = clean(raw);
    if (!isNick(nick)) return fail(env, ctx, 'Ник: 2–30 символов.', screenEditPlayer(temp, index));

    const players = (temp.players || []).map((player) => player);
    const taken = players.some((player, i) => i !== index && player && player.nick &&
      player.nick.toLowerCase() === nick.toLowerCase());
    if (taken) return fail(env, ctx, 'Такой ник уже есть в составе.', screenEditPlayer(temp, index));

    players[index] = { ...(players[index] || {}), nick };
    const updated = { ...temp, players, pendingNick: nick, playerIndex: index };
    await setState(env, ctx.userId, STEP.TEAM_PLAYER_ROLE, updated);
    await send(env, ctx, screenTeamPlayerRole(updated));
    return true;
  }

  if (field === 'logo') {
    return fail(env, ctx, 'Нужно фото. Пришли логотип или /cancel.', screenEditLogo(temp));
  }

  await sendMessage(env, ctx.chatId, 'Не удалось определить, что меняем. Открой меню правок заново.');
  return true;
}

/* ---------- Ветка B: свободный агент ---------- */
async function onAgentNick(env, ctx, temp, raw) {
  const nick = clean(raw);
  if (!isNick(nick)) return fail(env, ctx, 'Ник: 2–30 символов.', screenAgentNick(temp));
  const updated = { ...temp, nick };
  await setState(env, ctx.userId, STEP.AGENT_ROLE, updated);
  await send(env, ctx, screenAgentRole(updated));
  return true;
}

async function onAgentRank(env, ctx, temp, raw) {
  const rank = canSkip(raw) ? '' : clean(raw);
  if (rank.length > 40) return fail(env, ctx, 'Ранг: до 40 символов.', screenAgentRank(temp));
  const updated = { ...temp, rank };
  await setState(env, ctx.userId, STEP.AGENT_NOTE, updated);
  await send(env, ctx, screenAgentNote(updated));
  return true;
}

async function onAgentNote(env, ctx, temp, raw) {
  const note = canSkip(raw) ? '' : clean(raw).slice(0, 300);
  return submitAgent(env, ctx, { ...temp, note });
}

async function submitAgent(env, ctx, temp) {
  const rate = await canSubmitLead(env, ctx.userId);
  if (!rate.allowed) {
    await sendMessage(env, ctx.chatId, rateLimitText(env, rate.retryAfterSec), { keyboard: kb([menuRow]) });
    return true;
  }

  const payload = {
    type: 'looking_for_team',
    nick: temp.nick,
    role: temp.role,
    roleLabel: temp.roleLabel,
    rank: temp.rank || '',
    note: temp.note || ''
  };

  const leadId = await createLead(env, {
    telegramId: ctx.userId,
    type: 'free_agent',
    discipline: temp.discipline,
    payload
  });

  await resetState(env, ctx.userId);
  await sendMessage(env, ctx.chatId,
    `Заявка <code>#${leadId}</code> принята.\n` +
    `Дисциплина: ${esc(disciplineLabel(temp.discipline))}\n\n` +
    'Капитаны увидят её после модерации.\n' + contactsBlock(),
    { keyboard: kb([menuRow]) }
  );

  await notifyAdmins(env,
    `📥 <b>Свободный агент</b>\n` +
    `${esc(temp.nick)} · ${esc(disciplineLabel(temp.discipline))} · ${esc(temp.roleLabel || '')}\n` +
    `Заявка <code>#${leadId}</code> · /leads`
  );
  return true;
}

/* ---------- Ветка C: заявка игрока ---------- */
async function onPlayerNickInput(env, ctx, temp, raw) {
  const nick = clean(raw);
  if (!isNick(nick)) return fail(env, ctx, 'Ник: 2–30 символов.', screenPlayerLeadNick(temp));
  const updated = { ...temp, nick };
  await setState(env, ctx.userId, STEP.PLAYER_TEAM, updated);
  await send(env, ctx, screenPlayerTeam(updated));
  return true;
}

async function onPlayerTeam(env, ctx, temp, raw) {
  const teamName = canSkip(raw) ? null : clean(raw);
  if (teamName && !isTeamName(teamName)) {
    return fail(env, ctx, 'Команда: 2–30 символов, без спецсимволов.', screenPlayerTeam(temp));
  }
  const updated = { ...temp, teamName };
  await setState(env, ctx.userId, STEP.PLAYER_ROLE, updated);
  await send(env, ctx, screenPlayerLeadRole(updated));
  return true;
}

async function submitPlayer(env, ctx, temp) {
  const rate = await canSubmitLead(env, ctx.userId);
  if (!rate.allowed) {
    await sendMessage(env, ctx.chatId, rateLimitText(env, rate.retryAfterSec), { keyboard: kb([menuRow]) });
    return true;
  }

  const payload = {
    type: 'player',
    nick: temp.nick,
    teamName: temp.teamName || null,
    role: temp.role,
    roleLabel: temp.roleLabel
  };

  const leadId = await createLead(env, {
    telegramId: ctx.userId,
    type: 'player',
    discipline: temp.discipline,
    payload
  });

  await resetState(env, ctx.userId);
  await sendMessage(env, ctx.chatId,
    `Заявка <code>#${leadId}</code> принята.\n` +
    `Дисциплина: ${esc(disciplineLabel(temp.discipline))}`,
    { keyboard: kb([menuRow]) }
  );

  await notifyAdmins(env,
    `📥 <b>Заявка игрока</b>\n` +
    `${esc(temp.nick)} · ${esc(disciplineLabel(temp.discipline))} · ${esc(temp.roleLabel || '')}` +
    (temp.teamName ? `\nКоманда: ${esc(temp.teamName)}` : '') +
    `\nЗаявка <code>#${leadId}</code> · /leads`
  );
  return true;
}

/* ============================================================
   Фото (логотип)
   ------------------------------------------------------------
   Логотип обязателен, лимит жёсткий: если даже самый маленький
   вариант от Telegram больше лимита — заявку не принимаем.
   ============================================================ */
export async function handlePhoto(env, message, ctx) {
  const state = await getState(env, ctx.userId);
  const temp = state.temp || {};
  const editingLogo = state.step === STEP.TEAM_EDIT_FIELD && temp.editField === 'logo';

  if (state.step !== STEP.TEAM_LOGO && !editingLogo) return false;

  await sendChatAction(env, ctx.chatId, 'upload_photo');

  let photo = null;
  let failed = false;
  try {
    photo = await getPhotoDataUrl(env, message.photo, maxLogoBytes(env));
  } catch (err) {
    failed = true;
    console.error('[reg] не удалось получить логотип:', err && err.message);
  }

  if (failed || !photo) {
    await sendMessage(env, ctx.chatId,
      problem('Не удалось скачать фото. Пришли его ещё раз.'),
      { keyboard: kb([menuRow]) }
    );
    return true;
  }

  // Больше лимита — не принимаем: просим сжать и прислать заново
  if (photo.oversized) {
    await sendMessage(env, ctx.chatId,
      problem(`Файл ${Math.round((photo.bytes || 0) / 1024)} КБ — больше лимита ${maxLogoKb(env)} КБ.\n` +
        'Сожми изображение и пришли заново.'),
      { keyboard: kb([menuRow]) }
    );
    return true;
  }

  const updated = {
    ...temp,
    logo: photo.dataUrl,
    logoOversized: false,
    logoBytes: photo.bytes || 0
  };
  await setState(env, ctx.userId, state.step, updated);

  const sizeKb = Math.round((photo.bytes || 0) / 1024);
  if (editingLogo) {
    const done = { ...updated, editField: null };
    await setState(env, ctx.userId, STEP.TEAM_CONFIRM, done);
    await send(env, ctx, screenTeamConfirm(done));
    return true;
  }

  await sendMessage(env, ctx.chatId, `Логотип принят (${sizeKb} КБ).`);
  return proceedAfterLogo(env, ctx, updated);
}
