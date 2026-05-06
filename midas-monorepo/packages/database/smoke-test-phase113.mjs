/**
 * Smoke Tests — Phase 1.13: /add_category Strict-Format Command
 *
 * Tests (14 scenarios):
 *
 * DB-backed tests (require live PostgreSQL):
 *   1. Valid /add_category creates category in DB
 *   2. Category names with spaces work correctly
 *   3. Invalid group is rejected (parse-level, no DB call)
 *   4. Empty name is rejected (parse-level, no DB call)
 *   5. Too-long name (>100 chars) is rejected (parse-level, no DB call)
 *   6. Duplicate name returns 'duplicate' — no second row inserted
 *   7. Tenant isolation: addCategory inserts only into current workspace
 *   8. RLS WITH CHECK: midas_app cannot INSERT into another workspace's categories
 *   9. /category (getCategoryList) shows the newly added category
 *
 * Logic-only tests (no DB required):
 *  10. /add_category is in KNOWN_COMMANDS (now 5 commands)
 *  11. HELP_TEXT includes /add_category line
 *  12. /add_categoryfoo is blocked (not in KNOWN_COMMANDS)
 *  13. /start, /report, /help, /category still in KNOWN_COMMANDS
 *  14. Normal free text returns null from parseCommandToken (goes to AI parse)
 *
 * SEC-03: Tests use withTenantTransaction pattern / explicit workspace_id
 *         to verify RLS isolation for INSERT.
 * SEC-12: No raw_text or PII in test output.
 */

import pg from 'pg';

const { Pool } = pg;

// ─────────────────────────────────────────────────────────────
// Test utilities
// ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  }
}

async function withPool(fn) {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://midas_user:midas_dev_password@localhost:5432/midas',
  });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

// ─────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────

