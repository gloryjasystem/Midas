/**
 * Migration: Onboarding Placeholder Flag — Lazy Default Account
 *
 * Problem:
 *   system_find_or_create_user creates a Default·USDT account for every new user
 *   at registration time. When a user then creates their own account during onboarding,
 *   they end up with two accounts:
 *     1. Default·USDT  (automatic, they don't want it)
 *     2. Their custom account (e.g. Тинькофф·RUB)
 *
 *   Both appear in /balance and /accounts — breaking context-aware account isolation.
 *
 * Solution: Lazy Default Account via is_onboarding_placeholder flag.
 *
 *   A. ADD COLUMN account_sources.is_onboarding_placeholder BOOLEAN NOT NULL DEFAULT FALSE
 *      - Default FALSE: does not affect any existing rows or queries.
 *      - Column is advisory metadata only — queries do NOT filter on it except
 *        in the two onboarding transition handlers (ac:skip and ac:currency success).
 *      - Partial index for efficient lookup of placeholder rows.
 *
 *   B. UPDATE system_find_or_create_user (7-param, same signature as Phase 1.24):
 *      - The account_sources INSERT now sets is_onboarding_placeholder = TRUE
 *        for the seeded Default account.
 *      - All other function logic is IDENTICAL to migration 1778500000000.
 *      - No signature change.
 *
 * Transition handlers (application layer — no DB change needed):
 *   ac:skip  → UPDATE account_sources SET is_onboarding_placeholder = FALSE
 *              (activates the Default account as the user's real account)
 *   ac:currency + bal_skip/bal_input success →
 *              UPDATE account_sources SET deleted_at = NOW()
 *              WHERE is_onboarding_placeholder = TRUE AND deleted_at IS NULL
 *              (soft-deletes the Default — custom account takes over)
 *
 * Scenario C fallback (draft-confirmation.service.ts resolveDefaultAccount):
 *   Step 2 fallback LIMIT 1 query gains AND deleted_at IS NULL to avoid
 *   routing transactions to a soft-deleted placeholder.
 *   (Applied in application code — no migration needed.)
 *
 * Existing data:
 *   - All existing account_sources rows: is_onboarding_placeholder = FALSE (DEFAULT).
 *   - Existing users are unaffected — their Default accounts are already live.
 *   - No backfill required.
 *
 * Down migration:
 *   - Drops the partial index.
 *   - Drops the column (safe — no FK references).
 *   - Restores system_find_or_create_user to the Phase 1.24 version (without the flag).
 *
 * Security:
 *   - SECURITY DEFINER maintained (same as all prior versions).
 *   - search_path = 'public', 'pg_catalog' maintained.
 *   - EXECUTE granted only to midas_app.
 *   - No new parameters — same 7-param signature.
 *   - No user-controlled data influences the flag value.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    -- ── Step A: Add is_onboarding_placeholder column ─────────────────────────
    -- DEFAULT FALSE: all existing rows become non-placeholder (safe, no backfill).
    -- Column is BOOLEAN NOT NULL to avoid nullable three-state logic.
    ALTER TABLE account_sources
      ADD COLUMN IF NOT EXISTS is_onboarding_placeholder BOOLEAN NOT NULL DEFAULT FALSE;

    -- Partial index for efficient lookup — only placeholder rows need fast access
    -- (called at most once per user during onboarding transition).
    CREATE INDEX IF NOT EXISTS idx_account_sources_onboarding_placeholder
      ON account_sources (workspace_id)
      WHERE is_onboarding_placeholder = TRUE AND deleted_at IS NULL;

    -- ── Step B: Update system_find_or_create_user ─────────────────────────────
    -- Identical to Phase 1.24 version (1778500000000) except:
    --   - account_sources INSERT adds: is_onboarding_placeholder = TRUE
    -- Signature unchanged: 7 parameters.
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

      -- Phase 1.24: default_currency = 'USDT'.
      INSERT INTO workspaces (id, name, default_currency)
        VALUES (p_candidate_workspace_id, p_workspace_name, 'USDT');

      INSERT INTO workspace_memberships (id, user_id, workspace_id, role, is_default)
        VALUES (p_candidate_membership_id, p_candidate_user_id, p_candidate_workspace_id, 'owner', true);

      -- ── Step 6: Seed default account_sources row (is_onboarding_placeholder = TRUE) ─
      -- Phase Lazy-Default: marks the seeded account as a placeholder.
      -- If user completes onboarding with custom account → placeholder is soft-deleted.
      -- If user skips onboarding               → placeholder flag cleared (becomes real).
      -- ON CONFLICT DO NOTHING: defense-in-depth if advisory lock ever fails.
      INSERT INTO account_sources (id, workspace_id, name, type, currency, is_onboarding_placeholder)
        VALUES (
          p_candidate_account_id,
          p_candidate_workspace_id,
          'Default',
          'manual'::account_source_type,
          'USDT',
          TRUE   -- ← Lazy Default: this account is a placeholder until onboarding resolves
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
  // Restore system_find_or_create_user to Phase 1.24 version (without is_onboarding_placeholder).
  // Then drop the column and index.
  pgm.sql(`
    -- Restore Phase 1.24 version of system_find_or_create_user (no placeholder flag)
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
        VALUES (p_candidate_workspace_id, p_workspace_name, 'USDT');

      INSERT INTO workspace_memberships (id, user_id, workspace_id, role, is_default)
        VALUES (p_candidate_membership_id, p_candidate_user_id, p_candidate_workspace_id, 'owner', true);

      INSERT INTO account_sources (id, workspace_id, name, type, currency)
        VALUES (
          p_candidate_account_id,
          p_candidate_workspace_id,
          'Default',
          'manual'::account_source_type,
          'USDT'
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

    -- Drop partial index first, then the column
    DROP INDEX IF EXISTS idx_account_sources_onboarding_placeholder;
    ALTER TABLE account_sources DROP COLUMN IF EXISTS is_onboarding_placeholder;
  `);
};
