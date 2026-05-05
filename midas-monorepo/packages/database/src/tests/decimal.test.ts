import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { pool, closeDb } from '../db.js';
import { Decimal } from 'decimal.js';

describe('Decimal Boundary Rules (SEC-02)', () => {
  before(async () => {
    // Create a temporary table for testing NUMERIC types
    const client = await pool.connect();
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

  after(async () => {
    await closeDb();
  });

  test('PostgreSQL NUMERIC is parsed as Decimal.js instance', async () => {
    const client = await pool.connect();
    try {
      await client.query(`INSERT INTO test_decimals (value) VALUES ('100.5000')`);
      const res = await client.query(`SELECT value FROM test_decimals LIMIT 1`);
      
      const val = res.rows[0].value;
      
      assert.ok(val instanceof Decimal, 'Value should be an instance of Decimal.js');
      assert.strictEqual(val.toString(), '100.5');
      
      await client.query('DELETE FROM test_decimals');
    } finally {
      client.release();
    }
  });
});
