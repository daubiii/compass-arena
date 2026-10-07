/* ============================================================
   Самопроверка бота без сети, без wrangler и без Cloudflare.
   ------------------------------------------------------------
   Запуск: npm run check   (или node scripts/self-check.mjs)

   Покрывает:
     • экранирование, валидацию, base64, домен (дисциплины и роли);
     • помощники D1 на in-memory замене (scripts/fake-d1.mjs);
     • маршрутизацию апдейтов, права администратора, секрет webhook,
       прод-режим без WEBHOOK_SECRET;
     • логотипы: выбор размера Telegram и флаг oversized;
     • ШАГ 3 — все три ветки регистрации, валидации, правки,
       дубликаты и rate limit.
   ============================================================ */

import { esc, isNick, isTeamName, slug, plural, truncate, bytesToBase64, dateStamp } from '../src/lib/esc.js';
import { inlineKeyboard, getPhotoDataUrl } from '../src/lib/telegram.js';
import { canSubmitLead, parseJson, sqliteTimeToDate, isAdmin, createLead, getState, setState, resetState, findPendingTeamByName, countLeads } from '../src/lib/db.js';
import { roleLabel, roleNum, roleTitle, disciplineLabel, leadTypeLabel, DISCIPLINE_KEYS } from '../src/lib/domain.js';
import { handleUpdate, checkWebhookSecret, isProduction } from '../src/index.js';
import worker from '../src/index.js';
import { createFakeD1 } from './fake-d1.mjs';

let passed = 0;
let failed = 0;

function ok(condition, label, extra) {
  if (condition) {
    passed++;
    console.log('  ok   ' + label);
  } else {
    failed++;
    console.log('  FAIL ' + label + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
  }
}

const ADMIN = 111;
const USER = 222;
const USER2 = 333;

/* ============================================================
   Поддельный Bot API
   ============================================================ */
const calls = [];
const originalFetch = globalThis.fetch;
/** Все callback_data, которые бот отправлял за прогон — проверяем длину в конце */
const allCallbackData = [];
/** Все кнопки за прогон — проверяем, что каждая имеет текст и действие */
const allButtons = [];

function mockTelegram(options = {}) {
  calls.length = 0;
  globalThis.fetch = async (url, init = {}) => {
    const urlStr = String(url);
    // скачивание файла (логотип)
    if (urlStr.includes('/file/bot')) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array(options.fileBytes || [1, 2, 3, 4]).buffer
      };
    }
    const method = urlStr.split('/').pop().split('?')[0];
    let body = null;
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    } else if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
      const doc = init.body.get('document');
      body = {
        multipart: true,
        chatId: init.body.get('chat_id'),
        caption: init.body.get('caption'),
        filename: doc && (doc.name || doc.filename),
        fields: Array.from(init.body.keys())
      };
    }
    if (body && body.reply_markup) {
      for (const row of (body.reply_markup.inline_keyboard || [])) {
        for (const btn of row) {
          allButtons.push(btn);
          if (btn.callback_data) allCallbackData.push(btn.callback_data);
        }
      }
    }
    calls.push({ method, body, url: urlStr });
    const custom = options[method];
    const result = custom ? await custom(body) : { message_id: calls.length };
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
  };
}

const isMessage = (call) => call.method === 'sendMessage' || call.method === 'editMessageText';
const messages = () => calls.filter(isMessage);
const last = () => {
  const list = messages();
  return list.length ? String(list[list.length - 1].body.text || '') : '';
};
/** Последнее сообщение конкретному чату (важно: после ответа пользователю бот пишет админу) */
const lastTo = (chatId) => {
  const list = messages().filter((call) => String(call.body.chat_id) === String(chatId));
  return list.length ? String(list[list.length - 1].body.text || '') : '';
};
const marker = () => calls.length;
const textsSince = (from) => calls.slice(from).filter(isMessage).map((call) => String(call.body.text || '')).join('\n');
/** Подписи кнопок (callback_data и текст) из сообщений, отправленных после отметки */
const markupSince = (from) => calls.slice(from).filter(isMessage)
  .map((call) => JSON.stringify(call.body.reply_markup || {}))
  .join(' ');
const answers = () => calls.filter((call) => call.method === 'answerCallbackQuery');
const lastAnswer = () => {
  const list = answers();
  return list.length ? String(list[list.length - 1].body.text || '') : '';
};

/* ============================================================
   Тестовые апдейты и окружение
   ============================================================ */
const from = (id, username = 'tester') => ({ id, username, first_name: 'Тест', last_name: null });

const messageUpdate = (id, text, extra = {}) => ({
  update_id: 1,
  message: { message_id: 10, from: from(id), chat: { id }, text, ...extra }
});

const photoUpdate = (id, photo) => ({
  update_id: 3,
  message: { message_id: 12, from: from(id), chat: { id }, photo }
});

const callbackUpdate = (id, data) => ({
  update_id: 2,
  callback_query: { id: 'cb-' + data, from: from(id), data, message: { message_id: 11, chat: { id } } }
});

/* Пользователь без @username — для проверки вопроса про капитана */
const fromNoUser = (id) => ({ id, first_name: 'Тест', last_name: null });
const messageUpdateNoUser = (id, text) => ({
  update_id: 1,
  message: { message_id: 10, from: fromNoUser(id), chat: { id }, text }
});
const callbackUpdateNoUser = (id, data) => ({
  update_id: 2,
  callback_query: { id: 'cb-' + data, from: fromNoUser(id), data, message: { message_id: 11, chat: { id } } }
});

const baseEnv = (fake = createFakeD1(), extra = {}) => ({
  BOT_TOKEN: 'test',
  ADMIN_ID: String(ADMIN),
  WEBHOOK_SECRET: 's3cret',
  ENVIRONMENT: 'development',
  LEAD_RATE_LIMIT_SEC: '300',
  LOGO_MAX_KB: '200',
  DB: fake.DB,
  _db: fake._db,
  ...extra
});

const say = (env, id, text, extra) => handleUpdate(env, messageUpdate(id, text, extra));
const tap = (env, id, data) => handleUpdate(env, callbackUpdate(id, data));

/* ============================================================
   1. Утилиты
   ============================================================ */
console.log('\n1. Экранирование, валидация, утилиты');
ok(esc('<b>Team & "Co"</b>') === '&lt;b&gt;Team &amp; &quot;Co&quot;&lt;/b&gt;', 'esc экранирует HTML');
ok(truncate('abcdef', 4) === 'abc…', 'truncate обрезает с многоточием');
ok(isNick('Yatoro') && isNick('Мираж_7') && !isNick('a') && !isNick('<script>'), 'валидация ников');
ok(isTeamName('Team Spirit') && isTeamName('Вихрь') && !isTeamName('X') && !isTeamName('Team<script>'), 'валидация названий команд');
ok(isNick('a'.repeat(30)) && !isNick('a'.repeat(31)), 'ник: ровно 30 символов — граница');
ok(isTeamName('a'.repeat(30)) && !isTeamName('a'.repeat(31)), 'название: ровно 30 символов — граница');
ok(slug('Compass Arena Season 2') === 'compass-arena-season-2', 'slug для имени файла');
ok(plural(3, 'заявка', 'заявки', 'заявок') === 'заявки' && plural(5, 'заявка', 'заявки', 'заявок') === 'заявок', 'русская плюрализация');
ok(bytesToBase64(new Uint8Array([72, 105])) === 'SGk=', 'base64 из байтов');
ok(/^\d{4}-\d{2}-\d{2}$/.test(dateStamp()), 'дата в имени файла');

/* ============================================================
   2. Клавиатуры и предметная область
   ============================================================ */
console.log('\n2. Клавиатуры и предметная область');
const kb = inlineKeyboard([[{ text: 'Dota 2', data: 'reg:disc:dota2' }], [{ text: 'Сайт', url: 'https://compassarena.ru' }]]);
ok(kb.inline_keyboard[0][0].callback_data === 'reg:disc:dota2', 'callback_data собирается');
ok(kb.inline_keyboard[1][0].url === 'https://compassarena.ru', 'url-кнопка собирается');
ok(inlineKeyboard([[{ text: 'x', data: 'a'.repeat(100) }]]).inline_keyboard[0][0].callback_data.length === 64, 'callback_data обрезается до 64 байт');
ok(DISCIPLINE_KEYS.join(',') === 'dota2,csgo', 'две дисциплины');
ok(roleNum('csgo', 'AWP') === 2 && roleLabel('csgo', 'AWP') === 'AWPer', 'роль CS:GO → номер и подпись');
ok(roleTitle('csgo', 'IGL') === 'IGL — Капитан', 'полная подпись роли');
ok(roleLabel('dota2', '4') === 'Саппорт 4' && roleNum('dota2', '4') === 4, 'роль Dota → 4');
ok(disciplineLabel('csgo') === 'CS:GO' && leadTypeLabel('free_agent') === 'Ищет команду', 'подписи дисциплин и типов');

