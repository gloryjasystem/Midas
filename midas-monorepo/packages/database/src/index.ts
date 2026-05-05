/**
 * @midas/database
 *
 * Database access layer for PostgreSQL.
 * Provides:
 * - Connection pool with pg.types.setTypeParser for NUMERIC → Decimal (SEC-02)
 * - withTenantTransaction(workspaceId, fn) for RLS isolation (SEC-03)
 * - Migration runner
 * - Repository interfaces
 */

export * from './db.js';
export * from './transaction.js';
