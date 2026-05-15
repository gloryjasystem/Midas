# WORKFLOW_STATE.MD Ч ƒиспетчер задач »»-агента Midas

> **“ип:** MUTABLE Ч кратковременна€ пам€ть агента. ќбновл€етс€ на каждом шаге работы.
> **ќбновлЄн:** 2026-05-15 10:20 (UTC+3)

---

## 1. “≈ ”ў≈≈ —ќ—“ќяЌ»≈

| ѕараметр | «начение |
|---|---|
| **PHASE** | `Transaction Hub UX Ч Variant D Icon Chips ? DEPLOYED` |
| **STEP** | `Commit d770ca4 pushed to main. Railway auto-deploy triggered.` |
| **AGENT STATUS** | `tsc 0 errors. IntentFilter 5 типов (e/i/d/t/a). 'd' = merged долги (debt_given + debt_received). ¬ариант D: 1 строка ? 5 иконочных кнопок [??][??][??][??][?? ¬се]. Toggle: нажатие на активный фильтр снимает его.` |
| **DEPLOYMENT** | `Railway (spirited-happiness project)` Ч `Midas` ? Online Ј `background-workers` ? Online Ј `Postgres` ? Ј `Redis` ?. Health: https://midas-production-f4f1.up.railway.app/health > {"status":"ok"} |
| **LAST COMPLETED** | `Transaction Hub Variant D: иконочные чипы фильтрации [??][??][??][??][?? ¬се] Ч 1 строка вместо 2?3 сетки. IntentFilter d = SQL IN ('debt_given','debt_received'). Toggle UX. Backward compat dg/dr>d. Commit d770ca4.` |
| **BLOCKER** | None. |
| **NEXT ACTION** | Smoke-test Transaction Hub в живом боте: убедитьс€ что 5 чипов умещаютс€, фильтраци€ корректна, toggle работает. |


---

## 2. «ј¬≈–Ў®ЌЌџ≈ ‘ј«џ

| ‘аза | —татус |  лючевые артефакты |
|---|---|---|
| 0.1 Event Storming | ? | `docs/event_storming_part{1,2,3}.md` |
| 0.2 ADR Generation | ? | `docs/adr/ADR-000` Ч `ADR-014` (15 ADR) |
| 0.3 Implementation Readiness Gate | ? | `phase1_scope.md`, `database_model_draft.md`, `queue_model.md`, `mvp_acceptance_criteria.md` |
| 0.3.1 Security & Traceability Patch | ? | SEC-01 Ч SEC-12 внесены в scope, DB model, queue model, acceptance criteria, ADR-009, ADR-013 |
| 1.1 Project Infrastructure Foundation | ? | `midas-monorepo/` Ч полна€ структура Turborepo, Docker Compose, ESLint, TypeScript |
| 1.2 Database Foundation | ? | `packages/database/` Ч schema, RLS, withTenantTransaction, Decimal boundary |
| 1.3 BullMQ Task Queue Foundation | ? | `apps/background-workers/src/queues/`, `workers/`, `packages/shared/` job types |
| 1.4 Telegram Bot Foundation | ? | `apps/telegram-bot/src/` Ч Fastify server, SEC-04/05/06/12, webhook route, workspace resolver stub |
| 1.5 User Onboarding & Workspace Resolution | ? | `services/onboarding.service.ts`, `rate-limiter.ts`, `telegram-api.ts`, real `resolveWorkspace()`, `/start` handler |
| 1.6-A AI Parse Pipeline | ? | `packages/ai-core/`, `draft.service.ts`, `ai-parse.worker.ts`, 73/73 smoke tests, commit `7b393d2` |
| 1.6-B HitL Draft Confirmation | ? ACCEPTED | `draft-confirmation.service.ts`, `confirmation.worker.ts`, `callback-confirm-queue.ts`, webhook callback_query handler, 30/30 smoke tests incl. race condition, commit `d49625b` |
| 1.7 Draft Expiration & Lifecycle Cleanup | ? ACCEPTED | `migrations/1777973960000_draft-expiration.js` + `1777973970000_harden-expire-search-path.js` + `1777973980000_fix-expire-function-owner.js`, `draft-expiration.service.ts`, `draft-expiration.worker.ts`, `smoke-test-phase17.mjs` Ч 20/20 smoke tests PASS, commits `b9069ad`>`49e0cec` |
| 1.8-A Transaction Intent Foundation | ? ACCEPTED | `migrations/1778008338096_transaction-intent.js`, `draft.service.ts` (parsed_intent propagation), `draft-confirmation.service.ts` (intent_missing outcome), `confirmation.worker.ts` (intent_missing messages), `smoke-test-phase18a.mjs` Ч 19/19 smoke tests PASS, 155/155 total regression PASS, commits `425df61`>`51b6aee` |
| 1.8-B Runtime Consistency & Security Hardening | ? ACCEPTED | C-1: `draft.service.ts` `telegram_user_id`>`telegram_id` fix. C-2: `migrations/1778008400000_harden-onboarding-search-path.js` Ч `search_path` fixed for 2 SECDEF functions. M-1: `shared/index.ts` `TRANSACTION_TYPE` updated to 5 canonical values. `smoke-test-phase18b.mjs` Ч 16/16 PASS, 171/171 total regression PASS, commit `7af1692` |
| 1.9 Basic Text /report Command | ? ACCEPTED | `apps/telegram-bot/src/services/report.service.ts`, `apps/telegram-bot/src/routes/webhook.route.ts`, `apps/telegram-bot/src/services/workspace-resolver.ts`, `packages/database/smoke-test-phase19.mjs` Ч /report command, current UTC month, grouped by transaction_intent, Russian text output Ч 47/47 Phase 1.9 tests, 218/218 total regression PASS, implementation commit `e060edb`; workflow sync `dffb53e`, `1ec649e`; tag `phase-1.9-accepted`. |
| 1.10 Slash-Command Guard + Inline /help | ? ACCEPTED | `webhook.route.ts` (parseCommandToken, KNOWN_COMMANDS, /help, guard), `smoke-test-phase110.mjs` Ч 30/30 smoke tests PASS, 248/248 total regression PASS, commit `b321463`, tag `phase-1.10-accepted`. |
| 1.11 /category Read-Only List Command | ? ACCEPTED | `apps/telegram-bot/src/services/category.service.ts` (new), `webhook.route.ts` (KNOWN_COMMANDS, HELP_TEXT, /category handler), `smoke-test-phase111.mjs` Ч 78/78 Phase 1.11 + 326/326 total regression PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `2e77362`, tag `phase-1.11-accepted` pushed. |
| 1.12 Onboarding Default Data Seeding | ? ACCEPTED | `migrations/1778100000000_onboarding-default-seed.js` + `1778100010000_fix-onboarding-seed-conflict.js` (7-param SECDEF function), `onboarding.service.ts` (candidateAccountId + candidateCategoryId), `smoke-test-phase112.mjs` Ч 37/37 Phase 1.12 + 363/363 total regression PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `7b87eac`, tag `phase-1.12-accepted` pushed. |
| 1.13 /add_category Strict-Format Command | ? ACCEPTED | `category.service.ts` (`parseAddCategoryArgs`, `resolveGroup`, `addCategory`, `AddCategoryResult`), `webhook.route.ts` (KNOWN_COMMANDS 4>5, HELP_TEXT, handler `5e-add`), `smoke-test-phase113.mjs` Ч 74/74 Phase 1.13 + 437/437 total regression PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `eac55a9`, tag `phase-1.13-accepted` pushed. |
| 1.14 /accounts Read-Only List Command | ? ACCEPTED | `apps/telegram-bot/src/services/account.service.ts` (new), `webhook.route.ts` (KNOWN_COMMANDS 5>6, HELP_TEXT, handler `5d-acc`), `smoke-test-phase114.mjs` Ч 70/70 Phase 1.14 + 507/507 total regression PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `362b05b`, tag `phase-1.14-accepted` pushed. Note: HTML escaping for account/category names must be added before user-controlled write paths (/add_account). |
| 1.15 HTML Escaping Hardening | ? ACCEPTED | `apps/telegram-bot/src/utils/html-escape.ts` (NEW), `account.service.ts` (MODIFY), `category.service.ts` (MODIFY), `webhook.route.ts` (MODIFY), `smoke-test-phase115.mjs` (NEW) Ч 52/52 Phase 1.15 + 559/559 total PASS. Traceability ? Adversarial Security ? Scope Guard ?. Traceability fix: `groupToken` escaped in error message. Implementation commit `4f63a91`; workflow_state sync commit `88ebae3`; test-count fix commit `45b1eec`. Tag `phase-1.15-accepted` pushed. |
| 1.16 account_sources UNIQUE Constraint Migration | ? ACCEPTED | `packages/database/migrations/1778200000000_account-sources-unique-name.js` (NEW), `packages/database/smoke-test-phase116.mjs` (NEW) Ч UNIQUE(workspace_id, name) added; pre-flight 0 duplicates; 24/24 Phase 1.16 + 583/583 total PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `3ad45e3`. Tag `phase-1.16-accepted` pushed. |
| 1.17 /add_account Strict-Format Command | ? ACCEPTED | `account.service.ts` (MODIFY), `webhook.route.ts` (MODIFY), `smoke-test-phase117.mjs` (NEW) Ч 27/27 Phase 1.17 + 610/610 total PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `8c370e3`. Tag `phase-1.17-accepted` pushed. |
| 1.18 /report Currency Label (base_currency grouping) | ? ACCEPTED | `report.service.ts` (MODIFY), `smoke-test-phase118.mjs` (NEW), `smoke-test-phase19.mjs` (MODIFY Ч runReportQuery SQL helper sync) Ч 34/34 Phase 1.18 + 644/644 total PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `700a244`. Tag `phase-1.18-accepted` pushed. |
| 1.19 account_sources.currency CHECK Constraint | ? ACCEPTED | `packages/database/migrations/1778300000000_account-sources-currency-check.js` (NEW), `packages/database/smoke-test-phase119.mjs` (NEW) Ч CHECK (currency ~ '^[A-Z]{3,5}$'); pre-flight 0 invalid rows; 24/24 Phase 1.19 + 668/668 total PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `9d288bd`. Tag `phase-1.19-accepted` pushed. |
| 1.20 Balance Semantics Design Document | ? ACCEPTED | `docs/balance-semantics.md` (NEW) Ч 6 design decisions D1ЦD6 all approved. Formula: income+1/expense?1/debt_given?1/debt_received+1/transfer neutral. initial_balance NUMERIC(19,4) DEFAULT 0 approved (allow negative, account currency implicit, no date). Per-account output, all-time scope. Traceability ? Adversarial Security ? Scope Guard ?. No code. Tag `phase-1.20-accepted` pushed. |
| 1.21 Unified Balance Implementation | ? ACCEPTED | `migrations/1778400000000_account-sources-initial-balance.js` (NEW), `balance.service.ts` (NEW), `webhook.route.ts` (MODIFY Ч /balance added, KNOWN_COMMANDS 7>8, HELP_TEXT), `smoke-test-phase121.mjs` (NEW). 28/28 Phase 1.21 + 655/655 regression smoke + 13/13 typecheck+lint = 696/696 PASS. Phase 1.5 server-dependent tests excluded from baseline (pre-existing). Tech debt: stale /balance comment in webhook.route.ts line 31 (cosmetic, not blocking). Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `976418a`. Tag `phase-1.21-accepted` pushed. |
| 1.22 Stale Comment Cleanup | ? ACCEPTED | `webhook.route.ts` (MODIFY Ч comment-only: slash-command routing header updated, all 8 known commands listed, stale У(e.g. /balance)Ф example removed, Phase 1.21 added to phase refs). 0 logic changes. 13/13 typecheck+lint PASS (FULL TURBO). Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `d2ea3fd`. Tag `phase-1.22-accepted` pushed. |
| 1.23 /set_balance Command | ? ACCEPTED | `setBalance.service.ts` (NEW), `webhook.route.ts` (MODIFY). Tag `phase-1.23-accepted` pushed. |
| 1.24 /balance Formatting Polish | ? ACCEPTED | `balance.service.ts` (MODIFY). Tag `phase-1.24-accepted` pushed. |
| 1.25 /settings Text Commands | ? ACCEPTED | `settings.service.ts` (NEW). /settings currency, /settings timezone. Tag `phase-1.25-accepted` pushed. |
| 1.26 /settings UI | ? ACCEPTED | `settings-keyboard.service.ts` (NEW), `currencies.ts` (NEW). Inline keyboards, groups, pagination, Redis search state. 45/45 smoke. Tag `phase-1.26-accepted` pushed. |
| 1.27 Multicurrency Balance Hardening | ? ACCEPTED | `balance.service.ts` (MODIFY). SQL-level mismatch exclusion, mismatch footnote. 27/27 smoke. Tag `phase-1.27-accepted` pushed. |
| 1.28 /edit Transactions MVP | ? ACCEPTED | `edit.service.ts` (NEW), `edit-keyboard.service.ts` (NEW), `webhook.route.ts` (MODIFY), `confirmation.worker.ts` (MODIFY), `smoke-test-phase128.mjs` (NEW). /edit list+card+edit amount/category/account/intent. Permanent [?? »зменить] on confirmed msgs. Redis TTL 300s. ULID+workspace guards. Strict callback_data ?62 bytes verified. No search/date/delete/soft-delete/GIN, no migrations, no /balance or /report changes. 43/43 Phase 1.28 smoke + 841/841 regression smoke + 13/13 typecheck/lint = 897/897 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit c8bbc7d. Tag `phase-1.28-accepted` pushed. |
| 1.29 Transaction Soft Delete | ? ACCEPTED | `migrations/1778700000000_transactions-soft-delete.js` (NEW). deleted_at TIMESTAMPTZ DEFAULT NULL; soft delete via UPDATE; excluded from /edit, /balance (LEFT JOIN ON), /report, /set_balance; 941/941 gates PASS. Traceability ? Adversarial Security ? Scope Guard ?. impl commit 7082540. Tag `phase-1.29-accepted` pushed. |
| 1.30 Smart Account Onboarding | ? ACCEPTED | `account-onboard-keyboard.service.ts` (NEW), `account.service.ts` (hasAccounts, addAccountWithCurrency), `webhook.route.ts` (MODIFY Ч ac: callbacks, /start onboarding, /accounts empty-state, text intercept). Redis TTL midas:ac: 300s. 64/64 Phase 1.30 smoke + 318/318 accessible gates PASS. impl commit 4593867. Tag `phase-1.30-accepted` pushed. |
| 1.31 Inline Account Creation | ? ACCEPTED | `migrations/1778800000000_drafts-account-hint.js`, `account-fuzzy.service.ts`, `account-inline-keyboard.service.ts`, `account-resolver.service.ts` (bg-workers), `account.service.ts` (MODIFY), `draft.service.ts` (MODIFY), `ai-parse.worker.ts` (MODIFY), `webhook.route.ts` (MODIFY), `draft-confirmation.service.ts` (MODIFY), `schemas.ts`+`prompts.ts` (MODIFY). Option A: resolve before keyboard. ia: namespace ?62 bytes. 27/27 smoke + 13/13 typecheck/lint PASS. Implementation commit 7c065f7. |
| 1.32 Smart Text Input / Clarification Engine | ? ACCEPTED | `migrations/1778900000000_draft-clarification-state.js` (NEW), `schemas.ts` (amount/intent optional, PARTIAL_CONFIDENCE_THRESHOLD=0.3, MissingField), `claude-client.ts` ('partial' ParseResult, computeMissingFields), `prompts.ts` (partial examples), `draft.service.ts` (patchDraftAmount/Intent/Category), `ai-parse.worker.ts` (targeted clarification messages), `clarification.service.ts` (NEW, telegram-bot), `webhook.route.ts` (clar: callbacks, midas:clar: intercept), `smoke-test-phase132.mjs` (57/57 PASS). 0 lint/typecheck errors. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit e00f37e. Tag `phase-1.32-accepted` pushed. |
| 1.33 Clean Chat / Single Active Message UX | ? ACCEPTED | UX-only phase. `active-message.service.ts` (NEW), `telegram-api.ts` (MODIFY), `shared/index.ts` (MODIFY), `webhook.route.ts` (MODIFY), `notifications.worker.ts` (MODIFY), `confirmation.worker.ts` (MODIFY), `ai-parse.worker.ts` (MODIFY). No migrations, no DB schema changes, no new deps. Redis pointer midas:am:{userId}:{chatId} (TTL 24h). upsertBotMessage() edit-first strategy. 0 typecheck errors. Batch-accepted by owner decision. Commit `36cacd7`. Tag `phase-1.33-accepted` pushed. |
| 1.34 Rich Screen Cards Ч Single-Screen App UX | ? ACCEPTED | UX-only phase. `screen-builder.ts` (NEW Ч both apps), confirmation/preview card formatting. No migrations, no DB schema changes, no new deps. 0 typecheck errors. Batch-accepted by owner decision. Commit `6e899f0`. Tag `phase-1.34-accepted` pushed. |
| 1.35 Intelligent Transaction Understanding | ? ACCEPTED | `migrations/1779000000000_intelligent-transactions.js` (NEW), `category-resolver.service.ts` (NEW), `draft.service.ts` (MODIFY), `draft-confirmation.service.ts` (MODIFY), `ai-parse.worker.ts` (MODIFY), `confirmation.worker.ts` (MODIFY), `settings.service.ts`+`settings-keyboard.service.ts` (MODIFY), `webhook.route.ts` (MODIFY), `screen-builder.ts` (MODIFY), `prompts.ts`+`schemas.ts` (MODIFY). smoke-test-phase135.mjs Ч 55 tests. Deployed to Railway production. |
| 1.36-UX Persistent Navigation Keyboard | ? ACCEPTED | **Sub-steps 1Ц4 (commits c2f012f > 062d40d):** Core nav keyboard + bug fixes + auto-activation + collapsibility. **FINAL state (commits e879dfc > 2a15f31):** Transaction history workflow fully reworked. |
| 1.37 AI Taxonomy & Zero-Clutter UX | ? ACCEPTED | Zero-clutter UX, 30-category taxonomy, 500+ anchors, multilingual, disambiguation, ALLOWED_CATEGORIES. Commits `5b02cf3` > `641ad26`. |
| 1.38 Currency Input UX Hardening | ? ACCEPTED | `confirmation.worker.ts` (reject in-place edit), `screen-builder.ts` both apps (blockquote design), `webhook.route.ts` (`normalizeCurrencyInput` fix + `awaiting_cur` token extraction). Commits `94b7cac` > `c59f2e1`. |
| 1.39 Gate UX Ч Edit-In-Place (Variant B) | ? DEPLOYED | `ai-parse.worker.ts` (gate block: one edit-in-place instead of 2 new messages), `screen-builder.ts` both apps (`buildGatePausedPreview`: ?? alert banner + draft summary + keyboard stays). `formatAmount()` hardened: `String()` cast дл€ Postgres NUMERIC. `clarification.service.ts`: `::TEXT` cast на `parsed_amount`. Commits `8fa8f91` > `089abf6`. |
| 1.40 Dead Card Auto-Cleanup | ? DEPLOYED | `confirmation.worker.ts` (+dead_card write after reject/expired), `draft-expiration.worker.ts` (+dead_card write after CRON expire), `ai-parse.worker.ts` (+dead_card read+delete before new preview). Redis key `midas:dead_card:{chatId}` TTL 24h. Commit `51eaf10`. |
| 2.0 Transaction Hub + Reports 2.0 + Settings 2.0 | ? DEPLOYED | `transaction-list.service.ts` (NEW), `transaction-keyboard.service.ts` (NEW), `report-keyboard.service.ts` (NEW), `settings-keyboard.service.ts` (MODIFY). Interactive paginated lists, period picker, filter tabs, /edit deprecation > tx: namespace. Deployed from GitHub `main`. **[UPD d770ca4]** ‘ильтры: ¬ариант D Ч 1 р€д иконочных чипов `[??][??][??][??][?? ¬се]`. IntentFilter: 5 типов (e/i/d/t/a), 'd' = merged долги. CCY_SYMBOL + fmtCurrency(). ѕагинаци€ Ђ?? ѕозже Ј ?? X/Y Ј –аньше ??ї. |
| 2.1 Account Management Dashboard | ? DEPLOYED | `balance-keyboard.service.ts` (NEW Ч 450+ lines), `account-onboard-keyboard.service.ts` (MODIFY Ч bank/wallet presets, fiat/crypto pickers), `account.service.ts` (MODIFY Ч renameAccount, changeAccountCurrency, softDeleteAccount, deleted_at filters), `balance.service.ts` (MODIFY Ч getBalanceData, getAccountDetail, setAccountBalanceById, getAccountTxCount), `webhook.route.ts` (MODIFY Ч bl: handler, text intercepts, balance navigation update). DB migration: `updated_at` + `deleted_at` columns on `account_sources`. |
| 2.2 Settings UI Overhaul | ? DEPLOYED | `settings-keyboard.service.ts` (MODIFY Ч 6-button 2x3 grid, URL поддержки, инфо о боте), `currencies.ts` (MODIFY Ч Russian aliases, 5-pass search, FIAT 40+ / CRYPTO 48+), `settings.service.ts` (FIX Ч `deleted_at IS NULL` в `getWorkspaceAccounts`), `webhook.route.ts` (MODIFY Ч кнопка назад после выбора валюты, единый Main Account handler). Commit `3e650c1`. |
| 2.3 Search Pagination + UX Polish | ? DEPLOYED | **Pagination:** `transaction-hub.service.ts` (SEARCH_PAGE_SIZE=8, все 4 search-метода > LIMIT/OFFSET + COUNT(*) = `{items, total}`). `transaction-keyboard.service.ts` (`buildSearchResultsKeyboard(items, page, totalPages)` с ??/?? навигацией, `search_results_page` cmd, tx:sr:p:{page} parser). `webhook.route.ts` (Redis context `midas:tx:sr:ctx:{uid}:{cid}` TTL 600s, `search_results_page` handler, все text intercepts > paginated API). **Reports close:** `report-keyboard.service.ts` (?? «акрыть = `rp:cl` на всех 3 клавиатурах, type `close` в RpCallbackCmd). `webhook.route.ts` (`rp:close` handler > deleteMessage). **Keyboard order:** `screen-builder.ts` Ч Row 1: [?? Ѕаланс][?? ќтчЄт], Row 2: [?? “ранзакции][?? Ќастройки]. Commits `6da4464`, `049233d`, `70a5d41`. |
| 2.3 Onboarding UX Polish | ? DEPLOYED | **Ќет промежуточного afterCreate экрана:** после bal_input/bal_skip сразу показываетс€ `buildFinishOnboardKeyboard()` + `accountAddedText()`. **Ќова€ команда `ac:fin`:** кнопка Ђ? «авершитьї в пикере типа Ч чистит Redis, удал€ет сообщение, отправл€ет ReplyKeyboard. **Backward compat:** `ac:more` и `ac:done` обработчики сохранены (старые кнопки в чате). **»конки:** `buildStartOnboardKeyboard()` исправлен: ??>??, ?>??, ??Ќазад>??—воЄ название. **ƒефолтный счЄт:** `ac:skip` тихо создаЄт Ђ ошелЄкї (USD) если у пользовател€ 0 счетов. Commit `395e1f2`. Deploy `7089846c` Ч SUCCESS. |
| Master Roadmap Ph.1 Ч Keyboard Service | ? DEPLOYED | `account-onboard-keyboard.service.ts` (+478 строк): `CURRENCY_FLAGS` registry (40+ валют, флаги+символы: ????RUB ????USD ?BTC ?TH TON и др.), `getCurrencyFlag(code)`, `CURRENCY_NAMES` (рус. названи€). `buildPaginatedPicker()` Ч всегда 2 стрелки ???? (noop на кра€х). `buildCurrencyPickerText(name?,isCustom?)` Ч 3 ветки вывода. `buildFiatCurrencyPage()` + `buildCryptoCurrencyPage()` Ч флаговые кнопки + `?? Ќайти валюту` (ac:cur:search). `searchCurrencies(query,pool)` Ч fuzzy+транслитераци€ (rub/руб>RUB, dollar/доллар>USD). `buildNoMatchText(name,type)` + `buildNoMatchKeyboard(name,backTarget)` Ч экран Ђѕохожего банка не нашлиї с blockquote, 3 кнопки. `buildCurrencySearch*` тексты и клавиатуры. ”далены легаси: `FIAT_ITEMS`, `CRYPTO_ITEMS`, `CURRENCY_PICKER_TEXT`. Commit `35c92e0`. |
| Master Roadmap Ph.2 Ч Webhook FSM | ? DEPLOYED | `webhook.route.ts`: (1) `name_input` при fuzzy null > `buildNoMatchText`+`buildNoMatchKeyboard`, шаг `name_confirm_custom`. (2) `ac:cus:save` > `pendingName` как `isCustomName=true` > `cur_pick`. (3) `ac:cus:keep` > `name_input` retry. (4) `ac:cur:search` > `cur_search` шаг + поисковый промпт. (5) `ac:cur:list` > возврат к пагинированному списку. (6) `cur_search` text interceptor > `searchCurrencies` > результаты/no-results. (7) 3 success-screens: `{ inline_keyboard: [] }` (без кнопок). `chooseCurKeyboard()` Ч module-level helper. ¬се callback_data ?64 байт. Commit `35c92e0`. |
| 2.9 Nav Buttons Never Delete Tx Records | ? DEPLOYED | `active-message.service.ts` (NEW `sendNavMessage()` Ч always sends new message), `webhook.route.ts` (4 NAV_BTN_* handlers: NAV_BTN_BALANCE/REPORT/SETTINGS/TRANSACTIONS > `sendNavMessage`). Commit `1477f55`. |
| 2.9+ Smart Nav Message (midas:nav: key) | ? DEPLOYED | `active-message.service.ts` (полна€ переработка `sendNavMessage()` Ч edit-first через `midas:nav:`, не трогает `midas:am:`; новые функции `getNavMessageId`, `setNavMessageId`, `clearNavMessageId`). `webhook.route.ts` (импорт 2 новых функций; AI-parse path Ч cleanup `midas:nav:` перед стандартным `midas:am:` cleanup; `st:cancel` Ч silently deletes вместо редактировани€; `bl:close` Ч добавлен `clearNavMessageId`). Commits `4baac9c` > `004966f`. |
| 2.10 Transaction UI Persistence & Navigation Fixes | ? DEPLOYED | **“ри независимых фикса:** (1) `notifications.worker.ts` + `confirmation.worker.ts` + `shared/index.ts` Ч `isSuccessCard?: boolean` флаг; при approve DEL `midas:am:` вместо SET (commit `df15a01`). (2) `transaction-keyboard.service.ts` Ч `parseTxCallback`: теперь читает `parts[4]` как `from` дл€ `tx:d:ask` и `tx:d:yes` Ч контекст `:s` передаЄтс€ через весь delete flow; кнопка Ђ«акрытьї в tx:view корректно возвращает на success card (commit `8894b92`). (3) `notifications.worker.ts` Ч запись sentinel `midas:success_card:{msgId}` (TTL 30 дней) при `isSuccessCard=true`; `webhook.route.ts` step-7 Ч провер€ет `EXISTS midas:success_card:{amId}` перед `deleteMessage` Ч двойна€ блокировка удалени€ (commit `b869c03`). |
| Balance Phase A Ч Grouped UI | ? DEPLOYED | `balance-keyboard.service.ts` (NEW: `classifyAccountGroup`, `GROUP_EMOJI`, `GROUP_ORDER`, `GroupType`, `buildBalanceListKeyboard` с emoji-префиксами по группам, `export formatBalanceShort`). `balance.service.ts` (MODIFY: секционированный текст ??/??/??/??/??, удалЄн `CURRENCY_TOTALS_SQL`). Commit `4a1748c` pushed to main. Railway auto-deploy ?. |
| Balance Phase B-1 Ч DB Schema | ? DEPLOYED | `packages/database/migrations/1779800000000_account-parent-and-subtype.js` (NEW). `account_sources`: `parent_account_id VARCHAR(26) FK REFERENCES account_sources(id) ON DELETE CASCADE` (NULL=top-level), `sub_type TEXT NOT NULL DEFAULT 'general'` CHECK constraint. Partial index `idx_account_sources_parent`. Applied on Railway live DB via `node-pg-migrate up --check-order false`. Commit `75156b9`. 100% аудит: formula ? FK 31/31 ? defaults safe ? |
| Balance Phase B-2 Ч Hierarchical UI | ? DEPLOYED | `balance.service.ts` (MODIFY): `PER_ACCOUNT_SQL` + `parent_account_id`; `AccountBalanceRow` + `parentAccountId`; `getBalanceData()` builds childrenMap, renders +/L ladder for parent>children, leaf accounts unchanged. `balance-keyboard.service.ts` (MODIFY): `BalanceAccountRow` + `parentAccountId?`+`childCount?`; `BalanceCallbackCmd` + `add_currency`; `parseBalanceCallback` handles `bl:ac:{id}`; `pluralizeCurrency()` RU plural; `buildBalanceListKeyboard()` Ч parent aggregation (N валют) + indented child rows (L CURRENCY Ј balance) + ? ƒобавить валюту (bl:ac:{parentId} ?32 bytes). tsc 0 errors. Commit `d04bcba`. |
| 2.10+ Gate Fix Ч Frozen UI on Concurrent Input | ? DEPLOYED | **ѕроблема:** пользователь пишет TX1 (пикер счЄта открыт), TX2 > step-7 удал€ет пикер до того как gate установит `gate_sent` > gate присылает новую карточку. TX3 > step-7 снова удал€ет gate-карточку (gate_sent Ќ≈ провер€лс€) > ai-parse молчит (gate_sent установлен) > UI зависает. **‘икс 1:** `webhook.route.ts` step-7 строки 5446Ц5458 Ч `EXISTS midas:gate_sent:` перед deleteMessage; если активен Ч карточка и `midas:am:` не трогаютс€. **‘икс 2:** `webhook.route.ts` ia:pk: строка 1539 Ч `DEL midas:gate_sent:` после выбора счЄта > нормальный flow восстанавливаетс€. **‘икс 3:** `ai-parse.worker.ts` Ч gate реконструирует полный пикер счетов когда `accountId = null`. **∆изненный цикл gate_sent:** SET в ai-parse > DEL при ia:cancel (строка 1432, до фикса) / ia:pk: (строка 1539, Ќќ¬ќ≈) / approve/reject в confirmation.worker (строка 268, до фикса) / TTL 1h. Commit `8d25ec1`. tsc 0 ошибок. Railway ? оба сервиса Online. |

