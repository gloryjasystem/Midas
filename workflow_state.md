# WORKFLOW_STATE.MD — Диспетчер задач ИИ-агента Midas

> **Тип:** MUTABLE — кратковременная память агента. Обновляется на каждом шаге работы.
> **Обновлён:** 2026-05-14 00:00 (UTC+3)

---

## 1. ТЕКУЩЕЕ СОСТОЯНИЕ

| Параметр | Значение |
|---|---|
| **PHASE** | `2.10+ — Gate Fix: Frozen UI on Concurrent Transaction Input` |
| **STEP** | `All bugfixes deployed ✅ (commits df15a01 → 8894b92 → b869c03 → 8d25ec1)` |
| **AGENT STATUS** | `DONE. Gate freeze fix: (1) webhook step-7 checks midas:gate_sent: before deleting amId — gate card stays visible on TX3+. (2) ia:pk: clears gate_sent after account pick. (3) ai-parse gate rebuilds full picker keyboard when accountId is null.` |
| **DEPLOYMENT** | `Railway (spirited-happiness project)` — `Midas` ✅ Online · `background-workers` ✅ Online · `Postgres` ✅ · `Redis` ✅. Gate fix deployed. Health: https://midas-production-f4f1.up.railway.app/health → {"status":"ok"} |
| **LAST COMPLETED** | `Phase 2.10+ COMPLETE — gate_sent guard in step-7 prevents frozen UI. Commits b869c03 → 8d25ec1 pushed to main.` |
| **BLOCKER** | None. |
| **NEXT ACTION** | Phase 3.0 — DB Migration: добавить колонки `account_type`, `wallet_subtype`, `provider_key` в `account_sources`. Заполнять при создании счёта. Использовать для 100% точной валидации вместо эвристик. (см. Раздел 16 — Active Roadmap) |


---

## 2. ЗАВЕРШЁННЫЕ ФАЗЫ

| Фаза | Статус | Ключевые артефакты |
|---|---|---|
| 0.1 Event Storming | ✅ | `docs/event_storming_part{1,2,3}.md` |
| 0.2 ADR Generation | ✅ | `docs/adr/ADR-000` — `ADR-014` (15 ADR) |
| 0.3 Implementation Readiness Gate | ✅ | `phase1_scope.md`, `database_model_draft.md`, `queue_model.md`, `mvp_acceptance_criteria.md` |
| 0.3.1 Security & Traceability Patch | ✅ | SEC-01 — SEC-12 внесены в scope, DB model, queue model, acceptance criteria, ADR-009, ADR-013 |
| 1.1 Project Infrastructure Foundation | ✅ | `midas-monorepo/` — полная структура Turborepo, Docker Compose, ESLint, TypeScript |
| 1.2 Database Foundation | ✅ | `packages/database/` — schema, RLS, withTenantTransaction, Decimal boundary |
| 1.3 BullMQ Task Queue Foundation | ✅ | `apps/background-workers/src/queues/`, `workers/`, `packages/shared/` job types |
| 1.4 Telegram Bot Foundation | ✅ | `apps/telegram-bot/src/` — Fastify server, SEC-04/05/06/12, webhook route, workspace resolver stub |
| 1.5 User Onboarding & Workspace Resolution | ✅ | `services/onboarding.service.ts`, `rate-limiter.ts`, `telegram-api.ts`, real `resolveWorkspace()`, `/start` handler |
| 1.6-A AI Parse Pipeline | ✅ | `packages/ai-core/`, `draft.service.ts`, `ai-parse.worker.ts`, 73/73 smoke tests, commit `7b393d2` |
| 1.6-B HitL Draft Confirmation | ✅ ACCEPTED | `draft-confirmation.service.ts`, `confirmation.worker.ts`, `callback-confirm-queue.ts`, webhook callback_query handler, 30/30 smoke tests incl. race condition, commit `d49625b` |
| 1.7 Draft Expiration & Lifecycle Cleanup | ✅ ACCEPTED | `migrations/1777973960000_draft-expiration.js` + `1777973970000_harden-expire-search-path.js` + `1777973980000_fix-expire-function-owner.js`, `draft-expiration.service.ts`, `draft-expiration.worker.ts`, `smoke-test-phase17.mjs` — 20/20 smoke tests PASS, commits `b9069ad`→`49e0cec` |
| 1.8-A Transaction Intent Foundation | ✅ ACCEPTED | `migrations/1778008338096_transaction-intent.js`, `draft.service.ts` (parsed_intent propagation), `draft-confirmation.service.ts` (intent_missing outcome), `confirmation.worker.ts` (intent_missing messages), `smoke-test-phase18a.mjs` — 19/19 smoke tests PASS, 155/155 total regression PASS, commits `425df61`→`51b6aee` |
| 1.8-B Runtime Consistency & Security Hardening | ✅ ACCEPTED | C-1: `draft.service.ts` `telegram_user_id`→`telegram_id` fix. C-2: `migrations/1778008400000_harden-onboarding-search-path.js` — `search_path` fixed for 2 SECDEF functions. M-1: `shared/index.ts` `TRANSACTION_TYPE` updated to 5 canonical values. `smoke-test-phase18b.mjs` — 16/16 PASS, 171/171 total regression PASS, commit `7af1692` |
| 1.9 Basic Text /report Command | ✅ ACCEPTED | `apps/telegram-bot/src/services/report.service.ts`, `apps/telegram-bot/src/routes/webhook.route.ts`, `apps/telegram-bot/src/services/workspace-resolver.ts`, `packages/database/smoke-test-phase19.mjs` — /report command, current UTC month, grouped by transaction_intent, Russian text output — 47/47 Phase 1.9 tests, 218/218 total regression PASS, implementation commit `e060edb`; workflow sync `dffb53e`, `1ec649e`; tag `phase-1.9-accepted`. |
| 1.10 Slash-Command Guard + Inline /help | ✅ ACCEPTED | `webhook.route.ts` (parseCommandToken, KNOWN_COMMANDS, /help, guard), `smoke-test-phase110.mjs` — 30/30 smoke tests PASS, 248/248 total regression PASS, commit `b321463`, tag `phase-1.10-accepted`. |
| 1.11 /category Read-Only List Command | ✅ ACCEPTED | `apps/telegram-bot/src/services/category.service.ts` (new), `webhook.route.ts` (KNOWN_COMMANDS, HELP_TEXT, /category handler), `smoke-test-phase111.mjs` — 78/78 Phase 1.11 + 326/326 total regression PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Implementation commit `2e77362`, tag `phase-1.11-accepted` pushed. |
| 1.12 Onboarding Default Data Seeding | ✅ ACCEPTED | `migrations/1778100000000_onboarding-default-seed.js` + `1778100010000_fix-onboarding-seed-conflict.js` (7-param SECDEF function), `onboarding.service.ts` (candidateAccountId + candidateCategoryId), `smoke-test-phase112.mjs` — 37/37 Phase 1.12 + 363/363 total regression PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Implementation commit `7b87eac`, tag `phase-1.12-accepted` pushed. |
| 1.13 /add_category Strict-Format Command | ✅ ACCEPTED | `category.service.ts` (`parseAddCategoryArgs`, `resolveGroup`, `addCategory`, `AddCategoryResult`), `webhook.route.ts` (KNOWN_COMMANDS 4→5, HELP_TEXT, handler `5e-add`), `smoke-test-phase113.mjs` — 74/74 Phase 1.13 + 437/437 total regression PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Implementation commit `eac55a9`, tag `phase-1.13-accepted` pushed. |
| 1.14 /accounts Read-Only List Command | ✅ ACCEPTED | `apps/telegram-bot/src/services/account.service.ts` (new), `webhook.route.ts` (KNOWN_COMMANDS 5→6, HELP_TEXT, handler `5d-acc`), `smoke-test-phase114.mjs` — 70/70 Phase 1.14 + 507/507 total regression PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Implementation commit `362b05b`, tag `phase-1.14-accepted` pushed. Note: HTML escaping for account/category names must be added before user-controlled write paths (/add_account). |
| 1.15 HTML Escaping Hardening | ✅ ACCEPTED | `apps/telegram-bot/src/utils/html-escape.ts` (NEW), `account.service.ts` (MODIFY), `category.service.ts` (MODIFY), `webhook.route.ts` (MODIFY), `smoke-test-phase115.mjs` (NEW) — 52/52 Phase 1.15 + 559/559 total PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Traceability fix: `groupToken` escaped in error message. Implementation commit `4f63a91`; workflow_state sync commit `88ebae3`; test-count fix commit `45b1eec`. Tag `phase-1.15-accepted` pushed. |
| 1.16 account_sources UNIQUE Constraint Migration | ✅ ACCEPTED | `packages/database/migrations/1778200000000_account-sources-unique-name.js` (NEW), `packages/database/smoke-test-phase116.mjs` (NEW) — UNIQUE(workspace_id, name) added; pre-flight 0 duplicates; 24/24 Phase 1.16 + 583/583 total PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Implementation commit `3ad45e3`. Tag `phase-1.16-accepted` pushed. |
| 1.17 /add_account Strict-Format Command | ✅ ACCEPTED | `account.service.ts` (MODIFY), `webhook.route.ts` (MODIFY), `smoke-test-phase117.mjs` (NEW) — 27/27 Phase 1.17 + 610/610 total PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Implementation commit `8c370e3`. Tag `phase-1.17-accepted` pushed. |
| 1.18 /report Currency Label (base_currency grouping) | ✅ ACCEPTED | `report.service.ts` (MODIFY), `smoke-test-phase118.mjs` (NEW), `smoke-test-phase19.mjs` (MODIFY — runReportQuery SQL helper sync) — 34/34 Phase 1.18 + 644/644 total PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Implementation commit `700a244`. Tag `phase-1.18-accepted` pushed. |
| 1.19 account_sources.currency CHECK Constraint | ✅ ACCEPTED | `packages/database/migrations/1778300000000_account-sources-currency-check.js` (NEW), `packages/database/smoke-test-phase119.mjs` (NEW) — CHECK (currency ~ '^[A-Z]{3,5}$'); pre-flight 0 invalid rows; 24/24 Phase 1.19 + 668/668 total PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Implementation commit `9d288bd`. Tag `phase-1.19-accepted` pushed. |
| 1.20 Balance Semantics Design Document | ✅ ACCEPTED | `docs/balance-semantics.md` (NEW) — 6 design decisions D1–D6 all approved. Formula: income+1/expense−1/debt_given−1/debt_received+1/transfer neutral. initial_balance NUMERIC(19,4) DEFAULT 0 approved (allow negative, account currency implicit, no date). Per-account output, all-time scope. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. No code. Tag `phase-1.20-accepted` pushed. |
| 1.21 Unified Balance Implementation | ✅ ACCEPTED | `migrations/1778400000000_account-sources-initial-balance.js` (NEW), `balance.service.ts` (NEW), `webhook.route.ts` (MODIFY — /balance added, KNOWN_COMMANDS 7→8, HELP_TEXT), `smoke-test-phase121.mjs` (NEW). 28/28 Phase 1.21 + 655/655 regression smoke + 13/13 typecheck+lint = 696/696 PASS. Phase 1.5 server-dependent tests excluded from baseline (pre-existing). Tech debt: stale /balance comment in webhook.route.ts line 31 (cosmetic, not blocking). Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Implementation commit `976418a`. Tag `phase-1.21-accepted` pushed. |
| 1.22 Stale Comment Cleanup | ✅ ACCEPTED | `webhook.route.ts` (MODIFY — comment-only: slash-command routing header updated, all 8 known commands listed, stale “(e.g. /balance)” example removed, Phase 1.21 added to phase refs). 0 logic changes. 13/13 typecheck+lint PASS (FULL TURBO). Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Implementation commit `d2ea3fd`. Tag `phase-1.22-accepted` pushed. |
| 1.23 /set_balance Command | ✅ ACCEPTED | `setBalance.service.ts` (NEW), `webhook.route.ts` (MODIFY). Tag `phase-1.23-accepted` pushed. |
| 1.24 /balance Formatting Polish | ✅ ACCEPTED | `balance.service.ts` (MODIFY). Tag `phase-1.24-accepted` pushed. |
| 1.25 /settings Text Commands | ✅ ACCEPTED | `settings.service.ts` (NEW). /settings currency, /settings timezone. Tag `phase-1.25-accepted` pushed. |
| 1.26 /settings UI | ✅ ACCEPTED | `settings-keyboard.service.ts` (NEW), `currencies.ts` (NEW). Inline keyboards, groups, pagination, Redis search state. 45/45 smoke. Tag `phase-1.26-accepted` pushed. |
| 1.27 Multicurrency Balance Hardening | ✅ ACCEPTED | `balance.service.ts` (MODIFY). SQL-level mismatch exclusion, mismatch footnote. 27/27 smoke. Tag `phase-1.27-accepted` pushed. |
| 1.28 /edit Transactions MVP | ✅ ACCEPTED | `edit.service.ts` (NEW), `edit-keyboard.service.ts` (NEW), `webhook.route.ts` (MODIFY), `confirmation.worker.ts` (MODIFY), `smoke-test-phase128.mjs` (NEW). /edit list+card+edit amount/category/account/intent. Permanent [✏️ Изменить] on confirmed msgs. Redis TTL 300s. ULID+workspace guards. Strict callback_data ≤62 bytes verified. No search/date/delete/soft-delete/GIN, no migrations, no /balance or /report changes. 43/43 Phase 1.28 smoke + 841/841 regression smoke + 13/13 typecheck/lint = 897/897 PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Implementation commit c8bbc7d. Tag `phase-1.28-accepted` pushed. |
| 1.29 Transaction Soft Delete | ✅ ACCEPTED | `migrations/1778700000000_transactions-soft-delete.js` (NEW). deleted_at TIMESTAMPTZ DEFAULT NULL; soft delete via UPDATE; excluded from /edit, /balance (LEFT JOIN ON), /report, /set_balance; 941/941 gates PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. impl commit 7082540. Tag `phase-1.29-accepted` pushed. |
| 1.30 Smart Account Onboarding | ✅ ACCEPTED | `account-onboard-keyboard.service.ts` (NEW), `account.service.ts` (hasAccounts, addAccountWithCurrency), `webhook.route.ts` (MODIFY — ac: callbacks, /start onboarding, /accounts empty-state, text intercept). Redis TTL midas:ac: 300s. 64/64 Phase 1.30 smoke + 318/318 accessible gates PASS. impl commit 4593867. Tag `phase-1.30-accepted` pushed. |
| 1.31 Inline Account Creation | ✅ ACCEPTED | `migrations/1778800000000_drafts-account-hint.js`, `account-fuzzy.service.ts`, `account-inline-keyboard.service.ts`, `account-resolver.service.ts` (bg-workers), `account.service.ts` (MODIFY), `draft.service.ts` (MODIFY), `ai-parse.worker.ts` (MODIFY), `webhook.route.ts` (MODIFY), `draft-confirmation.service.ts` (MODIFY), `schemas.ts`+`prompts.ts` (MODIFY). Option A: resolve before keyboard. ia: namespace ≤62 bytes. 27/27 smoke + 13/13 typecheck/lint PASS. Implementation commit 7c065f7. |
| 1.32 Smart Text Input / Clarification Engine | ✅ ACCEPTED | `migrations/1778900000000_draft-clarification-state.js` (NEW), `schemas.ts` (amount/intent optional, PARTIAL_CONFIDENCE_THRESHOLD=0.3, MissingField), `claude-client.ts` ('partial' ParseResult, computeMissingFields), `prompts.ts` (partial examples), `draft.service.ts` (patchDraftAmount/Intent/Category), `ai-parse.worker.ts` (targeted clarification messages), `clarification.service.ts` (NEW, telegram-bot), `webhook.route.ts` (clar: callbacks, midas:clar: intercept), `smoke-test-phase132.mjs` (57/57 PASS). 0 lint/typecheck errors. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Implementation commit e00f37e. Tag `phase-1.32-accepted` pushed. |
| 1.33 Clean Chat / Single Active Message UX | ✅ ACCEPTED | UX-only phase. `active-message.service.ts` (NEW), `telegram-api.ts` (MODIFY), `shared/index.ts` (MODIFY), `webhook.route.ts` (MODIFY), `notifications.worker.ts` (MODIFY), `confirmation.worker.ts` (MODIFY), `ai-parse.worker.ts` (MODIFY). No migrations, no DB schema changes, no new deps. Redis pointer midas:am:{userId}:{chatId} (TTL 24h). upsertBotMessage() edit-first strategy. 0 typecheck errors. Batch-accepted by owner decision. Commit `36cacd7`. Tag `phase-1.33-accepted` pushed. |
| 1.34 Rich Screen Cards — Single-Screen App UX | ✅ ACCEPTED | UX-only phase. `screen-builder.ts` (NEW — both apps), confirmation/preview card formatting. No migrations, no DB schema changes, no new deps. 0 typecheck errors. Batch-accepted by owner decision. Commit `6e899f0`. Tag `phase-1.34-accepted` pushed. |
| 1.35 Intelligent Transaction Understanding | ✅ ACCEPTED | `migrations/1779000000000_intelligent-transactions.js` (NEW), `category-resolver.service.ts` (NEW), `draft.service.ts` (MODIFY), `draft-confirmation.service.ts` (MODIFY), `ai-parse.worker.ts` (MODIFY), `confirmation.worker.ts` (MODIFY), `settings.service.ts`+`settings-keyboard.service.ts` (MODIFY), `webhook.route.ts` (MODIFY), `screen-builder.ts` (MODIFY), `prompts.ts`+`schemas.ts` (MODIFY). smoke-test-phase135.mjs — 55 tests. Deployed to Railway production. |
| 1.36-UX Persistent Navigation Keyboard | ✅ ACCEPTED | **Sub-steps 1–4 (commits c2f012f → 062d40d):** Core nav keyboard + bug fixes + auto-activation + collapsibility. **FINAL state (commits e879dfc → 2a15f31):** Transaction history workflow fully reworked. |
| 1.37 AI Taxonomy & Zero-Clutter UX | ✅ ACCEPTED | Zero-clutter UX, 30-category taxonomy, 500+ anchors, multilingual, disambiguation, ALLOWED_CATEGORIES. Commits `5b02cf3` → `641ad26`. |
| 1.38 Currency Input UX Hardening | ✅ ACCEPTED | `confirmation.worker.ts` (reject in-place edit), `screen-builder.ts` both apps (blockquote design), `webhook.route.ts` (`normalizeCurrencyInput` fix + `awaiting_cur` token extraction). Commits `94b7cac` → `c59f2e1`. |
| 1.39 Gate UX — Edit-In-Place (Variant B) | ✅ DEPLOYED | `ai-parse.worker.ts` (gate block: one edit-in-place instead of 2 new messages), `screen-builder.ts` both apps (`buildGatePausedPreview`: ⚠️ alert banner + draft summary + keyboard stays). `formatAmount()` hardened: `String()` cast для Postgres NUMERIC. `clarification.service.ts`: `::TEXT` cast на `parsed_amount`. Commits `8fa8f91` → `089abf6`. |
| 1.40 Dead Card Auto-Cleanup | ✅ DEPLOYED | `confirmation.worker.ts` (+dead_card write after reject/expired), `draft-expiration.worker.ts` (+dead_card write after CRON expire), `ai-parse.worker.ts` (+dead_card read+delete before new preview). Redis key `midas:dead_card:{chatId}` TTL 24h. Commit `51eaf10`. |
| 2.0 Transaction Hub + Reports 2.0 + Settings 2.0 | ✅ DEPLOYED | `transaction-list.service.ts` (NEW), `transaction-keyboard.service.ts` (NEW), `report-keyboard.service.ts` (NEW), `settings-keyboard.service.ts` (MODIFY). Interactive paginated lists, period picker, filter tabs, /edit deprecation → tx: namespace. Deployed from GitHub `main`. |
| 2.1 Account Management Dashboard | ✅ DEPLOYED | `balance-keyboard.service.ts` (NEW — 450+ lines), `account-onboard-keyboard.service.ts` (MODIFY — bank/wallet presets, fiat/crypto pickers), `account.service.ts` (MODIFY — renameAccount, changeAccountCurrency, softDeleteAccount, deleted_at filters), `balance.service.ts` (MODIFY — getBalanceData, getAccountDetail, setAccountBalanceById, getAccountTxCount), `webhook.route.ts` (MODIFY — bl: handler, text intercepts, balance navigation update). DB migration: `updated_at` + `deleted_at` columns on `account_sources`. |
| 2.2 Settings UI Overhaul | ✅ DEPLOYED | `settings-keyboard.service.ts` (MODIFY — 6-button 2x3 grid, URL поддержки, инфо о боте), `currencies.ts` (MODIFY — Russian aliases, 5-pass search, FIAT 40+ / CRYPTO 48+), `settings.service.ts` (FIX — `deleted_at IS NULL` в `getWorkspaceAccounts`), `webhook.route.ts` (MODIFY — кнопка назад после выбора валюты, единый Main Account handler). Commit `3e650c1`. |
| 2.3 Search Pagination + UX Polish | ✅ DEPLOYED | **Pagination:** `transaction-hub.service.ts` (SEARCH_PAGE_SIZE=8, все 4 search-метода → LIMIT/OFFSET + COUNT(*) = `{items, total}`). `transaction-keyboard.service.ts` (`buildSearchResultsKeyboard(items, page, totalPages)` с ◀️/▶️ навигацией, `search_results_page` cmd, tx:sr:p:{page} parser). `webhook.route.ts` (Redis context `midas:tx:sr:ctx:{uid}:{cid}` TTL 600s, `search_results_page` handler, все text intercepts → paginated API). **Reports close:** `report-keyboard.service.ts` (✖️ Закрыть = `rp:cl` на всех 3 клавиатурах, type `close` в RpCallbackCmd). `webhook.route.ts` (`rp:close` handler → deleteMessage). **Keyboard order:** `screen-builder.ts` — Row 1: [💰 Баланс][📊 Отчёт], Row 2: [📋 Транзакции][⚙️ Настройки]. Commits `6da4464`, `049233d`, `70a5d41`. |
| 2.3 Onboarding UX Polish | ✅ DEPLOYED | **Нет промежуточного afterCreate экрана:** после bal_input/bal_skip сразу показывается `buildFinishOnboardKeyboard()` + `accountAddedText()`. **Новая команда `ac:fin`:** кнопка «✅ Завершить» в пикере типа — чистит Redis, удаляет сообщение, отправляет ReplyKeyboard. **Backward compat:** `ac:more` и `ac:done` обработчики сохранены (старые кнопки в чате). **Иконки:** `buildStartOnboardKeyboard()` исправлен: 🔶→🔄, ₿→🔐, ↩️Назад→✏️Своё название. **Дефолтный счёт:** `ac:skip` тихо создаёт «Кошелёк» (USD) если у пользователя 0 счетов. Commit `395e1f2`. Deploy `7089846c` — SUCCESS. |
| Master Roadmap Ph.1 — Keyboard Service | ✅ DEPLOYED | `account-onboard-keyboard.service.ts` (+478 строк): `CURRENCY_FLAGS` registry (40+ валют, флаги+символы: 🇷🇺RUB 🇺🇸USD ₿BTC ΞTH TON и др.), `getCurrencyFlag(code)`, `CURRENCY_NAMES` (рус. названия). `buildPaginatedPicker()` — всегда 2 стрелки ◀️▶️ (noop на краях). `buildCurrencyPickerText(name?,isCustom?)` — 3 ветки вывода. `buildFiatCurrencyPage()` + `buildCryptoCurrencyPage()` — флаговые кнопки + `🔍 Найти валюту` (ac:cur:search). `searchCurrencies(query,pool)` — fuzzy+транслитерация (rub/руб→RUB, dollar/доллар→USD). `buildNoMatchText(name,type)` + `buildNoMatchKeyboard(name,backTarget)` — экран «Похожего банка не нашли» с blockquote, 3 кнопки. `buildCurrencySearch*` тексты и клавиатуры. Удалены легаси: `FIAT_ITEMS`, `CRYPTO_ITEMS`, `CURRENCY_PICKER_TEXT`. Commit `35c92e0`. |
| Master Roadmap Ph.2 — Webhook FSM | ✅ DEPLOYED | `webhook.route.ts`: (1) `name_input` при fuzzy null → `buildNoMatchText`+`buildNoMatchKeyboard`, шаг `name_confirm_custom`. (2) `ac:cus:save` → `pendingName` как `isCustomName=true` → `cur_pick`. (3) `ac:cus:keep` → `name_input` retry. (4) `ac:cur:search` → `cur_search` шаг + поисковый промпт. (5) `ac:cur:list` → возврат к пагинированному списку. (6) `cur_search` text interceptor → `searchCurrencies` → результаты/no-results. (7) 3 success-screens: `{ inline_keyboard: [] }` (без кнопок). `chooseCurKeyboard()` — module-level helper. Все callback_data ≤64 байт. Commit `35c92e0`. |
| 2.9 Nav Buttons Never Delete Tx Records | ✅ DEPLOYED | `active-message.service.ts` (NEW `sendNavMessage()` — always sends new message), `webhook.route.ts` (4 NAV_BTN_* handlers: NAV_BTN_BALANCE/REPORT/SETTINGS/TRANSACTIONS → `sendNavMessage`). Commit `1477f55`. |
| 2.9+ Smart Nav Message (midas:nav: key) | ✅ DEPLOYED | `active-message.service.ts` (полная переработка `sendNavMessage()` — edit-first через `midas:nav:`, не трогает `midas:am:`; новые функции `getNavMessageId`, `setNavMessageId`, `clearNavMessageId`). `webhook.route.ts` (импорт 2 новых функций; AI-parse path — cleanup `midas:nav:` перед стандартным `midas:am:` cleanup; `st:cancel` — silently deletes вместо редактирования; `bl:close` — добавлен `clearNavMessageId`). Commits `4baac9c` → `004966f`. |
| 2.10 Transaction UI Persistence & Navigation Fixes | ✅ DEPLOYED | **Три независимых фикса:** (1) `notifications.worker.ts` + `confirmation.worker.ts` + `shared/index.ts` — `isSuccessCard?: boolean` флаг; при approve DEL `midas:am:` вместо SET (commit `df15a01`). (2) `transaction-keyboard.service.ts` — `parseTxCallback`: теперь читает `parts[4]` как `from` для `tx:d:ask` и `tx:d:yes` — контекст `:s` передаётся через весь delete flow; кнопка «Закрыть» в tx:view корректно возвращает на success card (commit `8894b92`). (3) `notifications.worker.ts` — запись sentinel `midas:success_card:{msgId}` (TTL 30 дней) при `isSuccessCard=true`; `webhook.route.ts` step-7 — проверяет `EXISTS midas:success_card:{amId}` перед `deleteMessage` — двойная блокировка удаления (commit `b869c03`). |
| 2.10+ Gate Fix — Frozen UI on Concurrent Input | ✅ DEPLOYED | **Проблема:** пользователь пишет TX1 (пикер счёта открыт), TX2 → step-7 удаляет пикер до того как gate установит `gate_sent` → gate присылает новую карточку. TX3 → step-7 снова удаляет gate-карточку (gate_sent НЕ проверялся) → ai-parse молчит (gate_sent установлен) → UI зависает. **Фикс 1:** `webhook.route.ts` step-7 строки 5446–5458 — `EXISTS midas:gate_sent:` перед deleteMessage; если активен — карточка и `midas:am:` не трогаются. **Фикс 2:** `webhook.route.ts` ia:pk: строка 1539 — `DEL midas:gate_sent:` после выбора счёта → нормальный flow восстанавливается. **Фикс 3:** `ai-parse.worker.ts` — gate реконструирует полный пикер счетов когда `accountId = null`. **Жизненный цикл gate_sent:** SET в ai-parse → DEL при ia:cancel (строка 1432, до фикса) / ia:pk: (строка 1539, НОВОЕ) / approve/reject в confirmation.worker (строка 268, до фикса) / TTL 1h. Commit `8d25ec1`. tsc 0 ошибок. Railway ✅ оба сервиса Online. |

