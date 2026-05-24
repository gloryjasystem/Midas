# WORKFLOW_STATE.MD — Диспетчер задач ИИ-агента Midas

> **Тип:** MUTABLE — кратковременная память агента. Обновляется на каждом шаге работы.
> **Обновлён:** 2026-05-24 12:30 (UTC+3)

---

## 1. ТЕКУЩЕЕ СОСТОЯНИЕ

| Параметр | Значение |
|---|---|
| **PHASE** | Phase 5.3-B — Voice Edit Lifecycle Bugfixes (Этап 1 + Этап 2) ✅ DEPLOYED |
| **STEP** | Сессия 2026-05-24 08:00–12:10 (UTC+3). 3 коммита в main: 8cf74f8, b271c8a, 5de29a5. Изменён 1 файл: voice-parse.worker.ts. |
| **AGENT STATUS** | tsc 0 errors. Git clean. Последний коммит: 640db6f. Ветка main. |
| **DEPLOYMENT** | Railway (spirited-happiness) — auto-deploy from main. Midas Online, background-workers Online. |
| **DB STATE** | Без изменений. Миграций не требуется. |
| **DATABASE_URL (public)** | `postgresql://postgres:PLLSqArtPUoQsAYmvrpsmavfQMewgTRh@hopper.proxy.rlwy.net:46284/railway` |
| **LAST COMPLETED** | Phase 5.3-B: 3 коммита (8cf74f8 — orphaned card cleanup, b271c8a — clar state fix + TTL 300s, 5de29a5 — nav screen cleanup). |
| **BLOCKER** | Anthropic API баланс исчерпан — ai-parse падает с BadRequestError 400 "credit balance too low". Пополнить на console.anthropic.com. Голосовые команды detectCommand работают без Claude. |
| **NEXT ACTION** | Phase 3.1 (словарь item-category-detector 500+), Phase 3.2 (Report 3.0). |

---

## 2. ЗАВЕРШЁННЫЕ ФАЗЫ

### Foundation (Phase 0.x – 1.5)

| Фаза | Коммит | Суть |
|---|---|---|
| 0.1 Event Storming | — | 46 событий, 10 агрегатов, docs/event_storming_part{1,2,3}.md |
| 0.2 ADR Generation | — | ADR-000 — ADR-014 (15 ADR) |
| 0.3 Readiness Gate | — | phase1_scope.md, database_model_draft.md, queue_model.md, mvp_acceptance_criteria.md |
| 0.3.1 Security Patch | — | SEC-01 — SEC-12 |
| 1.1 Infra Foundation | — | Turborepo monorepo, Docker, ESLint, TypeScript |
| 1.2 DB Foundation | — | schema, RLS, withTenantTransaction, Decimal boundary |
| 1.3 BullMQ Queues | — | queues/, workers/, shared/ job types |
| 1.4 Telegram Bot | 6e0cfa1 | Fastify server, SEC-04/05/06/12, webhook, workspace resolver |
| 1.5 Onboarding | 9307800 | findOrCreateUser (atomic), resolveWorkspace, /start, Redis anti-spam |

### Core Pipeline (Phase 1.6 – 1.19)

| Фаза | Коммит | Суть |
|---|---|---|
| 1.6-A AI Parse | 7b393d2 | claude-client + Zod + draft.service + ai-parse.worker. 73/73 smoke |
| 1.6-B HitL Confirm | d49625b | draft-confirmation (SELECT FOR UPDATE SKIP LOCKED), race-safe. 30/30 |
| 1.7 Draft Expiration | 49e0cec | CRON system_expire_pending_drafts, SECDEF. 20/20 |
| 1.8-A Intent | 51b6aee | parsed_intent + transaction_intent columns. 19/19 |
| 1.8-B Hardening | 7af1692 | telegram_user_id fix, search_path, TRANSACTION_TYPE 5 values. 16/16 |
| 1.9 /report | e060edb | Monthly report grouped by intent, UTC, Russian. 47/47 |
| 1.10 /help + Guard | b321463 | parseCommandToken, KNOWN_COMMANDS, unknown-slash guard. 30/30 |
| 1.11 /category | 2e77362 | getCategoryList read-only, grouped by category_group. 78/78 |
| 1.12 Onboard Seed | 7b87eac | SECDEF onboarding seed (7-param), default account+category. 37/37 |
| 1.13 /add_category | eac55a9 | parseAddCategoryArgs, resolveGroup, INSERT ON CONFLICT. 74/74 |
| 1.14 /accounts | 362b05b | getAccountList read-only. 70/70 |
| 1.15 HTML Escape | 4f63a91 | escapeHtml utility, applied to account/category names. 52/52 |
| 1.16 UNIQUE Name | 3ad45e3 | UNIQUE(workspace_id, name) on account_sources. 24/24 |
| 1.17 /add_account | 8c370e3 | parseAddAccountArgs, INSERT ON CONFLICT. 27/27 |
| 1.18 /report CCY | 700a244 | base_currency grouping in report. 34/34 |
| 1.19 CCY CHECK | 9d288bd | CHECK (currency ~ '^[A-Z]{3,5}$'). 24/24 |

