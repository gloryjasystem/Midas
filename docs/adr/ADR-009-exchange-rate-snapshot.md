# ADR-009: Exchange Rate Snapshot Strategy

**Статус:** ACCEPTED
**Дата:** 2026-05-04

---

## Контекст

Midas — мультивалютная система (USD, EUR, USDT, ETH, BTC и пользовательские валюты). ТЗ и Мастер-план требуют фиксации курса в момент транзакции (PC §3.3). Нужен источник курсов и стратегия кэширования. (Event Storming MISS-E-01, Q-04)

## Решение

**Snapshot at transaction time** — курс фиксируется в момент финального COMMIT транзакции (не при создании Draft).

### SEC-11: Exchange Rate Timing Rules
- **Одновалютная транзакция** (currency = workspace.default_currency): `exchange_rate = 1.0`, немедленная фиксация.
- **Кросс-валютная:** `exchange_rate_at_timestamp` фиксируется **в момент COMMIT** (не при создании Draft). Неизменяемый.
- **Rate API unavailable:** Transaction **НЕ МОЖЕТ быть закоммичена**. Пользователю: *"Курс временно недоступен, попробуйте позже."*
- Транзакция с `exchange_rate = NULL` запрещена.

### Источники курсов

| Тип валюты | Провайдер | Fallback |
|---|---|---|
| Fiat (USD/EUR/RUB) | ExchangeRate-API или Open Exchange Rates | ECB API |
| Crypto (USDT/ETH/BTC) | CoinGecko API (free tier) | CoinMarketCap |

### Кэширование

- Redis cache: `exchange_rate:{base}:{quote}` → TTL = 5 минут
- При запросе курса: cache hit → use cached; cache miss → fetch → cache → return
- Circuit Breaker на rate API (ADR-008)

### Хранение в транзакции (Финансовая точность)

> **Architectural Rule:** Строго запрещено использование JavaScript `Number` или типов с плавающей точкой (`float`, `double`) для финансовых расчётов и хранения. **Обязательное** использование библиотек `decimal.js` или `bignumber.js` на уровне Node.js.

```
transactions:
  fiat_amount: NUMERIC(19,4)       -- исходная сумма фиат (MVP)
  crypto_amount: NUMERIC(38,18)    -- исходная сумма крипто (Future)
  currency: TEXT                   -- исходная валюта (ISO 4217 / crypto ticker)
  exchange_rate_at_timestamp: NUMERIC(24,12) -- курс к базовой валюте
  base_currency: TEXT              -- базовая валюта workspace (default: USD)
  base_amount: NUMERIC(19,4)       -- = fiat_amount/crypto_amount * exchange_rate
  rate_source: TEXT                -- провайдер курса (для аудита)
  rate_fetched_at: TIMESTAMPTZ     -- момент фиксации курса
```

## Последствия

- Использование `NUMERIC(19,4)` для фиата, `NUMERIC(38,18)` для крипто, `NUMERIC(24,12)` для курсов.
- Запрет `float/double` в схеме БД.
- Запрет нативных математических операций `+ - * /` с деньгами в TypeScript (использовать `new Decimal(a).mul(b)`).
- **SEC-02:** `pg.types.setTypeParser(1700, val => new Decimal(val))` — обязательно на границе репозитория.
- **SEC-02:** Decimal → внешний мир только как строки.
- Базовая валюта workspace — конфигурируемая (default: RUB)
- Отчёты используют `base_amount` для агрегации, `original_amount` для детализации
- Исторический пересчёт запрещён (PC §3.3)
- **SEC-11:** Транзакция с `exchange_rate = NULL` запрещена. Rate API down → транзакция не создаётся.
