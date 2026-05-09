/**
 * Telegram Bot API Client — Phase 1.5 / Phase 1.26 / Phase 1.33
 *
 * Wrapper for Telegram Bot API.
 *
 * Phase 1.5: sendMessage (text only).
 * Phase 1.26: added inline keyboard support:
 *   - sendMessageWithKeyboard — send new message with InlineKeyboardMarkup
 *   - editMessageText — edit existing message text + keyboard
 *   - editMessageReplyMarkup — edit only keyboard (text unchanged)
 *   - answerCallbackQuery — dismiss Telegram spinner after callback_query
 * Phase 1.33: Clean Chat UX additions:
 *   - sendMessage / sendMessageWithKeyboard now return message_id (string | null)
 *   - deleteMessage — best-effort delete user messages
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

/**
 * Telegram ReplyKeyboardMarkup.
 * keyboard is a 2D array: outer = rows, inner = button texts per row.
 * Phase 1.36-UX: persistent bottom navigation keyboard.
 */
export interface ReplyKeyboardMarkup {
  keyboard: string[][];
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  input_field_placeholder?: string;
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

/**
 * Internal helper that returns the full parsed Telegram API response.
 * Used by send functions that need to extract the message_id from the result.
 * Phase 1.33: needed for active-message pointer tracking.
 */
async function telegramPostFull(
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; result?: { message_id?: number } } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

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
    if (!response.ok) return null;
    return (await response.json()) as { ok: boolean; result?: { message_id?: number } };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// sendMessage
// ─────────────────────────────────────────────────────────────

/**
 * Send a plain text message to a Telegram chat.
 *
 * Phase 1.33: returns the sent message_id as string, or null on failure.
 * Previously returned boolean — all callers used fire-and-forget (void) pattern,
 * so this change is backward-compatible.
 *
 * @param chatId - string Telegram chat ID
 * @param text - HTML-mode message text (max 4096 chars)
 * @returns message_id as string on success, null on any error (non-throwing)
 */
export async function sendMessage(chatId: string, text: string): Promise<string | null> {
  const resp = await telegramPostFull('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  });
  if (resp?.ok && resp.result?.message_id) return String(resp.result.message_id);
  return null;
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
 * Phase 1.33: returns the sent message_id as string, or null on failure.
 *
 * @param chatId   - string Telegram chat ID
 * @param text     - HTML-mode message text
 * @param keyboard - InlineKeyboardMarkup (buttons with callback_data ≤ 64 bytes each)
 * @returns message_id as string on success, null on any error (non-throwing)
 */
export async function sendMessageWithKeyboard(
  chatId: string,
  text: string,
  keyboard: InlineKeyboardMarkup,
): Promise<string | null> {
  const resp = await telegramPostFull('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
  if (resp?.ok && resp.result?.message_id) return String(resp.result.message_id);
  return null;
}

// ───────────────────────────────────────────────────────────────
// sendMessageWithReplyKeyboard (Phase 1.36-UX)
// ───────────────────────────────────────────────────────────────

/**
 * Send a message with a persistent ReplyKeyboardMarkup (bottom navigation).
 *
 * Phase 1.36-UX: Used exclusively to activate the persistent bottom navigation
 * keyboard on /start. Reply Keyboards cannot be added via editMessageText —
 * they require a fresh sendMessage call.
 *
 * SEC-12: text NOT logged. Only chatId is metadata.
 *
 * @param chatId   - string Telegram chat ID
 * @param text     - HTML-mode message text (greeting / re-greeting)
 * @param keyboard - ReplyKeyboardMarkup to attach
 * @returns message_id as string on success, null on any error (non-throwing)
 */
export async function sendMessageWithReplyKeyboard(
  chatId: string,
  text: string,
  keyboard: ReplyKeyboardMarkup,
): Promise<string | null> {
  const resp = await telegramPostFull('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
  if (resp?.ok && resp.result?.message_id) return String(resp.result.message_id);
  return null;
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
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;

  const url = `${TELEGRAM_API_BASE}/bot${token}/editMessageText`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: parseInt(messageId, 10),
        text,
        parse_mode: 'HTML',
        ...(keyboard ? { reply_markup: keyboard } : {}),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      const data = (await response.json()) as { ok: boolean };
      return data.ok;
    }

    // Phase 1.37-UX: "message is not modified" is NOT a real error —
    // it means the message already shows the correct content.
    // Treat as success so upsertBotMessage does NOT fall back to sendMessage,
    // which would create a duplicate message (observed when the user taps
    // the same ReplyKeyboard button — Balance / Report / Settings — more than once).
    //
    // All other 400 errors (message not found, bot blocked, etc.) are still false.
    const errData = (await response.json()) as { ok: boolean; description?: string };
    if (errData.description?.includes('message is not modified')) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
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

// ─────────────────────────────────────────────────────────────
// deleteMessage (Phase 1.33)
// ─────────────────────────────────────────────────────────────

/**
 * Best-effort delete a message from a Telegram chat.
 *
 * Phase 1.33: Used to clean up user text messages after processing,
 * keeping the chat history minimal (single active bot message pattern).
 *
 * Failures are expected and acceptable:
 *   - Bot may lack delete permissions in group chats.
 *   - Message may already be deleted.
 *   - Message may be too old (48h+ in groups).
 *
 * SEC-12: Only chatId and messageId are used — no text content.
 *
 * @param chatId    - string Telegram chat ID
 * @param messageId - string message ID to delete
 * @returns true on success, false on any error (non-throwing)
 */
export async function deleteMessage(
  chatId: string,
  messageId: string,
): Promise<boolean> {
  return telegramPost('deleteMessage', {
    chat_id: chatId,
    message_id: parseInt(messageId, 10),
  });
}
