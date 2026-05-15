/**
 * Balance Keyboard Service — Phase 2.1 / Phase LD++ / Phase B-2
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
 *   bl:ac:{id}    → add currency to parent      (6 + 26 = 32 bytes)  Phase B-2
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
import { classifyCurrency } from './account-currency-validator.service.js';

// ─────────────────────────────────────────────────────────────
// Account group classification — Balance Redesign Phase A
// ─────────────────────────────────────────────────────────────

export type GroupType = 'bank' | 'crypto_exchange' | 'crypto_wallet' | 'cash' | 'other';

export const GROUP_EMOJI: Record<GroupType, string> = {
  bank:            '🏦',
  crypto_exchange: '📈',
  crypto_wallet:   '🔐',
  cash:            '💵',
  other:           '📂',
};

export const GROUP_ORDER: GroupType[] = [
  'bank', 'crypto_exchange', 'crypto_wallet', 'cash', 'other',
];

const EXCHANGE_NAME_RE =
  /okx|okex|binance|bybit|kraken|huobi|kucoin|gate\.io|mexc|bitget|coinbase|биржа|exchange/i;
const CASH_NAME_RE = /наличн|нал\b|кэш|кеш|cash|налик/i;

/**
 * Classify an account into a display group.
 * Uses existing classifyCurrency() — no duplication.
 * Phase A: heuristic only (no sub_type column yet).
 */
