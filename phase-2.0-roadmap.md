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

## 🏃 СПРИНТ 0 — Экспорт: Профессиональный Финансовый Документ

> **Это первый спринт Phase 2.0 — реализуется раньше всего остального.**
> Цель: превратить CSV-дамп в профессиональный финансовый документ уровня Revolut / Wise / Monobank.
> Референсы: Revolut Statement PDF, Wise Monthly Report, Monobank выписка, HSBC Online Banking Export.

---

### Задача 0.1 — Полярность сумм и человекочитаемый тип операции

- **Статус:** `[x]`
- **Файл:** `apps/telegram-bot/src/services/settings-advanced.service.ts`
- **Проблема:** Сейчас в документе:
  - числа без знака — `1000`, `10000`. Непонятно: это приход или расход?
  - тип операции — технический термин из БД: `expense`, `debt_given`. Пользователь не понимает.
  - два столбца «Сумма» и «Выплачено» дублируют информацию и путают.
- **Решение:**

**Таблица типов операций — что и как отображается:**

| Код в БД | Знак суммы | Отображение типа |
|---|---|---|
| `income` | `+ 10 000.00` | Доход |
| `expense` | `- 1 000.00` | Расход |
| `debt_given` | `- 1 000.00` | Долг выдан |
| `debt_received` | `+ 1 000.00` | Долг получен |
| `transfer` | `1 000.00` | Перевод |

**Правила форматирования числа:**
- Всегда ровно 2 знака после запятой: `1 000.00`, никогда `1000` или `1000.0`
- Разделитель тысяч — пробел: `10 000.00` (читается лучше чем `10,000.00` или `10.000,00`)
- Знак `+` у доходов обязателен — без него `10 000.00` и `-10 000.00` визуально не контрастируют
- Знак `−` у расходов — длинное тире, не дефис: `−` (U+2212), выглядит профессионально

**Убрать дублирование колонок:**
Вместо двух колонок «Сумма» + «Выплачено» — одна колонка «Сумма» со знаком.
Если была конвертация валюты — отдельные колонки «Конвертировано» и «Курс» (пустые если не было).

- **Верификация:** Открыть сгенерированный файл → каждая строка однозначно понятна без чтения соседних колонок.

---

### Задача 0.2 — Итоговая строка и сводка счетов

- **Статус:** `[ ]`
- **Файл:** `apps/telegram-bot/src/services/settings-advanced.service.ts`
- **Проблема:** Документ обрывается на последней транзакции — нет итогов. Выглядит как незаконченный файл.
- **Решение:**

**Строка ИТОГО в конце таблицы (обязательно):**
```
ИТОГО    8 операций    Доходы: +30 000.00    Расходы: -11 000.00    Итог: +19 000.00 PLN
```
В Excel: жирный шрифт, двойная верхняя граница ячейки, фон светло-серый.

**Блок остатков по счетам после ИТОГО:**
```
Остатки на конец периода:
  Тинькофф   PLN    3 122 213.00
  Монобанк   UAH       11 151.00
  Сбербанк   USD         -877.00
```

- **Верификация:** В конце файла есть итог + остатки. Документ выглядит завершённым.

---

### Задача 0.3 — Summary Sheet (первый лист документа)

- **Статус:** `[x]`
- **Файл:** `apps/telegram-bot/src/services/settings-advanced.service.ts`
- **Проблема:** Пользователь открывает файл и сразу видит таблицу из 50+ строк. Нужно сначала показать главное.
- **Референс:** Revolut PDF — первая страница всегда сводка, транзакции потом.
- **Решение (структура Summary Sheet):**

```
MIDAS — Финансовый отчёт
Период:        01.05.2026 — 17.05.2026  (17 дней)
Сформирован:   17.05.2026  13:42  UTC+3

----------------------------------------------------
СВОДКА ЗА ПЕРИОД
----------------------------------------------------
  Доходы        3 операции     + 30 000.00 PLN
  Расходы        4 операции     - 11 000.00 PLN
  Переводы       1 операция       10 000.00 PLN
  Долги          0 операций                 —
----------------------------------------------------
  Итог за период               + 19 000.00 PLN
----------------------------------------------------

----------------------------------------------------
ОСТАТКИ ПО СЧЕТАМ
----------------------------------------------------
  Счёт          Валюта   Начало периода   Конец периода   Изменение
  Тинькофф      PLN      3 112 213.00     3 122 213.00    + 10 000.00
  Монобанк      UAH         11 131.00        11 151.00         + 20.00
  Сбербанк      USD          -1 877.00          -877.00     + 1 000.00
----------------------------------------------------

----------------------------------------------------
СВОДКА ПО ВАЛЮТАМ
----------------------------------------------------
  Валюта   Операций   Доходы          Расходы         Итог
  PLN           5     + 30 000.00     - 11 000.00     + 19 000.00
  UAH           2           0.00      - 10 000.00     - 10 000.00
  USD           1           0.00      - 12 000.00     - 12 000.00
----------------------------------------------------

----------------------------------------------------
ТОП КАТЕГОРИЙ РАСХОДОВ
----------------------------------------------------
  1   Другое       8 операций    - 11 000.00 PLN    100%
----------------------------------------------------
```

