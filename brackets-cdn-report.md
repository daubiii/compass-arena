# brackets-manager + brackets-viewer через CDN — техническая выжимка

Легенда: **[П]** — проверено фактически (fetch файла / запуск в headless Chrome / запуск в Node на реальном пакете). **[Д]** — из README/`.d.ts`/док-сайта без запуска. **[НЕ ПОДТВЕРЖДЕНО]** — не нашёл.

Среда проверки: Node v24.21.0, реальный Google Chrome (headless=new), пакеты из npm (`brackets-manager@1.11.1`, `brackets-viewer@1.9.1`, `brackets-memory-db@1.0.6`, `brackets-model@1.7.0`), файлы — с `cdn.jsdelivr.net`.

---

## 0. Главный вывод (от него зависит вся архитектура)

| Факт | Статус |
|---|---|
| `brackets-manager` **не имеет UMD/IIFE-сборки**. В пакете только CommonJS: `dist/index.js`, `package.json.main = ./dist/index.js`. Полей `module`/`browser`/`exports`/`unpkg`/`jsdelivr` **нет**. | **[П]** (список файлов jsDelivr API + `package.json` из tarball) |
| Поэтому `<script src=".../brackets-manager.../dist/index.min.js">` **глобал не создаст** (это CJS-модуль на 1.6 КБ с `require`). | **[П]** (файл скачан, содержимое `"use strict"; Object.defineProperty(exports,...`) |
| У `brackets-manager` есть рабочий **ESM**-вариант от jsDelivr: `https://cdn.jsdelivr.net/npm/brackets-manager@1.11.1/+esm` (83 КБ). `events` (node-builtin) внутри заинлайнен, внешние импорты только `brackets-model@1.7.0/+esm` и `uuid@9.0.1/+esm`. | **[П]** (файл скачан + импортирован в Chrome, `create.stage()` отработал) |
| `brackets-viewer` `+esm` **отсутствует — 404**. У него только webpack-IIFE `dist/brackets-viewer.min.js`. | **[П]** (fetch `.../brackets-viewer@1.9.1/+esm` → HTTP 404) |
| Один тег `<script src=".../brackets-viewer.min.js">` создаёт **три готовых глобала**: `window.bracketsViewer` (инстанс `BracketsViewer`), `window.inMemoryDatabase` (инстанс `InMemoryDatabase`), `window.bracketsManager` (инстанс `BracketsManager`, **уже соединённый** с этим `inMemoryDatabase`). | **[П]** (в Chrome: `bracketsViewer=object bracketsManager=object inMemoryDatabase=object`; в бандле найдена строка `window.bracketsViewer=new s.BracketsViewer,window.inMemoryDatabase=new i.InMemoryDatabase,window.bracketsManager=new a.BracketsManager(window.inMemoryDatabase)`) |

**Рекомендуемая схема для статического сайта на Cloudflare Pages:**

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/brackets-viewer@1.9.1/dist/brackets-viewer.min.css">
<script src="https://cdn.jsdelivr.net/npm/brackets-viewer@1.9.1/dist/brackets-viewer.min.js"></script>
```

…и дальше работать с `window.bracketsManager` / `window.bracketsViewer`. Отдельный `brackets-manager` подключать **не нужно** — он уже внутри (в бандле есть `cancelMatchGame`, `matchChildCount`, `confirmSeeding`, `matchGameResults`, т.е. код manager 1.10–1.11). Точная встроенная версия manager в бандле нигде не подписана — **[НЕ ПОДТВЕРЖДЕНО]** (ожидаемо `brackets-manager@1.11.0`, т.к. `brackets-viewer@1.9.1` зависит от `^1.11.0` и опубликован в тот же день).

Альтернатива, если нужен именно менеджер последней версии (1.11.1) — ESM:

```html
<script type="module">
  import { BracketsManager } from 'https://cdn.jsdelivr.net/npm/brackets-manager@1.11.1/+esm';
  import { InMemoryDatabase } from 'https://cdn.jsdelivr.net/npm/brackets-memory-db@1.0.6/+esm';
  const manager = new BracketsManager(new InMemoryDatabase());
</script>
```
**[П]** — этот импорт реально выполнен в Chrome, `create.stage()` вернул стадию.

---

## A. Версии и точные URL на jsDelivr

| Пакет | Последняя версия | Дата релиза (npm / GitHub) |
|---|---|---|
| `brackets-manager` | **1.11.1** | npm `2026-09-20T08:59:26Z`, GitHub release `v1.11.1` `2026-09-20T08:57:21Z` — «Fix mutation events for custom storage adapters» (#253) |
| `brackets-viewer` | **1.9.1** | npm `2026-05-17T21:21:50Z`, GitHub release `v1.9.1` `2026-05-17T21:21:51Z` (без описания) |

`brackets-manager` использованные под-зависимости: `brackets-model@^1.7.0`, `uuid@^9.0.0`. `brackets-viewer@1.9.1` зависит от `brackets-manager@^1.11.0`, `brackets-memory-db@^1.0.6`, `brackets-model@^1.7.0`, `i18next@^21.6.14`, `i18next-browser-languagedetector@^6.1.4`, `path-browserify`, `process`, `util` — всё это **зашито в бандл** `brackets-viewer.min.js`. **[П]**

### Проверенные URL (все скачаны, HTTP 200, отдаётся JS/CSS, не 404)

| URL | Размер raw / gzip | Что это |
|---|---|---|
| `https://cdn.jsdelivr.net/npm/brackets-viewer@1.9.1/dist/brackets-viewer.min.js` | 198 487 Б / 48 887 Б | **IIFE-бандл**: viewer + manager + memory-db. Работает как `<script src>`. Глобалы: `bracketsViewer`, `inMemoryDatabase`, `bracketsManager`. **[П]** |
| `https://cdn.jsdelivr.net/npm/brackets-viewer@1.9.1/dist/brackets-viewer.min.css` | 6 872 Б / 1 656 Б | обязательный CSS (все стили скоупятся под `.brackets-viewer`). **[П]** |
| `https://cdn.jsdelivr.net/npm/brackets-viewer@1.9.1/dist/stage-form-creator.min.js` | 182 097 Б | отдельный бандл конструктора стадии; создаёт `window.stageFormCreator` и `window.updateFormCreator`. **Не нужен**, если вы строите UI сами. **[П]** |
| `https://cdn.jsdelivr.net/npm/brackets-manager@1.11.1/+esm` | 82 953 Б / 21 023 Б | ESM-сборка manager (jsDelivr, Rollup+esbuild). **[П]** |
| `https://cdn.jsdelivr.net/npm/brackets-memory-db@1.0.6/+esm` | 2 642 Б / 1 195 Б | ESM `InMemoryDatabase` (тянет `rfdc@1.4.1/+esm`). **[П]** |
| `https://cdn.jsdelivr.net/npm/brackets-model@1.7.0/+esm` | 1 638 Б | ESM типов/enum (в т.ч. `Status`). **[П]** |
| `https://cdn.jsdelivr.net/npm/brackets-manager@1.11.1/dist/index.js` | 1 518 Б | ❌ CJS, для `<script>` не годится. **[П]** |
| `https://cdn.jsdelivr.net/npm/brackets-manager@1.11.1/dist/index.min.js` | 1 646 Б | ❌ то же (это jsDelivr-автомин CJS-файла). **[П]** |
| `https://cdn.jsdelivr.net/npm/brackets-viewer@1.9.1/+esm` | — | ❌ **HTTP 404**. ESM-сборки нет. **[П]** |
| `https://cdn.jsdelivr.net/npm/brackets-viewer@1.9.1/dist/index.js` | — | ❌ **HTTP 404** — хотя это `main` в `package.json`. Пакет опубликован с «битым» `main`. **[П]** |

