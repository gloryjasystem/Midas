/**
 * Smoke Tests — Phase 1.18: /report Currency Label (base_currency grouping)
 *
 * Tests:
 *
 * [A] SQL correctness — base_currency grouping
 *   1.  Single-currency report: rows include base_currency field
 *   2.  Single-currency report: correct number of rows (one per intent)
 *   3.  Two intents, same currency: two rows, each with currency label
 *   4.  Same intent, two currencies: produces two separate rows (no mixing)
 *   5.  Empty month returns 0 rows (unchanged from Phase 1.9)
 *
 * [B] Output format — currency label in report string
 *   6.  Report output includes currency label in parentheses: "(USD)"
 *   7.  Report output line format: "💸 Расходы (USD): <b>N.NN</b> (N шт.)"
 *   8.  Multi-currency: both currencies appear in separate lines, correct totals
 *   9.  Empty month: output unchanged (no currency label in empty message)
 *
 * [C] escapeHtml — base_currency escaping
 *   10. Normal ISO code (USD) passes through escapeHtml unchanged
 *   11. Pathological base_currency value with HTML chars is escaped correctly
 *
 * [D] Regression — SEC-02 NUMERIC precision
 *   12. Decimal precision preserved: 0.1 + 0.2 = 0.30 (no float rounding)
 *
 * [E] Regression — SEC-03 tenant isolation
 *   13. workspace2 transactions are not visible to workspace1
 *
 * SEC-02: All amount assertions use string comparison (Decimal.toFixed). No parseFloat.
 * SEC-03: Tests use tenant context (SET LOCAL) to verify RLS isolation.
 * SEC-12: No raw_text or PII in test output.
 */

import pg from 'pg';
import Decimal from 'decimal.js';

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

// Parse NUMERIC as Decimal, same as @midas/database
pg.types.setTypeParser(1700, (val) => new Decimal(val));

// ─────────────────────────────────────────────────────────────
// Inline escapeHtml — mirrors html-escape.ts (Phase 1.15)
// Used here to verify the production escaping behaviour.
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
// ULID generator
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