---

## 3. ѕ–»Ќя“џ≈ ј–’»“≈ “”–Ќџ≈ –≈Ў≈Ќ»я

- **Runtime:** Node.js 24 + TypeScript (ADR-001). Python Ч только изолированный микросервис позже.
- **Frontend (future):** React 19 + Vite 8. Vue отклонЄн (ADR-002).
- **Workspace:** MVP = 1 default workspace на пользовател€. Ѕƒ multi-workspace-ready с первого дн€ (ADR-003).
- **Auth:** WorkspaceMembership required. Telegram User ID = идентификатор.
- **Primary Keys:** ULID (ADR-004).
- **DB Isolation:** PostgreSQL RLS. Low-privilege DB role. `BYPASSRLS` запрещЄн.
- **Tenant Context:** `SET LOCAL app.workspace_id` только внутри `withTenantTransaction(workspaceId, fn)` (SEC-03).
- **Queue:** BullMQ (Redis-backed) (ADR-014).
- **Financial Precision:** Decimal / NUMERIC only. `Number`, `parseFloat`, `Number()`, float arithmetic запрещены (SEC-02).
- **AI Output:** Strict Zod allowlist. AI не может возвращать/контролировать системные пол€ (SEC-01).
- **Draft Lifecycle:** TransactionDraft > pending_user > approved/rejected/expired/needs_clarification.
- **Security:** SEC-01 Ч SEC-12 об€зательны дл€ Phase 1.
- **AI Pipeline (claude-client.ts + prompts.ts):**
  - ћодель: `claude-haiku-4-5`, `temperature: 0` (детерминизм), `max_tokens: 256`
  - System prompt: OUTPUT RULES > MULTILINGUAL RECOGNITION (RU/EN/UA) > FUZZY MATCHING (опечатки, сленг, транслитераци€) > BILINGUAL PAIRS (неочевидные переводы) > DISAMBIGUATION RULES (15 правил дл€ двусмысленных товаров) > COMPOUND EXPRESSIONS > DEFAULT INTENT PRIORITY > 30-категорийна€ таксономи€ (18 personal + 12 business) ? 500+ €корных товаров/услуг/брендов (—Ќ√/EU/US) > RUSSIAN LANGUAGE RULES (50+ глаголов расхода/дохода) > CATEGORY>INTENT defaults > 25+ примеров (все 5 intent-типов + partial + nonsense)
  - Markdown fence strip: Claude иногда оборачивает JSON в ` ```json `, парсер это убирает перед `JSON.parse`
  - Zod validation: strict allowlist Ч intent/amount/currency/category_hint/person_hint/account_hint/item_hint/note/confidence
  - **Category validation (Phase 1.37):** `ALLOWED_CATEGORIES` Set Ч если Claude вернул `category_hint` не из допустимого списка, замен€етс€ на `ƒругое`
  - Post-processing (safety net, ѕќ—Ћ≈ Claude): 7 групп regex с word-boundary `\b`, negation guard, confidence boost (+0.15/+0.25), intent fallback
  - –езультат: `ok` | `partial` (missing fields) | `needs_clarification` (nonsense) | `rejected`
  - **Phase 1.35:** `item_hint` (extracted product/merchant name), `category_hint` (AI category suggestion) > `CategoryResolverService` (3-stage: exact > 200+ alias map > fallback Ђƒругоеї)
  - **Phase 1.37:** Zero-clutter UX, мульти€зычна€ таксономи€, дисамбигуаци€, строга€ валидаци€ категорий
- **Deployment:** Railway (spirited-happiness) Ч Midas bot + background-workers + Postgres + Redis. Auto-deploy from GitHub main.
- **UX Architecture (Phase 1.33Ц1.36-UX) Ч ‘»ЌјЋ№Ќќ≈ –јЅќ„≈≈ —ќ—“ќяЌ»≈:**
  - Rich Screen Cards: `screen-builder.ts` pure functions > buildPreviewScreen, buildConfirmedScreen, buildClarificationScreen
  - Centralized confirmKb/confirmPreview helpers (DRY, 8 entry points)
  - Post-confirm card: `[?? »зменить запись]` only Ч nav buttons removed (handled by Reply Keyboard)
  - **Persistent Navigation:** `ReplyKeyboardMarkup` (`is_persistent: false`, `resize_keyboard: true`) Ч 2?2 grid: Row 1 `[?? Ѕаланс][?? ќтчЄт]`, Row 2 `[?? “ранзакции][?? Ќастройки]`. Sent on `/start`. NAV_BTN_* intercepted before AI parse. **(Phase 2.3: ќтчЄт и “ранзакции помен€ны местами Ч ќтчЄт теперь вверху справа)**
  - **Transaction Hub Filter Row (Variant D Ч актуально):** 1 строка ? 5 иконочных кнопок-чипов: `[??]` расходы Ј `[??]` доходы Ј `[??]` долги (merged) Ј `[??]` переводы Ј `[?? ¬се]`. јктивный фильтр: `emoji + ' ?'`. Ќажатие на активный (не Ђ¬сеї) снимает фильтр > возврат к 'a'. SQL: `'d' AND intent IN ('debt_given','debt_received')`. ѕагинаци€: `[?? ѕозже]  [?? X / Y]  [–аньше ??]`. IntentFilter: `'a' | 'e' | 'i' | 'd' | 't'`. Backward compat: `dg`/`dr` > `'d'`.
  - **Keyboard Carrier:** Greeting message `? ¬ы уже зарегистрированы...` остаЄтс€ в чате **навсегда** Ч €вл€етс€ посто€нным носителем ReplyKeyboardMarkup. Ќе удал€етс€ ни при каких услови€х.
  - **Transaction History (FINAL):**  ажда€ preview-карточка Ч это **новое** сообщение (`sendMessage`), `activeMessageId` Ќ≈ передаЄтс€ из `ai-parse.worker`. »стори€ транзакций накапливаетс€ в чате. —тарый механизм `midas:am:{userId}:{chatId}` (active-message pointer) **удалЄн** из notifications.worker.
  - **Preview>Confirmed Edit:** ѕри approve `confirmation.worker` читает `midas:preview:{draftId}` (TTL 600s) Ч message_id preview-карточки, записанный `notifications.worker` при отправке. Approve > `editMessageText(previewMsgId, confirmedText, inlineKeyboard)`. Reject > `editMessageText(previewMsgId, ? ќтменено)` (Phase 1.38 fix).
  - **Redis Keys (актуальные):**
    - `midas:preview:{draftId}` Ч message_id preview-карточки, TTL 600s. «аписывает notifications.worker. „итает и удал€ет confirmation.worker на approve и reject.
    - `midas:greet:{userId}:{chatId}` Ч сохран€етс€ в /start handler, но Ќ» ќ√ƒј не используетс€ дл€ удалени€ (код оставлен как артефакт, безвреден).
    - `midas:clar:{userId}:{chatId}` Ч intercept дл€ ввода суммы при clarification. ”дал€етс€ на confirm/reject (race condition fix).
    - `midas:clar:msg:{userId}:{chatId}` Ч message_id nonsense-сообщени€. ”дал€етс€ при следующем успешном парсе.
    - `midas:ac:{userId}:{chatId}` Ч account onboarding state, TTL 300s.
    - `midas:edit:{userId}:{chatId}` Ч edit amount intercept, TTL 300s.
    - `midas:awaiting_cur:{chatId}` Ч TTL 600s. —оздаЄтс€ когда есть сумма но нет валюты и нет `cur_set`. ’ранит `{draftId}:{workspaceId}:{userId}`. Webhook читает дл€ intercept ввода валюты.
    - `midas:cur_set:{workspaceId}` Ч флаг того, что пользователь установил базовую валюту в Ќастройках. ≈сли есть Ч валюта не запрашиваетс€.
    - `midas:gate_sent:{telegramUserId}:{chatId}` Ч флаг что gate уже сработал (TTL 1h). ѕредотвращает повторный edit при каждом новом сообщении.
    - `midas:dead_card:{chatId}` Ч message_id карточки "? ќтменено" или "? „ерновик истЄк", TTL 24h. «аписываетс€ confirmation.worker (reject/expired) и draft-expiration.worker (CRON expire). „итаетс€ и удал€етс€ ai-parse.worker при отправке следующей preview Ч карточка автоматически удал€етс€ из чата. (Phase 1.40)
     - `midas:am:{userId}:{chatId}` Ч Phase 2.10: pointer на текущее активное сообщение (черновики, пикеры счЄтов, clarification). TTL 24h. ѕри approve транзакции Ч DEL (не SET, чтобы success card не удал€лась). Step-7 в webhook.route.ts провер€ет `midas:success_card:{amId}` перед удалением.
     - `midas:success_card:{msgId}` Ч Phase 2.10: sentinel key, TTL 30 дней. «аписываетс€ `notifications.worker` при `isSuccessCard=true` (после approve). „итаетс€ step-7 в `webhook.route.ts` Ч если EXISTS, сообщение Ќ≈ удал€етс€ при вводе следующей транзакции. ƒвойна€ блокировка вместе с DEL `midas:am:`.
    - `bl:state:{telegramUserId}:{chatId}` Ч Phase 2.1: state дл€ текстовых intercepts баланс-менеджмента. ’ранит `{action, accountId}`. Actions: `rename`, `set_balance`, `currency_input`. TTL 300s.
    - `bl:source:{telegramUserId}:{chatId}` Ч Phase 2.1: флаг что добавление счЄта инициировано из баланса. ѕри `ac:done` возвращает в balance dashboard вместо setup complete.
     - `midas:tx:sr:ctx:{telegramUserId}:{chatId}` Ч Phase 2.3: поисковый контекст дл€ пагинации. ’ранит JSON `{t: 'name'|'amount'|'category'|'date', q?: string, f?: string, to?: string, lb?: string}` TTL 600s. —оздаЄтс€ при первом поиске, читаетс€ при навигации по страницам (tx:sr:p:{page}). ѕри устаревании Ч дружелюбное сообщение Ђпоиск занової.
    - `bl:source:{telegramUserId}:{chatId}` Ч Phase 2.3: при `ac:fin`/`ac:done` провер€етс€ дл€ возврата в balance dashboard вместо setup complete.
     - `midas:ac:{userId}:{chatId}` поле `pendingName` Ч Master Roadmap: временное им€ из no-match flow до подтверждени€ через `ac:cus:save`.
     - `midas:ac:{userId}:{chatId}` поле `isCustomName` Ч Master Roadmap: true если им€ счЄта Ч свободный ввод (не preset). ¬ли€ет на текст currency picker.
     - `midas:ac:{userId}:{chatId}` шаг `cur_search` Ч Master Roadmap: режим поиска валюты активен. —ледующий текст пользовател€ > `searchCurrencies()`. —нимаетс€ при `ac:cur:list` или выборе валюты.

  - **Auto-Activation:** `replyKeyboardJson` в `NotificationJobPayload`. rejection/expiry/intent_missing sends ReplyKeyboard на `sendMessage` path. `editMessageText` path Ч только inline keyboard (Telegram API limitation).
  - **Collapsibility:** `is_persistent: false` Ч Telegram показывает ? иконку р€дом с ??; пользователь может скрывать/восстанавливать клавиатуру.
  - **Race Condition Fix:** `redisConnection.del(clarKey)` на confirm/reject > stale `midas:clar:*` не перехватывает следующее сообщение.
  - **Keyboard Consistency:** Both screen-builders use ??. confirmKb: ? full-width row + [??|??] split row.

---

## 4. PROJECT_CONFIG STATUS

- `project_config.md` верси€ **v1.4**
- v1.4 включает: Phase 1.37 AI Taxonomy & Zero-Clutter UX update, 30-category taxonomy, 500+ anchors, multilingual, disambiguation, ALLOWED_CATEGORIES validation, Phase 2.0 documented
- SEC-01 Ч SEC-12 = об€зательные ограничени€ реализации Phase 1
- **?? «јЅЋќ »–ќ¬јЌ** Ч изменение только по пр€мому приказу владельца

---

## 5. PHASE 1.1 Ч –≈«”Ћ№“ј“

**—татус:** ? COMPLETED

—оздан Turborepo monorepo `midas-monorepo/`:

```
midas-monorepo/
+-- apps/
¶   +-- telegram-bot/          # @midas/telegram-bot
¶   L-- background-workers/    # @midas/background-workers
+-- packages/
## 6. “≈ ”ўјя ‘ј«ј Ч PHASE 1.30: Smart Account Onboarding

