/**
 * Account Service — Phase 1.14 + Phase 1.17 + Phase 1.24 + Phase 1.30 + Phase LD++ + Phase 2.4
 *
 * Phase 1.14: Read-only list of account_sources for a workspace.
 * Phase 1.17: addAccount() — strict-format write path for /add_account command.
 * Phase 1.24: addAccount() now reads workspace.default_currency dynamically
 *             instead of hardcoding 'RUB'. Ensures new accounts always match
 *             the workspace's configured default currency (USDT for new workspaces).
 * Phase 1.30: hasAccounts() — lightweight count query for empty-state detection.
 *             addAccountWithCurrency() — like addAccount() but accepts explicit
 *             currency for the guided onboarding flow (overrides workspace default).
 * Phase 2.4: getAccountWithBalance() — single account with computed current balance.
 *            getWorkspaceAccountsWithBalances() — all accounts with balances,
 *            default account first, for the Account Picker keyboard.
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

import { withTenantTransaction, type PoolClient } from '@midas/database';
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
      if ((result.rowCount ?? 0) > 0) {
        // Atomically set default account pointers on the workspace only if unset.
        // This ensures the FIRST created account becomes the default — never overwritten.
        await client.query(
          `UPDATE workspaces
           SET default_expense_account_id = COALESCE(default_expense_account_id, $1),
               default_income_account_id  = COALESCE(default_income_account_id,  $1)
           WHERE id = $2`,
          [accountId, workspaceId],
        );
      }
      return result.rowCount ?? 0;
    },
  );

  return rowsInserted === 0 ? 'duplicate' : 'created';
}

// ─────────────────────────────────────────────────────────────
// addAccountReturningId — Phase 2.2 + Auto-suffix (Phase AC-DUP)
// ─────────────────────────────────────────────────────────────

/**
 * Result of addAccountReturningId().
 *   created             — new row inserted with the original name.
 *   created_with_suffix — original name was taken; inserted with auto-suffix (e.g. "Монобанк 2").
 *
 * In both cases accountId is always set (creation never fails due to duplicates).
 */
export interface AddAccountWithIdResult {
  status: 'created' | 'created_with_suffix' | 'created_as_child' | 'already_exists';
  accountId: string;
  /** Final name after auto-suffix or child creation */
  finalName?: string;
  /** ID of the existing account (only when status = 'already_exists') */
  existingAccountId?: string;
}

/**
 * Find the next available name with numeric suffix.
 * "Монобанк" → checks "Монобанк 2", "Монобанк 3"... until free slot found.
 *
 * Runs INSIDE an existing transaction — must receive the client.
 *
 * SEC-03: explicit workspace_id filter.
 * SEC-02: no float arithmetic — simple integer counter.
 */
async function findNextAvailableName(
  client: PoolClient,
  workspaceId: string,
  baseName: string,
): Promise<string> {
  // Fetch all names matching "baseName" or "baseName N" (N = integer).
  // NOTE: We do NOT filter by deleted_at IS NULL here because the UNIQUE index
  // (account_sources_workspace_id_name_key) covers ALL rows — including
  // soft-deleted ones. If we only checked active names, we might pick a name
  // like "Binance 2" that is soft-deleted, and the INSERT would fail with a
  // constraint violation (DatabaseError).
  const res = await client.query<{ name: string }>(
    `SELECT name FROM account_sources
     WHERE workspace_id = $1
       AND (name = $2 OR name LIKE $2 || ' %')`,
    [workspaceId, baseName],
  );

  // Build set of existing names for O(1) lookup
  const existingNames = new Set(res.rows.map((r: { name: string }) => r.name));

  // Find first free suffix starting from 2
  let suffix = 2;
  while (existingNames.has(`${baseName} ${suffix}`)) {
    suffix++;
    // Safety: cap at 100 to prevent infinite loop (should never happen in practice)
    if (suffix > 100) break;
  }
  return `${baseName} ${suffix}`;
}

/**
 * Insert a new account_sources row with an explicitly supplied currency and
 * return the generated account ULID on success.
 *
 * Phase AC-DUP: If the name already exists → auto-suffix ("Монобанк 2") and
 * return status='created_with_suffix'. The flow is NEVER interrupted by duplicates.
 *
 * @param workspaceId - Internal workspace ULID (from trusted backend — SEC-03)
 * @param userId      - Internal user ULID (required by withTenantTransaction)
 * @param name        - Account name (pre-validated, non-empty, max 100 chars)
 * @param currency    - Explicit currency code (pre-validated, non-empty, max 10 chars)
 * @returns AddAccountWithIdResult: { status, accountId, finalName? }
 *
 * SEC-03: INSERT runs inside withTenantTransaction — RLS enforced.
 * SEC-02: No financial amounts. No float arithmetic.
 * SEC-12: Name and currency NOT logged.
 */
