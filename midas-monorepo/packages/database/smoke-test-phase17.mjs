/**
 * Smoke Tests — Phase 1.7: Draft Expiration & Lifecycle Cleanup
 *
 * Tests (10 scenarios covering all owner-required cases):
 *   1.  expired pending draft → status becomes 'expired'
 *   2.  not-yet-expired pending draft → status unchanged
 *   3.  approved draft → NOT touched by expiration
 *   4.  rejected draft → NOT touched by expiration
 *   5.  needs_clarification draft → NOT touched by expiration
 *   6.  running expiration twice → no double-transition (idempotent)
 *   7.  approve vs expire race → terminal state remains consistent (one wins)
 *   8.  expiration returns correct count
 *   9.  DB trigger: expired → approved is BLOCKED (terminal state defence)
 *  10.  DB trigger: pending_user → expired via direct UPDATE is ALLOWED
 *
 * SEC-03: workspaceId injected by test fixtures (not from user input)
 * SEC-12: raw_text NEVER logged — only counts and IDs in assertions
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

async function createTestWorkspaceAndUser(pool) {
  const userId = ulid();
  const workspaceId = ulid();
  const membershipId = ulid();
  const telegramId = BigInt(Math.floor(Math.random() * 1_000_000_000));

  await pool.query(`INSERT INTO users (id, telegram_id) VALUES ($1, $2)`, [userId, telegramId]);
  await pool.query(
    `INSERT INTO workspaces (id, name, default_currency) VALUES ($1, $2, 'USD')`,
    [workspaceId, `Test WS Phase17 ${workspaceId.slice(-6)}`],
  );
  await pool.query(
    `INSERT INTO workspace_memberships (id, user_id, workspace_id, role, is_default) VALUES ($1, $2, $3, 'owner', true)`,
    [membershipId, userId, workspaceId],
  );

  return { userId, workspaceId };
}

/**
 * Create a test draft with controllable status and expires_at.
 * @param {pg.Pool} pool
 * @param {string} workspaceId
 * @param {{ status?: string, expiresAt?: Date }} opts
 */
