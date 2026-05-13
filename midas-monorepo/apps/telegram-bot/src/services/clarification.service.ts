/**
 * Clarification Service — Phase 1.32 + Phase 2.4
 *
 * Patch functions for needs_clarification TransactionDraft records.
 * Called by webhook.route.ts when the user responds to a clarification question.
 *
 * Three patch operations (one-question-at-a-time UX):
 *   patchDraftAmount()   — user replied with a number (amount text intercept)
 *   patchDraftIntent()   — user tapped a clar:intent:* button
 *   patchDraftCategory() — user tapped a clar:cat:* or clar:nocat: button
 *
 * State machine: needs_clarification → pending_user (when all required fields present)
 * Priority: amount → intent → category (determines which field to ask about next)
 *
 * Phase 2.4: DraftFields extended with account_id, account_debit_amount,
 *   account_debit_currency. getDraftFields() SQL updated accordingly.
 *   These fields drive the Account-Aware Draft Card (PR 6, PR 9, PR 11).
 *   patchDraftAccount()      — user tapped an account picker button (ia:acc:pick:*)
 *   patchDraftDebitAmount()  — user entered cross-currency debit amount (ia:acc:xfx:*)
 *
 * SEC-01: intent validated against canonical enum; categoryId validated against DB.
 *         accountId validated against account_sources (IDOR guard — PR 4).
 * SEC-02: amountStr validated against NUMERIC regex before any DB write.
 *         account_debit_amount written as $val::NUMERIC (read back as ::TEXT — PR 3).
 * SEC-03: All DB operations use withTenantTransaction for RLS isolation.
 * SEC-12: Raw text inputs NOT logged. Account names never logged.
 */

import { withTenantTransaction } from '@midas/database';

// ─────────────────────────────────────────────────────────────
// NUMERIC validation regex (SEC-02)
// Mirrors AmountString in @midas/ai-core/schemas.ts
// ─────────────────────────────────────────────────────────────

const AMOUNT_REGEX = /^(?!0+(?:\.0+)?$)(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/;

/** Validate a user-supplied amount string before DB write (SEC-02). */
export function validateAmountString(input: string): string | null {
  const trimmed = input.trim();
  if (!AMOUNT_REGEX.test(trimmed)) return null;
  return trimmed;
}

// ─────────────────────────────────────────────────────────────
// Shared result type
// ─────────────────────────────────────────────────────────────

export type PatchDraftResult =
  | { status: 'ready'; draftId: string }                            // Now pending_user
  | { status: 'still_needs'; field: 'amount' | 'intent' | 'category' } // More clarification needed
  | { status: 'not_found' }                                         // Draft not found or expired
  | { status: 'wrong_state' };                                      // Not in needs_clarification

// ─────────────────────────────────────────────────────────────
// patchDraftAmount — Phase 1.32
// ─────────────────────────────────────────────────────────────

/**
 * Patch parsed_amount on a needs_clarification draft.
 *
 * Called when the user replies with a number after the bot asks "Сколько?".
 * amountStr must be pre-validated by validateAmountString() before calling.
 *
 * Transitions to pending_user if intent is also present; otherwise keeps
 * needs_clarification and sets clarification_field = 'intent'.
 *
 * SEC-02: amountStr is validated before this function is called.
 * SEC-03: withTenantTransaction enforces RLS.
 */
export async function patchDraftAmount(
  workspaceId: string,
  userId: string,
  draftId: string,
  amountStr: string,
): Promise<PatchDraftResult> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    const row = await client.query<{
      id: string;
      status: string;
      parsed_intent: string | null;
      expires_at: string;
    }>(
      `SELECT id, status, parsed_intent, expires_at
       FROM transaction_drafts
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE SKIP LOCKED`,
      [draftId, workspaceId],
    );

    if (row.rows.length === 0) return { status: 'not_found' };
    const draft = row.rows[0];
    if (!draft) return { status: 'not_found' };
    if (draft.status !== 'needs_clarification' && draft.status !== 'pending_user') return { status: 'wrong_state' };
    if (new Date(draft.expires_at) <= new Date()) return { status: 'not_found' };

    const hasIntent = draft.parsed_intent !== null;
    const nextStatus = hasIntent ? 'pending_user' : 'needs_clarification';
    const nextClarField = hasIntent ? null : 'intent';

    await client.query(
      `UPDATE transaction_drafts
       SET parsed_amount = $1,
           status = $2,
           clarification_field = $3,
           updated_at = NOW()
       WHERE id = $4 AND workspace_id = $5`,
      [amountStr, nextStatus, nextClarField, draftId, workspaceId],
    );

    if (nextStatus === 'pending_user') {
      return { status: 'ready', draftId };
    }
    return { status: 'still_needs', field: 'intent' };
  });
}

