/**
 * Screen Builder Utility — Phase 1.34
 *
 * Pure functions for building structured "app screen" card messages
 * for the Telegram bot. All messages use parse_mode:'HTML'.
 *
 * Design: one evolving screen per chat — never a pile of messages.
 *
 * SEC-12: No raw user text logged. Amount values come from draft/DB,
 *         not from raw user input.
 * SEC-02: No float arithmetic. Amounts are NUMERIC strings from DB.
 *
 * All user-controlled values (categoryName, accountName, etc.) MUST
 * be escaped via escapeHtml() BEFORE being passed to these functions.
 * The screen builders treat all inputs as pre-escaped.
 */

// ─────────────────────────────────────────────────────────────
// Intent → Emoji / Label mapping
// ─────────────────────────────────────────────────────────────

const INTENT_EMOJI: Record<string, string> = {
  expense:       '💸',
  income:        '💰',
  debt_given:    '🤝',
  debt_received: '🤲',
  transfer:      '🔄',
};

const INTENT_LABEL: Record<string, string> = {
  expense:       'Расход',
  income:        'Доход',
  debt_given:    'Долг (дал)',
  debt_received: 'Долг (взял)',
  transfer:      'Перевод',
};

/** Get emoji for a transaction intent. Fallback: 📝 */
export function intentEmoji(intent: string | null | undefined): string {
  return INTENT_EMOJI[intent ?? ''] ?? '📝';
}

/** Get Russian label for a transaction intent. Fallback: Транзакция */
export function intentLabel(intent: string | null | undefined): string {
  return INTENT_LABEL[intent ?? ''] ?? 'Транзакция';
}

// ─────────────────────────────────────────────────────────────
// Preview Screen (after AI parse, before confirmation)
// ─────────────────────────────────────────────────────────────

export interface PreviewScreenData {
  intent: string | null;
  amount: string | null;
  currency: string | null;
  categoryHint: string | null;   // pre-escaped
  accountHint: string | null;    // pre-escaped
  itemName: string | null;       // Phase 1.35, pre-escaped
}

/**
 * Build the transaction preview card shown before user confirms.
 *
 * Example:
 * ```
 * 💸 Расход
 *
 * Сумма: 100 USDT
 * Категория: Кофе
 * Счёт: Binance
 *
 * Всё верно?
 * ```
 */
