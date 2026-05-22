/**
 * Edit Service — Phase 1.28
 *
 * Provides read and write operations for /edit transaction flow.
 *
 * Design decisions:
 *   D1: Fetch-before-update — always SELECT WHERE id=$1 AND workspace_id=$2 first.
 *       Prevents cross-workspace IDOR (SEC-01, SEC-03).
 *   D2: Amount edit restricted to exchange_rate = 1.000000000000.
 *       Cross-currency transactions have a baked-in exchange rate that cannot
 *       be recomputed without live rate data (not available in Phase 1).
 *       Safe choice: reject with a clear error message.
 *   D3: All updates inside withTenantTransaction (SEC-03).
 *       Defense-in-depth: explicit WHERE workspace_id = $1 on every UPDATE.
 *   D4: Returned amounts are NUMERIC strings — no Number() conversion (SEC-02).
 *   D5: category_id and account_id are validated to belong to the same workspace
 *       before UPDATE (prevents cross-workspace reference injection).
 *   D6: deleted_at IS NULL guard added in Phase 1.29 — excludes soft-deleted rows.
 *   D7: No date editing — deferred.
 *   D8: Pagination: 10 transactions per page (EDIT_PAGE_SIZE), ordered by
 *       transaction_time DESC. Uses existing idx_transactions_workspace_time.
 *
 * SEC-12: Transaction amounts/descriptions are NOT logged.
 *          Only txId, workspaceId, and field name are logged by callers.
 */

import { withTenantTransaction } from '@midas/database';
import { escapeHtml } from '../utils/html-escape.js';
import { getCategoryEmoji } from '../utils/category-emoji.js'; // Phase 4.0-F

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

export const EDIT_PAGE_SIZE = 10;

/**
 * Allowed transaction_intent values for edit.
 * 'transfer' is intentionally excluded — editing a transfer is ambiguous
 * without two-sided transaction support (Phase 1.29+).
 */
export const EDITABLE_INTENTS = ['income', 'expense', 'debt_given', 'debt_received', 'transfer'] as const;
export type TransactionIntent = typeof EDITABLE_INTENTS[number];

/** Validation regex for ULID (26 chars, base32 alphabet) */
const ULID_RE = /^[0-9A-Z]{26}$/;

/** Positive decimal validation: 1–10 digits, optional .1 or .2 decimal places */
const AMOUNT_RE = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * Format a DB NUMERIC string to 2 decimal places for display.
 * SEC-02: avoids parseFloat / Number() on financial values.
 * Input is the ::text cast of a PostgreSQL NUMERIC column.
 */
function formatAmountStr(numStr: string): string {
  const dotIdx = numStr.indexOf('.');
  if (dotIdx === -1) return `${numStr}.00`;
  const integer = numStr.slice(0, dotIdx);
  const frac = numStr.slice(dotIdx + 1).padEnd(2, '0').slice(0, 2);
  return `${integer}.${frac}`;
}

/**
 * Validate that a trimmed amount string is positive.
 * Uses integer arithmetic only — SEC-02 compliant.
 * Returns false if value is zero or if integer part is all zeros.
 */