> **Примечания по оформлению:**
> - Вместо `Δ` (непонятный символ) — слово **«Изменение»** в заголовке колонки, знак `+`/`−` у числа
> - Разделитель тысяч — пробел. Десятичный разделитель — точка. Формат: `3 122 213.00`
> - Никаких запятых как разделителей тысяч (`3,122,213`) — путает с десятичными
> - Выравнивание числовых колонок — правое (по точке)

В Excel → **отдельный первый лист** `«Сводка»`.
В CSV → блок с `#` комментариями перед строками данных.

- **Верификация:** Открыл файл → первое что видишь = сводка за период, всё понятно без листания.

---

### Задача 0.4 — Переход с CSV на XLSX через `exceljs`

- **Статус:** `[ ]`
- **Файл:** `apps/telegram-bot/src/services/settings-advanced.service.ts`
- **Зависимость:** После задач 0.1–0.3 — тогда форматирование реализуется один раз в xlsx.
- **Действие:**
  1. Добавить зависимость: `npm install exceljs` в `apps/telegram-bot`
  2. Переписать `exportTransactionsCSV` → `exportTransactions(format: 'csv' | 'xlsx')`
  3. Структура xlsx-файла:

**Лист 1: «Сводка»**
- Заголовок `MIDAS — Финансовый отчёт` (жирный, размер 14pt)
- Блоки из Задачи 0.3
- Фон шапки: `#1B3A5C` (тёмно-синий), текст белый

**Лист 2: «Транзакции»**
- Строка заголовка: жирная, фон `#1B3A5C`, текст белый
- Строки доходов: фон `#E8F8F0` (светло-зелёный)
- Строки расходов: фон `#FEF2F2` (светло-красный)
- Строки переводов: фон `#EFF4FF` (светло-синий)
- Строки долгов: фон `#FFF8F0` (светло-оранжевый)
- Строка ИТОГО: жирная, двойная верхняя граница, фон `#F5F5F5`
- Заморозка первой строки (`freeze pane` на row 2)
- AutoFilter на заголовке таблицы
- Автоширина всех колонок

**Колонки таблицы (финальный порядок):**

| № | Заголовок | Ширина | Примечание |
|---|-----------|--------|-----------|
| A | № | 5 | Порядковый номер |
| B | Дата | 12 | `ДД.ММ.ГГГГ` |
| C | Время | 8 | `ЧЧ:ММ` |
| D | Тип | 18 | «Доход», «Расход», «Перевод» |
| E | Исполнитель | 20 | Кому / от кого |
| F | Счёт | 18 | Название счёта |
| G | Сумма | 20 | `+ 10 000.00` / `- 1 000.00` |
| H | Валюта | 8 | `PLN`, `USD` |
| I | Конвертировано | 18 | Пусто если без конвертации |
| J | Валюта выплаты | 10 | Пусто если без конвертации |
| K | Курс | 10 | Пусто если без конвертации |
| L | Категория | 20 | |
| M | Группа | 15 | |
| N | Комментарий | 35 | |
| O | Остаток на счёте | 22 | Running balance по этому счёту |

- **Верификация:** Открыл `.xlsx` → Лист «Сводка» первый → Лист «Транзакции» с цветными строками → Итого внизу.

---

### Задача 0.5 — UX выбора параметров перед экспортом

- **Статус:** `[x]`
- **Файл:** `apps/telegram-bot/src/routes/webhook.route.ts`
- **Проблема:** Сейчас `st:exp:csv` → сразу файл за всё время. Нет выбора периода или счёта.
- **Решение — многошаговый flow:**

```
[📤 Экспорт] → нажал
    ↓
📅 Выбери период:
[Этот месяц]    [Прошлый месяц]
[3 месяца]      [Год]
[Указать даты]
    ↓ (выбрал «Этот месяц»)
🏦 Выбери счёт:
[Все счета]
[Тинькофф  PLN]
[Монобанк  UAH]
    ↓ (выбрал «Все счета»)
📄 Формат файла:
[Excel .xlsx]   [CSV .csv]
    ↓ (выбрал Excel)
⏳ Генерирую отчёт...

✅ Готово!
   MIDAS_Отчёт_май_2026.xlsx
   8 операций · 17 дней
```

- **Redis key:** `midas:exp:params:{userId}:{chatId}` TTL 300s — хранит параметры пока идёт выбор
- **Callback namespace (все ≤ 64 bytes):**

| callback | Действие | Bytes |
|---|---|---|
| `st:exp` | Показать меню периода | 6 |
| `st:exp:p:tm` | Этот месяц | 10 |
| `st:exp:p:lm` | Прошлый месяц | 10 |
| `st:exp:p:3m` | 3 месяца | 10 |
| `st:exp:p:yr` | Год | 10 |
| `st:exp:a:all` | Все счета | 12 |
| `st:exp:a:{26}` | Конкретный счёт | 35 |
| `st:exp:fmt:xlsx` | Excel формат | 14 |
| `st:exp:fmt:csv` | CSV формат | 13 |

- **Имя файла:** `MIDAS_Report_YYYY-MM.xlsx` — машиночитаемое и понятное без открытия.
- **Верификация:** Полный flow: выбор периода → счёт → формат → получил файл с правильными данными.

---

### Задача 0.6 — Мета-блок в документе (Audit Trail)

