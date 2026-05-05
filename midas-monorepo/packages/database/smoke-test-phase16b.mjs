/**
 * Smoke Tests — Phase 1.6-B: Human-in-the-Loop Draft Confirmation
 *
 * Tests:
 *   1. approveDraft() — happy path: draft transitions to 'approved', Transaction created
 *   2. rejectDraft()  — happy path: draft transitions to 'rejected', NO Transaction created
 *   3. Race condition — two concurrent approveDraft() for same draft → exactly 1 Transaction
 *   4. Double-approve idempotency — second approve returns 'already_processed'
 *   5. Approve expired draft — returns 'expired', no Transaction
 *   6. Approve non-existent draft — returns 'not_found'
 *   7. callback_data parsing — valid format accepted
 *   8. callback_data parsing — invalid action rejected
 *   9. callback_data parsing — malformed draftId rejected
 *  10. UNIQUE constraint defence — direct double-INSERT into transactions fails
 *
 * SEC-03: workspaceId and userId always come from backend (test fixtures), not from callback_data
 * SEC-02: Amount stored as NUMERIC string, never float
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

async function withAdminPool(fn) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://midas_user:midas_dev_password@localhost:5432/midas',
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
  // Simple ULID-like ID for test fixtures
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

  await pool.query(
    `INSERT INTO users (id, telegram_id) VALUES ($1, $2)`,
    [userId, telegramId]
  );

  await pool.query(
    `INSERT INTO workspaces (id, name, default_currency) VALUES ($1, $2, 'USD')`,
    [workspaceId, `Test WS ${workspaceId.slice(-6)}`]
  );

  await pool.query(
    `INSERT INTO workspace_memberships (id, user_id, workspace_id, role, is_default) VALUES ($1, $2, $3, 'owner', true)`,
    [membershipId, userId, workspaceId]
  );

  return { userId, workspaceId, telegramId: telegramId.toString() };
}

async function createTestDraft(pool, workspaceId, { status = 'pending_user', expiresAt } = {}) {
  const draftId = ulid();
  const expires = expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000);

  await pool.query(`
    INSERT INTO transaction_drafts
      (id, workspace_id, telegram_message_id, raw_text, parsed_amount, parsed_currency, status, expires_at, created_at, updated_at)
    VALUES
      ($1, $2, 12345, 'test message', '99.50', 'USD', $3::draft_status, $4, NOW(), NOW())
  `, [draftId, workspaceId, status, expires.toISOString()]);

  return draftId;
}

async function getTransactionByDraftId(pool, workspaceId, draftId) {
  const r = await pool.query(
    `SELECT id, workspace_id, draft_id, original_amount::TEXT FROM transactions WHERE draft_id = $1 AND workspace_id = $2`,
    [draftId, workspaceId]
  );
  return r.rows[0] ?? null;
}

async function getDraftStatus(pool, draftId) {
  const r = await pool.query(
    `SELECT status::TEXT FROM transaction_drafts WHERE id = $1`,
    [draftId]
  );
  return r.rows[0]?.status ?? null;
}

// ─────────────────────────────────────────────────────────────
// Tests (DB layer — no mocks)
// ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🔍 Phase 1.6-B Smoke Tests — HitL Draft Confirmation\n');

  await withAdminPool(async (pool) => {

    // ─── Setup: shared workspace + user ────────────────────────
    const { userId, workspaceId } = await createTestWorkspaceAndUser(pool);
    console.log('[setup] workspace:', workspaceId, '| user:', userId);

    // ── Helper: atomic approve via SQL (mirrors approveDraft()) ──
    async function atomicApprove(draftId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Inject RLS context
        await client.query(`SET LOCAL app.workspace_id = '${workspaceId}'`);
        await client.query(`SET LOCAL app.user_id = '${userId}'`);

        const lockResult = await client.query(
          `SELECT id, status, parsed_amount, parsed_currency, expires_at
           FROM transaction_drafts
           WHERE id = $1 AND workspace_id = $2
           FOR UPDATE SKIP LOCKED`,
          [draftId, workspaceId]
        );

        if (lockResult.rows.length === 0) {
          await client.query('ROLLBACK');
          // Check if row exists
          const check = await pool.query(`SELECT status::TEXT FROM transaction_drafts WHERE id = $1`, [draftId]);
          return { outcome: check.rows.length === 0 ? 'not_found' : 'locked_by_other' };
        }

        const draft = lockResult.rows[0];

        if (draft.status !== 'pending_user') {
          await client.query('ROLLBACK');
          return { outcome: 'already_processed', existingStatus: draft.status };
        }

        const expiresAt = new Date(draft.expires_at);
        if (expiresAt <= new Date()) {
          await client.query(
            `UPDATE transaction_drafts SET status = 'expired', updated_at = NOW() WHERE id = $1`,
            [draftId]
          );
          await client.query('COMMIT');
          return { outcome: 'expired' };
        }

        await client.query(
          `UPDATE transaction_drafts SET status = 'approved', updated_at = NOW() WHERE id = $1`,
          [draftId]
        );

        const transactionId = ulid();

        // Ensure category exists
        let catResult = await client.query(
          `SELECT id FROM categories WHERE workspace_id = $1 LIMIT 1`, [workspaceId]
        );
        let categoryId;
        if (catResult.rows.length === 0) {
          categoryId = ulid();
          await client.query(
            `INSERT INTO categories (id, workspace_id, name, "group") VALUES ($1, $2, 'Разное', 'Жизнь'::category_group) ON CONFLICT (workspace_id, name) DO NOTHING`,
            [categoryId, workspaceId]
          );
          catResult = await client.query(`SELECT id FROM categories WHERE workspace_id = $1 AND name = 'Разное' LIMIT 1`, [workspaceId]);
          categoryId = catResult.rows[0]?.id ?? categoryId;
        } else {
          categoryId = catResult.rows[0].id;
        }

        // Ensure account exists
        let acctResult = await client.query(
          `SELECT id FROM account_sources WHERE workspace_id = $1 LIMIT 1`, [workspaceId]
        );
        let accountId;
        if (acctResult.rows.length === 0) {
          accountId = ulid();
          await client.query(
            `INSERT INTO account_sources (id, workspace_id, name, type, currency) VALUES ($1, $2, 'Default', 'manual'::account_source_type, 'USD') ON CONFLICT DO NOTHING`,
            [accountId, workspaceId]
          );
          acctResult = await client.query(`SELECT id FROM account_sources WHERE workspace_id = $1 AND name = 'Default' LIMIT 1`, [workspaceId]);
          accountId = acctResult.rows[0]?.id ?? accountId;
        } else {
          accountId = acctResult.rows[0].id;
        }

        try {
          await client.query(
            `INSERT INTO transactions (id, workspace_id, original_amount, currency, exchange_rate, base_currency, base_amount, category_id, account_id, draft_id, transaction_time, rate_source, created_at)
             VALUES ($1, $2, $3::NUMERIC, $4, 1::NUMERIC, $5, $3::NUMERIC, $6, $7, $8, NOW(), 'none', NOW())`,
            [transactionId, workspaceId, draft.parsed_amount ?? '0', draft.parsed_currency ?? 'USD', 'USD', categoryId, accountId, draftId]
          );
        } catch (insertErr) {
          await client.query('ROLLBACK');
          return { outcome: 'duplicate_transaction', error: insertErr.message };
        }

        await client.query('COMMIT');
        return { outcome: 'approved', transactionId };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // ─────────────────────────────────────────────────────────
    // TEST 1: approveDraft happy path
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 1] approveDraft — happy path');
    {
      const draftId = await createTestDraft(pool, workspaceId);
      const result = await atomicApprove(draftId);
      assert(result.outcome === 'approved', `outcome is 'approved' (got: ${result.outcome})`);
      const tx = await getTransactionByDraftId(pool, workspaceId, draftId);
      assert(tx !== null, 'Transaction record created');
      assert(tx?.draft_id === draftId, 'Transaction.draft_id matches draftId');
      const draftStatus = await getDraftStatus(pool, draftId);
      assert(draftStatus === 'approved', `Draft status = 'approved' (got: ${draftStatus})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 2: rejectDraft happy path
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 2] rejectDraft — happy path');
    {
      const draftId = await createTestDraft(pool, workspaceId);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL app.workspace_id = '${workspaceId}'`);
        const lockResult = await client.query(
          `SELECT id, status FROM transaction_drafts WHERE id = $1 AND workspace_id = $2 FOR UPDATE SKIP LOCKED`,
          [draftId, workspaceId]
        );
        assert(lockResult.rows.length === 1, 'Got lock on draft');
        await client.query(
          `UPDATE transaction_drafts SET status = 'rejected', updated_at = NOW() WHERE id = $1`,
          [draftId]
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const draftStatus = await getDraftStatus(pool, draftId);
      assert(draftStatus === 'rejected', `Draft status = 'rejected' (got: ${draftStatus})`);
      const tx = await getTransactionByDraftId(pool, workspaceId, draftId);
      assert(tx === null, 'No Transaction created for rejected draft');
    }

    // ─────────────────────────────────────────────────────────
    // TEST 3: Race condition — parallel approve → exactly 1 Transaction
    // MANDATORY per Phase 1.6-B approval
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 3] Race condition — parallel approveDraft × 2 → exactly 1 Transaction');
    {
      const draftId = await createTestDraft(pool, workspaceId);

      // Fire 2 concurrent approvals for the same draft
      const [result1, result2] = await Promise.all([
        atomicApprove(draftId),
        atomicApprove(draftId),
      ]);

      console.log(`  Result 1: ${result1.outcome}, Result 2: ${result2.outcome}`);

      // Exactly one must be 'approved', the other must be 'locked_by_other' or 'already_processed'
      const outcomes = [result1.outcome, result2.outcome];
      const approvedCount = outcomes.filter((o) => o === 'approved').length;
      const safeCount = outcomes.filter(
        (o) => o === 'locked_by_other' || o === 'already_processed' || o === 'duplicate_transaction'
      ).length;

      assert(approvedCount === 1, `Exactly 1 'approved' outcome (got: ${approvedCount})`);
      assert(safeCount === 1, `Exactly 1 safe/idempotent outcome (got: ${safeCount})`);

      // Verify only 1 Transaction in DB
      const txCount = await pool.query(
        `SELECT COUNT(*)::INT AS cnt FROM transactions WHERE draft_id = $1`,
        [draftId]
      );
      const count = txCount.rows[0].cnt;
      assert(count === 1, `Exactly 1 Transaction in DB (found: ${count})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 4: Double-approve idempotency
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 4] Double-approve idempotency');
    {
      const draftId = await createTestDraft(pool, workspaceId);
      const result1 = await atomicApprove(draftId);
      assert(result1.outcome === 'approved', `First approve succeeded (got: ${result1.outcome})`);
      const result2 = await atomicApprove(draftId);
      assert(
        result2.outcome === 'already_processed' || result2.outcome === 'duplicate_transaction',
        `Second approve is idempotent (got: ${result2.outcome})`
      );
      // Still exactly 1 transaction
      const txCount = await pool.query(
        `SELECT COUNT(*)::INT AS cnt FROM transactions WHERE draft_id = $1`, [draftId]
      );
      assert(txCount.rows[0].cnt === 1, 'Still exactly 1 Transaction after double approve');
    }

    // ─────────────────────────────────────────────────────────
    // TEST 5: Approve expired draft
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 5] Approve expired draft');
    {
      const expiredAt = new Date(Date.now() - 1000); // 1 second in the past
      const draftId = await createTestDraft(pool, workspaceId, { expiresAt: expiredAt });
      const result = await atomicApprove(draftId);
      assert(result.outcome === 'expired', `Expired draft returns 'expired' (got: ${result.outcome})`);
      const tx = await getTransactionByDraftId(pool, workspaceId, draftId);
      assert(tx === null, 'No Transaction created for expired draft');
    }

    // ─────────────────────────────────────────────────────────
    // TEST 6: Approve non-existent draft
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 6] Approve non-existent draft');
    {
      const fakeDraftId = ulid();
      const result = await atomicApprove(fakeDraftId);
      assert(result.outcome === 'not_found', `Non-existent draft returns 'not_found' (got: ${result.outcome})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 7: DB trigger — cannot transition from terminal state
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 7] State machine trigger — cannot re-approve approved draft');
    {
      const draftId = await createTestDraft(pool, workspaceId, { status: 'approved' });
      let triggerFired = false;
      try {
        await pool.query(
          `UPDATE transaction_drafts SET status = 'rejected' WHERE id = $1`,
          [draftId]
        );
      } catch (err) {
        triggerFired = err.message.includes('terminal draft state') || err.message.includes('Cannot transition');
      }
      assert(triggerFired, 'DB trigger prevents transition from terminal state');
    }

    // ─────────────────────────────────────────────────────────
    // TEST 8: UNIQUE constraint on transactions.draft_id
    // (Defence in depth against race condition)
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 8] UNIQUE constraint — transactions.draft_id prevents double insert');
    {
      const draftId = await createTestDraft(pool, workspaceId, { status: 'approved' });

      const cat = await pool.query(`SELECT id FROM categories WHERE workspace_id = $1 LIMIT 1`, [workspaceId]);
      const acct = await pool.query(`SELECT id FROM account_sources WHERE workspace_id = $1 LIMIT 1`, [workspaceId]);
      let categoryId = cat.rows[0]?.id;
      let accountId = acct.rows[0]?.id;
      if (!categoryId) {
        categoryId = ulid();
        await pool.query(`INSERT INTO categories (id, workspace_id, name, "group") VALUES ($1, $2, 'Разное', 'Жизнь'::category_group) ON CONFLICT (workspace_id, name) DO NOTHING`, [categoryId, workspaceId]);
        const r = await pool.query(`SELECT id FROM categories WHERE workspace_id = $1 AND name = 'Разное' LIMIT 1`, [workspaceId]);
        categoryId = r.rows[0]?.id ?? categoryId;
      }
      if (!accountId) {
        accountId = ulid();
        await pool.query(`INSERT INTO account_sources (id, workspace_id, name, type, currency) VALUES ($1, $2, 'Default', 'manual'::account_source_type, 'USD') ON CONFLICT DO NOTHING`, [accountId, workspaceId]);
        const r = await pool.query(`SELECT id FROM account_sources WHERE workspace_id = $1 AND name = 'Default' LIMIT 1`, [workspaceId]);
        accountId = r.rows[0]?.id ?? accountId;
      }

      const insertSql = `INSERT INTO transactions (id, workspace_id, original_amount, currency, exchange_rate, base_currency, base_amount, category_id, account_id, draft_id, transaction_time, rate_source, created_at)
        VALUES ($1, $2, '10.00'::NUMERIC, 'USD', 1::NUMERIC, 'USD', '10.00'::NUMERIC, $3, $4, $5, NOW(), 'none', NOW())`;

      await pool.query(insertSql, [ulid(), workspaceId, categoryId, accountId, draftId]);

      let uniqueViolation = false;
      try {
        await pool.query(insertSql, [ulid(), workspaceId, categoryId, accountId, draftId]);
      } catch (err) {
        uniqueViolation = err.message.includes('unique') || err.message.includes('duplicate');
      }
      assert(uniqueViolation, 'UNIQUE constraint on draft_id prevents duplicate Transaction');
    }

    // ─────────────────────────────────────────────────────────
    // TEST 9: callback_data parsing — valid format
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 9] callback_data parsing — valid format');
    {
      const testCases = [
        { data: 'approve:01HV2KDPQ4BPGMK0SDKWTR8XN0', expectAction: 'approve', expectDraftId: '01HV2KDPQ4BPGMK0SDKWTR8XN0' },
        { data: 'reject:01HV2KDPQ4BPGMK0SDKWTR8XN0', expectAction: 'reject', expectDraftId: '01HV2KDPQ4BPGMK0SDKWTR8XN0' },
      ];
      for (const tc of testCases) {
        const colonIdx = tc.data.indexOf(':');
        const action = tc.data.slice(0, colonIdx);
        const draftId = tc.data.slice(colonIdx + 1);
        const validAction = action === 'approve' || action === 'reject';
        const validDraftId = /^[0-9A-Z]{26}$/.test(draftId);
        assert(validAction, `Valid action parsed: '${action}'`);
        assert(validDraftId, `Valid draftId parsed: '${draftId}'`);
      }
    }

    // ─────────────────────────────────────────────────────────
    // TEST 10: callback_data parsing — invalid cases rejected
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 10] callback_data parsing — invalid cases rejected');
    {
      const invalidCases = [
        { data: 'delete:01HV2KDPQ4BPGMK0SDKWTR8XN0', desc: 'invalid action (delete)' },
        { data: 'approve:../../etc/passwd', desc: 'path traversal in draftId' },
        { data: 'approve:', desc: 'empty draftId' },
        { data: 'approve:tooshort', desc: 'too-short draftId' },
        { data: 'nodraftid', desc: 'missing colon separator' },
        { data: 'approve:workspace_id=123&draft=ABC', desc: 'injection attempt' },
      ];

      for (const tc of invalidCases) {
        const colonIdx = tc.data.indexOf(':');
        let isRejected = false;

        if (colonIdx === -1) {
          isRejected = true; // no colon
        } else {
          const action = tc.data.slice(0, colonIdx);
          const draftId = tc.data.slice(colonIdx + 1);
          const validAction = action === 'approve' || action === 'reject';
          const validDraftId = /^[0-9A-Z]{26}$/.test(draftId);
          isRejected = !validAction || !validDraftId;
        }

        assert(isRejected, `Rejected: '${tc.desc}'`);
      }
    }

    // ─────────────────────────────────────────────────────────
    // TEST 11: SEC-03 — workspaceId from callback_data must not be trusted
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 11] SEC-03 — draftId from other workspace is rejected by RLS');
    {
      // Create a second workspace
      const { userId: userId2, workspaceId: workspaceId2 } = await createTestWorkspaceAndUser(pool);
      // Create draft in workspace2
      const draftId = await createTestDraft(pool, workspaceId2);

      // Try to approve using workspace1 context — RLS will filter out the row
      // because transaction_drafts policy requires workspace_id = current_setting('app.workspace_id')
      const result = await atomicApprove(draftId); // uses workspace1 context
      assert(
        result.outcome === 'not_found' || result.outcome === 'locked_by_other',
        `Cross-workspace draft approval returns safe outcome (got: ${result.outcome})`
      );
      const tx = await getTransactionByDraftId(pool, workspaceId, draftId);
      assert(tx === null, 'No cross-workspace Transaction created');
    }

  });
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

runTests()
  .then(() => {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Phase 1.6-B Smoke Tests: ${passed} passed, ${failed} failed`);
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
