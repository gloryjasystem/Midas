/**
 * Migration 1780500000000 — Phase 3.0: Account Type + Provider Key
 *
 * Adds two optional columns to account_sources for richer account classification:
 *   - account_type: card, cash, exchange, wallet, custom
 *   - provider_key: freeform text for specific provider (e.g. 'binance', 'monobank')
 *
 * Design decisions:
 *   - Both columns are nullable (NULL = not set / unclassified)
 *   - account_type has a CHECK constraint (allowlist)
 *   - provider_key is freeform text (no constraint)
 *   - IF NOT EXISTS / IF EXISTS guards — idempotent, safe to re-run
 *
 * ESM format (matches packages/database "type": "module").
 * SEC-03: DDL migration — no tenant context needed.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE account_sources
      ADD COLUMN IF NOT EXISTS account_type TEXT
        CHECK (account_type IN ('card', 'cash', 'exchange', 'wallet', 'custom')),
      ADD COLUMN IF NOT EXISTS provider_key TEXT;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE account_sources
      DROP COLUMN IF EXISTS provider_key,
      DROP COLUMN IF EXISTS account_type;
  `);
};
