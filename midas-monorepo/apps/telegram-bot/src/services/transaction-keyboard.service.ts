/**
 * Transaction Keyboard Service — Phase 2.0
 *
 * Builds all InlineKeyboardMarkup objects for the Transaction Hub.
 * Includes:
 *   - Transaction list with intent filters and pagination
 *   - Search menu and search results
 *   - Header formatting with mini stats
 *   - Callback parser (tx: namespace)
 *
 * Callback_data format (namespace: "tx"):
 *   tx:l:<page>:<filter>         → filtered list (a/e/i/d)              [≤9 bytes]
 *   tx:v:<txId>                  → view transaction card                [31 bytes]
 *   tx:s                         → search menu                         [4 bytes]
 *   tx:s:n                       → search by name                      [6 bytes]
 *   tx:s:amt                     → search by amount                    [8 bytes]
 *   tx:s:c                       → search by category                  [6 bytes]
 *   tx:s:cv:<catId>              → search category result              [33 bytes]
 *   tx:f:amt:<txId>              → edit amount                         [35 bytes]
 *   tx:f:cat:<txId>:<page>       → category picker                     [38 bytes]
 *   tx:f:acc:<txId>              → account picker                      [35 bytes]
 *   tx:f:int:<txId>              → intent picker                       [35 bytes]
 *   tx:c:cat:<txId>:<catId>      → confirm category                    [54 bytes max]
 *   tx:c:acc:<txId>:<accId>      → confirm account                     [54 bytes max]
 *   tx:c:int:<txId>:<intent>     → confirm intent                      [≤50 bytes]
 *   tx:d:ask:<txId>              → delete warning                      [36 bytes]
 *   tx:d:yes:<txId>              → confirm delete                      [36 bytes]
 *   tx:x                         → cancel / close                      [4 bytes]
 *
 * All callback_data values ≤ 64 bytes (Telegram limit). ✅
 *
 * ISSUE-2: tx:f:* mirrors ed:f:*, enabling clean ed: → tx: remap via slice(3).
 * ISSUE-6: search by amount uses tx:s:amt (not tx:s:a to avoid filter confusion).
 */

import type { InlineKeyboardButton, InlineKeyboardMarkup } from './telegram-api.js';
import { escapeHtml } from '../utils/html-escape.js';
import type { TxListItem, MonthMiniStats, IntentFilter } from './transaction-hub.service.js';
import { EDITABLE_INTENTS } from './edit.service.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** ULID validation: 26 chars, base32 alphabet */
const ULID_RE = /^[0-9A-Z]{26}$/;

/**
 * Format a DB NUMERIC string to 2 decimal places for display.
 * SEC-02: avoids parseFloat / Number() on financial values.
 */
function formatAmountStr(numStr: string): string {
  const dotIdx = numStr.indexOf('.');
  if (dotIdx === -1) return `${numStr}.00`;
  const integer = numStr.slice(0, dotIdx);
  const frac = numStr.slice(dotIdx + 1).padEnd(2, '0').slice(0, 2);
  return `${integer}.${frac}`;
}

/** Intent → emoji mapping */
function intentEmoji(intent: string): string {
  switch (intent) {
    case 'income':        return '💰';
    case 'expense':       return '💸';
    case 'debt_given':    return '🔴';
    case 'debt_received': return '🟢';
    default:              return '🔄';
  }
}

/** Format date from ISO to dd.mm */
function shortDate(isoDate: string): string {
  const d = new Date(isoDate);
  const day   = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
}

// ─────────────────────────────────────────────────────────────
// Filter labels
// ─────────────────────────────────────────────────────────────

const FILTER_LABELS: Record<IntentFilter, { text: string; active: string }> = {
  e: { text: '💸 Расходы',  active: '💸 Расходы ✓' },
  i: { text: '💰 Доходы',   active: '💰 Доходы ✓' },
  a: { text: '📋 Все',       active: '📋 Все ✓' },
  d: { text: '🤝 Долги',    active: '🤝 Долги ✓' },
};

// ─────────────────────────────────────────────────────────────
// Keyboards
// ─────────────────────────────────────────────────────────────

/**
 * Build the Transaction Hub list keyboard.
 *
 * Layout:
 *   Row 0: [💸 Расходы] [💰 Доходы] [📋 Все]   ← filter row
 *   Row 1: [🔍 Поиск]                            ← search
 *   Row 2..N: [emoji category — amount CUR  date] ← tx buttons (8 max)
 *   Row N+1: [◀️] [1/7] [▶️]                     ← pagination
 */