export async function addAccountReturningId(
  workspaceId: string,
  userId: string,
  name: string,
  currency: string,
): Promise<AddAccountWithIdResult> {
  return withTenantTransaction<AddAccountWithIdResult>(
    workspaceId,
    userId,
    async (client) => {
      const accountId = generateUlid();

      // ── Attempt 1: try original name ────────────────────────────────────
      const result = await client.query<{ id: string }>(
        `INSERT INTO account_sources (id, workspace_id, name, type, currency)
         VALUES ($1, $2, $3, 'manual'::account_source_type, $4)
         ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING
         RETURNING id`,
        [accountId, workspaceId, name, currency],
      );

      if ((result.rowCount ?? 0) > 0) {
        // Original name was free — set workspace defaults if needed
        await client.query(
          `UPDATE workspaces
           SET default_expense_account_id = COALESCE(default_expense_account_id, $1),
               default_income_account_id  = COALESCE(default_income_account_id,  $1)
           WHERE id = $2`,
          [accountId, workspaceId],
        );
        return { status: 'created', accountId };
      }

      // ── Attempt 1b: check if conflict was with a soft-deleted row ───────
      // The UNIQUE index covers ALL rows (including soft-deleted), so
      // ON CONFLICT fires even when the existing row has deleted_at set.
      // If that's the case, reactivate the soft-deleted row with new currency
      // instead of creating a confusing "Binance 3" when "Binance" was merely deleted.
      const reactivated = await client.query<{ id: string }>(
        `UPDATE account_sources
         SET deleted_at = NULL,
             currency = $3,
             updated_at = NOW()
         WHERE workspace_id = $1
           AND name = $2
           AND deleted_at IS NOT NULL
         RETURNING id`,
        [workspaceId, name, currency],
      );

      if ((reactivated.rowCount ?? 0) > 0) {
        const reactivatedId = reactivated.rows[0]!.id;
        // Set workspace defaults if needed
        await client.query(
          `UPDATE workspaces
           SET default_expense_account_id = COALESCE(default_expense_account_id, $1),
               default_income_account_id  = COALESCE(default_income_account_id,  $1)
           WHERE id = $2`,
          [reactivatedId, workspaceId],
        );
        return { status: 'created', accountId: reactivatedId };
      }

      // ── Attempt 2: name conflict with ACTIVE account ────────────────────
      // Check: is the existing account in a DIFFERENT currency?
      // If yes → create child account under existing parent.
      // If same currency → return 'already_exists' so UI can offer rename.
      const existingRow = await client.query<{ id: string; currency: string }>(
        `SELECT id, currency FROM account_sources
         WHERE workspace_id = $1 AND name = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [workspaceId, name],
      );

      if (existingRow.rows.length > 0) {
        const existing = existingRow.rows[0]!;

        if (existing.currency.toUpperCase() === currency.toUpperCase()) {
          // ── SAME name + SAME currency → already exists ──
          return { status: 'already_exists', accountId: existing.id, existingAccountId: existing.id };
        }

        // ── SAME name + DIFFERENT currency → create child under existing ──
        const childName = `${name} \u00b7 ${currency}`;
        const childId = generateUlid();
        const childResult = await client.query<{ id: string }>(
          `INSERT INTO account_sources
             (id, workspace_id, name, type, currency, parent_account_id)
           VALUES ($1, $2, $3, 'manual'::account_source_type, $4, $5)
           ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING
           RETURNING id`,
          [childId, workspaceId, childName, currency, existing.id],
        );

        if ((childResult.rowCount ?? 0) > 0) {
          return { status: 'created_as_child', accountId: childId, finalName: childName };
        }

        // Child name also taken → already exists with this currency
        return { status: 'already_exists', accountId: existing.id, existingAccountId: existing.id };
      }

      // ── Fallback: auto-suffix (edge case — no active row found) ──────────
      const suffixedName = await findNextAvailableName(client, workspaceId, name);
      const suffixedId = generateUlid();

      await client.query(
        `INSERT INTO account_sources (id, workspace_id, name, type, currency)
         VALUES ($1, $2, $3, 'manual'::account_source_type, $4)`,
        [suffixedId, workspaceId, suffixedName, currency],
      );

      await client.query(
        `UPDATE workspaces
         SET default_expense_account_id = COALESCE(default_expense_account_id, $1),
             default_income_account_id  = COALESCE(default_income_account_id,  $1)
         WHERE id = $2`,
        [suffixedId, workspaceId],
      );

      return { status: 'created_with_suffix', accountId: suffixedId, finalName: suffixedName };
    },
  );
}


// ─────────────────────────────────────────────────────────────
// addChildAccount — Phase B-5/B-8
// ─────────────────────────────────────────────────────────────

/**
 * Insert a new child account under an existing parent account.
 *
 * Phase B-8: child accounts:
 *   - Have parent_account_id set to the parent's ULID.
 *   - Do NOT update workspace default_expense/income pointers
 *     (only top-level accounts should be workspace defaults).
 *   - Phase AC-DUP: auto-suffix on duplicate (same logic as addAccountReturningId).
 *
 * @param workspaceId     - Internal workspace ULID (SEC-03)
 * @param userId          - Internal user ULID
 * @param parentAccountId - ULID of the parent account (pre-validated by caller)
 * @param name            - Child account name (pre-validated, non-empty, max 100 chars)
 * @param currency        - Currency code (pre-validated)
 * @returns { status: 'created' | 'created_with_suffix', accountId, finalName? }
 *
 * SEC-03: INSERT inside withTenantTransaction — RLS enforced.
 * SEC-02: No financial arithmetic.
 * SEC-12: Name/currency NOT logged.
 */
export async function addChildAccount(
  workspaceId: string,
  userId: string,
  parentAccountId: string,
  name: string,
  currency: string,
): Promise<AddAccountWithIdResult> {
  return withTenantTransaction<AddAccountWithIdResult>(
    workspaceId,
    userId,
    async (client) => {
      const accountId = generateUlid();

      const result = await client.query<{ id: string }>(
        `INSERT INTO account_sources
           (id, workspace_id, name, type, currency, parent_account_id)
         VALUES ($1, $2, $3, 'manual'::account_source_type, $4, $5)
         ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING
         RETURNING id`,
        [accountId, workspaceId, name, currency, parentAccountId],
      );

      if ((result.rowCount ?? 0) > 0) {
        // Phase B-8: do NOT update workspace defaults for child accounts.
        return { status: 'created', accountId };
      }

      // Auto-suffix fallback
      const suffixedName = await findNextAvailableName(client, workspaceId, name);
      const suffixedId = generateUlid();
      await client.query(
        `INSERT INTO account_sources
           (id, workspace_id, name, type, currency, parent_account_id)
         VALUES ($1, $2, $3, 'manual'::account_source_type, $4, $5)`,
        [suffixedId, workspaceId, suffixedName, currency, parentAccountId],
      );
      return { status: 'created_with_suffix', accountId: suffixedId, finalName: suffixedName };
    },
  );
}

// ─────────────────────────────────────────────────────────────
// getWorkspaceDefaultAccount — Phase LD+
// ─────────────────────────────────────────────────────────────

export interface WorkspaceDefaultAccountInfo {
  accountId: string;
  name: string;
  currency: string;
  type: string;
  /** true if only 1 active account exists (first-time onboarding) */
  isFirst: boolean;
}

/**
 * Returns the workspace's real default expense account with display fields.
 * Also returns isFirst=true when only 1 active account exists.
 *
 * Used by success screens so they ALWAYS show the TRUE default account
 * (set on first creation via COALESCE) — not the most recently created one.
 *
 * SEC-03: withTenantTransaction (RLS enforced).
 */
export async function getWorkspaceDefaultAccount(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceDefaultAccountInfo | null> {
  return withTenantTransaction<WorkspaceDefaultAccountInfo | null>(
    workspaceId,
    userId,
    async (client) => {
      const res = await client.query<{
        acc_id: string | null;
        name: string | null;
        currency: string | null;
        type: string | null;
        active_count: string;
      }>(
        `SELECT
           a.id       AS acc_id,
           a.name,
           a.currency,
           a.type,
           (SELECT COUNT(*)::INT FROM account_sources
            WHERE workspace_id = $1 AND deleted_at IS NULL) AS active_count
         FROM workspaces w
         LEFT JOIN account_sources a
           ON a.id = w.default_expense_account_id
          AND a.deleted_at IS NULL
         WHERE w.id = $1
         LIMIT 1`,
        [workspaceId],
      );
      const row = res.rows[0];
      if (!row || !row.acc_id) return null;
      return {
        accountId: row.acc_id,
        name:      row.name ?? '',
        currency:  row.currency ?? '',
        type:      row.type ?? 'manual',
        isFirst:   Number(row.active_count) <= 1,
      };
    },
  );
}

// ─────────────────────────────────────────────────────────────
// getWorkspaceDefaultAccounts — Phase LD++ (D.4 success screen)
// ─────────────────────────────────────────────────────────────

/**
 * Minimal account info returned for each default slot.
 * Both fields are the same shape; null means "no default set".
 */
export interface DefaultAccountSlot {
  id: string;
  name: string;
  currency: string;
}

/**
 * Result of getWorkspaceDefaultAccounts().
 *
 * expense      — the current default expense account (null if not set or deleted).
 * income       — the current default income account  (null if not set or deleted).
 * activeCount  — number of non-deleted account_sources rows in the workspace.
 *                Used by D.4 to decide isFirst (activeCount <= 1 → Scenario 1).
 */
export interface WorkspaceDefaultAccounts {
  expense: DefaultAccountSlot | null;
  income:  DefaultAccountSlot | null;
  activeCount: number;
}

/**
 * Returns both default account slots (expense + income) for the workspace
 * in a single JOIN query, plus the total count of active accounts.
 *
 * Replaces getWorkspaceDefaultAccount() in the D.4 success screen so all four
 * scenario branches (isFirst / both / one / none) can be rendered correctly.
 *
 * getWorkspaceDefaultAccount() is preserved for backward compatibility with
 * the existing first-account success screen code.
 *
 * SQL strategy:
 *   FROM workspaces w
 *   LEFT JOIN account_sources ea ON ea.id = w.default_expense_account_id AND ea.deleted_at IS NULL
 *   LEFT JOIN account_sources ia ON ia.id = w.default_income_account_id  AND ia.deleted_at IS NULL
 *   + subquery COUNT(*) of active accounts
 *   WHERE w.id = $1
 *
 * SEC-03: withTenantTransaction (RLS enforced) + explicit WHERE w.id = $1.
 * SEC-12: Account names NOT logged.
 */
export async function getWorkspaceDefaultAccounts(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceDefaultAccounts> {
  return withTenantTransaction<WorkspaceDefaultAccounts>(
    workspaceId,
    userId,
    async (client) => {
      const res = await client.query<{
        ea_id:       string | null;
        ea_name:     string | null;
        ea_currency: string | null;
        ia_id:       string | null;
        ia_name:     string | null;
        ia_currency: string | null;
        active_count: string;
      }>(
        `SELECT
           ea.id       AS ea_id,
           ea.name     AS ea_name,
           ea.currency AS ea_currency,
           ia.id       AS ia_id,
           ia.name     AS ia_name,
           ia.currency AS ia_currency,
           (SELECT COUNT(*)::text
            FROM account_sources
            WHERE workspace_id = $1
              AND deleted_at IS NULL) AS active_count
         FROM workspaces w
         LEFT JOIN account_sources ea
           ON ea.id = w.default_expense_account_id
          AND ea.deleted_at IS NULL
         LEFT JOIN account_sources ia
           ON ia.id = w.default_income_account_id
          AND ia.deleted_at IS NULL
         WHERE w.id = $1
         LIMIT 1`,
        [workspaceId],
      );

      const row = res.rows[0];
      // Workspace not found — return safe empty state
      if (!row) {
        return { expense: null, income: null, activeCount: 0 };
      }

      const expense: DefaultAccountSlot | null =
        row.ea_id
          ? { id: row.ea_id, name: row.ea_name ?? '', currency: row.ea_currency ?? '' }
          : null;

      const income: DefaultAccountSlot | null =
        row.ia_id
          ? { id: row.ia_id, name: row.ia_name ?? '', currency: row.ia_currency ?? '' }
          : null;

      return {
        expense,
        income,
        activeCount: parseInt(row.active_count ?? '0', 10),
      };
    },
  );
}

// ─────────────────────────────────────────────────────────────
// getWorkspaceActiveAccounts — Phase LD+ / LD++ (D.4 portfolio line)
// ─────────────────────────────────────────────────────────────

/**
 * Phase LD++: extended with isExpenseDefault / isIncomeDefault flags.
 * These are computed by comparing each account id against the workspace
 * default_expense_account_id / default_income_account_id columns.
 */
export interface ActiveAccountSummary {
  id: string;
  name: string;
  currency: string;
  type: string;
  /** true if this account is the workspace default for expenses */
  isExpenseDefault: boolean;
  /** true if this account is the workspace default for incomes */
  isIncomeDefault: boolean;
}

/**
 * Returns all non-deleted accounts for the workspace, with role flags.
 * Ordered by created_at ASC so portfolio line is stable (oldest first).
 *
 * Phase LD++: SQL extended with LEFT JOIN workspaces to compute
 * isExpenseDefault / isIncomeDefault for each row.
 *
 * Used by D.4 hybrid success screen to render portfolio lines with role tags.
 *
 * SEC-03: withTenantTransaction (RLS enforced) + explicit workspace_id.
 */
export async function getWorkspaceActiveAccounts(
  workspaceId: string,
  userId: string,
): Promise<ActiveAccountSummary[]> {
  return withTenantTransaction<ActiveAccountSummary[]>(
    workspaceId,
    userId,
    async (client) => {
      const res = await client.query<{
        id: string;
        name: string;
        currency: string;
        type: string;
        is_expense_default: boolean;
        is_income_default: boolean;
      }>(
        // LEFT JOIN workspaces to read both default FK columns in one pass.
        // Defense-in-depth: explicit a.workspace_id = $1 alongside RLS.
        `SELECT
           a.id,
           a.name,
           a.currency,
           a.type,
           (a.id = w.default_expense_account_id) AS is_expense_default,
           (a.id = w.default_income_account_id)  AS is_income_default
         FROM account_sources a
         LEFT JOIN workspaces w ON w.id = a.workspace_id
         WHERE a.workspace_id = $1
           AND a.deleted_at IS NULL
         ORDER BY a.created_at ASC`,
        [workspaceId],
      );
      return res.rows.map((r) => ({
        id:               r.id,
        name:             r.name,
        currency:         r.currency,
        type:             r.type,
        isExpenseDefault: Boolean(r.is_expense_default),
        isIncomeDefault:  Boolean(r.is_income_default),
      }));
    },
  );
}

// ─────────────────────────────────────────────────────────────
// getAccountRoles — Phase LD++ (account card role flags)
// ─────────────────────────────────────────────────────────────

/**
 * Role flags for a single account.
 * Used by the account detail card (F.3 ⚪/🟢 buttons).
 */
export interface AccountRoleFlags {
  isExpenseDefault: boolean;
  isIncomeDefault:  boolean;
}

/**
 * Returns the expense/income role flags for a single account.
 *
 * Called by renderAccountCard() in webhook.route.ts before building
 * buildAccountActionsKeyboard(id, roles) so the ⚪/🟢 buttons are correct.
 *
 * Implementation: SELECT two boolean expressions directly in SQL
 * (id = w.default_expense_account_id) to avoid two round-trips.
 *
 * Returns { isExpenseDefault: false, isIncomeDefault: false } if the account
 * does not exist in the workspace (safe default — caller guards via account lookup).
 *
 * SEC-03: withTenantTransaction (RLS enforced) + explicit workspace_id filter.
 * SEC-12: Account id NOT logged (ULIDs are not PII but kept consistent).
 */
export async function getAccountRoles(
  workspaceId: string,
  userId: string,
  accountId: string,
): Promise<AccountRoleFlags> {
  return withTenantTransaction<AccountRoleFlags>(
    workspaceId,
    userId,
    async (client) => {
      const res = await client.query<{
        is_expense: boolean;
        is_income: boolean;
      }>(
        `SELECT
           (a.id = w.default_expense_account_id) AS is_expense,
           (a.id = w.default_income_account_id)  AS is_income
         FROM account_sources a
         LEFT JOIN workspaces w ON w.id = a.workspace_id
         WHERE a.id = $1
           AND a.workspace_id = $2
           AND a.deleted_at IS NULL`,
        [accountId, workspaceId],
      );
      const row = res.rows[0];
      if (!row) return { isExpenseDefault: false, isIncomeDefault: false };
      return {
        isExpenseDefault: Boolean(row.is_expense),
        isIncomeDefault:  Boolean(row.is_income),
      };
    },
  );
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

// ─────────────────────────────────────────────────────────────
// getAccountWithBalance — Phase 2.4 (Account-Aware Draft Card)
// ─────────────────────────────────────────────────────────────

/**
 * Account row extended with the computed current balance.
 *
 * balance is the all-time net balance of the account:
 *   initial_balance
 *   + SUM(income transactions)
 *   - SUM(expense transactions)
 *   (using the signed formula from balance.service.ts)
 *
 * Returned as a string to preserve NUMERIC precision (SEC-02).
 * NULL means the account has no transactions yet — caller should display
 * initial_balance (which is also returned as a string).
 */
export interface AccountWithBalance {
  id: string;
  name: string;
  currency: string;
  type: string;
  /** Computed current balance as a NUMERIC string (e.g. "15400.0000"). */
  balance: string;
  /** True if this is the workspace default expense account. */
  isExpenseDefault: boolean;
  /** True if this is the workspace default income account. */
  isIncomeDefault: boolean;
}

/**
 * Fetch a single account with its computed current balance.
 *
 * Balance formula (mirrors balance.service.ts — single source of truth):
 *   initial_balance
 *   + SUM(CASE WHEN intent IN ('income','debt_received') THEN base_amount ELSE -base_amount END)
 *   WHERE deleted_at IS NULL AND account_id = $accountId
 *
 * Returns null if the account does not exist in the workspace or is deleted.
 *
 * Used by confirmPreview() (PR 9) to show the math block in the draft card.
 *
 * SEC-01: accountId validated against workspace (explicit workspace_id filter).
 * SEC-02: balance computed in SQL NUMERIC — no float arithmetic.
 * SEC-03: withTenantTransaction (RLS enforced) + explicit workspace_id.
 * SEC-12: Account names NOT logged.
 *
 * @param workspaceId - Internal workspace ULID
 * @param userId      - Internal user ULID (required by withTenantTransaction)
 * @param accountId   - Account ULID (pre-validated via IDOR guard in caller)
 */
export async function getAccountWithBalance(
  workspaceId: string,
  userId: string,
  accountId: string,
): Promise<AccountWithBalance | null> {
  return withTenantTransaction<AccountWithBalance | null>(
    workspaceId,
    userId,
    async (client) => {
      const res = await client.query<{
        id: string;
        name: string;
        currency: string;
        type: string;
        balance: string;
        is_expense_default: boolean;
        is_income_default: boolean;
      }>(
        `SELECT
           a.id,
           a.name,
           a.currency,
           a.type,
           (
             a.initial_balance
             + COALESCE(
                 SUM(
                   CASE
                     WHEN t.transaction_intent IN ('income', 'debt_received')
                       THEN t.base_amount
                     WHEN t.transaction_intent = 'transfer'
                      AND t.transfer_direction = 'inbound'
                       THEN t.base_amount
                     WHEN t.transaction_intent = 'transfer'
                      AND (t.transfer_direction = 'outbound' OR t.transfer_direction IS NULL)
                       THEN -t.base_amount
                     ELSE -t.base_amount
                   END
                 ),
                 0
               )
           )::TEXT AS balance,
           (a.id = w.default_expense_account_id) AS is_expense_default,
           (a.id = w.default_income_account_id)  AS is_income_default
         FROM account_sources a
         LEFT JOIN transactions t
           ON t.account_id = a.id
          AND t.base_currency = a.currency
          AND t.deleted_at IS NULL
         LEFT JOIN workspaces w
           ON w.id = a.workspace_id
         WHERE a.id = $1
           AND a.workspace_id = $2
           AND a.deleted_at IS NULL
         GROUP BY a.id, a.name, a.currency, a.type, a.initial_balance,
                  w.default_expense_account_id, w.default_income_account_id`,
        [accountId, workspaceId],
      );

      const row = res.rows[0];
      if (!row) return null;

      return {
        id:               row.id,
        name:             row.name,
        currency:         row.currency,
        type:             row.type,
        balance:          row.balance,
        isExpenseDefault: Boolean(row.is_expense_default),
        isIncomeDefault:  Boolean(row.is_income_default),
      };
    },
  );
}

// ─────────────────────────────────────────────────────────────
// getWorkspaceAccountsWithBalances — Phase 2.4 (Account Picker)
// ─────────────────────────────────────────────────────────────

/**
 * Fetch all active accounts for the workspace with computed current balances.
 *
 * Ordering:
 *   1. Default expense account first (if intent === 'expense' | 'debt_given' | 'transfer').
 *   2. Default income account first  (if intent === 'income' | 'debt_received').
 *   3. Remaining accounts sorted by name ASC.
 *
 * Phase 2.4: This is the primary data source for buildAccountPickerV2Keyboard (PR 7).
 * Use toAccountPickerEntries() (below) to convert the result for the keyboard builder.
 *
 * Phase 2.4 filter: onboarding placeholder accounts are EXCLUDED
 * (`is_onboarding_placeholder = FALSE`). Placeholders are workspace-internal
 * accounts created during lazy-default onboarding; they should never appear
 * in the user-facing transaction picker.
 *
 * Balance formula: identical to getAccountWithBalance() — mirrors balance.service.ts.
 *
 * intent is used ONLY for sort priority — it does NOT filter accounts.
 * All non-placeholder accounts are returned so the user can pick any.
 *
 * Returns an empty array if the workspace has no active non-placeholder accounts.
 *
 * SEC-02: balance computed in SQL NUMERIC — no float arithmetic.
 * SEC-03: withTenantTransaction (RLS enforced) + explicit workspace_id.
 * SEC-12: Account names NOT logged.
 *
 * @param workspaceId - Internal workspace ULID
 * @param userId      - Internal user ULID
 * @param intent      - Transaction intent (used for sort priority only)
 */
export async function getWorkspaceAccountsWithBalances(
  workspaceId: string,
  userId: string,
  intent: string | null,
  parsedCurrency: string | null = null,
): Promise<AccountWithBalance[]> {
  return withTenantTransaction<AccountWithBalance[]>(
    workspaceId,
    userId,
    async (client) => {
      // Determine which default FK column to sort first.
      // expense/debt_given/transfer → prioritise expense default.
      // income/debt_received       → prioritise income default.
      // null / unknown             → no priority (sort by name).
      const incomeIntents = new Set(['income', 'debt_received']);
      const sortByIncome = intent !== null && incomeIntents.has(intent);

      const res = await client.query<{
        id: string;
        name: string;
        currency: string;
        type: string;
        balance: string;
        is_expense_default: boolean;
        is_income_default: boolean;
      }>(
        `SELECT
           a.id,
           a.name,
           a.currency,
           a.type,
           (
             a.initial_balance
             + COALESCE(
                 SUM(
                   CASE
                     WHEN t.transaction_intent IN ('income', 'debt_received')
                       THEN t.base_amount
                     WHEN t.transaction_intent = 'transfer'
                   AND t.transfer_direction = 'inbound'
                 THEN t.base_amount
                 WHEN t.transaction_intent = 'transfer'
               AND (t.transfer_direction = 'outbound' OR t.transfer_direction IS NULL)
           THEN -t.base_amount
           ELSE -t.base_amount
           END
           ),
           0
           )
           )::TEXT AS balance,
           (a.id = w.default_expense_account_id) AS is_expense_default,
           (a.id = w.default_income_account_id)  AS is_income_default
           FROM account_sources a
           LEFT JOIN transactions t
           ON t.account_id = a.id
           AND t.base_currency = a.currency
           AND t.deleted_at IS NULL
           LEFT JOIN workspaces w
           ON w.id = a.workspace_id
           WHERE a.workspace_id = $1
           AND a.deleted_at IS NULL
           AND a.is_onboarding_placeholder = FALSE
           GROUP BY a.id, a.name, a.currency, a.type, a.initial_balance,
           w.default_expense_account_id, w.default_income_account_id
           ORDER BY
           CASE
           WHEN $2 AND (a.id = w.default_income_account_id)  THEN 0
           WHEN NOT $2 AND (a.id = w.default_expense_account_id) THEN 0
           ELSE 1
           END ASC,
           a.name ASC`,
        [workspaceId, sortByIncome],
      );

      const rawAccounts = res.rows.map((row) => ({
        id:               row.id,
        name:             row.name,
        currency:         row.currency,
        type:             row.type,
        balance:          row.balance,
        isExpenseDefault: Boolean(row.is_expense_default),
        isIncomeDefault:  Boolean(row.is_income_default),
      }));

      // ── Currency-context filtering ──────────────────────────────────────
      // Mirrors ai-parse.worker.ts + draft-expiration.worker.ts logic.
      //
      // No filter needed (return all):
      //   parsedCurrency = null (unknown currency, show everything)
      //
      // Strict exact-match filter (return only matching currency):
      //   intent === 'transfer' (both sides must match their currency)
      //   crypto / stablecoin currency (can’t cross-pay BTC with ETH)
      //
      // Fiat cross-currency — sort, don’t filter:
      //   intent = expense/income/debt + fiat currency →
      //   exact-currency accounts first, then other fiat accounts.
      //   Cross-currency payment (e.g. USD price on EUR card) is valid;
      //   the XFX flow handles conversion on the confirmation card.
      if (!parsedCurrency) return rawAccounts;

      const txCur = parsedCurrency.toUpperCase();
      const isTransfer = intent === 'transfer';

      // Currency classifier (mirrors PICKER_STABLECOINS / PICKER_KNOWN_CRYPTOS)
      const STABLES = new Set(['USDT','USDC','DAI','BUSD','TUSD','USDP','FDUSD','PYUSD','USDS','GUSD']);
      const CRYPTOS = new Set(['BTC','ETH','BNB','SOL','ADA','XRP','DOGE','DOT','AVAX','MATIC',
        'LINK','LTC','TRX','XMR','ETC','XLM','ATOM','FIL','NEAR','APT',
        'ARB','OP','INJ','TON','NOT','DOGS','HMSTR','CATI']);
      const isFiat = !STABLES.has(txCur) && !CRYPTOS.has(txCur) && /^[A-Z]{2,5}$/.test(txCur);

      if (isTransfer || !isFiat) {
        // Transfer or crypto/stablecoin: strict exact-match only
        return rawAccounts.filter(a => a.currency.toUpperCase() === txCur);
      }

      // Fiat expense/income/debt: only fiat accounts, exact-currency first
      const exact = rawAccounts.filter(a => a.currency.toUpperCase() === txCur);
      const otherFiat = rawAccounts.filter(a => {
        const c = a.currency.toUpperCase();
        return c !== txCur && !STABLES.has(c) && !CRYPTOS.has(c) && /^[A-Z]{2,5}$/.test(c);
      });
      // crypto accounts excluded — fiat transaction doesn't need crypto accounts
      return [...exact, ...otherFiat];
    },
  );
}

// ─────────────────────────────────────────────────────────────
// toAccountPickerEntries — Phase 2.4 adapter
// ─────────────────────────────────────────────────────────────

/**
 * Convert `AccountWithBalance[]` to `AccountPickerEntry[]`.
 *
 * This adapter decouples the two types:
 *   - `AccountWithBalance` is the service-layer result (id, name, currency, type, balance, isXxxDefault)
 *   - `AccountPickerEntry` is the UI-layer contract (id, name, currency, balance) imported by
 *     `buildAccountPickerV2Keyboard` in account-inline-keyboard.service.ts.
 *
 * Caller is responsible for HTML-escaping names before passing to keyboard builders.
 * Here we return raw names (pre-escaping happens in the webhook handler at call site).
 *
 * Pure function — no I/O, no side effects. Safe to call on empty arrays.
 *
 * @param accounts - Result from getWorkspaceAccountsWithBalances()
 * @returns Array of AccountPickerEntry ready for buildAccountPickerV2Keyboard()
 */
export function toAccountPickerEntries(
  accounts: AccountWithBalance[],
): Array<{ id: string; name: string; currency: string; balance: string }> {
  return accounts.map((a) => ({
    id:       a.id,
    name:     a.name,
    currency: a.currency,
    balance:  a.balance,
  }));
}

// ─────────────────────────────────────────────────────────────
// softDeletePlaceholderAccount — Lazy Default (Phase LD)
// ─────────────────────────────────────────────────────────────

/**
 * Soft-delete the onboarding placeholder account for a workspace.
 *
 * Called immediately after a user successfully creates their own custom account
 * during onboarding (ac:currency → bal_skip / bal_input success path).
 *
 * Finds all account_sources rows where:
 *   - is_onboarding_placeholder = TRUE
 *   - deleted_at IS NULL          (not already soft-deleted)
 *   - workspace_id = workspaceId  (scoped to this workspace, defense-in-depth)
 *
 * Also clears default_expense_account_id / default_income_account_id on the
 * workspace if they reference the placeholder — prevents stale FK references.
 *
 * Idempotent: if no placeholder exists (or it was already deleted), returns 'none'.
 *
 * @param workspaceId - Internal workspace ULID (from trusted backend — SEC-03)
 * @param userId      - Internal user ULID (required by withTenantTransaction)
 * @returns 'deleted' — at least one placeholder was soft-deleted.
 *          'none'    — no active placeholder found (already gone or never existed).
 *
 * SEC-03: Runs inside withTenantTransaction — RLS + explicit workspace_id filter.
 * SEC-02: No financial amounts.
 * SEC-12: No account names logged.
 */
export async function softDeletePlaceholderAccount(
  workspaceId: string,
  userId: string,
): Promise<'deleted' | 'none'> {
  return withTenantTransaction<'deleted' | 'none'>(
    workspaceId,
    userId,
    async (client) => {
      // Soft-delete all placeholder rows for this workspace in one statement.
      // RETURNING id lets us check if anything was actually deleted.
      const result = await client.query<{ id: string }>(
        `UPDATE account_sources
         SET deleted_at = NOW(), updated_at = NOW()
         WHERE workspace_id = $1
           AND is_onboarding_placeholder = TRUE
           AND deleted_at IS NULL
         RETURNING id`,
        [workspaceId],
      );

      if ((result.rowCount ?? 0) === 0) return 'none';

      // Clear any workspace default account pointers that referenced the placeholder.
      // This is safe even if the placeholder was never set as a default.
      const deletedIds = result.rows.map((r) => r.id);
      for (const deletedId of deletedIds) {
        await client.query(
          `UPDATE workspaces
           SET default_expense_account_id = NULL
           WHERE id = $1 AND default_expense_account_id = $2`,
          [workspaceId, deletedId],
        );
        await client.query(
          `UPDATE workspaces
           SET default_income_account_id = NULL
           WHERE id = $1 AND default_income_account_id = $2`,
          [workspaceId, deletedId],
        );
      }

      return 'deleted';
    },
  );
}

// ─────────────────────────────────────────────────────────────
// activatePlaceholderAccount — Lazy Default (Phase LD)
// ─────────────────────────────────────────────────────────────

/**
 * Activate the onboarding placeholder account (promote it to a real account).
 *
 * Called when the user taps "Пропустить" (ac:skip) — they chose not to create
 * a custom account, so the Default placeholder should become their real account.
 *
 * Sets is_onboarding_placeholder = FALSE on all placeholder rows in the workspace.
 * The account already has correct name ('Default'), currency ('USDT'), and
 * initial_balance (0) — no further changes needed.
 *
 * Idempotent: if no placeholder exists, returns 'none'.
 *
 * @param workspaceId - Internal workspace ULID (from trusted backend — SEC-03)
 * @param userId      - Internal user ULID (required by withTenantTransaction)
 * @returns 'activated' — at least one placeholder was activated.
 *          'none'      — no placeholder found (already activated or never existed).
 *
 * SEC-03: Runs inside withTenantTransaction — RLS + explicit workspace_id filter.
 * SEC-02: No financial amounts.
 * SEC-12: No account names logged.
 */
export async function activatePlaceholderAccount(
  workspaceId: string,
  userId: string,
): Promise<'activated' | 'none'> {
  return withTenantTransaction<'activated' | 'none'>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE account_sources
         SET is_onboarding_placeholder = FALSE, updated_at = NOW()
         WHERE workspace_id = $1
           AND is_onboarding_placeholder = TRUE
           AND deleted_at IS NULL
         RETURNING id`,
        [workspaceId],
      );

      return (result.rowCount ?? 0) > 0 ? 'activated' : 'none';
    },
  );
}

