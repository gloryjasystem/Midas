/**
 * Account Fuzzy Matching Service — Phase 1.31
 *
 * Resolves an AI-extracted account_hint against a workspace's account_sources list.
 *
 * Matching rules (from Phase 1.31 advisory):
 *   1. Exact case-insensitive match → resolve silently (no keyboard shown).
 *   2. Short hint (trimmed length ≤ 3, e.g. BTC, SOL, ETH) → exact-only.
 *      Fuzzy disabled to prevent false positives between short tickers.
 *   3. Hint length ≥ 4 + Jaro-Winkler similarity ≥ 0.85 → fuzzy match.
 *      Returns best match; caller shows confirmation keyboard.
 *   4. No match → caller shows inline account creation keyboard.
 *
 * No external npm dependencies. Jaro-Winkler implemented inline (~50 lines).
 *
 * SEC-01: hint is Zod-validated before reaching this service; max 100 chars.
 * SEC-02: No financial amounts involved.
 * SEC-12: account names NOT logged (user PII context).
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface AccountRecord {
  id: string;
  name: string;
  currency: string;
}

export type FuzzyResult =
  | { kind: 'exact';   account: AccountRecord }
  | { kind: 'fuzzy';   account: AccountRecord; score: number }
  | { kind: 'none' };

// ─────────────────────────────────────────────────────────────
// Jaro-Winkler similarity — pure implementation, no deps
// Returns a value in [0, 1]. 1.0 = identical strings.
// ─────────────────────────────────────────────────────────────

function jaroSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;

  const matchRange = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const aMatched = new Array<boolean>(la).fill(false);
  const bMatched = new Array<boolean>(lb).fill(false);

  let matches = 0;
  for (let i = 0; i < la; i++) {
    const start = Math.max(0, i - matchRange);
    const end   = Math.min(i + matchRange + 1, lb);
    for (let j = start; j < end; j++) {
      if (!bMatched[j] && a[i] === b[j]) {
        aMatched[i] = true;
        bMatched[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (aMatched[i]) {
      while (!bMatched[k]) k++;
      if (a[i] !== b[k]) transpositions++;
      k++;
    }
  }

  return (matches / la + matches / lb + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinklerSimilarity(a: string, b: string, p = 0.1): number {
  const jaro = jaroSimilarity(a, b);
  const maxPrefix = Math.min(4, Math.min(a.length, b.length));
  let prefix = 0;
  for (let i = 0; i < maxPrefix; i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * p * (1 - jaro);
}

// ─────────────────────────────────────────────────────────────
// FUZZY_THRESHOLD: minimum Jaro-Winkler score to consider a match.
// 0.85 is the threshold from the Phase 1.31 advisory.
// ─────────────────────────────────────────────────────────────

const FUZZY_THRESHOLD = 0.85;

// ─────────────────────────────────────────────────────────────
// SHORT_TICKER_MAX_LEN: hints of this length or shorter use exact-only.
// Prevents BTC ≈ BCH/ETH false positives from fuzzy matching.
// ─────────────────────────────────────────────────────────────

const SHORT_TICKER_MAX_LEN = 3;

// ─────────────────────────────────────────────────────────────
// resolveAccountHint
// ─────────────────────────────────────────────────────────────

/**
 * Match an AI-extracted account hint against a list of workspace accounts.
 *
 * @param hint     - Account name hint from AI (Zod-validated, max 100 chars)
 * @param accounts - All account_sources rows for the workspace
 * @returns FuzzyResult: exact | fuzzy | none
 */
export function resolveAccountHint(
  hint: string,
  accounts: AccountRecord[],
): FuzzyResult {
  if (accounts.length === 0 || hint.trim().length === 0) return { kind: 'none' };

  const normHint = hint.trim().toLowerCase();

  // ── 1. Exact case-insensitive match ───────────────────────────────────────
  for (const account of accounts) {
    if (account.name.trim().toLowerCase() === normHint) {
      return { kind: 'exact', account };
    }
  }

  // ── 2. Short ticker rule: exact-only for len ≤ 3 ─────────────────────────
  if (normHint.length <= SHORT_TICKER_MAX_LEN) {
    return { kind: 'none' };
  }

  // ── 3. Fuzzy match for len ≥ 4 ───────────────────────────────────────────
  let bestScore = 0;
  let bestAccount: AccountRecord | null = null;

  for (const account of accounts) {
    const normName = account.name.trim().toLowerCase();
    const score = jaroWinklerSimilarity(normHint, normName);
    if (score > bestScore) {
      bestScore = score;
      bestAccount = account;
    }
  }

  if (bestScore >= FUZZY_THRESHOLD && bestAccount !== null) {
    return { kind: 'fuzzy', account: bestAccount, score: bestScore };
  }

  return { kind: 'none' };
}
