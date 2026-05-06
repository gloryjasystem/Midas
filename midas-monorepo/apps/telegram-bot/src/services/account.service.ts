/**
 * Account Service — Phase 1.14
 *
 * Read-only list of account_sources for a workspace.
 *
 * Scope:
 *   - getAccountList(): read-only, flat list sorted by type, name.
 *     Russian type labels:
 *       manual          → Ручной ввод
 *       crypto_read_only → Крипто
 *       bank_sync       → Банк
 *
 * SEC-02: No financial amounts involved. No float arithmetic.
 * SEC-03: All queries run inside withTenantTransaction for RLS isolation.
 *         Defense-in-depth: explicit WHERE workspace_id = $1 alongside RLS.
 * SEC-12: No raw_text or user PII in logs or output.
 */

import { withTenantTransaction } from '@midas/database';
import { escapeHtml } from '../utils/html-escape.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface AccountRow {
  name: string;
  type: string;
  currency: string;
}

// ─────────────────────────────────────────────────────────────
// Russian labels for account_source_type enum values.
// Enum values from DB: 'manual' | 'crypto_read_only' | 'bank_sync'
// ─────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  manual: 'Ручной ввод',
  crypto_read_only: 'Крипто',
  bank_sync: 'Банк',
};

/**
 * Resolve a Russian label for a given account_source_type value.
 * Unknown future types fall back to the raw type string.
 */
function resolveTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

// ─────────────────────────────────────────────────────────────
// Account list generator
// ─────────────────────────────────────────────────────────────

/**
 * Generate a read-only text list of account_sources for the current workspace.
 *
 * Output format (non-empty):
 *   💳 <b>Ваши счета:</b>
 *
 *   • Default — Ручной ввод (RUB)
 *
 *   Всего: 1 счёт.
 *
 * Output format (empty):
 *   💳 <b>Ваши счета:</b>
 *
 *   Счетов пока нет.
 *
 * @param workspaceId - Internal workspace ULID (from trusted backend — SEC-03)
 * @param userId      - Internal user ULID (required by withTenantTransaction)
 * @returns Formatted Russian text string ready for sendMessage
 */
export async function getAccountList(
  workspaceId: string,
  userId: string,
): Promise<string> {
  const rows = await withTenantTransaction<AccountRow[]>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<AccountRow>(
        // Defense-in-depth: explicit WHERE workspace_id = $1 alongside RLS (SEC-03).
        // RLS policy tenant_isolation_account_sources enforces workspace isolation at DB level.
        // This explicit filter ensures correctness even if RLS is ever temporarily bypassed
        // during maintenance or migration.
        `SELECT name, type, currency
         FROM account_sources
         WHERE workspace_id = $1
         ORDER BY type, name`,
        [workspaceId],
      );
      return result.rows;
    },
  );

  // ── Empty workspace ─────────────────────────────────────────
  if (rows.length === 0) {
    return '💳 <b>Ваши счета:</b>\n\nСчетов пока нет.';
  }

  // ── Build flat list sorted by type, name (ORDER BY in SQL) ──
  const lines = rows.map((row) => {
    // escapeHtml applied to all DB-sourced values (SEC-03 defense-in-depth,
    // phase 1.15 hardening). Type label is static code but escaped for
    // consistent policy — harmless for the current known label set.
    const label = escapeHtml(resolveTypeLabel(row.type));
    return `• ${escapeHtml(row.name)} — ${label} (${escapeHtml(row.currency)})`;
  });

  const totalCount = rows.length;
  const countLabel = `Всего: ${String(totalCount)} ${pluralizeAccounts(totalCount)}.`;

  return `💳 <b>Ваши счета:</b>\n\n${lines.join('\n')}\n\n${countLabel}`;
}

// ─────────────────────────────────────────────────────────────
// Russian pluralization for "счёт"
// ─────────────────────────────────────────────────────────────

/**
 * Pluralize the word "счёт" for Russian number agreement.
 * 1 → счёт, 2–4 → счёта, 5+ → счетов
 */
function pluralizeAccounts(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod100 >= 11 && mod100 <= 19) return 'счетов';
  if (mod10 === 1) return 'счёт';
  if (mod10 >= 2 && mod10 <= 4) return 'счёта';
  return 'счетов';
}