// ─────────────────────────────────────────────────────────────
// Default account role mutations — Phase LD++
// ─────────────────────────────────────────────────────────────
//
// Business rules:
//   - SET expense:   UPDATE workspaces SET default_expense_account_id = $id WHERE id = $wid
//   - CLEAR expense: UPDATE workspaces SET default_expense_account_id = NULL WHERE id = $wid
//   - SET income:    UPDATE workspaces SET default_income_account_id  = $id  WHERE id = $wid
//   - CLEAR income:  UPDATE workspaces SET default_income_account_id  = NULL WHERE id = $wid
//
// SET is idempotent: one UPDATE unconditionally overwrites the FK.
// The previous holder automatically loses the role (no separate UPDATE needed).
// One account CAN be both expense AND income default simultaneously.
//
// Pre-flight: each SET function first verifies the account exists and belongs
// to the workspace (not deleted) to prevent ULID poisoning (SEC-03).
//
// SEC-03: withTenantTransaction (RLS) + explicit workspace_id checks.
// SEC-12: Account ids NOT logged.

/**
 * Set the workspace's default expense account.
 *
 * Any previous expense-default holder automatically loses the role
 * (single UPDATE on workspaces). Idempotent — setting the same account twice
 * is safe.
 *
 * @returns 'ok'         — FK updated.
 *          'not_found'  — accountId does not exist / not in this workspace / deleted.
 */
