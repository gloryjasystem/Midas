# Phase 2.0 — Execution Roadmap (SSOT)

> **Этот файл — единственный источник правды для выполнения Phase 2.0.**
> Каждая новая сессия ОБЯЗАНА начинаться с чтения этого файла.
> Ни одна задача не считается выполненной, пока она не отмечена `[x]` здесь.

---

## 🔒 Конституция выполнения

### Правило 1: Читай перед каждым действием
Перед началом ЛЮБОЙ работы в новой сессии — прочитай этот файл целиком.
Найди первую задачу со статусом `[ ]` — это твоя текущая задача.

### Правило 2: Одна задача за раз
Не начинай задачу N+1, пока задача N не отмечена `[x]` и не прошла верификацию.

### Правило 3: Верификация обязательна
После каждой задачи запускай `npx turbo build`. Если ошибки — чини до `[x]`.

### Правило 4: Не меняй то, что не в плане
Если видишь баг или улучшение вне плана — запиши в секцию «Заметки», но НЕ чини.

### Правило 5: Обратная совместимость
Старый `ed:` namespace должен работать как алиас `tx:` до конца Phase 2.0.
Slash-команда `/edit` должна редиректить на `tx:l:0:a` до Спринта 6.

### Правило 6: Архитектурные ограничения (из project_config.md)
- SEC-02: Никакого `Number()`, `parseFloat()` на финансовых данных
- SEC-03: Все SQL внутри `withTenantTransaction` + explicit `WHERE workspace_id = $1`
- SEC-12: Никаких сумм/описаний в логах
- Все DB-sourced строки → `escapeHtml()` перед HTML-рендером
- Все `callback_data` ≤ 64 bytes — проверять при создании

---

## 📋 Как давать мне задачу

> **Цикл работы:** ① Начать спринт → ② Продолжить работу (при необходимости) → ③ Проверить прогресс → ① Начать следующий спринт → …

Скопируй нужную команду в чат **в начале новой сессии**.

---

### ① Начать новый спринт:
```
Ты — Senior FinTech Engineer с 15+ лет опыта в enterprise-системах.

ОБЯЗАТЕЛЬНО: Прочитай файл C:\Users\secvency\Desktop\Midas\phase-2.0-roadmap.md ЦЕЛИКОМ перед любыми действиями.

Контекст:
- Это Telegram-бот для финансового учёта (Node.js/TypeScript/PostgreSQL/Redis)
- Архитектурные ограничения: project_config.md
- Текущее состояние кода: workflow_state.md

Задание:
1. Найди первую задачу со статусом [ ] — это начало текущего спринта.
2. Выполни ВСЕ задачи этого спринта последовательно (от первой [ ] до следующего "СПРИНТ N+1").
3. Для каждой задачи:
   a) Прочитай все указанные в задаче файлы перед изменениями
   b) Реализуй точно как описано — ни больше, ни меньше
   c) Проверь callback_data ≤ 64 bytes
   d) Проверь SEC-02 (нет Number/parseFloat на финансах), SEC-03 (withTenantTransaction)
   e) После реализации: обнови статус задачи на [x] в roadmap
   f) Запусти: npx turbo build (из C:\Users\secvency\Desktop\Midas\midas-monorepo)
   g) Если build fails — чини до зелёного, потом переходи к следующей задаче
4. НЕ трогай код вне текущего спринта.
5. НЕ рефактори существующий код, если это не указано в задаче.
6. По завершении спринта — выведи финальный отчёт:
   - Какие файлы изменены/созданы
   - Какие задачи выполнены
   - Результат последнего npx turbo build
```

---

### ② Продолжить работу:
```
Ты — Senior FinTech Engineer с 15+ лет опыта в enterprise-системах.

ОБЯЗАТЕЛЬНО: Прочитай файл C:\Users\secvency\Desktop\Midas\phase-2.0-roadmap.md ЦЕЛИКОМ.

Контекст:
- Предыдущая сессия была прервана — работа не завершена.
- Найди первую задачу со статусом [/] (in progress) или [ ] (не начата) в текущем спринте.

Задание:
1. Определи текущий спринт по первой незавершённой задаче.
2. Если есть задача [/] — завершии её первой.
3. Продолжи выполнение оставшихся [ ] задач в этом же спринте.
4. Для каждой задачи:
   a) Прочитай ВСЕ файлы, которые ты будешь менять, перед изменениями
   b) Реализуй строго по описанию в roadmap
   c) Обнови статус на [x] в roadmap после завершения
   d) Запусти npx turbo build после каждой задачи
5. НЕ переходи к следующему спринту — только текущий.
6. По завершении — выведи:
   - Что было сделано
   - Что осталось (если не всё успел)
   - Результат npx turbo build
```

---

### ③ Проверить прогресс:
```
Прочитай файл C:\Users\secvency\Desktop\Midas\phase-2.0-roadmap.md

Выполни ТОЛЬКО анализ, БЕЗ изменений кода:

1. Посчитай задачи по статусам: [x] выполнено, [/] в работе, [ ] не начато.
2. Определи текущий спринт и прогресс внутри него.
3. Покажи таблицу:
   | Спринт | Всего задач | [x] | [/] | [ ] | Статус |
4. Проверь, что последние изменённые файлы соответствуют завершённым задачам.
5. Запусти npx turbo build и покажи результат.
6. Если есть ошибки сборки — укажи, какая задача их вероятно вызвала.
7. Дай рекомендацию: что делать дальше (какой промпт использовать).
```

---

## 🗂 Файловая карта проекта