function isPositiveAmountStr(trimmed: string): boolean {
  // Split on decimal point
  const dotIdx = trimmed.indexOf('.');
  const intPart = dotIdx === -1 ? trimmed : trimmed.slice(0, dotIdx);
  const fracPart = dotIdx === -1 ? '' : trimmed.slice(dotIdx + 1);
  // Reject if integer part is "0" and fractional part is all zeros
  if (/^0+$/.test(intPart) && (fracPart === '' || /^0+$/.test(fracPart))) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface TransactionRow {
  id: string;
  base_amount: string;       // NUMERIC — keep as string (SEC-02)
  original_amount: string;   // NUMERIC
  currency: string;
  base_currency: string;
  exchange_rate: string;     // NUMERIC
  transaction_intent: string;
  transaction_time: string;  // ISO timestamp
  category_id: string;
  account_id: string;
}

export interface TransactionListItem {
  id: string;
  base_amount: string;
  base_currency: string;
  transaction_intent: string;
  transaction_time: string;
  category_name: string;
  category_icon: string | null;  // Phase 4.0: custom category icon
  account_name: string;
}

export interface TransactionCard extends TransactionListItem {
  original_amount: string;
  currency:        string;
  account_id:      string | null;
  item_name:       string | null;
  exchange_rate:   string;
  is_cross_currency: boolean;  // exchange_rate != 1.000000000000
  account_deleted:  boolean;   // true when linked account has been soft-deleted
  transfer_group_id:  string | null;  // Phase 3.1-UX: non-null for paired transfers
  transfer_direction: string | null;  // 'outbound' | 'inbound' | null
}

/**
 * Full paired transfer data — both legs joined.
 * Used for rendering the Transfer Rich Card.
 */
export interface TransferPairRow {
  outbound_tx_id:   string;
  from_account:     string;
  from_amount:      string;   // NUMERIC string (SEC-02)
  from_currency:    string;
  to_account:       string;
  to_amount:        string;   // NUMERIC string (SEC-02)
  to_currency:      string;
  exchange_rate:    string;   // from inbound leg, or '1' for same-currency
  is_cross_currency: boolean;
  transaction_time: string;   // ISO timestamp
  transfer_group_id: string;
}

export type UpdateResult =
  | { status: 'ok' }
  | { status: 'not_found' }
  | { status: 'cross_currency_blocked' }   // D2: exchange_rate != 1
  | { status: 'invalid_amount' }
  | { status: 'invalid_category' }
  | { status: 'invalid_account' }
  | { status: 'invalid_intent' }
  | { status: 'already_deleted' };         // D6: Phase 1.29 soft-delete idempotency

// ─────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────

/**
 * Fetch a paginated list of transactions for the workspace.
 * Ordered by transaction_time DESC (most recent first).
 * Uses existing idx_transactions_workspace_time index.
 */
export async function getRecentTransactions(
  workspaceId: string,
  userId: string,
  page: number,
): Promise<TransactionListItem[]> {
  const offset = page * EDIT_PAGE_SIZE;
  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<TransactionListItem>(
      `SELECT
         t.id,
         ROUND(t.base_amount, 2)::text AS base_amount,
         t.base_currency,
         t.transaction_intent,
         t.transaction_time::text,
         COALESCE(c.name, '—')  AS category_name,
         c.icon                  AS category_icon,
         COALESCE(a.name, '—')  AS account_name
       FROM transactions t
       LEFT JOIN categories     c ON c.id = t.category_id
       LEFT JOIN account_sources a ON a.id = t.account_id
       WHERE t.workspace_id = $1
         AND t.deleted_at IS NULL
       ORDER BY t.transaction_time DESC
       LIMIT $2 OFFSET $3`,
      [workspaceId, EDIT_PAGE_SIZE, offset],
      // Phase 1.29: deleted_at IS NULL excludes soft-deleted transactions from list
    );
    return r.rows;
  });
  return result;
}

/**
 * Count total transactions for pagination.
 */
export async function countTransactions(workspaceId: string, userId: string): Promise<number> {
  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<{ cnt: string }>(
      // Phase 1.29: deleted_at IS NULL — pagination count excludes soft-deleted rows.
      `SELECT COUNT(*)::text AS cnt FROM transactions WHERE workspace_id = $1 AND deleted_at IS NULL`,
      [workspaceId],
    );
    return parseInt(r.rows[0]?.cnt ?? '0', 10);
  });
  return result;
}

/**
 * Fetch full transaction card data, verifying workspace ownership (D1).
 * Returns null if transaction not found or belongs to a different workspace.
 */
export async function getTransactionCard(
  txId: string,
  workspaceId: string,
  userId: string,
): Promise<TransactionCard | null> {
  if (!ULID_RE.test(txId)) return null;

  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<TransactionCard & { exchange_rate: string }>(
      // Phase 1.29: AND t.deleted_at IS NULL — returns null for soft-deleted transactions.
      // Callers handle null gracefully (show "not found" message).
      `SELECT
         t.id,
         ROUND(t.base_amount, 2)::text     AS base_amount,
         ROUND(t.original_amount, 2)::text  AS original_amount,
         t.base_currency,
         t.currency,
         t.exchange_rate::text,
         t.transaction_intent,
         t.transaction_time::text,
         COALESCE(c.name, '—')  AS category_name,
         c.icon                  AS category_icon,
         COALESCE(a.name, '—')  AS account_name,
         t.account_id,
         t.item_name,
         (t.exchange_rate != 1.000000000000)                    AS is_cross_currency,
         (t.account_id IS NOT NULL AND a.deleted_at IS NOT NULL) AS account_deleted,
         t.transfer_group_id,
         t.transfer_direction
       FROM transactions t
       LEFT JOIN categories     c ON c.id = t.category_id
       LEFT JOIN account_sources a ON a.id = t.account_id
       WHERE t.id = $1
         AND t.workspace_id = $2
         AND t.deleted_at IS NULL`,
      [txId, workspaceId],
    );
    return r.rows[0] ?? null;
  });
  return result;
}

