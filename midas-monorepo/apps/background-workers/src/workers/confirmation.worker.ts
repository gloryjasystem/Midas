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
import { approveDraft, rejectDraft } from '../services/draft-confirmation.service.js';
import { resolveUserId } from '../services/draft.service.js';
import { ulid } from 'ulid';

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

  // ── Step 4: Send result notification ─────────────────────────
  let notificationMessage: string;
  switch (result.outcome) {
    case 'approved':
      // Phase 1.28: attach permanent [✏️ Изменить] button.
      // callback_data = "ed:v:<transactionId>" (31 bytes — within 64-byte limit).
      // The button persists indefinitely in the message — no TTL needed.
      notificationMessage = `✅ Транзакция создана успешно.\n\nНажмите кнопку, чтобы изменить детали.`;
      break;
    case 'rejected':
      notificationMessage = `❌ Черновик отклонён. Отправьте новое сообщение для создания транзакции.`;
      break;
    case 'expired':
      notificationMessage = `⏰ Черновик истёк (более 24 часов). Отправьте сообщение повторно.`;
      break;
    case 'already_processed':
      notificationMessage = `ℹ️ Этот черновик уже обработан (статус: ${result.existingStatus}).`;
      break;
    case 'not_found':
      notificationMessage = `⚠️ Черновик не найден. Возможно, он уже был удалён.`;
      break;
    case 'intent_missing':
      // Phase 1.8-A: draft has NULL parsed_intent — AI could not determine transaction type.
      // No Transaction was created. User should resend with clearer text.
      notificationMessage = `❓ Не удалось определить тип операции (расход/доход/долг). Отправьте сообщение повторно с уточнением.`;
      break;
    default:
      notificationMessage = `ℹ️ Обработка завершена.`;
  }

  const alertId = ulid();

  // Phase 1.28: for approved transactions, attach the permanent [✏️ Изменить] edit button.
  const inlineKeyboardJson =
    result.outcome === 'approved'
      ? JSON.stringify({
          inline_keyboard: [
            [{ text: '✏️ Изменить', callback_data: `ed:v:${result.transactionId}` }],
          ],
        })
      : undefined;

  await notificationsQueue.add(
    QUEUE_NAMES.NOTIFICATIONS,
    {
      alertId,
      workspaceId,
      chatId,
      message: notificationMessage,
      inlineKeyboardJson,
      // No draftId in result notification (user already confirmed)
    },
    {
      jobId: IdempotencyKeyBuilder.notification(workspaceId, alertId),
    },
  );
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
