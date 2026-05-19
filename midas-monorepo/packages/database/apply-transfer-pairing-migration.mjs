/**
 * apply-transfer-pairing-migration.mjs
 *
 * Applies migration 1780300000000_transfer-pairing manually.
 * Equivalent to running `node-pg-migrate up` for that migration.
 *
 * Run:
 *   DATABASE_URL=postgresql://... node packages/database/apply-transfer-pairing-migration.mjs
 *
 * Safe to run multiple times — uses IF NOT EXISTS / IF EXISTS guards.
 */

import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://midas_user:midas_dev_password@localhost:5432/midas',
});

let stepsPassed = 0;
let stepsFailed = 0;

async function step(label, sql) {
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log(`  ✅ ${label}`);
    stepsPassed++;
  } catch (err) {
    console.error(`  ❌ ${label}`);
    console.error(`     ${err.message}`);
    stepsFailed++;
  } finally {
    client.release();
  }
}

async function query(sql) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql);
    return res.rows;
  } finally {
    client.release();
  }
}

async function run() {
  console.log('\n🔄  Applying migration: 1780300000000_transfer-pairing\n');

  // ── Step 1: transfer_group_id ─────────────────────────────────────────────
  await step(
    'ADD COLUMN transfer_group_id UUID NULL',
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_group_id UUID NULL`,
  );

  // ── Step 2: Index on transfer_group_id ────────────────────────────────────
  await step(
    'CREATE INDEX idx_transactions_transfer_group',
    `CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group
       ON transactions (transfer_group_id)
       WHERE transfer_group_id IS NOT NULL`,
  );

  // ── Step 3: transfer_direction column ─────────────────────────────────────
  await step(
    'ADD COLUMN transfer_direction TEXT NULL',
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_direction TEXT NULL`,
  );

  // ── Step 4: CHECK constraint ──────────────────────────────────────────────
  await step(
    'ADD CONSTRAINT chk_transfer_direction',
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM information_schema.table_constraints
         WHERE constraint_name = 'chk_transfer_direction'
           AND table_name = 'transactions'
       ) THEN
         ALTER TABLE transactions
           ADD CONSTRAINT chk_transfer_direction
           CHECK (transfer_direction IS NULL OR transfer_direction IN ('outbound', 'inbound'));
       END IF;
     END $$`,
  );

  // ── Step 5: transfer_target_account_id in drafts ──────────────────────────
  // NOTE: account_sources.id is VARCHAR (ULID string), NOT UUID.
  // Must use TEXT type for the FK to match.
  await step(
    'ADD COLUMN transfer_target_account_id to transaction_drafts',
    `ALTER TABLE transaction_drafts
       ADD COLUMN IF NOT EXISTS transfer_target_account_id TEXT NULL
       REFERENCES account_sources(id) ON DELETE SET NULL`,
  );

  // ── Step 6: Backfill transfer_direction = outbound ────────────────────────
  await step(
    'Backfill transfer_direction = outbound for existing transfer rows',
    `UPDATE transactions
       SET transfer_direction = 'outbound'
       WHERE transaction_intent = 'transfer'
         AND transfer_direction IS NULL`,
  );

  // ── Step 7: Register migration in pgmigrations ────────────────────────────
  // pgmigrations has no UNIQUE(name) — use WHERE NOT EXISTS guard.
  await step(
    'Register in pgmigrations table',
    `INSERT INTO pgmigrations (name, run_on)
     SELECT '1780300000000_transfer-pairing', NOW()
     WHERE NOT EXISTS (
       SELECT 1 FROM pgmigrations
       WHERE name = '1780300000000_transfer-pairing'
     )`,
  );

  // ── Verify ────────────────────────────────────────────────────────────────
  console.log('\n🔍  Verifying result...\n');

  const cols = await query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name = 'transactions'
       AND column_name IN ('transfer_group_id', 'transfer_direction')
     ORDER BY column_name`,
  );
  console.log(`  Columns added to transactions: ${cols.map(c => c.column_name).join(', ')}`);

  const draftCols = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'transaction_drafts'
       AND column_name = 'transfer_target_account_id'`,
  );
  console.log(`  Columns added to transaction_drafts: ${draftCols.map(c => c.column_name).join(', ') || '(none — check error above)'}`);

  const backfill = await query(
    `SELECT COUNT(*)::text AS cnt FROM transactions
     WHERE transaction_intent = 'transfer' AND transfer_direction IS NULL`,
  );
  console.log(`  Transfer rows with NULL direction (should be 0): ${backfill[0]?.cnt ?? '?'}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(45)}`);
  if (stepsFailed === 0) {
    console.log(`✅  Migration complete — ${stepsPassed} steps passed, 0 failed`);
  } else {
    console.log(`⚠️  Migration partial — ${stepsPassed} passed, ${stepsFailed} FAILED`);
    console.log('    Check errors above and re-run after fixing.');
    process.exitCode = 1;
  }
}

run()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