### Balance & Settings (Phase 1.20 – 1.27)

| Фаза | Коммит | Суть |
|---|---|---|
| 1.20 Balance Design | — | docs/balance-semantics.md, D1–D6 approved. No code |
| 1.21 /balance | 976418a | initial_balance migration, balance.service.ts. 28/28 |
| 1.22 Comment Cleanup | d2ea3fd | Comment-only fix in webhook.route.ts |
| 1.23 /set_balance | 65a8e56 | Recalculates initial_balance = target − SUM(txns). 34/34 |
| 1.24 Default CCY→USDT | 97a4331 | Workspace default_currency RUB→USDT. 20/20 |
| 1.25 /settings Text | f6307a1 | settings.service.ts, currency+timezone text commands |
| 1.26 /settings UI | fb338db | Inline keyboards, pagination, Redis search. 45/45 |
| 1.27 Multi-CCY Balance | 12e70d9 | SQL-level mismatch exclusion, footnote. 27/27 |

### Edit & Delete (Phase 1.28 – 1.29)

| Фаза | Коммит | Суть |
|---|---|---|
| 1.28 /edit MVP | c8bbc7d | Transaction list+card, amount/cat/acc/intent edit, Redis TTL 300s. 43/43 |
| 1.29 Soft Delete | 7082540 | deleted_at column, double-confirm UX, 11 query guards. 44/44 |

### Account Onboarding & Inline Creation (Phase 1.30 – 1.31)

| Фаза | Коммит | Суть |
|---|---|---|
| 1.30 Smart Onboarding | 4593867 | account-onboard-keyboard.service.ts, guided /start+/accounts. 64/64 |
| 1.31 Inline Accounts | 7c065f7 | account_hint in AI, fuzzy match, ia: namespace. 27/27 |

### AI & UX Overhaul (Phase 1.32 – 1.40)

| Фаза | Коммит | Суть |
|---|---|---|
| 1.32 Clarification | e00f37e | needs_clarification status, partial ParseResult, clar: callbacks. 57/57 |
| 1.33 Clean Chat | 36cacd7 | active-message.service.ts, midas:am: pointer, edit-first UX |
| 1.34 Rich Cards | 6e899f0 | screen-builder.ts (both apps), preview/confirmed card formatting |
| 1.35 Smart Categories | — | 28-category taxonomy, CategoryResolver, item_hint. 55/55. Deployed |
| 1.36-UX Nav Keyboard | 062d40d | ReplyKeyboardMarkup 2×2, is_persistent:false, tx history as separate msgs |
| 1.37 AI Taxonomy | 641ad26 | Zero-clutter UX, 30 categories, 500+ anchors, ALLOWED_CATEGORIES |
| 1.38 Currency Hardening | c59f2e1 | Reject in-place edit, blockquote design, awaiting_cur fix |
| 1.39 Gate UX | 089abf6 | Edit-in-place gate, formatAmount String() cast |
| 1.40 Dead Card | 51eaf10 | midas:dead_card auto-cleanup between previews |

### Phase 2.x — Full UI System

