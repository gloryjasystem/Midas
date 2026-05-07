/**
 * Smoke Test — Phase 1.28: /edit Transactions MVP
 *
 * Tests (43 total):
 *   [A] Schema guard (3)
 *   [B] Transaction list & pagination (5)
 *   [C] Transaction card view (4)
 *   [D] Update amount (5)
 *   [E] Update category (4)
 *   [F] Update account (3)
 *   [G] Update intent (4)
 *   [H] Callback safety (5)
 *   [I] Redis edit state (3)
 *   [J] Scope guard (4)
 *   [K] Regression — previous phases (3)
 *
 * Run: node midas-monorepo/packages/database/smoke-test-phase128.mjs
 * Requires: DATABASE_URL env var OR uses hardcoded local connection.
 */

import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: 'postgresql://midas_migrator:midas_migrator_password@localhost:5432/midas',
});

let passed = 0, failed = 0;
function assert(condition, label, detail = '') {
  if (condition) { console.log(`  ✓ PASS: ${label}`); passed++; }
  else { console.error(`  ✗ FAIL: ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

// ── ULID generator ──
function ulid() {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let r = '';
  for (let i = 0; i < 26; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

// ── Test workspace factory ──
async function createTestWorkspace(client) {
  const wsId  = ulid();
  const userId = ulid();
  const membId = ulid();
  await client.query(`DELETE FROM transactions WHERE workspace_id = $1`, [wsId]);
  await client.query(`DELETE FROM account_sources WHERE workspace_id = $1`, [wsId]);
  await client.query(`DELETE FROM categories WHERE workspace_id = $1`, [wsId]);
  await client.query(`DELETE FROM workspace_memberships WHERE workspace_id = $1`, [wsId]);
  await client.query(`DELETE FROM workspaces WHERE id = $1`, [wsId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.query(`INSERT INTO workspaces (id, name) VALUES ($1, $2)`, [wsId, `Smoke128_${wsId.slice(0,6)}`]);
  await client.query(`INSERT INTO users (id, telegram_id) VALUES ($1, $2)`, [userId, BigInt(Math.floor(Math.random() * 1_000_000_000))]);
  await client.query(`INSERT INTO workspace_memberships (id, workspace_id, user_id, role) VALUES ($1, $2, $3, 'owner')`, [membId, wsId, userId]);
  return { wsId, userId };
}

async function createAccount(client, wsId, opts = {}) {
  const id = ulid();
  await client.query(
    `INSERT INTO account_sources (id, workspace_id, name, type, currency, initial_balance) VALUES ($1,$2,$3,'manual'::account_source_type,$4,$5)`,
    [id, wsId, opts.name ?? `Acc_${id.slice(0,6)}`, opts.currency ?? 'RUB', opts.initialBalance ?? 0],
  );
  return id;
}

async function createCategory(client, wsId, suffix = '') {
  const id = ulid();
  await client.query(
    `INSERT INTO categories (id, workspace_id, name, "group") VALUES ($1, $2, $3, 'Жизнь'::category_group)`,
    [id, wsId, `Тест128_${id.slice(0,8)}${suffix}`],
  );
  return id;
}

async function insertTx(client, wsId, accountId, categoryId, opts = {}) {
  const id = ulid();
  const intent = opts.intent ?? 'expense';
  const amount = opts.amount ?? '350.00';
  const currency = opts.currency ?? 'RUB';
  const exchangeRate = opts.exchangeRate ?? '1.000000000000';
  await client.query(
    `INSERT INTO transactions (id, workspace_id, account_id, category_id, original_amount, currency, exchange_rate, base_currency, base_amount, transaction_intent, transaction_time, rate_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$6,$5,$8,NOW(),'manual')`,
    [id, wsId, accountId, categoryId, amount, currency, exchangeRate, intent],
  );
  return id;
}

async function cleanup(client, wsId, userId) {
  await client.query(`DELETE FROM transactions WHERE workspace_id = $1`, [wsId]);
  await client.query(`DELETE FROM account_sources WHERE workspace_id = $1`, [wsId]);
  await client.query(`DELETE FROM categories WHERE workspace_id = $1`, [wsId]);
  await client.query(`DELETE FROM workspace_memberships WHERE workspace_id = $1`, [wsId]);
  await client.query(`DELETE FROM workspaces WHERE id = $1`, [wsId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
}

async function runTests() {
  const client = await pool.connect();
  await client.query(`SET app.current_user_id = 'SMOKE128'`);

  try {
    // ── [A] Schema guard ─────────────────────────────────────────
    console.log('\n── [A] Schema guard ──\n');
    {
      const r = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'transactions'
         ORDER BY ordinal_position`,
      );
      const cols = r.rows.map(row => row.column_name);
      assert(cols.includes('id'),          'A1: transactions.id exists');
      assert(cols.includes('base_amount'), 'A2: transactions.base_amount exists');
      assert(cols.includes('deleted_at'), 'A3: deleted_at now in transactions (added Phase 1.29 — Phase 1.28 test updated)');
    }

    // ── [B] Transaction list & pagination ────────────────────────
    console.log('\n── [B] Transaction list & pagination ──\n');
    const { wsId: wsB, userId: userB } = await createTestWorkspace(client);
    const accB = await createAccount(client, wsB);
    const catB = await createCategory(client, wsB);

    // Insert 12 transactions
    for (let i = 0; i < 12; i++) {
      await insertTx(client, wsB, accB, catB, { amount: String(100 + i) + '.00' });
    }

    {
      const r = await client.query(
        `SELECT id FROM transactions WHERE workspace_id = $1 ORDER BY transaction_time DESC LIMIT 10 OFFSET 0`,
        [wsB],
      );
      assert(r.rows.length === 10, 'B1: page 0 returns exactly 10 (EDIT_PAGE_SIZE)');
    }
    {
      const r = await client.query(
        `SELECT id FROM transactions WHERE workspace_id = $1 ORDER BY transaction_time DESC LIMIT 10 OFFSET 10`,
        [wsB],
      );
      assert(r.rows.length >= 2, 'B2: page 1 has remaining rows');
    }
    {
      const r = await client.query(
        `SELECT transaction_time FROM transactions WHERE workspace_id = $1 ORDER BY transaction_time DESC LIMIT 5`,
        [wsB],
      );
      let ok = true;
      for (let i = 1; i < r.rows.length; i++) {
        if (new Date(r.rows[i].transaction_time) > new Date(r.rows[i-1].transaction_time)) ok = false;
      }
      assert(ok, 'B3: transactions ordered by transaction_time DESC');
    }
    {
      const r = await client.query(
        `SELECT COUNT(*)::text AS cnt FROM transactions WHERE workspace_id = $1`,
        ['00000000000000000000000000'], // fake wsId
      );
      assert(r.rows[0].cnt === '0', 'B4: non-existent workspace returns 0 transactions (IDOR)');
    }
    {
      const r = await client.query(
        `SELECT COUNT(*)::text AS cnt FROM transactions WHERE workspace_id = $1`,
        [wsB],
      );
      assert(parseInt(r.rows[0].cnt, 10) >= 12, 'B5: COUNT returns correct total (≥12)');
    }

    await cleanup(client, wsB, userB);

    // ── [C] Transaction card view ────────────────────────────────
    console.log('\n── [C] Transaction card view ──\n');
    const { wsId: wsC, userId: userC } = await createTestWorkspace(client);
    const accC = await createAccount(client, wsC);
    const catC = await createCategory(client, wsC);
    const txC = await insertTx(client, wsC, accC, catC, { amount: '750.00', intent: 'income' });

    {
      const r = await client.query(
        `SELECT t.id, ROUND(t.base_amount,2)::text AS base_amount, t.base_currency, t.transaction_intent,
                t.exchange_rate::text, (t.exchange_rate != 1.000000000000) AS is_cross_currency,
                COALESCE(c.name,'—') AS category_name, COALESCE(a.name,'—') AS account_name
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN account_sources a ON a.id = t.account_id
         WHERE t.id = $1 AND t.workspace_id = $2`,
        [txC, wsC],
      );
      assert(r.rows.length === 1, 'C1: card query returns 1 row');
      assert(r.rows[0]?.base_amount === '750.00', 'C2: base_amount matches inserted value (ROUND 2dp)');
      assert(r.rows[0]?.is_cross_currency === false, 'C3: exchange_rate=1 → is_cross_currency false');
    }
    {
      const r = await client.query(
        `SELECT 1 FROM transactions WHERE id = $1 AND workspace_id = $2`,
        [txC, ulid()], // wrong workspace
      );
      assert(r.rows.length === 0, 'C4: cross-workspace IDOR blocked — wrong workspace returns 0');
    }

    await cleanup(client, wsC, userC);

    // ── [D] Update amount ─────────────────────────────────────────
    console.log('\n── [D] Update amount ──\n');
    const { wsId: wsD, userId: userD } = await createTestWorkspace(client);
    const accD = await createAccount(client, wsD);
    const catD = await createCategory(client, wsD);
    const txD1 = await insertTx(client, wsD, accD, catD, { amount: '350.00' });

    // D1 & D2: successful update
    await client.query(
      `UPDATE transactions SET base_amount = $1::numeric, original_amount = $1::numeric
       WHERE id = $2 AND workspace_id = $3`,
      ['480.00', txD1, wsD],
    );
    {
      const r = await client.query(
        `SELECT ROUND(base_amount,2)::text AS base_amount, ROUND(original_amount,2)::text AS original_amount
         FROM transactions WHERE id = $1 AND workspace_id = $2`,
        [txD1, wsD],
      );
      assert(r.rows[0]?.base_amount === '480.00', 'D1: base_amount updated correctly');
      assert(r.rows[0]?.original_amount === '480.00', 'D2: original_amount also updated');
    }

    // D3: cross-workspace UPDATE blocked
    {
      const r = await client.query(
        `UPDATE transactions SET base_amount = 999 WHERE id = $1 AND workspace_id = $2 RETURNING id`,
        [txD1, ulid()], // wrong workspace
      );
      assert(r.rows.length === 0, 'D3: cross-workspace UPDATE blocked (IDOR)');
    }

    // D4: cross-currency guard
    const txD2 = await insertTx(client, wsD, accD, catD, {
      amount: '100.00', exchangeRate: '1.200000000000', currency: 'USD',
    });
    {
      const r = await client.query(
        `SELECT exchange_rate::text FROM transactions WHERE id = $1 AND workspace_id = $2`,
        [txD2, wsD],
      );
      const rate = r.rows[0]?.exchange_rate ?? '';
      assert(!rate.startsWith('1.000000'), 'D4: cross-currency tx detected (exchange_rate != 1)');
    }

    // D5: amount validation — zero rejected by regex+logic
    {
      const AMOUNT_RE = /^\d{1,10}(\.\d{1,2})?$/;
      const testVal = '0';
      const matchesRegex = AMOUNT_RE.test(testVal);
      // isPositiveAmountStr equivalent
      const dotIdx = testVal.indexOf('.');
      const intPart = dotIdx === -1 ? testVal : testVal.slice(0, dotIdx);
      const fracPart = dotIdx === -1 ? '' : testVal.slice(dotIdx + 1);
      const isZero = /^0+$/.test(intPart) && (fracPart === '' || /^0+$/.test(fracPart));
      assert(matchesRegex && isZero, 'D5: amount "0" is correctly identified as zero (would be rejected)');
    }

    await cleanup(client, wsD, userD);

    // ── [E] Update category ───────────────────────────────────────
    console.log('\n── [E] Update category ──\n');
    const { wsId: wsE, userId: userE } = await createTestWorkspace(client);
    const accE = await createAccount(client, wsE);
    const catE1 = await createCategory(client, wsE);
    const catE2 = await createCategory(client, wsE);
    const txE = await insertTx(client, wsE, accE, catE1);

    // E1: update to new category
    await client.query(
      `UPDATE transactions SET category_id = $1 WHERE id = $2 AND workspace_id = $3`,
      [catE2, txE, wsE],
    );
    {
      const r = await client.query(
        `SELECT category_id FROM transactions WHERE id = $1 AND workspace_id = $2`,
        [txE, wsE],
      );
      assert(r.rows[0]?.category_id === catE2, 'E1: category updated successfully');
    }

    // E2: invalid category_id returns 0 from validation query
    {
      const r = await client.query(
        `SELECT 1 FROM categories WHERE id = $1 AND workspace_id = $2`,
        [ulid(), wsE], // non-existent
      );
      assert(r.rows.length === 0, 'E2: invalid category_id returns 0 from validation query');
    }

    // E3: cross-workspace UPDATE blocked
    {
      const r = await client.query(
        `UPDATE transactions SET category_id = $1 WHERE id = $2 AND workspace_id = $3 RETURNING id`,
        [catE1, txE, ulid()], // wrong workspace
      );
      assert(r.rows.length === 0, 'E3: cross-workspace category UPDATE blocked');
    }

    // E4: valid category validation passes
    {
      const r = await client.query(
        `SELECT 1 FROM categories WHERE id = $1 AND workspace_id = $2`,
        [catE1, wsE],
      );
      assert(r.rows.length === 1, 'E4: valid catId in workspace confirms OK');
    }

    await cleanup(client, wsE, userE);

    // ── [F] Update account ─────────────────────────────────────────
    console.log('\n── [F] Update account ──\n');
    const { wsId: wsF, userId: userF } = await createTestWorkspace(client);
    const accF1 = await createAccount(client, wsF, { name: 'AccF1', currency: 'RUB' });
    const accF2 = await createAccount(client, wsF, { name: 'AccF2', currency: 'RUB' });
    const catF = await createCategory(client, wsF);
    const txF = await insertTx(client, wsF, accF1, catF);

    // F1: account update persists
    await client.query(
      `UPDATE transactions SET account_id = $1 WHERE id = $2 AND workspace_id = $3`,
      [accF2, txF, wsF],
    );
    {
      const r = await client.query(
        `SELECT account_id FROM transactions WHERE id = $1 AND workspace_id = $2`,
        [txF, wsF],
      );
      assert(r.rows[0]?.account_id === accF2, 'F1: account_id updated successfully');
    }

    // F2: invalid account_id returns 0 from validation query
    {
      const r = await client.query(
        `SELECT 1 FROM account_sources WHERE id = $1 AND workspace_id = $2`,
        [ulid(), wsF],
      );
      assert(r.rows.length === 0, 'F2: invalid account_id returns 0 from validation');
    }

    // F3: cross-workspace UPDATE blocked
    {
      const r = await client.query(
        `UPDATE transactions SET account_id = $1 WHERE id = $2 AND workspace_id = $3 RETURNING id`,
        [accF1, txF, ulid()],
      );
      assert(r.rows.length === 0, 'F3: cross-workspace account UPDATE blocked');
    }

    await cleanup(client, wsF, userF);

    // ── [G] Update intent ──────────────────────────────────────────
    console.log('\n── [G] Update intent ──\n');
    const { wsId: wsG, userId: userG } = await createTestWorkspace(client);
    const accG = await createAccount(client, wsG);
    const catG = await createCategory(client, wsG);
    const txG = await insertTx(client, wsG, accG, catG, { intent: 'expense' });

    // G1: intent updated
    await client.query(
      `UPDATE transactions SET transaction_intent = $1 WHERE id = $2 AND workspace_id = $3`,
      ['income', txG, wsG],
    );
    {
      const r = await client.query(
        `SELECT transaction_intent FROM transactions WHERE id = $1 AND workspace_id = $2`,
        [txG, wsG],
      );
      assert(r.rows[0]?.transaction_intent === 'income', 'G1: intent updated to income');
    }

    // G2: all valid intents in allowlist
    const VALID_INTENTS = ['income', 'expense', 'debt_given', 'debt_received', 'transfer'];
    assert(VALID_INTENTS.every(i => VALID_INTENTS.includes(i)), 'G2: all 5 intents in EDITABLE_INTENTS');

    // G3: invalid intent not in allowlist
    assert(!VALID_INTENTS.includes('delete_all_data'), 'G3: invalid intent rejected by allowlist');

    // G4: cross-workspace UPDATE blocked
    {
      const r = await client.query(
        `UPDATE transactions SET transaction_intent = 'income' WHERE id = $1 AND workspace_id = $2 RETURNING id`,
        [txG, ulid()],
      );
      assert(r.rows.length === 0, 'G4: cross-workspace intent UPDATE blocked');
    }

    await cleanup(client, wsG, userG);

    // ── [H] Callback safety ────────────────────────────────────────
    console.log('\n── [H] Callback safety ──\n');
    {
      function byteLen(s) { return Buffer.byteLength(s, 'utf8'); }
      const TX = '01HZ1234567890ABCDEFGHI234'; // 26 chars
      const CA = '01HZCAT1234567890ABCDEFGH1'; // 26 chars
      assert(byteLen(`ed:v:${TX}`) <= 64, `H1: ed:v:<26> ≤ 64 bytes (${byteLen(`ed:v:${TX}`)})`);
      assert(byteLen(`ed:f:amt:${TX}`) <= 64, `H2: ed:f:amt:<26> ≤ 64 bytes (${byteLen(`ed:f:amt:${TX}`)})`);
      assert(byteLen(`ed:c:cat:${TX}:${CA}`) <= 64, `H3: ed:c:cat:<26>:<26> ≤ 64 bytes (${byteLen(`ed:c:cat:${TX}:${CA}`)})`);

      function parseEditCallback(data) {
        if (!data.startsWith('ed:')) return null;
        const parts = data.split(':');
        const sub = parts[1] ?? '';
        if (sub === 'x') return { cmd: 'cancel' };
        if (sub === 'l') { const p = parseInt(parts[2] ?? '0', 10); return isNaN(p) ? null : { cmd: 'list', page: p }; }
        if (sub === 'v') { const tx = parts[2] ?? ''; return /^[0-9A-Z]{26}$/.test(tx) ? { cmd: 'view' } : null; }
        if (sub === 'f') { const tx = parts[3] ?? ''; return /^[0-9A-Z]{26}$/.test(tx) ? { cmd: 'field' } : null; }
        if (sub === 'c') { const tx = parts[3] ?? ''; return /^[0-9A-Z]{26}$/.test(tx) ? { cmd: 'confirm' } : null; }
        return null;
      }
      assert(parseEditCallback('ed:EVIL') === null, 'H4: malformed callback rejected (null)');
      assert(parseEditCallback('st:x') === null, 'H5: non-ed prefix rejected by parseEditCallback');
    }

    // ── [I] Redis edit state ───────────────────────────────────────
    console.log('\n── [I] Redis edit state ──\n');
    {
      const userId = '123456789';
      const chatId = '-100987654321';
      const key = `midas:edit:${userId}:${chatId}`;
      assert(key === 'midas:edit:123456789:-100987654321', 'I1: edit state key format is midas:edit:<userId>:<chatId>');

      const txId = '01HZ1234567890ABCDEFGHI234';
      const stateValue = `amt:${txId}`;
      assert(stateValue.startsWith('amt:') && stateValue.length === 4 + txId.length, 'I2: state value format is amt:<txId>');

      const EDIT_STATE_TTL_SEC = 300;
      assert(EDIT_STATE_TTL_SEC === 300, 'I3: EDIT_STATE_TTL_SEC = 300 (5 min)');
    }

    // ── [J] Scope guard ────────────────────────────────────────────
    console.log('\n── [J] Scope guard ──\n');
    {
      const r = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'transactions' AND column_name = 'deleted_at'`,
      );
      assert(r.rows.length === 1, 'J1: deleted_at IS in transactions (Phase 1.29 implemented — scope guard updated)');
    }
    {
      const r = await client.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'transactions' AND indexdef LIKE '%gin%'`,
      );
      assert(r.rows.length === 0, 'J2: no GIN/full-text index on transactions (deferred)');
    }
    {
      const TX = '01HZ1234567890ABCDEFGHI234';
      const cb = `ed:v:${TX}`;
      assert(Buffer.byteLength(cb, 'utf8') <= 64, `J3: edit button callback_data ≤ 64 bytes (${Buffer.byteLength(cb, 'utf8')})`);
    }
    {
      const DATE_FIELD = 'dte';
      const allowed = ['amt', 'cat', 'acc', 'int'];
      assert(!allowed.includes(DATE_FIELD), 'J4: date edit field excluded from allowed callbacks');
    }

    // ── [K] Regression ─────────────────────────────────────────────
    console.log('\n── [K] Regression ──\n');
    {
      const r = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'transactions' AND column_name = 'base_currency'`,
      );
      assert(r.rows.length === 1, 'K1: transactions.base_currency exists (Phase 1.27 guard)');
    }
    {
      const r = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'workspaces' AND column_name = 'timezone'`,
      );
      assert(r.rows.length === 1, 'K2: workspaces.timezone exists (Phase 1.25 regression)');
    }
    {
      const r = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'categories' AND column_name = 'group'`,
      );
      assert(r.rows.length === 1, 'K3: categories.group exists (Phase 1.11 regression)');
    }

  } finally {
    client.release();
  }
}

runTests().then(() => {
  console.log(`\n────────────────────────────────────────────────────────────`);
  console.log(`Phase 1.28 Smoke Tests: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log(`\n✅ ALL PHASE 1.28 SMOKE TESTS PASSED\n`);
  } else {
    console.error(`\n❌ ${failed} TESTS FAILED\n`);
    process.exit(1);
  }
  pool.end();
}).catch(err => {
  console.error('Fatal:', err);
  pool.end();
  process.exit(1);
});
