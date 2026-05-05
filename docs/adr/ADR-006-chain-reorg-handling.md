# ADR-006: Chain Reorg Handling — Confirmation Depth + Rollback

**Статус:** ACCEPTED
**Дата:** 2026-05-04

---

## Контекст

Блокчейны (Tron, BSC, Ethereum) могут откатывать блоки (orphaned blocks). Транзакция, которая казалась подтверждённой, может исчезнуть. Для финансовой системы это критично — нельзя показывать пользователю баланс, включающий откаченную транзакцию. (Мастер-план §Этап2, Event Storming Flow 4)

## Рассмотренные варианты

| Стратегия | Описание | Плюсы | Минусы |
|---|---|---|---|
| Instant confirm | Записываем сразу как confirmed | Быстрый UX | Некорректный баланс при reorg |
| Confirmation Depth (ВЫБРАН) | Ждём N блоков | Надёжность | Задержка отображения |
| Finality API | Используем finality endpoint (где доступен) | Максимальная точность | Не все сети поддерживают |

## Решение

**Confirmation Depth + Rollback** с разными глубинами по сетям.

### Рекомендуемые значения Confirmation Depth

| Сеть | Время блока | Рекомендуемая глубина | Примерное время ожидания |
|---|---|---|---|
| Ethereum (ERC20) | ~12s | 12 блоков | ~2.5 мин |
| BSC (BEP20) | ~3s | 15 блоков | ~45с |
| Tron (TRC20) | ~3s | 19 блоков (~1 мин) | ~1 мин |

> Значения конфигурируемые через environment variables.

### Жизненный цикл крипто-транзакции

```
DETECTED (block_number = X)
  → PENDING (confirmations < DEPTH)
    → CONFIRMED (confirmations >= DEPTH → записать Transaction)
    → REVERTED (orphaned block detected → soft-delete Transaction)
```

### Rollback-алгоритм

```
1. Получен webhook/poll: block X orphaned
2. SELECT * FROM crypto_transactions WHERE block_number >= X AND status != 'REVERTED'
3. FOR EACH affected tx:
   a. UPDATE crypto_transactions SET status = 'REVERTED'
   b. UPDATE transactions SET status = 'REVERTED' (soft delete)
   c. INSERT audit_log (action = 'CHAIN_REORG_ROLLBACK', tx_hash, block)
4. Send TelegramAlert to user
```

## Последствия

- Таблица `crypto_transactions`: обязательные поля `block_number`, `confirmation_count`, `status`
- Статусы: `DETECTED`, `PENDING`, `CONFIRMED`, `REVERTED`
- Background worker: периодическая проверка confirmation count
- Баланс пользователя вычисляется только по `CONFIRMED` транзакциям
- Audit log для всех rollback-операций