/* ============================================================
   3. D1-помощники (in-memory замена)
   ============================================================ */
console.log('\n3. D1-помощники');
ok(parseJson('{"a":1}', {}).a === 1 && parseJson('сломано', { fallback: true }).fallback === true, 'parseJson устойчив к мусору');
ok(sqliteTimeToDate('2026-10-07 15:30:00') instanceof Date, 'время SQLite → Date');
{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  const id = await createLead(env, { telegramId: USER, type: 'team', discipline: 'dota2', payload: { name: 'Spirit' } });
  ok(id === 1 && fake._db.leads.length === 1, 'createLead возвращает id и пишет строку');
  ok(fake._db.lastLead().payload.name === 'Spirit' && fake._db.lastLead().status === 'pending', 'payload сохраняется как JSON, статус pending');
  ok((await findPendingTeamByName(env, USER, 'Spirit')) !== null, 'поиск pending-заявки по названию (json_extract)');
  ok((await findPendingTeamByName(env, USER, 'Другая')) === null, 'другое название не находится');
  ok((await findPendingTeamByName(env, USER2, 'Spirit')) === null, 'чужая заявка не находится');

  await setState(env, USER, 'team_name', { name: 'Spirit' });
  const state = await getState(env, USER);
  ok(state.step === 'team_name' && state.temp.name === 'Spirit', 'состояние читается и пишется');
  await resetState(env, USER);
  ok((await getState(env, USER)).step === null, 'состояние сбрасывается');
  const counts = await countLeads(env);
  ok(counts.pending === 1 && counts.approved === 0, 'счётчики по статусам');
}
{
  const fresh = createFakeD1();
  const env = baseEnv(fresh);
  fresh._db.addLead({ telegramId: USER, type: 'team', discipline: 'dota2', payload: { name: 'X' } });
  const verdict = await canSubmitLead(env, USER);
  ok(verdict.allowed === false && verdict.retryAfterSec > 200, 'rate limit: свежая заявка блокируется', verdict.retryAfterSec);

  const old = createFakeD1();
  const envOld = baseEnv(old);
  old._db.addLead({ telegramId: USER, type: 'team', discipline: 'dota2', payload: { name: 'X' }, createdAt: '2020-01-01 00:00:00' });
  ok((await canSubmitLead(envOld, USER)).allowed === true, 'rate limit: старая заявка не мешает');
  ok((await canSubmitLead(env, USER2)).allowed === true, 'rate limit: другой пользователь не затронут');
}
{
  const env = baseEnv(createFakeD1(), { ADMIN_ID: '111,222' });
  ok((await isAdmin(env, 222)) === true && (await isAdmin(env, 333)) === false, 'ADMIN_ID со списком id');
}

/* ============================================================
   4. Логотип: выбор размера из Telegram
   ============================================================ */
console.log('\n4. Логотип: выбор размера из Telegram');
{
  mockTelegram({
    getFile: async (body) => {
      const sizes = { small: 90 * 1024, middle: 180 * 1024, big: 400 * 1024 };
      return { file_id: body.file_id, file_size: sizes[body.file_id], file_path: `${body.file_id}.jpg` };
    }
  });
  const photo = await getPhotoDataUrl({ BOT_TOKEN: 'test' }, [
    { file_id: 'big', width: 1280 },
    { file_id: 'middle', width: 800 },
    { file_id: 'small', width: 320 }
  ], 200 * 1024);
  ok(photo && photo.oversized === false && photo.width === 800, 'выбран максимальный размер в пределах лимита', photo && photo.width);
  ok(photo.dataUrl.startsWith('data:image/jpeg;base64,'), 'логотип отдаётся как data:URL JPEG');
}
{
  mockTelegram({
    getFile: async (body) => {
      const sizes = { huge: 900 * 1024, tiny: 240 * 1024 };
      return { file_id: body.file_id, file_size: sizes[body.file_id], file_path: `${body.file_id}.png` };
    }
  });
  const heavy = await getPhotoDataUrl({ BOT_TOKEN: 'test' }, [
    { file_id: 'huge', width: 1280 },
    { file_id: 'tiny', width: 160 }
  ], 200 * 1024);
  ok(heavy && heavy.oversized === true && heavy.width === 160, 'если всё больше лимита — берём самый лёгкий и помечаем oversized');
}

/* ============================================================
   5. Роутер: команды, права, кнопки
   ============================================================ */
console.log('\n5. Роутер бота (команды, права, кнопки)');
{
  const env = baseEnv();
  mockTelegram();
  await say(env, USER, '/start');
  const text = last();
  ok(/Compass Arena — регистрация/.test(text), '/start присылает экран регистрации');
  const markup = JSON.stringify(messages()[0].body.reply_markup);
  ok(markup.includes('reg:disc:dota2') && markup.includes('reg:disc:csgo'), '/start показывает кнопки дисциплин (reg:disc:*)');
}
{
  const env = baseEnv();
  mockTelegram();
  await say(env, ADMIN, '/help');
  ok(/Как проходит регистрация/.test(last()) && /\/leads/.test(last()) && /\/export/.test(last()), '/help для админа со всеми командами');
  mockTelegram();
  await say(env, USER, '/help');
  ok(!/\/leads/.test(last()), '/help для игрока без админ-команд');
}
{
  const env = baseEnv();
  mockTelegram();
  await say(env, USER, '/cancel');
  ok(/Регистрация отменена/.test(last()), '/cancel сообщает об отмене и показывает меню');
}
{
  const env = baseEnv(createFakeD1());
  mockTelegram();
  await say(env, USER, '/чепуха');
  ok(/не поддерживается/.test(last()), 'неизвестная команда обрабатывается вежливо');
}

/* ---------- /leads: права и счётчики ---------- */
{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  fake._db.addLead({ telegramId: USER, type: 'team', discipline: 'dota2', payload: { name: 'A' } });
  fake._db.addLead({ telegramId: USER, type: 'team', discipline: 'dota2', payload: { name: 'B' }, status: 'approved' });
  fake._db.addLead({ telegramId: USER2, type: 'free_agent', discipline: 'csgo', payload: { nick: 'x' }, status: 'rejected' });

  mockTelegram();
  await say(env, USER, '/leads');
  ok(/только организаторам/.test(last()), '/leads запрещён не-админу');

  mockTelegram();
  await say(env, ADMIN, '/leads');
  const text = last();
  ok(/На модерации: <b>1<\/b>/.test(text), '/leads читает счётчики из D1');
  ok(/Одобрено: <b>1<\/b>/.test(text) && /Отклонено: <b>1<\/b>/.test(text), '/leads показывает одобренные и отклонённые');
  ok(/Dota 2 · Команда: <b>1<\/b>/.test(text), '/leads показывает разбивку ожидающих');
}
{
  const env = baseEnv();
  mockTelegram();
  await say(env, ADMIN, '/export');
  ok(/Экспорт для сайта/.test(last()), '/export отвечает админу');
  mockTelegram();
  await say(env, USER, '/export');
  ok(/только организаторам/.test(last()), '/export запрещён не-админу');
}

/* ============================================================
   6. Ветка A: регистрация команды
   ============================================================ */
console.log('\n6. Регистрация команды (ветка A)');

const DOTA_PLAYERS = [['Yatoro', '1'], ['Larl', '2'], ['Collapse', '3'], ['Mira', '4'], ['Miposhka', '5']];

/** Полный проход ветки A (без логотипа) */
async function registerTeam(env, userId, name, players = DOTA_PLAYERS) {
  await say(env, userId, '/start');
  await tap(env, userId, 'reg:disc:dota2');
  await tap(env, userId, 'reg:type:team');
  await say(env, userId, name);
  await say(env, userId, '/skip');
  for (const [nick, role] of players) {
    await say(env, userId, nick);
    await tap(env, userId, 'reg:role:' + role);
  }
}

