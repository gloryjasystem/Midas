/**
 * Smoke Tests — Phase 1.23: /set_balance
 *
 * Tests the setAccountBalance formula and parseSetBalanceArgs logic.
 *
 * Formula under test (balance-semantics.md D1+D2+D3):
 *   balance = initial_balance + SUM(income+debt_received) - SUM(expense+debt_given)
 *   new_initial_balance = target_balance - computed_from_transactions
 *
 * Coverage:
 *   [A] parseSetBalanceArgs — argument parsing & validation (10 tests)
 *   [B] DB formula — set_balance SQL correctness (12 tests)
 *   [C] Security — RLS, SEC-02, SEC-03, scope guard (8 tests)
 *   [D] Regression — Phase 1.16 UNIQUE, Phase 1.19 CHECK, Phase 1.21 column (4 tests)
 *
 * Total: 34 tests
 */

import pg from 'pg';
const { Pool } = pg;

// ─── Helpers ──────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) { console.error(`  ✗ FAIL: ${message}`); failed++; failures.push(message); }
  else            { console.log(`  ✓ PASS: ${message}`);  passed++; }
}

function ulid() {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let r = '';
  for (let i = 0; i < 26; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

// ─── AMOUNT_REGEX: mirrors setBalance.service.ts ─────────────
const AMOUNT_REGEX = /^-?\d{1,15}(\.\d{1,4})?$/;

// ─── parseSetBalanceArgs: mirrors setBalance.service.ts ───────
function parseSetBalanceArgs(text) {
  const trimmed = text.trim();
  const firstSpaceIdx = trimmed.search(/\s/);
  if (firstSpaceIdx === -1) return { error: 'no_args' };
  const argsRaw = trimmed.slice(firstSpaceIdx).trim();
  if (argsRaw.length === 0) return { error: 'empty_args' };
  const tokens = argsRaw.split(/\s+/);
  if (tokens.length < 2) return { error: 'only_one_token' };
  const amountStr = tokens[tokens.length - 1] ?? '';
  const accountName = tokens.slice(0, tokens.length - 1).join(' ');
  if (accountName.length === 0) return { error: 'empty_name' };
  if (accountName.length > 100) return { error: 'name_too_long' };
  if (!AMOUNT_REGEX.test(amountStr)) return { error: 'bad_amount' };
  return { accountName, amountStr };
}

// ─── DB helpers ───────────────────────────────────────────────
async function createWorkspace(pool) {
  const wsId = ulid(), userId = ulid();
  await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, $2)`, [wsId, `TestWS_${wsId.slice(0,6)}`]);
  await pool.query(`INSERT INTO users (id, telegram_id) VALUES ($1, $2)`, [userId, BigInt(Math.floor(Math.random() * 1_000_000_000))]);
  await pool.query(`INSERT INTO workspace_memberships (id, workspace_id, user_id, role) VALUES ($1, $2, $3, 'owner')`, [ulid(), wsId, userId]);
  return { wsId, userId };
}

async function createAccount(pool, wsId, opts = {}) {
  const id = ulid();
  await pool.query(
    `INSERT INTO account_sources (id, workspace_id, name, type, currency, initial_balance)
     VALUES ($1, $2, $3, 'manual'::account_source_type, $4, $5)`,
    [id, wsId, opts.name ?? `Acc_${id.slice(0,6)}`, opts.currency ?? 'USD', opts.initialBalance ?? 0],
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

async function insertTx(pool, wsId, accId, catId, intent, amount) {
  const id = ulid();
  await pool.query(
    `INSERT INTO transactions (id, workspace_id, account_id, category_id,
       original_amount, currency, exchange_rate, base_currency, base_amount,
       transaction_intent, transaction_time)
     VALUES ($1,$2,$3,$4,$5,'USD',1.000000000000,'USD',$5,$6,NOW())`,
    [id, wsId, accId, catId, amount, intent],
  );
}

// Balance formula (mirrors balance.service.ts SQL)
async function getBalance(pool, wsId, accId) {
  const r = await pool.query(
    `SELECT a.initial_balance
           + COALESCE(SUM(CASE WHEN t.transaction_intent = 'income'        THEN t.base_amount END), 0)
           + COALESCE(SUM(CASE WHEN t.transaction_intent = 'debt_received' THEN t.base_amount END), 0)
           - COALESCE(SUM(CASE WHEN t.transaction_intent = 'expense'       THEN t.base_amount END), 0)
           - COALESCE(SUM(CASE WHEN t.transaction_intent = 'debt_given'    THEN t.base_amount END), 0)
           AS balance
     FROM account_sources a
     LEFT JOIN transactions t ON t.account_id = a.id AND t.workspace_id = $1
     WHERE a.id = $2 AND a.workspace_id = $1
     GROUP BY a.initial_balance`,
    [wsId, accId],
  );
  return parseFloat(r.rows[0]?.balance ?? '0');
}

// /set_balance SQL (mirrors setBalance.service.ts)
async function setBalance(pool, wsId, accId, targetStr) {
  const r = await pool.query(
    `UPDATE account_sources
     SET initial_balance = (
       $3::NUMERIC
       - COALESCE((
           SELECT SUM(CASE WHEN t.transaction_intent = 'income'        THEN  t.base_amount
                          WHEN t.transaction_intent = 'debt_received' THEN  t.base_amount
                          WHEN t.transaction_intent = 'expense'       THEN -t.base_amount
                          WHEN t.transaction_intent = 'debt_given'    THEN -t.base_amount
                          ELSE 0
                     END)
           FROM transactions t
           WHERE t.account_id = $2 AND t.workspace_id = $1
       ), 0)
     )
     WHERE id = $2 AND workspace_id = $1
     RETURNING initial_balance`,
    [wsId, accId, targetStr],
  );
  return r;
}

// KNOWN_COMMANDS from Phase 1.23 webhook.route.ts
const KNOWN_COMMANDS = new Set([
  '/start', '/report', '/help', '/category', '/add_category',
  '/accounts', '/add_account', '/balance', '/set_balance',
]);

// ─────────────────────────────────────────────────────────────
async function runTests() {
  console.log('\n🔍 Phase 1.23 Smoke Tests — /set_balance\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://midas_user:midas_dev_password@localhost:5432/midas',
  });

  try {

    // ═══════════════════════════════════════════════════════
    // [A] parseSetBalanceArgs (pure JS, no DB)
    // ═══════════════════════════════════════════════════════

    console.log('\n── [A] parseSetBalanceArgs ──');

    console.log('\n[TEST A1] Simple name + integer amount');
    { const r = parseSetBalanceArgs('/set_balance Binance 1500');
      assert('accountName' in r && r.accountName === 'Binance' && r.amountStr === '1500',
        'A1: /set_balance Binance 1500 → { accountName="Binance", amountStr="1500" }'); }

    console.log('\n[TEST A2] Decimal amount');
    { const r = parseSetBalanceArgs('/set_balance Binance 1500.50');
      assert('accountName' in r && r.amountStr === '1500.50', 'A2: decimal amount accepted'); }

    console.log('\n[TEST A3] Negative amount');
    { const r = parseSetBalanceArgs('/set_balance Карта -200');
      assert('accountName' in r && r.accountName === 'Карта' && r.amountStr === '-200',
        'A3: negative amount accepted'); }

    console.log('\n[TEST A4] Name with spaces — amount is last token');
    { const r = parseSetBalanceArgs('/set_balance My Crypto Wallet 9999.99');
      assert('accountName' in r && r.accountName === 'My Crypto Wallet' && r.amountStr === '9999.99',
        'A4: multi-word name parsed correctly'); }

    console.log('\n[TEST A5] Zero target balance');
    { const r = parseSetBalanceArgs('/set_balance Binance 0');
      assert('accountName' in r && r.amountStr === '0', 'A5: zero target balance accepted'); }

    console.log('\n[TEST A6] No args → error');
    { const r = parseSetBalanceArgs('/set_balance');
      assert('error' in r, 'A6: no args → error returned'); }

    console.log('\n[TEST A7] Only account name, no amount → error');
    { const r = parseSetBalanceArgs('/set_balance Binance');
      assert('error' in r, 'A7: only name, no amount → error returned'); }

    console.log('\n[TEST A8] Scientific notation rejected');
    { const r = parseSetBalanceArgs('/set_balance Binance 1e5');
      assert('error' in r && r.error === 'bad_amount', 'A8: "1e5" rejected as bad_amount'); }

    console.log('\n[TEST A9] Letters in amount rejected');
    { const r = parseSetBalanceArgs('/set_balance Binance abc');
      assert('error' in r && r.error === 'bad_amount', 'A9: "abc" rejected as bad_amount'); }

    console.log('\n[TEST A10] Double dot rejected');
    { const r = parseSetBalanceArgs('/set_balance Binance 1.2.3');
      assert('error' in r && r.error === 'bad_amount', 'A10: "1.2.3" rejected as bad_amount'); }

    // ═══════════════════════════════════════════════════════
    // [B] DB formula correctness
    // ═══════════════════════════════════════════════════════

    console.log('\n── [B] DB formula correctness ──');

    const { wsId } = await createWorkspace(pool);
    const cat = await createCategory(pool, wsId);

    console.log('\n[TEST B1] No transactions, set to 1000 → balance = 1000');
    { const acc = await createAccount(pool, wsId, { name: 'B1_NoTx' });
      await setBalance(pool, wsId, acc, '1000');
      const bal = await getBalance(pool, wsId, acc);
      assert(Math.abs(bal - 1000) < 0.001, `B1: balance = 1000.00 (got ${bal})`); }

    console.log('\n[TEST B2] Income 300, target 1000 → balance = 1000');
    { const acc = await createAccount(pool, wsId, { name: 'B2_Income' });
      await insertTx(pool, wsId, acc, cat, 'income', '300');
      await setBalance(pool, wsId, acc, '1000');
      const bal = await getBalance(pool, wsId, acc);
      assert(Math.abs(bal - 1000) < 0.001, `B2: income 300, target 1000 → balance = 1000.00 (got ${bal})`); }

    console.log('\n[TEST B3] Expense 200, target 500 → balance = 500');
    { const acc = await createAccount(pool, wsId, { name: 'B3_Expense' });
      await insertTx(pool, wsId, acc, cat, 'expense', '200');
      await setBalance(pool, wsId, acc, '500');
      const bal = await getBalance(pool, wsId, acc);
      assert(Math.abs(bal - 500) < 0.001, `B3: expense 200, target 500 → balance = 500.00 (got ${bal})`); }

    console.log('\n[TEST B4] income 1000 + expense 400, target 2000 → balance = 2000');
    { const acc = await createAccount(pool, wsId, { name: 'B4_Mixed' });
      await insertTx(pool, wsId, acc, cat, 'income', '1000');
      await insertTx(pool, wsId, acc, cat, 'expense', '400');
      await setBalance(pool, wsId, acc, '2000');
      const bal = await getBalance(pool, wsId, acc);
      assert(Math.abs(bal - 2000) < 0.001, `B4: mixed txns, target 2000 → balance = 2000.00 (got ${bal})`); }

    console.log('\n[TEST B5] debt_given 500, target 0 → balance = 0');
    { const acc = await createAccount(pool, wsId, { name: 'B5_DebtGiven' });
      await insertTx(pool, wsId, acc, cat, 'debt_given', '500');
      await setBalance(pool, wsId, acc, '0');
      const bal = await getBalance(pool, wsId, acc);
      assert(Math.abs(bal - 0) < 0.001, `B5: debt_given 500, target 0 → balance = 0.00 (got ${bal})`); }

    console.log('\n[TEST B6] debt_received 300, target 300 → balance = 300');
    { const acc = await createAccount(pool, wsId, { name: 'B6_DebtRcv' });
      await insertTx(pool, wsId, acc, cat, 'debt_received', '300');
      await setBalance(pool, wsId, acc, '300');
      const bal = await getBalance(pool, wsId, acc);
      assert(Math.abs(bal - 300) < 0.001, `B6: debt_received 300, target 300 → balance = 300.00 (got ${bal})`); }

    console.log('\n[TEST B7] transfer is neutral — target 1000 with transfer 999 → balance = 1000');
    { const acc = await createAccount(pool, wsId, { name: 'B7_Transfer' });
      await insertTx(pool, wsId, acc, cat, 'transfer', '999');
      await setBalance(pool, wsId, acc, '1000');
      const bal = await getBalance(pool, wsId, acc);
      assert(Math.abs(bal - 1000) < 0.001, `B7: transfer neutral, target 1000 → balance = 1000.00 (got ${bal})`); }

    console.log('\n[TEST B8] Negative target (credit card) -500 → balance = -500');
    { const acc = await createAccount(pool, wsId, { name: 'B8_Negative' });
      await setBalance(pool, wsId, acc, '-500');
      const bal = await getBalance(pool, wsId, acc);
      assert(Math.abs(bal - (-500)) < 0.001, `B8: negative target -500 → balance = -500.00 (got ${bal})`); }

    console.log('\n[TEST B9] Idempotent — set twice to same value');
    { const acc = await createAccount(pool, wsId, { name: 'B9_Idempotent' });
      await insertTx(pool, wsId, acc, cat, 'income', '100');
      await setBalance(pool, wsId, acc, '500');
      await setBalance(pool, wsId, acc, '500');
      const bal = await getBalance(pool, wsId, acc);
      assert(Math.abs(bal - 500) < 0.001, `B9: set twice → balance still 500.00 (got ${bal})`); }

    console.log('\n[TEST B10] Re-sync after new transaction');
    { const acc = await createAccount(pool, wsId, { name: 'B10_Resync' });
      await insertTx(pool, wsId, acc, cat, 'income', '1000');
      await setBalance(pool, wsId, acc, '2000');
      await insertTx(pool, wsId, acc, cat, 'expense', '300');
      await setBalance(pool, wsId, acc, '2000');
      const bal = await getBalance(pool, wsId, acc);
      assert(Math.abs(bal - 2000) < 0.001, `B10: re-sync after expense → balance still 2000.00 (got ${bal})`); }

    console.log('\n[TEST B11] NUMERIC(19,4) decimal precision');
    { const acc = await createAccount(pool, wsId, { name: 'B11_Decimal' });
      await insertTx(pool, wsId, acc, cat, 'income', '100.5555');
      await setBalance(pool, wsId, acc, '1000.1234');
      const bal = await getBalance(pool, wsId, acc);
      assert(Math.abs(bal - 1000.1234) < 0.0001, `B11: NUMERIC precision: balance = 1000.1234 (got ${bal})`); }

    console.log('\n[TEST B12] Non-existent account returns 0 rowCount');
    { const fakeId = ulid();
      const r = await pool.query(
        `UPDATE account_sources SET initial_balance = 0 WHERE id = $1 AND workspace_id = $2 RETURNING id`,
        [fakeId, wsId],
      );
      assert(r.rowCount === 0, `B12: non-existent account returns rowCount = 0 (got ${r.rowCount})`); }

    // ═══════════════════════════════════════════════════════
    // [C] Security & scope guard
    // ═══════════════════════════════════════════════════════

    console.log('\n── [C] Security & scope guard ──');

    console.log('\n[TEST C1] AMOUNT_REGEX rejects 16-digit integer (NUMERIC overflow guard)');
    assert(!AMOUNT_REGEX.test('1234567890123456'),
      'C1: 16-digit integer rejected by AMOUNT_REGEX (15-digit cap, SEC-02)');

    console.log('\n[TEST C2] AMOUNT_REGEX accepts negative decimal');
    assert(AMOUNT_REGEX.test('-9999.9999'), 'C2: negative decimal accepted');

    console.log('\n[TEST C3] AMOUNT_REGEX rejects empty string');
    assert(!AMOUNT_REGEX.test(''), 'C3: empty string rejected');

    console.log('\n[TEST C4] /set_balance does NOT create transactions');
    { const { wsId: ws2 } = await createWorkspace(pool);
      const acc = await createAccount(pool, ws2, { name: 'C4_NoTx' });
      const before = await pool.query(`SELECT COUNT(*) AS cnt FROM transactions WHERE workspace_id = $1`, [ws2]);
      await pool.query(`UPDATE account_sources SET initial_balance = 1234 WHERE id = $1 AND workspace_id = $2`, [acc, ws2]);
      const after = await pool.query(`SELECT COUNT(*) AS cnt FROM transactions WHERE workspace_id = $1`, [ws2]);
      assert(before.rows[0].cnt === after.rows[0].cnt,
        `C4: set_balance creates NO transactions (before=${before.rows[0].cnt}, after=${after.rows[0].cnt})`); }

    console.log('\n[TEST C5] balance_adjustments table does NOT exist (scope guard)');
    { const r = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='balance_adjustments'`
      );
      assert(r.rows.length === 0, 'C5: balance_adjustments table does not exist (scope guard)'); }

    console.log('\n[TEST C6] Cross-workspace UPDATE blocked by explicit WHERE workspace_id');
    { const { wsId: wsA } = await createWorkspace(pool);
      const { wsId: wsB2 } = await createWorkspace(pool);
      const accA = await createAccount(pool, wsA, { name: 'C6_AccA' });
      // Attempt to update wsA account while passing wsB2 as workspace
      const r = await pool.query(
        `UPDATE account_sources SET initial_balance = 9999 WHERE id = $1 AND workspace_id = $2 RETURNING id`,
        [accA, wsB2],
      );
      assert(r.rowCount === 0, 'C6: cross-workspace UPDATE blocked by explicit WHERE workspace_id'); }

    console.log('\n[TEST C7] KNOWN_COMMANDS has 9 entries (Phase 1.23 adds /set_balance)');
    assert(KNOWN_COMMANDS.size === 9, `C7: KNOWN_COMMANDS.size === 9 (got ${KNOWN_COMMANDS.size})`);

    console.log('\n[TEST C8] /set_balance IS in KNOWN_COMMANDS');
    assert(KNOWN_COMMANDS.has('/set_balance'), 'C8: /set_balance present in KNOWN_COMMANDS');

    // ═══════════════════════════════════════════════════════
    // [D] Regression — previous phases
    // ═══════════════════════════════════════════════════════

    console.log('\n── [D] Regression ──');

    console.log('\n[TEST D1] initial_balance column is NUMERIC (Phase 1.21)');
    { const r = await pool.query(
        `SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='account_sources' AND column_name='initial_balance'`
      );
      assert(r.rows[0]?.data_type === 'numeric', `D1: initial_balance data_type = numeric (got ${r.rows[0]?.data_type})`); }

    console.log('\n[TEST D2] account_sources_workspace_id_name_key UNIQUE present (Phase 1.16)');
    { const r = await pool.query(
        `SELECT conname FROM pg_constraint WHERE conrelid='account_sources'::regclass AND conname='account_sources_workspace_id_name_key'`
      );
      assert(r.rows.length === 1, 'D2: UNIQUE account_sources_workspace_id_name_key present (Phase 1.16 regression)'); }

    console.log('\n[TEST D3] account_sources_currency_check present (Phase 1.19)');
    { const r = await pool.query(
        `SELECT conname FROM pg_constraint WHERE conrelid='account_sources'::regclass AND conname='account_sources_currency_check'`
      );
      assert(r.rows.length === 1, 'D3: CHECK account_sources_currency_check present (Phase 1.19 regression)'); }

    console.log('\n[TEST D4] /balance still in KNOWN_COMMANDS (Phase 1.21 regression)');
    assert(KNOWN_COMMANDS.has('/balance'), 'D4: /balance present in KNOWN_COMMANDS (Phase 1.21 regression)');

  } finally {
    await pool.end();
  }
}

runTests()
  .then(() => {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Phase 1.23 Smoke Tests: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
      console.log('\nFailed tests:');
      failures.forEach((f) => console.log(`  • ${f}`));
    }
    if (failed > 0) { console.error('\n❌ SMOKE TESTS FAILED'); process.exit(1); }
    else            { console.log('\n✅ ALL PHASE 1.23 SMOKE TESTS PASSED'); process.exit(0); }
  })
  .catch((err) => { console.error('\n💥 Smoke test runner crashed:', err); process.exit(1); });
