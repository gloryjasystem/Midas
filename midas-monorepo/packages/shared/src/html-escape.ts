/**
 * HTML Escape Utility — Phase 1.15 / Phase 5.1-Pre
 *
 * Moved to @midas/shared so both the Telegram webhook (telegram-bot)
 * and background workers can import the same pure function without
 * crossing the app boundary.
 *
 * Provides escapeHtml() for use in any service that renders user-controlled
 * or DB-sourced string values inside a Telegram message sent with
 * parse_mode: 'HTML'.
 *
 * Telegram HTML mode interprets five special characters:
 *   &   → &amp;
 *   <   → &lt;
 *   >   → &gt;
 *   "   → &quot;
 *   '   → &#x27;
 *
 * Rules:
 *   - ONLY call escapeHtml() on dynamic/DB-sourced values, NOT on the full
 *     message string — that would escape intentional <b>...</b> tags.
 *   - Static string literals hardcoded in source are trusted; escaping them
 *     is harmless but unnecessary.
 *   - Never call escapeHtml() twice on the same value (double-escaping).
 *
 * Zero external dependencies — safe for any app or worker context.
 * SEC-12: This module does not log any values.
 * SEC-02: No financial amounts involved. No float arithmetic.
 */

/**
 * Escape a string for safe inclusion in a Telegram HTML-mode message.
 *
 * Characters escaped: & < > " '
 *
 * @param input - The raw string value (e.g. from DB or user input)
 * @returns The HTML-safe string, ready for use inside parse_mode:'HTML' messages
 *
 * @example
 * escapeHtml('<b>test</b>')  // → '&lt;b&gt;test&lt;/b&gt;'
 * escapeHtml('Fish & Chips') // → 'Fish &amp; Chips'
 * escapeHtml('"quoted"')     // → '&quot;quoted&quot;'
 * escapeHtml("it's fine")   // → 'it&#x27;s fine'
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
