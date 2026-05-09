/**
 * Phase 1.38 — One-shot state reset script.
 * Resets default_currency = NULL for ALL workspaces.
 * Deletes all midas:cur_set:* Redis keys.
 *
 * This makes every account behave as a "new user" that hasn't set a currency yet.
 * Run: node packages/database/reset-currency-state.mjs
 */

import pg from 'pg';
import { createClient } from 'redis';

const { Pool } = pg;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://midas_user:midas_dev_password@localhost:5432/midas',
});

const redis = createClient({
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
});

await redis.connect();

// ── 1. Reset all workspaces in DB ──────────────────────────────────────────
const dbResult = await pool.query(
  `UPDATE workspaces
     SET default_currency = NULL
   WHERE default_currency IS NOT NULL
   RETURNING id, name`
);
console.log(`\n✅ DB: Reset ${dbResult.rowCount} workspace(s):`);
for (const row of dbResult.rows) {
  console.log(`   - [${row.id}] ${row.name}`);
}

// ── 2. Delete all cur_set Redis keys ───────────────────────────────────────
const keys = await redis.keys('midas:cur_set:*');
if (keys.length > 0) {
  await redis.del(keys);
  console.log(`\n✅ Redis: Deleted ${keys.length} cur_set key(s):`);
  for (const k of keys) console.log(`   - ${k}`);
} else {
  console.log('\n✅ Redis: No cur_set keys found (already clean).');
}

await pool.end();
await redis.quit();

console.log('\n✓ Done. All accounts will now be prompted for currency on their next transaction.\n');
