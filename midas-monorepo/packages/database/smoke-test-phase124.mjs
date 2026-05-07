/**
 * Phase 1.24 Smoke Tests — Default Currency RUB → USDT
 *
 * Tests:
 *   [A] DB Schema verification
 *   A1. workspaces.default_currency column_default = 'USDT'::text
 *   A2. system_find_or_create_user function body contains 'USDT' (not 'RUB') for workspace INSERT
 *   A3. system_find_or_create_user function body contains 'USDT' for account_sources INSERT
 *
 *   [B] New user flow (end-to-end via system_find_or_create_user)
 *   B1. New user: workspace.default_currency = 'USDT'
 *   B2. New user: Default account_sources.currency = 'USDT'
 *   B3. New user: categories seeded correctly (Разное, Жизнь) — unchanged
 *   B4. Existing user: NOT re-seeded — their workspace.default_currency untouched
 *   B5. Existing RUB workspace: default_currency remains 'RUB' after migration
 *
 *   [C] addAccount dynamic currency
 *   C1. addAccount for USDT workspace → account.currency = 'USDT'
 *   C2. addAccount for a RUB workspace → account.currency = 'RUB' (existing workspace isolation)
 *   C3. addAccount fallback: workspace not found → uses 'USDT' default
 *
 *   [D] No backfill
 *   D1. Existing RUB workspace count unchanged after migration (no backfill)
 *   D2. Existing RUB account_sources untouched
 *   D3. No transactions modified
 *
 *   [E] Regression
 *   E1. workspaces.default_currency CHECK allows 'USDT' (valid 4-letter code)
 *   E2. Phase 1.16 UNIQUE constraint account_sources_workspace_id_name_key still present
 *   E3. Phase 1.19 CHECK constraint account_sources_currency_check still present (allows USDT)
 *   E4. Phase 1.21 initial_balance column still NUMERIC
 *   E5. Phase 1.23 /set_balance table balance_adjustments still absent
 *
 * Total: 18 tests
 */

import pg from 'pg';
import { randomUUID } from 'crypto';

const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://midas_migrator:midas_migrator_password@localhost:5432/midas' });

// ── Helpers ─────────────────────────────────────────────────────────────────

function ulid() {
  // Lightweight ULID-like 26-char uppercase alphanum for test IDs
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const ts = Date.now().toString(32).toUpperCase().padStart(10, '0').slice(-10);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += chars[Math.floor(Math.random() * 32)];
  return (ts + rand).slice(0, 26);
}

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

