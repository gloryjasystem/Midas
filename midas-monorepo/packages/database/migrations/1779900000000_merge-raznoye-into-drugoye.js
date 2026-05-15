/**
 * Migration: Merge legacy "Разное" category into canonical "Другое"
 *
 * Background:
 *   The original onboarding seed (Phase 1.24) created a single default category
 *   named "Разное" (group: Жизнь). Migration 1779000000000 introduced 28 default
 *   categories including "Другое" (group: Жизнь). Because the backfill uses
 *   ON CONFLICT DO NOTHING on (workspace_id, name), workspaces that already had
 *   "Разное" ended up with BOTH "Разное" AND "Другое" — two semantically identical
 *   "Other" categories.
 *
 * This migration:
 *   1. For every workspace that has BOTH "Разное" AND "Другое":
 *      a. Re-assigns transactions from "Разное" → "Другое"  (no data loss)
 *      b. Re-assigns transaction_drafts.category_id the same way
 *      c. Deletes "Разное" from categories
 *   2. For workspaces that have ONLY "Разное" (no "Другое"):
 *      Renames "Разное" to "Другое" in-place (keeps existing transactions intact)
 *
 * Safety:
 *   - Step 1 is safe: ON DELETE SET NULL guard is NOT on transactions.category_id
 *     (FK is ON DELETE SET NULL as per schema), so we UPDATE before DELETE.
 *   - Step 2 (rename) touches only name — no FK changes needed.
 *   - All operations are idempotent: running twice is safe (WHERE guards protect).
 *
 * Down:
 *   Cannot reliably reverse (data merged). down() is a no-op with a comment.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      ws RECORD;
      raznoye_id   VARCHAR(26);
      drugoye_id   VARCHAR(26);
    BEGIN
      -- ── Iterate over every workspace that has "Разное" ────────────────────
      FOR ws IN
        SELECT DISTINCT workspace_id
        FROM categories
        WHERE name = 'Разное'
      LOOP
        SELECT id INTO raznoye_id
        FROM categories
        WHERE workspace_id = ws.workspace_id AND name = 'Разное'
        LIMIT 1;

        SELECT id INTO drugoye_id
        FROM categories
        WHERE workspace_id = ws.workspace_id AND name = 'Другое'
        LIMIT 1;

        IF drugoye_id IS NOT NULL THEN
          -- ── Case 1: workspace has BOTH — merge Разное → Другое ──────────
          -- 1a. Re-point committed transactions
          UPDATE transactions
          SET category_id = drugoye_id
          WHERE category_id = raznoye_id
            AND workspace_id = ws.workspace_id;

          -- 1b. Re-point pending/needs_clarification drafts
          UPDATE transaction_drafts
          SET category_id = drugoye_id
          WHERE category_id = raznoye_id
            AND workspace_id = ws.workspace_id;

          -- 1c. Remove the duplicate "Разное" row
          DELETE FROM categories
          WHERE id = raznoye_id
            AND workspace_id = ws.workspace_id;

        ELSE
          -- ── Case 2: workspace has ONLY "Разное" — rename in-place ───────
          UPDATE categories
          SET name = 'Другое'
          WHERE id = raznoye_id
            AND workspace_id = ws.workspace_id;
        END IF;
      END LOOP;
    END;
    $$;
  `);
};

export const down = (pgm) => {
  // Cannot reverse a data merge without knowing which transactions
  // originally belonged to "Разное". This migration is intentionally
  // irreversible — the rename/merge is a one-way data cleanup.
  pgm.sql(`
    -- No-op: "Разное" → "Другое" merge cannot be safely reversed.
    -- Run manually if you need to recreate "Разное" for a specific workspace.
    SELECT 1;
  `);
};