| Фаза | Коммит | Суть |
|---|---|---|
| 2.0 Transaction Hub | d770ca4 | Paginated lists, period picker, intent filter chips [📉📈🤝🔄📊 Все] |
| 2.1 Account Dashboard | — | balance-keyboard.service.ts (450+ lines), CRUD, sub-accounts |
| 2.2 Settings Overhaul | 3e650c1 | 6-button 2×3 grid, Russian currency search, 40 fiat + 48 crypto |
| 2.3 Search + Polish | 70a5d41 | Paginated search, rp:close, keyboard order fix |
| 2.3 Onboard Polish | 395e1f2 | ac:fin, ac:skip→Кошелёк, no afterCreate screen |
| Master Ph.1 Keyboard | 35c92e0 | CURRENCY_FLAGS 40+, paginated picker, fuzzy+transliteration search |
| Master Ph.2 Webhook | 35c92e0 | No-match flow, cur_search, 3 success screens |
| 2.9 Nav Isolation | 1477f55 | sendNavMessage() — separate midas:nav: key, never touches midas:am: |
| 2.9+ Smart Nav | 004966f | Edit-first nav, getNavMessageId/clearNavMessageId, cleanup in AI path |
| 2.10 TX Persistence | b869c03 | isSuccessCard flag, midas:success_card sentinel, double-block delete |
| Balance A Grouped | 4a1748c | classifyAccountGroup, GROUP_EMOJI, sectioned text |
| Balance B-1 Schema | 75156b9 | parent_account_id + sub_type columns on account_sources |
| Balance B-2 Hierarchy | d04bcba | Parent→children ladder, pluralizeCurrency, add_currency button |
| 2.10+ Gate Fix | 8d25ec1 | midas:gate_sent lifecycle fix — frozen UI on concurrent input |

### Phase 3.x — Fixes & Features

| Фаза | Коммит | Суть |
|---|---|---|
| 3.1+ DB Bugfixes | — | transfer_group_id UUID→TEXT, current_screen, auto-migrate on start |
| Currency-Filter | c678c9f | Strict exact-match по валюте в пикере. ai-parse + account.service |
| Multi-CCY Inline | fe14bcf | Child-счета (Binance·BTC + Binance·USDT), use_existing, rename_for_dup |

### Excel Export 2.0

| Фаза | Коммит | Суть |
|---|---|---|
| Sheet 1 Fixes | — | Переводы в 1 строке, Ø чек fix, burn rate fix |
| Sheet 0 Overhaul | fdf21fc | Smart period (no 1970), overflow wrap, ДВИЖЕНИЕ КАПИТАЛА per-pair |
| Remove Sheet 6 | 54f0d8c | Контрагенты удалены (person_name никогда не заполняется) |
| Col D Alignment | afb08fa | ДВИЖЕНИЕ КАПИТАЛА: horizontal:center |

### Phase 2S2 — Voice Commands

| Фаза | Коммит | Суть |
|---|---|---|
| cancel_last Fix | dfa168f | midas:last_confirmed key, notifications.worker writes, voice+text reads. Доп. фиксы: NUMERIC .replace, trailing zeros, withTenantTransaction |
| edit_last | 7c21f33 | NavCommand 'edit_last', 9 regex patterns, inline SQL card in voice-parse |

### Phase 5.3 — Voice Edit Lifecycle

| Фаза | Коммит | Суть |
|---|---|---|
| 5.3 Lifecycle Fix | PR #18, 1686899 | tx:done restores last_confirmed (TTL 7d), state gate bypass for edit_*, edit_amount IN-PLACE, nav cleanup guard |
| 5.3-B Bugfixes | 8cf74f8, b271c8a, 5de29a5 | (1) Orphaned "🤔" card cleanup via midas:clar:msg. (2) del(midas:clar:) in success path — fixes "В какой валюте?" collision; TTL 120→300s. (3) Nav screen cleanup via Redis pipeline — del old nav before showing new |

---

## 3. АРХИТЕКТУРНЫЕ РЕШЕНИЯ

