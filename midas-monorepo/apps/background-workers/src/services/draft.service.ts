/**
 * Draft Service — Phase 1.6-A / Phase 1.8-A
 *
 * Handles creation of TransactionDraft records.
 *
 * Phase 1.8-A addition:
 *   AiOutput.intent is now propagated to transaction_drafts.parsed_intent.
 *   For needs_clarification drafts, parsed_intent = NULL (no valid intent from AI).
 *
 * SEC-01: intent comes only from Zod-validated AI output — never from user input.
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
 *   needs_clarification → terminal (user must resend)
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
}

// ─────────────────────────────────────────────────────────────
// Draft TTL
// From ADR-013: 24-hour draft expiry
// ─────────────────────────────────────────────────────────────

const DRAFT_TTL_HOURS = 24;

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
 * @param input - Draft creation input (workspaceId and userId from DB, not AI)
 * @returns CreatedDraft with generated draftId and final status
 */
export async function createDraft(input: CreateDraftInput): Promise<CreatedDraft> {
  const { workspaceId, userId, telegramMessageId, rawText, parseResult } = input;

  // Determine status from parse result
  const status: 'pending_user' | 'needs_clarification' =
    parseResult.status === 'ok' ? 'pending_user' : 'needs_clarification';

  // Generate system-controlled IDs (ADR-004)
  const draftId = ulid();

  // Calculate expiry (ADR-013: 24h TTL)
  const expiresAt = new Date(Date.now() + DRAFT_TTL_HOURS * 60 * 60 * 1000);

  // Extract AI data if parse was successful
  const aiData: AiOutput | null = parseResult.status === 'ok' ? parseResult.data : null;

  // Phase 1.8-A: extract intent from validated AI output.
  // NULL for needs_clarification — no reliable intent was produced.
  // SEC-01: aiData.intent is Zod-validated — cannot contain system fields or injection.
  const parsedIntent: string | null = aiData?.intent ?? null;

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
        category_id,
        person_id,
        account_id,
        status,
        expires_at,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        NULL,  -- category_id: not resolved in Phase 1.6-A (fuzzy matching deferred)
        NULL,  -- person_id: not resolved in Phase 1.6-A
        NULL,  -- account_id: not set in Phase 1.6-A
        $8, $9,
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
      expiresAt: expiresAt.toISOString(),
      // rawText deliberately excluded (SEC-12)
    });
  });

  return { draftId, status };
}
