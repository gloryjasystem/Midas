/**
 * Settings Keyboard Service — Phase 1.26 / Phase 1.35
 *
 * Builds Telegram InlineKeyboardMarkup objects for the /settings UI flow.
 *
 * Callback_data format (namespace: "st"):
 *   st:m          → main settings menu
 *   st:g:s        → stablecoins group (no pagination, all fit in one page)
 *   st:g:c:<page> → crypto group, page N (0-indexed)
 *   st:g:f:<page> → fiat group, page N (0-indexed)
 *   st:n:c:<page> → crypto next page
 *   st:v:c:<page> → crypto prev page
 *   st:n:f:<page> → fiat next page
 *   st:v:f:<page> → fiat prev page
 *   st:p:<CODE>   → pick (select) a currency
 *   st:srch       → enter search mode
 *   st:x          → cancel / close menu
 *
 * All callback_data values are strictly ≤ 64 bytes (Telegram limit).
 * Longest: "st:g:c:99" = 9 bytes — well within limit.
 * Longest pick: "st:p:ABCDE" = 10 bytes — well within limit.
 *
 * Security:
 *   - callback_data values are validated allowlist-style in webhook handler.
 *   - No user-provided data enters callback_data.
 *   - Currency codes come only from the static CURRENCY_GROUPS arrays.
 *
 * Phase 1.27 note:
 *   Timezone UI buttons are explicitly excluded from this phase.
 */

import type { InlineKeyboardButton, InlineKeyboardMarkup } from '../services/telegram-api.js';
import {
  CURRENCY_GROUPS,
  GROUP_LABELS,
  PAGE_SIZE,
  type CurrencyGroup,
} from '../services/currencies.js';
import { escapeHtml } from '../utils/html-escape.js';

// ─────────────────────────────────────────────────────────────
// Main settings menu
// ─────────────────────────────────────────────────────────────

/**
 * Build the main /settings menu keyboard.
 *
 * Shows current default_currency and a single "Change currency" button.
 * Text output is handled by formatSettingsMenuText() below.
 */
export function buildSettingsMainKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '✏️ Изменить валюту', callback_data: 'st:g:pick' }],
      [
        { text: '🏦 Счёт расходов', callback_data: 'st:da:e' },
        { text: '🏦 Счёт доходов', callback_data: 'st:da:i' },
      ],
    ],
  };
}

/**
 * Format the main settings menu message text.
 *
 * escapeHtml applied to all DB-sourced values.
 */
export function formatSettingsMenuText(
  currency: string,
  timezone: string,
  expenseAccountName?: string | null,
  incomeAccountName?: string | null,
): string {
  const expAcct = expenseAccountName
    ? escapeHtml(expenseAccountName)
    : '<i>не задан</i>';
  const incAcct = incomeAccountName
    ? escapeHtml(incomeAccountName)
    : '<i>не задан</i>';

  return (
    '⚙️ <b>Настройки Midas</b>\n\n' +
    `💵 Базовая валюта: <b>${escapeHtml(currency)}</b>\n` +
    `🕐 Часовой пояс: <b>${escapeHtml(timezone)}</b>\n` +
    `🏦 Счёт расходов: ${expAcct}\n` +
    `🏦 Счёт доходов: ${incAcct}`
  );
}

// ─────────────────────────────────────────────────────────────
// Currency type picker
// ─────────────────────────────────────────────────────────────

/**
 * Build the currency group selection keyboard.
 *
 * Shown after user taps "Change currency":
 *   [💵 Стейблкоины]
 *   [₿ Криптовалюты]
 *   [🏦 Фиат]
 *   [🔍 Найти по символу]
 *   [❌ Отмена]
 */
export function buildGroupPickerKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: GROUP_LABELS.stable, callback_data: 'st:g:s' }],
      [{ text: GROUP_LABELS.crypto, callback_data: 'st:g:c:0' }],
      [{ text: GROUP_LABELS.fiat,   callback_data: 'st:g:f:0' }],
      [{ text: '🔍 Найти по символу', callback_data: 'st:srch' }],
      [{ text: '❌ Отмена', callback_data: 'st:x' }],
    ],
  };
}

export const GROUP_PICKER_TEXT = 'Выберите группу валют:';

// ─────────────────────────────────────────────────────────────
// Currency page builder
// ─────────────────────────────────────────────────────────────

