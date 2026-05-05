/**
 * Workspace Resolver — Phase 1.4 stub.
 *
 * Resolves the internal workspace_id for an incoming Telegram user.
 *
 * In Phase 1 MVP:
 *   - Each Telegram user has exactly ONE default workspace (ADR-003).
 *   - Workspace is created automatically on first /start (Frictionless Onboarding).
 *
 * Current implementation (Phase 1.4 stub):
 *   - Returns a hardcoded placeholder workspace ID.
 *   - WILL BE replaced in Phase 1.5 with a real DB lookup using withTenantTransaction.
 *
 * SEC-03 constraint:
 *   - workspace_id MUST come from a trusted backend source (DB lookup by telegram_user_id).
 *   - NEVER trust workspace_id from client input or Telegram message payload.
 *
 * Phase 1.5 implementation plan:
 *   SELECT wm.workspace_id
 *   FROM workspace_memberships wm
 *   JOIN users u ON u.id = wm.user_id
 *   WHERE u.telegram_user_id = $1
 *     AND wm.role = 'owner'
 *   LIMIT 1
 *
 * If no workspace found → trigger onboarding (create workspace + user + membership).
 * This is the Frictionless Onboarding path (project_config.md §4.1).
 */

export interface WorkspaceResolverResult {
  workspaceId: string;
  /** true if workspace was just created (first-time user) */
  isNewUser: boolean;
}

/**
 * Resolve the workspace ID for a Telegram user.
 *
 * @param telegramUserId - string representation of the Telegram user ID
 * @returns resolved workspace context
 *
 * @throws Never in Phase 1.4 stub — always returns a placeholder.
 *         In Phase 1.5, throws if DB is unavailable.
 */
export async function resolveWorkspace(
  telegramUserId: string,
): Promise<WorkspaceResolverResult> {
  // ── Phase 1.4 STUB ────────────────────────────────────────────
  // TODO Phase 1.5: Replace with real DB lookup via withTenantTransaction
  //
  // Example (Phase 1.5):
  //   const result = await pool.query<{ workspace_id: string }>(
  //     `SELECT wm.workspace_id
  //      FROM workspace_memberships wm
  //      JOIN users u ON u.id = wm.user_id
  //      WHERE u.telegram_user_id = $1 AND wm.role = 'owner'
  //      LIMIT 1`,
  //     [telegramUserId]
  //   );
  //   if (result.rows.length === 0) {
  //     return await createDefaultWorkspace(telegramUserId);
  //   }
  //   return { workspaceId: result.rows[0].workspace_id, isNewUser: false };
  //
  // ── END STUB ─────────────────────────────────────────────────

  // Suppress unused parameter warning during stub phase
  void telegramUserId;

  // Await a no-op to satisfy require-await lint rule during stub phase.
  // This will be replaced with a real DB query (pool.query) in Phase 1.5.
  await Promise.resolve();

  // Placeholder: use telegramUserId as workspace suffix for dev traceability
  // This is NOT a valid workspace ULID — replace in Phase 1.5
  return {
    workspaceId: `STUB_WORKSPACE_${telegramUserId}`,
    isNewUser: false,
  };
}
