/* ============================================================
   Экранирование и работа с текстом
   ------------------------------------------------------------
   В Telegram отвечаем с parse_mode = 'HTML', поэтому весь
   пользовательский ввод (ники, названия команд, описания)
   обязательно проходит через esc().
   ============================================================ */

/** Экранирование под parse_mode: 'HTML' */
export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Обрезка длинного текста с многоточием (для превью в списках) */
export function truncate(value, max = 120) {
  const text = String(value == null ? '' : value);
  return text.length > max ? text.slice(0, Math.max(0, max - 1)) + '…' : text;
}

/**
 * Нормализация пользовательского ввода:
 * убираем управляющие символы, неразрывные пробелы, лишние пробелы и переводы строк.
 */
export function clean(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ник игрока: 2–30 символов.
 * Разрешены буквы (в том числе кириллица), цифры, пробел, дефис, подчёркивание, точка.
 */
export function isNick(value) {
  const nick = clean(value);
  if (nick.length < 2 || nick.length > 30) return false;
  return /^[\p{L}\p{N}][\p{L}\p{N}._\- ]*$/u.test(nick);
}

/**
 * Название команды: 2–30 символов, тот же набор символов, что и у ника.
 */
export function isTeamName(value) {
  const name = clean(value);
  if (name.length < 2 || name.length > 30) return false;
  return /^[\p{L}\p{N}][\p{L}\p{N}._\- ]*$/u.test(name);
}

/** Простой «slug» для имён файлов: «Compass Arena Season 2» → «compass-arena-season-2» */
export function slug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'file';
}

/**
 * Uint8Array → base64.
 * Чанками, чтобы не переполнить стек на логотипах по 200 КБ.
 */
export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Дата в формате YYYY-MM-DD (UTC) для имён файлов экспорта */
export function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** Плюрализация по-русски: plural(3, 'заявка', 'заявки', 'заявок') */
export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