export function buildPreviewScreen(data: PreviewScreenData): string {
  const emoji = intentEmoji(data.intent);
  const label = intentLabel(data.intent);

  const lines: string[] = [
    `${emoji} <b>${label}</b>`,
    '',
  ];

  if (data.amount) {
    lines.push(`Сумма: <b>${data.amount} ${data.currency ?? 'USDT'}</b>`);
  }
  if (data.itemName) {
    lines.push(`📝 ${data.itemName}`);
  }
  if (data.categoryHint) {
    lines.push(`📁 Категория: ${data.categoryHint}`);
  }
  if (data.accountHint) {
    lines.push(`🏦 Счёт: ${data.accountHint}`);
  }

  lines.push('');
  lines.push('Всё верно?');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Confirmed Screen (after approval)
// ─────────────────────────────────────────────────────────────

export interface ConfirmedScreenData {
  intent: string | null;
  amount: string;               // pre-escaped NUMERIC string
  currency: string;             // pre-escaped
  categoryName: string | null;  // pre-escaped
  accountName: string | null;   // pre-escaped
  itemName: string | null;      // Phase 1.35, pre-escaped
}

/**
 * Build the post-confirmation "Записано" card.
 *
 * Example:
 * ```
 * ✅ Записано
 *
 * 💸 100 USDT
 * Категория: Кофе
 * Счёт: Binance
 * ```
 */
export function buildConfirmedScreen(data: ConfirmedScreenData): string {
  const emoji = intentEmoji(data.intent);

  const lines: string[] = [
    '✅ <b>Записано</b>',
    '',
    `${emoji} <b>${data.amount} ${data.currency}</b>`,
  ];

  if (data.itemName) {
    lines.push(`📝 ${data.itemName}`);
  }
  if (data.categoryName) {
    lines.push(`📁 ${data.categoryName}`);
  }
  if (data.accountName) {
    lines.push(`🏦 ${data.accountName}`);
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Rejected Screen
// ─────────────────────────────────────────────────────────────

/**
 * Build the post-rejection card.
 */
export function buildRejectedScreen(): string {
  return [
    '❌ <b>Отменено</b>',
    '',
    'Отправьте новое сообщение для записи.',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// Error / Edge-Case Screens
// ─────────────────────────────────────────────────────────────

export function buildExpiredScreen(): string {
  return [
    '⏰ <b>Черновик истёк</b>',
    '',
    'Прошло более 24 часов. Отправьте сообщение повторно.',
  ].join('\n');
}

export function buildAlreadyProcessedScreen(existingStatus: string): string {
  return [
    'ℹ️ <b>Уже обработано</b>',
    '',
    `Текущий статус: ${existingStatus}`,
  ].join('\n');
}

export function buildNotFoundScreen(): string {
  return [
    '⚠️ <b>Не найдено</b>',
    '',
    'Черновик не найден. Возможно, он уже был удалён.',
  ].join('\n');
}

export function buildIntentMissingScreen(): string {
  return [
    '❓ <b>Тип не определён</b>',
    '',
    'Не удалось определить тип операции.',
    'Отправьте сообщение повторно с уточнением (расход/доход/долг).',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// Clarification Screens (Phase 1.32 enhanced)
// ─────────────────────────────────────────────────────────────

export interface ClarificationScreenData {
  field: 'amount' | 'intent' | 'category';
  intent: string | null;
  amount: string | null;
  currency: string | null;
  categoryHint: string | null;  // pre-escaped
}

/**
 * Build a clarification card showing known fields and asking for the missing one.
 */
export function buildClarificationScreen(data: ClarificationScreenData): string {
  const lines: string[] = ['🤔 <b>Уточнение</b>', ''];

  // Show what we already know
  if (data.intent) {
    lines.push(`${intentEmoji(data.intent)} ${intentLabel(data.intent)}`);
  }
  if (data.amount) {
    lines.push(`Сумма: <b>${data.amount} ${data.currency ?? 'USDT'}</b>`);
  }
  if (data.categoryHint) {
    lines.push(`Категория: ${data.categoryHint}`);
  }

  lines.push('');

  // Ask for the missing field
  switch (data.field) {
    case 'amount':
      lines.push('Сколько потратил? Отправь сумму:');
      break;
    case 'intent':
      lines.push('Что произошло? Выбери тип:');
      break;
    case 'category':
      lines.push('Выбери категорию:');
      break;
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Nonsense Screen (confidence < 0.3)
// ─────────────────────────────────────────────────────────────

export function buildNonsenseScreen(): string {
  return [
    '🤔 <b>Не понял</b>',
    '',
    'Что хотел записать?',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// Navigation Keyboards
// ─────────────────────────────────────────────────────────────

type InlineButton = { text: string; callback_data: string };
type InlineKeyboard = { inline_keyboard: InlineButton[][] };

/**
 * Build the post-confirmation navigation keyboard.
 * [✏️ Изменить] [📊 Баланс] [📋 Отчёт]
 */
export function buildPostConfirmKeyboard(transactionId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '✏️ Изменить', callback_data: `ed:v:${transactionId}` },
        { text: '📊 Баланс',   callback_data: 'nav:balance' },
        { text: '📋 Отчёт',    callback_data: 'nav:report' },
      ],
    ],
  };
}

/**
 * Build the post-rejection / error navigation keyboard.
 * [📊 Баланс] [📋 Отчёт]
 */
export function buildNavKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '📊 Баланс', callback_data: 'nav:balance' },
        { text: '📋 Отчёт',  callback_data: 'nav:report' },
      ],
    ],
  };
}

/**
 * Build the standard approve/reject confirmation keyboard.
 * Row 1: [✅ Подтвердить] [❌ Отмена]
 * Row 2: [✏️ Изменить]
 */
export function buildConfirmKeyboard(draftId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '✅ Подтвердить', callback_data: `approve:${draftId}` },
        { text: '❌ Отмена',      callback_data: `reject:${draftId}` },
      ],
      [
        { text: '✏️ Изменить', callback_data: `draft:edit:${draftId}` },
      ],
    ],
  };
}
