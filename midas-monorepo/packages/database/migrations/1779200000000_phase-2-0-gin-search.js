/**
 * Migration: 1779200000000_phase-2-0-gin-search.js
 * Phase 2.0 — GIN Trigram Index for Transaction Search
 *
 * Creates a pg_trgm GIN index on transactions.item_name for fast
 * ILIKE '%query%' full-text search.
 *
 * Design:
 *   - pg_trgm extension enables trigram-based fuzzy matching.
 *   - GIN index avoids sequential scans on ILIKE queries at scale.
 *   - CREATE INDEX CONCURRENTLY is preferred in production but not supported
 *     inside a transaction (node-pg-migrate wraps migrations in transactions).
 *     Using regular CREATE INDEX — brief lock, acceptable at current data volume.
 *   - Rollback drops the index and extension.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_tx_item_name_gin
      ON transactions USING gin(item_name gin_trgm_ops)
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_tx_item_name_gin`);
  // Note: not dropping pg_trgm extension — may be used by other features
};
