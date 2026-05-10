/**
 * Currency Constants — Phase 1.26 / Phase 2.1
 *
 * Static list of supported currencies grouped by type.
 * Used by the /settings UI inline keyboard.
 *
 * Source: common crypto/fiat knowledge. No external API required.
 * Validation: all codes match ^[A-Z]{3,5}$ (account_sources CHECK constraint).
 *
 * Phase 2.1 improvements:
 *   - Russian names added for all major currencies
 *   - searchCurrencies now supports: partial code match (includes),
 *     English name substring, Russian name substring
 *   - Returns up to 10 results (was 8)
 */

// ─────────────────────────────────────────────────────────────
// Currency groups
// ─────────────────────────────────────────────────────────────

/** Stablecoins — displayed all at once (≤ 16 items, 4 per row, no pagination). */
export const STABLECOINS: readonly string[] = [
  'USDT', 'USDC', 'DAI',  'BUSD',
  'TUSD', 'FDUSD','PYUSD','USDE',
  'USDD', 'GUSD', 'FRAX', 'LUSD',
];

/** Major cryptocurrencies — paginated. */
export const CRYPTO: readonly string[] = [
  'BTC',  'ETH',  'BNB',   'SOL',
  'TON',  'TRX',  'XRP',   'ADA',
  'DOGE', 'AVAX', 'DOT',   'MATIC',
  'LTC',  'BCH',  'LINK',  'UNI',
  'ATOM', 'FIL',  'VET',   'ICP',
  'ETC',  'ALGO', 'FLOW',  'EGLD',
  'THETA','SAND', 'MANA',  'AXS',
  'SHIB', 'NEAR', 'FTM',   'HBAR',
  'ONE',  'ZEC',  'DASH',  'XMR',
  'WAVES','KAVA', 'CELO',  'ICX',
  'IOTA', 'QTUM', 'ZIL',   'BAT',
  'HNT',  'GRT',  'COMP',  'MKR',
];

/** Fiat currencies — paginated. */
export const FIAT: readonly string[] = [
  'USD',  'EUR',  'RUB',  'GBP',
  'CNY',  'JPY',  'AED',  'KZT',
  'TRY',  'INR',  'BRL',  'MXN',
  'SGD',  'HKD',  'CHF',  'SEK',
  'NOK',  'DKK',  'PLN',  'CZK',
  'HUF',  'RON',  'BGN',  'HRK',
  'UAH',  'GEL',  'BYN',  'AMD',
  'AZN',  'UZS',  'KGS',  'TJS',
  'IDR',  'MYR',  'PHP',  'THB',
  'VND',  'NGN',  'ZAR',  'EGP',
];

/** Union type for currency group identifiers used in callback_data. */
export type CurrencyGroup = 'stable' | 'crypto' | 'fiat';

/** Map group → array. */
export const CURRENCY_GROUPS: Record<CurrencyGroup, readonly string[]> = {
  stable: STABLECOINS,
  crypto: CRYPTO,
  fiat:   FIAT,
};

/** Display labels for each group. */
export const GROUP_LABELS: Record<CurrencyGroup, string> = {
  stable: '💵 Стейблкоины',
  crypto: '₿ Криптовалюты',
  fiat:   '🏦 Фиат',
};

/** Page size for paginated groups (crypto / fiat). */
export const PAGE_SIZE = 12;

// ─────────────────────────────────────────────────────────────
// All codes — flat set for validation
// ─────────────────────────────────────────────────────────────

/** Full set of all supported currency codes (across all groups). */
export const ALL_CURRENCIES: ReadonlySet<string> = new Set([
  ...STABLECOINS,
  ...CRYPTO,
  ...FIAT,
]);

// ─────────────────────────────────────────────────────────────
// Human-readable names — English + Russian
// ─────────────────────────────────────────────────────────────