---

## 3. ПРИНЯТЫЕ АРХИТЕКТУРНЫЕ РЕШЕНИЯ

- **Runtime:** Node.js 24 + TypeScript (ADR-001). Python — только изолированный микросервис позже.
- **Frontend (future):** React 19 + Vite 8. Vue отклонён (ADR-002).
- **Workspace:** MVP = 1 default workspace на пользователя. БД multi-workspace-ready с первого дня (ADR-003).
- **Auth:** WorkspaceMembership required. Telegram User ID = идентификатор.
- **Primary Keys:** ULID (ADR-004).
- **DB Isolation:** PostgreSQL RLS. Low-privilege DB role. `BYPASSRLS` запрещён.
- **Tenant Context:** `SET LOCAL app.workspace_id` только внутри `withTenantTransaction(workspaceId, fn)` (SEC-03).
- **Queue:** BullMQ (Redis-backed) (ADR-014).
- **Financial Precision:** Decimal / NUMERIC only. `Number`, `parseFloat`, `Number()`, float arithmetic запрещены (SEC-02).
- **AI Output:** Strict Zod allowlist. AI не может возвращать/контролировать системные поля (SEC-01).
- **Draft Lifecycle:** TransactionDraft → pending_user → approved/rejected/expired/needs_clarification.
- **Security:** SEC-01 — SEC-12 обязательны для Phase 1.
- **AI Pipeline (claude-client.ts + prompts.ts):**
  - Модель: `claude-haiku-4-5`, `temperature: 0` (детерминизм), `max_tokens: 256`
  - System prompt: OUTPUT RULES → MULTILINGUAL RECOGNITION (RU/EN/UA) → FUZZY MATCHING (опечатки, сленг, транслитерация) → BILINGUAL PAIRS (неочевидные переводы) → DISAMBIGUATION RULES (15 правил для двусмысленных товаров) → COMPOUND EXPRESSIONS → DEFAULT INTENT PRIORITY → 30-категорийная таксономия (18 personal + 12 business) × 500+ якорных товаров/услуг/брендов (СНГ/EU/US) → RUSSIAN LANGUAGE RULES (50+ глаголов расхода/дохода) → CATEGORY→INTENT defaults → 25+ примеров (все 5 intent-типов + partial + nonsense)
  - Markdown fence strip: Claude иногда оборачивает JSON в ` ```json `, парсер это убирает перед `JSON.parse`
  - Zod validation: strict allowlist — intent/amount/currency/category_hint/person_hint/account_hint/item_hint/note/confidence
  - **Category validation (Phase 1.37):** `ALLOWED_CATEGORIES` Set — если Claude вернул `category_hint` не из допустимого списка, заменяется на `Другое`
  - Post-processing (safety net, ПОСЛЕ Claude): 7 групп regex с word-boundary `\b`, negation guard, confidence boost (+0.15/+0.25), intent fallback
  - Результат: `ok` | `partial` (missing fields) | `needs_clarification` (nonsense) | `rejected`
  - **Phase 1.35:** `item_hint` (extracted product/merchant name), `category_hint` (AI category suggestion) → `CategoryResolverService` (3-stage: exact → 200+ alias map → fallback «Другое»)
  - **Phase 1.37:** Zero-clutter UX, мультиязычная таксономия, дисамбигуация, строгая валидация категорий
- **Deployment:** Railway (spirited-happiness) — Midas bot + background-workers + Postgres + Redis. Auto-deploy from GitHub main.
- **UX Architecture (Phase 1.33–1.36-UX) — ФИНАЛЬНОЕ РАБОЧЕЕ СОСТОЯНИЕ:**
  - Rich Screen Cards: `screen-builder.ts` pure functions → buildPreviewScreen, buildConfirmedScreen, buildClarificationScreen
  - Centralized confirmKb/confirmPreview helpers (DRY, 8 entry points)
  - Post-confirm card: `[✏️ Изменить запись]` only — nav buttons removed (handled by Reply Keyboard)
  - **Persistent Navigation:** `ReplyKeyboardMarkup` (`is_persistent: false`, `resize_keyboard: true`) — 2×2 grid: Row 1 `[💰 Баланс][📊 Отчёт]`, Row 2 `[📋 Транзакции][⚙️ Настройки]`. Sent on `/start`. NAV_BTN_* intercepted before AI parse. **(Phase 2.3: Отчёт и Транзакции поменяны местами — Отчёт теперь вверху справа)**
  - **Keyboard Carrier:** Greeting message `✅ Вы уже зарегистрированы...` остаётся в чате **навсегда** — является постоянным носителем ReplyKeyboardMarkup. Не удаляется ни при каких условиях.
  - **Transaction History (FINAL):** Каждая preview-карточка — это **новое** сообщение (`sendMessage`), `activeMessageId` НЕ передаётся из `ai-parse.worker`. История транзакций накапливается в чате. Старый механизм `midas:am:{userId}:{chatId}` (active-message pointer) **удалён** из notifications.worker.
  - **Preview→Confirmed Edit:** При approve `confirmation.worker` читает `midas:preview:{draftId}` (TTL 600s) — message_id preview-карточки, записанный `notifications.worker` при отправке. Approve → `editMessageText(previewMsgId, confirmedText, inlineKeyboard)`. Reject → `editMessageText(previewMsgId, ❌ Отменено)` (Phase 1.38 fix).
  - **Redis Keys (актуальные):**
    - `midas:preview:{draftId}` — message_id preview-карточки, TTL 600s. Записывает notifications.worker. Читает и удаляет confirmation.worker на approve и reject.
    - `midas:greet:{userId}:{chatId}` — сохраняется в /start handler, но НИКОГДА не используется для удаления (код оставлен как артефакт, безвреден).
    - `midas:clar:{userId}:{chatId}` — intercept для ввода суммы при clarification. Удаляется на confirm/reject (race condition fix).
    - `midas:clar:msg:{userId}:{chatId}` — message_id nonsense-сообщения. Удаляется при следующем успешном парсе.
    - `midas:ac:{userId}:{chatId}` — account onboarding state, TTL 300s.
    - `midas:edit:{userId}:{chatId}` — edit amount intercept, TTL 300s.
    - `midas:awaiting_cur:{chatId}` — TTL 600s. Создаётся когда есть сумма но нет валюты и нет `cur_set`. Хранит `{draftId}:{workspaceId}:{userId}`. Webhook читает для intercept ввода валюты.
    - `midas:cur_set:{workspaceId}` — флаг того, что пользователь установил базовую валюту в Настройках. Если есть — валюта не запрашивается.
    - `midas:gate_sent:{telegramUserId}:{chatId}` — флаг что gate уже сработал (TTL 1h). Предотвращает повторный edit при каждом новом сообщении.
    - `midas:dead_card:{chatId}` — message_id карточки "❌ Отменено" или "⏰ Черновик истёк", TTL 24h. Записывается confirmation.worker (reject/expired) и draft-expiration.worker (CRON expire). Читается и удаляется ai-parse.worker при отправке следующей preview — карточка автоматически удаляется из чата. (Phase 1.40)
     - `midas:am:{userId}:{chatId}` — Phase 2.10: pointer на текущее активное сообщение (черновики, пикеры счётов, clarification). TTL 24h. При approve транзакции — DEL (не SET, чтобы success card не удалялась). Step-7 в webhook.route.ts проверяет `midas:success_card:{amId}` перед удалением.
     - `midas:success_card:{msgId}` — Phase 2.10: sentinel key, TTL 30 дней. Записывается `notifications.worker` при `isSuccessCard=true` (после approve). Читается step-7 в `webhook.route.ts` — если EXISTS, сообщение НЕ удаляется при вводе следующей транзакции. Двойная блокировка вместе с DEL `midas:am:`.
    - `bl:state:{telegramUserId}:{chatId}` — Phase 2.1: state для текстовых intercepts баланс-менеджмента. Хранит `{action, accountId}`. Actions: `rename`, `set_balance`, `currency_input`. TTL 300s.
    - `bl:source:{telegramUserId}:{chatId}` — Phase 2.1: флаг что добавление счёта инициировано из баланса. При `ac:done` возвращает в balance dashboard вместо setup complete.
     - `midas:tx:sr:ctx:{telegramUserId}:{chatId}` — Phase 2.3: поисковый контекст для пагинации. Хранит JSON `{t: 'name'|'amount'|'category'|'date', q?: string, f?: string, to?: string, lb?: string}` TTL 600s. Создаётся при первом поиске, читается при навигации по страницам (tx:sr:p:{page}). При устаревании — дружелюбное сообщение «поиск заново».
    - `bl:source:{telegramUserId}:{chatId}` — Phase 2.3: при `ac:fin`/`ac:done` проверяется для возврата в balance dashboard вместо setup complete.
     - `midas:ac:{userId}:{chatId}` поле `pendingName` — Master Roadmap: временное имя из no-match flow до подтверждения через `ac:cus:save`.
     - `midas:ac:{userId}:{chatId}` поле `isCustomName` — Master Roadmap: true если имя счёта — свободный ввод (не preset). Влияет на текст currency picker.
     - `midas:ac:{userId}:{chatId}` шаг `cur_search` — Master Roadmap: режим поиска валюты активен. Следующий текст пользователя → `searchCurrencies()`. Снимается при `ac:cur:list` или выборе валюты.

  - **Auto-Activation:** `replyKeyboardJson` в `NotificationJobPayload`. rejection/expiry/intent_missing sends ReplyKeyboard на `sendMessage` path. `editMessageText` path — только inline keyboard (Telegram API limitation).
  - **Collapsibility:** `is_persistent: false` — Telegram показывает ⏄ иконку рядом с 🎤; пользователь может скрывать/восстанавливать клавиатуру.
  - **Race Condition Fix:** `redisConnection.del(clarKey)` на confirm/reject → stale `midas:clar:*` не перехватывает следующее сообщение.
  - **Keyboard Consistency:** Both screen-builders use ✖️. confirmKb: ✅ full-width row + [✏️|✖️] split row.

---

## 4. PROJECT_CONFIG STATUS

- `project_config.md` версия **v1.4**
- v1.4 включает: Phase 1.37 AI Taxonomy & Zero-Clutter UX update, 30-category taxonomy, 500+ anchors, multilingual, disambiguation, ALLOWED_CATEGORIES validation, Phase 2.0 documented
- SEC-01 — SEC-12 = обязательные ограничения реализации Phase 1
- **🔒 ЗАБЛОКИРОВАН** — изменение только по прямому приказу владельца

---

## 5. PHASE 1.1 — РЕЗУЛЬТАТ

**Статус:** ✅ COMPLETED

Создан Turborepo monorepo `midas-monorepo/`:

```
midas-monorepo/
├── apps/
│   ├── telegram-bot/          # @midas/telegram-bot
│   └── background-workers/    # @midas/background-workers
├── packages/
## 6. ТЕКУЩАЯ ФАЗА — PHASE 1.30: Smart Account Onboarding

