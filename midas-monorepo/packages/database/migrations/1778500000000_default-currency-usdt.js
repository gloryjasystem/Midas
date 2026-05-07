/**
 * Migration: Default Currency RUB → USDT — Phase 1.24
 *
 * Changes the default workspace currency and the default account currency
 * for ALL NEW users from 'RUB' to 'USDT'.
 *
 * Motivation:
 *   Midas is primarily a crypto-focused finance tracker. New users should
 *   start with USDT as the default stablecoin currency rather than RUB.
 *
 * Scope:
 *   1. ALTER TABLE workspaces ALTER COLUMN default_currency SET DEFAULT 'USDT'
 *      — affects only future INSERTs that omit default_currency.
 *      — does NOT backfill existing rows (1184 RUB + 165 USD workspaces stay unchanged).
 *
 *   2. CREATE OR REPLACE FUNCTION system_find_or_create_user(...)
 *      — updates the hardcoded 'RUB' literals in workspace and account_sources INSERTs to 'USDT'.
 *      — existing-user path: unchanged (no seeding, early return).
 *      — no schema changes, no new parameters, same function signature.
 *
 * Existing data:
 *   - 1184 workspaces with default_currency='RUB': UNTOUCHED.
 *   - 165 workspaces with default_currency='USD':  UNTOUCHED.
 *   - All existing account_sources rows: UNTOUCHED.
 *   - All transactions: UNTOUCHED.
 *   - No backfill of any kind.
 *
 * Security:
 *   - Executes as midas_migrator (SECURITY DEFINER, exempt from RLS)
 *   - search_path = 'public', 'pg_catalog' (prevents search_path hijacking)
 *   - Only midas_app can EXECUTE (REVOKE + GRANT maintained)
 *   - All parameters remain parameterized — no SQL injection risk
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    -- ── Step 1: Change column DEFAULT from 'RUB' to 'USDT' ──────────────────
    -- Only affects future INSERTs that omit default_currency.
    -- Existing rows are NOT touched.
    ALTER TABLE workspaces
      ALTER COLUMN default_currency SET DEFAULT 'USDT';

    -- ── Step 2: Update system_find_or_create_user to use 'USDT' ─────────────
    -- Identical function to 1778100010000_fix-onboarding-seed-conflict.js,
    -- with 'RUB' replaced by 'USDT' in:
    --   a) INSERT INTO workspaces ... default_currency = 'USDT'
    --   b) INSERT INTO account_sources ... currency = 'USDT'
    -- The function signature (7 params) is unchanged.
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

      -- Phase 1.24: default_currency = 'USDT' (was 'RUB').
      -- Existing workspaces are untouched — only new INSERTs use 'USDT'.
      INSERT INTO workspaces (id, name, default_currency)
        VALUES (p_candidate_workspace_id, p_workspace_name, 'USDT');

      INSERT INTO workspace_memberships (id, user_id, workspace_id, role, is_default)
        VALUES (p_candidate_membership_id, p_candidate_user_id, p_candidate_workspace_id, 'owner', true);

      -- ── Step 6: Seed default account_sources row ─────────────────────────────
      -- Phase 1.24: currency = 'USDT' (was 'RUB') = workspace.default_currency (set above).
      -- ON CONFLICT DO NOTHING: defense-in-depth if advisory lock ever fails.
      INSERT INTO account_sources (id, workspace_id, name, type, currency)
        VALUES (
          p_candidate_account_id,
          p_candidate_workspace_id,
          'Default',
          'manual'::account_source_type,
          'USDT'
        )
        ON CONFLICT DO NOTHING;

      -- ── Step 7: Seed default categories row ──────────────────────────────────
      -- Constraint name avoids PL/pgSQL column-reference ambiguity (Phase 1.12 fix).
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
  // Restore 'RUB' as default currency — reverts Phase 1.24 changes.
  pgm.sql(`
    ALTER TABLE workspaces
      ALTER COLUMN default_currency SET DEFAULT 'RUB';

    -- Restore system_find_or_create_user with 'RUB' (Phase 1.12 fix version)
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

    REVOKE ALL ON FUNCTION system_find_or_create_user(BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION system_find_or_create_user(BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) TO midas_app;
  `);
};
