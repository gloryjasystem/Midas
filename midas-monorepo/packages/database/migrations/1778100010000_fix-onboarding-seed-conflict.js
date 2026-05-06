/**
 * Migration: Fix ON CONFLICT ambiguity in system_find_or_create_user — Phase 1.12 fix
 *
 * Problem:
 *   Migration 1778100000000 created system_find_or_create_user (7-param) which uses:
 *     ON CONFLICT (workspace_id, name) DO NOTHING
 *   inside the categories INSERT. PostgreSQL's PL/pgSQL compiler treats 'workspace_id'
 *   as ambiguous because it also appears in the RETURNS TABLE clause:
 *     RETURNS TABLE(user_id VARCHAR(26), workspace_id VARCHAR(26), is_new_user BOOLEAN)
 *
 *   Error: column reference "workspace_id" is ambiguous (code 42702).
 *
 * Fix:
 *   Replace ON CONFLICT (workspace_id, name) with:
 *     ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING
 *   The constraint name is unambiguous and avoids the column-reference issue.
 *
 *   All other function logic is identical to 1778100000000.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION system_find_or_create_user(
      p_telegram_id             BIGINT,
      p_candidate_user_id       VARCHAR(26),
      p_candidate_workspace_id  VARCHAR(26),
      p_candidate_membership_id VARCHAR(26),
      p_workspace_name          TEXT,
      p_candidate_account_id    VARCHAR(26),
      p_candidate_category_id   VARCHAR(26)
    )
    RETURNS TABLE(user_id VARCHAR(26), workspace_id VARCHAR(26), is_new_user BOOLEAN)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = 'public', 'pg_catalog'
    AS $$
    DECLARE
      v_user_id      VARCHAR(26);
      v_workspace_id VARCHAR(26);
    BEGIN
      -- ── Step 1: Check if user already exists (fast path) ─────────────────────
      SELECT u.id, wm.workspace_id
        INTO v_user_id, v_workspace_id
        FROM users u
        JOIN workspace_memberships wm ON wm.user_id = u.id
       WHERE u.telegram_id = p_telegram_id
         AND wm.is_default = true
       LIMIT 1;

      -- ── Step 2: Existing user — return immediately (no seeding) ──────────────
      IF FOUND THEN
        RETURN QUERY SELECT v_user_id, v_workspace_id, false::BOOLEAN;
        RETURN;
      END IF;

      -- ── Step 3: New user — acquire advisory lock to prevent concurrent /start ─
      PERFORM pg_advisory_xact_lock(p_telegram_id);

      -- ── Step 4: Re-check after acquiring lock ─────────────────────────────────
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

      -- ── Step 5: Truly new user — insert core entities ────────────────────────
      INSERT INTO users (id, telegram_id)
        VALUES (p_candidate_user_id, p_telegram_id);

      -- default_currency = 'RUB' matches workspace schema DEFAULT and existing INSERT.
      INSERT INTO workspaces (id, name, default_currency)
        VALUES (p_candidate_workspace_id, p_workspace_name, 'RUB');

      INSERT INTO workspace_memberships (id, user_id, workspace_id, role, is_default)
        VALUES (p_candidate_membership_id, p_candidate_user_id, p_candidate_workspace_id, 'owner', true);

      -- ── Step 6: Seed default account_sources row ─────────────────────────────
      -- currency = 'RUB' = workspace.default_currency (set above).
      -- account_sources has no UNIQUE constraint on (workspace_id, name), so
      -- ON CONFLICT DO NOTHING catches PK conflicts only (advisory lock prevents
      -- true duplicate rows from concurrent calls).
      INSERT INTO account_sources (id, workspace_id, name, type, currency)
        VALUES (
          p_candidate_account_id,
          p_candidate_workspace_id,
          'Default',
          'manual'::account_source_type,
          'RUB'
        )
        ON CONFLICT DO NOTHING;

      -- ── Step 7: Seed default categories row ──────────────────────────────────
      -- Use constraint name to avoid PL/pgSQL column-reference ambiguity with the
      -- RETURNS TABLE 'workspace_id' output column (PostgreSQL code 42702 fix).
      -- Constraint: categories_workspace_id_name_key UNIQUE(workspace_id, name).
      INSERT INTO categories (id, workspace_id, name, "group")
        VALUES (
          p_candidate_category_id,
          p_candidate_workspace_id,
          'Разное',
          'Жизнь'::category_group
        )
        ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING;

      RETURN QUERY SELECT p_candidate_user_id, p_candidate_workspace_id, true::BOOLEAN;
    END;
    $$;

    -- Maintain EXECUTE permissions (same policy as all previous versions)
    REVOKE ALL ON FUNCTION system_find_or_create_user(BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION system_find_or_create_user(BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) TO midas_app;
  `);
};

export const down = (pgm) => {
  // Restore to the first Phase 1.12 version (with the ON CONFLICT ambiguity —
  // this is a best-effort rollback; the 1778100000000 down migration handles
  // rolling back to the 5-param pre-Phase-1.12 version if needed).
  pgm.sql(`
    CREATE OR REPLACE FUNCTION system_find_or_create_user(
      p_telegram_id             BIGINT,
      p_candidate_user_id       VARCHAR(26),
      p_candidate_workspace_id  VARCHAR(26),
      p_candidate_membership_id VARCHAR(26),
      p_workspace_name          TEXT,
      p_candidate_account_id    VARCHAR(26),
      p_candidate_category_id   VARCHAR(26)
    )
    RETURNS TABLE(user_id VARCHAR(26), workspace_id VARCHAR(26), is_new_user BOOLEAN)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = 'public', 'pg_catalog'
    AS $$
    DECLARE
      v_user_id      VARCHAR(26);
      v_workspace_id VARCHAR(26);
    BEGIN
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

      PERFORM pg_advisory_xact_lock(p_telegram_id);

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

      INSERT INTO users (id, telegram_id)
        VALUES (p_candidate_user_id, p_telegram_id);

      INSERT INTO workspaces (id, name, default_currency)
        VALUES (p_candidate_workspace_id, p_workspace_name, 'RUB');

      INSERT INTO workspace_memberships (id, user_id, workspace_id, role, is_default)
        VALUES (p_candidate_membership_id, p_candidate_user_id, p_candidate_workspace_id, 'owner', true);

      INSERT INTO account_sources (id, workspace_id, name, type, currency)
        VALUES (
          p_candidate_account_id,
          p_candidate_workspace_id,
          'Default',
          'manual'::account_source_type,
          'RUB'
        )
        ON CONFLICT DO NOTHING;

      -- Note: ON CONFLICT (workspace_id, name) is ambiguous in plpgsql — this is
      -- the unfixed version restored by rollback.
      INSERT INTO categories (id, workspace_id, name, "group")
        VALUES (
          p_candidate_category_id,
          p_candidate_workspace_id,
          'Разное',
          'Жизнь'::category_group
        )
        ON CONFLICT (workspace_id, name) DO NOTHING;

      RETURN QUERY SELECT p_candidate_user_id, p_candidate_workspace_id, true::BOOLEAN;
    END;
    $$;

    REVOKE ALL ON FUNCTION system_find_or_create_user(BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION system_find_or_create_user(BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) TO midas_app;
  `);
};
