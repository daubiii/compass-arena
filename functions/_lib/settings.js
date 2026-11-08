// Общие настройки сайта: какой турнир сейчас «текущий» и как считается банк призовых.
// Лежат в одном маленьком ключе KV `settings` (отдельно от больших данных турниров).
import { DEFAULT_GAME, gameFrom } from './games.js';

export const SETTINGS_KEY = 'settings';

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
const text = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

/** Приводит что угодно к валидным настройкам. configured=false — админ их ещё не задавал */
export function normalizeSettings(raw, configured = true) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const prize = src.prize && typeof src.prize === 'object' ? src.prize : {};
  return {
    configured: !!configured && !!raw,
    current: gameFrom(src.current) || DEFAULT_GAME,
    season: text(src.season, 40),
    prize: {
      enabled: prize.enabled !== false,
      perTeam: clampInt(prize.perTeam, 0, 10000000, 1000),
      base: clampInt(prize.base, 0, 100000000, 0),
      note: text(prize.note, 300)
    }
  };
}
