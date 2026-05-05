# ADR-014: Task Queue — BullMQ (Node.js)

**Статус:** ACCEPTED
**Дата:** 2026-05-04

---

## Контекст

ТЗ (§2) указывает Celery + Redis. Celery — Python-only и несовместим с решением ADR-001 (Node.js + TypeScript). Требуется Node.js-native замена с аналогичными возможностями: delayed jobs, repeatable jobs, retries, priority queues, DLQ. (Event Storming R-09)

## Рассмотренные варианты

| Критерий | Celery (Python) | BullMQ (Node.js) | Agenda (MongoDB) | Redis Streams (raw) |
|---|---|---|---|---|
| Runtime | Python ❌ | Node.js ✅ | Node.js ✅ | Any ✅ |
| Backed by | Redis/RabbitMQ | Redis | MongoDB | Redis |
| TypeScript | ❌ | ✅ First-class | ⚠️ | ❌ Manual |
| Delayed jobs | ✅ | ✅ | ✅ | ⚠️ Manual |
| Repeatable (CRON) | ✅ (celery-beat) | ✅ Built-in | ✅ | ❌ |
| Dashboard | Flower | Bull Board | ❌ | ❌ |
| Priority queues | ✅ | ✅ | ❌ | ❌ |
| Rate limiting | ❌ Plugin | ✅ Built-in | ❌ | ❌ |
| Maturity | Высокая | Высокая | Средняя | Низкая |

## Решение

**BullMQ** — Redis-backed job queue для Node.js с TypeScript support.

### Queues

| Queue name | Purpose | Concurrency | Rate limit |
|---|---|---|---|
| `reports` | PDF, инфографика, текстовые отчёты | 2 | — |
| `blockchain` | Confirmation polling, historical import | 5 | 10/min per provider |
| `sync` | Google Sheets, Notion sync | 3 | Respect provider limits |
| `notifications` | Alerts, loan reminders, auto-reports | 5 | — |
| `ai` | Claude Haiku parsing (если async) | 3 | Per API tier |

### Features используемые

- **Repeatable jobs**: CRON-расписание автоотчётов, blockchain polling
- **Delayed jobs**: retry с exponential backoff
- **Rate limiting**: per-provider API rate limits
- **Events**: progress tracking, completion notifications
- **Bull Board**: UI dashboard для мониторинга queues в dev/staging

## Последствия

- Celery полностью исключён
- `bullmq` + `@bull-board/express` — в dependencies
- Redis используется совместно: cache + locks (Redlock) + queues (BullMQ)
- Redis keyspace isolation: `bull:` prefix для queues, `lock:` для Redlock, `cache:` для кэша
- Shared types: job payload interfaces в `packages/shared-types/`
