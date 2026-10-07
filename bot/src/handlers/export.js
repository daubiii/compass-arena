/* ============================================================
   Экспорт: /export → JSON-файлы для админки сайта
   ------------------------------------------------------------
   Бот НЕ пишет в KV сайта: он отдаёт файлы, админ загружает их
   вручную через раздел «Импорт из бота».

   Поток:
     /export → дисциплина (Dota 2 / CS:GO / обе)
             → что экспортировать (команды / настройки / оба)
             → подтверждение: «N команд, M агентов, K файлов»
             → отправка файлов по одному через sendDocument

   Имена файлов (дисциплина всегда в имени, чтобы файлы не путались):
     teams_YYYY-MM-DD_dota2.json
     settings_YYYY-MM-DD_dota2.json

   Сборщики JSON вынесены в чистые функции (buildTeamsDocument,
   buildSettingsDocument) — их проверяет самопроверка без сети.
   ============================================================ */

import { sendMessage, sendDocument, answerCallbackQuery } from '../lib/telegram.js';
import { listApprovedForExport, getSetting } from '../lib/db.js';
import { esc, dateStamp, plural } from '../lib/esc.js';
import { DISCIPLINE_KEYS, disciplineLabel, disciplineGame } from '../lib/domain.js';
import { kb, menuRow, backRow, screen } from '../lib/ui.js';

export const commands = ['export'];
export const callbackPrefixes = ['exp'];

const EXPORT_VERSION = 1;
/** Дефолт, если в D1 не заполнено settings.current_tournament */
const DEFAULT_TOURNAMENT = 'Compass Arena Season 2';

const TARGETS = {
  teams: { key: 'teams', label: 'команды' },
  settings: { key: 'settings', label: 'настройки' },
  both: { key: 'both', label: 'команды и настройки' }
};

/* ============================================================
   Чистые сборщики JSON
   ============================================================ */

/**
 * Файл команд.
 * @param {{discipline: string, teams: Array, freeAgents: Array, exportedAt?: string}} input
 */
export function buildTeamsDocument({ discipline, teams, freeAgents, exportedAt }) {
  // Сортировка по возрастанию id заявки: team_1, team_2, … team_N
  const ordered = (teams || []).slice().sort((a, b) => Number(a.id) - Number(b.id));

  return {
    type: 'teams',
    version: EXPORT_VERSION,
    exportedAt: exportedAt || new Date().toISOString(),
    discipline,
    teams: ordered.map((lead, index) => {
      const p = lead.payload || {};
      return {
        id: `team_${index + 1}`,
        num: index + 1,
        name: p.name || '',
        logo: p.logo || '',
        logoOversized: Boolean(p.logoOversized),
        captainNick: p.captainNick || '',
        captainTelegramId: p.captainTelegramId || lead.telegram_id || null,
        players: (p.players || []).map((player) => ({
          nick: player.nick || '',
          role: player.role || 0,
          roleLabel: player.roleLabel || ''
        }))
      };
    }),
    // Пустой список агентов — именно [], а не null и не отсутствие поля
    freeAgents: (freeAgents || []).map((lead) => {
      const p = lead.payload || {};
      const isPlayer = p.type === 'player';
      return {
        nick: p.nick || '',
        role: p.role || 0,
        roleLabel: p.roleLabel || '',
        rank: p.rank || '',
        note: isPlayer ? (p.teamName ? `Сейчас играет в «${p.teamName}»` : '') : (p.note || ''),
        telegramId: lead.telegram_id || null,
        type: isPlayer ? 'player' : 'looking_for_team'
      };
    })
  };
}

/**
 * Файл настроек турнира.
 * @param {{discipline: string, tournamentName?: string, exportedAt?: string}} input
 */
export function buildSettingsDocument({ discipline, tournamentName, exportedAt }) {
  return {
    type: 'settings',
    version: EXPORT_VERSION,
    exportedAt: exportedAt || new Date().toISOString(),
    discipline,
    tournament: {
      // TODO: settings.current_tournament когда понадобится (сейчас только название тянем из D1)
      name: tournamentName || DEFAULT_TOURNAMENT,
      game: disciplineGame(discipline),
      format: 'Custom Bracket',
      matches: 'Bo3',
      dates: 'TBD'
    },
    bracket: {
      size: 8,
      structure: 'custom',
      notes: ''
    }
  };
}

/* ============================================================
   Данные из D1
   ============================================================ */
const disciplinesFor = (choice) => (choice === 'both' ? DISCIPLINE_KEYS.slice() : [choice]);