export const CURRENCY_NAMES: Readonly<Record<string, string>> = {
  // Stablecoins
  USDT: 'Tether',           USDC: 'USD Coin',         DAI:  'Dai',
  BUSD: 'BUSD',             TUSD: 'TrueUSD',          FDUSD:'First Digital USD',
  PYUSD:'PayPal USD',       USDE: 'Ethena USDe',      USDD: 'USDD',
  GUSD: 'Gemini USD',       FRAX: 'Frax',             LUSD: 'Liquity USD',

  // Crypto
  BTC:  'Bitcoin',          ETH:  'Ethereum',         BNB:  'BNB',
  SOL:  'Solana',           TON:  'Toncoin',          TRX:  'TRON',
  XRP:  'XRP Ripple',       ADA:  'Cardano',          DOGE: 'Dogecoin',
  AVAX: 'Avalanche',        DOT:  'Polkadot',         MATIC:'Polygon',
  LTC:  'Litecoin',         BCH:  'Bitcoin Cash',     LINK: 'Chainlink',
  UNI:  'Uniswap',          ATOM: 'Cosmos',           FIL:  'Filecoin',
  VET:  'VeChain',          ICP:  'Internet Computer',
  ETC:  'Ethereum Classic', ALGO: 'Algorand',         EGLD: 'MultiversX',
  THETA:'Theta Network',    SAND: 'The Sandbox',      MANA: 'Decentraland',
  AXS:  'Axie Infinity',    SHIB: 'Shiba Inu',        NEAR: 'NEAR Protocol',
  FTM:  'Fantom',           HBAR: 'Hedera',           ZEC:  'Zcash',
  DASH: 'Dash',             XMR:  'Monero',           WAVES:'Waves',
  KAVA: 'Kava',             CELO: 'Celo',             ICX:  'ICON',
  IOTA: 'IOTA',             QTUM: 'Qtum',             ZIL:  'Zilliqa',
  BAT:  'Basic Attention',  HNT:  'Helium',           GRT:  'The Graph',
  COMP: 'Compound',         MKR:  'Maker',            FLOW: 'Flow',

  // Fiat
  USD:  'US Dollar',        EUR:  'Euro',             RUB:  'Russian Ruble',
  GBP:  'British Pound',    CNY:  'Chinese Yuan',     JPY:  'Japanese Yen',
  AED:  'UAE Dirham',       KZT:  'Kazakhstani Tenge',TRY:  'Turkish Lira',
  INR:  'Indian Rupee',     BRL:  'Brazilian Real',   MXN:  'Mexican Peso',
  SGD:  'Singapore Dollar', HKD:  'Hong Kong Dollar', CHF:  'Swiss Franc',
  SEK:  'Swedish Krona',    NOK:  'Norwegian Krone',  DKK:  'Danish Krone',
  PLN:  'Polish Zloty',     CZK:  'Czech Koruna',     HUF:  'Hungarian Forint',
  RON:  'Romanian Leu',     BGN:  'Bulgarian Lev',    HRK:  'Croatian Kuna',
  UAH:  'Ukrainian Hryvnia',GEL:  'Georgian Lari',    BYN:  'Belarusian Ruble',
  AMD:  'Armenian Dram',    AZN:  'Azerbaijani Manat',UZS:  'Uzbekistani Som',
  KGS:  'Kyrgyzstani Som',  TJS:  'Tajikistani Somoni',
  IDR:  'Indonesian Rupiah',MYR:  'Malaysian Ringgit',PHP:  'Philippine Peso',
  THB:  'Thai Baht',        VND:  'Vietnamese Dong',  NGN:  'Nigerian Naira',
  ZAR:  'South African Rand',EGP: 'Egyptian Pound',
};

/**
 * Russian-language aliases for currency search.
 * Maps lowercase Russian search terms → currency codes.
 * Supports partial substring matching in searchCurrencies.
 */