> ? **COMPLETED / ACCEPTED (Phase 1.30). See Section 10 history.**

**Objective:**
Replace the flat "—четов пока нет." empty-state with a guided interactive keyboard when /accounts is empty (Scenario ƒ) and show a guided account setup keyboard for new users after /start (Scenario ≈). UX layer only Ч no migration, no new commands, no AI changes.

**Key decisions:**
- `account-onboard-keyboard.service.ts` (NEW): `ac:` callback namespace, all payloads ? 17 bytes (? 64 limit). `parseAccountCallback()` validates against strict allowlist (SEC-01). Keyboards: type picker, exchange presets (5 + custom), currency shortcuts (6 + custom), post-create.
- `account.service.ts` (MODIFY): `hasAccounts()` added Ч lightweight COUNT query, no signature change to existing functions. `addAccountWithCurrency()` added Ч accepts explicit currency, type always 'manual'.
- `webhook.route.ts` (MODIFY): `ac:` callback handler block (before `ed:`), `/accounts` empty-state detection via `hasAccounts()`, `/start` for new users sends `buildStartOnboardKeyboard()`, text intercept for `midas:ac:` state (before edit-amount intercept).
- Redis state `midas:ac:{telegramUserId}:{chatId}` TTL 300s Ч isolates name_input and cur_input steps from AI parse.
- Onboarding DB function (`system_find_or_create_user`) untouched Ч default account still created for new users.
- `[? ѕропустить]` button on /start guided keyboard Ч clears state, no account created.
- Cash auto-name: "Ќаличные {CURRENCY}" derived at creation time.
- Exchange presets: Binance, Bybit, OKX, Kraken, Huobi + ?? ƒруга€.

**Scope Ч 3 files changed:**
- `apps/telegram-bot/src/services/account-onboard-keyboard.service.ts` (NEW Ч 240 lines)
- `apps/telegram-bot/src/services/account.service.ts` (MODIFY Ч hasAccounts + addAccountWithCurrency)
- `apps/telegram-bot/src/routes/webhook.route.ts` (MODIFY Ч ac: handler, /accounts empty-state, /start guided, text intercept)
- `packages/database/smoke-test-phase130.mjs` (NEW Ч 64 tests)

---

## 7. MCP SERVERS & INFRASTRUCTURE (Production)

### ѕодключЄнные MCP-серверы

| MCP-сервер | —татус | Ќазначение |
|---|---|---|
| **Railway MCP** | ? Active | ƒеплой, логи, переменные, сервисы. Project: `spirited-happiness`. |
| **GitHub MCP** | ? Active | Repo: `gloryjasystem/Midas`. Auto-deploy on push to `main`. |
| **Postgres MCP** | ? Active | Read-only SQL к production DB через Railway proxy. |
| **Filesystem MCP** | ? Active | „тение/запись файлов в workspace `C:\Users\secvency\Desktop\Midas` |

### Railway Infrastructure

| —ервис | –оль | ƒомен |
|---|---|---|
| **Midas** | Telegram Bot (Fastify webhook) | `midas-production-f4f1.up.railway.app` |
| **background-workers** | BullMQ workers (ai-parse, confirm, notify, draft-expire, webhook) | Internal only |
| **Postgres** | PostgreSQL 17 (managed) | `postgres.railway.internal:5432` |
| **Redis** | BullMQ + state (Redis 7) | `redis.railway.internal:6379` |

###  лючевые переменные (Railway Dashboard)

| ѕеременна€ | √де | ѕримечание |
|---|---|---|
| `DATABASE_URL` | Midas + background-workers | `postgres.railway.internal` (internal) |
| `REDIS_URL` | Midas + background-workers | `redis.railway.internal` |
| `TELEGRAM_BOT_TOKEN` | Midas | ?? “ребует ротации (был виден в логах) |
| `ANTHROPIC_API_KEY` | background-workers | ?? “ребует ротации |
| `TELEGRAM_WEBHOOK_SECRET` | Midas | `midas_wh_secret_2026_prod` |

---

## 8. ‘ј…Ћџ ƒЋя „“≈Ќ»я ¬ Ќќ¬ќћ „ј“≈ (Phase Balance-B-2 context)

**? “≈ ”ў»…  ќЌ“≈ —“: Balance Redesign Phase A ? + B-1 ?. —ледующа€ Ч Phase B-2 (лесенка в getBalanceData + агрегаци€ дочерних счетов).**

**ќЅя«ј“≈Ћ№Ќќ прочитать в новом чате:**
```
apps/telegram-bot/src/services/balance-keyboard.service.ts   < √руппировка, buildBalanceListKeyboard
apps/telegram-bot/src/services/balance.service.ts            < PER_ACCOUNT_SQL, getBalanceData
packages/database/migrations/1779800000000_account-parent-and-subtype.js < —хема B-1
```

**Ќ≈ „»“ј“№ (не нужны дл€ Phase B-2):**
```
apps/telegram-bot/src/services/report.service.ts
apps/telegram-bot/src/services/transaction-list.service.ts
apps/background-workers/*
packages/database/smoke-test-phase*.mjs
```

**—осто€ние Ѕƒ (проверено SQL-аудитом):**
- `parent_account_id` Ч все NULL (все счета top-level, иерархи€ ещЄ не заполнена)
- `sub_type` Ч все `'general'` (Phase A использует эвристику `classifyAccountGroup`)
- 31 транзакци€, формула баланса проверена (initial_balance + income ? expense)

---

## 9. ѕ–ќћѕ“ ƒЋя —“ј–“ј Ќќ¬ќ√ќ „ј“ј

```
? Balance Redesign Ч Phase A ? + Phase B-1 ? «ј¬≈–Ў≈Ќџ. —ледующа€ Ч Phase B-2.

ѕ–ќ≈ “:
Midas Telegram Bot. Railway (project: spirited-happiness). MCP: Railway, GitHub, Postgres, Filesystem.
Auto-deploy: push to main > GitHub > Railway строит Midas + background-workers.

„“ќ ”∆≈ —ƒ≈ЋјЌќ:

Phase A (commit 4a1748c, задеплоен):
- balance-keyboard.service.ts: classifyAccountGroup(эвристика по name/currency),
  GROUP_EMOJI (??/??/??/??/??), buildBalanceListKeyboard с группами, export formatBalanceShort
- balance.service.ts: секционированный текст getBalanceData(), удалЄн CURRENCY_TOTALS_SQL

Phase B-1 (commit 75156b9, применено на live Railway Postgres):
- migration 1779800000000_account-parent-and-subtype.js:
  parent_account_id VARCHAR(26) FK (NULL=top-level счЄт)
  sub_type TEXT NOT NULL DEFAULT 'general' CHECK(card|cash|crypto_exchange|crypto_wallet|bank_account|general)
  idx_account_sources_parent (partial index)

100% ј”ƒ»“ “–јЌ«ј ÷»…:
- ‘ормула initial_balance + income ? expense Ч верна (проверено на реальных данных)
- FK-целостность: 31/31 транзакций св€заны с существующими счетами
- draft-confirmation.service.ts (transaction INSERT) Ч не затронут нашими изменени€ми

„“ќ Ќ”∆Ќќ —ƒ≈Ћј“ь (‘аза B-2):

1. balance.service.ts Ч обновить PER_ACCOUNT_SQL:
   - ƒобавить parent_account_id в SELECT
   - —троить дерево в getBalanceData(): parent счета + несколько children
   - ќформить отображение с лесенкой: + OKX USDT Ј 32 601 / L OKX BTC Ј 0.5

2. balance-keyboard.service.ts Ч обновить buildBalanceListKeyboard:
   - Parent-счЄт: показывать агрегацию ("количество валют")
   - Child-счЄт: отступ + другие эмодзи
   - ЅќЌ”—: кнопка "? ƒобавить валюту" (bl:ac:{parentId})

 Ћё„≈¬џ≈ ѕ–ј¬»Ћј:
- ‘инансова€ математика: “ќЋ№ ќ BigInt/NUMERIC, никаких float (SEC-02)
- ¬се мутации через withTenantTransaction (SEC-03)
- Ќе трогать project_config.md
- Ќе мен€ть draft-confirmation.service.ts Ч транзакции работают идеально

ќЅя«ј“≈Ћ№Ќќ прочитать workflow_state.md –аздел 16 (роадмап) и ‘азу B-2 план.
```


## 10. »—“ќ–»я ƒ≈…—“¬»… (—∆ј“јя)

