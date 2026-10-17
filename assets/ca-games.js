/* ==========================================================
   Compass Arena — реестр дисциплин
   ----------------------------------------------------------
   Единственное место, где описаны игры турнира: название, размер
   состава, формат матчей и тема оформления. Сайт, админка и тесты
   читают отсюда; список id продублирован в functions/_lib/games.js
   (сервер не умеет подключать этот файл) — тест следит за совпадением.

   Dota 2 — основная дисциплина: её данные лежат в старом ключе KV
   `tournament`, остальные — в `tournament:<id>`.
   ========================================================== */
(function (global) {
  'use strict';

  var CA = global.CA = global.CA || {};
  var DEFAULT = 'dota2';

  /* theme: --gold* — акцент (в Dota это фирменное золото), rgb — для полупрозрачных заливок */
  var LIST = [
    {
      id: 'dota2', name: 'Dota 2', short: 'Dota 2', teamSize: 5, unit: 'team', matchFormat: 'Bo3',
      tagline: 'Основная дисциплина', owner: 'Valve Corporation',
      theme: { accent: '#c9a35a', hi: '#ecd6a3', lo: '#8c6f39', rgb: '201, 163, 90', tint: '#0b0d12' }
    },
    {
      id: 'csgo', name: 'CS:GO', short: 'CS:GO', teamSize: 5, unit: 'team', matchFormat: 'Bo3',
      tagline: 'Пять на пять', owner: 'Valve Corporation',
      theme: { accent: '#e07a3a', hi: '#f7c49b', lo: '#9a4f1f', rgb: '224, 122, 58', tint: '#0e0d0c' }
    },
    {
      id: 'clash', name: 'Clash Royale', short: 'Clash Royale', teamSize: 1, unit: 'player', matchFormat: 'Bo3',
      tagline: 'Дуэли 1 на 1', owner: 'Supercell',
      theme: { accent: '#4d8dff', hi: '#b9d0ff', lo: '#2c57b3', rgb: '77, 141, 255', tint: '#090c14' }
    },
    {
      id: 'brawl', name: 'Brawl Stars', short: 'Brawl Stars', teamSize: 3, unit: 'team', matchFormat: 'Bo3',
      tagline: 'Три на три', owner: 'Supercell',
      theme: { accent: '#c15cff', hi: '#e6c4ff', lo: '#7d3bb8', rgb: '193, 92, 255', tint: '#0d0a14' }
    }
  ];

  var BY_ID = {};
  LIST.forEach(function (g) { BY_ID[g.id] = g; });

  function isGame(id) { return Object.prototype.hasOwnProperty.call(BY_ID, String(id)); }
  function get(id) { return BY_ID[isGame(id) ? String(id) : DEFAULT]; }

  /** Игра из адреса: ?game=csgo или #csgo; иначе основная (Dota 2) */
  function fromUrl(loc) {
    loc = loc || (global.location || {});
    var m = /[?&]game=([a-z0-9]+)/i.exec(loc.search || '');
    if (m && isGame(m[1].toLowerCase())) return m[1].toLowerCase();
    var h = String(loc.hash || '').replace(/^#/, '').toLowerCase();
    return isGame(h) ? h : DEFAULT;
  }

  /** Подписи «команда / игрок» с учётом формата дисциплины */
  function words(id) {
    var g = get(id);
    return g.unit === 'player'
      ? { one: 'игрок', many: 'игроков', participants: 'Игроки', participant: 'игрок' }
      : { one: 'команда', many: 'команд', participants: 'Участники', participant: 'команда' };
  }

  /** Включает тему игры: data-game на <html> + переменные цвета */
  function applyTheme(id) {
    var doc = global.document;
    if (!doc || !doc.documentElement) return;
    var g = get(id);
    var root = doc.documentElement;
    root.setAttribute('data-game', g.id);
    var s = root.style;
    s.setProperty('--gold', g.theme.accent);
    s.setProperty('--gold-hi', g.theme.hi);
    s.setProperty('--gold-lo', g.theme.lo);
    s.setProperty('--gold-rgb', g.theme.rgb);
    s.setProperty('--game-tint', g.theme.tint);
  }

  /* Значки дисциплин — собственные простые знаки, не логотипы игр */
  var GLYPHS = {
    dota2: '<path d="M12 2.5l8 4.5v10l-8 4.5-8-4.5V7z"/><path d="M8.5 15.5l7-7M13.5 8.5h2v2"/>',
    csgo: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
    clash: '<path d="M4 18h16l1.5-10-5 4L12 5 7.5 12l-5-4z"/><path d="M5.5 21h13"/>',
    brawl: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5l-5.4 3 1.2-6-4.5-4.2 6.1-.7z"/>'
  };
  function glyph(id) {
    return '<svg class="ic game-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (GLYPHS[get(id).id] || '') + '</svg>';
  }

  /** «5×5», «1×1», «3×3» */
  function sizeLabel(id) { var n = get(id).teamSize; return n + '×' + n; }

  CA.games = {
    DEFAULT: DEFAULT,
    list: LIST,
    ids: LIST.map(function (g) { return g.id; }),
    isGame: isGame,
    get: get,
    fromUrl: fromUrl,
    words: words,
    glyph: glyph,
    sizeLabel: sizeLabel,
    applyTheme: applyTheme
  };
})(typeof window !== 'undefined' ? window : globalThis);