- **Runtime:** Node.js 24 + TypeScript (ADR-001)
- **Frontend (future):** React 19 + Vite 8 (ADR-002)
- **Workspace:** 1 default per user, DB multi-workspace-ready (ADR-003)
- **Auth:** WorkspaceMembership, Telegram User ID
- **Primary Keys:** ULID (ADR-004)
- **DB Isolation:** PostgreSQL RLS, `withTenantTransaction(workspaceId, fn)` (SEC-03)
- **Queue:** BullMQ Redis-backed (ADR-014)
- **Financial Precision:** Decimal/NUMERIC only, float запрещён (SEC-02)
- **AI Output:** Strict Zod allowlist (SEC-01)
- **Draft Lifecycle:** pending_user → approved/rejected/expired/needs_clarification
- **Deployment:** Railway (spirited-happiness), auto-deploy from GitHub main

### AI Pipeline

- Модель: `claude-haiku-4-5`, temperature: 0, max_tokens: 256
- System prompt: multilingual (RU/EN/UA) + fuzzy matching + 30-category taxonomy + 500+ anchors + disambiguation
- Post-processing: 7 regex groups, negation guard, confidence boost, ALLOWED_CATEGORIES validation
- Result: `ok` | `partial` | `needs_clarification` | `rejected`
- CategoryResolver: exact DB → 200+ alias map → fallback «Другое»

### UX Architecture

- **Screen Cards:** `screen-builder.ts` pure functions (both apps)
- **Post-confirm card:** `[✏️ Изменить запись]` only — nav via Reply Keyboard
- **Persistent Nav:** `ReplyKeyboardMarkup` (is_persistent:false) 2×2: [💰 Баланс][📊 Отчёт] / [📋 Транзакции][⚙️ Настройки]
- **Transaction Hub Filters:** 5 icon chips [📉📈🤝🔄📊 Все], intent filter 'a'|'e'|'i'|'d'|'t'
- **Keyboard Carrier:** Greeting msg stays forever — носитель ReplyKeyboard
- **Transaction History:** Each preview = new sendMessage. History accumulates. Edit-in-place via midas:preview:{draftId}
- **Keyboard Consistency:** confirmKb: ✅ full-width + [✏️|❌] split row

### Redis Keys (актуальные)

| Ключ | TTL | Назначение |
|---|---|---|
| `midas:preview:{draftId}` | 600s | msgId preview-карточки. Write: notifications.worker. Read+DEL: confirmation.worker |
| `midas:clar:{uid}:{cid}` | 300s | Intercept суммы при clarification. DEL on confirm/reject. **5.3-B:** DEL в voice success path (приоритет Step 5f-clar > 5g-tx-edit) |
| `midas:clar:msg:{uid}:{cid}` | — | msgId nonsense-"🤔". DEL при следующем успешном парсе |
| `midas:ac:{uid}:{cid}` | 300s | Account onboarding FSM (step, name, currency, pendingName, isCustomName, cur_search) |
| `midas:edit:{uid}:{cid}` | 300s | Edit amount text intercept |
| `midas:awaiting_cur:{chatId}` | 600s | Ожидание валюты. Хранит `{draftId}:{workspaceId}:{userId}` |
| `midas:cur_set:{workspaceId}` | — | Флаг установленной валюты в Настройках |
| `midas:gate_sent:{uid}:{cid}` | 1h | Gate уже сработал — не повторять edit |
| `midas:dead_card:{chatId}` | 24h | msgId карточки ❌/⏰ для auto-cleanup |
| `midas:am:{uid}:{cid}` | 24h | Active message pointer. DEL on approve. Step-7 checks success_card before del |
| `midas:success_card:{msgId}` | 30d | Sentinel — EXISTS блокирует удаление success card в step-7 |
| `midas:last_confirmed:{uid}:{cid}` | 7d | msgId «✅ Записано». Write: notifications.worker + tx:done. Read: cancel_last, edit_last, deleteSuccessCardW, nav cleanup guard |
| `midas:nav:{uid}:{cid}` | 24h | Nav screen pointer. Managed by sendNavMessage(). Cleanup in AI path + voice success path |
| `midas:tx:edit:amt:{uid}:{cid}` | 300s | Bridge для voice edit_amount. Хранит `{txId}:{statusMsgId}:s`. Read: Step 5g-tx-edit |
| `midas:tx:sr:ctx:{uid}:{cid}` | 600s | Search pagination context JSON |
| `bl:state:{uid}:{cid}` | 300s | Balance management text intercept (rename, set_balance, currency_input) |
| `bl:source:{uid}:{cid}` | 300s | Флаг: онбординг из баланс-дашборда |
| `midas:greet:{uid}:{cid}` | — | Артефакт /start. Записывается, никогда не используется |

