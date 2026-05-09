/**
 * Phase 1.38 — Currency state reset.
 * - Sets default_currency = NULL for all workspaces (DB)
 * - Deletes all midas:cur_set:* keys (Redis)
 *
 * Run: railway run node reset-currency-state.mjs
 *   (from apps/telegram-bot directory)
 */
import pg from 'pg';
import Redis from 'ioredis';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const redis = new Redis(process.env.REDIS_URL);

// ── 1. Reset all workspaces ────────────────────────────────────────────────
const result = await pool.query(
  `UPDATE workspaces
     SET default_currency = NULL
   WHERE default_currency IS NOT NULL
   RETURNING id, name`
);
console.log(`\n✅ DB: Reset ${result.rowCount} workspace(s):`);
for (const row of result.rows) {
  console.log(`   - [${row.id}] ${row.name}`);
}

// ── 2. Delete all cur_set Redis keys ──────────────────────────────────────
const keys = await redis.keys('midas:cur_set:*');
if (keys.length > 0) {
  await redis.del(...keys);
  console.log(`\n✅ Redis: Deleted ${keys.length} cur_set key(s):`);
  for (const k of keys) console.log(`   - ${k}`);
} else {
  console.log('\n✅ Redis: No cur_set keys found (already clean).');
}

await pool.end();
redis.disconnect();

console.log('\n✓ Done. All accounts will now be prompted for currency on next transaction.\n');
