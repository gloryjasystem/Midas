# WORKFLOW_STATE.MD — Диспетчер задач ИИ-агента Midas

> **Тип:** MUTABLE — кратковременная память агента. Обновляется на каждом шаге работы.
> **Обновлён:** 2026-05-06 11:55 (UTC+3)

---

## 1. ТЕКУЩЕЕ СОСТОЯНИЕ

| Параметр | Значение |
|---|---|
| **PHASE** | `1 — MVP Implementation` |
| **STEP** | `1.10 — Slash-Command Guard + Inline /help ACCEPTED` |
| **AGENT STATUS** | `WAITING_FOR_OWNER_APPROVAL_TO_START_NEXT_PHASE` |
| **LAST COMPLETED** | `Phase 1.10 ACCEPTED. Final verification: 30/30 Phase 1.10 + 47/47 Phase 1.9 + 16/16 Phase 1.8-B + 19/19 Phase 1.8-A + 20/20 Phase 1.7 + 30/30 Phase 1.6-B + 73/73 Phase 1.6-A + 13/13 typecheck+lint = 248/248 PASS. Implementation commit b321463; tag phase-1.10-accepted pushed.` |
| **BLOCKER** | Owner approval required to start Phase 1.11 |
| **NEXT ACTION** | Prepare next phase advisory only — do not implement |

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

---

## 4. PROJECT_CONFIG STATUS

- `project_config.md` версия **v1.2**
- v1.2 включает: Security & Traceability Patch Gate acceptance
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
│   ├── database/              # @midas/database
│   ├── shared/                # @midas/shared
│   └── ai-core/               # @midas/ai-core
├── docker-compose.yml         # PostgreSQL 18 + Redis 8
├── turbo.json                 # Turborepo pipeline
├── tsconfig.base.json         # ES2024, strict, noUncheckedIndexedAccess
├── eslint.config.mjs          # Strict TS + SEC-02 (parseFloat/Number ban)
├── .prettierrc
├── .env.example
├── .gitignore
├── pnpm-workspace.yaml
└── package.json               # pnpm 10.8.1, Node.js >=24
```

- `pnpm install` — 6 workspace projects resolved ✅
- `npx turbo typecheck` — 8/8 tasks passed, 0 errors ✅
- SEC-02 ESLint rule active for financial paths ✅
- Бизнес-логика НЕ реализована (только скелеты)

---

## 6. ТЕКУЩАЯ ФАЗА — PHASE 1.10: SLASH-COMMAND GUARD + INLINE /help

> ✅ **ACCEPTED. Implementation commit `b321463`. Tag `phase-1.10-accepted` pushed.**

**Результат:**
- `parseCommandToken(text)` — новая helper-функция в `webhook.route.ts`.
  Парсит первый токен сообщения; `@BotName` суффикс стрипается; `/reportabc` ≠ `/report` (точный токен).
- `KNOWN_COMMANDS = new Set(['/start', '/report', '/help'])` — множество реализованных команд.
- `/help` (5d) — отвечает русским текстом со списком 3 команд, не лезет в AI parse.
- Slash-command guard (5e) — любая команда с `/`, не входящая в `KNOWN_COMMANDS`, возвращает:
  `"Команда не распознана или пока находится в разработке."` — без AI parse, без enqueue.
- Свободный текст (без `/`) — падает в AI parse ровно как и прежде (без изменений).
- `/start` и `/report` — переработаны в блок `if (commandToken !== null)` (поведение не изменилось).
- Нет command-registry.ts, нет рефакторинга роутинга, нет новых зависимостей.
- Нет `/balance`, `/category`, `/add_category`, нет миграций, нет изменений AI.
- Tests: 248/248 PASS (30 Phase 1.10 + 47 Phase 1.9 + 16 Phase 1.8-B + 19 Phase 1.8-A + 20 Phase 1.7 + 30 Phase 1.6-B + 73 Phase 1.6-A + 13 typecheck+lint)
- Traceability ✅ Adversarial Security ✅ Scope Guard ✅

---

## 7. MCP REQUIREMENTS (Phase 1.10 — acceptance audit)

| MCP-сервер | Доступ | Примечание |
|---|---|---|
| Filesystem MCP | ✅ read-only | Чтение файлов для аудита. Никаких записей. |
| Postgres MCP | ⚪ не нужен | Phase 1.10 не добавляет SQL / миграций |
| GitHub MCP | ⚪ read-only (опционально) | Если нужно проверить remote |
| Browser / DevTools | ❌ Запрещён | — |
| Notion MCP | ❌ Запрещён | — |
| Google Sheets | ❌ Запрещён | — |
| Crypto / Blockchain | ❌ Запрещён | — |

---

## 8. ФАЙЛЫ ДЛЯ ЧТЕНИЯ В НОВОМ ЧАТЕ (Phase 1.10 acceptance audit)

**Required (читать обязательно):**
```
project_config.md
workflow_state.md
apps/telegram-bot/src/routes/webhook.route.ts          # Phase 1.10: parseCommandToken, KNOWN_COMMANDS, /help, guard
packages/database/smoke-test-phase110.mjs              # Phase 1.10 tests (30 tests, no DB)
```

**Optional (читать при необходимости):**
```
apps/telegram-bot/src/services/report.service.ts       # Phase 1.9 report logic (referenced in route)
packages/database/smoke-test-phase19.mjs               # Phase 1.9 regression
```

**Do not load (не читать — тратит контекст):**
```
docs/event_storming_part*.md
docs/client-roadmap-architecture-overview.md
docs/adr/*
packages/ai-core/
packages/database/smoke-test-phase16{a,b}.mjs
packages/database/smoke-test-phase17.mjs
packages/database/smoke-test-phase18{a,b}.mjs
Crypto / Notion / Sheets / Mini App files
```

---

## 9. ПРОМПТ ДЛЯ СТАРТА НОВОГО ЧАТА

> Read workflow_state.md and project_config.md first.
> Before implementation, read workflow_state.md section 11 — Agent Operating Protocol and follow it strictly.
> Phase 1.9 (Basic Text /report Command) is ACCEPTED. Tag `phase-1.9-accepted` pushed.
> Phase 1.10 (Slash-Command Guard + Inline /help) is ACCEPTED. Commit `b321463`. Tag `phase-1.10-accepted` pushed.
> Do not re-implement Phase 1.10. Do not implement Phase 1.11 without owner APPROVED.
> Prepare next phase advisory only — do not implement.

---

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

---

## 11. AGENT OPERATING PROTOCOL — ОБЯЗАТЕЛЬНЫЙ ПРОЦЕСС РАБОТЫ

1. Startup Protocol

Every new agent session must start by reading:
- project_config.md
- workflow_state.md
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
...
Optional files:
...
Do not load:
...

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
