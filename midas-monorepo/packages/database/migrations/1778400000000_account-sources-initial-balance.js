/**
 * Migration — Phase 1.21: account_sources.initial_balance Column
 *
 * Adds `initial_balance NUMERIC(19,4) NOT NULL DEFAULT 0` to account_sources.
 *
 * Design rationale (docs/balance-semantics.md, D4 — all approved by owner):
 *   - D4a: initial_balance column required for correct /balance calculation.
 *   - D4b: Negative values ALLOWED (credit cards, loans, overdrafts).
 *          No CHECK (initial_balance >= 0) added — would need removal later.
 *   - D4c: Currency of initial_balance = account_sources.currency (implicit).
 *          No extra column needed.
 *   - D4d: initial_balance_at NOT added — deferred. Assumption: all Midas
 *          transactions post-date account creation in Phase 1.
 *
 * Pre-flight guard:
 *   Checks if the column already exists (idempotency guard).
 *   If column already exists, migration skips gracefully.
 *
 * DEFAULT 0: PostgreSQL atomically backfills all existing rows to 0 when
 * adding a NOT NULL column with a DEFAULT. No manual backfill needed.
 * All 691 existing account_sources rows will receive initial_balance = 0.
 *
 * SEC-03: No tenant context required — migration runs as midas_migrator
 *         which is exempt from RLS.
 * SEC-02: No financial arithmetic in migration — only schema change.
 */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // ── Pre-flight: idempotency check ─────────────────────────────────────────
  // If initial_balance already exists (e.g. migration re-run), skip gracefully.
  pgm.sql(`
    DO $$
    DECLARE
      col_exists BOOLEAN;
    BEGIN
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'account_sources'
          AND column_name  = 'initial_balance'
      ) INTO col_exists;

      IF col_exists THEN
        RAISE NOTICE 'Phase 1.21: initial_balance column already exists — skipping ADD COLUMN.';
      ELSE
        ALTER TABLE account_sources
          ADD COLUMN initial_balance NUMERIC(19,4) NOT NULL DEFAULT 0;
        RAISE NOTICE 'Phase 1.21: initial_balance NUMERIC(19,4) NOT NULL DEFAULT 0 added to account_sources.';
      END IF;
    END $$;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE account_sources
      DROP COLUMN IF EXISTS initial_balance;
  `);
};
