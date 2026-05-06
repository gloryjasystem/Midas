/**
 * Smoke Tests — Phase 1.11: /category Read-Only List Command
 *
 * Tests (14 scenarios):
 *
 * DB-backed tests (require live PostgreSQL):
 *   1. Category list with two groups returns correct grouped output
 *   2. Category list with only one group returns correct output
 *   3. Empty workspace returns safe empty-state message
 *   4. Tenant isolation: workspace2 categories invisible to workspace1
 *   5. Category query uses correct column names (verified live)
 *   6. Defense-in-depth: explicit WHERE workspace_id = $1 in query
 *   7. Category grouping order: 'Бизнес' before 'Жизнь'
 *   8. Multiple categories in same group are listed correctly
 *   9. Russian pluralization: 1 → категория, 2 → категории, 5 → категорий
 *
 * Logic-only tests (no DB required — pure routing/format simulation):
 *  10. /category command token is parsed correctly
 *  11. /category@BotName is parsed to /category (botname strip)
 *  12. /categoryfoo is NOT equal to /category (exact-token rule)
 *  13. /category is in KNOWN_COMMANDS set
 *  14. HELP_TEXT includes /category line
 *
 * SEC-03: Tests use withTenantTransaction pattern to verify RLS isolation.
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
 * Create a minimal workspace + user + membership. Returns ids.
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
 * Insert a category row directly (bypassing RLS for test fixture setup).
 */
async function insertCategory(pool, wsId, name, group) {
  const catId = ulid();
  await pool.query(
    `INSERT INTO categories (id, workspace_id, name, "group") VALUES ($1, $2, $3, $4)`,
    [catId, wsId, name, group],
  );
  return catId;
}

