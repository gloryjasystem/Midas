/**
 * Balance Service — Phase 1.21 / Phase 1.27
 *
 * Generates a per-account balance report for a workspace.
 *
 * Design (docs/balance-semantics.md — all D1–D6 approved by owner 2026-05-07):
 *
 *   D1  Sign rule per intent (all base_amount values are strictly positive):
 *         expense       → −1  (money leaves account)
 *         income        → +1  (money enters account)
 *         debt_given    → −1  (cash lent, leaves account; D2 = integrated)
 *         debt_received → +1  (cash received, enters account; D2 = integrated)
 *         transfer      → neutral (D3 = excluded from sum, shown as footnote)
 *
 *   D2  Debt integrated into balance (not shown as separate section).
 *   D3  Transfer excluded from balance sum; shown as informational footnote.
 *   D4  initial_balance NUMERIC(19,4) NOT NULL DEFAULT 0 on account_sources.
 *       Negative allowed (credit cards, loans). No date anchor.
 *   D5  Per-account breakdown + workspace currency totals.
 *   D6  All-time balance (no date filter).
 *
 * Balance formula per account (computed entirely in SQL — SEC-02):
 *   balance = initial_balance
 *           + SUM(income WHERE base_currency = account.currency)
 *           + SUM(debt_received WHERE base_currency = account.currency)
 *           − SUM(expense WHERE base_currency = account.currency)
 *           − SUM(debt_given WHERE base_currency = account.currency)
 *
 * Phase 1.27 — Multicurrency Mismatch Handling:
 *   Transactions where base_currency ≠ account_sources.currency are EXCLUDED
 *   from the balance sum. This prevents silent currency mixing (e.g. EUR amounts
 *   counted as USD). Excluded transactions are counted and shown as a warning
 *   footnote per account. No conversion is performed. No backfill.
 *   This is the safest Phase 1 handling — Phase 2.4 will add exchange rates.
 *
 * SEC-02: All financial arithmetic done in PostgreSQL NUMERIC — no JS float math.
 *         toFixed(2) used for string output only.
 * SEC-03: All queries run inside withTenantTransaction for RLS isolation.
 *         Defense-in-depth: explicit WHERE workspace_id = $1 alongside RLS.
 * SEC-12: No raw_text or user PII in logs.
 */

import { withTenantTransaction } from '@midas/database';
import { escapeHtml } from '../utils/html-escape.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** Row from the per-account balance query. */
interface AccountBalanceRow {
  account_id: string;
  name: string;
  type: string;
  currency: string;
  /** Computed in SQL: initial_balance + matched-currency income/debt − expense/debt_given */
  balance: { toFixed: (dp: number) => string }; // Decimal (pg NUMERIC parser)
  transfer_count: string; // COUNT() returns string from pg
  transfer_sum: { toFixed: (dp: number) => string }; // Decimal
  /** Phase 1.27: transactions excluded due to base_currency ≠ account.currency */
  mismatch_count: string;
}

/** Row from the currency totals query. */
interface CurrencyTotalRow {
  currency: string;
  currency_total: { toFixed: (dp: number) => string }; // Decimal
}

// ─────────────────────────────────────────────────────────────
// Russian type labels (same mapping as account.service.ts)
// ─────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  manual: 'Ручной ввод',
  crypto_read_only: 'Крипто',
  bank_sync: 'Банк',
};

function resolveTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

// ─────────────────────────────────────────────────────────────
// SQL — per-account balances (D1–D3, D4, D6: all-time)
// Phase 1.27: ONLY transactions where base_currency = account.currency are
//   included in balance sum. Mismatched transactions are counted separately.
// ─────────────────────────────────────────────────────────────

