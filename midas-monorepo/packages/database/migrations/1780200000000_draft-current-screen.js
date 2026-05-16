/**
 * Migration: Phase 2.6 — Draft Current Screen Tracking
 *
 * Adds current_screen column to transaction_drafts and updates
 * system_find_drafts_needing_reminder() to return it.
 *
 * Purpose:
 *   The expiration CRON worker needs to know which screen the draft
 *   is currently on so the reminder notification mirrors the exact
 *   same buttons (not a hardcoded account picker).
 *
 * Screens:
 *   screen1  — account not yet selected (shows account picker)
 *   screen1b — account selected, cross-currency, debit amount not entered
 *   screen2  — ready to confirm (shows Confirm button)
 *
 * Default 'screen1' is safe for existing rows — they had no account
 * selected at the time of creation (legacy drafts without star-account).
 *
 * SEC-12: No user PII stored in this column.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    -- ── Step 1: Add current_screen column ──────────────────────────────────
    ALTER TABLE transaction_drafts
      ADD COLUMN IF NOT EXISTS current_screen TEXT NOT NULL DEFAULT 'screen1'
      CHECK (current_screen IN ('screen1', 'screen1b', 'screen2'));

    -- ── Step 2: Backfill existing rows that already have account_id ─────────
    -- If account_id is set and account_debit_amount is NOT NULL → screen2
    -- If account_id is set and account_debit_amount IS NULL     → screen1b
    -- Otherwise                                                 → screen1 (default, already set)
    UPDATE transaction_drafts
      SET current_screen = CASE
        WHEN account_id IS NOT NULL AND account_debit_amount IS NOT NULL THEN 'screen2'
        WHEN account_id IS NOT NULL AND account_debit_amount IS NULL     THEN 'screen1b'
        ELSE 'screen1'
      END
    WHERE status = 'pending_user';

    -- ── Step 3: Update system_find_drafts_needing_reminder() ───────────────
    DROP FUNCTION IF EXISTS system_find_drafts_needing_reminder(INTEGER);

    CREATE FUNCTION system_find_drafts_needing_reminder(lead_seconds INTEGER DEFAULT 600)
    RETURNS TABLE(
      draft_id              CHARACTER VARYING,
      workspace_id          CHARACTER VARYING,
      preview_message_id    TEXT,
      preview_chat_id       TEXT,
      parsed_intent         TEXT,
      parsed_amount         TEXT,
      parsed_currency       TEXT,
      item_name             TEXT,
      parsed_category_hint  TEXT,
      account_id            CHARACTER VARYING,
      account_debit_amount  TEXT,
      current_screen        TEXT,
      account_name          TEXT,
      account_currency      TEXT
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
    AS $$
    BEGIN
      RETURN QUERY
      SELECT
        td.id                          AS draft_id,
        td.workspace_id,
        td.preview_message_id,
        td.preview_chat_id,
        td.parsed_intent,
        td.parsed_amount::TEXT,
        td.parsed_currency,
        td.item_name,
        td.parsed_category_hint,
        td.account_id,
        td.account_debit_amount::TEXT,
        td.current_screen,
        acc.name                       AS account_name,
        acc.currency                   AS account_currency
      FROM transaction_drafts td
      LEFT JOIN account_sources acc ON acc.id = td.account_id
      WHERE td.status = 'pending_user'
        AND td.reminder_sent_at IS NULL
        AND td.expires_at <= NOW() + (lead_seconds || ' seconds')::INTERVAL
        AND td.expires_at > NOW();  -- not yet expired
    END;
    $$;

    ALTER FUNCTION system_find_drafts_needing_reminder(INTEGER) OWNER TO midas_migrator;
    REVOKE ALL ON FUNCTION system_find_drafts_needing_reminder(INTEGER) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION system_find_drafts_needing_reminder(INTEGER) TO midas_app;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    -- Restore previous version of function (without current_screen + account_name)
    DROP FUNCTION IF EXISTS system_find_drafts_needing_reminder(INTEGER);

    CREATE FUNCTION system_find_drafts_needing_reminder(lead_seconds INTEGER DEFAULT 600)
    RETURNS TABLE(
      draft_id              CHARACTER VARYING,
      workspace_id          CHARACTER VARYING,
      preview_message_id    TEXT,
      preview_chat_id       TEXT,
      parsed_intent         TEXT,
      parsed_amount         TEXT,
      parsed_currency       TEXT,
      item_name             TEXT,
      parsed_category_hint  TEXT,
      account_id            CHARACTER VARYING,
      account_debit_amount  TEXT
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
    AS $$
    BEGIN
      RETURN QUERY
      SELECT
        td.id                          AS draft_id,
        td.workspace_id,
        td.preview_message_id,
        td.preview_chat_id,
        td.parsed_intent,
        td.parsed_amount::TEXT,
        td.parsed_currency,
        td.item_name,
        td.parsed_category_hint,
        td.account_id,
        td.account_debit_amount::TEXT
      FROM transaction_drafts td
      WHERE td.status = 'pending_user'
        AND td.reminder_sent_at IS NULL
        AND td.expires_at <= NOW() + (lead_seconds || ' seconds')::INTERVAL
        AND td.expires_at > NOW();
    END;
    $$;

    ALTER FUNCTION system_find_drafts_needing_reminder(INTEGER) OWNER TO midas_migrator;
    REVOKE ALL ON FUNCTION system_find_drafts_needing_reminder(INTEGER) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION system_find_drafts_needing_reminder(INTEGER) TO midas_app;

    -- Remove column (last — function must be dropped first to avoid dependency issues)
    ALTER TABLE transaction_drafts
      DROP COLUMN IF EXISTS current_screen;
  `);
};
