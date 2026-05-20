/**
 * Migration runner — runs at background-workers startup.
 *
 * Applies all pending node-pg-migrate migrations against the production DB.
 * Uses the migrator role connection (DATABASE_URL must be midas_migrator).
 *
 * Why here (not in telegram-bot)?
 *   - background-workers starts first in Railway deployment order.
 *   - Single runner avoids race conditions (only 1 process runs migrations).
 *   - If migrations fail, workers don't start → Railway marks deploy as failed.
 *
 * SEC-03: Uses DATABASE_URL directly (midas_migrator role, BYPASSRLS safe for DDL).
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('[midas:migrate] DATABASE_URL is not set — cannot run migrations');
  }

  console.log('[midas:migrate] Running pending migrations...');

  try {
    // node-pg-migrate is a CommonJS module — use dynamic import for ESM compat
    const runner = require('node-pg-migrate').default ?? require('node-pg-migrate');

    // Resolve migrations directory (packages/database/migrations)
    // __dirname = apps/background-workers/dist/
    // We need to go up to monorepo root, then into packages/database/migrations
    const migrationsDir = path.resolve(
      __dirname,
      '../../../packages/database/migrations',
    );

    await runner({
      databaseUrl,
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      checkOrder: false,   // allow gaps in migration numbering
      verbose: false,
      log: (msg: string) => console.log('[midas:migrate]', msg),
    });

    console.log('[midas:migrate] Migrations complete ✓');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // "No migrations to run" is success
    if (msg.includes('No migrations to run') || msg.includes('already applied')) {
      console.log('[midas:migrate] No pending migrations.');
      return;
    }
    console.error('[midas:migrate] Migration failed:', msg);
    throw err;
  }
}