```
apps/telegram-bot/src/
├── routes/
│   └── webhook.route.ts          ← MODIFY: добавить tx:, rp: handlers
├── services/
│   ├── balance.service.ts        ← KEEP: без изменений
│   ├── edit.service.ts           ← KEEP: переиспользуем SQL/типы
│   ├── edit-keyboard.service.ts  ← KEEP: deprecated alias
│   ├── report.service.ts         ← KEEP: backward compat (/report)
│   ├── settings.service.ts       ← MODIFY: расширить preferences
│   ├── settings-keyboard.service.ts ← MODIFY: расширить меню
│   ├── transaction-hub.service.ts   ← NEW (Sprint 1)
│   ├── transaction-keyboard.service.ts ← NEW (Sprint 1)
│   ├── report-advanced.service.ts   ← NEW (Sprint 4)
│   ├── report-keyboard.service.ts   ← NEW (Sprint 4)
│   └── settings-advanced.service.ts ← NEW (Sprint 5)
├── utils/
│   └── screen-builder.ts         ← MODIFY: добавить NAV_BTN_TRANSACTIONS
└── ...
packages/database/migrations/
    └── {timestamp}_phase-2-0-preferences.js ← NEW (Sprint 5)
```

---

## 🏃 СПРИНТ 1 — Фундамент: Кнопка «Транзакции»

### Задача 1.1 — Добавить кнопку в ReplyKeyboard
- **Статус:** `[x]`
- **Файл:** `apps/telegram-bot/src/utils/screen-builder.ts`
- **Действие:**
  1. Добавить константу: `export const NAV_BTN_TRANSACTIONS = '📋 Транзакции';`
  2. **Обновить иконки** — у каждой кнопки уникальная:
     ```typescript
     export const NAV_BTN_BALANCE      = '💰 Баланс';      // было 📊 → 💰
     export const NAV_BTN_TRANSACTIONS = '📋 Транзакции';  // NEW
     export const NAV_BTN_REPORT       = '📊 Отчёт';       // было 📋 → 📊
     export const NAV_BTN_SETTINGS     = '⚙️ Настройки';   // без изменений
     ```
  3. Обновить `buildMainMenuKeyboard()` — **2 строки по 2 кнопки**:
     ```typescript
     keyboard: [
       [NAV_BTN_BALANCE, NAV_BTN_TRANSACTIONS],
       [NAV_BTN_REPORT, NAV_BTN_SETTINGS],
     ],
     ```
- **Верификация:** `npx turbo build` — 0 errors

### Задача 1.2 — Создать transaction-hub.service.ts
- **Статус:** `[x]`
- **Файл:** `apps/telegram-bot/src/services/transaction-hub.service.ts` (NEW)
- **Экспорты:**
  ```typescript
  // Типы
  export interface TxListItem {
    id: string;
    base_amount: string;        // NUMERIC string (SEC-02)
    base_currency: string;
    transaction_intent: string;
    transaction_time: string;   // ISO
    category_name: string;
    item_name: string | null;
  }

  export interface MonthMiniStats {
    expense_count: number;
    income_count: number;
    debt_count: number;
    expense_total: string;      // NUMERIC string
    income_total: string;       // NUMERIC string
    currency: string;           // workspace default_currency
  }

  export type IntentFilter = 'a' | 'e' | 'i' | 'd'; // all/expense/income/debt

  export const TX_PAGE_SIZE = 8;

  // Функции
  export async function getTransactionList(
    workspaceId: string, userId: string,
    page: number, filter: IntentFilter
  ): Promise<TxListItem[]>;

  export async function countFilteredTransactions(
    workspaceId: string, userId: string,
    filter: IntentFilter
  ): Promise<number>;

  export async function getMonthMiniStats(
    workspaceId: string, userId: string
  ): Promise<MonthMiniStats>;

  export async function searchByName(
    workspaceId: string, userId: string, query: string
  ): Promise<TxListItem[]>;

  export async function searchByAmount(
    workspaceId: string, userId: string, amount: string
  ): Promise<TxListItem[]>;

  export async function searchByCategory(
    workspaceId: string, userId: string, categoryId: string
  ): Promise<TxListItem[]>;
  ```
- **SQL для getTransactionList:**
  ```sql
  SELECT t.id, ROUND(t.base_amount,2)::text AS base_amount,
         t.base_currency, t.transaction_intent,
         t.transaction_time::text,
         COALESCE(c.name,'—') AS category_name,
         t.item_name
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.workspace_id = $1
    AND t.deleted_at IS NULL
    AND (
      $2 = 'a'
      OR ($2 = 'e' AND t.transaction_intent = 'expense')
      OR ($2 = 'i' AND t.transaction_intent = 'income')
      OR ($2 = 'd' AND t.transaction_intent IN ('debt_given','debt_received'))
    )
  ORDER BY t.transaction_time DESC
  LIMIT $3 OFFSET $4
  ```
- **SQL для getMonthMiniStats:**
  ```sql
  SELECT
    COUNT(*) FILTER (WHERE transaction_intent = 'expense')::int AS expense_count,
    COUNT(*) FILTER (WHERE transaction_intent = 'income')::int AS income_count,
    COUNT(*) FILTER (WHERE transaction_intent IN ('debt_given','debt_received'))::int AS debt_count,
    COALESCE(SUM(base_amount) FILTER (WHERE transaction_intent = 'expense'), 0) AS expense_total,
    COALESCE(SUM(base_amount) FILTER (WHERE transaction_intent = 'income'), 0) AS income_total
  FROM transactions
  WHERE workspace_id = $1
    AND deleted_at IS NULL
    AND transaction_time >= date_trunc('month', NOW())
    AND transaction_time < date_trunc('month', NOW()) + interval '1 month'
  ```
- **Правила:** Все SQL через `withTenantTransaction`. Все строки `escapeHtml`. Поиск реализуется в Sprint 3 (stub с `throw` пока).
- **Верификация:** `npx turbo build` — 0 errors

