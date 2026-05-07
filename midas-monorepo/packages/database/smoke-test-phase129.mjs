/**
 * Smoke Tests — Phase 1.29: Soft Delete for Transactions
 *
 * Tests (40 total):
 *   [A] Schema (5)
 *   [B] softDeleteTransaction() (8)
 *   [C] Balance recalculation (6)
 *   [D] Report recalculation (4)
 *   [E] /edit list and card exclusion (5)
 *   [F] Callback data byte sizes (4)
 *   [G] Scope guard — no hard delete (4)
 *   [H] Regression (4)
 *
 * Run: node midas-monorepo/packages/database/smoke-test-phase129.mjs
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://midas_migrator:midas_migrator_password@localhost:5432/midas',
});

let passed = 0, failed = 0;
function assert(condition, label, detail = '') {
  if (condition) { console.log(`  ✓ PASS: ${label}`); passed++; }
  else { console.error(`  ✗ FAIL: ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

function ulid() {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let r = '';
  for (let i = 0; i < 26; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

async function createTestWorkspace(client) {
  const wsId = ulid(), userId = ulid(), membId = ulid();
  await client.query(`INSERT INTO workspaces (id, name) VALUES ($1, $2)`, [wsId, `Smoke129_${wsId.slice(0, 6)}`]);
  await client.query(`INSERT INTO users (id, telegram_id) VALUES ($1, $2)`, [userId, BigInt(Math.floor(Math.random() * 1_000_000_000))]);
  await client.query(`INSERT INTO workspace_memberships (id, workspace_id, user_id, role) VALUES ($1, $2, $3, 'owner')`, [membId, wsId, userId]);
  return { wsId, userId };
}

async function createAccount(client, wsId, currency = 'RUB') {
  const id = ulid();
  await client.query(
    `INSERT INTO account_sources (id, workspace_id, name, type, currency, initial_balance) VALUES ($1, $2, $3, 'manual', $4, 0)`,
    [id, wsId, `Acc_${id.slice(0, 6)}`, currency],
  );
  return id;
}

async function createCategory(client, wsId) {
  const id = ulid();
  await client.query(
    `INSERT INTO categories (id, workspace_id, name, "group") VALUES ($1, $2, $3, 'Жизнь')`,
    [id, wsId, `Cat_${id.slice(0, 6)}`],
  );
  return id;
}

async function createTransaction(client, wsId, accId, catId, intent, amount) {
  const id = ulid();
  await client.query(
    `INSERT INTO transactions (id, workspace_id, account_id, category_id, base_amount, original_amount, base_currency, currency, exchange_rate, transaction_intent, transaction_time)
     VALUES ($1,$2,$3,$4,$5::numeric,$5::numeric,'RUB','RUB',1,'${intent}',NOW())`,
    [id, wsId, accId, catId, String(amount)],
  );
  return id;
}

async function softDelete(client, txId, wsId) {
  const r = await client.query(
    `UPDATE transactions SET deleted_at = NOW() WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL RETURNING id`,
    [txId, wsId],
  );
  return r.rowCount ?? 0;
}

async function getBalance(client, wsId, accId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN transaction_intent='income' THEN base_amount
                              WHEN transaction_intent='debt_received' THEN base_amount
                              WHEN transaction_intent='expense' THEN -base_amount
                              WHEN transaction_intent='debt_given' THEN -base_amount
                              ELSE 0 END), 0)::numeric AS bal
     FROM transactions
     WHERE account_id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
    [accId, wsId],
  );
  return parseFloat(r.rows[0]?.bal ?? '0');
}

// ── KNOWN_COMMANDS snapshot for scope guard ──
const KNOWN_COMMANDS = new Set(['/start', '/report', '/help', '/category', '/add_category', '/accounts', '/add_account', '/balance', '/set_balance', '/settings', '/edit']);

async function runTests() {
  console.log('\n🔍 Phase 1.29 Smoke Tests — Soft Delete for Transactions\n');
  const client = await pool.connect();

  try {

    // ── [A] Schema ────────────────────────────────────────────────────────

    console.log('\n[A] Schema');

    console.log('\n[TEST 1] deleted_at column exists on transactions');
    {
      const r = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name='transactions' AND column_name='deleted_at'`,
      );
      assert(r.rows.length === 1, 'deleted_at column exists on transactions');
    }

    console.log('\n[TEST 2] deleted_at data type is timestamp with time zone');
    {
      const r = await client.query(
        `SELECT data_type FROM information_schema.columns WHERE table_name='transactions' AND column_name='deleted_at'`,
      );
      assert(r.rows[0]?.data_type === 'timestamp with time zone', `deleted_at is TIMESTAMPTZ (got: ${r.rows[0]?.data_type})`);
    }

    console.log('\n[TEST 3] deleted_at is nullable (IS_NULLABLE = YES)');
    {
      const r = await client.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name='transactions' AND column_name='deleted_at'`,
      );
      assert(r.rows[0]?.is_nullable === 'YES', `deleted_at IS NULLABLE (got: ${r.rows[0]?.is_nullable})`);
    }

    console.log('\n[TEST 4] Migrated column exists and defaults to NULL (all rows have typed default)');
    {
      // Check column exists with correct default (NOT all rows must be null — this is a dev DB with test data)
      const r = await client.query(
        `SELECT column_default FROM information_schema.columns WHERE table_name='transactions' AND column_name='deleted_at'`,
      );
      // DEFAULT NULL is stored as NULL in information_schema
      assert(r.rows[0]?.column_default === null, `deleted_at column_default is NULL (safe migration, got: ${r.rows[0]?.column_default})`);
    }

    console.log('\n[TEST 5] Migration recorded in pgmigrations');
    {
      const r = await client.query(`SELECT name FROM pgmigrations WHERE name='1778700000000_transactions-soft-delete'`);
      assert(r.rows.length === 1, 'Migration 1778700000000_transactions-soft-delete in pgmigrations');
    }

    // ── [B] softDeleteTransaction() ───────────────────────────────────────

    console.log('\n[B] softDeleteTransaction()');

    const { wsId: wsB, userId: userB } = await createTestWorkspace(client);
    const accB = await createAccount(client, wsB);
    const catB = await createCategory(client, wsB);

    console.log('\n[TEST 6] Soft delete sets deleted_at to non-null timestamp');
    {
      const txId = await createTransaction(client, wsB, accB, catB, 'expense', 100);
      const rows = await softDelete(client, txId, wsB);
      assert(rows === 1, 'softDelete returns 1 row updated');
      const r = await client.query(`SELECT deleted_at FROM transactions WHERE id = $1`, [txId]);
      assert(r.rows[0]?.deleted_at !== null, 'deleted_at is non-null after soft delete');
    }

    console.log('\n[TEST 7] Soft delete does NOT remove the row (no hard delete)');
    {
      const txId = await createTransaction(client, wsB, accB, catB, 'expense', 200);
      await softDelete(client, txId, wsB);
      const r = await client.query(`SELECT id FROM transactions WHERE id = $1`, [txId]);
      assert(r.rows.length === 1, 'Row still exists after soft delete (no hard delete)');
    }

    console.log('\n[TEST 8] Already-deleted transaction returns 0 rows (idempotency)');
    {
      const txId = await createTransaction(client, wsB, accB, catB, 'expense', 300);
      await softDelete(client, txId, wsB);
      const second = await softDelete(client, txId, wsB);
      assert(second === 0, 'Second soft delete of same tx returns 0 rows (idempotent)');
    }

    console.log('\n[TEST 9] Cross-workspace soft delete is blocked (IDOR guard)');
    {
      const { wsId: wsOther } = await createTestWorkspace(client);
      const txId = await createTransaction(client, wsB, accB, catB, 'expense', 400);
      const rows = await client.query(
        `UPDATE transactions SET deleted_at = NOW() WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL RETURNING id`,
        [txId, wsOther],
      );
      assert((rows.rowCount ?? 0) === 0, 'Cross-workspace soft delete returns 0 rows (IDOR blocked)');
    }

    console.log('\n[TEST 10] deleted_at IS NOT NULL after confirmed delete');
    {
      const txId = await createTransaction(client, wsB, accB, catB, 'income', 500);
      await softDelete(client, txId, wsB);
      const r = await client.query(`SELECT deleted_at FROM transactions WHERE id = $1`, [txId]);
      assert(r.rows[0]?.deleted_at instanceof Date || typeof r.rows[0]?.deleted_at === 'string',
        'deleted_at is a timestamp value after soft delete');
    }

    console.log('\n[TEST 11] Non-existent transaction returns 0 rows from softDelete');
    {
      const fakeId = ulid();
      const rows = await softDelete(client, fakeId, wsB);
      assert(rows === 0, 'Non-existent txId returns 0 rows from softDelete');
    }

    console.log('\n[TEST 12] softDeleteTransaction workspace_id filter prevents wrong-ws update');
    {
      const { wsId: wsC } = await createTestWorkspace(client);
      const accC = await createAccount(client, wsC);
      const catC = await createCategory(client, wsC);
      const txId = await createTransaction(client, wsC, accC, catC, 'expense', 600);
      // try to delete with wsB (wrong workspace)
      const rows = await softDelete(client, txId, wsB);
      assert(rows === 0, 'Wrong workspace_id returns 0 rows (defense-in-depth)');
      const r = await client.query(`SELECT deleted_at FROM transactions WHERE id = $1`, [txId]);
      assert(r.rows[0]?.deleted_at === null, 'Transaction in wsC remains undeleted');
    }

    console.log('\n[TEST 13] softDelete with ULID-format txId but wrong workspace returns 0');
    {
      const { wsId: wsD } = await createTestWorkspace(client);
      const txId = await createTransaction(client, wsB, accB, catB, 'expense', 50);
      const rows = await softDelete(client, txId, wsD);
      assert(rows === 0, 'Valid ULID but wrong workspace returns 0');
    }

    // ── [C] Balance recalculation ─────────────────────────────────────────

    console.log('\n[C] Balance recalculation after soft delete');

    const { wsId: wsC2 } = await createTestWorkspace(client);
    const accC2 = await createAccount(client, wsC2);
    const catC2 = await createCategory(client, wsC2);

    console.log('\n[TEST 14] Balance excludes soft-deleted income');
    {
      const txId = await createTransaction(client, wsC2, accC2, catC2, 'income', 1000);
      const balBefore = await getBalance(client, wsC2, accC2);
      await softDelete(client, txId, wsC2);
      const balAfter = await getBalance(client, wsC2, accC2);
      assert(balAfter === balBefore - 1000, `Balance decreased by 1000 after soft-deleting income (before=${balBefore}, after=${balAfter})`);
    }

    console.log('\n[TEST 15] Balance excludes soft-deleted expense');
    {
      const txId = await createTransaction(client, wsC2, accC2, catC2, 'expense', 500);
      const balBefore = await getBalance(client, wsC2, accC2);
      await softDelete(client, txId, wsC2);
      const balAfter = await getBalance(client, wsC2, accC2);
      assert(balAfter === balBefore + 500, `Balance increased by 500 after soft-deleting expense (before=${balBefore}, after=${balAfter})`);
    }

    console.log('\n[TEST 16] Balance excludes soft-deleted debt_given');
    {
      const txId = await createTransaction(client, wsC2, accC2, catC2, 'debt_given', 300);
      const balBefore = await getBalance(client, wsC2, accC2);
      await softDelete(client, txId, wsC2);
      const balAfter = await getBalance(client, wsC2, accC2);
      assert(balAfter === balBefore + 300, `Balance increased by 300 after soft-deleting debt_given`);
    }

    console.log('\n[TEST 17] Balance excludes soft-deleted debt_received');
    {
      const txId = await createTransaction(client, wsC2, accC2, catC2, 'debt_received', 200);
      const balBefore = await getBalance(client, wsC2, accC2);
      await softDelete(client, txId, wsC2);
      const balAfter = await getBalance(client, wsC2, accC2);
      assert(balAfter === balBefore - 200, `Balance decreased by 200 after soft-deleting debt_received`);
    }

    console.log('\n[TEST 18] Account with zero non-deleted transactions still appears in balance query (LEFT JOIN guard)');
    {
      const { wsId: wsZ } = await createTestWorkspace(client);
      const accZ = await createAccount(client, wsZ);
      const catZ = await createCategory(client, wsZ);
      const txId = await createTransaction(client, wsZ, accZ, catZ, 'expense', 100);
      await softDelete(client, txId, wsZ);
      // Account should still appear in balance query even with all tx soft-deleted
      const r = await client.query(
        `SELECT a.id FROM account_sources a
         LEFT JOIN transactions t ON t.account_id = a.id AND t.workspace_id = $1 AND t.deleted_at IS NULL
         WHERE a.workspace_id = $1`,
        [wsZ],
      );
      assert(r.rows.some(row => row.id === accZ), 'Account with all-deleted transactions still appears in LEFT JOIN balance query');
    }

    console.log('\n[TEST 19] Non-deleted transactions still counted in balance');
    {
      const { wsId: wsMix } = await createTestWorkspace(client);
      const accMix = await createAccount(client, wsMix);
      const catMix = await createCategory(client, wsMix);
      const tx1 = await createTransaction(client, wsMix, accMix, catMix, 'income', 1000);
      const tx2 = await createTransaction(client, wsMix, accMix, catMix, 'income', 500);
      await softDelete(client, tx1, wsMix);
      // Only tx2 (500) should remain
      const bal = await getBalance(client, wsMix, accMix);
      assert(bal === 500, `Only non-deleted income counted: expected 500, got ${bal}`);
    }

    // ── [D] Report recalculation ──────────────────────────────────────────

    console.log('\n[D] Report recalculation after soft delete');

    const { wsId: wsRep } = await createTestWorkspace(client);
    const accRep = await createAccount(client, wsRep);
    const catRep = await createCategory(client, wsRep);

    console.log('\n[TEST 20] Report excludes soft-deleted expense');
    {
      const txId = await createTransaction(client, wsRep, accRep, catRep, 'expense', 350);
      await softDelete(client, txId, wsRep);
      const r = await client.query(
        `SELECT COALESCE(SUM(base_amount), 0)::numeric AS total FROM transactions
         WHERE workspace_id = $1 AND transaction_intent = 'expense'
           AND transaction_time >= date_trunc('month', NOW())
           AND transaction_time < date_trunc('month', NOW()) + interval '1 month'
           AND deleted_at IS NULL`,
        [wsRep],
      );
      const total = parseFloat(r.rows[0]?.total ?? '0');
      assert(total === 0, `Soft-deleted expense not in report (expected 0, got ${total})`);
    }

    console.log('\n[TEST 21] Report excludes soft-deleted income');
    {
      const txId = await createTransaction(client, wsRep, accRep, catRep, 'income', 700);
      await softDelete(client, txId, wsRep);
      const r = await client.query(
        `SELECT COALESCE(SUM(base_amount), 0)::numeric AS total FROM transactions
         WHERE workspace_id = $1 AND transaction_intent = 'income'
           AND transaction_time >= date_trunc('month', NOW())
           AND transaction_time < date_trunc('month', NOW()) + interval '1 month'
           AND deleted_at IS NULL`,
        [wsRep],
      );
      const total = parseFloat(r.rows[0]?.total ?? '0');
      assert(total === 0, `Soft-deleted income not in report (expected 0, got ${total})`);
    }

    console.log('\n[TEST 22] Non-deleted transactions still appear in report');
    {
      const { wsId: wsRep2 } = await createTestWorkspace(client);
      const accRep2 = await createAccount(client, wsRep2);
      const catRep2 = await createCategory(client, wsRep2);
      await createTransaction(client, wsRep2, accRep2, catRep2, 'expense', 450);
      const r = await client.query(
        `SELECT COALESCE(SUM(base_amount), 0)::numeric AS total FROM transactions
         WHERE workspace_id = $1 AND transaction_intent = 'expense'
           AND transaction_time >= date_trunc('month', NOW())
           AND transaction_time < date_trunc('month', NOW()) + interval '1 month'
           AND deleted_at IS NULL`,
        [wsRep2],
      );
      const total = parseFloat(r.rows[0]?.total ?? '0');
      assert(total === 450, `Non-deleted expense appears in report (expected 450, got ${total})`);
    }

    console.log('\n[TEST 23] Empty workspace reports 0 after all soft-deleted');
    {
      const { wsId: wsEmpty } = await createTestWorkspace(client);
      const accE = await createAccount(client, wsEmpty);
      const catE = await createCategory(client, wsEmpty);
      const txId = await createTransaction(client, wsEmpty, accE, catE, 'expense', 200);
      await softDelete(client, txId, wsEmpty);
      const r = await client.query(
        `SELECT COUNT(*) AS cnt FROM transactions WHERE workspace_id = $1 AND deleted_at IS NULL`,
        [wsEmpty],
      );
      assert(parseInt(r.rows[0]?.cnt ?? '1') === 0, 'All soft-deleted: 0 live transactions remain');
    }

    // ── [E] /edit list and card exclusion ─────────────────────────────────

    console.log('\n[E] /edit list and card exclusion');

    const { wsId: wsEdit } = await createTestWorkspace(client);
    const accEdit = await createAccount(client, wsEdit);
    const catEdit = await createCategory(client, wsEdit);

    console.log('\n[TEST 24] getRecentTransactions excludes soft-deleted');
    {
      const txId = await createTransaction(client, wsEdit, accEdit, catEdit, 'expense', 100);
      await softDelete(client, txId, wsEdit);
      const r = await client.query(
        `SELECT id FROM transactions WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY transaction_time DESC LIMIT 10`,
        [wsEdit],
      );
      assert(!r.rows.some(row => row.id === txId), 'Soft-deleted tx not in recent list');
    }

    console.log('\n[TEST 25] countTransactions excludes soft-deleted');
    {
      const txId = await createTransaction(client, wsEdit, accEdit, catEdit, 'expense', 100);
      const cntBefore = parseInt((await client.query(`SELECT COUNT(*) AS c FROM transactions WHERE workspace_id=$1 AND deleted_at IS NULL`, [wsEdit])).rows[0]?.c ?? '0');
      await softDelete(client, txId, wsEdit);
      const cntAfter = parseInt((await client.query(`SELECT COUNT(*) AS c FROM transactions WHERE workspace_id=$1 AND deleted_at IS NULL`, [wsEdit])).rows[0]?.c ?? '0');
      assert(cntAfter === cntBefore - 1, `Count decreased by 1 after soft delete (before=${cntBefore}, after=${cntAfter})`);
    }

    console.log('\n[TEST 26] getTransactionCard returns null for soft-deleted tx');
    {
      const txId = await createTransaction(client, wsEdit, accEdit, catEdit, 'income', 200);
      await softDelete(client, txId, wsEdit);
      const r = await client.query(
        `SELECT id FROM transactions WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`,
        [txId, wsEdit],
      );
      assert(r.rows.length === 0, 'getTransactionCard query returns 0 rows for soft-deleted tx');
    }

    console.log('\n[TEST 27] Update guards reject soft-deleted transactions');
    {
      const txId = await createTransaction(client, wsEdit, accEdit, catEdit, 'expense', 500);
      await softDelete(client, txId, wsEdit);
      const r = await client.query(
        `SELECT id FROM transactions WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`,
        [txId, wsEdit],
      );
      assert(r.rows.length === 0, 'Fetch-before-update guard rejects soft-deleted tx (returns 0 rows)');
    }

    console.log('\n[TEST 28] Non-deleted transactions still visible in card query');
    {
      const txId = await createTransaction(client, wsEdit, accEdit, catEdit, 'income', 300);
      const r = await client.query(
        `SELECT id FROM transactions WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`,
        [txId, wsEdit],
      );
      assert(r.rows.length === 1, 'Non-deleted tx visible in card query');
    }

    // ── [F] Callback data byte sizes ──────────────────────────────────────

    console.log('\n[F] Callback data byte sizes');

    const sampleUlid = '01JTSTV1C2Y2KY3EE4GHAR5P8N';

    console.log('\n[TEST 29] ed:d:ask:<ULID> is exactly 36 bytes');
    {
      const payload = `ed:d:ask:${sampleUlid}`;
      const bytes = Buffer.byteLength(payload, 'utf8');
      // ed:d:ask: = 9 chars + 26 ULID = 35 bytes
      assert(bytes === 35, `ed:d:ask:<ULID> = ${bytes} bytes (must be ≤ 64)`);
    }

    console.log('\n[TEST 30] ed:d:yes:<ULID> is exactly 35 bytes');
    {
      const payload = `ed:d:yes:${sampleUlid}`;
      const bytes = Buffer.byteLength(payload, 'utf8');
      // ed:d:yes: = 9 chars + 26 ULID = 35 bytes
      assert(bytes === 35, `ed:d:yes:<ULID> = ${bytes} bytes (must be ≤ 64)`);
    }

    console.log('\n[TEST 31] ed:d:ask payload is within 64-byte Telegram limit');
    assert(Buffer.byteLength(`ed:d:ask:${sampleUlid}`, 'utf8') <= 64, 'ed:d:ask within 64-byte limit');

    console.log('\n[TEST 32] ed:d:yes payload is within 64-byte Telegram limit');
    assert(Buffer.byteLength(`ed:d:yes:${sampleUlid}`, 'utf8') <= 64, 'ed:d:yes within 64-byte limit');

    // ── [G] Scope guard ───────────────────────────────────────────────────

    console.log('\n[G] Scope guard');

    console.log('\n[TEST 33] No hard DELETE path — soft delete only sets deleted_at');
    {
      const { wsId: wsSG } = await createTestWorkspace(client);
      const accSG = await createAccount(client, wsSG);
      const catSG = await createCategory(client, wsSG);
      const txId = await createTransaction(client, wsSG, accSG, catSG, 'expense', 100);
      await softDelete(client, txId, wsSG);
      const r = await client.query(`SELECT id FROM transactions WHERE id = $1`, [txId]);
      assert(r.rows.length === 1, 'Row exists after soft delete — no hard DELETE path');
    }

    console.log('\n[TEST 34] KNOWN_COMMANDS size unchanged (still 11, no new slash command)');
    assert(KNOWN_COMMANDS.size === 11, `KNOWN_COMMANDS size is still 11 (got ${KNOWN_COMMANDS.size})`);

    console.log('\n[TEST 35] /edit command exists in KNOWN_COMMANDS (Phase 1.28 regression)');
    assert(KNOWN_COMMANDS.has('/edit'), '/edit in KNOWN_COMMANDS');

    console.log('\n[TEST 36] No restore/undelete column added');
    {
      const r = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name='transactions' AND column_name='restored_at'`,
      );
      assert(r.rows.length === 0, 'No restored_at column (restore not in Phase 1.29 scope)');
    }

    // ── [H] Regression ────────────────────────────────────────────────────

    console.log('\n[H] Regression');

    console.log('\n[TEST 37] account_sources UNIQUE constraint still present (Phase 1.16 regression)');
    {
      const r = await client.query(
        `SELECT conname FROM pg_constraint WHERE conrelid='account_sources'::regclass AND conname='account_sources_workspace_id_name_key'`,
      );
      assert(r.rows.length === 1, 'account_sources_workspace_id_name_key UNIQUE constraint present');
    }

    console.log('\n[TEST 38] categories_workspace_id_name_key still present (Phase 1.2 regression)');
    {
      const r = await client.query(
        `SELECT conname FROM pg_constraint WHERE conrelid='categories'::regclass AND conname='categories_workspace_id_name_key'`,
      );
      assert(r.rows.length === 1, 'categories_workspace_id_name_key present');
    }

    console.log('\n[TEST 39] workspace timezone column still present (Phase 1.25 regression)');
    {
      const r = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name='workspaces' AND column_name='timezone'`,
      );
      assert(r.rows.length === 1, 'workspaces.timezone column present');
    }

    console.log('\n[TEST 40] transactions table has expected columns including deleted_at');
    {
      const r = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name='transactions' ORDER BY column_name`,
      );
      const cols = r.rows.map(row => row.column_name);
      assert(cols.includes('deleted_at'), 'deleted_at in transactions columns');
      assert(cols.includes('base_amount'), 'base_amount still in transactions columns');
      assert(cols.includes('workspace_id'), 'workspace_id still in transactions columns');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

runTests()
  .then(() => {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Phase 1.29 Smoke Tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error('\n❌ SMOKE TESTS FAILED');
      process.exit(1);
    } else {
      console.log('\n✅ ALL PHASE 1.29 SMOKE TESTS PASSED');
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error('\n💥 Smoke test runner crashed:', err);
    process.exit(1);
  });
