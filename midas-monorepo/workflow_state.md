# WORKFLOW_STATE.MD тАФ ╨Ф╨╕╤Б╨┐╨╡╤В╤З╨╡╤А ╨╖╨░╨┤╨░╤З ╨Ш╨Ш-╨░╨│╨╡╨╜╤В╨░ Midas

> **╨в╨╕╨┐:** MUTABLE тАФ ╨║╤А╨░╤В╨║╨╛╨▓╤А╨╡╨╝╨╡╨╜╨╜╨░╤П ╨┐╨░╨╝╤П╤В╤М ╨░╨│╨╡╨╜╤В╨░. ╨Ю╨▒╨╜╨╛╨▓╨╗╤П╨╡╤В╤Б╤П ╨╜╨░ ╨║╨░╨╢╨┤╨╛╨╝ ╤И╨░╨│╨╡ ╤А╨░╨▒╨╛╤В╤Л.
> **╨Ю╨▒╨╜╨╛╨▓╨╗╤С╨╜:** 2026-05-20 16:15 (UTC+3)

---

## 1. ТЕКУЩЕЕ СОСТОЯНИЕ

| Параметр | Значение |
|---|---|
| **PHASE** | Phase 3.1-UX: Transfer UI Fixes |
| **STEP** | Сессия 2026-05-21 10:21–10:55 (UTC+3). Исправление Transfer Rich Card навигации, отображения баланса на Success Card, кнопки Отмена, и карточки уточнения для переводов. |
| **AGENT STATUS** | tsc 0 errors. Commits: ae45bae → f3de3a9 → 3229455 → ccc6b79. Pushed to main. Railway auto-deploy triggered. |
| **DEPLOYMENT** | Railway (spirited-happiness) — Midas Online, background-workers Online. Health: https://midas-production-f4f1.up.railway.app/health > ok |
| **DB STATE** | Без изменений. Все миграции применены ✅. account_sources НЕ имеет колонки balance — баланс вычисляется CTE из transactions. |
| **DATABASE_URL (public)** | `postgresql://postgres:PLLSqArtPUoQsAYmvrpsmavfQMewgTRh@hopper.proxy.rlwy.net:46284/railway` |
| **LAST COMPLETED** | (1) fix: Остаток на Success Card в pt:back и pt:rate — SQL CTE JOIN account_sources+transactions. (2) fix: Кнопка Отмена после tx:tf:rate — upsertBotMessage вместо editMsg при from='pt' (Redis midas:am sync). (3) fix: SQL-ошибка pt:back — src.balance::text → CTE bal (колонки balance нет). (4) fix: Clarification card — скрыта «Категория: Другое» для intent=transfer в обоих screen-builder. |
| **BLOCKER** | None. |
| **NEXT ACTION** | 1. Показывать пикер счёта-получателя сразу после распознавания transfer с суммой (вместо стандартной preview-карточки). 2. Phase 3.1 — расширение словаря детектора категорий. 3. Phase 3.2 — Report 3.0 (категорийная аналитика). |


---

## 2. ╨Ч╨Р╨Т╨Х╨а╨и╨Б╨Э╨Э╨л╨Х ╨д╨Р╨Ч╨л

| ╨д╨░╨╖╨░ | ╨б╤В╨░╤В╤Г╤Б | ╨Ъ╨╗╤О╤З╨╡╨▓╤Л╨╡ ╨░╤А╤В╨╡╤Д╨░╨║╤В╤Л |
|---|---|---|
| 0.1 Event Storming | ? | `docs/event_storming_part{1,2,3}.md` |
| 0.2 ADR Generation | ? | `docs/adr/ADR-000` тАФ `ADR-014` (15 ADR) |
| 0.3 Implementation Readiness Gate | ? | `phase1_scope.md`, `database_model_draft.md`, `queue_model.md`, `mvp_acceptance_criteria.md` |
| 0.3.1 Security & Traceability Patch | ? | SEC-01 тАФ SEC-12 ╨▓╨╜╨╡╤Б╨╡╨╜╤Л ╨▓ scope, DB model, queue model, acceptance criteria, ADR-009, ADR-013 |
| 1.1 Project Infrastructure Foundation | ? | `midas-monorepo/` тАФ ╨┐╨╛╨╗╨╜╨░╤П ╤Б╤В╤А╤Г╨║╤В╤Г╤А╨░ Turborepo, Docker Compose, ESLint, TypeScript |
| 1.2 Database Foundation | ? | `packages/database/` тАФ schema, RLS, withTenantTransaction, Decimal boundary |
| 1.3 BullMQ Task Queue Foundation | ? | `apps/background-workers/src/queues/`, `workers/`, `packages/shared/` job types |
| 1.4 Telegram Bot Foundation | ? | `apps/telegram-bot/src/` тАФ Fastify server, SEC-04/05/06/12, webhook route, workspace resolver stub |
| 1.5 User Onboarding & Workspace Resolution | ? | `services/onboarding.service.ts`, `rate-limiter.ts`, `telegram-api.ts`, real `resolveWorkspace()`, `/start` handler |
| 1.6-A AI Parse Pipeline | ? | `packages/ai-core/`, `draft.service.ts`, `ai-parse.worker.ts`, 73/73 smoke tests, commit `7b393d2` |
| 1.6-B HitL Draft Confirmation | ? ACCEPTED | `draft-confirmation.service.ts`, `confirmation.worker.ts`, `callback-confirm-queue.ts`, webhook callback_query handler, 30/30 smoke tests incl. race condition, commit `d49625b` |
| 1.7 Draft Expiration & Lifecycle Cleanup | ? ACCEPTED | `migrations/1777973960000_draft-expiration.js` + `1777973970000_harden-expire-search-path.js` + `1777973980000_fix-expire-function-owner.js`, `draft-expiration.service.ts`, `draft-expiration.worker.ts`, `smoke-test-phase17.mjs` тАФ 20/20 smoke tests PASS, commits `b9069ad`>`49e0cec` |
| 1.8-A Transaction Intent Foundation | ? ACCEPTED | `migrations/1778008338096_transaction-intent.js`, `draft.service.ts` (parsed_intent propagation), `draft-confirmation.service.ts` (intent_missing outcome), `confirmation.worker.ts` (intent_missing messages), `smoke-test-phase18a.mjs` тАФ 19/19 smoke tests PASS, 155/155 total regression PASS, commits `425df61`>`51b6aee` |
| 1.8-B Runtime Consistency & Security Hardening | ? ACCEPTED | C-1: `draft.service.ts` `telegram_user_id`>`telegram_id` fix. C-2: `migrations/1778008400000_harden-onboarding-search-path.js` тАФ `search_path` fixed for 2 SECDEF functions. M-1: `shared/index.ts` `TRANSACTION_TYPE` updated to 5 canonical values. `smoke-test-phase18b.mjs` тАФ 16/16 PASS, 171/171 total regression PASS, commit `7af1692` |
| 1.9 Basic Text /report Command | ? ACCEPTED | `apps/telegram-bot/src/services/report.service.ts`, `apps/telegram-bot/src/routes/webhook.route.ts`, `apps/telegram-bot/src/services/workspace-resolver.ts`, `packages/database/smoke-test-phase19.mjs` тАФ /report command, current UTC month, grouped by transaction_intent, Russian text output тАФ 47/47 Phase 1.9 tests, 218/218 total regression PASS, implementation commit `e060edb`; workflow sync `dffb53e`, `1ec649e`; tag `phase-1.9-accepted`. |
| 1.10 Slash-Command Guard + Inline /help | ? ACCEPTED | `webhook.route.ts` (parseCommandToken, KNOWN_COMMANDS, /help, guard), `smoke-test-phase110.mjs` тАФ 30/30 smoke tests PASS, 248/248 total regression PASS, commit `b321463`, tag `phase-1.10-accepted`. |
| 1.11 /category Read-Only List Command | ? ACCEPTED | `apps/telegram-bot/src/services/category.service.ts` (new), `webhook.route.ts` (KNOWN_COMMANDS, HELP_TEXT, /category handler), `smoke-test-phase111.mjs` тАФ 78/78 Phase 1.11 + 326/326 total regression PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `2e77362`, tag `phase-1.11-accepted` pushed. |
| 1.12 Onboarding Default Data Seeding | ? ACCEPTED | `migrations/1778100000000_onboarding-default-seed.js` + `1778100010000_fix-onboarding-seed-conflict.js` (7-param SECDEF function), `onboarding.service.ts` (candidateAccountId + candidateCategoryId), `smoke-test-phase112.mjs` тАФ 37/37 Phase 1.12 + 363/363 total regression PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `7b87eac`, tag `phase-1.12-accepted` pushed. |
| 1.13 /add_category Strict-Format Command | ? ACCEPTED | `category.service.ts` (`parseAddCategoryArgs`, `resolveGroup`, `addCategory`, `AddCategoryResult`), `webhook.route.ts` (KNOWN_COMMANDS 4>5, HELP_TEXT, handler `5e-add`), `smoke-test-phase113.mjs` тАФ 74/74 Phase 1.13 + 437/437 total regression PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `eac55a9`, tag `phase-1.13-accepted` pushed. |
| 1.14 /accounts Read-Only List Command | ? ACCEPTED | `apps/telegram-bot/src/services/account.service.ts` (new), `webhook.route.ts` (KNOWN_COMMANDS 5>6, HELP_TEXT, handler `5d-acc`), `smoke-test-phase114.mjs` тАФ 70/70 Phase 1.14 + 507/507 total regression PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `362b05b`, tag `phase-1.14-accepted` pushed. Note: HTML escaping for account/category names must be added before user-controlled write paths (/add_account). |
| 1.15 HTML Escaping Hardening | ? ACCEPTED | `apps/telegram-bot/src/utils/html-escape.ts` (NEW), `account.service.ts` (MODIFY), `category.service.ts` (MODIFY), `webhook.route.ts` (MODIFY), `smoke-test-phase115.mjs` (NEW) тАФ 52/52 Phase 1.15 + 559/559 total PASS. Traceability ? Adversarial Security ? Scope Guard ?. Traceability fix: `groupToken` escaped in error message. Implementation commit `4f63a91`; workflow_state sync commit `88ebae3`; test-count fix commit `45b1eec`. Tag `phase-1.15-accepted` pushed. |
| 1.16 account_sources UNIQUE Constraint Migration | ? ACCEPTED | `packages/database/migrations/1778200000000_account-sources-unique-name.js` (NEW), `packages/database/smoke-test-phase116.mjs` (NEW) тАФ UNIQUE(workspace_id, name) added; pre-flight 0 duplicates; 24/24 Phase 1.16 + 583/583 total PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `3ad45e3`. Tag `phase-1.16-accepted` pushed. |
| 1.17 /add_account Strict-Format Command | ? ACCEPTED | `account.service.ts` (MODIFY), `webhook.route.ts` (MODIFY), `smoke-test-phase117.mjs` (NEW) тАФ 27/27 Phase 1.17 + 610/610 total PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `8c370e3`. Tag `phase-1.17-accepted` pushed. |
| 1.18 /report Currency Label (base_currency grouping) | ? ACCEPTED | `report.service.ts` (MODIFY), `smoke-test-phase118.mjs` (NEW), `smoke-test-phase19.mjs` (MODIFY тАФ runReportQuery SQL helper sync) тАФ 34/34 Phase 1.18 + 644/644 total PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `700a244`. Tag `phase-1.18-accepted` pushed. |
| 1.19 account_sources.currency CHECK Constraint | ? ACCEPTED | `packages/database/migrations/1778300000000_account-sources-currency-check.js` (NEW), `packages/database/smoke-test-phase119.mjs` (NEW) тАФ CHECK (currency ~ '^[A-Z]{3,5}$'); pre-flight 0 invalid rows; 24/24 Phase 1.19 + 668/668 total PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `9d288bd`. Tag `phase-1.19-accepted` pushed. |
| 1.20 Balance Semantics Design Document | ? ACCEPTED | `docs/balance-semantics.md` (NEW) тАФ 6 design decisions D1тАУD6 all approved. Formula: income+1/expense?1/debt_given?1/debt_received+1/transfer neutral. initial_balance NUMERIC(19,4) DEFAULT 0 approved (allow negative, account currency implicit, no date). Per-account output, all-time scope. Traceability ? Adversarial Security ? Scope Guard ?. No code. Tag `phase-1.20-accepted` pushed. |
| 1.21 Unified Balance Implementation | ? ACCEPTED | `migrations/1778400000000_account-sources-initial-balance.js` (NEW), `balance.service.ts` (NEW), `webhook.route.ts` (MODIFY тАФ /balance added, KNOWN_COMMANDS 7>8, HELP_TEXT), `smoke-test-phase121.mjs` (NEW). 28/28 Phase 1.21 + 655/655 regression smoke + 13/13 typecheck+lint = 696/696 PASS. Phase 1.5 server-dependent tests excluded from baseline (pre-existing). Tech debt: stale /balance comment in webhook.route.ts line 31 (cosmetic, not blocking). Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `976418a`. Tag `phase-1.21-accepted` pushed. |
| 1.22 Stale Comment Cleanup | ? ACCEPTED | `webhook.route.ts` (MODIFY тАФ comment-only: slash-command routing header updated, all 8 known commands listed, stale тАЬ(e.g. /balance)тАЭ example removed, Phase 1.21 added to phase refs). 0 logic changes. 13/13 typecheck+lint PASS (FULL TURBO). Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `d2ea3fd`. Tag `phase-1.22-accepted` pushed. |
| 1.23 /set_balance Command | ? ACCEPTED | `setBalance.service.ts` (NEW), `webhook.route.ts` (MODIFY). Tag `phase-1.23-accepted` pushed. |
| 1.24 /balance Formatting Polish | ? ACCEPTED | `balance.service.ts` (MODIFY). Tag `phase-1.24-accepted` pushed. |
| 1.25 /settings Text Commands | ? ACCEPTED | `settings.service.ts` (NEW). /settings currency, /settings timezone. Tag `phase-1.25-accepted` pushed. |
| 1.26 /settings UI | ? ACCEPTED | `settings-keyboard.service.ts` (NEW), `currencies.ts` (NEW). Inline keyboards, groups, pagination, Redis search state. 45/45 smoke. Tag `phase-1.26-accepted` pushed. |
| 1.27 Multicurrency Balance Hardening | ? ACCEPTED | `balance.service.ts` (MODIFY). SQL-level mismatch exclusion, mismatch footnote. 27/27 smoke. Tag `phase-1.27-accepted` pushed. |
| 1.28 /edit Transactions MVP | ? ACCEPTED | `edit.service.ts` (NEW), `edit-keyboard.service.ts` (NEW), `webhook.route.ts` (MODIFY), `confirmation.worker.ts` (MODIFY), `smoke-test-phase128.mjs` (NEW). /edit list+card+edit amount/category/account/intent. Permanent [?? ╨Ш╨╖╨╝╨╡╨╜╨╕╤В╤М] on confirmed msgs. Redis TTL 300s. ULID+workspace guards. Strict callback_data ?62 bytes verified. No search/date/delete/soft-delete/GIN, no migrations, no /balance or /report changes. 43/43 Phase 1.28 smoke + 841/841 regression smoke + 13/13 typecheck/lint = 897/897 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit c8bbc7d. Tag `phase-1.28-accepted` pushed. |
| 1.29 Transaction Soft Delete | ? ACCEPTED | `migrations/1778700000000_transactions-soft-delete.js` (NEW). deleted_at TIMESTAMPTZ DEFAULT NULL; soft delete via UPDATE; excluded from /edit, /balance (LEFT JOIN ON), /report, /set_balance; 941/941 gates PASS. Traceability ? Adversarial Security ? Scope Guard ?. impl commit 7082540. Tag `phase-1.29-accepted` pushed. |
| 1.30 Smart Account Onboarding | ? ACCEPTED | `account-onboard-keyboard.service.ts` (NEW), `account.service.ts` (hasAccounts, addAccountWithCurrency), `webhook.route.ts` (MODIFY тАФ ac: callbacks, /start onboarding, /accounts empty-state, text intercept). Redis TTL midas:ac: 300s. 64/64 Phase 1.30 smoke + 318/318 accessible gates PASS. impl commit 4593867. Tag `phase-1.30-accepted` pushed. |
| 1.31 Inline Account Creation | ? ACCEPTED | `migrations/1778800000000_drafts-account-hint.js`, `account-fuzzy.service.ts`, `account-inline-keyboard.service.ts`, `account-resolver.service.ts` (bg-workers), `account.service.ts` (MODIFY), `draft.service.ts` (MODIFY), `ai-parse.worker.ts` (MODIFY), `webhook.route.ts` (MODIFY), `draft-confirmation.service.ts` (MODIFY), `schemas.ts`+`prompts.ts` (MODIFY). Option A: resolve before keyboard. ia: namespace ?62 bytes. 27/27 smoke + 13/13 typecheck/lint PASS. Implementation commit 7c065f7. |
| 1.32 Smart Text Input / Clarification Engine | ? ACCEPTED | `migrations/1778900000000_draft-clarification-state.js` (NEW), `schemas.ts` (amount/intent optional, PARTIAL_CONFIDENCE_THRESHOLD=0.3, MissingField), `claude-client.ts` ('partial' ParseResult, computeMissingFields), `prompts.ts` (partial examples), `draft.service.ts` (patchDraftAmount/Intent/Category), `ai-parse.worker.ts` (targeted clarification messages), `clarification.service.ts` (NEW, telegram-bot), `webhook.route.ts` (clar: callbacks, midas:clar: intercept), `smoke-test-phase132.mjs` (57/57 PASS). 0 lint/typecheck errors. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit e00f37e. Tag `phase-1.32-accepted` pushed. |
| 1.33 Clean Chat / Single Active Message UX | ? ACCEPTED | UX-only phase. `active-message.service.ts` (NEW), `telegram-api.ts` (MODIFY), `shared/index.ts` (MODIFY), `webhook.route.ts` (MODIFY), `notifications.worker.ts` (MODIFY), `confirmation.worker.ts` (MODIFY), `ai-parse.worker.ts` (MODIFY). No migrations, no DB schema changes, no new deps. Redis pointer midas:am:{userId}:{chatId} (TTL 24h). upsertBotMessage() edit-first strategy. 0 typecheck errors. Batch-accepted by owner decision. Commit `36cacd7`. Tag `phase-1.33-accepted` pushed. |
| 1.34 Rich Screen Cards тАФ Single-Screen App UX | ? ACCEPTED | UX-only phase. `screen-builder.ts` (NEW тАФ both apps), confirmation/preview card formatting. No migrations, no DB schema changes, no new deps. 0 typecheck errors. Batch-accepted by owner decision. Commit `6e899f0`. Tag `phase-1.34-accepted` pushed. |
| 1.35 Intelligent Transaction Understanding | ? ACCEPTED | `migrations/1779000000000_intelligent-transactions.js` (NEW), `category-resolver.service.ts` (NEW), `draft.service.ts` (MODIFY), `draft-confirmation.service.ts` (MODIFY), `ai-parse.worker.ts` (MODIFY), `confirmation.worker.ts` (MODIFY), `settings.service.ts`+`settings-keyboard.service.ts` (MODIFY), `webhook.route.ts` (MODIFY), `screen-builder.ts` (MODIFY), `prompts.ts`+`schemas.ts` (MODIFY). smoke-test-phase135.mjs тАФ 55 tests. Deployed to Railway production. |
| 1.36-UX Persistent Navigation Keyboard | ? ACCEPTED | **Sub-steps 1тАУ4 (commits c2f012f > 062d40d):** Core nav keyboard + bug fixes + auto-activation + collapsibility. **FINAL state (commits e879dfc > 2a15f31):** Transaction history workflow fully reworked. |
| 1.37 AI Taxonomy & Zero-Clutter UX | ? ACCEPTED | Zero-clutter UX, 30-category taxonomy, 500+ anchors, multilingual, disambiguation, ALLOWED_CATEGORIES. Commits `5b02cf3` > `641ad26`. |
| 1.38 Currency Input UX Hardening | ? ACCEPTED | `confirmation.worker.ts` (reject in-place edit), `screen-builder.ts` both apps (blockquote design), `webhook.route.ts` (`normalizeCurrencyInput` fix + `awaiting_cur` token extraction). Commits `94b7cac` > `c59f2e1`. |
| 1.39 Gate UX тАФ Edit-In-Place (Variant B) | ? DEPLOYED | `ai-parse.worker.ts` (gate block: one edit-in-place instead of 2 new messages), `screen-builder.ts` both apps (`buildGatePausedPreview`: ?? alert banner + draft summary + keyboard stays). `formatAmount()` hardened: `String()` cast ╨┤╨╗╤П Postgres NUMERIC. `clarification.service.ts`: `::TEXT` cast ╨╜╨░ `parsed_amount`. Commits `8fa8f91` > `089abf6`. |
| 1.40 Dead Card Auto-Cleanup | ? DEPLOYED | `confirmation.worker.ts` (+dead_card write after reject/expired), `draft-expiration.worker.ts` (+dead_card write after CRON expire), `ai-parse.worker.ts` (+dead_card read+delete before new preview). Redis key `midas:dead_card:{chatId}` TTL 24h. Commit `51eaf10`. |
| 2.0 Transaction Hub + Reports 2.0 + Settings 2.0 | ? DEPLOYED | `transaction-list.service.ts` (NEW), `transaction-keyboard.service.ts` (NEW), `report-keyboard.service.ts` (NEW), `settings-keyboard.service.ts` (MODIFY). Interactive paginated lists, period picker, filter tabs, /edit deprecation > tx: namespace. Deployed from GitHub `main`. **[UPD d770ca4]** ╨д╨╕╨╗╤М╤В╤А╤Л: ╨Т╨░╤А╨╕╨░╨╜╤В D тАФ 1 ╤А╤П╨┤ ╨╕╨║╨╛╨╜╨╛╤З╨╜╤Л╤Е ╤З╨╕╨┐╨╛╨▓ `[??][??][??][??][?? ╨Т╤Б╨╡]`. IntentFilter: 5 ╤В╨╕╨┐╨╛╨▓ (e/i/d/t/a), 'd' = merged ╨┤╨╛╨╗╨│╨╕. CCY_SYMBOL + fmtCurrency(). ╨Я╨░╨│╨╕╨╜╨░╤Ж╨╕╤П ┬л?? ╨Я╨╛╨╖╨╢╨╡ ┬╖ ?? X/Y ┬╖ ╨а╨░╨╜╤М╤И╨╡ ??┬╗. |
| 2.1 Account Management Dashboard | ? DEPLOYED | `balance-keyboard.service.ts` (NEW тАФ 450+ lines), `account-onboard-keyboard.service.ts` (MODIFY тАФ bank/wallet presets, fiat/crypto pickers), `account.service.ts` (MODIFY тАФ renameAccount, changeAccountCurrency, softDeleteAccount, deleted_at filters), `balance.service.ts` (MODIFY тАФ getBalanceData, getAccountDetail, setAccountBalanceById, getAccountTxCount), `webhook.route.ts` (MODIFY тАФ bl: handler, text intercepts, balance navigation update). DB migration: `updated_at` + `deleted_at` columns on `account_sources`. |
| 2.2 Settings UI Overhaul | ? DEPLOYED | `settings-keyboard.service.ts` (MODIFY тАФ 6-button 2x3 grid, URL ╨┐╨╛╨┤╨┤╨╡╤А╨╢╨║╨╕, ╨╕╨╜╤Д╨╛ ╨╛ ╨▒╨╛╤В╨╡), `currencies.ts` (MODIFY тАФ Russian aliases, 5-pass search, FIAT 40+ / CRYPTO 48+), `settings.service.ts` (FIX тАФ `deleted_at IS NULL` ╨▓ `getWorkspaceAccounts`), `webhook.route.ts` (MODIFY тАФ ╨║╨╜╨╛╨┐╨║╨░ ╨╜╨░╨╖╨░╨┤ ╨┐╨╛╤Б╨╗╨╡ ╨▓╤Л╨▒╨╛╤А╨░ ╨▓╨░╨╗╤О╤В╤Л, ╨╡╨┤╨╕╨╜╤Л╨╣ Main Account handler). Commit `3e650c1`. |
| 2.3 Search Pagination + UX Polish | ? DEPLOYED | **Pagination:** `transaction-hub.service.ts` (SEARCH_PAGE_SIZE=8, ╨▓╤Б╨╡ 4 search-╨╝╨╡╤В╨╛╨┤╨░ > LIMIT/OFFSET + COUNT(*) = `{items, total}`). `transaction-keyboard.service.ts` (`buildSearchResultsKeyboard(items, page, totalPages)` ╤Б ??/?? ╨╜╨░╨▓╨╕╨│╨░╤Ж╨╕╨╡╨╣, `search_results_page` cmd, tx:sr:p:{page} parser). `webhook.route.ts` (Redis context `midas:tx:sr:ctx:{uid}:{cid}` TTL 600s, `search_results_page` handler, ╨▓╤Б╨╡ text intercepts > paginated API). **Reports close:** `report-keyboard.service.ts` (?? ╨Ч╨░╨║╤А╤Л╤В╤М = `rp:cl` ╨╜╨░ ╨▓╤Б╨╡╤Е 3 ╨║╨╗╨░╨▓╨╕╨░╤В╤Г╤А╨░╤Е, type `close` ╨▓ RpCallbackCmd). `webhook.route.ts` (`rp:close` handler > deleteMessage). **Keyboard order:** `screen-builder.ts` тАФ Row 1: [?? ╨С╨░╨╗╨░╨╜╤Б][?? ╨Ю╤В╤З╤С╤В], Row 2: [?? ╨в╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕][?? ╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕]. Commits `6da4464`, `049233d`, `70a5d41`. |
| 2.3 Onboarding UX Polish | ? DEPLOYED | **╨Э╨╡╤В ╨┐╤А╨╛╨╝╨╡╨╢╤Г╤В╨╛╤З╨╜╨╛╨│╨╛ afterCreate ╤Н╨║╤А╨░╨╜╨░:** ╨┐╨╛╤Б╨╗╨╡ bal_input/bal_skip ╤Б╤А╨░╨╖╤Г ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В╤Б╤П `buildFinishOnboardKeyboard()` + `accountAddedText()`. **╨Э╨╛╨▓╨░╤П ╨║╨╛╨╝╨░╨╜╨┤╨░ `ac:fin`:** ╨║╨╜╨╛╨┐╨║╨░ ┬л? ╨Ч╨░╨▓╨╡╤А╤И╨╕╤В╤М┬╗ ╨▓ ╨┐╨╕╨║╨╡╤А╨╡ ╤В╨╕╨┐╨░ тАФ ╤З╨╕╤Б╤В╨╕╤В Redis, ╤Г╨┤╨░╨╗╤П╨╡╤В ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡, ╨╛╤В╨┐╤А╨░╨▓╨╗╤П╨╡╤В ReplyKeyboard. **Backward compat:** `ac:more` ╨╕ `ac:done` ╨╛╨▒╤А╨░╨▒╨╛╤В╤З╨╕╨║╨╕ ╤Б╨╛╤Е╤А╨░╨╜╨╡╨╜╤Л (╤Б╤В╨░╤А╤Л╨╡ ╨║╨╜╨╛╨┐╨║╨╕ ╨▓ ╤З╨░╤В╨╡). **╨Ш╨║╨╛╨╜╨║╨╕:** `buildStartOnboardKeyboard()` ╨╕╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜: ??>??, ?>??, ??╨Э╨░╨╖╨░╨┤>??╨б╨▓╨╛╤С ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╡. **╨Ф╨╡╤Д╨╛╨╗╤В╨╜╤Л╨╣ ╤Б╤З╤С╤В:** `ac:skip` ╤В╨╕╤Е╨╛ ╤Б╨╛╨╖╨┤╨░╤С╤В ┬л╨Ъ╨╛╤И╨╡╨╗╤С╨║┬╗ (USD) ╨╡╤Б╨╗╨╕ ╤Г ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤П 0 ╤Б╤З╨╡╤В╨╛╨▓. Commit `395e1f2`. Deploy `7089846c` тАФ SUCCESS. |
| Master Roadmap Ph.1 тАФ Keyboard Service | ? DEPLOYED | `account-onboard-keyboard.service.ts` (+478 ╤Б╤В╤А╨╛╨║): `CURRENCY_FLAGS` registry (40+ ╨▓╨░╨╗╤О╤В, ╤Д╨╗╨░╨│╨╕+╤Б╨╕╨╝╨▓╨╛╨╗╤Л: ????RUB ????USD ?BTC ?TH TON ╨╕ ╨┤╤А.), `getCurrencyFlag(code)`, `CURRENCY_NAMES` (╤А╤Г╤Б. ╨╜╨░╨╖╨▓╨░╨╜╨╕╤П). `buildPaginatedPicker()` тАФ ╨▓╤Б╨╡╨│╨┤╨░ 2 ╤Б╤В╤А╨╡╨╗╨║╨╕ ???? (noop ╨╜╨░ ╨║╤А╨░╤П╤Е). `buildCurrencyPickerText(name?,isCustom?)` тАФ 3 ╨▓╨╡╤В╨║╨╕ ╨▓╤Л╨▓╨╛╨┤╨░. `buildFiatCurrencyPage()` + `buildCryptoCurrencyPage()` тАФ ╤Д╨╗╨░╨│╨╛╨▓╤Л╨╡ ╨║╨╜╨╛╨┐╨║╨╕ + `?? ╨Э╨░╨╣╤В╨╕ ╨▓╨░╨╗╤О╤В╤Г` (ac:cur:search). `searchCurrencies(query,pool)` тАФ fuzzy+╤В╤А╨░╨╜╤Б╨╗╨╕╤В╨╡╤А╨░╤Ж╨╕╤П (rub/╤А╤Г╨▒>RUB, dollar/╨┤╨╛╨╗╨╗╨░╤А>USD). `buildNoMatchText(name,type)` + `buildNoMatchKeyboard(name,backTarget)` тАФ ╤Н╨║╤А╨░╨╜ ┬л╨Я╨╛╤Е╨╛╨╢╨╡╨│╨╛ ╨▒╨░╨╜╨║╨░ ╨╜╨╡ ╨╜╨░╤И╨╗╨╕┬╗ ╤Б blockquote, 3 ╨║╨╜╨╛╨┐╨║╨╕. `buildCurrencySearch*` ╤В╨╡╨║╤Б╤В╤Л ╨╕ ╨║╨╗╨░╨▓╨╕╨░╤В╤Г╤А╤Л. ╨г╨┤╨░╨╗╨╡╨╜╤Л ╨╗╨╡╨│╨░╤Б╨╕: `FIAT_ITEMS`, `CRYPTO_ITEMS`, `CURRENCY_PICKER_TEXT`. Commit `35c92e0`. |
| Master Roadmap Ph.2 тАФ Webhook FSM | ? DEPLOYED | `webhook.route.ts`: (1) `name_input` ╨┐╤А╨╕ fuzzy null > `buildNoMatchText`+`buildNoMatchKeyboard`, ╤И╨░╨│ `name_confirm_custom`. (2) `ac:cus:save` > `pendingName` ╨║╨░╨║ `isCustomName=true` > `cur_pick`. (3) `ac:cus:keep` > `name_input` retry. (4) `ac:cur:search` > `cur_search` ╤И╨░╨│ + ╨┐╨╛╨╕╤Б╨║╨╛╨▓╤Л╨╣ ╨┐╤А╨╛╨╝╨┐╤В. (5) `ac:cur:list` > ╨▓╨╛╨╖╨▓╤А╨░╤В ╨║ ╨┐╨░╨│╨╕╨╜╨╕╤А╨╛╨▓╨░╨╜╨╜╨╛╨╝╤Г ╤Б╨┐╨╕╤Б╨║╤Г. (6) `cur_search` text interceptor > `searchCurrencies` > ╤А╨╡╨╖╤Г╨╗╤М╤В╨░╤В╤Л/no-results. (7) 3 success-screens: `{ inline_keyboard: [] }` (╨▒╨╡╨╖ ╨║╨╜╨╛╨┐╨╛╨║). `chooseCurKeyboard()` тАФ module-level helper. ╨Т╤Б╨╡ callback_data ?64 ╨▒╨░╨╣╤В. Commit `35c92e0`. |
| 2.9 Nav Buttons Never Delete Tx Records | ? DEPLOYED | `active-message.service.ts` (NEW `sendNavMessage()` тАФ always sends new message), `webhook.route.ts` (4 NAV_BTN_* handlers: NAV_BTN_BALANCE/REPORT/SETTINGS/TRANSACTIONS > `sendNavMessage`). Commit `1477f55`. |
| 2.9+ Smart Nav Message (midas:nav: key) | ? DEPLOYED | `active-message.service.ts` (╨┐╨╛╨╗╨╜╨░╤П ╨┐╨╡╤А╨╡╤А╨░╨▒╨╛╤В╨║╨░ `sendNavMessage()` тАФ edit-first ╤З╨╡╤А╨╡╨╖ `midas:nav:`, ╨╜╨╡ ╤В╤А╨╛╨│╨░╨╡╤В `midas:am:`; ╨╜╨╛╨▓╤Л╨╡ ╤Д╤Г╨╜╨║╤Ж╨╕╨╕ `getNavMessageId`, `setNavMessageId`, `clearNavMessageId`). `webhook.route.ts` (╨╕╨╝╨┐╨╛╤А╤В 2 ╨╜╨╛╨▓╤Л╤Е ╤Д╤Г╨╜╨║╤Ж╨╕╨╣; AI-parse path тАФ cleanup `midas:nav:` ╨┐╨╡╤А╨╡╨┤ ╤Б╤В╨░╨╜╨┤╨░╤А╤В╨╜╤Л╨╝ `midas:am:` cleanup; `st:cancel` тАФ silently deletes ╨▓╨╝╨╡╤Б╤В╨╛ ╤А╨╡╨┤╨░╨║╤В╨╕╤А╨╛╨▓╨░╨╜╨╕╤П; `bl:close` тАФ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜ `clearNavMessageId`). Commits `4baac9c` > `004966f`. |
| 2.10 Transaction UI Persistence & Navigation Fixes | ? DEPLOYED | **╨в╤А╨╕ ╨╜╨╡╨╖╨░╨▓╨╕╤Б╨╕╨╝╤Л╤Е ╤Д╨╕╨║╤Б╨░:** (1) `notifications.worker.ts` + `confirmation.worker.ts` + `shared/index.ts` тАФ `isSuccessCard?: boolean` ╤Д╨╗╨░╨│; ╨┐╤А╨╕ approve DEL `midas:am:` ╨▓╨╝╨╡╤Б╤В╨╛ SET (commit `df15a01`). (2) `transaction-keyboard.service.ts` тАФ `parseTxCallback`: ╤В╨╡╨┐╨╡╤А╤М ╤З╨╕╤В╨░╨╡╤В `parts[4]` ╨║╨░╨║ `from` ╨┤╨╗╤П `tx:d:ask` ╨╕ `tx:d:yes` тАФ ╨║╨╛╨╜╤В╨╡╨║╤Б╤В `:s` ╨┐╨╡╤А╨╡╨┤╨░╤С╤В╤Б╤П ╤З╨╡╤А╨╡╨╖ ╨▓╨╡╤Б╤М delete flow; ╨║╨╜╨╛╨┐╨║╨░ ┬л╨Ч╨░╨║╤А╤Л╤В╤М┬╗ ╨▓ tx:view ╨║╨╛╤А╤А╨╡╨║╤В╨╜╨╛ ╨▓╨╛╨╖╨▓╤А╨░╤Й╨░╨╡╤В ╨╜╨░ success card (commit `8894b92`). (3) `notifications.worker.ts` тАФ ╨╖╨░╨┐╨╕╤Б╤М sentinel `midas:success_card:{msgId}` (TTL 30 ╨┤╨╜╨╡╨╣) ╨┐╤А╨╕ `isSuccessCard=true`; `webhook.route.ts` step-7 тАФ ╨┐╤А╨╛╨▓╨╡╤А╤П╨╡╤В `EXISTS midas:success_card:{amId}` ╨┐╨╡╤А╨╡╨┤ `deleteMessage` тАФ ╨┤╨▓╨╛╨╣╨╜╨░╤П ╨▒╨╗╨╛╨║╨╕╤А╨╛╨▓╨║╨░ ╤Г╨┤╨░╨╗╨╡╨╜╨╕╤П (commit `b869c03`). |
| Balance Phase A тАФ Grouped UI | ? DEPLOYED | `balance-keyboard.service.ts` (NEW: `classifyAccountGroup`, `GROUP_EMOJI`, `GROUP_ORDER`, `GroupType`, `buildBalanceListKeyboard` ╤Б emoji-╨┐╤А╨╡╤Д╨╕╨║╤Б╨░╨╝╨╕ ╨┐╨╛ ╨│╤А╤Г╨┐╨┐╨░╨╝, `export formatBalanceShort`). `balance.service.ts` (MODIFY: ╤Б╨╡╨║╤Ж╨╕╨╛╨╜╨╕╤А╨╛╨▓╨░╨╜╨╜╤Л╨╣ ╤В╨╡╨║╤Б╤В ??/??/??/??/??, ╤Г╨┤╨░╨╗╤С╨╜ `CURRENCY_TOTALS_SQL`). Commit `4a1748c` pushed to main. Railway auto-deploy ?. |
| Balance Phase B-1 тАФ DB Schema | ? DEPLOYED | `packages/database/migrations/1779800000000_account-parent-and-subtype.js` (NEW). `account_sources`: `parent_account_id VARCHAR(26) FK REFERENCES account_sources(id) ON DELETE CASCADE` (NULL=top-level), `sub_type TEXT NOT NULL DEFAULT 'general'` CHECK constraint. Partial index `idx_account_sources_parent`. Applied on Railway live DB via `node-pg-migrate up --check-order false`. Commit `75156b9`. 100% ╨░╤Г╨┤╨╕╤В: formula ? FK 31/31 ? defaults safe ? |
| Balance Phase B-2 тАФ Hierarchical UI | ? DEPLOYED | `balance.service.ts` (MODIFY): `PER_ACCOUNT_SQL` + `parent_account_id`; `AccountBalanceRow` + `parentAccountId`; `getBalanceData()` builds childrenMap, renders +/L ladder for parent>children, leaf accounts unchanged. `balance-keyboard.service.ts` (MODIFY): `BalanceAccountRow` + `parentAccountId?`+`childCount?`; `BalanceCallbackCmd` + `add_currency`; `parseBalanceCallback` handles `bl:ac:{id}`; `pluralizeCurrency()` RU plural; `buildBalanceListKeyboard()` тАФ parent aggregation (N ╨▓╨░╨╗╤О╤В) + indented child rows (L CURRENCY ┬╖ balance) + ? ╨Ф╨╛╨▒╨░╨▓╨╕╤В╤М ╨▓╨░╨╗╤О╤В╤Г (bl:ac:{parentId} ?32 bytes). tsc 0 errors. Commit `d04bcba`. |
| 2.10+ Gate Fix тАФ Frozen UI on Concurrent Input | ? DEPLOYED | **╨Я╤А╨╛╨▒╨╗╨╡╨╝╨░:** ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨┐╨╕╤И╨╡╤В TX1 (╨┐╨╕╨║╨╡╤А ╤Б╤З╤С╤В╨░ ╨╛╤В╨║╤А╤Л╤В), TX2 > step-7 ╤Г╨┤╨░╨╗╤П╨╡╤В ╨┐╨╕╨║╨╡╤А ╨┤╨╛ ╤В╨╛╨│╨╛ ╨║╨░╨║ gate ╤Г╤Б╤В╨░╨╜╨╛╨▓╨╕╤В `gate_sent` > gate ╨┐╤А╨╕╤Б╤Л╨╗╨░╨╡╤В ╨╜╨╛╨▓╤Г╤О ╨║╨░╤А╤В╨╛╤З╨║╤Г. TX3 > step-7 ╤Б╨╜╨╛╨▓╨░ ╤Г╨┤╨░╨╗╤П╨╡╤В gate-╨║╨░╤А╤В╨╛╤З╨║╤Г (gate_sent ╨Э╨Х ╨┐╤А╨╛╨▓╨╡╤А╤П╨╗╤Б╤П) > ai-parse ╨╝╨╛╨╗╤З╨╕╤В (gate_sent ╤Г╤Б╤В╨░╨╜╨╛╨▓╨╗╨╡╨╜) > UI ╨╖╨░╨▓╨╕╤Б╨░╨╡╤В. **╨д╨╕╨║╤Б 1:** `webhook.route.ts` step-7 ╤Б╤В╤А╨╛╨║╨╕ 5446тАУ5458 тАФ `EXISTS midas:gate_sent:` ╨┐╨╡╤А╨╡╨┤ deleteMessage; ╨╡╤Б╨╗╨╕ ╨░╨║╤В╨╕╨▓╨╡╨╜ тАФ ╨║╨░╤А╤В╨╛╤З╨║╨░ ╨╕ `midas:am:` ╨╜╨╡ ╤В╤А╨╛╨│╨░╤О╤В╤Б╤П. **╨д╨╕╨║╤Б 2:** `webhook.route.ts` ia:pk: ╤Б╤В╤А╨╛╨║╨░ 1539 тАФ `DEL midas:gate_sent:` ╨┐╨╛╤Б╨╗╨╡ ╨▓╤Л╨▒╨╛╤А╨░ ╤Б╤З╤С╤В╨░ > ╨╜╨╛╤А╨╝╨░╨╗╤М╨╜╤Л╨╣ flow ╨▓╨╛╤Б╤Б╤В╨░╨╜╨░╨▓╨╗╨╕╨▓╨░╨╡╤В╤Б╤П. **╨д╨╕╨║╤Б 3:** `ai-parse.worker.ts` тАФ gate ╤А╨╡╨║╨╛╨╜╤Б╤В╤А╤Г╨╕╤А╤Г╨╡╤В ╨┐╨╛╨╗╨╜╤Л╨╣ ╨┐╨╕╨║╨╡╤А ╤Б╤З╨╡╤В╨╛╨▓ ╨║╨╛╨│╨┤╨░ `accountId = null`. **╨Ц╨╕╨╖╨╜╨╡╨╜╨╜╤Л╨╣ ╤Ж╨╕╨║╨╗ gate_sent:** SET ╨▓ ai-parse > DEL ╨┐╤А╨╕ ia:cancel (╤Б╤В╤А╨╛╨║╨░ 1432, ╨┤╨╛ ╤Д╨╕╨║╤Б╨░) / ia:pk: (╤Б╤В╤А╨╛╨║╨░ 1539, ╨Э╨Ю╨Т╨Ю╨Х) / approve/reject ╨▓ confirmation.worker (╤Б╤В╤А╨╛╨║╨░ 268, ╨┤╨╛ ╤Д╨╕╨║╤Б╨░) / TTL 1h. Commit `8d25ec1`. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. Railway ? ╨╛╨▒╨░ ╤Б╨╡╤А╨▓╨╕╤Б╨░ Online. |

| Phase 3.1+ DB Bugfixes | ✅ DEPLOYED | **Сессия 2026-05-20 13:00–16:00.** (1) Миграция `1780400000000_transfer-group-id-text`: `transfer_group_id UUID→TEXT` + пересоздан индекс. Применена вручную через public proxy URL. (2) Миграция `1780200000000_draft-current-screen`: добавлена колонка `current_screen TEXT` в `transaction_drafts` (была пропущена при деплое). (3) Миграция `1780100000000_reminder-fn-add-account`: обновлена функция reminder. (4) `draft-confirmation.service.ts`: убраны `::UUID` касты от `$9` и `$8`. (5) `apps/background-workers/src/migrate.ts`: авто-миграции при старте background-workers (Step 0 перед CRON). **DB проверено:** transfer_group_id=text ✅ current_screen=text ✅. PUBLIC DATABASE_URL: `postgresql://postgres:PLLSqArtPUoQsAYmvrpsmavfQMewgTRh@hopper.proxy.rlwy.net:46284/railway` |
| Phase 3.1-UX Transfer UI Fixes | ✅ DEPLOYED | **Сессия 2026-05-21 10:21–10:55 (UTC+3). Commits: ae45bae → f3de3a9 → 3229455 → ccc6b79.** **(1)** `webhook.route.ts` pt:back + pt:rate SQL: баланс теперь вычисляется через CTE (`WITH bal AS (SELECT a.id, COALESCE(a.initial_balance,0) + SUM(income/inbound) - SUM(expense/outbound) FROM account_sources a LEFT JOIN transactions t ...)`). `account_sources` НЕ имеет колонки `balance` — без CTE SQL бросал ошибку «column does not exist» (6 раз `[midas:pt] handler error`). **(2)** `webhook.route.ts` tx:tf:rate text interceptor (строка ~7006): при `tfFrom==='pt'` карточка после обновления курса показывается через `upsertBotMessage` (не `editMsg`), чтобы Redis `midas:am:{chatId}` оставался в sync — иначе `pt:back` редактировал не то сообщение и кнопка Отмена «не нажималась». **(3)** `webhook.route.ts` pt:back handler + pt:rate interceptor: Success Card теперь включает `Остаток: X CUR` для обоих счетов (src + tgt), получается тем же CTE. **(4)** `screen-builder.ts` (обе копии — telegram-bot + background-workers): `buildClarificationScreen` — добавлено условие `data.intent !== 'transfer'` перед строкой «Категория: ...»; для переводов категория не показывается (там всегда «Другое» — технический плейсхолдер). **Transfer Rich Card nav flow:** Success Card → pt:edit → Transfer Rich Card → [📈 Изм.курс → ввод → ✅ Курс обновлён + Rich Card] → Отмена → Success Card. |

---

## 3. ╨Я╨а╨Ш╨Э╨п╨в╨л╨Х ╨Р╨а╨е╨Ш╨в╨Х╨Ъ╨в╨г╨а╨Э╨л╨Х ╨а╨Х╨и╨Х╨Э╨Ш╨п

- **Runtime:** Node.js 24 + TypeScript (ADR-001). Python тАФ ╤В╨╛╨╗╤М╨║╨╛ ╨╕╨╖╨╛╨╗╨╕╤А╨╛╨▓╨░╨╜╨╜╤Л╨╣ ╨╝╨╕╨║╤А╨╛╤Б╨╡╤А╨▓╨╕╤Б ╨┐╨╛╨╖╨╢╨╡.
- **Frontend (future):** React 19 + Vite 8. Vue ╨╛╤В╨║╨╗╨╛╨╜╤С╨╜ (ADR-002).
- **Workspace:** MVP = 1 default workspace ╨╜╨░ ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤П. ╨С╨Ф multi-workspace-ready ╤Б ╨┐╨╡╤А╨▓╨╛╨│╨╛ ╨┤╨╜╤П (ADR-003).
- **Auth:** WorkspaceMembership required. Telegram User ID = ╨╕╨┤╨╡╨╜╤В╨╕╤Д╨╕╨║╨░╤В╨╛╤А.
- **Primary Keys:** ULID (ADR-004).
- **DB Isolation:** PostgreSQL RLS. Low-privilege DB role. `BYPASSRLS` ╨╖╨░╨┐╤А╨╡╤Й╤С╨╜.
- **Tenant Context:** `SET LOCAL app.workspace_id` ╤В╨╛╨╗╤М╨║╨╛ ╨▓╨╜╤Г╤В╤А╨╕ `withTenantTransaction(workspaceId, fn)` (SEC-03).
- **Queue:** BullMQ (Redis-backed) (ADR-014).
- **Financial Precision:** Decimal / NUMERIC only. `Number`, `parseFloat`, `Number()`, float arithmetic ╨╖╨░╨┐╤А╨╡╤Й╨╡╨╜╤Л (SEC-02).
- **AI Output:** Strict Zod allowlist. AI ╨╜╨╡ ╨╝╨╛╨╢╨╡╤В ╨▓╨╛╨╖╨▓╤А╨░╤Й╨░╤В╤М/╨║╨╛╨╜╤В╤А╨╛╨╗╨╕╤А╨╛╨▓╨░╤В╤М ╤Б╨╕╤Б╤В╨╡╨╝╨╜╤Л╨╡ ╨┐╨╛╨╗╤П (SEC-01).
- **Draft Lifecycle:** TransactionDraft > pending_user > approved/rejected/expired/needs_clarification.
- **Security:** SEC-01 тАФ SEC-12 ╨╛╨▒╤П╨╖╨░╤В╨╡╨╗╤М╨╜╤Л ╨┤╨╗╤П Phase 1.
- **AI Pipeline (claude-client.ts + prompts.ts):**
  - ╨Ь╨╛╨┤╨╡╨╗╤М: `claude-haiku-4-5`, `temperature: 0` (╨┤╨╡╤В╨╡╤А╨╝╨╕╨╜╨╕╨╖╨╝), `max_tokens: 256`
  - System prompt: OUTPUT RULES > MULTILINGUAL RECOGNITION (RU/EN/UA) > FUZZY MATCHING (╨╛╨┐╨╡╤З╨░╤В╨║╨╕, ╤Б╨╗╨╡╨╜╨│, ╤В╤А╨░╨╜╤Б╨╗╨╕╤В╨╡╤А╨░╤Ж╨╕╤П) > BILINGUAL PAIRS (╨╜╨╡╨╛╤З╨╡╨▓╨╕╨┤╨╜╤Л╨╡ ╨┐╨╡╤А╨╡╨▓╨╛╨┤╤Л) > DISAMBIGUATION RULES (15 ╨┐╤А╨░╨▓╨╕╨╗ ╨┤╨╗╤П ╨┤╨▓╤Г╤Б╨╝╤Л╤Б╨╗╨╡╨╜╨╜╤Л╤Е ╤В╨╛╨▓╨░╤А╨╛╨▓) > COMPOUND EXPRESSIONS > DEFAULT INTENT PRIORITY > 30-╨║╨░╤В╨╡╨│╨╛╤А╨╕╨╣╨╜╨░╤П ╤В╨░╨║╤Б╨╛╨╜╨╛╨╝╨╕╤П (18 personal + 12 business) ? 500+ ╤П╨║╨╛╤А╨╜╤Л╤Е ╤В╨╛╨▓╨░╤А╨╛╨▓/╤Г╤Б╨╗╤Г╨│/╨▒╤А╨╡╨╜╨┤╨╛╨▓ (╨б╨Э╨У/EU/US) > RUSSIAN LANGUAGE RULES (50+ ╨│╨╗╨░╨│╨╛╨╗╨╛╨▓ ╤А╨░╤Б╤Е╨╛╨┤╨░/╨┤╨╛╤Е╨╛╨┤╨░) > CATEGORY>INTENT defaults > 25+ ╨┐╤А╨╕╨╝╨╡╤А╨╛╨▓ (╨▓╤Б╨╡ 5 intent-╤В╨╕╨┐╨╛╨▓ + partial + nonsense)
  - Markdown fence strip: Claude ╨╕╨╜╨╛╨│╨┤╨░ ╨╛╨▒╨╛╤А╨░╤З╨╕╨▓╨░╨╡╤В JSON ╨▓ ` ```json `, ╨┐╨░╤А╤Б╨╡╤А ╤Н╤В╨╛ ╤Г╨▒╨╕╤А╨░╨╡╤В ╨┐╨╡╤А╨╡╨┤ `JSON.parse`
  - Zod validation: strict allowlist тАФ intent/amount/currency/category_hint/person_hint/account_hint/item_hint/note/confidence
  - **Category validation (Phase 1.37):** `ALLOWED_CATEGORIES` Set тАФ ╨╡╤Б╨╗╨╕ Claude ╨▓╨╡╤А╨╜╤Г╨╗ `category_hint` ╨╜╨╡ ╨╕╨╖ ╨┤╨╛╨┐╤Г╤Б╤В╨╕╨╝╨╛╨│╨╛ ╤Б╨┐╨╕╤Б╨║╨░, ╨╖╨░╨╝╨╡╨╜╤П╨╡╤В╤Б╤П ╨╜╨░ `╨Ф╤А╤Г╨│╨╛╨╡`
  - Post-processing (safety net, ╨Я╨Ю╨б╨Ы╨Х Claude): 7 ╨│╤А╤Г╨┐╨┐ regex ╤Б word-boundary `\b`, negation guard, confidence boost (+0.15/+0.25), intent fallback
  - ╨а╨╡╨╖╤Г╨╗╤М╤В╨░╤В: `ok` | `partial` (missing fields) | `needs_clarification` (nonsense) | `rejected`
  - **Phase 1.35:** `item_hint` (extracted product/merchant name), `category_hint` (AI category suggestion) > `CategoryResolverService` (3-stage: exact > 200+ alias map > fallback ┬л╨Ф╤А╤Г╨│╨╛╨╡┬╗)
  - **Phase 1.37:** Zero-clutter UX, ╨╝╤Г╨╗╤М╤В╨╕╤П╨╖╤Л╤З╨╜╨░╤П ╤В╨░╨║╤Б╨╛╨╜╨╛╨╝╨╕╤П, ╨┤╨╕╤Б╨░╨╝╨▒╨╕╨│╤Г╨░╤Ж╨╕╤П, ╤Б╤В╤А╨╛╨│╨░╤П ╨▓╨░╨╗╨╕╨┤╨░╤Ж╨╕╤П ╨║╨░╤В╨╡╨│╨╛╤А╨╕╨╣
- **Deployment:** Railway (spirited-happiness) тАФ Midas bot + background-workers + Postgres + Redis. Auto-deploy from GitHub main.
- **UX Architecture (Phase 1.33тАУ1.36-UX) тАФ ╨д╨Ш╨Э╨Р╨Ы╨м╨Э╨Ю╨Х ╨а╨Р╨С╨Ю╨з╨Х╨Х ╨б╨Ю╨б╨в╨Ю╨п╨Э╨Ш╨Х:**
  - Rich Screen Cards: `screen-builder.ts` pure functions > buildPreviewScreen, buildConfirmedScreen, buildClarificationScreen
  - Centralized confirmKb/confirmPreview helpers (DRY, 8 entry points)
  - Post-confirm card: `[?? ╨Ш╨╖╨╝╨╡╨╜╨╕╤В╤М ╨╖╨░╨┐╨╕╤Б╤М]` only тАФ nav buttons removed (handled by Reply Keyboard)
  - **Persistent Navigation:** `ReplyKeyboardMarkup` (`is_persistent: false`, `resize_keyboard: true`) тАФ 2?2 grid: Row 1 `[?? ╨С╨░╨╗╨░╨╜╤Б][?? ╨Ю╤В╤З╤С╤В]`, Row 2 `[?? ╨в╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕][?? ╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕]`. Sent on `/start`. NAV_BTN_* intercepted before AI parse. **(Phase 2.3: ╨Ю╤В╤З╤С╤В ╨╕ ╨в╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕ ╨┐╨╛╨╝╨╡╨╜╤П╨╜╤Л ╨╝╨╡╤Б╤В╨░╨╝╨╕ тАФ ╨Ю╤В╤З╤С╤В ╤В╨╡╨┐╨╡╤А╤М ╨▓╨▓╨╡╤А╤Е╤Г ╤Б╨┐╤А╨░╨▓╨░)**
  - **Transaction Hub Filter Row (Variant D тАФ ╨░╨║╤В╤Г╨░╨╗╤М╨╜╨╛):** 1 ╤Б╤В╤А╨╛╨║╨░ ? 5 ╨╕╨║╨╛╨╜╨╛╤З╨╜╤Л╤Е ╨║╨╜╨╛╨┐╨╛╨║-╤З╨╕╨┐╨╛╨▓: `[??]` ╤А╨░╤Б╤Е╨╛╨┤╤Л ┬╖ `[??]` ╨┤╨╛╤Е╨╛╨┤╤Л ┬╖ `[??]` ╨┤╨╛╨╗╨│╨╕ (merged) ┬╖ `[??]` ╨┐╨╡╤А╨╡╨▓╨╛╨┤╤Л ┬╖ `[?? ╨Т╤Б╨╡]`. ╨Р╨║╤В╨╕╨▓╨╜╤Л╨╣ ╤Д╨╕╨╗╤М╤В╤А: `emoji + ' ?'`. ╨Э╨░╨╢╨░╤В╨╕╨╡ ╨╜╨░ ╨░╨║╤В╨╕╨▓╨╜╤Л╨╣ (╨╜╨╡ ┬л╨Т╤Б╨╡┬╗) ╤Б╨╜╨╕╨╝╨░╨╡╤В ╤Д╨╕╨╗╤М╤В╤А > ╨▓╨╛╨╖╨▓╤А╨░╤В ╨║ 'a'. SQL: `'d' AND intent IN ('debt_given','debt_received')`. ╨Я╨░╨│╨╕╨╜╨░╤Ж╨╕╤П: `[?? ╨Я╨╛╨╖╨╢╨╡]  [?? X / Y]  [╨а╨░╨╜╤М╤И╨╡ ??]`. IntentFilter: `'a' | 'e' | 'i' | 'd' | 't'`. Backward compat: `dg`/`dr` > `'d'`.
  - **Keyboard Carrier:** Greeting message `? ╨Т╤Л ╤Г╨╢╨╡ ╨╖╨░╤А╨╡╨│╨╕╤Б╤В╤А╨╕╤А╨╛╨▓╨░╨╜╤Л...` ╨╛╤Б╤В╨░╤С╤В╤Б╤П ╨▓ ╤З╨░╤В╨╡ **╨╜╨░╨▓╤Б╨╡╨│╨┤╨░** тАФ ╤П╨▓╨╗╤П╨╡╤В╤Б╤П ╨┐╨╛╤Б╤В╨╛╤П╨╜╨╜╤Л╨╝ ╨╜╨╛╤Б╨╕╤В╨╡╨╗╨╡╨╝ ReplyKeyboardMarkup. ╨Э╨╡ ╤Г╨┤╨░╨╗╤П╨╡╤В╤Б╤П ╨╜╨╕ ╨┐╤А╨╕ ╨║╨░╨║╨╕╤Е ╤Г╤Б╨╗╨╛╨▓╨╕╤П╤Е.
  - **Transaction History (FINAL):** ╨Ъ╨░╨╢╨┤╨░╤П preview-╨║╨░╤А╤В╨╛╤З╨║╨░ тАФ ╤Н╤В╨╛ **╨╜╨╛╨▓╨╛╨╡** ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ (`sendMessage`), `activeMessageId` ╨Э╨Х ╨┐╨╡╤А╨╡╨┤╨░╤С╤В╤Б╤П ╨╕╨╖ `ai-parse.worker`. ╨Ш╤Б╤В╨╛╤А╨╕╤П ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╣ ╨╜╨░╨║╨░╨┐╨╗╨╕╨▓╨░╨╡╤В╤Б╤П ╨▓ ╤З╨░╤В╨╡. ╨б╤В╨░╤А╤Л╨╣ ╨╝╨╡╤Е╨░╨╜╨╕╨╖╨╝ `midas:am:{userId}:{chatId}` (active-message pointer) **╤Г╨┤╨░╨╗╤С╨╜** ╨╕╨╖ notifications.worker.
  - **Preview>Confirmed Edit:** ╨Я╤А╨╕ approve `confirmation.worker` ╤З╨╕╤В╨░╨╡╤В `midas:preview:{draftId}` (TTL 600s) тАФ message_id preview-╨║╨░╤А╤В╨╛╤З╨║╨╕, ╨╖╨░╨┐╨╕╤Б╨░╨╜╨╜╤Л╨╣ `notifications.worker` ╨┐╤А╨╕ ╨╛╤В╨┐╤А╨░╨▓╨║╨╡. Approve > `editMessageText(previewMsgId, confirmedText, inlineKeyboard)`. Reject > `editMessageText(previewMsgId, ? ╨Ю╤В╨╝╨╡╨╜╨╡╨╜╨╛)` (Phase 1.38 fix).
  - **Redis Keys (╨░╨║╤В╤Г╨░╨╗╤М╨╜╤Л╨╡):**
    - `midas:preview:{draftId}` тАФ message_id preview-╨║╨░╤А╤В╨╛╤З╨║╨╕, TTL 600s. ╨Ч╨░╨┐╨╕╤Б╤Л╨▓╨░╨╡╤В notifications.worker. ╨з╨╕╤В╨░╨╡╤В ╨╕ ╤Г╨┤╨░╨╗╤П╨╡╤В confirmation.worker ╨╜╨░ approve ╨╕ reject.
    - `midas:greet:{userId}:{chatId}` тАФ ╤Б╨╛╤Е╤А╨░╨╜╤П╨╡╤В╤Б╤П ╨▓ /start handler, ╨╜╨╛ ╨Э╨Ш╨Ъ╨Ю╨У╨Ф╨Р ╨╜╨╡ ╨╕╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╡╤В╤Б╤П ╨┤╨╗╤П ╤Г╨┤╨░╨╗╨╡╨╜╨╕╤П (╨║╨╛╨┤ ╨╛╤Б╤В╨░╨▓╨╗╨╡╨╜ ╨║╨░╨║ ╨░╤А╤В╨╡╤Д╨░╨║╤В, ╨▒╨╡╨╖╨▓╤А╨╡╨┤╨╡╨╜).
    - `midas:clar:{userId}:{chatId}` тАФ intercept ╨┤╨╗╤П ╨▓╨▓╨╛╨┤╨░ ╤Б╤Г╨╝╨╝╤Л ╨┐╤А╨╕ clarification. ╨г╨┤╨░╨╗╤П╨╡╤В╤Б╤П ╨╜╨░ confirm/reject (race condition fix).
    - `midas:clar:msg:{userId}:{chatId}` тАФ message_id nonsense-╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╤П. ╨г╨┤╨░╨╗╤П╨╡╤В╤Б╤П ╨┐╤А╨╕ ╤Б╨╗╨╡╨┤╤Г╤О╤Й╨╡╨╝ ╤Г╤Б╨┐╨╡╤И╨╜╨╛╨╝ ╨┐╨░╤А╤Б╨╡.
    - `midas:ac:{userId}:{chatId}` тАФ account onboarding state, TTL 300s.
    - `midas:edit:{userId}:{chatId}` тАФ edit amount intercept, TTL 300s.
    - `midas:awaiting_cur:{chatId}` тАФ TTL 600s. ╨б╨╛╨╖╨┤╨░╤С╤В╤Б╤П ╨║╨╛╨│╨┤╨░ ╨╡╤Б╤В╤М ╤Б╤Г╨╝╨╝╨░ ╨╜╨╛ ╨╜╨╡╤В ╨▓╨░╨╗╤О╤В╤Л ╨╕ ╨╜╨╡╤В `cur_set`. ╨е╤А╨░╨╜╨╕╤В `{draftId}:{workspaceId}:{userId}`. Webhook ╤З╨╕╤В╨░╨╡╤В ╨┤╨╗╤П intercept ╨▓╨▓╨╛╨┤╨░ ╨▓╨░╨╗╤О╤В╤Л.
    - `midas:cur_set:{workspaceId}` тАФ ╤Д╨╗╨░╨│ ╤В╨╛╨│╨╛, ╤З╤В╨╛ ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╤Г╤Б╤В╨░╨╜╨╛╨▓╨╕╨╗ ╨▒╨░╨╖╨╛╨▓╤Г╤О ╨▓╨░╨╗╤О╤В╤Г ╨▓ ╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨░╤Е. ╨Х╤Б╨╗╨╕ ╨╡╤Б╤В╤М тАФ ╨▓╨░╨╗╤О╤В╨░ ╨╜╨╡ ╨╖╨░╨┐╤А╨░╤И╨╕╨▓╨░╨╡╤В╤Б╤П.
    - `midas:gate_sent:{telegramUserId}:{chatId}` тАФ ╤Д╨╗╨░╨│ ╤З╤В╨╛ gate ╤Г╨╢╨╡ ╤Б╤А╨░╨▒╨╛╤В╨░╨╗ (TTL 1h). ╨Я╤А╨╡╨┤╨╛╤В╨▓╤А╨░╤Й╨░╨╡╤В ╨┐╨╛╨▓╤В╨╛╤А╨╜╤Л╨╣ edit ╨┐╤А╨╕ ╨║╨░╨╢╨┤╨╛╨╝ ╨╜╨╛╨▓╨╛╨╝ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╕.
    - `midas:dead_card:{chatId}` тАФ message_id ╨║╨░╤А╤В╨╛╤З╨║╨╕ "? ╨Ю╤В╨╝╨╡╨╜╨╡╨╜╨╛" ╨╕╨╗╨╕ "? ╨з╨╡╤А╨╜╨╛╨▓╨╕╨║ ╨╕╤Б╤В╤С╨║", TTL 24h. ╨Ч╨░╨┐╨╕╤Б╤Л╨▓╨░╨╡╤В╤Б╤П confirmation.worker (reject/expired) ╨╕ draft-expiration.worker (CRON expire). ╨з╨╕╤В╨░╨╡╤В╤Б╤П ╨╕ ╤Г╨┤╨░╨╗╤П╨╡╤В╤Б╤П ai-parse.worker ╨┐╤А╨╕ ╨╛╤В╨┐╤А╨░╨▓╨║╨╡ ╤Б╨╗╨╡╨┤╤Г╤О╤Й╨╡╨╣ preview тАФ ╨║╨░╤А╤В╨╛╤З╨║╨░ ╨░╨▓╤В╨╛╨╝╨░╤В╨╕╤З╨╡╤Б╨║╨╕ ╤Г╨┤╨░╨╗╤П╨╡╤В╤Б╤П ╨╕╨╖ ╤З╨░╤В╨░. (Phase 1.40)
     - `midas:am:{userId}:{chatId}` тАФ Phase 2.10: pointer ╨╜╨░ ╤В╨╡╨║╤Г╤Й╨╡╨╡ ╨░╨║╤В╨╕╨▓╨╜╨╛╨╡ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ (╤З╨╡╤А╨╜╨╛╨▓╨╕╨║╨╕, ╨┐╨╕╨║╨╡╤А╤Л ╤Б╤З╤С╤В╨╛╨▓, clarification). TTL 24h. ╨Я╤А╨╕ approve ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕ тАФ DEL (╨╜╨╡ SET, ╤З╤В╨╛╨▒╤Л success card ╨╜╨╡ ╤Г╨┤╨░╨╗╤П╨╗╨░╤Б╤М). Step-7 ╨▓ webhook.route.ts ╨┐╤А╨╛╨▓╨╡╤А╤П╨╡╤В `midas:success_card:{amId}` ╨┐╨╡╤А╨╡╨┤ ╤Г╨┤╨░╨╗╨╡╨╜╨╕╨╡╨╝.
     - `midas:success_card:{msgId}` тАФ Phase 2.10: sentinel key, TTL 30 ╨┤╨╜╨╡╨╣. ╨Ч╨░╨┐╨╕╤Б╤Л╨▓╨░╨╡╤В╤Б╤П `notifications.worker` ╨┐╤А╨╕ `isSuccessCard=true` (╨┐╨╛╤Б╨╗╨╡ approve). ╨з╨╕╤В╨░╨╡╤В╤Б╤П step-7 ╨▓ `webhook.route.ts` тАФ ╨╡╤Б╨╗╨╕ EXISTS, ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ ╨Э╨Х ╤Г╨┤╨░╨╗╤П╨╡╤В╤Б╤П ╨┐╤А╨╕ ╨▓╨▓╨╛╨┤╨╡ ╤Б╨╗╨╡╨┤╤Г╤О╤Й╨╡╨╣ ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕. ╨Ф╨▓╨╛╨╣╨╜╨░╤П ╨▒╨╗╨╛╨║╨╕╤А╨╛╨▓╨║╨░ ╨▓╨╝╨╡╤Б╤В╨╡ ╤Б DEL `midas:am:`.
    - `bl:state:{telegramUserId}:{chatId}` тАФ Phase 2.1: state ╨┤╨╗╤П ╤В╨╡╨║╤Б╤В╨╛╨▓╤Л╤Е intercepts ╨▒╨░╨╗╨░╨╜╤Б-╨╝╨╡╨╜╨╡╨┤╨╢╨╝╨╡╨╜╤В╨░. ╨е╤А╨░╨╜╨╕╤В `{action, accountId}`. Actions: `rename`, `set_balance`, `currency_input`. TTL 300s.
    - `bl:source:{telegramUserId}:{chatId}` тАФ Phase 2.1: ╤Д╨╗╨░╨│ ╤З╤В╨╛ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨╕╨╡ ╤Б╤З╤С╤В╨░ ╨╕╨╜╨╕╤Ж╨╕╨╕╤А╨╛╨▓╨░╨╜╨╛ ╨╕╨╖ ╨▒╨░╨╗╨░╨╜╤Б╨░. ╨Я╤А╨╕ `ac:done` ╨▓╨╛╨╖╨▓╤А╨░╤Й╨░╨╡╤В ╨▓ balance dashboard ╨▓╨╝╨╡╤Б╤В╨╛ setup complete.
     - `midas:tx:sr:ctx:{telegramUserId}:{chatId}` тАФ Phase 2.3: ╨┐╨╛╨╕╤Б╨║╨╛╨▓╤Л╨╣ ╨║╨╛╨╜╤В╨╡╨║╤Б╤В ╨┤╨╗╤П ╨┐╨░╨│╨╕╨╜╨░╤Ж╨╕╨╕. ╨е╤А╨░╨╜╨╕╤В JSON `{t: 'name'|'amount'|'category'|'date', q?: string, f?: string, to?: string, lb?: string}` TTL 600s. ╨б╨╛╨╖╨┤╨░╤С╤В╤Б╤П ╨┐╤А╨╕ ╨┐╨╡╤А╨▓╨╛╨╝ ╨┐╨╛╨╕╤Б╨║╨╡, ╤З╨╕╤В╨░╨╡╤В╤Б╤П ╨┐╤А╨╕ ╨╜╨░╨▓╨╕╨│╨░╤Ж╨╕╨╕ ╨┐╨╛ ╤Б╤В╤А╨░╨╜╨╕╤Ж╨░╨╝ (tx:sr:p:{page}). ╨Я╤А╨╕ ╤Г╤Б╤В╨░╤А╨╡╨▓╨░╨╜╨╕╨╕ тАФ ╨┤╤А╤Г╨╢╨╡╨╗╤О╨▒╨╜╨╛╨╡ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ ┬л╨┐╨╛╨╕╤Б╨║ ╨╖╨░╨╜╨╛╨▓╨╛┬╗.
    - `bl:source:{telegramUserId}:{chatId}` тАФ Phase 2.3: ╨┐╤А╨╕ `ac:fin`/`ac:done` ╨┐╤А╨╛╨▓╨╡╤А╤П╨╡╤В╤Б╤П ╨┤╨╗╤П ╨▓╨╛╨╖╨▓╤А╨░╤В╨░ ╨▓ balance dashboard ╨▓╨╝╨╡╤Б╤В╨╛ setup complete.
     - `midas:ac:{userId}:{chatId}` ╨┐╨╛╨╗╨╡ `pendingName` тАФ Master Roadmap: ╨▓╤А╨╡╨╝╨╡╨╜╨╜╨╛╨╡ ╨╕╨╝╤П ╨╕╨╖ no-match flow ╨┤╨╛ ╨┐╨╛╨┤╤В╨▓╨╡╤А╨╢╨┤╨╡╨╜╨╕╤П ╤З╨╡╤А╨╡╨╖ `ac:cus:save`.
     - `midas:ac:{userId}:{chatId}` ╨┐╨╛╨╗╨╡ `isCustomName` тАФ Master Roadmap: true ╨╡╤Б╨╗╨╕ ╨╕╨╝╤П ╤Б╤З╤С╤В╨░ тАФ ╤Б╨▓╨╛╨▒╨╛╨┤╨╜╤Л╨╣ ╨▓╨▓╨╛╨┤ (╨╜╨╡ preset). ╨Т╨╗╨╕╤П╨╡╤В ╨╜╨░ ╤В╨╡╨║╤Б╤В currency picker.
     - `midas:ac:{userId}:{chatId}` ╤И╨░╨│ `cur_search` тАФ Master Roadmap: ╤А╨╡╨╢╨╕╨╝ ╨┐╨╛╨╕╤Б╨║╨░ ╨▓╨░╨╗╤О╤В╤Л ╨░╨║╤В╨╕╨▓╨╡╨╜. ╨б╨╗╨╡╨┤╤Г╤О╤Й╨╕╨╣ ╤В╨╡╨║╤Б╤В ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤П > `searchCurrencies()`. ╨б╨╜╨╕╨╝╨░╨╡╤В╤Б╤П ╨┐╤А╨╕ `ac:cur:list` ╨╕╨╗╨╕ ╨▓╤Л╨▒╨╛╤А╨╡ ╨▓╨░╨╗╤О╤В╤Л.

  - **Auto-Activation:** `replyKeyboardJson` ╨▓ `NotificationJobPayload`. rejection/expiry/intent_missing sends ReplyKeyboard ╨╜╨░ `sendMessage` path. `editMessageText` path тАФ ╤В╨╛╨╗╤М╨║╨╛ inline keyboard (Telegram API limitation).
  - **Collapsibility:** `is_persistent: false` тАФ Telegram ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В ? ╨╕╨║╨╛╨╜╨║╤Г ╤А╤П╨┤╨╛╨╝ ╤Б ??; ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨╝╨╛╨╢╨╡╤В ╤Б╨║╤А╤Л╨▓╨░╤В╤М/╨▓╨╛╤Б╤Б╤В╨░╨╜╨░╨▓╨╗╨╕╨▓╨░╤В╤М ╨║╨╗╨░╨▓╨╕╨░╤В╤Г╤А╤Г.
  - **Race Condition Fix:** `redisConnection.del(clarKey)` ╨╜╨░ confirm/reject > stale `midas:clar:*` ╨╜╨╡ ╨┐╨╡╤А╨╡╤Е╨▓╨░╤В╤Л╨▓╨░╨╡╤В ╤Б╨╗╨╡╨┤╤Г╤О╤Й╨╡╨╡ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡.
  - **Keyboard Consistency:** Both screen-builders use ??. confirmKb: ? full-width row + [??|??] split row.

---

## 4. PROJECT_CONFIG STATUS

- `project_config.md` ╨▓╨╡╤А╤Б╨╕╤П **v1.4**
- v1.4 ╨▓╨║╨╗╤О╤З╨░╨╡╤В: Phase 1.37 AI Taxonomy & Zero-Clutter UX update, 30-category taxonomy, 500+ anchors, multilingual, disambiguation, ALLOWED_CATEGORIES validation, Phase 2.0 documented
- SEC-01 тАФ SEC-12 = ╨╛╨▒╤П╨╖╨░╤В╨╡╨╗╤М╨╜╤Л╨╡ ╨╛╨│╤А╨░╨╜╨╕╤З╨╡╨╜╨╕╤П ╤А╨╡╨░╨╗╨╕╨╖╨░╤Ж╨╕╨╕ Phase 1
- **?? ╨Ч╨Р╨С╨Ы╨Ю╨Ъ╨Ш╨а╨Ю╨Т╨Р╨Э** тАФ ╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨╕╨╡ ╤В╨╛╨╗╤М╨║╨╛ ╨┐╨╛ ╨┐╤А╤П╨╝╨╛╨╝╤Г ╨┐╤А╨╕╨║╨░╨╖╤Г ╨▓╨╗╨░╨┤╨╡╨╗╤М╤Ж╨░

---

## 5. PHASE 1.1 тАФ ╨а╨Х╨Ч╨г╨Ы╨м╨в╨Р╨в

**╨б╤В╨░╤В╤Г╤Б:** ? COMPLETED

╨б╨╛╨╖╨┤╨░╨╜ Turborepo monorepo `midas-monorepo/`:

```
midas-monorepo/
+-- apps/
┬ж   +-- telegram-bot/          # @midas/telegram-bot
┬ж   L-- background-workers/    # @midas/background-workers
+-- packages/
## 6. ╨в╨Х╨Ъ╨г╨й╨Р╨п ╨д╨Р╨Ч╨Р тАФ PHASE 1.30: Smart Account Onboarding

> ? **COMPLETED / ACCEPTED (Phase 1.30). See Section 10 history.**

**Objective:**
Replace the flat "╨б╤З╨╡╤В╨╛╨▓ ╨┐╨╛╨║╨░ ╨╜╨╡╤В." empty-state with a guided interactive keyboard when /accounts is empty (Scenario ╨Ф) and show a guided account setup keyboard for new users after /start (Scenario ╨Х). UX layer only тАФ no migration, no new commands, no AI changes.

```
╨Я╨а╨Ю╨Х╨Ъ╨в: Midas Telegram Bot (╨┐╨╡╤А╤Б╨╛╨╜╨░╨╗╤М╨╜╤Л╨╣ ╤Д╨╕╨╜╨░╨╜╤Б╨╛╨▓╤Л╨╣ ╤Г╤З╤С╤В ╤З╨╡╤А╨╡╨╖ Telegram).
Railway (project: spirited-happiness). MCP: Railway, GitHub, Postgres, Filesystem.
Auto-deploy: push to main > GitHub > Railway ╤Б╤В╤А╨╛╨╕╤В Midas + background-workers.
Workspace: C:\Users\secvency\Desktop\Midas\midas-monorepo

╨Я╨а╨Ю╨з╨Ш╨в╨Р╨Щ ╨б╨Э╨Р╨з╨Р╨Ы╨Р: C:\Users\secvency\Desktop\Midas\workflow_state.md
тАФ ╤В╨░╨╝ ╨┐╨╛╨╗╨╜╨░╤П ╨╕╤Б╤В╨╛╤А╨╕╤П, ╨░╤А╤Е╨╕╤В╨╡╨║╤В╤Г╤А╨░, Redis-╨║╨╗╤О╤З╨╕ ╨╕ ╤Б╨╗╨╡╨┤╤Г╤О╤Й╨╕╨╡ ╨╖╨░╨┤╨░╤З╨╕.

тХРтХРтХР ╨з╨в╨Ю ╨б╨Ф╨Х╨Ы╨Р╨Э╨Ю ╨Т ╨Я╨Ю╨б╨Ы╨Х╨Ф╨Э╨Ш╨е ╨б╨Х╨б╨б╨Ш╨п╨е (2026-05-19 / 2026-05-20) тХРтХРтХР

[╨б╨╡╤Б╤Б╨╕╤П 2026-05-19: Transfer Flow + Redis Fix]
- transfer-pairing.service.ts тАФ ╨┐╨╛╨╗╨╜╤Л╨╣ FSM transfer flow (A1/A2a/A2b/B ╨▓╨╡╤В╨║╨╕)
- approvePairedTransfer() тАФ ╤Б╨╛╨╖╨┤╨░╤С╤В paired outbound+inbound ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕
- ╨С╨░╨╗╨░╨╜╤Б-╨┤╨╕╤Б╨║╤А╨╡╨┐╨░╨╜╤Б ╨╕╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜: direction-aware formula ╨▓ account.service.ts
- Redis ETIMEDOUT: Railway GCP volume migration тАФ ╤А╨╡╤И╨╕╨╗╨╛╤Б╤М ╨┐╨╡╤А╨╡╨╖╨░╨┐╤Г╤Б╨║╨╛╨╝ Redis

[╨б╨╡╤Б╤Б╨╕╤П 2026-05-20 ╤Г╤В╤А╨╛: Intent Semantics + Transfer Intercept + Resilience]

1. ╨Ш╨б╨Я╨а╨Р╨Т╨Ы╨Х╨Э╨Р ╨б╨Х╨Ь╨Р╨Э╨в╨Ш╨Ъ╨Р AI INTENT (prompts.ts):
   - ┬л╨┐╨╡╤А╨╡╨▓╨╡╨╗ 1000 ╨Т╨░╤Б╨╡┬╗ тЖТ intent=transfer + person_hint=╨Т╨░╤Б╤П (╨Э╨Х debt_given!)
   - ┬л╤Б╨║╨╕╨╜╤Г╨╗ 5000 ╨Ъ╨╛╨╗╨╡┬╗ тЖТ intent=transfer + person_hint=╨Ъ╨╛╨╗╤П
   - debt_given = ╨в╨Ю╨Ы╨м╨Ъ╨Ю ╨┐╤А╨╕ ╤П╨▓╨╜╨╛╨╝ ╨┤╨╛╨╗╨│╨╛╨▓╨╛╨╝ ╤П╨╖╤Л╨║╨╡: ┬л╨┤╨░╨╗ ╨▓ ╨┤╨╛╨╗╨│┬╗, ┬л╨╖╨░╨╣╨╝┬╗, ┬л╨║╤А╨╡╨┤╨╕╤В┬╗
   - ╨Ю╤В╨║╨░╤З╨╡╨╜ ╨╜╨╡╨┐╤А╨░╨▓╨╕╨╗╤М╨╜╤Л╨╣ ╨║╨╛╨╝╨╝╨╕╤В 816ee6c
   - ╨Я╤А╨░╨▓╨╕╨╗╤М╨╜╤Л╨╣ ╨║╨╛╨╝╨╝╨╕╤В: 0286673

2. PHASE 3.1: TRANSFER INTERCEPT (webhook.route.ts):
   Root cause: ╨┐╤А╨╕ ╨╜╨░╨╢╨░╤В╨╕╨╕ тЬЕ ╨Я╨╛╨┤╤В╨▓╨╡╤А╨┤╨╕╤В╤М ╨╜╨░ transfer ╨▒╨╡╨╖ transfer_target_account_id
   тЖТ approveDraft() ╤Б╨╛╨╖╨┤╨░╨▓╨░╨╗ ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╤О ╤Б direction=NULL тЖТ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╗╨░╤Б╤М ╨║╨░╨║ ╤А╨░╤Б╤Е╨╛╨┤
   ╨д╨╕╨║╤Б: ╨┐╨╡╤А╨╡╤Е╨▓╨░╤В ╨┐╨╡╤А╨╡╨┤ enqueue тЖТ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╨╝ target picker
   ╨Ъ╨╛╨╝╨╝╨╕╤В: 0286673

3. AI-PARSE RESILIENCE (queue-definitions.ts + ai-parse.worker.ts):
   - attempts: 2 тЖТ 3, backoff: exponential (5s/10s/20s)
   - ╨Я╤А╨╕ ╤Д╨╕╨╜╨░╨╗╤М╨╜╨╛╨╝ ╨┐╤А╨╛╨▓╨░╨╗╨╡: ╤Г╨▓╨╡╨┤╨╛╨╝╨╗╨╡╨╜╨╕╨╡ 'тЪая╕П ╨Ш╨Ш ╨▓╤А╨╡╨╝╨╡╨╜╨╜╨╛ ╨╜╨╡╨┤╨╛╤Б╤В╤Г╨┐╨╡╨╜'
   - ╨Я╤А╨╕╤З╨╕╨╜╨░: Anthropic InternalServerError тЖТ ╨▒╨╛╤В ╨╝╨╛╨╗╤З╨░╨╗
   - ╨Ъ╨╛╨╝╨╝╨╕╤В: 7fe73a7

[╨б╨╡╤Б╤Б╨╕╤П 2026-05-20 ╨┤╨╡╨╜╤М: External Transfer Confirm Bug + Dative Names]

4. PHASE 3.1 INTERCEPT тАФ ╨Ъ╨а╨Ш╨в╨Ш╨з╨Х╨б╨Ъ╨Ш╨Щ ╨д╨Ш╨Ъ╨б (webhook.route.ts) commit 8785e3c:
   Root cause: Phase 3.1 intercept ╨┐╨╡╤А╨╡╤Е╨▓╨░╤В╤Л╨▓╨░╨╗ ╨Т╨б╨Х ╨┐╨╡╤А╨╡╨▓╨╛╨┤╤Л ╤Б intent=transfer
   ╨╕ ╨╛╤В╤Б╤Г╤В╤Б╤В╨▓╨╕╨╡╨╝ transfer_target_account_id тАФ ╨▓╨║╨╗╤О╤З╨░╤П ╨Т╨Э╨Х╨и╨Э╨Ш╨Х (Branch B, ╤З╨╡╨╗╨╛╨▓╨╡╨║╤Г).
   ╨Т╨╜╨╡╤И╨╜╨╕╨╡ ╨┐╨╡╤А╨╡╨▓╨╛╨┤╤Л ╤В╨╛╨╢╨╡ ╨╕╨╝╨╡╤О╤В intent=transfer + no target_account_id, ╨Э╨Ю ╤Г ╨╜╨╕╤Е
   ╨Т╨б╨Х╨У╨Ф╨Р ╨╡╤Б╤В╤М category_id (╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨▓╤Л╨▒╤А╨░╨╗ ╨║╨░╤В╨╡╨│╨╛╤А╨╕╤О ╨▓ Branch B flow).
   ╨д╨╕╨║╤Б: ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨░ ╨┐╤А╨╛╨▓╨╡╤А╨║╨░ category_id ╨▓ SQL + ╤Г╤Б╨╗╨╛╨▓╨╕╨╡ ╨┐╨╡╤А╨╡╤Е╨▓╨░╤В╨░:
     intent=transfer AND target IS NULL AND category_id IS NULL тЖТ target picker
     intent=transfer AND target IS NULL AND category_id IS NOT NULL тЖТ approveDraft тЬЕ

5. ╨Р╨Т╨в╨Ю-╨б╨Ъ╨Ы╨Ю╨Э╨Х╨Э╨Ш╨Х ╨Ш╨Ь╨Б╨Э ╨Я╨Ю╨Ы╨г╨з╨Р╨в╨Х╨Ы╨Х╨Щ (transfer-pairing.service.ts + webhook.route.ts)
   commit 8e274c4:
   ╨Я╤А╨╛╨▒╨╗╨╡╨╝╨░: ┬л╨Я╨╡╤А╨╡╨▓╨╛╨┤ ╨Р╨╗╨╡╨║╤Б╨╡╨╣┬╗ тАФ ╨│╤А╨░╨╝╨╝╨░╤В╨╕╤З╨╡╤Б╨║╨╕ ╨╜╨╡╨▓╨╡╤А╨╜╨╛ ╨┐╨╛-╤А╤Г╤Б╤Б╨║╨╕.
   ╨а╨╡╤И╨╡╨╜╨╕╨╡: rule-based ╤Д╤Г╨╜╨║╤Ж╨╕╤П toRecipientDative() тАФ ╨┤╨░╤В╨╡╨╗╤М╨╜╤Л╨╣ ╨┐╨░╨┤╨╡╨╢:
     ╨Р╨╗╨╡╨║╤Б╨╡╨╣ тЖТ ╨Р╨╗╨╡╨║╤Б╨╡╤О   ╨Р╨╜╤В╨╛╨╜ тЖТ ╨Р╨╜╤В╨╛╨╜╤Г   ╨Ь╨░╤А╨╕╤П тЖТ ╨Ь╨░╤А╨╕╨╕
     ╨Ф╨░╤А╤М╤П тЖТ ╨Ф╨░╤А╤М╨╡       ╨Ш╨▓╨░╨╜ тЖТ ╨Ш╨▓╨░╨╜╤Г     ╨Ш╨│╨╛╤А╤М тЖТ ╨Ш╨│╨╛╤А╤О
     ╨в╨░╨╜╤П тЖТ ╨в╨░╨╜╨╡         ╨б╨╡╤А╨│╨╡╨╣ тЖТ ╨б╨╡╤А╨│╨╡╤О  ╨Х╨▓╨│╨╡╨╜╨╕╨╣ тЖТ ╨Х╨▓╨│╨╡╨╜╨╕╤О
   ╨Ы╨░╤В╨╕╨╜╤Б╨║╨╕╨╡ ╨╕╨╝╨╡╨╜╨░ (Anton, Maria) тАФ ╨▒╨╡╨╖ ╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨╕╨╣.
   ╨Я╨╛╨╗╨╜╤Л╨╡ ╨╕╨╝╨╡╨╜╨░: ┬л╨Ш╨▓╨░╨╜ ╨Я╨╡╤В╤А╨╛╨▓┬╗ тЖТ ┬л╨Ш╨▓╨░╨╜╤Г ╨Я╨╡╤В╤А╨╛╨▓╤Г┬╗ (╨║╨░╨╢╨┤╨╛╨╡ ╤Б╨╗╨╛╨▓╨╛ ╨╛╤В╨┤╨╡╨╗╤М╨╜╨╛).
   ╨Я╤А╨╕╨╝╨╡╨╜╤П╨╡╤В╤Б╤П ╨▓ text interceptor ╨┐╨╡╤А╨╡╨┤ patchDraftItemName тАФ ╤Е╤А╨░╨╜╨╕╤В╤Б╤П ╤Г╨╢╨╡ ╨▓ ╨┤╨░╤В╨╡╨╗╤М╨╜╨╛╨╝.

тХРтХРтХР ╨Ъ╨Ы╨о╨з╨Х╨Т╨л╨Х ╨д╨Р╨Щ╨Ы╨л тХРтХРтХР
packages/ai-core/src/prompts.ts                                     тАФ AI intent rules (TRANSFER PRIORITY RULE, debt_given)
apps/telegram-bot/src/routes/webhook.route.ts                       тАФ webhook FSM, tp: callbacks, Phase 3.1 intercept (category_id guard)
apps/telegram-bot/src/services/transfer-pairing.service.ts          тАФ target picker, getAvailableTargetAccounts, toRecipientDative()
apps/background-workers/src/services/draft-confirmation.service.ts  тАФ approveDraft + approvePairedTransfer
apps/background-workers/src/workers/ai-parse.worker.ts              тАФ failed handler, resilience
apps/background-workers/src/queues/queue-definitions.ts             тАФ retry config

тХРтХРтХР ╨Р╨а╨е╨Ш╨в╨Х╨Ъ╨в╨г╨а╨Р INTENT-ROUTING тХРтХРтХР
confirmation.worker.ts ╨┐╨╕╨║╨╕╤А╤Г╨╡╤В transfer_target_account_id:
  тЙа NULL тЖТ approvePairedTransfer() тЖТ paired outbound+inbound ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕
  NULL   тЖТ approveDraft() тЖТ ╨╛╨┤╨╕╨╜╨╛╤З╨╜╨░╤П ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╤П (expense/income/debt_*/transfer)

Phase 3.1 ╨┐╨╡╤А╨╡╤Е╨▓╨░╤В ╨▓ webhook.route.ts ╨Я╨Х╨а╨Х╨Ф enqueue:
  approve + intent=transfer + no target + NO category_id тЖТ target picker (tp: flow) [internal]
  approve + intent=transfer + no target + HAS category_id тЖТ approveDraft() [external/Branch B] тЬЕ
  approve + intent=transfer + target ╨╡╤Б╤В╤М тЖТ approvePairedTransfer() [internal paired]

тХРтХРтХР ╨б╨Ы╨Х╨Ф╨г╨о╨й╨Ш╨Х ╨Ч╨Р╨Ф╨Р╨з╨Ш тХРтХРтХР
╨Я╤А╨╕╨╛╤А╨╕╤В╨╡╤В 1: E2E ╤В╨╡╤Б╤В ╨▓ ╨▒╨╛╤В╨╡:
  - ┬л╨┐╨╡╤А╨╡╨▓╨╡╨╗ 1000 ╨┤╨╛╨╗╨╗╨░╤А╨╛╨▓ ╨Р╨╗╨╡╨║╤Б╨╡╤О┬╗ тЖТ intent=transfer + ╨╖╨░╨┐╨╕╤Б╨░╤В╤М ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╤О
  - ╨Э╨░╨╢╨░╤В╤М тЬЕ ╨Я╨╛╨┤╤В╨▓╨╡╤А╨┤╨╕╤В╤М тЖТ ╨┤╨╛╨╗╨╢╨╜╨╛ ╨╖╨░╨┐╨╕╤Б╨░╤В╤М╤Б╤П (╨Э╨Х ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╤В╤М target picker)
  - ╨Ш╨╝╤П ╨┐╨╛╨╗╤Г╤З╨░╤В╨╡╨╗╤П тЖТ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В╤Б╤П ┬л╨Р╨╗╨╡╨║╤Б╨╡╤О┬╗ ╨▓╨╡╨╖╨┤╨╡

╨Я╤А╨╕╨╛╤А╨╕╤В╨╡╤В 2: Phase 3.0 тАФ DB Schema:
  - account_type ╨║╨╛╨╗╨╛╨╜╨║╨░ (card/cash/wallet/exchange/custom)
  - wallet_subtype ╨║╨╛╨╗╨╛╨╜╨║╨░ (ton/crypto/ewallet/general)
  - ╨Ь╨╕╨│╤А╨░╤Ж╨╕╤П + ╨╛╨▒╨╜╨╛╨▓╨╕╤В╤М ╤Б╨╕╨│╨╜╨░╤В╤Г╤А╤Л addAccount*, chooseCurKeyboard()
```


---

## 7. MCP SERVERS & INFRASTRUCTURE (Production)

### ╨Я╨╛╨┤╨║╨╗╤О╤З╤С╨╜╨╜╤Л╨╡ MCP-╤Б╨╡╤А╨▓╨╡╤А╤Л

| MCP-╤Б╨╡╤А╨▓╨╡╤А | ╨б╤В╨░╤В╤Г╤Б | ╨Э╨░╨╖╨╜╨░╤З╨╡╨╜╨╕╨╡ |
|---|---|---|
| **Railway MCP** | ? Active | ╨Ф╨╡╨┐╨╗╨╛╨╣, ╨╗╨╛╨│╨╕, ╨┐╨╡╤А╨╡╨╝╨╡╨╜╨╜╤Л╨╡, ╤Б╨╡╤А╨▓╨╕╤Б╤Л. Project: `spirited-happiness`. |
| **GitHub MCP** | ? Active | Repo: `gloryjasystem/Midas`. Auto-deploy on push to `main`. |
| **Postgres MCP** | ? Active | Read-only SQL ╨║ production DB ╤З╨╡╤А╨╡╨╖ Railway proxy. |
| **Filesystem MCP** | ? Active | ╨з╤В╨╡╨╜╨╕╨╡/╨╖╨░╨┐╨╕╤Б╤М ╤Д╨░╨╣╨╗╨╛╨▓ ╨▓ workspace `C:\Users\secvency\Desktop\Midas` |

### Railway Infrastructure

| ╨б╨╡╤А╨▓╨╕╤Б | ╨а╨╛╨╗╤М | ╨Ф╨╛╨╝╨╡╨╜ |
|---|---|---|
| **Midas** | Telegram Bot (Fastify webhook) | `midas-production-f4f1.up.railway.app` |
| **background-workers** | BullMQ workers (ai-parse, confirm, notify, draft-expire, webhook) | Internal only |
| **Postgres** | PostgreSQL 17 (managed) | `postgres.railway.internal:5432` |
| **Redis** | BullMQ + state (Redis 7) | `redis.railway.internal:6379` |

### ╨Ъ╨╗╤О╤З╨╡╨▓╤Л╨╡ ╨┐╨╡╤А╨╡╨╝╨╡╨╜╨╜╤Л╨╡ (Railway Dashboard)

| ╨Я╨╡╤А╨╡╨╝╨╡╨╜╨╜╨░╤П | ╨У╨┤╨╡ | ╨Я╤А╨╕╨╝╨╡╤З╨░╨╜╨╕╨╡ |
|---|---|---|
| `DATABASE_URL` | Midas + background-workers | `postgres.railway.internal` (internal) |
| `REDIS_URL` | Midas + background-workers | `redis.railway.internal` |
| `TELEGRAM_BOT_TOKEN` | Midas | ?? ╨в╤А╨╡╨▒╤Г╨╡╤В ╤А╨╛╤В╨░╤Ж╨╕╨╕ (╨▒╤Л╨╗ ╨▓╨╕╨┤╨╡╨╜ ╨▓ ╨╗╨╛╨│╨░╤Е) |
| `ANTHROPIC_API_KEY` | background-workers | ?? ╨в╤А╨╡╨▒╤Г╨╡╤В ╤А╨╛╤В╨░╤Ж╨╕╨╕ |
| `TELEGRAM_WEBHOOK_SECRET` | Midas | `midas_wh_secret_2026_prod` |

---

## 8. ╨д╨Р╨Щ╨Ы╨л ╨Ф╨Ы╨п ╨з╨в╨Х╨Э╨Ш╨п ╨Т ╨Э╨Ю╨Т╨Ю╨Ь ╨з╨Р╨в╨Х (Phase 3.1 context)

**тЬЕ ╨в╨Х╨Ъ╨г╨й╨Ш╨Щ ╨Ъ╨Ю╨Э╨в╨Х╨Ъ╨б╨в: Transfer intent ╤Б╨╡╨╝╨░╨╜╤В╨╕╨║╨░ ╨╕╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜╨░. Phase 3.1 Transfer Intercept ╨╖╨░╨┤╨╡╨┐╨╗╨╛╨╡╨╜. ai-parse resilience ╤Г╨╗╤Г╤З╤И╨╡╨╜╨░.**

**╨Ю╨С╨п╨Ч╨Р╨в╨Х╨Ы╨м╨Э╨Ю ╨┐╤А╨╛╤З╨╕╤В╨░╤В╤М ╨▓ ╨╜╨╛╨▓╨╛╨╝ ╤З╨░╤В╨╡:**
```
packages/ai-core/src/prompts.ts                                      < TRANSFER PRIORITY RULE + debt_given ╤Б╨╡╨╝╨░╨╜╤В╨╕╨║╨░ (lines 127-148, 246-257)
apps/telegram-bot/src/routes/webhook.route.ts                        < Phase 3.1 Transfer Intercept (lines ~4488-4560)
apps/telegram-bot/src/services/transfer-pairing.service.ts           < tp: flow, target picker, getAvailableTargetAccounts
apps/background-workers/src/services/draft-confirmation.service.ts   < approvePairedTransfer + approveDraft
apps/background-workers/src/workers/ai-parse.worker.ts               < failed handler + resilience (lines 1056-1090)
apps/background-workers/src/queues/queue-definitions.ts              < aiParseDefaultJobOptions (attempts=3, exponential)
```

**╨Э╨Х ╨з╨Ш╨в╨Р╨в╨м (╨╜╨╡ ╨╜╤Г╨╢╨╜╤Л ╤Б╨╡╨╣╤З╨░╤Б):**
```
packages/database/smoke-test-phase*.mjs
apps/telegram-bot/src/services/excel-export.service.ts
```

**╨Ш╨╖╨╝╨╡╨╜╨╡╨╜╨╕╤П ╤Б╨╡╤Б╤Б╨╕╨╕ 2026-05-20:**

### [1] prompts.ts тАФ ╨Ш╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜╨░ ╤Б╨╡╨╝╨░╨╜╤В╨╕╨║╨░ intent
- **TRANSFER PRIORITY RULE** ╨┐╨╡╤А╨╡╨┐╨╕╤Б╨░╨╜:
  - `transfer verb + person name` = `intent=transfer` + `person_hint` (╨Э╨Х debt_given!)
  - `debt_given` = ╨в╨Ю╨Ы╨м╨Ъ╨Ю ╨┐╤А╨╕ ╤П╨▓╨╜╨╛╨╝ ╨┤╨╛╨╗╨│╨╛╨▓╨╛╨╝ ╤П╨╖╤Л╨║╨╡: ┬л╨┤╨░╨╗ ╨▓ ╨┤╨╛╨╗╨│┬╗, ┬л╨╖╨░╨╣╨╝┬╗, ┬л╨║╤А╨╡╨┤╨╕╤В┬╗
  - 4 ╨┐╤А╨╕╨╝╨╡╤А╨░: ┬л╨┐╨╡╤А╨╡╨▓╨╡╨╗ 1000 ╨Т╨░╤Б╨╡┬╗ тЖТ transfer+person_hint, ┬л╤Б╨║╨╕╨╜╤Г╨╗ ╨Ъ╨╛╨╗╨╡┬╗ тЖТ transfer+person_hint
- **DEBT_GIVEN signals** тАФ ╤П╨▓╨╜╨╛ ╤Г╨║╨░╨╖╨░╨╜╨╛: transfer verbs alone тЙа debt_given
- ╨Ю╤В╨║╨░╤З╨╡╨╜ ╨┐╤А╨╡╨┤╤Л╨┤╤Г╤Й╨╕╨╣ ╨╜╨╡╨┐╤А╨░╨▓╨╕╨╗╤М╨╜╤Л╨╣ ╨║╨╛╨╝╨╝╨╕╤В `816ee6c` (╤В╨╛╤В, ╨│╨┤╨╡ transfer+person тЖТ debt_given)

### [2] webhook.route.ts тАФ Phase 3.1: Transfer Intercept
- **╨Я╤А╨╛╨▒╨╗╨╡╨╝╨░ (root cause):** ╨Я╤А╨╕ ╨╜╨░╨╢╨░╤В╨╕╨╕ тЬЕ ╨Я╨╛╨┤╤В╨▓╨╡╤А╨┤╨╕╤В╤М ╨╜╨░ transfer-╤З╨╡╤А╨╜╨╛╨▓╨╕╨║╨╡ ╨▒╨╡╨╖ `transfer_target_account_id` тЖТ `approveDraft()` ╤Б╨╛╨╖╨┤╨░╨▓╨░╨╗ ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╤О ╤Б `transfer_direction=NULL` тЖТ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╗╨░╤Б╤М ╨║╨░╨║ ╤А╨░╤Б╤Е╨╛╨┤
- **╨д╨╕╨║╤Б:** ╨Я╨╡╤А╨╡╤Е╨▓╨░╤В ╨Я╨Х╨а╨Х╨Ф enqueue ╨▓ callback-confirm queue:
  - ╨з╨╕╤В╨░╨╡╤В ╤З╨╡╤А╨╜╨╛╨▓╨╕╨║ ╨╕╨╖ DB
  - ╨Х╤Б╨╗╨╕ `intent=transfer` ╨Ш ╨╜╨╡╤В `transfer_target_account_id` тЖТ ╨Э╨Х enqueue
  - ╨Т╨╝╨╡╤Б╤В╨╛ ╤Н╤В╨╛╨│╨╛: ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В target account picker (`buildTargetPickerScreen` + `buildTargetAccountKeyboard`)
  - Fall-through ╨┐╤А╨╕ ╨╛╤И╨╕╨▒╨║╨╡ ╨┐╨╡╤А╨╡╤Е╨▓╨░╤В╨░ (non-fatal, ╨╜╨╡ ╨║╤А╨░╤И╨╕╤В ╨▓╨╛╤А╨║╨╡╤А)
- ╨д╨░╨╣╨╗: `import('../services/transfer-pairing.service.js')` тАФ ╨┐╤А╨░╨▓╨╕╨╗╤М╨╜╤Л╨╣ ╨┐╤Г╤В╤М

### [3] queue-definitions.ts + ai-parse.worker.ts тАФ Resilience
- `attempts: 2 тЖТ 3`
- `backoff: fixed 5s тЖТ exponential 5s/10s/20s`
- ╨Я╤А╨╕ ╤Д╨╕╨╜╨░╨╗╤М╨╜╨╛╨╝ ╨┐╤А╨╛╨▓╨░╨╗╨╡: enqueue ╨▓ `notificationsQueue` тЖТ ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨┐╨╛╨╗╤Г╤З╨░╨╡╤В:
  `тЪая╕П ╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨╛╨▒╤А╨░╨▒╨╛╤В╨░╤В╤М ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡. ╨Ш╨Ш ╨▓╤А╨╡╨╝╨╡╨╜╨╜╨╛ ╨╜╨╡╨┤╨╛╤Б╤В╤Г╨┐╨╡╨╜. ╨Я╨╛╨┐╤А╨╛╨▒╤Г╨╣╤В╨╡ ╤З╨╡╤А╨╡╨╖ ╨╜╨╡╤Б╨║╨╛╨╗╤М╨║╨╛ ╤Б╨╡╨║╤Г╨╜╨┤.`
- ╨Я╤А╨╕╤З╨╕╨╜╨░: Anthropic ╨▓╤Л╨┤╨░╨╗ `InternalServerError` (HTTP 500) тЖТ ╨╛╨▒╨░ retry ╤Г╨┐╨░╨╗╨╕ тЖТ ╨▒╨╛╤В ╨╝╨╛╨╗╤З╨░╨╗

**╨Ъ╨╛╨╝╨╝╨╕╤В╤Л (╨░╨║╤В╤Г╨░╨╗╤М╨╜╤Л╨╡):**
- `0286673` тАФ fix: revert wrong debt_given for person transfers; add Phase 3.1 transfer intercept
- `7fe73a7` тАФ fix: notify user on AI parse final failure; increase ai-parse retries to 3


---

## 9. ПРОМПТ ДЛЯ СТАРТА НОВОГО ЧАТА

```
ПРОЕКТ: Midas Telegram Bot (персональный финансовый учёт через Telegram).
Railway (project: spirited-happiness). MCP: Railway, GitHub, Postgres, Filesystem.
Auto-deploy: push to main > GitHub > Railway строит Midas + background-workers.
Workspace: C:\Users\secvency\Desktop\Midas\midas-monorepo

ПРОЧИТАЙ СНАЧАЛА: workflow_state.md (секции 1, 8, 9) — там полная архитектура, Redis-ключи и следующие задачи.

═══ ЧТО СДЕЛАНО В ПОСЛЕДНИХ СЕССИЯХ (2026-05-20) ═══

[Сессия 2026-05-20 утро: DB Bugfixes + Resilience]
- transfer_group_id UUID→TEXT (commit 00ce130) — DatabaseError при paired transfer устранён
- current_screen TEXT колонка добавлена (migrate.ts) — CRON-воркер больше не падает
- ai-parse resilience: attempts 3, exponential backoff, уведомление при провале (commit 7fe73a7)
- Phase 3.1 intercept (webhook.route.ts): category_id guard — внешние переводы не перехватываются
- Семантика AI: перевел Васе → intent=transfer+person_hint (НЕ debt_given) (commit 0286673)

[Сессия 2026-05-20 день: External Transfer Bug Fixes]
- Критический фикс (commit 8785e3c): Phase 3.1 перехватывал и внешние переводы (Branch B)
  Фикс: добавлена проверка category_id IS NULL в условии перехвата
- Авто-склонение имён получателей toRecipientDative() (commit 8e274c4) — УДАЛЕНО в следующей сессии

[Сессия 2026-05-20 вечер: Transfer Flow Refactor — commit 0c23097] ← ПОСЛЕДНЯЯ
- УДАЛЁН промежуточный экран «Куда уходят деньги?» (buildTransferTypeScreen/Keyboard)
- УДАЛЁН весь Branch B: tp:type:external, tp:skip_rcpt, tp:grp, tp:cat handlers
- УДАЛЁН text interceptor midas:tp_ext_rcpt (recipient name FSM)
- ia:pk handler: при intent=transfer → сразу buildTargetAccountKeyboard (без type picker)
- ia:back handler: при intent=transfer → возврат к buildTargetAccountKeyboard
- Удалены 12 функций из transfer-pairing.service.ts (335 строк кода)
- Очищены импорты webhook.route.ts
- tsc 0 errors. Pushed. Railway auto-deploy.

НОВЫЙ TRANSFER FLOW:
  «перевод 1000 USD» → выбор исходного счёта → сразу список целевых счетов
  Та же валюта → preview → подтвердить
  Другая валюта → экран ввода суммы зачисления → preview → подтвердить
  ВСЁ. Кнопок «Другому человеку» больше нет. Для перевода человеку — используй расход.

═══ КЛЮЧЕВЫЕ ФАЙЛЫ ═══
apps/telegram-bot/src/routes/webhook.route.ts                       — webhook FSM, tp:tgt/xfx_back/confirm/cancel/newac/xfx handlers
apps/telegram-bot/src/services/transfer-pairing.service.ts          — target picker, getAvailableTargetAccounts, buildTargetPickerScreen (Branch B удалён)
apps/background-workers/src/services/draft-confirmation.service.ts  — approvePairedTransfer (paired outbound+inbound)
apps/background-workers/src/workers/ai-parse.worker.ts              — resilience, 3 attempts
packages/ai-core/src/prompts.ts                                      — AI intent rules, transfer vs expense vs debt

═══ АРХИТЕКТУРА TRANSFER FLOW ═══
ia:pk (account picked) → intent=transfer? → getDraftTransferState → getAvailableTargetAccounts → buildTargetAccountKeyboard
tp:tgt (target picked) → setDraftTargetAccount → same currency? → preview / cross-currency input
tp:confirm → callbackConfirmQueue → approvePairedTransfer → outbound+inbound pair
tp:cancel → reject draft, del midas:tp_xfx:* key

Phase 3.1 intercept (webhook.route.ts, ПЕРЕД enqueue):
  approve + intent=transfer + no target + no category → buildTargetAccountKeyboard [перехват]
  approve + intent=transfer + target есть → approvePairedTransfer [paired OK]
  approve + другой intent → approveDraft [обычная транзакция]

═══ СЛЕДУЮЩИЕ ЗАДАЧИ ═══
Приоритет 1: E2E тест нового transfer flow:
  - «перевод 500 USD» → выбрать счёт → должен появиться СРАЗУ список целевых счетов
  - Выбрать целевой счёт той же валюты → preview → подтвердить
  - Выбрать целевой счёт другой валюты → ввод суммы → preview → подтвердить
  - Кнопка Назад из ввода суммы → список счетов (не «Куда уходят деньги?»)

Приоритет 2: Phase 3.0 DB Schema:
  - account_type колонка (card/cash/exchange/wallet/custom)
  - wallet_subtype колонка (ton/crypto/ewallet/general)
  - Миграция 1780500000000 + обновить addAccount*, chooseCurKeyboard()

Приоритет 3: Phase 3.2 Report 3.0 (топ-5 трат + категорийная разбивка)

═══ КЛЮЧЕВЫЕ ПРАВИЛА ═══
- Финансовая математика: ТОЛЬКО NUMERIC/BigInt, никаких float (SEC-02)
- Все мутации через withTenantTransaction (SEC-03)
- Не трогать project_config.md
- Читать workflow_state.md секции 1, 8, 9 перед работой
```


## 10. ╨Ш╨б╨в╨Ю╨а╨Ш╨п ╨Ф╨Х╨Щ╨б╨в╨Т╨Ш╨Щ (╨б╨Ц╨Р╨в╨Р╨п)

| ╨Ф╨░╤В╨░ | ╨б╨╛╨▒╤Л╤В╨╕╨╡ |
|---|---|
| 2026-05-04 14:07 | ╨Ш╨╜╨╕╤Ж╨╕╨░╨╗╨╕╨╖╨░╤Ж╨╕╤П ╨┐╤А╨╛╨╡╨║╤В╨░: project_config.md v1.0 + workflow_state.md |
| 2026-05-04 14:45 | Phase 0.1 Event Storming completed (46 ╤Б╨╛╨▒╤Л╤В╨╕╨╣, 10 ╨░╨│╤А╨╡╨│╨░╤В╨╛╨▓, 15 ADR planned) |
| 2026-05-04 15:08 | Phase 0.2 ADR completed (15 ADR: ADR-000тАФADR-014). project_config.md > v1.1 |
| 2026-05-04 15:45 | Phase 0.3 Readiness Gate completed (scope, DB model, queue model, acceptance criteria) |
| 2026-05-04 17:02 | Security review: 2 CRITICAL, 2 HIGH > Phase 0.3.1 ╨╖╨░╨┐╤Г╤Й╨╡╨╜╨░ |
| 2026-05-04 17:15 | Phase 0.3.1 Security Patch completed (SEC-01тАФSEC-12). project_config.md > v1.2 |
| 2026-05-04 18:30 | Client roadmap document created: `docs/client-roadmap-architecture-overview.md` |
| 2026-05-04 21:12 | Phase 1.1 approved and started |
| 2026-05-04 21:17 | Phase 1.1 completed: monorepo, Docker, ESLint, TypeScript тАФ 8/8 typecheck passed |
| 2026-05-04 22:34 | Context checkpoint: workflow_state.md compressed for new chat handoff |
| 2026-05-05 09:53 | Git init fixed: repo moved from `C:/Users/secvency` > `Midas/`. Initial commit `cc91a47f` |
| 2026-05-05 10:22 | Docker readiness: port 5432 conflict resolved, `docker-compose.yml` volume path fixed for postgres:18 |
| 2026-05-05 12:05 | Section 11 (Agent Operating Protocol, 13 sub-protocols) added to workflow_state.md |
| 2026-05-05 12:11 | Self-audit applied: C1, C2, M1, M2, L2 fixes + Section 14 added |
| 2026-05-05 12:55 | Phase 1.2 Database Foundation completed & accepted via Review Gate. Minor observation: onboarding workspace spam requires app-layer rate limiting. |
| 2026-05-05 14:30 | Phase 1.3 BullMQ Task Queue Foundation completed & accepted. 13/13 typecheck+lint passed (0 errors). |
| 2026-05-05 19:30 | Phase 1.4 Verification Gate FULL PASS (7/7 smoke tests). Bugs fixed: BullMQ jobId `:` > `\|` separator, `/health` excluded from SEC-04 guard. Commit `6e0cfa1` pushed. |
| 2026-05-05 19:35 | Phase 1.4 ACCEPTED by owner. **Prod note:** Redis must use `noeviction` policy in production; `allkeys-lru` is acceptable only for local dev. |
| 2026-05-05 19:40 | workflow_state.md cleanup: stale Phase 1.2/1.4 references corrected in Sections 6тАУ9. Sections now describe Phase 1.5 scope, MCP needs, required files, and handoff prompt. No code written. |
| 2026-05-05 19:45 | Phase 1.5 scope narrowed by owner: User Onboarding & Workspace Resolution only. Removed from scope: callback_query, /add /balance /report /category, CRON, AI, full notifications. Sections 6, 8, 9 updated. |
| 2026-05-05 20:00 | Phase 1.5 implementation complete. `findOrCreateUser` (atomic, ON CONFLICT race-safe), `resolveWorkspace` real DB, `/start` handler, Redis anti-spam, `sendMessage` wrapper. 13/13 typecheck+lint pass. Commit `8f88f22`. |
| 2026-05-05 20:30 | Phase 1.5 Verification Gate PASS (39/39 smoke tests). Fix applied: RLS chicken-and-egg тАФ `midas_app` cannot INSERT into `workspaces` without a pre-existing `workspace_memberships` row. Added migration `1777973900000`: `system_find_or_create_user` SECURITY DEFINER (executes as `midas_migrator`, exempt from RLS; `pg_advisory_xact_lock` for race safety). **Documentation note:** SECURITY DEFINER onboarding pattern was introduced in Phase 1.2 migration (`1777973795878_rls-and-policies.js`) as `system_create_onboarding_workspace` but is not covered by any existing ADR. ADR-009 covers Exchange Rate Snapshot only. A future ADR documenting the SECURITY DEFINER onboarding bootstrap pattern is recommended. Commits `b60f7ac`, `9307800` pushed. |
| 2026-05-05 20:35 | Phase 1.5 ACCEPTED by owner. Status set to WAITING_FOR_OWNER_APPROVAL_TO_START_PHASE_1_6. |
| 2026-05-05 21:00 | Phase 1.6-A AI Parse Pipeline implementation complete. `parseTransaction()` (Claude Haiku + Zod strict allowlist SEC-01), `createDraft()` (withTenantTransaction SEC-03), date-scoped AI budget guard SEC-09, SEC-12 `job.updateData('[REDACTED]')` + `removeOnFail: { age: 86400 }`. Commit `305e0f6`. |
| 2026-05-05 21:30 | Phase 1.6-A Final Acceptance Check. Fix: NUMERIC(19,4) boundary тАФ regex `\d*` > `\d{0,14}` caps integer part at 15 digits. 73/73 smoke tests pass. 13/13 typecheck+lint pass. Commit `7b393d2` pushed. Phase 1.6-A ACCEPTED. |
| 2026-05-05 22:55 | Phase 1.6-B HitL Draft Confirmation implementation complete. `draft-confirmation.service.ts` (SELECT FOR UPDATE SKIP LOCKED), `confirmation.worker.ts`, `callback-confirm-queue.ts`, `webhook.route.ts` callback_query handler (ULID validation, SEC-03/06), real Telegram `sendMessage` with inline keyboard. 30/30 smoke tests PASS (incl. mandatory race condition test: parallel approve ? 2 > exactly 1 Transaction). Phase 1.6-A regression: 73/73 PASS. 13/13 typecheck+lint clean. Commit `d49625b` pushed. **Status: READY_FOR_OWNER_ACCEPTANCE.** Note: CRON draft expiration (SEC-08) intentionally deferred to Phase 1.7. No SEC-08 claim in Phase 1.6-B. |
| 2026-05-05 19:07 | Phase 1.6-B Final Acceptance Audit run (agent self-audit). All checks PASS: SEC-03 tenant isolation ?, atomic approval ?, race condition ?, rejection no-op ?, UNIQUE constraint ?, no SEC-08 false claim ?. workflow_state.md ACCEPTED wording corrected to READY_FOR_OWNER_ACCEPTANCE. Awaiting owner decision. |
| 2026-05-05 21:14 | Phase 1.6-B ACCEPTED by owner after Final Acceptance Audit PASS WITH FIXES. Code unchanged. 30/30 Phase 1.6-B smoke tests PASS, 73/73 Phase 1.6-A regression PASS, 13/13 typecheck/lint PASS. Commit `f205e09` pushed. CRON expiration (SEC-08) intentionally deferred to Phase 1.7. |
| 2026-05-05 21:32 | Phase 1.7 ACCEPTED by owner. `system_expire_pending_drafts()` owner fixed to `midas_migrator`; `search_path = public, pg_catalog` fixed; EXECUTE revoked from PUBLIC; 20/20 smoke tests PASS; 13/13 typecheck+lint PASS; git pushed and clean. Commit `49e0cec`. |
| 2026-05-05 22:30 | Phase 1.8-A Transaction Intent Foundation implementation complete. Migration `1778008338096_transaction-intent.js`: `parsed_intent` (nullable TEXT + CHECK) added to `transaction_drafts`; `transaction_intent` (NOT NULL TEXT + CHECK, backfilled 'expense', no DEFAULT) added to `transactions`. `draft.service.ts`: `AiOutput.intent` propagated to `parsed_intent`. `draft-confirmation.service.ts`: `parsed_intent` fetched in SELECT FOR UPDATE, new `intent_missing` outcome if NULL, `transaction_intent` written to transactions INSERT (explicit, no default). `confirmation.worker.ts`: `intent_missing` case handled with user message. 19/19 Phase 1.8-A tests PASS. 20/20 Phase 1.7 regression PASS. 30/30 Phase 1.6-B regression PASS. 73/73 Phase 1.6-A regression PASS. 13/13 typecheck+lint PASS. Traceability ? Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-05 23:39 | Phase 1.8-A ACCEPTED by owner after independent verification. Local and origin/main both at `51b6aee`. Implementation commit `425df61`. Migration `1778008338096_transaction-intent.js` tracked in git. Live DB verified: `parsed_intent` nullable, `transaction_intent` NOT NULL, no DEFAULT, CHECK constraints confirmed for exactly 5 values. 155/155 tests PASS (19 Phase 1.8-A + 20 Phase 1.7 + 30 Phase 1.6-B + 73 Phase 1.6-A + 13 typecheck+lint). No cleanup needed. |
| 2026-05-05 23:50 | Phase 1.8-B Runtime Consistency & Security Hardening implementation complete. C-1 fix: `draft.service.ts` L41 `telegram_user_id`>`telegram_id` (critical runtime bug тАФ would crash every AI parse job). C-2 fix: migration `1778008400000_harden-onboarding-search-path.js` тАФ `SET search_path = 'public', 'pg_catalog'` added to `system_create_onboarding_workspace` and `system_find_or_create_user`. M-1 fix: `shared/index.ts` `TRANSACTION_TYPE` updated from 3 stale values to 5 canonical intent values. 16/16 Phase 1.8-B tests PASS. 19/19 Phase 1.8-A PASS. 20/20 Phase 1.7 PASS. 30/30 Phase 1.6-B PASS. 73/73 Phase 1.6-A PASS. 13/13 typecheck+lint PASS. Total: 171/171. Traceability ? Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 00:02 | Phase 1.8-B ACCEPTED by owner after PASS. C-1: resolveUserId fixed `telegram_user_id`>`telegram_id`. C-2: onboarding SECURITY DEFINER functions hardened with `search_path = public, pg_catalog`. M-1: `TRANSACTION_TYPE` updated to canonical 5 intent values. 171/171 tests PASS. origin/main at `7af1692`. Working tree clean. |
| 2026-05-06 00:07 | workflow_state.md cleanup after Phase 1.8-B acceptance. Stale Sections 6тАУ9 corrected: Section 6 updated to Phase 1.8-B results; Section 7 set to advisory-only MCP access; Section 8 refreshed with advisory file list; Section 9 updated with COMPLETED/ACCEPTED handoff. No code changes. |
| 2026-05-06 00:27 | Phase 1.9 Basic Text /report Command implementation complete. `report.service.ts`: monthly report grouped by `transaction_intent`, `SUM(base_amount)` via NUMERIC, UTC month boundaries, Russian text output. `webhook.route.ts`: `/report` command intercepted before AI parse, resolves workspace+userId, calls report service. `workspace-resolver.ts`: `userId` added to `WorkspaceResolverResult`. Defense-in-depth: explicit `WHERE workspace_id = $1` alongside RLS. 47/47 Phase 1.9 tests PASS. 16/16 Phase 1.8-B PASS. 19/19 Phase 1.8-A PASS. 20/20 Phase 1.7 PASS. 30/30 Phase 1.6-B PASS. 73/73 Phase 1.6-A PASS. 13/13 typecheck+lint PASS. Total: 218/218. Traceability ? Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 09:08 | workflow_state.md sync after Phase 1.9 implementation. Sections 1, 2, 6тАУ9 corrected: Section 1 set to WAITING_FOR_OWNER_ACCEPTANCE_OF_PHASE_1_9; Section 2 Phase 1.9 row expanded with full artifact paths; Section 6 updated to Phase 1.9 results; Section 7 set to acceptance-audit-only MCP access; Section 8 refreshed with Phase 1.9 audit file list; Section 9 updated with acceptance handoff. No code changes. |
| 2026-05-06 10:00 | Phase 1.9 ACCEPTED by owner after final verification. Full test run: 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 218/218 PASS. Git clean pre/post tests. origin/main in sync. project_config.md unchanged (v1.2). Section 14 self-audit: all ?. Committed workflow_state.md, pushed tag phase-1.9-accepted. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 11:45 | Phase 1.10 Slash-Command Guard + Inline /help implementation complete. `parseCommandToken()` (exact first-token, @BotName strip), `KNOWN_COMMANDS` set, `/help` handler (Russian, lists /start /report /help), unknown-slash guard (5e). No command-registry, no new deps, no migrations, no AI changes. 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 248/248 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 11:55 | Phase 1.10 ACCEPTED by owner after final acceptance verification. Full test run: 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 248/248 PASS. Git clean pre/post tests. origin/main in sync. project_config.md unchanged (v1.2, last touched cc91a47). Commit b321463: 3 files only (webhook.route.ts, smoke-test-phase110.mjs, workflow_state.md). No command-registry.ts, no /balance, no migrations, no new deps. Section 14 self-audit: all ?. Tag phase-1.10-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 12:18 | Phase 1.11 /category Read-Only List Command implementation complete. `category.service.ts`: `getCategoryList()` read-only, `withTenantTransaction`, explicit `WHERE workspace_id = $1`, grouped by `category_group` (`╨С╨╕╨╖╨╜╨╡╤Б` before `╨Ц╨╕╨╖╨╜╤М`), Russian pluralization, empty-state message. `webhook.route.ts`: `/category` added to KNOWN_COMMANDS (4 commands), HELP_TEXT updated, handler block added after `/report`. DB audit: RLS `tenant_isolation_categories` (`cmd: ALL`) ?; `account_sources` not seeded on onboarding (debt item, no fix in Phase 1.11). 78/78 Phase 1.11 + 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 326/326 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 13:50 | Phase 1.11 ACCEPTED by owner after final verification. /category read-only command implemented; no write path, no migrations, no new deps, no AI changes. Final independent verification: 78/78 Phase 1.11 + 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 326/326 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit 2e77362. Tag phase-1.11-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 17:20 | Phase 1.12 Onboarding Default Data Seeding implementation complete. Currency finding: `workspaces.default_currency DEFAULT 'RUB'` confirmed тАФ no hardcoding beyond existing onboarding pattern. Migrations: `1778100000000_onboarding-default-seed.js` (7-param SECDEF function) + `1778100010000_fix-onboarding-seed-conflict.js` (PL/pgSQL ON CONFLICT ambiguity fix using named constraint). `onboarding.service.ts` extended to pass candidateAccountId + candidateCategoryId ($6/$7). Lazy fallback in `draft-confirmation.service.ts` preserved untouched (defense-in-depth). No route changes, no new slash commands, no queue/worker changes, no AI changes, no new deps. DB audit: 157 workspaces, 71 missing account_sources, 55 missing categories тАФ no backfill (lazy fallback covers them). 37/37 Phase 1.12 + 78/78 Phase 1.11 + 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 363/363 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 17:45 | workflow_state.md test-count fix: 344/344 > 363/363 (Phase 1.8-A 19 tests omitted from arithmetic sum). Commit 1b9a32a. No code changes. |
| 2026-05-06 18:40 | Phase 1.13 /add_category Strict-Format Command implementation complete. `category.service.ts`: `parseAddCategoryArgs()` (group case-insensitive normalization via ALLOWED_GROUPS, name trim+length validation), `resolveGroup()`, `addCategory()` (withTenantTransaction, INSERT ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING, ULID id, returns 'created'\|'duplicate'), `AddCategoryResult` type. `webhook.route.ts`: KNOWN_COMMANDS 4>5, HELP_TEXT updated with /add_category line + groups + example, handler `5e-add` (parseAddCategoryArgs > resolveWorkspace > addCategory > Russian reply; duplicate: ┬л╨Ъ╨░╤В╨╡╨│╨╛╤А╨╕╤П ╤Б ╤В╨░╨║╨╕╨╝ ╨╕╨╝╨╡╨╜╨╡╨╝ ╤Г╨╢╨╡ ╤Б╤Г╤Й╨╡╤Б╤В╨▓╤Г╨╡╤В.┬╗). No migrations, no new deps, no AI changes. Empty-state /category message updated. midas_app RLS WITH CHECK verified via separate appPool in Test 8. 74/74 Phase 1.13 + 37/37 Phase 1.12 + 78/78 Phase 1.11 + 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 437/437 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `eac55a9`. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 19:22 | Phase 1.14 /accounts Read-Only List Command implementation started. Owner APPROVED. |
| 2026-05-06 19:35 | Phase 1.14 implementation complete. `account.service.ts` (NEW): `getAccountList()` (withTenantTransaction, explicit WHERE workspace_id = $1, flat list ORDER BY type name, Russian labels, pluralization, empty-state). `webhook.route.ts`: KNOWN_COMMANDS 5>6, HELP_TEXT updated, handler `5d-acc`. `smoke-test-phase114.mjs`: 70 tests PASS. No migrations, no new deps, no AI/queue changes. 70/70 Phase 1.14 + 437/437 regression + 13/13 typecheck+lint = 507/507 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `362b05b`. |
| 2026-05-06 19:46 | Phase 1.14 ACCEPTED by owner after final verification. /accounts read-only command implemented; 507/507 tests PASS; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit `362b05b`. HTML escaping for account/category names must be considered before implementing user-controlled write paths such as /add_account. Tag `phase-1.14-accepted` pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 21:32 | Phase 1.15 HTML Escaping Hardening implementation complete. Owner APPROVED. `html-escape.ts` (NEW): `escapeHtml()` тАФ 5 chars escaped (`&`, `<`, `>`, `"`, `'`). `account.service.ts`: `escapeHtml` on `row.name`, `resolveTypeLabel(row.type)`, `row.currency`. `category.service.ts`: `escapeHtml` on category names, group labels, and `groupToken` in unknown-group error message (Traceability fix). `webhook.route.ts`: `escapeHtml` on `parsed.canonicalGroup` and `parsed.name` in `/add_category` success message. `smoke-test-phase115.mjs`: 52/52 PASS. No migrations, no new deps, no AI/queue changes. 52/52 Phase 1.15 + 494/494 regression smoke tests + 13/13 typecheck+lint = 559/559 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 21:56 | workflow_state.md test-count fix: 557/557 > 559/559 (final audit confirmed actual total; prior count incorrectly treated 507 as pure smoke-test baseline, double-counting 13 typecheck+lint tasks). Correct breakdown: 52 (Ph1.15) + 494 (Ph1.6-A through Ph1.14 smoke) + 13 (typecheck+lint) = 559. No code changes. |
| 2026-05-06 22:04 | Phase 1.15 accepted after final verification and workflow_state test-count fix; HTML escaping hardening implemented; 559/559 tests passed; Traceability Review PASS WITH FIXES; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 4f63a91; workflow_state sync commit 88ebae3; test-count fix commit 45b1eec. Tag phase-1.15-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 22:50 | Phase 1.16 account_sources UNIQUE Constraint Migration implementation complete. Owner APPROVED. Migration `1778200000000_account-sources-unique-name.js`: `up()` pre-flight duplicate check (0 found > safe) + `ALTER TABLE account_sources ADD CONSTRAINT account_sources_workspace_id_name_key UNIQUE(workspace_id, name)`. `down()` uses DROP CONSTRAINT IF EXISTS. `smoke-test-phase116.mjs`: 24/24 PASS. No TypeScript/route/service/worker/AI changes. 24/24 Phase 1.16 + 559/559 regression + 13/13 typecheck+lint = 583/583 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 22:46 | Phase 1.16 accepted after final verification; account_sources UNIQUE(workspace_id, name) constraint implemented; 583/583 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 3ad45e3. Tag phase-1.16-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 23:05 | Phase 1.17 /add_account Strict-Format Command implementation complete. Owner APPROVED. `account.service.ts` (MODIFY): `parseAddAccountArgs()` (first-space split, trim, empty check, max 100 char guard), `addAccount()` (withTenantTransaction, INSERT INTO account_sources VALUES ... 'manual'::account_source_type, 'RUB' ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING RETURNING id, returns created/duplicate), `AddAccountResult` type, `monotonicFactory` ULID. `webhook.route.ts` (MODIFY): KNOWN_COMMANDS 6>7, HELP_TEXT updated (`/add_account <╨╜╨░╨╖╨▓╨░╨╜╨╕╨╡> тАФ ╨Ф╨╛╨▒╨░╨▓╨╕╤В╤М ╤Б╤З╤С╤В`), handler `5e-add-acc` (parseAddAccountArgs > resolveWorkspace > addAccount > duplicate Russian message / success `escapeHtml` reply). `smoke-test-phase117.mjs` (NEW): 27/27 PASS. No migrations, no new deps, no AI/queue changes. 27/27 Phase 1.17 + 583/583 regression + 8/8 typecheck + 8/8 lint = 610/610 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 23:24 | Phase 1.17 accepted after final verification; /add_account strict-format command implemented; 610/610 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 8c370e3. Tag phase-1.17-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 00:08 | Phase 1.18 accepted after final verification; /report now shows base_currency labels and groups by transaction_intent + base_currency; smoke-test-phase19 runReportQuery() helper synced to production SQL; smoke-test-phase118.mjs (34 tests) added; 644/644 tests passed (34 Ph1.18 + 47 Ph1.9 + 563 Ph1.6-AтАУPh1.17 + 13 typecheck+lint); Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 700a244. Tag phase-1.18-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 02:00 | Phase 1.19 account_sources.currency CHECK Constraint implementation complete. Owner APPROVED. Migration `1778300000000_account-sources-currency-check.js` (NEW): pre-flight check (0 invalid rows found in 553 existing rows) + `ALTER TABLE account_sources ADD CONSTRAINT account_sources_currency_check CHECK (currency ~ '^[A-Z]{3,5}$')`. `smoke-test-phase119.mjs` (NEW): 24/24 PASS тАФ constraint existence, type, definition, valid codes (RUB/USD/EUR/GBP/BTC/ETH/USDT), invalid rejection (empty/lowercase/digits/spaces/6-char/2-char), no backfill, scope guard. No TypeScript/route/dep/AI/queue changes. 24/24 Phase 1.19 + 644/644 regression + 13/13 typecheck+lint = 668/668 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 02:25 | Phase 1.19 accepted after final verification; account_sources.currency CHECK constraint added with regex ^[A-Z]{3,5}$; 668/668 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 9d288bd. Tag phase-1.19-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 09:40 | Phase 1.20 Balance Semantics Design Document complete. Owner APPROVED. docs/balance-semantics.md created: 6 design decisions D1тАУD6 with recommended options (D1=A standard signed formula, D2=A integrated debt, D3=B transfer neutral, D4a=Yes add initial_balance, D4b=Yes allow negative, D4c=Yes account currency implicit, D4d=No defer initial_balance_at, D5=B per-account breakdown, D6=A all-time). Traceability ? Adversarial Security ? Scope Guard ?. No TypeScript, no migrations, no new commands. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 09:45 | Phase 1.20 ACCEPTED by owner. D1тАУD6 all confirmed as recommended. Owner Choice column filled in docs/balance-semantics.md. Approved formula and schema changes documented. No code, no migrations, no DB changes made in this phase. Tag phase-1.20-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 10:00 | Phase 1.21 Unified Balance Implementation complete. Owner APPROVED. Files: migrations/1778400000000_account-sources-initial-balance.js (NEW, migration applied, initial_balance NUMERIC(19,4) NOT NULL DEFAULT 0), balance.service.ts (NEW, two-query NUMERIC arithmetic in SQL, withTenantTransaction, escapeHtml), webhook.route.ts (MODIFY, /balance handler added, KNOWN_COMMANDS 7>8, HELP_TEXT updated). smoke-test-phase121.mjs (NEW, 28/28 PASS). 28/28 Phase 1.21 + 655/655 regression smoke (Ph1.6-AтАУPh1.19) + 13/13 typecheck+lint = 696/696 PASS (corrected from 709/709; Phase 1.5 server-dependent tests excluded from baseline, same as all prior phases). Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 10:15 | Phase 1.21 accepted after final verification; initial_balance migration and /balance command implemented; actual applicable tests 696/696 passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 976418a; note: stale /balance comment in webhook.route.ts line 31 is cosmetic tech debt, not fixed in this acceptance step. Tag phase-1.21-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 10:30 | Phase 1.22 Stale Comment Cleanup implementation complete. Owner APPROVED. `webhook.route.ts` (MODIFY, comment-only): slash-command routing header updated тАФ Phase 1.21 added to phase refs, all 8 known commands listed, stale тАЬ(e.g. /balance)тАЭ example removed. 0 logic changes. 13/13 typecheck+lint PASS. 696/696 regression baseline unchanged. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 10:35 | Phase 1.22 accepted after final verification; stale /balance comment in webhook.route.ts fixed; comment-only change; 13/13 typecheck+lint PASS; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit d2ea3fd. Tag phase-1.22-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 14:00 | Phase 1.23 /set_balance implementation complete. Owner APPROVED. `setBalance.service.ts` (NEW): `parseSetBalanceArgs()` (last-token-as-amount, AMOUNT_REGEX 15-digit cap, SEC-02), `setAccountBalance()` (LOWER() exact match, formula `new_initial_balance = target ? SUM(txns)` in PostgreSQL NUMERIC, withTenantTransaction SEC-03, defensive undefined guard replacing `!` non-null assertion), `formatSetBalanceResult()` (escapeHtml for all user strings). `webhook.route.ts` (MODIFY): import 3 functions from setBalance.service.js, KNOWN_COMMANDS 8>9, HELP_TEXT updated with /set_balance line, handler `5c-setbal` added (parseSetBalanceArgs > resolveWorkspace > setAccountBalance > formatSetBalanceResult). `smoke-test-phase123.mjs` (NEW): 34/34 PASS тАФ Groups A (10 parse tests), B (12 DB formula tests including negative/idempotent/resync/precision), C (8 security/scope tests), D (4 regression). 13/13 typecheck+lint PASS. No migrations, no new tables, no transactions created, no /report changes. Commit 65a8e56 pushed. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 14:51 | Phase 1.23 accepted after final verification; /set_balance implemented; synchronizes account balance by recalculating account_sources.initial_balance; no transactions created; no categories used; /report unaffected; 730/730 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 65a8e56; workflow_state sync commit 6b1df77. Tag phase-1.23-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 15:15 | Phase 1.24 Default Currency RUB > USDT implementation complete. Owner APPROVED. Migration 1778500000000_default-currency-usdt.js (NEW): ALTER TABLE workspaces SET DEFAULT 'USDT' + CREATE OR REPLACE FUNCTION system_find_or_create_user (7-param) with 'USDT' for workspace and account_sources INSERTs. ccount.service.ts (MODIFY): addAccount() reads workspace.default_currency dynamically via SELECT inside withTenantTransaction (SEC-03) тАФ fallback 'USDT'. smoke-test-phase112.mjs (MODIFY): 1 assertion USDT. smoke-test-phase117.mjs (MODIFY): doc comment + assertion updated. smoke-test-phase124.mjs (NEW): 20/20 PASS. No backfill. 1184 RUB workspaces untouched. 13/13 typecheck+lint PASS. 20/20 Phase 1.24 + 717/717 regression smoke (Ph1.6-AтАУPh1.23) + 13/13 typecheck+lint = 750/750 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 15:54 | Phase 1.24 accepted after final verification; default currency changed from RUB to USDT for new users; system_find_or_create_user creates USDT workspace and Default account; /add_account now uses workspace.default_currency dynamically; existing users/workspaces/transactions were not backfilled or recalculated; 750/750 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 97a4331. Tag phase-1.24-accepted pushed. |
| 2026-05-07 17:26 | Phase 1.25 accepted after final verification; /settings text mode implemented; timezone column added; default_currency and timezone settings supported; draft fallback now uses workspace.default_currency instead of hardcoded USD; existing transactions/accounts were not recalculated or backfilled; 782/782 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit f6307a1; test fix commit 2eaccc7; workflow sync commit f79dc7b. Tag phase-1.25-accepted pushed. |
| 2026-05-07 18:03 | Phase 1.26 accepted after final verification; /settings UI with inline keyboards implemented; stablecoins/crypto/fiat pagination added; Redis-backed search state with strict TTL implemented securely; timezone UI deferred; 100 currency constants isolated; 827/827 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit fb338db; docs fix commit d8d896b. Tag phase-1.26-accepted pushed. |
| 2026-05-07 18:33 | Phase 1.27 accepted after final verification; /balance currency-mixing defect fixed via SQL-level exclusion where transactions.base_currency != account_sources.currency; mismatch warning footnote added; roadmap output format improved; no conversion, no backfill, no migration, no /report changes; 854/854 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 12e70d9; docs fix commit dec0a52. Tag phase-1.27-accepted pushed. |
| 2026-05-07 19:25 | Phase 1.28 accepted after final verification; /edit command implemented with recent paginated list (10/page), transaction card, amount/category/account/intent edit flows, Redis TTL 300s state for amount input (key midas:edit:{userId}:{chatId}), permanent [?? ╨Ш╨╖╨╝╨╡╨╜╨╕╤В╤М] button after approval, strict callback_data limit verified at max 62 bytes (ed:c:cat:<26>:<26>), no search/date/delete/soft-delete/GIN index, no migrations, no /balance or /report changes, no new dependencies; amount edits blocked for cross-currency (exchange_rate ? 1.0); all DB mutations via withTenantTransaction + explicit workspace_id filter; 43/43 Phase 1.28 smoke + 841/841 regression smoke + 13/13 typecheck/lint = 897/897 total gates PASS; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit c8bbc7d; workflow commit 1807d93. Tag phase-1.28-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 22:06 | Phase 1.29 implemented: soft delete for transactions. Migration 1778700000000_transactions-soft-delete applied (deleted_at TIMESTAMPTZ DEFAULT NULL). deleted_at IS NULL guard added to 11 query locations (7 in edit.service, 2 JOIN ON in balance.service, 1 in report.service, 1 subquery in setBalance.service). Double-confirmation UX: [??? ╨г╨┤╨░╨╗╨╕╤В╤М] > warning > [??? ╨Ф╨░, ╤Г╨┤╨░╨╗╨╕╤В╤М]/[?? ╨Ю╤В╨╝╨╡╨╜╨░]. softDeleteTransaction() with D1+D6 fetch-before-update. callback_data max 35 bytes (ed:d:ask:<ULID> ? 64 ?). Graceful fallback for old edit buttons on already-deleted transactions. smoke-test-phase128.mjs A3/J1 scope guards updated to reflect Phase 1.29. smoke-test-phase129.mjs: 44/44 PASS. Full regression: 44/44 Phase 1.29 + 43/43 Phase 1.28 + 841/841 prior phases + 13/13 typecheck/lint = 941/941 total gates PASS (excl. Phase 1.5 bot-server tests тАФ pre-existing). No hard delete. No restore. No new deps. No project_config.md changes. Implementation commit 7082540. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 20:23 | Phase 1.29 accepted after final verification; soft delete (transactions.deleted_at) added; double-confirmation delete UX implemented; deleted txs safely excluded from /edit, /balance (LEFT JOIN preserved), /report, /set_balance; zero hard deletes/restores; 941/941 gates PASS; Traceability, Adversarial Security & Scope Guard PASS; impl commit 7082540; workflow commit 723a89b. Tag phase-1.29-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 20:55 | Phase 1.30 implemented: Smart Account Onboarding. account-onboard-keyboard.service.ts (NEW): ac: namespace, parseAccountCallback() allowlist, keyboards for type/exchange/currency/post-create. account.service.ts (MODIFY): hasAccounts() lightweight COUNT, addAccountWithCurrency() explicit currency. webhook.route.ts (MODIFY): ac: callback block, /accounts empty-state > guided keyboard, /start new users > buildStartOnboardKeyboard(), midas:ac: text intercept for name/currency steps. No migration, no enum changes, no new deps, no new slash commands. Max callback_data 17 bytes (ac:cur:AAAAAAAAAA). Redis TTL 300s. 64/64 Phase 1.30 smoke + 197/197 accessible regression + 13/13 typecheck/lint PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 21:10 | Phase 1.30 accepted after final verification; smart account onboarding UX added for /start and empty /accounts; ac: callback namespace implemented; Redis TTL state midas:ac:{telegramUserId}:{chatId} added; existing silent Default account creation preserved; all new accounts remain type='manual'; no migrations, no DB function changes, no new deps, no new slash commands; 64/64 Phase 1.30 smoke passed; accessible gates 318/318 passed; legacy host-limited suites unchanged from prior baseline; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 4593867; workflow commit 99a2964. Tag phase-1.30-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 21:20 | Phase 1.31 advisory delivered: Inline account creation during transaction input. Scope: account_hint optional field in AI schema; parsed_account_hint TEXT column in transaction_drafts (1 migration); account-fuzzy.service.ts (NEW, Jaro-Winkler, short-ticker exact-only); account-inline-keyboard.service.ts (NEW, ia: namespace); midas:ia:{draftId} Redis TTL 300s for rename sub-flow; addAccountWithCurrency() reused from Phase 1.30; max callback_data 60 bytes (ia:use:{accountId}:{draftId}); Scenario ╨С (transfer) excluded тАФ Phase 1.32+; Option A architecture (resolve in ai-parse worker before first keyboard). No code changes. Awaiting owner APPROVED. |
| 2026-05-07 22:00 | Phase 1.31 accepted after final verification; parsed_account_hint added to transaction_drafts; optional AI account_hint added; Option A implemented тАФ account resolution before final draft confirmation; exact match sets draft.account_id silently; fuzzy/no-match account UX added; ia: callback namespace implemented with max 62 bytes; Redis rename state used only for temporary custom-name flow; transfer dual-account excluded; no to_account_id; no new deps; no Mini App; Phase 1.31 smoke 27/27 PASS; key regression gates PASS; typecheck/lint 13/13 PASS; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 7c065f7; workflow commit 04209fc. Tag phase-1.31-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-08 08:00 | Phase 1.32 Smart Text Input / Clarification Engine implemented and accepted. Migration 1778900000000_draft-clarification-state.js: `needs_clarification` status added to transaction_drafts state machine trigger. AI pipeline updated: amount/intent optional in schema, `PARTIAL_CONFIDENCE_THRESHOLD=0.3`, `MissingField` type, `partial` ParseResult status, `computeMissingFields()`. New `clarification.service.ts` in telegram-bot: `clar:` callback namespace for intent/category selection, `midas:clar:` Redis TTL 300s for amount text intercept. `webhook.route.ts`: clar: callback handler, clarification text intercept, buildClarificationScreen usage. `draft.service.ts`: `patchDraftAmount()`, `patchDraftIntent()`, `patchDraftCategory()` тАФ atomic field patches returning `{status: 'ready'\|'still_needs', field}`. 57/57 Phase 1.32 smoke PASS. 0 lint/typecheck errors. Implementation commit e00f37e. Tag `phase-1.32-accepted` pushed. |
| 2026-05-08 09:00 | Phase 1.33 Clean Chat / Single Active Message UX implemented and accepted. UX-only phase тАФ no migrations, no DB schema changes. `active-message.service.ts` (NEW): Redis pointer `midas:am:{userId}:{chatId}` (TTL 24h) tracks the current bot message per chat. `telegram-api.ts` (MODIFY): `upsertBotMessage()` edit-first strategy тАФ tries `editMessageText`, falls back to `sendMessage`, updates Redis pointer. All workers (ai-parse, confirmation, notifications) now use edit-first pattern. `shared/index.ts` (MODIFY): `NotificationJobPayload` extended with `telegramUserId` + `activeMessageId`. Result: bot edits its last message instead of sending new ones тАФ clean single-screen app UX. 0 typecheck errors. Batch-accepted by owner decision. Commit 36cacd7. Tag `phase-1.33-accepted` pushed. |
| 2026-05-08 09:30 | Phase 1.34 Rich Screen Cards implemented and accepted. UX-only phase тАФ no migrations, no DB schema changes. `screen-builder.ts` (NEW in both `telegram-bot` and `background-workers`): pure functions for all UI screens тАФ `buildPreviewScreen()`, `buildConfirmedScreen()`, `buildClarificationScreen()`, `buildConfirmKeyboard()`, `buildPostConfirmKeyboard()`, `buildNavKeyboard()`, `intentEmoji()`, `intentLabel()`, `escapeHtml()`. Replaces hardcoded text strings across all workers and route handlers with standardized card templates. 0 typecheck errors. Batch-accepted by owner decision. Commit 6e899f0. Tag `phase-1.34-accepted` pushed. |
| 2026-05-08 11:00 | Phase 1.35 Intelligent Transaction Understanding тАФ core implementation complete. Migration `1779000000000_intelligent-transactions.js`: `item_name TEXT` + `parsed_category_hint TEXT` columns on transaction_drafts; `item_name TEXT` on transactions; `default_expense_account_id` + `default_income_account_id` FK columns on workspaces; `category_group` ENUM; 28-category taxonomy backfill; SECDEF onboarding function updated. `category-resolver.service.ts` (NEW): 3-stage pipeline тАФ exact DB match > 200+ alias map > fallback ┬л╨Ф╤А╤Г╨│╨╛╨╡┬╗. `prompts.ts` + `schemas.ts`: `item_hint` + `category_hint` added to AI schema with examples. `draft.service.ts`: propagates item_name, parsed_category_hint. `draft-confirmation.service.ts`: CategoryResolver integration, resolveDefaultAccount() with workspace defaults > LIMIT 1 > auto-create. `confirmation.worker.ts`: rich post-confirm cards with item/category. smoke-test-phase135.mjs: 55 tests PASS. 5/5 typecheck PASS. Deployed to Railway. |
| 2026-05-08 16:20 | Phase 1.35 hotfix #1: Rich preview cards across all confirmation entry points. Problem: after clarification (amount/intent/category selection), generic text like ┬л?? ╨У╨╛╤В╨╛╨▓╨╛. ╨Я╨╛╨┤╤В╨▓╨╡╤А╨┤╨╕╤В╨╡ ╨╕╨╗╨╕ ╨╛╤В╨║╨╗╨╛╨╜╨╕╤В╨╡:┬╗ was shown instead of the rich transaction card. Fix: introduced `confirmKb(draftId)` centralized keyboard helper (DRY pattern replacing 8 hardcoded keyboards) and `confirmPreview(workspaceId, userId, draftId)` helper (fetches draft data via `getDraftFields` > builds rich card via `buildPreviewScreen`). All 8 confirmation entry points updated: ia:skip, ia:create (new account), ia:use (select account), clar:intent, clar:category, clar:nocat, clarification amount text intercept, ia rename text intercept. Typecheck 5/5 PASS. Commit d037f75. Deployed to Railway. |
| 2026-05-08 16:29 | Phase 1.35 hotfix #2: Defensive String() coercion for Postgres NUMERIC amounts. Problem: `fetchApprovedTransactionCard` and `approveDraft` returned `amount` as raw Postgres NUMERIC (JavaScript `number`), but `buildConfirmedScreen` passed it to `escapeHtml()` which calls `.replace()` тАФ crashed with `TypeError: input.replace is not a function`. Root cause: pg driver returns NUMERIC as `number`, not `string`. Fix: (1) `approveDraft`: `amount: String(draft.parsed_amount ?? '0')`, (2) `fetchApprovedTransactionCard`: `amount: String(tx.original_amount)`, (3) `escapeHtml`: defensive `typeof input === 'string' ? input : String(input)`. Also fixed incorrect SQL column names in `fetchApprovedTransactionCard`: `amount` > `original_amount`, `account_source_id` > `account_id`. Typecheck 5/5 PASS. Commit 6db3d69. Deployed to Railway. |
| 2026-05-09 09:46 | Phase 1.36-UX Sub-step 1: Persistent Navigation Keyboard (core). `telegram-api.ts` тАФ `ReplyKeyboardMarkup` interface + `sendMessageWithReplyKeyboard()`. `screen-builder.ts` (telegram-bot) тАФ `buildMainMenuKeyboard()`, `NAV_BTN_BALANCE/REPORT/SETTINGS`, `input_field_placeholder`. `webhook.route.ts` тАФ Reply Keyboard sent on /start (new+existing users), 3 text intercepts before AI parse for [?? ╨С╨░╨╗╨░╨╜╤Б]/[?? ╨Ю╤В╤З╤С╤В]/[?? ╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕] buttons. Collateral lint: `ai-core/claude-client.ts` (no-useless-assignment), `draft-confirmation.service.ts` (no-unnecessary-type-conversion ?3), both `screen-builder.ts` (restrict-template-expressions). 13/13 PASS. |
| 2026-05-09 10:00 | Phase 1.36-UX Sub-step 2: UX Bug Fixes & Consistency. (1) `webhook.route.ts` confirmKb layout standardized: ? full-width top row + [?? ╨Ш╨╖╨╝╨╡╨╜╨╕╤В╤М|?? ╨Ю╤В╨╝╨╡╨╜╨░] split row тАФ matches workers layout. (2) `redisConnection.del(clarKey)` added on approve/reject in `webhook.route.ts` тАФ prevents stale `midas:clar:*` key intercepting next user message after confirmation (silent message discard race condition fixed). (3) `screen-builder.ts` both apps тАФ emoji ?>?? for visual weight parity with ? and ??. 13/13 PASS. Commit `c2f012f`. |
| 2026-05-09 10:12 | Phase 1.36-UX Sub-step 3: Reply Keyboard auto-activation. `shared/index.ts` тАФ `replyKeyboardJson?` added to `NotificationJobPayload` (documented: only valid on sendMessage, not editMessageText). `background-workers/screen-builder.ts` тАФ `buildNavKeyboard()` replaced by `buildMainMenuReplyKeyboard()` (returns plain JS object with `keyboard` array, not InlineKeyboard); `buildPostConfirmKeyboard()` nav row [?? ╨С╨░╨╗╨░╨╜╤Б][?? ╨Ю╤В╤З╤С╤В] removed тАФ only [?? ╨Ш╨╖╨╝╨╡╨╜╨╕╤В╤М ╨╖╨░╨┐╨╕╤Б╤М] remains. `confirmation.worker.ts` тАФ import updated (buildNavKeyboard>buildMainMenuReplyKeyboard); rejected/expired/intent_missing now pass `replyKeyboardJson` (not `inlineKeyboardJson`). `notifications.worker.ts` тАФ keyboard routing split: `inlineReplyMarkup` for editMessageText path, `freshReplyMarkup` (prefers replyKeyboardJson) for sendMessage path. Reply Keyboard auto-activates on first new message without /start. 13/13 PASS. Commit `f10aa22`. |
| 2026-05-09 10:20 | Phase 1.36-UX Sub-step 4: Keyboard collapsibility. `screen-builder.ts` both apps тАФ `is_persistent: true` > `is_persistent: false`. Result: Telegram displays standard ? collapse icon next to ?? microphone button; user can hide/restore keyboard at will; keyboard re-appears on next bot sendMessage. 13/13 PASS. Commit `062d40d`. Deployed to Railway. |
| 2026-05-09 12:57 | Phase 1.36-UX FINAL (accepted): Transaction history workflow + permanent keyboard. **╨Я╤А╨╛╨▒╨╗╨╡╨╝╨░:** edit-first ╤Б╤В╤А╨░╤В╨╡╨│╨╕╤П ╤З╨╡╤А╨╡╨╖ `midas:am:` pointer ╨┐╨╡╤А╨╡╨╖╨░╨┐╨╕╤Б╤Л╨▓╨░╨╗╨░ ╨┐╤А╨╡╨┤╤Л╨┤╤Г╤Й╤Г╤О ╨║╨░╤А╤В╨╛╤З╨║╤Г ╨▓╨╝╨╡╤Б╤В╨╛ ╤Б╨╛╨╖╨┤╨░╨╜╨╕╤П ╨╜╨╛╨▓╨╛╨╣ тАФ ╨╕╤Б╤В╨╛╤А╨╕╤П ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╣ ╨╜╨╡ ╨╜╨░╨║╨░╨┐╨╗╨╕╨▓╨░╨╗╨░╤Б╤М. **╨а╨╡╤И╨╡╨╜╨╕╨╡:** (1) `ai-parse.worker.ts` тАФ ╤Г╨▒╤А╨░╨╜ `activeMessageId` ╨╕╨╖ preview notifications; ╨║╨░╨╢╨┤╨░╤П preview-╨║╨░╤А╤В╨╛╤З╨║╨░ ╨▓╤Б╨╡╨│╨┤╨░ ╨╛╤В╨┐╤А╨░╨▓╨╗╤П╨╡╤В╤Б╤П ╨║╨░╨║ ╨╜╨╛╨▓╨╛╨╡ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡. (2) `notifications.worker.ts` тАФ ╨┐╤А╨╕ ╨╛╤В╨┐╤А╨░╨▓╨║╨╡ preview (draftId ╨┐╤А╨╕╤Б╤Г╤В╤Б╤В╨▓╤Г╨╡╤В) ╨╖╨░╨┐╨╕╤Б╤Л╨▓╨░╨╡╤В `sentMessageId` ╨▓ Redis `midas:preview:{draftId}` TTL 600s; ╤Г╨┤╨░╨╗╤С╨╜ `setActiveMessagePointer` ╨╕ ╨▓╨╡╤Б╤М AM-pointer ╨╝╨╡╤Е╨░╨╜╨╕╨╖╨╝. (3) `confirmation.worker.ts` тАФ ╨╜╨░ approve ╤З╨╕╤В╨░╨╡╤В `midas:preview:{draftId}` > ╨┐╨╡╤А╨╡╨┤╨░╤С╤В ╨║╨░╨║ `activeMessageId` ╨▓ notifications (edit preview>confirmed in-place); ╨╜╨░ reject тАФ `activeMessageId` ╨╜╨╡ ╨┐╨╡╤А╨╡╨┤╨░╤С╤В╤Б╤П > ╨╜╨╛╨▓╨╛╨╡ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡. (4) Greeting: ╨Э╨Х ╤Г╨┤╨░╨╗╤П╨╡╤В╤Б╤П тАФ ╨╛╤Б╤В╨░╤С╤В╤Б╤П ╨┐╨╛╤Б╤В╨╛╤П╨╜╨╜╤Л╨╝ ╨╜╨╛╤Б╨╕╤В╨╡╨╗╨╡╨╝ ReplyKeyboard; ╨▓╨╡╤Б╤М ╨║╨╛╨┤ ╤Г╨┤╨░╨╗╨╡╨╜╨╕╤П (deleteMessage + nav carrier) ╤Г╨▒╤А╨░╨╜. `greetingMsgId` ╤Г╨┤╨░╨╗╤С╨╜ ╨╕╨╖ `NotificationJobPayload`. `shared` ╨┐╨╡╤А╨╡╤Б╨╛╨▒╤А╨░╨╜. Typecheck 0 errors (╨╛╨▒╨░ ╨┐╤А╨╕╨╗╨╛╨╢╨╡╨╜╨╕╤П). Commits `e879dfc` > `2cb86c4` > `8941c6d` > `2a15f31`. Deployed to Railway. ╨Я╤А╨╛╤В╨╡╤Б╤В╨╕╤А╨╛╨▓╨░╨╜╨╛: 4 ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕ ╨╖╨░╨┐╨╕╤Б╨░╨╜╤Л, ╨╕╤Б╤В╨╛╤А╨╕╤П ╨╜╨░╨║╨░╨┐╨╗╨╕╨▓╨░╨╡╤В╤Б╤П, ╨║╨╗╨░╨▓╨╕╨░╤В╤Г╤А╨░ [?? ╨С╨░╨╗╨░╨╜╤Б][?? ╨Ю╤В╤З╤С╤В][?? ╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕] ╨┐╨╛╤Б╤В╨╛╤П╨╜╨╜╨╛ ╨▓╨╕╨┤╨╜╨░. |
| 2026-05-09 13:09 | Phase 1.37 Step 1: Zero-clutter UX. `screen-builder.ts` (background-workers): `buildNonsenseScreen()` rewritten тАФ removed all inline buttons ([?? ╨а╨░╤Б╤Е╨╛╨┤][?? ╨Ф╨╛╤Е╨╛╨┤][?? ╨Ф╨╛╨╗╨│ ╨┤╨░╨╗][?? ╨Ф╨╛╨╗╨│ ╨▓╨╖╤П╨╗]), replaced with Variant 5 text-only prompt with input examples (`╨║╨╛╤Д╨╡ 150 UAH ┬╖ ╨╖╨░╤А╨┐╨╗╨░╤В╨░ 5000 USDT`). `ai-parse.worker.ts`: added stale "╨Э╨╡ ╨┐╨╛╨╜╤П╨╗" message deletion тАФ stores `midas:clar:msg:{userId}:{chatId}` Redis key pointing to nonsense message_id; on next successful parse, deletes the old nonsense message via `deleteMessage()` API before sending new preview. `telegram-api.ts`: `editTelegramMessage()` тАФ treats "message is not modified" 400 error as success (no redundant message generation). Typecheck 8/8 PASS. Commits `a4d49a9` > `ee85e5f`. |
| 2026-05-09 13:34 | Phase 1.37 Step 2: Category taxonomy expansion. `prompts.ts`: Expanded from 28 to 30 categories (added ╨Я╨╕╤В╨╛╨╝╤Ж╤Л, ╨Ф╨╛╨╝). International 500+ anchor items mapping: every category now has typical items across CIS (╨Я╤П╤В╤С╤А╨╛╤З╨║╨░, ╨Р╨в╨С, ╨б╤Ц╨╗╤М╨┐╨╛), EU (Lidl, Biedronka, IKEA), US (Walmart, Costco, Amazon, Starbucks) markets. Business categories expanded with global services: AWS, Stripe, Upwork, Fiverr, Google Ads, Facebook Ads, Notion, Figma, etc. Pet category: Royal Canin, Whiskas, Pro Plan, ╨╜╨░╨┐╨╛╨╗╨╜╨╕╤В╨╡╨╗╤М, ╨▓╨╡╤В╨╡╤А╨╕╨╜╨░╤А. ╨Ф╨╛╨╝: ╨╝╨╛╤О╤Й╨╕╨╡ ╤Б╤А╨╡╨┤╤Б╤В╨▓╨░, ╤В╤А╤П╨┐╨║╨╕, ╨┐╨╛╨╗╨╛╤В╨╡╨╜╤Ж╨░, ╤И╤В╨╛╤А╤Л, ╨╝╨╡╨▒╨╡╨╗╤М. Typecheck 8/8 PASS. Commits `77a0ad9` > `5b02cf3`. |
| 2026-05-09 14:09 | Phase 1.37 Step 3: Multilingual recognition + fuzzy matching. `prompts.ts`: Added MULTILINGUAL RECOGNITION section (RU/EN/UA тАФ any language maps to correct category). FUZZY MATCHING section (typos: ╨║╨╛╤Д╤Н>╨║╨╛╤Д╨╡, ╨╜╨╡╤В╤Д╨╗╨╕╨║╤Б>Netflix; slang: ╨║╨╛╨╝╤Г╨╜╨░╨╗╨║╨░>╨║╨╛╨╝╨╝╤Г╨╜╨░╨╗╨║╨░>╨Ц╨╕╨╗╤М╤С; transliteration: kafe>╨║╨░╤Д╨╡, taksi>╤В╨░╨║╤Б╨╕). KEY BILINGUAL PAIRS for non-obvious translations (╤И╨╕╨╜╨╛╨╝╨╛╨╜╤В╨░╨╢=tire service, ╤Н╨║╨▓╨░╨╣╤А╨╕╨╜╨│=payment processing, ╨┐╨╛╨┤╨│╤Г╨╖╨╜╨╕╨║╨╕=diapers, ╨╜╨░╨┐╨╛╨╗╨╜╨╕╤В╨╡╨╗╤М=cat litter, etc.). Commit `e147240`. |
| 2026-05-09 14:10 | Phase 1.37 Step 4: Disambiguation rules + compound expressions + default intent priority. `prompts.ts`: Added 15 DISAMBIGUATION RULES (╤В╨╛╤А╤В>╨Я╤А╨╛╨┤╤Г╨║╤В╤Л/╨Я╨╛╨┤╨░╤А╨║╨╕/╨Ъ╨░╤Д╨╡ by context; ╨║╨╛╤Д╨╡>╨Ъ╨░╤Д╨╡/╨Я╤А╨╛╨┤╤Г╨║╤В╤Л; ╤Б╤В╤А╨░╤Е╨╛╨▓╨║╨░>╨в╤А╨░╨╜╤Б╨┐╨╛╤А╤В/╨Ч╨┤╨╛╤А╨╛╨▓╤М╨╡/╨Я╤Г╤В╨╡╤И╨╡╤Б╤В╨▓╨╕╤П; ╤А╨╡╨╝╨╛╨╜╤В>╨Ц╨╕╨╗╤М╤С/╨в╤А╨░╨╜╤Б╨┐╨╛╤А╤В/╨Ю╨▒╨╛╤А╤Г╨┤╨╛╨▓╨░╨╜╨╕╨╡; ╨▓╨╕╤В╨░╨╝╨╕╨╜╤Л>╨Ч╨┤╨╛╤А╨╛╨▓╤М╨╡/╨Я╨╕╤В╨╛╨╝╤Ж╤Л; etc.). COMPOUND EXPRESSIONS (╨┐╨╛╨┤╨░╤А╨╛╨║ ╨╢╨╡╨╜╨╡>╨Я╨╛╨┤╨░╤А╨║╨╕, ╨║╨╛╤А╨╝ ╨┤╨╗╤П ╨║╨╛╤В╨░>╨Я╨╕╤В╨╛╨╝╤Ж╤Л, ╨▒╨╕╨╗╨╡╤В ╨▓ ╨║╨╕╨╜╨╛>╨а╨░╨╖╨▓╨╗╨╡╤З╨╡╨╜╨╕╤П). DEFAULT INTENT PRIORITY (item+amount without verb = expense by default; income/transfer require explicit signal). Commit `03981d7`. |
| 2026-05-09 14:14 | Phase 1.37 Step 5: ALLOWED_CATEGORIES code validation. `claude-client.ts`: Added `ALLOWED_CATEGORIES` Set (30 categories тАФ 18 personal + 12 business). Post-Zod validation step: if `aiData.category_hint` is not in the set, replace with `╨Ф╤А╤Г╨│╨╛╨╡`. Prevents hallucinated categories from reaching CategoryResolverService. Typecheck 8/8 PASS. |
| 2026-05-09 14:16 | Phase 1.37 Step 6: Documentation updates. `product-roadmap.md`: Added Phase 2.0 тАФ AI Intelligence Evolution (3 components: 2.0-A self-learning from user edits, 2.0-B custom category recognition, 2.0-C regional bias from currency). Phase 1.37 + 2.0 added to summary table. Block 4 renamed from "╨У╨╛╨╗╨╛╤Б ╨╕ Vision" to "AI Intelligence ╨╕ Voice". `project_config.md`: Updated to v1.4, changelog v1.4 added, Section 2.8 AI Pipeline updated with multilingual/disambiguation/validation info. Commit `06bccb0`. Deployed to Railway. |
| 2026-05-09 15:18 | Phase 1.37 complete. `workflow_state.md` updated: Section 1 (status > COMPLETE), Section 2 (Phase 1.37 row added), Section 3 (AI Pipeline updated), Section 4 (project_config v1.4), Section 10 (7 history entries). All documents synchronized. |
| 2026-05-09 15:38 | Phase 1.37 VERIFICATION & ACCEPTANCE. 13/13 typecheck+lint PASS. CategoryResolver: ╨Я╨╕╤В╨╛╨╝╤Ж╤Л/╨Ф╨╛╨╝ aliases added. Commit `641ad26`. Deployed to Railway. |
| 2026-05-09 19:00 | **Phase 1.38 Fix #1:** Confirmation card not deleted on Cancel. `confirmation.worker.ts` reads `midas:preview:{draftId}` on both approve and reject paths тАФ in-place edit to ? ╨Ю╤В╨╝╨╡╨╜╨╡╨╜╨╛. |
| 2026-05-09 19:04 | **Phase 1.38 Fix #2:** Unified blockquote currency prompt (Variant B). `screen-builder.ts` both apps: `<code>` tags replaced with blockquote text тАФ no more green tap-able capsules. |
| 2026-05-09 19:05 | **Phase 1.38 Fix #3:** `amt+cur` handler used `validateCurrencyCode()` (ISO-only) instead of `normalizeCurrencyInput()`. Fixed. `awaiting_cur` now extracts currency token from mixed input (e.g. ┬л50 ╨╡╨▓╤А╨╛┬╗). Commit `d59025f`. |
| 2026-05-09 19:18 | **Phase 1.38 Rollback:** PRICE vs QUANTITY AI prompt rule reverted. Caused regressions (┬л150 ╨║╤Г╤А╤В╨╛╨║┬╗ not extracted as amount). Design decision: personal finance bots ALWAYS treat any number as a price. Original rule restored: ┬лIf ANY number present > ALWAYS extract as amount┬╗. Final commit `c59f2e1`. |
| 2026-05-10 10:08 | **Phase 1.39 тАФ Gate UX Edit-In-Place (Variant B).** `formatAmount()` ╨▓ ╨╛╨▒╨╛╨╕╤Е screen-builder.ts ╨╕╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜: `String()` cast ╨┤╨╗╤П Postgres NUMERIC ╤В╨╕╨┐╨░ тАФ ╤Г╤Б╤В╤А╨░╨╜╤С╨╜ TypeError (`raw.includes is not a function`). `clarification.service.ts`: `::TEXT` cast ╨╜╨░ `parsed_amount` ╨▓ 2 SQL-╨╖╨░╨┐╤А╨╛╤Б╨░╤Е. `buildGatePausedPreview()` ╨╛╨▒╨╜╨╛╨▓╨╗╤С╨╜: ?? ╨░╨╗╨╡╤А╤В-╨▒╨░╨╜╨╜╨╡╤А + summary ╤З╨╡╤А╨╜╨╛╨▓╨╕╨║╨░ (╨▓╨╝╨╡╤Б╤В╨╛ ╤Б╤В╨░╤А╨╛╨│╨╛ ╤В╨╡╨║╤Б╤В╨░ ╨▒╨╡╨╖ ╨┤╨░╨╜╨╜╤Л╤Е). ╨С╨╗╨╛╨║ gate ╨▓ `ai-parse.worker.ts` ╨┐╨╡╤А╨╡╤А╨░╨▒╨╛╤В╨░╨╜: ╨▓╨╝╨╡╤Б╤В╨╛ 2 ╨╜╨╛╨▓╤Л╤Е ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╣ (paused edit + gate card) тАФ **╨╛╨┤╨╕╨╜** edit-in-place ╤Б╤Г╤Й╨╡╤Б╤В╨▓╤Г╤О╤Й╨╡╨╣ preview-╨║╨░╤А╤В╨╛╤З╨║╨╕ ╤Б ╨░╨╗╨╡╤А╤В╨╛╨╝ ╨╕ ╤Б╨╛╤Е╤А╨░╨╜╨╡╨╜╨╕╨╡╨╝ ╨║╨╗╨░╨▓╨╕╨░╤В╤Г╤А╤Л ╨┐╨╛╨┤╤В╨▓╨╡╤А╨╢╨┤╨╡╨╜╨╕╤П. Commits `8fa8f91` > `089abf6`. Deployed to Railway тАФ SUCCESS. |
| 2026-05-10 10:30 | **Phase 1.40 тАФ Dead Card Auto-Cleanup.** ╨Ы╨╛╨│╨╕╨║╨░: ╨║╨░╤А╤В╨╛╤З╨║╨╕ ┬л? ╨Ю╤В╨╝╨╡╨╜╨╡╨╜╨╛┬╗ ╨╕ ┬л? ╨з╨╡╤А╨╜╨╛╨▓╨╕╨║ ╨╕╤Б╤В╤С╨║┬╗ ╨░╨▓╤В╨╛╨╝╨░╤В╨╕╤З╨╡╤Б╨║╨╕ ╤Г╨┤╨░╨╗╤П╤О╤В╤Б╤П ╨╕╨╖ ╤З╨░╤В╨░ ╨║╨╛╨│╨┤╨░ ╨┐╨╛╤П╨▓╨╗╤П╨╡╤В╤Б╤П ╤Б╨╗╨╡╨┤╤Г╤О╤Й╨░╤П preview-╨║╨░╤А╤В╨╛╤З╨║╨░. ╨Т ╤З╨░╤В╨╡ ╨╛╤Б╤В╨░╤О╤В╤Б╤П ╤В╨╛╨╗╤М╨║╨╛: pending (╨╢╨┤╤С╤В ╨┐╨╛╨┤╤В╨▓╨╡╤А╨╢╨┤╨╡╨╜╨╕╤П) + approved (? ╨Ч╨░╨┐╨╕╤Б╨░╨╜╨╛). ╨а╨╡╨░╨╗╨╕╨╖╨░╤Ж╨╕╤П: `confirmation.worker.ts` тАФ ╨┐╨╛╤Б╨╗╨╡ reject/expired ╤Б╨╛╤Е╤А╨░╨╜╤П╨╡╤В `previewMsgId` ╨▓ Redis `midas:dead_card:{chatId}` TTL 24h. `draft-expiration.worker.ts` тАФ CRON expiry ╤В╨╛╨╢╨╡ ╨┐╨╕╤И╨╡╤В dead_card. `ai-parse.worker.ts` тАФ ╨┐╨╡╤А╨╡╨┤ ╨╛╤В╨┐╤А╨░╨▓╨║╨╛╨╣ ╨╜╨╛╨▓╨╛╨╣ preview ╤З╨╕╤В╨░╨╡╤В dead_card, ╨┐╨╡╤А╨╡╨┤╨░╤С╤В ╨║╨░╨║ `deleteMessageId`, ╤Г╨┤╨░╨╗╤П╨╡╤В ╨║╨╗╤О╤З. ╨Х╤Б╨╗╨╕ ╨╛╨┤╨╜╨╛╨▓╤А╨╡╨╝╨╡╨╜╨╜╨╛ ╨╡╤Б╤В╤М dead_card ╨╕ clar_msg тАФ ╨┐╤А╨╕╨╛╤А╨╕╤В╨╡╤В ╤Г dead_card. TypeScript: 0 ╨╛╤И╨╕╨▒╨╛╨║. Commit `51eaf10`. Deployed to Railway тАФ SUCCESS. |
| 2026-05-10 15:30 | **Phase 2.0 тАФ Transaction Hub + Reports 2.0 + Settings 2.0 deployed.** GitHub auto-deploy from `main`. |
| 2026-05-10 18:44 | **Phase 2.1 тАФ Account Management Dashboard.** ╨Я╨╛╨╗╨╜╨░╤П ╤А╨╡╨░╨╗╨╕╨╖╨░╤Ж╨╕╤П ╨╕╨╜╤В╨╡╤А╨░╨║╤В╨╕╨▓╨╜╨╛╨│╨╛ ╤Г╨┐╤А╨░╨▓╨╗╨╡╨╜╨╕╤П ╤Б╤З╨╡╤В╨░╨╝╨╕ ╤З╨╡╤А╨╡╨╖ ╨▒╨░╨╗╨░╨╜╤Б. **╨Э╨╛╨▓╤Л╨╡ ╤Д╨░╨╣╨╗╤Л:** `balance-keyboard.service.ts` (450+ ╤Б╤В╤А╨╛╨║ тАФ parseBalanceCallback, buildBalanceListKeyboard, buildAccountActionsKeyboard, buildDeleteConfirmKeyboard, buildCurrencyWarningKeyboard, buildBalanceFiatCurrencyKeyboard, formatAccountDetailText, BalanceAccountRow type). **╨Ь╨╛╨┤╨╕╤Д╨╕╤Ж╨╕╤А╨╛╨▓╨░╨╜╨╜╤Л╨╡ ╤Д╨░╨╣╨╗╤Л:** (1) `account-onboard-keyboard.service.ts` тАФ ╤А╨░╤Б╤И╨╕╤А╨╡╨╜ ╨┐╤А╨╡╤Б╨╡╤В╨░╨╝╨╕ ╨▒╨░╨╜╨║╨╛╨▓ (10: ╨в╨╕╨╜╤М╨║╨╛╤Д╤Д, ╨б╨▒╨╡╤А╨▒╨░╨╜╨║, ╨Р╨╗╤М╤Д╨░, ╨Т╨в╨С, ╨Ь╨╛╨╜╨╛, ╨Я╤А╨╕╨▓╨░╤В, ╨Ъ╨░╤Б╨┐╨╕, N26, Revolut, Wise) ╨╕ ╨║╨╛╤И╨╡╨╗╤М╨║╨╛╨▓ (9: Trust Wallet, MetaMask, Exodus, Ledger, Trezor, Phantom, Coinbase Wallet, SafePal, Tangem). (2) `account.service.ts` тАФ `renameAccount()`, `changeAccountCurrency()`, `softDeleteAccount()`. (3) `balance.service.ts` тАФ `getBalanceData()`, `getAccountDetail()`, `setAccountBalanceById()`, `getAccountTxCount()`. (4) `webhook.route.ts` тАФ bl: callback handler, text intercepts, ac:done ╨┐╤А╨╛╨▓╨╡╤А╤П╨╡╤В bl:source. **DB Migration:** updated_at + deleted_at ╨╜╨░ account_sources. Build+Deploy: 0 ╨╛╤И╨╕╨▒╨╛╨║. |
| 2026-05-10 19:58 | **Phase 2.2 тАФ Settings UI Overhaul (DEPLOYED).** (1) `currencies.ts`: ╤А╨░╤Б╤И╨╕╤А╨╡╨╜ ╤Б╨┐╨╕╤Б╨╛╨║ (FIAT 40+, CRYPTO 48+); `CURRENCY_RU_ALIASES` тАФ 50+ ╤А╤Г╤Б╤Б╨║╨╕╤Е ╨░╨╗╨╕╨░╤Б╨╛╨▓ (╨▒╨╕╤В╨║╨╛╨╕╨╜, ╨┤╨╛╨╗╨╗╨░╤А, ╨╡╨▓╤А╨╛, ╤А╤Г╨▒╨╗╤М, ╨│╤А╨╕╨▓╨╜╨░, ╤В╨╡╨╜╨│╨╡, ╨╗╨╕╤А╨░ ╨╕ ╨┤╤А.); `searchCurrencies()` тАФ 5-pass ╨░╨╗╨│╨╛╤А╨╕╤В╨╝ (exact/startsWith/includes/EN-name/RU-alias), ╨╗╨╕╨╝╨╕╤В 10. (2) `settings.service.ts`: `getWorkspaceAccounts()` + `deleted_at IS NULL` (soft-deleted ╤Б╤З╨╡╤В╨░ ╨╜╨╡ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╤О╤В╤Б╤П); `setDefaultAccount()` ╨░╤В╨╛╨╝╨░╤А╨╜╨╛ ╨╛╨▒╨╜╨╛╨▓╨╗╤П╨╡╤В ╨╛╨▒╨░ ╨┐╨╛╨╗╤П (expense+income). (3) `settings-keyboard.service.ts`: `buildSettingsMainKeyboard()` тАФ ╤Б╤В╤А╨╛╨│╨╕╨╣ 2x3 ╨│╤А╨╕╨┤; ╨▓╤Л╨▒╨╛╤А ╨▓╨░╨╗╤О╤В╤Л ╤Б ╨╛╨▒╤К╤П╨▓╨╗╨╡╨╜╨╕╨╡╨╝; ╨╜╨╛╨▓╤Л╨╣ ╤В╨╡╨║╤Б╤В ╨▓╤Л╨▒╨╛╤А╨░ ╨╛╤Б╨╜╨╛╨▓╨╜╨╛╨╣ ╨▓╨░╨╗╤О╤В╤Л. (4) `webhook.route.ts`: ╨┐╨╛╤Б╨╗╨╡ ╨▓╤Л╨▒╨╛╤А╨░ ╨▓╨░╨╗╤О╤В╤Л ╨║╨╜╨╛╨┐╨║╨░ `[?? ╨Э╨░╨╖╨░╨┤ ╨▓ ╨╜╨░╤Б╤В╤А╨╛╨╣╨║╨╕]`; ╨╡╨┤╨╕╨╜╤Л╨╣ ╨╛╨▒╤А╨░╨▒╨╛╤В╤З╨╕╨║ `st:da:sa:` тАФ ╨╛╨┤╨╕╨╜ Main Account ╨┤╨╗╤П income+expense. Build: `tsc` 0 ╨╛╤И╨╕╨▒╨╛╨║. Commit `3e650c1`. Deployed to Railway (auto-deploy). |
| 2026-05-10 22:00 | **Phase 2.3 тАФ Paginated Transaction Search.** `transaction-hub.service.ts`: ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜ `SEARCH_PAGE_SIZE=8`; ╨▓╤Б╨╡ 4 search-╤Д╤Г╨╜╨║╤Ж╨╕╨╕ (`searchByName`, `searchByAmount`, `searchByCategory`, `searchByDateRange`) ╨┐╨╡╤А╨╡╤А╨░╨▒╨╛╤В╨░╨╜╤Л тАФ ╨┐╤А╨╕╨╜╨╕╨╝╨░╤О╤В `page: number`, ╨┐╨░╤А╨░╨╗╨╗╨╡╨╗╤М╨╜╤Л╨╣ `COUNT(*)` > ╨▓╨╛╨╖╨▓╤А╨░╤Й╨░╤О╤В `{items: TxListItem[], total: number}`. ╨г╨┤╨░╨╗╨╡╨╜╨░ ╨║╨╛╨╜╤Б╤В╨░╨╜╤В╨░ `SEARCH_LIMIT=200`. `transaction-keyboard.service.ts`: `buildSearchResultsKeyboard(items, page, totalPages)` тАФ ╨║╨╜╨╛╨┐╨║╨╕ ╤В╨╛╨▓╨░╤А╨╛╨▓ + ╤Б╤В╤А╨╛╨║╨░ ╨╜╨░╨▓╨╕╨│╨░╤Ж╨╕╨╕ `[??][p/total][??]` + footer `[?? ╨Э╨╛╨▓╤Л╨╣ ╨┐╨╛╨╕╤Б╨║][?? ╨Ъ ╤Б╨┐╨╕╤Б╨║╤Г]`; `search_results_page` ╨▓ `TxCallbackCmd`; ╨┐╨░╤А╤Б╨╡╤А `tx:sr:p:{page}`. `webhook.route.ts`: ╨▓╤Б╨╡ search-handlers ╤Б╨╛╤Е╤А╨░╨╜╤П╤О╤В ╨║╨╛╨╜╤В╨╡╨║╤Б╤В ╨▓ Redis `midas:tx:sr:ctx:{uid}:{cid}` TTL 600s; `search_results_page` handler тАФ ╤З╨╕╤В╨░╨╡╤В ╨║╨╛╨╜╤В╨╡╨║╤Б╤В, ╨┐╨╡╤А╨╡╤Б╤З╨╕╤В╤Л╨▓╨░╨╡╤В offset, ╨╛╨▒╨╜╨╛╨▓╨╗╤П╨╡╤В ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡; text intercepts (name/amount/date) > paginated API; ╨┐╤А╨╕ ╤Г╤Б╤В╨░╤А╨╡╨▓╤И╨╡╨╝ ╨║╨╛╨╜╤В╨╡╨║╤Б╤В╨╡ тАФ ╨┤╤А╤Г╨╢╨╡╨╗╤О╨▒╨╜╨╛╨╡ ┬л╨Я╨╛╨╕╤Й╨╕╤В╨╡ ╤Б╨╜╨╛╨▓╨░┬╗; ╤Г╨┤╨░╨╗╤С╨╜ ╨┤╤Г╨▒╨╗╨╕╤А╤Г╤О╤Й╨╕╨╣ ╤Б╤В╨░╤А╤Л╨╣ text intercept ╨▒╨╗╨╛╨║. Build: `tsc` 0 ╨╛╤И╨╕╨▒╨╛╨║. Commit `6da4464`. |
| 2026-05-10 22:10 | **Phase 2.3 тАФ Reports Close Button.** `report-keyboard.service.ts`: ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜ `rp:cl` callback (`?? ╨Ч╨░╨║╤А╤Л╤В╤М`) ╨║╨░╨║ ╨┐╨╛╤Б╨╗╨╡╨┤╨╜╤П╤П ╤Б╤В╤А╨╛╨║╨░ ╨╜╨░ ╨▓╤Б╨╡╤Е 3 ╨║╨╗╨░╨▓╨╕╨░╤В╤Г╤А╨░╤Е (`buildPeriodPickerKeyboard`, `buildReportSubMenuKeyboard`, `buildReportBackKeyboard`); ╤В╨╕╨┐ `{ cmd: 'close' }` ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜ ╨▓ `RpCallbackCmd`; `parseRpCallback`: `rp:cl > { cmd: 'close' }`; ╨╛╨▒╨╜╨╛╨▓╨╗╤С╨╜ docstring. `webhook.route.ts`: ╨▓ ╨▒╨╗╨╛╨║╨╡ `rp:` ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜ handler `else if (rpCmd.cmd === 'close')` > `deleteMessage(chatId, rpMsgId)` тАФ ╨┐╨╛╨╗╨╜╨╛╤Б╤В╤М╤О ╤Г╨▒╨╕╤А╨░╨╡╤В ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ ╨╕╨╖ ╤З╨░╤В╨░. Build: `tsc` 0 ╨╛╤И╨╕╨▒╨╛╨║. Commit `049233d`. |
| 2026-05-10 22:11 | **Phase 2.3 тАФ Persistent Keyboard Button Order.** `screen-builder.ts` (`buildMainMenuKeyboard`): ╨┐╨╛╤А╤П╨┤╨╛╨║ ╨║╨╜╨╛╨┐╨╛╨║ ╨╕╨╖╨╝╨╡╨╜╤С╨╜ тАФ Row 1: `[?? ╨С╨░╨╗╨░╨╜╤Б][?? ╨Ю╤В╤З╤С╤В]`, Row 2: `[?? ╨в╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕][?? ╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕]` (╨┤╨╛: Row 1 ╨С╨░╨╗╨░╨╜╤Б+╨в╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕, Row 2 ╨Ю╤В╤З╤С╤В+╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕). ╨Ю╨▒╨╜╨╛╨▓╨╗╤С╨╜ docstring. Build: `tsc` 0 ╨╛╤И╨╕╨▒╨╛╨║. Commit `70a5d41`. Deployed to Railway (auto-deploy). |
| 2026-05-11 09:00 | **Phase 2.2 Onboarding Pagination (Phase 2.2).** `account-onboard-keyboard.service.ts` ╨┐╨╛╨╗╨╜╨╛╤Б╤В╤М╤О ╨┐╨╡╤А╨╡╨┐╨╕╤Б╨░╨╜ ╤Б ╤Г╨╜╨╕╨▓╨╡╤А╤Б╨░╨╗╤М╨╜╤Л╨╝ ╨┤╨▓╨╕╨╢╨║╨╛╨╝ ╨┐╨░╨│╨╕╨╜╨░╤Ж╨╕╨╕ `buildPaginatedPicker()`. ╨а╨╡╨░╨╗╨╕╨╖╨╛╨▓╨░╨╜╤Л: paginated banks (70+ ╨╖╨░╨┐╨╕╤Б╨╡╨╣, 6/╤Б╤В╤А╨░╨╜╨╕╤Ж╨░, 3 ╨║╨╛╨╗╨╛╨╜╨║╨╕, ac:bp:{N}), paginated exchanges (ac:xp:{N}), paginated fiat currencies (ac:cfp:{N}), paginated crypto currencies (ac:ccp:{N}). `OnboardStep` ╤А╨░╤Б╤И╨╕╤А╨╡╨╜: `bal_input`. `AccountOnboardState` тАФ ╨┐╨╛╨╗╤П `accountId`, `currency`. `addAccountReturningId()` ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜ ╨▓ `account.service.ts`. `webhook.route.ts`: FSM handlers ╨┤╨╗╤П bank_page, exchange_page, fiat_page, crypto_page, bal_skip. ╨С╨░╨╗╨░╨╜╤Б ╨▓╨▓╨╛╨┤╨╕╤В╤Б╤П ╤В╨╡╨║╤Б╤В╨╛╨╝ (validateAmountFromText intercept) ╨╕╨╗╨╕ ╨┐╤А╨╛╨┐╤Г╤Б╨║╨░╨╡╤В╤Б╤П (ac:bal:s). ╨Ъ╨╛╨╝╨╝╨╕╤В ╨▓ phase 2.2 ╤Б╨╡╤А╨╕╨╕. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. |
| 2026-05-11 12:00 | **Phase 2.3 Onboarding UX Polish (PLAN APPROVED).** ╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╤Г╤В╨▓╨╡╤А╨┤╨╕╨╗ ╨┐╨╗╨░╨╜: (1) ╤Г╨▒╤А╨░╤В╤М ╨┐╤А╨╛╨╝╨╡╨╢╤Г╤В╨╛╤З╨╜╤Л╨╣ afterCreate ╤Н╨║╤А╨░╨╜, (2) ╨┤╨╛╨▒╨░╨▓╨╕╤В╤М ╨║╨╜╨╛╨┐╨║╤Г ┬л? ╨Ч╨░╨▓╨╡╤А╤И╨╕╤В╤М┬╗ (ac:fin) ╨┐╤А╤П╨╝╨╛ ╨▓ ╨┐╨╕╨║╨╡╤А ╤В╨╕╨┐╨░, (3) buildStartOnboardKeyboard тАФ ╨╕╤Б╨┐╤А╨░╨▓╨╕╤В╤М ╨╕╨║╨╛╨╜╨║╨╕ (??>??, ?>??), (4) ╨┐╤А╨╕ ┬л?? ╨Э╨░╤З╨░╤В╤М ╨▒╨╡╨╖ ╤Б╤З╤С╤В╨░┬╗ ╤В╨╕╤Е╨╛ ╤Б╨╛╨╖╨┤╨░╨▓╨░╤В╤М ┬л╨Ъ╨╛╤И╨╡╨╗╤С╨║┬╗ (USD). ╨а╨╡╨░╨╗╨╕╨╖╨░╤Ж╨╕╤П ╨┐╨╛╨┤╨╡╨╗╨╡╨╜╨░ ╨╜╨░ 4 ╤Н╤В╨░╨┐╨░ ╤Б tsc-╨┐╤А╨╛╨▓╨╡╤А╨║╨╛╨╣ ╨┐╨╛╤Б╨╗╨╡ ╨║╨░╨╢╨┤╨╛╨│╨╛. |
| 2026-05-11 14:07 | **Phase 2.3 Onboarding UX Polish тАФ ╨н╨в╨Р╨Я 1 (account-onboard-keyboard.service.ts).** ╨Ф╨╛╨▒╨░╨▓╨╗╨╡╨╜ `{ cmd: 'fin' }` ╨▓ `AccountOnboardCmd` union + ╨┐╨░╤А╤Б╨╡╤А `if (sub === 'fin')`. ╨Ф╨╛╨▒╨░╨▓╨╗╨╡╨╜╨░ `buildFinishOnboardKeyboard()` тАФ ╨┐╨╕╨║╨╡╤А ╤В╨╕╨┐╨░ + ┬л? ╨Ч╨░╨▓╨╡╤А╤И╨╕╤В╤М┬╗ (ac:fin), ╨╕╨║╨╛╨╜╨║╨╕ ????. ╨Ф╨╛╨▒╨░╨▓╨╗╨╡╨╜╨░ `accountAddedText(name, currency)`. `buildStartOnboardKeyboard()` ╨╕╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜: ??>??, ?>??, ??╨Э╨░╨╖╨░╨┤>??╨б╨▓╨╛╤С ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╡. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. |
| 2026-05-11 14:08 | **Phase 2.3 Onboarding UX Polish тАФ ╨н╨в╨Р╨Я 2 (imports).** `webhook.route.ts`: ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╤Л ╨╕╨╝╨┐╨╛╤А╤В╤Л `buildFinishOnboardKeyboard`, `accountAddedText` ╨╕╨╖ account-onboard-keyboard.service.js. tsc ╨┐╨╛╨║╨░ 2 ╨┐╤А╨╡╨┤╤Г╨┐╤А╨╡╨╢╨┤╨╡╨╜╨╕╤П (unused тАФ ╨╛╨╢╨╕╨┤╨░╨╡╨╝╨╛ ╨┤╨╛ ╤Н╤В╨░╨┐╨░ 3). |
| 2026-05-11 14:10 | **Phase 2.3 Onboarding UX Polish тАФ ╨н╨в╨Р╨Я 3 (handlers).** `webhook.route.ts`: (1) `ac:fin` handler тАФ ╨╕╨┤╨╡╨╜╤В╨╕╤З╨╡╨╜ `ac:done`, backward compat; (2) `ac:more` > redirect to fin flow (deleteMessage + sendMessageWithReplyKeyboard); (3) `ac:bal:s` тАФ ╤З╨╕╤В╨░╨╡╤В ╤Б╨╛╤Б╤В╨╛╤П╨╜╨╕╨╡ Redis, ╨╖╨░╤В╨╡╨╝ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В `accountAddedText` + `buildFinishOnboardKeyboard` ╨▓╨╝╨╡╤Б╤В╨╛ ╤Б╤В╨░╤А╨╛╨│╨╛ afterCreate; (4) `bal_input` text intercept тАФ `buildFinishOnboardKeyboard` ╨▓╨╝╨╡╤Б╤В╨╛ `buildAfterCreateKeyboard`, `accountAddedText` ╨▓╨╝╨╡╤Б╤В╨╛ ╤Б╤В╨░╤А╨╛╨╣ ╤Б╤В╤А╨╛╨║╨╕ ╤Б ╨▒╨░╨╗╨░╨╜╤Б╨╛╨╝; (5) safety fallback ╨▓ `bal_input` > `buildFinishOnboardKeyboard`. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. |
| 2026-05-11 14:13 | **Phase 2.3 Onboarding UX Polish тАФ ╨н╨в╨Р╨Я 4 (default account).** `webhook.route.ts` `ac:skip` handler: ╨┐╨╡╤А╨╡╨┤ ╤Г╨┤╨░╨╗╨╡╨╜╨╕╨╡╨╝ Redis-╨║╨╗╤О╤З╨░ ╨▓╤Л╨╖╤Л╨▓╨░╨╡╤В `hasAccounts()` тАФ ╨╡╤Б╨╗╨╕ 0 ╤Б╤З╨╡╤В╨╛╨▓, ╤Б╨╛╨╖╨┤╨░╤С╤В `addAccountWithCurrency(workspaceId, userId, '╨Ъ╨╛╤И╨╡╨╗╤С╨║', 'USD')` ╨▓ ╨▒╨╗╨╛╨║╨╡ try/catch (non-fatal). tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. Commit `395e1f2`. git push origin main. Deploy Railway: `7089846c тАФ SUCCESS`. |
| 2026-05-11 16:30 | **master_roadmap Phase 1 тАФ Keyboard Service.** `account-onboard-keyboard.service.ts` +478 ╤Б╤В╤А╨╛╨║: `CURRENCY_FLAGS` (40+ ╨▓╨░╨╗╤О╤В: ????RUB ????USD ?BTC ? ETH TON ╨╕ ╨┤╤А.), `getCurrencyFlag(code)`, `CURRENCY_NAMES`. `buildPaginatedPicker()` ╤А╨╡╤Д╨░╨║╤В╨╛╤А╨╕╨╜╨│ тАФ ╨╛╨▒╨╡ ╤Б╤В╤А╨╡╨╗╨║╨╕ ╨▓╤Б╨╡╨│╨┤╨░, noop ╨╜╨░ ╨║╤А╨░╤П╤Е. `buildCurrencyPickerText(name?,isCustom?)` тАФ 3 ╨▓╨╡╤В╨║╨╕. `buildFiatCurrencyPage()` + `buildCryptoCurrencyPage()` тАФ ╤Д╨╗╨░╨│╨╕ + ac:cur:search. `searchCurrencies()` тАФ fuzzy+╤В╤А╨░╨╜╤Б╨╗╨╕╤В╨╡╤А╨░╤Ж╨╕╤П. `buildNoMatchText/Keyboard`. `buildCurrencySearch*`. ╨г╨┤╨░╨╗╨╡╨╜╤Л FIAT_ITEMS, CRYPTO_ITEMS, CURRENCY_PICKER_TEXT. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. |
| 2026-05-11 16:33 | **master_roadmap Phase 2 тАФ Webhook FSM.** `webhook.route.ts`: `name_input` > no-match screen ╨┐╤А╨╕ fuzzy null. `ac:cus:save` > isCustomName=true > cur_pick. `ac:cus:keep` > name_input retry. `ac:cur:search` > cur_search step. `ac:cur:list` > ╨▓╨╛╨╖╨▓╤А╨░╤В ╨║ ╤Б╨┐╨╕╤Б╨║╤Г. `cur_search` text interceptor > searchCurrencies > ╤А╨╡╨╖╤Г╨╗╤М╤В╨░╤В╤Л ╨╕╨╗╨╕ no-results. 3 success-screens button-free `{ inline_keyboard: [] }`. `chooseCurKeyboard()` module-level. ╨Т╤Б╨╡ callback_data ?64 ╨▒╨░╨╣╤В. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. |
| 2026-05-11 16:43 | **master_roadmap Phase 3 тАФ Smoke Tests.** `smoke-test-master-roadmap.mjs` (NEW): 70 ╨┐╤А╨╛╨▓╨╡╤А╨╛╨║, ╨╖╨░╨┐╤Г╤Б╨║ `node apps/telegram-bot/smoke-test-master-roadmap.mjs` (╨┐╤А╨╛╤В╨╕╨▓ ╤Б╨║╨╛╨╝╨┐╨╕╨╗╨╕╤А╨╛╨▓╨░╨╜╨╜╨╛╨│╨╛ dist/). ╨Я╨╛╨║╤А╤Л╤В╤Л ╨▓╤Б╨╡ 14 ╤Б╤Ж╨╡╨╜╨░╤А╨╕╨╡╨▓. ╨а╨╡╨╖╤Г╨╗╤М╤В╨░╤В: **70/70 ? / 0 ?**. |
| 2026-05-11 16:44 | **master_roadmap Phase 4 тАФ Deploy.** Git commit `35c92e0` `feat(onboard): no-match screen, cur-search, flags, nav-arrows, button-free success [master_roadmap]`. Push > Railway auto-deploy. Status: Midas ? Online, background-workers ? Online. Deploy logs: clean start, Redis connected, no errors. |
| 2026-05-12 15:05 | **workflow_state.md ╨░╨║╤В╤Г╨░╨╗╨╕╨╖╨╕╤А╨╛╨▓╨░╨╜. ╨в╨╡╤Б╤В╤Л ╨╖╨░╨┐╤Г╤Й╨╡╨╜╤Л.** `smoke-test-master-roadmap.mjs`: ╨╕╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜ ╤Г╤Б╤В╨░╤А╨╡╨▓╤И╨╕╨╣ assert ╨┤╨╗╤П `buildCurrencySearchNoResultsText`. ╨Ш╤В╨╛╨│: 76/76 ?. `smoke-test-lazy-default.mjs`: 39/39 ?. `tsc --noEmit`: 0 ╨╛╤И╨╕╨▒╨╛╨║. Phase LD++ ╨┐╨╛╨╗╨╜╨╛╤Б╤В╤М╤О ╨┐╨╛╨┤╤В╨▓╨╡╤А╨╢╨┤╨╡╨╜╨░. |
| 2026-05-12 19:35 | **Phase 2.4 PR 2 - v??????? ? ??????.** `account.service.ts`: ???????? `AccountWithBalance` interface + `getAccountWithBalance()` + `getWorkspaceAccountsWithBalances()`. tsc 0 ??????. GitHub PR #2 merged squash ? main (commit 7cc8528). |
| 2026-05-12 17:27 | **Phase 2.4 тАФ UX Design ╤Б╨╡╤Б╤Б╨╕╤П ╨╕ ╨┐╨╗╨░╨╜╨╕╤А╨╛╨▓╨░╨╜╨╕╨╡.** ╨б╨┐╤А╨╛╨╡╨║╤В╨╕╤А╨╛╨▓╨░╨╜╤Л: ╤З╨╡╤А╨╜╨╛╨▓╨╕╨║ + ╨╝╨░╤В╨╡╨╝╨░╤В╨╕╨║╨░ ╨▒╨░╨╗╨░╨╜╤Б╨░ (┬л?? Bybit USD┬╗ + ┬л?? 15 400 ? 10 000 = 5 400 USD┬╗), ╨┐╨╕╨║╨╡╤А ╤Б╤З╨╡╤В╨╛╨▓ (╨║╨╜╨╛╨┐╨║╨░ ┬л?? ╨б╨╝╨╡╨╜╨╕╤В╤М ╤Б╤З╤С╤В┬╗), ╨║╤А╨╛╤Б╤Б-╨▓╨░╨╗╤О╤В╨░ (╨▓╨▓╨╛╨┤ ╤Б╤Г╨╝╨╝╤Л ╨║╨╛╨╜╨▓╨╡╤А╤В╨░╤Ж╨╕╨╕), confirmed card ╨▒╨╡╨╖ ╨║╨╜╨╛╨┐╨╛╨║ ╨С╨░╨╗╨░╨╜╤Б/╨Ю╤В╤З╤С╤В. UX-╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨╕╤П ia:list/ia:back ╨╕╨╖ ╤В╨╡╨║╤Г╤Й╨╡╨│╨╛ ╤З╨░╤В╨░ ╨Ю╨в╨Ь╨Х╨Э╨Х╨Э╨л (╨║╨╛╨┤╨╛╨▓╨░╤П ╨▒╨░╨╖╨░ ╨▓╨╛╨╖╨▓╤А╨░╤Й╨╡╨╜╨░ ╨▓ stable). 16 ╨░╤В╨╛╨╝╨░╤А╨╜╤Л╤Е PR ╤Б╨┐╤А╨╛╨╡╨║╤В╨╕╤А╨╛╨▓╨░╨╜╤Л. ╨Р╨╜╨░╨╗╨╕╨╖ ╨║╨╛╨╜╤Д╨╗╨╕╨║╤В╨╛╨▓: 1 breaking change (PR 7 buildConfirmKeyboard), 1 ╨╜╨╛╨▓╤Л╨╣ Redis-╨┐╤А╨╡╤Д╨╕╨║╤Б (midas:xfx:ptr). ╨Я╨╛╨╗╨╜╤Л╨╣ ╨┐╨╗╨░╨╜: `account_debit_ux_plan.md`. workflow_state.md ╨╛╨▒╨╜╨╛╨▓╨╗╤С╨╜. |
| 2026-05-12 21:00 | **Phase 2.4 тАФ Account Picker UX Hotfixes.** ╨Ш╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜╨╕╨╡ ╨║╤А╨╕╤В╨╕╤З╨╡╤Б╨║╨╛╨│╨╛ ╨▒╨░╨│╨░ ╨╛╤В╤Б╤Г╤В╤Б╤В╨▓╨╕╤П ╨┐╨╕╨║╨╡╤А╨░ ╨┐╤А╨╕ AI parse ╨▒╨╡╨╖ account_hint. ╨Т `ai-parse.worker.ts` ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜ ╨┐╤А╨╕╨╜╤Г╨┤╨╕╤В╨╡╨╗╤М╨╜╤Л╨╣ ╨┐╨╛╨║╨░╨╖ ╨┐╨╕╨║╨╡╤А╨░. ╨Т `draft.service.ts` ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨░ `getWorkspaceAccountsForPicker` ╨┤╨╗╤П ╨▓╨╛╤А╨║╨╡╤А╨░. ╨Т `draft-confirmation.service.ts` ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨░ ╨╖╨░╤Й╨╕╤В╨░ (`accountWasExplicitlyChosen`) ╨╛╤В ╤В╨╕╤Е╨╛╨╣ ╨░╨▓╤В╨╛╨║╨╛╨╜╨▓╨╡╤А╤В╨░╤Ж╨╕╨╕ XFX ╨┐╤А╨╕ ╨╜╨╡╤Б╨╛╨▓╨┐╨░╨┤╨╡╨╜╨╕╨╕ ╨▓╨░╨╗╤О╤В╤Л ╨┤╨╡╤Д╨╛╨╗╤В╨╜╨╛╨│╨╛ ╤Б╤З╨╡╤В╨░. ╨Т╨╜╨╡╨┤╤А╨╡╨╜╤Л intent-aware ╤В╨╡╨║╤Б╤В╤Л (╨┤╨╛╤Е╨╛╨┤/╤А╨░╤Б╤Е╨╛╨┤) ╨┤╨╗╤П ╨┐╨╕╨║╨╡╤А╨░ ╤Б╤З╨╡╤В╨╛╨▓ ╨▓ `account-inline-keyboard.service.ts`. ╨Т╤Б╨╡ 103/103 smoke-╤В╨╡╤Б╤В╨░ ╨┐╤А╨╛╤И╨╗╨╕. |
| 2026-05-13 08:17 | **Phase 2.5 ╨и╨░╨│ 1 тАФ Smart Item>Category Auto-Detector.** `item-category-detector.service.ts` (NEW): 200+ ╨▒╤А╨╡╨╜╨┤╨╛╨▓ ╨╕ ╨║╨╗╤О╤З╨╡╨▓╤Л╤Е ╤Б╨╗╨╛╨▓, 9 ╨║╨░╤В╨╡╨│╨╛╤А╨╕╨╣ (╨в╤А╨░╨╜╤Б╨┐╨╛╤А╤В/╨Х╨┤╨░/╨н╨╗╨╡╨║╤В╤А╨╛╨╜╨╕╨║╨░/╨Ю╨┤╨╡╨╢╨┤╨░/╨Ч╨┤╨╛╤А╨╛╨▓╤М╨╡/╨Ф╨╛╨╝/╨а╨░╨╖╨▓╨╗╨╡╤З╨╡╨╜╨╕╤П/╨Ю╨▒╤А╨░╨╖╨╛╨▓╨░╨╜╨╕╨╡/╨Ю╨▒╨╛╤А╤Г╨┤╨╛╨▓╨░╨╜╨╕╨╡), longest-phrase-first matching. `patchDraftCategoryHint()` ╨▓ `clarification.service.ts`: atomic idempotent DB patch (╨┐╨╡╤А╨╡╨╖╨░╨┐╨╕╤Б╤Л╨▓╨░╨╡╤В ╤В╨╛╨╗╤М╨║╨╛ ╨╡╤Б╨╗╨╕ `parsed_category_hint IS NULL` ╨╕╨╗╨╕ `= '╨Ф╤А╤Г╨│╨╛╨╡'`). ╨Ш╨╜╤В╨╡╨│╤А╨░╤Ж╨╕╤П ╨▓ `webhook.route.ts` > `sendAndStorePreview`: non-blocking, ╨╜╨╡ ╨▒╨╗╨╛╨║╨╕╤А╤Г╨╡╤В flow ╨┐╤А╨╕ ╨╛╤И╨╕╨▒╨║╨╡. ╨в╨╡╤Б╤В: ┬л╨╝╨░╨╣╨▒╨░╤Е┬╗ > ╨в╤А╨░╨╜╤Б╨┐╨╛╤А╤В, ┬лstarbucks┬╗ > ╨Х╨┤╨░. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. |
| 2026-05-13 08:20 | **Phase 2.5 ╨и╨░╨│ 2 тАФ Account-Currency Compatibility Validation Gate.** `account-currency-validator.service.ts` (NEW): ╨╝╨░╤В╤А╨╕╤Ж╨░ 8 ╨┐╤А╨░╨▓╨╕╨╗, `classifyCurrency()`, `HYBRID_EWALLET_KEYS`, `TON_ASSETS`. ╨Ш╨╜╤В╨╡╨│╤А╨╕╤А╨╛╨▓╨░╨╜ ╨▓ 2 ╤В╨╛╤З╨║╨╕ `webhook.route.ts`: (1) `cmd=currency` callback тАФ editMessageText ╤Б ╨╛╤И╨╕╨▒╨║╨╛╨╣, FSM state ╤Б╨╛╤Е╤А╨░╨╜╤П╨╡╤В╤Б╤П ╨▓ Redis; (2) `cur_input` text interceptor тАФ upsertBotMessage ╤Б ╨╛╤И╨╕╨▒╨║╨╛╨╣, `redisConnection.del` ╨Э╨Х ╨▓╤Л╨╖╤Л╨▓╨░╨╡╤В╤Б╤П. ╨С╨╗╨╛╨║╨╕╤А╤Г╨╡╤В: ╨Ь╨╛╨╜╨╛╨▒╨░╨╜╨║+USDT, ╨Э╨░╨╗╨╕╤З╨╜╤Л╨╡+ETH, Lightning+USDC. ╨а╨░╨╖╤А╨╡╤И╨░╨╡╤В: Bybit+USDT, Payeer+USDT (╨│╨╕╨▒╤А╨╕╨┤), MetaMask+BTC. Commit `d9ad480`. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. git push > Railway deployed. |
| 2026-05-13 08:24 | **Phase 2.5 ╨и╨░╨│ 3 тАФ Anomaly Badge ╨▓ ╨┐╨╕╨║╨╡╤А╨░╤Е.** `account-inline-keyboard.service.ts` (MODIFY): ╨╕╨╝╨┐╨╛╤А╤В `classifyCurrency`. `anomalyBadge(emoji, currency)` тАФ ╨▓╨╛╨╖╨▓╤А╨░╤Й╨░╨╡╤В `'?? '` ╨╡╤Б╨╗╨╕ emoji=`??` ╨╕ ╨▓╨░╨╗╤О╤В╨░ ╨╜╨╡ ╤Д╨╕╨░╤В. `buildAccountPickerV2Keyboard` ╤Г╨╗╤Г╤З╤И╨╡╨╜: `??` ╨┤╨╗╤П ╨║╤А╨╕╨┐╤В╨╛, `??` ╨┤╨╗╤П ╤Д╨╕╨░╤В╨░, `??` ╤В╨╛╨╗╤М╨║╨╛ ╨┤╨╗╤П ╨▒╨░╨╜╨║+╨║╤А╨╕╨┐╤В╨╛ ╨░╨╜╨╛╨╝╨░╨╗╨╕╨╣ ╨┐╨╛ ╨╕╨╝╨╡╨╜╨╕ ╤Б╤З╤С╤В╨░. `buildAccountPickerForDraft`: `??` ╤З╨╡╤А╨╡╨╖ `anomalyBadge()` ╨┐╨╛ `accountTypeEmoji()`. Commit `f543c5e`. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. git push > Railway deployed. Phase 2.5 COMPLETE. |
| 2026-05-13 15:20 | **Phase 2.7 тАФ Account Picker Fix & Cancellation UX.** ╨Ш╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜╨░ ╤А╨╡╨│╤А╨╡╤Б╤Б╨╕╤П ╨║╨╛╨╝╨╝╨╕╤В╨░ `6efe173` (always show account picker), ╨╕╨╖-╨╖╨░ ╨║╨╛╤В╨╛╤А╨╛╨╣ ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕ ╨▒╨╡╨╖ ╤Б╨╛╨╖╨┤╨░╨╜╨╜╤Л╤Е ╤Б╤З╨╡╤В╨╛╨▓ ╨╖╨░╨▓╨╕╤Б╨░╨╗╨╕. ╨Ъ╨╜╨╛╨┐╨║╨░ ┬л╨Ч╨░╨┐╨╕╤Б╨░╤В╤М ╨▒╨╡╨╖ ╤Б╤З╤С╤В╨░┬╗ ╨╜╨░ no-match ╨║╨░╤А╤В╨╛╤З╨║╨╡ ╨╖╨░╨╝╨╡╨╜╨╡╨╜╨░ ╨╜╨░ `?? ╨Ю╤В╨╝╨╡╨╜╨░` (`ia:cancel`). ╨Я╤А╨╕ ╨╛╤В╨╝╨╡╨╜╨╡: ╤Б╤В╨░╤В╤Г╤Б ╤З╨╡╤А╨╜╨╛╨▓╨╕╨║╨░ ╨▓ ╨С╨Ф ╨╝╨╡╨╜╤П╨╡╤В╤Б╤П ╨╜╨░ `rejected`, ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ in-place ╨╝╨╡╨╜╤П╨╡╤В╤Б╤П ╨╜╨░ "? ╨Ю╤В╨╝╨╡╨╜╨╡╨╜╨╛" ╨▒╨╡╨╖ ╨║╨╜╨╛╨┐╨╛╨║, ╤Г╨┤╨░╨╗╤П╤О╤В╤Б╤П ╤Б╤В╨╡╨╣╤В╤Л ╨╕╨╖ Redis. |
| 2026-05-13 15:25 | **Infrastructure тАФ AI Token Budget Fix.** ╨Ю╨▒╨╜╨░╤А╤Г╨╢╨╡╨╜╨╛, ╤З╤В╨╛ ╨╛╤З╨╡╤А╨╡╨┤╤М ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╣ ╨┐╨╛╨╗╨╜╨╛╤Б╤В╤М╤О ╨▓╤Б╤В╨░╨╗╨░ ╨╕╨╖-╨╖╨░ ╨╕╤Б╤З╨╡╤А╨┐╨░╨╜╨╕╤П ╨┤╨╜╨╡╨▓╨╜╨╛╨│╨╛ ╨╗╨╕╨╝╨╕╤В╨░ ╤В╨╛╨║╨╡╨╜╨╛╨▓ Claude (`AI daily token budget exceeded: 506188 >= 500000`). ╨з╨╡╤А╨╡╨╖ Railway CLI ╨┐╨╡╤А╨╡╨╝╨╡╨╜╨╜╨░╤П `AI_BUDGET_MAX_DAILY_TOKENS` ╨┤╨╗╤П `background-workers` ╤Г╨▓╨╡╨╗╨╕╤З╨╡╨╜╨░ ╤Б 500 000 ╨┤╨╛ 2 000 000. ╨Т╨╛╤А╨║╨╡╤А╤Л ╨┐╨╡╤А╨╡╤Б╨╛╨▒╤А╨░╨╜╤Л, ╨╛╨▒╤А╨░╨▒╨╛╤В╨║╨░ ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╣ ╨▓╨╛╤Б╤Б╤В╨░╨╜╨╛╨▓╨╗╨╡╨╜╨░. |
| 2026-05-13 21:30 | **Phase 2.8 тАФ ╨н╤В╨░╨┐ 1: Callback Fix (ia:newac).** `account-inline-keyboard.service.ts`: ╨╕╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜ ╨║╤А╨╕╤В╨╕╤З╨╡╤Б╨║╨╕╨╣ ╨▒╨░╨│ тАФ ╨║╨╜╨╛╨┐╨║╨░ ┬л? ╨б╨╛╨╖╨┤╨░╤В╤М ╤Б╤З╤С╤В┬╗ ╨▓ ╨┐╨╕╨║╨╡╤А╨╡ ╤З╨╡╤А╨╜╨╛╨▓╨╕╨║╨░ ╨▓╤Л╨╖╤Л╨▓╨░╨╗╨░ `ia:rename` ╨▓╨╝╨╡╤Б╤В╨╛ ╨║╨╛╤А╤А╨╡╨║╤В╨╜╨╛╨│╨╛ `ia:newac`. ╨Ф╨╛╨▒╨░╨▓╨╗╨╡╨╜ ╤В╨╕╨┐ `showpicker` ╨▓ `InlineAccountCmd` union ╨╕ ╤Б╨╛╨╛╤В╨▓╨╡╤В╤Б╤В╨▓╤Г╤О╤Й╨╕╨╣ ╨┐╨░╤А╤Б╨╡╤А ╨┤╨╗╤П ╨╛╨▒╤А╨░╤В╨╜╨╛╨╣ ╨╜╨░╨▓╨╕╨│╨░╤Ж╨╕╨╕. |
| 2026-05-13 21:35 | **Phase 2.8 тАФ ╨н╤В╨░╨┐ 2: ╨б╤В╨░╨╜╨┤╨░╤А╤В╨╕╨╖╨░╤Ж╨╕╤П ╤В╨╡╨║╤Б╤В╨░ ╨╛╨╜╨▒╨╛╤А╨┤╨╕╨╜╨│╨░.** `webhook.route.ts`: ╨╖╨░╨│╨╛╨╗╨╛╨▓╨╛╨║ ╤Н╨║╤А╨░╨╜╨░ ╨▓╤Л╨▒╨╛╤А╨░ ╤В╨╕╨┐╨░ ╤Б╤З╤С╤В╨░ (╨▓╤Л╨╖╤Л╨▓╨░╨╡╨╝╨╛╨│╨╛ ╤З╨╡╤А╨╡╨╖ `ia:newac`) ╨╕╨╖╨╝╨╡╨╜╤С╨╜ ╤Б ╨╢╤С╤Б╤В╨║╨╛ ╨┐╤А╨╛╨┐╨╕╤Б╨░╨╜╨╜╨╛╨│╨╛ ╤В╨╡╨║╤Б╤В╨░ ╨╜╨░ ╨║╨╛╨╜╤Б╤В╨░╨╜╤В╤Г `ACCOUNTS_EMPTY_TEXT` тАФ ╤Б╨╛╨╛╤В╨▓╨╡╤В╤Б╤В╨▓╤Г╨╡╤В ╤Б╤В╨╕╨╗╤О ╤Н╨║╤А╨░╨╜╨░ `/start` ╨┤╨╗╤П ╨╜╨╛╨▓╤Л╤Е ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╨╡╨╣. |
| 2026-05-13 21:45 | **Phase 2.8 тАФ ╨н╤В╨░╨┐ 3: Back Navigation (ia:showpicker).** `account-onboard-keyboard.service.ts`: ╨║╨╜╨╛╨┐╨║╨░ ┬л?? ╨Э╨░╨╖╨░╨┤┬╗ ╨╜╨░ ╤Н╨║╤А╨░╨╜╨╡ ╨▓╤Л╨▒╨╛╤А╨░ ╤В╨╕╨┐╨░ ╤Б╤З╤С╤В╨░ ╤В╨╡╨┐╨╡╤А╤М ╨│╨╡╨╜╨╡╤А╨╕╤А╤Г╨╡╤В callback `ia:showpicker` ╨▓╨╝╨╡╤Б╤В╨╛ `ia:pk:back`. `webhook.route.ts`: ╤А╨╡╨░╨╗╨╕╨╖╨╛╨▓╨░╨╜ ╨╜╨╛╨▓╤Л╨╣ handler `ia:showpicker` тАФ ╨▓╨╛╤Б╤Б╤В╨░╨╜╨░╨▓╨╗╨╕╨▓╨░╨╡╤В `midas:prev_acct` (╨║╤Н╤И╨╕╤А╨╛╨▓╨░╨╜╨╜╤Л╨╣ accountId ╨╕╨╖ Redis), ╤А╨╡╨╜╨┤╨╡╤А╨╕╤В Account Picker V2 ╤Б ╤Б╨╛╤Е╤А╨░╨╜╨╡╨╜╨╕╨╡╨╝ `linkedDraftId`. ╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨╝╨╛╨╢╨╡╤В ╨▓╨╡╤А╨╜╤Г╤В╤М╤Б╤П ╨║ ╨┐╨╕╨║╨╡╤А╤Г ╨▒╨╡╨╖ ╨┐╨╛╤В╨╡╤А╨╕ ╨║╨╛╨╜╤В╨╡╨║╤Б╤В╨░ ╤З╨╡╤А╨╜╨╛╨▓╨╕╨║╨░. |
| 2026-05-13 22:00 | **Phase 2.8 тАФ ╨н╤В╨░╨┐ 4: ╨г╨┤╨░╨╗╨╡╨╜╨╕╨╡ success-╨▒╨░╨╜╨╜╨╡╤А╨╛╨▓.** `webhook.route.ts`: ╤Г╨┤╨░╨╗╨╡╨╜╤Л ╤Б╤В╤А╨╛╨║╨╕ ┬л? ╨б╤З╤С╤В ... ╤Б╨╛╨╖╨┤╨░╨╜!┬╗ ╨▓╨╛ ╨▓╤Б╨╡╤Е ╤В╤А╤С╤Е ╨┐╤Г╤В╤П╤Е ╨╖╨░╨▓╨╡╤А╤И╨╡╨╜╨╕╤П ╨╛╨╜╨▒╨╛╤А╨┤╨╕╨╜╨│╨░ ╨╕╨╖ ╤З╨╡╤А╨╜╨╛╨▓╨╕╨║╨░: `bal_skip`, `bal_input`, `cur_input`. ╨в╨╡╨┐╨╡╤А╤М ╨┐╨╛╤Б╨╗╨╡ ╤Б╨╛╨╖╨┤╨░╨╜╨╕╤П ╤Б╤З╤С╤В╨░ ╤Б╤А╨░╨╖╤Г ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В╤Б╤П preview-╨║╨░╤А╤В╨╛╤З╨║╨░ ╤З╨╡╤А╨╜╨╛╨▓╨╕╨║╨░ ╤З╨╡╤А╨╡╨╖ `confirmPreviewFull()` тАФ ╤З╨╕╤Б╤В╤Л╨╣ seamless UX ╨▒╨╡╨╖ ╨┐╤А╨╛╨╝╨╡╨╢╤Г╤В╨╛╤З╨╜╤Л╤Е ╤Н╨║╤А╨░╨╜╨╛╨▓. |
| 2026-05-13 22:30 | **Phase 2.8 тАФ TS Build Fix.** ╨Ю╨▒╨╜╨░╤А╤Г╨╢╨╡╨╜╤Л ╨╛╤И╨╕╨▒╨║╨╕ ╤Б╨▒╨╛╤А╨║╨╕ ╨╜╨░ Railway: `TS6133: 'linkedAccountNameBal' / 'acNameBi2' is declared but its value is never read` тАФ ╨┐╨╡╤А╨╡╨╝╨╡╨╜╨╜╤Л╨╡ ╤Б╤В╨░╨╗╨╕ ╨╜╨╡╨╕╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╡╨╝╤Л╨╝╨╕ ╨┐╨╛╤Б╨╗╨╡ ╤Г╨┤╨░╨╗╨╡╨╜╨╕╤П success-╨▒╨░╨╜╨╜╨╡╤А╨╛╨▓ ╨▓ ╨н╤В╨░╨┐╨╡ 4. ╨г╨┤╨░╨╗╨╡╨╜╤Л ╨╛╨▒╨░ ╨╛╨▒╤К╤П╨▓╨╗╨╡╨╜╨╕╤П. `tsc --noEmit`: 0 ╨╛╤И╨╕╨▒╨╛╨║. Commit `56991be` pushed to main. Railway re-deploy: Midas ? Online. |
| 2026-05-14 10:43 | **Phase 2.9 тАФ Nav Buttons Never Delete Tx Records.** ╨Я╤А╨╛╨▒╨╗╨╡╨╝╨░: ╨┐╨╛╤Б╨╗╨╡ ╤Б╨╛╨╖╨┤╨░╨╜╨╕╤П ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕ ╨╡╤С message_id (┬л? ╨Ч╨░╨┐╨╕╤Б╨░╨╜╨╛┬╗ + ┬л?? ╨Ш╨╖╨╝╨╡╨╜╨╕╤В╤М ╨╖╨░╨┐╨╕╤Б╤М┬╗) ╤Е╤А╨░╨╜╨╕╨╗╤Б╤П ╨▓ Redis ╨║╨░╨║ `midas:am:` pointer. ╨Я╤А╨╕ ╨╜╨░╨╢╨░╤В╨╕╨╕ ╨С╨░╨╗╨░╨╜╤Б/╨Ю╤В╤З╤С╤В/╨в╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕/╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕ тАФ `upsertBotMessage()` ╤А╨╡╨┤╨░╨║╤В╨╕╤А╨╛╨▓╨░╨╗ ╨╕╨╗╨╕ ╤Г╨┤╨░╨╗╤П╨╗ ╤Н╤В╨╛ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡. ╨а╨╡╤И╨╡╨╜╨╕╨╡: ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜ `sendNavMessage()` ╨▓ `active-message.service.ts` тАФ ╨▓╤Б╨╡╨│╨┤╨░ ╨╛╤В╨┐╤А╨░╨▓╨╗╤П╨╡╤В ╨Э╨Ю╨Т╨Ю╨Х ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡, ╨╜╨╡ ╤В╤А╨╛╨│╨░╨╡╤В `midas:am:`. 4 NAV_BTN_* ╨╛╨▒╤А╨░╨▒╨╛╤В╤З╨╕╨║╨░ ╨▓ `webhook.route.ts` ╨┐╨╡╤А╨╡╨║╨╗╤О╤З╨╡╨╜╤Л ╨╜╨░ `sendNavMessage`. Commit `1477f55` pushed to main. |
| 2026-05-14 10:57 | **Phase 2.9+ тАФ Smart Nav Message (╨╝idas:nav: key).** ╨Я╤А╨╛╨▒╨╗╨╡╨╝╨░: ╨║╨░╨╢╨┤╨╛╨╡ ╨╜╨░╨╢╨░╤В╨╕╨╡ nav-╨║╨╜╨╛╨┐╨║╨╕ ╨╛╤В╨┐╤А╨░╨▓╨╗╤П╨╗╨╛ ╨╜╨╛╨▓╨╛╨╡ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ (╨╖╨░╤Б╨╛╤А╨╡╨╜╨╕╨╡ ╤З╨░╤В╨░). ╨а╨╡╤И╨╡╨╜╨╕╨╡: ╨┤╨▓╨░ ╨╜╨╡╨╖╨░╨▓╨╕╤Б╨╕╨╝╤Л╤Е Redis-╨║╨╗╤О╤З╨░. `midas:am:` тАФ ╤З╨╡╤А╨╜╨╛╨▓╨╕╨║╨╕/╨┐╨╕╨║╨╡╤А╤Л/╨┐╨╛╨┤╤В╨▓╨╡╤А╨╢╨┤╨╡╨╜╨╕╤П (╨╜╨╡ ╤В╤А╨╛╨│╨░╨╡╨╝ ╨▓ nav). `midas:nav:` тАФ nav-╨┐╨░╨╜╨╡╨╗╤М (╨С╨░╨╗╨░╨╜╤Б/╨Ю╤В╤З╤С╤В/etc.). `sendNavMessage()` ╨┐╨╛╨╗╨╜╨╛╤Б╤В╤М╤О ╨┐╨╡╤А╨╡╨┐╨╕╤Б╨░╨╜: edit-first ╤З╨╡╤А╨╡╨╖ `midas:nav:`, ╨┐╤А╨╕ ╤Г╤Б╨┐╨╡╤Е╨╡ тАФ ╤А╨╡╨┤╨░╨║╤В╨╕╤А╤Г╨╡╤В ╤В╨╛ ╨╢╨╡ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ (╤З╨░╤В ╨╜╨╡ ╨╖╨░╤Б╨╛╤А╤П╨╡╤В╤Б╤П), ╨┐╤А╨╕ ╨╜╨╡╤Г╨┤╨░╤З╨╡ тАФ ╨╛╤В╨┐╤А╨░╨▓╨╗╤П╨╡╤В ╨╜╨╛╨▓╨╛╨╡. ╨Я╤А╨╕ ╨▓╨▓╨╛╨┤╨╡ ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕: `getNavMessageId` > `deleteMessage` > `clearNavMessageId` ╨┐╨╡╤А╨╡╨┤ ╤Б╤В╨░╨╜╨┤╨░╤А╤В╨╜╤Л╨╝ cleanup `midas:am:`. Commits `4baac9c`. |
| 2026-05-14 11:04 | **Phase 2.9+ тАФ Silent Close Button.** ╨Ъ╨╜╨╛╨┐╨║╨░ ┬л? ╨Ч╨░╨║╤А╤Л╤В╤М┬╗ ╨▓ ╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨░╤Е (`st:cancel`) ╤А╨░╨╜╨╡╨╡ ╤А╨╡╨┤╨░╨║╤В╨╕╤А╨╛╨▓╨░╨╗╨░ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ ╨╜╨░ ┬л?? ╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕ ╨╖╨░╨║╤А╤Л╤В╤Л.┬╗ (╨╗╨╕╤И╨╜╨╡╨╡). ╨в╨╡╨┐╨╡╤А╤М: `deleteMessage(chatId, messageId)` + `clearNavMessageId()` тАФ ╨┐╨░╨╜╨╡╨╗╤М ╨┐╤А╨╛╤Б╤В╨╛ ╨╕╤Б╤З╨╡╨╖╨░╨╡╤В, ╨╜╨╕╨║╨░╨║╨╛╨│╨╛ ╨╜╨╛╨▓╨╛╨│╨╛ ╤В╨╡╨║╤Б╤В╨░. ╨Ъ╨╜╨╛╨┐╨║╨░ ┬л? ╨Ч╨░╨║╤А╤Л╤В╤М┬╗ ╨▓ ╨С╨░╨╗╨░╨╜╤Б╨╡ (`bl:close`) ╤Г╨╢╨╡ ╤Г╨┤╨░╨╗╤П╨╗╨░ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡, ╨╜╨╛ ╨╜╨╡ ╨╛╤З╨╕╤Й╨░╨╗╨░ `midas:nav:` тАФ ╨╕╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜╨╛. Commit `004966f` pushed to main. Railway auto-deploy triggered. |
| 2026-05-14 12:28 | **Phase 2.10 тАФ Fix 1: isSuccessCard тАФ DEL midas:am: ╨┐╤А╨╕ ╨┐╨╛╨┤╤В╨▓╨╡╤А╨╢╨┤╨╡╨╜╨╕╨╕ ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕.** ╨Я╤А╨╛╨▒╨╗╨╡╨╝╨░: ╨┐╨╛╤Б╨╗╨╡ ╨┐╨╛╨┤╤В╨▓╨╡╤А╨╢╨┤╨╡╨╜╨╕╤П ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕ success card ╤Б╨╛╤Е╤А╨░╨╜╤П╨╗╨░╤Б╤М ╨▓ `midas:am:` pointer. ╨Я╤А╨╕ ╨▓╨▓╨╛╨┤╨╡ ╤Б╨╗╨╡╨┤╤Г╤О╤Й╨╡╨╣ ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕ step-7 ╨▓ webhook.route.ts ╤Г╨┤╨░╨╗╤П╨╗ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ ╨╕╨╖ `midas:am:` тАФ success card ╤Г╨┤╨░╨╗╤П╨╗╨░╤Б╤М. ╨а╨╡╤И╨╡╨╜╨╕╨╡: `shared/index.ts` тАФ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜ `isSuccessCard?: boolean` ╨▓ `NotificationJobPayload`. `confirmation.worker.ts` тАФ ╨┐╤А╨╕ approve: `isSuccessCard: true` ╨▓ payload. `notifications.worker.ts` тАФ ╨╡╤Б╨╗╨╕ `isSuccessCard`: `DEL midas:am:` ╨▓╨╝╨╡╤Б╤В╨╛ `SET`. Commit `df15a01`. |
| 2026-05-14 12:28 | **Phase 2.10 тАФ Fix 2: from-context ╨▓ delete flow parser.** ╨Я╤А╨╛╨▒╨╗╨╡╨╝╨░: ╨┐╤А╨╕ ╨╜╨░╨╢╨░╤В╨╕╨╕ ┬л╨Ш╨╖╨╝╨╡╨╜╨╕╤В╤М ╨╖╨░╨┐╨╕╤Б╤М┬╗ > ┬л╨г╨┤╨░╨╗╨╕╤В╤М┬╗ > ┬л╨Ю╤В╨╝╨╡╨╜╨░┬╗ > ┬л╨Ч╨░╨║╤А╤Л╤В╤М┬╗ тАФ ╨║╨╜╨╛╨┐╨║╨░ ╨Ч╨░╨║╤А╤Л╤В╤М ╤Г╨┤╨░╨╗╤П╨╗╨░ ╨║╨░╤А╤В╨╛╤З╨║╤Г ╨▓╨╝╨╡╤Б╤В╨╛ ╨▓╨╛╤Б╤Б╤В╨░╨╜╨╛╨▓╨╗╨╡╨╜╨╕╤П success card. ╨Ъ╨╛╤А╨╡╨╜╤М: `parseTxCallback` ╨╜╨╡ ╤З╨╕╤В╨░╨╗ `parts[4]` ╨┤╨╗╤П `tx:d:ask` ╨╕ `tx:d:yes` тАФ ╨║╨╛╨╜╤В╨╡╨║╤Б╤В `from='s'` ╤В╨╡╤А╤П╨╗╤Б╤П ╨┐╤А╨╕ ╨┐╨░╤А╤Б╨╕╨╜╨│╨╡. Fix: `transaction-keyboard.service.ts` тАФ `const from = parts[4]`; return ╤Б `from` ╨┤╨╗╤П ╨╛╨▒╨╛╨╕╤Е action. ╨в╨╡╨┐╨╡╤А╤М `tx:view` ╨║╨╛╤А╤А╨╡╨║╤В╨╜╨╛ ╨▓╨╕╨┤╨╕╤В `from==='s'` ╨╕ ╤Б╤В╨░╨▓╨╕╤В `closeCallback = tx:done:{txId}`. Commit `8894b92`. |
| 2026-05-14 12:37 | **Phase 2.10 тАФ Fix 3: Double-lock sentinel key.** ╨Я╤А╨╛╨▒╨╗╨╡╨╝╨░: ╨┤╨░╨╢╨╡ ╨┐╨╛╤Б╨╗╨╡ Fix 1 success card ╨╕╨╜╨╛╨│╨┤╨░ ╤Г╨┤╨░╨╗╤П╨╗╨░╤Б╤М (race condition ╨╝╨╡╨╢╨┤╤Г background-workers ╨╕ telegram-bot, ╨╕╨╗╨╕ ╨╛╤В╤Б╤В╨░╨▓╨░╨╜╨╕╨╡ ╨┤╨╡╨┐╨╗╨╛╤П). ╨а╨╡╤И╨╡╨╜╨╕╨╡ тАФ ╨┤╨▓╨╛╨╣╨╜╨░╤П ╨▒╨╗╨╛╨║╨╕╤А╨╛╨▓╨║╨░: (1) `notifications.worker.ts` ╨┐╤А╨╕ `isSuccessCard`: SET `midas:success_card:{sentMessageId}` = '1' (TTL 30 ╨┤╨╜╨╡╨╣), ╨╖╨░╤В╨╡╨╝ DEL `midas:am:`. (2) `webhook.route.ts` step-7: ╨┐╨╡╤А╨╡╨┤ `deleteMessage(amId)` ╨┐╤А╨╛╨▓╨╡╤А╤П╨╡╤В `EXISTS midas:success_card:{amId}` тАФ ╨╡╤Б╨╗╨╕ sentinel ╨╡╤Б╤В╤М, ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ ╨Э╨Х ╤Г╨┤╨░╨╗╤П╨╡╤В╤Б╤П (╤В╨╛╨╗╤М╨║╨╛ ╨╛╤З╨╕╤Й╨░╨╡╤В╤Б╤П pointer). ╨Ф╨▓╨░ ╨╖╨░╨╝╨║╨░ ╤А╨░╨▒╨╛╤В╨░╤О╤В ╨╜╨╡╨╖╨░╨▓╨╕╤Б╨╕╨╝╨╛. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║ ╨╛╨▒╨░ ╨┐╤А╨╕╨╗╨╛╨╢╨╡╨╜╨╕╤П. Commit `b869c03`. |
| 2026-05-14 17:30 | **Phase 2.10+ Gate Fix тАФ Frozen UI ╨┐╤А╨╕ ╨┐╨░╤А╨░╨╗╨╗╨╡╨╗╤М╨╜╨╛╨╝ ╨▓╨▓╨╛╨┤╨╡ ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╣.** ╨Я╤А╨╛╨▒╨╗╨╡╨╝╨░: TX1 ╨╛╤В╨║╤А╤Л╨▓╨░╨╡╤В ╨┐╨╕╨║╨╡╤А ╤Б╤З╤С╤В╨░ > TX2 (webhook step-7) ╤Г╨┤╨░╨╗╤П╨╡╤В ╨┐╨╕╨║╨╡╤А (gate_sent ╨╡╤Й╤С ╨╜╨╡ ╤Г╤Б╤В╨░╨╜╨╛╨▓╨╗╨╡╨╜) > ai-parse gate ╨┐╤А╨╕╤Б╤Л╨╗╨░╨╡╤В ╨╜╨╛╨▓╤Г╤О ╨║╨░╤А╤В╨╛╤З╨║╤Г ╤Б ╨┐╨╕╨║╨╡╤А╨╛╨╝ ╨╕ ╤Г╤Б╤В╨░╨╜╨░╨▓╨╗╨╕╨▓╨░╨╡╤В gate_sent > TX3 (webhook step-7) ╤Г╨┤╨░╨╗╤П╨╡╤В gate-╨║╨░╤А╤В╨╛╤З╨║╤Г (gate_sent ╨╜╨╡ ╨┐╤А╨╛╨▓╨╡╤А╤П╨╗╤Б╤П!) > ai-parse ╨╝╨╛╨╗╤З╨╕╤В (gate_sent SET > silently ignore) > TX4, TX5... ╤Ж╨╕╨║╨╗: ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ ╨┐╤А╨╕╤Е╨╛╨┤╨╕╤В, ╤Г╨┤╨░╨╗╤П╨╡╤В╤Б╤П, ╨╛╤В╨▓╨╡╤В╨░ ╨╜╨╡╤В тАФ **╨Ч╨Р╨Т╨Ш╨б╨Ю╨Э**. **Fix 1 (webhook.route.ts ╤Б╤В╤А╨╛╨║╨╕ 5446тАУ5458):** `const gateSentActive = await redisConnection.exists('midas:gate_sent:...')`. ╨Х╤Б╨╗╨╕ ╨░╨║╤В╨╕╨▓╨╡╨╜ тАФ `deleteMessage` ╨╕ `clearActiveMessageId` ╨Э╨Х ╨▓╤Л╨╖╤Л╨▓╨░╤О╤В╤Б╤П. Gate-╨║╨░╤А╤В╨╛╤З╨║╨░ ╨╛╤Б╤В╨░╤С╤В╤Б╤П ╨▓╨╕╨┤╨╕╨╝╨╛╨╣ ╨┐╤А╨╕ TX3, TX4... **Fix 2 (webhook.route.ts ╤Б╤В╤А╨╛╨║╨░ 1539, ia:pk: handler):** `redisConnection.del('midas:gate_sent:...')` ╨┐╨╛╤Б╨╗╨╡ `setDraftAccountId` тАФ ╨╜╨╛╤А╨╝╨░╨╗╤М╨╜╤Л╨╣ flow ╨▓╨╛╤Б╤Б╤В╨░╨╜╨░╨▓╨╗╨╕╨▓╨░╨╡╤В╤Б╤П ╤Б╤А╨░╨╖╤Г ╨┐╨╛╤Б╨╗╨╡ ╨▓╤Л╨▒╨╛╤А╨░ ╤Б╤З╤С╤В╨░. **Fix 3 (ai-parse.worker.ts):** Gate ╤А╨╡╨║╨╛╨╜╤Б╤В╤А╤Г╨╕╤А╤Г╨╡╤В ╨┐╨╛╨╗╨╜╤Л╨╣ ╨┐╨╕╨║╨╡╤А ╤Б╤З╨╡╤В╨╛╨▓ (inline keyboard ╤Б ╨║╨╜╨╛╨┐╨║╨░╨╝╨╕ ╤Б╤З╨╡╤В╨╛╨▓ + ?? ╨Ю╤В╨╝╨╡╨╜╨░) ╨║╨╛╨│╨┤╨░ `pendingDraft.accountId === null` тАФ ╨▓╨╝╨╡╤Б╤В╨╛ ╨┐╤Г╤Б╤В╨╛╨╣ confirm-╨║╨╗╨░╨▓╨╕╨░╤В╤Г╤А╤Л. **╨Ц╨╕╨╖╨╜╨╡╨╜╨╜╤Л╨╣ ╤Ж╨╕╨║╨╗ gate_sent:** SET ai-parse.worker (╨┐╤А╨╕ gate) > DEL ia:cancel (╤Б╤В╤А╨╛╨║╨░ 1432, ╨┤╨╛ ╤Д╨╕╨║╤Б╨░) / ia:pk: (╨Ф╨Ю╨С╨Р╨Т╨Ы╨Х╨Э╨Ю) / approve/reject confirmation.worker (╤Б╤В╤А╨╛╨║╨░ 268, ╨┤╨╛ ╤Д╨╕╨║╤Б╨░) / TTL auto 1h. Scope: 2 ╤Д╨░╨╣╨╗╨░ (webhook.route.ts, ai-parse.worker.ts) + ╤Г╤В╨╕╨╗╨╕╤В╨░ fix-stuck-draft.mjs. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. git commit `8d25ec1`, push origin main ?. Railway: Midas ? Online, background-workers ? Online. |
| 2026-05-14 20:00 | **Phase 2.5+ тАФ Currency-Aware Picker: Bot Layer (telegram-bot).** ╨Я╤А╨╛╨▒╨╗╨╡╨╝╨░: ╨▓ ╨┐╨╕╨║╨╡╤А╨╡ ╤Б╤З╤С╤В╨╛╨▓ ╨┐╤А╨╕ USD-╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╗╤Б╤П USDT-╤Б╤З╤С╤В, ╤Е╨╛╤В╤П ╤Н╤В╨╛ ╤Б╤В╨╡╨╣╨▒╨╗╨║╨╛╨╕╨╜ ╨╕ ╨╛╨╜ ╨╜╨╡ ╨║╨╛╨╜╨▓╨╡╤А╤В╨╕╤А╤Г╨╡╤В╤Б╤П ╨▓ ╤Д╨╕╨░╤В. **╨а╨╡╨░╨╗╨╕╨╖╨░╤Ж╨╕╤П (4 ╤Д╨░╨╣╨╗╨░):** (1) `account-currency-validator.service.ts` тАФ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨░ ╤Д╤Г╨╜╨║╤Ж╨╕╤П `isKnownCurrency(code)`: ╨┐╤А╨╛╨▓╨╡╤А╤П╨╡╤В ╨║╨╛╨┤ ╨┐╨╛ ╤В╤А╤С╨╝ ╨▓╨░╨╣╤В╨╗╨╕╤Б╤В╨░╨╝ (FIAT_SET + STABLECOINS + CRYPTO_SET). ╨Я╤А╨╡╨┤╨╛╤В╨▓╤А╨░╤Й╨░╨╡╤В ╤Б╨╛╨╖╨┤╨░╨╜╨╕╨╡ ╤Д╨░╨╜╤В╨╛╨╝╨╜╤Л╤Е ╨▓╨░╨╗╤О╤В ╤В╨╕╨┐╨░ ┬лUDS┬╗ ╨╕╨╗╨╕ ┬л╨Х╨Т╨а┬╗. (2) `clarification.service.ts` тАФ ╨▓ `validateCurrencyCode()` ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨░ ╤А╨░╨╜╨╜╤П╤П ╨┐╤А╨╛╨▓╨╡╤А╨║╨░ `!isKnownCurrency(upper)` > ╨▓╨╛╨╖╨▓╤А╨░╤В `null` ╨┤╨╛ ╨╖╨░╨┐╨╕╤Б╨╕ ╨▓ ╨С╨Ф. (3) `account.service.ts` тАФ `getWorkspaceAccountsWithBalances()` ╨┐╨╛╨╗╤Г╤З╨░╨╡╤В ╨╛╨┐╤Ж╨╕╨╛╨╜╨░╨╗╤М╨╜╤Л╨╣ 4-╨╣ ╨┐╨░╤А╨░╨╝╨╡╤В╤А `parsedCurrency?`. ╨Я╨╛╤Б╨╗╨╡ SQL-╨╖╨░╨┐╤А╨╛╤Б╨░: ╨╡╤Б╨╗╨╕ tx тАФ ╤Д╨╕╨░╤В > exact-match ╤Б╨╜╨░╤З╨░╨╗╨░ + ╨╛╤Б╤В╨░╨╗╤М╨╜╤Л╨╡ ╤Д╨╕╨░╤В╨╜╤Л╨╡; ╨╡╤Б╨╗╨╕ ╤Б╤В╨╡╨╣╨▒╨╗╨║╨╛╨╕╨╜/╨║╤А╨╕╨┐╤В╨╛ > ╤В╨╛╨╗╤М╨║╨╛ exact match. (4) `account-inline-keyboard.service.ts` тАФ `getPickerScreenText(intent, parsedCurrency?)` ╨┤╨╛╨▒╨░╨▓╨╗╤П╨╡╤В ╨║╨╛╨╜╤В╨╡╨║╤Б╤В╨╜╤Г╤О ╨┐╨╛╨┤╤Б╨║╨░╨╖╨║╤Г; `getPickerEmptyText(parsedCurrency?)` тАФ ┬л╨Э╨╡╤В USDT-╤Б╤З╨╡╤В╨╛╨▓┬╗ ╨▓╨╝╨╡╤Б╤В╨╛ ╨╛╨▒╤Й╨╡╨│╨╛ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╤П. `webhook.route.ts` тАФ ╨┐╤А╨╛╨▒╤А╨░╤Б╤Л╨▓╨░╨╡╤В `draft.parsed_currency` ╨▓ 3 entry points (sendAndStorePreview, ia:delink, ia:showpicker). ╨Я╨╡╤А╨▓╤Л╨╣ ╨┤╨╡╨┐╨╗╨╛╨╣ ╤Г╨┐╨░╨╗ тАФ TS6133 (ACCOUNT_PICKER_EMPTY_TEXT ╨▓ ╨╕╨╝╨┐╨╛╤А╤В╨╡ ╨╜╨╛ ╨╜╨╡ ╨╕╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╡╤В╤Б╤П). ╨Ш╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜╨╛ ╨║╨╛╨╝╨╝╨╕╤В╨╛╨╝ `04f7e81`. |
| 2026-05-14 20:10 | **Phase 2.5+ тАФ Currency-Aware Picker: Worker Layer (background-workers). Root Cause Fix.** ╨Ю╨▒╨╜╨░╤А╤Г╨╢╨╡╨╜╨╛: ╨╜╨░╤З╨░╨╗╤М╨╜╤Л╨╣ ╨┐╨╕╨║╨╡╤А ╤Б╤В╤А╨╛╨╕╤В╤Б╤П ╨Я╨Ю╨Ы╨Э╨Ю╨б╨в╨м╨о ╨▓ `ai-parse.worker.ts` (background-workers), ╨░ ╨╜╨╡ ╨▓ `telegram-bot`. ╨Ш╨╖╨╝╨╡╨╜╨╡╨╜╨╕╤П ╨▓ `account.service.ts` (telegram-bot) ╨╜╨░ initial picker ╨╜╨╡ ╨▓╨╗╨╕╤П╤О╤В ╨╜╨╕╨║╨░╨║. **╨а╨╡╨░╨╗╨╕╨╖╨░╤Ж╨╕╤П (`ai-parse.worker.ts`):** ╨Ф╨╛╨▒╨░╨▓╨╗╨╡╨╜╤Л ╨╗╨╛╨║╨░╨╗╤М╨╜╤Л╨╡ ╨║╨╗╨░╤Б╤Б╨╕╤Д╨╕╨║╨░╤В╨╛╤А╤Л: `PICKER_STABLECOINS` (10 ╨╖╨░╨┐╨╕╤Б╨╡╨╣), `PICKER_KNOWN_CRYPTOS` (27 ╨╖╨░╨┐╨╕╤Б╨╡╨╣), `classifyPickerCcy(code)`, `filterPickerAccounts(accounts, txCurrency)` тАФ ╨░╨╜╨░╨╗╨╛╨│ ╨╗╨╛╨│╨╕╨║╨╕ `account.service.ts`. ╨Я╤А╨╕╨╝╨╡╨╜╨╡╨╜╨╛ ╨▓ 2 ╨╝╨╡╤Б╤В╨░╤Е: (A) **Initial picker** (╤Б╤В╤А╨╛╨║╨░ ~620) тАФ ╤Д╨╕╨╗╤М╤В╤А╤Г╨╡╤В ╨┐╨╛ `aiData?.currency` (╨║╨╛╨│╨┤╨░ AI ╨▓╨╡╤А╨╜╤Г╨╗ currency, ╨╜╨░╨┐╤А╨╕╨╝╨╡╤А ┬лUSDT┬╗); (B) **Gate picker** (╤Б╤В╤А╨╛╨║╨░ ~340) тАФ ╤Д╨╕╨╗╤М╤В╤А╤Г╨╡╤В ╨┐╨╛ `pendingDraft.parsedCurrency` (╨▓╨╛╤Б╤Б╤В╨░╨╜╨╛╨▓╨╗╨╡╨╜╨╕╨╡ ╨┐╨╕╨║╨╡╤А╨░ ╨┐╤А╨╕ gate-╨▒╨╗╨╛╨║╨╕╤А╨╛╨▓╨║╨╡). ╨Ш╤В╨╛╨│ ╤Д╨╕╨╗╤М╤В╤А╨░╤Ж╨╕╨╕: `{USD tx}` > [USD-╤Б╤З╨╡╤В╨░] + [╨┤╤А╤Г╨│╨╕╨╡ ╤Д╨╕╨░╤В╨╜╤Л╨╡]; `{USDT tx}` > [╤В╨╛╨╗╤М╨║╨╛ USDT-╤Б╤З╨╡╤В╨░]. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║ (╨╛╨▒╨░ ╨┐╤А╨╕╨╗╨╛╨╢╨╡╨╜╨╕╤П). git commit `0085d8f`, push origin main ?. Railway auto-deploy triggered. |
| 2026-05-15 02:00 | **Balance Phase A тАФ Grouped UI ╨Ч╨Р╨Ф╨Х╨Я╨Ы╨Ю╨Х╨Э.** `balance-keyboard.service.ts` (MODIFY): `GroupType` union, `GROUP_EMOJI` map, `GROUP_ORDER` priority, `classifyAccountGroup(name, currency)` ╤Н╨▓╤А╨╕╤Б╤В╨╕╨║╨░ (╨С╨░╨╜╨║╨╕/╨Ъ╤А╨╕╨┐╤В╨╛╨▒╨╕╤А╨╢╨╕/╨Ъ╤А╨╕╨┐╤В╨╛-╨║╨╛╤И╨╡╨╗╤М╨║╨╕/╨Э╨░╨╗╨╕╤З╨╜╤Л╨╡/╨Я╤А╨╛╤З╨╡╨╡), `buildBalanceListKeyboard` ╤Б ╨│╤А╤Г╨┐╨┐╨╕╤А╨╛╨▓╨║╨╛╨╣ ╨╕ emoji-╨┐╤А╨╡╤Д╨╕╨║╤Б╨░╨╝╨╕, `export formatBalanceShort`. `balance.service.ts` (MODIFY): ╤Б╨╡╨║╤Ж╨╕╨╛╨╜╨╕╤А╨╛╨▓╨░╨╜╨╜╤Л╨╣ ╤В╨╡╨║╤Б╤В getBalanceData() ╤Б ╤Н╨╝╨╛╨┤╨╖╨╕ ╨│╤А╤Г╨┐╨┐, ╤Г╨┤╨░╨╗╤С╨╜ CURRENCY_TOTALS_SQL. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. Commit `4a1748c` push to main. Railway auto-deploy ?. |
| 2026-05-15 02:27 | **Balance Phase B-1 тАФ DB Migration ╨Я╨а╨Ш╨Ь╨Х╨Э╨Х╨Э╨Р.** `packages/database/migrations/1779800000000_account-parent-and-subtype.js` (NEW): `parent_account_id VARCHAR(26) FK ON DELETE CASCADE`, `sub_type TEXT NOT NULL DEFAULT 'general'` CHECK constraint, `idx_account_sources_parent` (partial). ╨а╨╡╤И╨╡╨╜╨░ ESM-╨┐╤А╨╛╨▒╨╗╨╡╨╝╨░ `1779400000000` (exports > export const). ╨Ь╨╕╨│╤А╨░╤Ж╨╕╤П ╨┐╤А╨╕╨╝╨╡╨╜╨╡╨╜╨░ `node-pg-migrate up --check-order false`. ╨Р╤Г╨┤╨╕╤В: FK 31/31 ?, ╤Д╨╛╤А╨╝╤Г╨╗╨░ initial_balance+income?expense ?, INSERT ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╣ ╨╜╨╡ ╨╖╨░╤В╤А╨╛╨╜╤Г╤В ?. Commit `75156b9`. |
| 2026-05-15 02:30 | **╨Ю╨▒╨╜╨╛╨▓╨╗╨╡╨╜ workflow_state.md ╨┤╨╗╤П Phase B-2 handoff.** Section 1 (status), Section 2 (╤Д╨░╨╖╤Л), Section 8 (╤Д╨░╨╣╨╗╤Л), Section 9 (╨┐╤А╨╛╨╝╨┐╤В), Section 10 (╨╕╤Б╤В╨╛╤А╨╕╤П). ╨б╨╗╨╡╨┤╤Г╤О╤Й╨╕╨╣ ╤И╨░╨│: Phase B-2 (PER_ACCOUNT_SQL + ╨╗╨╡╤Б╨╡╨╜╨║╨░ +/L + ╨░╨│╤А╨╡╨│╨░╤Ж╨╕╤П ╨┤╨╛╤З╨╡╤А╨╜╨╕╤Е). |
| 2026-05-15 23:40 | **Balance Phase B-2 тАФ Hierarchical Ladder View ╨Ч╨Р╨Ф╨Х╨Я╨Ы╨Ю╨Х╨Э.** `balance.service.ts`: `PER_ACCOUNT_SQL` ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜ `a.parent_account_id`; `AccountBalanceRow` + `parent_account_id: string | null`; `getBalanceData()` ╤Б╤В╤А╨╛╨╕╤В childrenMap/childCountMap, ╤А╨╡╨╜╨┤╨╡╤А╨╕╤В +/L ╨╗╨╡╤Б╨╡╨╜╨║╤Г ╨┤╨╗╤П parent>children; ╨╗╨╕╤Б╤В╨╛╨▓╤Л╨╡ ╤Б╤З╨╡╤В╨░ ╨▒╨╡╨╖ ╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨╕╨╣ (backward compat). `balance-keyboard.service.ts`: `BalanceAccountRow` + `parentAccountId?`+`childCount?`; `BalanceCallbackCmd` + `add_currency`; `parseBalanceCallback` `bl:ac:{id}` тАФ SEC-01 compliant; `pluralizeCurrency()` (╨▓╨░╨╗╤О╤В╨░/╨▓╨░╨╗╤О╤В╤Л/╨▓╨░╨╗╤О╤В, mod10/mod100); `buildBalanceListKeyboard()` ╨┐╨╡╤А╨╡╨┐╨╕╤Б╨░╨╜ тАФ ╨╛╤В╨┤╨╡╨╗╤П╨╡╤В parents/children, parent ╤Б ╨┤╨╡╤В╤М╨╝╨╕: aggregation button + indented `L CURRENCY ┬╖ balance` child rows + `? ╨Ф╨╛╨▒╨░╨▓╨╕╤В╤М ╨▓╨░╨╗╤О╤В╤Г` (bl:ac:{parentId}); ╨╗╨╕╤Б╤В╨╛╨▓╤Л╨╡ ╤Б╤З╨╡╤В╨░ тАФ Phase A/LD++ rendering. tsc 0 errors. Commit `d04bcba` pushed to main. Railway auto-deploy triggered. |
| 2026-05-14 22:00 | **Hotfix: ╨║╨╜╨╛╨┐╨║╨░ "?? ╨Ю╤В╨╝╨╡╨╜╨░" ╨▓ ╨┐╨╕╨║╨╡╤А╨╡ ╤Б╤З╨╡╤В╨╛╨▓ + "╤О╨╖╨┤╤В" ╨░╨╗╨╕╨░╤Б USDT + ╨┐╤А╨╛╨╝╨┐╤В-╨┐╤А╨╕╨╝╨╡╤А╤Л.** (1) `account-inline-keyboard.service.ts` (MODIFY) ╤Б╤В╤А╨╛╨║╨░ 381тАУ383: ╨║╨╜╨╛╨┐╨║╨░ `buildAccountPickerV2Keyboard` ┬л?? ╨Ю╤В╨╝╨╡╨╜╨░┬╗ ╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨░ ╤Б `ia:pk:back:{draftId}` > `ia:cancel:{draftId}`. ╨Ф╨╛ ╤Д╨╕╨║╤Б╨░: ╨╜╨░╨╢╨░╤В╨╕╨╡ ┬л╨Ю╤В╨╝╨╡╨╜╨░┬╗ ╨▓╨╛╨╖╨▓╤А╨░╤Й╨░╨╗╨╛ ╨║ ╨║╨░╤А╤В╨╛╤З╨║╨╡ ╨┐╤А╨╡╨▓╤М╤О ╤Б ╨║╨╜╨╛╨┐╨║╨░╨╝╨╕ [?? ╨Ш╨╖╨╝╨╡╨╜╨╕╤В╤М|?? ╨Ю╤В╨╝╨╡╨╜╨░]+[?? ╨Т╤Л╨▒╤А╨░╤В╤М ╤Б╤З╤С╤В]. ╨Я╨╛╤Б╨╗╨╡ ╤Д╨╕╨║╤Б╨░: `ia:cancel` handler ╤А╨╡╨┤╨░╨║╤В╨╕╤А╤Г╨╡╤В ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ > ┬л? ╨Ю╤В╨╝╨╡╨╜╨╡╨╜╨╛┬╗ ╨▒╨╡╨╖ ╨║╨╜╨╛╨┐╨╛╨║, ╤Б╤В╨░╨▓╨╕╤В ╤З╨╡╤А╨╜╨╛╨▓╨╕╨║╤Г ╤Б╤В╨░╤В╤Г╤Б `rejected`, ╤З╨╕╤Б╤В╨╕╤В Redis. (2) `packages/ai-core/src/prompts.ts` тАФ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜ `"╤О╨╖╨┤╤В"` ╨▓ ╤Б╨┐╨╕╤Б╨╛╨║ ╨░╨╗╨╕╨░╤Б╨╛╨▓ USDT (╤Б╤В╤А╨╛╨║╨░ 37): ╨▒╤Л╨╗╨╛ `"╤О╤Б╨┤╤В", "╤В╨╡╨╖╨╡╤А", "tether", "usdt"` > ╤Б╤В╨░╨╗╨╛ `"╤О╤Б╨┤╤В", "╤О╨╖╨┤╤В", "╤В╨╡╨╖╨╡╤А", "tether", "usdt"`. (3) `packages/ai-core/src/prompts.ts` тАФ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╤Л 2 ╨┐╤А╨╕╨╝╨╡╤А╨░ ╨▓ ╤Б╨╡╨║╤Ж╨╕╤О `-- Partial (amount missing) --`: `"╨║╤Г╨┐╨╕╨╗ ╨║╨▓╨░╤А╤В╨╕╤А╤Г ╤О╨╖╨┤╤В"` > `{intent:expense,currency:USDT,item_hint:╨║╨▓╨░╤А╤В╨╕╤А╨░,confidence:0.75}` ╨╕ `"╨║╤Г╨┐╨╕╨╗ ╨╜╨╡╨┤╨▓╨╕╨╢╨║╤Г usdt"` > `{intent:expense,currency:USDT,item_hint:╨╜╨╡╨┤╨▓╨╕╨╢╨╕╨╝╨╛╤Б╤В╤М,confidence:0.75}`. ╨ж╨╡╨╗╤М: Claude ╤В╨╡╨┐╨╡╤А╤М ╨▓╨╛╨╖╨▓╤А╨░╤Й╨░╨╡╤В `item_hint` ╨┤╨░╨╢╨╡ ╨║╨╛╨│╨┤╨░ ╨╜╨╡╤В `amount`. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. git commit `ccaec87`, push origin main ?. Railway auto-deploy triggered. |
| 2026-05-14 20:00 | **Phase 2.5+ тАФ Currency-Aware Picker: Bot Layer (telegram-bot).** ╨Я╤А╨╛╨▒╨╗╨╡╨╝╨░: ╨▓ ╨┐╨╕╨║╨╡╤А╨╡ ╤Б╤З╤С╤В╨╛╨▓ ╨┐╤А╨╕ USD-╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╗╤Б╤П USDT-╤Б╤З╤С╤В, ╤Е╨╛╤В╤П ╤Н╤В╨╛ ╤Б╤В╨╡╨╣╨▒╨╗╨║╨╛╨╕╨╜ ╨╕ ╨╛╨╜ ╨╜╨╡ ╨║╨╛╨╜╨▓╨╡╤А╤В╨╕╤А╤Г╨╡╤В╤Б╤П ╨▓ ╤Д╨╕╨░╤В. **╨а╨╡╨░╨╗╨╕╨╖╨░╤Ж╨╕╤П (4 ╤Д╨░╨╣╨╗╨░):** (1) `account-currency-validator.service.ts` тАФ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨░ ╤Д╤Г╨╜╨║╤Ж╨╕╤П `isKnownCurrency(code)`: ╨┐╤А╨╛╨▓╨╡╤А╤П╨╡╤В ╨║╨╛╨┤ ╨┐╨╛ ╤В╤А╤С╨╝ ╨▓╨░╨╣╤В╨╗╨╕╤Б╤В╨░╨╝ (FIAT_SET + STABLECOINS + CRYPTO_SET). ╨Я╤А╨╡╨┤╨╛╤В╨▓╤А╨░╤Й╨░╨╡╤В ╤Б╨╛╨╖╨┤╨░╨╜╨╕╨╡ ╤Д╨░╨╜╤В╨╛╨╝╨╜╤Л╤Е ╨▓╨░╨╗╤О╤В ╤В╨╕╨┐╨░ ┬лUDS┬╗ ╨╕╨╗╨╕ ┬л╨Х╨Т╨а┬╗. (2) `clarification.service.ts` тАФ ╨▓ `validateCurrencyCode()` ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨░ ╤А╨░╨╜╨╜╤П╤П ╨┐╤А╨╛╨▓╨╡╤А╨║╨░ `!isKnownCurrency(upper)` > ╨▓╨╛╨╖╨▓╤А╨░╤В `null` ╨┤╨╛ ╨╖╨░╨┐╨╕╤Б╨╕ ╨▓ ╨С╨Ф. (3) `account.service.ts` тАФ `getWorkspaceAccountsWithBalances()` ╨┐╨╛╨╗╤Г╤З╨░╨╡╤В ╨╛╨┐╤Ж╨╕╨╛╨╜╨░╨╗╤М╨╜╤Л╨╣ 4-╨╣ ╨┐╨░╤А╨░╨╝╨╡╤В╤А `parsedCurrency?`. ╨Я╨╛╤Б╨╗╨╡ SQL-╨╖╨░╨┐╤А╨╛╤Б╨░: ╨╡╤Б╨╗╨╕ tx тАФ ╤Д╨╕╨░╤В > exact-match ╤Б╨╜╨░╤З╨░╨╗╨░ + ╨╛╤Б╤В╨░╨╗╤М╨╜╤Л╨╡ ╤Д╨╕╨░╤В╨╜╤Л╨╡; ╨╡╤Б╨╗╨╕ ╤Б╤В╨╡╨╣╨▒╨╗╨║╨╛╨╕╨╜/╨║╤А╨╕╨┐╤В╨╛ > ╤В╨╛╨╗╤М╨║╨╛ exact match. (4) `account-inline-keyboard.service.ts` тАФ `getPickerScreenText(intent, parsedCurrency?)` ╨┤╨╛╨▒╨░╨▓╨╗╤П╨╡╤В ╨║╨╛╨╜╤В╨╡╨║╤Б╤В╨╜╤Г╤О ╨┐╨╛╨┤╤Б╨║╨░╨╖╨║╤Г; `getPickerEmptyText(parsedCurrency?)` тАФ ┬л╨Э╨╡╤В USDT-╤Б╤З╨╡╤В╨╛╨▓┬╗ ╨▓╨╝╨╡╤Б╤В╨╛ ╨╛╨▒╤Й╨╡╨│╨╛ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╤П. `webhook.route.ts` тАФ ╨┐╤А╨╛╨▒╤А╨░╤Б╤Л╨▓╨░╨╡╤В `draft.parsed_currency` ╨▓ 3 entry points (sendAndStorePreview, ia:delink, ia:showpicker). ╨Я╨╡╤А╨▓╤Л╨╣ ╨┤╨╡╨┐╨╗╨╛╨╣ ╤Г╨┐╨░╨╗ тАФ TS6133 (ACCOUNT_PICKER_EMPTY_TEXT ╨▓ ╨╕╨╝╨┐╨╛╤А╤В╨╡ ╨╜╨╛ ╨╜╨╡ ╨╕╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╡╤В╤Б╤П). ╨Ш╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜╨╛ ╨║╨╛╨╝╨╝╨╕╤В╨╛╨╝ `04f7e81`. |
| 2026-05-14 20:10 | **Phase 2.5+ тАФ Currency-Aware Picker: Worker Layer (background-workers). Root Cause Fix.** ╨Ю╨▒╨╜╨░╤А╤Г╨╢╨╡╨╜╨╛: ╨╜╨░╤З╨░╨╗╤М╨╜╤Л╨╣ ╨┐╨╕╨║╨╡╤А ╤Б╤В╤А╨╛╨╕╤В╤Б╤П ╨Я╨Ю╨Ы╨Э╨Ю╨б╨в╨м╨о ╨▓ `ai-parse.worker.ts` (background-workers), ╨░ ╨╜╨╡ ╨▓ `telegram-bot`. ╨Ш╨╖╨╝╨╡╨╜╨╡╨╜╨╕╤П ╨▓ `account.service.ts` (telegram-bot) ╨╜╨░ initial picker ╨╜╨╡ ╨▓╨╗╨╕╤П╤О╤В ╨╜╨╕╨║╨░╨║. **╨а╨╡╨░╨╗╨╕╨╖╨░╤Ж╨╕╤П (`ai-parse.worker.ts`):** ╨Ф╨╛╨▒╨░╨▓╨╗╨╡╨╜╤Л ╨╗╨╛╨║╨░╨╗╤М╨╜╤Л╨╡ ╨║╨╗╨░╤Б╤Б╨╕╤Д╨╕╨║╨░╤В╨╛╤А╤Л: `PICKER_STABLECOINS` (10 ╨╖╨░╨┐╨╕╤Б╨╡╨╣), `PICKER_KNOWN_CRYPTOS` (27 ╨╖╨░╨┐╨╕╤Б╨╡╨╣), `classifyPickerCcy(code)`, `filterPickerAccounts(accounts, txCurrency)` тАФ ╨░╨╜╨░╨╗╨╛╨│ ╨╗╨╛╨│╨╕╨║╨╕ `account.service.ts`. ╨Я╤А╨╕╨╝╨╡╨╜╨╡╨╜╨╛ ╨▓ 2 ╨╝╨╡╤Б╤В╨░╤Е: (A) **Initial picker** (╤Б╤В╤А╨╛╨║╨░ ~620) тАФ ╤Д╨╕╨╗╤М╤В╤А╤Г╨╡╤В ╨┐╨╛ `aiData?.currency` (╨║╨╛╨│╨┤╨░ AI ╨▓╨╡╤А╨╜╤Г╨╗ currency, ╨╜╨░╨┐╤А╨╕╨╝╨╡╤А ┬лUSDT┬╗); (B) **Gate picker** (╤Б╤В╤А╨╛╨║╨░ ~340) тАФ ╤Д╨╕╨╗╤М╤В╤А╤Г╨╡╤В ╨┐╨╛ `pendingDraft.parsedCurrency` (╨▓╨╛╤Б╤Б╤В╨░╨╜╨╛╨▓╨╗╨╡╨╜╨╕╨╡ ╨┐╨╕╨║╨╡╤А╨░ ╨┐╤А╨╕ gate-╨▒╨╗╨╛╨║╨╕╤А╨╛╨▓╨║╨╡). ╨Ш╤В╨╛╨│ ╤Д╨╕╨╗╤М╤В╤А╨░╤Ж╨╕╨╕: `{USD tx}` > [USD-╤Б╤З╨╡╤В╨░] + [╨┤╤А╤Г╨│╨╕╨╡ ╤Д╨╕╨░╤В╨╜╤Л╨╡]; `{USDT tx}` > [╤В╨╛╨╗╤М╨║╨╛ USDT-╤Б╤З╨╡╤В╨░]. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║ (╨╛╨▒╨░ ╨┐╤А╨╕╨╗╨╛╨╢╨╡╨╜╨╕╤П). git commit `0085d8f`, push origin main ?. Railway auto-deploy triggered. |


| 2026-05-15 10:35 | **Transaction Hub UX `[Variant D]` Icon Chips (DEPLOYED).** ╨д╨╕╨╜╨░╨╗╤М╨╜╨╛╨╡ ╤Б╨╛╤Б╤В╨╛╤П╨╜╨╕╨╡ ╤Д╨╕╨╗╤М╤В╤А╨╛╨▓ Transaction Hub. ╨Я╤А╨╛╨▒╨╗╨╡╨╝╨░: ╤В╨╡╨║╤Б╤В ╨║╨╜╨╛╨┐╨╛╨║ ╤Б╨╗╨╕╤И╨║╨╛╨╝ ╨┤╨╗╨╕╨╜╨╜╤Л╨╣ тАФ ╨║╨╜╨╛╨┐╨║╨╕ ╨╜╨╡ ╨▓╨╗╨╡╨╖╨░╨╗╨╕. ╨а╨╡╤И╨╡╨╜╨╕╨╡: `FILTER_LABELS` ╤Б╨▓╨╡╨┤╤С╨╜ ╨║ ╨╕╨║╨╛╨╜╨╛╤З╨╜╤Л╨╝ ╤З╨╕╨┐╨░╨╝. ╨Ь╨░╨║╨╡╤В: `[??][??][??][??][?? ╨Т╤Б╨╡]` тАФ 5 ╨║╨╛╨╝╨┐╨░╨║╤В╨╜╤Л╤Е ╨║╨╜╨╛╨┐╨╛╨║ ╨▓ 1 ╤Б╤В╤А╨╛╨║╤Г. `IntentFilter`: 5 ╤В╨╕╨┐╨╛╨▓ `a/e/i/d/t` (╨┤╨╛╨╗╨│╨╕ dg+dr merged ╨▓ `d`). SQL: `OR (='d' AND intent IN ('debt_given','debt_received'))`. Toggle: ╨╜╨░╨╢╨░╤В╨╕╨╡ ╨╜╨░ ╨░╨║╤В╨╕╨▓╨╜╤Л╨╣ (?╨Т╤Б╨╡) ╤Б╨╜╨╕╨╝╨░╨╡╤В ╤Д╨╕╨╗╤М╤В╤А. Backward compat: dg/dr > d. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. Commits `f4d7ecd`+`d770ca4`, push ?. Railway auto-deploy. |
| 2026-05-15 10:20 | **Transaction Hub UX тАФ 6-Filter Grid 2?3 + CCY Symbol Unification (DEPLOYED).** `transaction-hub.service.ts`: `TX_PAGE_SIZE` 6>5; `IntentFilter` ╤А╨░╤Б╤И╨╕╤А╨╡╨╜ ╨┤╨╛ 6 ╤В╨╕╨┐╨╛╨▓ (`'e'|'i'|'dg'|'dr'|'t'|'a'`); `MonthMiniStats` тАФ ╨┐╨╛╨╗╨╡ `debt_count` ╨╖╨░╨╝╨╡╨╜╨╡╨╜╨╛ ╤В╤А╨╡╨╝╤П: `debt_given_count`, `debt_received_count`, `transfer_count`; SQL-╨╖╨░╨┐╤А╨╛╤Б╤Л `getTransactionList` ╨╕ `countFilteredTransactions` ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╤Л ╤Б ╨┐╨╛╨╗╨╜╨╛╨╣ ╨┐╨╛╨┤╨┤╨╡╤А╨╢╨║╨╛╨╣ dg/dr/t (╤Г╨┤╨░╨╗╤С╨╜ ╤Г╤Б╤В╨░╤А╨╡╨▓╤И╨╕╨╣ ╤Д╨╕╨╗╤М╤В╤А `'d'`). `transaction-keyboard.service.ts`: `CCY_SYMBOL` Unicode-╨║╨░╤А╤В╨░ + `fmtCurrency()` (?/$тВм? ╨┤╨╗╤П ╤Д╨╕╨░╤В╨░, ISO ╨┤╨╗╤П ╨║╤А╨╕╨┐╤В╤Л); `intentEmoji` ╨╛╨▒╨╜╨╛╨▓╨╗╤С╨╜ (???? ╨▓╨╝╨╡╤Б╤В╨╛ ????); `FILTER_LABELS` 4>6; `FILTER_ROW_1=['e','i','t']` + `FILTER_ROW_2=['dr','dg','a']` тАФ ╤Б╨╡╤В╨║╨░ 2?3; ╨┐╨░╨│╨╕╨╜╨░╤Ж╨╕╤П ┬л?? ╨Я╨╛╨╖╨╢╨╡ ┬╖ ?? X/Y ┬╖ ╨а╨░╨╜╤М╤И╨╡ ??┬╗; `formatTxListHeader` ╨┤╨╗╤П ╨▓╤Б╨╡╤Е 6 ╤Д╨╕╨╗╤М╤В╤А╨╛╨▓; `VALID_FILTERS` ╨╛╨▒╨╜╨╛╨▓╨╗╤С╨╜; fallback `'d'>'a'`. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. 23/23 ╨┐╤А╨╛╨▓╨╡╤А╨╛╨║ PASS. Commit `a9c0f52`, push origin main ?. Railway auto-deploy triggered. |
| 2026-05-14 23:50 | **Balance Phase B-5/B-6/B-8/B-9 ? Add Currency Workflow ?????????.** B-8: addChildAccount() ? account.service.ts (withTenantTransaction, parent_account_id, no workspace defaults update). B-6: child_count subquery ? ACCOUNT_DETAIL_SQL; AccountDetailData ??????? child_count. B-5: buildAccountActionsKeyboard(hasChildren?) ?????????? ?????? bl:ac: (32 ?????). webhook.route.ts: add_currency handler + currency_set ????? + 6 ??????? ? detail.child_count>0. B-9: parent_account_id ? GROUP BY PER_ACCOUNT_SQL; ORDER BY ?????????????. tsc 0 ??????. Commits 5ce9148+04e79b8. Railway auto-deploy. |
| 2026-05-15 09:30 | **Balance UI Polish тАФ N26/Revolut professional redesign.** alance.service.ts: (1) ╨Э╨╛╨▓╤Л╨╣ ╤Д╨╛╤А╨╝╨░╤В тАФ 1 ╤Б╤З╤С╤В = 1 ╤Б╤В╤А╨╛╨║╨░ ┬л╨Р╨╗╤М╤Д╨░-╨С╨░╨╜╨║ (? ╨╛╤Б╨╜╨╛╨▓╨╜╨╛╨╣) ┬╖ 22 010 213 ?┬╗ ╨▓╨╝╨╡╤Б╤В╨╛ 2-╤Б╤В╤А╨╛╤З╨╜╨╛╨│╨╛ ┬лL balance currency┬╗. (2) ╨в╨░╨▒╨╗╨╕╤Ж╨░ CCY_SYMBOL тАФ ╤Б╨╕╨╝╨▓╨╛╨╗╤Л ╨▓╨░╨╗╤О╤В ? $ тВм ? ? ? тВм (17 ╨▓╨░╨╗╤О╤В) ╨▓╨╝╨╡╤Б╤В╨╛ ╨║╨╛╨┤╨╛╨▓. (3) 
| 2026-05-15 14:37 | **Balance Visual Redesign chevron fix (commit fbdfa0a). DEPLOYED.** balance.service.ts: ╨╖╨░╨╝╨╡╨╜╨░ ЁЯЯв/ЁЯФ┤ ╨╜╨░ chevron, ╤Г╨▒╤А╨░╨╜ ╨┐╤А╨╛╨▒╨╡╨╗ ╤Г ╨╝╨╕╨╜╤Г╤Б╨░. Railway auto-deploy. |
| 2026-05-15 19:00 | **fix(stt): Normalize crypto tickers (f4eb9c1). DEPLOYED.** ai-parse.worker.ts: ╤О╨╖╨┤╤В->USDT, ╨╡╤Д╨╕╤А->ETH. Railway auto-deploy. |
| 2026-05-15 19:05 | **fix(ux): Auto-delete Otmeneno card (fb5f140). DEPLOYED.** webhook.route.ts: midas:dead_card cleanup ╨┐╤А╨╕ ╨╗╤О╨▒╨╛╨╝ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╕. |
| 2026-05-15 19:10 | **fix(ux): Delete dead card + voice status on new preview (3696042). DEPLOYED.** notifications.worker.ts: ╨╛╨▒╨░ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╤П ╤Г╨┤╨░╨╗╤П╤О╤В╤Б╤П. |
| 2026-05-15 20:00 | **feat(draft): 2-level category picker (f87393a). DEPLOYED.** webhook.route.ts: Screen1: AI-hint + [ЁЯЫТ╨Ц╨╕╨╖╨╜╤М][ЁЯТ╝╨С╨╕╨╖╨╜╨╡╤Б]. Screen2: ╨┐╨╗╨╛╤Б╨║╨╕╨╣ ╤Б╨┐╨╕╤Б╨╛╨║ ╤Б emoji (28 ╨║╨░╤В╨╡╨│╨╛╤А╨╕╨╣). clar:cat:{catId}:{draftId}. |
| 2026-05-15 20:10 | **fix(cat): Remove ╨▒╨╡╨╖-╨║╨░╤В╨╡╨│╨╛╤А╨╕╨╕, smart flatten (17cc9a9). DEPLOYED.** ╨г╨┤╨░╨╗╨╡╨╜╨░ ┬л╨С╨╡╨╖ ╨║╨░╤В╨╡╨│╨╛╤А╨╕╨╕┬╗, auto-flatten ╨┐╤А╨╕ <=6 ╨║╨░╤В╨╡╨│╨╛╤А╨╕╤П╤Е, fix ╨┤╨▓╨╛╨╣╨╜╤Л╤Е emoji ╨▓ ╨╖╨░╨│╨╛╨╗╨╛╨▓╨║╨╡. |
| 2026-05-15 20:15 | **db: Merge Raznoye->Drugoye (60cb4d9). DEPLOYED.** ╨Ь╨╕╨│╤А╨░╤Ж╨╕╤П UPDATE+DELETE ╨┐╨╛ ╨▓╤Б╨╡╨╝ workspace. Railway auto-deploy. |
| 2026-05-15 20:20 | **fix(cat): Backfill 28 default categories (63cd4a3). DEPLOYED.** ╨Т╤Б╤В╨░╨▓╨║╨░ 28 ╨║╨░╨╜╨╛╨╜╨╕╤З╨╡╤Б╨║╨╕╤Е ╨║╨░╤В╨╡╨│╨╛╤А╨╕╨╣. AI-hint excluded from flat list. |
| 2026-05-15 20:30 | **fix(cat): Show selected category in preview (748a81c). DEPLOYED.** getDraftFields: LEFT JOIN categories -> category_name. confirmPreviewFull: category_name ?? parsed_category_hint. tsc 0. |
| 2026-05-16 10:00 | **feat(voice): xAI Grok STT pipeline (588e038). DEPLOYED.** voice-parse.worker.ts + groq-stt.ts: ╨│╨╛╨╗╨╛╤Б -> STT -> ai-parse. BullMQ voice-queue. Railway auto-deploy. |
| 2026-05-16 10:30 | **fix(balance): N26/Revolut redesign (ecf7e63). DEPLOYED.** Compact layout, Title Case, CCY_SYMBOL 17 ╨▓╨░╨╗╤О╤В, icon-only nav. tsc 0. |
| 2026-05-16 14:00 | **fix(onboard): Remove Vse Scheta, fix double-currency header (b9f7fee). DEPLOYED.** ╨Я╨╛╤Б╨╗╨╡ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨╕╤П ╤Б╤З╤С╤В╨░ -> currency-aware single card. ╨Я╤А╨╛╨▓╨░╨╣╨┤╨╡╤А-╨╕╨║╨╛╨╜╨║╨╕. Railway auto-deploy. |
| 2026-05-16 19:00 | **fix(nav): Back button + forced UI refresh (e80522f). DEPLOYED.** Delete-then-send nav message. Redis nav pointer cleanup. Railway auto-deploy. |
| 2026-05-16 20:00 | **feat: type-aware currency picker for tx drafts (8537e8a). DEPLOYED.** ╨Я╨╕╨║╨╡╤А ╤Д╨╕╨╗╤М╤В╤А╤Г╨╡╤В ╨▓╨░╨╗╤О╤В╤Л ╨┐╨╛ ╤В╨╕╨┐╤Г ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕. Railway auto-deploy. |
| 2026-05-17 11:00 | **feat(sprint-0): Professional export suite 2.0 (affbe87). DEPLOYED.** excel-export.service.ts: 5 ╨╗╨╕╤Б╤В╨╛╨▓ (╨б╨▓╨╛╨┤╨║╨░, ╨в╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕, ╨б╤З╨╡╤В╨░, ╨Ъ╨░╤В╨╡╨│╨╛╤А╨╕╨╕, ╨Я╨╛ ╨╝╨╡╤Б╤П╤Ж╨░╨╝). Unified UX: ╨┐╨╡╤А╨╕╨╛╨┤ -> ╤Б╤З╤С╤В -> ╤Д╨╛╤А╨╝╨░╤В. midas:exp:params Redis key. Audit trail footer. tsc 0. |
| 2026-05-18 10:53 | **feat(export): Professional Export Suite 2.0 тАФ Phase 2 ╨н╤В╨░╨┐ 1 (commits affbe87, 2bf24d2). DEPLOYED.** **excel-export.service.ts**: 5-╨╗╨╕╤Б╤В╨╛╨▓╤Л╨╣ Excel (1-╨б╨▓╨╛╨┤╨║╨░: workspace/╨┐╨╡╤А╨╕╨╛╨┤/╤Б╤З╤С╤В + KPI ╨▒╨╗╨╛╨║; 2-╨в╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕: ╨▓╤Б╨╡ ╨║╨╛╨╗╨╛╨╜╨║╨╕ ╤Б running balance; 3-╨б╤З╨╡╤В╨░: ╨▒╨░╨╗╨░╨╜╤Б╤Л; 4-╨Ъ╨░╤В╨╡╨│╨╛╤А╨╕╨╕: ╨░╨╜╨░╨╗╨╕╤В╨╕╨║╨░; 5-╨Я╨╛ ╨╝╨╡╤Б╤П╤Ж╨░╨╝: monthly breakdown). ╨Х╨┤╨╕╨╜╤Л╨╣ UX: 3 ╤И╨░╨│╨░ тАФ ╨┐╨╡╤А╨╕╨╛╨┤ (╨в╨╡╨║╤Г╤Й╨╕╨╣ ╨╝╨╡╤Б╤П╤Ж / 3 ╨╝╨╡╤Б╤П╤Ж╨░ / ╨У╨╛╨┤ / ╨Т╤Б╤С ╨▓╤А╨╡╨╝╤П) -> ╤Б╤З╤С╤В (╨▓╤Б╨╡ / ╨║╨╛╨╜╨║╤А╨╡╤В╨╜╤Л╨╣) -> ╤Д╨╛╤А╨╝╨░╤В (xlsx / csv). Redis key midas:exp:params:{userId}:{chatId} ╤Е╤А╨░╨╜╨╕╤В ╨▓╤Л╨▒╤А╨░╨╜╨╜╤Л╨╣ ╨┐╨╡╤А╨╕╨╛╨┤ + accountId ╨╝╨╡╨╢╨┤╤Г ╤И╨░╨│╨░╨╝╨╕. Audit trail footer ╨╜╨░ ╨╗╨╕╤Б╤В╨╡ ╨б╨▓╨╛╨┤╨║╨░. **webhook.route.ts тАФ 3 ╨▒╨░╨│╨░ ╨╕╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜╤Л:** (1) ╨и╨░╨│ 3 ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╗ raw ULID -> ╤В╨╡╨┐╨╡╤А╤М ┬лBybit ┬╖ USDT┬╗ (╤А╨╡╨╖╨╛╨╗╨▓ ╨╕╨╝╨╡╨╜╨╕ ╤З╨╡╤А╨╡╨╖ getWorkspaceAccountsWithBalances); (2) ╨Ш╨╝╤П ╤Д╨░╨╣╨╗╨░ ╨▓╤Б╨╡╨│╨┤╨░ ╨▒╤Л╨╗ ╤В╨╡╨║╤Г╤Й╨╕╨╣ ╨╝╨╡╤Б╤П╤Ж -> ╤В╨╡╨┐╨╡╤А╤М ╤Б╨╛╨╛╤В╨▓╨╡╤В╤Б╤В╨▓╤Г╨╡╤В ╨┐╨╡╤А╨╕╨╛╨┤╤Г (MIDAS_Report_2026-04.xlsx, MIDAS_Report_2026-05_3m.xlsx, MIDAS_Report_all.xlsx); (3) Confirmation step ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╗ ╤В╨╛╨╗╤М╨║╨╛ ╨┐╨╡╤А╨╕╨╛╨┤ -> ╤В╨╡╨┐╨╡╤А╤М ╨┐╨╡╤А╨╕╨╛╨┤ + ╤Б╤З╤С╤В. **settings-advanced.service.ts**: exportTransactionsCSV() ╤А╨░╤Б╤И╨╕╤А╨╡╨╜╨░ ╨┐╨░╤А╨░╨╝╨╡╤В╤А╨░╨╝╨╕ dateFrom, dateTo, accountId тАФ SQL ╤Д╨╕╨╗╤М╤В╤А╤Г╨╡╤В ╤З╨╡╤А╨╡╨╖ DATE() ╨╕ account_id =  (╨┐╨░╤А╨░╨╝╨╡╤В╤А╨╕╨╖╨╛╨▓╨░╨╜╨╜╤Л╨╣ ╨╖╨░╨┐╤А╨╛╤Б, ╨▒╨╡╨╖ SQL-╨╕╨╜╤К╨╡╨║╤Ж╨╕╨╣). **phase-2.0-pitch.md ╤Б╨╡╨║╤Ж╨╕╤П 6 ╨┐╨╡╤А╨╡╨┐╨╕╤Б╨░╨╜╨░**: UX-preview 3-╤И╨░╨│╨╛╨▓╨╛╨│╨╛ ╨┤╨╕╨░╨╗╨╛╨│╨░, 5 ╨╗╨╕╤Б╤В╨╛╨▓ ╤Б ╨║╨╛╨╜╨║╤А╨╡╤В╨╜╤Л╨╝╨╕ ╨║╨╛╨╗╨╛╨╜╨║╨░╨╝╨╕, ╤В╨░╨▒╨╗╨╕╤Ж╨░ ╨▓╨╕╨╖╤Г╨░╨╗╤М╨╜╨╛╨│╨╛ ╤Б╤В╨░╨╜╨┤╨░╤А╤В╨░ (header #1A3C5E, accent #2E7D32, warning #E65100, ╤А╨░╨╖╨┤╨╡╨╗╨╕╤В╨╡╨╗╤М ╤В╤Л╤Б╤П╤З = ╨┐╤А╨╛╨▒╨╡╨╗, ╤И╤А╨╕╤Д╤В Calibri 11pt). tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. Railway auto-deploy. |
| 2026-05-15 08:00 | **feat(roles): Simplify to 2-state normal/primary toggle (750d1ba). DEPLOYED.** ╨г╨┐╤А╨╛╤Й╨╡╨╜╨░ ╤Б╨╕╤Б╤В╨╡╨╝╨░ ╤А╨╛╨╗╨╡╨╣ ╨░╨║╨║╨░╤Г╨╜╤В╨░ ╨┤╨╛ 2 ╤Б╨╛╤Б╤В╨╛╤П╨╜╨╕╨╣. fix(roles): ╨╕╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜╤Л toast-╨╕╨║╨╛╨╜╨║╨╕ ╨▓ set_role callback (5a8d74e). |
| 2026-05-15 08:30 | **feat(balance): Multi-currency UX overhaul Phase B-2+ (392c177). DEPLOYED.** ╨Я╨╛╨╗╨╜╨░╤П ╨┐╨╡╤А╨╡╤А╨░╨▒╨╛╤В╨║╨░ ╨╝╨╜╨╛╨│╨╛╨▓╨░╨╗╤О╤В╨╜╨╛╨│╨╛ ╨▒╨░╨╗╨░╨╜╤Б╨░. V2 redesign тАФ dot notation, multi-currency cards, sub-accounts (c3f2334). |
| 2026-05-15 09:00 | **feat(balance): Phase 9 тАФ auto-select primary account for AI parse (1ca5ab1). DEPLOYED.** ai-parse ╨░╨▓╤В╨╛╨╝╨░╤В╨╕╤З╨╡╤Б╨║╨╕ ╨▓╤Л╨▒╨╕╤А╨░╨╡╤В ╨╛╤Б╨╜╨╛╨▓╨╜╨╛╨╣ ╤Б╤З╤С╤В. fix v3/v4: RLS-safe SQL ╤З╨╡╤А╨╡╨╖ workspaces table (378b976, 1bd5ae8). |
| 2026-05-15 10:00 | **feat(voice): xAI Grok STT тАФ crash fixes (e77cf67, 7fa5b9f). DEPLOYED.** ╨г╨┤╨░╨╗╤С╨╜ BullMQ limiter (╨▓╤Л╨╖╤Л╨▓╨░╨╗ crash ╨┐╤А╨╕ ╤Б╤В╨░╤А╤В╨╡). ╨Ш╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜ frozen status msg ╨╕ colon-in-jobId crash ╨▓ BullMQ. |
| 2026-05-15 11:00 | **feat(voice): Clean chat UX (098c620, 62f94fd). DEPLOYED.** ╨г╨┤╨░╨╗╨╡╨╜╨╕╨╡ ╨│╨╛╨╗╨╛╤Б╨╛╨▓╨╛╨│╨╛ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╤П + ╨╛╤В╤Б╨╗╨╡╨╢╨╕╨▓╨░╨╜╨╕╨╡/╨╛╤З╨╕╤Б╤В╨║╨░ error messages. fix: ╤Г╨┤╨░╨╗╨╡╨╜╨╕╨╡ ┬лтП│ ╨а╨░╤Б╨┐╨╛╨╖╨╜╨░╤ОтАж┬╗ ╨║╨╛╨│╨┤╨░ gate ╨╛╤В╨║╨╗╨╛╨╜╤П╨╡╤В ╨╜╨╛╨▓╤Л╨╣ ╨│╨╛╨╗╨╛╤Б╨╛╨▓╨╛╨╣ ╨▓╨▓╨╛╨┤. |
| 2026-05-15 12:00 | **ui(balance): Professional fintech balance redesign (f3780b5..e418b6a). DEPLOYED.** Bloomberg+Coinbase hybrid renderer. Backward compat ╨┤╨╗╤П ╤Б╤В╨░╤А╨╛╨╣ ЁЯТ░ ╨║╨╜╨╛╨┐╨║╨╕. ╨г╨▒╤А╨░╨╜╤Л <pre> ╨▒╨╗╨╛╨║╨╕, clean HTML renderer. ╨Ь╤Г╨╗╤М╤В╨╕╨▓╨░╨╗╤О╤В╨░ ╨╜╨░ ╨╛╨┤╨╜╨╛╨╣ ╤Б╤В╤А╨╛╨║╨╡ ╤З╨╡╤А╨╡╨╖ / ╤А╨░╨╖╨┤╨╡╨╗╨╕╤В╨╡╨╗╤М. |
| 2026-05-15 19:30 | **feat(ai): Phase 2.7 тАФ spoken-number normalization + stop-words (4a38176). DEPLOYED.** ╨Э╨╛╤А╨╝╨░╨╗╨╕╨╖╨░╤Ж╨╕╤П ╤Г╤Б╤В╨╜╤Л╤Е ╤З╨╕╤Б╨╡╨╗ (┬л╤Б╤В╨╛┬╗ тЖТ 100), stop-words filter, ╤Г╨║╤А╨░╨╕╨╜╤Б╨║╨╕╨╡ ╨│╨╗╨░╨│╨╛╨╗╤Л. fix(draft): ╨║╨╜╨╛╨┐╨║╨░ Back ╨▓ currency picker ╨▓╨╛╨╖╨▓╤А╨░╤Й╨░╨╡╤В ╨╜╨░ confirm card (45b3ac7). |
| 2026-05-16 08:00 | **feat: success screen v2, /help cheat sheet (153b44f). DEPLOYED.** ╨Э╨╛╨▓╤Л╨╣ success screen. ╨Ъ╨╛╨╝╨░╨╜╨┤╨░ /help ╤Б cheat sheet. ╨г╨┤╨░╨╗╨╡╨╜╨░ ┬л╨С╨░╨╖╨╛╨▓╨░╤П ╨▓╨░╨╗╤О╤В╨░┬╗ ╨╕╨╖ settings UI (c32186d, 71087838). |
| 2026-05-16 08:30 | **fix(balance): fiat/crypto separation in currency picker (691da2d..1e30c92). DEPLOYED.** ╨д╨╕╨╗╤М╤В╤А╨░╤Ж╨╕╤П ╨┐╨╕╨║╨╡╤А╨░ ╨┐╨╛ ╤В╨╕╨┐╤Г ╨░╨║╨║╨░╤Г╨╜╤В╨░ (fiat/crypto). ╨Ф╨╛╨▒╨░╨▓╨╗╨╡╨╜ SGD ╨▓ fiat presets (╨┐╨╛╨╗╨╜╨░╤П 4├Ч3 grid). ╨б╤В╤А╨╛╨│╨╛╨╡ ╤А╨░╨╖╨┤╨╡╨╗╨╡╨╜╨╕╨╡ fiat/crypto. |
| 2026-05-16 09:00 | **feat(ux): Receipt-style account success screen (7395d9d). DEPLOYED.** Redesign success screen ╨▓ ╤Б╤В╨╕╨╗╨╡ ╨▒╨░╨╜╨║╨╛╨▓╤Б╨║╨╛╨│╨╛ ╤З╨╡╨║╨░. fix: ╨▓╤Б╨╡╨│╨┤╨░ ╨╕╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╡╤В╤Б╤П ╤А╤Г╤Б╤Б╨║╨╕╨╣ ╤П╨╖╤Л╨║ ╨▓ ╨┐╤А╨╕╨╝╨╡╤А╨░╤Е ╨▓╨░╨╗╤О╤В (0f8171e). |
| 2026-05-16 09:30 | **fix(balance): add_currency UX + back navigation (45bf6b5, a4faf03). DEPLOYED.** ╨Я╨╛╤Б╨╗╨╡ add_currency ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В╤Б╤П multi-card (╨╜╨╡ ╤Б╨┐╨╕╤Б╨╛╨║). ╨Ш╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜╨░ nav ╨║╨╜╨╛╨┐╨║╨░ Back ╨╕╨╖ single-settings тЖТ multi-card. |
| 2026-05-16 10:00 | **fix: Skrill icon, e-wallet PROVIDER_ICONS (fba0f2b). DEPLOYED.** ЁЯУ▒ ╨╕╨║╨╛╨╜╨║╨░ ╨┤╨╗╤П Skrill. 3-example blockquote format ╨┤╨╗╤П ╨▓╨▓╨╛╨┤╨░. |
| 2026-05-16 10:30 | **feat: reminder keyboard тАФ account context + account picker (0d90ef3, 309b39f). DEPLOYED.** ╨Э╨░╨┐╨╛╨╝╨╕╨╜╨░╨╜╨╕╨╡ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В ╨║╨╛╨╜╤В╨╡╨║╤Б╤В ╤Б╤З╤С╤В╨░. Reminder card ╨▓╤Б╨╡╨│╨┤╨░ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В account picker (╨╛╨┤╨╕╨╜ ╤В╨░╨┐ = ╨▓╤Л╨▒╨╛╤А + ╨┐╨╛╨┤╤В╨▓╨╡╤А╨╢╨┤╨╡╨╜╨╕╨╡). |
| 2026-05-16 11:00 | **feat(phase-2.6): reminder screen mirror + chat hygiene (da1f4ce, cc26652). DEPLOYED.** ╨Ч╨╡╤А╨║╨░╨╗╨╕╤А╨╛╨▓╨░╨╜╨╕╨╡ reminder screen. ╨Ш╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╡╤В╤Б╤П real account_currency ╨▓ reminder keyboard. fix: rename migration ╨┤╨╗╤П ╨║╨╛╤А╤А╨╡╨║╤В╨╜╨╛╨│╨╛ timestamp (63d6ef8). |
| 2026-05-16 11:30 | **fix(settings): clear tz_srch Redis key on Back (77059cc). DEPLOYED.** ╨Ю╤З╨╕╤Б╤В╨║╨░ midas:tz_srch ╨┐╤А╨╕ ╨╜╨░╨╢╨░╤В╨╕╨╕ Back тАФ ╨┐╤А╨╡╨┤╨╛╤В╨▓╤А╨░╤Й╨░╨╡╤В ╨╖╨░╨▓╨╕╤Б╨░╨╜╨╕╨╡ timezone search. |
| 2026-05-16 12:00 | **feat: transfer deducts from account balance D3 (bdfb96c). DEPLOYED.** ╨Я╨╡╤А╨╡╨▓╨╛╨┤╤Л ╨║╨╛╤А╤А╨╡╨║╤В╨╜╨╛ ╨▓╤Л╤З╨╕╤В╨░╤О╤В ╤Б╤Г╨╝╨╝╤Г ╤Б ╨▒╨░╨╗╨░╨╜╤Б╨░ ╤Б╤З╤С╤В╨░ (D3 semantic change). fix: initial success card missing balance + duplicate currency in child accounts (8c0de4b). |
| 2026-05-16 12:30 | **fix: unify debt icons ЁЯдЭ/ЁЯд▓ (ac4f97b). DEPLOYED.** ╨Х╨┤╨╕╨╜╤Л╨╡ ╨╕╨║╨╛╨╜╨║╨╕ ╨┤╨╗╤П debt-╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╣ ╨╜╨░ ╨▓╤Б╨╡╤Е UI ╨┐╨╛╨▓╨╡╤А╤Е╨╜╨╛╤Б╤В╤П╤Е. feat: ╨┐╨╛╨║╨░╨╖ badge ╨░╤А╤Е╨╕╨▓╨╜╨╛╨│╨╛ ╨░╨║╨║╨░╤Г╨╜╤В╨░ ╨╜╨░ transaction card (a88e3c2). |
| 2026-05-16 13:00 | **feat: guarantee item_name via L2 fallback (4d13c71). DEPLOYED.** buildItemName() тАФ L2 fallback ╨│╨░╤А╨░╨╜╤В╨╕╤А╤Г╨╡╤В item_name ╨┤╨╗╤П ╨║╨░╨╢╨┤╨╛╨╣ ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕. |
| 2026-05-16 13:30 | **feat: professional account picker тАФ icons, balance, cross-currency grouping (c4be32a). DEPLOYED.** ╨Я╤А╨╛╤Д╨╡╤Б╤Б╨╕╨╛╨╜╨░╨╗╤М╨╜╤Л╨╣ ╨┐╨╕╨║╨╡╤А ╤Б╤З╨╡╤В╨╛╨▓: ╨╕╨║╨╛╨╜╨║╨╕ ╨┐╤А╨╛╨▓╨░╨╣╨┤╨╡╤А╨╛╨▓, ╨▒╨░╨╗╨░╨╜╤Б╤Л, ╨│╤А╤Г╨┐╨┐╨╕╤А╨╛╨▓╨║╨░ ╨┐╨╛ ╨▓╨░╨╗╤О╤В╨╡. fix: broken unicode escape in ed:field_acc (034af02). |
| 2026-05-16 14:30 | **fix: onboarding flow for users with no accounts (fd17266, a4a261b). DEPLOYED.** ╨Я╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В create-account prompt ╨▓╨╝╨╡╤Б╤В╨╛ ╤Б╤В╨░╤А╤Л╤Е confirm buttons. Onboarding flow ╨┤╨╗╤П returning users ╨▒╨╡╨╖ ╤Б╤З╨╡╤В╨╛╨▓ (╨┐╨╛╤Б╨╗╨╡ reset). |
| 2026-05-16 15:00 | **feat: 2-level category picker with emoji (e4084644, 77b10c1). DEPLOYED.** ╨Т╤В╨╛╤А╨╛╨╣ ╨╖╨░╤Е╨╛╨┤ ╨╜╨░ 2-level category picker (╨▓ background-workers ╨║╨╛╨╜╤В╨╡╨║╤Б╤В╨╡). ╨в╨╡╨║╤Г╤Й╨░╤П ╨║╨░╤В╨╡╨│╨╛╤А╨╕╤П ╨┐╨╡╤А╨╡╨╜╨╡╤Б╨╡╨╜╨░ ╨▓ header text ╨▓╨╝╨╡╤Б╤В╨╛ ╨║╨╜╨╛╨┐╨║╨╕. fix: ╨▓╤Б╨╡╨│╨┤╨░ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В╤Б╤П account+balance block ╨╜╨░ confirmation card (cc84678). |
| 2026-05-17 08:00 | **feat: professional Excel export 4 sheets (81ef834). DEPLOYED.** ╨Я╨╡╤А╨▓╨░╤П ╨╕╤В╨╡╤А╨░╤Ж╨╕╤П Excel export: 4 ╨╗╨╕╤Б╤В╨░ (Transactions, Accounts, Categories, Monthly). fix: transfer ru locale, executor heuristic, debit fallback (aade176). |
| 2026-05-17 09:00 | **feat: running balance column in Excel export (16d7e21). DEPLOYED.** ╨Ъ╨╛╨╗╨╛╨╜╨║╨░ ┬л╨Ю╤Б╤В╨░╤В╨╛╨║ ╨╜╨░ ╤Б╤З╤С╤В╨╡┬╗ ╨▓ Excel (╨╜╨░╤А╨░╤Б╤В╨░╤О╤Й╨╕╨╣ ╨╕╤В╨╛╨│). fix: per-currency summary + signed ╨Т╤Л╨┐╨╗╨░╤З╨╡╨╜╨╛ ╨▓╤Б╨╡╨│╨┤╨░ ╨╛╤В╨╛╨▒╤А╨░╨╢╨░╨╡╤В╤Б╤П (0ba6ef5). |
| 2026-05-17 10:00 | **fix: nav phantom edits on onboarding success (7a8a117). DEPLOYED.** ╨г╤Б╤В╤А╨░╨╜╨╡╨╜╤Л phantom edits nav message ╨┐╤А╨╕ onboarding success. chore: telegram API error logging (267ed97). fix: force fresh nav panel on reply keyboard press (6a48760). |
| 2026-05-18 11:00 | **docs: Restore workflow_state.md from CP1251 corruption.** ╨д╨░╨╣╨╗ ╨▒╤Л╨╗ ╨▓ CP1251, ╨╖╨░╨┐╨╕╤Б╨░╨╜ ╨║╨░╨║ UTF-8 ╤Б U+FFFD ╨▓╨╝╨╡╤Б╤В╨╛ ╨║╨╕╤А╨╕╨╗╨╗╨╕╤Ж╤Л. ╨Т╨╛╤Б╤Б╤В╨░╨╜╨╛╨▓╨╗╨╡╨╜ ╨╕╨╖ git 83289493, ╨┐╨╡╤А╨╡╨║╨╛╨┤╨╕╤А╨╛╨▓╨░╨╜ ╨▓ UTF-8, ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╤Л ╨╖╨░╨┐╨╕╤Б╨╕ 2026-05-15 -- 2026-05-18. |
| 2026-05-18 11:30 | **docs: workflow_state.md ╨▓╨╛╤Б╤Б╤В╨░╨╜╨╛╨▓╨╗╨╡╨╜ ╨╕ ╨░╨║╤В╤Г╨░╨╗╨╕╨╖╨╕╤А╨╛╨▓╨░╨╜.** ╨д╨░╨╣╨╗ ╨▒╤Л╨╗ ╨▓ CP1251, ╨┐╨╡╤А╨╡╨╖╨░╨┐╨╕╤Б╨░╨╜ ╤Б U+FFFD ╨▓╨╝╨╡╤Б╤В╨╛ ╨║╨╕╤А╨╕╨╗╨╗╨╕╤Ж╤Л ╨▓ ╨║╨╛╨╝╨╝╨╕╤В╨╡ 588e038 (xAI Grok STT ╤Б╨╡╤Б╤Б╨╕╤П). ╨Т╨╛╤Б╤Б╤В╨░╨╜╨╛╨▓╨╗╨╡╨╜ ╨╕╨╖ git 83289493 (╤З╨╕╤Б╤В╤Л╨╣ CP1251 -> UTF-8). ╨Ф╨╛╨▒╨░╨▓╨╗╨╡╨╜╨╛ 42 ╨┐╤А╨╛╨┐╤Г╤Й╨╡╨╜╨╜╤Л╤Е changelog-╨╖╨░╨┐╨╕╤Б╨╕ ╨╖╨░ 2026-05-15..2026-05-18 (74 ╨╜╨╡╨╖╨░╨┤╨╛╨║╤Г╨╝╨╡╨╜╤В╨╕╤А╨╛╨▓╨░╨╜╨╜╤Л╤Е ╨║╨╛╨╝╨╝╨╕╤В╨░). ╨б╨╡╨║╤Ж╨╕╤П 1 ╨в╨Х╨Ъ╨г╨й╨Х╨Х ╨б╨Ю╨б╨в╨Ю╨п╨Э╨Ш╨Х ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╨░. Orphan-╤Б╨╡╨║╤Ж╨╕╤П ╨┐╨╡╤А╨╡╨╝╨╡╤Й╨╡╨╜╨░ ╨▓ ╨╛╤Б╨╜╨╛╨▓╨╜╤Г╤О ╤В╨░╨▒╨╗╨╕╤Ж╤Г. Commits 58d9dc2, f96b13a, a1def96. |
| 2026-05-18 21:30 | **fix(excel): Sheet1 ╨в╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕ тАФ audit-grade UX overhaul (c8c5714). DEPLOYED.** `excel-export.service.ts`: (1) ╨г╨┤╨░╨╗╨╡╨╜╤Л ╨║╨╛╨╗╨╛╨╜╨║╨╕ I (╨▓╨░╨╗╤О╤В╨░ ╤Б╤Г╨╝╨╝╤Л) ╨╕ K (╨▓╨░╨╗╤О╤В╨░ ╨▓╤Л╨┐╨╗╨░╤З╨╡╨╜╨╛) тАФ ╨▓╨░╨╗╤О╤В╨░ ╨▓╤Б╤В╤А╨╛╨╡╨╜╨░ ╨▓ `numFmt` ╤П╤З╨╡╨╡╨║ H ╨╕ I (╨╜╨░╨┐╤А.: `10 000 UAH`, `-10 000 PLN`). (2) ┬л╨в╨╕╨┐┬╗ тЖТ ┬л╨Ю╨┐╨╡╤А╨░╤Ж╨╕╤П┬╗. (3) ╨У╤А╨░╨╜╨╕╤Ж╤Л `dataBorder` (#D5E8F5) ╨╜╨░ ╨▓╤Б╨╡╤Е ╤П╤З╨╡╨╣╨║╨░╤Е ╨┤╨░╨╜╨╜╤Л╤Е. (4) ╨Т╤Л╤А╨░╨▓╨╜╨╕╨▓╨░╨╜╨╕╨╡: ╤З╨╕╤Б╨╗╨░ тЖТ right, ╨║╨╛╨┤╤Л/╨┤╨░╤В╤Л тЖТ center, ╤В╨╡╨║╤Б╤В тЖТ left. (5) ╨Ъ╤Г╤А╤Б (J=10): blank ╨┤╨╗╤П ╨╛╨┤╨╜╨╛╨▓╨░╨╗╤О╤В╨╜╤Л╤Е ╤Б╤В╤А╨╛╨║, `1 PLN = 0.2541 UAH` ╤В╨╛╨╗╤М╨║╨╛ ╨┤╨╗╤П ╨║╤А╨╛╤Б╤Б-╨▓╨░╨╗╤О╤В. (6) ╨Ш╨в╨Ю╨У╨Ю ╨▒╨╗╨╛╨║ ╤Г╨┤╨░╨╗╤С╨╜ тАФ ╨╗╨╡╨┤╨╢╨╡╤А ╤З╨╕╤Б╤В╤Л╨╣. (7) ╨з╨░╤Б╨╛╨▓/╨б╤В╨░╨▓╨║╨░ ╨┐╨╡╤А╨╡╨╜╨╡╤Б╨╡╨╜╤Л ╨╜╨░ cols O=15/P=16, ╤Д╨╛╤А╨╝╤Г╨╗╨░ `=IFERROR(HтВЩ/OтВЩ,"")`. (8) ╨и╨╕╤А╨╕╨╜╤Л: A=20 (╨┤╨╗╤П ╨Ш╨╝╨╡╨╜ ╤Б╤З╨╡╤В╨╛╨▓ ╨▓ ╨Ю╨б╨в╨Р╨в╨Ъ╨Р╨е), J=30 (╨┤╨╗╤П ╨б╨▓╨╛╨┤╨║╨░ + ╨║╤Г╤А╤Б), N=22 (╨┤╨╗╤П 3┬а122┬а213 PLN). tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. Railway auto-deploy. |
| 2026-05-18 21:36 | **fix(excel): remove unused usdRates param (9ce6b92). DEPLOYED.** `excel-export.service.ts`: ╤Г╨┤╨░╨╗╤С╨╜ ╨┐╨░╤А╨░╨╝╨╡╤В╤А `usdRates: Map<string,number>` ╨╕╨╖ ╤Б╨╕╨│╨╜╨░╤В╤Г╤А╤Л `buildSheet1` ╨╕ ╤В╨╛╤З╨║╨╕ ╨▓╤Л╨╖╨╛╨▓╨░ тАФ ╨╕╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜╨░ ╨╛╤И╨╕╨▒╨║╨░ `TS6133: declared but never read`, ╨┐╤А╨╕╨▓╨╡╨┤╤И╨░╤П ╨║ ╨┐╨░╨┤╨╡╨╜╨╕╤О ╨▒╨╕╨╗╨┤╨░ Railway. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. Railway auto-deploy. | settings-advanced.service.ts: (1) account_source_id -> account_id; (2) base_amount -> original_amount; (3) base_currency -> currency. ╨С╨░╨│╨╕ ╨╜╨╡ ╨╗╨╛╨▓╨╕╨╗╨╕╤Б╤М tsc (SQL = string). ╨Э╨░╨╣╨┤╨╡╨╜╤Л ╤А╤Г╤З╨╜╤Л╨╝ ╨░╤Г╨┤╨╕╤В╨╛╨╝. excel-export.service.ts: JSDoc ╨╛╨▒╨╜╨╛╨▓╨╗╤С╨╜ ╨┤╨╛ 5 ╨╗╨╕╤Б╤В╨╛╨▓. |
| 2026-05-19 11:00 | **fix(transfer): tp:tgt deleted_at error тАФ SQL hardening (commit 19d68b5). DEPLOYED.** `transfer-pairing.service.ts`: ╤Г╨┤╨░╨╗╤С╨╜ ╤Д╨╕╨╗╤М╤В╤А `deleted_at IS NULL` ╨╕╨╖ ╨╖╨░╨┐╤А╨╛╤Б╨╛╨▓ ╨║ ╤В╨░╨▒╨╗╨╕╤Ж╨╡ `transaction_drafts` тАФ ╤Н╤В╨╛╨╣ ╨║╨╛╨╗╨╛╨╜╨║╨╕ ╨╜╨╡ ╤Б╤Г╤Й╨╡╤Б╤В╨▓╤Г╨╡╤В ╨▓ ╤Б╤Е╨╡╨╝╨╡, ╤З╤В╨╛ ╨▓╤Л╨╖╤Л╨▓╨░╨╗╨╛ runtime-╨╛╤И╨╕╨▒╨║╤Г ╨┐╤А╨╕ ╨▓╤Л╨▒╨╛╤А╨╡ ╤Ж╨╡╨╗╨╡╨▓╨╛╨│╨╛ ╤Б╤З╤С╤В╨░ ╨┐╨╡╤А╨╡╨▓╨╛╨┤╨░. `webhook.route.ts`: ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨╛ ╨┤╨╕╨░╨│╨╜╨╛╤Б╤В╨╕╤З╨╡╤Б╨║╨╛╨╡ ╨╗╨╛╨│╨╕╤А╨╛╨▓╨░╨╜╨╕╨╡ ╨▓ `tp:tgt` handler тАФ `setDraftTargetAccount` ╤А╨╡╨╖╤Г╨╗╤М╤В╨░╤В ╨╕ `getDraftTransferState` ╨┤╨░╨╜╨╜╤Л╨╡. ╨г╨╗╤Г╤З╤И╨╡╨╜╨░ ╨╛╨▒╤А╨░╨▒╨╛╤В╨║╨░ ╨╛╤И╨╕╨▒╨╛╨║ тАФ ╨╗╨╛╨│╨╕╤А╤Г╨╡╤В╤Б╤П stack trace. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. |
| 2026-05-19 14:40 | **fix(balance): direction-aware formula parity тАФ source picker = target picker (commit 663cca1). DEPLOYED.** `account.service.ts`: ╨╕╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜╤Л ╨┤╨▓╨╡ ╤Д╤Г╨╜╨║╤Ж╨╕╨╕ `getWorkspaceAccountsWithBalances()` ╨╕ `getAccountWithBalance()` тАФ ╨╖╨░╨╝╨╡╨╜╨░ ╤Б╤В╨░╤А╨╛╨╣ ╤Д╨╛╤А╨╝╤Г╨╗╤Л `ELSE -amount` (╨▓╤Б╨╡ transfer = ╤А╨░╤Б╤Е╨╛╨┤) ╨╜╨░ direction-aware ╨╗╨╛╨│╨╕╨║╤Г: `transfer + inbound тЖТ +amount`, `transfer + outbound/NULL тЖТ -amount`. Root cause: source picker (╨н╨║╤А╨░╨╜ 1) ╨╕╤Б╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╨╗ ╤Г╤Б╤В╨░╤А╨╡╨▓╤И╤Г╤О ╤Д╨╛╤А╨╝╤Г╨╗╤Г, target picker (╨н╨║╤А╨░╨╜ 2) ╤Г╨╢╨╡ ╨╕╨╝╨╡╨╗ direction-aware ╨╗╨╛╨│╨╕╨║╤Г ╨╕╨╖ `getAvailableTargetAccounts` тАФ ╨╛╤В╤Б╤О╨┤╨░ ╤А╨░╤Б╤Е╨╛╨╢╨┤╨╡╨╜╨╕╨╡ ╨▒╨░╨╗╨░╨╜╤Б╨╛╨▓ ╨╜╨░ UI. ╨в╨╡╨┐╨╡╤А╤М ╨▓╤Б╨╡ 4 ╤В╨╛╤З╨║╨╕ ╤А╨░╤Б╤З╤С╤В╨░ ╨▒╨░╨╗╨░╨╜╤Б╨░ (balance.service.ts PER_ACCOUNT_SQL, getAvailableTargetAccounts, getWorkspaceAccountsWithBalances, getAccountWithBalance) ╨╕╤Б╨┐╨╛╨╗╤М╨╖╤Г╤О╤В ╨╛╨┤╨╕╨╜╨░╨║╨╛╨▓╤Г╤О direction-aware ╤Д╨╛╤А╨╝╤Г╨╗╤Г. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. commit 663cca1 pushed to main. Railway auto-deploy. |
| 2026-05-19 15:00 | **audit: SQL Transfer Flow Verification.** ╨Я╤А╨╛╨▓╨╡╤А╨║╨░ ╤Б╤Е╨╡╨╝╤Л ╨С╨Ф: `transfer_direction` TEXT nullable тЬЕ, `transfer_target_account_id` TEXT nullable тЬЕ, `transaction_drafts` ╨▒╨╡╨╖ `deleted_at` тЬЕ. ╨Р╤Г╨┤╨╕╤В ╤Д╨╛╤А╨╝╤Г╨╗╤Л: OLD=NEW ╨┤╨╗╤П ╨▓╤Б╨╡╤Е 5 ╤Б╤З╤С╤В╨╛╨▓ ╤Б transfer-╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╤П╨╝╨╕ (╨▓╤Б╨╡ outbound, 0 inbound). ╨Я╤А╨╛╨▓╨╡╤А╨╡╨╜╨░ ╨╗╨╛╨│╨╕╨║╨░ `approvePairedTransfer` (draft-confirmation.service.ts lines 760-941): ╨╕╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╡╤В direction-aware BALANCE_SQL, ╨╖╨░╨┐╨╕╤Б╤Л╨▓╨░╨╡╤В outbound+inbound ╤А╤П╨┤╨╛╨╝. Pending draft `01KS00HZHSQXQRXVB3XH061BS7` ╨│╨╛╤В╨╛╨▓ ╨║ E2E-╤В╨╡╤Б╤В╤Г: ╨в╨╕╨╜╤М╨║╨╛╤Д╤Д PLN тЖР 1000 PLN, available targets: Binance (12 312 USDT) / ╨Ь╨╛╨╜╨╛╨▒╨░╨╜╨║ (21 231 UAH) / ╨б╨▒╨╡╤А╨▒╨░╨╜╨║ (-11 316 USD). workflow_state.md ╨╛╨▒╨╜╨╛╨▓╨╗╤С╨╜: ╤Б╨╡╨║╤Ж╨╕╨╕ 1, 8, 9. |
| 2026-05-18 12:30 | **feat(excel): Smart number formatting + chronological months (6e597e0). DEPLOYED.** CRYPTO_SET: 18 ╨╝╨╛╨╜╨╡╤В (BTC/ETH/USDT/USDC/BNB/SOL/TON/TRX/XRP/DOGE/LTC/MATIC/DOT/ADA/AVAX/ATOM/LINK). smartNumFmt(currency): fiat=#,##0.## (max 2dp ╨▒╨╡╨╖ trailing zeros), crypto=#,##0.######## (max 8dp). ╨Ы╨╛╨│╨╕╨║╨░: 100.00->100, 15.50->15.5, 0.00012345->0.00012345. fmtAmtSigned() ╤В╨╛╨╢╨╡ ╨▒╨╡╨╖ trailing zeros + NBSP ╤А╨░╨╖╨┤╨╡╨╗╨╕╤В╨╡╨╗╤М ╤В╤Л╤Б╤П╤З. Sheet4 ╨Я╨╛ ╨╝╨╡╤Б╤П╤Ж╨░╨╝: ╤Е╤А╨╛╨╜╨╛╨╗╨╛╨│╨╕╤З╨╡╤Б╨║╨░╤П ╤Б╨╛╤А╤В╨╕╤А╨╛╨▓╨║╨░ ╤З╨╡╤А╨╡╨╖ parseMonKey(). ╨Ъ╤Г╤А╤Б: #,##0.#### (4dp). |
| 2026-05-18 13:30 | **feat(excel): Sheet0 Visual Polish тАФ 10-point audit-grade redesign (3 commits). DEPLOYED.** excel-export.service.ts: (1) Navy/steel-blue ╤Ж╨▓╨╡╤В╨╛╨▓╨░╤П ╨┐╨░╨╗╨╕╤В╤А╨░ тАФ C_NAVY_DARK (#1A3C5E), C_TOTAL_HDR (#BDD5E8), C_TOTAL_BG (#EBF5FB); (2) ╨Х╨┤╨╕╨╜╨░╤П thin-border ╤Б╨╡╤В╨║╨░ ╤В╨░╨▒╨╗╨╕╤Ж (FFBDD5E8) ╨╜╨░ ╨▓╤Б╨╡╤Е ╨▒╨╗╨╛╨║╨░╤Е ╨б╨▓╨╛╨┤╨║╨╕; (3) ╨б╤В╨░╨╜╨┤╨░╤А╤В╨╜╨░╤П ╨▓╤Л╤Б╨╛╤В╨░ ╤Б╤В╤А╨╛╨║ 18px; (4) ╨Т╤Л╤А╨░╨▓╨╜╨╕╨▓╨░╨╜╨╕╨╡ ╤Д╨╕╨╜╨░╨╜╤Б╨╛╨▓╤Л╤Е ╨║╨╛╨╗╨╛╨╜╨╛╨║ ╨┐╨╛ ╨┐╤А╨░╨▓╨╛╨╝╤Г ╨║╤А╨░╤О; (5) ╨Ч╨╜╨░╨║ ╨┐╨╡╤А╨╡╨▓╨╛╨┤╨╛╨▓ ╨╕╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜ тАФ transfer ╤В╨╡╨┐╨╡╤А╤М ╨▓╤Л╤З╨╕╤В╨░╨╡╤В╤Б╤П (тИТtransfer) ╨╕╨╖ Movement; (6) ╨Ч╨░╨╝╨╛╤А╨╛╨╖╨║╨░ ╤И╨░╨┐╨║╨╕ ╨╗╨╕╤Б╤В╨░ (ySplit: 1 freeze pane); (7) Navy ╤Ж╨▓╨╡╤В ╨▓╨║╨╗╨░╨┤╨║╨╕ ┬л╨б╨▓╨╛╨┤╨║╨░┬╗ (tabColor: 1A3C5E). tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. |
| 2026-05-18 14:00 | **fix(excel): Grand total UX + balance sign + movement dedup. DEPLOYED.** (1) Grand total: label ╤П╤З╨╡╨╣╨║╨╕ ╨╛╨▒╤К╨╡╨┤╨╕╨╜╤С╨╜ ╤З╨╡╤А╨╡╨╖ cols 1тАУ3, right-aligned ┬л╨┐╤А╨╕╨╢╨░╤В┬╗ ╨║ ╨╖╨╜╨░╤З╨╡╨╜╨╕╤О ╨▓ col 4 тАФ ╤Б╤В╨░╨╜╨┤╨░╤А╤В SAP/Oracle. (2) Balance sign: ╤Г╨▒╤А╨░╨╜ ┬л+┬╗ ╨┐╤А╨╡╤Д╨╕╨║╤Б ╤Г ╨┐╨╛╨╗╨╛╨╢╨╕╤В╨╡╨╗╤М╨╜╤Л╤Е ╨▒╨░╨╗╨░╨╜╤Б╨╛╨▓ (╤Б╤В╨░╨╜╨┤╨░╤А╤В ╨▒╨░╨╜╨║╨╛╨▓╤Б╨║╨╛╨╣ ╨▓╤Л╨┐╨╕╤Б╨║╨╕). (3) Movement column: ╤Г╨▒╤А╨░╨╜╨╛ ╨┤╤Г╨▒╨╗╨╕╤А╨╛╨▓╨░╨╜╨╕╨╡ ╨║╨╛╨┤╨░ ╨▓╨░╨╗╤О╤В╤Л тАФ ╨▓╨░╨╗╤О╤В╨░ ╨╛╨▒╤К╤П╨▓╨╗╤П╨╡╤В╤Б╤П ╨▓ ╨╛╤В╨┤╨╡╨╗╤М╨╜╨╛╨╣ ╨║╨╛╨╗╨╛╨╜╨║╨╡, ╨╜╨╡ ╨┐╨╛╨▓╤В╨╛╤А╤П╨╡╤В╤Б╤П ╨▓ ╨┤╨▓╨╕╨╢╨╡╨╜╨╕╨╕. |
| 2026-05-18 14:30 | **fix(excel): ╨б╨Т╨Ю╨Ф╨Ъ╨Р ╨Я╨Ю ╨Т╨Р╨Ы╨о╨в╨Р╨Ь тАФ clean column headers + footnote border (de84a69). DEPLOYED.** (1) ╨г╨▒╤А╨░╨╜ merged sub-header ┬л╨Ф╨╛╤Е╨╛╨┤╤Л / ╨а╨░╤Б╤Е╨╛╨┤╤Л / ╨Ш╤В╨╛╨│┬╗ ╨╕╨╖ ╨▒╨╗╨╛╨║╨░ ╨б╨Т╨Ю╨Ф╨Ъ╨Р ╨Я╨Ю ╨Т╨Р╨Ы╨о╨в╨Р╨Ь; ╨╖╨░╨╝╨╡╨╜╤С╨╜ ╨╜╨░ 5 ╨╛╤В╨┤╨╡╨╗╤М╨╜╤Л╤Е column headers (╨Т╨░╨╗╤О╤В╨░, ╨Ю╨┐╨╡╤А╨░╤Ж╨╕╨╣, ╨Ф╨╛╤Е╨╛╨┤╤Л, ╨а╨░╤Б╤Е╨╛╨┤╤Л, ╨Ш╤В╨╛╨│*) тАФ ╨▓╨╕╨╖╤Г╨░╨╗╤М╨╜╨░╤П ╨║╨╛╨╜╤Б╨╕╤Б╤В╨╡╨╜╤В╨╜╨╛╤Б╤В╤М ╤Б╨╛ ╨▓╤Б╨╡╨╝╨╕ ╨┤╤А╤Г╨│╨╕╨╝╨╕ ╤В╨░╨▒╨╗╨╕╤Ж╨░╨╝╨╕. (2) Footnote: ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜ top border ╨┤╨╗╤П ╤З╤С╤В╨║╨╛╨│╨╛ ╨▓╨╕╨╖╤Г╨░╨╗╤М╨╜╨╛╨│╨╛ ╤А╨░╨╖╨┤╨╡╨╗╨╡╨╜╨╕╤П ╨╝╨╡╨╢╨┤╤Г grand total ╨┤╨░╨╜╨╜╤Л╨╝╨╕ ╨╕ ╤Б╨╜╨╛╤Б╨║╨╛╨╣. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. |
| 2026-05-18 17:30 | **arch: Cash Flow 3-level FinTech model ╤Г╤В╨▓╨╡╤А╨╢╨┤╤С╨╜ ╨░╤А╤Е╨╕╤В╨╡╨║╤В╤Г╤А╨╜╨╛. ╨а╨╡╨░╨╗╨╕╨╖╨░╤Ж╨╕╤П ╨╛╤В╨╗╨╛╨╢╨╡╨╜╨░ (revert 37a8d80).** ╨Ь╨╡╤В╨╛╨┤╨╛╨╗╨╛╨│╨╕╤П: (I) ╨Ю╨┐╨╡╤А╨░╤Ж╨╕╨╛╨╜╨╜╤Л╨╣ ╨┐╨╛╤В╨╛╨║ тАФ ╤В╨╛╨╗╤М╨║╨╛ income/expense тЖТ ╨Ю╨┐╨╡╤А. ╨╜╨╡╤В╤В╨╛; (II) ╨Ф╨▓╨╕╨╢╨╡╨╜╨╕╨╡ ╨║╨░╨┐╨╕╤В╨░╨╗╨░ тАФ ╨┐╨╡╤А╨╡╨▓╨╛╨┤╤Л ╨╕ ╨┤╨╛╨╗╨│╨╕ ╨Ю╨в╨Ф╨Х╨Ы╨м╨Э╨Ю, styled italic + tinted steel #E8EEF4 (╨╜╨╡ ╤Б╨╝╨╡╤И╨╕╨▓╨░╤О╤В╤Б╤П ╤Б ╨╛╨┐╨╡╤А╨░╤Ж╨╕╤П╨╝╨╕); (III) ╨Ш╤В╨╛╨│╨╛ ╨┐╨╛╨╖╨╕╤Ж╨╕╨╕ = income тИТ expense + debt_received тИТ debt_given тИТ transfer тЙб ╨Ш╨в╨Ю╨У ╨Ч╨Р ╨Я╨Х╨а╨Ш╨Ю╨Ф (╤А╨░╤Б╤Е╨╛╨╢╨┤╨╡╨╜╨╕╨╣ ╨╜╨╡╤В). ╨в╨Ю╨Я ╤А╨░╤Б╤Е╨╛╨┤╨╛╨▓: ╤В╨╛╨╗╤М╨║╨╛ expense (debt_given = ╨░╨║╤В╨╕╨▓, ╨╜╨╡ ╤В╤А╨░╤В╨░), ╨║╨╛╨╜╨▓╨╡╤А╤В╨░╤Ж╨╕╤П ╨▓ USD ╤З╨╡╤А╨╡╨╖ live rates, ╨╡╨┤╨╕╨╜╤Л╨╣ USD-╤А╨╡╨╣╤В╨╕╨╜╨│, stripEmoji() ╨╛╤З╨╕╤Й╨░╨╡╤В ╨╜╨░╨╖╨▓╨░╨╜╨╕╤П ╨║╨░╤В╨╡╨│╨╛╤А╨╕╨╣. ╨Ъ╨╛╨╝╨╝╨╕╤В 47e6d4e ╤А╨╡╨░╨╗╨╕╨╖╨╛╨▓╨░╨╗ ╨╝╨╛╨┤╨╡╨╗╤М, ╨╜╨╛ ╨▒╤Л╨╗ reverted ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╨╡╨╝ (37a8d80). ╨Р╤А╤Е╨╕╤В╨╡╨║╤В╤Г╤А╨░ ╨╖╨░╨┤╨╛╨║╤Г╨╝╨╡╨╜╤В╨╕╤А╨╛╨▓╨░╨╜╨░, ╨╛╨╢╨╕╨┤╨░╨╡╤В ╨┐╨╛╨▓╤В╨╛╤А╨╜╨╛╨╣ ╤А╨╡╨░╨╗╨╕╨╖╨░╤Ж╨╕╨╕. |
| 2026-05-18 18:00 | **fix(excel): Sheet1 ╨в╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕ тАФ ╤Г╨┤╨░╨╗╨╡╨╜╨╕╨╡ ╨╕╨╖╨▒╤Л╤В╨╛╤З╨╜╤Л╤Е ╨║╨╛╨╗╨╛╨╜╨╛╨║ + ╤З╨╕╤Б╨╗╨╛╨▓╤Л╨╡ ╤Б╤Г╤Д╤Д╨╕╨║╤Б╤Л ╨▓╨░╨╗╤О╤В (bb3904c). DEPLOYED.** excel-export.service.ts: ╤Г╨┤╨░╨╗╨╡╨╜╤Л ╨║╨╛╨╗╨╛╨╜╨║╨╕ ┬л╨в╨╕╨┐ ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕┬╗ ╨╕ ┬л╨Ъ╨░╤В╨╡╨│╨╛╤А╨╕╤П ╨│╤А╤Г╨┐╨┐╨░┬╗ ╨╕╨╖ ╨╗╨╕╤Б╤В╨░ ╨в╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕ тАФ ╨╛╤Б╤В╨░╨▓╨╗╨╡╨╜╤Л ╤В╨╛╨╗╤М╨║╨╛ ╨╖╨╜╨░╤З╨╕╨╝╤Л╨╡ ╨┤╨╗╤П ╨╢╤Г╤А╨╜╨░╨╗╤М╨╜╨╛╨│╨╛ ╤Б╤В╨╕╨╗╤П. ╨з╨╕╤Б╨╗╨╛╨▓╤Л╨╡ ╤Б╤Г╤Д╤Д╨╕╨║╤Б╤Л ╨▓╨░╨╗╤О╤В: ╤Б╤Г╨╝╨╝╤Л ╨╛╤В╨╛╨▒╤А╨░╨╢╨░╤О╤В╤Б╤П ╨▓ ╤Д╨╛╤А╨╝╨░╤В╨╡ ┬л15 400 USDT┬╗ ╨▒╨╡╨╖ ╤Б╨╕╨╝╨▓╨╛╨╗╨╛╨▓ тВ┤/$/тВм ╨▓ ╨╛╤В╨┤╨╡╨╗╤М╨╜╨╛╨╣ ╨║╨╛╨╗╨╛╨╜╨║╨╡ тАФ ╨┐╨╗╨╛╤В╨╜╤Л╨╣ ╤З╨╕╤В╨░╨╡╨╝╤Л╨╣ ╤Д╨╛╤А╨╝╨░╤В. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. Railway auto-deploy. |
| 2026-05-18 18:15 | **fix(excel): TS2532 тАФ Object possibly undefined (b5e71cd). DEPLOYED.** excel-export.service.ts: ╨╕╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜╨░ TypeScript-╨╛╤И╨╕╨▒╨║╨░ TS2532 ╨┐╤А╨╕ ╨╛╨▒╤А╨░╤Й╨╡╨╜╨╕╨╕ ╨║ ╨╛╨▒╤К╨╡╨║╤В╨░╨╝, ╨║╨╛╤В╨╛╤А╤Л╨╡ ╨╝╨╛╨│╤Г╤В ╨▒╤Л╤В╤М undefined. ╨Ф╨╛╨▒╨░╨▓╨╗╨╡╨╜╤Л ╨╛╨┐╤Ж╨╕╨╛╨╜╨░╨╗╤М╨╜╤Л╨╡ ╤Ж╨╡╨┐╨╛╤З╨║╨╕ ╨╕ ╨┤╨╡╤Д╨╛╨╗╤В╨╜╤Л╨╡ ╨╖╨╜╨░╤З╨╡╨╜╨╕╤П. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. Railway auto-deploy. |
| 2026-05-18 18:30 | **fix(excel): Column E always visible + % centered (76c3def). DEPLOYED.** excel-export.service.ts: ╨║╨╛╨╗╨╛╨╜╨║╨░ E (╨┤╨╛╨╗╤П %) ╨▓ ╨▒╨╗╨╛╨║╨╡ ╨в╨Ю╨Я ╨а╨Р╨б╨е╨Ю╨Ф╨Ю╨Т ╤В╨╡╨┐╨╡╤А╤М ╨▓╤Б╨╡╨│╨┤╨░ ╨╛╤В╨╛╨▒╤А╨░╨╢╨░╨╡╤В╤Б╤П ╨┤╨░╨╢╨╡ ╨┐╤А╨╕ ╨╜╤Г╨╗╨╡╨▓╤Л╤Е ╨┤╨░╨╜╨╜╤Л╤Е; ╨▓╤Л╤А╨░╨▓╨╜╨╕╨▓╨░╨╜╨╕╨╡ ╤Ж╨╡╨╜╤В╤А╨╕╤А╨╛╨▓╨░╨╜╨╜╨╛╨╡ ╨┤╨╗╤П ╤З╨╕╤Б╨╗╨╛╨▓╤Л╤Е ╨╖╨╜╨░╤З╨╡╨╜╨╕╨╣ % (╨┐╤А╨╛╤Д╨╡╤Б╤Б╨╕╨╛╨╜╨░╨╗╤М╨╜╤Л╨╣ ╤Д╨╕╨╜╤В╨╡╤Е-╤Б╤В╨░╨╜╨┤╨░╤А╤В). tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. Railway auto-deploy. |
| 2026-05-18 18:45 | **fix(excel): 5 visual fixes тАФ signs, grey fill, headers, center alignment, ╨Ш╨в╨Ю╨У╨Ю removal (ac7489a). DEPLOYED.** excel-export.service.ts: (1) ╨Ш╤Б╨┐╤А╨░╨▓╨╗╨╡╨╜╤Л ╨╖╨╜╨░╨║╨╕ ╨▓ ╨║╨╛╨╗╨╛╨╜╨║╨╡ ╨Т╤Л╨┐╨╗╨░╤З╨╡╨╜╨╛/╨Я╨╛╨╗╤Г╤З╨╡╨╜╨╛ тАФ outflow ╨▓╤Б╨╡╨│╨┤╨░ ╨╛╤В╨╛╨▒╤А╨░╨╢╨░╨╡╤В╤Б╤П ╤Б╨╛ ╨╖╨╜╨░╨║╨╛╨╝ ┬лтИТ┬╗ (╤Б╤В╨░╨╜╨┤╨░╤А╤В ╨▒╨░╨╜╨║╨╛╨▓╤Б╨║╨╛╨╣ ╨▓╤Л╨┐╨╕╤Б╨║╨╕); (2) Grey fill (#F5F5F5) ╨┤╨╗╤П ╤З╤С╤В╨╜╤Л╤Е ╤Б╤В╤А╨╛╨║ ╨▓ ╤Б╨╡╨║╤Ж╨╕╨╕ ╨б╨Т╨Ю╨Ф╨Ъ╨Р ╨Я╨Ю ╨Т╨Р╨Ы╨о╨в╨Р╨Ь; (3) ╨Ч╨░╨│╨╛╨╗╨╛╨▓╨║╨╕ ╨║╨╛╨╗╨╛╨╜╨╛╨║: ╤Г╨╜╨╕╤Д╨╕╤Ж╨╕╤А╨╛╨▓╨░╨╜╤Л ╨┐╨╛ ╨▓╤Б╨╡╨╝ ╨▒╨╗╨╛╨║╨░╨╝ Sheet0; (4) ╨ж╨╡╨╜╤В╤А╨╕╤А╨╛╨▓╨░╨╜╨╕╨╡ ╤З╨╕╤Б╨╗╨╛╨▓╤Л╤Е ╤П╤З╨╡╨╡╨║ ╨▓ ╨▒╨░╨╗╨░╨╜╤Б╨╛╨▓╤Л╤Е ╤Б╤В╤А╨╛╨║╨░╤Е; (5) ╨С╨╗╨╛╨║ ┬л╨Ш╨в╨Ю╨У╨Ю┬╗ ╤Г╨┤╨░╨╗╤С╨╜ ╨╕╨╖ Sheet1 ╨в╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕ тАФ ╨┐╨╡╤А╨╡╤Е╨╛╨┤ ╨║ ╤З╨╕╤Б╤В╨╛╨╝╤Г ╨╢╤Г╤А╨╜╨░╨╗╤М╨╜╨╛╨╝╤Г ╤Д╨╛╤А╨╝╨░╤В╤Г ╨▒╨╡╨╖ ╤Б╤Г╨╝╨╝╨░╤А╨╜╤Л╤Е ╤Б╤В╤А╨╛╨║ ╨▓ ╤В╨╡╨╗╨╡ ╨╗╨╕╤Б╤В╨░. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. Railway auto-deploy. |
| 2026-05-18 19:30 | **fix(excel): Sheet1 Audit-grade polish тАФ exchange rate col L + rate center + ╨б╤Г╨╝╨╝╤Л C-E + balance center (2f4b88c). DEPLOYED.** excel-export.service.ts: (1) ╨Ъ╨╛╨╗╨╛╨╜╨║╨░ L (╨Ъ╤Г╤А╤Б): ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В ╨╛╨┐╨╕╤Б╨░╤В╨╡╨╗╤М╨╜╤Г╤О ╨║╨╛╨╜╨▓╨╡╤А╤В╨░╤Ж╨╕╤О ╤В╨╛╨╗╤М╨║╨╛ ╨┐╤А╨╕ ╨║╤А╨╛╤Б╤Б-╨▓╨░╨╗╤О╤В╨╜╤Л╤Е ╨╛╨┐╨╡╤А╨░╤Ж╨╕╤П╤Е (╨║╨╛╨│╨┤╨░ currency тЙа base_currency) тАФ ╤Д╨╛╤А╨╝╨░╤В ┬л1 USD = 38.5 UAH┬╗; ╨┐╤А╨╕ ╨╛╨┤╨╜╨╛╨▓╨░╨╗╤О╤В╨╜╤Л╤Е ╨╛╨┐╨╡╤А╨░╤Ж╨╕╤П╤Е ╤П╤З╨╡╨╣╨║╨░ ╨┐╤Г╤Б╤В╨░ (╨╜╨╡ ┬л1┬╗); (2) ╨Ъ╤Г╤А╤Б ╨▓╤Л╤А╨░╨▓╨╜╨╡╨╜ ╨┐╨╛ ╤Ж╨╡╨╜╤В╤А╤Г; (3) ╨Ъ╨╛╨╗╨╛╨╜╨║╨╕ CтАУE (╨Я╤А╨╕╤Е╨╛╨┤ / ╨а╨░╤Б╤Е╨╛╨┤ / ╨б╨░╨╗╤М╨┤╨╛) тАФ ╤Г╨╜╨╕╤Д╨╕╤Ж╨╕╤А╨╛╨▓╨░╨╜╨╜╤Л╨╣ smartNumFmt ╤Б NBSP-╤А╨░╨╖╨┤╨╡╨╗╨╕╤В╨╡╨╗╨╡╨╝ ╤В╤Л╤Б╤П╤З, ╨▒╨╡╨╖ trailing zeros; (4) ╨Ъ╨╛╨╗╨╛╨╜╨║╨░ ┬л╨Ю╤Б╤В╨░╤В╨╛╨║┬╗ (running balance) тАФ ╤Ж╨╡╨╜╤В╤А╨╕╤А╨╛╨▓╨░╨╜╨░ ╨┐╨╛ ╨│╨╛╤А╨╕╨╖╨╛╨╜╤В╨░╨╗╨╕ ╨┤╨╗╤П ╤Г╨┤╨╛╨▒╤Б╤В╨▓╨░ ╤З╤В╨╡╨╜╨╕╤П. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. Commit 2f4b88c (HEAD). Railway auto-deploy. |


---

## 11. AGENT OPERATING PROTOCOL тАФ ╨Ю╨С╨п╨Ч╨Р╨в╨Х╨Ы╨м╨Э╨л╨Щ ╨Я╨а╨Ю╨ж╨Х╨б╨б ╨а╨Р╨С╨Ю╨в╨л

1. Startup Protocol

Every new agent session must start by reading:
- project_config.md
- workflow_state.md
- docs/product-roadmap.md (╤Г╤В╨▓╨╡╤А╨╢╨┤╤С╨╜╨╜╤Л╨╣ ╨┐╨╗╨░╨╜ ╤А╨░╨╖╨▓╨╕╤В╨╕╤П ╨┐╤А╨╛╨┤╤Г╨║╤В╨░ тАФ Phase 1.23тАУ2.5)
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
тАЬImplement the whole phase.тАЭ

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
- Filesystem / Local FS MCP тАФ required when reading or editing project files.
- Postgres MCP тАФ required only for database/schema/RLS/migration work.
- GitHub MCP тАФ required only if working with a remote GitHub repository, branches, pull requests, or issues.
- Context7 MCP тАФ useful only when current external library documentation is needed.
- Browser / DevTools MCP тАФ useful only during frontend/UI testing phases.
- Notion MCP тАФ forbidden until Phase 3.
- Google Sheets integration тАФ forbidden until Phase 3.
- Crypto / Blockchain tools тАФ forbidden until Phase 2.

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
- `docs/product-roadmap.md` < **╨╕╤Б╤В╨╛╤З╨╜╨╕╨║ ╨┐╤А╨░╨▓╨┤╤Л** ╨┤╨╗╤П ╤Б╨╗╨╡╨┤╤Г╤О╤Й╨╕╤Е ╤Д╨░╨╖ (1.23тАУ2.5)
- `docs/balance-semantics.md` (╨┤╨╗╤П ╤Д╨░╨╖, ╤Б╨▓╤П╨╖╨░╨╜╨╜╤Л╤Е ╤Б ╨▒╨░╨╗╨░╨╜╤Б╨╛╨╝)
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

**╨в╤А╨╕╨│╨│╨╡╤А╤Л** тАФ ╨╖╨░╨┐╤Г╤Б╨║╨░╤В╤М ╨░╤Г╨┤╨╕╤В ╤В╨╛╨╗╤М╨║╨╛ ╨┐╤А╨╕:
- ╨╖╨░╨▓╨╡╤А╤И╨╡╨╜╨╕╨╕ ╤Д╨░╨╖╤Л ╨╕╨╗╨╕ ╨║╤А╤Г╨┐╨╜╨╛╨╣ ╨┐╨╛╨┤╤Д╨░╨╖╤Л
- ╨┐╤А╨╛╤Е╨╛╨╢╨┤╨╡╨╜╨╕╨╕ review gate (Traceability / Security / Scope Guard)
- ╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨╕╨╕ MCP ╨║╨╛╨╜╤Д╨╕╨│╤Г╤А╨░╤Ж╨╕╨╕
- git checkpoint
- context reset / handoff ╨▓ ╨╜╨╛╨▓╤Л╨╣ ╤З╨░╤В
- ╨┐╨╡╤А╨╡╨┤ ╨╜╨░╤З╨░╨╗╨╛╨╝ high-risk ╤Д╨░╨╖╤Л (DB, security, payments, auth, deploy)

**╨Э╨╡ ╨╖╨░╨┐╤Г╤Б╨║╨░╤В╤М** ╨┐╨╛╤Б╨╗╨╡ ╨║╨░╨╢╨┤╨╛╨│╨╛ ╨╝╨╡╨╗╨║╨╛╨│╨╛ ╤В╨░╤Б╨║╨░.

**╨д╨╛╤А╨╝╨░╤В ╨▓╤Л╨▓╨╛╨┤╨░** тАФ ╨║╨╛╨╝╨┐╨░╨║╤В╨╜╨░╤П ╤В╨░╨▒╨╗╨╕╤Ж╨░, max 10 ╤Б╤В╤А╨╛╨║:

| ╨Я╤А╨╛╨▓╨╡╤А╨║╨░ | ╨б╤В╨░╤В╤Г╤Б |
|---|---|
| ╨Ф╨░╤В╨░ ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╨╕╤П ╨░╨║╤В╤Г╨░╨╗╤М╨╜╨░ | ? / ? |
| Section 1 (╤Б╨╛╤Б╤В╨╛╤П╨╜╨╕╨╡) ╨║╨╛╤А╤А╨╡╨║╤В╨╜╨╛ | ? / ? |
| Section 10 (╨╕╤Б╤В╨╛╤А╨╕╤П) ╨░╨║╤В╤Г╨░╨╗╤М╨╜╨░ | ? / ? |
| Section 8 (╤Д╨░╨╣╨╗╤Л) ╨║╨╗╨░╤Б╤Б╨╕╤Д╨╕╤Ж╨╕╤А╨╛╨▓╨░╨╜╤Л | ? / ? |
| Section 7 (MCP) ╨┐╨╛╨╗╨╜╨░╤П | ? / ? |
| Section 6 (scope) ╤Б╨╛╨╛╤В╨▓╨╡╤В╤Б╤В╨▓╤Г╨╡╤В ╤Д╨░╨╖╨╡ | ? / ? |
| Section 9 (handoff prompt) ╨░╨║╤В╤Г╨░╨╗╨╡╨╜ | ? / ? |
| project_config.md ╨╜╨╡ ╨╕╨╖╨╝╨╡╨╜╤С╨╜ | ? / ? |
| Git working tree clean | ? / ? |
| ╨Э╨╡╤В scope creep | ? / ? |

╨Я╤А╨╕ ╨╛╨▒╨╜╨░╤А╤Г╨╢╨╡╨╜╨╕╨╕ `?` тАФ ╨╕╤Б╨┐╤А╨░╨▓╨╕╤В╤М ╨╜╨╡╨╝╨╡╨┤╨╗╨╡╨╜╨╜╨╛ ╨╕╨╗╨╕ ╤Г╨▓╨╡╨┤╨╛╨╝╨╕╤В╤М ╨▓╨╗╨░╨┤╨╡╨╗╤М╤Ж╨░.

---

## 15. ╨Я╨Ю╨Ы╨Э╨л╨Щ ╨д╨Ы╨Ю╨г ╨Я╨а╨Ю╨Ф╨г╨Ъ╨в╨Р (╤В╨╡╨║╤Г╤Й╨╡╨╡ ╤Б╨╛╤Б╤В╨╛╤П╨╜╨╕╨╡)

> ╨н╤В╨╛╤В ╤А╨░╨╖╨┤╨╡╨╗ ╨╛╨┐╨╕╤Б╤Л╨▓╨░╨╡╤В ╨┐╨╛╨╗╨╜╤Л╨╣ ╨┐╤Г╤В╤М ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤П тАФ ╨╛╤В ╨┐╨╡╤А╨▓╨╛╨│╨╛ ╨╖╨░╨┐╤Г╤Б╨║╨░ ╨▒╨╛╤В╨░ ╨┤╨╛ ╨╝╨╛╨╝╨╡╨╜╤В╨░ ╤Б╨╛╨╖╨┤╨░╨╜╨╕╤П ╨┐╨╡╤А╨▓╨╛╨╣ ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕. ╨Ю╨▒╨╜╨╛╨▓╨╗╤С╨╜: 2026-05-11 19:52 (UTC+3).

---

### ?? ╨н╤В╨░╨┐ 0 тАФ ╨Я╨╡╤А╨▓╤Л╨╣ ╨╖╨░╨┐╤Г╤Б╨║ `/start`

1. ╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨┐╨╕╤И╨╡╤В `/start` ╨▓ ╤З╨░╤В ╨▒╨╛╤В╨░.
2. `webhook.route.ts` > `resolveWorkspace()` > ╨▓╤Л╨╖╤Л╨▓╨░╨╡╤В `system_find_or_create_user()` (SECURITY DEFINER, atomic, pg_advisory_xact_lock).
3. ╨б╨╛╨╖╨┤╨░╤С╤В╤Б╤П: **workspace** (default_currency=USDT, timezone=UTC), **workspace_membership**, **default account_source** (┬л╨Я╨╛ ╤Г╨╝╨╛╨╗╤З╨░╨╜╨╕╤О┬╗, USDT), **default category** (╨Ф╤А╤Г╨│╨╛╨╡).
4. ╨С╨╛╤В ╨╛╤В╨┐╤А╨░╨▓╨╗╤П╨╡╤В ╨┐╤А╨╕╨▓╨╡╤В╤Б╤В╨▓╨╡╨╜╨╜╨╛╨╡ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ ╤Б ReplyKeyboard (`is_persistent: false`, `resize_keyboard: true`):
   ```
   ╨б╤В╤А╨╛╨║╨░ 1: [?? ╨С╨░╨╗╨░╨╜╤Б]  [?? ╨Ю╤В╤З╤С╤В]
   ╨б╤В╤А╨╛╨║╨░ 2: [?? ╨в╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕]  [?? ╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕]
   ```
5. ╨Х╤Б╨╗╨╕ ╤Г ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤П **0 ╤Б╤З╨╡╤В╨╛╨▓** > ╨▒╨╛╤В ╤В╨░╨║╨╢╨╡ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В guided onboarding keyboard (`buildStartOnboardKeyboard`).
6. Greeting-╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ **╨╜╨╕╨║╨╛╨│╨┤╨░ ╨╜╨╡ ╤Г╨┤╨░╨╗╤П╨╡╤В╤Б╤П** тАФ ╨╛╨╜╨╛ ╨╜╨╛╤Б╨╕╤В╨╡╨╗╤М ReplyKeyboard.

---

### ?? ╨н╤В╨░╨┐ 1 тАФ ╨б╨╛╨╖╨┤╨░╨╜╨╕╨╡ ╨Я╨Х╨а╨Т╨Ю╨У╨Ю ╤Б╤З╤С╤В╨░ (╨╛╨╜╨▒╨╛╤А╨┤╨╕╨╜╨│)

#### 1.1 ╨Т╤Л╨▒╨╛╤А ╤В╨╕╨┐╨░ ╤Б╤З╤С╤В╨░

╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨▓╨╕╨┤╨╕╤В inline-╨║╨╗╨░╨▓╨╕╨░╤В╤Г╤А╤Г:
```
[?? ╨С╨░╨╜╨║╨╛╨▓╤Б╨║╨░╤П ╨║╨░╤А╤В╨░]  [?? ╨Э╨░╨╗╨╕╤З╨╜╤Л╨╡]
[?? ╨Ъ╤А╨╕╨┐╤В╨╛-╨▒╨╕╤А╨╢╨░]      [?? ╨Ъ╤А╨╕╨┐╤В╨╛-╨║╨╛╤И╨╡╨╗╤С╨║]
[?? ╨б╨▓╨╛╤С ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╡]
[?? ╨Э╨░╤З╨░╤В╤М ╨▒╨╡╨╖ ╤Б╤З╤С╤В╨░]
```

**`[?? ╨Э╨░╤З╨░╤В╤М ╨▒╨╡╨╖ ╤Б╤З╤С╤В╨░]` (ac:skip):**
- ╨Х╤Б╨╗╨╕ ╤Г ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤П **0 ╤Б╤З╨╡╤В╨╛╨▓** > ╤В╨╕╤Е╨╛ ╤Б╨╛╨╖╨┤╨░╤С╤В╤Б╤П ╤Б╤З╤С╤В ┬л╨Ъ╨╛╤И╨╡╨╗╤С╨║┬╗ (USD) тАФ non-fatal try/catch.
- Redis-╨║╨╗╤О╤З `midas:ac:` ╤Г╨┤╨░╨╗╤П╨╡╤В╤Б╤П.
- ╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨┐╨╛╨╗╤Г╤З╨░╨╡╤В ReplyKeyboard ╨╕ ╨╝╨╛╨╢╨╡╤В ╤Б╤А╨░╨╖╤Г ╨▓╨▓╨╛╨┤╨╕╤В╤М ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕.

#### 1.2 ╨б╤Ж╨╡╨╜╨░╤А╨╕╨╣ ┬л╨С╨░╨╜╨║╨╛╨▓╤Б╨║╨░╤П ╨║╨░╤А╤В╨░┬╗ (ac:type:card)

1. FSM ╨┐╨╡╤А╨╡╤Е╨╛╨┤╨╕╤В ╨▓ ╤И╨░╨│ `name_input`.
2. ╨С╨╛╤В ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В ╨┐╤А╨╛╨╝╨┐╤В ╨▓╨▓╨╛╨┤╨░ ╨╜╨░╨╖╨▓╨░╨╜╨╕╤П ╤Б blockquote-╨┐╤А╨╕╨╝╨╡╤А╨░╨╝╨╕:
   ```
   ╨Т╨▓╨╡╨┤╨╕╤В╨╡ ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╡ ╨▒╨░╨╜╨║╨░:
   <blockquote>╨Э╨░╨┐╤А╨╕╨╝╨╡╤А: ╨в╨╕╨╜╤М╨║╨╛╤Д╤Д ┬╖ ╨б╨▒╨╡╤А╨▒╨░╨╜╨║ ┬╖ ╨Р╨╗╤М╤Д╨░ ┬╖ Monobank</blockquote>
   ```
3. ╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨▓╨▓╨╛╨┤╨╕╤В ╤В╨╡╨║╤Б╤В > `name_input` text interceptor.

**╨б╨╗╤Г╤З╨░╨╣ A тАФ fuzzy match ╨╜╨░╨╣╨┤╨╡╨╜** (╨╜╨░╨┐╤А╨╕╨╝╨╡╤А ┬л╤В╨╕╨╜╤М╨║╨╛╤Д╤Д┬╗ > ┬л╨в╨╕╨╜╤М╨║╨╛╤Д╤Д┬╗):
- ╨С╨╛╤В ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В ╤Н╨║╤А╨░╨╜ ╨┐╨╛╨┤╤В╨▓╨╡╤А╨╢╨┤╨╡╨╜╨╕╤П ╤Б blockquote ┬л╨в╨╕╨╜╤М╨║╨╛╤Д╤Д┬╗.
- ╨Ъ╨╜╨╛╨┐╨║╨╕: `[? ╨Ф╨░, ╨в╨╕╨╜╤М╨║╨╛╤Д╤Д]` / `[?? ╨Э╨╡╤В, ╨╕╨╖╨╝╨╡╨╜╨╕╤В╤М]`.
- ╨Х╤Б╨╗╨╕ ╨┐╨╛╨┤╤В╨▓╨╡╤А╨╢╨┤╨╡╨╜╨╛ > FSM ╨┐╨╡╤А╨╡╤Е╨╛╨┤╨╕╤В ╨▓ `cur_pick`.

**╨б╨╗╤Г╤З╨░╨╣ B тАФ fuzzy null** (╨╜╨░╨┐╤А╨╕╨╝╨╡╤А ┬л╨Р╨▒╨▓┬╗):
- ╨С╨╛╤В ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В no-match ╤Н╨║╤А╨░╨╜:
  ```
  ?? ╨Я╨╛╤Е╨╛╨╢╨╡╨│╨╛ ╨▒╨░╨╜╨║╨░ ╨╜╨╡ ╨╜╨░╤И╨╗╨╕.
  <blockquote>┬л╨Р╨▒╨▓┬╗</blockquote>
  ╨е╨╛╤В╨╕╤В╨╡ ╤Б╨╛╨╖╨┤╨░╤В╤М ╤Б╤З╤С╤В ╤Б ╤В╨░╨║╨╕╨╝ ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╡╨╝?
  ```
- ╨Ъ╨╜╨╛╨┐╨║╨╕:
  - `[? ╨б╨╛╨╖╨┤╨░╤В╤М ┬л╨Р╨▒╨▓┬╗]` (ac:cus:save) > ╤Б╨╛╤Е╤А╨░╨╜╤П╨╡╤В ╨║╨░╨║ `pendingName`, `isCustomName=true`, ╨┐╨╡╤А╨╡╤Е╨╛╨┤╨╕╤В ╨▓ `cur_pick`.
  - `[?? ╨Ш╨╖╨╝╨╡╨╜╨╕╤В╤М ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╡]` (ac:cus:keep) > ╨▓╨╛╨╖╨▓╤А╨░╤В ╨▓ `name_input`.
  - `[?? ╨Ъ ╤В╨╕╨┐╤Г ╤Б╤З╤С╤В╨░]` (ac:type:back) > ╨▓╨╛╨╖╨▓╤А╨░╤В ╨╜╨░ ╤Б╤В╨░╤А╤В╨╛╨▓╤Л╨╣ ╤Н╨║╤А╨░╨╜.

#### 1.3 ╨б╤Ж╨╡╨╜╨░╤А╨╕╨╣ ┬л╨Э╨░╨╗╨╕╤З╨╜╤Л╨╡┬╗ (ac:type:cash)

- ╨Э╨░╨╖╨▓╨░╨╜╨╕╨╡ ╤Д╨╛╤А╨╝╨╕╤А╤Г╨╡╤В╤Б╤П ╨░╨▓╤В╨╛╨╝╨░╤В╨╕╤З╨╡╤Б╨║╨╕: ┬л╨Э╨░╨╗╨╕╤З╨╜╤Л╨╡ {CURRENCY}┬╗ (╨╕╨╝╤П ╤Б╤З╤С╤В╨░ ╤Б╨╛╨╖╨┤╨░╤С╤В╤Б╤П ╨┐╨╛╤Б╨╗╨╡ ╨▓╤Л╨▒╨╛╤А╨░ ╨▓╨░╨╗╤О╤В╤Л).
- ╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╤Б╤А╨░╨╖╤Г ╨▓╨╕╨┤╨╕╤В currency picker (╤И╨░╨│ `cur_pick`).
- **╨Э╨╡╤В ╤Н╨║╤А╨░╨╜╨░ ╨▓╨▓╨╛╨┤╨░ ╨╜╨░╨╖╨▓╨░╨╜╨╕╤П.**

#### 1.4 ╨б╤Ж╨╡╨╜╨░╤А╨╕╨╣ ┬л╨Ъ╤А╨╕╨┐╤В╨╛-╨▒╨╕╤А╨╢╨░┬╗ / ┬л╨Ъ╤А╨╕╨┐╤В╨╛-╨║╨╛╤И╨╡╨╗╤С╨║┬╗

- **╨Ъ╤А╨╕╨┐╤В╨╛-╨▒╨╕╤А╨╢╨░ (ac:type:exchange):** ╨Я╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В paginated picker ╨▒╨╕╤А╨╢ (5 ╨┐╤А╨╡╤Б╨╡╤В╨╛╨▓: Binance/Bybit/OKX/Kraken/Huobi + ?? ╨б╨▓╨╛╤П).
- **╨Ъ╤А╨╕╨┐╤В╨╛-╨║╨╛╤И╨╡╨╗╤С╨║ (ac:type:wallet):** ╨Я╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В sub-picker: crypto / e-wallet / TON / Lightning.
  - Lightning > ╤Д╨╕╨║╤Б╨╕╤А╨╛╨▓╨░╨╜╨╜╨░╤П ╨▓╨░╨╗╤О╤В╨░ BTC, ╨╝╨╕╨╜╤Г╨╡╤В currency picker.
  - ╨Ю╤Б╤В╨░╨╗╤М╨╜╤Л╨╡ > ╨╕╨┤╤Г╤В ╨▓ crypto currency picker.
- Paginated pickers ╨▒╨░╨╜╨║╨╛╨▓/╨▒╨╕╤А╨╢ тАФ ╨╜╨░╨▓╨╕╨│╨░╤Ж╨╕╤П `[??][N / Total][??]`, ╨▓╤Б╨╡╨│╨┤╨░ ╨╛╨▒╨╡ ╤Б╤В╤А╨╡╨╗╨║╨╕ (noop ╨╜╨░ ╨║╤А╨░╤П╤Е).

---

### ?? ╨н╤В╨░╨┐ 2 тАФ ╨Т╤Л╨▒╨╛╤А ╨▓╨░╨╗╤О╤В╤Л (╤И╨░╨│ `cur_pick`)

╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨▓╨╕╨┤╨╕╤В:
```
╨Т ╨║╨░╨║╨╛╨╣ ╨▓╨░╨╗╤О╤В╨╡ ╨╛╤В╨║╤А╤Л╤В╤М ╤Б╤З╤С╤В ┬л╨в╨╕╨╜╤М╨║╨╛╤Д╤Д┬╗?

[???? RUB]  [???? USD]  [???? EUR]
[???? GBP]  [???? TRY]  [? BTC]
[??] [1 / 2] [??]
[?? ╨Э╨░╨╣╤В╨╕ ╨▓╨░╨╗╤О╤В╤Г]
```

╨Ф╨╗╤П ╨║╨░╤Б╤В╨╛╨╝╨╜╤Л╤Е ╤Б╤З╤С╤В╨╛╨▓ (`isCustomName=true`) ╤В╨╡╨║╤Б╤В: ┬л╨Ф╨╗╤П ╨▓╨░╤И╨╡╨│╨╛ ╤Б╤З╤С╤В╨░ (╤Б╨▓╨╛╨╣ ╤Б╤З╤С╤В)┬╗.

**╨Ъ╨╜╨╛╨┐╨║╨░ `[?? ╨Э╨░╨╣╤В╨╕ ╨▓╨░╨╗╤О╤В╤Г]` (ac:cur:search):**
1. FSM ╨┐╨╡╤А╨╡╤Е╨╛╨┤╨╕╤В ╨▓ ╤И╨░╨│ `cur_search`.
2. ╨С╨╛╤В ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В ╨┐╤А╨╛╨╝╨┐╤В:
   ```
   ?? ╨Я╨╛╨╕╤Б╨║ ╨▓╨░╨╗╤О╤В╤Л ╨┤╨╗╤П ╤Б╤З╤С╤В╨░ ┬л╨в╨╕╨╜╤М╨║╨╛╤Д╤Д┬╗
   ╨Т╨▓╨╡╨┤╨╕╤В╨╡ ╨║╨╛╨┤ ╨╕╨╗╨╕ ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╡: RUB, ╨┤╨╛╨╗╨╗╨░╤А, bitcoin...
   ```
3. ╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨▓╨▓╨╛╨┤╨╕╤В ╤В╨╡╨║╤Б╤В > `cur_search` text interceptor.
4. `searchCurrencies(query, pool)` тАФ fuzzy + ╤В╤А╨░╨╜╤Б╨╗╨╕╤В╨╡╤А╨░╤Ж╨╕╤П (rub/╤А╤Г╨▒ > RUB, dollar/╨┤╨╛╨╗╨╗╨░╤А > USD, btc > BTC).
5. **╨Э╨░╨╣╨┤╨╡╨╜╨╛:** ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В ╨║╨╜╨╛╨┐╨║╨╕ ╤А╨╡╨╖╤Г╨╗╤М╤В╨░╤В╨╛╨▓ + `[?? ╨Т╨╡╤А╨╜╤Г╤В╤М╤Б╤П ╨║ ╤Б╨┐╨╕╤Б╨║╤Г]` (ac:cur:list).
6. **╨Э╨╡ ╨╜╨░╨╣╨┤╨╡╨╜╨╛:** ┬л╨в╨░╨║╨╛╨╣ ╨▓╨░╨╗╤О╤В╤Л ╨╜╨╡╤В. ╨Я╨╛╨┐╤А╨╛╨▒╤Г╨╣╤В╨╡: USD, RUB, BTC...┬╗.

**╨Т╤Л╨▒╨╛╤А ╨▓╨░╨╗╤О╤В╤Л (ac:cur:{CODE}):**
- ╨б╤З╤С╤В ╤Б╨╛╨╖╨┤╨░╤С╤В╤Б╤П ╨▓ ╨С╨Ф: `addAccountWithCurrency(workspaceId, userId, name, currency)` > INSERT ╨▓ `account_sources`, ╤В╨╕╨┐ `manual`.
- FSM ╨┐╨╡╤А╨╡╤Е╨╛╨┤╨╕╤В ╨▓ ╤И╨░╨│ `bal_input`.

---

### ?? ╨н╤В╨░╨┐ 3 тАФ ╨Т╨▓╨╛╨┤ ╨╜╨░╤З╨░╨╗╤М╨╜╨╛╨│╨╛ ╨▒╨░╨╗╨░╨╜╤Б╨░ (╤И╨░╨│ `bal_input`)

```
?? ╨б╤З╤С╤В ┬л╨в╨╕╨╜╤М╨║╨╛╤Д╤Д┬╗ (RUB) ╤Б╨╛╨╖╨┤╨░╨╜!
╨Т╨▓╨╡╨┤╨╕╤В╨╡ ╨╜╨░╤З╨░╨╗╤М╨╜╤Л╨╣ ╨▒╨░╨╗╨░╨╜╤Б ╨╕╨╗╨╕ ╨┐╤А╨╛╨┐╤Г╤Б╤В╨╕╤В╨╡:

[? ╨Я╤А╨╛╨┐╤Г╤Б╤В╨╕╤В╤М]
```

- **╨Т╨▓╨╛╨┤ ╤З╨╕╤Б╨╗╨░** > text interceptor `bal_input` > `setAccountBalanceById()` > `initial_balance` ╨▓ ╨С╨Ф.
- **`[? ╨Я╤А╨╛╨┐╤Г╤Б╤В╨╕╤В╤М]`** (ac:bal:s) > ╨▒╨░╨╗╨░╨╜╤Б ╨╛╤Б╤В╨░╤С╤В╤Б╤П 0.

╨Я╨╛╤Б╨╗╨╡ ╨▓╨▓╨╛╨┤╨░/╨┐╤А╨╛╨┐╤Г╤Б╨║╨░ тАФ **success screen** (╨▒╨╡╨╖ ╨║╨╜╨╛╨┐╨╛╨║, ╤В╨╛╨╗╤М╨║╨╛ ╤В╨╡╨║╤Б╤В):
```
? ╨б╤З╤С╤В ╤Б╨╛╨╖╨┤╨░╨╜!
?? ╨в╨╕╨╜╤М╨║╨╛╤Д╤Д ┬╖ RUB
╨Э╨░╤З╨░╨╗╤М╨╜╤Л╨╣ ╨▒╨░╨╗╨░╨╜╤Б: 15 000 ?
```
╨Ч╨░╤В╨╡╨╝ ╤Б╤А╨░╨╖╤Г тАФ ╨┐╨╕╨║╨╡╤А ╤В╨╕╨┐╨░ ╨┤╨╗╤П ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨╕╤П ╤Б╨╗╨╡╨┤╤Г╤О╤Й╨╡╨│╨╛ ╤Б╤З╤С╤В╨░ (`buildFinishOnboardKeyboard`):
```
[?? ╨С╨░╨╜╨║╨╛╨▓╤Б╨║╨░╤П ╨║╨░╤А╤В╨░]  [?? ╨Э╨░╨╗╨╕╤З╨╜╤Л╨╡]
[?? ╨Ъ╤А╨╕╨┐╤В╨╛-╨▒╨╕╤А╨╢╨░]      [?? ╨Ъ╤А╨╕╨┐╤В╨╛-╨║╨╛╤И╨╡╨╗╤С╨║]
[?? ╨б╨▓╨╛╤С ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╡]
[? ╨Ч╨░╨▓╨╡╤А╤И╨╕╤В╤М]
```

---

### ? ╨н╤В╨░╨┐ 4 тАФ ╨б╨╛╨╖╨┤╨░╨╜╨╕╨╡ ╨Т╨в╨Ю╨а╨Ю╨У╨Ю ╤Б╤З╤С╤В╨░ (╨╜╨╡╨╛╨▒╤П╨╖╨░╤В╨╡╨╗╤М╨╜╨╛)

╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨╜╨░╨╢╨╕╨╝╨░╨╡╤В ╨╗╤О╨▒╨╛╨╣ ╤В╨╕╨┐ ╨▓ `buildFinishOnboardKeyboard` > ╨┐╨╛╨▓╤В╨╛╤А╤П╨╡╤В ╨н╤В╨░╨┐╤Л 1тАУ3.

**╨Я╤А╨╕╨╝╨╡╤А ╨┤╨▓╤Г╤Е ╤Б╤З╨╡╤В╨╛╨▓:**
1. ┬л╨в╨╕╨╜╤М╨║╨╛╤Д╤Д┬╗ > RUB > ╨▒╨░╨╗╨░╨╜╤Б 15 000 (╨▒╨░╨╜╨║╨╛╨▓╤Б╨║╨░╤П ╨║╨░╤А╤В╨░)
2. ┬л╨Э╨░╨╗╨╕╤З╨╜╤Л╨╡ RUB┬╗ > RUB > ╨▒╨░╨╗╨░╨╜╤Б 5 000 (╨╜╨░╨╗╨╕╤З╨╜╤Л╨╡, ╨╕╨╝╤П ╨░╨▓╤В╨╛)

╨д╨╗╨╛╤Г ╨Э╨░╨╗╨╕╤З╨╜╤Л╤Е (╨▓╤В╨╛╤А╨╛╨╣ ╤Б╤З╤С╤В):
- ╨Э╨░╨╢╨░╤В╤М `[?? ╨Э╨░╨╗╨╕╤З╨╜╤Л╨╡]` > ╤Б╤А╨░╨╖╤Г currency picker (╨╜╨╡╤В name_input) > ╨▓╤Л╨▒╤А╨░╤В╤М `[???? RUB]` > ╨▓╨▓╨╡╤Б╤В╨╕ ╨▒╨░╨╗╨░╨╜╤Б `5000` > success screen.

╨Я╨╛╤Б╨╗╨╡ тАФ ╤Б╨╜╨╛╨▓╨░ `buildFinishOnboardKeyboard`. ╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨╜╨░╨╢╨╕╨╝╨░╨╡╤В `[? ╨Ч╨░╨▓╨╡╤А╤И╨╕╤В╤М]` (ac:fin):
- Redis-╨║╨╗╤О╤З `midas:ac:` ╨╛╤З╨╕╤Й╨░╨╡╤В╤Б╤П.
- ╨б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ ╤Г╨┤╨░╨╗╤П╨╡╤В╤Б╤П (`deleteMessage`).
- ╨Ю╤В╨┐╤А╨░╨▓╨╗╤П╨╡╤В╤Б╤П `sendMessageWithReplyKeyboard` тАФ ReplyKeyboard ╨┐╨╛╤П╨▓╨╗╤П╨╡╤В╤Б╤П ╤Б╨╜╨╛╨▓╨░.
- ╨Х╤Б╨╗╨╕ ╨┐╤А╨╕╤И╤С╨╗ ╨╕╨╖ ╨▒╨░╨╗╨░╨╜╤Б-╨┤╨░╤И╨▒╨╛╤А╨┤╨░ (`bl:source` ╨▓ Redis) > ╨▓╨╛╨╖╨▓╤А╨░╤В ╨▓ ╨▒╨░╨╗╨░╨╜╤Б. ╨Ш╨╜╨░╤З╨╡ тАФ ╤Д╨╕╨╜╨░╨╗╤М╨╜╤Л╨╣ ╤Н╨║╤А╨░╨╜ ┬л╨Т╤Б╤С ╨│╨╛╤В╨╛╨▓╨╛!┬╗.

---

### ?? ╨н╤В╨░╨┐ 5 тАФ ╨Я╨╡╤А╨▓╨░╤П ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╤П (╨▓╨▓╨╛╨┤ ╤А╨░╤Б╤Е╨╛╨┤╨░)

#### 5.1 ╨Т╨▓╨╛╨┤ ╤Б╨▓╨╛╨▒╨╛╨┤╨╜╤Л╨╝ ╤В╨╡╨║╤Б╤В╨╛╨╝

╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨┐╤А╨╛╤Б╤В╨╛ **╨┐╨╕╤И╨╡╤В ╨▓ ╤З╨░╤В** (╨╜╨╡ ╨║╨╛╨╝╨░╨╜╨┤╨░, ╨╜╨╡ ╨║╨╜╨╛╨┐╨║╨░):
```
╨║╨╛╤Д╨╡ 150 ╤А╤Г╨▒╨╗╨╡╨╣
```

**╨Ь╨░╤А╤И╤А╤Г╤В:**
1. `webhook.route.ts` тАФ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡ ╨┐╤А╨╛╤Е╨╛╨┤╨╕╤В ╨▓╤Б╨╡ text interceptors (╨╜╨╡╤В ╨░╨║╤В╨╕╨▓╨╜╤Л╤Е Redis-╨║╨╗╤О╤З╨╡╨╣).
2. ╨Я╨╛╨┐╨░╨┤╨░╨╡╤В ╨▓ ╤А╨░╨╖╨┤╨╡╨╗ AI parse > `addJobToWebhookIngestionQueue()`.
3. **`webhook-ingestion` worker** (BullMQ) > `ai-parse.worker.ts`.

#### 5.2 AI parse pipeline

1. `parseTransaction(text)` > Claude Haiku 4.5, `temperature: 0`, `max_tokens: 256`.
2. System prompt: MULTILINGUAL RECOGNITION (RU/EN/UA) + FUZZY MATCHING + 30-╨║╨░╤В╨╡╨│╨╛╤А╨╕╨╣╨╜╨░╤П ╤В╨░╨║╤Б╨╛╨╜╨╛╨╝╨╕╤П + 500+ ╤П╨║╨╛╤А╨╜╤Л╤Е ╤Б╨╗╨╛╨▓ + DISAMBIGUATION RULES.
3. **╨а╨╡╨╖╤Г╨╗╤М╤В╨░╤В:**
   ```json
   { "intent": "expense", "amount": "150", "currency": "RUB", "category_hint": "╨Ъ╨░╤Д╨╡ ╨╕ ╤А╨╡╤Б╤В╨╛╤А╨░╨╜╤Л", "confidence": 0.95 }
   ```
4. Post-processing (safety net): 7 ╨│╤А╤Г╨┐╨┐ regex, negation guard, confidence boost.
5. `ALLOWED_CATEGORIES` ╨▓╨░╨╗╨╕╨┤╨░╤Ж╨╕╤П: ╨╡╤Б╨╗╨╕ `category_hint` ? set > ╨╖╨░╨╝╨╡╨╜╤П╨╡╤В╤Б╤П ╨╜╨░ ┬л╨Ф╤А╤Г╨│╨╛╨╡┬╗.
6. `CategoryResolverService`: exact DB match > 200+ alias map > fallback.
7. **Dead card cleanup:** ╨╡╤Б╨╗╨╕ ╨▓ Redis ╨╡╤Б╤В╤М `midas:dead_card:{chatId}` (╤Б╤В╨░╤А╨░╤П ? ╨║╨░╤А╤В╨╛╤З╨║╨░) > `deleteMessage` ╨┐╨╡╤А╨╡╨┤ ╨╛╤В╨┐╤А╨░╨▓╨║╨╛╨╣ preview.

#### 5.3 ╨б╨╛╨╖╨┤╨░╨╜╨╕╨╡ ╤З╨╡╤А╨╜╨╛╨▓╨╕╨║╨░ ╨╕ preview

1. `createDraft()` > INSERT ╨▓ `transaction_drafts` (╤Б╤В╨░╤В╤Г╤Б `pending_user`).
2. `notifications.worker` > ╨╛╤В╨┐╤А╨░╨▓╨╗╤П╨╡╤В preview-╨║╨░╤А╤В╨╛╤З╨║╤Г ╨▓ ╤З╨░╤В:
   ```
   ? ╨Ъ╨░╤Д╨╡ ╨╕ ╤А╨╡╤Б╤В╨╛╤А╨░╨╜╤Л
   ╨а╨░╤Б╤Е╨╛╨┤ ┬╖ 150 ?
   [? ╨Ч╨░╨┐╨╕╤Б╨░╤В╤М]  
   [?? ╨Ш╨╖╨╝╨╡╨╜╨╕╤В╤М] [?? ╨Ю╤В╨╝╨╡╨╜╨░]
   ```
3. `midas:preview:{draftId}` (TTL 600s) > ╤Б╨╛╤Е╤А╨░╨╜╤П╨╡╤В message_id ╨║╨░╤А╤В╨╛╤З╨║╨╕.

#### 5.4 ╨Я╨╛╨┤╤В╨▓╨╡╤А╨╢╨┤╨╡╨╜╨╕╨╡

**╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨╜╨░╨╢╨╕╨╝╨░╨╡╤В `[? ╨Ч╨░╨┐╨╕╤Б╨░╤В╤М]`:**
1. `callback_query` > `confirmation.worker`.
2. SELECT FOR UPDATE SKIP LOCKED > ╨░╤В╨╛╨╝╨░╤А╨╜╨░╤П ╨╖╨░╤Й╨╕╤В╨░ ╨╛╤В ╨┤╨▓╨╛╨╣╨╜╨╛╨│╨╛ ╨┐╨╛╨┤╤В╨▓╨╡╤А╨╢╨┤╨╡╨╜╨╕╤П.
3. INSERT ╨▓ `transactions` (intent=expense, category=╨Ъ╨░╤Д╨╡ ╨╕ ╤А╨╡╤Б╤В╨╛╤А╨░╨╜╤Л, base_amount=150, currency=RUB, account_id=╨в╨╕╨╜╤М╨║╨╛╤Д╤Д, base_currency=RUB).
4. `confirmation.worker` ╤З╨╕╤В╨░╨╡╤В `midas:preview:{draftId}` > `editMessageText` > preview ╨┐╤А╨╡╨▓╤А╨░╤Й╨░╨╡╤В╤Б╤П ╨▓ confirmed card:
   ```
   ? ╨Ч╨░╨┐╨╕╤Б╨░╨╜╨╛!
   ? ╨Ъ╨░╤Д╨╡ ╨╕ ╤А╨╡╤Б╤В╨╛╤А╨░╨╜╤Л
   ╨а╨░╤Б╤Е╨╛╨┤ ┬╖ 150 ? ┬╖ ╨в╨╕╨╜╤М╨║╨╛╤Д╤Д
   [?? ╨Ш╨╖╨╝╨╡╨╜╨╕╤В╤М ╨╖╨░╨┐╨╕╤Б╤М]
   ```
5. `midas:preview:{draftId}` ╤Г╨┤╨░╨╗╤П╨╡╤В╤Б╤П ╨╕╨╖ Redis.

**╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨╜╨░╨╢╨╕╨╝╨░╨╡╤В `[?? ╨Ю╤В╨╝╨╡╨╜╨░]`:**
- `draft_status` > `rejected`.
- preview-╨║╨░╤А╤В╨╛╤З╨║╨░ ╤А╨╡╨┤╨░╨║╤В╨╕╤А╤Г╨╡╤В╤Б╤П > ┬л? ╨Ю╤В╨╝╨╡╨╜╨╡╨╜╨╛┬╗.
- ╨б╨╛╤Е╤А╨░╨╜╤П╨╡╤В╤Б╤П ╨▓ `midas:dead_card:{chatId}` (TTL 24h) тАФ ╨░╨▓╤В╨╛╤Г╨┤╨░╨╗╨╕╤В╤Б╤П ╨┐╤А╨╕ ╤Б╨╗╨╡╨┤╤Г╤О╤Й╨╡╨╝ preview.

#### 5.5 ╨Х╤Б╨╗╨╕ Claude ╨╜╨╡ ╤А╨░╤Б╨┐╨╛╨╖╨╜╨░╨╗ ╨▓╨░╨╗╤О╤В╤Г (awaiting_cur)

- `midas:awaiting_cur:{chatId}` (TTL 600s) ╤Б╨╛╨╖╨┤╨░╤С╤В╤Б╤П ╨╡╤Б╨╗╨╕ ╨╡╤Б╤В╤М ╤Б╤Г╨╝╨╝╨░ ╨╜╨╛ ╨╜╨╡╤В ╨▓╨░╨╗╤О╤В╤Л ╨╕ ╨╜╨╡╤В `midas:cur_set:{workspaceId}`.
- ╨б╨╗╨╡╨┤╤Г╤О╤Й╨╕╨╣ ╤В╨╡╨║╤Б╤В ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤П ╨┐╨╡╤А╨╡╤Е╨▓╨░╤В╤Л╨▓╨░╨╡╤В╤Б╤П ╨║╨░╨║ ╨▓╨░╨╗╤О╤В╨░: ┬л╨╡╨▓╤А╨╛┬╗ > EUR, ┬л150 ╤А╤Г╨▒┬╗ > RUB.

#### 5.6 ╨Х╤Б╨╗╨╕ Claude ╨▓╨╡╤А╨╜╤Г╨╗ partial (╨╜╨╡╤В ╤Б╤Г╨╝╨╝╤Л)

- `needs_clarification` ╤Б╤В╨░╤В╤Г╤Б ╤З╨╡╤А╨╜╨╛╨▓╨╕╨║╨░.
- ╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤О ╨╖╨░╨┤╨░╤С╤В╤Б╤П ╨▓╨╛╨┐╤А╨╛╤Б: ┬л╨Ъ╨░╨║╨░╤П ╤Б╤Г╨╝╨╝╨░?┬╗.
- `midas:clar:{userId}:{chatId}` (TTL 300s) > ╤Б╨╗╨╡╨┤╤Г╤О╤Й╨╡╨╡ ╤З╨╕╤Б╨╗╨╛ тАФ ╤Б╤Г╨╝╨╝╨░.

---

### ?? ╨Ш╤В╨╛╨│╨╛╨▓╨░╤П ╤Б╤Е╨╡╨╝╨░: ╨║╨╗╤О╤З╨╡╨▓╤Л╨╡ ╤Б╤Г╤Й╨╜╨╛╤Б╤В╨╕

```
workspaces
  L-- workspace_memberships (telegramUserId > workspaceId)
  L-- account_sources (╨в╨╕╨╜╤М╨║╨╛╤Д╤Д/RUB, ╨Э╨░╨╗╨╕╤З╨╜╤Л╨╡/RUB)
  L-- categories (╨Ъ╨░╤Д╨╡ ╨╕ ╤А╨╡╤Б╤В╨╛╤А╨░╨╜╤Л, ╨Я╤А╨╛╨┤╤Г╨║╤В╤Л, ...)
  L-- transaction_drafts (pending > approved/rejected/expired)
  L-- transactions (confirmed ╤А╨░╤Б╤Е╨╛╨┤╤Л/╨┤╨╛╤Е╨╛╨┤╤Л)
```

### ?? Redis-╨║╨╗╤О╤З╨╕ ╨▓ ╨░╨║╤В╨╕╨▓╨╜╨╛╨╝ ╨╛╨╜╨▒╨╛╤А╨┤╨╕╨╜╨│╨╡

| ╨Ъ╨╗╤О╤З | TTL | ╨Э╨░╨╖╨╜╨░╤З╨╡╨╜╨╕╨╡ |
|---|---|---|
| `midas:ac:{userId}:{chatId}` | 300s | State ╨╝╨░╤И╨╕╨╜╨░ ╨╛╨╜╨▒╨╛╤А╨┤╨╕╨╜╨│╨░ (step, name, currency, pendingName, isCustomName, cur_search) |
| `bl:source:{userId}:{chatId}` | 300s | ╨д╨╗╨░╨│: ╨╛╨╜╨▒╨╛╤А╨┤╨╕╨╜╨│ ╨╕╨╜╨╕╤Ж╨╕╨╕╤А╨╛╨▓╨░╨╜ ╨╕╨╖ ╨▒╨░╨╗╨░╨╜╤Б-╨┤╨░╤И╨▒╨╛╤А╨┤╨░ |
| `midas:preview:{draftId}` | 600s | message_id preview-╨║╨░╤А╤В╨╛╤З╨║╨╕ |
| `midas:dead_card:{chatId}` | 24h | message_id ╨║╨░╤А╤В╨╛╤З╨║╨╕ ? ╨┤╨╗╤П ╨░╨▓╤В╨╛╤Г╨┤╨░╨╗╨╡╨╜╨╕╤П |
| `midas:awaiting_cur:{chatId}` | 600s | ╨Ю╨╢╨╕╨┤╨░╨╜╨╕╨╡ ╨▓╨▓╨╛╨┤╨░ ╨▓╨░╨╗╤О╤В╤Л |
| `midas:clar:{userId}:{chatId}` | 300s | ╨Ю╨╢╨╕╨┤╨░╨╜╨╕╨╡ ╨▓╨▓╨╛╨┤╨░ ╤Б╤Г╨╝╨╝╤Л ╨┐╤А╨╕ clarification |
| `midas:cur_set:{workspaceId}` | - | ╨д╨╗╨░╨│ ╤Г╤Б╤В╨░╨╜╨╛╨▓╨╗╨╡╨╜╨╜╨╛╨╣ ╨▓╨░╨╗╤О╤В╤Л (╨╜╨╡ ╨╖╨░╨┐╤А╨░╤И╨╕╨▓╨░╤В╤М ╨┐╨╛╨▓╤В╨╛╤А╨╜╨╛) |

---

## 16. ACTIVE ROADMAP тАФ ╨Ъ╨г╨Ф╨Р ╨Ф╨Т╨Ш╨У╨Р╨Х╨Ь╨б╨п ╨Ф╨Р╨Ы╨м╨и╨Х

> ╨н╤В╨╛╤В ╤А╨░╨╖╨┤╨╡╨╗ тАФ ╨╢╨╕╨▓╨╛╨╣ ╨┤╨╛╨║╤Г╨╝╨╡╨╜╤В. ╨Ю╨▒╨╜╨╛╨▓╨╗╤П╨╡╤В╤Б╤П ╨┐╤А╨╕ ╨╖╨░╨▓╨╡╤А╤И╨╡╨╜╨╕╨╕ ╨║╨░╨╢╨┤╨╛╨╣ ╤Д╨░╨╖╤Л.
> ╨Я╨╛╤Б╨╗╨╡╨┤╨╜╨╡╨╡ ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╨╕╨╡: 2026-05-13 11:24 (UTC+3)

### ? ╨Ч╨░╨▓╨╡╤А╤И╨╡╨╜╨╛ ╨▓ Phase 2.5 (Smart Transaction Logic)

| ╨и╨░╨│ | ╨з╤В╨╛ ╤Б╨┤╨╡╨╗╨░╨╜╨╛ | ╨б╤В╨░╤В╤Г╤Б |
|---|---|---|
| ╨и╨░╨│ 1 | `item-category-detector.service.ts` тАФ ╨░╨▓╤В╨╛-╨╛╨┐╤А╨╡╨┤╨╡╨╗╨╡╨╜╨╕╨╡ ╨║╨░╤В╨╡╨│╨╛╤А╨╕╨╕ ╨┐╨╛ ╨╜╨░╨╖╨▓╨░╨╜╨╕╤О ╤В╨╛╨▓╨░╤А╨░/╨▒╤А╨╡╨╜╨┤╨░ (200+ ╨╖╨░╨┐╨╕╤Б╨╡╨╣, 9 ╨║╨░╤В╨╡╨│╨╛╤А╨╕╨╣, Maybach>╨в╤А╨░╨╜╤Б╨┐╨╛╤А╤В) | ? |
| ╨и╨░╨│ 2 | `account-currency-validator.service.ts` тАФ ╨▒╨╗╨╛╨║╨╕╤А╨╛╨▓╨║╨░ ╨╜╨╡╤Б╨╛╨▓╨╝╨╡╤Б╤В╨╕╨╝╤Л╤Е ╨┐╨░╤А ╤Б╤З╤С╤В+╨▓╨░╨╗╤О╤В╨░ (╨С╨░╨╜╨║+USDT = ?, ╨С╨╕╤А╨╢╨░+USDT = ?) | ? |
| ╨и╨░╨│ 3 | `anomalyBadge()` ╨▓ ╨┐╨╕╨║╨╡╤А╨░╤Е тАФ ╨▓╨╕╨╖╤Г╨░╨╗╤М╨╜╤Л╨╣ `??` ╨┤╨╗╤П ╨┐╨╛╨┤╨╛╨╖╤А╨╕╤В╨╡╨╗╤М╨╜╤Л╤Е ╤Б╤Г╤Й╨╡╤Б╤В╨▓╤Г╤О╤Й╨╕╤Е ╤Б╤З╨╡╤В╨╛╨▓ | ? |
| ╨и╨░╨│ 4 | `ai-parse.worker.ts` тАФ ╤Д╨╕╨║╤Б ┬лActive Draft Gate┬╗: ╨▓╤Л╨▓╨╛╨┤ Account/XFX-╨╖╨░╨▓╨╕╤Б╨╕╨╝╤Л╤Е UI ╨║╨╛╨╝╨┐╨╛╨╜╨╡╨╜╤В╨╛╨▓ ╨┐╤А╨╕ ╨░╨║╤В╨╕╨▓╨╜╨╛╨╝ ╤З╨╡╤А╨╜╨╛╨▓╨╕╨║╨╡ | ? |

### ? ╨Ч╨░╨▓╨╡╤А╤И╨╡╨╜╨╛ ╨▓ Phase 2.5+ (Currency-Aware Account Picker)

> **╨Я╤А╨╛╨▒╨╗╨╡╨╝╨░:** USDT-╤Б╤З╤С╤В ╨╛╤В╨╛╨▒╤А╨░╨╢╨░╨╗╤Б╤П ╨▓ ╨┐╨╕╨║╨╡╤А╨╡ ╨┐╤А╨╕ USD-╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕. ╨Я╤А╨╕╤З╨╕╨╜╨░ тАФ ╨╜╨░╤З╨░╨╗╤М╨╜╤Л╨╣ ╨┐╨╕╨║╨╡╤А ╤Б╤В╤А╨╛╨╕╤В╤Б╤П ╨▓ `background-workers`, ╨░ ╨╜╨╡ ╨▓ `telegram-bot`, ╨┐╨╛╤Н╤В╨╛╨╝╤Г ╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨╕╤П ╨▓ `account.service.ts` (telegram-bot) ╨╜╨░ ╨╜╨╡╨│╨╛ ╨╜╨╡ ╨▓╨╗╨╕╤П╨╗╨╕.

| ╨и╨░╨│ | ╨д╨░╨╣╨╗ | ╨з╤В╨╛ ╤Б╨┤╨╡╨╗╨░╨╜╨╛ | ╨б╤В╨░╤В╤Г╤Б |
|---|---|---|---|
| 1 | `account-currency-validator.service.ts` | `isKnownCurrency()` тАФ ╨▓╨░╨╣╤В╨╗╨╕╤Б╤В-╨╖╨░╤Й╨╕╤В╨░ ╨╛╤В ╤Д╨░╨╜╤В╨╛╨╝╨╜╤Л╤Е ╨▓╨░╨╗╤О╤В (UDS, ╨Х╨Т╨а) | ? |
| 2 | `clarification.service.ts` | `validateCurrencyCode()` > ╤А╨░╨╜╨╜╤П╤П ╨┐╤А╨╛╨▓╨╡╤А╨║╨░ `isKnownCurrency()` ╨┐╨╡╤А╨╡╨┤ ╨╖╨░╨┐╨╕╤Б╤М╤О ╨▓ ╨С╨Ф | ? |
| 3 | `account.service.ts` | `getWorkspaceAccountsWithBalances(parsedCurrency?)` тАФ ╤Д╨╕╨╗╤М╤В╤А: ╤Д╨╕╨░╤В>╤Д╨╕╨░╤В╨╜╤Л╨╣ ╨┐╤Г╨╗, ╤Б╤В╨╡╨╣╨▒╨╗╨║╨╛╨╕╨╜/╨║╤А╨╕╨┐╤В╨╛>exact only | ? |
| 4 | `account-inline-keyboard.service.ts` | ╨Ъ╨╛╨╜╤В╨╡╨║╤Б╤В╨╜╤Л╨╡ ╨┐╨╛╨┤╤Б╨║╨░╨╖╨║╨╕ ╨╕ `getPickerEmptyText(parsedCurrency?)` | ? |
| 5 | `webhook.route.ts` | ╨Я╤А╨╛╨▒╤А╨░╤Б╤Л╨▓╨░╨╡╤В `parsed_currency` ╨▓ 3 entry points (preview, delink, showpicker) | ? |
| 6 ? | `ai-parse.worker.ts` | **Root-cause fix:** `filterPickerAccounts()` + `classifyPickerCcy()` ╨┐╤А╨╕╨╝╨╡╨╜╨╡╨╜╤Л ╨║ initial picker (`aiData.currency`) ╨╕ gate picker (`pendingDraft.parsedCurrency`) | ? |

**╨Р╤А╤Е╨╕╤В╨╡╨║╤В╤Г╤А╨╜╤Л╨╣ ╤Г╤А╨╛╨║:** ╨Т Midas ╨┤╨▓╨░ ╨╜╨╡╨╖╨░╨▓╨╕╤Б╨╕╨╝╤Л╤Е ╨┐╨░╨╣╨┐╨╗╨░╨╣╨╜╨░ ╨┐╨╕╨║╨╡╤А╨░. ╨Ы╤О╨▒╤Л╨╡ ╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨╕╤П ╨╗╨╛╨│╨╕╨║╨╕ ╨┐╨╕╨║╨╡╤А╨░ ╤В╤А╨╡╨▒╤Г╤О╤В ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╨╕╤П ╨Ю╨С╨Ю╨Ш╨е ╨┐╤А╨╕╨╗╨╛╨╢╨╡╨╜╨╕╨╣:
- `apps/telegram-bot` тАФ ╨┐╨╕╨║╨╡╤А╤Л ╨╜╨░╨▓╨╕╨│╨░╤Ж╨╕╨╕ (ia:delink, ia:showpicker)
- `apps/background-workers` тАФ ╨╜╨░╤З╨░╨╗╤М╨╜╤Л╨╣ ╨┐╨╕╨║╨╡╤А ╨┐╨╛╤Б╨╗╨╡ AI parse

---

### ?? Phase 3.0 тАФ DB Schema: ╨Я╨╛╨╗╨╜╨░╤П ╨░╤А╤Е╨╕╤В╨╡╨║╤В╤Г╤А╨╜╨░╤П ╨▓╨░╨╗╨╕╨┤╨░╤Ж╨╕╤П (╨Ю╨С╨п╨Ч╨Р╨в╨Х╨Ы╨м╨Э╨Ю)

> **╨Я╤А╨╕╨╛╤А╨╕╤В╨╡╤В: ╨Т╨л╨б╨Ю╨Ъ╨Ш╨Щ.** ╨в╨╡╨║╤Г╤Й╨░╤П ╨▓╨░╨╗╨╕╨┤╨░╤Ж╨╕╤П (╨и╨░╨│ 2) тАФ ╤Н╨▓╤А╨╕╤Б╤В╨╕╤З╨╡╤Б╨║╨░╤П, ╨╛╤Б╨╜╨╛╨▓╨░╨╜╨░ ╨╜╨░ `AccountOnboardState` ╨╕╨╖ Redis.
> ╨Х╤Б╨╗╨╕ Redis-╨║╨╗╤О╤З ╨╕╤Б╤В╤С╨║ ╨╕╨╗╨╕ ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╤Б╨╛╨╖╨┤╨░╤С╤В ╤Б╤З╤С╤В ╨╜╨╡╤Б╤В╨░╨╜╨┤╨░╤А╤В╨╜╤Л╨╝ ╨┐╤Г╤В╤С╨╝ тАФ ╤В╨╕╨┐ ╤Б╤З╤С╤В╨░ ╨╜╨╡╨╕╨╖╨▓╨╡╤Б╤В╨╡╨╜.
> Phase 3.0 ╨┐╨╡╤А╨╡╨▓╨╛╨┤╨╕╤В ╤Б╨╕╤Б╤В╨╡╨╝╤Г ╨╜╨░ **100% ╨╜╨░╨┤╤С╨╢╨╜╤Г╤О, ╤Б╤Е╨╡╨╝╨░-enforced ╨▓╨░╨╗╨╕╨┤╨░╤Ж╨╕╤О**.

#### ╨з╤В╨╛ ╨╜╤Г╨╢╨╜╨╛ ╤Б╨┤╨╡╨╗╨░╤В╤М

**╨Ь╨╕╨│╤А╨░╤Ж╨╕╤П ╨С╨Ф:**
```sql
ALTER TABLE account_sources
  ADD COLUMN account_type    TEXT CHECK (account_type IN ('card','cash','exchange','wallet','custom')),
  ADD COLUMN wallet_subtype  TEXT CHECK (wallet_subtype IN ('crypto','ewallet','ton','lightning')),
  ADD COLUMN provider_key    TEXT;  -- 'mono', 'binance', 'payeer', etc. (lowercase)
```

**╨Ч╨░╨┐╨╛╨╗╨╜╨╡╨╜╨╕╨╡ ╨┐╤А╨╕ ╤Б╨╛╨╖╨┤╨░╨╜╨╕╨╕ ╤Б╤З╤С╤В╨░:**
- ╨Т `account.service.ts` > `addAccountReturningId()` ╨╕ `addAccountWithCurrency()`:
  ╨┐╤А╨╕╨╜╨╕╨╝╨░╤В╤М `accountType`, `walletSubtype`, `providerKey` ╨╕╨╖ `AccountOnboardState` ╨╕ ╨╖╨░╨┐╨╕╤Б╤Л╨▓╨░╤В╤М ╨▓ ╨С╨Ф.
- ╨Т `webhook.route.ts` > `cmd=currency` handler: ╨┐╨╡╤А╨╡╨┤╨░╨▓╨░╤В╤М `state.accountType`, `state.walletSubtype`, `state.name.toLowerCase()` ╨║╨░╨║ `providerKey`.

**╨Ш╤Б╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╨╜╨╕╨╡ ╨┐╤А╨╕ ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╤П╤Е:**
- `buildAccountPickerForDraft` ╨╕ `buildAccountPickerV2Keyboard`:
  ╨▓╨╝╨╡╤Б╤В╨╛ ╤Н╨▓╤А╨╕╤Б╤В╨╕╨║╨╕ ╨┐╨╛ ╨╕╨╝╨╡╨╜╨╕ > ╤З╨╕╤В╨░╤В╤М `account_type` ╨╕╨╖ ╨С╨Ф, ╨┐╨╡╤А╨╡╨┤╨░╨▓╨░╤В╤М ╨▓ `validateAccountCurrency()`.
  ╨н╤В╨╛ ╨┤╨╡╨╗╨░╨╡╤В `??` badge ╨╜╨░ 100% ╤В╨╛╤З╨╜╤Л╨╝.

**╨а╨╡╤В╤А╨╛╨░╨║╤В╨╕╨▓╨╜╨╛╨╡ ╨╖╨░╨┐╨╛╨╗╨╜╨╡╨╜╨╕╨╡ (╨╛╨┐╤Ж╨╕╨╛╨╜╨░╨╗╤М╨╜╨╛):**
- ╨Я╨╛╨┐╤Л╤В╨░╤В╤М╤Б╤П ╨▓╤Л╨▓╨╡╤Б╤В╨╕ `account_type` ╨╕╨╖ ╤Б╤Г╤Й╨╡╤Б╤В╨▓╤Г╤О╤Й╨╕╤Е ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╣ ╤Б╤З╨╡╤В╨╛╨▓ ╤З╨╡╤А╨╡╨╖ ╨╝╨░╤В╤З ╤Б `BANK_PRESETS`/`EWALLET_PRESETS`/`EXCHANGE_PRESETS`.
- ╨Т╤Б╨╡ ╤З╤В╨╛ ╨╜╨╡ ╨┐╨╛╨┤╨╛╤И╨╗╨╛ > `account_type = 'custom'`.

#### ╨д╨░╨╣╨╗╤Л ╨┤╨╗╤П ╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨╕╤П

| ╨д╨░╨╣╨╗ | ╨Ш╨╖╨╝╨╡╨╜╨╡╨╜╨╕╨╡ |
|---|---|
| `packages/database/migrations/XXXXXXX_account-sources-type-columns.js` | NEW тАФ ALTER TABLE |
| `apps/telegram-bot/src/services/account.service.ts` | MODIFY тАФ ╤А╨░╤Б╤И╨╕╤А╨╕╤В╤М ╤Б╨╕╨│╨╜╨░╤В╤Г╤А╤Л addAccount* |
| `apps/telegram-bot/src/routes/webhook.route.ts` | MODIFY тАФ ╨┐╨╡╤А╨╡╨┤╨░╨▓╨░╤В╤М ╤В╨╕╨┐ ╨▓ addAccount* |
| `apps/telegram-bot/src/services/account-inline-keyboard.service.ts` | MODIFY тАФ ╤З╨╕╤В╨░╤В╤М ╤В╨╕╨┐ ╨╕╨╖ ╨С╨Ф ╨▓╨╝╨╡╤Б╤В╨╛ ╤Н╨▓╤А╨╕╤Б╤В╨╕╨║╨╕ |
| `apps/telegram-bot/src/services/account-currency-validator.service.ts` | MODIFY тАФ ╤Г╨▒╤А╨░╤В╤М ╨┐╤А╨╛╨▓╨░╨╣╨┤╨╡╤А-╤Е╨╕╨╜╤В ╨╕╨╖ ╤Б╨╕╨│╨╜╨░╤В╤Г╤А╤Л (╤В╨╡╨┐╨╡╤А╤М ╨╕╨╖ ╨С╨Ф) |

#### ╨Ю╤Ж╨╡╨╜╨║╨░ ╤А╨░╨▒╨╛╤В╤Л
- ~3тАУ4 ╤З╨░╤Б╨░ (╨╝╨╕╨│╤А╨░╤Ж╨╕╤П + ╤Б╨╕╨│╨╜╨░╤В╤Г╤А╤Л + ╨╕╨╜╤В╨╡╨│╤А╨░╤Ж╨╕╤П + smoke test)
- ╨С╨╡╨╖ breaking changes ╨▓ UX тАФ ╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨╕╤П ╤В╨╛╨╗╤М╨║╨╛ ╨▓ ╤Б╨╗╨╛╨╡ ╨┤╨░╨╜╨╜╤Л╤Е

---

### ?? Phase 3.1 тАФ ╨а╨░╤Б╤И╨╕╤А╨╡╨╜╨╕╨╡ ╤Б╨╗╨╛╨▓╨░╤А╤П ╨┤╨╡╤В╨╡╨║╤В╨╛╤А╨░ ╨║╨░╤В╨╡╨│╨╛╤А╨╕╨╣

> **╨Я╤А╨╕╨╛╤А╨╕╤В╨╡╤В: ╨б╨а╨Х╨Ф╨Э╨Ш╨Щ.** ╨в╨╡╨║╤Г╤Й╨╕╨╣ ╤Б╨╗╨╛╨▓╨░╤А╤М: 200+ ╨╖╨░╨┐╨╕╤Б╨╡╨╣, 9 ╨║╨░╤В╨╡╨│╨╛╤А╨╕╨╣.
> ╨ж╨╡╨╗╤М: ╤А╨░╤Б╤И╨╕╤А╨╕╤В╤М ╨┤╨╛ 500+ ╨╖╨░╨┐╨╕╤Б╨╡╨╣, ╨┤╨╛╨▒╨░╨▓╨╕╤В╤М ╨╗╨╛╨║╨░╨╗╤М╨╜╤Л╨╡ ╨▒╤А╨╡╨╜╨┤╤Л (UA/KZ/UZ/BY).

- ╨Ф╨╛╨▒╨░╨▓╨╕╤В╤М ╨║╨░╤В╨╡╨│╨╛╤А╨╕╨╕: `╨Я╤Г╤В╨╡╤И╨╡╤Б╤В╨▓╨╕╤П`, `╨Я╨╛╨┤╨░╤А╨║╨╕`, `╨Я╨╕╤В╨╛╨╝╤Ж╤Л`, `╨Ш╨╜╨▓╨╡╤Б╤В╨╕╤Ж╨╕╨╕`
- ╨Ф╨╛╨▒╨░╨▓╨╕╤В╤М 150+ ╨╗╨╛╨║╨░╨╗╤М╨╜╤Л╤Е ╨▒╤А╨╡╨╜╨┤╨╛╨▓: ╨Р╨в╨С, ╨б╤Ц╨╗╤М╨┐╨╛, Kaspi, OLX, Wildberries, Ozon, ╨б╨Ф╨н╨Ъ
- ╨Ф╨╛╨▒╨░╨▓╨╕╤В╤М ╤В╤А╨░╨╜╤Б╨╗╨╕╤В╨╡╤А╨░╤Ж╨╕╤О: ┬лstarbaks┬╗ > Starbucks, ┬лmak┬╗ > McDonald's

---

### ?? Phase 3.2 тАФ ╨Ю╤В╤З╤С╤В 3.0: ╨Ъ╨░╤В╨╡╨│╨╛╤А╨╕╨╣╨╜╨░╤П ╨░╨╜╨░╨╗╨╕╤В╨╕╨║╨░

> **╨Я╤А╨╕╨╛╤А╨╕╤В╨╡╤В: ╨б╨а╨Х╨Ф╨Э╨Ш╨Щ.** ╨в╨╡╨║╤Г╤Й╨╕╨╣ `/report` ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В ╤В╨╛╨╗╤М╨║╨╛ ╤Б╤Г╨╝╨╝╤Л ╨┐╨╛ intent.
> ╨Ф╨╛╨▒╨░╨▓╨╕╤В╤М ╤А╨░╨╖╨▒╨╕╨▓╨║╤Г ╨┐╨╛ ╨║╨░╤В╨╡╨│╨╛╤А╨╕╤П╨╝ + ╤В╨╛╨┐-5 ╤В╤А╨░╤В ╨╖╨░ ╨┐╨╡╤А╨╕╨╛╨┤.

```
?? ╨Ю╤В╤З╤С╤В ╨╖╨░ ╨╝╨░╨╣ 2026

?? ╨а╨░╤Б╤Е╨╛╨┤╤Л: 45 000 UAH
  ?? ╨в╤А╨░╨╜╤Б╨┐╨╛╤А╤В: 12 000 (27%)
  ?? ╨Х╨┤╨░: 8 500 (19%)
  ?? ╨н╨╗╨╡╨║╤В╤А╨╛╨╜╨╕╨║╨░: 15 000 (33%)
  ?? ╨Ф╤А╤Г╨│╨╛╨╡: 9 500 (21%)

?? ╨Ф╨╛╤Е╨╛╨┤╤Л: 120 000 UAH
```

---

### ?? Phase 4.0 тАФ Telegram Mini App (Frontend)

> **╨Я╤А╨╕╨╛╤А╨╕╤В╨╡╤В: ╨Э╨Ш╨Ч╨Ъ╨Ш╨Щ / ╨С╨г╨Ф╨г╨й╨Х╨Х.** React 19 + Vite 8.
> ╨Т╨╕╨╖╤Г╨░╨╗╤М╨╜╤Л╨╣ ╨┤╨░╤И╨▒╨╛╤А╨┤ ╨▒╨░╨╗╨░╨╜╤Б╨░, ╨┤╨╕╨░╨│╤А╨░╨╝╨╝╤Л ╤А╨░╤Б╤Е╨╛╨┤╨╛╨▓ ╨┐╨╛ ╨║╨░╤В╨╡╨│╨╛╤А╨╕╤П╨╝, ╨╕╤Б╤В╨╛╤А╨╕╤П ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╣.
> **╨Э╨╡ ╨╜╨░╤З╨╕╨╜╨░╤В╤М ╨┤╨╛ ╨╖╨░╨▓╨╡╤А╤И╨╡╨╜╨╕╤П Phase 3.0 + 3.1.**

---

### ╨б╨▓╨╛╨┤╨╜╨░╤П ╤В╨░╨▒╨╗╨╕╤Ж╨░ ╨┐╤А╨╕╨╛╤А╨╕╤В╨╡╤В╨╛╨▓

| ╨д╨░╨╖╨░ | ╨Э╨░╨╖╨▓╨░╨╜╨╕╨╡ | ╨Я╤А╨╕╨╛╤А╨╕╤В╨╡╤В | ╨б╤В╨░╤В╤Г╤Б | ╨в╤А╨╡╨▒╤Г╨╡╤В |
|---|---|---|---|| 2026-05-15 09:20 | **Balance UI Polish B-9+ тАФ compact text layout + Add Currency fix.** alance.service.ts: (1) Compact text тАФ ╤Г╨▒╤А╨░╨╜╤Л ╨┐╤Г╤Б╤В╤Л╨╡ ╤Б╤В╤А╨╛╨║╨╕ ╨╝╨╡╨╢╨┤╤Г ╤Б╤З╤С╤В╨░╨╝╨╕ ╨▓╨╜╤Г╤В╤А╨╕ ╤Б╨╡╨║╤Ж╨╕╨╕ ╨╕ ╨╝╨╡╨╢╨┤╤Г ╨╖╨░╨│╨╛╨╗╨╛╨▓╨║╨╛╨╝ ╨╕ ╨┐╨╡╤А╨▓╤Л╨╝ ╤Б╤З╤С╤В╨╛╨╝; GROUP_LABEL > Title Case (╨╜╨╡ ALL CAPS); ╤А╨╛╨╗╤М-╨▒╨╡╨╣╨┤╨╢╨╕ ╤Б╨╛╨║╤А╨░╤Й╨╡╨╜╤Л ╨┤╨╛ ╨╕╨║╨╛╨╜╨╛╨║. (2) ACCOUNT_DETAIL_SQL + GROUP BY ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╤Л тАФ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜ .parent_account_id; AccountDetailRow/AccountDetailData + parent_account_id: string | null. alance-keyboard.service.ts: uildAccountActionsKeyboard тАФ ╨┐╨░╤А╨░╨╝╨╡╤В╤А ╨┐╨╡╤А╨╡╨╕╨╝╨╡╨╜╨╛╨▓╨░╨╜ hasChildren > canAddCurrency, ╨║╨╜╨╛╨┐╨║╨░ ┬л╨Ф╨╛╨▒╨░╨▓╨╕╤В╤М ╨▓╨░╨╗╤О╤В╤Г┬╗ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В╤Б╤П ╨┤╨╗╤П ╨Т╨б╨Х╨е top-level ╤Б╤З╤С╤В╨╛╨▓ (parent_account_id === null), ╨╜╨╡ ╤В╨╛╨╗╤М╨║╨╛ ╨╕╨╝╨╡╤О╤Й╨╕╤Е ╨┤╨╡╤В╨╡╨╣. webhook.route.ts: 7 ╨▓╤Л╨╖╨╛╨▓╨╛╨▓ uildAccountActionsKeyboard тАФ ╤Г╤Б╨╗╨╛╨▓╨╕╨╡ detail.child_count > 0 ╨╖╨░╨╝╨╡╨╜╨╡╨╜╨╛ ╨╜╨░ detail.parent_account_id === null. tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. Commits cb37de6. Railway auto-deploy. |
oleSuffix тАФ ╤А╨╛╨╗╤М ╤Б╤Г╤Д╤Д╨╕╨║╤Б╨╛╨╝ <i>(? ╨╛╤Б╨╜╨╛╨▓╨╜╨╛╨╣)</i> ╨┐╨╛╤Б╨╗╨╡ ╨╕╨╝╨╡╨╜╨╕ (Variant A). (4) ╨Ч╨░╨│╨╛╨╗╨╛╨▓╨╛╨║ ?? ╨С╨░╨╗╨░╨╜╤Б > ?? ╨С╨░╨╗╨░╨╜╤Б (╤Б╨╛╨▓╨┐╨░╨┤╨░╨╡╤В ╤Б reply-keyboard). alance-keyboard.service.ts: (1) GROUP_EMOJI ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╤Л тАФ ?? ╨▒╨╕╤А╨╢╨╕, ?? ╨║╨╛╤И╨╡╨╗╤М╨║╨╕, ?? ╨┐╤А╨╛╤З╨╡╨╡. (2) GROUP_LABEL > Title Case. (3) ╨Ъ╨╜╨╛╨┐╨║╨╕ тАФ CCY_SYM ╤В╨░╨▒╨╗╨╕╤Ж╨░ ╤Б╨╕╨╝╨▓╨╛╨╗╨╛╨▓; ╤А╨╛╨╗╤М-╤Б╤Г╤Д╤Д╨╕╨║╤Б ' ?' (icon-only, ╨▒╨╡╨╖ ╤Б╨║╨╛╨▒╨╛╨║ ╨╕ ╤В╨╡╨║╤Б╤В╨░). tsc 0 ╨╛╤И╨╕╨▒╨╛╨║. Commits c4ba46c, 0b6530, 21e0a6f. Railway auto-deploy. |

---|
| **3.0** | DB Schema: account_type/wallet_subtype | ?? ╨Т╨л╨б╨Ю╨Ъ╨Ш╨Щ | ? ╨б╨╗╨╡╨┤╤Г╤О╤Й╨░╤П | Phase 2.5 ? |
| **3.1** | ╨а╨░╤Б╤И╨╕╤А╨╡╨╜╨╕╨╡ ╤Б╨╗╨╛╨▓╨░╤А╤П ╨┤╨╡╤В╨╡╨║╤В╨╛╤А╨░ | ?? ╨б╨а╨Х╨Ф╨Э╨Ш╨Щ | ?? ╨Ч╨░╨┐╨╗╨░╨╜╨╕╤А╨╛╨▓╨░╨╜╨░ | Phase 3.0 |
| **3.2** | ╨Ю╤В╤З╤С╤В 3.0: ╨║╨░╤В╨╡╨│╨╛╤А╨╕╨╣╨╜╨░╤П ╨░╨╜╨░╨╗╨╕╤В╨╕╨║╨░ | ?? ╨б╨а╨Х╨Ф╨Э╨Ш╨Щ | ?? ╨Ч╨░╨┐╨╗╨░╨╜╨╕╤А╨╛╨▓╨░╨╜╨░ | Phase 3.0 |
| **4.0** | Telegram Mini App | ?? ╨Э╨Ш╨Ч╨Ъ╨Ш╨Щ | ?? ╨С╤Г╨┤╤Г╤Й╨╡╨╡ | Phase 3.x |