---

## 4. PROJECT_CONFIG STATUS

- `project_config.md` v1.4 — Phase 1.37 taxonomy, Phase 2.0 documented
- SEC-01 — SEC-12 обязательны
- **🔒 ЗАБЛОКИРОВАН** — изменение только по прямому приказу

---

## 5. INFRASTRUCTURE

### MCP-серверы

| MCP | Статус | Назначение |
|---|---|---|
| Railway | 🟢 | Деплой, логи. Project: spirited-happiness |
| GitHub | 🟢 | Repo: gloryjasystem/Midas. Auto-deploy on push main |
| Postgres | 🟢 | Read-only SQL к production DB |
| Filesystem | 🟢 | Чтение/запись в workspace |

### Railway Services

| Сервис | Домен |
|---|---|
| Midas (Fastify webhook) | midas-production-f4f1.up.railway.app |
| background-workers (BullMQ) | Internal only |
| Postgres 17 | postgres.railway.internal:5432 |
| Redis 7 | redis.railway.internal:6379 |

### Ключевые переменные

| Переменная | Примечание |
|---|---|
| `DATABASE_URL` | postgres.railway.internal (internal) |
| `REDIS_URL` | redis.railway.internal |
| `TELEGRAM_BOT_TOKEN` | ⚠️ Требует ротации |
| `ANTHROPIC_API_KEY` | ⚠️ Требует ротации |
| `TELEGRAM_WEBHOOK_SECRET` | midas_wh_secret_2026_prod |

---

## 6. ПОЛНЫЙ ФЛОУ ПРОДУКТА

### Этап 0 — /start

1. `system_find_or_create_user()` (SECDEF, atomic, pg_advisory_xact_lock)
2. Создаётся: workspace (USDT, UTC), membership, default account («По умолчанию», USDT), default category (Другое)
3. ReplyKeyboard 2×2: [💰 Баланс][📊 Отчёт] / [📋 Транзакции][⚙️ Настройки]
4. Если 0 счетов → guided onboarding keyboard
5. Greeting-сообщение никогда не удаляется — носитель ReplyKeyboard

### Этап 1 — Онбординг счётов

- Пикер типа: [🏦 Карта][💵 Наличные][📊 Биржа][💎 Кошелёк][✏️ Своё][⏭ Без счёта]
- ac:skip → тихо создаёт «Кошелёк» (USD) если 0 счетов
- Карта/Биржа/Кошелёк → name_input → fuzzy match → currency picker → bal_input → success → repeat/finish
- Наличные → skip name_input → currency → balance
- Currency picker: paginated (🔍 Найти валюту), fuzzy+transliteration
- ac:fin → DEL Redis, DEL msg, send ReplyKeyboard

### Этап 2 — Транзакция

1. Текст → webhook interceptors → AI parse queue
2. Claude Haiku → intent/amount/currency/category_hint/confidence
3. Post-processing → CategoryResolver → createDraft (pending_user)
4. notifications.worker → preview card: [✅ Записать][✏️ Изменить][❌ Отмена]
5. midas:preview:{draftId} = msgId (TTL 600s)
6. ✅ → confirmation.worker → SELECT FOR UPDATE → INSERT transactions → editMessageText → «✅ Записано» + [✏️ Изменить запись]
7. ❌ → rejected → «❌ Отменено» → midas:dead_card (auto-cleanup)

### Спецсценарии

- **partial (нет суммы):** needs_clarification → midas:clar: → intercept числа
- **awaiting_cur:** есть сумма, нет валюты, нет cur_set → intercept валюты
- **Gate:** active draft → edit-in-place warning card → midas:gate_sent
- **Transfer:** source picker → target picker (tp: namespace) → курс если разные CCY
- **Voice nav:** STT (Grok) → detectCommand → buildVoiceNavResponse → editStatusMessage
- **Voice edit:** edit_amount/category/account/type → in-place via editAmountBridge

### Ключевые сущности

