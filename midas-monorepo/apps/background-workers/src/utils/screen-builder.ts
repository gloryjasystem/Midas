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

  // ── Details: category · account (middle dot — U+00B7) ────────
  const details: string[] = [];
  if (data.categoryHint) details.push(`📁 ${escapeHtml(data.categoryHint)}`);
  if (data.accountHint)  details.push(`🏦 ${escapeHtml(data.accountHint)}`);
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
  amount: string;
  currency: string;
  categoryName: string | null;
  accountName: string | null;
  itemName: string | null;  // Phase 1.35
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

export function buildConfirmedScreen(data: ConfirmedScreenData): string {
  const emoji = intentEmoji(data.intent);
  const lines: string[] = ['✅ <b>Записано</b>', ''];

  // ── Blockquote: amount + item name ───────────────────────────
  const amountLine = `${emoji} <b>${escapeHtml(data.amount)} ${escapeHtml(data.currency)}</b>`;
  const blockContent = data.itemName
    ? `${amountLine}\n${escapeHtml(data.itemName)}`
    : amountLine;
  lines.push(`<blockquote>${blockContent}</blockquote>`);
  lines.push('');

  // ── Details: category · account ──────────────────────────────
  const details: string[] = [];
  if (data.categoryName) details.push(`📁 ${escapeHtml(data.categoryName)}`);
  if (data.accountName)  details.push(`🏦 ${escapeHtml(data.accountName)}`);
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
 * Paused preview — replaces the original preview when gate is triggered.
 * Buttons removed, shows "waiting" indicator.
 */
export function buildGatePausedPreview(_data: GateDraftData): string {
  return [
    '❌ <b>Новая транзакция отменена</b>',
    '',
    'Нельзя записать новую транзакцию,',
    'пока не завершена предыдущая.',
    '',
    'Подтвердите или отмените транзакцию ниже ↓',
    '',
    '🕐 <i>Ожидает вашего ответа</i>',
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