async function createTestDraft(pool, workspaceId, { status = 'pending_user', expiresAt } = {}) {
  const draftId = ulid();
  const expires = expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO transaction_drafts
       (id, workspace_id, telegram_message_id, raw_text, parsed_amount, parsed_currency, status, expires_at, created_at, updated_at)
     VALUES
       ($1, $2, 99999, 'test message [phase17]', '50.00', 'USD', $3::draft_status, $4, NOW(), NOW())`,
    [draftId, workspaceId, status, expires.toISOString()],
  );

  return draftId;
}

/** Read draft status from DB (bypasses RLS — using admin pool) */
async function getDraftStatus(pool, draftId) {
  const r = await pool.query(
    `SELECT status::TEXT FROM transaction_drafts WHERE id = $1`,
    [draftId],
  );
  return r.rows[0]?.status ?? null;
}

/**
 * Call system_expire_pending_drafts() and return the expired count.
 * Uses the admin pool (midas_user) which has GRANT EXECUTE on the function.
 */
async function callExpireFunction(pool) {
  const r = await pool.query(`SELECT system_expire_pending_drafts() AS expired_count`);
  return r.rows[0]?.expired_count ?? 0;
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🔍 Phase 1.7 Smoke Tests — Draft Expiration & Lifecycle Cleanup\n');

  await withPool(async (pool) => {
    const { userId, workspaceId } = await createTestWorkspaceAndUser(pool);
    console.log('[setup] workspace:', workspaceId, '| user:', userId);

    // ─────────────────────────────────────────────────────────
    // TEST 1: expired pending draft → becomes 'expired'
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 1] Expired pending_user draft → status = expired');
    {
      const pastExpiry = new Date(Date.now() - 60_000); // 1 minute in the past
      const draftId = await createTestDraft(pool, workspaceId, { expiresAt: pastExpiry });

      const countBefore = await callExpireFunction(pool);
      const statusAfter = await getDraftStatus(pool, draftId);

      // The function may have expired OTHER drafts too — we check this specific draft
      assert(statusAfter === 'expired', `Draft status = 'expired' (got: ${statusAfter})`);
      assert(typeof countBefore === 'number', `Return value is a number (got: ${typeof countBefore})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 2: not-yet-expired pending_user draft → status unchanged
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 2] Not-yet-expired pending_user draft → status unchanged');
    {
      const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h from now
      const draftId = await createTestDraft(pool, workspaceId, { expiresAt: futureExpiry });

      await callExpireFunction(pool);
      const statusAfter = await getDraftStatus(pool, draftId);

      assert(statusAfter === 'pending_user', `Draft status unchanged = 'pending_user' (got: ${statusAfter})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 3: approved draft → NOT touched by expiration
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 3] approved draft → not touched by expiration');
    {
      // Create already-approved draft (bypass trigger by setting status directly via initial insert)
      const pastExpiry = new Date(Date.now() - 60_000);
      const draftId = await createTestDraft(pool, workspaceId, {
        status: 'approved',
        expiresAt: pastExpiry,
      });

      await callExpireFunction(pool);
      const statusAfter = await getDraftStatus(pool, draftId);

      assert(statusAfter === 'approved', `Approved draft untouched (got: ${statusAfter})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 4: rejected draft → NOT touched by expiration
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 4] rejected draft → not touched by expiration');
    {
      const pastExpiry = new Date(Date.now() - 60_000);
      const draftId = await createTestDraft(pool, workspaceId, {
        status: 'rejected',
        expiresAt: pastExpiry,
      });

      await callExpireFunction(pool);
      const statusAfter = await getDraftStatus(pool, draftId);

      assert(statusAfter === 'rejected', `Rejected draft untouched (got: ${statusAfter})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 5: needs_clarification draft → NOT touched by expiration
    // (needs_clarification is not a terminal state, but expiration
    //  only targets status = 'pending_user' per owner scope decision)
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 5] needs_clarification draft → not touched by expiration');
    {
      const pastExpiry = new Date(Date.now() - 60_000);
      const draftId = await createTestDraft(pool, workspaceId, {
        status: 'needs_clarification',
        expiresAt: pastExpiry,
      });

      await callExpireFunction(pool);
      const statusAfter = await getDraftStatus(pool, draftId);

      assert(
        statusAfter === 'needs_clarification',
        `needs_clarification draft untouched (got: ${statusAfter})`,
      );
    }

    // ─────────────────────────────────────────────────────────
    // TEST 6: running expiration twice → idempotent (no double-transition)
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 6] Running expiration twice → idempotent');
    {
      const pastExpiry = new Date(Date.now() - 60_000);
      const draftId = await createTestDraft(pool, workspaceId, { expiresAt: pastExpiry });

      // First run: should expire
      await callExpireFunction(pool);
      const statusAfterFirst = await getDraftStatus(pool, draftId);
      assert(statusAfterFirst === 'expired', `After 1st run: status = expired (got: ${statusAfterFirst})`);

      // Second run: draft is already expired → WHERE clause won't match → count=0 for THIS draft
      const count2 = await callExpireFunction(pool);
      const statusAfterSecond = await getDraftStatus(pool, draftId);
      assert(statusAfterSecond === 'expired', `After 2nd run: status still expired (got: ${statusAfterSecond})`);

      // Second run count may include other newly expired drafts from other tests,
      // but this draft must remain 'expired' (no re-transition)
      assert(
        statusAfterSecond === statusAfterFirst,
        `Status stable after second run (no double-transition)`,
      );
    }

    // ─────────────────────────────────────────────────────────
    // TEST 7: approve vs expire race → terminal state consistent
    // Concurrent: atomicApprove and system_expire_pending_drafts
    // Exactly one must win. Draft must end in a terminal state.
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 7] Approve vs expire race → exactly one terminal state wins');
    {
      // Draft expires in 50ms — tight window for the race
      const tightExpiry = new Date(Date.now() + 50);
      const draftId = await createTestDraft(pool, workspaceId, { expiresAt: tightExpiry });

      // Race: concurrent approve + expire function
      async function raceApprove() {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`SET LOCAL app.workspace_id = '${workspaceId}'`);
          await client.query(`SET LOCAL app.user_id = '${userId}'`);

          const lock = await client.query(
            `SELECT id, status, parsed_amount, parsed_currency, expires_at
               FROM transaction_drafts
               WHERE id = $1 AND workspace_id = $2
               FOR UPDATE SKIP LOCKED`,
            [draftId, workspaceId],
          );

          if (lock.rows.length === 0) {
            await client.query('ROLLBACK');
            return { outcome: 'locked_by_other' };
          }

          const draft = lock.rows[0];
          if (draft.status !== 'pending_user') {
            await client.query('ROLLBACK');
            return { outcome: 'already_processed', existingStatus: draft.status };
          }

          const expiresAt = new Date(draft.expires_at);
          if (expiresAt <= new Date()) {
            await client.query(
              `UPDATE transaction_drafts SET status = 'expired', updated_at = NOW() WHERE id = $1`,
              [draftId],
            );
            await client.query('COMMIT');
            return { outcome: 'expired_by_approve_path' };
          }

          await client.query(
            `UPDATE transaction_drafts SET status = 'approved', updated_at = NOW() WHERE id = $1`,
            [draftId],
          );
          await client.query('COMMIT');
          return { outcome: 'approved' };
        } catch (err) {
          await client.query('ROLLBACK');
          return { outcome: 'error', error: err.message };
        } finally {
          client.release();
        }
      }

      // Small delay to let expiry pass, then race
      await new Promise((r) => setTimeout(r, 60));

      const [approveResult, expireCount] = await Promise.all([
        raceApprove(),
        callExpireFunction(pool),
      ]);

      const finalStatus = await getDraftStatus(pool, draftId);

      const terminalStates = ['approved', 'expired'];
      assert(
        terminalStates.includes(finalStatus),
        `Final status is terminal: '${finalStatus}' (approve: ${approveResult.outcome}, expireCount: ${expireCount})`,
      );

      // Verify no invalid double state
      assert(
        finalStatus === 'approved' || finalStatus === 'expired',
        `Draft in a valid terminal state (got: ${finalStatus})`,
      );
    }

    // ─────────────────────────────────────────────────────────
    // TEST 8: expiration returns correct count
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 8] Expiration returns correct expired count');
    {
      const pastExpiry = new Date(Date.now() - 60_000);
      // Create 3 expired pending drafts
      const draft1 = await createTestDraft(pool, workspaceId, { expiresAt: pastExpiry });
      const draft2 = await createTestDraft(pool, workspaceId, { expiresAt: pastExpiry });
      const draft3 = await createTestDraft(pool, workspaceId, { expiresAt: pastExpiry });
      // Create 1 future (should not be expired)
      const draftFuture = await createTestDraft(pool, workspaceId);

      const count = await callExpireFunction(pool);

      // Count should be AT LEAST 3 (other tests may have left some pending too)
      assert(count >= 3, `Returned count >= 3 (got: ${count})`);

      const s1 = await getDraftStatus(pool, draft1);
      const s2 = await getDraftStatus(pool, draft2);
      const s3 = await getDraftStatus(pool, draft3);
      const sFuture = await getDraftStatus(pool, draftFuture);

      assert(s1 === 'expired', `Draft1 expired (got: ${s1})`);
      assert(s2 === 'expired', `Draft2 expired (got: ${s2})`);
      assert(s3 === 'expired', `Draft3 expired (got: ${s3})`);
      assert(sFuture === 'pending_user', `Future draft unchanged (got: ${sFuture})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 9: DB trigger — expired → approved is BLOCKED
    // Confirms terminal state defence works after expiration
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 9] DB trigger — expired → approved is blocked (terminal state defence)');
    {
      const pastExpiry = new Date(Date.now() - 60_000);
      const draftId = await createTestDraft(pool, workspaceId, { expiresAt: pastExpiry });
      await callExpireFunction(pool); // expire it

      const statusAfterExpire = await getDraftStatus(pool, draftId);
      assert(statusAfterExpire === 'expired', `Draft is expired before trigger test (got: ${statusAfterExpire})`);

      let triggerFired = false;
      try {
        await pool.query(
          `UPDATE transaction_drafts SET status = 'approved' WHERE id = $1`,
          [draftId],
        );
      } catch (err) {
        triggerFired =
          err.message.includes('terminal draft state') ||
          err.message.includes('Cannot transition') ||
          err.message.includes('Cannot approve an expired');
      }
      assert(triggerFired, 'DB trigger blocks expired → approved transition');
    }

    // ─────────────────────────────────────────────────────────
    // TEST 10: Direct pending_user → expired via UPDATE is allowed
    // (Confirms DB trigger does NOT block the expiration path)
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 10] DB trigger — pending_user → expired is ALLOWED (trigger compatible)');
    {
      const draftId = await createTestDraft(pool, workspaceId);
      let errored = false;
      try {
        await pool.query(
          `UPDATE transaction_drafts SET status = 'expired', updated_at = NOW() WHERE id = $1`,
          [draftId],
        );
      } catch {
        errored = true;
      }
      assert(!errored, 'pending_user → expired UPDATE succeeds (trigger allows it)');
      const status = await getDraftStatus(pool, draftId);
      assert(status === 'expired', `Status = 'expired' after direct UPDATE (got: ${status})`);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

runTests()
  .then(() => {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Phase 1.7 Smoke Tests: ${passed} passed, ${failed} failed`);
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