- **Статус:** `[x]`
- **Файл:** `apps/telegram-bot/src/services/settings-advanced.service.ts`
- **Проблема:** Текущий документ не содержит информации о том кто, когда и за какой период его создал.
- **Референс:** Wise PDF, Revolut Statement — всегда есть footer с метаданными.
- **Решение — блок в конце документа (в xlsx — последние строки листа «Сводка»):**

```
-----------------------------------------------------
  Документ сформирован системой MIDAS v2.0
  Дата экспорта:      17.05.2026  13:42  UTC+3
  Период:             01.05.2026 — 17.05.2026
  Количество записей: 8
-----------------------------------------------------
  Документ является информационным.
  Для официального подтверждения операций
  обратитесь в банк или платёжную систему.
-----------------------------------------------------
```

- **Верификация:** Footer присутствует в xlsx (последние строки «Сводки») и в CSV (последние строки файла).

---

### 📊 Прогресс Спринта 0

| Задача | Суть | Статус |
|---|---|---|
| 0.1 | Полярность сумм + human-readable типы | `[ ]` |
| 0.2 | Строка ИТОГО + остатки по счетам | `[x]` |
| 0.3 | Summary Sheet (первый лист) | `[x]` |
| 0.4 | XLSX через exceljs + цвет строк | `[x]` |
| 0.5 | UX выбора параметров экспорта | `[x]` |
| 0.6 | Мета-блок / Audit Trail | `[x]` |

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
  [NAV_BTN_BALANCE, NAV_BTN_REPORT],
  [NAV_BTN_TRANSACTIONS, NAV_BTN_SETTINGS],
  ],
  ```
   > ⚠️ **Финальный порядок (Phase 2.3):** Отчёт поменян с Транзакциями местами — Отчёт вверху справа.
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

  export const TX_PAGE_SIZE = 6;  // макс 6 транзакций на страницу

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
    workspaceId: string, userId: string, query: string, page: number
  ): Promise<{ items: TxListItem[]; total: number }>;

  export async function searchByAmount(
    workspaceId: string, userId: string, amount: string, page: number
  ): Promise<{ items: TxListItem[]; total: number }>;

  export async function searchByCategory(
    workspaceId: string, userId: string, categoryId: string, page: number
  ): Promise<{ items: TxListItem[]; total: number }>;

  export async function searchByDateRange(
    workspaceId: string, userId: string, from: string, to: string, page: number
  ): Promise<{ items: TxListItem[]; total: number }>;

  export const SEARCH_PAGE_SIZE = 8;  // отдельный лимит для поиска
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
    | { cmd: 'search_amount' }       // tx:s:amt
    | { cmd: 'search_category' }
    | { cmd: 'search_cat_result'; catId: string }
    | { cmd: 'search_date_menu' }                                         // tx:s:dt
    | { cmd: 'search_date_preset'; preset: 'today'|'yday'|'week'|'month' }// tx:s:dt:{preset}
    | { cmd: 'search_date_custom' }                                       // tx:s:dt:custom
    | { cmd: 'search_date_cancel' }                                       // tx:s:dt:cancel
    | { cmd: 'search_results_page'; page: number }                        // tx:sr:p:{page}
    | { cmd: 'field_amount'; txId: string }
    | { cmd: 'field_cat'; txId: string; page: number }
    | { cmd: 'field_acc'; txId: string }
    | { cmd: 'field_int'; txId: string }
    | { cmd: 'delete_ask'; txId: string }
    | { cmd: 'delete_confirm'; txId: string }
    | { cmd: 'confirm_cat'; txId: string; catId: string }
    | { cmd: 'confirm_acc'; txId: string; accId: string }
    | { cmd: 'confirm_int'; txId: string; intent: string }
    | { cmd: 'cancel' }
    | { cmd: 'close' };               // tx:close → удаляет inline-keyboard

  export function parseTxCallback(data: string): TxCallbackCmd | null;
  ```
- **buildTxListKeyboard layout (реальный код):**
  ```
  Row 0: [💸 Расходы] [💰 Доходы] [📋 Все]      ← 3 filter-кнопки (без Долгов)
  Row 1: [🔍 Поиск]                               ← search
  Row 2..N: [emoji name  amt CUR  dd.mm]           ← tx buttons (макс 6/page)
  Row N+1: [◀️] [1/7] [▶️]                        ← пагинация (только если totalPages > 1)
  Row N+2: [✖️ Закрыть]                            ← всегда
  ```
- **buildSearchMenuKeyboard layout (реальный код):**
  ```
  [📝 По названию]   → tx:s:n
  [💲 По сумме]       → tx:s:amt
  [📁 По категории]   → tx:s:c
  [📅 По дате]        → tx:s:dt
  [◀️ Назад]          → tx:l:0:a
  ```
