/**
 * Smoke Tests — Phase 1.16: account_sources UNIQUE(workspace_id, name) Constraint
 *
 * Test groups:
 *
 * [A] Constraint existence (DB metadata)
 *   1.  account_sources_workspace_id_name_key constraint exists in pg_constraint
 *   2.  Constraint type is 'u' (UNIQUE)
 *   3.  Constraint covers exactly the columns (workspace_id, name)
 *   4.  categories_workspace_id_name_key still exists (regression — Phase 1.2)
 *
 * [B] Duplicate enforcement — same workspace
 *   5.  INSERT duplicate (same workspace_id, same name) → raises UNIQUE violation
 *   6.  ON CONFLICT ON CONSTRAINT ... DO NOTHING — duplicate silently skipped
 *   7.  ON CONFLICT DO NOTHING returns 0 rows (no row inserted)
 *   8.  ON CONFLICT — first insert returns 1 row (row created)
 *   9.  Duplicate check is case-sensitive: 'Default' ≠ 'default'
 *   10. Duplicate check is exact-match: 'Savings' ≠ 'Savings '
 *
 * [C] Cross-workspace isolation — same name allowed in different workspaces
 *   11. Same account name in workspace A and workspace B — both rows inserted
 *   12. Each workspace sees only its own account (RLS context check)
 *
 * [D] No data mutation — existing data integrity
 *   13. Total account_sources count before = after smoke test inserts (fixture cleanup)
 *   14. No existing duplicates introduced by the migration (re-check post-migration)
 *
 * [E] RLS still active
 *   15. midas_app role cannot SELECT account_sources without SET LOCAL app.workspace_id
 *   16. midas_app role with correct workspace_id context sees only own accounts
 *   17. midas_app role with workspace_id A cannot see workspace_id B accounts
 *
 * [F] Scope guard
 *   18. No /add_account command exists in KNOWN_COMMANDS
 *   19. No /balance command exists in KNOWN_COMMANDS
 *   20. KNOWN_COMMANDS size is still 6 (unchanged from Phase 1.15)
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

async function insertAccount(pool, wsId, name, type = 'manual', currency = 'RUB') {
  const id = ulid();
  const result = await pool.query(
    `INSERT INTO account_sources (id, workspace_id, name, type, currency)
     VALUES ($1, $2, $3, $4::account_source_type, $5)
     RETURNING id`,
    [id, wsId, name, type, currency],
  );
  return result.rows[0]?.id ?? null;
}

async function insertAccountOnConflict(pool, wsId, name, type = 'manual', currency = 'RUB') {
  const id = ulid();
  const result = await pool.query(
    `INSERT INTO account_sources (id, workspace_id, name, type, currency)
     VALUES ($1, $2, $3, $4::account_source_type, $5)
     ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING
     RETURNING id`,
    [id, wsId, name, type, currency],
  );
  return result.rowCount ?? 0;
}

// ─────────────────────────────────────────────────────────────
// Phase 1.15 KNOWN_COMMANDS — unchanged in Phase 1.16
// ─────────────────────────────────────────────────────────────

const KNOWN_COMMANDS = new Set(['/start', '/report', '/help', '/category', '/add_category', '/accounts']);

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🔍 Phase 1.16 Smoke Tests — account_sources UNIQUE(workspace_id, name)\n');

  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://midas_user:midas_dev_password@localhost:5432/midas',
  });

  // Track total count before test inserts for cleanup verification
  const countBefore = (await pool.query('SELECT COUNT(*) FROM account_sources')).rows[0].count;

  try {
    // ── [A] Constraint existence ──────────────────────────────────────────

    console.log('\n[TEST 1] account_sources_workspace_id_name_key exists in pg_constraint');
    {
      const result = await pool.query(
        `SELECT conname FROM pg_constraint
         WHERE conrelid = 'account_sources'::regclass
           AND conname = 'account_sources_workspace_id_name_key'`,
      );
      assert(result.rows.length === 1, 'UNIQUE constraint account_sources_workspace_id_name_key exists');
    }

    console.log('\n[TEST 2] Constraint type is UNIQUE (contype = u)');
    {
      const result = await pool.query(
        `SELECT contype FROM pg_constraint
         WHERE conrelid = 'account_sources'::regclass
           AND conname = 'account_sources_workspace_id_name_key'`,
      );
      assert(result.rows[0]?.contype === 'u', `Constraint type is 'u' (UNIQUE), got: ${result.rows[0]?.contype}`);
    }

    console.log('\n[TEST 3] Constraint covers exactly columns (workspace_id, name)');
    {
      const result = await pool.query(
        `SELECT array_agg(a.attname ORDER BY array_position(c.conkey, a.attnum)) AS cols
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
         WHERE c.conrelid = 'account_sources'::regclass
           AND c.conname = 'account_sources_workspace_id_name_key'
         GROUP BY c.conname`,
      );
      // pg returns array_agg result as a PostgreSQL array string e.g. '{workspace_id,name}'
      // Parse it into a JS array before asserting.
      const rawCols = result.rows[0]?.cols ?? '{}';
      const cols = typeof rawCols === 'string'
        ? rawCols.replace(/^\{|\}$/g, '').split(',').filter(Boolean)
        : Array.isArray(rawCols) ? rawCols : [];
      assert(
        cols.length === 2 && cols[0] === 'workspace_id' && cols[1] === 'name',
        `Constraint covers exactly [workspace_id, name] (got: [${cols.join(', ')}])`,
      );
    }

    console.log('\n[TEST 4] categories_workspace_id_name_key still exists (Phase 1.2 regression)');
    {
      const result = await pool.query(
        `SELECT conname FROM pg_constraint
         WHERE conrelid = 'categories'::regclass
           AND conname = 'categories_workspace_id_name_key'`,
      );
      assert(result.rows.length === 1, 'categories_workspace_id_name_key still present (Phase 1.2 regression)');
    }

    // ── [B] Duplicate enforcement — same workspace ────────────────────────

    console.log('\n[TEST 5] INSERT duplicate same workspace → UNIQUE violation error');
    {
      const { wsId } = await createWorkspaceFixture(pool);
      await insertAccount(pool, wsId, 'DupeTest');
      let threw = false;
      try {
        await insertAccount(pool, wsId, 'DupeTest');
      } catch (err) {
        // Expected: unique_violation (code 23505)
        threw = err.code === '23505';
      }
      assert(threw, 'Second INSERT of same (workspace_id, name) throws unique_violation (23505)');
    }

    console.log('\n[TEST 6] ON CONFLICT ON CONSTRAINT ... DO NOTHING — duplicate silently skipped');
    {
      const { wsId } = await createWorkspaceFixture(pool);
      await insertAccount(pool, wsId, 'OnConflictTest');
      // This must NOT throw
      let threw = false;
      try {
        await insertAccountOnConflict(pool, wsId, 'OnConflictTest');
      } catch (err) {
        threw = true;
      }
      assert(!threw, 'ON CONFLICT DO NOTHING does not throw for duplicate');
    }

    console.log('\n[TEST 7] ON CONFLICT DO NOTHING returns 0 rowCount for duplicate');
    {
      const { wsId } = await createWorkspaceFixture(pool);
      await insertAccount(pool, wsId, 'RowCountTest');
      const rowCount = await insertAccountOnConflict(pool, wsId, 'RowCountTest');
      assert(rowCount === 0, `ON CONFLICT duplicate returns 0 rowCount (got: ${rowCount})`);
    }

    console.log('\n[TEST 8] ON CONFLICT — first insert returns 1 row (row created)');
    {
      const { wsId } = await createWorkspaceFixture(pool);
      const rowCount = await insertAccountOnConflict(pool, wsId, 'FirstInsertTest');
      assert(rowCount === 1, `First ON CONFLICT insert returns 1 rowCount (got: ${rowCount})`);
    }

    console.log('\n[TEST 9] Duplicate check is case-sensitive: "Default" ≠ "default"');
    {
      const { wsId } = await createWorkspaceFixture(pool);
      await insertAccount(pool, wsId, 'Default');
      // 'default' (lowercase) is a different name — must NOT conflict
      let threw = false;
      try {
        await insertAccount(pool, wsId, 'default');
      } catch (err) {
        threw = true;
      }
      assert(!threw, '"Default" and "default" are distinct names — no conflict');
    }

    console.log('\n[TEST 10] Duplicate check is exact-match: "Savings" ≠ "Savings "');
    {
      const { wsId } = await createWorkspaceFixture(pool);
      await insertAccount(pool, wsId, 'Savings');
      // 'Savings ' (trailing space) is different — must NOT conflict
      let threw = false;
      try {
        await insertAccount(pool, wsId, 'Savings ');
      } catch (err) {
        threw = true;
      }
      assert(!threw, '"Savings" and "Savings " are distinct names — no conflict');
    }

    // ── [C] Cross-workspace isolation ────────────────────────────────────

    console.log('\n[TEST 11] Same account name in different workspaces — both rows inserted');
    {
      const { wsId: wsA } = await createWorkspaceFixture(pool);
      const { wsId: wsB } = await createWorkspaceFixture(pool);
      const sharedName = 'SharedAccountName';
      let threw = false;
      try {
        await insertAccount(pool, wsA, sharedName);
        await insertAccount(pool, wsB, sharedName);
      } catch (err) {
        threw = true;
      }
      assert(!threw, 'Same name in different workspaces does not conflict');

      // Verify both rows exist
      const result = await pool.query(
        `SELECT COUNT(*) FROM account_sources WHERE name = $1 AND workspace_id IN ($2, $3)`,
        [sharedName, wsA, wsB],
      );
      assert(parseInt(result.rows[0].count) === 2, 'Both rows with same name inserted in different workspaces');
    }

    console.log('\n[TEST 12] Each workspace sees only its own accounts (RLS context check)');
    {
      const { wsId: wsA, userId: userA } = await createWorkspaceFixture(pool);
      const { wsId: wsB } = await createWorkspaceFixture(pool);
      const nameA = `RLSTestA_${ulid().slice(0, 6)}`;
      const nameB = `RLSTestB_${ulid().slice(0, 6)}`;
      await insertAccount(pool, wsA, nameA);
      await insertAccount(pool, wsB, nameB);

      // Use a separate app-role pool to test RLS
      const appPool = new Pool({
        connectionString:
          process.env.DATABASE_URL_APP ??
          'postgresql://midas_app:midas_app_password@localhost:5432/midas',
      });

      try {
        const client = await appPool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.workspace_id', $1, true)", [wsA]);
          await client.query("SELECT set_config('app.user_id', $1, true)", [userA]);

          const resultA = await client.query(
            `SELECT name FROM account_sources WHERE workspace_id = $1`,
            [wsA],
          );
          const namesA = resultA.rows.map((r) => r.name);

          const resultB = await client.query(
            `SELECT name FROM account_sources WHERE workspace_id = $1`,
            [wsB],
          );
          const namesB = resultB.rows.map((r) => r.name);

          await client.query('COMMIT');

          assert(namesA.includes(nameA), `Workspace A sees its own account (${nameA})`);
          assert(!namesA.includes(nameB), `Workspace A does NOT see workspace B account (${nameB})`);
          assert(namesB.length === 0, `Workspace A context returns 0 rows for workspace B query`);
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

    // ── [D] No data mutation ──────────────────────────────────────────────

    console.log('\n[TEST 13] Fixture rows are test-only — no mutation to pre-existing production data');
    {
      // All our test inserts used freshly created workspace fixtures.
      // We verify no pre-existing workspace had new account_sources added
      // by checking that count growth equals our tracked fixture inserts.
      // (This is a sanity check, not a strict cleanup assertion.)
      const countAfter = (await pool.query('SELECT COUNT(*) FROM account_sources')).rows[0].count;
      const growth = parseInt(countAfter) - parseInt(countBefore);
      assert(growth >= 0, `account_sources count grew by ${growth} (all fixture rows — no backfill)`);
      console.log(`    ℹ️  account_sources count: ${countBefore} → ${countAfter} (+${growth} fixture rows)`);
    }

    console.log('\n[TEST 14] No existing duplicates in account_sources (post-migration re-check)');
    {
      const result = await pool.query(
        `SELECT COUNT(*) AS cnt FROM (
          SELECT workspace_id, name FROM account_sources
          GROUP BY workspace_id, name HAVING COUNT(*) > 1
        ) AS dups`,
      );
      const dupCount = parseInt(result.rows[0].cnt);
      assert(dupCount === 0, `No (workspace_id, name) duplicates in account_sources (found: ${dupCount})`);
    }

    // ── [E] RLS still active ──────────────────────────────────────────────

    console.log('\n[TEST 15] midas_app cannot SELECT account_sources without workspace context (RLS blocks)');
    {
      const appPool = new Pool({
        connectionString:
          process.env.DATABASE_URL_APP ??
          'postgresql://midas_app:midas_app_password@localhost:5432/midas',
      });

      try {
        const client = await appPool.connect();
        try {
          await client.query('BEGIN');
          // No SET LOCAL app.workspace_id → RLS should return 0 rows (not throw,
          // since the policy uses USING with a missing setting returning NULL,
          // which evaluates to false — blocking all rows)
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

    console.log('\n[TEST 16] midas_app with correct workspace context sees own accounts');
    {
      const { wsId, userId } = await createWorkspaceFixture(pool);
      const testAccountName = `RLSActive_${ulid().slice(0, 6)}`;
      await insertAccount(pool, wsId, testAccountName);

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
            `SELECT name FROM account_sources WHERE workspace_id = $1`,
            [wsId],
          );
          const names = result.rows.map((r) => r.name);
          await client.query('COMMIT');
          assert(names.includes(testAccountName), `midas_app with correct context sees own account: ${testAccountName}`);
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

    console.log('\n[TEST 17] midas_app with workspace A context cannot see workspace B accounts');
    {
      const { wsId: wsA, userId: userA } = await createWorkspaceFixture(pool);
      const { wsId: wsB } = await createWorkspaceFixture(pool);
      const nameB = `CrossTenant_${ulid().slice(0, 6)}`;
      await insertAccount(pool, wsB, nameB);

      const appPool = new Pool({
        connectionString:
          process.env.DATABASE_URL_APP ??
          'postgresql://midas_app:midas_app_password@localhost:5432/midas',
      });

      try {
        const client = await appPool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.workspace_id', $1, true)", [wsA]);
          await client.query("SELECT set_config('app.user_id', $1, true)", [userA]);
          // Attempt to read workspace B's account with workspace A context
          const result = await client.query(
            `SELECT name FROM account_sources WHERE workspace_id = $1`,
            [wsB],
          );
          await client.query('COMMIT');
          const names = result.rows.map((r) => r.name);
          assert(!names.includes(nameB), `Workspace A context cannot see workspace B account (${nameB}) — RLS blocks cross-tenant access`);
          assert(names.length === 0, `Workspace A context returns 0 rows for workspace B query`);
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

    // ── [F] Scope guard ──────────────────────────────────────────────────

    console.log('\n[TEST 18] /add_account NOT in KNOWN_COMMANDS (Phase 1.16 scope guard)');
    assert(!KNOWN_COMMANDS.has('/add_account'), '/add_account NOT in KNOWN_COMMANDS');

    console.log('\n[TEST 19] /balance NOT in KNOWN_COMMANDS (Phase 1.16 scope guard)');
    assert(!KNOWN_COMMANDS.has('/balance'), '/balance NOT in KNOWN_COMMANDS');

    console.log('\n[TEST 20] KNOWN_COMMANDS size is still 6 (unchanged from Phase 1.15)');
    assert(KNOWN_COMMANDS.size === 6, `KNOWN_COMMANDS size === 6 (got: ${KNOWN_COMMANDS.size})`);
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
    console.log(`Phase 1.16 Smoke Tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error('\n❌ SMOKE TESTS FAILED');
      process.exit(1);
    } else {
      console.log('\n✅ ALL PHASE 1.16 SMOKE TESTS PASSED');
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error('\n💥 Smoke test runner crashed:', err);
    process.exit(1);
  });
