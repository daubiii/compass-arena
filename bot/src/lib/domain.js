/* ============================================================
   Предметная область: дисциплины и роли
   ------------------------------------------------------------
   Дисциплины: dota2 | csgo | clash | brawl (ключи совпадают с полем discipline в БД).
   Роль хранится ключом (для callback_data) и раскладывается
   в JSON как role (число 1..5) + roleLabel (строка) — формат,
   который понимает админка сайта.
   ============================================================ */

export const DISCIPLINES = {
  dota2: {
    key: 'dota2',
    label: 'Dota 2',
    emoji: '🎯',
    game: 'Dota 2',
    roles: [
      { key: '1', num: 1, label: 'Керри', title: '1 — Керри' },
      { key: '2', num: 2, label: 'Мидер', title: '2 — Мидер' },
      { key: '3', num: 3, label: 'Офлейн', title: '3 — Офлейн' },
      { key: '4', num: 4, label: 'Саппорт 4', title: '4 — Саппорт 4' },
      { key: '5', num: 5, label: 'Саппорт 5', title: '5 — Саппорт 5' }
    ]
  },
  csgo: {
    key: 'csgo',
    label: 'CS:GO',
    emoji: '🔫',
    game: 'CS:GO',
    roles: [
      { key: 'IGL', num: 1, label: 'IGL', title: 'IGL — Капитан' },
      { key: 'AWP', num: 2, label: 'AWPer', title: 'AWPer — Снайпер' },
      { key: 'ENT', num: 3, label: 'Entry', title: 'Entry — Врывающийся' },
      { key: 'SUP', num: 4, label: 'Support', title: 'Support — Поддержка' },
      { key: 'LUR', num: 5, label: 'Lurker', title: 'Lurker — Луркер' }
    ]
  }
};

/* Дисциплины без ролей: Clash Royale (1×1) и Brawl Stars (3×3).
   Роль в JSON — просто номер слота (1..teamSize) и подпись «Игрок». */
DISCIPLINES.dota2.teamSize = 5;
DISCIPLINES.csgo.teamSize = 5;
/* Роли (керри, мидер…) — только у Dota 2. В CS:GO состав — просто список из пяти. */
DISCIPLINES.csgo.noRoles = true;
DISCIPLINES.csgo.roles = [{ key: 'P', num: 1, label: 'Игрок', title: 'Игрок' }];
DISCIPLINES.clash = {
  key: 'clash', label: 'Clash Royale', emoji: '👑', game: 'Clash Royale', teamSize: 1, noRoles: true, solo: true, unit: 'player',
  roles: [{ key: 'P', num: 1, label: 'Игрок', title: 'Игрок' }]
};
DISCIPLINES.brawl = {
  key: 'brawl', label: 'Brawl Stars', emoji: '💥', game: 'Brawl Stars', teamSize: 3, noRoles: true, unit: 'team',
  roles: [{ key: 'P', num: 1, label: 'Игрок', title: 'Игрок' }]
};

export const DISCIPLINE_KEYS = Object.keys(DISCIPLINES);

export function isDiscipline(key) {
  return Object.prototype.hasOwnProperty.call(DISCIPLINES, String(key || ''));
}

/** 'dota2' → 'Dota 2' */
export function disciplineLabel(key) {
  return isDiscipline(key) ? DISCIPLINES[key].label : String(key || '—');
}

/** Название игры для экспорта: 'dota2' → 'Dota 2' */
export function disciplineGame(key) {
  return isDiscipline(key) ? DISCIPLINES[key].game : String(key || '');
}

/** «Dota 2, CS:GO» — для справок и сообщений */
export function disciplinesListLabel() {
  return DISCIPLINE_KEYS.map((key) => DISCIPLINES[key].label).join(', ');
}

/** Сколько игроков в составе */
export function teamSizeOf(key) {
  return isDiscipline(key) ? DISCIPLINES[key].teamSize : 5;
}

/** Есть ли в дисциплине выбор роли */
export function isSolo(key) {
  return isDiscipline(key) && Boolean(DISCIPLINES[key].solo);
}

export function hasRoles(key) {
  return isDiscipline(key) && !DISCIPLINES[key].noRoles;
}

/** Роль-заглушка для дисциплин без ролей: слот index (с нуля) */
export function soloRole(key, index) {
  return { key: 'P', num: (Number(index) || 0) + 1, label: 'Игрок', title: 'Игрок' };
}

/** Короткая подпись формата: «5×5», «1×1», «3×3» */
export function sizeLabel(key) {
  const n = teamSizeOf(key);
  return n + '×' + n;
}

/** Список ролей дисциплины */
export function rolesOf(key) {
  return isDiscipline(key) ? DISCIPLINES[key].roles : [];
}

/** Роль по ключу кнопки: roleByKey('dota2', '3') → { key, num, label } */
export function roleByKey(key, roleKey) {
  return rolesOf(key).find((role) => role.key === String(roleKey)) || null;
}

/** Короткая подпись роли для JSON: 'IGL', 'Керри' */
export function roleLabel(key, roleKey) {
  const role = roleByKey(key, roleKey);
  return role ? role.label : String(roleKey || '');
}

/** Полная подпись роли для интерфейса: 'IGL — Капитан' */
export function roleTitle(key, roleKey) {
  const role = roleByKey(key, roleKey);
  return role ? role.title : String(roleKey || '');
}

/** Числовой номер роли 1..5 (поле role в JSON сайта) */
export function roleNum(key, roleKey) {
  const role = roleByKey(key, roleKey);
  return role ? role.num : 0;
}

/** Типы заявок */
export const LEAD_TYPES = {
  TEAM: 'team',
  FREE_AGENT: 'free_agent',
  PLAYER: 'player'
};

export function leadTypeLabel(type) {
  if (type === LEAD_TYPES.TEAM) return 'Команда';
  if (type === LEAD_TYPES.FREE_AGENT) return 'Ищет команду';
  if (type === LEAD_TYPES.PLAYER) return 'Заявка игрока';
  return String(type || '—');
}

export function leadStatusLabel(status) {
  if (status === 'pending') return 'на модерации';
  if (status === 'approved') return 'одобрена';
  if (status === 'rejected') return 'отклонена';
  if (status === 'withdrawn') return 'отозвана';
  return String(status || '—');
}

/** Значок статуса заявки */
export function leadStatusIcon(status) {
  if (status === 'pending') return '⏳';
  if (status === 'approved') return '✅';
  if (status === 'rejected') return '❌';
  if (status === 'withdrawn') return '↩️';
  return '•';
}
