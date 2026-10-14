/* ============================================================
   In-memory замена Cloudflare D1 для самопроверки бота.
   ------------------------------------------------------------
   Понимает ровно те SQL-запросы, которые делает src/lib/db.js
   (список синхронизирован с кодом: при новом запросе добавьте
   обработчик сюда, иначе self-check упадёт с понятной ошибкой).

   Использование:
     const fake = createFakeD1({ settings: { registration_open: '1' } });
     const env = { DB: fake.DB, _db: fake._db, ADMIN_ID: '111' };
   ============================================================ */

const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export function createFakeD1(seed = {}) {
  const db = {
    users: new Map(),
    states: new Map(),
    leads: [],
    settings: new Map(Object.entries({
      registration_open: '1',
      current_discipline: 'dota2',
      current_tournament: 'Compass Arena Season 2',
      ...(seed.settings || {})
    })),
    nextLeadId: 1,
    queries: []
  };

  /* ---------- helpers ---------- */
  const normalize = (sql) => String(sql).replace(/\s+/g, ' ').trim();
  const rows = (list) => ({ results: list });
  const ok = (extra = {}) => ({ success: true, meta: { last_row_id: db.nextLeadId - 1, ...extra } });

  function addLead({ telegramId, type, discipline, status = 'pending', payload = {}, createdAt = null }) {
    const row = {
      id: db.nextLeadId++,
      telegram_id: telegramId,
      type,
      discipline,
      status,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      created_at: createdAt || nowSql(),
      updated_at: nowSql(),
      moderated_at: null,
      moderated_by: null,
      reject_reason: null
    };
    db.leads.push(row);
    return row;
  }

  const parseRow = (row) => {
    if (!row) return null;
    let payload = {};
    try { payload = JSON.parse(row.payload); } catch { payload = {}; }
    return { ...row, payload };
  };

  /* ---------- обработчики запросов ---------- */
  const handlers = [
    // users
    {
      test: /^INSERT INTO users/,
      run: (p) => {
        const [id, username, firstName, lastName] = p;
        const existing = db.users.get(id);
        db.users.set(id, {
          telegram_id: id,
          username: username || null,
          first_name: firstName || null,
          last_name: lastName || null,
          first_seen: existing ? existing.first_seen : nowSql(),
          last_seen: nowSql()
        });
        return ok();
      }
    },
    { test: /^SELECT \* FROM users WHERE telegram_id = \?/, first: (p) => db.users.get(p[0]) || null },
    { test: /^SELECT COUNT\(\*\) AS n FROM users/, first: () => ({ n: db.users.size }) },

    // states
    {
      test: /^INSERT INTO states/,
      run: (p) => {
        const [id, step, temp] = p;
        db.states.set(id, { telegram_id: id, step: step || null, temp_data: temp, updated_at: nowSql() });
        return ok();
      }
    },
    { test: /^SELECT step, temp_data, updated_at FROM states WHERE telegram_id = \?/, first: (p) => db.states.get(p[0]) || null },
    { test: /^DELETE FROM states WHERE telegram_id = \?/, run: (p) => { db.states.delete(p[0]); return ok(); } },
    {
      test: /^SELECT COUNT\(\*\) AS n FROM states/,
      first: () => ({ n: Array.from(db.states.values()).filter((s) => s.step).length })
    },

    // leads: одобренная команда с таким же названием (предупреждение о дубликате)
    {
      test: /json_extract\(payload, '\$\.name'\) = \? AND id != \?/,
      first: (p) => {
        const [discipline, name, excludeId] = p;
        const found = db.leads.find((row) => row.status === 'approved' && row.type === 'team' &&
          row.discipline === discipline && row.id !== excludeId && parseRow(row).payload.name === name);
        return found ? parseRow(found) : null;
      }
    },
    // leads: дубликат по json_extract среди pending
    {
      test: /json_extract\(payload, '\$\.name'\) = \? LIMIT 1/,
      first: (p) => {
        const [telegramId, name] = p;
        const found = db.leads.find((row) => row.telegram_id === telegramId && row.status === 'pending' &&
          parseRow(row).payload.name === name);
        return found ? parseRow(found) : null;
      }
    },
    // leads: создать
    {
      test: /^INSERT INTO leads/,
      run: (p) => {
        const [telegramId, type, discipline, payload] = p;
        const row = addLead({ telegramId, type, discipline, payload });
        return ok({ last_row_id: row.id });
      }
    },
    { test: /^SELECT \* FROM leads WHERE id = \?/, first: (p) => parseRow(db.leads.find((row) => row.id === p[0]) || null) },
    // leads: последняя заявка пользователя (rate limit)
    {
      test: /^SELECT created_at FROM leads WHERE telegram_id = \?/,
      first: (p) => {
        const mine = db.leads.filter((row) => row.telegram_id === p[0]);
        const last = mine[mine.length - 1];
        return last ? { created_at: last.created_at } : null;
      }
    },
    // leads: следующая заявка на модерации (сначала «после id», затем с начала)
    {
      test: /^SELECT \* FROM leads WHERE status = 'pending' AND id > \?/,
      first: (p) => {
        const list = db.leads.filter((row) => row.status === 'pending' && row.id > p[0]).sort((a, b) => a.id - b.id);
        return list.length ? parseRow(list[0]) : null;
      }
    },
    {
      test: /^SELECT \* FROM leads WHERE status = 'pending' ORDER BY id ASC LIMIT 1/,
      first: () => {
        const list = db.leads.filter((row) => row.status === 'pending').sort((a, b) => a.id - b.id);
        return list.length ? parseRow(list[0]) : null;
      }
    },
    // leads: счётчики по статусам
    {
      test: /^SELECT status, COUNT\(\*\) AS n FROM leads/,
      all: (p) => {
        const filters = readFilters(p);
        const counts = new Map();
        for (const row of filterRows(filters)) counts.set(row.status, (counts.get(row.status) || 0) + 1);
        return rows(Array.from(counts, ([status, n]) => ({ status, n })));
      }
    },
    // leads: разбивка pending
    {
      test: /^SELECT discipline, type, COUNT\(\*\) AS n FROM leads WHERE status = 'pending'/,
      all: () => {
        const counts = new Map();
        for (const row of db.leads.filter((r) => r.status === 'pending')) {
          const key = row.discipline + '|' + row.type;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        return rows(Array.from(counts, ([key, n]) => {
          const [discipline, type] = key.split('|');
          return { discipline, type, n };
        }));
      }
    },
    // leads: выборка для экспорта
    {
      test: /^SELECT \* FROM leads WHERE status = 'approved' AND discipline = \?/,
      all: (p) => {
        let list = db.leads.filter((row) => row.status === 'approved' && row.discipline === p[0]);
        if (p.length > 1) list = list.filter((row) => row.type === p[1]);
        return rows(list.map(parseRow));
      }
    },
    // leads: универсальная выборка с LIMIT/OFFSET
    {
      test: /^SELECT \* FROM leads/,
      all: (p) => {
        const limit = p[p.length - 2];
        const offset = p[p.length - 1];
        const filters = readFilters(p.slice(0, p.length - 2));
        const list = filterRows(filters)
          .slice()
          .sort((a, b) => (a.created_at === b.created_at ? b.id - a.id : (a.created_at < b.created_at ? 1 : -1)));
        return rows(list.slice(offset, offset + limit).map(parseRow));
      }
    },
    // leads: модерация
    {
      test: /^UPDATE leads SET/,
      run: (p) => {
        const [id, status, moderatorId, reason] = p;
        const row = db.leads.find((r) => r.id === id);
        if (!row) throw new Error('fake-d1: заявка #' + id + ' не найдена');
        row.status = status;
        row.moderated_at = nowSql();
        row.moderated_by = moderatorId || null;
        row.reject_reason = reason || null;
        row.updated_at = nowSql();
        return ok();
      }
    },
    // health-check воркера
    { test: /^SELECT COUNT\(\*\) AS leads FROM leads/, first: () => ({ leads: db.leads.length }) },

    // settings
    {
      test: /^INSERT INTO settings/,
      run: (p) => { db.settings.set(p[0], String(p[1])); return ok(); }
    },
    { test: /^SELECT value FROM settings WHERE key = \?/, first: (p) => (db.settings.has(p[0]) ? { value: db.settings.get(p[0]) } : null) },
    { test: /^SELECT key, value FROM settings/, all: () => rows(Array.from(db.settings, ([key, value]) => ({ key, value }))) }
  ];

  /** Фильтры читаем ровно в том порядке, в котором их собирает db.js */
  function readFilters(params) {
    const filters = {};
    let index = 0;
    const keys = ['status', 'discipline', 'type', 'telegramId'];
    for (const key of keys) {
      if (index < params.length) filters[key] = params[index++];
    }
    // «лишние» параметры означают, что порядок фильтров изменился — сообщаем явно
    if (index < params.length) {
      throw new Error('fake-d1: не разобраны параметры запроса: ' + JSON.stringify(params));
    }
    return filters;
  }

  function filterRows(filters) {
    return db.leads.filter((row) => {
      if (filters.status && row.status !== filters.status) return false;
      if (filters.discipline && row.discipline !== filters.discipline) return false;
      if (filters.type && row.type !== filters.type) return false;
      if (filters.telegramId && row.telegram_id !== filters.telegramId) return false;
      return true;
    });
  }

  /* ---------- D1-подобный интерфейс ---------- */
  function run(sql, params) {
    db.queries.push(sql);
    const query = normalize(sql);
    for (const handler of handlers) {
      if (!handler.test.test(query)) continue;
      return {
        first: async () => (handler.first ? handler.first(params) : null),
        all: async () => (handler.all ? handler.all(params) : rows([])),
        run: async () => (handler.run ? handler.run(params) : ok())
      };
    }
    throw new Error('fake-d1: нет обработчика для запроса → ' + query);
  }

  const DB = {
    prepare: (sql) => ({
      bind: (...params) => run(sql, params),
      first: () => run(sql, []).first(),
      all: () => run(sql, []).all(),
      run: () => run(sql, []).run()
    })
  };

  /* ---------- удобства для тестов ---------- */
  const _db = {
    raw: db,
    leads: db.leads,
    users: db.users,
    settings: db.settings,
    addLead,
    lastLead: () => (db.leads.length ? parseRow(db.leads[db.leads.length - 1]) : null),
    leadById: (id) => parseRow(db.leads.find((row) => row.id === id) || null),
    state: (telegramId) => {
      const row = db.states.get(telegramId);
      if (!row) return null;
      let temp = {};
      try { temp = JSON.parse(row.temp_data || '{}'); } catch { temp = {}; }
      return { step: row.step, temp };
    },
    countLeads: (filters = {}) => filterRows(filters).length
  };

  return { DB, _db };
}
