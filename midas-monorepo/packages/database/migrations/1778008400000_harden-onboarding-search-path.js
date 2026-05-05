/**
 * Migration: Harden onboarding SECURITY DEFINER functions — Phase 1.8-B (C-2)
 *
 * Problem:
 *   system_create_onboarding_workspace and system_find_or_create_user
 *   are SECURITY DEFINER functions owned by midas_migrator, but they lack
 *   a fixed search_path. This leaves them vulnerable to search_path
 *   hijacking (CVE-style: if a malicious schema is placed before 'public'
 *   in the search_path, the function could resolve tables from the wrong schema).
 *
 *   system_expire_pending_drafts was already hardened in Phase 1.7
 *   (migration 1777973970000). This migration applies the same fix to the
 *   two onboarding functions.
 *
 * Changes:
 *   - ALTER FUNCTION ... SET search_path = 'public', 'pg_catalog'
 *   - No behavior change — only search_path is fixed
 *   - Owners remain midas_migrator
 *   - EXECUTE remains revoked from PUBLIC
 *   - EXECUTE remains granted to midas_app only
 *
 * SEC-03: No tenant context needed — this is a structural DDL migration.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    -- Harden system_create_onboarding_workspace
    ALTER FUNCTION system_create_onboarding_workspace(
      VARCHAR, BIGINT, VARCHAR, TEXT, VARCHAR
    ) SET search_path = 'public', 'pg_catalog';

    -- Harden system_find_or_create_user
    ALTER FUNCTION system_find_or_create_user(
      BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT
    ) SET search_path = 'public', 'pg_catalog';
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER FUNCTION system_create_onboarding_workspace(
      VARCHAR, BIGINT, VARCHAR, TEXT, VARCHAR
    ) RESET search_path;

    ALTER FUNCTION system_find_or_create_user(
      BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT
    ) RESET search_path;
  `);
};
