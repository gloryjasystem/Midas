/**
 * Phase 1.7: Draft Expiration — system_expire_pending_drafts
 *
 * Adds a narrow SECURITY DEFINER function that atomically expires all
 * transaction_drafts where:
 *   - status = 'pending_user'
 *   - expires_at <= NOW()
 *
 * Security constraints:
 *   - SECURITY DEFINER: runs as midas_migrator (table owner, RLS-exempt),
 *     allowing cross-tenant batch expiration without per-tenant RLS context.
 *     This is consistent with the system_find_or_create_user pattern (Phase 1.5).
 *   - No parameters accepted (no SQL injection surface).
 *   - Returns only expired_count INTEGER — no raw_text, no PII (SEC-12).
 *   - Only midas_app can call this function (REVOKE + GRANT pattern).
 *   - The DB trigger (enforce_draft_state_machine) still validates the
 *     pending_user → expired transition is allowed.
 *
 * Why SECURITY DEFINER and not per-tenant loops:
 *   - Draft expiration is a system maintenance task, not a user operation.
 *   - There is no "current workspace" for a CRON job — all workspaces must
 *     be scanned in a single batch update.
 *   - Using withTenantTransaction per workspace would require fetching all
 *     workspace IDs first, then looping — O(N workspaces) round-trips.
 *   - A single SECURITY DEFINER UPDATE is atomic and O(1) round-trips.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- system_expire_pending_drafts: batch expiration for the CRON worker.
    -- Atomically marks all eligible pending_user drafts as 'expired'.
    -- Returns expired_count: number of rows updated.
    --
    -- Called by: draft-expiration BullMQ worker (repeatable CRON).
    -- Security: no parameters → no injection surface.
    -- Privacy: returns only count, no raw_text or user data (SEC-12).
    CREATE OR REPLACE FUNCTION system_expire_pending_drafts()
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
    AS $$
    DECLARE
      v_expired_count INTEGER;
    BEGIN
      -- Batch UPDATE: pending_user drafts whose expires_at has passed.
      -- The DB trigger (enforce_draft_state_machine) will run per-row and
      -- verify pending_user → expired is a valid transition (it is: terminal
      -- states are 'approved', 'rejected', 'expired' — pending_user is not terminal).
      UPDATE transaction_drafts
         SET status = 'expired',
             updated_at = NOW()
       WHERE status = 'pending_user'
         AND expires_at <= NOW();

      -- ROW_COUNT: number of rows affected by the last SQL statement
      GET DIAGNOSTICS v_expired_count = ROW_COUNT;

      RETURN v_expired_count;
    END;
    $$;

    -- Restrict execution to midas_app only (consistent with system_find_or_create_user)
    REVOKE ALL ON FUNCTION system_expire_pending_drafts() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION system_expire_pending_drafts() TO midas_app;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS system_expire_pending_drafts();
  `);
};
