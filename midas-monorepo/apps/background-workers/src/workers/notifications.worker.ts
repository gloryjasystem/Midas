/**
 * notifications Worker
 *
 * Processes jobs from the `notifications` queue.
 * Concurrency: 10 (per queue_model.md)
 *
 * Responsibilities:
 *   1. Send Telegram messages to users (bot replies, confirmations, alerts)
 *   2. Respects Telegram Flood Limit: max 30 messages / second
 *      (BullMQ rate limiter: 30 / 1000ms)
 *   3. Idempotency via jobId (notify:{workspaceId}:{alertId}) — SEC-06
 *   4. Never log raw financial text (SEC-12)
 *
 * Phase 1.3: Infrastructure skeleton only.
 * Telegram Bot API client integrated in Phase 1.4 (Telegram Bot app).
 * In Phase 1.4, the telegram-bot app will be the HTTP server; notifications
 * worker will call the Telegram API directly or delegate via internal RPC.
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, type NotificationJobPayload } from '@midas/shared';
import { redisConnection } from '../queues/redis.js';

async function processNotification(job: Job<NotificationJobPayload>): Promise<void> {
  const { alertId, workspaceId, chatId, draftId } = job.data;
  // job.data.message is safe to log (it's a system-generated response, not raw user input)

  console.log('[midas:notifications-worker] Processing notification', {
    jobId: job.id,
    alertId,
    workspaceId,
    chatId,
    draftId,
    // message is a system string, safe to log
    messageLength: job.data.message.length,
  });

  // ── Phase 1.4 stub ────────────────────────────────────────
  // TODO Phase 1.4 (Telegram Bot):
  //   const bot = getTelegramBotClient(); // injected singleton
  //   await bot.sendMessage(chatId, job.data.message, {
  //     reply_markup: job.data.inlineKeyboardJson
  //       ? JSON.parse(job.data.inlineKeyboardJson)
  //       : undefined,
  //   });

  // Await a no-op to satisfy require-await lint rule during skeleton phase
  // This will be replaced with real async Telegram API calls in Phase 1.4
  await Promise.resolve();

  console.log('[midas:notifications-worker] Phase 1.3 skeleton — Telegram send pending (Phase 1.4)', {
    jobId: job.id,
    alertId,
    workspaceId,
  });
}

export function createNotificationsWorker(): Worker<NotificationJobPayload> {
  const worker = new Worker<NotificationJobPayload>(
    QUEUE_NAMES.NOTIFICATIONS,
    processNotification,
    {
      connection: redisConnection,
      prefix: 'bull',
      concurrency: 10,
      // BullMQ built-in rate limiting: 30 notifications per second (Telegram Flood Limit)
      limiter: {
        max: 30,
        duration: 1_000, // 1 second
      },
    },
  );

  worker.on('completed', (job: Job<NotificationJobPayload>) => {
    console.log('[midas:notifications-worker] Notification sent', {
      jobId: job.id,
      alertId: job.data.alertId,
      workspaceId: job.data.workspaceId,
    });
  });

  worker.on('failed', (job: Job<NotificationJobPayload> | undefined, err: Error) => {
    console.error('[midas:notifications-worker] Notification failed', {
      jobId: job?.id ?? 'unknown',
      alertId: job?.data.alertId,
      workspaceId: job?.data.workspaceId,
      errorClass: err.constructor.name,
    });
  });

  return worker;
}
