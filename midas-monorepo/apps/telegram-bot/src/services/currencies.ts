/**
 * Currency Constants — Phase 1.26
 *
 * Static list of supported currencies grouped by type.
 * Used by the /settings UI inline keyboard.
 *
 * Source: common crypto/fiat knowledge. No external API required.
 * Validation: all codes match ^[A-Z]{3,5}$ (account_sources CHECK constraint).
 *
 * Design:
 *   - Stablecoins: kept short — all fit in a single keyboard page (no pagination).
 *   - Crypto: paginated (PAGE_SIZE = 12 per page).
 *   - Fiat: paginated (PAGE_SIZE = 12 per page).
 *   - Groups are mutually exclusive (no duplicates across groups).
 *
 * Phase 1.27+ note:
 *   Currency name lookup (e.g. "SOL → Solana") is available via CURRENCY_NAMES map
 *   for display purposes in confirmation messages.
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
// Optional human-readable names for confirmation messages
// ─────────────────────────────────────────────────────────────

export const CURRENCY_NAMES: Readonly<Record<string, string>> = {
  USDT: 'Tether',    USDC: 'USD Coin',  DAI:  'Dai',
  BUSD: 'BUSD',      TUSD: 'TrueUSD',   FDUSD:'First Digital USD',
  PYUSD:'PayPal USD',USDE: 'Ethena USDe',USDD:'USDD', GUSD: 'Gemini USD',
  FRAX: 'Frax',      LUSD: 'Liquity USD',
  BTC:  'Bitcoin',   ETH:  'Ethereum',   BNB:  'BNB',
  SOL:  'Solana',    TON:  'Toncoin',    TRX:  'TRON',
  XRP:  'XRP',       ADA:  'Cardano',    DOGE: 'Dogecoin',
  AVAX: 'Avalanche', DOT:  'Polkadot',   MATIC:'Polygon',
  LTC:  'Litecoin',  BCH:  'Bitcoin Cash',LINK:'Chainlink',
  UNI:  'Uniswap',   ATOM: 'Cosmos',     FIL:  'Filecoin',
  VET:  'VeChain',   ICP:  'Internet Computer',
  USD:  'US Dollar', EUR:  'Euro',        RUB:  'Russian Ruble',
  GBP:  'Pound Sterling', CNY: 'Chinese Yuan', JPY: 'Japanese Yen',
  AED:  'UAE Dirham', KZT: 'Kazakhstani Tenge', TRY: 'Turkish Lira',
  INR:  'Indian Rupee', BRL: 'Brazilian Real', SGD: 'Singapore Dollar',
  HKD:  'Hong Kong Dollar', CHF: 'Swiss Franc',
};

// ─────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────

/**
 * Search currencies by code prefix or name substring.
 *
 * @param query - raw user input (case-insensitive)
 * @returns up to 8 matching currency codes
 *
 * Security: purely local search, no DB/network call, no injection risk.
 */
export function searchCurrencies(query: string): string[] {
  const q = query.trim().toUpperCase();
  if (q.length === 0) return [];
  const results: string[] = [];
  for (const code of ALL_CURRENCIES) {
    const nameMatch = (CURRENCY_NAMES[code] ?? '').toUpperCase().includes(q);
    if (code.startsWith(q) || nameMatch) {
      results.push(code);
      if (results.length >= 8) break;
    }
  }
  return results;
}
