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
           AND deleted_at IS NULL
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

// ─────────────────────────────────────────────────────────────
// getWorkspaceAccountsForInline — Phase 1.31
// ─────────────────────────────────────────────────────────────

/** Minimal account row for inline resolution. */
export interface InlineAccountRow {
  id: string;
  name: string;
  currency: string;
}

/**
 * Fetch all account_sources rows for the workspace for inline account resolution.
 *
 * Used by the Phase 1.31 ia: callback handler to:
 *   1. Run fuzzy/exact matching against parsed_account_hint.
 *   2. Build picker keyboards when multiple accounts share a currency.
 *
 * Returns an empty array if the workspace has no accounts (safe for callers).
 *
 * SEC-03: Runs inside withTenantTransaction + explicit workspace_id (defense-in-depth).
 * SEC-12: Account names NOT logged.
 */
export async function getWorkspaceAccountsForInline(
  workspaceId: string,
  userId: string,
): Promise<InlineAccountRow[]> {
  return withTenantTransaction<InlineAccountRow[]>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<InlineAccountRow>(
        `SELECT id, name, currency
         FROM account_sources
         WHERE workspace_id = $1
         ORDER BY name`,
        [workspaceId],
      );
      return result.rows;
    },
  );
}

// ─────────────────────────────────────────────────────────────
// getAccountById — Phase 1.31
// ─────────────────────────────────────────────────────────────

/**
 * Fetch a single account_sources row by its ID.
 *
 * Used by the Phase 1.31 ia:use / ia:fuzzy handlers to confirm the account
 * the user selected exists in the workspace (cross-workspace ULID poisoning guard).
 *
 * Returns null if not found or not in the workspace.
 *
 * SEC-03: Explicit workspace_id filter + RLS inside withTenantTransaction.
 */
export async function getAccountById(
  workspaceId: string,
  userId: string,
  accountId: string,
): Promise<InlineAccountRow | null> {
  return withTenantTransaction<InlineAccountRow | null>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<InlineAccountRow>(
        `SELECT id, name, currency
         FROM account_sources
         WHERE id = $1 AND workspace_id = $2`,
        [accountId, workspaceId],
      );
      return result.rows[0] ?? null;
    },
  );
}

// ─────────────────────────────────────────────────────────────
// getDraftAccountHint — Phase 1.31
// ─────────────────────────────────────────────────────────────

/** Draft row data needed for inline account resolution. */
export interface DraftAccountHintRow {
  parsed_account_hint: string | null;
  parsed_currency: string | null;
  workspace_id: string;
}

/**
 * Fetch the parsed_account_hint and parsed_currency from a draft.
 *
 * Used by the ai-parse worker (Option A) to decide whether to send the
 * standard approve/reject keyboard or an inline account creation keyboard.
 *
 * SEC-03: explicit workspace_id + RLS.
 * SEC-12: hint text NOT logged.
 */
export async function getDraftAccountHint(
  workspaceId: string,
  userId: string,
  draftId: string,
): Promise<DraftAccountHintRow | null> {
  return withTenantTransaction<DraftAccountHintRow | null>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<DraftAccountHintRow>(
        `SELECT parsed_account_hint, parsed_currency, workspace_id
         FROM transaction_drafts
         WHERE id = $1 AND workspace_id = $2`,
        [draftId, workspaceId],
      );
      return result.rows[0] ?? null;
    },
  );
}

// ─────────────────────────────────────────────────────────────
// setDraftAccountId — Phase 1.31
// ─────────────────────────────────────────────────────────────

/**
 * Update a transaction draft's account_id inline.
 *
 * Called by the ia:use / ia:fuzzy / ia:create handlers after the user
 * confirms or selects an account. The draft is then forwarded to approveDraft.
 *
 * Only updates if draft is still pending_user and not expired (safe guard).
 *
 * SEC-03: explicit workspace_id + RLS.
 * SEC-01: accountId is validated against account_sources before calling this fn.
 */
