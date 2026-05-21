/**
 * Migration 1780500000000 — Phase 3.0: Account Type + Provider Key
 *
 * Adds two optional columns to account_sources for richer account classification:
 *   - account_type: card, cash, exchange, wallet, custom
 *   - provider_key: freeform text for specific provider (e.g. 'binance', 'monobank')
 *
 * Note: exchange_rate column already exists in transactions (added in MVP schema).
 *       No changes to transactions table needed.
 */

/** @param {import('pg').PoolClient} client */
exports.up = async (client) => {
  await client.query(`
    ALTER TABLE account_sources
      ADD COLUMN IF NOT EXISTS account_type TEXT
        CHECK (account_type IN ('card', 'cash', 'exchange', 'wallet', 'custom')),
      ADD COLUMN IF NOT EXISTS provider_key TEXT;
  `);
};

/** @param {import('pg').PoolClient} client */
exports.down = async (client) => {
  await client.query(`
    ALTER TABLE account_sources
      DROP COLUMN IF EXISTS provider_key,
      DROP COLUMN IF EXISTS account_type;
  `);
};
