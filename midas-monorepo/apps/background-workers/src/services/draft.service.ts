/**
 * Draft Service — Phase 1.6-A / Phase 1.8-A / Phase 1.31 / Phase 1.32
 *
 * Handles creation and patching of TransactionDraft records.
 *
 * Phase 1.8-A addition:
 *   AiOutput.intent is now propagated to transaction_drafts.parsed_intent.
 *   For needs_clarification drafts, parsed_intent = NULL (no valid intent from AI).
 *
 * Phase 1.31 addition:
 *   setDraftAccountId() — set account_id on draft after inline account resolution.
 *
 * Phase 1.32 additions:
 *   - createDraft() now handles 'partial' ParseResult status:
 *     creates draft with status 'needs_clarification' and sets clarification_field.
 *   - patchDraftAmount()   — patch parsed_amount after user replies to "Сколько?"
 *   - patchDraftIntent()   — patch parsed_intent after user picks intent button
 *   - patchDraftCategory() — patch category_id after user picks category button
 *   All patch functions transition draft to 'pending_user' when all required fields
 *   are present (amount + intent). They return the new draft status.
 *
 * SEC-01: intent, amount, category come only from Zod-validated AI output or
 *         controlled DB lookups — never directly from user input strings.
 * SEC-03: ALL DB operations use withTenantTransaction(workspaceId, fn).
 * SEC-02: No float arithmetic. amounts stored as NUMERIC strings → DB handles precision.
 * SEC-12: raw_text stored in draft.raw_text column (DB storage is not logging).
 *         raw_text MUST NOT appear in console logs, audit_logs, or error metadata.
 * ADR-004: ULID primary keys.
 * ADR-003: Draft belongs to the user's default workspace.
 *
 * Draft statuses (from database_model_draft.md):
 *   pending_user → (Phase 1.6-B) approved | rejected
 *   pending_user → (CRON Phase 1.7) expired
 *   needs_clarification → pending_user (Phase 1.32: after successful patch)
 *   needs_clarification → terminal (user must resend if they abandon)
 */

import { ulid } from 'ulid';
import { withTenantTransaction, pool } from '@midas/database';
import type { AiOutput } from '@midas/ai-core';
import type { ParseResult } from '@midas/ai-core';

// ─────────────────────────────────────────────────────────────
// resolveUserId — shared helper
// ─────────────────────────────────────────────────────────────

/**
 * Resolve internal userId from Telegram User ID.
 * SEC-03: userId always comes from DB lookup, never from AI output or user input.
 * Throws if user not found (should not happen after successful onboarding).
 */
