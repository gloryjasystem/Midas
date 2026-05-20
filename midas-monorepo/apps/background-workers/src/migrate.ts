/**
 * Migration runner — runs at background-workers startup.
 * Applies all pending node-pg-migrate migrations against the production DB.
 * SEC-03: Uses DATABASE_URL directly (midas_migrator role).
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);

/** Find the migrations directory by trying several candidate paths. */
function findMigrationsDir(): string | null {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname  = path.dirname(__filename);

  console.log('[midas:migrate] process.cwd() =', process.cwd());
  console.log('[midas:migrate] __dirname      =', __dirname);

  const candidates = [
    // Strategy A: via @midas/database package.json resolve
    (() => {
      try {
        const pkg = require.resolve('@midas/database/package.json');
        return path.join(path.dirname(pkg), 'migrations');
      } catch { return null; }
    })(),
    // Strategy B: relative to __dirname (dist/ → monorepo root)
    path.resolve(__dirname, '../../../packages/database/migrations'),
    path.resolve(__dirname, '../../../../packages/database/migrations'),
    path.resolve(__dirname, '../../../../../packages/database/migrations'),
    // Strategy C: relative to cwd()
    path.resolve(process.cwd(), 'packages/database/migrations'),
    path.resolve(process.cwd(), 'midas-monorepo/packages/database/migrations'),
    // Strategy D: env override (set MIGRATIONS_DIR in Railway if all else fails)
    process.env.MIGRATIONS_DIR ?? null,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const exists = fs.existsSync(candidate);
    console.log(`[midas:migrate] candidate ${candidate} → ${exists ? 'EXISTS ✓' : 'missing'}`);
    if (exists) return candidate;
  }
  return null;
}

export async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn('[midas:migrate] DATABASE_URL not set — skipping migrations');
    return;
  }

  const migrationsDir = findMigrationsDir();
  if (!migrationsDir) {
    console.error('[midas:migrate] ✗ Could not locate migrations directory — skipping');
    return; // non-fatal: don't block workers if path detection fails
  }

  console.log('[midas:migrate] Running migrations from:', migrationsDir);

  try {
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
      checkOrder: false,
      verbose: true,
      log: (msg: string) => console.log('[midas:migrate]', msg),
    });

    console.log('[midas:migrate] ✓ Migrations complete.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('No migrations') ||
      msg.includes('already up to date') ||
      msg.includes('No files to migrate') ||
      msg.includes('0 migrations')
    ) {
      console.log('[midas:migrate] No pending migrations — DB is up to date.');
      return;
    }
    console.error('[midas:migrate] ✗ Migration FAILED:', msg);
    // Non-fatal — log and continue so workers still start
    // (prevents full outage if only migrate fails)
  }
}