| ƒата | —обытие |
|---|---|
| 2026-05-04 14:07 | »нициализаци€ проекта: project_config.md v1.0 + workflow_state.md |
| 2026-05-04 14:45 | Phase 0.1 Event Storming completed (46 событий, 10 агрегатов, 15 ADR planned) |
| 2026-05-04 15:08 | Phase 0.2 ADR completed (15 ADR: ADR-000ЧADR-014). project_config.md > v1.1 |
| 2026-05-04 15:45 | Phase 0.3 Readiness Gate completed (scope, DB model, queue model, acceptance criteria) |
| 2026-05-04 17:02 | Security review: 2 CRITICAL, 2 HIGH > Phase 0.3.1 запущена |
| 2026-05-04 17:15 | Phase 0.3.1 Security Patch completed (SEC-01ЧSEC-12). project_config.md > v1.2 |
| 2026-05-04 18:30 | Client roadmap document created: `docs/client-roadmap-architecture-overview.md` |
| 2026-05-04 21:12 | Phase 1.1 approved and started |
| 2026-05-04 21:17 | Phase 1.1 completed: monorepo, Docker, ESLint, TypeScript Ч 8/8 typecheck passed |
| 2026-05-04 22:34 | Context checkpoint: workflow_state.md compressed for new chat handoff |
| 2026-05-05 09:53 | Git init fixed: repo moved from `C:/Users/secvency` > `Midas/`. Initial commit `cc91a47f` |
| 2026-05-05 10:22 | Docker readiness: port 5432 conflict resolved, `docker-compose.yml` volume path fixed for postgres:18 |
| 2026-05-05 12:05 | Section 11 (Agent Operating Protocol, 13 sub-protocols) added to workflow_state.md |
| 2026-05-05 12:11 | Self-audit applied: C1, C2, M1, M2, L2 fixes + Section 14 added |
| 2026-05-05 12:55 | Phase 1.2 Database Foundation completed & accepted via Review Gate. Minor observation: onboarding workspace spam requires app-layer rate limiting. |
| 2026-05-05 14:30 | Phase 1.3 BullMQ Task Queue Foundation completed & accepted. 13/13 typecheck+lint passed (0 errors). |
| 2026-05-05 19:30 | Phase 1.4 Verification Gate FULL PASS (7/7 smoke tests). Bugs fixed: BullMQ jobId `:` > `\|` separator, `/health` excluded from SEC-04 guard. Commit `6e0cfa1` pushed. |
| 2026-05-05 19:35 | Phase 1.4 ACCEPTED by owner. **Prod note:** Redis must use `noeviction` policy in production; `allkeys-lru` is acceptable only for local dev. |
| 2026-05-05 19:40 | workflow_state.md cleanup: stale Phase 1.2/1.4 references corrected in Sections 6Ц9. Sections now describe Phase 1.5 scope, MCP needs, required files, and handoff prompt. No code written. |
| 2026-05-05 19:45 | Phase 1.5 scope narrowed by owner: User Onboarding & Workspace Resolution only. Removed from scope: callback_query, /add /balance /report /category, CRON, AI, full notifications. Sections 6, 8, 9 updated. |
| 2026-05-05 20:00 | Phase 1.5 implementation complete. `findOrCreateUser` (atomic, ON CONFLICT race-safe), `resolveWorkspace` real DB, `/start` handler, Redis anti-spam, `sendMessage` wrapper. 13/13 typecheck+lint pass. Commit `8f88f22`. |
| 2026-05-05 20:30 | Phase 1.5 Verification Gate PASS (39/39 smoke tests). Fix applied: RLS chicken-and-egg Ч `midas_app` cannot INSERT into `workspaces` without a pre-existing `workspace_memberships` row. Added migration `1777973900000`: `system_find_or_create_user` SECURITY DEFINER (executes as `midas_migrator`, exempt from RLS; `pg_advisory_xact_lock` for race safety). **Documentation note:** SECURITY DEFINER onboarding pattern was introduced in Phase 1.2 migration (`1777973795878_rls-and-policies.js`) as `system_create_onboarding_workspace` but is not covered by any existing ADR. ADR-009 covers Exchange Rate Snapshot only. A future ADR documenting the SECURITY DEFINER onboarding bootstrap pattern is recommended. Commits `b60f7ac`, `9307800` pushed. |
| 2026-05-05 20:35 | Phase 1.5 ACCEPTED by owner. Status set to WAITING_FOR_OWNER_APPROVAL_TO_START_PHASE_1_6. |
| 2026-05-05 21:00 | Phase 1.6-A AI Parse Pipeline implementation complete. `parseTransaction()` (Claude Haiku + Zod strict allowlist SEC-01), `createDraft()` (withTenantTransaction SEC-03), date-scoped AI budget guard SEC-09, SEC-12 `job.updateData('[REDACTED]')` + `removeOnFail: { age: 86400 }`. Commit `305e0f6`. |
| 2026-05-05 21:30 | Phase 1.6-A Final Acceptance Check. Fix: NUMERIC(19,4) boundary Ч regex `\d*` > `\d{0,14}` caps integer part at 15 digits. 73/73 smoke tests pass. 13/13 typecheck+lint pass. Commit `7b393d2` pushed. Phase 1.6-A ACCEPTED. |
| 2026-05-05 22:55 | Phase 1.6-B HitL Draft Confirmation implementation complete. `draft-confirmation.service.ts` (SELECT FOR UPDATE SKIP LOCKED), `confirmation.worker.ts`, `callback-confirm-queue.ts`, `webhook.route.ts` callback_query handler (ULID validation, SEC-03/06), real Telegram `sendMessage` with inline keyboard. 30/30 smoke tests PASS (incl. mandatory race condition test: parallel approve ? 2 > exactly 1 Transaction). Phase 1.6-A regression: 73/73 PASS. 13/13 typecheck+lint clean. Commit `d49625b` pushed. **Status: READY_FOR_OWNER_ACCEPTANCE.** Note: CRON draft expiration (SEC-08) intentionally deferred to Phase 1.7. No SEC-08 claim in Phase 1.6-B. |
| 2026-05-05 19:07 | Phase 1.6-B Final Acceptance Audit run (agent self-audit). All checks PASS: SEC-03 tenant isolation ?, atomic approval ?, race condition ?, rejection no-op ?, UNIQUE constraint ?, no SEC-08 false claim ?. workflow_state.md ACCEPTED wording corrected to READY_FOR_OWNER_ACCEPTANCE. Awaiting owner decision. |
| 2026-05-05 21:14 | Phase 1.6-B ACCEPTED by owner after Final Acceptance Audit PASS WITH FIXES. Code unchanged. 30/30 Phase 1.6-B smoke tests PASS, 73/73 Phase 1.6-A regression PASS, 13/13 typecheck/lint PASS. Commit `f205e09` pushed. CRON expiration (SEC-08) intentionally deferred to Phase 1.7. |
| 2026-05-05 21:32 | Phase 1.7 ACCEPTED by owner. `system_expire_pending_drafts()` owner fixed to `midas_migrator`; `search_path = public, pg_catalog` fixed; EXECUTE revoked from PUBLIC; 20/20 smoke tests PASS; 13/13 typecheck+lint PASS; git pushed and clean. Commit `49e0cec`. |
| 2026-05-05 22:30 | Phase 1.8-A Transaction Intent Foundation implementation complete. Migration `1778008338096_transaction-intent.js`: `parsed_intent` (nullable TEXT + CHECK) added to `transaction_drafts`; `transaction_intent` (NOT NULL TEXT + CHECK, backfilled 'expense', no DEFAULT) added to `transactions`. `draft.service.ts`: `AiOutput.intent` propagated to `parsed_intent`. `draft-confirmation.service.ts`: `parsed_intent` fetched in SELECT FOR UPDATE, new `intent_missing` outcome if NULL, `transaction_intent` written to transactions INSERT (explicit, no default). `confirmation.worker.ts`: `intent_missing` case handled with user message. 19/19 Phase 1.8-A tests PASS. 20/20 Phase 1.7 regression PASS. 30/30 Phase 1.6-B regression PASS. 73/73 Phase 1.6-A regression PASS. 13/13 typecheck+lint PASS. Traceability ? Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-05 23:39 | Phase 1.8-A ACCEPTED by owner after independent verification. Local and origin/main both at `51b6aee`. Implementation commit `425df61`. Migration `1778008338096_transaction-intent.js` tracked in git. Live DB verified: `parsed_intent` nullable, `transaction_intent` NOT NULL, no DEFAULT, CHECK constraints confirmed for exactly 5 values. 155/155 tests PASS (19 Phase 1.8-A + 20 Phase 1.7 + 30 Phase 1.6-B + 73 Phase 1.6-A + 13 typecheck+lint). No cleanup needed. |
| 2026-05-05 23:50 | Phase 1.8-B Runtime Consistency & Security Hardening implementation complete. C-1 fix: `draft.service.ts` L41 `telegram_user_id`>`telegram_id` (critical runtime bug Ч would crash every AI parse job). C-2 fix: migration `1778008400000_harden-onboarding-search-path.js` Ч `SET search_path = 'public', 'pg_catalog'` added to `system_create_onboarding_workspace` and `system_find_or_create_user`. M-1 fix: `shared/index.ts` `TRANSACTION_TYPE` updated from 3 stale values to 5 canonical intent values. 16/16 Phase 1.8-B tests PASS. 19/19 Phase 1.8-A PASS. 20/20 Phase 1.7 PASS. 30/30 Phase 1.6-B PASS. 73/73 Phase 1.6-A PASS. 13/13 typecheck+lint PASS. Total: 171/171. Traceability ? Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 00:02 | Phase 1.8-B ACCEPTED by owner after PASS. C-1: resolveUserId fixed `telegram_user_id`>`telegram_id`. C-2: onboarding SECURITY DEFINER functions hardened with `search_path = public, pg_catalog`. M-1: `TRANSACTION_TYPE` updated to canonical 5 intent values. 171/171 tests PASS. origin/main at `7af1692`. Working tree clean. |
| 2026-05-06 00:07 | workflow_state.md cleanup after Phase 1.8-B acceptance. Stale Sections 6Ц9 corrected: Section 6 updated to Phase 1.8-B results; Section 7 set to advisory-only MCP access; Section 8 refreshed with advisory file list; Section 9 updated with COMPLETED/ACCEPTED handoff. No code changes. |
| 2026-05-06 00:27 | Phase 1.9 Basic Text /report Command implementation complete. `report.service.ts`: monthly report grouped by `transaction_intent`, `SUM(base_amount)` via NUMERIC, UTC month boundaries, Russian text output. `webhook.route.ts`: `/report` command intercepted before AI parse, resolves workspace+userId, calls report service. `workspace-resolver.ts`: `userId` added to `WorkspaceResolverResult`. Defense-in-depth: explicit `WHERE workspace_id = $1` alongside RLS. 47/47 Phase 1.9 tests PASS. 16/16 Phase 1.8-B PASS. 19/19 Phase 1.8-A PASS. 20/20 Phase 1.7 PASS. 30/30 Phase 1.6-B PASS. 73/73 Phase 1.6-A PASS. 13/13 typecheck+lint PASS. Total: 218/218. Traceability ? Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 09:08 | workflow_state.md sync after Phase 1.9 implementation. Sections 1, 2, 6Ц9 corrected: Section 1 set to WAITING_FOR_OWNER_ACCEPTANCE_OF_PHASE_1_9; Section 2 Phase 1.9 row expanded with full artifact paths; Section 6 updated to Phase 1.9 results; Section 7 set to acceptance-audit-only MCP access; Section 8 refreshed with Phase 1.9 audit file list; Section 9 updated with acceptance handoff. No code changes. |
| 2026-05-06 10:00 | Phase 1.9 ACCEPTED by owner after final verification. Full test run: 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 218/218 PASS. Git clean pre/post tests. origin/main in sync. project_config.md unchanged (v1.2). Section 14 self-audit: all ?. Committed workflow_state.md, pushed tag phase-1.9-accepted. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 11:45 | Phase 1.10 Slash-Command Guard + Inline /help implementation complete. `parseCommandToken()` (exact first-token, @BotName strip), `KNOWN_COMMANDS` set, `/help` handler (Russian, lists /start /report /help), unknown-slash guard (5e). No command-registry, no new deps, no migrations, no AI changes. 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 248/248 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 11:55 | Phase 1.10 ACCEPTED by owner after final acceptance verification. Full test run: 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 248/248 PASS. Git clean pre/post tests. origin/main in sync. project_config.md unchanged (v1.2, last touched cc91a47). Commit b321463: 3 files only (webhook.route.ts, smoke-test-phase110.mjs, workflow_state.md). No command-registry.ts, no /balance, no migrations, no new deps. Section 14 self-audit: all ?. Tag phase-1.10-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 12:18 | Phase 1.11 /category Read-Only List Command implementation complete. `category.service.ts`: `getCategoryList()` read-only, `withTenantTransaction`, explicit `WHERE workspace_id = $1`, grouped by `category_group` (`Ѕизнес` before `∆изнь`), Russian pluralization, empty-state message. `webhook.route.ts`: `/category` added to KNOWN_COMMANDS (4 commands), HELP_TEXT updated, handler block added after `/report`. DB audit: RLS `tenant_isolation_categories` (`cmd: ALL`) ?; `account_sources` not seeded on onboarding (debt item, no fix in Phase 1.11). 78/78 Phase 1.11 + 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 326/326 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 13:50 | Phase 1.11 ACCEPTED by owner after final verification. /category read-only command implemented; no write path, no migrations, no new deps, no AI changes. Final independent verification: 78/78 Phase 1.11 + 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 326/326 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit 2e77362. Tag phase-1.11-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 17:20 | Phase 1.12 Onboarding Default Data Seeding implementation complete. Currency finding: `workspaces.default_currency DEFAULT 'RUB'` confirmed Ч no hardcoding beyond existing onboarding pattern. Migrations: `1778100000000_onboarding-default-seed.js` (7-param SECDEF function) + `1778100010000_fix-onboarding-seed-conflict.js` (PL/pgSQL ON CONFLICT ambiguity fix using named constraint). `onboarding.service.ts` extended to pass candidateAccountId + candidateCategoryId ($6/$7). Lazy fallback in `draft-confirmation.service.ts` preserved untouched (defense-in-depth). No route changes, no new slash commands, no queue/worker changes, no AI changes, no new deps. DB audit: 157 workspaces, 71 missing account_sources, 55 missing categories Ч no backfill (lazy fallback covers them). 37/37 Phase 1.12 + 78/78 Phase 1.11 + 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 363/363 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 17:45 | workflow_state.md test-count fix: 344/344 > 363/363 (Phase 1.8-A 19 tests omitted from arithmetic sum). Commit 1b9a32a. No code changes. |
| 2026-05-06 18:40 | Phase 1.13 /add_category Strict-Format Command implementation complete. `category.service.ts`: `parseAddCategoryArgs()` (group case-insensitive normalization via ALLOWED_GROUPS, name trim+length validation), `resolveGroup()`, `addCategory()` (withTenantTransaction, INSERT ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING, ULID id, returns 'created'\|'duplicate'), `AddCategoryResult` type. `webhook.route.ts`: KNOWN_COMMANDS 4>5, HELP_TEXT updated with /add_category line + groups + example, handler `5e-add` (parseAddCategoryArgs > resolveWorkspace > addCategory > Russian reply; duplicate: Ђ атегори€ с таким именем уже существует.ї). No migrations, no new deps, no AI changes. Empty-state /category message updated. midas_app RLS WITH CHECK verified via separate appPool in Test 8. 74/74 Phase 1.13 + 37/37 Phase 1.12 + 78/78 Phase 1.11 + 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 437/437 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `eac55a9`. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 19:22 | Phase 1.14 /accounts Read-Only List Command implementation started. Owner APPROVED. |
| 2026-05-06 19:35 | Phase 1.14 implementation complete. `account.service.ts` (NEW): `getAccountList()` (withTenantTransaction, explicit WHERE workspace_id = $1, flat list ORDER BY type name, Russian labels, pluralization, empty-state). `webhook.route.ts`: KNOWN_COMMANDS 5>6, HELP_TEXT updated, handler `5d-acc`. `smoke-test-phase114.mjs`: 70 tests PASS. No migrations, no new deps, no AI/queue changes. 70/70 Phase 1.14 + 437/437 regression + 13/13 typecheck+lint = 507/507 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Implementation commit `362b05b`. |
| 2026-05-06 19:46 | Phase 1.14 ACCEPTED by owner after final verification. /accounts read-only command implemented; 507/507 tests PASS; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit `362b05b`. HTML escaping for account/category names must be considered before implementing user-controlled write paths such as /add_account. Tag `phase-1.14-accepted` pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 21:32 | Phase 1.15 HTML Escaping Hardening implementation complete. Owner APPROVED. `html-escape.ts` (NEW): `escapeHtml()` Ч 5 chars escaped (`&`, `<`, `>`, `"`, `'`). `account.service.ts`: `escapeHtml` on `row.name`, `resolveTypeLabel(row.type)`, `row.currency`. `category.service.ts`: `escapeHtml` on category names, group labels, and `groupToken` in unknown-group error message (Traceability fix). `webhook.route.ts`: `escapeHtml` on `parsed.canonicalGroup` and `parsed.name` in `/add_category` success message. `smoke-test-phase115.mjs`: 52/52 PASS. No migrations, no new deps, no AI/queue changes. 52/52 Phase 1.15 + 494/494 regression smoke tests + 13/13 typecheck+lint = 559/559 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 21:56 | workflow_state.md test-count fix: 557/557 > 559/559 (final audit confirmed actual total; prior count incorrectly treated 507 as pure smoke-test baseline, double-counting 13 typecheck+lint tasks). Correct breakdown: 52 (Ph1.15) + 494 (Ph1.6-A through Ph1.14 smoke) + 13 (typecheck+lint) = 559. No code changes. |
| 2026-05-06 22:04 | Phase 1.15 accepted after final verification and workflow_state test-count fix; HTML escaping hardening implemented; 559/559 tests passed; Traceability Review PASS WITH FIXES; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 4f63a91; workflow_state sync commit 88ebae3; test-count fix commit 45b1eec. Tag phase-1.15-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 22:50 | Phase 1.16 account_sources UNIQUE Constraint Migration implementation complete. Owner APPROVED. Migration `1778200000000_account-sources-unique-name.js`: `up()` pre-flight duplicate check (0 found > safe) + `ALTER TABLE account_sources ADD CONSTRAINT account_sources_workspace_id_name_key UNIQUE(workspace_id, name)`. `down()` uses DROP CONSTRAINT IF EXISTS. `smoke-test-phase116.mjs`: 24/24 PASS. No TypeScript/route/service/worker/AI changes. 24/24 Phase 1.16 + 559/559 regression + 13/13 typecheck+lint = 583/583 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 22:46 | Phase 1.16 accepted after final verification; account_sources UNIQUE(workspace_id, name) constraint implemented; 583/583 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 3ad45e3. Tag phase-1.16-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-06 23:05 | Phase 1.17 /add_account Strict-Format Command implementation complete. Owner APPROVED. `account.service.ts` (MODIFY): `parseAddAccountArgs()` (first-space split, trim, empty check, max 100 char guard), `addAccount()` (withTenantTransaction, INSERT INTO account_sources VALUES ... 'manual'::account_source_type, 'RUB' ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING RETURNING id, returns created/duplicate), `AddAccountResult` type, `monotonicFactory` ULID. `webhook.route.ts` (MODIFY): KNOWN_COMMANDS 6>7, HELP_TEXT updated (`/add_account <название> Ч ƒобавить счЄт`), handler `5e-add-acc` (parseAddAccountArgs > resolveWorkspace > addAccount > duplicate Russian message / success `escapeHtml` reply). `smoke-test-phase117.mjs` (NEW): 27/27 PASS. No migrations, no new deps, no AI/queue changes. 27/27 Phase 1.17 + 583/583 regression + 8/8 typecheck + 8/8 lint = 610/610 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-06 23:24 | Phase 1.17 accepted after final verification; /add_account strict-format command implemented; 610/610 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 8c370e3. Tag phase-1.17-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 00:08 | Phase 1.18 accepted after final verification; /report now shows base_currency labels and groups by transaction_intent + base_currency; smoke-test-phase19 runReportQuery() helper synced to production SQL; smoke-test-phase118.mjs (34 tests) added; 644/644 tests passed (34 Ph1.18 + 47 Ph1.9 + 563 Ph1.6-AЦPh1.17 + 13 typecheck+lint); Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 700a244. Tag phase-1.18-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 02:00 | Phase 1.19 account_sources.currency CHECK Constraint implementation complete. Owner APPROVED. Migration `1778300000000_account-sources-currency-check.js` (NEW): pre-flight check (0 invalid rows found in 553 existing rows) + `ALTER TABLE account_sources ADD CONSTRAINT account_sources_currency_check CHECK (currency ~ '^[A-Z]{3,5}$')`. `smoke-test-phase119.mjs` (NEW): 24/24 PASS Ч constraint existence, type, definition, valid codes (RUB/USD/EUR/GBP/BTC/ETH/USDT), invalid rejection (empty/lowercase/digits/spaces/6-char/2-char), no backfill, scope guard. No TypeScript/route/dep/AI/queue changes. 24/24 Phase 1.19 + 644/644 regression + 13/13 typecheck+lint = 668/668 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 02:25 | Phase 1.19 accepted after final verification; account_sources.currency CHECK constraint added with regex ^[A-Z]{3,5}$; 668/668 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 9d288bd. Tag phase-1.19-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 09:40 | Phase 1.20 Balance Semantics Design Document complete. Owner APPROVED. docs/balance-semantics.md created: 6 design decisions D1ЦD6 with recommended options (D1=A standard signed formula, D2=A integrated debt, D3=B transfer neutral, D4a=Yes add initial_balance, D4b=Yes allow negative, D4c=Yes account currency implicit, D4d=No defer initial_balance_at, D5=B per-account breakdown, D6=A all-time). Traceability ? Adversarial Security ? Scope Guard ?. No TypeScript, no migrations, no new commands. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 09:45 | Phase 1.20 ACCEPTED by owner. D1ЦD6 all confirmed as recommended. Owner Choice column filled in docs/balance-semantics.md. Approved formula and schema changes documented. No code, no migrations, no DB changes made in this phase. Tag phase-1.20-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 10:00 | Phase 1.21 Unified Balance Implementation complete. Owner APPROVED. Files: migrations/1778400000000_account-sources-initial-balance.js (NEW, migration applied, initial_balance NUMERIC(19,4) NOT NULL DEFAULT 0), balance.service.ts (NEW, two-query NUMERIC arithmetic in SQL, withTenantTransaction, escapeHtml), webhook.route.ts (MODIFY, /balance handler added, KNOWN_COMMANDS 7>8, HELP_TEXT updated). smoke-test-phase121.mjs (NEW, 28/28 PASS). 28/28 Phase 1.21 + 655/655 regression smoke (Ph1.6-AЦPh1.19) + 13/13 typecheck+lint = 696/696 PASS (corrected from 709/709; Phase 1.5 server-dependent tests excluded from baseline, same as all prior phases). Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 10:15 | Phase 1.21 accepted after final verification; initial_balance migration and /balance command implemented; actual applicable tests 696/696 passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 976418a; note: stale /balance comment in webhook.route.ts line 31 is cosmetic tech debt, not fixed in this acceptance step. Tag phase-1.21-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 10:30 | Phase 1.22 Stale Comment Cleanup implementation complete. Owner APPROVED. `webhook.route.ts` (MODIFY, comment-only): slash-command routing header updated Ч Phase 1.21 added to phase refs, all 8 known commands listed, stale У(e.g. /balance)Ф example removed. 0 logic changes. 13/13 typecheck+lint PASS. 696/696 regression baseline unchanged. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 10:35 | Phase 1.22 accepted after final verification; stale /balance comment in webhook.route.ts fixed; comment-only change; 13/13 typecheck+lint PASS; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit d2ea3fd. Tag phase-1.22-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 14:00 | Phase 1.23 /set_balance implementation complete. Owner APPROVED. `setBalance.service.ts` (NEW): `parseSetBalanceArgs()` (last-token-as-amount, AMOUNT_REGEX 15-digit cap, SEC-02), `setAccountBalance()` (LOWER() exact match, formula `new_initial_balance = target ? SUM(txns)` in PostgreSQL NUMERIC, withTenantTransaction SEC-03, defensive undefined guard replacing `!` non-null assertion), `formatSetBalanceResult()` (escapeHtml for all user strings). `webhook.route.ts` (MODIFY): import 3 functions from setBalance.service.js, KNOWN_COMMANDS 8>9, HELP_TEXT updated with /set_balance line, handler `5c-setbal` added (parseSetBalanceArgs > resolveWorkspace > setAccountBalance > formatSetBalanceResult). `smoke-test-phase123.mjs` (NEW): 34/34 PASS Ч Groups A (10 parse tests), B (12 DB formula tests including negative/idempotent/resync/precision), C (8 security/scope tests), D (4 regression). 13/13 typecheck+lint PASS. No migrations, no new tables, no transactions created, no /report changes. Commit 65a8e56 pushed. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 14:51 | Phase 1.23 accepted after final verification; /set_balance implemented; synchronizes account balance by recalculating account_sources.initial_balance; no transactions created; no categories used; /report unaffected; 730/730 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 65a8e56; workflow_state sync commit 6b1df77. Tag phase-1.23-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 15:15 | Phase 1.24 Default Currency RUB > USDT implementation complete. Owner APPROVED. Migration 1778500000000_default-currency-usdt.js (NEW): ALTER TABLE workspaces SET DEFAULT 'USDT' + CREATE OR REPLACE FUNCTION system_find_or_create_user (7-param) with 'USDT' for workspace and account_sources INSERTs. ccount.service.ts (MODIFY): addAccount() reads workspace.default_currency dynamically via SELECT inside withTenantTransaction (SEC-03) Ч fallback 'USDT'. smoke-test-phase112.mjs (MODIFY): 1 assertion USDT. smoke-test-phase117.mjs (MODIFY): doc comment + assertion updated. smoke-test-phase124.mjs (NEW): 20/20 PASS. No backfill. 1184 RUB workspaces untouched. 13/13 typecheck+lint PASS. 20/20 Phase 1.24 + 717/717 regression smoke (Ph1.6-AЦPh1.23) + 13/13 typecheck+lint = 750/750 PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 15:54 | Phase 1.24 accepted after final verification; default currency changed from RUB to USDT for new users; system_find_or_create_user creates USDT workspace and Default account; /add_account now uses workspace.default_currency dynamically; existing users/workspaces/transactions were not backfilled or recalculated; 750/750 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 97a4331. Tag phase-1.24-accepted pushed. |
| 2026-05-07 17:26 | Phase 1.25 accepted after final verification; /settings text mode implemented; timezone column added; default_currency and timezone settings supported; draft fallback now uses workspace.default_currency instead of hardcoded USD; existing transactions/accounts were not recalculated or backfilled; 782/782 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit f6307a1; test fix commit 2eaccc7; workflow sync commit f79dc7b. Tag phase-1.25-accepted pushed. |
| 2026-05-07 18:03 | Phase 1.26 accepted after final verification; /settings UI with inline keyboards implemented; stablecoins/crypto/fiat pagination added; Redis-backed search state with strict TTL implemented securely; timezone UI deferred; 100 currency constants isolated; 827/827 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit fb338db; docs fix commit d8d896b. Tag phase-1.26-accepted pushed. |
| 2026-05-07 18:33 | Phase 1.27 accepted after final verification; /balance currency-mixing defect fixed via SQL-level exclusion where transactions.base_currency != account_sources.currency; mismatch warning footnote added; roadmap output format improved; no conversion, no backfill, no migration, no /report changes; 854/854 tests passed; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 12e70d9; docs fix commit dec0a52. Tag phase-1.27-accepted pushed. |
| 2026-05-07 19:25 | Phase 1.28 accepted after final verification; /edit command implemented with recent paginated list (10/page), transaction card, amount/category/account/intent edit flows, Redis TTL 300s state for amount input (key midas:edit:{userId}:{chatId}), permanent [?? »зменить] button after approval, strict callback_data limit verified at max 62 bytes (ed:c:cat:<26>:<26>), no search/date/delete/soft-delete/GIN index, no migrations, no /balance or /report changes, no new dependencies; amount edits blocked for cross-currency (exchange_rate ? 1.0); all DB mutations via withTenantTransaction + explicit workspace_id filter; 43/43 Phase 1.28 smoke + 841/841 regression smoke + 13/13 typecheck/lint = 897/897 total gates PASS; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit c8bbc7d; workflow commit 1807d93. Tag phase-1.28-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 22:06 | Phase 1.29 implemented: soft delete for transactions. Migration 1778700000000_transactions-soft-delete applied (deleted_at TIMESTAMPTZ DEFAULT NULL). deleted_at IS NULL guard added to 11 query locations (7 in edit.service, 2 JOIN ON in balance.service, 1 in report.service, 1 subquery in setBalance.service). Double-confirmation UX: [??? ”далить] > warning > [??? ƒа, удалить]/[?? ќтмена]. softDeleteTransaction() with D1+D6 fetch-before-update. callback_data max 35 bytes (ed:d:ask:<ULID> ? 64 ?). Graceful fallback for old edit buttons on already-deleted transactions. smoke-test-phase128.mjs A3/J1 scope guards updated to reflect Phase 1.29. smoke-test-phase129.mjs: 44/44 PASS. Full regression: 44/44 Phase 1.29 + 43/43 Phase 1.28 + 841/841 prior phases + 13/13 typecheck/lint = 941/941 total gates PASS (excl. Phase 1.5 bot-server tests Ч pre-existing). No hard delete. No restore. No new deps. No project_config.md changes. Implementation commit 7082540. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 20:23 | Phase 1.29 accepted after final verification; soft delete (transactions.deleted_at) added; double-confirmation delete UX implemented; deleted txs safely excluded from /edit, /balance (LEFT JOIN preserved), /report, /set_balance; zero hard deletes/restores; 941/941 gates PASS; Traceability, Adversarial Security & Scope Guard PASS; impl commit 7082540; workflow commit 723a89b. Tag phase-1.29-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 20:55 | Phase 1.30 implemented: Smart Account Onboarding. account-onboard-keyboard.service.ts (NEW): ac: namespace, parseAccountCallback() allowlist, keyboards for type/exchange/currency/post-create. account.service.ts (MODIFY): hasAccounts() lightweight COUNT, addAccountWithCurrency() explicit currency. webhook.route.ts (MODIFY): ac: callback block, /accounts empty-state > guided keyboard, /start new users > buildStartOnboardKeyboard(), midas:ac: text intercept for name/currency steps. No migration, no enum changes, no new deps, no new slash commands. Max callback_data 17 bytes (ac:cur:AAAAAAAAAA). Redis TTL 300s. 64/64 Phase 1.30 smoke + 197/197 accessible regression + 13/13 typecheck/lint PASS. Traceability ? Adversarial Security ? Scope Guard ?. Status: READY_FOR_OWNER_ACCEPTANCE. |
| 2026-05-07 21:10 | Phase 1.30 accepted after final verification; smart account onboarding UX added for /start and empty /accounts; ac: callback namespace implemented; Redis TTL state midas:ac:{telegramUserId}:{chatId} added; existing silent Default account creation preserved; all new accounts remain type='manual'; no migrations, no DB function changes, no new deps, no new slash commands; 64/64 Phase 1.30 smoke passed; accessible gates 318/318 passed; legacy host-limited suites unchanged from prior baseline; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 4593867; workflow commit 99a2964. Tag phase-1.30-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-07 21:20 | Phase 1.31 advisory delivered: Inline account creation during transaction input. Scope: account_hint optional field in AI schema; parsed_account_hint TEXT column in transaction_drafts (1 migration); account-fuzzy.service.ts (NEW, Jaro-Winkler, short-ticker exact-only); account-inline-keyboard.service.ts (NEW, ia: namespace); midas:ia:{draftId} Redis TTL 300s for rename sub-flow; addAccountWithCurrency() reused from Phase 1.30; max callback_data 60 bytes (ia:use:{accountId}:{draftId}); Scenario Ѕ (transfer) excluded Ч Phase 1.32+; Option A architecture (resolve in ai-parse worker before first keyboard). No code changes. Awaiting owner APPROVED. |
| 2026-05-07 22:00 | Phase 1.31 accepted after final verification; parsed_account_hint added to transaction_drafts; optional AI account_hint added; Option A implemented Ч account resolution before final draft confirmation; exact match sets draft.account_id silently; fuzzy/no-match account UX added; ia: callback namespace implemented with max 62 bytes; Redis rename state used only for temporary custom-name flow; transfer dual-account excluded; no to_account_id; no new deps; no Mini App; Phase 1.31 smoke 27/27 PASS; key regression gates PASS; typecheck/lint 13/13 PASS; Traceability Review PASS; Adversarial Security Review PASS; Scope Guard Review PASS; implementation commit 7c065f7; workflow commit 04209fc. Tag phase-1.31-accepted pushed. Status: WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE. |
| 2026-05-08 08:00 | Phase 1.32 Smart Text Input / Clarification Engine implemented and accepted. Migration 1778900000000_draft-clarification-state.js: `needs_clarification` status added to transaction_drafts state machine trigger. AI pipeline updated: amount/intent optional in schema, `PARTIAL_CONFIDENCE_THRESHOLD=0.3`, `MissingField` type, `partial` ParseResult status, `computeMissingFields()`. New `clarification.service.ts` in telegram-bot: `clar:` callback namespace for intent/category selection, `midas:clar:` Redis TTL 300s for amount text intercept. `webhook.route.ts`: clar: callback handler, clarification text intercept, buildClarificationScreen usage. `draft.service.ts`: `patchDraftAmount()`, `patchDraftIntent()`, `patchDraftCategory()` Ч atomic field patches returning `{status: 'ready'\|'still_needs', field}`. 57/57 Phase 1.32 smoke PASS. 0 lint/typecheck errors. Implementation commit e00f37e. Tag `phase-1.32-accepted` pushed. |
| 2026-05-08 09:00 | Phase 1.33 Clean Chat / Single Active Message UX implemented and accepted. UX-only phase Ч no migrations, no DB schema changes. `active-message.service.ts` (NEW): Redis pointer `midas:am:{userId}:{chatId}` (TTL 24h) tracks the current bot message per chat. `telegram-api.ts` (MODIFY): `upsertBotMessage()` edit-first strategy Ч tries `editMessageText`, falls back to `sendMessage`, updates Redis pointer. All workers (ai-parse, confirmation, notifications) now use edit-first pattern. `shared/index.ts` (MODIFY): `NotificationJobPayload` extended with `telegramUserId` + `activeMessageId`. Result: bot edits its last message instead of sending new ones Ч clean single-screen app UX. 0 typecheck errors. Batch-accepted by owner decision. Commit 36cacd7. Tag `phase-1.33-accepted` pushed. |
| 2026-05-08 09:30 | Phase 1.34 Rich Screen Cards implemented and accepted. UX-only phase Ч no migrations, no DB schema changes. `screen-builder.ts` (NEW in both `telegram-bot` and `background-workers`): pure functions for all UI screens Ч `buildPreviewScreen()`, `buildConfirmedScreen()`, `buildClarificationScreen()`, `buildConfirmKeyboard()`, `buildPostConfirmKeyboard()`, `buildNavKeyboard()`, `intentEmoji()`, `intentLabel()`, `escapeHtml()`. Replaces hardcoded text strings across all workers and route handlers with standardized card templates. 0 typecheck errors. Batch-accepted by owner decision. Commit 6e899f0. Tag `phase-1.34-accepted` pushed. |
| 2026-05-08 11:00 | Phase 1.35 Intelligent Transaction Understanding Ч core implementation complete. Migration `1779000000000_intelligent-transactions.js`: `item_name TEXT` + `parsed_category_hint TEXT` columns on transaction_drafts; `item_name TEXT` on transactions; `default_expense_account_id` + `default_income_account_id` FK columns on workspaces; `category_group` ENUM; 28-category taxonomy backfill; SECDEF onboarding function updated. `category-resolver.service.ts` (NEW): 3-stage pipeline Ч exact DB match > 200+ alias map > fallback Ђƒругоеї. `prompts.ts` + `schemas.ts`: `item_hint` + `category_hint` added to AI schema with examples. `draft.service.ts`: propagates item_name, parsed_category_hint. `draft-confirmation.service.ts`: CategoryResolver integration, resolveDefaultAccount() with workspace defaults > LIMIT 1 > auto-create. `confirmation.worker.ts`: rich post-confirm cards with item/category. smoke-test-phase135.mjs: 55 tests PASS. 5/5 typecheck PASS. Deployed to Railway. |
| 2026-05-08 16:20 | Phase 1.35 hotfix #1: Rich preview cards across all confirmation entry points. Problem: after clarification (amount/intent/category selection), generic text like Ђ?? √отово. ѕодтвердите или отклоните:ї was shown instead of the rich transaction card. Fix: introduced `confirmKb(draftId)` centralized keyboard helper (DRY pattern replacing 8 hardcoded keyboards) and `confirmPreview(workspaceId, userId, draftId)` helper (fetches draft data via `getDraftFields` > builds rich card via `buildPreviewScreen`). All 8 confirmation entry points updated: ia:skip, ia:create (new account), ia:use (select account), clar:intent, clar:category, clar:nocat, clarification amount text intercept, ia rename text intercept. Typecheck 5/5 PASS. Commit d037f75. Deployed to Railway. |
| 2026-05-08 16:29 | Phase 1.35 hotfix #2: Defensive String() coercion for Postgres NUMERIC amounts. Problem: `fetchApprovedTransactionCard` and `approveDraft` returned `amount` as raw Postgres NUMERIC (JavaScript `number`), but `buildConfirmedScreen` passed it to `escapeHtml()` which calls `.replace()` Ч crashed with `TypeError: input.replace is not a function`. Root cause: pg driver returns NUMERIC as `number`, not `string`. Fix: (1) `approveDraft`: `amount: String(draft.parsed_amount ?? '0')`, (2) `fetchApprovedTransactionCard`: `amount: String(tx.original_amount)`, (3) `escapeHtml`: defensive `typeof input === 'string' ? input : String(input)`. Also fixed incorrect SQL column names in `fetchApprovedTransactionCard`: `amount` > `original_amount`, `account_source_id` > `account_id`. Typecheck 5/5 PASS. Commit 6db3d69. Deployed to Railway. |
| 2026-05-09 09:46 | Phase 1.36-UX Sub-step 1: Persistent Navigation Keyboard (core). `telegram-api.ts` Ч `ReplyKeyboardMarkup` interface + `sendMessageWithReplyKeyboard()`. `screen-builder.ts` (telegram-bot) Ч `buildMainMenuKeyboard()`, `NAV_BTN_BALANCE/REPORT/SETTINGS`, `input_field_placeholder`. `webhook.route.ts` Ч Reply Keyboard sent on /start (new+existing users), 3 text intercepts before AI parse for [?? Ѕаланс]/[?? ќтчЄт]/[?? Ќастройки] buttons. Collateral lint: `ai-core/claude-client.ts` (no-useless-assignment), `draft-confirmation.service.ts` (no-unnecessary-type-conversion ?3), both `screen-builder.ts` (restrict-template-expressions). 13/13 PASS. |
| 2026-05-09 10:00 | Phase 1.36-UX Sub-step 2: UX Bug Fixes & Consistency. (1) `webhook.route.ts` confirmKb layout standardized: ? full-width top row + [?? »зменить|?? ќтмена] split row Ч matches workers layout. (2) `redisConnection.del(clarKey)` added on approve/reject in `webhook.route.ts` Ч prevents stale `midas:clar:*` key intercepting next user message after confirmation (silent message discard race condition fixed). (3) `screen-builder.ts` both apps Ч emoji ?>?? for visual weight parity with ? and ??. 13/13 PASS. Commit `c2f012f`. |
| 2026-05-09 10:12 | Phase 1.36-UX Sub-step 3: Reply Keyboard auto-activation. `shared/index.ts` Ч `replyKeyboardJson?` added to `NotificationJobPayload` (documented: only valid on sendMessage, not editMessageText). `background-workers/screen-builder.ts` Ч `buildNavKeyboard()` replaced by `buildMainMenuReplyKeyboard()` (returns plain JS object with `keyboard` array, not InlineKeyboard); `buildPostConfirmKeyboard()` nav row [?? Ѕаланс][?? ќтчЄт] removed Ч only [?? »зменить запись] remains. `confirmation.worker.ts` Ч import updated (buildNavKeyboard>buildMainMenuReplyKeyboard); rejected/expired/intent_missing now pass `replyKeyboardJson` (not `inlineKeyboardJson`). `notifications.worker.ts` Ч keyboard routing split: `inlineReplyMarkup` for editMessageText path, `freshReplyMarkup` (prefers replyKeyboardJson) for sendMessage path. Reply Keyboard auto-activates on first new message without /start. 13/13 PASS. Commit `f10aa22`. |
| 2026-05-09 10:20 | Phase 1.36-UX Sub-step 4: Keyboard collapsibility. `screen-builder.ts` both apps Ч `is_persistent: true` > `is_persistent: false`. Result: Telegram displays standard ? collapse icon next to ?? microphone button; user can hide/restore keyboard at will; keyboard re-appears on next bot sendMessage. 13/13 PASS. Commit `062d40d`. Deployed to Railway. |
| 2026-05-09 12:57 | Phase 1.36-UX FINAL (accepted): Transaction history workflow + permanent keyboard. **ѕроблема:** edit-first стратеги€ через `midas:am:` pointer перезаписывала предыдущую карточку вместо создани€ новой Ч истори€ транзакций не накапливалась. **–ешение:** (1) `ai-parse.worker.ts` Ч убран `activeMessageId` из preview notifications; кажда€ preview-карточка всегда отправл€етс€ как новое сообщение. (2) `notifications.worker.ts` Ч при отправке preview (draftId присутствует) записывает `sentMessageId` в Redis `midas:preview:{draftId}` TTL 600s; удалЄн `setActiveMessagePointer` и весь AM-pointer механизм. (3) `confirmation.worker.ts` Ч на approve читает `midas:preview:{draftId}` > передаЄт как `activeMessageId` в notifications (edit preview>confirmed in-place); на reject Ч `activeMessageId` не передаЄтс€ > новое сообщение. (4) Greeting: Ќ≈ удал€етс€ Ч остаЄтс€ посто€нным носителем ReplyKeyboard; весь код удалени€ (deleteMessage + nav carrier) убран. `greetingMsgId` удалЄн из `NotificationJobPayload`. `shared` пересобран. Typecheck 0 errors (оба приложени€). Commits `e879dfc` > `2cb86c4` > `8941c6d` > `2a15f31`. Deployed to Railway. ѕротестировано: 4 транзакции записаны, истори€ накапливаетс€, клавиатура [?? Ѕаланс][?? ќтчЄт][?? Ќастройки] посто€нно видна. |
| 2026-05-09 13:09 | Phase 1.37 Step 1: Zero-clutter UX. `screen-builder.ts` (background-workers): `buildNonsenseScreen()` rewritten Ч removed all inline buttons ([?? –асход][?? ƒоход][?? ƒолг дал][?? ƒолг вз€л]), replaced with Variant 5 text-only prompt with input examples (`кофе 150 UAH Ј зарплата 5000 USDT`). `ai-parse.worker.ts`: added stale "Ќе пон€л" message deletion Ч stores `midas:clar:msg:{userId}:{chatId}` Redis key pointing to nonsense message_id; on next successful parse, deletes the old nonsense message via `deleteMessage()` API before sending new preview. `telegram-api.ts`: `editTelegramMessage()` Ч treats "message is not modified" 400 error as success (no redundant message generation). Typecheck 8/8 PASS. Commits `a4d49a9` > `ee85e5f`. |
| 2026-05-09 13:34 | Phase 1.37 Step 2: Category taxonomy expansion. `prompts.ts`: Expanded from 28 to 30 categories (added ѕитомцы, ƒом). International 500+ anchor items mapping: every category now has typical items across CIS (ѕ€тЄрочка, ј“Ѕ, —≥льпо), EU (Lidl, Biedronka, IKEA), US (Walmart, Costco, Amazon, Starbucks) markets. Business categories expanded with global services: AWS, Stripe, Upwork, Fiverr, Google Ads, Facebook Ads, Notion, Figma, etc. Pet category: Royal Canin, Whiskas, Pro Plan, наполнитель, ветеринар. ƒом: моющие средства, тр€пки, полотенца, шторы, мебель. Typecheck 8/8 PASS. Commits `77a0ad9` > `5b02cf3`. |
| 2026-05-09 14:09 | Phase 1.37 Step 3: Multilingual recognition + fuzzy matching. `prompts.ts`: Added MULTILINGUAL RECOGNITION section (RU/EN/UA Ч any language maps to correct category). FUZZY MATCHING section (typos: кофэ>кофе, нетфликс>Netflix; slang: комуналка>коммуналка>∆ильЄ; transliteration: kafe>кафе, taksi>такси). KEY BILINGUAL PAIRS for non-obvious translations (шиномонтаж=tire service, эквайринг=payment processing, подгузники=diapers, наполнитель=cat litter, etc.). Commit `e147240`. |
| 2026-05-09 14:10 | Phase 1.37 Step 4: Disambiguation rules + compound expressions + default intent priority. `prompts.ts`: Added 15 DISAMBIGUATION RULES (торт>ѕродукты/ѕодарки/ афе by context; кофе> афе/ѕродукты; страховка>“ранспорт/«доровье/ѕутешестви€; ремонт>∆ильЄ/“ранспорт/ќборудование; витамины>«доровье/ѕитомцы; etc.). COMPOUND EXPRESSIONS (подарок жене>ѕодарки, корм дл€ кота>ѕитомцы, билет в кино>–азвлечени€). DEFAULT INTENT PRIORITY (item+amount without verb = expense by default; income/transfer require explicit signal). Commit `03981d7`. |
| 2026-05-09 14:14 | Phase 1.37 Step 5: ALLOWED_CATEGORIES code validation. `claude-client.ts`: Added `ALLOWED_CATEGORIES` Set (30 categories Ч 18 personal + 12 business). Post-Zod validation step: if `aiData.category_hint` is not in the set, replace with `ƒругое`. Prevents hallucinated categories from reaching CategoryResolverService. Typecheck 8/8 PASS. |
| 2026-05-09 14:16 | Phase 1.37 Step 6: Documentation updates. `product-roadmap.md`: Added Phase 2.0 Ч AI Intelligence Evolution (3 components: 2.0-A self-learning from user edits, 2.0-B custom category recognition, 2.0-C regional bias from currency). Phase 1.37 + 2.0 added to summary table. Block 4 renamed from "√олос и Vision" to "AI Intelligence и Voice". `project_config.md`: Updated to v1.4, changelog v1.4 added, Section 2.8 AI Pipeline updated with multilingual/disambiguation/validation info. Commit `06bccb0`. Deployed to Railway. |
| 2026-05-09 15:18 | Phase 1.37 complete. `workflow_state.md` updated: Section 1 (status > COMPLETE), Section 2 (Phase 1.37 row added), Section 3 (AI Pipeline updated), Section 4 (project_config v1.4), Section 10 (7 history entries). All documents synchronized. |
| 2026-05-09 15:38 | Phase 1.37 VERIFICATION & ACCEPTANCE. 13/13 typecheck+lint PASS. CategoryResolver: ѕитомцы/ƒом aliases added. Commit `641ad26`. Deployed to Railway. |
| 2026-05-09 19:00 | **Phase 1.38 Fix #1:** Confirmation card not deleted on Cancel. `confirmation.worker.ts` reads `midas:preview:{draftId}` on both approve and reject paths Ч in-place edit to ? ќтменено. |
| 2026-05-09 19:04 | **Phase 1.38 Fix #2:** Unified blockquote currency prompt (Variant B). `screen-builder.ts` both apps: `<code>` tags replaced with blockquote text Ч no more green tap-able capsules. |
| 2026-05-09 19:05 | **Phase 1.38 Fix #3:** `amt+cur` handler used `validateCurrencyCode()` (ISO-only) instead of `normalizeCurrencyInput()`. Fixed. `awaiting_cur` now extracts currency token from mixed input (e.g. Ђ50 еврої). Commit `d59025f`. |
| 2026-05-09 19:18 | **Phase 1.38 Rollback:** PRICE vs QUANTITY AI prompt rule reverted. Caused regressions (Ђ150 куртокї not extracted as amount). Design decision: personal finance bots ALWAYS treat any number as a price. Original rule restored: ЂIf ANY number present > ALWAYS extract as amountї. Final commit `c59f2e1`. |
| 2026-05-10 10:08 | **Phase 1.39 Ч Gate UX Edit-In-Place (Variant B).** `formatAmount()` в обоих screen-builder.ts исправлен: `String()` cast дл€ Postgres NUMERIC типа Ч устранЄн TypeError (`raw.includes is not a function`). `clarification.service.ts`: `::TEXT` cast на `parsed_amount` в 2 SQL-запросах. `buildGatePausedPreview()` обновлЄн: ?? алерт-баннер + summary черновика (вместо старого текста без данных). Ѕлок gate в `ai-parse.worker.ts` переработан: вместо 2 новых сообщений (paused edit + gate card) Ч **один** edit-in-place существующей preview-карточки с алертом и сохранением клавиатуры подтверждени€. Commits `8fa8f91` > `089abf6`. Deployed to Railway Ч SUCCESS. |
| 2026-05-10 10:30 | **Phase 1.40 Ч Dead Card Auto-Cleanup.** Ћогика: карточки Ђ? ќтмененої и Ђ? „ерновик истЄкї автоматически удал€ютс€ из чата когда по€вл€етс€ следующа€ preview-карточка. ¬ чате остаютс€ только: pending (ждЄт подтверждени€) + approved (? «аписано). –еализаци€: `confirmation.worker.ts` Ч после reject/expired сохран€ет `previewMsgId` в Redis `midas:dead_card:{chatId}` TTL 24h. `draft-expiration.worker.ts` Ч CRON expiry тоже пишет dead_card. `ai-parse.worker.ts` Ч перед отправкой новой preview читает dead_card, передаЄт как `deleteMessageId`, удал€ет ключ. ≈сли одновременно есть dead_card и clar_msg Ч приоритет у dead_card. TypeScript: 0 ошибок. Commit `51eaf10`. Deployed to Railway Ч SUCCESS. |
| 2026-05-10 15:30 | **Phase 2.0 Ч Transaction Hub + Reports 2.0 + Settings 2.0 deployed.** GitHub auto-deploy from `main`. |
| 2026-05-10 18:44 | **Phase 2.1 Ч Account Management Dashboard.** ѕолна€ реализаци€ интерактивного управлени€ счетами через баланс. **Ќовые файлы:** `balance-keyboard.service.ts` (450+ строк Ч parseBalanceCallback, buildBalanceListKeyboard, buildAccountActionsKeyboard, buildDeleteConfirmKeyboard, buildCurrencyWarningKeyboard, buildBalanceFiatCurrencyKeyboard, formatAccountDetailText, BalanceAccountRow type). **ћодифицированные файлы:** (1) `account-onboard-keyboard.service.ts` Ч расширен пресетами банков (10: “инькофф, —бербанк, јльфа, ¬“Ѕ, ћоно, ѕриват,  аспи, N26, Revolut, Wise) и кошельков (9: Trust Wallet, MetaMask, Exodus, Ledger, Trezor, Phantom, Coinbase Wallet, SafePal, Tangem). (2) `account.service.ts` Ч `renameAccount()`, `changeAccountCurrency()`, `softDeleteAccount()`. (3) `balance.service.ts` Ч `getBalanceData()`, `getAccountDetail()`, `setAccountBalanceById()`, `getAccountTxCount()`. (4) `webhook.route.ts` Ч bl: callback handler, text intercepts, ac:done провер€ет bl:source. **DB Migration:** updated_at + deleted_at на account_sources. Build+Deploy: 0 ошибок. |
| 2026-05-10 19:58 | **Phase 2.2 Ч Settings UI Overhaul (DEPLOYED).** (1) `currencies.ts`: расширен список (FIAT 40+, CRYPTO 48+); `CURRENCY_RU_ALIASES` Ч 50+ русских алиасов (биткоин, доллар, евро, рубль, гривна, тенге, лира и др.); `searchCurrencies()` Ч 5-pass алгоритм (exact/startsWith/includes/EN-name/RU-alias), лимит 10. (2) `settings.service.ts`: `getWorkspaceAccounts()` + `deleted_at IS NULL` (soft-deleted счета не показываютс€); `setDefaultAccount()` атомарно обновл€ет оба пол€ (expense+income). (3) `settings-keyboard.service.ts`: `buildSettingsMainKeyboard()` Ч строгий 2x3 грид; выбор валюты с объ€влением; новый текст выбора основной валюты. (4) `webhook.route.ts`: после выбора валюты кнопка `[?? Ќазад в настройки]`; единый обработчик `st:da:sa:` Ч один Main Account дл€ income+expense. Build: `tsc` 0 ошибок. Commit `3e650c1`. Deployed to Railway (auto-deploy). |
| 2026-05-10 22:00 | **Phase 2.3 Ч Paginated Transaction Search.** `transaction-hub.service.ts`: добавлен `SEARCH_PAGE_SIZE=8`; все 4 search-функции (`searchByName`, `searchByAmount`, `searchByCategory`, `searchByDateRange`) переработаны Ч принимают `page: number`, параллельный `COUNT(*)` > возвращают `{items: TxListItem[], total: number}`. ”далена константа `SEARCH_LIMIT=200`. `transaction-keyboard.service.ts`: `buildSearchResultsKeyboard(items, page, totalPages)` Ч кнопки товаров + строка навигации `[??][p/total][??]` + footer `[?? Ќовый поиск][??   списку]`; `search_results_page` в `TxCallbackCmd`; парсер `tx:sr:p:{page}`. `webhook.route.ts`: все search-handlers сохран€ют контекст в Redis `midas:tx:sr:ctx:{uid}:{cid}` TTL 600s; `search_results_page` handler Ч читает контекст, пересчитывает offset, обновл€ет сообщение; text intercepts (name/amount/date) > paginated API; при устаревшем контексте Ч дружелюбное Ђѕоищите сноваї; удалЄн дублирующий старый text intercept блок. Build: `tsc` 0 ошибок. Commit `6da4464`. |
| 2026-05-10 22:10 | **Phase 2.3 Ч Reports Close Button.** `report-keyboard.service.ts`: добавлен `rp:cl` callback (`?? «акрыть`) как последн€€ строка на всех 3 клавиатурах (`buildPeriodPickerKeyboard`, `buildReportSubMenuKeyboard`, `buildReportBackKeyboard`); тип `{ cmd: 'close' }` добавлен в `RpCallbackCmd`; `parseRpCallback`: `rp:cl > { cmd: 'close' }`; обновлЄн docstring. `webhook.route.ts`: в блоке `rp:` добавлен handler `else if (rpCmd.cmd === 'close')` > `deleteMessage(chatId, rpMsgId)` Ч полностью убирает сообщение из чата. Build: `tsc` 0 ошибок. Commit `049233d`. |
| 2026-05-10 22:11 | **Phase 2.3 Ч Persistent Keyboard Button Order.** `screen-builder.ts` (`buildMainMenuKeyboard`): пор€док кнопок изменЄн Ч Row 1: `[?? Ѕаланс][?? ќтчЄт]`, Row 2: `[?? “ранзакции][?? Ќастройки]` (до: Row 1 Ѕаланс+“ранзакции, Row 2 ќтчЄт+Ќастройки). ќбновлЄн docstring. Build: `tsc` 0 ошибок. Commit `70a5d41`. Deployed to Railway (auto-deploy). |
| 2026-05-11 09:00 | **Phase 2.2 Onboarding Pagination (Phase 2.2).** `account-onboard-keyboard.service.ts` полностью переписан с универсальным движком пагинации `buildPaginatedPicker()`. –еализованы: paginated banks (70+ записей, 6/страница, 3 колонки, ac:bp:{N}), paginated exchanges (ac:xp:{N}), paginated fiat currencies (ac:cfp:{N}), paginated crypto currencies (ac:ccp:{N}). `OnboardStep` расширен: `bal_input`. `AccountOnboardState` Ч пол€ `accountId`, `currency`. `addAccountReturningId()` добавлен в `account.service.ts`. `webhook.route.ts`: FSM handlers дл€ bank_page, exchange_page, fiat_page, crypto_page, bal_skip. Ѕаланс вводитс€ текстом (validateAmountFromText intercept) или пропускаетс€ (ac:bal:s).  оммит в phase 2.2 серии. tsc 0 ошибок. |
| 2026-05-11 12:00 | **Phase 2.3 Onboarding UX Polish (PLAN APPROVED).** ѕользователь утвердил план: (1) убрать промежуточный afterCreate экран, (2) добавить кнопку Ђ? «авершитьї (ac:fin) пр€мо в пикер типа, (3) buildStartOnboardKeyboard Ч исправить иконки (??>??, ?>??), (4) при Ђ?? Ќачать без счЄтаї тихо создавать Ђ ошелЄкї (USD). –еализаци€ поделена на 4 этапа с tsc-проверкой после каждого. |
| 2026-05-11 14:07 | **Phase 2.3 Onboarding UX Polish Ч Ё“јѕ 1 (account-onboard-keyboard.service.ts).** ƒобавлен `{ cmd: 'fin' }` в `AccountOnboardCmd` union + парсер `if (sub === 'fin')`. ƒобавлена `buildFinishOnboardKeyboard()` Ч пикер типа + Ђ? «авершитьї (ac:fin), иконки ????. ƒобавлена `accountAddedText(name, currency)`. `buildStartOnboardKeyboard()` исправлен: ??>??, ?>??, ??Ќазад>??—воЄ название. tsc 0 ошибок. |
| 2026-05-11 14:08 | **Phase 2.3 Onboarding UX Polish Ч Ё“јѕ 2 (imports).** `webhook.route.ts`: добавлены импорты `buildFinishOnboardKeyboard`, `accountAddedText` из account-onboard-keyboard.service.js. tsc пока 2 предупреждени€ (unused Ч ожидаемо до этапа 3). |
| 2026-05-11 14:10 | **Phase 2.3 Onboarding UX Polish Ч Ё“јѕ 3 (handlers).** `webhook.route.ts`: (1) `ac:fin` handler Ч идентичен `ac:done`, backward compat; (2) `ac:more` > redirect to fin flow (deleteMessage + sendMessageWithReplyKeyboard); (3) `ac:bal:s` Ч читает состо€ние Redis, затем показывает `accountAddedText` + `buildFinishOnboardKeyboard` вместо старого afterCreate; (4) `bal_input` text intercept Ч `buildFinishOnboardKeyboard` вместо `buildAfterCreateKeyboard`, `accountAddedText` вместо старой строки с балансом; (5) safety fallback в `bal_input` > `buildFinishOnboardKeyboard`. tsc 0 ошибок. |
| 2026-05-11 14:13 | **Phase 2.3 Onboarding UX Polish Ч Ё“јѕ 4 (default account).** `webhook.route.ts` `ac:skip` handler: перед удалением Redis-ключа вызывает `hasAccounts()` Ч если 0 счетов, создаЄт `addAccountWithCurrency(workspaceId, userId, ' ошелЄк', 'USD')` в блоке try/catch (non-fatal). tsc 0 ошибок. Commit `395e1f2`. git push origin main. Deploy Railway: `7089846c Ч SUCCESS`. |
| 2026-05-11 16:30 | **master_roadmap Phase 1 Ч Keyboard Service.** `account-onboard-keyboard.service.ts` +478 строк: `CURRENCY_FLAGS` (40+ валют: ????RUB ????USD ?BTC ? ETH TON и др.), `getCurrencyFlag(code)`, `CURRENCY_NAMES`. `buildPaginatedPicker()` рефакторинг Ч обе стрелки всегда, noop на кра€х. `buildCurrencyPickerText(name?,isCustom?)` Ч 3 ветки. `buildFiatCurrencyPage()` + `buildCryptoCurrencyPage()` Ч флаги + ac:cur:search. `searchCurrencies()` Ч fuzzy+транслитераци€. `buildNoMatchText/Keyboard`. `buildCurrencySearch*`. ”далены FIAT_ITEMS, CRYPTO_ITEMS, CURRENCY_PICKER_TEXT. tsc 0 ошибок. |
| 2026-05-11 16:33 | **master_roadmap Phase 2 Ч Webhook FSM.** `webhook.route.ts`: `name_input` > no-match screen при fuzzy null. `ac:cus:save` > isCustomName=true > cur_pick. `ac:cus:keep` > name_input retry. `ac:cur:search` > cur_search step. `ac:cur:list` > возврат к списку. `cur_search` text interceptor > searchCurrencies > результаты или no-results. 3 success-screens button-free `{ inline_keyboard: [] }`. `chooseCurKeyboard()` module-level. ¬се callback_data ?64 байт. tsc 0 ошибок. |
| 2026-05-11 16:43 | **master_roadmap Phase 3 Ч Smoke Tests.** `smoke-test-master-roadmap.mjs` (NEW): 70 проверок, запуск `node apps/telegram-bot/smoke-test-master-roadmap.mjs` (против скомпилированного dist/). ѕокрыты все 14 сценариев. –езультат: **70/70 ? / 0 ?**. |
| 2026-05-11 16:44 | **master_roadmap Phase 4 Ч Deploy.** Git commit `35c92e0` `feat(onboard): no-match screen, cur-search, flags, nav-arrows, button-free success [master_roadmap]`. Push > Railway auto-deploy. Status: Midas ? Online, background-workers ? Online. Deploy logs: clean start, Redis connected, no errors. |
| 2026-05-12 15:05 | **workflow_state.md актуализирован. “есты запущены.** `smoke-test-master-roadmap.mjs`: исправлен устаревший assert дл€ `buildCurrencySearchNoResultsText`. »тог: 76/76 ?. `smoke-test-lazy-default.mjs`: 39/39 ?. `tsc --noEmit`: 0 ошибок. Phase LD++ полностью подтверждена. |
| 2026-05-12 19:35 | **Phase 2.4 PR 2 - v??????? ? ??????.** `account.service.ts`: ???????? `AccountWithBalance` interface + `getAccountWithBalance()` + `getWorkspaceAccountsWithBalances()`. tsc 0 ??????. GitHub PR #2 merged squash ? main (commit 7cc8528). |
| 2026-05-12 17:27 | **Phase 2.4 Ч UX Design сесси€ и планирование.** —проектированы: черновик + математика баланса (Ђ?? Bybit USDї + Ђ?? 15 400 ? 10 000 = 5 400 USDї), пикер счетов (кнопка Ђ?? —менить счЄтї), кросс-валюта (ввод суммы конвертации), confirmed card без кнопок Ѕаланс/ќтчЄт. UX-изменени€ ia:list/ia:back из текущего чата ќ“ћ≈Ќ≈Ќџ (кодова€ база возвращена в stable). 16 атомарных PR спроектированы. јнализ конфликтов: 1 breaking change (PR 7 buildConfirmKeyboard), 1 новый Redis-префикс (midas:xfx:ptr). ѕолный план: `account_debit_ux_plan.md`. workflow_state.md обновлЄн. |
| 2026-05-12 21:00 | **Phase 2.4 Ч Account Picker UX Hotfixes.** »справление критического бага отсутстви€ пикера при AI parse без account_hint. ¬ `ai-parse.worker.ts` добавлен принудительный показ пикера. ¬ `draft.service.ts` добавлена `getWorkspaceAccountsForPicker` дл€ воркера. ¬ `draft-confirmation.service.ts` добавлена защита (`accountWasExplicitlyChosen`) от тихой автоконвертации XFX при несовпадении валюты дефолтного счета. ¬недрены intent-aware тексты (доход/расход) дл€ пикера счетов в `account-inline-keyboard.service.ts`. ¬се 103/103 smoke-теста прошли. |
| 2026-05-13 08:17 | **Phase 2.5 Ўаг 1 Ч Smart Item>Category Auto-Detector.** `item-category-detector.service.ts` (NEW): 200+ брендов и ключевых слов, 9 категорий (“ранспорт/≈да/Ёлектроника/ќдежда/«доровье/ƒом/–азвлечени€/ќбразование/ќборудование), longest-phrase-first matching. `patchDraftCategoryHint()` в `clarification.service.ts`: atomic idempotent DB patch (перезаписывает только если `parsed_category_hint IS NULL` или `= 'ƒругое'`). »нтеграци€ в `webhook.route.ts` > `sendAndStorePreview`: non-blocking, не блокирует flow при ошибке. “ест: Ђмайбахї > “ранспорт, Ђstarbucksї > ≈да. tsc 0 ошибок. |
| 2026-05-13 08:20 | **Phase 2.5 Ўаг 2 Ч Account-Currency Compatibility Validation Gate.** `account-currency-validator.service.ts` (NEW): матрица 8 правил, `classifyCurrency()`, `HYBRID_EWALLET_KEYS`, `TON_ASSETS`. »нтегрирован в 2 точки `webhook.route.ts`: (1) `cmd=currency` callback Ч editMessageText с ошибкой, FSM state сохран€етс€ в Redis; (2) `cur_input` text interceptor Ч upsertBotMessage с ошибкой, `redisConnection.del` Ќ≈ вызываетс€. Ѕлокирует: ћонобанк+USDT, Ќаличные+ETH, Lightning+USDC. –азрешает: Bybit+USDT, Payeer+USDT (гибрид), MetaMask+BTC. Commit `d9ad480`. tsc 0 ошибок. git push > Railway deployed. |
| 2026-05-13 08:24 | **Phase 2.5 Ўаг 3 Ч Anomaly Badge в пикерах.** `account-inline-keyboard.service.ts` (MODIFY): импорт `classifyCurrency`. `anomalyBadge(emoji, currency)` Ч возвращает `'?? '` если emoji=`??` и валюта не фиат. `buildAccountPickerV2Keyboard` улучшен: `??` дл€ крипто, `??` дл€ фиата, `??` только дл€ банк+крипто аномалий по имени счЄта. `buildAccountPickerForDraft`: `??` через `anomalyBadge()` по `accountTypeEmoji()`. Commit `f543c5e`. tsc 0 ошибок. git push > Railway deployed. Phase 2.5 COMPLETE. |
| 2026-05-13 15:20 | **Phase 2.7 Ч Account Picker Fix & Cancellation UX.** »справлена регресси€ коммита `6efe173` (always show account picker), из-за которой транзакции без созданных счетов зависали.  нопка Ђ«аписать без счЄтаї на no-match карточке заменена на `?? ќтмена` (`ia:cancel`). ѕри отмене: статус черновика в Ѕƒ мен€етс€ на `rejected`, сообщение in-place мен€етс€ на "? ќтменено" без кнопок, удал€ютс€ стейты из Redis. |
| 2026-05-13 15:25 | **Infrastructure Ч AI Token Budget Fix.** ќбнаружено, что очередь транзакций полностью встала из-за исчерпани€ дневного лимита токенов Claude (`AI daily token budget exceeded: 506188 >= 500000`). „ерез Railway CLI переменна€ `AI_BUDGET_MAX_DAILY_TOKENS` дл€ `background-workers` увеличена с 500 000 до 2 000 000. ¬оркеры пересобраны, обработка транзакций восстановлена. |
| 2026-05-13 21:30 | **Phase 2.8 Ч Ётап 1: Callback Fix (ia:newac).** `account-inline-keyboard.service.ts`: исправлен критический баг Ч кнопка Ђ? —оздать счЄтї в пикере черновика вызывала `ia:rename` вместо корректного `ia:newac`. ƒобавлен тип `showpicker` в `InlineAccountCmd` union и соответствующий парсер дл€ обратной навигации. |
| 2026-05-13 21:35 | **Phase 2.8 Ч Ётап 2: —тандартизаци€ текста онбординга.** `webhook.route.ts`: заголовок экрана выбора типа счЄта (вызываемого через `ia:newac`) изменЄн с жЄстко прописанного текста на константу `ACCOUNTS_EMPTY_TEXT` Ч соответствует стилю экрана `/start` дл€ новых пользователей. |
| 2026-05-13 21:45 | **Phase 2.8 Ч Ётап 3: Back Navigation (ia:showpicker).** `account-onboard-keyboard.service.ts`: кнопка Ђ?? Ќазадї на экране выбора типа счЄта теперь генерирует callback `ia:showpicker` вместо `ia:pk:back`. `webhook.route.ts`: реализован новый handler `ia:showpicker` Ч восстанавливает `midas:prev_acct` (кэшированный accountId из Redis), рендерит Account Picker V2 с сохранением `linkedDraftId`. ѕользователь может вернутьс€ к пикеру без потери контекста черновика. |
| 2026-05-13 22:00 | **Phase 2.8 Ч Ётап 4: ”даление success-баннеров.** `webhook.route.ts`: удалены строки Ђ? —чЄт ... создан!ї во всех трЄх пут€х завершени€ онбординга из черновика: `bal_skip`, `bal_input`, `cur_input`. “еперь после создани€ счЄта сразу показываетс€ preview-карточка черновика через `confirmPreviewFull()` Ч чистый seamless UX без промежуточных экранов. |
| 2026-05-13 22:30 | **Phase 2.8 Ч TS Build Fix.** ќбнаружены ошибки сборки на Railway: `TS6133: 'linkedAccountNameBal' / 'acNameBi2' is declared but its value is never read` Ч переменные стали неиспользуемыми после удалени€ success-баннеров в Ётапе 4. ”далены оба объ€влени€. `tsc --noEmit`: 0 ошибок. Commit `56991be` pushed to main. Railway re-deploy: Midas ? Online. |
| 2026-05-14 10:43 | **Phase 2.9 Ч Nav Buttons Never Delete Tx Records.** ѕроблема: после создани€ транзакции еЄ message_id (Ђ? «аписаної + Ђ?? »зменить записьї) хранилс€ в Redis как `midas:am:` pointer. ѕри нажатии Ѕаланс/ќтчЄт/“ранзакции/Ќастройки Ч `upsertBotMessage()` редактировал или удал€л это сообщение. –ешение: добавлен `sendNavMessage()` в `active-message.service.ts` Ч всегда отправл€ет Ќќ¬ќ≈ сообщение, не трогает `midas:am:`. 4 NAV_BTN_* обработчика в `webhook.route.ts` переключены на `sendNavMessage`. Commit `1477f55` pushed to main. |
| 2026-05-14 10:57 | **Phase 2.9+ Ч Smart Nav Message (мidas:nav: key).** ѕроблема: каждое нажатие nav-кнопки отправл€ло новое сообщение (засорение чата). –ешение: два независимых Redis-ключа. `midas:am:` Ч черновики/пикеры/подтверждени€ (не трогаем в nav). `midas:nav:` Ч nav-панель (Ѕаланс/ќтчЄт/etc.). `sendNavMessage()` полностью переписан: edit-first через `midas:nav:`, при успехе Ч редактирует то же сообщение (чат не засор€етс€), при неудаче Ч отправл€ет новое. ѕри вводе транзакции: `getNavMessageId` > `deleteMessage` > `clearNavMessageId` перед стандартным cleanup `midas:am:`. Commits `4baac9c`. |
| 2026-05-14 11:04 | **Phase 2.9+ Ч Silent Close Button.**  нопка Ђ? «акрытьї в Ќастройках (`st:cancel`) ранее редактировала сообщение на Ђ?? Ќастройки закрыты.ї (лишнее). “еперь: `deleteMessage(chatId, messageId)` + `clearNavMessageId()` Ч панель просто исчезает, никакого нового текста.  нопка Ђ? «акрытьї в Ѕалансе (`bl:close`) уже удал€ла сообщение, но не очищала `midas:nav:` Ч исправлено. Commit `004966f` pushed to main. Railway auto-deploy triggered. |
| 2026-05-14 12:28 | **Phase 2.10 Ч Fix 1: isSuccessCard Ч DEL midas:am: при подтверждении транзакции.** ѕроблема: после подтверждени€ транзакции success card сохран€лась в `midas:am:` pointer. ѕри вводе следующей транзакции step-7 в webhook.route.ts удал€л сообщение из `midas:am:` Ч success card удал€лась. –ешение: `shared/index.ts` Ч добавлен `isSuccessCard?: boolean` в `NotificationJobPayload`. `confirmation.worker.ts` Ч при approve: `isSuccessCard: true` в payload. `notifications.worker.ts` Ч если `isSuccessCard`: `DEL midas:am:` вместо `SET`. Commit `df15a01`. |
| 2026-05-14 12:28 | **Phase 2.10 Ч Fix 2: from-context в delete flow parser.** ѕроблема: при нажатии Ђ»зменить записьї > Ђ”далитьї > Ђќтменаї > Ђ«акрытьї Ч кнопка «акрыть удал€ла карточку вместо восстановлени€ success card.  орень: `parseTxCallback` не читал `parts[4]` дл€ `tx:d:ask` и `tx:d:yes` Ч контекст `from='s'` тер€лс€ при парсинге. Fix: `transaction-keyboard.service.ts` Ч `const from = parts[4]`; return с `from` дл€ обоих action. “еперь `tx:view` корректно видит `from==='s'` и ставит `closeCallback = tx:done:{txId}`. Commit `8894b92`. |
| 2026-05-14 12:37 | **Phase 2.10 Ч Fix 3: Double-lock sentinel key.** ѕроблема: даже после Fix 1 success card иногда удал€лась (race condition между background-workers и telegram-bot, или отставание депло€). –ешение Ч двойна€ блокировка: (1) `notifications.worker.ts` при `isSuccessCard`: SET `midas:success_card:{sentMessageId}` = '1' (TTL 30 дней), затем DEL `midas:am:`. (2) `webhook.route.ts` step-7: перед `deleteMessage(amId)` провер€ет `EXISTS midas:success_card:{amId}` Ч если sentinel есть, сообщение Ќ≈ удал€етс€ (только очищаетс€ pointer). ƒва замка работают независимо. tsc 0 ошибок оба приложени€. Commit `b869c03`. |
| 2026-05-14 17:30 | **Phase 2.10+ Gate Fix Ч Frozen UI при параллельном вводе транзакций.** ѕроблема: TX1 открывает пикер счЄта > TX2 (webhook step-7) удал€ет пикер (gate_sent ещЄ не установлен) > ai-parse gate присылает новую карточку с пикером и устанавливает gate_sent > TX3 (webhook step-7) удал€ет gate-карточку (gate_sent не провер€лс€!) > ai-parse молчит (gate_sent SET > silently ignore) > TX4, TX5... цикл: сообщение приходит, удал€етс€, ответа нет Ч **«ј¬»—ќЌ**. **Fix 1 (webhook.route.ts строки 5446Ц5458):** `const gateSentActive = await redisConnection.exists('midas:gate_sent:...')`. ≈сли активен Ч `deleteMessage` и `clearActiveMessageId` Ќ≈ вызываютс€. Gate-карточка остаЄтс€ видимой при TX3, TX4... **Fix 2 (webhook.route.ts строка 1539, ia:pk: handler):** `redisConnection.del('midas:gate_sent:...')` после `setDraftAccountId` Ч нормальный flow восстанавливаетс€ сразу после выбора счЄта. **Fix 3 (ai-parse.worker.ts):** Gate реконструирует полный пикер счетов (inline keyboard с кнопками счетов + ?? ќтмена) когда `pendingDraft.accountId === null` Ч вместо пустой confirm-клавиатуры. **∆изненный цикл gate_sent:** SET ai-parse.worker (при gate) > DEL ia:cancel (строка 1432, до фикса) / ia:pk: (ƒќЅј¬Ћ≈Ќќ) / approve/reject confirmation.worker (строка 268, до фикса) / TTL auto 1h. Scope: 2 файла (webhook.route.ts, ai-parse.worker.ts) + утилита fix-stuck-draft.mjs. tsc 0 ошибок. git commit `8d25ec1`, push origin main ?. Railway: Midas ? Online, background-workers ? Online. |
| 2026-05-14 20:00 | **Phase 2.5+ Ч Currency-Aware Picker: Bot Layer (telegram-bot).** ѕроблема: в пикере счЄтов при USD-транзакции показывалс€ USDT-счЄт, хот€ это стейблкоин и он не конвертируетс€ в фиат. **–еализаци€ (4 файла):** (1) `account-currency-validator.service.ts` Ч добавлена функци€ `isKnownCurrency(code)`: провер€ет код по трЄм вайтлистам (FIAT_SET + STABLECOINS + CRYPTO_SET). ѕредотвращает создание фантомных валют типа ЂUDSї или Ђ≈¬–ї. (2) `clarification.service.ts` Ч в `validateCurrencyCode()` добавлена ранн€€ проверка `!isKnownCurrency(upper)` > возврат `null` до записи в Ѕƒ. (3) `account.service.ts` Ч `getWorkspaceAccountsWithBalances()` получает опциональный 4-й параметр `parsedCurrency?`. ѕосле SQL-запроса: если tx Ч фиат > exact-match сначала + остальные фиатные; если стейблкоин/крипто > только exact match. (4) `account-inline-keyboard.service.ts` Ч `getPickerScreenText(intent, parsedCurrency?)` добавл€ет контекстную подсказку; `getPickerEmptyText(parsedCurrency?)` Ч ЂЌет USDT-счетовї вместо общего сообщени€. `webhook.route.ts` Ч пробрасывает `draft.parsed_currency` в 3 entry points (sendAndStorePreview, ia:delink, ia:showpicker). ѕервый деплой упал Ч TS6133 (ACCOUNT_PICKER_EMPTY_TEXT в импорте но не используетс€). »справлено коммитом `04f7e81`. |
| 2026-05-14 20:10 | **Phase 2.5+ Ч Currency-Aware Picker: Worker Layer (background-workers). Root Cause Fix.** ќбнаружено: начальный пикер строитс€ ѕќЋЌќ—“№ё в `ai-parse.worker.ts` (background-workers), а не в `telegram-bot`. »зменени€ в `account.service.ts` (telegram-bot) на initial picker не вли€ют никак. **–еализаци€ (`ai-parse.worker.ts`):** ƒобавлены локальные классификаторы: `PICKER_STABLECOINS` (10 записей), `PICKER_KNOWN_CRYPTOS` (27 записей), `classifyPickerCcy(code)`, `filterPickerAccounts(accounts, txCurrency)` Ч аналог логики `account.service.ts`. ѕрименено в 2 местах: (A) **Initial picker** (строка ~620) Ч фильтрует по `aiData?.currency` (когда AI вернул currency, например ЂUSDTї); (B) **Gate picker** (строка ~340) Ч фильтрует по `pendingDraft.parsedCurrency` (восстановление пикера при gate-блокировке). »тог фильтрации: `{USD tx}` > [USD-счета] + [другие фиатные]; `{USDT tx}` > [только USDT-счета]. tsc 0 ошибок (оба приложени€). git commit `0085d8f`, push origin main ?. Railway auto-deploy triggered. |
| 2026-05-15 02:00 | **Balance Phase A Ч Grouped UI «јƒ≈ѕЋќ≈Ќ.** `balance-keyboard.service.ts` (MODIFY): `GroupType` union, `GROUP_EMOJI` map, `GROUP_ORDER` priority, `classifyAccountGroup(name, currency)` эвристика (Ѕанки/ риптобиржи/ рипто-кошельки/Ќаличные/ѕрочее), `buildBalanceListKeyboard` с группировкой и emoji-префиксами, `export formatBalanceShort`. `balance.service.ts` (MODIFY): секционированный текст getBalanceData() с эмодзи групп, удалЄн CURRENCY_TOTALS_SQL. tsc 0 ошибок. Commit `4a1748c` push to main. Railway auto-deploy ?. |
| 2026-05-15 02:27 | **Balance Phase B-1 Ч DB Migration ѕ–»ћ≈Ќ≈Ќј.** `packages/database/migrations/1779800000000_account-parent-and-subtype.js` (NEW): `parent_account_id VARCHAR(26) FK ON DELETE CASCADE`, `sub_type TEXT NOT NULL DEFAULT 'general'` CHECK constraint, `idx_account_sources_parent` (partial). –ешена ESM-проблема `1779400000000` (exports > export const). ћиграци€ применена `node-pg-migrate up --check-order false`. јудит: FK 31/31 ?, формула initial_balance+income?expense ?, INSERT транзакций не затронут ?. Commit `75156b9`. |
| 2026-05-15 02:30 | **ќбновлен workflow_state.md дл€ Phase B-2 handoff.** Section 1 (status), Section 2 (фазы), Section 8 (файлы), Section 9 (промпт), Section 10 (истори€). —ледующий шаг: Phase B-2 (PER_ACCOUNT_SQL + лесенка +/L + агрегаци€ дочерних). |
| 2026-05-15 23:40 | **Balance Phase B-2 Ч Hierarchical Ladder View «јƒ≈ѕЋќ≈Ќ.** `balance.service.ts`: `PER_ACCOUNT_SQL` добавлен `a.parent_account_id`; `AccountBalanceRow` + `parent_account_id: string | null`; `getBalanceData()` строит childrenMap/childCountMap, рендерит +/L лесенку дл€ parent>children; листовые счета без изменений (backward compat). `balance-keyboard.service.ts`: `BalanceAccountRow` + `parentAccountId?`+`childCount?`; `BalanceCallbackCmd` + `add_currency`; `parseBalanceCallback` `bl:ac:{id}` Ч SEC-01 compliant; `pluralizeCurrency()` (валюта/валюты/валют, mod10/mod100); `buildBalanceListKeyboard()` переписан Ч отдел€ет parents/children, parent с детьми: aggregation button + indented `L CURRENCY Ј balance` child rows + `? ƒобавить валюту` (bl:ac:{parentId}); листовые счета Ч Phase A/LD++ rendering. tsc 0 errors. Commit `d04bcba` pushed to main. Railway auto-deploy triggered. |
| 2026-05-14 22:00 | **Hotfix: кнопка "?? ќтмена" в пикере счетов + "юздт" алиас USDT + промпт-примеры.** (1) `account-inline-keyboard.service.ts` (MODIFY) строка 381Ц383: кнопка `buildAccountPickerV2Keyboard` Ђ?? ќтменаї изменена с `ia:pk:back:{draftId}` > `ia:cancel:{draftId}`. ƒо фикса: нажатие Ђќтменаї возвращало к карточке превью с кнопками [?? »зменить|?? ќтмена]+[?? ¬ыбрать счЄт]. ѕосле фикса: `ia:cancel` handler редактирует сообщение > Ђ? ќтмененої без кнопок, ставит черновику статус `rejected`, чистит Redis. (2) `packages/ai-core/src/prompts.ts` Ч добавлен `"юздт"` в список алиасов USDT (строка 37): было `"юсдт", "тезер", "tether", "usdt"` > стало `"юсдт", "юздт", "тезер", "tether", "usdt"`. (3) `packages/ai-core/src/prompts.ts` Ч добавлены 2 примера в секцию `-- Partial (amount missing) --`: `"купил квартиру юздт"` > `{intent:expense,currency:USDT,item_hint:квартира,confidence:0.75}` и `"купил недвижку usdt"` > `{intent:expense,currency:USDT,item_hint:недвижимость,confidence:0.75}`. ÷ель: Claude теперь возвращает `item_hint` даже когда нет `amount`. tsc 0 ошибок. git commit `ccaec87`, push origin main ?. Railway auto-deploy triggered. |
| 2026-05-14 20:00 | **Phase 2.5+ Ч Currency-Aware Picker: Bot Layer (telegram-bot).** ѕроблема: в пикере счЄтов при USD-транзакции показывалс€ USDT-счЄт, хот€ это стейблкоин и он не конвертируетс€ в фиат. **–еализаци€ (4 файла):** (1) `account-currency-validator.service.ts` Ч добавлена функци€ `isKnownCurrency(code)`: провер€ет код по трЄм вайтлистам (FIAT_SET + STABLECOINS + CRYPTO_SET). ѕредотвращает создание фантомных валют типа ЂUDSї или Ђ≈¬–ї. (2) `clarification.service.ts` Ч в `validateCurrencyCode()` добавлена ранн€€ проверка `!isKnownCurrency(upper)` > возврат `null` до записи в Ѕƒ. (3) `account.service.ts` Ч `getWorkspaceAccountsWithBalances()` получает опциональный 4-й параметр `parsedCurrency?`. ѕосле SQL-запроса: если tx Ч фиат > exact-match сначала + остальные фиатные; если стейблкоин/крипто > только exact match. (4) `account-inline-keyboard.service.ts` Ч `getPickerScreenText(intent, parsedCurrency?)` добавл€ет контекстную подсказку; `getPickerEmptyText(parsedCurrency?)` Ч ЂЌет USDT-счетовї вместо общего сообщени€. `webhook.route.ts` Ч пробрасывает `draft.parsed_currency` в 3 entry points (sendAndStorePreview, ia:delink, ia:showpicker). ѕервый деплой упал Ч TS6133 (ACCOUNT_PICKER_EMPTY_TEXT в импорте но не используетс€). »справлено коммитом `04f7e81`. |
| 2026-05-14 20:10 | **Phase 2.5+ Ч Currency-Aware Picker: Worker Layer (background-workers). Root Cause Fix.** ќбнаружено: начальный пикер строитс€ ѕќЋЌќ—“№ё в `ai-parse.worker.ts` (background-workers), а не в `telegram-bot`. »зменени€ в `account.service.ts` (telegram-bot) на initial picker не вли€ют никак. **–еализаци€ (`ai-parse.worker.ts`):** ƒобавлены локальные классификаторы: `PICKER_STABLECOINS` (10 записей), `PICKER_KNOWN_CRYPTOS` (27 записей), `classifyPickerCcy(code)`, `filterPickerAccounts(accounts, txCurrency)` Ч аналог логики `account.service.ts`. ѕрименено в 2 местах: (A) **Initial picker** (строка ~620) Ч фильтрует по `aiData?.currency` (когда AI вернул currency, например ЂUSDTї); (B) **Gate picker** (строка ~340) Ч фильтрует по `pendingDraft.parsedCurrency` (восстановление пикера при gate-блокировке). »тог фильтрации: `{USD tx}` > [USD-счета] + [другие фиатные]; `{USDT tx}` > [только USDT-счета]. tsc 0 ошибок (оба приложени€). git commit `0085d8f`, push origin main ?. Railway auto-deploy triggered. |


