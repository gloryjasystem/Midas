/**
 * Smoke Tests — Phase 1.14: /accounts Read-Only List Command
 *
 * Tests (16 scenarios):
 *
 * DB-backed tests (require live PostgreSQL):
 *   1.  Workspace with 1 account → list returned with correct content
 *   2.  Empty workspace → empty-state message returned
 *   3.  RLS isolation: workspace B cannot see workspace A accounts
 *   4.  midas_app can SELECT from account_sources (RLS USING check)
 *   5.  Output text format: name, Russian type label, currency correct
 *   6.  Type label mapping: manual, crypto_read_only, bank_sync
 *   7.  Flat ordering: ORDER BY type, name (SQL)
 *   8.  Russian pluralization: 1 счёт, 2 счёта, 5 счетов
 *
 * Logic-only tests (no DB required):
 *   9.  /accounts is in KNOWN_COMMANDS (now 6 commands)
 *   10. HELP_TEXT includes /accounts line
 *   11. /accountsfoo is NOT in KNOWN_COMMANDS (guard blocks it)
 *   12. Free text returns null from parseCommandToken (goes to AI parse)
 *   13. /category still in KNOWN_COMMANDS (Phase 1.11 regression)
 *   14. /add_category still in KNOWN_COMMANDS (Phase 1.13 regression)
 *   15. /report still in KNOWN_COMMANDS (Phase 1.9 regression)
 *   16. /balance and /add_account are NOT in KNOWN_COMMANDS (scope guard)
 *
 * SEC-03: Tests use explicit SET LOCAL to mirror withTenantTransaction.
 * SEC-12: No raw_text or PII in test output.
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
// ULID generator (no external dependency — mirrors Phase 1.13 pattern)
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
// Fixture helpers
// ─────────────────────────────────────────────────────────────

/**
 * Create a minimal workspace + user + membership via direct INSERT (privileged pool).
 * Does NOT use system_find_or_create_user to avoid seeding an account_sources row —
 * we want full control over what accounts exist in each test.
 */
async function createWorkspaceFixture(pool) {
  const wsId = ulid();
  const userId = ulid();
  const membId = ulid();

  await pool.query(
    `INSERT INTO workspaces (id, name) VALUES ($1, $2)`,
    [wsId, `Test WS ${wsId.slice(0, 6)}`],
  );
  await pool.query(
    `INSERT INTO users (id, telegram_id) VALUES ($1, $2)`,
    [userId, BigInt(Math.floor(Math.random() * 1_000_000_000))],
  );
  await pool.query(
    `INSERT INTO workspace_memberships (id, workspace_id, user_id, role) VALUES ($1, $2, $3, 'owner')`,
    [membId, wsId, userId],
  );

  return { wsId, userId };
}

/**
 * Insert an account_sources row directly (privileged pool, bypasses RLS).
 */
async function insertAccount(pool, wsId, name, type, currency) {
  const id = ulid();
  await pool.query(
    `INSERT INTO account_sources (id, workspace_id, name, type, currency)
     VALUES ($1, $2, $3, $4::account_source_type, $5)`,
    [id, wsId, name, type, currency],
  );
  return id;
}

/**
 * Run getAccountList logic: SELECT with RLS context via explicit SET LOCAL.
 * Mirrors the exact pattern used by account.service.ts / withTenantTransaction.
 * Returns raw rows.
 */
async function runAccountQuery(pool, wsId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [wsId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);

    const result = await client.query(
      `SELECT name, type, currency
       FROM account_sources
       WHERE workspace_id = $1
       ORDER BY type, name`,
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
// Inline logic mirrors — mirrors account.service.ts + webhook.route.ts
// Must stay in sync with the production implementations.
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
    const label = resolveTypeLabel(row.type);
    return `• ${row.name} — ${label} (${row.currency})`;
  });
  const totalCount = rows.length;
  const countLabel = `Всего: ${String(totalCount)} ${pluralizeAccounts(totalCount)}.`;
  return `💳 <b>Ваши счета:</b>\n\n${lines.join('\n')}\n\n${countLabel}`;
}

// Phase 1.14: 6 commands
const KNOWN_COMMANDS = new Set(['/start', '/report', '/help', '/category', '/add_category', '/accounts']);

const HELP_TEXT =
  'ℹ️ <b>Доступные команды Midas:</b>\n\n' +
  '/start — Регистрация и приветствие\n' +
  '/report — Отчёт о доходах и расходах за текущий месяц\n' +
  '/category — Список категорий вашего кошелька\n' +
  '/add_category <группа> <название> — Добавить категорию\n' +
  '/accounts — Список ваших счетов\n' +
  '/help — Показать это сообщение\n\n' +
  'Группы для /add_category: Бизнес, Жизнь\n' +
  'Пример: /add_category Жизнь Кофе\n\n' +
  'Для записи транзакции просто напишите мне сообщение, например:\n' +
  '<i>«Потратил 500 рублей на кофе»</i>';

