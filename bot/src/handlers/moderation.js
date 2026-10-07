/* ============================================================
   Модерация заявок: /leads, карточка заявки, approve / reject / skip
   ------------------------------------------------------------
   Команды и кнопки:
     /leads                — счётчики и меню (только админ)
     mod:list:new          — первая заявка на модерации
     mod:list:approved     — список одобренных
     mod:list:rejected     — список отклонённых
     mod:view:<id>         — карточка конкретной заявки
     mod:approve:<id>      — одобрить (только pending)
     mod:reject:<id>       — отклонить: спрашиваем причину
     mod:skip:<id>         — пропустить, статус не меняем
     mod:cancel:<id>       — отменить ввод причины

   Approve/reject применяются ТОЛЬКО к pending: повторное нажатие
   (в том числе из старого сообщения) отвечает «Уже обработано».
   Причина отклонения вводится текстом, /skip — без причины,
   кнопка «🚫 Отменить» возвращает к карточке.
   ============================================================ */

import {
  sendMessage, answerCallbackQuery, editMessageReplyMarkup, inlineKeyboard
} from '../lib/telegram.js';
import {
  getState, setState, resetState, countLeads, pendingBreakdown,
  listLeads, getLead, updateLeadStatus, nextPendingLead, getUser,
  findApprovedTeamByName
} from '../lib/db.js';
import { esc, clean, truncate } from '../lib/esc.js';
import { disciplineLabel, leadTypeLabel } from '../lib/domain.js';
import { siteLine } from '../lib/texts.js';
import { kb, menuRow, backRow, screen, screenWithPhoto } from '../lib/ui.js';

export const commands = ['leads', 'skip'];
export const callbackPrefixes = ['mod'];

/** Шаг ожидания причины отклонения (хранится в states) */
const MOD_REASON = 'mod_reason';
/** Сколько заявок показываем в списках «одобренные»/«отклонённые» */
const PAGE_SIZE = 10;

const statusLabel = (status) => ({
  pending: 'на модерации',
  approved: 'одобрена',
  rejected: 'отклонена'
})[status] || String(status || '—');

const listTarget = (status) => (status === 'pending' ? 'new' : status);

