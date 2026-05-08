# PROJECT_CONFIG.MD — Конституция проекта Midas

> **Статус документа:** IMMUTABLE — ИИ-агент НЕ ИМЕЕТ ПРАВА изменять этот файл без прямого приказа владельца проекта.
> **Версия:** 1.3 | **Создан:** 2026-05-04 | **Обновлён:** 2026-05-08 (Phase 1.35 документация)
> **Источники:** Midaz_TZ v1, Мастер-план Midas v2.0, User Decisions 2026-05-04

### Changelog v1.3 (Phase 1.35 Documentation Update)
- **Phase 1.23–1.35 implemented:** Все фазы Блока 1–3 реализованы и приняты
- **Базовая валюта** изменена с RUB на USDT (Phase 1.24)
- **Деплой:** Railway (spirited-happiness) — 2 сервиса (Midas bot + background-workers) + Postgres + Redis
- **AI Pipeline:** Claude Haiku 4.5 с item_hint + category_hint извлечением, 3-этапная категоризация (exact → alias → fallback)
- **UX:** Clean Chat (edit-first), Rich Screen Cards, полный clarification engine
- **10 миграций PostgreSQL** от MVP schema до intelligent transactions

### Changelog v1.1 (Phase 0.2 Approved)
- **Runtime:** Зафиксирован Node.js 24 + TypeScript (ADR-001). Python оставлен как опциональный изолированный микросервис. n8n отклонён.
- **Frontend:** Зафиксирован React 19 + Vite 8. Vue полностью исключён из scope (ADR-002).
- **Workspace:** Утверждена multi-workspace-ready БД (Workspace, User, WorkspaceMembership) с MVP на 1 default workspace (ADR-003).
- **Task Queue:** Celery заменён на BullMQ (ADR-014).

---

## 1. ИДЕНТИЧНОСТЬ ПРОДУКТА

- **Название:** Midas — персональная финансовая операционная система в Telegram
- **Тип:** Telegram Mini App + AI Agent (чат-бот)
- **Два компонента доставки:**
  - Telegram-бот (чат) — приём данных свободным текстом, NLP-парсинг, уведомления, алерты
  - Telegram Mini App — дашборды, графики, кастомизация категорий, настройки
- **Ключевой принцип:** Максимальная кастомизация. Пользователь может добавлять/изменять категории, подключать свои источники данных, настраивать периодичность отчётов — без нового деплоя
- **Два потока данных:**
  - Входящий: транзакции крипто-кошельков, Google Sheets, Notion, ручной ввод в чат
  - Исходящий: аналитические отчёты, инфографика, алерты, записи в Notion/Google Sheets

---

## 2. ТЕХНОЛОГИЧЕСКИЙ СТЕК (Актуальные версии на май 2026)

### 2.1 Ядро

| Компонент | Технология | Версия |
|---|---|---|
| **Runtime** | Node.js (LTS) + **TypeScript** | **24.x** (Active LTS) |
| **Frontend Framework** | React (Vue отклонён — ADR-002) | **19.x** |
| **Frontend Bundler** | Vite | **8.x** |
| **UI Kit (дашборды)** | Tremor Raw (copy-paste, Tailwind + Radix UI) | latest (open-source, MIT) |
| **База данных** | PostgreSQL | **18.x** |
| **Очередь задач** | BullMQ (Redis-backed) | latest |
| **Кэш / Блокировки** | Redis | **8.x** |
| **Монорепо** | Turborepo | **2.9.x** |
| **Контейнеризация** | Docker Compose | latest |

> **Решение по языку (ADR-001):** Node.js + TypeScript — единственный runtime бэкенда.
> Python может быть введён позже **только** как изолированный микросервис для тяжёлой аналитики/отчётности.
> n8n отклонён для основной продуктовой логики.

### 2.2 AI-модели (Anthropic Claude)

