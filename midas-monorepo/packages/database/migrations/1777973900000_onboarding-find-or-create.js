/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Phase 1.5: Add system_find_or_create_user SECURITY DEFINER function.
 *
 * Background:
 *   The existing system_create_onboarding_workspace function creates all 3 rows
 *   atomically but has no way to return the resolved IDs or handle the case where
 *   the user already exists. When a user already exists, the function's workspace
 *   INSERT will fail (unique constraint or wrong workspace ID).
 *
 * This migration replaces it with system_find_or_create_user which:
 *   1. Checks if user exists (SECURITY DEFINER = exempt from RLS, can read all users)
 *   2. If exists → returns existing (user_id, workspace_id, false)
 *   3. If not → creates User + Workspace + Membership atomically, returns (user_id, workspace_id, true)
 *
 * Security:
 *   - Executes as midas_migrator (table owner, exempt from RLS: relforcerowsecurity=false)
 *   - Only midas_app can call it (REVOKE + GRANT pattern)
 *   - No user-controlled data is used for access control decisions
 *   - telegram_id is a BIGINT input — no SQL injection risk (parameterized)
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- system_find_or_create_user: idempotent find-or-create for onboarding
    -- Returns: (user_id VARCHAR(26), workspace_id VARCHAR(26), is_new_user BOOLEAN)
    -- Executes as midas_migrator (SECURITY DEFINER) to bypass RLS.
    CREATE OR REPLACE FUNCTION system_find_or_create_user(
      p_telegram_id     BIGINT,
      p_candidate_user_id      VARCHAR(26),
      p_candidate_workspace_id VARCHAR(26),
      p_candidate_membership_id VARCHAR(26),
      p_workspace_name  TEXT
    )
    RETURNS TABLE(user_id VARCHAR(26), workspace_id VARCHAR(26), is_new_user BOOLEAN)
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      v_user_id      VARCHAR(26);
      v_workspace_id VARCHAR(26);
    BEGIN
      -- Step 1: Check if user already exists
      SELECT u.id, wm.workspace_id
        INTO v_user_id, v_workspace_id
        FROM users u
        JOIN workspace_memberships wm ON wm.user_id = u.id
       WHERE u.telegram_id = p_telegram_id
         AND wm.is_default = true
       LIMIT 1;

      -- Step 2: If found, return existing (no-op)
      IF FOUND THEN
        RETURN QUERY SELECT v_user_id, v_workspace_id, false::BOOLEAN;
        RETURN;
      END IF;

      -- Step 3: New user — create atomically
      -- Use advisory lock to prevent concurrent /start race on same telegram_id
      PERFORM pg_advisory_xact_lock(p_telegram_id);

      -- Re-check after acquiring lock (another concurrent call may have created the user)
      SELECT u.id, wm.workspace_id
        INTO v_user_id, v_workspace_id
        FROM users u
        JOIN workspace_memberships wm ON wm.user_id = u.id
       WHERE u.telegram_id = p_telegram_id
         AND wm.is_default = true
       LIMIT 1;

      IF FOUND THEN
        RETURN QUERY SELECT v_user_id, v_workspace_id, false::BOOLEAN;
        RETURN;
      END IF;

      -- Truly new user — insert all 3 rows
      INSERT INTO users (id, telegram_id)
        VALUES (p_candidate_user_id, p_telegram_id);

      INSERT INTO workspaces (id, name, default_currency)
        VALUES (p_candidate_workspace_id, p_workspace_name, 'RUB');

      INSERT INTO workspace_memberships (id, user_id, workspace_id, role, is_default)
        VALUES (p_candidate_membership_id, p_candidate_user_id, p_candidate_workspace_id, 'owner', true);

      RETURN QUERY SELECT p_candidate_user_id, p_candidate_workspace_id, true::BOOLEAN;
    END;
    $$;

    -- Restrict to midas_app only
    REVOKE ALL ON FUNCTION system_find_or_create_user(BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION system_find_or_create_user(BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT) TO midas_app;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS system_find_or_create_user(BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT);
  `);
};
