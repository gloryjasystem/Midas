/**
 * Telegram Bot API Client — Phase 1.5
 *
 * Minimal wrapper for Telegram Bot API sendMessage.
 *
 * Scope (Phase 1.5): Only sendMessage is implemented.
 * Future phases will add: sendMessage with InlineKeyboardMarkup, answerCallbackQuery, etc.
 *
 * SEC-12: This module does NOT log message text. Only chatId and success/failure are logged.
 *
 * Base URL: https://api.telegram.org/bot{token}/METHOD
 * Timeout: 5s (Telegram SLA is usually <1s but cloud may be slow)
 *
 * Authentication: TELEGRAM_BOT_TOKEN env var (set at deployment time, never in source code).
 *
 * Rate limits (Telegram):
 *   - 30 messages/second to different chats (global)
 *   - 1 message/second to the same chat
 *   Phase 1.5 sends at most 1 message per /start — no rate limit concern at this scale.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Send a text message to a Telegram chat.
 *
 * @param chatId - string Telegram chat ID (same as telegramUserId for private chats)
 * @param text - message text (max 4096 chars per Telegram API)
 * @returns true on success, false if API returned non-OK (non-throwing for resilience)
 *
 * @throws Never — all errors are caught and returned as false.
 *         The webhook MUST return 200 to Telegram regardless of notification status.
 */
export async function sendMessage(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    // In dev without token, skip silently. Production startup validation will catch this.
    return false;
  }

  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      // Non-throwing: Telegram API failure must not prevent 200 response to webhook
      return false;
    }

    const data = (await response.json()) as { ok: boolean };
    return data.ok;
  } catch {
    // Network error, timeout, etc. — non-throwing for webhook resilience
    return false;
  }
}
