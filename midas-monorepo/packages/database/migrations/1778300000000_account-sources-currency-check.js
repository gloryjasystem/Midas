/**
 * Migration — Phase 1.19: account_sources.currency CHECK Constraint
 *
 * Adds a CHECK constraint on the `currency` column of `account_sources`
 * to enforce that only well-formed currency codes can be stored.
 *
 * Allowed pattern: `^[A-Z]{3,5}$`
 *   - Covers ISO 4217 fiat codes (3 uppercase letters: RUB, USD, EUR, GBP, …)
 *   - Covers common crypto codes (3–5 uppercase letters: BTC, ETH, USDT, BNB, TRX)
 *   - Rejects: empty string, lowercase, digits, spaces, codes > 5 chars
 *
 * Design rationale:
 *   - Regex-based rather than explicit allowlist to avoid a future migration
 *     every time a new currency is added to the product.
 *   - Owner decision (Phase 1.19 advisory): regex `^[A-Z]{3,5}$` confirmed.
 *
 * Constraint name: account_sources_currency_check
 *
 * Pre-flight guard: the up() function queries for any rows that would violate
 * the constraint. If any are found, the migration FAILS immediately with a
 * descriptive error and does NOT modify any data.
 *
 * Live DB state at migration time (verified in advisory):
 *   - 553 rows, 4 distinct values: RUB, USD, EUR, BTC
 *   - 0 rows violate `^[A-Z]{3,5}$`
 *
 * SEC-03: No tenant context required — migration runs as midas_migrator
 *         which is exempt from RLS (BYPASSRLS role reserved for migrator only).
 * SEC-02: No financial amounts touched.
 */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // ── Pre-flight invalid-value check ──────────────────────────────────────
  // If any row has a currency value that would violate `^[A-Z]{3,5}$`,
  // the constraint addition would fail with a confusing PG error.
  // We surface a clear FAIL message instead and abort — no data mutation.
  pgm.sql(`
    DO $$
    DECLARE
      invalid_count INTEGER;
    BEGIN
      SELECT COUNT(*) INTO invalid_count
      FROM account_sources
      WHERE currency !~ '^[A-Z]{3,5}$';

      IF invalid_count > 0 THEN
        RAISE EXCEPTION
          'Phase 1.19 FAIL: % row(s) in account_sources have a currency value '
          'that does not match the pattern ^[A-Z]{3,5}$. '
          'Manual data cleanup required before adding the CHECK constraint. '
          'Migration aborted — no data was modified.',
          invalid_count;
      END IF;
    END $$;
  `);

  // ── Add CHECK constraint ──────────────────────────────────────────────────
  // Standard ALTER TABLE — safe for MVP/local dev scale.
  // Pattern `^[A-Z]{3,5}$`: 3–5 uppercase ASCII letters only.
  pgm.sql(`
    ALTER TABLE account_sources
      ADD CONSTRAINT account_sources_currency_check
      CHECK (currency ~ '^[A-Z]{3,5}$');
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE account_sources
      DROP CONSTRAINT IF EXISTS account_sources_currency_check;
  `);
};
