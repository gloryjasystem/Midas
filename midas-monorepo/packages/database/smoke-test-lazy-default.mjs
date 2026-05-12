/**
 * Smoke Tests — Phase LD: Lazy Default Account Onboarding
 *
 * Tests:
 *   1. Migration: is_onboarding_placeholder column exists with correct defaults
 *   2. system_find_or_create_user: new user gets Default with is_onboarding_placeholder = TRUE
 *   3. system_find_or_create_user: existing user is idempotent (no duplicate accounts)
 *   4. Scenario A (custom account): softDeletePlaceholderAccount → placeholder deleted, custom visible
 *   5. Scenario A idempotent: calling softDeletePlaceholderAccount twice is safe (returns 'none')
 *   6. Scenario B (skip): activatePlaceholderAccount → placeholder promoted, shows in balance
 *   7. Scenario B idempotent: calling activatePlaceholderAccount twice is safe (returns 'none')
 *   8. resolveDefaultAccount fallback ignores deleted placeholder (AND deleted_at IS NULL)
 *   9. /balance isolation A: only custom account visible after soft-delete of placeholder
 *  10. /balance isolation B: only activated Default visible after skip
 *  11. Existing users (is_onboarding_placeholder=FALSE): softDelete and activate both return 'none'
 *  12. Partial index exists on account_sources
 *
 * Run: DATABASE_URL=<public-url> node smoke-test-lazy-default.mjs
 */

import pg from 'pg';
const { Pool } = pg;

// ─── Utilities ───────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) { console.error(`  ✗ FAIL: ${message}`); failed++; }
  else             { console.log(`  ✓ PASS: ${message}`); passed++; }
}

