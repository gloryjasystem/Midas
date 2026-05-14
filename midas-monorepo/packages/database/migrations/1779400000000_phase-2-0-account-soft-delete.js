/**
 * Phase 2.0 — Account Soft Delete
 *
 * Adds `deleted_at` column to account_sources for soft-delete support.
 * Accounts with deleted_at IS NOT NULL are hidden from all UI views
 * (balance, settings, onboarding) but their transactions remain intact.
 *
 * SEC-03: No data loss — all FK references (transactions, transaction_drafts,
 *         workspaces.default_*_account_id) remain valid.
 */

/** @param {import('pg').Client} client */
export const up = async (client) => {
  await client.query(`
    ALTER TABLE account_sources
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
  `);

  // Partial index for efficient filtering: most queries filter WHERE deleted_at IS NULL
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_account_sources_active
    ON account_sources (workspace_id)
    WHERE deleted_at IS NULL;
  `);
};

/** @param {import('pg').Client} client */
export const down = async (client) => {
  await client.query(`DROP INDEX IF EXISTS idx_account_sources_active;`);
  await client.query(`ALTER TABLE account_sources DROP COLUMN IF EXISTS deleted_at;`);
};
