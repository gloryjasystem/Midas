/**
 * Screen Builder Utility — Phase 1.34 (background-workers copy)
 *
 * Identical to apps/telegram-bot/src/utils/screen-builder.ts.
 * Duplicated here because background-workers is a separate package
 * and cannot import from telegram-bot.
 *
 * Pure functions — no side effects, no dependencies.
 * SEC-12: No raw user text logged or stored.
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

export function intentEmoji(intent: string | null | undefined): string {
  return INTENT_EMOJI[intent ?? ''] ?? '📝';
}

export function intentLabel(intent: string | null | undefined): string {
  return INTENT_LABEL[intent ?? ''] ?? 'Транзакция';
}

// ─────────────────────────────────────────────────────────────
// HTML Escape (inline copy — no cross-package import)
// ─────────────────────────────────────────────────────────────

export function escapeHtml(input: string): string {
  const s = typeof input === 'string' ? input : String(input);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** Strip trailing zeros from amount: 1000.0000 → 1000, 100.50 → 100.5 */
export function formatAmount(raw: string | number | null | undefined): string {
  if (raw == null || raw === '') return '0';
  const s = String(raw);
  // If contains a decimal point, strip trailing zeros and trailing dot
  if (s.includes('.')) {
    return s.replace(/\.?0+$/, '');
  }
  return s;
}

/**
 * Phase 2.4 PR15: Data for the account debit block on the draft confirm card.
 * All string values must be pre-escaped before being passed here.
 * Numeric fields are NUMERIC strings from DB (::TEXT cast) — SEC-02.
 */
export interface AccountBalanceBlock {
  /** Pre-escaped account name, e.g. "Bybit" */
  accountName: string;
  /** Account currency, e.g. "USDT" */
  accountCurrency: string;
  /**
   * Current account balance as NUMERIC string (from getAccountWithBalance).
   * Example: "15400.0000"
   */
  currentBalance: string;
  /**
   * Amount to debit. Same as parsed_amount when currencies match;
   * otherwise account_debit_amount (from patchDraftDebitAmount — PR 5).
   * Example: "500" or "501.5"
   */
  debitAmount: string;
  /**
   * Currency of the debit amount (usually = accountCurrency).
   */
  debitCurrency: string;
  /**
   * Transaction intent — determines sign:
   *   expense / debt_given / transfer → subtract (balance decreases)
   *   income  / debt_received         → add      (balance increases)
   */
  intent: string | null;
}

/**
 * Add or subtract two NUMERIC strings without floating-point arithmetic.
 *
 * Uses BigInt arithmetic on 4-decimal-place scaled integers.
 * Both a and b must be valid non-negative NUMERIC strings (max 4 decimal places).
 * Returns a NUMERIC string with trailing zeros stripped.
 *
 * SEC-02: No floating-point — purely integer-scaled BigInt arithmetic.
 * @internal exported only for unit testing.
 */
export function _numericAdd(a: string, b: string, subtract: boolean): string {
  const toFixed4 = (s: string): string => {
    const [int = '0', dec = ''] = s.split('.');
    return `${int}.${dec.padEnd(4, '0').slice(0, 4)}`;
  };
  const [aInt, aDec] = toFixed4(a).split('.') as [string, string];
  const [bInt, bDec] = toFixed4(b).split('.') as [string, string];
  const aScaled = BigInt(`${aInt}${aDec}`);
  const bScaled = BigInt(`${bInt}${bDec}`);
  const result  = subtract ? aScaled - bScaled : aScaled + bScaled;

  const sign   = result < 0n ? '-' : '';
  const abs    = result < 0n ? -result : result;
  const absStr = abs.toString().padStart(5, '0');
  const intPart = absStr.slice(0, -4) || '0';
  const decPart = absStr.slice(-4).replace(/0+$/, '');
  return decPart ? `${sign}${intPart}.${decPart}` : `${sign}${intPart}`;
}

/**
 * Build the account balance block for the draft confirm card.
 *
 * For expense / debt_given / transfer (subtract):
 *   🏦 <b>Bybit</b> · USDT
 *   💳 15 400 − 500 = <b>14 900 USDT</b>
 *
 * For income / debt_received (add):
 *   🏦 <b>Bybit</b> · USDT
 *   💳 15 400 + 500 = <b>15 900 USDT</b>
 *
 * SEC-02: uses _numericAdd() — BigInt arithmetic, no floating-point.
 * SEC-12: account name must be pre-escaped by caller.
 */
export function buildAccountBalanceBlock(data: AccountBalanceBlock): string {
  const isIncome = data.intent === 'income' || data.intent === 'debt_received';
  const subtract = !isIncome;

  const balanceAfter = _numericAdd(data.currentBalance, data.debitAmount, subtract);

  const before = formatAmount(data.currentBalance);
  const debit  = formatAmount(data.debitAmount);
  const after  = formatAmount(balanceAfter);
  const sign   = subtract ? '−' : '+';

  return (
    `🏦 <b>${data.accountName}</b> · ${data.accountCurrency}\n` +
    `💳 ${before} ${sign} ${debit} = <b>${after} ${data.debitCurrency}</b>`
  );
}