const PER_ACCOUNT_SQL = `
  SELECT
    a.id   AS account_id,
    a.name,
    a.type,
    a.currency,
    -- Balance formula: D1 sign rules, D2 debt integrated, D3 transfer excluded.
    -- Phase 1.27: ONLY transactions with base_currency = account currency are summed.
    -- This prevents silent cross-currency mixing (e.g. EUR amounts counted as USD).
    -- All arithmetic in PostgreSQL NUMERIC — SEC-02: no JS float math.
    a.initial_balance
      + COALESCE(SUM(CASE
          WHEN t.transaction_intent = 'income'        AND t.base_currency = a.currency
          THEN t.base_amount END), 0)
      + COALESCE(SUM(CASE
          WHEN t.transaction_intent = 'debt_received' AND t.base_currency = a.currency
          THEN t.base_amount END), 0)
      - COALESCE(SUM(CASE
          WHEN t.transaction_intent = 'expense'       AND t.base_currency = a.currency
          THEN t.base_amount END), 0)
      - COALESCE(SUM(CASE
          WHEN t.transaction_intent = 'debt_given'    AND t.base_currency = a.currency
          THEN t.base_amount END), 0)
      AS balance,
    -- Transfer: counted + summed but NOT added to balance (D3 = neutral).
    COUNT(CASE WHEN t.transaction_intent = 'transfer' THEN 1 END) AS transfer_count,
    COALESCE(SUM(CASE WHEN t.transaction_intent = 'transfer' THEN t.base_amount END), 0)
      AS transfer_sum,
    -- Phase 1.27: count transactions excluded due to base_currency ≠ account.currency
    -- (excluding transfer intent which is always neutral).
    COUNT(CASE
      WHEN t.base_currency IS NOT NULL
       AND t.base_currency != a.currency
       AND t.transaction_intent != 'transfer'
      THEN 1 END) AS mismatch_count
  FROM account_sources a
  -- D6: all-time (no date filter)
  -- Phase 1.29: AND t.deleted_at IS NULL in the JOIN ON clause — NOT in a WHERE.
  --   WHERE deleted_at IS NULL would silently convert LEFT JOIN to INNER JOIN,
  --   excluding accounts that have zero non-deleted transactions from /balance.
  LEFT JOIN transactions t
    ON t.account_id = a.id
   AND t.workspace_id = $1   -- defense-in-depth alongside RLS (SEC-03)
   AND t.deleted_at IS NULL   -- Phase 1.29: exclude soft-deleted from balance sum
  WHERE a.workspace_id = $1  -- explicit workspace filter (SEC-03)
    AND a.deleted_at IS NULL   -- Phase 2.1: hide soft-deleted accounts
  GROUP BY a.id, a.name, a.type, a.currency, a.initial_balance
  ORDER BY a.currency, a.name
`;

// ─────────────────────────────────────────────────────────────
// SQL — per-currency workspace totals (D5: currency grouping)
// Phase 1.27: uses the same mismatch-safe formula as PER_ACCOUNT_SQL
// ─────────────────────────────────────────────────────────────

const CURRENCY_TOTALS_SQL = `
  SELECT
    currency,
    SUM(balance) AS currency_total
  FROM (
    SELECT
      a.currency,
      a.initial_balance
        + COALESCE(SUM(CASE
            WHEN t.transaction_intent = 'income'        AND t.base_currency = a.currency
            THEN t.base_amount END), 0)
        + COALESCE(SUM(CASE
            WHEN t.transaction_intent = 'debt_received' AND t.base_currency = a.currency
            THEN t.base_amount END), 0)
        - COALESCE(SUM(CASE
            WHEN t.transaction_intent = 'expense'       AND t.base_currency = a.currency
            THEN t.base_amount END), 0)
        - COALESCE(SUM(CASE
            WHEN t.transaction_intent = 'debt_given'    AND t.base_currency = a.currency
            THEN t.base_amount END), 0)
        AS balance
    FROM account_sources a
    -- Phase 1.29: AND t.deleted_at IS NULL in the JOIN ON clause (not WHERE) to
    --   preserve accounts with zero non-deleted transactions in LEFT JOIN semantics.
    LEFT JOIN transactions t
      ON t.account_id = a.id
     AND t.workspace_id = $1
     AND t.deleted_at IS NULL   -- Phase 1.29: exclude soft-deleted from currency totals
    WHERE a.workspace_id = $1
      AND a.deleted_at IS NULL   -- Phase 2.1: hide soft-deleted accounts
    GROUP BY a.id, a.currency, a.initial_balance
  ) AS account_balances
  GROUP BY currency
  ORDER BY currency
`;

// ─────────────────────────────────────────────────────────────
// getAccountBalances — main export
// ─────────────────────────────────────────────────────────────

/**
 * Generate a per-account balance report for the current workspace.
 *
 * Output format (Phase 1.27 roadmap style, non-empty):
 *
 *   💰 <b>Баланс по счетам:</b>
 *
 *   • Binance — Крипто (USDT)
 *     └─ <b>2,847.50</b> USDT
 *     🔄 Переводы: 5 шт. на 5,000.00 USDT (не учитываются в балансе)
 *
 *   • MetaMask — Крипто (ETH)
 *     └─ <b>1.25</b> ETH
 *
 *   ────────────────────
 *   📊 Итого по валютам:
 *   ETH: <b>1.25</b>
 *   USDT: <b>2,847.50</b>
 *
 * Phase 1.27 mismatch warning (when base_currency ≠ account.currency):
 *   ⚠️ Пропущено 3 транзакций с другой валютой (без конвертации)
 *
 * Output format (empty):
 *   💰 <b>Баланс по счетам:</b>
 *
 *   Счетов пока нет.
 *
 * @param workspaceId - Internal workspace ULID (from trusted backend — SEC-03)
 * @param userId      - Internal user ULID (required by withTenantTransaction)
 * @returns Formatted Russian text string ready for sendMessage
 */
