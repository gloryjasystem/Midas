/**
 * Migration: Phase 1.39 — Draft Preview Message Persistence
 *
 * Adds columns to transaction_drafts for persisting Telegram message IDs
 * used in the draft lifecycle UI (preview, reminder cards).
 *
 * These columns enable durable message tracking that survives Redis TTL
 * expiration, allowing the system to edit/delete cards even after long
 * periods (up to 1 hour for the new draft TTL).
 *
 * Columns:
 *   preview_message_id  — Telegram message ID of the preview card
 *   preview_chat_id     — Telegram chat ID where preview was sent
 *   reminder_sent_at    — Timestamp when reminder was sent (NULL = not sent)
 *   reminder_message_id — Telegram message ID of the reminder card
 *
 * SEC-12: These are system-controlled IDs, not user financial data.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE transaction_drafts
      ADD COLUMN IF NOT EXISTS preview_message_id  TEXT,
      ADD COLUMN IF NOT EXISTS preview_chat_id     TEXT,
      ADD COLUMN IF NOT EXISTS reminder_sent_at    TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reminder_message_id TEXT;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE transaction_drafts
      DROP COLUMN IF EXISTS preview_message_id,
      DROP COLUMN IF EXISTS preview_chat_id,
      DROP COLUMN IF EXISTS reminder_sent_at,
      DROP COLUMN IF EXISTS reminder_message_id;
  `);
};
