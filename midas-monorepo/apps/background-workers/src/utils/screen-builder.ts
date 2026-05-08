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
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
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

  if (data.amount) {
    lines.push(`Сумма: <b>${escapeHtml(data.amount)} ${escapeHtml(data.currency ?? 'USDT')}</b>`);
  }
  if (data.itemName) {
    lines.push(`📝 ${escapeHtml(data.itemName)}`);
  }
  if (data.categoryHint) {
    lines.push(`📁 Категория: ${escapeHtml(data.categoryHint)}`);
  }
  if (data.accountHint) {
    lines.push(`🏦 Счёт: ${escapeHtml(data.accountHint)}`);
  }
  lines.push('');
  lines.push('Всё верно?');
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
}

export function buildConfirmedScreen(data: ConfirmedScreenData): string {
  const emoji = intentEmoji(data.intent);
  const lines: string[] = [
    '✅ <b>Записано</b>',
    '',
    `${emoji} <b>${escapeHtml(data.amount)} ${escapeHtml(data.currency)}</b>`,
  ];
  if (data.itemName) lines.push(`📝 ${escapeHtml(data.itemName)}`);
  if (data.categoryName) lines.push(`📁 ${escapeHtml(data.categoryName)}`);
  if (data.accountName) lines.push(`🏦 ${escapeHtml(data.accountName)}`);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Status Screens
// ─────────────────────────────────────────────────────────────

export function buildRejectedScreen(): string {
  return '❌ <b>Отменено</b>\n\nОтправьте новое сообщение для записи.';
}

export function buildExpiredScreen(): string {
  return '⏰ <b>Черновик истёк</b>\n\nПрошло более 24 часов. Отправьте сообщение повторно.';
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
}

export function buildClarificationScreen(data: ClarificationScreenData): string {
  const lines: string[] = ['🤔 <b>Уточнение</b>', ''];
  if (data.intent) lines.push(`${intentEmoji(data.intent)} ${intentLabel(data.intent)}`);
  if (data.amount) lines.push(`Сумма: <b>${escapeHtml(data.amount)} ${escapeHtml(data.currency ?? 'USDT')}</b>`);
  if (data.categoryHint) lines.push(`Категория: ${escapeHtml(data.categoryHint)}`);
  lines.push('');
  switch (data.field) {
    case 'amount': lines.push('Сколько потратил? Отправь сумму:'); break;
    case 'intent': lines.push('Что произошло? Выбери тип:'); break;
    case 'category': lines.push('Выбери категорию:'); break;
  }
  return lines.join('\n');
}

export function buildNonsenseScreen(): string {
  return '🤔 <b>Не понял</b>\n\nЧто хотел записать?';
}

// ─────────────────────────────────────────────────────────────
// Keyboards
// ─────────────────────────────────────────────────────────────

type InlineButton = { text: string; callback_data: string };
type InlineKeyboard = { inline_keyboard: InlineButton[][] };

export function buildPostConfirmKeyboard(transactionId: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: '✏️ Изменить', callback_data: `ed:v:${transactionId}` },
      { text: '📊 Баланс',   callback_data: 'nav:balance' },
      { text: '📋 Отчёт',    callback_data: 'nav:report' },
    ]],
  };
}

export function buildNavKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: '📊 Баланс', callback_data: 'nav:balance' },
      { text: '📋 Отчёт',  callback_data: 'nav:report' },
    ]],
  };
}

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
