/**
 * Migration 1780700000000 — Phase 7.0-A: Summary Presets
 *
 * Adds two columns to `user_preferences` for summary time configuration:
 *   - daily_summary_minute: 0-59, allows HH:MM precision (was hour-only)
 *   - summary_preset: 'morning'|'evening'|'night'|'custom' — tracks which preset is active
 *
 * Design decisions:
 *   - daily_summary_minute defaults to 0 — existing users keep :00 behavior
 *   - summary_preset is nullable — existing users have no preset selected
 *   - IF NOT EXISTS guards — idempotent, safe to re-run
 *
 * ESM format (matches packages/database "type": "module").
 * SEC-03: DDL migration — no tenant context needed.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE user_preferences
      ADD COLUMN IF NOT EXISTS daily_summary_minute SMALLINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS summary_preset TEXT
        CHECK (summary_preset IN ('morning','evening','night','custom'));
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE user_preferences
      DROP COLUMN IF EXISTS summary_preset,
      DROP COLUMN IF EXISTS daily_summary_minute;
  `);
};
