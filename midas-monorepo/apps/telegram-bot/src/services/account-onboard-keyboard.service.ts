/**
 * Account Onboard Keyboard Service — Phase 1.30
 *
 * Builds Telegram InlineKeyboardMarkup objects for the smart account
 * onboarding flow triggered from /accounts (empty state) and /start
 * (new user guided setup).
 *
 * Callback_data namespace: "ac:"
 *   ac:type:card      → user picked Банковская карта  (12 bytes)
 *   ac:type:cash      → user picked Наличные          (12 bytes)
 *   ac:type:exchange  → user picked Крипто-биржа      (16 bytes) ← MAX
 *   ac:type:wallet    → user picked Крипто-кошелёк    (14 bytes)
 *   ac:type:custom    → user picked Своё название      (14 bytes)
 *   ac:xch:binance    → exchange preset: Binance       (14 bytes)
 *   ac:xch:bybit      → exchange preset: Bybit         (12 bytes)
 *   ac:xch:okx        → exchange preset: OKX           (10 bytes)
 *   ac:xch:kraken     → exchange preset: Kraken        (13 bytes)
 *   ac:xch:huobi      → exchange preset: Huobi         (12 bytes)
 *   ac:xch:custom     → exchange: free-text name       (13 bytes)
 *   ac:cur:USDT       → currency pick: USDT            (11 bytes)
 *   ac:cur:BTC        → currency pick: BTC             (10 bytes)
 *   ac:cur:ETH        → currency pick: ETH             (10 bytes)
 *   ac:cur:custom     → currency: free-text input      (13 bytes)
 *   ac:skip           → skip onboarding (from /start)  (7 bytes)
 *   ac:more           → add another account            (7 bytes)
 *   ac:done           → finish adding accounts         (7 bytes)
 *
 * All values ≤ 16 bytes — safely within Telegram 64-byte limit.
 * No user-provided data enters callback_data.
 *
 * Redis state key: midas:ac:{telegramUserId}:{chatId}  TTL 300s
 * Value: JSON.stringify(AccountOnboardState)
 *
 * SEC-01: All callback type/action values validated against allowlist.
 * SEC-12: No names or amounts logged.
 */

import type { InlineKeyboardMarkup } from '../services/telegram-api.js';

// ─────────────────────────────────────────────────────────────
// Redis state type
// ─────────────────────────────────────────────────────────────

/**
 * Onboarding flow step.
 *   type_pick      → user taps /accounts or /start guided keyboard
 *   name_input     → bot awaiting free-text account name
 *   smart_confirm  → bot showed fuzzy suggestion, awaiting confirm/reject (Phase 2.3)
 *   cur_pick       → bot showing currency keyboard
 *   cur_input      → bot awaiting free-text currency code
 *   bal_input      → bot awaiting initial balance amount (Phase 2.2)
 */
export type OnboardStep = 'type_pick' | 'name_input' | 'smart_confirm' | 'cur_pick' | 'cur_input' | 'bal_input';

export interface AccountOnboardState {
  step: OnboardStep;
  /** Account type selected — present from type_pick step onward */
  accountType?: 'card' | 'cash' | 'exchange' | 'wallet' | 'custom';
  /** Account name resolved — present from cur_pick step onward */
  name?: string;
  /** Account ULID — set after DB insert; used by bal_input step (Phase 2.2) */
  accountId?: string;
  /** Currency code — stored for bal_input display (Phase 2.2) */
  currency?: string;
  // Phase 2.3: smart name matching
  /** Raw text the user originally typed (before fuzzy suggestion) */
  originalName?: string;
  /** Fuzzy-matched preset name to suggest */
  suggestedName?: string;
  /** Account type inferred from the fuzzy match */
  suggestedType?: 'card' | 'cash' | 'exchange' | 'wallet';
  /** Default currency for the suggested preset */
  suggestedCurrency?: string;
}

// ─────────────────────────────────────────────────────────────
// Bank preset allowlist (SEC-01)
// key → { name, defaultCurrency }
// ─────────────────────────────────────────────────────────────

export interface PresetInfo {
  name: string;
  defaultCurrency: string;
}