> ✅ **COMPLETED / ACCEPTED (Phase 1.30). See Section 10 history.**

**Objective:**
Replace the flat "Счетов пока нет." empty-state with a guided interactive keyboard when /accounts is empty (Scenario Д) and show a guided account setup keyboard for new users after /start (Scenario Е). UX layer only — no migration, no new commands, no AI changes.

**Key decisions:**
- `account-onboard-keyboard.service.ts` (NEW): `ac:` callback namespace, all payloads ≤ 17 bytes (≤ 64 limit). `parseAccountCallback()` validates against strict allowlist (SEC-01). Keyboards: type picker, exchange presets (5 + custom), currency shortcuts (6 + custom), post-create.
- `account.service.ts` (MODIFY): `hasAccounts()` added — lightweight COUNT query, no signature change to existing functions. `addAccountWithCurrency()` added — accepts explicit currency, type always 'manual'.
- `webhook.route.ts` (MODIFY): `ac:` callback handler block (before `ed:`), `/accounts` empty-state detection via `hasAccounts()`, `/start` for new users sends `buildStartOnboardKeyboard()`, text intercept for `midas:ac:` state (before edit-amount intercept).
- Redis state `midas:ac:{telegramUserId}:{chatId}` TTL 300s — isolates name_input and cur_input steps from AI parse.
- Onboarding DB function (`system_find_or_create_user`) untouched — default account still created for new users.
- `[⏩ Пропустить]` button on /start guided keyboard — clears state, no account created.
- Cash auto-name: "Наличные {CURRENCY}" derived at creation time.
- Exchange presets: Binance, Bybit, OKX, Kraken, Huobi + ✏️ Другая.

**Scope — 3 files changed:**
- `apps/telegram-bot/src/services/account-onboard-keyboard.service.ts` (NEW — 240 lines)
- `apps/telegram-bot/src/services/account.service.ts` (MODIFY — hasAccounts + addAccountWithCurrency)
- `apps/telegram-bot/src/routes/webhook.route.ts` (MODIFY — ac: handler, /accounts empty-state, /start guided, text intercept)
- `packages/database/smoke-test-phase130.mjs` (NEW — 64 tests)

---

## 7. MCP SERVERS & INFRASTRUCTURE (Production)

### Подключённые MCP-серверы

| MCP-сервер | Статус | Назначение |
|---|---|---|
| **Railway MCP** | ✅ Active | Деплой, логи, переменные, сервисы. Project: `spirited-happiness`. |
| **GitHub MCP** | ✅ Active | Repo: `gloryjasystem/Midas`. Auto-deploy on push to `main`. |
| **Postgres MCP** | ✅ Active | Read-only SQL к production DB через Railway proxy. |
| **Filesystem MCP** | ✅ Active | Чтение/запись файлов в workspace `C:\Users\secvency\Desktop\Midas` |

### Railway Infrastructure

| Сервис | Роль | Домен |
|---|---|---|
| **Midas** | Telegram Bot (Fastify webhook) | `midas-production-f4f1.up.railway.app` |
| **background-workers** | BullMQ workers (ai-parse, confirm, notify, draft-expire, webhook) | Internal only |
| **Postgres** | PostgreSQL 17 (managed) | `postgres.railway.internal:5432` |
| **Redis** | BullMQ + state (Redis 7) | `redis.railway.internal:6379` |

### Ключевые переменные (Railway Dashboard)

| Переменная | Где | Примечание |
|---|---|---|
| `DATABASE_URL` | Midas + background-workers | `postgres.railway.internal` (internal) |
| `REDIS_URL` | Midas + background-workers | `redis.railway.internal` |
| `TELEGRAM_BOT_TOKEN` | Midas | ⚠️ Требует ротации (был виден в логах) |
| `ANTHROPIC_API_KEY` | background-workers | ⚠️ Требует ротации |
| `TELEGRAM_WEBHOOK_SECRET` | Midas | `midas_wh_secret_2026_prod` |

---

## 8. ФАЙЛЫ ДЛЯ ЧТЕНИЯ В НОВОМ ЧАТЕ (Phase 2.4 context)

**⚡ ТЕКУЩИЙ КОНТЕКСТ: Phase 2.4 — Account-Aware Draft Card — ПЛАН ГОТОВ, РЕАЛИЗАЦИЯ НЕ НАЧАТА.**

**ОБЯЗАТЕЛЬНО прочитать в новом чате:**
```
apps/telegram-bot/src/utils/screen-builder.ts              ← buildPreviewScreen, buildConfirmedScreen, buildConfirmKeyboard, buildPostConfirmKeyboard
apps/telegram-bot/src/routes/webhook.route.ts              ← confirmPreview(), approve/reject handlers, callback router
apps/telegram-bot/src/services/account.service.ts          ← getWorkspaceAccountsForInline, getAccountById, setDraftAccountId, getWorkspaceDefaultAccounts
apps/telegram-bot/src/services/clarification.service.ts    ← getDraftFields, DraftFields type, validateAmountString
apps/telegram-bot/src/services/account-inline-keyboard.service.ts ← buildAccountPickerForDraft (новая), callback namespace ia:
apps/background-workers/src/workers/confirmation.worker.ts ← approveDraft, confirmed card building
apps/background-workers/src/utils/screen-builder.ts        ← buildConfirmedScreen (bg-workers version)
```

**Тесты (запустить в начале для верификации baseline):**
```
node apps/telegram-bot/smoke-test-master-roadmap.mjs   → 76/76 ✅
node packages/database/smoke-test-lazy-default.mjs     → 39/39 ✅
npx tsc --noEmit -p apps/telegram-bot/tsconfig.json   → 0 ошибок
npx tsc --noEmit -p apps/background-workers/tsconfig.json → 0 ошибок
```

**Полный план реализации:**
```
C:\Users\secvency\.gemini\antigravity\brain\7517ec39-fd86-4359-816b-639eeaa6df79\account_debit_ux_plan.md
```

**НЕ ЧИТАТЬ (не нужны для Phase 2.4):**
```
packages/ai-core/src/claude-client.ts
packages/ai-core/src/prompts.ts
packages/database/src/db.ts
apps/telegram-bot/src/services/report.service.ts
apps/telegram-bot/src/services/transaction-list.service.ts
```

---

## 9. ПРОМПТ ДЛЯ СТАРТА НОВОГО ЧАТА

```
⚡ Фазы 1.1–1.40 + 2.0–2.3 + Master Roadmap + Phase LD + Phase LD++ — ЗАВЕРШЕНЫ И ЗАДЕПЛОЕНЫ.
Фаза 2.4 — Account-Aware Draft Card — ПЛАН ГОТОВ, начинаем реализацию.

КОНТЕКСТ ПРОЕКТА:
Midas DEPLOYED на Railway (project: spirited-happiness, env: production). Стабилен.
MCP servers: Railway, GitHub, Postgres, Filesystem — все активны.
Auto-deploy: push to `main` → GitHub → Railway строит Midas + background-workers.

ЧТО НУЖНО РЕАЛИЗОВАТЬ (Phase 2.4):
Добавить отображение счёта списания в карточку черновика транзакции с математикой баланса:
  - Черновик показывает: «🏦 Bybit USD» + «💳 15 400 − 10 000 = 5 400 USD»
  - Кнопка «🔄 Сменить счёт» → пикер всех счетов пользователя с балансами
  - Кросс-валюта: кнопка «✏️ Указать сумму в RUB» → перехват текста → пересчёт
  - Confirmed card: «Итог: 15 400 − 10 000 = 5 400 USD» (без кнопок Баланс/Отчёт)

ПОЛНЫЙ ПЛАН: C:\Users\secvency\.gemini\antigravity\brain\7517ec39-fd86-4359-816b-639eeaa6df79\account_debit_ux_plan.md

ПЛАН РАЗБИТ НА 16 АТОМАРНЫХ PR:
PR 1  — Миграция БД: account_debit_amount, account_debit_currency в transaction_drafts + transactions
PR 2  — account.service.ts: getAccountWithBalance(), getWorkspaceAccountsWithBalances()
PR 3  — clarification.service.ts: расширить DraftFields (account_id, account_debit_amount, account_debit_currency)
PR 4  — clarification.service.ts: patchDraftDebitAmount() — новая функция
PR 5  — utils/decimal.ts (НОВЫЙ): calcBalanceAfter(), calcRate() — BigInt arithmetic
PR 6  — screen-builder.ts (оба apps): buildPreviewScreen — новые поля accountName/Balance/DebitAmount
PR 7  — screen-builder.ts: buildConfirmKeyboard — новая сигнатура (BREAKING: обновить все вызовы атомарно)
PR 8  — screen-builder.ts: buildPostConfirmKeyboard — убрать кнопки Баланс/Отчёт
PR 9  — webhook.route.ts: confirmPreview() — подтягивает счёт по priority chain
PR 10 — webhook.route.ts: 3 callback-маршрута (draft:acct:*, draft:acct:pick:*, draft:acct:back:*)
PR 11 — account-inline-keyboard.service.ts: buildAccountPickerForDraft()
PR 12 — webhook.route.ts: кросс-валюта (draft:acct:xfx:*, Redis midas:xfx:ptr:*, text intercept)
PR 13 — screen-builder.ts (оба apps): buildConfirmedScreen — новый блок «Итог"
PR 14 — confirmation.worker.ts: snapshot balance_before, balance_after
PR 15 — ai-parse.worker.ts: встроить дефолтный счёт в initial draft card
PR 16 — smoke-test-phase-acct-draft.mjs: 6 сценариев тестирования

CТАРТ: PR 1 (миграция БД) — самый безопасный первый шаг.

КЛЮЧЕВЫЕ ПРАВИЛА:
- Callback namespace: draft:acct:* — конфликтов с существующими ia:/bl:/ac:/* НЕТ
- Redis prefix: midas:xfx:ptr:{userId}:{chatId} — новый, не пересекается с существующими
- PR 7 (buildConfirmKeyboard) — единственный breaking change: все вызовы обновить в одном коммите
- buildPostConfirmKeyboard: убрать строку с [💰 Баланс][📊 Отчёт] — они в ReplyKeyboard
- Финансовая математика: ТОЛЬКО BigInt/NUMERIC, никаких float (SEC-02)
- Все мутации через withTenantTransaction (SEC-03)
- Проверка account_id принадлежит workspace перед setDraftAccountId (SEC-01)
- Не трогать project_config.md

ТЕСТЫ BASELINE (запустить в начале):
`node apps/telegram-bot/smoke-test-master-roadmap.mjs`  → 76/76 ✅
`node packages/database/smoke-test-lazy-default.mjs`    → 39/39 ✅
`npx tsc --noEmit -p apps/telegram-bot/tsconfig.json`  → 0 ошибок
```


## 10. ИСТОРИЯ ДЕЙСТВИЙ (СЖАТАЯ)

