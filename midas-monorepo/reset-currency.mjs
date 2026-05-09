/**
 * Phase 1.38 — Delete all midas:cur_set:* Redis keys.
 * This makes every account ask for currency on the next transaction,
 * simulating the "new user" experience.
 *
 * DB note: default_currency has NOT NULL constraint, so we can't set it to NULL.
 * The cur_set Redis flag is the correct gate — it's the only thing that bypasses
 * the currency prompt. Deleting it is sufficient.
 *
 * Run: node reset-currency.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const Redis = require(path.join(__dirname, 'node_modules/.pnpm/ioredis@5.10.1/node_modules/ioredis'));

const REDIS_URL = 'redis://default:MebxRhXuDJWJmFGxIwASEhjbEYRzQGps@switchback.proxy.rlwy.net:51779';
const redis = new Redis(REDIS_URL);

const keys = await redis.keys('midas:cur_set:*');
if (keys.length > 0) {
  await redis.del(...keys);
  console.log(`\n✅ Redis: Deleted ${keys.length} cur_set key(s):`);
  keys.forEach(k => console.log(`   - ${k}`));
} else {
  console.log('\n✅ Redis: no cur_set keys found (already clean).');
}

redis.disconnect();
console.log('\n✓ Done. All accounts will now be asked for currency on next transaction.\n');
