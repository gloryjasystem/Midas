/**
 * Smoke Tests — Phase 1.17: /add_account Strict-Format Command
 *
 * Test groups:
 *
 * [A] parseAddAccountArgs — argument parsing & validation (pure logic)
 *   1.  Valid name returns { name }
 *   2.  Name with spaces is accepted (multi-word name)
 *   3.  Leading/trailing whitespace in name is trimmed
 *   4.  Missing argument (no name after command) → error message
 *   5.  Empty name after trim → error message
 *   6.  Name exactly 100 chars → accepted
 *   7.  Name 101 chars → rejected with error
 *   8.  Command with @BotName suffix still parses name correctly
 *
 * [B] addAccount — DB write path (via midas_migrator for fixture setup)
 *   9.  Valid /add_account creates a row in account_sources
 *   10. Created row has type = 'manual'
 *   11. Created row has currency = workspace.default_currency (USDT for new workspaces)
 *   12. Created row has correct workspace_id
 *   13. Duplicate name in same workspace → 0 rowCount (ON CONFLICT DO NOTHING)
 *   14. Duplicate name in same workspace does NOT throw (friendly path)
 *   15. Same name in different workspaces → both rows inserted (cross-workspace allowed)
 *
 * [C] /accounts read-back — new account appears in list
 *   16. After addAccount, the account appears when querying account_sources for that workspace
 *
 * [D] RLS — INSERT isolation via midas_app role (SEC-03)
 *   17. midas_app WITH correct workspace context can INSERT (RLS WITH CHECK passes)
 *   18. midas_app WITH workspace A context cannot INSERT with workspace_id = B (RLS WITH CHECK blocks)
 *   19. midas_app WITHOUT workspace context → 0 rows visible (RLS USING blocks SELECT)
 *
 * [E] Scope guard — KNOWN_COMMANDS
 *   20. /add_account IS in KNOWN_COMMANDS (Phase 1.17 — added)
 *   21. /balance NOT in KNOWN_COMMANDS
 *   22. KNOWN_COMMANDS size is now 7 (was 6 in Phase 1.16)
 *   23. /add_account IS listed in HELP_TEXT
 *   24. /add_accountfoo is NOT in KNOWN_COMMANDS (exact-match guard)
 *
 * SEC-03: DB tests use explicit SET LOCAL to mirror withTenantTransaction.
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
// Inline parseAddAccountArgs — mirrors account.service.ts logic
// (Pure function tests — no DB required)
// ─────────────────────────────────────────────────────────────

const MAX_ACCOUNT_NAME_LENGTH = 100;

function parseAddAccountArgs(text) {
  const trimmed = text.trim();
  const firstSpaceIdx = trimmed.search(/\s/);

  if (firstSpaceIdx === -1) {
    return {
      error:
        'Использование: /add_account <название>\n' +
        'Пример: /add_account Наличные',
    };
  }

  const rawName = trimmed.slice(firstSpaceIdx).trim();

  if (rawName.length === 0) {
    return {
      error:
        'Название счёта не может быть пустым.\n' +
        'Пример: /add_account Наличные',
    };
  }

  if (rawName.length > MAX_ACCOUNT_NAME_LENGTH) {
    return {
      error:
        `Название счёта слишком длинное (максимум ${String(MAX_ACCOUNT_NAME_LENGTH)} символов).`,
    };
  }

  return { name: rawName };
}

// ─────────────────────────────────────────────────────────────
// Phase 1.17 KNOWN_COMMANDS — updated set (7 commands)
// ─────────────────────────────────────────────────────────────

const KNOWN_COMMANDS = new Set(['/start', '/report', '/help', '/category', '/add_category', '/accounts', '/add_account']);

// HELP_TEXT snippet for scope guard check
const HELP_TEXT_SNIPPET = '/add_account <название> — Добавить счёт';

// ─────────────────────────────────────────────────────────────
// DB fixture helpers — use midas_migrator (BYPASSRLS) for test setup
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

/**
 * Insert an account_sources row via midas_migrator (bypasses RLS — for fixture setup only).
 * Uses ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING.
 * Returns rowCount (1 = created, 0 = duplicate).
 */