- **buildSearchResultsKeyboard layout (реальный код):**
  ```
  Row 0..N: [emoji name  amt CUR  dd.mm]           ← результаты (макс SEARCH_PAGE_SIZE=8)
  Row N+1: [◀️] [page/total] [▶️]                  ← пагинация (только если totalPages > 1)
  Row N+2: [🔍 Новый поиск]  [◀️ К списку]         ← footer навигация (всегда)
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
- **Статус:** `[x]`
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
- **Period picker layout (реальный код):**
  ```
  [📅 Сегодня]    [📅 Вчера]
  [📆 Эта неделя] [📆 Прошлая]
  [🗓 Этот месяц] [🗓 Прошлый]
  [📊 3 месяца]  [📊 Год]
  [✖️ Закрыть]
  ```
- **Report sub-menu layout (реальный код):**
  ```
  [📋 Сводка]      [📊 Категории]
  [💸 Расходы]     [💰 Доходы]
  [📈 Сравнение]   [🏦 По счетам]
  [◀️ Выбрать период]
  [✖️ Закрыть]
  ```
- **Report back keyboard (реальный код, используется в отчётах-результатах):**
  ```
  [◀️ К отчётам]   [📅 Другой период]
  [✖️ Закрыть]
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
  | `rp:cl` | Закрыть / dismiss keyboard | 5 |

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
    | { cmd: 'back' }
    | { cmd: 'close' };          // rp:cl → удаляет inline-keyboard
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
- **Реальный layout клавиатуры (`buildSettingsMainKeyboard`):**
  ```
  [💵 Основная валюта]  [🏦 Основной счет]
  [🕒 Часовой пояс]    [🔔 Уведомления]
  [💬 Поддержка]         [ℹ️ О боте]
  [✖️ Закрыть]
  ```
  > ⚠️ Фактический лайаут отличается от роадмапа. Кнопок «Категории», «Формат чисел», «Язык», «Экспорт» нет — есть часовой пояс, поддержка (ссылка url), о боте.
- **Полная таблица callback_data:**

  | callback | Действие | Bytes |
  |---|---|---|
  | `st:g:pick` | Выбор группы валюты | 8 |
  | `st:g:s` | Стейблкоины | 6 |
  | `st:g:c:0` | Крипто, стр 0 | 8 |
  | `st:g:f:0` | Фиат, стр 0 | 8 |
  | `st:n:c:{N}` | Крипто: следующая стр | 10 |
  | `st:v:c:{N}` | Крипто: предыдущая стр | 10 |
  | `st:p:{CODE}` | Выбрать валюту | ≤10 |
  | `st:srch` | Поиск валюты | 7 |
  | `st:da:all` | Выбор основного счёта | 9 |
  | `st:da:sa:{id}` | Установить счёт | 38 |
  | `st:da:ca` | Сбросить счёт | 8 |
  | `st:da:new` | Создать счёт | 9 |
  | `st:tz` | Часовой пояс: меню | 5 |
  | `st:tz:srch` | Поиск timezone | 9 |
  | `st:tz:c:{N}` | Disambiguation picker | 11 |
  | `st:tz:p:{b64}` | Установить IANA | ≤64 |
  | `st:ntf` | Уведомления: меню | 6 |
  | `st:ntf:ds` | Toggle ежедневной сводки | 9 |
  | `st:ntf:la` | Toggle лимитов | 9 |
  | `st:ntf:rr` | Toggle напоминаний | 9 |
  | `st:ntf:hr:{h}` | Час сводки | 12 |
  | `st:nf` | Формат чисел: меню | 5 |
  | `st:nf:s:{fmt}` | Установить формат (ru/en/de) | 11 |
  | `st:lang` | Язык: меню | 7 |
  | `st:lang:s:{l}` | Установить язык (ru/en/ua) | 11 |
  | `st:exp` | Экспорт: меню | 6 |
  | `st:exp:csv` | Сгенерировать CSV | 10 |
  | `st:info` | О боте (статистика) | 7 |
  | `st:cancel` | Закрыть настройки | 9 |

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
| **0 — Экспорт (документ)** | **6** | **0** | **🔜 Следующий** |
| 1 — Фундамент | 6 | 6 | ✅ Завершён |
| 2 — Фильтры | 4 | 4 | ✅ Завершён |
| 3 — Поиск | 7 | 7 | ✅ Завершён |
| 4 — Отчёты | 5 | 5 | ✅ Завершён |
| 5 — Настройки | 5 | 5 | ✅ Завершён |
| 6 — Полировка | 6 | 6 | ✅ Завершён |
| 7 — Умный ввод | 3 | 1 (7.1 ✅) | 🔄 В процессе |
| 8 — Голос | 2 | 1 (8.1 ✅) | 🔄 В процессе |
| 9 — Крипто + Smart Alerts | 7 | 0 | ⏳ Запланирован ($640) |
| **Итого** | **52** | **35** | **67%** |

---

---

## 🚀 Спринт 7 — Умный ввод (Phase 1.31 + 1.32 из product-roadmap)

> **Цель:** Сделать ввод транзакций максимально интуитивным — бот подхватывает незнакомые счета, биржи, банки и предлагает создать их на лету. Категорию без категории — запрашивает через кнопки. Текстовые команды распознаёт без слеша.

---

### Задача 7.1 — Inline создание счёта при транзакции
- **Статус:** `[x]` ✅ **Реализовано** (webhook.route.ts — ia: namespace, account-resolver.service.ts)
- **Источник:** product-roadmap.md, Phase 1.31
- **Суть:** Когда AI извлекает `account_hint`, которого нет в БД — бот не падает, а предлагает создать счёт прямо в процессе записи транзакции.

**База данных бирж и банков (встроенная в prompts.ts / account-fuzzy.service.ts):**
```
Биржи:  Binance, Bybit, OKX, Kraken, Coinbase, Huobi, KuCoin, Gate.io,
        Bitget, MEXC, Poloniex, Bitfinex, Gemini, Bitstamp, WhiteBIT
Банки:  Сбербанк, Тинькофф, ВТБ, Альфа, ПриватБанк, Монобанк,
        Ощадбанк, ПУМБ, Укрсиббанк, Kaspi, Halyk, Jusan,
        Revolut, N26, Wise, PayPal
Кошельки: MetaMask, Phantom, Trust Wallet, Ledger, Trezor, Exodus
```
АI должен распознавать любое упоминание этих названий (включая разговорные формы: «бинанс», «тинёк», «привят», «моно»).

