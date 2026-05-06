/**
 * Migration — Phase 1.16: account_sources UNIQUE(workspace_id, name)
 *
 * Adds a UNIQUE constraint on (workspace_id, name) to account_sources so that
 * the forthcoming /add_account write path can use:
 *   ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING
 *
 * This mirrors the existing pattern on categories:
 *   UNIQUE(workspace_id, name) → categories_workspace_id_name_key
 *
 * Pre-flight guard: the up() function checks for existing duplicate
 * (workspace_id, name) pairs before attempting to add the constraint.
 * If any duplicates are found, the migration FAILS immediately with a
 * descriptive error and does NOT auto-fix any data.
 *
 * Constraint name: account_sources_workspace_id_name_key
 * (PostgreSQL auto-names ADD CONSTRAINT UNIQUE with this convention.)
 *
 * SEC-03: No tenant context required — migration runs as midas_migrator
 *         which is exempt from RLS (BYPASSRLS role reserved for migrator only).
 * SEC-02: No financial amounts touched.
 */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // ── Pre-flight duplicate check ───────────────────────────────────────────
  // If any (workspace_id, name) pair exists more than once, the constraint
  // addition would fail with a confusing PG error. We surface a clear
  // FAIL message instead and abort — no data mutation attempted.
  pgm.sql(`
    DO $$
    DECLARE
      dup_count INTEGER;
    BEGIN
      SELECT COUNT(*) INTO dup_count
      FROM (
        SELECT workspace_id, name
        FROM account_sources
        GROUP BY workspace_id, name
        HAVING COUNT(*) > 1
      ) AS duplicates;

      IF dup_count > 0 THEN
        RAISE EXCEPTION
          'Phase 1.16 FAIL: % duplicate (workspace_id, name) pair(s) found in account_sources. '
          'Manual deduplication required before adding UNIQUE constraint. '
          'Migration aborted — no data was modified.',
          dup_count;
      END IF;
    END $$;
  `);

  // ── Add UNIQUE constraint ─────────────────────────────────────────────────
  // Standard ALTER TABLE for MVP/local dev scale.
  // Constraint name explicitly specified to match the PostgreSQL convention
  // used by the categories table (categories_workspace_id_name_key).
  pgm.sql(`
    ALTER TABLE account_sources
      ADD CONSTRAINT account_sources_workspace_id_name_key
      UNIQUE (workspace_id, name);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE account_sources
      DROP CONSTRAINT IF EXISTS account_sources_workspace_id_name_key;
  `);
};
