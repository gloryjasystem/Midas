/**
 * Draft Expiration Service — Phase 1.7 / Phase 1.39
 *
 * Phase 1.7: Calls system_expire_pending_drafts() to expire stale drafts.
 * Phase 1.39: Returns full draft data (TABLE) for in-place card editing.
 *             Adds findDraftsNeedingReminder() for the reminder pipeline.
 *
 * Design:
 *   - Uses pool.query() directly (not withTenantTransaction) because:
 *     a) SECURITY DEFINER functions run as midas_migrator.
 *     b) This is a system maintenance operation, not a tenant-scoped user action.
 *   - No parameters to the expire function → no injection surface.
 *
 * SEC-03: No tenant context injection needed — SECURITY DEFINER functions handle RLS bypass.
 * SEC-12: Return values contain only system IDs and parsed fields. No raw_text logged.
 */

import { pool } from '@midas/database';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface ExpiredDraft {
  draftId: string;
  workspaceId: string;
  previewMessageId: string | null;
  previewChatId: string | null;
  reminderMessageId: string | null;
  parsedIntent: string | null;
  parsedAmount: string | null;
  parsedCurrency: string | null;
  itemName: string | null;
  parsedCategoryHint: string | null;
}

export interface ExpireResult {
  expiredCount: number;
  expiredDrafts: ExpiredDraft[];
}

export interface ReminderDraft {
  draftId: string;
  workspaceId: string;
  previewMessageId: string | null;
  previewChatId: string | null;
  parsedIntent: string | null;
  parsedAmount: string | null;
  parsedCurrency: string | null;
  itemName: string | null;
  parsedCategoryHint: string | null;
  /** Phase 2.5: account linked to the draft (null = not selected yet) */
  accountId: string | null;
  /** Phase 2.5: cross-currency debit amount (null = same currency) */
  accountDebitAmount: string | null;
  /** Phase 2.6: which screen the draft is currently on — used to mirror buttons in reminder */
  currentScreen: 'screen1' | 'screen1b' | 'screen2';
  /** Phase 2.6: display name of linked account (from account_sources JOIN) */
  accountName: string | null;
}

// ─────────────────────────────────────────────────────────────
// expirePendingDrafts — Phase 1.39: returns TABLE with draft data
// ─────────────────────────────────────────────────────────────

/**
 * Expire all pending_user drafts whose expires_at has passed.
 * Phase 1.39: Now returns full draft data for in-place card editing.
 *
 * @returns ExpireResult with count and draft details for UI updates.
 */
export async function expirePendingDrafts(): Promise<ExpireResult> {
  const result = await pool.query<{
    draft_id: string;
    workspace_id: string;
    preview_message_id: string | null;
    preview_chat_id: string | null;
    reminder_message_id: string | null;
    parsed_intent: string | null;
    parsed_amount: string | null;
    parsed_currency: string | null;
    item_name: string | null;
    parsed_category_hint: string | null;
  }>(
    `SELECT * FROM system_expire_pending_drafts()`,
  );

  const expiredDrafts: ExpiredDraft[] = result.rows.map(r => ({
    draftId: r.draft_id,
    workspaceId: r.workspace_id,
    previewMessageId: r.preview_message_id,
    previewChatId: r.preview_chat_id,
    reminderMessageId: r.reminder_message_id,
    parsedIntent: r.parsed_intent,
    parsedAmount: r.parsed_amount,
    parsedCurrency: r.parsed_currency,
    itemName: r.item_name,
    parsedCategoryHint: r.parsed_category_hint,
  }));

  console.log('[midas:draft-expiration] Expiration run complete', {
    expiredCount: expiredDrafts.length,
  });

  return { expiredCount: expiredDrafts.length, expiredDrafts };
}

// ─────────────────────────────────────────────────────────────
// findDraftsNeedingReminder — Phase 1.39
// ─────────────────────────────────────────────────────────────

/**
 * Find pending_user drafts that need a reminder notification.
 * A draft needs a reminder if:
 *   1. It's still pending_user
 *   2. reminder_sent_at IS NULL (not yet reminded)
 *   3. expires_at is within lead_seconds from now
 *   4. expires_at > NOW() (not yet expired)
 *
 * @param leadSeconds — seconds before expiry to trigger reminder (default: 600 = 10 min)
 */
export async function findDraftsNeedingReminder(leadSeconds: number = 600): Promise<ReminderDraft[]> {
  const result = await pool.query<{
    draft_id: string;
    workspace_id: string;
    preview_message_id: string | null;
    preview_chat_id: string | null;
    parsed_intent: string | null;
    parsed_amount: string | null;
    parsed_currency: string | null;
    item_name: string | null;
    parsed_category_hint: string | null;
    account_id: string | null;
    account_debit_amount: string | null;
    current_screen: string | null;
    account_name: string | null;
  }>(
    // Phase 2.6: also select current_screen + account_name for reminder mirroring
    `SELECT d.draft_id, d.workspace_id, d.preview_message_id, d.preview_chat_id,
            d.parsed_intent, d.parsed_amount, d.parsed_currency,
            d.item_name, d.parsed_category_hint,
            d.account_id, d.account_debit_amount, d.current_screen, d.account_name
     FROM system_find_drafts_needing_reminder($1) d`,
    [leadSeconds],
  );

  return result.rows.map(r => ({
    draftId: r.draft_id,
    workspaceId: r.workspace_id,
    previewMessageId: r.preview_message_id,
    previewChatId: r.preview_chat_id,
    parsedIntent: r.parsed_intent,
    parsedAmount: r.parsed_amount,
    parsedCurrency: r.parsed_currency,
    itemName: r.item_name,
    parsedCategoryHint: r.parsed_category_hint,
    accountId: r.account_id,
    accountDebitAmount: r.account_debit_amount,
    currentScreen: (r.current_screen ?? 'screen1') as ReminderDraft['currentScreen'],
    accountName: r.account_name,
  }));
}
