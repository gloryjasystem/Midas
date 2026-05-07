/**
 * Migration: workspace timezone column — Phase 1.25
 *
 * Adds `timezone TEXT NOT NULL DEFAULT 'UTC'` to the workspaces table.
 *
 * Purpose:
 *   Stores the user's preferred IANA timezone for future use in Phase 2.6
 *   (reminders in local time). Also exposed via /settings timezone <IANA_ZONE>.
 *
 * Impact on existing data:
 *   - All existing workspace rows receive timezone = 'UTC' (via DEFAULT).
 *   - No other columns changed. No data recalculated.
 *
 * Security:
 *   - No SECURITY DEFINER needed — DDL only, run by midas_migrator.
 *   - Timezone values are validated in application layer before any UPDATE.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE workspaces
      ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE workspaces
      DROP COLUMN timezone;
  `);
};