`@latest` для viewer сейчас резолвится в `1.9.1` (`x-jsd-version: 1.9.1`), файл **байт-в-байт** совпадает с `@1.9.1`. **[П]** Но лучше пинить версию.

Файлы с CDN **байт-идентичны** файлам из npm-тарбbola (sha256 совпали). **[П]** Значит можно использовать SRI:

```
dist/brackets-viewer.min.js   sha256-OOoe6rAc06KxSAEVC0Z5dXIJZz97JGv2tvwLZF5zYKU=
dist/brackets-viewer.min.css  sha256-+iaGAsBlLI7ifUJpSV0CMcZqG5SSaTwMrZgyYD81tyo=
```
**[П]** (совпадает и с хешами из jsDelivr API). SRI **нельзя** применять к `+esm`-файлам (jsDelivr прямо предупреждает: dynamically generated files).

---

## B. API `brackets-manager`

### B.1 Создание инстанса

```js
// Вариант 1 (рекомендуемый для чистого браузера, ноль доп. подключений):
const manager = window.bracketsManager;   // уже создан бандлом viewer'а
// Вариант 2 (ESM):
import { BracketsManager } from 'https://cdn.jsdelivr.net/npm/brackets-manager@1.11.1/+esm';
import { InMemoryDatabase } from 'https://cdn.jsdelivr.net/npm/brackets-memory-db@1.0.6/+esm';
const manager = new BracketsManager(new InMemoryDatabase());
// Вариант 3 (второй независимый инстанс поверх classes из бандла viewer'а;
// в минифицированном бандле имена классов потеряны, поэтому через прототипы):
const M = Object.getPrototypeOf(window.bracketsManager).constructor;
const DB = window.inMemoryDatabase.constructor;
const manager2 = new M(new DB());
```
- Класс стораджа называется ровно **`InMemoryDatabase`**, пакет **`brackets-memory-db`** (`dist/index.d.ts` → `export declare class InMemoryDatabase implements CrudInterface`). **[П]**
- Конструктор: `new BracketsManager(storageInterface: CrudInterface, verbose?: boolean)`. `verbose` пишет CRUD-логи в консоль. **[Д]** (`.d.ts` `manager.d.ts`)
- `BracketsManager extends EventEmitter` (node `events`). В ESM-сборке jsDelivr `events` заинлайнен, **полифилл не нужен**. **[П]**
- У инстанса есть `manager.import(data: Database, normalizeIds?)` и `manager.export(): Promise<Database>` — сохранение/восстановление состояния в localStorage. **[Д]**

> ⚠️ `brackets-memory-db` **не является зависимостью** `brackets-manager` (только devDependency): при ESM-подключении нужно подключать его отдельным `+esm`-импортом. В бандле viewer'а он уже внутри. **[П]** (`package.json`, вывод Chrome).

### B.2 `manager.create.stage({...})` — точная сигнатура

`create.stage` — единственный метод объекта `create` (`Object.keys(manager.create) === ['stage']`). Принимает `InputStage`:

| Поле | Тип | Обязательно | Комментарий |
|---|---|---|---|
| `tournamentId` | `Id` (`number \| string`) | **да** | участвует в вычислении `number` стадии |
| `name` | `string` | **да** | заголовок `<h1>` в viewer'е |
| `type` | `'single_elimination' \| 'double_elimination' \| 'round_robin'` | **да** | |
| `number` | `number` | нет | № стадии в турнире; вычисляется сам (1, 2, …) **[П]** |
| `seeding` | `(CustomParticipant \| string \| number \| null)[]` | нет | см. B.3 |
| `seedingIds` | `(Id \| null)[]` | нет | только ID |
| `settings` | `StageSettings` | нет | см. B.4 |

Возвращает `Promise<Stage>` — созданную стадию. **[П]** Реальный ответ для SE:

```json
{"tournament_id":0,"name":"SE6 Bo3","type":"single_elimination","number":1,
 "settings":{"size":8,"seedOrdering":["natural"],"balanceByes":true,"matchesChildCount":3,"consolationFinal":false},
 "id":0}
```
Обратите внимание: `settings` дозаполняется дефолтами (`consolationFinal: false`), а `settings.seedOrdering` в ответе есть **только если вы его передали** (при дефолте ключа нет, хотя фактический порядок применяется). **[П]**

### B.3 `seeding` — что именно принимается

| Что передали | Поведение | Проверено |
|---|---|---|
| `['A','B',...]` (строки) | создаёт новых participants (`{id, tournament_id, name}`) | **[П]** |
| `[{name:'Alpha', logo:'a.png'}, ...]` | создаёт участника, **лишние поля сохраняются**: `{id, name, logo, tournament_id}` | **[П]** — идеальный способ протащить логотип/цвет/аббревиатуру |
| `[10,11,12,13]` (числа) | трактуются как **существующие ID**; если такого участника нет → `Error: Participant id not found in database.` | **[П]** |
| `null` в массиве | явный BYE | **[П]** |

`CustomParticipant<ExtraFields> = Pick<Participant,'name'> & ExtraFields`. **[Д]**

**Критично:** `settings.size` должен быть **степенью двойки**. `size: 7` → `Error: The library only supports a participant count which is a power of two.` Для 6 команд нужно `size: 8`. **[П]**

### B.4 `settings` (`StageSettings`) — все реальные поля

| Поле | Тип / значения | Дефолт | Проверено |
|---|---|---|---|
| `size` | `number`, степень двойки | — | **[П]** |
| `seedOrdering` | `SeedOrdering[]` | фактически `['inner_outer']` для SE и DE | **[П]**: без `seedOrdering` порядок = `1v8, 4v5, 2v7, 3v6`, т.е. ровно как у `['inner_outer']` |
| `balanceByes` | `boolean` | `true` | **[Д]** + **[П]** для SE/DE |
| `matchesChildCount` | `number` | `0` | **[П]** — это и есть Bo3/Bo5 |
| `groupCount` | `number` (round_robin) | — | **[Д]** |
| `roundRobinMode` | `'simple' \| 'double'` | — | **[Д]** |
| `manualOrdering` | `Seed[][]` (`number \| null`) | — | **[Д]** (при наличии `seedOrdering` игнорируется) |
| `consolationFinal` | `boolean` | `false` | **[П]** |
| `skipFirstRound` | `boolean` (DE) | `false` | **[Д]** |
| `grandFinal` | `'none' \| 'simple' \| 'double'` (DE) | `'none'` | **[П]** |

