# Database Model Draft (MVP)

**Статус:** DRAFT (Phase 0.3.1 — Security Patch Applied)

> **Правило финансовой точности (ADR-009 + SEC-02):**
> Строго запрещено использование типов `float` или `real`. Только `NUMERIC`.
> - Фиатные суммы: `NUMERIC(19,4)`
> - Крипто-суммы: `NUMERIC(38,18)`
> - Курсы валют: `NUMERIC(24,12)`
> В коде обязательно использование библиотек `decimal.js` или `bignumber.js`.
> PostgreSQL NUMERIC → `Decimal` на границе репозитория: `pg.types.setTypeParser(1700, val => new Decimal(val))`.
> Decimal → внешний мир — **только строки**.

---

## 0. Правила доступа к данным (SEC-03)

> **Tenant Transaction Rule:**
> Все операции с tenant-scoped таблицами (помечены 🔒) ОБЯЗАНЫ проходить через:
> ```
> withTenantTransaction(workspaceId, async (client) => {
>   // BEGIN — автоматически
>   // SET LOCAL app.workspace_id = workspaceId — автоматически
>   // ... user code ...
>   // COMMIT — автоматически
>   // On error: ROLLBACK → client возвращается в пул
> })
> ```
> **ЗАПРЕТЫ:**
> - `SET` без `LOCAL` (утечка контекста между запросами в пуле)
> - Запросы к 🔒-таблицам вне `withTenantTransaction`
> - Роли с `BYPASSRLS`

---

## 1. Базовые сущности

### `Workspace`
Корень изоляции данных.
- `id`: ULID (PK)
- `name`: TEXT
- `default_currency`: TEXT NOT NULL (default: 'RUB') — **SEC-10**
- `created_at`: TIMESTAMPTZ
**RLS:** 🔒 Полный доступ для членов WorkspaceMembership.

### `User`
Глобальная сущность Telegram-пользователя.
- `id`: ULID (PK)
- `telegram_id`: BIGINT (UNIQUE, NOT NULL)
- `created_at`: TIMESTAMPTZ
**RLS:** Доступ к своей записи (telegram_id = current_user).

### `WorkspaceMembership`
Связь пользователей с воркспейсами.
- `id`: ULID (PK)
- `user_id`: ULID (FK → User)
- `workspace_id`: ULID (FK → Workspace)
- `role`: TEXT ENUM ('owner', 'member', 'viewer')
- `is_default`: BOOLEAN (DEFAULT true)
- `created_at`: TIMESTAMPTZ
**Индексы:** UNIQUE(`user_id`, `workspace_id`)
**RLS:** 🔒 Доступ к записям, где user_id = current_user_id.

---

## 2. Справочники

### `Category` 🔒
- `id`: ULID (PK)
- `workspace_id`: ULID (FK → Workspace)
- `name`: TEXT
- `group`: TEXT ENUM ('Бизнес', 'Жизнь')
- `color`: TEXT (Hex code)
- `created_at`: TIMESTAMPTZ
**Индексы:** UNIQUE(`workspace_id`, `name`)
**RLS:** `workspace_id = current_setting('app.workspace_id')::ulid`

### `Person` 🔒
Сущность для привязки расходов/долгов (Fuzzy Matching target).
- `id`: ULID (PK)
- `workspace_id`: ULID (FK → Workspace)
- `canonical_name`: TEXT
- `aliases`: TEXT[] (варианты написания)
- `created_at`: TIMESTAMPTZ
**Индексы:** UNIQUE(`workspace_id`, `canonical_name`), GIN(`aliases`)
**RLS:** `workspace_id = current_setting('app.workspace_id')::ulid`

### `AccountSource` 🔒
Счета или кошельки (ручные и автоматические).
- `id`: ULID (PK)
- `workspace_id`: ULID (FK → Workspace)
- `name`: TEXT
- `type`: TEXT ENUM ('manual', 'crypto_read_only', 'bank_sync')
- `currency`: TEXT (основная валюта счёта)
- `created_at`: TIMESTAMPTZ
**RLS:** `workspace_id = current_setting('app.workspace_id')::ulid`

---

## 3. Финансовые операции

### `ExchangeRateSnapshot`
Справочник зафиксированных курсов.
- `id`: ULID (PK)
- `base_currency`: TEXT
- `quote_currency`: TEXT
- `rate`: NUMERIC(24,12)
- `provider`: TEXT
- `fetched_at`: TIMESTAMPTZ
**Индексы:** INDEX(`base_currency`, `quote_currency`, `fetched_at` DESC)
*(Без RLS, глобальный справочник)*