/** Одобренные команды и агенты по дисциплине */
async function collect(env, discipline) {
  const approved = await listApprovedForExport(env, { discipline });
  return {
    teams: approved.filter((lead) => lead.type === 'team'),
    agents: approved.filter((lead) => lead.type === 'free_agent' || lead.type === 'player')
  };
}

/** Сводка для подтверждения: сколько команд, агентов и файлов будет */
async function summary(env, choice, target) {
  const disciplines = disciplinesFor(choice);
  let teams = 0;
  let agents = 0;
  for (const discipline of disciplines) {
    const data = await collect(env, discipline);
    teams += data.teams.length;
    agents += data.agents.length;
  }
  const files = disciplines.length * (target === 'both' ? 2 : 1);
  return { disciplines, teams, agents, files, target };
}

/* ============================================================
   Экраны
   ============================================================ */
function screenDiscipline() {
  return {
    text: [
      'Экспорт для сайта',
      '',
      'Файлы загружаются вручную в админке («Импорт из бота»).',
      'Бот в KV сайта ничего не пишет.',
      '',
      'Выбери дисциплину:'
    ].join('\n'),
    keyboard: kb([
      [{ text: 'Dota 2', data: 'exp:disc:dota2' }, { text: 'CS:GO', data: 'exp:disc:csgo' }],
      [{ text: 'Обе дисциплины', data: 'exp:disc:both' }],
      [menuRow]
    ])
  };
}

function screenTarget(choice) {
  const title = choice === 'both'
    ? 'Dota 2 и CS:GO'
    : disciplineLabel(choice);
  return {
    text: [
      'Экспорт для сайта',
      '',
      `Дисциплина: ${esc(title)}`,
      '',
      'Что экспортировать?'
    ].join('\n'),
    keyboard: kb([
      [{ text: 'Команды и агенты', data: `exp:target:${choice}:teams` }],
      [{ text: 'Настройки турнира', data: `exp:target:${choice}:settings` }],
      [{ text: 'Оба файла', data: `exp:target:${choice}:both` }],
      backRow('exp:menu', '⬅️ К выбору дисциплины')
    ])
  };
}

function screenConfirm(choice, target, data) {
  return {
    text: [
      `Готовлю экспорт: ${data.teams} ${plural(data.teams, 'команда', 'команды', 'команд')}, ` +
      `${data.agents} ${plural(data.agents, 'агент', 'агента', 'агентов')}, ` +
      `${data.files} ${plural(data.files, 'файл', 'файла', 'файлов')}.`,
      `Дисциплина: ${esc(choice === 'both' ? 'Dota 2 и CS:GO' : disciplineLabel(choice))}`,
      `Состав: ${esc(TARGETS[target] ? TARGETS[target].label : target)}`
    ].join('\n'),
    keyboard: kb([
      [{ text: 'Отправить', data: `exp:go:${choice}:${target}` }],
      backRow(`exp:disc:${choice}`, 'Отмена')
    ])
  };
}

/* ============================================================
   Команда /export
   ============================================================ */
export async function handleCommand(env, message, ctx) {
  if (ctx.cmd !== 'export') return false;

  if (!ctx.isAdmin) {
    await sendMessage(env, ctx.chatId, '⛔ Команда доступна только организаторам турнира.');
    return true;
  }

  const view = screenDiscipline();
  await screen(env, ctx, view.text, view.keyboard);
  return true;
}

/* ============================================================
   Кнопки
   ============================================================ */
export async function handleCallback(env, query, ctx) {
  const parts = String(ctx.data || '').split(':');
  const action = parts[1];
  const first = parts[2];
  const second = parts[3];

  if (!ctx.isAdmin) {
    await answerCallbackQuery(env, query.id, { text: 'Недостаточно прав', showAlert: true });
    return true;
  }

  try {
    switch (action) {
      case 'menu': return await showDiscipline(env, query, ctx);
      case 'disc': return await onDiscipline(env, query, ctx, first);
      case 'target': return await onTarget(env, query, ctx, first, second);
      case 'go': return await onGo(env, query, ctx, first, second);
      case 'cancel': {
        await answerCallbackQuery(env, query.id, { text: 'Отменено' });
        await screen(env, ctx, 'Экспорт отменён. Ничего не отправлено.', kb([menuRow]));
        return true;
      }
      default:
        await answerCallbackQuery(env, query.id, { text: 'Неизвестное действие' });
        return true;
    }
  } catch (err) {
    console.error('[export] ошибка обработки кнопки', ctx.data, err && err.stack ? err.stack : err);
    await answerCallbackQuery(env, query.id, { text: 'Не удалось выполнить экспорт' });
    return true;
  }
}

