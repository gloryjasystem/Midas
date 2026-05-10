/**
 * Migration: Phase 1.39 — Expire Function Returns Table + Reminder Function
 *
 * 1. Replaces system_expire_pending_drafts() to return full draft data
 *    (instead of just a count). This enables the expiration worker to
 *    edit preview/reminder cards in-place with transaction details.
 *
 * 2. Creates system_find_drafts_needing_reminder() — finds drafts that
 *    need a reminder notification (approaching expiry, reminder not yet sent).
 *
 * Both functions are SECURITY DEFINER with explicit search_path.
 * SEC-12: Functions return system metadata only (IDs, parsed fields),
 *         never raw_text or user financial details beyond category/amount.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    -- ══════════════════════════════════════════════════════════════
    -- 1. Replace system_expire_pending_drafts()
    -- Must DROP first because return type changes (INTEGER → TABLE)
    -- ══════════════════════════════════════════════════════════════

    DROP FUNCTION IF EXISTS system_expire_pending_drafts();

    CREATE FUNCTION system_expire_pending_drafts()
    RETURNS TABLE(
      draft_id              CHARACTER VARYING,
      workspace_id          CHARACTER VARYING,
      preview_message_id    TEXT,
      preview_chat_id       TEXT,
      reminder_message_id   TEXT,
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
      UPDATE transaction_drafts td
        SET status = 'expired',
            updated_at = NOW()
      WHERE td.status = 'pending_user'
        AND td.expires_at <= NOW()
      RETURNING
        td.id                     AS draft_id,
        td.workspace_id,
        td.preview_message_id,
        td.preview_chat_id,
        td.reminder_message_id,
        td.parsed_intent,
        td.parsed_amount::TEXT,
        td.parsed_currency,
        td.item_name,
        td.parsed_category_hint;
    END;
    $$;

    -- Ownership must be midas_migrator (the role running migrations).
    -- Grant execute to midas_app (the runtime role).
    ALTER FUNCTION system_expire_pending_drafts() OWNER TO midas_migrator;
    REVOKE ALL ON FUNCTION system_expire_pending_drafts() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION system_expire_pending_drafts() TO midas_app;

    -- ══════════════════════════════════════════════════════════════
    -- 2. Create system_find_drafts_needing_reminder()
    -- Finds pending_user drafts approaching expiry that haven't been reminded.
    -- ══════════════════════════════════════════════════════════════

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
    -- Drop the reminder function
    DROP FUNCTION IF EXISTS system_find_drafts_needing_reminder(INTEGER);

    -- Restore original expire function (returns INTEGER count)
    DROP FUNCTION IF EXISTS system_expire_pending_drafts();

    CREATE FUNCTION system_expire_pending_drafts()
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
    AS $$
    DECLARE
      expired_count INTEGER;
    BEGIN
      WITH expired AS (
        UPDATE transaction_drafts
          SET status = 'expired',
              updated_at = NOW()
        WHERE status = 'pending_user'
          AND expires_at <= NOW()
        RETURNING id
      )
      SELECT COUNT(*) INTO expired_count FROM expired;
      RETURN expired_count;
    END;
    $$;

    ALTER FUNCTION system_expire_pending_drafts() OWNER TO midas_migrator;
    REVOKE ALL ON FUNCTION system_expire_pending_drafts() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION system_expire_pending_drafts() TO midas_app;
  `);
};
