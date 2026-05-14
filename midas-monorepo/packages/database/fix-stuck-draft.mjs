/**
 * fix-stuck-draft.mjs
 * One-shot fix: expire all stuck pending_user drafts that are blocking new transaction input.
 * Run from: midas-monorepo/packages/database/
 *   DATABASE_URL=<url> node fix-stuck-draft.mjs
 *   — or —
 *   node fix-stuck-draft.mjs  (uses local default)
 */

import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://midas_user:midas_dev_password@localhost:5432/midas',
});

async function main() {
  const client = await pool.connect();
  try {
    // 1. Show what we're about to fix
    const before = await client.query(`
      SELECT id, status, expires_at, parsed_intent, parsed_amount, parsed_currency, created_at
      FROM transaction_drafts
      WHERE status IN ('pending_user', 'needs_clarification')
        AND expires_at > NOW()
      ORDER BY created_at DESC
    `);

    console.log(`\n🔍 Found ${before.rows.length} active draft(s) blocking new transactions:\n`);
    for (const row of before.rows) {
      console.log(`  id:       ${row.id}`);
      console.log(`  status:   ${row.status}`);
      console.log(`  intent:   ${row.parsed_intent ?? 'null'}`);
      console.log(`  amount:   ${row.parsed_amount ?? 'null'} ${row.parsed_currency ?? ''}`);
      console.log(`  expires:  ${row.expires_at}`);
      console.log(`  created:  ${row.created_at}`);
      console.log('');
    }

    if (before.rows.length === 0) {
      console.log('✅ No stuck drafts found. The bot should work normally.');
      return;
    }

    // 2. Force-expire them: set expires_at = NOW() and status = 'expired'
    const result = await client.query(`
      UPDATE transaction_drafts
      SET status     = 'expired',
          expires_at = NOW(),
          updated_at = NOW()
      WHERE status IN ('pending_user', 'needs_clarification')
        AND expires_at > NOW()
      RETURNING id, status
    `);

    console.log(`✅ Fixed ${result.rowCount} draft(s):\n`);
    for (const row of result.rows) {
      console.log(`  → ${row.id}  new status: ${row.status}`);
    }

    console.log('\n🎉 Done! Try entering a transaction in the bot now.\n');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
