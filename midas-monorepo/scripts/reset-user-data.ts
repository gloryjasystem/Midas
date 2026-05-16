/**
 * reset-user-data.ts
 *
 * Wipes all user-generated content so every account looks like a fresh registration:
 *   ✅ Deleted : transaction_drafts, transactions, account_sources, persons, loans, audit_logs
 *   ✅ Reset   : workspaces.default_expense_account_id / default_income_account_id → NULL
 *   🔒 Kept   : users, workspaces, workspace_memberships, user_preferences, categories,
 *               exchange_rate_snapshots, pgmigrations
 *
 * Run once from the monorepo root:
 *   npx tsx scripts/reset-user-data.ts
 */

import { Pool } from 'pg';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function resetUserData(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('🗑  Deleting transactions …');
    const d3 = await client.query('DELETE FROM transactions');
    console.log(`   → ${d3.rowCount} rows deleted`);

    console.log('🗑  Deleting transaction_drafts …');
    const d1 = await client.query('DELETE FROM transaction_drafts');
    console.log(`   → ${d1.rowCount} rows deleted`);

    console.log('🗑  Deleting audit_logs …');
    const d2 = await client.query('DELETE FROM audit_logs');
    console.log(`   → ${d2.rowCount} rows deleted`);

    console.log('🔧  Clearing workspace default account pointers …');
    const d4 = await client.query(
      'UPDATE workspaces SET default_expense_account_id = NULL, default_income_account_id = NULL',
    );
    console.log(`   → ${d4.rowCount} workspaces updated`);

    console.log('🗑  Deleting account_sources …');
    const d5 = await client.query('DELETE FROM account_sources');
    console.log(`   → ${d5.rowCount} rows deleted`);

    console.log('🗑  Deleting loans …');
    const d6 = await client.query('DELETE FROM loans');
    console.log(`   → ${d6.rowCount} rows deleted`);

    console.log('🗑  Deleting persons …');
    const d7 = await client.query('DELETE FROM persons');
    console.log(`   → ${d7.rowCount} rows deleted`);

    await client.query('COMMIT');
    console.log('\n✅  Reset complete. All accounts now look like fresh registrations.');
    console.log('   Kept: users, workspaces, memberships, preferences, categories.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Error during reset — ROLLED BACK. No data was changed.', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

void resetUserData();
