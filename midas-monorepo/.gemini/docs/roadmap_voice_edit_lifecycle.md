# Roadmap v2: Voice Quick Edit — Message ID Lifecycle Fix

**Версия**: 2.0 (исправлены расхождения с реальным кодом)
**Дата**: 2026-05-23T17:17:00+03:00

---

## Контекст

**Проблема**: после навигации (пикер → подтверждение → полная карточка → закрыть) голосовые edit-команды перестают работать — Redis теряет указатель `midas:last_confirmed` на success card.

**Связанные документы**:
- [Implementation Plan](.gemini/docs/implementation_plan.md) — визуальный гайд по всем сценариям
- [Dispatcher](.gemini/docs/dispatcher_voice_edit.md) — трекер задач и архитектурные заметки
- [Dry-Run Report](.gemini/docs/dry_run_report.md) — проверка совместимости и scope

> [!IMPORTANT]
> **Ключевое расхождение (найдено при аудите 2026-05-23)**:
> После выбора из пикера (кат/счёт/тип) — есть **промежуточный экран**
> ("✅ X изменён" + [◀️ К транзакции]), а НЕ прямой переход к success card.
> После ввода суммы — сразу **полная карточка** (не success card).
> Все пути заканчиваются на `tx:done` → Fix 1 восстанавливает `midas:last_confirmed`.

---

## Реальная цепочка навигации (после выбора из пикера)

```
ПИКЕР ──[выбор]──▶ ПОДТВЕРЖДЕНИЕ ──[К транзакции]──▶ ПОЛНАЯ КАРТОЧКА ──[Закрыть]──▶ SUCCESS CARD
                   "✅ X изменён"     tx:v:{txId}:s     📋 Транзакция      tx:done:{txId}   ✅ Записано
                   formatTransaction-                    formatTxDetail-                      formatRestored-
                   Card (edit.service)                    Card (screen-builder)                SuccessCard
```

```
ПИКЕР СУММЫ ──[ввод числа]──▶ ПОЛНАЯ КАРТОЧКА ──[Закрыть]──▶ SUCCESS CARD
               text intercept     📋 Транзакция      tx:done:{txId}   ✅ Записано
               formatTxDetailCard                                       formatRestoredSuccessCard
```

> Два разных форматтера:
> - `formatTransactionCard` (edit.service.ts:749) = "📝 Транзакция" — в confirm_cat/acc/int
> - `formatTxDetailCard` (screen-builder.ts:487) = "📋 Транзакция" — в text intercept + tx:v handler

---

## Фаза 0: Предварительная проверка (read-only)

```bash
# 1. Чистый git
git status

# 2. TypeScript builds
cd apps/telegram-bot && npm run build
cd apps/background-workers && npm run build
cd packages/shared && npm run build
```

---

## Фаза 1: Fix 1 + Fix 5 — `tx:done` handler

> **Цель**: при возврате к success card (кнопка "✖️ Закрыть") — восстановить
> `midas:last_confirmed` и очистить все stale Redis ключи.

### Файл: [webhook.route.ts](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/apps/telegram-bot/src/routes/webhook.route.ts)
### Строки: 2198-2206 (`txCmd.cmd === 'done'`)

### Scope check (подтверждено):
| Переменная | Доступна? | Определена |
|-----------|-----------|------------|
| `telegramUserId` | ✅ | строка ~2163 |
| `chatId` | ✅ | строка ~2164 |
| `txMsgId` | ✅ | строка ~2170 |
| `editStateKey()` | ✅ | строка 466: `midas:edit:{uid}:{cid}` |
| `redisConnection` | ✅ | глобальный import |

### Текущий код (СЛОМАН):