function ulid() {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let r = '';
  for (let i = 0; i < 26; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:PLLSqArtPUoQsAYmvrpsmavfQMewgTRh@hopper.proxy.rlwy.net:46284/railway';
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

// ─── Helpers ──────────────────────────────────────────────────

/** Create a raw workspace+user without system_find_or_create_user (for isolation tests). */
async function createBareWorkspace(name = 'TestWS') {
  const userId      = ulid();
  const workspaceId = ulid();
  const membershipId = ulid();
  const tgId = BigInt(Math.floor(Math.random() * 1_000_000_000_000));

  await pool.query(`INSERT INTO users (id, telegram_id) VALUES ($1,$2)`, [userId, tgId]);
  await pool.query(`INSERT INTO workspaces (id, name, default_currency) VALUES ($1,$2,'USDT')`, [workspaceId, `${name}-${workspaceId.slice(-4)}`]);
  await pool.query(`INSERT INTO workspace_memberships (id,user_id,workspace_id,role,is_default) VALUES ($1,$2,$3,'owner',true)`, [membershipId, userId, workspaceId]);
  return { userId, workspaceId };
}

/** Insert placeholder account (mirrors what system_find_or_create_user now does). */
async function insertPlaceholder(workspaceId, currency = 'USDT') {
  const id = ulid();
  await pool.query(
    `INSERT INTO account_sources (id,workspace_id,name,type,currency,is_onboarding_placeholder)
     VALUES ($1,$2,'Default','manual'::account_source_type,$3,TRUE)`,
    [id, workspaceId, currency]
  );
  return id;
}

/** Insert a real (non-placeholder) account. */
async function insertRealAccount(workspaceId, name, currency = 'USDT') {
  const id = ulid();
  await pool.query(
    `INSERT INTO account_sources (id,workspace_id,name,type,currency,is_onboarding_placeholder)
     VALUES ($1,$2,$3,'manual'::account_source_type,$4,FALSE)`,
    [id, workspaceId, name, currency]
  );
  return id;
}

/** Soft-delete all placeholders (mirrors softDeletePlaceholderAccount). */
async function softDeletePlaceholder(workspaceId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.workspace_id = '${workspaceId}'`);
    await client.query(`SET LOCAL app.user_id = '${userId}'`);
    const r = await client.query(
      `UPDATE account_sources SET deleted_at=NOW(),updated_at=NOW()
       WHERE workspace_id=$1 AND is_onboarding_placeholder=TRUE AND deleted_at IS NULL
       RETURNING id`,
      [workspaceId]
    );
    await client.query('COMMIT');
    return r.rowCount > 0 ? 'deleted' : 'none';
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

/** Activate placeholder (mirrors activatePlaceholderAccount). */
async function activatePlaceholder(workspaceId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.workspace_id = '${workspaceId}'`);
    await client.query(`SET LOCAL app.user_id = '${userId}'`);
    const r = await client.query(
      `UPDATE account_sources SET is_onboarding_placeholder=FALSE,updated_at=NOW()
       WHERE workspace_id=$1 AND is_onboarding_placeholder=TRUE AND deleted_at IS NULL
       RETURNING id`,
      [workspaceId]
    );
    await client.query('COMMIT');
    return r.rowCount > 0 ? 'activated' : 'none';
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

/** Get all account_sources for workspace (incl deleted, for assertions). */
async function getAccounts(workspaceId) {
  const r = await pool.query(
    `SELECT id,name,currency,is_onboarding_placeholder,deleted_at IS NOT NULL AS is_deleted
     FROM account_sources WHERE workspace_id=$1 ORDER BY created_at`,
    [workspaceId]
  );
  return r.rows;
}

/** Get visible accounts (deleted_at IS NULL) — what /balance and /accounts show. */
async function getVisibleAccounts(workspaceId) {
  const r = await pool.query(
    `SELECT id,name,currency,is_onboarding_placeholder
     FROM account_sources WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY created_at`,
    [workspaceId]
  );
  return r.rows;
}

/** Simulate resolveDefaultAccount LIMIT 1 fallback (with AND deleted_at IS NULL). */
async function resolveDefaultAccountFallback(workspaceId) {
  const r = await pool.query(
    `SELECT id FROM account_sources WHERE workspace_id=$1 AND deleted_at IS NULL LIMIT 1`,
    [workspaceId]
  );
  return r.rows[0]?.id ?? null;
}

// ─── Tests ────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🔍 Phase LD Smoke Tests — Lazy Default Account Onboarding\n');

  // ─── TEST 1: Column exists with correct definition ────────
  console.log('[TEST 1] is_onboarding_placeholder column exists');
  {
    const r = await pool.query(
      `SELECT column_name, data_type, column_default, is_nullable
       FROM information_schema.columns
       WHERE table_name='account_sources' AND column_name='is_onboarding_placeholder'`
    );
    assert(r.rows.length === 1, 'Column is_onboarding_placeholder exists');
    assert(r.rows[0]?.data_type === 'boolean', `Type is boolean (got: ${r.rows[0]?.data_type})`);
    assert(r.rows[0]?.column_default === 'false', `Default is false (got: ${r.rows[0]?.column_default})`);
    assert(r.rows[0]?.is_nullable === 'NO', 'Column is NOT NULL');
  }

  // ─── TEST 2: Partial index exists ────────────────────────
  console.log('\n[TEST 2] Partial index exists on account_sources');
  {
    const r = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename='account_sources' AND indexname='idx_account_sources_onboarding_placeholder'`
    );
    assert(r.rows.length === 1, 'Partial index idx_account_sources_onboarding_placeholder exists');
  }

  // ─── TEST 3: system_find_or_create_user marks Default as placeholder ──
  console.log('\n[TEST 3] system_find_or_create_user: new user Default is placeholder');
  {
    const tgId = BigInt(Math.floor(Math.random() * 1_000_000_000_000));
    const r = await pool.query(
      `SELECT * FROM system_find_or_create_user($1,$2,$3,$4,$5,$6,$7)`,
      [tgId, ulid(), ulid(), ulid(), 'TestWS-LD', ulid(), ulid()]
    );
    const { workspace_id, is_new_user } = r.rows[0];
    assert(is_new_user === true, 'is_new_user = true for fresh user');

    const accts = await pool.query(
      `SELECT name, is_onboarding_placeholder, deleted_at
       FROM account_sources WHERE workspace_id=$1`, [workspace_id]
    );
    assert(accts.rows.length === 1, 'Exactly 1 account seeded');
    assert(accts.rows[0].name === 'Default', `Account name is 'Default' (got: ${accts.rows[0].name})`);
    assert(accts.rows[0].is_onboarding_placeholder === true, 'Default account is_onboarding_placeholder=TRUE');
    assert(accts.rows[0].deleted_at === null, 'Default account not deleted at creation');

    // Cleanup
    await pool.query(`DELETE FROM account_sources WHERE workspace_id=$1`, [workspace_id]);
    await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id=$1`, [workspace_id]);
    await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspace_id]);
  }

  // ─── TEST 4: system_find_or_create_user idempotent ───────
  console.log('\n[TEST 4] system_find_or_create_user: existing user is idempotent');
  {
    const tgId = BigInt(Math.floor(Math.random() * 1_000_000_000_000));
    const params = [tgId, ulid(), ulid(), ulid(), 'TestWS-Idem', ulid(), ulid()];
    await pool.query(`SELECT * FROM system_find_or_create_user($1,$2,$3,$4,$5,$6,$7)`, params);
    const r2 = await pool.query(`SELECT * FROM system_find_or_create_user($1,$2,$3,$4,$5,$6,$7)`, params);
    assert(r2.rows[0].is_new_user === false, 'Second call: is_new_user = false');

    const wsId = r2.rows[0].workspace_id;
    const accts = await pool.query(`SELECT COUNT(*)::INT AS cnt FROM account_sources WHERE workspace_id=$1`, [wsId]);
    assert(accts.rows[0].cnt === 1, `Still exactly 1 account after 2 calls (got: ${accts.rows[0].cnt})`);

    // Cleanup
    await pool.query(`DELETE FROM account_sources WHERE workspace_id=$1`, [wsId]);
    await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id=$1`, [wsId]);
    await pool.query(`DELETE FROM workspaces WHERE id=$1`, [wsId]);
  }

  // ─── TEST 5: Scenario A — custom account: placeholder soft-deleted ──
  console.log('\n[TEST 5] Scenario A: custom account creation → placeholder soft-deleted');
  {
    const { userId, workspaceId } = await createBareWorkspace('ScenA');
    const placeholderId = await insertPlaceholder(workspaceId);
    const customId = await insertRealAccount(workspaceId, 'Тинькофф', 'RUB');

    const result = await softDeletePlaceholder(workspaceId, userId);
    assert(result === 'deleted', `softDeletePlaceholderAccount returns 'deleted' (got: ${result})`);

    const visible = await getVisibleAccounts(workspaceId);
    assert(visible.length === 1, `Exactly 1 visible account (got: ${visible.length})`);
    assert(visible[0].id === customId, 'Visible account is the custom one');
    assert(visible[0].name === 'Тинькофф', `Custom account name correct (got: ${visible[0].name})`);

    const all = await getAccounts(workspaceId);
    const ph = all.find(a => a.id === placeholderId);
    assert(ph?.is_deleted === true, 'Placeholder is soft-deleted');

    // Cleanup
    await pool.query(`DELETE FROM account_sources WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [userId]);
  }

  // ─── TEST 6: Scenario A idempotent ───────────────────────
  console.log('\n[TEST 6] Scenario A idempotent: second softDelete returns "none"');
  {
    const { userId, workspaceId } = await createBareWorkspace('ScenA-Idem');
    await insertPlaceholder(workspaceId);
    await insertRealAccount(workspaceId, 'Sberbank', 'RUB');

    await softDeletePlaceholder(workspaceId, userId);
    const result2 = await softDeletePlaceholder(workspaceId, userId);
    assert(result2 === 'none', `Second softDelete returns 'none' (got: ${result2})`);

    const visible = await getVisibleAccounts(workspaceId);
    assert(visible.length === 1, `Still exactly 1 visible account after double-call (got: ${visible.length})`);

    // Cleanup
    await pool.query(`DELETE FROM account_sources WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [userId]);
  }

  // ─── TEST 7: Scenario B — skip: placeholder activated ────
  console.log('\n[TEST 7] Scenario B: user skips → placeholder activated (is_onboarding_placeholder=FALSE)');
  {
    const { userId, workspaceId } = await createBareWorkspace('ScenB');
    const placeholderId = await insertPlaceholder(workspaceId);

    const result = await activatePlaceholder(workspaceId, userId);
    assert(result === 'activated', `activatePlaceholderAccount returns 'activated' (got: ${result})`);

    const visible = await getVisibleAccounts(workspaceId);
    assert(visible.length === 1, `Exactly 1 visible account (got: ${visible.length})`);
    assert(visible[0].id === placeholderId, 'Visible account is the former placeholder');
    assert(visible[0].is_onboarding_placeholder === false, 'is_onboarding_placeholder is now FALSE');
    assert(visible[0].name === 'Default', `Account name is 'Default' (got: ${visible[0].name})`);

    // Cleanup
    await pool.query(`DELETE FROM account_sources WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [userId]);
  }

  // ─── TEST 8: Scenario B idempotent ───────────────────────
  console.log('\n[TEST 8] Scenario B idempotent: second activatePlaceholder returns "none"');
  {
    const { userId, workspaceId } = await createBareWorkspace('ScenB-Idem');
    await insertPlaceholder(workspaceId);

    await activatePlaceholder(workspaceId, userId);
    const result2 = await activatePlaceholder(workspaceId, userId);
    assert(result2 === 'none', `Second activate returns 'none' (got: ${result2})`);

    const visible = await getVisibleAccounts(workspaceId);
    assert(visible.length === 1, `Still exactly 1 visible account (got: ${visible.length})`);

    // Cleanup
    await pool.query(`DELETE FROM account_sources WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [userId]);
  }

  // ─── TEST 9: resolveDefaultAccount fallback skips deleted placeholder ──
  console.log('\n[TEST 9] resolveDefaultAccount fallback: deleted placeholder is NOT selected');
  {
    const { userId, workspaceId } = await createBareWorkspace('FallbackTest');
    const placeholderId = await insertPlaceholder(workspaceId);

    // Soft-delete the placeholder (Scenario A)
    await softDeletePlaceholder(workspaceId, userId);

    // Fallback with AND deleted_at IS NULL should return NULL (no active accounts)
    const fallback = await resolveDefaultAccountFallback(workspaceId);
    assert(fallback === null, `Fallback returns null when only account is soft-deleted (got: ${fallback})`);

    // Now add a real account — fallback should return it
    const realId = await insertRealAccount(workspaceId, 'Binance', 'USDT');
    const fallback2 = await resolveDefaultAccountFallback(workspaceId);
    assert(fallback2 === realId, `Fallback returns real account when available (got: ${fallback2})`);

    // Cleanup
    await pool.query(`DELETE FROM account_sources WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [userId]);
  }

  // ─── TEST 10: Balance isolation — Scenario A ─────────────
  console.log('\n[TEST 10] Balance isolation Scenario A: /balance shows ONLY custom account');
  {
    const { userId, workspaceId } = await createBareWorkspace('BalA');
    await insertPlaceholder(workspaceId); // seeded at registration
    const customId = await insertRealAccount(workspaceId, 'Raiffeisen', 'EUR');

    await softDeletePlaceholder(workspaceId, userId); // user created custom → soft-delete placeholder

    const r = await pool.query(
      `SELECT a.id, a.name, a.currency
       FROM account_sources a
       WHERE a.workspace_id=$1 AND a.deleted_at IS NULL
       ORDER BY a.created_at`,
      [workspaceId]
    );
    assert(r.rows.length === 1, `balance query returns 1 account (got: ${r.rows.length})`);
    assert(r.rows[0].id === customId, 'Balance account is the custom account (Raiffeisen)');
    assert(r.rows[0].name === 'Raiffeisen', `Account name is Raiffeisen (got: ${r.rows[0].name})`);

    // Cleanup
    await pool.query(`DELETE FROM account_sources WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [userId]);
  }

  // ─── TEST 11: Balance isolation — Scenario B ─────────────
  console.log('\n[TEST 11] Balance isolation Scenario B: /balance shows ONLY activated Default');
  {
    const { userId, workspaceId } = await createBareWorkspace('BalB');
    const defaultId = await insertPlaceholder(workspaceId);

    await activatePlaceholder(workspaceId, userId); // user skipped → activate Default

    const r = await pool.query(
      `SELECT a.id, a.name, a.currency, a.is_onboarding_placeholder
       FROM account_sources a
       WHERE a.workspace_id=$1 AND a.deleted_at IS NULL
       ORDER BY a.created_at`,
      [workspaceId]
    );
    assert(r.rows.length === 1, `balance query returns 1 account (got: ${r.rows.length})`);
    assert(r.rows[0].id === defaultId, 'Balance account is the former placeholder');
    assert(r.rows[0].name === 'Default', `Account name is Default (got: ${r.rows[0].name})`);
    assert(r.rows[0].is_onboarding_placeholder === false, 'is_onboarding_placeholder is FALSE');

    // Cleanup
    await pool.query(`DELETE FROM account_sources WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [userId]);
  }

  // ─── TEST 12: Existing users unaffected ──────────────────
  console.log('\n[TEST 12] Existing users (is_onboarding_placeholder=FALSE) unaffected by both ops');
  {
    const { userId, workspaceId } = await createBareWorkspace('ExistingUser');
    // Simulate existing user who already had Default activated before Phase LD
    await insertRealAccount(workspaceId, 'Default', 'USDT'); // is_onboarding_placeholder=FALSE

    const r1 = await softDeletePlaceholder(workspaceId, userId);
    assert(r1 === 'none', `softDelete on existing user returns 'none' (got: ${r1})`);

    const r2 = await activatePlaceholder(workspaceId, userId);
    assert(r2 === 'none', `activate on existing user returns 'none' (got: ${r2})`);

    const visible = await getVisibleAccounts(workspaceId);
    assert(visible.length === 1, `Existing user still has 1 visible account (got: ${visible.length})`);
    assert(visible[0].name === 'Default', 'Account name unchanged');

    // Cleanup
    await pool.query(`DELETE FROM account_sources WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspaceId]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [userId]);
  }
}

// ─── Main ─────────────────────────────────────────────────────

runTests()
  .then(() => {
    console.log(`\n${'─'.repeat(55)}`);
    console.log(`Phase LD Smoke Tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) { console.error('\n❌ SMOKE TEST FAILED'); process.exit(1); }
    else            { console.log('\n✅ ALL SMOKE TESTS PASSED'); process.exit(0); }
  })
  .catch((err) => {
    console.error('\n💥 Smoke test runner crashed:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