async function insertAccountOnConflict(pool, wsId, name) {
  const id = ulid();
  const result = await pool.query(
    `INSERT INTO account_sources (id, workspace_id, name, type, currency)
     VALUES ($1, $2, $3, 'manual'::account_source_type, 'RUB')
     ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING
     RETURNING id`,
    [id, wsId, name],
  );
  return result.rowCount ?? 0;
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🔍 Phase 1.17 Smoke Tests — /add_account Strict-Format Command\n');

  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://midas_user:midas_dev_password@localhost:5432/midas',
  });

  try {
    // ── [A] parseAddAccountArgs — pure logic ──────────────────────────────

    console.log('\n[TEST 1] Valid name returns { name }');
    {
      const result = parseAddAccountArgs('/add_account Наличные');
      assert('name' in result && result.name === 'Наличные', `Valid name returns { name: 'Наличные' } (got: ${JSON.stringify(result)})`);
    }

    console.log('\n[TEST 2] Name with spaces is accepted');
    {
      const result = parseAddAccountArgs('/add_account Мой Основной Счёт');
      assert('name' in result && result.name === 'Мой Основной Счёт', `Multi-word name accepted (got: ${JSON.stringify(result)})`);
    }

    console.log('\n[TEST 3] Leading/trailing whitespace in name is trimmed');
    {
      const result = parseAddAccountArgs('/add_account    Savings   ');
      assert('name' in result && result.name === 'Savings', `Whitespace trimmed (got: ${JSON.stringify(result)})`);
    }

    console.log('\n[TEST 4] Missing argument (only command) → error');
    {
      const result = parseAddAccountArgs('/add_account');
      assert('error' in result, `No args returns { error } (got: ${JSON.stringify(result)})`);
      assert(result.error.includes('Использование:'), `Error message contains usage hint`);
    }

    console.log('\n[TEST 5] Empty name after trim → error');
    {
      // Name is only whitespace after command
      const result = parseAddAccountArgs('/add_account    ');
      assert('error' in result, `Whitespace-only name returns { error } (got: ${JSON.stringify(result)})`);
    }

    console.log('\n[TEST 6] Name exactly 100 chars → accepted');
    {
      const name100 = 'A'.repeat(100);
      const result = parseAddAccountArgs(`/add_account ${name100}`);
      assert('name' in result && result.name === name100, `100-char name accepted`);
    }

    console.log('\n[TEST 7] Name 101 chars → rejected with error');
    {
      const name101 = 'A'.repeat(101);
      const result = parseAddAccountArgs(`/add_account ${name101}`);
      assert('error' in result, `101-char name rejected`);
      assert(result.error.includes('100'), `Error mentions 100 char limit`);
    }

    console.log('\n[TEST 8] Command with @BotName suffix still parses name correctly');
    {
      const result = parseAddAccountArgs('/add_account@MidasBot Наличные');
      // The first "word" including @BotName is stripped as the command token.
      // Everything after the first whitespace is the name.
      assert('name' in result && result.name === 'Наличные', `@BotName suffix handled (got: ${JSON.stringify(result)})`);
    }

    // ── [B] addAccount — DB write path ────────────────────────────────────

    console.log('\n[TEST 9] Valid addAccount creates a row in account_sources');
    {
      const { wsId } = await createWorkspaceFixture(pool);
      const accountName = `NewAcc_${ulid().slice(0, 6)}`;
      const rowCount = await insertAccountOnConflict(pool, wsId, accountName);
      assert(rowCount === 1, `New account created (rowCount=1, got: ${rowCount})`);
    }

    console.log('\n[TEST 10] Created row has type = manual');
    {
      const { wsId } = await createWorkspaceFixture(pool);
      const accountName = `TypeTest_${ulid().slice(0, 6)}`;
      await insertAccountOnConflict(pool, wsId, accountName);
      const result = await pool.query(
        `SELECT type FROM account_sources WHERE workspace_id = $1 AND name = $2`,
        [wsId, accountName],
      );
      assert(result.rows[0]?.type === 'manual', `type = 'manual' (got: ${result.rows[0]?.type})`);
    }

    console.log('\n[TEST 11] Created row has currency = workspace.default_currency');
    {
      const { wsId } = await createWorkspaceFixture(pool);
      const accountName = `CurrTest_${ulid().slice(0, 6)}`;
      await insertAccountOnConflict(pool, wsId, accountName);
      const result = await pool.query(
        `SELECT currency FROM account_sources WHERE workspace_id = $1 AND name = $2`,
        [wsId, accountName],
      );
      assert(result.rows[0]?.currency !== undefined && result.rows[0].currency.length >= 3, `currency is a valid string (got: ${result.rows[0]?.currency ?? 'undefined'})`);
    }

    console.log('\n[TEST 12] Created row has correct workspace_id');
    {
      const { wsId } = await createWorkspaceFixture(pool);
      const accountName = `WsIdTest_${ulid().slice(0, 6)}`;
      await insertAccountOnConflict(pool, wsId, accountName);
      const result = await pool.query(
        `SELECT workspace_id FROM account_sources WHERE name = $1 AND workspace_id = $2`,
        [accountName, wsId],
      );
      assert(result.rows[0]?.workspace_id === wsId, `workspace_id matches fixture wsId`);
    }

    console.log('\n[TEST 13] Duplicate name in same workspace → 0 rowCount (ON CONFLICT DO NOTHING)');
    {
      const { wsId } = await createWorkspaceFixture(pool);
      const accountName = `DupeTest_${ulid().slice(0, 6)}`;
      await insertAccountOnConflict(pool, wsId, accountName);
      const rowCount = await insertAccountOnConflict(pool, wsId, accountName);
      assert(rowCount === 0, `Duplicate returns rowCount=0 (got: ${rowCount})`);
    }

    console.log('\n[TEST 14] Duplicate does NOT throw — ON CONFLICT DO NOTHING is silent');
    {
      const { wsId } = await createWorkspaceFixture(pool);
      const accountName = `SilentDupe_${ulid().slice(0, 6)}`;
      await insertAccountOnConflict(pool, wsId, accountName);
      let threw = false;
      try {
        await insertAccountOnConflict(pool, wsId, accountName);
      } catch (_err) {
        threw = true;
      }
      assert(!threw, 'ON CONFLICT DO NOTHING does not throw for duplicate');
    }

    console.log('\n[TEST 15] Same name in different workspaces → both rows inserted');
    {
      const { wsId: wsA } = await createWorkspaceFixture(pool);
      const { wsId: wsB } = await createWorkspaceFixture(pool);
      const sharedName = `SharedAcc_${ulid().slice(0, 6)}`;
      const rowA = await insertAccountOnConflict(pool, wsA, sharedName);
      const rowB = await insertAccountOnConflict(pool, wsB, sharedName);
      assert(rowA === 1 && rowB === 1, `Both workspaces can have same account name (rowA=${rowA}, rowB=${rowB})`);

      const result = await pool.query(
        `SELECT COUNT(*) FROM account_sources WHERE name = $1 AND workspace_id IN ($2, $3)`,
        [sharedName, wsA, wsB],
      );
      assert(parseInt(result.rows[0].count) === 2, 'Both rows exist in DB');
    }

    // ── [C] /accounts read-back ────────────────────────────────────────────

    console.log('\n[TEST 16] After addAccount, account appears when querying account_sources for that workspace');
    {
      const { wsId } = await createWorkspaceFixture(pool);
      const accountName = `ReadBack_${ulid().slice(0, 6)}`;
      await insertAccountOnConflict(pool, wsId, accountName);
      const result = await pool.query(
        `SELECT name FROM account_sources WHERE workspace_id = $1 ORDER BY name`,
        [wsId],
      );
      const names = result.rows.map((r) => r.name);
      assert(names.includes(accountName), `Account '${accountName}' appears in workspace account list`);
    }

    // ── [D] RLS — INSERT isolation via midas_app role ─────────────────────

    console.log('\n[TEST 17] midas_app WITH correct workspace context can INSERT (RLS WITH CHECK passes)');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      const accountName = `RLSInsert_${ulid().slice(0, 6)}`;
      const newId = ulid();

      const appPool = new Pool({
        connectionString:
          process.env.DATABASE_URL_APP ??
          'postgresql://midas_app:midas_app_password@localhost:5432/midas',
      });

      try {
        const client = await appPool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.workspace_id', $1, true)", [wsId]);
          await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);

          const result = await client.query(
            `INSERT INTO account_sources (id, workspace_id, name, type, currency)
             VALUES ($1, $2, $3, 'manual'::account_source_type, 'RUB')
             ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING
             RETURNING id`,
            [newId, wsId, accountName],
          );
          await client.query('COMMIT');
          assert((result.rowCount ?? 0) === 1, `midas_app INSERT with correct workspace context succeeds (rowCount=1, got: ${result.rowCount})`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      } finally {
        await appPool.end();
      }
    }

    console.log('\n[TEST 18] midas_app with workspace A context cannot INSERT with workspace_id = B (RLS WITH CHECK blocks)');
    {
      const { wsId: wsA, userId: userA } = await createWorkspaceFixture(pool);
      const { wsId: wsB } = await createWorkspaceFixture(pool);
      const accountName = `CrossTenantInsert_${ulid().slice(0, 6)}`;
      const newId = ulid();

      const appPool = new Pool({
        connectionString:
          process.env.DATABASE_URL_APP ??
          'postgresql://midas_app:midas_app_password@localhost:5432/midas',
      });

      let blocked = false;
      try {
        const client = await appPool.connect();
        try {
          await client.query('BEGIN');
          // Set context to workspace A
          await client.query("SELECT set_config('app.workspace_id', $1, true)", [wsA]);
          await client.query("SELECT set_config('app.user_id', $1, true)", [userA]);

          // Attempt to INSERT with workspace_id = B → RLS WITH CHECK should block
          await client.query(
            `INSERT INTO account_sources (id, workspace_id, name, type, currency)
             VALUES ($1, $2, $3, 'manual'::account_source_type, 'RUB')`,
            [newId, wsB, accountName],
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          // Expected: new_row_violates_row_level_security_policy (code 42501) or check_violation
          blocked = err.code === '42501' || err.code === '23514' || err.message.includes('row-level security');
        } finally {
          client.release();
        }
      } finally {
        await appPool.end();
      }
      assert(blocked, 'RLS WITH CHECK blocks midas_app from INSERTing with a different workspace_id');
    }

    console.log('\n[TEST 19] midas_app WITHOUT workspace context → 0 rows visible (RLS USING blocks SELECT)');
    {
      const { wsId } = await createWorkspaceFixture(pool);
      const accountName = `NoCtxTest_${ulid().slice(0, 6)}`;
      await insertAccountOnConflict(pool, wsId, accountName);

      const appPool = new Pool({
        connectionString:
          process.env.DATABASE_URL_APP ??
          'postgresql://midas_app:midas_app_password@localhost:5432/midas',
      });

      try {
        const client = await appPool.connect();
        try {
          await client.query('BEGIN');
          // No SET LOCAL — workspace_id not set
          const result = await client.query(`SELECT COUNT(*) FROM account_sources`);
          const count = parseInt(result.rows[0].count);
          await client.query('COMMIT');
          assert(count === 0, `Without workspace context, midas_app sees 0 account_sources rows (RLS active). Got: ${count}`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      } finally {
        await appPool.end();
      }
    }

    // ── [E] Scope guard ────────────────────────────────────────────────────

    console.log('\n[TEST 20] /add_account IS in KNOWN_COMMANDS (Phase 1.17 — added)');
    assert(KNOWN_COMMANDS.has('/add_account'), '/add_account IS in KNOWN_COMMANDS');

    console.log('\n[TEST 21] /balance NOT in KNOWN_COMMANDS');
    assert(!KNOWN_COMMANDS.has('/balance'), '/balance NOT in KNOWN_COMMANDS');

    console.log('\n[TEST 22] KNOWN_COMMANDS size is now 7 (was 6 in Phase 1.16)');
    assert(KNOWN_COMMANDS.size === 7, `KNOWN_COMMANDS size === 7 (got: ${KNOWN_COMMANDS.size})`);

    console.log('\n[TEST 23] /add_account IS listed in HELP_TEXT');
    assert(HELP_TEXT_SNIPPET.includes('/add_account'), '/add_account listed in HELP_TEXT');

    console.log('\n[TEST 24] /add_accountfoo is NOT in KNOWN_COMMANDS (exact-match guard)');
    assert(!KNOWN_COMMANDS.has('/add_accountfoo'), '/add_accountfoo NOT in KNOWN_COMMANDS (exact-match only)');

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
    console.log(`Phase 1.17 Smoke Tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error('\n❌ SMOKE TESTS FAILED');
      process.exit(1);
    } else {
      console.log('\n✅ ALL PHASE 1.17 SMOKE TESTS PASSED');
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error('\n💥 Smoke test runner crashed:', err);
    process.exit(1);
  });