Допустимые `SeedOrdering`: `'natural' | 'reverse' | 'half_shift' | 'reverse_half_shift' | 'pair_flip' | 'inner_outer' | 'groups.effort_balanced' | 'groups.seed_optimized' | 'groups.bracket_optimized'`. **[Д]**
Реально применённые порядки для SE-8 (round 1) **[П]**:

| `seedOrdering` | round 1 |
|---|---|
| дефолт / `inner_outer` | `1v8 ; 4v5 ; 2v7 ; 3v6` |
| `natural` | `1v2 ; 3v4 ; 5v6 ; 7v8` |
| `reverse` | `8v7 ; 6v5 ; 4v3 ; 2v1` |
| `half_shift` | `5v6 ; 7v8 ; 1v2 ; 3v4` |
| `pair_flip` | `2v1 ; 4v3 ; 6v5 ; 8v7` |

`grandFinal` **[П]**:
- `'none'` → группы 1 и 2 (в терминах `group.number`), финальной группы нет; `settings.grandFinal === 'none'`.
- `'simple'` → создаётся 3-я группа (`number: 3`) с одним матчем (grand final).
- `'double'` → в финальной группе 2 матча (grand final + reset match).

### B.5 Остальные нужные методы

| Задача | Реальный вызов | Проверено |
|---|---|---|
| Все данные турнира | `await manager.get.tournamentData(tournamentId)` → `{stage, group, round, match, match_game, participant}` (**snake_case**) | **[П]** |
| Данные одной стадии | `await manager.get.stageData(stageId)` — те же ключи | **[П]** |
| Получить матч по id | ❌ **`manager.get.match(id)` НЕ СУЩЕСТВУЕТ** (`typeof === 'undefined'`). Использовать `await manager.get.matches({ id })` → **массив** длины 1, либо `await manager.find.match(groupId, roundNumber, matchNumber)` | **[П]** (и в Node, и в браузере) |
| Список матчей | `await manager.get.matches({ round_id })` / `get.rounds({ group_id })` / `get.groups({ stage_id })` — появились в 1.11.0 | **[П]** |
| Игры матча | `await manager.get.matchGames(matches)` → `MatchGame[]` | **[Д]** |
| Ввод счёта (Bo1) | `await manager.update.match({ id, opponent1:{score, result}, opponent2:{score, result} })` | **[П]** |
| Ввод счёта по играм (Bo3) | `await manager.update.matchGame({ id, opponent1:{score}, opponent2:{score}, status: 4 })` | **[П]** |
| Сменить BoX на лету | `await manager.update.matchChildCount(level, id, count)`, `level ∈ 'stage'\|'group'\|'round'\|'match'` | **[П]** |
| Пересеять | `await manager.update.seeding(stageId, newSeeding, keepSameSize?)` (есть и `update.seedingIds(stageId, ids, keepSameSize?)`) | **[П]** |
| Сменить порядок сеяния | `await manager.update.ordering(stageId, seedOrdering[])`, `update.roundOrdering(roundId, method)` | **[Д]** |
| Сброс матча | ❌ **`manager.reset.match` НЕ СУЩЕСТВУЕТ**. Есть `reset.matchResults(matchId)`, `reset.matchGameResults(gameId)`, `reset.seeding(stageId)` | **[П]** |
| Сброс Bo3-матча | ⚠️ `reset.matchResults(parentId)` для матча с child games **бросает** `Error: The parent match is controlled by its child games and its result cannot be reset.` → сбрасывать надо каждую игру через `reset.matchGameResults(gameId)` | **[П]** |
| Текущее состояние | `get.currentStage(tournamentId)`, `get.currentRound(stageId)`, `get.currentMatches(stageId)` | **[Д]** |
| Итоговые места | `get.finalStandings(stageId)` (для round_robin — с `{rankingFormula, maxQualifiedParticipantsPerGroup?}`) | **[Д]** |
| Верхняя/нижняя сетка | `find.upperBracket(stageId)` → группа WB, `find.loserBracket(stageId)` → группа LB | **[П]** |
| Отмена игры | `update.cancelMatchGame(gameId, { mode: 'spent_game' \| 'double_forfeit' })` (с 1.10.0) | **[Д]** |
| Экспорт/импорт | `manager.export()`, `manager.import(data, normalizeIds?)` | **[Д]** |
| События | `manager.on('entity.changed', e => ...)`; `e = {id, method:'insert'\|'update'\|'delete', table, args, result, duration}` | **[Д]** (1.11.1 — фикс именно этих событий) |

### B.6 Структура данных — точные поля сущностей

`get.tournamentData(id)` и `get.stageData(id)` возвращают объект с ключами-таблицами: **`stage`, `group`, `round`, `match`, `match_game`, `participant`** (snake_case — это `Database` из `brackets-model`). **[П]**

```jsonc
// participant
{ "id": 0, "tournament_id": 0, "name": "Alpha", /* + ваши лишние поля, напр. "logo" */ }

// stage
{ "id": 0, "tournament_id": 0, "name": "SE6 Bo3", "type": "single_elimination",
  "number": 1, "settings": { /* StageSettings, см. выше */ } }

// group
{ "id": 0, "stage_id": 0, "number": 1 }      // DE: number 1 = WB, 2 = LB, 3 = final

// round
{ "id": 0, "stage_id": 0, "group_id": 0, "number": 1 }

// match
{ "id": 0, "number": 1, "stage_id": 0, "group_id": 0, "round_id": 0,
  "child_count": 3,                    // 0 = Bo1, N = Bo(N)
  "status": 2,                         // Status enum, см. ниже
  "opponent1": { "id": 0, "position": 1, "score": 2, "result": "win", "forfeit": true },
  "opponent2": { "id": 1, "position": 2, "score": 1, "result": "loss" } }

// opponent (ParticipantResult)
{ "id": Id|null,          // null => BYE (когда весь opponent === null) или TBD (id: null)
  "position"?: number,    // номер сеяния (1-based) — есть только у участников, пришедших из сеяния
  "forfeit"?: boolean,
  "score"?: number,       // для BoX = число выигранных игр
  "result"?: "win" | "draw" | "loss" }

// match_game
{ "id": 0, "number": 1, "stage_id": 0, "parent_id": 0,
  "status": 2,
  "opponent1": { "id": 0, "score": 21, "result": "win" },
  "opponent2": { "id": 3, "score": 10, "result": "loss" } }
```

`Status` (числовой enum из `brackets-model`) **[Д]**:
`0 Locked`, `1 Waiting`, `2 Ready`, `3 Running`, `4 Completed`, `5 Archived`, `6 GameCancelled`.

**Полей `winner_id` / `loser_id` у матча НЕТ.** Связь между раундами выводится из данных (или через `manager.find.previousMatches(matchId, participantId?)` / `find.nextMatches(...)`). **[П]** (в реальных объектах матчей таких полей нет) — **[Д]** для `find.previousMatches/nextMatches`.

