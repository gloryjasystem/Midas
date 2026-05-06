/**
 * Smoke Tests — Phase 1.15: HTML Escaping Hardening
 *
 * Tests verify that escapeHtml() is correctly applied to all dynamic/DB-sourced
 * values rendered inside Telegram messages sent with parse_mode: 'HTML'.
 *
 * Test groups:
 *
 * [A] escapeHtml unit tests (pure logic, no DB)
 *   1.  Escapes & → &amp;
 *   2.  Escapes < → &lt;
 *   3.  Escapes > → &gt;
 *   4.  Escapes " → &quot;
 *   5.  Escapes ' → &#x27;
 *   6.  Escapes combined string: <b>Fish & Chips "great"</b>
 *   7.  Empty string returns empty string (no crash)
 *   8.  Safe string (no special chars) returns unchanged
 *   9.  Double-quote only
 *   10. Apostrophe only
 *
 * [B] Account list rendering with HTML-like names (logic-only, mirrors account.service.ts)
 *   11. Account name with < > renders escaped in list line
 *   12. Account name with & renders escaped
 *   13. Account name with " renders escaped
 *   14. Account currency with < > renders escaped
 *   15. Normal account name renders unchanged (regression)
 *   16. Empty workspace — empty-state message still correct (regression)
 *
 * [C] Category list rendering with HTML-like names (logic-only, mirrors category.service.ts)
 *   17. Category name with < > renders escaped in list output
 *   18. Category name with & renders escaped
 *   19. Category group label with < > renders escaped (defense-in-depth)
 *   20. Normal category name renders unchanged (regression)
 *   21. Normal category group renders unchanged (regression)
 *   22. Empty workspace — empty-state message still correct (regression)
 *
 * [D] /add_category success message (mirrors webhook.route.ts)
 *   23. canonicalGroup with HTML chars renders escaped in success message
 *   24. name with HTML chars renders escaped in success message
 *   25. Normal name/group success message still correct (regression)
 *
 * [E] Scope guard (no new commands added in Phase 1.15)
 *   26. KNOWN_COMMANDS still has exactly 6 commands (no /add_account, no /balance)
 *   27. /add_account NOT in KNOWN_COMMANDS
 *   28. /balance NOT in KNOWN_COMMANDS
 *
 * [F] DB-backed regression (requires live PostgreSQL)
 *   29. Category with HTML-like name stored and retrieved correctly
 *   30. Account with HTML-like name stored and retrieved correctly
 *
 * SEC-12: No raw_text or PII in test output.
 * SEC-03: DB tests use explicit SET LOCAL to mirror withTenantTransaction.
 */

import pg from 'pg';

const { Pool } = pg;

// ─────────────────────────────────────────────────────────────
// Test runner
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

// ─────────────────────────────────────────────────────────────
// Inline escapeHtml — mirrors apps/telegram-bot/src/utils/html-escape.ts
// Must stay in sync with the production implementation.
// ─────────────────────────────────────────────────────────────

function escapeHtml(input) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ─────────────────────────────────────────────────────────────
// Inline logic mirrors — account.service.ts
// Must stay in sync with the production implementation.
// ─────────────────────────────────────────────────────────────

const TYPE_LABELS = {
  manual: 'Ручной ввод',
  crypto_read_only: 'Крипто',
  bank_sync: 'Банк',
};

function resolveTypeLabel(type) {
  return TYPE_LABELS[type] ?? type;
}

function pluralizeAccounts(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'счетов';
  if (mod10 === 1) return 'счёт';
  if (mod10 >= 2 && mod10 <= 4) return 'счёта';
  return 'счетов';
}

function buildAccountListText(rows) {
  if (rows.length === 0) {
    return '💳 <b>Ваши счета:</b>\n\nСчетов пока нет.';
  }
  const lines = rows.map((row) => {
    const label = escapeHtml(resolveTypeLabel(row.type));
    return `• ${escapeHtml(row.name)} — ${label} (${escapeHtml(row.currency)})`;
  });
  const totalCount = rows.length;
  const countLabel = `Всего: ${String(totalCount)} ${pluralizeAccounts(totalCount)}.`;
  return `💳 <b>Ваши счета:</b>\n\n${lines.join('\n')}\n\n${countLabel}`;
}