/**
 * Set the role for an account. Used for cyclical role toggling.
 *
 * @param role 'none' | 'expense' | 'income' | 'main'
 * @returns 'ok' | 'not_found'
 */
export async function setAccountRole(
  workspaceId: string,
  userId: string,
  accountId: string,
  role: 'none' | 'expense' | 'income' | 'main',
): Promise<'ok' | 'not_found'> {
  return withTenantTransaction<'ok' | 'not_found'>(
    workspaceId,
    userId,
    async (client) => {
      // Pre-flight: verify the account belongs to this workspace and is not deleted.
      const check = await client.query<{ id: string }>(
        `SELECT id FROM account_sources
         WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [accountId, workspaceId],
      );
      if (check.rows.length === 0) return 'not_found';

      const wRes = await client.query<{ default_expense_account_id: string | null; default_income_account_id: string | null }>(
        `SELECT default_expense_account_id, default_income_account_id FROM workspaces WHERE id = $1`,
        [workspaceId],
      );
      const w = wRes.rows[0];
      if (!w) return 'not_found';

      let newExp = w.default_expense_account_id;
      let newInc = w.default_income_account_id;

      if (role === 'none') {
        if (newExp === accountId) newExp = null;
        if (newInc === accountId) newInc = null;
      } else if (role === 'expense') {
        newExp = accountId;
        if (newInc === accountId) newInc = null;
      } else if (role === 'income') {
        newInc = accountId;
        if (newExp === accountId) newExp = null;
      } else if (role === 'main') {
        newExp = accountId;
        newInc = accountId;
      }

      await client.query(
        `UPDATE workspaces
         SET default_expense_account_id = $2,
             default_income_account_id = $3
         WHERE id = $1`,
        [workspaceId, newExp, newInc],
      );
      return 'ok';
    },
  );
}