/**
 * Fetch both legs of a paired transfer.
 * Given ANY tx ID (outbound or inbound), finds the pair via transfer_group_id
 * and returns a normalized TransferPairRow with source → target direction.
 *
 * Returns null if:
 *   - Transaction not found
 *   - Not a paired transfer (transfer_group_id IS NULL)
 *   - Paired leg missing (orphaned transfer)
 *
 * SEC-03: withTenantTransaction. SEC-02: NUMERIC strings.
 */
export async function getTransferPair(
  txId: string,
  workspaceId: string,
  userId: string,
): Promise<TransferPairRow | null> {
  if (!ULID_RE.test(txId)) return null;

  return withTenantTransaction(workspaceId, userId, async (client) => {
    // Step 1: find the transfer_group_id from the given tx
    const groupRes = await client.query<{ transfer_group_id: string | null }>(
      `SELECT transfer_group_id FROM transactions
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [txId, workspaceId],
    );
    const groupId = groupRes.rows[0]?.transfer_group_id;
    if (!groupId) return null;

    // Step 2: fetch both legs joined with account names
    const pairRes = await client.query<{
      out_id:         string;
      from_account:   string;
      from_amount:    string;
      from_currency:  string;
      to_account:     string;
      to_amount:      string;
      to_currency:    string;
      exchange_rate:  string;
      is_cross_currency: boolean;
      transaction_time: string;
    }>(
      `SELECT
         t_out.id                              AS out_id,
         COALESCE(a_src.name, '—')             AS from_account,
         ROUND(t_out.base_amount, 2)::text     AS from_amount,
         t_out.base_currency                   AS from_currency,
         COALESCE(a_tgt.name, '—')             AS to_account,
         ROUND(t_in.base_amount, 2)::text      AS to_amount,
         t_in.base_currency                    AS to_currency,
         t_in.exchange_rate::text              AS exchange_rate,
         (t_out.base_currency != t_in.base_currency) AS is_cross_currency,
         t_out.transaction_time::text
       FROM transactions t_out
       JOIN transactions t_in
         ON  t_in.transfer_group_id = t_out.transfer_group_id
         AND t_in.transfer_direction = 'inbound'
         AND t_in.deleted_at IS NULL
       LEFT JOIN account_sources a_src ON a_src.id = t_out.account_id
       LEFT JOIN account_sources a_tgt ON a_tgt.id = t_in.account_id
       WHERE t_out.transfer_group_id = $1
         AND t_out.transfer_direction = 'outbound'
         AND t_out.workspace_id = $2
         AND t_out.deleted_at IS NULL
       LIMIT 1`,
      [groupId, workspaceId],
    );

    const row = pairRes.rows[0];
    if (!row) return null;

    return {
      outbound_tx_id:    row.out_id,
      from_account:      row.from_account,
      from_amount:       row.from_amount,
      from_currency:     row.from_currency,
      to_account:        row.to_account,
      to_amount:         row.to_amount,
      to_currency:       row.to_currency,
      exchange_rate:     row.exchange_rate,
      is_cross_currency: row.is_cross_currency,
      transaction_time:  row.transaction_time,
      transfer_group_id: groupId,
    };
  });
}

/**
 * Update the exchange rate of a paired transfer.
 * Recalculates the inbound leg's base_amount based on the new rate.
 *
 * newRate is a user-typed string like "0.999" or "43.5".
 * Inbound amount = outbound amount × newRate (computed in PostgreSQL NUMERIC).
 *
 * SEC-02: all arithmetic in PostgreSQL. SEC-03: withTenantTransaction.
 */
export async function updateTransferExchangeRate(
  outboundTxId: string,
  workspaceId: string,
  userId: string,
  newRate: string,
): Promise<UpdateResult> {
  if (!ULID_RE.test(outboundTxId)) return { status: 'not_found' };

  // Validate rate format: positive decimal, up to 12 digits total
  const rateRe = /^\d{1,8}(\.\d{1,8})?$/;
  if (!rateRe.test(newRate)) return { status: 'invalid_amount' };

  return withTenantTransaction(workspaceId, userId, async (client) => {
    // Step 1: find transfer_group_id from outbound leg
    const check = await client.query<{ transfer_group_id: string | null; base_amount: string }>(
      `SELECT transfer_group_id, base_amount::text
       FROM transactions
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
         AND transfer_direction = 'outbound'`,
      [outboundTxId, workspaceId],
    );
    if (check.rows.length === 0) return { status: 'not_found' };
    const { transfer_group_id } = check.rows[0]!;
    if (!transfer_group_id) return { status: 'not_found' };

    // Step 2: update inbound leg — recalculate amount + set exchange_rate
    // new_inbound_amount = outbound_amount × newRate (NUMERIC precision)
    await client.query(
      `UPDATE transactions
       SET base_amount      = ROUND($3::NUMERIC * $4::NUMERIC, 4),
           original_amount  = ROUND($3::NUMERIC * $4::NUMERIC, 4),
           exchange_rate     = $4::NUMERIC
       WHERE transfer_group_id = $1
         AND workspace_id = $2
         AND transfer_direction = 'inbound'
         AND deleted_at IS NULL`,
      [transfer_group_id, workspaceId, check.rows[0]!.base_amount, newRate],
    );

    return { status: 'ok' };
  });
}

// ─────────────────────────────────────────────────────────────
// Updates
// ─────────────────────────────────────────────────────────────

/**
 * Update transaction amount.
 *
 * D2: Blocked if exchange_rate != 1.000000000000 — would require rate recalculation.
 * Sets both base_amount and original_amount (valid when exchange_rate = 1).
 */
export async function updateTransactionAmount(
  txId: string,
  workspaceId: string,
  userId: string,
  rawAmount: string,
): Promise<UpdateResult> {
  if (!ULID_RE.test(txId)) return { status: 'not_found' };

  const trimmed = rawAmount.trim().replace(',', '.');
  if (!AMOUNT_RE.test(trimmed)) return { status: 'invalid_amount' };
  if (!isPositiveAmountStr(trimmed)) return { status: 'invalid_amount' };

  return withTenantTransaction(workspaceId, userId, async (client) => {
    // Fetch-before-update (D1) — also checks exchange_rate (D2) and deleted_at (D6)
    const check = await client.query<{ exchange_rate: string }>(
      // Phase 1.29: AND deleted_at IS NULL — prevents editing soft-deleted transactions.
      `SELECT exchange_rate::text FROM transactions WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [txId, workspaceId],
    );
    if (check.rows.length === 0) return { status: 'not_found' };

    const rate = check.rows[0]?.exchange_rate ?? '';
    // D2: reject if cross-currency (exchange_rate != 1.000000000000)
    if (!rate.startsWith('1.000000')) return { status: 'cross_currency_blocked' };

    await client.query(
      `UPDATE transactions
       SET base_amount = $1::numeric, original_amount = $1::numeric
       WHERE id = $2 AND workspace_id = $3`,
      [trimmed, txId, workspaceId],
    );
    return { status: 'ok' };
  });
}