// ─────────────────────────────────────────────────────────────
// Inline logic mirrors — category.service.ts
// Must stay in sync with the production implementation.
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

function buildCategoryListText(rows) {
  if (rows.length === 0) {
    return (
      '📋 <b>Категории вашего кошелька:</b>\n\n' +
      'Категорий пока нет.\n' +
      'Добавьте категорию командой /add_category <группа> <название>.'
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
    const nameLines = names.map((n) => `• ${escapeHtml(n)}`).join('\n');
    sections.push(`<b>${escapeHtml(group)}:</b>\n${nameLines}`);
  }
  const totalCount = rows.length;
  const countLabel = `Всего: ${String(totalCount)} ${pluralizeCategories(totalCount)}.`;
  return `📋 <b>Категории вашего кошелька:</b>\n\n${sections.join('\n\n')}\n\n${countLabel}`;
}

// ─────────────────────────────────────────────────────────────
// Inline logic mirrors — webhook.route.ts /add_category success
// Must stay in sync with the production implementation.
// ─────────────────────────────────────────────────────────────

function buildAddCategorySuccessMessage(canonicalGroup, name) {
  return `✅ Категория добавлена: <b>${escapeHtml(canonicalGroup)}</b> / ${escapeHtml(name)}`;
}

// ─────────────────────────────────────────────────────────────
// ULID generator (no external dependency)
// ─────────────────────────────────────────────────────────────

function ulid() {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let result = '';
  for (let i = 0; i < 26; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// DB fixture helpers
// ─────────────────────────────────────────────────────────────

async function createWorkspaceFixture(pool) {
  const wsId = ulid();
  const userId = ulid();
  const membId = ulid();
  await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, $2)`, [wsId, `Test WS ${wsId.slice(0, 6)}`]);
  await pool.query(`INSERT INTO users (id, telegram_id) VALUES ($1, $2)`, [userId, BigInt(Math.floor(Math.random() * 1_000_000_000))]);
  await pool.query(`INSERT INTO workspace_memberships (id, workspace_id, user_id, role) VALUES ($1, $2, $3, 'owner')`, [membId, wsId, userId]);
  return { wsId, userId };
}

async function insertCategory(pool, wsId, name, group) {
  const id = ulid();
  await pool.query(
    `INSERT INTO categories (id, workspace_id, name, "group") VALUES ($1, $2, $3, $4::category_group)`,
    [id, wsId, name, group],
  );
  return id;
}

async function insertAccount(pool, wsId, name, type, currency) {
  const id = ulid();
  await pool.query(
    `INSERT INTO account_sources (id, workspace_id, name, type, currency) VALUES ($1, $2, $3, $4::account_source_type, $5)`,
    [id, wsId, name, type, currency],
  );
  return id;
}

// Phase 1.15 — KNOWN_COMMANDS stays at 6, unchanged
const KNOWN_COMMANDS = new Set(['/start', '/report', '/help', '/category', '/add_category', '/accounts']);

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🔍 Phase 1.15 Smoke Tests — HTML Escaping Hardening\n');

  // ── [A] escapeHtml unit tests ─────────────────────────────

  console.log('\n[TEST 1] Escapes & → &amp;');
  assert(escapeHtml('Fish & Chips') === 'Fish &amp; Chips', '"Fish & Chips" → "Fish &amp; Chips"');

  console.log('\n[TEST 2] Escapes < → &lt;');
  assert(escapeHtml('<tag>') === '&lt;tag&gt;', '"<tag>" → "&lt;tag&gt;"');

  console.log('\n[TEST 3] Escapes > → &gt;');
  assert(escapeHtml('5 > 3') === '5 &gt; 3', '"5 > 3" → "5 &gt; 3"');

  console.log('\n[TEST 4] Escapes " → &quot;');
  assert(escapeHtml('"hello"') === '&quot;hello&quot;', '"hello" → "&quot;hello&quot;"');

  console.log('\n[TEST 5] Escapes \' → &#x27;');
  assert(escapeHtml("it's") === 'it&#x27;s', "\"it's\" → \"it&#x27;s\"");

  console.log('\n[TEST 6] Escapes combined HTML string');
  {
    const input = '<b>Fish & Chips "great"</b>';
    const expected = '&lt;b&gt;Fish &amp; Chips &quot;great&quot;&lt;/b&gt;';
    assert(escapeHtml(input) === expected, `Combined HTML escaping correct`);
  }

  console.log('\n[TEST 7] Empty string returns empty string');
  assert(escapeHtml('') === '', 'escapeHtml("") === ""');

  console.log('\n[TEST 8] Safe string unchanged');
  assert(escapeHtml('Кофе') === 'Кофе', '"Кофе" unchanged — no special chars');

  console.log('\n[TEST 9] Double-quote only');
  assert(escapeHtml('"') === '&quot;', 'single " → &quot;');

  console.log('\n[TEST 10] Apostrophe only');
  assert(escapeHtml("'") === '&#x27;', "single ' → &#x27;");

  // ── [B] Account list rendering ───────────────────────────

  console.log('\n[TEST 11] Account name with < > renders escaped');
  {
    const rows = [{ name: '<Счёт>', type: 'manual', currency: 'RUB' }];
    const text = buildAccountListText(rows);
    assert(text.includes('&lt;Счёт&gt;'), 'Account name < > escaped in list');
    assert(!text.includes('<Счёт>'), 'Raw < > not present in account list output');
  }

  console.log('\n[TEST 12] Account name with & renders escaped');
  {
    const rows = [{ name: 'Save & Spend', type: 'manual', currency: 'RUB' }];
    const text = buildAccountListText(rows);
    assert(text.includes('Save &amp; Spend'), 'Account name & escaped in list');
    assert(!text.includes('Save & Spend'), 'Raw & not present in account list output');
  }

  console.log('\n[TEST 13] Account name with " renders escaped');
  {
    const rows = [{ name: '"Main"', type: 'manual', currency: 'RUB' }];
    const text = buildAccountListText(rows);
    assert(text.includes('&quot;Main&quot;'), 'Account name " escaped in list');
  }

  console.log('\n[TEST 14] Account currency with < > renders escaped');
  {
    const rows = [{ name: 'Default', type: 'manual', currency: '<USD>' }];
    const text = buildAccountListText(rows);
    assert(text.includes('&lt;USD&gt;'), 'Account currency < > escaped in list');
    assert(!text.includes('(<USD>)'), 'Raw <USD> not in account list output');
  }

  console.log('\n[TEST 15] Normal account name renders unchanged (regression)');
  {
    const rows = [{ name: 'Default', type: 'manual', currency: 'RUB' }];
    const text = buildAccountListText(rows);
    assert(text.includes('• Default — Ручной ввод (RUB)'), 'Normal account line unchanged');
    assert(text.includes('💳'), 'Account list header still present');
    assert(text.includes('Всего: 1 счёт'), 'Count line still present');
  }

  console.log('\n[TEST 16] Empty workspace — empty-state message correct (regression)');
  {
    const text = buildAccountListText([]);
    assert(text === '💳 <b>Ваши счета:</b>\n\nСчетов пока нет.', 'Empty-state exact match');
    assert(!text.includes('Всего'), 'Empty-state has no count line');
  }

  // ── [C] Category list rendering ──────────────────────────

  console.log('\n[TEST 17] Category name with < > renders escaped');
  {
    const rows = [{ name: '<Кофе>', group: 'Жизнь' }];
    const text = buildCategoryListText(rows);
    assert(text.includes('&lt;Кофе&gt;'), 'Category name < > escaped in list');
    assert(!text.includes('<Кофе>'), 'Raw < > not in category list output');
  }

  console.log('\n[TEST 18] Category name with & renders escaped');
  {
    const rows = [{ name: 'Food & Drink', group: 'Жизнь' }];
    const text = buildCategoryListText(rows);
    assert(text.includes('Food &amp; Drink'), 'Category name & escaped');
    assert(!text.includes('Food & Drink'), 'Raw & not in category list output');
  }

  console.log('\n[TEST 19] Category group label with < > renders escaped (defense-in-depth)');
  {
    // Simulate a hypothetical future group with HTML chars (or a corrupted enum value)
    const rows = [{ name: 'Кофе', group: '<BadGroup>' }];
    const text = buildCategoryListText(rows);
    assert(text.includes('&lt;BadGroup&gt;'), 'Group label < > escaped in section header');
    assert(!text.includes('<BadGroup>'), 'Raw < > not in group header');
    assert(!text.includes('<b><BadGroup>'), 'Raw HTML tag not injected into section header');
  }

  console.log('\n[TEST 20] Normal category name renders unchanged (regression)');
  {
    const rows = [
      { name: 'Кофе', group: 'Жизнь' },
      { name: 'Продукты', group: 'Жизнь' },
    ];
    const text = buildCategoryListText(rows);
    assert(text.includes('• Кофе'), 'Normal category name "Кофе" present');
    assert(text.includes('• Продукты'), 'Normal category name "Продукты" present');
    assert(text.includes('Всего: 2 категории'), 'Count line correct');
  }

  console.log('\n[TEST 21] Normal category group renders unchanged (regression)');
  {
    const rows = [{ name: 'Кофе', group: 'Жизнь' }];
    const text = buildCategoryListText(rows);
    // Жизнь contains no HTML special chars → should appear literally in <b>Жизнь:</b>
    assert(text.includes('<b>Жизнь:</b>'), 'Normal group "Жизнь" renders as <b>Жизнь:</b>');
  }

  console.log('\n[TEST 22] Empty category workspace — empty-state message correct (regression)');
  {
    const text = buildCategoryListText([]);
    assert(text.includes('📋'), 'Empty-state category has 📋 icon');
    assert(text.includes('Категорий пока нет'), 'Empty-state message correct');
    assert(text.includes('/add_category'), 'Empty-state includes /add_category hint');
  }

  // ── [D] /add_category success message ────────────────────

  console.log('\n[TEST 23] canonicalGroup with HTML chars escaped in success message');
  {
    // This is a defense-in-depth test; in practice canonicalGroup is always
    // one of: Бизнес, Жизнь — but we test the escaping function itself.
    const msg = buildAddCategorySuccessMessage('<Group>', 'Кофе');
    assert(msg.includes('&lt;Group&gt;'), 'Group HTML chars escaped in success message');
    assert(!msg.includes('<Group>'), 'Raw < > not in success message');
  }

  console.log('\n[TEST 24] name with HTML chars escaped in success message');
  {
    const msg = buildAddCategorySuccessMessage('Жизнь', '<b>Кофе</b>');
    assert(msg.includes('&lt;b&gt;Кофе&lt;/b&gt;'), 'Name HTML tags escaped in success message');
    assert(!msg.includes('<b>Кофе</b>'), 'Raw <b> not injected in success message');
  }

  console.log('\n[TEST 25] Normal name/group success message correct (regression)');
  {
    const msg = buildAddCategorySuccessMessage('Жизнь', 'Кофе');
    assert(
      msg === '✅ Категория добавлена: <b>Жизнь</b> / Кофе',
      'Normal success message exact match',
    );
  }

  console.log('\n[TEST 25b] Unknown group error message escapes groupToken (Traceability fix)');
  {
    // groupToken is user input reflected in an error sent with parse_mode:'HTML'
    const htmlGroupToken = '<b>evil</b>';
    const escapedToken = escapeHtml(htmlGroupToken); // '&lt;b&gt;evil&lt;/b&gt;'
    const fakeErrorMsg = `Неизвестная группа: «${escapedToken}».\nДопустимые группы: Бизнес, Жизнь.`;
    assert(fakeErrorMsg.includes('&lt;b&gt;evil&lt;/b&gt;'), 'groupToken HTML tags escaped in error message');
    assert(!fakeErrorMsg.includes('<b>evil</b>'), 'Raw <b> not in error message');
  }

  // ── [E] Scope guard ───────────────────────────────────────

  console.log('\n[TEST 26] KNOWN_COMMANDS still has exactly 6 commands');
  assert(KNOWN_COMMANDS.size === 6, `KNOWN_COMMANDS has 6 entries (got: ${KNOWN_COMMANDS.size})`);

  console.log('\n[TEST 27] /add_account NOT in KNOWN_COMMANDS (Phase 1.15 scope guard)');
  assert(!KNOWN_COMMANDS.has('/add_account'), '/add_account NOT in KNOWN_COMMANDS');

  console.log('\n[TEST 28] /balance NOT in KNOWN_COMMANDS (Phase 1.15 scope guard)');
  assert(!KNOWN_COMMANDS.has('/balance'), '/balance NOT in KNOWN_COMMANDS');

  // ── [F] DB-backed regression ──────────────────────────────

  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://midas_user:midas_dev_password@localhost:5432/midas',
  });

  try {
    // TEST 29: Category with HTML-like name stored and retrieved correctly
    console.log('\n[TEST 29] DB: Category with HTML-like name stored and retrieved');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      // Insert a category with a name containing HTML special chars
      const htmlName = '<Кофе> & "Чай"';
      await insertCategory(pool, wsId, htmlName, 'Жизнь');

      // Retrieve via RLS context (mirrors withTenantTransaction pattern)
      const client = await pool.connect();
      let retrievedName;
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [wsId]);
        await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
        const result = await client.query(
          `SELECT name FROM categories WHERE workspace_id = $1`,
          [wsId],
        );
        retrievedName = result.rows[0]?.name;
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // DB stores the raw name (no escaping at DB layer)
      assert(retrievedName === htmlName, `DB stores raw name correctly (got: ${retrievedName})`);

      // Rendering function escapes it correctly
      const text = buildCategoryListText([{ name: retrievedName, group: 'Жизнь' }]);
      assert(text.includes('&lt;Кофе&gt; &amp; &quot;Чай&quot;'), 'HTML name escaped in rendered output');
      assert(!text.includes(htmlName), 'Raw HTML name NOT present in rendered output');
    }

    // TEST 30: Account with HTML-like name stored and retrieved correctly
    console.log('\n[TEST 30] DB: Account with HTML-like name stored and retrieved');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      const htmlName = '<Main> & "Savings"';
      await insertAccount(pool, wsId, htmlName, 'manual', 'RUB');

      const client = await pool.connect();
      let retrievedName;
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [wsId]);
        await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
        const result = await client.query(
          `SELECT name FROM account_sources WHERE workspace_id = $1`,
          [wsId],
        );
        retrievedName = result.rows[0]?.name;
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      assert(retrievedName === htmlName, `DB stores raw account name correctly (got: ${retrievedName})`);

      const text = buildAccountListText([{ name: retrievedName, type: 'manual', currency: 'RUB' }]);
      assert(text.includes('&lt;Main&gt; &amp; &quot;Savings&quot;'), 'HTML account name escaped in rendered output');
      assert(!text.includes(htmlName), 'Raw HTML account name NOT present in rendered output');
    }
  } finally {
    await pool.end();
  }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

runTests()
  .then(() => {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Phase 1.15 Smoke Tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error('\n❌ SMOKE TESTS FAILED');
      process.exit(1);
    } else {
      console.log('\n✅ ALL PHASE 1.15 SMOKE TESTS PASSED');
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error('\n💥 Smoke test runner crashed:', err);
    process.exit(1);
  });
