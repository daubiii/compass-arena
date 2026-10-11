/* ============================================================
   Патч админки: вкладка «Сетка» (универсальная сетка)
   ------------------------------------------------------------
   Добавляет кнопку вкладки, разметку вкладки и весь клиентский
   код: загрузка файла команд от бота, посев драг-н-дропом,
   генерация через CA.brackets, сохранение в KV и превью.

   Запуск: node scripts/patch-admin-brackets.mjs
   Идемпотентно: повторный запуск ничего не дублирует.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'poasalj1.z23.html');
let html = fs.readFileSync(file, 'utf8');

const TAB_BUTTON = '        <button class="tab" data-tab="brackets">🧩 Сетка</button>';
const ANCHOR_TAB = '        <button class="tab" data-tab="import">';
const MARK_START = '<!-- ===== ВКЛАДКА «СЕТКА» (добавлено скриптом patch-admin-brackets.mjs) ===== -->';
const MARK_END = '<!-- ===== /ВКЛАДКА «СЕТКА» ===== -->';

function insertOnce(source, marker, payload, before) {
  if (source.includes(marker)) return { text: source, added: false };
  const index = source.indexOf(before);
  if (index < 0) throw new Error('не найден якорь: ' + before.slice(0, 60));
  return { text: source.slice(0, index) + payload + source.slice(index), added: true };
}

/* ---------- 1. Кнопка вкладки ---------- */
{
  const res = insertOnce(html, 'data-tab="brackets"', TAB_BUTTON + '\n', ANCHOR_TAB);
  html = res.text;
  console.log(res.added ? '✓ кнопка вкладки добавлена' : '• кнопка вкладки уже есть');
}

/* ---------- 2. Разметка вкладки ---------- */
const TAB_HTML = `${MARK_START}
    <div class="tab-content" id="tab-brackets">
        <div class="card">
            <div class="card-header">
                <h3>🧩 Универсальная сетка</h3>
                <span id="bkStatus" style="color:#5f6773;font-size:12px;">сетка не сгенерирована</span>
            </div>
            <p class="hint">
                Загрузите файл команд от Telegram-бота (<code>teams_ГГГГ-ММ-ДД_*.json</code>), выберите формат
                и расставьте посев — кнопка «Сгенерировать» построит сетку со всеми связями
                (кто играет в следующем раунде и куда падает проигравший в double elimination).
                Текущая сетка на главной странице (вкладка «Матчи») при этом не трогается.
            </p>
            <div class="btn-group" style="margin:10px 0;">
                <button class="btn btn-primary" onclick="document.getElementById('bkFileInput').click()">📁 Загрузить файл команд</button>
                <input type="file" id="bkFileInput" accept="application/json,.json" style="display:none" onchange="bkOnFileChosen(event)">
                <button class="btn" onclick="bkUseCurrentTeams()">👥 Взять команды из админки</button>
            </div>
            <div id="bkFileStatus" class="archive-status neutral"></div>
        </div>

        <div class="card">
            <div class="card-header"><h3>⚙️ Формат турнира</h3></div>
            <div class="bk-form">
                <label>Тип сетки
                    <select id="bkType" onchange="bkSyncForm()">
                        <option value="single_elimination">Single Elimination (олимпийка)</option>
                        <option value="double_elimination">Double Elimination (с нижней сеткой)</option>
                    </select>
                </label>
                <label>Формат матча
                    <select id="bkMatchType">
                        <option value="Bo1">Bo1</option>
                        <option value="Bo3" selected>Bo3</option>
                        <option value="Bo5">Bo5</option>
                    </select>
                </label>
                <label id="bkGrandFinalWrap" hidden>Гранд-финал
                    <select id="bkGrandFinal">
                        <option value="simple">Один матч</option>
                        <option value="double">До двух поражений (сброс)</option>
                    </select>
                </label>
                <label id="bkThirdWrap">Матч за 3-е место
                    <input type="checkbox" id="bkThirdPlace">
                </label>
            </div>
            <p class="hint" id="bkSizeHint"></p>
        </div>

        <div class="card">
            <div class="card-header">
                <h3>🎲 Посев</h3>
                <span id="bkSeedCount" style="color:#5f6773;font-size:12px;">0 команд</span>
            </div>
            <p class="hint">Перетаскивайте команды, чтобы изменить порядок: первая строка — первый сеяный. Порядок уходит в генератор как есть.</p>
            <ul class="bk-seed" id="bkSeedList"></ul>
            <div class="btn-group" style="margin-top:14px;">
                <button class="btn btn-primary" id="bkGenerate" onclick="bkGenerate()">✨ Сгенерировать сетку</button>
                <button class="btn" onclick="bkReset()">🗑 Сбросить сетку</button>
            </div>
        </div>

        <div class="card">
            <div class="card-header"><h3>👀 Превью</h3><span id="bkPreviewInfo" style="color:#5f6773;font-size:12px;"></span></div>
            <div id="bkPreviewEmpty" class="hint">Пока нечего показывать — сгенерируйте сетку или посмотрите сохранённую.</div>
            <div id="bkPreviewScroll" class="bk-preview" hidden>
                <div id="bkPreview" class="brackets-viewer"></div>
            </div>
        </div>
    </div>
${MARK_END}
`;