/** Compact group key for callback_data ('s' | 'c' | 'f'). */
const GROUP_KEY: Record<CurrencyGroup, string> = {
  stable: 's',
  crypto: 'c',
  fiat:   'f',
};

/**
 * Build a paginated currency page keyboard.
 *
 * For stablecoins: all on one page (no pagination arrows).
 * For crypto/fiat: 12 per page + prev/next arrows + search + back.
 *
 * Button layout: 4 per row (3 rows = 12 codes).
 *
 * @param group - 'stable' | 'crypto' | 'fiat'
 * @param page  - 0-indexed page number
 */
export function buildCurrencyPageKeyboard(group: CurrencyGroup, page: number): InlineKeyboardMarkup {
  const codes = CURRENCY_GROUPS[group];
  const gk = GROUP_KEY[group];

  // For stablecoins: no pagination, show all
  const isStable = group === 'stable';
  const items = isStable
    ? [...codes]
    : codes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Build 4-per-row currency button rows
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < items.length; i += 4) {
    const row: InlineKeyboardButton[] = items.slice(i, i + 4).map((code) => ({
      text: code,
      callback_data: `st:p:${code}`,
    }));
    rows.push(row);
  }

  if (!isStable) {
    const totalPages = Math.ceil(codes.length / PAGE_SIZE);
    // Navigation row
    const navRow: InlineKeyboardButton[] = [];
    if (page > 0) {
      navRow.push({ text: '◀️', callback_data: `st:v:${gk}:${String(page - 1)}` });
    } else {
      navRow.push({ text: '·', callback_data: 'st:x' }); // placeholder to keep layout
    }
    navRow.push({ text: `${String(page + 1)}/${String(totalPages)}`, callback_data: 'st:x' }); // non-interactive label
    if (page < totalPages - 1) {
      navRow.push({ text: '▶️', callback_data: `st:n:${gk}:${String(page + 1)}` });
    } else {
      navRow.push({ text: '·', callback_data: 'st:x' });
    }
    rows.push(navRow);

    // Search + back row
    rows.push([
      { text: '🔍 Поиск', callback_data: 'st:srch' },
      { text: '◀️ Назад', callback_data: 'st:g:pick' },
    ]);
  } else {
    // Stablecoins: just a back button
    rows.push([{ text: '◀️ Назад', callback_data: 'st:g:pick' }]);
  }

  return { inline_keyboard: rows };
}

/**
 * Format the currency page header text.
 */
export function formatCurrencyPageText(group: CurrencyGroup, page: number): string {
  if (group === 'stable') return GROUP_LABELS.stable;
  const total = Math.ceil(CURRENCY_GROUPS[group].length / PAGE_SIZE);
  return `${GROUP_LABELS[group]} — стр. ${String(page + 1)}/${String(total)}`;
}

// ─────────────────────────────────────────────────────────────
// Search results
// ─────────────────────────────────────────────────────────────

/**
 * Build search results keyboard.
 *
 * Each result is a button: [BTC] [ETH] ...
 * Up to 8 results, 4 per row + back button.
 */
export function buildSearchResultsKeyboard(codes: string[]): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < codes.length; i += 4) {
    rows.push(
      codes.slice(i, i + 4).map((code) => ({
        text: code,
        callback_data: `st:p:${code}`,
      })),
    );
  }
  rows.push([{ text: '◀️ Назад', callback_data: 'st:g:pick' }]);
  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────────────────────
// Confirmation / post-selection
// ─────────────────────────────────────────────────────────────

/**
 * Format the confirmation message after currency is selected via keyboard.
 * escapeHtml applied to all user-facing values.
 */
export function formatPickConfirmText(newCode: string, oldCode: string): string {
  return (
    `✅ Базовая валюта: <b>${escapeHtml(newCode)}</b>\n` +
    `   (было: ${escapeHtml(oldCode)})\n\n` +
    `Новые транзакции без явной валюты → <b>${escapeHtml(newCode)}</b>\n` +
    'Прошлые записи не изменены.'
  );
}

/** Empty keyboard — used to remove buttons from a message. */
export const EMPTY_KEYBOARD: InlineKeyboardMarkup = { inline_keyboard: [] };

// ─────────────────────────────────────────────────────────────
// Callback_data parsing helpers
// ─────────────────────────────────────────────────────────────

