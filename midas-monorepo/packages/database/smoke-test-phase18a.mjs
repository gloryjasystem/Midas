/**
 * Smoke Tests — Phase 1.8-A: Transaction Intent Foundation
 *
 * Tests (13 scenarios):
 *   1.  Draft created with 'expense' intent → parsed_intent = 'expense'
 *   2.  Draft created with 'income' intent → parsed_intent = 'income'
 *   3.  Draft created with 'debt_given' intent → parsed_intent = 'debt_given'
 *   4.  Draft created with 'debt_received' intent → parsed_intent = 'debt_received'
 *   5.  Draft created with 'transfer' intent → parsed_intent = 'transfer'
 *   6.  needs_clarification draft → parsed_intent = NULL (valid)
 *   7.  Approve 'expense' draft → transactions.transaction_intent = 'expense'
 *   8.  Approve 'income' draft → transactions.transaction_intent = 'income'
 *   9.  Approve 'debt_given' draft → transactions.transaction_intent = 'debt_given'
 *  10.  CHECK constraint rejects invalid intent value
 *  11.  INSERT into transactions without transaction_intent fails (NOT NULL)
 *  12.  Approve draft with NULL parsed_intent → returns intent_missing, no Transaction created
 *  13.  Cross-tenant isolation: transaction_intent not visible from other workspace
 *
 * SEC-03: workspaceId and userId always come from backend (test fixtures), not from user input.
 * SEC-02: No float arithmetic. Amounts stored as NUMERIC strings.
 * SEC-12: raw_text never appears in assertions, logs, or error output.
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
    [workspaceId, `Test WS Phase18A ${workspaceId.slice(-6)}`],
  );
  await pool.query(
    `INSERT INTO workspace_memberships (id, user_id, workspace_id, role, is_default) VALUES ($1, $2, $3, 'owner', true)`,
    [membershipId, userId, workspaceId],
  );
  return { userId, workspaceId };
}

/**
 * Create a draft with an explicit parsed_intent value (or NULL).
 * parsed_intent is nullable — NULL represents needs_clarification drafts.
 * SEC-12: raw_text value is a fixed test string, not from user input.
 */