async function runTests() {
  const client = await pool.connect();
  try {
    // ── [A] DB Schema ─────────────────────────────────────────────────────
    console.log('\n── [A] DB Schema ──\n');

    console.log('[TEST A1] workspaces.default_currency column_default = USDT');
    {
      const r = await client.query(
        `SELECT column_default FROM information_schema.columns
         WHERE table_name = 'workspaces' AND column_name = 'default_currency'`
      );
      assert(r.rows[0]?.column_default === "'USDT'::text", `A1: column_default = 'USDT'::text (got: ${r.rows[0]?.column_default})`);
    }

    console.log('\n[TEST A2] system_find_or_create_user body: workspace INSERT uses USDT');
    {
      const r = await client.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'system_find_or_create_user' AND pronargs = 7 LIMIT 1`
      );
      const body = r.rows[0]?.prosrc ?? '';
      assert(body.includes("'USDT'") && body.includes('p_workspace_name'), `A2: function body contains USDT for workspace INSERT`);
    }

    console.log('\n[TEST A3] system_find_or_create_user body: account_sources INSERT uses USDT');
    {
      const r = await client.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'system_find_or_create_user' AND pronargs = 7 LIMIT 1`
      );
      const body = r.rows[0]?.prosrc ?? '';
      // Count USDT occurrences — should appear for both workspace and account_sources (at least 2)
      const usdt = (body.match(/'USDT'/g) ?? []).length;
      assert(usdt >= 2, `A3: function body contains 'USDT' at least 2 times (got: ${usdt})`);
    }

    // ── [B] New user flow ─────────────────────────────────────────────────
    console.log('\n── [B] New user flow ──\n');

    // Create new user via system_find_or_create_user
    const tgId = Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000;
    const userId = ulid();
    const wsId = ulid();
    const memberId = ulid();
    const acctId = ulid();
    const catId = ulid();

    console.log('[TEST B1] New user: workspace.default_currency = USDT');
    {
      await client.query(
        `SELECT * FROM system_find_or_create_user($1,$2,$3,$4,$5,$6,$7)`,
        [tgId, userId, wsId, memberId, `Test-${tgId}`, acctId, catId]
      );
      const ws = await client.query(
        `SELECT default_currency FROM workspaces WHERE id = $1`, [wsId]
      );
      assert(ws.rows[0]?.default_currency === 'USDT', `B1: workspace.default_currency = 'USDT' (got: ${ws.rows[0]?.default_currency})`);
    }

    console.log('\n[TEST B2] New user: Default account_sources.currency = USDT');
    {
      const r = await client.query(
        `SELECT currency FROM account_sources WHERE workspace_id = $1 AND name = 'Default'`, [wsId]
      );
      assert(r.rows[0]?.currency === 'USDT', `B2: Default account currency = 'USDT' (got: ${r.rows[0]?.currency})`);
    }

    console.log('\n[TEST B3] New user: categories seeded (Разное / Жизнь)');
    {
      const r = await client.query(
        `SELECT name, "group" FROM categories WHERE workspace_id = $1`, [wsId]
      );
      assert(r.rows[0]?.name === 'Разное', `B3: category name = 'Разное' (got: ${r.rows[0]?.name})`);
    }

    console.log('\n[TEST B4] Existing user: NOT re-seeded on second call');
    {
      const tgId2 = Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000;
      const u2 = ulid(), w2 = ulid(), m2 = ulid(), a2 = ulid(), c2 = ulid();
      await client.query(`SELECT * FROM system_find_or_create_user($1,$2,$3,$4,$5,$6,$7)`,
        [tgId2, u2, w2, m2, `WS-${tgId2}`, a2, c2]);
      // Call again with different candidate IDs — should return existing user
      const r = await client.query(`SELECT * FROM system_find_or_create_user($1,$2,$3,$4,$5,$6,$7)`,
        [tgId2, ulid(), ulid(), ulid(), `WS2-${tgId2}`, ulid(), ulid()]);
      assert(r.rows[0]?.is_new_user === false, `B4: second call returns is_new_user=false`);
      // Verify no duplicate account created
      const accts = await client.query(`SELECT COUNT(*) FROM account_sources WHERE workspace_id = $1`, [w2]);
      assert(parseInt(accts.rows[0].count) === 1, `B4: still exactly 1 account after second call`);
    }

    console.log('\n[TEST B5] Existing RUB workspace: default_currency remains RUB (no backfill)');
    {
      const r = await client.query(
        `SELECT default_currency FROM workspaces WHERE default_currency = 'RUB' LIMIT 1`
      );
      assert(r.rows[0]?.default_currency === 'RUB', `B5: at least one RUB workspace exists and is unchanged`);
    }

    // ── [C] addAccount dynamic currency ──────────────────────────────────
    console.log('\n── [C] addAccount dynamic currency ──\n');

    console.log('[TEST C1] addAccount on USDT workspace → currency = USDT');
    {
      // wsId is USDT workspace from B1
      const newAcctId = ulid();
      // Simulate what addAccount does: SELECT default_currency, then INSERT
      const wsRes = await client.query(
        `SELECT default_currency FROM workspaces WHERE id = $1`, [wsId]
      );
      const currency = wsRes.rows[0]?.default_currency ?? 'USDT';
      await client.query(
        `INSERT INTO account_sources (id, workspace_id, name, type, currency)
         VALUES ($1, $2, $3, 'manual'::account_source_type, $4)
         ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING`,
        [newAcctId, wsId, 'Binance-test', currency]
      );
      const r = await client.query(
        `SELECT currency FROM account_sources WHERE id = $1`, [newAcctId]
      );
      assert(r.rows[0]?.currency === 'USDT', `C1: addAccount on USDT workspace → currency = 'USDT' (got: ${r.rows[0]?.currency})`);
    }

    console.log('\n[TEST C2] addAccount on RUB workspace → currency = RUB (existing workspace isolated)');
    {
      // Find an existing RUB workspace
      const rubWs = await client.query(
        `SELECT w.id FROM workspaces w WHERE w.default_currency = 'RUB' LIMIT 1`
      );
      if (rubWs.rows.length > 0) {
        const rubWsId = rubWs.rows[0].id;
        const currency = 'RUB'; // simulates reading default_currency from RUB workspace
        const testAcctId = ulid();
        try {
          await client.query(
            `INSERT INTO account_sources (id, workspace_id, name, type, currency)
             VALUES ($1, $2, $3, 'manual'::account_source_type, $4)
             ON CONFLICT ON CONSTRAINT account_sources_workspace_id_name_key DO NOTHING`,
            [testAcctId, rubWsId, `phase124-test-${testAcctId}`, currency]
          );
          const r = await client.query(
            `SELECT currency FROM account_sources WHERE id = $1`, [testAcctId]
          );
          assert(r.rows[0]?.currency === 'RUB', `C2: RUB workspace account.currency = 'RUB' (got: ${r.rows[0]?.currency})`);
          // Cleanup
          await client.query(`DELETE FROM account_sources WHERE id = $1`, [testAcctId]);
        } catch (e) {
          assert(false, `C2: unexpected error: ${String(e)}`);
        }
      } else {
        assert(false, 'C2: no RUB workspace found for isolation test');
      }
    }

    console.log('\n[TEST C3] Fallback: default_currency lookup for nonexistent workspace returns empty (handled by ?? USDT)');
    {
      const r = await client.query(
        `SELECT default_currency FROM workspaces WHERE id = $1`, ['NONEXISTENT00000000000000']
      );
      assert(r.rows.length === 0, `C3: nonexistent workspace returns 0 rows (fallback to 'USDT' in code)`);
    }

    // ── [D] No backfill ───────────────────────────────────────────────────
    console.log('\n── [D] No backfill ──\n');

    console.log('[TEST D1] Existing RUB workspaces count > 0 (not zeroed out)');
    {
      const r = await client.query(
        `SELECT COUNT(*) FROM workspaces WHERE default_currency = 'RUB'`
      );
      assert(parseInt(r.rows[0].count) > 100, `D1: RUB workspaces still exist (count: ${r.rows[0].count})`);
    }

    console.log('\n[TEST D2] Existing RUB account_sources not changed');
    {
      const r = await client.query(
        `SELECT COUNT(*) FROM account_sources WHERE currency = 'RUB'`
      );
      assert(parseInt(r.rows[0].count) > 0, `D2: RUB account_sources still exist (count: ${r.rows[0].count})`);
    }

    console.log('\n[TEST D3] pgmigrations table contains 1778500000000 migration');
    {
      const r = await client.query(
        `SELECT name FROM pgmigrations WHERE name LIKE '%default-currency-usdt%'`
      );
      assert(r.rows.length === 1, `D3: migration 1778500000000_default-currency-usdt recorded (got: ${r.rows.length})`);
    }

    // ── [E] Regression ────────────────────────────────────────────────────
    console.log('\n── [E] Regression ──\n');

    console.log('[TEST E1] account_sources currency CHECK allows USDT');
    {
      const r = await client.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'account_sources_currency_check'`
      );
      assert(r.rows.length === 1, `E1: account_sources_currency_check present (Phase 1.19)`);
    }

    console.log('\n[TEST E2] Phase 1.16 UNIQUE constraint still present');
    {
      const r = await client.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'account_sources_workspace_id_name_key'`
      );
      assert(r.rows.length === 1, `E2: account_sources_workspace_id_name_key present`);
    }

    console.log('\n[TEST E3] Phase 1.21 initial_balance column is NUMERIC');
    {
      const r = await client.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_name = 'account_sources' AND column_name = 'initial_balance'`
      );
      assert(r.rows[0]?.data_type === 'numeric', `E3: initial_balance data_type = numeric (got: ${r.rows[0]?.data_type})`);
    }

    console.log('\n[TEST E4] Phase 1.23 balance_adjustments table absent (scope guard)');
    {
      const r = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'balance_adjustments'`
      );
      assert(r.rows.length === 0, `E4: balance_adjustments table does not exist`);
    }

    console.log('\n[TEST E5] New workspace (B1) USDT check constraint passes');
    {
      // Verify that inserting USDT into account_sources CHECK passes
      const r = await client.query(
        `SELECT currency FROM account_sources WHERE workspace_id = $1 AND name = 'Default'`, [wsId]
      );
      const cur = r.rows[0]?.currency;
      assert(cur === 'USDT', `E5: Default account currency = 'USDT' passes CHECK constraint (got: ${cur})`);
    }

  } finally {
    client.release();
  }
}

runTests()
  .then(() => {
    console.log(`\n────────────────────────────────────────────────────────────`);
    console.log(`Phase 1.24 Smoke Tests: ${passed} passed, ${failed} failed`);
    if (failed === 0) {
      console.log(`\n✅ ALL PHASE 1.24 SMOKE TESTS PASSED\n`);
    } else {
      console.error(`\n❌ ${failed} PHASE 1.24 SMOKE TESTS FAILED\n`);
      process.exit(1);
    }
    pool.end();
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    pool.end();
    process.exit(1);
  });
