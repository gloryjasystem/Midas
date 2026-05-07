/**
 * Migration: 1778800000000_drafts-account-hint.js
 * Phase 1.31 — Inline Account Creation During Transaction Input
 *
 * Adds parsed_account_hint TEXT (nullable) to transaction_drafts.
 *
 * Purpose: The ai-parse worker extracts an account/place name hint from the
 * user message (AI account_hint field). The hint must survive the async gap
 * between parse completion and the user tapping confirm — which can be minutes.
 * Storing it in the draft row (rather than Redis TTL) makes it durable.
 *
 * Design:
 *   - DEFAULT NULL — all existing rows unaffected. No backfill needed.
 *   - Adding a nullable TEXT column is an online operation in PostgreSQL —
 *     no table rewrite, no lock contention.
 *   - All existing INSERT/SELECT queries on transaction_drafts are unaffected.
 *
 * down() uses DROP COLUMN IF EXISTS for safe idempotent rollback.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE transaction_drafts
      ADD COLUMN parsed_account_hint TEXT DEFAULT NULL
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE transaction_drafts
      DROP COLUMN IF EXISTS parsed_account_hint
  `);
};
