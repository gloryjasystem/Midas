# MIDAS — ПРОМПТ ДЛЯ НОВОГО ЧАТА
> Скопируй всё ниже в новый чат. Актуально на: 2026-05-20 16:05 (UTC+3)

---

## ПРОЕКТ

**Midas** — персональный финансовый учёт через Telegram-бот.
- **Монорепо:** `C:\Users\secvency\Desktop\Midas\midas-monorepo` (Turborepo + pnpm)
- **Деплой:** Railway project `spirited-happiness` → auto-deploy при push в `main`
- **GitHub:** `gloryjasystem/Midas`
- **Health:** https://midas-production-f4f1.up.railway.app/health

**MCP-серверы:** Railway, GitHub, Postgres (prod read-only), Filesystem

---

## ШАГ 1 — ПРОЧИТАЙ СНАЧАЛА

```
C:\Users\secvency\Desktop\Midas\workflow_state.md
```

Там полная история всех фаз, Redis-ключи, архитектурные решения и актуальный статус.

---

## ШАГ 2 — АРХИТЕКТУРА (кратко)

```
midas-monorepo/
├── apps/
│   ├── telegram-bot/          # Fastify webhook, callback handlers, FSM
│   └── background-workers/    # BullMQ workers (ai-parse, confirm, notify, draft-expire)
└── packages/
    ├── ai-core/               # Claude client, prompts, schemas, Zod validation
    ├── database/              # pg pool, RLS, withTenantTransaction, migrations
    └── shared/                # Queue names, job payload types, IdempotencyKeyBuilder
```

**Flow транзакции:**
```
Пользователь пишет текст
  → webhook.route.ts → aiParseQueue (BullMQ)
  → ai-parse.worker.ts → claude-client.ts → prompts.ts
  → Создаёт TransactionDraft (status=pending_user)
  → Показывает preview-карточку + кнопки [✅ Подтвердить][❌ Отклонить]
  → Пользователь нажимает ✅
  → webhook.route.ts → callbackConfirmQueue
  → confirmation.worker.ts → approveDraft() / approvePairedTransfer()
  → notifications.worker.ts → editMessageText (preview → confirmed card)
```

**Transfer flow (Phase 3.1+):**
```
Пользователь: «перевел 1000 Алексею»
  → AI: intent=transfer + person_hint=Алексей
  → webhook.route.ts: показывает picker [🔄 На мой другой счёт | 👤 Другому человеку]
    → Branch A (Internal): target account picker → tp:tgt → approvePairedTransfer() → 2 транзакции
    → Branch B (External): recipient name input → category picker → ✅ Подтвердить → approveDraft()

Phase 3.1 intercept (при нажатии ✅ Подтвердить):
  intent=transfer + NO target_account_id + NO category_id → показать target picker [internal]
  intent=transfer + NO target_account_id + HAS category_id → approveDraft() [external ✅]
  intent=transfer + HAS target_account_id → approvePairedTransfer() [internal paired]
```

---

## ШАГ 3 — ЧТО БЫЛО СДЕЛАНО В ПОСЛЕДНИХ СЕССИЯХ

### Сессия 2026-05-19
- `transfer-pairing.service.ts` — полный FSM transfer flow (Branch A: internal, Branch B: external)
- `approvePairedTransfer()` в `draft-confirmation.service.ts`
- Исправлен баланс: direction-aware formula (`transfer_direction = inbound/outbound`)
- Redis ETIMEDOUT → перезапуск Railway Redis

### Сессия 2026-05-20 утро (commits 0286673, 7fe73a7)
1. **AI Intent семантика** (`prompts.ts`):
   - «перевел 1000 Васе» → `intent=transfer` + `person_hint` (НЕ debt_given!)
   - `debt_given` = ТОЛЬКО явный долговой язык: «дал в долг», «займ», «кредит»

2. **Phase 3.1 Transfer Intercept** (`webhook.route.ts`):
   - При ✅ на transfer без target → перехват → показывает target picker
   - Commit: `0286673`

