/**
 * Draft Expiration Worker — Phase 1.7 / Phase 1.39
 *
 * Processes jobs from the `draft-expiration` queue.
 * This is a scheduled/repeatable system CRON worker.
 *
 * Phase 1.39 additions:
 *   - Dual pipeline: expire FIRST → reminders SECOND (I-2)
 *   - Expire: edits preview + reminder cards → expired screen (in-place)
 *   - Expire: saves expired msg_ids to Redis for auto-cleanup
 *   - Reminders: sends reminder cards 10 min before expiry
 *
 * CRON deduplication:
 *   - Repeatable jobs are registered with a fixed jobId pattern by BullMQ.
 *   - Concurrency = 1 to prevent overlapping runs.
 *
 * SEC-12: No raw_text or user PII in any log output.
 * SEC-03: No tenant context needed — SECURITY DEFINER functions.
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, IdempotencyKeyBuilder } from '@midas/shared';
import { redisConnection } from '../queues/redis.js';
import { notificationsQueue } from '../queues/queue-definitions.js';
import { expirePendingDrafts, findDraftsNeedingReminder } from '../services/draft-expiration.service.js';
import { markReminderSent } from '../services/draft.service.js';
import {
  buildExpiredDraftScreen,
  buildReminderScreen,
  buildConfirmKeyboard,
} from '../utils/screen-builder.js';
import { getWorkspaceAccountsForPicker, type WorkspaceAccountEntry } from '../services/draft.service.js';
import { ulid } from 'ulid';

// ─────────────────────────────────────────────────────────────
// Currency-aware picker filtering (mirrors ai-parse.worker.ts)
// ─────────────────────────────────────────────────────────────

const PICKER_STABLECOINS = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'FDUSD', 'PYUSD', 'USDS', 'GUSD',
]);
const PICKER_KNOWN_CRYPTOS = new Set([
  'BTC', 'ETH', 'BNB', 'SOL', 'ADA', 'XRP', 'DOGE', 'DOT', 'AVAX', 'MATIC',
  'LINK', 'LTC', 'TRX', 'XMR', 'ETC', 'XLM', 'ATOM', 'FIL', 'NEAR', 'APT',
  'ARB', 'OP', 'INJ', 'TON', 'NOT', 'DOGS', 'HMSTR', 'CATI',
]);

function classifyPickerCcy(code: string): 'fiat' | 'stablecoin' | 'crypto' {
  const upper = code.toUpperCase();
  if (PICKER_STABLECOINS.has(upper)) return 'stablecoin';
  if (PICKER_KNOWN_CRYPTOS.has(upper)) return 'crypto';
  return /^[A-Z]{2,5}$/.test(upper) ? 'fiat' : 'crypto';
}

function filterPickerAccounts(
  accounts: WorkspaceAccountEntry[],
  txCurrency: string,
): WorkspaceAccountEntry[] {
  const txCur = txCurrency.toUpperCase();
  if (classifyPickerCcy(txCur) === 'fiat') {
    const exact = accounts.filter(a => a.currency.toUpperCase() === txCur);
    const other = accounts.filter(
      a => a.currency.toUpperCase() !== txCur && classifyPickerCcy(a.currency) === 'fiat',
    );
    return [...exact, ...other];
  }
  return accounts.filter(a => a.currency.toUpperCase() === txCur);
}

// ─────────────────────────────────────────────────────────────
// CRON schedule
// ─────────────────────────────────────────────────────────────

export const EXPIRATION_CRON_PATTERN = '*/5 * * * *'; // every 5 minutes
export const EXPIRATION_CRON_JOB_ID = 'system|draft-expiration|cron';

// ─────────────────────────────────────────────────────────────
// Worker processor
// ─────────────────────────────────────────────────────────────