| 2026-05-15 10:35 | **Transaction Hub UX `[Variant D]` Icon Chips (DEPLOYED).** ‘инальное состо€ние фильтров Transaction Hub. ѕроблема: текст кнопок слишком длинный Ч кнопки не влезали. –ешение: `FILTER_LABELS` сведЄн к иконочным чипам. ћакет: `[??][??][??][??][?? ¬се]` Ч 5 компактных кнопок в 1 строку. `IntentFilter`: 5 типов `a/e/i/d/t` (долги dg+dr merged в `d`). SQL: `OR (='d' AND intent IN ('debt_given','debt_received'))`. Toggle: нажатие на активный (?¬се) снимает фильтр. Backward compat: dg/dr > d. tsc 0 ошибок. Commits `f4d7ecd`+`d770ca4`, push ?. Railway auto-deploy. |
| 2026-05-15 10:20 | **Transaction Hub UX Ч 6-Filter Grid 2?3 + CCY Symbol Unification (DEPLOYED).** `transaction-hub.service.ts`: `TX_PAGE_SIZE` 6>5; `IntentFilter` расширен до 6 типов (`'e'|'i'|'dg'|'dr'|'t'|'a'`); `MonthMiniStats` Ч поле `debt_count` заменено трем€: `debt_given_count`, `debt_received_count`, `transfer_count`; SQL-запросы `getTransactionList` и `countFilteredTransactions` обновлены с полной поддержкой dg/dr/t (удалЄн устаревший фильтр `'d'`). `transaction-keyboard.service.ts`: `CCY_SYMBOL` Unicode-карта + `fmtCurrency()` (?/$И? дл€ фиата, ISO дл€ крипты); `intentEmoji` обновлЄн (???? вместо ????); `FILTER_LABELS` 4>6; `FILTER_ROW_1=['e','i','t']` + `FILTER_ROW_2=['dr','dg','a']` Ч сетка 2?3; пагинаци€ Ђ?? ѕозже Ј ?? X/Y Ј –аньше ??ї; `formatTxListHeader` дл€ всех 6 фильтров; `VALID_FILTERS` обновлЄн; fallback `'d'>'a'`. tsc 0 ошибок. 23/23 проверок PASS. Commit `a9c0f52`, push origin main ?. Railway auto-deploy triggered. |
| 2026-05-14 23:50 | **Balance Phase B-5/B-6/B-8/B-9 ? Add Currency Workflow ?????????.** B-8: addChildAccount() ? account.service.ts (withTenantTransaction, parent_account_id, no workspace defaults update). B-6: child_count subquery ? ACCOUNT_DETAIL_SQL; AccountDetailData ??????? child_count. B-5: buildAccountActionsKeyboard(hasChildren?) ?????????? ?????? bl:ac: (32 ?????). webhook.route.ts: add_currency handler + currency_set ????? + 6 ??????? ? detail.child_count>0. B-9: parent_account_id ? GROUP BY PER_ACCOUNT_SQL; ORDER BY ?????????????. tsc 0 ??????. Commits 5ce9148+04e79b8. Railway auto-deploy. |


