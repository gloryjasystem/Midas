/**
 * Account Service — Phase 1.14 + Phase 1.17 + Phase 1.24 + Phase 1.30
 *
 * Phase 1.14: Read-only list of account_sources for a workspace.
 * Phase 1.17: addAccount() — strict-format write path for /add_account command.
 * Phase 1.24: addAccount() now reads workspace.default_currency dynamically
 *             instead of hardcoding 'RUB'. Ensures new accounts always match
 *             the workspace's configured default currency (USDT for new workspaces).
 * Phase 1.30: hasAccounts() — lightweight count query for empty-state detection.
 *             addAccountWithCurrency() — like addAccount() but accepts explicit
 *             currency for the guided onboarding flow (overrides workspace default).
 *
 * Scope:
 *   - getAccountList(): read-only, flat list sorted by type, name.
 *     Russian type labels:
 *       manual          → Ручной ввод
 *       crypto_read_only → Крипто
 *       bank_sync       → Банк
 *   - addAccount(): insert a new account_sources row for the workspace.
 *     - Name: trimmed, non-empty, max 100 chars, spaces allowed.
 *     - Type: always 'manual' (Phase 1.17 scope).
 *     - Currency: read from workspace.default_currency (Phase 1.24).
 *     - Duplicate: detected via ON CONFLICT → returns 'duplicate' result.
 *   - hasAccounts(): returns true if workspace has ≥ 1 account. Zero DB reads
 *     beyond the COUNT query (no unnecessary row fetching).
 *   - addAccountWithCurrency(): like addAccount() but accepts explicit currency.
 *
 * SEC-02: No financial amounts involved. No float arithmetic.
 * SEC-03: All queries run inside withTenantTransaction for RLS isolation.
 *         Defense-in-depth: explicit WHERE workspace_id = $1 alongside RLS.
 * SEC-12: No raw_text or user PII in logs or output.
 */

import { withTenantTransaction } from '@midas/database';
import { monotonicFactory } from 'ulid';
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

// ─────────────────────────────────────────────────────────────
// addAccount — Phase 1.17
// ─────────────────────────────────────────────────────────────

// Monotonic ULID factory — safe for single-process use.
const generateUlid = monotonicFactory();

/** Maximum allowed char length for an account name. */
const MAX_ACCOUNT_NAME_LENGTH = 100;

/**
 * Result of an addAccount() call.
 *   created   — new account_sources row successfully inserted.
 *   duplicate — an account with the same name already exists in this workspace.
 */
export type AddAccountResult = 'created' | 'duplicate';

/**
 * Insert a new account_sources row for the given workspace.
 *
 * @param workspaceId - Internal workspace ULID (from trusted backend — SEC-03)
 * @param userId      - Internal user ULID (required by withTenantTransaction)
 * @param name        - Account name (trimmed, non-empty, max 100 chars) — must be pre-validated
 * @returns AddAccountResult: 'created' | 'duplicate'
 *
 * SEC-03: INSERT runs inside withTenantTransaction — RLS policy tenant_isolation_account_sources
 *         enforces workspace_id isolation at DB level via WITH CHECK.
 *         Defense-in-depth: explicit workspace_id = $2 in the INSERT.
 * SEC-02: No financial amounts. No float arithmetic.
 * SEC-12: Name is NOT logged.
 *
 * Type is always 'manual' (Phase 1.17 scope — crypto/bank types are Phase 2+).
 * Currency: read from workspace.default_currency (Phase 1.24 — USDT for new workspaces).
 *
 * Duplicate detection: ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING.
 * If the row already exists, INSERT returns 0 rows → 'duplicate' result.
 */
export async function addAccount(
  workspaceId: string,
  userId: string,
  name: string,
): Promise<AddAccountResult> {
  const accountId = generateUlid();

  const rowsInserted = await withTenantTransaction<number>(
    workspaceId,
    userId,
    async (client) => {
      // ── Phase 1.24: Read workspace.default_currency dynamically ──────────────
      // Ensures the new account always matches the workspace's configured default
      // currency (USDT for new workspaces, RUB for existing ones, etc.).
      // Defense-in-depth: explicit WHERE id = $1 alongside RLS (SEC-03).
      const wsResult = await client.query<{ default_currency: string }>(
        `SELECT default_currency FROM workspaces WHERE id = $1`,
        [workspaceId],
      );
      // Fallback to 'USDT' if workspace not found (defensive; should not happen).
      const currency: string = wsResult.rows[0]?.default_currency ?? 'USDT';

      const result = await client.query<{ id: string }>(
        // Defense-in-depth: explicit workspace_id = $2 alongside RLS WITH CHECK.
        // ON CONFLICT ON CONSTRAINT: uses the named unique constraint (added Phase 1.16)
        // to prevent duplicate account names within the same workspace.
        `INSERT INTO account_sources (id, workspace_id, name, type, currency)
         VALUES ($1, $2, $3, 'manual'::account_source_type, $4)
         ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING
         RETURNING id`,
        [accountId, workspaceId, name, currency],
      );
      return result.rowCount ?? 0;
    },
  );

  return rowsInserted === 0 ? 'duplicate' : 'created';
}

