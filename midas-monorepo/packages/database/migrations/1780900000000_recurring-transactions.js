/**
 * Migration 1780900000000 — Phase 7.0-C: Recurring Transactions
 *
 * Creates `recurring_transactions` table for subscription/recurring payment tracking.
 *
 * Design decisions:
 *   - Template fields (amount, currency, category_id, account_id, intent, item_name)
 *     mirror transaction_drafts for easy INSERT INTO transactions at fire time.
 *   - frequency: daily/weekly/monthly/yearly — covers all common subscription patterns
 *   - day_of_month: 1-31, used for monthly subscriptions (nullable for non-monthly)
 *   - next_fire_date: DATE — CRON worker queries WHERE next_fire_date <= CURRENT_DATE
 *   - times_fired: counter for stats display
 *   - RLS enabled with tenant_isolation policy (SEC-03)
 *   - NUMERIC(19,4) for amount — matches transactions table precision (SEC-02)
 *
 * ESM format. SEC-03: DDL migration — no tenant context needed.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS recurring_transactions (
      id              VARCHAR(26) PRIMARY KEY,
      workspace_id    VARCHAR(26) NOT NULL REFERENCES workspaces(id),
      amount          NUMERIC(19,4) NOT NULL,
      currency        TEXT NOT NULL,
      category_id     VARCHAR(26) REFERENCES categories(id),
      account_id      VARCHAR(26) REFERENCES account_sources(id),
      intent          TEXT NOT NULL DEFAULT 'expense',
      item_name       TEXT,
      frequency       TEXT NOT NULL DEFAULT 'monthly'
                      CHECK (frequency IN ('daily','weekly','monthly','yearly')),
      day_of_month    SMALLINT,
      next_fire_date  DATE NOT NULL,
      is_active       BOOLEAN NOT NULL DEFAULT true,
      times_fired     INTEGER NOT NULL DEFAULT 0,
      last_fired_at   TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE recurring_transactions ENABLE ROW LEVEL SECURITY;

    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'recurring_transactions' AND policyname = 'tenant_isolation_recurring'
      ) THEN
        CREATE POLICY tenant_isolation_recurring ON recurring_transactions
          USING (workspace_id = current_setting('app.workspace_id')::text);
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_recurring_next_fire
      ON recurring_transactions (next_fire_date)
      WHERE is_active = true;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_recurring_next_fire;
    DROP POLICY IF EXISTS tenant_isolation_recurring ON recurring_transactions;
    DROP TABLE IF EXISTS recurring_transactions;
  `);
};
