# WORKFLOW_STATE.MD — Диспетчер задач ИИ-агента Midas

> **Тип:** MUTABLE — кратковременная память агента. Обновляется на каждом шаге работы.
> **Обновлён:** 2026-05-04 22:30

---

## 1. ТЕКУЩЕЕ СОСТОЯНИЕ

| Параметр | Значение |
|---|---|
| **PHASE** | `1 — MVP Implementation` |
| **STEP** | `1.2 — Database Foundation (PENDING APPROVAL)` |
| **AGENT STATUS** | `WAITING_FOR_OWNER_APPROVAL_TO_START_PHASE_1_2` |
| **LAST COMPLETED** | `Phase 1.1 — Project Infrastructure Foundation` |
| **BLOCKER** | Начать Phase 1.2 только после одобрения владельца в новом чате |

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

| MCP-сервер | Нужен? | Когда |
|---|---|---|
| Local FS / GitHub MCP | ✅ Да | Перед продолжением |
| Postgres MCP | ✅ Да | Во время Phase 1.2 |
| Notion MCP | ❌ Нет | Phase 3 |

---

## 8. ФАЙЛЫ ДЛЯ ЧТЕНИЯ В НОВОМ ЧАТЕ

```
project_config.md
workflow_state.md
docs/phase1_scope.md
docs/database_model_draft.md
docs/queue_model.md
docs/mvp_acceptance_criteria.md
docs/adr/ADR-003-workspace-model.md
docs/adr/ADR-004-ulid-primary-keys.md
docs/adr/ADR-009-exchange-rate-snapshot.md
docs/adr/ADR-013-draft-ttl-cleanup.md
docs/adr/ADR-014-task-queue-bullmq.md
```

---

## 9. ПРОМПТ ДЛЯ СТАРТА НОВОГО ЧАТА

> Read workflow_state.md and project_config.md first.
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
