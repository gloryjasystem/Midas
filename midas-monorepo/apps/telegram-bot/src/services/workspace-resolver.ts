/**
 * Workspace Resolver — Phase 1.5 (real implementation)
 *
 * Resolves the internal workspace_id for an incoming Telegram user.
 *
 * Phase 1.5 replaces the Phase 1.4 stub with a real DB lookup via onboarding service.
 *
 * SEC-03: workspace_id MUST come from a trusted backend source (DB lookup).
 *         NEVER trust workspace_id from client input or Telegram message payload.
 *
 * ADR-003: Each Telegram user has exactly ONE default workspace (owner role).
 *
 * Flow:
 *   1. Call findOrCreateUser(telegramUserId)
 *   2. Returns { userId, workspaceId, isNewUser }
 *   3. If isNewUser → /start handler sends the welcome card (not here)
 *   4. Return { workspaceId, isNewUser }
 *
 * Note on /start vs regular messages:
 *   resolveWorkspace() is called for ALL text messages, not just /start.
 *   For regular messages from an already-registered user, it simply returns
 *   their workspaceId without any side effects.
 *   For first-time users sending any message, it transparently onboards them.
 */

import { findOrCreateUser } from './onboarding.service.js';

export interface WorkspaceResolverResult {
  /** Internal user ULID */
  userId: string;
  workspaceId: string;
  /** true if workspace was just created (first-time user) */
  isNewUser: boolean;
}

/**
 * Resolve the workspace ID for a Telegram user, creating one if necessary.
 *
 * @param telegramUserId - string representation of the Telegram user ID (SEC-02)
 * @param chatId - optional chat ID for sending welcome message on first onboarding
 * @returns resolved workspace context
 *
 * @throws If DB is unavailable or schema constraint violated (caller must handle)
 */
export async function resolveWorkspace(
  telegramUserId: string,
  // _chatId kept for API compatibility — welcome is sent by /start handler
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _chatId?: string,
): Promise<WorkspaceResolverResult> {
  const result = await findOrCreateUser(telegramUserId);

  // Note: welcome message is sent by the /start command handler (webhook.route.ts).
  // DO NOT send a welcome message here — it would duplicate the onboarding card. (Phase 1.38)

  return {
    userId: result.userId,
    workspaceId: result.workspaceId,
    isNewUser: result.isNewUser,
  };
}
