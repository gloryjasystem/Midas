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
 *   ed:d:ask:<txId>          → Phase 1.29: show delete warning     [36 bytes]
 *   ed:d:yes:<txId>          → Phase 1.29: confirm soft delete     [36 bytes]
 *   ed:x                     → close / cancel                      [4 bytes]
 *
 * All callback_data values are strictly ≤ 64 bytes (Telegram limit).\n * Verified longest: ed:c:cat:<26>:<26> = 62 bytes ✅  Phase 1.29 max: ed:d:ask:<26> = 36 bytes ✅
 *
 * Security:
 *   - All callback_data parsed strictly in parseEditCallback().
 *   - txId, catId, accId validated against ULID regex before DB use.
 *   - intent validated against EDITABLE_INTENTS allowlist.
 *   - No user-provided text enters callback_data.
 *
 * Phase 1.28 scope guard:
 *   - No date edit button (deferred).
 *   - No search button (deferred, needs GIN index).
 * Phase 1.29 scope guard:
 *   - No restore / undelete UI.
 *   - No hard delete path.
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
 * Buttons: edit amount, category, account, intent, delete.
 * Phase 1.29: [🗑️ Удалить] triggers double-confirmation flow (ed:d:ask).
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
  // Phase 1.29: delete button — triggers warning state (ed:d:ask:<txId>, 36 bytes ≤ 64 ✅)
  rows.push([{ text: '🗑️ Удалить',             callback_data: `ed:d:ask:${txId}` }]);
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
 * Format account balance for display in account picker buttons.
 * SEC-02: integer arithmetic only — no parseFloat / Number().
 * Strips trailing decimal zeros, adds thin-space thousand separator.
 */
function fmtAccountBalance(balStr: string): string {
  if (!balStr || balStr === '0') return '0';
  const isNeg = balStr.startsWith('-');
  const abs = isNeg ? balStr.slice(1) : balStr;
  const dotIdx = abs.indexOf('.');
  const intPart  = dotIdx === -1 ? abs : abs.slice(0, dotIdx);
  const fracFull = dotIdx === -1 ? '' : abs.slice(dotIdx + 1);
  const fracTrim = fracFull.replace(/0+$/, '');  // strip trailing zeros
  const intSep   = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F'); // thin space
  const formatted = fracTrim ? `${intSep}.${fracTrim}` : intSep;
  return isNeg ? `\u2212${formatted}` : formatted; // − (minus sign, not hyphen)
}

/**
 * Build an account picker for either the `ed:` or `tx:` namespace.
 *
 * Visual design:
 *   🏦 Name · bal CUR  ← accounts whose currency matches txCurrency (listed first)
 *   ⚠️ Name · bal CUR  ← accounts with a different currency (listed after)
 *
 * If txCurrency is empty all accounts are shown with 🏦.
 * Hint line is shown in the message header (passed by caller).
 *
 * @param txCurrency — currency of the current transaction (e.g. 'USD').
 * @param opts.namespace — 'ed' (default) or 'tx' — controls callback_data prefix.
 * @param opts.suffix   — extra suffix appended to tx: callback_data (e.g. ':s' for `from`).
 */
export function buildAccountPickerKeyboard(
  txId: string,
  accounts: AccountItem[],
  txCurrency: string,
  opts?: { namespace?: 'ed' | 'tx'; suffix?: string },
): InlineKeyboardMarkup {
  const ns  = opts?.namespace ?? 'ed';
  const sfx = opts?.suffix   ?? '';
  const txCur = txCurrency.toUpperCase();

  const same  = txCur ? accounts.filter(a => a.currency.toUpperCase() === txCur)  : accounts;
  const cross = txCur ? accounts.filter(a => a.currency.toUpperCase() !== txCur)  : [];

  const makeRow = (acc: AccountItem, isCross: boolean): InlineKeyboardButton[] => {
    const icon  = isCross ? '\u26A0\uFE0F' : '\uD83C\uDFE6';  // ⚠️ or 🏦
    const bal   = fmtAccountBalance(acc.balance);
    const label = `${icon} ${escapeHtml(acc.name)} \u00B7 ${bal} ${escapeHtml(acc.currency)}`;
    const cbData = ns === 'tx'
      ? `tx:c:acc:${txId}:${acc.id}${sfx}`
      : `ed:c:acc:${txId}:${acc.id}`;
    return [{ text: label, callback_data: cbData }];
  };

  const rows: InlineKeyboardButton[][] = [
    ...same.map(a  => makeRow(a, false)),
    ...cross.map(a => makeRow(a, true)),
  ];

  const backCb = ns === 'tx' ? `tx:v:${txId}${sfx}` : `ed:v:${txId}`;
  rows.push([{ text: '\u25C0\uFE0F \u041D\u0430\u0437\u0430\u0434', callback_data: backCb }]);
  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────────────────────
// Intent picker keyboard
// ─────────────────────────────────────────────────────────────

const INTENT_BUTTON_LABELS: Record<string, string> = {
  income:        '💰 Доход',
  expense:       '💸 Расход',
  debt_given:    '🤝 Долг (дал)',    // matches system-wide standard (🤝/🤲)
  debt_received: '🤲 Долг (взял)',
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
  // Phase 1.29: soft delete double-confirmation
  | { cmd: 'delete_ask'; txId: string }     // show warning state
  | { cmd: 'delete_confirm'; txId: string } // execute soft delete
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

  // Phase 1.29: delete flow (ed:d:ask:<txId> or ed:d:yes:<txId>)
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

// ─────────────────────────────────────────────────────────────
// Delete confirmation keyboard (Phase 1.29)
// ─────────────────────────────────────────────────────────────

/**
 * Build the delete warning keyboard.
 * Shown after [🗑️ Удалить] tap on the card.
 * Two buttons: [🗑️ Да, удалить] (ed:d:yes:<txId>, 36 bytes) and [◀️ Отмена] (ed:v:<txId>, 31 bytes).
 */
export function buildDeleteConfirmKeyboard(txId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '🗑️ Да, удалить', callback_data: `ed:d:yes:${txId}` },
        { text: '◀️ Отмена',      callback_data: `ed:v:${txId}` },
      ],
    ],
  };
}