| Дата | Событие |
|---|---|
| 2026-05-04 14:07 | Инициализация проекта: project_config.md v1.0 + workflow_state.md |
| 2026-05-04 14:45 | Phase 0.1 Event Storming completed (46 событий, 10 агрегатов, 15 ADR planned) |
| 2026-05-04 15:08 | Phase 0.2 ADR completed (15 ADR: ADR-000—ADR-014). project_config.md → v1.1 |
| 2026-05-04 15:45 | Phase 0.3 Readiness Gate completed (scope, DB model, queue model, acceptance criteria) |
| 2026-05-04 17:02 | Security review: 2 CRITICAL, 2 HIGH → Phase 0.3.1 запущена |
| 2026-05-04 17:15 | Phase 0.3.1 Security Patch completed (SEC-01—SEC-12). project_config.md → v1.2 |
| 2026-05-04 18:30 | Client roadmap document created: `docs/client-roadmap-architecture-overview.md` |
| 2026-05-04 21:12 | Phase 1.1 approved and started |
| 2026-05-04 21:17 | Phase 1.1 completed: monorepo, Docker, ESLint, TypeScript — 8/8 typecheck passed |
| 2026-05-04 22:34 | Context checkpoint: workflow_state.md compressed for new chat handoff |
| 2026-05-05 09:53 | Git init fixed: repo moved from `C:/Users/secvency` → `Midas/`. Initial commit `cc91a47f` |
| 2026-05-05 10:22 | Docker readiness: port 5432 conflict resolved, `docker-compose.yml` volume path fixed for postgres:18 |
| 2026-05-05 12:05 | Section 11 (Agent Operating Protocol, 13 sub-protocols) added to workflow_state.md |
| 2026-05-05 12:11 | Self-audit applied: C1, C2, M1, M2, L2 fixes + Section 14 added |
| 2026-05-05 12:55 | Phase 1.2 Database Foundation completed & accepted via Review Gate. Minor observation: onboarding workspace spam requires app-layer rate limiting. |
| 2026-05-05 14:30 | Phase 1.3 BullMQ Task Queue Foundation completed & accepted. 13/13 typecheck+lint passed (0 errors). |
| 2026-05-05 19:30 | Phase 1.4 Verification Gate FULL PASS (7/7 smoke tests). Bugs fixed: BullMQ jobId `:` → `\|` separator, `/health` excluded from SEC-04 guard. Commit `6e0cfa1` pushed. |
| 2026-05-05 19:35 | Phase 1.4 ACCEPTED by owner. **Prod note:** Redis must use `noeviction` policy in production; `allkeys-lru` is acceptable only for local dev. |
| 2026-05-05 19:40 | workflow_state.md cleanup: stale Phase 1.2/1.4 references corrected in Sections 6–9. Sections now describe Phase 1.5 scope, MCP needs, required files, and handoff prompt. No code written. |
| 2026-05-05 19:45 | Phase 1.5 scope narrowed by owner: User Onboarding & Workspace Resolution only. Removed from scope: callback_query, /add /balance /report /category, CRON, AI, full notifications. Sections 6, 8, 9 updated. |
| 2026-05-05 20:00 | Phase 1.5 implementation complete. `findOrCreateUser` (atomic, ON CONFLICT race-safe), `resolveWorkspace` real DB, `/start` handler, Redis anti-spam, `sendMessage` wrapper. 13/13 typecheck+lint pass. Commit `8f88f22`. |
| 2026-05-05 20:30 | Phase 1.5 Verification Gate PASS (39/39 smoke tests). Fix applied: RLS chicken-and-egg — `midas_app` cannot INSERT into `workspaces` without a pre-existing `workspace_memberships` row. Added migration `1777973900000`: `system_find_or_create_user` SECURITY DEFINER (executes as `midas_migrator`, exempt from RLS; `pg_advisory_xact_lock` for race safety). **Documentation note:** SECURITY DEFINER onboarding pattern was introduced in Phase 1.2 migration (`1777973795878_rls-and-policies.js`) as `system_create_onboarding_workspace` but is not covered by any existing ADR. ADR-009 covers Exchange Rate Snapshot only. A future ADR documenting the SECURITY DEFINER onboarding bootstrap pattern is recommended. Commits `b60f7ac`, `9307800` pushed. |
| 2026-05-05 20:35 | Phase 1.5 ACCEPTED by owner. Status set to WAITING_FOR_OWNER_APPROVAL_TO_START_PHASE_1_6. |
| 2026-05-05 21:00 | Phase 1.6-A AI Parse Pipeline implementation complete. `parseTransaction()` (Claude Haiku + Zod strict allowlist SEC-01), `createDraft()` (withTenantTransaction SEC-03), date-scoped AI budget guard SEC-09, SEC-12 `job.updateData('[REDACTED]')` + `removeOnFail: { age: 86400 }`. Commit `305e0f6`. |
| 2026-05-05 21:30 | Phase 1.6-A Final Acceptance Check. Fix: NUMERIC(19,4) boundary — regex `\d*` → `\d{0,14}` caps integer part at 15 digits. 73/73 smoke tests pass. 13/13 typecheck+lint pass. Commit `7b393d2` pushed. Phase 1.6-A ACCEPTED. |
| 2026-05-05 22:55 | Phase 1.6-B HitL Draft Confirmation implementation complete. `draft-confirmation.service.ts` (SELECT FOR UPDATE SKIP LOCKED), `confirmation.worker.ts`, `callback-confirm-queue.ts`, `webhook.route.ts` callback_query handler (ULID validation, SEC-03/06), real Telegram `sendMessage` with inline keyboard. 30/30 smoke tests PASS (incl. mandatory race condition test: parallel approve × 2 → exactly 1 Transaction). Phase 1.6-A regression: 73/73 PASS. 13/13 typecheck+lint clean. Commit `d49625b` pushed. **Status: READY_FOR_OWNER_ACCEPTANCE.** Note: CRON draft expiration (SEC-08) intentionally deferred to Phase 1.7. No SEC-08 claim in Phase 1.6-B. |
| 2026-05-05 19:07 | Phase 1.6-B Final Acceptance Audit run (agent self-audit). All checks PASS: SEC-03 tenant isolation ✔, atomic approval ✔, race condition ✔, rejection no-op ✔, UNIQUE constraint ✔, no SEC-08 false claim ✔. workflow_state.md ACCEPTED wording corrected to READY_FOR_OWNER_ACCEPTANCE. Awaiting owner decision. |
| 2026-05-05 21:14 | Phase 1.6-B ACCEPTED by owner after Final Acceptance Audit PASS WITH FIXES. Code unchanged. 30/30 Phase 1.6-B smoke tests PASS, 73/73 Phase 1.6-A regression PASS, 13/13 typecheck/lint PASS. Commit `f205e09` pushed. CRON expiration (SEC-08) intentionally deferred to Phase 1.7. |
| 2026-05-05 21:32 | Phase 1.7 ACCEPTED by owner. `system_expire_pending_drafts()` owner fixed to `midas_migrator`; `search_path = public, pg_catalog` fixed; EXECUTE revoked from PUBLIC; 20/20 smoke tests PASS; 13/13 typecheck+lint PASS; git pushed and clean. Commit `49e0cec`. |
| 2026-05-05 22:30 | Phase 1.8-A Transaction Intent Foundation implementation complete. Migration `1778008338096_transaction-intent.js`: `parsed_intent` (nullable TEXT + CHECK) added to `transaction_drafts`; `transaction_intent` (NOT NULL TEXT + CHECK, backfilled 'expense', no DEFAULT) added to `transactions`. `draft.service.ts`: `AiOutput.intent` propagated to `parsed_intent`. `draft-confirmation.service.ts`: `parsed_intent` fetched in SELECT FOR UPDATE, new `intent_missing` outcome if NULL, `transaction_intent` written to transactions INSERT (explicit, no default). `confirmation.worker.ts`: `intent_missing` case handled with user message. 19/19 Phase 1.8-A tests PASS. 20/20 Phase 1.7 regression PASS. 30/30 Phase 1.6-B regression PASS. 73/73 Phase 1.6-A regression PASS. 13/13 typecheck+lint PASS. Traceability ✅ Security ✅ Scope Guard ✅. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-05 23:39 | Phase 1.8-A ACCEPTED by owner after independent verification. Local and origin/main both at `51b6aee`. Implementation commit `425df61`. Migration `1778008338096_transaction-intent.js` tracked in git. Live DB verified: `parsed_intent` nullable, `transaction_intent` NOT NULL, no DEFAULT, CHECK constraints confirmed for exactly 5 values. 155/155 tests PASS (19 Phase 1.8-A + 20 Phase 1.7 + 30 Phase 1.6-B + 73 Phase 1.6-A + 13 typecheck+lint). No cleanup needed. |
| 2026-05-05 23:50 | Phase 1.8-B Runtime Consistency & Security Hardening implementation complete. C-1 fix: `draft.service.ts` L41 `telegram_user_id`→`telegram_id` (critical runtime bug — would crash every AI parse job). C-2 fix: migration `1778008400000_harden-onboarding-search-path.js` — `SET search_path = 'public', 'pg_catalog'` added to `system_create_onboarding_workspace` and `system_find_or_create_user`. M-1 fix: `shared/index.ts` `TRANSACTION_TYPE` updated from 3 stale values to 5 canonical intent values. 16/16 Phase 1.8-B tests PASS. 19/19 Phase 1.8-A PASS. 20/20 Phase 1.7 PASS. 30/30 Phase 1.6-B PASS. 73/73 Phase 1.6-A PASS. 13/13 typecheck+lint PASS. Total: 171/171. Traceability ✅ Security ✅ Scope Guard ✅. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 00:02 | Phase 1.8-B ACCEPTED by owner after PASS. C-1: resolveUserId fixed `telegram_user_id`→`telegram_id`. C-2: onboarding SECURITY DEFINER functions hardened with `search_path = public, pg_catalog`. M-1: `TRANSACTION_TYPE` updated to canonical 5 intent values. 171/171 tests PASS. origin/main at `7af1692`. Working tree clean. |
| 2026-05-06 00:07 | workflow_state.md cleanup after Phase 1.8-B acceptance. Stale Sections 6–9 corrected: Section 6 updated to Phase 1.8-B results; Section 7 set to advisory-only MCP access; Section 8 refreshed with advisory file list; Section 9 updated with COMPLETED/ACCEPTED handoff. No code changes. |
| 2026-05-06 00:27 | Phase 1.9 Basic Text /report Command implementation complete. `report.service.ts`: monthly report grouped by `transaction_intent`, `SUM(base_amount)` via NUMERIC, UTC month boundaries, Russian text output. `webhook.route.ts`: `/report` command intercepted before AI parse, resolves workspace+userId, calls report service. `workspace-resolver.ts`: `userId` added to `WorkspaceResolverResult`. Defense-in-depth: explicit `WHERE workspace_id = $1` alongside RLS. 47/47 Phase 1.9 tests PASS. 16/16 Phase 1.8-B PASS. 19/19 Phase 1.8-A PASS. 20/20 Phase 1.7 PASS. 30/30 Phase 1.6-B PASS. 73/73 Phase 1.6-A PASS. 13/13 typecheck+lint PASS. Total: 218/218. Traceability ✅ Security ✅ Scope Guard ✅. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 09:08 | workflow_state.md sync after Phase 1.9 implementation. Sections 1, 2, 6–9 corrected: Section 1 set to WAITING_FOR_OWNER_ACCEPTANCE_OF_PHASE_1_9; Section 2 Phase 1.9 row expanded with full artifact paths; Section 6 updated to Phase 1.9 results; Section 7 set to acceptance-audit-only MCP access; Section 8 refreshed with Phase 1.9 audit file list; Section 9 updated with acceptance handoff. No code changes. |
| 2026-05-06 10:00 | Phase 1.9 ACCEPTED by owner after final verification. Full test run: 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 218/218 PASS. Git clean pre/post tests. origin/main in sync. project_config.md unchanged (v1.2). Section 14 self-audit: all ✅. Committed workflow_state.md, pushed tag phase-1.9-accepted. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 11:45 | Phase 1.10 Slash-Command Guard + Inline /help implementation complete. `parseCommandToken()` (exact first-token, @BotName strip), `KNOWN_COMMANDS` set, `/help` handler (Russian, lists /start /report /help), unknown-slash guard (5e). No command-registry, no new deps, no migrations, no AI changes. 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 248/248 PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 11:55 | Phase 1.10 ACCEPTED by owner after final acceptance verification. Full test run: 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 248/248 PASS. Git clean pre/post tests. origin/main in sync. project_config.md unchanged (v1.2, last touched cc91a47). Commit b321463: 3 files only (webhook.route.ts, smoke-test-phase110.mjs, workflow_state.md). No command-registry.ts, no /balance, no migrations, no new deps. Section 14 self-audit: all ✅. Tag phase-1.10-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 12:18 | Phase 1.11 /category Read-Only List Command implementation complete. `category.service.ts`: `getCategoryList()` read-only, `withTenantTransaction`, explicit `WHERE workspace_id = $1`, grouped by `category_group` (`Бизнес` before `Жизнь`), Russian pluralization, empty-state message. `webhook.route.ts`: `/category` added to KNOWN_COMMANDS (4 commands), HELP_TEXT updated, handler block added after `/report`. DB audit: RLS `tenant_isolation_categories` (`cmd: ALL`) ✅; `account_sources` not seeded on onboarding (debt item, no fix in Phase 1.11). 78/78 Phase 1.11 + 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 326/326 PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 13:50 | Phase 1.11 ACCEPTED by owner after final verification. /category read-only command implemented; no write path, no migrations, no new deps, no AI changes. Final independent verification: 78/78 Phase 1.11 + 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 326/326 PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Implementation commit 2e77362. Tag phase-1.11-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 17:20 | Phase 1.12 Onboarding Default Data Seeding implementation complete. Currency finding: `workspaces.default_currency DEFAULT 'RUB'` confirmed — no hardcoding beyond existing onboarding pattern. Migrations: `1778100000000_onboarding-default-seed.js` (7-param SECDEF function) + `1778100010000_fix-onboarding-seed-conflict.js` (PL/pgSQL ON CONFLICT ambiguity fix using named constraint). `onboarding.service.ts` extended to pass candidateAccountId + candidateCategoryId ($6/$7). Lazy fallback in `draft-confirmation.service.ts` preserved untouched (defense-in-depth). No route changes, no new slash commands, no queue/worker changes, no AI changes, no new deps. DB audit: 157 workspaces, 71 missing account_sources, 55 missing categories — no backfill (lazy fallback covers them). 37/37 Phase 1.12 + 78/78 Phase 1.11 + 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 363/363 PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 17:45 | workflow_state.md test-count fix: 344/344 → 363/363 (Phase 1.8-A 19 tests omitted from arithmetic sum). Commit 1b9a32a. No code changes. |
| 2026-05-06 18:40 | Phase 1.13 /add_category Strict-Format Command implementation complete. `category.service.ts`: `parseAddCategoryArgs()` (group case-insensitive normalization via ALLOWED_GROUPS, name trim+length validation), `resolveGroup()`, `addCategory()` (withTenantTransaction, INSERT ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING, ULID id, returns 'created'\|'duplicate'), `AddCategoryResult` type. `webhook.route.ts`: KNOWN_COMMANDS 4→5, HELP_TEXT updated with /add_category line + groups + example, handler `5e-add` (parseAddCategoryArgs → resolveWorkspace → addCategory → Russian reply; duplicate: «Категория с таким именем уже существует.»). No migrations, no new deps, no AI changes. Empty-state /category message updated. midas_app RLS WITH CHECK verified via separate appPool in Test 8. 74/74 Phase 1.13 + 37/37 Phase 1.12 + 78/78 Phase 1.11 + 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 437/437 PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Implementation commit `eac55a9`. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 19:22 | Phase 1.14 /accounts Read-Only List Command implementation started. Owner APPROVED. |
| 2026-05-06 19:35 | Phase 1.14 implementation complete. `account.service.ts` (NEW): `getAccountList()` (withTenantTransaction, explicit WHERE workspace_id = $1, flat list ORDER BY type name, Russian labels, pluralization, empty-state). `webhook.route.ts`: KNOWN_COMMANDS 5→6, HELP_TEXT updated, handler `5d-acc`. `smoke-test-phase114.mjs`: 70 tests PASS. No migrations, no new deps, no AI/queue changes. 70/70 Phase 1.14 + 437/437 regression + 13/13 typecheck+lint = 507/507 PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Implementation commit `362b05b`. |
| 2026-05-06 19:46 | Phase 1.14 ACCEPTED by owner after final verification. /accounts read-only command implemented; 507/507 tests PASS; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit `362b05b`. HTML escaping for account/category names must be considered before implementing user-controlled write paths such as /add_account. Tag `phase-1.14-accepted` pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 21:32 | Phase 1.15 HTML Escaping Hardening implementation complete. Owner APPROVED. `html-escape.ts` (NEW): `escapeHtml()` — 5 chars escaped (`&`, `<`, `>`, `"`, `'`). `account.service.ts`: `escapeHtml` on `row.name`, `resolveTypeLabel(row.type)`, `row.currency`. `category.service.ts`: `escapeHtml` on category names, group labels, and `groupToken` in unknown-group error message (Traceability fix). `webhook.route.ts`: `escapeHtml` on `parsed.canonicalGroup` and `parsed.name` in `/add_category` success message. `smoke-test-phase115.mjs`: 52/52 PASS. No migrations, no new deps, no AI/queue changes. 52/52 Phase 1.15 + 494/494 regression smoke tests + 13/13 typecheck+lint = 559/559 PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 21:56 | workflow_state.md test-count fix: 557/557 → 559/559 (final audit confirmed actual total; prior count incorrectly treated 507 as pure smoke-test baseline, double-counting 13 typecheck+lint tasks). Correct breakdown: 52 (Ph1.15) + 494 (Ph1.6-A through Ph1.14 smoke) + 13 (typecheck+lint) = 559. No code changes. |
| 2026-05-06 22:04 | Phase 1.15 accepted after final verification and workflow_state test-count fix; HTML escaping hardening implemented; 559/559 tests passed; Traceability Review PASS WITH FIXES; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 4f63a91; workflow_state sync commit 88ebae3; test-count fix commit 45b1eec. Tag phase-1.15-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 22:50 | Phase 1.16 account_sources UNIQUE Constraint Migration implementation complete. Owner APPROVED. Migration `1778200000000_account-sources-unique-name.js`: `up()` pre-flight duplicate check (0 found → safe) + `ALTER TABLE account_sources ADD CONSTRAINT account_sources_workspace_id_name_key UNIQUE(workspace_id, name)`. `down()` uses DROP CONSTRAINT IF EXISTS. `smoke-test-phase116.mjs`: 24/24 PASS. No TypeScript/route/service/worker/AI changes. 24/24 Phase 1.16 + 559/559 regression + 13/13 typecheck+lint = 583/583 PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 22:46 | Phase 1.16 accepted after final verification; account_sources UNIQUE(workspace_id, name) constraint implemented; 583/583 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 3ad45e3. Tag phase-1.16-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 23:05 | Phase 1.17 /add_account Strict-Format Command implementation complete. Owner APPROVED. `account.service.ts` (MODIFY): `parseAddAccountArgs()` (first-space split, trim, empty check, max 100 char guard), `addAccount()` (withTenantTransaction, INSERT INTO account_sources VALUES ... 'manual'::account_source_type, 'RUB' ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING RETURNING id, returns created/duplicate), `AddAccountResult` type, `monotonicFactory` ULID. `webhook.route.ts` (MODIFY): KNOWN_COMMANDS 6→7, HELP_TEXT updated (`/add_account <название> — Добавить счёт`), handler `5e-add-acc` (parseAddAccountArgs → resolveWorkspace → addAccount → duplicate Russian message / success `escapeHtml` reply). `smoke-test-phase117.mjs` (NEW): 27/27 PASS. No migrations, no new deps, no AI/queue changes. 27/27 Phase 1.17 + 583/583 regression + 8/8 typecheck + 8/8 lint = 610/610 PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 23:24 | Phase 1.17 accepted after final verification; /add_account strict-format command implemented; 610/610 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 8c370e3. Tag phase-1.17-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 00:08 | Phase 1.18 accepted after final verification; /report now shows base_currency labels and groups by transaction_intent + base_currency; smoke-test-phase19 runReportQuery() helper synced to production SQL; smoke-test-phase118.mjs (34 tests) added; 644/644 tests passed (34 Ph1.18 + 47 Ph1.9 + 563 Ph1.6-A–Ph1.17 + 13 typecheck+lint); Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 700a244. Tag phase-1.18-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 02:00 | Phase 1.19 account_sources.currency CHECK Constraint implementation complete. Owner APPROVED. Migration `1778300000000_account-sources-currency-check.js` (NEW): pre-flight check (0 invalid rows found in 553 existing rows) + `ALTER TABLE account_sources ADD CONSTRAINT account_sources_currency_check CHECK (currency ~ '^[A-Z]{3,5}$')`. `smoke-test-phase119.mjs` (NEW): 24/24 PASS — constraint existence, type, definition, valid codes (RUB/USD/EUR/GBP/BTC/ETH/USDT), invalid rejection (empty/lowercase/digits/spaces/6-char/2-char), no backfill, scope guard. No TypeScript/route/dep/AI/queue changes. 24/24 Phase 1.19 + 644/644 regression + 13/13 typecheck+lint = 668/668 PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 02:25 | Phase 1.19 accepted after final verification; account_sources.currency CHECK constraint added with regex ^[A-Z]{3,5}$; 668/668 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 9d288bd. Tag phase-1.19-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 09:40 | Phase 1.20 Balance Semantics Design Document complete. Owner APPROVED. docs/balance-semantics.md created: 6 design decisions D1–D6 with recommended options (D1=A standard signed formula, D2=A integrated debt, D3=B transfer neutral, D4a=Yes add initial_balance, D4b=Yes allow negative, D4c=Yes account currency implicit, D4d=No defer initial_balance_at, D5=B per-account breakdown, D6=A all-time). Traceability ✅ Adversarial Security ✅ Scope Guard ✅. No TypeScript, no migrations, no new commands. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 09:45 | Phase 1.20 ACCEPTED by owner. D1–D6 all confirmed as recommended. Owner Choice column filled in docs/balance-semantics.md. Approved formula and schema changes documented. No code, no migrations, no DB changes made in this phase. Tag phase-1.20-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 10:00 | Phase 1.21 Unified Balance Implementation complete. Owner APPROVED. Files: migrations/1778400000000_account-sources-initial-balance.js (NEW, migration applied, initial_balance NUMERIC(19,4) NOT NULL DEFAULT 0), balance.service.ts (NEW, two-query NUMERIC arithmetic in SQL, withTenantTransaction, escapeHtml), webhook.route.ts (MODIFY, /balance handler added, KNOWN_COMMANDS 7→8, HELP_TEXT updated). smoke-test-phase121.mjs (NEW, 28/28 PASS). 28/28 Phase 1.21 + 655/655 regression smoke (Ph1.6-A–Ph1.19) + 13/13 typecheck+lint = 696/696 PASS (corrected from 709/709; Phase 1.5 server-dependent tests excluded from baseline, same as all prior phases). Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 10:15 | Phase 1.21 accepted after final verification; initial_balance migration and /balance command implemented; actual applicable tests 696/696 passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 976418a; note: stale /balance comment in webhook.route.ts line 31 is cosmetic tech debt, not fixed in this acceptance step. Tag phase-1.21-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 10:30 | Phase 1.22 Stale Comment Cleanup implementation complete. Owner APPROVED. `webhook.route.ts` (MODIFY, comment-only): slash-command routing header updated — Phase 1.21 added to phase refs, all 8 known commands listed, stale “(e.g. /balance)” example removed. 0 logic changes. 13/13 typecheck+lint PASS. 696/696 regression baseline unchanged. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 10:35 | Phase 1.22 accepted after final verification; stale /balance comment in webhook.route.ts fixed; comment-only change; 13/13 typecheck+lint PASS; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit d2ea3fd. Tag phase-1.22-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 14:00 | Phase 1.23 /set_balance implementation complete. Owner APPROVED. `setBalance.service.ts` (NEW): `parseSetBalanceArgs()` (last-token-as-amount, AMOUNT_REGEX 15-digit cap, SEC-02), `setAccountBalance()` (LOWER() exact match, formula `new_initial_balance = target − SUM(txns)` in PostgreSQL NUMERIC, withTenantTransaction SEC-03, defensive undefined guard replacing `!` non-null assertion), `formatSetBalanceResult()` (escapeHtml for all user strings). `webhook.route.ts` (MODIFY): import 3 functions from setBalance.service.js, KNOWN_COMMANDS 8→9, HELP_TEXT updated with /set_balance line, handler `5c-setbal` added (parseSetBalanceArgs → resolveWorkspace → setAccountBalance → formatSetBalanceResult). `smoke-test-phase123.mjs` (NEW): 34/34 PASS — Groups A (10 parse tests), B (12 DB formula tests including negative/idempotent/resync/precision), C (8 security/scope tests), D (4 regression). 13/13 typecheck+lint PASS. No migrations, no new tables, no transactions created, no /report changes. Commit 65a8e56 pushed. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 14:51 | Phase 1.23 accepted after final verification; /set_balance implemented; synchronizes account balance by recalculating account_sources.initial_balance; no transactions created; no categories used; /report unaffected; 730/730 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 65a8e56; workflow_state sync commit 6b1df77. Tag phase-1.23-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 15:15 | Phase 1.24 Default Currency RUB → USDT implementation complete. Owner APPROVED. Migration 1778500000000_default-currency-usdt.js (NEW): ALTER TABLE workspaces SET DEFAULT 'USDT' + CREATE OR REPLACE FUNCTION system_find_or_create_user (7-param) with 'USDT' for workspace and account_sources INSERTs. ccount.service.ts (MODIFY): addAccount() reads workspace.default_currency dynamically via SELECT inside withTenantTransaction (SEC-03) — fallback 'USDT'. smoke-test-phase112.mjs (MODIFY): 1 assertion USDT. smoke-test-phase117.mjs (MODIFY): doc comment + assertion updated. smoke-test-phase124.mjs (NEW): 20/20 PASS. No backfill. 1184 RUB workspaces untouched. 13/13 typecheck+lint PASS. 20/20 Phase 1.24 + 717/717 regression smoke (Ph1.6-A–Ph1.23) + 13/13 typecheck+lint = 750/750 PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 15:54 | Phase 1.24 accepted after final verification; default currency changed from RUB to USDT for new users; system_find_or_create_user creates USDT workspace and Default account; /add_account now uses workspace.default_currency dynamically; existing users/workspaces/transactions were not backfilled or recalculated; 750/750 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 97a4331. Tag phase-1.24-accepted pushed. |
| 2026-05-07 17:26 | Phase 1.25 accepted after final verification; /settings text mode implemented; timezone column added; default_currency and timezone settings supported; draft fallback now uses workspace.default_currency instead of hardcoded USD; existing transactions/accounts were not recalculated or backfilled; 782/782 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit f6307a1; test fix commit 2eaccc7; workflow sync commit f79dc7b. Tag phase-1.25-accepted pushed. |
| 2026-05-07 18:03 | Phase 1.26 accepted after final verification; /settings UI with inline keyboards implemented; stablecoins/crypto/fiat pagination added; Redis-backed search state with strict TTL implemented securely; timezone UI deferred; 100 currency constants isolated; 827/827 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit fb338db; docs fix commit d8d896b. Tag phase-1.26-accepted pushed. |
| 2026-05-07 18:33 | Phase 1.27 accepted after final verification; /balance currency-mixing defect fixed via SQL-level exclusion where transactions.base_currency != account_sources.currency; mismatch warning footnote added; roadmap output format improved; no conversion, no backfill, no migration, no /report changes; 854/854 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 12e70d9; docs fix commit dec0a52. Tag phase-1.27-accepted pushed. |
| 2026-05-07 19:25 | Phase 1.28 accepted after final verification; /edit command implemented with recent paginated list (10/page), transaction card, amount/category/account/intent edit flows, Redis TTL 300s state for amount input (key midas:edit:{userId}:{chatId}), permanent [✏️ Изменить] button after approval, strict callback_data limit verified at max 62 bytes (ed:c:cat:<26>:<26>), no search/date/delete/soft-delete/GIN index, no migrations, no /balance or /report changes, no new dependencies; amount edits blocked for cross-currency (exchange_rate ≠ 1.0); all DB mutations via withTenantTransaction + explicit workspace_id filter; 43/43 Phase 1.28 smoke + 841/841 regression smoke + 13/13 typecheck/lint = 897/897 total gates PASS; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit c8bbc7d; workflow commit 1807d93. Tag phase-1.28-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 22:06 | Phase 1.29 implemented: soft delete for transactions. Migration 1778700000000_transactions-soft-delete applied (deleted_at TIMESTAMPTZ DEFAULT NULL). deleted_at IS NULL guard added to 11 query locations (7 in edit.service, 2 JOIN ON in balance.service, 1 in report.service, 1 subquery in setBalance.service). Double-confirmation UX: [🗑️ Удалить] → warning → [🗑️ Да, удалить]/[◀️ Отмена]. softDeleteTransaction() with D1+D6 fetch-before-update. callback_data max 35 bytes (ed:d:ask:<ULID> ≤ 64 ✅). Graceful fallback for old edit buttons on already-deleted transactions. smoke-test-phase128.mjs A3/J1 scope guards updated to reflect Phase 1.29. smoke-test-phase129.mjs: 44/44 PASS. Full regression: 44/44 Phase 1.29 + 43/43 Phase 1.28 + 841/841 prior phases + 13/13 typecheck/lint = 941/941 total gates PASS (excl. Phase 1.5 bot-server tests — pre-existing). No hard delete. No restore. No new deps. No project_config.md changes. Implementation commit 7082540. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 20:23 | Phase 1.29 accepted after final verification; soft delete (transactions.deleted_at) added; double-confirmation delete UX implemented; deleted txs safely excluded from /edit, /balance (LEFT JOIN preserved), /report, /set_balance; zero hard deletes/restores; 941/941 gates PASS; Traceability, Adversarial Security & Scope Guard PASS; impl commit 7082540; workflow commit 723a89b. Tag phase-1.29-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 20:55 | Phase 1.30 implemented: Smart Account Onboarding. account-onboard-keyboard.service.ts (NEW): ac: namespace, parseAccountCallback() allowlist, keyboards for type/exchange/currency/post-create. account.service.ts (MODIFY): hasAccounts() lightweight COUNT, addAccountWithCurrency() explicit currency. webhook.route.ts (MODIFY): ac: callback block, /accounts empty-state → guided keyboard, /start new users → buildStartOnboardKeyboard(), midas:ac: text intercept for name/currency steps. No migration, no enum changes, no new deps, no new slash commands. Max callback_data 17 bytes (ac:cur:AAAAAAAAAA). Redis TTL 300s. 64/64 Phase 1.30 smoke + 197/197 accessible regression + 13/13 typecheck/lint PASS. Traceability ✅ Adversarial Security ✅ Scope Guard ✅. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 21:10 | Phase 1.30 accepted after final verification; smart account onboarding UX added for /start and empty /accounts; ac: callback namespace implemented; Redis TTL state midas:ac:{telegramUserId}:{chatId} added; existing silent Default account creation preserved; all new accounts remain type='manual'; no migrations, no DB function changes, no new deps, no new slash commands; 64/64 Phase 1.30 smoke passed; accessible gates 318/318 passed; legacy host-limited suites unchanged from prior baseline; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 4593867; workflow commit 99a2964. Tag phase-1.30-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 21:20 | Phase 1.31 advisory delivered: Inline account creation during transaction input. Scope: account_hint optional field in AI schema; parsed_account_hint TEXT column in transaction_drafts (1 migration); account-fuzzy.service.ts (NEW, Jaro-Winkler, short-ticker exact-only); account-inline-keyboard.service.ts (NEW, ia: namespace); midas:ia:{draftId} Redis TTL 300s for rename sub-flow; addAccountWithCurrency() reused from Phase 1.30; max callback_data 60 bytes (ia:use:{accountId}:{draftId}); Scenario Б (transfer) excluded — Phase 1.32+; Option A architecture (resolve in ai-parse worker before first keyboard). No code changes. Awaiting owner APPROVED. |
| 2026-05-07 22:00 | Phase 1.31 accepted after final verification; parsed_account_hint added to transaction_drafts; optional AI account_hint added; Option A implemented — account resolution before final draft confirmation; exact match sets draft.account_id silently; fuzzy/no-match account UX added; ia: callback namespace implemented with max 62 bytes; Redis rename state used only for temporary custom-name flow; transfer dual-account excluded; no to_account_id; no new deps; no Mini App; Phase 1.31 smoke 27/27 PASS; key regression gates PASS; typecheck/lint 13/13 PASS; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 7c065f7; workflow commit 04209fc. Tag phase-1.31-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-08 08:00 | Phase 1.32 Smart Text Input / Clarification Engine implemented and accepted. Migration 1778900000000_draft-clarification-state.js: `needs_clarification` status added to transaction_drafts state machine trigger. AI pipeline updated: amount/intent optional in schema, `PARTIAL_CONFIDENCE_THRESHOLD=0.3`, `MissingField` type, `partial` ParseResult status, `computeMissingFields()`. New `clarification.service.ts` in telegram-bot: `clar:` callback namespace for intent/category selection, `midas:clar:` Redis TTL 300s for amount text intercept. `webhook.route.ts`: clar: callback handler, clarification text intercept, buildClarificationScreen usage. `draft.service.ts`: `patchDraftAmount()`, `patchDraftIntent()`, `patchDraftCategory()` — atomic field patches returning `{status: 'ready'\|'still_needs', field}`. 57/57 Phase 1.32 smoke PASS. 0 lint/typecheck errors. Implementation commit e00f37e. Tag `phase-1.32-accepted` pushed. |
| 2026-05-08 09:00 | Phase 1.33 Clean Chat / Single Active Message UX implemented and accepted. UX-only phase — no migrations, no DB schema changes. `active-message.service.ts` (NEW): Redis pointer `midas:am:{userId}:{chatId}` (TTL 24h) tracks the current bot message per chat. `telegram-api.ts` (MODIFY): `upsertBotMessage()` edit-first strategy — tries `editMessageText`, falls back to `sendMessage`, updates Redis pointer. All workers (ai-parse, confirmation, notifications) now use edit-first pattern. `shared/index.ts` (MODIFY): `NotificationJobPayload` extended with `telegramUserId` + `activeMessageId`. Result: bot edits its last message instead of sending new ones — clean single-screen app UX. 0 typecheck errors. Batch-accepted by owner decision. Commit 36cacd7. Tag `phase-1.33-accepted` pushed. |
| 2026-05-08 09:30 | Phase 1.34 Rich Screen Cards implemented and accepted. UX-only phase — no migrations, no DB schema changes. `screen-builder.ts` (NEW in both `telegram-bot` and `background-workers`): pure functions for all UI screens — `buildPreviewScreen()`, `buildConfirmedScreen()`, `buildClarificationScreen()`, `buildConfirmKeyboard()`, `buildPostConfirmKeyboard()`, `buildNavKeyboard()`, `intentEmoji()`, `intentLabel()`, `escapeHtml()`. Replaces hardcoded text strings across all workers and route handlers with standardized card templates. 0 typecheck errors. Batch-accepted by owner decision. Commit 6e899f0. Tag `phase-1.34-accepted` pushed. |
| 2026-05-08 11:00 | Phase 1.35 Intelligent Transaction Understanding — core implementation complete. Migration `1779000000000_intelligent-transactions.js`: `item_name TEXT` + `parsed_category_hint TEXT` columns on transaction_drafts; `item_name TEXT` on transactions; `default_expense_account_id` + `default_income_account_id` FK columns on workspaces; `category_group` ENUM; 28-category taxonomy backfill; SECDEF onboarding function updated. `category-resolver.service.ts` (NEW): 3-stage pipeline — exact DB match → 200+ alias map → fallback «Другое». `prompts.ts` + `schemas.ts`: `item_hint` + `category_hint` added to AI schema with examples. `draft.service.ts`: propagates item_name, parsed_category_hint. `draft-confirmation.service.ts`: CategoryResolver integration, resolveDefaultAccount() with workspace defaults → LIMIT 1 → auto-create. `confirmation.worker.ts`: rich post-confirm cards with item/category. smoke-test-phase135.mjs: 55 tests PASS. 5/5 typecheck PASS. Deployed to Railway. |
| 2026-05-08 16:20 | Phase 1.35 hotfix #1: Rich preview cards across all confirmation entry points. Problem: after clarification (amount/intent/category selection), generic text like «📝 Готово. Подтвердите или отклоните:» was shown instead of the rich transaction card. Fix: introduced `confirmKb(draftId)` centralized keyboard helper (DRY pattern replacing 8 hardcoded keyboards) and `confirmPreview(workspaceId, userId, draftId)` helper (fetches draft data via `getDraftFields` → builds rich card via `buildPreviewScreen`). All 8 confirmation entry points updated: ia:skip, ia:create (new account), ia:use (select account), clar:intent, clar:category, clar:nocat, clarification amount text intercept, ia rename text intercept. Typecheck 5/5 PASS. Commit d037f75. Deployed to Railway. |
| 2026-05-08 16:29 | Phase 1.35 hotfix #2: Defensive String() coercion for Postgres NUMERIC amounts. Problem: `fetchApprovedTransactionCard` and `approveDraft` returned `amount` as raw Postgres NUMERIC (JavaScript `number`), but `buildConfirmedScreen` passed it to `escapeHtml()` which calls `.replace()` — crashed with `TypeError: input.replace is not a function`. Root cause: pg driver returns NUMERIC as `number`, not `string`. Fix: (1) `approveDraft`: `amount: String(draft.parsed_amount ?? '0')`, (2) `fetchApprovedTransactionCard`: `amount: String(tx.original_amount)`, (3) `escapeHtml`: defensive `typeof input === 'string' ? input : String(input)`. Also fixed incorrect SQL column names in `fetchApprovedTransactionCard`: `amount` → `original_amount`, `account_source_id` → `account_id`. Typecheck 5/5 PASS. Commit 6db3d69. Deployed to Railway. |
| 2026-05-09 09:46 | Phase 1.36-UX Sub-step 1: Persistent Navigation Keyboard (core). `telegram-api.ts` — `ReplyKeyboardMarkup` interface + `sendMessageWithReplyKeyboard()`. `screen-builder.ts` (telegram-bot) — `buildMainMenuKeyboard()`, `NAV_BTN_BALANCE/REPORT/SETTINGS`, `input_field_placeholder`. `webhook.route.ts` — Reply Keyboard sent on /start (new+existing users), 3 text intercepts before AI parse for [📊 Баланс]/[📋 Отчёт]/[⚙️ Настройки] buttons. Collateral lint: `ai-core/claude-client.ts` (no-useless-assignment), `draft-confirmation.service.ts` (no-unnecessary-type-conversion ×3), both `screen-builder.ts` (restrict-template-expressions). 13/13 PASS. |
| 2026-05-09 10:00 | Phase 1.36-UX Sub-step 2: UX Bug Fixes & Consistency. (1) `webhook.route.ts` confirmKb layout standardized: ✅ full-width top row + [✏️ Изменить|✖️ Отмена] split row — matches workers layout. (2) `redisConnection.del(clarKey)` added on approve/reject in `webhook.route.ts` — prevents stale `midas:clar:*` key intercepting next user message after confirmation (silent message discard race condition fixed). (3) `screen-builder.ts` both apps — emoji ✕→✖️ for visual weight parity with ✅ and ✏️. 13/13 PASS. Commit `c2f012f`. |
| 2026-05-09 10:12 | Phase 1.36-UX Sub-step 3: Reply Keyboard auto-activation. `shared/index.ts` — `replyKeyboardJson?` added to `NotificationJobPayload` (documented: only valid on sendMessage, not editMessageText). `background-workers/screen-builder.ts` — `buildNavKeyboard()` replaced by `buildMainMenuReplyKeyboard()` (returns plain JS object with `keyboard` array, not InlineKeyboard); `buildPostConfirmKeyboard()` nav row [📊 Баланс][📋 Отчёт] removed — only [✏️ Изменить запись] remains. `confirmation.worker.ts` — import updated (buildNavKeyboard→buildMainMenuReplyKeyboard); rejected/expired/intent_missing now pass `replyKeyboardJson` (not `inlineKeyboardJson`). `notifications.worker.ts` — keyboard routing split: `inlineReplyMarkup` for editMessageText path, `freshReplyMarkup` (prefers replyKeyboardJson) for sendMessage path. Reply Keyboard auto-activates on first new message without /start. 13/13 PASS. Commit `f10aa22`. |
| 2026-05-09 10:20 | Phase 1.36-UX Sub-step 4: Keyboard collapsibility. `screen-builder.ts` both apps — `is_persistent: true` → `is_persistent: false`. Result: Telegram displays standard ⏄ collapse icon next to 🎤 microphone button; user can hide/restore keyboard at will; keyboard re-appears on next bot sendMessage. 13/13 PASS. Commit `062d40d`. Deployed to Railway. |
| 2026-05-09 12:57 | Phase 1.36-UX FINAL (accepted): Transaction history workflow + permanent keyboard. **Проблема:** edit-first стратегия через `midas:am:` pointer перезаписывала предыдущую карточку вместо создания новой — история транзакций не накапливалась. **Решение:** (1) `ai-parse.worker.ts` — убран `activeMessageId` из preview notifications; каждая preview-карточка всегда отправляется как новое сообщение. (2) `notifications.worker.ts` — при отправке preview (draftId присутствует) записывает `sentMessageId` в Redis `midas:preview:{draftId}` TTL 600s; удалён `setActiveMessagePointer` и весь AM-pointer механизм. (3) `confirmation.worker.ts` — на approve читает `midas:preview:{draftId}` → передаёт как `activeMessageId` в notifications (edit preview→confirmed in-place); на reject — `activeMessageId` не передаётся → новое сообщение. (4) Greeting: НЕ удаляется — остаётся постоянным носителем ReplyKeyboard; весь код удаления (deleteMessage + nav carrier) убран. `greetingMsgId` удалён из `NotificationJobPayload`. `shared` пересобран. Typecheck 0 errors (оба приложения). Commits `e879dfc` → `2cb86c4` → `8941c6d` → `2a15f31`. Deployed to Railway. Протестировано: 4 транзакции записаны, история накапливается, клавиатура [📊 Баланс][📋 Отчёт][⚙️ Настройки] постоянно видна. |
| 2026-05-09 13:09 | Phase 1.37 Step 1: Zero-clutter UX. `screen-builder.ts` (background-workers): `buildNonsenseScreen()` rewritten — removed all inline buttons ([💸 Расход][💰 Доход][🤝 Долг дал][🤝 Долг взял]), replaced with Variant 5 text-only prompt with input examples (`кофе 150 UAH · зарплата 5000 USDT`). `ai-parse.worker.ts`: added stale "Не понял" message deletion — stores `midas:clar:msg:{userId}:{chatId}` Redis key pointing to nonsense message_id; on next successful parse, deletes the old nonsense message via `deleteMessage()` API before sending new preview. `telegram-api.ts`: `editTelegramMessage()` — treats "message is not modified" 400 error as success (no redundant message generation). Typecheck 8/8 PASS. Commits `a4d49a9` → `ee85e5f`. |
| 2026-05-09 13:34 | Phase 1.37 Step 2: Category taxonomy expansion. `prompts.ts`: Expanded from 28 to 30 categories (added Питомцы, Дом). International 500+ anchor items mapping: every category now has typical items across CIS (Пятёрочка, АТБ, Сільпо), EU (Lidl, Biedronka, IKEA), US (Walmart, Costco, Amazon, Starbucks) markets. Business categories expanded with global services: AWS, Stripe, Upwork, Fiverr, Google Ads, Facebook Ads, Notion, Figma, etc. Pet category: Royal Canin, Whiskas, Pro Plan, наполнитель, ветеринар. Дом: моющие средства, тряпки, полотенца, шторы, мебель. Typecheck 8/8 PASS. Commits `77a0ad9` → `5b02cf3`. |
| 2026-05-09 14:09 | Phase 1.37 Step 3: Multilingual recognition + fuzzy matching. `prompts.ts`: Added MULTILINGUAL RECOGNITION section (RU/EN/UA — any language maps to correct category). FUZZY MATCHING section (typos: кофэ→кофе, нетфликс→Netflix; slang: комуналка→коммуналка→Жильё; transliteration: kafe→кафе, taksi→такси). KEY BILINGUAL PAIRS for non-obvious translations (шиномонтаж=tire service, эквайринг=payment processing, подгузники=diapers, наполнитель=cat litter, etc.). Commit `e147240`. |
| 2026-05-09 14:10 | Phase 1.37 Step 4: Disambiguation rules + compound expressions + default intent priority. `prompts.ts`: Added 15 DISAMBIGUATION RULES (торт→Продукты/Подарки/Кафе by context; кофе→Кафе/Продукты; страховка→Транспорт/Здоровье/Путешествия; ремонт→Жильё/Транспорт/Оборудование; витамины→Здоровье/Питомцы; etc.). COMPOUND EXPRESSIONS (подарок жене→Подарки, корм для кота→Питомцы, билет в кино→Развлечения). DEFAULT INTENT PRIORITY (item+amount without verb = expense by default; income/transfer require explicit signal). Commit `03981d7`. |
| 2026-05-09 14:14 | Phase 1.37 Step 5: ALLOWED_CATEGORIES code validation. `claude-client.ts`: Added `ALLOWED_CATEGORIES` Set (30 categories — 18 personal + 12 business). Post-Zod validation step: if `aiData.category_hint` is not in the set, replace with `Другое`. Prevents hallucinated categories from reaching CategoryResolverService. Typecheck 8/8 PASS. |
| 2026-05-09 14:16 | Phase 1.37 Step 6: Documentation updates. `product-roadmap.md`: Added Phase 2.0 — AI Intelligence Evolution (3 components: 2.0-A self-learning from user edits, 2.0-B custom category recognition, 2.0-C regional bias from currency). Phase 1.37 + 2.0 added to summary table. Block 4 renamed from "Голос и Vision" to "AI Intelligence и Voice". `project_config.md`: Updated to v1.4, changelog v1.4 added, Section 2.8 AI Pipeline updated with multilingual/disambiguation/validation info. Commit `06bccb0`. Deployed to Railway. |
| 2026-05-09 15:18 | Phase 1.37 complete. `workflow_state.md` updated: Section 1 (status → COMPLETE), Section 2 (Phase 1.37 row added), Section 3 (AI Pipeline updated), Section 4 (project_config v1.4), Section 10 (7 history entries). All documents synchronized. |
| 2026-05-09 15:38 | Phase 1.37 VERIFICATION & ACCEPTANCE. 13/13 typecheck+lint PASS. CategoryResolver: Питомцы/Дом aliases added. Commit `641ad26`. Deployed to Railway. |
| 2026-05-09 19:00 | **Phase 1.38 Fix #1:** Confirmation card not deleted on Cancel. `confirmation.worker.ts` reads `midas:preview:{draftId}` on both approve and reject paths — in-place edit to ❌ Отменено. |
| 2026-05-09 19:04 | **Phase 1.38 Fix #2:** Unified blockquote currency prompt (Variant B). `screen-builder.ts` both apps: `<code>` tags replaced with blockquote text — no more green tap-able capsules. |
| 2026-05-09 19:05 | **Phase 1.38 Fix #3:** `amt+cur` handler used `validateCurrencyCode()` (ISO-only) instead of `normalizeCurrencyInput()`. Fixed. `awaiting_cur` now extracts currency token from mixed input (e.g. «50 евро»). Commit `d59025f`. |
| 2026-05-09 19:18 | **Phase 1.38 Rollback:** PRICE vs QUANTITY AI prompt rule reverted. Caused regressions («150 курток» not extracted as amount). Design decision: personal finance bots ALWAYS treat any number as a price. Original rule restored: «If ANY number present → ALWAYS extract as amount». Final commit `c59f2e1`. |
| 2026-05-10 10:08 | **Phase 1.39 — Gate UX Edit-In-Place (Variant B).** `formatAmount()` в обоих screen-builder.ts исправлен: `String()` cast для Postgres NUMERIC типа — устранён TypeError (`raw.includes is not a function`). `clarification.service.ts`: `::TEXT` cast на `parsed_amount` в 2 SQL-запросах. `buildGatePausedPreview()` обновлён: ⚠️ алерт-баннер + summary черновика (вместо старого текста без данных). Блок gate в `ai-parse.worker.ts` переработан: вместо 2 новых сообщений (paused edit + gate card) — **один** edit-in-place существующей preview-карточки с алертом и сохранением клавиатуры подтверждения. Commits `8fa8f91` → `089abf6`. Deployed to Railway — SUCCESS. |
| 2026-05-10 10:30 | **Phase 1.40 — Dead Card Auto-Cleanup.** Логика: карточки «❌ Отменено» и «⏰ Черновик истёк» автоматически удаляются из чата когда появляется следующая preview-карточка. В чате остаются только: pending (ждёт подтверждения) + approved (✅ Записано). Реализация: `confirmation.worker.ts` — после reject/expired сохраняет `previewMsgId` в Redis `midas:dead_card:{chatId}` TTL 24h. `draft-expiration.worker.ts` — CRON expiry тоже пишет dead_card. `ai-parse.worker.ts` — перед отправкой новой preview читает dead_card, передаёт как `deleteMessageId`, удаляет ключ. Если одновременно есть dead_card и clar_msg — приоритет у dead_card. TypeScript: 0 ошибок. Commit `51eaf10`. Deployed to Railway — SUCCESS. |
| 2026-05-10 15:30 | **Phase 2.0 — Transaction Hub + Reports 2.0 + Settings 2.0 deployed.** GitHub auto-deploy from `main`. |
| 2026-05-10 18:44 | **Phase 2.1 — Account Management Dashboard.** Полная реализация интерактивного управления счетами через баланс. **Новые файлы:** `balance-keyboard.service.ts` (450+ строк — parseBalanceCallback, buildBalanceListKeyboard, buildAccountActionsKeyboard, buildDeleteConfirmKeyboard, buildCurrencyWarningKeyboard, buildBalanceFiatCurrencyKeyboard, formatAccountDetailText, BalanceAccountRow type). **Модифицированные файлы:** (1) `account-onboard-keyboard.service.ts` — расширен пресетами банков (10: Тинькофф, Сбербанк, Альфа, ВТБ, Моно, Приват, Каспи, N26, Revolut, Wise) и кошельков (9: Trust Wallet, MetaMask, Exodus, Ledger, Trezor, Phantom, Coinbase Wallet, SafePal, Tangem). (2) `account.service.ts` — `renameAccount()`, `changeAccountCurrency()`, `softDeleteAccount()`. (3) `balance.service.ts` — `getBalanceData()`, `getAccountDetail()`, `setAccountBalanceById()`, `getAccountTxCount()`. (4) `webhook.route.ts` — bl: callback handler, text intercepts, ac:done проверяет bl:source. **DB Migration:** updated_at + deleted_at на account_sources. Build+Deploy: 0 ошибок. |
| 2026-05-10 19:58 | **Phase 2.2 — Settings UI Overhaul (DEPLOYED).** (1) `currencies.ts`: расширен список (FIAT 40+, CRYPTO 48+); `CURRENCY_RU_ALIASES` — 50+ русских алиасов (биткоин, доллар, евро, рубль, гривна, тенге, лира и др.); `searchCurrencies()` — 5-pass алгоритм (exact/startsWith/includes/EN-name/RU-alias), лимит 10. (2) `settings.service.ts`: `getWorkspaceAccounts()` + `deleted_at IS NULL` (soft-deleted счета не показываются); `setDefaultAccount()` атомарно обновляет оба поля (expense+income). (3) `settings-keyboard.service.ts`: `buildSettingsMainKeyboard()` — строгий 2x3 грид; выбор валюты с объявлением; новый текст выбора основной валюты. (4) `webhook.route.ts`: после выбора валюты кнопка `[⚙️ Назад в настройки]`; единый обработчик `st:da:sa:` — один Main Account для income+expense. Build: `tsc` 0 ошибок. Commit `3e650c1`. Deployed to Railway (auto-deploy). |
| 2026-05-10 22:00 | **Phase 2.3 — Paginated Transaction Search.** `transaction-hub.service.ts`: добавлен `SEARCH_PAGE_SIZE=8`; все 4 search-функции (`searchByName`, `searchByAmount`, `searchByCategory`, `searchByDateRange`) переработаны — принимают `page: number`, параллельный `COUNT(*)` → возвращают `{items: TxListItem[], total: number}`. Удалена константа `SEARCH_LIMIT=200`. `transaction-keyboard.service.ts`: `buildSearchResultsKeyboard(items, page, totalPages)` — кнопки товаров + строка навигации `[◀️][p/total][▶️]` + footer `[🔍 Новый поиск][◀️ К списку]`; `search_results_page` в `TxCallbackCmd`; парсер `tx:sr:p:{page}`. `webhook.route.ts`: все search-handlers сохраняют контекст в Redis `midas:tx:sr:ctx:{uid}:{cid}` TTL 600s; `search_results_page` handler — читает контекст, пересчитывает offset, обновляет сообщение; text intercepts (name/amount/date) → paginated API; при устаревшем контексте — дружелюбное «Поищите снова»; удалён дублирующий старый text intercept блок. Build: `tsc` 0 ошибок. Commit `6da4464`. |
| 2026-05-10 22:10 | **Phase 2.3 — Reports Close Button.** `report-keyboard.service.ts`: добавлен `rp:cl` callback (`✖️ Закрыть`) как последняя строка на всех 3 клавиатурах (`buildPeriodPickerKeyboard`, `buildReportSubMenuKeyboard`, `buildReportBackKeyboard`); тип `{ cmd: 'close' }` добавлен в `RpCallbackCmd`; `parseRpCallback`: `rp:cl → { cmd: 'close' }`; обновлён docstring. `webhook.route.ts`: в блоке `rp:` добавлен handler `else if (rpCmd.cmd === 'close')` → `deleteMessage(chatId, rpMsgId)` — полностью убирает сообщение из чата. Build: `tsc` 0 ошибок. Commit `049233d`. |
| 2026-05-10 22:11 | **Phase 2.3 — Persistent Keyboard Button Order.** `screen-builder.ts` (`buildMainMenuKeyboard`): порядок кнопок изменён — Row 1: `[💰 Баланс][📊 Отчёт]`, Row 2: `[📋 Транзакции][⚙️ Настройки]` (до: Row 1 Баланс+Транзакции, Row 2 Отчёт+Настройки). Обновлён docstring. Build: `tsc` 0 ошибок. Commit `70a5d41`. Deployed to Railway (auto-deploy). |
| 2026-05-11 09:00 | **Phase 2.2 Onboarding Pagination (Phase 2.2).** `account-onboard-keyboard.service.ts` полностью переписан с универсальным движком пагинации `buildPaginatedPicker()`. Реализованы: paginated banks (70+ записей, 6/страница, 3 колонки, ac:bp:{N}), paginated exchanges (ac:xp:{N}), paginated fiat currencies (ac:cfp:{N}), paginated crypto currencies (ac:ccp:{N}). `OnboardStep` расширен: `bal_input`. `AccountOnboardState` — поля `accountId`, `currency`. `addAccountReturningId()` добавлен в `account.service.ts`. `webhook.route.ts`: FSM handlers для bank_page, exchange_page, fiat_page, crypto_page, bal_skip. Баланс вводится текстом (validateAmountFromText intercept) или пропускается (ac:bal:s). Коммит в phase 2.2 серии. tsc 0 ошибок. |
| 2026-05-11 12:00 | **Phase 2.3 Onboarding UX Polish (PLAN APPROVED).** Пользователь утвердил план: (1) убрать промежуточный afterCreate экран, (2) добавить кнопку «✅ Завершить» (ac:fin) прямо в пикер типа, (3) buildStartOnboardKeyboard — исправить иконки (🔶→🔄, ₿→🔐), (4) при «▶️ Начать без счёта» тихо создавать «Кошелёк» (USD). Реализация поделена на 4 этапа с tsc-проверкой после каждого. |
| 2026-05-11 14:07 | **Phase 2.3 Onboarding UX Polish — ЭТАП 1 (account-onboard-keyboard.service.ts).** Добавлен `{ cmd: 'fin' }` в `AccountOnboardCmd` union + парсер `if (sub === 'fin')`. Добавлена `buildFinishOnboardKeyboard()` — пикер типа + «✅ Завершить» (ac:fin), иконки 🔄🔐. Добавлена `accountAddedText(name, currency)`. `buildStartOnboardKeyboard()` исправлен: 🔶→🔄, ₿→🔐, ↩️Назад→✏️Своё название. tsc 0 ошибок. |
| 2026-05-11 14:08 | **Phase 2.3 Onboarding UX Polish — ЭТАП 2 (imports).** `webhook.route.ts`: добавлены импорты `buildFinishOnboardKeyboard`, `accountAddedText` из account-onboard-keyboard.service.js. tsc пока 2 предупреждения (unused — ожидаемо до этапа 3). |
| 2026-05-11 14:10 | **Phase 2.3 Onboarding UX Polish — ЭТАП 3 (handlers).** `webhook.route.ts`: (1) `ac:fin` handler — идентичен `ac:done`, backward compat; (2) `ac:more` → redirect to fin flow (deleteMessage + sendMessageWithReplyKeyboard); (3) `ac:bal:s` — читает состояние Redis, затем показывает `accountAddedText` + `buildFinishOnboardKeyboard` вместо старого afterCreate; (4) `bal_input` text intercept — `buildFinishOnboardKeyboard` вместо `buildAfterCreateKeyboard`, `accountAddedText` вместо старой строки с балансом; (5) safety fallback в `bal_input` → `buildFinishOnboardKeyboard`. tsc 0 ошибок. |
| 2026-05-11 14:13 | **Phase 2.3 Onboarding UX Polish — ЭТАП 4 (default account).** `webhook.route.ts` `ac:skip` handler: перед удалением Redis-ключа вызывает `hasAccounts()` — если 0 счетов, создаёт `addAccountWithCurrency(workspaceId, userId, 'Кошелёк', 'USD')` в блоке try/catch (non-fatal). tsc 0 ошибок. Commit `395e1f2`. git push origin main. Deploy Railway: `7089846c — SUCCESS`. |
| 2026-05-11 16:30 | **master_roadmap Phase 1 — Keyboard Service.** `account-onboard-keyboard.service.ts` +478 строк: `CURRENCY_FLAGS` (40+ валют: 🇷🇺RUB 🇺🇸USD ₿BTC Ξ ETH TON и др.), `getCurrencyFlag(code)`, `CURRENCY_NAMES`. `buildPaginatedPicker()` рефакторинг — обе стрелки всегда, noop на краях. `buildCurrencyPickerText(name?,isCustom?)` — 3 ветки. `buildFiatCurrencyPage()` + `buildCryptoCurrencyPage()` — флаги + ac:cur:search. `searchCurrencies()` — fuzzy+транслитерация. `buildNoMatchText/Keyboard`. `buildCurrencySearch*`. Удалены FIAT_ITEMS, CRYPTO_ITEMS, CURRENCY_PICKER_TEXT. tsc 0 ошибок. |
| 2026-05-11 16:33 | **master_roadmap Phase 2 — Webhook FSM.** `webhook.route.ts`: `name_input` → no-match screen при fuzzy null. `ac:cus:save` → isCustomName=true → cur_pick. `ac:cus:keep` → name_input retry. `ac:cur:search` → cur_search step. `ac:cur:list` → возврат к списку. `cur_search` text interceptor → searchCurrencies → результаты или no-results. 3 success-screens button-free `{ inline_keyboard: [] }`. `chooseCurKeyboard()` module-level. Все callback_data ≤64 байт. tsc 0 ошибок. |
| 2026-05-11 16:43 | **master_roadmap Phase 3 — Smoke Tests.** `smoke-test-master-roadmap.mjs` (NEW): 70 проверок, запуск `node apps/telegram-bot/smoke-test-master-roadmap.mjs` (против скомпилированного dist/). Покрыты все 14 сценариев. Результат: **70/70 ✅ / 0 ❌**. |
| 2026-05-11 16:44 | **master_roadmap Phase 4 — Deploy.** Git commit `35c92e0` `feat(onboard): no-match screen, cur-search, flags, nav-arrows, button-free success [master_roadmap]`. Push → Railway auto-deploy. Status: Midas ● Online, background-workers ● Online. Deploy logs: clean start, Redis connected, no errors. |
| 2026-05-12 15:05 | **workflow_state.md актуализирован. Тесты запущены.** `smoke-test-master-roadmap.mjs`: исправлен устаревший assert для `buildCurrencySearchNoResultsText`. Итог: 76/76 ✅. `smoke-test-lazy-default.mjs`: 39/39 ✅. `tsc --noEmit`: 0 ошибок. Phase LD++ полностью подтверждена. |
| 2026-05-12 19:35 | **Phase 2.4 PR 2 - v������� � ������.** `account.service.ts`: �������� `AccountWithBalance` interface + `getAccountWithBalance()` + `getWorkspaceAccountsWithBalances()`. tsc 0 ������. GitHub PR #2 merged squash � main (commit 7cc8528). |
| 2026-05-12 17:27 | **Phase 2.4 — UX Design сессия и планирование.** Спроектированы: черновик + математика баланса («🏦 Bybit USD» + «💳 15 400 − 10 000 = 5 400 USD»), пикер счетов (кнопка «🔄 Сменить счёт»), кросс-валюта (ввод суммы конвертации), confirmed card без кнопок Баланс/Отчёт. UX-изменения ia:list/ia:back из текущего чата ОТМЕНЕНЫ (кодовая база возвращена в stable). 16 атомарных PR спроектированы. Анализ конфликтов: 1 breaking change (PR 7 buildConfirmKeyboard), 1 новый Redis-префикс (midas:xfx:ptr). Полный план: `account_debit_ux_plan.md`. workflow_state.md обновлён. |
| 2026-05-12 21:00 | **Phase 2.4 — Account Picker UX Hotfixes.** Исправление критического бага отсутствия пикера при AI parse без account_hint. В `ai-parse.worker.ts` добавлен принудительный показ пикера. В `draft.service.ts` добавлена `getWorkspaceAccountsForPicker` для воркера. В `draft-confirmation.service.ts` добавлена защита (`accountWasExplicitlyChosen`) от тихой автоконвертации XFX при несовпадении валюты дефолтного счета. Внедрены intent-aware тексты (доход/расход) для пикера счетов в `account-inline-keyboard.service.ts`. Все 103/103 smoke-теста прошли. |
| 2026-05-13 08:17 | **Phase 2.5 Шаг 1 — Smart Item→Category Auto-Detector.** `item-category-detector.service.ts` (NEW): 200+ брендов и ключевых слов, 9 категорий (Транспорт/Еда/Электроника/Одежда/Здоровье/Дом/Развлечения/Образование/Оборудование), longest-phrase-first matching. `patchDraftCategoryHint()` в `clarification.service.ts`: atomic idempotent DB patch (перезаписывает только если `parsed_category_hint IS NULL` или `= 'Другое'`). Интеграция в `webhook.route.ts` → `sendAndStorePreview`: non-blocking, не блокирует flow при ошибке. Тест: «майбах» → Транспорт, «starbucks» → Еда. tsc 0 ошибок. |
| 2026-05-13 08:20 | **Phase 2.5 Шаг 2 — Account-Currency Compatibility Validation Gate.** `account-currency-validator.service.ts` (NEW): матрица 8 правил, `classifyCurrency()`, `HYBRID_EWALLET_KEYS`, `TON_ASSETS`. Интегрирован в 2 точки `webhook.route.ts`: (1) `cmd=currency` callback — editMessageText с ошибкой, FSM state сохраняется в Redis; (2) `cur_input` text interceptor — upsertBotMessage с ошибкой, `redisConnection.del` НЕ вызывается. Блокирует: Монобанк+USDT, Наличные+ETH, Lightning+USDC. Разрешает: Bybit+USDT, Payeer+USDT (гибрид), MetaMask+BTC. Commit `d9ad480`. tsc 0 ошибок. git push → Railway deployed. |
| 2026-05-13 08:24 | **Phase 2.5 Шаг 3 — Anomaly Badge в пикерах.** `account-inline-keyboard.service.ts` (MODIFY): импорт `classifyCurrency`. `anomalyBadge(emoji, currency)` — возвращает `'⚠️ '` если emoji=`🏦` и валюта не фиат. `buildAccountPickerV2Keyboard` улучшен: `💎` для крипто, `🏦` для фиата, `⚠️` только для банк+крипто аномалий по имени счёта. `buildAccountPickerForDraft`: `⚠️` через `anomalyBadge()` по `accountTypeEmoji()`. Commit `f543c5e`. tsc 0 ошибок. git push → Railway deployed. Phase 2.5 COMPLETE. |
| 2026-05-13 15:20 | **Phase 2.7 — Account Picker Fix & Cancellation UX.** Исправлена регрессия коммита `6efe173` (always show account picker), из-за которой транзакции без созданных счетов зависали. Кнопка «Записать без счёта» на no-match карточке заменена на `✖️ Отмена` (`ia:cancel`). При отмене: статус черновика в БД меняется на `rejected`, сообщение in-place меняется на "❌ Отменено" без кнопок, удаляются стейты из Redis. |
| 2026-05-13 15:25 | **Infrastructure — AI Token Budget Fix.** Обнаружено, что очередь транзакций полностью встала из-за исчерпания дневного лимита токенов Claude (`AI daily token budget exceeded: 506188 >= 500000`). Через Railway CLI переменная `AI_BUDGET_MAX_DAILY_TOKENS` для `background-workers` увеличена с 500 000 до 2 000 000. Воркеры пересобраны, обработка транзакций восстановлена. |
| 2026-05-13 21:30 | **Phase 2.8 — Этап 1: Callback Fix (ia:newac).** `account-inline-keyboard.service.ts`: исправлен критический баг — кнопка «➕ Создать счёт» в пикере черновика вызывала `ia:rename` вместо корректного `ia:newac`. Добавлен тип `showpicker` в `InlineAccountCmd` union и соответствующий парсер для обратной навигации. |
| 2026-05-13 21:35 | **Phase 2.8 — Этап 2: Стандартизация текста онбординга.** `webhook.route.ts`: заголовок экрана выбора типа счёта (вызываемого через `ia:newac`) изменён с жёстко прописанного текста на константу `ACCOUNTS_EMPTY_TEXT` — соответствует стилю экрана `/start` для новых пользователей. |
| 2026-05-13 21:45 | **Phase 2.8 — Этап 3: Back Navigation (ia:showpicker).** `account-onboard-keyboard.service.ts`: кнопка «◀️ Назад» на экране выбора типа счёта теперь генерирует callback `ia:showpicker` вместо `ia:pk:back`. `webhook.route.ts`: реализован новый handler `ia:showpicker` — восстанавливает `midas:prev_acct` (кэшированный accountId из Redis), рендерит Account Picker V2 с сохранением `linkedDraftId`. Пользователь может вернуться к пикеру без потери контекста черновика. |
| 2026-05-13 22:00 | **Phase 2.8 — Этап 4: Удаление success-баннеров.** `webhook.route.ts`: удалены строки «✅ Счёт ... создан!» во всех трёх путях завершения онбординга из черновика: `bal_skip`, `bal_input`, `cur_input`. Теперь после создания счёта сразу показывается preview-карточка черновика через `confirmPreviewFull()` — чистый seamless UX без промежуточных экранов. |
| 2026-05-13 22:30 | **Phase 2.8 — TS Build Fix.** Обнаружены ошибки сборки на Railway: `TS6133: 'linkedAccountNameBal' / 'acNameBi2' is declared but its value is never read` — переменные стали неиспользуемыми после удаления success-баннеров в Этапе 4. Удалены оба объявления. `tsc --noEmit`: 0 ошибок. Commit `56991be` pushed to main. Railway re-deploy: Midas ✅ Online. |
| 2026-05-14 10:43 | **Phase 2.9 — Nav Buttons Never Delete Tx Records.** Проблема: после создания транзакции её message_id («✅ Записано» + «✏️ Изменить запись») хранился в Redis как `midas:am:` pointer. При нажатии Баланс/Отчёт/Транзакции/Настройки — `upsertBotMessage()` редактировал или удалял это сообщение. Решение: добавлен `sendNavMessage()` в `active-message.service.ts` — всегда отправляет НОВОЕ сообщение, не трогает `midas:am:`. 4 NAV_BTN_* обработчика в `webhook.route.ts` переключены на `sendNavMessage`. Commit `1477f55` pushed to main. |
| 2026-05-14 10:57 | **Phase 2.9+ — Smart Nav Message (мidas:nav: key).** Проблема: каждое нажатие nav-кнопки отправляло новое сообщение (засорение чата). Решение: два независимых Redis-ключа. `midas:am:` — черновики/пикеры/подтверждения (не трогаем в nav). `midas:nav:` — nav-панель (Баланс/Отчёт/etc.). `sendNavMessage()` полностью переписан: edit-first через `midas:nav:`, при успехе — редактирует то же сообщение (чат не засоряется), при неудаче — отправляет новое. При вводе транзакции: `getNavMessageId` → `deleteMessage` → `clearNavMessageId` перед стандартным cleanup `midas:am:`. Commits `4baac9c`. |
| 2026-05-14 11:04 | **Phase 2.9+ — Silent Close Button.** Кнопка «✕ Закрыть» в Настройках (`st:cancel`) ранее редактировала сообщение на «⚙️ Настройки закрыты.» (лишнее). Теперь: `deleteMessage(chatId, messageId)` + `clearNavMessageId()` — панель просто исчезает, никакого нового текста. Кнопка «✕ Закрыть» в Балансе (`bl:close`) уже удаляла сообщение, но не очищала `midas:nav:` — исправлено. Commit `004966f` pushed to main. Railway auto-deploy triggered. |
| 2026-05-14 12:28 | **Phase 2.10 — Fix 1: isSuccessCard — DEL midas:am: при подтверждении транзакции.** Проблема: после подтверждения транзакции success card сохранялась в `midas:am:` pointer. При вводе следующей транзакции step-7 в webhook.route.ts удалял сообщение из `midas:am:` — success card удалялась. Решение: `shared/index.ts` — добавлен `isSuccessCard?: boolean` в `NotificationJobPayload`. `confirmation.worker.ts` — при approve: `isSuccessCard: true` в payload. `notifications.worker.ts` — если `isSuccessCard`: `DEL midas:am:` вместо `SET`. Commit `df15a01`. |
| 2026-05-14 12:28 | **Phase 2.10 — Fix 2: from-context в delete flow parser.** Проблема: при нажатии «Изменить запись» → «Удалить» → «Отмена» → «Закрыть» — кнопка Закрыть удаляла карточку вместо восстановления success card. Корень: `parseTxCallback` не читал `parts[4]` для `tx:d:ask` и `tx:d:yes` — контекст `from='s'` терялся при парсинге. Fix: `transaction-keyboard.service.ts` — `const from = parts[4]`; return с `from` для обоих action. Теперь `tx:view` корректно видит `from==='s'` и ставит `closeCallback = tx:done:{txId}`. Commit `8894b92`. |
| 2026-05-14 12:37 | **Phase 2.10 — Fix 3: Double-lock sentinel key.** Проблема: даже после Fix 1 success card иногда удалялась (race condition между background-workers и telegram-bot, или отставание деплоя). Решение — двойная блокировка: (1) `notifications.worker.ts` при `isSuccessCard`: SET `midas:success_card:{sentMessageId}` = '1' (TTL 30 дней), затем DEL `midas:am:`. (2) `webhook.route.ts` step-7: перед `deleteMessage(amId)` проверяет `EXISTS midas:success_card:{amId}` — если sentinel есть, сообщение НЕ удаляется (только очищается pointer). Два замка работают независимо. tsc 0 ошибок оба приложения. Commit `b869c03`. |
| 2026-05-14 17:30 | **Phase 2.10+ Gate Fix — Frozen UI при параллельном вводе транзакций.** Проблема: TX1 открывает пикер счёта → TX2 (webhook step-7) удаляет пикер (gate_sent ещё не установлен) → ai-parse gate присылает новую карточку с пикером и устанавливает gate_sent → TX3 (webhook step-7) удаляет gate-карточку (gate_sent не проверялся!) → ai-parse молчит (gate_sent SET → silently ignore) → TX4, TX5... цикл: сообщение приходит, удаляется, ответа нет — **ЗАВИСОН**. **Fix 1 (webhook.route.ts строки 5446–5458):** `const gateSentActive = await redisConnection.exists('midas:gate_sent:...')`. Если активен — `deleteMessage` и `clearActiveMessageId` НЕ вызываются. Gate-карточка остаётся видимой при TX3, TX4... **Fix 2 (webhook.route.ts строка 1539, ia:pk: handler):** `redisConnection.del('midas:gate_sent:...')` после `setDraftAccountId` — нормальный flow восстанавливается сразу после выбора счёта. **Fix 3 (ai-parse.worker.ts):** Gate реконструирует полный пикер счетов (inline keyboard с кнопками счетов + ✖️ Отмена) когда `pendingDraft.accountId === null` — вместо пустой confirm-клавиатуры. **Жизненный цикл gate_sent:** SET ai-parse.worker (при gate) → DEL ia:cancel (строка 1432, до фикса) / ia:pk: (ДОБАВЛЕНО) / approve/reject confirmation.worker (строка 268, до фикса) / TTL auto 1h. Scope: 2 файла (webhook.route.ts, ai-parse.worker.ts) + утилита fix-stuck-draft.mjs. tsc 0 ошибок. git commit `8d25ec1`, push origin main ✅. Railway: Midas ✅ Online, background-workers ✅ Online. |