// ─────────────────────────────────────────────────────────────
// patchDraftIntent — Phase 1.32
// ─────────────────────────────────────────────────────────────

const VALID_INTENTS = new Set(['expense', 'income', 'debt_given', 'debt_received', 'transfer']);

/**
 * Patch parsed_intent on a needs_clarification draft.
 *
 * Called when user taps a clar:intent:* button.
 * Transitions to pending_user if amount is also present.
 * Otherwise stays needs_clarification with clarification_field = 'amount'.
 *
 * SEC-01: intent validated against canonical enum.
 * SEC-03: withTenantTransaction enforces RLS.
 */
export async function patchDraftIntent(
  workspaceId: string,
  userId: string,
  draftId: string,
  intent: string,
): Promise<PatchDraftResult> {
  if (!VALID_INTENTS.has(intent)) {
    return { status: 'not_found' }; // invalid intent = treat as not found (safe fallback)
  }

  return withTenantTransaction(workspaceId, userId, async (client) => {
    const row = await client.query<{
      id: string;
      status: string;
      parsed_amount: string | null;
      expires_at: string;
    }>(
      `SELECT id, status, parsed_amount::TEXT AS parsed_amount, expires_at
       FROM transaction_drafts
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE SKIP LOCKED`,
      [draftId, workspaceId],
    );

    if (row.rows.length === 0) return { status: 'not_found' };
    const draft = row.rows[0];
    if (!draft) return { status: 'not_found' };
    if (draft.status !== 'needs_clarification' && draft.status !== 'pending_user') return { status: 'wrong_state' };
    if (new Date(draft.expires_at) <= new Date()) return { status: 'not_found' };

    const hasAmount = draft.parsed_amount !== null;
    const nextStatus = hasAmount ? 'pending_user' : 'needs_clarification';
    const nextClarField = hasAmount ? null : 'amount';

    await client.query(
      `UPDATE transaction_drafts
       SET parsed_intent = $1,
           status = $2,
           clarification_field = $3,
           updated_at = NOW()
       WHERE id = $4 AND workspace_id = $5`,
      [intent, nextStatus, nextClarField, draftId, workspaceId],
    );

    if (nextStatus === 'pending_user') {
      return { status: 'ready', draftId };
    }
    return { status: 'still_needs', field: 'amount' };
  });
}

// ─────────────────────────────────────────────────────────────
// patchDraftCategory — Phase 1.32
// ─────────────────────────────────────────────────────────────

/**
 * Patch category_id on a needs_clarification or pending_user draft.
 *
 * Called when user taps a clar:cat:* or clar:nocat: button.
 * Always transitions to pending_user (category is optional — missing category
 * never blocks final confirmation after amount + intent are present).
 *
 * categoryId = null means "without category" (clar:nocat: button).
 *
 * SEC-01: categoryId validated against categories table (IDOR guard).
 * SEC-03: withTenantTransaction enforces RLS.
 */
export async function patchDraftCategory(
  workspaceId: string,
  userId: string,
  draftId: string,
  categoryId: string | null,
): Promise<PatchDraftResult> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    // Validate categoryId belongs to this workspace (IDOR guard — SEC-01)
    if (categoryId !== null) {
      const catCheck = await client.query<{ id: string }>(
        `SELECT id FROM categories WHERE id = $1 AND workspace_id = $2`,
        [categoryId, workspaceId],
      );
      if (catCheck.rows.length === 0) {
        return { status: 'not_found' };
      }
    }

    const row = await client.query<{
      id: string;
      status: string;
      expires_at: string;
    }>(
      `SELECT id, status, expires_at
       FROM transaction_drafts
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE SKIP LOCKED`,
      [draftId, workspaceId],
    );

    if (row.rows.length === 0) return { status: 'not_found' };
    const draft = row.rows[0];
    if (!draft) return { status: 'not_found' };
    if (draft.status !== 'needs_clarification' && draft.status !== 'pending_user') {
      return { status: 'wrong_state' };
    }
    if (new Date(draft.expires_at) <= new Date()) return { status: 'not_found' };

    await client.query(
      `UPDATE transaction_drafts
       SET category_id = $1,
           status = 'pending_user',
           clarification_field = NULL,
           updated_at = NOW()
       WHERE id = $2 AND workspace_id = $3`,
      [categoryId, draftId, workspaceId],
    );

    return { status: 'ready', draftId };
  });
}

// ─────────────────────────────────────────────────────────────
// getDraftFields — Phase 1.35 draft edit sub-menu
// ─────────────────────────────────────────────────────────────