### B.7 Bo3 / Bo5: как счёт матча связан со счётом игр

`matchesChildCount: 3` → на каждый матч создаётся 3 записи `match_game` с `parent_id = match.id`, `number = 1..3`, и у матча `child_count = 3`. **[П]** (для SE-6 c Bo3: 7 матчей → 21 match_game).

Как это работает (эмпирика, SE Bo3, одна игра = один `update.matchGame({status: 4})`) **[П]**:

| Действие | `match_game` | родительский `match` |
|---|---|---|
| старт | 3 игры, `status: 2`, без score | `status: 2`, `child_count: 3` |
| игра 1: 21-10 | игра 1 `Completed`, `o1.result:'win'`, `o2.result:'loss'` | `status: 3 (Running)`, `o1.score: 1`, `o2.score: 0` |
| игра 2: 15-21 | 1-1 по играм | `status: 3`, `o1.score: 1`, `o2.score: 1` |
| игра 3: 21-18 | 2-1 по играм | `status: 4 (Completed)`, `o1.score: 2 result:'win'`, `o2.score: 1 result:'loss'` |

**Вывод:** при `child_count > 0` поле `opponentN.score` матча = **количество выигранных игр**, а не сумма очков. Матч автоматически закрывается, когда одна сторона набирает большинство. Ручной `update.match({opponent1:{score:2}})` для Bo3-матча **не создаёт** счёт в играх (игры остаются `status: 2` без score) — так делать не надо. **[П]**

### B.8 BYE (6 команд → сетка на 8 с двумя BYE)

Как это выглядит в данных — **[П]** для `seeding: ['A','B','C','D','E','F']`, `size: 8`:

```
round 1:
  id0 st0  [ p0@1  vs  null ]              <- BYE: opponent2 === null, у p0 result:'win'
  id1 st2  [ p3@4  vs  p4@5 ]
  id2 st0  [ p1@2  vs  null ]              <- BYE
  id3 st2  [ p2@3  vs  p5@6 ]
round 2:
  id4 st1  [ p0@undefined vs TBD ]
  id5 st1  [ p1@undefined vs TBD ]
round 3:
  id6 st0  [ TBD vs TBD ]
```

Правила:
- BYE выражается как **`opponentN === null`** целиком (не «участник с id null»). **[П]**
- У соперника BYE проставляется `result: 'win'`, а сам BYE-матч остаётся `status: 0 (Locked)` (у него нет `child_count`-игр, он не «играется»). **[П]**
- Победитель BYE-матча **сразу подставляется** в матч следующего раунда (`p0@...` в round 2), у него теряется `position` (`undefined`) и `status` следующего матча = `1 (Waiting)`. **[П]**
- `balanceByes: true` (дефолт) разводит BYE так, чтобы BYE не встречался с BYE: в примере выше BYE получили сеяные 1 и 2. **[П]**
- `await manager.get.seeding(stageId)` для этого случая: `[{id:0,position:1},{id:1,position:2},{id:2,position:3},{id:3,position:4},{id:4,position:5},null,{id:5,position:7},null]` — **`null` = BYE**. **[П]**
- Для DE-6 (`size: 8`, grandFinal `simple`) структура такая же, BYE попадают в WB round 1. **[П]**
- В viewer BYE рендерится как `<div class="name bye">BYE</div>` с пустым `.result`, а участник получает класс `.participant.win` и текст `W`. **[П]**

---

## C. API `brackets-viewer`

### C.1 Инициализация и `render()`

```js
await window.bracketsViewer.render(
  { stages, matches, matchGames, participants },   // ViewerData
  { selector: '#bracket', /* ...Config */ }        // Partial<Config>, необязателен
);
```

**Точные имена полей первого аргумента** (`ViewerData`, `dist/types.d.ts`): `stages: Stage[]`, `matches: Match[]`, `matchGames: MatchGame[]`, `participants: Participant[]`. **[П]**
НЕ `stage`/`match`/`match_game`/`participant` (это имена ключей в `Database` от `get.tournamentData`). Передавать можно как по частям, так и весь объект, разложив ключи:

```js
const d = await window.bracketsManager.get.tournamentData(0);
await window.bracketsViewer.render({ stages: d.stage, matches: d.match, matchGames: d.match_game, participants: d.participant });
```
⚠️ В README есть пример `render({stages: data.stage, ...})` — но `data` там из json-server'а `db.json`, где ключи именно `stage/match/match_game/participant`. Имена **полей аргумента** — строго `stages/matches/matchGames/participants`. **[П]**

`render()` возвращает `Promise<void>`, его надо `await`. **[П]**

**КРИТИЧНО:** корневой элемент **обязан иметь класс `brackets-viewer`**, иначе `render()` бросает исключение:
`Error: The selected root must have a .brackets-viewer class.` **[П]**
Т.е. `<div id="bracket" class="brackets-viewer"></div>`, а не просто `<div id="bracket">`. И он должен быть **пустым** до рендера (иначе FOUC — комментарий в демо). **[Д]**

Другие методы инстанса (`dist/main.d.ts`) **[Д]**:
- `setParticipantImages(images: ParticipantImage[])` — **до** `render()`
- `addLocale(name: string, locale: Locale): Promise<void>`
- `updateMatch(match: Match): void` — обновить результат уже отрисованного матча
- `participantRefs: Record<Id, HTMLElement[]>` — публичное поле, ссылки на DOM участников
- `set onMatchClicked(cb)` — **deprecated**, используйте `onMatchClick` в config

### C.2 `Config` — полный реальный список (13 опций, v1.9.1)

Сверено 1:1 с `dist/types.d.ts` и с док-сайтом TypeDoc для v1.9.1 **[П]/[Д]**:

| Опция | Тип | Default |
|---|---|---|
| `onMatchClick` | `(match: MatchWithMetadata) => void` | `undefined` |
| `onMatchLabelClick` | `(match: MatchWithMetadata) => void` | `undefined` |
| `customRoundName` | `(info: RoundNameInfo, t: TFunction) => string \| undefined` | `undefined` |
| `selector` | `string` | `'.brackets-viewer'` |
| `participantOriginPlacement` | `'none' \| 'before' \| 'after'` | `'before'` |
| `separatedChildCountLabel` | `boolean` | `false` |
| `showSlotsOrigin` | `boolean` | `true` |
| `showLowerBracketSlotsOrigin` | `boolean` | `true` |
| `showPopoverOnMatchLabelClick` | `boolean` | `true` |
| `highlightParticipantOnHover` | `boolean` | `true` |
| `showRankingTable` | `boolean` | `true` (round-robin) |
| `rankingFormula` | `(item: RankingItem) => number` | `(i) => 3*i.wins + 1*i.draws + 0*i.losses` |
| `clear` | `boolean` | `false` |

**Чего НЕТ в v1.9.1** (проверено поиском по бандлу: 0 вхождений, и опций нет ни в `.d.ts`, ни в TypeDoc) — **[П]**:
`customLocale`, `separateMatchGames`, `showLive`, `customCSSrules`, `logos`, `participantImages` (как опция config), `disableHighlight`, `showOrigin`.