---

## 11. AGENT OPERATING PROTOCOL — ОБЯЗАТЕЛЬНЫЙ ПРОЦЕСС РАБОТЫ

1. Startup Protocol

Every new agent session must start by reading:
- project_config.md
- workflow_state.md
- docs/product-roadmap.md (утверждённый план развития продукта — Phase 1.23–2.5)
- only the phase-relevant files listed in workflow_state.md

The agent must not load all project files by default.

The agent must first reconstruct the project state and report:
- current phase
- last completed phase
- current blocker
- allowed scope
- forbidden scope
- files read
- MCP tools required for the current phase
- risks/blockers before implementation

The agent must not write code before owner approval.

2. Context Minimization Protocol

The agent must minimize token usage by reading only files relevant to the current phase.

For each phase, workflow_state.md must list:
- required files
- optional files
- forbidden / irrelevant files for the current phase

The agent must not read old event storming files, irrelevant ADRs, client presentation files, future-phase documents, or unrelated integrations unless they are explicitly needed.

If the context becomes overloaded, stale, or noisy, the agent must notify the owner and recommend:
- compacting the current session
- updating workflow_state.md
- creating a git checkpoint
- starting a new clean chat with a handoff prompt

3. MCP Discipline

The agent must use only MCP servers required for the current phase.

