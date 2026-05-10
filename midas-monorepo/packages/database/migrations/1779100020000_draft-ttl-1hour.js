/**
 * Migration: Phase 1.39 — Draft TTL Change Documentation
 *
 * This is a documentation-only migration. The actual TTL change is in code:
 *   apps/background-workers/src/services/draft.service.ts
 *     BEFORE: const DRAFT_TTL_HOURS = 24;  (ADR-013)
 *     AFTER:  const DRAFT_TTL_SECONDS = 3600; // 1 hour
 *
 * Rationale for 1-hour TTL (Phase 1.39):
 *   - 24h is too long for a financial draft — user context is lost
 *   - 1h gives enough time to confirm while keeping chat clean
 *   - Reminder at T-10min (50 min mark) ensures user awareness
 *   - Expiry at T-60min auto-cleans abandoned drafts
 *
 * The expires_at column value is computed at draft creation time in
 * draft.service.ts, so no DB-level default change is needed.
 */

export const shorthands = undefined;

export const up = () => {
  // Code-only change — see draft.service.ts DRAFT_TTL_SECONDS
};

export const down = () => {
  // Revert by changing DRAFT_TTL_SECONDS back to DRAFT_TTL_HOURS = 24
};