function ulid() {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let result = '';
  for (let i = 0; i < 26; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Create a minimal workspace + user + membership using the privileged pool.
 * Returns { wsId, userId }.
 */
async function createWorkspaceFixture(pool) {
  const wsId = ulid();
  const userId = ulid();
  const membId = ulid();

  await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, $2)`, [wsId, `Test WS ${wsId.slice(0, 6)}`]);
  await pool.query(`INSERT INTO users (id, telegram_id) VALUES ($1, $2)`, [userId, BigInt(Math.floor(Math.random() * 1_000_000_000))]);
  await pool.query(`INSERT INTO workspace_memberships (id, workspace_id, user_id, role) VALUES ($1, $2, $3, 'owner')`, [membId, wsId, userId]);

  return { wsId, userId };
}

/**
 * Run addCategory logic: INSERT with RLS context via explicit SET LOCAL.
 * Mirrors the exact pattern used by category.service.ts / withTenantTransaction.
 * Returns rowCount.
 */
async function runAddCategory(pool, wsId, userId, group, name) {
  const categoryId = ulid();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [wsId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);

    const result = await client.query(
      `INSERT INTO categories (id, workspace_id, name, "group")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING
       RETURNING id`,
      [categoryId, wsId, name, group],
    );

    await client.query('COMMIT');
    return result.rowCount ?? 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Read categories for a workspace using RLS context.
 * Mirrors the exact pattern used by getCategoryList.
 */
async function runCategoryQuery(pool, wsId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [wsId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);

    const result = await client.query(
      `SELECT name, "group", color
       FROM categories
       WHERE workspace_id = $1
       ORDER BY "group", name`,
      [wsId],
    );

    await client.query('COMMIT');
    return result.rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────
// Inline logic mirrors — mirrors webhook.route.ts + category.service.ts
// ─────────────────────────────────────────────────────────────

const KNOWN_COMMANDS = new Set(['/start', '/report', '/help', '/category', '/add_category']);

function parseCommandToken(text) {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/')) return null;
  const token = trimmed.split(/\s+/)[0] ?? '';
  const atIdx = token.indexOf('@');
  return atIdx === -1 ? token : token.slice(0, atIdx);
}

const HELP_TEXT =
  'ℹ️ <b>Доступные команды Midas:</b>\n\n' +
  '/start — Регистрация и приветствие\n' +
  '/report — Отчёт о доходах и расходах за текущий месяц\n' +
  '/category — Список категорий вашего кошелька\n' +
  '/add_category <группа> <название> — Добавить категорию\n' +
  '/help — Показать это сообщение\n\n' +
  'Группы для /add_category: Бизнес, Жизнь\n' +
  'Пример: /add_category Жизнь Кофе\n\n' +
  'Для записи транзакции просто напишите мне сообщение, например:\n' +
  '<i>«Потратил 500 рублей на кофе»</i>';

const ALLOWED_GROUPS = {
  'бизнес': 'Бизнес',
  'жизнь': 'Жизнь',
};

const MAX_CATEGORY_NAME_LENGTH = 100;

function resolveGroup(rawGroup) {
  return ALLOWED_GROUPS[rawGroup.toLowerCase()] ?? null;
}

function parseAddCategoryArgs(text) {
  const trimmed = text.trim();
  const firstSpaceIdx = trimmed.search(/\s/);

  if (firstSpaceIdx === -1) {
    return {
      error:
        'Использование: /add_category <группа> <название>\n' +
        'Группы: Бизнес, Жизнь\n' +
        'Пример: /add_category Жизнь Кофе',
    };
  }

  const rest = trimmed.slice(firstSpaceIdx).trimStart();
  const secondSpaceIdx = rest.search(/\s/);

  if (secondSpaceIdx === -1) {
    return {
      error:
        'Использование: /add_category <группа> <название>\n' +
        'Группы: Бизнес, Жизнь\n' +
        'Пример: /add_category Жизнь Кофе',
    };
  }

  const groupToken = rest.slice(0, secondSpaceIdx);
  const rawName = rest.slice(secondSpaceIdx).trim();

  const canonicalGroup = resolveGroup(groupToken);
  if (canonicalGroup === null) {
    return {
      error:
        `Неизвестная группа: «${groupToken}».\n` +
        'Допустимые группы: Бизнес, Жизнь.',
    };
  }

  if (rawName.length === 0) {
    return {
      error:
        'Название категории не может быть пустым.\n' +
        'Пример: /add_category Жизнь Кофе',
    };
  }

  if (rawName.length > MAX_CATEGORY_NAME_LENGTH) {
    return {
      error:
        `Название категории слишком длинное (максимум ${String(MAX_CATEGORY_NAME_LENGTH)} символов).`,
    };
  }

  return { canonicalGroup, name: rawName };
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🔍 Phase 1.13 Smoke Tests — /add_category Strict-Format Command\n');

  // ───────────────────────────────────────────────────────────
  // Logic-only tests (no DB required)
  // ───────────────────────────────────────────────────────────

  // TEST 10: /add_category is in KNOWN_COMMANDS (5 commands total)
  console.log('\n[TEST 10] /add_category is in KNOWN_COMMANDS (5 commands)');
  {
    assert(KNOWN_COMMANDS.has('/add_category'), '/add_category in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.has('/start'), '/start still in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.has('/report'), '/report still in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.has('/help'), '/help still in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.has('/category'), '/category still in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.size === 5, `KNOWN_COMMANDS has 5 entries (got: ${KNOWN_COMMANDS.size})`);
  }

  // TEST 11: HELP_TEXT includes /add_category
  console.log('\n[TEST 11] HELP_TEXT includes /add_category');
  {
    assert(HELP_TEXT.includes('/add_category'), 'HELP_TEXT contains /add_category');
    assert(HELP_TEXT.includes('/start'), 'HELP_TEXT still contains /start');
    assert(HELP_TEXT.includes('/report'), 'HELP_TEXT still contains /report');
    assert(HELP_TEXT.includes('/category'), 'HELP_TEXT still contains /category');
    assert(HELP_TEXT.includes('/help'), 'HELP_TEXT still contains /help');
    assert(HELP_TEXT.includes('Бизнес'), 'HELP_TEXT mentions Бизнес group');
    assert(HELP_TEXT.includes('Жизнь'), 'HELP_TEXT mentions Жизнь group');
  }

  // TEST 12: /add_categoryfoo is blocked (not in KNOWN_COMMANDS)
  console.log('\n[TEST 12] /add_categoryfoo is blocked as unknown command');
  {
    assert(parseCommandToken('/add_categoryfoo') === '/add_categoryfoo', '/add_categoryfoo → /add_categoryfoo (exact token)');
    assert(!KNOWN_COMMANDS.has('/add_categoryfoo'), '/add_categoryfoo NOT in KNOWN_COMMANDS → guard fires');
    assert(!KNOWN_COMMANDS.has('/add_category_foo'), '/add_category_foo NOT in KNOWN_COMMANDS → guard fires');
    assert(!KNOWN_COMMANDS.has('/add'), '/add NOT in KNOWN_COMMANDS → guard fires');
  }

  // TEST 13: /start, /report, /help, /category still work (regression)
  console.log('\n[TEST 13] /start, /report, /help, /category still in KNOWN_COMMANDS (regression)');
  {
    assert(parseCommandToken('/start') === '/start', '/start → /start');
    assert(parseCommandToken('/report') === '/report', '/report → /report');
    assert(parseCommandToken('/help') === '/help', '/help → /help');
    assert(parseCommandToken('/category') === '/category', '/category → /category');
    assert(parseCommandToken('/add_category Жизнь Кофе') === '/add_category', '/add_category Жизнь Кофе → /add_category (first token)');
    assert(parseCommandToken('/add_category@MidasBot Жизнь Кофе') === '/add_category', '/add_category@MidasBot → /add_category (botname strip)');
  }

  // TEST 14: Normal free text returns null → goes to AI parse (regression)
  console.log('\n[TEST 14] Normal free text returns null → still goes to AI parse');
  {
    assert(parseCommandToken('Потратил 500 рублей на кофе') === null, 'free text → null (AI parse path)');
    assert(parseCommandToken('расходы на такси') === null, 'free text (no slash) → null');
    assert(parseCommandToken('add_category Жизнь Кофе') === null, 'no leading slash → null (AI parse)');
  }

  // TEST 3: Invalid group is rejected at parse level
  console.log('\n[TEST 3] Invalid group is rejected at parse level (no DB call needed)');
  {
    const r1 = parseAddCategoryArgs('/add_category Работа Зарплата');
    assert('error' in r1, 'Unknown group "Работа" → error');
    assert('error' in r1 && r1.error.includes('Неизвестная группа'), 'Error message mentions "Неизвестная группа"');
    assert('error' in r1 && r1.error.includes('Работа'), 'Error message echoes the invalid group');

    const r2 = parseAddCategoryArgs('/add_category lifestyle Coffee');
    assert('error' in r2, 'English group "lifestyle" → error');

    const r3 = parseAddCategoryArgs('/add_category Бизнес Реклама');
    assert(!('error' in r3), 'Valid group "Бизнес" → no error');
    if (!('error' in r3)) {
      assert(r3.canonicalGroup === 'Бизнес', 'Бизнес → canonical Бизнес');
    }

    const r4 = parseAddCategoryArgs('/add_category жизнь Кофе');
    assert(!('error' in r4), 'Lowercase "жизнь" → no error (case-insensitive)');
    if (!('error' in r4)) {
      assert(r4.canonicalGroup === 'Жизнь', 'жизнь → canonical Жизнь');
    }

    const r5 = parseAddCategoryArgs('/add_category БИЗНЕС Реклама');
    assert(!('error' in r5), 'Uppercase "БИЗНЕС" → no error (case-insensitive)');
    if (!('error' in r5)) {
      assert(r5.canonicalGroup === 'Бизнес', 'БИЗНЕС → canonical Бизнес');
    }
  }

  // TEST 4: Empty name is rejected at parse level
  console.log('\n[TEST 4] Empty/missing name is rejected at parse level');
  {
    // No arguments at all
    const r1 = parseAddCategoryArgs('/add_category');
    assert('error' in r1, 'No args → error');

    // Group given but no name
    const r2 = parseAddCategoryArgs('/add_category Жизнь');
    assert('error' in r2, 'Group only (no name) → error');

    // Group + whitespace only (no real name after trim)
    // Note: parseAddCategoryArgs trims the name, so "  " becomes ""
    const r3 = parseAddCategoryArgs('/add_category Жизнь   ');
    // After trimming rest of args: "   " → trim → "" → rejected
    assert('error' in r3, 'Group + whitespace only → error (empty name after trim)');
  }

  // TEST 5: Too-long name (>100 chars) is rejected at parse level
  console.log('\n[TEST 5] Too-long name (>100 chars) is rejected at parse level');
  {
    const longName = 'А'.repeat(101);
    const r = parseAddCategoryArgs(`/add_category Жизнь ${longName}`);
    assert('error' in r, '101-char name → error');
    assert('error' in r && r.error.includes('100'), 'Error message mentions 100');

    const exactName = 'А'.repeat(100);
    const r2 = parseAddCategoryArgs(`/add_category Жизнь ${exactName}`);
    assert(!('error' in r2), '100-char name → no error (exactly at limit)');

    const shortName = 'Кофе';
    const r3 = parseAddCategoryArgs(`/add_category Жизнь ${shortName}`);
    assert(!('error' in r3), 'Short name → no error');
    if (!('error' in r3)) {
      assert(r3.name === shortName, `Name parsed correctly: "${r3.name}"`);
    }
  }

  // ───────────────────────────────────────────────────────────
  // DB-backed tests
  // ───────────────────────────────────────────────────────────

  await withPool(async (pool) => {
    // TEST 1: Valid /add_category creates category in DB
    console.log('\n[TEST 1] Valid /add_category creates category in DB');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      const rowCount = await runAddCategory(pool, wsId, userId, 'Жизнь', 'Кофе');
      assert(rowCount === 1, `INSERT returned rowCount=1 (got: ${rowCount})`);

      // Verify it is in the DB
      const rows = await runCategoryQuery(pool, wsId, userId);
      assert(rows.length === 1, `1 category in DB after insert (got: ${rows.length})`);
      assert(rows[0].name === 'Кофе', `Category name is 'Кофе' (got: ${rows[0]?.name})`);
      assert(rows[0].group === 'Жизнь', `Category group is 'Жизнь' (got: ${rows[0]?.group})`);
    }

    // TEST 2: Category names with spaces work correctly
    console.log('\n[TEST 2] Category names with spaces work correctly');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      const nameWithSpaces = 'Продукты питания';
      const rowCount = await runAddCategory(pool, wsId, userId, 'Жизнь', nameWithSpaces);
      assert(rowCount === 1, `INSERT with spaces returned rowCount=1 (got: ${rowCount})`);

      const rows = await runCategoryQuery(pool, wsId, userId);
      assert(rows.length === 1, `1 category in DB (got: ${rows.length})`);
      assert(rows[0].name === nameWithSpaces, `Name with spaces preserved: "${rows[0]?.name}"`);

      // Verify parseAddCategoryArgs handles names with spaces
      const parsed = parseAddCategoryArgs(`/add_category Жизнь ${nameWithSpaces}`);
      assert(!('error' in parsed), 'parseAddCategoryArgs accepts name with spaces');
      if (!('error' in parsed)) {
        assert(parsed.name === nameWithSpaces, `Parsed name with spaces: "${parsed.name}"`);
        assert(parsed.canonicalGroup === 'Жизнь', 'Group correctly parsed');
      }
    }

    // TEST 6: Duplicate name returns 'duplicate' — no second row inserted
    console.log('\n[TEST 6] Duplicate name returns 0 rowCount — no second row inserted');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      const name = 'Кофе';

      // First insert — should succeed
      const first = await runAddCategory(pool, wsId, userId, 'Жизнь', name);
      assert(first === 1, `First insert: rowCount=1 (got: ${first})`);

      // Second insert (same workspace, same name) — should be a conflict
      const second = await runAddCategory(pool, wsId, userId, 'Жизнь', name);
      assert(second === 0, `Duplicate insert: rowCount=0 (got: ${second}) — ON CONFLICT DO NOTHING`);

      // Verify only one row exists in DB
      const rows = await runCategoryQuery(pool, wsId, userId);
      assert(rows.length === 1, `Only 1 category row in DB after duplicate (got: ${rows.length})`);

      // Duplicate with different group (same name, different group — still conflicts on workspace_id+name)
      const third = await runAddCategory(pool, wsId, userId, 'Бизнес', name);
      assert(third === 0, `Duplicate name (different group): rowCount=0 (constraint is workspace_id+name)`);
      const rowsAfterThird = await runCategoryQuery(pool, wsId, userId);
      assert(rowsAfterThird.length === 1, `Still only 1 category after 3rd insert (got: ${rowsAfterThird.length})`);
    }

    // TEST 7: Tenant isolation — addCategory inserts only into current workspace
    console.log('\n[TEST 7] Tenant isolation: addCategory inserts only into current workspace');
    {
      const ws1 = await createWorkspaceFixture(pool);
      const ws2 = await createWorkspaceFixture(pool);

      await runAddCategory(pool, ws1.wsId, ws1.userId, 'Жизнь', 'WS1-Кофе');
      await runAddCategory(pool, ws2.wsId, ws2.userId, 'Бизнес', 'WS2-Реклама');

      const rows1 = await runCategoryQuery(pool, ws1.wsId, ws1.userId);
      assert(rows1.length === 1, `ws1 sees 1 category (got: ${rows1.length})`);
      assert(rows1[0].name === 'WS1-Кофе', `ws1 sees its own category (got: ${rows1[0]?.name})`);
      const ws2Cat = rows1.find((r) => r.name === 'WS2-Реклама');
      assert(!ws2Cat, 'ws1 does NOT see ws2 category');

      const rows2 = await runCategoryQuery(pool, ws2.wsId, ws2.userId);
      assert(rows2.length === 1, `ws2 sees 1 category (got: ${rows2.length})`);
      assert(rows2[0].name === 'WS2-Реклама', `ws2 sees its own category (got: ${rows2[0]?.name})`);
      const ws1Cat = rows2.find((r) => r.name === 'WS1-Кофе');
      assert(!ws1Cat, 'ws2 does NOT see ws1 category');
    }

    // TEST 8: RLS WITH CHECK — INSERT into wrong workspace is blocked by midas_app role
    // midas_user has BYPASSRLS=true (test fixture role). We must use midas_app (BYPASSRLS=false)
    // to verify the RLS WITH CHECK policy truly blocks cross-tenant INSERTs.
    console.log('\n[TEST 8] RLS WITH CHECK: INSERT into wrong workspace_id is blocked (midas_app role)');
    {
      const ws1 = await createWorkspaceFixture(pool);
      const ws2 = await createWorkspaceFixture(pool);

      // Open a separate connection pool using midas_app role (BYPASSRLS=false)
      // This is the role the actual application uses.
      const appPool = new Pool({
        connectionString:
          process.env.APP_DATABASE_URL ??
          'postgresql://midas_app:midas_app_password@localhost:5432/midas',
      });

      let insertError = null;
      let rowCount = 0;

      try {
        // Set RLS context for ws1, but try to INSERT into ws2
        // The RLS WITH CHECK policy: workspace_id = current_workspace_id()
        // An INSERT with workspace_id = ws2.wsId while context is ws1 must fail
        const catId = ulid();
        const appClient = await appPool.connect();
        try {
          await appClient.query('BEGIN');
          await appClient.query("SELECT set_config('app.workspace_id', $1, true)", [ws1.wsId]);
          await appClient.query("SELECT set_config('app.user_id', $1, true)", [ws1.userId]);

          // Attempt cross-tenant INSERT (ws2.wsId while context is ws1)
          const result = await appClient.query(
            `INSERT INTO categories (id, workspace_id, name, "group")
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [catId, ws2.wsId, 'Cross-Tenant-Attack', 'Жизнь'],
          );
          rowCount = result.rowCount ?? 0;
          await appClient.query('COMMIT');
        } catch (err) {
          await appClient.query('ROLLBACK');
          insertError = err;
        } finally {
          appClient.release();
        }
      } finally {
        await appPool.end();
      }

      // RLS WITH CHECK should block: either throw a policy violation error or return 0 rows
      const isBlocked = insertError !== null || rowCount === 0;
      assert(isBlocked, 'RLS WITH CHECK: cross-tenant INSERT blocked via midas_app role (threw or rowCount=0)');

      // Verify ws2 has no rogue category (using privileged pool for verification)
      const rows2 = await runCategoryQuery(pool, ws2.wsId, ws2.userId);
      const rogueCat = rows2.find((r) => r.name === 'Cross-Tenant-Attack');
      assert(!rogueCat, 'ws2 has no cross-tenant category (RLS WITH CHECK protection confirmed)');
    }

    // TEST 9: /category (getCategoryList) shows newly added category
    console.log('\n[TEST 9] /category shows newly added category');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);

      // Verify empty state before add
      const rowsBefore = await runCategoryQuery(pool, wsId, userId);
      assert(rowsBefore.length === 0, 'Empty workspace: 0 categories before add');

      // Add a category
      await runAddCategory(pool, wsId, userId, 'Бизнес', 'Новая категория');

      // Verify it appears in list
      const rowsAfter = await runCategoryQuery(pool, wsId, userId);
      assert(rowsAfter.length === 1, '1 category after add (got: ' + rowsAfter.length + ')');
      assert(rowsAfter[0].name === 'Новая категория', `Correct name in list: ${rowsAfter[0]?.name}`);
      assert(rowsAfter[0].group === 'Бизнес', `Correct group in list: ${rowsAfter[0]?.group}`);

      // Add a second category in a different group
      await runAddCategory(pool, wsId, userId, 'Жизнь', 'Кофе');
      const rowsFinal = await runCategoryQuery(pool, wsId, userId);
      assert(rowsFinal.length === 2, '2 categories after two adds (got: ' + rowsFinal.length + ')');
      const names = rowsFinal.map((r) => r.name);
      assert(names.includes('Новая категория'), 'First category still visible');
      assert(names.includes('Кофе'), 'Second category visible');
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

runTests()
  .then(() => {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Phase 1.13 Smoke Tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error('\n❌ SMOKE TEST FAILED');
      process.exit(1);
    } else {
      console.log('\n✅ ALL SMOKE TESTS PASSED');
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error('\n💥 Smoke test runner crashed:', err);
    process.exit(1);
  });