3. **AI-parse Resilience**:
   - attempts: 2→3, backoff: exponential (5s/10s/20s)
   - При финальном провале: сообщение «⚠️ ИИ временно недоступен»
   - Commit: `7fe73a7`

### Сессия 2026-05-20 день (commits 8785e3c, 8e274c4)

4. **КРИТИЧЕСКИЙ ФИКС: Phase 3.1 Intercept** (`webhook.route.ts`, commit `8785e3c`):
   - **Баг:** Внешние переводы (Branch B) тоже имеют intent=transfer + no target →
     intercept перехватывал их и открывал internal target picker вместо записи транзакции
   - **Root cause:** Условие проверяло только `transfer_target_account_id IS NULL`,
     но не различало internal vs external
   - **Фикс:** Добавлена проверка `category_id` в SQL (у external ВСЕГДА есть category_id):
     ```
     intent=transfer AND target IS NULL AND category_id IS NULL → target picker [internal]
     intent=transfer AND target IS NULL AND category_id IS NOT NULL → approveDraft() ✅ [external]
     ```

5. **Авто-склонение имён в дательный падеж** (`transfer-pairing.service.ts`, commit `8e274c4`):
   - **Проблема:** «Перевод Алексей» — грамматически неверно по-русски
   - **Решение:** `toRecipientDative(name)` — rule-based морфология:
     ```
     Алексей → Алексею    Антон → Антону    Мария → Марии
     Дарья → Дарье        Иван → Ивану      Игорь → Игорю
     Таня → Тане          Сергей → Сергею   Евгений → Евгению
     Иван Петров → Ивану Петрову (каждое слово отдельно)
     Anton / Maria → без изменений (Latin)
     ```
   - Применяется в text interceptor перед `patchDraftItemName` → хранится в DB уже в дательном

### Сессия 2026-05-20 вечер (commits 00ce130, 136ca35, 506a9d4, 2b96fe6) — DB BUGFIXES

6. **КРИТИЧЕСКИЙ ФИКС: `invalid input syntax for type uuid`** (перевод между счётами зависал):
   - **Баг:** при нажатии ✅ на внутреннем переводе — `confirmation-worker` падал с `DatabaseError`
   - **Root cause 1:** Колонка `transfer_group_id` в `transactions` была типа `UUID`, а приложение генерирует **ULID** (`01KS29EW...`) — не является валидным UUID
   - **Root cause 2:** В коде `draft-confirmation.service.ts` были явные касты `$9::UUID` и `$8::UUID` → тоже неверно
   - **Фикс 1:** Миграция `1780400000000_transfer-group-id-text` — меняет `UUID → TEXT`, пересоздаёт индекс
   - **Фикс 2:** `draft-confirmation.service.ts` — убраны все `::UUID` касты (commit `00ce130`)

7. **КРИТИЧЕСКИЙ ФИКС: `column d.current_screen does not exist`** (CRON-worker падал каждые 5 мин):
   - **Баг:** `draft-expiration.worker` падал при каждом запуске CRON-задачи
   - **Root cause:** Миграция `1780200000000_draft-current-screen` была в коде, но **никогда не применялась** к production DB (была пропущена между 1780100000000 и 1780300000000)
   - **Фикс:** Применена вручную + применена `1780100000000_reminder-fn-add-account` (тоже пропущенная)

8. **Авто-миграции при деплое** (`apps/background-workers/src/migrate.ts`, commit `136ca35`):
   - `migrate.ts` — модуль который запускает `node-pg-migrate up` перед стартом воркеров
   - `index.ts` — вызывает `await runMigrations()` как Step 0 перед регистрацией CRON и воркеров
   - Использует multi-strategy path resolution (env var → package.json resolve → relative paths)
   - **Non-fatal:** если путь не найден — логирует и продолжает (воркеры всё равно стартуют)

9. **Подключение к production DB найдено:**
   - Публичный URL: `postgresql://postgres:PLLSqArtPUoQsAYmvrpsmavfQMewgTRh@hopper.proxy.rlwy.net:46284/railway`
   - Используется для ручного запуска миграций локально когда Railway CLI недоступен

---

## ШАГ 4 — КЛЮЧЕВЫЕ ФАЙЛЫ