export async function getAccountBalances(
  workspaceId: string,
  userId: string,
): Promise<string> {
  const { text } = await getBalanceData(workspaceId, userId);
  return text;
}

// ─────────────────────────────────────────────────────────────
// getBalanceData — structured data + text (Phase 2.1)
// ─────────────────────────────────────────────────────────────

/** Structured balance row for keyboard building. */
export interface BalanceDataRow {
  account_id: string;
  name: string;
  type: string;
  currency: string;
  balance: string;
}

/** Structured result from getBalanceData(). */
export interface BalanceData {
  text: string;
  accounts: BalanceDataRow[];
}

/**
 * Get structured balance data: formatted text + per-account rows.
 * Used by the Balance screen to build both message text and inline keyboard.
 *
 * @param workspaceId - Internal workspace ULID (SEC-03)
 * @param userId      - Internal user ULID
 * @returns { text, accounts[] }
 */
export async function getBalanceData(
  workspaceId: string,
  userId: string,
): Promise<BalanceData> {
  const { accounts, currencyTotals } = await withTenantTransaction<{
    accounts: AccountBalanceRow[];
    currencyTotals: CurrencyTotalRow[];
  }>(workspaceId, userId, async (client) => {
    const accountsResult = await client.query<AccountBalanceRow>(
      PER_ACCOUNT_SQL,
      [workspaceId],
    );
    const totalsResult = await client.query<CurrencyTotalRow>(
      CURRENCY_TOTALS_SQL,
      [workspaceId],
    );
    return {
      accounts: accountsResult.rows,
      currencyTotals: totalsResult.rows,
    };
  });

  // ── Build structured rows for keyboard ────────────────────────
  const accountRows: BalanceDataRow[] = accounts.map((row) => ({
    account_id: row.account_id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    balance: row.balance.toFixed(2),
  }));

  // ── Empty workspace ─────────────────────────────────────────
  if (accounts.length === 0) {
    return {
      text: '💰 <b>Баланс по счетам:</b>\n\nСчетов пока нет.',
      accounts: [],
    };
  }

  // ── Per-account lines ────────────────────────────────────
  const accountLines = accounts.map((row) => {
    const name = escapeHtml(row.name);
    const typeLabel = escapeHtml(resolveTypeLabel(row.type));
    const currency = escapeHtml(row.currency);
    const balanceStr = row.balance.toFixed(2);
    const transferCount = parseInt(row.transfer_count, 10);
    const mismatchCount = parseInt(row.mismatch_count, 10);

    let line = `• ${name} — ${typeLabel} (${currency})\n  └─ <b>${balanceStr}</b> ${currency}`;

    if (transferCount > 0) {
      const transferSumStr = row.transfer_sum.toFixed(2);
      line += `\n  🔄 Переводы: ${String(transferCount)} шт. на ${transferSumStr} ${currency} (не учитываются в балансе)`;
    }

    if (mismatchCount > 0) {
      line += `\n  ⚠️ Пропущено ${String(mismatchCount)} тр. с другой валютой (без конвертации)`;
    }

    return line;
  });

  // ── Currency totals ──────────────────
  const totalLines = currencyTotals.map((row) => {
    const currency = escapeHtml(row.currency);
    const totalStr = row.currency_total.toFixed(2);
    return `${currency}: <b>${totalStr}</b>`;
  });

  const text =
    '💰 <b>Баланс по счетам:</b>\n\n' +
    accountLines.join('\n\n') +
    '\n\n────────────────────\n📊 Итого по валютам:\n' +
    totalLines.join('\n');

  return { text, accounts: accountRows };
}

// ─────────────────────────────────────────────────────────────
// getAccountDetail — single account card (Phase 2.1)
// ─────────────────────────────────────────────────────────────