**Сценарий А — Упомянул биржу/банк которого нет:**
```
«Получил 1000 USDT с Binance»
→ account_hint = «Binance», счёта нет

💰 Получил 1,000 USDT с Binance.
   Создать счёт с таким названием?

[✅ Создать «Binance» (USDT)]
[🏦 Выбрать другой счёт]
[📋 Записать без счёта]
```
Нажал ✅ — счёт создан мгновенно, транзакция записана туда.

**Сценарий Б — Перевод с неизвестного счёта на существующий:**
```
«Перевёл 500$ с PayPal на карту»
→ account_hint = «PayPal», такого счёта нет

🔄 Перевод 500 USD. Откуда: «PayPal» — такого счёта нет.

[✅ Создать счёт «PayPal» (USD)]
[🏦 Выбрать существующий]
[➡️ Записать как расход с Карты]
```

**Сценарий В — Неизвестная валюта / кошелёк:**
```
«Получил 0.5 SOL»
→ SOL-счёта нет

💰 0.5 SOL. Счёта нет. Создать?

[✅ Создать «SOL кошелёк» (SOL)]
[✏️ Другое название]
[🏦 На существующий счёт]
```

Нажал [✏️ Другое название]:
```
Как назовём SOL-счёт?
> Phantom Wallet

✅ Счёт «Phantom Wallet» (SOL) создан!
   Транзакция записана туда.
```

**Сценарий Ж — Fuzzy matching (нечёткое совпадение):**
```
«потратил на бинансе 100»
→ «бинансе» ≈ «Binance» (fuzzy ≥ 85%) → берёт молча

💸 100 USDT с Binance
[✅ Верно]  [❌ Другой счёт]
```
Правило: fuzzy match включается только для слов ≥ 4 символа. Тикеры (BTC, ETH, SOL) — только точное совпадение.

**Дерево решений:**
```
Транзакция пришла
         │
    Есть account_hint?
         │
    ДА───┤                    НЕТ
         │                     │
  Fuzzy match           Один счёт в нужной
  в account_sources     валюте?
         │                     │
    ┌────┴────┐            ДА──┘ Берём его молча
    │         │            НЕТ─┘ Показываем выбор
  НАШЛИ   НЕ НАШЛИ
    │         │
  Берём    Сценарий А/Б/В
  счёт     (предлагаем создать)
```

**Технические детали:**
- `account-fuzzy.service.ts` (уже существует) — расширить базу названий
- Callback namespace: `ia:cr:{name}:{cur}` — создать счёт (inline account create)
- Callback: `ia:sel` — выбрать существующий, `ia:skip` — записать без счёта
- Redis key: `midas:ia:{userId}:{chatId}` — уже существует для inline account flow
- Миграция не нужна — `account_sources` уже есть

---

### Задача 7.2 — Умный запрос категории (случай 1.3)
- **Статус:** `[ ]`
- **Источник:** product-roadmap.md, Phase 1.32, Поток 1, Случай 1.3
- **Суть:** Когда AI не смог определить категорию (`category_hint = null` или `Другое`) — бот показывает список кнопок с топ-категориями + три дополнительных варианта.

**UX Flow:**
```
«Потратил 3000»
AI: тип=расход, сумма=3000, category_hint=null

💸 3,000 USDT — на что потратил?

🏢 Бизнес:
[Реклама]  [Сервисы]  [Налоги]

🌍 Жизнь:
[Продукты] [Кофе]    [Транспорт]

[🔍 Найти категорию]
[✏️ Ввести вручную]
[📋 Без категории]
```

**Ветка — [✏️ Ввести вручную]:**
```
✏️ Напиши название категории:
> Абонемент в зал

Такой категории нет. Создать?
📁 «Абонемент в зал»
В какую группу?
[🏢 Бизнес]  [🌍 Жизнь]

✅ Категория создана: Жизнь → Абонемент в зал
   Применена к транзакции.
```

**Ветка — [🔍 Найти категорию]:**
```
🔍 Напиши часть названия:
> зал

Найдено:
[Абонемент в зал]
[Тренажёрный зал]
[❌ Не то — ввести вручную]
```

**Ветка — [📋 Без категории]:**
```
💸 Расход: 3,000 USDT
📁 Без категории

[✅ Подтвердить]  [✏️ Добавить категорию]

⚠️ Транзакции без категории не попадают
   в разбивку отчёта /report.
```

> ⚠️ **Важно:** Кнопка `[✅ Подтвердить]` — **всегда вверху**. Кнопки `[✏️ Изменить]` / `[❌ Отменить]` — **внизу**. Это нерушимое правило порядка кнопок в черновике.

**Технические детали:**
- Callback namespace: `cx:cat:{catId}` — выбрать категорию (category clarification)
- Callback: `cx:cat:srch` — найти, `cx:cat:manual` — ввести вручную, `cx:cat:skip` — без категории
- Redis key: `midas:clar:{userId}:{chatId}` — уже существует для clarification state
- Миграция не нужна — `categories` таблица уже есть

