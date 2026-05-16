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
  getCurrencyFlag,
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
  // Phase B-2+: skip initial balance input when adding child account
  | { cmd: 'add_currency_skip_bal'; accountId: string }
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

  // bl:acb0:{id} — Phase B-2+: skip balance input when adding child
  if (sub === 'acb0') {
    const accountId = parts[2] ?? '';
    if (accountId.length === 0) return null;
    return { cmd: 'add_currency_skip_bal', accountId };
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
      // Multi-currency parent: ONE button with dot-separated balances
      // e.g. [🏦 Тинькофф · 2 122 $ · 50 000 ₽]
      const allEntries = [
        { balance: acc.balance, currency: acc.currency },
        ...children.map((c) => ({ balance: c.balance, currency: c.currency })),
      ];
      const dotParts = allEntries.map((e) => `${formatBalanceShort(e.balance)}\u00a0${sym(e.currency)}`);
      const rs = (acc.isExpenseDefault && acc.isIncomeDefault) ? ' \u2b50' : '';
      accountRows.push([{
        text: `${emoji} ${acc.name}${rs} \u00b7 ${dotParts.join(' \u00b7 ')}`,
        callback_data: `bl:v:${acc.account_id}`,
      }]);
    } else {
      // Leaf account — ⭐ only for primary, nothing otherwise
      const rs = (acc.isExpenseDefault && acc.isIncomeDefault) ? ' ⭐' : '';
      const balFmt = `${formatBalanceShort(acc.balance)}\u00a0${sym(acc.currency)}`;
      accountRows.push([{
        text: `${emoji} ${acc.name}${rs}  ·  ${balFmt}`,
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
  const isMain = roles.isExpenseDefault && roles.isIncomeDefault;

  // Two-state toggle: normal ↔ primary (⭐)
  const roleLabel    = isMain ? '⭐ Основной → снять роль' : '🏷 Обычный → сделать Основным';
  const nextRoleCode = isMain ? 'n' : 'm';  // n=none, m=main

  // «Добавить валюту» available for all top-level accounts
  const addCurrencyRow = canAddCurrency
    ? [[{ text: '➕ Добавить валюту', callback_data: `bl:ac:${accountId}` }]]
    : [];

  return {
    inline_keyboard: [
      [{ text: roleLabel,                  callback_data: `bl:sr:${nextRoleCode}:${accountId}` }],
      [{ text: '✏️ Переименовать',      callback_data: `bl:rn:${accountId}` }],
      ...addCurrencyRow,
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
 * Build the currency change picker keyboard (fiat).
 * 3×3 grid with flag emojis — top 9 fiat currencies.
 */
export function buildBalanceFiatCurrencyKeyboard(): InlineKeyboardMarkup {
  const TOP_FIAT = ['USD', 'EUR', 'RUB', 'UAH', 'GBP', 'PLN', 'CHF', 'KZT', 'AED'] as const;
  return {
    inline_keyboard: [
      TOP_FIAT.slice(0, 3).map((code) => ({ text: `${getCurrencyFlag(code)} ${code}`, callback_data: `bl:cs:${code}` })),
      TOP_FIAT.slice(3, 6).map((code) => ({ text: `${getCurrencyFlag(code)} ${code}`, callback_data: `bl:cs:${code}` })),
      TOP_FIAT.slice(6, 9).map((code) => ({ text: `${getCurrencyFlag(code)} ${code}`, callback_data: `bl:cs:${code}` })),
      [{ text: '✏️ Другая валюта', callback_data: 'bl:ci' }],
      [{ text: '◀️ Назад', callback_data: 'bl:back' }],
    ],
  };
}

/**
 * Build the currency change picker keyboard for crypto accounts.
 * 3×3 grid with token symbol prefixes.
 */
export function buildBalanceCryptoCurrencyKeyboard(): InlineKeyboardMarkup {
  const TOP_CRYPTO = ['USDT', 'BTC', 'ETH', 'SOL', 'TON', 'BNB', 'XRP', 'TRX', 'USDC'] as const;
  return {
    inline_keyboard: [
      TOP_CRYPTO.slice(0, 3).map((code) => ({ text: `${getCurrencyFlag(code)} ${code}`, callback_data: `bl:cs:${code}` })),
      TOP_CRYPTO.slice(3, 6).map((code) => ({ text: `${getCurrencyFlag(code)} ${code}`, callback_data: `bl:cs:${code}` })),
      TOP_CRYPTO.slice(6, 9).map((code) => ({ text: `${getCurrencyFlag(code)} ${code}`, callback_data: `bl:cs:${code}` })),
      [{ text: '✏️ Другая валюта', callback_data: 'bl:ci' }],
      [{ text: '◀️ Назад', callback_data: 'bl:back' }],
    ],
  };
}

/**
 * Build the "add currency" picker for multi-currency accounts.
 * Phase B-2+: Filters currencies already used (parent + children).
 * Phase B-9: Shows only FIAT presets for bank/cash accounts,
 *             only CRYPTO presets for crypto_exchange/crypto_wallet accounts.
 *
 * @param parentAccountId   - ULID of the parent account (for back navigation)
 * @param usedCurrencies    - Currencies already present (to exclude from picker)
 * @param parentCurrency    - Parent account's own currency (used for classification)
 * @param parentName        - Parent account name (used for classification)
 * @param parentType        - Parent account type (used for classification)
 */
export function buildAddCurrencyKeyboard(
  parentAccountId: string,
  usedCurrencies: ReadonlySet<string>,
  parentCurrency?: string,
  parentName?: string,
  parentType?: string,
): InlineKeyboardMarkup {
  // ── Classify parent to decide which preset list to show ──────
  const group = (parentCurrency && parentName && parentType)
    ? classifyAccountGroup(parentName, parentCurrency, parentType)
    : 'bank';

  const isCrypto = group === 'crypto_exchange' || group === 'crypto_wallet';

  const FIAT_PRESETS = [
    'USD', 'EUR', 'UAH', 'GBP', 'PLN',
    'CHF', 'KZT', 'AED', 'GEL', 'TRY', 'BYN', 'CNY', 'SGD',
  ] as const;

  const CRYPTO_PRESETS = [
    'USDT', 'BTC', 'ETH', 'BNB', 'SOL',
    'TON', 'USDC', 'XRP', 'TRX', 'DOGE',
  ] as const;

  // For bank/cash — fiat only. For crypto — crypto only.
  const PRESETS: readonly string[] = isCrypto ? CRYPTO_PRESETS : FIAT_PRESETS;

  const available = PRESETS.filter((c) => !usedCurrencies.has(c));

  // Up to 4 rows of 3 (crypto list is longer)
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < available.length && rows.length < 4; i += 3) {
    const row = available.slice(i, i + 3).map((code) => ({
      text: `${getCurrencyFlag(code)} ${code}`,
      callback_data: `bl:cs:${code}`,
    }));
    if (row.length > 0) rows.push(row);
  }

  return {
    inline_keyboard: [
      ...rows,
      [{ text: '✏️ Другая валюта', callback_data: 'bl:ci' }],
      [{ text: '◀️ Назад', callback_data: `bl:v:${parentAccountId}` }],
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
  const created = formatDate(acc.created_at);

  // Currency symbol (not code): ₽, $, € etc.
  const CCY_SYM: Record<string, string> = {
    RUB: '₽', USD: '$', EUR: '€', UAH: '₴', GBP: '£',
    KZT: '₸', BYN: 'Br', GEL: '₾', PLN: 'zł', TRY: '₺',
    CNY: '¥', JPY: '¥', HKD: 'HK$', SGD: 'S$', AUD: 'A$', CAD: 'C$', CHF: 'Fr',
  };
  const sym = CCY_SYM[acc.currency] ?? acc.currency;
  const balance = formatBalanceShort(acc.balance);

  // Two-state: primary (⭐) or normal
  const isMain = (roles?.isExpenseDefault ?? false) && (roles?.isIncomeDefault ?? false);
  const mainMark = isMain ? ' ⭐ Основной' : '';

  // Use the same group-classification emoji as the balance list keyboard
  const group = classifyAccountGroup(acc.name, acc.currency, acc.type);
  const icon  = GROUP_EMOJI[group];

  return (
    `${icon} <b>${name}</b>${mainMark}\n\n` +
    `💰 ${balance}\u00a0${sym}\n` +
    `📊 ${escapeHtml(typeLabel)} · ${created}`
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

// ─────────────────────────────────────────────────────────────
// Phase V2: Multi-currency account card (parent container)
// ─────────────────────────────────────────────────────────────

/** Currency entry for multi-currency display. */
export interface MultiCurrencyEntry {
  subAccountId: string;
  code: string;
  balance: string;
  flag: string;
}

const MULTI_CCY_SYM: Record<string, string> = {
  RUB: '₽', USD: '$', EUR: '€', UAH: '₴', GBP: '£',
  KZT: '₸', BYN: 'Br', GEL: '₾', PLN: 'zł', TRY: '₺',
  CNY: '¥', JPY: '¥', HKD: 'HK$', SGD: 'S$', AUD: 'A$', CAD: 'C$', CHF: 'Fr',
};
const multiSym = (code: string): string => MULTI_CCY_SYM[code] ?? code;

/**
 * Format text for multi-currency account card.
 * Example:
 *   🏦 Тинькофф
 *
 *   🇺🇸 USD   2 122 $
 *   🇵🇱 PLN   50 000 ₽
 *
 *   📊 Ручной ввод · 14.05.2026
 */
export function formatMultiCurrencyDetailText(
  parentName: string,
  currencies: MultiCurrencyEntry[],
  typeLabel: string,
  created: string,
  accountType?: string,
  accountCurrency?: string,
): string {
  const lines = currencies.map((c) =>
    `${c.flag} ${c.code}   ${formatBalanceShort(c.balance)}\u00a0${multiSym(c.code)}`,
  );
  // Use the correct group icon (same as list keyboard)
  const group = accountType && accountCurrency
    ? classifyAccountGroup(parentName, accountCurrency, accountType)
    : 'bank' as const;
  const icon = GROUP_EMOJI[group];
  return (
    `${icon} <b>${escapeHtml(parentName)}</b>\n\n` +
    `${lines.join('\n')}\n\n` +
    `📊 ${escapeHtml(typeLabel)} · ${created}`
  );
}

/**
 * Build keyboard for multi-currency account card.
 * Shows per-currency tap buttons, Add currency, Rename, Delete, Back.
 * NO role toggle at this level — roles live on leaf/sub accounts.
 */
export function buildMultiCurrencyActionsKeyboard(
  parentAccountId: string,
  currencies: MultiCurrencyEntry[],
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...currencies.map((c) => [{
        text: `${c.flag} ${c.code} · ${formatBalanceShort(c.balance)}\u00a0${multiSym(c.code)}`,
        callback_data: `bl:v:${c.subAccountId}`,
      }]),
      [{ text: '➕ Добавить валюту', callback_data: `bl:ac:${parentAccountId}` }],
      [{ text: '✏️ Переименовать',   callback_data: `bl:rn:${parentAccountId}` }],
      [{ text: '🗑 Удалить',         callback_data: `bl:d:${parentAccountId}`  }],
      [{ text: '◀️ Назад',           callback_data: 'bl:back'                  }],
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// Phase V2: Sub-account card (child currency of multi-currency)
// ─────────────────────────────────────────────────────────────

/**
 * Format text for sub-account card.
 * Example:
 *   🏦 Тинькофф · 🇺🇸 USD ⭐ Основной
 *
 *   💰 2 122 $
 *   📅 Добавлен: 14.05.2026
 */
export function formatSubAccountDetailText(
  parentName: string,
  currency: string,
  balance: string,
  created: string,
  isMain: boolean,
  accountType?: string,
): string {
  const flag = getCurrencyFlag(currency) ?? '';
  const flagStr = flag ? `${flag} ` : '';
  const mainMark = isMain ? ' ⭐ Основной' : '';
  const sym = MULTI_CCY_SYM[currency] ?? currency;
  // Derive correct icon from account type (e.g. 📈 for exchanges, 🏦 for banks)
  const group = accountType
    ? classifyAccountGroup(parentName, currency, accountType)
    : 'bank' as const;
  const icon = GROUP_EMOJI[group];
  return (
    `${icon} <b>${escapeHtml(parentName)} · ${flagStr}${escapeHtml(currency)}</b>${mainMark}\n\n` +
    `💰 ${formatBalanceShort(balance)}\u00a0${sym}\n` +
    `📅 Добавлен: ${created}`
  );
}

/**
 * Build keyboard for sub-account card.
 * Role toggle + set balance + change currency + delete + back-to-parent.
 */
export function buildSubAccountActionsKeyboard(
  subAccountId: string,
  parentAccountId: string,
  parentName: string,
  roles: AccountRoleState,
): InlineKeyboardMarkup {
  const isMain = roles.isExpenseDefault && roles.isIncomeDefault;
  const roleLabel    = isMain ? '⭐ Основной → снять роль' : '🏷 Обычный → сделать Основным';
  const nextRoleCode = isMain ? 'n' : 'm';
  return {
    inline_keyboard: [
      [{ text: roleLabel, callback_data: `bl:sr:${nextRoleCode}:${subAccountId}` }],
      [{ text: '🔄 Установить баланс',  callback_data: `bl:sb:${subAccountId}` }],
      [{ text: '💱 Изменить валюту',    callback_data: `bl:cv:${subAccountId}` }],
      [{ text: '🗑 Удалить эту валюту', callback_data: `bl:d:${subAccountId}`  }],
      [{ text: `◀️ Назад к ${escapeHtml(parentName)}`, callback_data: `bl:v:${parentAccountId}` }],
    ],
  };
}
