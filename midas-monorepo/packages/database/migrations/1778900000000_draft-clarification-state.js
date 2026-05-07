/**
 * Migration: Phase 1.32 — Draft Clarification State Machine
 *
 * Adds a `clarification_field` column to transaction_drafts to track
 * which field is missing and needs user input during a clarification round.
 *
 * Also replaces the enforce_draft_state_machine trigger to explicitly allow
 * needs_clarification → pending_user transitions (clarification loop patching).
 *
 * The existing trigger already allowed this implicitly (it only blocks from
 * terminal states: approved/rejected/expired), but this migration makes the
 * intent explicit and adds documentation for future maintainers.
 *
 * clarification_field values: 'amount' | 'intent' | 'category' | null
 *   NULL  = not in clarification (normal draft)
 *   'amount'   = bot asked "Сколько?" — awaiting amount text reply
 *   'intent'   = bot showed intent picker — awaiting clar:intent: callback
 *   'category' = bot showed category picker — awaiting clar:cat: callback
 *
 * SEC-01: clarification_field is a backend-controlled enum — never from AI output.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    -- Add clarification_field column to track which field is being clarified.
    -- NULL = not in clarification. Non-null = specific field awaiting user input.
    ALTER TABLE transaction_drafts
      ADD COLUMN IF NOT EXISTS clarification_field TEXT
        CHECK (clarification_field IN ('amount', 'intent', 'category'));

    -- Replace trigger function to explicitly document allowed transitions.
    -- This is a non-destructive replace — logic is identical, documentation added.
    CREATE OR REPLACE FUNCTION enforce_draft_state_machine()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Terminal states cannot transition to any other state.
      IF OLD.status IN ('approved', 'rejected', 'expired') AND NEW.status != OLD.status THEN
        RAISE EXCEPTION 'Cannot transition from terminal draft state: %', OLD.status;
      END IF;

      -- Approved drafts must not be expired (defence-in-depth).
      IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
        IF OLD.expires_at <= NOW() THEN
          RAISE EXCEPTION 'Cannot approve an expired draft';
        END IF;
      END IF;

      -- Phase 1.32: needs_clarification → pending_user is explicitly allowed.
      -- This transition occurs when a clarification round successfully patches
      -- the missing field (amount, intent, or category) and the draft is now complete.
      -- No special logic needed — the block above only covers terminal states.

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    -- Remove clarification_field column.
    ALTER TABLE transaction_drafts
      DROP COLUMN IF EXISTS clarification_field;

    -- Revert trigger function to Phase 1.6-B version (identical logic, no doc comment).
    CREATE OR REPLACE FUNCTION enforce_draft_state_machine()
    RETURNS TRIGGER AS $$
    BEGIN
      IF OLD.status IN ('approved', 'rejected', 'expired') AND NEW.status != OLD.status THEN
        RAISE EXCEPTION 'Cannot transition from terminal draft state: %', OLD.status;
      END IF;
      IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
        IF OLD.expires_at <= NOW() THEN
          RAISE EXCEPTION 'Cannot approve an expired draft';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
};