async function showDiscipline(env, query, ctx) {
  await answerCallbackQuery(env, query.id);
  const view = screenDiscipline();
  await screen(env, ctx, view.text, view.keyboard);
  return true;
}

async function onDiscipline(env, query, ctx, choice) {
  const valid = choice === 'both' || DISCIPLINE_KEYS.includes(choice);
  if (!valid) {
    await answerCallbackQuery(env, query.id, { text: 'Неизвестная дисциплина', showAlert: true });
    return true;
  }
  await answerCallbackQuery(env, query.id);
  const view = screenTarget(choice);
  await screen(env, ctx, view.text, view.keyboard);
  return true;
}

async function onTarget(env, query, ctx, choice, target) {
  if (!TARGETS[target] || !(choice === 'both' || DISCIPLINE_KEYS.includes(choice))) {
    await answerCallbackQuery(env, query.id, { text: 'Неизвестный вариант экспорта', showAlert: true });
    return true;
  }

  const data = await summary(env, choice, target);

  // Пустой экспорт команд — прямое и понятное сообщение вместо файла с пустотой
  if (target !== 'settings' && data.teams === 0) {
    await answerCallbackQuery(env, query.id, { text: 'Нет команд для экспорта', showAlert: true });
    await screen(env, ctx,
      'Нет одобренных команд для экспорта.\nСначала разбери заявки в /leads.',
      kb([
        [{ text: '📋 К модерации', data: 'mod:list:new' }],
        backRow(`exp:disc:${choice}`, '⬅️ К выбору дисциплины'),
        [menuRow]
      ]));
    return true;
  }

  await answerCallbackQuery(env, query.id);
  const view = screenConfirm(choice, target, data);
  await screen(env, ctx, view.text, view.keyboard);
  return true;
}

/* ---------- Отправка файлов ---------- */
async function onGo(env, query, ctx, choice, target) {
  if (!TARGETS[target] || !(choice === 'both' || DISCIPLINE_KEYS.includes(choice))) {
    await answerCallbackQuery(env, query.id, { text: 'Неизвестный вариант экспорта', showAlert: true });
    return true;
  }

  const data = await summary(env, choice, target);
  if (target !== 'settings' && data.teams === 0) {
    await answerCallbackQuery(env, query.id, { text: 'Нет команд для экспорта', showAlert: true });
    return true;
  }

  await answerCallbackQuery(env, query.id, { text: 'Собираю файлы' });

  const exportedAt = new Date().toISOString();
  const stamp = dateStamp(new Date(exportedAt));
  const tournamentName = (await getSetting(env, 'current_tournament', '')) || DEFAULT_TOURNAMENT;
  const kinds = target === 'both' ? ['teams', 'settings'] : [target];

  // Собираем все файлы заранее: сначала команды по дисциплинам, потом настройки
  const jobs = [];
  for (const kind of kinds) {
    for (const discipline of data.disciplines) {
      const payload = await collect(env, discipline);
      if (kind === 'teams') {
        jobs.push({
          filename: `teams_${stamp}_${discipline}.json`,
          discipline,
          kind,
          document: buildTeamsDocument({
            discipline,
            teams: payload.teams,
            freeAgents: payload.agents,
            exportedAt
          })
        });
      } else {
        jobs.push({
          filename: `settings_${stamp}_${discipline}.json`,
          discipline,
          kind,
          document: buildSettingsDocument({ discipline, tournamentName, exportedAt })
        });
      }
    }
  }

  let sent = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const caption = `Файл ${i + 1}/${jobs.length}: ${disciplineLabel(job.discipline)} ` +
      (job.kind === 'teams' ? 'команды' : 'настройки');
    try {
      await sendDocument(env, ctx.chatId, {
        filename: job.filename,
        content: JSON.stringify(job.document, null, 2),
        contentType: 'application/json'
      }, { caption: esc(caption) });
      sent++;
    } catch (err) {
      console.error('[export] не удалось отправить', job.filename, err && err.message);
      await sendMessage(env, ctx.chatId, `⚠️ Не удалось отправить файл <code>${esc(job.filename)}</code>.`);
    }
  }

  await sendMessage(env, ctx.chatId,
    `Экспорт готов: ${sent} ${plural(sent, 'файл', 'файла', 'файлов')}.\n` +
    'Загрузи их в админке сайта → «Импорт из бота».',
    { keyboard: kb([[menuRow]]) });
  return true;
}

export async function handleText() {
  return false;
}

export async function handlePhoto() {
  return false;
}
