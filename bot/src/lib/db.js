/* ============================================================
   Помощники для Cloudflare D1
   ------------------------------------------------------------
   Все запросы — через подготовленные выражения (prepare/bind),
   поэтому пользовательские данные не попадают в SQL напрямую.

   Таблицы: users, states, leads, settings (см. schema.sql).
   ============================================================ */

/* ============================================================
   Пользователи
   ============================================================ */

/**
 * Отметить пользователя: создать или обновить last_seen/username.
 * Вызывается на каждом апдейте.
 * @param {object} env
 * @param {{id: number, username?: string, first_name?: string, last_name?: string}} from
 */
export async function touchUser(env, from) {
  if (!from || !from.id) return null;
  return env.DB.prepare(
    `INSERT INTO users (telegram_id, username, first_name, last_name, first_seen, last_seen)
     VALUES (?1, ?2, ?3, ?4, datetime('now'), datetime('now'))
     ON CONFLICT(telegram_id) DO UPDATE SET
       username   = excluded.username,
       first_name = excluded.first_name,
       last_name  = excluded.last_name,
       last_seen  = datetime('now')`
  )
    .bind(from.id, from.username || null, from.first_name || null, from.last_name || null)
    .run();
}

export async function getUser(env, telegramId) {
  return env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?')
    .bind(telegramId)
    .first();
}

/** Сколько всего пользователей в боте */
export async function countUsers(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  return row ? row.n : 0;
}

/* ============================================================
   Доступ администратора
   ============================================================ */

/**
 * Проверка админа: ADMIN_ID (можно несколько через запятую)
 * плюс необязательный список в settings.admin_ids.
 */
