/**
 * Direct migration script: apply 1779500000000_onboarding-placeholder-flag
 * Run: node apply-placeholder-migration.mjs
 * Env: DATABASE_URL must be set to production public URL
 */
import pg from 'pg';

const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set');
  process.exit(1);
}

const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  await client.connect();
  console.log('Connected to database');

  try {
    await client.query('BEGIN');

    // Step A: Add column
    console.log('Adding is_onboarding_placeholder column...');
    await client.query(`
      ALTER TABLE account_sources
        ADD COLUMN IF NOT EXISTS is_onboarding_placeholder BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    // Step A2: Partial index
    console.log('Creating partial index...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_account_sources_onboarding_placeholder
        ON account_sources (workspace_id)
        WHERE is_onboarding_placeholder = TRUE AND deleted_at IS NULL;
    `);

    // Step B: Update system_find_or_create_user function
    console.log('Updating system_find_or_create_user...');
    await client.query(`
      CREATE OR REPLACE FUNCTION system_find_or_create_user(
        p_telegram_id             BIGINT,
        p_candidate_user_id       VARCHAR(26),
        p_candidate_workspace_id  VARCHAR(26),
        p_candidate_membership_id VARCHAR(26),
        p_workspace_name          TEXT,
        p_candidate_account_id    VARCHAR(26),
        p_candidate_category_id   VARCHAR(26)
      )
      RETURNS TABLE(user_id VARCHAR(26), workspace_id VARCHAR(26), is_new_user BOOLEAN)
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = 'public', 'pg_catalog'
      AS $$
      DECLARE
        v_user_id      VARCHAR(26);
        v_workspace_id VARCHAR(26);
      BEGIN
        SELECT u.id, wm.workspace_id
          INTO v_user_id, v_workspace_id
          FROM users u
          JOIN workspace_memberships wm ON wm.user_id = u.id
         WHERE u.telegram_id = p_telegram_id
           AND wm.is_default = true
         LIMIT 1;

        IF FOUND THEN
          RETURN QUERY SELECT v_user_id, v_workspace_id, false::BOOLEAN;
          RETURN;
        END IF;

        PERFORM pg_advisory_xact_lock(p_telegram_id);

        SELECT u.id, wm.workspace_id
          INTO v_user_id, v_workspace_id
          FROM users u
          JOIN workspace_memberships wm ON wm.user_id = u.id
         WHERE u.telegram_id = p_telegram_id
           AND wm.is_default = true
         LIMIT 1;

        IF FOUND THEN
          RETURN QUERY SELECT v_user_id, v_workspace_id, false::BOOLEAN;
          RETURN;
        END IF;

        INSERT INTO users (id, telegram_id)
          VALUES (p_candidate_user_id, p_telegram_id);

        INSERT INTO workspaces (id, name, default_currency)
          VALUES (p_candidate_workspace_id, p_workspace_name, 'USDT');

        INSERT INTO workspace_memberships (id, user_id, workspace_id, role, is_default)
          VALUES (p_candidate_membership_id, p_candidate_user_id, p_candidate_workspace_id, 'owner', true);

        INSERT INTO account_sources (id, workspace_id, name, type, currency, is_onboarding_placeholder)
          VALUES (
            p_candidate_account_id,
            p_candidate_workspace_id,
            'Default',
            'manual',
            'USDT',
            TRUE
          )
          ON CONFLICT DO NOTHING;

        INSERT INTO categories (id, workspace_id, name, "group")
          VALUES (
            p_candidate_category_id,
            p_candidate_workspace_id,
            'Разное',
            'Жизнь'
          )
          ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING;

        RETURN QUERY SELECT p_candidate_user_id, p_candidate_workspace_id, true::BOOLEAN;
      END;
      $$;
    `);

    // Permissions
    console.log('Setting permissions...');
    await client.query(`REVOKE ALL ON FUNCTION system_find_or_create_user(BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) FROM PUBLIC;`);
    await client.query(`GRANT EXECUTE ON FUNCTION system_find_or_create_user(BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) TO midas_app;`);

    // Record in pgmigrations table
    console.log('Recording migration in pgmigrations...');
    // Check if already recorded first (idempotency)
    const alreadyRecorded = await client.query(`
      SELECT id FROM pgmigrations WHERE name = '1779500000000_onboarding-placeholder-flag' LIMIT 1
    `);
    if (alreadyRecorded.rows.length === 0) {
      await client.query(`
        INSERT INTO pgmigrations (name, run_on)
          VALUES ('1779500000000_onboarding-placeholder-flag', NOW())
      `);
    }

    await client.query('COMMIT');
    console.log('✅ Migration 1779500000000_onboarding-placeholder-flag applied successfully');

    // Verify
    const check = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'account_sources' AND column_name = 'is_onboarding_placeholder'
    `);
    console.log('Column verified:', check.rows[0]);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ERROR — migration rolled back:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
