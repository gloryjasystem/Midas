/**
 * Transaction Hub Service — Phase 2.0
 *
 * Provides read-only query functions for the Transaction Hub screen.
 * Write operations (update/delete) continue to live in edit.service.ts
 * and are reused by the tx: callback handlers.
 *
 * Design decisions:
 *   D1: All SQL via withTenantTransaction (SEC-03) with explicit workspace_id.
 *   D2: Amounts stay as NUMERIC strings — no Number()/parseFloat() (SEC-02).
 *   D3: All DB-sourced strings pass through escapeHtml before rendering.
 *   D4: Search functions are stubs until Sprint 3 — throw to catch misuse.
 *   D5: IntentFilter is part of the callback_data — safe 1-char enum.
 *
 * SEC-12: Transaction amounts/descriptions are NOT logged.
 */

import { withTenantTransaction } from '@midas/database';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

export const TX_PAGE_SIZE = 5;  // grid filter takes +1 row; 5 tx fit cleanly on mobile

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface TxListItem {
  id: string;
  base_amount: string;        // NUMERIC string (SEC-02)
  base_currency: string;
  transaction_intent: string;
  transaction_time: string;   // ISO timestamp
  category_name: string;
  item_name: string | null;
  // Phase 3.1-UX: optional transfer enrichment (only for outbound transfer rows)
  transfer_direction?: string | null;  // 'outbound' | null (inbound filtered out)
  from_account?: string | null;        // source account name
  to_account?: string | null;          // target account name
  to_amount?: string | null;           // NUMERIC string — inbound amount
  to_currency?: string | null;         // inbound currency
}

export interface MonthMiniStats {
  expense_count:       number;
  income_count:        number;
  debt_given_count:    number;   // дал долг (деньги ушли)
  debt_received_count: number;   // взял долг (деньги пришли)
  transfer_count:      number;   // переводы между счетами
  expense_total: string;      // NUMERIC string (SEC-02)
  income_total:  string;      // NUMERIC string (SEC-02)
  currency:      string;      // workspace default_currency
}

/**
 * Intent filter for transaction list.
 *   'a' = all
 *   'e' = expense (расходы)
 *   'i' = income (доходы)
 *   'd' = debt — merged (взял долг + дал долг)
 *   't' = transfer (переводы между счетами)
 */
export type IntentFilter = 'a' | 'e' | 'i' | 'd' | 't';

// ─────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, optionally filtered list of transactions.
 * Uses parametrized intent filter (no string concatenation in SQL).
 */
export async function getTransactionList(
  workspaceId: string,
  userId: string,
  page: number,
  filter: IntentFilter,
): Promise<TxListItem[]> {
  const offset = page * TX_PAGE_SIZE;
  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<TxListItem>(
      `SELECT
         t.id,
         ROUND(t.base_amount, 2)::text AS base_amount,
         t.base_currency,
         t.transaction_intent,
         t.transaction_time::text,
         COALESCE(c.name, '—') AS category_name,
         t.item_name,
         t.transfer_direction,
         -- Phase 3.1-UX: transfer enrichment (NULL for non-transfers)
         COALESCE(a_src.name, NULL) AS from_account,
         COALESCE(a_tgt.name, NULL) AS to_account,
         ROUND(t_in.base_amount, 2)::text AS to_amount,
         t_in.base_currency AS to_currency
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       -- Phase 3.1-UX: join source account for transfer display
       LEFT JOIN account_sources a_src ON a_src.id = t.account_id
         AND t.transaction_intent = 'transfer'
       -- Phase 3.1-UX: join inbound leg + target account for transfer display
       LEFT JOIN transactions t_in
         ON  t_in.transfer_group_id = t.transfer_group_id
         AND t_in.transfer_direction = 'inbound'
         AND t_in.deleted_at IS NULL
         AND t.transaction_intent = 'transfer'
         AND t.transfer_direction = 'outbound'
       LEFT JOIN account_sources a_tgt ON a_tgt.id = t_in.account_id
         AND t.transaction_intent = 'transfer'
       WHERE t.workspace_id = $1
         AND t.deleted_at IS NULL
         -- Phase 3.1-UX: hide inbound transfer legs (shown as part of outbound)
         AND (t.transfer_direction IS DISTINCT FROM 'inbound')
         AND (
           $2 = 'a'
           OR ($2 = 'e'  AND t.transaction_intent = 'expense')
           OR ($2 = 'i'  AND t.transaction_intent = 'income')
           OR ($2 = 'd'  AND t.transaction_intent IN ('debt_given', 'debt_received'))
           OR ($2 = 't'  AND t.transaction_intent = 'transfer')
         )
       ORDER BY t.transaction_time DESC
       LIMIT $3 OFFSET $4`,
      [workspaceId, filter, TX_PAGE_SIZE, offset],
    );
    return r.rows;
  });
  return result;
}

