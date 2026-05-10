/**
 * Clarification Service — Phase 1.32
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
 * SEC-01: intent validated against canonical enum; categoryId validated against DB.
 * SEC-02: amountStr validated against NUMERIC regex before any DB write.
 * SEC-03: All DB operations use withTenantTransaction for RLS isolation.
 * SEC-12: Raw text inputs NOT logged.
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
      `SELECT id, status, parsed_amount, expires_at
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
};

/**
 * Fetch lightweight draft fields for the edit sub-menu.
 * Returns null if not found, expired, or in wrong state.
 *
 * SEC-03: withTenantTransaction enforces RLS.
 */
export async function getDraftFields(
  workspaceId: string,
  userId: string,
  draftId: string,
): Promise<DraftFields | null> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    const result = await client.query<DraftFields>(
      `SELECT id, status, parsed_intent, parsed_amount, parsed_currency,
              item_name, parsed_category_hint, category_id
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

