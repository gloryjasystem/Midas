# ADR-007: Blockchain Webhook Idempotency

**Статус:** ACCEPTED
**Дата:** 2026-05-04

---

## Контекст

Блокчейн-провайдеры (TronGrid, BSCScan, Etherscan, QuickNode) отправляют вебхуки с гарантией at-least-once delivery — один и тот же вебхук может прийти до 5 раз. Без защиты — дублирование транзакций и искажение баланса. (Мастер-план §Этап2, Event Storming E-D-07)

## Решение

**Уникальный составной ключ `(network_id, tx_hash, wallet_address, direction)`** с `UNIQUE` constraint в БД.

### Стратегия обработки

```
1. Webhook received: { tx_hash, network_id, wallet_address, direction ... }
2. INSERT INTO crypto_transactions (tx_hash, network_id, wallet_address, direction ...)
   ON CONFLICT (network_id, tx_hash, wallet_address, direction) DO NOTHING
   RETURNING id
3. IF id IS NULL → duplicate, silently discard (HTTP 200)
4. IF id IS NOT NULL → new tx, proceed to processing
```

### Ключевые правила

- **Всегда HTTP 200** — даже для дубликатов. Иначе провайдер будет retry бесконечно.
- **UNIQUE constraint** — на уровне БД, не application code. Race-condition safe.
- Идемпотентность должна учитывать `wallet_address` и `direction` (in/out), так как одна транзакция может затрагивать несколько отслеживаемых кошельков пользователя (например, перевод между своими кошельками).
- Webhook signature validation — перед INSERT. Защита от спуфинга.

## Последствия

- DDL: `UNIQUE(network_id, tx_hash, wallet_address, direction)` на таблице `crypto_transactions`
- `tx_hash`: тип `TEXT` (hex string), индексируется
- `network_id`: тип `TEXT` (enum-like: 'ethereum', 'bsc', 'tron')
- Webhook endpoint: всегда возвращает 200, логирует дубли в debug level
- Метрики: счётчик дубликатов для мониторинга здоровья провайдера
