/* ============================================================
   /my, /status, /faq — личный кабинет участника и справка
   ------------------------------------------------------------
   • /my (и «Мои заявки» в меню) — список заявок пользователя
     со статусами; карточка заявки: состав, причина отказа,
     что делать дальше.
   • Отзыв заявки, пока она на модерации.
   • «Подать заново» после отказа.
   • /faq — ответы на частые вопросы кнопками.
   • Свободный текст вне диалога («как зарегистрироваться?»,
     «что с моей заявкой») узнаётся по ключевым словам.
   ============================================================ */

import { sendMessage, answerCallbackQuery, inlineKeyboard } from '../lib/telegram.js';
import { listLeads, getLead, withdrawLead, getState, sqliteTimeToDate } from '../lib/db.js';
import { esc, truncate } from '../lib/esc.js';
import {
  disciplineLabel, leadTypeLabel, leadStatusLabel, leadStatusIcon
} from '../lib/domain.js';
import { CONTACTS, SITE_URL, contactsBlock } from '../lib/texts.js';
import { screen } from '../lib/ui.js';

export const commands = ['my', 'status', 'faq'];
export const callbackPrefixes = ['my', 'faq'];

const kb = inlineKeyboard;
const menuRow = [{ text: '🏠 В меню', data: 'act:menu' }];
const LIST_LIMIT = 8;

/* ============================================================
   Заявки пользователя
   ============================================================ */

/** «15.10» из времени SQLite (UTC) */
function shortDate(value) {
  const date = sqliteTimeToDate(value);
  if (!date) return '';
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${d}.${m}`;
}

/** Короткое название заявки для списка: «Команда «Spirit»» */
function leadTitle(lead) {
  const p = lead.payload || {};
  if (lead.type === 'team') return `Команда «${truncate(p.name || '—', 28)}»`;
  if (lead.type === 'free_agent') return `Ищу команду · ${truncate(p.nick || '—', 24)}`;
  return `Игрок · ${truncate(p.nick || '—', 24)}`;
}

export async function showMyLeads(env, ctx) {
  const leads = await listLeads(env, { telegramId: ctx.userId, limit: LIST_LIMIT });

  if (!leads.length) {
    return screen(env, ctx,
      '📋 <b>Мои заявки</b>\n\n' +
      'Пока ничего не отправлено. Заявка занимает пару минут: команда, свободный агент или заявка игрока.',
      kb([[{ text: '➕ Подать заявку', data: 'act:menu' }], [{ text: '❓ Частые вопросы', data: 'faq:menu' }]]));
  }

  const lines = ['📋 <b>Мои заявки</b>', ''];
  const rows = [];
  for (const lead of leads) {
    lines.push(`${leadStatusIcon(lead.status)} <b>#${lead.id}</b> · ${esc(leadTitle(lead))}`);
    lines.push(`     ${esc(disciplineLabel(lead.discipline))} · ${leadStatusLabel(lead.status)} · ${shortDate(lead.created_at)}`);
    rows.push([{ text: `${leadStatusIcon(lead.status)} #${lead.id} · ${truncate(leadTitle(lead), 30)}`, data: `my:view:${lead.id}` }]);
  }

  const pending = leads.filter((l) => l.status === 'pending').length;
  lines.push('');
  lines.push(pending
    ? `На модерации: ${pending}. Решение придёт сюда — писать ничего не нужно.`
    : 'Нажми на заявку, чтобы увидеть подробности.');

  rows.push([{ text: '➕ Новая заявка', data: 'act:menu' }, { text: '❓ FAQ', data: 'faq:menu' }]);
  return screen(env, ctx, lines.join('\n'), kb(rows));
}