| Роль | Модель | Примечание |
|---|---|---|
| **NLP-парсинг в продакшене** | Claude Haiku 4.5 | Свободная речь → строгий JSON. Максимальная скорость/экономия |
| **Кодогенерация (IDE)** | Claude Sonnet 4.6+ | React-компоненты, API-роуты, CRUD |
| **Архитектурные решения (IDE)** | Claude Opus 4.7 | Проектирование сложных узлов, ADR, ревью |

### 2.3 Telegram

| Компонент | Версия / Метод |
|---|---|
| **Bot API** | **9.6** (latest, апрель 2026) |
| **Mini Apps SDK** | `@telegram-apps/sdk` (latest) |
| **Бот-фреймворк** | На усмотрение (grammY / telegraf / raw webhook) |

### 2.4 Внешние интеграции

| Сервис | Метод подключения |
|---|---|
| Google Sheets | Google OAuth 2.0, двусторонняя синхронизация |
| Notion | Notion API (OAuth / Integration Token), двусторонняя интеграция |
| Блокчейны TRC20 | Tronscan API / TronGrid |
| Блокчейны BEP20 | BSCScan API |
| Блокчейны ERC20 | Etherscan API |

### 2.5 Мониторинг и качество

| Компонент | Технология | Версия |
|---|---|---|
| **Error Tracking** | Sentry (`@sentry/node`, `@sentry/react`) | **10.x** |
| **Нагрузочное тестирование** | По выбору (k6 / Artillery) | — |

### 2.6 Деплой (Railway)

| Компонент | Описание |
|---|---|
| **Проект** | `spirited-happiness` (Railway) |
| **Telegram Bot** | Сервис `Midas` — Fastify webhook, slash-commands, callback_query routing |
| **Background Workers** | Сервис `background-workers` — BullMQ workers (ai-parse, confirmation, notifications, draft-expiration) |
| **Postgres** | Railway PostgreSQL 18.x — RLS, NUMERIC precision, ULID PKs |
| **Redis** | Railway Redis 8.x — BullMQ, session state (midas:clar:, midas:ac:, midas:ia:, midas:am:, midas:edit:), settings search |
| **Auto-deploy** | GitHub main branch → Railway auto-deploy |

### 2.7 Миграции PostgreSQL (Phase 1)

| Миграция | Фаза | Назначение |
|---|---|---|
| `1777973748530_mvp-schema-and-types.js` | 1.2 | Core tables (workspaces, users, categories, account_sources, transaction_drafts, transactions), RLS |
| `1777973834059_draft-lifecycle.js` | 1.7 | Draft state machine trigger (pending_user → approved/rejected/expired) |
| `1778008338096_transaction-intent.js` | 1.8-A | transaction_intent NOT NULL on transactions |
| `1778008400000_harden-onboarding-search-path.js` | 1.8-B | SECDEF search_path hardening |
| `1778100000000_onboarding-default-seed.js` | 1.12 | 7-param onboarding function with default category + account |
| `1778200000000_account-sources-unique-name.js` | 1.16 | UNIQUE(workspace_id, name) on account_sources |
| `1778300000000_account-sources-currency-check.js` | 1.19 | CHECK (currency ~ '^[A-Z]{3,5}$') |
| `1778400000000_account-sources-initial-balance.js` | 1.21 | initial_balance NUMERIC(19,4) DEFAULT 0 |
| `1778700000000_transactions-soft-delete.js` | 1.29 | deleted_at TIMESTAMPTZ DEFAULT NULL |
| `1778800000000_drafts-account-hint.js` | 1.31 | parsed_account_hint TEXT on transaction_drafts |
| `1778900000000_draft-clarification-state.js` | 1.32 | needs_clarification status in state trigger |
| `1779000000000_intelligent-transactions.js` | 1.35 | item_name, parsed_category_hint, category_group ENUM, 28-category taxonomy, workspace default accounts |

### 2.8 AI Pipeline (claude-client.ts + prompts.ts)