### Задача 1.3 — Создать transaction-keyboard.service.ts
- **Статус:** `[x]`
- **Файл:** `apps/telegram-bot/src/services/transaction-keyboard.service.ts` (NEW)
- **Экспорты:**
  ```typescript
  // ── Keyboards ──
  export function buildTxListKeyboard(
    items: TxListItem[], page: number, totalPages: number,
    activeFilter: IntentFilter
  ): InlineKeyboardMarkup;

  export function buildSearchMenuKeyboard(): InlineKeyboardMarkup;

  export function buildSearchResultsKeyboard(
    items: TxListItem[]
  ): InlineKeyboardMarkup;

  // ── Formatting ──
  export function formatTxListHeader(
    stats: MonthMiniStats, filter: IntentFilter
  ): string;

  // ── Parser ──
  export type TxCallbackCmd =
    | { cmd: 'list'; page: number; filter: IntentFilter }
    | { cmd: 'view'; txId: string }
    | { cmd: 'search_menu' }
    | { cmd: 'search_name' }
    | { cmd: 'search_amount' }       // tx:s:amt (ISSUE-6: не tx:s:a — путается с filter 'a')
    | { cmd: 'search_category' }
    | { cmd: 'search_cat_result'; catId: string }
    | { cmd: 'field_amount'; txId: string }    // tx:f:amt (ISSUE-2: = ed:f:amt)
    | { cmd: 'field_cat'; txId: string; page: number } // tx:f:cat (= ed:f:cat)
    | { cmd: 'field_acc'; txId: string }       // tx:f:acc (= ed:f:acc)
    | { cmd: 'field_int'; txId: string }       // tx:f:int (= ed:f:int)
    | { cmd: 'delete_ask'; txId: string }      // tx:d:ask (= ed:d:ask)
    | { cmd: 'delete_confirm'; txId: string }  // tx:d:yes (= ed:d:yes)
    | { cmd: 'confirm_cat'; txId: string; catId: string }
    | { cmd: 'confirm_acc'; txId: string; accId: string }
    | { cmd: 'confirm_int'; txId: string; intent: string }
    | { cmd: 'cancel' };

  export function parseTxCallback(data: string): TxCallbackCmd | null;
  ```
- **buildTxListKeyboard layout:**
  ```
  Row 0: [💸 Расходы] [💰 Доходы] [📋 Все]     ← filter row
  Row 1: [🔍 Поиск]                              ← search
  Row 2..N: [emoji category — amount CUR  date]  ← tx buttons (8 max)
  Row N+1: [◀️] [1/7] [▶️]                       ← pagination
  ```
- **callback_data byte verification table** (ISSUE-2: `tx:f:` = `ed:f:` для чистого remap):
  ```
  tx:l:0:a      = 8 bytes ✓
  tx:l:99:e     = 9 bytes ✓
  tx:v:{26}     = 31 bytes ✓
  tx:s          = 4 bytes ✓
  tx:s:n        = 6 bytes ✓
  tx:s:amt      = 8 bytes ✓  (ISSUE-6: было tx:s:a)
  tx:s:c        = 6 bytes ✓
  tx:s:cv:{26}  = 33 bytes ✓
  tx:f:amt:{26} = 35 bytes ✓  (ISSUE-2: было tx:e:amt)
  tx:f:cat:{26}:{page} = 38 bytes ✓
  tx:f:acc:{26} = 35 bytes ✓
  tx:f:int:{26} = 35 bytes ✓
  tx:c:cat:{26}:{26} = 54 bytes ✓  (max)
  tx:c:acc:{26}:{26} = 54 bytes ✓
  tx:d:ask:{26} = 36 bytes ✓  (ISSUE-2: было tx:e:d)
  tx:d:yes:{26} = 36 bytes ✓  (ISSUE-2: было tx:e:dy)
  tx:x          = 4 bytes ✓
  ```
- **Верификация:** `npx turbo build` — 0 errors

### Задача 1.4 — Webhook handler: NAV_BTN_TRANSACTIONS
- **Статус:** `[x]`
- **Файл:** `apps/telegram-bot/src/routes/webhook.route.ts`
- **Действие:**
  1. Import `NAV_BTN_TRANSACTIONS` из screen-builder
  2. Import service и keyboard функции
  3. Добавить handler (после `NAV_BTN_SETTINGS` block, ~line 1788):
     ```typescript
     if (navText === NAV_BTN_TRANSACTIONS) {
       try {
         const resolved = await resolveWorkspace(telegramUserId, chatId);
         const [items, total, stats] = await Promise.all([
           getTransactionList(resolved.workspaceId, resolved.userId, 0, 'a'),
           countFilteredTransactions(resolved.workspaceId, resolved.userId, 'a'),
           getMonthMiniStats(resolved.workspaceId, resolved.userId),
         ]);
         if (total === 0) {
           void upsertBotMessage(telegramUserId, chatId,
             '📋 <b>Транзакции</b>\n\nТранзакций пока нет.');
         } else {
           const totalPages = Math.max(1, Math.ceil(total / TX_PAGE_SIZE));
           const header = formatTxListHeader(stats, 'a');
           const keyboard = buildTxListKeyboard(items, 0, totalPages, 'a');
           void upsertBotMessage(telegramUserId, chatId, header, keyboard);
         }
       } catch (err) { /* error handler pattern */ }
       await reply.status(200).send({ ok: true });
       return;
     }
     ```
- **Верификация:** `npx turbo build` + деплой → нажать «📋 Транзакции» → видим список

### Задача 1.5 — Webhook handler: tx: callback routing
- **Статус:** `[x]`
- **Файл:** `apps/telegram-bot/src/routes/webhook.route.ts`
- **Действие:** Добавить callback block (перед `ed:` block):
  ```typescript
  if (callbackData.startsWith('tx:')) {
    const cmd = parseTxCallback(callbackData);
    if (!cmd) { /* reject */ }
    // Route by cmd.cmd — list, view, search_menu, edit_*, delete_*, confirm_*
    // Переиспользуем edit.service.ts функции для view/edit/delete
  }
  ```
- **Ключевое:** Handlers для `list`, `view`, `cancel` в этом спринте.
  Handlers для `field_*`, `delete_*`, `confirm_*` — копируем логику из существующего `ed:` block, заменяя namespace.
- **ISSUE-7 — метод отправки:** Все callback handlers используют **`editMessageText`** (редактируем inline-сообщение).
  НИКОГДА `upsertBotMessage` из callback! (`upsertBotMessage` только для NAV_BTN text handlers).
- **Верификация:** Тап по транзакции → карточка → редактирование → назад к списку

