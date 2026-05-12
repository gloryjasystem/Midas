/**
 * Balance Keyboard Service — Phase 2.1 / Phase LD++
 *
 * Builds Telegram InlineKeyboardMarkup objects for the account management
 * dashboard inside the /balance flow.
 *
 * Callback_data namespace: "bl:"
 *   bl:v:{id}     → view account detail        (5 + 26 = 31 bytes)
 *   bl:add        → add new account             (6 bytes)
 *   bl:rn:{id}    → rename account              (6 + 26 = 32 bytes)
 *   bl:cv:{id}    → change currency (start)     (6 + 26 = 32 bytes)
 *   bl:cvf:{id}   → change currency (force)     (7 + 26 = 33 bytes)  ← MAX
 *   bl:cs:{code}  → currency set (pick)         (10-13 bytes)
 *   bl:ci         → currency input (free-text)  (5 bytes)
 *   bl:sb:{id}    → set balance                 (6 + 26 = 32 bytes)
 *   bl:d:{id}     → delete request              (5 + 26 = 31 bytes)
 *   bl:dc:{id}    → delete confirm              (6 + 26 = 32 bytes)
 *   bl:back       → back to balance list        (7 bytes)
 *   bl:se:{id}    → set default EXPENSE account (6 + 26 = 32 bytes)  Phase LD++
 *   bl:si:{id}    → set default INCOME  account (6 + 26 = 32 bytes)  Phase LD++
 *   bl:ce:{id}    → clear default EXPENSE       (6 + 26 = 32 bytes)  Phase LD++
 *   bl:cl:{id}    → clear default INCOME        (6 + 26 = 32 bytes)  Phase LD++
 *
 * All values ≤ 33 bytes — safely within Telegram 64-byte limit.
 * No user-provided data enters callback_data.
 *
 * SEC-01: All callback sub/action values validated against allowlist.
 * SEC-12: No names or amounts in callback_data or logs.
 */

import type { InlineKeyboardMarkup } from '../services/telegram-api.js';
import { escapeHtml } from '../utils/html-escape.js';
import {
  FIAT_CURRENCY_PRESETS,
  CRYPTO_CURRENCY_PRESETS,
} from '../services/account-onboard-keyboard.service.js';

// ─────────────────────────────────────────────────────────────
// Callback_data parsed type
// ─────────────────────────────────────────────────────────────

export type BalanceCallbackCmd =
  | { cmd: 'view_account'; accountId: string }
  | { cmd: 'add_account' }
  | { cmd: 'rename'; accountId: string }
  | { cmd: 'change_currency'; accountId: string }
  | { cmd: 'change_currency_force'; accountId: string }
  | { cmd: 'currency_set'; code: string }
  | { cmd: 'currency_input' }
  | { cmd: 'set_balance'; accountId: string }
  | { cmd: 'delete'; accountId: string }
  | { cmd: 'delete_confirm'; accountId: string }
  | { cmd: 'back' }
  | { cmd: 'close' }
  // Phase LD++: default account role toggles
  | { cmd: 'set_expense';   accountId: string }
  | { cmd: 'set_income';    accountId: string }
  | { cmd: 'clear_expense'; accountId: string }
  | { cmd: 'clear_income';  accountId: string };

// ─────────────────────────────────────────────────────────────
// Parser — SEC-01 allowlist
// ─────────────────────────────────────────────────────────────

const CURRENCY_CODE_RE = /^[A-Z]{1,10}$/;

/**
 * Parse and validate a balance management callback_data string.
 * Returns null for any unrecognised or malformed input (SEC-01 allowlist).
 */