export function buildTxListKeyboard(
  items: TxListItem[],
  page: number,
  totalPages: number,
  activeFilter: IntentFilter,
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];

  // Filter row
  const filterRow: InlineKeyboardButton[] = (
    ['e', 'i', 'a'] as IntentFilter[]
  ).map((f) => ({
    text: f === activeFilter ? FILTER_LABELS[f].active : FILTER_LABELS[f].text,
    callback_data: `tx:l:0:${f}`,
  }));
  rows.push(filterRow);

  // Search button
  rows.push([{ text: '🔍 Поиск', callback_data: 'tx:s' }]);

  // Transaction rows
  for (const tx of items) {
    const emoji = intentEmoji(tx.transaction_intent);
    const cat   = escapeHtml(tx.category_name);
    const amt   = formatAmountStr(tx.base_amount);
    const cur   = escapeHtml(tx.base_currency);
    const date  = shortDate(tx.transaction_time);
    rows.push([{
      text: `${emoji} ${cat} — ${amt} ${cur}  ${date}`,
      callback_data: `tx:v:${tx.id}`,
    }]);
  }

  // Pagination row
  if (totalPages > 1) {
    const navRow: InlineKeyboardButton[] = [];
    if (page > 0) {
      navRow.push({ text: '◀️', callback_data: `tx:l:${String(page - 1)}:${activeFilter}` });
    }
    navRow.push({ text: `${String(page + 1)}/${String(totalPages)}`, callback_data: 'tx:x' });
    if (page < totalPages - 1) {
      navRow.push({ text: '▶️', callback_data: `tx:l:${String(page + 1)}:${activeFilter}` });
    }
    rows.push(navRow);
  }

  return { inline_keyboard: rows };
}

/**
 * Build search type selection keyboard.
 * Shown when user taps 🔍 Поиск.
 */
export function buildSearchMenuKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '📝 По названию', callback_data: 'tx:s:n' }],
      [{ text: '💲 По сумме',    callback_data: 'tx:s:amt' }],
      [{ text: '📁 По категории', callback_data: 'tx:s:c' }],
      [{ text: '◀️ Назад',       callback_data: 'tx:l:0:a' }],
    ],
  };
}

/**
 * Build search results keyboard.
 * Lists found transactions with back-to-search button.
 */
export function buildSearchResultsKeyboard(
  items: TxListItem[],
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = items.map((tx) => {
    const emoji = intentEmoji(tx.transaction_intent);
    const cat   = escapeHtml(tx.category_name);
    const amt   = formatAmountStr(tx.base_amount);
    const cur   = escapeHtml(tx.base_currency);
    return [{
      text: `${emoji} ${cat} — ${amt} ${cur}`,
      callback_data: `tx:v:${tx.id}`,
    }];
  });

  rows.push([{ text: '🔍 Новый поиск',   callback_data: 'tx:s' }]);
  rows.push([{ text: '◀️ К транзакциям', callback_data: 'tx:l:0:a' }]);

  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────

/**
 * Russian month names (nominative case) for header display.
 */
const MONTH_NAMES_RU = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/**
 * Format the transaction list header with mini stats.
 * HTML-safe output.
 *
 * Phase 2.0 — filter-specific headers:
 *   'a': "📋 Транзакции\n\nЗа май: 62 расхода · 18 доходов · 7 долгов"
 *   'e': "📋 Расходы за май (62 шт. · 32,150.00 USDT)"
 *   'i': "📋 Доходы за май (18 шт. · 45,200.00 USDT)"
 *   'd': "📋 Долги за май (7 шт.)"
 */
export function formatTxListHeader(
  stats: MonthMiniStats,
  filter: IntentFilter,
): string {
  const monthName = MONTH_NAMES_RU[new Date().getMonth()] ?? '';
  const cur = escapeHtml(stats.currency);

  if (filter === 'a') {
    // All transactions — summary line
    const parts: string[] = [];
    if (stats.expense_count > 0) parts.push(`${String(stats.expense_count)} расход${pluralRu(stats.expense_count)}`);
    if (stats.income_count > 0)  parts.push(`${String(stats.income_count)} доход${pluralRu(stats.income_count)}`);
    if (stats.debt_count > 0)    parts.push(`${String(stats.debt_count)} долг${pluralRu(stats.debt_count)}`);
    const summary = parts.length > 0 ? parts.join(' · ') : 'нет транзакций';
    return `<b>📋 Транзакции</b>\n\nЗа ${monthName}: ${summary}`;
  }

  if (filter === 'e') {
    const amt = formatAmountStr(stats.expense_total);
    return `<b>💸 Расходы за ${monthName}</b> (${String(stats.expense_count)} шт. · ${amt} ${cur})`;
  }

  if (filter === 'i') {
    const amt = formatAmountStr(stats.income_total);
    return `<b>💰 Доходы за ${monthName}</b> (${String(stats.income_count)} шт. · ${amt} ${cur})`;
  }

  // filter === 'd'
  return `<b>🤝 Долги за ${monthName}</b> (${String(stats.debt_count)} шт.)`;
}

/**
 * Russian plural suffix helper for count words.
 * 1 расход, 2 расхода, 5 расходов → returns "", "а", "ов"
 */
function pluralRu(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 19) return 'ов';
  if (last === 1) return '';
  if (last >= 2 && last <= 4) return 'а';
  return 'ов';
}