/**
 * Count transactions matching the given intent filter.
 */
export async function countFilteredTransactions(
  workspaceId: string,
  userId: string,
  filter: IntentFilter,
): Promise<number> {
  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM transactions
       WHERE workspace_id = $1
         AND deleted_at IS NULL
         -- Phase 3.1-UX: hide inbound transfer legs from count
         AND (transfer_direction IS DISTINCT FROM 'inbound')
         AND (
           $2 = 'a'
           OR ($2 = 'e' AND transaction_intent = 'expense')
           OR ($2 = 'i' AND transaction_intent = 'income')
           OR ($2 = 'd' AND transaction_intent IN ('debt_given', 'debt_received'))
           OR ($2 = 't' AND transaction_intent = 'transfer')
         )`,
      [workspaceId, filter],
    );
    return parseInt(r.rows[0]?.cnt ?? '0', 10);
  });
  return result;
}

/**
 * Get mini statistics for the current month.
 * Used in the transaction list header.
 */
export async function getMonthMiniStats(
  workspaceId: string,
  userId: string,
): Promise<MonthMiniStats> {
  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    // Get workspace default currency
    const wRes = await client.query<{ default_currency: string }>(
      `SELECT default_currency FROM workspaces WHERE id = $1`,
      [workspaceId],
    );
    const currency = wRes.rows[0]?.default_currency ?? 'USDT';

    const r = await client.query<{
      expense_count:       string;
      income_count:        string;
      debt_given_count:    string;
      debt_received_count: string;
      transfer_count:      string;
      expense_total:       string;
      income_total:        string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE transaction_intent = 'expense')::text AS expense_count,
         COUNT(*) FILTER (WHERE transaction_intent = 'income')::text AS income_count,
         COUNT(*) FILTER (WHERE transaction_intent = 'debt_given')::text    AS debt_given_count,
         COUNT(*) FILTER (WHERE transaction_intent = 'debt_received')::text AS debt_received_count,
         -- Phase 3.1-UX: count only outbound legs (pairs shown as one)
         COUNT(*) FILTER (WHERE transaction_intent = 'transfer'
           AND (transfer_direction IS DISTINCT FROM 'inbound'))::text       AS transfer_count,
         COALESCE(SUM(base_amount) FILTER (WHERE transaction_intent = 'expense'), 0)::text AS expense_total,
         COALESCE(SUM(base_amount) FILTER (WHERE transaction_intent = 'income'), 0)::text AS income_total
       FROM transactions
       WHERE workspace_id = $1
         AND deleted_at IS NULL
         AND transaction_time >= date_trunc('month', NOW())
         AND transaction_time < date_trunc('month', NOW()) + interval '1 month'`,
      [workspaceId],
    );
    const row = r.rows[0];
    return {
      expense_count: parseInt(row?.expense_count ?? '0', 10),
      income_count: parseInt(row?.income_count ?? '0', 10),
      debt_given_count:    parseInt(row?.debt_given_count    ?? '0', 10),
      debt_received_count: parseInt(row?.debt_received_count ?? '0', 10),
      transfer_count:      parseInt(row?.transfer_count      ?? '0', 10),
      expense_total: row?.expense_total ?? '0',
      income_total: row?.income_total ?? '0',
      currency,
    };
  });
  return result;
}

// ─────────────────────────────────────────────────────────────
// Search (Sprint 3)
// ─────────────────────────────────────────────────────────────