export function parseBalanceCallback(data: string): BalanceCallbackCmd | null {
  if (!data.startsWith('bl:')) return null;

  const parts = data.split(':');
  const sub = parts[1] ?? '';

  if (sub === 'add') return { cmd: 'add_account' };
  if (sub === 'back') return { cmd: 'back' };
  if (sub === 'close') return { cmd: 'close' };
  if (sub === 'ci') return { cmd: 'currency_input' };

  // bl:cs:{code} — currency set
  if (sub === 'cs') {
    const code = parts[2] ?? '';
    if (!CURRENCY_CODE_RE.test(code)) return null;
    return { cmd: 'currency_set', code };
  }

  // All remaining commands require a valid account ID
  const accountId = parts[2] ?? '';
  if (accountId.length === 0) return null;

  if (sub === 'v') return { cmd: 'view_account', accountId };
  if (sub === 'rn') return { cmd: 'rename', accountId };
  if (sub === 'cv') return { cmd: 'change_currency', accountId };
  if (sub === 'cvf') return { cmd: 'change_currency_force', accountId };
  if (sub === 'sb') return { cmd: 'set_balance', accountId };
  if (sub === 'd') return { cmd: 'delete', accountId };
  if (sub === 'dc') return { cmd: 'delete_confirm', accountId };
  // Phase LD++: default account role toggles
  if (sub === 'se') return { cmd: 'set_expense',   accountId };
  if (sub === 'si') return { cmd: 'set_income',    accountId };
  if (sub === 'ce') return { cmd: 'clear_expense', accountId };
  if (sub === 'cl') return { cmd: 'clear_income',  accountId };

  return null;
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** Account row returned from getBalanceData() for keyboard building. */
export interface BalanceAccountRow {
  account_id: string;
  name: string;
  type: string;
  currency: string;
  balance: string;
  /** Phase LD++: true if this account is workspace default for expenses */
  isExpenseDefault: boolean;
  /** Phase LD++: true if this account is workspace default for incomes */
  isIncomeDefault: boolean;
}

/** Full account detail for the account card view. */
export interface AccountDetail {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: string;
  tx_count: string;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────
// Keyboard builders
// ─────────────────────────────────────────────────────────────

/** Type label map for display. */
const TYPE_LABELS: Record<string, string> = {
  manual: 'Ручной ввод',
  crypto_read_only: 'Только чтение',
  bank_sync: 'Банковская синхр.',
};

/**
 * Build the main balance list keyboard.
 * One button per account (name · balance CURRENCY [· роль]) + [➕ Добавить счёт].
 *
 * Phase LD++: role tags written directly into the button text (Вариант 2).
 *   "Тинькофф · 15 400 RUB · расходы"
 *   "Наличные · 2 120 PLN · доходы"
 *   "Binance · 850 USDT · расходы и доходы"
 *   "Wallet · 0 ETH"            (no role — no tag)
 */
export function buildBalanceListKeyboard(accounts: BalanceAccountRow[]): InlineKeyboardMarkup {
  // Account rows (tappable to view detail)
  const accountRows = accounts.map((acc) => {
    // Role tag appended inline — fintech convention: short, lowercase
    const roleTag = (acc.isExpenseDefault && acc.isIncomeDefault) ? ' · расходы и доходы'
                  : acc.isExpenseDefault                          ? ' · расходы'
                  : acc.isIncomeDefault                           ? ' · доходы'
                  : '';
    return [{
      text: `${acc.name} · ${formatBalanceShort(acc.balance)} ${acc.currency}${roleTag}`,
      callback_data: `bl:v:${acc.account_id}`,
    }];
  });

  return {
    inline_keyboard: [
      // Add Account — top (intentional action, hard to hit accidentally)
      [{ text: '➕ Добавить счёт', callback_data: 'bl:add' }],
      // Account list
      ...accountRows,
      // Close — bottom (last action, safety)
      [{ text: '✖️ Закрыть', callback_data: 'bl:close' }],
    ],
  };
}

/**
 * Role flags for buildAccountActionsKeyboard().
 * Phase LD++: controls which circle-toggle buttons are shown.
 */
export interface AccountRoleState {
  isExpenseDefault: boolean;
  isIncomeDefault:  boolean;
}

/**
 * Build the account actions keyboard (detail view).
 *
 * Phase LD++: adds two circle-toggle rows for expense/income default roles.
 *   💸 Расходы: ⚪ (not set) → tap → bl:se:{id} (set_expense)
 *   💸 Расходы: 🟢 (is set)  → tap → bl:ce:{id} (clear_expense)
 *   💰 Доходы:  ⚪ (not set) → tap → bl:si:{id} (set_income)
 *   💰 Доходы:  🟢 (is set)  → tap → bl:cl:{id} (clear_income)
 *
 * @param accountId - ULID of the account being viewed
 * @param roles     - current role state (from getAccountRoles() or BalanceDataRow)
 */
export function buildAccountActionsKeyboard(
  accountId: string,
  roles: AccountRoleState = { isExpenseDefault: false, isIncomeDefault: false },
): InlineKeyboardMarkup {
  // Circle-toggle buttons: 🟢 = active (tap to clear), ⚪ = inactive (tap to set)
  const expenseLabel = roles.isExpenseDefault
    ? '💸 Расходы: 🟢 (убрать)'
    : '💸 Расходы: ⚪ (назначить)';
  const expenseCb = roles.isExpenseDefault
    ? `bl:ce:${accountId}`
    : `bl:se:${accountId}`;

  const incomeLabel = roles.isIncomeDefault
    ? '💰 Доходы: 🟢 (убрать)'
    : '💰 Доходы: ⚪ (назначить)';
  const incomeCb = roles.isIncomeDefault
    ? `bl:cl:${accountId}`
    : `bl:si:${accountId}`;

  return {
    inline_keyboard: [
      [{ text: expenseLabel, callback_data: expenseCb }],
      [{ text: incomeLabel,  callback_data: incomeCb  }],
      [{ text: '✏️ Переименовать',      callback_data: `bl:rn:${accountId}` }],
      [{ text: '💱 Изменить валюту',    callback_data: `bl:cv:${accountId}` }],
      [{ text: '🔄 Установить баланс', callback_data: `bl:sb:${accountId}` }],
      [{ text: '🗑 Удалить',           callback_data: `bl:d:${accountId}`  }],
      [{ text: '◀️ Назад',             callback_data: 'bl:back'            }],
    ],
  };
}

/**
 * Build the delete confirmation keyboard.
 */
export function buildDeleteConfirmKeyboard(accountId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Да, удалить', callback_data: `bl:dc:${accountId}` },
        { text: '❌ Отмена', callback_data: `bl:v:${accountId}` },
      ],
    ],
  };
}