export const BANK_PRESETS: ReadonlyMap<string, PresetInfo> = new Map([
  // Russia
  ['tinkoff',    { name: 'Тинькофф',      defaultCurrency: 'RUB' }],
  ['sber',       { name: 'Сбербанк',      defaultCurrency: 'RUB' }],
  ['vtb',        { name: 'ВТБ',           defaultCurrency: 'RUB' }],
  ['alfa',       { name: 'Альфа-Банк',    defaultCurrency: 'RUB' }],
  ['ozon',       { name: 'Озон Банк',     defaultCurrency: 'RUB' }],
  ['mkb',        { name: 'МКБ',           defaultCurrency: 'RUB' }],
  ['gazprom',    { name: 'Газпромбанк',   defaultCurrency: 'RUB' }],
  ['psb',        { name: 'Промсвязьбанк', defaultCurrency: 'RUB' }],
  ['uralsib',    { name: 'Уралсиб',       defaultCurrency: 'RUB' }],
  ['sovkombank', { name: 'Совкомбанк',    defaultCurrency: 'RUB' }],
  ['rosselhoz',  { name: 'Россельхоз',    defaultCurrency: 'RUB' }],
  ['mkb2',       { name: 'Открытие',      defaultCurrency: 'RUB' }],
  // Ukraine
  ['mono',       { name: 'Монобанк',      defaultCurrency: 'UAH' }],
  ['privat',     { name: 'ПриватБанк',    defaultCurrency: 'UAH' }],
  ['ukrsib',     { name: 'Укрсиббанк',    defaultCurrency: 'UAH' }],
  ['oschad',     { name: 'Ощадбанк',      defaultCurrency: 'UAH' }],
  ['pumb',       { name: 'ПУМБ',          defaultCurrency: 'UAH' }],
  ['abank',      { name: 'A-Банк',        defaultCurrency: 'UAH' }],
  // Belarus
  ['belinvest',  { name: 'Белинвестбанк', defaultCurrency: 'BYN' }],
  ['priorbank',  { name: 'Приорбанк',     defaultCurrency: 'BYN' }],
  ['mtbank',     { name: 'МТБанк',        defaultCurrency: 'BYN' }],
  // Kazakhstan
  ['kaspi',      { name: 'Kaspi Bank',    defaultCurrency: 'KZT' }],
  ['halyk',      { name: 'Halyk Bank',    defaultCurrency: 'KZT' }],
  ['jusan',      { name: 'Jusan Bank',    defaultCurrency: 'KZT' }],
  // Uzbekistan
  ['kapital',    { name: 'Kapitalbank',   defaultCurrency: 'UZS' }],
  ['click',      { name: 'Click',         defaultCurrency: 'UZS' }],
  // Georgia
  ['tbc',        { name: 'TBC Bank',      defaultCurrency: 'GEL' }],
  ['bog',        { name: 'Bank of Georgia', defaultCurrency: 'GEL' }],
  // Germany
  ['ing',        { name: 'ING',           defaultCurrency: 'EUR' }],
  ['n26',        { name: 'N26',           defaultCurrency: 'EUR' }],
  ['dkb',        { name: 'DKB',           defaultCurrency: 'EUR' }],
  ['commerzbank',{ name: 'Commerzbank',   defaultCurrency: 'EUR' }],
  ['postbank',   { name: 'Postbank',      defaultCurrency: 'EUR' }],
  // France / Spain
  ['bnp',        { name: 'BNP Paribas',   defaultCurrency: 'EUR' }],
  ['socgen',     { name: 'SocGen',        defaultCurrency: 'EUR' }],
  ['lcl',        { name: 'LCL',           defaultCurrency: 'EUR' }],
  ['caxia',      { name: 'CaixaBank',     defaultCurrency: 'EUR' }],
  ['bbva',       { name: 'BBVA',          defaultCurrency: 'EUR' }],
  ['santander',  { name: 'Santander',     defaultCurrency: 'EUR' }],
  // UK
  ['barclays',   { name: 'Barclays',      defaultCurrency: 'GBP' }],
  ['hsbc',       { name: 'HSBC',          defaultCurrency: 'GBP' }],
  ['lloyds',     { name: 'Lloyds',        defaultCurrency: 'GBP' }],
  ['monzo',      { name: 'Monzo',         defaultCurrency: 'GBP' }],
  ['starling',   { name: 'Starling',      defaultCurrency: 'GBP' }],
  ['natwest',    { name: 'NatWest',       defaultCurrency: 'GBP' }],
  // Poland
  ['pko',        { name: 'PKO BP',        defaultCurrency: 'PLN' }],
  ['mbank',      { name: 'mBank',         defaultCurrency: 'PLN' }],
  ['pekao',      { name: 'Pekao',         defaultCurrency: 'PLN' }],
  ['millennium', { name: 'Millennium',    defaultCurrency: 'PLN' }],
  // Switzerland / Austria
  ['ubs',        { name: 'UBS',           defaultCurrency: 'CHF' }],
  ['csbank',     { name: 'Credit Suisse', defaultCurrency: 'CHF' }],
  ['raiffeisen', { name: 'Raiffeisen',    defaultCurrency: 'EUR' }],
  // Scandinavia
  ['nordea',     { name: 'Nordea',        defaultCurrency: 'SEK' }],
  ['dnb',        { name: 'DNB',           defaultCurrency: 'NOK' }],
  ['seb',        { name: 'SEB',           defaultCurrency: 'SEK' }],
  ['handels',    { name: 'Handelsbanken', defaultCurrency: 'SEK' }],
  // USA
  ['chase',      { name: 'Chase',         defaultCurrency: 'USD' }],
  ['bofa',       { name: 'Bank of America', defaultCurrency: 'USD' }],
  ['wells',      { name: 'Wells Fargo',   defaultCurrency: 'USD' }],
  ['citi',       { name: 'Citibank',      defaultCurrency: 'USD' }],
  ['amex',       { name: 'Amex',          defaultCurrency: 'USD' }],
  // International / Online
  ['revolut',    { name: 'Revolut',       defaultCurrency: 'EUR' }],
  ['wise',       { name: 'Wise',          defaultCurrency: 'EUR' }],
  ['paypal',     { name: 'PayPal',        defaultCurrency: 'USD' }],
]);

// ─────────────────────────────────────────────────────────────
// Exchange preset allowlist (SEC-01)
// ─────────────────────────────────────────────────────────────

