import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { pool, closeDb } from '../db.js';
import { Decimal } from 'decimal.js';

// node:test's describe/test/before return Promise<void>; use void to satisfy no-floating-promises
void describe('Decimal Boundary Rules (SEC-02)', () => {
  before(() => {
    // Create a temporary table for testing NUMERIC types — sync setup via pool is async
    // but before() handles async callbacks internally; we return the promise
    return pool.connect().then(async (client) => {
      try {
        await client.query(`
          CREATE TEMPORARY TABLE IF NOT EXISTS test_decimals (
            id SERIAL PRIMARY KEY,
            value NUMERIC(19,4)
          );
        `);
      } finally {
        client.release();
      }
    });
  });

  after(async () => {
    await closeDb();
  });

  void test('PostgreSQL NUMERIC is parsed as Decimal.js instance', async () => {
    const client = await pool.connect();
    try {
      await client.query(`INSERT INTO test_decimals (value) VALUES ('100.5000')`);
      const res = await client.query<{ value: Decimal }>(`SELECT value FROM test_decimals LIMIT 1`);

      // rows[0] guaranteed: SELECT always returns exactly one row here
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const val = res.rows[0]!.value;

      assert.ok(val instanceof Decimal, 'Value should be an instance of Decimal.js');
      assert.strictEqual(val.toString(), '100.5');

      await client.query('DELETE FROM test_decimals');
    } finally {
      client.release();
    }
  });
});