### `TransactionDraft` 🔒
Промежуточное состояние после парсинга AI.
- `id`: ULID (PK)
- `workspace_id`: ULID (FK → Workspace)
- `telegram_message_id`: BIGINT (для привязки к inline-клавиатуре)
- `raw_text`: TEXT (исходное сообщение — **НЕ ЛОГИРУЕТСЯ** в Sentry/stdout, SEC-12)
- `parsed_amount`: NUMERIC(19,4) (MVP - фиат)
- `parsed_currency`: TEXT (NULLable — если NULL, применяется `workspace.default_currency`, SEC-10)
- `category_id`: ULID (FK → Category, NULLable)
- `person_id`: ULID (FK → Person, NULLable)
- `account_id`: ULID (FK → AccountSource, NULLable)
- `status`: TEXT ENUM ('pending_user', 'approved', 'rejected', 'expired', 'needs_clarification')
- `expires_at`: TIMESTAMPTZ
- `created_at`: TIMESTAMPTZ
- `updated_at`: TIMESTAMPTZ
**Индексы:** INDEX(`workspace_id`, `status`), INDEX(`expires_at`)
**RLS:** `workspace_id = current_setting('app.workspace_id')::ulid`

> **SEC-07 Atomic Confirmation:**
> ```sql
> UPDATE transaction_drafts
> SET status = 'approved', updated_at = NOW()
> WHERE id = $1
>   AND status = 'pending_user'
>   AND expires_at > NOW()
> RETURNING *;
> ```
> Если 0 строк → Transaction НЕ создаётся.

> **SEC-08 Atomic Expiration (CRON):**
> ```sql
> UPDATE transaction_drafts
> SET status = 'expired', updated_at = NOW()
> WHERE status = 'pending_user'
>   AND expires_at <= NOW()
> RETURNING id, workspace_id, telegram_message_id;
> ```

> **Terminal States:** `approved`, `rejected`, `expired` — обратный переход запрещён.

### `Transaction` 🔒
Окончательно подтверждённая транзакция.
- `id`: ULID (PK)
- `workspace_id`: ULID (FK → Workspace)
- `original_amount`: NUMERIC(19,4) -- MVP фиат
- `currency`: TEXT
- `exchange_rate`: NUMERIC(24,12) NOT NULL (SEC-11: зафиксированный в момент commit)
- `base_currency`: TEXT NOT NULL (из workspace.default_currency)
- `base_amount`: NUMERIC(19,4) (= original_amount × exchange_rate, вычисляется через decimal.js)
- `category_id`: ULID (FK → Category)
- `person_id`: ULID (FK → Person, NULLable)
- `account_id`: ULID (FK → AccountSource)
- `draft_id`: ULID (FK → TransactionDraft, NULLable, **UNIQUE** — SEC-07 вторая линия защиты)
- `transaction_time`: TIMESTAMPTZ
- `rate_source`: TEXT (провайдер курса для аудита)
- `rate_fetched_at`: TIMESTAMPTZ (момент фиксации курса)
- `created_at`: TIMESTAMPTZ
**Индексы:** INDEX(`workspace_id`, `transaction_time` DESC), INDEX(`category_id`), INDEX(`person_id`)
**RLS:** `workspace_id = current_setting('app.workspace_id')::ulid`

> **SEC-11 Exchange Rate Rules:**
> - `currency = base_currency` → `exchange_rate = 1.0` (немедленная фиксация)
> - `currency ≠ base_currency` → `exchange_rate` фиксируется при COMMIT, не при создании Draft
> - Rate API unavailable → Transaction **НЕ создаётся**, пользователю сообщение об ошибке

### `Loan` 🔒
Долги.
- `id`: ULID (PK)
- `workspace_id`: ULID (FK → Workspace)
- `person_id`: ULID (FK → Person)
- `direction`: TEXT ENUM ('in', 'out')
- `amount`: NUMERIC(19,4)
- `currency`: TEXT
- `status`: TEXT ENUM ('active', 'partially_repaid', 'closed')
- `due_date`: TIMESTAMPTZ (NULLable)
- `created_at`: TIMESTAMPTZ
**Индексы:** INDEX(`workspace_id`, `person_id`, `status`)
**RLS:** `workspace_id = current_setting('app.workspace_id')::ulid`

---

## 4. Системные логи

### `AuditLog` 🔒
- `id`: ULID (PK)
- `workspace_id`: ULID (FK → Workspace)
- `action`: TEXT (e.g., 'category_created', 'draft_confirmed', 'draft_expired', 'job_failed')
- `entity_type`: TEXT
- `entity_id`: TEXT
- `metadata`: JSONB (**SEC-12:** НЕ содержит raw_text, токены или секреты)
- `created_at`: TIMESTAMPTZ
**Индексы:** INDEX(`workspace_id`, `created_at` DESC)
**RLS:** `workspace_id = current_setting('app.workspace_id')::ulid` (только чтение)
