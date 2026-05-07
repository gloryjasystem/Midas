/**
 * Edit Keyboard Service — Phase 1.28
 *
 * Builds all InlineKeyboardMarkup objects for the /edit transaction flow.
 *
 * Callback_data format (namespace: "ed"):
 *   ed:l:<page>              → edit list, page N (0-indexed)       [6+N bytes]
 *   ed:v:<txId>              → view transaction card               [31 bytes]
 *   ed:f:amt:<txId>          → tap: enter edit-amount mode         [35 bytes]
 *   ed:f:cat:<txId>:<page>   → show category picker, page N       [38 bytes]
 *   ed:f:acc:<txId>          → show account picker                 [35 bytes]
 *   ed:f:int:<txId>          → show intent picker                  [35 bytes]
 *   ed:c:cat:<txId>:<catId>  → confirm category change            [54 bytes max]
 *   ed:c:acc:<txId>:<accId>  → confirm account change             [54 bytes max]
 *   ed:c:int:<txId>:<intent> → confirm intent change              [≤50 bytes]
 *   ed:x                     → close / cancel                      [4 bytes]
 *
 * All callback_data values are strictly ≤ 64 bytes (Telegram limit).
 * Verified: longest is ed:c:cat:<26>:<26> = 4+1+3+1+26+1+26 = 62 bytes ✅
 *
 * Security:
 *   - All callback_data parsed strictly in parseEditCallback().
 *   - txId, catId, accId validated against ULID regex before DB use.
 *   - intent validated against EDITABLE_INTENTS allowlist.
 *   - No user-provided text enters callback_data.
 *
 * Phase 1.28 scope guard:
 *   - No delete button (Phase 1.29).
 *   - No date edit button (deferred).
 *   - No search button (deferred, needs GIN index).
 */

import type { InlineKeyboardButton, InlineKeyboardMarkup } from './telegram-api.js';
import { escapeHtml } from '../utils/html-escape.js';
import type { TransactionListItem, CategoryItem, AccountItem } from './edit.service.js';
import { EDIT_PAGE_SIZE, EDITABLE_INTENTS } from './edit.service.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Format a DB NUMERIC string to 2 decimal places for display.
 * SEC-02: avoids parseFloat / Number() on financial values.
 * The value from PostgreSQL is already a precise decimal string (e.g. "350.00").
 * We parse it using integer arithmetic only.
 *
 * Example: "350" → "350.00", "1500.5" → "1500.50", "2100.123" → "2100.12"
 */
