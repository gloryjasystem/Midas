/**
 * Migration: Workspace Default Account Roles — Phase LD++
 *
 * Adds two nullable FK columns to the workspaces table so each workspace
 * can designate one default account for expenses and one for incomes:
 *
 *   workspaces.default_expense_account_id  VARCHAR(26) → account_sources.id
 *   workspaces.default_income_account_id   VARCHAR(26) → account_sources.id
 *
 * Design decisions:
 *
 *   1. NULLABLE (no NOT NULL / no DEFAULT):
 *      Most workspaces will start with no role assigned. Setting a default FK
 *      would require a sentinel/placeholder account which is more complexity
 *      than the feature warrants. The service layer returns null-safe values.
 *
 *   2. ON DELETE SET NULL:
 *      If the referenced account is hard-deleted (unlikely — we use soft-delete)
 *      the role is silently cleared rather than blocking the DELETE.
 *      Soft-deleted accounts are handled in the service layer (clear on soft-delete
 *      is NOT automatic — the app clears via clearDefault* functions if needed).
 *
 *   3. IF NOT EXISTS / IF EXISTS guards:
 *      Migration is idempotent — safe to re-apply in CI or during failed deploys.
 *
 *   4. No backfill:
 *      Existing workspaces have no default roles assigned (both columns = NULL).
 *      Users can set roles via the new ⚪/🟢 toggles in the account card UI.
 *
 *   5. RLS: midas_app (the application role) already has row-level security on
 *      workspaces — no additional policy changes needed. The FK columns are
 *      read/written only inside withTenantTransaction (SET/CLEAR functions in
 *      account.service.ts).
 *
 * Down migration:
 *   Drops both FK columns (CASCADE not needed — no dependent objects).
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    -- ── Step 1: Add default_expense_account_id column ─────────────────────────
    -- NULLABLE: most workspaces start with no designated expense account.
    -- ON DELETE SET NULL: if the account row is hard-deleted, role is cleared.
    ALTER TABLE workspaces
      ADD COLUMN IF NOT EXISTS default_expense_account_id VARCHAR(26)
        REFERENCES account_sources (id) ON DELETE SET NULL;

    -- ── Step 2: Add default_income_account_id column ──────────────────────────
    ALTER TABLE workspaces
      ADD COLUMN IF NOT EXISTS default_income_account_id VARCHAR(26)
        REFERENCES account_sources (id) ON DELETE SET NULL;

    -- ── Step 3: Indexes for fast FK lookups ────────────────────────────────────
    -- These are read on every /balance render and every account card open.
    -- Partial index (IS NOT NULL) keeps index small since most workspaces
    -- will have NULL for extended periods after initial deployment.
    CREATE INDEX IF NOT EXISTS idx_workspaces_default_expense_account
      ON workspaces (default_expense_account_id)
      WHERE default_expense_account_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_workspaces_default_income_account
      ON workspaces (default_income_account_id)
      WHERE default_income_account_id IS NOT NULL;

    -- ── Step 4: Comment columns for schema documentation ──────────────────────
    COMMENT ON COLUMN workspaces.default_expense_account_id IS
      'Phase LD++: FK to account_sources. The workspace-level default account for expense transactions. NULL = no default set. Set/cleared via account.service.ts set/clearDefaultExpenseAccount().';

    COMMENT ON COLUMN workspaces.default_income_account_id IS
      'Phase LD++: FK to account_sources. The workspace-level default account for income transactions. NULL = no default set. Set/cleared via account.service.ts set/clearDefaultIncomeAccount().';
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    -- Drop indexes before columns
    DROP INDEX IF EXISTS idx_workspaces_default_income_account;
    DROP INDEX IF EXISTS idx_workspaces_default_expense_account;

    -- Drop columns (FK constraints are automatically dropped with the column)
    ALTER TABLE workspaces DROP COLUMN IF EXISTS default_income_account_id;
    ALTER TABLE workspaces DROP COLUMN IF EXISTS default_expense_account_id;
  `);
};
