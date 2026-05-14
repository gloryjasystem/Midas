/**
 * Confirmation Worker — Phase 1.6-B
 *
 * Processes jobs from the `callback-confirm` queue.
 * Triggered by inline keyboard approve/reject button presses.
 *
 * Flow:
 *   1. Parse callback_data: validate action = 'approve' | 'reject'
 *   2. Resolve userId from telegramUserId (trusted DB lookup, SEC-03)
 *   3. Atomically approve or reject the draft
 *      (SELECT FOR UPDATE SKIP LOCKED + state machine trigger)
 *   4. Enqueue notification to user (result message)
 *   5. Answer the Telegram callback_query (remove loading spinner)
 *
 * SEC-03: workspaceId comes from job.data (injected by webhook route from DB session).
 *         We do NOT parse workspaceId from callback_data — it would be user-controlled.
 * SEC-01: draftId from callback_data is validated against DB (must belong to workspace).
 * SEC-06: Job idempotency key = cb|user|{telegramUserId}|draft|{draftId}|action|{action}
 * SEC-12: No raw_text or financial amount in logs.
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, type CallbackConfirmJobPayload, IdempotencyKeyBuilder } from '@midas/shared';
import { redisConnection } from '../queues/redis.js';
import { callbackConfirmQueue, notificationsQueue } from '../queues/queue-definitions.js';
import { approveDraft, rejectDraft, fetchApprovedTransactionCard } from '../services/draft-confirmation.service.js';
import { resolveUserId, getPreviewMessageInfo } from '../services/draft.service.js';
import { ulid } from 'ulid';
import {
  buildConfirmedScreen,
  buildRejectedScreen,
  buildExpiredScreen,
  buildAlreadyProcessedScreen,
  buildNotFoundScreen,
  buildIntentMissingScreen,
  buildPostConfirmKeyboard,
} from '../utils/screen-builder.js';

// ─────────────────────────────────────────────────────────────
// Telegram API — answer callback_query
// ─────────────────────────────────────────────────────────────

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN ?? ''}`;

/**
 * Answer a Telegram callback_query to remove the loading spinner.
 * Fire-and-forget: failure here is non-critical (visual only).
 */