### Задача 1.6 — ed: → tx: алиас
- **Статус:** `[x]`
- **Файл:** `apps/telegram-bot/src/routes/webhook.route.ts`
- **Действие:** В начале `ed:` block добавить редирект:
  ```typescript
  // Phase 2.0: ed: is deprecated alias for tx:
  // ISSUE-2 FIX: структура совпадает (tx:f: = ed:f:, tx:d: = ed:d:, tx:v: = ed:v:)
  // Поэтому простой prefix remap работает:
  if (callbackData.startsWith('ed:')) {
    const remapped = 'tx:' + callbackData.slice(3);
    // ed:l:0 → tx:l:0 — нет фильтра, parseTxCallback добавит default 'a'
    // ed:v:{id} → tx:v:{id} — точное совпадение
    // ed:f:amt:{id} → tx:f:amt:{id} — точное совпадение
    // ed:d:ask:{id} → tx:d:ask:{id} — точное совпадение
    // Re-route to tx: handler
  }
  ```
- **Важно:** `parseTxCallback` должен поддерживать `tx:l:{page}` **без фильтра** (default `'a'`):
  ```typescript
  if (sub === 'l') {
    const page = parseInt(parts[2] ?? '0', 10);
    const filter = (parts[3] ?? 'a') as IntentFilter;
    return { cmd: 'list', page, filter };
  }
  ```
- **Верификация:** Старые кнопки [✏️ Изменить] с `ed:v:{txId}` всё ещё работают

---

## 🏃 СПРИНТ 2 — Фильтры

### Задача 2.1 — Параметризовать SQL фильтр
- **Статус:** `[x]`
- **Уже сделано в 1.2** — SQL принимает `filter` параметр. Убедиться, что работает.

### Задача 2.2 — Мини-статистика в заголовке
- **Статус:** `[x]`
- **Файл:** `transaction-keyboard.service.ts`
- **formatTxListHeader output:**
  ```
  Фильтр 'a': "📋 Транзакции\n\nЗа май: 62 расхода · 18 доходов · 7 долгов"
  Фильтр 'e': "📋 Расходы за май (62 шт. · 32,150.00 USDT)"
  Фильтр 'i': "📋 Доходы за май (18 шт. · 45,200.00 USDT)"
  ```

### Задача 2.3 — Кнопка ✓ на активном фильтре
- **Статус:** `[x]`
- **Файл:** `transaction-keyboard.service.ts`
- **Логика:** В `buildTxListKeyboard`, filter row:
  ```typescript
  const eLabel = activeFilter === 'e' ? '💸 Расходы ✓' : '💸 Расходы';
  ```

### Задача 2.4 — Пагинация сохраняет фильтр
- **Статус:** `[x]`
- **callback_data:** `tx:l:{page}:{filter}` — фильтр встроен в callback
- **Верификация:** [💸 Расходы] → ▶️ → страница 2 расходов (не всех)

---

## 🏃 СПРИНТ 3 — Поиск

### Задача 3.1 — Меню поиска
- **Статус:** `[x]`
- **Handler:** `tx:s` → показать `buildSearchMenuKeyboard()`

### Задача 3.2 — Поиск по названию
- **Статус:** `[x]`
- **Flow:**
  1. `tx:s:n` → Redis SET `midas:tx:search:{tgUserId}:{chatId}` = `name`, EX 120
  2. Бот: «📝 Напиши название товара или услуги:»
  3. Webhook text intercept (ПЕРЕД ai-parse): проверить Redis key
  4. `searchByName()` → SQL `WHERE item_name ILIKE '%' || $2 || '%'`
  5. Результат: `buildSearchResultsKeyboard(items)` + «🔍 Результаты поиска (N):»
- **Redis key:** `midas:tx:search:{tgUserId}:{chatId}`, TTL 120s
- **Webhook intercept location:** После clar: intercept, перед ac: onboarding check

### Задача 3.3 — Поиск по сумме
- **Статус:** `[x]`
- **Flow:** Аналогично 3.2, Redis value = `amount`
- **Callback:** `tx:s:amt` (ISSUE-6: не `tx:s:a`, чтобы не путать с filter 'a')
- **SQL:** `WHERE ROUND(t.base_amount, 2) = $2::numeric`

### Задача 3.4 — Поиск по категории
- **Статус:** `[x]`
- **Flow:**
  1. `tx:s:c` → показать category picker (переиспользуем `getWorkspaceCategories`)
  2. `tx:s:cv:{catId}` → `searchByCategory()` → результаты
- **Без Redis intercept** — всё через callbacks

### Задача 3.5 — Верификация поиска (E2E)
- **Статус:** `[x]`
- **Тесты:**
  - Поиск «кофе» → найдены транзакции
  - Поиск «1000» → найдены транзакции на 1000
  - Поиск по категории «Продукты» → фильтрация
  - Поиск при 0 результатов → «Ничего не найдено»
  - Таймаут Redis intercept (120s) → следующее сообщение идёт в AI-parse

### Задача 3.6 — GIN index миграция (ISSUE-5)
- **Статус:** `[x]`
- **Файл:** `packages/database/migrations/{ts}_phase-2-0-gin-search.js`
- **SQL:**
  ```sql
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX CONCURRENTLY idx_tx_item_name_gin
    ON transactions USING gin(item_name gin_trgm_ops);
  ```
- **Зачем:** Без GIN index `ILIKE '%query%'` выполняет seq scan — медленно при росте данных.
- **Верификация:** `EXPLAIN SELECT ... WHERE item_name ILIKE '%test%'` — должен показывать Bitmap Index Scan

### Задача 3.7 — Поиск по дате (Вариант 1 «Быстрые периоды»)
- **Статус:** `[ ]`
- **Контекст:** Дата транзакций хранится в поле `transaction_time` (timestamptz). Callback_data ≤ 64 байт. Redis intercept для ввода конкретной даты.
- **UX Flow:**
  ```
  [🔍 Поиск] → [📅 По дате]
      ↓
  ┌─────────────────────────────┐
  │  📅 Выбери период           │
  │                             │
  │  [📆 Сегодня]               │
  │  [📅 Вчера]                 │
  │  [🗓 Эта неделя]            │
  │  [📊 Этот месяц]            │
  │  [✏️ Ввести дату вручную]   │
  │  [◀️ Назад]                 │
  └─────────────────────────────┘
      ↓ (если «Сегодня»)
  ✅ Результаты за 10.05.2026 (5 транзакций)
  [💸 Кофе  150.00 USDT  10.05]
  ...
  [🔍 Новый поиск]  [◀️ К списку]
      ↓ (если «Ввести дату вручную»)
  📝 Введи дату в формате: ДД.ММ или ДД.ММ.ГГГГ
  Примеры: 10.05, 01.05.2026, 15.04
  [◀️ Отмена]
  ```