Current rule:
- Local FS / GitHub MCP: use when reading/editing project files.
- Postgres MCP: use only for DB/schema work such as Phase 1.2.
- Notion MCP: forbidden until Phase 3.
- Google Sheets integrations: forbidden until Phase 3.
- Crypto/blockchain tools: forbidden until Phase 2.
- Browser/DevTools tools: only for frontend/UI phases.
- Any additional MCP server must be justified before use.

The agent must explicitly state which MCP tools are required before implementation.

4. Phase Gate Protocol

Every phase must follow this lifecycle:

A. PLAN
- Read only required files.
- Produce a phase execution plan.
- Identify risks.
- Identify tests.
- Identify scope boundaries.
- Wait for owner approval.

B. APPROVAL
- Do not implement anything until the owner explicitly writes APPROVED.

C. IMPLEMENTATION
- Work in small, controlled tasks.
- Do not implement the entire phase in one large pass.
- Do not add future-phase functionality.
- Do not modify project_config.md without explicit owner approval.

D. VERIFICATION
- Run relevant typecheck, lint, tests, Docker/Postgres checks, and phase-specific validations.

E. REVIEWS
After every major module and after every phase, run:
- Traceability Review
- Adversarial Security Review
- Scope Guard Review

F. FIXES
- Apply required fixes.
- Re-run relevant tests.
- Re-run reviews if security or data isolation changed.

