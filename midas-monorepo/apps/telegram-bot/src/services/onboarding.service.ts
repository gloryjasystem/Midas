/**
 * Onboarding Service — Phase 1.5 / Phase 1.12
 *
 * Implements Frictionless Onboarding: find-or-create a User, default Workspace,
 * WorkspaceMembership, default account_sources row, and default categories row
 * for a first-time Telegram user.
 *
 * SEC-03: workspace_id is ALWAYS resolved from a trusted DB source.
 *         It is NEVER derived from client input or Telegram payloads.
 *
 * ADR-003: Each Telegram user has exactly ONE default workspace (owner role).
 * ADR-004: All primary keys are ULIDs.
 * ADR-009: SECURITY DEFINER function `system_find_or_create_user` handles
 *          onboarding atomically, bypassing the RLS chicken-and-egg constraint.
 *
 * Phase 1.12 addition:
 *   The SECURITY DEFINER function now also seeds one default account_sources row
 *   (name='Default', type='manual', currency='RUB') and one default categories row
 *   (name='Разное', group='Жизнь') for new users only. Two additional candidate
 *   ULIDs are passed to the function for this purpose.
 *
 * RLS design note:
 *   midas_app cannot INSERT into `workspaces` without a pre-existing membership
 *   (workspaces RLS USING clause filters by workspace_memberships.user_id).
 *   Similarly, the SELECT after INSERT cannot read rows without app.user_id set.
 *   The SECURITY DEFINER function executes as midas_migrator (table owner),
 *   which is exempt from RLS (relforcerowsecurity = false on all tables).
 *   The function provides double-checked locking via pg_advisory_xact_lock
 *   for race-condition safety under concurrent /start calls.
 */

import { ulid } from 'ulid';
import { pool } from '@midas/database';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface OnboardingResult {
  /** Internal user ULID */
  userId: string;
  /** Internal workspace ULID */
  workspaceId: string;
  /** true = user+workspace were just created (first /start) */
  isNewUser: boolean;
}

// ─────────────────────────────────────────────────────────────
// findOrCreateUser
// ─────────────────────────────────────────────────────────────

/**
 * Resolve or create all required entities for a Telegram user.
 *
 * Delegates to `system_find_or_create_user` SECURITY DEFINER function (ADR-009)
 * which handles the full find-or-create flow atomically with advisory lock.
 *
 * Phase 1.12: The function signature is extended to 7 parameters. Two new
 * candidate ULIDs are generated and passed for default account_sources and
 * categories seeding. These are ignored by the function for existing users.
 *
 * @param telegramUserId - string representation of Telegram user ID (SEC-02: never Number())
 * @returns OnboardingResult
 * @throws If DB is unreachable or constraint is violated unexpectedly
 */
export async function findOrCreateUser(
  telegramUserId: string,
): Promise<OnboardingResult> {
  // SEC-02: telegram_id is BIGINT. Cast from string at DB boundary only.
  const telegramIdBigInt = BigInt(telegramUserId);

  // Generate candidate ULIDs — used only if this is a new user.
  // If user already exists, the function returns the existing IDs and ignores these.
  const candidateUserId = ulid();
  const candidateWorkspaceId = ulid();
  const candidateMembershipId = ulid();
  // Phase 1.12: candidate IDs for default account_sources and categories rows.
  // Ignored by the function if the user already exists (function returns early).
  const candidateAccountId = ulid();
  const candidateCategoryId = ulid();

  const client = await pool.connect();
  try {
    const result = await client.query<{
      user_id: string;
      workspace_id: string;
      is_new_user: boolean;
    }>(
      `SELECT user_id, workspace_id, is_new_user
       FROM system_find_or_create_user($1, $2, $3, $4, $5, $6, $7)`,
      [
        telegramIdBigInt,      // $1 — BIGINT telegram_id
        candidateUserId,       // $2 — candidate user ULID
        candidateWorkspaceId,  // $3 — candidate workspace ULID
        candidateMembershipId, // $4 — candidate membership ULID
        `Workspace of ${telegramUserId}`, // $5 — workspace name
        candidateAccountId,    // $6 — Phase 1.12: candidate account_sources ULID
        candidateCategoryId,   // $7 — Phase 1.12: candidate categories ULID
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `[onboarding] system_find_or_create_user returned no rows for telegram_id=${telegramUserId}`,
      );
    }

    return {
      userId: row.user_id,
      workspaceId: row.workspace_id,
      isNewUser: row.is_new_user,
    };
  } finally {
    client.release();
  }
}