- **Файлы:**
  1. `apps/telegram-bot/src/services/transaction-keyboard.service.ts`
  2. `apps/telegram-bot/src/services/transaction-hub.service.ts`
  3. `apps/telegram-bot/src/routes/webhook.route.ts`
- **Изменения в `transaction-keyboard.service.ts`:**
  ```diff
  // buildSearchMenuKeyboard — добавить кнопку "По дате"
  + [{ text: '📅 По дате', callback_data: 'tx:s:dt' }],

  // Новая функция buildDatePickerKeyboard()
  [{ text: '📆 Сегодня',      callback_data: 'tx:s:dt:today' }],
  [{ text: '📅 Вчера',        callback_data: 'tx:s:dt:yday' }],
  [{ text: '🗓 Эта неделя',   callback_data: 'tx:s:dt:week' }],
  [{ text: '📊 Этот месяц',   callback_data: 'tx:s:dt:month' }],
  [{ text: '✏️ Ввести дату',  callback_data: 'tx:s:dt:custom' }],
  [{ text: '◀️ Назад',        callback_data: 'tx:s' }],
  ```
- **Расширение `TxCallbackCmd`:**
  ```typescript
  | { cmd: 'search_date_menu' }                                        // tx:s:dt
  | { cmd: 'search_date_preset'; preset: 'today'|'yday'|'week'|'month' } // tx:s:dt:{preset}
  | { cmd: 'search_date_custom' }                                      // tx:s:dt:custom
  | { cmd: 'search_results_page'; page: number }                       // tx:sr:p:{page} (пагинация)
  ```
- **Byte verification:**
  ```
  tx:s:dt           = 7 bytes  ✓
  tx:s:dt:today     = 13 bytes ✓
  tx:s:dt:yday      = 12 bytes ✓
  tx:s:dt:week      = 12 bytes ✓
  tx:s:dt:month     = 13 bytes ✓
  tx:s:dt:custom    = 14 bytes ✓
  ```
- **Новая функция `searchByDateRange` в `transaction-hub.service.ts`:**
  ```typescript
  export async function searchByDateRange(
    workspaceId: string,
    userId: string,
    from: string,   // ISO date string (inclusive)
    to: string,     // ISO date string (exclusive)
    page: number
  ): Promise<{ items: TxListItem[]; total: number }>;
  // SQL:
  // WHERE workspace_id = $1
  //   AND deleted_at IS NULL
  //   AND transaction_time >= $2::timestamptz
  //   AND transaction_time <  $3::timestamptz
  // ORDER BY transaction_time DESC
  // LIMIT SEARCH_PAGE_SIZE OFFSET $4
  ```
- **Обработчики в `webhook.route.ts`:**
  - `search_date_menu` → `editMessageText(buildDatePickerKeyboard())`
  - `search_date_preset` → вычислить `from/to` по пресету → `searchByDateRange()` → `buildSearchResultsKeyboard()` → сохранить контекст в `midas:tx:sr:ctx:{uid}:{cid}`
  - `search_date_custom` → Redis SET `midas:tx:search:{uid}:{cid}` = `'date'`, EX 120 → промпт ввода + `[◀️ Отмена]`
  - Текстовый интерцепт `state === 'date'`: парсить `ДД.ММ` / `ДД.ММ.ГГГГ` → если невалидно → «Неверный формат. Попробуй ещё раз» → `searchByDateRange()`
- **Логика пресетов (UTC-aware):**
  ```typescript
  today  → [startOfToday, startOfTomorrow)
  yday   → [startOfYesterday, startOfToday)
  week   → [startOfCurrentWeek(Mon), now)
  month  → [startOfCurrentMonth, now)
  ```
- **Пагинация при поиске по дате:** Переиспользовать механизм `midas:tx:sr:ctx` TTL 600s (Phase 2.3). Тип контекста: `{ t: 'date', f: from, to: to, lb: label }`
- **Верификация:**
  - «Сегодня» → транзакции за текущий день
  - «Эта неделя» → транзакции с понедельника
  - «Ввести дату» → `10.05` → транзакции за 10 мая
  - «Ввести дату» → `10.05.2026` → то же самое
  - Невалидная дата → сообщение об ошибке, Redis intercept остаётся активным
  - 0 результатов → «Транзакций за выбранный период нет»
  - `[◀️ Отмена]` при ручном вводе → `buildSearchMenuKeyboard()` без удаления Redis ключа

---

## 🏃 СПРИНТ 4 — Отчёты 2.0

### Задача 4.1 — report-keyboard.service.ts
- **Статус:** `[x]`
- **Файл:** `apps/telegram-bot/src/services/report-keyboard.service.ts` (NEW)
- **Period picker layout:**
  ```
  [Сегодня]   [Вчера]
  [Эта неделя] [Прошлая]
  [Этот месяц] [Прошлый]
  [3 месяца]   [Год]
  ```
- **Sub-menu (после выбора периода):**
  ```
  [📋 Сводка]  [📊 Категории]
  [💸 Расходы] [💰 Доходы]
  [📈 Сравнение] [🏦 По счетам]
  [◀️ Выбрать период]
  ```
- **Полная таблица callback_data:**

  | callback | Действие | Bytes |
  |---|---|---|
  | `rp:p` | Period picker menu | 4 |
  | `rp:p:td` | Сегодня | 7 |
  | `rp:p:yd` | Вчера | 7 |
  | `rp:p:tw` | Эта неделя | 7 |
  | `rp:p:lw` | Прошлая неделя | 7 |
  | `rp:p:tm` | Этот месяц | 7 |
  | `rp:p:lm` | Прошлый месяц | 7 |
  | `rp:p:3m` | 3 месяца | 7 |
  | `rp:p:yr` | Год | 7 |
  | `rp:sum` | Общая сводка | 6 |
  | `rp:cat` | По категориям | 6 |
  | `rp:exp` | Только расходы | 6 |
  | `rp:inc` | Только доходы | 6 |
  | `rp:cmp` | Сравнение с прошлым | 6 |
  | `rp:acc` | По счетам | 6 |
  | `rp:bk` | Назад к period picker | 5 |

  All ≤ 64 bytes ✓