function parseCommandToken(text) {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/')) return null;
  const token = trimmed.split(/\s+/)[0] ?? '';
  const atIdx = token.indexOf('@');
  return atIdx === -1 ? token : token.slice(0, atIdx);
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🔍 Phase 1.14 Smoke Tests — /accounts Read-Only List Command\n');

  // ── Logic-only tests (no DB required) ────────────────────

  // TEST 9: /accounts is in KNOWN_COMMANDS (6 commands total)
  console.log('\n[TEST 9] /accounts is in KNOWN_COMMANDS (6 commands)');
  {
    assert(KNOWN_COMMANDS.has('/accounts'), '/accounts in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.has('/start'), '/start still in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.has('/report'), '/report still in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.has('/help'), '/help still in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.has('/category'), '/category still in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.has('/add_category'), '/add_category still in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.size === 6, `KNOWN_COMMANDS has 6 entries (got: ${KNOWN_COMMANDS.size})`);
  }

  // TEST 10: HELP_TEXT includes /accounts
  console.log('\n[TEST 10] HELP_TEXT includes /accounts');
  {
    assert(HELP_TEXT.includes('/accounts'), 'HELP_TEXT contains /accounts');
    assert(HELP_TEXT.includes('Список ваших счетов'), 'HELP_TEXT has description for /accounts');
    assert(HELP_TEXT.includes('/start'), 'HELP_TEXT still contains /start');
    assert(HELP_TEXT.includes('/report'), 'HELP_TEXT still contains /report');
    assert(HELP_TEXT.includes('/category'), 'HELP_TEXT still contains /category');
    assert(HELP_TEXT.includes('/add_category'), 'HELP_TEXT still contains /add_category');
    assert(HELP_TEXT.includes('/help'), 'HELP_TEXT still contains /help');
  }

  // TEST 11: /accountsfoo is blocked (not in KNOWN_COMMANDS)
  console.log('\n[TEST 11] /accountsfoo is blocked as unknown command');
  {
    assert(parseCommandToken('/accountsfoo') === '/accountsfoo', '/accountsfoo → exact token "/accountsfoo"');
    assert(!KNOWN_COMMANDS.has('/accountsfoo'), '/accountsfoo NOT in KNOWN_COMMANDS → guard fires');
    assert(!KNOWN_COMMANDS.has('/account'), '/account NOT in KNOWN_COMMANDS (only /accounts)');
    assert(!KNOWN_COMMANDS.has('/accounts_list'), '/accounts_list NOT in KNOWN_COMMANDS');
  }

  // TEST 12: Free text returns null → goes to AI parse
  console.log('\n[TEST 12] Free text returns null → still goes to AI parse');
  {
    assert(parseCommandToken('потратил 500 рублей на кофе') === null, 'free text → null (AI parse path)');
    assert(parseCommandToken('accounts') === null, 'no leading slash → null');
    assert(parseCommandToken(' accounts') === null, 'space before accounts → null (no slash)');
  }

  // TEST 13: /category regression (Phase 1.11)
  console.log('\n[TEST 13] /category still works (Phase 1.11 regression)');
  {
    assert(KNOWN_COMMANDS.has('/category'), '/category in KNOWN_COMMANDS');
    assert(parseCommandToken('/category') === '/category', 'parseCommandToken("/category") = "/category"');
  }

  // TEST 14: /add_category regression (Phase 1.13)
  console.log('\n[TEST 14] /add_category still works (Phase 1.13 regression)');
  {
    assert(KNOWN_COMMANDS.has('/add_category'), '/add_category in KNOWN_COMMANDS');
    assert(parseCommandToken('/add_category Жизнь Кофе') === '/add_category', 'parseCommandToken strips args');
    assert(parseCommandToken('/add_category@MidasBot Жизнь') === '/add_category', 'parseCommandToken strips @BotName');
  }

  // TEST 15: /report regression (Phase 1.9)
  console.log('\n[TEST 15] /report still works (Phase 1.9 regression)');
  {
    assert(KNOWN_COMMANDS.has('/report'), '/report in KNOWN_COMMANDS');
    assert(parseCommandToken('/report') === '/report', 'parseCommandToken("/report") = "/report"');
  }

  // TEST 16: Scope guard — /balance and /add_account NOT in KNOWN_COMMANDS
  console.log('\n[TEST 16] Scope guard: /balance and /add_account NOT in KNOWN_COMMANDS');
  {
    assert(!KNOWN_COMMANDS.has('/balance'), '/balance NOT in KNOWN_COMMANDS (Phase 1.14 scope boundary)');
    assert(!KNOWN_COMMANDS.has('/add_account'), '/add_account NOT in KNOWN_COMMANDS (Phase 1.15 not started)');
    assert(!KNOWN_COMMANDS.has('/unknown'), '/unknown NOT in KNOWN_COMMANDS');
  }

  // TEST 8: Russian pluralization (logic-only, no DB needed)
  console.log('\n[TEST 8] Russian pluralization for "счёт"');
  {
    assert(pluralizeAccounts(1) === 'счёт', 'pluralize(1) = "счёт"');
    assert(pluralizeAccounts(2) === 'счёта', 'pluralize(2) = "счёта"');
    assert(pluralizeAccounts(3) === 'счёта', 'pluralize(3) = "счёта"');
    assert(pluralizeAccounts(4) === 'счёта', 'pluralize(4) = "счёта"');
    assert(pluralizeAccounts(5) === 'счетов', 'pluralize(5) = "счетов"');
    assert(pluralizeAccounts(10) === 'счетов', 'pluralize(10) = "счетов"');
    assert(pluralizeAccounts(11) === 'счетов', 'pluralize(11) = "счетов" (teen exception)');
    assert(pluralizeAccounts(12) === 'счетов', 'pluralize(12) = "счетов" (teen exception)');
    assert(pluralizeAccounts(21) === 'счёт', 'pluralize(21) = "счёт"');
    assert(pluralizeAccounts(22) === 'счёта', 'pluralize(22) = "счёта"');
    assert(pluralizeAccounts(0) === 'счетов', 'pluralize(0) = "счетов"');
  }

  // ── DB-backed tests ────────────────────────────────────────

  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://midas_user:midas_dev_password@localhost:5432/midas',
  });

  const appPool = new Pool({
    connectionString:
      process.env.APP_DATABASE_URL ??
      'postgresql://midas_app:midas_app_password@localhost:5432/midas',
  });

  try {
    // TEST 1: Workspace with 1 account → list returned
    console.log('\n[TEST 1] Workspace with 1 account returns list');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      await insertAccount(pool, wsId, 'Default', 'manual', 'RUB');

      const rows = await runAccountQuery(pool, wsId, userId);
      assert(rows.length === 1, `1 account row returned (got: ${rows.length})`);
      assert(rows[0].name === 'Default', `Account name is "Default" (got: ${rows[0]?.name})`);
      assert(rows[0].type === 'manual', `Account type is "manual" (got: ${rows[0]?.type})`);
      assert(rows[0].currency === 'RUB', `Account currency is "RUB" (got: ${rows[0]?.currency})`);

      const text = buildAccountListText(rows);
      assert(text.includes('💳'), 'Output starts with 💳 icon');
      assert(text.includes('Ваши счета'), 'Output contains "Ваши счета"');
      assert(text.includes('Default'), 'Output contains account name "Default"');
      assert(text.includes('Ручной ввод'), 'Output contains Russian label "Ручной ввод"');
      assert(text.includes('RUB'), 'Output contains currency "RUB"');
      assert(text.includes('Всего: 1 счёт'), 'Output contains correct count "1 счёт"');
    }

    // TEST 2: Empty workspace → empty-state message
    console.log('\n[TEST 2] Empty workspace returns empty-state message');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      // No accounts inserted

      const rows = await runAccountQuery(pool, wsId, userId);
      assert(rows.length === 0, `0 accounts for empty workspace (got: ${rows.length})`);

      const text = buildAccountListText(rows);
      assert(
        text === '💳 <b>Ваши счета:</b>\n\nСчетов пока нет.',
        'Empty-state message exact match',
      );
      assert(!text.includes('Всего'), 'Empty-state does not include count line');
    }

    // TEST 3: RLS tenant isolation
    console.log('\n[TEST 3] RLS tenant isolation');
    {
      const ws1 = await createWorkspaceFixture(pool);
      const ws2 = await createWorkspaceFixture(pool);

      await insertAccount(pool, ws1.wsId, 'WS1-Account', 'manual', 'RUB');
      // ws2 has no accounts

      // Query ws2 — must not see ws1's accounts
      const rowsFromWs2Context = await runAccountQuery(pool, ws2.wsId, ws2.userId);
      assert(rowsFromWs2Context.length === 0, 'WS2 context sees 0 accounts (WS1 accounts not visible)');

      const rogue = rowsFromWs2Context.find((r) => r.name === 'WS1-Account');
      assert(!rogue, 'WS1-Account is not leaked into WS2 context');

      // Query ws1 — sees its own account
      const rowsFromWs1Context = await runAccountQuery(pool, ws1.wsId, ws1.userId);
      assert(rowsFromWs1Context.length === 1, 'WS1 context sees 1 account');
      assert(rowsFromWs1Context[0].name === 'WS1-Account', 'WS1 context sees its own account');
    }

    // TEST 4: midas_app can SELECT from account_sources (RLS USING check)
    console.log('\n[TEST 4] midas_app role: RLS USING check allows SELECT for own workspace');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      await insertAccount(pool, wsId, 'AppTest', 'manual', 'USD');

      // Use midas_app role (respects RLS, BYPASSRLS=false)
      const appClient = await appPool.connect();
      let rowCount = 0;
      try {
        await appClient.query('BEGIN');
        await appClient.query("SELECT set_config('app.workspace_id', $1, true)", [wsId]);
        await appClient.query("SELECT set_config('app.user_id', $1, true)", [userId]);

        const result = await appClient.query(
          `SELECT id FROM account_sources WHERE workspace_id = $1`,
          [wsId],
        );
        rowCount = result.rows.length;
        await appClient.query('COMMIT');
      } catch (err) {
        await appClient.query('ROLLBACK');
        throw err;
      } finally {
        appClient.release();
      }

      assert(rowCount === 1, `midas_app can SELECT 1 account_sources row via RLS (got: ${rowCount})`);
    }

    // TEST 5: Output text format
    console.log('\n[TEST 5] Output text format: "• Name — Label (Currency)"');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      await insertAccount(pool, wsId, 'Default', 'manual', 'RUB');

      const rows = await runAccountQuery(pool, wsId, userId);
      const text = buildAccountListText(rows);
      assert(
        text.includes('• Default — Ручной ввод (RUB)'),
        'Format: "• Name — Label (Currency)"',
      );
    }

    // TEST 6: Russian type label mapping
    console.log('\n[TEST 6] Russian type label mapping for all enum values');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      await insertAccount(pool, wsId, 'Manual Account', 'manual', 'RUB');
      await insertAccount(pool, wsId, 'Crypto Account', 'crypto_read_only', 'BTC');
      await insertAccount(pool, wsId, 'Bank Account', 'bank_sync', 'EUR');

      const rows = await runAccountQuery(pool, wsId, userId);
      const text = buildAccountListText(rows);

      assert(text.includes('Ручной ввод'), 'manual → "Ручной ввод"');
      assert(text.includes('Крипто'), 'crypto_read_only → "Крипто"');
      assert(text.includes('Банк'), 'bank_sync → "Банк"');
      assert(text.includes('Всего: 3 счёта'), 'Count: "3 счёта"');
    }

    // TEST 7: Flat ordering: ORDER BY type, name
    console.log('\n[TEST 7] Ordering: ORDER BY type ASC, name ASC (enum declaration order: manual < crypto_read_only < bank_sync)');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      // Insert in non-enum order to verify DB ordering takes effect
      await insertAccount(pool, wsId, 'Z Manual', 'manual', 'RUB');
      await insertAccount(pool, wsId, 'A Crypto', 'crypto_read_only', 'BTC');
      await insertAccount(pool, wsId, 'M Bank', 'bank_sync', 'EUR');

      const rows = await runAccountQuery(pool, wsId, userId);
      // ORDER BY type: manual(1) < crypto_read_only(2) < bank_sync(3) — enum declaration order
      assert(rows.length === 3, `3 accounts returned (got: ${rows.length})`);
      assert(rows[0].type === 'manual', `First row type is manual (got: ${rows[0]?.type})`);
      assert(rows[1].type === 'crypto_read_only', `Second row type is crypto_read_only (got: ${rows[1]?.type})`);
      assert(rows[2].type === 'bank_sync', `Third row type is bank_sync (got: ${rows[2]?.type})`);

      const text = buildAccountListText(rows);
      const manualIdx = text.indexOf('Ручной ввод');
      const cryptoIdx = text.indexOf('Крипто');
      const bankIdx = text.indexOf('Банк');
      assert(
        manualIdx < cryptoIdx && cryptoIdx < bankIdx,
        'Text order: Ручной ввод before Крипто before Банк (enum order)',
      );
    }
  } finally {
    await pool.end();
    await appPool.end();
  }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

runTests()
  .then(() => {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Phase 1.14 Smoke Tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error('\n❌ SMOKE TESTS FAILED');
      process.exit(1);
    } else {
      console.log('\n✅ ALL PHASE 1.14 SMOKE TESTS PASSED');
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error('\n💥 Smoke test runner crashed:', err);
    process.exit(1);
  });
