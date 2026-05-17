/**
 * Active Message Service — Phase 1.33 / Phase 2.9+
 *
 * Manages two independent Redis pointers per user/chat:
 *
 *   midas:am:{telegramUserId}:{chatId}  → message_id
 *     The "active" bot message: draft pickers, confirmation previews,
 *     account flows, clarification cards, etc.
 *     Managed by upsertBotMessage() — edit-first, delete-on-fail.
 *
 *   midas:nav:{telegramUserId}:{chatId} → message_id
 *     The navigation panel message: Баланс / Отчёт / Транзакции / Настройки.
 *     Managed by sendNavMessage() — edit-first within nav key ONLY.
 *     NEVER touches midas:am: — guarantees tx records with "Изменить запись"
 *     are never overwritten or deleted by a nav button press.
 *     Cleared by getNavMessageId()/clearNavMessageId() when user types a
 *     free-text transaction so the nav panel is removed before the draft appears.
 *
 * TTL: 24 hours (auto-cleanup for both keys).
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
// Redis key helpers — Active Message (midas:am:)
// ─────────────────────────────────────────────────────────────

const AM_KEY_PREFIX = 'midas:am:';
const AM_TTL_SEC = 86400; // 24 hours

function amKey(telegramUserId: string, chatId: string): string {
  return `${AM_KEY_PREFIX}${telegramUserId}:${chatId}`;
}

// ─────────────────────────────────────────────────────────────
// Redis key helpers — Nav Message (midas:nav:)
// ─────────────────────────────────────────────────────────────

const NAV_KEY_PREFIX = 'midas:nav:';
const NAV_TTL_SEC = 86400; // 24 hours

function navKey(telegramUserId: string, chatId: string): string {
  return `${NAV_KEY_PREFIX}${telegramUserId}:${chatId}`;
}

// ─────────────────────────────────────────────────────────────
// Active Message pointer CRUD (midas:am:)
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
// Nav Message pointer CRUD (midas:nav:) — Phase 2.9+
// ─────────────────────────────────────────────────────────────

/**
 * Get the nav panel message ID for a user/chat pair.
 * Returns null if no nav message is open or Redis is unavailable.
 */
export async function getNavMessageId(
  telegramUserId: string,
  chatId: string,
): Promise<string | null> {
  try {
    return await redisConnection.get(navKey(telegramUserId, chatId));
  } catch {
    return null;
  }
}

/**
 * Store the nav panel message ID for a user/chat pair.
 * Sets TTL to 24h.
 */
async function setNavMessageId(
  telegramUserId: string,
  chatId: string,
  messageId: string,
): Promise<void> {
  try {
    await redisConnection.set(navKey(telegramUserId, chatId), messageId, 'EX', NAV_TTL_SEC);
  } catch {
    // Non-fatal
  }
}

/**
 * Clear the nav panel message pointer.
 * Called when user types a free-text transaction so the nav panel
 * is deleted before the draft picker appears.
 */
export async function clearNavMessageId(
  telegramUserId: string,
  chatId: string,
): Promise<void> {
  try {
    await redisConnection.del(navKey(telegramUserId, chatId));
  } catch {
    // Non-fatal
  }
}

// ─────────────────────────────────────────────────────────────
// upsertBotMessage — THE core function for drafts/pickers/flows
// ─────────────────────────────────────────────────────────────

/**
 * Send or update the single active bot message (midas:am: key).
 *
 * Strategy:
 *   1. Read pointer from Redis (midas:am:)
 *   2. If pointer exists → editMessageText(pointer, text, keyboard)
 *   3. If edit succeeds → done (pointer unchanged, TTL refreshed)
 *   4. If edit fails OR no pointer → sendMessage/sendMessageWithKeyboard
 *   5. Store new message_id as pointer in midas:am:
 *
 * NEVER touches midas:nav: — nav messages are completely independent.
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
    // Edit failed — fall through to send new message. Try best-effort delete of the old message.
    void deleteMessage(chatId, currentMsgId);
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

    // Phase 2.9+: If we had to send a NEW active message (pushing the chat down),
    // invalidate the nav message pointer so that the next nav button press
    // sends a fresh nav message at the bottom instead of silently updating an off-screen one.
    getNavMessageId(telegramUserId, chatId).then((oldNavId) => {
      if (oldNavId) {
        void deleteMessage(chatId, oldNavId);
        void clearNavMessageId(telegramUserId, chatId);
      }
    }).catch(() => { /* silent */ });
  }

  return newMsgId;
}

// ─────────────────────────────────────────────────────────────
// sendNavMessage — Phase 2.9+: nav buttons (Баланс / Отчёт / Транзакции / Настройки)
// ─────────────────────────────────────────────────────────────

/**
 * Send or update the navigation panel message (midas:nav: key).
 *
 * Unlike upsertBotMessage, this function uses a SEPARATE Redis key (midas:nav:)
 * and NEVER touches midas:am:. This guarantees that confirmed transaction cards
 * with "✏️ Изменить запись" buttons are never overwritten or deleted when
 * the user taps Баланс / Отчёт / Транзакции / Настройки.
 *
 * Strategy:
 *   1. Read nav pointer from Redis (midas:nav:)
 *   2. If pointer exists → editMessageText(pointer, text, keyboard)
 *   3. If edit succeeds → refresh TTL, return same message_id (no new message sent)
 *   4. If edit fails OR no pointer → sendMessage/sendMessageWithKeyboard
 *   5. Store new message_id in midas:nav:
 *   6. midas:am: is NEVER read or written.
 *
 * Nav message lifecycle:
 *   - Created/edited here on each nav button press
 *   - Deleted in webhook AI-parse path (Step 7) when user types a transaction
 *   - Auto-expires after 24h via Redis TTL
 *
 * Returns the message_id of the nav message, or null on total failure.
 *
 * SEC-12: text content is NOT logged.
 */
export async function sendNavMessage(
  telegramUserId: string,
  chatId: string,
  text: string,
  keyboard?: InlineKeyboardMarkup,
): Promise<string | null> {
  // Step 1: Read current nav pointer (midas:nav: — NOT midas:am:)
  const currentNavMsgId = await getNavMessageId(telegramUserId, chatId);

  // Step 2: Try edit if nav pointer exists
  if (currentNavMsgId) {
    const editOk = await editMessageText(chatId, currentNavMsgId, text, keyboard);
    if (editOk) {
      // Refresh TTL on successful edit — no new message sent
      void setNavMessageId(telegramUserId, chatId, currentNavMsgId);
      return currentNavMsgId;
    }
    // Edit failed (message deleted by user or expired) — fall through to send new message
    // No delete needed: message is already gone if edit returned false
  }

  // Step 3: Send new nav message
  let newMsgId: string | null;
  if (keyboard) {
    newMsgId = await sendMessageWithKeyboard(chatId, text, keyboard);
  } else {
    newMsgId = await sendMessage(chatId, text);
  }

  // Step 4: Update nav pointer (midas:nav:) — midas:am: is NOT touched
  if (newMsgId) {
    void setNavMessageId(telegramUserId, chatId, newMsgId);
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