/**
 * Build the currency change warning keyboard.
 * Shown when account has transactions in the old currency.
 */
export function buildCurrencyWarningKeyboard(accountId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Да, сменить', callback_data: `bl:cvf:${accountId}` },
        { text: '❌ Отмена', callback_data: `bl:v:${accountId}` },
      ],
    ],
  };
}

/**
 * Build the currency change picker keyboard.
 * Uses fiat presets (since most currency changes are for fiat accounts).
 * For crypto accounts, user can pick [✏️ Другая].
 */
export function buildBalanceFiatCurrencyKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      FIAT_CURRENCY_PRESETS.slice(0, 3).map((code) => ({
        text: code,
        callback_data: `bl:cs:${code}`,
      })),
      FIAT_CURRENCY_PRESETS.slice(3, 6).map((code) => ({
        text: code,
        callback_data: `bl:cs:${code}`,
      })),
      [{ text: '✏️ Другая валюта', callback_data: 'bl:ci' }],
      [{ text: '◀️ Назад', callback_data: 'bl:back' }],
    ],
  };
}

/**
 * Build the currency change picker keyboard for crypto accounts.
 */
export function buildBalanceCryptoCurrencyKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      CRYPTO_CURRENCY_PRESETS.slice(0, 3).map((code) => ({
        text: code,
        callback_data: `bl:cs:${code}`,
      })),
      CRYPTO_CURRENCY_PRESETS.slice(3, 6).map((code) => ({
        text: code,
        callback_data: `bl:cs:${code}`,
      })),
      [{ text: '✏️ Другая валюта', callback_data: 'bl:ci' }],
      [{ text: '◀️ Назад', callback_data: 'bl:back' }],
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// Text formatters
// ─────────────────────────────────────────────────────────────

/**
 * Format account detail card text.
 *
 * Phase LD++: shows role badges (💸 / 💰 / 💸💰) after account name
 * when the account is set as a workspace default.
 */
export function formatAccountDetailText(
  acc: AccountDetail,
  roles?: AccountRoleState,
): string {
  const name = escapeHtml(acc.name);
  const typeLabel = TYPE_LABELS[acc.type] ?? acc.type;
  const currency = escapeHtml(acc.currency);
  const balance = escapeHtml(formatBalanceShort(acc.balance));
  const txCount = escapeHtml(acc.tx_count);
  const created = formatDate(acc.created_at);

  // Phase LD++: role status line
  const isExp = roles?.isExpenseDefault ?? false;
  const isInc = roles?.isIncomeDefault  ?? false;
  const roleLine = (isExp || isInc)
    ? `\n🏷 Роль: ${ isExp && isInc ? '💸 Расходы · 💰 Доходы'
                 : isExp             ? '💸 Расходы'
                 :                     '💰 Доходы'}`
    : '';

  return (
    `🏦 <b>${name}</b>\n\n` +
    `📊 Тип: ${escapeHtml(typeLabel)}\n` +
    `💱 Валюта: ${currency}\n` +
    `💰 Баланс: <b>${balance} ${currency}</b>\n` +
    `📝 Транзакций: ${txCount}\n` +
    `📅 Создан: ${created}` +
    roleLine
  );
}

/**
 * Format empty balance screen text.
 */
export const BALANCE_EMPTY_TEXT =
  '💰 <b>Баланс по счетам:</b>\n\n' +
  'Счетов пока нет.';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Format a NUMERIC string as a short balance display.
 * Uses ru-RU locale for space as thousands separator to avoid confusion 
 * with decimal comma/period. Drops decimal zeroes for whole numbers.
 * "1234.50" → "1 234,50"
 * "2000.00" → "2 000"
 */
function formatBalanceShort(numStr: string): string {
  const num = parseFloat(numStr);
  if (isNaN(num)) return numStr;
  
  const isWhole = num % 1 === 0;
  return num.toLocaleString('ru-RU', { 
    minimumFractionDigits: isWhole ? 0 : 2, 
    maximumFractionDigits: 6 
  });
}

/**
 * Format ISO date to DD.MM.YYYY
 */
function formatDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear());
    return `${dd}.${mm}.${yyyy}`;
  } catch {
    return isoStr;
  }
}
