/**
 * Report Service — Phase 1.9 + Phase 1.18
 *
 * Generates a text-based monthly transaction report for a workspace.
 *
 * Scope (Phase 1.9):
 *   - Current UTC month only (no custom date ranges)
 *   - Groups by transaction_intent: expense, income, debt_given, debt_received, transfer
 *   - Sums base_amount using NUMERIC aggregation (SEC-02: no float arithmetic)
 *   - Returns plain Russian text for Telegram sendMessage
 *
 * Phase 1.18 change:
 *   - Added base_currency to SELECT, GROUP BY, and ORDER BY.
 *   - Each (transaction_intent, base_currency) pair is a separate output line.
 *   - Currency label shown in parentheses: 💸 Расходы (USD): <b>42355.76</b> (289 шт.)
 *   - escapeHtml applied to base_currency (Phase 1.15 policy — DB-sourced text value).
 *   - Rationale: GROUP BY transaction_intent alone silently mixes amounts from different
 *     currencies into one sum, which is semantically incorrect. This fix is required for
 *     correctness whenever multi-currency transactions exist in a workspace.
 *
 * SEC-02: All financial amounts are Decimal objects (from pg.types.setTypeParser).
 *         Formatting uses .toFixed() for string output. No Number(), parseFloat(), or float math.
 * SEC-03: All queries run inside withTenantTransaction for RLS isolation.
 * SEC-12: No raw_text or user PII in logs or output.
 */

import { withTenantTransaction } from '@midas/database';
import { escapeHtml } from '../utils/html-escape.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface IntentSummaryRow {
  transaction_intent: string;
  base_currency: string;  // Phase 1.18: included in GROUP BY for correctness
  total: { toFixed: (dp: number) => string };  // Decimal from pg NUMERIC parser
  count: number;
}

// ─────────────────────────────────────────────────────────────
// Intent display labels (Russian)
// ─────────────────────────────────────────────────────────────

const INTENT_LABELS: Record<string, string> = {
  expense: '💸 Расходы',
  income: '💰 Доходы',
  debt_given: '🤝 Долги выданные',
  debt_received: '🤝 Долги полученные',
  transfer: '🔄 Переводы',
};

// ─────────────────────────────────────────────────────────────
// Month utilities (UTC)
// ─────────────────────────────────────────────────────────────

const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

function getCurrentMonthBoundaries(): { start: string; end: string; label: string } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based

  const start = new Date(Date.UTC(year, month, 1)).toISOString();
  const end = new Date(Date.UTC(year, month + 1, 1)).toISOString();

  const label = `${MONTH_NAMES_RU[month] ?? 'Месяц'} ${String(year)}`;

  return { start, end, label };
}

// ─────────────────────────────────────────────────────────────
// Report generator
// ─────────────────────────────────────────────────────────────

/**
 * Generate a text report for the current UTC month.
 *
 * @param workspaceId - Internal workspace ULID (from trusted backend)
 * @param userId - Internal user ULID (for withTenantTransaction SEC-03)
 * @returns Formatted Russian text string ready for sendMessage
 */
export async function getMonthlyReport(
  workspaceId: string,
  userId: string,
): Promise<string> {
  const { start, end, label } = getCurrentMonthBoundaries();

  const rows = await withTenantTransaction<IntentSummaryRow[]>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<IntentSummaryRow>(
        // Phase 1.18: GROUP BY transaction_intent, base_currency for correctness.
        // Grouping by intent alone silently mixes amounts from different currencies.
        // Defense-in-depth: explicit WHERE workspace_id = $1 alongside RLS (SEC-03).
        `SELECT
           transaction_intent,
           base_currency,
           SUM(base_amount) AS total,
           COUNT(*)::INT AS count
         FROM transactions
         WHERE workspace_id = $1
           AND transaction_time >= $2
           AND transaction_time < $3
           AND deleted_at IS NULL  -- Phase 1.29: exclude soft-deleted from monthly report
         GROUP BY transaction_intent, base_currency
         ORDER BY transaction_intent, base_currency`,
        [workspaceId, start, end],
      );
      return result.rows;
    },
  );

  // ── Empty month ────────────────────────────────────────────
  if (rows.length === 0) {
    return `📊 <b>Отчёт за ${label}</b>\n\nНет транзакций за этот период.`;
  }

  // ── Build text report ──────────────────────────────────────
  // SEC-02: total is a Decimal object. Use .toFixed() — never Number() or parseFloat().
  // Phase 1.18: escapeHtml applied to base_currency (DB-sourced text — Phase 1.15 policy).
  const lines = rows.map((row) => {
    const intentLabel = INTENT_LABELS[row.transaction_intent] ?? row.transaction_intent;
    // SEC-02: Decimal.toFixed(2) for display, string output only
    const totalStr = row.total.toFixed(2);
    const countStr = String(row.count);
    // escapeHtml on base_currency: DB text value, not user-controlled, but consistent
    // with Phase 1.15 policy of escaping all DB-sourced strings in HTML-mode messages.
    const currencyLabel = escapeHtml(row.base_currency);
    return `${intentLabel} (${currencyLabel}): <b>${totalStr}</b> (${countStr} шт.)`;
  });

  return `📊 <b>Отчёт за ${label}</b>\n\n${lines.join('\n')}`;
}
