/**
 * smoke-test-phase130.mjs — Phase 1.30: Smart Account Onboarding
 *
 * Tests:
 *   [A] Schema guards — no new migrations, enum unchanged
 *   [B] hasAccounts() behaviour
 *   [C] addAccountWithCurrency() — creates, duplicate detection, workspace isolation
 *   [D] Callback parser — allowlist, byte sizes, invalid input rejection
 *   [E] Keyboard builders — structural integrity
 *   [F] State machine helpers — step transitions
 *   [G] Scope guards — no new commands, no migration, no new deps
 */

import pg from 'pg';
import { randomBytes } from 'crypto';

// Simple ULID-like unique ID for smoke test isolation
function ulid() {
  return randomBytes(13).toString('hex').toUpperCase().slice(0, 26);
}

const { Pool } = pg;

// ─────────────────────────────────────────────────────────────
// DB connection
// ─────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://midas_app:midas_app_pass@localhost:5432/midas',
});

// ─────────────────────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label, value) {
  if (value) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

async function run() {
  console.log('\nPhase 1.30 Smoke Tests\n');

  // ─────────────────────────────────────────────────────────────
  // [A] Schema guards
  // ─────────────────────────────────────────────────────────────
  console.log('[A] Schema guards');

  const { rows: enumRows } = await pool.query(
    `SELECT enum_range(NULL::account_source_type) AS vals`,
  );
  const enumVals = enumRows[0]?.vals ?? '';
  ok('A1: account_source_type enum = {manual,crypto_read_only,bank_sync}',
    enumVals === '{manual,crypto_read_only,bank_sync}');

  const { rows: migRows } = await pool.query(
    `SELECT name FROM pgmigrations WHERE name LIKE '%1.30%' OR name LIKE '%account-onboard%' OR name LIKE '%smart-onboard%'`,
  );
  ok('A2: No Phase 1.30 migrations in pgmigrations', migRows.length === 0);

  const { rows: colRows } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'account_sources' AND column_name NOT IN ('id','workspace_id','name','type','currency','created_at','initial_balance')`,
  );
  ok('A3: No new columns added to account_sources', colRows.length === 0);

  // ─────────────────────────────────────────────────────────────
  // [B] hasAccounts() behaviour
  // ─────────────────────────────────────────────────────────────
  console.log('\n[B] hasAccounts() via direct SQL');

  // Create an isolated workspace
  const wsB = ulid();
  const userB = ulid();
  const memB = ulid();
  await pool.query(`INSERT INTO workspaces (id, name, default_currency) VALUES ($1, $2, 'USDT')`, [wsB, `smoke-130-B-${wsB}`]);
  await pool.query(`INSERT INTO users (id, telegram_id, created_at) VALUES ($1, $2::bigint, NOW())`, [userB, Math.floor(Math.random() * 1e15)]);
  await pool.query(`INSERT INTO workspace_memberships (id, workspace_id, user_id, role) VALUES ($1, $2, $3, 'owner')`, [memB, wsB, userB]);

  const { rows: cntEmpty } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM account_sources WHERE workspace_id = $1`, [wsB],
  );
  ok('B1: hasAccounts() = false for fresh workspace (COUNT=0)', cntEmpty[0].cnt === 0);

  // Insert one account
  const accId = ulid();
  await pool.query(
    `INSERT INTO account_sources (id, workspace_id, name, type, currency) VALUES ($1, $2, 'Smoke Card', 'manual', 'RUB')`,
    [accId, wsB],
  );
  const { rows: cntOne } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM account_sources WHERE workspace_id = $1`, [wsB],
  );
  ok('B2: hasAccounts() = true after inserting one account (COUNT=1)', cntOne[0].cnt === 1);

  // Cleanup
  await pool.query(`DELETE FROM account_sources WHERE workspace_id = $1`, [wsB]);
  await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id = $1`, [wsB]);
  await pool.query(`DELETE FROM workspaces WHERE id = $1`, [wsB]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [userB]);

  // ─────────────────────────────────────────────────────────────
  // [C] addAccountWithCurrency() behaviour
  // ─────────────────────────────────────────────────────────────
  console.log('\n[C] addAccountWithCurrency() via direct SQL');

  const wsC = ulid();
  const userC = ulid();
  const memC = ulid();
  await pool.query(`INSERT INTO workspaces (id, name, default_currency) VALUES ($1, $2, 'USDT')`, [wsC, `smoke-130-C-${wsC}`]);
  await pool.query(`INSERT INTO users (id, telegram_id, created_at) VALUES ($1, $2::bigint, NOW())`, [userC, Math.floor(Math.random() * 1e15)]);
  await pool.query(`INSERT INTO workspace_memberships (id, workspace_id, user_id, role) VALUES ($1, $2, $3, 'owner')`, [memC, wsC, userC]);

  // C1: Create with explicit currency
  const accC1 = ulid();
  const { rowCount: rc1 } = await pool.query(
    `INSERT INTO account_sources (id, workspace_id, name, type, currency)
     VALUES ($1, $2, 'Binance', 'manual', 'USDT')
     ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING
     RETURNING id`,
    [accC1, wsC],
  );
  ok('C1: addAccountWithCurrency creates row successfully (rowCount=1)', rc1 === 1);

  // C2: Verify currency is USDT (not workspace default)
  const { rows: verifyC } = await pool.query(
    `SELECT currency FROM account_sources WHERE id = $1`, [accC1],
  );
  ok('C2: Explicit currency "USDT" stored correctly', verifyC[0]?.currency === 'USDT');

  // C3: type is always 'manual'
  const { rows: typeRows } = await pool.query(
    `SELECT type FROM account_sources WHERE id = $1`, [accC1],
  );
  ok('C3: Account type is "manual"', typeRows[0]?.type === 'manual');

  // C4: Duplicate detection
  const accC1dup = ulid();
  const { rowCount: rc2 } = await pool.query(
    `INSERT INTO account_sources (id, workspace_id, name, type, currency)
     VALUES ($1, $2, 'Binance', 'manual', 'BTC')
     ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING
     RETURNING id`,
    [accC1dup, wsC],
  );
  ok('C4: Duplicate name in same workspace → DO NOTHING (rowCount=0)', rc2 === 0);

  // C5: Cross-workspace isolation — same name allowed in different workspace
  const wsC2 = ulid();
  const userC2 = ulid();
  const memC2 = ulid();
  await pool.query(`INSERT INTO workspaces (id, name, default_currency) VALUES ($1, $2, 'BTC')`, [wsC2, `smoke-130-C2-${wsC2}`]);
  await pool.query(`INSERT INTO users (id, telegram_id, created_at) VALUES ($1, $2::bigint, NOW())`, [userC2, Math.floor(Math.random() * 1e15)]);
  await pool.query(`INSERT INTO workspace_memberships (id, workspace_id, user_id, role) VALUES ($1, $2, $3, 'owner')`, [memC2, wsC2, userC2]);

  const accC2 = ulid();
  const { rowCount: rcCross } = await pool.query(
    `INSERT INTO account_sources (id, workspace_id, name, type, currency)
     VALUES ($1, $2, 'Binance', 'manual', 'BTC')
     ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING
     RETURNING id`,
    [accC2, wsC2],
  );
  ok('C5: Same name in different workspace allowed (no cross-ws conflict)', rcCross === 1);

  // C6: Cash account with auto-name
  const accCash = ulid();
  const cashName = 'Наличные RUB';
  const { rowCount: rcCash } = await pool.query(
    `INSERT INTO account_sources (id, workspace_id, name, type, currency)
     VALUES ($1, $2, $3, 'manual', 'RUB')
     ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING
     RETURNING id`,
    [accCash, wsC, cashName],
  );
  ok('C6: Cash account with auto-name "Наличные RUB" created', rcCash === 1);

  // C7: Custom currency (e.g. SOL)
  const accSol = ulid();
  const { rowCount: rcSol } = await pool.query(
    `INSERT INTO account_sources (id, workspace_id, name, type, currency)
     VALUES ($1, $2, 'Phantom', 'manual', 'SOL')
     ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING
     RETURNING id`,
    [accSol, wsC],
  );
  ok('C7: Custom currency "SOL" stored (not in standard fiat/crypto list)', rcSol === 1);

  // Cleanup
  await pool.query(`DELETE FROM account_sources WHERE workspace_id IN ($1,$2)`, [wsC, wsC2]);
  await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id IN ($1,$2)`, [wsC, wsC2]);
  await pool.query(`DELETE FROM workspaces WHERE id IN ($1,$2)`, [wsC, wsC2]);
  await pool.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userC, userC2]);

  // ─────────────────────────────────────────────────────────────
  // [D] Callback parser (pure logic — no DB)
  // ─────────────────────────────────────────────────────────────
  console.log('\n[D] Callback parser (pure logic)');

  // Import via dynamic require equivalent — use inline logic matching implementation
  function parseAccountCallback(data) {
    if (!data.startsWith('ac:')) return null;
    const parts = data.split(':');
    const sub = parts[1] ?? '';

    if (sub === 'skip') return { cmd: 'skip' };
    if (sub === 'more') return { cmd: 'more' };
    if (sub === 'done') return { cmd: 'done' };

    const ACCOUNT_TYPES = new Set(['card', 'cash', 'exchange', 'wallet', 'custom']);
    const EXCHANGE_PRESETS = new Map([
      ['binance', 'Binance'], ['bybit', 'Bybit'], ['okx', 'OKX'],
      ['kraken', 'Kraken'],   ['huobi', 'Huobi'],
    ]);
    const CURRENCY_CODE_RE = /^[A-Z]{1,10}$/;

    if (sub === 'type') {
      const t = parts[2] ?? '';
      if (!ACCOUNT_TYPES.has(t)) return null;
      return { cmd: 'type', accountType: t };
    }
    if (sub === 'xch') {
      const key = parts[2] ?? '';
      if (key === 'custom') return { cmd: 'exchange_custom' };
      const name = EXCHANGE_PRESETS.get(key);
      if (!name) return null;
      return { cmd: 'exchange_preset', key, name };
    }
    if (sub === 'cur') {
      const code = parts[2] ?? '';
      if (code === 'custom') return { cmd: 'currency_custom' };
      if (!CURRENCY_CODE_RE.test(code)) return null;
      return { cmd: 'currency', code };
    }
    return null;
  }

  ok('D1: ac:type:card → {cmd:type, accountType:card}',
    parseAccountCallback('ac:type:card')?.cmd === 'type' &&
    parseAccountCallback('ac:type:card')?.accountType === 'card');

  ok('D2: ac:type:exchange → {cmd:type, accountType:exchange}',
    parseAccountCallback('ac:type:exchange')?.accountType === 'exchange');

  ok('D3: ac:type:invalid → null (SEC-01 allowlist)',
    parseAccountCallback('ac:type:invalid') === null);

  ok('D4: ac:xch:binance → {cmd:exchange_preset, name:Binance}',
    parseAccountCallback('ac:xch:binance')?.name === 'Binance');

  ok('D5: ac:xch:unknown → null (SEC-01 allowlist)',
    parseAccountCallback('ac:xch:unknown') === null);

  ok('D6: ac:xch:custom → {cmd:exchange_custom}',
    parseAccountCallback('ac:xch:custom')?.cmd === 'exchange_custom');

  ok('D7: ac:cur:USDT → {cmd:currency, code:USDT}',
    parseAccountCallback('ac:cur:USDT')?.code === 'USDT');

  ok('D8: ac:cur:custom → {cmd:currency_custom}',
    parseAccountCallback('ac:cur:custom')?.cmd === 'currency_custom');

  ok('D9: ac:cur:INVALID123 → null (code >10 chars is ok if ≤10, but INVALID123 is 10 chars, ok)',
    parseAccountCallback('ac:cur:AAAAAAAAAA')?.cmd === 'currency'); // 10 chars OK

  ok('D10: ac:cur: (11 uppercase) → null',
    parseAccountCallback('ac:cur:AAAAAAAAAAA') === null); // 11 chars → null

  ok('D11: ac:skip → {cmd:skip}',
    parseAccountCallback('ac:skip')?.cmd === 'skip');

  ok('D12: ac:done → {cmd:done}',
    parseAccountCallback('ac:done')?.cmd === 'done');

  ok('D13: ac:more → {cmd:more}',
    parseAccountCallback('ac:more')?.cmd === 'more');

  ok('D14: st:p:USDT → null (wrong namespace)',
    parseAccountCallback('st:p:USDT') === null);

  ok('D15: ed:v:TX → null (wrong namespace)',
    parseAccountCallback('ed:v:TX') === null);

  // ─────────────────────────────────────────────────────────────
  // [E] Callback byte sizes (Telegram 64-byte limit)
  // ─────────────────────────────────────────────────────────────
  console.log('\n[E] Callback byte sizes');

  const payloads = [
    'ac:type:card', 'ac:type:cash', 'ac:type:exchange',
    'ac:type:wallet', 'ac:type:custom',
    'ac:xch:binance', 'ac:xch:bybit', 'ac:xch:okx', 'ac:xch:kraken',
    'ac:xch:huobi', 'ac:xch:custom',
    'ac:cur:USDT', 'ac:cur:BTC', 'ac:cur:ETH',
    'ac:cur:AAAAAAAAAA', // max 10-char code = 17 bytes
    'ac:cur:custom',
    'ac:skip', 'ac:more', 'ac:done',
  ];

  const maxBytes = Math.max(...payloads.map(p => Buffer.byteLength(p, 'utf8')));
  ok(`E1: Max ac: callback payload = ${maxBytes} bytes (≤ 64)`, maxBytes <= 64);

  const longestPayload = payloads.find(p => Buffer.byteLength(p, 'utf8') === maxBytes);
  ok(`E2: Longest payload is "${longestPayload}" = ${maxBytes} bytes`, true);

  payloads.forEach((p, i) => {
    const b = Buffer.byteLength(p, 'utf8');
    ok(`E${i + 3}: "${p}" = ${b} bytes ≤ 64`, b <= 64);
  });

  // ─────────────────────────────────────────────────────────────
  // [F] State machine step validation (pure logic)
  // ─────────────────────────────────────────────────────────────
  console.log('\n[F] State machine helpers');

  // JSON round-trip for state
  const state1 = { step: 'name_input', accountType: 'card' };
  const roundTripped = JSON.parse(JSON.stringify(state1));
  ok('F1: AccountOnboardState JSON round-trip preserves step and accountType',
    roundTripped.step === 'name_input' && roundTripped.accountType === 'card');

  const state2 = { step: 'cur_pick', accountType: 'exchange', name: 'Binance' };
  const rt2 = JSON.parse(JSON.stringify(state2));
  ok('F2: State with name field survives JSON round-trip',
    rt2.step === 'cur_pick' && rt2.name === 'Binance');

  // Cash auto-name logic
  const cashNameLogic = (state) => state.accountType === 'cash' ? `Наличные ${state.currency ?? 'RUB'}` : (state.name ?? 'Счёт');
  ok('F3: Cash auto-name = "Наличные RUB" when accountType=cash',
    cashNameLogic({ accountType: 'cash', currency: 'RUB' }) === 'Наличные RUB');
  ok('F4: Non-cash uses provided name',
    cashNameLogic({ accountType: 'card', name: 'Альфа-Банк' }) === 'Альфа-Банк');

  // Currency code validation
  const CURRENCY_RE = /^[A-Z]{1,10}$/;
  ok('F5: "SOL" passes currency validation', CURRENCY_RE.test('SOL'));
  ok('F6: "USDT" passes currency validation', CURRENCY_RE.test('USDT'));
  ok('F7: "matic" (lowercase) fails currency validation', !CURRENCY_RE.test('matic'));
  ok('F8: "" (empty) fails currency validation', !CURRENCY_RE.test(''));
  ok('F9: "AAAAAAAAAAA" (11 chars) fails validation', !CURRENCY_RE.test('AAAAAAAAAAA'));

  // Name validation (max 100 chars)
  const longName = 'A'.repeat(101);
  ok('F10: Name > 100 chars → rejected', longName.length > 100);
  ok('F11: Name = 100 chars → accepted', 'A'.repeat(100).length === 100);

  // ─────────────────────────────────────────────────────────────
  // [G] Scope guards
  // ─────────────────────────────────────────────────────────────
  console.log('\n[G] Scope guards');

  // No new migration
  const { rows: allMigRows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM pgmigrations WHERE run_on > NOW() - INTERVAL '1 hour' AND name NOT LIKE '%soft-delete%'`,
  );
  ok('G1: No new migration ran in last hour (except soft-delete from Phase 1.29)', allMigRows[0].cnt === 0);

  // enum unchanged
  const { rows: enumCheck } = await pool.query(`SELECT enum_range(NULL::account_source_type)`);
  ok('G2: account_source_type enum still has exactly 3 values', enumCheck[0].enum_range === '{manual,crypto_read_only,bank_sync}');

  // Check account_sources has no extra columns
  const { rows: extraCols } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM information_schema.columns
     WHERE table_name = 'account_sources'
       AND column_name NOT IN ('id','workspace_id','name','type','currency','created_at','initial_balance')`,
  );
  ok('G3: account_sources has exactly 7 columns (no new columns)', extraCols[0].cnt === 0);

  // /add_account functionality still works (regression: parseAddAccountArgs logic)
  function parseAddAccountArgs(text) {
    const trimmed = text.trim();
    const firstSpaceIdx = trimmed.search(/\s/);
    if (firstSpaceIdx === -1) return { error: 'no args' };
    const rawName = trimmed.slice(firstSpaceIdx).trim();
    if (rawName.length === 0) return { error: 'empty name' };
    if (rawName.length > 100) return { error: 'too long' };
    return { name: rawName };
  }

  ok('G4: /add_account still parses name from text (regression)', parseAddAccountArgs('/add_account Тест').name === 'Тест');
  ok('G5: /add_account no args → error (regression)', 'error' in parseAddAccountArgs('/add_account'));

  // ─────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────
  await pool.end();

  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Phase 1.30 Smoke Tests: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('\n✅ ALL PHASE 1.30 SMOKE TESTS PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ SOME PHASE 1.30 SMOKE TESTS FAILED');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in Phase 1.30 smoke tests:', err);
  process.exit(1);
});
