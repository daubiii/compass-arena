-- ============================================================
-- Compass Arena Bot — схема D1 (SQLite)
-- Применение: npm run db:init        (удалённая база)
--             npm run db:init:local  (локальная для wrangler dev)
-- Файл идемпотентный: можно запускать повторно.
-- ============================================================

-- ---------- Пользователи бота ----------
CREATE TABLE IF NOT EXISTS users (
  telegram_id   INTEGER PRIMARY KEY,
  username      TEXT,
  first_name    TEXT,
  last_name     TEXT,
  first_seen    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Пошаговые состояния диалога ----------
-- step      — текущий шаг («team:name», «fa:role», …)
-- temp_data — JSON с уже собранными ответами
CREATE TABLE IF NOT EXISTS states (
  telegram_id   INTEGER PRIMARY KEY,
  step          TEXT,
  temp_data     TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Заявки ----------
-- type       — 'team' | 'free_agent' | 'player'
-- discipline — 'dota2' | 'csgo'
-- status     — 'pending' | 'approved' | 'rejected'
-- payload    — JSON с данными заявки (состав, ники, роли, логотип и т.п.)
CREATE TABLE IF NOT EXISTS leads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id   INTEGER NOT NULL,
  type          TEXT NOT NULL,
  discipline    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  payload       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  moderated_at  TEXT,
  moderated_by  INTEGER,
  reject_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_discipline  ON leads(discipline);
CREATE INDEX IF NOT EXISTS idx_leads_type        ON leads(type);
-- Дополнительно к ТЗ: быстрый поиск последней заявки пользователя (rate limit 1 заявка / 5 мин)
CREATE INDEX IF NOT EXISTS idx_leads_tg_created  ON leads(telegram_id, created_at DESC);
-- Дополнительно к ТЗ: выборка одобренных заявок для экспорта
CREATE INDEX IF NOT EXISTS idx_leads_export      ON leads(status, discipline, type);

-- ---------- Настройки бота ----------
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('registration_open', '1'),
  ('current_discipline', 'dota2'),
  ('current_tournament', 'Compass Arena Season 2');
