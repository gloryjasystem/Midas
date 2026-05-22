/**
 * Command Router — Phase 2S2 (Phase 0.1)
 *
 * Lightweight regex-based router that detects navigation commands
 * in free-text input (typed messages or voice transcripts).
 *
 * Zero dependencies on DB, Redis, or Telegram API.
 * Pure function — safe to call from webhook route AND voice-parse worker.
 *
 * SEC-12: Input text is NOT logged by this module.
 *
 * NOTE: JavaScript \b word boundary does NOT work with Cyrillic characters
 * (they are treated as non-word chars). Similarly, \w does NOT match Cyrillic.
 * We use explicit character classes [а-яёa-z0-9_] where needed.
 */

export type NavCommand =
  | 'balance' | 'settings' | 'export' | 'add_account'
  | 'help' | 'report' | 'transactions' | 'cancel_last';

interface CommandPattern {
  cmd: NavCommand;
  patterns: RegExp[];
  /** If true, presence of a digit in text disqualifies this match → AI parse */
  checkNumber: boolean;
}

const COMMAND_PATTERNS: CommandPattern[] = [
  {
    cmd: 'balance',
    patterns: [/баланс/i, /сколько денег/i, /мой баланс/i, /портфель/i],
    checkNumber: true,  // "баланс 500" → AI parse
  },
  {
    cmd: 'report',
    patterns: [/отч[её]т/i, /статистик/i, /аналитик/i, /расходы/i],
    checkNumber: true,  // "расходы 1000" → AI parse
  },
  {
    cmd: 'settings',
    patterns: [/настройк/i, /(?:^|\s)опции(?:\s|$)/i],
    checkNumber: false,
  },
  {
    cmd: 'export',
    patterns: [/экспорт/i, /выгруз/i, /скинь[а-яё]*\s+(?:эксел|excel)/i, /скачай/i, /экспортируй/i],
    checkNumber: false,
  },
  {
    cmd: 'add_account',
    patterns: [/добав[а-яё]*\s+сч[её]т/i, /нов[а-яё]+\s+сч[её]т/i, /создай\s+сч[её]т/i],
    checkNumber: false,
  },
  {
    cmd: 'help',
    patterns: [/помощь/i, /справк/i, /что ты умеешь/i, /как пользоваться/i],
    checkNumber: false,
  },
  {
    cmd: 'transactions',
    patterns: [/транзакци/i, /истори[яю]/i, /(?:^|\s)операции(?:\s|$)/i],
    checkNumber: false,
  },
  {
    cmd: 'cancel_last',
    patterns: [/отмени.*последн/i, /удали.*последн/i],
    checkNumber: false,
  },
];

const HAS_DIGIT = /\d/;

/**
 * Detect a navigation command in free-text input.
 *
 * @param text - Raw user text or normalized voice transcript
 * @returns NavCommand key if matched, null if no command detected
 *
 * Behavior:
 * - Empty or very long (>200 chars) text → null
 * - Matched pattern with checkNumber=true and text contains a digit → null (AI parse)
 * - First match wins (commands ordered by priority)
 */
export function detectCommand(text: string): NavCommand | null {
  const normalized = text.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 200) return null;

  for (const { cmd, patterns, checkNumber } of COMMAND_PATTERNS) {
    for (const re of patterns) {
      if (re.test(normalized)) {
        if (checkNumber && HAS_DIGIT.test(normalized)) {
          return null; // "баланс 500" → not a command
        }
        return cmd;
      }
    }
  }
  return null;
}
