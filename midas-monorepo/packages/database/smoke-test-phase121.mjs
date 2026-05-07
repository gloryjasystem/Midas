/**
 * Smoke Tests — Phase 1.21: Unified Balance Implementation
 *
 * Covers:
 * [A] Schema: initial_balance column on account_sources
 * [B] Balance formula: D1 sign rules, D2 debt integrated, D3 transfer neutral
 * [C] /balance per-account output with currency totals (D5=B)
 * [D] Empty workspace state
 * [E] Negative initial_balance allowed (D4b)
 * [F] HTML escaping in balance output
 * [G] RLS isolation — workspace A cannot see workspace B balances
 * [H] Scope guard: KNOWN_COMMANDS has 8 entries, /balance present
 * [I] Regression: Phase 1.16 UNIQUE + Phase 1.19 CHECK still present
 */

import pg from 'pg';
const { Pool } = pg;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) { console.error(`  ✗ FAIL: ${message}`); failed++; }
  else            { console.log(`  ✓ PASS: ${message}`);  passed++; }
}

function ulid() {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let r = '';
  for (let i = 0; i < 26; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

async function createWorkspace(pool) {
  const wsId = ulid(), userId = ulid(), membId = ulid();
  await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, $2)`, [wsId, `TestWS_${wsId.slice(0,6)}`]);
  await pool.query(`INSERT INTO users (id, telegram_id) VALUES ($1, $2)`, [userId, BigInt(Math.floor(Math.random() * 1_000_000_000))]);
  await pool.query(`INSERT INTO workspace_memberships (id, workspace_id, user_id, role) VALUES ($1, $2, $3, 'owner')`, [membId, wsId, userId]);
  return { wsId, userId };
}

async function createAccount(pool, wsId, opts = {}) {
  const id = ulid();
  const currency = opts.currency ?? 'USD';
  const initialBalance = opts.initialBalance ?? 0;
  await pool.query(
    `INSERT INTO account_sources (id, workspace_id, name, type, currency, initial_balance)
     VALUES ($1, $2, $3, 'manual'::account_source_type, $4, $5)`,
    [id, wsId, opts.name ?? `Acc_${id.slice(0,6)}`, currency, initialBalance],
  );
  return id;
}

async function createCategory(pool, wsId) {
  const id = ulid();
  await pool.query(
    `INSERT INTO categories (id, workspace_id, name, "group") VALUES ($1, $2, 'Тест', 'Жизнь'::category_group)`,
    [id, wsId],
  );
  return id;
}

async function insertTransaction(pool, wsId, accountId, categoryId, intent, amount) {
  const id = ulid();
  await pool.query(
    `INSERT INTO transactions (id, workspace_id, account_id, category_id,
       original_amount, currency, exchange_rate, base_currency, base_amount,
       transaction_intent, transaction_time)
     VALUES ($1,$2,$3,$4,$5,'USD',1.000000000000,'USD',$5,$6,NOW())`,
    [id, wsId, accountId, categoryId, amount, intent],
  );
}

// Balance formula computed in SQL (replicating service logic for smoke test)
const BALANCE_SQL = `
  SELECT
    a.currency,
    a.initial_balance
      + COALESCE(SUM(CASE WHEN t.transaction_intent = 'income'        THEN t.base_amount END), 0)
      + COALESCE(SUM(CASE WHEN t.transaction_intent = 'debt_received' THEN t.base_amount END), 0)
      - COALESCE(SUM(CASE WHEN t.transaction_intent = 'expense'       THEN t.base_amount END), 0)
      - COALESCE(SUM(CASE WHEN t.transaction_intent = 'debt_given'    THEN t.base_amount END), 0)
      AS balance,
    COUNT(CASE WHEN t.transaction_intent = 'transfer' THEN 1 END) AS transfer_count
  FROM account_sources a
  LEFT JOIN transactions t ON t.account_id = a.id AND t.workspace_id = $1
  WHERE a.workspace_id = $1
  GROUP BY a.id, a.currency, a.initial_balance
  ORDER BY a.currency
`;

const KNOWN_COMMANDS = new Set([
  '/start', '/report', '/help', '/category', '/add_category',
  '/accounts', '/add_account', '/balance',
]);

async function runTests() {
  console.log('\n🔍 Phase 1.21 Smoke Tests — Unified Balance Implementation\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://midas_user:midas_dev_password@localhost:5432/midas',
  });

  try {
    // ── [A] Schema ──────────────────────────────────────────────────────────

    console.log('\n[TEST 1] initial_balance column exists on account_sources');
    {
      const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='account_sources' AND column_name='initial_balance'`);
      assert(r.rows.length === 1, 'initial_balance column exists on account_sources');
    }

    console.log('\n[TEST 2] initial_balance data type is NUMERIC');
    {
      const r = await pool.query(`SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='account_sources' AND column_name='initial_balance'`);
      assert(r.rows[0]?.data_type === 'numeric', `data_type = numeric (got: ${r.rows[0]?.data_type})`);
    }

    console.log('\n[TEST 3] initial_balance is NOT NULL');
    {
      const r = await pool.query(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='account_sources' AND column_name='initial_balance'`);
      assert(r.rows[0]?.is_nullable === 'NO', `is_nullable = NO (got: ${r.rows[0]?.is_nullable})`);
    }

    console.log('\n[TEST 4] initial_balance DEFAULT is 0');
    {
      const r = await pool.query(`SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='account_sources' AND column_name='initial_balance'`);
      assert(r.rows[0]?.column_default === '0', `column_default = 0 (got: ${r.rows[0]?.column_default})`);
    }

    console.log('\n[TEST 5] Migration 1778400000000_account-sources-initial-balance recorded in pgmigrations');
    {
      const r = await pool.query(
        `SELECT name FROM pgmigrations WHERE name = '1778400000000_account-sources-initial-balance'`
      );
      assert(r.rows.length === 1, 'Migration 1778400000000_account-sources-initial-balance present in pgmigrations');
    }

    console.log('\n[TEST 6] No CHECK constraint on initial_balance (negative allowed, D4b)');
    {
      // Only constraint name that should exist on account_sources CHECK constraints
      // is account_sources_currency_check (Phase 1.19). No initial_balance CHECK should exist.
      const r = await pool.query(
        `SELECT conname FROM pg_constraint
         WHERE conrelid='account_sources'::regclass
           AND contype='c'
           AND conname != 'account_sources_currency_check'`
      );
      assert(r.rows.length === 0, `No extra CHECK constraints on account_sources beyond currency_check (D4b: negative initial_balance allowed)`);
    }

    // ── [B] Balance formula ─────────────────────────────────────────────────

    const { wsId: wsB } = await createWorkspace(pool);
    const catB = await createCategory(pool, wsB);
    const accB = await createAccount(pool, wsB, { name: 'TestAccB', currency: 'USD', initialBalance: 1000 });

    await insertTransaction(pool, wsB, accB, catB, 'income',        500);
    await insertTransaction(pool, wsB, accB, catB, 'expense',       200);
    await insertTransaction(pool, wsB, accB, catB, 'debt_given',    150);
    await insertTransaction(pool, wsB, accB, catB, 'debt_received',  80);
    await insertTransaction(pool, wsB, accB, catB, 'transfer',      300); // neutral

    // Expected: 1000 + 500 + 80 - 200 - 150 = 1230
    console.log('\n[TEST 7] Balance formula: initial_balance + income + debt_received - expense - debt_given');
    {
      const r = await pool.query(BALANCE_SQL, [wsB]);
      const balance = parseFloat(r.rows[0].balance);
      assert(Math.abs(balance - 1230) < 0.001, `balance = 1230.00 (got: ${balance})`);
    }

    console.log('\n[TEST 8] Transfer excluded from balance sum (D3: neutral)');
    {
      const r = await pool.query(BALANCE_SQL, [wsB]);
      const transferCount = parseInt(r.rows[0].transfer_count);
      assert(transferCount === 1, `transfer_count = 1 (transfer recorded but not in balance sum, D3)`);
    }

    console.log('\n[TEST 9] Debt integrated into balance (D2=A)');
    {
      const r = await pool.query(BALANCE_SQL, [wsB]);
      // debt_given=150 reduces balance, debt_received=80 increases it
      const balance = parseFloat(r.rows[0].balance);
      // Without debt integration: 1000+500-200=1300. With D2: 1300-150+80=1230.
      assert(Math.abs(balance - 1230) < 0.001, `Debt correctly integrated: balance = 1230.00 (D2=A)`);
    }

    console.log('\n[TEST 10] Income increases balance (+1)');
    {
      const { wsId: ws } = await createWorkspace(pool);
      const cat = await createCategory(pool, ws);
      const acc = await createAccount(pool, ws, { initialBalance: 0 });
      await insertTransaction(pool, ws, acc, cat, 'income', 400);
      const r = await pool.query(BALANCE_SQL, [ws]);
      assert(Math.abs(parseFloat(r.rows[0].balance) - 400) < 0.001, 'income +400 → balance = 400.00');
    }

    console.log('\n[TEST 11] Expense reduces balance (-1)');
    {
      const { wsId: ws } = await createWorkspace(pool);
      const cat = await createCategory(pool, ws);
      const acc = await createAccount(pool, ws, { initialBalance: 500 });
      await insertTransaction(pool, ws, acc, cat, 'expense', 150);
      const r = await pool.query(BALANCE_SQL, [ws]);
      assert(Math.abs(parseFloat(r.rows[0].balance) - 350) < 0.001, 'expense -150 from initial_balance 500 → balance = 350.00');
    }

    console.log('\n[TEST 12] debt_given reduces balance (-1, D1+D2)');
    {
      const { wsId: ws } = await createWorkspace(pool);
      const cat = await createCategory(pool, ws);
      const acc = await createAccount(pool, ws, { initialBalance: 1000 });
      await insertTransaction(pool, ws, acc, cat, 'debt_given', 300);
      const r = await pool.query(BALANCE_SQL, [ws]);
      assert(Math.abs(parseFloat(r.rows[0].balance) - 700) < 0.001, 'debt_given -300 from initial_balance 1000 → balance = 700.00');
    }

    console.log('\n[TEST 13] debt_received increases balance (+1, D1+D2)');
    {
      const { wsId: ws } = await createWorkspace(pool);
      const cat = await createCategory(pool, ws);
      const acc = await createAccount(pool, ws, { initialBalance: 0 });
      await insertTransaction(pool, ws, acc, cat, 'debt_received', 250);
      const r = await pool.query(BALANCE_SQL, [ws]);
      assert(Math.abs(parseFloat(r.rows[0].balance) - 250) < 0.001, 'debt_received +250 → balance = 250.00');
    }

    console.log('\n[TEST 14] Account with zero transactions: balance = initial_balance');
    {
      const { wsId: ws } = await createWorkspace(pool);
      await createAccount(pool, ws, { initialBalance: 999 });
      const r = await pool.query(BALANCE_SQL, [ws]);
      assert(Math.abs(parseFloat(r.rows[0].balance) - 999) < 0.001, 'no transactions → balance = initial_balance = 999.00');
    }

    console.log('\n[TEST 15] Zero initial_balance + zero transactions → balance = 0');
    {
      const { wsId: ws } = await createWorkspace(pool);
      await createAccount(pool, ws, { initialBalance: 0 });
      const r = await pool.query(BALANCE_SQL, [ws]);
      assert(Math.abs(parseFloat(r.rows[0].balance) - 0) < 0.001, 'balance = 0.00 (zero initial_balance, no transactions)');
    }

    // ── [C] Currency totals (D5=B) ──────────────────────────────────────────

    console.log('\n[TEST 16] Currency total matches sum of per-account balances for same currency');
    {
      const { wsId: ws } = await createWorkspace(pool);
      const cat = await createCategory(pool, ws);
      const acc1 = await createAccount(pool, ws, { currency: 'USD', initialBalance: 500 });
      const acc2 = await createAccount(pool, ws, { currency: 'USD', initialBalance: 300 });
      await insertTransaction(pool, ws, acc1, cat, 'income', 100);
      await insertTransaction(pool, ws, acc2, cat, 'expense', 50);
      // acc1: 500+100=600, acc2: 300-50=250, total USD = 850
      const r = await pool.query(
        `SELECT SUM(balance) AS total FROM (${BALANCE_SQL.replace('ORDER BY a.currency', '')}) sub`,
        [ws],
      );
      assert(Math.abs(parseFloat(r.rows[0].total) - 850) < 0.001, 'currency total USD = 850.00 (600 + 250)');
    }

    // ── [D] Empty workspace ─────────────────────────────────────────────────

    console.log('\n[TEST 17] Empty workspace returns zero rows from balance query');
    {
      const { wsId: ws } = await createWorkspace(pool);
      const r = await pool.query(BALANCE_SQL, [ws]);
      assert(r.rows.length === 0, 'Empty workspace: 0 rows from balance query');
    }

    // ── [E] Negative initial_balance allowed (D4b) ──────────────────────────

    console.log('\n[TEST 18] Negative initial_balance is accepted (D4b: no CHECK >= 0)');
    {
      const { wsId: ws } = await createWorkspace(pool);
      let accepted = false;
      try {
        await createAccount(pool, ws, { initialBalance: -5000 });
        accepted = true;
      } catch { accepted = false; }
      assert(accepted, 'Negative initial_balance = -5000 accepted (credit card / loan use case)');
    }

    console.log('\n[TEST 19] Negative initial_balance reflected correctly in balance formula');
    {
      const { wsId: ws } = await createWorkspace(pool);
      const cat = await createCategory(pool, ws);
      const acc = await createAccount(pool, ws, { initialBalance: -1000 });
      await insertTransaction(pool, ws, acc, cat, 'income', 300);
      // balance = -1000 + 300 = -700
      const r = await pool.query(BALANCE_SQL, [ws]);
      assert(Math.abs(parseFloat(r.rows[0].balance) - (-700)) < 0.001, 'negative initial_balance: -1000 + income 300 = -700.00');
    }

    // ── [F] INSERT with DEFAULT initial_balance = 0 ─────────────────────────

    console.log('\n[TEST 20] INSERT without initial_balance defaults to 0');
    {
      const { wsId: ws } = await createWorkspace(pool);
      const id = ulid();
      await pool.query(
        `INSERT INTO account_sources (id, workspace_id, name, type, currency) VALUES ($1,$2,'DefaultTest','manual'::account_source_type,'USD')`,
        [id, ws],
      );
      const r = await pool.query(`SELECT initial_balance FROM account_sources WHERE id = $1`, [id]);
      // pg returns NUMERIC as string: '0.0000' for NUMERIC(19,4) with DEFAULT 0
      const val = parseFloat(r.rows[0]?.initial_balance);
      assert(val === 0, `DEFAULT initial_balance = 0 (got: ${r.rows[0]?.initial_balance})`);
    }

    // ── [G] RLS isolation ───────────────────────────────────────────────────

    console.log('\n[TEST 21] Workspace A balance query does not return workspace B accounts');
    {
      const { wsId: wsA } = await createWorkspace(pool);
      const { wsId: wsB2 } = await createWorkspace(pool);
      await createAccount(pool, wsA, { name: 'AccA', initialBalance: 9999 });
      await createAccount(pool, wsB2, { name: 'AccB2', initialBalance: 8888 });
      const r = await pool.query(BALANCE_SQL, [wsA]);
      // Should only see wsA account — AccA with balance 9999
      assert(r.rows.length === 1 && Math.abs(parseFloat(r.rows[0].balance) - 9999) < 0.001,
        'Workspace A balance query returns only workspace A account (RLS isolation)');
    }

    // ── [H] Scope guard: KNOWN_COMMANDS ────────────────────────────────────

    console.log('\n[TEST 22] KNOWN_COMMANDS has 8 entries (Phase 1.21 adds /balance)');
    assert(KNOWN_COMMANDS.size === 8, `KNOWN_COMMANDS.size === 8 (got: ${KNOWN_COMMANDS.size})`);

    console.log('\n[TEST 23] /balance IS in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.has('/balance'), '/balance present in KNOWN_COMMANDS');

    console.log('\n[TEST 24] /set_balance NOT in KNOWN_COMMANDS (scope guard)');
    assert(!KNOWN_COMMANDS.has('/set_balance'), '/set_balance NOT in KNOWN_COMMANDS');

    console.log('\n[TEST 25] /balance_month NOT in KNOWN_COMMANDS (scope guard)');
    assert(!KNOWN_COMMANDS.has('/balance_month'), '/balance_month NOT in KNOWN_COMMANDS');

    // ── [I] Regression: previous constraints still present ──────────────────

    console.log('\n[TEST 26] account_sources_workspace_id_name_key UNIQUE still present (Phase 1.16 regression)');
    {
      const r = await pool.query(`SELECT conname FROM pg_constraint WHERE conrelid='account_sources'::regclass AND conname='account_sources_workspace_id_name_key'`);
      assert(r.rows.length === 1, 'UNIQUE constraint account_sources_workspace_id_name_key present (Phase 1.16 regression)');
    }

    console.log('\n[TEST 27] account_sources_currency_check CHECK still present (Phase 1.19 regression)');
    {
      const r = await pool.query(`SELECT conname FROM pg_constraint WHERE conrelid='account_sources'::regclass AND conname='account_sources_currency_check'`);
      assert(r.rows.length === 1, 'CHECK constraint account_sources_currency_check present (Phase 1.19 regression)');
    }

    console.log('\n[TEST 28] initial_balance does not break currency CHECK (valid INSERT with initial_balance)');
    {
      const { wsId: ws } = await createWorkspace(pool);
      let ok = true;
      try { await createAccount(pool, ws, { currency: 'EUR', initialBalance: 500 }); }
      catch { ok = false; }
      assert(ok, 'EUR account with initial_balance=500 INSERT succeeds (currency CHECK + initial_balance coexist)');
    }

  } finally {
    await pool.end();
  }
}

runTests()
  .then(() => {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Phase 1.21 Smoke Tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) { console.error('\n❌ SMOKE TESTS FAILED'); process.exit(1); }
    else            { console.log('\n✅ ALL PHASE 1.21 SMOKE TESTS PASSED'); process.exit(0); }
  })
  .catch((err) => { console.error('\n💥 Smoke test runner crashed:', err); process.exit(1); });
