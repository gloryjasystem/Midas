# ADR-005: Redlock for OAuth Token Refresh Race Condition

**Статус:** ACCEPTED
**Дата:** 2026-05-04

---

## Контекст

Несколько background workers могут одновременно обнаружить expired OAuth token (Google/Notion) и попытаться обновить его параллельно. Если Worker A получает новый token, а Worker B рефрешит по старому refresh_token — старый refresh_token аннулируется, и оба токена становятся невалидными. Пользователь выбрасывается из интеграции. (Мастер-план §Этап3, Event Storming Flow 5)

## Рассмотренные варианты

| Критерий | PostgreSQL Advisory Locks | Redis Mutex (SETNX) | Redlock (Redis) |
|---|---|---|---|
| Распределённость | ❌ Single DB | ⚠️ Single Redis | ✅ Multi-node |
| TTL auto-release | ❌ | ✅ | ✅ |
| Сложность | Низкая | Низкая | Средняя |
| Масштабируемость | Ограничена | Хорошая | Отличная |
| Зависимость | PostgreSQL | Redis | Redis (3+ nodes ideal) |
| Deadlock safety | ⚠️ Вручную | ✅ TTL | ✅ TTL |

## Решение

**Redlock** (Redis-based distributed lock) через библиотеку `redlock` (Node.js).

Для MVP с одним Redis-инстансом допускается упрощённый SETNX-вариант с обязательным TTL. При масштабировании — переход на полный Redlock с 3+ Redis nodes.

## Алгоритм

```
1. Worker обнаруживает 401 от Google/Notion
2. Worker пытается: LOCK(`lock:oauth:refresh:{integration_id}`, TTL=30s)
3. IF lock acquired:
   a. Fetch refresh_token from DB
   b. Call provider /token endpoint
   c. Encrypt & store new tokens in DB
   d. UNLOCK
4. IF lock NOT acquired:
   a. Ожидание снятия блокировки (retry logic)
   b. Re-read tokens from DB (may be already refreshed)
   c. Retry API call with new token
```

### Конфигурация Redlock
- **Lock Key Format:** `lock:oauth:refresh:{integration_id}`
- **TTL (Time to Live):** 30000 ms (30 sec)
- **Retry Count:** 10 попыток (для ожидающих воркеров)
- **Retry Delay:** 500 ms между попытками
- **Drift Factor:** 0.01 (компенсация рассинхронизации часов Redis-нод)

### Режимы отказов (Failure Modes)

1. **Lock is lost (TTL expired до завершения запроса):**
   - *Сценарий:* Провайдер (Notion) отвечает дольше 30 сек. TTL истекает, другой воркер захватывает блокировку и тоже делает запрос.
   - *Митигация:* Использовать `lock.extend(30000)` в процессе ожидания ответа, если запрос занимает > 20 сек, либо увеличить базовый TTL для медленных API.

2. **Token refresh succeeds, but DB update fails:**
   - *Сценарий:* Токен обновлён на стороне провайдера, но БД Midas недоступна (crash или network partition). Старый токен в БД больше невалиден.
   - *Митигация:* Интеграция переходит в статус `BROKEN_AUTH`. Требуется ручное переподключение (re-auth) пользователем. Система должна отправить Telegram-уведомление пользователю с кнопкой "Переподключить Notion".

## Последствия

- `redlock` или `ioredis` + manual SETNX — в `packages/` shared code
- TTL обязателен (30s default) — защита от deadlock при crash
- Lock key format: `oauth:refresh:{integration_id}`
- Logging: все lock acquire/release — в audit log (Sentry breadcrumbs)
- Тестирование: эмулировать 3 concurrent workers refreshing same token