export const EXCHANGE_PRESETS: ReadonlyMap<string, string> = new Map([
  ['binance',   'Binance'],
  ['bybit',     'Bybit'],
  ['okx',       'OKX'],
  ['coinbase',  'Coinbase'],
  ['kraken',    'Kraken'],
  ['kucoin',    'KuCoin'],
  ['gateio',    'Gate.io'],
  ['htx',       'HTX'],
  ['bitget',    'Bitget'],
  ['mexc',      'MEXC'],
  ['bitfinex',  'Bitfinex'],
  ['gemini',    'Gemini'],
  ['cryptocom', 'Crypto.com'],
  ['bingx',     'BingX'],
  ['phemex',    'Phemex'],
  ['whitebit',  'WhiteBIT'],
  ['bitstamp',  'Bitstamp'],
  ['poloniex',  'Poloniex'],
  ['bitmart',   'BitMart'],
  ['coinex',    'CoinEx'],
  ['lbank',     'LBank'],
  ['deribit',   'Deribit'],
  ['ascendex',  'AscendEX'],
  ['xtcom',     'XT.com'],
  ['probit',    'ProBit'],
  ['upbit',     'Upbit'],
  ['bithumb',   'Bithumb'],
  ['huobi',     'Huobi'],
]);

// ─────────────────────────────────────────────────────────────
// Wallet preset allowlist (SEC-01)
// ─────────────────────────────────────────────────────────────

export const WALLET_PRESETS: ReadonlyMap<string, string> = new Map([
  ['metamask',   'MetaMask'],
  ['trust',      'Trust Wallet'],
  ['phantom',    'Phantom'],
  ['exodus',     'Exodus'],
  ['ledger',     'Ledger'],
  ['trezor',     'Trezor'],
  ['atomic',     'Atomic Wallet'],
  ['cbwallet',   'Coinbase Wallet'],
]);

// ─────────────────────────────────────────────────────────────
// Currency presets — split by asset class
// Banks/Cash → fiat only. Exchanges/Wallets → crypto only.
// Custom → all common currencies.
// ─────────────────────────────────────────────────────────────

/** Fiat currencies for banks and cash accounts (~30). */
export const FIAT_CURRENCY_PRESETS = [
  'USD', 'EUR', 'RUB', 'UAH', 'GBP', 'PLN',
  'CZK', 'HUF', 'RON', 'TRY', 'KZT', 'BYN',
  'GEL', 'UZS', 'SEK', 'NOK', 'DKK', 'CHF',
  'CAD', 'AUD', 'JPY', 'CNY', 'INR', 'AED',
  'SGD', 'HKD', 'BRL', 'ZAR', 'MXN', 'THB',
] as const;

/** Crypto currencies for exchanges and wallets (~18). */
export const CRYPTO_CURRENCY_PRESETS = [
  'USDT', 'BTC',  'ETH',  'BNB',  'SOL',  'USDC',
  'XRP',  'TRX',  'DOGE', 'ADA',  'DOT',  'AVAX',
  'TON',  'NEAR', 'ATOM', 'LTC',  'MATIC','DAI',
] as const;

/** Mixed currencies for custom account type. */
const CUSTOM_CURRENCY_PRESETS = ['USD', 'EUR', 'RUB', 'USDT', 'BTC', 'ETH'] as const;

// ─────────────────────────────────────────────────────────────
// Callback_data parsed type
// ─────────────────────────────────────────────────────────────

export type AccountOnboardCmd =
  | { cmd: 'type'; accountType: 'card' | 'cash' | 'exchange' | 'wallet' | 'custom' }
  | { cmd: 'bank_preset'; key: string; name: string; defaultCurrency: string }
  | { cmd: 'bank_custom' }
  | { cmd: 'exchange_preset'; key: string; name: string }
  | { cmd: 'exchange_custom' }
  | { cmd: 'wallet_preset'; key: string; name: string }
  | { cmd: 'wallet_custom' }
  | { cmd: 'currency'; code: string }
  | { cmd: 'currency_custom' }
  | { cmd: 'skip' }
  | { cmd: 'more' }
  | { cmd: 'done' }
  | { cmd: 'open' }    // Phase 1.37-UX: open full account type picker from start 2-button keyboard
  | { cmd: 'bank_page';     page: number } // Phase 2.2: pagination
  | { cmd: 'exchange_page'; page: number } // Phase 2.2
  | { cmd: 'fiat_page';     page: number } // Phase 2.2
  | { cmd: 'crypto_page';   page: number } // Phase 2.2
  | { cmd: 'bal_skip' }                    // Phase 2.2: skip initial balance
  | { cmd: 'fin' }                         // Phase 2.3: finish onboarding from type picker
  | { cmd: 'cus_ok' }                      // Phase 2.3: confirm fuzzy-matched name
  | { cmd: 'cus_keep' };                   // Phase 2.3: keep original typed name (reject suggestion)

// ─────────────────────────────────────────────────────────────
// Parser — SEC-01 allowlist
// ─────────────────────────────────────────────────────────────

const ACCOUNT_TYPES = new Set(['card', 'cash', 'exchange', 'wallet', 'custom'] as const);
const CURRENCY_CODE_RE = /^[A-Z]{1,10}$/;

