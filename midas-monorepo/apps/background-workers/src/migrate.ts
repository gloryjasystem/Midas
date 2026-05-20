/**
 * Migration runner — runs at background-workers startup.
 *
 * Applies all pending node-pg-migrate migrations against the production DB.
 *
 * Why here?
 *   - Single runner per deploy (no race conditions).
 *   - If migrations fail, workers don't start → Railway marks deploy as failed.
 *
 * Path strategy:
 *   1. Resolve @midas/database package.json location via require.resolve
 *   2. migrations/ is a sibling of package.json in that package
 *   This works in both local (workspace symlinks) and Railway (hoisted node_modules).
 *
 * SEC-03: Uses DATABASE_URL directly (midas_migrator role).
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);

export async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn('[midas:migrate] DATABASE_URL not set — skipping migrations');
    return;
  }

  console.log('[midas:migrate] Resolving migrations directory...');

  // Strategy 1: locate via @midas/database package.json (works in Railway node_modules)
  let migrationsDir: string;
  try {
    const dbPkgPath = require.resolve('@midas/database/package.json');
    migrationsDir = path.join(path.dirname(dbPkgPath), 'migrations');
    console.log('[midas:migrate] Migrations dir (via package):', migrationsDir);
  } catch {
    // Strategy 2: relative to __dirname of this compiled file
    // dist/migrate.js → ../../../packages/database/migrations (monorepo layout)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    migrationsDir = path.resolve(__dirname, '../../../packages/database/migrations');
    console.log('[midas:migrate] Migrations dir (relative):', migrationsDir);
  }

  console.log('[midas:migrate] Running pending migrations...');

  try {
    // node-pg-migrate is CommonJS — use createRequire for ESM compat
    const pgMigrate = require('node-pg-migrate');
    const runner = typeof pgMigrate === 'function' ? pgMigrate : pgMigrate.default;

    if (typeof runner !== 'function') {
      throw new Error('node-pg-migrate did not export a callable function');
    }

    await runner({
      databaseUrl,
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      checkOrder: false,   // allow gaps — already-applied migrations are skipped
      verbose: true,
      log: (msg: string) => console.log('[midas:migrate]', msg),
    });

    console.log('[midas:migrate] \u2713 Migrations complete.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Non-error states from node-pg-migrate
    if (
      msg.includes('No migrations') ||
      msg.includes('already up to date') ||
      msg.includes('No files to migrate')
    ) {
      console.log('[midas:migrate] No pending migrations \u2014 DB is up to date.');
      return;
    }
    // Migration failure is fatal \u2014 don\u2019t start workers with a broken schema
    console.error('[midas:migrate] \u2717 Migration FAILED:', msg);
    throw err;
  }
}
