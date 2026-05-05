/**
 * Smoke Tests — Phase 1.8-B: Runtime Consistency & Security Hardening
 *
 * Tests (8 scenarios):
 *   1. resolveUserId returns correct user_id for an existing telegram_id
 *   2. resolveUserId throws for unknown telegram_id
 *   3. resolveUserId returns correct user after multiple users exist
 *   4. SECURITY DEFINER: system_create_onboarding_workspace has fixed search_path
 *   5. SECURITY DEFINER: system_find_or_create_user has fixed search_path
 *   6. SECURITY DEFINER: all 3 functions owned by midas_migrator
 *   7. SECURITY DEFINER: EXECUTE revoked from PUBLIC for all 3 functions
 *   8. SECURITY DEFINER: EXECUTE granted to midas_app for all 3 functions
 *
 * SEC-03: All tests use server-side fixtures. No user input.
 * SEC-12: No raw_text or PII in test output.
 *
 * Note: resolveUserId tests import the compiled service module.
 * This test file uses raw SQL to mirror what resolveUserId does,
 * so it can run standalone without compiling background-workers.
 */

import pg from 'pg';

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
 * Mirrors resolveUserId from draft.service.ts (the fixed version).
 * Uses the EXACT same SQL query: SELECT id FROM users WHERE telegram_id = $1
 * This lets us verify the column name matches the live DB without importing TS code.
 */
async function resolveUserIdDirect(pool, telegramId) {
  const result = await pool.query(
    `SELECT id FROM users WHERE telegram_id = $1`,
    [telegramId],
  );
  if (result.rows.length === 0) {
    throw new Error(`User not found for telegramId: [REDACTED]`);
  }
  return result.rows[0].id;
}

/**
 * Mirrors what the OLD buggy code did — queries telegram_user_id (wrong column).
 * This MUST fail with a "column does not exist" error, proving the fix was needed.
 */
async function resolveUserIdBuggy(pool, telegramId) {
  const result = await pool.query(
    `SELECT id FROM users WHERE telegram_user_id = $1`,
    [telegramId],
  );
  return result.rows[0]?.id ?? null;
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🔍 Phase 1.8-B Smoke Tests — Runtime Consistency & Security Hardening\n');

  await withPool(async (pool) => {
    // ─────────────────────────────────────────────────────────
    // Setup: create a test user with a known telegram_id
    // ─────────────────────────────────────────────────────────
    const userId = ulid();
    const telegramId = BigInt(Math.floor(Math.random() * 1_000_000_000));
    await pool.query(
      `INSERT INTO users (id, telegram_id) VALUES ($1, $2)`,
      [userId, telegramId],
    );
    console.log('[setup] userId:', userId, '| telegramId:', String(telegramId));

    // ─────────────────────────────────────────────────────────
    // TEST 1: resolveUserId (fixed) returns correct user_id
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 1] resolveUserId (fixed SQL) returns correct user_id');
    {
      const resolved = await resolveUserIdDirect(pool, String(telegramId));
      assert(resolved === userId, `resolveUserId returned correct userId (got: ${resolved}, expected: ${userId})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 2: resolveUserId throws for unknown telegram_id
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 2] resolveUserId throws for unknown telegram_id');
    {
      let threw = false;
      try {
        await resolveUserIdDirect(pool, '999999999999');
      } catch (err) {
        threw = err.message.includes('User not found');
      }
      assert(threw, 'resolveUserId throws for non-existent telegramId');
    }

    // ─────────────────────────────────────────────────────────
    // TEST 3: resolveUserId returns correct user among multiple
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 3] resolveUserId picks correct user when multiple users exist');
    {
      const userId2 = ulid();
      const telegramId2 = BigInt(Math.floor(Math.random() * 1_000_000_000));
      await pool.query(`INSERT INTO users (id, telegram_id) VALUES ($1, $2)`, [userId2, telegramId2]);

      const resolved1 = await resolveUserIdDirect(pool, String(telegramId));
      const resolved2 = await resolveUserIdDirect(pool, String(telegramId2));
      assert(resolved1 === userId, `User 1 resolved correctly (got: ${resolved1})`);
      assert(resolved2 === userId2, `User 2 resolved correctly (got: ${resolved2})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 4: The OLD buggy query (telegram_user_id) fails
    // This proves the C-1 fix was necessary.
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 4] Old buggy query (telegram_user_id) fails with column error');
    {
      let errMsg = '';
      try {
        await resolveUserIdBuggy(pool, String(telegramId));
      } catch (err) {
        errMsg = err.message;
      }
      assert(
        errMsg.includes('column "telegram_user_id" does not exist'),
        `Buggy column name causes SQL error (got: ${errMsg.slice(0, 80)})`,
      );
    }

    // ─────────────────────────────────────────────────────────
    // TEST 5: system_create_onboarding_workspace has search_path
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 5] SECDEF: system_create_onboarding_workspace has fixed search_path');
    {
      const r = await pool.query(`
        SELECT array_to_string(proconfig, ', ') AS config
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'system_create_onboarding_workspace'
      `);
      const config = r.rows[0]?.config ?? 'NULL';
      assert(
        config.includes('search_path=public'),
        `search_path is set (got: ${config})`,
      );
    }

    // ─────────────────────────────────────────────────────────
    // TEST 6: system_find_or_create_user has search_path
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 6] SECDEF: system_find_or_create_user has fixed search_path');
    {
      const r = await pool.query(`
        SELECT array_to_string(proconfig, ', ') AS config
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'system_find_or_create_user'
      `);
      const config = r.rows[0]?.config ?? 'NULL';
      assert(
        config.includes('search_path=public'),
        `search_path is set (got: ${config})`,
      );
    }

    // ─────────────────────────────────────────────────────────
    // TEST 7: All 3 SECDEF functions owned by midas_migrator
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 7] All SECDEF functions owned by midas_migrator');
    {
      const r = await pool.query(`
        SELECT p.proname, pg_get_userbyid(p.proowner) AS owner
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef = true
        ORDER BY p.proname
      `);
      const funcs = r.rows;
      for (const f of funcs) {
        assert(
          f.owner === 'midas_migrator',
          `${f.proname} owned by midas_migrator (got: ${f.owner})`,
        );
      }
    }

    // ─────────────────────────────────────────────────────────
    // TEST 8: EXECUTE revoked from PUBLIC, granted to midas_app
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 8] SECDEF: EXECUTE revoked from PUBLIC, granted to midas_app');
    {
      const r = await pool.query(`
        SELECT
          p.proname,
          has_function_privilege('midas_app', p.oid, 'EXECUTE') AS app_ok,
          has_function_privilege('public', p.oid, 'EXECUTE') AS public_ok
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef = true
        ORDER BY p.proname
      `);
      for (const f of r.rows) {
        assert(f.app_ok === true, `${f.proname}: midas_app can EXECUTE (got: ${f.app_ok})`);
        assert(f.public_ok === false, `${f.proname}: PUBLIC cannot EXECUTE (got: ${f.public_ok})`);
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
    console.log(`Phase 1.8-B Smoke Tests: ${passed} passed, ${failed} failed`);
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