---

## 11. AGENT OPERATING PROTOCOL Ч ќЅя«ј“≈Ћ№Ќџ… ѕ–ќ÷≈—— –јЅќ“џ

1. Startup Protocol

Every new agent session must start by reading:
- project_config.md
- workflow_state.md
- docs/product-roadmap.md (утверждЄнный план развити€ продукта Ч Phase 1.23Ц2.5)
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
УImplement the whole phase.Ф

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
- Filesystem / Local FS MCP Ч required when reading or editing project files.
- Postgres MCP Ч required only for database/schema/RLS/migration work.
- GitHub MCP Ч required only if working with a remote GitHub repository, branches, pull requests, or issues.
- Context7 MCP Ч useful only when current external library documentation is needed.
- Browser / DevTools MCP Ч useful only during frontend/UI testing phases.
- Notion MCP Ч forbidden until Phase 3.
- Google Sheets integration Ч forbidden until Phase 3.
- Crypto / Blockchain tools Ч forbidden until Phase 2.

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
- `docs/product-roadmap.md` < **источник правды** дл€ следующих фаз (1.23Ц2.5)
- `docs/balance-semantics.md` (дл€ фаз, св€занных с балансом)
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

**“риггеры** Ч запускать аудит только при:
- завершении фазы или крупной подфазы
- прохождении review gate (Traceability / Security / Scope Guard)
- изменении MCP конфигурации
- git checkpoint
- context reset / handoff в новый чат
- перед началом high-risk фазы (DB, security, payments, auth, deploy)