/**
 * Parse and validate an account onboarding callback_data string.
 * Returns null for any unrecognised or malformed input (SEC-01 allowlist).
 *
 * All type values validated against hardcoded allowlist.
 * All exchange preset keys validated against EXCHANGE_PRESETS map.
 * Currency codes validated as /^[A-Z]{1,10}$/ (broader than st: to allow custom tokens).
 */
export function parseAccountCallback(data: string): AccountOnboardCmd | null {
  if (!data.startsWith('ac:')) return null;

  const parts = data.split(':');
  // parts[0] = 'ac'
  const sub = parts[1] ?? '';

  if (sub === 'skip') return { cmd: 'skip' };
  if (sub === 'more') return { cmd: 'more' };
  if (sub === 'done') return { cmd: 'done' };
  if (sub === 'fin')  return { cmd: 'fin' };   // Phase 2.3: finish onboarding from type picker
  if (sub === 'open') return { cmd: 'open' };  // Phase 1.37-UX: open type picker
  // Phase 2.3: smart name confirm/reject
  if (sub === 'cus') {
    const act = parts[2] ?? '';
    if (act === 'ok')   return { cmd: 'cus_ok' };
    if (act === 'keep') return { cmd: 'cus_keep' };
    return null;
  }

  if (sub === 'type') {
    const t = parts[2] ?? '';
    if (!ACCOUNT_TYPES.has(t as 'card')) return null;
    return { cmd: 'type', accountType: t as 'card' | 'cash' | 'exchange' | 'wallet' | 'custom' };
  }

  // Bank presets: ac:bnk:{key}
  if (sub === 'bnk') {
    const key = parts[2] ?? '';
    if (key === 'custom') return { cmd: 'bank_custom' };
    const info = BANK_PRESETS.get(key);
    if (!info) return null;
    return { cmd: 'bank_preset', key, name: info.name, defaultCurrency: info.defaultCurrency };
  }

  // Exchange presets: ac:xch:{key}
  if (sub === 'xch') {
    const key = parts[2] ?? '';
    if (key === 'custom') return { cmd: 'exchange_custom' };
    const name = EXCHANGE_PRESETS.get(key);
    if (!name) return null;
    return { cmd: 'exchange_preset', key, name };
  }

  // Wallet presets: ac:wal:{key}
  if (sub === 'wal') {
    const key = parts[2] ?? '';
    if (key === 'custom') return { cmd: 'wallet_custom' };
    const name = WALLET_PRESETS.get(key);
    if (!name) return null;
    return { cmd: 'wallet_preset', key, name };
  }

  if (sub === 'cur') {
    const code = parts[2] ?? '';
    if (code === 'custom') return { cmd: 'currency_custom' };
    if (!CURRENCY_CODE_RE.test(code)) return null;
    return { cmd: 'currency', code };
  }

  // Phase 2.2: pagination callbacks
  // ac:bp:{N}   → bank_page
  // ac:xp:{N}   → exchange_page
  // ac:cfp:{N}  → fiat_page
  // ac:ccp:{N}  → crypto_page
  // ac:bal:s    → bal_skip
  if (sub === 'bp') {
    const page = parseInt(parts[2] ?? '', 10);
    if (isNaN(page) || page < 0 || page > 99) return null;
    return { cmd: 'bank_page', page };
  }
  if (sub === 'xp') {
    const page = parseInt(parts[2] ?? '', 10);
    if (isNaN(page) || page < 0 || page > 99) return null;
    return { cmd: 'exchange_page', page };
  }
  if (sub === 'cfp') {
    const page = parseInt(parts[2] ?? '', 10);
    if (isNaN(page) || page < 0 || page > 99) return null;
    return { cmd: 'fiat_page', page };
  }
  if (sub === 'ccp') {
    const page = parseInt(parts[2] ?? '', 10);
    if (isNaN(page) || page < 0 || page > 99) return null;
    return { cmd: 'crypto_page', page };
  }
  if (sub === 'bal') {
    const act = parts[2] ?? '';
    if (act === 's') return { cmd: 'bal_skip' };
    return null;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Start keyboards
// ─────────────────────────────────────────────────────────────


/**
 * Phase 1.37-UX: Minimal 2-button keyboard for /start new user flow.
 * Replaces the 5-button keyboard to eliminate cognitive overload.
 *
 *   [➕ Добавить счёт]    → ac:open  → shows full account type picker (edit in-place)
 *   [▶️ Начать без счёта] → ac:skip  → dismiss, default account is already created
 *
 * ReplyKeyboard is NOT sent here — it activates after account creation or first confirmed tx.
 */
export function buildStartSimpleKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '➕ Добавить счёт',     callback_data: 'ac:open' },
        { text: '▶️ Начать без счёта', callback_data: 'ac:skip' },
      ],
    ],
  };
}

/**
 * Build the guided /start account type keyboard for new users.
 * Scenario Е from the roadmap — includes [⏩ Пропустить] button.
 * Used when user taps "Добавить счёт" from the start simple keyboard (ac:open).
 * Also used from /accounts empty-state (Scenario Д).
 */
