# Dispatcher v2: Voice Edit Lifecycle Fix

## Status: ✅ DEPLOYED

**Last Updated**: 2026-05-23T19:37:00+03:00
**Branch**: `fix-voice-edit-lifecycle` → merged to `main` via PR #18
**Merge commit**: `1686899253c289f5708bb16bda5c1ed36ddbc205`
**Roadmap**: [roadmap_voice_edit_lifecycle.md](.gemini/docs/roadmap_voice_edit_lifecycle.md)
**Visual Guide**: [implementation_plan.md](.gemini/docs/implementation_plan.md)

---

## ✅ Completed

- [x] Forensic audit of all Redis key flows
- [x] Root cause identified: `tx:done` does not restore `midas:last_confirmed`
- [x] Visual walkthrough of all scenarios (A-F) — corrected for intermediate screens
- [x] Implementation plan approved by user
- [x] Roadmap v2 with exact code changes written
- [x] Guard clause added to notifications.worker.ts (line 184-192) for empty text
- [x] Cross-check: all button texts match between shared/quick-edit-ui.ts and implementation plan
- [x] Cross-check: intermediate confirmation screens documented (confirm_cat/acc/int)
- [x] Cross-check: two formatters identified (formatTransactionCard vs formatTxDetailCard)
- [x] Cross-check: sendNewMessage only used by edit_amount (safe to remove call)

---

## 📋 Execution Checklist

### Phase 0: Pre-flight
- [x] `git status` — clean working tree
- [x] `git checkout -b fix-voice-edit-lifecycle`
- [x] `npm run build` passes in all 3 packages (shared, telegram-bot, background-workers)

---

### Phase 1: Fix 1+5 — tx:done handler ✅ DONE
**File**: `apps/telegram-bot/src/routes/webhook.route.ts`
**Lines**: 2198-2206
**Commit**: `16f1134`

- [x] After `editMessageText(...)` add try/catch block with:
  - [x] `redis.set(midas:last_confirmed:{uid}:{cid}, txMsgId, EX, 604800)`
  - [x] `redis.del(midas:nav:{uid}:{cid})`
  - [x] `redis.del(editStateKey(uid, cid))` — uses existing helper at line 466
  - [x] `redis.del(midas:tx:edit:amt:{uid}:{cid})`
- [x] Verify `telegramUserId` is in scope (line ~2163)
- [x] Verify `chatId` is in scope (line ~2164)
- [x] Verify `txMsgId` is in scope (line ~2170)
- [x] `npm run build` in apps/telegram-bot
- [x] **Commit**: `fix(webhook): restore midas:last_confirmed in tx:done handler`
- [x] **Smoke test**: Create tx → ✏️ Изменить запись → ✖️ Закрыть → voice "сменить категорию" → picker appears

---

### Phase 2: Fix 2 — State gate bypass ✅ DONE
**File**: `apps/background-workers/src/workers/voice-parse.worker.ts`
**Line**: 1617
**Commit**: `8cb4c31`

- [x] Add `isQuickEditCmd` const before `if (hasActiveState)`
- [x] Change `if (hasActiveState)` → `if (hasActiveState && !isQuickEditCmd)`
- [x] `npm run build` in apps/background-workers
- [x] **Commit**: `fix(voice-worker): bypass state gate for edit_* commands`
- [x] **Smoke test**: Send nonsense → voice "сменить сумму" → picker appears (not AI parse)

---

### Phase 3: Fix 3 — edit_amount IN-PLACE ✅ DONE
**File**: `apps/background-workers/src/workers/voice-parse.worker.ts`
**Commit**: `bdb716d`

- [x] **Step 3.1**: Add `editStateKeyW` helper after `deleteSuccessCardW` (~line 204)
- [x] **Step 3.2**: Modify `edit_amount` in `buildVoiceNavResponse` (lines 1060-1085):
  - [x] Remove `sendNewMessage` call
  - [x] Remove `redisConnection.set(midas:tx:edit:amt:...)` from builder
  - [x] Return `{ text, keyboard, editAmountBridge: { txId } }` instead of `{ text: '__SENT__' }`