// ─────────────────────────────────────────────────────────────
// calcRate — Phase 2.4 PR13 (moved after buildAccountBalanceBlock for ordering)
// ─────────────────────────────────────────────────────────────

/**
 * Calculate approximate exchange rate for display.
 *
 * rate = debitAmount / txAmount  (rounded to 2 decimal places)
 * Example: calcRate('920000', '10000') = '~92.00'
 *
 * Returns null if either value is 0 or non-numeric.
 * SEC-02: Uses BigInt scaled arithmetic — no floating-point.
 */
export function calcRate(txAmount: string, debitAmount: string): string | null {
  try {
    const toFixed4 = (s: string): string => {
      const [int = '0', dec = ''] = s.split('.');
      return `${int}.${dec.padEnd(4, '0').slice(0, 4)}`;
    };
    const [txInt, txDec]   = toFixed4(txAmount).split('.') as [string, string];
    const [debInt, debDec] = toFixed4(debitAmount).split('.') as [string, string];
    const txScaled  = BigInt(`${txInt}${txDec}`);
    const debScaled = BigInt(`${debInt}${debDec}`);
    if (txScaled === 0n || debScaled === 0n) return null;
    const rateX100 = (debScaled * 100n) / txScaled;
    const rateInt  = (rateX100 / 100n).toString();
    const rateDec  = (rateX100 % 100n).toString().padStart(2, '0');
    return `~${rateInt}.${rateDec}`;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Preview Screen
// ─────────────────────────────────────────────────────────────

export interface PreviewScreenData {
  intent: string | null;
  amount: string | null;
  currency: string | null;
  categoryHint: string | null;
  accountHint: string | null;
  itemName: string | null;  // Phase 1.35
  /** Phase 2.4 PR15: pre-built account balance block. null = no linked account. */
  accountBlock?: AccountBalanceBlock | null;
}

export function buildPreviewScreen(data: PreviewScreenData): string {
  const emoji = intentEmoji(data.intent);
  const label = intentLabel(data.intent);
  const lines: string[] = [`${emoji} <b>${label}</b>`, ''];

  // ── Blockquote: amount + item name ───────────────────────────
  // <blockquote> — нативный UI-элемент Telegram (полоска слева).
  // Никогда не переносится, одинаково выглядит на всех экранах.
  if (data.amount) {
    const amountLine = `<b>${escapeHtml(formatAmount(data.amount))} ${escapeHtml(data.currency ?? 'USDT')}</b>`;
    const blockContent = data.itemName
      ? `${amountLine}\n${escapeHtml(data.itemName)}`
      : amountLine;
    lines.push(`<blockquote>${blockContent}</blockquote>`);
    lines.push('');
  } else if (data.itemName) {
    lines.push(`<blockquote>${escapeHtml(data.itemName)}</blockquote>`);
    lines.push('');
  }

  // ── Phase 2.4 PR15: Account balance block ────────────────────
  if (data.accountBlock) {
    lines.push(buildAccountBalanceBlock(data.accountBlock));
    lines.push('');
  }

  // ── Details: category · account (middle dot — U+00B7) ────────
  const details: string[] = [];
  if (data.categoryHint) details.push(`📁 ${escapeHtml(data.categoryHint)}`);
  // accountHint shown only when accountBlock is absent (backward compat)
  if (!data.accountBlock && data.accountHint)  details.push(`🏦 ${escapeHtml(data.accountHint)}`);
  if (details.length > 0) {
    lines.push(details.join('   ·   '));
    lines.push('');
  }

  lines.push('<i>Всё верно?</i>');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Confirmed Screen
// ─────────────────────────────────────────────────────────────

export interface ConfirmedScreenData {
  intent: string | null;
  amount: string;           // pre-escaped NUMERIC string (tx amount)
  currency: string;         // tx currency, pre-escaped
  categoryName: string | null;
  accountName: string | null;
  itemName: string | null;  // Phase 1.35
  transactionTime?: string | null;
  // ── Phase 2.4 PR 13: account balance snapshot fields ──────────────────────────
  accountCurrency?: string | null;  // may differ from tx currency
  balanceBefore?: string | null;    // NUMERIC string
  balanceAfter?: string | null;     // NUMERIC string
  debitAmount?: string | null;      // account-currency amount (cross-currency only)
  debitCurrency?: string | null;    // currency of debitAmount
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

export function buildConfirmedScreen(data: ConfirmedScreenData): string {
  const emoji = intentEmoji(data.intent);
  const lines: string[] = ['✅ <b>Записано</b>', ''];

  // ── Blockquote: amount + item name ───────────────────────────────────
  const amountLine = `${emoji} <b>${escapeHtml(data.amount)} ${escapeHtml(data.currency)}</b>`;
  const blockContent = data.itemName
    ? `${amountLine}\n${escapeHtml(data.itemName)}`
    : amountLine;
  lines.push(`<blockquote>${blockContent}</blockquote>`);
  lines.push('');

  // ── Details: category (· legacy accountName only without balance snapshot) ──
  const details: string[] = [];
  if (data.categoryName) details.push(`📁 ${escapeHtml(data.categoryName)}`);
  if (data.accountName && !data.balanceBefore) details.push(`🏦 ${escapeHtml(data.accountName)}`);
  if (details.length > 0) {
    lines.push(details.join('   ·   '));
  }

  // ── Timestamp ─────────────────────────────────────────────────────────
  if (data.transactionTime) {
    const ts = formatTransactionTime(data.transactionTime);
    if (ts) lines.push(`🕐 <i>${ts}</i>`);
  }

  // ── Phase 2.4 PR13: «Итог» — balance snapshot block ──────────────────
  if (data.accountName && data.balanceBefore != null) {
    const acctCurrency = data.accountCurrency ?? data.currency;
    const debitAmt     = data.debitAmount ?? data.amount;
    const debitCur     = data.debitCurrency ?? acctCurrency;

    lines.push('');
    lines.push(`🏦 <b>${escapeHtml(data.accountName)}</b> ${escapeHtml(acctCurrency)}`);

    // Cross-currency rate line (only when debitCurrency differs from txCurrency)
    const isCross = !!data.debitAmount && !!data.debitCurrency && data.debitCurrency !== data.currency;
    if (isCross) {
      const rate = calcRate(data.amount, data.debitAmount!);
      const rateSuffix = rate ? ` (${rate} ${data.debitCurrency}/${data.currency})` : '';
      lines.push(`🔁 ${escapeHtml(data.amount)} ${escapeHtml(data.currency)} → ${formatAmount(data.debitAmount!)} ${escapeHtml(data.debitCurrency!)}${rateSuffix}`);
    }

    // Math line: balanceBefore ± debitAmt = balanceAfter
    if (data.balanceAfter != null) {
      const isIncome = data.intent === 'income' || data.intent === 'debt_received';
      const sign     = isIncome ? '+' : '−';
      const before   = formatAmount(data.balanceBefore!);
      const debit    = formatAmount(debitAmt);
      const after    = formatAmount(data.balanceAfter);
      const afterIsNeg = data.balanceAfter.startsWith('-');
      const afterFmt   = afterIsNeg
        ? `⚠️ <b>${after} ${escapeHtml(debitCur)}</b>`
        : `<b>${after} ${escapeHtml(debitCur)}</b>`;
      lines.push(`Итог: ${before} ${sign} ${debit} = ${afterFmt}`);
    }
  }

  return lines.join('\n');
}


// ─────────────────────────────────────────────────────────────
// Status Screens
// ─────────────────────────────────────────────────────────────

export function buildRejectedScreen(): string {
  return '❌ <b>Отменено</b>\n\nОтправьте новое сообщение для записи.';
}

export function buildExpiredScreen(): string {
  return '⏰ <b>Черновик истёк</b>\n\nТранзакция не была подтверждена в течение 1 часа.\nОтправьте сообщение повторно.';
}

export function buildAlreadyProcessedScreen(existingStatus: string): string {
  return `ℹ️ <b>Уже обработано</b>\n\nТекущий статус: ${escapeHtml(existingStatus)}`;
}

export function buildNotFoundScreen(): string {
  return '⚠️ <b>Не найдено</b>\n\nЧерновик не найден. Возможно, он уже был удалён.';
}

export function buildIntentMissingScreen(): string {
  return '❓ <b>Тип не определён</b>\n\nНе удалось определить тип операции.\nОтправьте сообщение повторно с уточнением (расход/доход/долг).';
}

// ─────────────────────────────────────────────────────────────
// Clarification Screen
// ─────────────────────────────────────────────────────────────

export interface ClarificationScreenData {
  field: 'amount' | 'intent' | 'category';
  intent: string | null;
  amount: string | null;
  currency: string | null;
  categoryHint: string | null;
  askAmountWithCurrency?: boolean; // Phase 1.38: ask both in one step
}

export function buildClarificationScreen(data: ClarificationScreenData): string {
  const lines: string[] = ['🤔 <b>Уточнение</b>', ''];
  if (data.intent) lines.push(`${intentEmoji(data.intent)} ${intentLabel(data.intent)}`);
  if (data.amount) lines.push(`Сумма: <b>${escapeHtml(data.amount)} ${escapeHtml(data.currency ?? 'USDT')}</b>`);
  if (data.categoryHint) lines.push(`Категория: ${escapeHtml(data.categoryHint)}`);
  lines.push('');
  switch (data.field) {
    case 'amount':
      if (data.askAmountWithCurrency) {
        // Phase 1.38: combined prompt — no default currency set
        lines.push('Напиши сумму и валюту:');
        lines.push('<blockquote>1000 USD · 500 руб · 200 USDT · 50 евро</blockquote>');
        lines.push('');
        lines.push('<blockquote>💡 Чтобы не указывать каждый раз — установи её в ⚙️ Настройках</blockquote>');
      } else {
        lines.push('Сколько потратил? Отправь сумму:');
      }
      break;
    case 'intent': lines.push('Что произошло? Выбери тип:'); break;
    case 'category': lines.push('Выбери категорию:'); break;
  }
  return lines.join('\n');
}

export function buildNonsenseScreen(): string {
  return [
    '🤔 <b>Не понял</b>',
    '',
    'Укажи сумму и валюту:',
    'кофе 150 UAH · займ 2000 USDT · зарплата 800 USD',
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
    const amountLine = `<b>${escapeHtml(formatAmount(data.parsedAmount))} ${escapeHtml(data.parsedCurrency ?? 'USDT')}</b>`;
    const blockContent = data.itemName
      ? `${amountLine}\n${escapeHtml(data.itemName)}`
      : amountLine;
    lines.push(`<blockquote>${blockContent}</blockquote>`);
  } else if (data.itemName) {
    lines.push(`<blockquote>${escapeHtml(data.itemName)}</blockquote>`);
  }

  if (data.parsedCategoryHint) {
    lines.push(`\n📁 ${escapeHtml(data.parsedCategoryHint)}`);
  }

  return lines.join('\n');
}

/**
 * Gate card — shown when user tries to write a new transaction
 * while a pending draft exists.
 */
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

/**
 * Gate card — edit-in-place version.
 * Replaces the existing preview card text with an alert banner + draft summary.
 * The confirm/edit/cancel keyboard is re-attached by the caller.
 */
export function buildGatePausedPreview(data: GateDraftData): string {
  const summary = buildDraftSummaryBlock(data);
  return [
    '⚠️ <b>Новая запись отклонена.</b>',
    'Завершите эту транзакцию, чтобы продолжить.',
    '',
    summary,
  ].join('\n');
}

/**
 * Reminder card — sent 10 minutes before draft expires.
 */
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

/**
 * Expired draft card — replaces both preview and reminder after TTL expiry.
 * Shows transaction data so user knows what expired.
 */
export function buildExpiredDraftScreen(data: GateDraftData): string {
  const emoji = intentEmoji(data.parsedIntent);
  const label = intentLabel(data.parsedIntent);

  const amountPart = data.parsedAmount
    ? ` · ${escapeHtml(formatAmount(data.parsedAmount))} ${escapeHtml(data.parsedCurrency ?? 'USDT')}`
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
// Keyboards
// ─────────────────────────────────────────────────────────────

type InlineButton = { text: string; callback_data: string };
type InlineKeyboard = { inline_keyboard: InlineButton[][] };

export function buildPostConfirmKeyboard(transactionId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        // Phase 1.36-UX: [Баланс][Отчёт] nav removed — handled by persistent Reply Keyboard.
        // Only contextual action: edit the specific transaction that was just recorded.
        { text: '✏️ Изменить запись', callback_data: `ed:v:${transactionId}` },
      ],
    ],
  };
}

/**
 * Phase 1.36-UX: Reply Keyboard to re-activate the persistent bottom navigation.
 * Used in the sendMessage path (reject/expire) where editMessageText cannot carry
 * a ReplyKeyboardMarkup. Labels MUST match NAV_BTN_* constants in webhook.route.ts.
 */
export function buildMainMenuReplyKeyboard(): object {
  return {
    keyboard: [['📊 Баланс', '📋 Отчёт', '⚙️ Настройки']],
    is_persistent: false,  // Phase 1.38: native ⏄ collapse icon — user controls visibility
    resize_keyboard: true,
  };
}

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

// ── Phase 1.38: Currency clarification screen ────────────────

/**
 * Professional currency clarification prompt.
 * No inline buttons — user replies with a text message.
 * Explains why the prompt appears and how to stop it (Settings).
 * SEC-12: No user data in output.
 */
export function buildCurrencyClarScreen(): string {
  return (
    '💱 <b>В какой валюте записать?</b>' +
    '\n\n<blockquote>руб · USD · USDT · EUR · $ · BTC · доллар · евро</blockquote>' +
    '\n\n<blockquote>💡 Чтобы не спрашивало каждый раз — установи валюту по умолчанию:\n' +
    '⚙️ Настройки → Базовая валюта</blockquote>'
  );
}
