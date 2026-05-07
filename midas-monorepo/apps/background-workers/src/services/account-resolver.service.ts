/**
 * Account Resolver Service — Phase 1.31 (background-workers)
 *
 * Resolves AI-extracted account_hint against workspace account_sources.
 * Used by the ai-parse worker (Option A) to decide which confirmation keyboard
 * to send: standard approve/reject or inline account creation.
 *
 * Contains a self-contained Jaro-Winkler implementation to avoid cross-app
 * dependency on telegram-bot's account-fuzzy.service.ts.
 *
 * SEC-01: account_hint is Zod-validated before reaching this module (max 100 chars).
 * SEC-03: All DB queries run inside withTenantTransaction for RLS isolation.
 * SEC-12: Account names NOT logged.
 */

import { withTenantTransaction } from '@midas/database';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface AccountRow {
  id: string;
  name: string;
  currency: string;
}

export type AccountResolution =
  | { kind: 'exact';  accountId: string; accountName: string }
  | { kind: 'fuzzy';  accountId: string; accountName: string; score: number }
  | { kind: 'none' };

// ─────────────────────────────────────────────────────────────
// Jaro-Winkler (inline — no new deps)
// ─────────────────────────────────────────────────────────────

function jaroSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
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
        aMatched[i] = true; bMatched[j] = true; matches++; break;
      }
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0, k = 0;
  for (let i = 0; i < la; i++) {
    if (aMatched[i]) {
      while (!bMatched[k]) k++;
      if (a[i] !== b[k]) transpositions++;
      k++;
    }
  }
  return (matches / la + matches / lb + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinkler(a: string, b: string): number {
  const jaro = jaroSimilarity(a, b);
  const maxP = Math.min(4, Math.min(a.length, b.length));
  let prefix = 0;
  for (let i = 0; i < maxP; i++) {
    if (a[i] === b[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

const FUZZY_THRESHOLD = 0.85;
const SHORT_TICKER_MAX_LEN = 3;

// ─────────────────────────────────────────────────────────────
// resolveAccountFromHint — DB query + fuzzy match
// ─────────────────────────────────────────────────────────────

/**
 * Fetch workspace accounts and resolve an AI-extracted account_hint.
 *
 * Returns AccountResolution:
 *   exact  — hint matches an existing account exactly
 *   fuzzy  — hint matches closely (Jaro-Winkler ≥ 0.85) for hint.length ≥ 4
 *   none   — no match found; caller should show inline create keyboard
 *
 * SEC-03: DB query inside withTenantTransaction.
 * SEC-12: Names NOT logged.
 */
export async function resolveAccountFromHint(
  workspaceId: string,
  userId: string,
  hint: string,
): Promise<AccountResolution> {
  if (!hint || hint.trim().length === 0) return { kind: 'none' };

  const accounts = await withTenantTransaction<AccountRow[]>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<AccountRow>(
        `SELECT id, name, currency FROM account_sources WHERE workspace_id = $1 ORDER BY name`,
        [workspaceId],
      );
      return result.rows;
    },
  );

  const normHint = hint.trim().toLowerCase();

  // Exact match
  for (const acc of accounts) {
    if (acc.name.trim().toLowerCase() === normHint) {
      return { kind: 'exact', accountId: acc.id, accountName: acc.name };
    }
  }

  // Short ticker — exact only
  if (normHint.length <= SHORT_TICKER_MAX_LEN) return { kind: 'none' };

  // Fuzzy match
  let bestScore = 0, bestAcc: AccountRow | null = null;
  for (const acc of accounts) {
    const score = jaroWinkler(normHint, acc.name.trim().toLowerCase());
    if (score > bestScore) { bestScore = score; bestAcc = acc; }
  }

  if (bestScore >= FUZZY_THRESHOLD && bestAcc !== null) {
    return { kind: 'fuzzy', accountId: bestAcc.id, accountName: bestAcc.name, score: bestScore };
  }

  return { kind: 'none' };
}
