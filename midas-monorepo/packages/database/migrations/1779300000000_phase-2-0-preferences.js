/**
 * Migration: 1779300000000_phase-2-0-preferences.js
 * Phase 2.0 — User Preferences Table
 *
 * Creates user_preferences table with:
 *   - daily_summary_enabled / daily_summary_hour
 *   - limit_alerts_enabled
 *   - record_reminder_enabled
 *   - number_format ('ru' | 'en' | 'de')
 *   - language ('ru' | 'en' | 'ua')
 *
 * Design:
 *   - UNIQUE(workspace_id) — one prefs row per workspace.
 *   - RLS tenant isolation via workspace_id.
 *   - GRANT only SELECT/INSERT/UPDATE — no DELETE (prefs are permanent).
 *   - down() drops the table cleanly.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE user_preferences (
      id VARCHAR(26) PRIMARY KEY,
      workspace_id VARCHAR(26) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      daily_summary_enabled BOOLEAN NOT NULL DEFAULT false,
      daily_summary_hour SMALLINT NOT NULL DEFAULT 21,
      limit_alerts_enabled BOOLEAN NOT NULL DEFAULT false,
      record_reminder_enabled BOOLEAN NOT NULL DEFAULT false,
      number_format TEXT NOT NULL DEFAULT 'ru',
      language TEXT NOT NULL DEFAULT 'ru',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id)
    )
  `);
  pgm.sql(`ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY user_preferences_tenant ON user_preferences
      USING (workspace_id = current_setting('app.current_workspace_id'))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON user_preferences TO midas_app`);
};

export const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS user_preferences CASCADE`);
};