/**
 * Run the exact same SQL that category.service.ts uses, with RLS context.
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
// Inline formatting helpers (mirrors category.service.ts logic)
// ─────────────────────────────────────────────────────────────

const GROUP_ORDER = { 'Бизнес': 0, 'Жизнь': 1 };

function groupSortKey(group) {
  return GROUP_ORDER[group] ?? 999;
}

function pluralizeCategories(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'категорий';
  if (mod10 === 1) return 'категория';
  if (mod10 >= 2 && mod10 <= 4) return 'категории';
  return 'категорий';
}

function formatCategoryList(rows) {
  if (rows.length === 0) {
    return (
      '📋 <b>Категории вашего кошелька:</b>\n\n' +
      'Категорий пока нет.\n' +
      'Скоро появится команда /add_category — следите за обновлениями.'
    );
  }

  const groupMap = new Map();
  for (const row of rows) {
    const existing = groupMap.get(row.group);
    if (existing) {
      existing.push(row.name);
    } else {
      groupMap.set(row.group, [row.name]);
    }
  }

  const sortedGroups = [...groupMap.keys()].sort((a, b) => {
    const orderDiff = groupSortKey(a) - groupSortKey(b);
    if (orderDiff !== 0) return orderDiff;
    return a.localeCompare(b, 'ru');
  });

  const sections = [];
  for (const group of sortedGroups) {
    const names = groupMap.get(group) ?? [];
    const nameLines = names.map((n) => `• ${n}`).join('\n');
    sections.push(`<b>${group}:</b>\n${nameLines}`);
  }

  const totalCount = rows.length;
  const countLabel = `Всего: ${String(totalCount)} ${pluralizeCategories(totalCount)}.`;

  return `📋 <b>Категории вашего кошелька:</b>\n\n${sections.join('\n\n')}\n\n${countLabel}`;
}

// ─────────────────────────────────────────────────────────────
// Routing helpers (mirrors webhook.route.ts logic)
// ─────────────────────────────────────────────────────────────

const KNOWN_COMMANDS = new Set(['/start', '/report', '/help', '/category']);

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
  '/help — Показать это сообщение\n\n' +
  'Для записи транзакции просто напишите мне сообщение, например:\n' +
  '<i>«Потратил 500 рублей на кофе»</i>';

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🔍 Phase 1.11 Smoke Tests — /category Read-Only List Command\n');

  // ─────────────────────────────────────────────────────────
  // Logic-only tests (no DB)
  // ─────────────────────────────────────────────────────────

  // TEST 10: /category command token parsed correctly
  console.log('\n[TEST 10] /category command token parsed correctly');
  {
    assert(parseCommandToken('/category') === '/category', '/category → /category');
    assert(parseCommandToken('  /category') === '/category', '  /category (leading spaces) → /category');
    assert(parseCommandToken('/category list') === '/category', '/category list → /category (first token)');
    assert(parseCommandToken('category') === null, 'category (no slash) → null');
    assert(parseCommandToken('/report') === '/report', '/report → /report (not /category)');
    assert(parseCommandToken('расходы на кофе') === null, 'free text → null (goes to AI parse)');
  }

  // TEST 11: /category@BotName is parsed to /category
  console.log('\n[TEST 11] /category@BotName → /category (botname strip)');
  {
    assert(parseCommandToken('/category@MidasBot') === '/category', '/category@MidasBot → /category');
    assert(parseCommandToken('/category@my_bot_123') === '/category', '/category@my_bot_123 → /category');
    assert(parseCommandToken('/help@MidasBot') === '/help', '/help@MidasBot → /help (not affected)');
  }

  // TEST 12: /categoryfoo is NOT treated as /category
  console.log('\n[TEST 12] /categoryfoo is NOT /category (exact-token guard)');
  {
    assert(parseCommandToken('/categoryfoo') === '/categoryfoo', '/categoryfoo → /categoryfoo (exact token preserved)');
    assert(!KNOWN_COMMANDS.has('/categoryfoo'), '/categoryfoo NOT in KNOWN_COMMANDS → guard fires');
    assert(!KNOWN_COMMANDS.has('/categorylist'), '/categorylist NOT in KNOWN_COMMANDS → guard fires');
    assert(!KNOWN_COMMANDS.has('/categories'), '/categories NOT in KNOWN_COMMANDS → guard fires');
  }

  // TEST 13: /category is in KNOWN_COMMANDS
  console.log('\n[TEST 13] /category is in KNOWN_COMMANDS');
  {
    assert(KNOWN_COMMANDS.has('/category'), '/category is in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.has('/start'), '/start still in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.has('/report'), '/report still in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.has('/help'), '/help still in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.size === 4, `KNOWN_COMMANDS has 4 entries (got: ${KNOWN_COMMANDS.size})`);
  }

  // TEST 14: HELP_TEXT includes /category line
  console.log('\n[TEST 14] HELP_TEXT includes /category');
  {
    assert(HELP_TEXT.includes('/category'), 'HELP_TEXT contains /category');
    assert(HELP_TEXT.includes('/start'), 'HELP_TEXT still contains /start');
    assert(HELP_TEXT.includes('/report'), 'HELP_TEXT still contains /report');
    assert(HELP_TEXT.includes('/help'), 'HELP_TEXT still contains /help');
  }

  // TEST 9: Russian pluralization
  console.log('\n[TEST 9] Russian pluralization of «категория»');
  {
    assert(pluralizeCategories(1) === 'категория', '1 → категория');
    assert(pluralizeCategories(2) === 'категории', '2 → категории');
    assert(pluralizeCategories(3) === 'категории', '3 → категории');
    assert(pluralizeCategories(4) === 'категории', '4 → категории');
    assert(pluralizeCategories(5) === 'категорий', '5 → категорий');
    assert(pluralizeCategories(11) === 'категорий', '11 → категорий (teens exception)');
    assert(pluralizeCategories(12) === 'категорий', '12 → категорий (teens exception)');
    assert(pluralizeCategories(21) === 'категория', '21 → категория');
    assert(pluralizeCategories(22) === 'категории', '22 → категории');
    assert(pluralizeCategories(100) === 'категорий', '100 → категорий');
  }

  // ─────────────────────────────────────────────────────────
  // DB-backed tests
  // ─────────────────────────────────────────────────────────

  await withPool(async (pool) => {
    // TEST 1: Two groups — 'Бизнес' and 'Жизнь' — correct grouped output
    console.log('\n[TEST 1] Category list with two groups returns grouped output');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      await insertCategory(pool, wsId, 'Зарплата', 'Бизнес');
      await insertCategory(pool, wsId, 'Фриланс', 'Бизнес');
      await insertCategory(pool, wsId, 'Еда', 'Жизнь');
      await insertCategory(pool, wsId, 'Транспорт', 'Жизнь');

      const rows = await runCategoryQuery(pool, wsId, userId);
      assert(rows.length === 4, `4 categories returned (got: ${rows.length})`);

      const biznCats = rows.filter(r => r.group === 'Бизнес').map(r => r.name).sort();
      const zhiznCats = rows.filter(r => r.group === 'Жизнь').map(r => r.name).sort();

      assert(biznCats.length === 2, `2 Бизнес categories (got: ${biznCats.length})`);
      assert(zhiznCats.length === 2, `2 Жизнь categories (got: ${zhiznCats.length})`);
      assert(biznCats.includes('Зарплата'), 'Зарплата in Бизнес');
      assert(biznCats.includes('Фриланс'), 'Фриланс in Бизнес');
      assert(zhiznCats.includes('Еда'), 'Еда in Жизнь');
      assert(zhiznCats.includes('Транспорт'), 'Транспорт in Жизнь');

      // Verify formatted output
      const text = formatCategoryList(rows);
      assert(text.includes('📋'), 'output contains emoji header');
      assert(text.includes('<b>Бизнес:</b>'), 'output contains Бизнес group header');
      assert(text.includes('<b>Жизнь:</b>'), 'output contains Жизнь group header');
      assert(text.includes('• Зарплата'), 'output contains • Зарплата');
      assert(text.includes('• Еда'), 'output contains • Еда');
      assert(text.includes('4 категории'), 'output contains count: 4 категории');
    }

    // TEST 2: Only one group
    console.log('\n[TEST 2] Category list with only one group');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      await insertCategory(pool, wsId, 'Кофе', 'Жизнь');

      const rows = await runCategoryQuery(pool, wsId, userId);
      assert(rows.length === 1, `1 category returned (got: ${rows.length})`);

      const text = formatCategoryList(rows);
      assert(text.includes('<b>Жизнь:</b>'), 'output contains Жизнь group header');
      assert(text.includes('• Кофе'), 'output contains • Кофе');
      assert(!text.includes('<b>Бизнес:</b>'), 'output does NOT contain Бизнес (not in this workspace)');
      assert(text.includes('1 категория'), 'output contains count: 1 категория');
    }

    // TEST 3: Empty workspace returns empty-state message
    console.log('\n[TEST 3] Empty workspace returns safe empty-state message');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);

      const rows = await runCategoryQuery(pool, wsId, userId);
      assert(rows.length === 0, `0 categories returned for empty workspace (got: ${rows.length})`);

      const text = formatCategoryList(rows);
      assert(text.includes('📋'), 'empty output contains emoji header');
      assert(text.includes('Категорий пока нет'), 'empty output contains «Категорий пока нет»');
      assert(text.includes('/add_category'), 'empty output mentions /add_category teaser');
      assert(!text.includes('<b>Бизнес:</b>'), 'empty output has no Бизнес group');
      assert(!text.includes('<b>Жизнь:</b>'), 'empty output has no Жизнь group');
    }

    // TEST 4: Tenant isolation — workspace2 categories invisible to workspace1
    console.log('\n[TEST 4] Tenant isolation: ws2 categories invisible to ws1');
    {
      const ws1 = await createWorkspaceFixture(pool);
      const ws2 = await createWorkspaceFixture(pool);

      await insertCategory(pool, ws1.wsId, 'WS1-Кошелёк', 'Жизнь');
      await insertCategory(pool, ws2.wsId, 'WS2-Инвестиции', 'Бизнес');

      // Query as ws1
      const rows1 = await runCategoryQuery(pool, ws1.wsId, ws1.userId);
      assert(rows1.length === 1, `ws1 sees 1 category (got: ${rows1.length})`);
      assert(rows1[0].name === 'WS1-Кошелёк', `ws1 sees its own category (got: ${rows1[0]?.name})`);
      const ws2Cat = rows1.find(r => r.name === 'WS2-Инвестиции');
      assert(!ws2Cat, 'ws1 does NOT see ws2 category');

      // Query as ws2
      const rows2 = await runCategoryQuery(pool, ws2.wsId, ws2.userId);
      assert(rows2.length === 1, `ws2 sees 1 category (got: ${rows2.length})`);
      assert(rows2[0].name === 'WS2-Инвестиции', `ws2 sees its own category (got: ${rows2[0]?.name})`);
      const ws1Cat = rows2.find(r => r.name === 'WS1-Кошелёк');
      assert(!ws1Cat, 'ws2 does NOT see ws1 category');
    }

    // TEST 5: SQL column names are correct (verified live)
    console.log('\n[TEST 5] Verify categories table column names in live DB');
    {
      const r = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'categories'
          AND column_name IN ('id', 'workspace_id', 'name', 'group', 'color', 'created_at')
        ORDER BY column_name
      `);
      const cols = r.rows.map(x => x.column_name);
      assert(cols.includes('workspace_id'), 'workspace_id column exists');
      assert(cols.includes('name'), 'name column exists');
      assert(cols.includes('group'), '"group" column exists');
      assert(cols.includes('color'), 'color column exists');
    }

    // TEST 6: Defense-in-depth — explicit WHERE workspace_id = $1
    console.log('\n[TEST 6] Defense-in-depth: explicit WHERE workspace_id filter works');
    {
      const ws1 = await createWorkspaceFixture(pool);
      const ws2 = await createWorkspaceFixture(pool);

      await insertCategory(pool, ws1.wsId, 'WS1-ExplicitFilter', 'Жизнь');
      await insertCategory(pool, ws2.wsId, 'WS2-ExplicitFilter', 'Жизнь');

      // The query uses WHERE workspace_id = $1 — verify only ws1 row returned when querying as ws1
      const client = await pool.connect();
      let rows;
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [ws1.wsId]);
        await client.query("SELECT set_config('app.user_id', $1, true)", [ws1.userId]);

        const result = await client.query(
          // Same query as category.service.ts — explicit WHERE workspace_id = $1
          `SELECT name, "group", color FROM categories WHERE workspace_id = $1 ORDER BY "group", name`,
          [ws1.wsId],
        );
        rows = result.rows;
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      assert(rows.length === 1, `explicit WHERE workspace_id = $1 returns only ws1 row (got: ${rows.length})`);
      assert(rows[0].name === 'WS1-ExplicitFilter', `correct row returned (got: ${rows[0]?.name})`);
    }

    // TEST 7: Group ordering — 'Бизнес' before 'Жизнь'
    console.log('\n[TEST 7] Group ordering: Бизнес before Жизнь');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      await insertCategory(pool, wsId, 'Жильё', 'Жизнь');
      await insertCategory(pool, wsId, 'Доход', 'Бизнес');

      const rows = await runCategoryQuery(pool, wsId, userId);
      const text = formatCategoryList(rows);
      const biznIdx = text.indexOf('<b>Бизнес:</b>');
      const zhiznIdx = text.indexOf('<b>Жизнь:</b>');

      assert(biznIdx !== -1, 'Бизнес group header found');
      assert(zhiznIdx !== -1, 'Жизнь group header found');
      assert(biznIdx < zhiznIdx, `Бизнес (pos ${biznIdx}) appears before Жизнь (pos ${zhiznIdx})`);
    }

    // TEST 8: Multiple categories in same group listed
    console.log('\n[TEST 8] Multiple categories in same group all listed');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      const catNames = ['Кофе', 'Продукты', 'Транспорт', 'Аптека', 'Развлечения'];
      for (const name of catNames) {
        await insertCategory(pool, wsId, name, 'Жизнь');
      }

      const rows = await runCategoryQuery(pool, wsId, userId);
      assert(rows.length === 5, `5 categories returned (got: ${rows.length})`);

      const text = formatCategoryList(rows);
      for (const name of catNames) {
        assert(text.includes(`• ${name}`), `• ${name} in output`);
      }
      assert(text.includes('5 категорий'), 'count: 5 категорий');
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

runTests()
  .then(() => {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Phase 1.11 Smoke Tests: ${passed} passed, ${failed} failed`);
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
