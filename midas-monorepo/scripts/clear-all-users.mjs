/**
 * clear-all-users.mjs
 * Clears ALL user/workspace data from the Midas production DB.
 * pgmigrations table is NOT touched.
 * Run: node scripts/clear-all-users.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const pg = require(path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../packages/database/node_modules/pg'
));

const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://postgres:PLLSqArtPUoQsAYmvrpsmavfQMewgTRh@hopper.proxy.rlwy.net:46284/railway',
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete in dependency order (children first, parents last)
    const tables = [
      'exchange_rate_snapshots',
      'loans',
      'persons',
      'audit_logs',
      'transactions',
      'transaction_drafts',
      'account_sources',
      'categories',
      'user_preferences',
      'workspace_memberships',
      'workspaces',
      'users',
    ];

    for (const table of tables) {
      const res = await client.query(`DELETE FROM ${table}`);
      console.log(`✅ ${table}: deleted ${res.rowCount} rows`);
    }

    await client.query('COMMIT');
    console.log('\n🎉 All user data cleared successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error, rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