function formatAmountStr(numStr: string): string {
  const dotIdx = numStr.indexOf('.');
  if (dotIdx === -1) return `${numStr}.00`;
  const integer = numStr.slice(0, dotIdx);
  const frac = numStr.slice(dotIdx + 1).padEnd(2, '0').slice(0, 2);
  return `${integer}.${frac}`;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Category picker rows: 2 per row */
const CAT_COLS = 2;
const CAT_PAGE_SIZE = 8; // 4 rows × 2 cols

// ─────────────────────────────────────────────────────────────
// List keyboard
// ─────────────────────────────────────────────────────────────

/**
 * Build the paginated transaction list keyboard.
 * Each transaction is a single button row.
 * Navigation: ◀️ and ▶️ arrows + ❌ close.
 */
export function buildTransactionListKeyboard(
  items: TransactionListItem[],
  page: number,
  totalPages: number,
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = items.map((tx, i) => [
    {
      text: `${String(page * EDIT_PAGE_SIZE + i + 1)}. ${
        tx.transaction_intent === 'income' ? '💰' :
        tx.transaction_intent === 'expense' ? '💸' :
        tx.transaction_intent === 'debt_given' ? '🔴' :
        tx.transaction_intent === 'debt_received' ? '🟢' : '🔄'
      } ${escapeHtml(tx.category_name)} — ${formatAmountStr(tx.base_amount)} ${escapeHtml(tx.base_currency)}`,
      callback_data: `ed:v:${tx.id}`,
    },
  ]);

  // Navigation row
  const navRow: InlineKeyboardButton[] = [];
  if (page > 0) {
    navRow.push({ text: '◀️', callback_data: `ed:l:${String(page - 1)}` });
  }
  navRow.push({ text: `${String(page + 1)}/${String(totalPages)}`, callback_data: 'ed:x' });
  if (page < totalPages - 1) {
    navRow.push({ text: '▶️', callback_data: `ed:l:${String(page + 1)}` });
  }
  rows.push(navRow);
  rows.push([{ text: '❌ Закрыть', callback_data: 'ed:x' }]);

  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────────────────────
// Card keyboard
// ─────────────────────────────────────────────────────────────

/**
 * Build the transaction card keyboard.
 * Buttons: edit amount, category, account, intent.
 * No delete button (Phase 1.29). No date button (deferred).
 */
export function buildTransactionCardKeyboard(txId: string, isCrossCurrency: boolean): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];

  // Amount edit — disabled for cross-currency transactions (D2)
  if (!isCrossCurrency) {
    rows.push([{ text: '✏️ Изменить сумму', callback_data: `ed:f:amt:${txId}` }]);
  }

  rows.push([{ text: '📁 Изменить категорию', callback_data: `ed:f:cat:${txId}:0` }]);
  rows.push([{ text: '🏦 Изменить счёт',      callback_data: `ed:f:acc:${txId}` }]);
  rows.push([{ text: '🔄 Изменить тип',        callback_data: `ed:f:int:${txId}` }]);
  rows.push([{ text: '◀️ Назад к списку',      callback_data: 'ed:l:0' }]);

  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────────────────────
// Category picker keyboard
// ─────────────────────────────────────────────────────────────

/**
 * Build a paginated category picker.
 * CAT_PAGE_SIZE per page, CAT_COLS per row.
 * callback_data = ed:c:cat:<txId>:<catId> (≤ 62 bytes)
 */
export function buildCategoryPickerKeyboard(
  txId: string,
  categories: CategoryItem[],
  page: number,
): InlineKeyboardMarkup {
  const start = page * CAT_PAGE_SIZE;
  const items = categories.slice(start, start + CAT_PAGE_SIZE);
  const totalPages = Math.ceil(categories.length / CAT_PAGE_SIZE);

  const rows: InlineKeyboardButton[][] = [];

  // Category buttons — 2 per row
  for (let i = 0; i < items.length; i += CAT_COLS) {
    rows.push(
      items.slice(i, i + CAT_COLS).map((cat) => ({
        text: escapeHtml(cat.name),
        callback_data: `ed:c:cat:${txId}:${cat.id}`,
      })),
    );
  }

  // Navigation
  const navRow: InlineKeyboardButton[] = [];
  if (page > 0) {
    navRow.push({ text: '◀️', callback_data: `ed:f:cat:${txId}:${String(page - 1)}` });
  }
  if (totalPages > 1) {
    navRow.push({ text: `${String(page + 1)}/${String(totalPages)}`, callback_data: 'ed:x' });
  }
  if (page < totalPages - 1) {
    navRow.push({ text: '▶️', callback_data: `ed:f:cat:${txId}:${String(page + 1)}` });
  }
  if (navRow.length > 0) rows.push(navRow);

  rows.push([{ text: '◀️ Назад', callback_data: `ed:v:${txId}` }]);

  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────────────────────
// Account picker keyboard
// ─────────────────────────────────────────────────────────────

/**
 * Build an account picker (all accounts, 1 per row — names can be long).
 * callback_data = ed:c:acc:<txId>:<accId> (≤ 62 bytes)
 */
export function buildAccountPickerKeyboard(
  txId: string,
  accounts: AccountItem[],
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = accounts.map((acc) => [
    {
      text: `${escapeHtml(acc.name)} (${escapeHtml(acc.currency)})`,
      callback_data: `ed:c:acc:${txId}:${acc.id}`,
    },
  ]);
  rows.push([{ text: '◀️ Назад', callback_data: `ed:v:${txId}` }]);
  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────────────────────
// Intent picker keyboard
// ─────────────────────────────────────────────────────────────

const INTENT_BUTTON_LABELS: Record<string, string> = {
  income:        '💰 Доход',
  expense:       '💸 Расход',
  debt_given:    '🔴 Долг выдан',
  debt_received: '🟢 Долг получен',
  transfer:      '🔄 Перевод',
};

/**
 * Build intent picker keyboard.
 * callback_data = ed:c:int:<txId>:<intent> (≤ 50 bytes for longest intent)
 */
export function buildIntentPickerKeyboard(txId: string): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = EDITABLE_INTENTS.map((intent) => [
    {
      text: INTENT_BUTTON_LABELS[intent] ?? intent,
      callback_data: `ed:c:int:${txId}:${intent}`,
    },
  ]);
  rows.push([{ text: '◀️ Назад', callback_data: `ed:v:${txId}` }]);
  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────────────────────
// Callback_data parser
// ─────────────────────────────────────────────────────────────

const ULID_RE = /^[0-9A-Z]{26}$/;

export type EditCallbackCmd =
  | { cmd: 'list'; page: number }
  | { cmd: 'view'; txId: string }
  | { cmd: 'field_amount'; txId: string }
  | { cmd: 'field_cat'; txId: string; page: number }
  | { cmd: 'field_acc'; txId: string }
  | { cmd: 'field_int'; txId: string }
  | { cmd: 'confirm_cat'; txId: string; catId: string }
  | { cmd: 'confirm_acc'; txId: string; accId: string }
  | { cmd: 'confirm_int'; txId: string; intent: string }
  | { cmd: 'cancel' };

/**
 * Parse and validate an edit callback_data string.
 * Returns null for any unrecognised or malformed input (SEC-01 allowlist).
 *
 * All txId/catId/accId validated as ULID.
 * intent validated against EDITABLE_INTENTS allowlist.
 */
export function parseEditCallback(data: string): EditCallbackCmd | null {
  if (!data.startsWith('ed:')) return null;

  const parts = data.split(':');
  // parts[0] = 'ed'
  const sub = parts[1] ?? '';

  if (sub === 'x') return { cmd: 'cancel' };

  if (sub === 'l') {
    const page = parseInt(parts[2] ?? '0', 10);
    if (isNaN(page) || page < 0) return null;
    return { cmd: 'list', page };
  }

  if (sub === 'v') {
    const txId = parts[2] ?? '';
    if (!ULID_RE.test(txId)) return null;
    return { cmd: 'view', txId };
  }

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

  return null;
}