export type DraftFields = {
  id: string;
  status: 'pending_user' | 'needs_clarification';
  parsed_intent: string | null;
  parsed_amount: string | null;
  parsed_currency: string | null;
  item_name: string | null;
  parsed_category_hint: string | null;
  category_id: string | null;
  // ── Phase 2.4: Account-Aware Draft Card fields ──────────────────────────
  /** FK to account_sources. Null = no account explicitly linked yet. */
  account_id: string | null;
  /**
   * Explicit debit amount in the account's currency.
   * Null = same as parsed_amount (no cross-currency override).
   * Stored as NUMERIC in DB; returned as TEXT string via ::TEXT cast (SEC-02).
   */
  account_debit_amount: string | null;
  /**
   * Currency of account_debit_amount (e.g. 'RUB').
   * Null when account_debit_amount is null.
   */
  account_debit_currency: string | null;
};

/**
 * Fetch lightweight draft fields for the edit sub-menu and draft card rendering.
 * Returns null if not found, expired, or in wrong state.
 *
 * Phase 2.4: Returns account_id, account_debit_amount, account_debit_currency
 * in addition to the Phase 1.35 fields. These are used by:
 *   - confirmPreview() (PR 9) to build the Account-Aware math block
 *   - buildAccountPickerForDraft() caller (PR 11) to know current account
 *
 * account_debit_amount is cast to TEXT to preserve NUMERIC precision (SEC-02).
 *
 * SEC-03: withTenantTransaction enforces RLS.
 * SEC-12: Account names NOT logged (only IDs are fetched here).
 */
export async function getDraftFields(
  workspaceId: string,
  userId: string,
  draftId: string,
): Promise<DraftFields | null> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    const result = await client.query<DraftFields>(
      `SELECT id, status, parsed_intent, parsed_amount::TEXT AS parsed_amount, parsed_currency,
              item_name, parsed_category_hint, category_id,
              account_id,
              account_debit_amount::TEXT AS account_debit_amount,
              account_debit_currency
       FROM transaction_drafts
       WHERE id = $1 AND workspace_id = $2
         AND status IN ('pending_user','needs_clarification')
         AND expires_at > NOW()`,
      [draftId, workspaceId],
    );
    return result.rows[0] ?? null;
  });
}

// ─────────────────────────────────────────────────────────────
// patchDraftCurrency — Phase 1.35 draft edit sub-menu
// ─────────────────────────────────────────────────────────────

// Currency code: 2-8 uppercase letters/digits (USD, USDT, BTC, EUR…)
const CURRENCY_REGEX = /^[A-Z0-9]{2,8}$/;

/** Validate a user-supplied currency code before DB write (SEC-01). */
export function validateCurrencyCode(input: string): string | null {
  const upper = input.trim().toUpperCase();
  if (!CURRENCY_REGEX.test(upper)) return null;
  return upper;
}

/**
 * Patch parsed_currency on a pending_user or needs_clarification draft.
 *
 * SEC-01: currency validated against regex before DB write.
 * SEC-03: withTenantTransaction enforces RLS.
 */
export async function patchDraftCurrency(
  workspaceId: string,
  userId: string,
  draftId: string,
  currency: string,
): Promise<PatchDraftResult> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    const row = await client.query<{ id: string; status: string; expires_at: string }>(
      `SELECT id, status, expires_at
       FROM transaction_drafts
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE SKIP LOCKED`,
      [draftId, workspaceId],
    );

    if (row.rows.length === 0) return { status: 'not_found' };
    const draft = row.rows[0];
    if (!draft) return { status: 'not_found' };
    if (!['pending_user', 'needs_clarification'].includes(draft.status)) return { status: 'wrong_state' };
    if (new Date(draft.expires_at) <= new Date()) return { status: 'not_found' };

    await client.query(
      `UPDATE transaction_drafts
       SET parsed_currency = $1, updated_at = NOW()
       WHERE id = $2 AND workspace_id = $3`,
      [currency, draftId, workspaceId],
    );

    return { status: 'ready', draftId };
  });
}

// ─────────────────────────────────────────────────────────────
// patchDraftAccount — Phase 2.4 Account-Aware Draft Card (PR 4)
// ─────────────────────────────────────────────────────────────

