# WORKFLOW_STATE.MD — Диспетчер задач ИИ-агента Midas

> **Тип:** MUTABLE — кратковременная память агента. Обновляется на каждом шаге работы.
> **Обновлён:** 2026-05-05 12:11

---

## 1. ТЕКУЩЕЕ СОСТОЯНИЕ

| Параметр | Значение |
|---|---|
| **PHASE** | `1 — MVP Implementation` |
| **STEP** | `1.2 — Database Foundation (PENDING APPROVAL)` |
| **AGENT STATUS** | `WAITING_FOR_OWNER_APPROVAL_TO_START_PHASE_1_2` |
| **LAST COMPLETED** | `Phase 1.1 — Project Infrastructure Foundation` |
| **BLOCKER** | Начать Phase 1.2 только после одобрения владельца в новом чате |
| **NEXT ACTION** | Открыть новый чат для Phase 1.2 с handoff prompt из Section 9 |

---

## 2. ЗАВЕРШЁННЫЕ ФАЗЫ

| Фаза | Статус | Ключевые артефакты |
|---|---|---|
| 0.1 Event Storming | ✅ | `docs/event_storming_part{1,2,3}.md` |
| 0.2 ADR Generation | ✅ | `docs/adr/ADR-000` — `ADR-014` (15 ADR) |
| 0.3 Implementation Readiness Gate | ✅ | `phase1_scope.md`, `database_model_draft.md`, `queue_model.md`, `mvp_acceptance_criteria.md` |
| 0.3.1 Security & Traceability Patch | ✅ | SEC-01 — SEC-12 внесены в scope, DB model, queue model, acceptance criteria, ADR-009, ADR-013 |
| 1.1 Project Infrastructure Foundation | ✅ | `midas-monorepo/` — полная структура Turborepo, Docker Compose, ESLint, TypeScript |

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

## 6. NEXT STEP — PHASE 1.2: DATABASE FOUNDATION

**Scope:** Работа только внутри `packages/database/` и docker-compose.

### Задачи:
- [ ] Создать структуру миграций
- [ ] Создать начальную PostgreSQL-схему для MVP-сущностей
- [ ] Реализовать DB roles и low-privilege application role
- [ ] Реализовать RLS-политики
- [ ] Реализовать `withTenantTransaction(workspaceId, fn)`
- [ ] Реализовать tenant context injection (`SET LOCAL app.workspace_id`)
- [ ] Реализовать Decimal / NUMERIC boundary rules (`pg.types.setTypeParser`)
- [ ] Тесты: RLS isolation, tenant transaction wrapper, Decimal handling, atomic draft transitions

### MVP-сущности (Phase 1.2):
- `workspaces`
- `users`
- `workspace_memberships`
- `account_sources`
- `categories`
- `persons`
- `transaction_drafts`
- `transactions`
- `exchange_rate_snapshots`
- `audit_logs`
- `loans` (схема только, без бизнес-логики)

### Запрещённый scope (Phase 1.2):
- ❌ Telegram bot business logic
- ❌ AI parser implementation
- ❌ Inline keyboard flow
- ❌ Reports
- ❌ Crypto / blockchain
- ❌ Google Sheets / Notion
- ❌ Mini App dashboards
- ❌ PDF reports
- ❌ Изменение project_config.md

---

## 7. MCP REQUIREMENTS (для следующего чата)

| MCP-сервер | Phase 1.2 | Когда разрешён |
|---|---|---|
| Filesystem MCP | ✅ Требуется | Все фазы |
| Postgres MCP | ✅ Требуется | Phase 1.2+ (DB/schema work) |
| GitHub MCP | ⚪ По необходимости | Если remote repo настроен |
| Context7 MCP | ⚪ По необходимости | Если нужна документация библиотек |
| Browser / DevTools | ❌ Не нужен | Phase 4 (Mini App) |
| Notion MCP | ❌ Запрещён | Phase 3 |
| Google Sheets | ❌ Запрещён | Phase 3 |
| Crypto / Blockchain | ❌ Запрещён | Phase 2 |

---

## 8. ФАЙЛЫ ДЛЯ ЧТЕНИЯ В НОВОМ ЧАТЕ (Phase 1.2)

**Required (читать обязательно):**
```
project_config.md
workflow_state.md
docs/phase1_scope.md
docs/database_model_draft.md
docs/mvp_acceptance_criteria.md
```

**Optional (читать при необходимости):**
```
docs/queue_model.md
docs/adr/ADR-003-workspace-model.md
docs/adr/ADR-004-ulid-primary-keys.md
docs/adr/ADR-009-exchange-rate-snapshot.md
docs/adr/ADR-013-draft-ttl-cleanup.md
docs/adr/ADR-014-task-queue-bullmq.md
```

**Do not load (не читать — тратит контекст):**
```
docs/event_storming_part*.md
docs/client-roadmap-architecture-overview.md
docs/adr/ADR-000-*.md (meta)
docs/adr/ADR-001-*.md (runtime — уже принято)
docs/adr/ADR-002-*.md (frontend — future phase)
Любые файлы из apps/telegram-bot/, apps/background-workers/, packages/ai-core/
```

---

## 9. ПРОМПТ ДЛЯ СТАРТА НОВОГО ЧАТА

> Read workflow_state.md and project_config.md first.
> Before implementation, read workflow_state.md section 11 — Agent Operating Protocol and follow it strictly.
> Continue only with Phase 1.2 Database Foundation.
> Do not modify project_config.md.
> Do not implement future phases.

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
