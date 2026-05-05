# Phase 1 Scope: Strict MVP

**Статус:** APPROVED (Phase 0.3.1 — Security Patch Applied)
**Ограничения:** Исключительно MVP инфраструктура.

## Цель Phase 1
Реализовать базовый функционал бота для Telegram с AI-парсером, ручным вводом транзакций и текстовыми отчётами.

## Входит в Scope (In Scope)
1. **Инфраструктура:**
   - Node.js + TypeScript runtime
   - PostgreSQL + RLS (multi-workspace-ready)
   - Redis + BullMQ (базовая очередь для AI-задач)
2. **Telegram Bot:**
   - Интеграция с Bot API
   - Команды: `/start`, `/add`, `/balance`, `/report`, `/category`
   - Inline-клавиатуры для подтверждения транзакций
3. **AI Core:**
   - Интеграция с Claude Haiku для парсинга свободного текста
   - Идентификация намерений (расход, доход, долг)
4. **Управление данными (ручное):**
   - CRUD базовых категорий
   - Ручной ввод расходов и доходов
   - Подтверждение данных пользователем (Human-in-the-Loop)
5. **Текстовые отчёты:**
   - Генерация текстовых сводок в чат

## ИСКЛЮЧЕНО из Scope (Out of Scope for Phase 1)
> ⚠️ **Критическое правило:** Следующие функции строго запрещены к реализации в Phase 1.

1. **Crypto / Blockchain:** Нет интеграций с вебхуками, нет парсинга on-chain транзакций.
2. **Integrations:** Нет Google Sheets, нет Notion. Никаких OAuth флоу.
3. **Telegram Mini App (TMA):** Нет React SPA, нет Tremor UI, нет веб-дашбордов. Только интерфейс чата.
4. **Сложный экспорт:** Нет генерации PDF, нет инфографики/чартов.
5. **Фоновые задачи (продвинутые):** Нет сложных CRON-рассылок и автоотчётов.

---

## Обязательные Security & Traceability правила Phase 1

### SEC-01: AI Output Validation
- Выход Claude Haiku валидируется строгой Zod-схемой (allowlist).
- AI output **НЕ МОЖЕТ** содержать системные поля: `id`, `user_id`, `workspace_id`, `tenant_id`, `status`, `category_id`, `person_id`, `exchange_rate`, `base_amount`, `draft_id`, `account_id`.
- Системные поля инжектируются **только** бэкенд-контроллером после валидации.
- Malformed/ambiguous AI output → статус `needs_clarification` или `rejected`. AI НЕ МОЖЕТ создать Transaction напрямую (только Draft).

### SEC-02: Decimal Boundary Rule
- JavaScript `Number`, `parseFloat()`, `Number()`, unary `+` и float-арифметика (`+ - * /`) **ЗАПРЕЩЕНЫ** в любых финансовых путях.
- PostgreSQL NUMERIC значения конвертируются в `Decimal` (decimal.js) на границе репозиторий/домен через `pg.types.setTypeParser(1700, val => new Decimal(val))`.
- Decimal значения сериализуются наружу (API/Telegram) **только как строки**.
- ESLint custom rule или `no-restricted-syntax` для `parseFloat`, `Number()` в директориях `packages/database/`, `apps/telegram-bot/services/`, `apps/background-workers/`.

### SEC-03: DB Tenant Transaction Rule
- Все tenant-scoped DB-операции обязаны проходить через `withTenantTransaction(workspaceId, fn)`.
- `withTenantTransaction` выполняет: `BEGIN` → `SET LOCAL app.workspace_id = $1` → `fn(client)` → `COMMIT`.
- При ошибке: `ROLLBACK` **до** возврата клиента в пул. Использование `finally { client.query('ROLLBACK') }` или аналога.
- `SET` без `LOCAL` — **запрещён** (утечка контекста в пуле).
- Запросы к tenant-scoped таблицам вне `withTenantTransaction` — **запрещены**.

### SEC-04: Telegram Webhook Validation
- Верификация `X-Telegram-Bot-Api-Secret-Token` на каждом входящем запросе.
- Запросы без валидного токена → HTTP 403, не обрабатываются.
- Валидные запросы → HTTP 200 **немедленно** после безопасного решения о постановке в очередь.

### SEC-05: Non-Text Input Handling
- Phase 1 поддерживает **только текстовые сообщения**.
- Типы `voice`, `video`, `video_note`, `photo`, `document`, `sticker` и любые нетекстовые payload **НЕ ПОПАДАЮТ** в AI-парсер.
- Пользователь получает: *"Я пока понимаю только текстовые сообщения."*

### SEC-06: Idempotency Keys
- Ingestion key: `telegram:bot:{bot_id}:chat:{chat_id}:msg:{message_id}` (не `message_id` alone).
- AI-parse key: `parse:bot:{bot_id}:msg:{message_id}`.
- Callback key: `cb:user:{telegram_user_id}:draft:{draft_id}:action:{action}`.

### SEC-07: Atomic Draft Confirmation
- Подтверждение выполняется атомарным UPDATE:
  ```sql
  UPDATE transaction_drafts
  SET status = 'approved', updated_at = NOW()
  WHERE id = $1
    AND status = 'pending_user'
    AND expires_at > NOW()
  RETURNING *;
  ```
- 0 строк → транзакция НЕ создаётся. Пользователю: *"Черновик уже обработан или истёк."*
- `transactions.draft_id` остаётся `UNIQUE` — вторая линия защиты.
- Обязателен тест на конкурентность (3 параллельных запроса на один draft).

### SEC-08: Draft TTL Race Handling
- CRON-job expire и callback confirm используют **state-checked atomic transitions**.
- Статусы `expired`, `rejected`, `approved` — терминальные, обратный переход запрещён.
- CRON expire: `UPDATE ... SET status = 'expired' WHERE status = 'pending_user' AND expires_at <= NOW()`.

### SEC-09: User-Level Rate Limiting
- Rate limit per `telegram_user_id` **до постановки** в BullMQ (например, 5 msg / 10s).
- Превышение лимита → задача НЕ ставится в очередь, пользователю: *"Слишком много сообщений, подождите."*
- HTTP 200 для Telegram (не 429). Rate-limit message — пользовательский.
- Глобальный AI budget guard: суммарный расход токенов Claude отслеживается.

### SEC-10: Default Currency Rule
- `Workspace.default_currency` — обязательное поле (NOT NULL).
- Если пользователь не указал валюту → бэкенд применяет `workspace.default_currency`.
- Если `default_currency` не установлена (не должно быть, но defensive) → `needs_clarification`.

### SEC-11: Exchange Rate Timing Rule
- Для одновалютной транзакции (currency = base_currency): `exchange_rate = 1.0`, фиксация немедленная.
- Для кросс-валютной: неизменяемый `exchange_rate_at_timestamp` фиксируется **в момент финального COMMIT** (не при создании Draft).
- Если провайдер курсов недоступен → транзакция **НЕ МОЖЕТ быть закоммичена**. Бэкенд возвращает *"Курс валюты временно недоступен."* Пользователь может повторить позже.

### SEC-12: Logging & Privacy Rule
- Сырой финансовый текст пользователя (`raw_text`) **ЗАПРЕЩЕНО** логировать в Sentry/BullMQ/stdout по умолчанию.
- Разрешённые поля в логах: `event_id`, `user_id_hash` (SHA-256), `workspace_id`, `draft_id`, `error_class`.
- Токены, секреты, полный текст транзакций — **ЗАПРЕЩЕНЫ** в логах.
