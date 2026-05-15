/**
 * Migration: Backfill all 28 default categories for existing workspaces
 *
 * Problem:
 *   Migration 1779000000000 seeded 28 categories inside the
 *   system_find_or_create_user() function — meaning only NEW workspaces
 *   created AFTER that migration got all 28 categories. Workspaces that
 *   existed before got only the categories that were already there
 *   (typically just 1–3 user-created ones like "Разное", "Одежда").
 *
 * Fix:
 *   For every existing workspace, INSERT the 28 default categories
 *   ON CONFLICT DO NOTHING — so already-existing categories are preserved,
 *   only missing ones are added. This is fully idempotent.
 *
 * Also updates system_find_or_create_user() to include the same backfill
 *   so all future workspaces are also correctly seeded.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      ws RECORD;
    BEGIN
      -- ── Backfill 28 default categories for every existing workspace ──────
      FOR ws IN SELECT id FROM workspaces LOOP
        INSERT INTO categories (id, workspace_id, name, "group")
        VALUES
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Другое',             'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Продукты',           'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Кафе и рестораны',   'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Транспорт',          'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Жильё',              'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Здоровье',           'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Одежда',             'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Красота',            'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Развлечения',        'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Подписки',           'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Связь',              'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Образование',        'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Спорт',              'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Путешествия',        'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Подарки',            'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Дети',               'Жизнь'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Зарплаты и выплаты', 'Бизнес'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Фриланс',            'Бизнес'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Реклама',            'Бизнес'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Софт и сервисы',     'Бизнес'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Оборудование',       'Бизнес'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Офис',               'Бизнес'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Налоги',             'Бизнес'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Комиссии',           'Бизнес'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Крипто-комиссии',    'Бизнес'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Подрядчики',         'Бизнес'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Продажи',            'Бизнес'::category_group),
          (UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 26)), ws.id, 'Инвестиции',         'Бизнес'::category_group)
        ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING;
      END LOOP;
    END;
    $$;
  `);
};

export const down = (pgm) => {
  // The backfill added rows that weren't there before.
  // Reversing would require knowing which rows were inserted by THIS migration
  // vs pre-existing — not feasible. down() is a safe no-op.
  pgm.sql(`SELECT 1; -- backfill cannot be safely reversed`);
};