{
  const anchor = '<div class="tab-content" id="tab-agents">';
  const res = insertOnce(html, MARK_START, TAB_HTML, anchor);
  html = res.text;
  console.log(res.added ? '✓ разметка вкладки добавлена' : '• разметка вкладки уже есть');
}

/* ---------- 3. Клиентский код ---------- */
const MARK_JS_START = '/* ===== ВКЛАДКА «СЕТКА» (добавлено скриптом patch-admin-brackets.mjs) ===== */';
const MARK_JS_END = '/* ===== /ВКЛАДКА «СЕТКА» ===== */';

const JS = `${MARK_JS_START}
/* ---------- Состояние вкладки «Сетка» ---------- */
var BK_TEAMS = [];          /* [{name, logo, players}] — команды для генерации */
var BK_DATA = null;         /* структура сетки от brackets-manager */
var BK_META = null;         /* метаданные сетки */
var BK_DRAG = null;         /* индекс перетаскиваемой строки посева */

function bkEsc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

/** «Слот 1» — заглушка черновика, командой не считается */
function bkIsSlot(name) {
    var value = String(name || '').trim().toLowerCase();
    if (value.indexOf('слот ') !== 0) return false;
    var rest = value.slice(5).trim();
    return rest.length > 0 && String(Number(rest)) === rest;
}

function bkStatus(text, cls) {
    var box = document.getElementById('bkStatus');
    if (box) box.textContent = text || '';
    var file = document.getElementById('bkFileStatus');
    if (file && cls !== undefined) file.className = 'archive-status ' + (cls || 'neutral');
}

function bkFileNote(text, cls) {
    var box = document.getElementById('bkFileStatus');
    if (!box) return;
    box.className = 'archive-status ' + (cls || 'neutral');
    box.innerHTML = '<div class="as-text">' + text + '</div>';
}

/* ---------- Загрузка команд ---------- */

function bkOnFileChosen(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
        var doc = null;
        try { doc = JSON.parse(String(reader.result)); } catch (e) {
            bkFileNote('❌ Файл повреждён: не удалось прочитать JSON.', 'error');
            return;
        }
        bkAcceptTeams(doc, file.name);
    };
    reader.readAsText(file);
    event.target.value = '';
}

/** Понимает и файл бота (type: teams), и просто массив команд */
function bkAcceptTeams(doc, label) {
    var list = null;
    if (Array.isArray(doc)) list = doc;
    else if (doc && Array.isArray(doc.teams)) list = doc.teams;
    if (!list || !list.length) {
        bkFileNote('❌ В файле нет списка команд (ожидается поле <code>teams</code>).', 'error');
        return;
    }

    var cleaned = [];
    for (var i = 0; i < list.length; i++) {
        var team = list[i] || {};
        var name = String(team.name || '').trim();
        /* Слоты «Слот 1» из черновика командами не считаем */
        if (!name || bkIsSlot(name)) continue;
        cleaned.push({
            name: name,
            logo: team.logo || '',
            players: Array.isArray(team.players) ? team.players : []
        });
    }

    if (!cleaned.length) {
        bkFileNote('⚠️ В файле только заглушки «Слот N» — регистрируйте команды через бота.', 'warn');
        return;
    }

    BK_TEAMS = cleaned;
    bkRenderSeed();
    bkFileNote('✅ ' + (label ? '<b>' + bkEsc(label) + '</b>: ' : '') + 'загружено команд — ' + cleaned.length +
        (doc && doc.tournament && doc.tournament.name ? ' · турнир «' + bkEsc(doc.tournament.name) + '»' : ''), 'ok');

    /* Подставляем формат из файла настроек/турнира, если он есть */
    var t = doc && doc.tournament;
    if (t) {
        if (t.matches && document.getElementById('bkMatchType')) {
            var sel = document.getElementById('bkMatchType');
            for (var k = 0; k < sel.options.length; k++) if (sel.options[k].value === t.matches) sel.value = t.matches;
        }
        if (t.format && document.getElementById('bkType')) {
            var typeSel = document.getElementById('bkType');
            var guess = /double/i.test(String(t.format)) ? 'double_elimination' : 'single_elimination';
            typeSel.value = guess;
        }
        bkSyncForm();
    }
}

/** Берём команды из основной админки: слоты пропускаем */
function bkUseCurrentTeams() {
    var teams = (DATA && Array.isArray(DATA.teams)) ? DATA.teams : [];
    var cleaned = [];
    for (var i = 0; i < teams.length; i++) {
        var name = String(teams[i].name || '').trim();
        if (!name || bkIsSlot(name)) continue;
        cleaned.push({ name: name, logo: teams[i].logo || '', players: teams[i].players || [] });
    }
    if (!cleaned.length) {
        bkFileNote('⚠️ В админке пока нет зарегистрированных команд (только слоты).', 'warn');
        return;
    }
    BK_TEAMS = cleaned;
    bkRenderSeed();
    bkFileNote('✅ Взято из админки команд — ' + cleaned.length, 'ok');
}

/* ---------- Посев (драг-н-дроп) ---------- */

function bkRenderSeed() {
    var list = document.getElementById('bkSeedList');
    var count = document.getElementById('bkSeedCount');
    if (!list) return;
    if (count) count.textContent = BK_TEAMS.length + ' ' + (BK_TEAMS.length === 1 ? 'команда' : (BK_TEAMS.length < 5 ? 'команды' : 'команд'));
    list.innerHTML = '';

    BK_TEAMS.forEach(function (team, index) {
        var li = document.createElement('li');
        li.className = 'bk-seed-item';
        li.draggable = true;
        li.setAttribute('data-index', String(index));
        li.innerHTML =
            '<span class="bk-seed-no">' + (index + 1) + '</span>' +
            '<span class="bk-seed-logo">' + (team.logo ? '<img src="' + bkEsc(team.logo) + '" alt="">' : '') + '</span>' +
            '<span class="bk-seed-name">' + bkEsc(team.name) + '</span>' +
            '<span class="bk-seed-players">' + (team.players || []).map(function (p) {
                return bkEsc(typeof p === 'string' ? p : (p.nick || ''));
            }).filter(Boolean).join(' · ') + '</span>' +
            '<span class="bk-seed-handle" title="Перетащить">⠿</span>';
        list.appendChild(li);
    });

    bkSyncForm();
}

function bkSyncForm() {
    var typeEl = document.getElementById('bkType');
    var third = document.getElementById('bkThirdWrap');
    var gf = document.getElementById('bkGrandFinalWrap');
    var de = typeEl && typeEl.value === 'double_elimination';
    if (third) third.hidden = !!de;
    if (gf) gf.hidden = !de;

    var hint = document.getElementById('bkSizeHint');
    if (hint) {
        var n = BK_TEAMS.length;
        if (!n) {
            hint.textContent = 'Сначала загрузите команды.';
        } else {
            var size = bkNextPow2(n);
            var byes = size - n;
            hint.textContent = 'Команд: ' + n + ' · размер сетки: ' + size +
                (byes ? ' · BYE (проходят без игры): ' + byes : ' · BYE нет');
        }
    }
}

function bkNextPow2(n) {
    var size = 1;
    while (size < Math.max(1, Number(n) || 0)) size *= 2;
    return size;
}

function bkMove(from, to) {
    if (from === to || from < 0 || to < 0 || from >= BK_TEAMS.length || to >= BK_TEAMS.length) return;
    var moved = BK_TEAMS.splice(from, 1)[0];
    BK_TEAMS.splice(to, 0, moved);
    bkRenderSeed();
}

/* ---------- Генерация ---------- */

function bkForm() {
    var typeEl = document.getElementById('bkType');
    var matchEl = document.getElementById('bkMatchType');
    var thirdEl = document.getElementById('bkThirdPlace');
    var gfEl = document.getElementById('bkGrandFinal');
    return {
        name: (DATA && DATA.tournament && DATA.tournament.name) || 'Compass Arena',
        type: (typeEl && typeEl.value) || 'single_elimination',
        matchType: (matchEl && matchEl.value) || 'Bo3',
        thirdPlace: !!(thirdEl && thirdEl.checked),
        grandFinal: (gfEl && gfEl.value) || 'simple',
        teams: BK_TEAMS
    };
}

function bkGenerate() {
    if (!BK_TEAMS.length) {
        showToast('⚠️ Сначала загрузите команды');
        return;
    }
    if (BK_TEAMS.length < 2) {
        showToast('⚠️ Для сетки нужно минимум две команды');
        return;
    }
    if (!window.CA || !CA.brackets) {
        showToast('⚠️ Модуль сетки не загрузился — обновите страницу');
        return;
    }

    var btn = document.getElementById('bkGenerate');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерирую…'; }
    var form = bkForm();

    CA.brackets.ensureLibrary()
        .then(function () {
            var input = CA.brackets.buildStageInput(form, 1);
            return window.bracketsManager.create.stage(input).then(function (stage) {
                return window.bracketsManager.get.tournamentData(input.tournamentId).then(function (raw) {
                    return CA.brackets.toViewerData(raw, stage);
                });
            });
        })
        .then(function (view) {
            BK_DATA = {
                stages: view.stages,
                matches: view.matches,
                matchGames: view.matchGames,
                participants: view.participants
            };
            BK_META = {
                name: form.name,
                type: form.type,
                matchType: form.matchType,
                grandFinal: form.type === 'double_elimination' ? form.grandFinal : null,
                thirdPlace: form.type === 'single_elimination' ? form.thirdPlace : false,
                teamCount: BK_TEAMS.length,
                bracketSize: CA.brackets.nextPowerOfTwo(BK_TEAMS.length),
                savedAt: new Date().toISOString(),
                teams: BK_TEAMS.map(function (team) {
                    return { name: team.name, logo: team.logo || '', players: team.players || [] };
                })
            };
            return bkSaveBrackets(BK_DATA, BK_META);
        })
        .then(function () {
            bkPreview(BK_DATA, BK_META);
            bkStatus('сгенерирована: ' + (BK_META.matchType || '') + ' · команд ' + BK_TEAMS.length);
            showToast('✅ Сетка сгенерирована и сохранена');
        })
        .catch(function (err) {
            console.error('[admin] генерация сетки:', err);
            showToast('⚠️ Не удалось сгенерировать: ' + (err && err.message ? err.message : 'ошибка'));
        })
        .then(function () {
            if (btn) { btn.disabled = false; btn.textContent = '✨ Сгенерировать сетку'; }
        });
}

/** Сохраняет сетку и метаданные в KV (остальные данные не трогаем) */
function bkSaveBrackets(data, meta) {
    var payload = Object.assign({}, DATA, {
        history: HISTORY,
        brackets: data || null,
        bracketsMeta: meta || null,
        clearBrackets: !data
    });
    return fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ensurePassword(), data: payload })
    }).then(function (res) {
        if (res.status === 403) { ADMIN_PW = null; throw new Error('неверный пароль'); }
        if (res.status === 413) return res.text().then(function (msg) { throw new Error(msg); });
        if (!res.ok) throw new Error('save failed: ' + res.status);
        return res.json().catch(function () { return {}; });
    });
}

function bkReset() {
    if (!confirm('🗑 Сбросить сетку? Текущая сетка на главной странице (вкладка «Матчи») останется нетронутой.')) return;
    bkSaveBrackets(null, null).then(function () {
        BK_DATA = null; BK_META = null;
        var empty = document.getElementById('bkPreviewEmpty');
        var scroll = document.getElementById('bkPreviewScroll');
        if (empty) empty.hidden = false;
        if (scroll) scroll.hidden = true;
        bkStatus('сетка не сгенерирована');
        showToast('🗑 Сетка сброшена');
    }).catch(function (err) {
        console.error('[admin] сброс сетки:', err);
        showToast('⚠️ Не удалось сбросить: ' + (err && err.message ? err.message : 'ошибка'));
    });
}

/* ---------- Превью ---------- */

function bkPreview(data, meta) {
    var empty = document.getElementById('bkPreviewEmpty');
    var scroll = document.getElementById('bkPreviewScroll');
    var info = document.getElementById('bkPreviewInfo');
    if (!data || !data.matches || !data.matches.length) {
        if (empty) empty.hidden = false;
        if (scroll) scroll.hidden = true;
        return;
    }
    if (empty) empty.hidden = true;
    if (scroll) scroll.hidden = false;
    if (info) {
        info.textContent = (meta && meta.matchType ? meta.matchType + ' · ' : '') +
            'матчей: ' + data.matches.length + ' · участников: ' + (data.participants || []).length;
    }
    CA.brackets.render('#bkPreview', data, {
        meta: meta,
        onMatchClick: function (match) {
            var o1 = match.opponent1 || {}, o2 = match.opponent2 || {};
            var name = function (opp) {
                if (!opp || opp.id === null || opp.id === undefined) return 'TBD';
                var found = (data.participants || []).filter(function (p) { return p.id === opp.id; })[0];
                return found ? found.name : ('#' + opp.id);
            };
            alert('Матч #' + match.id + '\\n' + name(o1) + ' — ' + name(o2) +
                '\\nСчёт: ' + (o1.score === undefined ? '—' : o1.score) + ' : ' + (o2.score === undefined ? '—' : o2.score));
        }
    }).catch(function (err) {
        console.warn('[admin] превью не отрисовалось:', err);
        if (empty) { empty.hidden = false; empty.textContent = 'Превью не отрисовалось: ' + (err && err.message ? err.message : 'ошибка'); }
        if (scroll) scroll.hidden = true;
    });
}

/** Вызывается при открытии вкладки: подтягиваем сохранённую сетку */
function bkInit() {
    bkSyncForm();
    if (BK_DATA) { bkPreview(BK_DATA, BK_META); return; }
    fetch('/api/data?light=1', { cache: 'no-store' })
        .then(function (res) { return res.json(); })
        .then(function (raw) {
            if (raw && raw.brackets) {
                BK_DATA = raw.brackets;
                BK_META = raw.bracketsMeta || null;
                bkPreview(BK_DATA, BK_META);
                bkStatus('сохранена: ' + ((BK_META && BK_META.matchType) || '') + ' · команд ' + ((BK_META && BK_META.teamCount) || '—'));
            }
        })
        .catch(function () { /* нет сети — не страшно */ });
}

/* Драг-н-дроп посева */
document.addEventListener('dragstart', function (e) {
    var item = e.target.closest && e.target.closest('.bk-seed-item');
    if (!item) return;
    BK_DRAG = Number(item.getAttribute('data-index'));
    item.classList.add('is-dragging');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragend', function (e) {
    var item = e.target.closest && e.target.closest('.bk-seed-item');
    if (item) item.classList.remove('is-dragging');
    var list = document.getElementById('bkSeedList');
    if (list) Array.prototype.forEach.call(list.children, function (li) { li.classList.remove('is-over'); });
});
document.addEventListener('dragover', function (e) {
    var item = e.target.closest && e.target.closest('.bk-seed-item');
    if (!item || BK_DRAG === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    item.classList.add('is-over');
});
document.addEventListener('dragleave', function (e) {
    var item = e.target.closest && e.target.closest('.bk-seed-item');
    if (item) item.classList.remove('is-over');
});
document.addEventListener('drop', function (e) {
    var item = e.target.closest && e.target.closest('.bk-seed-item');
    if (!item || BK_DRAG === null) return;
    e.preventDefault();
    item.classList.remove('is-over');
    bkMove(BK_DRAG, Number(item.getAttribute('data-index')));
    BK_DRAG = null;
});
${MARK_JS_END}
`;