/** Maximum search results per page (displayed as inline buttons). */
export const SEARCH_PAGE_SIZE = 8;

/**
 * Search transactions by item_name (ILIKE).
 * Uses pg_trgm GIN index when available (Task 3.6).
 * SEC-03: withTenantTransaction. SEC-02: NUMERIC strings.
 */
export async function searchByName(
  workspaceId: string,
  userId: string,
  query: string,
  page = 0,
): Promise<{ items: TxListItem[]; total: number }> {
  const offset = page * SEARCH_PAGE_SIZE;
  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    const [itemsRes, cntRes] = await Promise.all([
      client.query<TxListItem>(
        `SELECT
           t.id,
           ROUND(t.base_amount, 2)::text AS base_amount,
           t.base_currency,
           t.transaction_intent,
           t.transaction_time::text,
           COALESCE(c.name, '—') AS category_name,
           t.item_name
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.workspace_id = $1
           AND t.deleted_at IS NULL
           AND t.item_name ILIKE '%' || $2 || '%'
         ORDER BY t.transaction_time DESC
         LIMIT $3 OFFSET $4`,
        [workspaceId, query, SEARCH_PAGE_SIZE, offset],
      ),
      client.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt
         FROM transactions
         WHERE workspace_id = $1
           AND deleted_at IS NULL
           AND item_name ILIKE '%' || $2 || '%'`,
        [workspaceId, query],
      ),
    ]);
    return {
      items: itemsRes.rows,
      total: parseInt(cntRes.rows[0]?.cnt ?? '0', 10),
    };
  });
  return result;
}

/**
 * Search transactions by exact amount (rounded to 2 decimals).
 * SEC-03: withTenantTransaction. SEC-02: NUMERIC strings — no parseFloat.
 */
export async function searchByAmount(
  workspaceId: string,
  userId: string,
  amount: string,
  page = 0,
): Promise<{ items: TxListItem[]; total: number }> {
  const offset = page * SEARCH_PAGE_SIZE;
  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    const [itemsRes, cntRes] = await Promise.all([
      client.query<TxListItem>(
        `SELECT
           t.id,
           ROUND(t.base_amount, 2)::text AS base_amount,
           t.base_currency,
           t.transaction_intent,
           t.transaction_time::text,
           COALESCE(c.name, '—') AS category_name,
           t.item_name
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.workspace_id = $1
           AND t.deleted_at IS NULL
           AND ROUND(t.base_amount, 2) = $2::numeric
         ORDER BY t.transaction_time DESC
         LIMIT $3 OFFSET $4`,
        [workspaceId, amount, SEARCH_PAGE_SIZE, offset],
      ),
      client.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt
         FROM transactions
         WHERE workspace_id = $1
           AND deleted_at IS NULL
           AND ROUND(base_amount, 2) = $2::numeric`,
        [workspaceId, amount],
      ),
    ]);
    return {
      items: itemsRes.rows,
      total: parseInt(cntRes.rows[0]?.cnt ?? '0', 10),
    };
  });
  return result;
}

/**
 * Search transactions by category ID.
 * SEC-03: withTenantTransaction.
 */