export function buildStartOnboardKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '💳 Банковская карта', callback_data: 'ac:type:card' },
        { text: '💵 Наличные',         callback_data: 'ac:type:cash' },
      ],
      [
        { text: '🔄 Крипто-биржа',  callback_data: 'ac:type:exchange' },
        { text: '🔐 Крипто-кошелёк', callback_data: 'ac:type:wallet' },
      ],
      [{ text: '✏️ Своё название', callback_data: 'ac:type:custom' }],
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// Universal paginator (Phase 2.2)
// ─────────────────────────────────────────────────────────────

const DEFAULT_COLS = 3;
const DEFAULT_PER_PAGE = 6;

/**
 * Build a paginated InlineKeyboardMarkup for any list of items.
 *
 * Layout per page:
 *   Row 1..N : cols items each
 *   Nav row  : [◀️ Назад] [N/Total] [Вперёд ▶️]  (hidden if only 1 page)
 *   Last row : customLabel button
 *
 * @param items          Full list of {key, label} items
 * @param page           0-indexed current page
 * @param callbackPrefix Prefix for item callbacks, e.g. 'ac:bnk:'
 * @param pagePrefix     Prefix for page nav callbacks, e.g. 'ac:bp:'
 * @param customLabel    Label of the freeform button, e.g. '✏️ Другой банк'
 * @param customCallback callback_data for freeform button, e.g. 'ac:bnk:custom'
 * @param cols           Items per row (default 3)
 * @param perPage        Items per page (default 6)
 */
function buildPaginatedPicker(
  items: ReadonlyArray<{ key: string; label: string }>,
  page: number,
  callbackPrefix: string,
  pagePrefix: string,
  customLabel: string,
  customCallback: string,
  cols: number = DEFAULT_COLS,
  perPage: number = DEFAULT_PER_PAGE,
): InlineKeyboardMarkup {
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = items.slice(safePage * perPage, safePage * perPage + perPage);

  // Build item rows
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < pageItems.length; i += cols) {
    rows.push(
      pageItems.slice(i, i + cols).map((item) => ({
        text: item.label,
        callback_data: `${callbackPrefix}${item.key}`,
      })),
    );
  }

  // Navigation row (skip if only 1 page)
  if (totalPages > 1) {
    const navRow: Array<{ text: string; callback_data: string }> = [];
    if (safePage > 0) {
      navRow.push({ text: '◀️', callback_data: `${pagePrefix}${String(safePage - 1)}` });
    } else {
      navRow.push({ text: '·', callback_data: 'ac:noop' });
    }
    navRow.push({ text: `${String(safePage + 1)}/${String(totalPages)}`, callback_data: 'ac:noop' });
    if (safePage < totalPages - 1) {
      navRow.push({ text: '▶️', callback_data: `${pagePrefix}${String(safePage + 1)}` });
    } else {
      navRow.push({ text: '·', callback_data: 'ac:noop' });
    }
    rows.push(navRow);
  }

  // Custom (freeform) button always at the bottom
  rows.push([{ text: customLabel, callback_data: customCallback }]);

  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────────────────────
// Bank items list (derived from BANK_PRESETS)
// ─────────────────────────────────────────────────────────────

const BANK_ITEMS: ReadonlyArray<{ key: string; label: string }> = Array.from(BANK_PRESETS.entries()).map(
  ([key, info]) => ({ key, label: info.name }),
);

const EXCHANGE_ITEMS: ReadonlyArray<{ key: string; label: string }> = Array.from(EXCHANGE_PRESETS.entries()).map(
  ([key, name]) => ({ key, label: name }),
);

const FIAT_ITEMS: ReadonlyArray<{ key: string; label: string }> = FIAT_CURRENCY_PRESETS.map(
  (code) => ({ key: code, label: code }),
);

const CRYPTO_ITEMS: ReadonlyArray<{ key: string; label: string }> = CRYPTO_CURRENCY_PRESETS.map(
  (code) => ({ key: code, label: code }),
);

// ─────────────────────────────────────────────────────────────
// Paginated keyboard builders (Phase 2.2)
// ─────────────────────────────────────────────────────────────

/** Bank picker — paginated. page=0 is the first page. */
export function buildBankPickerPage(page: number): InlineKeyboardMarkup {
  return buildPaginatedPicker(
    BANK_ITEMS, page, 'ac:bnk:', 'ac:bp:', '\u270f\ufe0f Другой банк', 'ac:bnk:custom',
  );
}

/** Exchange picker — paginated. */
export function buildExchangePickerPage(page: number): InlineKeyboardMarkup {
  return buildPaginatedPicker(
    EXCHANGE_ITEMS, page, 'ac:xch:', 'ac:xp:', '\u270f\ufe0f Другая биржа', 'ac:xch:custom',
  );
}

/** Fiat currency picker — paginated. */
export function buildFiatCurrencyPage(page: number): InlineKeyboardMarkup {
  return buildPaginatedPicker(
    FIAT_ITEMS, page, 'ac:cur:', 'ac:cfp:', '\u270f\ufe0f Другая валюта', 'ac:cur:custom',
  );
}

/** Crypto currency picker — paginated. */
export function buildCryptoCurrencyPage(page: number): InlineKeyboardMarkup {
  return buildPaginatedPicker(
    CRYPTO_ITEMS, page, 'ac:cur:', 'ac:ccp:', '\u270f\ufe0f Другая валюта', 'ac:cur:custom',
  );
}