async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
    if (!res.ok) {
      console.warn('[midas:confirmation-worker] answerCallbackQuery failed', {
        callbackQueryId,
        status: res.status,
      });
    }
  } catch (err: unknown) {
    const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
    console.warn('[midas:confirmation-worker] answerCallbackQuery error', {
      callbackQueryId,
      errorClass,
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Worker processor
// ─────────────────────────────────────────────────────────────

async function processConfirmation(job: Job<CallbackConfirmJobPayload>): Promise<void> {
  const { callbackQueryId, telegramUserId, draftId, action, workspaceId, chatId } = job.data;

  console.log('[midas:confirmation-worker] Processing confirmation', {
    jobId: job.id,
    draftId,
    action,
    workspaceId,
    // telegramUserId and chatId deliberately NOT logged at DEBUG level
  });

  // ── Step 1: Resolve userId from DB ───────────────────────────
  // SEC-03: userId must come from our DB, not from callback_data (user-controlled).
  let userId: string;
  try {
    userId = await resolveUserId(telegramUserId);
  } catch (err: unknown) {
    const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
    console.error('[midas:confirmation-worker] Failed to resolve userId', {
      jobId: job.id,
      draftId,
      errorClass,
    });
    throw err; // BullMQ will retry
  }

  // ── Step 2: Execute approve or reject ────────────────────────
  let result;
  if (action === 'approve') {
    result = await approveDraft(draftId, workspaceId, userId);
  } else {
    result = await rejectDraft(draftId, workspaceId, userId);
  }

  console.log('[midas:confirmation-worker] Confirmation processed', {
    jobId: job.id,
    draftId,
    outcome: result.outcome,
    workspaceId,
    // No financial amounts logged (SEC-12)
  });

  // ── Step 3: Answer callback_query (visual — remove spinner) ──
  const callbackText =
    result.outcome === 'approved'
      ? '✅ Транзакция сохранена'
      : result.outcome === 'rejected'
        ? '❌ Черновик отклонён'
        : result.outcome === 'expired'
          ? '⏰ Черновик истёк'
          : result.outcome === 'already_processed'
            ? '⚠️ Уже обработано'
            : result.outcome === 'intent_missing'
              ? '❓ Тип операции не распознан'
              : '⚠️ Черновик не найден';

  // Fire-and-forget: don't fail the job if this times out
  void answerCallbackQuery(callbackQueryId, callbackText);

  // ── Step 4: Send result notification — Phase 1.34 rich cards ──
  let notificationMessage: string;
  let inlineKeyboardJson: string | undefined;  // inline keyboard (for editMessageText path)
  // Phase 1.38: replyKeyboardJson removed — ReplyKeyboard sent once on /start only.
  // Workers no longer re-send it, preserving the user's collapse preference.

  switch (result.outcome) {
    case 'approved':
      notificationMessage = buildConfirmedScreen({
        intent: result.intent,
        amount: result.amount,
        currency: result.currency,
        categoryName: result.categoryName,
        accountName: result.accountName,
        itemName: result.itemName,
        transactionTime: result.transactionTime, // Phase 1.36-UX: timestamp on card
        // Phase 2.4 PR13: balance snapshot — powers the "Итог" block
        accountCurrency: result.accountCurrency,
        balanceBefore:   result.balanceBefore,
        balanceAfter:    result.balanceAfter,
        debitAmount:     result.debitAmount,
        debitCurrency:   result.debitCurrency,
      });
      inlineKeyboardJson = JSON.stringify(
        buildPostConfirmKeyboard(result.transactionId),
      );
      break;
    case 'rejected':
      notificationMessage = buildRejectedScreen();
      // Phase 1.38: ReplyKeyboard lives in chat from /start — not re-sent here.
      // Re-sending would force it open and override the user's collapse preference.
      break;
    case 'expired':
      notificationMessage = buildExpiredScreen();
      // Phase 1.38: ReplyKeyboard not re-sent — user's collapse preference preserved.
      break;
    case 'already_processed':
      if (result.existingStatus === 'approved') {
        // Phase 1.35: fetch and show the confirmed transaction card
        let approvedCard = result.approvedCard ?? null;
        if (!approvedCard) {
          // Fetch by draftId if not already populated (e.g. SKIP LOCKED path)
          try {
            approvedCard = await fetchApprovedTransactionCard(draftId, workspaceId, userId);
          } catch { /* non-fatal: fall back to plain message */ }
        }
        if (approvedCard) {
          notificationMessage = buildConfirmedScreen({
            intent: approvedCard.intent,
            amount: approvedCard.amount,
            currency: approvedCard.currency,
            categoryName: approvedCard.categoryName,
            accountName: approvedCard.accountName,
            itemName: approvedCard.itemName,
            // Phase 2.4 PR13: pass balance snapshot if available (old cards may not have it)
            accountCurrency: approvedCard.accountCurrency ?? null,
            balanceBefore:   approvedCard.balanceBefore ?? null,
            balanceAfter:    approvedCard.balanceAfter ?? null,
            debitAmount:     approvedCard.debitAmount ?? null,
            debitCurrency:   approvedCard.debitCurrency ?? null,
          });
          inlineKeyboardJson = JSON.stringify(buildPostConfirmKeyboard(approvedCard.transactionId));
          break;
        }
      }
      // For other statuses (rejected, expired, etc.) or if fetch failed:
      notificationMessage = buildAlreadyProcessedScreen(result.existingStatus);
      break;
    case 'not_found':
      notificationMessage = buildNotFoundScreen();
      break;
    case 'intent_missing':
      notificationMessage = buildIntentMissingScreen();
      // Phase 1.38: ReplyKeyboard not re-sent — user's collapse preference preserved.
      break;
    default:
      notificationMessage = 'ℹ️ Обработка завершена.';
  }

  const alertId = ulid();

  // Phase 1.36-UX: Read preview message_id for this specific draft.
  // Stored by notifications.worker when preview card was sent (midas:preview:{draftId}).
  // Only used for approve — to edit the preview card into confirmed card in-place.
  let previewMsgId: string | undefined;


  // Phase 1.39: Read preview message_id for approve AND reject.
  // Strategy: Redis (fast cache) → DB fallback (durable).
  // For approve: preview card → "✅ Записано"
  // For reject:  preview card → "❌ Отменено"
  // Both edit in-place — no duplicate messages in chat.
  if (action === 'approve' || action === 'reject') {
    try {
      // 1. Redis (fast, may be expired after 1h)
      const pVal = await redisConnection.get(`midas:preview:${draftId}`);
      if (pVal) {
        previewMsgId = pVal;
      } else {
        // 2. DB fallback (durable, always available)
        const dbInfo = await getPreviewMessageInfo(draftId, workspaceId);
        if (dbInfo) previewMsgId = dbInfo.messageId;
      }
    } catch { /* non-fatal */ }
  }

  await notificationsQueue.add(
    QUEUE_NAMES.NOTIFICATIONS,
    {
      alertId,
      workspaceId,
      chatId,
      message: notificationMessage,
      inlineKeyboardJson,
      // Phase 1.38: replyKeyboardJson omitted — keyboard lives in chat from /start.
      telegramUserId,
      // Phase 1.38: edit preview card in-place for approve AND reject
      // approve → "✅ Записано"  |  reject → "❌ Отменено"
      activeMessageId: previewMsgId,
      // No draftId in result notification (user already confirmed)
      // Phase 2.10: confirmed success cards must NOT update midas:am: so the next
      // upsertBotMessage (new tx draft) sends a NEW message instead of editing the card.
      isSuccessCard: result.outcome === 'approved',
    },
    {
      jobId: IdempotencyKeyBuilder.notification(workspaceId, alertId),
    },
  );

  // Phase 1.39: Cleanup gate state after approve/reject.
  // 1. Delete gate_sent flag so next message isn't blocked
  // 2. Delete gate card from chat (I-1)
  // 3. Cleanup Redis preview cache (C-9: delete AFTER successful edit)
  try {
    void redisConnection.del(`midas:gate_sent:${telegramUserId}:${chatId}`);
    void redisConnection.del(`midas:preview:${draftId}`);

    // Phase 1.40: After reject/expired, mark card as "dead" so the next
    // new preview auto-deletes it. Approved cards stay visible ("✅ Записано").
    // Key uses chatId only (== telegramUserId in private chats) so
    // draft-expiration CRON can also write this without telegramUserId.
    if ((result.outcome === 'rejected' || result.outcome === 'expired') && previewMsgId) {
      void redisConnection.set(`midas:dead_card:${chatId}`, previewMsgId, 'EX', 86400);
    }

    // I-1: Delete gate card message from chat
    const gateCardKey = `midas:gate_card:${telegramUserId}:${chatId}`;
    const gateCardMsgId = await redisConnection.get(gateCardKey);
    if (gateCardMsgId) {
      const gateAlertId = ulid();
      await notificationsQueue.add(
        QUEUE_NAMES.NOTIFICATIONS,
        {
          alertId: gateAlertId,
          workspaceId,
          chatId,
          message: '',
          deleteMessageId: gateCardMsgId,
        },
        { jobId: IdempotencyKeyBuilder.notification(workspaceId, gateAlertId) },
      );
      void redisConnection.del(gateCardKey);
    }
  } catch { /* non-fatal gate cleanup */ }
}

// ─────────────────────────────────────────────────────────────
// Worker factory
// ─────────────────────────────────────────────────────────────

export function createConfirmationWorker(): Worker<CallbackConfirmJobPayload> {
  const worker = new Worker<CallbackConfirmJobPayload>(
    QUEUE_NAMES.CALLBACK_CONFIRM,
    processConfirmation,
    {
      connection: redisConnection,
      prefix: 'bull',
      concurrency: 5,
    },
  );

  worker.on('completed', (job: Job<CallbackConfirmJobPayload>) => {
    console.log('[midas:confirmation-worker] Job completed', {
      jobId: job.id,
      draftId: job.data.draftId,
      action: job.data.action,
      workspaceId: job.data.workspaceId,
    });
  });

  worker.on('failed', (job: Job<CallbackConfirmJobPayload> | undefined, err: Error) => {
    console.error('[midas:confirmation-worker] Job failed', {
      jobId: job?.id ?? 'unknown',
      draftId: job?.data.draftId,
      action: job?.data.action,
      workspaceId: job?.data.workspaceId,
      errorClass: err.constructor.name,
      // No raw_text (SEC-12)
    });
  });

  return worker;
}

// ─────────────────────────────────────────────────────────────
// Re-export callbackConfirmQueue for use by telegram-bot
// ─────────────────────────────────────────────────────────────
export { callbackConfirmQueue };