/**
 * Update transaction category.
 * Validates category belongs to the same workspace (D5).
 */
export async function updateTransactionCategory(
  txId: string,
  workspaceId: string,
  userId: string,
  categoryId: string,
): Promise<UpdateResult> {
  if (!ULID_RE.test(txId) || !ULID_RE.test(categoryId)) return { status: 'not_found' };

  return withTenantTransaction(workspaceId, userId, async (client) => {
    // Validate transaction exists in workspace (D1) and is not soft-deleted (D6)
    const txCheck = await client.query(
      // Phase 1.29: AND deleted_at IS NULL — prevents editing soft-deleted transactions.
      `SELECT 1 FROM transactions WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [txId, workspaceId],
    );
    if (txCheck.rows.length === 0) return { status: 'not_found' };

    // Validate category belongs to same workspace (D5)
    const catCheck = await client.query(
      `SELECT 1 FROM categories WHERE id = $1 AND workspace_id = $2`,
      [categoryId, workspaceId],
    );
    if (catCheck.rows.length === 0) return { status: 'invalid_category' };

    await client.query(
      `UPDATE transactions SET category_id = $1 WHERE id = $2 AND workspace_id = $3`,
      [categoryId, txId, workspaceId],
    );
    return { status: 'ok' };
  });
}

/**
 * Update transaction account.
 * Validates account belongs to the same workspace (D5).
 */
export async function updateTransactionAccount(
  txId: string,
  workspaceId: string,
  userId: string,
  accountId: string,
): Promise<UpdateResult> {
  if (!ULID_RE.test(txId) || !ULID_RE.test(accountId)) return { status: 'not_found' };

  return withTenantTransaction(workspaceId, userId, async (client) => {
    // Validate transaction exists in workspace (D1) and is not soft-deleted (D6)
    const txCheck = await client.query(
      // Phase 1.29: AND deleted_at IS NULL — prevents editing soft-deleted transactions.
      `SELECT 1 FROM transactions WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [txId, workspaceId],
    );
    if (txCheck.rows.length === 0) return { status: 'not_found' };

    // Validate account belongs to same workspace (D5)
    const accCheck = await client.query(
      `SELECT 1 FROM account_sources WHERE id = $1 AND workspace_id = $2`,
      [accountId, workspaceId],
    );
    if (accCheck.rows.length === 0) return { status: 'invalid_account' };

    await client.query(
      `UPDATE transactions SET account_id = $1 WHERE id = $2 AND workspace_id = $3`,
      [accountId, txId, workspaceId],
    );
    return { status: 'ok' };
  });
}