/** Bank picker keyboard (Phase 2.2 alias → page 0). */
export function buildBankPickerKeyboard(): InlineKeyboardMarkup {
  return buildBankPickerPage(0);
}

/** Account type keyboard — shown at /accounts empty-state and ac:open (Phase 2.2). */
export function buildAccountTypeKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '💳 Банковская карта', callback_data: 'ac:type:card' },
        { text: '💵 Наличные',         callback_data: 'ac:type:cash' },
      ],
      [
        { text: '🔄 Крипто-биржа',  callback_data: 'ac:type:exchange' },
        { text: '🔐 Крипто-кошелёк', callback_data: 'ac:type:wallet' },
      ],
      [{ text: '✏️ Своё название', callback_data: 'ac:type:custom' }],
    ],
  };
}

/**
 * Phase 2.3: Type picker shown immediately after account creation.
 * Confirms last account and offers to add another or finish.
 */
export function buildFinishOnboardKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '💳 Банковская карта', callback_data: 'ac:type:card' },
        { text: '💵 Наличные',         callback_data: 'ac:type:cash' },
      ],
      [
        { text: '🔄 Крипто-биржа',  callback_data: 'ac:type:exchange' },
        { text: '🔐 Крипто-кошелёк', callback_data: 'ac:type:wallet' },
      ],
      [{ text: '✏️ Своё название', callback_data: 'ac:type:custom' }],
      [{ text: '✅ Завершить',      callback_data: 'ac:fin' }],
    ],
  };
}

/**
 * Phase 2.3: Confirmation text shown after account creation — replaces afterCreate screen.
 * Displayed above buildFinishOnboardKeyboard.
 */
export function accountAddedText(name: string, currency: string): string {
  return `✅ <b>${name}</b> (${currency}) добавлен!\n\nДобавить ещё один счёт:`;
}

/** Exchange picker keyboard (Phase 2.2 alias → page 0). */
export function buildExchangePickerKeyboard(): InlineKeyboardMarkup {
  return buildExchangePickerPage(0);
}

/** Wallet picker keyboard (static — 8 presets, no pagination needed). */
export function buildWalletPickerKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: 'MetaMask',      callback_data: 'ac:wal:metamask' },
        { text: 'Trust Wallet',  callback_data: 'ac:wal:trust' },
        { text: 'Phantom',       callback_data: 'ac:wal:phantom' },
      ],
      [
        { text: 'Exodus',        callback_data: 'ac:wal:exodus' },
        { text: 'Ledger',        callback_data: 'ac:wal:ledger' },
        { text: 'Trezor',        callback_data: 'ac:wal:trezor' },
      ],
      [
        { text: 'Atomic Wallet', callback_data: 'ac:wal:atomic' },
        { text: 'CB Wallet',     callback_data: 'ac:wal:cbwallet' },
      ],
      [{ text: '✏️ Другой кошелёк', callback_data: 'ac:wal:custom' }],
    ],
  };
}

/** Fiat currency keyboard (Phase 2.2 alias → page 0). */
export function buildFiatCurrencyKeyboard(): InlineKeyboardMarkup {
  return buildFiatCurrencyPage(0);
}

/** Crypto currency keyboard (Phase 2.2 alias → page 0). */
export function buildCryptoCurrencyKeyboard(): InlineKeyboardMarkup {
  return buildCryptoCurrencyPage(0);
}

/**
 * Mixed currency picker — for custom account type.
 * Shows both fiat and crypto presets.
 */
export function buildOnboardCurrencyKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      CUSTOM_CURRENCY_PRESETS.slice(0, 3).map((code) => ({
        text: code,
        callback_data: `ac:cur:${code}`,
      })),
      CUSTOM_CURRENCY_PRESETS.slice(3, 6).map((code) => ({
        text: code,
        callback_data: `ac:cur:${code}`,
      })),
      [{ text: '✏️ Другая валюта', callback_data: 'ac:cur:custom' }],
    ],
  };
}

/**
 * Build the post-creation keyboard: add another or finish.
 */
export function buildAfterCreateKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '➕ Добавить ещё счёт', callback_data: 'ac:more' },
        { text: '✅ Готово',             callback_data: 'ac:done' },
      ],
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// Message text helpers
// ─────────────────────────────────────────────────────────────

/** Text for empty /accounts guided prompt (Scenario Д). */
export const ACCOUNTS_EMPTY_TEXT =
  '🏦 <b>У тебя пока нет счетов.</b>\n\n' +
  'Счёт — это место где хранятся деньги:\n' +
  'карта, кошелёк, биржа, наличные.\n\n' +
  'Создай первый счёт:';

/**
 * Phase 1.37-UX: Welcome text for new user /start — single message, no ReplyKeyboard.
 * Professional, product-grade copy. No examples, no instructions.
 */
export const START_WELCOME_TEXT =
  '👋 <b>Добро пожаловать в Midas!</b>\n\n' +
  'Ваш финансовый ассистент на базе ИИ готов к работе.\n\n' +
  '🏦 Укажите, где хранятся ваши деньги — это позволит вести\n' +
  'точный учёт баланса по каждому счёту.';

/** Text for /start new user guided prompt (Scenario Е). */
export const START_ONBOARD_TEXT =
  '🏦 <b>Где хранишь деньги?</b>\n' +
  'Добавь свои счета (можно несколько):';

