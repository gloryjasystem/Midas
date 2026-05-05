# Task Queue Model (BullMQ)

**Статус:** DRAFT (Phase 0.3.1 — Security Patch Applied)

Архитектура очередей BullMQ (Redis-backed) для сервиса `background-workers`.

## 0. Pre-Enqueue Guards (SEC-04, SEC-05, SEC-09)

Перед постановкой любой задачи в BullMQ, webhook-контроллер обязан пройти цепочку проверок:

```
1. Verify X-Telegram-Bot-Api-Secret-Token (SEC-04)
   → Invalid → HTTP 403, не обрабатывать
2. Check message type (SEC-05)
   → Non-text (voice/video/photo/sticker/document/video_note)
   → HTTP 200 + reply: "Я пока понимаю только текстовые сообщения."
   → НЕ ставить в очередь
3. User-Level Rate Limit (SEC-09)
   → Redis INCR rate_limit:{telegram_user_id} EX 10
   → > 5 msg / 10s → HTTP 200 + reply: "Слишком много сообщений, подождите."
   → НЕ ставить в очередь
4. Global AI Budget Guard (SEC-09)
   → Redis key ai_budget:daily → проверка суммарного расхода токенов
   → Превышение → HTTP 200 + reply: "Сервис временно ограничен."
   → НЕ ставить в очередь
5. Enqueue job → BullMQ
   → HTTP 200 (немедленно)
```

## 1. Конфигурация Очередей (Phase 1 MVP)

> Очереди `integrations`, `blockchain`, `reports` (PDF) исключены из Phase 1 scope.
> Они остаются в архитектуре для будущих фаз, но НЕ создаются и НЕ обрабатываются в MVP.

| Имя Очереди | Назначение | Concurrency | Rate Limit | Идемпотентность (SEC-06) |
|---|---|---|---|---|
| `webhook-ingestion` | Быстрый приём вебхуков Telegram | 10 | 100 / 10s (user-level) | `telegram:bot:{bot_id}:chat:{chat_id}:msg:{message_id}` |
| `ai-parse` | Вызовы Claude API для парсинга текста | 5 | 50 / 60s (Claude Tier) | `parse:bot:{bot_id}:msg:{message_id}` |
| `notifications` | Отправка алертов, подтверждений | 10 | 30 / 1s (Telegram limit) | `notify:{ws_id}:{alert_id}` |

### Future Phase Queues (не создаются в Phase 1)
| Имя Очереди | Назначение |
|---|---|
| `reports` | PDF, тяжёлые запросы |
| `integrations` | Sync для Sheets/Notion |
| `blockchain` | Поллинг подтверждений, импорт истории |

## 2. Стратегия Retry & Backoff

| Очередь | Retries | Backoff Type | Delay | Причина |
|---|---|---|---|---|
| `webhook-ingestion` | 3 | Exponential | 1s → 2s → 4s | Кратковременные сетевые сбои Redis/DB |
| `ai-parse` | 2 | Fixed | 5s | API rate limit Claude |
| `notifications` | 3 | Exponential | 2s → 4s → 8s | Telegram API Flood Limit (HTTP 429) |

## 3. Dead Letter Queue (DLQ)

Задачи, превысившие максимальное количество попыток (`Max Retries`), автоматически перемещаются BullMQ в статус `Failed`.

1. Подписка на глобальное событие `failed` в BullMQ.
2. Сохранение метаданных упавшей задачи (Job ID, **sanitized** error class — **НЕ raw_text**, SEC-12) в Sentry.
3. Добавление записи в `AuditLog` с `action = 'job_failed'`.
4. Для критических задач администратору отправляется алерт, задача остаётся для ручного рестарта через Bull Board.

> **SEC-12 Privacy:** В DLQ/Sentry логах запрещены: `raw_text`, API tokens, user financial data. Разрешены: `job_id`, `error_class`, `workspace_id`, `draft_id`.

## 4. Определение Idempotency Key (Job ID) — SEC-06

BullMQ обеспечивает идемпотентность через явное задание `jobId`.

| Действие | Формат jobId | Обоснование |
|---|---|---|
| Telegram message ingestion | `telegram:bot:{bot_id}:chat:{chat_id}:msg:{message_id}` | message_id уникален только внутри чата; bot_id нужен для multi-bot |
| AI Parse | `parse:bot:{bot_id}:msg:{message_id}` | Предотвращает двойной парсинг |
| Callback confirm | `cb:user:{telegram_user_id}:draft:{draft_id}:action:{action}` | Предотвращает повторное подтверждение/отклонение |

Если задача с таким `jobId` уже в очереди (в статусе `waiting`, `active`, или `delayed`), новая задача будет проигнорирована BullMQ.

## 5. Tenant Context in Workers (SEC-03)

Каждый BullMQ worker при обработке задачи обязан:
1. Извлечь `workspace_id` из payload задачи (НЕ из пользовательского ввода).
2. Использовать `withTenantTransaction(workspaceId, fn)` для всех DB-операций.
3. При падении — гарантировать ROLLBACK (автоматически через withTenantTransaction).
4. **ЗАПРЕЩЕНО:** хранить workspace_id в глобальной переменной или синглтоне.
