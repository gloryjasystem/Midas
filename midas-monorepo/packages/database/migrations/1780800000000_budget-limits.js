/**
 * Migration 1780800000000 — Phase 7.0-B: Budget Limits
 *
 * Creates `budget_limits` table for per-category spending limits.
 *
 * Design decisions:
 *   - category_id is NOT NULL — MVP limits are per-category only
 *   - UNIQUE(workspace_id, category_id) — one limit per category per workspace
 *   - limit_amount is NUMERIC(19,4) — matches transactions table precision (SEC-02)
 *   - period defaults to 'monthly' — most common use case
 *   - RLS enabled with tenant_isolation policy (SEC-03)
 *
 * ESM format. SEC-03: DDL migration — no tenant context needed.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS budget_limits (
      id              VARCHAR(26) PRIMARY KEY,
      workspace_id    VARCHAR(26) NOT NULL REFERENCES workspaces(id),
      category_id     VARCHAR(26) NOT NULL REFERENCES categories(id),
      limit_amount    NUMERIC(19,4) NOT NULL,
      limit_currency  TEXT NOT NULL,
      period          TEXT NOT NULL DEFAULT 'monthly'
                      CHECK (period IN ('daily','weekly','monthly')),
      is_active       BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, category_id)
    );

    ALTER TABLE budget_limits ENABLE ROW LEVEL SECURITY;

    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'budget_limits' AND policyname = 'tenant_isolation_budget_limits'
      ) THEN
        CREATE POLICY tenant_isolation_budget_limits ON budget_limits
          USING (workspace_id = current_setting('app.workspace_id')::text);
      END IF;
    END $$;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS tenant_isolation_budget_limits ON budget_limits;
    DROP TABLE IF EXISTS budget_limits;
  `);
};
