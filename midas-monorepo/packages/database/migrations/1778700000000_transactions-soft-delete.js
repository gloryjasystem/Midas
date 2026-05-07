/**
 * Migration: 1778700000000_transactions-soft-delete.js
 * Phase 1.29 — Soft Delete for Transactions
 *
 * Adds deleted_at TIMESTAMPTZ DEFAULT NULL to the transactions table.
 *
 * Design:
 *   - DEFAULT NULL = all existing rows are NOT deleted (safe, no backfill).
 *   - Adding a nullable column with DEFAULT NULL is an online operation in
 *     PostgreSQL — no table rewrite, minimal lock contention.
 *   - Application code filters with WHERE deleted_at IS NULL to exclude
 *     soft-deleted rows from all business queries (/balance, /report, /edit list).
 *   - RLS policy (tenant_isolation_transactions) is unchanged — deleted rows
 *     still belong to the same workspace; the filter is a business-layer concern.
 *
 * down() uses DROP COLUMN IF EXISTS for safe idempotent rollback.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE transactions
      ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE transactions
      DROP COLUMN IF EXISTS deleted_at
  `);
};