---

### Задача 7.3 — Текстовые команды без слеша (случай 1.7)
- **Статус:** `[ ]`
- **Источник:** product-roadmap.md, Phase 1.32, Поток 1, Случай 1.7
- **Суть:** Если пользователь пишет команду текстом без `/` — бот выполняет её напрямую без отправки в AI-парсер.

**Примеры:**
```
«покажи баланс»    → /balance
«отчёт»            → /report (period picker)
«транзакции»       → /edit  (Transaction Hub)
«настройки»        → /settings
«помощь»           → /help
```

**Реализация:**
- В `webhook.route.ts` — перед отправкой текста в AI, проверить по allowlist ключевых слов
- Allowlist (RU/EN/UA): `['баланс', 'balance', 'відображення', 'отчёт', 'report', 'звіт', 'транзакции', 'настройки', 'settings', 'помощь', 'help', 'допомога']`
- Только точные совпадения (trim + lowercase) — не fuzzy, чтобы «помоги мне» не стало /help
- Не блокирует AI: если текст не в allowlist — идёт в парсер как обычно

---

## 🎙️ Спринт 8 — Голосовой ввод (Phase 2.1 + 2.2)

> **Цель — Этап 1:** Принимать голосовые сообщения, транскрибировать через **xAI Grok STT** (не Whisper — реализован через api.x.ai/v1/stt), обрабатывать через существующий Intent Router. Голосовые команды (без транзакций).

> ⚠️ **Этап 2 (НЕ сейчас):** Vision AI (фото чеков и скриншотов), авто-курсы из API — следующий этап развития.

---

