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
      id: 'dota2', name: 'Dota 2', short: 'Dota 2', teamSize: 5, unit: 'team', roles: true, matchFormat: 'Bo3',
      tagline: 'Основная дисциплина', owner: 'Valve Corporation',
      theme: { accent: '#c9a35a', hi: '#ecd6a3', lo: '#8c6f39', rgb: '201, 163, 90', tint: '#0b0d12' }
    },
    {
      id: 'csgo', name: 'CS:GO', short: 'CS:GO', teamSize: 5, unit: 'team', matchFormat: 'Bo3',
      tagline: 'Пять на пять', owner: 'Valve Corporation',
      theme: { accent: '#e07a3a', hi: '#f7c49b', lo: '#9a4f1f', rgb: '224, 122, 58', tint: '#0e0d0c' }
    },
    {
      id: 'clash', name: 'Clash Royale', short: 'Clash Royale', teamSize: 1, unit: 'player', solo: true, matchFormat: 'Bo3',
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

  /* Значки дисциплин — свои простые силуэты (предмет игры), не логотипы.
     Тот же знак — иконка в переключателе и большой фон секции турнира. */
  var GLYPHS = {
    /* меч: клинок, гарда, рукоять и навершие; повёрнут остриём вправо-вверх */
    dota2: '<g transform="rotate(45 12 12)"><path d="M12 1.6l2.7 3.4v8.4H9.3V5z"/><rect x="5.6" y="13.4" width="12.8" height="2.4" rx="1.2"/><rect x="10.5" y="15.8" width="3" height="4.1" rx=".6"/><circle cx="12" cy="21.2" r="1.7"/></g>',
    /* пистолет */
    csgo: '<path d="M2.4 6.8h16.6l2.6 2.5v3.2h-8.4l-1.2 1.5H10l1 6.2a1 1 0 0 1-1 1.2H7a1 1 0 0 1-1-.9l-1.2-6.5H2.4z"/>',
    /* корона */
    clash: '<path d="M2.4 7.2l5 3.9L12 3.6l4.6 7.5 5-3.9-1 11.1H3.4z"/><rect x="3.4" y="19.8" width="17.2" height="2.2" rx="1.1"/>',
    /* звезда */
    brawl: '<path d="M12 1.8l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 16.9l-6 3.3 1.3-6.7-5-4.7 6.8-.8z"/>'
  };
  function glyph(id) {
    return '<svg class="ic game-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
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
