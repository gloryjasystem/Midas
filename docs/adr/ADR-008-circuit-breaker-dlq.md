# ADR-008: Circuit Breaker + Dead Letter Queue for External APIs

**Статус:** ACCEPTED
**Дата:** 2026-05-04

---

## Контекст

Midas интегрируется с 5+ внешних API (Google Sheets, Notion, TronGrid, BSCScan, Etherscan, Claude Haiku, Exchange Rate API). Любой из них может вернуть 429 (Rate Limit), 500 (Server Error), или уйти в timeout. Без защиты — каскадные отказы, заполнение очередей, исчерпание соединений. (Мастер-план §Этап3, Event Storming E-D-28/E-D-29)

## Решение

**Circuit Breaker** (per-provider) + **Dead Letter Queue** (Redis/BullMQ).

### Состояния Circuit Breaker

```
CLOSED (нормальная работа)
  → 5 failures in 60s window → OPEN
OPEN (все запросы отклоняются, DLQ)
  → after cooldown (30-60s) → HALF_OPEN
HALF_OPEN (пробный запрос)
  → success → CLOSED
  → failure → OPEN
```

### Конфигурация per-provider

| Provider | Failure threshold | Cooldown | Max retries |
|---|---|---|---|
| Google Sheets | 5 in 60s | 60s | 3 |
| Notion | 5 in 60s | 60s | 3 |
| TronGrid | 3 in 30s | 30s | 5 |
| BSCScan | 3 in 30s | 30s | 5 |
| Etherscan | 3 in 30s | 30s | 5 |
| Claude API | 3 in 60s | 120s | 2 |
| Exchange Rate | 3 in 60s | 300s | 3 |

### Dead Letter Queue

Когда Circuit Breaker в состоянии OPEN:
1. Запрос складывается в BullMQ DLQ с metadata (provider, payload, attempt_count)
2. При переходе в CLOSED — DLQ drain: запросы повторяются с exponential backoff
3. После max retries — запрос помечается `FAILED`, уведомление в Sentry

## Последствия

- Библиотека: `opossum` (Node.js Circuit Breaker) или custom wrapper
- DLQ: отдельная BullMQ queue `dlq:{provider}` с backoff
- Метрики: circuit state per provider → Sentry breadcrumbs
- Пользователю: "⚠️ Notion временно недоступен, данные будут синхронизированы автоматически"
- Health endpoint: `/health` возвращает статус всех circuit breakers