- [x] **Step 3.3**: Delete `__SENT__` sentinel handler (lines 1651-1662)
- [x] **Step 3.4**: After `editStatusMessage` + nav key SET (line ~1674), add:
  - [x] `if (navResult.editAmountBridge)` block with Redis bridge + edit state
- [x] **Step 3.5** ⚠️ **ОБЯЗАТЕЛЬНО**: Modify `VoiceNavResponse` interface (line 215-218):
  - [x] Add `editAmountBridge?: { txId: string };` — WITHOUT this, TypeScript will NOT compile
- [x] `sendNewMessage` kept with @ts-ignore (per roadmap)
- [x] `npm run build` in apps/background-workers
- [x] **Commit**: `refactor(voice-worker): edit_amount uses IN-PLACE flow`
- [x] **Smoke test**: Voice "сменить сумму" → "⏳" replaced with "✏️ Введите новую сумму:" → enter number → full card

---

### Phase 4: Fix 4 — Nav cleanup guard ✅ DONE
**File**: `apps/background-workers/src/workers/voice-parse.worker.ts`
**Lines**: 1707-1728
**Commit**: `5a80c4a`

- [x] Before delete, GET `midas:last_confirmed:{uid}:{cid}`
- [x] If `oldNavMsgId === lastConfirmedMsgId` → DEL nav key only, DON'T delete message
- [x] Else → delete message + DEL nav key (current behavior)
- [x] `npm run build` in apps/background-workers
- [x] **Commit**: `fix(voice-worker): nav cleanup guard for success card`
- [x] **Smoke test**: Success card visible → voice "купил кофе 500" → success card NOT deleted

---

### Phase 5: Verification ✅ DONE
- [x] TypeScript build passes for all packages (turbo 5/5)
- [x] Manual test #1: basic edit flow
- [x] Manual test #2: chained edit after confirm
- [x] Manual test #3: chained edit after amount change
- [x] Manual test #4: chained edit with "Назад"
- [x] Manual test #5: new tx then edit
- [x] Manual test #6: partial input then edit (state bypass)
- [x] Manual test #7: nonsense then edit
- [x] Manual test #8: full 4-edit cycle
- [x] No DLQ errors in worker logs
- [x] `git push origin fix-voice-edit-lifecycle`
- [x] PR #18 merged to main

---

## 🔍 Verified edge cases

| # | Edge case | Status | Notes |
|---|-----------|--------|-------|
| 1 | edit_amount cross-currency | ✅ Handled | Guard at line 1062 in buildVoiceNavResponse |
| 2 | Concurrent clarification + edit | ✅ Safe | Fix 2 bypasses gate; clarification = separate msg |
| 3 | tx:done without txMsgId | ✅ Safe | Guard `if (card && txMsgId)` |
| 4 | Nav cleanup race with last_confirmed | ✅ Safe | Fix 4 compares msgIds |
| 5 | sendNewMessage sole caller = edit_amount | ✅ Verified | grep: line 1072 only caller |
| 6 | confirm_cat/acc/int intermediate screen | ✅ Correct | No changes needed — all end at tx:done |
| 7 | tx:v handler clears stale keys | ✅ Correct | Lines 2221-2224 already clean amt+edit |
| 8 | Suffix `:s` routing | ✅ Correct | Line 2254: `from==='s'` → tx:done |

> [!WARNING]
> **CRITICAL ARCHITECTURE**: After selecting from picker, there is an INTERMEDIATE screen:
> `confirm_cat` → "✅ Категория изменена" + `formatTransactionCard` (📝) + [◀️ К транзакции]
> `confirm_acc` → "✅ Счёт изменён" + `formatTransactionCard` (📝) + [◀️ К транзакции]
> `confirm_int` → "✅ Тип изменён" + `formatTransactionCard` (📝) + [◀️ К транзакции]
>
> After entering amount, text intercept shows: `formatTxDetailCard` (📋) + edit buttons
>
> ALL paths end at `tx:done` → Fix 1 restores `midas:last_confirmed`.
> NO changes needed to confirm handlers.

