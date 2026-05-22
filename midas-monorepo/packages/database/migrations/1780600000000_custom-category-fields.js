/**
 * Migration 1780600000000 — Phase 4.0-A: Custom Category Fields
 *
 * Adds three columns to `categories` for user-defined semantic categories:
 *   - icon:          Single Unicode emoji chosen by AI or user (display only)
 *   - semantic_rule: Free-text description of what transactions belong here
 *   - is_custom:     true = user-created via FSM, false = standard taxonomy
 *
 * Design decisions:
 *   - icon & semantic_rule are nullable (standard categories don't need them)
 *   - is_custom defaults to false — all existing rows remain standard
 *   - Partial index on (workspace_id) WHERE is_custom = true —
 *     optimizes the two queries in ai-parse.worker that fetch custom rules
 *     before every parseTransaction() call. Expected cardinality: 0-20 rows.
 *   - IF NOT EXISTS / IF EXISTS guards — idempotent, safe to re-run
 *
 * ESM format (matches packages/database "type": "module").
 * SEC-03: DDL migration — no tenant context needed.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE categories
      ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS semantic_rule TEXT DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT false;
  `);

  // Partial index: only custom categories (typically 0-20 per workspace).
  // Used by ai-parse.worker to fetch semantic rules before Claude calls.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_categories_custom
      ON categories (workspace_id)
      WHERE is_custom = true;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_categories_custom;
  `);

  pgm.sql(`
    ALTER TABLE categories
      DROP COLUMN IF EXISTS is_custom,
      DROP COLUMN IF EXISTS semantic_rule,
      DROP COLUMN IF EXISTS icon;
  `);
};