async function createDraftWithIntent(pool, workspaceId, { intent = null, status = 'pending_user' } = {}) {
  const draftId = ulid();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO transaction_drafts
       (id, workspace_id, telegram_message_id, raw_text, parsed_amount, parsed_currency, parsed_intent, status, expires_at, created_at, updated_at)
     VALUES
       ($1, $2, 88888, '[test-phase18a]', '100.00', 'USD', $3, $4::draft_status, $5, NOW(), NOW())`,
    [draftId, workspaceId, intent, status, expiresAt.toISOString()],
  );
  return draftId;
}

async function getDraftIntent(pool, draftId) {
  const r = await pool.query(
    `SELECT parsed_intent FROM transaction_drafts WHERE id = $1`,
    [draftId],
  );
  return r.rows[0]?.parsed_intent ?? '__NOT_FOUND__';
}

async function getTransactionIntent(pool, draftId) {
  const r = await pool.query(
    `SELECT transaction_intent FROM transactions WHERE draft_id = $1`,
    [draftId],
  );
  return r.rows[0]?.transaction_intent ?? null;
}

async function getTransactionCount(pool, draftId) {
  const r = await pool.query(
    `SELECT COUNT(*)::INT AS cnt FROM transactions WHERE draft_id = $1`,
    [draftId],
  );
  return r.rows[0]?.cnt ?? 0;
}

/**
 * Atomic approve — mirrors approveDraft() service with Phase 1.8-A changes:
 * - fetches parsed_intent in SELECT
 * - returns { outcome: 'intent_missing' } if NULL
 * - writes transaction_intent to transactions INSERT
 * SEC-03: RLS context set for tenant isolation.
 */
async function atomicApproveWithIntent(pool, workspaceId, userId, draftId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.workspace_id = '${workspaceId}'`);
    await client.query(`SET LOCAL app.user_id = '${userId}'`);

    // Phase 1.8-A: fetch parsed_intent in lock query
    const lockResult = await client.query(
      `SELECT id, status, parsed_amount, parsed_currency, parsed_intent, expires_at
       FROM transaction_drafts
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE SKIP LOCKED`,
      [draftId, workspaceId],
    );

    if (lockResult.rows.length === 0) {
      await client.query('ROLLBACK');
      const check = await pool.query(
        `SELECT status FROM transaction_drafts WHERE id = $1`,
        [draftId],
      );
      return { outcome: check.rows.length === 0 ? 'not_found' : 'locked_by_other' };
    }

    const draft = lockResult.rows[0];

    if (draft.status !== 'pending_user') {
      await client.query('ROLLBACK');
      return { outcome: 'already_processed', existingStatus: draft.status };
    }

    if (new Date(draft.expires_at) <= new Date()) {
      await client.query(
        `UPDATE transaction_drafts SET status = 'expired', updated_at = NOW() WHERE id = $1`,
        [draftId],
      );
      await client.query('COMMIT');
      return { outcome: 'expired' };
    }

    // Phase 1.8-A: validate parsed_intent is not NULL before creating Transaction
    if (draft.parsed_intent === null) {
      await client.query('ROLLBACK');
      return { outcome: 'intent_missing' };
    }

    await client.query(
      `UPDATE transaction_drafts SET status = 'approved', updated_at = NOW() WHERE id = $1`,
      [draftId],
    );

    // Ensure category and account exist
    let catResult = await client.query(
      `SELECT id FROM categories WHERE workspace_id = $1 LIMIT 1`, [workspaceId],
    );
    let categoryId;
    if (catResult.rows.length === 0) {
      categoryId = ulid();
      await client.query(
        `INSERT INTO categories (id, workspace_id, name, "group")
         VALUES ($1, $2, 'Разное', 'Жизнь'::category_group)
         ON CONFLICT (workspace_id, name) DO NOTHING`,
        [categoryId, workspaceId],
      );
      catResult = await client.query(
        `SELECT id FROM categories WHERE workspace_id = $1 AND name = 'Разное' LIMIT 1`,
        [workspaceId],
      );
      categoryId = catResult.rows[0]?.id ?? categoryId;
    } else {
      categoryId = catResult.rows[0].id;
    }

    let acctResult = await client.query(
      `SELECT id FROM account_sources WHERE workspace_id = $1 LIMIT 1`, [workspaceId],
    );
    let accountId;
    if (acctResult.rows.length === 0) {
      accountId = ulid();
      await client.query(
        `INSERT INTO account_sources (id, workspace_id, name, type, currency)
         VALUES ($1, $2, 'Default', 'manual'::account_source_type, 'USD')
         ON CONFLICT DO NOTHING`,
        [accountId, workspaceId],
      );
      acctResult = await client.query(
        `SELECT id FROM account_sources WHERE workspace_id = $1 AND name = 'Default' LIMIT 1`,
        [workspaceId],
      );
      accountId = acctResult.rows[0]?.id ?? accountId;
    } else {
      accountId = acctResult.rows[0].id;
    }

    const transactionId = ulid();

    // Phase 1.8-A: transaction_intent explicitly provided — no DEFAULT, no silent fallback
    await client.query(
      `INSERT INTO transactions (
         id, workspace_id, original_amount, currency, exchange_rate, base_currency,
         base_amount, category_id, account_id, draft_id, transaction_time,
         transaction_intent, rate_source, created_at
       ) VALUES (
         $1, $2,
         $3::NUMERIC, $4, 1::NUMERIC, 'USD',
         $3::NUMERIC, $5, $6, $7, NOW(),
         $8,
         'none', NOW()
       )`,
      [
        transactionId, workspaceId,
        draft.parsed_amount ?? '0', draft.parsed_currency ?? 'USD',
        categoryId, accountId, draftId,
        draft.parsed_intent, // Phase 1.8-A: non-NULL validated above
      ],
    );

    await client.query('COMMIT');
    return { outcome: 'approved', transactionId };
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
  console.log('\n🔍 Phase 1.8-A Smoke Tests — Transaction Intent Foundation\n');

  await withPool(async (pool) => {
    const { userId, workspaceId } = await createTestWorkspaceAndUser(pool);
    console.log('[setup] workspace:', workspaceId, '| user:', userId);

    // ─────────────────────────────────────────────────────────
    // TEST 1: expense intent propagated to draft
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 1] parsed_intent = expense propagated to transaction_drafts');
    {
      const draftId = await createDraftWithIntent(pool, workspaceId, { intent: 'expense' });
      const intent = await getDraftIntent(pool, draftId);
      assert(intent === 'expense', `parsed_intent = 'expense' (got: ${intent})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 2: income intent
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 2] parsed_intent = income propagated to transaction_drafts');
    {
      const draftId = await createDraftWithIntent(pool, workspaceId, { intent: 'income' });
      const intent = await getDraftIntent(pool, draftId);
      assert(intent === 'income', `parsed_intent = 'income' (got: ${intent})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 3: debt_given intent
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 3] parsed_intent = debt_given propagated to transaction_drafts');
    {
      const draftId = await createDraftWithIntent(pool, workspaceId, { intent: 'debt_given' });
      const intent = await getDraftIntent(pool, draftId);
      assert(intent === 'debt_given', `parsed_intent = 'debt_given' (got: ${intent})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 4: debt_received intent
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 4] parsed_intent = debt_received propagated to transaction_drafts');
    {
      const draftId = await createDraftWithIntent(pool, workspaceId, { intent: 'debt_received' });
      const intent = await getDraftIntent(pool, draftId);
      assert(intent === 'debt_received', `parsed_intent = 'debt_received' (got: ${intent})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 5: transfer intent
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 5] parsed_intent = transfer propagated to transaction_drafts');
    {
      const draftId = await createDraftWithIntent(pool, workspaceId, { intent: 'transfer' });
      const intent = await getDraftIntent(pool, draftId);
      assert(intent === 'transfer', `parsed_intent = 'transfer' (got: ${intent})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 6: needs_clarification draft → parsed_intent = NULL (valid)
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 6] needs_clarification draft → parsed_intent = NULL (allowed)');
    {
      const draftId = await createDraftWithIntent(pool, workspaceId, {
        intent: null,
        status: 'needs_clarification',
      });
      const intentRaw = await pool.query(
        `SELECT parsed_intent FROM transaction_drafts WHERE id = $1`, [draftId],
      );
      const intent = intentRaw.rows[0]?.parsed_intent;
      assert(intent === null || intent === undefined, `parsed_intent IS NULL for needs_clarification (got: ${intent})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 7: Approve expense draft → transaction_intent = expense
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 7] Approve expense draft → transaction_intent = expense');
    {
      const draftId = await createDraftWithIntent(pool, workspaceId, { intent: 'expense' });
      const result = await atomicApproveWithIntent(pool, workspaceId, userId, draftId);
      assert(result.outcome === 'approved', `outcome = 'approved' (got: ${result.outcome})`);
      const txIntent = await getTransactionIntent(pool, draftId);
      assert(txIntent === 'expense', `transaction_intent = 'expense' (got: ${txIntent})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 8: Approve income draft → transaction_intent = income
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 8] Approve income draft → transaction_intent = income');
    {
      const draftId = await createDraftWithIntent(pool, workspaceId, { intent: 'income' });
      const result = await atomicApproveWithIntent(pool, workspaceId, userId, draftId);
      assert(result.outcome === 'approved', `outcome = 'approved' (got: ${result.outcome})`);
      const txIntent = await getTransactionIntent(pool, draftId);
      assert(txIntent === 'income', `transaction_intent = 'income' (got: ${txIntent})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 9: Approve debt_given draft → transaction_intent = debt_given
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 9] Approve debt_given draft → transaction_intent = debt_given');
    {
      const draftId = await createDraftWithIntent(pool, workspaceId, { intent: 'debt_given' });
      const result = await atomicApproveWithIntent(pool, workspaceId, userId, draftId);
      assert(result.outcome === 'approved', `outcome = 'approved' (got: ${result.outcome})`);
      const txIntent = await getTransactionIntent(pool, draftId);
      assert(txIntent === 'debt_given', `transaction_intent = 'debt_given' (got: ${txIntent})`);
    }

    // ─────────────────────────────────────────────────────────
    // TEST 10: CHECK constraint rejects invalid intent value
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 10] CHECK constraint rejects invalid transaction_intent value');
    {
      // Get fixture category and account IDs for direct INSERT test
      let catResult = await pool.query(`SELECT id FROM categories WHERE workspace_id = $1 LIMIT 1`, [workspaceId]);
      let categoryId = catResult.rows[0]?.id;
      if (!categoryId) {
        categoryId = ulid();
        await pool.query(
          `INSERT INTO categories (id, workspace_id, name, "group") VALUES ($1, $2, 'Разное', 'Жизнь'::category_group) ON CONFLICT (workspace_id, name) DO NOTHING`,
          [categoryId, workspaceId],
        );
        const r = await pool.query(`SELECT id FROM categories WHERE workspace_id = $1 AND name = 'Разное' LIMIT 1`, [workspaceId]);
        categoryId = r.rows[0]?.id ?? categoryId;
      }
      let acctResult = await pool.query(`SELECT id FROM account_sources WHERE workspace_id = $1 LIMIT 1`, [workspaceId]);
      let accountId = acctResult.rows[0]?.id;
      if (!accountId) {
        accountId = ulid();
        await pool.query(
          `INSERT INTO account_sources (id, workspace_id, name, type, currency) VALUES ($1, $2, 'Default', 'manual'::account_source_type, 'USD') ON CONFLICT DO NOTHING`,
          [accountId, workspaceId],
        );
        const r = await pool.query(`SELECT id FROM account_sources WHERE workspace_id = $1 AND name = 'Default' LIMIT 1`, [workspaceId]);
        accountId = r.rows[0]?.id ?? accountId;
      }

      let checkFired = false;
      try {
        await pool.query(
          `INSERT INTO transactions (
             id, workspace_id, original_amount, currency, exchange_rate, base_currency,
             base_amount, category_id, account_id, draft_id, transaction_time,
             transaction_intent, rate_source, created_at
           ) VALUES ($1,$2,'1.00','USD',1::NUMERIC,'USD','1.00',$3,$4,NULL,NOW(),$5,'none',NOW())`,
          [ulid(), workspaceId, categoryId, accountId, 'INVALID_INTENT'],
        );
      } catch (err) {
        checkFired = err.message.includes('chk_transaction_intent') || err.message.includes('check');
      }
      assert(checkFired, 'CHECK constraint blocks invalid transaction_intent value');
    }

    // ─────────────────────────────────────────────────────────
    // TEST 11: INSERT without transaction_intent fails (NOT NULL)
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 11] INSERT into transactions without transaction_intent fails (NOT NULL)');
    {
      let catResult = await pool.query(`SELECT id FROM categories WHERE workspace_id = $1 LIMIT 1`, [workspaceId]);
      const categoryId = catResult.rows[0]?.id ?? ulid();
      let acctResult = await pool.query(`SELECT id FROM account_sources WHERE workspace_id = $1 LIMIT 1`, [workspaceId]);
      const accountId = acctResult.rows[0]?.id ?? ulid();

      let notNullViolation = false;
      try {
        // Deliberately omit transaction_intent column
        await pool.query(
          `INSERT INTO transactions (
             id, workspace_id, original_amount, currency, exchange_rate, base_currency,
             base_amount, category_id, account_id, draft_id, transaction_time, rate_source, created_at
           ) VALUES ($1,$2,'1.00','USD',1::NUMERIC,'USD','1.00',$3,$4,NULL,NOW(),'none',NOW())`,
          [ulid(), workspaceId, categoryId, accountId],
        );
      } catch (err) {
        // NOT NULL violation or missing value
        notNullViolation =
          err.message.includes('null value') ||
          err.message.includes('not-null') ||
          err.message.includes('NOT NULL') ||
          err.message.includes('violates not-null');
      }
      assert(notNullViolation, 'NOT NULL constraint prevents INSERT without transaction_intent');
    }

    // ─────────────────────────────────────────────────────────
    // TEST 12: Approve draft with NULL parsed_intent → intent_missing, no Transaction
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 12] Approve NULL-intent draft → outcome = intent_missing, no Transaction created');
    {
      // Create a pending_user draft with NULL parsed_intent (simulates a legacy or malformed draft)
      const draftId = await createDraftWithIntent(pool, workspaceId, {
        intent: null,
        status: 'pending_user',
      });

      const result = await atomicApproveWithIntent(pool, workspaceId, userId, draftId);
      assert(result.outcome === 'intent_missing', `outcome = 'intent_missing' (got: ${result.outcome})`);

      const txCount = await getTransactionCount(pool, draftId);
      assert(txCount === 0, `No Transaction created when intent is NULL (found: ${txCount})`);

      // Draft status must remain pending_user — we did NOT transition it
      const draftStatus = await pool.query(
        `SELECT status::TEXT FROM transaction_drafts WHERE id = $1`, [draftId],
      );
      assert(
        draftStatus.rows[0]?.status === 'pending_user',
        `Draft stays pending_user after intent_missing (got: ${draftStatus.rows[0]?.status})`,
      );
    }

    // ─────────────────────────────────────────────────────────
    // TEST 13: Cross-tenant isolation — atomicApprove cannot see or approve
    //          a draft that belongs to another workspace.
    // SEC-03: workspace_id enforced in WHERE clause; SELECT returns 0 rows.
    // Note: midas_user is a superuser (usebypassrls=true), so RLS SET LOCAL
    //       cannot be tested at this layer. Isolation is enforced by the
    //       WHERE id = $1 AND workspace_id = $2 clause in atomicApproveWithIntent.
    //       This is the same pattern verified in smoke-test-phase16b.mjs test 11.
    // ─────────────────────────────────────────────────────────
    console.log('\n[TEST 13] SEC-03 cross-tenant isolation — workspace1 cannot approve workspace2 draft');
    {
      const { userId: userId2, workspaceId: workspaceId2 } = await createTestWorkspaceAndUser(pool);
      const draftId = await createDraftWithIntent(pool, workspaceId2, { intent: 'income' });

      // Attempt to approve workspaceId2's draft using workspaceId1's context.
      // atomicApproveWithIntent filters by workspace_id = workspaceId (workspace1),
      // so the draft (workspace2) is invisible to it → returns 'not_found'.
      const result = await atomicApproveWithIntent(pool, workspaceId, userId, draftId);
      assert(
        result.outcome === 'not_found' || result.outcome === 'locked_by_other',
        `Cross-workspace approval blocked (got: ${result.outcome})`,
      );

      // No Transaction should exist for this draftId from workspace1's perspective
      const txCount = await getTransactionCount(pool, draftId);
      assert(txCount === 0, `No Transaction created via cross-workspace approve attempt (found: ${txCount})`);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

runTests()
  .then(() => {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Phase 1.8-A Smoke Tests: ${passed} passed, ${failed} failed`);
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
