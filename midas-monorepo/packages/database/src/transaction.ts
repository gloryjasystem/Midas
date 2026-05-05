import { PoolClient } from 'pg';
import { pool } from './db.js';

/**
 * SEC-03: Tenant Transaction Rule
 * Executes a function within a transaction that has app.workspace_id and app.user_id set.
 */
export async function withTenantTransaction<T>(
  workspaceId: string,
  userId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Set tenant context for RLS policies
    // is_local (true) ensures the setting only lasts for the current transaction
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);

    const result = await fn(client);
    
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    // Release the client back to the pool
    client.release();
  }
}
