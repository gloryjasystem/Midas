# ADR-012: Background Workers Architecture

**Статус:** ACCEPTED
**Дата:** 2026-05-04

---

## Контекст

Midas имеет тяжёлые задачи: PDF-генерация, инфографика, CRON-рассылки, блокчейн-polling, Google Sheets sync. Выполнение в основном Event Loop бота заблокирует обработку сообщений пользователей. (МП §Этап5, PC §5.3, Event Storming Flow 6)

## Рассмотренные варианты

| Вариант | Плюсы | Минусы |
|---|---|---|
| Worker Threads в процессе бота | Простота деплоя | Shared memory risks, OOM kills бота |
| Dedicated background-workers service (ВЫБРАН) | Изоляция, независимое масштабирование | Отдельный контейнер |
| Отдельный Python-микросервис | Лучшие ML/report библиотеки | Два runtime, сложность |

## Решение

**Dedicated `apps/background-workers/` сервис** в монорепо, использующий BullMQ для job processing.

### Архитектура

```
apps/telegram-bot/     → Enqueue jobs → BullMQ (Redis)
apps/background-workers/ → Consume jobs → Process → Notify
```

### Типы jobs

| Queue | Job type | Источник | Worker Thread? |
|---|---|---|---|
| `reports` | PDF generation | CRON / user /report | ✅ Да |
| `reports` | Infographic generation | CRON / user | ✅ Да |
| `blockchain` | Confirmation polling | CRON (every 1-5 min) | ❌ |
| `blockchain` | Historical import | WalletAdded event | ❌ |
| `sync` | Google Sheets sync | CRON / webhook | ❌ |
| `sync` | Notion sync | CRON / user request | ❌ |
| `notifications` | Scheduled alerts | CRON | ❌ |
| `notifications` | Loan reminders | CRON (daily) | ❌ |

### CPU-intensive tasks → Worker Threads

Внутри `apps/background-workers/`, задачи PDF и инфографики выполняются в Node.js Worker Threads:

```
BullMQ consumer (main thread)
  → spawn Worker Thread for PDF/chart
  → Worker Thread completes → result
  → Send to Telegram via bot API
```

## Последствия

- `apps/background-workers/` — отдельный Docker-контейнер
- BullMQ queues: `reports`, `blockchain`, `sync`, `notifications`
- Concurrency per queue — конфигурируемая
- Graceful shutdown: drain queue before exit
- Мониторинг: BullMQ dashboard (Bull Board) для отладки
- Retry policy: per-job type, max 3 retries with exponential backoff
- Failed jobs → DLQ (ADR-008) + Sentry alert