// ─────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────

/**
 * Parsed transaction callback command.
 * Union type covers all tx: callback_data patterns.
 */
export type TxCallbackCmd =
  | { cmd: 'list'; page: number; filter: IntentFilter }
  | { cmd: 'view'; txId: string }
  | { cmd: 'search_menu' }
  | { cmd: 'search_name' }
  | { cmd: 'search_amount' }
  | { cmd: 'search_category' }
  | { cmd: 'search_cat_result'; catId: string }
  | { cmd: 'field_amount'; txId: string }
  | { cmd: 'field_cat'; txId: string; page: number }
  | { cmd: 'field_acc'; txId: string }
  | { cmd: 'field_int'; txId: string }
  | { cmd: 'delete_ask'; txId: string }
  | { cmd: 'delete_confirm'; txId: string }
  | { cmd: 'confirm_cat'; txId: string; catId: string }
  | { cmd: 'confirm_acc'; txId: string; accId: string }
  | { cmd: 'confirm_int'; txId: string; intent: string }
  | { cmd: 'cancel' };

const VALID_FILTERS: readonly string[] = ['a', 'e', 'i', 'd'];

/**
 * Parse a tx: callback_data string into a typed command.
 * Returns null for invalid/unrecognized data (silently rejected).
 *
 * Supports tx:l:{page} without filter (default 'a') for ed: → tx: remap compatibility.
 */
export function parseTxCallback(data: string): TxCallbackCmd | null {
  if (!data.startsWith('tx:')) return null;

  const parts = data.split(':');
  const sub = parts[1] ?? '';

  // tx:x → cancel
  if (sub === 'x') return { cmd: 'cancel' };

  // tx:l:<page>:<filter?> → list (filter defaults to 'a' for ed: compat)
  if (sub === 'l') {
    const page = parseInt(parts[2] ?? '0', 10);
    if (isNaN(page) || page < 0) return null;
    const filter = (parts[3] ?? 'a') as IntentFilter;
    if (!VALID_FILTERS.includes(filter)) return null;
    return { cmd: 'list', page, filter };
  }

  // tx:v:<txId> → view
  if (sub === 'v') {
    const txId = parts[2] ?? '';
    if (!ULID_RE.test(txId)) return null;
    return { cmd: 'view', txId };
  }

  // tx:s → search namespace
  if (sub === 's') {
    if (parts.length === 2) return { cmd: 'search_menu' };
    const searchSub = parts[2] ?? '';
    if (searchSub === 'n')   return { cmd: 'search_name' };
    if (searchSub === 'amt') return { cmd: 'search_amount' };
    if (searchSub === 'c')   return { cmd: 'search_category' };
    if (searchSub === 'cv') {
      const catId = parts[3] ?? '';
      if (!ULID_RE.test(catId)) return null;
      return { cmd: 'search_cat_result', catId };
    }
    return null;
  }

  // tx:f:<field>:<txId>[:<page>] → edit fields (mirrors ed:f:*)
  if (sub === 'f') {
    const field = parts[2] ?? '';
    const txId  = parts[3] ?? '';
    if (!ULID_RE.test(txId)) return null;

    if (field === 'amt') return { cmd: 'field_amount', txId };
    if (field === 'acc') return { cmd: 'field_acc', txId };
    if (field === 'int') return { cmd: 'field_int', txId };
    if (field === 'cat') {
      const page = parseInt(parts[4] ?? '0', 10);
      if (isNaN(page) || page < 0) return null;
      return { cmd: 'field_cat', txId, page };
    }
    return null;
  }

  // tx:c:<type>:<txId>:<value> → confirm changes
  if (sub === 'c') {
    const type  = parts[2] ?? '';
    const txId  = parts[3] ?? '';
    const value = parts[4] ?? '';
    if (!ULID_RE.test(txId)) return null;

    if (type === 'cat') {
      if (!ULID_RE.test(value)) return null;
      return { cmd: 'confirm_cat', txId, catId: value };
    }
    if (type === 'acc') {
      if (!ULID_RE.test(value)) return null;
      return { cmd: 'confirm_acc', txId, accId: value };
    }
    if (type === 'int') {
      if (!(EDITABLE_INTENTS as readonly string[]).includes(value)) return null;
      return { cmd: 'confirm_int', txId, intent: value };
    }
    return null;
  }

  // tx:d:<action>:<txId> → delete flow
  if (sub === 'd') {
    const action = parts[2] ?? '';
    const txId   = parts[3] ?? '';
    if (!ULID_RE.test(txId)) return null;
    if (action === 'ask') return { cmd: 'delete_ask', txId };
    if (action === 'yes') return { cmd: 'delete_confirm', txId };
    return null;
  }

  return null;
}