/**
 * Patch account_id on a pending_user or needs_clarification draft.
 *
 * Called when the user selects an account from the account picker
 * (callback_data: ia:acc:pick:<accountId>).
 *
 * Two-step write:
 *   1. IDOR guard — verify the account exists, is not deleted,
 *      and belongs to this workspace (prevents cross-workspace account injection).
 *   2. Lock + state-check the draft, then UPDATE account_id.
 *
 * accountId = null is allowed: delinks the current account without setting a new one.
 * Used by the "🔄 Сменить счёт" button to clear the selection before
 * showing the picker again (idempotent, safe).
 *
 * Does NOT change draft.status — account selection is orthogonal to the
 * amount/intent/category clarification state machine. The caller (webhook.route.ts)
 * is responsible for re-rendering the draft card after this patch.
 *
 * @param workspaceId - Internal workspace ULID (trusted backend, SEC-03)
 * @param userId      - Internal user ULID (required by withTenantTransaction)
 * @param draftId     - ULID of the draft to patch
 * @param accountId   - ULID of the account to link, or null to delink
 *
 * @returns 'ready'       — account_id patched successfully
 * @returns 'not_found'   — draft not found/expired, or accountId IDOR check failed
 * @returns 'wrong_state' — draft not in pending_user or needs_clarification
 *
 * SEC-01: accountId validated against account_sources (IDOR guard).
 *         accountId=null bypasses the guard (delink is always safe).
 * SEC-03: withTenantTransaction enforces RLS + explicit workspace_id filter.
 * SEC-12: Account names never logged (only IDs are used).
 */
export async function patchDraftAccount(
  workspaceId: string,
  userId: string,
  draftId: string,
  accountId: string | null,
): Promise<PatchDraftResult> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    // ── Step 1: IDOR guard (skip for null — delink is unconditionally safe) ──
    if (accountId !== null) {
      const accountCheck = await client.query<{ id: string }>(
        `SELECT id FROM account_sources
         WHERE id = $1
           AND workspace_id = $2
           AND deleted_at IS NULL`,
        [accountId, workspaceId],
      );
      if (accountCheck.rows.length === 0) {
        // Account does not exist, is deleted, or belongs to another workspace.
        // Treat as not_found — safe fallback, no information leakage (SEC-01).
        return { status: 'not_found' };
      }
    }

    // ── Step 2: Lock draft + state/expiry check ──────────────────────────────
    const row = await client.query<{ id: string; status: string; expires_at: string }>(
      `SELECT id, status, expires_at
       FROM transaction_drafts
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE SKIP LOCKED`,
      [draftId, workspaceId],
    );

    if (row.rows.length === 0) return { status: 'not_found' };
    const draft = row.rows[0];
    if (!draft) return { status: 'not_found' };
    if (!['pending_user', 'needs_clarification'].includes(draft.status)) {
      return { status: 'wrong_state' };
    }
    if (new Date(draft.expires_at) <= new Date()) return { status: 'not_found' };

    // ── Step 3: Patch account_id ─────────────────────────────────────────────
    await client.query(
      `UPDATE transaction_drafts
       SET account_id = $1,
           updated_at = NOW()
       WHERE id = $2 AND workspace_id = $3`,
      [accountId, draftId, workspaceId],
    );

    return { status: 'ready', draftId };
  });
}

// ─────────────────────────────────────────────────────────────
// patchDraftDebitAmount — Phase 2.4 Account-Aware Draft Card (PR 5)
// ─────────────────────────────────────────────────────────────

/**
 * Patch account_debit_amount and account_debit_currency on a draft.
 *
 * Used in the cross-currency scenario: when the linked account's currency
 * differs from the transaction's parsed_currency, the user enters an explicit
 * debit amount in the account's currency.
 *
 * Example: transaction is 500 USD (parsed_amount='500', parsed_currency='USD'),
 * account is Bybit USDT — user enters '501.5' USDT as the debit amount.
 * Stored as: account_debit_amount='501.5', account_debit_currency='USDT'.
 *
 * Both fields are written atomically in a single UPDATE.
 * Passing amountStr=null + currency=null clears both fields (reset the override).
 * Passing a non-null amountStr without currency (or vice-versa) is rejected as
 * invalid_input — the two fields are inseparable.
 *
 * NUMERIC precision: amountStr is written as $val::NUMERIC to Postgres.
 * On read it is returned as TEXT via getDraftFields() (::TEXT cast, PR 3).
 * No floating-point math ever occurs in the service layer (SEC-02).
 *
 * @param workspaceId - Internal workspace ULID (trusted backend, SEC-03)
 * @param userId      - Internal user ULID (required by withTenantTransaction)
 * @param draftId     - ULID of the draft to patch
 * @param amountStr   - Validated NUMERIC string (e.g. '501.5'), or null to clear
 * @param currency    - Validated currency code (e.g. 'USDT'), or null to clear
 *
 * @returns 'ready'         — fields patched successfully
 * @returns 'not_found'     — draft not found or expired
 * @returns 'wrong_state'   — draft not in pending_user or needs_clarification
 * @returns 'invalid_input' — amountStr/currency mismatch (one null, one non-null)
 *                            or amountStr/currency fail validation
 *
 * SEC-02: amountStr validated by validateAmountString() before any DB write.
 *         currency validated by validateCurrencyCode() before any DB write.
 *         amountStr written as $val::NUMERIC (not TEXT) for DB-level precision.
 * SEC-03: withTenantTransaction enforces RLS + explicit workspace_id filter.
 * SEC-12: No values logged.
 */

