import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import { pool, closeDb } from '../db.js';
import { withTenantTransaction } from '../transaction.js';

// node:test's describe/test return Promise<void>; use void to satisfy no-floating-promises
void describe('withTenantTransaction and RLS Isolation', () => {
  after(async () => {
    await closeDb();
  });

  void test('injects tenant context correctly', async () => {
    const workspaceId = '01HGWV5G1XYZA2BC3DEF4G5H6J';
    const userId = '01HGWV5G1XYZA2BC3DEF4G5H6K';

    await withTenantTransaction(workspaceId, userId, async (client) => {
      const res = await client.query<{ wid: string; uid: string }>(
        "SELECT current_setting('app.workspace_id', true) as wid, current_setting('app.user_id', true) as uid",
      );
      // rows[0] guaranteed: SELECT always returns exactly one row here
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      assert.strictEqual(res.rows[0]!.wid, workspaceId);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      assert.strictEqual(res.rows[0]!.uid, userId);
    });
  });

  void test('clears context after transaction (pool leak check)', async () => {
    const workspaceId = 'TEST_WORKSPACE';
    const userId = 'TEST_USER';

    await withTenantTransaction(workspaceId, userId, async () => {
      // do nothing, context is set
    });

    // Acquire a new client from the pool
    const client = await pool.connect();
    try {
      // The context should be empty because it was set using LOCAL in a transaction
      const res = await client.query<{ wid: string }>(
        "SELECT current_setting('app.workspace_id', true) as wid",
      );
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      assert.strictEqual(res.rows[0]!.wid, '');
    } finally {
      client.release();
    }
  });

  void test('clears context on transaction rollback', async () => {
    const workspaceId = 'ROLLBACK_WORKSPACE';
    const userId = 'ROLLBACK_USER';

    try {
      await withTenantTransaction(workspaceId, userId, async (client) => {
        const res = await client.query<{ wid: string }>(
          "SELECT current_setting('app.workspace_id', true) as wid",
        );
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        assert.strictEqual(res.rows[0]!.wid, workspaceId);
        throw new Error('Force rollback');
      });
    } catch {
      // expected error — context cleared by withTenantTransaction's finally block
    }

    // Acquire a new client
    const client = await pool.connect();
    try {
      const res = await client.query<{ wid: string }>(
        "SELECT current_setting('app.workspace_id', true) as wid",
      );
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      assert.strictEqual(res.rows[0]!.wid, '');
    } finally {
      client.release();
    }
  });
});