/**
 * Phase 1.37-UX: Activation message sent with ReplyKeyboard after account creation.
 * Signals to user that setup is complete and navigation is now available.
 */
export const SETUP_COMPLETE_TEXT =
  '✅ <b>Всё готово!</b>\n\n' +
  'Опишите любую операцию — бот распознает сумму, категорию и тип автоматически.';

/**
 * Phase 2.3: Message shown after user taps «▶️ Начать без счёта» (ac:skip).
 * Variant D1 — action-first, mentions the auto-created default account.
 * Sent with ReplyKeyboard (buildMainMenuKeyboard) so nav panel activates.
 */
export const SKIP_COMPLETE_TEXT =
  '✅ <b>Готово. Можно начинать.</b>\n\n' +
  'Запишите первую операцию — просто напишите что потратили или получили:\n' +
  '<i>«кофе 350» · «зарплата 5000» · «перевод Максу 200»</i>\n\n' +
  'Midas распознает сумму, тип и категорию автоматически.\n\n' +
  '<b>Счёт по умолчанию:</b> 💼 Основной · USDT\n' +
  '<i>Добавить карты и биржи → 💰 Баланс</i>';

/** Text for exchange picker step. */
export const EXCHANGE_PICKER_TEXT = 'Какая биржа?';

/** Text for currency picker step. */
export const CURRENCY_PICKER_TEXT = 'В какой валюте?';

/** Prompt for free-text account name input. */
export function nameInputPrompt(accountType: string): string {
  const labels: Record<string, string> = {
    card:    '💳 Введите название банка:',
    wallet:  '₿ Введите название кошелька:',
    exchange: '🔶 Введите название биржи:',
    custom:  '✏️ Введите название счёта:',
  };
  return labels[accountType] ?? '✏️ Введите название счёта:';
}

/** Text for bank picker step. */
export const BANK_PICKER_TEXT = '💳 Выберите банк:';

/** Text for wallet picker step. */
export const WALLET_PICKER_TEXT = '₿ Выберите кошелёк:';

/** Prompt for free-text currency input. */
export const CURRENCY_INPUT_PROMPT =
  '💱 Введи код валюты (например: <i>SOL</i>, <i>MATIC</i>, <i>UAH</i>):';

// ─────────────────────────────────────────────────────────────
// Balance input step (Phase 2.2)
// ─────────────────────────────────────────────────────────────

/**
 * Prompt shown after account is created — asking for initial balance.
 * Includes ['⏩ Пропустить] button.
 */
export const BAL_INPUT_PROMPT =
  '💰 <b>Сколько сейчас на счёте?</b>\n\n' +
  'Напиши сумму цифрами, например: <i>15000</i>\n' +
  'Или пропусти — баланс можно синхронизировать позже.';

/**
 * Keyboard for the bal_input step.
 * Single button to skip balance input.
 * ac:bal:s → bal_skip → 8 bytes ✅
 */
export function buildSkipBalanceKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '⏩ Пропустить', callback_data: 'ac:bal:s' }],
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// Phase 2.3: Smart name matching engine
// ─────────────────────────────────────────────────────────────

/**
 * Result of a fuzzy account name match.
 * Score is 0–1; only matches above FUZZY_THRESHOLD are returned.
 */
export interface FuzzyAccountMatch {
  name: string;
  type: 'card' | 'cash' | 'exchange' | 'wallet';
  defaultCurrency: string;
  score: number;
}

/** Minimum confidence to surface a fuzzy suggestion. */
const FUZZY_THRESHOLD = 0.62;

/** Cyrillic → Latin transliteration table (Russian + Ukrainian). */
const CYR_LAT: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo',
  'ж':'zh','з':'z','и':'i','й':'j','к':'k','л':'l','м':'m',
  'н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
  'ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
  'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
  // Ukrainian
  'і':'i','ї':'yi','є':'ye','ґ':'g',
};

function transliterate(s: string): string {
  return s.toLowerCase().split('').map((c) => CYR_LAT[c] ?? c).join('');
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[\s\-_.,!?'"()]/g, '');
}

/** Levenshtein distance — O(m×n), safe for short strings. */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev_diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j]!;
      prev[j] = a[i - 1] === b[j - 1]
        ? prev_diag
        : 1 + Math.min(prev[j]!, prev[j - 1]!, prev_diag);
      prev_diag = temp;
    }
  }
  return prev[b.length]!;
}

/**
 * Compute match score (0–1) between user input and a preset key/name.
 * Checks: exact → substring → prefix → Levenshtein.
 */
