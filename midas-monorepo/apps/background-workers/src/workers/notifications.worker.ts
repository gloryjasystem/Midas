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
import { savePreviewMessageId, saveReminderMessageId } from '../services/draft.service.js';

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
    if (res.ok) return true;

    // Phase 1.37-UX: "message is not modified" means content is already correct.
    // Treat as success — do NOT fall back to sendMessage (which creates duplicates).
    const errBody = await res.text().catch(() => '(unreadable)');
    if (errBody.includes('message is not modified')) {
      return true;
    }

    console.warn('[midas:notifications-worker] editMessageText failed', {
      chatId, messageId, status: res.status, errBody: errBody.slice(0, 300),
    });
    return false;
  } catch (err) {
    console.warn('[midas:notifications-worker] editMessageText exception', {
      chatId, messageId, errorClass: err instanceof Error ? err.constructor.name : 'UnknownError',
    });
    return false;
  }
}


/**
 * Phase 1.37-UX: Delete a Telegram message. Best-effort — never throws.
 * Used to remove the old "Не понял" card before sending a new preview card.
 */
async function deleteTelegramMessage(chatId: string, messageId: string): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API_BASE}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: parseInt(messageId, 10),
      }),
    });
    // Response not checked — delete is best-effort (message may already be gone)
  } catch {
    // Non-fatal: user may have deleted it manually, or message too old
  }
}


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

  // Phase 1.37-UX: Delete previous "Не понял" card if requested.
  // This happens when AI successfully parses a new message after a failed one.
  // Deleting BEFORE sending the new card keeps chat clean (no leftover clarification card).
  if (job.data.deleteMessageId) {
    await deleteTelegramMessage(chatId, job.data.deleteMessageId);
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


  // Phase 1.39: Store preview message_id in Redis (fast cache, 1h TTL)
  // AND in PostgreSQL (durable fallback for confirmation worker).
  if (draftId && sentMessageId) {
    try {
      await redisConnection.set(`midas:preview:${draftId}`, sentMessageId, 'EX', 3600);
      // Phase 1.39: DB persistence (survives Redis TTL)
      if (workspaceId) {
        void savePreviewMessageId(draftId, workspaceId, sentMessageId, chatId).catch(() => {/* non-fatal */});
      }
    } catch { /* non-fatal */ }
  }

  // Phase 1.37-UX: If cacheStoreKey is set, write sentMessageId back to Redis.
  // Used by clarification flow and Phase 1.39 reminder/gate tracking.
  if (job.data.cacheStoreKey && sentMessageId) {
    try {
      await redisConnection.set(job.data.cacheStoreKey, sentMessageId, 'EX', 3600);
      // Phase 1.39: Persist reminder message_id to DB if this is a reminder
      if (job.data.cacheStoreKey.startsWith('midas:reminder:') && draftId && workspaceId) {
        void saveReminderMessageId(draftId, workspaceId, sentMessageId).catch(() => {/* non-fatal */});
      }
    } catch { /* non-fatal */ }
  }

  console.log('[midas:notifications-worker] Notification sent', {
    jobId: job.id,
    alertId,
    workspaceId,
    editFirst: !!job.data.activeMessageId,
    edited: sentMessageId === job.data.activeMessageId,
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
