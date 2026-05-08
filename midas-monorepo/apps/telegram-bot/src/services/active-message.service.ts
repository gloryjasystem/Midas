/**
 * Active Message Service — Phase 1.33
 *
 * Manages the "single active bot message" pointer per user/chat.
 * Redis key: midas:am:{telegramUserId}:{chatId} → message_id (string)
 * TTL: 24 hours (auto-cleanup).
 *
 * Core function: upsertBotMessage() — attempts edit-first, falls back to send,
 * and updates the Redis pointer. This is the single entry point for all bot
 * replies in the webhook route.
 *
 * SEC-12: No message text is logged. Only chatId, messageId, and success/failure.
 * SEC-03: Pointer is scoped per telegramUserId+chatId — no cross-tenant leak.
 */

import { redisConnection } from '../queues/redis.js';
import {
  sendMessage,
  sendMessageWithKeyboard,
  editMessageText,
  deleteMessage,
  type InlineKeyboardMarkup,
} from './telegram-api.js';

// ─────────────────────────────────────────────────────────────
// Redis key helpers
// ─────────────────────────────────────────────────────────────

const AM_KEY_PREFIX = 'midas:am:';
const AM_TTL_SEC = 86400; // 24 hours

function amKey(telegramUserId: string, chatId: string): string {
  return `${AM_KEY_PREFIX}${telegramUserId}:${chatId}`;
}

// ─────────────────────────────────────────────────────────────
// Pointer CRUD
// ─────────────────────────────────────────────────────────────

/**
 * Get the active bot message ID for a user/chat pair.
 * Returns null if no pointer exists or Redis is unavailable.
 */
export async function getActiveMessageId(
  telegramUserId: string,
  chatId: string,
): Promise<string | null> {
  try {
    return await redisConnection.get(amKey(telegramUserId, chatId));
  } catch {
    return null;
  }
}

/**
 * Store the active bot message ID for a user/chat pair.
 * Sets TTL to 24h — pointer auto-expires if user is inactive.
 */
export async function setActiveMessageId(
  telegramUserId: string,
  chatId: string,
  messageId: string,
): Promise<void> {
  try {
    await redisConnection.set(amKey(telegramUserId, chatId), messageId, 'EX', AM_TTL_SEC);
  } catch {
    // Non-fatal: if Redis fails, next interaction will send a new message
  }
}

/**
 * Clear the active message pointer.
 * Used on /start reset or when the message is known to be invalid.
 */
export async function clearActiveMessageId(
  telegramUserId: string,
  chatId: string,
): Promise<void> {
  try {
    await redisConnection.del(amKey(telegramUserId, chatId));
  } catch {
    // Non-fatal
  }
}

// ─────────────────────────────────────────────────────────────
// upsertBotMessage — THE core function
// ─────────────────────────────────────────────────────────────

/**
 * Send or update the single active bot message.
 *
 * Strategy:
 *   1. Read pointer from Redis
 *   2. If pointer exists → editMessageText(pointer, text, keyboard)
 *   3. If edit succeeds → done (pointer unchanged, TTL refreshed)
 *   4. If edit fails OR no pointer → sendMessage/sendMessageWithKeyboard
 *   5. Store new message_id as pointer
 *
 * Returns the message_id of the active message, or null on total failure.
 *
 * SEC-12: text content is NOT logged.
 */
export async function upsertBotMessage(
  telegramUserId: string,
  chatId: string,
  text: string,
  keyboard?: InlineKeyboardMarkup,
): Promise<string | null> {
  // Step 1: Read current pointer
  const currentMsgId = await getActiveMessageId(telegramUserId, chatId);

  // Step 2: Try edit if pointer exists
  if (currentMsgId) {
    const editOk = await editMessageText(chatId, currentMsgId, text, keyboard);
    if (editOk) {
      // Refresh TTL on successful edit
      void setActiveMessageId(telegramUserId, chatId, currentMsgId);
      return currentMsgId;
    }
    // Edit failed — fall through to send new message
  }

  // Step 3: Send new message
  let newMsgId: string | null;
  if (keyboard) {
    newMsgId = await sendMessageWithKeyboard(chatId, text, keyboard);
  } else {
    newMsgId = await sendMessage(chatId, text);
  }

  // Step 4: Update pointer
  if (newMsgId) {
    void setActiveMessageId(telegramUserId, chatId, newMsgId);
  }

  return newMsgId;
}

// ─────────────────────────────────────────────────────────────
// tryDeleteUserMessage
// ─────────────────────────────────────────────────────────────

/**
 * Best-effort delete a user's text message to keep the chat clean.
 *
 * Non-throwing, fire-and-forget. Failure is silently ignored:
 *   - Bot may lack permissions in groups
 *   - Message may already be deleted
 *   - Telegram API may be temporarily unavailable
 *
 * SEC-12: Only chatId and messageId used — no text content.
 */
export function tryDeleteUserMessage(
  chatId: string,
  messageId: string,
): void {
  void deleteMessage(chatId, messageId);
}