export async function setDraftAccountId(
  workspaceId: string,
  userId: string,
  draftId: string,
  accountId: string,
): Promise<'updated' | 'not_found' | 'not_pending'> {
  return withTenantTransaction<'updated' | 'not_found' | 'not_pending'>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<{ id: string; status: string }>(
        `UPDATE transaction_drafts
         SET account_id = $1, updated_at = NOW()
         WHERE id = $2
           AND workspace_id = $3
           AND status = 'pending_user'
           AND expires_at > NOW()
         RETURNING id, status`,
        [accountId, draftId, workspaceId],
      );
      if (result.rowCount === 0) {
        // Check if exists at all
        const check = await client.query<{ status: string }>(
          `SELECT status FROM transaction_drafts WHERE id = $1 AND workspace_id = $2`,
          [draftId, workspaceId],
        );
        if (check.rows.length === 0) return 'not_found';
        return 'not_pending';
      }
      return 'updated';
    },
  );
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
        `SELECT COUNT(*)::text AS cnt FROM account_sources WHERE workspace_id = $1 AND deleted_at IS NULL`,
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

// ─────────────────────────────────────────────────────────────
// renameAccount — Phase 2.1
// ─────────────────────────────────────────────────────────────

/**
 * Rename an account. Validates against duplicate names.
 *
 * SEC-03: withTenantTransaction + explicit workspace_id.
 * SEC-12: Name NOT logged.
 */
export async function renameAccount(
  workspaceId: string,
  userId: string,
  accountId: string,
  newName: string,
): Promise<'ok' | 'duplicate' | 'not_found'> {
  return withTenantTransaction<'ok' | 'duplicate' | 'not_found'>(
    workspaceId,
    userId,
    async (client) => {
      // Check for duplicate name (case-insensitive)
      const dupCheck = await client.query<{ id: string }>(
        `SELECT id FROM account_sources
         WHERE workspace_id = $1
           AND LOWER(name) = LOWER($2)
           AND id != $3
           AND deleted_at IS NULL`,
        [workspaceId, newName, accountId],
      );
      if (dupCheck.rows.length > 0) return 'duplicate';

      const result = await client.query<{ id: string }>(
        `UPDATE account_sources SET name = $1, updated_at = NOW()
         WHERE id = $2 AND workspace_id = $3 AND deleted_at IS NULL
         RETURNING id`,
        [newName, accountId, workspaceId],
      );
      return result.rowCount === 0 ? 'not_found' : 'ok';
    },
  );
}

// ─────────────────────────────────────────────────────────────
// changeAccountCurrency — Phase 2.1
// ─────────────────────────────────────────────────────────────

/**
 * Change account currency.
 * WARNING: existing transactions with the old currency will no longer match.
 * Caller should warn the user if tx_count > 0.
 *
 * SEC-03: withTenantTransaction + explicit workspace_id.
 */
export async function changeAccountCurrency(
  workspaceId: string,
  userId: string,
  accountId: string,
  newCurrency: string,
): Promise<'ok' | 'not_found'> {
  return withTenantTransaction<'ok' | 'not_found'>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE account_sources SET currency = $1, updated_at = NOW()
         WHERE id = $2 AND workspace_id = $3 AND deleted_at IS NULL
         RETURNING id`,
        [newCurrency, accountId, workspaceId],
      );
      return result.rowCount === 0 ? 'not_found' : 'ok';
    },
  );
}

// ─────────────────────────────────────────────────────────────
// softDeleteAccount — Phase 2.1
// ─────────────────────────────────────────────────────────────

/**
 * Soft-delete an account (set deleted_at = NOW()).
 * Transactions remain intact. Clears default account references in workspace.
 *
 * SEC-03: withTenantTransaction + explicit workspace_id.
 */
export async function softDeleteAccount(
  workspaceId: string,
  userId: string,
  accountId: string,
): Promise<'ok' | 'not_found'> {
  return withTenantTransaction<'ok' | 'not_found'>(
    workspaceId,
    userId,
    async (client) => {
      // Soft-delete the account
      const result = await client.query<{ id: string }>(
        `UPDATE account_sources SET deleted_at = NOW()
         WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [accountId, workspaceId],
      );
      if (result.rowCount === 0) return 'not_found';

      // Clear default account references if this was the default
      await client.query(
        `UPDATE workspaces SET default_expense_account_id = NULL
         WHERE id = $1 AND default_expense_account_id = $2`,
        [workspaceId, accountId],
      );
      await client.query(
        `UPDATE workspaces SET default_income_account_id = NULL
         WHERE id = $1 AND default_income_account_id = $2`,
        [workspaceId, accountId],
      );

      return 'ok';
    },
  );
}