- **Экспорты:**
  ```typescript
  export function buildPeriodPickerKeyboard(): InlineKeyboardMarkup;
  export function buildReportSubMenuKeyboard(): InlineKeyboardMarkup;
  export type RpCallbackCmd =
    | { cmd: 'period_picker' }
    | { cmd: 'set_period'; code: string } // td/yd/tw/lw/tm/lm/3m/yr
    | { cmd: 'summary' } | { cmd: 'categories' }
    | { cmd: 'expenses' } | { cmd: 'income' }
    | { cmd: 'comparison' } | { cmd: 'accounts' }
    | { cmd: 'back' };
  export function parseRpCallback(data: string): RpCallbackCmd | null;
  ```

### Задача 4.2 — report-advanced.service.ts
- **Статус:** `[x]`
- **Файл:** `apps/telegram-bot/src/services/report-advanced.service.ts` (NEW)
- **Все функции:**
  ```typescript
  export async function getReportSummary(wId, uId, start, end): Promise<string>;
  export async function getCategoryBreakdown(wId, uId, start, end, intent?): Promise<string>;
  export async function getExpenseOnlyReport(wId, uId, start, end): Promise<string>;
  export async function getIncomeOnlyReport(wId, uId, start, end): Promise<string>;
  export async function getComparisonReport(wId, uId, curStart, curEnd): Promise<string>;
  export async function getAccountMovements(wId, uId, start, end): Promise<string>;
  // Helpers (internal)
  function getMostExpensiveDay(wId, uId, start, end): Promise<{date, total}>;
  function getDailyAverage(wId, uId, start, end): Promise<string>;
  function renderBar(value: number, max: number, width?: number): string;
  function renderTrend(current: number, previous: number): string;
  ```
- **Формат вывода getReportSummary:**
  ```
  📊 Отчёт: Май 2026

  💰 Доходы:       45,200.00 USDT
  💸 Расходы:      -32,150.00 USDT
  ━━━━━━━━━━━━━━━━━━━━━
  📈 Баланс:       +13,050.00 USDT

  📊 Всего операций: 87
     └ Расходов: 62 · Доходов: 18 · Долгов: 7

  📅 Самый дорогой день: 5 мая (4,200 USDT)
  📅 Средний расход/день: 1,030 USDT/день
  ```
- **Формат вывода getCategoryBreakdown:**
  ```
  📊 TOP категории расходов (Май 2026):

  1. Продукты        ████████░░  42%  13,503 USDT
  2. Кафе            ████░░░░░░  18%   5,787 USDT
  3. Транспорт       ███░░░░░░░  14%   4,501 USDT
  4. Подписки        ██░░░░░░░░   8%   2,572 USDT
  5. Развлечения     █░░░░░░░░░   5%   1,607 USDT
  6. Другое          ░░░░░░░░░░  13%   4,180 USDT
  ```
- **Формат вывода getComparisonReport:**
  ```
  📈 Сравнение: Май vs Апрель 2026

              Май          Апрель      Δ
  💰 Доходы   45,200      40,100      +12.7% ↑
  💸 Расходы  32,150      28,900      +11.2% ↑
  📈 Баланс   +13,050     +11,200     +16.5% ↑

  📊 Категории с ростом расходов:
    ⬆️ Продукты: +2,100 (+18%)
    ⬇️ Транспорт: -300 (-6%)
  ```
- **renderBar:** `'█'.repeat(filled) + '░'.repeat(width - filled)`
- **renderTrend:** `'+12.7% ↑'` / `'-6% ↓'` / `'0%'`

### Задача 4.3 — Period storage в Redis
- **Статус:** `[x]`
- **Key:** `midas:rp:period:{tgUserId}:{chatId}`
- **Value:** `{startISO}|{endISO}`
- **TTL:** 600s
- **При выборе периода:** SET key → показать sub-menu
- **При нажатии sub-menu:** GET key → parse dates → query
- **Period code → date math:**
  ```typescript
  td → [startOfToday, endOfToday]
  yd → [startOfYesterday, endOfYesterday]
  tw → [startOfWeek(mon), now]
  lw → [startOfLastWeek, endOfLastWeek]
  tm → [startOfMonth, now]
  lm → [startOfLastMonth, endOfLastMonth]
  3m → [3 months ago, now]
  yr → [startOfYear, now]
  ```

### Задача 4.4 — Webhook handlers rp:
- **Статус:** `[x]`
- **В webhook.route.ts:** новый block `if (callbackData.startsWith('rp:'))`
- **Handler flow:**
  1. `rp:p` → `buildPeriodPickerKeyboard()` → editMessageText
  2. `rp:p:{code}` → вычислить dates → Redis SET → `buildReportSubMenuKeyboard()` → editMessageText
  3. `rp:sum` → Redis GET → `getReportSummary()` → editMessageText
  4. `rp:cat` → Redis GET → `getCategoryBreakdown()` → editMessageText
  5. `rp:exp` → Redis GET → `getExpenseOnlyReport()` → editMessageText
  6. `rp:inc` → Redis GET → `getIncomeOnlyReport()` → editMessageText
  7. `rp:cmp` → Redis GET → `getComparisonReport()` → editMessageText
  8. `rp:acc` → Redis GET → `getAccountMovements()` → editMessageText
  9. `rp:bk` → `buildPeriodPickerKeyboard()` → editMessageText

### Задача 4.5 — Верификация отчётов
- **Статус:** `[x]`
- **Тесты:**
  - Period picker → все 8 кнопок рендерят sub-menu
  - Сводка → доходы/расходы/баланс/операции/дорогой день/средний
  - Категории → bar chart с процентами
  - Только расходы → детализация расходов
  - Только доходы → детализация доходов
  - Сравнение → Δ% с прошлым периодом
  - По счетам → движение средств
  - Пустой период → «Нет данных за выбранный период»

