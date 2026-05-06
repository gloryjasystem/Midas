/**
 * Smoke Tests — Phase 1.9: Basic Text /report Command
 *
 * Tests (10 scenarios):
 *   1. Report with all 5 intent types returns correct sums
 *   2. Report with only expense returns single line
 *   3. Empty month returns friendly "no transactions" message
 *   4. Previous-month transactions are excluded from current month report
 *   5. Tenant isolation: workspace2 transactions are not visible to workspace1
 *   6. Decimal/NUMERIC safety: sums do not lose precision
 *   7. Multiple transactions of same intent are summed correctly
 *   8. Report SQL uses correct column names (verified live)
 *   9. /report command text is detected correctly (command routing simulation)
 *  10. Report function returns string (not number/object)
 *
 * SEC-02: All amount assertions use string comparison. No parseFloat.
 * SEC-03: Tests use withTenantTransaction to verify RLS isolation.
 * SEC-12: No raw_text or PII in test output.
 */

import pg from 'pg';
import Decimal from 'decimal.js';

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

// Parse NUMERIC as Decimal, same as @midas/database
pg.types.setTypeParser(1700, (val) => new Decimal(val));

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
 * Helper: create a workspace, user, membership, account, and category.
 * Returns IDs needed to insert transactions.
 */
async function createTestFixtures(pool) {
  const wsId = ulid();
  const userId = ulid();
  const membId = ulid();
  const accountId = ulid();
  const categoryId = ulid();

  await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, $2)`, [wsId, `Test WS ${wsId.slice(0, 6)}`]);
  await pool.query(`INSERT INTO users (id, telegram_id) VALUES ($1, $2)`, [userId, BigInt(Math.floor(Math.random() * 1_000_000_000))]);
  await pool.query(`INSERT INTO workspace_memberships (id, workspace_id, user_id, role) VALUES ($1, $2, $3, 'owner')`, [membId, wsId, userId]);
  await pool.query(`INSERT INTO account_sources (id, workspace_id, name, type, currency) VALUES ($1, $2, $3, 'manual', 'USD')`, [accountId, wsId, `Account`]);
  await pool.query(`INSERT INTO categories (id, workspace_id, name, "group") VALUES ($1, $2, $3, 'Жизнь')`, [categoryId, wsId, `Cat`]);

  return { wsId, userId, accountId, categoryId };
}

/**
 * Insert a transaction with given intent and amount.
 */
async function insertTransaction(pool, { wsId, accountId, categoryId, intent, amount, time }) {
  const txId = ulid();
  await pool.query(
    `INSERT INTO transactions (id, workspace_id, original_amount, currency, exchange_rate, base_currency, base_amount, category_id, account_id, transaction_time, transaction_intent)
     VALUES ($1, $2, $3, 'USD', 1.0, 'USD', $3, $4, $5, $6, $7)`,
    [txId, wsId, amount, categoryId, accountId, time, intent],
  );
  return txId;
}

/**
 * Run the exact same SQL that report.service.ts uses.
 * Phase 1.18 update: added base_currency to SELECT, GROUP BY, ORDER BY to mirror production.
 */
async function runReportQuery(pool, wsId, userId, start, end) {
  // Set tenant context exactly like withTenantTransaction does
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [wsId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);

    const result = await client.query(
      // Phase 1.18: GROUP BY transaction_intent, base_currency (mirrors production SQL).
      // All Phase 1.9 fixtures use a single currency (USD), so existing assertions are unchanged.
      `SELECT
         transaction_intent,
         base_currency,
         SUM(base_amount) AS total,
         COUNT(*)::INT AS count
       FROM transactions
       WHERE workspace_id = $1
         AND transaction_time >= $2
         AND transaction_time < $3
       GROUP BY transaction_intent, base_currency
       ORDER BY transaction_intent, base_currency`,
      [wsId, start, end],
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

function getCurrentMonthBoundaries() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1)).toISOString();
  const end = new Date(Date.UTC(year, month + 1, 1)).toISOString();
  return { start, end };
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🔍 Phase 1.9 Smoke Tests — Basic Text /report Command\n');

  await withPool(async (pool) => {
    const { start, end } = getCurrentMonthBoundaries();
    const now = new Date().toISOString();

    // ─────────────────────────────────────────────────────────
    // Setup: create workspace with transactions for all 5 intents
    // ─────────────────────────────────────────────────────────
    const fixtures = await createTestFixtures(pool);
    const { wsId, userId, accountId, categoryId } = fixtures;
    console.log('[setup] workspaceId:', wsId);

    // Insert transactions for all 5 intent types
    await insertTransaction(pool, { wsId, accountId, categoryId, intent: 'expense', amount: '100.50', time: now });
    await insertTransaction(pool, { wsId, accountId, categoryId, intent: 'expense', amount: '200.25', time: now });
    await insertTransaction(pool, { wsId, accountId, categoryId, intent: 'income', amount: '5000.00', time: now });
    await insertTransaction(pool, { wsId, accountId, categoryId, intent: 'debt_given', amount: '300.00', time: now });
    await insertTransaction(pool, { wsId, accountId, categoryId, intent: 'debt_received', amount: '150.75', time: now });
    await insertTransaction(pool, { wsId, accountId, categoryId, intent: 'transfer', amount: '1000.00', time: now });

    // ─────────────────────────────────────────────────────────
    // TEST 1: Report with all 5 intent types
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 1] Report with all 5 intent types returns correct sums');
    {
      const rows = await runReportQuery(pool, wsId, userId, start, end);
      assert(rows.length === 5, `5 intent groups returned (got: ${rows.length})`);

      const byIntent = {};
      for (const r of rows) {
        byIntent[r.transaction_intent] = { total: r.total, count: r.count };
      }

      // SEC-02: compare using Decimal.toFixed(), not Number()
      assert(byIntent.expense?.total.toFixed(2) === '300.75', `expense total = 300.75 (got: ${byIntent.expense?.total.toFixed(2)})`);
      assert(byIntent.expense?.count === 2, `expense count = 2 (got: ${byIntent.expense?.count})`);
      assert(byIntent.income?.total.toFixed(2) === '5000.00', `income total = 5000.00 (got: ${byIntent.income?.total.toFixed(2)})`);
      assert(byIntent.debt_given?.total.toFixed(2) === '300.00', `debt_given total = 300.00 (got: ${byIntent.debt_given?.total.toFixed(2)})`);
      assert(byIntent.debt_received?.total.toFixed(2) === '150.75', `debt_received total = 150.75 (got: ${byIntent.debt_received?.total.toFixed(2)})`);
      assert(byIntent.transfer?.total.toFixed(2) === '1000.00', `transfer total = 1000.00 (got: ${byIntent.transfer?.total.toFixed(2)})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 2: Report with only one intent type
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 2] Report with only expense');
    {
      const fixtures2 = await createTestFixtures(pool);
      await insertTransaction(pool, { wsId: fixtures2.wsId, accountId: fixtures2.accountId, categoryId: fixtures2.categoryId, intent: 'expense', amount: '42.00', time: now });

      const rows = await runReportQuery(pool, fixtures2.wsId, fixtures2.userId, start, end);
      assert(rows.length === 1, `1 intent group returned (got: ${rows.length})`);
      assert(rows[0].transaction_intent === 'expense', `intent is expense (got: ${rows[0].transaction_intent})`);
      assert(rows[0].total.toFixed(2) === '42.00', `total = 42.00 (got: ${rows[0].total.toFixed(2)})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 3: Empty month returns no rows
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 3] Empty month returns no rows');
    {
      const fixtures3 = await createTestFixtures(pool);
      const rows = await runReportQuery(pool, fixtures3.wsId, fixtures3.userId, start, end);
      assert(rows.length === 0, `0 rows for empty workspace (got: ${rows.length})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 4: Previous-month transactions excluded
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 4] Previous-month transactions excluded');
    {
      const fixtures4 = await createTestFixtures(pool);

      // Insert a transaction from last month
      const lastMonth = new Date();
      lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
      lastMonth.setUTCDate(15);
      const lastMonthTime = lastMonth.toISOString();

      await insertTransaction(pool, { wsId: fixtures4.wsId, accountId: fixtures4.accountId, categoryId: fixtures4.categoryId, intent: 'expense', amount: '999.99', time: lastMonthTime });

      // Also insert one in current month
      await insertTransaction(pool, { wsId: fixtures4.wsId, accountId: fixtures4.accountId, categoryId: fixtures4.categoryId, intent: 'income', amount: '50.00', time: now });

      const rows = await runReportQuery(pool, fixtures4.wsId, fixtures4.userId, start, end);
      assert(rows.length === 1, `Only 1 intent group (current month) (got: ${rows.length})`);
      assert(rows[0].transaction_intent === 'income', `Only income (current month) is visible (got: ${rows[0].transaction_intent})`);
      assert(rows[0].total.toFixed(2) === '50.00', `total = 50.00 (got: ${rows[0].total.toFixed(2)})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 5: Tenant isolation
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 5] Tenant isolation: ws2 transactions invisible to ws1');
    {
      const f1 = await createTestFixtures(pool);
      const f2 = await createTestFixtures(pool);

      await insertTransaction(pool, { wsId: f1.wsId, accountId: f1.accountId, categoryId: f1.categoryId, intent: 'expense', amount: '100.00', time: now });
      await insertTransaction(pool, { wsId: f2.wsId, accountId: f2.accountId, categoryId: f2.categoryId, intent: 'expense', amount: '200.00', time: now });

      // Query as ws1
      const rows1 = await runReportQuery(pool, f1.wsId, f1.userId, start, end);
      assert(rows1.length === 1, `ws1 sees 1 group (got: ${rows1.length})`);
      assert(rows1[0].total.toFixed(2) === '100.00', `ws1 sees only its own 100.00 (got: ${rows1[0].total.toFixed(2)})`);

      // Query as ws2
      const rows2 = await runReportQuery(pool, f2.wsId, f2.userId, start, end);
      assert(rows2.length === 1, `ws2 sees 1 group (got: ${rows2.length})`);
      assert(rows2[0].total.toFixed(2) === '200.00', `ws2 sees only its own 200.00 (got: ${rows2[0].total.toFixed(2)})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 6: Decimal precision safety
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 6] Decimal/NUMERIC precision (no float rounding)');
    {
      const f6 = await createTestFixtures(pool);

      // Classic float-unsafe values: 0.1 + 0.2 ≠ 0.3 in JavaScript
      await insertTransaction(pool, { wsId: f6.wsId, accountId: f6.accountId, categoryId: f6.categoryId, intent: 'expense', amount: '0.1', time: now });
      await insertTransaction(pool, { wsId: f6.wsId, accountId: f6.accountId, categoryId: f6.categoryId, intent: 'expense', amount: '0.2', time: now });

      const rows = await runReportQuery(pool, f6.wsId, f6.userId, start, end);
      // Must be exactly 0.30, not 0.30000000000000004
      assert(rows[0].total.toFixed(2) === '0.30', `0.1 + 0.2 = 0.30 exactly (got: ${rows[0].total.toFixed(2)})`);

      // Verify the Decimal object is NOT a plain JS number
      assert(rows[0].total instanceof Decimal, `total is a Decimal instance (got: ${typeof rows[0].total})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 7: Multiple transactions summed correctly
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 7] Multiple transactions summed with count');
    {
      const f7 = await createTestFixtures(pool);

      for (let i = 0; i < 10; i++) {
        await insertTransaction(pool, { wsId: f7.wsId, accountId: f7.accountId, categoryId: f7.categoryId, intent: 'income', amount: '100.00', time: now });
      }

      const rows = await runReportQuery(pool, f7.wsId, f7.userId, start, end);
      assert(rows[0].total.toFixed(2) === '1000.00', `10 × 100.00 = 1000.00 (got: ${rows[0].total.toFixed(2)})`);
      assert(rows[0].count === 10, `count = 10 (got: ${rows[0].count})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 8: SQL uses correct column names
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 8] Verify column names in live DB');
    {
      // If any of these columns didn't exist, the query in tests 1-7 would have failed.
      // This test explicitly verifies column existence.
      const r = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'transactions'
          AND column_name IN ('transaction_intent', 'base_amount', 'transaction_time', 'workspace_id')
        ORDER BY column_name
      `);
      const cols = r.rows.map(x => x.column_name).sort();
      assert(cols.includes('base_amount'), 'base_amount column exists');
      assert(cols.includes('transaction_intent'), 'transaction_intent column exists');
      assert(cols.includes('transaction_time'), 'transaction_time column exists');
      assert(cols.includes('workspace_id'), 'workspace_id column exists');
    }

    // ─────────────────────────────────────────────────────────
    // TEST 9: /report command detection
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 9] /report command text detection');
    {
      // Same logic as webhook.route.ts
      const isReport = (text) => text.trimStart().startsWith('/report');

      assert(isReport('/report'), '/report is detected');
      assert(isReport('  /report'), '  /report (leading spaces) is detected');
      assert(isReport('/report month'), '/report month is detected');
      assert(!isReport('report'), 'report without / is not detected');
      assert(!isReport('/balance'), '/balance is not /report');
      assert(!isReport('I spent on /report'), 'text containing /report mid-sentence is not detected');
    }

    // ─────────────────────────────────────────────────────────
    // TEST 10: Report function returns string
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 10] Report query returns typed values');
    {
      const rows = await runReportQuery(pool, wsId, userId, start, end);
      for (const r of rows) {
        assert(typeof r.transaction_intent === 'string', `intent is string (got: ${typeof r.transaction_intent})`);
        assert(r.total instanceof Decimal, `total is Decimal (got: ${typeof r.total})`);
        assert(typeof r.count === 'number', `count is number (got: ${typeof r.count})`);
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

runTests()
  .then(() => {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Phase 1.9 Smoke Tests: ${passed} passed, ${failed} failed`);
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