- Модель: `claude-haiku-4-5`, `temperature: 0` (детерминизм), `max_tokens: 256`
- System prompt: OUTPUT RULES → RUSSIAN LANGUAGE RULES (50+ глаголов расхода/дохода) → CATEGORY→INTENT defaults (40+ expense, 15+ income категорий) → 25+ примеров (все 5 intent-типов + partial + nonsense)
- Markdown fence strip: Claude иногда оборачивает JSON в ` ```json `, парсер это убирает перед `JSON.parse`
- Zod validation: strict allowlist — только intent/amount/currency/category_hint/person_hint/account_hint/item_hint/note/confidence
- Post-processing (safety net, ПОСЛЕ Claude): 7 групп regex с word-boundary `\b` (debt→transfer→expense verbs→income verbs→expense cats→income cats), negation guard («не потратил» → skip), confidence boost (+0.15/+0.25), intent fallback для partial results
- Результат: `ok` | `partial` (missing fields) | `needs_clarification` (nonsense) | `rejected`
- **Phase 1.35:** `item_hint` (extracted product/merchant name), `category_hint` (AI category suggestion) → `CategoryResolverService` (3-stage: exact → 200+ alias map → fallback «Другое»)

---

## 3. ПРАВИЛА БАЗЫ ДАННЫХ (НЕРУШИМЫЕ)

### 3.1 Мультитенантность и изоляция
- Архитектура: **Shared Database, Shared Schema**
- Изоляция: строго через **Row-Level Security (RLS)** с привязкой к `workspace_id` / `tenant_id`
- **ЗАПРЕТ:** использование ролей с правами `BYPASSRLS`. Все сервисные подключения к БД — через low-privilege роль
- Контекст воркспейса устанавливается строго через `SET LOCAL` внутри транзакции

### 3.1a Модель Workspace (ADR-003)
- **MVP UX:** один Default Workspace на одного Telegram-пользователя
- **Архитектура БД:** multi-workspace-ready с первого дня
- Явные сущности: `Workspace`, `User`, `WorkspaceMembership`
- Связь User → Workspace — через таблицу `WorkspaceMembership` (many-to-many ready)

### 3.2 Первичные ключи
- Все первичные ключи — **ULID** (не UUIDv4), для предотвращения фрагментации B-tree индексов и сохранения хронологической сортировки

### 3.3 Мультивалютность
- При парсинге мультивалютных операций обязательна фиксация **3 полей** в таблице транзакций:
  - `original_amount` — исходная сумма
  - `currency` — исходная валюта
  - `exchange_rate_at_timestamp` — курс обмена, зафиксированный **в момент транзакции**
- Запрет на пересчёт исторических данных по текущему курсу

---

## 4. ПАТТЕРНЫ UX (НЕРУШИМЫЕ)

### 4.1 Frictionless Onboarding (Бесшовный старт)
- Пользователь нажимает `/start` → Telegram передаёт `initData` → Бэкенд валидирует крипто-подпись Telegram → Система незаметно генерирует **Default Workspace** → Пользователь сразу может писать свои траты
- **Никаких форм регистрации.** Telegram User ID = идентификатор

### 4.2 Human-in-the-Loop (Подтверждение парсинга)
- Пользователь пишет свободный текст → Haiku парсит → Бот отвечает Inline-клавиатурой: *«Расход: 100$, Категория: Кофе. Верно? [Да] [Изменить]»*
- Данные записываются в БД **только после** подтверждения пользователем

### 4.3 Роутинг TMA
- Mini App открывается по кнопке бота
- Для внутреннего роутинга используется параметр `startapp` (Telegram режет обычные query-параметры)

### 4.4 Fuzzy Matching (Люди / Долги)
- При привязке расходов к людям и в системе Loan обязательно применение **нечёткого поиска** (Fuzzy Matching) — «Макс», «Максим», «Максиму» = один человек
- Запрет на создание дублей без алгоритмической проверки

---

## 5. ОТКАЗОУСТОЙЧИВОСТЬ (НЕРУШИМЫЕ ПАТТЕРНЫ)

### 5.1 OAuth Token Rotation — Redlock
- **Проблема:** Race Condition при параллельном обновлении OAuth-токенов (Google/Notion) несколькими воркерами
- **Решение:** Алгоритм распределённых блокировок **Redlock** (Redis). Прежде чем запрашивать новый токен, воркер обязан захватить блокировку. Остальные потоки ждут
- Запрет на «наивное» обновление токенов без блокировки

### 5.2 Circuit Breaker для внешних API
- При получении ошибки 429 (Rate Limit) от Notion/Google/блокчейн-провайдеров — замыкание цепи
- Запросы складываются в **Dead Letter Queue** (Redis) и повторяются с экспоненциальным backoff

### 5.3 Worker Threads для тяжёлых задач
- Генерация PDF-отчётов, инфографики, массовых рассылок — обязательно в изолированных **Worker Threads** (Node.js)
- Запрет на блокировку Event Loop основного процесса бота

### 5.4 Graceful Retry
- Все внешние вызовы (Telegram API, блокчейны, Sheets, Notion) — с retry и exponential backoff
- Логирование всех ошибок (Sentry)

---

## 6. БЛОКЧЕЙН-ЛОГИКА (НЕРУШИМЫЕ ПРАВИЛА)

### 6.1 Read-Only мониторинг
- Крипто-кошельки подключаются **только по публичному адресу** (read-only)
- **Приватные ключи и seed-фразы НЕ собираются и НЕ хранятся** нигде в системе
- До 5–7 адресов на пользователя
- Частота опроса: настраиваемая (рекомендовано 15–30 минут)

### 6.2 Идемпотентность вебхуков
- **Проблема:** Провайдеры блокчейнов могут отправлять один вебхук многократно (до 5 раз)
- **Решение:** Уникальный составной ключ `(tx_hash, network_id)` с ограничением `UNIQUE` в базе данных
- Дублированные вебхуки отбрасываются без ошибки (upsert / ON CONFLICT DO NOTHING)

### 6.3 Chain Reorgs (Реорганизация цепи)
- **Проблема:** Блокчейны могут откатывать блоки (Orphaned Blocks)
- **Решение:**
  1. Все новые транзакции получают статус `pending`
  2. Внедряется **глубина подтверждения** (Confirmation Depth) — количество блоков, после которого транзакция считается `confirmed`
  3. При получении сигнала отмены блока — автоматический `ROLLBACK` транзакции в базе (возврат в `reverted`)
  4. Пользователю отправляется уведомление о реорганизации

---

## 7. ОГРАНИЧЕНИЯ TELEGRAM MINI APP (НЕРУШИМЫЕ)

### 7.1 iOS Keyboard Bug
- На iOS клавиатура ломает верстку TMA
- **Решение:** Программное управление фокусом. Использование метода `hideKeyboard` (Bot API 9.1+)

### 7.2 Safe Area Insets (островки / чёлки)
- Строго использовать отступы `safeAreaInset` из Bot API 8.0+ для корректного отображения на всех устройствах

### 7.3 Приватные данные — только SecureStorage
- Если потребуется хранить приватные ключи/токены пользователя на клиенте — использовать **исключительно** `SecureStorage` (Bot API 9.0+) с обязательной биометрической аутентификацией (FaceID / TouchID)
- Запрет на хранение чувствительных данных в localStorage, sessionStorage или cookies

### 7.4 Безопасность API
- Все API-ключи — только на бэкенде, клиенту никогда не передаются
- HTTPS / TLS для всех соединений
- Валидация `initData` крипто-подписи Telegram на каждом запросе

---

## 8. БЕЗОПАСНОСТЬ (НЕРУШИМЫЕ ПРАВИЛА)

- OAuth 2.0 токены (Google, Notion) хранятся в **зашифрованном виде** на бэкенде
- Telegram User ID как идентификатор — регистрация не требуется
- Запрет на передачу сырых крипто-адресов и транзакций в Notion — только **агрегированные сводки**
- Все внешние запросы (Telegram API, блокчейны) должны быть **идемпотентны**

---

## 9. СТРУКТУРА МОНОРЕПОЗИТОРИЯ

```
midas-monorepo/
├── apps/
│   ├── telegram-bot/          # Бэкенд бота (Node.js, Webhook, оркестрация AI)
│   ├── mini-app/              # React SPA (Vite, Tremor Raw)
│   └── background-workers/    # Отдельный сервис: CRON, рассылки, PDF-генерация
├── packages/
│   ├── database/              # Схемы PostgreSQL, миграции, RLS-политики
│   ├── ai-core/               # Интеграция с Claude Haiku, промпты для парсинга
│   └── blockchain-adapters/   # Обработчики TRC20/ERC20/BEP20, идемпотентность
├── docs/
│   ├── project_config.md      # ← Этот файл (Конституция)
│   ├── workflow_state.md      # Диспетчер задач ИИ
│   └── adr/                   # Architecture Decision Records
├── docker-compose.yml
├── turbo.json
└── package.json
```

---

## 10. НЕФУНКЦИОНАЛЬНЫЕ ТРЕБОВАНИЯ

| Требование | Метрика |
|---|---|
| Ответ бота | ≤ 3 секунды |
| Генерация отчёта | ≤ 10 секунд |
| Масштабируемость | Архитектура поддерживает множество пользователей |
| Кастомизация | Любая категория добавляется/изменяется без нового деплоя |
| Надёжность | Логирование всех ошибок; graceful retry при сбоях API |
| Локализация | Русский — основной. Заделы на мультиязычность |

---

## 11. ПРОМПТЫ АРХИТЕКТОРА (Для ревью сложных модулей)

### Промпт №1: Трассировка Логики (Traceability Review)
> Использовать на Claude Opus после написания любого сложного модуля.
>
> «Выполни полную трассировку логики. Проследи каждый миллиметр пути данных: от ввода текста пользователем в Telegram, через парсинг Claude Haiku, в контроллер Node.js, проверку идемпотентности, инъекцию tenant_id для RLS в PostgreSQL и до возврата ответа в UI. Убедись, что сигнатуры функций и типы данных (особенно числа с плавающей точкой для валют) совпадают на каждом слое стыковки. Найди 3 места, где этот поток может упасть без обработки ошибок.»

### Промпт №2: Враждебный Аудит (Adversarial Security Review)
> Использовать на Opus / Gemini перед коммитом в master.
>
> «Представь, что этот код написал стажёр, а ты — старший аудитор по кибербезопасности. Твоя задача — сломать его. Ищи нарушения изоляции данных между воркспейсами (bypass RLS), уязвимости к SQL-инъекциям, состояние гонки при обновлении токенов и утечки памяти в фоновых воркерах. Разбей найденные уязвимости на Critical, High, Medium, Low.»

---

## 12. MCP-СЕРВЕРЫ (Model Context Protocol)

Для обеспечения «зрячей» работы ИИ-агентов поднимаются локальные MCP-серверы:

| MCP-сервер | Назначение |
|---|---|
| **Postgres MCP** | Чтение актуальной схемы БД, написание SQL-миграций |
| **Notion MCP** | Понимание структуры баз данных пользователя в Notion |
| **GitHub / Local FS MCP** | Глубокий анализ кодовой базы |

---

> **НАПОМИНАНИЕ:** Этот файл — Единый Источник Истины (SSOT). Любое противоречие в коде или архитектуре должно разрешаться в пользу этого документа. Изменения вносятся только по прямому приказу владельца проекта.