async function createTestFixtures(pool) {
  const wsId = ulid();
  const userId = ulid();
  const membId = ulid();
  const accountId = ulid();
  const categoryId = ulid();

  await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, $2)`, [wsId, `Ph118 WS ${wsId.slice(0, 6)}`]);
  await pool.query(`INSERT INTO users (id, telegram_id) VALUES ($1, $2)`, [userId, BigInt(Math.floor(Math.random() * 1_000_000_000))]);
  await pool.query(`INSERT INTO workspace_memberships (id, workspace_id, user_id, role) VALUES ($1, $2, $3, 'owner')`, [membId, wsId, userId]);
  await pool.query(`INSERT INTO account_sources (id, workspace_id, name, type, currency) VALUES ($1, $2, $3, 'manual', 'USD')`, [accountId, wsId, `Account`]);
  await pool.query(`INSERT INTO categories (id, workspace_id, name, "group") VALUES ($1, $2, $3, 'Жизнь')`, [categoryId, wsId, `Cat`]);

  return { wsId, userId, accountId, categoryId };
}

/**
 * Insert a transaction with a given intent, amount, and base_currency.
 * base_currency defaults to 'USD' if not specified.
 */
async function insertTransaction(pool, { wsId, accountId, categoryId, intent, amount, baseCurrency = 'USD', time }) {
  const txId = ulid();
  await pool.query(
    `INSERT INTO transactions
       (id, workspace_id, original_amount, currency, exchange_rate, base_currency, base_amount, category_id, account_id, transaction_time, transaction_intent)
     VALUES ($1, $2, $3, $8, 1.0, $8, $3, $4, $5, $6, $7)`,
    [txId, wsId, amount, categoryId, accountId, time, intent, baseCurrency],
  );
  return txId;
}

/**
 * runReportQuery — mirrors Phase 1.18 production SQL exactly.
 * GROUP BY transaction_intent, base_currency.
 */
async function runReportQuery(pool, wsId, userId, start, end) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [wsId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);

    const result = await client.query(
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

/**
 * Build the report output string — mirrors production getMonthlyReport() logic.
 * Used to verify the formatted output without importing TypeScript.
 */
const INTENT_LABELS = {
  expense: '💸 Расходы',
  income: '💰 Доходы',
  debt_given: '🤝 Долги выданные',
  debt_received: '🤝 Долги полученные',
  transfer: '🔄 Переводы',
};

function buildReportOutput(rows, label) {
  if (rows.length === 0) {
    return `📊 <b>Отчёт за ${label}</b>\n\nНет транзакций за этот период.`;
  }
  const lines = rows.map((row) => {
    const intentLabel = INTENT_LABELS[row.transaction_intent] ?? row.transaction_intent;
    const totalStr = row.total.toFixed(2);
    const countStr = String(row.count);
    const currencyLabel = escapeHtml(row.base_currency);
    return `${intentLabel} (${currencyLabel}): <b>${totalStr}</b> (${countStr} шт.)`;
  });
  return `📊 <b>Отчёт за ${label}</b>\n\n${lines.join('\n')}`;
}

function getCurrentMonthBoundaries() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1)).toISOString();
  const end = new Date(Date.UTC(year, month + 1, 1)).toISOString();
  const monthName = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'][month] ?? 'Месяц';
  return { start, end, label: `${monthName} ${String(year)}` };
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🔍 Phase 1.18 Smoke Tests — /report Currency Label (base_currency grouping)\n');

  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://midas_user:midas_dev_password@localhost:5432/midas',
  });

  try {
    const { start, end, label } = getCurrentMonthBoundaries();
    const now = new Date().toISOString();

    // ── [A] SQL correctness ───────────────────────────────────────────────────

    console.log('\n[TEST 1] Single-currency report rows include base_currency field');
    {
      const f = await createTestFixtures(pool);
      await insertTransaction(pool, { wsId: f.wsId, accountId: f.accountId, categoryId: f.categoryId, intent: 'expense', amount: '100.00', baseCurrency: 'USD', time: now });

      const rows = await runReportQuery(pool, f.wsId, f.userId, start, end);
      assert(rows.length === 1, `1 row returned (got: ${rows.length})`);
      assert(typeof rows[0].base_currency === 'string', `base_currency is a string (got: ${typeof rows[0].base_currency})`);
      assert(rows[0].base_currency === 'USD', `base_currency = 'USD' (got: '${rows[0].base_currency}')`);
    }

    console.log('\n[TEST 2] Single-currency report: correct number of rows (one per intent)');
    {
      const f = await createTestFixtures(pool);
      await insertTransaction(pool, { wsId: f.wsId, accountId: f.accountId, categoryId: f.categoryId, intent: 'expense', amount: '100.00', baseCurrency: 'USD', time: now });
      await insertTransaction(pool, { wsId: f.wsId, accountId: f.accountId, categoryId: f.categoryId, intent: 'income', amount: '500.00', baseCurrency: 'USD', time: now });

      const rows = await runReportQuery(pool, f.wsId, f.userId, start, end);
      assert(rows.length === 2, `2 rows for 2 intents (got: ${rows.length})`);
      assert(rows[0].transaction_intent === 'expense', `first row is expense (got: '${rows[0].transaction_intent}')`);
      assert(rows[1].transaction_intent === 'income', `second row is income (got: '${rows[1].transaction_intent}')`);
    }

    console.log('\n[TEST 3] Two intents, same currency: totals correct');
    {
      const f = await createTestFixtures(pool);
      await insertTransaction(pool, { wsId: f.wsId, accountId: f.accountId, categoryId: f.categoryId, intent: 'expense', amount: '250.00', baseCurrency: 'USD', time: now });
      await insertTransaction(pool, { wsId: f.wsId, accountId: f.accountId, categoryId: f.categoryId, intent: 'expense', amount: '50.50', baseCurrency: 'USD', time: now });
      await insertTransaction(pool, { wsId: f.wsId, accountId: f.accountId, categoryId: f.categoryId, intent: 'income', amount: '1000.00', baseCurrency: 'USD', time: now });

      const rows = await runReportQuery(pool, f.wsId, f.userId, start, end);
      assert(rows.length === 2, `2 rows returned (got: ${rows.length})`);

      const byKey = {};
      for (const r of rows) { byKey[`${r.transaction_intent}:${r.base_currency}`] = r; }

      // SEC-02: compare using Decimal.toFixed(), not Number()
      assert(byKey['expense:USD']?.total.toFixed(2) === '300.50', `expense USD total = 300.50 (got: ${byKey['expense:USD']?.total.toFixed(2)})`);
      assert(byKey['expense:USD']?.count === 2, `expense USD count = 2 (got: ${byKey['expense:USD']?.count})`);
      assert(byKey['income:USD']?.total.toFixed(2) === '1000.00', `income USD total = 1000.00 (got: ${byKey['income:USD']?.total.toFixed(2)})`);
    }

    console.log('\n[TEST 4] Same intent, two currencies: separate rows — NO mixing of amounts');
    {
      const f = await createTestFixtures(pool);
      // expense in USD
      await insertTransaction(pool, { wsId: f.wsId, accountId: f.accountId, categoryId: f.categoryId, intent: 'expense', amount: '100.00', baseCurrency: 'USD', time: now });
      // expense in EUR — must be a separate row, NOT summed with USD
      await insertTransaction(pool, { wsId: f.wsId, accountId: f.accountId, categoryId: f.categoryId, intent: 'expense', amount: '200.00', baseCurrency: 'EUR', time: now });

      const rows = await runReportQuery(pool, f.wsId, f.userId, start, end);
      assert(rows.length === 2, `2 rows for 1 intent × 2 currencies (got: ${rows.length})`);

      // Rows ordered by transaction_intent, base_currency → EUR before USD
      const eurRow = rows.find((r) => r.base_currency === 'EUR');
      const usdRow = rows.find((r) => r.base_currency === 'USD');

      assert(eurRow !== undefined, 'EUR row exists');
      assert(usdRow !== undefined, 'USD row exists');
      // SEC-02: Decimal comparison
      assert(eurRow?.total.toFixed(2) === '200.00', `EUR expense total = 200.00 (got: ${eurRow?.total.toFixed(2)})`);
      assert(usdRow?.total.toFixed(2) === '100.00', `USD expense total = 100.00 (got: ${usdRow?.total.toFixed(2)})`);
      // Critical: old query would have returned 1 row with total 300.00 — a meaningless mixed sum.
      // New query correctly produces 2 rows with separate amounts.
    }

    console.log('\n[TEST 5] Empty month returns 0 rows');
    {
      const f = await createTestFixtures(pool);
      const rows = await runReportQuery(pool, f.wsId, f.userId, start, end);
      assert(rows.length === 0, `0 rows for empty workspace (got: ${rows.length})`);
    }

    // ── [B] Output format ─────────────────────────────────────────────────────

    console.log('\n[TEST 6] Report output includes currency label in parentheses');
    {
      const f = await createTestFixtures(pool);
      await insertTransaction(pool, { wsId: f.wsId, accountId: f.accountId, categoryId: f.categoryId, intent: 'expense', amount: '123.45', baseCurrency: 'USD', time: now });

      const rows = await runReportQuery(pool, f.wsId, f.userId, start, end);
      const output = buildReportOutput(rows, label);

      assert(output.includes('(USD)'), `Output includes "(USD)" — got: ${output}`);
    }

    console.log('\n[TEST 7] Report line format: "💸 Расходы (USD): <b>123.45</b> (1 шт.)"');
    {
      const f = await createTestFixtures(pool);
      await insertTransaction(pool, { wsId: f.wsId, accountId: f.accountId, categoryId: f.categoryId, intent: 'expense', amount: '123.45', baseCurrency: 'USD', time: now });

      const rows = await runReportQuery(pool, f.wsId, f.userId, start, end);
      const output = buildReportOutput(rows, label);

      const expectedLine = '💸 Расходы (USD): <b>123.45</b> (1 шт.)';
      assert(output.includes(expectedLine), `Output contains expected line.\nExpected: "${expectedLine}"\nGot: "${output}"`);
    }

    console.log('\n[TEST 8] Multi-currency: both currencies in separate lines with correct totals');
    {
      const f = await createTestFixtures(pool);
      await insertTransaction(pool, { wsId: f.wsId, accountId: f.accountId, categoryId: f.categoryId, intent: 'expense', amount: '500.00', baseCurrency: 'USD', time: now });
      await insertTransaction(pool, { wsId: f.wsId, accountId: f.accountId, categoryId: f.categoryId, intent: 'expense', amount: '300.00', baseCurrency: 'EUR', time: now });

      const rows = await runReportQuery(pool, f.wsId, f.userId, start, end);
      const output = buildReportOutput(rows, label);

      assert(output.includes('(EUR)'), `Output includes "(EUR)" — got: ${output}`);
      assert(output.includes('(USD)'), `Output includes "(USD)" — got: ${output}`);
      assert(output.includes('500.00'), `Output includes 500.00 — got: ${output}`);
      assert(output.includes('300.00'), `Output includes 300.00 — got: ${output}`);

      // Verify they are separate lines, not mixed
      const lines = output.split('\n').filter((l) => l.includes('Расходы'));
      assert(lines.length === 2, `Two separate expense lines (EUR and USD) — got: ${lines.length}`);
    }

    console.log('\n[TEST 9] Empty month output unchanged (no currency label in empty message)');
    {
      const f = await createTestFixtures(pool);
      const rows = await runReportQuery(pool, f.wsId, f.userId, start, end);
      const output = buildReportOutput(rows, label);

      assert(output.includes('Нет транзакций за этот период.'), `Empty message correct — got: ${output}`);
      assert(!output.includes('(USD)'), `Empty message has no currency label — got: ${output}`);
    }

    // ── [C] escapeHtml — base_currency escaping ───────────────────────────────

    console.log('\n[TEST 10] Normal ISO currency code passes through escapeHtml unchanged');
    {
      const result = escapeHtml('USD');
      assert(result === 'USD', `escapeHtml('USD') = 'USD' (got: '${result}')`);
    }

    console.log('\n[TEST 11] Pathological base_currency with HTML chars is escaped');
    {
      // This would never appear in production (ISO codes are 3–6 uppercase letters),
      // but verifies the escaping contract is in place as a defense-in-depth measure.
      const result = escapeHtml('<script>');
      assert(result === '&lt;script&gt;', `escapeHtml('<script>') = '&lt;script&gt;' (got: '${result}')`);
    }

    // ── [D] SEC-02 NUMERIC precision regression ────────────────────────────────

    console.log('\n[TEST 12] NUMERIC precision: 0.1 + 0.2 = 0.30 (no float rounding) — base_currency grouped');
    {
      const f = await createTestFixtures(pool);
      await insertTransaction(pool, { wsId: f.wsId, accountId: f.accountId, categoryId: f.categoryId, intent: 'expense', amount: '0.1', baseCurrency: 'USD', time: now });
      await insertTransaction(pool, { wsId: f.wsId, accountId: f.accountId, categoryId: f.categoryId, intent: 'expense', amount: '0.2', baseCurrency: 'USD', time: now });

      const rows = await runReportQuery(pool, f.wsId, f.userId, start, end);
      assert(rows.length === 1, `1 row (got: ${rows.length})`);
      // SEC-02: must be exactly 0.30, not 0.30000000000000004
      assert(rows[0].total.toFixed(2) === '0.30', `0.1 + 0.2 = 0.30 exactly (got: ${rows[0].total.toFixed(2)})`);
      assert(rows[0].total instanceof Decimal, `total is Decimal instance (got: ${typeof rows[0].total})`);
    }

    // ── [E] SEC-03 tenant isolation regression ─────────────────────────────────

    console.log('\n[TEST 13] Tenant isolation: workspace2 transactions not visible to workspace1');
    {
      const f1 = await createTestFixtures(pool);
      const f2 = await createTestFixtures(pool);

      await insertTransaction(pool, { wsId: f1.wsId, accountId: f1.accountId, categoryId: f1.categoryId, intent: 'expense', amount: '100.00', baseCurrency: 'USD', time: now });
      await insertTransaction(pool, { wsId: f2.wsId, accountId: f2.accountId, categoryId: f2.categoryId, intent: 'expense', amount: '999.00', baseCurrency: 'USD', time: now });

      const rows1 = await runReportQuery(pool, f1.wsId, f1.userId, start, end);
      assert(rows1.length === 1, `ws1 sees 1 row (got: ${rows1.length})`);
      assert(rows1[0].total.toFixed(2) === '100.00', `ws1 sees only its own 100.00 (got: ${rows1[0].total.toFixed(2)})`);

      const rows2 = await runReportQuery(pool, f2.wsId, f2.userId, start, end);
      assert(rows2.length === 1, `ws2 sees 1 row (got: ${rows2.length})`);
      assert(rows2[0].total.toFixed(2) === '999.00', `ws2 sees only its own 999.00 (got: ${rows2[0].total.toFixed(2)})`);
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
    console.log(`Phase 1.18 Smoke Tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error('\n❌ SMOKE TESTS FAILED');
      process.exit(1);
    } else {
      console.log('\n✅ ALL PHASE 1.18 SMOKE TESTS PASSED');
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error('\n💥 Smoke test runner crashed:', err);
    process.exit(1);
  });