Полезно:
- **`customLocale` заменён** на метод `bracketsViewer.addLocale(name, locale)` (вызывать до render) + `window.localStorage['i18nextLng'] = 'ru'` для принудительной локали (это прямо из демо-файла). **[П]** + **[Д]**
- `participantImages`/`logos` как config-ключи заменены методом `setParticipantImages()` (см. C.3).
- Лишние/неизвестные ключи в config **молча игнорируются**, исключения не будет (проверено передачей `customLocale`, `showLive`, `separateMatchGames`, `customCSSrules`, `logos` — рендер прошёл). **[П]**
- `customRoundName` получает `info` с `groupType` в **дефисной** форме: `'single-bracket'`, `'winner-bracket'`, `'loser-bracket'`, `'final-group'` (или `'round-robin'`), плюс `roundNumber`, `roundCount`, `fractionOfFinal` (`1` = финал, `0.5` = полуфинал…), и `t` для переводов. Возврат `undefined` = дефолтное имя. **[П]**
- `onMatchClick(match)` получает `MatchWithMetadata`: все поля матча + `metadata: { stageType, games: MatchGame[], label?, roundNumber?, roundCount?, matchLocation?, connectFinal?, connection?, originHint? }`. Срабатывает по клику на `.opponents`. **[П]** (в тесте вернулся массив id `[0]`)

### C.3 Логотипы / иконки команд

```js
window.bracketsViewer.setParticipantImages([
  { participantId: 0, imageUrl: '/img/team-alpha.png' },
  { participantId: 1, imageUrl: 'https://.../logo.png' },
]);
await window.bracketsViewer.render(viewerData, { selector: '#bracket' });
```
- `ParticipantImage = { participantId: number; imageUrl: string }`. **[Д]**
- Обязательно **до** `render()` (комментарий в демо) **[Д]**, проверено фактически **[П]**.
- Рендерится как `<img src="...">` **внутри** `.participant > .name`, **после** span'а с позицией: `<div class="name"><span>#1 </span><img src="...">Alpha</div>`. **[П]**
- Размер задаётся CSS-переменной `--participant-image-size` (дефолт `1em`), у `img` есть `border-radius: 4px; object-fit: cover`. **[П]** (из CSS)
- Альтернатива: положить URL логотипа прямо в seeding (`{name:'Alpha', logo:'a.png'}`) — поле сохранится в `participant`, и его можно использовать при вызове `setParticipantImages`. **[П]**

### C.4 Реальный DOM, который создаёт библиотека

Корень (элемент с классом `.brackets-viewer`) получает 2 ребёнка: `<div popover="auto">` (контейнер поповеров) и `<div class="elimination" data-stage-id="0">` (или `class="round-robin"`). **[П]**

SE (single elimination) **[П]**:
```html
<div id="bracket" class="brackets-viewer">
  <div popover="auto"></div>
  <div class="elimination" data-stage-id="0">
    <h1>SE6 Bo3</h1>                          <!-- имя стадии -->
    <section class="bracket">
      <div class="rounds">
        <article class="round" data-round-id="0">
          <h3>Round 1</h3>
          <div class="match connect-next" data-match-id="0" data-match-status="2">
            <div class="opponents">
              <span title="Ready">M 1.1</span>   <!-- только у матчей с child games -->
              <span>Bo3</span>                   <!-- только при child_count > 0 -->
              <div class="participant" data-participant-id="0" title="Alpha">
                <div class="name"><span>#1 </span>Alpha</div>
                <div class="result">-</div>
              </div>
              <div class="participant" data-participant-id="1" title="Bravo">
                <div class="name"><span>#2 </span>Bravo</div>
                <div class="result">-</div>
              </div>
            </div>
          </div>
          ...
```

DE (double elimination) **[П]**: тот же `.elimination`, но внутри два/три `<section class="bracket">` с `<h2>`: `Winner Bracket`, `Loser Bracket`; гранд-финал — отдельный блок с `<h3>Grand Final</h3>`. Реальные `<h3>`-заголовки раундов для DE-8: `WB Round 1`, `WB Round 2`, `WB Final Round`, `Grand Final`, `LB Round 1`, `LB Round 2`, `LB Round 3`, `LB Final Round`. Для SE-4: `Round 1`, `Final Round`.

Round-robin **[П]**: корневой div — `.round-robin`, внутри `.group` → `.round` → `.match`, плюс таблица рейтинга `<table>` с заголовками `#, Name, P, W, D, L, F, SF, SA, +/-, Pts` (и `.group td.hover`).

**Классы, реально встречающиеся в DOM** **[П]**: `brackets-viewer`, `elimination`, `round-robin`, `bracket`, `rounds`, `round`, `match`, `opponents`, `participant`, `name`, `result`, `win`, `loss`, `hover`, `bye`, `connect-next`, `connect-previous`, `straight`.
Плюс атрибуты-хуки: `data-stage-id`, `data-round-id`, `data-match-id`, `data-match-status`, `data-participant-id`, `title` (имя участника / статус матча).
Теги: `DIV`, `SECTION`, `ARTICLE`, `H1`, `H2`, `H3`, `SPAN`, `TABLE/TH/TD` (только round-robin).

**Важные нюансы:**
- span'ы-лейблы (`<span title="Ready">M 1.1</span>`, `<span>Bo3</span>`) рисуются **только** у матчей с child games. Для Bo1 внутри `.opponents` span'ов нет вообще. **[П]**
- BYE: `<div class="participant"><div class="name bye">BYE</div><div class="result"></div></div>`. **[П]**
- Победитель: `<div class="participant win">`, `.result` = `W`; проигравший: `.participant.loss`, `.result` = `L`; незавершённый: `.result` = `-`. **[П]** (`W`/`L` из `abbreviations.win/loss`, дефолт en; в ru-локали — что вы зададите).
- Подсказки origin (при `showSlotsOrigin: true`) попадают в `.name` как текст: `Winner of LB Final`, `Loser of WB 1.1`, `Loser of WB Semi 2`, `Loser of WB Final`. **[П]**
- `clear: true` реально вычищает контейнер (39 нод до и после re-render); без `clear` рендер **добавляется** сверху (78 нод, 2 контейнера `.elimination`). **[П]**

### C.5 Темы и перекраска под палитру (#0a0d12 / #c9a35a / #e3c48a)

Все стили скоупятся под `.brackets-viewer`, тема = переопределение CSS-переменных на `.brackets-viewer`. Полный список переменных (из `brackets-viewer.min.css`) **[П]**:

```css
.brackets-viewer{
  --primary-background:#fff; --secondary-background:#eceff1; --match-background:var(--primary-background);
  --font-color:#212529; --win-color:#50b649; --loss-color:#e61a1a; --label-color:grey; --hint-color:#a7a7a7;
  --connector-color:#9e9e9e; --border-color:#d9d9d9; --border-hover-color:#b6b5b5;
  --border-selected-color:rgb(60,60,60); --text-size:12px; --round-margin:40px; --match-width:150px;
  --match-horizontal-padding:8px; --match-vertical-padding:6px; --connector-border-width:2px;
  --match-border-width:1px; --match-border-radius:.3em; --participant-image-size:1em;
}
```