**Ќе запускать** после каждого мелкого таска.

**‘ормат вывода** Ч компактна€ таблица, max 10 строк:

| ѕроверка | —татус |
|---|---|
| ƒата обновлени€ актуальна | ? / ? |
| Section 1 (состо€ние) корректно | ? / ? |
| Section 10 (истори€) актуальна | ? / ? |
| Section 8 (файлы) классифицированы | ? / ? |
| Section 7 (MCP) полна€ | ? / ? |
| Section 6 (scope) соответствует фазе | ? / ? |
| Section 9 (handoff prompt) актуален | ? / ? |
| project_config.md не изменЄн | ? / ? |
| Git working tree clean | ? / ? |
| Ќет scope creep | ? / ? |

ѕри обнаружении `?` Ч исправить немедленно или уведомить владельца.

---

## 15. ѕќЋЌџ… ‘Ћќ” ѕ–ќƒ” “ј (текущее состо€ние)

> Ётот раздел описывает полный путь пользовател€ Ч от первого запуска бота до момента создани€ первой транзакции. ќбновлЄн: 2026-05-11 19:52 (UTC+3).

---

### ?? Ётап 0 Ч ѕервый запуск `/start`

1. ѕользователь пишет `/start` в чат бота.
2. `webhook.route.ts` > `resolveWorkspace()` > вызывает `system_find_or_create_user()` (SECURITY DEFINER, atomic, pg_advisory_xact_lock).
3. —оздаЄтс€: **workspace** (default_currency=USDT, timezone=UTC), **workspace_membership**, **default account_source** (Ђѕо умолчаниюї, USDT), **default category** (ƒругое).
4. Ѕот отправл€ет приветственное сообщение с ReplyKeyboard (`is_persistent: false`, `resize_keyboard: true`):
   ```
   —трока 1: [?? Ѕаланс]  [?? ќтчЄт]
   —трока 2: [?? “ранзакции]  [?? Ќастройки]
   ```
5. ≈сли у пользовател€ **0 счетов** > бот также показывает guided onboarding keyboard (`buildStartOnboardKeyboard`).
6. Greeting-сообщение **никогда не удал€етс€** Ч оно носитель ReplyKeyboard.

---

### ?? Ётап 1 Ч —оздание ѕ≈–¬ќ√ќ счЄта (онбординг)

#### 1.1 ¬ыбор типа счЄта

ѕользователь видит inline-клавиатуру:
```
[?? Ѕанковска€ карта]  [?? Ќаличные]
[??  рипто-биржа]      [??  рипто-кошелЄк]
[?? —воЄ название]
[?? Ќачать без счЄта]
```

**`[?? Ќачать без счЄта]` (ac:skip):**
- ≈сли у пользовател€ **0 счетов** > тихо создаЄтс€ счЄт Ђ ошелЄкї (USD) Ч non-fatal try/catch.
- Redis-ключ `midas:ac:` удал€етс€.
- ѕользователь получает ReplyKeyboard и может сразу вводить транзакции.

#### 1.2 —ценарий ЂЅанковска€ картаї (ac:type:card)

1. FSM переходит в шаг `name_input`.
2. Ѕот показывает промпт ввода названи€ с blockquote-примерами:
   ```
   ¬ведите название банка:
   <blockquote>Ќапример: “инькофф Ј —бербанк Ј јльфа Ј Monobank</blockquote>
   ```
3. ѕользователь вводит текст > `name_input` text interceptor.