/**
 * Parse and validate the arguments of the /add_account command.
 *
 * Input format:  /add_account <name>
 * The full message text is passed; the command token is consumed.
 * Account names may contain spaces (everything after the command token is the name).
 *
 * @param text - Full message text from Telegram (e.g. "/add_account My Wallet")
 * @returns { name } on success, or an error string (Russian) on failure.
 */
export function parseAddAccountArgs(
  text: string,
): { name: string } | { error: string } {
  // Strip the command token (/add_account or /add_account@BotName)
  const trimmed = text.trim();
  const firstSpaceIdx = trimmed.search(/\s/);

  if (firstSpaceIdx === -1) {
    // No arguments at all
    return {
      error:
        'Использование: /add_account <название>\n' +
        'Пример: /add_account Наличные',
    };
  }

  // Everything after the command token (including spaces) is the account name.
  const rawName = trimmed.slice(firstSpaceIdx).trim();

  // Validate name — non-empty after trim
  if (rawName.length === 0) {
    return {
      error:
        'Название счёта не может быть пустым.\n' +
        'Пример: /add_account Наличные',
    };
  }

  // Validate name — max length
  if (rawName.length > MAX_ACCOUNT_NAME_LENGTH) {
    return {
      error:
        `Название счёта слишком длинное (максимум ${String(MAX_ACCOUNT_NAME_LENGTH)} символов).`,
    };
  }

  return { name: rawName };
}

// ─────────────────────────────────────────────────────────────
// hasAccounts — Phase 1.30
// ─────────────────────────────────────────────────────────────

/**
 * Return true if the workspace has at least one account_sources row.
 *
 * Used by the /accounts empty-state handler to decide whether to show the
 * flat list or the guided onboarding keyboard.
 *
 * Does NOT call getAccountList() to avoid loading all rows unnecessarily.
 *
 * SEC-03: Runs inside withTenantTransaction + explicit workspace_id (defense-in-depth).
 */
export async function hasAccounts(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const count = await withTenantTransaction<number>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM account_sources WHERE workspace_id = $1`,
        [workspaceId],
      );
      return parseInt(result.rows[0]?.cnt ?? '0', 10);
    },
  );
  return count > 0;
}

// ─────────────────────────────────────────────────────────────
// addAccountWithCurrency — Phase 1.30
// ─────────────────────────────────────────────────────────────

/**
 * Insert a new account_sources row with an explicitly supplied currency.
 *
 * Used by the guided onboarding flow (Phase 1.30) where the user selects
 * a specific currency rather than inheriting workspace.default_currency.
 *
 * @param workspaceId - Internal workspace ULID (from trusted backend — SEC-03)
 * @param userId      - Internal user ULID (required by withTenantTransaction)
 * @param name        - Account name (pre-validated, non-empty, max 100 chars)
 * @param currency    - Explicit currency code (pre-validated, non-empty, max 10 chars)
 * @returns AddAccountResult: 'created' | 'duplicate'
 *
 * SEC-03: INSERT runs inside withTenantTransaction — RLS enforced.
 * SEC-02: No financial amounts. No float arithmetic.
 * SEC-12: Name and currency NOT logged.
 */
export async function addAccountWithCurrency(
  workspaceId: string,
  userId: string,
  name: string,
  currency: string,
): Promise<AddAccountResult> {
  const accountId = generateUlid();

  const rowsInserted = await withTenantTransaction<number>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO account_sources (id, workspace_id, name, type, currency)
         VALUES ($1, $2, $3, 'manual'::account_source_type, $4)
         ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING
         RETURNING id`,
        [accountId, workspaceId, name, currency],
      );
      return result.rowCount ?? 0;
    },
  );

  return rowsInserted === 0 ? 'duplicate' : 'created';
}
