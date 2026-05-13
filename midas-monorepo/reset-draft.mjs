import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const res = await pool.query(
  `UPDATE transaction_drafts SET status = 'rejected' WHERE id = '01KRGEMHSDTHMAPJ2W8G31VZA2' RETURNING id, status`
);
console.log('Updated:', res.rows);
await pool.end();
process.exit(0);