```
workspaces
  ├── workspace_memberships (telegramUserId → workspaceId)
  ├── account_sources (parent_account_id, sub_type, currency)
  ├── categories (category_group: Бизнес/Жизнь)
  ├── transaction_drafts (pending → approved/rejected/expired)
  └── transactions (confirmed, deleted_at for soft delete)
```

---

## 7. АРХИТЕКТУРА INTENT-ROUTING

```
confirmation.worker:
  transfer_target_account_id ≠ NULL → approvePairedTransfer() → paired outbound+inbound
  NULL → approveDraft() → одиночная транзакция

Phase 3.1 перехват (webhook.route.ts):
  intent=transfer + no target + no category_id → target picker (tp: flow)
  intent=transfer + no target + HAS category_id → approveDraft() [external]
  intent=transfer + target есть → approvePairedTransfer() [internal paired]
```

---

## 8. ПРОМПТ ДЛЯ СТАРТА НОВОГО ЧАТА

```
ПРОЕКТ: Midas — Telegram-бот для личного финансового учёта.
Railway (project: spirited-happiness). MCP: Railway, GitHub, Postgres, Filesystem.
Auto-deploy: push to main → GitHub → Railway строит Midas + background-workers.
DB: postgresql://postgres:PLLSqArtPUoQsAYmvrpsmavfQMewgTRh@hopper.proxy.rlwy.net:46284/railway
Workspace: C:\Users\secvency\Desktop\Midas\midas-monorepo

ПРОЧИТАЙ СНАЧАЛА: workflow_state.md — полная история, архитектура, Redis-ключи.

ПРАВИЛА:
- Финансовая математика: ТОЛЬКО NUMERIC/BigInt (SEC-02)
- Мутации через withTenantTransaction (SEC-03)
- Не трогать project_config.md без явного разрешения
- workflow_state.md редактировать ТОЛЬКО через Node.js (UTF-8 BOM)

СЛЕДУЮЩИЕ ЗАДАЧИ:
1. Phase 3.1 — расширение словаря детектора категорий (500+)
2. Phase 3.2 — Report 3.0 (категорийная аналитика)
```

---

## 9. ИСТОРИЯ ДЕЙСТВИЙ (КЛЮЧЕВЫЕ СЕССИИ)

| Дата | Событие |
|---|---|
| 2026-05-04 | Проект инициализирован: project_config.md v1.0 + Phase 0.1–0.3.1 (Event Storming, ADR, Readiness Gate, Security Patch) |
| 2026-05-04–05 | Phase 1.1–1.5: Infrastructure, DB, BullMQ, Telegram Bot, Onboarding. Все smoke тесты PASS |
| 2026-05-05–06 | Phase 1.6–1.19: AI Parse Pipeline, HitL Confirmation, Draft Expiration, Intent, Hardening, /report, /help, /category, /add_category, /accounts, HTML Escaping, UNIQUE constraint, /add_account, /report CCY, currency CHECK. Тесты от 73/73 до 668/668 |
| 2026-05-07 | Phase 1.20–1.29: Balance design+impl, /set_balance, default USDT, /settings text+UI, multicurrency balance, /edit MVP, soft delete. Тесты до 941/941 |
| 2026-05-07–08 | Phase 1.30–1.34: Smart onboarding, inline accounts, clarification engine, clean chat UX, rich screen cards |
| 2026-05-08–09 | Phase 1.35–1.40: Intelligent categories (28→30 taxonomy), nav keyboard, AI taxonomy, currency hardening, gate UX, dead card cleanup |
| 2026-05-09–11 | Phase 2.0–2.3: Transaction Hub, Account Dashboard, Settings Overhaul, Search Pagination, Onboarding Polish |
| 2026-05-11–13 | Master Roadmap Ph.1–2: Currency picker redesign, webhook FSM (no-match, cur_search), Nav isolation (midas:nav:) |
| 2026-05-13–15 | Phase 2.10+: TX persistence fixes, Balance grouped UI, hierarchical accounts (parent/child), Gate Fix (frozen UI) |
| 2026-05-15–19 | Balance UI Polish B-9+, transfer flow refactoring, intent semantics fix, Phase 3.1 transfer intercept, ai-parse resilience, dative names |
| 2026-05-20 | Phase 3.1+ DB Bugfixes: transfer_group_id UUID→TEXT, current_screen, auto-migrate, ::UUID cast removal |
| 2026-05-21 | Currency-Filter (strict exact-match), Multi-CCY Inline (child accounts), Excel Export 2.0 (4 commits) |
| 2026-05-22 | Phase 2S2: cancel_last fix (midas:last_confirmed), edit_last voice+text command |
| 2026-05-22–23 | Semantic custom category implementation (separate chat) |
| 2026-05-23 | Phase 5.3: Voice Quick Edit Lifecycle Fix — 4 commits, PR #18, 5 fixes in 2 files |
| 2026-05-24 | Phase 5.3-B: Orphaned card cleanup, clar state fix, nav screen cleanup — 3 commits. Anthropic API balance exhausted (BadRequestError 400) |