{
  const anchor = 'function switchTab(name) {';
  const res = insertOnce(html, MARK_JS_START, JS + '\n', anchor);
  html = res.text;
  console.log(res.added ? '✓ клиентский код добавлен' : '• клиентский код уже есть');
}

/* ---------- 4. Хук на открытие вкладки ---------- */
{
  const hook = `
/* Открытие вкладки «Сетка» подтягивает сохранённую сетку и обновляет подсказки */
(function () {
    var tab = document.querySelector('.tab[data-tab="brackets"]');
    if (tab) tab.addEventListener('click', function () { if (typeof bkInit === 'function') bkInit(); });
})();
`;
  if (!html.includes('bkInit(); });')) {
    const anchor = 'function switchTab(name) {';
    const index = html.indexOf(anchor);
    if (index < 0) throw new Error('не найден switchTab для хука вкладки');
    html = html.slice(0, index) + hook + '\n' + html.slice(index);
    console.log('✓ хук открытия вкладки добавлен');
  } else {
    console.log('• хук открытия вкладки уже есть');
  }
}

/* ---------- 5. Стили вкладки ---------- */
const STYLE_MARK = '/* ===== СТИЛИ ВКЛАДКИ «СЕТКА» ===== */';
if (!html.includes(STYLE_MARK)) {
  const css = `${STYLE_MARK}
    .bk-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px 18px; }
    .bk-form label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #9aa3af; }
    .bk-form label[hidden] { display: none; }
    .bk-form select, .bk-form input[type="checkbox"] { align-self: flex-start; }
    .bk-form input[type="checkbox"] { width: 18px; height: 18px; }
    .bk-seed { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .bk-seed-item {
        display: grid; grid-template-columns: 34px 34px 1fr 1.4fr 24px; align-items: center; gap: 10px;
        padding: 9px 12px; border: 1px solid #232a36; border-radius: 10px; background: #131822;
        cursor: grab; transition: border-color .15s, background .15s;
    }
    .bk-seed-item.is-dragging { opacity: .5; }
    .bk-seed-item.is-over { border-color: #c9a35a; background: #1b2130; }
    .bk-seed-no { font-variant-numeric: tabular-nums; color: #c9a35a; font-weight: 600; }
    .bk-seed-logo img { width: 28px; height: 28px; object-fit: cover; border-radius: 6px; }
    .bk-seed-name { font-weight: 500; }
    .bk-seed-players { color: #6f7885; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bk-seed-handle { color: #4b5563; text-align: center; }
    .bk-preview { overflow-x: auto; overflow-y: hidden; margin-top: 12px; padding-bottom: 6px; }
    .bk-preview .brackets-viewer {
        --primary-background: transparent; --secondary-background: rgba(255,255,255,.04);
        --match-background: #111721; --font-color: #e8e8ea; --win-color: #e3c48a; --loss-color: #6b7280;
        --label-color: #c9a35a; --hint-color: #7c8797; --connector-color: rgba(201,163,90,.45);
        --border-color: #2a3444; --border-hover-color: #c9a35a; --border-selected-color: #e3c48a;
        --match-width: 180px; --round-margin: 42px; --match-border-radius: 8px; --participant-image-size: 1.1em;
    }
    .bk-preview .brackets-viewer h1, .bk-preview .brackets-viewer h2 { font-family: inherit; color: #e3c48a; }
    .bk-preview .brackets-viewer h3 { color: #7c8797; text-transform: uppercase; letter-spacing: .05em; }
`;
  const anchor = '</style>';
  const index = html.indexOf(anchor);
  if (index < 0) throw new Error('не найден </style> для стилей вкладки');
  html = html.slice(0, index) + css + html.slice(index);
  console.log('✓ стили вкладки добавлены');
} else {
  console.log('• стили вкладки уже есть');
}