export function classifyAccountGroup(name: string, currency: string, type: string): GroupType {
  if (type === 'bank_sync')        return 'bank';
  if (type === 'crypto_read_only') return 'crypto_exchange';
  const cls = classifyCurrency(currency);
  const isCrypto = cls === 'crypto' || cls === 'stablecoin';
  if (isCrypto) return EXCHANGE_NAME_RE.test(name) ? 'crypto_exchange' : 'crypto_wallet';
  return CASH_NAME_RE.test(name) ? 'cash' : 'bank';
}

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
  // Phase B-2: add a child currency account under a parent
  | { cmd: 'add_currency'; accountId: string }
  // Phase LD++: default account role toggles (cyclical)
  | { cmd: 'set_role'; role: 'none' | 'expense' | 'income' | 'main'; accountId: string };

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

  // bl:ac:{id} — Phase B-2: add currency account under parent
  if (sub === 'ac') {
    const accountId = parts[2] ?? '';
    if (accountId.length === 0) return null;
    return { cmd: 'add_currency', accountId };
  }

  if (sub === 'cs') {
    const code = parts[2] ?? '';
    if (!CURRENCY_CODE_RE.test(code)) return null;
    return { cmd: 'currency_set', code };
  }

  // bl:sr:{role_code}:{id} — set role
  if (sub === 'sr') {
    const roleCode = parts[2] ?? '';
    const accountId = parts[3] ?? '';
    if (accountId.length === 0) return null;
    
    let role: 'none' | 'expense' | 'income' | 'main';
    if (roleCode === 'n') role = 'none';
    else if (roleCode === 'e') role = 'expense';
    else if (roleCode === 'i') role = 'income';
    else if (roleCode === 'm') role = 'main';
    else return null;

    return { cmd: 'set_role', role, accountId };
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
  /** Phase B-2: ULID of parent account, or null/undefined for top-level */
  parentAccountId?: string | null;
  /** Phase B-2: number of direct children (0 for leaf accounts) */
  childCount?: number;
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

// ─────────────────────────────────────────────────────────────
// Phase B-2: plural form for child currency count
// ─────────────────────────────────────────────────────────────

/**
 * Russian plural form for currency count.
 * 1 → «валюта», 2–4 → «валюты», 5+ → «валют»
 * Special cases: 11–14 always → «валют»
 */
function pluralizeCurrency(n: number): string {
  const mod10  = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'валют';
  if (mod10 === 1)                  return 'валюта';
  if (mod10 >= 2 && mod10 <= 4)    return 'валюты';
  return 'валют';
}

/**
 * Build the main balance list keyboard.
 * One button per account (name · balance CURRENCY [· роль]) + [➕ Добавить счёт].
 *
 * Phase LD++: role tags written directly into the button text (Variant 2).
 * Phase B-2:  parent accounts with children show aggregation («N валют»)
 *             instead of a single balance+currency, followed by child rows
 *             and a [➕ Добавить валюту] button.
 *             Leaf accounts (no parent, no children) render unchanged.
 */
export function buildBalanceListKeyboard(accounts: BalanceAccountRow[]): InlineKeyboardMarkup {
  // ── Separate parents from children ───────────────────────────────
  const parentAccounts = accounts.filter((a) => !a.parentAccountId);
  const childrenOf     = new Map<string, BalanceAccountRow[]>();
  for (const acc of accounts) {
    if (acc.parentAccountId) {
      if (!childrenOf.has(acc.parentAccountId)) childrenOf.set(acc.parentAccountId, []);
      childrenOf.get(acc.parentAccountId)!.push(acc);
    }
  }

  // ── Sort top-level accounts by group, then name ───────────────────
  const sorted = [...parentAccounts].sort((a, b) => {
    const ga = classifyAccountGroup(a.name, a.currency, a.type);
    const gb = classifyAccountGroup(b.name, b.currency, b.type);
    const diff = GROUP_ORDER.indexOf(ga) - GROUP_ORDER.indexOf(gb);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, 'ru');
  });

  // Currency symbol map (shared with text renderer)
  const CCY_SYM: Record<string, string> = {
    RUB: '₽', USD: '$', EUR: '€', UAH: '₴', GBP: '£',
    KZT: '₸', BYN: 'Br', GEL: '₾', PLN: 'zł', TRY: '₺',
    CNY: '¥', JPY: '¥', HKD: 'HK$', SGD: 'S$', AUD: 'A$',
    CAD: 'C$', CHF: 'Fr',
  };
  const sym = (code: string) => CCY_SYM[code] ?? code;

  // ── Build keyboard rows ───────────────────────────────────────────
  const accountRows: { text: string; callback_data: string }[][] = [];

  for (const acc of sorted) {
    const group    = classifyAccountGroup(acc.name, acc.currency, acc.type);
    const emoji    = GROUP_EMOJI[group];
    const children = childrenOf.get(acc.account_id) ?? [];

    if (children.length > 0) {
      // Parent with children — aggregation button + child rows
      const n = children.length;
      // Role prefix for parent
      const rp = (acc.isExpenseDefault && acc.isIncomeDefault) ? '⭐ '
               : acc.isExpenseDefault                          ? '💸 '
               : acc.isIncomeDefault                           ? '💰 '
               : '';
      accountRows.push([{
        text: `${emoji} ${rp}${acc.name}  ·  ${n}\u00a0${pluralizeCurrency(n)}`,
        callback_data: `bl:v:${acc.account_id}`,
      }]);

      // Child rows: indented, currency symbol + balance
      for (const child of children) {
        const balFmt = `${formatBalanceShort(child.balance)}\u00a0${sym(child.currency)}`;
        accountRows.push([{
          text: `  └ ${balFmt}`,
          callback_data: `bl:v:${child.account_id}`,
        }]);
      }

      // ➕ Добавить валюту — bl:ac:{parentId} ≤ 32 bytes ✔️
      accountRows.push([{
        text: '➕ Добавить валюту',
        callback_data: `bl:ac:${acc.account_id}`,
      }]);
    } else {
      // Leaf account — single clean button line
      // ⭐ prefix for main account (clearly readable vs trailing emoji)
      const rp = (acc.isExpenseDefault && acc.isIncomeDefault) ? '⭐ '
               : acc.isExpenseDefault                          ? '💸 '
               : acc.isIncomeDefault                           ? '💰 '
               : '';
      const balFmt = `${formatBalanceShort(acc.balance)}\u00a0${sym(acc.currency)}`;
      accountRows.push([{
        text: `${emoji} ${rp}${acc.name}  ·  ${balFmt}`,
        callback_data: `bl:v:${acc.account_id}`,
      }]);
    }
  }

  return {
    inline_keyboard: [
      [{ text: '➕ Добавить счёт', callback_data: 'bl:add' }],
      ...accountRows,
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
 * Phase B-5: canAddCurrency — показывает кнопку «Добавить валюту» для
 *   ВСЕХ top-level счётов (parent_account_id IS NULL), не только имеющих детей.
 *   (callback bl:ac:{accountId}, 32 байта — SEC-01)
 */
export function buildAccountActionsKeyboard(
  accountId: string,
  roles: AccountRoleState = { isExpenseDefault: false, isIncomeDefault: false },
  canAddCurrency = false,
): InlineKeyboardMarkup {
  const isExp = roles.isExpenseDefault;
  const isInc = roles.isIncomeDefault;

  let roleLabel = '';
  let nextRoleCode = '';

  if (isExp && isInc) {
    roleLabel = '🏷 Роль: 💸💰 Основной';
    nextRoleCode = 'n';
  } else if (isExp) {
    roleLabel = '🏷 Роль: 💸 Расходы';
    nextRoleCode = 'i';
  } else if (isInc) {
    roleLabel = '🏷 Роль: 💰 Доходы';
    nextRoleCode = 'm';
  } else {
    roleLabel = '🏷 Роль: Обычный счёт';
    nextRoleCode = 'e';
  }

  // Phase B-5: all top-level accounts can add a sub-currency account
  const addCurrencyRow = canAddCurrency
    ? [[{ text: '➕ Добавить валюту', callback_data: `bl:ac:${accountId}` }]]
    : [];

  return {
    inline_keyboard: [
      [{ text: roleLabel, callback_data: `bl:sr:${nextRoleCode}:${accountId}` }],
      ...addCurrencyRow,
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
    ? `\n🏷 Роль: ${ isExp && isInc ? '💸💰 Основной'
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
export function formatBalanceShort(numStr: string): string {
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
