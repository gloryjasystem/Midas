/**
 * Migration 1781000000000 — Phase 7.1: Financial Reminders
 *
 * Creates `financial_reminders` table for scheduled future financial events.
 *
 * Design decisions:
 *   - due_date is DATE (not TIMESTAMPTZ) — reminders are day-granular
 *   - remind_offsets INTEGER[] DEFAULT {3,1,0} — days before due_date to notify
 *   - amount is NUMERIC(19,4) — matches transactions table precision (SEC-02)
 *   - recurrence_pattern nullable — NULL means one-time reminder
 *   - RLS enabled with tenant_isolation policy (SEC-03)
 *
 * ESM format. SEC-03: DDL migration — no tenant context needed.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS financial_reminders (
      id                  VARCHAR(26) PRIMARY KEY,
      workspace_id        VARCHAR(26) NOT NULL REFERENCES workspaces(id),

      -- What
      title               TEXT NOT NULL,
      amount              NUMERIC(19,4) NOT NULL,
      currency            TEXT NOT NULL DEFAULT 'UAH',
      reminder_type       TEXT NOT NULL DEFAULT 'expense'
                          CHECK (reminder_type IN ('expense','income','debt_pay','debt_receive')),
      category_id         VARCHAR(26) REFERENCES categories(id),
      counterparty        TEXT,
      notes               TEXT,

      -- When
      due_date            DATE NOT NULL,
      remind_offsets      INTEGER[] NOT NULL DEFAULT '{3,1,0}',

      -- Recurrence
      is_recurring        BOOLEAN NOT NULL DEFAULT false,
      recurrence_pattern  TEXT CHECK (recurrence_pattern IN ('weekly','monthly','yearly')),

      -- State
      status              TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','completed','snoozed','cancelled')),
      snoozed_until       DATE,
      last_reminded_at    TIMESTAMPTZ,
      completed_at        TIMESTAMPTZ,
      linked_tx_id        VARCHAR(26),

      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_fr_active_due
      ON financial_reminders (workspace_id, due_date)
      WHERE status = 'active';

    ALTER TABLE financial_reminders ENABLE ROW LEVEL SECURITY;

    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'financial_reminders'
          AND policyname = 'tenant_isolation_financial_reminders'
      ) THEN
        CREATE POLICY tenant_isolation_financial_reminders ON financial_reminders
          USING (workspace_id = current_setting('app.workspace_id')::text);
      END IF;
    END $$;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS tenant_isolation_financial_reminders ON financial_reminders;
    DROP INDEX IF EXISTS idx_fr_active_due;
    DROP TABLE IF EXISTS financial_reminders;
  `);
};
