// Fix RLS for Railway PostgreSQL — postgres user needs explicit policies
// Run: node packages/database/fix-rls-policies.cjs
const pg = require('pg');

const PG_URL = process.env.DATABASE_URL;
if (!PG_URL) { console.error('DATABASE_URL required'); process.exit(1); }

const tables = [
  'transaction_drafts', 'transactions', 'categories', 'account_sources',
  'workspace_memberships', 'workspaces', 'users', 'audit_logs', 'persons',
  'loans', 'exchange_rate_snapshots'
];

async function run() {
  const client = new pg.Client({ connectionString: PG_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  console.log('Connected');

  for (const table of tables) {
    const sql = `CREATE POLICY allow_postgres_superuser ON ${table} FOR ALL TO postgres USING (true) WITH CHECK (true)`;
    try {
      await client.query(sql);
      console.log(`OK: policy added to ${table}`);
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log(`SKIP: policy already exists on ${table}`);
      } else {
        console.log(`SKIP: ${table} — ${e.message.slice(0, 80)}`);
      }
    }
  }

  await client.end();
  console.log('All done');
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
