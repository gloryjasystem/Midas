/**
 * Migration: Account Debit Fields — Phase 2.4 (Account-Aware Draft Card)
 *
 * Adds two nullable columns to both transaction_drafts and transactions
 * to capture the amount and currency in the account's native currency
 * at the time of the draft/transaction.
 *
 *   account_debit_amount   NUMERIC(19,4) DEFAULT NULL
 *   account_debit_currency TEXT          DEFAULT NULL
 *
 * Design decisions:
 *
 *   1. NULLABLE (no NOT NULL / no DEFAULT):
 *      Existing rows (pre-Phase-2.4) have no account debit data.
 *      Backfill is impossible without historical exchange rates.
 *      New rows will be populated starting from PR 14 (setAccountDebit service).
 *
 *   2. NUMERIC(19,4):
 *      Matches the precision used for base_amount / parsed_amount.
 *      Sufficient for any currency (e.g. 999999999999999.9999).
 *      SEC-02: no floating-point arithmetic — NUMERIC is exact.
 *
 *   3. CHECK constraint on currency:
 *      '^[A-Z]{3,5}$' — mirrors the constraint on account_sources.currency.
 *      Defence-in-depth: service layer also validates before write.
 *
 *   4. IF NOT EXISTS / IF EXISTS guards:
 *      Migration is idempotent — safe to re-apply in CI or failed deploys.
 *
 *   5. No index:
 *      These columns are only read in draft preview rendering (low-frequency).
 *      An index would add write overhead with no measurable read benefit.
 *
 *   6. Applied to both tables:
 *      transaction_drafts — stores the value while the draft is pending.
 *      transactions       — snapshot of the value at the moment of confirmation.
 *
 * Down migration:
 *   Drops constraints then columns (CASCADE not needed — no dependent objects).
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    -- ── transaction_drafts ──────────────────────────────────────────────────────
    ALTER TABLE transaction_drafts
      ADD COLUMN IF NOT EXISTS account_debit_amount   NUMERIC(19,4) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS account_debit_currency TEXT          DEFAULT NULL;

    -- Drop + re-add constraint for idempotency (IF NOT EXISTS not available on CHECK)
    ALTER TABLE transaction_drafts
      DROP CONSTRAINT IF EXISTS transaction_drafts_account_debit_currency_check;
    ALTER TABLE transaction_drafts
      ADD CONSTRAINT transaction_drafts_account_debit_currency_check
      CHECK (account_debit_currency IS NULL OR account_debit_currency ~ '^[A-Z]{3,5}$');

    COMMENT ON COLUMN transaction_drafts.account_debit_amount IS
      'Phase 2.4: Amount in the account native currency (may differ from parsed_amount if FX conversion). NULL until PR 14 setAccountDebit is wired.';
    COMMENT ON COLUMN transaction_drafts.account_debit_currency IS
      'Phase 2.4: ISO-4217 currency code of the debit account (3-5 uppercase letters). NULL until PR 14 setAccountDebit is wired.';

    -- ── transactions ────────────────────────────────────────────────────────────
    ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS account_debit_amount   NUMERIC(19,4) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS account_debit_currency TEXT          DEFAULT NULL;

    ALTER TABLE transactions
      DROP CONSTRAINT IF EXISTS transactions_account_debit_currency_check;
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_account_debit_currency_check
      CHECK (account_debit_currency IS NULL OR account_debit_currency ~ '^[A-Z]{3,5}$');

    COMMENT ON COLUMN transactions.account_debit_amount IS
      'Phase 2.4: Snapshot of the account-native debit amount at confirmation time. NULL for pre-2.4 transactions.';
    COMMENT ON COLUMN transactions.account_debit_currency IS
      'Phase 2.4: Snapshot of the debit account currency at confirmation time. NULL for pre-2.4 transactions.';
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    -- ── transactions ────────────────────────────────────────────────────────────
    ALTER TABLE transactions
      DROP CONSTRAINT IF EXISTS transactions_account_debit_currency_check;
    ALTER TABLE transactions
      DROP COLUMN IF EXISTS account_debit_currency;
    ALTER TABLE transactions
      DROP COLUMN IF EXISTS account_debit_amount;

    -- ── transaction_drafts ──────────────────────────────────────────────────────
    ALTER TABLE transaction_drafts
      DROP CONSTRAINT IF EXISTS transaction_drafts_account_debit_currency_check;
    ALTER TABLE transaction_drafts
      DROP COLUMN IF EXISTS account_debit_currency;
    ALTER TABLE transaction_drafts
      DROP COLUMN IF EXISTS account_debit_amount;
  `);
};