/**
 * Update transaction intent.
 * Validates against allowlist (SEC-01).
 */
export async function updateTransactionIntent(
  txId: string,
  workspaceId: string,
  userId: string,
  intent: string,
): Promise<UpdateResult> {
  if (!ULID_RE.test(txId)) return { status: 'not_found' };
  if (!(EDITABLE_INTENTS as readonly string[]).includes(intent)) return { status: 'invalid_intent' };

  return withTenantTransaction(workspaceId, userId, async (client) => {
    // Phase 1.29: AND deleted_at IS NULL — prevents editing soft-deleted transactions.
    const check = await client.query(
      `SELECT 1 FROM transactions WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [txId, workspaceId],
    );
    if (check.rows.length === 0) return { status: 'not_found' };

    await client.query(
      `UPDATE transactions SET transaction_intent = $1 WHERE id = $2 AND workspace_id = $3`,
      [intent, txId, workspaceId],
    );
    return { status: 'ok' };
  });
}

// ─────────────────────────────────────────────────────────────
// Workspace helpers for picker lists
// ─────────────────────────────────────────────────────────────

export interface CategoryItem {
  id: string;
  name: string;
  group: string;
  icon: string | null;     // Phase 4.0: DB emoji for custom categories (null for standard)
  is_custom: boolean;       // Phase 4.0: true = user-created via FSM
}
export interface AccountItem  { id: string; name: string; currency: string; balance: string; /* NUMERIC string (SEC-02) */ }

/** Fetch all categories for this workspace (for category picker).
 *  Phase 4.0: includes icon + is_custom; sorts standard (false=0) before custom (true=1).
 */
export async function getWorkspaceCategories(
  workspaceId: string,
  userId: string,
): Promise<CategoryItem[]> {
  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<CategoryItem>(
      `SELECT id, name, "group", icon, is_custom
       FROM categories
       WHERE workspace_id = $1
       ORDER BY is_custom, "group", name`,
      [workspaceId],
    );
    return r.rows;
  });
  return result;
}

// ─────────────────────────────────────────────────────────────
// Soft delete
// ─────────────────────────────────────────────────────────────

/**
 * Soft-delete a transaction by setting deleted_at = NOW().
 *
 * D1: Fetch-before-update verifies workspace ownership AND that
 *     the transaction is not already soft-deleted.
 * D3: withTenantTransaction + explicit WHERE workspace_id (SEC-03).
 * SEC-12: No amount or description is logged.
 *
 * Returns:
 *   'ok'             — deleted successfully.
 *   'not_found'      — txId invalid, not in this workspace, or already deleted.
 *   'already_deleted'— row exists but deleted_at IS NOT NULL (idempotency guard).
 */
export async function softDeleteTransaction(
  txId: string,
  workspaceId: string,
  userId: string,
): Promise<UpdateResult> {
  if (!ULID_RE.test(txId)) return { status: 'not_found' };

  return withTenantTransaction(workspaceId, userId, async (client) => {
    // Step 1: verify ownership and current delete status (D1).
    const check = await client.query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM transactions WHERE id = $1 AND workspace_id = $2`,
      [txId, workspaceId],
    );
    if (check.rows.length === 0) return { status: 'not_found' };
    if (check.rows[0]?.deleted_at !== null) return { status: 'already_deleted' };

    // Step 2: soft delete — UPDATE only (no hard DELETE).
    await client.query(
      `UPDATE transactions SET deleted_at = NOW() WHERE id = $1 AND workspace_id = $2`,
      [txId, workspaceId],
    );
    return { status: 'ok' };
  });
}