export async function resolveUserId(telegramUserId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE telegram_id = $1`,
    [telegramUserId],
  );
  if (result.rows.length === 0) {
    throw new Error(`User not found for telegramUserId=${telegramUserId}`);
  }
  return result.rows[0]?.id ?? (() => { throw new Error('Unexpected null row after length check'); })();
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface CreateDraftInput {
  workspaceId: string;
  userId: string;          // SEC-03: injected by backend, never from AI output
  telegramMessageId: number;
  rawText: string;         // Stored in draft.raw_text — NOT logged (SEC-12)
  parseResult: ParseResult;
}

export interface CreatedDraft {
  draftId: string;
  status: 'pending_user' | 'needs_clarification';
  /** Phase 1.32: which field needs clarification, if status = needs_clarification */
  clarificationField: 'amount' | 'intent' | 'category' | null;
  /** Phase 1.32: partial AI data (for building clarification message) */
  partialData: AiOutput | null;
}

/** Phase 1.32: Result of patching a needs_clarification draft */
export type PatchDraftResult =
  | { status: 'ready'; draftId: string }         // draft is now pending_user (all fields present)
  | { status: 'still_needs'; field: 'amount' | 'intent' | 'category' } // more fields needed
  | { status: 'not_found' }                      // draft not found or not in workspace
  | { status: 'wrong_state' };                   // draft not in needs_clarification state

// ─────────────────────────────────────────────────────────────
// Draft TTL
// Phase 1.39: Reduced from 24h to 1h for better UX
// ─────────────────────────────────────────────────────────────

const DRAFT_TTL_SECONDS = 3600; // 1 hour (Phase 1.39)

// ─────────────────────────────────────────────────────────────
// createDraft
// ─────────────────────────────────────────────────────────────

/**
 * Create a TransactionDraft record atomically within a tenant transaction.
 *
 * System fields (id, workspace_id, user_id, status, created_at, expires_at)
 * are ALL injected here — NEVER from AI output (SEC-01).
 *
 * Phase 1.8-A: AiOutput.intent is propagated to parsed_intent.
 * NULL parsed_intent is valid for needs_clarification drafts.
 *
 * Phase 1.32: Handles 'partial' ParseResult — creates draft with
 * status='needs_clarification' and sets clarification_field to the first
 * missing field (priority: amount > intent > category).
 *
 * @param input - Draft creation input (workspaceId and userId from DB, not AI)
 * @returns CreatedDraft with generated draftId, final status, and clarification info
 */
export async function createDraft(input: CreateDraftInput): Promise<CreatedDraft> {
  const { workspaceId, userId, telegramMessageId, rawText, parseResult } = input;

  // Determine status and clarification field from parse result
  let status: 'pending_user' | 'needs_clarification';
  let clarificationField: 'amount' | 'intent' | 'category' | null = null;
  let partialData: AiOutput | null = null;

  if (parseResult.status === 'ok') {
    status = 'pending_user';
    partialData = parseResult.data;
  } else if (parseResult.status === 'partial') {
    status = 'needs_clarification';
    // First missing field drives the clarification question (priority: amount > intent > category)
    clarificationField = parseResult.missingFields[0] ?? null;
    partialData = parseResult.data;
  } else {
    // 'needs_clarification' or 'rejected' — no usable data
    status = 'needs_clarification';
    clarificationField = null; // nonsense — no targeted clarification
    // partialData remains null (initialized above) — no targeted clarification
  }

  // Generate system-controlled IDs (ADR-004)
  const draftId = ulid();

  // Calculate expiry (Phase 1.39: 1h TTL)
  const expiresAt = new Date(Date.now() + DRAFT_TTL_SECONDS * 1000);

  // Extract AI data for column values
  const aiData: AiOutput | null = partialData;

  // Phase 1.8-A: extract intent from validated AI output.
  // NULL for needs_clarification — no reliable intent was produced.
  // SEC-01: aiData.intent is Zod-validated — cannot contain system fields or injection.
  const parsedIntent: string | null = aiData?.intent ?? null;

  // Phase 1.31: extract account_hint from AI output.
  const parsedAccountHint: string | null = aiData?.account_hint ?? null;

  // Phase 1.35: extract item_hint and category_hint from AI output.
  const itemName: string | null = aiData?.item_hint ?? null;
  const parsedCategoryHint: string | null = aiData?.category_hint ?? null;

  await withTenantTransaction(workspaceId, userId, async (client) => {
    // SEC-03: withTenantTransaction sets SET LOCAL app.workspace_id = $workspaceId
    // All RLS policies will see the correct tenant context.
    await client.query(
      `INSERT INTO transaction_drafts (
        id,
        workspace_id,
        telegram_message_id,
        raw_text,
        parsed_amount,
        parsed_currency,
        parsed_intent,
        parsed_account_hint,
        parsed_category_hint,
        item_name,
        clarification_field,
        category_id,
        person_id,
        account_id,
        status,
        expires_at,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        NULL,  -- category_id: resolved at approval time (Phase 1.35)
        NULL,  -- person_id: not resolved at parse time
        NULL,  -- account_id: resolved by ai-parse worker (Phase 1.31) or approveDraft
        $12, $13,
        NOW(), NOW()
      )`,
      [
        draftId,
        workspaceId,                                    // SEC-03: from DB, not AI
        telegramMessageId,
        rawText,                                        // SEC-12: stored in DB, not logged
        aiData?.amount ?? null,                         // NUMERIC string or null
        aiData?.currency ?? null,                       // ISO 4217 or null
        parsedIntent,                                   // Phase 1.8-A: intent from AI (or null)
        parsedAccountHint,                              // Phase 1.31: account hint from AI (or null)
        parsedCategoryHint,                             // Phase 1.35: category hint from AI (or null)
        itemName,                                       // Phase 1.35: item/product/merchant name (or null)
        clarificationField,                             // Phase 1.32: which field to clarify (or null)
        status,
        expiresAt.toISOString(),
      ],
    );

    // Log only system identifiers — never raw_text (SEC-12)
    console.log('[midas:draft-service] Draft created', {
      draftId,
      workspaceId,
      userId,
      status,
      parsedIntent, // safe to log: system classification, not user financial text
      clarificationField,
      expiresAt: expiresAt.toISOString(),
      // rawText deliberately excluded (SEC-12)
    });
  });

  return { draftId, status, clarificationField, partialData };
}

// ─────────────────────────────────────────────────────────────
// setDraftAccountId — Phase 1.31
// ─────────────────────────────────────────────────────────────

/**
 * Set account_id on a transaction_drafts row (Phase 1.31 — exact match path).
 *
 * Called by the ai-parse worker when an exact account match is found,
 * so the confirmation worker can use the resolved account directly.
 *
 * SEC-03: explicit workspace_id + RLS inside withTenantTransaction.
 * SEC-01: accountId is validated against account_sources before calling this.
 */
export async function setDraftAccountId(
  workspaceId: string,
  userId: string,
  draftId: string,
  accountId: string,
): Promise<void> {
  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `UPDATE transaction_drafts
       SET account_id = $1, updated_at = NOW()
       WHERE id = $2 AND workspace_id = $3 AND status = 'pending_user'`,
      [accountId, draftId, workspaceId],
    );
  });
}

// ─────────────────────────────────────────────────────────────
// patchDraftAmount — Phase 1.32
// ─────────────────────────────────────────────────────────────

/**
 * Patch the missing amount on a needs_clarification draft.
 *
 * Called when the user replies with a number after the bot asks "Сколько?".
 *
 * Validates the amount string against the NUMERIC(19,4) regex (SEC-02).
 * If intent is also present after the patch, transitions to pending_user.
 * Sets clarification_field = 'intent' if intent is still missing, or NULL if done.
 *
 * SEC-02: amountStr must be a validated NUMERIC string — NOT from raw user input.
 *         Caller must validate with AmountRegex before calling this function.
 * SEC-03: explicit workspace_id + RLS inside withTenantTransaction.
 */
export async function patchDraftAmount(
  workspaceId: string,
  userId: string,
  draftId: string,
  amountStr: string,  // Pre-validated NUMERIC string (SEC-02)
): Promise<PatchDraftResult> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    // Fetch current draft (locked for update)
    const row = await client.query<{
      id: string;
      status: string;
      parsed_intent: string | null;
      clarification_field: string | null;
      expires_at: string;
    }>(
      `SELECT id, status, parsed_intent, clarification_field, expires_at
       FROM transaction_drafts
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE SKIP LOCKED`,
      [draftId, workspaceId],
    );

    if (row.rows.length === 0) return { status: 'not_found' };
    const draft = row.rows[0];
    if (!draft) return { status: 'not_found' };
    if (draft.status !== 'needs_clarification') return { status: 'wrong_state' };

    // Check expiry
    if (new Date(draft.expires_at) <= new Date()) return { status: 'not_found' };

    // Determine next state: if intent is also missing, stay in needs_clarification
    const hasIntent = draft.parsed_intent !== null;
    let nextStatus: 'pending_user' | 'needs_clarification';
    let nextClarField: 'intent' | 'category' | null;

    if (!hasIntent) {
      nextStatus = 'needs_clarification';
      nextClarField = 'intent';
    } else {
      nextStatus = 'pending_user';
      nextClarField = null;
    }

    await client.query(
      `UPDATE transaction_drafts
       SET parsed_amount = $1,
           status = $2,
           clarification_field = $3,
           updated_at = NOW()
       WHERE id = $4 AND workspace_id = $5`,
      [amountStr, nextStatus, nextClarField, draftId, workspaceId],
    );

    console.log('[midas:draft-service] patchDraftAmount', {
      draftId, workspaceId, nextStatus, nextClarField,
    });

    if (nextStatus === 'pending_user') {
      return { status: 'ready', draftId };
    }
    return { status: 'still_needs', field: nextClarField ?? 'intent' };
  });
}

// ─────────────────────────────────────────────────────────────
// patchDraftIntent — Phase 1.32
// ─────────────────────────────────────────────────────────────

/**
 * Patch the missing intent on a needs_clarification draft.
 *
 * Called when the user taps an intent clarification button (clar:intent:*).
 *
 * If amount is also present, transitions to pending_user.
 * Sets clarification_field = 'amount' if amount is still missing.
 *
 * SEC-01: intent must be one of the 5 canonical values — validated by caller.
 * SEC-03: explicit workspace_id + RLS inside withTenantTransaction.
 */
export async function patchDraftIntent(
  workspaceId: string,
  userId: string,
  draftId: string,
  intent: string,  // One of: expense|income|debt_given|debt_received|transfer
): Promise<PatchDraftResult> {
  const VALID_INTENTS = new Set(['expense', 'income', 'debt_given', 'debt_received', 'transfer']);
  if (!VALID_INTENTS.has(intent)) {
    console.warn('[midas:draft-service] patchDraftIntent: invalid intent', { draftId, workspaceId });
    return { status: 'not_found' };
  }

  return withTenantTransaction(workspaceId, userId, async (client) => {
    const row = await client.query<{
      id: string;
      status: string;
      parsed_amount: string | null;
      clarification_field: string | null;
      expires_at: string;
    }>(
      `SELECT id, status, parsed_amount, clarification_field, expires_at
       FROM transaction_drafts
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE SKIP LOCKED`,
      [draftId, workspaceId],
    );

    if (row.rows.length === 0) return { status: 'not_found' };
    const draft = row.rows[0];
    if (!draft) return { status: 'not_found' };
    if (draft.status !== 'needs_clarification') return { status: 'wrong_state' };
    if (new Date(draft.expires_at) <= new Date()) return { status: 'not_found' };

    const hasAmount = draft.parsed_amount !== null;
    let nextStatus: 'pending_user' | 'needs_clarification';
    let nextClarField: 'amount' | null;

    if (!hasAmount) {
      nextStatus = 'needs_clarification';
      nextClarField = 'amount';
    } else {
      nextStatus = 'pending_user';
      nextClarField = null;
    }

    await client.query(
      `UPDATE transaction_drafts
       SET parsed_intent = $1,
           status = $2,
           clarification_field = $3,
           updated_at = NOW()
       WHERE id = $4 AND workspace_id = $5`,
      [intent, nextStatus, nextClarField, draftId, workspaceId],
    );

    console.log('[midas:draft-service] patchDraftIntent', {
      draftId, workspaceId, intent, nextStatus, nextClarField,
    });

    if (nextStatus === 'pending_user') {
      return { status: 'ready', draftId };
    }
    return { status: 'still_needs', field: nextClarField ?? 'amount' };
  });
}

// ─────────────────────────────────────────────────────────────
// patchDraftCategory — Phase 1.32
// ─────────────────────────────────────────────────────────────

/**
 * Patch the category on a needs_clarification or pending_user draft.
 *
 * Called when the user taps a category clarification button (clar:cat:*).
 *
 * Unlike amount/intent, category is optional for transaction creation (the
 * draft-confirmation service falls back to workspace default). So after
 * patching category, we transition to pending_user regardless of other fields
 * (assuming amount and intent are already set by this point in the priority chain).
 *
 * Also handles the 'no category' path (categoryId = null).
 *
 * SEC-01: categoryId validated against categories table in this workspace.
 * SEC-03: explicit workspace_id + RLS inside withTenantTransaction.
 */
export async function patchDraftCategory(
  workspaceId: string,
  userId: string,
  draftId: string,
  categoryId: string | null,  // null = "without category"
): Promise<PatchDraftResult> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    // Validate categoryId belongs to this workspace (SEC-01 IDOR guard)
    if (categoryId !== null) {
      const catCheck = await client.query<{ id: string }>(
        `SELECT id FROM categories WHERE id = $1 AND workspace_id = $2`,
        [categoryId, workspaceId],
      );
      if (catCheck.rows.length === 0) {
        console.warn('[midas:draft-service] patchDraftCategory: IDOR guard triggered', {
          draftId, workspaceId,
        });
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

    console.log('[midas:draft-service] patchDraftCategory', {
      draftId, workspaceId, hasCategoryId: categoryId !== null,
    });

    return { status: 'ready', draftId };
  });
}

// ─────────────────────────────────────────────────────────────
// Phase 1.39: Persistent preview message tracking
// ─────────────────────────────────────────────────────────────

/**
 * Save the Telegram message ID of the preview card to PostgreSQL.
 * This provides durable storage that survives Redis TTL expiration.
 * SEC-12: Only system IDs stored — no user financial data.
 */
export async function savePreviewMessageId(
  draftId: string,
  workspaceId: string,
  messageId: string,
  chatId: string,
): Promise<void> {
  await pool.query(
    `UPDATE transaction_drafts
     SET preview_message_id = $1,
         preview_chat_id = $2,
         updated_at = NOW()
     WHERE id = $3 AND workspace_id = $4`,
    [messageId, chatId, draftId, workspaceId],
  );
}

/**
 * Read preview message info from PostgreSQL (durable fallback after Redis TTL).
 * SEC-12: Returns only system IDs.
 */
export async function getPreviewMessageInfo(
  draftId: string,
  workspaceId: string,
): Promise<{ messageId: string; chatId: string } | null> {
  const result = await pool.query<{ preview_message_id: string; preview_chat_id: string }>(
    `SELECT preview_message_id, preview_chat_id
     FROM transaction_drafts
     WHERE id = $1 AND workspace_id = $2
       AND preview_message_id IS NOT NULL`,
    [draftId, workspaceId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { messageId: row.preview_message_id, chatId: row.preview_chat_id };
}

// ─────────────────────────────────────────────────────────────
// Phase 1.39: Pending draft gate check
// ─────────────────────────────────────────────────────────────

export interface PendingDraftInfo {
  draftId: string;
  status: string;
  previewMessageId: string | null;
  previewChatId: string | null;
  parsedIntent: string | null;
  parsedAmount: string | null;
  parsedCurrency: string | null;
  itemName: string | null;
  parsedCategoryHint: string | null;
  accountId: string | null;
  accountDebitAmount: string | null;
}

/**
 * Find an active pending_user draft for a user (gate check).
 * Only pending_user triggers the gate — needs_clarification is an active
 * dialog where user input is expected and must NOT be blocked.
 * C-12: Uses pool.query with explicit workspace_id filter (no RLS overhead).
 * SEC-12: Returns only parsed fields, never raw_text.
 */
export async function getPendingDraftForUser(
  workspaceId: string,
  _userId: string,
): Promise<PendingDraftInfo | null> {
  const result = await pool.query<{
    id: string;
    status: string;
    preview_message_id: string | null;
    preview_chat_id: string | null;
    parsed_intent: string | null;
    parsed_amount: string | null;
    parsed_currency: string | null;
    item_name: string | null;
    parsed_category_hint: string | null;
    account_id: string | null;
    account_debit_amount: string | null;
  }>(
    `SELECT td.id, td.status,
            td.preview_message_id, td.preview_chat_id,
            td.parsed_intent, td.parsed_amount::TEXT AS parsed_amount,
            td.parsed_currency, td.item_name, td.parsed_category_hint,
            td.account_id, td.account_debit_amount::TEXT AS account_debit_amount
     FROM transaction_drafts td
     WHERE td.workspace_id = $1
        AND td.status = 'pending_user'
       AND td.expires_at > NOW()
     ORDER BY td.created_at DESC
     LIMIT 1`,
    [workspaceId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    draftId: row.id,
    status: row.status,
    previewMessageId: row.preview_message_id,
    previewChatId: row.preview_chat_id,
    parsedIntent: row.parsed_intent,
    parsedAmount: row.parsed_amount,
    parsedCurrency: row.parsed_currency,
    itemName: row.item_name,
    parsedCategoryHint: row.parsed_category_hint,
    accountId: row.account_id,
    accountDebitAmount: row.account_debit_amount,
  };
}

// ─────────────────────────────────────────────────────────────
// Phase 1.39: Reminder message tracking
// ─────────────────────────────────────────────────────────────

/**
 * Save the reminder message ID to PostgreSQL.
 * SEC-12: Only system ID stored.
 */
export async function saveReminderMessageId(
  draftId: string,
  workspaceId: string,
  messageId: string,
): Promise<void> {
  await pool.query(
    `UPDATE transaction_drafts
     SET reminder_message_id = $1,
         updated_at = NOW()
     WHERE id = $2 AND workspace_id = $3`,
    [messageId, draftId, workspaceId],
  );
}

/**
 * Mark reminder as sent for a batch of drafts.
 * Called after the expiration worker sends reminder notifications.
 */
export async function markReminderSent(draftIds: string[]): Promise<void> {
  if (draftIds.length === 0) return;
  await pool.query(
    `UPDATE transaction_drafts
     SET reminder_sent_at = NOW(),
         updated_at = NOW()
     WHERE id = ANY($1::text[])`,
    [draftIds],
  );
}

// ─────────────────────────────────────────────────────────────
// Phase 2.4 PR15: Account balance for preview card
// ─────────────────────────────────────────────────────────────

export interface AccountBalanceForPreview {
  accountId: string;
  accountName: string;
  accountCurrency: string;
  balance: string;           // NUMERIC string: initial_balance + all matched-currency txs
}

/**
 * Fetch balance + name + currency for an account (for preview card balance block).
 *
 * Uses the same D1-D3 formula as balance.service.ts:
 *   balance = initial_balance
 *           + SUM(income + debt_received WHERE base_currency = acct.currency)
 *           - SUM(expense + debt_given WHERE base_currency = acct.currency)
 *
 * transfer is excluded (D3 neutral).
 * SEC-02: All arithmetic in PostgreSQL NUMERIC — no JS float.
 * SEC-03: explicit workspace_id filter (no RLS dependency in background worker).
 *
 * Returns null if account not found / deleted.
 */
export async function getAccountBalanceForPreview(
  workspaceId: string,
  accountId: string,
): Promise<AccountBalanceForPreview | null> {
  const result = await pool.query<{
    id: string;
    name: string;
    currency: string;
    balance: string;
  }>(
    `SELECT
       a.id,
       a.name,
       a.currency,
       (
         a.initial_balance
         + COALESCE(SUM(CASE
             WHEN t.transaction_intent IN ('income', 'debt_received')
              AND t.base_currency = a.currency
             THEN t.base_amount END), 0)
         - COALESCE(SUM(CASE
             WHEN t.transaction_intent IN ('expense', 'debt_given')
              AND t.base_currency = a.currency
             THEN t.base_amount END), 0)
       )::TEXT AS balance
     FROM account_sources a
     LEFT JOIN transactions t
       ON t.account_id = a.id
      AND t.workspace_id = $1
      AND t.deleted_at IS NULL
     WHERE a.id = $2
       AND a.workspace_id = $1
       AND a.deleted_at IS NULL
     GROUP BY a.id, a.name, a.currency, a.initial_balance`,
    [workspaceId, accountId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    accountId: row.id,
    accountName: row.name,
    accountCurrency: row.currency,
    balance: row.balance,
  };
}

// ─────────────────────────────────────────────────────────────
// Phase 2.4 PR17: Workspace account names for AI context
// ─────────────────────────────────────────────────────────────

/**
 * Returns an array of active account names for the given workspace.
 *
 * Used to inject a KNOWN ACCOUNTS list into the Claude prompt so the AI
 * can recognise custom account names (e.g. "Влада Калина") as account_hint
 * even when they appear without prepositions in the user's message.
 *
 * SEC-01: Only account names are returned — never IDs, balances, or system fields.
 * SEC-03: explicit workspace_id filter; excludes deleted and onboarding-placeholder rows.
 *
 * Returns [] if workspace has no active accounts (AI parses without context).
 */
export async function getWorkspaceAccountNames(workspaceId: string): Promise<string[]> {
  const result = await pool.query<{ name: string }>(
    `SELECT name
     FROM account_sources
     WHERE workspace_id = $1
       AND deleted_at IS NULL
       AND is_onboarding_placeholder = FALSE
     ORDER BY name`,
    [workspaceId],
  );
  return result.rows.map((r) => r.name);
}

// ─────────────────────────────────────────────────────────────
// Phase 2.4 PR17: Workspace accounts for worker-side picker
// ─────────────────────────────────────────────────────────────

export interface WorkspaceAccountEntry {
  id: string;
  name: string;
  currency: string;
  balance: string; // NUMERIC string
  is_expense_default: boolean; // Phase 9: primary account flag
}

/**
 * Returns all active workspace accounts with current balances.
 *
 * Used by ai-parse.worker.ts to build the account picker keyboard directly,
 * without going through the telegram-bot service layer.
 *
 * Balance formula: same D1-D3 as getAccountBalanceForPreview.
 * SEC-01: returns only names + IDs (no sensitive financial metadata beyond balance).
 * SEC-03: workspace_id filter; excludes deleted + onboarding-placeholder rows.
 *
 * Returns [] if workspace has no active accounts.
 */
export async function getWorkspaceAccountsForPicker(
  workspaceId: string,
): Promise<WorkspaceAccountEntry[]> {
  const result = await pool.query<WorkspaceAccountEntry>(
    `SELECT
       a.id,
       a.name,
       a.currency,
       (a.id = w.default_expense_account_id) AS is_expense_default,
       (
         a.initial_balance
         + COALESCE(SUM(CASE
             WHEN t.transaction_intent IN ('income', 'debt_received')
              AND t.base_currency = a.currency
             THEN t.base_amount END), 0)
         - COALESCE(SUM(CASE
             WHEN t.transaction_intent IN ('expense', 'debt_given')
              AND t.base_currency = a.currency
             THEN t.base_amount END), 0)
       )::TEXT AS balance
     FROM account_sources a
     JOIN workspaces w ON w.id = a.workspace_id
     LEFT JOIN transactions t
       ON t.account_id = a.id
      AND t.workspace_id = $1
      AND t.deleted_at IS NULL
     WHERE a.workspace_id = $1
       AND a.deleted_at IS NULL
       AND a.is_onboarding_placeholder = FALSE
     GROUP BY a.id, a.name, a.currency, a.initial_balance, w.default_expense_account_id
     ORDER BY a.name`,
    [workspaceId],
  );
  return result.rows;
}