**—лучай A Ч fuzzy match найден** (например Ђтинькоффї > Ђ“инькоффї):
- Ѕот показывает экран подтверждени€ с blockquote Ђ“инькоффї.
-  нопки: `[? ƒа, “инькофф]` / `[?? Ќет, изменить]`.
- ≈сли подтверждено > FSM переходит в `cur_pick`.

**—лучай B Ч fuzzy null** (например Ђјбвї):
- Ѕот показывает no-match экран:
  ```
  ?? ѕохожего банка не нашли.
  <blockquote>Ђјбвї</blockquote>
  ’отите создать счЄт с таким названием?
  ```
-  нопки:
  - `[? —оздать Ђјбвї]` (ac:cus:save) > сохран€ет как `pendingName`, `isCustomName=true`, переходит в `cur_pick`.
  - `[?? »зменить название]` (ac:cus:keep) > возврат в `name_input`.
  - `[??   типу счЄта]` (ac:type:back) > возврат на стартовый экран.

#### 1.3 —ценарий ЂЌаличныеї (ac:type:cash)

- Ќазвание формируетс€ автоматически: ЂЌаличные {CURRENCY}ї (им€ счЄта создаЄтс€ после выбора валюты).
- ѕользователь сразу видит currency picker (шаг `cur_pick`).
- **Ќет экрана ввода названи€.**

#### 1.4 —ценарий Ђ рипто-биржаї / Ђ рипто-кошелЄкї

- ** рипто-биржа (ac:type:exchange):** ѕоказывает paginated picker бирж (5 пресетов: Binance/Bybit/OKX/Kraken/Huobi + ?? —во€).
- ** рипто-кошелЄк (ac:type:wallet):** ѕоказывает sub-picker: crypto / e-wallet / TON / Lightning.
  - Lightning > фиксированна€ валюта BTC, минует currency picker.
  - ќстальные > идут в crypto currency picker.
- Paginated pickers банков/бирж Ч навигаци€ `[??][N / Total][??]`, всегда обе стрелки (noop на кра€х).

---

### ?? Ётап 2 Ч ¬ыбор валюты (шаг `cur_pick`)

ѕользователь видит:
```
¬ какой валюте открыть счЄт Ђ“инькоффї?

[???? RUB]  [???? USD]  [???? EUR]
[???? GBP]  [???? TRY]  [? BTC]
[??] [1 / 2] [??]
[?? Ќайти валюту]
```

ƒл€ кастомных счЄтов (`isCustomName=true`) текст: Ђƒл€ вашего счЄта (свой счЄт)ї.

** нопка `[?? Ќайти валюту]` (ac:cur:search):**
1. FSM переходит в шаг `cur_search`.
2. Ѕот показывает промпт:
   ```
   ?? ѕоиск валюты дл€ счЄта Ђ“инькоффї
   ¬ведите код или название: RUB, доллар, bitcoin...
   ```
3. ѕользователь вводит текст > `cur_search` text interceptor.
4. `searchCurrencies(query, pool)` Ч fuzzy + транслитераци€ (rub/руб > RUB, dollar/доллар > USD, btc > BTC).
5. **Ќайдено:** показывает кнопки результатов + `[?? ¬ернутьс€ к списку]` (ac:cur:list).
6. **Ќе найдено:** Ђ“акой валюты нет. ѕопробуйте: USD, RUB, BTC...ї.

**¬ыбор валюты (ac:cur:{CODE}):**
- —чЄт создаЄтс€ в Ѕƒ: `addAccountWithCurrency(workspaceId, userId, name, currency)` > INSERT в `account_sources`, тип `manual`.
- FSM переходит в шаг `bal_input`.

---

### ?? Ётап 3 Ч ¬вод начального баланса (шаг `bal_input`)

```
?? —чЄт Ђ“инькоффї (RUB) создан!
¬ведите начальный баланс или пропустите:

[? ѕропустить]
```

- **¬вод числа** > text interceptor `bal_input` > `setAccountBalanceById()` > `initial_balance` в Ѕƒ.
- **`[? ѕропустить]`** (ac:bal:s) > баланс остаЄтс€ 0.

ѕосле ввода/пропуска Ч **success screen** (без кнопок, только текст):
```
? —чЄт создан!
?? “инькофф Ј RUB
Ќачальный баланс: 15 000 ?
```
«атем сразу Ч пикер типа дл€ добавлени€ следующего счЄта (`buildFinishOnboardKeyboard`):
```
[?? Ѕанковска€ карта]  [?? Ќаличные]
[??  рипто-биржа]      [??  рипто-кошелЄк]
[?? —воЄ название]
[? «авершить]
```

---

### ? Ётап 4 Ч —оздание ¬“ќ–ќ√ќ счЄта (необ€зательно)

ѕользователь нажимает любой тип в `buildFinishOnboardKeyboard` > повтор€ет Ётапы 1Ц3.

**ѕример двух счетов:**
1. Ђ“инькоффї > RUB > баланс 15 000 (банковска€ карта)
2. ЂЌаличные RUBї > RUB > баланс 5 000 (наличные, им€ авто)

‘лоу Ќаличных (второй счЄт):
- Ќажать `[?? Ќаличные]` > сразу currency picker (нет name_input) > выбрать `[???? RUB]` > ввести баланс `5000` > success screen.

ѕосле Ч снова `buildFinishOnboardKeyboard`. ѕользователь нажимает `[? «авершить]` (ac:fin):
- Redis-ключ `midas:ac:` очищаетс€.
- —ообщение удал€етс€ (`deleteMessage`).
- ќтправл€етс€ `sendMessageWithReplyKeyboard` Ч ReplyKeyboard по€вл€етс€ снова.
- ≈сли пришЄл из баланс-дашборда (`bl:source` в Redis) > возврат в баланс. »наче Ч финальный экран Ђ¬сЄ готово!ї.

---

### ?? Ётап 5 Ч ѕерва€ транзакци€ (ввод расхода)

#### 5.1 ¬вод свободным текстом

ѕользователь просто **пишет в чат** (не команда, не кнопка):
```
кофе 150 рублей
```

**ћаршрут:**
1. `webhook.route.ts` Ч сообщение проходит все text interceptors (нет активных Redis-ключей).
2. ѕопадает в раздел AI parse > `addJobToWebhookIngestionQueue()`.
3. **`webhook-ingestion` worker** (BullMQ) > `ai-parse.worker.ts`.

#### 5.2 AI parse pipeline

1. `parseTransaction(text)` > Claude Haiku 4.5, `temperature: 0`, `max_tokens: 256`.
2. System prompt: MULTILINGUAL RECOGNITION (RU/EN/UA) + FUZZY MATCHING + 30-категорийна€ таксономи€ + 500+ €корных слов + DISAMBIGUATION RULES.
3. **–езультат:**
   ```json
   { "intent": "expense", "amount": "150", "currency": "RUB", "category_hint": " афе и рестораны", "confidence": 0.95 }
   ```
4. Post-processing (safety net): 7 групп regex, negation guard, confidence boost.
5. `ALLOWED_CATEGORIES` валидаци€: если `category_hint` ? set > замен€етс€ на Ђƒругоеї.
6. `CategoryResolverService`: exact DB match > 200+ alias map > fallback.
7. **Dead card cleanup:** если в Redis есть `midas:dead_card:{chatId}` (стара€ ? карточка) > `deleteMessage` перед отправкой preview.

#### 5.3 —оздание черновика и preview

1. `createDraft()` > INSERT в `transaction_drafts` (статус `pending_user`).
2. `notifications.worker` > отправл€ет preview-карточку в чат:
   ```
   ?  афе и рестораны
   –асход Ј 150 ?
   [? «аписать]  
   [?? »зменить] [?? ќтмена]
   ```
3. `midas:preview:{draftId}` (TTL 600s) > сохран€ет message_id карточки.

#### 5.4 ѕодтверждение

**ѕользователь нажимает `[? «аписать]`:**
1. `callback_query` > `confirmation.worker`.
2. SELECT FOR UPDATE SKIP LOCKED > атомарна€ защита от двойного подтверждени€.
3. INSERT в `transactions` (intent=expense, category= афе и рестораны, base_amount=150, currency=RUB, account_id=“инькофф, base_currency=RUB).
4. `confirmation.worker` читает `midas:preview:{draftId}` > `editMessageText` > preview превращаетс€ в confirmed card:
   ```
   ? «аписано!
   ?  афе и рестораны
   –асход Ј 150 ? Ј “инькофф
   [?? »зменить запись]
   ```
5. `midas:preview:{draftId}` удал€етс€ из Redis.

**ѕользователь нажимает `[?? ќтмена]`:**
- `draft_status` > `rejected`.
- preview-карточка редактируетс€ > Ђ? ќтмененої.
- —охран€етс€ в `midas:dead_card:{chatId}` (TTL 24h) Ч автоудалитс€ при следующем preview.

#### 5.5 ≈сли Claude не распознал валюту (awaiting_cur)

- `midas:awaiting_cur:{chatId}` (TTL 600s) создаЄтс€ если есть сумма но нет валюты и нет `midas:cur_set:{workspaceId}`.
- —ледующий текст пользовател€ перехватываетс€ как валюта: Ђеврої > EUR, Ђ150 рубї > RUB.

#### 5.6 ≈сли Claude вернул partial (нет суммы)

- `needs_clarification` статус черновика.
- ѕользователю задаЄтс€ вопрос: Ђ ака€ сумма?ї.
- `midas:clar:{userId}:{chatId}` (TTL 300s) > следующее число Ч сумма.

---

### ?? »тогова€ схема: ключевые сущности

```
workspaces
  L-- workspace_memberships (telegramUserId > workspaceId)
  L-- account_sources (“инькофф/RUB, Ќаличные/RUB)
  L-- categories ( афе и рестораны, ѕродукты, ...)
  L-- transaction_drafts (pending > approved/rejected/expired)
  L-- transactions (confirmed расходы/доходы)
```

### ?? Redis-ключи в активном онбординге

|  люч | TTL | Ќазначение |
|---|---|---|
| `midas:ac:{userId}:{chatId}` | 300s | State машина онбординга (step, name, currency, pendingName, isCustomName, cur_search) |
| `bl:source:{userId}:{chatId}` | 300s | ‘лаг: онбординг инициирован из баланс-дашборда |
| `midas:preview:{draftId}` | 600s | message_id preview-карточки |
| `midas:dead_card:{chatId}` | 24h | message_id карточки ? дл€ автоудалени€ |
| `midas:awaiting_cur:{chatId}` | 600s | ќжидание ввода валюты |
| `midas:clar:{userId}:{chatId}` | 300s | ќжидание ввода суммы при clarification |
| `midas:cur_set:{workspaceId}` | - | ‘лаг установленной валюты (не запрашивать повторно) |

---

## 16. ACTIVE ROADMAP Ч  ”ƒј ƒ¬»√ј≈ћ—я ƒјЋ№Ў≈

> Ётот раздел Ч живой документ. ќбновл€етс€ при завершении каждой фазы.
> ѕоследнее обновление: 2026-05-13 11:24 (UTC+3)

### ? «авершено в Phase 2.5 (Smart Transaction Logic)

| Ўаг | „то сделано | —татус |
|---|---|---|
| Ўаг 1 | `item-category-detector.service.ts` Ч авто-определение категории по названию товара/бренда (200+ записей, 9 категорий, Maybach>“ранспорт) | ? |
| Ўаг 2 | `account-currency-validator.service.ts` Ч блокировка несовместимых пар счЄт+валюта (Ѕанк+USDT = ?, Ѕиржа+USDT = ?) | ? |
| Ўаг 3 | `anomalyBadge()` в пикерах Ч визуальный `??` дл€ подозрительных существующих счетов | ? |
| Ўаг 4 | `ai-parse.worker.ts` Ч фикс ЂActive Draft Gateї: вывод Account/XFX-зависимых UI компонентов при активном черновике | ? |

### ? «авершено в Phase 2.5+ (Currency-Aware Account Picker)

> **ѕроблема:** USDT-счЄт отображалс€ в пикере при USD-транзакции. ѕричина Ч начальный пикер строитс€ в `background-workers`, а не в `telegram-bot`, поэтому изменени€ в `account.service.ts` (telegram-bot) на него не вли€ли.

| Ўаг | ‘айл | „то сделано | —татус |
|---|---|---|---|
| 1 | `account-currency-validator.service.ts` | `isKnownCurrency()` Ч вайтлист-защита от фантомных валют (UDS, ≈¬–) | ? |
| 2 | `clarification.service.ts` | `validateCurrencyCode()` > ранн€€ проверка `isKnownCurrency()` перед записью в Ѕƒ | ? |
| 3 | `account.service.ts` | `getWorkspaceAccountsWithBalances(parsedCurrency?)` Ч фильтр: фиат>фиатный пул, стейблкоин/крипто>exact only | ? |
| 4 | `account-inline-keyboard.service.ts` |  онтекстные подсказки и `getPickerEmptyText(parsedCurrency?)` | ? |
| 5 | `webhook.route.ts` | ѕробрасывает `parsed_currency` в 3 entry points (preview, delink, showpicker) | ? |
| 6 ? | `ai-parse.worker.ts` | **Root-cause fix:** `filterPickerAccounts()` + `classifyPickerCcy()` применены к initial picker (`aiData.currency`) и gate picker (`pendingDraft.parsedCurrency`) | ? |

**јрхитектурный урок:** ¬ Midas два независимых пайплайна пикера. Ћюбые изменени€ логики пикера требуют обновлени€ ќЅќ»’ приложений:
- `apps/telegram-bot` Ч пикеры навигации (ia:delink, ia:showpicker)
- `apps/background-workers` Ч начальный пикер после AI parse

---

### ?? Phase 3.0 Ч DB Schema: ѕолна€ архитектурна€ валидаци€ (ќЅя«ј“≈Ћ№Ќќ)

> **ѕриоритет: ¬џ—ќ »….** “екуща€ валидаци€ (Ўаг 2) Ч эвристическа€, основана на `AccountOnboardState` из Redis.
> ≈сли Redis-ключ истЄк или пользователь создаЄт счЄт нестандартным путЄм Ч тип счЄта неизвестен.
> Phase 3.0 переводит систему на **100% надЄжную, схема-enforced валидацию**.

#### „то нужно сделать

**ћиграци€ Ѕƒ:**
```sql
ALTER TABLE account_sources
  ADD COLUMN account_type    TEXT CHECK (account_type IN ('card','cash','exchange','wallet','custom')),
  ADD COLUMN wallet_subtype  TEXT CHECK (wallet_subtype IN ('crypto','ewallet','ton','lightning')),
  ADD COLUMN provider_key    TEXT;  -- 'mono', 'binance', 'payeer', etc. (lowercase)
```

**«аполнение при создании счЄта:**
- ¬ `account.service.ts` > `addAccountReturningId()` и `addAccountWithCurrency()`:
  принимать `accountType`, `walletSubtype`, `providerKey` из `AccountOnboardState` и записывать в Ѕƒ.
- ¬ `webhook.route.ts` > `cmd=currency` handler: передавать `state.accountType`, `state.walletSubtype`, `state.name.toLowerCase()` как `providerKey`.

**»спользование при транзакци€х:**
- `buildAccountPickerForDraft` и `buildAccountPickerV2Keyboard`:
  вместо эвристики по имени > читать `account_type` из Ѕƒ, передавать в `validateAccountCurrency()`.
  Ёто делает `??` badge на 100% точным.

**–етроактивное заполнение (опционально):**
- ѕопытатьс€ вывести `account_type` из существующих названий счетов через матч с `BANK_PRESETS`/`EWALLET_PRESETS`/`EXCHANGE_PRESETS`.
- ¬се что не подошло > `account_type = 'custom'`.

#### ‘айлы дл€ изменени€

| ‘айл | »зменение |
|---|---|
| `packages/database/migrations/XXXXXXX_account-sources-type-columns.js` | NEW Ч ALTER TABLE |
| `apps/telegram-bot/src/services/account.service.ts` | MODIFY Ч расширить сигнатуры addAccount* |
| `apps/telegram-bot/src/routes/webhook.route.ts` | MODIFY Ч передавать тип в addAccount* |
| `apps/telegram-bot/src/services/account-inline-keyboard.service.ts` | MODIFY Ч читать тип из Ѕƒ вместо эвристики |
| `apps/telegram-bot/src/services/account-currency-validator.service.ts` | MODIFY Ч убрать провайдер-хинт из сигнатуры (теперь из Ѕƒ) |

#### ќценка работы
- ~3Ц4 часа (миграци€ + сигнатуры + интеграци€ + smoke test)
- Ѕез breaking changes в UX Ч изменени€ только в слое данных

---

### ?? Phase 3.1 Ч –асширение словар€ детектора категорий

> **ѕриоритет: —–≈ƒЌ»….** “екущий словарь: 200+ записей, 9 категорий.
> ÷ель: расширить до 500+ записей, добавить локальные бренды (UA/KZ/UZ/BY).

- ƒобавить категории: `ѕутешестви€`, `ѕодарки`, `ѕитомцы`, `»нвестиции`
- ƒобавить 150+ локальных брендов: ј“Ѕ, —≥льпо, Kaspi, OLX, Wildberries, Ozon, —ƒЁ 
- ƒобавить транслитерацию: Ђstarbaksї > Starbucks, Ђmakї > McDonald's

---

### ?? Phase 3.2 Ч ќтчЄт 3.0:  атегорийна€ аналитика

> **ѕриоритет: —–≈ƒЌ»….** “екущий `/report` показывает только суммы по intent.
> ƒобавить разбивку по категори€м + топ-5 трат за период.

```
?? ќтчЄт за май 2026

?? –асходы: 45 000 UAH
  ?? “ранспорт: 12 000 (27%)
  ?? ≈да: 8 500 (19%)
  ?? Ёлектроника: 15 000 (33%)
  ?? ƒругое: 9 500 (21%)

?? ƒоходы: 120 000 UAH
```

---

### ?? Phase 4.0 Ч Telegram Mini App (Frontend)

> **ѕриоритет: Ќ»« »… / Ѕ”ƒ”ў≈≈.** React 19 + Vite 8.
> ¬изуальный дашборд баланса, диаграммы расходов по категори€м, истори€ транзакций.
> **Ќе начинать до завершени€ Phase 3.0 + 3.1.**

---

### —водна€ таблица приоритетов

| ‘аза | Ќазвание | ѕриоритет | —татус | “ребует |
|---|---|---|---|| 2026-05-15 09:20 | **Balance UI Polish B-9+ Ч compact text layout + Add Currency fix.** alance.service.ts: (1) Compact text Ч убраны пустые строки между счЄтами внутри секции и между заголовком и первым счЄтом; GROUP_LABEL > Title Case (не ALL CAPS); роль-бейджи сокращены до иконок. (2) ACCOUNT_DETAIL_SQL + GROUP BY обновлены Ч добавлен .parent_account_id; AccountDetailRow/AccountDetailData + parent_account_id: string | null. alance-keyboard.service.ts: uildAccountActionsKeyboard Ч параметр переименован hasChildren > canAddCurrency, кнопка Ђƒобавить валютуї показываетс€ дл€ ¬—≈’ top-level счЄтов (parent_account_id === null), не только имеющих детей. webhook.route.ts: 7 вызовов uildAccountActionsKeyboard Ч условие detail.child_count > 0 заменено на detail.parent_account_id === null. tsc 0 ошибок. Commits cb37de6. Railway auto-deploy. |
| 2026-05-15 09:30 | **Balance UI Polish Ч N26/Revolut professional redesign.** alance.service.ts: (1) Ќовый формат Ч 1 счЄт = 1 строка Ђјльфа-Ѕанк (? основной) Ј 22 010 213 ?ї вместо 2-строчного ЂL balance currencyї. (2) “аблица CCY_SYMBOL Ч символы валют ? $ И ? ? ? И (17 валют) вместо кодов. (3) oleSuffix Ч роль суффиксом <i>(? основной)</i> после имени (Variant A). (4) «аголовок ?? Ѕаланс > ?? Ѕаланс (совпадает с reply-keyboard). alance-keyboard.service.ts: (1) GROUP_EMOJI обновлены Ч ?? биржи, ?? кошельки, ?? прочее. (2) GROUP_LABEL > Title Case. (3)  нопки Ч CCY_SYM таблица символов; роль-суффикс ' ?' (icon-only, без скобок и текста). tsc 0 ошибок. Commits c4ba46c, 0b6530, 21e0a6f. Railway auto-deploy. |

---|
| **3.0** | DB Schema: account_type/wallet_subtype | ?? ¬џ—ќ »… | ? —ледующа€ | Phase 2.5 ? |
| **3.1** | –асширение словар€ детектора | ?? —–≈ƒЌ»… | ?? «апланирована | Phase 3.0 |
| **3.2** | ќтчЄт 3.0: категорийна€ аналитика | ?? —–≈ƒЌ»… | ?? «апланирована | Phase 3.0 |
| **4.0** | Telegram Mini App | ?? Ќ»« »… | ?? Ѕудущее | Phase 3.x |