```
apps/telegram-bot/src/routes/webhook.route.ts
  └─ Phase 3.1 intercept (~line 4536): category_id guard
  └─ Text interceptor recipient name (~line 6853): toRecipientDative()
  └─ tp: callbacks (transfer picker flow)
  └─ ia:pk handler (account picker)
  └─ approve/reject callbacks

apps/telegram-bot/src/services/transfer-pairing.service.ts
  └─ toRecipientDative() — дательный падеж
  └─ buildTransferTypeScreen, buildTargetPickerScreen
  └─ buildExternalCategoryScreen, buildExternalGroupKeyboard
  └─ getAvailableTargetAccounts, setDraftTargetAccount
  └─ patchDraftItemName, patchDraftCategoryForExternal

apps/background-workers/src/services/draft-confirmation.service.ts
  └─ approveDraft() — single-leg: expense/income/debt/external-transfer
  └─ approvePairedTransfer() — internal transfer: 2 транзакции

apps/background-workers/src/workers/confirmation.worker.ts
  └─ Routing: peeks transfer_target_account_id → approvePaired or approveDraft

apps/background-workers/src/services/draft.service.ts
  └─ getWorkspaceAccountsForPicker() — direction-aware balance formula
  └─ getAccountBalanceForPreview()

packages/ai-core/src/prompts.ts
  └─ TRANSFER PRIORITY RULE (lines ~127-148)
  └─ debt_given semantics

packages/ai-core/src/schemas.ts
  └─ Zod schema: intent / person_hint / category_hint / item_hint
```

---

## ШАГ 5 — REDIS КЛЮЧИ (актуальные)

| Ключ | TTL | Назначение |
|---|---|---|
| `midas:preview:{draftId}` | 1h | message_id preview-карточки |
| `midas:am:{userId}:{chatId}` | 24h | активное сообщение (пикеры, черновики) |
| `midas:gate_sent:{userId}:{chatId}` | 1h | флаг gate (блокировка дублей) |
| `midas:dead_card:{chatId}` | 24h | message_id карточки «Отменено» |
| `midas:success_card:{msgId}` | 30d | sentinel — не удалять success card |
| `midas:nav:{userId}:{chatId}` | 24h | nav message (Баланс/Отчёт/...) |
| `midas:awaiting_cur:{chatId}` | 10m | ожидание ввода валюты |
| `midas:clar:{userId}:{chatId}` | 5m | clarification intercept |
| `midas:ac:{userId}:{chatId}` | 5m | account onboarding state |
| `midas:edit:{userId}:{chatId}` | 5m | edit amount intercept |
| `bl:state:{userId}:{chatId}` | 5m | balance dashboard text intercepts |
| `midas:tx:sr:ctx:{userId}:{chatId}` | 10m | search context для пагинации |
| `midas:transfer:type:{draftId}` | 1h | выбор типа перевода (internal/external) |
| `midas:rcpt:{userId}:{chatId}` | 10m | ожидание ввода имени получателя |

---

## ШАГ 6 — СЛЕДУЮЩИЕ ЗАДАЧИ (в порядке приоритета)

### ✅ СДЕЛАНО В ПОСЛЕДНЕЙ СЕССИИ (DB-фиксы 2026-05-20)
```
✅ Миграция 1780400000000_transfer-group-id-text  → transfer_group_id: UUID → TEXT
✅ Миграция 1780200000000_draft-current-screen     → добавлена колонка current_screen
✅ Миграция 1780100000000_reminder-fn-add-account  → обновлена функция поиска черновиков
✅ draft-confirmation.service.ts                   → убраны ::UUID касты
✅ migrate.ts                                      → авто-миграции при деплое

DB состояние проверено:
  SELECT column_name, data_type FROM information_schema.columns
  WHERE (table_name='transactions' AND column_name='transfer_group_id')
     OR (table_name='transaction_drafts' AND column_name='current_screen');
  → transfer_group_id: text ✅
  → current_screen: text ✅
```

