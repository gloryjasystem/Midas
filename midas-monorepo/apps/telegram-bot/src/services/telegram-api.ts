/**
 * Telegram Bot API Client — Phase 1.5 / Phase 1.26
 *
 * Wrapper for Telegram Bot API.
 *
 * Phase 1.5: sendMessage (text only).
 * Phase 1.26: added inline keyboard support:
 *   - sendMessageWithKeyboard — send new message with InlineKeyboardMarkup
 *   - editMessageText — edit existing message text + keyboard
 *   - editMessageReplyMarkup — edit only keyboard (text unchanged)
 *   - answerCallbackQuery — dismiss Telegram spinner after callback_query
 *
 * SEC-12: This module does NOT log message text or callback data.
 *         Only chatId, messageId, callbackQueryId, and success/failure are logged.
 *
 * Base URL: https://api.telegram.org/bot{token}/METHOD
 * Timeout: 5s (Telegram SLA is usually <1s but cloud may be slow)
 *
 * Authentication: TELEGRAM_BOT_TOKEN env var (set at deployment time, never in source code).
 *
 * Rate limits (Telegram):
 *   - 30 messages/second to different chats (global)
 *   - 1 message/second to the same chat
 *
 * All functions: non-throwing — network/API failures return false.
 * The webhook MUST return 200 to Telegram regardless of notification status.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 5_000;

// ─────────────────────────────────────────────────────────────
// Telegram inline keyboard types
// ─────────────────────────────────────────────────────────────

/** A single inline keyboard button with callback_data. */
export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

/**
 * Telegram InlineKeyboardMarkup.
 * inline_keyboard is a 2D array: outer = rows, inner = buttons per row.
 * Telegram limit: callback_data ≤ 64 bytes per button.
 */
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

// ─────────────────────────────────────────────────────────────
// Internal fetch helper
// ─────────────────────────────────────────────────────────────

async function telegramPost(method: string, body: Record<string, unknown>): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;

  const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!response.ok) return false;
    const data = (await response.json()) as { ok: boolean };
    return data.ok;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// sendMessage
// ─────────────────────────────────────────────────────────────

/**
 * Send a plain text message to a Telegram chat.
 *
 * @param chatId - string Telegram chat ID
 * @param text - HTML-mode message text (max 4096 chars)
 * @returns true on success, false on any error (non-throwing)
 */
export async function sendMessage(chatId: string, text: string): Promise<boolean> {
  return telegramPost('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  });
}

// ─────────────────────────────────────────────────────────────
// sendMessageWithKeyboard (Phase 1.26)
// ─────────────────────────────────────────────────────────────

/**
 * Send a message with an inline keyboard.
 *
 * Used for /settings main menu and currency group pages.
 * SEC-12: text and keyboard content NOT logged.
 *
 * @param chatId   - string Telegram chat ID
 * @param text     - HTML-mode message text
 * @param keyboard - InlineKeyboardMarkup (buttons with callback_data ≤ 64 bytes each)
 * @returns true on success, false on any error (non-throwing)
 */
export async function sendMessageWithKeyboard(
  chatId: string,
  text: string,
  keyboard: InlineKeyboardMarkup,
): Promise<boolean> {
  return telegramPost('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}

// ─────────────────────────────────────────────────────────────
// editMessageText (Phase 1.26)
// ─────────────────────────────────────────────────────────────

/**
 * Edit the text of an existing inline keyboard message.
 *
 * Used for navigation between pages: when user taps Next/Prev/Back,
 * the same message is updated in-place — no new messages sent.
 *
 * Telegram returns 400 if message is not modified or already deleted.
 * We silently ignore those errors — webhook still returns 200.
 *
 * @param chatId    - string Telegram chat ID
 * @param messageId - ID of the message to edit (from cq.message.message_id)
 * @param text      - new HTML-mode text
 * @param keyboard  - new InlineKeyboardMarkup (optional, pass undefined to remove keyboard)
 * @returns true on success, false on any error (non-throwing)
 */
export async function editMessageText(
  chatId: string,
  messageId: string,
  text: string,
  keyboard?: InlineKeyboardMarkup,
): Promise<boolean> {
  return telegramPost('editMessageText', {
    chat_id: chatId,
    message_id: parseInt(messageId, 10),
    text,
    parse_mode: 'HTML',
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

// ─────────────────────────────────────────────────────────────
// editMessageReplyMarkup (Phase 1.26)
// ─────────────────────────────────────────────────────────────

/**
 * Replace the inline keyboard of an existing message without changing its text.
 *
 * Used to remove keyboard after currency is selected.
 * Pass keyboard: undefined or empty inline_keyboard to remove buttons.
 *
 * @param chatId    - string Telegram chat ID
 * @param messageId - ID of the message to update
 * @param keyboard  - new keyboard (pass { inline_keyboard: [] } to remove)
 * @returns true on success, false on any error (non-throwing)
 */
export async function editMessageReplyMarkup(
  chatId: string,
  messageId: string,
  keyboard: InlineKeyboardMarkup,
): Promise<boolean> {
  return telegramPost('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: parseInt(messageId, 10),
    reply_markup: keyboard,
  });
}

// ─────────────────────────────────────────────────────────────
// answerCallbackQuery (Phase 1.26)
// ─────────────────────────────────────────────────────────────

/**
 * Answer a callback_query to dismiss the Telegram loading spinner.
 *
 * MUST be called for every callback_query within 10 seconds, otherwise
 * Telegram shows a loading spinner indefinitely to the user.
 *
 * SEC-12: text NOT logged. callbackQueryId is safe metadata.
 *
 * @param callbackQueryId - cq.id from the incoming callback_query
 * @param text            - optional short notification text shown briefly to user
 * @returns true on success, false on any error (non-throwing)
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<boolean> {
  return telegramPost('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