G. CHECKPOINT
After accepted fixes:
- update workflow_state.md
- recommend or create a git commit
- stop and wait for next approval

5. Small Task Discipline

During implementation, the agent must break the work into small tasks.

Each task must have:
- objective
- files affected
- tests/verification
- scope boundaries
- completion report

The agent must avoid broad commands like:
“Implement the whole phase.”

Instead, use controlled chunks such as:
- migration structure
- core schema
- RLS policies
- withTenantTransaction
- Decimal boundary
- tests

6. Mandatory Reviews

Traceability Review must verify:
- data flow from input to persistence/output
- type boundaries
- tenant context
- financial precision
- idempotency
- error handling
- observability

Adversarial Security Review must try to break:
- tenant isolation
- RLS
- SQL safety
- AI output boundaries
- callback/draft state transitions
- queue retries
- rate limits
- logging/privacy

Scope Guard Review must verify:
- no future-phase implementation
- no project_config.md modification
- no crypto before Phase 2
- no Notion/Google Sheets before Phase 3
- no Mini App before Phase 4
- no PDF/polish before Phase 5
- no hidden scope creep

7. Git Checkpoint Protocol

Before every major phase:
- ensure working tree is clean or intentionally staged
- recommend a checkpoint commit

After every accepted phase:
- update workflow_state.md
- run git status
- recommend a git commit with a clear message

Suggested commit format:
- checkpoint: complete phase X.Y and prepare phase X.Z handoff
- chore: configure local development infrastructure
- feat(database): add core schema and RLS foundation
- test(database): add RLS and draft lifecycle tests

The agent must not perform destructive git operations unless explicitly approved by the owner.

8. workflow_state.md Update Protocol

After each important step, phase, review, or checkpoint, workflow_state.md must be updated.

workflow_state.md must always contain:
- current phase
- current step
- status
- last completed step
- blocker
- accepted decisions
- active scope
- forbidden scope
- required files for next chat
- required MCP tools
- next recommended action
- compressed action history

workflow_state.md must remain a dispatcher, not a full archive.
Detailed artifacts must stay in dedicated docs/ files and ADRs.

9. Context Reset Protocol

The agent must recommend a new clean chat when:
- context becomes too large
- multiple phases have been completed
- the conversation becomes noisy
- the agent starts relying on chat memory instead of files
- before starting a high-risk phase such as database, security, payments, auth, or production deployment

Before a context reset:
- update workflow_state.md
- compress action history
- verify project_config.md status
- verify next phase scope
- create or recommend git checkpoint
- provide a next-chat handoff prompt

10. Phase Awareness Protocol

The agent must always understand the full roadmap but implement only the current phase.

Roadmap awareness:
- Phase 1: MVP Infrastructure, DB Foundation, AI Core, Telegram Bot, Basic Reports
- Phase 2: Crypto Monitoring & Alerts
- Phase 3: Google Sheets / Notion integrations
- Phase 4: Telegram Mini App Frontend
- Phase 5: Polish & Production Release

Implementation discipline:
- Future phases may influence schema extension points.
- Future phases must not be implemented early.
- Schema-only future readiness is allowed only if explicitly approved.
- Business logic for future phases is forbidden until that phase starts.

11. Owner Approval Protocol

The agent must wait for explicit owner approval before:
- starting a new phase
- creating migrations
- modifying project_config.md
- adding new dependencies
- changing ports/environment assumptions
- introducing new MCP servers
- expanding scope
- implementing future-phase functionality
- running destructive commands

12. Reporting Protocol

After every task, report in this format:
- What was done
- Files changed
- Commands run
- Tests/checks passed
- Risks remaining
- Scope violations: yes/no
- Whether the next step can start
- Whether workflow_state.md needs update
- Whether git checkpoint is recommended

13. Phase Advisory Protocol

At the beginning of every phase, sub-phase, or major task, the agent must produce a short Phase Advisory before implementation.

The Phase Advisory must include:

A. Current Objective
- What we are trying to accomplish now.
- Why this step matters for the overall product.
- What must be completed before moving forward.

B. Required Context
- Which files must be read for this step.
- Which files are optional.
- Which files must not be loaded because they are irrelevant and would waste context.

C. Required MCP Servers
The agent must recommend only the MCP servers required for the current step.

Examples:
- Filesystem / Local FS MCP — required when reading or editing project files.
- Postgres MCP — required only for database/schema/RLS/migration work.
- GitHub MCP — required only if working with a remote GitHub repository, branches, pull requests, or issues.
- Context7 MCP — useful only when current external library documentation is needed.
- Browser / DevTools MCP — useful only during frontend/UI testing phases.
- Notion MCP — forbidden until Phase 3.
- Google Sheets integration — forbidden until Phase 3.
- Crypto / Blockchain tools — forbidden until Phase 2.

D. Access Level Recommendation
For every MCP/tool, the agent must specify the minimum safe access needed:

- read-only
- read/write inside project directory only
- local dev database read-only
- local dev database read/write
- forbidden for this phase

The agent must not request broad access if narrow access is enough.

E. Token Efficiency Plan
The agent must explain how it will reduce token usage:
- read only phase-relevant files
- avoid old event storming files unless needed
- avoid irrelevant ADRs
- avoid client-facing documents during implementation
- summarize long files before using them deeply
- ask before loading additional context
- recommend compact/new chat when context becomes noisy

F. Risk & Scope Boundaries
The agent must state:
- what can go wrong in this step
- what must not be touched
- which future-phase features are forbidden
- what requires owner approval before proceeding

G. Verification Plan
The agent must state:
- which commands/tests/checks will verify the work
- what success looks like
- what failure would block the next step

H. Owner Decision Needed
Before implementation, the agent must ask for explicit owner approval.

The agent must not proceed from Phase Advisory to implementation until the owner writes APPROVED.

Required Phase Advisory format:

## Phase Advisory

### Current Objective
...

### Required Context
Required files:
- `workflow_state.md`
- `project_config.md`
- `docs/product-roadmap.md` ← **источник правды** для следующих фаз (1.23–2.5)
- `docs/balance-semantics.md` (для фаз, связанных с балансом)
Optional files:
- phase-relevant source code (determined per phase from roadmap)
Do not load:
- all project files by default

### Required MCP Servers
| MCP | Required? | Access Level | Why |
|---|---:|---|---|

### Token Efficiency Plan
...

### Risk & Scope Boundaries
...

### Verification Plan
...

### Owner Approval Needed
Waiting for APPROVED before implementation.

---

## 14. WORKFLOW_STATE SELF-AUDIT PROTOCOL

**Триггеры** — запускать аудит только при:
- завершении фазы или крупной подфазы
- прохождении review gate (Traceability / Security / Scope Guard)
- изменении MCP конфигурации
- git checkpoint
- context reset / handoff в новый чат
- перед началом high-risk фазы (DB, security, payments, auth, deploy)

**Не запускать** после каждого мелкого таска.

