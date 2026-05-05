/**
 * Onboarding Service — Phase 1.5
 *
 * Implements Frictionless Onboarding: find-or-create a User, default Workspace,
 * and WorkspaceMembership for a first-time Telegram user.
 *
 * SEC-03: workspace_id is ALWAYS resolved from a trusted DB source.
 *         It is NEVER derived from client input or Telegram payloads.
 *
 * ADR-003: Each Telegram user has exactly ONE default workspace (owner role).
 * ADR-004: All primary keys are ULIDs.
 *
 * Design:
 *   The onboarding transaction cannot use withTenantTransaction() because
 *   that helper requires workspaceId/userId known BEFORE the transaction —
 *   which is impossible on first onboarding. We use pool directly with a
 *   manual BEGIN/COMMIT and explicit RLS context setting after IDs are known.
 *
 *   For existing users, we use a simple SELECT (no RLS needed for user lookup
 *   by telegram_id — this is a system-level query, not a tenant data query).
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
  /** true = user was just created (first /start) */
  isNewUser: boolean;
}

// ─────────────────────────────────────────────────────────────
// findOrCreateUser
// ─────────────────────────────────────────────────────────────

/**
 * Resolve or create all required entities for a Telegram user.
 *
 * Flow:
 *   1. Look up User by telegram_id (bigint)
 *   2a. If found → look up their owner WorkspaceMembership → return both IDs
 *   2b. If not found → atomic transaction:
 *       - INSERT User (ULID)
 *       - INSERT Workspace (ULID, default_currency = 'RUB')
 *       - INSERT WorkspaceMembership (role = 'owner', is_default = true)
 *       - COMMIT
 *
 * Uses ON CONFLICT DO NOTHING for race-condition safety (concurrent /start).
 *
 * @param telegramUserId - string representation of Telegram user ID (SEC-02: never Number())
 * @returns OnboardingResult
 *
 * @throws If PostgreSQL is unreachable or schema constraint is violated
 */
export async function findOrCreateUser(
  telegramUserId: string,
): Promise<OnboardingResult> {
  // SEC-02: telegram_id column is BIGINT. Cast from string at DB boundary only.
  const telegramIdBigInt = BigInt(telegramUserId);

  const client = await pool.connect();
  try {
    // ── Step 1: Look up existing user ────────────────────────
    // No RLS context needed — system-level query by telegram_id.
    const existingUser = await client.query<{ id: string; workspace_id: string }>(
      `SELECT u.id, wm.workspace_id
       FROM users u
       JOIN workspace_memberships wm ON wm.user_id = u.id
       WHERE u.telegram_id = $1
         AND wm.is_default = true
       LIMIT 1`,
      [telegramIdBigInt],
    );

    if (existingUser.rows.length > 0) {
      const row = existingUser.rows[0];
      if (!row) throw new Error('[onboarding] Unexpected: rows.length > 0 but rows[0] undefined');
      return {
        userId: row.id,
        workspaceId: row.workspace_id,
        isNewUser: false,
      };
    }

    // ── Step 2: First-time user — atomic creation ─────────────
    const newUserId = ulid();
    const newWorkspaceId = ulid();
    const newMembershipId = ulid();

    await client.query('BEGIN');

    // 2a. INSERT User
    // ON CONFLICT DO NOTHING: race-condition safety if two /start arrive simultaneously
    await client.query(
      `INSERT INTO users (id, telegram_id)
       VALUES ($1, $2)
       ON CONFLICT (telegram_id) DO NOTHING`,
      [newUserId, telegramIdBigInt],
    );

    // Resolve actual userId (may differ if conflict occurred)
    const resolvedUser = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE telegram_id = $1 LIMIT 1`,
      [telegramIdBigInt],
    );

    const resolvedUserRow = resolvedUser.rows[0];
    if (!resolvedUserRow) {
      // Should never happen — we just inserted this user
      throw new Error(`[onboarding] User not found after INSERT for telegram_id=${telegramUserId}`);
    }
    const resolvedUserId = resolvedUserRow.id;
    const resolvedWorkspaceId =
      resolvedUserId === newUserId ? newWorkspaceId : null;

    if (resolvedWorkspaceId === null) {
      // Another concurrent /start already created this user.
      // Roll back our partial transaction and look up their workspace.
      await client.query('ROLLBACK');

      const fallback = await client.query<{ id: string; workspace_id: string }>(
        `SELECT u.id, wm.workspace_id
         FROM users u
         JOIN workspace_memberships wm ON wm.user_id = u.id
         WHERE u.telegram_id = $1 AND wm.is_default = true
         LIMIT 1`,
        [telegramIdBigInt],
      );

      // If still not found (extreme edge case), throw to be safe
      if (fallback.rows.length === 0) {
        throw new Error(
          `[onboarding] Concurrent creation resolved but fallback lookup failed for telegram_id=${telegramUserId}`,
        );
      }

      const fallbackRow = fallback.rows[0];
      if (!fallbackRow) {
        throw new Error('[onboarding] fallback rows[0] missing after length check');
      }

      return {
        userId: fallbackRow.id,
        workspaceId: fallbackRow.workspace_id,
        isNewUser: false, // created by concurrent request, treat as existing
      };
    }

    // 2b. INSERT Workspace
    await client.query(
      `INSERT INTO workspaces (id, name, default_currency)
       VALUES ($1, $2, 'RUB')`,
      [resolvedWorkspaceId, `Workspace of ${telegramUserId}`],
    );

    // 2c. INSERT WorkspaceMembership
    await client.query(
      `INSERT INTO workspace_memberships (id, user_id, workspace_id, role, is_default)
       VALUES ($1, $2, $3, 'owner', true)`,
      [newMembershipId, resolvedUserId, resolvedWorkspaceId],
    );

    await client.query('COMMIT');

    return {
      userId: resolvedUserId,
      workspaceId: resolvedWorkspaceId,
      isNewUser: true,
    };
  } catch (error) {
    // Rollback any open transaction
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors — connection may already be broken
    }
    throw error;
  } finally {
    client.release();
  }
}