---

## 🏃 СПРИНТ 5 — Настройки 2.0

### Задача 5.1 — Миграция: user_preferences
- **Статус:** `[x]`
- **Файл:** `packages/database/migrations/{ts}_phase-2-0-preferences.js`
- **SQL:**
  ```sql
  CREATE TABLE user_preferences (
    id VARCHAR(26) PRIMARY KEY,
    workspace_id VARCHAR(26) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    daily_summary_enabled BOOLEAN NOT NULL DEFAULT false,
    daily_summary_hour SMALLINT NOT NULL DEFAULT 21,
    limit_alerts_enabled BOOLEAN NOT NULL DEFAULT false,
    record_reminder_enabled BOOLEAN NOT NULL DEFAULT false,
    number_format TEXT NOT NULL DEFAULT 'ru',
    language TEXT NOT NULL DEFAULT 'ru',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id)
  );
  ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
  CREATE POLICY user_preferences_tenant ON user_preferences
    USING (workspace_id = current_setting('app.current_workspace_id'));
  GRANT SELECT, INSERT, UPDATE ON user_preferences TO midas_app;
  ```

### Задача 5.2 — settings-advanced.service.ts
- **Статус:** `[x]`
- **Файл:** `apps/telegram-bot/src/services/settings-advanced.service.ts` (NEW)
- **Функции:**
  ```typescript
  export async function getUserPreferences(wId, uId): Promise<UserPrefs>;
  export async function updateNotificationSetting(wId, uId, key, value): Promise<void>;
  export async function updateNumberFormat(wId, uId, format: 'ru'|'en'|'de'): Promise<void>;
  export async function updateLanguage(wId, uId, lang: 'ru'|'en'|'ua'): Promise<void>;
  export async function getWorkspaceStats(wId, uId): Promise<WorkspaceStats>;
  export async function exportTransactionsCSV(wId, uId, start, end): Promise<Buffer>;
  ```
- **getWorkspaceStats вывод:**
  ```
  ℹ️ О Midas

  📱 Версия: 2.0
  📊 Статистика:
     └ Всего транзакций: 342
     └ Категорий: 28
     └ Счетов: 4
     └ Первая запись: 04.05.2026
     └ Дней использования: 6
  ```
- **exportTransactionsCSV format:** `дата,тип,сумма,валюта,категория,счёт,товар`

### Задача 5.3 — Расширить settings keyboard
- **Статус:** `[x]`
- **Новый layout клавиатуры:**
  ```
  [✏️ Изменить валюту]
  [🏦 Счёт расходов] [🏦 Счёт доходов]
  [📁 Категории]     [🔔 Уведомления]
  [🔢 Формат чисел]  [🌍 Язык]
  [📤 Экспорт]       [ℹ️ О боте]
  ```
- **Полная таблица callback_data:**

  | callback | Действие | Bytes |
  |---|---|---|
  | `st:cat` | Категории: список | 6 |
  | `st:cat:a` | Добавить категорию (intercept) | 8 |
  | `st:cat:d:{catId}` | Удалить категорию | 35 |
  | `st:cat:r:{catId}` | Переименовать (intercept) | 35 |
  | `st:ntf` | Уведомления: меню | 6 |
  | `st:ntf:ds` | Toggle ежедневной сводки | 9 |
  | `st:ntf:hr:{h}` | Установить час сводки | 11 |
  | `st:ntf:la` | Toggle лимитов | 9 |
  | `st:ntf:rr` | Toggle напоминаний | 9 |
  | `st:nf` | Формат чисел: меню | 5 |
  | `st:nf:s:{fmt}` | Установить формат (ru/en/de) | 11 |
  | `st:lang` | Язык: меню | 7 |
  | `st:lang:s:{l}` | Установить язык (ru/en/ua) | 11 |
  | `st:exp` | Экспорт: меню | 6 |
  | `st:exp:csv` | Сгенерировать CSV | 10 |
  | `st:info` | О боте | 7 |

  All ≤ 64 bytes ✓

- **Экран уведомлений:**
  ```
  🔔 Уведомления

  📊 Ежедневная сводка:  ✅ Включена (21:00)
  ⚠️ Лимит по категории: ❌ Выключено
  📝 Напоминание записи: ❌ Выключено

  [📊 Сводка: вкл/выкл]
  [⏰ Время сводки]
  [⚠️ Лимиты]
  [📝 Напоминания]
  [← Назад]
  ```
- **Экран формата чисел:**
  ```
  🔢 Формат отображения

  Текущий: 1 234 567,89 (пробел + запятая)

  [1,234,567.89]  — англ.
  [1 234 567,89]  — рус. ✓
  [1.234.567,89]  — нем.
  [← Назад]
  ```

### Задача 5.4 — Webhook handlers st: (расширение)
- **Статус:** `[x]`
- **⚠️ ISSUE-1:** Расширить **существующий** `parseSettingsCallback()` в `settings-keyboard.service.ts`.
  НЕ создавать отдельный parser! Текущий parser вернёт `null` для неизвестных sub-commands → callback будет отвергнут.
  Нет конфликтов с существующими sub (`m`, `p`, `g`, `da`, `srch`, `back`, `n`, `v`, `x`) — новые `cat`, `ntf`, `nf`, `lang`, `exp`, `info` безопасны.
- **Новые handlers в существующем `st:` block:**
  1. `st:cat` → список категорий + [➕ Добавить] [🗑 Удалить]
  2. `st:cat:a` → Redis intercept для имени новой категории
  3. `st:cat:d:{catId}` → предупреждение + удаление
  4. `st:ntf` → экран уведомлений
  5. `st:ntf:ds` → toggle daily_summary_enabled
  6. `st:nf` → экран формата чисел
  7. `st:nf:s:{fmt}` → update number_format
  8. `st:lang` / `st:lang:s:{l}` → смена языка
  9. `st:exp:csv` → генерация CSV + sendDocument
  10. `st:info` → `getWorkspaceStats()` → экран статистики

