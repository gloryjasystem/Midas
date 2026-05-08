import pg from 'pg';
import { readFileSync } from 'fs';

const { Client } = pg;
const PG_URL = 'postgresql://postgres:PLLSqArtPUoQsAYmvrpsmavfQMewgTRh@hopper.proxy.rlwy.net:46284/railway';

const client = new Client({ connectionString: PG_URL });
const sql = readFileSync('packages/database/init/00-roles.sql', 'utf8');

await client.connect();
console.log('Connected to Railway PostgreSQL');

try {
  await client.query(sql);
  console.log('✅ Roles created: midas_migrator, midas_app');
} catch (e) {
  // Roles may already exist — that's OK
  if (e.message.includes('already exists')) {
    console.log('ℹ️  Roles already exist — OK');
  } else {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
} finally {
  await client.end();
}