export async function isAdmin(env, telegramId) {
  const id = Number(telegramId);
  if (!id) return false;

  const fromEnv = String((env && env.ADMIN_ID) || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (fromEnv.includes(id)) return true;

  const fromSettings = await getSetting(env, 'admin_ids', '');
  const extra = String(fromSettings || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  return extra.includes(id);
}

/* ============================================================
   Пошаговые состояния диалога
   ============================================================ */

/**
 * Текущее состояние пользователя.
 * @returns {Promise<{step: string|null, temp: object, updated_at?: string}>}
 */
export async function getState(env, telegramId) {
  const row = await env.DB.prepare('SELECT step, temp_data, updated_at FROM states WHERE telegram_id = ?')
    .bind(telegramId)
    .first();
  if (!row) return { step: null, temp: {} };
  return {
    step: row.step || null,
    temp: parseJson(row.temp_data, {}),
    updated_at: row.updated_at
  };
}

/** Записать шаг и накопленные данные (temp_data — JSON) */
export async function setState(env, telegramId, step, temp = {}) {
  return env.DB.prepare(
    `INSERT INTO states (telegram_id, step, temp_data, updated_at)
     VALUES (?1, ?2, ?3, datetime('now'))
     ON CONFLICT(telegram_id) DO UPDATE SET
       step       = excluded.step,
       temp_data  = excluded.temp_data,
       updated_at = datetime('now')`
  )
    .bind(telegramId, step || null, JSON.stringify(temp || {}))
    .run();
}

/** Сбросить диалог пользователя */
export async function resetState(env, telegramId) {
  return env.DB.prepare('DELETE FROM states WHERE telegram_id = ?')
    .bind(telegramId)
    .run();
}

/* ============================================================
   Заявки
   ============================================================ */

/**
 * Создать заявку.
 * @param {object} env
 * @param {{telegramId: number, type: string, discipline: string, payload: object}} lead
 * @returns {Promise<number>} id заявки
 */
export async function createLead(env, lead) {
  const result = await env.DB.prepare(
    `INSERT INTO leads (telegram_id, type, discipline, status, payload, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'pending', ?4, datetime('now'), datetime('now'))`
  )
    .bind(lead.telegramId, lead.type, lead.discipline, JSON.stringify(lead.payload || {}))
    .run();
  return (result.meta && result.meta.last_row_id) || 0;
}

export async function getLead(env, id) {
  const row = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first();
  return row ? withPayload(row) : null;
}

/**
 * Список заявок с фильтрами.
 * @param {object} env
 * @param {{status?: string, discipline?: string, type?: string, telegramId?: number, limit?: number, offset?: number}} [filters]
 */
export async function listLeads(env, filters = {}) {
  const where = [];
  const params = [];
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  if (filters.discipline) { where.push('discipline = ?'); params.push(filters.discipline); }
  if (filters.type) { where.push('type = ?'); params.push(filters.type); }
  if (filters.telegramId) { where.push('telegram_id = ?'); params.push(filters.telegramId); }

  const limit = Math.min(Math.max(Number(filters.limit) || 20, 1), 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  const sql =
    `SELECT * FROM leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY datetime(created_at) DESC, id DESC LIMIT ? OFFSET ?`;

  const result = await env.DB.prepare(sql).bind(...params, limit, offset).all();
  return (result.results || []).map(withPayload);
}

/** Одна заявка на пользователя за окно времени (rate limit) */
export async function lastLeadAt(env, telegramId) {
  const row = await env.DB.prepare(
    `SELECT created_at FROM leads WHERE telegram_id = ? ORDER BY id DESC LIMIT 1`
  )
    .bind(telegramId)
    .first();
  if (!row || !row.created_at) return null;
  return sqliteTimeToDate(row.created_at);
}

/**
 * Можно ли отправить новую заявку (не чаще одной за LEAD_RATE_LIMIT_SEC).
 * @returns {Promise<{allowed: boolean, retryAfterSec: number, lastAt: Date|null}>}
 */
export async function canSubmitLead(env, telegramId) {
  const windowSec = Number((env && env.LEAD_RATE_LIMIT_SEC) || 300) || 300;
  const lastAt = await lastLeadAt(env, telegramId);
  if (!lastAt) return { allowed: true, retryAfterSec: 0, lastAt: null };

  const passedSec = (Date.now() - lastAt.getTime()) / 1000;
  if (passedSec >= windowSec) return { allowed: true, retryAfterSec: 0, lastAt };
  return {
    allowed: false,
    retryAfterSec: Math.max(1, Math.ceil(windowSec - passedSec)),
    lastAt
  };
}

/**
 * Изменить статус заявки.
 * @param {object} env
 * @param {number} id
 * @param {'approved'|'rejected'|'pending'} status
 * @param {number} moderatorId
 * @param {string} [reason]
 */
export async function updateLeadStatus(env, id, status, moderatorId, reason = null) {
  return env.DB.prepare(
    `UPDATE leads SET
       status        = ?2,
       updated_at    = datetime('now'),
       moderated_at  = datetime('now'),
       moderated_by  = ?3,
       reject_reason = ?4
     WHERE id = ?1`
  )
    .bind(id, status, moderatorId || null, reason)
    .run();
}

/** Счётчики заявок: { pending: n, approved: n, rejected: n } */
export async function countLeads(env, filters = {}) {
  const where = [];
  const params = [];
  if (filters.discipline) { where.push('discipline = ?'); params.push(filters.discipline); }
  if (filters.type) { where.push('type = ?'); params.push(filters.type); }

  const sql =
    `SELECT status, COUNT(*) AS n FROM leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY status`;
  const result = await env.DB.prepare(sql).bind(...params).all();

  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const row of result.results || []) counts[row.status] = row.n;
  return counts;
}

/** Разбивка ожидающих модерации по типу и дисциплине (для шапки /leads) */
export async function pendingBreakdown(env) {
  const result = await env.DB.prepare(
    `SELECT discipline, type, COUNT(*) AS n FROM leads WHERE status = 'pending'
     GROUP BY discipline, type ORDER BY discipline, type`
  ).all();
  return result.results || [];
}

/**
 * Есть ли у пользователя незакрытая заявка на команду с таким названием.
 * Использует json_extract по payload (SQLite JSON1 в D1 поддерживается).
 * @returns {Promise<object|null>}
 */
export async function findPendingTeamByName(env, telegramId, name) {
  const row = await env.DB.prepare(
    `SELECT * FROM leads
     WHERE telegram_id = ? AND status = 'pending' AND json_extract(payload, '$.name') = ?
     LIMIT 1`
  )
    .bind(telegramId, name)
    .first();
  return row ? withPayload(row) : null;
}

/* ============================================================
   Экспорт
   ============================================================ */

/**
 * Следующая заявка на модерации.
 * Идём по возрастанию id после текущей, а если дошли до конца — начинаем сначала
 * (чтобы «Пропустить» не упирался в тупик).
 * @param {object} env
 * @param {number} afterId — id текущей заявки (0 — взять самую первую)
 */
export async function nextPendingLead(env, afterId = 0) {
  const next = await env.DB.prepare(
    `SELECT * FROM leads WHERE status = 'pending' AND id > ? ORDER BY id ASC LIMIT 1`
  )
    .bind(afterId)
    .first();
  if (next) return withPayload(next);

  const first = await env.DB.prepare(
    `SELECT * FROM leads WHERE status = 'pending' ORDER BY id ASC LIMIT 1`
  ).first();
  return first ? withPayload(first) : null;
}

/**
 * Уже одобренная команда с таким же названием в той же дисциплине
 * (для предупреждения о дубликате при модерации).
 */
export async function findApprovedTeamByName(env, discipline, name, excludeId) {
  const row = await env.DB.prepare(
    `SELECT * FROM leads
     WHERE status = 'approved' AND type = 'team' AND discipline = ?
       AND json_extract(payload, '$.name') = ? AND id != ?
     ORDER BY id ASC LIMIT 1`
  )
    .bind(discipline, name, excludeId)
    .first();
  return row ? withPayload(row) : null;
}

/**
 * Одобренные заявки для экспорта в JSON.
 * @param {object} env
 * @param {{discipline: string, type?: string}} opts
 */
export async function listApprovedForExport(env, opts) {
  const params = [opts.discipline];
  let sql = `SELECT * FROM leads WHERE status = 'approved' AND discipline = ?`;
  if (opts.type) { sql += ' AND type = ?'; params.push(opts.type); }
  sql += ' ORDER BY datetime(created_at) ASC, id ASC';

  const result = await env.DB.prepare(sql).bind(...params).all();
  return (result.results || []).map(withPayload);
}

/* ============================================================
   Настройки
   ============================================================ */

export async function getSetting(env, key, fallback = null) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row && row.value != null ? row.value : fallback;
}

export async function setSetting(env, key, value) {
  return env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
    .bind(key, String(value))
    .run();
}

/** Все настройки объектом */
export async function allSettings(env) {
  const result = await env.DB.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const row of result.results || []) out[row.key] = row.value;
  return out;
}

/** Открыта ли регистрация */
export async function isRegistrationOpen(env) {
  return (await getSetting(env, 'registration_open', '1')) === '1';
}

/* ============================================================
   Мелочи
   ============================================================ */

/** Безопасный JSON.parse: при ошибке возвращает fallback */
export function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    console.warn('[db] не удалось разобрать JSON:', String(value).slice(0, 120));
    return fallback;
  }
}

/** Строка строки leads получает распарсенный payload */
function withPayload(row) {
  return { ...row, payload: parseJson(row.payload, {}) };
}

/** 'YYYY-MM-DD HH:MM:SS' (UTC из SQLite) → Date */
export function sqliteTimeToDate(value) {
  if (!value) return null;
  const iso = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T') + 'Z';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