async function processExpiration(job: Job): Promise<void> {
  console.log('[midas:draft-expiration-worker] Expiration run started', {
    jobId: job.id,
  });

  // ══════════════════════════════════════════════════════════
  // I-2: Pipeline 1 — Expire FIRST (before reminders)
  // This prevents sending reminders for drafts that expire in the same tick.
  // ══════════════════════════════════════════════════════════

  const { expiredCount, expiredDrafts } = await expirePendingDrafts();

  for (const draft of expiredDrafts) {
    // Build the expired screen text with draft details
    const expiredText = buildExpiredDraftScreen({
      parsedIntent: draft.parsedIntent,
      parsedAmount: draft.parsedAmount,
      parsedCurrency: draft.parsedCurrency,
      parsedCategoryHint: draft.parsedCategoryHint,
      itemName: draft.itemName,
    });

    // Edit preview card → expired screen (in-place, no buttons)
    if (draft.previewMessageId && draft.previewChatId) {
      const alertP = ulid();
      await notificationsQueue.add(
        QUEUE_NAMES.NOTIFICATIONS,
        {
          alertId: alertP,
          workspaceId: draft.workspaceId,
          chatId: draft.previewChatId,
          message: expiredText,
          activeMessageId: draft.previewMessageId,
          // No inline keyboard → buttons removed
        },
        { jobId: IdempotencyKeyBuilder.notification(draft.workspaceId, alertP) },
      );

      // Save expired msg_id for auto-cleanup (C-13: APPEND logic)
      try {
        const expiredKey = `midas:expired_msgs:${draft.previewChatId}`;
        const existing = await redisConnection.get(expiredKey);
        const ids = existing ? `${existing},${draft.previewMessageId}` : draft.previewMessageId;
        await redisConnection.set(expiredKey, ids, 'EX', 86400);

        // Phase 1.40: Mark as dead_card so next preview auto-deletes it
        await redisConnection.set(
          `midas:dead_card:${draft.previewChatId}`,
          draft.previewMessageId!,
          'EX',
          86400,
        );
      } catch { /* non-fatal */ }
    }

    // Edit reminder card → expired screen (in-place, no buttons)
    if (draft.reminderMessageId && draft.previewChatId) {
      const alertR = ulid();
      await notificationsQueue.add(
        QUEUE_NAMES.NOTIFICATIONS,
        {
          alertId: alertR,
          workspaceId: draft.workspaceId,
          chatId: draft.previewChatId,
          message: expiredText,
          activeMessageId: draft.reminderMessageId,
          // No inline keyboard → buttons removed
        },
        { jobId: IdempotencyKeyBuilder.notification(draft.workspaceId, alertR) },
      );

      // Save reminder msg_id too for auto-cleanup
      try {
        const expiredKey = `midas:expired_msgs:${draft.previewChatId}`;
        const existing = await redisConnection.get(expiredKey);
        const ids = existing ? `${existing},${draft.reminderMessageId}` : draft.reminderMessageId;
        await redisConnection.set(expiredKey, ids, 'EX', 86400);
      } catch { /* non-fatal */ }
    }
  }

  // ══════════════════════════════════════════════════════════
  // Pipeline 2 — Reminders (AFTER expire, so already-expired
  // drafts won't appear in the reminder query)
  // ══════════════════════════════════════════════════════════

  const reminders = await findDraftsNeedingReminder(600); // 10 min lead

  for (const draft of reminders) {
    if (!draft.previewChatId) continue; // can't send reminder without chatId

    const alertId = ulid();

    // Phase 2.6 — Screen Mirror: render the reminder to match the current screen.
    // currentScreen is read from DB (set by webhook at each transition) so the
    // reminder mirrors exactly what the user sees at the moment of inactivity.
    let reminderKeyboard: object;
    let reminderMessage: string;

    const reminderHeader = buildReminderScreen({
      parsedIntent: draft.parsedIntent,
      parsedAmount: draft.parsedAmount,
      parsedCurrency: draft.parsedCurrency,
      parsedCategoryHint: draft.parsedCategoryHint,
      itemName: draft.itemName,
    });

    switch (draft.currentScreen) {
      // ── Screen 2: Account already selected + cross-amount entered (or same-currency).
      // Mirror: ✅ Подтвердить | 🔄 Сменить счёт: {name} | ✏️ Изменить | ✖️ Отмена
      case 'screen2': {
        const acct = draft.accountId
          ? { id: draft.accountId, name: draft.accountName ?? '', currency: '' }
          : null;
        const kb = buildConfirmKeyboard(
          draft.draftId,
          acct,
          // xfx.hasCrossAmount=true: debit amount is already entered → Подтвердить not blocked
          acct ? { hasCrossAmount: true } : null,
        );
        reminderKeyboard = kb;
        reminderMessage = reminderHeader;
        break;
      }

      // ── Screen 1b: Account selected but cross-currency debit amount not entered yet.
      // Mirror: 🔄 Сменить счёт: {name} | ✏️ Указать сумму в {cur} | ✏️ Изменить | ✖️ Отмена
      // Note: Confirm button is NOT shown (blocked by hasCrossAmount=false), matching the live card.
      case 'screen1b': {
        const acctB = draft.accountId
          ? { id: draft.accountId, name: draft.accountName ?? '', currency: draft.parsedCurrency ?? '' }
          : null;
        const kbB = buildConfirmKeyboard(
          draft.draftId,
          acctB,
          acctB ? { hasCrossAmount: false } : null,
        );
        reminderKeyboard = kbB;
        reminderMessage = reminderHeader;
        break;
      }

      // ── Screen 1 (default): No account linked — show account picker.
      // Mirror: [🏦 Acc · bal cur] buttons + ✖️ Отмена
      case 'screen1':
      default: {
        let pickerAccounts: WorkspaceAccountEntry[] = [];
        try {
          const allAccounts = await getWorkspaceAccountsForPicker(draft.workspaceId);
          const txCur = draft.parsedCurrency;
          pickerAccounts = txCur
            ? filterPickerAccounts(allAccounts, txCur)
            : allAccounts;
        } catch { /* non-fatal: fall back to empty picker */ }

        const intent = draft.parsedIntent;
        const pickerHeader = (intent === 'income' || intent === 'debt_received')
          ? '\n\n\uD83C\uDFE6 <b>\u041D\u0430 \u043A\u0430\u043A\u043E\u0439 \u0441\u0447\u0451\u0442 \u0437\u0430\u0447\u0438\u0441\u043B\u0438\u0442\u044C?</b>'
          : '\n\n\uD83C\uDFE6 <b>\u0421 \u043A\u0430\u043A\u043E\u0433\u043e \u0441\u0447\u0451\u0442\u0430 \u0441\u043F\u0438\u0441\u0430\u0442\u044C?</b>';

        if (pickerAccounts.length > 0) {
          const pickerRows = pickerAccounts.slice(0, 8).map((acc) => {
            const balDisplay = acc.balance.replace(/\.?0+$/, '') || '0';
            return [{
              text: `\uD83C\uDFE6 ${acc.name} \u00B7 ${balDisplay} ${acc.currency}`,
              callback_data: `ia:pk:${acc.id}:${draft.draftId}`,
            }];
          });
          pickerRows.push([{ text: '\u2716\uFE0F \u041E\u0442\u043C\u0435\u043D\u0430', callback_data: `ia:cancel:${draft.draftId}` }]);
          reminderKeyboard = { inline_keyboard: pickerRows };
          reminderMessage = reminderHeader + pickerHeader;
        } else {
          reminderKeyboard = { inline_keyboard: [[{ text: '\u2716\uFE0F \u041E\u0442\u043C\u0435\u043D\u0430', callback_data: `ia:cancel:${draft.draftId}` }]] };
          reminderMessage = reminderHeader;
        }
        break;
      }
    }

    // Phase 2.6 — Chat hygiene: delete old preview card BEFORE sending reminder.
    // deleteMessageId is passed in the notification payload; notifications.worker.ts
    // calls deleteTelegramMessage() before sending the new card.
    // Clears midas:preview Redis key so T+60 expire edit doesn't warn on missing msg.
    const deleteOldPreview = draft.previewMessageId ?? undefined;
    if (deleteOldPreview) {
      void redisConnection.del(`midas:preview:${draft.draftId}`).catch(() => {});
    }

    await notificationsQueue.add(
      QUEUE_NAMES.NOTIFICATIONS,
      {
        alertId,
        workspaceId: draft.workspaceId,
        chatId: draft.previewChatId,
        draftId: draft.draftId,
        message: reminderMessage,
        inlineKeyboardJson: JSON.stringify(reminderKeyboard),
        cacheStoreKey: `midas:reminder:${draft.draftId}`,
        // Phase 2.6: delete old preview card before sending this reminder
        deleteMessageId: deleteOldPreview,
      },
      { jobId: IdempotencyKeyBuilder.notification(draft.workspaceId, alertId) },
    );
  }

  if (reminders.length > 0) {
    await markReminderSent(reminders.map(d => d.draftId));
  }

  console.log('[midas:draft-expiration-worker] Expiration run complete', {
    jobId: job.id,
    expiredCount,
    remindersCount: reminders.length,
  });
}

// ─────────────────────────────────────────────────────────────
// Worker factory
// ─────────────────────────────────────────────────────────────

export function createDraftExpirationWorker(): Worker {
  const worker = new Worker(QUEUE_NAMES.DRAFT_EXPIRATION, processExpiration, {
    connection: redisConnection,
    prefix: 'bull',
    concurrency: 1, // Single-instance CRON — no parallel expiration runs
  });

  worker.on('completed', (job: Job) => {
    console.log('[midas:draft-expiration-worker] Job completed', {
      jobId: job.id,
    });
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error('[midas:draft-expiration-worker] Job failed', {
      jobId: job?.id ?? 'unknown',
      errorClass: err.constructor.name,
    });
  });

  return worker;
}
