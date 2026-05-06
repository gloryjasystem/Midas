/**
 * Smoke Tests — Phase 1.12: Onboarding Default Data Seeding
 *
 * Tests (16 scenarios covering all required test cases):
 *
 * DB-backed tests (require live PostgreSQL):
 *   1.  New user onboarding creates exactly one default account_sources row
 *   2.  New user onboarding creates exactly one default category row 'Разное' / 'Жизнь'
 *   3.  New user's default account_sources currency = workspace default_currency ('RUB')
 *   4.  New user's default account_sources type = 'manual', name = 'Default'
 *   5.  Existing user onboarding does NOT create duplicate account_sources rows
 *   6.  Existing user onboarding does NOT create duplicate category rows
 *   7.  Concurrent /start race results in exactly one user/workspace/membership
 *   8.  Concurrent /start race results in exactly one account_sources row (no duplicates)
 *   9.  Concurrent /start race results in exactly one categories row (no duplicates)
 *  10.  /category after new-user onboarding returns non-empty category list
 *  11.  draft-confirmation lazy fallback for categories still present (read-only check)
 *  12.  draft-confirmation lazy fallback for account_sources still present (read-only check)
 *  13.  account_sources seeded during onboarding belongs to correct workspace (tenant isolation)
 *  14.  categories seeded during onboarding belongs to correct workspace (tenant isolation)
 *  15.  SECURITY DEFINER function exists with correct 7-parameter signature
 *  16.  Onboarding returns is_new_user=true for new users, false for existing users
 *
 * Logic-only tests (no DB required):
 *  (Embedded in the DB tests above via structural checks)
 *
 * SEC-03: Tenant isolation verified in tests 13 & 14.
 * SEC-12: No PII or raw_text logged.
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

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
// ULID helper (same as Phase 1.11 test)
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
// Onboarding helper: calls system_find_or_create_user (7-param)
// Mirrors onboarding.service.ts logic exactly.
// ─────────────────────────────────────────────────────────────

async function callOnboardingFunction(pool, telegramId) {
  const client = await pool.connect();
  try {
    const candidateUserId       = ulid();
    const candidateWorkspaceId  = ulid();
    const candidateMembershipId = ulid();
    const candidateAccountId    = ulid();
    const candidateCategoryId   = ulid();

    const result = await client.query(
      `SELECT user_id, workspace_id, is_new_user
       FROM system_find_or_create_user($1, $2, $3, $4, $5, $6, $7)`,
      [
        BigInt(telegramId),
        candidateUserId,
        candidateWorkspaceId,
        candidateMembershipId,
        `Workspace of ${telegramId}`,
        candidateAccountId,
        candidateCategoryId,
      ],
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────
// Category query helper (mirrors category.service.ts logic)
// ─────────────────────────────────────────────────────────────

async function queryCategoriesWithRls(pool, wsId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [wsId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await client.query(
      `SELECT name, "group" FROM categories WHERE workspace_id = $1 ORDER BY "group", name`,
      [wsId],
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

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🔍 Phase 1.12 Smoke Tests — Onboarding Default Data Seeding\n');

  // ── TEST 15: SECURITY DEFINER function has 7-param signature ─────────────
  // Run this first (no side effects) so it fails fast if migration wasn't applied.
  console.log('\n[TEST 15] SECURITY DEFINER function has correct 7-parameter signature');

  await withPool(async (pool) => {
    const r = await pool.query(`
      SELECT proname, pronargs, prosecdef, proconfig
      FROM pg_proc
      WHERE proname = 'system_find_or_create_user'
    `);
    assert(r.rows.length === 1, 'system_find_or_create_user exists');
    assert(r.rows[0].pronargs === 7, `function has 7 parameters (got: ${r.rows[0].pronargs})`);
    assert(r.rows[0].prosecdef === true, 'function is SECURITY DEFINER');
    const cfg = r.rows[0].proconfig ?? [];
    assert(
      cfg.some(c => c.includes('search_path')),
      'function has search_path configured',
    );
  });

  // ── DB-backed tests ───────────────────────────────────────────────────────

  await withPool(async (pool) => {

    // ── TEST 1 & 2: New user gets exactly one account_sources and one category ─
    console.log('\n[TEST 1] New user onboarding creates exactly one default account_sources row');
    console.log('[TEST 2] New user onboarding creates exactly one default category row');
    {
      const telegramId = String(Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000);
      const row = await callOnboardingFunction(pool, telegramId);
      assert(row, 'onboarding returned a row');
      assert(row.is_new_user === true, 'is_new_user = true for first call');

      const wsId = row.workspace_id;
      const userId = row.user_id;

      // account_sources
      const acctRows = await pool.query(
        `SELECT id, name, type, currency FROM account_sources WHERE workspace_id = $1`,
        [wsId],
      );
      assert(acctRows.rows.length === 1, `exactly 1 account_sources row (got: ${acctRows.rows.length})`);

      // category
      const catRows = await pool.query(
        `SELECT id, name, "group" FROM categories WHERE workspace_id = $1`,
        [wsId],
      );
      assert(catRows.rows.length === 1, `exactly 1 categories row (got: ${catRows.rows.length})`);
      assert(catRows.rows[0].name === 'Разное', `category name = 'Разное' (got: ${catRows.rows[0].name})`);
      assert(catRows.rows[0].group === 'Жизнь', `category group = 'Жизнь' (got: ${catRows.rows[0].group})`);

      // ── TEST 3 & 4: currency, type, name of default account ───────────────
      console.log('\n[TEST 3] Default account_sources currency = workspace default_currency (RUB)');
      const acct = acctRows.rows[0];
      assert(acct.currency === 'RUB', `account_sources.currency = 'RUB' (got: ${acct.currency})`);

      console.log('\n[TEST 4] Default account_sources type = manual, name = Default');
      assert(acct.type === 'manual', `account_sources.type = 'manual' (got: ${acct.type})`);
      assert(acct.name === 'Default', `account_sources.name = 'Default' (got: ${acct.name})`);

      // ── TEST 16: is_new_user flag ─────────────────────────────────────────
      console.log('\n[TEST 16] is_new_user = true for new user, false for existing user');
      assert(row.is_new_user === true, 'first call: is_new_user = true');

      // Second call with same telegram_id → existing user
      const row2 = await callOnboardingFunction(pool, telegramId);
      assert(row2.is_new_user === false, 'second call (same telegram_id): is_new_user = false');
      assert(row2.user_id === row.user_id, 'second call returns same user_id');
      assert(row2.workspace_id === row.workspace_id, 'second call returns same workspace_id');

      // ── TEST 5 & 6: Existing user does NOT create duplicate rows ──────────
      console.log('\n[TEST 5] Existing user onboarding does NOT create duplicate account_sources rows');
      const acctRows2 = await pool.query(
        `SELECT COUNT(*) AS cnt FROM account_sources WHERE workspace_id = $1`,
        [wsId],
      );
      assert(
        String(acctRows2.rows[0].cnt) === '1',
        `after 2nd call: still exactly 1 account_sources row (got: ${acctRows2.rows[0].cnt})`,
      );

      console.log('\n[TEST 6] Existing user onboarding does NOT create duplicate category rows');
      const catRows2 = await pool.query(
        `SELECT COUNT(*) AS cnt FROM categories WHERE workspace_id = $1`,
        [wsId],
      );
      assert(
        String(catRows2.rows[0].cnt) === '1',
        `after 2nd call: still exactly 1 categories row (got: ${catRows2.rows[0].cnt})`,
      );

      // ── TEST 10: /category after new-user onboarding returns non-empty list ─
      console.log('\n[TEST 10] /category after new-user onboarding returns non-empty category list');
      const catListRows = await queryCategoriesWithRls(pool, wsId, userId);
      assert(catListRows.length > 0, `/category returns non-empty list (got: ${catListRows.length})`);
      assert(
        catListRows.some(r => r.name === 'Разное'),
        '/category list contains Разное',
      );
    }

    // ── TEST 7, 8, 9: Concurrent /start race ─────────────────────────────────
    console.log('\n[TEST 7] Concurrent /start race results in exactly one user/workspace/membership');
    console.log('[TEST 8] Concurrent /start race results in exactly one account_sources row');
    console.log('[TEST 9] Concurrent /start race results in exactly one categories row');
    {
      const telegramId = String(Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000);

      // Fire 3 concurrent onboarding calls for the same telegram_id
      const results = await Promise.all([
        callOnboardingFunction(pool, telegramId),
        callOnboardingFunction(pool, telegramId),
        callOnboardingFunction(pool, telegramId),
      ]);

      // All calls must succeed (no exception)
      assert(results.every(r => r != null), 'all 3 concurrent calls returned a row');

      // All must return the same user_id and workspace_id
      const userIds = new Set(results.map(r => r.user_id));
      const wsIds   = new Set(results.map(r => r.workspace_id));
      assert(userIds.size === 1, `all concurrent calls return same user_id (got ${userIds.size} distinct)`);
      assert(wsIds.size  === 1, `all concurrent calls return same workspace_id (got ${wsIds.size} distinct)`);

      const wsId = [...wsIds][0];

      // Verify exactly one user row
      const userCount = await pool.query(
        `SELECT COUNT(*) AS cnt FROM users WHERE id IN (${[...userIds].map((_, i) => `$${i+1}`).join(',')})`,
        [...userIds],
      );
      assert(
        String(userCount.rows[0].cnt) === '1',
        `exactly 1 user row created (got: ${userCount.rows[0].cnt})`,
      );

      // Verify exactly one workspace row
      const wsCount = await pool.query(
        `SELECT COUNT(*) AS cnt FROM workspaces WHERE id = $1`,
        [wsId],
      );
      assert(String(wsCount.rows[0].cnt) === '1', 'exactly 1 workspace row created');

      // Verify exactly one membership row
      const membCount = await pool.query(
        `SELECT COUNT(*) AS cnt FROM workspace_memberships WHERE workspace_id = $1`,
        [wsId],
      );
      assert(
        String(membCount.rows[0].cnt) === '1',
        `exactly 1 membership row (got: ${membCount.rows[0].cnt})`,
      );

      // Verify exactly one account_sources row
      const acctCount = await pool.query(
        `SELECT COUNT(*) AS cnt FROM account_sources WHERE workspace_id = $1`,
        [wsId],
      );
      assert(
        String(acctCount.rows[0].cnt) === '1',
        `exactly 1 account_sources row after race (got: ${acctCount.rows[0].cnt})`,
      );

      // Verify exactly one categories row
      const catCount = await pool.query(
        `SELECT COUNT(*) AS cnt FROM categories WHERE workspace_id = $1`,
        [wsId],
      );
      assert(
        String(catCount.rows[0].cnt) === '1',
        `exactly 1 categories row after race (got: ${catCount.rows[0].cnt})`,
      );
    }

    // ── TEST 11 & 12: draft-confirmation lazy fallback still present ──────────
    // We verify the SERVICE FILE STILL CONTAINS the fallback code (source-level check).
    // No DB operation — we read the source file and assert the fallback is present.
    console.log('\n[TEST 11] draft-confirmation lazy fallback for categories still present');
    console.log('[TEST 12] draft-confirmation lazy fallback for account_sources still present');
    {
      const serviceFilePath = resolve(
        __dirname,
        '../../apps/background-workers/src/services/draft-confirmation.service.ts',
      );
      let serviceSource;
      try {
        serviceSource = readFileSync(serviceFilePath, 'utf8');
      } catch {
        // Try alternative relative path (running from database package dir)
        const altPath = resolve(
          __dirname,
          '../../../apps/background-workers/src/services/draft-confirmation.service.ts',
        );
        serviceSource = readFileSync(altPath, 'utf8');
      }

      // Categories fallback: INSERT INTO categories ... ON CONFLICT ... DO NOTHING
      assert(
        serviceSource.includes("INSERT INTO categories") &&
        serviceSource.includes("ON CONFLICT") &&
        serviceSource.includes("Разное"),
        'draft-confirmation contains categories lazy-create fallback (INSERT INTO categories ... Разное)',
      );

      // account_sources fallback: INSERT INTO account_sources ... ON CONFLICT DO NOTHING
      assert(
        serviceSource.includes("INSERT INTO account_sources") &&
        serviceSource.includes("ON CONFLICT DO NOTHING"),
        'draft-confirmation contains account_sources lazy-create fallback (INSERT INTO account_sources ... ON CONFLICT DO NOTHING)',
      );
    }

    // ── TEST 13 & 14: Tenant isolation — seeded rows belong to correct workspace ─
    console.log('\n[TEST 13] account_sources seeded during onboarding belongs to correct workspace');
    console.log('[TEST 14] categories seeded during onboarding belongs to correct workspace');
    {
      const tid1 = String(Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000);
      const tid2 = String(Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000);

      const row1 = await callOnboardingFunction(pool, tid1);
      const row2 = await callOnboardingFunction(pool, tid2);

      const ws1 = row1.workspace_id;
      const ws2 = row2.workspace_id;

      // account_sources: ws1's row must NOT appear in ws2
      const acct1InWs2 = await pool.query(
        `SELECT COUNT(*) AS cnt FROM account_sources WHERE workspace_id = $1`,
        [ws1],
      );
      const acct2InWs1 = await pool.query(
        `SELECT COUNT(*) AS cnt FROM account_sources WHERE workspace_id = $1`,
        [ws2],
      );
      assert(String(acct1InWs2.rows[0].cnt) === '1', 'ws1 has exactly 1 account_sources');
      assert(String(acct2InWs1.rows[0].cnt) === '1', 'ws2 has exactly 1 account_sources');

      // Verify cross-workspace isolation: no account_sources row belongs to BOTH workspaces
      const crossAcct = await pool.query(
        `SELECT COUNT(*) AS cnt FROM account_sources WHERE workspace_id = ANY($1)`,
        [[ws1, ws2]],
      );
      assert(
        String(crossAcct.rows[0].cnt) === '2',
        `total account_sources for 2 workspaces = 2 (each isolated, got: ${crossAcct.rows[0].cnt})`,
      );

      // categories: same isolation check
      const cat1InWs1 = await pool.query(
        `SELECT COUNT(*) AS cnt FROM categories WHERE workspace_id = $1`,
        [ws1],
      );
      const cat2InWs2 = await pool.query(
        `SELECT COUNT(*) AS cnt FROM categories WHERE workspace_id = $1`,
        [ws2],
      );
      assert(String(cat1InWs1.rows[0].cnt) === '1', 'ws1 has exactly 1 category');
      assert(String(cat2InWs2.rows[0].cnt) === '1', 'ws2 has exactly 1 category');

      const crossCat = await pool.query(
        `SELECT COUNT(*) AS cnt FROM categories WHERE workspace_id = ANY($1)`,
        [[ws1, ws2]],
      );
      assert(
        String(crossCat.rows[0].cnt) === '2',
        `total categories for 2 workspaces = 2 (each isolated, got: ${crossCat.rows[0].cnt})`,
      );
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

runTests()
  .then(() => {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Phase 1.12 Smoke Tests: ${passed} passed, ${failed} failed`);
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