---

## 10. ACTIVE ROADMAP

### ✅ Завершено: Phase 2.5 (Smart Transaction Logic)

- item-category-detector.service.ts — 200+ записей, 9 категорий
- account-currency-validator.service.ts — блокировка несовместимых пар
- anomalyBadge() в пикерах
- Active Draft Gate fix в ai-parse

### ✅ Завершено: Phase 2.5+ (Currency-Aware Account Picker)

- Strict exact-match по валюте в обоих пайплайнах (telegram-bot + background-workers)
- isKnownCurrency() вайтлист, filterPickerAccounts()

### ⏳ Phase 3.0 — DB Schema: account_type/wallet_subtype

> **Приоритет: ВЫСОКИЙ.** Текущая валидация эвристическая (Redis). Phase 3.0 → 100% schema-enforced.

```sql
ALTER TABLE account_sources
  ADD COLUMN account_type    TEXT CHECK (account_type IN ('card','cash','exchange','wallet','custom')),
  ADD COLUMN wallet_subtype  TEXT CHECK (wallet_subtype IN ('crypto','ewallet','ton','lightning')),
  ADD COLUMN provider_key    TEXT;  -- 'mono', 'binance', etc.
```

Файлы: migration (NEW), account.service.ts, webhook.route.ts, account-inline-keyboard, account-currency-validator. ~3–4 часа.

### 📋 Phase 3.1 — Расширение словаря детектора категорий

> **СРЕДНИЙ.** Цель: 200+ → 500+ записей. Добавить: Путешествия, Подарки, Питомцы, Инвестиции. 150+ локальных брендов (АТБ, Kaspi, Wildberries). Транслитерация.

### 📋 Phase 3.2 — Отчёт 3.0: Категорийная аналитика

> **СРЕДНИЙ.** Разбивка расходов по категориям + топ-5 трат за период.

### 📋 Phase 4.0 — Telegram Mini App

> **НИЗКИЙ / БУДУЩЕЕ.** React 19 + Vite 8. Не начинать до Phase 3.x.

| Фаза | Приоритет | Статус |
|---|---|---|
| 3.0 DB Schema | 🔴 ВЫСОКИЙ | ⏳ Следующая |
| 3.1 Словарь | 🟡 СРЕДНИЙ | 📋 Запланирована |
| 3.2 Отчёт 3.0 | 🟡 СРЕДНИЙ | 📋 Запланирована |
| 4.0 Mini App | 🟢 НИЗКИЙ | 📋 Будущее |

---

## 11. AGENT OPERATING PROTOCOLS (СЖАТЫЕ)

1. **Чтение перед работой:** workflow_state.md → project_config.md → фазовый scope
2. **Acceptance Gate:** Traceability Review + Adversarial Security Review + Scope Guard Review
3. **Git:** checkpoint commit перед/после каждой фазы. Формат: `feat(scope): description`
4. **workflow_state.md:** обновлять после каждого важного шага. Dispatcher, не архив
5. **Context Reset:** рекомендовать новый чат когда context переполнен. Перед этим: update workflow, compress history, git checkpoint
6. **Phase Awareness:** понимать roadmap, реализовывать только текущую фазу
7. **Owner Approval:** ждать APPROVED перед: новая фаза, миграции, project_config, новые deps, scope расширение
8. **Self-Audit:** при завершении фазы — 10-строчная таблица проверок (дата, sections, git, scope)