---

## 🏗️ Architecture reference

### Redis key model
| Key | TTL | Writer | Reader | After Fix |
|-----|-----|--------|--------|-----------|
| `midas:last_confirmed:{uid}:{cid}` | 7d | notifications.worker + **tx:done (Fix 1)** | deleteSuccessCardW | Restored on tx:done |
| `midas:nav:{uid}:{cid}` | 24h | voice-parse caller (L1674) | nav cleanup (L1707) | DEL'd in tx:done; guarded in Fix 4 |
| `midas:edit:{uid}:{cid}` | 5min | text-path handlers | state gate (L1601) | DEL'd in tx:done |
| `midas:tx:edit:amt:{uid}:{cid}` | 2min | edit_amount handler | text intercept (L7684) | SET in caller (Fix 3); DEL'd in tx:done |
| `midas:am:{uid}:{cid}` | 24h | upsertBotMessage | deleteSuccessCardW (fallback) | Unchanged |

### Function reference
| Function | File | Line | Purpose |
|----------|------|------|---------|
| `deleteSuccessCardW` | voice-parse.worker.ts | 181 | Deletes success card via last_confirmed → am fallback |
| `editStatusMessage` | voice-parse.worker.ts | ~130 | editMessageText wrapper |
| `sendNewMessage` | voice-parse.worker.ts | 147 | sendMessage wrapper (no longer used by edit_amount after Fix 3) |
| `buildVoiceNavResponse` | voice-parse.worker.ts | ~930 | Builds picker for voice nav commands |
| `editStateKey` | webhook.route.ts | 466 | Returns `midas:edit:{uid}:{cid}` |
| `editStateKeyW` | voice-parse.worker.ts | ~206 | **NEW (Fix 3)** — same key, worker-local copy |
| `formatTransactionCard` | edit.service.ts | 749 | "📝 Транзакция" — used in confirm_cat/acc/int |
| `formatTxDetailCard` | screen-builder.ts | 487 | "📋 Транзакция" — used in text intercept + tx:v |
| `formatRestoredSuccessCard` | screen-builder.ts | 521 | "✅ Записано" — used in tx:done |
| `handleQuickEditField` | webhook.route.ts | 8419 | Text-path quick edit (button-triggered) |

### Message lifecycle (CORRECT, after all fixes)

```
Voice "сменить X"
  │
  ▼
detectCommand → "edit_X"
  │
  ▼
State gate (Fix 2: bypass for edit_*)
  │
  ▼
buildVoiceNavResponse → {text, keyboard}
  │  └─ deleteSuccessCardW (reads midas:last_confirmed)
  │
  ▼
editStatusMessage (replaces "⏳ Распознаю..." with picker)
set midas:nav: = statusMessageId
  │
  ├──[user selects option]──▶ confirm_X
  │                           │
  │                           ▼
  │                     "✅ X изменён" + formatTransactionCard (📝)
  │                     [◀️ К транзакции] → tx:v:{txId}:s
  │                           │
  │                           ▼
  │                     Full card (📋 formatTxDetailCard)
  │                     [✖️ Закрыть] → tx:done:{txId}
  │                           │
  ├──[user presses ◀️]────────┤
  │  tx:v:{txId}:s            │
  │  → Full card → Закрыть    │
  │                           ▼
  │                     tx:done (Fix 1):
  │                       SET midas:last_confirmed = txMsgId
  │                       DEL midas:nav:
  │                       DEL midas:edit:
  │                       DEL midas:tx:edit:amt:
  │                           │
  │                           ▼
  │                     SUCCESS CARD (✅ Записано)
  │                     [✏️ Изменить запись]
  │                           │
  │                           ▼
  └─────── Next voice edit command works! ◀──────┘
```
