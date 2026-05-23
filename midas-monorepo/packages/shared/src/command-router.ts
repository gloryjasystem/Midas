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
  | 'help' | 'report' | 'transactions' | 'cancel_last' | 'edit_last'
  // Phase 5.0: Context-Aware Quick Edits
  | 'edit_amount' | 'edit_category' | 'edit_account' | 'edit_type';

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
  // ── Phase 5.0 / 5.1-C: Context-Aware Quick Edits ─────────────────────────
  // MUST be before edit_last — these patterns are more specific (include
  // the field noun: сумм / категори / сч[её]т / тип) so they cannot conflict
  // with the generic edit_last patterns ("измени запись", "измени транзакцию").
  //
  // Safety design (Phase 5.1-C hardening):
  //   ✅ Negative lookahead (?![а-яё]) after each verb stem prevents past-tense
  //      leakage: "изменил" → "измени" + lookahead sees "л" ∈ [а-яё] → NO MATCH
  //      "поменяла" → "поменя" + lookahead sees "л" → NO MATCH
  //   ✅ [,.\\s]+.* allows Whisper punctuation between verb and noun:
  //      "измени, сумму" / "смени. тип" both match correctly
  //   ✅ checkNumber: false — "измени сумму на 500" is still quick-edit, not AI parse
  //   ❌ Ambiguous phrases ("другую сумму", "это был доход") intentionally omitted
  //
  // NOTE: JS \b does NOT work with Cyrillic (non-word chars) — we use (?![а-яё])
  {
    cmd: 'edit_amount',
    patterns: [
      /измени(?:ть)?(?![а-яё])[,.\s]+.*сумм/i,    // "измени сумму" / "измени, сумму" / "изменить сумму"
      /поменя(?:ть|й)?(?![а-яё])[,.\s]+.*сумм/i,  // "поменяй сумму" / «поменять, сумму»
      /смени(?:ть)?(?![а-яё])[,.\s]+.*сумм/i,     // "смени сумму" / "сменить сумму"
      /редактир(?:уй|овать|ую)?(?![а-яё])[,.\s]+.*сумм/i, // "редактируй сумму" / "редактировать сумму"
      /исправ(?:ить|ь)?(?![а-яё])[,.\s]+.*сумм/i, // "исправь сумму" / "исправить сумму"
    ],
    checkNumber: false,
  },
  {
    cmd: 'edit_category',
    patterns: [
      /измени(?:ть)?(?![а-яё])[,.\s]+.*категори/i,
      /поменя(?:ть|й)?(?![а-яё])[,.\s]+.*категори/i,
      /смени(?:ть)?(?![а-яё])[,.\s]+.*категори/i,
      /редактир(?:уй|овать|ую)?(?![а-яё])[,.\s]+.*категори/i,
      /исправ(?:ить|ь)?(?![а-яё])[,.\s]+.*категори/i,
    ],
    checkNumber: false,
  },
  {
    cmd: 'edit_account',
    patterns: [
      /измени(?:ть)?(?![а-яё])[,.\s]+.*сч[её]т/i,
      /поменя(?:ть|й)?(?![а-яё])[,.\s]+.*сч[её]т/i,
      /смени(?:ть)?(?![а-яё])[,.\s]+.*сч[её]т/i,
      /редактир(?:уй|овать|ую)?(?![а-яё])[,.\s]+.*сч[её]т/i,
      /исправ(?:ить|ь)?(?![а-яё])[,.\s]+.*сч[её]т/i,
    ],
    checkNumber: false,
  },
  {
    cmd: 'edit_type',
    patterns: [
      /измени(?:ть)?(?![а-яё])[,.\s]+.*тип/i,
      /поменя(?:ть|й)?(?![а-яё])[,.\s]+.*тип/i,
      /смени(?:ть)?(?![а-яё])[,.\s]+.*тип/i,
      /редактир(?:уй|овать|ую)?(?![а-яё])[,.\s]+.*тип/i,
      /исправ(?:ить|ь)?(?![а-яё])[,.\s]+.*тип/i,
    ],
    checkNumber: false,
  },
  {
    cmd: 'edit_last',
    // MUST be before cancel_last — "изменить последнюю запись" contains "запись"
    // which would match cancel_last patterns if it came first.
    patterns: [
      /измени.*последн/i,     // "измени последнюю запись"
      /изменить.*последн/i,   // "изменить последнюю транзакцию"
      /редактир.*последн/i,   // "редактировать последнюю"
      /измени.*запись/i,      // "измени запись"
      /изменить.*запись/i,    // "изменить запись"
      /редактир.*запись/i,    // "редактировать запись"
      /измени.*транзакци/i,   // "измени транзакцию"
      /изменить.*транзакци/i, // "изменить транзакцию"
      /редактир.*транзакци/i, // "редактировать транзакцию"
    ],
    checkNumber: false,
  },
  {
    cmd: 'cancel_last',
    // MUST be before 'transactions' — "отмени последнюю транзакцию" contains "транзакци"
    // which would match the transactions pattern if it came first.
    patterns: [
      /отмени.*последн/i,
      /удали.*последн/i,
      /отменить.*последн/i,
      /удалить.*последн/i,
      /отмени.*запись/i,
      /удали.*запись/i,
      /отменить.*запись/i,
      /удалить.*запись/i,
      /отмени.*транзакци/i,
      /удали.*транзакци/i,
      /отменить.*транзакци/i,
      /удалить.*транзакци/i,
      /последн[а-яё]*\s+(?:транзакци|запись|запис[а-яё])/i,
    ],
    checkNumber: false,
  },
  {
    cmd: 'transactions',
    patterns: [/транзакци/i, /истори[яю]/i, /(?:^|\s)операции(?:\s|$)/i],
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