/** ID заявки из callback_data: «12» → 12, «abc» → null */
function parseLeadId(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const canSkipText = (value) => /^\/?(skip|пропустить|-)$/i.test(clean(value));

/* ============================================================
   Команды
   ============================================================ */
export async function handleCommand(env, message, ctx) {
  if (ctx.cmd === 'leads') return showMenu(env, ctx);
  if (ctx.cmd === 'skip') return handleSkip(env, ctx);
  return false;
}

async function showMenu(env, ctx, note) {
  if (!ctx.isAdmin) {
    await sendMessage(env, ctx.chatId, '⛔ Команда доступна только организаторам турнира.');
    return true;
  }

  const counts = await countLeads(env);
  const breakdown = await pendingBreakdown(env);

  const lines = [
    note ? `${note}\n` : '',
    'Заявки',
    '',
    `На модерации: ${counts.pending}`,
    `Одобрено: ${counts.approved}`,
    `Отклонено: ${counts.rejected}`
  ].filter(Boolean);

  if (breakdown.length) {
    lines.push('', 'Ожидают решения');
    for (const row of breakdown) {
      lines.push(`• ${esc(disciplineLabel(row.discipline))} · ${esc(leadTypeLabel(row.type))}: ${row.n}`);
    }
  }

  const keyboard = kb([
    [{ text: `📥 Смотреть новые (${counts.pending})`, data: 'mod:list:new' }],
    [
      { text: `✅ Одобренные (${counts.approved})`, data: 'mod:list:approved' },
      { text: `❌ Отклонённые (${counts.rejected})`, data: 'mod:list:rejected' }
    ],
    [menuRow]
  ]);

  await screen(env, ctx, lines.join('\n'), keyboard);
  return true;
}

/** /skip в модерации = «отклонить без причины» */
async function handleSkip(env, ctx) {
  const state = await getState(env, ctx.userId);
  if (state.step !== MOD_REASON) return false;
  if (!ctx.isAdmin) return true;
  return submitRejection(env, ctx, state.temp, '');
}

/* ============================================================
   Кнопки
   ============================================================ */
export async function handleCallback(env, query, ctx) {
  const parts = String(ctx.data || '').split(':');
  const action = parts[1];
  const param = parts[2];
  const flag = parts[3];

  if (!ctx.isAdmin) {
    await answerCallbackQuery(env, query.id, { text: 'Недостаточно прав', showAlert: true });
    return true;
  }

  try {
    switch (action) {
      case 'menu': return await showMenu(env, ctx);
      case 'list': return await showList(env, query, ctx, param);
      case 'view': return await showOne(env, query, ctx, param);
      case 'approve': return await onApprove(env, query, ctx, param, flag);
      case 'reject': return await onRejectStart(env, query, ctx, param);
      case 'skip': return await onSkip(env, query, ctx, param);
      case 'cancel': return await onCancelReason(env, query, ctx, param);
      default:
        await answerCallbackQuery(env, query.id, { text: 'Неизвестное действие' });
        return true;
    }
  } catch (err) {
    console.error('[mod] ошибка обработки кнопки', ctx.data, err && err.stack ? err.stack : err);
    await answerCallbackQuery(env, query.id, { text: 'Что-то пошло не так, попробуйте ещё раз' });
    return true;
  }
}

/* ---------- Списки ---------- */
async function showList(env, query, ctx, group) {
  await answerCallbackQuery(env, query.id);

  if (group === 'new') {
    const lead = await nextPendingLead(env, 0);
    if (!lead) {
      await screen(env, ctx, '✅ Новых заявок нет — все рассмотрены.', kb([
        [{ text: '📋 К счётчикам', data: 'mod:menu' }],
        [menuRow]
      ]));
      return true;
    }
    await sendCard(env, ctx, lead);
    return true;
  }

  if (group !== 'approved' && group !== 'rejected') {
    await screen(env, ctx, 'Неизвестный список заявок.', kb([backRow('mod:menu', '◀ Назад')]));
    return true;
  }

  const status = group;
  const leads = await listLeads(env, { status, limit: PAGE_SIZE });
  if (!leads.length) {
    await screen(env, ctx,
      status === 'approved' ? 'Одобренных заявок пока нет.' : 'Отклонённых заявок пока нет.',
      kb([[{ text: '📋 К счётчикам', data: 'mod:menu' }], [menuRow]]));
    return true;
  }

  const title = status === 'approved' ? '✅ <b>Одобренные заявки</b>' : '❌ <b>Отклонённые заявки</b>';
  const lines = [title, ''];
  const rows = [];
  for (const lead of leads) {
    const name = lead.type === 'team'
      ? (lead.payload.name || 'без названия')
      : (lead.payload.nick || 'без ника');
    lines.push(`<code>#${lead.id}</code> · ${esc(disciplineLabel(lead.discipline))} · ${esc(name)}`);
    if (status === 'rejected') {
      lines.push(`   <i>причина: ${esc(truncate(lead.reject_reason || 'не указана', 60))}</i>`);
    }
    rows.push([{ text: `#${lead.id} · ${truncate(name, 24)}`, data: `mod:view:${lead.id}` }]);
  }
  lines.push('', `<i>Показано последних: ${leads.length}</i>`);

  rows.push([{ text: '📋 К счётчикам', data: 'mod:menu' }], [menuRow]);
  await screen(env, ctx, lines.join('\n'), kb(rows));
  return true;
}

/** Карточка конкретной заявки (mod:view:<id>) */
async function showOne(env, query, ctx, rawId) {
  const id = parseLeadId(rawId);
  if (!id) {
    await answerCallbackQuery(env, query.id, { text: 'Неверный ID заявки', showAlert: true });
    return true;
  }
  const lead = await getLead(env, id);
  if (!lead) {
    await answerCallbackQuery(env, query.id, { text: 'Заявка не найдена', showAlert: true });
    await screen(env, ctx, `Заявка <code>#${id}</code> не найдена — возможно, её удалили.`, kb([
      [{ text: '📋 К счётчикам', data: 'mod:menu' }],
      [menuRow]
    ]));
    return true;
  }
  await answerCallbackQuery(env, query.id);
  await sendCard(env, ctx, lead, { backToList: listTarget(lead.status) });
  return true;
}

/* ---------- Одобрение ---------- */
async function onApprove(env, query, ctx, rawId, flag) {
  const id = parseLeadId(rawId);
  if (!id) {
    await answerCallbackQuery(env, query.id, { text: 'Неверный ID заявки', showAlert: true });
    return true;
  }

  const lead = await getLead(env, id);
  if (!lead) {
    await answerCallbackQuery(env, query.id, { text: 'Заявка не найдена', showAlert: true });
    return true;
  }
  if (lead.status !== 'pending') {
    await answerCallbackQuery(env, query.id, { text: 'Уже обработано', showAlert: true });
    await sendMessage(env, ctx.chatId,
      `ℹ️ Уже обработано: заявка <code>#${lead.id}</code> — ${statusLabel(lead.status)}.`,
      { keyboard: kb([[{ text: '📋 К счётчикам', data: 'mod:menu' }], [menuRow]]) });
    return true;
  }

  // Дубликат названия среди уже одобренных команд: предупреждаем, но не запрещаем
  if (lead.type === 'team' && flag !== 'dup') {
    const twin = await findApprovedTeamByName(env, lead.discipline, (lead.payload || {}).name || '', lead.id);
    if (twin) {
      await answerCallbackQuery(env, query.id, { text: 'Такая команда уже одобрена' });
      await screen(env, ctx,
        `Команда «${esc((lead.payload || {}).name || '')}» уже одобрена ` +
        `(заявка #${twin.id}, ${esc(disciplineLabel(twin.discipline))}).\n\n` +
        'Одобрить как дубликат?',
        kb([
          [{ text: 'Да, одобрить как дубликат', data: `mod:approve:${lead.id}:dup` }],
          [{ text: 'Отмена', data: `mod:cancel:${lead.id}` }]
        ]));
      return true;
    }
  }

  await answerCallbackQuery(env, query.id, { text: 'Одобрено' });
  await updateLeadStatus(env, lead.id, 'approved', ctx.userId, null);
  const notified = await notifyAuthor(env, { ...lead, status: 'approved' }, 'approved', '');
  await stripButtons(env, ctx);
  await showNextAfter(env, ctx, lead.id, `Заявка #${lead.id} одобрена.`, notified);
  return true;
}

/* ---------- Отклонение ---------- */
async function onRejectStart(env, query, ctx, rawId) {
  const id = parseLeadId(rawId);
  if (!id) {
    await answerCallbackQuery(env, query.id, { text: 'Неверный ID заявки', showAlert: true });
    return true;
  }

  const lead = await getLead(env, id);
  if (!lead) {
    await answerCallbackQuery(env, query.id, { text: 'Заявка не найдена', showAlert: true });
    return true;
  }
  if (lead.status !== 'pending') {
    await answerCallbackQuery(env, query.id, { text: 'Уже обработано', showAlert: true });
    await sendMessage(env, ctx.chatId,
      `Уже обработано: заявка #${lead.id} — ${statusLabel(lead.status)}.`,
      { keyboard: kb([[{ text: 'К счётчикам', data: 'mod:menu' }], [menuRow]]) });
    return true;
  }

  await answerCallbackQuery(env, query.id);
  await setState(env, ctx.userId, MOD_REASON, { leadId: lead.id });
  await screen(env, ctx,
    `Отклонение заявки #${lead.id}\n\n` +
    'Причина отклонения? Напиши текстом или нажми /skip, чтобы отклонить без комментария.\n' +
    'Автор увидит причину. Отмена: /cancel',
    kb([
      [{ text: 'Отменить', data: `mod:cancel:${lead.id}` }],
      [menuRow]
    ]));
  return true;
}

/** Причина получена (текстом, /skip или кнопкой) */
async function submitRejection(env, ctx, temp, reason) {
  const leadId = Number(temp && temp.leadId);
  const lead = leadId ? await getLead(env, leadId) : null;
  await resetState(env, ctx.userId);

  if (!lead) {
    await sendMessage(env, ctx.chatId, 'Заявка не найдена — возможно, её уже удалили.',
      { keyboard: kb([[{ text: 'К счётчикам', data: 'mod:menu' }], [menuRow]]) });
    return true;
  }
  if (lead.status !== 'pending') {
    await sendMessage(env, ctx.chatId, `Уже обработано: заявка #${lead.id} — ${statusLabel(lead.status)}.`,
      { keyboard: kb([[{ text: 'К счётчикам', data: 'mod:menu' }], [menuRow]]) });
    return true;
  }

  const cleanReason = reason ? clean(reason).slice(0, 300) : '';
  await updateLeadStatus(env, lead.id, 'rejected', ctx.userId, cleanReason || null);
  const notified = await notifyAuthor(env, { ...lead, status: 'rejected', reject_reason: cleanReason }, 'rejected', cleanReason);
  await stripButtons(env, ctx);
  await showNextAfter(env, ctx, lead.id,
    `Заявка #${lead.id} отклонена.` +
    (cleanReason ? `\nПричина: ${esc(cleanReason)}` : '\nПричина не указана.'),
    notified);
  return true;
}

/** Отмена ввода причины — карточка заявки возвращается, статус не меняется */
async function onCancelReason(env, query, ctx, rawId) {
  const id = parseLeadId(rawId);
  await answerCallbackQuery(env, query.id, { text: 'Отменено' });
  await resetState(env, ctx.userId);

  const lead = id ? await getLead(env, id) : null;
  if (!lead) {
    await showMenu(env, ctx, 'Ввод причины отменён.');
    return true;
  }
  await sendCard(env, ctx, lead, { note: 'Ввод причины отменён — заявка не изменена.' });
  return true;
}

/* ---------- Пропустить ---------- */
async function onSkip(env, query, ctx, rawId) {
  const id = parseLeadId(rawId);
  if (!id) {
    await answerCallbackQuery(env, query.id, { text: 'Неверный ID заявки', showAlert: true });
    return true;
  }
  const lead = await getLead(env, id);
  if (!lead) {
    await answerCallbackQuery(env, query.id, { text: 'Заявка не найдена', showAlert: true });
    return true;
  }
  if (lead.status !== 'pending') {
    await answerCallbackQuery(env, query.id, { text: 'Уже обработано', showAlert: true });
  } else {
    await answerCallbackQuery(env, query.id, { text: 'Пропущено' });
  }

  const next = await nextPendingLead(env, lead.id);
  if (!next || next.id === lead.id) {
    await screen(env, ctx, 'Больше новых заявок нет.', kb([
      [{ text: '📋 К счётчикам', data: 'mod:menu' }],
      [menuRow]
    ]));
    return true;
  }
  await sendCard(env, ctx, next, { note: `⏭ Заявка <code>#${lead.id}</code> пропущена.` });
  return true;
}

/* ---------- Общее ---------- */

/** Показать следующую pending-заявку или сообщить, что больше нет */
async function showNextAfter(env, ctx, currentId, summary, notified) {
  const warn = notified ? '' : '\n⚠️ Не удалось уведомить автора (возможно, бот заблокирован).';
  const next = await nextPendingLead(env, currentId);
  if (next && next.id !== currentId) {
    await sendCard(env, ctx, next, { note: summary + warn });
    return;
  }
  await sendMessage(env, ctx.chatId, `${summary}${warn}\n\nБольше новых заявок нет.`, {
    keyboard: kb([[{ text: '📋 К счётчикам', data: 'mod:menu' }], [menuRow]])
  });
}

/** Убрать кнопки у обработанной карточки, чтобы не нажимали повторно */
async function stripButtons(env, ctx) {
  if (!ctx.messageId) return;
  try {
    await editMessageReplyMarkup(env, ctx.chatId, ctx.messageId, inlineKeyboard([]));
  } catch (err) {
    console.warn('[mod] не удалось убрать кнопки:', err && err.message);
  }
}

/** Текст карточки заявки */
function leadCard(lead, author) {
  const p = lead.payload || {};
  const lines = [
    `${esc(disciplineLabel(lead.discipline))} · ${esc(leadTypeLabel(lead.type))}`,
    '─────'
  ];

  if (lead.type === 'team') {
    lines.push(`Название: ${esc(p.name || '—')}`);
    lines.push(`Логотип: ${p.logo ? (p.logoOversized ? 'больше лимита' : 'загружен') : 'нет'}`);
    lines.push(`Капитан: ${esc(p.captainNick || '—')}`);
    lines.push('');
    const players = p.players || [];
    if (players.length) {
      players.forEach((player, index) => {
        lines.push(`${index + 1}. ${esc(player.nick || '—')} — ${esc(player.roleLabel || player.role || '')}`);
      });
    } else {
      lines.push('состав не заполнен');
    }
  } else if (lead.type === 'free_agent') {
    lines.push(`Ник: ${esc(p.nick || '—')}`);
    lines.push(`Позиция: ${esc(p.roleLabel || p.role || '—')}`);
    if (p.rank) lines.push(`Ранг: ${esc(p.rank)}`);
    if (p.note) lines.push(`О себе: ${esc(truncate(p.note, 200))}`);
  } else {
    lines.push(`Ник: ${esc(p.nick || '—')}`);
    if (p.teamName) lines.push(`Команда: ${esc(p.teamName)}`);
    lines.push(`Позиция: ${esc(p.roleLabel || p.role || '—')}`);
  }

  lines.push('');
  const username = author && author.username ? '@' + esc(author.username) + ' ' : '';
  lines.push(`Telegram: ${username}(${lead.telegram_id})`);
  lines.push(`Заявка #${lead.id} · ${esc(String(lead.created_at || ''))} · ${statusLabel(lead.status)}`);
  if (lead.status === 'rejected') {
    lines.push(`Причина: ${esc(lead.reject_reason || 'не указана')}`);
  }
  return lines.join('\n');
}

/** Клавиатура карточки: действия только для pending */
function leadKeyboard(lead, backToList) {
  const rows = [];
  if (lead.status === 'pending') {
    rows.push([
      { text: '✅ Одобрить', data: `mod:approve:${lead.id}` },
      { text: '❌ Отклонить', data: `mod:reject:${lead.id}` }
    ]);
    rows.push([{ text: '⏭ Пропустить', data: `mod:skip:${lead.id}` }]);
  }
  rows.push([{ text: '◀ Назад', data: `mod:list:${backToList || listTarget(lead.status)}` }]);
  return kb(rows);
}

/** Отправка карточки (с логотипом, если он есть) */
async function sendCard(env, ctx, lead, { note = null, backToList = null } = {}) {
  let author = null;
  try {
    author = await getUser(env, lead.telegram_id);
  } catch (err) {
    console.warn('[mod] не удалось прочитать автора заявки:', err && err.message);
  }

  const text = (note ? `${note}\n\n` : '') + leadCard(lead, author);
  const keyboard = leadKeyboard(lead, backToList);
  const logo = lead.type === 'team' && lead.payload && lead.payload.logo ? lead.payload.logo : null;

  if (logo) {
    const sent = await screenWithPhoto(env, ctx, {
      photo: logo,
      text,
      caption: text,
      keyboard
    });
    if (sent) return;
  }
  await screen(env, ctx, text, keyboard);
}

/** Уведомление автору заявки (ошибка доставки не ломает модерацию) */
async function notifyAuthor(env, lead, status, reason) {
  const p = lead.payload || {};
  let text;

  if (status === 'approved') {
    if (lead.type === 'team') {
      text = `Заявка на команду «${esc(p.name || '')}» одобрена.\n` +
        'Команда появится на сайте после импорта.\n' + siteLine();
    } else if (lead.type === 'free_agent') {
      text = 'Заявка свободного агента одобрена.\nКапитаны увидят тебя после импорта.\n' + siteLine();
    } else {
      text = 'Заявка одобрена.\n' + siteLine();
    }
  } else {
    text = 'Заявка отклонена.\n' +
      (reason && String(reason).trim() ? `Причина: ${esc(reason)}` : 'Причина не указана.');
  }

  try {
    await sendMessage(env, lead.telegram_id, text, { keyboard: kb([menuRow]) });
    return true;
  } catch (err) {
    console.warn(`[mod] не удалось уведомить автора ${lead.telegram_id}:`, err && err.message);
    return false;
  }
}

/* ============================================================
   Ввод причины отклонения
   ============================================================ */
export async function handleText(env, message, ctx) {
  const state = await getState(env, ctx.userId);
  if (!state.step || state.step !== MOD_REASON) return false;
  if (!ctx.isAdmin) {
    await resetState(env, ctx.userId);
    return true;
  }
  const reason = canSkipText(ctx.text) ? '' : ctx.text;
  return submitRejection(env, ctx, state.temp, reason);
}

export async function handlePhoto() {
  return false;
}