/**
 * Decode a settings callback_data string into a typed command.
 *
 * Returns null for any unrecognised or malformed input.
 *
 * Validated action codes (allowlist):
 *   st:m            → main menu
 *   st:g:pick       → group picker
 *   st:g:s          → stablecoins page
 *   st:g:c:<N>      → crypto page N
 *   st:g:f:<N>      → fiat page N
 *   st:n:c:<N>      → crypto next (page N)
 *   st:v:c:<N>      → crypto prev (page N)
 *   st:n:f:<N>      → fiat next (page N)
 *   st:v:f:<N>      → fiat prev (page N)
 *   st:p:<CODE>     → pick currency (CODE = 3–5 uppercase letters)
 *   st:srch         → enter search mode
 *   st:x            → cancel / no-op
 */
export type SettingsCallbackCmd =
  | { cmd: 'menu' }
  | { cmd: 'grouppicker' }
  | { cmd: 'group'; group: CurrencyGroup; page: number }
  | { cmd: 'page'; group: CurrencyGroup; page: number }
  | { cmd: 'pick'; code: string }
  | { cmd: 'search' }
  | { cmd: 'cancel' }
  // Phase 1.35: default account management
  | { cmd: 'default_account_picker'; kind: 'expense' | 'income' }
  | { cmd: 'default_account_set'; kind: 'expense' | 'income'; accountId: string }
  | { cmd: 'default_account_clear'; kind: 'expense' | 'income' }
  | { cmd: 'default_account_new'; kind: 'expense' | 'income' }
  | { cmd: 'back' };

const CURRENCY_CODE_RE = /^[A-Z]{3,5}$/;
const GROUP_MAP: Record<string, CurrencyGroup> = { s: 'stable', c: 'crypto', f: 'fiat' };

export function parseSettingsCallback(data: string): SettingsCallbackCmd | null {
  if (!data.startsWith('st:')) return null;
  const parts = data.split(':');

  const sub = parts[1] ?? '';

  if (sub === 'm') return { cmd: 'menu' };
  if (sub === 'x') return { cmd: 'cancel' };
  if (sub === 'srch') return { cmd: 'search' };
  if (sub === 'back') return { cmd: 'back' };

  if (sub === 'p') {
    const code = parts[2] ?? '';
    if (!CURRENCY_CODE_RE.test(code)) return null;
    return { cmd: 'pick', code };
  }

  // Phase 1.35: default account callbacks
  if (sub === 'da') {
    const action = parts[2] ?? '';
    if (action === 'e') return { cmd: 'default_account_picker', kind: 'expense' };
    if (action === 'i') return { cmd: 'default_account_picker', kind: 'income' };
    if (action === 'ce') return { cmd: 'default_account_clear', kind: 'expense' };
    if (action === 'ci') return { cmd: 'default_account_clear', kind: 'income' };
    if (action === 'se') {
      const accountId = parts[3] ?? '';
      if (!accountId) return null;
      return { cmd: 'default_account_set', kind: 'expense', accountId };
    }
    if (action === 'si') {
      const accountId = parts[3] ?? '';
      if (!accountId) return null;
      return { cmd: 'default_account_set', kind: 'income', accountId };
    }
    if (action === 'new') {
      const kindKey = parts[3] ?? '';
      if (kindKey === 'e') return { cmd: 'default_account_new', kind: 'expense' };
      if (kindKey === 'i') return { cmd: 'default_account_new', kind: 'income' };
      return null;
    }
    return null;
  }

  if (sub === 'g') {
    const gk = parts[2] ?? '';
    if (gk === 'pick') return { cmd: 'grouppicker' };
    const group = GROUP_MAP[gk];
    if (!group) return null;
    if (group === 'stable') return { cmd: 'group', group, page: 0 };
    const page = parseInt(parts[3] ?? '0', 10);
    if (isNaN(page) || page < 0) return null;
    return { cmd: 'group', group, page };
  }

  // st:n:<gk>:<page> or st:v:<gk>:<page>
  if (sub === 'n' || sub === 'v') {
    const gk = parts[2] ?? '';
    const group = GROUP_MAP[gk];
    if (!group || group === 'stable') return null;
    const page = parseInt(parts[3] ?? '0', 10);
    if (isNaN(page) || page < 0) return null;
    const codes = CURRENCY_GROUPS[group];
    const maxPage = Math.ceil(codes.length / PAGE_SIZE) - 1;
    if (page > maxPage) return null;
    return { cmd: 'page', group, page };
  }

  return null;
}