**Формат вывода** — компактная таблица, max 10 строк:

| Проверка | Статус |
|---|---|
| Дата обновления актуальна | ✅ / ❌ |
| Section 1 (состояние) корректно | ✅ / ❌ |
| Section 10 (история) актуальна | ✅ / ❌ |
| Section 8 (файлы) классифицированы | ✅ / ❌ |
| Section 7 (MCP) полная | ✅ / ❌ |
| Section 6 (scope) соответствует фазе | ✅ / ❌ |
| Section 9 (handoff prompt) актуален | ✅ / ❌ |
| project_config.md не изменён | ✅ / ❌ |
| Git working tree clean | ✅ / ❌ |
| Нет scope creep | ✅ / ❌ |

При обнаружении `❌` — исправить немедленно или уведомить владельца.

---

## 15. ПОЛНЫЙ ФЛОУ ПРОДУКТА (текущее состояние)

> Этот раздел описывает полный путь пользователя — от первого запуска бота до момента создания первой транзакции. Обновлён: 2026-05-11 19:52 (UTC+3).

---

### 🚀 Этап 0 — Первый запуск `/start`

1. Пользователь пишет `/start` в чат бота.
2. `webhook.route.ts` → `resolveWorkspace()` → вызывает `system_find_or_create_user()` (SECURITY DEFINER, atomic, pg_advisory_xact_lock).
3. Создаётся: **workspace** (default_currency=USDT, timezone=UTC), **workspace_membership**, **default account_source** («По умолчанию», USDT), **default category** (Другое).
4. Бот отправляет приветственное сообщение с ReplyKeyboard (`is_persistent: false`, `resize_keyboard: true`):
   ```
   Строка 1: [💰 Баланс]  [📊 Отчёт]
   Строка 2: [📋 Транзакции]  [⚙️ Настройки]
   ```
5. Если у пользователя **0 счетов** → бот также показывает guided onboarding keyboard (`buildStartOnboardKeyboard`).
6. Greeting-сообщение **никогда не удаляется** — оно носитель ReplyKeyboard.

---

### 🏦 Этап 1 — Создание ПЕРВОГО счёта (онбординг)

#### 1.1 Выбор типа счёта

Пользователь видит inline-клавиатуру:
```
[🏦 Банковская карта]  [💵 Наличные]
[🔄 Крипто-биржа]      [🔐 Крипто-кошелёк]
[✏️ Своё название]
[▶️ Начать без счёта]
```

**`[▶️ Начать без счёта]` (ac:skip):**
- Если у пользователя **0 счетов** → тихо создаётся счёт «Кошелёк» (USD) — non-fatal try/catch.
- Redis-ключ `midas:ac:` удаляется.
- Пользователь получает ReplyKeyboard и может сразу вводить транзакции.

#### 1.2 Сценарий «Банковская карта» (ac:type:card)

1. FSM переходит в шаг `name_input`.
2. Бот показывает промпт ввода названия с blockquote-примерами:
   ```
   Введите название банка:
   <blockquote>Например: Тинькофф · Сбербанк · Альфа · Monobank</blockquote>
   ```
3. Пользователь вводит текст → `name_input` text interceptor.

**Случай A — fuzzy match найден** (например «тинькофф» → «Тинькофф»):
- Бот показывает экран подтверждения с blockquote «Тинькофф».
- Кнопки: `[✅ Да, Тинькофф]` / `[✏️ Нет, изменить]`.
- Если подтверждено → FSM переходит в `cur_pick`.

**Случай B — fuzzy null** (например «Абв»):
- Бот показывает no-match экран:
  ```
  🔍 Похожего банка не нашли.
  <blockquote>«Абв»</blockquote>
  Хотите создать счёт с таким названием?
  ```
- Кнопки:
  - `[✅ Создать «Абв»]` (ac:cus:save) → сохраняет как `pendingName`, `isCustomName=true`, переходит в `cur_pick`.
  - `[✏️ Изменить название]` (ac:cus:keep) → возврат в `name_input`.
  - `[◀️ К типу счёта]` (ac:type:back) → возврат на стартовый экран.

#### 1.3 Сценарий «Наличные» (ac:type:cash)

- Название формируется автоматически: «Наличные {CURRENCY}» (имя счёта создаётся после выбора валюты).
- Пользователь сразу видит currency picker (шаг `cur_pick`).
- **Нет экрана ввода названия.**

#### 1.4 Сценарий «Крипто-биржа» / «Крипто-кошелёк»

- **Крипто-биржа (ac:type:exchange):** Показывает paginated picker бирж (5 пресетов: Binance/Bybit/OKX/Kraken/Huobi + ✏️ Своя).
- **Крипто-кошелёк (ac:type:wallet):** Показывает sub-picker: crypto / e-wallet / TON / Lightning.
  - Lightning → фиксированная валюта BTC, минует currency picker.
  - Остальные → идут в crypto currency picker.
- Paginated pickers банков/бирж — навигация `[◀️][N / Total][▶️]`, всегда обе стрелки (noop на краях).

---

### 💱 Этап 2 — Выбор валюты (шаг `cur_pick`)

Пользователь видит:
```
В какой валюте открыть счёт «Тинькофф»?

[🇷🇺 RUB]  [🇺🇸 USD]  [🇪🇺 EUR]
[🇬🇧 GBP]  [🇹🇷 TRY]  [₿ BTC]
[◀️] [1 / 2] [▶️]
[🔍 Найти валюту]
```

Для кастомных счётов (`isCustomName=true`) текст: «Для вашего счёта (свой счёт)».

**Кнопка `[🔍 Найти валюту]` (ac:cur:search):**
1. FSM переходит в шаг `cur_search`.
2. Бот показывает промпт:
   ```
   🔍 Поиск валюты для счёта «Тинькофф»
   Введите код или название: RUB, доллар, bitcoin...
   ```
3. Пользователь вводит текст → `cur_search` text interceptor.
4. `searchCurrencies(query, pool)` — fuzzy + транслитерация (rub/руб → RUB, dollar/доллар → USD, btc → BTC).
5. **Найдено:** показывает кнопки результатов + `[◀️ Вернуться к списку]` (ac:cur:list).
6. **Не найдено:** «Такой валюты нет. Попробуйте: USD, RUB, BTC...».

**Выбор валюты (ac:cur:{CODE}):**
- Счёт создаётся в БД: `addAccountWithCurrency(workspaceId, userId, name, currency)` → INSERT в `account_sources`, тип `manual`.
- FSM переходит в шаг `bal_input`.

---

### 💰 Этап 3 — Ввод начального баланса (шаг `bal_input`)

```
💳 Счёт «Тинькофф» (RUB) создан!
Введите начальный баланс или пропустите:

[⏩ Пропустить]
```

- **Ввод числа** → text interceptor `bal_input` → `setAccountBalanceById()` → `initial_balance` в БД.
- **`[⏩ Пропустить]`** (ac:bal:s) → баланс остаётся 0.

После ввода/пропуска — **success screen** (без кнопок, только текст):
```
✅ Счёт создан!
🏦 Тинькофф · RUB
Начальный баланс: 15 000 ₽
```
Затем сразу — пикер типа для добавления следующего счёта (`buildFinishOnboardKeyboard`):
```
[🏦 Банковская карта]  [💵 Наличные]
[🔄 Крипто-биржа]      [🔐 Крипто-кошелёк]
[✏️ Своё название]
[✅ Завершить]
```

---

### ➕ Этап 4 — Создание ВТОРОГО счёта (необязательно)

Пользователь нажимает любой тип в `buildFinishOnboardKeyboard` → повторяет Этапы 1–3.

**Пример двух счетов:**
1. «Тинькофф» → RUB → баланс 15 000 (банковская карта)
2. «Наличные RUB» → RUB → баланс 5 000 (наличные, имя авто)

Флоу Наличных (второй счёт):
- Нажать `[💵 Наличные]` → сразу currency picker (нет name_input) → выбрать `[🇷🇺 RUB]` → ввести баланс `5000` → success screen.

После — снова `buildFinishOnboardKeyboard`. Пользователь нажимает `[✅ Завершить]` (ac:fin):
- Redis-ключ `midas:ac:` очищается.
- Сообщение удаляется (`deleteMessage`).
- Отправляется `sendMessageWithReplyKeyboard` — ReplyKeyboard появляется снова.
- Если пришёл из баланс-дашборда (`bl:source` в Redis) → возврат в баланс. Иначе — финальный экран «Всё готово!».

---

### 📝 Этап 5 — Первая транзакция (ввод расхода)

#### 5.1 Ввод свободным текстом

Пользователь просто **пишет в чат** (не команда, не кнопка):
```
кофе 150 рублей
```

**Маршрут:**
1. `webhook.route.ts` — сообщение проходит все text interceptors (нет активных Redis-ключей).
2. Попадает в раздел AI parse → `addJobToWebhookIngestionQueue()`.
3. **`webhook-ingestion` worker** (BullMQ) → `ai-parse.worker.ts`.

#### 5.2 AI parse pipeline

1. `parseTransaction(text)` → Claude Haiku 4.5, `temperature: 0`, `max_tokens: 256`.
2. System prompt: MULTILINGUAL RECOGNITION (RU/EN/UA) + FUZZY MATCHING + 30-категорийная таксономия + 500+ якорных слов + DISAMBIGUATION RULES.
3. **Результат:**
   ```json
   { "intent": "expense", "amount": "150", "currency": "RUB", "category_hint": "Кафе и рестораны", "confidence": 0.95 }
   ```
4. Post-processing (safety net): 7 групп regex, negation guard, confidence boost.
5. `ALLOWED_CATEGORIES` валидация: если `category_hint` ∉ set → заменяется на «Другое».
6. `CategoryResolverService`: exact DB match → 200+ alias map → fallback.
7. **Dead card cleanup:** если в Redis есть `midas:dead_card:{chatId}` (старая ❌ карточка) → `deleteMessage` перед отправкой preview.

#### 5.3 Создание черновика и preview

1. `createDraft()` → INSERT в `transaction_drafts` (статус `pending_user`).
2. `notifications.worker` → отправляет preview-карточку в чат:
   ```
   ☕ Кафе и рестораны
   Расход · 150 ₽
   [✅ Записать]  
   [✏️ Изменить] [✖️ Отмена]
   ```
3. `midas:preview:{draftId}` (TTL 600s) → сохраняет message_id карточки.

#### 5.4 Подтверждение

**Пользователь нажимает `[✅ Записать]`:**
1. `callback_query` → `confirmation.worker`.
2. SELECT FOR UPDATE SKIP LOCKED → атомарная защита от двойного подтверждения.
3. INSERT в `transactions` (intent=expense, category=Кафе и рестораны, base_amount=150, currency=RUB, account_id=Тинькофф, base_currency=RUB).
4. `confirmation.worker` читает `midas:preview:{draftId}` → `editMessageText` → preview превращается в confirmed card:
   ```
   ✅ Записано!
   ☕ Кафе и рестораны
   Расход · 150 ₽ · Тинькофф
   [✏️ Изменить запись]
   ```
5. `midas:preview:{draftId}` удаляется из Redis.

**Пользователь нажимает `[✖️ Отмена]`:**
- `draft_status` → `rejected`.
- preview-карточка редактируется → «❌ Отменено».
- Сохраняется в `midas:dead_card:{chatId}` (TTL 24h) — автоудалится при следующем preview.

#### 5.5 Если Claude не распознал валюту (awaiting_cur)

- `midas:awaiting_cur:{chatId}` (TTL 600s) создаётся если есть сумма но нет валюты и нет `midas:cur_set:{workspaceId}`.
- Следующий текст пользователя перехватывается как валюта: «евро» → EUR, «150 руб» → RUB.

#### 5.6 Если Claude вернул partial (нет суммы)

- `needs_clarification` статус черновика.
- Пользователю задаётся вопрос: «Какая сумма?».
- `midas:clar:{userId}:{chatId}` (TTL 300s) → следующее число — сумма.

---

### 📊 Итоговая схема: ключевые сущности

```
workspaces
  └── workspace_memberships (telegramUserId → workspaceId)
  └── account_sources (Тинькофф/RUB, Наличные/RUB)
  └── categories (Кафе и рестораны, Продукты, ...)
  └── transaction_drafts (pending → approved/rejected/expired)
  └── transactions (confirmed расходы/доходы)
```

### 📦 Redis-ключи в активном онбординге

| Ключ | TTL | Назначение |
|---|---|---|
| `midas:ac:{userId}:{chatId}` | 300s | State машина онбординга (step, name, currency, pendingName, isCustomName, cur_search) |
| `bl:source:{userId}:{chatId}` | 300s | Флаг: онбординг инициирован из баланс-дашборда |
| `midas:preview:{draftId}` | 600s | message_id preview-карточки |
| `midas:dead_card:{chatId}` | 24h | message_id карточки ❌ для автоудаления |
| `midas:awaiting_cur:{chatId}` | 600s | Ожидание ввода валюты |
| `midas:clar:{userId}:{chatId}` | 300s | Ожидание ввода суммы при clarification |
| `midas:cur_set:{workspaceId}` | - | Флаг установленной валюты (не запрашивать повторно) |

---

## 16. ACTIVE ROADMAP — КУДА ДВИГАЕМСЯ ДАЛЬШЕ

> Этот раздел — живой документ. Обновляется при завершении каждой фазы.
> Последнее обновление: 2026-05-13 11:24 (UTC+3)

### ✅ Завершено в Phase 2.5 (Smart Transaction Logic)

| Шаг | Что сделано | Статус |
|---|---|---|
| Шаг 1 | `item-category-detector.service.ts` — авто-определение категории по названию товара/бренда (200+ записей, 9 категорий, Maybach→Транспорт) | ✅ |
| Шаг 2 | `account-currency-validator.service.ts` — блокировка несовместимых пар счёт+валюта (Банк+USDT = ❌, Биржа+USDT = ✅) | ✅ |
| Шаг 3 | `anomalyBadge()` в пикерах — визуальный `⚠️` для подозрительных существующих счетов | ✅ |
| Шаг 4 | `ai-parse.worker.ts` — фикс «Active Draft Gate»: вывод Account/XFX-зависимых UI компонентов при активном черновике | ✅ |

---

### 🔴 Phase 3.0 — DB Schema: Полная архитектурная валидация (ОБЯЗАТЕЛЬНО)

> **Приоритет: ВЫСОКИЙ.** Текущая валидация (Шаг 2) — эвристическая, основана на `AccountOnboardState` из Redis.
> Если Redis-ключ истёк или пользователь создаёт счёт нестандартным путём — тип счёта неизвестен.
> Phase 3.0 переводит систему на **100% надёжную, схема-enforced валидацию**.

#### Что нужно сделать

**Миграция БД:**
```sql
ALTER TABLE account_sources
  ADD COLUMN account_type    TEXT CHECK (account_type IN ('card','cash','exchange','wallet','custom')),
  ADD COLUMN wallet_subtype  TEXT CHECK (wallet_subtype IN ('crypto','ewallet','ton','lightning')),
  ADD COLUMN provider_key    TEXT;  -- 'mono', 'binance', 'payeer', etc. (lowercase)
```

**Заполнение при создании счёта:**
- В `account.service.ts` → `addAccountReturningId()` и `addAccountWithCurrency()`:
  принимать `accountType`, `walletSubtype`, `providerKey` из `AccountOnboardState` и записывать в БД.
- В `webhook.route.ts` → `cmd=currency` handler: передавать `state.accountType`, `state.walletSubtype`, `state.name.toLowerCase()` как `providerKey`.

**Использование при транзакциях:**
- `buildAccountPickerForDraft` и `buildAccountPickerV2Keyboard`:
  вместо эвристики по имени → читать `account_type` из БД, передавать в `validateAccountCurrency()`.
  Это делает `⚠️` badge на 100% точным.

**Ретроактивное заполнение (опционально):**
- Попытаться вывести `account_type` из существующих названий счетов через матч с `BANK_PRESETS`/`EWALLET_PRESETS`/`EXCHANGE_PRESETS`.
- Все что не подошло → `account_type = 'custom'`.

#### Файлы для изменения

| Файл | Изменение |
|---|---|
| `packages/database/migrations/XXXXXXX_account-sources-type-columns.js` | NEW — ALTER TABLE |
| `apps/telegram-bot/src/services/account.service.ts` | MODIFY — расширить сигнатуры addAccount* |
| `apps/telegram-bot/src/routes/webhook.route.ts` | MODIFY — передавать тип в addAccount* |
| `apps/telegram-bot/src/services/account-inline-keyboard.service.ts` | MODIFY — читать тип из БД вместо эвристики |
| `apps/telegram-bot/src/services/account-currency-validator.service.ts` | MODIFY — убрать провайдер-хинт из сигнатуры (теперь из БД) |

#### Оценка работы
- ~3–4 часа (миграция + сигнатуры + интеграция + smoke test)
- Без breaking changes в UX — изменения только в слое данных

---

### 🟡 Phase 3.1 — Расширение словаря детектора категорий

> **Приоритет: СРЕДНИЙ.** Текущий словарь: 200+ записей, 9 категорий.
> Цель: расширить до 500+ записей, добавить локальные бренды (UA/KZ/UZ/BY).

- Добавить категории: `Путешествия`, `Подарки`, `Питомцы`, `Инвестиции`
- Добавить 150+ локальных брендов: АТБ, Сільпо, Kaspi, OLX, Wildberries, Ozon, СДЭК
- Добавить транслитерацию: «starbaks» → Starbucks, «mak» → McDonald's

---

### 🟡 Phase 3.2 — Отчёт 3.0: Категорийная аналитика

> **Приоритет: СРЕДНИЙ.** Текущий `/report` показывает только суммы по intent.
> Добавить разбивку по категориям + топ-5 трат за период.

```
📊 Отчёт за май 2026

💸 Расходы: 45 000 UAH
  🚗 Транспорт: 12 000 (27%)
  🍔 Еда: 8 500 (19%)
  💻 Электроника: 15 000 (33%)
  📁 Другое: 9 500 (21%)

💰 Доходы: 120 000 UAH
```

---

### 🔵 Phase 4.0 — Telegram Mini App (Frontend)

> **Приоритет: НИЗКИЙ / БУДУЩЕЕ.** React 19 + Vite 8.
> Визуальный дашборд баланса, диаграммы расходов по категориям, история транзакций.
> **Не начинать до завершения Phase 3.0 + 3.1.**

---

### Сводная таблица приоритетов

| Фаза | Название | Приоритет | Статус | Требует |
|---|---|---|---|---|
| **3.0** | DB Schema: account_type/wallet_subtype | 🔴 ВЫСОКИЙ | ⏳ Следующая | Phase 2.5 ✅ |
| **3.1** | Расширение словаря детектора | 🟡 СРЕДНИЙ | 📋 Запланирована | Phase 3.0 |
| **3.2** | Отчёт 3.0: категорийная аналитика | 🟡 СРЕДНИЙ | 📋 Запланирована | Phase 3.0 |
| **4.0** | Telegram Mini App | 🔵 НИЗКИЙ | 📋 Будущее | Phase 3.x |