```typescript
} else if (txCmd.cmd === 'done') {
  const card = await getTransactionCard(txCmd.txId, txResolved.workspaceId, txResolved.userId);
  if (card && txMsgId) {
    const { getAccountWithBalance } = await import('../services/account.service.js');
    const { formatRestoredSuccessCard } = await import('../utils/screen-builder.js');
    const account = card.account_id ? await getAccountWithBalance(txResolved.workspaceId, txResolved.userId, card.account_id) : null;
    void editMessageText(chatId, txMsgId, formatRestoredSuccessCard(card, account), { inline_keyboard: [[{ text: '✏️ Изменить запись', callback_data: `ed:v:${txCmd.txId}` }]] });
  }
}
```

### Новый код:

```typescript
} else if (txCmd.cmd === 'done') {
  const card = await getTransactionCard(txCmd.txId, txResolved.workspaceId, txResolved.userId);
  if (card && txMsgId) {
    const { getAccountWithBalance } = await import('../services/account.service.js');
    const { formatRestoredSuccessCard } = await import('../utils/screen-builder.js');
    const account = card.account_id
      ? await getAccountWithBalance(txResolved.workspaceId, txResolved.userId, card.account_id)
      : null;
    void editMessageText(
      chatId, txMsgId,
      formatRestoredSuccessCard(card, account),
      { inline_keyboard: [[{
        text: '✏️ Изменить запись',
        callback_data: `ed:v:${txCmd.txId}`,
      }]] },
    );

    // ── Fix 1+5: Restore Redis pointers for voice quick-edit ──
    try {
      await redisConnection.set(
        `midas:last_confirmed:${telegramUserId}:${chatId}`,
        txMsgId,
        'EX', 604800, // 7 days — matches notifications.worker.ts:261
      );
      await redisConnection.del(`midas:nav:${telegramUserId}:${chatId}`);
      await redisConnection.del(editStateKey(telegramUserId, chatId));
      await redisConnection.del(`midas:tx:edit:amt:${telegramUserId}:${chatId}`);
    } catch { /* non-fatal */ }
  }
}
```

### Что это решает:
- `midas:last_confirmed` → голосовая команда найдёт success card
- `midas:nav:` DEL → nav cleanup не удалит success card
- `midas:edit:` DEL → state gate не заблокирует edit-команду
- `midas:tx:edit:amt:` DEL → stale bridge не перехватит текст

### Потенциальные проблемы: NONE
- Race с `editMessageText void` → не проблема (Redis хранит msgId, не контент)
- `txMsgId = undefined` → невозможно (guard `if (card && txMsgId)`)

### Commit: `fix(webhook): restore midas:last_confirmed in tx:done handler`

---

## Фаза 2: Fix 2 — State gate bypass

> **Цель**: `edit_*` команды должны проходить через state gate даже если
> есть активный onboarding/clarification/edit state.

### Файл: [voice-parse.worker.ts](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/apps/background-workers/src/workers/voice-parse.worker.ts)
### Строка: 1617

### Текущий код:

```typescript
if (hasActiveState) {
  console.log('[midas:voice-parse-worker] Phase 2S2: active state detected, skipping nav', {
    jobId: job.id, workspaceId, voiceCmd,
  });
  // Fall through to AI parse path below
}
```

### Новый код:

```typescript
const isQuickEditCmd = voiceCmd === 'edit_amount' || voiceCmd === 'edit_category' ||
  voiceCmd === 'edit_account' || voiceCmd === 'edit_type';
if (hasActiveState && !isQuickEditCmd) {
  console.log('[midas:voice-parse-worker] Phase 2S2: active state detected, skipping nav', {
    jobId: job.id, workspaceId, voiceCmd,
  });
  // Fall through to AI parse path below
}
```

### Потенциальные проблемы: NONE
- Onboarding + edit → edit идёт, onboarding state остаётся в Redis до TTL
- Clarification + edit → edit идёт, clarification card — другое сообщение
- **Зависит от Fix 1** — без restore, edit найдёт пустой `midas:last_confirmed`

### Commit: `fix(voice-worker): bypass state gate for edit_* commands`

---

## Фаза 3: Fix 3 — edit_amount IN-PLACE