function computeScore(norm: string, translit: string, key: string, nameLower: string): number {
  // Exact
  if (norm === key || translit === key) return 1.0;
  // Key contains input (min 3 chars to avoid noise)
  if (norm.length >= 3 && key.includes(norm)) return 0.92;
  if (translit.length >= 3 && key.includes(translit)) return 0.90;
  // Name contains input
  if (norm.length >= 3 && nameLower.includes(norm)) return 0.87;
  if (translit.length >= 3 && nameLower.includes(translit)) return 0.85;
  // Input contains key
  if (key.length >= 3 && norm.includes(key)) return 0.82;
  // Prefix match
  if (norm.length >= 3 && key.startsWith(norm)) return 0.80;
  if (translit.length >= 3 && key.startsWith(translit)) return 0.78;
  if (key.length >= 3 && norm.startsWith(key)) return 0.75;
  // Levenshtein (only for inputs ≥ 3 chars to avoid false positives)
  if (norm.length >= 3) {
    const d = levenshtein(norm, key);
    const s = 1 - d / Math.max(norm.length, key.length);
    if (s > FUZZY_THRESHOLD) return s;
    if (translit !== norm) {
      const dt = levenshtein(translit, key);
      const st = 1 - dt / Math.max(translit.length, key.length);
      if (st > FUZZY_THRESHOLD) return st;
    }
  }
  return 0;
}

/** Cash keyword patterns (RU/UK/EN). */
const CASH_KEYWORDS = [
  'наличн','наличк','налик','нал','cash','готівк','кэш','кеш','кэшь',
  'cash','moneta','монета',
];

/**
 * Phase 2.3: Fuzzy-match user's free-text input against all known presets.
 * Supports Russian, Ukrainian, English and transliterated input.
 * Returns the best match above FUZZY_THRESHOLD, or null.
 *
 * @param input   Raw text the user typed
 * @param typeFilter  Optional: restrict to one account type (for card/exchange/wallet custom flows)
 */
export function fuzzyMatchAccountName(
  input: string,
  typeFilter?: 'card' | 'exchange' | 'wallet',
): FuzzyAccountMatch | null {
  const norm = normalizeKey(input);
  const translit = transliterate(norm);
  if (norm.length < 2) return null;

  // Cash check (no typeFilter restriction — cash is universal)
  if (!typeFilter || typeFilter === 'card') {
    for (const kw of CASH_KEYWORDS) {
      if (norm.startsWith(kw) || kw.startsWith(norm) || norm.includes(kw)) {
        return { name: 'Наличные', type: 'cash', defaultCurrency: 'RUB', score: 0.88 };
      }
    }
  }

  let best: FuzzyAccountMatch | null = null;

  // Banks (card)
  if (!typeFilter || typeFilter === 'card') {
    for (const [key, info] of BANK_PRESETS.entries()) {
      const score = computeScore(norm, translit, key, normalizeKey(info.name));
      if (score > FUZZY_THRESHOLD && score > (best?.score ?? 0)) {
        best = { name: info.name, type: 'card', defaultCurrency: info.defaultCurrency, score };
      }
    }
  }

  // Exchanges
  if (!typeFilter || typeFilter === 'exchange') {
    for (const [key, name] of EXCHANGE_PRESETS.entries()) {
      const score = computeScore(norm, translit, key, normalizeKey(name));
      if (score > FUZZY_THRESHOLD && score > (best?.score ?? 0)) {
        best = { name, type: 'exchange', defaultCurrency: 'USDT', score };
      }
    }
  }

  // Wallets
  if (!typeFilter || typeFilter === 'wallet') {
    for (const [key, name] of WALLET_PRESETS.entries()) {
      const score = computeScore(norm, translit, key, normalizeKey(name));
      if (score > FUZZY_THRESHOLD && score > (best?.score ?? 0)) {
        best = { name, type: 'wallet', defaultCurrency: 'USDT', score };
      }
    }
  }

  return best;
}

// ─────────────────────────────────────────────────────────────
// Phase 2.3: Smart confirm UI
// ─────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  card:     '💳 Банковская карта',
  cash:     '💵 Наличные',
  exchange: '🔄 Крипто-биржа',
  wallet:   '🔐 Крипто-кошелёк',
};

const TYPE_EMOJI: Record<string, string> = {
  card: '🏦', cash: '💵', exchange: '📊', wallet: '🔐',
};

/**
 * Message shown when a fuzzy match is found.
 * Professional fintech style — clear, concise, no noise.
 */
export function buildSmartConfirmText(match: FuzzyAccountMatch): string {
  const emoji = TYPE_EMOJI[match.type] ?? '💼';
  const typeLabel = TYPE_LABELS[match.type] ?? match.type;
  return (
    `🔍 <b>Похоже, вы имели в виду:</b>\n\n` +
    `${emoji} <b>${match.name}</b>\n` +
    `Тип: ${typeLabel}\n` +
    `Валюта: ${match.defaultCurrency}\n\n` +
    `Подтвердите или введите другое название:`
  );
}

/**
 * Phase 2.3: Keyboard for the smart confirm step.
 *   [✅ Да, {name}]
 *   [✏️ Другое название]  [◀️ К типу счёта]
 *
 * ac:cus:ok   → 12 bytes ✅
 * ac:cus:keep → 15 bytes ✅
 * ac:open     → 7 bytes  ✅
 */
export function buildSmartConfirmKeyboard(suggestedName: string): InlineKeyboardMarkup {
  const preview = suggestedName.length > 28
    ? `${suggestedName.slice(0, 26)}…`
    : suggestedName;
  return {
    inline_keyboard: [
      [{ text: `✅ Да, ${preview}`, callback_data: 'ac:cus:ok' }],
      [
        { text: '✏️ Другое название', callback_data: 'ac:cus:keep' },
        { text: '◀️ К типу счёта',    callback_data: 'ac:open' },
      ],
    ],
  };
}