{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();

  await registerTeam(env, USER, 'Team Spirit');
  ok(/Team Spirit/.test(lastTo(USER)) && /reg:confirm/.test(markupSince(0)), 'финальная проверка показывает карточку');
  ok(/Miposhka<\/b> — Саппорт 5/.test(lastTo(USER)), 'в карточке пятый игрок с ролью');
  ok(/1\. <b>Yatoro<\/b> — Керри/.test(lastTo(USER)), 'в карточке первый игрок с ролью');
  ok(/Логотип: — не загружен/.test(lastTo(USER)), 'в карточке отмечено отсутствие логотипа');

  await tap(env, USER, 'reg:confirm');
  ok(/отправлена на модерацию/.test(lastTo(USER)), 'заявка отправлена на модерацию');

  const lead = fake._db.lastLead();
  ok(lead.type === 'team' && lead.discipline === 'dota2' && lead.status === 'pending', 'заявка записана с типом, дисциплиной и статусом');
  ok(lead.payload.players.length === 5, 'в payload пять игроков');
  ok(lead.payload.players[0].nick === 'Yatoro' && lead.payload.players[0].role === 1 && lead.payload.players[0].roleLabel === 'Керри', 'первый игрок: ник, номер роли и подпись');
  ok(lead.payload.players[4].roleLabel === 'Саппорт 5' && lead.payload.players[4].role === 5, 'пятый игрок с ролью 5');
  ok(lead.payload.captainTelegramId === USER && lead.payload.captainNick === '@tester', 'капитан — отправитель заявки');
  ok(lead.payload.logo === '' && lead.payload.logoOversized === false, 'без логотипа: пустая строка и флаг false');
  ok(fake._db.state(USER) === null, 'состояние пользователя сброшено');
  ok(calls.some((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(ADMIN) && /Новая заявка на команду/.test(call.body.text)), 'админ получил уведомление');
}

/* ---------- Валидация на шагах ---------- */
{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();

  await say(env, USER, '/start');
  await tap(env, USER, 'reg:disc:dota2');
  await tap(env, USER, 'reg:type:team');
  ok(/Шаг 1 из 7/.test(last()) && /Отмена: \/cancel/.test(last()), 'шаг 1: прогресс и напоминание об отмене');

  let mark = marker();
  await say(env, USER, 'X');
  ok(/Название от 2 до 30 символов/.test(textsSince(mark)), 'короткое название отклонено с понятной ошибкой');
  ok(fake._db.state(USER).step === 'team_name', 'после ошибки шаг не сброшен');

  await say(env, USER, 'Team Spirit');
  await say(env, USER, '/skip');
  ok(/Шаг 3 из 7/.test(last()) && /Ник игрока 1/.test(last()), 'шаг 3: запрос ника первого игрока');

  await say(env, USER, 'Yatoro');
  ok(/Шаг 3 из 7/.test(last()) && /Выбери его роль/.test(last()), 'после ника — выбор роли');

  mark = marker();
  await tap(env, USER, 'reg:role:1');
  await say(env, USER, 'Yatoro');
  ok(/3 из 7/.test(last()) || /Ник игрока/.test(last()), 'подсказка на шаге ника второго игрока');

  mark = marker();
  await say(env, USER, '  ');
  ok(/Ник от 2 до 30 символов/.test(textsSince(mark)), 'пустой ник отклонён');

  mark = marker();
  await say(env, USER, 'yatoro');
  ok(/Такой ник уже есть в команде/.test(textsSince(mark)), 'дубликат ника в команде отклонён (без учёта регистра)');
  ok(fake._db.state(USER).temp.players.length === 1, 'прогресс команды сохранён после ошибок');
}

/* ---------- Логотип: oversized, принять, прислать другое ---------- */
{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram({
    getFile: async (body) => ({ file_id: body.file_id, file_size: 500 * 1024, file_path: body.file_id + '.jpg' })
  });

  await say(env, USER, '/start');
  await tap(env, USER, 'reg:disc:dota2');
  await tap(env, USER, 'reg:type:team');
  await say(env, USER, 'Team Spirit');

  let mark = marker();
  await handleUpdate(env, photoUpdate(USER, [{ file_id: 'big', width: 1280 }]));
  const oversizedText = textsSince(mark);
  ok(/больше лимита/.test(oversizedText) && /reg:logo:accept/.test(markupSince(mark)), 'большое фото: предложение принять как есть');
  ok(fake._db.state(USER).temp.logoOversized === true, 'флаг oversized записан в состояние');

  // «Прислать другое» — логотип очищается, остаёмся на шаге
  await tap(env, USER, 'reg:logo:retry');
  ok(fake._db.state(USER).temp.logo === '' && fake._db.state(USER).step === 'team_logo', '«прислать другое» очищает логотип и оставляет шаг');

  // «Принять как есть» — идём дальше
  await handleUpdate(env, photoUpdate(USER, [{ file_id: 'big', width: 1280 }]));
  await tap(env, USER, 'reg:logo:accept');
  ok(/Шаг 3 из 7/.test(last()), 'после принятия логотипа — шаг с игроком 1');
  ok(fake._db.state(USER).temp.logoOversized === true && fake._db.state(USER).temp.logo.startsWith('data:image/'), 'логотип сохранён с флагом oversized');
}

/* ---------- Кнопка «Без логотипа» ---------- */
{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();
  await say(env, USER, '/start');
  await tap(env, USER, 'reg:disc:dota2');
  await tap(env, USER, 'reg:type:team');
  await say(env, USER, 'Team Spirit');
  await tap(env, USER, 'reg:logo:skip');
  ok(/Шаг 3 из 7/.test(last()), 'кнопка «без логотипа» переводит к игрокам');
}

/* ---------- Меню правок ---------- */
{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();
  await registerTeam(env, USER, 'Team Spirit');

  let markMenu = marker();
  await tap(env, USER, 'reg:edit');
  ok(/Что изменить/.test(lastTo(USER)), 'меню правок открывается');
  ok(/3\. <b>Collapse<\/b>/.test(lastTo(USER)) && /Игрок 3: Collapse/.test(markupSince(markMenu)), 'в меню перечислены игроки');

  await tap(env, USER, 'reg:edit:player:3');
  ok(/Игрок 3/.test(lastTo(USER)) && /Введи новый ник/.test(lastTo(USER)), 'правка игрока 3: запрос нового ника');

  await say(env, USER, 'CollapseX');
  ok(/выбери роль/i.test(lastTo(USER)), 'после нового ника снова спрашиваем роль');
  let markRole = marker();
  await tap(env, USER, 'reg:role:3');
  ok(/CollapseX/.test(lastTo(USER)) && /reg:confirm/.test(markupSince(markRole)), 'вернулись к проверке с новым ником');
  ok(fake._db.state(USER).temp.players[2].nick === 'CollapseX', 'новый ник в состоянии');

  await tap(env, USER, 'reg:edit:name');
  await say(env, USER, 'Spirit Two');
  ok(/Название изменено/.test(last()) && /Spirit Two/.test(last()), 'название изменено, карточка обновлена');

  await tap(env, USER, 'reg:edit');
  await tap(env, USER, 'reg:back');
  ok(/Проверка заявки|Что изменить/.test(last()), 'кнопка «назад» возвращает к проверке');

  await tap(env, USER, 'reg:confirm');
  ok(fake._db.lastLead().payload.name === 'Spirit Two', 'в заявку ушло изменённое название');
  ok(fake._db.lastLead().payload.players[2].nick === 'CollapseX', 'в заявку ушёл изменённый состав');
}

/* ---------- Дубликат и rate limit ---------- */
{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();
  await registerTeam(env, USER, 'Team Spirit');
  await tap(env, USER, 'reg:confirm');
  ok(fake._db.leads.length === 1, 'первая заявка создана');

  // повторная заявка с тем же названием — ловим дубликат
  await registerTeam(env, USER, 'Team Spirit');
  let mark = marker();
  await tap(env, USER, 'reg:confirm');
  ok(/У тебя уже есть заявка на команду/.test(textsSince(mark)), 'дубликат по названию отклонён');
  ok(fake._db.leads.length === 1, 'вторая заявка не создана');

  // другое название — срабатывает rate limit
  await registerTeam(env, USER2, 'Team Spirit');
  await tap(env, USER2, 'reg:confirm');
  ok(fake._db.leads.length === 2, 'заявка другого пользователя создана');

  await registerTeam(env, USER2, 'Другая команда');
  mark = marker();
  await tap(env, USER2, 'reg:confirm');
  ok(/не чаще одной в 5 минут/.test(textsSince(mark)), 'rate limit срабатывает на второй заявке');
  ok(fake._db.leads.length === 2, 'заявка сверх лимита не создана');
}

/* ============================================================
   6b. Капитан без @username — дополнительный шаг ветки A
   ============================================================ */
console.log('\n6b. Ветка A: ник капитана, когда у отправителя нет @username');
{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();
  const NEWBIE = 444;

  await handleUpdate(env, messageUpdateNoUser(NEWBIE, '/start'));
  await handleUpdate(env, callbackUpdateNoUser(NEWBIE, 'reg:disc:dota2'));
  await handleUpdate(env, callbackUpdateNoUser(NEWBIE, 'reg:type:team'));
  ok(/Шаг 1 из 8/.test(lastTo(NEWBIE)), 'без @username ветка длиннее: шаг 1 из 8', lastTo(NEWBIE).slice(0, 50));

  await handleUpdate(env, messageUpdateNoUser(NEWBIE, 'Team Spirit'));
  ok(/Шаг 2 из 8/.test(lastTo(NEWBIE)), 'шаг 2 из 8 — логотип');
  await handleUpdate(env, messageUpdateNoUser(NEWBIE, '/skip'));
  ok(/Твой ник как капитана команды/.test(lastTo(NEWBIE)) && /Шаг 3 из 8/.test(lastTo(NEWBIE)),
    'после логотипа спрашиваем ник капитана', lastTo(NEWBIE).slice(0, 70));

  let mark = marker();
  await handleUpdate(env, messageUpdateNoUser(NEWBIE, 'X'));
  ok(/Ник от 2 до 30 символов/.test(textsSince(mark)), 'короткий ник капитана отклонён');
  ok(fake._db.state(NEWBIE).step === 'team_captain', 'после ошибки шаг капитана сохранён');

  await handleUpdate(env, messageUpdateNoUser(NEWBIE, 'Capitan'));
  ok(/Шаг 4 из 8/.test(lastTo(NEWBIE)) && /Ник игрока 1/.test(lastTo(NEWBIE)), 'после капитана — игрок 1 (шаг 4 из 8)');

  for (const [nick, role] of DOTA_PLAYERS) {
    await handleUpdate(env, messageUpdateNoUser(NEWBIE, nick));
    await handleUpdate(env, callbackUpdateNoUser(NEWBIE, 'reg:role:' + role));
  }
  ok(/Капитан: <b>Capitan<\/b>/.test(lastTo(NEWBIE)), 'капитан показан в карточке проверки');
  await handleUpdate(env, callbackUpdateNoUser(NEWBIE, 'reg:confirm'));
  ok(fake._db.lastLead().payload.captainNick === 'Capitan', 'ник капитана попал в заявку');
  ok(fake._db.lastLead().payload.players[0].nick === 'Yatoro', 'первый игрок остался собой');
}
{
  // нет @username, но ник капитана пропущен → капитаном будет игрок 1
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();
  const NEWBIE = 445;

  await handleUpdate(env, messageUpdateNoUser(NEWBIE, '/start'));
  await handleUpdate(env, callbackUpdateNoUser(NEWBIE, 'reg:disc:dota2'));
  await handleUpdate(env, callbackUpdateNoUser(NEWBIE, 'reg:type:team'));
  await handleUpdate(env, messageUpdateNoUser(NEWBIE, 'Team Spirit'));
  await handleUpdate(env, messageUpdateNoUser(NEWBIE, '/skip'));
  await handleUpdate(env, callbackUpdateNoUser(NEWBIE, 'reg:skip:captain'));
  ok(/Шаг 4 из 8/.test(lastTo(NEWBIE)), 'кнопка «взять ник игрока 1» ведёт к игрокам');

  for (const [nick, role] of DOTA_PLAYERS) {
    await handleUpdate(env, messageUpdateNoUser(NEWBIE, nick));
    await handleUpdate(env, callbackUpdateNoUser(NEWBIE, 'reg:role:' + role));
  }
  await handleUpdate(env, callbackUpdateNoUser(NEWBIE, 'reg:confirm'));
  ok(fake._db.lastLead().payload.captainNick === 'Yatoro', 'без ответа капитаном стал игрок 1');
}
{
  // с @username вопроса про капитана нет
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();
  await say(env, USER, '/start');
  await tap(env, USER, 'reg:disc:dota2');
  await tap(env, USER, 'reg:type:team');
  await say(env, USER, 'Team Spirit');
  await say(env, USER, '/skip');
  ok(/Шаг 3 из 7/.test(lastTo(USER)), 'с @username шага капитана нет (шаг 3 из 7)');
}

/* ============================================================
   7. Ветка B: свободный агент
   ============================================================ */
console.log('\n7. Поиск команды (ветка B)');
{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();

  await say(env, USER, '/start');
  await tap(env, USER, 'reg:disc:csgo');
  await tap(env, USER, 'reg:type:looking');
  ok(/Шаг 1 из 4/.test(last()) && /Как тебя зовут в игре/.test(last()), 'ветка B: шаг 1 — ник');

  await say(env, USER, 's1mple');
  ok(/Шаг 2 из 4/.test(last()) && /На какой позиции/.test(last()), 'ветка B: шаг 2 — позиция');

  await tap(env, USER, 'reg:role:AWP');
  ok(/Шаг 3 из 4/.test(last()) && /Какой у тебя ранг/.test(last()), 'ветка B: шаг 3 — ранг');

  await say(env, USER, 'Premier 21 000');
  ok(/Шаг 4 из 4/.test(last()) && /Пара слов о себе/.test(last()), 'ветка B: шаг 4 — описание');

  await say(env, USER, 'Играю на AWP, свободен по вечерам');
  ok(/Заявка принята/.test(lastTo(USER)), 'ветка B: заявка принята');

  const lead = fake._db.lastLead();
  ok(lead.type === 'free_agent' && lead.discipline === 'csgo', 'тип free_agent и дисциплина csgo');
  ok(lead.payload.type === 'looking_for_team' && lead.payload.role === 2 && lead.payload.roleLabel === 'AWPer', 'payload свободного агента');
  ok(lead.payload.rank === 'Premier 21 000' && /AWP/.test(lead.payload.note), 'ранг и описание сохранены');
  ok(fake._db.state(USER) === null, 'состояние сброшено');
}
{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();

  await say(env, USER, '/start');
  await tap(env, USER, 'reg:disc:dota2');
  await tap(env, USER, 'reg:type:looking');
  await say(env, USER, 'solo');
  await tap(env, USER, 'reg:role:3');
  await tap(env, USER, 'reg:skip:rank');
  ok(/Шаг 4 из 4/.test(last()), 'кнопка «без ранга» ведёт к описанию');
  await tap(env, USER, 'reg:skip:note');
  const lead = fake._db.lastLead();
  ok(lead.payload.rank === '' && lead.payload.note === '', 'пропущенные ранг и описание — пустые строки');
}
{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();
  await say(env, USER, '/start');
  await tap(env, USER, 'reg:disc:dota2');
  await tap(env, USER, 'reg:type:looking');
  await say(env, USER, 'x');
  ok(/Ник от 2 до 30 символов/.test(textsSince(0)), 'ветка B: короткий ник отклонён');
}

/* ============================================================
   8. Ветка C: заявка игрока
   ============================================================ */
console.log('\n8. Заявка игрока (ветка C)');
{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();

  await say(env, USER, '/start');
  await tap(env, USER, 'reg:disc:dota2');
  await tap(env, USER, 'reg:type:player');
  ok(/Шаг 1 из 3/.test(last()) && /Твой ник/.test(last()), 'ветка C: шаг 1 — ник');

  await say(env, USER, 'Nightfall');
  ok(/Шаг 2 из 3/.test(last()) && /В какой команде играешь/.test(last()), 'ветка C: шаг 2 — команда');

  await say(env, USER, 'Virtus.pro');
  ok(/Шаг 3 из 3/.test(last()) && /Твоя позиция/.test(last()), 'ветка C: шаг 3 — позиция');

  await tap(env, USER, 'reg:role:1');
  ok(/Заявка принята/.test(lastTo(USER)), 'ветка C: заявка принята');

  const lead = fake._db.lastLead();
  ok(lead.type === 'player' && lead.discipline === 'dota2', 'тип player и дисциплина dota2');
  ok(lead.payload.type === 'player' && lead.payload.nick === 'Nightfall', 'payload игрока: ник');
  ok(lead.payload.teamName === 'Virtus.pro' && lead.payload.role === 1 && lead.payload.roleLabel === 'Керри', 'payload игрока: команда и роль');
}
{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();
  await say(env, USER, '/start');
  await tap(env, USER, 'reg:disc:dota2');
  await tap(env, USER, 'reg:type:player');
  await say(env, USER, 'Solo');
  await tap(env, USER, 'reg:skip:team');
  ok(/Шаг 3 из 3/.test(last()), 'кнопка «без команды» ведёт к позиции');
  await tap(env, USER, 'reg:role:5');
  ok(fake._db.lastLead().payload.teamName === null, 'без команды: teamName = null');
}

/* ============================================================
   9. /cancel, /skip и защита от «мёртвых» кнопок
   ============================================================ */
console.log('\n9. Отмена, /skip и устаревшие кнопки');
{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();

  await say(env, USER, '/start');
  await tap(env, USER, 'reg:disc:dota2');
  await tap(env, USER, 'reg:type:team');
  await say(env, USER, 'Team Spirit');
  await say(env, USER, '/cancel');
  ok(/Регистрация отменена/.test(last()), '/cancel посреди ветки отменяет регистрацию');
  ok(fake._db.state(USER) === null, '/cancel очищает состояние');

  await say(env, USER, '/skip');
  ok(/нечего пропускать/.test(last()), '/skip без активного шага отвечает понятно');

  await say(env, USER, '/start');
  await tap(env, USER, 'reg:disc:dota2');
  await tap(env, USER, 'reg:type:team');
  await say(env, USER, 'Team Spirit');
  await say(env, USER, '/skip');
  await say(env, USER, 'Yatoro');
  await tap(env, USER, 'reg:role:1');
  await say(env, USER, 'Larl');
  await tap(env, USER, 'reg:role:2');
  await say(env, USER, 'Collapse');
  await tap(env, USER, 'reg:role:3');
  await say(env, USER, 'Mira');
  await tap(env, USER, 'reg:role:4');
  await say(env, USER, 'Miposhka');
  await tap(env, USER, 'reg:role:5');

  // на шаге подтверждения текст не принимается, но прогресс не теряется
  let mark = marker();
  const stateBefore = fake._db.state(USER);
  await say(env, USER, 'что-то не то');
  ok(/нужно нажать кнопку/.test(textsSince(mark)), 'на кнопочном шаге текст получает подсказку',
    stateBefore && stateBefore.step);
  ok(fake._db.state(USER) && fake._db.state(USER).step === 'team_confirm', 'шаг подтверждения сохранён');

  // приветствие посреди диалога не должно сбрасывать прогресс
  mark = marker();
  await say(env, USER, 'привет');
  ok(/середине регистрации/.test(textsSince(mark)), 'приветствие посреди диалога не сбрасывает прогресс');
  ok(fake._db.state(USER) && fake._db.state(USER).step === 'team_confirm', 'прогресс сохранён после приветствия');

  // устаревшая кнопка роли после подтверждения
  mark = marker();
  await tap(env, USER, 'reg:role:2');
  ok(/устарела|начни заново/i.test(textsSince(mark) + answers().map((a) => a.body.text).join(' ')), 'устаревшая кнопка роли не ломает сценарий');

  // /skip на неподходящем шаге
  mark = marker();
  await say(env, USER, '/skip');
  ok(/не нужен/.test(textsSince(mark)), '/skip на неподходящем шаге отвечает понятно');
}
{
  // /start сбрасывает незавершённую регистрацию
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();
  await say(env, USER, '/start');
  await tap(env, USER, 'reg:disc:dota2');
  await tap(env, USER, 'reg:type:team');
  await say(env, USER, 'Team Spirit');
  await say(env, USER, '/start');
  ok(fake._db.state(USER) === null, '/start сбрасывает незавершённый диалог');
}

/* ============================================================
   10. Модерация заявок
   ============================================================ */
console.log('\n10. Модерация: /leads, approve, reject, skip');

const DOTA_ROLE_LABELS = ['Керри', 'Мидер', 'Офлейн', 'Саппорт 4', 'Саппорт 5'];
const teamPayload = (name) => ({
  name,
  logo: '',
  logoOversized: false,
  captainNick: '@tester',
  captainTelegramId: USER,
  players: DOTA_PLAYERS.map(([nick], index) => ({ nick, role: index + 1, roleLabel: DOTA_ROLE_LABELS[index] }))
});

{
  const fake = createFakeD1();
  const env = baseEnv(fake);

  // автор заявки пишет боту — чтобы в карточке был @username
  mockTelegram();
  await say(env, USER, '/start');

  fake._db.addLead({ telegramId: USER, type: 'team', discipline: 'dota2', payload: teamPayload('Team Spirit') });
  fake._db.addLead({
    telegramId: USER2, type: 'free_agent', discipline: 'csgo',
    payload: { type: 'looking_for_team', nick: 's1mple', role: 2, roleLabel: 'AWPer', rank: 'Premier 21 000', note: 'Играю на AWP' }
  });

  /* --- меню --- */
  mockTelegram();
  await say(env, ADMIN, '/leads');
  const menu = lastTo(ADMIN);
  ok(/На модерации: <b>2<\/b>/.test(menu) && /Одобрено: <b>0<\/b>/.test(menu), 'меню модерации показывает счётчики');
  ok(/Dota 2 · Команда: <b>1<\/b>/.test(menu) && /CS:GO · Ищет команду: <b>1<\/b>/.test(menu), 'разбивка ожидающих по дисциплинам');
  ok(/mod:list:new/.test(markupSince(0)) && /mod:list:approved/.test(markupSince(0)), 'кнопки списков на месте');

  /* --- карточка первой заявки --- */
  let mark = marker();
  await tap(env, ADMIN, 'mod:list:new');
  const card = lastTo(ADMIN);
  ok(/Dota 2 · <b>Команда<\/b>/.test(card), 'карточка заявки: дисциплина и тип');
  ok(/Team Spirit/.test(card) && /Miposhka<\/b> — Саппорт 5/.test(card), 'в карточке название и состав', card.slice(0, 90));
  ok(/@tester/.test(card) && /\(222\)/.test(card), 'в карточке автор: @username и id');
  ok(/mod:approve:1/.test(markupSince(mark)) && /mod:reject:1/.test(markupSince(mark)) && /mod:skip:1/.test(markupSince(mark)),
    'кнопки одобрить/отклонить/пропустить');

  /* --- одобрение --- */
  await tap(env, ADMIN, 'mod:approve:1');
  ok(fake._db.leadById(1).status === 'approved', 'заявка одобрена');
  ok(fake._db.leadById(1).moderated_by === ADMIN && fake._db.leadById(1).moderated_at !== null, 'модератор и время записаны');
  ok(/одобрена/.test(lastTo(USER)) && /Team Spirit/.test(lastTo(USER)), 'автор получил уведомление об одобрении', lastTo(USER).slice(0, 70));
  ok(/#2|AWPer|s1mple/.test(lastTo(ADMIN)), 'админу сразу показали следующую заявку', lastTo(ADMIN).slice(0, 70));

  /* --- повторное одобрение --- */
  await tap(env, ADMIN, 'mod:approve:1');
  ok(lastAnswer() === 'Уже обработано', 'повторное одобрение → «Уже обработано»', lastAnswer());
  ok(fake._db.leadById(1).status === 'approved', 'статус не изменился');

  /* --- отклонение с причиной --- */
  mark = marker();
  await tap(env, ADMIN, 'mod:reject:2');
  ok(/Причина отклонения/.test(lastTo(ADMIN)), 'запрошена причина отклонения');
  ok(/mod:cancel:2/.test(markupSince(mark)) && /Отменить/.test(markupSince(mark)), 'есть кнопка «🚫 Отменить»', markupSince(mark).slice(0, 80));
  ok(fake._db.state(ADMIN) && fake._db.state(ADMIN).step === 'mod_reason', 'состояние ожидания причины сохранено');

  await say(env, ADMIN, 'Не подтвердил ранг');
  ok(fake._db.leadById(2).status === 'rejected', 'заявка отклонена');
  ok(fake._db.leadById(2).reject_reason === 'Не подтвердил ранг', 'причина записана в заявку');
  ok(/Причина: Не подтвердил ранг/.test(lastTo(USER2)), 'автор увидел причину', lastTo(USER2).replace(/\n/g, ' | ').slice(0, 80));
  ok(fake._db.state(ADMIN) === null, 'состояние модератора очищено');

  /* --- отклонение через /skip (без причины) --- */
  fake._db.addLead({
    telegramId: USER2, type: 'player', discipline: 'dota2',
    payload: { type: 'player', nick: 'Solo', teamName: null, role: 1, roleLabel: 'Керри' }
  });
  await tap(env, ADMIN, 'mod:reject:3');
  await say(env, ADMIN, '/skip');
  ok(fake._db.leadById(3).status === 'rejected' && fake._db.leadById(3).reject_reason === null, '/skip: отклонено без причины');
  ok(/не указана/.test(lastTo(USER2)), 'в уведомлении «не указана»', lastTo(USER2).replace(/\n/g, ' | '));

  /* --- /cancel в середине ввода причины --- */
  fake._db.addLead({ telegramId: USER, type: 'team', discipline: 'dota2', payload: teamPayload('Cancel Test') });
  await tap(env, ADMIN, 'mod:list:new');
  await tap(env, ADMIN, 'mod:reject:4');
  ok(fake._db.state(ADMIN).step === 'mod_reason', 'ожидание причины установлено');
  mark = marker();
  await say(env, ADMIN, '/cancel');
  ok(/Ввод причины отменён/.test(textsSince(mark)), '/cancel посреди причины не падает', textsSince(mark).slice(0, 60));
  ok(fake._db.state(ADMIN) === null, 'состояние очищено после /cancel');
  ok(fake._db.leadById(4).status === 'pending', 'заявка осталась на модерации');

  /* --- кнопка «Отменить» --- */
  mark = marker();
  await tap(env, ADMIN, 'mod:reject:4');
  await tap(env, ADMIN, 'mod:cancel:4');
  ok(fake._db.leadById(4).status === 'pending', 'кнопка «Отменить» не меняет статус');
  ok(/не изменена/.test(lastTo(ADMIN)), 'карточка вернулась с пометкой', lastTo(ADMIN).slice(0, 60));

  /* --- пропустить --- */
  fake._db.addLead({ telegramId: USER, type: 'team', discipline: 'dota2', payload: teamPayload('Skip Me') });
  await tap(env, ADMIN, 'mod:skip:4');
  ok(fake._db.leadById(4).status === 'pending', 'пропуск не меняет статус');
  ok(/Skip Me/.test(lastTo(ADMIN)), 'после пропуска показана следующая заявка', lastTo(ADMIN).slice(0, 60));

  /* --- ошибочные ID --- */
  await tap(env, ADMIN, 'mod:approve:abc');
  ok(lastAnswer() === 'Неверный ID заявки', 'нечисловой ID → «Неверный ID заявки»', lastAnswer());
  await tap(env, ADMIN, 'mod:reject:abc');
  ok(lastAnswer() === 'Неверный ID заявки', 'нечисловой ID в reject тоже обработан', lastAnswer());
  await tap(env, ADMIN, 'mod:approve:999');
  ok(lastAnswer() === 'Заявка не найдена', 'несуществующая заявка → «Заявка не найдена»', lastAnswer());
  mark = marker();
  await tap(env, ADMIN, 'mod:view:abc');
  ok(lastAnswer() === 'Неверный ID заявки', 'нечисловой ID во view обработан', lastAnswer());
  ok(fake._db.leads.length === 5, 'набор заявок не пострадал');

  /* --- права --- */
  await tap(env, USER, 'mod:approve:4');
  ok(lastAnswer() === 'Недостаточно прав', 'не-админ не может модерировать', lastAnswer());
  ok(fake._db.leadById(4).status === 'pending', 'статус не изменился после попытки не-админа');

  /* --- карточка с логотипом уходит фотографией --- */
  fake._db.addLead({
    telegramId: USER, type: 'team', discipline: 'dota2',
    payload: { ...teamPayload('With Logo'), logo: 'data:image/jpeg;base64,AAAA', logoOversized: true }
  });
  mockTelegram();
  await tap(env, ADMIN, 'mod:view:6');
  ok(calls.some((call) => call.method === 'sendPhoto'), 'карточка с логотипом отправляется фотографией');
  ok(/больше лимита/.test(lastTo(ADMIN)) || /больше лимита/.test(JSON.stringify(calls.map((c) => c.body))), 'пометка oversized видна модератору');

  /* --- список одобренных --- */
  mockTelegram();
  await tap(env, ADMIN, 'mod:list:approved');
  ok(/Одобренные заявки/.test(lastTo(ADMIN)) && /#1/.test(lastTo(ADMIN)), 'список одобренных показывает заявки');
  await tap(env, ADMIN, 'mod:list:rejected');
  ok(/Отклонённые заявки/.test(lastTo(ADMIN)) && /причина:/.test(lastTo(ADMIN)), 'в списке отклонённых видна причина');
}
{
  // пустая база: новых заявок нет
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();
  await say(env, ADMIN, '/leads');
  await tap(env, ADMIN, 'mod:list:new');
  ok(/Новых заявок нет/.test(lastTo(ADMIN)), 'пустая очередь модерации сообщает об этом');
}

/* ============================================================
   10b. Модерация: предупреждение о дубликате команды
   ============================================================ */
console.log('\n10b. Модерация: дубликат названия команды');
{
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();

  fake._db.addLead({ telegramId: USER, type: 'team', discipline: 'dota2', payload: teamPayload('Team Spirit') });
  fake._db.addLead({ telegramId: USER2, type: 'team', discipline: 'dota2', payload: teamPayload('Team Spirit') });

  // первая заявка одобряется без предупреждений
  await tap(env, ADMIN, 'mod:approve:1');
  ok(fake._db.leadById(1).status === 'approved', 'первая команда одобрена без предупреждения');

  // вторая заявка с тем же названием — предупреждение вместо запрета
  let mark = marker();
  await tap(env, ADMIN, 'mod:approve:2');
  ok(fake._db.leadById(2).status === 'pending', 'до подтверждения вторая заявка остаётся pending');
  ok(/уже одобрена ранее/.test(lastTo(ADMIN)) && /#1/.test(lastTo(ADMIN)) && /Dota 2/.test(lastTo(ADMIN)),
    'показано предупреждение с номером предыдущей заявки', lastTo(ADMIN).replace(/\n/g, ' | ').slice(0, 110));
  ok(/mod:approve:2:dup/.test(markupSince(mark)), 'есть кнопка «Да, одобрить как дубликат»');
  ok(/mod:cancel:2/.test(markupSince(mark)), 'есть кнопка отмены');

  // отмена — статус не меняется
  await tap(env, ADMIN, 'mod:cancel:2');
  ok(fake._db.leadById(2).status === 'pending', 'после отмены заявка не одобрена');

  // подтверждение дубликата — проходит
  mark = marker();
  await tap(env, ADMIN, 'mod:approve:2:dup');
  ok(fake._db.leadById(2).status === 'approved', 'подтверждённый дубликат одобрен');
  ok(/одобрена/.test(lastTo(USER2)), 'автор дубликата получил уведомление');
  ok(!calls.slice(mark).some((call) => call.method === 'sendMessage' && /уже одобрена ранее/.test(String(call.body.text || ''))),
    'повторного предупреждения нет');

  // другая дисциплина с тем же названием — это не дубликат
  fake._db.addLead({ telegramId: 777, type: 'team', discipline: 'csgo', payload: teamPayload('Team Spirit') });
  await tap(env, ADMIN, 'mod:approve:3');
  ok(fake._db.leadById(3).status === 'approved', 'то же название в другой дисциплине — без предупреждения');
}

/* ============================================================
   11. Экспорт JSON для админки сайта
   ============================================================ */
console.log('\n11. Экспорт: /export и сборка файлов');

const teamLead = (id, telegramId, name, discipline) => ({
  id, telegram_id: telegramId, type: 'team', discipline, status: 'approved',
  payload: {
    name, logo: '', logoOversized: false, captainNick: '@cap', captainTelegramId: telegramId,
    players: [{ nick: 'P1', role: 1, roleLabel: 'Керри' }, { nick: 'P2', role: 2, roleLabel: 'Мидер' }]
  }
});
const agentLead = (id, telegramId, nick, discipline, type = 'looking_for_team') => ({
  id, telegram_id: telegramId, type: 'free_agent', discipline, status: 'approved',
  payload: type === 'looking_for_team'
    ? { type, nick, role: 3, roleLabel: 'Офлейн', rank: 'Divine 3', note: 'ищу состав' }
    : { type: 'player', nick, teamName: 'Some Team', role: 1, roleLabel: 'Керри' }
});

{
  // Чистые сборщики JSON: порядок, пустые списки, поля
  const { buildTeamsDocument, buildSettingsDocument } = await import('../src/handlers/export.js');
  const at = '2026-10-07T15:30:00.000Z';

  const teams = [teamLead(3, 333, 'Gamma', 'dota2'), teamLead(1, 111, 'Alpha', 'dota2'), teamLead(2, 222, 'Beta', 'dota2')];
  const doc = buildTeamsDocument({ discipline: 'dota2', teams, freeAgents: [], exportedAt: at });

  ok(doc.type === 'teams' && doc.version === 1 && doc.discipline === 'dota2', 'файл команд: тип, версия, дисциплина');
  ok(doc.exportedAt === at, 'exportedAt попадает в файл');
  ok(doc.teams.length === 3, 'в файле три команды');
  ok(doc.teams.map((t) => t.name).join(',') === 'Alpha,Beta,Gamma', 'команды отсортированы по возрастанию id заявки',
    doc.teams.map((t) => t.name).join(','));
  ok(doc.teams.map((t) => t.id).join(',') === 'team_1,team_2,team_3', 'id команд идут по порядку team_1…team_N',
    doc.teams.map((t) => t.id).join(','));
  ok(doc.teams.map((t) => t.num).join(',') === '1,2,3', 'числовое поле num заполнено по порядку');
  ok(doc.teams[0].players.length === 2 && doc.teams[0].players[1].roleLabel === 'Мидер', 'состав и роли в файле');
  ok(Array.isArray(doc.freeAgents) && doc.freeAgents.length === 0, 'без агентов freeAgents — пустой массив (не null)',
    doc.freeAgents);

  const empty = buildTeamsDocument({ discipline: 'csgo', teams: [], freeAgents: [], exportedAt: at });
  ok(Array.isArray(empty.teams) && empty.teams.length === 0, 'пустые teams не ломают сборку');
  ok(Array.isArray(empty.freeAgents) && empty.freeAgents.length === 0, 'пустые freeAgents — снова []');

  const withAgents = buildTeamsDocument({
    discipline: 'csgo', teams: [], exportedAt: at,
    freeAgents: [agentLead(9, 999, 's1mple', 'csgo'), agentLead(10, 888, 'Nightfall', 'csgo', 'player')]
  });
  ok(withAgents.freeAgents[0].type === 'looking_for_team' && withAgents.freeAgents[0].rank === 'Divine 3',
    'свободный агент: type и ранг');
  ok(withAgents.freeAgents[1].type === 'player' && /Some Team/.test(withAgents.freeAgents[1].note),
    'заявка игрока: type=player и команда в note');
  ok(withAgents.freeAgents[0].telegramId === 999, 'telegramId агента попадает в файл');

  const settings = buildSettingsDocument({ discipline: 'csgo', tournamentName: 'Compass Arena Season 2', exportedAt: at });
  ok(settings.type === 'settings' && settings.tournament.game === 'CS:GO', 'файл настроек: тип и игра по дисциплине');
  ok(settings.tournament.name === 'Compass Arena Season 2' && settings.bracket.structure === 'custom',
    'файл настроек: название турнира и блок bracket');
  const defaultName = buildSettingsDocument({ discipline: 'dota2', exportedAt: at });
  ok(defaultName.tournament.name === 'Compass Arena Season 2', 'пустое название → дефолт');
}

{
  // Полный поток: /export → дисциплина → что экспортировать → подтверждение → файлы
  const fake = createFakeD1();
  const env = baseEnv(fake);
  fake._db.addLead({ telegramId: 111, type: 'team', discipline: 'dota2', status: 'approved', payload: teamLead(1, 111, 'Alpha', 'dota2').payload });
  fake._db.addLead({ telegramId: 222, type: 'team', discipline: 'dota2', status: 'approved', payload: teamLead(2, 222, 'Beta', 'dota2').payload });
  fake._db.addLead({ telegramId: 333, type: 'team', discipline: 'csgo', status: 'approved', payload: teamLead(3, 333, 'Gamma', 'csgo').payload });
  fake._db.addLead({ telegramId: 444, type: 'free_agent', discipline: 'dota2', status: 'approved', payload: agentLead(4, 444, 'agent1', 'dota2').payload });
  fake._db.addLead({ telegramId: 555, type: 'player', discipline: 'csgo', status: 'approved', payload: agentLead(5, 555, 'player1', 'csgo', 'player').payload });
  fake._db.addLead({ telegramId: 666, type: 'team', discipline: 'dota2', status: 'pending', payload: teamLead(6, 666, 'Pending Team', 'dota2').payload });

  mockTelegram();
  await say(env, ADMIN, '/export');
  ok(/Экспорт для сайта/.test(lastTo(ADMIN)) && /Выбери дисциплину/.test(lastTo(ADMIN)), '/export показывает выбор дисциплины');
  ok(/exp:disc:both/.test(markupSince(0)), 'есть вариант «обе дисциплины»');

  await tap(env, ADMIN, 'exp:disc:both');
  ok(/Что экспортировать/.test(lastTo(ADMIN)) && /exp:target:both:both/.test(markupSince(marker() - 200)), 'после дисциплины — выбор состава экспорта');

  let mark = marker();
  await tap(env, ADMIN, 'exp:target:both:both');
  const confirm = lastTo(ADMIN);
  ok(/Готовлю экспорт: <b>3<\/b> команды, <b>2<\/b> агента, <b>4<\/b> файла/.test(confirm), 'подтверждение со счётчиками', confirm.slice(0, 90));
  ok(/exp:go:both:both/.test(markupSince(mark)) && /Отмена/.test(markupSince(mark)), 'кнопки «Отправить» и «Отмена»',
    markupSince(mark).slice(0, 200));

  // отмена ничего не отправляет
  mark = marker();
  await tap(env, ADMIN, 'exp:cancel');
  ok(!calls.slice(mark).some((call) => call.method === 'sendDocument'), 'отмена не отправляет файлы');
  ok(/отменён/i.test(lastTo(ADMIN)), 'отмена сообщает об отмене');

  // соглашаемся — ждём 4 файла с правильными именами и подписями
  mark = marker();
  await tap(env, ADMIN, 'exp:go:both:both');
  const docs = calls.slice(mark).filter((call) => call.method === 'sendDocument').map((call) => call.body);
  ok(docs.length === 4, 'отправлено четыре файла', docs.length);
  ok(docs.map((d) => d.filename).join(' | ') ===
    'teams_2026-10-07_dota2.json | teams_2026-10-07_csgo.json | settings_2026-10-07_dota2.json | settings_2026-10-07_csgo.json'
    .replace(/2026-10-07/g, new Date().toISOString().slice(0, 10)),
    'имена файлов: команды по дисциплинам, затем настройки', docs.map((d) => d.filename).join(' | '));
  ok(docs[0].caption === 'Файл 1/4: Dota 2 команды' && docs[1].caption === 'Файл 2/4: CS:GO команды',
    'подписи файлов команд', docs.map((d) => d.caption).join(' | '));
  ok(docs[2].caption === 'Файл 3/4: Dota 2 настройки' && docs[3].caption === 'Файл 4/4: CS:GO настройки',
    'подписи файлов настроек');
  ok(/Экспорт готов/.test(lastTo(ADMIN)) && /Импорт из бота/.test(lastTo(ADMIN)), 'итоговое сообщение про импорт');

  // одна дисциплина → два файла
  mockTelegram();
  await tap(env, ADMIN, 'exp:disc:dota2');
  await tap(env, ADMIN, 'exp:target:dota2:both');
  mark = marker();
  await tap(env, ADMIN, 'exp:go:dota2:both');
  const one = calls.slice(mark).filter((call) => call.method === 'sendDocument').map((call) => call.body.filename);
  ok(one.length === 2 && one[0] === `teams_${new Date().toISOString().slice(0, 10)}_dota2.json`,
    'одна дисциплина → 2 файла', one.join(' | '));

  // только настройки → файлы настроек без команд
  mockTelegram();
  await tap(env, ADMIN, 'exp:disc:csgo');
  await tap(env, ADMIN, 'exp:target:csgo:settings');
  mark = marker();
  await tap(env, ADMIN, 'exp:go:csgo:settings');
  const onlySettings = calls.slice(mark).filter((call) => call.method === 'sendDocument').map((call) => call.body.filename);
  ok(onlySettings.length === 1 && /^settings_/.test(onlySettings[0]), 'экспорт только настроек', onlySettings.join(' | '));
}

{
  // Нет одобренных команд → «Нет команд для экспорта»
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();
  await say(env, ADMIN, '/export');
  await tap(env, ADMIN, 'exp:disc:dota2');
  let mark = marker();
  await tap(env, ADMIN, 'exp:target:dota2:teams');
  ok(lastAnswer() === 'Нет команд для экспорта', 'без одобренных команд — отказ', lastAnswer());
  ok(/Нет команд для экспорта/.test(lastTo(ADMIN)), 'и понятное сообщение в чате', lastTo(ADMIN).slice(0, 60));
  ok(!calls.slice(mark).some((call) => call.method === 'sendDocument'), 'файлы не отправляются');

  // но настройки без команд экспортировать можно
  await tap(env, ADMIN, 'exp:target:dota2:settings');
  mark = marker();
  await tap(env, ADMIN, 'exp:go:dota2:settings');
  ok(calls.slice(mark).filter((call) => call.method === 'sendDocument').length === 1,
    'файл настроек отправляется даже без команд');
}

{
  // Не-админ не может экспортировать (сценарий 4)
  const fake = createFakeD1();
  const env = baseEnv(fake);
  mockTelegram();
  await say(env, USER, '/export');
  ok(/только организаторам/.test(lastTo(USER)), '/export запрещён не-админу (команда)');
  mockTelegram();
  await tap(env, USER, 'exp:go:both:both');
  ok(lastAnswer() === 'Недостаточно прав', 'кнопки экспорта запрещены не-админу', lastAnswer());
  ok(!calls.some((call) => call.method === 'sendDocument'), 'файлы не утекают не-админу');
}

/* ============================================================
   12. Безопасность callback_data
   ============================================================ */
console.log('\n12. Безопасность callback_data');
{
  const encoder = new TextEncoder();
  const tooLong = allCallbackData.filter((data) => encoder.encode(data).length > 64);
  ok(tooLong.length === 0, 'все callback_data ≤ 64 байт', tooLong.slice(0, 3));
  ok(allCallbackData.length > 30, 'callback_data действительно собирались', allCallbackData.length);
  const unknown = allCallbackData.filter((data) => !/^(reg|mod|exp|act):/.test(data));
  ok(unknown.length === 0, 'у всех callback_data известный префикс', unknown.slice(0, 3));

  // Каждая кнопка должна иметь текст и действие: ловит ошибки вложенности клавиатур
  const broken = allButtons.filter((btn) => !btn.text || (!btn.url && !btn.callback_data));
  ok(broken.length === 0, 'все кнопки имеют текст и действие', broken.slice(0, 3));
  ok(allButtons.length > 80, 'кнопки действительно проверены', allButtons.length);
}

/* ============================================================
   13. Webhook: секрет и прод-режим
   ============================================================ */
console.log('\n13. Webhook: секрет и прод-режим');
{
  const reqWith = (secret) => new Request('https://bot.example.workers.dev/webhook', {
    method: 'POST',
    headers: secret === null ? {} : { 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ update_id: 1 })
  });
  const devEnv = baseEnv();
  const prodEnv = baseEnv(createFakeD1(), { ENVIRONMENT: 'production' });

  ok(checkWebhookSecret(reqWith('s3cret'), devEnv) === true, 'верный секрет пропускается');
  ok(checkWebhookSecret(reqWith('wrong'), devEnv) === false, 'неверный секрет отклоняется');
  ok(checkWebhookSecret(reqWith(null), devEnv) === false, 'без заголовка — отказ');
  ok(isProduction(prodEnv) === true && isProduction(devEnv) === false, 'ENVIRONMENT распознаётся');

  const ctx = { waitUntil() {} };
  const noSecretProd = await worker.fetch(reqWith(null), { ENVIRONMENT: 'production' }, ctx);
  ok(noSecretProd.status === 500, 'в проде без WEBHOOK_SECRET — 500', noSecretProd.status);
  const body = await noSecretProd.json();
  ok(/WEBHOOK_SECRET not set in production/.test(body.error), 'текст ошибки прод-режима');

  const noSecretDev = await worker.fetch(reqWith(null), { ENVIRONMENT: 'development' }, ctx);
  ok(noSecretDev.status === 200, 'в dev без секрета — 200 с предупреждением');

  const goodSecret = await worker.fetch(reqWith('s3cret'), prodEnv, ctx);
  ok(goodSecret.status === 200, 'в проде с верным секретом — 200');

  const badSecret = await worker.fetch(reqWith('wrong'), prodEnv, ctx);
  ok(badSecret.status === 403, 'в проде с неверным секретом — 403');

  const health = await worker.fetch(new Request('https://bot.example/health'), prodEnv, ctx);
  const healthBody = await health.json();
  ok(health.status === 200 && healthBody.db.ok === true, 'GET /health отвечает и видит базу', healthBody.db);
}
{
  /* Диагностический JSON не должен раскрывать секреты: только булевы флаги */
  console.log('  — диагностика не раскрывает секреты');
  const fake = createFakeD1();
  const secrets = {
    BOT_TOKEN: '111222333:SECRET-BOT-TOKEN',
    ADMIN_ID: '987654321',
    WEBHOOK_SECRET: 'SECRET-WEBHOOK-TOKEN'
  };
  const env = baseEnv(fake, secrets);
  const ctx = { waitUntil() {} };

  for (const path of ['/', '/health']) {
    const res = await worker.fetch(new Request('https://bot.example' + path), env, ctx);
    const text = await res.text();
    ok(!text.includes(secrets.BOT_TOKEN), `в ответе ${path} нет значения BOT_TOKEN`);
    ok(!text.includes(secrets.ADMIN_ID), `в ответе ${path} нет значения ADMIN_ID`);
    ok(!text.includes(secrets.WEBHOOK_SECRET), `в ответе ${path} нет значения WEBHOOK_SECRET`);

    const body = JSON.parse(text);
    ok(body.botTokenConfigured === true && body.adminConfigured === true && body.webhookSecretConfigured === true,
      `в ответе ${path} секреты отражены только флагами true/false`);
    ok(Object.keys(body).sort().join(',') ===
      'adminConfigured,botTokenConfigured,db,ok,service,time,webhookSecretConfigured',
      `в ответе ${path} только ожидаемые поля`, Object.keys(body).sort().join(','));
    ok(body.db.ok === true && typeof body.db.leads === 'number' && Object.keys(body.db).length === 2,
      `в блоке db только ok и счётчик`, body.db);
  }

  // Флаги не врут: если секретов нет — все false
  const bare = await worker.fetch(new Request('https://bot.example/health'), { ...baseEnv(fake), BOT_TOKEN: '', ADMIN_ID: '', WEBHOOK_SECRET: '' }, ctx);
  const bareBody = await bare.json();
  ok(bareBody.botTokenConfigured === false && bareBody.adminConfigured === false && bareBody.webhookSecretConfigured === false,
    'без секретов флаги false', bareBody);
}

/* ============================================================
   Итог
   ============================================================ */
globalThis.fetch = originalFetch;
console.log(`\nПройдено: ${passed}, провалено: ${failed}`);
process.exit(failed ? 1 : 0);