export type PatchDebitAmountResult =
  | PatchDraftResult
  | { status: 'invalid_input'; reason: 'amount_currency_mismatch' | 'invalid_amount' | 'invalid_currency' };

export async function patchDraftDebitAmount(
  workspaceId: string,
  userId: string,
  draftId: string,
  amountStr: string | null,
  currency: string | null,
): Promise<PatchDebitAmountResult> {
  // ── Input validation (SEC-02 / SEC-01) ────────────────────────────────────

  // Both must be null together (clear) or both non-null (set).
  const bothNull = amountStr === null && currency === null;
  const bothSet = amountStr !== null && currency !== null;
  if (!bothNull && !bothSet) {
    return { status: 'invalid_input', reason: 'amount_currency_mismatch' };
  }

  let validatedAmount: string | null = null;
  let validatedCurrency: string | null = null;

  if (bothSet) {
    // Validate amount (SEC-02)
    validatedAmount = validateAmountString(amountStr!);
    if (validatedAmount === null) {
      return { status: 'invalid_input', reason: 'invalid_amount' };
    }
    // Validate currency (SEC-01)
    validatedCurrency = validateCurrencyCode(currency!);
    if (validatedCurrency === null) {
      return { status: 'invalid_input', reason: 'invalid_currency' };
    }
  }

  // ── DB write ───────────────────────────────────────────────────
  return withTenantTransaction(workspaceId, userId, async (client) => {
    const row = await client.query<{ id: string; status: string; expires_at: string }>(
      `SELECT id, status, expires_at
       FROM transaction_drafts
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE SKIP LOCKED`,
      [draftId, workspaceId],
    );

    if (row.rows.length === 0) return { status: 'not_found' };
    const draft = row.rows[0];
    if (!draft) return { status: 'not_found' };
    if (!['pending_user', 'needs_clarification'].includes(draft.status)) {
      return { status: 'wrong_state' };
    }
    if (new Date(draft.expires_at) <= new Date()) return { status: 'not_found' };

    // Write amount as ::NUMERIC for DB-level precision (SEC-02).
    // NULL is written as-is (clears the column).
    await client.query(
      `UPDATE transaction_drafts
       SET account_debit_amount   = $1::NUMERIC,
           account_debit_currency = $2,
           updated_at             = NOW()
       WHERE id = $3 AND workspace_id = $4`,
      [validatedAmount, validatedCurrency, draftId, workspaceId],
    );

    return { status: 'ready', draftId };
  });
}

// ─────────────────────────────────────────────────────────────
// patchDraftCategoryHint — Phase 2.5 Smart Category Detector
// ─────────────────────────────────────────────────────────────

/**
 * Patch parsed_category_hint on a draft with a detector-resolved category name.
 *
 * Called by sendAndStorePreview when item-category-detector fires BEFORE
 * the preview card is rendered. Updates the hint so the preview shows the
 * correct category (e.g. "Транспорт" instead of "Другое").
 *
 * Only patches if current hint is null / empty / generic ("Другое").
 * Non-throwing — silently returns false on any error so preview is never blocked.
 *
 * SEC-12: categoryName NOT logged (canonical name, but still internal).
 * SEC-03: withTenantTransaction enforces RLS.
 */
export async function patchDraftCategoryHint(
  workspaceId: string,
  userId: string,
  draftId: string,
  categoryName: string,
): Promise<boolean> {
  try {
    await withTenantTransaction(workspaceId, userId, async (client) => {
      await client.query(
        `UPDATE transaction_drafts
         SET parsed_category_hint = $1, updated_at = NOW()
         WHERE id = $2
           AND workspace_id = $3
           AND status IN ('pending_user', 'needs_clarification')
           AND expires_at > NOW()
           AND (parsed_category_hint IS NULL
                OR TRIM(parsed_category_hint) = ''
                OR LOWER(parsed_category_hint) = 'другое')`,
        [categoryName, draftId, workspaceId],
      );
    });
    return true;
  } catch {
    return false;
  }
}
