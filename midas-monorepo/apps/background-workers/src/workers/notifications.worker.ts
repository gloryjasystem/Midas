/**
 * notifications Worker — Phase 1.6-B
 *
 * Processes jobs from the `notifications` queue.
 * Sends real Telegram messages using Bot API.
 * Concurrency: 10 | Rate limit: 30 msg/s (Telegram Flood Limit)
 *
 * Phase 1.6-B additions:
 *   - Real Telegram Bot API calls (sendMessage)
 *   - Inline keyboard support (inlineKeyboardJson)
 *   - Draft confirmation messages
 *
 * SEC-12: message is system-generated — safe to log its length.
 *         Never log user-supplied financial text.
 * SEC-06: Idempotency key: notify|{workspaceId}|{alertId}
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, type NotificationJobPayload } from '@midas/shared';
import { redisConnection } from '../queues/redis.js';

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN ?? ''}`;

// ─────────────────────────────────────────────────────────────
// Telegram sendMessage
// ─────────────────────────────────────────────────────────────

interface SendMessageOptions {
  chatId: string;
  text: string;
  replyMarkup?: object;
}

async function sendTelegramMessage(opts: SendMessageOptions): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: opts.chatId,
    text: opts.text,
    parse_mode: 'HTML',
  };

  if (opts.replyMarkup) {
    body.reply_markup = opts.replyMarkup;
  }

  const res = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Telegram sendMessage failed: ${String(res.status)} — ${errorText}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Worker processor
// ─────────────────────────────────────────────────────────────

async function processNotification(job: Job<NotificationJobPayload>): Promise<void> {
  const { alertId, workspaceId, chatId, draftId, inlineKeyboardJson } = job.data;
  // job.data.message is system-generated — safe to log length (SEC-12)

  console.log('[midas:notifications-worker] Processing notification', {
    jobId: job.id,
    alertId,
    workspaceId,
    chatId,
    draftId,
    messageLength: job.data.message.length,
    hasInlineKeyboard: !!inlineKeyboardJson,
  });

  // Parse inline keyboard if provided
  let replyMarkup: object | undefined;
  if (inlineKeyboardJson) {
    try {
      replyMarkup = JSON.parse(inlineKeyboardJson) as object;
    } catch (err: unknown) {
      console.warn('[midas:notifications-worker] Failed to parse inlineKeyboardJson', {
        jobId: job.id,
        alertId,
        errorClass: err instanceof Error ? err.constructor.name : 'ParseError',
      });
      // Send without keyboard rather than failing the job
    }
  }

  await sendTelegramMessage({
    chatId,
    text: job.data.message,
    replyMarkup,
  });

  console.log('[midas:notifications-worker] Notification sent', {
    jobId: job.id,
    alertId,
    workspaceId,
  });
}

// ─────────────────────────────────────────────────────────────
// Worker factory
// ─────────────────────────────────────────────────────────────

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
