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
import type { TransferPairRow } from './edit.service.js';

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
  // Add thousands separator for readability
  const intWithSep = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${intWithSep}.${frac}`;
}

// ── Currency symbol map (mirrors balance.service.ts — keep in sync) ──────────
// Fiat currencies get their unicode symbol; crypto stays as ISO code (no symbol).
const CCY_SYMBOL: Record<string, string> = {
  RUB: '₽', USD: '$',  EUR: '€', UAH: '₴', GBP: '£',
  KZT: '₸', BYN: 'Br', GEL: '₾', PLN: 'zł', TRY: '₺',
  CNY: '¥', JPY: '¥',  HKD: 'HK$', SGD: 'S$', AUD: 'A$',
  CAD: 'C$', CHF: 'Fr',
};

/** Symbol for fiat (₽ $ €), ISO code for crypto (USDT BTC ETH). */
function fmtCurrency(code: string): string {
  return CCY_SYMBOL[code] ?? code;
}

/** Intent → emoji mapping (matches filter button icons) */
function intentEmoji(intent: string): string {
  switch (intent) {
    case 'income':        return '💰';
    case 'expense':       return '💸';
    case 'debt_given':    return '🤝';
    case 'debt_received': return '🤲';
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
  e:  { text: '\uD83D\uDCB8',       active: '\uD83D\uDCB8 ✓'  },  // 💸  (расходы)
  i:  { text: '\uD83D\uDCB0',       active: '\uD83D\uDCB0 ✓'  },  // 💰  (доходы)
  d:  { text: '\uD83E\uDD1D',       active: '\uD83E\uDD1D ✓'  },  // 🤝  (долги)
  t:  { text: '\uD83D\uDD04',       active: '\uD83D\uDD04 ✓'  },  // 🔄  (переводы)
  a:  { text: '\uD83D\uDCCB Все',   active: '\uD83D\uDCCB Все ✓' },  // Все (активный по умолчанию)
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

  // ─── Filter row — Variant D: icon-only chips in 1 row ────────────────
  // Layout: [💸] [💰] [🤝] [🔄] [📋 Все]
  // Active filter: emoji + ' ✓'. Clicking active non-'a' filter → deactivates to 'a'.
  const FILTER_ROW: IntentFilter[] = ['e', 'i', 'd', 't', 'a'];
  rows.push(FILTER_ROW.map((f) => {
    const isActive = f === activeFilter;
    const label = isActive ? FILTER_LABELS[f].active : FILTER_LABELS[f].text;
    const cbFilter = (isActive && f !== 'a') ? 'a' : f;
    return { text: label, callback_data: `tx:l:0:${cbFilter}` };
  }));

  // Search button
  rows.push([{ text: '\uD83D\uDD0D Поиск', callback_data: 'tx:s' }]);

  // Transaction rows — max 6 per page
  for (const tx of items) {
    const emoji = intentEmoji(tx.transaction_intent);
    const amt   = formatAmountStr(tx.base_amount);
    const cur   = fmtCurrency(tx.base_currency);
    const date  = shortDate(tx.transaction_time);

    // Phase 3.1-UX: transfer-specific rich format
    if (tx.transaction_intent === 'transfer' && tx.from_account && tx.to_account && tx.to_amount && tx.to_currency) {
      const toAmt = formatAmountStr(tx.to_amount);
      const toCur = fmtCurrency(tx.to_currency);
      rows.push([{
        text: `\uD83D\uDD04 ${tx.from_account} \u2192 ${tx.to_account}  ${amt} ${cur} \u2192 ${toAmt} ${toCur}  ${date}`,
        callback_data: `tx:v:${tx.id}`,
      }]);
      continue;
    }

    // Show item_name if exists, else fall back to category
    const label = tx.item_name
      ? escapeHtml(tx.item_name)
      : escapeHtml(tx.category_name);

    // Format: emoji · name/category  amt CUR  dd.mm
    rows.push([{
      text: `${emoji} ${label}  ${amt} ${cur}  ${date}`,
      callback_data: `tx:v:${tx.id}`,
    }]);
  }

  // Pagination row (only when multiple pages)
  if (totalPages > 1) {
    const navRow: InlineKeyboardButton[] = [];
    if (page > 0) {
      navRow.push({ text: '⬅️ Позже', callback_data: `tx:l:${String(page - 1)}:${activeFilter}` });
    }
    navRow.push({ text: `📄 ${String(page + 1)} / ${String(totalPages)}`, callback_data: 'tx:x' });
    if (page < totalPages - 1) {
      navRow.push({ text: 'Раньше ➡️', callback_data: `tx:l:${String(page + 1)}:${activeFilter}` });
    }
    rows.push(navRow);
  }

  // Close button — always at the bottom
  rows.push([{ text: '\u2716\uFE0F Закрыть', callback_data: 'tx:close' }]);

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
      [{ text: '📅 По дате',     callback_data: 'tx:s:dt' }],
      [{ text: '◀️ Назад',       callback_data: 'tx:l:0:a' }],
    ],
  };
}

/**
 * Build the date period picker keyboard.
 * Shown when user taps 📅 По дате.
 *
 * Preset buttons cover 95% of use-cases; custom input is always available.
 */
export function buildDatePickerKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '📆 Сегодня',        callback_data: 'tx:s:dt:today' }],
      [{ text: '📅 Вчера',          callback_data: 'tx:s:dt:yday'  }],
      [{ text: '🗓 Эта неделя',     callback_data: 'tx:s:dt:week'  }],
      [{ text: '📊 Этот месяц',     callback_data: 'tx:s:dt:month' }],
      [{ text: '✏️ Ввести дату',    callback_data: 'tx:s:dt:custom'}],
      [{ text: '◀️ Назад',          callback_data: 'tx:s'          }],
    ],
  };
}

/**
 * Build search results keyboard.
 * Lists found transactions with back-to-search button.
 */
/**
 * Build paginated search results keyboard.
 *
 * Layout:
 *   Row 0..N: transaction buttons (max SEARCH_PAGE_SIZE)
 *   Row N+1:  [◀️] [page/total] [▶️]  — only if totalPages > 1
 *   Row N+2:  [🔍 Новый поиск]  [◀️ К транзакциям]
 */
export function buildSearchResultsKeyboard(
  items: TxListItem[],
  page: number,
  totalPages: number,
  _backCallback = 'tx:s',
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = items.map((tx) => {
    const emoji = intentEmoji(tx.transaction_intent);
    const label = tx.item_name ? escapeHtml(tx.item_name) : escapeHtml(tx.category_name);
    const amt   = formatAmountStr(tx.base_amount);
    const cur   = escapeHtml(tx.base_currency);
    const date  = shortDate(tx.transaction_time);
    return [{ text: `${emoji} ${label}  ${amt} ${cur}  ${date}`, callback_data: `tx:v:${tx.id}` }];
  });

  // Pagination row — only when multiple pages
  if (totalPages > 1) {
    const nav: InlineKeyboardButton[] = [];
    if (page > 0) nav.push({ text: '\u25C0\uFE0F', callback_data: `tx:sr:p:${String(page - 1)}` });
    nav.push({ text: `${String(page + 1)}/${String(totalPages)}`, callback_data: 'tx:x' });
    if (page < totalPages - 1) nav.push({ text: '\u25B6\uFE0F', callback_data: `tx:sr:p:${String(page + 1)}` });
    rows.push(nav);
  }

  // Footer navigation
  rows.push([
    { text: '\uD83D\uDD0D \u041D\u043E\u0432\u044B\u0439 \u043F\u043E\u0438\u0441\u043A', callback_data: 'tx:s' },
    { text: '\u25C0\uFE0F \u041A \u0441\u043F\u0438\u0441\u043A\u0443', callback_data: 'tx:l:0:a' },
  ]);

  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────────────────────
// Phase 3.1-UX: Transfer Rich Card
// ─────────────────────────────────────────────────────────────

/**
 * Build the HTML text for a Transfer Rich Card (detail view).
 *
 * Design spec (Phase 3.1-UX):
 *   💱 Перевод
 *
 *   🏦 Из:  Сбербанк  ·  −1 000.00 $
 *   🏦 В:   Монобанк  ·  +43 000.00 ₴
 *
 *   📈 Курс: 1 $ = 43 ₴        ← cross-currency only
 *   📅 21 мая 2026, 06:36
 *
 * SEC-02: all amounts are pre-formatted NUMERIC strings — no parseFloat.
 */
export function buildTransferDetailCard(pair: TransferPairRow): string {
  const fromAmt = formatAmountStr(pair.from_amount);
  const toAmt   = formatAmountStr(pair.to_amount);
  // Use currency symbol for fiat, ISO code for crypto (e.g. USDT, BTC)
  const fromCur = fmtCurrency(pair.from_currency);
  const toCur   = fmtCurrency(pair.to_currency);

  // Date: "21 мая 2026, 06:36" (full month genitive, no abbrev)
  const MONTHS_RU = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  const d   = new Date(pair.transaction_time);
  const day = d.getDate();
  const mon = MONTHS_RU[d.getMonth()] ?? '';
  const yr  = d.getFullYear();
  const hh  = String(d.getHours()).padStart(2, '0');
  const mm  = String(d.getMinutes()).padStart(2, '0');
  // Show year only if not current year
  const currentYear = new Date().getFullYear();
  const dateStr = yr !== currentYear
    ? `${String(day)} ${mon} ${String(yr)}, ${hh}:${mm}`
    : `${String(day)} ${mon}, ${hh}:${mm}`;

  const lines: string[] = [
    '💱 <b>Перевод</b>',
    '',
    `🏦 Из:  <b>${escapeHtml(pair.from_account)}</b>  ·  −<code>${fromAmt} ${fromCur}</code>`,
    `🏦 В:   <b>${escapeHtml(pair.to_account)}</b>  ·  +<code>${toAmt} ${toCur}</code>`,
    '',
  ];

  // Exchange rate — only for cross-currency
  if (pair.is_cross_currency) {
    // Strip trailing zeros: "0.999000000000" → "0.999", "43.000000000000" → "43"
    const rateClean = pair.exchange_rate
      .replace(/(\.\d*?)0+$/, '$1')
      .replace(/\.$/, '');
    lines.push(`📈 Курс: <code>1 ${fromCur} = ${rateClean} ${toCur}</code>`);
  }

  lines.push(`📅 <i>${dateStr}</i>`);
  return lines.join('\n');
}

/**
 * Build the inline keyboard for a Transfer Rich Card.
 *
 * Layout:
 *   [📈 Изменить курс конвертации]
 *   [🗑 Удалить перевод]
 *   [✖️ Отмена]
 *
 * Cancel behavior by context:
 *   from === 's'  → tx:done:{txId}   (restore floating success card)
 *   from === 'pt' → tx:v:{txId}:pt   (re-render this same rich card; prevents message deletion)
 *   undefined     → tx:close          (delete the message — used from tx list)
 */
export function buildTransferViewKeyboard(
  outboundTxId: string,
  from?: string,
): InlineKeyboardMarkup {
  const sf = from ? `:${from}` : '';
  let cancelCallback: string;
  if (from === 's')   cancelCallback = `tx:done:${outboundTxId}`;
  else if (from === 'pt') cancelCallback = `pt:back:${outboundTxId}`;  // → restores Screenshot 1 (success card)
  else                cancelCallback = 'tx:close';

  return {
    inline_keyboard: [
      [{ text: '📈 Изменить курс конвертации', callback_data: `tx:tf:rate:${outboundTxId}${sf}` }],
      [{ text: '🗑 Удалить перевод',           callback_data: `tx:tf:del:${outboundTxId}${sf}` }],
      [{ text: '✖️ Отмена',                    callback_data: cancelCallback }],
    ],
  };
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
 */
export function formatTxListHeader(
  stats: MonthMiniStats,
  filter: IntentFilter,
): string {
  const monthName = MONTH_NAMES_RU[new Date().getMonth()] ?? '';
  const cur = escapeHtml(stats.currency);

  if (filter === 'a') {
    const parts: string[] = [];
    if (stats.expense_count > 0)
      parts.push(`${String(stats.expense_count)} расход${pluralRu(stats.expense_count)}`);
    if (stats.income_count > 0)
      parts.push(`${String(stats.income_count)} доход${pluralRu(stats.income_count)}`);
    const totalDebt = stats.debt_given_count + stats.debt_received_count;
    if (totalDebt > 0)
      parts.push(`${String(totalDebt)} долг${pluralRu(totalDebt)}`);
    if (stats.transfer_count > 0)
      parts.push(`${String(stats.transfer_count)} перевод${pluralRu(stats.transfer_count)}`);
    const summary = parts.length > 0 ? parts.join(' · ') : 'нет транзакций';
    return `<b>📋 Транзакции</b>\n\nЗа ${monthName}: ${summary}`;
  }

  if (filter === 'e') {
    const amt = formatAmountStr(stats.expense_total);
    return `<b>💸 Расходы за ${monthName}</b> (${String(stats.expense_count)} шт. · ${amt} ${cur})`;
  }

  if (filter === 'i') {
    const amt = formatAmountStr(stats.income_total);
    return `<b>\uD83D\uDCB0 Доходы за ${monthName}</b> (${String(stats.income_count)} шт. · ${amt} ${cur})`;
  }

  if (filter === 'd') {
    const total = stats.debt_given_count + stats.debt_received_count;
    return `<b>\uD83E\uDD1D Долги за ${monthName}</b> (${String(total)} шт.)`;
  }

  return `<b>\uD83D\uDD04 Переводы за ${monthName}</b> (${String(stats.transfer_count)} шт.)`;
}

/**
 * Russian plural suffix helper for count words.
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
 */
export type TxCallbackCmd =
  | { cmd: 'list'; page: number; filter: IntentFilter }
  | { cmd: 'view'; txId: string; from?: string }
  | { cmd: 'search_menu' }
  | { cmd: 'search_name' }
  | { cmd: 'search_amount' }
  | { cmd: 'search_category' }
  | { cmd: 'search_cat_result'; catId: string }
  | { cmd: 'search_date_menu' }
  | { cmd: 'search_date_preset'; preset: 'today' | 'yday' | 'week' | 'month' }
  | { cmd: 'search_date_custom' }
  | { cmd: 'search_date_cancel' }
  | { cmd: 'search_results_page'; page: number }
  | { cmd: 'field_amount'; txId: string; from?: string }
  | { cmd: 'field_cat'; txId: string; page: number; from?: string }
  | { cmd: 'field_acc'; txId: string; from?: string }
  | { cmd: 'field_int'; txId: string; from?: string }
  | { cmd: 'delete_ask'; txId: string; from?: string }
  | { cmd: 'delete_confirm'; txId: string; from?: string }
  | { cmd: 'confirm_cat'; txId: string; catId: string; from?: string }
  | { cmd: 'confirm_acc'; txId: string; accId: string; from?: string }
  | { cmd: 'confirm_int'; txId: string; intent: string; from?: string }
  | { cmd: 'cancel' }
  | { cmd: 'close' }
  | { cmd: 'done'; txId: string }
  | { cmd: 'transfer_rate'; txId: string; from?: string }
  | { cmd: 'transfer_delete'; txId: string; from?: string }
  | { cmd: 'transfer_delete_confirm'; txId: string; from?: string };

const VALID_FILTERS: readonly string[] = ['a', 'e', 'i', 'd', 't'];

/**
 * Parse a tx: callback_data string into a typed command.
 */
export function parseTxCallback(data: string): TxCallbackCmd | null {
  if (!data.startsWith('tx:')) return null;

  const parts = data.split(':');
  const sub = parts[1] ?? '';

  if (sub === 'x') return { cmd: 'cancel' };

  if (sub === 'close') return { cmd: 'close' };
  
  if (sub === 'done') {
    const txId = parts[2] ?? '';
    if (!ULID_RE.test(txId)) return null;
    return { cmd: 'done', txId };
  }

  if (sub === 'sr') {
    if (parts[2] === 'p') {
      const page = parseInt(parts[3] ?? '0', 10);
      if (isNaN(page) || page < 0) return null;
      return { cmd: 'search_results_page', page };
    }
    return null;
  }

  if (sub === 'l') {
    const page = parseInt(parts[2] ?? '0', 10);
    if (isNaN(page) || page < 0) return null;
    let filter = (parts[3] ?? 'a') as IntentFilter;
    if ((filter as string) === 'dg' || (filter as string) === 'dr') filter = 'd';
    if (!VALID_FILTERS.includes(filter)) return null;
    return { cmd: 'list', page, filter };
  }

  if (sub === 'v') {
    const txId = parts[2] ?? '';
    if (!ULID_RE.test(txId)) return null;
    const from = parts[3];
    return { cmd: 'view', txId, from };
  }

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
    if (searchSub === 'dt') {
      if (parts.length === 3) return { cmd: 'search_date_menu' };
      const dtSub = parts[3] ?? '';
      if (dtSub === 'today')  return { cmd: 'search_date_preset', preset: 'today' };
      if (dtSub === 'yday')   return { cmd: 'search_date_preset', preset: 'yday' };
      if (dtSub === 'week')   return { cmd: 'search_date_preset', preset: 'week' };
      if (dtSub === 'month')  return { cmd: 'search_date_preset', preset: 'month' };
      if (dtSub === 'custom') return { cmd: 'search_date_custom' };
      if (dtSub === 'cancel') return { cmd: 'search_date_cancel' };
      return null;
    }
    return null;
  }

  if (sub === 'f') {
    const field = parts[2] ?? '';
    const txId  = parts[3] ?? '';
    if (!ULID_RE.test(txId)) return null;

    if (field === 'amt') return { cmd: 'field_amount', txId, from: parts[4] };
    if (field === 'acc') return { cmd: 'field_acc', txId, from: parts[4] };
    if (field === 'int') return { cmd: 'field_int', txId, from: parts[4] };
    if (field === 'cat') {
      const page = parseInt(parts[4] ?? '0', 10);
      if (isNaN(page) || page < 0) return null;
      return { cmd: 'field_cat', txId, page, from: parts[5] };
    }
    return null;
  }

  if (sub === 'c') {
    const type  = parts[2] ?? '';
    const txId  = parts[3] ?? '';
    const value = parts[4] ?? '';
    if (!ULID_RE.test(txId)) return null;

    if (type === 'cat') {
      if (!ULID_RE.test(value)) return null;
      return { cmd: 'confirm_cat', txId, catId: value, from: parts[5] };
    }
    if (type === 'acc') {
      if (!ULID_RE.test(value)) return null;
      return { cmd: 'confirm_acc', txId, accId: value, from: parts[5] };
    }
    if (type === 'int') {
      if (!(EDITABLE_INTENTS as readonly string[]).includes(value)) return null;
      return { cmd: 'confirm_int', txId, intent: value, from: parts[5] };
    }
    return null;
  }

  if (sub === 'd') {
    const action = parts[2] ?? '';
    const txId   = parts[3] ?? '';
    if (!ULID_RE.test(txId)) return null;
    const from = parts[4];
    if (action === 'ask') return { cmd: 'delete_ask', txId, from };
    if (action === 'yes') return { cmd: 'delete_confirm', txId, from };
    return null;
  }

  if (sub === 'tf') {
    const action = parts[2] ?? '';
    const txId   = parts[3] ?? '';
    if (!ULID_RE.test(txId)) return null;
    const from = parts[4];
    if (action === 'rate') return { cmd: 'transfer_rate', txId, from };
    if (action === 'del')  return { cmd: 'transfer_delete', txId, from };
    if (action === 'dely') return { cmd: 'transfer_delete_confirm', txId, from };
    return null;
  }

  return null;
}