/** Строки с содержимым заявки */
function leadDetails(lead) {
  const p = lead.payload || {};
  const out = [];
  if (lead.type === 'team') {
    out.push(`Команда: <b>${esc(p.name || '—')}</b>`);
    if (p.captainNick) out.push(`Капитан: ${esc(p.captainNick)}`);
    const players = Array.isArray(p.players) ? p.players : [];
    players.forEach((pl, i) => out.push(`  ${i + 1}. ${esc(pl.nick)} — ${esc(pl.roleLabel || pl.role || '')}`));
  } else if (lead.type === 'free_agent') {
    out.push(`Ник: <b>${esc(p.nick || '—')}</b>`);
    out.push(`Позиция: ${esc(p.roleLabel || p.role || '—')}`);
    if (p.rank) out.push(`Ранг: ${esc(p.rank)}`);
    if (p.note) out.push(`О себе: ${esc(truncate(p.note, 200))}`);
  } else {
    out.push(`Ник: <b>${esc(p.nick || '—')}</b>`);
    out.push(`Команда: ${esc(p.teamName || 'без команды')}`);
    out.push(`Позиция: ${esc(p.roleLabel || p.role || '—')}`);
  }
  return out;
}

function nextStepText(lead) {
  if (lead.status === 'pending') {
    return 'Организаторы проверяют заявки вручную. Решение придёт в этот чат.\nПередумал или ошибся — заявку можно отозвать и подать заново.';
  }
  if (lead.status === 'approved') {
    return lead.type === 'team'
      ? `Команда будет показана на сайте после импорта организаторами.\n${SITE_URL}`
      : 'Заявка принята. Капитаны увидят её после импорта организаторами.';
  }
  if (lead.status === 'rejected') {
    const reason = lead.reject_reason && String(lead.reject_reason).trim();
    return (reason ? `Причина: <b>${esc(reason)}</b>\n` : 'Причина не указана.\n') +
      'Можно исправить данные и подать заявку заново.';
  }
  return 'Заявка отозвана. Можно подать новую в любой момент.';
}

async function showLead(env, ctx, lead) {
  const lines = [
    `${leadStatusIcon(lead.status)} <b>Заявка #${lead.id}</b> — ${leadStatusLabel(lead.status)}`,
    `${esc(leadTypeLabel(lead.type))} · ${esc(disciplineLabel(lead.discipline))} · ${shortDate(lead.created_at)}`,
    '',
    ...leadDetails(lead),
    '',
    nextStepText(lead)
  ];

  const rows = [];
  if (lead.status === 'pending') rows.push([{ text: '🗑 Отозвать заявку', data: `my:wd:${lead.id}` }]);
  if (lead.status === 'rejected' || lead.status === 'withdrawn') {
    rows.push([{ text: '🔁 Подать заново', data: `reg:disc:${lead.discipline}` }]);
  }
  rows.push([{ text: '⬅️ К списку', data: 'my:list' }, { text: '🏠 В меню', data: 'act:menu' }]);
  return screen(env, ctx, lines.join('\n'), kb(rows));
}

/** Заявка должна существовать и принадлежать пользователю */
async function ownLead(env, query, ctx, rawId) {
  const id = Number(rawId);
  const lead = Number.isInteger(id) && id > 0 ? await getLead(env, id) : null;
  if (!lead || Number(lead.telegram_id) !== Number(ctx.userId)) {
    await answerCallbackQuery(env, query.id, { text: 'Заявка не найдена', showAlert: true });
    return null;
  }
  return lead;
}

/* ============================================================
   FAQ
   ============================================================ */