/** SQL for single account detail card. */
const ACCOUNT_DETAIL_SQL = `
  SELECT
    a.id,
    a.name,
    a.type,
    a.currency,
    a.created_at,
    a.initial_balance
      + COALESCE(SUM(CASE
          WHEN t.transaction_intent = 'income'        AND t.base_currency = a.currency
          THEN t.base_amount END), 0)
      + COALESCE(SUM(CASE
          WHEN t.transaction_intent = 'debt_received' AND t.base_currency = a.currency
          THEN t.base_amount END), 0)
      - COALESCE(SUM(CASE
          WHEN t.transaction_intent = 'expense'       AND t.base_currency = a.currency
          THEN t.base_amount END), 0)
      - COALESCE(SUM(CASE
          WHEN t.transaction_intent = 'debt_given'    AND t.base_currency = a.currency
          THEN t.base_amount END), 0)
      AS balance,
    COUNT(t.id) AS tx_count
  FROM account_sources a
  LEFT JOIN transactions t
    ON t.account_id = a.id
   AND t.workspace_id = $1
   AND t.deleted_at IS NULL
  WHERE a.id = $2
    AND a.workspace_id = $1
    AND a.deleted_at IS NULL
  GROUP BY a.id, a.name, a.type, a.currency, a.created_at, a.initial_balance
`;

/** Row from account detail query. */
interface AccountDetailRow {
  id: string;
  name: string;
  type: string;
  currency: string;
  created_at: string;
  balance: { toFixed: (dp: number) => string };
  tx_count: string;
}

/** Structured account detail. */
export interface AccountDetailData {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: string;
  tx_count: string;
  created_at: string;
}

/**
 * Get detailed information for a single account.
 * Returns null if account not found or deleted.
 *
 * SEC-03: All queries inside withTenantTransaction with explicit workspace_id.
 */
export async function getAccountDetail(
  workspaceId: string,
  userId: string,
  accountId: string,
): Promise<AccountDetailData | null> {
  return withTenantTransaction<AccountDetailData | null>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<AccountDetailRow>(
        ACCOUNT_DETAIL_SQL,
        [workspaceId, accountId],
      );
      const row: AccountDetailRow | undefined = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        currency: row.currency,
        balance: row.balance.toFixed(2),
        tx_count: row.tx_count,
        created_at: String(row.created_at),
      };
    },
  );
}

// ─────────────────────────────────────────────────────────────
// setAccountBalanceById — balance sync by ID (Phase 2.1)
// ─────────────────────────────────────────────────────────────

/**
 * Synchronize account balance by recalculating initial_balance.
 * Same formula as setAccountBalance() but uses account ID directly.
 *
 * Formula: new_initial_balance = target_balance − computed_from_transactions
 * All arithmetic in PostgreSQL NUMERIC (SEC-02).
 *
 * @param workspaceId - Internal workspace ULID (SEC-03)
 * @param userId      - Internal user ULID
 * @param accountId   - Account ID (ULID)
 * @param amountStr   - Target balance as NUMERIC-safe string
 * @returns 'ok' | 'not_found'
 */
export async function setAccountBalanceById(
  workspaceId: string,
  userId: string,
  accountId: string,
  amountStr: string,
): Promise<'ok' | 'not_found'> {
  return withTenantTransaction<'ok' | 'not_found'>(
    workspaceId,
    userId,
    async (client) => {
      const updateResult = await client.query<{ id: string }>(
        `UPDATE account_sources
         SET initial_balance = (
           $3::NUMERIC
           - COALESCE((
             SELECT SUM(CASE
               WHEN t.transaction_intent = 'income'        THEN  t.base_amount
               WHEN t.transaction_intent = 'debt_received' THEN  t.base_amount
               WHEN t.transaction_intent = 'expense'       THEN -t.base_amount
               WHEN t.transaction_intent = 'debt_given'    THEN -t.base_amount
               ELSE 0 END)
             FROM transactions t
             WHERE t.account_id  = $2
               AND t.workspace_id = $1
               AND t.deleted_at IS NULL
           ), 0)
         )
         WHERE id = $2
           AND workspace_id = $1
           AND deleted_at IS NULL
         RETURNING id`,
        [workspaceId, accountId, amountStr],
      );
      return updateResult.rowCount === 0 ? 'not_found' : 'ok';
    },
  );
}

/**
 * Get transaction count for an account (for currency change warning).
 */
export async function getAccountTxCount(
  workspaceId: string,
  userId: string,
  accountId: string,
): Promise<number> {
  return withTenantTransaction<number>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM transactions
         WHERE account_id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [accountId, workspaceId],
      );
      return parseInt(result.rows[0]?.cnt ?? '0', 10);
    },
  );
}
