/**
 * notifications Worker — Phase 1.6-B / Phase 1.33
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
 * Phase 1.33 additions:
 *   - Edit-first pattern: if activeMessageId present, try editMessageText before send
 *   - Active message pointer updated in Redis after send/edit
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

async function sendTelegramMessage(opts: SendMessageOptions): Promise<string | null> {
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

  // Phase 1.33: extract message_id for active-message pointer tracking
  try {
    const data = (await res.json()) as { ok: boolean; result?: { message_id?: number } };
    if (data.ok && data.result?.message_id) return String(data.result.message_id);
  } catch {
    // Non-fatal — message was sent, just can't track
  }
  return null;
}

/**
 * Phase 1.33: Try to edit an existing Telegram message.
 * Returns true if edit succeeded, false otherwise (non-throwing).
 */
async function editTelegramMessage(
  chatId: string,
  messageId: string,
  text: string,
  replyMarkup?: object,
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      message_id: parseInt(messageId, 10),
      text,
      parse_mode: 'HTML',
    };
    if (replyMarkup) body.reply_markup = replyMarkup;

    const res = await fetch(`${TELEGRAM_API_BASE}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '(unreadable)');
      console.warn('[midas:notifications-worker] editMessageText failed', {
        chatId, messageId, status: res.status, errBody: errBody.slice(0, 300),
      });
    }
    return res.ok;
  } catch (err) {
    console.warn('[midas:notifications-worker] editMessageText exception', {
      chatId, messageId, errorClass: err instanceof Error ? err.constructor.name : 'UnknownError',
    });
    return false;
  }
}



// ─────────────────────────────────────────────────────────────
// Worker processor
// ─────────────────────────────────────────────────────────────

async function processNotification(job: Job<NotificationJobPayload>): Promise<void> {
  const { alertId, workspaceId, chatId, draftId, inlineKeyboardJson } = job.data;
  const { replyKeyboardJson } = job.data;  // Phase 1.36-UX
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

  // Parse keyboards:
  // inlineKeyboardJson → used on editMessageText path (inline keyboard, Telegram supports this)
  // replyKeyboardJson  → used on sendMessage path ONLY (ReplyKeyboard, edit does NOT support it)
  let inlineReplyMarkup: object | undefined;
  if (inlineKeyboardJson) {
    try {
      inlineReplyMarkup = JSON.parse(inlineKeyboardJson) as object;
    } catch (err: unknown) {
      console.warn('[midas:notifications-worker] Failed to parse inlineKeyboardJson', {
        jobId: job.id,
        alertId,
        errorClass: err instanceof Error ? err.constructor.name : 'ParseError',
      });
    }
  }

  let freshReplyMarkup: object | undefined;
  if (replyKeyboardJson) {
    try {
      freshReplyMarkup = JSON.parse(replyKeyboardJson) as object;
    } catch {
      freshReplyMarkup = inlineReplyMarkup; // fallback to inline if parse fails
    }
  } else {
    freshReplyMarkup = inlineReplyMarkup; // no Reply Keyboard — use inline
  }

  // Phase 1.33: Try edit-first if activeMessageId is available.
  // activeMessageId is only set for the approve notification (to edit preview → confirmed).
  // For new preview cards, activeMessageId is NOT set → always sends new message.
  let sentMessageId: string | null = null;

  if (job.data.activeMessageId) {
    const editOk = await editTelegramMessage(
      chatId,
      job.data.activeMessageId,
      job.data.message,
      inlineReplyMarkup,  // editMessageText: only InlineKeyboard supported by Telegram API
    );
    if (editOk) {
      sentMessageId = job.data.activeMessageId;
    }
  }

  // If edit failed or no activeMessageId, send new message.
  // Use freshReplyMarkup (Reply Keyboard if provided, else inline keyboard).
  if (!sentMessageId) {
    sentMessageId = await sendTelegramMessage({
      chatId,
      text: job.data.message,
      replyMarkup: freshReplyMarkup,  // Phase 1.36-UX: Reply Keyboard activates here
    });
  }

  // Phase 1.36-UX: Delete /start greeting when first transaction is approved.
  // greetingMsgId is only set on approve notifications (confirmation.worker.ts).
  // Non-fatal — if greeting was already deleted or expired, silently skip.
  if (job.data.greetingMsgId) {
    try {
      const res = await fetch(`${TELEGRAM_API_BASE}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: parseInt(job.data.greetingMsgId, 10),
        }),
      });
      if (!res.ok) {
        console.warn('[midas:notifications-worker] deleteMessage (greeting) failed — non-fatal', {
          chatId, greetingMsgId: job.data.greetingMsgId, status: res.status,
        });
      }
    } catch { /* non-fatal */ }
  }

  // Phase 1.36-UX: If this is a preview notification (draftId present), store the
  // sent message_id so the confirmation worker can edit it (preview → confirmed).
  // Key: midas:preview:{draftId} → message_id  TTL: 600s (10 min)
  if (draftId && sentMessageId) {
    try {
      await redisConnection.set(`midas:preview:${draftId}`, sentMessageId, 'EX', 600);
    } catch { /* non-fatal */ }
  }

  console.log('[midas:notifications-worker] Notification sent', {
    jobId: job.id,
    alertId,
    workspaceId,
    editFirst: !!job.data.activeMessageId,
    edited: sentMessageId === job.data.activeMessageId,
    greetingDeleted: !!job.data.greetingMsgId,
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