export async function searchByCategory(
  workspaceId: string,
  userId: string,
  categoryId: string,
  page = 0,
): Promise<{ items: TxListItem[]; total: number }> {
  const offset = page * SEARCH_PAGE_SIZE;
  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    const [itemsRes, cntRes] = await Promise.all([
      client.query<TxListItem>(
        `SELECT
           t.id,
           ROUND(t.base_amount, 2)::text AS base_amount,
           t.base_currency,
           t.transaction_intent,
           t.transaction_time::text,
           COALESCE(c.name, '—') AS category_name,
           t.item_name
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.workspace_id = $1
           AND t.deleted_at IS NULL
           AND t.category_id = $2
         ORDER BY t.transaction_time DESC
         LIMIT $3 OFFSET $4`,
        [workspaceId, categoryId, SEARCH_PAGE_SIZE, offset],
      ),
      client.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt
         FROM transactions
         WHERE workspace_id = $1
           AND deleted_at IS NULL
           AND category_id = $2`,
        [workspaceId, categoryId],
      ),
    ]);
    return {
      items: itemsRes.rows,
      total: parseInt(cntRes.rows[0]?.cnt ?? '0', 10),
    };
  });
  return result;
}

/**
 * Search transactions within a date range.
 * SEC-03: withTenantTransaction. SEC-02: NUMERIC strings.
 *
 * @param from  ISO 8601 string — start of range (inclusive), e.g. "2026-05-10T00:00:00.000Z"
 * @param to    ISO 8601 string — end of range (inclusive),   e.g. "2026-05-10T23:59:59.999Z"
 */
export async function searchByDateRange(
  workspaceId: string,
  userId: string,
  from: string,
  to: string,
  page = 0,
): Promise<{ items: TxListItem[]; total: number }> {
  const offset = page * SEARCH_PAGE_SIZE;
  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    const [itemsRes, cntRes] = await Promise.all([
      client.query<TxListItem>(
        `SELECT
           t.id,
           ROUND(t.base_amount, 2)::text AS base_amount,
           t.base_currency,
           t.transaction_intent,
           t.transaction_time::text,
           COALESCE(c.name, '—') AS category_name,
           t.item_name
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.workspace_id = $1
           AND t.deleted_at IS NULL
           AND t.transaction_time >= $2::timestamptz
           AND t.transaction_time <= $3::timestamptz
         ORDER BY t.transaction_time DESC
         LIMIT $4 OFFSET $5`,
        [workspaceId, from, to, SEARCH_PAGE_SIZE, offset],
      ),
      client.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt
         FROM transactions
         WHERE workspace_id = $1
           AND deleted_at IS NULL
           AND transaction_time >= $2::timestamptz
           AND transaction_time <= $3::timestamptz`,
        [workspaceId, from, to],
      ),
    ]);
    return {
      items: itemsRes.rows,
      total: parseInt(cntRes.rows[0]?.cnt ?? '0', 10),
    };
  });
  return result;
}

/**
 * Parse a user-typed date string into [from, to] ISO range.
 *
 * Supported formats:
 *   "10.05"          → full day 10 May (current year)
 *   "10.05.2026"     → full day 10 May 2026
 *   "01.05 - 10.05"  → range 1–10 May (current year)
 *   "01.05.2026 - 10.05.2026" → range with explicit years
 *
 * Returns null if the input cannot be parsed.
 */
export function parseDateInput(input: string): { from: string; to: string; label: string } | null {
  const cleaned = input.trim().replace(/\s*[-–—]\s*/g, ' - ');

  // Helper: parse "DD.MM" or "DD.MM.YYYY"
  function parseSingle(s: string): Date | null {
    const parts = s.trim().split('.');
    if (parts.length < 2 || parts.length > 3) return null;
    const day   = parseInt(parts[0] ?? '', 10);
    const month = parseInt(parts[1] ?? '', 10);
    const year  = parts.length === 3 ? parseInt(parts[2] ?? '', 10) : new Date().getFullYear();
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    const d = new Date(year, month - 1, day);
    if (isNaN(d.getTime())) return null;
    return d;
  }

  function startOfDay(d: Date): string {
    const r = new Date(d); r.setHours(0, 0, 0, 0); return r.toISOString();
  }
  function endOfDay(d: Date): string {
    const r = new Date(d); r.setHours(23, 59, 59, 999); return r.toISOString();
  }
  function fmt(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${String(d.getFullYear())}`;
  }

  // Range: "DD.MM - DD.MM" or "DD.MM.YYYY - DD.MM.YYYY"
  if (cleaned.includes(' - ')) {
    const [leftRaw, rightRaw] = cleaned.split(' - ');
    const from = parseSingle(leftRaw ?? '');
    const to   = parseSingle(rightRaw ?? '');
    if (!from || !to) return null;
    return { from: startOfDay(from), to: endOfDay(to), label: `${fmt(from)} – ${fmt(to)}` };
  }

  // Single day
  const d = parseSingle(cleaned);
  if (!d) return null;
  return { from: startOfDay(d), to: endOfDay(d), label: fmt(d) };
}