> **Цель**: `edit_amount` должен работать как `edit_category` — in-place через
> `editStatusMessage`, а не через `sendNewMessage` + `__SENT__` sentinel.

### Файл: [voice-parse.worker.ts](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/apps/background-workers/src/workers/voice-parse.worker.ts)

### Шаг 3.1: Добавить helper `editStateKeyW` (после `deleteSuccessCardW`, ~строка 204)

```typescript
function editStateKeyW(uid: string, cid: string): string {
  return `midas:edit:${uid}:${cid}`;
}
```

### Шаг 3.2: Изменить `edit_amount` в `buildVoiceNavResponse` (строки 1060-1085)

**Было:**
```typescript
if (cmd === 'edit_amount') {
  if (qeTx.is_cross_currency) { ... }
  const { text: amtText, keyboard: amtKb } = buildQuickEditAmountKb(qeTx.id, SF);
  await deleteSuccessCardW(telegramUserId, chatId);
  const sentMsgId = await sendNewMessage(chatId, amtText, amtKb);
  try {
    await redisConnection.set(
      `midas:tx:edit:amt:${telegramUserId}:${chatId}`,
      `${qeTx.id}:${sentMsgId ?? ''}:s`, 'EX', 120,
    );
  } catch { /* non-fatal */ }
  return { text: '__SENT__' };
}
```

**Стало:**
```typescript
if (cmd === 'edit_amount') {
  if (qeTx.is_cross_currency) {
    return {
      text: '⚠️ Изменение суммы недоступно для мультивалютных транзакций.',
      keyboard: { inline_keyboard: [[{ text: '◀️ Назад', callback_data: `tx:v:${qeTx.id}${SF}` }]] },
    };
  }
  const { text, keyboard } = buildQuickEditAmountKb(qeTx.id, SF);
  await deleteSuccessCardW(telegramUserId, chatId);
  return { text, keyboard, editAmountBridge: { txId: qeTx.id } };
}
```

### Шаг 3.3: Удалить `__SENT__` sentinel handler в caller (строки 1651-1662)

**Удалить целиком:**
```typescript
if (navResult.text === '__SENT__') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (token) {
    try {
      await fetch(`${TELEGRAM_API_BASE}/bot${token}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: parseInt(statusMessageId, 10) }),
      });
    } catch { /* non-fatal */ }
  }
  return;
}
```

### Шаг 3.4: Добавить Redis bridge после `editStatusMessage` (строки ~1666-1676)

**Было:**
```typescript
await editStatusMessage(chatId, statusMessageId, navResult.text, navResult.keyboard);
const navRedisKey = `midas:nav:${telegramUserId}:${chatId}`;
void redisConnection.set(navRedisKey, statusMessageId, 'EX', 86400);
return;
```

**Стало:**
```typescript
await editStatusMessage(chatId, statusMessageId, navResult.text, navResult.keyboard);
const navRedisKey = `midas:nav:${telegramUserId}:${chatId}`;
void redisConnection.set(navRedisKey, statusMessageId, 'EX', 86400);

// Fix 3: edit_amount Redis bridge (using statusMessageId instead of sentMsgId)
if (navResult.editAmountBridge) {
  try {
    await redisConnection.set(
      `midas:tx:edit:amt:${telegramUserId}:${chatId}`,
      `${navResult.editAmountBridge.txId}:${statusMessageId}:s`,
      'EX', 120,
    );
    await redisConnection.set(
      editStateKeyW(telegramUserId, chatId),
      `amt:${navResult.editAmountBridge.txId}`,
      'EX', 300,
    );
  } catch { /* non-fatal */ }
}

