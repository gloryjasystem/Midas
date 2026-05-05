/**
 * Phase 1.7 Security Hardening: transfer system_expire_pending_drafts ownership
 * from midas_user (dev superuser) to midas_migrator (correct service owner).
 *
 * Background:
 *   - The original migration was run by midas_user (the dev superuser in this environment),
 *     so the function was created with owner = midas_user.
 *   - All other SECURITY DEFINER functions (system_find_or_create_user,
 *     system_create_onboarding_workspace) are owned by midas_migrator.
 *   - In production, migrations will run as midas_migrator and this discrepancy
 *     will not occur. This corrective migration aligns the dev environment with
 *     the intended production ownership model.
 *
 * Effect:
 *   - SECURITY DEFINER: function still runs with midas_migrator privileges (not midas_user superuser).
 *     This is actually MORE secure: midas_migrator is not a superuser and has no BYPASSRLS.
 *   - EXECUTE grant to midas_app is preserved (ALTER FUNCTION OWNER does not affect grants).
 *   - search_path = public, pg_catalog is preserved.
 *
 * Note: This migration must be run as midas_user (superuser) because only the current
 * owner or a superuser can change function ownership.
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
    -- Transfer ownership of system_expire_pending_drafts to midas_migrator.
    -- Consistent with system_find_or_create_user and system_create_onboarding_workspace.
    ALTER FUNCTION system_expire_pending_drafts() OWNER TO midas_migrator;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const down = (pgm) => {
  pgm.sql(`
    -- Revert ownership back to midas_user (dev superuser).
    ALTER FUNCTION system_expire_pending_drafts() OWNER TO midas_user;
  `);
};