Что какой переменной управляет **[П]** (проверено через `getComputedStyle` в Chrome):
`--primary-background` → фон корня (и фон label-span'ов), `--match-background` → фон `.opponents`/`.participant`, `--font-color` → цвет текста, `--border-color` → рамка `.opponents` (проверено: `rgb(42,52,68)`), `--match-width` → ширина `.match` (проверено: `180px`), `--round-margin` → отступ между раундами и длина коннекторов, `--connector-color`/`--connector-border-width` → линии связей, `--win-color`/`--loss-color` → цвет цифры результата, `--label-color` → подписи (`M 1.1`), `--hint-color` → `.name.hint` и `BYE`, `--secondary-background` → фон `h3` и подсветка hover, `--border-hover-color`/`--border-selected-color` → hover/выбранный поповер, `--participant-image-size` → размер `<img>` логотипа.

Готовый тёмно-золотой оверрайд — в примере 3 ниже. **[П]** (реально применён, фон стал `rgb(10,13,18)`).

### C.6 Несколько стадий и DE-сетки

- **Несколько стадий в одном `render()`**: работает. Для турнира с SE-стадией и DE-стадией (`tournamentId: 0`, `number: 1` и `2`) отрисовались **2** контейнера `.elimination` с заголовками `<h1>Stage SE</h1>` и `<h1>Stage DE</h1>`. **[П]** (в `main.d.ts` — «If multiple stages are given, they will all be displayed. Stages won't be discriminated visually based on the tournament they belong to.»).
- **DE**: одна стадия автоматически раскладывается на `Winner Bracket` (WB) и `Loser Bracket` (LB) как отдельные `<section class="bracket">` с `<h2>`, плюс отдельный блок `Grand Final` (`grandFinal: 'simple'` → 1 матч, `'double'` → 2 матча). **[П]**
- Данные управления DE-сетками: группы стадии DE — `group.number = 1` (WB), `2` (LB), `3` (final group). Для DE-8: 7 матчей в WB, 6 в LB, 1 в final. **[П]**

### C.7 i18n (`addLocale`)

Ключи локали (из `dist/lang.d.ts`), скоупы **[Д]**: `origin-hint`, `match-label`, `match-status`, `abbreviations`, `ranking`, `common`, `form-creator`. Дефолтные локали в бандле: **`en` и `fr`**. Русской локали нет — нужно добавлять самим. **[П]** (в бандле только en/fr ключи).

Полезные ключи для кастомизации **[П]** (проверено — `common.round-name` → `РАУНД 1` в отрисованном `<h3>`):
```js
await window.bracketsViewer.addLocale('ru', {
  common: { 'round-name': 'Раунд {{roundNumber}}', 'round-name-final': 'Финал', bye: 'ПРОПУСК', 'best-of-x': 'До {{x}}' },
  'match-status': { locked:'Заблокирован', waiting:'Ожидание', ready:'Готов', running:'Идёт', completed:'Завершён', archived:'Архив' },
  abbreviations: { win:'В', loss:'П', forfeit:'Н', position:'П', seed:'#', 'winner-bracket':'ВС', 'loser-bracket':'НС', match:'М', 'grand-final':'ГФ' },
  'match-label': { 'grand-final-single':'Гранд-финал', 'match-game':'Игра {{gameNumber}}' },
});
window.localStorage['i18nextLng'] = 'ru';   // форсировать язык
```
Незаданные ключи падают в `en`-fallback (в тесте `<h3>Final Round</h3>` остался английским, т.к. `common.round-name-final` не был переопределён). **[П]**

---

## D. Ограничения и подводные камни

1. **`brackets-manager` нельзя подключить через `<script src>` — UMD/IIFE в пакете нет.** Только CJS. Варианты: (а) `+esm` + `import`, (б) использовать бандл `brackets-viewer` (рекомендуется), (в) собрать свой IIFE-бандл (`esbuild`/`rollup`) — тогда `brackets-memory-db` и `uuid` зашьются внутрь. **[П]**
2. **Зависимость от node-модуля `events`**: `BracketsManager extends EventEmitter` и в `dist/manager.js` есть `require("events")`. **В браузере это проблема только при своей сборке**: jsDelivr `+esm` уже заинлайнил `events`, а бандл viewer'а — тоже. Голый `dist/index.js` в браузере не заработает. **[П]** (проверено: `+esm` работает в Chrome)
3. **`brackets-viewer` — IIFE, а не ESM**: `+esm` → 404; `import` из `dist/brackets-viewer.min.js` не сработает, только `<script src>` (классический скрипт). **[П]**
4. **`brackets-viewer/package.json` указывает `main: ./dist/index.js`, но этого файла в опубликованном пакете НЕТ** (404 и в npm-тарболе, и на CDN). Значит `require('brackets-viewer')`/`import ... from 'brackets-viewer'` в бандлере сломаны; для CDN это неважно, но не пытайтесь импортировать пакет «как есть». **[П]**
5. **Нет зависимости от `brackets-json-db` / `sqlite` / `typeorm` / `fs` / `path`.** **[П]** (0 вхождений в бандле viewer'а и в `+esm` менеджера; `brackets-json-db` — только devDependency менеджера). Единственный внешний рантайм-стор — `brackets-memory-db` (`InMemoryDatabase`), в бандле viewer'а он уже внутри.
6. **Мусор в консоли браузера**: в бандле есть `i18next-browser-languagedetector`, который читает `window.localStorage`/`sessionStorage`/`navigator`/`window.location`. Это нормально, но означает, что язык интерфейса может подхватиться из localStorage пользователя, если явно не задать `i18nextLng`. **[П]**
7. **`size` только степень двойки** → для 6 команд обязательно `size: 8` (+2 BYE). **[П]**
8. **`manager.get.match` и `manager.reset.match` не существуют** (см. B.5). **[П]**
9. **`reset.matchResults` бросает исключение для матчей с child games (BoX)** → сбрасывать через `reset.matchGameResults(gameId)` по каждой игре. **[П]**
10. **Корневой контейнер обязан иметь класс `brackets-viewer`**, иначе `render()` бросает исключение. **[П]**
11. **`clear: false` по умолчанию = рендеры накапливаются** (второй вызов добавит вторую копию сетки). Для SPA-перерисовки всегда передавайте `{ clear: true }`. **[П]**
12. **Все данные живут в памяти**: F5 → всё потеряно. Для «пережить перезагрузку» — `manager.export()` в `localStorage` + `manager.import(data)` (или `window.inMemoryDatabase.setData(data)`). **[Д]**
13. **Размеры (raw / gzip)** **[П]**:
    - `brackets-viewer.min.js` 198 487 Б / ~48.9 КБ gzip (включает manager + memory-db + i18next)
    - `brackets-viewer.min.css` 6 872 Б / ~1.7 КБ gzip
    - `brackets-manager@1.11.1/+esm` 82 953 Б / ~21 КБ gzip (+ `brackets-model` 1.6 КБ, `uuid` 8.4 КБ, `rfdc` для memory-db)
    - Итог по сети для полного «менеджер + рендер»: **~50 КБ gzip** в одну загрузку (вариант через бандл viewer'а) — это меньше, чем ESM-вариант + CSS.
14. **Работа без интернета на сервере**: да, всё исполняется **в браузере**. Cloudflare Pages отдаёт только статику; серверный Node/БД не нужен. **[Д]** Но если нужен полностью offline/self-hosted (или вы не хотите зависеть от CDN), просто положите два файла в репозиторий — они байт-идентичны CDN-версии и работают с локального пути:
    ```
    vendor/brackets-viewer.min.css   (shasum 48fda351a071ebc55b21785b0cf1fde16bfad6d3 из npm)
    vendor/brackets-viewer.min.js
    ```
    и ссылайтесь на `/vendor/...`. SRI в этом случае не нужен. **[П]** (байт-идентичность проверена)
15. **SRI**: можно только для статических `dist/*` файлов (`sha256-OOoe6rA...` для js, `sha256-+iaGAsB...` для css). Для `+esm` — нельзя (jsDelivr генерирует их на лету). **[П]/[Д]**
16. **[НЕ ПОДТВЕРЖДЕНО]**: точная версия `brackets-manager`, зашитая внутрь `brackets-viewer@1.9.1` (нигде не подписана). Если критично иметь именно 1.11.1 — используйте ESM-подключение менеджера отдельно.

---

## E. Рабочие примеры (копипаста)

### E.1 Общая HTML-обвязка

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/brackets-viewer@1.9.1/dist/brackets-viewer.min.css"
        integrity="sha256-+iaGAsBlLI7ifUJpSV0CMcZqG5SSaTwMrZgyYD81tyo=" crossorigin="anonymous">
  <script src="https://cdn.jsdelivr.net/npm/brackets-viewer@1.9.1/dist/brackets-viewer.min.js"
          integrity="sha256-OOoe6rAc06KxSAEVC0Z5dXIJZz97JGv2tvwLZF5zYKU=" crossorigin="anonymous"></script>
</head>
<body>
  <!-- ВАЖНО: класс brackets-viewer обязателен, контейнер должен быть пустым -->
  <div id="bracket" class="brackets-viewer"></div>
  <script type="module" src="/js/bracket.js"></script>
</body>
</html>
```
`window.bracketsManager` и `window.bracketsViewer` доступны сразу после загрузки скрипта. **[П]**

### E.2 Пример 1 — генерация SE на 6 команд, Bo3 (браузер)

```js
// SE на 6 команд => size обязан быть 8 (2^3), отсюда 2 BYE, разведённых balanceByes
const manager = window.bracketsManager;   // готовый инстанс из бандла viewer'а

const stage = await manager.create.stage({
  name: 'Compass Arena — Плей-офф',
  tournamentId: 1,
  type: 'single_elimination',
  seeding: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'], // 6 команд
  settings: {
    size: 8,                    // ОБЯЗАТЕЛЬНО степень двойки
    seedOrdering: ['inner_outer'], // 1v8, 4v5, 2v7, 3v6 (это же и дефолт)
    balanceByes: true,          // BYE не попадут друг на друга
    matchesChildCount: 3,       // Bo3
  },
});
console.log('stage id:', stage.id, stage.settings);

const data = await manager.get.tournamentData(1);
// data = { stage, group, round, match, match_game, participant }

console.log('матчей:', data.match.length, 'игр:', data.match_game.length, 'BYE-матчей:',
  data.match.filter(m => m.opponent1 === null || m.opponent2 === null).length);

// Ввод счёта Bo3: по одной игре. status 4 = Completed (brackets-model Status.Completed)
const games = data.match_game.filter(g => g.parent_id === 0); // игры матча id 0
await manager.update.matchGame({ id: games[0].id, opponent1: { score: 21 }, opponent2: { score: 15 }, status: 4 });
await manager.update.matchGame({ id: games[1].id, opponent1: { score: 18 }, opponent2: { score: 21 }, status: 4 });
await manager.update.matchGame({ id: games[2].id, opponent1: { score: 21 }, opponent2: { score: 12 }, status: 4 });

// Родительский матч собрался сам: opponent1.score = 2 (выигранные игры), status 4, result 'win'
const [match0] = await manager.get.matches({ id: 0 });
console.log(match0.opponent1, match0.opponent2);

// Для Bo1-матчей (child_count === 0) счёт ставится прямо в матч:
// await manager.update.match({ id: 5, opponent1: { score: 3, result: 'win' }, opponent2: { score: 1, result: 'loss' } });
// Неявка: await manager.update.match({ id: 5, opponent1: { forfeit: true }, opponent2: {} });
// Сброс Bo3: по каждой игре -> await manager.reset.matchGameResults(gameId);
```

### E.3 Пример 2 — генерация DE на 8 команд, Bo1, с grandFinal

```js
const manager = window.bracketsManager;

const stage = await manager.create.stage({
  name: 'Compass Arena — Double Elimination',
  tournamentId: 2,
  type: 'double_elimination',
  seeding: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'],
  settings: {
    size: 8,
    grandFinal: 'simple',     // 'none' | 'simple' | 'double' (double = +reset match)
    // skipFirstRound: false,
    // consolationFinal: false,
    matchesChildCount: 0,     // Bo1
  },
});

const data = await manager.get.tournamentData(2);

// DE-стадия всегда разложена на 3 группы: number 1 = Winner Bracket, 2 = Loser Bracket, 3 = final group
console.log(data.group);  // [{id:0,number:1},{id:1,number:2},{id:2,number:3}]
console.table(data.group.map(g => ({
  group: g.id, number: g.number,
  matches: data.match.filter(m => m.group_id === g.id).length,
})));
// group 0 (WB): 7 матчей, group 1 (LB): 6 матчей, group 2 (final): 1 матч

const wb = await manager.find.upperBracket(stage.id);
const lb = await manager.find.loserBracket(stage.id);
console.log('WB group id:', wb.id, '| LB group id:', lb.id);

// Ввод счёта Bo1 и авто-продвижение победителя:
await manager.update.match({
  id: data.match[0].id,                      // первый матч WB
  opponent1: { score: 2, result: 'win' },
  opponent2: { score: 0, result: 'loss' },
});
// Проверить, кто приехал в следующий матч:
const next = await manager.find.nextMatches(data.match[0].id);
console.log('следующий матч:', next);
```

### E.4 Пример 3 — рендер в `#bracket` + тёмно-золотая палитра проекта

```html
<style>
  /* Палитра проекта: фон #0a0d12, акценты #c9a35a / #e3c48a.
     Переопределяем только CSS-переменные библиотеки — она темизируется целиком через них. */
  .brackets-viewer {
    --primary-background: #0a0d12;
    --secondary-background: #141a24;
    --match-background: #111721;
    --font-color: #e8e8ea;
    --win-color: #e3c48a;
    --loss-color: #6b7280;
    --label-color: #c9a35a;
    --hint-color: #7c8797;
    --connector-color: #c9a35a;
    --border-color: #2a3444;
    --border-hover-color: #c9a35a;
    --border-selected-color: #e3c48a;
    --match-width: 180px;
    --round-margin: 48px;
    --match-border-radius: 0.25em;
    --participant-image-size: 1.15em;
  }
  /* точечные доработки, если переменных не хватило */
  .brackets-viewer h1 { color: #e3c48a; letter-spacing: .02em; }
  .brackets-viewer h2 { color: #c9a35a; }
  .brackets-viewer .participant.win .name { color: #e3c48a; }
</style>

<div id="bracket" class="brackets-viewer"></div>

<script type="module">
  const manager  = window.bracketsManager;
  const viewer   = window.bracketsViewer;

  // 1) данные (см. примеры 1/2)
  const data = await manager.get.tournamentData(2);

  // 2) логотипы команд — ДО render()
  viewer.setParticipantImages(
    data.participant.map(p => ({ participantId: p.id, imageUrl: `/img/teams/${p.id}.png` }))
  );

  // 3) локализация — ДО render()
  await viewer.addLocale('ru', {
    common: { 'round-name': 'Раунд {{roundNumber}}', 'round-name-final': 'Финал',
              bye: 'ПРОПУСК', 'best-of-x': 'До {{x}}' },
    'match-status': { locked: 'Заблокирован', waiting: 'Ожидание', ready: 'Готов',
                      running: 'Идёт', completed: 'Завершён', archived: 'Архив' },
    abbreviations: { win: 'В', loss: 'П', forfeit: 'Н', position: 'П', seed: '#',
                     'winner-bracket': 'ВС', 'loser-bracket': 'НС', match: 'М', 'grand-final': 'ГФ' },
  });
  window.localStorage['i18nextLng'] = 'ru';

  // 4) рендер. selector указывает на элемент, у которого УЖЕ есть class="brackets-viewer"
  await viewer.render(
    { stages: data.stage, matches: data.match, matchGames: data.match_game, participants: data.participant },
    {
      selector: '#bracket',
      clear: true,                          // всегда для перерисовки, иначе сетки накопятся
      showSlotsOrigin: true,
      showLowerBracketSlotsOrigin: true,
      highlightParticipantOnHover: true,
      separatedChildCountLabel: true,
      participantOriginPlacement: 'before',
      customRoundName: (info, t) => {
        // groupType приходит в дефисной форме: 'single-bracket' | 'winner-bracket' | 'loser-bracket' | 'final-group' | 'round-robin'
        if (info.fractionOfFinal === 1) return info.groupType === 'loser-bracket' ? 'Финал нижней сетки' : 'Финал';
        if (info.fractionOfFinal === 0.5) {
          const p = info.groupType === 'winner-bracket' ? 'ВС ' : info.groupType === 'loser-bracket' ? 'НС ' : '';
          return `${p}Полуфинал`;
        }
        return undefined;                  // undefined => дефолтное имя
      },
      onMatchClick: (match) => {
        // match.metadata: { stageType, games, label, roundNumber, roundCount, matchLocation, connection, originHint }
        console.log('клик по матчу', match.id, match.metadata.games.length, 'игр');
      },
    }
  );
</script>
```

### E.5 Пример 3-бис — то же, но на ESM-менеджере последней версии (если нужен именно 1.11.1)

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/brackets-viewer@1.9.1/dist/brackets-viewer.min.css">
<script src="https://cdn.jsdelivr.net/npm/brackets-viewer@1.9.1/dist/brackets-viewer.min.js"></script>
<div id="bracket" class="brackets-viewer"></div>
<script type="module">
  // viewer (рендер) — из IIFE-бандла выше; менеджер — свежий, по ESM
  import { BracketsManager } from 'https://cdn.jsdelivr.net/npm/brackets-manager@1.11.1/+esm';
  import { InMemoryDatabase } from 'https://cdn.jsdelivr.net/npm/brackets-memory-db@1.0.6/+esm';

  const manager = new BracketsManager(new InMemoryDatabase());
  await manager.create.stage({
    name: 'SE 4', tournamentId: 0, type: 'single_elimination',
    seeding: ['A', 'B', 'C', 'D'], settings: { size: 4 },
  });
  const data = await manager.get.tournamentData(0);
  await window.bracketsViewer.render(
    { stages: data.stage, matches: data.match, matchGames: data.match_game, participants: data.participant },
    { selector: '#bracket', clear: true }
  );
</script>
```
**[П]** — этот сценарий целиком выполнен в headless Chrome (ESM `create.stage` + рендер UMD-viewer'ом).

---

## Приложение: что именно было проверено фактически

**Скачано и просмотрено (fetch, HTTP 200):** npm-реестр (`/latest` для обоих пакетов, `time` для дат), jsDelivr Data API (полные списки файлов обоих пакетов), `brackets-viewer@1.9.1/README.md`, `demo/with-api.html` (тег v1.9.1), `demo/themes/dark.css`, список `demo/themes/`, GitHub Releases API для обоих репозиториев, док-сайт TypeDoc `Config.html` для v1.9.1.

**Скачано и проверено на существование/тип (Invoke-WebRequest, sha256-сверка с npm-тарболом):** все URL из таблицы раздела A, включая 404 для `brackets-viewer@1.9.1/+esm` и `dist/index.js`.

**Разобраны `.d.ts` из tarball'ов:** `brackets-manager/{manager,types,get,update,reset,find,index}.d.ts`, `brackets-model/{index,input,storage,unions,other}.d.ts`, `brackets-viewer/{main,types,dom,lang}.d.ts`.

**Запущено на реальном пакете в Node 24** (`npm i brackets-manager@1.11.1 brackets-memory-db@1.0.6 brackets-model@1.7.0`), 5 скриптов-проб: 6 разных конфигураций стадий (SE 4/6/8, DE 8 с `grandFinal` none/simple/double, `skipFirstRound`, `consolationFinal`, `manualOrdering` не проверялся), сценарии Bo1/Bo3, `update.match`/`update.matchGame`/`update.matchChildCount`/`update.seeding`/`reset.matchResults`/`reset.matchGameResults`, все 5 вариантов `seedOrdering`, поведение BYE, ошибки (не-степень-двойки, числовое сеяние, `reset.matchResults` на BoX-матче).

**Запущено в реальном headless Google Chrome** (`--headless=new --dump-dom`) на 4 HTML-страницах, загружающих библиотеки **с cdn.jsdelivr.net**: наличие глобалов, генерация SE-6 Bo3 и DE-8, ввод счёта по играм, рендер SE/DE/RR, полный DOM и классы, computed CSS-переменные после перекраски, `<img>` логотипа, `<h3>` после `addLocale('ru')`, поведение `clear`, ошибка «root must have a `.brackets-viewer` class», несколько стадий в одном рендере, `customRoundName`, `onMatchClick`, игнорирование несуществующих опций.
