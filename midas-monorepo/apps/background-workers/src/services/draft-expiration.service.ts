/**
 * Draft Expiration Service — Phase 1.7
 *
 * Calls the system_expire_pending_drafts() SECURITY DEFINER DB function
 * to atomically expire all pending_user drafts whose expires_at <= NOW().
 *
 * Design:
 *   - Uses pool.query() directly (not withTenantTransaction) because:
 *     a) system_expire_pending_drafts runs as midas_migrator (SECURITY DEFINER)
 *        and does not depend on app.workspace_id / app.user_id session settings.
 *     b) This is a system maintenance operation, not a tenant-scoped user action.
 *   - No parameters to the DB function → no injection surface.
 *   - Returns only the count of expired drafts (no raw_text, no PII — SEC-12).
 *
 * SEC-03: No tenant context injection needed — SECURITY DEFINER function handles RLS bypass.
 * SEC-12: Return value contains only expired_count (integer). No raw_text logged.
 */

import { pool } from '@midas/database';

// ─────────────────────────────────────────────────────────────
// Result type
// ─────────────────────────────────────────────────────────────

export interface ExpireResult {
  /** Number of drafts that were expired in this run. */
  expiredCount: number;
}

// ─────────────────────────────────────────────────────────────
// expirePendingDrafts
// ─────────────────────────────────────────────────────────────

/**
 * Expire all pending_user drafts whose expires_at has passed.
 *
 * Calls system_expire_pending_drafts() SECURITY DEFINER function.
 * Safe to call multiple times (idempotent): already-expired or terminal
 * drafts are not matched by the WHERE clause.
 *
 * @returns ExpireResult with the count of newly expired drafts.
 */
export async function expirePendingDrafts(): Promise<ExpireResult> {
  const result = await pool.query<{ expired_count: number }>(
    `SELECT system_expire_pending_drafts() AS expired_count`,
  );

  const expiredCount = result.rows[0]?.expired_count ?? 0;

  // SEC-12: Log only the count, not any draft contents.
  console.log('[midas:draft-expiration] Expiration run complete', {
    expiredCount,
    // No workspace IDs, no raw_text, no draft IDs (SEC-12)
  });

  return { expiredCount };
}