### Задача 8.1 — Голосовые транзакции (xAI Grok STT)
- **Статус:** `[x]` ✅ **Реализовано** (groq-stt.ts, voice-parse.worker.ts, voice-queue.ts)
- **Источник:** product-roadmap.md, Phase 2.1
- **Суть:** Голосовое сообщение → xAI Grok STT (POST https://api.x.ai/v1/stt) → транскрипция → существующий AI-парсер → черновик → подтверждение кнопками. Весь happy path идентичен текстовому вводу.

**Happy path:**
```
🎤 «Потратил пятьсот USDT на рекламу»
→ Whisper: «Потратил 500 USDT на рекламу» (0.5 сек)
→ AI: расход, 500 USDT, Реклама
→ 💸 500.00 USDT — Реклама
   [✅ Подтвердить]  [✏️ Изменить]
```

**Блок 1: Технические ошибки распознавания**

Случай 1.1 — Шум / неразборчиво (Whisper вернул пустую строку или мусор):
```
😕 Не смог разобрать голосовое.

Возможные причины:
• Слишком тихо или шумно вокруг
• Слишком короткое сообщение
• Соединение прервалось

[🎤 Записать ещё раз]
[✍️ Написать текстом]
[❌ Отмена]
```

Случай 1.2 — Молчание (длительность < 1 секунды):
```
🔇 Голосовое пустое — ничего не записал?

[🎤 Попробовать снова]  [❌ Отмена]
```

Случай 1.3 — Не тот язык / абракадабра:
```
🌐 Распознал, но не уверен в языке.

Ты имел в виду:
«[транскрипция]»?

[✅ Да, это верно]
[🎤 Повторить по-русски]
[✍️ Написать текстом]
```

**Счётчик неудач — защита от зависания:**
```
Если 3 раза подряд не получилось:

😊 Похоже, голосом пока не получается.
Попробуй написать текстом —
я точно пойму что нужно сделать.

[✍️ Написать текстом]  [❌ Отмена]
```

**Технические детали (реализовано):**
- ✅ Worker: `voice-parse.worker.ts` в `background-workers/` — существует
- ✅ Интеграция: `groq-stt.ts` — xAI Grok STT API (endpoint: `https://api.x.ai/v1/stt`)
- ✅ Telegram: `voice` message types → скачать через `getFile` → Buffer → Grok STT
- ✅ После транскрипции → тот же `ai-parse.worker.ts` pipeline
- ✅ Queue: `voice-queue.ts` в `telegram-bot/src/queues/`
- ✅ Поддержка языков: RU, UK, EN, 25+ языков
- Миграция: не нужна

---

### Задача 8.2 — Голосовые команды (Router)
- **Статус:** `[ ]`
- **Источник:** product-roadmap.md, Phase 2.2
- **Суть:** Голосом можно управлять ботом: запросить баланс, отчёт, открыть транзакции. Деструктивные действия — только через кнопку подтверждения.

**Примеры команд:**
```
🎤 «Покажи баланс»               → /balance (выполняется сразу)
🎤 «Какой у меня отчёт?»         → /report (period picker)
🎤 «Открой транзакции»            → Transaction Hub
🎤 «Измени последнюю транзакцию» → /edit (последняя запись)
🎤 «Покажи настройки»            → /settings
```

**Правила:**
- **Чтение** (баланс, отчёт, транзакции) → выполняется сразу без подтверждения
- **Запись / удаление** → всегда через кнопку `[✅ Подтвердить]`
- Определение команды vs. транзакции — через тот же AI Intent Router (поле `intent: 'command'`)

**Матрица уверенности AI для голоса:**
```
≥ 90%  → Выполняет, показывает подтверждение («Записал расход 500 USDT — верно?»)
70–89% → Выполняет, но подчёркивает («Кажется, это расход 500? Проверь 👇»)
50–69% → Показывает вариант + кнопку [Нет, не то]
< 50%  → Показывает меню вариантов («Не понял. Что хочешь сделать?»)
```

**Технические детали:**
- Intent Router уже существует в `ai-parse.worker.ts` — расширить на `intent: 'command'`
- Добавить поле `command_hint` в Zod-схему парсера: `'balance' | 'report' | 'edit' | 'settings' | null`
- Callback namespace: нет новых — используем существующие `rp:`, `tx:`, `st:`
- Голосовой pipeline: `voice-parse.worker.ts` → транскрипция → Intent Router → если команда, выполнить напрямую; если транзакция — стандартный черновик

---

## 🪙 Спринт 9 — Крипто-мониторинг и Smart Alerts

> **Цель:** Автоматическое отслеживание движения средств на крипто-кошельках (TRC20/ERC20/BEP20). Мгновенные уведомления при входящих/исходящих операциях. Smart Alerts с настраиваемыми порогами.
> **Стоимость:** $640
> **Референсы:** Blockchair, TronGrid API, Alchemy, Moralis

---

### Задача 9.1 — Мультивалютный движок курсов

- **Статус:** `[ ]`
- **Файлы (NEW):**
  - `packages/database/migrations/{ts}_crypto-wallets.js`
  - `apps/background-workers/src/services/exchange-rate.service.ts`
- **Действие:**
  1. Интеграция с **CoinGecko API** — актуальные курсы всех криптовалют в реальном времени
  2. Интеграция с **ExchangeRate API** — официальные курсы фиатных валют (USD, EUR, PLN и др.)
  3. Курс фиксируется в момент транзакции и сохраняется в БД — не пересчитывается задним числом
  4. Кэширование курсов в Redis: TTL 60s для крипты, TTL 3600s для фиата
- **Миграция БД:**
  ```sql
  CREATE TABLE crypto_wallets (
    id VARCHAR(26) PRIMARY KEY,
    workspace_id VARCHAR(26) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    network TEXT NOT NULL CHECK (network IN ('trc20','erc20','bep20')),
    label TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, address, network)
  );

  CREATE TABLE crypto_tx_hashes (
    hash TEXT NOT NULL,
    workspace_id VARCHAR(26) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (hash, workspace_id)
  );
  ```
- **Redis key для кэша курсов:** `midas:fx:{symbol}` TTL 60s (крипта), `midas:fx:fiat:{pair}` TTL 3600s
- **Верификация:** Запрос курса BTC/USD → возвращает актуальное значение с меткой времени

---

### Задача 9.2 — TRC20 (Tron) Webhook интеграция

- **Статус:** `[ ]`
- **Файлы (NEW):**
  - `apps/background-workers/src/workers/trc20-webhook.worker.ts`
  - `apps/telegram-bot/src/routes/trc20-webhook.route.ts`
- **Действие:**
  1. Регистрация Webhook в TronGrid для каждого привязанного TRC20-адреса
  2. Входящий webhook → парсинг → проверка hash в `crypto_tx_hashes` → если новый: записать транзакцию + уведомить пользователя
  3. Поддерживаемые токены: USDT (TRC20), TRX
  4. При регистрации нового кошелька — синхронизация истории за последние 90 дней
- **Формат входящего webhook (TronGrid):**
  ```json
  {
    "txID": "hash...",
    "from": "T...",
    "to": "T...",
    "value": "1000000",          // в sun (1 USDT = 1,000,000 sun)
    "tokenInfo": { "symbol": "USDT", "decimals": 6 }
  }
  ```
- **Парсинг суммы:** `BigInt(value) / BigInt(10 ** decimals)` — SEC-02 compliant, без float
- **Верификация:** Тестовый перевод 1 USDT на TRC20-адрес → уведомление в боте < 5 секунд

---

### Задача 9.3 — ERC20 (Ethereum) Alchemy интеграция

- **Статус:** `[ ]`
- **Файлы (NEW):**
  - `apps/background-workers/src/workers/erc20-webhook.worker.ts`
  - `apps/telegram-bot/src/routes/erc20-webhook.route.ts`
- **Действие:**
  1. Подписка через **Alchemy Webhooks** (Address Activity) на каждый ERC20-адрес
  2. Формат авторизации отличается от TronGrid — отдельный `X-Alchemy-Signature` header validation
  3. Поддерживаемые токены: USDT (ERC20), USDC, ETH
  4. Decimals: USDT/USDC = 6, ETH = 18
- **Верификация:** Тестовый перевод ETH → уведомление в боте < 10 секунд

---

### Задача 9.4 — BEP20 (BSC) Moralis интеграция

- **Статус:** `[ ]`
- **Файлы (NEW):**
  - `apps/background-workers/src/workers/bep20-webhook.worker.ts`
- **Действие:**
  1. Подписка через **Moralis Streams** на BEP20-адреса
  2. Поддерживаемые токены: USDT (BEP20), BNB
  3. Formат парсинга данных отличается от Alchemy и TronGrid — единый Adapter Pattern (Задача 9.5)
- **Верификация:** Тестовый перевод BNB → уведомление < 15 секунд

---

### Задача 9.5 — Единый Adapter (Unified Blockchain Adapter)

- **Статус:** `[ ]`
- **Файл (NEW):** `apps/background-workers/src/services/blockchain-adapter.service.ts`
- **Суть:** Три блокчейна имеют разный формат данных. Adapter Pattern приводит их к единому виду перед записью в БД.
- **Единый формат (`CryptoTxPayload`):**
  ```typescript
  interface CryptoTxPayload {
    hash: string;               // уникальный ID в блокчейне
    network: 'trc20' | 'erc20' | 'bep20';
    direction: 'in' | 'out';
    amount: string;             // NUMERIC string, SEC-02
    symbol: string;             // 'USDT', 'ETH', 'BNB'
    decimals: number;
    fromAddress: string;
    toAddress: string;
    blockTimestamp: string;     // ISO timestamptz
    walletAddress: string;      // наш кошелёк
    workspaceId: string;
  }
  ```
- **Защита от дублей:**
  ```typescript
  // Перед записью — проверить hash
  const exists = await db.query(
    'SELECT 1 FROM crypto_tx_hashes WHERE hash = $1 AND workspace_id = $2',
    [payload.hash, payload.workspaceId]
  );
  if (exists.rowCount > 0) return; // дубль — пропустить
  ```
- **Верификация:** Отправить одинаковый hash дважды → запись создана только одна

---

### Задача 9.6 — Управление кошельками через бот

- **Статус:** `[ ]`
- **Файл:** `apps/telegram-bot/src/services/settings-keyboard.service.ts` (расширить)
- **UX Flow:**
  ```
  ⚙️ Настройки → [🪙 Крипто-кошельки]
      ↓
  🪙 Мои кошельки:
  
  TRC20  T9x...abc   USDT (активен)
  ERC20  0x1...def   USDT, ETH (активен)
  
  [➕ Добавить кошелёк]
  [🔄 Синхронизировать историю]
  [← Назад]
      ↓ (нажали «Добавить»)
  Выбери сеть:
  [🔴 TRC20 (Tron)]
  [🔵 ERC20 (Ethereum)]
  [🟡 BEP20 (BSC)]
      ↓
  Отправь адрес кошелька:
  > T9x...abc
  
  ✅ Кошелёк добавлен! Загружаю историю...
  ```
- **Callback namespace:**

  | callback | Действие | Bytes |
  |---|---|---|
  | `st:cw` | Меню кошельков | 5 |
  | `st:cw:add` | Начать добавление | 9 |
  | `st:cw:net:trc` | Выбрать сеть TRC20 | 11 |
  | `st:cw:net:erc` | Выбрать сеть ERC20 | 11 |
  | `st:cw:net:bep` | Выбрать сеть BEP20 | 11 |
  | `st:cw:del:{26}` | Удалить кошелёк | 36 |
  | `st:cw:sync:{26}` | Принудительная синхронизация | 37 |

- **Верификация:** Добавить → история загрузилась → кошелёк в списке → удалить → исчез

---

### Задача 9.7 — Smart Alerts (умные уведомления)

- **Статус:** `[ ]`
- **Файлы (NEW):**
  - `packages/database/migrations/{ts}_smart-alerts.js`
  - `apps/background-workers/src/services/smart-alert.service.ts`
- **Миграция БД:**
  ```sql
  CREATE TABLE smart_alerts (
    id VARCHAR(26) PRIMARY KEY,
    workspace_id VARCHAR(26) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL, -- 'incoming_gt', 'category_budget', 'balance_lt'
    threshold_amount NUMERIC(20,8),
    currency TEXT,
    category_id VARCHAR(26),
    period TEXT,               -- 'day', 'week', 'month'
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```
- **Типы алертов:**

  | Тип | Условие | Пример |
  |-----|---------|--------|
  | `incoming_gt` | Входящий перевод > N | «Пришло > $1 000» |
  | `category_budget` | Расходы по категории > N за период | «Трафик > $500 за неделю» |
  | `balance_lt` | Баланс счёта < N | «Баланс упал ниже $200» |

- **UX настройки алерта:**
  ```
  🔔 Настройки → [🔔 Smart Alerts]
      ↓
  Выбери тип уведомления:
  [📥 При входящем переводе]
  [📊 Бюджет по категории]
  [⬇️ Низкий баланс]
      ↓ (выбрал «При входящем»)
  Начиная с какой суммы уведомлять?
  > 1000
  В какой валюте?
  [USDT] [USD] [PLN]
  ✅ Алерт создан: уведомлять при входящем > 1 000 USDT
  ```
- **Верификация:** Создать алерт «входящий > 1 USDT» → сделать тестовый перевод → уведомление получено

---

### 📊 Прогресс Спринта 9

| Задача | Суть | Статус |
|---|---|---|
| 9.1 | CoinGecko + ExchangeRate API (курсы) | `[ ]` |
| 9.2 | TRC20 (Tron) Webhook | `[ ]` |
| 9.3 | ERC20 (Ethereum) Alchemy | `[ ]` |
| 9.4 | BEP20 (BSC) Moralis | `[ ]` |
| 9.5 | Unified Blockchain Adapter + дедупликация | `[ ]` |
| 9.6 | Управление кошельками в боте | `[ ]` |
| 9.7 | Smart Alerts с настраиваемыми порогами | `[ ]` |

---

## 📝 Заметки (баги/идеи замеченные по ходу работы)

_Пусто — заполняется во время выполнения._

