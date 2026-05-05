# ADR-013: TransactionDraft TTL and Cleanup

**Статус:** ACCEPTED
**Дата:** 2026-05-04

---

## Контекст

Когда Haiku парсит сообщение, создаётся TransactionDraft в статусе `PENDING_CONFIRMATION`. Пользователь может не ответить: отвлёкся, закрыл Telegram, не заметил. Без TTL — draft'ы копятся бесконечно, Inline-клавиатуры «висят», модель данных загрязняется. (Event Storming R-08, Q-05, MISS-EV-06)

## Решение

**TTL = 24 часа** с автоматическим cleanup.

### Жизненный цикл с TTL

```
PENDING_CONFIRMATION (created_at = T)
  → [Да] → CONFIRMED → RECORDED (TTL не применяется)
  → [Изменить] → EDITING → PENDING_CONFIRMATION (TTL reset)
  → T + 24h → EXPIRED (DraftExpired event)
```

### Cleanup механизм

```
1. CRON job: BullMQ repeatable, каждые 30 минут
2. Atomic expire (SEC-08):
   UPDATE transaction_drafts
   SET status = 'expired', updated_at = NOW()
   WHERE status = 'pending_user'
     AND expires_at <= NOW()
   RETURNING id, workspace_id, telegram_message_id;
3. For each returned row:
   a. Emit DraftExpired event
   b. Edit original Telegram message: remove inline keyboard
```

### SEC-07: Atomic Confirmation
```
UPDATE transaction_drafts
SET status = 'approved', updated_at = NOW()
WHERE id = $1
  AND status = 'pending_user'
  AND expires_at > NOW()
RETURNING *;

-- 0 rows returned → draft уже обработан или истёк
-- transactions.draft_id UNIQUE — вторая линия защиты
```

### SEC-08: Terminal States
Статусы `approved`, `rejected`, `expired` — терминальные. Обратный переход запрещён.
Обязателен тест на конкурентность: 3 параллельных запроса на один draft → только 1 Transaction.

### Конфигурация

| Параметр | Default | Env variable |
|---|---|---|
| Draft TTL | 24 hours | `DRAFT_TTL_HOURS=24` |
| Cleanup interval | 30 minutes | `DRAFT_CLEANUP_INTERVAL_MIN=30` |
| Reminder before expiry | Disabled (MVP) | `DRAFT_REMINDER_ENABLED=false` |

## Последствия

- Таблица `transaction_drafts`: обязательное поле `expires_at = created_at + TTL`
- При `[Изменить]` → `expires_at` сбрасывается на `NOW() + TTL`
- CRON job в `apps/background-workers/` (BullMQ repeatable job)
- Expired drafts: soft delete (сохраняем для аналитики парсинга)
- Telegram: remove inline keyboard при expiry (`editMessageReplyMarkup`)
