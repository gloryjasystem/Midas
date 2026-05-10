/**
 * Screen Builder Utility — Phase 1.34 / Phase 1.36-UX
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

/** Strip trailing zeros from amount: 1000.0000 → 1000, 100.50 → 100.5 */
export function formatAmount(raw: string | number | null | undefined): string {
  if (raw == null || raw === '') return '0';
  const s = String(raw);
  if (s.includes('.')) {
    return s.replace(/\.?0+$/, '');
  }
  return s;
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
 * Layout:
 * ```
 * 💸 Расход
 *
 * ┃ 100 USDT        ← <blockquote> — нативный элемент Telegram, не переносится
 * ┃ ручка
 *
 * 📁 Кофе   ·   🏦 Binance
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

  // ── Blockquote: amount + item name ───────────────────────────
  // <blockquote> — нативный UI-элемент Telegram (полоска слева).
  // Никогда не переносится, одинаково выглядит на всех экранах.
  if (data.amount) {
    const amountLine = `<b>${formatAmount(data.amount)} ${data.currency ?? 'USDT'}</b>`;
    const blockContent = data.itemName
      ? `${amountLine}\n${data.itemName}`
      : amountLine;
    lines.push(`<blockquote>${blockContent}</blockquote>`);
    lines.push('');
  } else if (data.itemName) {
    lines.push(`<blockquote>${data.itemName}</blockquote>`);
    lines.push('');
  }

  // ── Details: category · account (middle dot — U+00B7) ────────
  const details: string[] = [];
  if (data.categoryHint) details.push(`📁 ${data.categoryHint}`);
  if (data.accountHint)  details.push(`🏦 ${data.accountHint}`);
  if (details.length > 0) {
    lines.push(details.join('   ·   '));
    lines.push('');
  }

  lines.push('<i>Всё верно?</i>');

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
  transactionTime?: string | null; // ISO string — опционально для обратной совместимости
}

// ─────────────────────────────────────────────────────────────
// Time formatter (private)
// ─────────────────────────────────────────────────────────────

/**
 * Format ISO timestamp to Russian short form: "09:13, 9 мая"
 * Purely local — no timezone conversion (uses server time from DB NOW()).
 */
function formatTransactionTime(iso: string): string {
  try {
    const d = new Date(iso);
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн',
                    'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    const month = months[d.getMonth()] ?? '';
    return `${hh}:${mm}, ${d.getDate().toString()} ${month}`;
  } catch {
    return '';
  }
}

/**
 * Build the post-confirmation "Записано" card.
 *
 * Layout:
 * ```
 * ✅ Записано
 *
 * ┃ 💸 100 USDT     ← <blockquote>
 * ┃ ручка
 *
 * 📁 Кофе   ·   🏦 Binance
 * 🕐 09:13, 9 мая
 * ```
 */
export function buildConfirmedScreen(data: ConfirmedScreenData): string {
  const emoji = intentEmoji(data.intent);

  const lines: string[] = ['✅ <b>Записано</b>', ''];

  // ── Blockquote: amount + item name ───────────────────────────
  const amountLine = `${emoji} <b>${data.amount} ${data.currency}</b>`;
  const blockContent = data.itemName
    ? `${amountLine}\n${data.itemName}`
    : amountLine;
  lines.push(`<blockquote>${blockContent}</blockquote>`);
  lines.push('');

  // ── Details: category · account ──────────────────────────────
  const details: string[] = [];
  if (data.categoryName) details.push(`📁 ${data.categoryName}`);
  if (data.accountName)  details.push(`🏦 ${data.accountName}`);
  if (details.length > 0) {
    lines.push(details.join('   ·   '));
  }

  // ── Timestamp ─────────────────────────────────────────────────
  if (data.transactionTime) {
    const ts = formatTransactionTime(data.transactionTime);
    if (ts) lines.push(`🕐 <i>${ts}</i>`);
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
    'Транзакция не была подтверждена в течение 1 часа.',
    'Отправьте сообщение повторно.',
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
  askAmountWithCurrency?: boolean; // Phase 1.38: ask both in one step
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
      if (data.askAmountWithCurrency) {
        // Phase 1.38: combined prompt — no default currency set yet
        lines.push('Напиши сумму и валюту:');
        lines.push('<blockquote>1000 USD · 500 руб · 200 USDT · 50 евро</blockquote>');
        lines.push('');
        lines.push('<blockquote>💡 Чтобы не указывать каждый раз — установи её в ⚙️ Настройках</blockquote>');
      } else {
        lines.push('Сколько потратил? Отправь сумму:');
      }
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
// Phase 1.39: Gate, Reminder, Expired screens
// ─────────────────────────────────────────────────────────────

export interface GateDraftData {
  parsedIntent: string | null;
  parsedAmount: string | null;
  parsedCurrency: string | null;
  parsedCategoryHint: string | null;
  itemName: string | null;
}

/** Build a compact draft summary block (reused across gate/reminder/expired). */
function buildDraftSummaryBlock(data: GateDraftData): string {
  const emoji = intentEmoji(data.parsedIntent);
  const label = intentLabel(data.parsedIntent);
  const lines: string[] = [`${emoji} <b>${label}</b>`];

  if (data.parsedAmount) {
    const amountLine = `<b>${formatAmount(data.parsedAmount)} ${data.parsedCurrency ?? 'USDT'}</b>`;
    const blockContent = data.itemName
      ? `${amountLine}\n${data.itemName}`
      : amountLine;
    lines.push(`<blockquote>${blockContent}</blockquote>`);
  } else if (data.itemName) {
    lines.push(`<blockquote>${data.itemName}</blockquote>`);
  }

  if (data.parsedCategoryHint) {
    lines.push(`\n📁 ${data.parsedCategoryHint}`);
  }

  return lines.join('\n');
}

export function buildPendingGateScreen(data: GateDraftData): string {
  const summary = buildDraftSummaryBlock(data);
  return [
    '⚠️ <b>Незаписанная транзакция</b>',
    '',
    summary,
    '',
    '<i>Подтвердите или отмените черновик,</i>',
    '<i>прежде чем записать новую транзакцию.</i>',
  ].join('\n');
}

export function buildGatePausedPreview(data: GateDraftData): string {
  const summary = buildDraftSummaryBlock(data);
  return [
    '⚠️ <b>Новая запись отклонена.</b>',
    'Завершите эту транзакцию, чтобы продолжить.',
    '',
    summary,
  ].join('\n');
}

export function buildReminderScreen(data: GateDraftData): string {
  const summary = buildDraftSummaryBlock(data);
  return [
    '⏰ <b>Не забудьте подтвердить!</b>',
    '',
    summary,
    '',
    '<i>Черновик будет автоматически отменён</i>',
    '<i>через 10 минут.</i>',
  ].join('\n');
}

export function buildExpiredDraftScreen(data: GateDraftData): string {
  const emoji = intentEmoji(data.parsedIntent);
  const label = intentLabel(data.parsedIntent);
  const amountPart = data.parsedAmount
    ? ` · ${formatAmount(data.parsedAmount)} ${data.parsedCurrency ?? 'USDT'}`
    : '';

  return [
    '⏰ <b>Черновик истёк</b>',
    '',
    `${emoji} ${label}${amountPart}`,
    '',
    '<i>Транзакция не была подтверждена</i>',
    '<i>и автоматически отменена.</i>',
    '',
    'Отправьте новое сообщение для записи.',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// Navigation Keyboards
// ─────────────────────────────────────────────────────────────

type InlineButton = { text: string; callback_data: string };
type InlineKeyboard = { inline_keyboard: InlineButton[][] };

/**
 * Build the post-confirmation navigation keyboard.
 *
 * Row 1: [✏️ Изменить запись]         ← отдельная строка — редактирование
 * Row 2: [💰 Баланс] [📊 Отчёт]      ← навигация
 *
 * Phase 2.0: icons match ReplyKeyboard constants.
 */
export function buildPostConfirmKeyboard(transactionId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '✏️ Изменить запись', callback_data: `ed:v:${transactionId}` },
      ],
      [
        { text: '💰 Баланс', callback_data: 'nav:balance' },
        { text: '📊 Отчёт',  callback_data: 'nav:report' },
      ],
    ],
  };
}

/**
 * Build the post-rejection / error navigation keyboard.
 * [💰 Баланс] [📊 Отчёт]
 * Phase 2.0: icons match ReplyKeyboard constants.
 */
export function buildNavKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '💰 Баланс', callback_data: 'nav:balance' },
        { text: '📊 Отчёт',  callback_data: 'nav:report' },
      ],
    ],
  };
}

/**
 * Build the standard approve/reject confirmation keyboard.
 *
 * Row 1: [✅  Подтвердить]             ← Primary — полная ширина
 * Row 2: [✏️ Изменить] [✖️ Отмена]   ← Secondary (neutral emoji, not red ❌)
 *
 * Подтверждение и отмена никогда не стоят рядом (anti-pattern).
 */
export function buildConfirmKeyboard(draftId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '✅  Подтвердить', callback_data: `approve:${draftId}` },
      ],
      [
        { text: '✏️ Изменить', callback_data: `draft:edit:${draftId}` },
        { text: '✖️ Отмена',   callback_data: `reject:${draftId}` },
      ],
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// Main Menu Reply Keyboard — Phase 1.36-UX
// ─────────────────────────────────────────────────────────────

/**
 * Telegram ReplyKeyboardMarkup.
 * keyboard is a 2D array: outer = rows, inner = button texts per row.
 */
export interface ReplyKeyboardMarkup {
  keyboard: string[][];
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  input_field_placeholder?: string;
}

/**
 * Button texts for the persistent bottom navigation keyboard.
 * Exported so webhook.route.ts can intercept incoming button-press messages
 * (Reply Keyboard buttons send their label as a plain text message).
 *
 * Phase 2.0: unique icons per button (💰 📋 📊 ⚙️).
 */
export const NAV_BTN_BALANCE      = '💰 Баланс';
export const NAV_BTN_TRANSACTIONS = '📋 Транзакции';  // Phase 2.0
export const NAV_BTN_REPORT       = '📊 Отчёт';
export const NAV_BTN_SETTINGS     = '⚙️ Настройки';

/**
 * Build the persistent bottom navigation keyboard (ReplyKeyboardMarkup).
 *
 * Phase 2.0 Layout (2×2):
 *   Row 1: [💰 Баланс]  [📋 Транзакции]
 *   Row 2: [📊 Отчёт]   [⚙️ Настройки]
 *
 * Flags:
 *   resize_keyboard: true  — minimal vertical height
 *   is_persistent:   false — user can collapse/restore with Telegram's native UI icon
 *
 * Send once on /start — persists for the lifetime of the chat.
 */
export function buildMainMenuKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [NAV_BTN_BALANCE, NAV_BTN_TRANSACTIONS],
      [NAV_BTN_REPORT, NAV_BTN_SETTINGS],
    ],
    resize_keyboard: true,
    is_persistent: false,  // Phase 1.38: native ⏄ collapse icon — user controls visibility
    input_field_placeholder: 'Напишите о расходе или доходе...',
  };
}
