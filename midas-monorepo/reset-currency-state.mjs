/**
 * Phase 1.38 — Reset currency state for all workspaces.
 * Sets default_currency = NULL for all workspaces (they'll be treated as "new users").
 * Deletes all midas:cur_set:* keys from Redis.
 *
 * Run: node reset-currency-state.mjs
 */
import pg from 'pg';
import { createClient } from 'redis';

const pgClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
const redisClient = createClient({ url: process.env.REDIS_URL });

await pgClient.connect();
await redisClient.connect();

// 1. Reset all workspace default_currency to NULL
const dbResult = await pgClient.query(
  `UPDATE workspaces SET default_currency = NULL WHERE default_currency IS NOT NULL RETURNING id, name`
);
console.log(`✅ DB: Reset ${dbResult.rowCount} workspaces:`);
for (const row of dbResult.rows) {
  console.log(`   - ${row.name} (${row.id})`);
}

// 2. Delete all cur_set Redis keys
const keys = await redisClient.keys('midas:cur_set:*');
if (keys.length > 0) {
  await redisClient.del(keys);
  console.log(`✅ Redis: Deleted ${keys.length} cur_set keys:`);
  for (const k of keys) console.log(`   - ${k}`);
} else {
  console.log('✅ Redis: No cur_set keys found (already clean).');
}

await pgClient.end();
await redisClient.quit();
console.log('\nDone. All accounts will now be asked for currency on next transaction.');
