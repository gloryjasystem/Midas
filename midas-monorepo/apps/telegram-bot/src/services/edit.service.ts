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
  account_name: string;
}

export interface TransactionCard extends TransactionListItem {
  exchange_rate: string;
  is_cross_currency: boolean; // exchange_rate != 1.000000000000
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
         ROUND(t.base_amount, 2)::text  AS base_amount,
         ROUND(t.original_amount, 2)::text AS original_amount,
         t.base_currency,
         t.currency,
         t.exchange_rate::text,
         t.transaction_intent,
         t.transaction_time::text,
         COALESCE(c.name, '—')  AS category_name,
         COALESCE(a.name, '—')  AS account_name,
         (t.exchange_rate != 1.000000000000) AS is_cross_currency
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

export interface CategoryItem { id: string; name: string; group: string; }
export interface AccountItem  { id: string; name: string; currency: string; }

/** Fetch all categories for this workspace (for category picker). */
export async function getWorkspaceCategories(
  workspaceId: string,
  userId: string,
): Promise<CategoryItem[]> {
  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<CategoryItem>(
      `SELECT id, name, "group" FROM categories WHERE workspace_id = $1 ORDER BY "group", name`,
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

/** Fetch all accounts for this workspace (for account picker). */
export async function getWorkspaceAccounts(
  workspaceId: string,
  userId: string,
): Promise<AccountItem[]> {
  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<AccountItem>(
      `SELECT id, name, currency FROM account_sources WHERE workspace_id = $1 ORDER BY name`,
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
  debt_given:    '🔴 Долг выдан',
  debt_received: '🟢 Долг получен',
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

  return `${String(index + 1)}. ${intent} — ${escapeHtml(tx.category_name)} — <b>${amount} ${escapeHtml(tx.base_currency)}</b>   ${dateLabel}`;
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
    `📁 Категория: <b>${escapeHtml(card.category_name)}</b>\n` +
    `🏦 Счёт:      <b>${escapeHtml(card.account_name)}</b>\n` +
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
