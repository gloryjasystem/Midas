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
import { ulid } from 'ulid';

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
    const reminderText = buildReminderScreen({
      parsedIntent: draft.parsedIntent,
      parsedAmount: draft.parsedAmount,
      parsedCurrency: draft.parsedCurrency,
      parsedCategoryHint: draft.parsedCategoryHint,
      itemName: draft.itemName,
    });

    await notificationsQueue.add(
      QUEUE_NAMES.NOTIFICATIONS,
      {
        alertId,
        workspaceId: draft.workspaceId,
        chatId: draft.previewChatId,
        draftId: draft.draftId,
        message: reminderText,
        inlineKeyboardJson: JSON.stringify(buildConfirmKeyboard(draft.draftId)),
        cacheStoreKey: `midas:reminder:${draft.draftId}`,
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
