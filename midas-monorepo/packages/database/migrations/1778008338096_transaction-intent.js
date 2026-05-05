/**
 * Migration: Transaction Intent Foundation — Phase 1.8-A
 *
 * Adds intent tracking to the draft → transaction pipeline.
 *
 * Problem solved:
 *   AiOutput.intent ('expense'|'income'|'debt_given'|'debt_received'|'transfer')
 *   was being silently dropped after Zod validation. Neither transaction_drafts
 *   nor transactions stored the parsed intent. This made future /report and
 *   /balance commands impossible to implement correctly.
 *
 * Changes:
 *   1. transaction_drafts.parsed_intent TEXT NULLable
 *      - NULL is valid: needs_clarification drafts may have no intent
 *      - CHECK constraint enforces allowlist when non-NULL
 *
 *   2. transactions.transaction_intent TEXT NOT NULL
 *      - Migration backfills existing rows with 'expense'
 *      - Then sets NOT NULL — future INSERTs must explicitly provide a value
 *      - CHECK constraint enforces allowlist
 *      - If INSERT omits transaction_intent, it will FAIL (no silent default)
 *
 * Debt routing decision (Phase 1.8-A scope):
 *   debt_given, debt_received, transfer are stored in transactions for now.
 *   Routing to the loans table is deferred to Phase 2.
 *
 * SEC-03: No tenant context needed — this is a structural DDL migration.
 * ADR-004: ULID primary keys unchanged.
 *
 * NOTE: This migration was applied to the database before being committed to git.
 *       The pgmigrations table tracks it by timestamp 1778008338096.
 *       Do not re-run this migration.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    -- ── Step 1: Add parsed_intent to transaction_drafts (NULLable) ──────────
    -- NULL is valid for needs_clarification drafts where intent could not be parsed.

    ALTER TABLE transaction_drafts
      ADD COLUMN parsed_intent TEXT;

    ALTER TABLE transaction_drafts
      ADD CONSTRAINT chk_parsed_intent
      CHECK (
        parsed_intent IS NULL
        OR parsed_intent IN ('expense', 'income', 'debt_given', 'debt_received', 'transfer')
      );

    -- ── Step 2: Add transaction_intent to transactions (NULLable first) ─────
    -- Will be set NOT NULL after backfill to avoid locking issues.

    ALTER TABLE transactions
      ADD COLUMN transaction_intent TEXT;

    ALTER TABLE transactions
      ADD CONSTRAINT chk_transaction_intent
      CHECK (
        transaction_intent IN ('expense', 'income', 'debt_given', 'debt_received', 'transfer')
      );

    -- ── Step 3: Backfill existing test rows with 'expense' ───────────────────
    -- All existing rows are from smoke tests (Phases 1.6-A/B).
    -- There is no production data. 'expense' is the safest backfill value.
    -- Future INSERTs must provide the correct value explicitly.

    UPDATE transactions
      SET transaction_intent = 'expense'
      WHERE transaction_intent IS NULL;

    -- ── Step 4: Set NOT NULL — future INSERTs must provide transaction_intent ─
    -- Any INSERT that omits transaction_intent will now fail at the DB level.
    -- There is no DEFAULT. The application layer must always provide this field.

    ALTER TABLE transactions
      ALTER COLUMN transaction_intent SET NOT NULL;

    -- ── Step 5: Index for future /report queries ────────────────────────────
    -- Composite index supports GROUP BY transaction_intent queries per workspace.

    CREATE INDEX idx_transactions_intent
      ON transactions (workspace_id, transaction_intent, transaction_time DESC);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_transactions_intent;

    ALTER TABLE transactions
      DROP CONSTRAINT IF EXISTS chk_transaction_intent;
    ALTER TABLE transactions
      DROP COLUMN IF EXISTS transaction_intent;

    ALTER TABLE transaction_drafts
      DROP CONSTRAINT IF EXISTS chk_parsed_intent;
    ALTER TABLE transaction_drafts
      DROP COLUMN IF EXISTS parsed_intent;
  `);
};