export const CURRENCY_RU_ALIASES: Readonly<Record<string, string>> = {
  // Crypto (Russian names/transliterations)
  'биткоин':    'BTC',  'битк':       'BTC',  'биткойн':    'BTC',
  'эфириум':    'ETH',  'эфир':       'ETH',  'ethereum':   'ETH',
  'солана':     'SOL',  'солан':      'SOL',
  'тон':        'TON',  'тонкоин':    'TON',
  'трон':       'TRX',
  'рипл':       'XRP',  'рипплe':     'XRP',
  'кардано':    'ADA',
  'доджкоин':   'DOGE', 'додж':       'DOGE',
  'лайткоин':   'LTC',  'лайт':       'LTC',
  'полигон':    'MATIC','матик':       'MATIC',
  'монеро':     'XMR',
  'дэш':        'DASH',

  // Stablecoins
  'тезер':      'USDT', 'тетер':      'USDT',
  'долларовый': 'USDT',

  // Fiat (Russian names)
  'доллар':     'USD',  'долл':       'USD',  'баксы':      'USD',
  'бакс':       'USD',
  'евро':       'EUR',  'еврo':       'EUR',
  'рубль':      'RUB',  'рубл':       'RUB',  'руб':        'RUB',
  'фунт':       'GBP',  'стерлинг':   'GBP',
  'юань':       'CNY',  'рмб':        'CNY',
  'йена':       'JPY',  'иена':       'JPY',
  'дирхам':     'AED',
  'тенге':      'KZT',
  'лира':       'TRY',
  'рупия':      'INR',
  'реал':       'BRL',  'бразильск':  'BRL',
  'франк':      'CHF',  'швейц':      'CHF',
  'крона':      'SEK',  'шведск':     'SEK',  'норвеж':     'NOK',  'датск': 'DKK',
  'злотый':     'PLN',  'польск':     'PLN',
  'гривна':     'UAH',  'гривен':     'UAH',  'грн':        'UAH',
  'лари':       'GEL',  'грузинск':   'GEL',
  'белорусск':  'BYN',  'бел руб':    'BYN',
  'манат':      'AZN',  'азербайдж':  'AZN',
  'сом':        'KGS',  'кыргызск':   'KGS',
  'сомони':     'TJS',  'таджикск':   'TJS',
  'дирхамов':   'AED',
};

// ─────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────

/**
 * Search currencies by code (partial), English name (substring), or Russian alias.
 *
 * Algorithm (in priority order):
 *   1. Code exact match (e.g. "BTC" → BTC first)
 *   2. Code starts with query (e.g. "BT" → BTC)
 *   3. Code contains query (e.g. "TC" → BTC)
 *   4. English name contains query (e.g. "bitcoin" → BTC)
 *   5. Russian alias contains query (e.g. "биткоин" → BTC)
 *
 * @param rawQuery - raw user input (any case, any language)
 * @returns up to 10 matching currency codes, deduplicated
 *
 * Security: purely local search, no DB/network call, no injection risk.
 */
export function searchCurrencies(rawQuery: string): string[] {
  const q = (rawQuery ?? '').trim().toUpperCase();
  const qRu = (rawQuery ?? '').trim().toLowerCase();
  if (q.length === 0) return [];

  const seen = new Set<string>();
  const results: string[] = [];
  const MAX_RESULTS = 10;

  function add(code: string): boolean {
    if (seen.has(code)) return false;
    if (!ALL_CURRENCIES.has(code)) return false;
    seen.add(code);
    results.push(code);
    return results.length < MAX_RESULTS;
  }

  // Pass 1: exact code match
  if (ALL_CURRENCIES.has(q)) add(q);
  if (results.length >= MAX_RESULTS) return results;

  // Pass 2: code starts with query
  for (const code of ALL_CURRENCIES) {
    if (code.startsWith(q)) { if (!add(code)) return results; }
  }

  // Pass 3: code contains query (partial)
  for (const code of ALL_CURRENCIES) {
    if (code.includes(q) && !code.startsWith(q)) { if (!add(code)) return results; }
  }

  // Pass 4: English name substring
  for (const code of ALL_CURRENCIES) {
    const name = (CURRENCY_NAMES[code] ?? '').toUpperCase();
    if (name.includes(q)) { if (!add(code)) return results; }
  }

  // Pass 5: Russian alias substring
  for (const [alias, code] of Object.entries(CURRENCY_RU_ALIASES)) {
    if (alias.includes(qRu)) { if (!add(code)) return results; }
  }

  return results;
}
