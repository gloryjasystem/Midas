/**
 * Migration: Intelligent Transaction Understanding — Phase 1.35
 *
 * Changes:
 *   1. ALTER transaction_drafts: +parsed_category_hint TEXT, +item_name TEXT
 *   2. ALTER transactions: +item_name TEXT
 *   3. ALTER workspaces: +default_expense_account_id, +default_income_account_id
 *   4. Backfill 28 default categories for ALL existing workspaces (INSERT ON CONFLICT DO NOTHING)
 *   5. UPDATE system_find_or_create_user() to seed 28 categories for new users
 *
 * All new columns are nullable with no DEFAULT — online ALTER, no table rewrite.
 * Backfill uses INSERT ... ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING
 * so existing user-created categories with the same name are untouched.
 *
 * Security:
 *   - SECURITY DEFINER function retains search_path = 'public', 'pg_catalog'
 *   - REVOKE/GRANT maintained for midas_app
 *   - Category IDs generated via UPPER(gen_random_uuid()) inside PL/pgSQL — passes ULID_RE
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  // ── Step 1: Add columns to transaction_drafts ────────────────────────────
  pgm.sql(`
    ALTER TABLE transaction_drafts ADD COLUMN IF NOT EXISTS parsed_category_hint TEXT;
    ALTER TABLE transaction_drafts ADD COLUMN IF NOT EXISTS item_name TEXT;
  `);

  // ── Step 2: Add item_name to transactions ────────────────────────────────
  pgm.sql(`
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS item_name TEXT;
  `);

  // ── Step 3: Add default account columns to workspaces ────────────────────
  pgm.sql(`
    ALTER TABLE workspaces
      ADD COLUMN IF NOT EXISTS default_expense_account_id VARCHAR(26)
        REFERENCES account_sources(id) ON DELETE SET NULL;
    ALTER TABLE workspaces
      ADD COLUMN IF NOT EXISTS default_income_account_id VARCHAR(26)
        REFERENCES account_sources(id) ON DELETE SET NULL;
  `);

  // ── Step 4: Backfill 28 default categories for ALL existing workspaces ───
  // Uses ON CONFLICT to skip any workspace that already has a category with the same name.
  // gen_random_uuid() generates unique IDs; UPPER + SUBSTR to fit VARCHAR(26)
  // and pass existing ULID_RE /^[0-9A-Z]{26}$/ validators.
  pgm.sql(`
    INSERT INTO categories (id, workspace_id, name, "group")
    SELECT
      UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)),
      w.id,
      cat.name,
      cat.grp::category_group
    FROM workspaces w
    CROSS JOIN (VALUES
      ('Продукты',           'Жизнь'),
      ('Кафе и рестораны',   'Жизнь'),
      ('Транспорт',          'Жизнь'),
      ('Жильё',              'Жизнь'),
      ('Здоровье',           'Жизнь'),
      ('Одежда',             'Жизнь'),
      ('Красота',            'Жизнь'),
      ('Развлечения',        'Жизнь'),
      ('Подписки',           'Жизнь'),
      ('Связь',              'Жизнь'),
      ('Образование',        'Жизнь'),
      ('Спорт',              'Жизнь'),
      ('Путешествия',        'Жизнь'),
      ('Подарки',            'Жизнь'),
      ('Дети',               'Жизнь'),
      ('Другое',             'Жизнь'),
      ('Зарплаты и выплаты', 'Бизнес'),
      ('Фриланс',           'Бизнес'),
      ('Реклама',            'Бизнес'),
      ('Софт и сервисы',     'Бизнес'),
      ('Оборудование',       'Бизнес'),
      ('Офис',               'Бизнес'),
      ('Налоги',             'Бизнес'),
      ('Комиссии',           'Бизнес'),
      ('Крипто-комиссии',    'Бизнес'),
      ('Подрядчики',         'Бизнес'),
      ('Продажи',            'Бизнес'),
      ('Инвестиции',         'Бизнес')
    ) AS cat(name, grp)
    ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING;
  `);

  // ── Step 5: Update system_find_or_create_user to seed 28 categories ──────
  // Function signature unchanged (7 params). p_candidate_category_id is used
  // for the first category ("Другое"); remaining 27 use UPPER(gen_random_uuid()).
  pgm.sql(`
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
      -- ── Step 1: Check if user already exists (fast path) ─────────────────────
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

      -- ── Step 2: Acquire advisory lock to prevent concurrent /start ───────────
      PERFORM pg_advisory_xact_lock(p_telegram_id);

      -- ── Step 3: Re-check after lock ──────────────────────────────────────────
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

      -- ── Step 4: New user — core entities ─────────────────────────────────────
      INSERT INTO users (id, telegram_id)
        VALUES (p_candidate_user_id, p_telegram_id);

      INSERT INTO workspaces (id, name, default_currency)
        VALUES (p_candidate_workspace_id, p_workspace_name, 'USDT');

      INSERT INTO workspace_memberships (id, user_id, workspace_id, role, is_default)
        VALUES (p_candidate_membership_id, p_candidate_user_id, p_candidate_workspace_id, 'owner', true);

      -- ── Step 5: Seed default account ─────────────────────────────────────────
      INSERT INTO account_sources (id, workspace_id, name, type, currency)
        VALUES (
          p_candidate_account_id,
          p_candidate_workspace_id,
          'Default',
          'manual'::account_source_type,
          'USDT'
        )
        ON CONFLICT DO NOTHING;

      -- ── Step 6: Seed 28 default categories (Phase 1.35) ─────────────────────
      -- p_candidate_category_id used for "Другое" (fallback category).
      -- Remaining 27 get UPPER(gen_random_uuid())-based IDs for ULID_RE compat.
      INSERT INTO categories (id, workspace_id, name, "group")
      VALUES
        (p_candidate_category_id, p_candidate_workspace_id, 'Другое', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Продукты', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Кафе и рестораны', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Транспорт', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Жильё', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Здоровье', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Одежда', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Красота', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Развлечения', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Подписки', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Связь', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Образование', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Спорт', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Путешествия', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Подарки', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Дети', 'Жизнь'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Зарплаты и выплаты', 'Бизнес'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Фриланс', 'Бизнес'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Реклама', 'Бизнес'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Софт и сервисы', 'Бизнес'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Оборудование', 'Бизнес'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Офис', 'Бизнес'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Налоги', 'Бизнес'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Комиссии', 'Бизнес'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Крипто-комиссии', 'Бизнес'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Подрядчики', 'Бизнес'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Продажи', 'Бизнес'::category_group),
        (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), p_candidate_workspace_id, 'Инвестиции', 'Бизнес'::category_group)
      ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING;

      RETURN QUERY SELECT p_candidate_user_id, p_candidate_workspace_id, true::BOOLEAN;
    END;
    $$;

    REVOKE ALL ON FUNCTION system_find_or_create_user(BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION system_find_or_create_user(BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) TO midas_app;
  `);
};

export const down = (pgm) => {
  // ── Revert columns ───────────────────────────────────────────────────────
  pgm.sql(`
    ALTER TABLE transaction_drafts DROP COLUMN IF EXISTS parsed_category_hint;
    ALTER TABLE transaction_drafts DROP COLUMN IF EXISTS item_name;
    ALTER TABLE transactions DROP COLUMN IF EXISTS item_name;
    ALTER TABLE workspaces DROP COLUMN IF EXISTS default_expense_account_id;
    ALTER TABLE workspaces DROP COLUMN IF EXISTS default_income_account_id;
  `);

  // Note: backfilled categories are NOT removed — they may have transactions linked.
  // Restore previous onboarding function (Phase 1.24 version with single "Разное" seed).
  pgm.sql(`
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

      INSERT INTO account_sources (id, workspace_id, name, type, currency)
        VALUES (
          p_candidate_account_id,
          p_candidate_workspace_id,
          'Default',
          'manual'::account_source_type,
          'USDT'
        )
        ON CONFLICT DO NOTHING;

      INSERT INTO categories (id, workspace_id, name, "group")
        VALUES (
          p_candidate_category_id,
          p_candidate_workspace_id,
          'Разное',
          'Жизнь'::category_group
        )
        ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING;

      RETURN QUERY SELECT p_candidate_user_id, p_candidate_workspace_id, true::BOOLEAN;
    END;
    $$;

    REVOKE ALL ON FUNCTION system_find_or_create_user(BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION system_find_or_create_user(BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) TO midas_app;
  `);
};
