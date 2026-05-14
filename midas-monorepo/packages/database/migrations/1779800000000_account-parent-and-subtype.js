/**
 * Migration: Account Parent-Child Relationship — Balance Redesign Phase B
 *
 * Adds two nullable columns to account_sources:
 *
 *   parent_account_id  VARCHAR(26)  — FK to account_sources.id (self-referential)
 *   sub_type           TEXT         — semantic account subtype
 *
 * Design decisions:
 *
 *   1. parent_account_id:
 *      Nullable (NULL = top-level / standalone account).
 *      References account_sources(id) with ON DELETE CASCADE:
 *        - Application always uses soft-delete (deleted_at IS NOT NULL).
 *        - CASCADE is a safety net for hard-delete edge cases only.
 *      VARCHAR(26) matches ULID format used across the schema.
 *      Index on parent_account_id (partial, WHERE NOT NULL) for fast child lookups.
 *
 *   2. sub_type:
 *      Semantic type for grouping (Phase B replaces heuristic used in Phase A).
 *      Values: 'bank_card', 'bank_account', 'cash', 'crypto_exchange',
 *              'crypto_wallet', 'general' (default).
 *      Existing rows default to 'general' — safe, no backfill required.
 *      CHECK constraint enforces the allowlist.
 *
 *   3. IF NOT EXISTS / IF EXISTS guards:
 *      Migration is idempotent — safe to re-apply in CI or failed deploys.
 *
 *   4. No NOT NULL on parent_account_id:
 *      All existing accounts remain valid (standalone = parent IS NULL).
 *
 * Down migration:
 *   Drops index, then columns — safe (no dependent views or functions).
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    -- ── parent_account_id ────────────────────────────────────────────────────────
    ALTER TABLE account_sources
      ADD COLUMN IF NOT EXISTS parent_account_id VARCHAR(26)
        REFERENCES account_sources(id) ON DELETE CASCADE;

    COMMENT ON COLUMN account_sources.parent_account_id IS
      'Phase B: Self-referential FK. NULL = top-level account. Non-null = child currency account grouped under a parent.';

    -- Partial index: only rows that ARE children (avoids indexing the majority NULL rows)
    CREATE INDEX IF NOT EXISTS idx_account_sources_parent
      ON account_sources(parent_account_id)
      WHERE parent_account_id IS NOT NULL;

    -- ── sub_type ─────────────────────────────────────────────────────────────────
    ALTER TABLE account_sources
      ADD COLUMN IF NOT EXISTS sub_type TEXT NOT NULL DEFAULT 'general';

    -- Drop + re-add constraint for idempotency
    ALTER TABLE account_sources
      DROP CONSTRAINT IF EXISTS account_sources_sub_type_check;
    ALTER TABLE account_sources
      ADD CONSTRAINT account_sources_sub_type_check
      CHECK (sub_type IN (
        'bank_card', 'bank_account', 'cash',
        'crypto_exchange', 'crypto_wallet', 'general'
      ));

    COMMENT ON COLUMN account_sources.sub_type IS
      'Phase B: Semantic account subtype for UI grouping. Replaces name-heuristic classification from Phase A.';
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    -- ── sub_type ─────────────────────────────────────────────────────────────────
    ALTER TABLE account_sources
      DROP CONSTRAINT IF EXISTS account_sources_sub_type_check;
    ALTER TABLE account_sources
      DROP COLUMN IF EXISTS sub_type;

    -- ── parent_account_id ────────────────────────────────────────────────────────
    DROP INDEX IF EXISTS idx_account_sources_parent;
    ALTER TABLE account_sources
      DROP COLUMN IF EXISTS parent_account_id;
  `);
};