### Задача 5.5 — Верификация настроек
- **Статус:** `[x]`
- **Тесты:**
  - Категории: список → добавить → появилась → удалить → исчезла
  - Уведомления: toggle → изменить час → вернуться → значение сохранено
  - Формат чисел: выбрать «en» → вернуться → отображается новый формат
  - CSV: сгенерировать → получили файл в чате
  - О боте: статистика корректна (кол-во транзакций совпадает)

---

## 🏃 СПРИНТ 6 — Полировка

### Задача 6.1 — Deprecate /edit
- **Статус:** `[x]`
- `/edit` → показать `tx:l:0:a` (список транзакций через новый UI)
- Удалить старый текстовый header из edit flow

### Задача 6.2 — Byte audit
- **Статус:** `[x]`
- **Команда:** Генерируем все callback_data комбинации → assert каждый ≤ 64
- Namespaces: `tx:`, `rp:`, `st:` (расширенные)

### Задача 6.3 — Security audit
- **Статус:** `[x]`
- **Проверки:**
  ```bash
  # SQL injection — нет string interpolation в SQL
  grep -rn "\${" services/*service.ts | grep -v callback_data
  # escapeHtml — все DB-sourced строки
  grep -rn "escapeHtml" services/
  # workspace_id — все запросы изолированы
  grep -rn "workspace_id" services/*service.ts
  ```

### Задача 6.4 — Обновить документацию
- **Статус:** `[x]`
- `project_config.md` — добавить Phase 2.0 секцию
- `product-roadmap.md` — отметить Phase 2.0 как завершённую

### Задача 6.5 — E2E smoke test (полный)
- **Статус:** `[x]`
- **Checklist:**

  | # | Шаг | Ожидание |
  |---|---|---|
  | 1 | Нажать «📋 Транзакции» | Список без дублирования |
  | 2 | «💸 Расходы» | Только расходы, ✓ на кнопке |
  | 3 | «💰 Доходы» | Только доходы |
  | 4 | «📋 Все» | Полный список |
  | 5 | Пагинация ▶️ | Страница 2, фильтр сохранён |
  | 6 | «🔍 Поиск» | Меню типа поиска |
  | 7 | «По названию» → «кофе» | Найдены транзакции |
  | 8 | «По сумме» → «1000» | Найдены транзакции |
  | 9 | «По категории» → Продукты | Фильтрация |
  | 10 | Тап по транзакции | Карточка с кнопками |
  | 11 | Изменить сумму | Сохранено |
  | 12 | Удалить транзакцию | Подтверждение → удалено |
  | 13 | «📋 Отчёт» | Period picker |
  | 14 | «Этот месяц» | Сводка |
  | 15 | «По категориям» | Unicode bar chart |
  | 16 | «Сравнение» | Δ с прошлым |
  | 17 | «⚙️ Настройки» | Расширенное меню |
  | 18 | «📁 Категории» | Список + добавить |
  | 19 | «🔔 Уведомления» | Toggle вкл/выкл |
  | 20 | «📤 Экспорт» | CSV в чат |

### Задача 6.6 — Zero Regression
- **Статус:** `[x]`
- **Перед финальным деплоем:**
  1. Запись транзакции через AI → подтверждение → работает
  2. Баланс → корректные суммы
  3. Настройки → валюта/timezone → сохраняются
  4. /start → онбординг → не сломан
  5. Старые `ed:v:{txId}` кнопки → всё ещё работают

---

## 📊 Матрица план → код

| ID | Фича | Service fn | Keyboard fn | Handler | SQL |
|---|---|---|---|---|---|
| TX-01 | Список транзакций | `getTransactionList` | `buildTxListKeyboard` | `tx:l:{p}:{f}` | ✓ |
| TX-02 | Фильтр расходов | filter='e' | ✓ mark | `tx:l:0:e` | ✓ |
| TX-03 | Поиск по имени | `searchByName` | `buildSearchResults` | `tx:s:n` | ILIKE |
| TX-04 | Поиск по сумме | `searchByAmount` | same | `tx:s:amt` | =numeric |
| TX-05 | Поиск по категории | `searchByCategory` | same | `tx:s:cv:{id}` | =catId |
| TX-06 | Карточка транзакции | reuse edit.svc | reuse edit-kb | `tx:v:{id}` | ✓ |
| TX-07 | Мини-статистика | `getMonthMiniStats` | `formatTxListHeader` | — | FILTER |
| RP-01 | Period picker | — | `buildPeriodPicker` | `rp:p:{code}` | — |
| RP-02 | Сводка | `getReportSummary` | — | `rp:sum` | ✓ |
| RP-03 | Категории chart | `getCategoryBreakdown` | — | `rp:cat` | GROUP BY |
| RP-04 | Сравнение | `getComparisonReport` | — | `rp:cmp` | 2x query |
| RP-05 | По счетам | `getAccountMovements` | — | `rp:acc` | GROUP BY |
| ST-01 | Категории CRUD | settings-adv | st keyboard | `st:cat*` | ✓ |
| ST-02 | Уведомления | `updateNotification` | st keyboard | `st:ntf*` | ✓ |
| ST-03 | Формат чисел | `updateNumberFormat` | st keyboard | `st:nf*` | ✓ |
| ST-04 | CSV экспорт | `exportCSV` | — | `st:exp:csv` | SELECT |
| ST-05 | О боте | `getWorkspaceStats` | — | `st:info` | COUNT |

---

## 📊 Прогресс

| Спринт | Задач | Выполнено | Статус |
|---|---|---|---|
| 1 — Фундамент | 6 | 6 | ✅ Завершён |
| 2 — Фильтры | 4 | 4 | ✅ Завершён |
| 3 — Поиск | 7 | 6 | ⏳ Задача 3.7 (поиск по дате) пендинг |
| 4 — Отчёты | 5 | 5 | ✅ Завершён |
| 5 — Настройки | 5 | 5 | ✅ Завершён |
| 6 — Полировка | 6 | 6 | ✅ Завершён |
| **Итого** | **33** | **32** | **97% — осталась задача 3.7** |

---

## 📝 Заметки (баги/идеи замеченные по ходу работы)

_Пусто — заполняется во время выполнения._
