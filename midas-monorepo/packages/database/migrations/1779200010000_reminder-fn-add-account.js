/**
 * Migration: Phase 2.5 — Reminder function returns account_id + account_debit_amount
 *
 * Replaces system_find_drafts_needing_reminder() to also expose:
 *   - account_id             — the account already linked to the draft (or NULL)
 *   - account_debit_amount   — the cross-currency debit amount (or NULL)
 *
 * The expiration worker uses these to build a context-aware confirm keyboard
 * on reminder notifications (matching the original preview card buttons):
 *   • account selected   → ✅ Подтвердить  |  🔄 Сменить счёт  |  ✏️/✖️
 *   • no account yet     → ➕ Выбрать счёт  |  ✏️/✖️  (confirm blocked)
 *
 * SECURITY DEFINER + explicit search_path preserved.
 * SEC-12: raw_text is never returned.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    -- Must DROP first because RETURNS TABLE columns are changing
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
    -- Restore previous version (without account fields)
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
      parsed_category_hint  TEXT
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
    AS $$
    BEGIN
      RETURN QUERY
      SELECT
        td.id                     AS draft_id,
        td.workspace_id,
        td.preview_message_id,
        td.preview_chat_id,
        td.parsed_intent,
        td.parsed_amount::TEXT,
        td.parsed_currency,
        td.item_name,
        td.parsed_category_hint
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
  `);
};