const FAQ = {
  how: {
    title: 'Как подать заявку',
    text: () => [
      '1. Нажми /start и выбери дисциплину.',
      '2. Выбери, как участвуешь: командой, свободным агентом или игроком.',
      '3. Ответь на вопросы бота — на каждом шаге есть «Назад» и /cancel.',
      '4. Проверь данные и подтверди. Заявка уйдёт на ручную модерацию.',
      '',
      'Следить за статусом: /my'
    ].join('\n')
  },
  team: {
    title: 'Что нужно для команды',
    text: () => [
      'Для заявки команды понадобятся:',
      '• название (2–30 символов);',
      '• логотип — картинкой, не больше ' + logoKb() + ' КБ;',
      '• пять игроков: ник и позиция каждого;',
      '• ник капитана (если у тебя нет @username, бот спросит).',
      '',
      'Перед отправкой бот покажет итоговую карточку — в ней можно всё поправить.'
    ].join('\n')
  },
  agent: {
    title: 'Я без команды',
    text: () => [
      'Два варианта:',
      '• <b>Ищу команду</b> — ник, позиция, ранг и пара слов о себе. Капитаны увидят тебя после модерации.',
      '• <b>Заявка игрока</b> — если уже знаешь, в какую команду хочешь: ник, команда и позиция.'
    ].join('\n')
  },
  logo: {
    title: 'Логотип',
    text: () => [
      'Пришли логотип обычным фото или картинкой, лимит — ' + logoKb() + ' КБ.',
      'Не проходит по размеру — пересохрани картинку в меньшем разрешении или отправь через «сжатое» фото.',
      'Логотип обязателен: без него заявку команды отправить нельзя.'
    ].join('\n')
  },
  wait: {
    title: 'Когда будет решение',
    text: () => [
      'Заявки проверяют организаторы вручную. Как только решение будет — бот сам напишет сюда: одобрено или отклонено, и если отклонено — с причиной.',
      'Текущий статус всегда виден в /my.'
    ].join('\n')
  },
  edit: {
    title: 'Ошибся в заявке',
    text: () => [
      'Пока заявка на модерации, её можно отозвать: /my → заявка → «Отозвать». После этого подай новую.',
      'Если уже одобрена — напиши организаторам: ' + CONTACTS
    ].join('\n')
  },
  contact: {
    title: 'Связаться с организаторами',
    text: () => ['По вопросам, которых нет в списке:', contactsBlock()].join('\n')
  }
};

let LOGO_KB = 200;
const logoKb = () => LOGO_KB;

function faqMenu() {
  const keys = Object.keys(FAQ);
  const rows = [];
  for (let i = 0; i < keys.length; i += 2) {
    rows.push(keys.slice(i, i + 2).map((k) => ({ text: FAQ[k].title, data: `faq:${k}` })));
  }
  rows.push([{ text: '📋 Мои заявки', data: 'my:list' }, { text: '🏠 В меню', data: 'act:menu' }]);
  return kb(rows);
}

export async function showFaqMenu(env, ctx) {
  LOGO_KB = Number(env.LOGO_MAX_KB) || 200;
  return screen(env, ctx, '❓ <b>Частые вопросы</b>\n\nВыбери тему:', faqMenu());
}

async function showFaqTopic(env, ctx, key) {
  LOGO_KB = Number(env.LOGO_MAX_KB) || 200;
  const topic = FAQ[key];
  if (!topic) return showFaqMenu(env, ctx);
  return screen(env, ctx, `❓ <b>${esc(topic.title)}</b>\n\n${topic.text()}`,
    kb([[{ text: '⬅️ Все вопросы', data: 'faq:menu' }, { text: '🏠 В меню', data: 'act:menu' }]]));
}

/* ============================================================
   Обработчики
   ============================================================ */

export async function handleCommand(env, message, ctx) {
  if (ctx.cmd === 'my' || ctx.cmd === 'status') {
    await showMyLeadsNew(env, ctx);
    return true;
  }
  if (ctx.cmd === 'faq') {
    await sendFaqNew(env, ctx);
    return true;
  }
  return false;
}

/* Команды приходят без messageId кнопки — отвечаем новым сообщением */
const fresh = (ctx) => ({ ...ctx, messageId: null });
const showMyLeadsNew = (env, ctx) => showMyLeads(env, fresh(ctx));
const sendFaqNew = (env, ctx) => showFaqMenu(env, fresh(ctx));