/* ---------- 6. Подключение скриптов сетки к админке ---------- */
{
  const cssLink = '<link rel="stylesheet" href="/vendor/brackets-viewer.min.css">';
  if (!html.includes(cssLink)) {
    const head = html.indexOf('</head>');
    if (head < 0) throw new Error('не найден </head>');
    html = html.slice(0, head) + cssLink + '\n' + html.slice(head);
    console.log('✓ стили библиотеки сетки подключены');
  } else {
    console.log('• стили библиотеки сетки уже подключены');
  }

  const scriptTag = '<script src="/assets/ca-brackets.js"></script>';
  if (!html.includes(scriptTag)) {
    const body = html.lastIndexOf('</body>');
    if (body < 0) throw new Error('не найден </body>');
    html = html.slice(0, body) +
      '<script src="/assets/ca-brackets.js"></script>\n' +
      '<script>if (document.readyState === "complete" || document.readyState === "interactive") { bkInit(); } else { document.addEventListener("DOMContentLoaded", bkInit); }</script>\n' +
      html.slice(body);
    console.log('✓ скрипт сетки подключён к админке');
  } else {
    console.log('• скрипт сетки уже подключён');
  }
}

fs.writeFileSync(file, html, 'utf8');
console.log('\nготово: ' + file + ' (' + html.length + ' Б)');
