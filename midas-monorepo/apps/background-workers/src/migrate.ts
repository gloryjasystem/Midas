/**
 * Migration runner — runs at background-workers startup.
 * Applies all pending node-pg-migrate migrations against the production DB.
 *
 * Path resolution strategy (in order of preference):
 *   1. MIGRATIONS_DIR env var (explicit override for Railway)
 *   2. require.resolve('@midas/database/package.json') → sibling migrations/
 *   3. Relative paths from __dirname (dist/) going up the monorepo tree
 *   4. Relative to process.cwd()
 *
 * Failure is NON-FATAL: logs the error and continues starting workers.
 * This avoids full outage if migrate.ts has a path issue.
 *
 * SEC-03: Uses DATABASE_URL directly (midas_migrator role).
 *
 * NOTE: node-pg-migrate@8 is ESM-only. We must use dynamic import() to
 * properly resolve the named 'runner' export. Using require() via
 * createRequire returns an object without a callable function, causing
 * the "no callable export found" error. Dynamic import() is the fix.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);

function findMigrationsDir(): string | null {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname  = path.dirname(__filename);

  console.log('[midas:migrate] cwd =', process.cwd());
  console.log('[midas:migrate] __dirname =', __dirname);

  const candidates: Array<string | null> = [
    // Override via env var (set MIGRATIONS_DIR in Railway if needed)
    process.env.MIGRATIONS_DIR ?? null,

    // Via @midas/database package.json resolve (pnpm workspace)
    (() => {
      try {
        return path.join(path.dirname(require.resolve('@midas/database/package.json')), 'migrations');
      } catch { return null; }
    })(),

    // Relative to __dirname (dist/migrate.js) — Railway Nixpacks layout:
    // /app/midas-monorepo/apps/background-workers/dist/migrate.js
    // ../../../ = /app/midas-monorepo/
    path.resolve(__dirname, '../../../packages/database/migrations'),

    // Git repo root is one level above midas-monorepo
    path.resolve(__dirname, '../../../../midas-monorepo/packages/database/migrations'),

    // From cwd (Railway might set cwd to repo root)
    path.resolve(process.cwd(), 'midas-monorepo/packages/database/migrations'),
    path.resolve(process.cwd(), 'packages/database/migrations'),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const exists = fs.existsSync(candidate);
    console.log(`[midas:migrate]  ${exists ? '\u2713' : '\u2717'} ${candidate}`);
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
    console.error('[midas:migrate] ✗ Could not locate migrations dir — skipping (workers will still start)');
    return;
  }

  console.log('[midas:migrate] Running migrations from:', migrationsDir);

  try {
    // node-pg-migrate@8 is ESM-only — must use dynamic import() to get named exports.
    // The 'runner' named export is the migration function (NOT the default export).
    // Using require() via createRequire fails to resolve ESM named exports in Node 22+.
    const { runner } = await import('node-pg-migrate');

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
    if (msg.includes('No migrations') || msg.includes('No files')) {
      console.log('[midas:migrate] No pending migrations.');
      return;
    }
    // Non-fatal — log and continue
    console.error('[midas:migrate] ✗ FAILED:', msg);
  }
}