### 🔴 Приоритет 1: E2E Тестирование внутреннего перевода
```
ТЕСТ: Внутренний перевод (ранее падал с DatabaseError)
  1. Написать «перевел 500 с тинькофф на сбер» (или назвать свои счета)
  2. Выбрать счёт-источник → выбрать «🔄 На мой другой счёт»
  3. Выбрать счёт-получатель из списка
  4. Нажать ✅ Подтвердить
  5. ОЖИДАЕМО: показывается карточка подтверждения с обоими балансами
  6. Проверить /balance: source баланс уменьшился, target увеличился

  Если ошибка — смотреть логи Railway → background-workers → [midas:confirmation-worker]
```

### 🟡 Приоритет 2: Phase 3.0 — DB Schema
```sql
-- Добавить в account_sources:
ALTER TABLE account_sources
  ADD COLUMN account_type TEXT NOT NULL DEFAULT 'card'
    CHECK (account_type IN ('card','cash','wallet','exchange','custom')),
  ADD COLUMN wallet_subtype TEXT NOT NULL DEFAULT 'general'
    CHECK (wallet_subtype IN ('ton','crypto','ewallet','general'));

-- Создать миграцию: packages/database/migrations/1780500000000_account-type-subtype.js
-- Обновить: addAccount*, chooseCurKeyboard() в account-onboard-keyboard.service.ts
```

### 🟢 Приоритет 3: Phase 3.2 — Отчёт 3.0
- Разбивка по категориям + топ-5 трат за период
- Пример: Расходы 45 000 UAH → Транспорт 27%, Еда 19%...

---

## КОМАНДЫ ДЛЯ РАБОТЫ

```powershell
# Typecheck перед коммитом
npx turbo run typecheck --filter=@midas/telegram-bot
npx turbo run typecheck --filter=@midas/background-workers

# Деплой (auto при push)
git add -A && git commit -m "feat: ..." && git push origin main

# Ручные миграции к production (когда нужно срочно)
$env:DATABASE_URL = "postgresql://postgres:PLLSqArtPUoQsAYmvrpsmavfQMewgTRh@hopper.proxy.rlwy.net:46284/railway"
npx node-pg-migrate up --migrations-dir midas-monorepo/packages/database/migrations --check-order=false
# Запускать из: C:\Users\secvency\Desktop\Midas (git root)

# Логи Railway (через MCP или Railway CLI)
# MCP: railway-mcp-server → get-logs (требует Railway CLI)
# Postgres прямой доступ (read-only): midas-postgres MCP server
```

---

## ВАЖНЫЕ ОГРАНИЧЕНИЯ (не нарушать!)

- **SEC-02:** Никакого `parseFloat()`, `Number()`, float-арифметики. Только NUMERIC/Decimal/BigInt
- **SEC-12:** Суммы и имена пользователей НЕ логируются
- **SEC-03:** `workspaceId` всегда из DB (trusted source), никогда из callback_data
- **SEC-01:** `draftId` из callback_data валидируется против DB
- callback_data ≤ 64 байта (ограничение Telegram)
- Все DB-строки через `escapeHtml()` перед рендером в HTML

---

> **После прочтения этого промпта:** открой `workflow_state.md` (секция 1 и 2)
> для актуального состояния, затем можно начинать работу.

---

## ПРОМПТ ДЛЯ СЛЕДУЮЩЕГО ЧАТА

```
Прочитай полностью два файла:
1. C:\Users\secvency\Desktop\Midas\NEW_CHAT_PROMPT.md
2. C:\Users\secvency\Desktop\Midas\workflow_state.md (секции 1, 2, 3)

После прочтения:
1. Проверь состояние production DB через Postgres MCP:
   SELECT column_name, data_type FROM information_schema.columns
   WHERE (table_name='transactions' AND column_name='transfer_group_id')
      OR (table_name='transaction_drafts' AND column_name='current_screen');
   → Убедись что оба поля = text

2. Начни с Приоритета 1 из файла NEW_CHAT_PROMPT.md (E2E тест внутреннего перевода).
   Если тест проходит успешно — переходи к Приоритету 2 (Phase 3.0 DB Schema).

Сообщи мне результат проверки DB и статус E2E теста перед началом разработки.
```
