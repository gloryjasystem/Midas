/**
 * Phase 1.7 Security Hardening: fix search_path for system_expire_pending_drafts().
 *
 * Issue: The original 1777973960000_draft-expiration migration created the function
 * without an explicit search_path (proconfig = NULL). PostgreSQL best practice for
 * SECURITY DEFINER functions requires a fixed search_path to prevent search_path
 * injection attacks.
 *
 * Risk assessment:
 *   - midas_app CANNOT CREATE objects in the public schema (verified: has_schema_privilege = false)
 *   - Therefore the attack vector is NOT exploitable in this environment
 *   - However: defense-in-depth and PostgreSQL official guidelines require explicit search_path
 *   - Consistent with production hardening expectations
 *
 * Fix: ADD SET search_path = public, pg_catalog to the function definition.
 * This does not change function behavior — all objects (transaction_drafts) are already in public.
 *
 * Note on owner:
 *   The function is owned by midas_user (dev superuser) because this dev environment runs
 *   migrations as midas_user rather than a dedicated midas_migrator role. In production,
 *   migrations would run as midas_migrator. This is a dev environment limitation, not a code defect.
 *   The REVOKE PUBLIC + GRANT midas_app pattern is correct and enforced.
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
    -- Harden system_expire_pending_drafts: add explicit search_path.
    -- CREATE OR REPLACE preserves SECURITY DEFINER, owner, and grants.
    CREATE OR REPLACE FUNCTION system_expire_pending_drafts()
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
    AS $$
    DECLARE
      v_expired_count INTEGER;
    BEGIN
      UPDATE transaction_drafts
         SET status = 'expired',
             updated_at = NOW()
       WHERE status = 'pending_user'
         AND expires_at <= NOW();

      GET DIAGNOSTICS v_expired_count = ROW_COUNT;

      RETURN v_expired_count;
    END;
    $$;

    -- Re-apply grants explicitly (CREATE OR REPLACE may reset in some PG versions).
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
    -- Revert to no search_path (functionally equivalent but less hardened)
    CREATE OR REPLACE FUNCTION system_expire_pending_drafts()
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      v_expired_count INTEGER;
    BEGIN
      UPDATE transaction_drafts
         SET status = 'expired',
             updated_at = NOW()
       WHERE status = 'pending_user'
         AND expires_at <= NOW();

      GET DIAGNOSTICS v_expired_count = ROW_COUNT;

      RETURN v_expired_count;
    END;
    $$;

    REVOKE ALL ON FUNCTION system_expire_pending_drafts() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION system_expire_pending_drafts() TO midas_app;
  `);
};
