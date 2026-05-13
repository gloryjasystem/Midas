/**
 * Account Currency Validator — Phase 2.5
 *
 * Enforces technical feasibility rules:
 * bank cards and cash can ONLY hold fiat currencies.
 * Crypto belongs only on exchanges, crypto wallets, and hybrid e-wallets.
 *
 * Rules matrix:
 *   card / cash          → fiat only
 *   exchange             → any (fiat + crypto + stablecoin)
 *   wallet / crypto      → crypto + stablecoin only
 *   wallet / ewallet     → fiat only (unless provider is hybrid: Payeer, AdvCash, etc.)
 *   wallet / ewallet (hybrid) → fiat + stablecoin (no raw crypto like BTC/ETH)
 *   wallet / ton         → TON ecosystem
 *   wallet / lightning   → BTC only
 *   custom               → any
 *
 * SEC-12: No currency codes or account names logged.
 */

import { FIAT_CURRENCY_PRESETS, CRYPTO_CURRENCY_PRESETS } from './account-onboard-keyboard.service.js';

// ─────────────────────────────────────────────────────────────
// Currency classification
// ─────────────────────────────────────────────────────────────

/** Well-known stablecoins (subset of CRYPTO_CURRENCY_PRESETS). */
const STABLECOINS = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP']);

/** All known fiat codes. */
const FIAT_SET = new Set<string>(FIAT_CURRENCY_PRESETS);

/** All known crypto codes (includes stablecoins). */
const CRYPTO_SET = new Set<string>(CRYPTO_CURRENCY_PRESETS);

export type CurrencyClass = 'fiat' | 'stablecoin' | 'crypto';

/**
 * Classify a currency code.
 * Unknown codes are treated as 'crypto' (safer default — prevents bank+unknown).
 */
export function classifyCurrency(code: string): CurrencyClass {
  const upper = code.toUpperCase();
  if (FIAT_SET.has(upper)) return 'fiat';
  if (STABLECOINS.has(upper)) return 'stablecoin';
  if (CRYPTO_SET.has(upper)) return 'crypto';
  // Unknown code: if purely alphabetic and ≤5 chars it might be a fiat (e.g. "XOF"),
  // otherwise treat as crypto for safety.
  return /^[A-Z]{2,5}$/.test(upper) ? 'fiat' : 'crypto';
}

// ─────────────────────────────────────────────────────────────
// Hybrid e-wallet providers (support stablecoins alongside fiat)
// ─────────────────────────────────────────────────────────────

/**
 * E-wallet provider keys that support stablecoins (USDT/USDC) in addition to fiat.
 * Source: official product pages for each provider.
 */
const HYBRID_EWALLET_KEYS = new Set([
  'payeer',
  'advcash',
  'perfectmoney',
  'volet',
  'capitalist',
  'webmoney',
  'neteller',
  'skrill',
  'payoneer',
]);

// ─────────────────────────────────────────────────────────────
// TON ecosystem assets
// ─────────────────────────────────────────────────────────────

const TON_ASSETS = new Set(['TON', 'USDT', 'BTC', 'ETH', 'NOT', 'DOGS', 'USDC', 'STON']);

// ─────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────

export type ValidationResult =
  | { valid: true }
  | { valid: false; errorMessage: string };

/**
 * Validate that a currency is compatible with the given account type.
 *
 * @param accountType  - 'card' | 'cash' | 'exchange' | 'wallet' | 'custom'
 * @param walletSubtype - 'crypto' | 'ewallet' | 'ton' | 'lightning' | undefined
 * @param providerKey  - lowercase provider key (e.g. 'mono', 'payeer') or undefined
 * @param currency     - currency code to validate (e.g. 'USDT', 'USD', 'BTC')
 */
export function validateAccountCurrency(
  accountType: string | undefined,
  walletSubtype: string | undefined,
  providerKey: string | undefined,
  currency: string,
): ValidationResult {
  const cur = currency.toUpperCase();
  const cls = classifyCurrency(cur);
  const type = accountType ?? 'custom';

  // ── card / cash: fiat only ────────────────────────────────
  if (type === 'card' || type === 'cash') {
    if (cls !== 'fiat') {
      const typeName = type === 'card' ? 'Банковские карты' : 'Наличные';
      return {
        valid: false,
        errorMessage:
          `❌ ${typeName} хранят только фиат (USD, EUR, RUB и другие).\n\n` +
          `Для <b>${cur}</b> создайте счёт типа <b>Биржа</b> или <b>Кошелёк</b>.`,
      };
    }
    return { valid: true };
  }

  // ── exchange: any currency allowed ───────────────────────
  if (type === 'exchange') {
    return { valid: true };
  }

  // ── wallet subtypes ───────────────────────────────────────
  if (type === 'wallet') {
    // Lightning: BTC only
    if (walletSubtype === 'lightning') {
      if (cur !== 'BTC' && cur !== 'SATS') {
        return {
          valid: false,
          errorMessage:
            `❌ Lightning-кошельки работают только с <b>BTC</b> (и SATS).\n\n` +
            `Для ${cur} создайте крипто-кошелёк или биржу.`,
        };
      }
      return { valid: true };
    }

    // TON ecosystem
    if (walletSubtype === 'ton') {
      if (!TON_ASSETS.has(cur)) {
        return {
          valid: false,
          errorMessage:
            `❌ TON-кошельки поддерживают активы экосистемы TON: TON, USDT, BTC, ETH, NOT, DOGS.\n\n` +
            `Для ${cur} создайте отдельный крипто-кошелёк или биржу.`,
        };
      }
      return { valid: true };
    }

    // E-wallet
    if (walletSubtype === 'ewallet') {
      const isHybrid = providerKey ? HYBRID_EWALLET_KEYS.has(providerKey.toLowerCase()) : false;

      if (isHybrid) {
        // Hybrid: fiat + stablecoin OK, raw crypto (BTC/ETH) blocked
        if (cls === 'crypto' && !STABLECOINS.has(cur)) {
          return {
            valid: false,
            errorMessage:
              `❌ Этот кошелёк поддерживает фиат и стейблкоины (USDT, USDC), ` +
              `но не криптовалюту ${cur}.\n\n` +
              `Для ${cur} создайте <b>Крипто-кошелёк</b> или <b>Биржу</b>.`,
          };
        }
        return { valid: true };
      }

      // Standard e-wallet: fiat only
      if (cls !== 'fiat') {
        return {
          valid: false,
          errorMessage:
            `❌ Электронные кошельки хранят только фиат (USD, EUR, RUB и другие).\n\n` +
            `Для <b>${cur}</b> создайте счёт типа <b>Биржа</b> или <b>Крипто-кошелёк</b>.`,
        };
      }
      return { valid: true };
    }

    // wallet/crypto: crypto + stablecoin only
    if (cls === 'fiat') {
      return {
        valid: false,
        errorMessage:
          `❌ Крипто-кошельки хранят криптовалюту и стейблкоины, а не фиат.\n\n` +
          `Для <b>${cur}</b> создайте счёт типа <b>Банк</b> или <b>Наличные</b>.`,
      };
    }
    return { valid: true };
  }

  // ── custom: any allowed ───────────────────────────────────
  return { valid: true };
}