/**
 * Soft-delete BOTH legs of an internal paired transfer atomically.
 *
 * Finds the transfer_group_id from outboundTxId, then sets deleted_at = NOW()
 * on ALL transactions sharing that group (outbound + inbound).
 *
 * D1: workspace_id check on initial SELECT.
 * D3: withTenantTransaction — single atomic UPDATE.
 * SEC-12: No amounts logged.
 *
 * Returns:
 *   'ok'             — both legs deleted.
 *   'not_found'      — outboundTxId not found or not a paired transfer.
 *   'already_deleted'— transfer was already soft-deleted.
 */
export async function softDeletePairedTransfer(
  outboundTxId: string,
  workspaceId: string,
  userId: string,
): Promise<UpdateResult> {
  if (!ULID_RE.test(outboundTxId)) return { status: 'not_found' };

  return withTenantTransaction(workspaceId, userId, async (client) => {
    // Step 1: fetch transfer_group_id + delete status (D1 + D6).
    const check = await client.query<{ transfer_group_id: string | null; deleted_at: string | null }>(
      `SELECT transfer_group_id, deleted_at
       FROM transactions
       WHERE id = $1 AND workspace_id = $2`,
      [outboundTxId, workspaceId],
    );
    if (check.rows.length === 0) return { status: 'not_found' };
    const { transfer_group_id, deleted_at } = check.rows[0]!;
    if (!transfer_group_id) return { status: 'not_found' }; // not a paired transfer
    if (deleted_at !== null) return { status: 'already_deleted' };

    // Step 2: soft-delete ALL legs sharing the same transfer_group_id.
    await client.query(
      `UPDATE transactions
       SET deleted_at = NOW()
       WHERE transfer_group_id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [transfer_group_id, workspaceId],
    );
    return { status: 'ok' };
  });
}

/** Fetch all accounts for this workspace (for account picker), including running balance.
 * Balance formula mirrors balance.service.ts (D2: NUMERIC-only arithmetic in PostgreSQL).
 * Only active (non-deleted) accounts are returned; deleted ones retain historical tx links.
 */
export async function getWorkspaceAccounts(
  workspaceId: string,
  userId: string,
): Promise<AccountItem[]> {
  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<AccountItem>(
      `SELECT
         a.id,
         a.name,
         a.currency,
         ROUND(
           a.initial_balance
           + COALESCE(SUM(t.base_amount) FILTER (
               WHERE t.transaction_intent IN ('income', 'debt_received')
                 AND t.base_currency = a.currency
             ), 0)
           - COALESCE(SUM(t.base_amount) FILTER (
               WHERE t.transaction_intent IN ('expense', 'debt_given', 'transfer')
                 AND t.base_currency = a.currency
             ), 0)
           + COALESCE(SUM(t.account_debit_amount) FILTER (
               WHERE t.transaction_intent IN ('income', 'debt_received')
                 AND t.account_debit_currency = a.currency
             ), 0)
           - COALESCE(SUM(t.account_debit_amount) FILTER (
               WHERE t.transaction_intent IN ('expense', 'debt_given', 'transfer')
                 AND t.account_debit_currency = a.currency
             ), 0),
         2)::text AS balance
       FROM account_sources a
       LEFT JOIN transactions t ON t.account_id = a.id AND t.deleted_at IS NULL
       WHERE a.workspace_id = $1 AND a.deleted_at IS NULL
       GROUP BY a.id, a.name, a.currency
       ORDER BY a.name`,
      [workspaceId],
    );
    return r.rows;
  });
  return result;
}

// ─────────────────────────────────────────────────────────────
// Output formatting
// ─────────────────────────────────────────────────────────────

const INTENT_LABELS: Record<string, string> = {
  income:        '💰 Доход',
  expense:       '💸 Расход',
  debt_given:    '🤝 Долг (дал)',
  debt_received: '🤲 Долг (взял)',
  transfer:      '🔄 Перевод',
};

/**
 * Format a single transaction list row (one line of the /edit list).
 * Example: 💸 Продукты — 2 100.00 RUB   вчера
 */
export function formatTransactionListLine(tx: TransactionListItem, index: number): string {
  const intent = INTENT_LABELS[tx.transaction_intent] ?? tx.transaction_intent;
  const date = new Date(tx.transaction_time);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  const dateLabel =
    diffDays === 0 ? 'сегодня' :
    diffDays === 1 ? 'вчера' :
    date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

  const amount = formatAmountStr(tx.base_amount);

  return `${String(index + 1)}. ${intent} — ${getCategoryEmoji(tx.category_name, tx.category_icon)} ${escapeHtml(tx.category_name)} — <b>${amount} ${escapeHtml(tx.base_currency)}</b>   ${dateLabel}`;
}

/**
 * Format the /edit transaction list page header.
 */
export function formatTransactionListHeader(page: number, totalPages: number): string {
  return `📋 <b>Последние транзакции</b> (стр. ${String(page + 1)}/${String(totalPages)}):`;
}

/**
 * Format full transaction card for detail view.
 *
 * Example:
 *   📝 Транзакция
 *   💸 Тип:      Расход
 *   💰 Сумма:    350.00 RUB
 *   📁 Категория: Кофе
 *   🏦 Счёт:     Карта Сбер
 *   📅 Дата:     03.05.2026
 */
export function formatTransactionCard(card: TransactionCard): string {
  const intent = INTENT_LABELS[card.transaction_intent] ?? card.transaction_intent;
  const amount = formatAmountStr(card.base_amount);
  const date = new Date(card.transaction_time).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  let text =
    `📝 <b>Транзакция</b>\n\n` +
    `${intent}\n` +
    `💰 Сумма:     <b>${amount} ${escapeHtml(card.base_currency)}</b>\n` +
    `📁 Категория: <b>${getCategoryEmoji(card.category_name, card.category_icon)} ${escapeHtml(card.category_name)}</b>\n` +
    // Archived account: keep name visible (audit trail) but add a subtle badge.
    `🏦 Счёт:      <b>${escapeHtml(card.account_name)}</b>${card.account_deleted ? ' · <i>архив</i>' : ''}\n` +
    `📅 Дата:      ${date}\n`;

  if (card.is_cross_currency) {
    text += `\n⚠️ Мультивалютная транзакция — изменение суммы недоступно.`;
  }

  return text;
}

/**
 * Format the permanent [✏️ Изменить] confirmation message.
 * Shown after successful draft approval. txId embedded in callback_data.
 */
export function formatApprovalConfirmationWithEdit(): string {
  return `✅ Транзакция создана успешно.\n\nНажмите кнопку, чтобы изменить детали.`;
}

/**
 * Build the InlineKeyboardMarkup JSON for the [✏️ Изменить] permanent button.
 * callback_data = "ed:v:<txId>" (31 bytes max, safely within 64-byte limit).
 */
export function buildEditButtonKeyboardJson(txId: string): string {
  return JSON.stringify({
    inline_keyboard: [
      [{ text: '✏️ Изменить', callback_data: `ed:v:${txId}` }],
    ],
  });
}