export async function handleCallback(env, query, ctx) {
  const [prefix, action, id] = String(ctx.data || '').split(':');

  if (prefix === 'faq') {
    await answerCallbackQuery(env, query.id);
    if (!action || action === 'menu') await showFaqMenu(env, ctx);
    else await showFaqTopic(env, ctx, action);
    return true;
  }

  if (action === 'list') {
    await answerCallbackQuery(env, query.id);
    await showMyLeads(env, ctx);
    return true;
  }

  if (action === 'view') {
    const lead = await ownLead(env, query, ctx, id);
    if (!lead) return true;
    await answerCallbackQuery(env, query.id);
    await showLead(env, ctx, lead);
    return true;
  }

  if (action === 'wd') {
    const lead = await ownLead(env, query, ctx, id);
    if (!lead) return true;
    await answerCallbackQuery(env, query.id);
    if (lead.status !== 'pending') {
      await showLead(env, ctx, lead);
      return true;
    }
    await screen(env, ctx,
      `Отозвать заявку <b>#${lead.id}</b> (${esc(leadTitle(lead))})?\nМодераторы её больше не увидят.`,
      kb([
        [{ text: 'Да, отозвать', data: `my:wdok:${lead.id}` }],
        [{ text: 'Нет, оставить', data: `my:view:${lead.id}` }]
      ]));
    return true;
  }

  if (action === 'wdok') {
    const lead = await ownLead(env, query, ctx, id);
    if (!lead) return true;
    const done = await withdrawLead(env, lead.id, ctx.userId);
    await answerCallbackQuery(env, query.id, { text: done ? 'Заявка отозвана' : 'Уже обработана' });
    const updated = await getLead(env, lead.id);
    await showLead(env, ctx, updated || lead);
    return true;
  }

  await answerCallbackQuery(env, query.id, { text: 'Кнопка больше не активна' });
  return true;
}

/* ============================================================
   Свободный текст вне диалога
   ------------------------------------------------------------
   Работает только когда никакой шаг не ждёт ответа — иначе
   текст принадлежит регистрации. Порядок обработчиков в index.js
   гарантирует, что мы идём после неё.
   ============================================================ */

const INTENTS = [
  { re: /(стат(ус|усы)|мо[ия] заявк|моя заявка|что с (моей )?заявкой|проверь заявку|одобри|отклон)/i, run: showMyLeadsNew },
  { re: /(как (зарегистр|подать|участв|записа)|регистрац|хочу участ)/i, run: (env, ctx) => showFaqTopicNew(env, ctx, 'how') },
  { re: /(логотип|лого\b|аватар)/i, run: (env, ctx) => showFaqTopicNew(env, ctx, 'logo') },
  { re: /(когда.*(решени|ответ|провер)|как долго|сколько.*(жд|модерац)|модерац)/i, run: (env, ctx) => showFaqTopicNew(env, ctx, 'wait') },
  { re: /(без команды|свободн|ищу команду|ищем игрок|агент)/i, run: (env, ctx) => showFaqTopicNew(env, ctx, 'agent') },
  { re: /(организатор|связ(аться|ь)|контакт|админ|поддержк)/i, run: (env, ctx) => showFaqTopicNew(env, ctx, 'contact') },
  { re: /(помощь|помоги|справк|faq|вопрос|не понима|что (ты )?умеешь|команды)/i, run: sendFaqNew }
];

const showFaqTopicNew = (env, ctx, key) => showFaqTopic(env, fresh(ctx), key);

export async function handleText(env, message, ctx) {
  const state = await getState(env, ctx.userId);
  if (state.step) return false;               // идёт диалог — не вмешиваемся
  const text = String(ctx.text || '');
  if (!text || text.length > 200) return false;
  for (const intent of INTENTS) {
    if (intent.re.test(text)) {
      await intent.run(env, ctx);
      return true;
    }
  }
  return false;
}

export async function handlePhoto() {
  return false;
}

