/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION enforce_draft_state_machine()
    RETURNS TRIGGER AS $$
    BEGIN
      -- If the OLD status was terminal, it cannot be changed.
      IF OLD.status IN ('approved', 'rejected', 'expired') AND NEW.status != OLD.status THEN
        RAISE EXCEPTION 'Cannot transition from terminal draft state: %', OLD.status;
      END IF;

      -- If transitioning TO approved, we should also verify expires_at
      IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
        IF OLD.expires_at <= NOW() THEN
          RAISE EXCEPTION 'Cannot approve an expired draft';
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trigger_enforce_draft_state_machine
    BEFORE UPDATE ON transaction_drafts
    FOR EACH ROW
    EXECUTE FUNCTION enforce_draft_state_machine();
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trigger_enforce_draft_state_machine ON transaction_drafts;
    DROP FUNCTION IF EXISTS enforce_draft_state_machine;
  `);
};
