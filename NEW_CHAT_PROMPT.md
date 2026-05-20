# MIDAS — ПРОМПТ ДЛЯ НОВОГО ЧАТА
> Скопируй всё ниже в новый чат. Актуально на: 2026-05-20 11:50 (UTC+3)

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

### 🔴 Приоритет 1: E2E Тестирование (протестировать в боте)
```
ТЕСТ A: Внешний перевод
  1. Написать «перевел 1000 долларов Алексею»
  2. Выбрать счёт → выбрать «👤 Другому человеку»
  3. Ввести имя → проверить что показывается «Алексею»
  4. Выбрать категорию → нажать ✅ Подтвердить
  5. ОЖИДАЕМО: транзакция записывается (НЕ открывается target picker!)
  6. Проверить баланс: должен уменьшиться на 1000 USD

ТЕСТ B: Внутренний перевод
  1. Написать «перевел 500 на тинькофф»
  2. Выбрать «🔄 На мой другой счёт»
  3. Выбрать target account → ✅ Подтвердить
  4. ОЖИДАЕМО: оба баланса изменились (outbound - / inbound +)
```

### 🟡 Приоритет 2: Phase 3.0 — DB Schema
```sql
-- Добавить в account_sources:
ALTER TABLE account_sources
  ADD COLUMN account_type TEXT NOT NULL DEFAULT 'card'
    CHECK (account_type IN ('card','cash','wallet','exchange','custom')),
  ADD COLUMN wallet_subtype TEXT NOT NULL DEFAULT 'general'
    CHECK (wallet_subtype IN ('ton','crypto','ewallet','general'));

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

# Логи Railway (через MCP или Railway CLI)
# MCP: railway-mcp-server → get-logs
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

> **После прочтения этого промпта:** открой `workflow_state.md` (секция 1 и 8)
> для актуального состояния, затем можно начинать работу.