return;
```

### Шаг 3.5: Расширить интерфейс `VoiceNavResponse` (строка 215-218) — ОБЯЗАТЕЛЬНО!

> [!CAUTION]
> Interface определён ЯВНО (строка 215). Без этого шага TypeScript **НЕ** скомпилирует return
> `{ text, keyboard, editAmountBridge: { txId } }` из buildVoiceNavResponse.

**Было (строка 215-218):**
```typescript
interface VoiceNavResponse {
  text: string;
  keyboard?: object;
}
```

**Стало:**
```typescript
interface VoiceNavResponse {
  text: string;
  keyboard?: object;
  editAmountBridge?: { txId: string };
}
```

### Что НЕ удалять:
- Функция `sendNewMessage` (строка 147) — оставить, может понадобиться в будущем

### Потенциальные проблемы:
- **Text intercept после ввода числа** — webhook (строка 7684-7721) ищет `midas:tx:edit:amt:`
  → находит `{txId}:{statusMessageId}:s` → `editMessageText(chatId, statusMessageId, ...)`.
  Это заменит пикер "✏️ Введите новую сумму:" на полную карточку (formatTxDetailCard).
  **Правильное поведение** — пикер не должен висеть после ввода числа.

### Commit: `refactor(voice-worker): edit_amount uses IN-PLACE flow`

---

## Фаза 4: Fix 4 — Nav cleanup guard

> **Цель**: nav cleanup перед AI-parse не должен удалять success card.

### Файл: [voice-parse.worker.ts](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/apps/background-workers/src/workers/voice-parse.worker.ts)
### Строки: 1707-1728

### Текущий код:

```typescript
try {
  const navRedisKey = `midas:nav:${telegramUserId}:${chatId}`;
  const oldNavMsgId = await redisConnection.get(navRedisKey);
  if (oldNavMsgId) {
    void (async () => { /* delete message */ })();
    void redisConnection.del(navRedisKey);
  }
} catch { /* Non-fatal */ }
```

### Новый код:

```typescript
try {
  const navRedisKey = `midas:nav:${telegramUserId}:${chatId}`;
  const oldNavMsgId = await redisConnection.get(navRedisKey);
  if (oldNavMsgId) {
    const lcKey = `midas:last_confirmed:${telegramUserId}:${chatId}`;
    const lastConfirmedMsgId = await redisConnection.get(lcKey);
    if (oldNavMsgId === lastConfirmedMsgId) {
      // Success card — just clear stale nav pointer, DON'T delete message
      void redisConnection.del(navRedisKey);
    } else {
      // Actual nav screen — safe to delete
      void (async () => {
        try {
          const token = process.env.TELEGRAM_BOT_TOKEN;
          if (token) {
            await fetch(`${TELEGRAM_API_BASE}/bot${token}/deleteMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, message_id: parseInt(oldNavMsgId, 10) }),
            });
          }
        } catch { /* silent */ }
      })();
      void redisConnection.del(navRedisKey);
    }
  }
} catch { /* Non-fatal */ }
```

### Потенциальные проблемы: NONE
- 1 лишний Redis GET → O(1), < 1ms
- Race с notifications.worker → безопасно (новая tx = новый last_confirmed)
- `oldNavMsgId === lastConfirmedMsgId` но это НЕ success card → невозможно после Fix 1

### Commit: `fix(voice-worker): nav cleanup guard for success card`

---

## Фаза 5: Верификация

### Автоматические проверки:

```bash
# 1. TypeScript build
cd apps/telegram-bot && npm run build
cd apps/background-workers && npm run build
cd packages/shared && npm run build
```

### Ручные тесты (8 сценариев):

> **ВАЖНО**: после выбора из пикера (кат/счёт/тип) появляется ПРОМЕЖУТОЧНЫЙ экран:
> "✅ X изменён" + `formatTransactionCard` (📝) + [◀️ К транзакции].
> После ввода суммы — сразу ПОЛНАЯ КАРТОЧКА: `formatTxDetailCard` (📋) + [✖️ Закрыть].
> В обоих случаях: "✖️ Закрыть" → `tx:done` → success card → Fix 1 → `midas:last_confirmed` restored.

| # | Действие | Ожидание | Проверяет |
|---|----------|----------|-----------|
| 1 | Создать tx → голос "сменить категорию" | Пикер IN-PLACE (editStatusMessage заменяет "⏳") | Базовый flow |
| 2 | (1) выбрать кат → "◀️ К транзакции" → "✖️ Закрыть" → голос "сменить сумму" | Пикер суммы IN-PLACE | Fix 1 |
| 3 | (2) ввести число → "✖️ Закрыть" → голос "сменить счёт" | Пикер счетов IN-PLACE | Fix 1+5 |
| 4 | (3) "◀️ Назад" → "✖️ Закрыть" → голос "сменить тип" | Пикер типа IN-PLACE | Цепочка |
| 5 | Голос "купил кофе 500" → ✅ Подтвердить → голос "сменить категорию" | Пикер для НОВОЙ tx | Fix 4 |
| 6 | Голос "кофе" (без суммы) → голос "сменить категорию" | Пикер для СТАРОЙ tx | Fix 2 |
| 7 | Голос "абракадабра" → голос "сменить сумму" | Пикер суммы | Fix 2+4 |
| 8 | **Полный цикл 4 edits**: tx → голос "сменить кат" → выбрать → "К транзакции" → "Закрыть" → голос "сменить сумму" → ввести число → "Закрыть" → голос "сменить счёт" → выбрать → "К транзакции" → "Закрыть" → голос "сменить тип" → выбрать → "К транзакции" → "Закрыть" | Все 4 работают, карточка живёт | Всё |

### Commit: `test: verify voice quick-edit lifecycle`

---

## Зависимости между фазами

```
Фаза 0  (pre-check)
  │
  ▼
Фаза 1  (Fix 1+5: tx:done) ◄── ПЕРВАЯ, все зависят от неё
  │
  ├──▶ Фаза 2  (Fix 2: state gate) ── зависит от Fix 1
  │
  ├──▶ Фаза 3  (Fix 3: edit_amount) ── функционально независима, но тестировать после Fix 1
  │
  └──▶ Фаза 4  (Fix 4: nav guard) ── зависит от Fix 1
          │
          ▼
        Фаза 5  (верификация) ── после всех фиксов
```

---

## Файлы, которые изменяются

| Файл | Фаза | Тип изменения |
|------|------|---------------|
| `apps/telegram-bot/src/routes/webhook.route.ts` | 1 | MODIFY: строки 2198-2206 |
| `apps/background-workers/src/workers/voice-parse.worker.ts` | 2 | MODIFY: строка 1617 |
| `apps/background-workers/src/workers/voice-parse.worker.ts` | 3 | MODIFY: строки 1060-1085, 1651-1662, 1666-1676 + ADD helper ~204 |
| `apps/background-workers/src/workers/voice-parse.worker.ts` | 4 | MODIFY: строки 1707-1728 |

### Файлы, которые НЕ изменяются (подтверждено):
- `packages/shared/src/quick-edit-ui.ts` — pure builders, no I/O
- `apps/telegram-bot/src/services/edit.service.ts` — confirm handlers correct
- `apps/telegram-bot/src/services/edit-keyboard.service.ts` — keyboards correct
- `apps/telegram-bot/src/utils/screen-builder.ts` — formatters correct
- `apps/background-workers/src/workers/notifications.worker.ts` — guard уже добавлен

---

## Git стратегия

```bash
git checkout -b fix/voice-edit-message-lifecycle

# Фаза 1
git add apps/telegram-bot/src/routes/webhook.route.ts
git commit -m "fix(webhook): restore midas:last_confirmed in tx:done handler"

# Фаза 2
git add apps/background-workers/src/workers/voice-parse.worker.ts
git commit -m "fix(voice-worker): bypass state gate for edit_* commands"

# Фаза 3
git add apps/background-workers/src/workers/voice-parse.worker.ts
git commit -m "refactor(voice-worker): edit_amount uses IN-PLACE flow"

# Фаза 4
git add apps/background-workers/src/workers/voice-parse.worker.ts
git commit -m "fix(voice-worker): nav cleanup guard for success card"

# Фаза 5
git push origin fix/voice-edit-message-lifecycle
```
